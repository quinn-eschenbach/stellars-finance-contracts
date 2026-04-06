#![cfg(test)]

//! Comprehensive tests for vault operations: settle_pnl, reserve_liquidity,
//! release_liquidity, pause, unpause, update_net_pnl, accrue_fees, claim_fees.
//!
//! Written in TDD style -- these tests define the *expected* behavior and will
//! fail against incomplete or buggy implementations.

use soroban_sdk::{testutils::Address as _, Address, Env, String, Symbol};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONE_USDC: i128 = 10_000_000; // 1.0000000 (7 decimals)

// ---------------------------------------------------------------------------
// Test Fixture
// ---------------------------------------------------------------------------

struct TestFixture {
    env: Env,
    admin: Address,
    #[allow(dead_code)]
    token_id: Address,
    token_client: mock_token::MockTokenClient<'static>,
    #[allow(dead_code)]
    config_id: Address,
    config_client: config_manager::ConfigManagerClient<'static>,
    vault_id: Address,
    vault_client: crate::VaultContractClient<'static>,
    position_manager: Address,
}

/// Deploy mock-token, config-manager, and vault. Initialize all three.
fn setup() -> TestFixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let position_manager = Address::generate(&env);

    // Deploy mock USDC token (7 decimals)
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

    // Deploy and initialize vault
    let vault_id = env.register(crate::VaultContract, ());
    let vault_client = crate::VaultContractClient::new(&env, &vault_id);
    vault_client.initialize(&admin, &token_id, &config_id, &position_manager);

    // SAFETY: env lives in the fixture, clients borrow from it.
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

/// Seed the vault with USDC by minting directly to the vault address.
/// Also mints LP shares to a depositor via the vault's mint() function
/// so that total_assets and share accounting are both consistent.
///
/// Returns (depositor_address, shares_minted).
fn seed_vault(fix: &TestFixture, amount: i128) -> (Address, i128) {
    let depositor = Address::generate(&fix.env);

    // Mint USDC to depositor, then deposit via the vault.
    fix.token_client.mint(&depositor, &amount);

    // Use vault's mint function with the depositor paying and receiving.
    let shares = fix.vault_client.preview_deposit(&amount);
    let assets_needed = fix
        .vault_client
        .mint(&shares, &depositor, &depositor, &depositor);
    assert!(
        assets_needed <= amount,
        "mint consumed {} assets but depositor only has {}",
        assets_needed,
        amount,
    );

    (depositor, shares)
}

/// Grant PAUSER role and return the pauser address.
fn grant_pauser(fix: &TestFixture) -> Address {
    let pauser = Address::generate(&fix.env);
    let pauser_role = Symbol::new(&fix.env, shared::ROLE_PAUSER);
    fix.config_client
        .grant_role(&fix.admin, &pauser_role, &pauser);
    pauser
}

/// Grant ADMIN role and return the admin address (for claim_fees tests).
fn _grant_admin_role(fix: &TestFixture, addr: &Address) {
    let admin_role = Symbol::new(&fix.env, shared::ROLE_ADMIN);
    fix.config_client.grant_role(&fix.admin, &admin_role, addr);
}

// ===========================================================================
// settle_pnl tests
// ===========================================================================

mod settle_pnl {
    use super::*;

    // -----------------------------------------------------------------------
    // 1. Settle loss: PM sends margin USDC to vault (trader loses)
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_loss() {
        let fix = setup();
        let (_depositor, _shares) = seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Give PM some USDC (representing trader's margin held by PM)
        fix.token_client
            .mint(&fix.position_manager, &(10 * ONE_USDC));

        let vault_balance_before = fix.token_client.balance(&fix.vault_id);
        let total_assets_before = fix.vault_client.total_assets();

        // Settle loss of 10 USDC (is_profit = false => PM sends margin to vault)
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(10 * ONE_USDC),
            &0i128,
            &false,
        );

        let vault_balance_after = fix.token_client.balance(&fix.vault_id);
        let total_assets_after = fix.vault_client.total_assets();

        assert_eq!(
            vault_balance_after,
            vault_balance_before + 10 * ONE_USDC,
            "Vault USDC balance must increase by 10 USDC after loss settlement"
        );
        assert_eq!(
            total_assets_after,
            total_assets_before + 10 * ONE_USDC,
            "total_assets must increase by 10 USDC after loss settlement"
        );
        assert_eq!(
            fix.token_client.balance(&fix.position_manager),
            0,
            "PM balance must be 0 after transferring 10 USDC to vault"
        );
    }

