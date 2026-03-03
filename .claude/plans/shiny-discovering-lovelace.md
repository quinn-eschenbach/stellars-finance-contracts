# PositionManager Implementation Plan (TDD)

## Context

The PositionManager is the trading engine for the Stellars Finance perpetual DEX. Three contracts are complete (ConfigManager: 83 tests, OracleRouter: 113 tests, Vault: 142 tests). The PositionManager has boilerplate only — all 10 methods are `todo!()` stubs. This plan implements the full contract using the established TDD workflow.

## Architecture Changes

**File structure** (matching Vault/OracleRouter pattern):
```
contracts/position-manager/src/
  lib.rs          — mod declarations + re-exports only (restructure from current)
  contract.rs     — trait + #[contractimpl] thin routing (move from lib.rs)
  errors.rs       — already complete (10 variants)
  types.rs        — already complete (Position, MarketInfo)
  storage.rs      — add getter/setter helpers (currently only StorageKey enum)
  logic.rs        — NEW: guards + business logic orchestration
  math.rs         — NEW: pure fee/PnL/health calculations
```

**Key design decisions:**
1. Add `oracle_router: Address` to `initialize` signature (needed for price feeds)
2. Add `pause`/`unpause` to public trait (missing from current interface)
3. PM holds trader collateral USDC directly (vault's `settle_pnl(is_profit=false)` transfers from caller/PM to vault)
4. Add `TotalReserved` + `OracleRouter` to StorageKey enum
5. Borrow/funding rate params hardcoded in `math.rs` for V1
6. `execute_order` left as V2 stub (panics not-implemented)
7. Scaling: prices = 1e7, index accumulators = 1e14

## TDD Units (in execution order)

### Unit 0: Scaffolding
- Add `shared = { workspace = true }` + dev-deps to `Cargo.toml`
- Restructure `lib.rs` → `contract.rs` (move trait + impl)
- Add `OracleRouter`, `TotalReserved` to `StorageKey`
- Create empty `math.rs`, `logic.rs`, `tests/` dir

### Unit 1: Storage Helpers (~14 tests)
`tests/test_storage.rs` — getter/setters for all StorageKey variants
- Instance: `is_initialized`, `set_initialized`, `get/set_vault_address`, `get/set_config_manager`, `get/set_oracle_router`, `get/set_paused`, `get/set_total_reserved`
- Persistent: `get/set/delete_position` (by PositionKey), `get/set_market` (by Symbol, default zeros if missing)

### Unit 2: Math Module (~25 tests)
`tests/test_math.rs` — pure functions, no Env dependency

| Function | Purpose |
|----------|---------|
| `calc_unrealized_pnl(size, entry_price, mark_price, is_long)` | Long: `size * (mark - entry) / entry` |
| `calc_borrow_fee(size, entry_idx, current_idx)` | `(current - entry) * size / INDEX_PRECISION` |
| `calc_funding_fee(size, entry_idx, current_idx, is_long)` | Signed; longs pay when positive |
| `calc_health(collateral, pnl, borrow_fee, funding_fee)` | `collateral + pnl - borrow_fee + funding_fee` |
| `calc_borrow_rate(utilization_bps, ...)` | Kink curve: slope1 below optimal, slope2 above |
| `calc_funding_rate(long_oi, short_oi, base_rate)` | `base * (L-S)/(L+S)` |
| `accumulate_borrow_index(current, rate, dt)` | `current + rate * dt / SECONDS_PER_YEAR` |
| `accumulate_funding_index(current, rate, dt)` | Same, but signed |
| `update_global_avg_price(avg, size, new_price, new_size)` | Volume-weighted average |
| `calc_utilization_bps(reserved, total)` | `reserved * 10_000 / total` |

### Unit 3: Logic Guards (~4 tests)
`tests/test_initialize.rs` — `require_initialized`, `require_not_initialized`, `require_not_paused`, `require_keeper`, `require_pauser`, `require_upgrader`

### Unit 4: Initialize (~5 tests)
- Stores vault, config_manager, oracle_router, sets initialized flag
- Double init reverts (AlreadyInitialized)
- Implements `UpgradeableMigratableInternal` (_require_auth via UPGRADER role)

### Unit 5: update_indices (~8 tests)
- KEEPER-only. Calculates borrow rate from utilization (kink curve), funding rate from OI imbalance
- Accumulates `acc_borrow_index` and `acc_funding_index` on MarketInfo
- Updates `last_index_update` timestamp. Zero time delta = no-op

### Unit 6: increase_position (~15 tests)
- Reverts if paused, zero amounts, utilization cap breached (>85%)
- `trader.require_auth()` + USDC transfer from trader to PM
- Fetches oracle price as `entry_price`
- Records `entry_borrow_index`, `entry_funding_index` from market
- Records `last_increased_time` (anti-front-running)
- Updates MarketInfo: global avg price (weighted), OI
- Calls `vault.reserve_liquidity(size)` — earmarks vault funds for potential payout

### Unit 7: decrease_position (~15 tests)
- **Bypasses pause check** (users can always reduce risk)
- Reverts if `current_time < last_increased_time + min_position_lifetime`
- Calculates PnL, borrow fee, funding fee
- Profit: `vault.settle_pnl(trader, profit, reserved_delta, true)` + return collateral
- Loss: `vault.settle_pnl(PM, loss, reserved_delta, false)` + return remaining collateral
- Full close deletes position; partial close updates proportionally
- Calls `vault.accrue_fees` for protocol's fee cut

### Unit 8: liquidate_position (~10 tests)
- KEEPER-only. Works when paused (keepers must liquidate anytime)
- Checks health < 0 (collateral + PnL - fees)
- Seizes remaining collateral → vault. Deletes position. Updates OI

### Unit 9: deverage_position / ADL (~8 tests)
- KEEPER-only. ADL triggers: reserved PnL > 90% vault balance OR utilization > 95%
- Force-closes position; trader keeps all accrued profits
- Reverts `AdlNotTriggered` if neither condition met

### Unit 10: Pause/Unpause + Views + bump_position (~8 tests)
- `pause`/`unpause` — PAUSER role
- `get_position` — returns Position or panics NotFound
- `get_market` — returns MarketInfo (default zeros)
- `bump_position` — extends persistent storage TTL
- `execute_order` — V2 stub

### Unit 11: Integration Fixture
- Build `Fixture::deploy()` in `test-suites/src/testutils/mod.rs`
- Deploy: ConfigManager → MockToken → MockOracle → OracleRouter → Vault → PositionManager
- Wire roles (KEEPER, PAUSER, UPGRADER), set ProtocolLimits, mint USDC
- Un-ignore and implement the 20 integration tests in `test-suites/tests/position_manager_tests.rs`

## Critical Files
- `contracts/position-manager/Cargo.toml` — add `shared` dep
- `contracts/position-manager/src/storage.rs` — build all helpers
- `contracts/position-manager/src/math.rs` — create (pure calculations)
- `contracts/position-manager/src/logic.rs` — create (guards + orchestration)
- `contracts/position-manager/src/contract.rs` — create (moved from lib.rs)
- `contracts/position-manager/src/lib.rs` — restructure to mod-only
- `contracts/vault/src/contract.rs` — reference for VaultClient interface
- `shared/src/lib.rs` — reuse: require_role, bump_instance_ttl, Sep40OracleClient

## Verification
1. Each TDD unit: test-writer creates failing tests → code-writer makes them pass → `cargo test -p position-manager`
2. After all units: `cargo test -p test-suites` for integration tests
3. Final: audit-agent reviews completed module
4. `make build` to verify WASM compilation
