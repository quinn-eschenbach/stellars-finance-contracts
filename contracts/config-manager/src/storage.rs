use soroban_sdk::{contracttype, Address, Symbol};

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
// TTL constants
// ---------------------------------------------------------------------------

/// 30 days in ledgers (used as threshold before extending instance storage).
pub const INSTANCE_THRESHOLD: u32 = 30 * 17_280;
/// 31 days in ledgers (target lifetime after extending instance storage).
pub const INSTANCE_BUMP: u32 = 31 * 17_280;

/// 45 days in ledgers (used as threshold before extending persistent storage).
pub const SHARED_THRESHOLD: u32 = 45 * 17_280;
/// 46 days in ledgers (target lifetime after extending persistent storage).
pub const SHARED_BUMP: u32 = 46 * 17_280;
