// Comprehensive tests for the position-manager math module.
// All functions under test are pure (no Env dependency).
// These tests are written BEFORE implementation and should ALL FAIL initially.

use crate::math;

// Default borrow/funding rate constants used in tests (previously hardcoded in math.rs).
const BASE_BORROW_RATE: i128 = 100;
const SLOPE1: i128 = 500;
const SLOPE2: i128 = 5_000;
const OPTIMAL_UTIL: i128 = 8_000;
const BASE_FUNDING_RATE: i128 = 100;

// ========================================================================
// 1. calc_unrealized_pnl
// ========================================================================

#[test]
fn test_unrealized_pnl_long_profit() {
    // BTC long: size=$100k, entry=50k, mark=55k => PnL = +$10k
    let pnl = math::calc_unrealized_pnl(
        100_000 * math::PRECISION,
        50_000 * math::PRECISION,
        55_000 * math::PRECISION,
        true,
    );
    assert_eq!(pnl, 10_000 * math::PRECISION);
}

#[test]
fn test_unrealized_pnl_long_loss() {
    // BTC long: size=$100k, entry=50k, mark=45k => PnL = -$10k
    let pnl = math::calc_unrealized_pnl(
        100_000 * math::PRECISION,
        50_000 * math::PRECISION,
        45_000 * math::PRECISION,
        true,
    );
    assert_eq!(pnl, -10_000 * math::PRECISION);
}

#[test]
fn test_unrealized_pnl_short_profit() {
    // BTC short: size=$100k, entry=50k, mark=45k => PnL = +$10k
    let pnl = math::calc_unrealized_pnl(
        100_000 * math::PRECISION,
        50_000 * math::PRECISION,
        45_000 * math::PRECISION,
        false,
    );
    assert_eq!(pnl, 10_000 * math::PRECISION);
}

#[test]
fn test_unrealized_pnl_short_loss() {
    // BTC short: size=$100k, entry=50k, mark=55k => PnL = -$10k
    let pnl = math::calc_unrealized_pnl(
        100_000 * math::PRECISION,
        50_000 * math::PRECISION,
        55_000 * math::PRECISION,
        false,
    );
    assert_eq!(pnl, -10_000 * math::PRECISION);
}

#[test]
fn test_unrealized_pnl_zero_price_move() {
    // No price movement => PnL = 0
    let pnl = math::calc_unrealized_pnl(
        100_000 * math::PRECISION,
        50_000 * math::PRECISION,
        50_000 * math::PRECISION,
        true,
    );
    assert_eq!(pnl, 0);
}

#[test]
fn test_unrealized_pnl_zero_size() {
    // Zero size => PnL = 0 regardless of price move
    let pnl = math::calc_unrealized_pnl(
        0,
        50_000 * math::PRECISION,
        55_000 * math::PRECISION,
        true,
    );
    assert_eq!(pnl, 0);
}

#[test]
fn test_unrealized_pnl_large_values_no_overflow() {
    // Whale position: size=$500M at BTC=$100k, mark=$100.5k (0.5% move)
    // PnL = 500_000_000e7 * (100_500e7 - 100_000e7) / 100_000e7 = 2_500_000e7
    let pnl = math::calc_unrealized_pnl(
        500_000_000 * math::PRECISION,
        100_000 * math::PRECISION,
        100_500 * math::PRECISION,
        true,
    );
    assert_eq!(pnl, 2_500_000 * math::PRECISION);
}

#[test]
fn test_unrealized_pnl_fractional_precision() {
    // Small position: size=$10, entry=$1.50, mark=$1.55
    // PnL = 10e7 * (1.55e7 - 1.50e7) / 1.50e7
    //      = 100_000_000 * 500_000 / 15_000_000 = 3_333_333 (truncated)
    let pnl = math::calc_unrealized_pnl(
        10 * math::PRECISION,  // $10
        15_000_000,            // $1.50
        15_500_000,            // $1.55
        true,
    );
    assert_eq!(pnl, 3_333_333); // ~$0.3333333 profit
}

// ========================================================================
// 2. calc_borrow_fee
// ========================================================================

