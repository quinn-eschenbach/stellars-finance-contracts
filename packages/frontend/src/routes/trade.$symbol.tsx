import { createFileRoute } from "@tanstack/react-router";
import { useMarket, usePositions, usePrices } from "@/api/hooks";
import { useStreamMarket, useStreamPositions, useStreamPrices } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderForm } from "@/components/trade/OrderForm";
import { PositionRow } from "@/components/trade/PositionRow";
import { useAddress } from "@/wallet/WalletProvider";
import { formatPrice, formatUsdc } from "@/lib/utils";

export const Route = createFileRoute("/trade/$symbol")({
  component: TradePage,
});

function TradePage() {
  const { symbol } = Route.useParams();
  const address = useAddress();

  const market = useMarket(symbol);
  const prices = usePrices();
  const positions = usePositions(address);
  useStreamMarket(symbol);
  useStreamPrices();
  useStreamPositions(address);

  const markPrice = prices.data?.find((p) => p.symbol === symbol)?.price;
  const myPositions = (positions.data ?? []).filter((p) => p.symbol === symbol);
  const maxLeverage = market.data?.max_leverage ? Number(market.data.max_leverage) : 20;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{symbol}</h1>
        <span className="font-mono text-xl">{markPrice ? `$${formatPrice(markPrice)}` : "—"}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
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
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              {market.data && (
                <>
                  <Stat label="Long OI" value={`$${formatUsdc(market.data.long_open_interest)}`} />
                  <Stat label="Short OI" value={`$${formatUsdc(market.data.short_open_interest)}`} />
                  <Stat label="Max leverage" value={`${market.data.max_leverage}x`} />
                  <Stat label="Mark unrealized" value={`$${formatUsdc(market.data.market_unrealized_pnl)}`} />
                </>
              )}
            </CardContent>
          </Card>

          {address && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">My positions on {symbol}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {myPositions.length === 0 && (
                  <p className="text-sm text-muted-foreground">No open positions on this market.</p>
                )}
                {myPositions.map((p) => (
                  <PositionRow key={p.id} position={p} markPrice={markPrice} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Order</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderForm symbol={symbol} markPrice={markPrice} maxLeverage={maxLeverage} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col font-mono">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
