use soroban_sdk::{contractclient, panic_with_error, Address, Env};

use stellar_tokens::vault::Vault;

use crate::errors::VaultError;
use crate::storage;

// ---------------------------------------------------------------------------
// SEP-41 token client for type-safe transfers
// ---------------------------------------------------------------------------

#[contractclient(name = "TokenClient")]
#[allow(dead_code)]
pub trait TokenInterface {
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
}

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

pub fn require_pauser(env: &Env, caller: &Address) {
    let config_mgr = storage::get_config_manager(env);
    shared::require_role(env, caller, &config_mgr, shared::ROLE_PAUSER);
}

pub fn require_admin(env: &Env, caller: &Address) {
    let config_mgr = storage::get_config_manager(env);
    shared::require_role(env, caller, &config_mgr, shared::ROLE_ADMIN);
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
