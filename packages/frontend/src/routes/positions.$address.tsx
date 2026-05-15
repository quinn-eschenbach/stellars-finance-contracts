import { createFileRoute } from "@tanstack/react-router";
import { usePositions, usePrices } from "@/api/hooks";
import { useMarketTick } from "@/api/marketTick";
import { useStreamPositions, useStreamPrices } from "@/api/sse";
import { useAddress } from "@/wallet/WalletProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PositionRow } from "@/components/trade/PositionRow";
import { shortAddress } from "@/lib/utils";
import type { PositionRow as PositionRowData } from "@/api/types";

export const Route = createFileRoute("/positions/$address")({
  component: PositionsPage,
});

function PositionsPage() {
  const { address } = Route.useParams();
  const me = useAddress();
  const isMe = !!me && me === address;

  const positions = usePositions(address);
  const prices = usePrices();
  useStreamPositions(address);
  useStreamPrices();

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));
  const count = positions.data?.length ?? 0;

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
    </div>
  );
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
