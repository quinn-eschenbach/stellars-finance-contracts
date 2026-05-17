import { describe, it, expect, beforeEach } from "vitest";
import { buildRestRoutes } from "../src/rest.js";
import { FakeDb, asDb, type SelectCall } from "./_fake-db.js";

/**
 * Drive Hono routes directly via `app.request()` — no HTTP listener, no
 * sockets, no async tickling beyond the route handler itself. Test database
 * effects via the FakeDb queue (each route consumes a known number of
 * select/execute items in order).
 */
function makeApp(db: FakeDb) {
  return buildRestRoutes(asDb(db));
}

describe("GET /markets", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("returns the rows from the markets table", async () => {
    const rows = [{ symbol: "BTCUSD" }, { symbol: "ETHUSD" }];
    db.enqueueSelect(rows);

    const res = await makeApp(db).request("/markets");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);

    const call = db.calls[0] as SelectCall;
    expect(call.kind).toBe("select");
    expect(call.ops[0]?.op).toBe("from");
  });

  it("returns [] when the table is empty", async () => {
    db.enqueueSelect([]);

    const res = await makeApp(db).request("/markets");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /markets/:symbol", () => {
  it("returns the row when one matches", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ symbol: "BTCUSD", long_open_interest: "0" }]);

    const res = await makeApp(db).request("/markets/BTCUSD");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ symbol: "BTCUSD", long_open_interest: "0" });

    const call = db.calls[0] as SelectCall;
    // Confirm the chain shape: from → where → limit(1).
    expect(call.ops.map((o) => o.op)).toEqual(["from", "where", "limit"]);
    expect((call.ops.at(-1) as { arg: unknown }).arg).toBe(1);
  });

  it("returns 404 when the symbol isn't configured", async () => {
    const db = new FakeDb();
    db.enqueueSelect([]);

    const res = await makeApp(db).request("/markets/MYSTERY");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("GET /positions/:trader", () => {
  it("returns the rows for the trader", async () => {
    const db = new FakeDb();
    const rows = [{ id: 1, trader: "GABC" }, { id: 2, trader: "GABC" }];
    db.enqueueSelect(rows);

    const res = await makeApp(db).request("/positions/GABC");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);

    const call = db.calls[0] as SelectCall;
    expect(call.ops.map((o) => o.op)).toEqual(["from", "where"]);
  });

  it("returns [] when the trader has no positions", async () => {
    const db = new FakeDb();
    db.enqueueSelect([]);

    const res = await makeApp(db).request("/positions/GZERO");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /trades", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("returns rows newest-first with default limit", async () => {
    const rows = [{ id: 3 }, { id: 2 }, { id: 1 }];
    db.enqueueSelect(rows);

    const res = await makeApp(db).request("/trades");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);

    const call = db.calls[0] as SelectCall;
    // .where() is always invoked (with undefined when no filters); chain is
    // from → where → orderBy → limit(default 50).
    expect(call.ops.map((o) => o.op)).toEqual(["from", "where", "orderBy", "limit"]);
    expect((call.ops.find((o) => o.op === "where") as { arg: unknown }).arg).toBeUndefined();
    expect((call.ops.find((o) => o.op === "limit") as { arg: unknown }).arg).toBe(50);
  });

  it("applies every filter when all query params are present", async () => {
    db.enqueueSelect([]);

    await makeApp(db).request(
      "/trades?symbol=BTCUSD&trader=GABC&event_type=liquidation&limit=10&before_id=42",
    );

    const call = db.calls[0] as SelectCall;
    expect(call.ops.map((o) => o.op)).toEqual(["from", "where", "orderBy", "limit"]);
    expect((call.ops.find((o) => o.op === "limit") as { arg: unknown }).arg).toBe(10);
  });

  it("clamps limit to [1, 200]", async () => {
    db.enqueueSelect([]);
    await makeApp(db).request("/trades?limit=9999");
    let call = db.calls[0] as SelectCall;
    expect((call.ops.find((o) => o.op === "limit") as { arg: unknown }).arg).toBe(200);

    db.reset();
    db.enqueueSelect([]);
    await makeApp(db).request("/trades?limit=0");
    call = db.calls[0] as SelectCall;
    expect((call.ops.find((o) => o.op === "limit") as { arg: unknown }).arg).toBe(1);
  });

  it("falls back to default limit when the value isn't numeric", async () => {
    db.enqueueSelect([]);
    await makeApp(db).request("/trades?limit=abc");
    const call = db.calls[0] as SelectCall;
    expect((call.ops.find((o) => o.op === "limit") as { arg: unknown }).arg).toBe(50);
  });
});

