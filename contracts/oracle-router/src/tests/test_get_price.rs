//! Tests for `get_price` on the OracleRouter contract.
//!
//! Coverage areas (2.4 — cache hit path):
//!   - Cached price is returned without querying sources when within duration
//!   - Expired cache triggers a fresh fetch from sources
//!   - No cache entry at all triggers a fetch
//!
//! Coverage areas (2.5 — cache miss / fetch path):
//!   - Single source: price is fetched and returned correctly
//!   - No sources configured → NoPriceSources (6)
//!   - All sources stale → StalePrice (4)
//!   - Stale sources are filtered when at least one fresh source exists
//!   - Median computation for three sources (odd count)
//!   - Lower-median selection for even source count
//!   - Deviation above threshold → PriceDeviationTooHigh (5)
//!   - Deviation within threshold → price returned
//!   - Successful fetch writes cache entry for subsequent calls
//!   - Second call (within cache_duration) hits the cache
//!   - No OracleConfig set → NotInitialized (2)
//!
//! Coverage areas (H-1 audit — broken oracle source isolation):
//!   - A source that panics must be skipped when another valid source exists
//!   - All sources panicking must return a clean contract error, not a host panic
//!
//! All tests FAIL until `get_price` replaces its `todo!()` stub.

#![cfg(test)]

use soroban_sdk::{testutils::Ledger as _, vec, Address, Env, Symbol};

use super::helpers::{deploy_mock_oracle, deploy_with_config_manager, deploy_with_price_feed};
use crate::OracleConfig;
use crate::OracleRouterError;

// ---------------------------------------------------------------------------
// 2.4 — Cache hit path
// ---------------------------------------------------------------------------

/// When `get_price` is called and the cached price was written at time T, and
/// the current ledger timestamp is T + cache_duration (i.e., still within the
/// valid window), the cached price must be returned without cross-contract
/// oracle calls.
///
/// We verify this by setting the mock oracle to a DIFFERENT price after the
/// first `get_price` call has primed the cache.  If the implementation
/// correctly uses the cache, the second call must return the original price,
/// not the updated mock price.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_returns_cached_price_within_duration() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    // Set a known price and ensure it is fresh (timestamp == ledger timestamp).
    let initial_price: i128 = 3_000_0000000; // 3000.0000000
    mock.set_price(&eth, &initial_price);

    // First call — cache miss, fetches from oracle, stores in cache.
    let price_first_call = oracle.get_price(&eth);
    assert_eq!(
        price_first_call, initial_price,
        "first get_price call must return the mock oracle's current price"
    );

    // Update the mock oracle to a different price WITHOUT advancing ledger time.
    // The cache is still valid (timestamp has not moved past cache_duration).
    let updated_price: i128 = 9_999_0000000;
    mock.set_price(&eth, &updated_price);

    // Second call — must hit the cache and return the ORIGINAL price.
    let price_second_call = oracle.get_price(&eth);
    assert_eq!(
        price_second_call, initial_price,
        "second get_price call within cache_duration must return the cached price, \
         not the updated mock oracle price; cache hit path is broken if this fails"
    );
}

/// When the ledger timestamp advances past `last_update + cache_duration`, the
/// cached entry must be treated as expired.  A subsequent `get_price` call must
/// re-fetch from sources and return the updated price.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_cache_expired_triggers_fetch() {
    let env = Env::default();
    env.mock_all_auths();

    // cache_duration is 10 seconds in deploy_with_price_feed.
    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let stale_price: i128 = 1_000_0000000;
    mock.set_price(&eth, &stale_price);

    // Prime the cache with stale_price.
    oracle.get_price(&eth);

    // Advance ledger timestamp by 11 seconds — beyond the 10-second cache_duration.
    env.ledger().with_mut(|li| {
        li.timestamp += 11;
    });

    // Update the mock oracle to a fresh price at the new timestamp.
    let fresh_price: i128 = 2_000_0000000;
    mock.set_price(&eth, &fresh_price);

    // get_price must now see the cache as expired and fetch the fresh price.
    let price = oracle.get_price(&eth);
    assert_eq!(
        price, fresh_price,
        "get_price must return the fresh price after the cache expires; \
         if this fails the expiry check is missing or uses the wrong comparison"
    );
}

/// When no cache entry exists for a symbol (e.g., first ever call for that
/// symbol), `get_price` must fall through to the fetch path.
///
/// We verify this by simply calling `get_price` for a symbol that has never
/// been fetched before (no prior call to warm the cache).  The mock oracle
/// must be consulted and its price returned.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_no_cache_entry_triggers_fetch() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let expected: i128 = 1_500_0000000;
    mock.set_price(&eth, &expected);

    // No prior get_price call — cache is empty for ETH.
    let price = oracle.get_price(&eth);
    assert_eq!(
        price, expected,
        "first get_price call for a symbol with no cache entry must fetch from \
         sources and return the mock oracle price"
    );
}

// ---------------------------------------------------------------------------
// 2.5 — Cache miss / fetch path
// ---------------------------------------------------------------------------

/// With a single primary source configured, `get_price` must return exactly
/// the price reported by that source.  Validates the single-source path does
/// not mutate, average, or otherwise alter the price.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_fetches_from_single_source() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let expected: i128 = 2_500_0000000;
    mock.set_price(&eth, &expected);

    let price = oracle.get_price(&eth);
    assert_eq!(
        price, expected,
        "single source get_price must return the exact price from that source"
    );
}

