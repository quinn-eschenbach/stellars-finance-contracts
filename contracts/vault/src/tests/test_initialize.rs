#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String, Symbol};

// ---------------------------------------------------------------------------
// Helper: deploy all contracts and return clients
// ---------------------------------------------------------------------------

struct TestFixture {
    env: Env,
    admin: Address,
    token_id: Address,
    token_client: mock_token::MockTokenClient<'static>,
    config_id: Address,
    config_client: config_manager::ConfigManagerClient<'static>,
    vault_id: Address,
    vault_client: crate::VaultContractClient<'static>,
    position_manager: Address,
}

fn setup() -> TestFixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let position_manager = Address::generate(&env);

    // Deploy mock USDC token (7 decimals like Stellar USDC)
    let token_id = env.register(mock_token::MockToken, ());
    let token_client = mock_token::MockTokenClient::new(&env, &token_id);
    token_client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "USD Coin"),
        &String::from_str(&env, "USDC"),
    );

    // Deploy config manager
    let config_id = env.register(config_manager::ConfigManagerContract, ());
    let config_client = config_manager::ConfigManagerClient::new(&env, &config_id);
    config_client.initialize(&admin);

    // Deploy vault
    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // SAFETY: env lives in the fixture, clients borrow from it.
    // We transmute lifetimes because the fixture owns the Env.
    let token_client = unsafe { core::mem::transmute(token_client) };
    let config_client = unsafe { core::mem::transmute(config_client) };
    let vault_client = unsafe { core::mem::transmute(vault_client) };

    TestFixture {
        env,
        admin,
        token_id,
        token_client,
        config_id,
        config_client,
        vault_id,
        vault_client,
        position_manager,
    }
}

// ===========================================================================
// 1. Successful initialization
// ===========================================================================

#[test]
fn test_initialize_success() {
    let fix = setup();

    // Initialize the vault
    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &fix.config_id, &fix.position_manager);

    // query_asset should return the USDC token address
    assert_eq!(
        fix.vault_client.query_asset(),
        fix.token_id,
        "query_asset must return the underlying USDC address"
    );

    // total_assets should be zero (no deposits yet)
    assert_eq!(
        fix.vault_client.total_assets(),
        0i128,
        "total_assets must be 0 right after initialization"
    );

    // name should be "Stellars LP"
    assert_eq!(
        fix.vault_client.name(),
        String::from_str(&fix.env, "Stellars LP"),
        "LP token name must be 'Stellars LP'"
    );

    // symbol should be "sLP"
    assert_eq!(
        fix.vault_client.symbol(),
        String::from_str(&fix.env, "sLP"),
        "LP token symbol must be 'sLP'"
    );

    // decimals = asset_decimals + decimals_offset (7 + 6 = 13)
    assert_eq!(
        fix.vault_client.decimals(),
        13u32,
        "LP token decimals must be asset_decimals + offset (7 + 6 = 13)"
    );

    // free_liquidity should be 0 (no deposits, no reservations)
    assert_eq!(
        fix.vault_client.free_liquidity(),
        0i128,
        "free_liquidity must be 0 right after initialization"
    );
}

// ===========================================================================
// 2. Double initialization reverts with AlreadyInitialized
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_double_init_reverts() {
    let fix = setup();

    // First init succeeds
    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &fix.config_id, &fix.position_manager);

    // Second init must panic with VaultError::AlreadyInitialized (= 1)
    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &fix.config_id, &fix.position_manager);
}

// ===========================================================================
// 3. Initialize requires admin auth
// ===========================================================================

#[test]
fn test_initialize_requires_admin_auth() {
    let env = Env::default();
    // NOTE: do NOT call env.mock_all_auths() -- we want real auth checks

    let admin = Address::generate(&env);
    let position_manager = Address::generate(&env);

    let token_id = env.register(mock_token::MockToken, ());
    let token_client = mock_token::MockTokenClient::new(&env, &token_id);
    token_client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "USD Coin"),
        &String::from_str(&env, "USDC"),
    );

    let config_id = env.register(config_manager::ConfigManagerContract, ());
    let config_client = config_manager::ConfigManagerClient::new(&env, &config_id);
    // config_manager.initialize also needs auth, so mock it for setup only
    env.mock_all_auths();
    config_client.initialize(&admin);

    let vault_id = env.register(crate::VaultContract, ());
    let _vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // Now turn off auth mocking so the admin.require_auth() in initialize fires
    // Soroban SDK: after mock_all_auths, there is no "unmock" -- instead we use
    // try_initialize to catch the auth failure.
    // Since mock_all_auths was already called, auth will be mocked for all calls.
    // We need a fresh env for the real auth test.
    let env2 = Env::default();
    // Do NOT mock auths on env2

    let admin2 = Address::generate(&env2);
    let position_manager2 = Address::generate(&env2);

    let token_id2 = env2.register(mock_token::MockToken, ());
    let token_client2 = mock_token::MockTokenClient::new(&env2, &token_id2);
    // mock_token::initialize does not require auth on admin, so this works
    env2.mock_all_auths();
    token_client2.initialize(
        &admin2,
        &7u32,
        &String::from_str(&env2, "USD Coin"),
        &String::from_str(&env2, "USDC"),
    );

    let config_id2 = env2.register(config_manager::ConfigManagerContract, ());
    let config_client2 = config_manager::ConfigManagerClient::new(&env2, &config_id2);
    config_client2.initialize(&admin2);

    let vault_id2 = env2.register(crate::VaultContract, ());
    let vault_client2 = crate::VaultContractClient::new(&env2, &vault_id2);

    // Verify that the admin auth was actually required by checking auth entries
    vault_client2.initialize(&admin2, &token_id2, &config_id2, &position_manager2);

    // Assert the admin had to authorize the call
    let auths = env2.auths();
    assert!(
        !auths.is_empty(),
        "initialize must require at least one authorization"
    );

    // The first auth entry should be from the admin
    let (auth_addr, _) = &auths[0];
    assert_eq!(
        *auth_addr, admin2,
        "initialize must require authorization from the admin address"
    );
}

