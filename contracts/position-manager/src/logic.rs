// Guards and business logic orchestration.

use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env, Symbol};

use interfaces::{ConfigManagerClient, OracleRouterClient, VaultClient};

use shared::{BorrowRateConfig, FeeSplits, ProtocolLimits};

use crate::errors::PositionManagerError;
use crate::events;
use crate::math;
use crate::storage;
use crate::types::Position;

// ---------------------------------------------------------------------------
// Close type — determines fee distribution
// ---------------------------------------------------------------------------

/// Internal enum (not stored) to control fee distribution per close scenario.
pub enum CloseType {
    /// User-initiated close — no keeper reward.
    UserClose,
    /// TP/SL order executed by a keeper.
    OrderExecution,
    /// Force-liquidation by a keeper.
    Liquidation,
    /// Auto-deleveraging — no keeper reward.
    Deleverage,
}

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

/// Panics with `Unauthorized` (error 7) if `caller` does not have the KEEPER role
/// according to the ConfigManager.
pub fn require_keeper(env: &Env, caller: &Address) {
    let config_mgr = storage::get_config_manager(env);
    shared::require_role(env, caller, &config_mgr, shared::ROLE_KEEPER);
}

/// Panics with `Unauthorized` (error 7) if `caller` does not have the PAUSER role
/// according to the ConfigManager.
pub fn require_pauser(env: &Env, caller: &Address) {
    let config_mgr = storage::get_config_manager(env);
    shared::require_role(env, caller, &config_mgr, shared::ROLE_PAUSER);
}

/// Panics with `Unauthorized` if `caller` does not have the ADMIN role.
pub fn require_admin(env: &Env, caller: &Address) {
    let config_mgr = storage::get_config_manager(env);
    shared::require_role(env, caller, &config_mgr, shared::ROLE_ADMIN);
}

// ---------------------------------------------------------------------------
// ConfigManager helpers
// ---------------------------------------------------------------------------

/// Load protocol limits from ConfigManager via cross-contract call.
fn load_limits(env: &Env) -> ProtocolLimits {
    let config_mgr = storage::get_config_manager(env);
    ConfigManagerClient::new(env, &config_mgr).get_protocol_limits()
}

/// Load borrow rate config from ConfigManager via cross-contract call.
fn load_borrow_rate_config(env: &Env) -> BorrowRateConfig {
    let config_mgr = storage::get_config_manager(env);
    ConfigManagerClient::new(env, &config_mgr).get_borrow_rate_config()
}

/// Load fee splits from ConfigManager via cross-contract call.
fn load_fee_splits(env: &Env) -> FeeSplits {
    let config_mgr = storage::get_config_manager(env);
    ConfigManagerClient::new(env, &config_mgr).get_fee_splits()
}

/// Distribute fees according to close type and FeeSplits config.
///
/// - keeper_share: paid directly from vault to keeper (OrderExecution, Liquidation only)
/// - dev_share: stays in unclaimed_fees for admin to claim later
/// - lp_share: stays in vault pool (not accrued to unclaimed_fees)
///
/// Only `keeper_share + dev_share` is accrued to vault's unclaimed_fees.
/// The keeper is then paid via `claim_fees_to`.
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

    // Only accrue non-LP portion to unclaimed_fees
    let non_lp_fees = keeper_share + dev_share;
    if non_lp_fees > 0 {
        vault.accrue_fees(&contract_addr, &non_lp_fees);
    }

    // Pay keeper directly from accrued fees
    if keeper_share > 0 {
        if let Some(keeper_addr) = keeper {
            vault.claim_fees_to(&contract_addr, keeper_addr, &keeper_share);
        }
    }
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
// update_indices logic
// ---------------------------------------------------------------------------

