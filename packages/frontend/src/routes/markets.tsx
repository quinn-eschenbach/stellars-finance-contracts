import { Link, createFileRoute } from "@tanstack/react-router";
import { useMarkets, usePrices } from "@/api/hooks";
import { useStreamPrices } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice, formatUsdc } from "@/lib/utils";

export const Route = createFileRoute("/markets")({
  component: MarketsList,
});

function MarketsList() {
  const markets = useMarkets();
  const prices = usePrices();
  useStreamPrices();

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="text-sm text-muted-foreground">Trade perpetuals on Stellar.</p>
      </div>

      {markets.isLoading && <div className="text-muted-foreground">Loading…</div>}
      {markets.error && <div className="text-destructive">Failed to load markets.</div>}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(markets.data ?? []).map((m) => {
          const price = priceBySymbol.get(m.symbol);
          return (
            <Link key={m.symbol} to="/trade/$symbol" params={{ symbol: m.symbol }} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{m.symbol}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <Row label="Price" value={price ? `$${formatPrice(price)}` : "—"} />
                  <Row label="Long OI" value={`$${formatUsdc(m.long_open_interest)}`} />
                  <Row label="Short OI" value={`$${formatUsdc(m.short_open_interest)}`} />
                  <Row label="Max leverage" value={`${m.max_leverage || "—"}x`} />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between font-mono">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