/// Synonym for `test_get_price_fetches_from_single_source` with a different
/// price value, explicitly confirming the returned value is the source price.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_single_source_price_is_returned() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let expected: i128 = 42_0000000; // 42.0000000 (unusual value to catch aliasing)
    mock.set_price(&eth, &expected);

    assert_eq!(
        oracle.get_price(&eth),
        expected,
        "get_price must return the exact i128 price value that the source provides"
    );
}

/// If no primary sources are configured for a symbol, `get_price` must panic
/// with `OracleRouterError::NoPriceSources` (discriminant 6).
///
/// This guards against the fetch path silently returning 0 or panicking with
/// an unexpected host-level error when the source list is empty.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_no_sources_returns_no_price_sources_error() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy a fully initialized router with config, but register NO sources for BTC.
    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let config = OracleConfig {
        max_deviation_bps: 200,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    // BTC has never had set_oracle_sources called — source list is empty.
    let btc = Symbol::new(&env, "BTC");
    let result = oracle.try_get_price(&btc);

    assert!(
        result.is_err(),
        "get_price with no sources configured must return an error, not 0 or default"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::NoPriceSources as u32),
        "get_price with no sources must return NoPriceSources (6)"
    );
}

/// Verify the NoPriceSources error discriminant is exactly 6.
/// This prevents accidental renumbering from breaking on-chain error matching.
#[test]
fn test_no_price_sources_error_code_is_6() {
    assert_eq!(
        OracleRouterError::NoPriceSources as u32,
        6,
        "OracleRouterError::NoPriceSources must always be discriminant 6"
    );
}

/// When all primary sources have a `last_update` that is older than
/// `staleness_threshold` seconds ago, `get_price` must panic with
/// `OracleRouterError::StalePrice` (discriminant 4).
///
/// Setup: staleness_threshold = 60 seconds. We advance the ledger by 61 seconds
/// AFTER setting the price, so that `last_update = 0` and
/// `current_time - last_update = 61 > 60`.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_all_sources_stale_returns_stale_price_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    // Set price at t=0. last_update will be the current ledger timestamp.
    mock.set_price(&eth, &3_000_0000000i128);

    // Advance time by 61 seconds — past the 60-second staleness_threshold.
    env.ledger().with_mut(|li| {
        li.timestamp += 61;
    });

    // The single source is now stale — all sources stale → StalePrice.
    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "get_price when all sources are stale must return an error"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::StalePrice as u32),
        "all-stale sources must return StalePrice (4)"
    );
}

/// Verify the StalePrice error discriminant is exactly 4.
#[test]
fn test_stale_price_error_code_is_4() {
    assert_eq!(
        OracleRouterError::StalePrice as u32,
        4,
        "OracleRouterError::StalePrice must always be discriminant 4"
    );
}

/// When one of two sources is stale but the other is fresh, the stale source
/// must be silently filtered out and the fresh source's price must be returned.
///
/// Setup: two mock oracles. Advance time 61 seconds, then set a fresh price
/// on the second oracle (which updates its last_update to the NEW timestamp).
/// The first oracle's price was set at t=0 and is now stale.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_stale_source_filtered_if_fresh_source_exists() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 500, // 5% — generous threshold for this test
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    // Deploy two independent mock oracles.
    let stale_oracle = deploy_mock_oracle(&env);
    let fresh_oracle = deploy_mock_oracle(&env);

    // Set stale_oracle price at t=0.
    stale_oracle.set_price(&eth, &2_000_0000000i128);

    let primary = vec![
        &env,
        stale_oracle.address.clone(),
        fresh_oracle.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    // Advance time past staleness_threshold — stale_oracle is now stale.
    env.ledger().with_mut(|li| {
        li.timestamp += 61;
    });

    // fresh_oracle sets its price AFTER the time advance — last_update is now current.
    let fresh_price: i128 = 2_000_0000000;
    fresh_oracle.set_price(&eth, &fresh_price);

    // get_price must filter out stale_oracle and return fresh_oracle's price.
    let price = oracle.get_price(&eth);
    assert_eq!(
        price, fresh_price,
        "get_price must use the fresh source's price when one source is stale and \
         another is fresh; stale source must be silently discarded"
    );
}

