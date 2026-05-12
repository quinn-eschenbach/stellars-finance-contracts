import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import {
  useStreamMarket,
  useStreamPositions,
  useStreamPrices,
  useStreamTrades,
  useStreamVault,
} from "./sse";
import { queryKeys } from "./hooks";
import type { MarketRow, PriceRow, VaultStateRow } from "./types";

/**
 * The SSE hooks open an `EventSource`, register a named-event listener, and
 * patch the react-query cache on each message. We stub `EventSource` with a
 * tiny class that lets us fire events directly into the registered handler,
 * then assert what landed in the QueryClient cache.
 */

interface RegisteredListener {
  event: string;
  fn: (e: MessageEvent) => void;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: RegisteredListener[] = [];
  onerror: ((e: Event) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(event: string, fn: (e: MessageEvent) => void) {
    this.listeners.push({ event, fn });
  }

  removeEventListener(event: string, fn: (e: MessageEvent) => void) {
    this.listeners = this.listeners.filter((l) => !(l.event === event && l.fn === fn));
  }

  close() {
    this.closed = true;
  }

  fire(event: string, data: unknown) {
    for (const l of this.listeners) {
      if (l.event === event) l.fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  fireRaw(event: string, raw: string) {
    for (const l of this.listeners) {
      if (l.event === event) l.fn({ data: raw } as MessageEvent);
    }
  }

  static lastInstance() {
    return FakeEventSource.instances.at(-1)!;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useStreamPrices", () => {
  it("inserts a new price into an empty cache", () => {
    const qc = new QueryClient();
    renderHook(() => useStreamPrices(), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    const price: PriceRow = {
      symbol: "BTCUSD",
      price: "950000000000",
      ledger: 100,
      timestamp: "1700000000",
    };
    act(() => es.fire("price", price));
    expect(qc.getQueryData(queryKeys.prices)).toEqual([price]);
  });

  it("replaces an existing symbol in place", () => {
    const qc = new QueryClient();
    qc.setQueryData<PriceRow[]>(queryKeys.prices, [
      { symbol: "BTCUSD", price: "1", ledger: 1, timestamp: "1" },
      { symbol: "ETHUSD", price: "2", ledger: 2, timestamp: "2" },
    ]);
    renderHook(() => useStreamPrices(), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    act(() =>
      es.fire("price", { symbol: "BTCUSD", price: "999", ledger: 3, timestamp: "3" }),
    );
    expect(qc.getQueryData<PriceRow[]>(queryKeys.prices)).toEqual([
      { symbol: "BTCUSD", price: "999", ledger: 3, timestamp: "3" },
      { symbol: "ETHUSD", price: "2", ledger: 2, timestamp: "2" },
    ]);
  });

  it("appends a brand-new symbol when the cache has other rows", () => {
    const qc = new QueryClient();
    qc.setQueryData<PriceRow[]>(queryKeys.prices, [
      { symbol: "BTCUSD", price: "1", ledger: 1, timestamp: "1" },
    ]);
    renderHook(() => useStreamPrices(), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    act(() =>
      es.fire("price", { symbol: "ETHUSD", price: "5", ledger: 2, timestamp: "2" }),
    );
    const rows = qc.getQueryData<PriceRow[]>(queryKeys.prices);
    expect(rows?.map((r) => r.symbol)).toEqual(["BTCUSD", "ETHUSD"]);
  });

  it("ignores malformed JSON and logs a parse error", () => {
    const qc = new QueryClient();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useStreamPrices(), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    act(() => es.fireRaw("price", "not-json{"));
    expect(qc.getQueryData(queryKeys.prices)).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("closes the EventSource on unmount", () => {
    const qc = new QueryClient();
    const { unmount } = renderHook(() => useStreamPrices(), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });
});

describe("useStreamMarket", () => {
  const fullMarket = (sym = "BTCUSD"): MarketRow => ({
    symbol: sym,
    global_long_avg_price: "0",
    global_short_avg_price: "0",
    long_open_interest: "0",
    short_open_interest: "0",
    acc_borrow_index: "0",
    acc_funding_index: "0",
    last_index_update: "0",
    max_leverage: "100",
    market_unrealized_pnl: "0",
    updated_at_ledger: 1,
    updated_at: "now",
  });

  it("is a no-op when no symbol is provided", () => {
    const qc = new QueryClient();
    renderHook(() => useStreamMarket(null), { wrapper: makeWrapper(qc) });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("writes both the per-symbol cache and the markets list", () => {
    const qc = new QueryClient();
    qc.setQueryData<MarketRow[]>(queryKeys.markets, [fullMarket("ETHUSD")]);
    renderHook(() => useStreamMarket("BTCUSD"), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    const next = fullMarket("BTCUSD");
    act(() => es.fire("market", next));
    expect(qc.getQueryData(queryKeys.market("BTCUSD"))).toEqual(next);
    const list = qc.getQueryData<MarketRow[]>(queryKeys.markets);
    expect(list?.map((m) => m.symbol).sort()).toEqual(["BTCUSD", "ETHUSD"]);
  });

  it("replaces the existing entry in the markets list instead of duplicating", () => {
    const qc = new QueryClient();
    qc.setQueryData<MarketRow[]>(queryKeys.markets, [
      { ...fullMarket("BTCUSD"), max_leverage: "5" },
    ]);
    renderHook(() => useStreamMarket("BTCUSD"), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    act(() => es.fire("market", { ...fullMarket("BTCUSD"), max_leverage: "200" }));
    const list = qc.getQueryData<MarketRow[]>(queryKeys.markets);
    expect(list).toHaveLength(1);
    expect(list?.[0].max_leverage).toBe("200");
  });

  it("leaves the markets list alone when it isn't loaded yet", () => {
    const qc = new QueryClient();
    renderHook(() => useStreamMarket("BTCUSD"), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    act(() => es.fire("market", fullMarket("BTCUSD")));
    expect(qc.getQueryData(queryKeys.markets)).toBeUndefined();
  });
});

describe("useStreamTrades", () => {
  it("is a no-op when no symbol is provided", () => {
    const qc = new QueryClient();
    renderHook(() => useStreamTrades(undefined), { wrapper: makeWrapper(qc) });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("invalidates every trades query when a trade arrives", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useStreamTrades("BTCUSD"), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    act(() => es.fire("trade", { id: 1 }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["trades"] });
  });
});

describe("useStreamPositions", () => {
  it("is a no-op when no trader is provided", () => {
    const qc = new QueryClient();
    renderHook(() => useStreamPositions(undefined), { wrapper: makeWrapper(qc) });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("invalidates only when the event mentions the connected trader", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useStreamPositions("GABC"), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();

    act(() => es.fire("position", { trader: "GZZZ", symbol: "BTCUSD", op: "UPDATE" }));
    expect(invalidate).not.toHaveBeenCalled();

    act(() => es.fire("position", { trader: "GABC", symbol: "BTCUSD", op: "UPDATE" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.positions("GABC") });
  });
});

describe("useStreamVault", () => {
  it("writes the vault state into the cache", () => {
    const qc = new QueryClient();
    renderHook(() => useStreamVault(), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    const vault: VaultStateRow = {
      id: 1,
      total_assets: "1000",
      total_shares: "1000",
      reserved_usdc: "100",
      unclaimed_fees: "0",
      net_global_trader_pnl: "0",
      free_liquidity: "900",
      is_paused: false,
      last_unpause_time: "0",
      updated_at_ledger: 42,
      updated_at: "now",
    };
    act(() => es.fire("vault", vault));
    expect(qc.getQueryData(queryKeys.vault)).toEqual(vault);
  });
});

describe("streamEvents underlying transport", () => {
  it("logs (but doesn't throw) when the EventSource fires an error event", () => {
    const qc = new QueryClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useStreamPrices(), { wrapper: makeWrapper(qc) });
    const es = FakeEventSource.lastInstance();
    expect(() => es.onerror?.(new Event("error"))).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});
