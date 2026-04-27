import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as PositionManagerClient } from "@stellars/bindings/position-manager";
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

type SignAndSendable = { signAndSend: () => Promise<unknown> };

export function createExecutor(config: KeeperConfig): Executor {
  const kp = Keypair.fromSecret(config.keeperSecret);
  const publicKey = kp.publicKey();
  const { signTransaction, signAuthEntry } = basicNodeSigner(kp, config.networkPassphrase);

  const client = new PositionManagerClient({
    contractId: config.contracts.positionManager.address,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    signTransaction,
    signAuthEntry,
    allowHttp: config.rpcUrl.startsWith("http://"),
  });

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
      await tx.signAndSend();
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
        client.update_indices({ caller: publicKey, symbol }),
      );
    },

    liquidatePosition(trader, symbol) {
      return submitWithSim(`liquidate(${trader.slice(0, 8)}…, ${symbol})`, () =>
        client.liquidate_position({ caller: publicKey, trader, symbol }),
      );
    },

    executeOrder(trader, symbol) {
      return submitWithSim(`execute_order(${trader.slice(0, 8)}…, ${symbol})`, () =>
        client.execute_order({ caller: publicKey, trader, symbol }),
      );
    },

    deleveragePosition(trader, symbol) {
      return submitWithSim(`adl(${trader.slice(0, 8)}…, ${symbol})`, () =>
        client.deleverage_position({ caller: publicKey, trader, symbol }),
      );
    },
  };
}
