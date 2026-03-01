## 1. Abstract

This protocol is a decentralized, non-custodial perpetual exchange built on the Soroban smart contract platform. It utilizes a unified liquidity pool model (GLP-style) where Liquidity Providers (LPs) act as the counterparty to all traders. The protocol supports leveraged trading of assets with zero price impact, relying on oracle feeds for pricing.

The system employs a **Single-Asset Vault (USDC)** architecture. LPs deposit USDC to mint a liquid, interest-bearing SEP-41 token (STELLARS_LP), while traders use USDC as collateral to open Long or Short positions. Solvency is maintained via a network of Keeper bots that perform liquidations, update funding rates, and execute Auto-Deleveraging (ADL) when necessary.

---

## 2. Core Contracts & State Layout

The protocol consists of four interacting smart contracts. State is managed to ensure $O(1)$ scalability (no looping) and strict data availability.

### 2.1 `Vault` (Liquidity & Token)

**Role:** The central treasury. It holds all USDC liquidity and implements the **SEP-41** token standard for the LP share token (`STELLARS_LP`). It acts as the "Bank" that settles PnL and calculates the exchange rate for LPs.

**State Variables (`Persistent` Storage):**
- **Token Ledger (SEP-41 Standard):**
    - `TotalSupply`: Total amount of `GMXLP` tokens in existence.
    - `Balances`: Map of `Address -> Amount` (User LP balances).
    - `Allowances`: Map of `(Owner, Spender) -> Amount`.
- **Asset Tracking:**
    - `TotalUSDC`: The actual `contract.balance` of USDC held in the vault.
    - `ReservedUSDC`: The total amount of USDC currently "locked" as collateral for open positions. This prevents LPs from withdrawing funds that are backing active trades.
    
- **Financials:**
    - `CumulativeRealizedPnL`: Net profit/loss from all closed trades (for analytics/APR tracking).

**Key Functions:**

- `deposit(amount)`: Transfers USDC in, calculates current share price (including unrealized PnL from `PositionManager`), and mints `STELLARS_LP`.
- `withdraw(amount)`: Burns `STELLARS_LP`, calculates share price, and transfers USDC out.
- `settle_pnl(amount, is_profit)`: Callable only by `PositionManager`. Sends profit to traders or absorbs losses into the pool.

---

### 2.2 `PositionManager` (Trading Engine)

**Role:** The core logic contract. It merges "Market" and "Position" state to reduce cross-contract calls. It manages trading logic, calculates fees via Lazy Evaluation, and tracks global average prices for real-time PnL estimation.

**State Variables (`Persistent` Storage):**
#### A. Market Configuration & Indices (Key: `Symbol`)

Stored as a `MarketInfo` struct. **Every market (BTC, ETH, XLM) has its own independent entry.**
- **Open Interest (OI):**
    - `LongOI`: Total size of active Longs (USD value).
    - `ShortOI`: Total size of active Shorts (USD value).

- **Fee Accumulators ("Lazy Evaluation"):**
    - `AccBorrowIndex`: The cumulative borrow fee per share since market inception.
    - `AccFundingIndex`: The cumulative funding rate per share (tracks Long vs Short imbalance).

- **Global Average Pricing (For Unrealized PnL):**    
    - `GlobalLongAvgPrice`: The volume-weighted average entry price of _all_ active Longs.
    - `GlobalShortAvgPrice`: The volume-weighted average entry price of _all_ active Shorts.

- **Risk Parameters:**
    - `MaxLeverage`: e.g., 50x (500,000 basis points).
    - `MaxGlobalOI`: Cap on total exposure relative to Vault liquidity.
    - `BaseBorrowRate`: The minimum interest rate for this specific asset.
#### B. User Positions (Key: `Address, Symbol`)

