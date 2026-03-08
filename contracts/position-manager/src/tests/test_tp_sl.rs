// ---------------------------------------------------------------------------
// Tests for: set_tp_sl and execute_order (take-profit / stop-loss)
//
// These tests are written BEFORE the implementation is finalized (TDD). They
// MUST compile but are expected to FAIL until TP/SL logic is fully correct.
//
// Functions under test:
//   fn set_tp_sl(env, trader, symbol, take_profit, stop_loss)
//   fn execute_order(env, caller, trader, symbol)
//
// Key behaviors:
//   set_tp_sl:
//     - trader.require_auth()
//     - Requires position exists (PositionNotFound = 6)
//     - TP for longs > entry; TP for shorts < entry (InvalidTpSl = 14)
//     - SL for longs < entry; SL for shorts > entry (InvalidTpSl = 14)
//     - 0 = not set (always valid)
//
//   execute_order:
//     - KEEPER-only (SharedError::Unauthorized = 3)
//     - Requires not paused (Paused = 3)
//     - Gets mark price from oracle
//     - Checks TP: longs mark >= TP; shorts mark <= TP
//     - Checks SL: longs mark <= SL; shorts mark >= SL
//     - Neither triggered -> OrderNotTriggered = 13
//     - Triggered -> full close, position deleted
// ---------------------------------------------------------------------------

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Symbol,
    symbol_short,
    vec,
};

use crate::contract::PositionManagerContract;
use crate::math::{self, PRECISION};
use crate::storage;
use crate::PositionManagerClient;

use config_manager::{ConfigManagerClient, ConfigManagerContract};
use mock_oracle::{MockOracle, MockOracleClient};
use mock_token::{MockToken, MockTokenClient};
use oracle_router::{OracleConfig, OracleRouterClient, OracleRouterContract};
use vault::{VaultContractClient, VaultContract};

// ===========================================================================
// Constants
// ===========================================================================

/// BTC price: $50,000 scaled by 1e7
const BTC_PRICE: i128 = 50_000 * PRECISION;

/// ETH price: $3,000 scaled by 1e7
const ETH_PRICE: i128 = 3_000 * PRECISION;

/// 1 USDC = 1_000_000 (6 decimals)
const USDC_UNIT: i128 = 1_000_000;

/// Trader starts with 100,000 USDC
const TRADER_BALANCE: i128 = 100_000 * USDC_UNIT;

/// Initial vault deposit (1,000,000 USDC) -- large enough for position tests
const VAULT_DEPOSIT: i128 = 1_000_000 * USDC_UNIT;

/// Default position size: 10,000 USDC notional
const DEFAULT_SIZE: i128 = 10_000 * USDC_UNIT;

/// Default collateral: 1,000 USDC (10x leverage)
const DEFAULT_COLLATERAL: i128 = 1_000 * USDC_UNIT;

/// Ledger timestamp used in tests
const TEST_TIMESTAMP: u64 = 1_700_000_000;

/// Minimum position lifetime (anti-front-running) -- 60 seconds for V1
const MIN_POSITION_LIFETIME: u64 = 60;

// ===========================================================================
// Test fixture
// ===========================================================================

struct TestFixture<'a> {
    env: Env,
    pm_client: PositionManagerClient<'a>,
    vault_client: VaultContractClient<'a>,
    oracle_client: MockOracleClient<'a>,
    oracle_router_client: OracleRouterClient<'a>,
    config_client: ConfigManagerClient<'a>,
    usdc_client: MockTokenClient<'a>,
    usdc_addr: Address,
    admin: Address,
    trader: Address,
    keeper: Address,
    pm_addr: Address,
    vault_addr: Address,
}

