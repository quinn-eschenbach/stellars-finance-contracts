import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock the pg.Client constructor before importing Broadcaster so the module
 * picks up our stub instead of the real Postgres driver. The mock records
 * every query and lets the test invoke registered "notification" listeners
 * synchronously to simulate LISTEN/NOTIFY fan-out.
 */
class MockPgClient {
  connectCalls = 0;
  endCalls = 0;
  queries: string[] = [];
  // Stored by registration so tests can fire notifications.
  notificationHandlers: Array<(msg: { channel: string; payload: string | null }) => void> = [];
  endHandlers: Array<() => void> = [];

  constructor(public opts: { connectionString?: string } = {}) {}

  async connect(): Promise<void> {
    this.connectCalls++;
  }

  async end(): Promise<void> {
    this.endCalls++;
  }

  async query(sql: string): Promise<{ rows: unknown[] }> {
    this.queries.push(sql);
    return { rows: [] };
  }

  on(event: "notification" | "end", fn: (...args: unknown[]) => void): this {
    if (event === "notification") this.notificationHandlers.push(fn as never);
    else if (event === "end") this.endHandlers.push(fn as never);
    return this;
  }

  /** Test helper: fire a notification through the registered handler. */
  fire(channel: string, payload: string | null) {
    for (const h of this.notificationHandlers) h({ channel, payload });
  }
}

const created: MockPgClient[] = [];
vi.mock("pg", () => ({
  default: {
    Client: class extends MockPgClient {
      constructor(opts: { connectionString?: string } = {}) {
        super(opts);
        created.push(this);
      }
    },
  },
}));

const { Broadcaster } = await import("../src/broadcaster.js");

beforeEach(() => {
  created.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Broadcaster.connect", () => {
  it("connects exactly once even when called repeatedly", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    await br.connect();
    await br.connect();
    expect(created).toHaveLength(1);
    expect(created[0].connectCalls).toBe(1);
  });

  it("passes the database URL through to the pg client", async () => {
    const br = new Broadcaster("postgres://user:pass@host/db");
    await br.connect();
    expect(created[0].opts.connectionString).toBe("postgres://user:pass@host/db");
  });
});

describe("Broadcaster.subscribe", () => {
  it("issues LISTEN once per channel, regardless of subscriber count", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    await br.subscribe("oracle_prices_changed", fn1);
    await br.subscribe("oracle_prices_changed", fn2);
    expect(created[0].queries).toEqual([`LISTEN "oracle_prices_changed"`]);
  });

  it("auto-connects when subscribing on a fresh broadcaster", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.subscribe("trades_changed", vi.fn());
    expect(created[0].connectCalls).toBe(1);
  });

  it("delivers notifications to every subscriber with parsed JSON payload", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    await br.subscribe("markets_changed", fn1);
    await br.subscribe("markets_changed", fn2);

    created[0].fire("markets_changed", JSON.stringify({ symbol: "BTCUSD" }));

    expect(fn1).toHaveBeenCalledWith({
      channel: "markets_changed",
      payload: { symbol: "BTCUSD" },
    });
    expect(fn2).toHaveBeenCalledWith({
      channel: "markets_changed",
      payload: { symbol: "BTCUSD" },
    });
  });

  it("delivers a null payload when there is no notify payload", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    const fn = vi.fn();
    await br.subscribe("trades_changed", fn);
    created[0].fire("trades_changed", null);
    expect(fn).toHaveBeenCalledWith({ channel: "trades_changed", payload: null });
  });

  it("falls back to the raw string when the payload isn't JSON", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    const fn = vi.fn();
    await br.subscribe("trades_changed", fn);
    created[0].fire("trades_changed", "not-json");
    expect(fn).toHaveBeenCalledWith({ channel: "trades_changed", payload: "not-json" });
  });

  it("isolates one bad subscriber's throw so others still receive the event", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    const angry = vi.fn(() => {
      throw new Error("boom");
    });
    const fine = vi.fn();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await br.subscribe("vault_state_changed", angry);
    await br.subscribe("vault_state_changed", fine);
    created[0].fire("vault_state_changed", JSON.stringify({ id: 1 }));
    expect(angry).toHaveBeenCalled();
    expect(fine).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns an unsubscribe function that stops further delivery", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    const fn = vi.fn();
    const off = await br.subscribe("vault_state_changed", fn);

    created[0].fire("vault_state_changed", JSON.stringify({ id: 1 }));
    expect(fn).toHaveBeenCalledTimes(1);

    off();
    created[0].fire("vault_state_changed", JSON.stringify({ id: 1 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("silently drops notifications on channels with no subscribers", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    // Subscribe to one channel so the client is wired up.
    await br.subscribe("markets_changed", vi.fn());
    // Now fire on a channel we never subscribed to — must not throw.
    expect(() => created[0].fire("nobody_listens", "{}")).not.toThrow();
  });

  it("rejects invalid channel identifiers before issuing LISTEN", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    await expect(br.subscribe("naughty; DROP TABLE", vi.fn())).rejects.toThrow(
      /invalid pg channel name/,
    );
    // Nothing should have been queried.
    expect(created[0].queries).toEqual([]);
  });
});

describe("Broadcaster.close", () => {
  it("ends the underlying pg client and is idempotent", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.connect();
    await br.close();
    await br.close();
    expect(created[0].endCalls).toBe(1);
  });

  it("is a no-op when never connected", async () => {
    const br = new Broadcaster("postgres://stub");
    await br.close();
    expect(created).toHaveLength(1);
    expect(created[0].endCalls).toBe(0);
  });
});
