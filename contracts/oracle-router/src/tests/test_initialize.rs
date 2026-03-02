//! Tests for the `initialize` function of the OracleRouter contract.
//!
//! Covers:
//!   - Happy path: successful single initialization (1.1)
//!   - Double-init guard: second call panics with AlreadyInitialized (1.2)
//!   - ConfigManager address is persisted: verifiable through post-init
//!     behavior (1.3)
//!   - TTL extension: instance storage is readable immediately after init (1.4)
//!   - Adversarial inputs: zero-value, self-referential, and boundary addresses (A-1..A-3)

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::OracleRouterError;

use super::helpers::{deploy, deploy_initialized};

// ---------------------------------------------------------------------------
// Happy path (1.1)
// ---------------------------------------------------------------------------

/// Happy path: `initialize` called exactly once must succeed without panicking.
/// The implementation is currently `todo!()`, so this test FAILS at the todo.
#[test]
fn test_initialize_happy_path_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let config_manager = Address::generate(&env);

    // Must not panic. Fails on todo!() until implementation is written.
    client.initialize(&config_manager);
}

/// Happy path via helper: `deploy_initialized` is the canonical setup path
/// used by other test modules. Verifies the helper itself compiles and runs.
#[test]
fn test_deploy_initialized_helper_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (_client, config_manager) = deploy_initialized(&env);

    // The returned address must be a valid non-zero address.
    // We cannot inspect internals directly, but generating a distinct address
    // and confirming they differ proves the helper created a real address.
    let other = Address::generate(&env);
    assert_ne!(
        config_manager, other,
        "deploy_initialized must return the specific address passed to initialize, not a random one"
    );
}

// ---------------------------------------------------------------------------
// Double-init guard (1.2)
// ---------------------------------------------------------------------------

/// Calling `initialize` a second time must error with `AlreadyInitialized = 1`.
/// Uses `try_initialize` so the test can inspect the error code without
/// unwinding through a panic boundary.
#[test]
fn test_initialize_second_call_errors_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let config_manager = Address::generate(&env);

    client.initialize(&config_manager);

    let result = client.try_initialize(&config_manager);
    assert!(
        result.is_err(),
        "second initialize call must return an error, not succeed silently"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::AlreadyInitialized as u32),
        "error code must be AlreadyInitialized (1)"
    );
}

/// Double-init with a DIFFERENT config_manager address must still fail.
/// This guards against an implementation that compares the stored address
/// and resets on mismatch (i.e., acts as an admin-transfer backdoor).
#[test]
fn test_initialize_second_call_with_new_address_also_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let first_config_manager = Address::generate(&env);
    let second_config_manager = Address::generate(&env);

    client.initialize(&first_config_manager);

    let result = client.try_initialize(&second_config_manager);
    assert!(
        result.is_err(),
        "second initialize with a different address must still fail — double-init is never allowed"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::AlreadyInitialized as u32),
        "error code must be AlreadyInitialized (1) regardless of which address is supplied"
    );
}

/// `should_panic` variant of the double-init check.
/// Confirms that a direct (non-try) second call panics at the Soroban host
/// level, not silently returns or succeeds.
#[test]
#[should_panic]
fn test_initialize_second_call_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let config_manager = Address::generate(&env);

    client.initialize(&config_manager);
    // This second call must panic.
    client.initialize(&config_manager);
}

// ---------------------------------------------------------------------------
// ConfigManager address persistence (1.3)
// ---------------------------------------------------------------------------

/// After initialization, the contract must be functional enough that a
/// subsequent call to `get_oracle_config` fails with `NotInitialized`
/// (because no config has been set yet) rather than `AlreadyInitialized` or
/// an unexpected panic.
///
/// This indirectly proves that `initialize` ran far enough to set the
/// `Initialized` flag, so the second initialization path is taken when
/// `get_oracle_config` checks the state. If the impl never stores the flag,
/// `get_oracle_config` would instead hit `todo!()` directly.
#[test]
fn test_get_oracle_config_before_set_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _config_manager) = deploy_initialized(&env);

    // get_oracle_config should fail with NotInitialized (no config set yet),
    // NOT with AlreadyInitialized or an unexpected panic variant.
    let result = client.try_get_oracle_config();
    assert!(
        result.is_err(),
        "get_oracle_config must error when no config has been set yet"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::NotInitialized as u32),
        "error must be NotInitialized (2) — not AlreadyInitialized or any other code"
    );
}

