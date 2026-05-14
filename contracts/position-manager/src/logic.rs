// Guards and business logic orchestration.

use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env, Symbol};

use interfaces::{ConfigManagerClient, VaultClient};

use shared::{FeeSplits, ProtocolLimits};

use crate::errors::PositionManagerError;
use crate::events;
use crate::math;
use crate::storage;
use crate::tick::MarketTick;
use crate::types::Position;

// ---------------------------------------------------------------------------
// Initialization guards
// ---------------------------------------------------------------------------

/// Panics with `NotInitialized` (error 2) if the contract has not been initialized.
pub fn require_initialized(env: &Env) {
    if !storage::is_initialized(env) {
        panic_with_error!(env, PositionManagerError::NotInitialized);
    }
}

/// Panics with `AlreadyInitialized` (error 1) if the contract has already been initialized.
pub fn require_not_initialized(env: &Env) {
    if storage::is_initialized(env) {
        panic_with_error!(env, PositionManagerError::AlreadyInitialized);
    }
}

// ---------------------------------------------------------------------------
// Pause guard
// ---------------------------------------------------------------------------

/// Panics with `Paused` (error 3) if the contract is currently paused.
pub fn require_not_paused(env: &Env) {
    if storage::get_paused(env) {
        panic_with_error!(env, PositionManagerError::Paused);
    }
}

// ---------------------------------------------------------------------------
// Role guards (via ConfigManager cross-contract call)
// ---------------------------------------------------------------------------

/// Cross-contract role check + per-contract panic. Panics with
/// `PositionManagerError::Unauthorized` (code 7) on failure so the panic
/// code identifies the source contract.
fn require_role_or_panic(env: &Env, caller: &Address, role: &str) {
    caller.require_auth();
    let config_mgr = storage::get_config_manager(env);
    if !shared::has_role(env, &config_mgr, role, caller) {
        panic_with_error!(env, PositionManagerError::Unauthorized);
    }
}

/// Panics with `Unauthorized` (error 7) if `caller` does not have the KEEPER role.
pub fn require_keeper(env: &Env, caller: &Address) {
    require_role_or_panic(env, caller, shared::constants::ROLE_KEEPER);
}

/// Panics with `Unauthorized` (error 7) if `caller` does not have the PAUSER role.
pub fn require_pauser(env: &Env, caller: &Address) {
    require_role_or_panic(env, caller, shared::constants::ROLE_PAUSER);
}

/// Panics with `Unauthorized` (error 7) if `caller` does not have the ADMIN role.
pub fn require_admin(env: &Env, caller: &Address) {
    require_role_or_panic(env, caller, shared::constants::ROLE_ADMIN);
}

/// Panics with `Unauthorized` (error 7) if `caller` does not have the UPGRADER role.
pub fn require_upgrader(env: &Env, caller: &Address) {
    require_role_or_panic(env, caller, shared::constants::ROLE_UPGRADER);
}

// ---------------------------------------------------------------------------
// ConfigManager helpers
// ---------------------------------------------------------------------------

/// Load protocol limits from ConfigManager via cross-contract call.
pub(crate) fn load_limits(env: &Env) -> ProtocolLimits {
    let config_mgr = storage::get_config_manager(env);
    ConfigManagerClient::new(env, &config_mgr).get_protocol_limits()
}