    // -----------------------------------------------------------------------
    // 2. Settle profit: vault sends USDC to trader (trader wins)
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_profit() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        let vault_balance_before = fix.token_client.balance(&fix.vault_id);

        // Settle profit of 10 USDC (is_profit = true => vault pays trader)
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(10 * ONE_USDC),
            &0i128,
            &true,
        );

        let vault_balance_after = fix.token_client.balance(&fix.vault_id);

        assert_eq!(
            vault_balance_after,
            vault_balance_before - 10 * ONE_USDC,
            "Vault USDC balance must decrease by 10 USDC after profit settlement"
        );
        assert_eq!(
            fix.token_client.balance(&trader),
            10 * ONE_USDC,
            "Trader must receive 10 USDC from profit settlement"
        );
    }

    // -----------------------------------------------------------------------
    // 3. Settle profit exceeding free liquidity should revert
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_settle_pnl_profit_exceeds_free_liquidity_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Reserve 95 USDC, leaving only 5 USDC free
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(95 * ONE_USDC));

        // Try to settle profit of 10 USDC, but only 5 free
        // Should panic with InsufficientFreeLiquidity = 4
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(10 * ONE_USDC),
            &0i128,
            &true,
        );
    }

    // -----------------------------------------------------------------------
    // 4. Unauthorized caller (non-position_manager) should fail
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_settle_pnl_unauthorized_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        // Random address, NOT the position manager
        let attacker = Address::generate(&fix.env);
        let trader = Address::generate(&fix.env);

        // Should panic with VaultError::NotPositionManager = 7
        fix.vault_client
            .settle_pnl(&attacker, &trader, &(10 * ONE_USDC), &0i128, &false);
    }

    // -----------------------------------------------------------------------
    // 5. Zero amount should revert with ZeroAmount
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_settle_pnl_zero_amount_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // ZeroAmount = 6
        fix.vault_client
            .settle_pnl(&fix.position_manager, &trader, &0i128, &0i128, &false);
    }

    // -----------------------------------------------------------------------
    // 6. Negative amount should also revert with ZeroAmount (amount <= 0)
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_settle_pnl_negative_amount_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        fix.vault_client
            .settle_pnl(&fix.position_manager, &trader, &-1i128, &0i128, &false);
    }

    // -----------------------------------------------------------------------
    // 7. Loss settlement affects share price (ERC-4626 accounting)
    //    After a loss (vault gains assets), shares are worth more.
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_loss_affects_share_price() {
        let fix = setup();
        let (depositor, shares) = seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        assert!(shares > 0, "Depositor must have shares after deposit");

        let value_before = fix.vault_client.convert_to_assets(&shares);

        // Settle loss of 50 USDC (vault gains 50 USDC from PM's margin)
        fix.token_client
            .mint(&fix.position_manager, &(50 * ONE_USDC));
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(50 * ONE_USDC),
            &0i128,
            &false,
        );

        let value_after = fix.vault_client.convert_to_assets(&shares);

        assert!(
            value_after > value_before,
            "Share value must increase after loss settlement (vault gains assets). \
             Before: {}, After: {}",
            value_before,
            value_after
        );

        // Depositor shares should now be worth ~150 USDC
        let depositor_shares = fix.vault_client.balance(&depositor);
        let depositor_value = fix.vault_client.convert_to_assets(&depositor_shares);
        assert!(
            depositor_value >= 149 * ONE_USDC,
            "Depositor shares should be worth approximately 150 USDC, got: {}",
            depositor_value
        );
    }

    // -----------------------------------------------------------------------
    // 8. Profit settlement affects share price (ERC-4626 accounting)
    //    After a profit (vault loses assets), shares are worth less.
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_profit_affects_share_price() {
        let fix = setup();
        let (_depositor, shares) = seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        let value_before = fix.vault_client.convert_to_assets(&shares);

        // Settle profit of 30 USDC (vault loses 30 USDC)
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(30 * ONE_USDC),
            &0i128,
            &true,
        );

        let value_after = fix.vault_client.convert_to_assets(&shares);

        assert!(
            value_after < value_before,
            "Share value must decrease after profit settlement (vault loses assets). \
             Before: {}, After: {}",
            value_before,
            value_after
        );
    }

    // -----------------------------------------------------------------------
    // 9. Settle profit draining all free liquidity exactly at boundary
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_profit_exact_free_liquidity() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Reserve 50, free = 50
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));

        // Settle exactly 50 profit -- should succeed at the boundary
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(50 * ONE_USDC),
            &0i128,
            &true,
        );

        assert_eq!(
            fix.vault_client.free_liquidity(),
            0,
            "Free liquidity must be 0 after settling exact free amount as profit"
        );
    }

    // -----------------------------------------------------------------------
    // 10. Settle profit of 1 more than free liquidity should fail
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_settle_pnl_profit_one_over_free_liquidity_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Reserve 50, free = 50
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));

        // Settle 50 * ONE_USDC + 1 = should fail
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(50 * ONE_USDC + 1),
            &0i128,
            &true,
        );
    }

    // -----------------------------------------------------------------------
    // 11. Adversarial: i128::MAX amount overflow attempt
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic]
    fn test_settle_pnl_max_i128_amount_panics() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Trying to settle i128::MAX as loss -- should fail somewhere
        fix.vault_client
            .settle_pnl(&fix.position_manager, &trader, &i128::MAX, &0i128, &false);
    }

    // -----------------------------------------------------------------------
    // 12. Loss settlement does not change reserved_usdc (when reserved_delta=0)
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_loss_does_not_change_reserved() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Reserve some liquidity
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(30 * ONE_USDC));

        let free_before = fix.vault_client.free_liquidity();

        // Settle loss (PM sends margin)
        fix.token_client
            .mint(&fix.position_manager, &(10 * ONE_USDC));
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(10 * ONE_USDC),
            &0i128,
            &false,
        );

        let free_after = fix.vault_client.free_liquidity();

        // Free liquidity should increase by the loss amount (total_assets grows,
        // reserved stays the same)
        assert_eq!(
            free_after,
            free_before + 10 * ONE_USDC,
            "Free liquidity must increase by loss amount (reserved unchanged)"
        );
    }

    // -----------------------------------------------------------------------
    // 13. settle_pnl with reserved_delta releases reserved liquidity
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_with_reserved_delta() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Reserve 50 USDC
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));

        // free = 100 - 50 = 50
        assert_eq!(fix.vault_client.free_liquidity(), 50 * ONE_USDC);

        // Settle profit of 10, and release 20 from reserved (position partially closed)
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(10 * ONE_USDC),
            &(20 * ONE_USDC),
            &true,
        );

        // After: total_assets = 90, reserved = 30, free = 90 - 30 = 60
        assert_eq!(
            fix.vault_client.free_liquidity(),
            60 * ONE_USDC,
            "free_liquidity must reflect both the profit payout and reserved_delta release"
        );
    }

    // -----------------------------------------------------------------------
    // 14. settle_pnl reserved_delta exceeding reserved clamps to 0
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_settle_pnl_reserved_delta_exceeds_reserved_panics() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let trader = Address::generate(&fix.env);

        // Reserve 10 USDC
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(10 * ONE_USDC));

        // Settle with reserved_delta = 50 (more than 10 reserved) -- must panic
        fix.token_client
            .mint(&fix.position_manager, &(5 * ONE_USDC));
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(5 * ONE_USDC),
            &(50 * ONE_USDC),
            &false,
        );
    }
}

