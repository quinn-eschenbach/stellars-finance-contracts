import type { ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Gauge, Layers, ShieldCheck, Zap } from "lucide-react";
import { useMarkets, usePrices, useVault } from "@/api/hooks";
import { useStreamPrices } from "@/api/sse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberFlowPlain, NumberFlowUsd } from "@/components/ui/number-flow";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const markets = useMarkets();
  const vault = useVault();
  const prices = usePrices();
  useStreamPrices();

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));
  const totalOi = (markets.data ?? []).reduce(
    (acc, m) => acc + BigInt(m.long_open_interest) + BigInt(m.short_open_interest),
    0n,
  );
  const featured = (markets.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(BigInt(b.long_open_interest) + BigInt(b.short_open_interest)) -
        Number(BigInt(a.long_open_interest) + BigInt(a.short_open_interest)),
    )
    .slice(0, 3);

  return (
    <div className="space-y-20 pb-16">
      <Hero />

      <StatsStrip
        tvl={vault.data?.total_assets}
        openInterest={totalOi.toString()}
        marketCount={markets.data?.length ?? 0}
      />

      <Features />

      <FeaturedMarkets featured={featured} priceBySymbol={priceBySymbol} />

      <ClosingCta />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      </div>
      <div className="space-y-8 py-16 text-center md:py-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bull" />
          Live on Stellar testnet
        </div>
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          Perpetuals, settled at the{" "}
          <span className="bg-gradient-to-r from-primary to-bull bg-clip-text text-transparent">
            speed of Stellar
          </span>
        </h1>
        <p className="mx-auto max-w-xl text-balance text-base text-muted-foreground md:text-lg">
          Trade up to 200× leverage against a community-owned LP vault. Sub-second
          finality, sub-cent fees, fully on-chain.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/markets">
              Launch app
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/vault">Provide liquidity</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function StatsStrip({
  tvl,
  openInterest,
  marketCount,
}: {
  tvl?: string;
  openInterest: string;
  marketCount: number;
}) {
  return (
    <section>
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
        <Stat
          label="Total value locked"
          value={tvl ? <NumberFlowUsd value={tvl} decimals={0} /> : "—"}
        />
        <Stat label="Open interest" value={<NumberFlowUsd value={openInterest} decimals={0} />} />
        <Stat label="Live markets" value={<NumberFlowPlain value={marketCount} />} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-card px-6 py-6">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Features() {
  const items = [
    {
      icon: Zap,
      title: "Sub-second finality",
      body: "Stellar's 5-second close time means orders, liquidations, and PnL settle before you can second-guess them.",
    },
    {
      icon: Gauge,
      title: "Up to 200× leverage",
      body: "Per-market leverage caps with continuous funding and borrow rates that rebalance long/short demand.",
    },
    {
      icon: ShieldCheck,
      title: "Median oracle pricing",
      body: "Multi-source SEP-40 aggregation with deviation guards — no single feed can move the mark.",
    },
    {
      icon: Layers,
      title: "ERC-4626 LP vault",
      body: "Anyone can underwrite the pool and earn the spread of trader losses, borrow fees, and funding.",
    },
  ];
  return (
    <section className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Built for serious size</h2>
        <p className="text-muted-foreground">A perp DEX engineered around Stellar's settlement guarantees.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader className="pb-3">
              <Icon className="h-5 w-5 text-primary" />
              <CardTitle className="pt-3 text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function FeaturedMarkets({
  featured,
  priceBySymbol,
}: {
  featured: ReturnType<typeof useMarkets>["data"] extends infer T
    ? T extends Array<infer R>
      ? R[]
      : never
    : never;
  priceBySymbol: Map<string, string>;
}) {
  if (!featured.length) return null;
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Featured markets</h2>
        <Link to="/markets" className="text-sm text-muted-foreground hover:text-foreground">
          View all →
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {featured.map((m) => {
          const price = priceBySymbol.get(m.symbol);
          const oi = BigInt(m.long_open_interest) + BigInt(m.short_open_interest);
          return (
            <Link key={m.symbol} to="/trade/$symbol" params={{ symbol: m.symbol }} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{m.symbol}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="font-mono text-2xl tabular-nums">
                    {price ? <NumberFlowUsd value={price} /> : "—"}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      OI <NumberFlowUsd value={oi.toString()} decimals={0} />
                    </span>
                    <span>{m.max_leverage || "—"}× max</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="rounded-xl border border-border bg-card/40 px-6 py-12 text-center md:px-12">
      <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Ready to trade?</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Connect a Freighter wallet, claim testnet USDC from the faucet, and open your first position.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link to="/markets">
            Open the app
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link to="/faucet">Get testnet USDC</Link>
        </Button>
      </div>
    </section>
  );
}
