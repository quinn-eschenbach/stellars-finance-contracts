import pg from "pg";

/**
 * Postgres LISTEN/NOTIFY broadcaster. Holds one persistent pg client that
 * subscribes to every channel we care about. Notifications are routed to
 * per-channel async iterators so SSE handlers can pull them with backpressure.
 *
 * Triggers in `installTriggers()` emit small JSON payloads (typically just
 * `{ id }` for the changed row) — the SSE handler is expected to query the
 * full row before pushing to the client. Decouples notification reliability
 * from data correctness.
 */

export type Notification = {
  channel: string;
  payload: unknown;
};

type Subscriber = (n: Notification) => void;

export class Broadcaster {
  private client: pg.Client;
  private subscribers: Map<string, Set<Subscriber>> = new Map();
  private listening: Set<string> = new Set();
  private connected = false;

  constructor(databaseUrl: string) {
    this.client = new pg.Client({ connectionString: databaseUrl });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.client.on("notification", (msg) => {
      const channel = msg.channel;
      const payload = msg.payload ? safeJsonParse(msg.payload) : null;
      const subs = this.subscribers.get(channel);
      if (!subs) return;
      for (const sub of subs) {
        try {
          sub({ channel, payload });
        } catch (err) {
          console.error(`[broadcaster] subscriber for ${channel} threw:`, err);
        }
      }
    });
    this.connected = true;
  }

  /** Subscribe to a channel. Returns an unsubscribe function. */
  async subscribe(channel: string, fn: Subscriber): Promise<() => void> {
    if (!this.connected) await this.connect();
    if (!this.listening.has(channel)) {
      await this.client.query(`LISTEN ${pgIdent(channel)}`);
      this.listening.add(channel);
    }
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(fn);
    return () => {
      subs!.delete(fn);
    };
  }

  async installTriggers(): Promise<void> {
    if (!this.connected) await this.connect();
    await this.client.query(TRIGGER_SQL);
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.end();
    this.connected = false;
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Quote a Postgres identifier (channel name). Defensive; channels are static. */
function pgIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`invalid pg channel name: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Idempotent trigger setup. Each table we want to stream gets a per-row
 * AFTER INSERT/UPDATE trigger that fires pg_notify('<channel>', payload).
 *
 * Channels:
 *   oracle_prices_changed → { id, symbol }
 *   markets_changed       → { symbol }
 *   vault_state_changed   → { id }
 *   positions_changed     → { id, trader, symbol, op }
 *   trades_changed        → { id, trader, symbol, event_type }
 */
const TRIGGER_SQL = `
-- oracle_prices: only INSERTs
CREATE OR REPLACE FUNCTION notify_oracle_prices() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('oracle_prices_changed',
    json_build_object('id', NEW.id, 'symbol', NEW.symbol)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_oracle_prices_notify ON oracle_prices;
CREATE TRIGGER api_oracle_prices_notify
AFTER INSERT ON oracle_prices
FOR EACH ROW EXECUTE FUNCTION notify_oracle_prices();

-- markets: INSERT or UPDATE
CREATE OR REPLACE FUNCTION notify_markets() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('markets_changed',
    json_build_object('symbol', NEW.symbol)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_markets_notify ON markets;
CREATE TRIGGER api_markets_notify
AFTER INSERT OR UPDATE ON markets
FOR EACH ROW EXECUTE FUNCTION notify_markets();

-- vault_state: INSERT or UPDATE
CREATE OR REPLACE FUNCTION notify_vault_state() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('vault_state_changed',
    json_build_object('id', NEW.id)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_vault_state_notify ON vault_state;
CREATE TRIGGER api_vault_state_notify
AFTER INSERT OR UPDATE ON vault_state
FOR EACH ROW EXECUTE FUNCTION notify_vault_state();

-- positions: INSERT, UPDATE, DELETE — all matter for the frontend
CREATE OR REPLACE FUNCTION notify_positions() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM pg_notify('positions_changed',
      json_build_object('id', OLD.id, 'trader', OLD.trader, 'symbol', OLD.symbol, 'op', 'DELETE')::text);
    RETURN OLD;
  ELSE
    PERFORM pg_notify('positions_changed',
      json_build_object('id', NEW.id, 'trader', NEW.trader, 'symbol', NEW.symbol, 'op', TG_OP)::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_positions_notify ON positions;
CREATE TRIGGER api_positions_notify
AFTER INSERT OR UPDATE OR DELETE ON positions
FOR EACH ROW EXECUTE FUNCTION notify_positions();

-- trades: only INSERTs
CREATE OR REPLACE FUNCTION notify_trades() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('trades_changed',
    json_build_object('id', NEW.id, 'trader', NEW.trader, 'symbol', NEW.symbol, 'event_type', NEW.event_type)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_trades_notify ON trades;
CREATE TRIGGER api_trades_notify
AFTER INSERT ON trades
FOR EACH ROW EXECUTE FUNCTION notify_trades();
`;
