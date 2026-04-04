use soroban_sdk::{contractclient, Address, Env, Symbol, Vec};

use crate::types::OracleConfig;

/// OracleRouter contract interface.
/// SEP-40 median aggregation + price cache for the perpetual DEX.
#[contractclient(name = "OracleRouterClient")]
pub trait OracleRouter {
    /// Initialize the oracle router and link it to the ConfigManager.
    /// Can only be called once.
    fn initialize(env: Env, config_manager_address: Address);

    /// Return the validated price for `symbol` (scaled by 1e7).
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

    /// Extends the Soroban TTL of the OracleRouter's instance storage.
    fn bump_oracle_state(env: Env);
}