/// Load fee splits from ConfigManager via cross-contract call.
pub(crate) fn load_fee_splits(env: &Env) -> FeeSplits {
    let config_mgr = storage::get_config_manager(env);
    ConfigManagerClient::new(env, &config_mgr).get_fee_splits()
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

pub fn require_positive(env: &Env, value: i128) {
    if value <= 0 {
        panic_with_error!(env, PositionManagerError::ZeroAmount);
    }
}

// ---------------------------------------------------------------------------
// Unrealized PnL refresh
// ---------------------------------------------------------------------------

/// Recompute a market's unrealized PnL from its current OI/avg prices and the
/// given mark price.  Updates the per-market cache, the global total, and
/// syncs the combined (realized + unrealized) PnL to the Vault.
pub fn refresh_market_unrealized_pnl(env: &Env, symbol: &Symbol, mark_price: i128) {
    let market = storage::get_market(env, symbol);
    let new_market_pnl = math::calc_market_unrealized_pnl(
        market.long_open_interest,
        market.global_long_avg_price,
        market.short_open_interest,
        market.global_short_avg_price,
        mark_price,
    );

    let old_market_pnl = storage::get_market_unrealized_pnl(env, symbol);
    let delta = new_market_pnl - old_market_pnl;

    storage::set_market_unrealized_pnl(env, symbol, new_market_pnl);
    events::MarketPnlUpdate {
        symbol: symbol.clone(),
        unrealized_pnl: new_market_pnl,
    }
    .publish(env);
    let new_total = storage::get_total_unrealized_pnl(env) + delta;
    storage::set_total_unrealized_pnl(env, new_total);

    // Push combined (realized + unrealized) to vault
    let combined = storage::get_realized_pnl(env) + new_total;
    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let contract_addr = env.current_contract_address();
    vault.update_net_pnl(&contract_addr, &combined);
}

// ---------------------------------------------------------------------------
// increase_position logic
// ---------------------------------------------------------------------------

pub fn do_increase_position(
    env: &Env,
    trader: &Address,
    symbol: &Symbol,
    size: i128,
    collateral: i128,
    is_long: bool,
    take_profit: i128,
    stop_loss: i128,
    acceptable_price: i128,
) {
    // Snapshot vault state once before the mark price is fetched, then
    // refresh indices (the tick uses `view.utilization_bps()` internally for
    // the borrow-rate update, so both refreshes use the same basis).
    let vault_addr = storage::get_vault_address(env);
    let view = crate::vault_view::VaultView::refresh(env, &vault_addr);
    let market_tick = MarketTick::refresh(env, symbol, &view);
    let mark_price = market_tick.mark_price;
    let mut market = market_tick.market;

    // acceptable_price slippage. Passing 0 opts out. For longs the mark must
    // be at-or-below acceptable; for shorts at-or-above.
    if acceptable_price > 0 {
        if is_long && mark_price > acceptable_price {
            panic_with_error!(env, PositionManagerError::SlippageExceeded);
        }
        if !is_long && mark_price < acceptable_price {
            panic_with_error!(env, PositionManagerError::SlippageExceeded);
        }
    }

    let vault = VaultClient::new(env, &vault_addr);

    let existing = storage::get_position(env, trader, symbol);

    // Enforce minimum collateral from protocol limits
    let limits = load_limits(env);
    if collateral < limits.min_collateral {
        panic_with_error!(env, PositionManagerError::BelowMinCollateral);
    }

    let position = match existing {
        Some(mut pos) => {
            // Reject direction flip — must close existing position first
            if is_long != pos.is_long {
                panic_with_error!(env, PositionManagerError::DirectionMismatch);
            }
            // Weighted-average entry price
            pos.entry_price =
                math::update_global_avg_price(pos.entry_price, pos.size, mark_price, size);
            // Weighted-average entry indices so accrued fees reset proportionally
            pos.entry_borrow_index = math::update_global_avg_price(
                pos.entry_borrow_index,
                pos.size,
                market.acc_borrow_index,
                size,
            );
            pos.entry_funding_index = math::update_global_avg_price(
                pos.entry_funding_index,
                pos.size,
                market.acc_funding_index,
                size,
            );
            pos.size += size;
            pos.collateral += collateral;
            pos.last_increased_time = env.ledger().timestamp();
            // Update TP/SL if non-zero values provided
            if take_profit > 0 {
                pos.take_profit = take_profit;
            }
            if stop_loss > 0 {
                pos.stop_loss = stop_loss;
            }
            pos
        }
        None => Position {
            collateral,
            size,
            entry_price: mark_price,
            entry_borrow_index: market.acc_borrow_index,
            entry_funding_index: market.acc_funding_index,
            is_long,
            last_increased_time: env.ledger().timestamp(),
            take_profit,
            stop_loss,
        },
    };

    // Max leverage check (per-market, before any state mutations below)
    let max_leverage = storage::get_max_leverage(env, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::MarketNotConfigured));
    if position.size > position.collateral * max_leverage {
        panic_with_error!(env, PositionManagerError::ExcessiveLeverage);
    }

    // Validate TP/SL against position direction
    validate_tp_sl(env, &position, position.take_profit, position.stop_loss);

    // Update market OI and global avg price
    if is_long {
        market.global_long_avg_price = math::update_global_avg_price(
            market.global_long_avg_price,
            market.long_open_interest,
            mark_price,
            size,
        );
        market.long_open_interest += size;
    } else {
        market.global_short_avg_price = math::update_global_avg_price(
            market.global_short_avg_price,
            market.short_open_interest,
            mark_price,
            size,
        );
        market.short_open_interest += size;
    }

    // Check utilization cap BEFORE committing. Use the snapshot's safe
    // basis — the mark-price-insensitive denominator — so a wicking oracle
    // cannot bias whether opens pass the cap. Computed against the
    // POST-reserve value (`old_reserved + size`) so we never overshoot.
    let limits = load_limits(env);
    let new_reserved = view.reserved + size;
    let util_bps = math::calc_utilization_bps(new_reserved, view.safe_basis);
    if util_bps > limits.max_utilization_ratio {
        panic_with_error!(env, PositionManagerError::UtilizationCapBreached);
    }

    // CEI ordering: every check has now passed. Move collateral from trader
    // to PM AFTER validation so a reverted open never strands the trader's
    // funds in PM.
    transfer_collateral_in(env, trader, collateral);

    // Reserve liquidity in vault — Vault's ReservedUsdc is the single source of truth.
    let contract_addr = env.current_contract_address();
    vault.reserve_liquidity(&contract_addr, &size);

    storage::set_position(env, trader, symbol, &position);
    storage::set_market(env, symbol, &market);

    events::IncreasePosition {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size_delta: size,
        collateral,
        entry_price: position.entry_price,
        is_long,
        tp: position.take_profit,
        sl: position.stop_loss,
        new_total_size: position.size,
        new_total_collateral: position.collateral,
        entry_borrow_index: position.entry_borrow_index,
        entry_funding_index: position.entry_funding_index,
        last_increased_time: position.last_increased_time,
    }
    .publish(env);

    // Refresh unrealized PnL after market state change
    refresh_market_unrealized_pnl(env, symbol, mark_price);
}

