import { xdr, scValToNative, Address } from "@stellar/stellar-sdk";
import { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";

// ── Types ────────────────────────────────────────────────────────

interface FieldDef {
  name: string;
}

/** Spec-derived event schema: topic params and data params in declaration order. */
interface EventFieldSpec {
  topicFields: FieldDef[];
  dataFields: FieldDef[];
}

export interface ParsedEvent {
  contractId: string;
  /** Event name from topic[0] (e.g. "increase", "deposit"). */
  topic0: string;
  /**
   * All decoded event params, keyed by their spec field name.
   * Includes both topic-located params (from topic[1..N]) and data-located
   * params (from the positional ScVec value). Addresses are normalized to strings.
   * Typed as `any` so handlers can read fields without per-event type assertions;
   * each handler is responsible for knowing its event's shape.
   */
  data: Record<string, any>;
  ledger: number;
  txHash: string;
  timestamp: string;
}

export type ContractSpecMaps = Map<string, Map<string, EventFieldSpec>>;

// ── Spec extraction ──────────────────────────────────────────────

const EVENT_KIND = xdr.ScSpecEntryKind.scSpecEntryEventV0().value;
const TOPIC_LOCATION = xdr.ScSpecEventParamLocationV0
  .scSpecEventParamLocationTopicList().value;

function extractEventSpecs(spec: ContractSpec, contractId: string): Map<string, EventFieldSpec> {
  const result = new Map<string, EventFieldSpec>();

  for (const entry of spec.entries) {
    if (entry.switch().value !== EVENT_KIND) continue;

    const ev = entry.eventV0();
    const prefixTopics = ev.prefixTopics();
    if (prefixTopics.length === 0) continue;

    // First prefix topic is the event name symbol (e.g. "increase", "deposit")
    const topicName = prefixTopics[0].toString();
    const topicFields: FieldDef[] = [];
    const dataFields: FieldDef[] = [];

    for (const param of ev.params()) {
      const field: FieldDef = { name: param.name().toString() };
      if (param.location().value === TOPIC_LOCATION) {
        topicFields.push(field);
      } else {
        dataFields.push(field);
      }
    }

    // Two events on the same contract sharing the same topic name would
    // silently overwrite in the spec map, leaving one variant unparseable.
    // Detect at startup so the operator catches it before traffic arrives.
    if (result.has(topicName)) {
      throw new Error(
        `[spec-parser] duplicate event topic "${topicName}" in contract ${contractId} — ` +
          `two #[contractevent] declarations share the same topic name, which would cause silent parse collisions`,
      );
    }

    result.set(topicName, { topicFields, dataFields });
  }

  return result;
}

/**
 * Build spec maps for all contracts at startup.
 * Accepts pre-constructed Spec objects from binding Clients (avoids re-parsing).
 */
export function buildContractSpecMaps(
  contracts: { contractId: string; spec: ContractSpec }[],
): ContractSpecMaps {
  const maps: ContractSpecMaps = new Map();
  for (const { contractId, spec } of contracts) {
    maps.set(contractId, extractEventSpecs(spec, contractId));
  }
  return maps;
}

// ── Event parsing ────────────────────────────────────────────────

/**
 * Parse a raw RPC event into a structured ParsedEvent using the contract spec.
 * The caller is responsible for routing only known contracts here — an unknown
 * contract or event topic is a programmer error and throws.
 */
export function parseEvent(
  raw: {
    contractId: string;
    topic: string[];
    value: string;
    ledger: number;
    txHash: string;
    ledgerClosedAt: string;
  },
  specMaps: ContractSpecMaps,
): ParsedEvent | null {
  if (raw.topic.length === 0) {
    throw new Error(`[spec-parser] event has no topics: contract=${raw.contractId}`);
  }

  const topic0 = decodeScVal(raw.topic[0]) as string;
  const eventSpec = specMaps.get(raw.contractId)?.get(topic0);
  if (!eventSpec) {
    return null;
  }

  const data: Record<string, any> = {};

  // Topic params: raw.topic[1..N] correspond to topicFields in declaration order.
  for (let i = 0; i < eventSpec.topicFields.length; i++) {
    const idx = i + 1; // topic[0] is the event name
    if (idx >= raw.topic.length) break;
    data[eventSpec.topicFields[i].name] = decodeScVal(raw.topic[idx]);
  }

  // Data params: decoded according to the event's data_format. Soroban supports
  // three formats: vec (positional ScVec → JS array), map (ScMap → plain object
  // keyed by field name; this is the #[contractevent] default and what OZ uses),
  // and single-value (one ScVal). Handle all three so OZ events parse correctly.
  const decodedValue = scValToNative(xdr.ScVal.fromXDR(raw.value, "base64"));
  if (Array.isArray(decodedValue)) {
    for (let i = 0; i < eventSpec.dataFields.length && i < decodedValue.length; i++) {
      data[eventSpec.dataFields[i].name] = normalize(decodedValue[i]);
    }
  } else if (decodedValue && typeof decodedValue === "object") {
    const obj = decodedValue as Record<string, unknown>;
    for (const f of eventSpec.dataFields) {
      if (f.name in obj) data[f.name] = normalize(obj[f.name]);
    }
  } else if (eventSpec.dataFields.length === 1) {
    data[eventSpec.dataFields[0].name] = normalize(decodedValue);
  }

  return {
    contractId: raw.contractId,
    topic0,
    data,
    ledger: raw.ledger,
    txHash: raw.txHash,
    timestamp: raw.ledgerClosedAt,
  };
}

function decodeScVal(b64: string): unknown {
  return normalize(scValToNative(xdr.ScVal.fromXDR(b64, "base64")));
}

function normalize(val: unknown): unknown {
  return val instanceof Address ? val.toString() : val;
}