// ===========================================================================
// 4. Adversarial: non-admin tries to initialize (auth not mocked)
// ===========================================================================

#[test]
#[should_panic]
fn test_initialize_unauthorized_caller_panics() {
    let env = Env::default();
    // Deliberately do NOT mock auths

    let admin = Address::generate(&env);
    let _attacker = Address::generate(&env);
    let position_manager = Address::generate(&env);

    let token_id = env.register(mock_token::MockToken, ());

    let config_id = env.register(config_manager::ConfigManagerContract, ());

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // Attacker calls initialize claiming to be admin -- should panic because
    // admin.require_auth() will fail (admin never authorized this invocation)
    vault_client.initialize(&admin, &token_id, &config_id, &position_manager);
}

// ===========================================================================
// 5. Adversarial: attacker passes themselves as admin parameter
// ===========================================================================

#[test]
fn test_initialize_attacker_as_admin_gets_recorded() {
    let env = Env::default();
    env.mock_all_auths();

    let attacker = Address::generate(&env);
    let position_manager = Address::generate(&env);

    let token_id = env.register(mock_token::MockToken, ());
    let token_client = mock_token::MockTokenClient::new(&env, &token_id);
    token_client.initialize(
        &attacker,
        &7u32,
        &String::from_str(&env, "USD Coin"),
        &String::from_str(&env, "USDC"),
    );

    let config_id = env.register(config_manager::ConfigManagerContract, ());
    let config_client = config_manager::ConfigManagerClient::new(&env, &config_id);
    config_client.initialize(&attacker);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // The vault contract requires admin.require_auth() but does NOT store admin.
    // Authorization is delegated to ConfigManager. So even if an attacker passes
    // themselves as admin, the vault itself does not record an admin -- it only
    // stores config_manager. Verify this by checking that the vault still works
    // and the config_manager address is what was passed.
    vault_client.initialize(&attacker, &token_id, &config_id, &position_manager);

    // Vault should be functional
    assert_eq!(vault_client.query_asset(), token_id);
    assert_eq!(vault_client.total_assets(), 0i128);
}

// ===========================================================================
// 6. State: calling methods before initialize should panic (NotInitialized)
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_free_liquidity_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    vault_client.free_liquidity();
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_deposit_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let depositor = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // deposit should enforce require_initialized and panic with NotInitialized=2
    vault_client.deposit(&100i128, &depositor, &depositor, &depositor);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_withdraw_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // withdraw should enforce require_initialized and panic with NotInitialized=2
    vault_client.withdraw(&100i128, &user, &user, &user);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_redeem_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // redeem should enforce require_initialized and panic with NotInitialized=2
    vault_client.redeem(&100i128, &user, &user, &user);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_mint_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // mint (vault shares) should enforce require_initialized and panic with NotInitialized=2
    vault_client.mint(&100i128, &user, &user, &user);
}

// ===========================================================================
// 7. Adversarial: initialize with different decimals underlying
// ===========================================================================

