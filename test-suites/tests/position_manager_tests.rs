use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};
use test_suites::testutils::{Fixture, BTC_PRICE, TEST_TIMESTAMP, USDC_UNIT};

const PRECISION: i128 = 10_000_000;
const DEFAULT_SIZE: i128 = 10_000 * USDC_UNIT;
const DEFAULT_COLLATERAL: i128 = 1_000 * USDC_UNIT;
const MIN_POSITION_LIFETIME: u64 = 60;

// ---------------------------------------------------------------------------
// PositionManager: Initialization
// ---------------------------------------------------------------------------

#[test]
fn test_position_manager_initialize_links_vault_and_config() {
    let env = Env::default();
    let f = Fixture::deploy(&env);
    // Verify contract is functional by calling a view
    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.long_open_interest, 0);
}

// ---------------------------------------------------------------------------
// PositionManager: increase_position
// ---------------------------------------------------------------------------

#[test]
fn test_increase_position_opens_long_and_reserves_usdc() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let pos = f
        .position_manager
        .get_position(&f.trader, &symbol_short!("BTC"));
    assert_eq!(pos.size, DEFAULT_SIZE);
    assert_eq!(pos.collateral, DEFAULT_COLLATERAL);
    assert!(pos.is_long);

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.long_open_interest, DEFAULT_SIZE);
}

#[test]
fn test_increase_position_opens_short_and_reserves_usdc() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &false,
    );

    let pos = f
        .position_manager
        .get_position(&f.trader, &symbol_short!("BTC"));
    assert!(!pos.is_long);

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.short_open_interest, DEFAULT_SIZE);
    assert_eq!(market.long_open_interest, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_increase_position_reverts_when_paused() {
    let env = Env::default();
    let f = Fixture::deploy(&env);
    f.position_manager.pause(&f.admin);
    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_increase_position_reverts_when_utilization_cap_breached() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Vault has 1M. 85% cap = 850k. Try to open 851k.
    let large_size = 851_000 * USDC_UNIT;
    let large_collateral = 85_100 * USDC_UNIT;
    f.usdc.mint(&f.trader, &large_collateral);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &large_size,
        &large_collateral,
        &true,
    );
}

#[test]
fn test_increase_position_records_last_increased_time() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let pos = f
        .position_manager
        .get_position(&f.trader, &symbol_short!("BTC"));
    assert_eq!(pos.last_increased_time, TEST_TIMESTAMP);
}

#[test]
fn test_increase_position_updates_global_long_avg_price() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.global_long_avg_price, BTC_PRICE);
}

// ---------------------------------------------------------------------------
// PositionManager: decrease_position
// ---------------------------------------------------------------------------

#[test]
fn test_decrease_position_closes_long_with_profit() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let balance_after_open = f.usdc.balance(&f.trader);

    // Advance time and raise price
    f.advance_time(TEST_TIMESTAMP + MIN_POSITION_LIFETIME + 11);
    let profit_price: i128 = 55_000 * PRECISION;
    f.mock_oracle.set_price(&symbol_short!("BTC"), &profit_price);

    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &DEFAULT_SIZE);

    let balance_after_close = f.usdc.balance(&f.trader);
    let received = balance_after_close - balance_after_open;
    assert!(received > DEFAULT_COLLATERAL, "Trader must profit");
}

#[test]
fn test_decrease_position_closes_long_with_loss() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let balance_after_open = f.usdc.balance(&f.trader);

    f.advance_time(TEST_TIMESTAMP + MIN_POSITION_LIFETIME + 11);
    let loss_price: i128 = 47_000 * PRECISION;
    f.mock_oracle.set_price(&symbol_short!("BTC"), &loss_price);

    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &DEFAULT_SIZE);

    let balance_after_close = f.usdc.balance(&f.trader);
    let received = balance_after_close - balance_after_open;
    assert!(received < DEFAULT_COLLATERAL, "Trader must lose");
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_decrease_position_reverts_before_min_lifetime() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    // Try to close immediately
    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &DEFAULT_SIZE);
}

#[test]
fn test_decrease_position_succeeds_even_when_paused() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    f.advance_time(TEST_TIMESTAMP + MIN_POSITION_LIFETIME + 11);
    f.mock_oracle.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    f.position_manager.pause(&f.admin);

    // Must NOT revert — decrease bypasses pause
    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &DEFAULT_SIZE);
}

