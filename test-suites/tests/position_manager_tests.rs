use soroban_sdk::Env;
use test_suites::testutils::Fixture;

// ---------------------------------------------------------------------------
// PositionManager: Initialization
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_position_manager_initialize_links_vault_and_config() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// PositionManager: increase_position
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_increase_position_opens_long_and_reserves_usdc() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_increase_position_opens_short_and_reserves_usdc() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_increase_position_reverts_when_paused() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_increase_position_reverts_when_utilization_cap_breached() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_increase_position_records_last_increased_time() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_increase_position_updates_global_long_avg_price() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// PositionManager: decrease_position
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_decrease_position_closes_long_with_profit() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_decrease_position_closes_long_with_loss() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_decrease_position_reverts_before_min_lifetime() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_decrease_position_succeeds_even_when_vault_paused() {
    // decrease_position intentionally bypasses the Pausable check.
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// PositionManager: liquidate_position
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_liquidate_position_succeeds_when_health_factor_below_one() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_liquidate_position_reverts_if_position_still_healthy() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_liquidate_position_reverts_if_not_keeper() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// PositionManager: update_indices
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_update_indices_increments_borrow_accumulator() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_update_indices_increments_funding_accumulator() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_update_indices_reverts_if_not_keeper() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// PositionManager: deverage_position (ADL)
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_deverage_position_succeeds_when_pnl_adl_trigger_met() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_deverage_position_succeeds_when_utilization_adl_trigger_met() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_deverage_position_reverts_when_adl_not_triggered() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_deverage_position_reverts_if_not_keeper() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}
