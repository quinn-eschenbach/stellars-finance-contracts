// ---------------------------------------------------------------------------
// Tests for: liquidate_position
//
// These tests are written BEFORE the implementation (TDD). They MUST compile
// but are expected to FAIL until liquidate_position is fully implemented.
//
// The function under test:
//   fn liquidate_position(env, caller, trader, symbol)
//
// Behavior:
//   - KEEPER-only (caller.require_auth + require_keeper)
//   - Requires initialized + NOT paused
//   - Reverts PositionNotFound (error 6) if no position exists
//   - Fetches mark price from oracle
//   - Calculates health: collateral + unrealized_pnl - borrow_fee + funding_fee
//   - If health >= 0 => reverts HealthFactorOk (error 9)
//   - If health < 0 => liquidate:
//       Seize collateral, settle loss via vault, delete position,
//       decrease OI, decrease total_reserved, release vault liquidity,
//       accrue protocol fees via vault.
// ---------------------------------------------------------------------------

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger, LedgerInfo},
    vec, Address, Env, Symbol,
};

use crate::contract::PositionManagerContract;
use crate::math::PRECISION;
use crate::storage;
use crate::PositionManagerClient;

use config_manager::{ConfigManagerClient, ConfigManagerContract};
use mock_oracle::{MockOracle, MockOracleClient};
use mock_token::{MockToken, MockTokenClient};
use oracle_router::{OracleConfig, OracleRouterClient, OracleRouterContract};
use vault::{VaultContract, VaultContractClient};

// ===========================================================================
// Constants
// ===========================================================================

/// BTC price: $50,000 scaled by 1e7
const BTC_PRICE: i128 = 50_000 * PRECISION;

/// 1 USDC = 1_000_000 (6 decimals)
const USDC_UNIT: i128 = 1_000_000;

/// Trader starts with 100,000 USDC
const TRADER_BALANCE: i128 = 100_000 * USDC_UNIT;

/// Initial vault deposit (1,000,000 USDC) -- large enough for tests
const VAULT_DEPOSIT: i128 = 1_000_000 * USDC_UNIT;

/// Default position size: 10,000 USDC notional
const DEFAULT_SIZE: i128 = 10_000 * USDC_UNIT;

/// Default collateral: 1,000 USDC (10x leverage)
const DEFAULT_COLLATERAL: i128 = 1_000 * USDC_UNIT;

/// Ledger timestamp used in tests
const TEST_TIMESTAMP: u64 = 1_700_000_000;

/// Min position lifetime (60s) + oracle cache (10s) + buffer
const TIME_ADVANCE: u64 = 75;

// ===========================================================================
// Test fixture
// ===========================================================================

struct TestFixture<'a> {
    env: Env,
    pm_client: PositionManagerClient<'a>,
    _vault_client: VaultContractClient<'a>,
    oracle_client: MockOracleClient<'a>,
    _oracle_router_client: OracleRouterClient<'a>,
    _config_client: ConfigManagerClient<'a>,
    usdc_client: MockTokenClient<'a>,
    _usdc_addr: Address,
    admin: Address,
    keeper: Address,
    trader: Address,
    pm_addr: Address,
    _vault_addr: Address,
}

