use shared::bump_instance_ttl;
use soroban_sdk::{contract, contractclient, contractimpl, contracttype, Address, Env, Symbol, Vec};
use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

use crate::{logic, storage, types::OracleConfig};

#[contracttype]
pub struct UpgradeData {
    pub version: u32,
}

#[derive(UpgradeableMigratable)]
#[contract]
pub struct OracleRouterContract;

#[contractclient(name = "OracleRouterClient")]
pub trait OracleRouter {
    /// Initialize the oracle router and link it to the ConfigManager.
    /// Can only be called once.
    fn initialize(env: Env, config_manager_address: Address);

    /// Return the validated price for `symbol` (scaled by 1e7).
    ///
    /// Caching logic:
    ///   If current_time <= last_update + cache_duration → return CachedPrices[symbol].
    ///
    /// Fetch logic (cache miss):
    ///   1. Query all PrimarySources via SEP-40 cross-contract calls.
    ///   2. Reject any source whose timestamp is older than StalenessThreshold.
    ///   3. Compute the median price from valid responses.
    ///   4. Reject if max one-sided deviation > MaxDeviationBps.
    ///   5. Update CachedPrices and return the median.
    fn get_price(env: Env, symbol: Symbol) -> i128;

    /// Add or replace SEP-40 oracle source addresses for a given symbol.
    /// Callable only by ADMIN role (via ConfigManager).
    fn set_oracle_sources(
        env: Env,
        caller: Address,
        symbol: Symbol,
        primary: Vec<Address>,
        secondary: Vec<Address>,
    );

    /// Update the global oracle safety thresholds.
    /// Callable only by ADMIN role (via ConfigManager).
    fn set_oracle_config(env: Env, caller: Address, config: OracleConfig);

    /// Returns the current oracle configuration.
    fn get_oracle_config(env: Env) -> OracleConfig;

    /// Extends the Soroban TTL of the OracleRouter's instance storage
    /// to prevent the oracle config and source lists from being archived.
    fn bump_oracle_state(env: Env);
}

#[contractimpl]
impl OracleRouter for OracleRouterContract {
    fn initialize(env: Env, config_manager_address: Address) {
        storage::check_not_initialized(&env);
        storage::set_config_manager(&env, &config_manager_address);
        storage::set_initialized(&env);
        bump_instance_ttl(&env);
    }

    fn get_price(env: Env, symbol: Symbol) -> i128 {
        logic::fetch_and_validate_price(&env, symbol)
    }

    fn set_oracle_sources(
        env: Env,
        caller: Address,
        symbol: Symbol,
        primary: Vec<Address>,
        secondary: Vec<Address>,
    ) {
        logic::require_oracle_admin(&env, &caller);
        let primary_deduped = logic::dedup_sources(&env, &primary);
        let secondary_deduped = logic::dedup_sources(&env, &secondary);
        storage::save_oracle_sources(&env, &symbol, &primary_deduped, &secondary_deduped);
        bump_instance_ttl(&env);
    }

    fn set_oracle_config(env: Env, caller: Address, config: OracleConfig) {
        logic::require_oracle_admin(&env, &caller);
        logic::validate_oracle_config(&env, &config);
        storage::save_oracle_config(&env, &config);
        bump_instance_ttl(&env);
    }

    fn get_oracle_config(env: Env) -> OracleConfig {
        storage::load_oracle_config(&env)
    }

    fn bump_oracle_state(env: Env) {
        bump_instance_ttl(&env);
    }
}

impl UpgradeableMigratableInternal for OracleRouterContract {
    type MigrationData = UpgradeData;

    fn _require_auth(e: &Env, operator: &Address) {
        logic::require_upgrader(e, operator);
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        storage::save_version(e, data.version);
    }
}
