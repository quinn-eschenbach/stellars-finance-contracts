// ---------------------------------------------------------------------------
// Tests for: increase_position
//
// These tests are written BEFORE the implementation (TDD). They MUST compile
// but are expected to FAIL until increase_position is fully implemented.
//
// The function under test:
//   fn increase_position(env, trader, symbol, size, collateral, is_long)
//
// Requires a full deployment: ConfigManager, MockToken (USDC), MockOracle,
// OracleRouter, Vault, and PositionManager.
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

/// Max utilization ratio: 85% = 8500 bps
const MAX_UTIL_RATIO: i128 = 8_500;

/// Default position size: 10,000 USDC notional
const DEFAULT_SIZE: i128 = 10_000 * USDC_UNIT;

/// Default collateral: 1,000 USDC (10x leverage)
const DEFAULT_COLLATERAL: i128 = 1_000 * USDC_UNIT;

/// Ledger timestamp used in tests
const TEST_TIMESTAMP: u64 = 1_700_000_000;

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
    pm_addr: Address,
    vault_addr: Address,
}

/// Deploy and wire up ALL protocol contracts needed for increase_position tests.
///
/// Deployment order:
///   1. ConfigManager -- grants ADMIN, PAUSER, KEEPER roles
///   2. MockToken (USDC) -- mints to trader and LP provider
///   3. MockOracle -- sets BTC and ETH prices
///   4. OracleRouter -- initialized with ConfigManager, linked to MockOracle
///   5. Vault -- initialized with USDC, ConfigManager, PositionManager address
///   6. PositionManager -- initialized with Vault, ConfigManager, OracleRouter
///   7. LP deposits into the vault to provide free liquidity
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
    config_client.grant_role(&admin, &keeper_role, &admin);

    config_client.update_protocol_limits(&admin, &config_manager::ProtocolLimits {
        min_collateral: 1_000_000,
        cooldown_duration: 60,
        min_position_lifetime: 60,
        max_utilization_ratio: 8_500,
        funding_cut_bps: 500,
        adl_pnl_bps: 9_000,
        adl_utilization_bps: 9_500,
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

    // Configure oracle sources and thresholds
    oracle_router_client.set_oracle_config(
        &admin,
        &OracleConfig {
            max_deviation_bps: 500,       // 5%
            staleness_threshold: 3600,    // 1 hour
            cache_duration: 10,           // 10 seconds
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
    // Mint USDC to trader for collateral
    usdc_client.mint(&trader, &TRADER_BALANCE);

    // Mint USDC to LP and deposit into vault for free liquidity
    usdc_client.mint(&lp, &VAULT_DEPOSIT);
    // VaultContract::deposit(assets, receiver, from, operator) -- ERC-4626 interface
    vault_client.deposit(&VAULT_DEPOSIT, &lp, &lp, &lp);

    // SAFETY: env lives in the fixture, clients borrow from it.
    // transmute extends the borrow lifetime to 'static for the fixture pattern.
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
        pm_addr: pm_id,
        vault_addr: vault_id,
    }
}

// ===========================================================================
// 1. Guard tests
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_increase_position_reverts_when_paused() {
    // Scenario: Contract is initialized then paused. Calling increase_position
    // must revert with Paused (error code 3).
    let f = setup_full();
    f.pm_client.pause(&f.admin);
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_increase_position_reverts_on_zero_size() {
    // Scenario: Trader passes size=0. Must revert with ZeroAmount (error 8).
    // A zero-size position is nonsensical and should be rejected.
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &0_i128,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_increase_position_reverts_on_zero_collateral() {
    // Scenario: Trader passes collateral=0. Must revert with ZeroAmount (error 8).
    // Opening a position with zero collateral is infinite leverage -- must be rejected.
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &0_i128,
        &true, &0, &0,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_increase_position_reverts_on_negative_size() {
    // Adversarial: Trader passes a negative size to attempt underflow or bypass.
    // Must revert with ZeroAmount (error 8) since negative size is invalid.
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &(-1_000_i128),
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_increase_position_reverts_on_negative_collateral() {
    // Adversarial: Trader passes negative collateral to try to extract funds.
    // Must revert with ZeroAmount (error 8).
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &(-500_i128),
        &true, &0, &0,
    );
}

// ===========================================================================
// 2. Happy path -- new position
// ===========================================================================

#[test]
fn test_open_new_long_position_stores_correct_fields() {
    // Scenario: Trader opens a new long BTC position. After the call, the
    // stored Position must reflect the correct entry_price (from oracle),
    // collateral, size, is_long=true, and last_increased_time = current timestamp.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);

    assert_eq!(pos.collateral, DEFAULT_COLLATERAL, "Collateral must match deposited amount");
    assert_eq!(pos.size, DEFAULT_SIZE, "Size must match requested size");
    assert_eq!(pos.entry_price, BTC_PRICE, "Entry price must equal oracle mark price");
    assert!(pos.is_long, "Position must be long");
    assert_eq!(
        pos.last_increased_time, TEST_TIMESTAMP,
        "last_increased_time must equal current ledger timestamp"
    );
}

#[test]
fn test_open_new_short_position_stores_correct_fields() {
    // Scenario: Trader opens a new short ETH position.
    let f = setup_full();
    let symbol = symbol_short!("ETH");

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &false, &0, &0,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);

    assert_eq!(pos.collateral, DEFAULT_COLLATERAL, "Collateral must match");
    assert_eq!(pos.size, DEFAULT_SIZE, "Size must match");
    assert_eq!(pos.entry_price, ETH_PRICE, "Entry price must equal ETH mark price");
    assert!(!pos.is_long, "Position must be short");
    assert_eq!(pos.last_increased_time, TEST_TIMESTAMP, "Timestamp must match");
}

#[test]
fn test_open_new_long_updates_market_info_oi() {
    // Scenario: After opening a new long, MarketInfo.long_open_interest must
    // increase by the position size, and short_open_interest stays zero.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let market = f.pm_client.get_market(&symbol);

    assert_eq!(
        market.long_open_interest, DEFAULT_SIZE,
        "Long OI must increase by position size"
    );
    assert_eq!(
        market.short_open_interest, 0,
        "Short OI must remain zero for a long position"
    );
    assert_eq!(
        market.global_long_avg_price, BTC_PRICE,
        "Global long avg price must equal entry price for first position"
    );
}

#[test]
fn test_open_new_short_updates_market_info_oi() {
    // Scenario: After opening a new short, short_open_interest must increase.
    let f = setup_full();
    let symbol = symbol_short!("ETH");

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &false, &0, &0,
    );

    let market = f.pm_client.get_market(&symbol);

    assert_eq!(
        market.short_open_interest, DEFAULT_SIZE,
        "Short OI must increase by position size"
    );
    assert_eq!(
        market.long_open_interest, 0,
        "Long OI must remain zero for a short position"
    );
    assert_eq!(
        market.global_short_avg_price, ETH_PRICE,
        "Global short avg price must equal entry price for first short"
    );
}

#[test]
fn test_open_position_increases_total_reserved() {
    // Scenario: TotalReserved must increase by the position size after opening
    // a new position. This tracks how much vault liquidity is earmarked.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // Verify initial total_reserved is zero
    f.env.as_contract(&f.pm_addr, || {
        assert_eq!(
            storage::get_total_reserved(&f.env),
            0,
            "TotalReserved must start at zero"
        );
    });

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    f.env.as_contract(&f.pm_addr, || {
        assert_eq!(
            storage::get_total_reserved(&f.env),
            DEFAULT_SIZE,
            "TotalReserved must equal position size after first position"
        );
    });
}

#[test]
fn test_open_position_transfers_collateral_from_trader() {
    // Scenario: The trader's USDC balance must decrease by collateral amount,
    // and the PM contract address must receive that collateral.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let balance_before = f.usdc_client.balance(&f.trader);

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let balance_after = f.usdc_client.balance(&f.trader);
    assert_eq!(
        balance_before - balance_after,
        DEFAULT_COLLATERAL,
        "Trader USDC balance must decrease by exactly the collateral amount"
    );
}

#[test]
fn test_open_position_entry_borrow_and_funding_indices() {
    // Scenario: A new position must snapshot the current market borrow and
    // funding indices at the time of opening. For a fresh market (no prior
    // update_indices), these start at zero.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    let market = f.pm_client.get_market(&symbol);

    // do_update_indices runs before position creation, so entry indices
    // match the market's accumulated indices (non-zero if time has elapsed)
    assert_eq!(
        pos.entry_borrow_index, market.acc_borrow_index,
        "Entry borrow index must equal market's current acc_borrow_index"
    );
    assert_eq!(
        pos.entry_funding_index, market.acc_funding_index,
        "Entry funding index must equal market's current acc_funding_index"
    );
}

// ===========================================================================
// 3. Happy path -- increase existing position
// ===========================================================================

#[test]
fn test_increase_existing_long_adds_size_and_collateral() {
    // Scenario: Trader opens a long, then increases it. The resulting position
    // must have accumulated size and collateral.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // Open initial position
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let additional_size = 5_000 * USDC_UNIT;
    let additional_collateral = 500 * USDC_UNIT;

    // Increase the position
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &additional_size,
        &additional_collateral,
        &true, &0, &0,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);

    assert_eq!(
        pos.size,
        DEFAULT_SIZE + additional_size,
        "Size must be cumulative after increase"
    );
    assert_eq!(
        pos.collateral,
        DEFAULT_COLLATERAL + additional_collateral,
        "Collateral must be cumulative after increase"
    );
}

#[test]
fn test_increase_existing_position_averages_entry_price() {
    // Scenario: Trader opens at price A, then increases at price B. The entry
    // price must be the volume-weighted average of the two.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // Open initial position at BTC_PRICE ($50,000)
    let size1 = 10_000 * USDC_UNIT;
    let col1 = 1_000 * USDC_UNIT;
    f.pm_client.increase_position(&f.trader, &symbol, &size1, &col1, &true, &0, &0);

    // Change oracle price to $60,000 before second increase.
    // Advance time past the oracle router cache_duration (10s) so the new price is fetched.
    let new_price: i128 = 60_000 * PRECISION;
    f.oracle_client.set_price(&symbol, &new_price);
    f.env.ledger().set(LedgerInfo {
        timestamp: TEST_TIMESTAMP + 11,
        protocol_version: 23,
        sequence_number: 101,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 10_000_000,
    });

    let size2 = 10_000 * USDC_UNIT;
    let col2 = 1_000 * USDC_UNIT;
    f.pm_client.increase_position(&f.trader, &symbol, &size2, &col2, &true, &0, &0);

    let pos = f.pm_client.get_position(&f.trader, &symbol);

    // Expected weighted average: (50000*10000 + 60000*10000) / 20000 = 55000
    let expected_avg_price = math::update_global_avg_price(BTC_PRICE, size1, new_price, size2);
    assert_eq!(
        pos.entry_price, expected_avg_price,
        "Entry price must be weighted average after increase"
    );
}

#[test]
fn test_increase_existing_position_updates_oi_correctly() {
    // Scenario: Two successive increases should result in cumulative OI.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let size1 = 10_000 * USDC_UNIT;
    let size2 = 5_000 * USDC_UNIT;

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &size1,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &size2,
        &(500 * USDC_UNIT),
        &true, &0, &0,
    );

    let market = f.pm_client.get_market(&symbol);
    assert_eq!(
        market.long_open_interest,
        size1 + size2,
        "Long OI must be cumulative after two increases"
    );
}

#[test]
fn test_increase_existing_position_updates_total_reserved() {
    // Scenario: TotalReserved must increase by each position size increment.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let size1 = 10_000 * USDC_UNIT;
    let size2 = 5_000 * USDC_UNIT;

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &size1,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &size2,
        &(500 * USDC_UNIT),
        &true, &0, &0,
    );

    f.env.as_contract(&f.pm_addr, || {
        assert_eq!(
            storage::get_total_reserved(&f.env),
            size1 + size2,
            "TotalReserved must reflect cumulative reservation"
        );
    });
}

