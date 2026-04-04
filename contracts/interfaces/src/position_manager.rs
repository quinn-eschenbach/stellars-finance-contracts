use soroban_sdk::{contractclient, Address, Env, Symbol};

use crate::types::{MarketInfo, Position};

/// PositionManager contract interface.
/// Trading engine for the perpetual DEX (positions, ADL, liquidations).
#[contractclient(name = "PositionManagerClient")]
pub trait PositionManager {
    /// Initialize the position manager. Can only be called once.
    fn initialize(
        env: Env,
        admin: Address,
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
        take_profit: i128,
        stop_loss: i128,
    );

    /// Close or reduce a position and realize PnL.
    fn decrease_position(env: Env, trader: Address, symbol: Symbol, size_delta: i128);

    /// Force-close an undercollateralized position. KEEPER only.
    fn liquidate_position(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Sync global borrow and funding accumulators. KEEPER only.
    fn update_indices(env: Env, caller: Address, symbol: Symbol);

    /// Execute a TP/SL order. KEEPER only.
    fn execute_order(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Set take-profit and stop-loss prices on an existing position.
    fn set_tp_sl(env: Env, trader: Address, symbol: Symbol, take_profit: i128, stop_loss: i128);

    /// Auto-Deleveraging: force-close highest-RoE position. KEEPER only.
    fn deleverage_position(env: Env, caller: Address, trader: Address, symbol: Symbol);

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

    /// Read-only: get a trader's position for a symbol.
    fn get_position(env: Env, trader: Address, symbol: Symbol) -> Position;

    /// Read-only: get global market state for a symbol.
    fn get_market(env: Env, symbol: Symbol) -> MarketInfo;
}