// ===========================================================================
// reserve_liquidity tests
// ===========================================================================

mod reserve_liquidity {
    use super::*;

    // -----------------------------------------------------------------------
    // 1. Basic reserve reduces free liquidity
    // -----------------------------------------------------------------------
    #[test]
    fn test_reserve_liquidity() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        let free_before = fix.vault_client.free_liquidity();
        assert_eq!(
            free_before,
            100 * ONE_USDC,
            "Free liquidity must equal deposited amount"
        );

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));

        let free_after = fix.vault_client.free_liquidity();
        assert_eq!(
            free_after,
            50 * ONE_USDC,
            "Free liquidity must decrease by reserved amount"
        );
    }

    // -----------------------------------------------------------------------
    // 2. Unauthorized reserve attempt
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_reserve_unauthorized_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        let attacker = Address::generate(&fix.env);

        // VaultError::NotPositionManager = 7
        fix.vault_client
            .reserve_liquidity(&attacker, &(50 * ONE_USDC));
    }

    // -----------------------------------------------------------------------
    // 3. Reserve zero should revert
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_reserve_zero_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &0i128);
    }

    // -----------------------------------------------------------------------
    // 4. Reserve negative should revert
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_reserve_negative_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &-1i128);
    }

    // -----------------------------------------------------------------------
    // 5. Multiple reserves accumulate
    // -----------------------------------------------------------------------
    #[test]
    fn test_reserve_accumulates() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(30 * ONE_USDC));
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(20 * ONE_USDC));

        let free = fix.vault_client.free_liquidity();
        assert_eq!(
            free,
            50 * ONE_USDC,
            "Reservations must accumulate: 100 - 30 - 20 = 50"
        );
    }

    // -----------------------------------------------------------------------
    // 6. Reserve more than total_assets -- free_liquidity should be 0 (floor)
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_reserve_more_than_total_assets_panics() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        // Reserve more than the vault holds — must panic
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(200 * ONE_USDC));
    }

    // -----------------------------------------------------------------------
    // 7. Adversarial: reserve i128::MAX overflow
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic]
    fn test_reserve_i128_max_overflow() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        // Reserve some, then reserve i128::MAX to cause overflow in current + amount
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &1i128);
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &i128::MAX);
    }
}

