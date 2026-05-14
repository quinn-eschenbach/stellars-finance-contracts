//! Tests for the `initialize` function.
//!
//! Covers:
//!   - Basic happy path and double-init guard (1.1)
//!   - Auth enforcement: require_auth must be called ()
//!   - TTL extension during initialize ()

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
// Auth enforcement ()
// ---------------------------------------------------------------------------

///  (negative path): calling `initialize` WITHOUT mocking any auths must
/// panic because the implementation calls `admin_address.require_auth()`.
#[test]
#[should_panic]
fn test_initialize_requires_admin_auth() {
    let env = Env::default();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);
}

///  (positive path): mocking ONLY the admin address auth for the
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

///  (impostor path): providing a different address's auth while calling
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

///  (replay-with-auth): a second call to `initialize`, even with valid
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
// TTL extension ()
// ---------------------------------------------------------------------------

/// `initialize` must complete without panic, which includes bumping the
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

/// the role-member persistent entry written by `initialize` must be
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

// ---------------------------------------------------------------------------
// Initialize emits seeded-default events so off-chain indexers populate
// `protocol_config` from ledger 0. Without these, the keeper's env-var
// fallback would mask a partially-empty config row.
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_emits_seeded_default_events() {
    use soroban_sdk::{testutils::Events as _, Symbol, TryIntoVal, Val};

    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    let cm_id = client.address.clone();
    let mut saw_feecfg = false;
    let mut saw_limits = false;
    let mut saw_rates = false;

    for (contract, topics, data) in env.events().all() {
        if contract != cm_id {
            continue;
        }
        if topics.len() == 0 {
            continue;
        }
        let topic0: Symbol = match topics.get(0).unwrap().try_into_val(&env) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if topic0 == Symbol::new(&env, "feecfg") {
            let parsed: Result<(u32, u32, u32), _> = data.try_into_val(&env);
            let (k, d, l) = parsed.expect("feecfg event must unpack as (u32, u32, u32)");
            assert_eq!(k, shared::constants::DEFAULT_KEEPER_BPS);
            assert_eq!(d, shared::constants::DEFAULT_DEV_BPS);
            assert_eq!(l, shared::constants::DEFAULT_LP_BPS);
            saw_feecfg = true;
        } else if topic0 == Symbol::new(&env, "limits") {
            let parsed: Result<(i128, u64, u64, i128, u32, u32, u32, u32), _> =
                data.try_into_val(&env);
            let tup = parsed.expect("limits event must unpack as 8-tuple including liquidation_threshold_bps");
            assert_eq!(tup.0, shared::constants::DEFAULT_MIN_COLLATERAL);
            assert_eq!(tup.1, shared::constants::DEFAULT_COOLDOWN_DURATION);
            assert_eq!(tup.7, shared::constants::DEFAULT_LIQUIDATION_THRESHOLD_BPS);
            saw_limits = true;
        } else if topic0 == Symbol::new(&env, "rates") {
            let parsed: Result<(i128, i128, i128, i128, i128), _> = data.try_into_val(&env);
            let tup = parsed.expect("rates event must unpack as 5-tuple");
            assert_eq!(tup.0, shared::constants::DEFAULT_BASE_BORROW_RATE_BPS);
            saw_rates = true;
        }
        let _: Val = topics.get(0).unwrap();
    }

    assert!(saw_feecfg, "initialize must emit a `feecfg` event with seeded defaults");
    assert!(saw_limits, "initialize must emit a `limits` event with seeded defaults");
    assert!(saw_rates, "initialize must emit a `rates` event with seeded defaults");
}