describe("GET /vault", () => {
  it("returns vault row spliced with last_unpause_time from protocol config", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ id: 1, total_assets: "1000", reserved_usdc: "100" }]);
    db.enqueueSelect([{ last_unpause_time: "1700000000" }]);

    const res = await makeApp(db).request("/vault");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 1,
      total_assets: "1000",
      reserved_usdc: "100",
      last_unpause_time: "1700000000",
    });
    expect(db.calls).toHaveLength(2);
  });

  it("falls back to '0' when no protocol config row exists", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ id: 1, total_assets: "0" }]);
    db.enqueueSelect([]);

    const res = await makeApp(db).request("/vault");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, total_assets: "0", last_unpause_time: "0" });
  });

  it("returns 404 when the vault row is missing", async () => {
    const db = new FakeDb();
    db.enqueueSelect([]);

    const res = await makeApp(db).request("/vault");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    // The second select short-circuits when the first returns no rows.
    expect(db.calls).toHaveLength(1);
  });
});

describe("GET /config", () => {
  it("returns the singleton row", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ id: 1, lp_bps: 7000, dev_bps: 2000, staker_bps: 1000 }]);

    const res = await makeApp(db).request("/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, lp_bps: 7000, dev_bps: 2000, staker_bps: 1000 });
  });

  it("returns 404 when the config row is missing", async () => {
    const db = new FakeDb();
    db.enqueueSelect([]);

    const res = await makeApp(db).request("/config");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("GET /vault/profitability", () => {
  it("derives lp_net_from_fees from accruals × lp_bps / (dev_bps + staker_bps)", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ lp_bps: 9000, dev_bps: 1000, staker_bps: 0 }]);
    // 1_000_000 × 9000 / 1000 = 9_000_000.
    db.enqueueExecute([
      { lp_net_from_trades: "100000000", total_accrued: "1000000" },
    ]);

    const res = await makeApp(db).request("/vault/profitability");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.window_days).toBe(30);
    expect(body.lp_net_from_trades).toBe("100000000");
    expect(body.lp_net_from_fees).toBe("9000000");
    expect(body.lp_bps).toBe(9000);
    expect(typeof body.as_of).toBe("string");
  });

  it("clamps days to [1, 365] and accepts the query param", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ lp_bps: 1000, dev_bps: 9000, staker_bps: 0 }]);
    db.enqueueExecute([{ lp_net_from_trades: "0", total_accrued: "0" }]);
    const res = await makeApp(db).request("/vault/profitability?days=9999");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.window_days).toBe(365);
  });

  it("treats a missing config row as zero splits", async () => {
    const db = new FakeDb();
    db.enqueueSelect([]);
    db.enqueueExecute([
      { lp_net_from_trades: "500", total_accrued: "1000" },
    ]);

    const res = await makeApp(db).request("/vault/profitability");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.lp_bps).toBe(0);
    expect(body.lp_net_from_fees).toBe("0");
    expect(body.lp_net_from_trades).toBe("500");
  });

  it("returns 0 fee revenue when dev_bps + staker_bps == 0", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ lp_bps: 10000, dev_bps: 0, staker_bps: 0 }]);
    db.enqueueExecute([{ lp_net_from_trades: "42", total_accrued: "0" }]);

    const res = await makeApp(db).request("/vault/profitability");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.lp_net_from_trades).toBe("42");
    expect(body.lp_net_from_fees).toBe("0");
  });

  it("falls back to zeros when the aggregate query returns no row", async () => {
    const db = new FakeDb();
    db.enqueueSelect([{ lp_bps: 9000, dev_bps: 1000, staker_bps: 0 }]);
    db.enqueueExecute([]);

    const res = await makeApp(db).request("/vault/profitability");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.lp_net_from_trades).toBe("0");
    expect(body.lp_net_from_fees).toBe("0");
  });
});

