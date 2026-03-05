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
}
