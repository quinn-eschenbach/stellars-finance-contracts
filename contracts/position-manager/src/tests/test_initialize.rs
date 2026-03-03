// ---------------------------------------------------------------------------
// Tests for: logic guards (require_initialized, require_not_paused, etc.)
//            and the initialize / pause / unpause contract entry points.
//
// These tests are written BEFORE the implementation (TDD).  They MUST compile
// but are expected to FAIL until logic.rs and contract.rs are implemented.
// ---------------------------------------------------------------------------

use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, symbol_short};

use crate::contract::PositionManagerContract;
use crate::errors::PositionManagerError;
use crate::logic;
use crate::storage;
use crate::PositionManagerClient;

// ===========================================================================
// Helpers
// ===========================================================================

/// Register the contract and return (env, client, vault, config_mgr, oracle, admin).
/// `mock_all_auths` is enabled so that require_auth calls do not block tests.
fn setup_test() -> (
    Env,
    PositionManagerClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PositionManagerContract, ());
    let client = PositionManagerClient::new(&env, &contract_id);
    let vault = Address::generate(&env);
    let config_mgr = Address::generate(&env);
    let oracle = Address::generate(&env);
    let admin = Address::generate(&env);
    (env, client, vault, config_mgr, oracle, admin)
}

/// Register the contract and run a closure inside its storage context
/// (for direct unit-testing of internal functions).
fn with_contract<F: FnOnce(&Env, &Address)>(f: F) {
    let env = Env::default();
    let contract_id = env.register(PositionManagerContract, ());
    env.as_contract(&contract_id, || f(&env, &contract_id));
}

// ===========================================================================
// Unit tests for logic::require_initialized
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_require_initialized_panics_when_not_initialized() {
    // Scenario: Contract has never been initialized. Calling require_initialized
    // must panic with PositionManagerError::NotInitialized (error code 2).
    with_contract(|env, _| {
        logic::require_initialized(env);
    });
}

#[test]
fn test_require_initialized_passes_after_init() {
    // Scenario: After setting the Initialized flag in storage, the guard
    // should pass without panicking.
    with_contract(|env, _| {
        storage::set_initialized(env);
        logic::require_initialized(env);
        // If we reach here, the guard passed -- test is green.
    });
}

// ===========================================================================
// Unit tests for logic::require_not_initialized
// ===========================================================================