/// Deploy and wire up ALL protocol contracts needed for TP/SL tests.
fn setup_full<'a>() -> TestFixture<'a> {
    let env = Env::default();
    env.mock_all_auths();

    // Set a deterministic ledger timestamp
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
    let trader = Address::generate(&env);
    let keeper = Address::generate(&env);
    let lp = Address::generate(&env);

    // --- 1. ConfigManager ---
    let config_id = env.register(ConfigManagerContract, ());
    let config_client = ConfigManagerClient::new(&env, &config_id);
    config_client.initialize(&admin);

    // Grant roles needed by other contracts
    let pauser_role = Symbol::new(&env, "PAUSER");
    let keeper_role = Symbol::new(&env, "KEEPER");
    let admin_role = Symbol::new(&env, "ADMIN");
    config_client.grant_role(&admin, &pauser_role, &admin);
    config_client.grant_role(&admin, &keeper_role, &keeper);

    config_client.update_protocol_limits(&admin, &config_manager::ProtocolLimits {
        min_collateral: 1_000_000,
        cooldown_duration: 60,
        min_position_lifetime: 60,
        max_utilization_ratio: 8_500,
        funding_cut_bps: 500,
        adl_pnl_bps: 9_000,
        adl_utilization_bps: 9_500,
    });

    config_client.update_borrow_rate_config(&admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    config_client.update_fee_splits(&admin, &config_manager::FeeSplits {
        keeper_bps: 500,
        dev_bps: 500,
        lp_bps: 9000,
    });

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
    oracle_client.set_price(&symbol_short!("ETH"), &ETH_PRICE);

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
    oracle_router_client.set_oracle_sources(
        &admin,
        &symbol_short!("ETH"),
        &vec![&env, oracle_id.clone()],
        &vec![&env],
    );

    // --- 5. PositionManager (register first to get address for Vault init) ---
    let pm_id = env.register(PositionManagerContract, ());
    let pm_client = PositionManagerClient::new(&env, &pm_id);

    // --- 6. Vault ---
    let vault_id = env.register(VaultContract, ());
    let vault_client = VaultContractClient::new(&env, &vault_id);
    vault_client.initialize(&admin, &usdc_id, &config_id, &pm_id);

    // --- 7. Initialize PositionManager ---
    pm_client.initialize(&admin, &vault_id, &config_id, &oracle_router_id);
    pm_client.set_max_leverage(&admin, &symbol_short!("BTC"), &100_i128);
    pm_client.set_max_leverage(&admin, &symbol_short!("ETH"), &100_i128);

    // --- Fund accounts ---
    usdc_client.mint(&trader, &TRADER_BALANCE);
    usdc_client.mint(&lp, &VAULT_DEPOSIT);
    vault_client.deposit(&VAULT_DEPOSIT, &lp, &lp, &lp);

    // SAFETY: env lives in the fixture, clients borrow from it.
    let pm_client = unsafe { core::mem::transmute(pm_client) };
    let vault_client = unsafe { core::mem::transmute(vault_client) };
    let oracle_client = unsafe { core::mem::transmute(oracle_client) };
    let oracle_router_client = unsafe { core::mem::transmute(oracle_router_client) };
    let config_client = unsafe { core::mem::transmute(config_client) };
    let usdc_client = unsafe { core::mem::transmute(usdc_client) };

    TestFixture {
        env,
        pm_client,
        vault_client,
        oracle_client,
        oracle_router_client,
        config_client,
        usdc_client,
        usdc_addr: usdc_id,
        admin,
        trader,
        keeper,
        pm_addr: pm_id,
        vault_addr: vault_id,
    }
}

// ===========================================================================
// Helpers
// ===========================================================================

/// Advance ledger to a new timestamp.
fn advance_time(f: &TestFixture, new_timestamp: u64) {
    f.env.ledger().set(LedgerInfo {
        timestamp: new_timestamp,
        protocol_version: 23,
        sequence_number: 100 + ((new_timestamp - TEST_TIMESTAMP) as u32),
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 10_000_000,
    });
}

/// Open a BTC position (long or short) with default size/collateral and no TP/SL.
fn open_btc_position(f: &TestFixture, is_long: bool) {
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &is_long,
        &0,
        &0,
    );
}

/// Open a BTC position with specific TP/SL.
fn open_btc_position_with_tp_sl(f: &TestFixture, is_long: bool, tp: i128, sl: i128) {
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &is_long,
        &tp,
        &sl,
    );
}

/// Advance time past MinPositionLifetime + oracle cache, and refresh oracle.
fn advance_past_lifetime(f: &TestFixture) {
    advance_time(f, TEST_TIMESTAMP + MIN_POSITION_LIFETIME + 11);
    f.oracle_client.set_price(&symbol_short!("BTC"), &BTC_PRICE);
}

/// Advance time past MinPositionLifetime + oracle cache, and set a custom price.
fn advance_and_set_price(f: &TestFixture, price: i128) {
    advance_time(f, TEST_TIMESTAMP + MIN_POSITION_LIFETIME + 11);
    f.oracle_client.set_price(&symbol_short!("BTC"), &price);
}

