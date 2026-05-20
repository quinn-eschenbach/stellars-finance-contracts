// Validation-surface tests for the shared CEX book-ticker factory. Each
// case stubs `globalThis.fetch` so we exercise the factory's parse + sanity
// + crossed-book + staleness gates without hitting any real exchange.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createBookTickerSource,
  type BookTickerParseResult,
} from "../src/book-ticker.js";

const symbolMap = { BTCUSD: "BTCUSDT" };
const endpoint = "https://example.test/book";

type FetchInit = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

let originalFetch: typeof globalThis.fetch;
function stubFetch(init: FetchInit): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(init.body ?? {}), {
      status: init.status ?? 200,
      headers: init.headers,
    })) as typeof globalThis.fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function passthroughParser(json: unknown): BookTickerParseResult {
  const body = json as { bid: number; ask: number; ts?: number };
  return { book: { bid: body.bid, ask: body.ask, serverTimestampMs: body.ts } };
}

describe("createBookTickerSource — symbol mapping", () => {
  it("throws when the ticker isn't in the symbol map", async () => {
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
    });
    await expect(src.fetchPrice("ETHUSD")).rejects.toThrow(/no symbol mapping/);
  });
});

describe("createBookTickerSource — HTTP errors", () => {
  it("surfaces non-2xx status", async () => {
    stubFetch({ status: 500 });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
    });
    await expect(src.fetchPrice("BTCUSD")).rejects.toThrow(/HTTP 500/);
  });

  it("appends retry-after to the error message when present", async () => {
    stubFetch({ status: 429, headers: { "retry-after": "30" } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
    });
    await expect(src.fetchPrice("BTCUSD")).rejects.toThrow(/retry-after=30/);
  });
});

describe("createBookTickerSource — parser error", () => {
  it("propagates the parser's error message", async () => {
    stubFetch({ body: { code: "bad" } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: () => ({ error: "API error code=bad" }),
    });
    await expect(src.fetchPrice("BTCUSD")).rejects.toThrow(/API error code=bad/);
  });
});

describe("createBookTickerSource — bid/ask validation", () => {
  it("rejects NaN or non-positive bid/ask", async () => {
    stubFetch({ body: { bid: 0, ask: 100 } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
    });
    await expect(src.fetchPrice("BTCUSD")).rejects.toThrow(/bad book/);
  });

  it("rejects crossed books (ask < bid)", async () => {
    stubFetch({ body: { bid: 101, ask: 100 } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
    });
    await expect(src.fetchPrice("BTCUSD")).rejects.toThrow(/crossed book/);
  });

  it("returns (bid + ask) / 2 on a healthy book", async () => {
    stubFetch({ body: { bid: 99, ask: 101 } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
    });
    expect(await src.fetchPrice("BTCUSD")).toBe(100);
  });
});

describe("createBookTickerSource — staleness gate", () => {
  it("rejects ticks older than stalenessMs when parser surfaces a timestamp", async () => {
    stubFetch({ body: { bid: 99, ask: 101, ts: Date.now() - 60_000 } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
      stalenessMs: 10_000,
    });
    await expect(src.fetchPrice("BTCUSD")).rejects.toThrow(/stale print/);
  });

  it("accepts fresh ticks when parser surfaces a recent timestamp", async () => {
    stubFetch({ body: { bid: 99, ask: 101, ts: Date.now() - 1_000 } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
      stalenessMs: 10_000,
    });
    expect(await src.fetchPrice("BTCUSD")).toBe(100);
  });

  it("ignores staleness when the parser doesn't surface a timestamp", async () => {
    stubFetch({ body: { bid: 99, ask: 101 } });
    const src = createBookTickerSource({
      name: "test",
      endpoint,
      symbolMap,
      parseResponse: passthroughParser,
      stalenessMs: 10_000,
    });
    expect(await src.fetchPrice("BTCUSD")).toBe(100);
  });
});
