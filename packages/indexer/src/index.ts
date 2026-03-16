import "dotenv/config";
import { rpc } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { getDb, indexerCursor } from "@stellars/db";
import { loadConfig } from "./config.js";
import { fetchEvents } from "./rpc.js";
import { parseEvent } from "./parser.js";
import { buildRoutes } from "./handlers/index.js";
import { startHealthServer, updateHealth } from "./health.js";

async function main() {
  const config = loadConfig();
  const db = getDb();
  const server = new rpc.Server(config.rpcUrl);
  const routes = buildRoutes(config.contracts);
  const contractIds = Object.values(config.contracts).filter(Boolean);

  if (contractIds.length === 0) {
    console.error("No contract IDs configured. Set them in env or @stellars/config addresses.json.");
    process.exit(1);
  }

  startHealthServer(config.healthPort);

  // Load cursor from DB or use START_LEDGER
  let cursor: string | undefined;
  let startLedger = config.startLedger;

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

  // Main polling loop
  while (running) {
    try {
      const { events, latestLedger } = await fetchEvents(server, startLedger, contractIds, cursor);

      for (const rawEvent of events) {
        const handler = routes[rawEvent.contractId];
        if (!handler) continue;

        const parsed = parseEvent(rawEvent);
        try {
          await handler(db, parsed);
        } catch (err) {
          console.error(`Handler error for ${parsed.topic0} in ${rawEvent.contractId}:`, err);
        }

        // Update cursor after each event
        cursor = rawEvent.id;
        startLedger = rawEvent.ledger;
      }

      // Persist cursor
      if (events.length > 0) {
        await db
          .insert(indexerCursor)
          .values({
            id: 1,
            last_ledger: startLedger,
            last_cursor: cursor ?? "",
          })
          .onConflictDoUpdate({
            target: indexerCursor.id,
            set: {
              last_ledger: startLedger,
              last_cursor: cursor ?? "",
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
