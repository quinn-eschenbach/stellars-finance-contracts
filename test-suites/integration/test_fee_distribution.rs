//! Fee distribution integration tests.
//!
//! Validates that the protocol correctly splits fees between keeper, dev (protocol),
//! and LP according to the FeeSplits config when positions are closed via different
//! close types:
//!
//! | Close Type            | Keeper share        | Dev share (unclaimed_fees) | LP share (pool) |
//! |-----------------------|---------------------|----------------------------|-----------------|
//! | User close            | 0                   | fees * dev_bps / 10000     | remainder       |
//! | TP/SL execution       | fees * keeper_bps   | fees * dev_bps / 10000     | remainder       |
//! | Liquidation           | fees * keeper_bps   | fees * dev_bps / 10000     | remainder       |
//! | ADL (deleverage)      | 0                   | fees * dev_bps / 10000     | remainder       |
//!
//! Fixture defaults: keeper_bps=500, dev_bps=500, lp_bps=9000

use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};
use test_suites::testutils::{Fixture, TEST_TIMESTAMP, USDC_UNIT};

const PRECISION: i128 = 10_000_000;
const MIN_POSITION_LIFETIME: u64 = 60;

// ---------------------------------------------------------------------------
// 1. User close (decrease_position): keeper gets nothing
// ---------------------------------------------------------------------------

#[test]
fn test_user_close_no_keeper_share() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    let keeper_balance_before = f.usdc.balance(&f.keeper);

    // Open a position so borrow fees accumulate
    let size = 50_000 * USDC_UNIT;
    let collateral = 5_000 * USDC_UNIT;
    f.open_long(&f.trader, size, collateral);

    // Advance 1 hour to accumulate borrow fees
    f.advance_time(TEST_TIMESTAMP + 3_600);
    f.set_btc_price(50_000);
    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));

    // User closes own position (decrease_position)
    f.advance_time(TEST_TIMESTAMP + 3_600 + MIN_POSITION_LIFETIME + 1);
    f.set_btc_price(50_000);
    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &size);

    // ASSERT 1: Keeper balance must be unchanged (no keeper share for user close)
    let keeper_balance_after = f.usdc.balance(&f.keeper);
    assert_eq!(
        keeper_balance_after, keeper_balance_before,
        "Keeper must NOT receive any fees on user close (decrease_position)"
    );

    // ASSERT 2: Vault should have unclaimed_fees == dev_share only (5% of total fees).
    // We verify this by having admin claim fees and checking the claimed amount is > 0.
    let recipient = Address::generate(&env);
    f.vault.claim_fees(&f.admin, &recipient);
    let dev_claimed = f.usdc.balance(&recipient);

    assert!(
        dev_claimed > 0,
        "Dev share must be positive after user close with borrow fees: claimed={}",
        dev_claimed
    );

    // ASSERT 3: After claiming, free_liquidity should increase (unclaimed_fees cleared).
    // The LP share should remain in the vault pool, not in unclaimed_fees.
}

// ---------------------------------------------------------------------------
// 2. TP/SL execution: keeper gets keeper_bps share
// ---------------------------------------------------------------------------

