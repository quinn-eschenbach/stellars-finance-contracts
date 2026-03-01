use soroban_sdk::{contracttype, Symbol};

#[contracttype]
pub enum StorageKey {
    // Initialization flag
    Initialized,
    // Contract references
    ConfigManager,
    // Global oracle configuration
    OracleConfig,
    // Per-symbol oracle source lists (stored in instance storage)
    PrimarySources(Symbol),
    SecondarySources(Symbol),
    // Per-symbol price cache (stored in instance storage)
    CachedPrice(Symbol),
}
