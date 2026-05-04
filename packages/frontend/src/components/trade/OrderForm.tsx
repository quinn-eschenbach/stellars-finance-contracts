import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAddress, useWallet } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { signAndSendWithWallet } from "@/contracts/sender";
import { parsePrice, parseUsdc } from "@/lib/utils";
import { approxLiquidationPrice } from "@/lib/math";
import { queryKeys } from "@/api/hooks";

interface OrderFormProps {
  symbol: string;
  /** Latest mark price for the symbol, scaled (10^7). May be undefined while loading. */
  markPrice?: string;
  /** Per-market max leverage, parsed integer (e.g. 50). */
  maxLeverage?: number;
  side: "long" | "short";
  setSide: (s: "long" | "short") => void;
  collateralInput: string;
  setCollateralInput: (v: string) => void;
  leverage: number;
  setLeverage: (n: number) => void;
}

/**
 * Market-order open form. Order state is owned by the parent so the chart
 * can render entry / liquidation price lines for the staged order. TP/SL
 * are local — only relevant during order construction.
 */
export function OrderForm({
  symbol,
  markPrice,
  maxLeverage = 20,
  side,
  setSide,
  collateralInput,
  setCollateralInput,
  leverage,
  setLeverage,
}: OrderFormProps) {
  const address = useAddress();
  const { signTransaction } = useWallet();
  const qc = useQueryClient();

  const [tpInput, setTpInput] = useState("");
  const [slInput, setSlInput] = useState("");
  const [showTpSl, setShowTpSl] = useState(false);

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

  // Parse TP/SL from inputs. Empty string → 0n (= unset). Invalid input
  // surfaces as a hint and disables submit so we never blast a bad value
  // at the contract.
  const tpScaled = useMemo(() => safeParse(tpInput), [tpInput]);
  const slScaled = useMemo(() => safeParse(slInput), [slInput]);
  const tpError =
    tpScaled === "invalid"
      ? "invalid TP"
      : markPrice && tpScaled && tpScaled > 0n
        ? validateTp(BigInt(markPrice), tpScaled, isLong)
        : null;
  const slError =
    slScaled === "invalid"
      ? "invalid SL"
      : markPrice && slScaled && slScaled > 0n
        ? validateSl(BigInt(markPrice), slScaled, isLong)
        : null;

  const open = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      if (collateralScaled <= 0n) throw new Error("enter a positive collateral");
      if (tpError || slError) throw new Error(tpError || slError || "invalid TP/SL");
      const tx = await positionManager(address).increase_position({
        trader: address,
        symbol,
        size: sizeScaled,
        collateral: collateralScaled,
        is_long: isLong,
        take_profit: typeof tpScaled === "bigint" ? tpScaled : 0n,
        stop_loss: typeof slScaled === "bigint" ? slScaled : 0n,
      });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions(address ?? "") });
    },
  });

  const cappedLeverage = Math.min(leverage, Math.max(1, maxLeverage));
  const submitDisabled =
    !address || open.isPending || collateralScaled <= 0n || !!tpError || !!slError;

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

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowTpSl((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <span>Take profit / Stop loss (optional)</span>
          <span className="font-mono">{showTpSl ? "−" : "+"}</span>
        </button>
        {showTpSl && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Take profit</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={tpInput}
                onChange={(e) => setTpInput(e.target.value)}
                placeholder={isLong ? "above mark" : "below mark"}
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
                placeholder={isLong ? "below mark" : "above mark"}
              />
              {slError && <p className="text-xs text-destructive">{slError}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1 rounded-md border border-border bg-secondary/30 p-3 font-mono text-xs">
        <Row label="Size" value={<NumberFlowUsd value={sizeScaled} />} />
        <Row label="Mark price" value={markPrice ? <NumberFlowUsd value={markPrice} /> : "—"} />
        <Row label="Est. liq price" value={liq ? <NumberFlowUsd value={liq} /> : "—"} />
      </div>

      <Button
        variant={isLong ? "bull" : "bear"}
        className="w-full"
        disabled={submitDisabled}
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

/** Parse a TP/SL input. Empty → 0n (unset); bad input → "invalid" sentinel. */
function safeParse(input: string): bigint | "invalid" {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  try {
    return parsePrice(trimmed);
  } catch {
    return "invalid";
  }
}

/** Mirror of `validate_tp_sl` in the contract — checked against mark as a stand-in for entry. */
function validateTp(markPrice: bigint, tp: bigint, isLong: boolean): string | null {
  if (isLong && tp <= markPrice) return "TP must be above mark";
  if (!isLong && tp >= markPrice) return "TP must be below mark";
  return null;
}
function validateSl(markPrice: bigint, sl: bigint, isLong: boolean): string | null {
  if (isLong && sl >= markPrice) return "SL must be below mark";
  if (!isLong && sl <= markPrice) return "SL must be above mark";
  return null;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