// ===========================================================================
// 1. set_tp_sl tests
// ===========================================================================

#[test]
fn test_set_tp_sl_long_success() {
    // Open a long BTC at $50,000. Set TP=$55,000 (above entry) and SL=$45,000
    // (below entry). Both are valid for longs.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 55_000 * PRECISION;
    let sl = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &sl);

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(
        pos.take_profit, tp,
        "Take-profit must be updated to {} for long, got {}",
        tp, pos.take_profit
    );
    assert_eq!(
        pos.stop_loss, sl,
        "Stop-loss must be updated to {} for long, got {}",
        sl, pos.stop_loss
    );
}

#[test]
fn test_set_tp_sl_short_success() {
    // Open a short BTC at $50,000. Set TP=$45,000 (below entry) and SL=$55,000
    // (above entry). Both are valid for shorts.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    let tp = 45_000 * PRECISION;
    let sl = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &sl);

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(
        pos.take_profit, tp,
        "Take-profit must be updated to {} for short, got {}",
        tp, pos.take_profit
    );
    assert_eq!(
        pos.stop_loss, sl,
        "Stop-loss must be updated to {} for short, got {}",
        sl, pos.stop_loss
    );
}

#[test]
fn test_set_tp_sl_only_tp() {
    // Set only TP (SL=0). SL should remain 0 (not set).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 60_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.take_profit, tp, "TP must be set to {}", tp);
    assert_eq!(pos.stop_loss, 0, "SL must remain 0 when not set");
}

#[test]
fn test_set_tp_sl_only_sl() {
    // Set only SL (TP=0). TP should remain 0 (not set).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let sl = 40_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &sl);

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.take_profit, 0, "TP must remain 0 when not set");
    assert_eq!(pos.stop_loss, sl, "SL must be set to {}", sl);
}

