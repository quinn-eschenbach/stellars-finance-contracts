use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, panic_with_error, Address, Env,
    MuxedAddress, String,
};

use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;
use stellar_tokens::{
    fungible::{Base, FungibleToken},
    vault::{FungibleVault, Vault},
};

use crate::errors::VaultError;
use crate::logic as vault_logic;
use crate::storage as vault_storage;

#[contracttype]
pub struct UpgradeData {
    pub version: u32,
}

#[derive(UpgradeableMigratable)]
#[contract]
pub struct VaultContract;

// ---------------------------------------------------------------------------
// Cross-contract client trait
// ---------------------------------------------------------------------------

#[contractclient(name = "VaultClient")]
pub trait VaultInterface {
    fn initialize(
        env: Env,
        admin: Address,
        asset: Address,
        config_manager: Address,
        position_manager: Address,
    );

    fn settle_pnl(
        env: Env,
        caller: Address,
        trader: Address,
        amount: i128,
        reserved_delta: i128,
        is_profit: bool,
    );

    fn reserve_liquidity(env: Env, caller: Address, amount: i128);

    fn release_liquidity(env: Env, caller: Address, amount: i128);

    fn update_net_pnl(env: Env, caller: Address, pnl: i128);

    fn accrue_fees(env: Env, caller: Address, amount: i128);

    fn claim_fees(env: Env, caller: Address, recipient: Address);

    fn claim_fees_to(env: Env, caller: Address, recipient: Address, amount: i128);

    fn pause(env: Env, caller: Address);

    fn unpause(env: Env, caller: Address);

    fn free_liquidity(env: Env) -> i128;

    fn bump_vault_state(env: Env);
}

// ---------------------------------------------------------------------------
// SEP-41 token interface — auto-implemented by OZ Vault (which extends Base)
// ---------------------------------------------------------------------------
#[contractimpl(contracttrait)]
impl FungibleToken for VaultContract {
    type ContractType = Vault;

    fn decimals(e: &Env) -> u32 {
        Vault::decimals(e)
    }
}

// ---------------------------------------------------------------------------
// ERC-4626 vault interface — delegates to OZ Vault with custom wrappers
// ---------------------------------------------------------------------------
#[contractimpl]
impl FungibleVault for VaultContract {
    fn query_asset(e: &Env) -> Address {
        Vault::query_asset(e)
    }

    fn total_assets(e: &Env) -> i128 {
        Vault::total_assets(e)
    }

    fn convert_to_shares(e: &Env, assets: i128) -> i128 {
        Vault::convert_to_shares(e, assets)
    }

    fn convert_to_assets(e: &Env, shares: i128) -> i128 {
        Vault::convert_to_assets(e, shares)
    }

    fn max_deposit(e: &Env, receiver: Address) -> i128 {
        if vault_storage::get_paused(e) {
            return 0;
        }
        Vault::max_deposit(e, receiver)
    }

    fn preview_deposit(e: &Env, assets: i128) -> i128 {
        Vault::preview_deposit(e, assets)
    }

    fn deposit(e: &Env, assets: i128, receiver: Address, from: Address, operator: Address) -> i128 {
        vault_logic::require_not_paused(e);
        vault_logic::require_initialized(e);
        vault_logic::record_deposit_time(e, &receiver);
        Vault::deposit(e, assets, receiver, from, operator)
    }

    fn max_mint(e: &Env, receiver: Address) -> i128 {
        if vault_storage::get_paused(e) {
            return 0;
        }
        Vault::max_mint(e, receiver)
    }

    fn preview_mint(e: &Env, shares: i128) -> i128 {
        Vault::preview_mint(e, shares)
    }

    fn mint(e: &Env, shares: i128, receiver: Address, from: Address, operator: Address) -> i128 {
        vault_logic::require_not_paused(e);
        vault_logic::require_initialized(e);
        vault_logic::record_deposit_time(e, &receiver);
        Vault::mint(e, shares, receiver, from, operator)
    }

    fn max_withdraw(e: &Env, owner: Address) -> i128 {
        if vault_storage::get_paused(e) {
            return 0;
        }
        let user_assets = Vault::max_withdraw(e, owner.clone());
        let free = vault_logic::free_liquidity(e);
        core::cmp::min(user_assets, free)
    }

    fn preview_withdraw(e: &Env, assets: i128) -> i128 {
        Vault::preview_withdraw(e, assets)
    }

    fn withdraw(
        e: &Env,
        assets: i128,
        receiver: Address,
        owner: Address,
        operator: Address,
    ) -> i128 {
        vault_logic::require_not_paused(e);
        vault_logic::require_initialized(e);
        vault_logic::require_cooldown_elapsed(e, &owner);
        vault_logic::require_free_liquidity(e, assets);
        Vault::withdraw(e, assets, receiver, owner, operator)
    }

    fn max_redeem(e: &Env, owner: Address) -> i128 {
        if vault_storage::get_paused(e) {
            return 0;
        }
        let max_w = Self::max_withdraw(e, owner.clone());
        Vault::convert_to_shares(e, max_w)
    }

    fn preview_redeem(e: &Env, shares: i128) -> i128 {
        Vault::preview_redeem(e, shares)
    }

    fn redeem(e: &Env, shares: i128, receiver: Address, owner: Address, operator: Address) -> i128 {
        vault_logic::require_not_paused(e);
        vault_logic::require_initialized(e);
        vault_logic::require_cooldown_elapsed(e, &owner);
        let assets = Vault::preview_redeem(e, shares);
        vault_logic::require_free_liquidity(e, assets);
        Vault::redeem(e, shares, receiver, owner, operator)
    }
}

