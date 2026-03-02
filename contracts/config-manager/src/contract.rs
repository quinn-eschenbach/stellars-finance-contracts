use soroban_sdk::{contract, contractclient, contractimpl, panic_with_error, Address, Env, Symbol};
use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

use crate::{
    errors::ConfigManagerError,
    logic::{
        admin_role_symbol, bump_instance_ttl, get_role_member, remove_role_member,
        require_admin_with_auth, set_role_member,
    },
    storage,
    types::{roles, FeeSplits, ProtocolLimits, UpgradeData},
};

#[derive(UpgradeableMigratable)]
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

    /// Transfer the DEFAULT_ADMIN_ROLE from `caller` to `new_admin`.
    /// Updates both the instance-storage Admin key and the persistent
    /// RoleMember entry so that `has_role` and `require_admin` remain
    /// consistent. Only the current admin can call this.
    fn transfer_admin(env: Env, caller: Address, new_admin: Address);

    /// Set the deposit fee in basis points. Callable only by DEFAULT_ADMIN_ROLE.
    /// Valid range: 0 <= fee_bps <= 10_000.
    fn set_deposit_fee(env: Env, caller: Address, fee_bps: i128);
}

// ---------------------------------------------------------------------------
// Contract implementation
// ---------------------------------------------------------------------------

#[contractimpl]
impl ConfigManager for ConfigManagerContract {
    fn initialize(env: Env, admin_address: Address) {
        admin_address.require_auth();
        storage::check_not_initialized(&env);
        storage::set_admin(&env, &admin_address);
        let admin_role = admin_role_symbol(&env);
        set_role_member(&env, &admin_role, &admin_address, true);
        storage::set_initialized(&env);
        bump_instance_ttl(&env);
    }

    fn grant_role(env: Env, caller: Address, role: Symbol, account: Address) {
        require_admin_with_auth(&env, &caller);
        set_role_member(&env, &role, &account, true);
    }

    fn revoke_role(env: Env, caller: Address, role: Symbol, account: Address) {
        require_admin_with_auth(&env, &caller);
        // The ADMIN role is controlled exclusively via admin transfer, not
        // via revoke_role.  Blocking this prevents split-brain between the
        // instance-storage Admin key and the persistent RoleMember entry.
        let admin_role = admin_role_symbol(&env);
        if role == admin_role {
            panic_with_error!(&env, ConfigManagerError::Unauthorized);
        }
        // Idempotent: remove regardless of whether the entry existed.
        remove_role_member(&env, &role, &account);
    }

    fn has_role(env: Env, role: Symbol, account: Address) -> bool {
        get_role_member(&env, &role, &account)
    }

    fn update_fee_splits(env: Env, caller: Address, fee_splits: FeeSplits) {
        require_admin_with_auth(&env, &caller);
        if fee_splits.keeper_bps == 0 || fee_splits.dev_bps == 0 || fee_splits.lp_bps == 0 {
            panic_with_error!(&env, ConfigManagerError::InvalidFeeSplits);
        }
        if fee_splits.keeper_bps + fee_splits.dev_bps + fee_splits.lp_bps != 10_000 {
            panic_with_error!(&env, ConfigManagerError::InvalidFeeSplits);
        }
        storage::save_fee_splits(&env, &fee_splits);
        bump_instance_ttl(&env);
    }

    fn update_protocol_limits(env: Env, caller: Address, limits: ProtocolLimits) {
        require_admin_with_auth(&env, &caller);
        if limits.min_collateral < 1 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        if limits.max_utilization_ratio < 1 || limits.max_utilization_ratio > 10_000 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        storage::save_protocol_limits(&env, &limits);
        bump_instance_ttl(&env);
    }

    fn get_protocol_limits(env: Env) -> ProtocolLimits {
        storage::load_protocol_limits(&env)
    }

    fn get_fee_splits(env: Env) -> FeeSplits {
        storage::load_fee_splits(&env)
    }

    fn get_deposit_fee(env: Env) -> i128 {
        storage::load_deposit_fee(&env)
    }

    fn bump_config_state(env: Env) {
        bump_instance_ttl(&env);
    }

    fn transfer_admin(env: Env, caller: Address, new_admin: Address) {
        require_admin_with_auth(&env, &caller);
        if caller == new_admin {
            return;
        }
        let admin_role = admin_role_symbol(&env);
        storage::set_admin(&env, &new_admin);
        remove_role_member(&env, &admin_role, &caller);
        set_role_member(&env, &admin_role, &new_admin, true);
        bump_instance_ttl(&env);
    }

    fn set_deposit_fee(env: Env, caller: Address, fee_bps: i128) {
        require_admin_with_auth(&env, &caller);
        if !(0..=10_000).contains(&fee_bps) {
            panic_with_error!(&env, ConfigManagerError::InvalidDepositFee);
        }
        storage::save_deposit_fee(&env, fee_bps);
        bump_instance_ttl(&env);
    }
}

impl UpgradeableMigratableInternal for ConfigManagerContract {
    type MigrationData = UpgradeData;

    fn _require_auth(e: &Env, operator: &Address) {
        operator.require_auth();
        let upgrader_role = Symbol::new(e, roles::UPGRADER);
        if !get_role_member(e, &upgrader_role, operator) {
            panic_with_error!(e, ConfigManagerError::Unauthorized);
        }
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        storage::save_version(e, data.version);
    }
}
