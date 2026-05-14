use shared::constants::{SHARED_BUMP, SHARED_THRESHOLD};
use soroban_sdk::{contracttype, panic_with_error, vec, Address, Env, Symbol, Vec};

use crate::errors::OracleRouterError;
use crate::types::OracleConfig;

#[contracttype]
pub enum StorageKey {
    /// Initialization flag.
    Initialized,
    /// Linked ConfigManager address.
    ConfigManager,
    /// Global oracle configuration.
    OracleConfig,
    /// Per-symbol flat source list (no primary/secondary tiering).
    Sources(Symbol),
    /// Current contract version — written by `_migrate` after a WASM upgrade.
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

pub fn check_not_initialized(env: &Env) {
    if is_initialized(env) {
        panic_with_error!(env, OracleRouterError::AlreadyInitialized);
    }
}

pub fn require_initialized(env: &Env) {
    if !is_initialized(env) {
        panic_with_error!(env, OracleRouterError::NotInitialized);
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
// Oracle source helpers — single flat list per symbol.
// ---------------------------------------------------------------------------

pub fn load_sources(env: &Env, symbol: &Symbol) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&StorageKey::Sources(symbol.clone()))
        .unwrap_or_else(|| vec![env])
}

pub fn save_sources(env: &Env, symbol: &Symbol, sources: &Vec<Address>) {
    let key = StorageKey::Sources(symbol.clone());
    env.storage().persistent().set(&key, sources);
    env.storage()
        .persistent()
        .extend_ttl(&key, SHARED_THRESHOLD, SHARED_BUMP);
}

// ---------------------------------------------------------------------------
// Version helper
// ---------------------------------------------------------------------------

pub fn save_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&StorageKey::Version, &version);
}

// Pending upgrade storage now lives in `interfaces::upgrade` under a shared
// Symbol key — used by the `TimelockedUpgradeable` trait's default methods.
