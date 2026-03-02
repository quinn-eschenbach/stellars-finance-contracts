//! Test helpers for OracleRouter contract tests.
//!
//! Provides `deploy`, `deploy_initialized`, and `deploy_with_config_manager`
//! convenience functions that mirror the pattern established in the
//! config-manager test suite.

use soroban_sdk::{testutils::Address as _, vec, Address, Env, Symbol};

use crate::{OracleRouterClient, OracleRouterContract, OracleConfig};

#[cfg(test)]
use config_manager::{ConfigManagerClient, ConfigManagerContract};

#[cfg(test)]
use mock_oracle::{MockOracle, MockOracleClient};

/// Register the OracleRouter contract and return an uninitialized client.
/// The caller is responsible for calling `initialize` before using any
/// post-init functionality.
pub fn deploy(env: &Env) -> OracleRouterClient<'_> {
    let contract_id = env.register(OracleRouterContract, ());
    OracleRouterClient::new(env, &contract_id)
}

/// Register the OracleRouter contract, call `initialize` with a freshly
/// generated config_manager address, and return both the client and the
/// address that was stored as the ConfigManager.
///
/// The config_manager address is a raw generated address — not a deployed
/// contract — because `initialize` only stores the address in instance
/// storage; it does not cross-call it.
pub fn deploy_initialized(env: &Env) -> (OracleRouterClient<'_>, Address) {
    let client = deploy(env);
    let config_manager = Address::generate(env);
    client.initialize(&config_manager);
    (client, config_manager)
}

/// Deploy a real ConfigManager contract and a real OracleRouter contract,
/// wire them together, and return all three handles needed for cross-contract
/// admin-auth tests.
///
/// Deployment sequence:
///   1. Register ConfigManager, generating a real contract address.
///   2. Generate an `admin` address and call `cm.initialize(&admin)`, which
///      grants the `"ADMIN"` role to `admin` in ConfigManager's storage.
///   3. Register OracleRouter and call `oracle.initialize(&cm_address)`, which
///      stores the ConfigManager address in the router's instance storage.
///
/// Returns `(oracle_client, cm_client, admin)`.
#[cfg(test)]
pub fn deploy_with_config_manager(
    env: &Env,
) -> (OracleRouterClient<'_>, ConfigManagerClient<'_>, Address) {
    // 1. Deploy ConfigManager.
    let cm_id = env.register(ConfigManagerContract, ());
    let cm = ConfigManagerClient::new(env, &cm_id);

    // 2. Initialize ConfigManager — grants DEFAULT_ADMIN ("ADMIN") to admin.
    let admin = Address::generate(env);
    cm.initialize(&admin);

    // 3. Deploy OracleRouter and link it to the ConfigManager.
    let oracle_id = env.register(OracleRouterContract, ());
    let oracle = OracleRouterClient::new(env, &oracle_id);
    oracle.initialize(&cm_id);

    (oracle, cm, admin)
}

// ---------------------------------------------------------------------------
// Data fixture helpers
// ---------------------------------------------------------------------------

/// Returns a canonical valid OracleConfig suitable for use across all tests
/// that require a non-zero configuration.
pub fn valid_oracle_config() -> OracleConfig {
    OracleConfig {
        max_deviation_bps: 100,
        staleness_threshold: 60,
        cache_duration: 10,
    }
}

/// Role symbol helper — returns the "ADMIN" symbol used by ConfigManager's
/// `has_role` check.  Keeps test files free of raw string literals.
pub fn role_admin(env: &Env) -> Symbol {
    Symbol::new(env, "ADMIN")
}

/// Role symbol helper — returns the "UPGRADER" symbol used by ConfigManager's
/// `has_role` check for upgrade authorization.
pub fn role_upgrader(env: &Env) -> Symbol {
    Symbol::new(env, "UPGRADER")
}

// ---------------------------------------------------------------------------
// Upgrade helpers (test-only)
// ---------------------------------------------------------------------------

/// Deploy OracleRouter + ConfigManager, then grant the UPGRADER role to admin.
///
/// This extends `deploy_with_config_manager` by calling:
///   `cm.grant_role(&admin, &Symbol::new(env, "UPGRADER"), &admin)`
///
/// Returns `(oracle_client, cm_client, admin)` where `admin` holds both
/// the DEFAULT_ADMIN ("ADMIN") role and the UPGRADER role.
#[cfg(test)]
pub fn deploy_with_upgrader(
    env: &Env,
) -> (OracleRouterClient<'_>, ConfigManagerClient<'_>, Address) {
    let (oracle, cm, admin) = deploy_with_config_manager(env);

    // Grant the UPGRADER role to admin via the admin's own authority.
    let upgrader_role = role_upgrader(env);
    cm.grant_role(&admin, &upgrader_role, &admin);

    (oracle, cm, admin)
}

// ---------------------------------------------------------------------------
// Mock oracle helpers (test-only)
// ---------------------------------------------------------------------------

/// Deploy a MockOracle contract and return its client.
///
/// The returned client exposes `set_price(symbol, price)` and `last_update(symbol)`
/// so individual tests can control the exact price and freshness of this source.
#[cfg(test)]
pub fn deploy_mock_oracle(env: &Env) -> MockOracleClient<'_> {
    let id = env.register(MockOracle, ());
    MockOracleClient::new(env, &id)
}

/// Full setup for `get_price` tests.
///
/// Deployment sequence:
///   1. Calls `deploy_with_config_manager` — gives us an admin + linked CM.
///   2. Sets a valid OracleConfig via `set_oracle_config`:
///        max_deviation_bps = 200, staleness_threshold = 60, cache_duration = 10
///   3. Deploys a single MockOracle and registers it as the sole primary source
///      for `Symbol::new(env, "ETH")` via `set_oracle_sources`.
///
/// Returns `(oracle_client, mock_oracle_client, admin)`.
///
/// Callers MUST call `env.mock_all_auths()` before invoking this helper if
/// they need the admin setup calls to succeed.
#[cfg(test)]
pub fn deploy_with_price_feed(
    env: &Env,
) -> (OracleRouterClient<'_>, MockOracleClient<'_>, Address) {
    let (oracle, _cm, admin) = deploy_with_config_manager(env);

    let config = OracleConfig {
        max_deviation_bps: 200,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let mock = deploy_mock_oracle(env);
    let eth = Symbol::new(env, "ETH");
    let primary = vec![env, mock.address.clone()];
    let empty: soroban_sdk::Vec<Address> = vec![env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    (oracle, mock, admin)
}
