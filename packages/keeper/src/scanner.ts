import { eq } from "drizzle-orm";
import {
  positions,
  markets,
  vaultState,
  protocolConfig,
  latestOraclePrices,
  indexerCursor,
  type Db,
} from "@stellars/db";

export type PositionRow = typeof positions.$inferSelect;
export type MarketRow = typeof markets.$inferSelect;
export type VaultStateRow = typeof vaultState.$inferSelect;
export type ProtocolConfigRow = typeof protocolConfig.$inferSelect;
export type IndexerCursorRow = typeof indexerCursor.$inferSelect;

export async function getAllPositions(db: Db): Promise<PositionRow[]> {
  return db.select().from(positions);
}

export async function getMarkets(db: Db): Promise<MarketRow[]> {
  return db.select().from(markets);
}

export async function getLatestPrices(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({
      symbol: latestOraclePrices.symbol,
      price: latestOraclePrices.price,
    })
    .from(latestOraclePrices);

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.symbol, row.price);
  }
  return map;
}

export async function getVaultState(db: Db): Promise<VaultStateRow | undefined> {
  const rows = await db
    .select()
    .from(vaultState)
    .where(eq(vaultState.id, 1))
    .limit(1);
  return rows[0];
}

export async function getProtocolConfig(db: Db): Promise<ProtocolConfigRow | undefined> {
  const rows = await db
    .select()
    .from(protocolConfig)
    .where(eq(protocolConfig.id, 1))
    .limit(1);
  return rows[0];
}

export async function getIndexerCursor(db: Db): Promise<IndexerCursorRow | undefined> {
  const rows = await db
    .select()
    .from(indexerCursor)
    .where(eq(indexerCursor.id, 1))
    .limit(1);
  return rows[0];
}
