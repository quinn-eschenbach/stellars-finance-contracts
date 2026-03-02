use soroban_sdk::{panic_with_error, Address, Env, Symbol};

use crate::{
    errors::ConfigManagerError,
    storage::{RoleMemberKey, StorageKey, SHARED_BUMP, SHARED_THRESHOLD},
    types::roles,
};

pub use shared::bump_instance_ttl;

/// Read the stored admin address from instance storage.
/// Returns `None` if the contract is not yet initialized.
fn read_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&StorageKey::Admin)
}

/// Panic with `Unauthorized` if `caller` is not the stored admin.
pub fn require_admin(env: &Env, caller: &Address) {
    let admin = match read_admin(env) {
        Some(a) => a,
        None => panic_with_error!(env, ConfigManagerError::Unauthorized),
    };
    if *caller != admin {
        panic_with_error!(env, ConfigManagerError::Unauthorized);
    }
}

/// Require auth from `caller` and verify they are the stored admin.
/// Replaces the repeated `caller.require_auth(); require_admin(env, caller)` pattern.
pub fn require_admin_with_auth(env: &Env, caller: &Address) {
    caller.require_auth();
    require_admin(env, caller);
}

/// Build the admin role `Symbol` for this environment.
/// Centralises the repeated `Symbol::new(env, roles::DEFAULT_ADMIN)` call.
pub fn admin_role_symbol(env: &Env) -> Symbol {
    Symbol::new(env, roles::DEFAULT_ADMIN)
}

fn bump_role_member_ttl(env: &Env, key: &StorageKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, SHARED_THRESHOLD, SHARED_BUMP);
}

/// Build the persistent storage key for a `(role, account)` membership entry.
fn make_role_key(role: &Symbol, account: &Address) -> StorageKey {
    StorageKey::RoleMember(RoleMemberKey {
        role: role.clone(),
        account: account.clone(),
    })
}

/// Write role membership to persistent storage and bump its TTL.
pub fn set_role_member(env: &Env, role: &Symbol, account: &Address, value: bool) {
    let key = make_role_key(role, account);
    env.storage().persistent().set(&key, &value);
    bump_role_member_ttl(env, &key);
}

/// Read role membership from persistent storage.
/// Bumps TTL on read so active roles never silently expire.
/// Returns `false` when the key is absent.
pub fn get_role_member(env: &Env, role: &Symbol, account: &Address) -> bool {
    let key = make_role_key(role, account);
    let has = env.storage().persistent().get(&key).unwrap_or(false);
    if has {
        bump_role_member_ttl(env, &key);
    }
    has
}

/// Remove a role membership entry from persistent storage (idempotent).
pub fn remove_role_member(env: &Env, role: &Symbol, account: &Address) {
    let key = make_role_key(role, account);
    env.storage().persistent().remove(&key);
}
