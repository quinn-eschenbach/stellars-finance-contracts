// MarketTick — a snapshot of a Market's state immediately after refreshing
// borrow/funding indices. The only way to construct one is `MarketTick::refresh`,
// which pays the cost of the index update and pushes unrealized PnL to the
// Vault. Callers compose fees, PnL, and triggers against the tick's bound
// `mark_price` and indices, so the freshness and direction-sign rules are
// type-enforced rather than convention-enforced.

use soroban_sdk::{Env, Symbol};

use interfaces::{ConfigManagerClient, MarketInfo, OracleRouterClient, VaultClient};
use shared::BorrowRateConfig;

use crate::events;
use crate::math;
use crate::storage;
use crate::types::Position;

pub struct MarketTick {
    pub market: MarketInfo,
    pub mark_price: i128,
}

pub struct PositionEvaluation {
    pub pnl: i128,
    pub borrow_fee: i128,
    pub funding_fee: i128,
    pub health: i128,
}

impl MarketTick {
    /// Refresh borrow/funding indices for `symbol`, persist the updated
    /// Market, fetch the current mark price, push the resulting unrealized
    /// PnL to the Vault, and return the resulting tick.
    pub fn refresh(env: &Env, symbol: &Symbol) -> Self {
        let mut market = storage::get_market(env, symbol);
        let now = env.ledger().timestamp();

        // Clamp effective start to max(last_index_update, last_unpause_time)
        // so fees don't accumulate during pause periods.
        let last_unpause = storage::get_last_unpause_time(env);
        let effective_start = if market.last_index_update > last_unpause {
            market.last_index_update
        } else {
            last_unpause
        };
        let time_delta = now.saturating_sub(effective_start);

        if time_delta > 0 {
            let rate_config = load_borrow_rate_config(env);
            let vault_addr = storage::get_vault_address(env);
            let vault = VaultClient::new(env, &vault_addr);
            let total_reserved = vault.reserved_usdc();
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
        }

        // Fetch mark price (independent of whether indices updated).
        let oracle_addr = storage::get_oracle_router(env);
        let oracle = OracleRouterClient::new(env, &oracle_addr);
        let mark_price = oracle.get_price(symbol);

        // Refresh market unrealized PnL and push combined PnL to vault.
        crate::logic::refresh_market_unrealized_pnl(env, symbol, mark_price);

        Self { market, mark_price }
    }

    /// Compute `(pnl, borrow_fee, funding_fee, health)` for a Position slice
    /// of `size` with `collateral` against this tick's indices and mark price.
    /// `funding_fee`'s sign is direction-corrected (longs pay → negative,
    /// shorts receive → positive); `health` uses the corrected value.
    pub fn evaluate(&self, pos: &Position, size: i128, collateral: i128) -> PositionEvaluation {
        let pnl = math::calc_unrealized_pnl(size, pos.entry_price, self.mark_price, pos.is_long);
        let borrow_fee =
            math::calc_borrow_fee(size, pos.entry_borrow_index, self.market.acc_borrow_index);
        let funding_fee = math::calc_funding_fee(
            size,
            pos.entry_funding_index,
            self.market.acc_funding_index,
            pos.is_long,
        );
        let health = math::calc_health(collateral, pnl, borrow_fee, funding_fee);
        PositionEvaluation { pnl, borrow_fee, funding_fee, health }
    }

    /// True if `take_profit` has been crossed by this tick's mark price.
    pub fn is_tp_triggered(&self, take_profit: i128, is_long: bool) -> bool {
        math::is_tp_triggered(take_profit, self.mark_price, is_long)
    }

    /// True if `stop_loss` has been crossed by this tick's mark price.
    pub fn is_sl_triggered(&self, stop_loss: i128, is_long: bool) -> bool {
        math::is_sl_triggered(stop_loss, self.mark_price, is_long)
    }
}

fn load_borrow_rate_config(env: &Env) -> BorrowRateConfig {
    let config_mgr = storage::get_config_manager(env);
    ConfigManagerClient::new(env, &config_mgr).get_borrow_rate_config()
}
