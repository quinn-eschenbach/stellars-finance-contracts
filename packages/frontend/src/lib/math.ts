/**
 * Frontend-side display math. Mirrors a subset of the keeper / contract math
 * used to surface human-readable signals (estimated liquidation price, P&L,
 * effective leverage) without round-tripping through the contract.
 *
 * All values are protocol-scaled bigints unless stated otherwise.
 */

const PRECISION = 10_000_000n; // 1e7 — USDC and price scaling
const BPS = 10_000n;

/**
 * Approximate liquidation price for a brand-new position (ignoring borrow /
 * funding fees). Useful as a rough signal in the order preview; the actual
 * liquidation depends on accrued indices over the position's lifetime.
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

/** Unrealized PnL on a position at the given mark price. */
export function unrealizedPnl(
  size: bigint,
  entryPrice: bigint,
  markPrice: bigint,
  isLong: boolean,
): bigint {
  if (size === 0n || entryPrice === 0n) return 0n;
  const priceDelta = isLong ? markPrice - entryPrice : entryPrice - markPrice;
  return (size * priceDelta) / entryPrice;
}

/** Current effective leverage given collateral + size, in BPS (e.g. 5x = 50_000). */
export function effectiveLeverageBps(collateral: bigint, size: bigint): bigint {
  if (collateral <= 0n) return 0n;
  return (size * BPS) / collateral;
}

export { PRECISION, BPS };
