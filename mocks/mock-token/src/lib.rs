//! Mock SEP-41 fungible token for use in integration tests.
//!
//! Exposes `mint` and `burn` in addition to the standard token interface
//! so test fixtures can freely manage token supply.

#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, String};

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    /// Deploy and configure the mock token.
    pub fn initialize(env: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        todo!()
    }

    /// Mint `amount` tokens to `to`. No access control in mock — test-only.
    pub fn mint(env: Env, to: Address, amount: i128) {
        todo!()
    }

    /// Burn `amount` tokens from `from`. No access control in mock — test-only.
    pub fn burn(env: Env, from: Address, amount: i128) {
        todo!()
    }

    // -------------------------------------------------------------------------
    // SEP-41 interface
    // -------------------------------------------------------------------------

    pub fn total_supply(env: Env) -> i128 {
        todo!()
    }

    pub fn balance(env: Env, address: Address) -> i128 {
        todo!()
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        todo!()
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        todo!()
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        todo!()
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        todo!()
    }

    pub fn decimals(env: Env) -> u32 {
        todo!()
    }

    pub fn name(env: Env) -> String {
        todo!()
    }

    pub fn symbol(env: Env) -> String {
        todo!()
    }
}
