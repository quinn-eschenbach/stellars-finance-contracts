// Decision-math unit tests for scanner.ts. Builds KeeperWorld snapshots
// directly (no DB) so the tests cover the math the keeper actually fires on,
// without executor / dedup / serialize / SIGINT scaffolding.

import { describe, it, expect } from "bun:test";
import { MarketTick, PRECISION } from "@stellars/protocol-math";
import {
  findAdlTarget,
  scanLiquidationCandidates,
  type KeeperWorld,
} from "../src/scanner.js";
import type { KeeperConfig } from "../src/config.js";

const ENTRY = 100n * PRECISION;
const MARK_FLAT = ENTRY;

const config: KeeperConfig = {
  databaseUrl: "",
  network: "local",
  rpcUrl: "",
  networkPassphrase: "",
  keeperSecret: "",
  pollIntervalMs: 1000,
  liquidationIdleMs: 100,
  indexUpdateThresholdSec: 60,
  liquidationSafetyMarginBps: 200,
  staleAlertSec: 30,
  staleHardSkipSec: 300,
  contracts: { positionManager: { address: "", startLedger: 0 } },
};

// Tests only read fields the decision math touches; the rest of PositionRow
// is structurally unused, so we narrow through `unknown` rather than build a
// full drizzle row.
type Position = {
  id: number;
  trader: string;
  symbol: string;
  is_long: boolean;
  size: string;
  collateral: string;
  entry_price: string;
  entry_borrow_index: string;
  entry_funding_index: string;
  take_profit: string;
  stop_loss: string;
  last_increased_time: string;
};

function pos(p: Partial<Position> & { trader: string; symbol: string }): Position {
  return {
    id: 0,
    is_long: true,
    size: (1_000n * PRECISION).toString(),
    collateral: (100n * PRECISION).toString(),
    entry_price: ENTRY.toString(),
    entry_borrow_index: "0",
    entry_funding_index: "0",
    take_profit: "0",
    stop_loss: "0",
    last_increased_time: "0",
    ...p,
  };
}

function flatTick(mark = MARK_FLAT): MarketTick {
  return new MarketTick(
    {
      acc_borrow_index: 0n,
      acc_funding_index: 0n,
      last_index_update: 0n,
      long_open_interest: 1_000_000n * PRECISION,
      short_open_interest: 1_000_000n * PRECISION,
    },
    mark,
  );
}

function world(opts: {
  positions: Position[];
  ticks?: Map<string, MarketTick>;
  liquidationThresholdBps?: number;
  fundingCutBps?: number;
}): KeeperWorld {
  const ticks =
    opts.ticks ??
    new Map<string, MarketTick>([["BTCUSD", flatTick()]]);
  return {
    now: 1_000n,
    positions: opts.positions as unknown as KeeperWorld["positions"],
    markets: [],
    ticks,
    vault: undefined,
    protocolConfig: {
      liquidation_threshold_bps: opts.liquidationThresholdBps ?? 200,
      funding_cut_bps: opts.fundingCutBps ?? 0,
    } as unknown as KeeperWorld["protocolConfig"],
    cursor: undefined,
    indexerLagSec: 0,
  };
}

