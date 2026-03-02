#![no_std]

pub mod contract;
mod errors;
mod logic;
mod math;
mod storage;
mod types;

#[cfg(test)]
pub mod tests;

pub use contract::{OracleRouterClient, OracleRouterContract, UpgradeData};
pub use errors::OracleRouterError;
pub use types::{CachedPrice, OracleConfig};
