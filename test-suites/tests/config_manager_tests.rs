use soroban_sdk::Env;
use test_suites::testutils::Fixture;

// ---------------------------------------------------------------------------
// ConfigManager: Initialization
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_config_manager_initialize_grants_admin_role() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_config_manager_initialize_reverts_on_second_call() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// ConfigManager: Role Management
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_grant_role_allows_admin_to_assign_keeper() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_grant_role_reverts_if_not_admin() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_revoke_role_removes_keeper_access() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_revoke_role_reverts_if_not_admin() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_has_role_returns_true_for_granted_role() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_has_role_returns_false_for_ungranted_role() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// ConfigManager: Fee Splits
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_update_fee_splits_stores_valid_splits() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_update_fee_splits_reverts_if_splits_do_not_sum_to_10000() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_update_fee_splits_reverts_if_not_admin() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// ConfigManager: Protocol Limits
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_update_protocol_limits_stores_new_values() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_update_protocol_limits_reverts_if_max_utilization_over_100_percent() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_update_protocol_limits_reverts_if_not_admin() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}
