use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger, LedgerInfo},
    vec, Address, Env, Symbol,
};

use config_manager::{ConfigManagerClient, ConfigManagerContract};
use mock_oracle::{MockOracle, MockOracleClient};
use mock_token::{MockToken, MockTokenClient};
use oracle_router::{OracleConfig, OracleRouterClient, OracleRouterContract};
use position_manager::{PositionManagerClient, PositionManagerContract};
use vault::{VaultContract, VaultContractClient};

/// BTC price: $50,000 scaled by 1e7
pub const BTC_PRICE: i128 = 500_000_000_000; // 50_000 * 1e7

/// 1 USDC = 1_000_000 (6 decimals)
pub const USDC_UNIT: i128 = 1_000_000;

/// Default vault deposit: 1,000,000 USDC
pub const VAULT_DEPOSIT: i128 = 1_000_000 * USDC_UNIT;

/// Trader starting balance: 100,000 USDC
pub const TRADER_BALANCE: i128 = 100_000 * USDC_UNIT;

/// Ledger timestamp
pub const TEST_TIMESTAMP: u64 = 1_700_000_000;

/// A fully-deployed protocol fixture for integration tests.
///
/// Call `Fixture::deploy(&env)` at the start of each test to get a fresh,
/// pre-configured set of contracts wired together and ready to use.
pub struct Fixture<'a> {
    pub env: &'a Env,
    pub admin: Address,
    pub keeper: Address,
    pub trader: Address,
    pub config_manager: ConfigManagerClient<'a>,
    pub vault: VaultContractClient<'a>,
    pub position_manager: PositionManagerClient<'a>,
    pub oracle_router: OracleRouterClient<'a>,
    pub usdc: MockTokenClient<'a>,
    pub mock_oracle: MockOracleClient<'a>,
    pub pm_addr: Address,
    pub vault_addr: Address,
}

