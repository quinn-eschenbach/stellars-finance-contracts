use soroban_sdk::{contractclient, Address, Env, Symbol};

/// SEP-40 price oracle interface.
#[contractclient(name = "OracleClient")]
pub trait Oracle {
    /// Initialize the oracle with a link to the ConfigManager for access control.
    fn initialize(env: Env, config_manager: Address);

    /// Set the price for `symbol` (scaled by 1e7). KEEPER role required.
    fn set_price(env: Env, caller: Address, symbol: Symbol, price: i128);

    /// Return the stored price for `symbol`. SEP-40 compatible.
    fn get_price(env: Env, symbol: Symbol) -> i128;

    /// Return the ledger timestamp when the price was last set. SEP-40 compatible.
    fn last_update(env: Env, symbol: Symbol) -> u64;
}
