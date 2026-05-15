import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { Slider } from "@/components/ui/slider";
import { useAddress } from "@/wallet/WalletProvider";
import { positionManager } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { cn, formatUsdc, parsePrice, parseUsdc } from "@/lib/utils";
import { approxLiquidationPrice } from "@/lib/math";
import { queryKeys, useWalletBalance } from "@/api/hooks";

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

const QUICK_AMOUNTS = ["100", "500", "1000", "5000"];

const SLIPPAGE_PRESETS_BPS = [10, 50, 100] as const; // 0.1%, 0.5%, 1%
const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 5000; // 50% — beyond this, just pass 0 to opt out

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
  const balance = useWalletBalance(address);

  const [tpInput, setTpInput] = useState("");
  const [slInput, setSlInput] = useState("");
  const [showTpSl, setShowTpSl] = useState(false);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [slippageCustom, setSlippageCustom] = useState("");

  const collateralScaled = useMemo(() => {
    try {
      return parseUsdc(collateralInput);
    } catch {
      return 0n;
    }
  }, [collateralInput]);

  const sizeScaled = collateralScaled * BigInt(leverage);
  const isLong = side === "long";
  const cappedLeverage = Math.min(leverage, Math.max(1, maxLeverage));
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

  // `acceptable_price` worst-case the trade is willing to fill at.
  // Long: mark * (1 + slippage); Short: mark * (1 - slippage).
  // Pass 0 to opt out — match the contract convention.
  const acceptablePrice = useMemo(() => {
    if (!markPrice || slippageBps <= 0) return 0n;
    const mark = BigInt(markPrice);
    const delta = (mark * BigInt(slippageBps)) / 10_000n;
    return isLong ? mark + delta : mark - delta;
  }, [markPrice, slippageBps, isLong]);

  const open = useTxMutation({
    action: `Open ${cappedLeverage}× ${isLong ? "long" : "short"} ${symbol}`,
    successDetail: `Position opened on ${symbol} with ${collateralInput} USDC.`,
    invalidate: [queryKeys.positions(address ?? ""), queryKeys.walletBalance(address)],
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      if (collateralScaled <= 0n) throw new Error("enter a positive collateral");
      if (tpError || slError) throw new Error(tpError || slError || "invalid TP/SL");
      return positionManager(address).increase_position({
        trader: address,
        symbol,
        size: sizeScaled,
        collateral: collateralScaled,
        is_long: isLong,
        take_profit: typeof tpScaled === "bigint" ? tpScaled : 0n,
        stop_loss: typeof slScaled === "bigint" ? slScaled : 0n,
        acceptable_price: acceptablePrice,
      });
    },
  });

  const walletBalance = balance.data ?? 0n;
  const exceedsBalance = collateralScaled > 0n && walletBalance > 0n && collateralScaled > walletBalance;
  const submitDisabled =
    !address ||
    open.isPending ||
    collateralScaled <= 0n ||
    !!tpError ||
    !!slError ||
    exceedsBalance;

  return (
    <div className="space-y-5">
      {/* Side toggle — sliding bull/bear segmented control */}
      <SideToggle isLong={isLong} setSide={setSide} />

      {/* Collateral with quick-amount chips */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Collateral</Label>
          {address ? (
            <button
              type="button"
              onClick={() => walletBalance > 0n && setCollateralInput(formatBalanceInput(walletBalance))}
              className={cn(
                "font-mono text-[11px] tracking-tight transition-colors",
                exceedsBalance
                  ? "text-bear"
                  : "text-muted-foreground/80 hover:text-foreground",
              )}
              title={walletBalance > 0n ? "Use full balance" : undefined}
            >
              <span className="uppercase tracking-[0.18em] text-muted-foreground/60">Bal</span>{" "}
              <NumberFlowUsd value={walletBalance} />
            </button>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
              USDC
            </span>
          )}
        </div>
        <Input
          type="text"
          inputMode="decimal"
          value={collateralInput}
          onChange={(e) => setCollateralInput(e.target.value)}
          placeholder="0.00"
          className={cn("h-12 text-lg", exceedsBalance && "border-bear/60")}
        />
        <div className="flex gap-1.5">
          {QUICK_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setCollateralInput(amt)}
              className={cn(
                "flex-1 rounded-lg border border-border/50 bg-card/30 px-2 py-1 font-mono text-[11px] tracking-tight text-muted-foreground transition-all hover:border-ember/50 hover:bg-card/60 hover:text-foreground",
                collateralInput === amt && "border-ember/60 bg-ember/10 text-foreground",
              )}
            >
              {amt}
            </button>
          ))}
        </div>
      </div>

      {/* Leverage with marker pips */}
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <Label>Leverage</Label>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl leading-none text-foreground">{cappedLeverage}</span>
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">×</span>
          </div>
        </div>
        <Slider
          min={1}
          max={maxLeverage}
          step={1}
          value={cappedLeverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
        />
        <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
          <span>1×</span>
          <span>{Math.round(maxLeverage / 2)}×</span>
          <span>{maxLeverage}×</span>
        </div>
      </div>

      {/* TP / SL accordion */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowTpSl((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground transition-all hover:border-border/70 hover:text-foreground"
        >
          <span>Take profit / Stop loss</span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showTpSl && "rotate-180")} />
        </button>
        {showTpSl && (
          <div className="grid grid-cols-2 gap-2 animate-fade-up">
            <div className="space-y-1">
              <Input
                type="text"
                inputMode="decimal"
                value={tpInput}
                onChange={(e) => setTpInput(e.target.value)}
                placeholder={isLong ? "TP above mark" : "TP below mark"}
              />
              {tpError && <p className="font-mono text-[10px] text-destructive">{tpError}</p>}
            </div>
            <div className="space-y-1">
              <Input
                type="text"
                inputMode="decimal"
                value={slInput}
                onChange={(e) => setSlInput(e.target.value)}
                placeholder={isLong ? "SL below mark" : "SL above mark"}
              />
              {slError && <p className="font-mono text-[10px] text-destructive">{slError}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Slippage tolerance — chip presets + custom input */}
      <SlippageRow
        bps={slippageBps}
        setBps={setSlippageBps}
        customInput={slippageCustom}
        setCustomInput={setSlippageCustom}
      />

      {/* Order summary */}
      <div className="space-y-1.5 rounded-xl border border-border/40 bg-background/30 p-3.5">
        <Row label="Size" value={<NumberFlowUsd value={sizeScaled} />} />
        <Row
          label="Mark price"
          value={markPrice ? <NumberFlowUsd value={markPrice} decimals="adaptive" /> : "—"}
        />
        <Row
          label={isLong ? "Max fill price" : "Min fill price"}
          value={
            acceptablePrice > 0n
              ? <NumberFlowUsd value={acceptablePrice} decimals="adaptive" />
              : "Any"
          }
        />
        <Row
          label="Est. liq. price"
          value={liq ? <NumberFlowUsd value={liq} decimals="adaptive" /> : "—"}
          tone="warn"
        />
      </div>

      <Button
        variant={isLong ? "bull" : "bear"}
        size="lg"
        className="w-full"
        disabled={submitDisabled}
        onClick={() => open.mutate()}
      >
        {!address
          ? "Connect wallet"
          : open.isPending
            ? "Submitting…"
            : exceedsBalance
              ? "Insufficient USDC balance"
              : `Open ${cappedLeverage}× ${isLong ? "Long" : "Short"}`}
      </Button>
    </div>
  );
}

function SideToggle({
  isLong,
  setSide,
}: {
  isLong: boolean;
  setSide: (s: "long" | "short") => void;
}) {
  return (
    <div className="relative grid grid-cols-2 gap-1 rounded-full border border-border/50 bg-card/40 p-1 backdrop-blur-md">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 z-0 rounded-full transition-[transform,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0.2,1)]"
        style={{
          left: "0.25rem",
          width: "calc(50% - 0.375rem)",
          transform: isLong ? "translateX(0)" : "translateX(calc(100% + 0.25rem))",
          backgroundColor: isLong
            ? "hsl(var(--bull) / 0.20)"
            : "hsl(var(--bear) / 0.20)",
          boxShadow: isLong
            ? "inset 0 0 0 1px hsl(var(--bull) / 0.4), 0 0 24px -8px hsl(var(--bull) / 0.5)"
            : "inset 0 0 0 1px hsl(var(--bear) / 0.4), 0 0 24px -8px hsl(var(--bear) / 0.5)",
        }}
      />
      <SideButton kind="long" active={isLong} onClick={() => setSide("long")} />
      <SideButton kind="short" active={!isLong} onClick={() => setSide("short")} />
    </div>
  );
}

function SideButton({
  active,
  kind,
  onClick,
}: {
  active: boolean;
  kind: "long" | "short";
  onClick: () => void;
}) {
  const isLong = kind === "long";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 flex h-9 items-center justify-center gap-1.5 rounded-full text-xs font-medium tracking-tight transition-colors duration-200",
        active
          ? isLong
            ? "text-bull"
            : "text-bear"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-opacity",
          isLong ? "bg-bull" : "bg-bear",
          !active && "opacity-50",
        )}
      />
      {isLong ? "Long" : "Short"}
    </button>
  );
}

