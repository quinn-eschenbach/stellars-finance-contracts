//! Tests for F-8: deposit fee setter.
//!
//! `set_deposit_fee(caller, fee_bps)` does not exist in the current
//! implementation. All tests will FAIL until the function is added.
//!
//! Required semantics:
//!   - Callable only by the ADMIN (Unauthorized otherwise).
//!   - fee_bps = 0 is valid (free deposits).
//!   - fee_bps > 10_000 is invalid (more than 100%).
//!   - fee_bps < 0 is invalid (negative fee makes no economic sense).

use soroban_sdk::{testutils::Address as _, Address, Env};

use super::helpers::deploy_initialized;

/// F-8-a: Admin sets fee_bps = 100; get_deposit_fee returns 100.
#[test]
fn test_set_deposit_fee_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let result = client.try_set_deposit_fee(&admin, &100_i128);
    assert!(
        result.is_ok(),
        "F-8-a: set_deposit_fee(100) must succeed for admin — currently fails with todo!()"
    );

    let stored = client.get_deposit_fee();
    assert_eq!(stored, 100_i128, "F-8-a: get_deposit_fee must return 100 after set_deposit_fee(100)");
}

/// F-8-b: fee_bps = 0 is valid (free deposits).
#[test]
fn test_set_deposit_fee_zero_is_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let result = client.try_set_deposit_fee(&admin, &0_i128);
    assert!(
        result.is_ok(),
        "F-8-b: fee_bps = 0 must succeed (zero deposit fee means free deposits)"
    );

    let stored = client.get_deposit_fee();
    assert_eq!(stored, 0_i128, "F-8-b: get_deposit_fee must return 0 after set_deposit_fee(0)");
}

/// F-8-c: fee_bps = 10_001 is above 100% and must be rejected.
#[test]
fn test_set_deposit_fee_above_10000_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let result = client.try_set_deposit_fee(&admin, &10_001_i128);
    assert!(
        result.is_err(),
        "F-8-c: fee_bps = 10_001 must return an error (cannot charge more than 100%)"
    );
}

/// F-8-d: fee_bps = -1 is negative and must be rejected.
#[test]
fn test_set_deposit_fee_negative_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let result = client.try_set_deposit_fee(&admin, &(-1_i128));
    assert!(
        result.is_err(),
        "F-8-d: fee_bps = -1 must return an error (negative fee is not valid)"
    );
}

/// F-8-e: Non-admin calling set_deposit_fee must be rejected with Unauthorized (3).
#[test]
fn test_set_deposit_fee_non_admin_errors_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = deploy_initialized(&env);
    let attacker = Address::generate(&env);

    let result = client.try_set_deposit_fee(&attacker, &100_i128);
    assert!(
        result.is_err(),
        "F-8-e: non-admin calling set_deposit_fee must return an error"
    );
}

/// F-8 boundary: fee_bps = 10_000 (exactly 100%) must succeed.
#[test]
fn test_set_deposit_fee_exactly_10000_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let result = client.try_set_deposit_fee(&admin, &10_000_i128);
    assert!(
        result.is_ok(),
        "F-8 boundary: fee_bps = 10_000 must succeed (100% is the maximum valid value)"
    );
}

/// F-8 adversarial: i128::MIN must be rejected cleanly.
#[test]
fn test_set_deposit_fee_i128_min_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let result = client.try_set_deposit_fee(&admin, &i128::MIN);
    assert!(result.is_err(), "F-8 adversarial: i128::MIN must return an error");
}

/// F-8 adversarial: i128::MAX must be rejected cleanly.
#[test]
fn test_set_deposit_fee_i128_max_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let result = client.try_set_deposit_fee(&admin, &i128::MAX);
    assert!(result.is_err(), "F-8 adversarial: i128::MAX must return an error");
}
