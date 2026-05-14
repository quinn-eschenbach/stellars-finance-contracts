use soroban_sdk::{contractclient, Address, Env};

/// Vault contract interface.
/// SEP-41 LP token + USDC treasury for the perpetual DEX.
#[contractclient(name = "VaultClient")]
pub trait VaultInterface {
    fn initialize(
        env: Env,
        admin: Address,
        asset: Address,
        config_manager: Address,
        position_manager: Address,
    );

    fn pay_profit(env: Env, caller: Address, trader: Address, amount: i128);

    fn reserve_liquidity(env: Env, caller: Address, amount: i128);

    fn release_liquidity(env: Env, caller: Address, amount: i128);

    fn update_net_pnl(env: Env, caller: Address, pnl: i128);

    /// Notify the vault that PM transferred `amount` USDC into the vault.
    /// `pre_balance` is the vault's USDC balance immediately BEFORE the
    /// transfer — `record_absorbed_collateral` verifies `post - pre == amount`
    /// to detect PM↔Vault state divergence.
    fn record_absorbed_collateral(
        env: Env,
        caller: Address,
        trader: Address,
        amount: i128,
        pre_balance: i128,
    );

    fn accrue_fees(env: Env, caller: Address, amount: i128);

    /// Total assets minus `unclaimed_fees`, with no PnL deduction. Used by
    /// PM's utilization gate so that mark-price moves cannot feed back into
    /// the utilization denominator and bias the gate.
    fn total_assets_excl_pnl(env: Env) -> i128;

    fn claim_fees(env: Env, caller: Address, recipient: Address);

    fn claim_fees_to(env: Env, caller: Address, recipient: Address, amount: i128);

    fn pause(env: Env, caller: Address);

    fn unpause(env: Env, caller: Address);

    fn free_liquidity(env: Env) -> i128;

    fn reserved_usdc(env: Env) -> i128;

    fn query_asset(env: Env) -> Address;

    fn total_assets(env: Env) -> i128;

    fn bump_vault_state(env: Env);
}
