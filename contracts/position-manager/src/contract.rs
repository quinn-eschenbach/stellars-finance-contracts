use interfaces::{MarketInfo, Position, PositionManager};
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Env, Symbol};

use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

use crate::close;
use crate::errors::PositionManagerError;
use crate::events;
use crate::logic;
use crate::storage;
use crate::tick::MarketTick;

#[derive(UpgradeableMigratable)]
#[contract]
pub struct PositionManagerContract;

// ---------------------------------------------------------------------------
// Implementation — thin routing layer
// ---------------------------------------------------------------------------

#[contractimpl]
impl PositionManager for PositionManagerContract {
    fn initialize(
        env: Env,
        admin: Address,
        vault_address: Address,
        config_manager: Address,
        oracle_router: Address,
    ) {
        logic::require_not_initialized(&env);
        admin.require_auth();
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
        take_profit: i128,
        stop_loss: i128,
    ) {
        logic::require_initialized(&env);
        logic::require_not_paused(&env);
        trader.require_auth();
        logic::require_positive(&env, size);
        logic::require_positive(&env, collateral);
        logic::do_increase_position(
            &env,
            &trader,
            &symbol,
            size,
            collateral,
            is_long,
            take_profit,
            stop_loss,
        );
        shared::bump_instance_ttl(&env);
    }

    fn decrease_position(env: Env, trader: Address, symbol: Symbol, size_delta: i128) {
        logic::require_initialized(&env);
        // Intentionally no pause check — traders must always be able to close.
        trader.require_auth();
        logic::require_positive(&env, size_delta);
        close::do_decrease_position(&env, &trader, &symbol, size_delta);
        shared::bump_instance_ttl(&env);
    }

    fn liquidate_position(env: Env, caller: Address, trader: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        // Intentionally no pause check — liquidations must always work to prevent bad debt
        logic::require_keeper(&env, &caller);
        close::do_liquidate_position(&env, &caller, &trader, &symbol);
        shared::bump_instance_ttl(&env);
    }

    fn update_indices(env: Env, caller: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        logic::require_not_paused(&env);
        logic::require_keeper(&env, &caller);
        MarketTick::refresh(&env, &symbol);
        shared::bump_instance_ttl(&env);
    }

    fn execute_order(env: Env, caller: Address, trader: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        // TP/SL orders protect traders and must execute during emergencies
        logic::require_keeper(&env, &caller);
        close::do_execute_order(&env, &caller, &trader, &symbol);
        shared::bump_instance_ttl(&env);
    }

    fn set_tp_sl(env: Env, trader: Address, symbol: Symbol, take_profit: i128, stop_loss: i128) {
        logic::require_initialized(&env);
        logic::require_not_paused(&env);
        trader.require_auth();
        logic::do_set_tp_sl(&env, &trader, &symbol, take_profit, stop_loss);
        shared::bump_instance_ttl(&env);
    }

    fn deleverage_position(env: Env, caller: Address, trader: Address, symbol: Symbol) {
        logic::require_initialized(&env);
        // No pause check — ADL must work during crises, like liquidations
        logic::require_keeper(&env, &caller);
        close::do_deleverage_position(&env, &trader, &symbol);
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
        events::Pause { is_paused: true, caller: caller.clone() }.publish(&env);
    }

    fn unpause(env: Env, caller: Address) {
        logic::require_initialized(&env);
        logic::require_pauser(&env, &caller);
        storage::set_paused(&env, false);
        storage::set_last_unpause_time(&env, env.ledger().timestamp());
        events::Pause { is_paused: false, caller: caller.clone() }.publish(&env);
    }

    fn set_max_leverage(env: Env, caller: Address, symbol: Symbol, max_leverage: i128) {
        logic::require_initialized(&env);
        logic::require_admin(&env, &caller);
        logic::require_positive(&env, max_leverage);
        if max_leverage > crate::math::MAX_LEVERAGE_CAP {
            panic_with_error!(&env, PositionManagerError::LeverageCapExceeded);
        }
        storage::set_max_leverage(&env, &symbol, max_leverage);
        events::SetMaxLeverage { symbol: symbol.clone(), max_leverage }.publish(&env);
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
    type MigrationData = interfaces::MigrationData;

    fn _require_auth(e: &Env, operator: &Address) {
        let config_mgr = storage::get_config_manager(e);
        shared::require_role(e, operator, &config_mgr, shared::ROLE_UPGRADER);
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        storage::save_version(e, data.version);
    }
}
