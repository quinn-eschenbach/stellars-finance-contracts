# Risk Management Parameters

All risk parameters live on-chain and are admin-settable through `ConfigManager`, `OracleRouter`, or `PositionManager`. Defaults are seeded in `shared/src/lib.rs` and applied by `ConfigManager::initialize`.

Units: `bps` = basis points (1 bp = 0.01%, 10_000 bps = 100%). Time values are unix seconds. USDC values use 6 decimals (`1 USDC = 1_000_000` raw); price values use 7 decimals (`PRECISION = 10_000_000`).

---

## 1. Liquidation gating

Set via `ConfigManager.update_protocol_limits(...)`.

### `liquidation_threshold_bps`

- Default: `200` (2%)
- Validation cap: `1_000` (10%)
- Type: `u32`

Liquidation triggers when `health < pos.collateral × liquidation_threshold_bps / 10_000`. Higher = liquidate earlier with a thicker safety margin (less bad-debt risk, more nuisance liquidations of marginal positions). `0` collapses to legacy strict `health < 0` semantics.

The keeper reads this same value from `protocol_config` and uses it as its scanning threshold, so on-chain and off-chain stay in sync.

---

## 2. Position sizing

### `min_collateral` — `ConfigManager.update_protocol_limits`

- Default: `10_000_000` (1 USDC)
- Validation: `>= 1`
- Type: `i128`

Floor on position collateral. Blocks dust positions that would be uneconomic to liquidate (gas + keeper fee could exceed seizable collateral).

### `max_leverage` (per market) — `PositionManager.set_max_leverage`

- Default: `0` per market until set
- Validation cap: `200` (`MAX_LEVERAGE_CAP` in `math.rs`)
- Type: `i128`

Maximum leverage allowed when opening or increasing a position on a specific symbol. Set to `0` to fully disable trading on a market. Per-market — different assets can run different ceilings.

### `min_position_lifetime` — `ConfigManager.update_protocol_limits`

- Default: `60` seconds
- Validation cap: `86_400` (24 hours)
- Type: `u64`

Minimum time between opening (or last increasing) a position and being allowed to decrease/close it. Anti-front-run lock that prevents oracle-frontrunning round-trips.

---

## 3. Capital efficiency / vault solvency

### `max_utilization_ratio` — `ConfigManager.update_protocol_limits`

- Default: `8_500` (85%)
- Validation cap: `10_000` (100%)
- Type: `i128` (bps)

Caps `reserved_usdc / total_assets`. New positions revert if they would push utilization above this. Lower = more LP buffer against trader profits, but less notional capacity.

---

## 4. Auto-deleveraging (ADL) triggers

Set via `ConfigManager.update_protocol_limits(...)`. ADL forcibly closes the most profitable, highest-leverage position when the vault would otherwise become insolvent.

### `adl_pnl_bps`

- Default: `9_000` (90%)
- Validation: `1..=10_000`
- Type: `u32`

Triggers ADL when `net_global_trader_pnl / total_assets > adl_pnl_bps / 10_000`. Lower = ADL fires sooner (LP-protective). Higher = traders keep their gains longer (LP risks insolvency).

### `adl_utilization_bps`

- Default: `9_500` (95%)
- Validation: `1..=10_000`
- Type: `u32`

Same idea on the utilization arm: ADL fires when `reserved / total_assets > adl_utilization_bps / 10_000`.

ADL ranks profitable positions by `unrealized_pnl × leverage` and closes the top-scored target.

---

## 5. LP withdrawal cooldown

### `cooldown_duration` — `ConfigManager.update_protocol_limits`

- Default: `300` seconds (5 minutes)
- Validation cap: `2_592_000` (30 days)
- Type: `u64`

Lockup applied to LP shares on every deposit/mint. **Frozen at deposit time** — the absolute unlock timestamp is stored as `LockupExpiresAt(user) = now + cooldown_duration`, so subsequent admin changes neither release nor extend existing locks. Multiple deposits reset the lock to the most recent `now + cooldown_duration`.

