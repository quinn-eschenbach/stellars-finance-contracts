import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Flame, Skull } from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { useLeaderboard, usePrices } from "@/api/hooks";
import { useStreamPrices } from "@/api/sse";
import { Card } from "@/components/ui/card";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { useAddress } from "@/wallet/WalletProvider";
import { cn, shortAddress } from "@/lib/utils";
import { calcUnrealizedPnl } from "@stellars/protocol-math";
import type { LeaderboardRow } from "@/api/types";

export const Route = createFileRoute("/leaderboard")({
  component: LeaderboardPage,
});

const MAX_ROWS = 50;

function LeaderboardPage() {
  const me = useAddress();
  const lb = useLeaderboard(MAX_ROWS);
  const prices = usePrices();
  useStreamPrices();

  const priceBySymbol = useMemo(
    () => new Map((prices.data ?? []).map((p) => [p.symbol, BigInt(p.price)])),
    [prices.data],
  );

  // Combined PnL = realized (from /leaderboard) + Σ unrealized over open
  // positions priced at the live oracle mark. Resort per tick so ranks
  // reflect what each trader is worth *right now* — the rows themselves are
  // motion-layout so the reorder animates smoothly instead of snapping.
  const ranked = useMemo(() => {
    const scored = (lb.data ?? []).map((row) => {
      const realized = BigInt(row.realized_pnl);
      const unrealized = (row.open_positions ?? []).reduce((acc, pos) => {
        const mark = priceBySymbol.get(pos.symbol);
        if (!mark) return acc;
        return (
          acc +
          calcUnrealizedPnl(
            BigInt(pos.size),
            BigInt(pos.entry_price),
            mark,
            pos.is_long,
          )
        );
      }, 0n);
      return { row, total: realized + unrealized };
    });
    return scored
      .sort((a, b) => (a.total === b.total ? 0 : a.total > b.total ? -1 : 1))
      .slice(0, MAX_ROWS);
  }, [lb.data, priceBySymbol]);

  return (
    <div className="space-y-8 animate-fade-up pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/30 pb-5">
        <div className="space-y-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Hall of pnl
          </span>
          <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
            Leaderboard
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Realized plus open-position PnL, marked to the live oracle.{" "}
            <span className="text-foreground/80">
              Win rate is wins ÷ closed trades — paper hands not invited.
            </span>
          </p>
        </div>
        <div className="pill font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ember-pulse rounded-full bg-ember/80" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-ember" />
          </span>
          {ranked.length} traders
        </div>
      </header>

      {lb.isLoading && (
        <div className="rounded-xl border border-border/50 bg-card/30 px-4 py-6 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Loading leaderboard…
        </div>
      )}
      {lb.error && <div className="text-destructive">Failed to load leaderboard.</div>}

      {ranked.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/40 bg-card/40 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  <th className="px-4 py-3 text-left font-medium">Rank</th>
                  <th className="px-4 py-3 text-left font-medium">Trader</th>
                  <th className="px-4 py-3 text-right font-medium">PnL</th>
                  <th className="px-4 py-3 text-right font-medium">Win rate</th>
                  <th className="px-4 py-3 text-right font-medium">Trades</th>
                  <th className="px-4 py-3 text-right font-medium">Volume</th>
                </tr>
              </thead>
              <LayoutGroup>
                <tbody>
                  <AnimatePresence initial={false}>
                    {ranked.map((entry, idx) => (
                      <RankRow
                        key={entry.row.trader}
                        rank={idx + 1}
                        row={entry.row}
                        pnl={entry.total}
                        isMe={!!me && entry.row.trader === me}
                      />
                    ))}
                  </AnimatePresence>
                </tbody>
              </LayoutGroup>
            </table>
          </div>
        </Card>
      )}

      {!lb.isLoading && ranked.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/20 px-6 py-12 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            no trading activity yet
          </p>
          <p className="mt-2 text-sm text-muted-foreground/80">
            Once positions open or close, the rankings light up here.
          </p>
        </div>
      )}
    </div>
  );
}

function RankRow({
  rank,
  row,
  pnl,
  isMe,
}: {
  rank: number;
  row: LeaderboardRow;
  pnl: bigint;
  isMe: boolean;
}) {
  const profitable = pnl >= 0n;
  const winRate = row.closes > 0 ? (row.wins / row.closes) * 100 : 0;
  const winRateLabel = row.closes > 0 ? `${winRate.toFixed(0)}%` : "—";

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        layout: { type: "spring", stiffness: 380, damping: 34, mass: 0.6 },
        opacity: { duration: 0.18 },
      }}
      className={cn(
        "border-b border-border/20 transition-colors hover:bg-card/30",
        isMe && "bg-ember/[0.04]",
      )}
    >
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] tabular-nums",
              rank === 1
                ? "bg-ember/20 text-ember"
                : rank <= 3
                  ? "bg-card/60 text-foreground/80"
                  : "text-muted-foreground/70",
            )}
          >
            {rank}
          </span>
          {rank === 1 && <Flame className="h-3.5 w-3.5 text-ember/80" aria-hidden />}
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Link
            to="/positions/$address"
            params={{ address: row.trader }}
            className="font-mono text-xs text-foreground/95 transition-colors hover:text-ember"
          >
            {shortAddress(row.trader, 6, 4)}
          </Link>
          {isMe && (
            <span className="rounded-full bg-ember/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-ember">
              you
            </span>
          )}
        </div>
      </td>
      <td
        className={cn(
          "px-4 py-3.5 text-right font-mono text-sm tabular-nums",
          profitable ? "text-bull" : "text-bear",
        )}
      >
        <NumberFlowUsd value={pnl.toString()} decimals={2} signDisplay="exceptZero" />
      </td>
      <td className="px-4 py-3.5 text-right">
        <WinRateCell winRate={winRate} closes={row.closes} label={winRateLabel} />
      </td>
      <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-foreground/80">
        <span className="text-bull/80">{row.wins}W</span>
        <span className="mx-1 text-muted-foreground/40">·</span>
        <span className="text-bear/80">{row.losses}L</span>
      </td>
      <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
        <NumberFlowUsd value={row.volume} decimals={0} />
      </td>
    </motion.tr>
  );
}

function WinRateCell({
  winRate,
  closes,
  label,
}: {
  winRate: number;
  closes: number;
  label: string;
}) {
  if (closes === 0) {
    return <span className="font-mono text-xs text-muted-foreground/60">—</span>;
  }
  const tone =
    winRate >= 60 ? "text-bull" : winRate <= 40 ? "text-bear" : "text-foreground/85";
  return (
    <div className="inline-flex items-center gap-2">
      <div className="relative h-1 w-12 overflow-hidden rounded-full bg-card/60">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-bear via-ember to-bull"
          style={{ width: `${Math.max(4, Math.min(100, winRate))}%` }}
        />
      </div>
      <span className={cn("font-mono text-xs tabular-nums", tone)}>{label}</span>
      {winRate <= 25 && closes >= 3 && <Skull className="h-3 w-3 text-bear/70" aria-hidden />}
    </div>
  );
}
