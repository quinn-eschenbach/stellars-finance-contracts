use soroban_sdk::{panic_with_error, Address, Env, Symbol};
use stellar_access::access_control::{
    get_admin as oz_get_admin, grant_role_no_auth as oz_grant_role_no_auth, has_role as oz_has_role,
    revoke_role_no_auth as oz_revoke_role_no_auth, set_admin as oz_set_admin,
};

use crate::{errors::ConfigManagerError, types::roles};

pub use shared::bump_instance_ttl;

/// Panic with `Unauthorized` if `caller` is not the stored admin.
pub fn require_admin(env: &Env, caller: &Address) {
    let admin = match oz_get_admin(env) {
        Some(a) => a,
        None => panic_with_error!(env, ConfigManagerError::Unauthorized),
    };
    if *caller != admin {
        panic_with_error!(env, ConfigManagerError::Unauthorized);
    }
}

/// Require auth from `caller` and verify they are the stored admin.
pub fn require_admin_with_auth(env: &Env, caller: &Address) {
    caller.require_auth();
    require_admin(env, caller);
}

/// Build the admin role `Symbol` for this environment.
pub fn admin_role_symbol(env: &Env) -> Symbol {
    Symbol::new(env, roles::DEFAULT_ADMIN)
}

/// Persist the admin address via OZ AccessControl. Constructor-only.
pub fn init_admin(env: &Env, admin: &Address) {
    oz_set_admin(env, admin);
}

/// Rotate the OZ admin pointer to `new_admin`. OZ's `set_admin` panics if an
/// admin is already set, so the existing slot must be cleared first.
pub fn rotate_admin(env: &Env, new_admin: &Address) {
    env.storage()
        .instance()
        .remove(&stellar_access::access_control::AccessControlStorageKey::Admin);
    oz_set_admin(env, new_admin);
}

/// Read the admin address (returns Err panic if uninitialized).
pub fn load_admin(env: &Env) -> Address {
    oz_get_admin(env)
        .unwrap_or_else(|| panic_with_error!(env, ConfigManagerError::NotInitialized))
}

/// Grant `role` to `account` via OZ. Idempotent: returns early without
/// emitting if the account already holds the role.
pub fn grant_role_internal(env: &Env, role: &Symbol, account: &Address, caller: &Address) {
    oz_grant_role_no_auth(env, account, role, caller);
}

/// Revoke `role` from `account` via OZ. Defensive: returns early if the
/// account does not hold the role, so revocation is idempotent.
pub fn revoke_role_internal(env: &Env, role: &Symbol, account: &Address, caller: &Address) {
    if !has_role_local(env, role, account) {
        return;
    }
    oz_revoke_role_no_auth(env, account, role, caller);
}

/// Returns true if `account` currently holds `role` per OZ AccessControl.
pub fn has_role_local(env: &Env, role: &Symbol, account: &Address) -> bool {
    oz_has_role(env, account, role).is_some()
}
