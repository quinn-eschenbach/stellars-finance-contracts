import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** USDC has 7 decimals throughout the protocol (matching Stellar's i128 scaling). */
export const USDC_DECIMALS = 7;
const USDC_UNIT = 10_000_000n;

/** Oracle prices and entry prices are scaled by 10^7. */
export const PRICE_DECIMALS = 7;
const PRICE_UNIT = 10_000_000n;

/** Format a scaled USDC amount as a display string. */
export function formatUsdc(scaled: bigint | string, opts: { decimals?: number; abs?: boolean } = {}): string {
  const dp = opts.decimals ?? 2;
  let v = typeof scaled === "string" ? BigInt(scaled) : scaled;
  if (opts.abs && v < 0n) v = -v;
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / USDC_UNIT;
  const frac = abs % USDC_UNIT;
  const fracStr = frac.toString().padStart(7, "0").slice(0, dp);
  const wholeStr = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeStr}${dp > 0 ? "." + fracStr : ""}`;
}

/** Format a scaled price (USD per BTC, etc) as a display string. */
export function formatPrice(scaled: bigint | string, decimals = 2): string {
  const v = typeof scaled === "string" ? BigInt(scaled) : scaled;
  const whole = v / PRICE_UNIT;
  const frac = v % PRICE_UNIT;
  const fracStr = frac.toString().padStart(7, "0").slice(0, decimals);
  return `${whole.toLocaleString("en-US")}${decimals > 0 ? "." + fracStr : ""}`;
}

/** Convert a user-typed USDC string ("1000.5") to the scaled bigint (10000005000000n). */
export function parseUsdc(input: string): bigint {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) throw new Error("invalid amount");
  const negative = trimmed.startsWith("-");
  const stripped = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ""] = stripped.split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  const scaled = BigInt(whole) * USDC_UNIT + BigInt(fracPadded);
  return negative ? -scaled : scaled;
}

export function shortAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