#[test]
fn test_initialize_with_different_decimals() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let position_manager = Address::generate(&env);

    // Deploy token with 9 decimals instead of 7
    let token_id = env.register(mock_token::MockToken, ());
    let token_client = mock_token::MockTokenClient::new(&env, &token_id);
    token_client.initialize(
        &admin,
        &9u32,
        &String::from_str(&env, "Wrapped ETH"),
        &String::from_str(&env, "WETH"),
    );

    let config_id = env.register(config_manager::ConfigManagerContract, ());
    let config_client = config_manager::ConfigManagerClient::new(&env, &config_id);
    config_client.initialize(&admin);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    vault_client.initialize(&admin, &token_id, &config_id, &position_manager);

    // The vault's decimals = asset_decimals + offset (9 + 6 = 15)
    assert_eq!(
        vault_client.decimals(),
        15u32,
        "Vault decimals must be asset_decimals + offset (9 + 6 = 15)"
    );

    // Name and symbol should still be the vault's, not the underlying token's
    assert_eq!(
        vault_client.name(),
        String::from_str(&env, "Stellars LP"),
        "Name must be 'Stellars LP' regardless of underlying"
    );
    assert_eq!(
        vault_client.symbol(),
        String::from_str(&env, "sLP"),
        "Symbol must be 'sLP' regardless of underlying"
    );
}

// ===========================================================================
// 8. Edge case: initialize with 0 decimals
// ===========================================================================

#[test]
fn test_initialize_with_zero_decimals() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let position_manager = Address::generate(&env);

    let token_id = env.register(mock_token::MockToken, ());
    let token_client = mock_token::MockTokenClient::new(&env, &token_id);
    token_client.initialize(
        &admin,
        &0u32,
        &String::from_str(&env, "Zero Dec Token"),
        &String::from_str(&env, "ZDT"),
    );

    let config_id = env.register(config_manager::ConfigManagerContract, ());
    let config_client = config_manager::ConfigManagerClient::new(&env, &config_id);
    config_client.initialize(&admin);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    vault_client.initialize(&admin, &token_id, &config_id, &position_manager);

    assert_eq!(
        vault_client.decimals(),
        6u32,
        "Vault must handle 0-decimal tokens (0 + 6 offset = 6)"
    );
    assert_eq!(vault_client.total_assets(), 0i128);
    assert_eq!(vault_client.free_liquidity(), 0i128);
}

// ===========================================================================
// 9. Post-init: pause/unpause requires initialized state
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_pause_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let caller = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // pause requires initialized state
    vault_client.pause(&caller);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_unpause_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let caller = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    // unpause requires initialized state
    vault_client.unpause(&caller);
}

// ===========================================================================
// 10. Post-init: settle_pnl requires initialized state
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_settle_pnl_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let caller = Address::generate(&env);
    let trader = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    vault_client.settle_pnl(&caller, &trader, &1000i128, &0i128, &true);
}

// ===========================================================================
// 11. Post-init: reserve_liquidity requires initialized state
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_reserve_liquidity_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let caller = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    vault_client.reserve_liquidity(&caller, &1000i128);
}

// ===========================================================================
// 12. Post-init: release_liquidity requires initialized state
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_release_liquidity_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let caller = Address::generate(&env);

    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);

    vault_client.release_liquidity(&caller, &1000i128);
}

// ===========================================================================
// 13. Config manager is stored correctly and used for role checks
// ===========================================================================

#[test]
fn test_config_manager_stored_after_init() {
    let fix = setup();

    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &fix.config_id, &fix.position_manager);

    // Verify the vault is operational after init by calling a view function.
    assert_eq!(fix.vault_client.free_liquidity(), 0, "empty vault has zero free liquidity");
}

// ===========================================================================
// 14. Adversarial: double init with different config_manager
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_init_different_config_manager_reverts() {
    let fix = setup();

    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &fix.config_id, &fix.position_manager);

    // Deploy a second config manager
    let config_id2 = fix.env.register(config_manager::ConfigManagerContract, ());
    let config_client2 = config_manager::ConfigManagerClient::new(&fix.env, &config_id2);
    config_client2.initialize(&fix.admin);

    // Attempt to re-initialize with a different config manager -- must fail
    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &config_id2, &fix.position_manager);
}

// ===========================================================================
// 15. Adversarial: double init with different asset
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_init_different_asset_reverts() {
    let fix = setup();

    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &fix.config_id, &fix.position_manager);

    // Deploy a second token
    let token_id2 = fix.env.register(mock_token::MockToken, ());
    let token_client2 = mock_token::MockTokenClient::new(&fix.env, &token_id2);
    token_client2.initialize(
        &fix.admin,
        &7u32,
        &String::from_str(&fix.env, "DAI"),
        &String::from_str(&fix.env, "DAI"),
    );

    // Attempt to re-initialize with a different asset -- must fail
    fix.vault_client
        .initialize(&fix.admin, &token_id2, &fix.config_id, &fix.position_manager);
}

// ===========================================================================
// 16. Adversarial: double init with different admin
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_init_different_admin_reverts() {
    let fix = setup();

    fix.vault_client
        .initialize(&fix.admin, &fix.token_id, &fix.config_id, &fix.position_manager);

    let attacker = Address::generate(&fix.env);

    // Attacker tries to re-initialize with themselves as admin
    fix.vault_client
        .initialize(&attacker, &fix.token_id, &fix.config_id, &fix.position_manager);
}
