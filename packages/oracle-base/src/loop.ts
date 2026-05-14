import { createPublisher, scaleUsd, type OraclePublisher } from "./publisher.js";
import { loadOracleEnv } from "./config.js";
import { DEFAULT_POLICY, type PriceSource, type PushPolicy } from "./types.js";

export interface RunOracleArgs {
  /** Source-specific identifier; used for log prefix and the secret env var name. */
  source: PriceSource;
  /** Protocol tickers (e.g. ["BTCUSD", "ETHUSD"]) hardcoded by each implementation. */
  tickers: string[];
  /** Per-source oracle contract address (resolved from @stellars/config). */
  oracleContract: string;
  /** Env var name holding the publisher secret (e.g. "BINANCE_ORACLE_SECRET"). */
  secretEnv: string;
  /** Override pushing thresholds. Defaults to {@link DEFAULT_POLICY}. */
  policy?: Partial<PushPolicy>;
}

interface LastPush {
  scaledPrice: bigint;
  /** ms epoch — local clock is fine, this is a coarse rate-limiter, not a proof. */
  at: number;
}

/**
 * Run a single source's publish loop until the process receives SIGINT/SIGTERM.
 * One loop per source — each implementation calls this from its own entrypoint.
 *
 * Resilience model:
 *   - Fetch error: log + skip this tick. Do not back off; transient CEX hiccups
 *     are common and the next poll will recover.
 *   - Submit error: log + retry on the next tick. The tx may have actually
 *     landed (RPC blip after submission) — if so, the next push will simply be
 *     a no-op until the threshold trips again.
 */
export async function runOracleLoop(args: RunOracleArgs): Promise<void> {
  const policy: PushPolicy = { ...DEFAULT_POLICY, ...(args.policy ?? {}) };
  const env = loadOracleEnv({ secretEnv: args.secretEnv, oracleContract: args.oracleContract });
  const publisher = createPublisher(env);
  const tag = `[${args.source.name}]`;

  console.log(`${tag} Network:        ${env.network}`);
  console.log(`${tag} Oracle:         ${env.oracleContract}`);
  console.log(`${tag} Publisher:      ${publisher.publicKey}`);
  console.log(`${tag} Tickers:        ${args.tickers.join(", ")}`);
  console.log(`${tag} Poll cadence:   ${policy.pollIntervalMs}ms`);
  console.log(`${tag} Δ threshold:    ${policy.pushOnDeltaBps}bps`);
  console.log(`${tag} Stale push:     ${policy.pushOnStaleSec}s`);

  const lastPush = new Map<string, LastPush>();

  let running = true;
  const shutdown = () => {
    if (!running) return;
    console.log(`${tag} shutting down...`);
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    for (const ticker of args.tickers) {
      if (!running) break;
      await tickOnce(tag, args.source, ticker, publisher, lastPush, policy);
    }
    if (!running) break;
    await sleep(policy.pollIntervalMs);
  }

  console.log(`${tag} stopped.`);
}

async function tickOnce(
  tag: string,
  source: PriceSource,
  ticker: string,
  publisher: OraclePublisher,
  lastPush: Map<string, LastPush>,
  policy: PushPolicy,
): Promise<void> {
  let usd: number;
  try {
    usd = await source.fetchPrice(ticker);
  } catch (err) {
    console.error(`${tag} fetch ${ticker} failed: ${(err as Error)?.message ?? err}`);
    return;
  }

  let scaled: bigint;
  try {
    scaled = scaleUsd(usd);
  } catch (err) {
    console.error(`${tag} scale ${ticker} failed: ${(err as Error)?.message ?? err}`);
    return;
  }

  const prev = lastPush.get(ticker);

  // Reject outlier ticks before they can be published. A single bad CEX
  // print that moves >maxDeltaBpsPerTick from the prior fresh price is
  // dropped here and the next poll re-evaluates.
  if (prev) {
    const deltaBps = absDeltaBps(scaled, prev.scaledPrice);
    if (deltaBps > BigInt(policy.maxDeltaBpsPerTick)) {
      console.error(
        `${tag} reject ${ticker} delta=${deltaBps}bps > maxDeltaBpsPerTick=${policy.maxDeltaBpsPerTick}bps (usd=${usd.toFixed(4)} prev=${prev.scaledPrice})`,
      );
      return;
    }
    // Minimum interval between two consecutive pushes for the same symbol.
    // Even if the price drifted enough, throttle the on-chain push.
    const sinceLastPushMs = Date.now() - prev.at;
    if (sinceLastPushMs < policy.minIntervalBetweenPushesMs) {
      return;
    }
  }

  if (!shouldPush(prev, scaled, policy)) return;

  try {
    await publisher.setPrice(ticker, scaled);
    lastPush.set(ticker, { scaledPrice: scaled, at: Date.now() });
    console.log(`${tag} pushed ${ticker} = ${usd.toFixed(4)} (${scaled})`);
  } catch (err) {
    console.error(`${tag} submit ${ticker} failed: ${(err as Error)?.message ?? err}`);
  }
}

function absDeltaBps(a: bigint, b: bigint): bigint {
  if (b <= 0n) return 0n;
  const diff = a > b ? a - b : b - a;
  return (diff * 10_000n) / b;
}

function shouldPush(prev: LastPush | undefined, next: bigint, policy: PushPolicy): boolean {
  if (!prev) return true;
  const ageMs = Date.now() - prev.at;
  if (ageMs >= policy.pushOnStaleSec * 1000) return true;
  // Compare against the *previous* price as the denominator — this matches how
  // the OracleRouter computes deviation, so our publisher won't accidentally
  // sit on a price the router would reject as drifted.
  const deltaBps = absDeltaBps(next, prev.scaledPrice);
  return deltaBps >= BigInt(policy.pushOnDeltaBps);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