Stored as a `Position` struct. A user has only **one** netted position per market.
- **Increasing:** Executing a trade in the **same** direction averages the entry price.
- **Decreasing:** Executing a trade in the **opposite** direction closes/reduces the existing position and realizes PnL.
- **Benefits:** This design prevents "wash trading" (farming volume against oneself) and simplifies the User Interface and Health Factor calculations.

- **Core Data:**
    - `Size`: Position size in USD.
    - `Collateral`: Margin in USDC.
    - `AveragePrice`: The user's specific weighted entry price.
    - `IsLong`: Direction boolean.

- **Entry Snapshots (For Fee Calculation):**
    - `EntryBorrowIndex`: Value of `Market.AccBorrowIndex` when position was last modified.
    - `EntryFundingIndex`: Value of `Market.AccFundingIndex` when position was last modified.

- **Metadata:**
    - `LastIncreasedTime`: Timestamp for calculating minimum holding duration.        

**Key Functions:**
- `increase_position(...)`: Opens/Adds to a position. Updates `GlobalAvgPrice` and Fee Indices.
- `decrease_position(...)`: Closes/Reduces a position. Settles PnL via `Vault`.
- `liquidate_position(...)`: Callable by Keepers. Checks if `Collateral < Fees + Loss`.
- `get_total_unrealized_pnl()`: Helper called by `Vault` to price LP tokens.

---

### 2.3 `ConfigManager` (Governance)

**Role:** Stores global protocol variables and access controls.

**State Variables (`Instance` Storage):**

- **Access Control:**
    - `Admin`: Address capable of upgrading contracts.
    - `Keepers`: List of whitelisted bot addresses authorized to execute liquidations and updates.

- **Fee Configuration:**    
    - `DepositFee`: Fee charged on LP minting (prevents arbitrage).     
    - `FeeSplits`: Struct defining distribution (e.g., 5% to Keepers, 5% to Dev, 90% to Vault, x% for token holders if we launch a token). Needs to support multiple splits + receiver addresses, so we could support token launch and/or buybacks, extra rewards...
    - used for borrow rates, PnL settlement, 

- **Global Limits:**
    - `MinCollateral`: Minimum USDC required to open a position (prevents dust attacks).
    - `CooldownDuration`: Time required between `Vault.deposit` and `Vault.withdraw`.

---

### 2.4 `OracleRouter` (Pricing)

**Role:** Aggregates price data from multiple providers to return a median price, preventing manipulation. Sources must implement SEP-40 Oracle Standard (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md)
TODO: we should cache price for some time, only afterwards refetch.

**State Variables (`Instance` Storage):**

- **Feed Configuration:**
    - `PrimarySources`: Map of `Symbol -> Address` (e.g., Band Protocol, Diode).
    - `SecondarySources`: Backup oracles if primary fails.

- **Safety Thresholds:**    
    - `MaxDeviation`: Maximum allowed price difference between Oracle A and Oracle B.
    - `StalenessThreshold`: Max time (e.g., 60 seconds) before a price feed is rejected as outdated.

---

## 3. Economic Mechanisms & Fee Logic

The protocol utilizes **Lazy Evaluation** (Cumulative Indices) to calculate fees accurately without iterating through positions.

### 3.1 Liquidity Provider (LP) Economics

The `Vault` issues `STELLARS_LP` tokens representing a share of the total pool.

- **Minting**: `STELLARS_LP` is minted when USDC is deposited.
- **Burning**: `STELLARS_LP` is burned when USDC is withdrawn.
- **Exchange Rate**: The price of `STELLARS_LP` auto-compounds based on the pool's performance (Trading Fees + Trader Losses - Trader Profits).
 $$\text{Price} = \frac{\text{Total USDC Balance} + \text{Unrealized PnL}}{\text{Total GMXLP Supply}}$$
#### 3.1.1 Calculating the Unrealized PnL

Instead of tracking 10,000 individual entry prices, the `PositionManager` maintains two global variables per market:

