use soroban_sdk::{contractclient, Address, BytesN, Env, Symbol};

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

    /// Open or add to a leveraged position. `acceptable_price` bounds the
    /// mark price the open is willing to execute at — pass `0` to skip the
    /// slippage check. For longs, revert if `mark_price > acceptable_price`;
    /// for shorts, revert if `mark_price < acceptable_price`.
    ///
    /// **TP/SL semantics on increase**: `take_profit = 0` and `stop_loss = 0`
    /// mean "leave the prior value unchanged" — `0` does NOT clear an
    /// existing order. To clear TP/SL, call [`set_tp_sl`] with the explicit
    /// `0` value (which clears, refunds escrow, and emits `SetTpSl`).
    fn increase_position(
        env: Env,
        trader: Address,
        symbol: Symbol,
        size: i128,
        collateral: i128,
        is_long: bool,
        take_profit: i128,
        stop_loss: i128,
        acceptable_price: i128,
    );

    /// Close or reduce a position and realize PnL. `acceptable_price` bounds
    /// the mark price the close is willing to execute at — pass `0` to skip
    /// the slippage check. For longs (closing on the bid), revert if
    /// `mark_price < acceptable_price`; for shorts (closing on the ask),
    /// revert if `mark_price > acceptable_price`.
    fn decrease_position(
        env: Env,
        trader: Address,
        symbol: Symbol,
        size_delta: i128,
        acceptable_price: i128,
    );

    /// Force-close an undercollateralized position. KEEPER only.
    fn liquidate_position(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Sync global borrow and funding accumulators. KEEPER only.
    fn update_indices(env: Env, caller: Address, symbol: Symbol);

    /// Execute a TP/SL order. KEEPER only.
    fn execute_order(env: Env, caller: Address, trader: Address, symbol: Symbol);

    /// Set take-profit and stop-loss prices on an existing position. Passing
    /// `0` for either field CLEARS that side; this is the opposite of the
    /// `0`-means-leave-unchanged semantics on [`increase_position`]. Calling
    /// `set_tp_sl(trader, symbol, 0, 0)` clears both and refunds the
    /// execution-fee escrow.
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
    /// Floor enforced at `shared::constants::MIN_LEVERAGE` — use
    /// `disable_market` to take a market offline.
    fn set_max_leverage(env: Env, caller: Address, symbol: Symbol, max_leverage: i128);

    /// Get the maximum leverage for a market.
    fn get_max_leverage(env: Env, symbol: Symbol) -> i128;

    /// Disable trading for `symbol` — opens are rejected, closes still work.
    /// PAUSER only. Distinct from a global pause; emits MarketDisabled.
    fn disable_market(env: Env, caller: Address, symbol: Symbol);

    /// Re-enable a previously disabled market. PAUSER only.
    fn enable_market(env: Env, caller: Address, symbol: Symbol);

    /// Returns true if `symbol` is currently disabled for opens.
    fn is_market_disabled(env: Env, symbol: Symbol) -> bool;

    /// Propose a WASM upgrade. UPGRADER role only.
    fn propose_upgrade(env: Env, caller: Address, wasm_hash: BytesN<32>);

    /// PAUSER veto of a pending upgrade.
    fn cancel_upgrade(env: Env, caller: Address);

    /// Read-only: get a trader's position for a symbol.
    fn get_position(env: Env, trader: Address, symbol: Symbol) -> Position;

    /// Read-only: get global market state for a symbol.
    fn get_market(env: Env, symbol: Symbol) -> MarketInfo;
}
