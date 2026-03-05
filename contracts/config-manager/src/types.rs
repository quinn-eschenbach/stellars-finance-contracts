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
    /// Protocol's cut of positive funding fees in basis points (e.g., 500 = 5%).
    /// Applied when a trader receives funding; the protocol retains this fraction.
    pub funding_cut_bps: u32,
    /// ADL trigger: net trader PnL as a percentage of total vault assets (bps).
    /// When net_pnl / total_assets exceeds this, ADL is triggered. Default: 9000 = 90%.
    pub adl_pnl_bps: u32,
    /// ADL trigger: vault utilization threshold (bps).
    /// When reserved / total_assets exceeds this, ADL is triggered. Default: 9500 = 95%.
    pub adl_utilization_bps: u32,
}

/// Borrow rate kink curve and funding rate parameters (all in basis points).
#[contracttype]
#[derive(Clone, Debug)]
pub struct BorrowRateConfig {
    /// Base borrow rate (e.g. 100 = 1% annualized).
    pub base_borrow_rate_bps: i128,
    /// Slope below optimal utilization (e.g. 500 = 5%).
    pub slope1_bps: i128,
    /// Slope above optimal utilization (e.g. 5000 = 50%).
    pub slope2_bps: i128,
    /// Optimal utilization breakpoint (e.g. 8000 = 80%).
    pub optimal_utilization_bps: i128,
    /// Base funding rate (e.g. 100 = 1% annualized).
    pub base_funding_rate_bps: i128,
}

/// Role identifiers — canonical strings are defined in the `shared` crate.
/// Re-exported here so existing code referencing `roles::DEFAULT_ADMIN` etc. compiles unchanged.
pub mod roles {
    pub use shared::{
        ROLE_ADMIN as DEFAULT_ADMIN,
        ROLE_UPGRADER as UPGRADER,
        ROLE_PAUSER as PAUSER,
        ROLE_KEEPER as KEEPER,
    };
}
