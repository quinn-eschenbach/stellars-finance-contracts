import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiGet } from "./client";
import type {
  MarketRow,
  PositionRow,
  PriceRow,
  TradeRow,
  VaultStateRow,
} from "./types";

/** Query keys — exported so SSE hooks can invalidate / setQueryData on the same keys. */
export const queryKeys = {
  markets: ["markets"] as const,
  market: (symbol: string) => ["markets", symbol] as const,
  positions: (trader: string) => ["positions", trader] as const,
  trades: (filters: TradesFilters) => ["trades", filters] as const,
  vault: ["vault"] as const,
  prices: ["prices"] as const,
};

export interface TradesFilters {
  symbol?: string;
  trader?: string;
  event_type?: TradeRow["event_type"];
  limit?: number;
  before_id?: number;
}

export function useMarkets(opts?: UseQueryOptions<MarketRow[]>) {
  return useQuery({
    queryKey: queryKeys.markets,
    queryFn: () => apiGet<MarketRow[]>("/markets"),
    staleTime: 5_000,
    ...opts,
  });
}

export function useMarket(symbol: string, opts?: UseQueryOptions<MarketRow>) {
  return useQuery({
    queryKey: queryKeys.market(symbol),
    queryFn: () => apiGet<MarketRow>(`/markets/${symbol}`),
    enabled: !!symbol,
    staleTime: 5_000,
    ...opts,
  });
}

export function usePositions(trader: string | null | undefined, opts?: UseQueryOptions<PositionRow[]>) {
  return useQuery({
    queryKey: queryKeys.positions(trader ?? ""),
    queryFn: () => apiGet<PositionRow[]>(`/positions/${trader}`),
    enabled: !!trader,
    staleTime: 5_000,
    ...opts,
  });
}

export function useTrades(filters: TradesFilters, opts?: UseQueryOptions<TradeRow[]>) {
  const params = new URLSearchParams();
  if (filters.symbol) params.set("symbol", filters.symbol);
  if (filters.trader) params.set("trader", filters.trader);
  if (filters.event_type) params.set("event_type", filters.event_type);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.before_id) params.set("before_id", String(filters.before_id));
  const qs = params.toString();
  return useQuery({
    queryKey: queryKeys.trades(filters),
    queryFn: () => apiGet<TradeRow[]>(`/trades${qs ? `?${qs}` : ""}`),
    staleTime: 5_000,
    ...opts,
  });
}

export function useVault(opts?: UseQueryOptions<VaultStateRow>) {
  return useQuery({
    queryKey: queryKeys.vault,
    queryFn: () => apiGet<VaultStateRow>("/vault"),
    staleTime: 5_000,
    ...opts,
  });
}

export function usePrices(opts?: UseQueryOptions<PriceRow[]>) {
  return useQuery({
    queryKey: queryKeys.prices,
    queryFn: () => apiGet<PriceRow[]>("/prices"),
    staleTime: 2_000,
    ...opts,
  });
}
