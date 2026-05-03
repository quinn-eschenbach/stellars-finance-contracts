import { rpc } from "@stellar/stellar-sdk";
import { type Db, oraclePrices } from "@stellars/db";
import { Client as OracleRouterClient } from "@stellars/bindings/oracle-router";
import type { IndexerConfig } from "./config.js";

/**
 * Tickers polled from the OracleRouter. Hardcoded here rather than read
 * from env / addresses so the indexer's polling surface is explicit and
 * traceable. Add tickers here in lockstep with the corresponding entries
 * in packages/oracle-binance, packages/oracle-kucoin, and the deploy script.
 */
const TICKERS = ["BTCUSD", "ETHUSD"];

const POLL_MS = 2_000;

/**
 * Periodically simulate `oracle_router.get_price(symbol)` for each known
 * ticker and write the returned median to `oracle_prices`. This is a pure
 * RPC simulation — no signing, no transaction, no gas cost — so we can
 * run it as fast as we want and the result reflects whatever the router
 * would return to a live caller right now.
 *
 * Dedupe: only insert when the median actually changes vs the last value
 * we wrote, so the SSE stream fires only on genuine moves rather than
 * once per poll tick.
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
  const client = new OracleRouterClient({
    contractId: config.contracts.oracleRouter.address,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: sourceAccount,
    allowHttp: config.rpcUrl.startsWith("http://"),
  });

  const lastPrice = new Map<string, bigint>();

  console.log(`[poller] tickers=${TICKERS.join(",")} cadence=${POLL_MS}ms`);

  while (isRunning()) {
    const ledger = await safeLatestLedger(server);
    for (const symbol of TICKERS) {
      if (!isRunning()) break;
      try {
        const tx = await client.get_price({ symbol });
        const price = tx.result as bigint;

        if (lastPrice.get(symbol) === price) continue;
        lastPrice.set(symbol, price);

        await db.insert(oraclePrices).values({
          ledger,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          symbol,
          price: price.toString(),
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
