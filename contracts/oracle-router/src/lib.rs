#![no_std]

mod errors;
mod storage;
mod types;

use soroban_sdk::{contract, contractclient, contractimpl, Address, Env, Symbol, Vec};

pub use errors::OracleRouterError;
pub use types::{CachedPrice, OracleConfig};

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
    ///   4. Reject if max(prices) - min(prices) > MaxDeviation.
    ///   5. Update CachedPrices and LastUpdateTime, then return the median.
    fn get_price(env: Env, symbol: Symbol) -> i128;

    /// Add or replace SEP-40 oracle source addresses for a given symbol.
    /// Callable only by DEFAULT_ADMIN_ROLE (via ConfigManager).
    fn set_oracle_sources(
        env: Env,
        caller: Address,
        symbol: Symbol,
        primary: Vec<Address>,
        secondary: Vec<Address>,
    );

    /// Update the global oracle safety thresholds.
    /// Callable only by DEFAULT_ADMIN_ROLE (via ConfigManager).
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
        todo!()
    }

    fn get_price(env: Env, symbol: Symbol) -> i128 {
        todo!()
    }

    fn set_oracle_sources(
        env: Env,
        caller: Address,
        symbol: Symbol,
        primary: Vec<Address>,
        secondary: Vec<Address>,
    ) {
        todo!()
    }

    fn set_oracle_config(env: Env, caller: Address, config: OracleConfig) {
        todo!()
    }

    fn get_oracle_config(env: Env) -> OracleConfig {
        todo!()
    }

    fn bump_oracle_state(env: Env) {
        todo!()
    }
}
