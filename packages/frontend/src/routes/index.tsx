import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Gauge, Layers, ShieldCheck, Zap } from "lucide-react";
import { useMarkets, usePrices, useVault } from "@/api/hooks";
import { useStreamPrices } from "@/api/sse";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumberFlowPlain, NumberFlowUsd } from "@/components/ui/number-flow";
import { MarketCard } from "@/components/MarketCard";

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
    <div className="space-y-24 pb-24">
      <Hero priceBySymbol={priceBySymbol} />

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

function Hero({ priceBySymbol }: { priceBySymbol: Map<string, string> }) {
  // Tiny live ticker — picks up to 4 symbols and shows their prices in the
  // bottom-of-hero pill row. Makes the page feel alive even on first paint.
  const tickers = Array.from(priceBySymbol.entries()).slice(0, 4);

  return (
    <section className="relative pt-10 md:pt-16">
      {/* Local hero glows — denser than the global aurora. The wrapper spans
          the full viewport width (centered, 100vw) instead of the centered
          container, so the colored falloff fades into the page background
          rather than ending at a hard container edge. body has `overflow-x:
          hidden`, so 100vw never produces a horizontal scrollbar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2"
      >
        <div className="absolute left-[8%] top-12 h-[420px] w-[420px] animate-drift-a rounded-full bg-ember/35 blur-[110px]" />
        <div className="absolute left-1/2 top-44 h-[340px] w-[340px] -translate-x-1/2 animate-drift-b rounded-full bg-moss/30 blur-[100px]" />
        <div className="absolute right-[6%] -top-12 h-[480px] w-[480px] animate-drift-c rounded-full bg-dusk/45 blur-[120px]" />
      </div>

      <div className="relative space-y-10 py-12 text-center md:py-20">
        <div
          className="pill mx-auto animate-fade-up font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
          style={{ animationDelay: "0ms" }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ember-pulse rounded-full bg-bull/80" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-bull" />
          </span>
          Live on Stellar testnet
        </div>

        <h1
          className="mx-auto max-w-4xl animate-fade-up text-balance text-5xl tracking-tightest md:text-7xl lg:text-[88px]"
          style={{ animationDelay: "80ms" }}
        >
          <span className="font-display font-normal text-foreground">Perpetuals,</span>{" "}
          <span className="font-display italic text-muted-foreground">settled at</span>
          <span className="block">
            <span className="font-display font-normal text-foreground">the speed of </span>
            <span
              className="font-display font-normal"
              style={{
                background:
                  "linear-gradient(120deg, hsl(28 80% 70%) 0%, hsl(24 70% 55%) 40%, hsl(248 60% 65%) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Stellar.
            </span>
          </span>
        </h1>

        <p
          className="mx-auto max-w-xl animate-fade-up text-balance text-base text-muted-foreground md:text-lg"
          style={{ animationDelay: "180ms" }}
        >
          Trade up to 200× leverage against a community-owned LP vault. Sub-second finality,
          sub-cent fees, fully on-chain.
        </p>

        <div
          className="flex animate-fade-up flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "260ms" }}
        >
          <Button asChild variant="primary" size="lg" className="group">
            <Link to="/markets">
              Launch app
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/vault">Provide liquidity</Link>
          </Button>
        </div>

        {tickers.length > 0 && (
          <div
            className="mx-auto flex max-w-2xl animate-fade-up flex-wrap items-center justify-center gap-2 pt-4"
            style={{ animationDelay: "340ms" }}
          >
            {tickers.map(([symbol, price]) => (
              <Link
                key={symbol}
                to="/trade/$symbol"
                params={{ symbol }}
                className="group flex items-center gap-2 rounded-full border border-border/40 bg-card/30 px-3 py-1.5 backdrop-blur-md transition-all hover:border-ember/40 hover:bg-card/60"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {symbol}
                </span>
                <span className="font-mono text-xs tabular-nums text-foreground/95">
                  <NumberFlowUsd value={price} decimals="adaptive" />
                </span>
              </Link>
            ))}
          </div>
        )}
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
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <div className="relative z-10 space-y-2 p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Total value locked
            </span>
            <div className="font-display text-4xl tracking-tightest text-foreground md:text-5xl">
              {tvl ? <NumberFlowUsd value={tvl} decimals={0} /> : "—"}
            </div>
          </div>
        </Card>
        <Card>
          <div className="relative z-10 space-y-2 p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Open interest
            </span>
            <div className="font-display text-4xl tracking-tightest text-foreground md:text-5xl">
              <NumberFlowUsd value={openInterest} decimals={0} />
            </div>
          </div>
        </Card>
        <Card>
          <div className="relative z-10 space-y-2 p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Live markets
            </span>
            <div className="font-display text-4xl tracking-tightest text-foreground md:text-5xl">
              <NumberFlowPlain value={marketCount} />
            </div>
          </div>
        </Card>
      </div>
    </section>
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
      body: "Per-market caps with continuous funding and borrow rates that rebalance long/short demand.",
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
    <section className="space-y-10">
      <div className="space-y-3 text-center">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Built for size
        </span>
        <h2 className="mx-auto max-w-2xl font-display text-4xl tracking-tightest text-foreground md:text-5xl">
          A perp DEX engineered around{" "}
          <span className="italic text-muted-foreground">Stellar's</span> settlement.
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, title, body }, idx) => (
          <Card key={title} className="animate-fade-up" style={{ animationDelay: `${idx * 60}ms` }}>
            <div className="relative z-10 flex h-full flex-col gap-4 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-full border border-ember/25 bg-ember/10 text-ember">
                <Icon className="h-4 w-4" />
              </span>
              <div className="space-y-1.5">
                <h3 className="font-display text-xl tracking-tightest text-foreground">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
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
    <section className="space-y-6">
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Top by open interest
          </span>
          <h2 className="font-display text-3xl tracking-tightest text-foreground md:text-4xl">
            Featured markets
          </h2>
        </div>
        <Link
          to="/markets"
          className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground"
        >
          View all
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {featured.map((m, idx) => (
          <MarketCard
            key={m.symbol}
            market={m}
            price={priceBySymbol.get(m.symbol)}
            className="animate-fade-up"
            style={{ animationDelay: `${idx * 60}ms` }}
          />
        ))}
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      <Card className="relative isolate overflow-hidden">
        {/* Aurora wash inside the closing card */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-12 -top-20 h-72 w-72 rounded-full bg-ember/30 blur-[80px]" />
          <div className="absolute -right-12 -bottom-20 h-72 w-72 rounded-full bg-dusk/35 blur-[80px]" />
        </div>
        <div className="relative z-10 space-y-6 px-6 py-14 text-center md:px-12 md:py-20">
          <h2 className="mx-auto max-w-xl font-display text-4xl tracking-tightest text-foreground md:text-5xl">
            Ready to <span className="italic">trade?</span>
          </h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Connect a Stellar wallet, claim testnet USDC from the faucet, and open your first
            position.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="primary" size="lg" className="group">
              <Link to="/markets">
                Open the app
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link to="/faucet">Get testnet USDC</Link>
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}

