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
The four reasons a Position Closes — `User`, `Liquidation`, `Deleverage` (ADL), `OrderExecution` (TP/SL). Determines fee distribution. Encoded as `CloseType` in code.

### Market evaluation

**MarketTick**:
A snapshot of a Market's state immediately after refreshing borrow and funding indices, carrying mark price. The only way to obtain one is `MarketTick::refresh(env, symbol)`, which performs the index update and pushes Unrealized PnL to the Vault.
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

## Relationships

- A **Position** is held by exactly one trader against one **Market**
- A **MarketTick** captures one **Market** at one point in time and is consumed within a single operation
- A **MarketTick** evaluates a **Position** to produce a **PositionEvaluation**
- A **Close** of a Position releases its **Reservation** and folds its outcome into **Realized PnL**
- A Market's **Unrealized PnL** is a function of all open Positions on it

## Example dialogue

> **Dev:** "When a keeper triggers liquidation, are fees computed against the same indices the trader saw when they opened?"
> **Protocol designer:** "No — refresh first. Producing a **MarketTick** runs the index update; the resulting **PositionEvaluation** uses the fresh `acc_borrow_index` and `acc_funding_index`. The trader's entry indices live on the Position, so the borrow fee is the index delta times size."

> **Dev:** "If a Position's collateral can't cover all the fees, do LPs eat the difference?"
> **Protocol designer:** "Only on **Liquidation** — fees are capped to collateral. A solvent **Close** deducts fees from the trader's would-be payout, not from collateral, so the cap doesn't bind."
