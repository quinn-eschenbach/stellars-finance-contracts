import { type Db, protocolConfig, roleEvents } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../spec-parser.js";

const SINGLETON_ID = 1;

export async function handleConfigManagerEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    case "feecfg":
      return handleFeeSplits(db, event);
    case "limits":
      return handleLimits(db, event);
    case "rates":
      return handleBorrowRates(db, event);
    case "role":
      return handleRole(db, event);
    default:
      break;
  }
}

async function handleFeeSplits(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      keeper_bps: data.keeper_bps,
      dev_bps: data.dev_bps,
      lp_bps: data.lp_bps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        keeper_bps: data.keeper_bps,
        dev_bps: data.dev_bps,
        lp_bps: data.lp_bps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleLimits(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      min_collateral: toNumericString(data.min_collateral),
      cooldown_duration: toNumericString(data.cooldown_duration),
      min_position_lifetime: toNumericString(data.min_position_lifetime),
      max_utilization_ratio: toNumericString(data.max_utilization_ratio),
      funding_cut_bps: data.funding_cut_bps,
      adl_pnl_bps: data.adl_pnl_bps,
      adl_utilization_bps: data.adl_utilization_bps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        min_collateral: toNumericString(data.min_collateral),
        cooldown_duration: toNumericString(data.cooldown_duration),
        min_position_lifetime: toNumericString(data.min_position_lifetime),
        max_utilization_ratio: toNumericString(data.max_utilization_ratio),
        funding_cut_bps: data.funding_cut_bps,
        adl_pnl_bps: data.adl_pnl_bps,
        adl_utilization_bps: data.adl_utilization_bps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleBorrowRates(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      base_borrow_rate_bps: toNumericString(data.base_borrow_rate_bps),
      slope1_bps: toNumericString(data.slope1_bps),
      slope2_bps: toNumericString(data.slope2_bps),
      optimal_utilization_bps: toNumericString(data.optimal_utilization_bps),
      base_funding_rate_bps: toNumericString(data.base_funding_rate_bps),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        base_borrow_rate_bps: toNumericString(data.base_borrow_rate_bps),
        slope1_bps: toNumericString(data.slope1_bps),
        slope2_bps: toNumericString(data.slope2_bps),
        optimal_utilization_bps: toNumericString(data.optimal_utilization_bps),
        base_funding_rate_bps: toNumericString(data.base_funding_rate_bps),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleRole(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(roleEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    role: String(data.role),
    account: String(data.account),
    is_grant: data.is_grant,
  });
}
