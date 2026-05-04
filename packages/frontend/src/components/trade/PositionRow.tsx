import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { useAddress, useWallet } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { signAndSendWithWallet } from "@/contracts/sender";
import { formatPrice, parsePrice, cn } from "@/lib/utils";
import { unrealizedPnl } from "@/lib/math";
import { queryKeys } from "@/api/hooks";
import { txToast } from "@/lib/toast";
import type { PositionRow as PositionRowData } from "@/api/types";

interface PositionRowProps {
  position: PositionRowData;
  /** Current mark price for the symbol, scaled (10^7). */
  markPrice?: string;
}

export function PositionRow({ position, markPrice }: PositionRowProps) {
  const address = useAddress();
  const { signTransaction } = useWallet();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);

  const close = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      const t = txToast({
        action: `Close ${position.is_long ? "long" : "short"} ${position.symbol}`,
        successDetail: "Position settled and PnL credited.",
      });
      try {
        const tx = await positionManager(address).decrease_position({
          trader: address,
          symbol: position.symbol,
          size_delta: BigInt(position.size),
        });
        const result = await signAndSendWithWallet(tx, signTransaction);
        t.success();
        return result.hash;
      } catch (e) {
        t.error(e);
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions(address ?? "") });
    },
  });

  const pnl = markPrice
    ? unrealizedPnl(
        BigInt(position.size),
        BigInt(position.entry_price),
        BigInt(markPrice),
        position.is_long,
      )
    : 0n;
  const pnlClass = pnl > 0n ? "text-bull" : pnl < 0n ? "text-bear" : "text-muted-foreground";
  const tp = BigInt(position.take_profit);
  const sl = BigInt(position.stop_loss);
  const isLong = position.is_long;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/50 bg-card/40 backdrop-blur-md transition-all hover:border-border",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]",
      )}
    >
      {/* Side accent bar */}
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-px",
          isLong ? "bg-gradient-to-b from-transparent via-bull/60 to-transparent" : "bg-gradient-to-b from-transparent via-bear/60 to-transparent",
        )}
      />

      <div className="flex items-center justify-between p-4">
        <Link
          to="/trade/$symbol"
          params={{ symbol: position.symbol }}
          className="group/link flex items-center gap-3 text-foreground transition-colors"
        >
          <span className="font-display text-xl tracking-tight">{position.symbol}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]",
              isLong
                ? "border-bull/30 bg-bull/10 text-bull"
                : "border-bear/30 bg-bear/10 text-bear",
            )}
          >
            <span className={cn("h-1 w-1 rounded-full", isLong ? "bg-bull" : "bg-bear")} />
            {isLong ? "Long" : "Short"}
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100" />
        </Link>
        <Button
          size="sm"
          variant="outline"
          disabled={close.isPending}
          onClick={() => close.mutate()}
        >
          {close.isPending ? "Closing…" : "Close"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/40 px-4 py-3.5 md:grid-cols-4">
        <Stat label="Size" value={<NumberFlowUsd value={position.size} />} />
        <Stat label="Margin" value={<NumberFlowUsd value={position.collateral} />} />
        <Stat label="Entry" value={<NumberFlowUsd value={position.entry_price} />} />
        <Stat
          label="Unrealized"
          value={
            markPrice ? <NumberFlowUsd value={pnl} signDisplay="exceptZero" /> : "—"
          }
          className={pnlClass}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border/40 px-4 py-3 text-xs">
        <div className="flex gap-5 font-mono">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">TP</span>
            <span className="tabular-nums">{tp > 0n ? <NumberFlowUsd value={tp} /> : <span className="text-muted-foreground/40">—</span>}</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">SL</span>
            <span className="tabular-nums">{sl > 0n ? <NumberFlowUsd value={sl} /> : <span className="text-muted-foreground/40">—</span>}</span>
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing((v) => !v)}
          className="h-7 px-2.5 text-[11px]"
        >
          <Pencil className="h-3 w-3" />
          {editing ? "Cancel" : "Edit"}
        </Button>
      </div>

      {editing && (
        <TpSlEditor
          symbol={position.symbol}
          isLong={position.is_long}
          entryPrice={BigInt(position.entry_price)}
          initialTp={tp}
          initialSl={sl}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">{label}</span>
      <span className={cn("font-mono text-sm tabular-nums", className)}>{value}</span>
    </div>
  );
}