#[test]
fn test_borrow_fee_basic() {
    // Size=$100k, index went from 1e14 to 1.001e14 (0.1% accrued)
    // Fee = (1.001e14 - 1e14) * 100_000e7 / 1e14
    //     = 1e11 * 1e12 / 1e14 = 1e9 = 100e7 => $100
    let fee = math::calc_borrow_fee(
        100_000 * math::PRECISION,
        math::INDEX_PRECISION,
        math::INDEX_PRECISION + math::INDEX_PRECISION / 1000,
    );
    assert_eq!(fee, 100 * math::PRECISION);
}

#[test]
fn test_borrow_fee_zero_when_indices_equal() {
    let fee = math::calc_borrow_fee(
        100_000 * math::PRECISION,
        math::INDEX_PRECISION,
        math::INDEX_PRECISION,
    );
    assert_eq!(fee, 0);
}

#[test]
fn test_borrow_fee_zero_size() {
    let fee = math::calc_borrow_fee(
        0,
        math::INDEX_PRECISION,
        math::INDEX_PRECISION * 2,
    );
    assert_eq!(fee, 0);
}

// ========================================================================
// 3. calc_funding_fee
// ========================================================================

#[test]
fn test_funding_fee_long_pays_when_delta_positive() {
    // Positive delta means longs pay. Long fee = -(delta * size / INDEX_PRECISION)
    // delta = 0.001 * INDEX_PRECISION, size = $100k
    // fee = -(1e11 * 1e12 / 1e14) = -1e9 = -100e7 => trader pays $100
    let fee = math::calc_funding_fee(
        100_000 * math::PRECISION,
        math::INDEX_PRECISION,
        math::INDEX_PRECISION + math::INDEX_PRECISION / 1000,
        true, // long
    );
    assert_eq!(fee, -(100 * math::PRECISION));
}

#[test]
fn test_funding_fee_short_receives_when_delta_positive() {
    // Positive delta means shorts receive. Short fee = delta * size / INDEX_PRECISION
    let fee = math::calc_funding_fee(
        100_000 * math::PRECISION,
        math::INDEX_PRECISION,
        math::INDEX_PRECISION + math::INDEX_PRECISION / 1000,
        false, // short
    );
    assert_eq!(fee, 100 * math::PRECISION);
}

#[test]
fn test_funding_fee_long_receives_when_delta_negative() {
    // Negative delta => longs receive
    let fee = math::calc_funding_fee(
        100_000 * math::PRECISION,
        math::INDEX_PRECISION + math::INDEX_PRECISION / 1000,
        math::INDEX_PRECISION,
        true,
    );
    assert_eq!(fee, 100 * math::PRECISION);
}

#[test]
fn test_funding_fee_zero_delta() {
    let fee = math::calc_funding_fee(
        100_000 * math::PRECISION,
        math::INDEX_PRECISION,
        math::INDEX_PRECISION,
        true,
    );
    assert_eq!(fee, 0);
}

// ========================================================================
// 4. calc_health
// ========================================================================

#[test]
fn test_health_all_positive() {
    // collateral=$1000, pnl=+$200, borrow_fee=$50, funding_fee=+$30 (receiving)
    // health = 1000 + 200 - 50 + 30 = 1180
    let h = math::calc_health(
        1000 * math::PRECISION,
        200 * math::PRECISION,
        50 * math::PRECISION,
        30 * math::PRECISION,
    );
    assert_eq!(h, 1180 * math::PRECISION);
}

#[test]
fn test_health_negative_pnl_and_funding() {
    // collateral=$1000, pnl=-$800, borrow_fee=$100, funding_fee=-$50 (paying)
    // health = 1000 + (-800) - 100 + (-50) = 50
    let h = math::calc_health(
        1000 * math::PRECISION,
        -800 * math::PRECISION,
        100 * math::PRECISION,
        -50 * math::PRECISION,
    );
    assert_eq!(h, 50 * math::PRECISION);
}

#[test]
fn test_health_goes_negative_liquidatable() {
    // collateral=$100, pnl=-$80, borrow_fee=$30, funding_fee=-$10
    // health = 100 - 80 - 30 - 10 = -20 (underwater)
    let h = math::calc_health(
        100 * math::PRECISION,
        -80 * math::PRECISION,
        30 * math::PRECISION,
        -10 * math::PRECISION,
    );
    assert_eq!(h, -20 * math::PRECISION);
}

#[test]
fn test_health_zero_collateral() {
    let h = math::calc_health(0, 0, 0, 0);
    assert_eq!(h, 0);
}

// ========================================================================
// 5. calc_borrow_rate (kink model)
// ========================================================================

