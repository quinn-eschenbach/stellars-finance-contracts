import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Protocol scaling — single source of truth for the 10^7 factor that USDC
 * amounts and oracle prices share throughout the contracts. Anything that
 * needs to descale or format a scaled value should import from here.
 */
export const USDC_DECIMALS = 7;
export const PRICE_DECIMALS = 7;
export const USDC_UNIT = 10_000_000n;
export const PRICE_UNIT = 10_000_000n;

/**
 * Convert a protocol-scaled value to a JS number. Splits whole / fractional
 * parts so values past 2^53 raw don't lose the fraction when cast directly.
 * Returns a plain `number`; precision past ~$9e8 raw will drift but that's
 * fine for display.
 */
export function descale(value: bigint | string | number, unit: bigint = PRICE_UNIT): number {
  if (typeof value === "number") return value;
  const big = typeof value === "string" ? BigInt(value) : value;
  const sign = big < 0n ? -1 : 1;
  const abs = big < 0n ? -big : big;
  const whole = abs / unit;
  const frac = abs % unit;
  return sign * (Number(whole) + Number(frac) / Number(unit));
}

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

/**
 * Compact USD formatter ("$1.2M", "$890K", "$42"). Used wherever space is at
 * a premium and exact cents aren't meaningful — leaderboard, KPI strips,
 * imbalance hints. Single-decimal precision keeps things scannable.
 */
export function formatUsdcCompact(scaled: bigint | string, opts: { decimals?: number } = {}): string {
  const dp = opts.decimals ?? 1;
  const usd = descale(scaled, USDC_UNIT);
  const sign = usd < 0 ? "-" : "";
  const abs = Math.abs(usd);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(dp)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(dp)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(dp)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Decimal places to show for a price, adapted to its magnitude. Mirrors
 * what major exchanges do: BTC at $95k uses 2dp, XLM at $0.16 uses 4dp,
 * meme coins at $0.000012 use 8dp. Saves us from showing "0.16" when the
 * meaningful precision is "0.1635".
 */
export function priceDecimals(value: bigint | string | number): number {
  const abs = Math.abs(descale(value));
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  if (abs >= 0.0001) return 6;
  return 8;
}

/** Format a scaled price (USD per BTC, etc) as a display string. */
export function formatPrice(scaled: bigint | string, decimals = 2): string {
  const v = typeof scaled === "string" ? BigInt(scaled) : scaled;
  const whole = v / PRICE_UNIT;
  const frac = v % PRICE_UNIT;
  const fracStr = frac.toString().padStart(7, "0").slice(0, decimals);
  return `${whole.toLocaleString("en-US")}${decimals > 0 ? "." + fracStr : ""}`;
}

/** Convert a user-typed price string to the scaled bigint. Prices and USDC share 10^7 scaling. */
export const parsePrice = (input: string): bigint => parseUsdc(input);

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
