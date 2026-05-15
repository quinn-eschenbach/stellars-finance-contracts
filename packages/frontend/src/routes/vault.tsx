import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useVault, useVaultProfitability } from "@/api/hooks";
import { useStreamVault } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { VaultActions } from "@/components/vault/VaultActions";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
});

function VaultPage() {
  const vault = useVault();
  const profitability = useVaultProfitability(30);
  useStreamVault();

  // 30d total = trading + fees. Both are bigints (× 10^7). Render the sum
  // as the headline number with the breakdown below it.
  const profitTotal = profitability.data
    ? (BigInt(profitability.data.lp_net_from_trades) +
        BigInt(profitability.data.lp_net_from_fees)).toString()
    : null;

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
              <div className="space-y-7">
                {/* Holdings group: TVL as the headline, idle/active as sub-rows */}
                <StatGroup
                  label="Total assets"
                  value={<NumberFlowUsd value={vault.data.total_assets} decimals={2} />}
                  breakdown={[
                    {
                      label: "Idle funds",
                      value: <NumberFlowUsd value={vault.data.free_liquidity} />,
                    },
                    {
                      label: "Active funds",
                      value: <NumberFlowUsd value={vault.data.reserved_usdc} />,
                    },
                  ]}
                />

                {/* Earnings group: combined 30d profit, broken into trading + fees */}
                <StatGroup
                  label="30-day profit"
                  value={
                    profitTotal !== null ? (
                      <NumberFlowUsd value={profitTotal} signDisplay="exceptZero" decimals={2} />
                    ) : (
                      "—"
                    )
                  }
                  valueTone={
                    profitTotal !== null
                      ? BigInt(profitTotal) > 0n
                        ? "bull"
                        : BigInt(profitTotal) < 0n
                          ? "bear"
                          : "muted"
                      : "muted"
                  }
                  breakdown={[
                    {
                      label: "Trading",
                      value: profitability.data ? (
                        <NumberFlowUsd
                          value={profitability.data.lp_net_from_trades}
                          signDisplay="exceptZero"
                        />
                      ) : (
                        "—"
                      ),
                    },
                    {
                      label: "Fees",
                      value: profitability.data ? (
                        <NumberFlowUsd value={profitability.data.lp_net_from_fees} />
                      ) : (
                        "—"
                      ),
                    },
                  ]}
                />

                <div className="flex items-center justify-between border-t border-border/40 pt-4">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
                    Status
                  </span>
                  <span
                    className={
                      vault.data.is_paused
                        ? "rounded-full border border-bear/40 bg-bear/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bear"
                        : "rounded-full border border-bull/30 bg-bull/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bull"
                    }
                  >
                    {vault.data.is_paused ? "paused" : "active"}
                  </span>
                </div>
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

type StatTone = "default" | "bull" | "bear" | "muted";

/**
 * Display-grade balance-sheet row: an emphasized headline number with smaller
 * mono sub-rows underneath. The headline label sits above the value so the
 * eye reads label → big number → breakdown without bouncing horizontally
 * across "label: value" pairs of equal weight.
 */
function StatGroup({
  label,
  value,
  valueTone = "default",
  breakdown,
}: {
  label: string;
  value: ReactNode;
  valueTone?: StatTone;
  breakdown: Array<{ label: string; value: ReactNode }>;
}) {
  const valueClass =
    valueTone === "bull"
      ? "text-bull"
      : valueTone === "bear"
        ? "text-bear"
        : valueTone === "muted"
          ? "text-foreground/80"
          : "text-foreground";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
          {label}
        </span>
        <span
          className={`font-display text-3xl tabular-nums tracking-tightest md:text-4xl ${valueClass}`}
        >
          {value}
        </span>
      </div>
      <div className="space-y-1 border-t border-border/30 pt-2 pl-3">
        {breakdown.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between font-mono text-[11px]"
          >
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
              {row.label}
            </span>
            <span className="tabular-nums text-foreground/85">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
