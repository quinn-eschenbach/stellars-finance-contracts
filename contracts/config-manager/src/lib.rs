#![no_std]

pub mod contract;
pub mod errors;
pub mod logic;
pub mod storage;
pub mod types;

#[cfg(test)]
mod tests;

pub use contract::{ConfigManager, ConfigManagerClient, ConfigManagerContract};
pub use errors::ConfigManagerError;
pub use types::{FeeSplits, ProtocolLimits, UpgradeData};
