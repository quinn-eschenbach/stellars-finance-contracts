import { createFileRoute } from "@tanstack/react-router";
import { Wallet2 } from "lucide-react";
import { useAddress } from "@/wallet/WalletProvider";
import { usePositions, usePrices } from "@/api/hooks";
import { useStreamPositions, useStreamPrices } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PositionRow } from "@/components/trade/PositionRow";

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
});

function PortfolioPage() {
  const address = useAddress();
  const positions = usePositions(address);
  const prices = usePrices();
  useStreamPositions(address);
  useStreamPrices();

  if (!address) {
    return (
      <div className="mx-auto max-w-md animate-fade-up">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full border border-border/50 bg-card/40 text-muted-foreground">
              <Wallet2 className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <h2 className="font-display text-2xl tracking-tightest text-foreground">No wallet</h2>
              <p className="max-w-xs text-sm text-muted-foreground">
                Connect a Freighter wallet to view your positions and PnL.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));
  const count = positions.data?.length ?? 0;

  return (
    <div className="space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/30 pb-5">
        <div className="space-y-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Account
          </span>
          <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
            Portfolio
          </h1>
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
              <PositionRow key={p.id} position={p} markPrice={priceBySymbol.get(p.symbol)} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
