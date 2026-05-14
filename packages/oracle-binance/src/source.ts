import type { PriceSource } from "@stellars/oracle-base";
import { ORACLE_FETCH_TIMEOUT_MS, ORACLE_USER_AGENT } from "@stellars/config";

/**
 * Map protocol tickers (BTCUSD) to Binance's spot symbols (BTCUSDT).
 * Binance settles USD-denominated pairs in USDT, which trades at parity with
 * USD closely enough for our oracle median use-case.
 */
const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  SOLUSD: "SOLUSDT",
  XLMUSD: "XLMUSDT",
};

/**
 * Use bookTicker mid instead of `ticker/price` (last trade). lastPrice on
 * thin venues is movable by a single market order; the bid/ask mid is
 * anchored to the depth of book on both sides.
 */
const ENDPOINT = "https://api.binance.com/api/v3/ticker/bookTicker";

interface BinanceBookTickerResponse {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(ORACLE_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": ORACLE_USER_AGENT },
  });
}

export const binanceSource: PriceSource = {
  name: "binance",
  async fetchPrice(ticker: string): Promise<number> {
    const cexSymbol = SYMBOL_MAP[ticker];
    if (!cexSymbol) {
      throw new Error(`binance: no symbol mapping for ticker ${ticker}`);
    }
    const url = `${ENDPOINT}?symbol=${encodeURIComponent(cexSymbol)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      // 429 / 418 / Retry-After: surface upstream so the loop can back off.
      const retryAfter = res.headers.get("retry-after");
      const suffix = retryAfter ? ` retry-after=${retryAfter}` : "";
      throw new Error(`binance: HTTP ${res.status} for ${cexSymbol}${suffix}`);
    }
    const json = (await res.json()) as BinanceBookTickerResponse;
    const bid = Number.parseFloat(json.bidPrice);
    const ask = Number.parseFloat(json.askPrice);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
      throw new Error(
        `binance: bad bookTicker bid=${json.bidPrice} ask=${json.askPrice} for ${cexSymbol}`,
      );
    }
    if (ask < bid) {
      throw new Error(`binance: crossed book ask=${ask} < bid=${bid} for ${cexSymbol}`);
    }
    return (bid + ask) / 2;
  },
};
