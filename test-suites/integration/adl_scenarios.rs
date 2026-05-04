//! ADL (Auto-Deleverage) scenario integration tests.
//!
//! Tests the ADL mechanism that force-closes profitable positions when the
//! protocol is under stress (high PnL ratio or high utilization).

use soroban_sdk::{symbol_short, Env};
use test_suites::testutils::{Fixture, TEST_TIMESTAMP, USDC_UNIT};

// ---------------------------------------------------------------------------
// Helper: reconfigure ADL thresholds to make triggering feasible in tests
// ---------------------------------------------------------------------------

#[allow(dead_code)]
fn lower_adl_thresholds(f: &Fixture) {
    // Lower ADL thresholds so we can trigger ADL without extreme scenarios.
    // adl_pnl_bps: 1000 = 10% of total_assets
    // adl_utilization_bps: 5000 = 50% utilization
    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 1_000,
            adl_utilization_bps: 5_000,
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });
}

// ---------------------------------------------------------------------------
// ADL triggers via PnL ratio threshold
// ---------------------------------------------------------------------------

#[test]
fn test_adl_triggers_via_pnl_ratio() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Very low PnL threshold so we can trigger via PnL route
    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 200,            // 2% of total assets triggers ADL
            adl_utilization_bps: 9_500,   // keep util threshold high (won't trigger)
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    // Open a large position that we'll close at profit to push net_pnl up
    let trader_b = f.create_funded_trader(50_000 * USDC_UNIT);
    f.open_long(&trader_b, 400_000 * USDC_UNIT, 40_000 * USDC_UNIT);

    // Also open the ADL target
    let trader = f.create_funded_trader(20_000 * USDC_UNIT);
    f.open_long(&trader, 100_000 * USDC_UNIT, 10_000 * USDC_UNIT);

    // Price pumps 10% → trader_b PnL = 400k * 10% = 40k
    f.advance_time(TEST_TIMESTAMP + 200);
    f.set_btc_price(55_000);

    // Close trader_b to realize PnL and push net_global_trader_pnl up
    f.position_manager
        .decrease_position(&trader_b, &symbol_short!("BTC"), &(400_000 * USDC_UNIT));

    // net_pnl ≈ 40k. total_assets ≈ ~960k (1M - 40k profit paid out).
    // pnl_ratio = 40k * 10000 / 960k ≈ 416 bps > 200 bps threshold → triggers!

    let balance_before_adl = f.usdc.balance(&trader);
    f.position_manager
        .deleverage_position(&f.keeper, &trader, &symbol_short!("BTC"));

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.long_open_interest, 0, "ADL must fully close position");

    let balance_after_adl = f.usdc.balance(&trader);
    let payout = balance_after_adl - balance_before_adl;
    assert!(
        payout > 0,
        "ADL'd trader with profit must receive payout: payout={}",
        payout
    );
}

// ---------------------------------------------------------------------------
// ADL triggers via utilization threshold
// ---------------------------------------------------------------------------

#[test]
fn test_adl_triggers_via_utilization() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Set very low ADL utilization threshold so 80% utilization triggers it
    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,          // keep PnL threshold high
            adl_utilization_bps: 3_000,   // low: 30% utilization triggers ADL
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    // Open enough positions to exceed 30% utilization
    let trader = f.create_funded_trader(50_000 * USDC_UNIT);
    f.open_long(&trader, 400_000 * USDC_UNIT, 40_000 * USDC_UNIT);

    // Price up slightly so position is profitable (required for ADL)
    f.advance_time(TEST_TIMESTAMP + 75);
    f.set_btc_price(50_100);

    // utilization = 400k / 1M = 4000 bps > 3000 → ADL should trigger
    f.position_manager
        .deleverage_position(&f.keeper, &trader, &symbol_short!("BTC"));

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.long_open_interest, 0, "ADL via utilization must close position");
}

// ---------------------------------------------------------------------------
// ADL payout: trader with negative health gets 0
// ---------------------------------------------------------------------------

/// ADL on an underwater position (negative PnL) is now rejected by the
/// `AdlTargetNotProfitable` guard. Such positions should be liquidated instead.
#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_adl_payout_zero_when_health_negative() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 3_000,
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    let trader = f.create_funded_trader(50_000 * USDC_UNIT);
    f.open_long(&trader, 400_000 * USDC_UNIT, 40_000 * USDC_UNIT);

    // 15% crash → PnL = 400k * -15% = -60k < 0 → AdlTargetNotProfitable
    f.advance_time(TEST_TIMESTAMP + 75);
    f.set_btc_price(42_500);

    // Should panic with AdlTargetNotProfitable (#17)
    f.position_manager
        .deleverage_position(&f.keeper, &trader, &symbol_short!("BTC"));
}

