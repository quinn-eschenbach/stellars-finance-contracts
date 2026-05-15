// ---------------------------------------------------------------------------
// Tests for: threshold-aware liquidation gate (atomic step 2 of feature)
//
// Atomic requirement: change the liquidation eligibility check in
// `do_liquidate_position` (close.rs) from `health >= 0` to a config-driven
// threshold:
//
//     liquidate when health < pos.collateral * liquidation_threshold_bps / 10_000
//
// `liquidation_threshold_bps` lives on `ProtocolLimits`, validated 0..=1000
// inclusive by ConfigManager (already implemented). Default = 200 bps (2%).
//
// These tests are written BEFORE the implementation (TDD). They MUST compile
// but will FAIL against the current code which still uses `health >= 0`.
//
// Notes:
//   - Math uses pos.collateral (the position's full collateral), NOT
//     collateral_delta — partial liquidations don't exist; close.rs:97 always
//     evaluates with `pos.size, pos.collateral`.
//   - The check is strict `<` so health == threshold_amount must NOT liquidate.
//   - threshold_bps == 0 collapses to legacy semantics: liquidate iff
//     health < 0 (i.e. health == 0 must NOT liquidate either).
// ---------------------------------------------------------------------------

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger, LedgerInfo},
    vec, Address, Env, Symbol,
};

use crate::contract::PositionManagerContract;
use shared::constants::PRECISION;
use crate::storage;
use crate::PositionManagerClient;

use config_manager::{ConfigManagerClient, ConfigManagerContract};
use mock_oracle::{MockOracle, MockOracleClient};
use mock_token::{MockToken, MockTokenClient};
use oracle_router::{OracleConfig, OracleRouterClient, OracleRouterContract};
use shared::ProtocolLimits;
use vault::{VaultContract, VaultContractClient};

// ===========================================================================
// Constants (mirror test_liquidate.rs — kept self-contained per repo
// convention; fixtures are not shared between test files)
// ===========================================================================

/// BTC entry price: $50,000 scaled by 1e7
const BTC_PRICE: i128 = 50_000 * PRECISION;

/// 1 USDC = 1_000_000 (6 decimals)
const USDC_UNIT: i128 = 1_000_000;

/// Trader starts with 100,000 USDC
const TRADER_BALANCE: i128 = 100_000 * USDC_UNIT;

/// Initial vault deposit (1,000,000 USDC) — large enough to never be the binding constraint
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
    config_client: ConfigManagerClient<'a>,
    _usdc_client: MockTokenClient<'a>,
    _usdc_addr: Address,
    admin: Address,
    keeper: Address,
    trader: Address,
    pm_addr: Address,
    _vault_addr: Address,
}

/// Deploy and wire up ALL protocol contracts needed for liquidation tests.
/// Mirrors the `setup_full` in test_liquidate.rs to keep this file self-contained.
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
    config_client.grant_role(&admin, &pauser_role, &admin);
    config_client.grant_role(&admin, &keeper_role, &admin);
    config_client.grant_role(&admin, &keeper_role, &keeper);

    // Default liquidation_threshold_bps = 200 (2% of collateral).
    config_client.update_protocol_limits(
        &admin,
        &ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 9_500,
            liquidation_threshold_bps: 200,
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
    oracle_router_client.initialize(&admin, &config_id);
    oracle_router_client.set_oracle_config(
        &admin,
        &OracleConfig {
            max_deviation_bps: 500,
            staleness_threshold: 3600,
            cache_duration: 10,
            min_required_sources: 1,
        },
    );
    oracle_router_client.set_oracle_sources(
        &admin,
        &symbol_short!("BTC"),
        &vec![&env, oracle_id.clone()]);

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
    let config_client = unsafe { core::mem::transmute(config_client) };
    let _usdc_client = unsafe { core::mem::transmute(usdc_client) };

    TestFixture {
        env,
        pm_client,
        _vault_client,
        oracle_client,
        _oracle_router_client,
        config_client,
        _usdc_client,
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

/// Open a long BTC position for the fixture's trader.
fn open_long_position(f: &TestFixture, size: i128, collateral: i128) {
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &size,
        &collateral,
        &true,
        &0,
        &0, &0i128
    );
}

/// Advance time and refresh oracle price (invalidates the oracle cache).
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

/// Update only `liquidation_threshold_bps`, keeping the other limits identical
/// to `setup_full`'s defaults.
fn set_liquidation_threshold(f: &TestFixture, threshold_bps: u32) {
    f.config_client.update_protocol_limits(
        &f.admin,
        &ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 9_500,
            liquidation_threshold_bps: threshold_bps,
        },
    );
}

