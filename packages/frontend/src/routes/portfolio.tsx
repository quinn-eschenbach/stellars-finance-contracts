import { createFileRoute } from "@tanstack/react-router";
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
    return <div className="text-muted-foreground">Connect a wallet to view your portfolio.</div>;
  }

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Open positions</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.isLoading && <div className="text-muted-foreground">Loading…</div>}
          {positions.data?.length === 0 && (
            <div className="text-sm text-muted-foreground">No open positions.</div>
          )}
          <div className="space-y-2">
            {(positions.data ?? []).map((p) => (
              <PositionRow key={p.id} position={p} markPrice={priceBySymbol.get(p.symbol)} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
