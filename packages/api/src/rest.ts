import { Hono } from "hono";
import { eq, desc, and, lt, sql } from "drizzle-orm";
import {
  type QueryRunner,
  markets,
  positions,
  protocolConfig,
  trades,
  vaultState,
  latestOraclePrices,
} from "@stellars/db";

// The routes use a narrow `QueryRunner` slice of drizzle's `Db` — `select`
// + `execute`. That keeps the routes' actual drizzle dependency visible at
// the seam, and lets tests pass an in-memory fake without lying through `any`.
export function buildRestRoutes(db: QueryRunner): Hono {
  const r = new Hono();

  r.get("/markets", async (c) => {
    const rows = await db.select().from(markets);
    return c.json(rows);
  });

  r.get("/markets/:symbol", async (c) => {
    const symbol = c.req.param("symbol");
    const rows = await db.select().from(markets).where(eq(markets.symbol, symbol)).limit(1);
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json(rows[0]);
  });

  r.get("/positions/:trader", async (c) => {
    const trader = c.req.param("trader");
    const rows = await db.select().from(positions).where(eq(positions.trader, trader));
    return c.json(rows);
  });

  /**
   * GET /trades?symbol=&trader=&event_type=&limit=&before_id=
   *   - limit: 1..200, default 50
   *   - before_id: paginate older results (id-based, descending)
   */
  r.get("/trades", async (c) => {
    const symbol = c.req.query("symbol");
    const trader = c.req.query("trader");
    const eventType = c.req.query("event_type");
    const beforeId = c.req.query("before_id");
    const limitRaw = Number(c.req.query("limit") ?? 50);
    const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 50 : limitRaw), 200);

    const conds = [];
    if (symbol) conds.push(eq(trades.symbol, symbol));
    if (trader) conds.push(eq(trades.trader, trader));
    if (eventType) conds.push(eq(trades.event_type, eventType));
    if (beforeId) conds.push(lt(trades.id, Number(beforeId)));

    const rows = await db
      .select()
      .from(trades)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(trades.id))
      .limit(limit);
    return c.json(rows);
  });

  r.get("/vault", async (c) => {
    const rows = await db.select().from(vaultState).where(eq(vaultState.id, 1)).limit(1);
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    // Splice in last_unpause_time so the off-chain MarketTick projection has
    // everything it needs from a single endpoint without a second round-trip.
    const cfg = await db
      .select({ last_unpause_time: protocolConfig.last_unpause_time })
      .from(protocolConfig)
      .where(eq(protocolConfig.id, 1))
      .limit(1);
    return c.json({ ...rows[0], last_unpause_time: cfg[0]?.last_unpause_time ?? "0" });
  });

  /**
   * GET /config — protocol-wide config singleton (fee splits, limits, borrow
   * rate config, last unpause time). Used by the off-chain MarketTick
   * projection to derive borrow/funding indices forward to `now`.
   */
  r.get("/config", async (c) => {
    const rows = await db
      .select()
      .from(protocolConfig)
      .where(eq(protocolConfig.id, 1))
      .limit(1);
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json(rows[0]);
  });

  /**
   * GET /leaderboard?limit=50
   *
   * Per-trader realized PnL, computed by summing the `pnl` column across all
   * trade events (increases default to 0, so they're harmless to include).
   * Wins/losses count only closing events. Sorted by realized PnL desc.
   */
  r.get("/leaderboard", async (c) => {
    const limitRaw = Number(c.req.query("limit") ?? 50);
    const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 50 : limitRaw), 200);

    const rows = await db.execute(sql`
      SELECT
        trader,
        SUM(pnl)::text AS realized_pnl,
        SUM(ABS(size_delta::numeric))::text AS volume,
        COUNT(*) FILTER (WHERE event_type <> 'increase') AS closes,
        COUNT(*) FILTER (WHERE event_type <> 'increase' AND pnl > 0) AS wins,
        COUNT(*) FILTER (WHERE event_type <> 'increase' AND pnl < 0) AS losses,
        MAX(timestamp::bigint) AS last_trade_at
      FROM trades
      GROUP BY trader
      ORDER BY SUM(pnl) DESC NULLS LAST
      LIMIT ${limit}
    `);

    type Row = {
      trader: string;
      realized_pnl: string;
      volume: string;
      closes: number | string;
      wins: number | string;
      losses: number | string;
      last_trade_at: number | string | null;
    };

    const data = (rows.rows as Row[]).map((r) => ({
      trader: r.trader,
      realized_pnl: r.realized_pnl ?? "0",
      volume: r.volume ?? "0",
      closes: Number(r.closes ?? 0),
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      last_trade_at: r.last_trade_at == null ? null : Number(r.last_trade_at),
    }));
    return c.json(data);
  });

  /**
   * GET /prices — current oracle price per symbol (latest insert wins).
   * Reads from the `latest_oracle_prices` view so the "latest per symbol"
   * rule lives at the database, not in app code.
   */
  r.get("/prices", async (c) => {
    const rows = await db
      .select({
        symbol: latestOraclePrices.symbol,
        price: latestOraclePrices.price,
        ledger: latestOraclePrices.ledger,
        timestamp: latestOraclePrices.timestamp,
      })
      .from(latestOraclePrices);
    return c.json(rows);
  });

  /**
   * GET /prices/:symbol/candles?interval=60&limit=500
   *
   * Synthesize OHLC candles from oracle ticks by integer-bucketing the unix
   * timestamp. Returned newest-first from SQL but reversed so the chart gets
   * ascending time. Prices stay as protocol-scaled strings (× 10^7); the
   * frontend converts to numbers for lightweight-charts.
   */
  r.get("/prices/:symbol/candles", async (c) => {
    const symbol = c.req.param("symbol");
    const intervalRaw = Number(c.req.query("interval") ?? 60);
    const limitRaw = Number(c.req.query("limit") ?? 500);
    const allowed = new Set([60, 300, 900, 3600, 14400, 86400]);
    if (!allowed.has(intervalRaw)) return c.json({ error: "bad_interval" }, 400);
    const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 500 : limitRaw), 1000);

    const rows = await db.execute(sql`
      SELECT
        bucket::bigint AS time,
        (array_agg(price::text ORDER BY id ASC))[1] AS open,
        MAX(price)::text AS high,
        MIN(price)::text AS low,
        (array_agg(price::text ORDER BY id DESC))[1] AS close
      FROM (
        SELECT
          (timestamp::bigint / ${intervalRaw}) * ${intervalRaw} AS bucket,
          price,
          id
        FROM oracle_prices
        WHERE symbol = ${symbol}
      ) sub
      GROUP BY bucket
      ORDER BY bucket DESC
      LIMIT ${limit}
    `);

    type CandleRow = { time: string | number; open: string; high: string; low: string; close: string };
    const candles = (rows.rows as CandleRow[])
      .map((r) => ({
        time: Number(r.time),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
      }))
      .reverse();
    return c.json(candles);
  });

  return r;
}