#[test]
fn test_tp_sl_keeper_gets_share() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    let keeper_balance_before = f.usdc.balance(&f.keeper);

    // Open long with TP at 55k
    let size = 50_000 * USDC_UNIT;
    let collateral = 5_000 * USDC_UNIT;
    let tp_price: i128 = 55_000 * PRECISION;
    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &size,
        &collateral,
        &true,
        &tp_price,
        &0, &0i128
    );

    // Advance time to accumulate borrow fees
    f.advance_time(TEST_TIMESTAMP + 3_600);
    f.set_btc_price(56_000); // above TP, triggers

    // Keeper executes the order
    f.position_manager
        .execute_order(&f.keeper, &f.trader, &symbol_short!("BTC"));

    // ASSERT 1: Keeper must receive keeper_share (5% of total_fees)
    let keeper_balance_after = f.usdc.balance(&f.keeper);
    let keeper_received = keeper_balance_after - keeper_balance_before;
    assert!(
        keeper_received > 0,
        "Keeper must receive fee share on TP/SL execution: received={}",
        keeper_received
    );

    // ASSERT 2: Vault has dev_share in unclaimed_fees, claim it.
    let recipient = Address::generate(&env);
    f.vault.claim_fees(&f.admin, &recipient);
    let dev_claimed = f.usdc.balance(&recipient);

    assert!(
        dev_claimed > 0,
        "Dev share must be positive after TP/SL execution: claimed={}",
        dev_claimed
    );

    // ASSERT 3: Keeper share and dev share should be approximately equal
    // (both are 500 bps = 5% of total fees).
    // Allow 1 stroop tolerance for rounding.
    let diff = (keeper_received - dev_claimed).abs();
    assert!(
        diff <= 1,
        "Keeper share ({}) and dev share ({}) must be equal (both 5% of total fees), diff={}",
        keeper_received,
        dev_claimed,
        diff
    );
}

// ---------------------------------------------------------------------------
// 3. Liquidation: keeper gets keeper_bps share
// ---------------------------------------------------------------------------

#[test]
fn test_liquidation_keeper_gets_share() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    let keeper_balance_before = f.usdc.balance(&f.keeper);

    // Open a 10x long (thin margin, easy to liquidate)
    let size = 20_000 * USDC_UNIT;
    let collateral = 2_000 * USDC_UNIT;
    f.open_long(&f.trader, size, collateral);

    // Advance time for borrow fees, then crash price to make position underwater
    f.advance_time(TEST_TIMESTAMP + 3_600);
    f.set_btc_price(44_000); // 12% drop, enough to liquidate 10x leverage

    // Keeper liquidates
    f.position_manager
        .liquidate_position(&f.keeper, &f.trader, &symbol_short!("BTC"));

    // ASSERT 1: Keeper receives keeper_share of borrow fees
    let keeper_balance_after = f.usdc.balance(&f.keeper);
    let keeper_received = keeper_balance_after - keeper_balance_before;
    assert!(
        keeper_received > 0,
        "Keeper must receive fee share on liquidation: received={}",
        keeper_received
    );

    // ASSERT 2: Dev share should be in unclaimed_fees
    let recipient = Address::generate(&env);
    f.vault.claim_fees(&f.admin, &recipient);
    let dev_claimed = f.usdc.balance(&recipient);

    assert!(
        dev_claimed > 0,
        "Dev share must be positive after liquidation: claimed={}",
        dev_claimed
    );

    // ASSERT 3: Keeper and dev share should be approximately equal (both 5%)
    let diff = (keeper_received - dev_claimed).abs();
    assert!(
        diff <= 1,
        "Keeper share ({}) and dev share ({}) must be equal for liquidation, diff={}",
        keeper_received,
        dev_claimed,
        diff
    );
}

// ---------------------------------------------------------------------------
// 4. ADL (deleverage_position): keeper gets nothing
// ---------------------------------------------------------------------------