// ---------------------------------------------------------------------------
// PositionManager: liquidate_position
// ---------------------------------------------------------------------------

#[test]
fn test_liquidate_position_succeeds_when_health_below_zero() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    // Crash price: pnl = 10k * (44k-50k)/50k = -1200, health = 1000 - 1200 = -200
    let crash_price: i128 = 44_000 * PRECISION;
    f.advance_time(TEST_TIMESTAMP + 75);
    f.mock_oracle.set_price(&symbol_short!("BTC"), &crash_price);

    f.position_manager
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.long_open_interest, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_liquidate_position_reverts_if_position_still_healthy() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    f.advance_time(TEST_TIMESTAMP + 75);
    f.mock_oracle.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    f.position_manager
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_liquidate_position_reverts_if_not_keeper() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let crash_price: i128 = 44_000 * PRECISION;
    f.advance_time(TEST_TIMESTAMP + 75);
    f.mock_oracle.set_price(&symbol_short!("BTC"), &crash_price);

    let random = Address::generate(&env);
    f.position_manager
        .liquidate_position(&random, &f.trader, &symbol_short!("BTC"));
}

// ---------------------------------------------------------------------------
// PositionManager: update_indices
// ---------------------------------------------------------------------------

#[test]
fn test_update_indices_increments_borrow_accumulator() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Open a position so there's utilization
    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let market_before = f.position_manager.get_market(&symbol_short!("BTC"));

    f.advance_time(TEST_TIMESTAMP + 3600); // 1 hour
    f.mock_oracle.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));

    let market_after = f.position_manager.get_market(&symbol_short!("BTC"));
    assert!(
        market_after.acc_borrow_index > market_before.acc_borrow_index,
        "Borrow index must increase"
    );
}

#[test]
fn test_update_indices_increments_funding_accumulator() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Open a long-only position to create OI imbalance
    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    let market_before = f.position_manager.get_market(&symbol_short!("BTC"));

    f.advance_time(TEST_TIMESTAMP + 3600);
    f.mock_oracle.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));

    let market_after = f.position_manager.get_market(&symbol_short!("BTC"));
    assert!(
        market_after.acc_funding_index != market_before.acc_funding_index,
        "Funding index must change with OI imbalance"
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_update_indices_reverts_if_not_keeper() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    let random = Address::generate(&env);
    f.position_manager
        .update_indices(&random, &symbol_short!("BTC"));
}

// ---------------------------------------------------------------------------
// PositionManager: deverage_position (ADL)
// ---------------------------------------------------------------------------

#[test]
fn test_deverage_position_succeeds_when_reserved_ratio_high() {
    // Use a small vault so we can breach 95% utilization.
    // Vault total_assets = vault USDC balance. We need reserved > 95% of that.
    // Strategy: deploy with standard 1M vault, open 84k position (84k reserved),
    // then manually set total_reserved to 960k (96% of 1M).
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Open a position first (this creates the position in storage)
    let size = 84_000 * USDC_UNIT;
    let collateral = 8_400 * USDC_UNIT;
    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &size,
        &collateral,
        &true,
    );

    // Vault total_assets is ~1M USDC. Push total_reserved to 960k (96%).
    // The vault's internal reserved_usdc was set to 84k by reserve_liquidity.
    // We push PM's total_reserved tracking to 960k to trigger the ADL check.
    // The ADL check computes: utilization = total_reserved * 10000 / total_assets
    // = 960_000 * 10000 / 1_000_000 = 9600 bps > 9500. Triggers ADL.
    f.env.as_contract(&f.pm_addr, || {
        position_manager::storage::set_total_reserved(f.env, 960_000 * USDC_UNIT);
    });

    f.advance_time(TEST_TIMESTAMP + 75);
    f.mock_oracle.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    f.position_manager
        .deverage_position(&f.keeper, &f.trader, &symbol_short!("BTC"));

    let market = f.position_manager.get_market(&symbol_short!("BTC"));
    assert_eq!(market.long_open_interest, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_deverage_position_reverts_when_adl_not_triggered() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );

    f.advance_time(TEST_TIMESTAMP + 75);
    f.mock_oracle.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    // 10k / 1M = 1% utilization — way below ADL thresholds
    f.position_manager
        .deverage_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_deverage_position_reverts_if_not_keeper() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    let random = Address::generate(&env);
    f.position_manager
        .deverage_position(&random, &f.trader, &symbol_short!("BTC"));
}
