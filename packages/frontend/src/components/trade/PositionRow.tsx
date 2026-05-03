import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddress, useWallet } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { signAndSendWithWallet } from "@/contracts/sender";
import { formatPrice, formatUsdc, parsePrice } from "@/lib/utils";
import { unrealizedPnl } from "@/lib/math";
import { queryKeys } from "@/api/hooks";
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
      const tx = await positionManager(address).decrease_position({
        trader: address,
        symbol: position.symbol,
        size_delta: BigInt(position.size),
      });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
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

  return (
    <div className="space-y-3 rounded-md border border-border p-4 font-mono text-sm">
      <div className="flex items-center justify-between">
        <Link
          to="/trade/$symbol"
          params={{ symbol: position.symbol }}
          className="group flex items-center gap-3 text-foreground transition-colors hover:text-primary"
        >
          <span className="font-semibold">{position.symbol}</span>
          <span
            className={
              position.is_long
                ? "rounded bg-bull/15 px-2 py-0.5 text-xs text-bull"
                : "rounded bg-bear/15 px-2 py-0.5 text-xs text-bear"
            }
          >
            {position.is_long ? "LONG" : "SHORT"}
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
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

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
        <Stat label="Size" value={`$${formatUsdc(position.size)}`} />
        <Stat label="Margin" value={`$${formatUsdc(position.collateral)}`} />
        <Stat label="Entry" value={`$${formatPrice(position.entry_price)}`} />
        <Stat
          label="PnL"
          value={
            markPrice ? `${pnl >= 0n ? "+" : "−"}$${formatUsdc(pnl, { abs: true })}` : "—"
          }
          className={pnlClass}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
        <div className="flex gap-4">
          <span>
            <span className="text-muted-foreground">TP </span>
            <span>{tp > 0n ? `$${formatPrice(tp)}` : "—"}</span>
          </span>
          <span>
            <span className="text-muted-foreground">SL </span>
            <span>{sl > 0n ? `$${formatPrice(sl)}` : "—"}</span>
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing((v) => !v)}
          className="text-xs"
        >
          {editing ? "Cancel" : "Edit TP/SL"}
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

      {close.error && (
        <p className="text-xs text-destructive">
          {(close.error as Error).message?.slice(0, 200) ?? "error"}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
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
      const tx = await positionManager(address).set_tp_sl({
        trader: address,
        symbol,
        take_profit: typeof tpParsed === "bigint" ? tpParsed : 0n,
        stop_loss: typeof slParsed === "bigint" ? slParsed : 0n,
      });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions(address ?? "") });
      onClose();
    },
  });

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-md bg-secondary/30 p-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Take profit</Label>
        <Input
          type="text"
          inputMode="decimal"
          value={tpInput}
          onChange={(e) => setTpInput(e.target.value)}
          placeholder={isLong ? "above entry" : "below entry"}
        />
        {tpError && <p className="text-xs text-destructive">{tpError}</p>}
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Stop loss</Label>
        <Input
          type="text"
          inputMode="decimal"
          value={slInput}
          onChange={(e) => setSlInput(e.target.value)}
          placeholder={isLong ? "below entry" : "above entry"}
        />
        {slError && <p className="text-xs text-destructive">{slError}</p>}
      </div>
      <Button
        size="sm"
        disabled={save.isPending || !!tpError || !!slError}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save"}
      </Button>
      {save.error && (
        <p className="col-span-3 text-xs text-destructive">
          {(save.error as Error).message?.slice(0, 200) ?? "error"}
        </p>
      )}
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