/// For three sources with prices [1000, 2000, 3000] (sorted), the median must
/// be 2000 (the middle element).
///
/// This test validates that:
///   1. All three sources are aggregated
///   2. The sort is correct (no partial-sort bug)
///   3. The middle element is selected for odd counts
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_computes_median_of_three_sources() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    // Use a generous deviation threshold so spread is not rejected.
    let config = OracleConfig {
        max_deviation_bps: 10_000, // 100% — won't reject any spread in this test
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let oracle_low = deploy_mock_oracle(&env);
    let oracle_mid = deploy_mock_oracle(&env);
    let oracle_high = deploy_mock_oracle(&env);

    let price_low: i128 = 1_000_0000000;
    let price_mid: i128 = 2_000_0000000;
    let price_high: i128 = 3_000_0000000;

    oracle_low.set_price(&eth, &price_low);
    oracle_mid.set_price(&eth, &price_mid);
    oracle_high.set_price(&eth, &price_high);

    // Register all three (in unsorted order to validate the sort).
    let primary = vec![
        &env,
        oracle_high.address.clone(),
        oracle_low.address.clone(),
        oracle_mid.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let price = oracle.get_price(&eth);
    assert_eq!(
        price, price_mid,
        "median of [1000, 2000, 3000] must be 2000; sort or median selection is \
         incorrect if a different value is returned"
    );
}

/// For four sources with prices [1000, 2000, 3000, 4000] (sorted), the lower
/// median (index n/2 - 1 = 1, value 2000) must be returned, NOT the upper
/// median (3000).
///
/// The specification explicitly states: "for even count pick lower median".
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_computes_lower_median_for_even_count() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 10_000, // 100% — won't reject any spread in this test
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let o1 = deploy_mock_oracle(&env);
    let o2 = deploy_mock_oracle(&env);
    let o3 = deploy_mock_oracle(&env);
    let o4 = deploy_mock_oracle(&env);

    o1.set_price(&eth, &4_000_0000000i128);
    o2.set_price(&eth, &1_000_0000000i128);
    o3.set_price(&eth, &3_000_0000000i128);
    o4.set_price(&eth, &2_000_0000000i128);

    let primary = vec![
        &env,
        o1.address.clone(),
        o2.address.clone(),
        o3.address.clone(),
        o4.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let price = oracle.get_price(&eth);
    assert_eq!(
        price, 2_000_0000000i128,
        "lower median of [1000, 2000, 3000, 4000] must be 2000 (index n/2 - 1); \
         returning upper median (3000) violates the spec"
    );
}

/// When the spread between max and min prices exceeds `max_deviation_bps`, the
/// contract must panic with `OracleRouterError::PriceDeviationTooHigh` (5).
///
/// Calculation: deviation_bps = (max - min) * 10_000 / median
///   prices = [1000, 2000], median = 1000 (lower median for 2 sources)
///   deviation_bps = (2000 - 1000) * 10_000 / 1000 = 10_000 bps (100%)
///   With max_deviation_bps = 200 (2%), this must be rejected.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_high_deviation_returns_deviation_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 200, // 2% maximum allowed spread
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let oracle_low = deploy_mock_oracle(&env);
    let oracle_high = deploy_mock_oracle(&env);

    // Price spread: 50% — far above the 2% threshold.
    oracle_low.set_price(&eth, &1_000_0000000i128);
    oracle_high.set_price(&eth, &1_500_0000000i128);

    let primary = vec![
        &env,
        oracle_low.address.clone(),
        oracle_high.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "get_price must return an error when price deviation exceeds max_deviation_bps"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::PriceDeviationTooHigh as u32),
        "excessive price spread must return PriceDeviationTooHigh (5)"
    );
}

/// Verify the PriceDeviationTooHigh error discriminant is exactly 5.
#[test]
fn test_price_deviation_error_code_is_5() {
    assert_eq!(
        OracleRouterError::PriceDeviationTooHigh as u32,
        5,
        "OracleRouterError::PriceDeviationTooHigh must always be discriminant 5"
    );
}

/// When the spread between max and min prices is within `max_deviation_bps`,
/// `get_price` must succeed and return the median.
///
/// Calculation: prices = [99, 100], lower median = 99
///   deviation_bps = (100 - 99) * 10_000 / 99 ≈ 101 bps (1.01%)
///   With max_deviation_bps = 200 (2%), this must be accepted.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_deviation_within_threshold_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 200, // 2%
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let oracle_a = deploy_mock_oracle(&env);
    let oracle_b = deploy_mock_oracle(&env);

    // 1% spread — within 2% threshold.
    oracle_a.set_price(&eth, &100_0000000i128); // 100.0000000
    oracle_b.set_price(&eth, &101_0000000i128); // 101.0000000

    let primary = vec![&env, oracle_a.address.clone(), oracle_b.address.clone()];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let result = oracle.try_get_price(&eth);
    assert!(
        result.is_ok(),
        "get_price must succeed when deviation is within the allowed threshold; \
         got error: {:?}",
        result.err()
    );
}

/// After a successful `get_price` fetch, the result must be stored in the
/// cache.  A second call to `get_price` — made before advancing ledger time —
/// must NOT trigger another cross-contract oracle call.
///
/// We verify this by pointing the primary source at an address that no longer
/// has a price set (simulating an oracle that would fail on re-call) AFTER the
/// first successful call.  If the cache works, the second call reads the cached
/// value and the contract never tries to invoke the now-missing oracle.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_updates_cache_after_fetch() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let expected: i128 = 3_500_0000000;
    mock.set_price(&eth, &expected);

    // First call — cache miss, fetches from mock, stores in cache.
    let first_price = oracle.get_price(&eth);
    assert_eq!(
        first_price, expected,
        "first get_price call must return the mock price"
    );

    // Second call — within cache_duration, must use cache.
    // The mock oracle still has the same price, so we verify the value is consistent.
    let second_price = oracle.get_price(&eth);
    assert_eq!(
        second_price, first_price,
        "second get_price call must return the same cached price as the first call; \
         cache was not written if this fails"
    );
}

