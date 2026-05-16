# Stellars Finance Contracts

Domain glossary for the perpetual-DEX protocol contracts (Vault, PositionManager, ConfigManager, OracleRouter). Established terms and their preferred form.

## Language

### Position lifecycle

**Position**:
A trader's open exposure to a single Market — size, collateral, entry price, entry indices, direction.
_Avoid_: trade, account

**Market**:
A single trading pair's on-chain state — open interest, global average prices, accumulated borrow/funding indices.
_Avoid_: pair, instrument

**Increase**:
Adding to a Position (or opening a new one). Stakes collateral and reserves Vault liquidity.
_Avoid_: open, enter

**Close**:
Reducing or fully closing a Position. Releases Reservation and settles PnL.
_Avoid_: exit, unwind

**Close kind**:
The four reasons a Position Closes — `User`, `Liquidation`, `Deleverage` (ADL), `OrderExecution` (TP/SL). Determines fee distribution and the routing of any TP/SL execution-fee escrow. Encoded as `CloseType` in code. `Liquidation` and `OrderExecution` are permissionless — anyone may call them and the caller is the **Executor** that receives the resulting Liquidation bounty or TP/SL execution-fee escrow. `Deleverage` is keeper-gated.

**Executor**:
The caller of a permissionless Close (`Liquidation` or `OrderExecution`). Receives the Liquidation bounty (Liquidation) or the TP/SL execution-fee escrow (OrderExecution).
_Avoid_: keeper (specifically: don't call the Executor a keeper — KEEPER is a role used for `Deleverage` and oracle/index keepalive, not Close-time bounty payouts)

### Market evaluation

**MarketTick**:
A snapshot of a Market's state at time T, bundling refreshed borrow/funding indices with mark price. Constructed two ways, both yielding identical shape and `evaluate` / `is_tp_triggered` / `is_sl_triggered` semantics:
- _On-chain (canonical):_ `MarketTick::refresh(env, symbol)` updates indices in storage, pushes Unrealized PnL to the Vault, and emits `UpdateIndices`.
- _Off-chain (projected):_ the `protocol-math` TS package derives a tick from cached indices by projecting forward to `now` using the same accumulation formulas the contract uses. Pure, no writes. Matches what an immediate on-chain refresh would produce.
_Avoid_: snapshot, view, context

**PositionEvaluation**:
The four derived values for a Position slice (`size`, `collateral`) against a MarketTick — `pnl`, `borrow_fee`, `funding_fee`, `health`. Returned by `MarketTick::evaluate`.
_Avoid_: assessment, status

### Settlement

**Reservation**:
USDC liquidity earmarked in the Vault to back open Position size. Decremented on Close.
_Avoid_: lock, allocation

**Realized PnL**:
Accumulated profit/loss from closed Positions, stored in PositionManager.

**Unrealized PnL**:
Derived value from open Positions' size and entry vs. mark price. Tracked per-Market and as a global total, pushed to Vault for free-liquidity calculations.

**Funding cut**:
Protocol's share of trader-paid funding fees, configured via `ProtocolLimits.funding_cut_bps`.

### Fees

The protocol charges fees on two distinct tracks. Mixing the two when discussing money flow is a common source of confusion.

**Revenue split**:
The lp/dev/staker partition of every revenue dollar, configured via `FeeSplits { lp_bps, dev_bps, staker_bps }`. Applied to Open fee, the borrow-fee component of close-time fees, the Funding cut, and forfeited TP/SL execution-fee escrows on Liquidation. The lp slice stays in the Vault's `total_assets` (implicit); the dev+staker slice accrues to `unclaimed_fees` and is later distributed by admin.

**Execution bounties**:
The flat or proportional payments to whoever calls a permissionless Close path. Configured via `FeeConfig { open_fee_bps, liquidation_bounty_bps, tp_sl_execution_fee }`. Distinct from the Revenue split — bounties are paid to the **Executor**, not into the Vault's revenue accounting.

**Open fee**:
A revenue fee charged on Increase, computed as `size * open_fee_bps / BPS`. Trader→PM→Vault. Sliced by the Revenue split.
_Avoid_: opening fee, mint fee

**Liquidation bounty**:
The Executor's payout on Liquidation, computed as `min(collateral * liquidation_bounty_bps / BPS, absorbed_collateral)`. Strict priority over the Revenue split — the bounty is paid first, and the Revenue split only sees what remains. Funded from absorbed collateral; never from LP capital.
_Avoid_: liquidation fee, liquidator reward

**TP/SL execution-fee escrow**:
A flat USDC amount (`tp_sl_execution_fee`) collected from the trader when a Position first has TP or SL set, held on the Position itself (`execution_fee_escrow` field). Routed at Close by Close kind: refunded on `User` (full close) or `Deleverage`; paid to the Executor on `OrderExecution`; forfeited to the Vault and run through the Revenue split on `Liquidation`. On partial `User` Close, the escrow stays with the surviving Position. Charged once per Position — adding TP after SL (or vice versa) does not stack escrows.
_Avoid_: TP/SL fee, keeper escrow, execution gas

## Relationships

- A **Position** is held by exactly one trader against one **Market**
- A **MarketTick** captures one **Market** at one point in time and is consumed within a single operation
- A **MarketTick** evaluates a **Position** to produce a **PositionEvaluation**
- A **Close** of a Position releases its **Reservation** and folds its outcome into **Realized PnL**
- A Market's **Unrealized PnL** is a function of all open Positions on it
- An **Open fee** is sliced by the **Revenue split** at Increase time; close-time borrow + funding-cut accruals are sliced by the same Revenue split at Close
- A **Liquidation bounty** is paid to the **Executor** out of absorbed collateral before the Revenue split sees anything
- A **TP/SL execution-fee escrow** is held on a Position from first TP/SL set until Close; its destination at Close is fixed by the Close kind

## Example dialogue

> **Dev:** "When a keeper triggers liquidation, are fees computed against the same indices the trader saw when they opened?"
> **Protocol designer:** "No — refresh first. Producing a **MarketTick** runs the index update; the resulting **PositionEvaluation** uses the fresh `acc_borrow_index` and `acc_funding_index`. The trader's entry indices live on the Position, so the borrow fee is the index delta times size."

> **Dev:** "If a Position's collateral can't cover all the fees, do LPs eat the difference?"
> **Protocol designer:** "Only on **Liquidation** — fees are capped to collateral. A solvent **Close** deducts fees from the trader's would-be payout, not from collateral, so the cap doesn't bind."