// ---------------------------------------------------------------------------
// Custom vault methods
// ---------------------------------------------------------------------------
#[contractimpl]
impl VaultContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        asset: Address,
        config_manager: Address,
        position_manager: Address,
    ) {
        vault_logic::require_not_initialized(&env);
        admin.require_auth();

        Vault::set_asset(&env, asset);
        Vault::set_decimals_offset(&env, 6);
        Base::set_metadata(
            &env,
            Vault::decimals(&env),
            String::from_str(&env, "Stellars LP"),
            String::from_str(&env, "sLP"),
        );

        vault_storage::set_config_manager(&env, &config_manager);
        vault_storage::set_position_manager(&env, &position_manager);
        vault_storage::set_reserved_usdc(&env, 0);
        vault_storage::set_unclaimed_fees(&env, 0);
        vault_storage::set_net_global_trader_pnl(&env, 0);
        vault_storage::set_paused(&env, false);
        vault_storage::set_initialized(&env);

        shared::bump_instance_ttl(&env);
    }

    pub fn settle_pnl(
        env: Env,
        caller: Address,
        trader: Address,
        amount: i128,
        reserved_delta: i128,
        is_profit: bool,
    ) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        if reserved_delta > 0 {
            let current_reserved = vault_storage::get_reserved_usdc(&env);
            if reserved_delta > current_reserved {
                panic_with_error!(&env, VaultError::InsufficientFreeLiquidity);
            }
            vault_storage::set_reserved_usdc(&env, current_reserved - reserved_delta);
        }

        let asset = Vault::query_asset(&env);
        let vault_addr = env.current_contract_address();

        if is_profit {
            vault_logic::require_free_liquidity(&env, amount);
            vault_logic::transfer_asset(&env, &asset, &vault_addr, &trader, amount);
        } else {
            vault_logic::transfer_asset(&env, &asset, &caller, &vault_addr, amount);
        }

        shared::bump_instance_ttl(&env);
    }

    pub fn reserve_liquidity(env: Env, caller: Address, amount: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let current = vault_storage::get_reserved_usdc(&env);
        let new_reserved = current + amount;
        let total = Vault::total_assets(&env);
        if new_reserved > total {
            panic_with_error!(&env, VaultError::ReservationExceedsTotalAssets);
        }
        vault_storage::set_reserved_usdc(&env, new_reserved);
        shared::bump_instance_ttl(&env);
    }

    pub fn release_liquidity(env: Env, caller: Address, amount: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let current = vault_storage::get_reserved_usdc(&env);
        if amount > current {
            panic_with_error!(&env, VaultError::InsufficientFreeLiquidity);
        }
        vault_storage::set_reserved_usdc(&env, current - amount);
        shared::bump_instance_ttl(&env);
    }

    pub fn update_net_pnl(env: Env, caller: Address, pnl: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);
        vault_storage::set_net_global_trader_pnl(&env, pnl);
        shared::bump_instance_ttl(&env);
    }

    pub fn accrue_fees(env: Env, caller: Address, amount: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let current = vault_storage::get_unclaimed_fees(&env);
        vault_storage::set_unclaimed_fees(&env, current + amount);
        shared::bump_instance_ttl(&env);
    }

    pub fn claim_fees(env: Env, caller: Address, recipient: Address) {
        vault_logic::require_initialized(&env);
        vault_logic::require_admin(&env, &caller);

        let fees = vault_storage::get_unclaimed_fees(&env);
        if fees <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let asset = Vault::query_asset(&env);
        let vault_addr = env.current_contract_address();
        vault_logic::transfer_asset(&env, &asset, &vault_addr, &recipient, fees);
        vault_storage::set_unclaimed_fees(&env, 0);
        shared::bump_instance_ttl(&env);
    }

    pub fn claim_fees_to(env: Env, caller: Address, recipient: Address, amount: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let fees = vault_storage::get_unclaimed_fees(&env);
        if amount > fees {
            panic_with_error!(&env, VaultError::InsufficientFees);
        }

        let asset = Vault::query_asset(&env);
        let vault_addr = env.current_contract_address();
        vault_logic::transfer_asset(&env, &asset, &vault_addr, &recipient, amount);
        vault_storage::set_unclaimed_fees(&env, fees - amount);
        shared::bump_instance_ttl(&env);
    }

    pub fn pause(env: Env, caller: Address) {
        vault_logic::require_initialized(&env);
        vault_logic::require_pauser(&env, &caller);
        vault_storage::set_paused(&env, true);
        shared::bump_instance_ttl(&env);
    }

    pub fn unpause(env: Env, caller: Address) {
        vault_logic::require_initialized(&env);
        vault_logic::require_pauser(&env, &caller);
        vault_storage::set_paused(&env, false);
        shared::bump_instance_ttl(&env);
    }

    pub fn free_liquidity(env: Env) -> i128 {
        vault_logic::require_initialized(&env);
        vault_logic::free_liquidity(&env)
    }

    pub fn bump_vault_state(env: Env) {
        shared::bump_instance_ttl(&env);
    }
}

// ---------------------------------------------------------------------------
// Upgrade support
// ---------------------------------------------------------------------------
impl UpgradeableMigratableInternal for VaultContract {
    type MigrationData = UpgradeData;

    fn _require_auth(e: &Env, operator: &Address) {
        let config_mgr = vault_storage::get_config_manager(e);
        shared::require_role(e, operator, &config_mgr, shared::ROLE_UPGRADER);
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        vault_storage::save_version(e, data.version);
        shared::bump_instance_ttl(e);
    }
}
