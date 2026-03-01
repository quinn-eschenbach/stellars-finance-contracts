use soroban_sdk::Env;
use test_suites::testutils::Fixture;

// ---------------------------------------------------------------------------
// Vault: Initialization
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_vault_initialize_sets_config_manager() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_vault_initialize_reverts_on_second_call() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// Vault: Deposit
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_deposit_mints_lp_tokens_proportional_to_share_price() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_deposit_reverts_when_paused() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_deposit_reverts_on_zero_amount() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// Vault: Withdraw
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_withdraw_burns_lp_tokens_and_transfers_usdc() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_withdraw_reverts_when_paused() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_withdraw_reverts_if_exceeds_free_liquidity() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// Vault: Settle PnL
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_settle_pnl_profit_decreases_total_usdc() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_settle_pnl_loss_increases_total_usdc() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_settle_pnl_reverts_if_not_called_by_position_manager() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// Vault: Pause / Unpause
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_pause_reverts_if_not_pauser_role() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_unpause_reverts_if_not_pauser_role() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

// ---------------------------------------------------------------------------
// Vault: SEP-41 Token Interface
// ---------------------------------------------------------------------------

#[test]
#[ignore = "not yet implemented"]
fn test_transfer_moves_lp_tokens_between_accounts() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}

#[test]
#[ignore = "not yet implemented"]
fn test_approve_and_transfer_from() {
    let env = Env::default();
    let _fixture = Fixture::deploy(&env);
    todo!()
}
