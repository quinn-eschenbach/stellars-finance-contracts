#![no_std]

mod errors;
mod storage;
mod types;

use soroban_sdk::{contract, contractclient, contractimpl, contracttype, Address, Env, Symbol};
use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

pub use errors::PositionManagerError;
pub use types::{MarketInfo, Position};

#[contracttype]
pub struct UpgradeData {
    pub version: u32,
}

#[derive(UpgradeableMigratable)]
#[contract]
pub struct PositionManagerContract;

#[contractclient(name = "PositionManagerClient")]
pub trait PositionManager {
    /// Initialize the position manager. Can only be called once.
    fn initialize(env: Env, vault_address: Address, config_manager: Address);

    /// Open or add to a leveraged position.
    ///
    /// Checks:
    ///   - Reverts if paused.
    ///   - Reverts if new trade pushes vault utilization past MaxUtilizationRatio (85%).
    ///
    /// Actions:
    ///   - Updates global average prices for the market.
    ///   - Reserves USDC collateral in the Vault.
    ///   - Records `last_increased_time = current_timestamp` (anti-front-running).
    fn increase_position(
        env: Env,
        trader: Address,
        symbol: Symbol,
        size: i128,
        collateral: i128,
        is_long: bool,
    );

    /// Close or reduce a position and realize PnL.
    ///
    /// Intentionally bypasses the Pausable check so users can always reduce
    /// risk even during an emergency pause.
    ///
    /// Checks:
    ///   - Reverts if current_time < last_increased_time + MinPositionLifetime.
    fn decrease_position(env: Env, trader: Address, symbol: Symbol, size_delta: i128);

    /// Force-close an undercollateralized position. Callable only by KEEPER_ROLE.
    ///
    /// Checks health: Collateral < Unrealized Loss + Accrued Fees
    /// On success: seizes remaining collateral, pays keeper reward from vault.
    fn liquidate_position(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Sync global borrow and funding accumulators. Callable only by KEEPER_ROLE.
    ///
    /// Calculates accrued fees since last update using the kink curve for
    /// borrow rates and the proportional model for funding rates.
    fn update_indices(env: Env, caller: Address, symbol: Symbol);

    /// Execute a limit, stop-loss, or take-profit order. Callable only by KEEPER_ROLE.
    fn execute_order(env: Env, caller: Address, order_id: u64);

    /// Auto-Deleveraging: force-close the highest-RoE position to restore solvency.
    /// Callable only by KEEPER_ROLE.
    ///
    /// ADL triggers (either condition):
    ///   - Total Reserved PnL > 90% of Vault Balance (insolvency risk).
    ///   - ReservedUSDC / TotalUSDC > 95% (liquidity crisis risk).
    ///
    /// The selected trader keeps all accrued profits; only their position is closed.
    fn deverage_position(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Extends the Soroban TTL for a specific active position in persistent storage.
    /// Keepers call this periodically to prevent active trade data from being archived.
    fn bump_position(env: Env, user_address: Address, symbol: Symbol);

    // -------------------------------------------------------------------------
    // Read-only views
    // -------------------------------------------------------------------------

    fn get_position(env: Env, trader: Address, symbol: Symbol) -> Position;

    fn get_market(env: Env, symbol: Symbol) -> MarketInfo;
}

#[contractimpl]
impl PositionManager for PositionManagerContract {
    fn initialize(env: Env, vault_address: Address, config_manager: Address) {
        todo!()
    }

    fn increase_position(
        env: Env,
        trader: Address,
        symbol: Symbol,
        size: i128,
        collateral: i128,
        is_long: bool,
    ) {
        todo!()
    }

    fn decrease_position(env: Env, trader: Address, symbol: Symbol, size_delta: i128) {
        todo!()
    }

    fn liquidate_position(env: Env, caller: Address, trader: Address, symbol: Symbol) {
        todo!()
    }

    fn update_indices(env: Env, caller: Address, symbol: Symbol) {
        todo!()
    }

    fn execute_order(env: Env, caller: Address, order_id: u64) {
        todo!()
    }

    fn deverage_position(env: Env, caller: Address, trader: Address, symbol: Symbol) {
        todo!()
    }

    fn bump_position(env: Env, user_address: Address, symbol: Symbol) {
        todo!()
    }

    fn get_position(env: Env, trader: Address, symbol: Symbol) -> Position {
        todo!()
    }

    fn get_market(env: Env, symbol: Symbol) -> MarketInfo {
        todo!()
    }
}

impl UpgradeableMigratableInternal for PositionManagerContract {
    type MigrationData = UpgradeData;

    fn _require_auth(e: &Env, operator: &Address) {
        todo!()
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        todo!()
    }
}
