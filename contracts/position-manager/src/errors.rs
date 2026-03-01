use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PositionManagerError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    /// New trade would push vault utilization past MaxUtilizationRatio (85%).
    UtilizationCapBreached = 4,
    /// decrease_position called before MinPositionLifetime has elapsed.
    PositionNotOldEnough = 5,
    PositionNotFound = 6,
    Unauthorized = 7,
    ZeroAmount = 8,
    /// liquidate_position called but the position is still healthy.
    HealthFactorOk = 9,
    /// deverage_position called but ADL trigger conditions are not met.
    AdlNotTriggered = 10,
}
