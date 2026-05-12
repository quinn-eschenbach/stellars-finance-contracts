import { describe, it, expect } from "vitest";
import {
  cn,
  descale,
  formatPrice,
  formatUsdc,
  formatUsdcCompact,
  parsePrice,
  parseUsdc,
  priceDecimals,
  shortAddress,
} from "./utils";

describe("cn", () => {
  it("merges class names and dedupes tailwind conflicts", () => {
    expect(cn("p-2", false && "hidden", "p-4")).toBe("p-4");
  });
});

describe("descale", () => {
  it("converts a scaled bigint to a number", () => {
    expect(descale(123_456_700n)).toBe(12.34567);
  });

  it("handles negatives", () => {
    expect(descale(-10_000_000n)).toBe(-1);
  });

  it("preserves fractional precision past 2^53 raw", () => {
    // 1e9 USDC raw = 10^16 — beyond Number.MAX_SAFE_INTEGER but split-pathing
    // keeps the fractional part accurate to the scale unit.
    expect(descale(10_000_000_000_000_000n)).toBeCloseTo(1_000_000_000, 6);
  });

  it("passes through plain numbers untouched", () => {
    expect(descale(3.14)).toBe(3.14);
  });

  it("parses numeric strings", () => {
    expect(descale("50000000")).toBe(5);
  });
});

describe("formatUsdc", () => {
  it("formats whole dollars with default 2 decimals", () => {
    expect(formatUsdc(1_000_000_000n)).toBe("100.00");
  });

  it("groups thousands", () => {
    expect(formatUsdc(12_345_678_900_000n)).toBe("1,234,567.89");
  });

  it("respects decimals option", () => {
    expect(formatUsdc(15_000_000n, { decimals: 4 })).toBe("1.5000");
  });

  it("shows leading minus for negatives", () => {
    expect(formatUsdc(-5_000_000n)).toBe("-0.50");
  });

  it("abs option strips sign", () => {
    expect(formatUsdc(-5_000_000n, { abs: true })).toBe("0.50");
  });
});

describe("formatUsdcCompact", () => {
  it("formats dollars below 1k as plain integers", () => {
    expect(formatUsdcCompact(420_000_000n)).toBe("$42");
  });

  it("formats thousands with K suffix", () => {
    expect(formatUsdcCompact(89_000_000_000n)).toBe("$8.9K");
  });

  it("formats millions with M suffix", () => {
    expect(formatUsdcCompact(1_200_000_000_000_000n)).toBe("$120.0M");
  });

  it("preserves sign on negatives", () => {
    expect(formatUsdcCompact(-89_000_000_000n)).toBe("-$8.9K");
  });
});

describe("priceDecimals", () => {
  it("uses 2dp for prices >= $1", () => {
    expect(priceDecimals(950_000_000_000n)).toBe(2); // $95,000
  });

  it("uses 4dp for prices in [$0.01, $1)", () => {
    expect(priceDecimals(1_635_000n)).toBe(4); // $0.1635
  });

  it("uses 6dp for prices in [$0.0001, $0.01)", () => {
    expect(priceDecimals(50_000n)).toBe(6); // $0.005
  });

  it("uses 8dp for sub-cent micro prices", () => {
    expect(priceDecimals(120n)).toBe(8); // $0.000012
  });
});

describe("formatPrice", () => {
  it("formats with explicit decimals", () => {
    expect(formatPrice(950_000_000_000n, 2)).toBe("95,000.00");
  });

  it("truncates rather than rounds the fractional tail", () => {
    // 12345678 raw -> "1.2345678" — slicing to 2dp must yield "1.23".
    expect(formatPrice(12_345_678n, 2)).toBe("1.23");
  });
});

describe("parseUsdc / parsePrice", () => {
  it("parses an integer string", () => {
    expect(parseUsdc("100")).toBe(1_000_000_000n);
  });

  it("parses a fractional string", () => {
    expect(parseUsdc("1.5")).toBe(15_000_000n);
  });

  it("pads short fractionals to 7 digits", () => {
    expect(parseUsdc("0.0000001")).toBe(1n);
  });

  it("rejects malformed input", () => {
    expect(() => parseUsdc("1.5.0")).toThrow();
    expect(() => parseUsdc("abc")).toThrow();
  });

  it("handles negatives", () => {
    expect(parseUsdc("-2.5")).toBe(-25_000_000n);
  });

  it("parsePrice mirrors parseUsdc (shared 10^7 scale)", () => {
    expect(parsePrice("1.5")).toBe(parseUsdc("1.5"));
  });
});

describe("shortAddress", () => {
  it("collapses long addresses with ellipsis", () => {
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890";
    expect(shortAddress(addr)).toBe("GABCDE…7890");
  });

  it("returns the input unchanged when shorter than the budget", () => {
    expect(shortAddress("GABC")).toBe("GABC");
  });
});
