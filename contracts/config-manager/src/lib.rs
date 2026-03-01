#![no_std]

mod errors;
mod storage;
mod types;

use soroban_sdk::{contract, contractclient, contractimpl, Address, Env, Symbol};

pub use errors::ConfigManagerError;
pub use types::{FeeSplits, ProtocolLimits};

#[contract]
pub struct ConfigManagerContract;

#[contractclient(name = "ConfigManagerClient")]
pub trait ConfigManager {
    /// Initialize the config manager. Can only be called once.
    /// Grants DEFAULT_ADMIN_ROLE to `admin_address` via OpenZeppelin AccessControl.
    fn initialize(env: Env, admin_address: Address);

    /// Grant a role to an account. Callable only by DEFAULT_ADMIN_ROLE.
    /// Role is a Symbol created with symbol_short! (e.g., "KEEPER", "PAUSER").
    fn grant_role(env: Env, caller: Address, role: Symbol, account: Address);

    /// Revoke a role from an account. Callable only by DEFAULT_ADMIN_ROLE.
    fn revoke_role(env: Env, caller: Address, role: Symbol, account: Address);

    /// Check whether `account` holds the given role.
    fn has_role(env: Env, role: Symbol, account: Address) -> bool;

    /// Update the fee split configuration. Callable only by DEFAULT_ADMIN_ROLE.
    /// Validates that keeper_bps + dev_bps + lp_bps == 10_000.
    fn update_fee_splits(env: Env, caller: Address, fee_splits: FeeSplits);

    /// Update global protocol limits. Callable only by DEFAULT_ADMIN_ROLE.
    fn update_protocol_limits(env: Env, caller: Address, limits: ProtocolLimits);

    /// Returns the current protocol limits.
    fn get_protocol_limits(env: Env) -> ProtocolLimits;

    /// Returns the current fee split configuration.
    fn get_fee_splits(env: Env) -> FeeSplits;

    /// Returns the deposit fee in basis points.
    fn get_deposit_fee(env: Env) -> i128;

    /// Extends the Soroban TTL of critical config variables to prevent archival.
    fn bump_config_state(env: Env);
}

#[contractimpl]
impl ConfigManager for ConfigManagerContract {
    fn initialize(env: Env, admin_address: Address) {
        todo!()
    }

    fn grant_role(env: Env, caller: Address, role: Symbol, account: Address) {
        todo!()
    }

    fn revoke_role(env: Env, caller: Address, role: Symbol, account: Address) {
        todo!()
    }

    fn has_role(env: Env, role: Symbol, account: Address) -> bool {
        todo!()
    }

    fn update_fee_splits(env: Env, caller: Address, fee_splits: FeeSplits) {
        todo!()
    }

    fn update_protocol_limits(env: Env, caller: Address, limits: ProtocolLimits) {
        todo!()
    }

    fn get_protocol_limits(env: Env) -> ProtocolLimits {
        todo!()
    }

    fn get_fee_splits(env: Env) -> FeeSplits {
        todo!()
    }

    fn get_deposit_fee(env: Env) -> i128 {
        todo!()
    }

    fn bump_config_state(env: Env) {
        todo!()
    }
}
