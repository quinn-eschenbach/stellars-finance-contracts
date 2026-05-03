import type { PriceSource } from "@stellars/oracle-base";

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

const ENDPOINT = "https://api.binance.com/api/v3/ticker/price";

interface BinanceTickerResponse {
  symbol: string;
  price: string;
}

export const binanceSource: PriceSource = {
  name: "binance",
  async fetchPrice(ticker: string): Promise<number> {
    const cexSymbol = SYMBOL_MAP[ticker];
    if (!cexSymbol) {
      throw new Error(`binance: no symbol mapping for ticker ${ticker}`);
    }
    const url = `${ENDPOINT}?symbol=${encodeURIComponent(cexSymbol)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`binance: HTTP ${res.status} for ${cexSymbol}`);
    }
    const json = (await res.json()) as BinanceTickerResponse;
    const price = Number.parseFloat(json.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`binance: bad price '${json.price}' for ${cexSymbol}`);
    }
    return price;
  },
};
