use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleRouterError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    /// All price sources returned data older than StalenessThreshold.
    StalePrice = 4,
    /// Spread between primary oracle sources exceeds MaxDeviation.
    PriceDeviationTooHigh = 5,
    /// No SEP-40 oracle sources are configured for the requested symbol.
    NoPriceSources = 6,
    /// Cross-contract call to an oracle source failed.
    PriceFetchFailed = 7,
}