/// Advance the borrow and funding index accumulators for a given market.
/// No-op if ledger timestamp == last_index_update.
pub fn do_update_indices(env: &Env, symbol: &Symbol) {
    let mut market = storage::get_market(env, symbol);
    let now = env.ledger().timestamp();

    // Clamp effective start to max(last_index_update, last_unpause_time)
    // so fees don't accumulate during pause periods
    let last_unpause = storage::get_last_unpause_time(env);
    let effective_start = if market.last_index_update > last_unpause {
        market.last_index_update
    } else {
        last_unpause
    };
    let time_delta = now.saturating_sub(effective_start);

    if time_delta == 0 {
        return;
    }

    // Load borrow/funding rate config from ConfigManager
    let rate_config = load_borrow_rate_config(env);

    // Borrow rate from utilization
    let total_reserved = storage::get_total_reserved(env);
    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let free_liq = vault.free_liquidity();
    let total_assets = free_liq + total_reserved;
    let util_bps = math::calc_utilization_bps(total_reserved, total_assets);
    let borrow_rate = math::calc_borrow_rate(
        util_bps,
        rate_config.base_borrow_rate_bps,
        rate_config.slope1_bps,
        rate_config.slope2_bps,
        rate_config.optimal_utilization_bps,
    );

    market.acc_borrow_index =
        math::accumulate_borrow_index(market.acc_borrow_index, borrow_rate, time_delta);

    // Funding rate from OI imbalance
    let funding_rate = math::calc_funding_rate(
        market.long_open_interest,
        market.short_open_interest,
        rate_config.base_funding_rate_bps,
    );
    market.acc_funding_index =
        math::accumulate_funding_index(market.acc_funding_index, funding_rate, time_delta);

    market.last_index_update = now;
    storage::set_market(env, symbol, &market);

    events::UpdateIndices {
        symbol: symbol.clone(),
        acc_borrow_index: market.acc_borrow_index,
        acc_funding_index: market.acc_funding_index,
        timestamp: now,
    }
    .publish(env);

    // Refresh unrealized PnL with current oracle price
    let oracle_addr = storage::get_oracle_router(env);
    let oracle = OracleRouterClient::new(env, &oracle_addr);
    let mark_price = oracle.get_price(symbol);
    refresh_market_unrealized_pnl(env, symbol, mark_price);
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
) {
    // Refresh indices so fees are current before any position logic
    do_update_indices(env, symbol);

    // Transfer USDC collateral from trader to PM
    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);

    // Get the vault's underlying asset for token transfers
    let oracle_addr = storage::get_oracle_router(env);
    let oracle = OracleRouterClient::new(env, &oracle_addr);
    let mark_price = oracle.get_price(symbol);

    // Transfer collateral from trader to this contract
    // We need the USDC token address — get it from vault storage
    // For now, use a TokenClient on the vault's asset
    transfer_collateral_in(env, trader, collateral);

    // Load or create position
    let mut market = storage::get_market(env, symbol);
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

    // Check utilization cap BEFORE committing (read from ConfigManager)
    let limits = load_limits(env);
    let old_reserved = storage::get_total_reserved(env);
    let new_reserved = old_reserved + size;
    let free_liq = vault.free_liquidity();
    // total_assets ≈ vault's total deposits = free_liq + old_reserved
    // (free_liq already has old_reserved subtracted by the vault)
    let total_assets = free_liq + old_reserved;
    let util_bps = math::calc_utilization_bps(new_reserved, total_assets);
    if util_bps > limits.max_utilization_ratio {
        panic_with_error!(env, PositionManagerError::UtilizationCapBreached);
    }

    // Reserve liquidity in vault
    let contract_addr = env.current_contract_address();
    vault.reserve_liquidity(&contract_addr, &size);

    // Persist state
    storage::set_total_reserved(env, new_reserved);
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

fn get_vault_asset(env: &Env, vault_addr: &Address) -> Address {
    VaultClient::new(env, vault_addr).query_asset()
}

// ---------------------------------------------------------------------------
// decrease_position logic
// ---------------------------------------------------------------------------