impl<'a> Fixture<'a> {
    /// Deploy all protocol contracts, configure roles, and wire them together.
    pub fn deploy(env: &'a Env) -> Self {
        env.mock_all_auths();

        env.ledger().set(LedgerInfo {
            timestamp: TEST_TIMESTAMP,
            protocol_version: 23,
            sequence_number: 100,
            network_id: [0u8; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 100,
            min_persistent_entry_ttl: 100,
            max_entry_ttl: 10_000_000,
        });

        let admin = Address::generate(env);
        let keeper = Address::generate(env);
        let trader = Address::generate(env);
        let lp = Address::generate(env);

        // 1. ConfigManager — grant roles
        let config_id = env.register(ConfigManagerContract, ());
        let config_manager = ConfigManagerClient::new(env, &config_id);
        config_manager.initialize(&admin);

        let pauser_role = Symbol::new(env, "PAUSER");
        let keeper_role = Symbol::new(env, "KEEPER");
        // let admin_role = Symbol::new(env, "ADMIN");
        config_manager.grant_role(&admin, &pauser_role, &admin);
        config_manager.grant_role(&admin, &keeper_role, &admin);
        config_manager.grant_role(&admin, &keeper_role, &keeper);

        // Set fee splits: 5% keeper, 5% dev, 90% LP
        config_manager.update_fee_splits(
            &admin,
            &config_manager::FeeSplits {
                keeper_bps: 500,
                dev_bps: 500,
                lp_bps: 9000,
            },
        );

        // Set protocol limits
        config_manager.update_protocol_limits(
            &admin,
            &config_manager::ProtocolLimits {
                min_collateral: 1_000_000,
                cooldown_duration: 60,
                min_position_lifetime: 60,
                max_utilization_ratio: 8_500,
                funding_cut_bps: 500,
                adl_pnl_bps: 9_000,
                adl_utilization_bps: 9_500,
                liquidation_threshold_bps: 200,
            },
        );

        config_manager.update_borrow_rate_config(
            &admin,
            &config_manager::BorrowRateConfig {
                base_borrow_rate_bps: 100,
                slope1_bps: 500,
                slope2_bps: 5_000,
                optimal_utilization_bps: 8_000,
                base_funding_rate_bps: 100,
            },
        );

        // 2. MockToken (USDC) + MockOracle
        let usdc_id = env.register(MockToken, ());
        let usdc = MockTokenClient::new(env, &usdc_id);
        usdc.initialize(
            &admin,
            &6u32,
            &soroban_sdk::String::from_str(env, "USD Coin"),
            &soroban_sdk::String::from_str(env, "USDC"),
        );

        let oracle_id = env.register(MockOracle, ());
        let mock_oracle = MockOracleClient::new(env, &oracle_id);
        mock_oracle.initialize();
        mock_oracle.set_price(&symbol_short!("BTC"), &BTC_PRICE);

        // 3. OracleRouter — link to ConfigManager + MockOracle
        let oracle_router_id = env.register(OracleRouterContract, ());
        let oracle_router = OracleRouterClient::new(env, &oracle_router_id);
        oracle_router.initialize(&admin, &config_id);
        oracle_router.set_oracle_config(
            &admin,
            &OracleConfig {
                max_deviation_bps: 500,
                staleness_threshold: 3600,
                cache_duration: 10,
                min_required_sources: 1,
            },
        );
        oracle_router.set_oracle_sources(
            &admin,
            &symbol_short!("BTC"),
            &vec![env, oracle_id.clone()]);

        // 4. PositionManager (register first to get address for Vault)
        let pm_id = env.register(PositionManagerContract, ());
        let position_manager = PositionManagerClient::new(env, &pm_id);

        // 5. Vault — link to ConfigManager + PositionManager
        let vault_id = env.register(VaultContract, ());
        let vault = VaultContractClient::new(env, &vault_id);
        vault.initialize(&admin, &usdc_id, &config_id, &pm_id);

        // 6. Initialize PositionManager
        position_manager.initialize(&admin, &vault_id, &config_id, &oracle_router_id);

        // Set per-market max leverage
        position_manager.set_max_leverage(&admin, &symbol_short!("BTC"), &100_i128);

        // Fund accounts
        usdc.mint(&trader, &TRADER_BALANCE);
        usdc.mint(&lp, &VAULT_DEPOSIT);
        vault.deposit(&VAULT_DEPOSIT, &lp, &lp, &lp);

        Fixture {
            env,
            admin,
            keeper,
            trader,
            config_manager,
            vault,
            position_manager,
            oracle_router,
            usdc,
            mock_oracle,
            pm_addr: pm_id,
            vault_addr: vault_id,
        }
    }

    /// Create a funded trader address with the given USDC balance.
    pub fn create_funded_trader(&self, amount: i128) -> Address {
        let trader = Address::generate(self.env);
        self.usdc.mint(&trader, &amount);
        trader
    }

    /// Shorthand: open a long BTC position.
    pub fn open_long(&self, trader: &Address, size: i128, collateral: i128) {
        self.position_manager.increase_position(
            trader,
            &symbol_short!("BTC"),
            &size,
            &collateral,
            &true,
            &0,
            &0, &0i128
    );
    }

    /// Shorthand: open a short BTC position.
    pub fn open_short(&self, trader: &Address, size: i128, collateral: i128) {
        self.position_manager.increase_position(
            trader,
            &symbol_short!("BTC"),
            &size,
            &collateral,
            &false,
            &0,
            &0, &0i128
    );
    }

    /// Set the BTC oracle price. `price_usd` is in whole dollars (e.g. 50_000).
    pub fn set_btc_price(&self, price_usd: i128) {
        let scaled = price_usd * 10_000_000;
        self.mock_oracle.set_price(&symbol_short!("BTC"), &scaled);
    }

    /// Advance the ledger timestamp and refresh oracle price.
    pub fn advance_time(&self, new_ts: u64) {
        self.env.ledger().set(LedgerInfo {
            timestamp: new_ts,
            protocol_version: 23,
            sequence_number: 100 + ((new_ts - TEST_TIMESTAMP) as u32),
            network_id: [0u8; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 100,
            min_persistent_entry_ttl: 100,
            max_entry_ttl: 10_000_000,
        });
    }
}
