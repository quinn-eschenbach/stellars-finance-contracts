import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { useAddress } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { descale, numberToAmount, parsePrice } from "@/lib/utils";
import { queryKeys } from "@/api/hooks";

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
export function TpSlEditor({ symbol, isLong, entryPrice, initialTp, initialSl, onClose }: TpSlEditorProps) {
  const address = useAddress();
  // Plain numbers — 0 means unset, matching the contract convention.
  const [tpValue, setTpValue] = useState(() => (initialTp > 0n ? descale(initialTp) : 0));
  const [slValue, setSlValue] = useState(() => (initialSl > 0n ? descale(initialSl) : 0));

  const tpScaled = tpValue > 0 ? parsePrice(numberToAmount(tpValue)) : 0n;
  const slScaled = slValue > 0 ? parsePrice(numberToAmount(slValue)) : 0n;
  const tpError = tpScaled > 0n ? validateTp(entryPrice, tpScaled, isLong) : null;
  const slError = slScaled > 0n ? validateSl(entryPrice, slScaled, isLong) : null;

  const save = useTxMutation({
    action: `Update TP/SL · ${symbol}`,
    successDetail: "Triggers updated.",
    invalidate: [queryKeys.positions(address ?? "")],
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      if (tpError || slError) throw new Error(tpError || slError || "invalid TP/SL");
      return positionManager(address).set_tp_sl({
        trader: address,
        symbol,
        take_profit: tpScaled,
        stop_loss: slScaled,
      });
    },
    onSuccess: () => onClose(),
  });

  return (
    <div className="p-2">
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">TP ({isLong ? "above" : "below"} entry)</Label>
          <NumberInput value={tpValue} onChange={setTpValue} min={0} width="100%" />
          {tpError && <p className="font-mono text-xs text-destructive">{tpError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">SL ({isLong ? "below" : "above"} entry)</Label>
          <NumberInput value={slValue} onChange={setSlValue} min={0} width="100%" />
          {slError && <p className="font-mono text-xs text-destructive">{slError}</p>}
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
