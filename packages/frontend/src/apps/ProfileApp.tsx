import { useMemo, useState } from "react";
import { Tab, TabBody, Tabs } from "react95";
import { usePositions, usePrices, useTrades } from "@/api/hooks";
import { useStreamPositions, useStreamPrices } from "@/api/sse";
import { useAddress } from "@/wallet/WalletProvider";
import { Button } from "@/components/ui/button";
import { PositionRow } from "@/components/trade/PositionRow";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { WellNote } from "@/components/ui/well-note";
import { LogOnPrompt } from "@/desktop/Logon";
import { useWindowManager } from "@/desktop/wm";
import { calcUnrealizedPnl } from "@stellars/protocol-math";
import { cn, formatPrice, priceDecimals } from "@/lib/utils";
import type { TradeRow } from "@/api/types";

/**
 * Positions window. Without a param it shows the connected wallet's account;
 * with one (opened from the leaderboard) it's a read-only view of that trader.
 */
export function ProfileApp({ param }: { param?: string }) {
  const me = useAddress();
  const address = param ?? me;
  const isMe = !!me && me === address;

  if (!address) {
    return <LogOnPrompt message="Log on with a Stellar wallet to see your positions." />;
  }

  return <PositionsView address={address} isMe={isMe} />;
}

function PositionsView({ address, isMe }: { address: string; isMe: boolean }) {
  const positions = usePositions(address);
  const prices = usePrices();
  // Pull recent close-side events; we filter to the three terminal categories
  // (manual close, liquidation, ADL) client-side so a single round-trip covers
  // all three buckets. `decrease` and `order` event_types can be partial — the
  // is_full_close flag distinguishes a wind-down from a true close.
  const trades = useTrades({ trader: address, limit: 100 });
  useStreamPositions(address);
  useStreamPrices();

  const [tab, setTab] = useState<"open" | "closed">("open");

  const priceBySymbol = useMemo(
    () => new Map((prices.data ?? []).map((p) => [p.symbol, p.price])),
    [prices.data],
  );
  const openCount = positions.data?.length ?? 0;

  const closed = (trades.data ?? []).filter(
    (t) =>
      (t.event_type === "decrease" ||
        t.event_type === "order" ||
        t.event_type === "liquidation" ||
        t.event_type === "adl") &&
      t.is_full_close === true,
  );

  // Lifetime PnL = realized (Σ pnl over every trade event — increases carry 0)
  // + unrealized on still-open positions marked to live oracle. Same combined
  // basis the leaderboard uses. One headline number, not a parallel row.
  const lifetimePnl = useMemo(() => {
    const realized = (trades.data ?? []).reduce((acc, t) => acc + BigInt(t.pnl), 0n);
    const unrealized = (positions.data ?? []).reduce((acc, p) => {
      const mark = priceBySymbol.get(p.symbol);
      if (!mark) return acc;
      return acc + calcUnrealizedPnl(BigInt(p.size), BigInt(p.entry_price), BigInt(mark), p.is_long);
    }, 0n);
    return realized + unrealized;
  }, [trades.data, positions.data, priceBySymbol]);

  const pnlReady = !trades.isLoading && !positions.isLoading;
  const pnlClass =
    lifetimePnl > 0n ? "text-bull" : lifetimePnl < 0n ? "text-bear" : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <span className={cn("font-mono text-base font-bold tabular-nums", pnlClass)}>
          {pnlReady ? (
            <NumberFlowUsd value={lifetimePnl.toString()} signDisplay="exceptZero" />
          ) : (
            "—"
          )}
        </span>
        <span className="text-xs">Lifetime PnL</span>
      </div>

      <div>
        <Tabs value={tab} onChange={(v) => setTab(v as "open" | "closed")}>
          <Tab value="open">Open ({openCount})</Tab>
          <Tab value="closed">Closed ({closed.length})</Tab>
        </Tabs>
        <TabBody>
        {tab === "open" ? (
          <>
            {positions.isLoading && <WellNote>Loading…</WellNote>}
            {!positions.isLoading && openCount === 0 && <WellNote>No open positions</WellNote>}
            <div className="divide-y-2 divide-[#848584]">
              {(positions.data ?? []).map((p) => (
                <PositionRow
                  key={p.id}
                  position={p}
                  markPrice={priceBySymbol.get(p.symbol)}
                  readOnly={!isMe}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {trades.isLoading && <WellNote>Loading…</WellNote>}
            {!trades.isLoading && closed.length === 0 && (
              <WellNote>No closed positions yet</WellNote>
            )}
            <div className="divide-y-2 divide-[#848584]">
              {closed.map((t) => (
                <ClosedPositionRow key={t.id} trade={t} />
              ))}
            </div>
          </>
        )}
        </TabBody>
      </div>
    </div>
  );
}

function ClosedPositionRow({ trade }: { trade: TradeRow }) {
  const wm = useWindowManager();
  const kind = closeKind(trade);
  const pnl = BigInt(trade.pnl);
  const pnlClass = pnl > 0n ? "text-bull" : pnl < 0n ? "text-bear" : undefined;
  const isLong = trade.is_long ?? false;
  const closedAt = new Date(Number(trade.timestamp) * 1000);
  return (
    <div className="w-full p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Button variant="link" size="sm" onClick={() => wm.open("trade", trade.symbol)}>
            {trade.symbol}
          </Button>
          <span className={cn("text-xs font-bold", isLong ? "text-bull" : "text-bear")}>
            {isLong ? "long" : "short"}
          </span>
          <span className="pill text-xs">{kind.label}</span>
        </span>
        <span className="font-mono text-xs">{formatClosedAt(closedAt)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <CloseStat label="Size" value={<NumberFlowUsd value={trade.size_delta} decimals={0} />} />
        <CloseStat
          label="Entry"
          value={
            BigInt(trade.entry_price) > 0n ? (
              <>${formatPrice(trade.entry_price, priceDecimals(trade.entry_price))}</>
            ) : (
              "—"
            )
          }
        />
        <CloseStat
          label="Exit"
          value={<>${formatPrice(trade.mark_price, priceDecimals(trade.mark_price))}</>}
        />
        <CloseStat
          label="PnL"
          value={
            <span className={cn("tabular-nums", pnlClass)}>
              <NumberFlowUsd value={trade.pnl} signDisplay="exceptZero" />
            </span>
          }
        />
      </div>
    </div>
  );
}

function CloseStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function closeKind(t: TradeRow): { label: string } {
  if (t.event_type === "liquidation") return { label: "Liquidated" };
  if (t.event_type === "adl") return { label: "ADL" };
  if (t.event_type === "order" && t.is_tp === true) return { label: "Closed · TP" };
  if (t.event_type === "order") return { label: "Closed · SL" };
  return { label: "Closed" };
}

function formatClosedAt(d: Date): string {
  const ageSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  if (ageSec < 86400 * 7) return `${Math.floor(ageSec / 86400)}d ago`;
  return d.toLocaleDateString();
}

