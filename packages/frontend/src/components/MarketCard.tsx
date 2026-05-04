import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { CSSProperties } from "react";
import type { MarketRow } from "@/api/types";
import { Card } from "@/components/ui/card";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { BiasBar } from "@/components/ui/bias-bar";

interface MarketCardProps {
  market: MarketRow;
  /** Live price (protocol-scaled). Optional — renders "—" while loading. */
  price?: string;
  /** Forwarded to Card; lets callers add per-card animation delays. */
  style?: CSSProperties;
  className?: string;
}

export function MarketCard({ market, price, style, className }: MarketCardProps) {
  return (
    <Link
      to="/trade/$symbol"
      params={{ symbol: market.symbol }}
      className="block focus-visible:outline-none"
    >
      <Card
        className={`group/card cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover ${className ?? ""}`}
        style={style}
      >
        <div className="relative z-10 flex items-center justify-between gap-3 px-5 pt-5">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl leading-none tracking-tightest text-foreground">
              {market.symbol}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/60">
              Perp
            </span>
          </div>
          <div className="flex items-center gap-2">
            {market.max_leverage ? (
              <span className="rounded-full border border-border/40 bg-card/40 px-2 py-0.5 font-mono text-[10px] tabular-nums uppercase tracking-[0.14em] text-muted-foreground/80">
                {market.max_leverage}× max
              </span>
            ) : null}
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-all group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5 group-hover/card:text-ember" />
          </div>
        </div>
        <div className="relative z-10 px-5 pb-5 pt-4">
          <div className="font-mono text-[32px] leading-none tabular-nums tracking-tight text-foreground">
            {price ? <NumberFlowUsd value={price} decimals="adaptive" /> : "—"}
          </div>
          <BiasBar
            longOi={market.long_open_interest}
            shortOi={market.short_open_interest}
            className="mt-5"
          />
        </div>
      </Card>
    </Link>
  );
}
