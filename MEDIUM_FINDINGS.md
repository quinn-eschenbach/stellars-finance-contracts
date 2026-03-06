# Medium Severity Audit Findings (Deferred)

These issues were identified during the security audit but are deferred in favor of fixing critical/high severity items first.

## MED-1: execute_order Blocked During Pause — Traders Lose SL Protection

**File**: `contracts/position-manager/src/contract.rs:155-156`

When paused, keepers cannot execute TP/SL orders. But traders CAN close manually (bypass pause). If a trader set a stop-loss and goes offline, the keeper can't execute it during an emergency. The trader's SL is effectively disabled while they're unaware.

**Fix**: Remove `require_not_paused` from `execute_order` (same pattern as `liquidate_position` and `deleverage_position`).

---

## MED-2: Partial Close Doesn't Adjust TP/SL

**File**: `contracts/position-manager/src/logic.rs:436-448`

When partially closing a position, TP/SL prices remain unchanged. After a partial close, the remaining position has reduced collateral but the same TP/SL levels. Not necessarily wrong (TP/SL are price levels, not size-dependent), but worth reviewing whether this matches user expectations.

---

## MED-3: Funding Rate Overflow Fallback Loses Precision

**File**: `contracts/position-manager/src/math.rs:81-90`

The `checked_mul` overflow fallback uses integer division that truncates:
```rust
base_funding_rate * (imbalance / scale) / (total / scale)
```
For very large OI values, `imbalance / scale` truncates toward zero, producing less accurate funding rates. Under extreme conditions, funding rates could be lower than intended.

---

## MED-4: set_tp_sl Doesn't Respect Pause

**File**: `contracts/position-manager/src/contract.rs:162-167`

Traders can modify TP/SL during pause. While `execute_order` is also paused (so orders can't fire), a trader could set an aggressive TP during a crisis. The moment the protocol unpauses, a keeper immediately executes it at a potentially manipulated price.

---

## MED-5: Initial Market acc_borrow_index Starts at 0

**File**: `contracts/position-manager/src/storage.rs:216-224`

A new market defaults to `acc_borrow_index = 0` and `last_index_update = 0`. The first `do_update_indices` computes `time_delta = now - 0` (potentially billions of seconds). While the first position captures this jumped index (so no direct fee theft), it produces ugly index values and could cause intermediate overflow in the accumulation formula.

**Fix**: Set `last_index_update = env.ledger().timestamp()` and `acc_borrow_index = INDEX_PRECISION` when a market is first accessed.
