use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    InsufficientFreeLiquidity = 4,
    Unauthorized = 5,
    ZeroAmount = 6,
    NotPositionManager = 7,
    CooldownNotElapsed = 8,
    /// Reservation would exceed total vault assets.
    ReservationExceedsTotalAssets = 9,
    /// claim_fees_to amount exceeds available unclaimed fees.
    InsufficientFees = 10,
    /// `accrue_fees` would push `unclaimed_fees + reserved_usdc` above total_assets.
    FeeAccrualExceedsAssets = 11,
    /// `record_absorbed_collateral` saw a vault balance delta that differs from
    /// the supplied `amount` — PM and Vault disagree on what actually moved.
    AbsorbedCollateralMismatch = 12,
    /// `deposit`/`mint` only accept self-deposits: receiver, from, and operator
    /// must all match.
    DepositMustBeSelf = 13,
    /// `upgrade` rejected — no `propose_upgrade` was made before commit.
    NoPendingUpgrade = 14,
    /// `upgrade` rejected — timelock has not elapsed yet.
    UpgradeTimelockNotElapsed = 15,
    /// `upgrade` rejected — `new_wasm_hash` does not match the proposed
    /// `PendingUpgrade.wasm_hash`.
    UpgradeHashMismatch = 16,
}
