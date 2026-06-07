import { useMemo } from "react";
import {
  calcUnrealizedPnl,
  liquidationPriceForPosition,
  type PositionEvaluation,
} from "@stellars/protocol-math";
import { useMarketTick } from "./marketTick";
import { useProtocolConfig } from "./hooks";
import type { PositionRow } from "./types";

export interface PositionView {
  isLong: boolean;
  size: bigint;
  collateral: bigint;
  entryPrice: bigint;
  tp: bigint;
  sl: bigint;
  /** size / collateral, one decimal — e.g. 5 or 7.5. */
  leverage: number;
  /** Fee-adjusted PositionEvaluation, or null while the tick is loading. */
  evaluation: PositionEvaluation | null;
  /**
   * Unrealized PnL. Fee-adjusted when the tick is available; falls back to
   * the price-only `calcUnrealizedPnl` so rows can render before the
   * projection inputs (vault, config, market) are loaded.
   */
  pnl: bigint;
  /** PnL as a percent of collateral, 2dp. */
  pnlPct: number;
  /** Tailwind tone class for the PnL figure, or undefined when flat. */
  pnlClass: "text-bull" | "text-bear" | undefined;
  /** Projected liquidation price against the live tick, or null while loading. */
  liqPrice: bigint | null;
}

/**
 * The single UI seam for valuing an open Position: pulls the projected
 * MarketTick and the protocol config, runs `MarketTick.evaluate`, and applies
 * the display fallbacks. Components bind these fields and never re-derive
 * them — the PositionEvaluation counterpart of the IncreaseQuote rule.
 *
 * Null-tolerant so callers with an optional Position can call it
 * unconditionally; React Query dedupes the backing tick queries across rows.
 */
export function usePositionEvaluation(
  position: PositionRow | null | undefined,
  markPrice?: string,
): PositionView | null {
  const tick = useMarketTick(position?.symbol);
  const config = useProtocolConfig();
  const liqThresholdBps = BigInt(config.data?.liquidation_threshold_bps ?? 0);
  const fundingCutBps = BigInt(config.data?.funding_cut_bps ?? 0);

  return useMemo(() => {
    if (!position) return null;

    const size = BigInt(position.size);
    const collateral = BigInt(position.collateral);
    const isLong = position.is_long;
    const entryPrice = BigInt(position.entry_price);

    const evaluation = tick
      ? tick.evaluate(
          {
            is_long: isLong,
            size,
            collateral,
            entry_price: entryPrice,
            entry_borrow_index: BigInt(position.entry_borrow_index),
            entry_funding_index: BigInt(position.entry_funding_index),
          },
          undefined,
          fundingCutBps,
        )
      : null;

    const pnl =
      evaluation?.pnl ??
      (markPrice ? calcUnrealizedPnl(size, entryPrice, BigInt(markPrice), isLong) : 0n);

    return {
      isLong,
      size,
      collateral,
      entryPrice,
      tp: BigInt(position.take_profit),
      sl: BigInt(position.stop_loss),
      leverage: collateral > 0n ? Number((size * 10n) / collateral) / 10 : 0,
      evaluation,
      pnl,
      pnlPct: collateral > 0n ? Number((pnl * 10_000n) / collateral) / 100 : 0,
      pnlClass: pnl > 0n ? "text-bull" : pnl < 0n ? "text-bear" : undefined,
      liqPrice: tick
        ? liquidationPriceForPosition(position, tick, liqThresholdBps, fundingCutBps)
        : null,
    };
  }, [position, tick, markPrice, liqThresholdBps, fundingCutBps]);
}
