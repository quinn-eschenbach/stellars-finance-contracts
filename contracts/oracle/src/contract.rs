use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
};
use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

use crate::errors::OracleError;
use crate::storage;

#[contracttype]
pub struct UpgradeData {
    pub version: u32,
}

#[derive(UpgradeableMigratable)]
#[contract]
pub struct OracleContract;

/// SEP-40 price oracle interface.
/// Exported so oracle-router (and any other consumer) can generate a client
/// without duplicating the trait.
#[contractclient(name = "OracleClient")]
pub trait Oracle {
    /// Initialize the oracle with a link to the ConfigManager for access control.
    fn initialize(env: Env, config_manager: Address);

    /// Set the price for `symbol` (scaled by 1e7). KEEPER role required.
    fn set_price(env: Env, caller: Address, symbol: Symbol, price: i128);

    /// Return the stored price for `symbol`. SEP-40 compatible.
    fn get_price(env: Env, symbol: Symbol) -> i128;

    /// Return the ledger timestamp when the price was last set. SEP-40 compatible.
    fn last_update(env: Env, symbol: Symbol) -> u64;
}

#[contractimpl]
impl Oracle for OracleContract {
    fn initialize(env: Env, config_manager: Address) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, OracleError::AlreadyInitialized);
        }
        storage::set_config_manager(&env, &config_manager);
        storage::set_initialized(&env);
        shared::bump_instance_ttl(&env);
    }

    fn set_price(env: Env, caller: Address, symbol: Symbol, price: i128) {
        if !storage::is_initialized(&env) {
            panic_with_error!(&env, OracleError::NotInitialized);
        }
        let config_mgr = storage::get_config_manager(&env);
        shared::require_role(&env, &caller, &config_mgr, shared::ROLE_KEEPER);

        storage::set_price(&env, &symbol, price);
        storage::set_last_update(&env, &symbol, env.ledger().timestamp());
        shared::bump_instance_ttl(&env);
    }

    fn get_price(env: Env, symbol: Symbol) -> i128 {
        storage::get_price(&env, &symbol)
            .unwrap_or_else(|| panic_with_error!(&env, OracleError::NoPriceSet))
    }

    fn last_update(env: Env, symbol: Symbol) -> u64 {
        storage::get_last_update(&env, &symbol)
    }
}

impl UpgradeableMigratableInternal for OracleContract {
    type MigrationData = UpgradeData;

    fn _require_auth(e: &Env, operator: &Address) {
        let config_mgr = storage::get_config_manager(e);
        shared::require_role(e, operator, &config_mgr, shared::ROLE_UPGRADER);
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        storage::save_version(e, data.version);
    }
}
