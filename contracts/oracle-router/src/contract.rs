use interfaces::{OracleConfig, OracleRouter, UpgradeData};
use shared::bump_instance_ttl;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

use crate::{events, logic, storage};

#[derive(UpgradeableMigratable)]
#[contract]
pub struct OracleRouterContract;

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
        events::OracleConfigUpdate {
            staleness: config.staleness_threshold,
            deviation: config.max_deviation_bps,
            cache_duration: config.cache_duration,
        }.publish(&env);
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
