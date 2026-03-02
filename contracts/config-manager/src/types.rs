use soroban_sdk::contracttype;

/// Data required during a WASM migration (passed to `_migrate`).
#[contracttype]
pub struct UpgradeData {
    pub version: u32,
}

/// Defines how protocol revenue is split between parties.
/// All values are in basis points (bps). Must sum to 10_000.
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeSplits {
    /// Share allocated to keeper bots (e.g., 500 = 5%).
    pub keeper_bps: u32,
    /// Share allocated to the developer/treasury wallet (e.g., 500 = 5%).
    pub dev_bps: u32,
    /// Share retained in the vault for LPs (e.g., 9000 = 90%).
    pub lp_bps: u32,
}

/// Global protocol risk and timing parameters.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolLimits {
    /// Minimum USDC required to open a position (prevents dust/spam).
    pub min_collateral: i128,
    /// Required delay (seconds) between vault deposit and withdrawal
    /// to prevent sandwich attacks on oracle updates.
    pub cooldown_duration: u64,
    /// Minimum time (seconds) a position must stay open before it can be
    /// decreased. Enforced by PositionManager to prevent oracle front-running.
    pub min_position_lifetime: u64,
    /// Hard cap on vault utilization in basis points (e.g., 8500 = 85%).
    /// No new positions can be opened once this ceiling is reached.
    pub max_utilization_ratio: i128,
}

/// Role identifiers used with OpenZeppelin AccessControl.
/// Each is a short Symbol passed to grant_role / revoke_role.
pub mod roles {

    /// Ultimate authority — typically a multi-sig or DAO. Can manage all roles.
    pub const DEFAULT_ADMIN: &str = "ADMIN";
    /// Authorized to push WASM upgrades to protocol contracts.
    pub const UPGRADER: &str = "UPGRADER";
    /// Authorized to pause/unpause Vault and PositionManager.
    pub const PAUSER: &str = "PAUSER";
    /// Whitelisted keeper bot network for liquidations, ADL, index updates.
    pub const KEEPER: &str = "KEEPER";

}
