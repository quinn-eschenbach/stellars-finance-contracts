use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ConfigManagerError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    /// FeeSplits values do not sum to 10_000 bps, are zero, or exceed BPS.
    /// Catch-all for any FeeSplits violation — kept stable so existing
    /// tests / indexer consumers don't break. Per-rule codes 20-22 below.
    InvalidFeeSplits = 4,
    /// One or more ProtocolLimits values are out of acceptable range.
    /// Catch-all — per-rule codes 30-37 below.
    InvalidLimits = 5,
    /// `set_upgrade_timelock` called with seconds below `MIN_UPGRADE_TIMELOCK`.
    UpgradeTimelockTooShort = 6,
    /// `propose_admin(caller, new_admin)` rejected because `caller == new_admin`.
    InvalidAdminProposal = 7,
    /// `accept_admin` rejected — caller is not the currently pending admin.
    NotPendingAdmin = 8,
    /// `accept_admin` rejected — there is no pending admin proposal.
    NoPendingAdmin = 9,
    /// `upgrade` rejected — no `propose_upgrade` was made before commit.
    /// The two-step upgrade flow requires a prior proposal.
    NoPendingUpgrade = 10,
    /// `upgrade` rejected — timelock has not elapsed yet.
    UpgradeTimelockNotElapsed = 11,
    /// `upgrade` rejected — `new_wasm_hash` does not match the proposed
    /// `PendingUpgrade.wasm_hash`.
    UpgradeHashMismatch = 12,

    // ---- Per-rule FeeSplits codes (20–22) ----
    /// A FeeSplits component (keeper/dev/lp) is zero.
    InvalidFeeSplitZero = 20,
    /// A FeeSplits component exceeds the BPS denominator.
    InvalidFeeSplitOverBps = 21,
    /// FeeSplits components do not sum to exactly BPS_DENOMINATOR.
    InvalidFeeSplitSum = 22,

    // ---- Per-rule ProtocolLimits codes (30–37) ----
    /// `min_collateral` is not strictly positive.
    InvalidMinCollateral = 30,
    /// `max_utilization_ratio` is out of (0, BPS] range.
    InvalidMaxUtilization = 31,
    /// `funding_cut_bps` exceeds `MAX_FUNDING_CUT_BPS`.
    InvalidFundingCut = 32,
    /// `adl_pnl_bps` is below `MIN_ADL_PNL_BPS` or above BPS.
    InvalidAdlPnl = 33,
    /// `adl_utilization_bps` is out of (0, BPS] range.
    InvalidAdlUtilization = 34,
    /// `liquidation_threshold_bps` exceeds 10% of collateral.
    InvalidLiquidationThreshold = 35,
    /// `cooldown_duration` exceeds `MAX_COOLDOWN_DURATION`.
    InvalidCooldownDuration = 36,
    /// `min_position_lifetime` exceeds 1 day.
    InvalidMinPositionLifetime = 37,

    // ---- Per-rule BorrowRateConfig codes (40–43) ----
    /// A BorrowRateConfig rate is negative.
    InvalidBorrowRateNegative = 40,
    /// `optimal_utilization_bps` is out of (0, BPS] range.
    InvalidOptimalUtilization = 41,
    /// `slope2_bps < slope1_bps` — kink curve must be non-decreasing.
    InvalidSlopeOrdering = 42,
    /// `slope2_bps` exceeds `MAX_SLOPE2_BPS`.
    InvalidSlopeTooSteep = 43,
}