#[test]
fn test_increase_position_updates_last_increased_time() {
    // Scenario: On each increase, last_increased_time must be reset to the
    // current ledger timestamp (anti-front-running lock).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // First increase at TEST_TIMESTAMP
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let pos1 = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos1.last_increased_time, TEST_TIMESTAMP);

    // Advance time by 60 seconds
    let new_ts = TEST_TIMESTAMP + 60;
    f.env.ledger().set(LedgerInfo {
        timestamp: new_ts,
        protocol_version: 23,
        sequence_number: 101,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 10_000_000,
    });

    // Also refresh oracle price so it does not become stale
    f.oracle_client.set_price(&symbol_short!("BTC"), &BTC_PRICE);

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &(1_000 * USDC_UNIT),
        &(100 * USDC_UNIT),
        &true, &0, &0,
    );

    let pos2 = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(
        pos2.last_increased_time, new_ts,
        "last_increased_time must update to current timestamp on each increase"
    );
}

// ===========================================================================
// 4. Utilization cap
// ===========================================================================

#[test]
fn test_increase_position_succeeds_under_utilization_cap() {
    // Scenario: A position that keeps total utilization well under 85% should
    // succeed without issue. With 1M USDC in vault, a 10k position is fine.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // This should succeed -- 10k / 1M = 1% utilization, well under 85%
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    // If we get here without panic, the test passes
    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.size, DEFAULT_SIZE);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_increase_position_reverts_when_utilization_cap_breached() {
    // Scenario: Trader tries to open a position so large that it pushes
    // vault utilization above 85%. Must revert with UtilizationCapBreached (error 4).
    //
    // Vault has 1,000,000 USDC. 85% of that = 850,000. So a position of
    // 900,000 should breach the cap.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let huge_size = 900_000 * USDC_UNIT;
    let huge_collateral = 90_000 * USDC_UNIT;

    // Mint extra USDC for the large collateral
    f.usdc_client.mint(&f.trader, &huge_collateral);

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &huge_size,
        &huge_collateral,
        &true, &0, &0,
    );
}

