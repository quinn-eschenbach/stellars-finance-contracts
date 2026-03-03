# Stellars Finance Contracts

## 1. Abstract

This protocol is a decentralized, non-custodial perpetual exchange built on the Soroban smart contract platform. It utilizes a unified liquidity pool model (GLP-style) where Liquidity Providers (LPs) act as the counterparty to all traders. The protocol supports leveraged trading of assets with zero price impact, relying on oracle feeds for pricing.

The system employs a **Single-Asset Vault (USDC)** architecture. LPs deposit USDC to mint a liquid, interest-bearing SEP-41 token (STELLARS_LP), while traders use USDC as collateral to open Long or Short positions. Solvency is maintained via a network of Keeper bots that perform liquidations, update funding rates, and execute Auto-Deleveraging (ADL) when necessary.

---

## 2. Core Contracts & State Layout

The protocol consists of four interacting smart contracts. State is managed to ensure $O(1)$ scalability (no looping) and strict data availability.

### 2.1 `Vault` (Liquidity & Token)

**Role:** The central treasury. It utilizes OpenZeppelin's Soroban Token Standard to implement the SEP-41 LP share token (`STELLARS_LP`). To ensure robust security and upgrade paths, it integrates OpenZeppelin's `Initializable` (for setup) and `Pausable` (for emergency stops) modules. It strictly manages "Free Liquidity" to prevent insolvency and bank runs.

**State Variables (`Persistent` Storage):**

* **Token Ledger (SEP-41 Standard):**
* `TotalSupply`: Total amount of `STELLARS_LP` tokens in existence.
* `Balances`: Map of `Address -> Amount` (User LP balances).
* `Allowances`: Map of `(Owner, Spender) -> Amount`.


* **Asset Tracking:**
* `TotalUSDC`: The actual `contract.balance` of USDC held in the vault.
* `ReservedUSDC`: The total amount of USDC currently "locked" as collateral for open positions.
* `UnclaimedFees`: Protocol revenue (the Keeper/Dev spread) that has not yet been withdrawn.


* **System State:**
* `IsPaused`: Boolean flag controlled by the `PAUSER_ROLE`.



**Key Functions:**

* `initialize(admin, config_manager)`: OpenZeppelin standard to set initial parameters. Can only be called once.
* `deposit(amount)`: Reverts if `IsPaused == true`. Transfers USDC in, calculates current share price, and mints `STELLARS_LP`.
* `withdraw(amount)`: Reverts if `IsPaused == true`. Calculates **Free Liquidity** to ensure the protocol remains solvent against active winning trades:

$$\text{Free Liquidity} = \text{TotalUSDC} - \text{ReservedUSDC} - \text{UnclaimedFees} - \max(0, \text{NetGlobalTraderPnL})$$



If the requested withdrawal amount exceeds Free Liquidity, the transaction **reverts** to protect active traders. Otherwise, it burns `STELLARS_LP` and transfers USDC out.
* `settle_pnl(amount, is_profit)`: Callable only by the `PositionManager`. Adjusts `TotalUSDC` and `ReservedUSDC` balances.
* `pause()` / `unpause()`: Callable strictly by the `PAUSER_ROLE` defined in the `ConfigManager`.
* **TTL Management:**
* `bump_vault_state()`: Extends the Time-To-Live (TTL) of the Vault's instance storage to prevent the contract from being archived by the Soroban network.
* `bump_user_balance(user_address)`: Extends the TTL for a specific user's LP token balance in persistent storage.

---

### 2.2 `PositionManager` (Trading Engine)

**Role:** The core logic contract. It merges "Market" and "Position" state to reduce cross-contract calls. It utilizes OpenZeppelin's `Initializable` and `Pausable` modules, alongside Math/SafeCast libraries to prevent overflow panics during complex PnL and index calculations. It enforces rigorous utilization caps and time-locks to prevent oracle front-running.

**State Variables (`Persistent` Storage):**
*(Note: Uses `MarketInfo` and `Position` structs as defined previously. Below are the specific additions for security.)*

