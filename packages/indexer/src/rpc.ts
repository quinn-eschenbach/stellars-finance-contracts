import { rpc } from "@stellar/stellar-sdk";
import {
  INDEXER_RPC_RETRY_BASE_MS,
  INDEXER_RPC_RETRY_MAX_MS,
} from "@stellars/config";

export interface RawEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: string;
  txHash: string;
}

/**
 * Exponential backoff with jitter, capped at INDEXER_RPC_RETRY_MAX_MS.
 * Used to avoid hammering an RPC node that is rate-limiting us (429) or
 * suffering a transient error (5xx).
 */
function backoffMs(attempt: number): number {
  const exp = INDEXER_RPC_RETRY_BASE_MS * Math.pow(2, attempt);
  const capped = Math.min(exp, INDEXER_RPC_RETRY_MAX_MS);
  const jitter = capped * 0.3 * Math.random();
  return Math.floor(capped + jitter);
}

function isRetryable(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  // Conservative: retry on 429 (rate limit), 418 (Stellar custom rate-limit
  // code), 5xx, and connect/reset failures. Other errors propagate.
  return (
    /\b429\b/.test(msg) ||
    /\b418\b/.test(msg) ||
    /\b5\d\d\b/.test(msg) ||
    /ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed/i.test(msg)
  );
}

export async function fetchEvents(
  server: rpc.Server,
  startLedger: number,
  contractIds: string[],
  cursor?: string,
): Promise<{ events: RawEvent[]; latestLedger: number; nextCursor: string }> {
  const filters: rpc.Api.EventFilter[] = contractIds.map((id) => ({
    type: "contract" as const,
    contractIds: [id],
  }));

  const request: rpc.Server.GetEventsRequest = cursor
    ? { filters, cursor }
    : { filters, startLedger };

  // Bounded retry on transient RPC errors. Indexer's outer loop will sleep
  // and retry independently if we still surface an error.
  let attempt = 0;
  const maxAttempts = 5;
  while (true) {
    try {
      const response = await server.getEvents(request);
      const events: RawEvent[] = response.events.map((e) => ({
        id: e.id,
        type: e.type,
        ledger: e.ledger,
        ledgerClosedAt: e.ledgerClosedAt,
        contractId: e.contractId?.toString() ?? "",
        topic: e.topic.map((t) => t.toXDR("base64" as const)),
        value: e.value.toXDR("base64" as const),
        txHash: e.txHash,
      }));
      return { events, latestLedger: response.latestLedger, nextCursor: response.cursor };
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }
      const delay = backoffMs(attempt);
      console.warn(`[indexer rpc] retryable error attempt=${attempt} delay=${delay}ms: ${(err as Error)?.message ?? err}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
