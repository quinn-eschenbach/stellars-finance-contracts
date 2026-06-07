import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { Slider } from "@/components/ui/slider";
import { useAddress } from "@/wallet/WalletProvider";
import { LogOnPrompt } from "@/desktop/Logon";
import { positionManager } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { cn, descale, numberToAmount, parsePrice, parseUsdc } from "@/lib/utils";
import { useIncreaseQuote } from "@/api/quote";
import { queryKeys, useWalletBalance } from "@/api/hooks";

interface OrderFormProps {
  symbol: string;
  /** Latest mark price for the symbol, scaled (10^7). May be undefined while loading. */
  markPrice?: string;
  /** Per-market max leverage, parsed integer (e.g. 50). */
  maxLeverage?: number;
  /** Owned by the parent — the Long/Short tabs above the form set it. */
  side: "long" | "short";
  collateralInput: string;
  setCollateralInput: (v: string) => void;
  leverage: number;
  setLeverage: (n: number) => void;
  /** True when a position is already open on this market — submit increases it. */
  hasPosition?: boolean;
}

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

const SLIPPAGE_PRESETS_BPS = [10, 50, 100] as const; // 0.1%, 0.5%, 1%
const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 5000; // 50% — beyond this, just pass 0 to opt out

/**
 * Market-order open/increase form. Order state is owned by the parent so the
 * chart and the preview panel can react to the staged order. TP/SL are local
 * — only relevant during order construction.
 */
