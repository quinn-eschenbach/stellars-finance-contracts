import { createFileRoute } from "@tanstack/react-router";
import { useAddress } from "@/wallet/WalletProvider";
import { usePositions, usePrices } from "@/api/hooks";
import { useStreamPositions, useStreamPrices } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice, formatUsdc } from "@/lib/utils";

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
          <div className="grid gap-2">
            {(positions.data ?? []).map((p) => {
              const mark = priceBySymbol.get(p.symbol);
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-6 gap-3 rounded-md border border-border p-3 font-mono text-sm"
                >
                  <span>{p.symbol}</span>
                  <span className={p.is_long ? "text-bull" : "text-bear"}>
                    {p.is_long ? "LONG" : "SHORT"}
                  </span>
                  <span>${formatUsdc(p.size)}</span>
                  <span>${formatUsdc(p.collateral)} margin</span>
                  <span>entry ${formatPrice(p.entry_price)}</span>
                  <span>mark {mark ? `$${formatPrice(mark)}` : "—"}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
