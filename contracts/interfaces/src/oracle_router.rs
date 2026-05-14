use soroban_sdk::{contractclient, Address, BytesN, Env, Symbol, Vec};

use crate::types::OracleConfig;

/// OracleRouter contract interface.
/// SEP-40 median aggregation, no cache — every `get_price` re-queries sources.
#[contractclient(name = "OracleRouterClient")]
pub trait OracleRouter {
    /// Initialize the oracle router and link it to the ConfigManager.
    /// `admin` authorizes the call; the address is not stored.
    /// Can only be called once.
    fn initialize(env: Env, admin: Address, config_manager_address: Address);

    /// Return the validated median price for `symbol` (scaled by 1e7).
    /// Always queries sources fresh — there is no internal cache.
    fn get_price(env: Env, symbol: Symbol) -> i128;

    /// Add or replace the flat SEP-40 oracle source list for `symbol`.
    /// Sources form a single equally-weighted pool (no primary/secondary
    /// tiering). Source count capped at MAX_ORACLE_SOURCES.
    /// Callable only by ADMIN role (via ConfigManager).
    fn set_oracle_sources(env: Env, caller: Address, symbol: Symbol, sources: Vec<Address>);

    /// Update the global oracle safety thresholds.
    /// Callable only by ADMIN role (via ConfigManager).
    fn set_oracle_config(env: Env, caller: Address, config: OracleConfig);

    /// Returns the current oracle configuration.
    fn get_oracle_config(env: Env) -> OracleConfig;

    /// Extends the Soroban TTL of the OracleRouter's instance storage.
    fn bump_oracle_state(env: Env);

    /// Propose a WASM upgrade. UPGRADER role only.
    fn propose_upgrade(env: Env, caller: Address, wasm_hash: BytesN<32>);

    /// PAUSER veto of a pending upgrade.
    fn cancel_upgrade(env: Env, caller: Address);
}