/// Deploy and wire up ALL protocol contracts needed for liquidation tests.
///
/// Includes a dedicated `keeper` address with the KEEPER role, separate from admin.
fn setup_full<'a>() -> TestFixture<'a> {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(LedgerInfo {
        timestamp: TEST_TIMESTAMP,
        protocol_version: 23,
        sequence_number: 100,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 10_000_000,
    });

    let admin = Address::generate(&env);
    let keeper = Address::generate(&env);
    let trader = Address::generate(&env);
    let lp = Address::generate(&env);

    // --- 1. ConfigManager ---
    let config_id = env.register(ConfigManagerContract, ());
    let config_client = ConfigManagerClient::new(&env, &config_id);
    config_client.initialize(&admin);

    let pauser_role = Symbol::new(&env, "PAUSER");
    let keeper_role = Symbol::new(&env, "KEEPER");
    let _admin_role = Symbol::new(&env, "ADMIN");
    config_client.grant_role(&admin, &pauser_role, &admin);
    config_client.grant_role(&admin, &keeper_role, &admin);
    // Grant KEEPER to the dedicated keeper address
    config_client.grant_role(&admin, &keeper_role, &keeper);

    config_client.update_protocol_limits(
        &admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 9_500,
        },
    );

    config_client.update_borrow_rate_config(
        &admin,
        &config_manager::BorrowRateConfig {
            base_borrow_rate_bps: 100,
            slope1_bps: 500,
            slope2_bps: 5_000,
            optimal_utilization_bps: 8_000,
            base_funding_rate_bps: 100,
        },
    );

    config_client.update_fee_splits(
        &admin,
        &config_manager::FeeSplits {
            keeper_bps: 500,
            dev_bps: 500,
            lp_bps: 9000,
        },
    );

    // --- 2. MockToken (USDC) ---
    let usdc_id = env.register(MockToken, ());
    let usdc_client = MockTokenClient::new(&env, &usdc_id);
    usdc_client.initialize(
        &admin,
        &6u32,
        &soroban_sdk::String::from_str(&env, "USD Coin"),
        &soroban_sdk::String::from_str(&env, "USDC"),
    );

    // --- 3. MockOracle ---
    let oracle_id = env.register(MockOracle, ());
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.initialize();
    oracle_client.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    // --- 4. OracleRouter ---
    let oracle_router_id = env.register(OracleRouterContract, ());
    let oracle_router_client = OracleRouterClient::new(&env, &oracle_router_id);
    oracle_router_client.initialize(&config_id);
    oracle_router_client.set_oracle_config(
        &admin,
        &OracleConfig {
            max_deviation_bps: 500,
            staleness_threshold: 3600,
            cache_duration: 10,
        },
    );
    oracle_router_client.set_oracle_sources(
        &admin,
        &symbol_short!("BTC"),
        &vec![&env, oracle_id.clone()],
        &vec![&env],
    );

    // --- 5. PositionManager ---
    let pm_id = env.register(PositionManagerContract, ());
    let pm_client = PositionManagerClient::new(&env, &pm_id);

    // --- 6. Vault ---
    let vault_id = env.register(VaultContract, ());
    let vault_client = VaultContractClient::new(&env, &vault_id);
    vault_client.initialize(&admin, &usdc_id, &config_id, &pm_id);

    // --- 7. Initialize PositionManager ---
    pm_client.initialize(&admin, &vault_id, &config_id, &oracle_router_id);
    pm_client.set_max_leverage(&admin, &symbol_short!("BTC"), &100_i128);

    // --- Fund accounts ---
    usdc_client.mint(&trader, &TRADER_BALANCE);
    usdc_client.mint(&lp, &VAULT_DEPOSIT);
    vault_client.deposit(&VAULT_DEPOSIT, &lp, &lp, &lp);

    // SAFETY: env lives in the fixture; clients borrow from it.
    let pm_client = unsafe { core::mem::transmute(pm_client) };
    let _vault_client = unsafe { core::mem::transmute(vault_client) };
    let oracle_client = unsafe { core::mem::transmute(oracle_client) };
    let _oracle_router_client = unsafe { core::mem::transmute(oracle_router_client) };
    let _config_client = unsafe { core::mem::transmute(config_client) };
    let usdc_client = unsafe { core::mem::transmute(usdc_client) };

    TestFixture {
        env,
        pm_client,
        _vault_client,
        oracle_client,
        _oracle_router_client,
        _config_client,
        usdc_client,
        _usdc_addr: usdc_id,
        admin,
        keeper,
        trader,
        pm_addr: pm_id,
        _vault_addr: vault_id,
    }
}

// ===========================================================================
// Helpers
// ===========================================================================

/// Open a long BTC position for the fixture's trader with given size and collateral.
fn open_long_position(f: &TestFixture, size: i128, collateral: i128) {
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &size,
        &collateral,
        &true,
        &0,
        &0,
    );
}

/// Open a short BTC position for the fixture's trader.
fn open_short_position(f: &TestFixture, size: i128, collateral: i128) {
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &size,
        &collateral,
        &false,
        &0,
        &0,
    );
}

