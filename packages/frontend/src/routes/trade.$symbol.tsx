import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMarket, usePositions, usePrices } from "@/api/hooks";
import { useStreamMarket, useStreamPositions, useStreamPrices } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { BiasGauge } from "@/components/ui/bias-gauge";
import { MarkChart, type ChartPriceLine } from "@/components/trade/MarkChart";
import { OrderForm } from "@/components/trade/OrderForm";
import { PositionRow } from "@/components/trade/PositionRow";
import { useAddress } from "@/wallet/WalletProvider";
import { approxLiquidationPrice } from "@/lib/math";
import { parseUsdc } from "@/lib/utils";

const PRICE_UNIT = 10_000_000;

export const Route = createFileRoute("/trade/$symbol")({
  component: TradePage,
});

function TradePage() {
  const { symbol } = Route.useParams();
  const address = useAddress();

  const market = useMarket(symbol);
  const prices = usePrices();
  const positions = usePositions(address);
  useStreamMarket(symbol);
  useStreamPrices();
  useStreamPositions(address);

  const markPrice = prices.data?.find((p) => p.symbol === symbol)?.price;
  const myPositions = (positions.data ?? []).filter((p) => p.symbol === symbol);
  const maxLeverage = market.data?.max_leverage ? Number(market.data.max_leverage) : 20;

  const [side, setSide] = useState<"long" | "short">("long");
  const [collateralInput, setCollateralInput] = useState("100");
  const [leverage, setLeverage] = useState(5);

  // Chart price lines:
  //  - one Entry + one Liq line per open position on this symbol;
  //  - if there are no open positions, draw a single staged-order Liq preview
  //    (no Entry — it'd just track mark price and add visual noise).
  const priceLines = useMemo<ChartPriceLine[]>(() => {
    // Painterly muted palette — matches the new bull/bear/ember tokens.
    const ENTRY_COLOR = "rgba(212, 165, 116, 0.85)"; // ember
    const LIQ_COLOR = "rgba(204, 122, 111, 0.95)";   // bear
    const TP_COLOR = "rgba(154, 181, 155, 0.95)";    // bull
    const SL_COLOR = "rgba(212, 145, 100, 0.95)";    // amber

    if (myPositions.length > 0) {
      const lines: ChartPriceLine[] = [];
      for (const p of myPositions) {
        const entry = BigInt(p.entry_price);
        const collateral = BigInt(p.collateral);
        const size = BigInt(p.size);
        const liq = approxLiquidationPrice(entry, collateral, size, p.is_long);
        const tp = BigInt(p.take_profit);
        const sl = BigInt(p.stop_loss);
        const sideLabel = p.is_long ? "Long" : "Short";
        lines.push({
          id: `entry-${p.id}`,
          price: Number(entry) / PRICE_UNIT,
          color: ENTRY_COLOR,
          title: `Entry ${sideLabel}`,
        });
        if (liq && liq > 0n) {
          lines.push({
            id: `liq-${p.id}`,
            price: Number(liq) / PRICE_UNIT,
            color: LIQ_COLOR,
            title: `Liq. ${sideLabel}`,
          });
        }
        if (tp > 0n) {
          lines.push({
            id: `tp-${p.id}`,
            price: Number(tp) / PRICE_UNIT,
            color: TP_COLOR,
            title: `TP ${sideLabel}`,
          });
        }
        if (sl > 0n) {
          lines.push({
            id: `sl-${p.id}`,
            price: Number(sl) / PRICE_UNIT,
            color: SL_COLOR,
            title: `SL ${sideLabel}`,
          });
        }
      }
      return lines;
    }

    if (!markPrice) return [];
    let collateralScaled = 0n;
    try {
      collateralScaled = parseUsdc(collateralInput);
    } catch {
      collateralScaled = 0n;
    }
    if (collateralScaled <= 0n) return [];
    const sizeScaled = collateralScaled * BigInt(leverage);
    const liq = approxLiquidationPrice(BigInt(markPrice), collateralScaled, sizeScaled, side === "long");
    if (!liq || liq <= 0n) return [];
    return [
      {
        id: "staged-liq",
        price: Number(liq) / PRICE_UNIT,
        color: LIQ_COLOR,
        title: "Liq. (staged)",
      },
    ];
  }, [myPositions, markPrice, collateralInput, leverage, side]);

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Symbol + mark price hero strip */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/30 pb-5">
        <div className="space-y-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Perpetual · Stellar
          </span>
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
              {symbol}
            </h1>
            <span className="font-mono text-3xl tabular-nums tracking-tight text-foreground/95 md:text-4xl">
              {markPrice ? <NumberFlowUsd value={markPrice} /> : "—"}
            </span>
          </div>
        </div>
        {market.data?.max_leverage && (
          <span className="rounded-full border border-border/40 bg-card/40 px-2.5 py-1 font-mono text-[11px] tabular-nums uppercase tracking-[0.18em] text-muted-foreground/80">
            {market.data.max_leverage}× max leverage
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-5">
              <div className="h-[460px]">
                <MarkChart symbol={symbol} priceLines={priceLines} />
              </div>
            </CardContent>
          </Card>

          {market.data && (
            <Card>
              <CardContent className="flex items-center gap-6 px-6 py-5">
                <BiasGauge
                  longOi={market.data.long_open_interest}
                  shortOi={market.data.short_open_interest}
                  size={140}
                />
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                    Market sentiment
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Long vs short open interest
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {address && (
            <Card>
              <CardHeader>
                <CardTitle>Your positions on {symbol}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {myPositions.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border/50 bg-background/30 px-4 py-6 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    No open positions on this market
                  </p>
                )}
                {myPositions.map((p) => (
                  <PositionRow key={p.id} position={p} markPrice={markPrice} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Order</CardTitle>
            <p className="text-[11px] text-muted-foreground/80">Market · fills at the next oracle tick</p>
          </CardHeader>
          <CardContent>
            <OrderForm
              symbol={symbol}
              markPrice={markPrice}
              maxLeverage={maxLeverage}
              side={side}
              setSide={setSide}
              collateralInput={collateralInput}
              setCollateralInput={setCollateralInput}
              leverage={leverage}
              setLeverage={setLeverage}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

