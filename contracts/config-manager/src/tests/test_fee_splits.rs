//! Tests for F-4: FeeSplits per-component floor validation.
//!
//! `update_fee_splits` must reject splits where any component is 0,
//! even when the sum == 10_000.
//!
//! Invalid-input tests FAIL against the current implementation (no per-component check).
//! Valid-input test PASSES (regression anchor).

use soroban_sdk::Env;

use crate::{ConfigManagerError, FeeSplits};

use super::helpers::{deploy_initialized, valid_splits};

/// F-4-a: lp_bps = 0 must be rejected with InvalidFeeSplits (4).
#[test]
fn test_update_fee_splits_zero_lp_bps_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let splits = FeeSplits { keeper_bps: 5_000, dev_bps: 5_000, lp_bps: 0 };

    let result = client.try_update_fee_splits(&admin, &splits);
    assert!(result.is_err(), "F-4-a: lp_bps = 0 must return an error even though sum == 10_000");
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::InvalidFeeSplits as u32),
        "F-4-a: error code must be InvalidFeeSplits (4)"
    );
}

/// F-4-b: keeper_bps = 0 must be rejected with InvalidFeeSplits (4).
#[test]
fn test_update_fee_splits_zero_keeper_bps_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let splits = FeeSplits { keeper_bps: 0, dev_bps: 1_000, lp_bps: 9_000 };

    let result = client.try_update_fee_splits(&admin, &splits);
    assert!(result.is_err(), "F-4-b: keeper_bps = 0 must return an error even though sum == 10_000");
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::InvalidFeeSplits as u32),
        "F-4-b: error code must be InvalidFeeSplits (4)"
    );
}

/// F-4-c: dev_bps = 0 must be rejected with InvalidFeeSplits (4).
#[test]
fn test_update_fee_splits_zero_dev_bps_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let splits = FeeSplits { keeper_bps: 500, dev_bps: 0, lp_bps: 9_500 };

    let result = client.try_update_fee_splits(&admin, &splits);
    assert!(result.is_err(), "F-4-c: dev_bps = 0 must return an error even though sum == 10_000");
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::InvalidFeeSplits as u32),
        "F-4-c: error code must be InvalidFeeSplits (4)"
    );
}

/// F-4-d: All components non-zero and sum == 10_000 must succeed (regression anchor).
#[test]
fn test_update_fee_splits_valid_nonzero_components_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let splits = valid_splits();
    client.update_fee_splits(&admin, &splits);

    let stored = client.get_fee_splits();
    assert_eq!(stored.keeper_bps, 500, "stored keeper_bps must match input");
    assert_eq!(stored.dev_bps, 500, "stored dev_bps must match input");
    assert_eq!(stored.lp_bps, 9_000, "stored lp_bps must match input");
}

/// F-4 adversarial: all-zero components must error with InvalidFeeSplits (4).
#[test]
fn test_update_fee_splits_all_zero_components_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let splits = FeeSplits { keeper_bps: 0, dev_bps: 0, lp_bps: 0 };

    let result = client.try_update_fee_splits(&admin, &splits);
    assert!(result.is_err(), "F-4 adversarial: all-zero FeeSplits must return an error");
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::InvalidFeeSplits as u32),
        "F-4 adversarial: error code must be InvalidFeeSplits (4)"
    );
}

/// F-4 boundary: each component = 1 (non-zero) but wrong sum — sum check must catch it.
#[test]
fn test_update_fee_splits_min_nonzero_components_wrong_sum_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = deploy_initialized(&env);

    let splits = FeeSplits { keeper_bps: 1, dev_bps: 1, lp_bps: 1 };

    let result = client.try_update_fee_splits(&admin, &splits);
    assert!(
        result.is_err(),
        "F-4 boundary: sum != 10_000 must still error even if all components are non-zero"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::InvalidFeeSplits as u32),
        "F-4 boundary: error code must be InvalidFeeSplits (4)"
    );
}
