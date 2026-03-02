use soroban_sdk::{contracttype, panic_with_error, Address, Env, Symbol};

use crate::errors::ConfigManagerError;
use crate::types::{FeeSplits, ProtocolLimits};

/// Composite key for role membership entries.
#[contracttype]
#[derive(Clone)]
pub struct RoleMemberKey {
    pub role: Symbol,
    pub account: Address,
}

#[contracttype]
pub enum StorageKey {
    /// Initialization flag — set to `true` after `initialize` succeeds.
    Initialized,
    /// The admin address stored in instance storage.
    Admin,
    /// Role membership: `RoleMemberKey { role, account } -> bool`.
    RoleMember(RoleMemberKey),
    /// Fee split configuration.
    FeeSplits,
    /// Deposit fee in basis points.
    DepositFee,
    /// Protocol risk and timing limits (single struct replaces four separate keys).
    ProtocolLimits,
    /// Current contract version (written by migration).
    Version,
}

// ---------------------------------------------------------------------------
// TTL constants — single source of truth lives in the `shared` crate.
// ---------------------------------------------------------------------------
pub use shared::{INSTANCE_BUMP, INSTANCE_THRESHOLD, SHARED_BUMP, SHARED_THRESHOLD};

// ---------------------------------------------------------------------------
// Initialization helpers
// ---------------------------------------------------------------------------

pub fn check_not_initialized(env: &Env) {
    if env
        .storage()
        .instance()
        .get::<_, bool>(&StorageKey::Initialized)
        .unwrap_or(false)
    {
        panic_with_error!(env, ConfigManagerError::AlreadyInitialized);
    }
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&StorageKey::Initialized, &true);
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

pub fn set_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&StorageKey::Admin, addr);
}

// ---------------------------------------------------------------------------
// FeeSplits helpers
// ---------------------------------------------------------------------------

pub fn load_fee_splits(env: &Env) -> FeeSplits {
    env.storage()
        .instance()
        .get(&StorageKey::FeeSplits)
        .unwrap_or_else(|| panic_with_error!(env, ConfigManagerError::NotInitialized))
}

pub fn save_fee_splits(env: &Env, fee_splits: &FeeSplits) {
    env.storage()
        .instance()
        .set(&StorageKey::FeeSplits, fee_splits);
}

// ---------------------------------------------------------------------------
// ProtocolLimits helpers
// ---------------------------------------------------------------------------

pub fn load_protocol_limits(env: &Env) -> ProtocolLimits {
    env.storage()
        .instance()
        .get(&StorageKey::ProtocolLimits)
        .unwrap_or_else(|| panic_with_error!(env, ConfigManagerError::NotInitialized))
}

pub fn save_protocol_limits(env: &Env, limits: &ProtocolLimits) {
    env.storage()
        .instance()
        .set(&StorageKey::ProtocolLimits, limits);
}

// ---------------------------------------------------------------------------
// DepositFee helpers
// ---------------------------------------------------------------------------

pub fn load_deposit_fee(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&StorageKey::DepositFee)
        .unwrap_or(0)
}

pub fn save_deposit_fee(env: &Env, fee_bps: i128) {
    env.storage()
        .instance()
        .set(&StorageKey::DepositFee, &fee_bps);
}

// ---------------------------------------------------------------------------
// Version helper
// ---------------------------------------------------------------------------

pub fn save_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&StorageKey::Version, &version);
}
