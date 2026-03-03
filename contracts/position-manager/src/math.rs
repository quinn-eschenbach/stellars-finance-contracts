// Pure financial calculation functions — no Env dependency.
// All prices scaled by PRECISION (1e7). Index accumulators scaled by INDEX_PRECISION (1e14).

#[allow(dead_code)]
pub const PRECISION: i128 = 10_000_000; // 1e7
pub const INDEX_PRECISION: i128 = 100_000_000_000_000; // 1e14
pub const BPS: i128 = 10_000;
pub const SECONDS_PER_YEAR: u64 = 31_536_000; // 365 days

// V1 borrow rate constants
pub const BASE_BORROW_RATE: i128 = 100; // 1% annualized (in BPS)
pub const SLOPE1: i128 = 500; // 5% slope below optimal
pub const SLOPE2: i128 = 5_000; // 50% slope above optimal
pub const OPTIMAL_UTIL: i128 = 8_000; // 80% optimal utilization

// V1 funding rate constants
pub const BASE_FUNDING_RATE: i128 = 100; // 1% annualized base

pub fn calc_unrealized_pnl(
    size: i128,
    entry_price: i128,
    mark_price: i128,
    is_long: bool,
) -> i128 {
    if entry_price == 0 || size == 0 {
        return 0;
    }
    let price_diff = if is_long {
        mark_price - entry_price
    } else {
        entry_price - mark_price
    };
    size * price_diff / entry_price
}

pub fn calc_borrow_fee(
    size: i128,
    entry_borrow_index: i128,
    current_borrow_index: i128,
) -> i128 {
    (current_borrow_index - entry_borrow_index) * size / INDEX_PRECISION
}

pub fn calc_funding_fee(
    size: i128,
    entry_funding_index: i128,
    current_funding_index: i128,
    is_long: bool,
) -> i128 {
    let delta = current_funding_index - entry_funding_index;
    if is_long {
        -(delta * size / INDEX_PRECISION)
    } else {
        delta * size / INDEX_PRECISION
    }
}

pub fn calc_health(
    collateral: i128,
    unrealized_pnl: i128,
    borrow_fee: i128,
    funding_fee: i128,
) -> i128 {
    collateral + unrealized_pnl - borrow_fee + funding_fee
}

pub fn calc_borrow_rate(utilization_bps: i128) -> i128 {
    if utilization_bps <= OPTIMAL_UTIL {
        BASE_BORROW_RATE + (utilization_bps * SLOPE1 / BPS)
    } else {
        BASE_BORROW_RATE
            + (OPTIMAL_UTIL * SLOPE1 / BPS)
            + ((utilization_bps - OPTIMAL_UTIL) * SLOPE2 / BPS)
    }
}

pub fn calc_funding_rate(long_oi: i128, short_oi: i128) -> i128 {
    let total = long_oi + short_oi;
    if total == 0 {
        return 0;
    }
    // Compute BASE_FUNDING_RATE * (long_oi - short_oi) / total without overflow.
    // When values are small enough, use direct multiplication for full precision.
    // Otherwise, divide first to avoid overflow (small precision loss acceptable).
    let imbalance = long_oi - short_oi;
    match imbalance.checked_mul(BASE_FUNDING_RATE) {
        Some(product) => product / total,
        None => {
            // Overflow path: scale both numerator and denominator down to fit
            let scale = total / BPS;
            if scale == 0 {
                return 0;
            }
            BASE_FUNDING_RATE * (imbalance / scale) / (total / scale)
        }
    }
}

pub fn accumulate_borrow_index(
    current_index: i128,
    rate_bps: i128,
    time_delta: u64,
) -> i128 {
    current_index
        + (rate_bps * INDEX_PRECISION * time_delta as i128)
            / (BPS * SECONDS_PER_YEAR as i128)
}

pub fn accumulate_funding_index(
    current_index: i128,
    rate_bps: i128,
    time_delta: u64,
) -> i128 {
    current_index
        + (rate_bps * INDEX_PRECISION * time_delta as i128)
            / (BPS * SECONDS_PER_YEAR as i128)
}

pub fn update_global_avg_price(
    current_avg: i128,
    current_size: i128,
    new_price: i128,
    new_size: i128,
) -> i128 {
    let total_size = current_size + new_size;
    if total_size == 0 {
        return 0;
    }
    if current_size == 0 {
        return new_price;
    }
    (current_avg * current_size + new_price * new_size) / total_size
}

/// Returns true if the take-profit price is triggered.
/// For longs: mark_price >= take_profit. For shorts: mark_price <= take_profit.
pub fn is_tp_triggered(take_profit: i128, mark_price: i128, is_long: bool) -> bool {
    if take_profit <= 0 {
        return false;
    }
    if is_long {
        mark_price >= take_profit
    } else {
        mark_price <= take_profit
    }
}

/// Returns true if the stop-loss price is triggered.
/// For longs: mark_price <= stop_loss. For shorts: mark_price >= stop_loss.
pub fn is_sl_triggered(stop_loss: i128, mark_price: i128, is_long: bool) -> bool {
    if stop_loss <= 0 {
        return false;
    }
    if is_long {
        mark_price <= stop_loss
    } else {
        mark_price >= stop_loss
    }
}

pub fn calc_utilization_bps(reserved: i128, total_assets: i128) -> i128 {
    if total_assets <= 0 {
        return 0;
    }
    reserved * BPS / total_assets
}
