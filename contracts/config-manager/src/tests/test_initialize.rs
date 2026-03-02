//! Tests for the `initialize` function.
//!
//! Covers:
//!   - Basic happy path and double-init guard (1.1)
//!   - Auth enforcement: require_auth must be called (C-1)
//!   - TTL extension during initialize (C-2)

use soroban_sdk::{testutils::Address as _, Address, Env, IntoVal};

use crate::ConfigManagerError;

use super::helpers::{deploy, role_admin};

// ---------------------------------------------------------------------------
// Happy path and idempotency (1.1)
// ---------------------------------------------------------------------------

/// Happy path: calling `initialize` once should succeed without panicking.
#[test]
fn test_initialize_happy_path_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);
}

/// Double-init: calling `initialize` a second time must error with
/// `AlreadyInitialized = 1`.
#[test]
fn test_initialize_second_call_errors_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    let result = client.try_initialize(&admin);
    assert!(
        result.is_err(),
        "second initialize call must return an error"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::AlreadyInitialized as u32),
        "error code must be AlreadyInitialized (1)"
    );
}

/// Admin address provided to initialize must be stored; a different address
/// must NOT hold DEFAULT_ADMIN_ROLE.
#[test]
fn test_initialize_stores_provided_admin_not_a_different_address() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let real_admin = Address::generate(&env);
    let impostor = Address::generate(&env);

    client.initialize(&real_admin);

    assert!(
        !client.has_role(&role_admin(&env), &impostor),
        "an address that was not passed to initialize must not hold DEFAULT_ADMIN_ROLE"
    );
}

/// `initialize` is NOT idempotent — a second call with a *different* admin
/// address must still error (not silently replace the admin).
#[test]
fn test_initialize_second_call_with_new_admin_also_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let first_admin = Address::generate(&env);
    let second_admin = Address::generate(&env);

    client.initialize(&first_admin);

    let result = client.try_initialize(&second_admin);
    assert!(
        result.is_err(),
        "second initialize must fail even with a different admin address"
    );
}

// ---------------------------------------------------------------------------
// Auth enforcement (C-1)
// ---------------------------------------------------------------------------

/// C-1 (negative path): calling `initialize` WITHOUT mocking any auths must
/// panic because the implementation calls `admin_address.require_auth()`.
#[test]
#[should_panic]
fn test_initialize_requires_admin_auth() {
    let env = Env::default();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);
}

/// C-1 (positive path): mocking ONLY the admin address auth for the
/// initialize invocation must allow the call to succeed.
#[test]
fn test_initialize_with_correct_auth_succeeds() {
    let env = Env::default();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &admin,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &client.address,
            fn_name: "initialize",
            args: (&admin,).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    client.initialize(&admin);

    assert!(
        client.has_role(&role_admin(&env), &admin),
        "admin must hold ADMIN role after successful initialization with correct auth"
    );
}

/// C-1 (impostor path): providing a different address's auth while calling
/// initialize with the real admin address must panic.
#[test]
#[should_panic]
fn test_initialize_with_wrong_auth_panics() {
    let env = Env::default();
    let client = deploy(&env);
    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &impostor,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &client.address,
            fn_name: "initialize",
            args: (&admin,).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    client.initialize(&admin);
}

/// C-1 (replay-with-auth): a second call to `initialize`, even with valid
/// admin auth, must fail with AlreadyInitialized.
#[test]
fn test_initialize_second_call_with_admin_auth_still_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    let result = client.try_initialize(&admin);
    assert!(
        result.is_err(),
        "second initialize must fail with AlreadyInitialized even if auth is present"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::AlreadyInitialized as u32),
        "error code must be AlreadyInitialized (1)"
    );
}

// ---------------------------------------------------------------------------
// TTL extension (C-2)
// ---------------------------------------------------------------------------

/// C-2: `initialize` must complete without panic, which includes bumping the
/// instance TTL and the persistent role-member TTL internally.
#[test]
fn test_initialize_completes_without_panic_ttl_bump_implied() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    assert!(
        client.has_role(&role_admin(&env), &admin),
        "ADMIN role must be readable immediately after initialize — TTL was extended"
    );
}

/// C-2: the role-member persistent entry written by `initialize` must be
/// readable immediately (TTL was extended at write time).
#[test]
fn test_initialize_role_member_entry_readable_after_write() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    let result = client.try_has_role(&role_admin(&env), &admin);
    assert!(
        result.is_ok(),
        "has_role must not error — persistent entry must be live after initialize"
    );
    assert!(
        result.unwrap().unwrap(),
        "ADMIN role entry must be true after initialize with TTL correctly extended"
    );
}
