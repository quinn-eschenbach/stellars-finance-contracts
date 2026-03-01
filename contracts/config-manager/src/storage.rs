use soroban_sdk::contracttype;

#[contracttype]
pub enum StorageKey {
    // Initialization flag
    Initialized,
    // Fee configuration
    DepositFee,
    FeeSplits,
    // Protocol limits
    MinCollateral,
    CooldownDuration,
    MinPositionLifetime,
    MaxUtilizationRatio,
}