// ===========================================================================
// release_liquidity tests
// ===========================================================================

mod release_liquidity {
    use super::*;

    // -----------------------------------------------------------------------
    // 1. Basic release: reserve then release
    // -----------------------------------------------------------------------
    #[test]
    fn test_release_liquidity() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));
        fix.vault_client
            .release_liquidity(&fix.position_manager, &(30 * ONE_USDC));

        let free = fix.vault_client.free_liquidity();
        assert_eq!(
            free,
            80 * ONE_USDC,
            "Free liquidity should be total_assets - (reserved - released) = 100 - 20 = 80"
        );
    }

    // -----------------------------------------------------------------------
    // 2. Unauthorized release attempt
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_release_unauthorized_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));

        let attacker = Address::generate(&fix.env);
        fix.vault_client
            .release_liquidity(&attacker, &(10 * ONE_USDC));
    }

    // -----------------------------------------------------------------------
    // 3. Release zero should revert
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_release_zero_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));
        fix.vault_client
            .release_liquidity(&fix.position_manager, &0i128);
    }

    // -----------------------------------------------------------------------
    // 4. Release negative should revert
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_release_negative_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));
        fix.vault_client
            .release_liquidity(&fix.position_manager, &-5i128);
    }

    // -----------------------------------------------------------------------
    // 5. Release exact reserved amount -- reserved should go to 0
    // -----------------------------------------------------------------------
    #[test]
    fn test_release_exact_reserved() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));
        fix.vault_client
            .release_liquidity(&fix.position_manager, &(50 * ONE_USDC));

        let free = fix.vault_client.free_liquidity();
        assert_eq!(
            free,
            100 * ONE_USDC,
            "Free liquidity must equal total_assets after releasing all reserved"
        );
    }

    // -----------------------------------------------------------------------
    // 6. Adversarial: release more than reserved (underflow)
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic]
    fn test_release_more_than_reserved_underflow() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        // Reserve 10, then try to release 20 -- should underflow
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(10 * ONE_USDC));
        fix.vault_client
            .release_liquidity(&fix.position_manager, &(20 * ONE_USDC));
    }

    // -----------------------------------------------------------------------
    // 7. Release without any prior reserve (underflow from 0)
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic]
    fn test_release_without_reserve_underflow() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        // No reserve done, releasing should panic (current=0, 0 - amount < 0)
        fix.vault_client
            .release_liquidity(&fix.position_manager, &1i128);
    }
}