// ---------------------------------------------------------------------------
// ADL reduces OI correctly
// ---------------------------------------------------------------------------

#[test]
fn test_adl_reduces_oi() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 3_000,
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    let trader_a = f.create_funded_trader(50_000 * USDC_UNIT);
    let trader_b = f.create_funded_trader(20_000 * USDC_UNIT);

    f.open_long(&trader_a, 300_000 * USDC_UNIT, 30_000 * USDC_UNIT);
    f.open_short(&trader_b, 100_000 * USDC_UNIT, 10_000 * USDC_UNIT);

    let market_before = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market_before.long_open_interest, 300_000 * USDC_UNIT);
    assert_eq!(market_before.short_open_interest, 100_000 * USDC_UNIT);

    // Price up slightly so long position is profitable (required for ADL)
    f.advance_time(TEST_TIMESTAMP + 75);
    f.set_btc_price(50_100);

    // ADL the long position (utilization > 30%)
    f.position_manager
        .deleverage_position(&f.keeper, &trader_a, &symbol_short!("BTC"));

    let market_after = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(
        market_after.long_open_interest, 0,
        "ADL'd position must be removed from long OI"
    );
    assert_eq!(
        market_after.short_open_interest,
        100_000 * USDC_UNIT,
        "Non-ADL'd short OI must remain"
    );
}

// ---------------------------------------------------------------------------
// Multiple ADLs in sequence
// ---------------------------------------------------------------------------

#[test]
fn test_adl_cascade_multiple_positions() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 2_100, // low: 21% — chosen so third ADL at ~200k/1M ≈ 20% fails
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    let trader_a = f.create_funded_trader(30_000 * USDC_UNIT);
    let trader_b = f.create_funded_trader(30_000 * USDC_UNIT);
    let trader_c = f.create_funded_trader(30_000 * USDC_UNIT);

    f.open_long(&trader_a, 200_000 * USDC_UNIT, 20_000 * USDC_UNIT);
    f.open_long(&trader_b, 200_000 * USDC_UNIT, 20_000 * USDC_UNIT);
    f.open_long(&trader_c, 200_000 * USDC_UNIT, 20_000 * USDC_UNIT);

    // Price up slightly so long positions are profitable (required for ADL)
    f.advance_time(TEST_TIMESTAMP + 75);
    f.set_btc_price(50_100);

    // Total utilization = 600k / 1M = 60% > 20% threshold
    // ADL all three sequentially
    f.position_manager
        .deleverage_position(&f.keeper, &trader_a, &symbol_short!("BTC"));

    // After first ADL, utilization = 400k/1M = 40% > 20%, still triggers
    f.position_manager
        .deleverage_position(&f.keeper, &trader_b, &symbol_short!("BTC"));

    // After second ADL, utilization = 200k/1M = 20% <= 20%, should NOT trigger
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        f.position_manager
            .deleverage_position(&f.keeper, &trader_c, &symbol_short!("BTC"));
    }));
    assert!(
        result.is_err(),
        "Third ADL should fail — utilization now at threshold"
    );

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(
        market.long_open_interest,
        200_000 * USDC_UNIT,
        "Only trader_c's position should remain"
    );
}

// ---------------------------------------------------------------------------
// ADL on short position
// ---------------------------------------------------------------------------

#[test]
fn test_adl_short_position() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 3_000,
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    let trader = f.create_funded_trader(50_000 * USDC_UNIT);
    f.open_short(&trader, 400_000 * USDC_UNIT, 40_000 * USDC_UNIT);

    // Price down slightly so short position is profitable (required for ADL)
    f.advance_time(TEST_TIMESTAMP + 75);
    f.set_btc_price(49_900);

    let balance_before = f.usdc.balance(&trader);

    // util = 400k/1M = 40% > 30% → triggers ADL
    f.position_manager
        .deleverage_position(&f.keeper, &trader, &symbol_short!("BTC"));

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.short_open_interest, 0, "ADL must close short position");

    let balance_after = f.usdc.balance(&trader);
    let payout = balance_after - balance_before;
    // At slightly lower price, PnL > 0, so payout ≈ collateral + small profit - borrow fees
    assert!(
        payout > 0 && payout <= 41_000 * USDC_UNIT,
        "Short ADL payout must be roughly collateral plus small profit minus fees: payout={}",
        payout
    );
}
