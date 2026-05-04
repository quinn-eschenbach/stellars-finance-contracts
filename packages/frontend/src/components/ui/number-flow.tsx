import NumberFlow from "@number-flow/react";
import { cn, descale, priceDecimals } from "@/lib/utils";

interface FlowProps {
  /** Protocol-scaled bigint/string (10^7). Pass a `number` to skip descaling. */
  value: bigint | string | number;
  /**
   * Fraction digits in the rendered output. Default 2 for amounts; pass
   * "adaptive" for prices to scale precision with magnitude (XLM at $0.16
   * shows 4dp, BTC at $95k shows 2dp).
   */
  decimals?: number | "adaptive";
  /** Forwarded to NumberFlow `format.signDisplay`. */
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  className?: string;
}

/** Animated USD currency value (e.g. `$1,234.56`). */
export function NumberFlowUsd({ value, decimals = 2, signDisplay = "auto", className }: FlowProps) {
  const dp = decimals === "adaptive" ? priceDecimals(value) : decimals;
  return (
    <NumberFlow
      value={descale(value)}
      format={{
        style: "currency",
        currency: "USD",
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
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