/// Advance time and refresh oracle price. This ensures the oracle cache is
/// invalidated so the new price is fetched on the next call.
fn advance_time_and_set_price(f: &TestFixture, new_ts: u64, new_price: i128) {
    f.env.ledger().set(LedgerInfo {
        timestamp: new_ts,
        protocol_version: 23,
        sequence_number: 100 + ((new_ts - TEST_TIMESTAMP) as u32),
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 10_000_000,
    });
    f.oracle_client.set_price(&symbol_short!("BTC"), &new_price);
}

/// Seed the market with non-zero borrow index to simulate accumulated fees.
/// Must be called BEFORE opening a position so the position snapshots the index.
fn _seed_market_borrow_index(f: &TestFixture, borrow_index: i128) {
    let symbol = symbol_short!("BTC");
    f.env.as_contract(&f.pm_addr, || {
        let mut market = storage::get_market(&f.env, &symbol);
        market.acc_borrow_index = borrow_index;
        market.last_index_update = f.env.ledger().timestamp();
        storage::set_market(&f.env, &symbol, &market);
    });
}

// ===========================================================================
// 1. Guard tests
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_liquidate_reverts_not_initialized() {
    // Scenario: Call liquidate_position on a contract that has NOT been initialized.
    // Must revert with NotInitialized (error 2).
    let env = Env::default();
    env.mock_all_auths();

    let pm_id = env.register(PositionManagerContract, ());
    let pm_client = PositionManagerClient::new(&env, &pm_id);

    let caller = Address::generate(&env);
    let trader = Address::generate(&env);

    pm_client.liquidate_position(&caller, &trader, &symbol_short!("BTC"));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_liquidate_reverts_unauthorized_caller() {
    // Scenario: A non-KEEPER address attempts to liquidate. Must revert with
    // the shared Unauthorized error (error 3 from shared::require_role).
    let f = setup_full();
    let random_caller = Address::generate(&f.env);

    // Open a position first so the revert is specifically about auth, not missing position.
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Advance time and crash price so position is underwater
    let crash_price: i128 = 40_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, crash_price);

    // random_caller does NOT have KEEPER role
    f.pm_client
        .liquidate_position(&random_caller, &f.trader, &symbol_short!("BTC"));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_liquidate_reverts_position_not_found() {
    // Scenario: Keeper calls liquidate on a trader who has no open position.
    // Must revert with PositionNotFound (error 6).
    let f = setup_full();
    let nonexistent_trader = Address::generate(&f.env);

    f.pm_client
        .liquidate_position(&f.keeper, &nonexistent_trader, &symbol_short!("BTC"));
}

// ===========================================================================
// 2. Health check -- position is still healthy
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_liquidate_reverts_health_factor_ok_price_unchanged() {
    // Scenario: Price has not moved. The position has full collateral and zero PnL,
    // so health = collateral > 0. Must revert HealthFactorOk (error 9).
    let f = setup_full();
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Advance time but keep the same price
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, BTC_PRICE);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_liquidate_reverts_health_factor_ok_price_up_long() {
    // Scenario: Long position with price rising. The position is profitable,
    // so health = collateral + positive_pnl > 0. Must revert HealthFactorOk (error 9).
    let f = setup_full();
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Price goes up from $50,000 to $55,000
    let higher_price: i128 = 55_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, higher_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

// ===========================================================================
// 3. Successful liquidation
// ===========================================================================

#[test]
fn test_liquidate_long_position_price_drops_significantly() {
    // Scenario: Long BTC position opened at $50,000 with 1,000 USDC collateral
    // and 10,000 USDC size (10x leverage).
    //
    // Price drops to $44,000:
    //   unrealized_pnl = 10,000 * (44,000 - 50,000) / 50,000 = -1,200 USDC
    //   health = 1,000 + (-1,200) - borrow_fee + funding_fee
    //   With fresh indices (borrow_fee ~ 0, funding_fee ~ 0):
    //   health = 1,000 - 1,200 = -200 (underwater)
    //
    // Expected: position deleted, OI decreased, total_reserved decreased.
    let f = setup_full();
    let symbol = symbol_short!("BTC");
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Verify position exists
    let pos_before = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(
        pos_before.size, DEFAULT_SIZE,
        "Position must exist before liquidation"
    );

    // Crash price
    let crash_price: i128 = 44_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, crash_price);

    // Record state before liquidation
    let market_before = f.pm_client.get_market(&symbol);
    let total_reserved_before = f
        .env
        .as_contract(&f.pm_addr, || f._vault_client.reserved_usdc());

    // Execute liquidation
    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    // Position must be deleted
    // Attempting to get_position should panic with PositionNotFound.
    // We verify by checking storage directly instead.
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted after liquidation");
    });

    // Market OI must decrease
    let market_after = f.pm_client.get_market(&symbol);
    assert_eq!(
        market_after.long_open_interest,
        market_before.long_open_interest - DEFAULT_SIZE,
        "Long OI must decrease by position size after liquidation"
    );

    // Total reserved must decrease
    let total_reserved_after = f
        .env
        .as_contract(&f.pm_addr, || f._vault_client.reserved_usdc());
    assert_eq!(
        total_reserved_after,
        total_reserved_before - DEFAULT_SIZE,
        "Total reserved must decrease by position size after liquidation"
    );
}