#[test]
fn test_set_tp_sl_clear_both() {
    // First set TP and SL, then clear both by setting to 0.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    // Set valid TP/SL first
    let tp = 55_000 * PRECISION;
    let sl = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &sl);

    // Verify they are set
    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.take_profit, tp);
    assert_eq!(pos.stop_loss, sl);

    // Clear both
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &0);

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.take_profit, 0, "TP must be cleared to 0");
    assert_eq!(pos.stop_loss, 0, "SL must be cleared to 0");
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_invalid_tp_long_reverts() {
    // Long position: TP below entry price is invalid.
    // Entry = $50,000; TP = $49,000 -> panic InvalidTpSl (14)
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let invalid_tp = 49_000 * PRECISION; // below entry for long
    f.pm_client.set_tp_sl(&f.trader, &symbol, &invalid_tp, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_invalid_tp_short_reverts() {
    // Short position: TP above entry price is invalid.
    // Entry = $50,000; TP = $51,000 -> panic InvalidTpSl (14)
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    let invalid_tp = 51_000 * PRECISION; // above entry for short
    f.pm_client.set_tp_sl(&f.trader, &symbol, &invalid_tp, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_invalid_sl_long_reverts() {
    // Long position: SL above entry price is invalid.
    // Entry = $50,000; SL = $51,000 -> panic InvalidTpSl (14)
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let invalid_sl = 51_000 * PRECISION; // above entry for long
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &invalid_sl);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_invalid_sl_short_reverts() {
    // Short position: SL below entry price is invalid.
    // Entry = $50,000; SL = $49,000 -> panic InvalidTpSl (14)
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    let invalid_sl = 49_000 * PRECISION; // below entry for short
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &invalid_sl);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_set_tp_sl_no_position_reverts() {
    // No position exists for this trader/symbol. Must panic PositionNotFound (6).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    f.pm_client.set_tp_sl(&f.trader, &symbol, &(55_000 * PRECISION), &(45_000 * PRECISION));
}

// ===========================================================================
// 1b. set_tp_sl adversarial / edge-case tests
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_tp_equal_to_entry_long_reverts() {
    // Boundary: TP exactly equal to entry price for a long is invalid (must be strictly above).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    // TP = entry price exactly
    f.pm_client.set_tp_sl(&f.trader, &symbol, &BTC_PRICE, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_tp_equal_to_entry_short_reverts() {
    // Boundary: TP exactly equal to entry price for a short is invalid (must be strictly below).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    // TP = entry price exactly
    f.pm_client.set_tp_sl(&f.trader, &symbol, &BTC_PRICE, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_sl_equal_to_entry_long_reverts() {
    // Boundary: SL exactly equal to entry price for a long is invalid (must be strictly below).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    // SL = entry price exactly
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &BTC_PRICE);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_sl_equal_to_entry_short_reverts() {
    // Boundary: SL exactly equal to entry price for a short is invalid (must be strictly above).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    // SL = entry price exactly
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &BTC_PRICE);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_negative_tp_long_reverts() {
    // Adversarial: negative TP price should be treated as invalid, not as "not set".
    // A negative TP for a long is below entry -> InvalidTpSl.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    f.pm_client.set_tp_sl(&f.trader, &symbol, &(-1_i128), &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_set_tp_sl_negative_sl_long_reverts() {
    // Adversarial: negative SL price should be treated as invalid.
    // A negative SL for a long is below entry, so it might pass the direction check,
    // but negative prices are not meaningful. We expect InvalidTpSl.
    // NOTE: The current impl checks `stop_loss > 0` as the gate -- negative values
    // bypass validation entirely. If neg values should be rejected, this test
    // documents that expectation.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &(-100 * PRECISION));
}

#[test]
fn test_set_tp_sl_overwrite_existing() {
    // Set TP/SL, then overwrite with new values. Verify the new values stick.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp1 = 55_000 * PRECISION;
    let sl1 = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp1, &sl1);

    let tp2 = 60_000 * PRECISION;
    let sl2 = 40_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp2, &sl2);

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.take_profit, tp2, "TP must be overwritten to new value");
    assert_eq!(pos.stop_loss, sl2, "SL must be overwritten to new value");
}

// ===========================================================================
// 2. execute_order tests -- TP triggered
// ===========================================================================

#[test]
fn test_execute_order_tp_long_success() {
    // Long BTC at $50,000 with TP=$55,000. Price rises to $56,000 (above TP).
    // Keeper calls execute_order -> position is closed, trader receives profit.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    // Set TP
    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trader_balance_before = f.usdc_client.balance(&f.trader);

    // Advance time and set price above TP
    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // Keeper executes order
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let trader_balance_after = f.usdc_client.balance(&f.trader);
    let received = trader_balance_after - trader_balance_before;

    // Trader should receive collateral + profit (minus fees)
    assert!(
        received > DEFAULT_COLLATERAL,
        "Trader must receive more than collateral on profitable TP close. Received: {}",
        received
    );

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted after TP execution");
    });
}

#[test]
fn test_execute_order_sl_long_success() {
    // Long BTC at $50,000 with SL=$45,000. Price drops to $44,000 (below SL).
    // Keeper calls execute_order -> position is closed with a loss.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    // Set SL
    let sl = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &sl);

    let trader_balance_before = f.usdc_client.balance(&f.trader);

    // Advance time and set price below SL
    let trigger_price = 44_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // Keeper executes order
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let trader_balance_after = f.usdc_client.balance(&f.trader);
    let received = trader_balance_after - trader_balance_before;

    // Trader loses money -- receives less than collateral
    assert!(
        received < DEFAULT_COLLATERAL,
        "Trader must receive less than collateral on SL loss. Received: {}",
        received
    );

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted after SL execution");
    });
}

#[test]
fn test_execute_order_tp_short_success() {
    // Short BTC at $50,000 with TP=$45,000. Price drops to $44,000 (below TP).
    // Keeper calls execute_order -> position is closed, trader receives profit.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    // Set TP (below entry for short)
    let tp = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trader_balance_before = f.usdc_client.balance(&f.trader);

    // Advance time and set price below TP
    let trigger_price = 44_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // Keeper executes order
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let trader_balance_after = f.usdc_client.balance(&f.trader);
    let received = trader_balance_after - trader_balance_before;

    // Trader should receive collateral + profit
    assert!(
        received > DEFAULT_COLLATERAL,
        "Short trader must receive more than collateral on profitable TP. Received: {}",
        received
    );

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted after short TP execution");
    });
}