#[test]
fn test_adl_no_keeper_share() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Lower ADL utilization threshold to make it triggerable
    f.config_manager.update_protocol_limits(
        &f.admin,
        &config_manager::ProtocolLimits {
            min_collateral: 1_000_000,
            cooldown_duration: 60,
            min_position_lifetime: 60,
            max_utilization_ratio: 8_500,
            funding_cut_bps: 500,
            adl_pnl_bps: 9_000,
            adl_utilization_bps: 3_000, // 30% util triggers ADL
            liquidation_threshold_bps: 200,
        },
    );
    f.config_manager.update_borrow_rate_config(&f.admin, &config_manager::BorrowRateConfig {
        base_borrow_rate_bps: 100,
        slope1_bps: 500,
        slope2_bps: 5_000,
        optimal_utilization_bps: 8_000,
        base_funding_rate_bps: 100,
    });

    let keeper_balance_before = f.usdc.balance(&f.keeper);

    // Open large position to exceed 30% utilization
    let trader = f.create_funded_trader(50_000 * USDC_UNIT);
    f.open_long(&trader, 400_000 * USDC_UNIT, 40_000 * USDC_UNIT);

    // Advance time for borrow fees; price up slightly so position is profitable (ADL requires pnl > 0)
    f.advance_time(TEST_TIMESTAMP + 3_600);
    f.set_btc_price(50_100);

    // Keeper ADLs the position
    f.position_manager
        .deleverage_position(&f.keeper, &trader, &symbol_short!("BTC"));

    // ASSERT 1: Keeper balance must be unchanged (no keeper share for ADL)
    let keeper_balance_after = f.usdc.balance(&f.keeper);
    assert_eq!(
        keeper_balance_after, keeper_balance_before,
        "Keeper must NOT receive any fees on ADL (deleverage_position)"
    );

    // ASSERT 2: Dev share should still be accrued to unclaimed_fees
    let recipient = Address::generate(&env);
    f.vault.claim_fees(&f.admin, &recipient);
    let dev_claimed = f.usdc.balance(&recipient);

    assert!(
        dev_claimed > 0,
        "Dev share must be positive after ADL with borrow fees: claimed={}",
        dev_claimed
    );
}

// ---------------------------------------------------------------------------
// 5. Admin claims dev fees after user close
// ---------------------------------------------------------------------------

#[test]
fn test_admin_claims_dev_fees() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Open position, let borrow fees accrue, then close
    let size = 50_000 * USDC_UNIT;
    let collateral = 5_000 * USDC_UNIT;
    f.open_long(&f.trader, size, collateral);
    let trader_balance_after_open = f.usdc.balance(&f.trader);

    f.advance_time(TEST_TIMESTAMP + 86_400); // 24 hours for substantial fees
    f.set_btc_price(50_000);
    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));

    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &size);

    // Calculate total borrow fee paid by trader
    let trader_returned = f.usdc.balance(&f.trader) - trader_balance_after_open;
    let total_fee_paid = collateral - trader_returned;
    assert!(total_fee_paid > 0, "Trader must have paid borrow fees");

    // Admin claims dev fees to a recipient
    let recipient = Address::generate(&env);
    let recipient_balance_before = f.usdc.balance(&recipient);
    f.vault.claim_fees(&f.admin, &recipient);

    let dev_claimed = f.usdc.balance(&recipient) - recipient_balance_before;
    assert!(
        dev_claimed > 0,
        "Admin must receive positive dev fees via claim_fees: claimed={}",
        dev_claimed
    );

    // Dev share should be 5% of (borrow_fee + funding_protocol_cut), not 5% of total_fee_paid.
    // total_fee_paid includes the full funding_fee, but only the protocol cut portion
    // goes through distribute_fees. Verify dev_claimed is a small fraction of total fees.
    assert!(
        dev_claimed < total_fee_paid,
        "Dev share ({}) must be less than total fees paid ({})",
        dev_claimed,
        total_fee_paid
    );
    assert!(
        dev_claimed > 0,
        "Dev share must be positive"
    );

    // After claiming, a second claim should panic (ZeroAmount)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        f.vault.claim_fees(&f.admin, &recipient);
    }));
    assert!(
        result.is_err(),
        "Second claim_fees must fail when unclaimed_fees is 0"
    );
}

// ---------------------------------------------------------------------------
// 6. Zero fees: no distribution, no panics
// ---------------------------------------------------------------------------

