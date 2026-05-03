import "dotenv/config";
import { rpc } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { getDb, indexerCursor } from "@stellars/db";
import { Client as VaultClient } from "@stellars/bindings/vault";
import { Client as PMClient } from "@stellars/bindings/position-manager";
import { Client as CMClient } from "@stellars/bindings/config-manager";
import { Client as ORClient } from "@stellars/bindings/oracle-router";
import { loadConfig } from "./config.js";
import { fetchEvents } from "./rpc.js";
import { buildContractSpecMaps, parseEvent } from "./spec-parser.js";
import { buildRoutes } from "./handlers/index.js";
import { startHealthServer, updateHealth } from "./health.js";
import { runOraclePoller } from "./oracle-poller.js";

/**
 * Construct a binding Client to access its embedded contract spec.
 * No network calls — the constructor only stores the spec and options.
 */
function makeClient<T extends { spec: import("@stellar/stellar-sdk/contract").Spec }>(
  ClientClass: new (options: { contractId: string; networkPassphrase: string; rpcUrl: string; allowHttp?: boolean }) => T,
  contractId: string,
  networkPassphrase: string,
  rpcUrl: string,
): T {
  return new ClientClass({
    contractId,
    networkPassphrase,
    rpcUrl,
    allowHttp: rpcUrl.startsWith("http://"),
  });
}

async function main() {
  const config = loadConfig();
  const db = getDb();
  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
  const routes = buildRoutes(config.contracts);

  const deployedContracts = Object.values(config.contracts).filter((c) => c.address);
  const contractIds = deployedContracts.map((c) => c.address);

  if (contractIds.length === 0) {
    console.error(
      `No contract addresses configured for network "${config.network}". Run 'make deploy' to populate packages/config/addresses.json.`,
    );
    process.exit(1);
  }

  // Build spec maps from binding clients for spec-driven event parsing
  const { networkPassphrase, rpcUrl } = config;
  const specMaps = buildContractSpecMaps([
    { contractId: config.contracts.vault.address, spec: makeClient(VaultClient, config.contracts.vault.address, networkPassphrase, rpcUrl).spec },
    { contractId: config.contracts.positionManager.address, spec: makeClient(PMClient, config.contracts.positionManager.address, networkPassphrase, rpcUrl).spec },
    { contractId: config.contracts.configManager.address, spec: makeClient(CMClient, config.contracts.configManager.address, networkPassphrase, rpcUrl).spec },
    { contractId: config.contracts.oracleRouter.address, spec: makeClient(ORClient, config.contracts.oracleRouter.address, networkPassphrase, rpcUrl).spec },
  ]);

  startHealthServer(config.healthPort);

  // Initial start ledger = earliest deployed contract (so we don't miss the first events).
  // Overridden by DB cursor if present.
  let cursor: string | undefined;
  let startLedger = Math.min(...deployedContracts.map((c) => c.startLedger).filter((l) => l > 0));
  if (!Number.isFinite(startLedger)) startLedger = 0;

  const cursorRows = await db.select().from(indexerCursor).where(eq(indexerCursor.id, 1)).limit(1);
  if (cursorRows.length > 0 && cursorRows[0].last_cursor) {
    cursor = cursorRows[0].last_cursor;
    startLedger = cursorRows[0].last_ledger;
    console.log(`Resuming from cursor=${cursor} ledger=${startLedger}`);
  } else {
    console.log(`Starting from ledger=${startLedger}`);
  }

  // Graceful shutdown
  let running = true;
  const shutdown = () => {
    console.log("Shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Event ingestion loop and oracle-router poller run in parallel.
  // The poller is independent of event polling — it issues read-only
  // simulations against the router so the DB always has fresh median
  // prices regardless of whether anything on-chain triggered a get_price.
  const isRunning = () => running;

  const eventLoop = async () => {
    while (running) {
      try {
        const { events, latestLedger, nextCursor } = await fetchEvents(server, startLedger, contractIds, cursor);

        for (const rawEvent of events) {
          const handler = routes[rawEvent.contractId];
          if (!handler) {
            console.warn(`[indexer] no route for contract ${rawEvent.contractId} — event id=${rawEvent.id} ledger=${rawEvent.ledger}`);
            continue;
          }

          const parsed = parseEvent(rawEvent, specMaps);
          if (!parsed) {
            console.warn(`[indexer] parseEvent returned null — contract=${rawEvent.contractId} ledger=${rawEvent.ledger} id=${rawEvent.id} (unknown topic0 in spec map?)`);
            continue;
          }
          try {
            await handler(db, parsed);
          } catch (err) {
            console.error(`Handler error for ${parsed.topic0} in ${rawEvent.contractId}:`, err);
          }
        }

        // Always advance cursor — even on empty pages — so we don't re-scan
        // ledgers we've already inspected. The RPC returns a cursor pointing at
        // the next ledger past the scanned window regardless of event count.
        if (nextCursor && nextCursor !== cursor) {
          cursor = nextCursor;
          startLedger = latestLedger;

          // Most-recent observed close time: prefer the last event's
          // ledgerClosedAt; fall back to wall time when the page is empty
          // (we just polled successfully, so the chain is at latestLedger
          // as of approximately now).
          const lastEvent = events[events.length - 1];
          const lastLedgerCloseTime = lastEvent
            ? Math.floor(new Date(lastEvent.ledgerClosedAt).getTime() / 1000)
            : Math.floor(Date.now() / 1000);

          await db
            .insert(indexerCursor)
            .values({
              id: 1,
              last_ledger: startLedger,
              last_cursor: cursor,
              last_ledger_close_time: lastLedgerCloseTime.toString(),
            })
            .onConflictDoUpdate({
              target: indexerCursor.id,
              set: {
                last_ledger: startLedger,
                last_cursor: cursor,
                last_ledger_close_time: lastLedgerCloseTime.toString(),
                updated_at: new Date(),
              },
            });
        }

        updateHealth(latestLedger);

        if (events.length === 0) {
          await sleep(config.pollIntervalMs);
        }
      } catch (err) {
        console.error("Poll error:", err);
        await sleep(config.pollIntervalMs);
      }
    }
  };

  await Promise.all([eventLoop(), runOraclePoller(db, server, config, isRunning)]);

  console.log("Indexer stopped.");
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