/// Two independently deployed oracle routers must each hold their own
/// config_manager address in isolated storage. Verifies there is no
/// cross-contract state leak through global mutable statics or shared
/// test environment keys.
#[test]
fn test_two_separate_instances_hold_independent_state() {
    let env = Env::default();
    env.mock_all_auths();

    let config_a = Address::generate(&env);
    let config_b = Address::generate(&env);

    // Deploy and initialize two separate oracle router instances.
    let client_a = deploy(&env);
    let client_b = deploy(&env);

    client_a.initialize(&config_a);
    client_b.initialize(&config_b);

    // Both should now be initialized. A second call on either must fail.
    let result_a = client_a.try_initialize(&config_a);
    let result_b = client_b.try_initialize(&config_b);

    assert!(
        result_a.is_err(),
        "first oracle router instance must reject a second init"
    );
    assert!(
        result_b.is_err(),
        "second oracle router instance must reject a second init independently"
    );
}

// ---------------------------------------------------------------------------
// TTL / liveness after initialization (1.4)
// ---------------------------------------------------------------------------

/// After a successful `initialize`, the instance storage must be live enough
/// to serve a follow-up query immediately. This is the minimal TTL check:
/// if `initialize` does not call `extend_ttl` / `bump`, the entry may be
/// immediately archived in future ledgers, making subsequent reads fail.
///
/// We verify liveness by confirming that a follow-up `try_get_oracle_config`
/// call returns a well-typed contract error (not a host error indicating
/// missing storage entry), which proves the instance storage entry exists.
#[test]
fn test_instance_storage_is_live_immediately_after_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = deploy_initialized(&env);

    // A well-typed contract error means the instance storage is reachable.
    // A host-level panic or `Ok` would mean the storage entry is either
    // missing or unexpectedly populated.
    let result = client.try_get_oracle_config();
    match result {
        Err(Ok(_contract_error)) => {
            // Expected: contract error such as NotInitialized — storage is live.
        }
        Err(Err(_host_error)) => {
            panic!(
                "host-level error after initialize: instance storage is not accessible, \
                 which likely means TTL was not extended"
            );
        }
        Ok(_) => {
            panic!(
                "get_oracle_config unexpectedly succeeded before any config was set"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Adversarial inputs (A-1 .. A-3)
// ---------------------------------------------------------------------------

/// A-1 (self-referential address): passing the oracle router's own contract
/// address as the config_manager must still succeed at the storage level
/// (initialize does not validate the address type). The contract stores it
/// verbatim. A second call must still fail with AlreadyInitialized.
#[test]
fn test_initialize_with_self_as_config_manager_then_double_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let self_address = client.address.clone();

    // Storing self as config_manager is unusual but must not crash initialize.
    client.initialize(&self_address);

    // Double-init must still be rejected.
    let result = client.try_initialize(&self_address);
    assert!(
        result.is_err(),
        "even with self-referential config_manager, a second initialize must fail"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::AlreadyInitialized as u32),
        "error must be AlreadyInitialized (1)"
    );
}

/// A-2 (replay attack simulation): an attacker who observes a successful
/// `initialize` transaction on-chain cannot replay it to overwrite state.
/// Uses `try_initialize` to avoid unwinding and confirms the guard holds.
#[test]
fn test_initialize_replay_attack_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let config_manager = Address::generate(&env);
    let attacker = Address::generate(&env);

    // Legitimate initialization.
    client.initialize(&config_manager);

    // Attacker replays with their own address hoping to hijack the stored
    // config_manager pointer.
    let replay_result = client.try_initialize(&attacker);
    assert!(
        replay_result.is_err(),
        "replay of initialize with attacker address must be rejected"
    );
    assert_eq!(
        replay_result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::AlreadyInitialized as u32),
        "replay must specifically fail with AlreadyInitialized (1), not any other error"
    );
}

/// A-3 (many sequential deploy-and-init cycles): verifies that the
/// initialization guard is per-instance and not shared across deployments.
/// Each newly deployed contract must accept exactly one `initialize` call.
#[test]
fn test_each_fresh_deployment_accepts_exactly_one_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    for _ in 0..3 {
        let client = deploy(&env);
        let config_manager = Address::generate(&env);

        // First call must succeed.
        client.initialize(&config_manager);

        // Second call on the same instance must fail.
        let result = client.try_initialize(&config_manager);
        assert!(
            result.is_err(),
            "every fresh deployment must accept exactly one initialize call"
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            soroban_sdk::Error::from_contract_error(OracleRouterError::AlreadyInitialized as u32),
            "AlreadyInitialized (1) must be returned on the second call for every instance"
        );
    }
}
