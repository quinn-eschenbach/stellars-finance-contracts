import { rpc } from "@stellar/stellar-sdk";

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
}
