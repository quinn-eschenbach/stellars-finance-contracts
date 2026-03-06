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
// Protocol default constants (used by ConfigManager::initialize)
// ---------------------------------------------------------------------------

/// Default keeper fee share: 5% (500 bps).
pub const DEFAULT_KEEPER_BPS: u32 = 500;
/// Default dev/treasury fee share: 5% (500 bps).
pub const DEFAULT_DEV_BPS: u32 = 500;
/// Default LP fee share: 90% (9000 bps).
pub const DEFAULT_LP_BPS: u32 = 9_000;

/// Default minimum collateral: $1 USDC at 1e7 precision.
pub const DEFAULT_MIN_COLLATERAL: i128 = 10_000_000;
/// Default cooldown between vault deposit and withdrawal: 5 minutes.
pub const DEFAULT_COOLDOWN_DURATION: u64 = 300;
/// Default minimum position lifetime: 60 seconds.
pub const DEFAULT_MIN_POSITION_LIFETIME: u64 = 60;
/// Default max vault utilization: 85% (8500 bps).
pub const DEFAULT_MAX_UTILIZATION_RATIO: i128 = 8_500;
/// Default protocol cut of positive funding fees: 5% (500 bps).
pub const DEFAULT_FUNDING_CUT_BPS: u32 = 500;
/// Default ADL trigger: net PnL / total assets threshold: 90% (9000 bps).
pub const DEFAULT_ADL_PNL_BPS: u32 = 9_000;
/// Default ADL trigger: utilization threshold: 95% (9500 bps).
pub const DEFAULT_ADL_UTILIZATION_BPS: u32 = 9_500;

/// Default base borrow rate: 1% annualized (100 bps).
pub const DEFAULT_BASE_BORROW_RATE_BPS: i128 = 100;
/// Default borrow rate slope below optimal utilization: 5% (500 bps).
pub const DEFAULT_SLOPE1_BPS: i128 = 500;
/// Default borrow rate slope above optimal utilization: 50% (5000 bps).
pub const DEFAULT_SLOPE2_BPS: i128 = 5_000;
/// Default optimal utilization breakpoint: 80% (8000 bps).
pub const DEFAULT_OPTIMAL_UTILIZATION_BPS: i128 = 8_000;
/// Default base funding rate: 1% annualized (100 bps).
pub const DEFAULT_BASE_FUNDING_RATE_BPS: i128 = 100;

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