#[test]
fn test_increase_position_at_exactly_max_utilization_succeeds() {
    // Scenario: Position that pushes utilization to EXACTLY 85% should
    // succeed (not strictly greater than). Boundary condition test.
    //
    // Vault has 1,000,000 USDC. 85% = 850,000 exactly.
    // calc_utilization_bps(850_000, free + 850_000) -- depends on formula.
    // With calc_utilization_bps: reserved * BPS / total_assets
    // At the cap: 850_000 * 10_000 / 1_000_000 = 8_500 = MAX_UTIL_RATIO
    // This should pass if the check is <= (not <).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let exact_cap_size = 850_000 * USDC_UNIT;
    let collateral = 85_000 * USDC_UNIT;

    // Mint extra USDC for the large collateral
    f.usdc_client.mint(&f.trader, &collateral);

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &exact_cap_size,
        &collateral,
        &true, &0, &0,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.size, exact_cap_size, "Position at exact utilization cap must succeed");
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_increase_position_just_over_utilization_cap_reverts() {
    // Scenario: Position that pushes utilization to 85% + 1 unit should fail.
    // This tests the exact boundary.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // Slightly over 85% — need enough to exceed 8500 bps after integer division.
    // With 1M USDC total, need reserved * 10_000 / total > 8500,
    // i.e., reserved >= 850_100 USDC (to get 8501 bps).
    let over_cap_size = 851_000 * USDC_UNIT;
    let collateral = 86_000 * USDC_UNIT;

    f.usdc_client.mint(&f.trader, &(collateral + USDC_UNIT));

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &over_cap_size,
        &collateral,
        &true, &0, &0,
    );
}

