use soroban_sdk::{contractevent, Address};

// NOTE: Deposit/Withdraw/Mint/Redeem events are emitted automatically by OZ's
// stellar_tokens::vault::Vault — see stellar-tokens/src/vault/storage.rs.
// Defining duplicates here would cause the indexer's spec map (keyed by topic
// name) to collide with OZ's specs and mis-parse one of the two events.

#[contractevent(topics = ["settle"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlePnl {
    #[topic]
    pub trader: Address,
    pub amount: i128,
    pub reserved_delta: i128,
    pub is_profit: bool,
}

#[contractevent(topics = ["reserve"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reserve {
    pub amount: i128,
    pub new_total: i128,
}

#[contractevent(topics = ["release"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Release {
    pub amount: i128,
    pub new_total: i128,
}

#[contractevent(topics = ["fees"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccrueFees {
    pub amount: i128,
    pub new_total: i128,
}

#[contractevent(topics = ["claim"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFees {
    pub amount: i128,
    pub recipient: Address,
}

#[contractevent(topics = ["pause"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pause {
    pub is_paused: bool,
    pub caller: Address,
}