1. `Global Long Average Price`: The volume-weighted average entry price of _all_ active longs.
2. `Global Short Average Price`: The volume-weighted average entry price of _all_ active shorts.

**The Formula for LP Price:** Since LPs are the counterparty (the "House"), the Traders' Profit is the LPs' Loss.

LP Net Value=USDC Balance−(Net Global Trader PnL)

- If Traders are **Winning** ($1M), we subtract $1M from the Vault's value.
- If Traders are **Losing** ($1M), we add $1M to the Vault's value (technically we subtract -$1M).

### 3.2 Borrowing Fee (Utilization-Based)

Traders pay a borrowing fee for the duration their position is open, compensating LPs for the opportunity cost of reserved liquidity.

- **Mechanism**: Dynamic Kink Curve.
	- **Low Utilization (< 80%)**: Low, linear rate increase.
    - **High Utilization (> 80%)**: Exponential rate increase to discourage depletion.
    - (exact number a variable to be defined in the config manager)
- **Calculation**:

$$\text{Utilization} = \frac{\text{Total Open Interest}}{\text{Total USDC Pool}}$$

$$\text{Fee} = (\text{Current Borrow Index} - \text{Entry Borrow Index}) \times \text{Position Size}$$

- **Distribution**:
    - **95%**: Retained in Pool (Increases `GMXLP` value).
    - **5%**: Sent to Developer Wallet.
    - (exact number a variable to be defined in the config manager)
### 3.3 Funding Rate (Peer-to-Peer Balance)

The funding rate incentivizes balance between Long and Short Open Interest (OI).

- **Mechanism**: Velocity-based funding. The rate scales based on the imbalance between Long and Short OI.
- **Calculation**:

$$\text{Imbalance} = \text{Long OI} - \text{Short OI}$$
$$\text{Rate} = \text{Clamp}(\text{Factor} \times \text{Imbalance})$$

- **Settlement**:
    - If **Longs > Shorts**: Longs pay Shorts.
    - If **Shorts > Longs**: Shorts pay Longs.

- **Keeper Spread (Revenue)**: The protocol takes a spread from the transfer.
    - _Payer Side_: Pays 100% of the rate.
    - _Receiver Side_: Receives 95% of the rate.
    - _Keeper/Dev_: Receives the remaining 5% immediately from the Vault.
    - to be configured in the config manager

---

## 4. Keeper Network Operations

The Keeper is an off-chain bot responsible for maintaining system health. It is incentivized via direct payments from the `Vault` for every successful operation.

### 4.1 Global State Updates

- **Frequency**: Every X minutes.
- **Action**: Calls `update_indices()`.
- **Logic**: Calculates the accrued Borrow Fees and Funding Payments since the last update and increments the global `acc_borrow_index` and `acc_funding_index`.

### 4.2 Liquidations

- **Trigger**: When a position's `Health Factor < 1.0`.

$$\text{Health} = \text{Collateral} - \text{Unrealized Loss} - \text{Accrued Fees}$$

- **Action**: Calls `liquidate(position_id)`.
- **Result**:
    1. Position is closed.
    2. Remaining collateral is seized by the Vault.
    3. A fixed reward (gas cost + premium) is sent to the Keeper.

### 4.3 Order Execution

- **Trigger**: Market price crosses a user's defined Limit, Stop Loss, or Take Profit price.
- **Action**: Calls `execute_order(order_id)`.
- **Result**: The trade is executed against the pool, and the Keeper receives the execution fee attached to the order.

### 4.4 Auto-Deleveraging (ADL)

- **Trigger**: `Total Reserved Liquidity > 90%` of Vault Balance (Insolvency Risk).
- **Action**: Calls `deverage(position_id)`.
- **Logic**: Identifies the most profitable, highly leveraged positions and force-closes them at the current oracle price. This reduces the pool's liability and frees up liquidity.

---

## 5. User Flows

### 5.1 Liquidity Provision

