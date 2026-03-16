import { eq } from "drizzle-orm";
import { type Db, vaultState, vaultEvents, feeEvents } from "@stellars/db";
import type { ParsedEvent } from "../parser.js";

const SINGLETON_ID = 1;

export async function handleVaultEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    case "deposit":
      return handleDeposit(db, event);
    case "withdraw":
      return handleWithdraw(db, event);
    case "mint":
      return handleMint(db, event);
    case "redeem":
      return handleRedeem(db, event);
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
  const receiver = String(event.topic1);
  const [assets, shares, from] = event.data as [bigint, bigint, string];

  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    event_type: "deposit",
    user: receiver,
    assets: String(assets),
    shares: String(shares),
  });
}

async function handleWithdraw(db: Db, event: ParsedEvent) {
  const owner = String(event.topic1);
  const [assets, shares, receiver] = event.data as [bigint, bigint, string];

  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    event_type: "withdraw",
    user: owner,
    assets: String(assets),
    shares: String(shares),
  });
}

async function handleMint(db: Db, event: ParsedEvent) {
  const receiver = String(event.topic1);
  const [shares, assets, from] = event.data as [bigint, bigint, string];

  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    event_type: "mint",
    user: receiver,
    assets: String(assets),
    shares: String(shares),
  });
}

async function handleRedeem(db: Db, event: ParsedEvent) {
  const owner = String(event.topic1);
  const [shares, assets, receiver] = event.data as [bigint, bigint, string];

  await db.insert(vaultEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    event_type: "redeem",
    user: owner,
    assets: String(assets),
    shares: String(shares),
  });
}

async function handleSettle(_db: Db, _event: ParsedEvent) {
  // settle_pnl updates vault state but we track vault_state via reserve/release
  // The detailed info is already captured in PM trade events
}

async function handleReserve(db: Db, event: ParsedEvent) {
  const [_amount, newTotal] = event.data as [bigint, bigint];

  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      reserved_usdc: String(newTotal),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        reserved_usdc: String(newTotal),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleRelease(db: Db, event: ParsedEvent) {
  const [_amount, newTotal] = event.data as [bigint, bigint];

  await db
    .update(vaultState)
    .set({
      reserved_usdc: String(newTotal),
      updated_at_ledger: event.ledger,
      updated_at: new Date(),
    })
    .where(eq(vaultState.id, SINGLETON_ID));
}

async function handleAccrueFees(db: Db, event: ParsedEvent) {
  const [amount, newTotal] = event.data as [bigint, bigint];

  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      unclaimed_fees: String(newTotal),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        unclaimed_fees: String(newTotal),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });

  await db.insert(feeEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    event_type: "accrue",
    amount: String(amount),
  });
}

async function handleClaimFees(db: Db, event: ParsedEvent) {
  const [amount, recipient] = event.data as [bigint, string];

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
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    event_type: "claim",
    amount: String(amount),
    recipient: String(recipient),
  });
}

async function handlePause(db: Db, event: ParsedEvent) {
  const [isPaused] = event.data as [boolean, string];

  await db
    .insert(vaultState)
    .values({
      id: SINGLETON_ID,
      is_paused: isPaused,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: vaultState.id,
      set: {
        is_paused: isPaused,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}
