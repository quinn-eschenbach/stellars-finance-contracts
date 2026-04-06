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
 * Field-name schemas for each contractevent (non-topic fields, in declaration order).
 * These match the Rust struct field order after removing #[topic] fields,
 * since data_format = "vec" encodes them as a positional ScVec.
 */
const EVENT_SCHEMAS: Record<string, string[]> = {
  // Vault
  deposit:   ["assets", "shares", "from"],
  withdraw:  ["assets", "shares", "receiver"],
  mint:      ["shares", "assets", "from"],
  redeem:    ["shares", "assets", "receiver"],
  settle:    ["amount", "reserved_delta", "is_profit"],
  reserve:   ["amount", "new_total"],
  release:   ["amount", "new_total"],
  fees:      ["amount", "new_total"],
  claim:     ["amount", "recipient"],
  pause:     ["is_paused", "caller"],
  // PositionManager
  increase:  ["symbol", "size_delta", "collateral", "entry_price", "is_long", "tp", "sl", "new_total_size", "new_total_collateral"],
  decrease:  ["symbol", "size_delta", "pnl", "borrow_fee", "funding_fee", "mark_price", "is_full_close"],
  liq:       ["symbol", "size", "collateral", "pnl", "borrow_fee", "funding_fee", "mark_price", "keeper"],
  exec_ord:  ["symbol", "size", "pnl", "mark_price", "is_tp", "keeper"],
  adl:       ["symbol", "size", "pnl", "mark_price"],
  indices:   ["acc_borrow_index", "acc_funding_index", "timestamp"],
  tp_sl:     ["symbol", "take_profit", "stop_loss"],
  max_lev:   ["max_leverage"],
  // OracleRouter
  price:     ["price", "timestamp"],
  orccfg:    ["staleness", "deviation", "cache_duration"],
  // ConfigManager
  role:      ["role", "account", "is_grant"],
  feecfg:    ["keeper_bps", "dev_bps", "lp_bps"],
  limits:    ["min_collateral", "cooldown_duration", "min_position_lifetime", "max_utilization_ratio", "funding_cut_bps", "adl_pnl_bps", "adl_utilization_bps"],
  rates:     ["base_borrow_rate_bps", "slope1_bps", "slope2_bps", "optimal_utilization_bps", "base_funding_rate_bps"],
};

/** Zip a positional array with field names from the schema. */
function zipFields(topic0: string, arr: unknown[]): Record<string, unknown> {
  const fields = EVENT_SCHEMAS[topic0];
  if (!fields) return { _raw: arr };
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < fields.length && i < arr.length; i++) {
    obj[fields[i]] = arr[i];
  }
  return obj;
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
  let data: Record<string, unknown>;
  if (Array.isArray(rawData)) {
    data = zipFields(topic0, rawData);
  } else if (typeof rawData === "object" && rawData !== null) {
    data = rawData as Record<string, unknown>;
  } else {
    data = { _raw: rawData };
  }

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
