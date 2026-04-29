import { createFileRoute } from "@tanstack/react-router";
import { useVault } from "@/api/hooks";
import { useStreamVault } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsdc } from "@/lib/utils";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
});

function VaultPage() {
  const vault = useVault();
  useStreamVault();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">State</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm font-mono">
          {vault.data && (
            <>
              <Row label="Total assets" value={`$${formatUsdc(vault.data.total_assets)}`} />
              <Row label="Free liquidity" value={`$${formatUsdc(vault.data.free_liquidity)}`} />
              <Row label="Reserved" value={`$${formatUsdc(vault.data.reserved_usdc)}`} />
              <Row label="Net trader PnL" value={`$${formatUsdc(vault.data.net_global_trader_pnl)}`} />
              <Row label="Unclaimed fees" value={`$${formatUsdc(vault.data.unclaimed_fees)}`} />
              <Row label="Paused" value={vault.data.is_paused ? "yes" : "no"} />
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Deposit / withdraw flows wire up in the next pass.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
