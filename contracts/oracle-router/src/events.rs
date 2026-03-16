use soroban_sdk::{contractevent, Env, Symbol};

#[contractevent(topics = ["price"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceFetch {
    #[topic]
    pub symbol: Symbol,
    pub price: i128,
    pub timestamp: u64,
}

#[contractevent(topics = ["orccfg"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleConfigUpdate {
    pub staleness: u64,
    pub deviation: i128,
    pub cache_duration: u64,
}