// ===========================================================================
// pause / unpause tests
// ===========================================================================

mod pause_unpause {
    use super::*;

    // -----------------------------------------------------------------------
    // 1. Pause/unpause cycle -- max_deposit returns 0 when paused
    // -----------------------------------------------------------------------
    #[test]
    fn test_pause_unpause_cycle() {
        let fix = setup();
        let pauser = grant_pauser(&fix);
        let user = Address::generate(&fix.env);

        // Before pause, max_deposit should be large (i128::MAX or similar)
        let max_before = fix.vault_client.max_deposit(&user);
        assert!(max_before > 0, "max_deposit must be > 0 before pause");

        // Pause
        fix.vault_client.pause(&pauser);

        let max_during = fix.vault_client.max_deposit(&user);
        assert_eq!(max_during, 0, "max_deposit must be 0 when paused");

        // max_mint should also be 0 when paused
        let max_mint_during = fix.vault_client.max_mint(&user);
        assert_eq!(max_mint_during, 0, "max_mint must be 0 when paused");

        // max_withdraw should also be 0 when paused
        let max_withdraw_during = fix.vault_client.max_withdraw(&user);
        assert_eq!(max_withdraw_during, 0, "max_withdraw must be 0 when paused");

        // max_redeem should also be 0 when paused
        let max_redeem_during = fix.vault_client.max_redeem(&user);
        assert_eq!(max_redeem_during, 0, "max_redeem must be 0 when paused");

        // Unpause
        fix.vault_client.unpause(&pauser);

        let max_after = fix.vault_client.max_deposit(&user);
        assert!(max_after > 0, "max_deposit must be > 0 after unpause");
    }

    // -----------------------------------------------------------------------
    // 2. Pause by unauthorized caller should fail
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_pause_unauthorized_reverts() {
        let fix = setup();

        let attacker = Address::generate(&fix.env);

        // SharedError::Unauthorized = 3
        fix.vault_client.pause(&attacker);
    }

    // -----------------------------------------------------------------------
    // 3. Unpause by unauthorized caller should fail
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_unpause_unauthorized_reverts() {
        let fix = setup();
        let pauser = grant_pauser(&fix);

        // Pause first (valid)
        fix.vault_client.pause(&pauser);

        let attacker = Address::generate(&fix.env);

        // Unpause by attacker should fail
        fix.vault_client.unpause(&attacker);
    }

    // -----------------------------------------------------------------------
    // 4. Deposit reverts when paused
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_deposit_when_paused_reverts() {
        let fix = setup();
        let pauser = grant_pauser(&fix);
        let user = Address::generate(&fix.env);
        fix.token_client.mint(&user, &(100 * ONE_USDC));

        fix.vault_client.pause(&pauser);

        // Deposit should panic with VaultError::Paused = 3
        fix.vault_client
            .deposit(&(50 * ONE_USDC), &user, &user, &user);
    }

