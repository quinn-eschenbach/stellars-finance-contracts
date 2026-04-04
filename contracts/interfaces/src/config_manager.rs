use shared::{BorrowRateConfig, FeeSplits, ProtocolLimits};
use soroban_sdk::{contractclient, Address, Env, Symbol};

/// ConfigManager contract interface.
/// Manages protocol roles, fee splits, limits, and borrow rate configuration.
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

    /// Extends the Soroban TTL of critical config variables to prevent archival.
    fn bump_config_state(env: Env);

    /// Update borrow rate and funding rate configuration. Callable only by DEFAULT_ADMIN_ROLE.
    fn update_borrow_rate_config(env: Env, caller: Address, config: BorrowRateConfig);

    /// Returns the current borrow rate configuration.
    fn get_borrow_rate_config(env: Env) -> BorrowRateConfig;

    /// Transfer the DEFAULT_ADMIN_ROLE from `caller` to `new_admin`.
    fn transfer_admin(env: Env, caller: Address, new_admin: Address);
}
