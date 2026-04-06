import { type Db, protocolConfig } from "@stellars/db";
import type { ParsedEvent } from "../parser.js";
import { toNumericString } from "../parser.js";

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
      break;
    default:
      break;
  }
}

async function handleFeeSplits(db: Db, event: ParsedEvent) {
  const d = event.data as { keeper_bps: number; dev_bps: number; lp_bps: number };

  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      keeper_bps: d.keeper_bps,
      dev_bps: d.dev_bps,
      lp_bps: d.lp_bps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        keeper_bps: d.keeper_bps,
        dev_bps: d.dev_bps,
        lp_bps: d.lp_bps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleLimits(db: Db, event: ParsedEvent) {
  const d = event.data as {
    min_collateral: unknown; cooldown_duration: unknown; min_position_lifetime: unknown;
    max_utilization_ratio: unknown; funding_cut_bps: number; adl_pnl_bps: number; adl_utilization_bps: number;
  };

  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      min_collateral: toNumericString(d.min_collateral),
      cooldown_duration: BigInt(toNumericString(d.cooldown_duration)),
      min_position_lifetime: BigInt(toNumericString(d.min_position_lifetime)),
      max_utilization_ratio: toNumericString(d.max_utilization_ratio),
      funding_cut_bps: d.funding_cut_bps,
      adl_pnl_bps: d.adl_pnl_bps,
      adl_utilization_bps: d.adl_utilization_bps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        min_collateral: toNumericString(d.min_collateral),
        cooldown_duration: BigInt(toNumericString(d.cooldown_duration)),
        min_position_lifetime: BigInt(toNumericString(d.min_position_lifetime)),
        max_utilization_ratio: toNumericString(d.max_utilization_ratio),
        funding_cut_bps: d.funding_cut_bps,
        adl_pnl_bps: d.adl_pnl_bps,
        adl_utilization_bps: d.adl_utilization_bps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleBorrowRates(db: Db, event: ParsedEvent) {
  const d = event.data as {
    base_borrow_rate_bps: unknown; slope1_bps: unknown; slope2_bps: unknown;
    optimal_utilization_bps: unknown; base_funding_rate_bps: unknown;
  };

  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      base_borrow_rate_bps: toNumericString(d.base_borrow_rate_bps),
      slope1_bps: toNumericString(d.slope1_bps),
      slope2_bps: toNumericString(d.slope2_bps),
      optimal_utilization_bps: toNumericString(d.optimal_utilization_bps),
      base_funding_rate_bps: toNumericString(d.base_funding_rate_bps),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        base_borrow_rate_bps: toNumericString(d.base_borrow_rate_bps),
        slope1_bps: toNumericString(d.slope1_bps),
        slope2_bps: toNumericString(d.slope2_bps),
        optimal_utilization_bps: toNumericString(d.optimal_utilization_bps),
        base_funding_rate_bps: toNumericString(d.base_funding_rate_bps),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}
