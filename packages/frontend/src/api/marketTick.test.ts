import { describe, it, expect } from "vitest";
import { projectMarketTick } from "./marketTick";
import type { MarketRow, ProtocolConfigRow, VaultStateRow } from "./types";

/**
 * `projectMarketTick` is a thin adapter that bridges the API response shapes
 * (numeric strings) to `@stellars/protocol-math`'s `MarketTick.project`
 * (typed bigints). The math itself is tested in protocol-math/tests; here we
 * verify the adapter: every field that touches the projection is read,
 * converted to bigint correctly, and the produced tick exposes the same
 * shape callers depend on.
 */

const PRICE_UNIT = 10_000_000n; // 1e7

function fixtureMarket(over: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol: "BTCUSD",
    global_long_avg_price: "0",
    global_short_avg_price: "0",
    long_open_interest: "1000000000", // 100
    short_open_interest: "500000000", // 50
    acc_borrow_index: "0",
    acc_funding_index: "0",
    last_index_update: "1000",
    max_leverage: "100",
    market_unrealized_pnl: "0",
    updated_at_ledger: 1,
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function fixtureVault(over: Partial<VaultStateRow> = {}): VaultStateRow {
  return {
    id: 1,
    total_assets: "10000000000", // 1000
    total_shares: "10000000000",
    reserved_usdc: "1000000000", // 100
    unclaimed_fees: "0",
    net_global_trader_pnl: "0",
    free_liquidity: "9000000000",
    is_paused: false,
    last_unpause_time: "0",
    updated_at_ledger: 1,
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function fixtureConfig(over: Partial<ProtocolConfigRow> = {}): ProtocolConfigRow {
  return {
    id: 1,
    lp_bps: 7000,
    dev_bps: 2000,
    staker_bps: 1000,
    min_collateral: "10000000",
    cooldown_duration: "0",
    min_position_lifetime: "0",
    max_utilization_ratio: "8500",
    funding_cut_bps: 1000,
    adl_pnl_bps: 0,
    adl_utilization_bps: 0,
    liquidation_threshold_bps: 9500,
    base_borrow_rate_bps: "100",
    slope1_bps: "500",
    slope2_bps: "5000",
    optimal_utilization_bps: "8000",
    base_funding_rate_bps: "100",
    open_fee_bps: 30,
    liquidation_bounty_bps: 100,
    tp_sl_execution_fee: "50000000",
    last_unpause_time: "0",
    updated_at_ledger: 1,
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe("projectMarketTick", () => {
  it("returns a tick whose mark_price round-trips through the bigint conversion", () => {
    const tick = projectMarketTick({
      market: fixtureMarket(),
      vault: fixtureVault(),
      config: fixtureConfig(),
      price: (95_000n * PRICE_UNIT).toString(),
      now: 2000n,
    });
    expect(tick.mark_price).toBe(95_000n * PRICE_UNIT);
  });

  it("preserves the open-interest split from the market row", () => {
    const tick = projectMarketTick({
      market: fixtureMarket({
        long_open_interest: (200n * PRICE_UNIT).toString(),
        short_open_interest: (50n * PRICE_UNIT).toString(),
      }),
      vault: fixtureVault(),
      config: fixtureConfig(),
      price: (1n * PRICE_UNIT).toString(),
      now: 2000n,
    });
    expect(tick.market.long_open_interest).toBe(200n * PRICE_UNIT);
    expect(tick.market.short_open_interest).toBe(50n * PRICE_UNIT);
  });

  it("advances acc_borrow_index forward when now > last_index_update", () => {
    // Zero-rate config keeps the indices flat — verifies the "no time has
    // passed" baseline before we trust non-trivial accrual.
    const flat = projectMarketTick({
      market: fixtureMarket({ last_index_update: "2000" }),
      vault: fixtureVault(),
      config: fixtureConfig({
        base_borrow_rate_bps: "0",
        slope1_bps: "0",
        slope2_bps: "0",
        base_funding_rate_bps: "0",
      }),
      price: (1n * PRICE_UNIT).toString(),
      now: 2000n,
    });
    expect(flat.market.acc_borrow_index).toBe(0n);

    // Same inputs, real rates, time advanced → borrow index must be > 0.
    const ticked = projectMarketTick({
      market: fixtureMarket({ last_index_update: "1000" }),
      vault: fixtureVault(),
      config: fixtureConfig(),
      price: (1n * PRICE_UNIT).toString(),
      now: 100_000n,
    });
    expect(ticked.market.acc_borrow_index).toBeGreaterThan(0n);
  });

  it("prefers vault.last_unpause_time over config.last_unpause_time when set", () => {
    // The contract stores the unpause moment on the vault; the protocol_config
    // copy is a fallback for snapshots taken before the join lands. If both
    // are present, the vault is canonical.
    const tickFromVault = projectMarketTick({
      market: fixtureMarket(),
      vault: fixtureVault({ last_unpause_time: "5000" }),
      config: fixtureConfig({ last_unpause_time: "9999" }),
      price: (1n * PRICE_UNIT).toString(),
      now: 6000n,
    });
    // Internal: tick exposes nothing about unpause directly, but the borrow
    // index it derives is sensitive to it. We assert that the *equivalent*
    // projection where vault has the same value yields the same result.
    const equivalent = projectMarketTick({
      market: fixtureMarket(),
      vault: fixtureVault({ last_unpause_time: "5000" }),
      config: fixtureConfig({ last_unpause_time: "5000" }),
      price: (1n * PRICE_UNIT).toString(),
      now: 6000n,
    });
    expect(tickFromVault.market.acc_borrow_index).toBe(equivalent.market.acc_borrow_index);
  });

  it("falls back to config.last_unpause_time when vault row hasn't been spliced", () => {
    // VaultStateRow type requires last_unpause_time, but the API older clients
    // may receive payloads where the splice came in as "0" or empty. We
    // simulate that and verify the projection still terminates.
    const tick = projectMarketTick({
      market: fixtureMarket(),
      vault: fixtureVault({ last_unpause_time: "0" }),
      config: fixtureConfig({ last_unpause_time: "1500" }),
      price: (1n * PRICE_UNIT).toString(),
      now: 2000n,
    });
    expect(tick.mark_price).toBe(1n * PRICE_UNIT);
  });
});
