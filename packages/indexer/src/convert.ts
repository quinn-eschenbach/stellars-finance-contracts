// Conversion helpers for event-data values headed into Postgres. Kept apart
// from spec-parser.ts (which owns scValToNative wiring) so handlers don't pull
// in the parser surface just to format a number.

/** Convert a decoded i128/u128 (bigint), number, or numeric string to a numeric string for DB storage. */
export function toNumericString(val: unknown): string {
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "number") return val.toString();
  if (typeof val === "string") return val;
  throw new Error(`[toNumericString] unexpected value: ${JSON.stringify(val)}`);
}

/** ISO-8601 timestamp string → unix seconds as a numeric string for DB storage. */
export function unixSeconds(iso: string): string {
  return Math.floor(Date.parse(iso) / 1000).toString();
}