#[test]
fn test_execute_order_sl_short_success() {
    // Short BTC at $50,000 with SL=$55,000. Price rises to $56,000 (above SL).
    // Keeper calls execute_order -> position is closed with a loss.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    // Set SL (above entry for short)
    let sl = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &sl);

    let trader_balance_before = f.usdc_client.balance(&f.trader);

    // Advance time and set price above SL
    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // Keeper executes order
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let trader_balance_after = f.usdc_client.balance(&f.trader);
    let received = trader_balance_after - trader_balance_before;

    // Trader loses money
    assert!(
        received < DEFAULT_COLLATERAL,
        "Short trader must receive less than collateral on SL loss. Received: {}",
        received
    );

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted after short SL execution");
    });
}

// ===========================================================================
// 2b. execute_order -- boundary trigger tests
// ===========================================================================

#[test]
fn test_execute_order_tp_long_exact_price() {
    // Long TP=$55,000, mark price exactly $55,000 (mark >= TP). Should trigger.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    // Set price exactly to TP
    advance_and_set_price(&f, tp);

    // Should NOT panic -- TP is triggered at exact price
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted when TP hit exactly");
    });
}

#[test]
fn test_execute_order_sl_long_exact_price() {
    // Long SL=$45,000, mark price exactly $45,000 (mark <= SL). Should trigger.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let sl = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &sl);

    // Set price exactly to SL
    advance_and_set_price(&f, sl);

    // Should NOT panic -- SL is triggered at exact price
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    // Position must be deleted
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted when SL hit exactly");
    });
}

// ===========================================================================
// 2c. execute_order -- revert scenarios
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_execute_order_not_triggered_reverts() {
    // Long BTC at $50k with TP=$55k and SL=$45k. Price is still $50k.
    // Neither TP nor SL is triggered -> OrderNotTriggered (13).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 55_000 * PRECISION;
    let sl = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &sl);

    // Advance time but keep price the same
    advance_past_lifetime(&f);

    // Should panic -- price has not reached TP or SL
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_execute_order_no_tp_sl_set_reverts() {
    // Position exists but has no TP or SL set (both 0).
    // execute_order should panic with OrderNotTriggered (13) regardless of price.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    advance_past_lifetime(&f);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_execute_order_no_position_reverts() {
    // No position exists for this trader/symbol -> PositionNotFound (6).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    advance_past_lifetime(&f);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_execute_order_not_keeper_reverts() {
    // Non-keeper caller attempts execute_order -> SharedError::Unauthorized (3).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // Trader (not keeper) tries to execute -- should fail
    f.pm_client.execute_order(&f.trader, &f.trader, &symbol);
}

#[test]
fn test_execute_order_succeeds_when_paused() {
    // TP/SL orders protect traders and must execute during emergencies.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    // Pause the contract
    f.pm_client.pause(&f.admin);

    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // execute_order should succeed even when paused
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    // Verify position is gone
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted after execute_order");
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_set_tp_sl_reverts_when_paused() {
    // Setting TP/SL is a non-emergency action and must be blocked when paused.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    f.pm_client.pause(&f.admin);

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);
}

#[test]
fn test_execute_order_position_deleted_after() {
    // After execute_order completes, calling get_position should panic with
    // PositionNotFound (6), confirming the position is fully deleted.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    // Verify position is gone via storage
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(pos.is_none(), "Position must be deleted after execute_order");
    });
}

#[test]
fn test_execute_order_market_oi_updated() {
    // After execute_order, market OI must decrease by the position's full size.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let market_before = f.pm_client.get_market(&symbol);
    assert_eq!(market_before.long_open_interest, DEFAULT_SIZE);

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let market_after = f.pm_client.get_market(&symbol);
    assert_eq!(
        market_after.long_open_interest, 0,
        "Long OI must be zero after TP execution of only position"
    );
}

#[test]
fn test_execute_order_total_reserved_updated() {
    // After execute_order, total_reserved must decrease by position size.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    f.env.as_contract(&f.pm_addr, || {
        assert_eq!(storage::get_total_reserved(&f.env), DEFAULT_SIZE);
    });

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    f.env.as_contract(&f.pm_addr, || {
        assert_eq!(
            storage::get_total_reserved(&f.env),
            0,
            "TotalReserved must be zero after execute_order full close"
        );
    });
}

