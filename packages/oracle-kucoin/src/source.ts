import type { PriceSource } from "@stellars/oracle-base";
import {
  ORACLE_FETCH_TIMEOUT_MS,
  ORACLE_KUCOIN_STALENESS_MS,
  ORACLE_USER_AGENT,
} from "@stellars/config";

/**
 * Map protocol tickers (BTCUSD) to KuCoin's spot symbols (BTC-USDT).
 * KuCoin uses a hyphen separator between base and quote.
 */
const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: "BTC-USDT",
  ETHUSD: "ETH-USDT",
  SOLUSD: "SOL-USDT",
  XLMUSD: "XLM-USDT",
};

const ENDPOINT = "https://api.kucoin.com/api/v1/market/orderbook/level1";

interface KucoinLevel1Response {
  code: string;
  data: {
    /** Last trade price — used as a fallback only. */
    price: string;
    /** Best bid price (top of book, bid side). */
    bestBid: string;
    /** Best ask price (top of book, ask side). */
    bestAsk: string;
    /** Server-stamped time of the print, ms epoch. */
    time: number;
  } | null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(ORACLE_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": ORACLE_USER_AGENT },
  });
}

export const kucoinSource: PriceSource = {
  name: "kucoin",
  async fetchPrice(ticker: string): Promise<number> {
    const cexSymbol = SYMBOL_MAP[ticker];
    if (!cexSymbol) {
      throw new Error(`kucoin: no symbol mapping for ticker ${ticker}`);
    }
    const url = `${ENDPOINT}?symbol=${encodeURIComponent(cexSymbol)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after");
      const suffix = retryAfter ? ` retry-after=${retryAfter}` : "";
      throw new Error(`kucoin: HTTP ${res.status} for ${cexSymbol}${suffix}`);
    }
    const json = (await res.json()) as KucoinLevel1Response;
    if (json.code !== "200000" || !json.data) {
      throw new Error(`kucoin: API error code=${json.code} for ${cexSymbol}`);
    }
    // Reject KuCoin prints whose embedded source-timestamp is older than
    // ORACLE_KUCOIN_STALENESS_MS — a stuck KuCoin feed otherwise looks
    // perpetually fresh from our perspective.
    const ageMs = Date.now() - json.data.time;
    if (ageMs > ORACLE_KUCOIN_STALENESS_MS) {
      throw new Error(`kucoin: stale print age=${ageMs}ms for ${cexSymbol}`);
    }
    const bid = Number.parseFloat(json.data.bestBid);
    const ask = Number.parseFloat(json.data.bestAsk);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
      throw new Error(
        `kucoin: bad book bid=${json.data.bestBid} ask=${json.data.bestAsk} for ${cexSymbol}`,
      );
    }
    if (ask < bid) {
      throw new Error(`kucoin: crossed book ask=${ask} < bid=${bid} for ${cexSymbol}`);
    }
    return (bid + ask) / 2;
  },
};