* **Risk & Security Parameters:**
* `MaxUtilizationRatio`: The hard cap for new trades (e.g., 85%). If `ReservedUSDC / TotalUSDC` exceeds this, no new positions can be opened, ensuring a buffer always exists for LP withdrawals.
* `MinPositionLifetime`: A required time-lock (e.g., 5 minutes) to neutralize high-frequency oracle front-running and toxic wash trading.
* `IsPaused`: Boolean flag for emergency trading halts.


**Key Functions:**

* `initialize(vault_address, config_manager)`: OpenZeppelin setup function.
* `increase_position(...)`: Opens or adds to a position.
* **Checks:** Reverts if `IsPaused == true`. Reverts if the new trade pushes the Vault's utilization past the `MaxUtilizationRatio` (85%).
* **Action:** Updates Global Average Prices, Fee Indices, and reserves USDC in the Vault.
* **Security:** Records the current block timestamp into the user's `LastIncreasedTime` state variable.


* `decrease_position(...)`: Closes or reduces a position and realizes PnL.
* **Checks:** Reverts if `current_time < LastIncreasedTime + MinPositionLifetime` (e.g., trade has been open for less than 5 minutes).
* **Emergency Access:** This function purposefully **bypasses the `Pausable` lock**. Even if the protocol is paused, users can always close positions to reduce their risk exposure.


* `liquidate_position(...)`: Callable by `KEEPER_ROLE`. Checks if `Collateral < Fees + Loss`.
* `update_indices()`: Callable by `KEEPER_ROLE`. Forces a sync of global borrow and funding accumulators.
* `execute_order(...)`: Callable by `KEEPER_ROLE`. Triggers limit/stop orders.
* `deleverage_position(...)`: Callable by `KEEPER_ROLE`. Identifies the highest RoE positions and force-closes them if utilization hits critical emergency thresholds (e.g., > 95%).
* **TTL Management:**
* `bump_position(user_address, symbol)`: Extends the Soroban TTL for a specific active user position. Keepers can be incentivized to call this periodically for all open positions to ensure no active trade data is archived.

---

### 2.3 `ConfigManager` (Governance & Parameters)

**Role:** The central brain for protocol parameters and permissions. It acts as the definitive source of truth for the `Vault`, `PositionManager`, and `OracleRouter`. It extensively utilizes OpenZeppelin's `AccessControl` for strict permissioning and `Initializable` for secure deployment.

**State Variables (`Persistent` & `Instance` Storage):**

* **Access Control Registry (OpenZeppelin Standard):**
* `DEFAULT_ADMIN_ROLE`: The ultimate authority (usually a multi-sig or DAO). Can grant or revoke all other roles.
* `UPGRADER_ROLE`: Authorized to call the Soroban `upgrade` function to push new WASM code for any of the protocol's upgradeable contracts.
* `PAUSER_ROLE`: Authorized to pause/unpause the `Vault` and `PositionManager` during market emergencies or bug discoveries.
* `KEEPER_ROLE`: The whitelisted bot network authorized to execute liquidations, trigger ADL, execute limit orders, and update global indices.


* **Fee Configuration:** * `DepositFee`: A small fee charged on LP minting to prevent short-term arbitrage against the Vault.
* `FeeSplits`: A struct defining the distribution of protocol revenue (e.g., 5% to Keepers, 5% to Dev Wallet, 90% retained in Vault for LPs). Designed to be extensible to support future token launches, buybacks, or staking rewards.


* **Global Protocol Limits:**
* `MinCollateral`: Minimum USDC required to open a position (prevents dust/spam attacks).
* `CooldownDuration`: The time required between `Vault.deposit` and `Vault.withdraw` to prevent sandwich attacks.
* `MinPositionLifetime`: Global configuration for the anti-front-running lock (default: 5 minutes) enforced by the `PositionManager`.
* `MaxUtilizationRatio`: The global ceiling (e.g., 85%) for Vault utilization to protect "Free Liquidity" for LPs.



**Key Functions:**