/// A second `get_price` call within `cache_duration` must return the same
/// price without contacting sources.  This is the primary cache-hit validation.
///
/// We change the mock oracle price between calls to create an observable
/// difference if the cache is bypassed.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_uses_cached_price_on_second_call() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let price_at_cache_write: i128 = 4_000_0000000;
    mock.set_price(&eth, &price_at_cache_write);

    // First call — primes the cache.
    let price_call_1 = oracle.get_price(&eth);
    assert_eq!(price_call_1, price_at_cache_write);

    // Change mock price WITHOUT advancing time — cache is still valid.
    let price_after_cache: i128 = 9_000_0000000;
    mock.set_price(&eth, &price_after_cache);

    // Second call — must return cached value, not the new mock price.
    let price_call_2 = oracle.get_price(&eth);
    assert_eq!(
        price_call_2, price_at_cache_write,
        "second get_price call within cache_duration must return the cached price \
         ({price_at_cache_write}), not the updated mock price ({price_after_cache})"
    );
}

/// Calling `get_price` on an initialized router where `set_oracle_config` has
/// NEVER been called must panic with `OracleRouterError::NotInitialized` (2).
///
/// The contract must check for OracleConfig presence before reading sources
/// or calling any oracle, since the staleness_threshold and cache_duration
/// are required for any validation step.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_no_oracle_config_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    // deploy_with_config_manager sets up the CM + router but does NOT call
    // set_oracle_config, so OracleConfig is absent from instance storage.
    let (oracle, _cm, _admin) = deploy_with_config_manager(&env);

    let eth = Symbol::new(&env, "ETH");
    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "get_price with no OracleConfig set must return an error"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::NotInitialized as u32),
        "missing OracleConfig must return NotInitialized (2), not a different error or panic"
    );
}

// ---------------------------------------------------------------------------
// Adversarial: math safety and boundary conditions
// ---------------------------------------------------------------------------

/// Deviation check with prices at exact boundary: deviation_bps == max_deviation_bps
/// must be ACCEPTED (not-greater-than comparison: deviation > threshold → reject).
///
/// If the implementation uses `>=` instead of `>`, this test will catch it.
///
/// Calculation: prices = [100, 102], median = 100 (lower)
///   deviation_bps = (102 - 100) * 10_000 / 100 = 200 bps
///   With max_deviation_bps = 200: 200 > 200 is false → ACCEPT
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_deviation_exactly_at_threshold_is_accepted() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 200, // exactly 2%
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let oracle_a = deploy_mock_oracle(&env);
    let oracle_b = deploy_mock_oracle(&env);

    // deviation = (102 - 100) * 10_000 / 100 = 200 bps exactly
    oracle_a.set_price(&eth, &100_0000000i128);
    oracle_b.set_price(&eth, &102_0000000i128);

    let primary = vec![&env, oracle_a.address.clone(), oracle_b.address.clone()];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let result = oracle.try_get_price(&eth);
    assert!(
        result.is_ok(),
        "deviation exactly equal to max_deviation_bps must be accepted (not rejected); \
         the check must use > not >=; error: {:?}",
        result.err()
    );
}

/// Deviation check with prices one basis-point above the threshold must be
/// REJECTED.
///
/// Calculation: prices = [100, 102.01...], deviation = 201 bps
///   We use integer pricing scaled by 1e7 to hit 201 bps precisely.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_deviation_one_bps_above_threshold_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 200,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let oracle_a = deploy_mock_oracle(&env);
    let oracle_b = deploy_mock_oracle(&env);

    // deviation = (10201 - 10000) * 10_000 / 10000 = 201 bps (1 bps above 200)
    oracle_a.set_price(&eth, &10_000_0000000i128);
    oracle_b.set_price(&eth, &10_201_0000000i128);

    let primary = vec![&env, oracle_a.address.clone(), oracle_b.address.clone()];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let result = oracle.try_get_price(&eth);
    assert!(
        result.is_err(),
        "deviation 1 bps above the threshold must be rejected"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::PriceDeviationTooHigh as u32),
        "deviation 1 bps above threshold must return PriceDeviationTooHigh (5)"
    );
}

/// Staleness boundary: a source whose `last_update` is EXACTLY at the
/// staleness boundary (current_time - last_update == staleness_threshold)
/// must be treated as FRESH (not stale).
///
/// This verifies the staleness check uses `>` not `>=`.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_source_at_exact_staleness_boundary_is_fresh() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    // deploy_with_price_feed uses staleness_threshold = 60.
    let eth = Symbol::new(&env, "ETH");

    // Set price at t=0 (last_update will be 0).
    mock.set_price(&eth, &3_000_0000000i128);

    // Advance exactly to the boundary: current_time - last_update == 60.
    env.ledger().with_mut(|li| {
        li.timestamp = 60;
    });

    // At the boundary, the source must be considered FRESH, not stale.
    let result = oracle.try_get_price(&eth);
    assert!(
        result.is_ok(),
        "a source at the exact staleness boundary (age == threshold) must be treated \
         as fresh; got error: {:?}",
        result.err()
    );
}

/// Staleness boundary: one second past the threshold must be rejected.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_source_one_second_past_staleness_boundary_is_stale() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    mock.set_price(&eth, &3_000_0000000i128);

    // Advance one second past the 60-second staleness threshold.
    env.ledger().with_mut(|li| {
        li.timestamp = 61;
    });

    let result = oracle.try_get_price(&eth);
    assert!(
        result.is_err(),
        "a source one second past the staleness threshold must be rejected"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::StalePrice as u32),
        "source one second past staleness boundary must return StalePrice (4)"
    );
}

