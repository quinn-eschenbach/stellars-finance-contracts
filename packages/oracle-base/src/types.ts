import {
  ORACLE_MAX_DELTA_BPS_PER_TICK,
  ORACLE_MIN_INTERVAL_BETWEEN_PUSHES_MS,
  ORACLE_POLL_INTERVAL_MS,
} from "@stellars/config";

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
 *
 * `maxDeltaBpsPerTick` is a HARD upper bound — if the upstream CEX returns
 * a price that moved more than this since the last fresh tick, we reject
 * the tick entirely (do NOT publish) and log. This stops a single outlier
 * print from poisoning the on-chain median.
 */
export interface PushPolicy {
  pollIntervalMs: number;
  pushOnDeltaBps: number;
  pushOnStaleSec: number;
  /** Reject any tick whose delta vs the prior price exceeds this. */
  maxDeltaBpsPerTick: number;
  /** Minimum interval between consecutive on-chain pushes per symbol. */
  minIntervalBetweenPushesMs: number;
}

/**
 * Default policy. Values come from @stellars/config so every off-chain
 * service shares the same source of truth.
 */
export const DEFAULT_POLICY: PushPolicy = {
  pollIntervalMs: ORACLE_POLL_INTERVAL_MS,
  pushOnDeltaBps: 5,
  pushOnStaleSec: 5,
  maxDeltaBpsPerTick: ORACLE_MAX_DELTA_BPS_PER_TICK,
  minIntervalBetweenPushesMs: ORACLE_MIN_INTERVAL_BETWEEN_PUSHES_MS,
};