* `initialize(admin_address)`: OpenZeppelin setup function. Grants the `DEFAULT_ADMIN_ROLE` to the deploying multi-sig.
* `grant_role(role, account)` / `revoke_role(role, account)`: Standard OpenZeppelin functions strictly callable by the `DEFAULT_ADMIN_ROLE`.
* `update_fee_splits(...)`: Modifies the protocol revenue routing.
* `update_protocol_limits(...)`: Adjusts collateral requirements, cooldowns, and utilization ratios based on market conditions.
* **TTL Management:**
* `bump_config_state()`: Extends the Soroban Time-To-Live (TTL) of the global configuration variables to ensure these critical parameters are never archived by the network.

---

### 2.4 `OracleRouter` (Pricing & Caching)

**Role:** The protocol's pricing engine. It aggregates price data from multiple providers to return a secure median price, preventing flash-loan manipulation and single-point-of-failure risks. Sources must strictly implement the SEP-40 Oracle Standard. It utilizes OpenZeppelin's `Initializable` for deployment and relies on the `ConfigManager` for access control. To optimize gas costs on Soroban and reduce cross-contract call overhead, it implements a strict time-based caching mechanism.

**State Variables (`Instance` Storage):**

* **Feed Configuration:**
* `PrimarySources`: Map of `Symbol -> List[Address]` (e.g., Band Protocol, Pyth).
* `SecondarySources`: Backup oracles if primary feeds fail or return stale data.


* **Cache State (Gas Optimization):**
* `CachedPrices`: Map of `Symbol -> Price`.
* `LastUpdateTime`: Map of `Symbol -> Timestamp`.


* **Safety Thresholds:** * `MaxDeviation`: Maximum allowed price difference between primary oracle sources (e.g., 1%). If the spread is larger, the protocol pauses trading for that asset to prevent toxic arbitrage.
* `StalenessThreshold`: Max time before an external SEP-40 price feed is rejected as outdated.
* `CacheDuration`: How long the internal cache remains valid (e.g., 10 seconds) before a fresh cross-contract call to the external oracles is required.



**Key Functions:**

* `initialize(config_manager_address)`: OpenZeppelin setup function to link the router to the central governance contract.
* `get_price(symbol)`: The core pricing function called by the `PositionManager`.
* **Caching Logic:** Checks if `current_time <= LastUpdateTime + CacheDuration`. If true, it returns the value from `CachedPrices` to save compute fees.
* **Fetch Logic:** If the cache is expired, it queries the `PrimarySources` via SEP-40, enforces the `MaxDeviation` and `StalenessThreshold` checks, updates the `CachedPrices` and `LastUpdateTime`, and returns the validated price.


* `set_oracle_sources(...)`: Allows the `DEFAULT_ADMIN_ROLE` (via `ConfigManager`) to add or remove SEP-40 compliant oracle addresses.
* **TTL Management:**
* `bump_oracle_state()`: Extends the Soroban Time-To-Live (TTL) of the OracleRouter's instance storage, ensuring the configuration and thresholds are not archived by the network.

---

## 3. Economic Mechanisms & Fee Logic

The protocol utilizes **Lazy Evaluation** (Cumulative Indices) to calculate fees accurately without iterating through individual positions.

### 3.1 The "Lazy Evaluation" Model (Cumulative Indices)

In traditional finance, interest is calculated continuously. In a blockchain environment, we cannot update every user's balance every second due to computational constraints. Instead, we use a **Global Cumulative Index**.

Think of this as an **Odometer** in a car:

* When a user opens a position, we record the "Odometer Reading" ($I_{entry}$).
* When they close, we check the "Current Odometer" ($I_{current}$).
* The distance traveled (Fee accrued) is simply $I_{current} - I_{entry}$.

**Mathematical Formulation**
Let $R(t)$ be the instantaneous fee rate (Borrowing or Funding) at time $t$. The Global Index $I(t)$ is the integral of the rate over time:

$$I(t)=\int_{0}^{t}R(\tau)d\tau$$

For a specific user position of size $S$ opened at time $t_1$ and closed at time $t_2$, the total fee $F$ is:

$$F=S \times (I(t_2)-I(t_1))$$

**In Smart Contract Code (Discrete Time):** Every time an interaction occurs at timestamp $t_n$, we update the index:

