use soroban_sdk::{contract, contractclient, contractimpl, contracttype, panic_with_error, Address, Env, Symbol};

use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

use crate::errors::PositionManagerError;
use crate::logic;
use crate::storage;
use crate::types::{MarketInfo, Position};

#[contracttype]
pub struct UpgradeData {
    pub version: u32,
}

#[derive(UpgradeableMigratable)]
#[contract]
pub struct PositionManagerContract;

// ---------------------------------------------------------------------------
// Cross-contract client trait
// ---------------------------------------------------------------------------

#[contractclient(name = "PositionManagerClient")]
pub trait PositionManager {
    /// Initialize the position manager. Can only be called once.
    fn initialize(
        env: Env,
        vault_address: Address,
        config_manager: Address,
        oracle_router: Address,
    );

    /// Open or add to a leveraged position.
    fn increase_position(
        env: Env,
        trader: Address,
        symbol: Symbol,
        size: i128,
        collateral: i128,
        is_long: bool,
    );

    /// Close or reduce a position and realize PnL.
    /// Intentionally bypasses pause check.
    fn decrease_position(env: Env, trader: Address, symbol: Symbol, size_delta: i128);

    /// Force-close an undercollateralized position. KEEPER only.
    fn liquidate_position(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Sync global borrow and funding accumulators. KEEPER only.
    fn update_indices(env: Env, caller: Address, symbol: Symbol);

    /// Execute a limit/stop order. KEEPER only. (V2 stub)
    fn execute_order(env: Env, caller: Address, order_id: u64);

    /// Auto-Deleveraging: force-close highest-RoE position. KEEPER only.
    fn deverage_position(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Extend Soroban TTL for an active position.
    fn bump_position(env: Env, user_address: Address, symbol: Symbol);

    /// Emergency pause — PAUSER role only.
    fn pause(env: Env, caller: Address);

    /// Unpause — PAUSER role only.
    fn unpause(env: Env, caller: Address);

    /// Set the maximum leverage for a market. ADMIN only.
    fn set_max_leverage(env: Env, caller: Address, symbol: Symbol, max_leverage: i128);

    /// Get the maximum leverage for a market.
    fn get_max_leverage(env: Env, symbol: Symbol) -> i128;

    // Read-only views
    fn get_position(env: Env, trader: Address, symbol: Symbol) -> Position;
    fn get_market(env: Env, symbol: Symbol) -> MarketInfo;
}

// ---------------------------------------------------------------------------
// Implementation — thin routing layer
// ---------------------------------------------------------------------------

#[contractimpl]
impl PositionManager for PositionManagerContract {
    fn initialize(
        env: Env,
        vault_address: Address,
        config_manager: Address,
        oracle_router: Address,
    ) {
        logic::require_not_initialized(&env);
        storage::set_initialized(&env);
        storage::set_vault_address(&env, &vault_address);
        storage::set_config_manager(&env, &config_manager);
        storage::set_oracle_router(&env, &oracle_router);
        storage::set_paused(&env, false);
        shared::bump_instance_ttl(&env);
    }

    fn increase_position(
        env: Env,
        trader: Address,
        symbol: Symbol,
        size: i128,
        collateral: i128,
        is_long: bool,
    ) {
        logic::require_initialized(&env);
        logic::require_not_paused(&env);
        trader.require_auth();
        logic::require_positive(&env, size);
        logic::require_positive(&env, collateral);
        logic::do_increase_position(&env, &trader, &symbol, size, collateral, is_long);
        shared::bump_instance_ttl(&env);
    }

    fn decrease_position(env: Env, trader: Address, symbol: Symbol, size_delta: i128) {
        logic::require_initialized(&env);
        // Intentionally no pause check — traders must always be able to close.
        trader.require_auth();
        logic::require_positive(&env, size_delta);
        logic::do_decrease_position(&env, &trader, &symbol, size_delta);
        shared::bump_instance_ttl(&env);
    }

    fn liquidate_position(env: Env, caller: Address, trader: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        // Intentionally no pause check — liquidations must always work to prevent bad debt
        logic::require_keeper(&env, &caller);
        logic::do_liquidate_position(&env, &caller, &trader, &symbol);
        shared::bump_instance_ttl(&env);
    }

    fn update_indices(env: Env, caller: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        logic::require_not_paused(&env);
        logic::require_keeper(&env, &caller);
        logic::do_update_indices(&env, &symbol);
        shared::bump_instance_ttl(&env);
    }

    fn execute_order(env: Env, caller: Address, _order_id: u64) {
        logic::require_initialized(&env);
        logic::require_not_paused(&env);
        logic::require_keeper(&env, &caller);
        panic_with_error!(&env, PositionManagerError::ZeroAmount); // V2 stub
    }

    fn deverage_position(env: Env, caller: Address, trader: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        logic::require_not_paused(&env);
        logic::require_keeper(&env, &caller);
        logic::do_deverage_position(&env, &trader, &symbol);
        shared::bump_instance_ttl(&env);
    }

    fn bump_position(env: Env, user_address: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        // Verify position exists
        storage::get_position(&env, &user_address, &symbol)
            .unwrap_or_else(|| panic_with_error!(&env, PositionManagerError::PositionNotFound));
        storage::bump_position_ttl(&env, &user_address, &symbol);
    }

    fn pause(env: Env, caller: Address) {
        logic::require_initialized(&env);
        logic::require_pauser(&env, &caller);
        storage::set_paused(&env, true);
    }

    fn unpause(env: Env, caller: Address) {
        logic::require_initialized(&env);
        logic::require_pauser(&env, &caller);
        storage::set_paused(&env, false);
    }

    fn set_max_leverage(env: Env, caller: Address, symbol: Symbol, max_leverage: i128) {
        logic::require_initialized(&env);
        logic::require_admin(&env, &caller);
        logic::require_positive(&env, max_leverage);
        storage::set_max_leverage(&env, &symbol, max_leverage);
        shared::bump_instance_ttl(&env);
    }

    fn get_max_leverage(env: Env, symbol: Symbol) -> i128 {
        logic::require_initialized(&env);
        storage::get_max_leverage(&env, &symbol)
            .unwrap_or_else(|| panic_with_error!(&env, PositionManagerError::MarketNotConfigured))
    }

    fn get_position(env: Env, trader: Address, symbol: Symbol) -> Position {
        logic::require_initialized(&env);
        storage::get_position(&env, &trader, &symbol)
            .unwrap_or_else(|| panic_with_error!(&env, PositionManagerError::PositionNotFound))
    }

    fn get_market(env: Env, symbol: Symbol) -> MarketInfo {
        logic::require_initialized(&env);
        storage::get_market(&env, &symbol)
    }
}

impl UpgradeableMigratableInternal for PositionManagerContract {
    type MigrationData = UpgradeData;

    fn _require_auth(e: &Env, operator: &Address) {
        let config_mgr = storage::get_config_manager(e);
        shared::require_role(e, operator, &config_mgr, shared::ROLE_UPGRADER);
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        storage::save_version(e, data.version);
    }
}
