use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ConfigManagerError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    /// FeeSplits values do not sum to 10_000 bps.
    InvalidFeeSplits = 4,
    /// One or more ProtocolLimits values are out of acceptable range.
    InvalidLimits = 5,
    /// Deposit fee is outside the valid range [0, 10_000] bps.
    InvalidDepositFee = 6,
}