1. **User** calls `Vault.deposit(1000 USDC)`.
2. **Vault** calculates current `PricePerShare`.
3. **Vault** transfers 1000 USDC from User to Vault.
4. **Vault** mints equivalent `GMXLP` tokens to User.
5. _Result_: User holds a liquid SEP-41 token representing their share.

### 5.2 Opening a Position (Long)

1. **User** approves `PositionManager` to spend USDC.
2. **User** calls `PositionManager.open_position(size, collateral, is_long)`.
3. **PositionManager**:
    - Pulls USDC collateral to the Vault.
    - Records `EntryPrice` from Oracle.
    - Records `EntryBorrowIndex` and `EntryFundingIndex` from global state.
    - Increments `TotalOpenInterest`.
4. **Vault** reserves the required liquidity.

### 5.3 Closing a Position

1. **User** calls `PositionManager.close_position()`.
2. **PositionManager**:
    - Calculates PnL: `(CurrentPrice - EntryPrice) * Size`.
    - Calculates Fees: `(CurrIndex - EntryIndex) * Size`.
    - Net Payout = `Collateral + PnL - Fees`.
    
3. **Vault**:
    - If Net Payout > 0: Transfers USDC to User.
    - If Net Payout < 0: User owes money (capped at collateral), remainder stays in Vault.

4. **System**: Updates Global OI and releases reserved liquidity.

---

## 6. Risk Management Parameters

- **Max Leverage**: Configurable per asset (e.g., 30x for BTC, 50x for FX).
- **Global Liquidity Cap**: Maximum total OI allowed relative to Vault Balance to ensure payouts.
- **Minimum Collateral**: Minimum $ amount required to open a position (prevents dust spam).
- **Cooldown Period**: A 15-minute delay after depositing into the Vault before a withdrawal is permitted, preventing front-running of oracle updates or liquidation events.


---

# Appendix A: Fee Mechanics & Mathematical Models

## 1. The "Lazy Evaluation" Model (Cumulative Indices)

In traditional finance, interest is calculated continuously. In a blockchain environment, we cannot update every user's balance every second due to computational constraints. Instead, we use a **Global Cumulative Index**.

Think of this as an **Odometer** in a car.

- When a user opens a position, we record the "Odometer Reading" (Ientry​).
- When they close, we check the "Current Odometer" (Icurrent​).
- The distance traveled (Fee accrued) is simply Icurrent​−Ientry​.

### Mathematical Formulation

Let R(t) be the instantaneous fee rate (Borrowing or Funding) at time t. The Global Index I(t) is the integral of the rate over time:

I(t)=∫0t​R(τ)dτ

For a specific user position of size S opened at time t1​ and closed at time t2​, the total fee F is:

F=S×(I(t2​)−I(t1​))

**In Smart Contract Code (Discrete Time):** Every time an interaction occurs at timestamp tn​, we update the index:

Inew​=Iold​+(Rate×Δt)

---

## 2. Borrowing Fee Calculation (Utilization Curve)

This fee represents the **cost of capital**. LPs are "renting out" their liquidity to traders. The "rent" price increases as liquidity becomes scarce (Supply & Demand).

### The Variables

- U: **Utilization Ratio**. The percentage of the pool currently reserved by traders.
    U=Total Pool LiquidityTotal Open Interest (OI)​
    
- Rborrow​: The Borrow Rate per second.

### The Formula (Kinked Model)

We use a piecewise linear function (a "Kink") to incentivize solvency.

- **Target Utilization (Uoptimal​):** Typically 80% (0.8).
- **Slope 1 (S1​):** Low interest rate slope (Normal usage).
- **Slope 2 (S2​):** High interest rate slope (Emergency usage).

