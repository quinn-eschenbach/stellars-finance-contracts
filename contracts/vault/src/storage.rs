use soroban_sdk::{contracttype, panic_with_error, Address, Env};

use crate::errors::VaultError;

#[contracttype]
pub enum StorageKey {
    Initialized,
    ConfigManager,
    PositionManager,
    ReservedUsdc,
    UnclaimedFees,
    NetGlobalTraderPnl,
    IsPaused,
    Version,
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&StorageKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&StorageKey::Initialized, &true);
}

// ---------------------------------------------------------------------------
// Config Manager
// ---------------------------------------------------------------------------

pub fn get_config_manager(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::ConfigManager)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NotInitialized))
}

pub fn set_config_manager(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::ConfigManager, addr);
}

// ---------------------------------------------------------------------------
// Position Manager
// ---------------------------------------------------------------------------

pub fn get_position_manager(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::PositionManager)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NotInitialized))
}

pub fn set_position_manager(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::PositionManager, addr);
}

// ---------------------------------------------------------------------------
// Reserved USDC
// ---------------------------------------------------------------------------

pub fn get_reserved_usdc(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&StorageKey::ReservedUsdc)
        .unwrap_or(0)
}

pub fn set_reserved_usdc(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&StorageKey::ReservedUsdc, &amount);
}

// ---------------------------------------------------------------------------
// Unclaimed Fees
// ---------------------------------------------------------------------------

pub fn get_unclaimed_fees(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&StorageKey::UnclaimedFees)
        .unwrap_or(0)
}

pub fn set_unclaimed_fees(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&StorageKey::UnclaimedFees, &amount);
}

// ---------------------------------------------------------------------------
// Net Global Trader PnL
// ---------------------------------------------------------------------------

pub fn get_net_global_trader_pnl(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&StorageKey::NetGlobalTraderPnl)
        .unwrap_or(0)
}

pub fn set_net_global_trader_pnl(env: &Env, pnl: i128) {
    env.storage()
        .instance()
        .set(&StorageKey::NetGlobalTraderPnl, &pnl);
}

// ---------------------------------------------------------------------------
// Pause State
// ---------------------------------------------------------------------------

pub fn get_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&StorageKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&StorageKey::IsPaused, &paused);
}

// ---------------------------------------------------------------------------
// Version (upgrade tracking)
// ---------------------------------------------------------------------------

pub fn save_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&StorageKey::Version, &version);
}
