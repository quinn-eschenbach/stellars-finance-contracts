import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAddress, useWallet } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { signAndSendWithWallet } from "@/contracts/sender";
import { formatPrice, formatUsdc, parseUsdc } from "@/lib/utils";
import { approxLiquidationPrice } from "@/lib/math";
import { queryKeys } from "@/api/hooks";

interface OrderFormProps {
  symbol: string;
  /** Latest mark price for the symbol, scaled (10^7). May be undefined while loading. */
  markPrice?: string;
  /** Per-market max leverage, parsed integer (e.g. 50). */
  maxLeverage?: number;
}

/**
 * Market-order open form. Only `is_long`, `collateral` and `leverage` are
 * user-controlled; `size = collateral × leverage` is derived. TP/SL come in
 * a follow-up pass.
 */
export function OrderForm({ symbol, markPrice, maxLeverage = 20 }: OrderFormProps) {
  const address = useAddress();
  const { signTransaction } = useWallet();
  const qc = useQueryClient();

  const [side, setSide] = useState<"long" | "short">("long");
  const [collateralInput, setCollateralInput] = useState("100");
  const [leverage, setLeverage] = useState(5);

  const collateralScaled = useMemo(() => {
    try {
      return parseUsdc(collateralInput);
    } catch {
      return 0n;
    }
  }, [collateralInput]);

  const sizeScaled = collateralScaled * BigInt(leverage);
  const isLong = side === "long";
  const liq =
    markPrice && collateralScaled > 0n
      ? approxLiquidationPrice(BigInt(markPrice), collateralScaled, sizeScaled, isLong)
      : null;

  const open = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      if (collateralScaled <= 0n) throw new Error("enter a positive collateral");
      const tx = await positionManager(address).increase_position({
        trader: address,
        symbol,
        size: sizeScaled,
        collateral: collateralScaled,
        is_long: isLong,
        take_profit: 0n,
        stop_loss: 0n,
      });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions(address ?? "") });
    },
  });

  const cappedLeverage = Math.min(leverage, Math.max(1, maxLeverage));

  return (
    <div className="space-y-4">
      <Tabs value={side} onValueChange={(v) => setSide(v as "long" | "short")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="long" className="data-[state=active]:bg-bull/20">
            Long
          </TabsTrigger>
          <TabsTrigger value="short" className="data-[state=active]:bg-bear/20">
            Short
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-2">
        <Label>Collateral (USDC)</Label>
        <Input
          type="text"
          inputMode="decimal"
          value={collateralInput}
          onChange={(e) => setCollateralInput(e.target.value)}
          placeholder="100"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Leverage</Label>
          <span className="text-sm font-mono">{cappedLeverage}x</span>
        </div>
        <Slider
          min={1}
          max={maxLeverage}
          step={1}
          value={cappedLeverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
        />
      </div>

      <div className="space-y-1 rounded-md border border-border bg-secondary/30 p-3 font-mono text-xs">
        <Row label="Size" value={`$${formatUsdc(sizeScaled)}`} />
        <Row label="Mark price" value={markPrice ? `$${formatPrice(markPrice)}` : "—"} />
        <Row label="Est. liq price" value={liq ? `$${formatPrice(liq)}` : "—"} />
      </div>

      <Button
        variant={isLong ? "bull" : "bear"}
        className="w-full"
        disabled={!address || open.isPending || collateralScaled <= 0n}
        onClick={() => open.mutate()}
      >
        {!address
          ? "Connect wallet"
          : open.isPending
            ? "Submitting…"
            : `Open ${cappedLeverage}x ${isLong ? "Long" : "Short"}`}
      </Button>

      {open.isSuccess && (
        <p className="text-xs font-mono text-bull">opened ✓ tx {open.data?.slice(0, 12)}…</p>
      )}
      {open.error && (
        <p className="text-xs text-destructive">
          {(open.error as Error).message?.slice(0, 200) ?? "error"}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