#[test]
fn test_borrow_rate_zero_utilization() {
    // U=0: rate = BASE = 100 BPS = 1%
    let rate = math::calc_borrow_rate(0, BASE_BORROW_RATE, SLOPE1, SLOPE2, OPTIMAL_UTIL);
    assert_eq!(rate, BASE_BORROW_RATE);
}

#[test]
fn test_borrow_rate_at_optimal() {
    // U=8000 (80%): rate = 100 + (8000 * 500 / 10000) = 100 + 400 = 500 BPS = 5%
    let rate = math::calc_borrow_rate(OPTIMAL_UTIL, BASE_BORROW_RATE, SLOPE1, SLOPE2, OPTIMAL_UTIL);
    assert_eq!(rate, 500);
}

#[test]
fn test_borrow_rate_below_optimal() {
    // U=4000 (40%): rate = 100 + (4000 * 500 / 10000) = 100 + 200 = 300 BPS
    let rate = math::calc_borrow_rate(4000, BASE_BORROW_RATE, SLOPE1, SLOPE2, OPTIMAL_UTIL);
    assert_eq!(rate, 300);
}

#[test]
fn test_borrow_rate_above_optimal() {
    // U=9000 (90%): rate = 100 + 400 + ((9000-8000)*5000/10000) = 500 + 500 = 1000 BPS = 10%
    let rate = math::calc_borrow_rate(9000, BASE_BORROW_RATE, SLOPE1, SLOPE2, OPTIMAL_UTIL);
    assert_eq!(rate, 1000);
}

#[test]
fn test_borrow_rate_full_utilization() {
    // U=10000 (100%): rate = 100 + 400 + ((10000-8000)*5000/10000) = 500 + 1000 = 1500 BPS = 15%
    let rate = math::calc_borrow_rate(math::BPS, BASE_BORROW_RATE, SLOPE1, SLOPE2, OPTIMAL_UTIL);
    assert_eq!(rate, 1500);
}

// ========================================================================
// 6. calc_funding_rate
// ========================================================================

#[test]
fn test_funding_rate_balanced() {
    // Equal OI => rate = 0
    let rate = math::calc_funding_rate(
        1_000_000 * math::PRECISION,
        1_000_000 * math::PRECISION,
        BASE_FUNDING_RATE,
    );
    assert_eq!(rate, 0);
}

#[test]
fn test_funding_rate_longs_dominant() {
    // long=150k, short=50k => rate = 100 * (150k-50k)/(150k+50k) = 100*100k/200k = 50
    let rate = math::calc_funding_rate(
        150_000 * math::PRECISION,
        50_000 * math::PRECISION,
        BASE_FUNDING_RATE,
    );
    assert_eq!(rate, 50); // 0.5% annualized, longs pay
}

#[test]
fn test_funding_rate_shorts_dominant() {
    // long=50k, short=150k => rate = 100 * (50k-150k)/(50k+150k) = -50
    let rate = math::calc_funding_rate(
        50_000 * math::PRECISION,
        150_000 * math::PRECISION,
        BASE_FUNDING_RATE,
    );
    assert_eq!(rate, -50); // shorts pay
}

#[test]
fn test_funding_rate_zero_oi() {
    // No open interest => rate = 0 (no division by zero)
    let rate = math::calc_funding_rate(0, 0, BASE_FUNDING_RATE);
    assert_eq!(rate, 0);
}

#[test]
fn test_funding_rate_one_sided_all_longs() {
    // All longs, zero shorts => rate = 100 * long / long = 100
    let rate = math::calc_funding_rate(100_000 * math::PRECISION, 0, BASE_FUNDING_RATE);
    assert_eq!(rate, BASE_FUNDING_RATE);
}

#[test]
fn test_funding_rate_one_sided_all_shorts() {
    // All shorts, zero longs => rate = 100 * (-short) / short = -100
    let rate = math::calc_funding_rate(0, 100_000 * math::PRECISION, BASE_FUNDING_RATE);
    assert_eq!(rate, -(BASE_FUNDING_RATE));
}

// ========================================================================
// 7. accumulate_borrow_index
// ========================================================================

#[test]
fn test_accumulate_borrow_index_one_hour() {
    // rate=500 BPS (5%), time=3600s (1 hour)
    let new_idx = math::accumulate_borrow_index(
        math::INDEX_PRECISION,
        500,
        3600,
    );
    let expected_delta: i128 =
        500 * math::INDEX_PRECISION * 3600 / (math::BPS * math::SECONDS_PER_YEAR as i128);
    assert_eq!(new_idx, math::INDEX_PRECISION + expected_delta);
}

