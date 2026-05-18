//! Unrealized PnL accounting. Single writer of `MarketUnrealizedPnl(symbol)`
//! and `TotalUnrealizedPnl`, and the only path that syncs the global
//! unrealized PnL to the Vault — which `Vault.free_liquidity` uses to bound
//! LP-claimable funds against open trader winnings.
//!
//! Every Close path and `update_indices` calls [`refresh_market_unrealized_pnl`]
//! after the market's OI / avg / mark price has settled. `RealizedPnl` is
//! tracked separately for ADL / off-chain reporting; it is NOT sent to the
//! Vault, because realized winnings have already moved USDC at close time
//! (via `vault.pay_profit` / `vault.record_absorbed_collateral`) and are
//! reflected directly in `total_assets`.

use soroban_sdk::{Env, Symbol};

use interfaces::VaultClient;

use crate::events;
use crate::math;
use crate::storage;

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

    let vault_addr = storage::get_vault_address(env);
    let vault = VaultClient::new(env, &vault_addr);
    let contract_addr = env.current_contract_address();
    vault.update_net_pnl(&contract_addr, &new_total);
}
