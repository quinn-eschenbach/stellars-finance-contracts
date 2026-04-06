//! Tests for F-11: upgrade / migrate authorization.
//!
//! Covers:
//!   - upgrade: address without UPGRADER role is rejected (F-11-a)
//!   - upgrade: auth is required — no mock means panic (F-11-b)
//!   - _migrate: writes StorageKey::Version to instance storage (F-11-c)
//!   - migrate: calling without prior upgrade (no MIGRATING flag) errors (F-11-d)
//!   - migrate: with active MIGRATING flag, writes version to storage (F-11-e)
//!   - migrate: auth is required (F-11-f)
//!   - migrate: address without UPGRADER role is rejected (F-11-g)

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, IntoVal};

use crate::{ConfigManagerContract, ConfigManagerError, MigrationData};
use crate::storage::StorageKey;
use stellar_contract_utils::upgradeable::{UpgradeableClient, UpgradeableMigratableInternal};

use super::helpers::{deploy_initialized, role_upgrader};

/// F-11-a: An address without UPGRADER role calling `upgrade` must be rejected with Unauthorized (3).
#[test]
fn test_upgrade_without_upgrader_role_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (config_client, _admin) = deploy_initialized(&env);
    let non_upgrader = Address::generate(&env);

    let upgrade_client = UpgradeableClient::new(&env, &config_client.address);
    let dummy_hash: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);

    let result = upgrade_client.try_upgrade(&dummy_hash, &non_upgrader);
    assert!(
        result.is_err(),
        "F-11-a: upgrade from an address without UPGRADER role must return an error"
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        soroban_sdk::Error::from_contract_error(ConfigManagerError::Unauthorized as u32),
        "F-11-a: error code must be Unauthorized (3)"
    );
}

/// F-11-b: Calling upgrade without any mocked auth must panic — `operator.require_auth()` is called.
#[test]
#[should_panic]
fn test_upgrade_requires_caller_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let (config_client, admin) = deploy_initialized(&env);
    let upgrader = Address::generate(&env);

    let upgrader_role = role_upgrader(&env);
    config_client.grant_role(&admin, &upgrader_role, &upgrader);

    // Clear auth — operator.require_auth() must panic.
    env.mock_auths(&[]);

    let upgrade_client = UpgradeableClient::new(&env, &config_client.address);
    let dummy_hash: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
    upgrade_client.upgrade(&dummy_hash, &upgrader);
}

/// F-11-c: `_migrate` writes `StorageKey::Version` to instance storage.
#[test]
fn test_migrate_writes_version_to_storage() {
    let env = Env::default();
    let contract_id = env.register(ConfigManagerContract, ());
    let migration_data = MigrationData { version: 2 };

    env.as_contract(&contract_id, || {
        ConfigManagerContract::_migrate(&env, &migration_data);

        let stored_version: Option<u32> = env.storage().instance().get(&StorageKey::Version);
        assert_eq!(
            stored_version,
            Some(2),
            "F-11-c: _migrate must write version = 2 to StorageKey::Version"
        );
    });
}

/// F-11-d: Calling `migrate` without prior `upgrade` (no MIGRATING flag) must fail.
#[test]
fn test_migrate_without_prior_upgrade_errors() {
    let env = Env::default();
    env.mock_all_auths();
    let (config_client, admin) = deploy_initialized(&env);
    let upgrader = Address::generate(&env);

    config_client.grant_role(&admin, &role_upgrader(&env), &upgrader);

    let migration_data = MigrationData { version: 2 };
    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        &config_client.address,
        &soroban_sdk::Symbol::new(&env, "migrate"),
        (migration_data, upgrader).into_val(&env),
    );
    assert!(
        result.is_err(),
        "F-11-d: migrate without prior upgrade must fail (MigrationNotAllowed)"
    );
}

/// F-11-e: With MIGRATING flag active, `migrate` writes version to storage.
#[test]
fn test_migrate_with_active_migration_flag_writes_version() {
    use stellar_contract_utils::upgradeable::enable_migration;

    let env = Env::default();
    env.mock_all_auths();
    let (config_client, admin) = deploy_initialized(&env);
    let upgrader = Address::generate(&env);

    config_client.grant_role(&admin, &role_upgrader(&env), &upgrader);

    // Simulate a successful upgrade by manually setting the MIGRATING flag.
    env.as_contract(&config_client.address, || {
        enable_migration(&env);
    });

    let migration_data = MigrationData { version: 7 };
    env.invoke_contract::<()>(
        &config_client.address,
        &soroban_sdk::Symbol::new(&env, "migrate"),
        (migration_data, upgrader).into_val(&env),
    );

    env.as_contract(&config_client.address, || {
        let stored_version: Option<u32> = env.storage().instance().get(&StorageKey::Version);
        assert_eq!(
            stored_version,
            Some(7),
            "F-11-e: migrate must write version = 7 to StorageKey::Version"
        );
    });
}

/// F-11-f: Calling `migrate` without mocked auth must panic — `operator.require_auth()` is called.
#[test]
#[should_panic]
fn test_migrate_requires_caller_auth() {
    use stellar_contract_utils::upgradeable::enable_migration;

    let env = Env::default();
    env.mock_all_auths();
    let (config_client, admin) = deploy_initialized(&env);
    let upgrader = Address::generate(&env);

    config_client.grant_role(&admin, &role_upgrader(&env), &upgrader);

    env.as_contract(&config_client.address, || {
        enable_migration(&env);
    });

    // Clear auth — operator.require_auth() must panic.
    env.mock_auths(&[]);

    let migration_data = MigrationData { version: 3 };
    env.invoke_contract::<()>(
        &config_client.address,
        &soroban_sdk::Symbol::new(&env, "migrate"),
        (migration_data, upgrader).into_val(&env),
    );
}

/// F-11-g: An address without UPGRADER role calling `migrate` (MIGRATING flag active) must error.
#[test]
fn test_migrate_without_upgrader_role_errors() {
    use stellar_contract_utils::upgradeable::enable_migration;

    let env = Env::default();
    env.mock_all_auths();
    let (config_client, _admin) = deploy_initialized(&env);
    let non_upgrader = Address::generate(&env);

    env.as_contract(&config_client.address, || {
        enable_migration(&env);
    });

    let migration_data = MigrationData { version: 5 };
    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        &config_client.address,
        &soroban_sdk::Symbol::new(&env, "migrate"),
        (migration_data, non_upgrader).into_val(&env),
    );
    assert!(
        result.is_err(),
        "F-11-g: migrate from an address without UPGRADER role must return an error"
    );
}
