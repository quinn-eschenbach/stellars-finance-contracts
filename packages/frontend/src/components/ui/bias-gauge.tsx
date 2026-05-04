import { cn } from "@/lib/utils";

interface BiasGaugeProps {
  /** Long open interest, scaled bigint or string. */
  longOi: bigint | string;
  /** Short open interest, scaled bigint or string. */
  shortOi: bigint | string;
  /** Visual size in px. Width = size, height ≈ size * 0.62. */
  size?: number;
  className?: string;
}

/**
 * Bull/bear bias indicator. Half-arc gauge whose needle position is the
 * fraction of long OI in total OI; gradient runs from bear (red) on the
 * left to bull (green) on the right with an amber neutral midpoint.
 *
 * If both sides are zero we render an "—" placeholder rather than guessing.
 */
export function BiasGauge({ longOi, shortOi, size = 132, className }: BiasGaugeProps) {
  const long = typeof longOi === "string" ? BigInt(longOi) : longOi;
  const short = typeof shortOi === "string" ? BigInt(shortOi) : shortOi;
  const total = long + short;

  if (total <= 0n) return <EmptyGauge size={size} className={className} />;

  // Use Number for the ratio — bigint magnitudes don't matter, only the share.
  // Avoid bigint→number overflow by dividing inside bigint as a 4-decimal scale.
  const ratioScaled = Number((long * 10000n) / total);
  const ratio = ratioScaled / 10000; // 0 = all short (bearish), 1 = all long (bullish)
  const pct = Math.round(ratio * 100);

  const { label, tone } = classify(ratio);

  // Arc geometry: half-circle from 180° (left) to 0° (right).
  const w = size;
  const h = Math.round(size * 0.62);
  const stroke = Math.max(7, Math.round(size * 0.085));
  const cx = w / 2;
  const cy = h - stroke / 2 - 2;
  const r = (w - stroke) / 2 - 2;

  const startX = cx - r;
  const startY = cy;
  const endX = cx + r;
  const endY = cy;
  const arcPath = `M ${startX} ${startY} A ${r} ${r} 0 0 1 ${endX} ${endY}`;

  // Needle position along the arc.
  const theta = Math.PI * (1 - ratio); // 180° at ratio=0, 0° at ratio=1
  const dotX = cx + r * Math.cos(theta);
  const dotY = cy - r * Math.sin(theta);

  const labelColor =
    tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-foreground/85";

  // Unique gradient id avoids collisions when many gauges render on a page.
  const gid = `bias-${Math.abs((Number(long & 0xffffn) << 16) | Number(short & 0xffffn)).toString(36)}`;

  return (
    <div className={cn("relative inline-flex flex-col items-center", className)} style={{ width: w }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        aria-label={`${label} bias, ${pct}% long`}
        role="img"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(8 60% 60%)" />
            <stop offset="50%" stopColor="hsl(36 75% 60%)" />
            <stop offset="100%" stopColor="hsl(142 28% 55%)" />
          </linearGradient>
        </defs>
        {/* Track */}
        <path
          d={arcPath}
          fill="none"
          stroke="hsl(30 6% 18%)"
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity={0.55}
        />
        {/* Active gradient arc */}
        <path
          d={arcPath}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Indicator dot — outer halo + inner dot */}
        <circle cx={dotX} cy={dotY} r={stroke / 1.6} fill="hsl(30 8% 5%)" />
        <circle
          cx={dotX}
          cy={dotY}
          r={stroke / 2.6}
          fill="hsl(36 22% 96%)"
          style={{ filter: "drop-shadow(0 0 6px rgba(255,225,180,0.7))" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5">
        <span
          className={cn(
            "font-display text-base leading-none tracking-tightest",
            labelColor,
          )}
        >
          {label}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">
          {pct}% long
        </span>
      </div>
    </div>
  );
}

function classify(ratio: number): { label: string; tone: "bull" | "bear" | "neutral" } {
  // Neutral band ±10% around 0.5; outside that we call it.
  if (ratio >= 0.62) return { label: "Bullish", tone: "bull" };
  if (ratio <= 0.38) return { label: "Bearish", tone: "bear" };
  return { label: "Neutral", tone: "neutral" };
}

function EmptyGauge({ size, className }: { size: number; className?: string }) {
  const w = size;
  const h = Math.round(size * 0.62);
  const stroke = Math.max(7, Math.round(size * 0.085));
  const cx = w / 2;
  const cy = h - stroke / 2 - 2;
  const r = (w - stroke) / 2 - 2;
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <div className={cn("relative inline-flex flex-col items-center", className)} style={{ width: w }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path
          d={arcPath}
          fill="none"
          stroke="hsl(30 6% 18%)"
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity={0.5}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5">
        <span className="font-display text-base leading-none tracking-tightest text-muted-foreground/70">
          —
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
          no OI
        </span>
      </div>
    </div>
  );
}