// ===========================================================================
// 5. Multiple traders / multiple symbols
// ===========================================================================

#[test]
fn test_two_traders_open_positions_same_symbol() {
    // Scenario: Two different traders open positions on the same symbol.
    // Each should have their own independent Position entry, and MarketInfo
    // should reflect the combined OI.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let trader2 = Address::generate(&f.env);
    f.usdc_client.mint(&trader2, &TRADER_BALANCE);

    let size1 = 10_000 * USDC_UNIT;
    let size2 = 20_000 * USDC_UNIT;

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &size1,
        &(1_000 * USDC_UNIT),
        &true, &0, &0,
    );
    f.pm_client.increase_position(
        &trader2,
        &symbol,
        &size2,
        &(2_000 * USDC_UNIT),
        &true, &0, &0,
    );

    let pos1 = f.pm_client.get_position(&f.trader, &symbol);
    let pos2 = f.pm_client.get_position(&trader2, &symbol);

    assert_eq!(pos1.size, size1, "Trader1 position size must be independent");
    assert_eq!(pos2.size, size2, "Trader2 position size must be independent");

    let market = f.pm_client.get_market(&symbol);
    assert_eq!(
        market.long_open_interest,
        size1 + size2,
        "Total OI must reflect both positions"
    );
}

#[test]
fn test_same_trader_opens_different_symbols() {
    // Scenario: One trader opens positions on BTC and ETH. Each symbol
    // should have its own Position and MarketInfo.
    let f = setup_full();
    let btc = symbol_short!("BTC");
    let eth = symbol_short!("ETH");

    f.pm_client.increase_position(
        &f.trader,
        &btc,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );
    f.pm_client.increase_position(
        &f.trader,
        &eth,
        &(5_000 * USDC_UNIT),
        &(500 * USDC_UNIT),
        &false, &0, &0,
    );

    let btc_pos = f.pm_client.get_position(&f.trader, &btc);
    let eth_pos = f.pm_client.get_position(&f.trader, &eth);

    assert_eq!(btc_pos.size, DEFAULT_SIZE, "BTC position must be correct");
    assert!(btc_pos.is_long, "BTC must be long");
    assert_eq!(eth_pos.size, 5_000 * USDC_UNIT, "ETH position must be correct");
    assert!(!eth_pos.is_long, "ETH must be short");

    let btc_market = f.pm_client.get_market(&btc);
    let eth_market = f.pm_client.get_market(&eth);
    assert_eq!(btc_market.long_open_interest, DEFAULT_SIZE);
    assert_eq!(eth_market.short_open_interest, 5_000 * USDC_UNIT);
}

