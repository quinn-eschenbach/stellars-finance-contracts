import { expect, type Page } from "@playwright/test";

/** Protocol scale for USDC and price values — × 10^7 in storage. */
const SCALE = 10_000_000n;

/**
 * `@number-flow/react` renders into Shadow DOM with per-digit spans, so
 * `page.textContent` and `getByText` don't see the formatted number. The
 * React wrapper serializes `formatToData(value, …)` and parks it on the
 * `<number-flow-react>` custom element as the `data` attribute. Inside that
 * blob lives the raw `value` we want to assert against — that's the only
 * reliable seam because:
 *   - the wrapper never calls the imperative `update(value)`, so `el.value`
 *     stays `undefined` for React-driven instances;
 *   - the accessible name (`ElementInternals.ariaLabel`) isn't reflected as
 *     a DOM attribute.
 *
 * Usage:
 *   await expectNumberFlowValue(page, 1_234_567);  // matches "$1,234,567"
 */
export async function expectNumberFlowValue(
  page: Page,
  expected: number,
  opts: { tolerance?: number } = {},
) {
  const tolerance = opts.tolerance ?? 0.5;
  await expect
    .poll(
      async () => {
        const values = await page.$$eval("number-flow-react", (els) =>
          els.map((el) => {
            // The React wrapper invokes the `data` setter on the element,
            // which stores the parsed object on `_data` (private-ish field).
            // `_data.value` is the raw numeric value the formatter saw.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = (el as any)._data?.value;
            return typeof v === "number" ? v : Number.NaN;
          }),
        );
        return values.some(
          (v) => Number.isFinite(v) && Math.abs(v - expected) <= tolerance,
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

/**
 * Assert against a protocol-scaled raw value (e.g. a USDC amount stored as
 * a × 10^7 bigint or its string form). Lives alongside `expectNumberFlowValue`
 * so the Shadow-DOM-reading + bigint-conversion concerns stay together.
 *
 * Usage:
 *   await expectScaledValue(page, DEFAULT_VAULT.total_assets);
 *   // total_assets is "100000000000000000" (10M × 10^7) → matches "$10,000,000"
 */
export async function expectScaledValue(
  page: Page,
  raw: bigint | string,
  opts: { tolerance?: number } = {},
) {
  const big = typeof raw === "bigint" ? raw : BigInt(raw);
  await expectNumberFlowValue(page, Number(big / SCALE), opts);
}
