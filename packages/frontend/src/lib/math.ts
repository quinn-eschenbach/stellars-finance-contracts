/**
 * Frontend-only display heuristics. The on-chain math (PnL, fees, indices)
 * lives in `@stellars/protocol-math`; only formulas that don't have a
 * protocol counterpart belong here.
 */

/**
 * Approximate liquidation price for a brand-new position (ignoring borrow /
 * funding fees). Used in the order preview where exact projection isn't
 * available — actual liquidation depends on accrued indices over the
 * position's lifetime, which `MarketTick.project()` can give us once the
 * full projection seam is wired through.
 *
 * Long:  liq ≈ entry × (1 − 1/leverage)
 * Short: liq ≈ entry × (1 + 1/leverage)
 */
export function approxLiquidationPrice(
  entryPrice: bigint,
  collateral: bigint,
  size: bigint,
  isLong: boolean,
): bigint | null {
  if (size <= 0n || collateral <= 0n) return null;
  const adjustment = (entryPrice * collateral) / size;
  return isLong ? entryPrice - adjustment : entryPrice + adjustment;
}
