// Position-close lifecycle. The four kind-specific entry points
// (decrease / liquidate / deleverage / execute-order) handle their own
// pre-validation (lifetime / health / ADL trigger / TP-SL trigger) and emit
// their own events; the shared `execute_close` owns the rest — settlement
// money flows, realized-PnL update, fee distribution with the underwater
// cap, OI/avg/reservation updates, position cleanup, and post-mutation
// PnL refresh.

use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env, Symbol};

use interfaces::VaultClient;

use crate::errors::PositionManagerError;
use crate::events;
use crate::logic::{get_vault_asset, load_fee_splits, load_limits, refresh_market_unrealized_pnl};
use crate::math;
use crate::storage;
use crate::tick::{MarketTick, PositionEvaluation};
use crate::types::Position;

/// Reason a Close was triggered. Determines fee distribution.
pub enum CloseType {
    UserClose,
    OrderExecution,
    Liquidation,
    Deleverage,
}

// ---------------------------------------------------------------------------
// Decrease (user-initiated, partial or full close)
// ---------------------------------------------------------------------------

pub fn do_decrease_position(env: &Env, trader: &Address, symbol: &Symbol, size_delta: i128) {
    let market_tick = MarketTick::refresh(env, symbol);
    let mark_price = market_tick.mark_price;

    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    // Anti-front-running: enforce minimum position lifetime.
    let limits = load_limits(env);
    let now = env.ledger().timestamp();
    if now < pos.last_increased_time + limits.min_position_lifetime {
        panic_with_error!(env, PositionManagerError::PositionNotOldEnough);
    }

    // Clamp to position size.
    let actual_delta = if size_delta >= pos.size { pos.size } else { size_delta };
    let is_full_close = actual_delta == pos.size;

    // Proportional collateral.
    let collateral_delta = if is_full_close {
        pos.collateral
    } else {
        pos.collateral * actual_delta / pos.size
    };

    let eval = market_tick.evaluate(&pos, actual_delta, collateral_delta);

    execute_close(
        env,
        trader,
        symbol,
        &pos,
        market_tick,
        actual_delta,
        collateral_delta,
        &eval,
        &CloseType::UserClose,
        None,
    );

    events::DecreasePosition {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size_delta: actual_delta,
        pnl: eval.pnl,
        borrow_fee: eval.borrow_fee,
        funding_fee: eval.funding_fee,
        mark_price,
        is_full_close,
    }
    .publish(env);
}

// ---------------------------------------------------------------------------
// Liquidate (keeper-initiated, gated on health < 0)
// ---------------------------------------------------------------------------

pub fn do_liquidate_position(env: &Env, caller: &Address, trader: &Address, symbol: &Symbol) {
    let market_tick = MarketTick::refresh(env, symbol);
    let mark_price = market_tick.mark_price;

    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    let eval = market_tick.evaluate(&pos, pos.size, pos.collateral);

    if eval.health >= 0 {
        panic_with_error!(env, PositionManagerError::HealthFactorOk);
    }

    let pos_size = pos.size;
    let pos_collateral = pos.collateral;

    execute_close(
        env,
        trader,
        symbol,
        &pos,
        market_tick,
        pos_size,
        pos_collateral,
        &eval,
        &CloseType::Liquidation,
        Some(caller),
    );

    events::Liquidate {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size: pos_size,
        collateral: pos_collateral,
        pnl: eval.pnl,
        borrow_fee: eval.borrow_fee,
        funding_fee: eval.funding_fee,
        mark_price,
        keeper: caller.clone(),
    }
    .publish(env);
}

// ---------------------------------------------------------------------------
// Deleverage / ADL (keeper-initiated, gated on global PnL or utilization)
// ---------------------------------------------------------------------------

