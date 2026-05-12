import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export type Db = ReturnType<typeof getDb>;

/**
 * The minimal slice of `Db` that route builders (api/rest, api/sse) actually
 * consume: a chainable `select(...)` and `execute(sql)`. Routes accept this
 * narrower type instead of `Db` so the dependency the routes have on drizzle
 * is visible at a glance and so test fakes can implement only what's used.
 *
 * Derived via `Pick` so drizzle stays the source of truth — drift between the
 * narrowing and drizzle's actual surface is structurally impossible.
 */
export type QueryRunner = Pick<Db, "select" | "execute">;
