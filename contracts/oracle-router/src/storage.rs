use soroban_sdk::{contracttype, panic_with_error, vec, Address, Env, Symbol, Vec};
use shared::{SHARED_BUMP, SHARED_THRESHOLD};

use crate::errors::OracleRouterError;
use crate::types::{CachedPrice, OracleConfig};

#[contracttype]
pub enum StorageKey {
    // Initialization flag
    Initialized,
    // Contract references
    ConfigManager,
    // Global oracle configuration
    OracleConfig,
    // Per-symbol oracle source lists (stored in persistent storage)
    PrimarySources(Symbol),
    SecondarySources(Symbol),
    // Per-symbol price cache (stored in instance storage)
    CachedPrice(Symbol),
    // Current contract version — written by _migrate after a WASM upgrade.
    Version,
}

// ---------------------------------------------------------------------------
// Initialization helpers
// ---------------------------------------------------------------------------

fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&StorageKey::Initialized)
        .unwrap_or(false)
}

/// Panics with AlreadyInitialized if the contract has already been initialized.
pub fn check_not_initialized(env: &Env) {
    if is_initialized(env) {
        panic_with_error!(env, OracleRouterError::AlreadyInitialized);
    }
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&StorageKey::Initialized, &true);
}

// ---------------------------------------------------------------------------
// ConfigManager helpers
// ---------------------------------------------------------------------------

/// Load the ConfigManager address. Panics with Unauthorized if missing.
pub fn load_config_manager(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::ConfigManager)
        .unwrap_or_else(|| panic_with_error!(env, OracleRouterError::Unauthorized))
}

pub fn set_config_manager(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::ConfigManager, addr);
}

// ---------------------------------------------------------------------------
// OracleConfig helpers
// ---------------------------------------------------------------------------

/// Load the oracle config. Panics with NotInitialized if unset.
pub fn load_oracle_config(env: &Env) -> OracleConfig {
    env.storage()
        .instance()
        .get(&StorageKey::OracleConfig)
        .unwrap_or_else(|| panic_with_error!(env, OracleRouterError::NotInitialized))
}

pub fn save_oracle_config(env: &Env, config: &OracleConfig) {
    env.storage()
        .instance()
        .set(&StorageKey::OracleConfig, config);
}

// ---------------------------------------------------------------------------
// Price cache helpers
// ---------------------------------------------------------------------------

pub fn load_cached_price(env: &Env, symbol: &Symbol) -> Option<CachedPrice> {
    env.storage()
        .instance()
        .get(&StorageKey::CachedPrice(symbol.clone()))
}

pub fn save_cached_price(env: &Env, symbol: &Symbol, entry: CachedPrice) {
    env.storage()
        .instance()
        .set(&StorageKey::CachedPrice(symbol.clone()), &entry);
}

// ---------------------------------------------------------------------------
// Oracle source helpers
// ---------------------------------------------------------------------------

pub fn load_primary_sources(env: &Env, symbol: &Symbol) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&StorageKey::PrimarySources(symbol.clone()))
        .unwrap_or_else(|| vec![env])
}

pub fn load_secondary_sources(env: &Env, symbol: &Symbol) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&StorageKey::SecondarySources(symbol.clone()))
        .unwrap_or_else(|| vec![env])
}

/// Persist primary and secondary sources for `symbol` and extend their TTLs.
pub fn save_oracle_sources(
    env: &Env,
    symbol: &Symbol,
    primary: &Vec<Address>,
    secondary: &Vec<Address>,
) {
    let primary_key = StorageKey::PrimarySources(symbol.clone());
    let secondary_key = StorageKey::SecondarySources(symbol.clone());

    env.storage().persistent().set(&primary_key, primary);
    env.storage()
        .persistent()
        .extend_ttl(&primary_key, SHARED_THRESHOLD, SHARED_BUMP);

    env.storage().persistent().set(&secondary_key, secondary);
    env.storage()
        .persistent()
        .extend_ttl(&secondary_key, SHARED_THRESHOLD, SHARED_BUMP);
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

pub fn save_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&StorageKey::Version, &version);
}