#[test]
fn test_accumulate_borrow_index_zero_time() {
    let new_idx = math::accumulate_borrow_index(math::INDEX_PRECISION, 500, 0);
    assert_eq!(new_idx, math::INDEX_PRECISION);
}

#[test]
fn test_accumulate_borrow_index_zero_rate() {
    let new_idx = math::accumulate_borrow_index(math::INDEX_PRECISION, 0, 3600);
    assert_eq!(new_idx, math::INDEX_PRECISION);
}

#[test]
fn test_accumulate_borrow_index_full_year() {
    // rate=100 BPS (1%), time=1 year
    // delta = 100 * INDEX_PRECISION * SECONDS_PER_YEAR / (BPS * SECONDS_PER_YEAR)
    //       = 100 * INDEX_PRECISION / BPS = INDEX_PRECISION / 100
    let new_idx = math::accumulate_borrow_index(
        math::INDEX_PRECISION,
        100,
        math::SECONDS_PER_YEAR,
    );
    let expected_delta: i128 = math::INDEX_PRECISION / 100; // 1% of index
    assert_eq!(new_idx, math::INDEX_PRECISION + expected_delta);
}

// ========================================================================
// 8. accumulate_funding_index
// ========================================================================

#[test]
fn test_accumulate_funding_index_positive_rate() {
    let new_idx = math::accumulate_funding_index(math::INDEX_PRECISION, 50, 3600);
    let expected_delta: i128 =
        50 * math::INDEX_PRECISION * 3600 / (math::BPS * math::SECONDS_PER_YEAR as i128);
    assert_eq!(new_idx, math::INDEX_PRECISION + expected_delta);
}

#[test]
fn test_accumulate_funding_index_negative_rate() {
    // Negative rate => index decreases
    let new_idx = math::accumulate_funding_index(math::INDEX_PRECISION, -50, 3600);
    let expected_delta: i128 =
        -50 * math::INDEX_PRECISION * 3600 / (math::BPS * math::SECONDS_PER_YEAR as i128);
    assert_eq!(new_idx, math::INDEX_PRECISION + expected_delta);
    assert!(
        new_idx < math::INDEX_PRECISION,
        "Negative rate must decrease the index"
    );
}

// ========================================================================
// 9. update_global_avg_price
// ========================================================================

#[test]
fn test_avg_price_first_position() {
    // No existing size => avg = new_price
    let avg = math::update_global_avg_price(
        0,
        0,
        50_000 * math::PRECISION,
        10_000 * math::PRECISION,
    );
    assert_eq!(avg, 50_000 * math::PRECISION);
}

#[test]
fn test_avg_price_weighted() {
    // Existing: avg=$50k, size=$100k. New: price=$60k, size=$50k
    // new_avg = (50k*100k + 60k*50k) / (100k+50k) = 8e9/150k = ~53333.33
    let avg = math::update_global_avg_price(
        50_000 * math::PRECISION,
        100_000 * math::PRECISION,
        60_000 * math::PRECISION,
        50_000 * math::PRECISION,
    );
    let expected = (50_000 * math::PRECISION * 100_000 * math::PRECISION
        + 60_000 * math::PRECISION * 50_000 * math::PRECISION)
        / (150_000 * math::PRECISION);
    assert_eq!(avg, expected);
}

#[test]
fn test_avg_price_both_sizes_zero() {
    let avg = math::update_global_avg_price(
        50_000 * math::PRECISION,
        0,
        60_000 * math::PRECISION,
        0,
    );
    assert_eq!(avg, 0);
}

// ========================================================================
// 10. calc_utilization_bps
// ========================================================================

#[test]
fn test_utilization_basic() {
    // reserved=$800k, total=$1M => 8000 BPS = 80%
    let u = math::calc_utilization_bps(
        800_000 * math::PRECISION,
        1_000_000 * math::PRECISION,
    );
    assert_eq!(u, 8000);
}

#[test]
fn test_utilization_zero_assets() {
    let u = math::calc_utilization_bps(100 * math::PRECISION, 0);
    assert_eq!(u, 0);
}

#[test]
fn test_utilization_negative_assets() {
    let u = math::calc_utilization_bps(100 * math::PRECISION, -1);
    assert_eq!(u, 0);
}

