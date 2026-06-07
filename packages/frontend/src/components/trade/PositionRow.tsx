import { useState } from "react";
import { Frame } from "react95";
import { Button } from "@/components/ui/button";
import { useWindowManager } from "@/desktop/wm";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { TpSlEditor } from "@/components/trade/TpSlEditor";
import { usePositionActions } from "@/components/trade/usePositionActions";
import { cn } from "@/lib/utils";
import { usePositionEvaluation, type PositionView } from "@/api/positionEvaluation";
import type { PositionRow as PositionRowData } from "@/api/types";

interface PositionRowProps {
  position: PositionRowData;
  /** Current mark price for the symbol, scaled (10^7). */
  markPrice?: string;
  /** When true, hide Close/Edit actions — used on other traders' position pages. */
  readOnly?: boolean;
}

/** One open Position in a list context (Profile window). */
export function PositionRow({ position, markPrice, readOnly = false }: PositionRowProps) {
  const wm = useWindowManager();
  const [editing, setEditing] = useState(false);

  // Non-null: `position` is always set here.
  const view = usePositionEvaluation(position, markPrice) as PositionView;
  const { isLong, evaluation, pnl, pnlClass, tp, sl, collateral } = view;

  const { close } = usePositionActions(position);

  return (
    <Frame variant="well" className="!block w-full">
      <div className="flex items-center justify-between p-2">
        <span className="flex items-center gap-2">
          <Button variant="link" size="sm" onClick={() => wm.open("trade", position.symbol)}>
            <span className="text-sm font-bold">{position.symbol}</span>
          </Button>
          <span className={cn("pill text-xs font-bold", isLong ? "text-bull" : "text-bear")}>
            {isLong ? "Long" : "Short"}
          </span>
        </span>
        {!readOnly && (
          <Button size="sm" disabled={close.isPending} onClick={() => close.mutate()}>
            {close.isPending ? "Closing…" : "Close"}
          </Button>
        )}
      </div>

      <div className="hairline" />

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-2 py-2 md:grid-cols-4">
        <Stat label="Size" value={<NumberFlowUsd value={position.size} />} />
        <Stat label="Margin" value={<NumberFlowUsd value={position.collateral} />} />
        <Stat
          label="Entry"
          value={<NumberFlowUsd value={position.entry_price} decimals="adaptive" />}
        />
        <Stat
          label="Unrealized"
          value={
            markPrice ? <NumberFlowUsd value={pnl} signDisplay="exceptZero" /> : "—"
          }
          className={pnlClass}
        />
      </div>

      {evaluation && (
        <>
          <div className="hairline" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-2 py-1.5 font-mono text-xs">
            <span className="flex items-baseline gap-1.5">
              <span>Borrow</span>
              <span className="tabular-nums">
                <NumberFlowUsd value={evaluation.borrow_fee} />
              </span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span>Funding</span>
              <span
                className={cn(
                  "tabular-nums",
                  evaluation.effective_funding > 0n
                    ? "text-bull"
                    : evaluation.effective_funding < 0n
                      ? "text-bear"
                      : undefined,
                )}
              >
                <NumberFlowUsd value={evaluation.effective_funding} signDisplay="exceptZero" />
              </span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span>Health</span>
              <span
                className={cn(
                  "tabular-nums",
                  evaluation.effective_health > collateral / 2n
                    ? "text-bull"
                    : evaluation.effective_health > 0n
                      ? undefined
                      : "text-bear",
                )}
              >
                <NumberFlowUsd value={evaluation.effective_health} />
              </span>
            </span>
          </div>
        </>
      )}

      <div className="hairline" />

      <div className="flex items-center justify-between px-2 py-1.5 text-xs">
        <div className="flex gap-5 font-mono">
          <span className="flex items-baseline gap-1.5">
            <span>TP</span>
            <span className="tabular-nums">
              {tp > 0n ? <NumberFlowUsd value={tp} decimals="adaptive" /> : "—"}
            </span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span>SL</span>
            <span className="tabular-nums">
              {sl > 0n ? <NumberFlowUsd value={sl} decimals="adaptive" /> : "—"}
            </span>
          </span>
        </div>
        {!readOnly && (
          <Button size="sm" active={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
      </div>

      {!readOnly && editing && (
        <TpSlEditor
          symbol={position.symbol}
          isLong={position.is_long}
          entryPrice={BigInt(position.entry_price)}
          initialTp={tp}
          initialSl={sl}
          onClose={() => setEditing(false)}
        />
      )}
    </Frame>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs">{label}</span>
      <span className={cn("font-mono text-sm tabular-nums", className)}>{value}</span>
    </div>
  );
}
