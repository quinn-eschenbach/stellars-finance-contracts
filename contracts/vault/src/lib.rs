#![no_std]

pub mod contract;
mod errors;
mod logic;
mod storage;

#[cfg(test)]
pub mod tests;

pub use contract::{VaultClient, VaultContract, VaultContractClient, UpgradeData};
pub use errors::VaultError;
