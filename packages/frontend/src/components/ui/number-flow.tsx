import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/utils";

const PRICE_UNIT = 10_000_000; // shared with formatUsdc / formatPrice

/**
 * Convert a protocol-scaled bigint (10^7) into a JS number for display.
 * USDC and price scaling are both 10^7. JS doubles are exact up to 2^53,
 * so values up to ~$9e8 raw are precise; beyond that the trailing
 * fractional digits may drift, which is fine for live-ticker display.
 */
function descale(value: bigint | string | number): number {
  if (typeof value === "number") return value;
  const big = typeof value === "string" ? BigInt(value) : value;
  // Split into integer / fractional parts so very large bigints don't lose
  // the fractional component when cast to Number directly.
  const whole = big / BigInt(PRICE_UNIT);
  const frac = big % BigInt(PRICE_UNIT);
  const sign = big < 0n ? -1 : 1;
  return Number(whole) + (sign * Number(frac < 0n ? -frac : frac)) / PRICE_UNIT;
}

interface FlowProps {
  /** Protocol-scaled bigint/string (10^7). Pass a `number` to skip descaling. */
  value: bigint | string | number;
  /** Fraction digits in the rendered output. Default 2. */
  decimals?: number;
  /** Forwarded to NumberFlow `format.signDisplay`. */
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  className?: string;
}

/** Animated USD currency value (e.g. `$1,234.56`). */
export function NumberFlowUsd({ value, decimals = 2, signDisplay = "auto", className }: FlowProps) {
  return (
    <NumberFlow
      value={descale(value)}
      format={{
        style: "currency",
        currency: "USD",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        signDisplay,
      }}
      className={cn("tabular-nums", className)}
    />
  );
}

interface PlainFlowProps {
  value: number;
  decimals?: number;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  suffix?: string;
  className?: string;
}

/** Animated plain decimal (no currency formatting). Used for counts, multipliers, etc. */
export function NumberFlowPlain({
  value,
  decimals = 0,
  signDisplay = "auto",
  suffix,
  className,
}: PlainFlowProps) {
  return (
    <span className={cn("tabular-nums", className)}>
      <NumberFlow
        value={value}
        format={{
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          signDisplay,
        }}
      />
      {suffix}
    </span>
  );
}
