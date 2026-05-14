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
  private databaseUrl: string;
  private subscribers: Map<string, Set<Subscriber>> = new Map();
  private listening: Set<string> = new Set();
  private connectedFlag = false;
  private shuttingDown = false;
  private reconnectAttempt = 0;

  constructor(databaseUrl: string) {
    this.databaseUrl = databaseUrl;
    this.client = this.makeClient();
  }

  /** Public read-only view of connection state — used by /healthz. */
  get connected(): boolean {
    return this.connectedFlag && !this.shuttingDown;
  }

  private makeClient(): pg.Client {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    client.on("notification", (msg) => {
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
    // Register error + end handlers and trigger reconnect. Without these
    // a 5-second TCP blip silently kills every SSE stream.
    client.on("error", (err) => {
      console.error(`[broadcaster] pg client error: ${err.message}`);
      this.handleDisconnect();
    });
    client.on("end", () => {
      console.warn("[broadcaster] pg client ended");
      this.handleDisconnect();
    });
    return client;
  }

  private handleDisconnect(): void {
    if (this.shuttingDown) return;
    if (!this.connectedFlag) return;
    this.connectedFlag = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown) return;
    this.reconnectAttempt += 1;
    // Exponential backoff with a 30s cap and small jitter.
    const baseMs = 500 * Math.pow(2, Math.min(this.reconnectAttempt, 6));
    const cappedMs = Math.min(baseMs, 30_000);
    const delayMs = Math.floor(cappedMs + Math.random() * 200);
    console.log(`[broadcaster] reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`);
    setTimeout(async () => {
      if (this.shuttingDown) return;
      try {
        this.client = this.makeClient();
        await this.client.connect();
        // Re-issue LISTEN for every previously subscribed channel.
        for (const channel of this.listening) {
          await this.client.query(`LISTEN ${pgIdent(channel)}`);
        }
        this.connectedFlag = true;
        this.reconnectAttempt = 0;
        // Notify subscribers that they may have missed events while we were
        // gone. Each subscriber is responsible for re-fetching state.
        for (const [channel, subs] of this.subscribers) {
          for (const sub of subs) {
            try {
              sub({ channel, payload: { __resync: true } });
            } catch (err) {
              console.error(`[broadcaster] resync delivery to ${channel} threw:`, err);
            }
          }
        }
        console.log(`[broadcaster] reconnected, re-LISTENed ${this.listening.size} channels`);
      } catch (err) {
        console.error(`[broadcaster] reconnect failed: ${(err as Error).message}`);
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  async connect(): Promise<void> {
    if (this.connectedFlag) return;
    await this.client.connect();
    this.connectedFlag = true;
  }

  /** Subscribe to a channel. Returns an unsubscribe function. */
  async subscribe(channel: string, fn: Subscriber): Promise<() => void> {
    if (!this.connectedFlag) await this.connect();
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
    this.shuttingDown = true;
    if (!this.connectedFlag) return;
    await this.client.end();
    this.connectedFlag = false;
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
