use soroban_sdk::{contracttype, panic_with_error, Address, Env};
use shared::{SHARED_THRESHOLD, SHARED_BUMP};

use crate::errors::VaultError;

#[contracttype]
pub enum VaultDataKey {
    Initialized,
    ConfigManager,
    PositionManager,
    ReservedUsdc,
    UnclaimedFees,
    NetGlobalTraderPnl,
    IsPaused,
    Version,
    /// Per-user last deposit timestamp (persistent storage)
    LastDepositTime(Address),
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&VaultDataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&VaultDataKey::Initialized, &true);
}

// ---------------------------------------------------------------------------
// Config Manager
// ---------------------------------------------------------------------------

pub fn get_config_manager(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&VaultDataKey::ConfigManager)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NotInitialized))
}

pub fn set_config_manager(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&VaultDataKey::ConfigManager, addr);
}

// ---------------------------------------------------------------------------
// Position Manager
// ---------------------------------------------------------------------------

pub fn get_position_manager(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&VaultDataKey::PositionManager)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NotInitialized))
}

pub fn set_position_manager(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&VaultDataKey::PositionManager, addr);
}

// ---------------------------------------------------------------------------
// Reserved USDC
// ---------------------------------------------------------------------------

pub fn get_reserved_usdc(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&VaultDataKey::ReservedUsdc)
        .unwrap_or(0)
}

pub fn set_reserved_usdc(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&VaultDataKey::ReservedUsdc, &amount);
}

// ---------------------------------------------------------------------------
// Unclaimed Fees
// ---------------------------------------------------------------------------

pub fn get_unclaimed_fees(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&VaultDataKey::UnclaimedFees)
        .unwrap_or(0)
}

pub fn set_unclaimed_fees(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&VaultDataKey::UnclaimedFees, &amount);
}

// ---------------------------------------------------------------------------
// Net Global Trader PnL
// ---------------------------------------------------------------------------

pub fn get_net_global_trader_pnl(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&VaultDataKey::NetGlobalTraderPnl)
        .unwrap_or(0)
}

pub fn set_net_global_trader_pnl(env: &Env, pnl: i128) {
    env.storage()
        .instance()
        .set(&VaultDataKey::NetGlobalTraderPnl, &pnl);
}

// ---------------------------------------------------------------------------
// Pause State
// ---------------------------------------------------------------------------

pub fn get_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&VaultDataKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&VaultDataKey::IsPaused, &paused);
}

// ---------------------------------------------------------------------------
// Version (upgrade tracking)
// ---------------------------------------------------------------------------

pub fn save_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&VaultDataKey::Version, &version);
}

// ---------------------------------------------------------------------------
// Persistent storage: LastDepositTime (per-user)
// ---------------------------------------------------------------------------

pub fn get_last_deposit_time(env: &Env, user: &Address) -> Option<u64> {
    let key = VaultDataKey::LastDepositTime(user.clone());
    env.storage().persistent().get(&key)
}

pub fn set_last_deposit_time(env: &Env, user: &Address, timestamp: u64) {
    let key = VaultDataKey::LastDepositTime(user.clone());
    env.storage().persistent().set(&key, &timestamp);
    env.storage()
        .persistent()
        .extend_ttl(&key, SHARED_THRESHOLD, SHARED_BUMP);
}
