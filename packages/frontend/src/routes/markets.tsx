import { createFileRoute } from "@tanstack/react-router";
import { useMarkets, usePrices } from "@/api/hooks";
import { useStreamPrices } from "@/api/sse";
import { MarketCard } from "@/components/MarketCard";

export const Route = createFileRoute("/markets")({
  component: MarketsList,
});

function MarketsList() {
  const markets = useMarkets();
  const prices = usePrices();
  useStreamPrices();

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));

  return (
    <div className="space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/30 pb-5">
        <div className="space-y-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Index
          </span>
          <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
            Markets
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Perpetual contracts settled on Stellar.{" "}
            <span className="text-foreground/80">Sub-second finality, sub-cent fees.</span>
          </p>
        </div>
        <div className="pill font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ember-pulse rounded-full bg-bull/80" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-bull" />
          </span>
          {markets.data?.length ?? 0} live
        </div>
      </header>

      {markets.isLoading && (
        <div className="rounded-xl border border-border/50 bg-card/30 px-4 py-6 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Loading markets…
        </div>
      )}
      {markets.error && (
        <div className="text-destructive">Failed to load markets.</div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(markets.data ?? []).map((m) => (
          <MarketCard key={m.symbol} market={m} price={priceBySymbol.get(m.symbol)} />
        ))}
      </div>
    </div>
  );
}
