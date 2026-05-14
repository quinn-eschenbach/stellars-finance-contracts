use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};

use interfaces::ConfigManagerClient;
use stellar_tokens::vault::Vault;

use crate::errors::VaultError;
use crate::storage;

// ---------------------------------------------------------------------------
// Initialization guards
// ---------------------------------------------------------------------------

pub fn require_initialized(env: &Env) {
    if !storage::is_initialized(env) {
        panic_with_error!(env, VaultError::NotInitialized);
    }
}

pub fn require_not_initialized(env: &Env) {
    if storage::is_initialized(env) {
        panic_with_error!(env, VaultError::AlreadyInitialized);
    }
}

// ---------------------------------------------------------------------------
// Pause guards
// ---------------------------------------------------------------------------

pub fn require_not_paused(env: &Env) {
    if storage::get_paused(env) {
        panic_with_error!(env, VaultError::Paused);
    }
}

// ---------------------------------------------------------------------------
// Role guards (via ConfigManager cross-contract call)
// ---------------------------------------------------------------------------

/// Cross-contract role check + per-contract panic. Panics with
/// `VaultError::Unauthorized` (code 5) on failure so the panic code
/// identifies the source contract.
fn require_role_or_panic(env: &Env, caller: &Address, role: &str) {
    caller.require_auth();
    let config_mgr = storage::get_config_manager(env);
    if !shared::has_role(env, &config_mgr, role, caller) {
        panic_with_error!(env, VaultError::Unauthorized);
    }
}

pub fn require_pauser(env: &Env, caller: &Address) {
    require_role_or_panic(env, caller, shared::constants::ROLE_PAUSER);
}

pub fn require_admin(env: &Env, caller: &Address) {
    require_role_or_panic(env, caller, shared::constants::ROLE_ADMIN);
}

pub fn require_upgrader(env: &Env, caller: &Address) {
    require_role_or_panic(env, caller, shared::constants::ROLE_UPGRADER);
}

// ---------------------------------------------------------------------------
// Lockup guard
// ---------------------------------------------------------------------------

/// Compute lockup expiry as `now + cooldown_duration` (read from ConfigManager)
/// and persist it for `user`. Emits a `Lockup` event.
pub fn record_lockup(env: &Env, user: &Address) {
    let config_mgr = storage::get_config_manager(env);
    let limits = ConfigManagerClient::new(env, &config_mgr).get_protocol_limits();
    let now = env.ledger().timestamp();
    let expires_at = now + limits.cooldown_duration;
    storage::set_lockup_expires_at(env, user, expires_at);
    crate::events::Lockup { user: user.clone(), expires_at }.publish(env);
}

/// Panics with `CooldownNotElapsed` if `now < stored_expiry`. Users without
/// a stored expiry (never deposited) bypass the check.
pub fn require_lockup_elapsed(env: &Env, user: &Address) {
    if let Some(expiry) = storage::get_lockup_expires_at(env, user) {
        let now = env.ledger().timestamp();
        if now < expiry {
            panic_with_error!(env, VaultError::CooldownNotElapsed);
        }
    }
}

/// Inherit `from`'s remaining lockup to `to` on share transfers, taking the
/// max of `to`'s existing expiry and `from`'s expiry. Without this, an LP
/// could deposit, immediately transfer their LP shares to a fresh address,
/// and the recipient could withdraw without observing the cooldown.
pub fn propagate_lockup_on_transfer(env: &Env, from: &Address, to: &Address) {
    let from_expiry = storage::get_lockup_expires_at(env, from).unwrap_or(0);
    if from_expiry == 0 {
        return;
    }
    let now = env.ledger().timestamp();
    if from_expiry <= now {
        return;
    }
    let to_expiry = storage::get_lockup_expires_at(env, to).unwrap_or(0);
    if from_expiry > to_expiry {
        storage::set_lockup_expires_at(env, to, from_expiry);
        crate::events::Lockup { user: to.clone(), expires_at: from_expiry }.publish(env);
    }
}

// ---------------------------------------------------------------------------
// Position Manager guard
// ---------------------------------------------------------------------------

pub fn require_position_manager(env: &Env, caller: &Address) {
    caller.require_auth();
    let pm = storage::get_position_manager(env);
    if *caller != pm {
        panic_with_error!(env, VaultError::NotPositionManager);
    }
}

// ---------------------------------------------------------------------------
// Free liquidity
// ---------------------------------------------------------------------------

pub fn free_liquidity(env: &Env) -> i128 {
    let total = Vault::total_assets(env);
    let reserved = storage::get_reserved_usdc(env);
    let unclaimed_fees = storage::get_unclaimed_fees(env);
    let net_pnl = storage::get_net_global_trader_pnl(env);
    let pnl_deduction = if net_pnl > 0 { net_pnl } else { 0 };
    let free = total - reserved - unclaimed_fees - pnl_deduction;
    if free < 0 { 0 } else { free }
}

/// Total assets minus only the fee-buffer. PnL is intentionally excluded so
/// mark-price moves cannot feed back into consumers' utilization
/// denominator (PM's utilization gate, in particular). LP withdraw/pay_profit
/// still go through `free_liquidity`, which retains the PnL deduction.
pub fn total_assets_excl_pnl(env: &Env) -> i128 {
    let total = Vault::total_assets(env);
    let unclaimed_fees = storage::get_unclaimed_fees(env);
    let v = total - unclaimed_fees;
    if v < 0 { 0 } else { v }
}

pub fn require_free_liquidity(env: &Env, amount: i128) {
    if amount > free_liquidity(env) {
        panic_with_error!(env, VaultError::InsufficientFreeLiquidity);
    }
}

// ---------------------------------------------------------------------------
// Asset transfers
// ---------------------------------------------------------------------------

pub fn transfer_asset(env: &Env, asset: &Address, from: &Address, to: &Address, amount: i128) {
    TokenClient::new(env, asset).transfer(from, to, &amount);
}