// ===========================================================================
// 1. Liquidates when health is positive but BELOW threshold
// ===========================================================================

#[test]
fn test_liquidate_succeeds_when_health_positive_but_below_threshold() {
    // Math (default threshold = 200 bps, collateral = 1000 USDC):
    //   threshold_amount = 1000 * 200 / 10_000 = 20 USDC
    //
    // Long at $50,000, size = 10,000 USDC, collateral = 1,000 USDC.
    // Drop price to $45,050:
    //   pnl = 10_000 * (45_050 - 50_000) / 50_000 = -990 USDC
    //   health = 1_000 + (-990) = 10 USDC  (positive!)
    //
    // Under legacy semantics (health >= 0): NOT liquidatable (test would fail).
    // Under new semantics (health < 20): liquidatable. -> position deleted.
    let f = setup_full();
    let symbol = symbol_short!("BTC");
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    // pnl = -990 USDC -> health = +10 USDC, threshold = +20 USDC. 10 < 20 -> LIQUIDATE.
    let target_price: i128 = 45_050 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    // Confirm the position was deleted.
    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "Position with health (+10) below threshold (+20) must be liquidated"
        );
    });
}

// ===========================================================================
// 2. Reverts when health is positive AND above threshold
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_liquidate_reverts_when_health_above_threshold() {
    // Default threshold = 200 bps, collateral = 1000 -> threshold_amount = 20 USDC.
    //
    // Drop price to $48,000:
    //   pnl = 10_000 * (48_000 - 50_000) / 50_000 = -400 USDC
    //   health = 1_000 - 400 = +600 USDC.  600 > 20 -> NOT liquidatable.
    //
    // Must revert with HealthFactorOk (#9).
    let f = setup_full();
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    let target_price: i128 = 48_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

// ===========================================================================
// 3. Threshold = 0 enforces legacy strict-negative semantics
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_threshold_zero_health_positive_one_reverts() {
    // With threshold = 0, threshold_amount = 0. Check is `health < 0`.
    // health = +1 USDC must NOT be liquidatable (strict <).
    //
    // pnl = 1000 - 1 = -999 USDC -> mark = 50_000 - 999 * 50_000 / 10_000 = 45_005.
    let f = setup_full();
    set_liquidation_threshold(&f, 0);
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    let target_price: i128 = 45_005 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

#[test]
fn test_threshold_zero_health_negative_one_liquidates() {
    // With threshold = 0, health = -1 USDC must be liquidatable (legacy semantics).
    //
    // pnl = 1000 - (-1) ≈ -1001 USDC -> mark = 50_000 - 1001 * 50_000 / 10_000 = 44_995.
    let f = setup_full();
    set_liquidation_threshold(&f, 0);
    let symbol = symbol_short!("BTC");
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    let target_price: i128 = 44_995 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "With threshold=0, health=-1 must be liquidatable (legacy strict-negative)"
        );
    });
}

// ===========================================================================
// 4. Threshold = 1000 (10% cap) liquidates at 10% of collateral
// ===========================================================================

