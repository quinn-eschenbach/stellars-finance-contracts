use soroban_sdk::contracttype;

pub use interfaces::OracleConfig;

/// A cached price entry for a single asset symbol.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CachedPrice {
    /// Price scaled by 1e7 (7 decimal places).
    pub price: i128,
    /// Ledger timestamp when this cache entry was written.
    pub last_update: u64,
}
