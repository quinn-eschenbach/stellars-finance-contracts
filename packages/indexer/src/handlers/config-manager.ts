import { eq } from "drizzle-orm";
import { type Db, protocolConfig } from "@stellars/db";
import type { ParsedEvent } from "../parser.js";

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
      // Role changes don't need DB state — they're auth-layer only
      break;
    default:
      break;
  }
}

async function handleFeeSplits(db: Db, event: ParsedEvent) {
  const [keeperBps, devBps, lpBps] = event.data as [number, number, number];

  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      keeper_bps: keeperBps,
      dev_bps: devBps,
      lp_bps: lpBps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        keeper_bps: keeperBps,
        dev_bps: devBps,
        lp_bps: lpBps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleLimits(db: Db, event: ParsedEvent) {
  const [minCollateral, cooldownDuration, minPositionLifetime, maxUtilizationRatio, fundingCutBps, adlPnlBps, adlUtilizationBps] =
    event.data as [bigint, bigint, bigint, bigint, number, number, number];

  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      min_collateral: String(minCollateral),
      cooldown_duration: BigInt(cooldownDuration),
      min_position_lifetime: BigInt(minPositionLifetime),
      max_utilization_ratio: String(maxUtilizationRatio),
      funding_cut_bps: fundingCutBps,
      adl_pnl_bps: adlPnlBps,
      adl_utilization_bps: adlUtilizationBps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        min_collateral: String(minCollateral),
        cooldown_duration: BigInt(cooldownDuration),
        min_position_lifetime: BigInt(minPositionLifetime),
        max_utilization_ratio: String(maxUtilizationRatio),
        funding_cut_bps: fundingCutBps,
        adl_pnl_bps: adlPnlBps,
        adl_utilization_bps: adlUtilizationBps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleBorrowRates(db: Db, event: ParsedEvent) {
  const [baseBorrowRateBps, slope1Bps, slope2Bps, optimalUtilizationBps, baseFundingRateBps] =
    event.data as [bigint, bigint, bigint, bigint, bigint];

  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      base_borrow_rate_bps: String(baseBorrowRateBps),
      slope1_bps: String(slope1Bps),
      slope2_bps: String(slope2Bps),
      optimal_utilization_bps: String(optimalUtilizationBps),
      base_funding_rate_bps: String(baseFundingRateBps),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        base_borrow_rate_bps: String(baseBorrowRateBps),
        slope1_bps: String(slope1Bps),
        slope2_bps: String(slope2Bps),
        optimal_utilization_bps: String(optimalUtilizationBps),
        base_funding_rate_bps: String(baseFundingRateBps),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}