#[test]
fn test_utilization_full() {
    // reserved == total => 10000 BPS = 100%
    let u = math::calc_utilization_bps(
        1_000_000 * math::PRECISION,
        1_000_000 * math::PRECISION,
    );
    assert_eq!(u, math::BPS);
}

#[test]
fn test_utilization_zero_reserved() {
    let u = math::calc_utilization_bps(0, 1_000_000 * math::PRECISION);
    assert_eq!(u, 0);
}

// ========================================================================
// Adversarial / edge-case scenarios
// ========================================================================

#[test]
fn test_pnl_short_price_doubles_max_loss() {
    // Short at $50k, price goes to $100k => PnL = size * (50k-100k)/50k = -size
    let pnl = math::calc_unrealized_pnl(
        100_000 * math::PRECISION,
        50_000 * math::PRECISION,
        100_000 * math::PRECISION,
        false,
    );
    assert_eq!(pnl, -100_000 * math::PRECISION);
}

#[test]
fn test_pnl_long_price_goes_to_near_zero() {
    // Long at $50k, price crashes to $1 => nearly total loss
    let pnl = math::calc_unrealized_pnl(
        100_000 * math::PRECISION,
        50_000 * math::PRECISION,
        1 * math::PRECISION,
        true,
    );
    let expected = 100_000 * math::PRECISION * (1 * math::PRECISION - 50_000 * math::PRECISION)
        / (50_000 * math::PRECISION);
    assert_eq!(pnl, expected);
}

#[test]
fn test_borrow_fee_large_index_gap() {
    // Position held for ages: index went from 1.0 to 2.0 (100% cumulative cost)
    let fee = math::calc_borrow_fee(
        100_000 * math::PRECISION,
        math::INDEX_PRECISION,
        2 * math::INDEX_PRECISION,
    );
    assert_eq!(fee, 100_000 * math::PRECISION);
}

#[test]
fn test_health_exactly_zero_liquidation_boundary() {
    // collateral=$100, pnl=-$80, borrow=$20, funding=0 => health=0
    let h = math::calc_health(
        100 * math::PRECISION,
        -80 * math::PRECISION,
        20 * math::PRECISION,
        0,
    );
    assert_eq!(h, 0);
}

#[test]
fn test_borrow_rate_above_10000_bps() {
    // Adversarial: utilization beyond 100% (12000 BPS passed in)
    // rate = 100 + 400 + (12000-8000)*5000/10000 = 500 + 2000 = 2500
    let rate = math::calc_borrow_rate(12_000, BASE_BORROW_RATE, SLOPE1, SLOPE2, OPTIMAL_UTIL);
    assert_eq!(rate, 2500);
}

#[test]
fn test_funding_rate_extreme_imbalance() {
    // Massive long imbalance — should not overflow
    let big = i128::MAX / (2 * math::PRECISION);
    let rate = math::calc_funding_rate(big * math::PRECISION, 1 * math::PRECISION, BASE_FUNDING_RATE);
    // (big - 1) / (big + 1) ~ 1 for big >> 1, so rate ~ BASE_FUNDING_RATE
    assert!(
        rate >= BASE_FUNDING_RATE - 1 && rate <= BASE_FUNDING_RATE,
        "Extreme imbalance rate should be near BASE_FUNDING_RATE, got {}",
        rate
    );
}

#[test]
fn test_accumulate_borrow_index_large_time_delta() {
    // 10 years at 15% rate (1500 BPS) — must not overflow
    let new_idx = math::accumulate_borrow_index(
        math::INDEX_PRECISION,
        1500,
        math::SECONDS_PER_YEAR * 10,
    );
    let expected_delta: i128 = 1500 * math::INDEX_PRECISION
        * (math::SECONDS_PER_YEAR * 10) as i128
        / (math::BPS * math::SECONDS_PER_YEAR as i128);
    assert_eq!(new_idx, math::INDEX_PRECISION + expected_delta);
}

#[test]
fn test_avg_price_add_zero_size_returns_current() {
    // Adding 0 size should not change the average
    let avg = math::update_global_avg_price(
        50_000 * math::PRECISION,
        100_000 * math::PRECISION,
        999_999 * math::PRECISION, // wild price, but size=0 so irrelevant
        0,
    );
    assert_eq!(avg, 50_000 * math::PRECISION);
}