#[test]
fn test_execute_order_vault_liquidity_released() {
    // After execute_order, vault free liquidity should increase.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let free_liq_before = f.vault_client.free_liquidity();

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let free_liq_after = f.vault_client.free_liquidity();
    assert!(
        free_liq_after > free_liq_before,
        "Vault free liquidity must increase after execute_order. Before: {}, After: {}",
        free_liq_before, free_liq_after
    );
}

// ===========================================================================
// 2d. execute_order -- adversarial edge cases
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_execute_order_price_one_tick_below_tp_long_not_triggered() {
    // Long with TP=$55,000. Price is $54,999.9999999 (one unit below).
    // TP condition: mark >= TP. This is strictly less -> NOT triggered.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    // One PRECISION unit below TP
    let almost_tp = tp - 1;
    advance_and_set_price(&f, almost_tp);

    // Should panic -- not quite triggered
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_execute_order_price_one_tick_above_sl_long_not_triggered() {
    // Long with SL=$45,000. Price is $45,000.0000001 (one unit above).
    // SL condition: mark <= SL. This is strictly greater -> NOT triggered.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, true);

    let sl = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &0, &sl);

    // One PRECISION unit above SL
    let almost_sl = sl + 1;
    advance_and_set_price(&f, almost_sl);

    // Should panic -- not quite triggered
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);
}

#[test]
fn test_execute_order_short_oi_updated() {
    // Short position: after execute_order, short OI must decrease.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    open_btc_position(&f, false);

    let market_before = f.pm_client.get_market(&symbol);
    assert_eq!(market_before.short_open_interest, DEFAULT_SIZE);

    let tp = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    let trigger_price = 44_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let market_after = f.pm_client.get_market(&symbol);
    assert_eq!(
        market_after.short_open_interest, 0,
        "Short OI must be zero after TP execution of only short position"
    );
    assert_eq!(
        market_after.long_open_interest, 0,
        "Long OI must remain zero -- only short position was closed"
    );
}

// ===========================================================================
// 3. increase_position with TP/SL
// ===========================================================================

#[test]
fn test_increase_position_with_tp_sl() {
    // Open a new long BTC position with TP=$55,000 and SL=$45,000.
    // Verify they're stored in the position.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let tp = 55_000 * PRECISION;
    let sl = 45_000 * PRECISION;

    open_btc_position_with_tp_sl(&f, true, tp, sl);

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(
        pos.take_profit, tp,
        "New position must store TP from increase_position"
    );
    assert_eq!(
        pos.stop_loss, sl,
        "New position must store SL from increase_position"
    );
}

#[test]
fn test_increase_position_updates_tp_sl() {
    // Open position with TP=$55k, SL=$45k. Then increase position with new
    // TP=$60k, SL=$40k. Verify TP/SL are updated.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let tp1 = 55_000 * PRECISION;
    let sl1 = 45_000 * PRECISION;
    open_btc_position_with_tp_sl(&f, true, tp1, sl1);

    // Increase position with new TP/SL
    let tp2 = 60_000 * PRECISION;
    let sl2 = 40_000 * PRECISION;
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
        &tp2,
        &sl2,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(
        pos.take_profit, tp2,
        "TP must be updated on increase_position with non-zero TP"
    );
    assert_eq!(
        pos.stop_loss, sl2,
        "SL must be updated on increase_position with non-zero SL"
    );
}