#[test]
fn test_threshold_1000_health_below_threshold_liquidates() {
    // ConfigManager validates threshold_bps in [0, 1000]. Test the upper bound.
    // threshold = 1000 bps, collateral = 1000 USDC -> threshold_amount = 100 USDC.
    //
    // Drop to $45,250:
    //   pnl = 10_000 * (45_250 - 50_000) / 50_000 = -950 USDC
    //   health = 1_000 - 950 = +50 USDC.  50 < 100 -> LIQUIDATE.
    let f = setup_full();
    set_liquidation_threshold(&f, 1_000);
    let symbol = symbol_short!("BTC");
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    let target_price: i128 = 45_250 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "Threshold=1000 (cap): health=+50 < threshold_amount=100 must liquidate"
        );
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_threshold_1000_health_above_threshold_reverts() {
    // threshold = 1000, threshold_amount = 100 USDC.
    //
    // Drop to $46,000:
    //   pnl = 10_000 * (46_000 - 50_000) / 50_000 = -800 USDC
    //   health = 1_000 - 800 = +200 USDC.  200 > 100 -> NOT liquidatable.
    let f = setup_full();
    set_liquidation_threshold(&f, 1_000);
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    let target_price: i128 = 46_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

// ===========================================================================
// 5. Boundary: exact-threshold reverts (strict `<`)
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_liquidate_reverts_when_health_just_above_threshold() {
    // The check is `health < threshold_amount` — strict, NOT `<=`. A position
    // sitting at-or-above the threshold must not be eligible for liquidation.
    //
    // Default threshold = 200 bps, collateral = 1000 USDC -> threshold_amount = 20 USDC.
    //
    // Drop to $45,110:
    //   pnl = 10_000 * (45_110 - 50_000) / 50_000 = -978 USDC
    //   health ≈ 1_000 - 978 = +22 USDC, which is +2 USDC above the threshold.
    //   (Hitting exact equality is impractical: a small borrow/funding fee accrues
    //   over the 75s TIME_ADVANCE window and would drop health below threshold.)
    //   22 > 20 -> REVERT.
    //
    // Note: the existing `test_liquidate_reverts_health_factor_ok_price_unchanged`
    // covers a much higher health (+1000 with no PnL). This test pins the
    // boundary much closer to the strict-`<` cliff.
    let f = setup_full();
    open_long_position(&f, DEFAULT_SIZE, DEFAULT_COLLATERAL);

    let target_price: i128 = 45_110 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}

// ===========================================================================
// 6. Threshold scales with collateral (not a fixed amount)
// ===========================================================================

#[test]
fn test_threshold_scales_with_collateral_liquidates() {
    // Different collateral size verifies threshold_amount is computed against
    // the position's actual collateral, NOT a fixed amount.
    //
    // collateral = 5,000 USDC (2x leverage), default threshold = 200 bps
    //   -> threshold_amount = 5_000 * 200 / 10_000 = 100 USDC.
    //
    // Drop price to $25,250:
    //   pnl = 10_000 * (25_250 - 50_000) / 50_000 = -4_950 USDC
    //   health = 5_000 - 4_950 = +50 USDC.  50 < 100 -> LIQUIDATE.
    //
    // (At collateral = 1000, threshold_amount = 20 USDC — health = 50 would NOT
    // be liquidatable. The success here proves the threshold tracks collateral.)
    let f = setup_full();
    let symbol = symbol_short!("BTC");
    let big_collateral: i128 = 5_000 * USDC_UNIT;
    open_long_position(&f, DEFAULT_SIZE, big_collateral);

    let target_price: i128 = 25_250 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol);

    f.env.as_contract(&f.pm_addr, || {
        let pos = storage::get_position(&f.env, &f.trader, &symbol);
        assert!(
            pos.is_none(),
            "Threshold must scale with pos.collateral: health=+50 < threshold_amount=100 must liquidate"
        );
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_threshold_scales_with_collateral_reverts_when_above() {
    // Companion to the test above: with the SAME collateral (5000 USDC) and the
    // SAME default threshold (200 bps), threshold_amount stays 100 USDC.
    //
    // Drop price to $26,000:
    //   pnl = 10_000 * (26_000 - 50_000) / 50_000 = -4_800 USDC
    //   health = 5_000 - 4_800 = +200 USDC.  200 > 100 -> NOT liquidatable.
    //
    // This guards against a buggy implementation that uses a fixed amount or
    // applies the threshold against `size` instead of `collateral`.
    let f = setup_full();
    let big_collateral: i128 = 5_000 * USDC_UNIT;
    open_long_position(&f, DEFAULT_SIZE, big_collateral);

    let target_price: i128 = 26_000 * PRECISION;
    advance_time_and_set_price(&f, TEST_TIMESTAMP + TIME_ADVANCE, target_price);

    f.pm_client
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));
}
