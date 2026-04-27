export const PRECISION = 10_000_000n;
export const INDEX_PRECISION = 100_000_000_000_000n;
export const BPS = 10_000n;

export function toBigInt(value: string | null | undefined): bigint {
  if (value == null || value === "") return 0n;
  return BigInt(value);
}

export function calcUnrealizedPnl(
  size: bigint,
  entryPrice: bigint,
  markPrice: bigint,
  isLong: boolean,
): bigint {
  if (entryPrice === 0n || size === 0n) return 0n;
  const priceDiff = isLong ? markPrice - entryPrice : entryPrice - markPrice;
  return (size * priceDiff) / entryPrice;
}

export function calcBorrowFee(
  size: bigint,
  entryBorrowIndex: bigint,
  currentBorrowIndex: bigint,
): bigint {
  return ((currentBorrowIndex - entryBorrowIndex) * size) / INDEX_PRECISION;
}

export function calcFundingFee(
  size: bigint,
  entryFundingIndex: bigint,
  currentFundingIndex: bigint,
  isLong: boolean,
): bigint {
  const delta = currentFundingIndex - entryFundingIndex;
  return isLong
    ? -((delta * size) / INDEX_PRECISION)
    : (delta * size) / INDEX_PRECISION;
}

export function calcHealth(
  collateral: bigint,
  unrealizedPnl: bigint,
  borrowFee: bigint,
  fundingFee: bigint,
): bigint {
  return collateral + unrealizedPnl - borrowFee + fundingFee;
}

export function isTpTriggered(
  takeProfit: bigint,
  markPrice: bigint,
  isLong: boolean,
): boolean {
  if (takeProfit <= 0n) return false;
  return isLong ? markPrice >= takeProfit : markPrice <= takeProfit;
}

export function isSlTriggered(
  stopLoss: bigint,
  markPrice: bigint,
  isLong: boolean,
): boolean {
  if (stopLoss <= 0n) return false;
  return isLong ? markPrice <= stopLoss : markPrice >= stopLoss;
}