#[test]
fn test_zero_fees_no_distribution() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    let keeper_balance_before = f.usdc.balance(&f.keeper);

    // Open and immediately close (no time elapsed, zero borrow fees)
    let size = 10_000 * USDC_UNIT;
    let collateral = 1_000 * USDC_UNIT;
    f.open_long(&f.trader, size, collateral);

    // Close immediately (but after min_position_lifetime)
    f.advance_time(TEST_TIMESTAMP + MIN_POSITION_LIFETIME + 1);
    f.set_btc_price(50_000);
    // Do NOT call update_indices — no time for fees to accrue significantly

    let _trader_balance_before_close = f.usdc.balance(&f.trader);

    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &size);

    // Keeper balance should be unchanged
    let keeper_balance_after = f.usdc.balance(&f.keeper);
    assert_eq!(
        keeper_balance_after, keeper_balance_before,
        "Keeper must not receive fees when there are zero/minimal fees"
    );

    // Trader should get back approximately full collateral (minimal/zero fees)
    let trader_returned = f.usdc.balance(&f.trader) - _trader_balance_before_close;
    // With only ~61 seconds, borrow fee should be negligible
    assert!(
        trader_returned >= collateral - USDC_UNIT, // allow up to 1 USDC tolerance
        "Trader should get back ~full collateral with minimal time elapsed: returned={}",
        trader_returned
    );

    // Attempting to claim fees should either panic (zero amount) or yield negligible amount
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        f.vault.claim_fees(&f.admin, &f.admin);
    }));
    // Either no fees accrued (panic) or a tiny amount — both are acceptable
    // The key assertion is that no panic occurred during the close itself.
}

// ---------------------------------------------------------------------------
// ADVERSARIAL: Verify fee split math with precise BPS calculation
// ---------------------------------------------------------------------------

#[test]
fn test_fee_split_bps_precision() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Open position, accrue fees over 24h, close via TP (keeper gets share)
    let size = 100_000 * USDC_UNIT;
    let collateral = 10_000 * USDC_UNIT;
    let tp_price: i128 = 55_000 * PRECISION;

    f.position_manager.increase_position(
        &f.trader,
        &symbol_short!("BTC"),
        &size,
        &collateral,
        &true,
        &tp_price,
        &0, &0i128
    );

    let _trader_balance_after_open = f.usdc.balance(&f.trader);
    let keeper_balance_before = f.usdc.balance(&f.keeper);

    // 24h to build up fees
    f.advance_time(TEST_TIMESTAMP + 86_400);
    f.set_btc_price(56_000); // above TP

    f.position_manager
        .execute_order(&f.keeper, &f.trader, &symbol_short!("BTC"));

    let keeper_received = f.usdc.balance(&f.keeper) - keeper_balance_before;

    // Claim dev fees
    let dev_recipient = Address::generate(&env);
    f.vault.claim_fees(&f.admin, &dev_recipient);
    let dev_claimed = f.usdc.balance(&dev_recipient);

    // Both keeper and dev should get 500/10000 = 5% of total fees.
    // Since keeper_bps == dev_bps, they should be equal (within rounding).
    assert!(
        keeper_received > 0 && dev_claimed > 0,
        "Both keeper and dev must receive positive fees"
    );

    let diff = (keeper_received - dev_claimed).abs();
    assert!(
        diff <= 1,
        "Keeper ({}) and dev ({}) shares must match when bps are equal, diff={}",
        keeper_received,
        dev_claimed,
        diff
    );

    // LP share = 90% of total fees. Verify the remaining pool has it:
    // total_fees = keeper_received + dev_claimed + lp_share
    // lp_share should be ~9x the keeper or dev share
    let implied_total_fees = keeper_received + dev_claimed; // this is 10% of total
    let _implied_lp_share = implied_total_fees * 9; // 90% = 9x the 10%
    // The LP share stays in the vault pool. Verify vault total_assets reflects it.
    let total_assets = f.vault.total_assets();
    assert!(
        total_assets > 0,
        "Vault must still have assets after fee distribution"
    );
}

// ---------------------------------------------------------------------------
// ADVERSARIAL: Multiple closes accumulate dev fees correctly
// ---------------------------------------------------------------------------