#[test]
fn test_liquidate_short_position_price_rises_significantly() {
    // Scenario: Short BTC position opened at $50,000 with 1,000 USDC collateral
    // and 10,000 USDC size.
    //
    // Price rises to $56,000:
    //   unrealized_pnl = 10,000 * (50,000 - 56,000) / 50,000 = -1,200 USDC
    //   health = 1,000 - 1,200 = -200 (underwater)
    let f = setup_full();
    let symbol = symbol_short!("BTC");
    open_short_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Price rises sharply
    let spike_price: i128 = 56_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, spike_price);

    // Execute liquidation
    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "Short position must be deleted after liquidation"
        );
    });

    // Short OI must decrease
    let market_after = f.pm_client.get_market(&symbol);
    assert_eq!(
        market_after.short_open_interest, 0,
        "Short OI must be zero after liquidating the only short position"
    );
}

#[test]
fn test_liquidate_trader_does_not_receive_funds() {
    // Scenario: When a position is liquidated, all remaining collateral is seized.
    // The trader's USDC balance should NOT increase after liquidation.
    let f = setup_full();
    let symbol = symbol_short!("BTC");
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    let trader_balance_before = f.usdc_client.balance(&f.trader);

    // Crash price to make position liquidatable
    let crash_price: i128 = 44_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, crash_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    let trader_balance_after = f.usdc_client.balance(&f.trader);

    // Trader should NOT receive any funds from liquidation
    assert!(
        trader_balance_after <= trader_balance_before,
        "Trader balance must not increase after liquidation. Before: {}, After: {}",
        trader_balance_before,
        trader_balance_after
    );
}

// ===========================================================================
// 4. Edge cases
// ===========================================================================

#[test]
fn test_liquidate_barely_underwater_position() {
    // Scenario: Position is just barely underwater (health = -1 or very small negative).
    // The liquidation should still succeed.
    //
    // Long at $50,000, size=10,000, collateral=1,000.
    // We need pnl = -(collateral + 1) = -1,001 USDC (approximately).
    // pnl = size * (mark - entry) / entry
    // -1,001 = 10,000 * (mark - 50,000) / 50,000
    // mark - 50,000 = -1,001 * 50,000 / 10,000 = -5,005
    // mark = 44,995 (in USDC terms, but with 1e7 precision)
    //
    // With collateral = 1,000 USDC, a price of ~$44,990 gives:
    //   pnl = 10,000 * (44,990 - 50,000) / 50,000 = -1,002 USDC
    //   health = 1,000 - 1,002 = -2 (just barely underwater)
    let f = setup_full();
    let symbol = symbol_short!("BTC");
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Price that makes health just barely negative
    let barely_crash_price: i128 = 44_990 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, barely_crash_price);

    // Must succeed (position is underwater)
    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    // Confirm position deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "Barely underwater position must be liquidated"
        );
    });
}

