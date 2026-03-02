#![no_std]

use soroban_sdk::{contracterror, contractclient, panic_with_error, Address, Env, Symbol};

// ---------------------------------------------------------------------------
// TTL constants (single source of truth for all protocol contracts)
// ---------------------------------------------------------------------------

/// 30 days in ledgers — threshold before extending instance storage.
pub const INSTANCE_THRESHOLD: u32 = 30 * 17_280;
/// 31 days in ledgers — target lifetime after extending instance storage.
pub const INSTANCE_BUMP: u32 = 31 * 17_280;

/// 45 days in ledgers — threshold before extending shared persistent storage.
pub const SHARED_THRESHOLD: u32 = 45 * 17_280;
/// 46 days in ledgers — target lifetime after extending shared persistent storage.
pub const SHARED_BUMP: u32 = 46 * 17_280;

/// Extend instance storage TTL to prevent archival.
pub fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

// ---------------------------------------------------------------------------
// Role constants (single source of truth — mirrors ConfigManager's role names)
// ---------------------------------------------------------------------------

/// Ultimate authority — typically a multi-sig or DAO. Can manage all roles.
pub const ROLE_ADMIN: &str = "ADMIN";
/// Authorized to push WASM upgrades to protocol contracts.
pub const ROLE_UPGRADER: &str = "UPGRADER";
/// Authorized to pause/unpause Vault and PositionManager.
pub const ROLE_PAUSER: &str = "PAUSER";
/// Whitelisted keeper bot network for liquidations, ADL, index updates.
pub const ROLE_KEEPER: &str = "KEEPER";

// ---------------------------------------------------------------------------
// Access control — cross-contract role checking via ConfigManager
//
// Uses a minimal contractclient trait (NOT the full config-manager crate) so
// shared has zero dependency on any protocol contract, preventing circular deps.
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SharedError {
    /// Caller does not hold the required role. Discriminant matches every
    /// protocol contract's `Unauthorized = 3` so error codes are consistent.
    Unauthorized = 3,
}

/// Minimal ConfigManager interface — only the has_role selector is needed.
#[contractclient(name = "AccessControlClient")]
pub trait AccessControlInterface {
    fn has_role(env: Env, role: Symbol, account: Address) -> bool;
}

/// Return true if `caller` holds `role` in the given ConfigManager contract.
pub fn has_role(env: &Env, config_manager: &Address, role: &str, caller: &Address) -> bool {
    AccessControlClient::new(env, config_manager).has_role(&Symbol::new(env, role), caller)
}

/// Require `caller` to be authenticated and hold `role` in the given
/// ConfigManager. Panics with `SharedError::Unauthorized` (code 3) on failure.
pub fn require_role(env: &Env, caller: &Address, config_manager: &Address, role: &str) {
    caller.require_auth();
    if !has_role(env, config_manager, role, caller) {
        panic_with_error!(env, SharedError::Unauthorized);
    }
}

// ---------------------------------------------------------------------------
// SEP-40 oracle interface
// ---------------------------------------------------------------------------

/// Standard SEP-40 price oracle interface.
/// Any contract acting as a price source must implement these two selectors.
#[contractclient(name = "Sep40OracleClient")]
pub trait Sep40OracleInterface {
    fn get_price(env: Env, symbol: Symbol) -> i128;
    fn last_update(env: Env, symbol: Symbol) -> u64;
}