    // -----------------------------------------------------------------------
    // 5. Withdraw reverts when paused
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_withdraw_when_paused_reverts() {
        let fix = setup();
        let (depositor, _shares) = seed_vault(&fix, 100 * ONE_USDC);
        let pauser = grant_pauser(&fix);

        fix.vault_client.pause(&pauser);

        // Withdraw should panic with VaultError::Paused = 3
        fix.vault_client
            .withdraw(&(50 * ONE_USDC), &depositor, &depositor, &depositor);
    }

    // -----------------------------------------------------------------------
    // 6. Mint reverts when paused
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_mint_when_paused_reverts() {
        let fix = setup();
        let pauser = grant_pauser(&fix);
        let user = Address::generate(&fix.env);
        fix.token_client.mint(&user, &(100 * ONE_USDC));

        fix.vault_client.pause(&pauser);

        // Mint shares should panic with VaultError::Paused = 3
        fix.vault_client.mint(&(50 * ONE_USDC), &user, &user, &user);
    }

    // -----------------------------------------------------------------------
    // 7. Redeem reverts when paused
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_redeem_when_paused_reverts() {
        let fix = setup();
        let (depositor, shares) = seed_vault(&fix, 100 * ONE_USDC);
        let pauser = grant_pauser(&fix);

        fix.vault_client.pause(&pauser);

        // Redeem should panic with VaultError::Paused = 3
        fix.vault_client
            .redeem(&shares, &depositor, &depositor, &depositor);
    }

    // -----------------------------------------------------------------------
    // 8. settle_pnl still works when paused (PM operations not blocked)
    // -----------------------------------------------------------------------
    #[test]
    fn test_settle_pnl_works_when_paused() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let pauser = grant_pauser(&fix);
        let trader = Address::generate(&fix.env);

        fix.vault_client.pause(&pauser);

        // Settle loss should still work even when paused (PM sends margin)
        fix.token_client
            .mint(&fix.position_manager, &(10 * ONE_USDC));
        fix.vault_client.settle_pnl(
            &fix.position_manager,
            &trader,
            &(10 * ONE_USDC),
            &0i128,
            &false,
        );

