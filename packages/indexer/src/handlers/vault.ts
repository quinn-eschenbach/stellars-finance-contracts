import { eq, sql } from "drizzle-orm";
import { type Db, vaultState, vaultEvents, vaultLockups, feeEvents, payProfitEvents, pauseEvents, lpTransfers } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../convert.js";

const SINGLETON_ID = 1;

// Per-event data shapes. Most events come from contracts/vault/src/events.rs;
// `deposit`/`withdraw` come from OZ stellar_tokens::vault::Vault and `transfer`
// from OZ FungibleToken (auto-emitted on LP share movement).

interface DepositData {
  receiver: string;
  assets: bigint;
  shares: bigint;
}

interface WithdrawData {
  owner: string;
  assets: bigint;
  shares: bigint;
}

interface TransferData {
  from: string;
  to: string;
  to_muxed_id?: bigint | null;
  amount: bigint;
}

interface PayProfitData {
  trader: string;
  amount: bigint;
  /** Absolute total_assets after this payout. Used to set
   *  vault_state.total_assets directly, bypassing arithmetic deltas that
   *  could double-count on replay. */
  new_total_assets: bigint;
}

interface AbsorbedCollateralData {
  trader: string;
  amount: bigint;
  /** Same absolute-snapshot pattern as PayProfit. */
  new_total_assets: bigint;
}

/** Emitted by Vault after deposit / mint / withdraw / redeem so the indexer
 *  can write absolute total_assets without re-deriving from OZ's bare
 *  Deposit/Withdraw events (which don't carry the post-write balance). */
interface TotalAssetsUpdateData {
  new_total_assets: bigint;
}

interface ReserveData {
  amount: bigint;
  new_total: bigint;
}

interface ReleaseData {
  amount: bigint;
  new_total: bigint;
}

interface AccrueFeesData {
  amount: bigint;
  new_total: bigint;
}

interface ClaimFeesData {
  amount: bigint;
  recipient: string;
}

interface UpdateNetPnlData {
  pnl: bigint;
}

interface ClaimFeesToData {
  amount: bigint;
  new_total: bigint;
  recipient: string;
}

interface PauseData {
  is_paused: boolean;
  caller: string;
}

interface LockupData {
  user: string;
  expires_at: bigint;
}

async function recomputeFreeLiquidity(db: Db, ledger: number) {
  const rows = await db.select().from(vaultState).where(eq(vaultState.id, SINGLETON_ID)).limit(1);
  if (rows.length === 0) return;
  const s = rows[0];
  const totalAssets = BigInt(s.total_assets);
  const reserved = BigInt(s.reserved_usdc);
  const fees = BigInt(s.unclaimed_fees);
  const pnl = BigInt(s.net_global_trader_pnl);
  const pnlFloor = pnl > 0n ? pnl : 0n;
  const raw = totalAssets - reserved - fees - pnlFloor;
  const free = raw > 0n ? raw : 0n;
  await db
    .update(vaultState)
    .set({ free_liquidity: String(free), updated_at_ledger: ledger, updated_at: new Date() })
    .where(eq(vaultState.id, SINGLETON_ID));
}

export async function handleVaultEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    // OZ Vault::deposit and Vault::mint both emit a "deposit" event.
    case "deposit":
      return handleDeposit(db, event);
    // OZ Vault::withdraw and Vault::redeem both emit a "withdraw" event.
    case "withdraw":
      return handleWithdraw(db, event);
    // OZ FungibleToken auto-emits "transfer" when LP shares move user-to-user.
    case "transfer":
      return handleTransfer(db, event);
    case "pay_profit":
      return handlePayProfit(db, event);
    case "absorbed":
      return handleAbsorbedCollateral(db, event);
    case "reserve":
      return handleReserve(db, event);
    case "release":
      return handleRelease(db, event);
    case "fees":
      return handleAccrueFees(db, event);
    case "claim":
      return handleClaimFees(db, event);
    case "net_pnl":
      return handleNetPnl(db, event);
    case "claim_to":
      return handleClaimFeesTo(db, event);
    case "pause":
      return handlePause(db, event);
    case "lockup":
      return handleLockup(db, event);
    case "total":
      return handleTotalAssetsUpdate(db, event);
    default:
      break;
  }
}

