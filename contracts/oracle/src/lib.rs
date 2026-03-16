#![no_std]

pub mod contract;
mod errors;
mod storage;

pub use contract::{Oracle, OracleClient, OracleContract, UpgradeData};
pub use errors::OracleError;