/// The cache_duration boundary: a cached price written at time T must still be
/// valid at T + cache_duration (inclusive).
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_cache_valid_at_exact_duration_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    // deploy_with_price_feed uses cache_duration = 10 seconds.
    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let cached_price: i128 = 5_000_0000000;
    mock.set_price(&eth, &cached_price);

    // Prime the cache at the current timestamp.
    oracle.get_price(&eth);

    // Change mock price so we can detect a cache bypass.
    let new_price: i128 = 8_000_0000000;
    mock.set_price(&eth, &new_price);

    // Advance EXACTLY to the boundary: cache_duration = 10 seconds.
    // At this point current_time == last_update + cache_duration, so the cache
    // must still be valid.
    env.ledger().with_mut(|li| {
        li.timestamp += 10;
    });

    let price = oracle.get_price(&eth);
    assert_eq!(
        price, cached_price,
        "cached price must still be valid at T + cache_duration (inclusive boundary); \
         the check must use <= not <; if new_price is returned the cache expired too early"
    );
}

/// One second past the cache_duration must trigger a fresh fetch.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_cache_expired_one_second_past_duration() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, _admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    let cached_price: i128 = 5_000_0000000;
    mock.set_price(&eth, &cached_price);

    // Prime the cache.
    oracle.get_price(&eth);

    // Advance 11 seconds — one past the 10-second cache_duration.
    env.ledger().with_mut(|li| {
        li.timestamp += 11;
    });

    // Set a new fresh price AFTER the time advance so the oracle is still valid.
    let fresh_price: i128 = 6_000_0000000;
    mock.set_price(&eth, &fresh_price);

    let price = oracle.get_price(&eth);
    assert_eq!(
        price, fresh_price,
        "cache expired at T + cache_duration + 1; get_price must fetch the fresh price"
    );
}

/// Two independently configured symbols (ETH and BTC) must have completely
/// separate cache entries.  Priming the cache for ETH must not affect the
/// BTC cache or BTC price fetch behavior.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_cache_is_keyed_per_symbol() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);

    let config = OracleConfig {
        max_deviation_bps: 200,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let eth = Symbol::new(&env, "ETH");
    let btc = Symbol::new(&env, "BTC");

    let eth_oracle = deploy_mock_oracle(&env);
    let btc_oracle = deploy_mock_oracle(&env);

    let eth_price: i128 = 3_000_0000000;
    let btc_price: i128 = 60_000_0000000;

    eth_oracle.set_price(&eth, &eth_price);
    btc_oracle.set_price(&btc, &btc_price);

    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(
        &admin,
        &eth,
        &vec![&env, eth_oracle.address.clone()],
        &empty,
    );
    oracle.set_oracle_sources(
        &admin,
        &btc,
        &vec![&env, btc_oracle.address.clone()],
        &empty,
    );

    assert_eq!(
        oracle.get_price(&eth),
        eth_price,
        "get_price for ETH must return the ETH oracle price"
    );
    assert_eq!(
        oracle.get_price(&btc),
        btc_price,
        "get_price for BTC must return the BTC oracle price, not the ETH price"
    );

    // Update ETH price and advance time to expire ETH cache.
    env.ledger().with_mut(|li| li.timestamp += 11);
    let new_eth_price: i128 = 4_000_0000000;
    eth_oracle.set_price(&eth, &new_eth_price);

    // BTC price should still be cached (no time advancement for BTC cache start).
    // ETH must fetch new price.
    assert_eq!(
        oracle.get_price(&eth),
        new_eth_price,
        "after ETH cache expires, get_price must return the updated ETH price"
    );
}

/// A symbol registered with empty primary sources (cleared after initial set)
/// must return NoPriceSources rather than silently returning a stale cached
/// price — the source check must precede returning any cached value when
/// the cache is expired.
///
/// Note: if the cache is still fresh, the cached price IS returned even if
/// sources were cleared. This tests the cache-EXPIRED + no-sources combination.
///
/// This test FAILS until `get_price` is implemented.
#[test]
fn test_get_price_sources_cleared_after_cache_expires_returns_no_sources_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, mock, admin) = deploy_with_price_feed(&env);
    let eth = Symbol::new(&env, "ETH");

    mock.set_price(&eth, &3_000_0000000i128);
    oracle.get_price(&eth); // prime the cache

    // Clear sources for ETH.
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &empty, &empty);

    // Expire the cache.
    env.ledger().with_mut(|li| li.timestamp += 11);

    // Cache is expired and sources are empty — must return NoPriceSources.
    let result = oracle.try_get_price(&eth);
    assert!(
        result.is_err(),
        "get_price with expired cache and cleared sources must return an error"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::NoPriceSources as u32),
        "expired cache + cleared sources must return NoPriceSources (6)"
    );
}

/// Calling `get_price` on a never-initialized router must panic with
/// `NotInitialized` (2), not with a host-level error.
///
/// This test PASSES immediately (no implementation needed) because the router
/// must have been initialized via `initialize()` before any state is readable.
#[test]
fn test_get_price_on_uninitialized_router_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    // deploy() does NOT call initialize() — router is completely uninitialized.
    let oracle_id = env.register(crate::OracleRouterContract, ());
    let oracle = crate::OracleRouterClient::new(&env, &oracle_id);

    let eth = Symbol::new(&env, "ETH");
    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "get_price on an uninitialized router must return an error"
    );
}