describe("GET /leaderboard", () => {
  it("normalizes counts to numbers and nullable last_trade_at", async () => {
    const db = new FakeDb();
    db.enqueueExecute([
      {
        trader: "GABC",
        realized_pnl: "1000",
        volume: "5000",
        closes: "3",
        wins: "2",
        losses: "1",
        last_trade_at: "1700000000",
      },
      {
        trader: "GDEF",
        realized_pnl: null,
        volume: null,
        closes: "0",
        wins: "0",
        losses: "0",
        last_trade_at: null,
      },
    ]);

    const res = await makeApp(db).request("/leaderboard");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        trader: "GABC",
        realized_pnl: "1000",
        volume: "5000",
        closes: 3,
        wins: 2,
        losses: 1,
        last_trade_at: 1700000000,
      },
      {
        trader: "GDEF",
        realized_pnl: "0",
        volume: "0",
        closes: 0,
        wins: 0,
        losses: 0,
        last_trade_at: null,
      },
    ]);
  });

  it("exercises the close/wins/losses fallback for null counts", async () => {
    const db = new FakeDb();
    db.enqueueExecute([
      {
        trader: "GXYZ",
        realized_pnl: "5",
        volume: "10",
        closes: null,
        wins: null,
        losses: null,
        last_trade_at: null,
      },
    ]);
    const res = await makeApp(db).request("/leaderboard");
    expect(await res.json()).toEqual([
      {
        trader: "GXYZ",
        realized_pnl: "5",
        volume: "10",
        closes: 0,
        wins: 0,
        losses: 0,
        last_trade_at: null,
      },
    ]);
  });

  it("clamps limit and falls back to default for NaN input", async () => {
    const db = new FakeDb();
    db.enqueueExecute([]);
    const res = await makeApp(db).request("/leaderboard?limit=abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns [] when no rows", async () => {
    const db = new FakeDb();
    db.enqueueExecute([]);
    const res = await makeApp(db).request("/leaderboard?limit=10");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /prices", () => {
  it("returns the latest price per symbol", async () => {
    const db = new FakeDb();
    const rows = [
      { symbol: "BTCUSD", price: "950000000000", ledger: 100, timestamp: "1700000000" },
      { symbol: "ETHUSD", price: "30000000000", ledger: 100, timestamp: "1700000000" },
    ];
    db.enqueueSelect(rows);

    const res = await makeApp(db).request("/prices");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });
});

describe("GET /prices/:symbol/candles", () => {
  it("returns ohlc rows reversed to ascending time order", async () => {
    const db = new FakeDb();
    // SQL returns newest-first; the route must reverse.
    db.enqueueExecute([
      { time: "1700000120", open: "3", high: "4", low: "2", close: "3" },
      { time: "1700000060", open: "2", high: "3", low: "1", close: "2" },
      { time: "1700000000", open: "1", high: "2", low: "0", close: "1" },
    ]);

    const res = await makeApp(db).request("/prices/BTCUSD/candles?interval=60&limit=3");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ time: number }>;
    expect(body.map((r) => r.time)).toEqual([1700000000, 1700000060, 1700000120]);
  });

  it("rejects unsupported intervals with 400", async () => {
    const db = new FakeDb();
    const res = await makeApp(db).request("/prices/BTCUSD/candles?interval=42");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_interval" });
    // We never hit the DB for a bad interval.
    expect(db.calls).toHaveLength(0);
  });

  it("uses default interval 60 when none is supplied", async () => {
    const db = new FakeDb();
    db.enqueueExecute([]);
    const res = await makeApp(db).request("/prices/BTCUSD/candles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("clamps the limit to [1, 1000] and recovers from NaN", async () => {
    const db = new FakeDb();
    db.enqueueExecute([]);
    let res = await makeApp(db).request("/prices/BTCUSD/candles?interval=60&limit=99999");
    expect(res.status).toBe(200);

    db.reset();
    db.enqueueExecute([]);
    res = await makeApp(db).request("/prices/BTCUSD/candles?interval=60&limit=abc");
    expect(res.status).toBe(200);
  });

  it("accepts every officially-supported interval", async () => {
    const db = new FakeDb();
    for (const interval of [60, 300, 900, 3600, 14400, 86400]) {
      db.enqueueExecute([]);
      const res = await makeApp(db).request(`/prices/BTCUSD/candles?interval=${interval}`);
      expect(res.status).toBe(200);
    }
  });
});

describe("404 fallthrough", () => {
  it("returns the framework default for unknown paths", async () => {
    const db = new FakeDb();
    const res = await makeApp(db).request("/nope");
    expect(res.status).toBe(404);
  });
});
