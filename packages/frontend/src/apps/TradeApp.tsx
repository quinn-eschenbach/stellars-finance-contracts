import { useMemo, useState } from "react";
import { Frame, Tab, TabBody, Tabs } from "react95";
import { useMarket, usePositions, usePrices, useProtocolConfig } from "@/api/hooks";
import { usePositionEvaluation } from "@/api/positionEvaluation";
import { useStreamMarket, useStreamPositions, useStreamPrices } from "@/api/sse";
import { MarkChart, type ChartPriceLine } from "@/components/trade/MarkChart";
import { OrderForm } from "@/components/trade/OrderForm";
import { PositionPanel } from "@/components/trade/PositionPanel";
import { useAddress } from "@/wallet/WalletProvider";
import { liquidationPriceAtOpen } from "@stellars/protocol-math";
import { descale, parseUsdc } from "@/lib/utils";

/** Per-market trading window: chart, position management, order form. */
export function TradeApp({ param }: { param?: string }) {
  const symbol = param ?? "";
  const address = useAddress();

  const market = useMarket(symbol);
  const prices = usePrices();
  const positions = usePositions(address);
  const config = useProtocolConfig();
  useStreamMarket(symbol);
  useStreamPrices();
  useStreamPositions(address);

  const markPrice = prices.data?.find((p) => p.symbol === symbol)?.price;
  // One position per market — the panel below the chart manages it.
  const myPosition = (positions.data ?? []).find((p) => p.symbol === symbol) ?? null;
  const positionView = usePositionEvaluation(myPosition, markPrice);
  const maxLeverage = market.data?.max_leverage ? Number(market.data.max_leverage) : 20;
  const liqThresholdBps = BigInt(config.data?.liquidation_threshold_bps ?? 0);

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

  // Chart price lines:
  //  - Entry + Liq + TP + SL for the open position on this symbol;
  //  - otherwise a single staged-order Liq preview (no Entry — it'd just
  //    track mark price and add visual noise).
  const priceLines = useMemo<ChartPriceLine[]>(() => {
    // VGA palette — matches the Win95 bull/bear/ember tokens.
    const ENTRY_COLOR = "#000080"; // navy
    const LIQ_COLOR = "#b80000"; // bear red
    const TP_COLOR = "#006600"; // bull green
    const SL_COLOR = "#808000"; // olive

    if (myPosition && positionView) {
      const { entryPrice, liqPrice, tp, sl, isLong } = positionView;
      const sideLabel = isLong ? "Long" : "Short";
      const lines: ChartPriceLine[] = [
        {
          id: `entry-${myPosition.id}`,
          price: descale(entryPrice),
          color: ENTRY_COLOR,
          title: `Entry ${sideLabel}`,
        },
      ];
      if (liqPrice && liqPrice > 0n) {
        lines.push({
          id: `liq-${myPosition.id}`,
          price: descale(liqPrice),
          color: LIQ_COLOR,
          title: `Liq. ${sideLabel}`,
        });
      }
      if (tp > 0n) {
        lines.push({
          id: `tp-${myPosition.id}`,
          price: descale(tp),
          color: TP_COLOR,
          title: `TP ${sideLabel}`,
        });
      }
      if (sl > 0n) {
        lines.push({
          id: `sl-${myPosition.id}`,
          price: descale(sl),
          color: SL_COLOR,
          title: `SL ${sideLabel}`,
        });
      }
      return lines;
    }

    if (!markPrice || collateralScaled <= 0n) return [];
    const liq = liquidationPriceAtOpen(
      BigInt(markPrice),
      collateralScaled,
      sizeScaled,
      side === "long",
      liqThresholdBps,
    );
    if (!liq || liq <= 0n) return [];
    return [
      {
        id: "staged-liq",
        price: descale(liq),
        color: LIQ_COLOR,
        title: "Liq. (staged)",
      },
    ];
  }, [myPosition, positionView, markPrice, collateralScaled, sizeScaled, side, liqThresholdBps]);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-[300px] flex-1 space-y-2">
        {/* MarkChart brings its own interval row + sunken field frame. */}
        <div className="h-[400px]">
          <MarkChart symbol={symbol} priceLines={priceLines} />
        </div>

        {/* Only when a position exists — no position, no panel, more chart. */}
        {myPosition && (
          <Frame variant="window" className="!block w-full !p-2">
            <p className="mb-2 text-xs font-bold">Your {symbol} position</p>
            <PositionPanel position={myPosition} markPrice={markPrice} />
          </Frame>
        )}
      </div>

      {/* Long/Short as real Win95 tabs sitting on the order panel. */}
      <div className="w-full sm:w-[300px]">
        <Tabs value={side} onChange={(v) => setSide(v as "long" | "short")}>
          <Tab value="long" className="!font-bold text-bull">
            Long
          </Tab>
          <Tab value="short" className="!font-bold text-bear">
            Short
          </Tab>
        </Tabs>
        <TabBody>
          <OrderForm
            symbol={symbol}
            markPrice={markPrice}
            maxLeverage={maxLeverage}
            side={side}
            collateralInput={collateralInput}
            setCollateralInput={setCollateralInput}
            leverage={leverage}
            setLeverage={setLeverage}
            hasPosition={!!myPosition}
          />
        </TabBody>
      </div>
    </div>
  );
}
