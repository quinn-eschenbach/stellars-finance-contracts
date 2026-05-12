/**
 * Build a fake Stellar address for E2E. Pads `label` with leading `A`s so
 * the result is the same 56-char G-prefixed shape a real strkey takes —
 * not a valid ed25519 strkey (no checksum), but our SUT only ever string-
 * compares and trims the trailing chars for display, so the shape is what
 * matters.
 *
 * The label appears at the tail of the address, which makes test assertions
 * readable (`page.getByText(/…RADR$/)` for `trader("RADR")`).
 */
export function trader(label: string): string {
  const upper = label.toUpperCase();
  if (upper.length > 55) throw new Error(`trader label too long: ${label}`);
  if (!/^[A-Z0-9]+$/.test(upper)) throw new Error(`trader label must be base32-ish: ${label}`);
  return "G" + "A".repeat(55 - upper.length) + upper;
}
