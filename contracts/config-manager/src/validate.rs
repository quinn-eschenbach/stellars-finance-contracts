//! Bounds validation for ConfigManager-tunable structs. Each rule fires a
//! distinct error code so off-chain monitors can identify which constraint
//! was violated. The catch-all codes (`InvalidFeeSplits=4`, `InvalidLimits=5`)
//! remain in the enum for backward compatibility but the validation paths
//! below use the per-rule codes (20–43).
//!
//! Pattern: `value.validate(&env)` panics on the first violation. Used at
//! every entrypoint that accepts one of these wire structs so a future
//! mutator cannot bypass the bounds.

use shared::{BorrowRateConfig, FeeSplits, ProtocolLimits};
use shared::constants::{
    BPS, MAX_COOLDOWN_DURATION, MAX_FUNDING_CUT_BPS, MAX_SLOPE2_BPS, MIN_ADL_PNL_BPS,
};
use soroban_sdk::{panic_with_error, Env};

use crate::errors::ConfigManagerError;

/// Concentrates the bounds invariants for the three tunable wire structs.
/// Implemented locally — orphan rule prevents adding `impl` blocks on
/// `shared` types directly.
pub trait Validate {
    /// Panics with the rule-specific `ConfigManagerError` variant on
    /// failure; returns normally otherwise.
    fn validate(&self, env: &Env);
}

impl Validate for FeeSplits {
    fn validate(&self, env: &Env) {
        if self.keeper_bps == 0 || self.dev_bps == 0 || self.lp_bps == 0 {
            panic_with_error!(env, ConfigManagerError::InvalidFeeSplitZero);
        }
        let bps_u32 = BPS as u32;
        // Per-component pre-check avoids u32 overflow on adversarial inputs
        // like (u32::MAX, 1, 1). Each component must independently fit in BPS.
        if self.keeper_bps > bps_u32 || self.dev_bps > bps_u32 || self.lp_bps > bps_u32 {
            panic_with_error!(env, ConfigManagerError::InvalidFeeSplitOverBps);
        }
        if self.keeper_bps + self.dev_bps + self.lp_bps != bps_u32 {
            panic_with_error!(env, ConfigManagerError::InvalidFeeSplitSum);
        }
    }
}

impl Validate for ProtocolLimits {
    fn validate(&self, env: &Env) {
        if self.min_collateral < 1 {
            panic_with_error!(env, ConfigManagerError::InvalidMinCollateral);
        }
        if self.max_utilization_ratio < 1 || self.max_utilization_ratio > BPS {
            panic_with_error!(env, ConfigManagerError::InvalidMaxUtilization);
        }
        if self.funding_cut_bps > MAX_FUNDING_CUT_BPS {
            panic_with_error!(env, ConfigManagerError::InvalidFundingCut);
        }
        if self.adl_pnl_bps < MIN_ADL_PNL_BPS || self.adl_pnl_bps > (BPS as u32) {
            panic_with_error!(env, ConfigManagerError::InvalidAdlPnl);
        }
        if self.adl_utilization_bps < 1 || self.adl_utilization_bps > (BPS as u32) {
            panic_with_error!(env, ConfigManagerError::InvalidAdlUtilization);
        }
        if self.liquidation_threshold_bps > (BPS as u32) / 10 {
            panic_with_error!(env, ConfigManagerError::InvalidLiquidationThreshold);
        }
        if self.cooldown_duration > MAX_COOLDOWN_DURATION {
            panic_with_error!(env, ConfigManagerError::InvalidCooldownDuration);
        }
        if self.min_position_lifetime > 86_400 {
            panic_with_error!(env, ConfigManagerError::InvalidMinPositionLifetime);
        }
    }
}

impl Validate for BorrowRateConfig {
    fn validate(&self, env: &Env) {
        if self.base_borrow_rate_bps < 0
            || self.slope1_bps < 0
            || self.slope2_bps < 0
            || self.base_funding_rate_bps < 0
        {
            panic_with_error!(env, ConfigManagerError::InvalidBorrowRateNegative);
        }
        if self.optimal_utilization_bps < 1 || self.optimal_utilization_bps > BPS {
            panic_with_error!(env, ConfigManagerError::InvalidOptimalUtilization);
        }
        if self.slope2_bps < self.slope1_bps {
            panic_with_error!(env, ConfigManagerError::InvalidSlopeOrdering);
        }
        if self.slope2_bps > MAX_SLOPE2_BPS {
            panic_with_error!(env, ConfigManagerError::InvalidSlopeTooSteep);
        }
    }
}
