import { rpc } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { type Db, oraclePrices, latestOraclePrices } from "@stellars/db";
import { Client as OracleRouterClient } from "@stellars/bindings/oracle-router";
import { client, readOnlySigner } from "@stellars/protocol-clients";
import type { IndexerConfig } from "./config.js";

/**
 * Tickers polled from the OracleRouter. Hardcoded here rather than read
 * from env / addresses so the indexer's polling surface is explicit and
 * traceable. Add tickers here in lockstep with the corresponding entries
 * in packages/oracle-binance, packages/oracle-kucoin, and the deploy script.
 */
const TICKERS = ["BTCUSD", "ETHUSD"];

const POLL_MS = 500;

/**
 * Periodically simulate `oracle_router.get_price(symbol)` for each known
 * ticker and write the returned median to `oracle_prices`. This is a pure
 * RPC simulation — no signing, no transaction, no gas cost — so we can
 * run it as fast as we want and the result reflects whatever the router
 * would return to a live caller right now.
 *
 * Dedupe: only insert when the simulated median differs from the most
 * recently persisted observation (queried via `latest_oracle_prices`).
 * Consulting the table — not an in-memory map — means we also dedup
 * against rows the event handler wrote, and stay correct across restarts.
 */
export async function runOraclePoller(
  db: Db,
  server: rpc.Server,
  config: IndexerConfig,
  isRunning: () => boolean,
): Promise<void> {
  // Soroban simulation needs an EXISTING source account on chain to fetch
  // the sequence number — random keypairs fail with "Account not found".
  // We re-use ADMIN_ADDRESS (written by scripts/deploy-local.sh into
  // .env.local) since the indexer never signs or submits, only simulates.
  const sourceAccount = process.env.ADMIN_ADDRESS ?? "";
  if (!sourceAccount) {
    throw new Error(
      "[poller] ADMIN_ADDRESS env var is required for read-only simulations — re-run 'make deploy' to populate .env.local",
    );
  }
  const oracleClient = client(
    OracleRouterClient,
    { rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase },
    config.contracts.oracleRouter.address,
    readOnlySigner(sourceAccount),
  );

  console.log(`[poller] tickers=${TICKERS.join(",")} cadence=${POLL_MS}ms`);

  while (isRunning()) {
    const ledger = await safeLatestLedger(server);
    for (const symbol of TICKERS) {
      if (!isRunning()) break;
      try {
        const tx = await oracleClient.get_price({ symbol });
        const price = tx.result;

        // The SDK's AssembledTransaction.result getter swallows contract
        // panics: parseError matches the error code against errorTypes and
        // returns `new Err({ message })` instead of throwing. Surface that
        // here so the underlying router error (StalePrice, PriceDeviationTooHigh,
        // etc.) shows up in logs rather than `[object Object]` from a numeric
        // insert downstream.
        if (typeof price !== "bigint") {
          const detail =
            (price as { error?: { message?: string } } | undefined)?.error?.message ??
            JSON.stringify(price);
          throw new Error(`router returned non-numeric: ${detail}`);
        }

        const priceStr = price.toString();
        const latest = await db
          .select({ price: latestOraclePrices.price })
          .from(latestOraclePrices)
          .where(eq(latestOraclePrices.symbol, symbol))
          .limit(1);
        if (latest[0]?.price === priceStr) continue;

        await db.insert(oraclePrices).values({
          ledger,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          symbol,
          price: priceStr,
        });
        console.log(`[poller] ${symbol} = ${price}`);
      } catch (err) {
        // Common during local startup: router has no sources yet, prices
        // stale, or deviation too high. Log once per failure mode and
        // keep polling — these typically self-resolve.
        console.warn(`[poller] ${symbol} failed: ${(err as Error)?.message ?? err}`);
      }
    }
    await sleep(POLL_MS);
  }

  console.log("[poller] stopped.");
}

async function safeLatestLedger(server: rpc.Server): Promise<number> {
  try {
    const r = await server.getLatestLedger();
    return r.sequence;
  } catch {
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
