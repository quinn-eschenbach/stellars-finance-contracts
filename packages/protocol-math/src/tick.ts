// Off-chain MarketTick — parallel to contracts/position-manager/src/tick.rs.
//
// On-chain `MarketTick::refresh` is side-effecting: it updates indices in
// storage, pushes Unrealized PnL to the Vault, emits UpdateIndices. This TS
// version is read-only — it derives a tick from cached state by projecting
// indices forward to `now` using the same accumulation formulas. The result
// matches what an immediate on-chain refresh would produce (modulo the
// inevitable skew between `now` here and ledger time on-chain).

import {
  calcUnrealizedPnl,
  calcBorrowFee,
  calcFundingFee,
  calcHealth,
  calcUtilizationBps,
  calcBorrowRate,
  calcFundingRate,
  accumulateBorrowIndex,
  accumulateFundingIndex,
  isTpTriggered,
  isSlTriggered,
} from "./pure.js";
import type {
  MarketState,
  PositionEvaluation,
  PositionState,
  ProjectInput,
  Slice,
} from "./types.js";

export class MarketTick {
  constructor(
    /** Market state with `acc_borrow_index` and `acc_funding_index` projected to tick time. */
    public readonly market: MarketState,
    public readonly mark_price: bigint,
  ) {}

  /**
   * Project a MarketTick from cached state forward to `now`. Mirrors the
   * index-update arm of the contract's `MarketTick::refresh`, including the
   * pause-fee clamp `effective_start = max(last_index_update, last_unpause_time)`.
   */
  static project(input: ProjectInput): MarketTick {
    const { market, mark_price, vault, rate_config, now, last_unpause_time } = input;

    const effective_start =
      market.last_index_update > last_unpause_time
        ? market.last_index_update
        : last_unpause_time;
    const time_delta = now > effective_start ? now - effective_start : 0n;

    let acc_borrow_index = market.acc_borrow_index;
    let acc_funding_index = market.acc_funding_index;

    if (time_delta > 0n) {
      const util_bps = calcUtilizationBps(vault.reserved_usdc, vault.total_assets);
      const borrow_rate = calcBorrowRate(
        util_bps,
        rate_config.base_borrow_rate_bps,
        rate_config.slope1_bps,
        rate_config.slope2_bps,
        rate_config.optimal_utilization_bps,
      );
      acc_borrow_index = accumulateBorrowIndex(acc_borrow_index, borrow_rate, time_delta);

      const funding_rate = calcFundingRate(
        market.long_open_interest,
        market.short_open_interest,
        rate_config.base_funding_rate_bps,
      );
      acc_funding_index = accumulateFundingIndex(acc_funding_index, funding_rate, time_delta);
    }

    const projected: MarketState = {
      ...market,
      acc_borrow_index,
      acc_funding_index,
      last_index_update: now,
    };
    return new MarketTick(projected, mark_price);
  }

  /**
   * Compute (pnl, borrow_fee, funding_fee, health) for a Position slice.
   * `slice` defaults to the whole Position (`size`, `collateral`); pass an
   * explicit slice for partial-close evaluations to mirror the contract.
   */
  evaluate(pos: PositionState, slice?: Slice): PositionEvaluation {
    const size = slice?.size ?? pos.size;
    const collateral = slice?.collateral ?? pos.collateral;

    const pnl = calcUnrealizedPnl(size, pos.entry_price, this.mark_price, pos.is_long);
    const borrow_fee = calcBorrowFee(
      size,
      pos.entry_borrow_index,
      this.market.acc_borrow_index,
    );
    const funding_fee = calcFundingFee(
      size,
      pos.entry_funding_index,
      this.market.acc_funding_index,
      pos.is_long,
    );
    const health = calcHealth(collateral, pnl, borrow_fee, funding_fee);
    return { pnl, borrow_fee, funding_fee, health };
  }

  isTpTriggered(take_profit: bigint, is_long: boolean): boolean {
    return isTpTriggered(take_profit, this.mark_price, is_long);
  }

  isSlTriggered(stop_loss: bigint, is_long: boolean): boolean {
    return isSlTriggered(stop_loss, this.mark_price, is_long);
  }
}