#[test]
fn test_require_not_initialized_passes_when_fresh() {
    // Scenario: On a freshly registered contract (Initialized = false),
    // require_not_initialized should succeed without panicking.
    with_contract(|env, _| {
        logic::require_not_initialized(env);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_require_not_initialized_panics_when_already_initialized() {
    // Scenario: Once initialized, calling require_not_initialized must
    // panic with AlreadyInitialized (error code 1).
    with_contract(|env, _| {
        storage::set_initialized(env);
        logic::require_not_initialized(env);
    });
}

// ===========================================================================
// Unit tests for logic::require_not_paused
// ===========================================================================

#[test]
fn test_require_not_paused_passes_when_unpaused() {
    // Scenario: Default state is unpaused. Guard should pass.
    with_contract(|env, _| {
        logic::require_not_paused(env);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_require_not_paused_panics_when_paused() {
    // Scenario: When IsPaused is set to true, require_not_paused must panic
    // with Paused (error code 3).
    with_contract(|env, _| {
        storage::set_paused(env, true);
        logic::require_not_paused(env);
    });
}

#[test]
fn test_require_not_paused_passes_after_unpause() {
    // Scenario: Contract was paused then unpaused. Guard should pass again.
    with_contract(|env, _| {
        storage::set_paused(env, true);
        storage::set_paused(env, false);
        logic::require_not_paused(env);
    });
}

// ===========================================================================
// Contract-level: initialize happy path
// ===========================================================================

#[test]
fn test_initialize_stores_addresses() {
    // Scenario: Calling initialize once should succeed and store the vault,
    // config_manager, and oracle_router addresses. Subsequent reads of those
    // storage keys (via a view call) should not panic.
    let (env, client, vault, config_mgr, oracle, _admin) = setup_test();
    client.initialize(&vault, &config_mgr, &oracle);

    // Verify by reading storage directly inside the contract context.
    env.as_contract(&client.address, || {
        assert!(storage::is_initialized(&env), "Initialized flag must be true");
        assert_eq!(
            storage::get_vault_address(&env),
            vault,
            "Vault address must match"
        );
        assert_eq!(
            storage::get_config_manager(&env),
            config_mgr,
            "ConfigManager address must match"
        );
        assert_eq!(
            storage::get_oracle_router(&env),
            oracle,
            "OracleRouter address must match"
        );
    });
}

#[test]
fn test_initialize_sets_paused_to_false() {
    // Scenario: After initialization, the contract should not be paused.
    let (env, client, vault, config_mgr, oracle, _admin) = setup_test();
    client.initialize(&vault, &config_mgr, &oracle);

    env.as_contract(&client.address, || {
        assert_eq!(
            storage::get_paused(&env),
            false,
            "Contract must not be paused after init"
        );
    });
}

// ===========================================================================
// Contract-level: initialize double call reverts
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_double_call_reverts() {
    // Scenario: Calling initialize a second time must revert with
    // AlreadyInitialized (error code 1). This prevents an attacker from
    // re-initializing the contract with different addresses.
    let (_env, client, vault, config_mgr, oracle, _admin) = setup_test();
    client.initialize(&vault, &config_mgr, &oracle);
    // Second call must panic.
    client.initialize(&vault, &config_mgr, &oracle);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_double_call_different_addresses_reverts() {
    // Adversarial: An attacker tries to re-initialize with completely
    // different addresses to redirect the vault/oracle. Must still fail.
    let (env, client, vault, config_mgr, oracle, _admin) = setup_test();
    client.initialize(&vault, &config_mgr, &oracle);

    let evil_vault = Address::generate(&env);
    let evil_config = Address::generate(&env);
    let evil_oracle = Address::generate(&env);
    client.initialize(&evil_vault, &evil_config, &evil_oracle);
}

// ===========================================================================
// Contract-level: operations revert before initialize
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_increase_position_before_init_reverts() {
    // Scenario: Calling increase_position on an uninitialized contract must
    // panic with NotInitialized (error code 2).
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let trader = Address::generate(&env);
    let symbol = symbol_short!("BTC");
    client.increase_position(&trader, &symbol, &1000_i128, &100_i128, &true, &0, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_get_position_before_init_reverts() {
    // Scenario: Calling get_position on an uninitialized contract must
    // panic with NotInitialized (error code 2). Even read-only views
    // should enforce the initialization guard.
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let trader = Address::generate(&env);
    let symbol = symbol_short!("BTC");
    client.get_position(&trader, &symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_get_market_before_init_reverts() {
    // Scenario: get_market on an uninitialized contract must panic.
    let (_env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let symbol = symbol_short!("BTC");
    client.get_market(&symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_decrease_position_before_init_reverts() {
    // Scenario: decrease_position before init must panic NotInitialized.
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let trader = Address::generate(&env);
    let symbol = symbol_short!("BTC");
    client.decrease_position(&trader, &symbol, &500_i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_liquidate_position_before_init_reverts() {
    // Scenario: liquidate_position before init must panic NotInitialized.
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let caller = Address::generate(&env);
    let trader = Address::generate(&env);
    let symbol = symbol_short!("BTC");
    client.liquidate_position(&caller, &trader, &symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_update_indices_before_init_reverts() {
    // Scenario: update_indices before init must panic NotInitialized.
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let caller = Address::generate(&env);
    let symbol = symbol_short!("BTC");
    client.update_indices(&caller, &symbol);
}

// ===========================================================================
// Contract-level: pause / unpause revert before init
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_pause_reverts_before_init() {
    // Scenario: pause() must check initialization first. If the contract
    // is not initialized, it should panic NotInitialized (error code 2).
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let pauser = Address::generate(&env);
    client.pause(&pauser);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_unpause_reverts_before_init() {
    // Scenario: unpause() must check initialization first.
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let pauser = Address::generate(&env);
    client.unpause(&pauser);
}

// ===========================================================================
// Contract-level: execute_order / deleverage_position before init
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_execute_order_before_init_reverts() {
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let caller = Address::generate(&env);
    let trader = Address::generate(&env);
    let symbol = soroban_sdk::symbol_short!("BTC");
    client.execute_order(&caller, &trader, &symbol);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_deleverage_position_before_init_reverts() {
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let caller = Address::generate(&env);
    let trader = Address::generate(&env);
    let symbol = symbol_short!("BTC");
    client.deleverage_position(&caller, &trader, &symbol);
}

// ===========================================================================
// Adversarial: initialize with zero-address / self-referencing
// ===========================================================================

#[test]
fn test_initialize_with_same_address_for_all() {
    // Adversarial: Passing the same address for vault, config_manager, and
    // oracle_router. The contract should either reject this or at minimum
    // store the addresses correctly without confusion.
    let (env, client, _vault, _config_mgr, _oracle, _admin) = setup_test();
    let same_addr = Address::generate(&env);
    client.initialize(&same_addr, &same_addr, &same_addr);

    env.as_contract(&client.address, || {
        assert_eq!(storage::get_vault_address(&env), same_addr);
        assert_eq!(storage::get_config_manager(&env), same_addr);
        assert_eq!(storage::get_oracle_router(&env), same_addr);
    });
}

#[test]
fn test_initialize_contract_address_as_vault() {
    // Adversarial: Pass the contract's own address as the vault address.
    // This is a self-referencing attack that should ideally be rejected,
    // but at minimum the contract should not break.
    let (_env, client, _vault, config_mgr, oracle, _admin) = setup_test();
    // Use the contract's own address as the vault.
    let self_addr = client.address.clone();
    client.initialize(&self_addr, &config_mgr, &oracle);
}