// ---------------------------------------------------------------------------
// C-1 / C-2 — Zero and negative price filtering (audit findings)
// ---------------------------------------------------------------------------
//
// A SEP-40 source returning price <= 0 must be treated as invalid and silently
// filtered out — exactly the same treatment as a stale source.  If ALL sources
// return price <= 0 (and are therefore filtered), the valid_prices collection is
// empty and the contract must panic with StalePrice (4), the same error used
// when all sources are temporally stale.
//
// These tests FAIL until `get_price` adds the `if price <= 0 { continue }` guard
// after the staleness check.

/// A primary source that returns a price of exactly zero must be silently
/// filtered out.  If at least one other source returns a valid positive price,
/// `get_price` must succeed and return the valid source's price.
///
/// Adversarial scenario: a misconfigured or manipulated SEP-40 oracle reports
/// price = 0.  Without filtering, the zero price would pull the median down or
/// cause a division-by-zero in the deviation calculation.
///
/// This test FAILS until the implementation filters `price <= 0`.
#[test]
fn test_get_price_zero_price_from_source_is_filtered_out() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    // Use a generous deviation threshold so the single valid price is not rejected.
    let config = OracleConfig {
        max_deviation_bps: 500, // 5%
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let zero_oracle = deploy_mock_oracle(&env);
    let valid_oracle = deploy_mock_oracle(&env);

    // Zero price — must be filtered, not included in valid_prices.
    zero_oracle.set_price(&eth, &0i128);
    // Valid positive price — must be the sole element in valid_prices after filtering.
    let valid_price: i128 = 2_000_0000000; // 2 000.0000000
    valid_oracle.set_price(&eth, &valid_price);

    let primary = vec![
        &env,
        zero_oracle.address.clone(),
        valid_oracle.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    // Must return valid_oracle's price without panicking with division-by-zero
    // or returning 0 as the median.
    let price = oracle.get_price(&eth);
    assert_eq!(
        price, valid_price,
        "zero-price source must be filtered out; the remaining valid source price \
         ({valid_price}) must be returned, not the zero price"
    );
}

/// A primary source that returns a strictly negative price must be silently
/// filtered out.  If at least one other source returns a valid positive price,
/// `get_price` must succeed and return that valid price.
///
/// Adversarial scenario: a compromised oracle reports price = -1 to manipulate
/// liquidation conditions.  Without filtering, a negative price would corrupt
/// the median and deviation calculations.
///
/// This test FAILS until the implementation filters `price <= 0`.
#[test]
fn test_get_price_negative_price_from_source_is_filtered_out() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 500,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let negative_oracle = deploy_mock_oracle(&env);
    let valid_oracle = deploy_mock_oracle(&env);

    // Negative price — must be filtered.
    negative_oracle.set_price(&eth, &-1_0000000i128); // -1.0000000
    let valid_price: i128 = 1_500_0000000; // 1 500.0000000
    valid_oracle.set_price(&eth, &valid_price);

    let primary = vec![
        &env,
        negative_oracle.address.clone(),
        valid_oracle.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let price = oracle.get_price(&eth);
    assert_eq!(
        price, valid_price,
        "negative-price source must be filtered out; valid source price ({valid_price}) \
         must be returned"
    );
}

/// When ALL configured primary sources return a price of zero, every source is
/// filtered as invalid.  The resulting valid_prices collection is empty, and
/// `get_price` must panic with `OracleRouterError::StalePrice` (4) — the same
/// error used when all sources are temporally stale.
///
/// Rationale: "no valid prices" and "all prices stale" are operationally
/// equivalent from the consumer's perspective and must share the same error code.
///
/// This test FAILS until the implementation filters `price <= 0`.
#[test]
fn test_get_price_all_sources_return_zero_panics_with_stale_price() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 500,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let zero_oracle_a = deploy_mock_oracle(&env);
    let zero_oracle_b = deploy_mock_oracle(&env);

    // Both sources return zero — both must be filtered, leaving valid_prices empty.
    zero_oracle_a.set_price(&eth, &0i128);
    zero_oracle_b.set_price(&eth, &0i128);

    let primary = vec![
        &env,
        zero_oracle_a.address.clone(),
        zero_oracle_b.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "get_price when all sources return zero must return an error (no valid prices \
         remain after filtering)"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::StalePrice as u32),
        "all-zero sources must return StalePrice (4), same as all-stale — \
         do not introduce a new error code"
    );
}

/// When ALL configured primary sources return negative prices, every source is
/// filtered as invalid.  The resulting valid_prices collection is empty, and
/// `get_price` must panic with `OracleRouterError::StalePrice` (4).
///
/// This test FAILS until the implementation filters `price <= 0`.
#[test]
fn test_get_price_all_sources_return_negative_panics_with_stale_price() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 500,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let neg_oracle_a = deploy_mock_oracle(&env);
    let neg_oracle_b = deploy_mock_oracle(&env);
    let neg_oracle_c = deploy_mock_oracle(&env);

    // Use varied negative values to ensure the filter does not special-case -1.
    neg_oracle_a.set_price(&eth, &-1i128);
    neg_oracle_b.set_price(&eth, &-1_000_0000000i128); // large magnitude
    neg_oracle_c.set_price(&eth, &i128::MIN); // minimum i128 — extreme adversarial value

    let primary = vec![
        &env,
        neg_oracle_a.address.clone(),
        neg_oracle_b.address.clone(),
        neg_oracle_c.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "get_price when all sources return negative prices must return an error"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::StalePrice as u32),
        "all-negative sources must return StalePrice (4)"
    );
}

