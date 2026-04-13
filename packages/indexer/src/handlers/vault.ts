import { eq, sql } from "drizzle-orm";
import { type Db, vaultState, vaultEvents, feeEvents, settleEvents, pauseEvents, lpTransfers } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../spec-parser.js";

const SINGLETON_ID = 1;

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
    case "settle":
      return handleSettle(db, event);
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
    default:
      break;
  }
}

async function handleDeposit(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "deposit",
    user: String(data.receiver),
    assets: toNumericString(data.assets),
    shares: toNumericString(data.shares),
  });
  const assets = toNumericString(data.assets);
  const shares = toNumericString(data.shares);
  await db
    .insert(vaultState)
    .values({ id: SINGLETON_ID, total_assets: assets, total_shares: shares, updated_at_ledger: event.ledger })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        total_assets: sql`${vaultState.total_assets}::numeric + ${assets}::numeric`,
        total_shares: sql`${vaultState.total_shares}::numeric + ${shares}::numeric`,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleWithdraw(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "withdraw",
    user: String(data.owner),
    assets: toNumericString(data.assets),
    shares: toNumericString(data.shares),
  });
  const assets = toNumericString(data.assets);
  const shares = toNumericString(data.shares);
  await db
    .update(vaultState)
    .set({
      total_assets: sql`${vaultState.total_assets}::numeric - ${assets}::numeric`,
      total_shares: sql`${vaultState.total_shares}::numeric - ${shares}::numeric`,
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleTransfer(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(lpTransfers).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    from: String(data.from),
    to: String(data.to),
    to_muxed_id: data.to_muxed_id != null ? toNumericString(data.to_muxed_id) : null,
    amount: toNumericString(data.amount),
  });
}

async function handleSettle(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(settleEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader: String(data.trader),
    amount: toNumericString(data.amount),
    reserved_delta: toNumericString(data.reserved_delta),
    is_profit: data.is_profit,
  });
  const amount = toNumericString(data.amount);
  await db
    .update(vaultState)
    .set({
      total_assets: data.is_profit
        ? sql`${vaultState.total_assets}::numeric - ${amount}::numeric`
        : sql`${vaultState.total_assets}::numeric + ${amount}::numeric`,
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleReserve(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      reserved_usdc: toNumericString(data.new_total),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        reserved_usdc: toNumericString(data.new_total),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleRelease(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .update(vaultState)
    .set({
      reserved_usdc: toNumericString(data.new_total),
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleAccrueFees(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      unclaimed_fees: toNumericString(data.new_total),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        unclaimed_fees: toNumericString(data.new_total),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });

  await db.insert(feeEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "accrue",
    amount: toNumericString(data.amount),
  });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleClaimFees(db: Db, event: ParsedEvent) {
  const { data } = event;
  const amount = toNumericString(data.amount);
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
    recipient: String(data.recipient),
  });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleNetPnl(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      net_global_trader_pnl: toNumericString(data.pnl),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        net_global_trader_pnl: toNumericString(data.pnl),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handleClaimFeesTo(db: Db, event: ParsedEvent) {
  const { data } = event;
  const amount = toNumericString(data.amount);
  await db
    .update(vaultState)
    .set({
      unclaimed_fees: toNumericString(data.new_total),
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
    recipient: String(data.recipient),
  });
  await recomputeFreeLiquidity(db, event.ledger);
}

async function handlePause(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      is_paused: data.is_paused,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        is_paused: data.is_paused,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });

  await db.insert(pauseEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    contract: "vault",
    is_paused: data.is_paused,
    caller: String(data.caller),
  });
}