/// Transfer USDC collateral from trader to this contract.
/// Gets the asset address from the vault's token interface.
fn transfer_collateral_in(env: &Env, trader: &Address, amount: i128) {
    // We need the USDC token address. The vault stores it, but we don't have
    // a getter for it via the VaultClient. Instead, we'll store the asset address
    // during initialization or read it from the vault.
    // For simplicity, query the vault's asset() method.
    let vault_addr = storage::get_vault_address(env);
    let asset = get_vault_asset(env, &vault_addr);
    let token = TokenClient::new(env, &asset);
    let contract_addr = env.current_contract_address();
    token.transfer(trader, &contract_addr, &amount);
}

pub(crate) fn get_vault_asset(env: &Env, vault_addr: &Address) -> Address {
    VaultClient::new(env, vault_addr).query_asset()
}

// ---------------------------------------------------------------------------
// set_tp_sl logic
// ---------------------------------------------------------------------------

pub fn do_set_tp_sl(
    env: &Env,
    trader: &Address,
    symbol: &Symbol,
    take_profit: i128,
    stop_loss: i128,
) {
    let mut pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    validate_tp_sl(env, &pos, take_profit, stop_loss);

    pos.take_profit = take_profit;
    pos.stop_loss = stop_loss;
    storage::set_position(env, trader, symbol, &pos);

    events::SetTpSl {
        trader: trader.clone(),
        symbol: symbol.clone(),
        take_profit,
        stop_loss,
    }
    .publish(env);
}

/// Validate TP/SL prices against position direction and entry price.
/// - TP for longs must be above entry; TP for shorts must be below entry.
/// - SL for longs must be below entry; SL for shorts must be above entry.
/// - 0 means "not set" and is always valid.
fn validate_tp_sl(env: &Env, pos: &Position, take_profit: i128, stop_loss: i128) {
    // Reject negative prices
    if take_profit < 0 {
        panic_with_error!(env, PositionManagerError::InvalidTpSl);
    }
    if stop_loss < 0 {
        panic_with_error!(env, PositionManagerError::InvalidTpSl);
    }
    if take_profit > 0 {
        if pos.is_long && take_profit <= pos.entry_price {
            panic_with_error!(env, PositionManagerError::InvalidTpSl);
        }
        if !pos.is_long && take_profit >= pos.entry_price {
            panic_with_error!(env, PositionManagerError::InvalidTpSl);
        }
    }
    if stop_loss > 0 {
        if pos.is_long && stop_loss >= pos.entry_price {
            panic_with_error!(env, PositionManagerError::InvalidTpSl);
        }
        if !pos.is_long && stop_loss <= pos.entry_price {
            panic_with_error!(env, PositionManagerError::InvalidTpSl);
        }
    }
}