Rborrow​={Base+(U×S1​)Base+(Uoptimal​×S1​)+((U−Uoptimal​)×S2​)​if U≤Uoptimal​if U>Uoptimal​​

**Economic Implication:** If usage jumps from 80% to 90%, the fee might jump from 5% APR to 50% APR. This forces traders to close positions, naturally freeing up liquidity for the pool.

---

## 3. Funding Rate Calculation (Velocity Model)

This fee mechanism forces the price of the Perpetual Contract to converge with the Spot Price. It is a **Peer-to-Peer** transfer between Longs and Shorts.

### The Imbalance

Let OL​ be Long Open Interest and OS​ be Short Open Interest. The **Imbalance (P)** is:

P=OL​−OS​

### The Velocity Formula

Unlike standard interest, Funding Rates in GMX-style perps often use **Velocity**. The rate accelerates if the imbalance persists.

Ratefunding​=Previous Rate+(Velocity Constant×P)

_However, for a V1 implementation, a simpler **Proportional Model** is often safer:_

Ratefunding​=Base×(OL​+OS​OL​−OS​​)

### Settlement Logic (The "Spread")

- If Rate>0: Longs pay Shorts.
- If Rate<0: Shorts pay Longs.

**The "Spread" (Protocol Revenue):** The protocol takes a cut (Ckeeper​≈5%) from the transfer.

Fpayer​=S×Rate

Freceiver​=S×Rate×(1−Ckeeper​)

Fprotocol​=S×Rate×Ckeeper​

---

# Appendix B: Risk Analysis & Mitigation

## 1. The "Infinite Upside" Risk (Long Squeeze)

**The Risk:** In a Single-Asset Vault (USDC only), Long positions are mathematically dangerous.

- If a trader Shorts ETH, the max they can win is 100% (if ETH goes to $0). The Vault's liability is capped.
- If a trader Longs ETH, the max they can win is **unlimited**. If ETH goes 10x, the Vault owes the trader 10x their size.

**The Scenario:** Alice longs $1M of ETH using $50k collateral. The Vault has $2M USDC. ETH price pumps 300%. Alice's position is now worth $3M. **Result:** The Vault is insolvent. It owes Alice $3M but only has $2M.

**Mitigation (Max Global OI):** The protocol **MUST** enforce a hard cap on Long Open Interest relative to the Vault Balance.

Max Long OI≤Vault Balance×Risk Factor (e.g. 0.5)

_This ensures that even if price doubles, the Vault can pay out._

## 2. Auto-Deleveraging (ADL)

**The Risk:** Even with caps, extreme volatility can threaten solvency. If the Vault's "Buffer" (Liquidity not reserved for profits) drops near zero, new traders cannot withdraw, and LPs cannot exit.

**The Solution (ADL):** This is a "forced profit taking" mechanism.

1. **Trigger:** If `Total Reserved PnL` > `90% of Vault Balance`.
2. **Selection:** Identify traders with the highest **PnL Percentage** (RoE).
3. **Action:** The smart contract forcibly closes their position at the current market price.
4. **Outcome:** The trader keeps all their profits (they are happy/rich), but their position is gone. The Vault lowers its liability (it is safe).

## 3. Oracle Front-Running

**The Risk:** A trader sees the price of BTC update on Binance _before_ it updates on the Stellar blockchain.

1. See BTC pump on Binance.
2. Open Long on your DEX (at old, lower price).
3. Oracle updates 5 seconds later.
4. Close Long for instant risk-free profit.

**Mitigation:**

1. **Keeper Delay:** Users submit a "Request" to trade. A Keeper executes it 30 seconds later using the price _at that future moment_. (Standard GMX V2 model).
2. **High-Frequency Oracles:** Use a "Pull Oracle" (like Pyth or Switchboard) where the price is updated in the _same transaction_ as the trade.


## TODOs:
- Use: https://docs.openzeppelin.com/stellar-contracts
	- Access control
	- Token
	- Upgradeability
	- Smart Contracts
		- Telegram Bots?
		- Multiple postions per real user?
	- ...
- Expose Keeper functions
- Expose TTL functions
- Wait period in the position to stop oracle front running (positions must live for min 5 min)