#[test]
fn test_increase_position_zero_tp_sl_preserves_existing() {
    // Open position with TP=$55k, SL=$45k. Then increase with TP=0, SL=0.
    // Existing TP/SL should be preserved (0 means "don't change" on increase).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let tp = 55_000 * PRECISION;
    let sl = 45_000 * PRECISION;
    open_btc_position_with_tp_sl(&f, true, tp, sl);

    // Increase with zero TP/SL -- should preserve existing
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
        &0,
        &0,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(
        pos.take_profit, tp,
        "TP must be preserved when increase_position passes 0"
    );
    assert_eq!(
        pos.stop_loss, sl,
        "SL must be preserved when increase_position passes 0"
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_increase_position_invalid_tp_reverts() {
    // Open new long position with TP below entry price -> InvalidTpSl (14).
    let f = setup_full();

    let invalid_tp = 49_000 * PRECISION; // below entry ($50k) for long
    let valid_sl = 45_000 * PRECISION;

    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
        &invalid_tp,
        &valid_sl,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_increase_position_invalid_sl_reverts() {
    // Open new long position with SL above entry price -> InvalidTpSl (14).
    let f = setup_full();

    let valid_tp = 55_000 * PRECISION;
    let invalid_sl = 51_000 * PRECISION; // above entry ($50k) for long

    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
        &valid_tp,
        &invalid_sl,
    );
}

#[test]
fn test_increase_position_new_short_with_tp_sl() {
    // Open a new short position with TP (below entry) and SL (above entry).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let tp = 45_000 * PRECISION; // below entry for short
    let sl = 55_000 * PRECISION; // above entry for short

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &false,
        &tp,
        &sl,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.take_profit, tp);
    assert_eq!(pos.stop_loss, sl);
    assert!(!pos.is_long);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_increase_position_short_invalid_tp_above_entry_reverts() {
    // Open new short with TP above entry -> InvalidTpSl (14).
    let f = setup_full();

    let invalid_tp = 55_000 * PRECISION; // above entry for short = invalid

    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &false,
        &invalid_tp,
        &0,
    );
}

// ===========================================================================
// 4. Integration: full lifecycle tests
// ===========================================================================

#[test]
fn test_full_lifecycle_open_set_tp_sl_execute_tp() {
    // Full lifecycle: open long -> set TP/SL -> price rises -> execute TP.
    // Verify position is closed and trader is profitable.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // Step 1: Open long at $50k
    open_btc_position(&f, true);

    // Step 2: Set TP=$55k, SL=$45k
    let tp = 55_000 * PRECISION;
    let sl = 45_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &sl);

    let balance_before = f.usdc_client.balance(&f.trader);

    // Step 3: Price rises to $56k (above TP)
    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // Step 4: Keeper executes
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    // Step 5: Verify
    let balance_after = f.usdc_client.balance(&f.trader);
    assert!(
        balance_after > balance_before,
        "Trader must profit from TP execution"
    );

    // Position gone
    f.env.as_contract(&f.pm_addr, || {
        assert!(storage::get_position(&f.env, &f.trader, &symbol).is_none());
    });

    // Market OI reset
    let market = f.pm_client.get_market(&symbol);
    assert_eq!(market.long_open_interest, 0);
}

#[test]
fn test_full_lifecycle_open_with_tp_sl_execute_sl() {
    // Open long with TP/SL inline, then SL triggers.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let tp = 55_000 * PRECISION;
    let sl = 48_000 * PRECISION;
    open_btc_position_with_tp_sl(&f, true, tp, sl);

    let balance_before = f.usdc_client.balance(&f.trader);

    // Price drops to $47k (below SL)
    let trigger_price = 47_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    let balance_after = f.usdc_client.balance(&f.trader);
    let received = balance_after - balance_before;

    // Trader gets back something (collateral minus loss), but less than full collateral
    // PnL = 10,000 * (47,000 - 50,000) / 50,000 = -600 USDC
    // health = 1,000 - 600 = 400 (approx)
    assert!(
        received > 0,
        "Trader should receive remaining collateral after SL loss. Received: {}",
        received
    );
    assert!(
        received < DEFAULT_COLLATERAL,
        "Trader must receive less than collateral on SL loss. Received: {}",
        received
    );
}

#[test]
fn test_execute_order_does_not_affect_other_positions() {
    // Two traders have positions. Executing one trader's TP/SL does not affect
    // the other trader's position.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let trader2 = Address::generate(&f.env);
    f.usdc_client.mint(&trader2, &TRADER_BALANCE);

    // Trader 1: long with TP
    open_btc_position(&f, true);
    let tp = 55_000 * PRECISION;
    f.pm_client.set_tp_sl(&f.trader, &symbol, &tp, &0);

    // Trader 2: long, no TP/SL
    f.pm_client.increase_position(
        &trader2,
        &symbol,
        &(20_000 * USDC_UNIT),
        &(2_000 * USDC_UNIT),
        &true,
        &0,
        &0,
    );

    // Price rises above TP
    let trigger_price = 56_000 * PRECISION;
    advance_and_set_price(&f, trigger_price);

    // Execute trader 1's TP
    f.pm_client.execute_order(&f.keeper, &f.trader, &symbol);

    // Trader 2's position must be unaffected
    let pos2 = f.pm_client.get_position(&trader2, &symbol);
    assert_eq!(
        pos2.size,
        20_000 * USDC_UNIT,
        "Trader2 position size must be unaffected by trader1's TP execution"
    );
}