/**
 * Convert a scaled USDC balance back into the decimal string the input
 * expects. Truncates to 2dp so we never prompt the user to spend a fraction
 * of a cent more than they hold.
 */
function formatBalanceInput(scaled: bigint): string {
  if (scaled <= 0n) return "0";
  return formatUsdc(scaled, { decimals: 2 }).replace(/,/g, "").replace(/\.00$/, "");
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

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "warn";
}) {
  return (
    <div className="flex items-center justify-between font-mono text-xs">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">{label}</span>
      <span className={cn("tabular-nums", tone === "warn" && "text-bear/90")}>{value}</span>
    </div>
  );
}

function SlippageRow({
  bps,
  setBps,
  customInput,
  setCustomInput,
}: {
  bps: number;
  setBps: (n: number) => void;
  customInput: string;
  setCustomInput: (s: string) => void;
}) {
  const isPreset = (SLIPPAGE_PRESETS_BPS as readonly number[]).includes(bps);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Slippage tolerance</Label>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
          {formatBps(bps)}
        </span>
      </div>
      <div className="flex gap-1.5">
        {SLIPPAGE_PRESETS_BPS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setBps(preset);
              setCustomInput("");
            }}
            className={cn(
              "flex-1 rounded-lg border border-border/50 bg-card/30 px-2 py-1 font-mono text-[11px] tracking-tight text-muted-foreground transition-all hover:border-ember/50 hover:bg-card/60 hover:text-foreground",
              bps === preset && !customInput && "border-ember/60 bg-ember/10 text-foreground",
            )}
          >
            {formatBps(preset)}
          </button>
        ))}
        <Input
          type="text"
          inputMode="decimal"
          value={customInput}
          onChange={(e) => {
            const v = e.target.value;
            setCustomInput(v);
            const parsed = parseSlippagePct(v);
            if (parsed !== null) setBps(parsed);
            else if (v.trim() === "") setBps(DEFAULT_SLIPPAGE_BPS);
          }}
          placeholder="custom %"
          className={cn(
            "h-7 flex-[1.2] px-2 font-mono text-[11px]",
            !isPreset && customInput && "border-ember/60 bg-ember/5",
          )}
        />
      </div>
    </div>
  );
}

/** Format bps as a percent string ("50" → "0.5%"). */
function formatBps(bps: number): string {
  const pct = bps / 100;
  return pct >= 1 ? `${pct.toFixed(pct % 1 === 0 ? 0 : 2)}%` : `${pct.toFixed(2)}%`;
}

/** Parse a user-typed percent ("0.5" or "0.5%") to bps. Returns null if invalid or out of range. */
function parseSlippagePct(input: string): number | null {
  const trimmed = input.trim().replace(/%$/, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0) return null;
  const bps = Math.round(pct * 100);
  if (bps > MAX_SLIPPAGE_BPS) return null;
  return bps;
}
