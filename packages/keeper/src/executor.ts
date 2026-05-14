import { Client as PositionManagerClient } from "@stellars/bindings/position-manager";
import { client } from "@stellars/protocol-clients";
import { keypairSigner } from "@stellars/protocol-clients/node";
import {
  KEEPER_DAILY_FEE_BUDGET_STROOPS,
  KEEPER_MAX_FEE_STROOPS,
  KEEPER_TX_TIMEOUT_SECONDS,
} from "@stellars/config";
import type { KeeperConfig } from "./config.js";

/**
 * Outcome of attempting a keeper action. Every executor method runs the
 * binding's `await client.method(args)` step first, which internally
 * simulates the call against the live RPC; signAndSend only runs if the
 * simulation reports success.
 *
 *   - kind: "submitted"                     → signed + included on-chain
 *   - kind: "rejected", expected: true      → contract said no during sim
 *     (e.g. position no longer underwater) — normal during keeper operation
 *   - kind: "rejected", expected: false     → unexpected failure (RPC,
 *     malformed tx, host error, post-sim state shift) — log loudly
 */
export type SubmitOutcome =
  | { kind: "submitted" }
  | { kind: "rejected"; expected: boolean; reason: string };

export interface Executor {
  publicKey: string;
  updateIndices(symbol: string): Promise<SubmitOutcome>;
  liquidatePosition(trader: string, symbol: string): Promise<SubmitOutcome>;
  executeOrder(trader: string, symbol: string): Promise<SubmitOutcome>;
  deleveragePosition(trader: string, symbol: string): Promise<SubmitOutcome>;
}

// Position-manager error variants that are normal during keeper operation:
// we attempt actions speculatively and the contract correctly refuses when
// on-chain state doesn't actually warrant them.
const EXPECTED_REJECTIONS = [
  "HealthFactorOk",         // #9  — position no longer underwater
  "OrderNotTriggered",      // #13 — mark price drifted back across TP/SL
  "AdlNotTriggered",        // #10 — ADL conditions no longer met
  "AdlTargetNotProfitable", // #17 — target's PnL flipped between scan and submit
  "PositionNotFound",       // #6  — already liquidated or closed
  "PositionNotOldEnough",   // #5  — min_position_lifetime not elapsed
  "Paused",                 // #3  — vault paused; keeper should pause too
];

function classify(err: unknown): { expected: boolean; reason: string } {
  const reason = (err as Error)?.message ?? String(err);
  const expected = EXPECTED_REJECTIONS.some((name) => reason.includes(name));
  return { expected, reason };
}

type SignAndSendable = {
  signAndSend: (opts?: { timeoutInSeconds?: number }) => Promise<unknown>;
};

function startOfDayUtc(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

export function createExecutor(config: KeeperConfig): Executor {
  const signer = keypairSigner(config.keeperSecret, config.networkPassphrase);
  const publicKey = signer.publicKey;
  // Drop the seed reference from the long-lived config object now that the
  // signer has been derived. A subsequent JSON.stringify(config) or
  // accidental console.log(config) cannot leak the seed.
  (config as { keeperSecret: string }).keeperSecret = "";

  const pmClient = client(
    PositionManagerClient,
    { rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase },
    config.contracts.positionManager.address,
    signer,
  );

  // Per-day fee budget. The keeper refuses to submit once today's cumulative
  // submission fees exceed KEEPER_DAILY_FEE_BUDGET_STROOPS. Reset at UTC
  // midnight. A circuit-breaker against an adversary crafting expensive
  // simulations that drain the keeper's XLM.
  let dailyFeeSpentStroops = 0n;
  let dailyBudgetWindowStart = startOfDayUtc(Date.now());
  function refreshDailyBudget(): void {
    const today = startOfDayUtc(Date.now());
    if (today !== dailyBudgetWindowStart) {
      dailyBudgetWindowStart = today;
      dailyFeeSpentStroops = 0n;
    }
  }
  function attemptCharge(estimatedStroops: bigint): boolean {
    refreshDailyBudget();
    if (dailyFeeSpentStroops + estimatedStroops > BigInt(KEEPER_DAILY_FEE_BUDGET_STROOPS)) {
      return false;
    }
    dailyFeeSpentStroops += estimatedStroops;
    return true;
  }

  /**
   * Build (which simulates), then sign and send. Two failure points:
   *   1. The build step throws — simulation failed.
   *   2. signAndSend throws — RPC/network issue, or state shifted between
   *      sim and inclusion. Treat as unexpected even if the message
   *      mentions an expected-rejection name; a passing sim followed by
   *      a contract error at inclusion time is a race we should surface.
   */
  async function submitWithSim(
    label: string,
    build: () => Promise<unknown>,
  ): Promise<SubmitOutcome> {
    // Reserve budget pessimistically against KEEPER_MAX_FEE_STROOPS — every
    // submission can cost up to this amount per the protocol fee model.
    if (!attemptCharge(BigInt(KEEPER_MAX_FEE_STROOPS))) {
      const reason = `daily fee budget ${KEEPER_DAILY_FEE_BUDGET_STROOPS} stroops exhausted`;
      console.error(`[keeper] ${label} — refused: ${reason}`);
      return { kind: "rejected", expected: false, reason };
    }

    let tx: SignAndSendable;
    try {
      tx = (await build()) as SignAndSendable;
    } catch (err) {
      const { expected, reason } = classify(err);
      if (expected) {
        console.log(`[keeper] ${label} — sim rejected (${reason})`);
      } else {
        console.error(`[keeper] ${label} — sim error:`, reason);
      }
      return { kind: "rejected", expected, reason };
    }

    try {
      // Explicit `timeoutInSeconds` caps how long signAndSend polls
      // getTransaction(hash) for inclusion. After the cap we treat the tx
      // as failed regardless of ledger outcome — the dedup ghost will
      // expire and the next tick can retry if the underlying condition
      // still holds.
      await tx.signAndSend({ timeoutInSeconds: KEEPER_TX_TIMEOUT_SECONDS });
      console.log(`[keeper] ${label} — submitted`);
      return { kind: "submitted" };
    } catch (err) {
      const { reason } = classify(err);
      console.error(`[keeper] ${label} — submit error after passing sim:`, reason);
      return { kind: "rejected", expected: false, reason };
    }
  }

  return {
    publicKey,

    updateIndices(symbol) {
      return submitWithSim(`update_indices(${symbol})`, () =>
        pmClient.update_indices({ caller: publicKey, symbol }),
      );
    },

    liquidatePosition(trader, symbol) {
      return submitWithSim(`liquidate(${trader.slice(0, 8)}…, ${symbol})`, () =>
        pmClient.liquidate_position({ caller: publicKey, trader, symbol }),
      );
    },

    executeOrder(trader, symbol) {
      return submitWithSim(`execute_order(${trader.slice(0, 8)}…, ${symbol})`, () =>
        pmClient.execute_order({ caller: publicKey, trader, symbol }),
      );
    },

    deleveragePosition(trader, symbol) {
      return submitWithSim(`adl(${trader.slice(0, 8)}…, ${symbol})`, () =>
        pmClient.deleverage_position({ caller: publicKey, trader, symbol }),
      );
    },
  };
}