$$I_{new}=I_{old}+(\text{Rate} \times \Delta t)$$

---

### 3.2 Liquidity Provider (LP) Economics

The `Vault` issues `STELLARS_LP` tokens representing a share of the total pool.

* **Minting**: `STELLARS_LP` is minted when USDC is deposited.
* **Burning**: `STELLARS_LP` is burned when USDC is withdrawn.
* **Exchange Rate**: The price of `STELLARS_LP` auto-compounds based on the pool's performance (Trading Fees + Trader Losses - Trader Profits).

$$\text{Price} = \frac{\text{Total USDC Balance} + \text{Unrealized PnL}}{\text{Total STELLARSLP Supply}}$$

#### 3.2.1 Calculating the Unrealized PnL

Instead of tracking 10,000 individual entry prices, the `PositionManager` maintains two global variables per market:

1. `Global Long Average Price`: The volume-weighted average entry price of *all* active longs.
2. `Global Short Average Price`: The volume-weighted average entry price of *all* active shorts.

**The Formula for LP Price:** Since LPs are the counterparty (the "House"), the Traders' Profit is the LPs' Loss.

$$\text{LP Net Value} = \text{USDC Balance} - (\text{Net Global Trader PnL})$$

* If Traders are **Winning** ($1M), we subtract $1M from the Vault's value.
* If Traders are **Losing** ($1M), we add $1M to the Vault's value (technically we subtract -$1M).

---

### 3.3 Borrowing Fee (Utilization-Based)

Traders pay a borrowing fee for the duration their position is open, compensating LPs for the opportunity cost of reserved liquidity. This fee represents the **cost of capital**. LPs are "renting out" their liquidity to traders, and the "rent" price increases as liquidity becomes scarce.

**The Variables**

* $U$: **Utilization Ratio**. The percentage of the pool currently reserved by traders.

$$U = \frac{\text{Total Open Interest (OI)}}{\text{Total Pool Liquidity}}$$


* $R_{borrow}$: The Borrow Rate per second.

**The Formula (Dynamic Kink Curve)**
We use a piecewise linear function (a "Kink") to incentivize solvency.

* **Target Utilization ($U_{optimal}$):** Typically 80% (0.8).
* **Slope 1 ($S_1$):** Low interest rate slope (Normal usage).
* **Slope 2 ($S_2$):** High interest rate slope (Emergency usage).

$$R_{borrow} = \begin{cases} \text{Base} + (U \times S_1) & \text{if } U \le U_{optimal} \\ \text{Base} + (U_{optimal} \times S_1) + ((U - U_{optimal}) \times S_2) & \text{if } U > U_{optimal} \end{cases}$$

> **Economic Implication:** If usage jumps from 80% to 90%, the fee might jump exponentially (e.g., from 5% APR to 50% APR). This forces traders to close positions, naturally freeing up liquidity for the pool.

**Fee Calculation & Distribution**


$$\text{Fee} = (I_{current\_borrow} - I_{entry\_borrow}) \times \text{Position Size}$$

* **95%**: Retained in Pool (Increases `STELLARS_LP` value).
* **5%**: Sent to Developer Wallet.
*(Note: Exact curve slopes, optimal utilization points, and distribution percentages are variables defined in the `ConfigManager`).*

---

### 3.4 Funding Rate (Peer-to-Peer Balance)

This fee mechanism forces the price of the Perpetual Contract to converge with the Spot Price and incentivizes balance between Long and Short Open Interest. It is a **Peer-to-Peer** transfer between Longs and Shorts.

**The Imbalance**
Let $O_L$ be Long Open Interest and $O_S$ be Short Open Interest. The **Imbalance ($P$)** is:

$$P=O_L-O_S$$

**The Velocity Formula**
Unlike standard interest, Funding Rates in modern perpetual DEXs often use **Velocity**. The rate accelerates if the imbalance persists.

$$\text{Rate}_{funding} = \text{Previous Rate} + (\text{Velocity Constant} \times P)$$

*However, for a V1 implementation, a simpler **Proportional Model** is often safer and easier to maintain:*

