// CEX bid/ask book-ticker source factory. Concentrates the shared shape
// (timeout, retry-after surfacing, bid/ask parse + sanity + crossed-book
// rejection, mid = (bid+ask)/2) that would otherwise live in every
// per-source adapter. Each CEX adapter supplies its own symbol map, endpoint,
// and response parser.

import { ORACLE_FETCH_TIMEOUT_MS, ORACLE_USER_AGENT } from "@stellars/config";
import type { PriceSource } from "./types.js";

/**
 * Per-source parse result. `book.serverTimestampMs` is optional — sources
 * that don't surface a server timestamp (Binance) leave it undefined; sources
 * that do (KuCoin) populate it so the factory can enforce a freshness gate.
 */
export type BookTickerParseResult =
  | { book: { bid: number; ask: number; serverTimestampMs?: number } }
  | { error: string };

export interface BookTickerSourceArgs {
  /** Short identifier used in logs / metrics (`"binance"`, `"kucoin"`). */
  name: string;
  /** Base URL — `?symbol=<cexSymbol>` is appended. */
  endpoint: string;
  /** Protocol ticker (`"BTCUSD"`) → CEX symbol (`"BTCUSDT"` / `"BTC-USDT"`). */
  symbolMap: Record<string, string>;
  /** Parse the raw response body. Sources own their JSON shape entirely. */
  parseResponse: (json: unknown) => BookTickerParseResult;
  /**
   * When defined, reject any tick whose `serverTimestampMs` is older than
   * `Date.now() - stalenessMs`. Ignored when the parser didn't surface a
   * server timestamp.
   */
  stalenessMs?: number;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(ORACLE_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": ORACLE_USER_AGENT },
  });
}

export function createBookTickerSource(args: BookTickerSourceArgs): PriceSource {
  return {
    name: args.name,
    async fetchPrice(ticker: string): Promise<number> {
      const cexSymbol = args.symbolMap[ticker];
      if (!cexSymbol) {
        throw new Error(`${args.name}: no symbol mapping for ticker ${ticker}`);
      }
      const url = `${args.endpoint}?symbol=${encodeURIComponent(cexSymbol)}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        // 429 / 418 / Retry-After: surface upstream so the loop can back off.
        const retryAfter = res.headers.get("retry-after");
        const suffix = retryAfter ? ` retry-after=${retryAfter}` : "";
        throw new Error(`${args.name}: HTTP ${res.status} for ${cexSymbol}${suffix}`);
      }
      const json = await res.json();
      const parsed = args.parseResponse(json);
      if ("error" in parsed) {
        throw new Error(`${args.name}: ${parsed.error} for ${cexSymbol}`);
      }
      const { bid, ask, serverTimestampMs } = parsed.book;

      if (args.stalenessMs !== undefined && serverTimestampMs !== undefined) {
        const ageMs = Date.now() - serverTimestampMs;
        if (ageMs > args.stalenessMs) {
          throw new Error(`${args.name}: stale print age=${ageMs}ms for ${cexSymbol}`);
        }
      }

      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
        throw new Error(`${args.name}: bad book bid=${bid} ask=${ask} for ${cexSymbol}`);
      }
      if (ask < bid) {
        throw new Error(`${args.name}: crossed book ask=${ask} < bid=${bid} for ${cexSymbol}`);
      }
      return (bid + ask) / 2;
    },
  };
}
