
use soroban_sdk::{
    contract, contractimpl, panic_with_error, Address, Env, MuxedAddress, String,
};

use stellar_contract_utils::upgradeable::UpgradeableMigratableInternal;
use stellar_macros::UpgradeableMigratable;
use stellar_tokens::{
    fungible::{Base, FungibleToken},
    vault::{FungibleVault, Vault},
};

use crate::errors::VaultError;
use crate::events as vault_events;
use crate::logic as vault_logic;
use crate::storage as vault_storage;

#[derive(UpgradeableMigratable)]
#[contract]
pub struct VaultContract;

// ---------------------------------------------------------------------------
// SEP-41 token interface — auto-implemented by OZ Vault (which extends Base)
// ---------------------------------------------------------------------------
#[contractimpl(contracttrait)]
impl FungibleToken for VaultContract {
    type ContractType = Vault;

    fn decimals(e: &Env) -> u32 {
        Vault::decimals(e)
    }

    /// Override to propagate the sender's remaining lockup onto the recipient.
    /// Without this, an LP could circumvent the cooldown by transferring LP
    /// shares to a fresh address that then withdraws.
    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        let to_addr = to.address();
        Base::transfer(e, &from, &to, amount);
        vault_logic::propagate_lockup_on_transfer(e, &from, &to_addr);
    }

    /// Same lockup-propagation guarantee for the allowance-based path.
    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        Base::transfer_from(e, &spender, &from, &to, amount);
        vault_logic::propagate_lockup_on_transfer(e, &from, &to);
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
        // Reject zero-asset deposits — without this, anyone can extend any
        // user's lockup at zero cost by minting 0 shares to them.
        if assets <= 0 {
            panic_with_error!(e, VaultError::ZeroAmount);
        }
        vault_logic::record_lockup(e, &receiver);
        // OZ Vault::deposit auto-emits the deposit event.
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
        // Symmetric guard with deposit() — block zero-share mints that would
        // otherwise let anyone reset a victim's lockup for free.
        if shares <= 0 {
            panic_with_error!(e, VaultError::ZeroAmount);
        }
        vault_logic::record_lockup(e, &receiver);
        // OZ Vault::mint auto-emits the deposit event (mint and deposit collapse to one event).
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
        vault_logic::require_lockup_elapsed(e, &owner);
        vault_logic::require_free_liquidity(e, assets);
        // OZ Vault::withdraw auto-emits the withdraw event.
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
        vault_logic::require_lockup_elapsed(e, &owner);
        let assets = Vault::preview_redeem(e, shares);
        vault_logic::require_free_liquidity(e, assets);
        // OZ Vault::redeem auto-emits the withdraw event (redeem and withdraw collapse to one event).
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

    /// Pay `amount` from the vault to `trader` to settle a profitable close.
    /// Loss settlement does NOT route through here — see ADR-0001.
    pub fn pay_profit(
        env: Env,
        caller: Address,
        trader: Address,
        amount: i128,
    ) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        vault_logic::require_free_liquidity(&env, amount);
        let asset = Vault::query_asset(&env);
        let vault_addr = env.current_contract_address();
        vault_logic::transfer_asset(&env, &asset, &vault_addr, &trader, amount);

        vault_events::PayProfit { trader: trader.clone(), amount }.publish(&env);
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
        vault_events::Reserve { amount, new_total: new_reserved }.publish(&env);
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
        let new_reserved = current - amount;
        vault_storage::set_reserved_usdc(&env, new_reserved);
        vault_events::Release { amount, new_total: new_reserved }.publish(&env);
        shared::bump_instance_ttl(&env);
    }

    pub fn update_net_pnl(env: Env, caller: Address, pnl: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);
        vault_storage::set_net_global_trader_pnl(&env, pnl);
        vault_events::UpdateNetPnl { pnl }.publish(&env);
        shared::bump_instance_ttl(&env);
    }

    /// Notify the vault that PositionManager has just transferred `amount`
    /// USDC of seized/loss-settlement collateral directly into the vault's
    /// wallet. This call does NOT move tokens — it only verifies the caller
    /// is PM, then emits an event so off-chain indexers can update their
    /// tracked total_assets in lockstep with the vault's actual on-chain
    /// balance. See ADR-0001 for why losses bypass `pay_profit`.
    pub fn record_absorbed_collateral(env: Env, caller: Address, trader: Address, amount: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);
        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        vault_events::AbsorbedCollateral { trader, amount }.publish(&env);
        shared::bump_instance_ttl(&env);
    }

    pub fn accrue_fees(env: Env, caller: Address, amount: i128) {
        vault_logic::require_initialized(&env);
        vault_logic::require_position_manager(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let current = vault_storage::get_unclaimed_fees(&env);
        let new_total = current + amount;
        vault_storage::set_unclaimed_fees(&env, new_total);
        vault_events::AccrueFees { amount, new_total }.publish(&env);
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
        vault_events::ClaimFees { amount: fees, recipient: recipient.clone() }.publish(&env);
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
        vault_events::ClaimFeesTo { amount, new_total: fees - amount, recipient: recipient.clone() }.publish(&env);
        shared::bump_instance_ttl(&env);
    }

    pub fn pause(env: Env, caller: Address) {
        vault_logic::require_initialized(&env);
        vault_logic::require_pauser(&env, &caller);
        vault_storage::set_paused(&env, true);
        vault_events::Pause { is_paused: true, caller: caller.clone() }.publish(&env);
        shared::bump_instance_ttl(&env);
    }

    pub fn unpause(env: Env, caller: Address) {
        vault_logic::require_initialized(&env);
        vault_logic::require_pauser(&env, &caller);
        vault_storage::set_paused(&env, false);
        vault_events::Pause { is_paused: false, caller: caller.clone() }.publish(&env);
        shared::bump_instance_ttl(&env);
    }

    pub fn free_liquidity(env: Env) -> i128 {
        vault_logic::require_initialized(&env);
        vault_logic::free_liquidity(&env)
    }

    pub fn reserved_usdc(env: Env) -> i128 {
        vault_logic::require_initialized(&env);
        vault_storage::get_reserved_usdc(&env)
    }

    /// Returns the unix timestamp at which `user` may next withdraw/redeem.
    /// Returns 0 if `user` has never deposited (no lockup recorded).
    pub fn lockup_expires_at(env: Env, user: Address) -> u64 {
        vault_storage::get_lockup_expires_at(&env, &user).unwrap_or(0)
    }

    pub fn bump_vault_state(env: Env) {
        shared::bump_instance_ttl(&env);
    }
}

// ---------------------------------------------------------------------------
// Upgrade support
// ---------------------------------------------------------------------------
impl UpgradeableMigratableInternal for VaultContract {
    type MigrationData = interfaces::MigrationData;

    fn _require_auth(e: &Env, operator: &Address) {
        let config_mgr = vault_storage::get_config_manager(e);
        shared::require_role(e, operator, &config_mgr, shared::ROLE_UPGRADER);
    }

    fn _migrate(e: &Env, data: &Self::MigrationData) {
        vault_storage::save_version(e, data.version);
        shared::bump_instance_ttl(e);
    }
}