pub fn do_deleverage_position(env: &Env, trader: &Address, symbol: &Symbol) {
    let market_tick = MarketTick::refresh(env, symbol);
    let mark_price = market_tick.mark_price;

    // Check ADL trigger conditions: PnL-based OR utilization-based.
    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let total_reserved = vault.reserved_usdc();
    let total_assets = vault.total_assets();

    let limits = load_limits(env);
    let combined_pnl = storage::get_realized_pnl(env) + storage::get_total_unrealized_pnl(env);
    let pnl_ratio = if total_assets > 0 && combined_pnl > 0 {
        combined_pnl * math::BPS / total_assets
    } else {
        0
    };
    let utilization = math::calc_utilization_bps(total_reserved, total_assets);

    if pnl_ratio <= limits.adl_pnl_bps as i128 && utilization <= limits.adl_utilization_bps as i128
    {
        panic_with_error!(env, PositionManagerError::AdlNotTriggered);
    }

    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    let eval = market_tick.evaluate(&pos, pos.size, pos.collateral);

    // Only profitable positions can be ADL'd.
    if eval.pnl <= 0 {
        panic_with_error!(env, PositionManagerError::AdlTargetNotProfitable);
    }

    let pos_size = pos.size;

    execute_close(
        env,
        trader,
        symbol,
        &pos,
        market_tick,
        pos_size,
        pos.collateral,
        &eval,
        &CloseType::Deleverage,
        None,
    );

    events::Adl {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size: pos_size,
        pnl: eval.pnl,
        mark_price,
    }
    .publish(env);
}

// ---------------------------------------------------------------------------
// Execute Order (TP/SL — keeper-initiated, gated on price trigger)
// ---------------------------------------------------------------------------

pub fn do_execute_order(env: &Env, keeper: &Address, trader: &Address, symbol: &Symbol) {
    let market_tick = MarketTick::refresh(env, symbol);
    let mark_price = market_tick.mark_price;

    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    // Anti-front-running: same min lifetime as user-initiated decrease.
    let limits = load_limits(env);
    let now = env.ledger().timestamp();
    if now < pos.last_increased_time + limits.min_position_lifetime {
        panic_with_error!(env, PositionManagerError::PositionNotOldEnough);
    }

    let tp_hit = market_tick.is_tp_triggered(pos.take_profit, pos.is_long);
    let sl_hit = market_tick.is_sl_triggered(pos.stop_loss, pos.is_long);

    if !tp_hit && !sl_hit {
        panic_with_error!(env, PositionManagerError::OrderNotTriggered);
    }

    let eval = market_tick.evaluate(&pos, pos.size, pos.collateral);
    let pos_size = pos.size;

    execute_close(
        env,
        trader,
        symbol,
        &pos,
        market_tick,
        pos_size,
        pos.collateral,
        &eval,
        &CloseType::OrderExecution,
        Some(keeper),
    );

    events::ExecuteOrder {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size: pos_size,
        pnl: eval.pnl,
        mark_price,
        is_tp: tp_hit,
        keeper: keeper.clone(),
    }
    .publish(env);
}

// ---------------------------------------------------------------------------
// Shared close orchestration
// ---------------------------------------------------------------------------

