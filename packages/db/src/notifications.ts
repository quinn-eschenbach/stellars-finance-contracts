// Channel registry for Postgres LISTEN/NOTIFY. Lives in @stellars/db so
// consumers (the API's SSE routes) get typed channel names and payload
// shapes from the same package as the schema. The actual trigger DDL lives
// in the drizzle migration `0004_notification_triggers.sql` — that's the
// install path; this file is the consumer-side surface.
//
// If you change a channel name or payload shape here, update the trigger DDL
// in the migration to match (and ship a new migration).

export const CHANNELS = {
  oraclePrices: "oracle_prices_changed",
  markets: "markets_changed",
  vaultState: "vault_state_changed",
  positions: "positions_changed",
  trades: "trades_changed",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Payload shape per channel — mirrors what `pg_notify` emits in the triggers. */
export interface ChannelPayloads {
  oraclePrices: { id: number; symbol: string };
  markets: { symbol: string };
  vaultState: { id: number };
  positions: {
    id: number;
    trader: string;
    symbol: string;
    op: "INSERT" | "UPDATE" | "DELETE";
  };
  trades: {
    id: number;
    trader: string;
    symbol: string;
    event_type: string;
  };
}
