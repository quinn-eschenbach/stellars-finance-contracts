use soroban_sdk::contracttype;

/// Global safety thresholds for price validation and caching.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleConfig {
    /// Maximum allowed spread between primary oracle sources in basis points
    /// (e.g., 100 = 1%). If exceeded, trading for that asset is paused.
    pub max_deviation_bps: i128,
    /// Maximum age of an external SEP-40 price feed before it is rejected
    /// as stale (in seconds).
    pub staleness_threshold: u64,
    /// Duration the internal price cache is valid before a fresh cross-contract
    /// call to external oracles is required (in seconds, e.g., 10).
    pub cache_duration: u64,
}

/// A cached price entry for a single asset symbol.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CachedPrice {
    /// Price scaled by 1e7 (7 decimal places).
    pub price: i128,
    /// Ledger timestamp when this cache entry was written.
    pub last_update: u64,
}
