import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/constants";
import { queryKeys } from "./hooks";
import type { MarketRow, PositionRow, PriceRow, TradeRow, VaultStateRow } from "./types";

/**
 * Open an EventSource against the API's SSE endpoint, parse JSON event data,
 * and call `onEvent` for each. Returns a cleanup that closes the stream.
 *
 * EventSource is browser-native; no extra dep needed. Cross-region LB
 * stickiness is the deployment side of this — see project memory.
 */
function streamEvents<T>(path: string, eventName: string, onEvent: (data: T) => void): () => void {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const es = new EventSource(url);
  // Per EventSource spec: messages with an explicit `event:` field are NOT
  // delivered to onmessage — they only fire listeners registered for that
  // exact name. The API tags every stream (event: "price" / "market" / ...),
  // so listening via onmessage silently drops everything.
  const handler = (e: MessageEvent) => {
    try {
      onEvent(JSON.parse(e.data) as T);
    } catch (err) {
      console.error(`[sse] failed to parse event from ${path}:`, err);
    }
  };
  es.addEventListener(eventName, handler);
  // EventSource auto-reconnects on transient errors. Log only to keep the
  // user informed.
  es.onerror = () => console.warn(`[sse] reconnecting ${path}…`);
  return () => {
    es.removeEventListener(eventName, handler);
    es.close();
  };
}

/** Stream price updates → patch the prices query cache by symbol. */
export function useStreamPrices() {
  const qc = useQueryClient();
  useEffect(() => {
    return streamEvents<PriceRow>("/stream/prices", "price", (price) => {
      qc.setQueryData<PriceRow[]>(queryKeys.prices, (prev) => {
        if (!prev) return [price];
        const idx = prev.findIndex((p) => p.symbol === price.symbol);
        if (idx === -1) return [...prev, price];
        const next = prev.slice();
        next[idx] = price;
        return next;
      });
    });
  }, [qc]);
}

/** Stream a single market's state changes → replace its query cache entry. */
export function useStreamMarket(symbol: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!symbol) return;
    return streamEvents<MarketRow>(`/stream/markets/${symbol}`, "market", (market) => {
      qc.setQueryData(queryKeys.market(symbol), market);
      // Also patch the markets list if it's loaded.
      qc.setQueryData<MarketRow[]>(queryKeys.markets, (prev) => {
        if (!prev) return prev;
        const idx = prev.findIndex((m) => m.symbol === symbol);
        if (idx === -1) return [...prev, market];
        const next = prev.slice();
        next[idx] = market;
        return next;
      });
    });
  }, [qc, symbol]);
}

/** Stream a market's trades → invalidate trade queries for that symbol. */
export function useStreamTrades(symbol: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!symbol) return;
    return streamEvents<TradeRow>(`/stream/trades/${symbol}`, "trade", () => {
      // Trade queries are filtered by varied params; safer to invalidate
      // than try to patch all relevant lists. Cheap because the trades
      // page only mounts a few queries at a time.
      qc.invalidateQueries({ queryKey: ["trades"] });
    });
  }, [qc, symbol]);
}

/**
 * Stream all position changes globally; refresh the trader's position list
 * whenever an event mentions them. Cheaper to invalidate than to merge
 * partial payloads (the SSE event is just identifiers, not the full row).
 */
export function useStreamPositions(trader: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!trader) return;
    return streamEvents<{ trader: string; symbol: string; op: string }>(
      "/stream/positions",
      "position",
      (event) => {
        if (event.trader === trader) {
          qc.invalidateQueries({ queryKey: queryKeys.positions(trader) });
        }
      },
    );
  }, [qc, trader]);
}

/** Stream vault state → replace the vault query cache. */
export function useStreamVault() {
  const qc = useQueryClient();
  useEffect(() => {
    return streamEvents<VaultStateRow>("/stream/vault", "vault", (vault) => {
      qc.setQueryData(queryKeys.vault, vault);
    });
  }, [qc]);
}
