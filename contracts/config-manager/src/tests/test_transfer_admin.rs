//! Tests for F-2: admin transfer mechanism.
//!
//! Required semantics:
//!   1. Caller must hold ADMIN role; otherwise Unauthorized (3).
//!   2. Caller must provide auth; otherwise a host panic.
//!   3. After the call: new_admin holds ADMIN; old_admin does not.
//!   4. Former admin can no longer call grant_role.

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::ConfigManagerError;

use super::helpers::{deploy_initialized, role_admin, role_keeper};

/// F-2-a: Happy path — current admin transfers; new admin can grant_role; old cannot.
#[test]
fn test_transfer_admin_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, old_admin) = deploy_initialized(&env);
    let new_admin = Address::generate(&env);
    let keeper = Address::generate(&env);

    let transfer_result = client.try_transfer_admin(&old_admin, &new_admin);
    assert!(
        transfer_result.is_ok(),
        "F-2-a: transfer_admin must succeed for the current admin"
    );

    let keeper_role = role_keeper(&env);
    let grant_result = client.try_grant_role(&new_admin, &keeper_role, &keeper);
    assert!(
        grant_result.is_ok(),
        "F-2-a: new admin must be able to call grant_role after transfer_admin"
    );

    let victim = Address::generate(&env);
    let old_grant_result = client.try_grant_role(&old_admin, &keeper_role, &victim);
    assert!(
        old_grant_result.is_err(),
        "F-2-a: old admin must no longer be able to call grant_role after transfer"
    );
}

/// F-2-b: After transfer, has_role("ADMIN", new_admin) is true and has_role("ADMIN", old_admin) is false.
#[test]
fn test_transfer_admin_updates_has_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, old_admin) = deploy_initialized(&env);
    let new_admin = Address::generate(&env);

    let admin_role = role_admin(&env);

    assert!(
        client.has_role(&admin_role, &old_admin),
        "F-2-b precondition: old_admin must hold ADMIN before transfer"
    );

    let transfer_result = client.try_transfer_admin(&old_admin, &new_admin);
    assert!(
        transfer_result.is_ok(),
        "F-2-b: transfer_admin must succeed for the current admin"
    );

    assert!(
        client.has_role(&admin_role, &new_admin),
        "F-2-b: new_admin must hold ADMIN role after transfer_admin"
    );
    assert!(
        !client.has_role(&admin_role, &old_admin),
        "F-2-b: old_admin must no longer hold ADMIN role after transfer_admin"
    );
}

/// F-2-c: A non-admin address calling transfer_admin must receive Unauthorized (3).
#[test]
fn test_transfer_admin_non_admin_cannot_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy_initialized(&env);
    let attacker = Address::generate(&env);
    let target = Address::generate(&env);

    let result = client.try_transfer_admin(&attacker, &target);
    assert!(
        result.is_err(),
        "F-2-c: non-admin calling transfer_admin must return an error"
    );
}

/// F-2-d: Calling transfer_admin without mocked auth must panic — `caller.require_auth()` is called.
#[test]
#[should_panic]
fn test_transfer_admin_requires_caller_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, old_admin) = deploy_initialized(&env);
    let new_admin = Address::generate(&env);

    // Clear auth — caller.require_auth() must panic.
    env.mock_auths(&[]);
    client.transfer_admin(&old_admin, &new_admin);
}

/// F-2-e: After transfer, the former admin calling grant_role must be rejected with Unauthorized (3).
#[test]
fn test_transfer_admin_old_admin_cannot_grant_after_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, old_admin) = deploy_initialized(&env);
    let new_admin = Address::generate(&env);
    let target = Address::generate(&env);

    let transfer_result = client.try_transfer_admin(&old_admin, &new_admin);
    assert!(
        transfer_result.is_ok(),
        "F-2-e precondition: transfer_admin must succeed"
    );

    let result = client.try_grant_role(&old_admin, &role_keeper(&env), &target);
    assert!(
        result.is_err(),
        "F-2-e: former admin must not be able to grant_role after transferring admin"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::Unauthorized as u32),
        "F-2-e: error code must be Unauthorized (3)"
    );
}
