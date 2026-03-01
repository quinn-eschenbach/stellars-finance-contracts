use soroban_sdk::{contracttype, Address, Symbol};

/// Composite key for looking up a position by trader address and asset symbol.
#[contracttype]
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
    // Risk parameters (mirrored from ConfigManager for gas efficiency)
    MaxUtilizationRatio,
    MinPositionLifetime,
    // System state
    IsPaused,
    // Per-position state
    Position(PositionKey),
    // Per-market global state
    Market(Symbol),
}
