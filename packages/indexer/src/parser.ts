import { xdr, scValToNative, Address } from "@stellar/stellar-sdk";

/** Decode an XDR base64 ScVal to a JS-native value. */
export function decodeVal(b64: string): unknown {
  const scVal = xdr.ScVal.fromXDR(b64, "base64");
  return scValToNative(scVal);
}

/** Decode a topic entry (base64 XDR) to a string/symbol/address. */
export function decodeTopic(b64: string): string {
  const scVal = xdr.ScVal.fromXDR(b64, "base64");
  const val = scValToNative(scVal);
  if (val instanceof Address) return val.toString();
  return String(val);
}

export interface ParsedEvent {
  contractId: string;
  topic0: string;
  topic1: string | null;
  data: unknown[];
  ledger: number;
  txHash: string;
  timestamp: string;
}

/**
 * Parse raw event topics + value into a structured ParsedEvent.
 * Topic[0] is always the event name symbol.
 * Topic[1] (if present) is the discriminator (trader address or market symbol).
 * Data is always a vec (due to data_format = "vec" in #[contractevent]).
 */
export function parseEvent(raw: {
  contractId: string;
  topic: string[];
  value: string;
  ledger: number;
  txHash: string;
  ledgerClosedAt: string;
}): ParsedEvent {
  const topic0 = raw.topic.length > 0 ? decodeTopic(raw.topic[0]) : "";
  const topic1 = raw.topic.length > 1 ? decodeTopic(raw.topic[1]) : null;

  const rawData = decodeVal(raw.value);
  const data = Array.isArray(rawData) ? rawData : [rawData];

  return {
    contractId: raw.contractId,
    topic0,
    topic1,
    data,
    ledger: raw.ledger,
    txHash: raw.txHash,
    timestamp: raw.ledgerClosedAt,
  };
}
