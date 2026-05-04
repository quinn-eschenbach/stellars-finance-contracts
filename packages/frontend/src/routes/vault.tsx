import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useVault } from "@/api/hooks";
import { useStreamVault } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { VaultActions } from "@/components/vault/VaultActions";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
});

function VaultPage() {
  const vault = useVault();
  useStreamVault();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vault state</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 font-mono text-sm">
          {vault.data && (
            <>
              <Row label="Total assets" value={<NumberFlowUsd value={vault.data.total_assets} />} />
              <Row label="Free liquidity" value={<NumberFlowUsd value={vault.data.free_liquidity} />} />
              <Row label="Reserved" value={<NumberFlowUsd value={vault.data.reserved_usdc} />} />
              <Row
                label="Net trader PnL"
                value={<NumberFlowUsd value={vault.data.net_global_trader_pnl} signDisplay="exceptZero" />}
              />
              <Row label="Unclaimed fees" value={<NumberFlowUsd value={vault.data.unclaimed_fees} />} />
              <Row label="Paused" value={vault.data.is_paused ? "yes" : "no"} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provide liquidity</CardTitle>
        </CardHeader>
        <CardContent>
          <VaultActions />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
