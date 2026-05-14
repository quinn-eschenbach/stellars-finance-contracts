import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb, indexerCursor } from "@stellars/db";
import { Client as VaultClient } from "@stellars/bindings/vault";
import { Client as PMClient } from "@stellars/bindings/position-manager";
import { Client as CMClient } from "@stellars/bindings/config-manager";
import { Client as ORClient } from "@stellars/bindings/oracle-router";
import { client, rpcServer } from "@stellars/protocol-clients";
import { loadConfig } from "./config.js";
import { fetchEvents } from "./rpc.js";
import { buildContractSpecMaps, parseEvent } from "./spec-parser.js";
import { buildRoutes } from "./handlers/index.js";
import { startHealthServer, updateHealth } from "./health.js";
import { runOraclePoller } from "./oracle-poller.js";

/**
 * Local-dev guard: refuse to start if another indexer holds the advisory
 * lock for this DB. We only hold the lock for the lifetime of this process —
 * dropping the connection releases it. The lock key is an arbitrary 64-bit
 * constant; collisions across services are avoided by picking a unique value.
 */
const INDEXER_ADVISORY_LOCK_KEY = 0x53_74_6c_72_5f_49_64_78n; // "Stlr_Idx"

async function main() {
  const config = loadConfig();
  const db = getDb();
  // pg_try_advisory_lock guards against accidental double-start in local dev
  // (per-region DBs make true coordination moot in prod). The lock is held
  // by THIS pool connection — once the process exits the lock is released.
  // If we can't acquire it, another indexer is already running.
  const acquired = await db.execute(
    sql`SELECT pg_try_advisory_lock(${INDEXER_ADVISORY_LOCK_KEY}::bigint) as locked`,
  );
  const lockRow = (acquired as unknown as { rows: { locked: boolean }[] }).rows[0];
  if (!lockRow?.locked) {
    console.error(
      `[indexer] could not acquire pg_try_advisory_lock(${INDEXER_ADVISORY_LOCK_KEY}). Another indexer is already running against this DB.`,
    );
    process.exit(1);
  }
  console.log(`[indexer] acquired advisory lock`);

  const env = { rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase };
  const server = rpcServer(env);
  const routes = buildRoutes(config.contracts);

  const deployedContracts = Object.values(config.contracts).filter((c) => c.address);
  const contractIds = deployedContracts.map((c) => c.address);

  if (contractIds.length === 0) {
    console.error(
      `No contract addresses configured for network "${config.network}". Run 'make deploy' to populate packages/config/addresses.json.`,
    );
    process.exit(1);
  }

  // Build spec maps from binding clients for spec-driven event parsing.
  // Spec-only clients — no signer, just constructed for their `.spec` property.
  const specMaps = buildContractSpecMaps([
    { contractId: config.contracts.vault.address,
      spec: client(VaultClient, env, config.contracts.vault.address).spec },
    { contractId: config.contracts.positionManager.address,
      spec: client(PMClient, env, config.contracts.positionManager.address).spec },
    { contractId: config.contracts.configManager.address,
      spec: client(CMClient, env, config.contracts.configManager.address).spec },
    { contractId: config.contracts.oracleRouter.address,
      spec: client(ORClient, env, config.contracts.oracleRouter.address).spec },
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

        // Wrap (handler calls + cursor advance) in a transaction so a crash
        // between the two cannot leave the cursor stale (replaying events)
        // or the handlers ahead (skipping events on restart). The whole
        // page commits atomically.
        await db.transaction(async (tx) => {
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
              // The handler signature accepts `Db`; passing the drizzle tx
              // works at runtime because both expose the same insert / update /
              // select methods. Cast through unknown to satisfy drizzle's
              // distinct PgTransaction vs NodePgDatabase types.
              await handler(tx as unknown as typeof db, parsed);
            } catch (err) {
              // Surface handler errors but keep going — a single bad event
              // shouldn't abort the whole page. The cursor still advances
              // (the bad event has already been logged for follow-up).
              console.error(`Handler error for ${parsed.topic0} in ${rawEvent.contractId}:`, err);
            }
          }

          if (nextCursor && nextCursor !== cursor) {
            const lastEvent = events[events.length - 1];
            const lastLedgerCloseTime = lastEvent
              ? Math.floor(new Date(lastEvent.ledgerClosedAt).getTime() / 1000)
              : Math.floor(Date.now() / 1000);
            await tx
              .insert(indexerCursor)
              .values({
                id: 1,
                last_ledger: latestLedger,
                last_cursor: nextCursor,
                last_ledger_close_time: lastLedgerCloseTime.toString(),
              })
              .onConflictDoUpdate({
                target: indexerCursor.id,
                set: {
                  last_ledger: latestLedger,
                  last_cursor: nextCursor,
                  last_ledger_close_time: lastLedgerCloseTime.toString(),
                  updated_at: new Date(),
                },
              });
          }
        });

        if (nextCursor && nextCursor !== cursor) {
          cursor = nextCursor;
          startLedger = latestLedger;
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
