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

  // LP-claimable total. `total_assets` on the contract also carries pending
  // dev/staker `unclaimed_fees` and outstanding trader PnL liability, so it
  // overstates what LPs own; `free_liquidity + reserved_usdc` is the LP NAV
  // that share value tracks against.
  const lpTotal = vault.data
    ? (BigInt(vault.data.free_liquidity) + BigInt(vault.data.reserved_usdc)).toString()
    : null;

  // Mark-to-market basis: every figure here is "what hits LP NAV right now",
  // including the mark-to-market trader-PnL deduction the chain already
  // bakes into `free_liquidity` (the `max(0, net_global_trader_pnl)` term —
  // chain only counts positive trader PnL as a liability; unrealized trader
  // *losses* stay in trader collateral until close).
  const tradingNet =
    vault.data && profitability.data
      ? (() => {
          const pnl = BigInt(vault.data.net_global_trader_pnl);
          const unrealizedToLp = pnl > 0n ? -pnl : 0n;
          return (BigInt(profitability.data.lp_net_from_trades) + unrealizedToLp).toString();
        })()
      : null;

  const profitTotal =
    profitability.data && tradingNet !== null
      ? (BigInt(tradingNet) + BigInt(profitability.data.lp_net_from_fees)).toString()
      : null;

  // Annualize the 30d return into a compounded APY. Naive extrapolation of a
  // single window (no smoothing across windows, no cap at unrealistic values)
  // so the user sees exactly what current activity would yield if it held.
  // Returns null when the vault is empty or we have no profit row yet.
  const apyPercent =
    profitTotal !== null && lpTotal !== null && BigInt(lpTotal) > 0n
      ? (() => {
          // 6-decimal fixed-point ratio so small profits don't round to zero.
          const ratioScaled = (BigInt(profitTotal) * 1_000_000n) / BigInt(lpTotal);
          const ratio = Number(ratioScaled) / 1_000_000;
          // Guard against `(1 + r) <= 0` exploding the power; ratio that
          // negative would mean a full LP wipeout in 30d anyway — clamp.
          if (1 + ratio <= 0) return -100;
          return (Math.pow(1 + ratio, 365 / 30) - 1) * 100;
        })()
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
      {vault.data && lpTotal !== null && (
        <div className="grid gap-3 md:grid-cols-3">
          <HeroStat
            label="Total assets"
            value={<NumberFlowUsd value={lpTotal} decimals={0} />}
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
            {vault.data && lpTotal !== null && (
              <div className="space-y-7">
                {/* Holdings group: TVL as the headline, idle/active as sub-rows */}
                <StatGroup
                  label="Total assets"
                  value={<NumberFlowUsd value={lpTotal} decimals={2} />}
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
                      <NumberFlowUsd
                        value={profitTotal}
                        signDisplay="exceptZero"
                        decimals={2}
                      />
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
                      value:
                        tradingNet !== null ? (
                          <NumberFlowUsd value={tradingNet} signDisplay="exceptZero" />
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
                    ...(apyPercent !== null && apyPercent > 0
                      ? [
                          {
                            label: "APY",
                            value: (
                              <span className="text-bull/85">{formatApy(apyPercent)}</span>
                            ),
                          },
                        ]
                      : []),
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

function formatApy(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "−";
  const abs = Math.abs(pct);
  if (abs >= 1000) return `${sign}${Math.round(abs).toLocaleString()}%`;
  if (abs >= 10) return `${sign}${abs.toFixed(1)}%`;
  return `${sign}${abs.toFixed(2)}%`;
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
      <div className="space-y-1 pt-2">
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
