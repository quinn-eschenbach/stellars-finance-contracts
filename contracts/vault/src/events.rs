use soroban_sdk::{contractevent, Address};

#[contractevent(topics = ["deposit"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposit {
    #[topic]
    pub receiver: Address,
    pub assets: i128,
    pub shares: i128,
    pub from: Address,
}

#[contractevent(topics = ["withdraw"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdraw {
    #[topic]
    pub owner: Address,
    pub assets: i128,
    pub shares: i128,
    pub receiver: Address,
}

#[contractevent(topics = ["mint"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mint {
    #[topic]
    pub receiver: Address,
    pub shares: i128,
    pub assets: i128,
    pub from: Address,
}

#[contractevent(topics = ["redeem"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Redeem {
    #[topic]
    pub owner: Address,
    pub shares: i128,
    pub assets: i128,
    pub receiver: Address,
}

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