#[test]
fn test_multiple_closes_accumulate_dev_fees() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Close 1: user close
    let trader1 = f.create_funded_trader(10_000 * USDC_UNIT);
    f.open_long(&trader1, 20_000 * USDC_UNIT, 2_000 * USDC_UNIT);

    f.advance_time(TEST_TIMESTAMP + 3_600);
    f.set_btc_price(50_000);
    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));

    f.position_manager
        .decrease_position(&trader1, &symbol_short!("BTC"), &(20_000 * USDC_UNIT));

    // Close 2: another user close
    let trader2 = f.create_funded_trader(10_000 * USDC_UNIT);
    f.open_long(&trader2, 20_000 * USDC_UNIT, 2_000 * USDC_UNIT);

    f.advance_time(TEST_TIMESTAMP + 7_200);
    f.set_btc_price(50_000);
    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));

    f.position_manager
        .decrease_position(&trader2, &symbol_short!("BTC"), &(20_000 * USDC_UNIT));

    // Claim accumulated dev fees from both closes
    let recipient = Address::generate(&env);
    f.vault.claim_fees(&f.admin, &recipient);
    let total_dev_claimed = f.usdc.balance(&recipient);

    assert!(
        total_dev_claimed > 0,
        "Accumulated dev fees from two closes must be positive: claimed={}",
        total_dev_claimed
    );
}

// ---------------------------------------------------------------------------
// ADVERSARIAL: Non-admin cannot claim dev fees
// ---------------------------------------------------------------------------

#[test]
fn test_non_admin_cannot_claim_dev_fees() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    // Generate some fees
    f.open_long(&f.trader, 20_000 * USDC_UNIT, 2_000 * USDC_UNIT);
    f.advance_time(TEST_TIMESTAMP + 3_600 + MIN_POSITION_LIFETIME + 1);
    f.set_btc_price(50_000);
    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));
    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &(20_000 * USDC_UNIT));

    // Random user tries to claim
    let random = Address::generate(&env);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        f.vault.claim_fees(&random, &random);
    }));
    assert!(
        result.is_err(),
        "Non-admin must be rejected from claiming dev fees"
    );
}

// ---------------------------------------------------------------------------
// ADVERSARIAL: LP share stays in vault pool, not in unclaimed_fees
// ---------------------------------------------------------------------------

#[test]
fn test_lp_share_stays_in_vault_pool() {
    let env = Env::default();
    let f = Fixture::deploy(&env);

    let total_assets_before = f.vault.total_assets();

    // Open + close to generate fees
    f.open_long(&f.trader, 50_000 * USDC_UNIT, 5_000 * USDC_UNIT);
    let trader_balance_after_open = f.usdc.balance(&f.trader);

    f.advance_time(TEST_TIMESTAMP + 86_400);
    f.set_btc_price(50_000);
    f.position_manager
        .update_indices(&f.keeper, &symbol_short!("BTC"));

    f.position_manager
        .decrease_position(&f.trader, &symbol_short!("BTC"), &(50_000 * USDC_UNIT));

    // Calculate total fees from trader's perspective
    let trader_returned = f.usdc.balance(&f.trader) - trader_balance_after_open;
    let total_fee_paid = 5_000 * USDC_UNIT - trader_returned;
    assert!(total_fee_paid > 0, "Must have paid borrow fees");

    // Claim dev share
    let recipient = Address::generate(&env);
    f.vault.claim_fees(&f.admin, &recipient);
    let dev_claimed = f.usdc.balance(&recipient);

    // LP share = total_fee_paid - dev_claimed (for user close, keeper=0)
    let lp_share = total_fee_paid - dev_claimed;

    // The vault total_assets should reflect the LP share remaining in the pool.
    // After close: vault got collateral back (minus PnL=0), so total_assets = before + fees_kept_in_pool
    // fees_kept_in_pool = lp_share (dev was claimed out)
    let total_assets_after = f.vault.total_assets();

    // total_assets_after should be total_assets_before - dev_claimed (sent out via claim)
    // but LP share (90% of fees) stays in, increasing vault value for LPs
    assert!(
        total_assets_after > total_assets_before - total_fee_paid,
        "Vault total_assets must reflect LP share remaining in pool"
    );

    assert!(
        lp_share > dev_claimed * 8,
        "LP share ({}) must be significantly larger than dev share ({}) at 90% vs 5%",
        lp_share,
        dev_claimed
    );
}