        // Verify it went through
        assert_eq!(
            fix.token_client.balance(&fix.vault_id),
            110 * ONE_USDC,
            "settle_pnl must work even when vault is paused"
        );
    }

    // -----------------------------------------------------------------------
    // 9. reserve_liquidity still works when paused
    // -----------------------------------------------------------------------
    #[test]
    fn test_reserve_liquidity_works_when_paused() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let pauser = grant_pauser(&fix);

        fix.vault_client.pause(&pauser);

        // Reserve should still work even when paused
        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(30 * ONE_USDC));

        assert_eq!(
            fix.vault_client.free_liquidity(),
            70 * ONE_USDC,
            "reserve_liquidity must work even when vault is paused"
        );
    }

    // -----------------------------------------------------------------------
    // 10. Double pause is idempotent (does not revert)
    // -----------------------------------------------------------------------
    #[test]
    fn test_double_pause_is_idempotent() {
        let fix = setup();
        let pauser = grant_pauser(&fix);

        fix.vault_client.pause(&pauser);
        // Pausing again should not revert
        fix.vault_client.pause(&pauser);

        let user = Address::generate(&fix.env);
        assert_eq!(
            fix.vault_client.max_deposit(&user),
            0,
            "Vault must still be paused after double pause"
        );
    }

    // -----------------------------------------------------------------------
    // 11. Double unpause is idempotent (does not revert)
    // -----------------------------------------------------------------------
    #[test]
    fn test_double_unpause_is_idempotent() {
        let fix = setup();
        let pauser = grant_pauser(&fix);

        fix.vault_client.pause(&pauser);
        fix.vault_client.unpause(&pauser);
        // Unpausing again should not revert
        fix.vault_client.unpause(&pauser);

        let user = Address::generate(&fix.env);
        assert!(
            fix.vault_client.max_deposit(&user) > 0,
            "Vault must be unpaused after double unpause"
        );
    }

    // -----------------------------------------------------------------------
    // 12. Non-pauser cannot pause
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_random_cannot_pause() {
        let fix = setup();
        let random = Address::generate(&fix.env);

        fix.vault_client.pause(&random);
    }

    // -----------------------------------------------------------------------
    // 13. Position manager cannot pause (only PAUSER role)
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_position_manager_cannot_pause() {
        let fix = setup();

        fix.vault_client.pause(&fix.position_manager);
    }

    // -----------------------------------------------------------------------
    // 14. release_liquidity still works when paused
    // -----------------------------------------------------------------------
    #[test]
    fn test_release_liquidity_works_when_paused() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);
        let pauser = grant_pauser(&fix);

        fix.vault_client
            .reserve_liquidity(&fix.position_manager, &(50 * ONE_USDC));

        fix.vault_client.pause(&pauser);

        // Release should still work even when paused
        fix.vault_client
            .release_liquidity(&fix.position_manager, &(20 * ONE_USDC));

        assert_eq!(
            fix.vault_client.free_liquidity(),
            70 * ONE_USDC,
            "release_liquidity must work even when vault is paused"
        );
    }

    // -----------------------------------------------------------------------
    // 15. Admin cannot pause (only PAUSER role, admin is not pauser by default)
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_admin_cannot_pause_without_pauser_role() {
        let fix = setup();

        // Admin does not have PAUSER role unless explicitly granted
        fix.vault_client.pause(&fix.admin);
    }
}

// ===========================================================================
// update_net_pnl tests
// ===========================================================================

mod update_net_pnl {
    use super::*;

    #[test]
    fn test_update_net_pnl_positive() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .update_net_pnl(&fix.position_manager, &(20 * ONE_USDC));

        // free_liquidity = 100 - 0 - 0 - 20 = 80
        assert_eq!(
            fix.vault_client.free_liquidity(),
            80 * ONE_USDC,
            "Positive net PnL must reduce free liquidity"
        );
    }

    #[test]
    fn test_update_net_pnl_negative() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .update_net_pnl(&fix.position_manager, &(-30 * ONE_USDC));

        // Negative PnL => max(0, pnl) = 0, so free = 100
        assert_eq!(
            fix.vault_client.free_liquidity(),
            100 * ONE_USDC,
            "Negative net PnL must not reduce free liquidity"
        );
    }

    #[test]
    fn test_update_net_pnl_zero() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .update_net_pnl(&fix.position_manager, &0i128);

        assert_eq!(
            fix.vault_client.free_liquidity(),
            100 * ONE_USDC,
            "Zero PnL must not reduce free liquidity"
        );
    }

    #[test]
    fn test_update_net_pnl_overwrites_previous() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .update_net_pnl(&fix.position_manager, &(50 * ONE_USDC));
        assert_eq!(fix.vault_client.free_liquidity(), 50 * ONE_USDC);

        // Update to 10 -- should overwrite, not accumulate
        fix.vault_client
            .update_net_pnl(&fix.position_manager, &(10 * ONE_USDC));
        assert_eq!(
            fix.vault_client.free_liquidity(),
            90 * ONE_USDC,
            "update_net_pnl must overwrite previous value, not accumulate"
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_update_net_pnl_unauthorized_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        let attacker = Address::generate(&fix.env);
        fix.vault_client.update_net_pnl(&attacker, &(10 * ONE_USDC));
    }
}

// ===========================================================================
// accrue_fees tests
// ===========================================================================

mod accrue_fees {
    use super::*;

    #[test]
    fn test_accrue_fees_success() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .accrue_fees(&fix.position_manager, &(5 * ONE_USDC));

