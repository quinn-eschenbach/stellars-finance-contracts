pub use shared::{BorrowRateConfig, FeeSplits, ProtocolLimits};

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
