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
    /// deleverage_position called but ADL trigger conditions are not met.
    AdlNotTriggered = 10,
    /// Position leverage exceeds the per-market max leverage.
    ExcessiveLeverage = 11,
    /// No max leverage configured for this market symbol.
    MarketNotConfigured = 12,
    /// execute_order called but neither TP nor SL trigger condition is met.
    OrderNotTriggered = 13,
    /// Invalid take-profit or stop-loss price for the position direction.
    InvalidTpSl = 14,
    /// increase_position called with `is_long` opposite to the existing position's direction.
    DirectionMismatch = 15,
    /// Collateral below the protocol's min_collateral limit.
    BelowMinCollateral = 16,
}
