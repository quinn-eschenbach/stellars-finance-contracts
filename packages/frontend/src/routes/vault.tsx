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
    <div className="space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/30 pb-5">
        <div className="space-y-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Liquidity
          </span>
          <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
            Vault
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            ERC-4626 LP pool that underwrites every trade. Earn the spread of trader losses,
            borrow fees, and funding.
          </p>
        </div>
        {vault.data?.is_paused && (
          <div className="pill border-bear/40 bg-bear/10 font-mono text-[10px] uppercase tracking-[0.22em] text-bear">
            <span className="h-1.5 w-1.5 rounded-full bg-bear" />
            Paused
          </div>
        )}
      </header>

      {/* Big TVL hero strip */}
      {vault.data && (
        <div className="grid gap-3 md:grid-cols-3">
          <HeroStat
            label="Total assets"
            value={<NumberFlowUsd value={vault.data.total_assets} decimals={0} />}
            emphasis
          />
          <HeroStat
            label="Idle funds"
            value={<NumberFlowUsd value={vault.data.free_liquidity} decimals={0} />}
          />
          <HeroStat
            label="Active funds"
            value={<NumberFlowUsd value={vault.data.reserved_usdc} decimals={0} />}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Vault state</CardTitle>
          </CardHeader>
          <CardContent>
            {vault.data && (
              <div className="space-y-3 font-mono text-sm">
                <Row label="Total assets" value={<NumberFlowUsd value={vault.data.total_assets} />} />
                <div className="hairline" />
                <Row label="Idle funds" value={<NumberFlowUsd value={vault.data.free_liquidity} />} />
                <Row label="Active funds" value={<NumberFlowUsd value={vault.data.reserved_usdc} />} />
                <div className="hairline" />
                <Row
                  label="Net trader PnL"
                  value={
                    <NumberFlowUsd
                      value={vault.data.net_global_trader_pnl}
                      signDisplay="exceptZero"
                    />
                  }
                  tone="muted"
                />
                <Row label="Unclaimed fees" value={<NumberFlowUsd value={vault.data.unclaimed_fees} />} />
                <Row
                  label="Status"
                  value={
                    <span
                      className={
                        vault.data.is_paused
                          ? "rounded-full border border-bear/40 bg-bear/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-bear"
                          : "rounded-full border border-bull/30 bg-bull/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-bull"
                      }
                    >
                      {vault.data.is_paused ? "paused" : "active"}
                    </span>
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provide liquidity</CardTitle>
            <p className="text-[11px] text-muted-foreground/80">Deposit USDC · receive vault shares</p>
          </CardHeader>
          <CardContent>
            <VaultActions />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <Card className={emphasis ? "ring-1 ring-ember/20" : undefined}>
      <CardContent className="space-y-2 px-5 pb-5 pt-5">
        <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
          {label}
        </span>
        <span
          className={
            emphasis
              ? "block font-display text-4xl tracking-tightest text-foreground md:text-5xl"
              : "block font-display text-3xl tracking-tightest text-foreground md:text-4xl"
          }
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "muted";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </span>
      <span className={tone === "muted" ? "tabular-nums text-foreground/80" : "tabular-nums"}>
        {value}
      </span>
    </div>
  );
}
