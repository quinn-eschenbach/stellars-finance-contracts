import { eq } from "drizzle-orm";
import { type Db, vaultState, vaultEvents, feeEvents, settleEvents, pauseEvents, lpTransfers } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../spec-parser.js";

const SINGLETON_ID = 1;

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
}

async function handleClaimFees(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .update(vaultState)
    .set({
      unclaimed_fees: "0",
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));

  await db.insert(feeEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    event_type: "claim",
    amount: toNumericString(data.amount),
    recipient: String(data.recipient),
  });
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
