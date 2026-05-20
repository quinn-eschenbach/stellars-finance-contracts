import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiGet } from "./client";
import { configManager, mockToken, vault } from "@/contracts/clients";
import type {
  CandleInterval,
  CandleRow,
  LeaderboardRow,
  MarketRow,
  PositionRow,
  PriceRow,
  ProtocolConfigRow,
  TradeRow,
  VaultProfitabilityRow,
  VaultStateRow,
} from "./types";

/**
 * Query keys — exported so SSE hooks can invalidate / setQueryData on the same
 * keys, and so mutation handlers can target specific caches without spreading
 * magic-string keys across components.
 */
export const queryKeys = {
  markets: ["markets"] as const,
  market: (symbol: string) => ["markets", symbol] as const,
  positions: (trader: string) => ["positions", trader] as const,
  trades: (filters: TradesFilters) => ["trades", filters] as const,
  vault: ["vault"] as const,
  vaultProfitability: (days: number) => ["vault", "profitability", days] as const,
  prices: ["prices"] as const,
  candles: (symbol: string, interval: CandleInterval) =>
    ["candles", symbol, interval] as const,
  leaderboard: (limit: number) => ["leaderboard", limit] as const,
  walletBalance: (address: string | null | undefined) =>
    ["walletBalance", address ?? ""] as const,
  vaultShareBalance: (address: string | null | undefined) =>
    ["vaultShareBalance", address ?? ""] as const,
  lockup: (address: string | null | undefined) => ["lockup", address ?? ""] as const,
  config: ["config"] as const,
  feeConfig: ["feeConfig"] as const,
};

/**
 * `FeeConfig` mirror — open fee, liquidation bounty, TP/SL execution fee.
 * Read straight off ConfigManager because the API's `/config` endpoint
 * intentionally omits this struct (see `ProtocolConfigRow` comments).
 */
export interface FeeConfigData {
  open_fee_bps: number;
  liquidation_bounty_bps: number;
  tp_sl_execution_fee: string;
}

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

/**
 * Rolling LP profitability over a sliding `days` window. Two numbers:
 * net from trader PnL flow (-pnl summed over closes) and the LP slice of
 * borrow + funding fees. Updates rarely — a longer staleTime is fine.
 */
export function useVaultProfitability(
  days = 30,
  opts?: UseQueryOptions<VaultProfitabilityRow>,
) {
  return useQuery({
    queryKey: queryKeys.vaultProfitability(days),
    queryFn: () => apiGet<VaultProfitabilityRow>(`/vault/profitability?days=${days}`),
    staleTime: 60_000,
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

export function useCandles(
  symbol: string,
  interval: CandleInterval,
  opts?: UseQueryOptions<CandleRow[]>,
) {
  return useQuery({
    queryKey: queryKeys.candles(symbol, interval),
    queryFn: () => apiGet<CandleRow[]>(`/prices/${symbol}/candles?interval=${interval}&limit=500`),
    enabled: !!symbol,
    staleTime: 5_000,
    ...opts,
  });
}

export function useLeaderboard(limit = 50, opts?: UseQueryOptions<LeaderboardRow[]>) {
  return useQuery({
    queryKey: queryKeys.leaderboard(limit),
    queryFn: () => apiGet<LeaderboardRow[]>(`/leaderboard?limit=${limit}`),
    staleTime: 10_000,
    ...opts,
  });
}

/**
 * Wallet's mock-USDC balance (scaled bigint). Sourced via a contract simulation
 * rather than the API — but the seam the rest of the app sees is the same
 * registered query key. Mutations (mint, deposit, withdraw, open, close) should
 * `qc.invalidateQueries({ queryKey: queryKeys.walletBalance(address) })` on
 * success rather than refetching ad-hoc.
 */
export function useWalletBalance(
  address: string | null | undefined,
  opts?: UseQueryOptions<bigint>,
) {
  return useQuery({
    queryKey: queryKeys.walletBalance(address),
    queryFn: async () => {
      if (!address) return 0n;
      const tx = await mockToken(address).balance({ account: address });
      return BigInt(tx.result?.toString() ?? "0");
    },
    enabled: !!address,
    refetchInterval: 10_000,
    ...opts,
  });
}

/**
 * Wallet's vault LP-share balance (scaled bigint). Mirrors `useWalletBalance`
 * but reads from the vault contract's share token instead of the USDC mock.
 * Invalidated on deposit/withdraw alongside the other vault-side queries.
 */
export function useVaultShareBalance(
  address: string | null | undefined,
  opts?: UseQueryOptions<bigint>,
) {
  return useQuery({
    queryKey: queryKeys.vaultShareBalance(address),
    queryFn: async () => {
      if (!address) return 0n;
      const tx = await vault(address).balance({ account: address });
      return BigInt(tx.result?.toString() ?? "0");
    },
    enabled: !!address,
    refetchInterval: 10_000,
    ...opts,
  });
}

/**
 * Protocol-wide config singleton — fee splits, limits, BorrowRateConfig, and
 * last_unpause_time. Reads change rarely (admin-only ops); a 60s staleTime is
 * fine, with manual invalidation if/when an admin panel ships.
 */
export function useProtocolConfig(opts?: UseQueryOptions<ProtocolConfigRow>) {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => apiGet<ProtocolConfigRow>("/config"),
    staleTime: 60_000,
    ...opts,
  });
}

/**
 * Per-user LP lockup expiry (unix seconds). Frozen at deposit time and reads
 * zero before the first deposit, so the queryFn can cheaply default to 0 when
 * no address is connected.
 */
export function useLockup(
  address: string | null | undefined,
  opts?: UseQueryOptions<number>,
) {
  return useQuery({
    queryKey: queryKeys.lockup(address),
    queryFn: async () => {
      if (!address) return 0;
      const tx = await vault(address).lockup_expires_at({ user: address });
      return Number(tx.result ?? 0);
    },
    enabled: !!address,
    staleTime: 5_000,
    ...opts,
  });
}

/**
 * On-chain `FeeConfig` — read directly from the ConfigManager contract
 * because the API's `protocol_config` row does not mirror it. Changes
 * only via an admin call, so a long staleTime is fine.
 *
 * Requires a connected wallet because the Soroban RPC rejects simulations
 * whose source account isn't funded on-network — a synthetic placeholder
 * G-address would pass checksum validation but get bounced with
 * "Account not found". This is fine in practice: fee numbers are only
 * meaningful when the user is about to submit a tx, which already requires
 * being connected.
 *
 * Returns a JSON-safe shape (`tp_sl_execution_fee` as string) — the
 * binding's `i128` would serialise as a bigint otherwise and lose
 * react-query cache survivability across reloads.
 */
export function useFeeConfig(
  address: string | null | undefined,
  opts?: UseQueryOptions<FeeConfigData>,
) {
  return useQuery({
    queryKey: queryKeys.feeConfig,
    queryFn: async () => {
      if (!address) throw new Error("address required");
      const tx = await configManager(address).get_fee_config();
      const r = tx.result;
      return {
        open_fee_bps: Number(r.open_fee_bps),
        liquidation_bounty_bps: Number(r.liquidation_bounty_bps),
        tp_sl_execution_fee: r.tp_sl_execution_fee.toString(),
      } satisfies FeeConfigData;
    },
    enabled: !!address,
    staleTime: 60_000,
    ...opts,
  });
}
