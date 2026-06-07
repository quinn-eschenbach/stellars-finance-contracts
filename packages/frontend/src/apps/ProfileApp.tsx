import { Frame, GroupBox } from "react95";
import { usePositions, usePrices, useTrades } from "@/api/hooks";
import { useStreamPositions, useStreamPrices } from "@/api/sse";
import { useAddress } from "@/wallet/WalletProvider";
import { Button } from "@/components/ui/button";
import { PositionRow } from "@/components/trade/PositionRow";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { WellNote } from "@/components/ui/well-note";
import { LogOnPrompt } from "@/desktop/Logon";
import { useWindowManager } from "@/desktop/wm";
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
  const closedTrades = useTrades({ trader: address, limit: 100 });
  useStreamPositions(address);
  useStreamPrices();

  const priceBySymbol = new Map((prices.data ?? []).map((p) => [p.symbol, p.price]));
  const count = positions.data?.length ?? 0;

  const closed = (closedTrades.data ?? []).filter(
    (t) =>
      (t.event_type === "decrease" ||
        t.event_type === "order" ||
        t.event_type === "liquidation" ||
        t.event_type === "adl") &&
      t.is_full_close === true,
  );

  return (
    <div className="flex flex-col gap-2">
      <Frame variant="status" className="!flex items-center justify-between gap-2 !px-2 !py-1">
        <span className="min-w-0 truncate font-mono text-xs">{address}</span>
        <span className="shrink-0 text-xs">
          {count} open {count === 1 ? "position" : "positions"}
        </span>
      </Frame>

      <GroupBox label="Open positions" className="!pt-3">
        {positions.isLoading && <WellNote>Loading…</WellNote>}
        {positions.data?.length === 0 && <WellNote>No open positions</WellNote>}
        <div className="space-y-2">
          {(positions.data ?? []).map((p) => (
            <PositionRow
              key={p.id}
              position={p}
              markPrice={priceBySymbol.get(p.symbol)}
              readOnly={!isMe}
            />
          ))}
        </div>
      </GroupBox>

      <GroupBox label="Closed positions" className="!pt-3">
        {closedTrades.isLoading && <WellNote>Loading…</WellNote>}
        {!closedTrades.isLoading && closed.length === 0 && (
          <WellNote>No closed positions yet</WellNote>
        )}
        <div className="space-y-2">
          {closed.map((t) => (
            <ClosedPositionRow key={t.id} trade={t} />
          ))}
        </div>
      </GroupBox>
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
    <Frame variant="well" className="!block w-full !p-2">
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
    </Frame>
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

