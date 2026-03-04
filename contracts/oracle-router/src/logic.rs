use shared::{bump_instance_ttl, Sep40OracleClient, ROLE_ADMIN, ROLE_UPGRADER};
use soroban_sdk::{panic_with_error, Address, Env, Symbol, Vec};

use crate::errors::OracleRouterError;
use crate::storage;
use crate::types::{CachedPrice, OracleConfig};

/// Require that `caller` holds the "ADMIN" role in the linked ConfigManager.
pub fn require_oracle_admin(env: &Env, caller: &Address) {
    let cm = storage::load_config_manager(env);
    shared::require_role(env, caller, &cm, ROLE_ADMIN);
}

/// Require that `caller` holds the "UPGRADER" role in the linked ConfigManager.
pub fn require_upgrader(env: &Env, caller: &Address) {
    let cm = storage::load_config_manager(env);
    shared::require_role(env, caller, &cm, ROLE_UPGRADER);
}

/// Validate OracleConfig fields — all must be strictly positive.
pub fn validate_oracle_config(env: &Env, config: &OracleConfig) {
    if config.max_deviation_bps <= 0 || config.staleness_threshold == 0 || config.cache_duration == 0 {
        panic_with_error!(env, OracleRouterError::InvalidConfig);
    }
    // Cache must not outlive the staleness window, otherwise stale prices can be served from cache
    if config.cache_duration > config.staleness_threshold {
        panic_with_error!(env, OracleRouterError::InvalidConfig);
    }
}

/// Query a list of oracle sources, filtering stale, broken, and invalid prices.
///
/// Uses try-variants for cross-contract calls so a broken source is skipped
/// instead of aborting the entire transaction.
pub fn query_sources(
    env: &Env,
    sources: &Vec<Address>,
    symbol: &Symbol,
    config: &OracleConfig,
    current_time: u64,
) -> Vec<i128> {
    let mut valid_prices: Vec<i128> = Vec::new(env);
    for source in sources.iter() {
        let client = Sep40OracleClient::new(env, &source);
        let price = match client.try_get_price(symbol) {
            Ok(Ok(p)) => p,
            _ => continue,
        };
        let last_update = match client.try_last_update(symbol) {
            Ok(Ok(ts)) => ts,
            _ => continue,
        };
        if current_time.saturating_sub(last_update) > config.staleness_threshold || price <= 0 {
            continue;
        }
        valid_prices.push_back(price);
    }
    valid_prices
}

/// Full price fetch: query primaries, fall back to secondaries, compute and
/// validate the median, write cache, return.
pub fn fetch_and_validate_price(env: &Env, symbol: Symbol) -> i128 {
    let config = storage::load_oracle_config(env);
    let current_time = env.ledger().timestamp();

    // Cache hit — return immediately without querying sources.
    if let Some(entry) = storage::load_cached_price(env, &symbol) {
        if current_time <= entry.last_update + config.cache_duration {
            return entry.price;
        }
    }

    let primaries = storage::load_primary_sources(env, &symbol);
    if primaries.is_empty() {
        panic_with_error!(env, OracleRouterError::NoPriceSources);
    }
    let mut valid_prices = query_sources(env, &primaries, &symbol, &config, current_time);

    // Fall back to secondaries if all primaries failed.
    if valid_prices.is_empty() {
        let secondaries = storage::load_secondary_sources(env, &symbol);
        valid_prices = query_sources(env, &secondaries, &symbol, &config, current_time);
        if valid_prices.is_empty() {
            panic_with_error!(env, OracleRouterError::StalePrice);
        }
    }

    crate::math::insertion_sort(&mut valid_prices);

    let n = valid_prices.len();
    let median = valid_prices.get(crate::math::median_idx(n)).unwrap();
    let dev = crate::math::deviation_bps(
        median,
        valid_prices.get(0).unwrap(),
        valid_prices.get(n - 1).unwrap(),
    );
    if dev > config.max_deviation_bps {
        panic_with_error!(env, OracleRouterError::PriceDeviationTooHigh);
    }

    storage::save_cached_price(env, &symbol, CachedPrice { price: median, last_update: current_time });
    bump_instance_ttl(env);

    median
}

/// Deduplicate an address list, preserving first-occurrence order.
///
/// O(n²) — acceptable because oracle source lists are small (typically 3–10 entries).
pub fn dedup_sources(env: &Env, sources: &Vec<Address>) -> Vec<Address> {
    let mut result: Vec<Address> = Vec::new(env);
    'outer: for addr in sources.iter() {
        for existing in result.iter() {
            if addr == existing {
                continue 'outer;
            }
        }
        result.push_back(addr);
    }
    result
}