#[test]
fn test_liquidate_borrow_fees_push_position_underwater() {
    // Scenario: Price barely moves, but accumulated borrow fees push the
    // position's health below zero.
    //
    // We seed a large borrow index before opening the position, then advance
    // the index further via update_indices to accumulate significant fees.
    //
    // Open long at $50,000, size=10,000, collateral=1,000.
    // If borrow_fee > 1,000 and pnl ~ 0, health = 1,000 - borrow_fee < 0.
    //
    // borrow_fee = (current_borrow_index - entry_borrow_index) * size / INDEX_PRECISION
    // We need borrow_fee > 1_000 * USDC_UNIT = 1_000_000_000
    // So (delta_index) * 10_000_000_000 / 1e14 > 1_000_000_000
    // delta_index > 1_000_000_000 * 1e14 / 10_000_000_000 = 10_000_000_000_000
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // Open position with fresh indices (borrow_index will be whatever market has)
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Advance time first so we can set the borrow index at the new timestamp
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, BTC_PRICE);

    // Now manually bump the market's borrow index to simulate large accumulated fees.
    // Set last_index_update to current time so do_update_indices is a no-op.
    // The position's entry_borrow_index was snapshotted at open time.
    // We need (new_index - entry_index) * size / INDEX_PRECISION > collateral
    let large_borrow_index: i128 = 15_000_000_000_000; // enough to make fee > collateral
    f.env.as_contract(&f.pm_addr, || {
        let mut market = storage::get_market(&f.env, &symbol);
        market.acc_borrow_index += large_borrow_index;
        market.last_index_update = TEST_TIMESTAMP + TIME_ADVANCE;
        storage::set_market(&f.env, &symbol, &market);
    });

    // The borrow fee should exceed collateral, making health negative
    // borrow_fee = 15_000_000_000_000 * 10_000_000_000 / 100_000_000_000_000 = 1_500_000_000
    // health = 1_000_000_000 + 0 - 1_500_000_000 + 0 = -500_000_000
    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    // Confirm position deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "Position pushed underwater by borrow fees must be liquidated"
        );
    });
}

// ===========================================================================
// 5. Paused contract
// ===========================================================================

#[test]
fn test_liquidate_succeeds_when_paused() {
    // Scenario: Contract is paused. Liquidations must still work to prevent bad debt.
    let f = setup_full();
    let symbol = symbol_short!("BTC");
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Crash the price
    let crash_price: i128 = 44_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, crash_price);

    // Pause the contract
    f.pm_client.pause(&f.admin);

    // Liquidation must succeed even when paused
    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "Position must be deleted after liquidation while paused"
        );
    });
}

// ===========================================================================
// 6. Multiple position isolation
// ===========================================================================

#[test]
fn test_liquidate_one_position_does_not_affect_other_traders() {
    // Scenario: Two traders have positions. Only one is underwater.
    // Liquidating trader1 must not affect trader2's position.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let trader2 = Address::generate(&f.env);
    f.usdc_client.mint(&trader2, &TRADER_BALANCE);

    // Trader1: long, 10x leverage (vulnerable)
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // Trader2: long, 2x leverage (safe)
    let safe_size = 10_000 * USDC_UNIT;
    let safe_collateral = 5_000 * USDC_UNIT;
    f.pm_client.increase_position(
        &trader2,
        &symbol,
        &safe_size,
        &safe_collateral,
        &true,
        &0,
        &0,
    );

    // Crash price enough to liquidate trader1 but not trader2
    // Trader1: health = 1,000 + 10,000*(44,000-50,000)/50,000 = 1,000 - 1,200 = -200
    // Trader2: health = 5,000 + 10,000*(44,000-50,000)/50,000 = 5,000 - 1,200 = 3,800 (safe)
    let crash_price: i128 = 44_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, crash_price);

    // Liquidate trader1
    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    // Trader1 position must be gone
    f.env.as_contract(&f.pm_addr, || {
        assert!(
            storage::get_position(&f.env, &f.trader, &symbol).is_none(),
            "Trader1 position must be liquidated"
        );
    });

    // Trader2 position must still exist
    let pos2 = f.pm_client.get_position(&trader2, &symbol);
    assert_eq!(
        pos2.size, safe_size,
        "Trader2 position must be unaffected by trader1 liquidation"
    );
    assert_eq!(
        pos2.collateral, safe_collateral,
        "Trader2 collateral must be unaffected"
    );
}
