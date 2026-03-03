use soroban_sdk::{contracttype, panic_with_error, Address, Env, Symbol};

use crate::errors::PositionManagerError;
use crate::types::{MarketInfo, Position};

/// Composite key for looking up a position by trader address and asset symbol.
#[contracttype]
#[derive(Clone)]
pub struct PositionKey {
    pub trader: Address,
    pub symbol: Symbol,
}

#[contracttype]
pub enum StorageKey {
    // Initialization flag
    Initialized,
    // Contract references
    VaultAddress,
    ConfigManager,
    OracleRouter,
    // System state
    IsPaused,
    // Running total of USDC reserved across all positions
    TotalReserved,
    // Contract version (set by migrations)
    Version,
    // Running net PnL of all traders (positive = traders winning)
    NetGlobalTraderPnl,
    // Per-market max leverage (instance storage, admin-configured)
    MaxLeverage(Symbol),
    // Per-position state (persistent storage)
    Position(PositionKey),
    // Per-market global state (persistent storage)
    Market(Symbol),
}

// ---------------------------------------------------------------------------
// Instance storage: Initialized
// ---------------------------------------------------------------------------

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&StorageKey::Initialized)
        .unwrap_or(false)
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&StorageKey::Initialized, &true);
}

// ---------------------------------------------------------------------------
// Instance storage: VaultAddress
// ---------------------------------------------------------------------------

pub fn get_vault_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::VaultAddress)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::NotInitialized))
}

pub fn set_vault_address(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::VaultAddress, addr);
}

// ---------------------------------------------------------------------------
// Instance storage: ConfigManager
// ---------------------------------------------------------------------------

pub fn get_config_manager(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::ConfigManager)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::NotInitialized))
}

pub fn set_config_manager(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::ConfigManager, addr);
}

// ---------------------------------------------------------------------------
// Instance storage: OracleRouter
// ---------------------------------------------------------------------------

pub fn get_oracle_router(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::OracleRouter)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::NotInitialized))
}

pub fn set_oracle_router(env: &Env, addr: &Address) {
    env.storage()
        .instance()
        .set(&StorageKey::OracleRouter, addr);
}

// ---------------------------------------------------------------------------
// Instance storage: IsPaused
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
// Instance storage: TotalReserved
// ---------------------------------------------------------------------------

pub fn get_total_reserved(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&StorageKey::TotalReserved)
        .unwrap_or(0i128)
}

pub fn set_total_reserved(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&StorageKey::TotalReserved, &amount);
}

// ---------------------------------------------------------------------------
// Instance storage: NetGlobalTraderPnl
// ---------------------------------------------------------------------------

pub fn get_net_global_trader_pnl(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&StorageKey::NetGlobalTraderPnl)
        .unwrap_or(0i128)
}

pub fn set_net_global_trader_pnl(env: &Env, value: i128) {
    env.storage()
        .instance()
        .set(&StorageKey::NetGlobalTraderPnl, &value);
}

// ---------------------------------------------------------------------------
// Instance storage: Version
// ---------------------------------------------------------------------------

pub fn save_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&StorageKey::Version, &version);
}

// ---------------------------------------------------------------------------
// Persistent storage: Position
// ---------------------------------------------------------------------------

pub fn get_position(env: &Env, trader: &Address, symbol: &Symbol) -> Option<Position> {
    let key = StorageKey::Position(PositionKey {
        trader: trader.clone(),
        symbol: symbol.clone(),
    });
    env.storage().persistent().get(&key)
}

pub fn set_position(env: &Env, trader: &Address, symbol: &Symbol, position: &Position) {
    let key = StorageKey::Position(PositionKey {
        trader: trader.clone(),
        symbol: symbol.clone(),
    });
    env.storage().persistent().set(&key, position);
    env.storage()
        .persistent()
        .extend_ttl(&key, shared::SHARED_THRESHOLD, shared::SHARED_BUMP);
}

pub fn bump_position_ttl(env: &Env, trader: &Address, symbol: &Symbol) {
    let key = StorageKey::Position(PositionKey {
        trader: trader.clone(),
        symbol: symbol.clone(),
    });
    env.storage()
        .persistent()
        .extend_ttl(&key, shared::SHARED_THRESHOLD, shared::SHARED_BUMP);
}

pub fn delete_position(env: &Env, trader: &Address, symbol: &Symbol) {
    let key = StorageKey::Position(PositionKey {
        trader: trader.clone(),
        symbol: symbol.clone(),
    });
    if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
}

// ---------------------------------------------------------------------------
// Persistent storage: MarketInfo
// ---------------------------------------------------------------------------

pub fn get_market(env: &Env, symbol: &Symbol) -> MarketInfo {
    let key = StorageKey::Market(symbol.clone());
    env.storage().persistent().get(&key).unwrap_or(MarketInfo {
        global_long_avg_price: 0,
        global_short_avg_price: 0,
        long_open_interest: 0,
        short_open_interest: 0,
        acc_borrow_index: 0,
        acc_funding_index: 0,
        last_index_update: 0,
    })
}

pub fn set_market(env: &Env, symbol: &Symbol, market: &MarketInfo) {
    let key = StorageKey::Market(symbol.clone());
    env.storage().persistent().set(&key, market);
    env.storage()
        .persistent()
        .extend_ttl(&key, shared::SHARED_THRESHOLD, shared::SHARED_BUMP);
}

// ---------------------------------------------------------------------------
// Instance storage: MaxLeverage (per-market)
// ---------------------------------------------------------------------------

pub fn get_max_leverage(env: &Env, symbol: &Symbol) -> Option<i128> {
    let key = StorageKey::MaxLeverage(symbol.clone());
    env.storage().instance().get(&key)
}

pub fn set_max_leverage(env: &Env, symbol: &Symbol, value: i128) {
    let key = StorageKey::MaxLeverage(symbol.clone());
    env.storage().instance().set(&key, &value);
}