The cooldown also propagates on LP share transfer: if Alice transfers her shares to Bob, Bob inherits `max(Bob's current expiry, Alice's expiry)`. Without this, Alice could trivially bypass the cooldown by routing through a fresh address.

Zero-asset deposits and zero-share mints revert (`VaultError::ZeroAmount`) so a third party cannot extend a victim's cooldown for free.

---

## 6. Borrow & funding rate curve

Set via `ConfigManager.update_borrow_rate_config(...)`. All values in basis points (annualized for rates).

### `base_borrow_rate_bps`

- Default: `100` (1% APR)
- Validation: `>= 0`
- Type: `i128`

Floor borrow rate paid by all positions regardless of utilization.

### `slope1_bps`

- Default: `500` (5%)
- Validation: `>= 0`, `<= slope2_bps`
- Type: `i128`

Slope of the borrow rate curve **below** `optimal_utilization`. Total borrow APR at utilization `u <= optimal` = `base + slope1 × u / optimal`.

### `slope2_bps`

- Default: `5_000` (50%)
- Validation: `>= slope1_bps`
- Type: `i128`

Slope **above** `optimal_utilization`. Sharply discourages excess utilization by ramping fees on the marginal position.

### `optimal_utilization_bps`

- Default: `8_000` (80%)
- Validation: `1..=10_000`
- Type: `i128`

The kink point of the borrow curve. Setting this lower steepens the rate hike sooner; setting it higher delays the steep zone.

### `base_funding_rate_bps`

- Default: `100` (1% APR)
- Validation: `>= 0`
- Type: `i128`

Funding rate scalar applied to OI imbalance. Funding flows from the heavier side (longs or shorts) to the lighter side, scaled by this rate × imbalance ratio.

### `funding_cut_bps` — `ConfigManager.update_protocol_limits`

- Default: `500` (5%)
- Validation cap: `< 10_000`
- Type: `u32`

Protocol's cut of positive funding payments before they're distributed. Negative funding flows entirely to the receiving side (no cut).

---

## 7. Fee distribution

Set via `ConfigManager.update_fee_splits(...)`. The three fields must sum to exactly `10_000` and each must be `> 0`.

### `keeper_bps`

- Default: `500` (5%)
- Type: `u32`

Share routed to liquidation/order-execution keepers per close.

### `dev_bps`

- Default: `500` (5%)
- Type: `u32`

Share retained by the protocol treasury.

### `lp_bps`

- Default: `9_000` (90%)
- Type: `u32`

Share retained inside the vault for LPs.

---

## 8. Oracle safety

Set via `OracleRouter.set_oracle_config(...)` (global) and `OracleRouter.set_oracle_sources(symbol, primaries, secondaries)` (per asset).

### `max_deviation_bps`

- Type: `i128` (bps)

Maximum spread between primary oracle sources before `get_price` reverts as `PriceDeviationExceeded`. Computed as `max(max - median, median - min) × 10_000 / median`.

Lower = stricter consensus required, more pause-on-disagreement events. Higher = more tolerance, more risk of a manipulated source moving the median.

### `staleness_threshold`

- Type: `u64` (seconds)

Reject any SEP-40 feed whose `last_update` is older than `now - staleness_threshold`. Filters out frozen feeds.

### `cache_duration`

- Type: `u64` (seconds)

TTL on the router's median cache. Trade-off: longer cache = fewer cross-contract calls per liquidation tick (cheaper), shorter cache = fresher prices (better risk pricing).

### Primary / secondary sources (per symbol)

Set via `set_oracle_sources(symbol, primaries: Vec<Address>, secondaries: Vec<Address>)`.

- **Primaries**: the median is computed across these. Deduped by `set_oracle_sources` (first occurrence wins). Need at least 1 valid primary for a price to be returned.
- **Secondaries**: queried only if every primary fails (returns 0, panics, or stale). Use this for redundancy across heterogeneous oracle providers (e.g., primaries = Binance + Kucoin medians; secondaries = Pyth fallback).

