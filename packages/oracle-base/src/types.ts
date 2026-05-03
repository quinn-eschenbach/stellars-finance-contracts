/**
 * A price source fetches the current spot price for a protocol ticker
 * (e.g. "BTCUSD") and returns it as a USD number. Each source handles its
 * own symbol mapping (BTCUSD → BTCUSDT for Binance, BTC-USDT for KuCoin).
 *
 * Implementations must throw on transport / parse failures so the loop can
 * skip the tick rather than push a stale or nonsense price on-chain.
 */
export interface PriceSource {
  /** Short identifier used in logs and metrics, e.g. "binance" / "kucoin". */
  readonly name: string;
  /**
   * Fetch the current USD price for `ticker`. The number returned is in
   * whole dollars (e.g. 65_432.10) — the loop scales it to the contract's
   * 1e7 fixed-point representation before submission.
   */
  fetchPrice(ticker: string): Promise<number>;
}

/**
 * Threshold parameters control how aggressively the loop pushes prices.
 * A push happens iff *either* threshold trips:
 *   - price moved by more than `pushOnDeltaBps` since the last push
 *   - more than `pushOnStaleSec` elapsed since the last push
 *
 * The CEX is polled every `pollIntervalMs` regardless; thresholds only
 * gate the on-chain submission to keep fee burn predictable.
 */
export interface PushPolicy {
  pollIntervalMs: number;
  pushOnDeltaBps: number;
  pushOnStaleSec: number;
}

/** Default policy — 3s poll, 25 bps move OR 30 s staleness triggers a push. */
export const DEFAULT_POLICY: PushPolicy = {
  pollIntervalMs: 3_000,
  pushOnDeltaBps: 25,
  pushOnStaleSec: 30,
};
