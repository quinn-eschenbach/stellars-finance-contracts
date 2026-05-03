import type { PriceSource } from "@stellars/oracle-base";

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

interface KucoinTickerResponse {
  code: string;
  data: {
    price: string;
    time: number;
  } | null;
}

export const kucoinSource: PriceSource = {
  name: "kucoin",
  async fetchPrice(ticker: string): Promise<number> {
    const cexSymbol = SYMBOL_MAP[ticker];
    if (!cexSymbol) {
      throw new Error(`kucoin: no symbol mapping for ticker ${ticker}`);
    }
    const url = `${ENDPOINT}?symbol=${encodeURIComponent(cexSymbol)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`kucoin: HTTP ${res.status} for ${cexSymbol}`);
    }
    const json = (await res.json()) as KucoinTickerResponse;
    // KuCoin wraps everything in {code, data} — code "200000" is success;
    // anything else is a soft API failure (rate limit, bad symbol, etc.).
    if (json.code !== "200000" || !json.data) {
      throw new Error(`kucoin: API error code=${json.code} for ${cexSymbol}`);
    }
    const price = Number.parseFloat(json.data.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`kucoin: bad price '${json.data.price}' for ${cexSymbol}`);
    }
    return price;
  },
};
