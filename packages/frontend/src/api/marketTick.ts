import { useEffect, useMemo, useState } from "react";
import {
  MarketTick,
  toBigInt,
  toBorrowRateConfig,
  toMarketState,
  toVaultLiquidity,
} from "@stellars/protocol-math";
import { useMarket, useProtocolConfig, usePrices, useVault } from "./hooks";
import type { MarketRow, PriceRow, ProtocolConfigRow, VaultStateRow } from "./types";

/**
 * Off-chain MarketTick projected to "now" — the seam between cached on-chain
 * state and a fresh `PositionEvaluation`. CONTEXT.md defines a MarketTick as
 * "what an immediate on-chain refresh would produce"; this hook assembles one
 * by joining the four queries that hold the inputs (market, vault, config,
 * price) and re-projecting once per second so health/borrow/funding values
 * tick forward without a contract round-trip.
 *
 * Returns `null` while any input is loading or the symbol has no live price —
 * callers should fall back to cached fields (entry price, raw size, etc.)
 * when null is returned.
 */
export function useMarketTick(symbol: string | null | undefined): MarketTick | null {
  // useMarket already disables itself when the symbol is falsy.
  const market = useMarket(symbol ?? "");
  const vault = useVault();
  const config = useProtocolConfig();
  const prices = usePrices();

  // Re-project once per second. The inputs themselves only change on SSE-driven
  // cache patches; without this tick, accrued borrow/funding values would
  // freeze at whatever moment the inputs last updated.
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = window.setInterval(
      () => setNow(BigInt(Math.floor(Date.now() / 1000))),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  return useMemo(() => {
    if (!symbol) return null;
    const m = market.data;
    const v = vault.data;
    const cfg = config.data;
    const price = prices.data?.find((p) => p.symbol === symbol)?.price;
    if (!m || !v || !cfg || !price) return null;
    return projectMarketTick({ market: m, vault: v, config: cfg, price, now });
  }, [symbol, market.data, vault.data, config.data, prices.data, now]);
}

/**
 * Pure projection — exposed so non-hook consumers (e.g. one-shot calculations
 * inside memos that already gather the inputs) can build a tick without
 * pulling in React. Mirrors the Rust contract's MarketTick::refresh shape.
 */
export function projectMarketTick(input: {
  market: MarketRow;
  vault: VaultStateRow;
  config: ProtocolConfigRow;
  price: PriceRow["price"];
  now: bigint;
}): MarketTick {
  const { market: m, vault: v, config: cfg, price, now } = input;
  return MarketTick.project({
    market: toMarketState(m),
    mark_price: toBigInt(price),
    vault: toVaultLiquidity(v),
    rate_config: toBorrowRateConfig(cfg),
    now,
    last_unpause_time: toBigInt(v.last_unpause_time ?? cfg.last_unpause_time),
  });
}
