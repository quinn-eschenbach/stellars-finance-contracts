import { createFileRoute, Link } from "@tanstack/react-router";
import { usePositions, usePrices, useTrades } from "@/api/hooks";
import { useMarketTick } from "@/api/marketTick";
import { useStreamPositions, useStreamPrices } from "@/api/sse";
import { useAddress } from "@/wallet/WalletProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PositionRow } from "@/components/trade/PositionRow";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { cn, formatPrice, priceDecimals, shortAddress } from "@/lib/utils";
import type { PositionRow as PositionRowData, TradeRow } from "@/api/types";

export const Route = createFileRoute("/positions/$address")({
  component: PositionsPage,
});

function PositionsPage() {
  const { address } = Route.useParams();
  const me = useAddress();
  const isMe = !!me && me === address;

  const positions = usePositions(address);
  const prices = usePrices();
  // Pull recent close-side events; we filter to the three terminal categories
  // (manual close, liquidation, ADL) client-side so a single round-trip covers
  // all three buckets. `decrease` and `order` event_types can be partial — the
  // is_full_close flag distinguishes a wind-down from a true close.
  const closedTrades = useTrades({ trader: address, limit: 100 });
  useStreamPositions(address);
  useStreamPrices();

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));
  const count = positions.data?.length ?? 0;

  const closed = (closedTrades.data ?? []).filter(
    (t) =>
      (t.event_type === "decrease" ||
        t.event_type === "order" ||
        t.event_type === "liquidation" ||
        t.event_type === "adl") &&
      t.is_full_close === true,
  );

  return (
    <div className="space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/30 pb-5">
        <div className="space-y-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {isMe ? "Account" : "Trader"}
          </span>
          <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
            {isMe ? "Positions" : `${shortAddress(address, 6, 4)}`}
          </h1>
          {!isMe && (
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground/70">{address}</p>
          )}
        </div>
        <div className="pill font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {count} open {count === 1 ? "position" : "positions"}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Open positions</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.isLoading && (
            <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-6 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Loading…
            </div>
          )}
          {positions.data?.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/50 bg-background/30 px-4 py-10 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
              No open positions
            </div>
          )}
          <div className="space-y-2.5">
            {(positions.data ?? []).map((p) => (
              <ProjectedPositionRow
                key={p.id}
                position={p}
                markPrice={priceBySymbol.get(p.symbol)}
                readOnly={!isMe}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Closed positions</CardTitle>
        </CardHeader>
        <CardContent>
          {closedTrades.isLoading && (
            <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-6 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Loading…
            </div>
          )}
          {!closedTrades.isLoading && closed.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/50 bg-background/30 px-4 py-10 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
              No closed positions yet
            </div>
          )}
          <div className="space-y-2.5">
            {closed.map((t) => (
              <ClosedPositionRow key={t.id} trade={t} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClosedPositionRow({ trade }: { trade: TradeRow }) {
  const kind = closeKind(trade);
  const pnl = BigInt(trade.pnl);
  const pnlClass =
    pnl > 0n ? "text-bull" : pnl < 0n ? "text-bear" : "text-muted-foreground";
  const isLong = trade.is_long ?? false;
  const dirClass = isLong ? "text-bull" : "text-bear";
  const closedAt = new Date(Number(trade.timestamp) * 1000);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 rounded-xl border border-border/40 bg-background/20 px-4 py-3 transition-colors hover:bg-background/40 md:grid-cols-[140px_1fr_auto] md:items-center">
      <div className="flex items-center gap-3">
        <Link
          to="/trade/$symbol"
          params={{ symbol: trade.symbol }}
          className="font-display text-base tracking-tightest text-foreground hover:text-ember"
        >
          {trade.symbol}
        </Link>
        <span className={cn("font-mono text-[10px] uppercase tracking-[0.18em]", dirClass)}>
          {isLong ? "long" : "short"}
        </span>
      </div>
      <div className="hidden md:flex md:items-center md:gap-6 md:text-xs md:text-muted-foreground/85">
        <CloseStat label="Size" value={<NumberFlowUsd value={trade.size_delta} decimals={0} />} />
        <CloseStat
          label="Entry"
          value={
            BigInt(trade.entry_price) > 0n ? (
              <>${formatPrice(trade.entry_price, priceDecimals(trade.entry_price))}</>
            ) : (
              <span className="text-muted-foreground/40">—</span>
            )
          }
        />
        <CloseStat
          label="Exit"
          value={<>${formatPrice(trade.mark_price, priceDecimals(trade.mark_price))}</>}
        />
        <CloseStat
          label="PnL"
          value={
            <span className={cn("tabular-nums", pnlClass)}>
              <NumberFlowUsd value={trade.pnl} signDisplay="exceptZero" />
            </span>
          }
        />
      </div>
      <div className="flex flex-col items-end gap-1.5 md:items-end">
        <span className={cn("pill font-mono text-[9px] uppercase tracking-[0.2em]", kind.toneClass)}>
          {kind.label}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
          {formatClosedAt(closedAt)}
        </span>
      </div>
    </div>
  );
}

function CloseStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums text-foreground/90">{value}</span>
    </div>
  );
}

function closeKind(t: TradeRow): { label: string; toneClass: string } {
  if (t.event_type === "liquidation") {
    return { label: "Liquidated", toneClass: "border-bear/40 bg-bear/10 text-bear" };
  }
  if (t.event_type === "adl") {
    return { label: "ADL", toneClass: "border-ember/40 bg-ember/10 text-ember" };
  }
  if (t.event_type === "order" && t.is_tp === true) {
    return { label: "Closed · TP", toneClass: "border-bull/30 bg-bull/10 text-bull/90" };
  }
  if (t.event_type === "order") {
    return { label: "Closed · SL", toneClass: "border-border/50 bg-card/40 text-muted-foreground" };
  }
  return { label: "Closed", toneClass: "border-border/50 bg-card/40 text-foreground/85" };
}

function formatClosedAt(d: Date): string {
  const ageSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  if (ageSec < 86400 * 7) return `${Math.floor(ageSec / 86400)}d ago`;
  return d.toLocaleDateString();
}

/**
 * Wrapper that pulls the projected MarketTick for the position's symbol.
 * Calling `useMarketTick` once per row keeps the hook contract simple — the
 * underlying queries are deduplicated by React Query, so n positions on the
 * same symbol still hit the four backing queries exactly once.
 */
function ProjectedPositionRow({
  position,
  markPrice,
  readOnly,
}: {
  position: PositionRowData;
  markPrice?: string;
  readOnly: boolean;
}) {
  const tick = useMarketTick(position.symbol);
  return <PositionRow position={position} markPrice={markPrice} tick={tick} readOnly={readOnly} />;
}
