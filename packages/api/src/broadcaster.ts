import pg from "pg";

/**
 * Postgres LISTEN/NOTIFY broadcaster. Holds one persistent pg client that
 * subscribes to every channel we care about. Notifications are routed to
 * per-channel subscribers.
 *
 * Trigger DDL is owned by the drizzle migration `0004_notification_triggers.sql`
 * — installed once with the rest of the schema. The broadcaster only
 * subscribes; channel names + payload shapes live in `@stellars/db`'s
 * `CHANNELS` and `ChannelPayloads`.
 */

export type Notification = {
  channel: string;
  payload: unknown;
};

type Subscriber = (n: Notification) => void;

/**
 * The slice of the broadcaster that consumers (the SSE routes) actually need:
 * subscribe to a channel, get back an unsubscribe function. Promoting this to
 * a named interface keeps the `buildSseRoutes` parameter narrow and turns the
 * test fake into a real second adapter at this seam instead of a class-shaped
 * lookalike that needed `as any` to satisfy `Broadcaster`'s full surface.
 */
export interface Subscribable {
  subscribe(channel: string, fn: Subscriber): Promise<() => void>;
}

export class Broadcaster implements Subscribable {
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
