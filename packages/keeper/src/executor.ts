import {
  Client as PositionManagerClient,
  PositionManagerError,
} from "@stellars/bindings/position-manager";
import { client } from "@stellars/protocol-clients";
import { keypairSigner } from "@stellars/protocol-clients/node";
import {
  KEEPER_DAILY_FEE_BUDGET_STROOPS,
  KEEPER_TX_TIMEOUT_SECONDS,
} from "@stellars/config";
import { type Db, keeperFees } from "@stellars/db";
import type { KeeperConfig } from "./config.js";

/** Op-type for cost tracking; keys the per-op spend tally. */
export type OpType =
  | "update_indices"
  | "liquidate_position"
  | "execute_order"
  | "deleverage_position";

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
  /** Snapshot of today's cumulative realised fee spend, total + per op. */
  costSummary(): { totalStroops: bigint; byOp: Record<OpType, bigint> };
}

// Position-manager error variants that are normal during keeper operation:
// we attempt actions speculatively and the contract correctly refuses when
// on-chain state doesn't actually warrant them. Names are pulled from the
// auto-generated `PositionManagerError` map in @stellars/bindings so a
// rename in the contract trips a loud startup error rather than a silent
// substring-match miss.
const EXPECTED_REJECTION_CODES = [3, 5, 6, 9, 10, 13, 17] as const;
const EXPECTED_REJECTIONS: string[] = EXPECTED_REJECTION_CODES.map((code) => {
  const entry = PositionManagerError[code as keyof typeof PositionManagerError];
  if (!entry?.message) {
    throw new Error(
      `keeper EXPECTED_REJECTIONS: PositionManagerError[${code}] missing — bindings regen needed?`,
    );
  }
  return entry.message;
});

function classify(err: unknown): { expected: boolean; reason: string } {
  const reason = (err as Error)?.message ?? String(err);
  const expected = EXPECTED_REJECTIONS.some((name) => reason.includes(name));
  return { expected, reason };
}

/**
 * Subset of `SentTransaction` we read for cost accounting and audit-log
 * persistence. Typed locally so we don't have to import the SDK's generic.
 * The chain enforces that any successful tx populates
 * `getTransactionResponse.resultXdr.feeCharged()` with the actual stroops
 * paid; `txHash` and `ledger` are stable across SDK versions.
 */
type SentLike = {
  sendTransactionResponse?: { hash?: string };
  getTransactionResponse?: {
    txHash?: string;
    ledger?: number;
    createdAt?: number | string;
    resultXdr?: { feeCharged?: () => { toBigInt?: () => bigint } | bigint | string | number };
  };
};
type SignAndSendable = {
  signAndSend: (opts?: { timeoutInSeconds?: number }) => Promise<SentLike>;
};

interface SubmissionRecord {
  txHash: string;
  ledger: number;
  unixSeconds: bigint;
  feeStroops: bigint;
}

function extractFeeCharged(sent: SentLike): bigint {
  const raw = sent.getTransactionResponse?.resultXdr?.feeCharged?.();
  if (raw === undefined || raw === null) return 0n;
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") return BigInt(raw);
  if (typeof raw === "string") return BigInt(raw);
  if (typeof (raw as { toBigInt?: () => bigint }).toBigInt === "function") {
    return (raw as { toBigInt: () => bigint }).toBigInt();
  }
  return 0n;
}

function extractRecord(sent: SentLike): SubmissionRecord {
  const txHash = sent.getTransactionResponse?.txHash ?? sent.sendTransactionResponse?.hash ?? "";
  const ledger = sent.getTransactionResponse?.ledger ?? 0;
  const rawCreatedAt = sent.getTransactionResponse?.createdAt;
  // `createdAt` is unix-seconds in either number or string form depending on
  // SDK build. Fall back to wall-clock at the moment of inclusion if absent.
  const unixSeconds =
    typeof rawCreatedAt === "number" ? BigInt(rawCreatedAt)
      : typeof rawCreatedAt === "string" && rawCreatedAt.length > 0 ? BigInt(rawCreatedAt)
      : BigInt(Math.floor(Date.now() / 1000));
  return { txHash, ledger, unixSeconds, feeStroops: extractFeeCharged(sent) };
}

