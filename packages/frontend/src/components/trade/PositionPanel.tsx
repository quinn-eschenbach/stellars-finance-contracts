import { useState, type ReactNode } from "react";
import { Frame } from "react95";
import { Button } from "@/components/ui/button";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { TpSlEditor } from "@/components/trade/TpSlEditor";
import { usePositionActions } from "@/components/trade/usePositionActions";
import { cn } from "@/lib/utils";
import { usePositionEvaluation, type PositionView } from "@/api/positionEvaluation";
import type { PositionRow as PositionRowData } from "@/api/types";

const DECREASE_STEPS = [25, 50, 75] as const;

interface PositionPanelProps {
  position: PositionRowData;
  /** Current mark price for the symbol, scaled (10^7). */
  markPrice?: string;
}

/**
 * The single open position on this market, reduced to what a trader glances
 * at: PnL, the three prices that matter (entry → mark → liq), TP/SL, and the
 * actions. Size/margin/accrued-fee forensics live behind Details.
 */
export function PositionPanel({ position, markPrice }: PositionPanelProps) {
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Non-null: `position` is always set here. The hook is null-tolerant only
  // for callers with an optional Position.
  const view = usePositionEvaluation(position, markPrice) as PositionView;
  const { isLong, leverage, evaluation, pnl, pnlPct, pnlClass, liqPrice, tp, sl, collateral } = view;

  const { close, decrease } = usePositionActions(position);
  const busy = close.isPending || decrease.isPending;

  return (
    <div className="space-y-2">
      {/* The glance row: side, PnL, entry → mark → liq, TP/SL */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className={cn("pill text-sm font-bold", isLong ? "text-bull" : "text-bear")}>
          {isLong ? "Long" : "Short"} {leverage}×
        </span>

        <span className={cn("font-mono text-lg font-bold tabular-nums", pnlClass)}>
          {markPrice ? <NumberFlowUsd value={pnl} signDisplay="exceptZero" /> : "—"}{" "}
          <span className="text-xs font-normal">
            ({pnlPct >= 0 ? "+" : ""}
            {pnlPct.toFixed(1)}%)
          </span>
        </span>

        <span className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
          <NumberFlowUsd value={position.entry_price} decimals="adaptive" />
          <span aria-hidden className="text-xs">
            →
          </span>
          {markPrice ? <NumberFlowUsd value={markPrice} decimals="adaptive" /> : "—"}
          <span aria-hidden className="text-xs">
            →
          </span>
          <span className="text-bear">
            {liqPrice && liqPrice > 0n ? (
              <NumberFlowUsd value={liqPrice} decimals="adaptive" />
            ) : (
              "—"
            )}
          </span>
          <span className="ml-1 text-xs">entry → mark → liq</span>
        </span>

        <span className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
          {tp > 0n ? <NumberFlowUsd value={tp} decimals="adaptive" /> : "—"}
          {" / "}
          {sl > 0n ? <NumberFlowUsd value={sl} decimals="adaptive" /> : "—"}
          <span className="ml-1 text-xs">tp / sl</span>
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1">
        {DECREASE_STEPS.map((pct) => (
          <Button
            key={pct}
            size="sm"
            disabled={busy}
            onClick={() => decrease.mutate(pct)}
            className="font-mono"
          >
            {decrease.isPending && decrease.variables === pct ? "…" : `−${pct}%`}
          </Button>
        ))}
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => close.mutate()}>
          {close.isPending ? "Closing…" : "Close"}
        </Button>
        <Button size="sm" active={editing} onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : "Edit TP/SL"}
        </Button>
        <span className="flex-1" />
        <Button size="sm" active={showDetails} onClick={() => setShowDetails((v) => !v)}>
          Details {showDetails ? "«" : "»"}
        </Button>
      </div>

      {editing && (
        <Frame variant="well" className="!block w-full">
          <TpSlEditor
            symbol={position.symbol}
            isLong={isLong}
            entryPrice={BigInt(position.entry_price)}
            initialTp={tp}
            initialSl={sl}
            onClose={() => setEditing(false)}
          />
        </Frame>
      )}

      {showDetails && (
        <Frame variant="well" className="!block w-full space-y-1 !p-2">
          <DetailRow label="Size" value={<NumberFlowUsd value={position.size} />} />
          <DetailRow label="Margin" value={<NumberFlowUsd value={position.collateral} />} />
          <DetailRow
            label="Accrued borrow"
            value={evaluation ? <NumberFlowUsd value={evaluation.borrow_fee} /> : "—"}
          />
          <DetailRow
            label="Accrued funding"
            value={
              evaluation ? (
                <span
                  className={cn(
                    evaluation.effective_funding > 0n
                      ? "text-bull"
                      : evaluation.effective_funding < 0n
                        ? "text-bear"
                        : undefined,
                  )}
                >
                  <NumberFlowUsd value={evaluation.effective_funding} signDisplay="exceptZero" />
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow
            label="Health"
            value={
              evaluation ? (
                <span
                  className={cn(
                    evaluation.effective_health > collateral / 2n
                      ? "text-bull"
                      : evaluation.effective_health > 0n
                        ? undefined
                        : "text-bear",
                  )}
                >
                  <NumberFlowUsd value={evaluation.effective_health} />
                </span>
              ) : (
                "—"
              )
            }
          />
        </Frame>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
