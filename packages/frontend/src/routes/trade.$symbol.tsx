import { createFileRoute } from "@tanstack/react-router";
import { useMarket, usePrices } from "@/api/hooks";
import { useStreamMarket, useStreamPrices } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice, formatUsdc } from "@/lib/utils";

export const Route = createFileRoute("/trade/$symbol")({
  component: TradePage,
});

function TradePage() {
  const { symbol } = Route.useParams();
  const market = useMarket(symbol);
  const prices = usePrices();
  useStreamMarket(symbol);
  useStreamPrices();

  const price = prices.data?.find((p) => p.symbol === symbol)?.price;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{symbol}</h1>
        <span className="font-mono text-xl">{price ? `$${formatPrice(price)}` : "—"}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="min-h-[400px]">
          <CardHeader>
            <CardTitle className="text-sm">Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
              Chart placeholder — wire lightweight-charts in next pass.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Market</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {market.data && (
              <>
                <Row label="Long OI" value={`$${formatUsdc(market.data.long_open_interest)}`} />
                <Row label="Short OI" value={`$${formatUsdc(market.data.short_open_interest)}`} />
                <Row label="Max leverage" value={`${market.data.max_leverage}x`} />
                <Row label="Mark unrealized" value={`$${formatUsdc(market.data.market_unrealized_pnl)}`} />
              </>
            )}
          </CardContent>
        </Card>
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
