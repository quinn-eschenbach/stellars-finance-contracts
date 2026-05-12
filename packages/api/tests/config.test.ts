import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Tests mutate env vars; restore each time so order doesn't matter.
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
  it("returns parsed defaults when only DATABASE_URL is set", () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    delete process.env.API_PORT;
    delete process.env.API_CORS_ORIGINS;
    expect(loadConfig()).toEqual({
      databaseUrl: "postgres://localhost/test",
      port: 3030,
      corsOrigins: ["*"],
    });
  });

  it("parses API_PORT as a number", () => {
    process.env.DATABASE_URL = "postgres://x";
    process.env.API_PORT = "8080";
    expect(loadConfig().port).toBe(8080);
  });

  it("splits API_CORS_ORIGINS on commas and trims each origin", () => {
    process.env.DATABASE_URL = "postgres://x";
    process.env.API_CORS_ORIGINS = "https://foo.com, https://bar.com ,https://baz.com";
    expect(loadConfig().corsOrigins).toEqual([
      "https://foo.com",
      "https://bar.com",
      "https://baz.com",
    ]);
  });

  it("treats '*' as a single wildcard, not a literal list", () => {
    process.env.DATABASE_URL = "postgres://x";
    process.env.API_CORS_ORIGINS = "*";
    expect(loadConfig().corsOrigins).toEqual(["*"]);
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow(/DATABASE_URL is required/);
  });
});
