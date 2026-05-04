import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMarket, usePositions, usePrices } from "@/api/hooks";
import { useStreamMarket, useStreamPositions, useStreamPrices } from "@/api/sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberFlowUsd } from "@/components/ui/number-flow";
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
    const ENTRY_COLOR = "rgba(168, 162, 255, 0.95)";
    const LIQ_COLOR = "hsl(0, 70%, 60%)";
    const TP_COLOR = "hsl(142, 70%, 55%)";
    const SL_COLOR = "hsl(30, 90%, 60%)";

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
    <div className="space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{symbol}</h1>
        <span className="font-mono text-xl">
          {markPrice ? <NumberFlowUsd value={markPrice} /> : "—"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Chart</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[420px]">
                <MarkChart symbol={symbol} priceLines={priceLines} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Market</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              {market.data && (
                <>
                  <Stat label="Long OI" value={<NumberFlowUsd value={market.data.long_open_interest} />} />
                  <Stat label="Short OI" value={<NumberFlowUsd value={market.data.short_open_interest} />} />
                  <Stat label="Max leverage" value={`${market.data.max_leverage}x`} />
                  <Stat
                    label="Mark unrealized"
                    value={
                      <NumberFlowUsd
                        value={market.data.market_unrealized_pnl}
                        signDisplay="exceptZero"
                      />
                    }
                  />
                </>
              )}
            </CardContent>
          </Card>

          {address && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">My positions on {symbol}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {myPositions.length === 0 && (
                  <p className="text-sm text-muted-foreground">No open positions on this market.</p>
                )}
                {myPositions.map((p) => (
                  <PositionRow key={p.id} position={p} markPrice={markPrice} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader className="space-y-0.5">
            <CardTitle className="text-sm">Order</CardTitle>
            <p className="text-xs text-muted-foreground">Market — fills at the next oracle tick.</p>
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

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col font-mono">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
