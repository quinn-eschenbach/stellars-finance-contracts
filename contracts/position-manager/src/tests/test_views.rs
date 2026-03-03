// ---------------------------------------------------------------------------
// Tests for: bump_position, execute_order (V2 stub), get_position, get_market,
//            pause/unpause interaction
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

const BTC_PRICE: i128 = 50_000 * PRECISION;
const USDC_UNIT: i128 = 1_000_000;
const TRADER_BALANCE: i128 = 100_000 * USDC_UNIT;
const VAULT_DEPOSIT: i128 = 1_000_000 * USDC_UNIT;
const DEFAULT_SIZE: i128 = 10_000 * USDC_UNIT;
const DEFAULT_COLLATERAL: i128 = 1_000 * USDC_UNIT;
const TEST_TIMESTAMP: u64 = 1_700_000_000;

struct TestFixture<'a> {
    env: Env,
    pm_client: PositionManagerClient<'a>,
    config_client: ConfigManagerClient<'a>,
    usdc_client: MockTokenClient<'a>,
    admin: Address,
    keeper: Address,
    trader: Address,
    pm_addr: Address,
}

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

    let config_id = env.register(ConfigManagerContract, ());
    let config_client = ConfigManagerClient::new(&env, &config_id);
    config_client.initialize(&admin);

    let pauser_role = Symbol::new(&env, "PAUSER");
    let keeper_role = Symbol::new(&env, "KEEPER");
    let admin_role = Symbol::new(&env, "ADMIN");
    config_client.grant_role(&admin, &pauser_role, &admin);
    config_client.grant_role(&admin, &keeper_role, &admin);
    config_client.grant_role(&admin, &admin_role, &admin);
    config_client.grant_role(&admin, &keeper_role, &keeper);

    config_client.update_protocol_limits(&admin, &config_manager::ProtocolLimits {
        min_collateral: 1_000_000,
        cooldown_duration: 60,
        min_position_lifetime: 60,
        max_utilization_ratio: 8_500,
        funding_cut_bps: 500,
    });

    let usdc_id = env.register(MockToken, ());
    let usdc_client = MockTokenClient::new(&env, &usdc_id);
    usdc_client.initialize(
        &admin,
        &6u32,
        &soroban_sdk::String::from_str(&env, "USD Coin"),
        &soroban_sdk::String::from_str(&env, "USDC"),
    );

    let oracle_id = env.register(MockOracle, ());
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.initialize();
    oracle_client.set_price(&symbol_short!("BTC"), &BTC_PRICE);

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

    let pm_id = env.register(PositionManagerContract, ());
    let pm_client = PositionManagerClient::new(&env, &pm_id);

    let vault_id = env.register(VaultContract, ());
    let vault_client = VaultContractClient::new(&env, &vault_id);
    vault_client.initialize(&admin, &usdc_id, &config_id, &pm_id);

    pm_client.initialize(&vault_id, &config_id, &oracle_router_id);
    pm_client.set_max_leverage(&admin, &symbol_short!("BTC"), &100_i128);

    usdc_client.mint(&trader, &TRADER_BALANCE);
    usdc_client.mint(&lp, &VAULT_DEPOSIT);
    vault_client.deposit(&VAULT_DEPOSIT, &lp, &lp, &lp);

    let pm_client = unsafe { core::mem::transmute(pm_client) };
    let config_client = unsafe { core::mem::transmute(config_client) };
    let usdc_client = unsafe { core::mem::transmute(usdc_client) };

    TestFixture {
        env,
        pm_client,
        config_client,
        usdc_client,
        admin,
        keeper,
        trader,
        pm_addr: pm_id,
    }
}

// ===========================================================================
// bump_position
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_bump_position_reverts_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let pm_id = env.register(PositionManagerContract, ());
    let pm_client = PositionManagerClient::new(&env, &pm_id);
    let trader = Address::generate(&env);
    pm_client.bump_position(&trader, &symbol_short!("BTC"));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_bump_position_reverts_position_not_found() {
    let f = setup_full();
    f.pm_client
        .bump_position(&f.trader, &symbol_short!("BTC"));
}

#[test]
fn test_bump_position_succeeds_on_existing_position() {
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );
    // Should not panic
    f.pm_client
        .bump_position(&f.trader, &symbol_short!("BTC"));
}

#[test]
fn test_bump_position_callable_by_anyone() {
    // bump_position takes user_address (position owner) — no auth required.
    // Anyone can call it to keep positions alive on-chain.
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );
    // Calling with the trader's address should work regardless of who submits the tx
    f.pm_client
        .bump_position(&f.trader, &symbol_short!("BTC"));
}

// ===========================================================================
// execute_order (V2 stub)
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_execute_order_reverts_when_paused() {
    let f = setup_full();
    f.pm_client.pause(&f.admin);
    f.pm_client.execute_order(&f.keeper, &42_u64);
}

// ===========================================================================
// get_position
// ===========================================================================

#[test]
fn test_get_position_returns_correct_data() {
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );
    let pos = f
        .pm_client
        .get_position(&f.trader, &symbol_short!("BTC"));
    assert_eq!(pos.size, DEFAULT_SIZE);
    assert_eq!(pos.collateral, DEFAULT_COLLATERAL);
    assert_eq!(pos.entry_price, BTC_PRICE);
    assert!(pos.is_long);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_get_position_reverts_not_found() {
    let f = setup_full();
    f.pm_client
        .get_position(&f.trader, &symbol_short!("BTC"));
}

// ===========================================================================
// get_market
// ===========================================================================

#[test]
fn test_get_market_returns_defaults_for_unknown_symbol() {
    let f = setup_full();
    let market = f.pm_client.get_market(&symbol_short!("ETH"));
    assert_eq!(market.long_open_interest, 0);
    assert_eq!(market.short_open_interest, 0);
    assert_eq!(market.acc_borrow_index, 0);
    assert_eq!(market.acc_funding_index, 0);
}

#[test]
fn test_get_market_returns_correct_oi_after_increase() {
    let f = setup_full();
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );
    let market = f.pm_client.get_market(&symbol_short!("BTC"));
    assert_eq!(market.long_open_interest, DEFAULT_SIZE);
    assert_eq!(market.short_open_interest, 0);
}

// ===========================================================================
// pause / unpause interaction
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_increase_position_reverts_when_paused() {
    let f = setup_full();
    f.pm_client.pause(&f.admin);
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );
}

#[test]
fn test_unpause_allows_increase_position_again() {
    let f = setup_full();
    f.pm_client.pause(&f.admin);
    f.pm_client.unpause(&f.admin);
    // Should succeed after unpause
    f.pm_client.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &DEFAULT_SIZE,
        &DEFAULT_COLLATERAL,
        &true,
    );
    let pos = f
        .pm_client
        .get_position(&f.trader, &symbol_short!("BTC"));
    assert_eq!(pos.size, DEFAULT_SIZE);
}
