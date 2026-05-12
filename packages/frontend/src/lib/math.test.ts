import { describe, it, expect } from "vitest";
import { approxLiquidationPrice } from "./math";

const PRICE_UNIT = 10_000_000n;
const ENTRY = 100n * PRICE_UNIT;

describe("approxLiquidationPrice", () => {
  it("returns entry × (1 − 1/leverage) for a long", () => {
    // 10× long ⇒ collateral = size/10 ⇒ adjustment = entry/10 ⇒ liq = entry × 0.9
    const collateral = 10n * PRICE_UNIT;
    const size = 100n * PRICE_UNIT;
    expect(approxLiquidationPrice(ENTRY, collateral, size, true)).toBe(90n * PRICE_UNIT);
  });

  it("returns entry × (1 + 1/leverage) for a short", () => {
    const collateral = 10n * PRICE_UNIT;
    const size = 100n * PRICE_UNIT;
    expect(approxLiquidationPrice(ENTRY, collateral, size, false)).toBe(110n * PRICE_UNIT);
  });

  it("scales with leverage — 2× long liquidates at half entry", () => {
    const collateral = 50n * PRICE_UNIT;
    const size = 100n * PRICE_UNIT;
    expect(approxLiquidationPrice(ENTRY, collateral, size, true)).toBe(50n * PRICE_UNIT);
  });

  it("returns null when size is zero", () => {
    expect(approxLiquidationPrice(ENTRY, 1n, 0n, true)).toBeNull();
  });

  it("returns null when collateral is zero", () => {
    expect(approxLiquidationPrice(ENTRY, 0n, 1n, true)).toBeNull();
  });
});