function startOfDayUtc(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

export function createExecutor(config: KeeperConfig, db: Db): Executor {
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

  // Per-day cost tracker. Records the realised on-chain fee for every
  // submission, partitioned by op type, and resets at UTC midnight.
  //
  // NOT a gate. Crossing KEEPER_DAILY_FEE_BUDGET_STROOPS emits a single
  // WARN per day; the keeper continues submitting. Halting submissions
  // would stop liquidations / index updates / TP-SL execution — operator
  // pain that's strictly worse than overspend. The only hard stop is the
  // wallet actually running out of XLM, which the chain enforces.
  const opTypes: readonly OpType[] = [
    "update_indices",
    "liquidate_position",
    "execute_order",
    "deleverage_position",
  ];
  const emptyByOp = (): Record<OpType, bigint> =>
    Object.fromEntries(opTypes.map((t) => [t, 0n])) as Record<OpType, bigint>;

  let totalSpentStroops = 0n;
  let byOpSpentStroops: Record<OpType, bigint> = emptyByOp();
  let windowStart = startOfDayUtc(Date.now());
  let capCrossedThisWindow = false;

  function rolloverIfNewDay(): void {
    const today = startOfDayUtc(Date.now());
    if (today !== windowStart) {
      windowStart = today;
      totalSpentStroops = 0n;
      byOpSpentStroops = emptyByOp();
      capCrossedThisWindow = false;
    }
  }

  function recordSpend(op: OpType, feeStroops: bigint): void {
    if (feeStroops <= 0n) return;
    rolloverIfNewDay();
    totalSpentStroops += feeStroops;
    byOpSpentStroops[op] += feeStroops;

    const cap = BigInt(KEEPER_DAILY_FEE_BUDGET_STROOPS);
    if (totalSpentStroops > cap && !capCrossedThisWindow) {
      capCrossedThisWindow = true;
      const byOpDump = opTypes
        .map((t) => `${t}=${byOpSpentStroops[t]}`)
        .join(", ");
      console.warn(
        `[keeper] daily fee budget ${cap} stroops EXCEEDED — total ${totalSpentStroops} stroops ` +
          `(${byOpDump}). Continuing submissions; fund the keeper wallet or raise the budget to silence this.`,
      );
    }
  }

  /**
   * Build (which simulates), then sign and send. Two failure points:
   *   1. The build step throws — simulation failed.
   *   2. signAndSend throws — RPC/network issue, or state shifted between
   *      sim and inclusion. Treat as unexpected even if the message
   *      mentions an expected-rejection name; a passing sim followed by
   *      a contract error at inclusion time is a race we should surface.
   */
  async function persistFee(
    op: OpType,
    symbol: string | null,
    trader: string | null,
    rec: SubmissionRecord,
  ): Promise<void> {
    if (!rec.txHash) return;
    try {
      await db.insert(keeperFees).values({
        tx_hash: rec.txHash,
        ledger: rec.ledger,
        timestamp: rec.unixSeconds.toString(),
        op_type: op,
        symbol,
        trader,
        fee_charged_stroops: rec.feeStroops.toString(),
      });
    } catch (err) {
      // Persistence failure must not break the submission flow — the tx
      // already settled on-chain. Surface and continue.
      console.error(`[keeper] keeper_fees insert failed for ${rec.txHash}:`, err);
    }
  }

  async function submitWithSim(
    op: OpType,
    label: string,
    symbol: string | null,
    trader: string | null,
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
      // Explicit `timeoutInSeconds` caps how long signAndSend polls
      // getTransaction(hash) for inclusion. After the cap we treat the tx
      // as failed regardless of ledger outcome — the dedup ghost will
      // expire and the next tick can retry if the underlying condition
      // still holds.
      const sent = await tx.signAndSend({ timeoutInSeconds: KEEPER_TX_TIMEOUT_SECONDS });
      const rec = extractRecord(sent);
      recordSpend(op, rec.feeStroops);
      await persistFee(op, symbol, trader, rec);
      console.log(`[keeper] ${label} — submitted (fee ${rec.feeStroops} stroops, tx ${rec.txHash.slice(0, 8)}…)`);
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
      return submitWithSim("update_indices", `update_indices(${symbol})`, symbol, null, () =>
        pmClient.update_indices({ caller: publicKey, symbol }),
      );
    },

    liquidatePosition(trader, symbol) {
      return submitWithSim(
        "liquidate_position",
        `liquidate(${trader.slice(0, 8)}…, ${symbol})`,
        symbol,
        trader,
        () => pmClient.liquidate_position({ caller: publicKey, trader, symbol }),
      );
    },

    executeOrder(trader, symbol) {
      return submitWithSim(
        "execute_order",
        `execute_order(${trader.slice(0, 8)}…, ${symbol})`,
        symbol,
        trader,
        () => pmClient.execute_order({ caller: publicKey, trader, symbol }),
      );
    },

    deleveragePosition(trader, symbol) {
      return submitWithSim(
        "deleverage_position",
        `adl(${trader.slice(0, 8)}…, ${symbol})`,
        symbol,
        trader,
        () => pmClient.deleverage_position({ caller: publicKey, trader, symbol }),
      );
    },

    costSummary() {
      rolloverIfNewDay();
      return { totalStroops: totalSpentStroops, byOp: { ...byOpSpentStroops } };
    },
  };
}
