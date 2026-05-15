import { createFileRoute } from "@tanstack/react-router";
import { useMarkets, usePrices, useVault } from "@/api/hooks";
import { useStreamPrices } from "@/api/sse";
import { Card, CardContent } from "@/components/ui/card";
import { NumberFlowUsd, NumberFlowPlain } from "@/components/ui/number-flow";
import type { MarketRow } from "@/api/types";
import { cn, descale, formatPrice, formatUsdcCompact, priceDecimals, USDC_UNIT } from "@/lib/utils";

export const Route = createFileRoute("/insights")({
  component: InsightsPage,
});

function InsightsPage() {
  const markets = useMarkets();
  const vault = useVault();
  const prices = usePrices();
  useStreamPrices();

  const marketRows = markets.data ?? [];
  const totalLongOi = sumScaled(marketRows.map((m) => m.long_open_interest));
  const totalShortOi = sumScaled(marketRows.map((m) => m.short_open_interest));
  const totalOi = totalLongOi + totalShortOi;
  const totalMarketPnl = sumScaled(marketRows.map((m) => m.market_unrealized_pnl));

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));

  return (
    <div className="space-y-12 animate-fade-up pb-16">
      <header className="space-y-3 border-b border-border/30 pb-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Insights · Hidden
          </span>
          <span className="h-1 w-1 rounded-full bg-ember/70" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60">
            internal
          </span>
        </div>
        <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
          Beneath the <span className="italic text-foreground/80">surface</span>
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Protocol-wide telemetry — open interest, fee flow, trader PnL, and per-market
          indices. Refreshes live with the price stream.
        </p>
      </header>

      <Section
        eyebrow="01"
        title="Protocol overview"
        sub="Aggregate state across every market and the LP vault."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="TVL (vault assets)"
            value={
              vault.data ? <NumberFlowUsd value={vault.data.total_assets} decimals={0} /> : "—"
            }
            tone="default"
          />
          <Kpi
            label="Total open interest"
            value={<NumberFlowUsd value={totalOi.toString()} decimals={0} />}
            tone="default"
            sub={
              <span className="font-mono text-[10px] tabular-nums uppercase tracking-[0.16em] text-muted-foreground/60">
                <span className="text-bull/80">L {formatUsdcCompact(totalLongOi)}</span>
                <span className="mx-1.5 text-muted-foreground/40">/</span>
                <span className="text-bear/80">S {formatUsdcCompact(totalShortOi)}</span>
              </span>
            }
          />
          <Kpi
            label="Net trader PnL"
            value={
              vault.data ? (
                <NumberFlowUsd
                  value={vault.data.net_global_trader_pnl}
                  decimals={0}
                  signDisplay="exceptZero"
                />
              ) : (
                "—"
              )
            }
            tone={
              vault.data
                ? BigInt(vault.data.net_global_trader_pnl) >= 0n
                  ? "bull"
                  : "bear"
                : "default"
            }
          />
          <Kpi
            label="Unclaimed fees"
            value={
              vault.data ? <NumberFlowUsd value={vault.data.unclaimed_fees} decimals={2} /> : "—"
            }
            tone="ember"
          />
        </div>
      </Section>

      <Section
        eyebrow="02"
        title="Per-market breakdown"
        sub="Open interest, unrealized PnL, and average entry prices for each perpetual."
      >
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-card/40 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  <Th align="left">Market</Th>
                  <Th align="right">Mark</Th>
                  <Th align="right">Long OI</Th>
                  <Th align="right">Short OI</Th>
                  <Th align="right">Imbalance</Th>
                  <Th align="right">Unrealized PnL</Th>
                  <Th align="right">Avg long entry</Th>
                  <Th align="right">Avg short entry</Th>
                  <Th align="right">Max lev</Th>
                </tr>
              </thead>
              <tbody>
                {marketRows.map((m) => (
                  <MarketRowDetail
                    key={m.symbol}
                    market={m}
                    markPrice={priceBySymbol.get(m.symbol)}
                  />
                ))}
                {marketRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60"
                    >
                      No markets yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section
        eyebrow="03"
        title="Indices"
        sub="Borrow and funding indices accrue on each interaction. Larger gaps → more accumulated cost."
      >
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-card/40 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  <Th align="left">Market</Th>
                  <Th align="right">Borrow index</Th>
                  <Th align="right">Funding index</Th>
                  <Th align="right">Last update</Th>
                </tr>
              </thead>
              <tbody>
                {marketRows.map((m) => (
                  <tr
                    key={m.symbol}
                    className="border-b border-border/20 transition-colors hover:bg-card/30"
                  >
                    <Td align="left">
                      <span className="font-display text-base tracking-tightest text-foreground">
                        {m.symbol}
                      </span>
                    </Td>
                    <Td align="right">{formatIndex(m.acc_borrow_index)}</Td>
                    <Td align="right">{formatIndex(m.acc_funding_index)}</Td>
                    <Td align="right">
                      <span className="text-muted-foreground/80">
                        {formatLedger(m.last_index_update)}
                      </span>
                    </Td>
                  </tr>
                ))}
                {marketRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60"
                    >
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section
        eyebrow="04"
        title="Vault detail"
        sub="LP-side balance sheet — what's deployed, active as margin, accrued, and idle."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Total assets"
            value={
              vault.data ? <NumberFlowUsd value={vault.data.total_assets} decimals={2} /> : "—"
            }
          />
          <Kpi
            label="Active funds (margin)"
            value={
              vault.data ? <NumberFlowUsd value={vault.data.reserved_usdc} decimals={2} /> : "—"
            }
            tone="default"
          />
          <Kpi
            label="Idle funds"
            value={
              vault.data ? <NumberFlowUsd value={vault.data.free_liquidity} decimals={2} /> : "—"
            }
            tone="bull"
          />
          <Kpi
            label="LP shares"
            value={
              vault.data ? (
                <NumberFlowPlain value={descale(vault.data.total_shares, USDC_UNIT)} />
              ) : (
                "—"
              )
            }
            tone="default"
            sub={
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">
                {vault.data?.is_paused ? (
                  <span className="text-bear">paused</span>
                ) : (
                  <span className="text-bull/80">healthy</span>
                )}
              </span>
            }
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-6 border-b border-border/20 pb-3">
        <div className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground/60">
            § {eyebrow}
          </span>
          <h2 className="font-display text-3xl tracking-tightest text-foreground md:text-4xl">
            {title}
          </h2>
        </div>
        {sub && (
          <p className="hidden max-w-sm text-right text-xs leading-relaxed text-muted-foreground/80 md:block">
            {sub}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "bull" | "bear" | "ember";
}) {
  const valueClass =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : tone === "ember"
          ? "text-ember"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="space-y-2 px-5 py-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
          {label}
        </span>
        <div
          className={cn(
            "font-mono text-[26px] leading-none tabular-nums tracking-tight",
            valueClass,
          )}
        >
          {value}
        </div>
        {sub && <div className="pt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" }) {
  return (
    <th
      className={cn(
        "px-4 py-3 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 tabular-nums text-foreground/90",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

function MarketRowDetail({
  market,
  markPrice,
}: {
  market: MarketRow;
  markPrice?: string;
}) {
  const long = BigInt(market.long_open_interest);
  const short = BigInt(market.short_open_interest);
  const total = long + short;
  const imbalance = total > 0n ? Number((long - short) * 10000n / total) / 100 : 0;
  const pnl = BigInt(market.market_unrealized_pnl);
  const imbalanceTone = imbalance > 5 ? "text-bull" : imbalance < -5 ? "text-bear" : "text-muted-foreground/80";
  const pnlTone = pnl > 0n ? "text-bull" : pnl < 0n ? "text-bear" : "text-muted-foreground/80";

  return (
    <tr className="border-b border-border/20 transition-colors hover:bg-card/30">
      <Td align="left">
        <span className="font-display text-base tracking-tightest text-foreground">
          {market.symbol}
        </span>
      </Td>
      <Td align="right">{markPrice ? <NumberFlowUsd value={markPrice} decimals="adaptive" /> : "—"}</Td>
      <Td align="right">
        <NumberFlowUsd value={market.long_open_interest} decimals={0} />
      </Td>
      <Td align="right">
        <NumberFlowUsd value={market.short_open_interest} decimals={0} />
      </Td>
      <Td align="right" className={imbalanceTone}>
        {total > 0n ? `${imbalance >= 0 ? "+" : ""}${imbalance.toFixed(2)}%` : "—"}
      </Td>
      <Td align="right" className={pnlTone}>
        <NumberFlowUsd value={market.market_unrealized_pnl} decimals={0} signDisplay="exceptZero" />
      </Td>
      <Td align="right">
        {long > 0n ? (
          `$${formatPrice(market.global_long_avg_price, priceDecimals(market.global_long_avg_price))}`
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </Td>
      <Td align="right">
        {short > 0n ? (
          `$${formatPrice(market.global_short_avg_price, priceDecimals(market.global_short_avg_price))}`
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </Td>
      <Td align="right">{market.max_leverage}×</Td>
    </tr>
  );
}

function sumScaled(values: string[]): bigint {
  return values.reduce((acc, v) => acc + BigInt(v), 0n);
}

function formatIndex(scaled: string): string {
  // Indices are 10^14 scaled. Render as decimal with 6 places of precision so
  // small accruals are still visible at a glance.
  const v = BigInt(scaled);
  const whole = v / 100_000_000_000_000n;
  const frac = v % 100_000_000_000_000n;
  const fracStr = frac.toString().padStart(14, "0").slice(0, 6);
  return `${whole}.${fracStr}`;
}

function formatLedger(scaled: string): string {
  // last_index_update is a unix-seconds timestamp string.
  const ts = Number(scaled);
  if (!Number.isFinite(ts) || ts === 0) return "—";
  const ageSec = Math.floor(Date.now() / 1000) - ts;
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}
