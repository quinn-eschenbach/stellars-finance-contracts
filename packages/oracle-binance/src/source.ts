import { createBookTickerSource, type BookTickerParseResult } from "@stellars/oracle-base";

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

function parseResponse(json: unknown): BookTickerParseResult {
  const body = json as BinanceBookTickerResponse;
  const bid = Number.parseFloat(body.bidPrice);
  const ask = Number.parseFloat(body.askPrice);
  return { book: { bid, ask } };
}

export const binanceSource = createBookTickerSource({
  name: "binance",
  endpoint: ENDPOINT,
  symbolMap: SYMBOL_MAP,
  parseResponse,
});