pub fn do_decrease_position(env: &Env, trader: &Address, symbol: &Symbol, size_delta: i128) {
    // Refresh indices so fees are current
    do_update_indices(env, symbol);

    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    // Anti-front-running check (read from ConfigManager)
    let limits = load_limits(env);
    let now = env.ledger().timestamp();
    if now < pos.last_increased_time + limits.min_position_lifetime {
        panic_with_error!(env, PositionManagerError::PositionNotOldEnough);
    }

    // Clamp size_delta to position size
    let actual_delta = if size_delta >= pos.size {
        pos.size
    } else {
        size_delta
    };
    let is_full_close = actual_delta == pos.size;

    // Get mark price from oracle
    let oracle_addr = storage::get_oracle_router(env);
    let oracle = OracleRouterClient::new(env, &oracle_addr);
    let mark_price = oracle.get_price(symbol);

    // Load market
    let mut market = storage::get_market(env, symbol);

    // Proportional collateral
    let collateral_delta = if is_full_close {
        pos.collateral
    } else {
        pos.collateral * actual_delta / pos.size
    };

    // Calculate PnL, fees, health
    let pnl = math::calc_unrealized_pnl(actual_delta, pos.entry_price, mark_price, pos.is_long);
    let borrow_fee = math::calc_borrow_fee(
        actual_delta,
        pos.entry_borrow_index,
        market.acc_borrow_index,
    );
    let funding_fee = math::calc_funding_fee(
        actual_delta,
        pos.entry_funding_index,
        market.acc_funding_index,
        pos.is_long,
    );
    // Settlement (includes PnL tracking + fee distribution + funding cut)
    settle_close(
        env,
        trader,
        actual_delta,
        collateral_delta,
        pnl,
        borrow_fee,
        funding_fee,
        &CloseType::UserClose,
        None,
    );

    events::DecreasePosition {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size_delta: actual_delta,
        pnl,
        borrow_fee,
        funding_fee,
        mark_price,
        is_full_close,
    }
    .publish(env);

    // Recalculate global avg price BEFORE decrementing OI
    if pos.is_long {
        market.global_long_avg_price = math::remove_from_global_avg_price(
            market.global_long_avg_price,
            market.long_open_interest,
            pos.entry_price,
            actual_delta,
        );
        market.long_open_interest -= actual_delta;
    } else {
        market.global_short_avg_price = math::remove_from_global_avg_price(
            market.global_short_avg_price,
            market.short_open_interest,
            pos.entry_price,
            actual_delta,
        );
        market.short_open_interest -= actual_delta;
    }

    // Update total_reserved
    let old_reserved = storage::get_total_reserved(env);
    storage::set_total_reserved(env, old_reserved - actual_delta);

    // Update or delete position
    if is_full_close {
        storage::delete_position(env, trader, symbol);
    } else {
        let updated = Position {
            collateral: pos.collateral - collateral_delta,
            size: pos.size - actual_delta,
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

    // Refresh unrealized PnL after market state change
    refresh_market_unrealized_pnl(env, symbol, mark_price);
}

// ---------------------------------------------------------------------------
// liquidate_position logic
// ---------------------------------------------------------------------------

pub fn do_liquidate_position(env: &Env, caller: &Address, trader: &Address, symbol: &Symbol) {
    // Refresh indices so fees are current
    do_update_indices(env, symbol);

    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    // Get mark price
    let oracle_addr = storage::get_oracle_router(env);
    let oracle = OracleRouterClient::new(env, &oracle_addr);
    let mark_price = oracle.get_price(symbol);

    // Load market
    let mut market = storage::get_market(env, symbol);

    // Compute health
    let pnl = math::calc_unrealized_pnl(pos.size, pos.entry_price, mark_price, pos.is_long);
    let borrow_fee =
        math::calc_borrow_fee(pos.size, pos.entry_borrow_index, market.acc_borrow_index);
    let funding_fee = math::calc_funding_fee(
        pos.size,
        pos.entry_funding_index,
        market.acc_funding_index,
        pos.is_long,
    );
    let health = math::calc_health(pos.collateral, pnl, borrow_fee, funding_fee);

    if health >= 0 {
        panic_with_error!(env, PositionManagerError::HealthFactorOk);
    }

    // Liquidation: seize all collateral, trader gets nothing
    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let contract_addr = env.current_contract_address();

    // Release vault reservation
    vault.release_liquidity(&contract_addr, &pos.size);

    // Send collateral from PM to vault directly (avoid nested auth issue)
    if pos.collateral > 0 {
        let asset = get_vault_asset(env, &vault_addr);
        let token = TokenClient::new(env, &asset);
        token.transfer(&contract_addr, &vault_addr, &pos.collateral);
    }

    // Compute funding protocol cut (consistent with settle_close)
    let funding_protocol_cut = if funding_fee > 0 {
        let limits = load_limits(env);
        funding_fee * (limits.funding_cut_bps as i128) / math::BPS
    } else {
        0
    };
    let effective_funding = funding_fee - funding_protocol_cut;

    // Track the full economic outcome in realized PnL
    let net_economic_pnl = pnl - borrow_fee + effective_funding;
    let old_realized = storage::get_realized_pnl(env);
    storage::set_realized_pnl(env, old_realized + net_economic_pnl);

    // Distribute fees: include funding protocol cut, but cap to collateral
    // (position is underwater, so actual tokens received = collateral)
    let total_fees = borrow_fee + funding_protocol_cut;
    let distributable_fees = core::cmp::min(total_fees, pos.collateral);
    distribute_fees(
        env,
        &vault,
        distributable_fees,
        &CloseType::Liquidation,
        Some(caller),
    );

    events::Liquidate {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size: pos.size,
        collateral: pos.collateral,
        pnl,
        borrow_fee,
        funding_fee,
        mark_price,
        keeper: caller.clone(),
    }
    .publish(env);

    // Recalculate global avg price BEFORE decrementing OI
    if pos.is_long {
        market.global_long_avg_price = math::remove_from_global_avg_price(
            market.global_long_avg_price,
            market.long_open_interest,
            pos.entry_price,
            pos.size,
        );
        market.long_open_interest -= pos.size;
    } else {
        market.global_short_avg_price = math::remove_from_global_avg_price(
            market.global_short_avg_price,
            market.short_open_interest,
            pos.entry_price,
            pos.size,
        );
        market.short_open_interest -= pos.size;
    }

    // Update total_reserved
    let old_reserved = storage::get_total_reserved(env);
    storage::set_total_reserved(env, old_reserved - pos.size);

    // Delete position
    storage::delete_position(env, trader, symbol);
    storage::set_market(env, symbol, &market);

    // Refresh unrealized PnL after market state change
    refresh_market_unrealized_pnl(env, symbol, mark_price);
}

// ---------------------------------------------------------------------------
// deleverage_position (ADL) logic
// ---------------------------------------------------------------------------

pub fn do_deleverage_position(env: &Env, trader: &Address, symbol: &Symbol) {
    // Refresh indices so fees are current
    do_update_indices(env, symbol);

    // Check ADL trigger conditions: PnL-based OR utilization-based
    let total_reserved = storage::get_total_reserved(env);
    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let total_assets = vault.total_assets();

    let limits = load_limits(env);
    let adl_pnl_bps = limits.adl_pnl_bps as i128;
    let adl_util_bps = limits.adl_utilization_bps as i128;

    let combined_pnl = storage::get_realized_pnl(env) + storage::get_total_unrealized_pnl(env);
    let pnl_ratio = if total_assets > 0 && combined_pnl > 0 {
        combined_pnl * math::BPS / total_assets
    } else {
        0
    };
    let utilization = math::calc_utilization_bps(total_reserved, total_assets);

    if pnl_ratio <= adl_pnl_bps && utilization <= adl_util_bps {
        panic_with_error!(env, PositionManagerError::AdlNotTriggered);
    }

    // Load position
    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    // Get mark price
    let oracle_addr = storage::get_oracle_router(env);
    let oracle = OracleRouterClient::new(env, &oracle_addr);
    let mark_price = oracle.get_price(symbol);

    // Load market
    let mut market = storage::get_market(env, symbol);

    // Calculate PnL, fees, health
    let pnl = math::calc_unrealized_pnl(pos.size, pos.entry_price, mark_price, pos.is_long);

    // Guard: only profitable positions can be ADL'd
    if pnl <= 0 {
        panic_with_error!(env, PositionManagerError::AdlTargetNotProfitable);
    }

    let borrow_fee =
        math::calc_borrow_fee(pos.size, pos.entry_borrow_index, market.acc_borrow_index);
    let funding_fee = math::calc_funding_fee(
        pos.size,
        pos.entry_funding_index,
        market.acc_funding_index,
        pos.is_long,
    );
    // Settlement (same as full close, includes PnL tracking + fee distribution + funding cut)
    settle_close(
        env,
        trader,
        pos.size,
        pos.collateral,
        pnl,
        borrow_fee,
        funding_fee,
        &CloseType::Deleverage,
        None,
    );

    events::Adl {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size: pos.size,
        pnl,
        mark_price,
    }
    .publish(env);

    // Recalculate global avg price BEFORE decrementing OI
    if pos.is_long {
        market.global_long_avg_price = math::remove_from_global_avg_price(
            market.global_long_avg_price,
            market.long_open_interest,
            pos.entry_price,
            pos.size,
        );
        market.long_open_interest -= pos.size;
    } else {
        market.global_short_avg_price = math::remove_from_global_avg_price(
            market.global_short_avg_price,
            market.short_open_interest,
            pos.entry_price,
            pos.size,
        );
        market.short_open_interest -= pos.size;
    }

    // Update total_reserved
    let old_reserved = storage::get_total_reserved(env);
    storage::set_total_reserved(env, old_reserved - pos.size);

    // Delete position
    storage::delete_position(env, trader, symbol);
    storage::set_market(env, symbol, &market);

    // Refresh unrealized PnL after market state change
    refresh_market_unrealized_pnl(env, symbol, mark_price);
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

// ---------------------------------------------------------------------------
// execute_order logic
// ---------------------------------------------------------------------------

pub fn do_execute_order(env: &Env, keeper: &Address, trader: &Address, symbol: &Symbol) {
    // Refresh indices so fees are current
    do_update_indices(env, symbol);

    let pos = storage::get_position(env, trader, symbol)
        .unwrap_or_else(|| panic_with_error!(env, PositionManagerError::PositionNotFound));

    // Anti-front-running: enforce same min_position_lifetime as decrease_position
    let limits = load_limits(env);
    let now = env.ledger().timestamp();
    if now < pos.last_increased_time + limits.min_position_lifetime {
        panic_with_error!(env, PositionManagerError::PositionNotOldEnough);
    }

    // Get mark price
    let oracle_addr = storage::get_oracle_router(env);
    let oracle = OracleRouterClient::new(env, &oracle_addr);
    let mark_price = oracle.get_price(symbol);

    // Check if TP or SL is triggered
    let tp_hit = math::is_tp_triggered(pos.take_profit, mark_price, pos.is_long);
    let sl_hit = math::is_sl_triggered(pos.stop_loss, mark_price, pos.is_long);

    if !tp_hit && !sl_hit {
        panic_with_error!(env, PositionManagerError::OrderNotTriggered);
    }

    // Full close — reuse the same logic as do_decrease_position with full size
    let mut market = storage::get_market(env, symbol);

    let pnl = math::calc_unrealized_pnl(pos.size, pos.entry_price, mark_price, pos.is_long);
    let borrow_fee =
        math::calc_borrow_fee(pos.size, pos.entry_borrow_index, market.acc_borrow_index);
    let funding_fee = math::calc_funding_fee(
        pos.size,
        pos.entry_funding_index,
        market.acc_funding_index,
        pos.is_long,
    );
    settle_close(
        env,
        trader,
        pos.size,
        pos.collateral,
        pnl,
        borrow_fee,
        funding_fee,
        &CloseType::OrderExecution,
        Some(keeper),
    );

    events::ExecuteOrder {
        trader: trader.clone(),
        symbol: symbol.clone(),
        size: pos.size,
        pnl,
        mark_price,
        is_tp: tp_hit,
        keeper: keeper.clone(),
    }
    .publish(env);

    // Recalculate global avg price BEFORE decrementing OI
    if pos.is_long {
        market.global_long_avg_price = math::remove_from_global_avg_price(
            market.global_long_avg_price,
            market.long_open_interest,
            pos.entry_price,
            pos.size,
        );
        market.long_open_interest -= pos.size;
    } else {
        market.global_short_avg_price = math::remove_from_global_avg_price(
            market.global_short_avg_price,
            market.short_open_interest,
            pos.entry_price,
            pos.size,
        );
        market.short_open_interest -= pos.size;
    }

    // Update total_reserved
    let old_reserved = storage::get_total_reserved(env);
    storage::set_total_reserved(env, old_reserved - pos.size);

    // Delete position
    storage::delete_position(env, trader, symbol);
    storage::set_market(env, symbol, &market);

    // Refresh unrealized PnL after market state change
    refresh_market_unrealized_pnl(env, symbol, mark_price);
}

// ---------------------------------------------------------------------------
// Shared settlement helper
// ---------------------------------------------------------------------------

/// Settle a position close: release vault reservation, handle profit/loss transfers,
/// update net global trader PnL, accrue borrow fees, and take funding fee protocol cut.
///
/// Computes health and trader payout internally so that the funding protocol cut
/// is deducted from the trader's share (not absorbed by LPs).
///
/// - `actual_delta`: size being closed (used for vault release_liquidity)
/// - `collateral_delta`: proportional collateral for the closed portion
/// - `pnl`: unrealized PnL for the closed portion
/// - `borrow_fee`: borrow fee for the closed portion (accrued to vault)
/// - `funding_fee`: funding fee for the closed portion (protocol takes a cut when positive)
#[allow(clippy::too_many_arguments)]
fn settle_close(
    env: &Env,
    trader: &Address,
    actual_delta: i128,
    collateral_delta: i128,
    pnl: i128,
    borrow_fee: i128,
    funding_fee: i128,
    close_type: &CloseType,
    keeper: Option<&Address>,
) {
    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let contract_addr = env.current_contract_address();
    let asset = get_vault_asset(env, &vault_addr);
    let token = TokenClient::new(env, &asset);

    // Compute funding fee protocol cut BEFORE health so the trader bears the cost
    let funding_protocol_cut = if funding_fee > 0 {
        let limits = load_limits(env);
        funding_fee * (limits.funding_cut_bps as i128) / math::BPS
    } else {
        0
    };
    let effective_funding = funding_fee - funding_protocol_cut;

    // Health with protocol cut deducted from funding
    let health = math::calc_health(collateral_delta, pnl, borrow_fee, effective_funding);
    let trader_payout = if health > 0 { health } else { 0 };

    // Release vault reservation
    if actual_delta > 0 {
        vault.release_liquidity(&contract_addr, &actual_delta);
    }

    // PM holds collateral_delta. Trader is owed trader_payout.
    let pm_to_trader = if trader_payout <= collateral_delta {
        trader_payout
    } else {
        collateral_delta
    };
    let vault_to_trader = trader_payout.saturating_sub(collateral_delta);
    let pm_to_vault = collateral_delta.saturating_sub(trader_payout);

    // Vault pays profit to trader
    if vault_to_trader > 0 {
        vault.settle_pnl(&contract_addr, trader, &vault_to_trader, &0_i128, &true);
    }

    // PM sends loss portion to vault directly (avoid nested auth issue with settle_pnl)
    if pm_to_vault > 0 {
        token.transfer(&contract_addr, &vault_addr, &pm_to_vault);
    }

    // PM sends remaining collateral to trader
    if pm_to_trader > 0 {
        token.transfer(&contract_addr, trader, &pm_to_trader);
    }

    // Track the full economic outcome in realized PnL
    let net_economic_pnl = pnl - borrow_fee + effective_funding;
    let old_realized = storage::get_realized_pnl(env);
    storage::set_realized_pnl(env, old_realized + net_economic_pnl);

    // Distribute fees according to close type and FeeSplits config
    let total_fees = borrow_fee + funding_protocol_cut;
    distribute_fees(env, &vault, total_fees, close_type, keeper);
}