/// Settle a Close's economic effects and finalize the resulting state.
///
/// Money flows: release Vault reservation, route collateral via
/// `pm_to_trader / vault_to_trader / pm_to_vault`, accrue protocol fees, pay
/// the keeper if applicable. State finalization: recompute global avg
/// before decrementing OI, decrement total_reserved, delete-or-update the
/// Position, persist the Market, refresh Unrealized PnL.
///
/// The fee cap fires only when the close is underwater (`trader_payout == 0`).
/// In that branch, distributable fees are clamped to `collateral_delta` so
/// LPs aren't asked to fund keeper/dev fees from their own capital.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute_close(
    env: &Env,
    trader: &Address,
    symbol: &Symbol,
    pos: &Position,
    tick: MarketTick,
    size_delta: i128,
    collateral_delta: i128,
    eval: &PositionEvaluation,
    kind: &CloseType,
    keeper: Option<&Address>,
) {
    let mut market = tick.market;
    let mark_price = tick.mark_price;

    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let contract_addr = env.current_contract_address();
    let asset = get_vault_asset(env, &vault_addr);
    let token = TokenClient::new(env, &asset);

    // ----- Cluster 1: settlement -----

    // Funding-cut comes off the trader's funding accrual when funding is
    // positive (longs paid shorts and the protocol takes its slice).
    let funding_protocol_cut = if eval.funding_fee > 0 {
        let limits = load_limits(env);
        eval.funding_fee * (limits.funding_cut_bps as i128) / math::BPS
    } else {
        0
    };
    let effective_funding = eval.funding_fee - funding_protocol_cut;

    // Recompute health with the cut deducted.
    let health = math::calc_health(collateral_delta, eval.pnl, eval.borrow_fee, effective_funding);
    let trader_payout = if health > 0 { health } else { 0 };

    // Release Vault reservation.
    if size_delta > 0 {
        vault.release_liquidity(&contract_addr, &size_delta);
    }

    // Token routing.
    let pm_to_trader = if trader_payout <= collateral_delta {
        trader_payout
    } else {
        collateral_delta
    };
    let vault_to_trader = trader_payout.saturating_sub(collateral_delta);
    let pm_to_vault = collateral_delta.saturating_sub(trader_payout);

    if vault_to_trader > 0 {
        vault.pay_profit(&contract_addr, trader, &vault_to_trader);
    }
    if pm_to_vault > 0 {
        // Loss path bypasses pay_profit (see ADR-0001).
        token.transfer(&contract_addr, &vault_addr, &pm_to_vault);
        vault.record_absorbed_collateral(&contract_addr, trader, &pm_to_vault);
    }
    if pm_to_trader > 0 {
        token.transfer(&contract_addr, trader, &pm_to_trader);
    }

    // Track the full economic outcome in realized PnL.
    let net_economic_pnl = eval.pnl - eval.borrow_fee + effective_funding;
    let old_realized = storage::get_realized_pnl(env);
    storage::set_realized_pnl(env, old_realized + net_economic_pnl);

    // Distribute fees with the underwater cap. The cap binds only when
    // `trader_payout == 0` because that's when the only inflow funding the
    // keeper/dev share is the absorbed collateral.
    let total_fees = eval.borrow_fee + funding_protocol_cut;
    let distributable_fees = if trader_payout > 0 {
        total_fees
    } else {
        core::cmp::min(total_fees, collateral_delta)
    };
    distribute_fees(env, &vault, distributable_fees, kind, keeper);

    // ----- Cluster 2: state finalization -----

    // Recalculate global avg BEFORE decrementing OI.
    if pos.is_long {
        market.global_long_avg_price = math::remove_from_global_avg_price(
            market.global_long_avg_price,
            market.long_open_interest,
            pos.entry_price,
            size_delta,
        );
        market.long_open_interest -= size_delta;
    } else {
        market.global_short_avg_price = math::remove_from_global_avg_price(
            market.global_short_avg_price,
            market.short_open_interest,
            pos.entry_price,
            size_delta,
        );
        market.short_open_interest -= size_delta;
    }

    // Vault's ReservedUsdc was already decremented by release_liquidity above.

    // Delete or update the Position.
    let is_full_close = size_delta == pos.size;
    if is_full_close {
        storage::delete_position(env, trader, symbol);
    } else {
        let updated = Position {
            collateral: pos.collateral - collateral_delta,
            size: pos.size - size_delta,
            entry_price: pos.entry_price,
            entry_borrow_index: pos.entry_borrow_index,
            entry_funding_index: pos.entry_funding_index,
            is_long: pos.is_long,
            last_increased_time: pos.last_increased_time,
            take_profit: pos.take_profit,
            stop_loss: pos.stop_loss,
        };
        storage::set_position(env, trader, symbol, &updated);
    }

    storage::set_market(env, symbol, &market);

    // Refresh Unrealized PnL after the OI/avg mutations.
    refresh_market_unrealized_pnl(env, symbol, mark_price);
}

// ---------------------------------------------------------------------------
// Fee distribution
// ---------------------------------------------------------------------------

/// Distribute fees according to close kind and FeeSplits config.
///
/// - `keeper_share`: paid directly from vault to keeper (OrderExecution and
///   Liquidation only — UserClose and Deleverage have no keeper reward).
/// - `dev_share`: stays in unclaimed_fees for admin to claim later.
/// - `lp_share`: retained in the LP pool (not accrued to unclaimed_fees).
fn distribute_fees(
    env: &Env,
    vault: &VaultClient,
    total_fees: i128,
    close_type: &CloseType,
    keeper: Option<&Address>,
) {
    if total_fees <= 0 {
        return;
    }

    let fee_splits = load_fee_splits(env);
    let contract_addr = env.current_contract_address();

    let keeper_share = match close_type {
        CloseType::OrderExecution | CloseType::Liquidation => {
            total_fees * (fee_splits.keeper_bps as i128) / math::BPS
        }
        _ => 0,
    };
    let dev_share = total_fees * (fee_splits.dev_bps as i128) / math::BPS;

    // Only accrue non-LP portion to unclaimed_fees.
    let non_lp_fees = keeper_share + dev_share;
    if non_lp_fees > 0 {
        vault.accrue_fees(&contract_addr, &non_lp_fees);
    }

    if keeper_share > 0 {
        if let Some(keeper_addr) = keeper {
            vault.claim_fees_to(&contract_addr, keeper_addr, &keeper_share);
        }
    }
}
