import { createBookTickerSource, type BookTickerParseResult } from "@stellars/oracle-base";
import { ORACLE_KUCOIN_STALENESS_MS } from "@stellars/config";

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

function parseResponse(json: unknown): BookTickerParseResult {
  const body = json as KucoinLevel1Response;
  if (body.code !== "200000" || !body.data) {
    return { error: `API error code=${body.code}` };
  }
  const bid = Number.parseFloat(body.data.bestBid);
  const ask = Number.parseFloat(body.data.bestAsk);
  return { book: { bid, ask, serverTimestampMs: body.data.time } };
}

export const kucoinSource = createBookTickerSource({
  name: "kucoin",
  endpoint: ENDPOINT,
  symbolMap: SYMBOL_MAP,
  parseResponse,
  stalenessMs: ORACLE_KUCOIN_STALENESS_MS,
});