$$\text{Rate}_{funding} = \text{Base} \times \left(\frac{O_L - O_S}{O_L + O_S}\right)$$

**Settlement Logic (The "Spread")**

* If $\text{Rate}_{funding} > 0$: Longs pay Shorts.
* If $\text{Rate}_{funding} < 0$: Shorts pay Longs.

The protocol takes a cut ($C_{keeper} \approx 5\%$) from the transfer to incentivize Keepers and generate revenue.

$$F_{payer} = S \times \text{Rate}_{funding}$$

$$F_{receiver} = S \times \text{Rate}_{funding} \times (1 - C_{keeper})$$

$$F_{protocol} = S \times \text{Rate}_{funding} \times C_{keeper}$$

* *Payer Side*: Pays 100% of the calculated rate.
* *Receiver Side*: Receives the rate minus the spread.
* *Keeper/Dev*: Receives the $F_{protocol}$ portion immediately from the Vault (configurable via `ConfigManager`).

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

- **Trigger**: Keepers actively monitor Vault health. If Total Reserved PnL > 90% of Vault Balance, Keepers are authorized to call deleverage_position(), targeting accounts sorted by highest Return on Equity (RoE).
- **Action**: Calls `deleverage(position_id)`.
- **Logic**: Identifies the most profitable, highly leveraged positions and force-closes them at the current oracle price. This reduces the pool's liability and frees up liquidity.

---

## 5. User Flows

### 5.1 Liquidity Provision

1. **User** calls `Vault.deposit(1000 USDC)`.
2. **Vault** calculates current `PricePerShare`.
3. **Vault** transfers 1000 USDC from User to Vault.
4. **Vault** mints equivalent `STELLARS_LP` tokens to User.
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


### 6.1 The "Infinite Upside" Risk (Long Squeeze)

**The Risk:** In a Single-Asset Vault (USDC only), Long positions are mathematically dangerous.

- If a trader Shorts ETH, the max they can win is 100% (if ETH goes to $0). The Vault's liability is capped.
- If a trader Longs ETH, the max they can win is **unlimited**. If ETH goes 10x, the Vault owes the trader 10x their size.

**The Scenario:** Alice longs $1M of ETH using $50k collateral. The Vault has $2M USDC. ETH price pumps 300%. Alice's position is now worth $3M. **Result:** The Vault is insolvent. It owes Alice $3M but only has $2M.

**Mitigation (Max Global OI):** The protocol **MUST** enforce a hard cap on Long Open Interest relative to the Vault Balance.

$$\text{Max Long OI} \le \text{Vault Balance} \times \text{Risk Factor}$$

_This ensures that even if price doubles, the Vault can pay out._

### 6.2 Auto-Deleveraging (ADL)

**The Risk:** Even with global open interest caps, extreme market volatility or sudden, massive LP withdrawals can threaten the protocol's solvency. If the Vault's "Free Liquidity" drops to zero, LPs cannot exit, and the protocol effectively freezes.

**The Solution (ADL):** This is a "forced profit-taking" mechanism designed as the protocol's nuclear defense against insolvency and bank runs. Keepers actively monitor the Vault's health and are authorized to intervene if critical thresholds are breached.

