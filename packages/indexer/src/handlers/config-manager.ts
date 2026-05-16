import { type Db, protocolConfig, roleEvents } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../convert.js";

const SINGLETON_ID = 1;

// Per-event data shapes. Field names mirror the #[contractevent] structs in
// contracts/config-manager/src/events.rs.

interface RoleChangeData {
  role: string;
  account: string;
  is_grant: boolean;
}

interface FeeSplitsUpdateData {
  lp_bps: number;
  dev_bps: number;
  staker_bps: number;
}

interface LimitsUpdateData {
  min_collateral: bigint;
  cooldown_duration: bigint;
  min_position_lifetime: bigint;
  max_utilization_ratio: bigint;
  funding_cut_bps: number;
  adl_pnl_bps: number;
  adl_utilization_bps: number;
  liquidation_threshold_bps: number;
}

interface BorrowRateUpdateData {
  base_borrow_rate_bps: bigint;
  slope1_bps: bigint;
  slope2_bps: bigint;
  optimal_utilization_bps: bigint;
  base_funding_rate_bps: bigint;
}

interface UpgradeTimelockUpdateData {
  timelock_seconds: bigint;
}

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
    case "upgtl":
      return handleUpgradeTimelock(db, event);
    default:
      break;
  }
}

/**
 * The upgrade timelock value flowing through ConfigManager. For now logged
 * only — adding a dedicated DB column requires schema migration; the value
 * is also queryable via get_upgrade_timelock so the monitoring path doesn't
 * strictly need this row.
 */
async function handleUpgradeTimelock(_db: Db, event: ParsedEvent) {
  const d = event.data as UpgradeTimelockUpdateData;
  console.log(
    `[config-manager] UpgradeTimelockUpdate ledger=${event.ledger} timelock_seconds=${d.timelock_seconds}`,
  );
}

async function handleFeeSplits(db: Db, event: ParsedEvent) {
  const d = event.data as FeeSplitsUpdateData;
  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      lp_bps: d.lp_bps,
      dev_bps: d.dev_bps,
      staker_bps: d.staker_bps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        lp_bps: d.lp_bps,
        dev_bps: d.dev_bps,
        staker_bps: d.staker_bps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleLimits(db: Db, event: ParsedEvent) {
  const d = event.data as LimitsUpdateData;
  await db
    .insert(protocolConfig)
    .values({
      id: SINGLETON_ID,
      min_collateral: toNumericString(d.min_collateral),
      cooldown_duration: toNumericString(d.cooldown_duration),
      min_position_lifetime: toNumericString(d.min_position_lifetime),
      max_utilization_ratio: toNumericString(d.max_utilization_ratio),
      funding_cut_bps: d.funding_cut_bps,
      adl_pnl_bps: d.adl_pnl_bps,
      adl_utilization_bps: d.adl_utilization_bps,
      liquidation_threshold_bps: d.liquidation_threshold_bps,
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: protocolConfig.id,
      set: {
        min_collateral: toNumericString(d.min_collateral),
        cooldown_duration: toNumericString(d.cooldown_duration),
        min_position_lifetime: toNumericString(d.min_position_lifetime),
        max_utilization_ratio: toNumericString(d.max_utilization_ratio),
        funding_cut_bps: d.funding_cut_bps,
        adl_pnl_bps: d.adl_pnl_bps,
        adl_utilization_bps: d.adl_utilization_bps,
        liquidation_threshold_bps: d.liquidation_threshold_bps,
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleBorrowRates(db: Db, event: ParsedEvent) {
  const d = event.data as BorrowRateUpdateData;
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

async function handleRole(db: Db, event: ParsedEvent) {
  const d = event.data as RoleChangeData;
  await db.insert(roleEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    role: d.role,
    account: d.account,
    is_grant: d.is_grant,
  });
}