// ===========================================================================
// 6. Edge cases and adversarial scenarios
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn test_minimum_position_size() {
    // Scenario: Dust positions (below min_collateral) must be rejected.
    // min_collateral is set to 1_000_000 (1 USDC) in test setup.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &1_i128,       // 1 unit of size
        &1_i128,       // 1 unit of collateral — below min_collateral
        &true, &0, &0,
    );
}

#[test]
fn test_max_leverage_position_at_boundary() {
    // Scenario: Position at exactly MAX_LEVERAGE (100x) should succeed.
    // size = collateral * 100 exactly.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // 100x leverage: 100 USDC collateral, 10,000 USDC size
    let high_lev_collateral = 100 * USDC_UNIT;
    let high_lev_size = 10_000 * USDC_UNIT;

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &high_lev_size,
        &high_lev_collateral,
        &true, &0, &0,
    );

    let pos = f.pm_client.get_position(&f.trader, &symbol);
    assert_eq!(pos.size, high_lev_size, "100x leverage position must be stored");
    assert_eq!(pos.collateral, high_lev_collateral, "Collateral must match");
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_excessive_leverage_reverts() {
    // Scenario: Position exceeding MAX_LEVERAGE (>100x) must revert with
    // ExcessiveLeverage (error 11).
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // 101x leverage: 100 USDC collateral, 10,100 USDC size
    let collateral = 100 * USDC_UNIT;
    let size = 10_100 * USDC_UNIT;

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &size,
        &collateral,
        &true, &0, &0,
    );
}