describe("scanLiquidationCandidates", () => {
  it("excludes positions whose tick is missing", () => {
    const orphan = pos({ trader: "A", symbol: "ETHUSD" }); // no ETHUSD tick
    const w = world({ positions: [orphan] });
    expect(scanLiquidationCandidates(w, config)).toEqual([]);
  });

  it("includes a position whose effective_health is below threshold", () => {
    // 10× long entering at 100, mark at 80 → pnl = 1000 × (80 − 100)/100 = −200
    // effective_health = 100 + (−200) = −100 < threshold (200 bps × 100 = 2)
    const losing = pos({
      trader: "A",
      symbol: "BTCUSD",
      collateral: (100n * PRECISION).toString(),
      size: (1_000n * PRECISION).toString(),
    });
    const ticks = new Map<string, MarketTick>([["BTCUSD", flatTick(80n * PRECISION)]]);
    const w = world({ positions: [losing], ticks });
    const out = scanLiquidationCandidates(w, config);
    expect(out.length).toBe(1);
    expect(out[0].pos.trader).toBe("A");
    expect(out[0].health < 0n).toBe(true);
  });

  it("excludes healthy positions", () => {
    // Flat mark, no PnL → effective_health = collateral, well above threshold.
    const healthy = pos({ trader: "A", symbol: "BTCUSD" });
    const w = world({ positions: [healthy] });
    expect(scanLiquidationCandidates(w, config)).toEqual([]);
  });

  it("ranks worst-health-first", () => {
    const a = pos({
      trader: "A",
      symbol: "BTCUSD",
      collateral: (100n * PRECISION).toString(),
      size: (1_000n * PRECISION).toString(),
    });
    const b = pos({
      trader: "B",
      symbol: "BTCUSD",
      collateral: (100n * PRECISION).toString(),
      size: (2_000n * PRECISION).toString(), // higher leverage → worse health at same mark
    });
    const ticks = new Map<string, MarketTick>([["BTCUSD", flatTick(80n * PRECISION)]]);
    const w = world({ positions: [a, b], ticks });
    const out = scanLiquidationCandidates(w, config);
    expect(out.map((c) => c.pos.trader)).toEqual(["B", "A"]);
  });

  it("falls back to config.liquidationSafetyMarginBps when protocolConfig is missing", () => {
    const losing = pos({
      trader: "A",
      symbol: "BTCUSD",
      collateral: (100n * PRECISION).toString(),
      size: (1_000n * PRECISION).toString(),
    });
    const ticks = new Map<string, MarketTick>([["BTCUSD", flatTick(80n * PRECISION)]]);
    const w: KeeperWorld = {
      now: 1_000n,
      positions: [losing] as unknown as KeeperWorld["positions"],
      markets: [],
      ticks,
      vault: undefined,
      protocolConfig: undefined,
      cursor: undefined,
      indexerLagSec: 0,
    };
    const out = scanLiquidationCandidates(w, config);
    expect(out.length).toBe(1);
  });
});

describe("findAdlTarget", () => {
  it("returns null when no positions are profitable", () => {
    const flat = pos({ trader: "A", symbol: "BTCUSD" });
    const w = world({ positions: [flat] });
    expect(findAdlTarget(w)).toBeNull();
  });

  it("returns null when collateral is zero on every profitable position", () => {
    const zeroColl = pos({
      trader: "A",
      symbol: "BTCUSD",
      collateral: "0",
      size: (1_000n * PRECISION).toString(),
    });
    const ticks = new Map<string, MarketTick>([["BTCUSD", flatTick(120n * PRECISION)]]);
    const w = world({ positions: [zeroColl], ticks });
    expect(findAdlTarget(w)).toBeNull();
  });

  it("picks the highest pnl × size / collateral score among winners", () => {
    // Both at mark = 120 (entry 100) → pnl_per_size = 0.2.
    // A: size 1000, collateral 100 → score = 200 × 1000 / 100 = 2_000
    // B: size 1000, collateral 50  → score = 200 × 1000 / 50  = 4_000  (winner)
    // C: size  500, collateral 50  → score = 100 ×  500 / 50  = 1_000
    const a = pos({ trader: "A", symbol: "BTCUSD", collateral: (100n * PRECISION).toString() });
    const b = pos({ trader: "B", symbol: "BTCUSD", collateral: (50n * PRECISION).toString() });
    const c = pos({
      trader: "C",
      symbol: "BTCUSD",
      collateral: (50n * PRECISION).toString(),
      size: (500n * PRECISION).toString(),
    });
    const ticks = new Map<string, MarketTick>([["BTCUSD", flatTick(120n * PRECISION)]]);
    const w = world({ positions: [a, b, c], ticks });
    const out = findAdlTarget(w);
    expect(out?.trader).toBe("B");
  });

  it("ignores positions without a tick", () => {
    const orphan = pos({ trader: "A", symbol: "ETHUSD" });
    const w = world({ positions: [orphan] });
    expect(findAdlTarget(w)).toBeNull();
  });
});