export function OrderForm({
  symbol,
  markPrice,
  maxLeverage = 20,
  side,
  collateralInput,
  setCollateralInput,
  leverage,
  setLeverage,
  hasPosition = false,
}: OrderFormProps) {
  const address = useAddress();
  const balance = useWalletBalance(address);

  // TP/SL as plain numbers — 0 means unset, matching the contract convention.
  const [tpValue, setTpValue] = useState(0);
  const [slValue, setSlValue] = useState(0);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [showDetails, setShowDetails] = useState(false);

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

  // Scale TP/SL for the contract. 0 = unset; validation only runs on set
  // values so we never blast a bad trigger at the contract.
  const tpScaled = useMemo(() => (tpValue > 0 ? parsePrice(numberToAmount(tpValue)) : 0n), [tpValue]);
  const slScaled = useMemo(() => (slValue > 0 ? parsePrice(numberToAmount(slValue)) : 0n), [slValue]);
  const tpError =
    markPrice && tpScaled > 0n ? validateTp(BigInt(markPrice), tpScaled, isLong) : null;
  const slError =
    markPrice && slScaled > 0n ? validateSl(BigInt(markPrice), slScaled, isLong) : null;

  // Staged IncreaseQuote — costs + liquidity feasibility for the order as
  // currently configured. Recomputed by `useIncreaseQuote` from the same
  // cached vault / market / config / fee-config the form would render anyway.
  const quote = useIncreaseQuote(
    symbol,
    collateralScaled > 0n
      ? {
          collateral: collateralScaled,
          size: sizeScaled,
          is_long: isLong,
          slippage_bps: BigInt(slippageBps),
        }
      : null,
    address,
  );

  const acceptablePrice = quote?.acceptable_price ?? 0n;
  const exceedsLiquidity = quote?.exceeds_liquidity ?? false;
  const liquidityHeadroom = quote?.liquidity_headroom ?? null;
  const liq = quote?.liquidation_price ?? null;

  const open = useTxMutation({
    action: hasPosition
      ? `Increase ${isLong ? "long" : "short"} ${symbol}`
      : `Open ${cappedLeverage}× ${isLong ? "long" : "short"} ${symbol}`,
    successDetail: hasPosition
      ? `Position increased on ${symbol} with ${collateralInput} USDC.`
      : `Position opened on ${symbol} with ${collateralInput} USDC.`,
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
        take_profit: tpScaled,
        stop_loss: slScaled,
        acceptable_price: acceptablePrice,
      });
    },
  });

  const walletBalance = balance.data ?? 0n;
  const exceedsBalance = collateralScaled > 0n && walletBalance > 0n && collateralScaled > walletBalance;
  const submitDisabled =
    open.isPending ||
    collateralScaled <= 0n ||
    !!tpError ||
    !!slError ||
    exceedsBalance ||
    exceedsLiquidity;

  return (
    <div className="space-y-4">
      {/* Collateral with quick-amount buttons */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Collateral (USDC)</Label>
          {address && (
            <button
              type="button"
              onClick={() => walletBalance > 0n && setCollateralInput(formatBalanceInput(walletBalance))}
              className={cn("font-mono text-xs underline", exceedsBalance && "text-bear")}
              title={walletBalance > 0n ? "Use full balance" : undefined}
            >
              Bal <NumberFlowUsd value={walletBalance} />
            </button>
          )}
        </div>
        <NumberInput
          value={Number(collateralInput) || 0}
          onChange={(v) => setCollateralInput(numberToAmount(v))}
          min={0}
          step={50}
          width="100%"
        />
        <div className="flex gap-1">
          {QUICK_AMOUNTS.map((amt) => (
            <Button
              key={amt}
              size="sm"
              active={Number(collateralInput) === amt}
              onClick={() => setCollateralInput(String(amt))}
              className="flex-1 font-mono"
            >
              {amt}
            </Button>
          ))}
        </div>
      </div>

      {/* Leverage */}
      <div className="space-y-1">
        <div className="flex items-end justify-between">
          <Label>Leverage</Label>
          <span className="font-mono text-sm font-bold tabular-nums">{cappedLeverage}×</span>
        </div>
        <Slider
          min={1}
          max={maxLeverage}
          step={1}
          value={cappedLeverage}
          onChange={(value) => setLeverage(value)}
        />
        <div className="flex justify-between font-mono text-xs">
          <span>1×</span>
          <span>{Math.round(maxLeverage / 2)}×</span>
          <span>{maxLeverage}×</span>
        </div>
      </div>

      {/* TP / SL — always visible, 0 = unset */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">TP ({isLong ? "above" : "below"} mark)</Label>
          <NumberInput value={tpValue} onChange={setTpValue} min={0} width="100%" />
          {tpError && <p className="font-mono text-xs text-destructive">{tpError}</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">SL ({isLong ? "below" : "above"} mark)</Label>
          <NumberInput value={slValue} onChange={setSlValue} min={0} width="100%" />
          {slError && <p className="font-mono text-xs text-destructive">{slError}</p>}
        </div>
      </div>

      {/* The one summary line a trader needs before submitting. */}
      {sizeScaled > 0n && (
        <div className="flex items-center justify-between font-mono text-xs tabular-nums">
          <span>
            Size <NumberFlowUsd value={sizeScaled} decimals={0} />
          </span>
          <span className={cn(liq && liq > 0n && "text-bear")}>
            Liq {liq && liq > 0n ? <NumberFlowUsd value={liq} decimals="adaptive" /> : "—"}
          </span>
        </div>
      )}

      {exceedsLiquidity && liquidityHeadroom !== null && (
        <p className="text-xs font-bold text-bear">
          Exceeds vault liquidity — headroom{" "}
          <span className="font-mono tabular-nums">
            <NumberFlowUsd value={liquidityHeadroom} decimals={0} />
          </span>
        </p>
      )}

      {!address ? (
        <LogOnPrompt buttonLabel="Log On to Trade" />
      ) : (
        <Button
          variant={isLong ? "bull" : "bear"}
          size="lg"
          className="w-full"
          disabled={submitDisabled}
          onClick={() => open.mutate()}
        >
          {open.isPending
            ? "Submitting…"
            : exceedsBalance
              ? "Insufficient USDC balance"
              : exceedsLiquidity
                ? "Exceeds vault liquidity"
                : hasPosition
                  ? `Increase ${isLong ? "Long" : "Short"}`
                  : `Open ${cappedLeverage}× ${isLong ? "Long" : "Short"}`}
        </Button>
      )}

      {/* Win95 dialog-grow: everything a trader checks once lives down here. */}
      <Button
        size="sm"
        active={showDetails}
        onClick={() => setShowDetails((v) => !v)}
        className="w-full"
      >
        Details {showDetails ? "«" : "»"}
      </Button>
      {showDetails && (
        <div className="space-y-3">
          <SlippageRow bps={slippageBps} setBps={setSlippageBps} />
          <div className="space-y-1">
            <DetailRow
              label={isLong ? "Max fill price" : "Min fill price"}
              value={
                acceptablePrice > 0n ? (
                  <NumberFlowUsd value={acceptablePrice} decimals="adaptive" />
                ) : sizeScaled > 0n ? (
                  "Any"
                ) : (
                  "—"
                )
              }
            />
            <DetailRow
              label="Open fee"
              value={
                quote && sizeScaled > 0n ? <NumberFlowUsd value={quote.open_fee} decimals={2} /> : "—"
              }
            />
            <DetailRow
              label="Borrow / day"
              value={
                quote && sizeScaled > 0n ? (
                  <NumberFlowUsd value={quote.daily_borrow} decimals={2} />
                ) : (
                  "—"
                )
              }
            />
            <DetailRow
              label="Funding / day"
              value={
                quote && sizeScaled > 0n ? (
                  <span
                    className={cn(
                      quote.daily_funding > 0n
                        ? "text-bull"
                        : quote.daily_funding < 0n
                          ? "text-bear"
                          : undefined,
                    )}
                  >
                    <NumberFlowUsd value={quote.daily_funding} decimals={2} signDisplay="exceptZero" />
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Convert a scaled USDC balance back into the decimal string the input
 * expects. Truncates to 2dp so we never prompt the user to spend a fraction
 * of a cent more than they hold.
 */
function formatBalanceInput(scaled: bigint): string {
  if (scaled <= 0n) return "0";
  return numberToAmount(Math.floor(descale(scaled) * 100) / 100);
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

function SlippageRow({ bps, setBps }: { bps: number; setBps: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>Slippage tolerance</Label>
        <span className="font-mono text-xs tabular-nums">{formatBps(bps)}</span>
      </div>
      <div className="flex gap-1">
        {SLIPPAGE_PRESETS_BPS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            active={bps === preset}
            onClick={() => setBps(preset)}
            className="flex-1 font-mono"
          >
            {formatBps(preset)}
          </Button>
        ))}
        <NumberInput
          value={bps / 100}
          onChange={(v) => {
            const next = Math.round(v * 100);
            if (Number.isFinite(next) && next >= 0 && next <= MAX_SLIPPAGE_BPS) setBps(next);
          }}
          min={0}
          max={MAX_SLIPPAGE_BPS / 100}
          step={0.1}
          width={96}
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