1. **The Triggers (Dual-Condition):** Keepers can initiate ADL if *either* of the following conditions is met:
* **Insolvency Risk (PnL-Based):** `Total Reserved PnL > 90% of Vault Balance`. (Traders are winning too much, and the Vault is running out of funds to pay them).
* **Liquidity Crisis Risk (Utilization-Based):** `ReservedUSDC / TotalUSDC > 95%`. (Too much of the Vault's collateral is locked up backing trades, meaning LPs have no exit liquidity).


2. **Selection:** The `PositionManager` identifies the most profitable traders by sorting for the highest **Return on Equity (RoE) / PnL Percentage**.
3. **Action:** A Keeper calls `deleverage_position()`, and the smart contract forcibly closes the targeted trader's position at the current oracle price.
4. **Outcome:** The trader keeps all of their accrued profits (they are fully paid out), but their position is closed. This instantly reduces the Vault's liability and frees up USDC back into the `Free Liquidity` pool, re-securing the protocol.

### 6.3 Oracle Front-Running

**The Risk:** Blockchain oracles inherently suffer from slight latency. A malicious trader could monitor centralized exchanges (like Binance) and execute trades on the DEX *before* the on-chain oracle updates its price.

1. See BTC pump on Binance.
2. Open Long on the DEX (at the old, lower oracle price).
3. Oracle updates 5 seconds later.
4. Close Long for instant, risk-free profit.

**Mitigation (Minimum Position Lifetime):**
To neutralize high-frequency oracle front-running and toxic wash trading without building a complex execution-delay queue, the protocol enforces a strict time-lock on all trades.

1. **The Lock:** When a user opens or adds to a position, the `PositionManager` records the current block timestamp as `LastIncreasedTime`.
2. **The Enforcement:** The `MinPositionLifetime` parameter (configurable in the `ConfigManager`, default: 5 minutes) dictates how long the position must remain open. If a user attempts to call `decrease_position` before `LastIncreasedTime + MinPositionLifetime` has passed, the transaction will revert.
3. **The Result:** The trader is forced to hold the position and take on real market risk for at least 5 minutes. This entirely destroys the viability of risk-free, instant arbitrage against oracle latency.
Here is the draft for your V2 Roadmap. It outlines these advanced features perfectly, framing them as deliberate, complex innovations for the protocol's next phase. You can drop this directly at the bottom of your Readme!

---

## 7. V2 Roadmap: Capital Efficiency & Advanced Margin

While Version 1 of the protocol prioritizes strict $O(1)$ scalability, isolated risk, and absolute mathematical solvency, Version 2 is designed to introduce industry-leading capital efficiency. The V2 upgrade will focus on advanced portfolio management and composable liquidity.

### 7.1 Split-Yield LP Staking (Sticky Liquidity)

**The Concept:** Separating the underlying directional risk of the Vault from the protocol's fee generation.

**The Mechanism:**

* In V1, the `STELLARS_LP` token auto-compounds both trader PnL (the Vault's wins/losses) and trader fees (Borrowing/Funding rates).
* In V2, the protocol will introduce a native `StakingContract`. The base `STELLARS_LP` token will only reflect the net PnL of traders. To earn the lucrative protocol fees (the 95% revenue split), users must **stake** their LP tokens.
* **Economic Impact:** This allows the protocol to introduce time-locks or boosted emissions for long-term stakers, creating highly "sticky liquidity" that defends against sudden capital flight while rewarding committed LPs.

### 7.2 Cross-Margin Account Health

**The Concept:** Transitioning from Isolated Margin (where each position is siloed) to a unified Cross-Margin architecture.

**The Mechanism:**

* Instead of evaluating liquidations based on a single `Position Health`, Keepers will evaluate `User Global Health`.
* A trader's unrealized profit from a winning Long (e.g., BTC) can be dynamically used to offset the margin requirements of a losing Short (e.g., ETH) in the same account.
* **Technical Challenge:** This requires upgrading the smart contract state to safely aggregate multi-asset PnL and total fees on the fly. It shifts the protocol away from strictly $O(1)$ updates and requires sophisticated partial-liquidation logic to determine which asset Keepers should close first during a margin call.

### 7.3 Yield-Bearing Collateral (LP as Margin)

**The Concept:** The ultimate expression of DeFi composability. Traders will be able to use their deposited liquidity as the active collateral for their leveraged trades.

**The Mechanism:**

* A user deposits USDC, receives `STELLARS_LP`, stakes it to earn protocol fees, and then uses the value of that staked LP position as collateral to open a 10x Long.
* **Economic Impact:** The user is effectively acting as the "House" (earning yield) while simultaneously trading, maximizing their capital efficiency.
* **Risk Mitigation:** Because the value of the `STELLARS_LP` token fluctuates based on global trader performance, using it as collateral introduces the risk of a "death spiral" (where a drop in LP value triggers cascading trader liquidations). V2 will introduce strict Collateral Haircuts (e.g., LP tokens are only valued at 80% of their face value for margin purposes) to safely isolate the volatility of yield-bearing collateral.