interface TpSlEditorProps {
  symbol: string;
  isLong: boolean;
  entryPrice: bigint;
  initialTp: bigint;
  initialSl: bigint;
  onClose: () => void;
}

/**
 * Inline TP/SL editor. Mirrors the contract's `validate_tp_sl` rules so the
 * user gets feedback before paying gas: TP/SL are checked against the
 * position's entry price (not mark) — that matches the on-chain validation.
 */
function TpSlEditor({ symbol, isLong, entryPrice, initialTp, initialSl, onClose }: TpSlEditorProps) {
  const address = useAddress();
  const { signTransaction } = useWallet();
  const qc = useQueryClient();

  const [tpInput, setTpInput] = useState(scaledToInput(initialTp));
  const [slInput, setSlInput] = useState(scaledToInput(initialSl));

  const tpParsed = safeParsePrice(tpInput);
  const slParsed = safeParsePrice(slInput);
  const tpError =
    tpParsed === "invalid"
      ? "invalid TP"
      : typeof tpParsed === "bigint" && tpParsed > 0n
        ? validateTp(entryPrice, tpParsed, isLong)
        : null;
  const slError =
    slParsed === "invalid"
      ? "invalid SL"
      : typeof slParsed === "bigint" && slParsed > 0n
        ? validateSl(entryPrice, slParsed, isLong)
        : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      if (tpError || slError) throw new Error(tpError || slError || "invalid TP/SL");
      const t = txToast({ action: `Update TP/SL · ${symbol}`, successDetail: "Triggers updated." });
      try {
        const tx = await positionManager(address).set_tp_sl({
          trader: address,
          symbol,
          take_profit: typeof tpParsed === "bigint" ? tpParsed : 0n,
          stop_loss: typeof slParsed === "bigint" ? slParsed : 0n,
        });
        const result = await signAndSendWithWallet(tx, signTransaction);
        t.success();
        return result.hash;
      } catch (e) {
        t.error(e);
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions(address ?? "") });
      onClose();
    },
  });

  return (
    <div className="border-t border-border/40 bg-background/30 p-4 animate-fade-up">
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <div className="space-y-1.5">
          <Label className="text-[10px]">Take profit</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={tpInput}
            onChange={(e) => setTpInput(e.target.value)}
            placeholder={isLong ? "above entry" : "below entry"}
          />
          {tpError && <p className="font-mono text-[10px] text-destructive">{tpError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px]">Stop loss</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={slInput}
            onChange={(e) => setSlInput(e.target.value)}
            placeholder={isLong ? "below entry" : "above entry"}
          />
          {slError && <p className="font-mono text-[10px] text-destructive">{slError}</p>}
        </div>
        <Button
          size="default"
          variant="primary"
          disabled={save.isPending || !!tpError || !!slError}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function scaledToInput(scaled: bigint): string {
  if (scaled <= 0n) return "";
  return formatPrice(scaled, 7).replace(/\.?0+$/, "");
}

function safeParsePrice(input: string): bigint | "invalid" {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  try {
    return parsePrice(trimmed);
  } catch {
    return "invalid";
  }
}

function validateTp(entry: bigint, tp: bigint, isLong: boolean): string | null {
  if (isLong && tp <= entry) return "TP must be above entry";
  if (!isLong && tp >= entry) return "TP must be below entry";
  return null;
}
function validateSl(entry: bigint, sl: bigint, isLong: boolean): string | null {
  if (isLong && sl >= entry) return "SL must be below entry";
  if (!isLong && sl <= entry) return "SL must be above entry";
  return null;
}