---

## 9. Operational kill-switches

- `Vault.pause` (PAUSER role) — Blocks deposits, mints, withdraws, redeems, fee accrual.
- `Vault.unpause` (PAUSER role) — Resumes vault operations.
- `PositionManager.pause` (PAUSER role) — Blocks `increase_position`, `decrease_position`, `liquidate_position`, `deleverage_position`, `execute_order`, `update_indices`.
- `PositionManager.unpause` (PAUSER role) — Resumes. The pause-aware index update clamps `effective_start = max(last_index_update, last_unpause_time)` so borrow/funding fees do not retroactively accrue across the pause.
- `ConfigManager.grant_role` (ADMIN) — Adds an account to KEEPER, ORACLE, PAUSER, or UPGRADER.
- `ConfigManager.revoke_role` (ADMIN) — Removes an account from a role.
- `ConfigManager.transfer_admin` (ADMIN + new admin) — Moves the ADMIN role. New admin must also authorize, preventing irrecoverable bricking from a typo.
- Per-contract `_migrate` (UPGRADER) — Replace WASM and run the migration hook. Each contract has its own UPGRADER check.

---

## 10. Quick recipes

### Reduce bad-debt risk

- Raise `liquidation_threshold_bps` (e.g. 200 → 500).
- Lower per-market `max_leverage`.
- Lower `max_utilization_ratio` (e.g. 8500 → 7500).

### Protect LP solvency

- Lower `adl_pnl_bps` / `adl_utilization_bps` so ADL fires sooner.
- Lower `max_utilization_ratio`.
- Raise `cooldown_duration` to discourage flash-deposit-then-withdraw arbitrage around liquidations.

### Discourage flash-LP arbitrage

- Raise `cooldown_duration`. Locks are now frozen at deposit and propagate on share transfer, so this is a real constraint.

### Harden oracle layer

- Lower `max_deviation_bps` (stricter source consensus).
- Lower `staleness_threshold` (reject older feeds).
- Lower `cache_duration` (use fresher prices, at higher cost).
- Add more primary sources for cross-checking.

### Emergency

- PAUSER calls `Vault.pause` and `PositionManager.pause`. They unpause independently — vault and trading can be reopened in either order.

---

## 11. Where defaults are defined

All default constants are in `shared/src/lib.rs`:

- `DEFAULT_KEEPER_BPS = 500`
- `DEFAULT_DEV_BPS = 500`
- `DEFAULT_LP_BPS = 9_000`
- `DEFAULT_MIN_COLLATERAL = 10_000_000` (1 USDC)
- `DEFAULT_COOLDOWN_DURATION = 300` (5 minutes)
- `DEFAULT_MIN_POSITION_LIFETIME = 60` (60 seconds)
- `DEFAULT_MAX_UTILIZATION_RATIO = 8_500` (85%)
- `DEFAULT_FUNDING_CUT_BPS = 500` (5%)
- `DEFAULT_ADL_PNL_BPS = 9_000` (90%)
- `DEFAULT_ADL_UTILIZATION_BPS = 9_500` (95%)
- `DEFAULT_LIQUIDATION_THRESHOLD_BPS = 200` (2%)
- `DEFAULT_BASE_BORROW_RATE_BPS = 100` (1% APR)
- `DEFAULT_SLOPE1_BPS = 500` (5%)
- `DEFAULT_SLOPE2_BPS = 5_000` (50%)
- `DEFAULT_OPTIMAL_UTILIZATION_BPS = 8_000` (80%)
- `DEFAULT_BASE_FUNDING_RATE_BPS = 100` (1% APR)

Validation caps live in `ConfigManager::update_protocol_limits` (`contracts/config-manager/src/contract.rs`) and in `PositionManager::math::MAX_LEVERAGE_CAP`.