async function handleLockup(db: Db, event: ParsedEvent) {
  const d = event.data as LockupData;
  const expiresAt = toNumericString(d.expires_at);
  await db
    .insert(vaultLockups)
    .values({
      user: d.user,
      expires_at: expiresAt,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultLockups.user,
      set: {
        expires_at: expiresAt,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleDeposit(db: Db, event: ParsedEvent) {
  const d = event.data as DepositData;
  // The bare OZ Deposit event no longer drives `total_assets` — the Vault
  // contract emits a separate TotalAssetsUpdate carrying the absolute value,
  // and `handleTotalAssetsUpdate` is the authoritative writer. Here we only
  // record the per-user deposit row + bump shares.
  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "deposit",
    user: d.receiver,
    assets: toNumericString(d.assets),
    shares: toNumericString(d.shares),
  });
  const shares = toNumericString(d.shares);
  await db
    .insert(vaultState)
    .values({ id: SINGLETON_ID, total_shares: shares, updated_at_ledger: event.ledger })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        total_shares: sql`${vaultState.total_shares}::numeric + ${shares}::numeric`,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleWithdraw(db: Db, event: ParsedEvent) {
  const d = event.data as WithdrawData;
  // TotalAssetsUpdate carries the post-write absolute total (handled
  // separately). We only bookkeep the per-user withdraw row + shares.
  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "withdraw",
    user: d.owner,
    assets: toNumericString(d.assets),
    shares: toNumericString(d.shares),
  });
  const shares = toNumericString(d.shares);
  await db
    .update(vaultState)
    .set({
      total_shares: sql`${vaultState.total_shares}::numeric - ${shares}::numeric`,
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleTransfer(db: Db, event: ParsedEvent) {
  const d = event.data as TransferData;
  await db.insert(lpTransfers).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    from: d.from,
    to: d.to,
    to_muxed_id: d.to_muxed_id != null ? toNumericString(d.to_muxed_id) : null,
    amount: toNumericString(d.amount),
  });
}

/**
 * Direct collateral inflow from PositionManager during liquidation /
 * loss-settlement paths that bypass pay_profit (see ADR-0001). The event
 * carries `new_total_assets` so we set the absolute value rather than
 * incrementing — eliminates double-counting on any kind of replay.
 */
async function handleAbsorbedCollateral(db: Db, event: ParsedEvent) {
  const d = event.data as AbsorbedCollateralData;
  const amount = toNumericString(d.amount);
  const newTotalAssets = toNumericString(d.new_total_assets);
  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "absorbed",
    user: d.trader,
    assets: amount,
    shares: "0",
  });
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      total_assets: newTotalAssets,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        total_assets: newTotalAssets,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

/**
 * Vault paid `amount` to `trader` to settle a profitable close. The event
 * carries the post-payout absolute total_assets, so we set the value
 * directly instead of subtracting — a replay just re-asserts the same
 * absolute value, no double-debit.
 */
async function handlePayProfit(db: Db, event: ParsedEvent) {
  const d = event.data as PayProfitData;
  const amount = toNumericString(d.amount);
  const newTotalAssets = toNumericString(d.new_total_assets);
  await db.insert(payProfitEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader: d.trader,
    amount,
  });
  await db
    .update(vaultState)
    .set({
      total_assets: newTotalAssets,
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
  await recomputeFreeLiquidity(db, event.ledger);
}

/**
 * TotalAssetsUpdate is emitted by every LP-facing entrypoint (deposit,
 * mint, withdraw, redeem) so the indexer doesn't have to compute arithmetic
 * deltas from the OZ deposit/withdraw events. Setting the absolute value
 * is replay-safe.
 */
async function handleTotalAssetsUpdate(db: Db, event: ParsedEvent) {
  const d = event.data as TotalAssetsUpdateData;
  const newTotalAssets = toNumericString(d.new_total_assets);
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      total_assets: newTotalAssets,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        total_assets: newTotalAssets,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleReserve(db: Db, event: ParsedEvent) {
  const d = event.data as ReserveData;
  const newTotal = toNumericString(d.new_total);
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      reserved_usdc: newTotal,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        reserved_usdc: newTotal,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleRelease(db: Db, event: ParsedEvent) {
  const d = event.data as ReleaseData;
  await db
    .update(vaultState)
    .set({
      reserved_usdc: toNumericString(d.new_total),
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleAccrueFees(db: Db, event: ParsedEvent) {
  const d = event.data as AccrueFeesData;
  const newTotal = toNumericString(d.new_total);
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      unclaimed_fees: newTotal,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        unclaimed_fees: newTotal,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });

  await db.insert(feeEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "accrue",
    amount: toNumericString(d.amount),
  });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleClaimFees(db: Db, event: ParsedEvent) {
  const d = event.data as ClaimFeesData;
  const amount = toNumericString(d.amount);
  await db
    .update(vaultState)
    .set({
      unclaimed_fees: "0",
      total_assets: sql`${vaultState.total_assets}::numeric - ${amount}::numeric`,
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));

  await db.insert(feeEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "claim",
    amount,
    recipient: d.recipient,
  });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleNetPnl(db: Db, event: ParsedEvent) {
  const d = event.data as UpdateNetPnlData;
  const pnl = toNumericString(d.pnl);
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      net_global_trader_pnl: pnl,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        net_global_trader_pnl: pnl,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleClaimFeesTo(db: Db, event: ParsedEvent) {
  const d = event.data as ClaimFeesToData;
  const amount = toNumericString(d.amount);
  await db
    .update(vaultState)
    .set({
      unclaimed_fees: toNumericString(d.new_total),
      total_assets: sql`${vaultState.total_assets}::numeric - ${amount}::numeric`,
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
  await db.insert(feeEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "claim_to",
    amount,
    recipient: d.recipient,
  });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handlePause(db: Db, event: ParsedEvent) {
  const d = event.data as PauseData;
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      is_paused: d.is_paused,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        is_paused: d.is_paused,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });

  await db.insert(pauseEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    contract: "vault",
    is_paused: d.is_paused,
    caller: d.caller,
  });
}