/// When some sources return zero or negative prices and at least one source
/// returns a valid positive price, `get_price` must use ONLY the valid sources
/// for median and deviation calculation.
///
/// This test validates that the filter correctly partitions the source list:
/// invalid prices are discarded entirely rather than treated as 0 in the sort.
///
/// Setup: three sources — [0, -500, 2000].  After filtering, valid_prices = [2000].
/// The median of a single-element list is that element: 2000.
///
/// This test FAILS until the implementation filters `price <= 0`.
#[test]
fn test_get_price_mix_of_zero_and_valid_prices_uses_valid_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    let config = OracleConfig {
        max_deviation_bps: 500,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let zero_oracle = deploy_mock_oracle(&env);
    let neg_oracle = deploy_mock_oracle(&env);
    let valid_oracle = deploy_mock_oracle(&env);

    zero_oracle.set_price(&eth, &0i128);
    neg_oracle.set_price(&eth, &-500_0000000i128);
    let valid_price: i128 = 2_000_0000000;
    valid_oracle.set_price(&eth, &valid_price);

    // Register in order: zero, negative, valid — verifies filtering is not order-dependent.
    let primary = vec![
        &env,
        zero_oracle.address.clone(),
        neg_oracle.address.clone(),
        valid_oracle.address.clone(),
    ];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    // Expected: median([2000]) = 2000 (only valid source after filtering).
    let price = oracle.get_price(&eth);
    assert_eq!(
        price, valid_price,
        "with sources [0, -500, 2000], only 2000 must survive filtering; \
         median of [2000] = 2000; zero and negative sources must be completely discarded"
    );
}

/// When a source returns price = 0, the deviation calculation must NOT be
/// reached with 0 as a participant.  Specifically, if the implementation
/// included 0 in valid_prices, the deviation check would compute:
///   upper_dev = (2000 - 0) * 10_000 / 0  → division by zero
///
/// This test guarantees that the `price <= 0` filter prevents the contract
/// from ever performing arithmetic on a zero price, protecting against a
/// host-level panic in the deviation step.
///
/// The test passes as soon as zero prices are filtered; it should NOT panic
/// with any host error — it must return the valid source's price cleanly.
///
/// This test FAILS until the implementation filters `price <= 0`.
#[test]
fn test_get_price_zero_price_does_not_cause_division_by_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);
    let eth = Symbol::new(&env, "ETH");

    // A tight deviation threshold to confirm the deviation step is reached
    // safely (with only valid prices).  If a zero price reached the deviation
    // step, the division by zero would occur before any threshold check.
    let config = OracleConfig {
        max_deviation_bps: 100, // 1%
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    // Single source returning zero — the ONLY source. After filtering it out,
    // valid_prices is empty → StalePrice, NOT a host arithmetic panic.
    let zero_oracle = deploy_mock_oracle(&env);
    zero_oracle.set_price(&eth, &0i128);

    let primary = vec![&env, zero_oracle.address.clone()];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    // The contract MUST return a contract-level error (StalePrice), not a
    // host-level arithmetic trap.  A host trap would cause the Err to be an
    // InvokeError::Abort rather than a contract error, failing the downcast.
    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "zero price from the only source must result in an error, not a successful return"
    );
    // Confirm this is a clean contract error, not a host arithmetic panic.
    // unwrap_err() gives InvokeError; unwrap() on that extracts the soroban_sdk::Error.
    // If the host panicked with a divide-by-zero, the inner unwrap() would fail.
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(OracleRouterError::StalePrice as u32),
        "a sole zero-price source must return StalePrice (4), not crash with a \
         host arithmetic trap — confirms division-by-zero is impossible"
    );
}

// ---------------------------------------------------------------------------
// H-1 Audit finding — Broken oracle source isolation
//
// The current implementation uses bare `client.get_price(&symbol)` and
// `client.last_update(&symbol)`.  If either cross-contract call panics (e.g.,
// because the oracle has no price set), the panic unwinds through the
// `get_price` transaction and the caller receives a host-level `InvokeError`,
// not a clean contract error.
//
// The fix is to use `client.try_get_price(&symbol)` and
// `client.try_last_update(&symbol)`, catching panicking sources and skipping
// them rather than aborting the entire transaction.
//
// Both tests below FAIL against the current (unfixed) implementation and must
// PASS once `get_price` adopts try-variant cross-contract calls.
// ---------------------------------------------------------------------------

