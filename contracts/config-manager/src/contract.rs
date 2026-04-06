use interfaces::ConfigManager;
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Env, Symbol};
use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

use crate::{
    errors::ConfigManagerError,
    events,
    logic::{
        admin_role_symbol, bump_instance_ttl, get_role_member, remove_role_member,
        require_admin_with_auth, set_role_member,
    },
    storage,
    types::{roles, BorrowRateConfig, FeeSplits, ProtocolLimits},
};

#[derive(UpgradeableMigratable)]
#[contract]
pub struct ConfigManagerContract;

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

        // Set sensible defaults so PM never panics reading unconfigured values
        storage::save_fee_splits(
            &env,
            &FeeSplits {
                keeper_bps: shared::DEFAULT_KEEPER_BPS,
                dev_bps: shared::DEFAULT_DEV_BPS,
                lp_bps: shared::DEFAULT_LP_BPS,
            },
        );
        storage::save_protocol_limits(
            &env,
            &ProtocolLimits {
                min_collateral: shared::DEFAULT_MIN_COLLATERAL,
                cooldown_duration: shared::DEFAULT_COOLDOWN_DURATION,
                min_position_lifetime: shared::DEFAULT_MIN_POSITION_LIFETIME,
                max_utilization_ratio: shared::DEFAULT_MAX_UTILIZATION_RATIO,
                funding_cut_bps: shared::DEFAULT_FUNDING_CUT_BPS,
                adl_pnl_bps: shared::DEFAULT_ADL_PNL_BPS,
                adl_utilization_bps: shared::DEFAULT_ADL_UTILIZATION_BPS,
            },
        );
        storage::save_borrow_rate_config(
            &env,
            &BorrowRateConfig {
                base_borrow_rate_bps: shared::DEFAULT_BASE_BORROW_RATE_BPS,
                slope1_bps: shared::DEFAULT_SLOPE1_BPS,
                slope2_bps: shared::DEFAULT_SLOPE2_BPS,
                optimal_utilization_bps: shared::DEFAULT_OPTIMAL_UTILIZATION_BPS,
                base_funding_rate_bps: shared::DEFAULT_BASE_FUNDING_RATE_BPS,
            },
        );

        storage::set_initialized(&env);
        bump_instance_ttl(&env);
    }

    fn grant_role(env: Env, caller: Address, role: Symbol, account: Address) {
        require_admin_with_auth(&env, &caller);
        // ADMIN role is managed exclusively via transfer_admin
        let admin_role = admin_role_symbol(&env);
        if role == admin_role {
            panic_with_error!(&env, ConfigManagerError::Unauthorized);
        }
        set_role_member(&env, &role, &account, true);
        events::RoleChange { role: role.clone(), account: account.clone(), is_grant: true }.publish(&env);
    }

    fn revoke_role(env: Env, caller: Address, role: Symbol, account: Address) {
        require_admin_with_auth(&env, &caller);
        let admin_role = admin_role_symbol(&env);
        if role == admin_role {
            panic_with_error!(&env, ConfigManagerError::Unauthorized);
        }
        remove_role_member(&env, &role, &account);
        events::RoleChange { role: role.clone(), account: account.clone(), is_grant: false }.publish(&env);
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
        events::FeeSplitsUpdate { keeper_bps: fee_splits.keeper_bps, dev_bps: fee_splits.dev_bps, lp_bps: fee_splits.lp_bps }.publish(&env);
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
        if limits.funding_cut_bps >= 10_000 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        if limits.adl_pnl_bps < 1 || limits.adl_pnl_bps > 10_000 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        if limits.adl_utilization_bps < 1 || limits.adl_utilization_bps > 10_000 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        // Safety ceilings: prevent trapping funds via extreme time parameters
        // 30 days max cooldown, 24 hours max position lifetime
        if limits.cooldown_duration > 2_592_000 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        if limits.min_position_lifetime > 86_400 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        storage::save_protocol_limits(&env, &limits);
        events::LimitsUpdate {
            min_collateral: limits.min_collateral,
            cooldown_duration: limits.cooldown_duration,
            min_position_lifetime: limits.min_position_lifetime,
            max_utilization_ratio: limits.max_utilization_ratio,
            funding_cut_bps: limits.funding_cut_bps,
            adl_pnl_bps: limits.adl_pnl_bps,
            adl_utilization_bps: limits.adl_utilization_bps,
        }.publish(&env);
        bump_instance_ttl(&env);
    }

    fn get_protocol_limits(env: Env) -> ProtocolLimits {
        storage::load_protocol_limits(&env)
    }

    fn get_fee_splits(env: Env) -> FeeSplits {
        storage::load_fee_splits(&env)
    }

    fn bump_config_state(env: Env) {
        bump_instance_ttl(&env);
    }

    fn update_borrow_rate_config(env: Env, caller: Address, config: BorrowRateConfig) {
        require_admin_with_auth(&env, &caller);
        if config.base_borrow_rate_bps < 0
            || config.slope1_bps < 0
            || config.slope2_bps < 0
            || config.base_funding_rate_bps < 0
        {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        if config.optimal_utilization_bps < 1 || config.optimal_utilization_bps > 10_000 {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        if config.slope2_bps < config.slope1_bps {
            panic_with_error!(&env, ConfigManagerError::InvalidLimits);
        }
        storage::save_borrow_rate_config(&env, &config);
        events::BorrowRateUpdate {
            base_borrow_rate_bps: config.base_borrow_rate_bps,
            slope1_bps: config.slope1_bps,
            slope2_bps: config.slope2_bps,
            optimal_utilization_bps: config.optimal_utilization_bps,
            base_funding_rate_bps: config.base_funding_rate_bps,
        }.publish(&env);
        bump_instance_ttl(&env);
    }

    fn get_borrow_rate_config(env: Env) -> BorrowRateConfig {
        storage::load_borrow_rate_config(&env)
    }

    fn transfer_admin(env: Env, caller: Address, new_admin: Address) {
        require_admin_with_auth(&env, &caller);
        // Require auth from the new admin to prove they control the address,
        // preventing irrecoverable bricking from a typo or wrong address.
        new_admin.require_auth();
        if caller == new_admin {
            return;
        }
        let admin_role = admin_role_symbol(&env);
        storage::set_admin(&env, &new_admin);
        remove_role_member(&env, &admin_role, &caller);
        set_role_member(&env, &admin_role, &new_admin, true);
        bump_instance_ttl(&env);
    }

}

impl UpgradeableMigratableInternal for ConfigManagerContract {
    type MigrationData = interfaces::MigrationData;

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
