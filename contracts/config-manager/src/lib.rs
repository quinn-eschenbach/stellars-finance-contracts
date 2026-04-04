#![no_std]

pub mod contract;
pub mod errors;
mod events;
pub mod logic;
pub mod storage;
pub mod types;

#[cfg(test)]
mod tests;

pub use contract::ConfigManagerContract;
pub use errors::ConfigManagerError;
pub use interfaces::{ConfigManager, ConfigManagerClient, UpgradeData};
pub use types::{BorrowRateConfig, FeeSplits, ProtocolLimits};
