import { xdr, scValToNative, Address } from "@stellar/stellar-sdk";

/** Convert a decoded i128/u128 value (bigint or {hi,lo} object) to a string. */
export function toNumericString(val: unknown): string {
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "number") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null) {
    // Handle SDK i128/u128 objects - try JSON serialization for debug
    const obj = val as Record<string, unknown>;
    if ("lo" in obj && "hi" in obj) {
      const hi = BigInt(obj.hi as string | number | bigint);
      const lo = BigInt(obj.lo as string | number | bigint);
      return ((hi << 64n) | lo).toString();
    }
    // Fallback: try to extract a single numeric value
    console.warn("[toNumericString] unexpected object:", JSON.stringify(val));
  }
  return String(val);
}

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
  data: Record<string, unknown>;
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
  const data = (typeof rawData === "object" && rawData !== null && !Array.isArray(rawData)
    ? rawData
    : { _raw: rawData }) as Record<string, unknown>;

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
