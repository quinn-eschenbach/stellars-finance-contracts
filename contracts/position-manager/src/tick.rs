// MarketTick — a snapshot of a Market's state immediately after refreshing
// borrow/funding indices. The only way to construct one is `MarketTick::refresh`,
// which pays the cost of the index update and pushes unrealized PnL to the
// Vault. Callers compose fees, PnL, and triggers against the tick's bound
// `mark_price` and indices, so the freshness and direction-sign rules are
// type-enforced rather than convention-enforced.

use soroban_sdk::{Env, Symbol};

use interfaces::{ConfigManagerClient, MarketInfo, OracleRouterClient};
use shared::BorrowRateConfig;

use crate::events;
use crate::math;
use crate::storage;
use crate::types::Position;
use crate::vault_view::VaultView;

pub struct MarketTick {
    pub market: MarketInfo,
    pub mark_price: i128,
}

pub struct PositionEvaluation {
    pub pnl: i128,
    pub borrow_fee: i128,
    /// Raw funding accrual before zero-sum scaling and protocol cut.
    /// Exposed for event payloads only — settlement uses `effective_funding`.
    pub funding_fee: i128,
    /// `funding_fee` after zero-sum scaling (`min(payer_oi, receiver_oi)
    /// / receiver_oi`) and the protocol funding cut. This is what actually
    /// moves between accounts in `execute_close`.
    pub effective_funding: i128,
    /// Protocol slice of positive funding accruals (zero when the position
    /// pays funding). Routed to revenue via `reslice_revenue`.
    pub funding_protocol_cut: i128,
    /// Health derived from `effective_funding`. Liquidation gate and
    /// `execute_close` both read this — keeping gate-side and settlement-side
    /// health on one struct prevents the drift bug where the gate saw a
    /// healthier number than settlement.
    pub effective_health: i128,
}

impl MarketTick {
    /// Refresh borrow/funding indices for `symbol`, persist the updated
    /// Market, fetch the current mark price, push the resulting unrealized
    /// PnL to the Vault, and return the resulting tick.
    ///
    /// `view` supplies the vault state snapshot used for utilization — every
    /// utilization read funnels through `VaultView::utilization_bps()` so
    /// the safe (PnL-excluded) basis is enforced at the type layer rather
    /// than by callsite discipline.
    pub fn refresh(env: &Env, symbol: &Symbol, view: &VaultView) -> Self {
        let mut market = storage::get_market(env, symbol);
        let now = env.ledger().timestamp();

        // Clamp the window so fees don't accumulate during pause periods.
        // Lower bound: `last_index_update` and the post-unpause floor.
        // Upper bound: clamp `now` to `last_pause_time` when currently paused
        // so non-pause-gated entry points (decrease / liquidate / deleverage
        // / execute_order) called during pause don't bill the trader for time
        // after the pause boundary. `_migrate` guarantees `last_pause_time > 0`
        // when `is_paused`, so the conditional is sufficient.
        let last_unpause = storage::get_last_unpause_time(env);
        let effective_start = if market.last_index_update > last_unpause {
            market.last_index_update
        } else {
            last_unpause
        };
        let effective_now = if storage::get_paused(env) {
            let last_pause = storage::get_last_pause_time(env);
            if last_pause > 0 {
                core::cmp::min(now, last_pause)
            } else {
                effective_start
            }
        } else {
            now
        };
        let time_delta = effective_now.saturating_sub(effective_start);

        if time_delta > 0 {
            let rate_config = load_borrow_rate_config(env);
            let util_bps = view.utilization_bps();
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

            // Persist the clamp: if we billed up to `effective_now < now`
            // (paused trade), record that as the index-update timestamp so
            // the next refresh continues from the same boundary rather than
            // re-bridging the gap.
            market.last_index_update = effective_now;
            storage::set_market(env, symbol, &market);

            events::UpdateIndices {
                symbol: symbol.clone(),
                acc_borrow_index: market.acc_borrow_index,
                acc_funding_index: market.acc_funding_index,
                timestamp: effective_now,
            }
            .publish(env);
        }

        // Fetch mark price (independent of whether indices updated).
        let oracle_addr = storage::get_oracle_router(env);
        let oracle = OracleRouterClient::new(env, &oracle_addr);
        let mark_price = oracle.get_price(symbol);

        // PnL refresh is the caller's responsibility — every trade path already
        // calls `refresh_market_unrealized_pnl` at the end of its operation
        // (where OI / avg are at their final state), so doing it here as well
        // would be a redundant `vault.update_net_pnl` cross-contract call and
        // push the close path over the Soroban simulation budget. The keeper
        // `update_indices` path, which has no trailing trade logic, calls
        // `refresh_market_unrealized_pnl` explicitly.
        Self { market, mark_price }
    }

    /// Compute the full settlement view (raw + effective) for a Position
    /// slice of `size` with `collateral` against this tick's indices and mark
    /// price. `funding_fee`'s sign is direction-corrected (longs pay →
    /// negative, shorts receive → positive). The `effective_*` fields apply
    /// the zero-sum funding scaling (so total received ≤ total paid) and the
    /// protocol funding cut — these are the values used by settlement, and
    /// the liquidation gate must compare against `effective_health` rather
    /// than `health`.
    pub fn evaluate(
        &self,
        pos: &Position,
        size: i128,
        collateral: i128,
        funding_cut_bps: u32,
    ) -> PositionEvaluation {
        let pnl = math::calc_unrealized_pnl(size, pos.entry_price, self.mark_price, pos.is_long);
        let borrow_fee =
            math::calc_borrow_fee(size, pos.entry_borrow_index, self.market.acc_borrow_index);
        let funding_fee = math::calc_funding_fee(
            size,
            pos.entry_funding_index,
            self.market.acc_funding_index,
            pos.is_long,
        );

        // Zero-sum funding: when this position is on the receiver side and
        // payer-side OI is smaller, scale the funding accrual so total
        // received cannot exceed total paid. Funding payers (funding_fee < 0)
        // and zero-OI receivers pass through unchanged.
        let zero_sum_funding = if funding_fee > 0 {
            let (payer_oi, receiver_oi) = if pos.is_long {
                (self.market.short_open_interest, self.market.long_open_interest)
            } else {
                (self.market.long_open_interest, self.market.short_open_interest)
            };
            if receiver_oi <= 0 {
                0
            } else if payer_oi >= receiver_oi {
                funding_fee
            } else {
                funding_fee * payer_oi / receiver_oi
            }
        } else {
            funding_fee
        };

        let funding_protocol_cut = if zero_sum_funding > 0 {
            zero_sum_funding * (funding_cut_bps as i128) / shared::constants::BPS
        } else {
            0
        };
        let effective_funding = zero_sum_funding - funding_protocol_cut;
        let effective_health =
            math::calc_health(collateral, pnl, borrow_fee, effective_funding);

        PositionEvaluation {
            pnl,
            borrow_fee,
            funding_fee,
            effective_funding,
            funding_protocol_cut,
            effective_health,
        }
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