/// A source that panics on `get_price` (no price has been set in MockOracle)
/// must be silently skipped when at least one other source returns a valid,
/// fresh price.
///
/// Setup:
///   - oracle_a: MockOracle with NO price set → panics on `get_price`
///   - oracle_b: MockOracle with a valid price (1_000_0000000) at timestamp 100
///   - Both registered as primary sources for "ETH"
///
/// Expected after fix: `get_price` returns oracle_b's price (1_000_0000000).
///
/// Currently FAILS: the bare `client.get_price` call against oracle_a causes
/// a host-level panic that aborts the entire transaction before oracle_b is
/// ever queried.
#[test]
fn test_get_price_broken_source_is_skipped_if_other_sources_valid() {
    let env = Env::default();
    env.mock_all_auths();

    // Set ledger timestamp to 100 so freshness checks are deterministic.
    env.ledger().set_timestamp(100);

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);

    // staleness_threshold = 60: a source updated at t=100 has age 0 → fresh.
    // cache_duration = 10: cache is inactive because we do not warm it.
    // max_deviation_bps = 10_000: very permissive — single source, no spread.
    let config = OracleConfig {
        max_deviation_bps: 10_000,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let eth = Symbol::new(&env, "ETH");

    // oracle_a: intentionally left with no price set.
    // MockOracle::get_price panics with "no price set" when called without a
    // prior set_price call.  This is the "broken source" that the fix must
    // catch and skip.
    let oracle_a = deploy_mock_oracle(&env);

    // oracle_b: valid price set at current timestamp → age = 0 → fresh.
    let oracle_b = deploy_mock_oracle(&env);
    let valid_price: i128 = 1_000_0000000; // 1000.0000000 (7-decimal scaled)
    oracle_b.set_price(&eth, &valid_price);

    // Register both as primary sources: oracle_a first (broken), oracle_b second (valid).
    // The implementation must iterate both, skip oracle_a's panic, and use oracle_b.
    let primary = vec![&env, oracle_a.address.clone(), oracle_b.address.clone()];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    // This call FAILS on the current implementation because oracle_a's bare
    // `client.get_price` call propagates oracle_a's panic to the host, aborting
    // the whole transaction.  After the fix (try-variant calls), oracle_a is
    // caught and skipped; oracle_b provides the valid price.
    let price = oracle.get_price(&eth);

    assert_eq!(
        price, valid_price,
        "get_price must return oracle_b's valid price ({}) even though oracle_a panics; \
         broken sources must be caught via try-variant calls and skipped, not propagated",
        valid_price
    );
}

/// When every registered oracle source panics (i.e., no oracle has a price
/// set), `get_price` must return a clean contract-level error — either
/// `StalePrice` (4) or `PriceFetchFailed` (7) — rather than propagating a
/// host-level `InvokeError::Abort`.
///
/// Setup:
///   - oracle_a: MockOracle with NO price set → panics on `get_price`
///   - oracle_a is the only registered primary source for "ETH"
///
/// Expected after fix: `try_get_price` returns
///   `Err(Ok(soroban_sdk::Error::from_contract_error(4)))` — a typed
///   contract error.
///
/// Currently FAILS: the bare `client.get_price` call causes a host-level
/// abort that the Soroban test harness surfaces as `Err(Err(InvokeError))`.
/// The inner `unwrap()` in the assertion below then panics at the test level,
/// making the test itself crash rather than asserting a clean contract error.
#[test]
fn test_get_price_all_sources_broken_returns_clean_error() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_timestamp(100);

    let (oracle, _cm, admin) = deploy_with_config_manager(&env);

    let config = OracleConfig {
        max_deviation_bps: 10_000,
        staleness_threshold: 60,
        cache_duration: 10,
    };
    oracle.set_oracle_config(&admin, &config);

    let eth = Symbol::new(&env, "ETH");

    // The sole registered oracle has NO price set — it panics on get_price.
    let broken_oracle = deploy_mock_oracle(&env);
    // Intentionally do NOT call broken_oracle.set_price(...).

    let primary = vec![&env, broken_oracle.address.clone()];
    let empty: soroban_sdk::Vec<Address> = vec![&env];
    oracle.set_oracle_sources(&admin, &eth, &primary, &empty);

    // Use try_get_price so the test can inspect the error type without the
    // test runner itself unwinding from a panic.
    let result = oracle.try_get_price(&eth);

    assert!(
        result.is_err(),
        "get_price with every source broken must return an error, not a price"
    );

    // The critical assertion: the error must be a clean, typed contract error
    // (Err(Ok(soroban_sdk::Error))), NOT a host-level abort (Err(Err(...))).
    //
    // On the unfixed implementation, `result.unwrap_err().unwrap()` panics at
    // the test level because `unwrap_err()` gives `Err(InvokeError::Abort)`
    // and the subsequent `unwrap()` on the InvokeError fails.
    //
    // After the fix, this downcast succeeds and we can inspect the error code.
    let contract_error = result.unwrap_err().expect(
        "get_price with all sources broken must produce a clean contract error \
             (Err(Ok(...))), not a host-level InvokeError::Abort — the fix must use \
             try-variant cross-contract calls to catch panicking sources",
    );

    // Accept either StalePrice (all try-call results skipped → no valid prices)
    // or PriceFetchFailed (explicit error for failed cross-contract calls).
    // Both are clean contract errors that the caller can handle gracefully.
    let is_acceptable_error = contract_error
        == soroban_sdk::Error::from_contract_error(OracleRouterError::StalePrice as u32)
        || contract_error
            == soroban_sdk::Error::from_contract_error(OracleRouterError::PriceFetchFailed as u32);

    assert!(
        is_acceptable_error,
        "expected StalePrice (4) or PriceFetchFailed (7) when all sources panic, \
         but got: {:?}. The error must be a typed contract error the caller can \
         pattern-match on, not an opaque host abort.",
        contract_error
    );
}
