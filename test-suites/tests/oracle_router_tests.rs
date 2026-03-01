use soroban_sdk::Env;
use test_suites::testutils::Fixture;

// ---------------------------------------------------------------------------
// OracleRouter: Initialization
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_oracle_router_initialize_links_config_manager() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_oracle_router_initialize_reverts_on_second_call() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// OracleRouter: get_price — Cache Path
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_get_price_returns_cached_value_within_cache_duration() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_get_price_fetches_fresh_price_after_cache_expires() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// OracleRouter: get_price — Fetch Path (cache miss)
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_get_price_returns_median_of_multiple_sources() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_get_price_reverts_if_all_sources_are_stale() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_get_price_reverts_if_spread_exceeds_max_deviation() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_get_price_reverts_if_no_sources_configured() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// OracleRouter: set_oracle_sources
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_set_oracle_sources_stores_primary_and_secondary_lists() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_set_oracle_sources_reverts_if_not_admin() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// OracleRouter: Oracle Config
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_set_oracle_config_updates_thresholds() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_set_oracle_config_reverts_if_not_admin() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}
