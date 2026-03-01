use soroban_sdk::{contracttype, Address};

#[contracttype]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
pub enum StorageKey {
    // Initialization flag
    Initialized,
    // Contract references
    ConfigManager,
    // SEP-41 token ledger
    TotalSupply,
    Balance(Address),
    Allowance(AllowanceKey),
    // Asset tracking
    TotalUsdc,
    ReservedUsdc,
    UnclaimedFees,
    // System state
    IsPaused,
}
