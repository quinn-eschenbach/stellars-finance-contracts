import { Hono } from "hono";
import { eq, desc, and, lt, sql } from "drizzle-orm";
import {
  type Db,
  markets,
  positions,
  trades,
  vaultState,
  oraclePrices,
} from "@stellars/db";

export function buildRestRoutes(db: Db): Hono {
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
    return c.json(rows[0]);
  });

  /**
   * GET /prices — current oracle price per symbol (latest insert wins).
   * Cheap query against the existing oracle_prices table; no separate
   * "current price" table needed.
   */
  r.get("/prices", async (c) => {
    const rows = await db
      .select({
        symbol: oraclePrices.symbol,
        price: oraclePrices.price,
        ledger: oraclePrices.ledger,
        timestamp: oraclePrices.timestamp,
      })
      .from(oraclePrices)
      .where(
        sql`${oraclePrices.id} IN (SELECT MAX(id) FROM oracle_prices GROUP BY symbol)`,
      );
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