        // free_liquidity = 100 - 0 - 5 - 0 = 95
        assert_eq!(
            fix.vault_client.free_liquidity(),
            95 * ONE_USDC,
            "Accrued fees must reduce free liquidity"
        );
    }

    #[test]
    fn test_accrue_fees_accumulates() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .accrue_fees(&fix.position_manager, &(5 * ONE_USDC));
        fix.vault_client
            .accrue_fees(&fix.position_manager, &(3 * ONE_USDC));

        // free_liquidity = 100 - 0 - 8 - 0 = 92
        assert_eq!(
            fix.vault_client.free_liquidity(),
            92 * ONE_USDC,
            "Fees must accumulate across multiple accrue_fees calls"
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_accrue_fees_zero_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client.accrue_fees(&fix.position_manager, &0i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_accrue_fees_negative_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client.accrue_fees(&fix.position_manager, &-1i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_accrue_fees_unauthorized_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        let attacker = Address::generate(&fix.env);
        fix.vault_client.accrue_fees(&attacker, &(5 * ONE_USDC));
    }
}

// ===========================================================================
// claim_fees tests
// ===========================================================================

mod claim_fees {
    use super::*;

    #[test]
    fn test_claim_fees_success() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        // Accrue 10 USDC in fees
        fix.vault_client
            .accrue_fees(&fix.position_manager, &(10 * ONE_USDC));

        // Grant ADMIN role to admin

        let recipient = Address::generate(&fix.env);
        let recipient_before = fix.token_client.balance(&recipient);

        // Claim fees
        fix.vault_client.claim_fees(&fix.admin, &recipient);

        let recipient_after = fix.token_client.balance(&recipient);
        assert_eq!(
            recipient_after - recipient_before,
            10 * ONE_USDC,
            "Recipient must receive the full unclaimed fees amount"
        );

        // After claiming, free_liquidity should increase (fees are now 0)
        assert_eq!(
            fix.vault_client.free_liquidity(),
            90 * ONE_USDC,
            "free_liquidity = total_assets(90) - reserved(0) - fees(0) - pnl(0)"
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_claim_fees_when_no_fees_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        let recipient = Address::generate(&fix.env);

        // No fees accrued -- should panic with ZeroAmount
        fix.vault_client.claim_fees(&fix.admin, &recipient);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_claim_fees_unauthorized_reverts() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .accrue_fees(&fix.position_manager, &(10 * ONE_USDC));

        let attacker = Address::generate(&fix.env);
        let recipient = Address::generate(&fix.env);

        // Non-admin cannot claim fees -- SharedError::Unauthorized = 3
        fix.vault_client.claim_fees(&attacker, &recipient);
    }

    #[test]
    fn test_claim_fees_resets_unclaimed() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .accrue_fees(&fix.position_manager, &(10 * ONE_USDC));

        let recipient = Address::generate(&fix.env);

        fix.vault_client.claim_fees(&fix.admin, &recipient);

        // Accrue more fees
        fix.vault_client
            .accrue_fees(&fix.position_manager, &(5 * ONE_USDC));

        // Claim again -- should only get the new 5 USDC
        let recipient2 = Address::generate(&fix.env);
        fix.vault_client.claim_fees(&fix.admin, &recipient2);

        assert_eq!(
            fix.token_client.balance(&recipient2),
            5 * ONE_USDC,
            "Second claim must only transfer newly accrued fees"
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_position_manager_cannot_claim_fees() {
        let fix = setup();
        seed_vault(&fix, 100 * ONE_USDC);

        fix.vault_client
            .accrue_fees(&fix.position_manager, &(10 * ONE_USDC));

        let recipient = Address::generate(&fix.env);

        // PM does not have ADMIN role, should fail with SharedError::Unauthorized = 3
        fix.vault_client
            .claim_fees(&fix.position_manager, &recipient);
    }
}
