import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiGet, ApiError } from "./client";
import { API_BASE } from "@/lib/constants";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(impl: typeof fetch) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("apiGet", () => {
  it("prefixes the path with API_BASE and parses JSON", async () => {
    stubFetch(async (input) => {
      expect(String(input)).toBe(`${API_BASE}/markets`);
      return new Response(JSON.stringify([{ symbol: "BTCUSD" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const rows = await apiGet<Array<{ symbol: string }>>("/markets");
    expect(rows).toEqual([{ symbol: "BTCUSD" }]);
  });

  it("adds a leading slash when the caller forgets one", async () => {
    stubFetch(async (input) => {
      expect(String(input)).toBe(`${API_BASE}/markets`);
      return new Response("[]", { status: 200 });
    });
    await apiGet("markets");
  });

  it("sends the accept: application/json request header", async () => {
    let observed: Headers | undefined;
    stubFetch(async (_input, init) => {
      observed = new Headers(init?.headers);
      return new Response("[]", { status: 200 });
    });
    await apiGet("/markets");
    expect(observed?.get("accept")).toBe("application/json");
  });

  it("throws ApiError with status + body when the response is not ok", async () => {
    stubFetch(async () => new Response("oops", { status: 503 }));
    await expect(apiGet("/markets")).rejects.toBeInstanceOf(ApiError);
    try {
      await apiGet("/markets");
    } catch (err) {
      expect((err as ApiError).status).toBe(503);
      expect((err as ApiError).message).toMatch(/503/);
      expect((err as ApiError).message).toMatch(/oops/);
    }
  });

  it("uses statusText as the message when the body can't be read", async () => {
    stubFetch(async () => {
      // A Response whose body throws on text() — exercises the catch in apiGet.
      const res = new Response(null, { status: 502, statusText: "Bad Gateway" });
      // Replace text() with a rejecting version so apiGet's `.catch(() => "")` fires.
      (res as unknown as { text: () => Promise<string> }).text = () =>
        Promise.reject(new Error("stream broken"));
      return res;
    });
    try {
      await apiGet("/markets");
      throw new Error("expected apiGet to throw");
    } catch (err) {
      expect((err as ApiError).status).toBe(502);
      expect((err as ApiError).message).toMatch(/Bad Gateway/);
    }
  });
});

describe("ApiError", () => {
  it("exposes status as a public property and keeps a useful name", () => {
    const err = new ApiError(418, "I'm a teapot");
    expect(err.status).toBe(418);
    expect(err.message).toBe("I'm a teapot");
    expect(err.name).toBe("ApiError");
  });
});