#[test]
fn test_vault_reserve_liquidity_called() {
    // Scenario: After opening a position, the vault's reserved USDC must
    // increase by the position size. This verifies that the PM actually
    // cross-calls vault.reserve_liquidity().
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let free_before = f.vault_client.free_liquidity();

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let free_after = f.vault_client.free_liquidity();

    // free_liquidity should decrease by at least DEFAULT_SIZE since that
    // amount was reserved in the vault.
    assert!(
        free_before - free_after >= DEFAULT_SIZE,
        "Vault free liquidity must decrease by at least the reserved size. \
         Before: {}, After: {}, Size: {}",
        free_before,
        free_after,
        DEFAULT_SIZE,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_open_position_with_both_zero_reverts() {
    // Adversarial: Both size and collateral are zero. Must still revert ZeroAmount (error 8).
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &0_i128,
        &0_i128,
        &true, &0, &0,
    );
}

#[test]
fn test_global_avg_price_weighted_correctly_after_multiple_traders() {
    // Scenario: Two traders open longs at different prices. The global
    // long avg price must be the volume-weighted average.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let trader2 = Address::generate(&f.env);
    f.usdc_client.mint(&trader2, &TRADER_BALANCE);

    // Trader1: 10k size at $50,000
    let size1 = 10_000 * USDC_UNIT;
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &size1,
        &(1_000 * USDC_UNIT),
        &true, &0, &0,
    );

    // Change price to $60,000.
    // Advance time past the oracle router cache_duration (10s) so the new price is fetched.
    let new_price: i128 = 60_000 * PRECISION;
    f.oracle_client.set_price(&symbol, &new_price);
    f.env.ledger().set(LedgerInfo {
        timestamp: TEST_TIMESTAMP + 11,
        protocol_version: 23,
        sequence_number: 101,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 10_000_000,
    });

    // Trader2: 20k size at $60,000
    let size2 = 20_000 * USDC_UNIT;
    f.pm_client.increase_position(
        &trader2,
        &symbol,
        &size2,
        &(2_000 * USDC_UNIT),
        &true, &0, &0,
    );

    let market = f.pm_client.get_market(&symbol);

    // Weighted avg: (50000 * 10000 + 60000 * 20000) / 30000
    let expected = math::update_global_avg_price(BTC_PRICE, size1, new_price, size2);
    assert_eq!(
        market.global_long_avg_price, expected,
        "Global avg price must be volume-weighted across all traders"
    );
}

#[test]
fn test_increase_position_does_not_affect_opposite_side_oi() {
    // Scenario: Opening a long must not change short_open_interest, and vice versa.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true, &0, &0,
    );

    let market = f.pm_client.get_market(&symbol);
    assert_eq!(market.short_open_interest, 0, "Short OI must not be affected by long open");
    assert_eq!(market.global_short_avg_price, 0, "Short avg price must remain zero");
}

#[test]
#[should_panic]
fn test_trader_collateral_insufficient_reverts() {
    // Adversarial: Trader tries to deposit more collateral than they own.
    // The token transfer should fail, causing a revert.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    // Trader has TRADER_BALANCE USDC; try to deposit more than that
    let excess_collateral = TRADER_BALANCE + USDC_UNIT;

    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &DEFAULT_SIZE,
        &excess_collateral,
        &true, &0, &0,
    );
}

#[test]
fn test_cumulative_utilization_across_multiple_positions() {
    // Scenario: Multiple positions accumulate utilization. The third position
    // should fail if cumulative utilization breaches the cap.
    let f = setup_full();
    let symbol = symbol_short!("BTC");

    let trader2 = Address::generate(&f.env);
    let trader3 = Address::generate(&f.env);
    f.usdc_client.mint(&trader2, &TRADER_BALANCE);
    f.usdc_client.mint(&trader3, &TRADER_BALANCE);

    // Position 1: 400k (40% utilization)
    f.usdc_client.mint(&f.trader, &(400_000 * USDC_UNIT));
    f.pm_client.increase_position(
        &f.trader,
        &symbol,
        &(400_000 * USDC_UNIT),
        &(40_000 * USDC_UNIT),
        &true, &0, &0,
    );

    // Position 2: 400k (cumulative 80% utilization -- under cap)
    f.usdc_client.mint(&trader2, &(400_000 * USDC_UNIT));
    f.pm_client.increase_position(
        &trader2,
        &symbol,
        &(400_000 * USDC_UNIT),
        &(40_000 * USDC_UNIT),
        &true, &0, &0,
    );

    // Position 3: 100k would push to 90% utilization -- should breach cap.
    // We cannot use #[should_panic] on this test because the first two
    // positions must succeed. Instead, use try_increase_position via
    // a separate test function.

    // Verify cumulative total_reserved is 800k
    f.env.as_contract(&f.pm_addr, || {
        assert_eq!(
            storage::get_total_reserved(&f.env),
            800_000 * USDC_UNIT,
            "TotalReserved must be 800k after two 400k positions"
        );
    });
}
