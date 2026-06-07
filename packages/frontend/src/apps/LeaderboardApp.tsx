import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableDataCell,
  TableHead,
  TableHeadCell,
  TableRow,
} from "react95";
import { useLeaderboard, usePrices } from "@/api/hooks";
import { useStreamPrices } from "@/api/sse";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { WellNote } from "@/components/ui/well-note";
import { useAddress } from "@/wallet/WalletProvider";
import { useWindowManager } from "@/desktop/wm";
import { cn, shortAddress } from "@/lib/utils";
import { calcUnrealizedPnl } from "@stellars/protocol-math";

const MAX_ROWS = 50;

/** Hall of PnL: realized + open-position PnL marked to the live oracle. */
export function LeaderboardApp() {
  const me = useAddress();
  const wm = useWindowManager();
  const lb = useLeaderboard(MAX_ROWS);
  const prices = usePrices();
  useStreamPrices();

  const priceBySymbol = useMemo(
    () => new Map((prices.data ?? []).map((p) => [p.symbol, BigInt(p.price)])),
    [prices.data],
  );

  // Combined PnL = realized (from /leaderboard) + Σ unrealized over open
  // positions priced at the live oracle mark. Resort per tick so ranks
  // reflect what each trader is worth *right now*.
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

  if (lb.isLoading) {
    return <WellNote>Loading leaderboard…</WellNote>;
  }
  if (lb.error) {
    return <WellNote className="text-destructive">Failed to load leaderboard.</WellNote>;
  }
  if (ranked.length === 0) {
    return (
      <WellNote>
        No trading activity yet — once positions open or close, the rankings show up here.
      </WellNote>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeadCell className="w-12 !text-left">Rank</TableHeadCell>
          <TableHeadCell className="!text-left">Trader</TableHeadCell>
          <TableHeadCell className="!text-right">PnL</TableHeadCell>
          <TableHeadCell className="!text-right">Win rate</TableHeadCell>
          <TableHeadCell className="!text-right">Trades</TableHeadCell>
          <TableHeadCell className="!text-right">Volume</TableHeadCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {ranked.map((entry, idx) => {
          const row = entry.row;
          const isMe = !!me && row.trader === me;
          const profitable = entry.total >= 0n;
          const winRate = row.closes > 0 ? (row.wins / row.closes) * 100 : null;
          return (
            <TableRow
              key={row.trader}
              onClick={() => wm.open("profile", isMe ? undefined : row.trader)}
              className="cursor-pointer"
            >
              <TableDataCell className="font-mono tabular-nums">
                {idx + 1}
                {idx === 0 && (
                  <span aria-hidden className="ml-1">
                    ★
                  </span>
                )}
              </TableDataCell>
              <TableDataCell>
                <span className="flex items-center gap-1.5 font-mono">
                  {shortAddress(row.trader, 6, 4)}
                  {isMe && <span className="pill text-xs font-bold">you</span>}
                </span>
              </TableDataCell>
              <TableDataCell
                className={cn(
                  "!text-right font-mono tabular-nums",
                  profitable ? "text-bull" : "text-bear",
                )}
              >
                <NumberFlowUsd value={entry.total.toString()} decimals={2} signDisplay="exceptZero" />
              </TableDataCell>
              <TableDataCell className="!text-right font-mono tabular-nums">
                {winRate === null ? "—" : `${winRate.toFixed(0)}%`}
              </TableDataCell>
              <TableDataCell className="!text-right font-mono tabular-nums">
                <span className="text-bull">{row.wins}W</span>
                {" / "}
                <span className="text-bear">{row.losses}L</span>
              </TableDataCell>
              <TableDataCell className="!text-right font-mono tabular-nums">
                <NumberFlowUsd value={row.volume} decimals={0} />
              </TableDataCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
