use soroban_sdk::contracttype;

/// Represents a single trader's open leveraged position.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    /// USDC collateral deposited by the trader.
    pub collateral: i128,
    /// Notional size of the position in USDC.
    pub size: i128,
    /// Oracle price at the time the position was opened (scaled by 1e7).
    pub entry_price: i128,
    /// Global borrow accumulator index at position open (for lazy fee calc).
    pub entry_borrow_index: i128,
    /// Global funding accumulator index at position open (for lazy fee calc).
    pub entry_funding_index: i128,
    /// True for a long position, false for a short.
    pub is_long: bool,
    /// Block timestamp when the position was last increased (anti-front-running lock).
    pub last_increased_time: u64,
}

/// Global market state for a single tradeable asset symbol.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketInfo {
    /// Volume-weighted average entry price of all active long positions.
    pub global_long_avg_price: i128,
    /// Volume-weighted average entry price of all active short positions.
    pub global_short_avg_price: i128,
    /// Total notional size of all open long positions.
    pub long_open_interest: i128,
    /// Total notional size of all open short positions.
    pub short_open_interest: i128,
    /// Cumulative borrow fee index (grows monotonically with time).
    pub acc_borrow_index: i128,
    /// Cumulative funding rate index (signed; positive = longs pay shorts).
    pub acc_funding_index: i128,
    /// Timestamp of the last keeper index update.
    pub last_index_update: u64,
}
