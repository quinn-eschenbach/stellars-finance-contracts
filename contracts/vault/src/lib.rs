#![no_std]

mod errors;
mod storage;

use soroban_sdk::{contract, contractclient, contractimpl, contracttype, Address, Env, String};
use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;

pub use errors::VaultError;

#[contracttype]
pub struct UpgradeData {
    pub version: u32,
}

#[derive(UpgradeableMigratable)]
#[contract]
pub struct VaultContract;

#[contractclient(name = "VaultClient")]
pub trait Vault {
    /// Initialize the vault. Can only be called once.
    /// Sets the admin via OpenZeppelin AccessControl and links to the ConfigManager.
    fn initialize(env: Env, admin: Address, config_manager: Address);

    /// Deposit USDC into the vault and receive STELLARS_LP tokens.
    /// Reverts if the vault is paused.
    /// Mints LP tokens based on the current share price:
    ///   shares = amount * total_supply / total_usdc
    fn deposit(env: Env, depositor: Address, amount: i128);

    /// Withdraw USDC by burning STELLARS_LP tokens.
    /// Reverts if the vault is paused.
    /// Reverts if the requested amount exceeds Free Liquidity:
    ///   Free Liquidity = TotalUSDC - ReservedUSDC - UnclaimedFees - max(0, NetGlobalTraderPnL)
    fn withdraw(env: Env, withdrawer: Address, amount: i128);

    /// Settle trader PnL against the vault. Called only by the PositionManager.
    /// If is_profit: transfers USDC out to the trader (decrease TotalUSDC).
    /// If loss: USDC stays in vault (increase TotalUSDC).
    /// Always adjusts ReservedUSDC.
    fn settle_pnl(env: Env, amount: i128, is_profit: bool);

    /// Pause the vault. Callable only by the PAUSER_ROLE defined in ConfigManager.
    fn pause(env: Env, caller: Address);

    /// Unpause the vault. Callable only by the PAUSER_ROLE defined in ConfigManager.
    fn unpause(env: Env, caller: Address);

    /// Extends the TTL of the vault's instance storage to prevent archival by the network.
    fn bump_vault_state(env: Env);

    /// Extends the TTL of a specific user's LP token balance in persistent storage.
    fn bump_user_balance(env: Env, user_address: Address);

    // -------------------------------------------------------------------------
    // SEP-41 Fungible Token Interface
    // -------------------------------------------------------------------------

    fn total_supply(env: Env) -> i128;

    fn balance(env: Env, address: Address) -> i128;

    fn transfer(env: Env, from: Address, to: Address, amount: i128);

    fn allowance(env: Env, from: Address, spender: Address) -> i128;

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32);

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128);

    fn decimals(env: Env) -> u32;

    fn name(env: Env) -> String;

    fn symbol(env: Env) -> String;
}

#[contractimpl]
impl Vault for VaultContract {
    fn initialize(env: Env, admin: Address, config_manager: Address) {
        todo!()
    }

    fn deposit(env: Env, depositor: Address, amount: i128) {
        todo!()
    }

    fn withdraw(env: Env, withdrawer: Address, amount: i128) {
        todo!()
    }

    fn settle_pnl(env: Env, amount: i128, is_profit: bool) {
        todo!()
    }

    fn pause(env: Env, caller: Address) {
        todo!()
    }

    fn unpause(env: Env, caller: Address) {
        todo!()
    }

    fn bump_vault_state(env: Env) {
        todo!()
    }

    fn bump_user_balance(env: Env, user_address: Address) {
        todo!()
    }

    fn total_supply(env: Env) -> i128 {
        todo!()
    }

    fn balance(env: Env, address: Address) -> i128 {
        todo!()
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        todo!()
    }

    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        todo!()
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        todo!()
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        todo!()
    }

    fn decimals(env: Env) -> u32 {
        todo!()
    }

    fn name(env: Env) -> String {
        todo!()
    }

    fn symbol(env: Env) -> String {
        todo!()
    }
}

impl UpgradeableMigratableInternal for VaultContract {
    type MigrationData = UpgradeData;

    fn _require_auth(e: &Env, operator: &Address) {
        todo!()
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        todo!()
    }
}
