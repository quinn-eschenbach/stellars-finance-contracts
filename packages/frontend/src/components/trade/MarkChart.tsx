import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCandles, queryKeys } from "@/api/hooks";
import type { CandleInterval, CandleRow, PriceRow } from "@/api/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const PRICE_UNIT = 10_000_000;

const INTERVALS: ReadonlyArray<{ label: string; value: CandleInterval }> = [
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
  { label: "15m", value: 900 },
  { label: "1h", value: 3600 },
  { label: "4h", value: 14400 },
  { label: "1d", value: 86400 },
];

interface MarkChartProps {
  symbol: string;
  className?: string;
}

/**
 * Mark-price candlestick chart. Backfills from `/prices/:symbol/candles` and
 * keeps the latest candle live by reading the React Query prices cache (kept
 * fresh by the global price SSE stream — no extra subscription here).
 */
export function MarkChart({ symbol, className }: MarkChartProps) {
  const [interval, setInterval] = useState<CandleInterval>(60);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastBucketRef = useRef<{ time: number; high: number; low: number; open: number } | null>(null);

  const candles = useCandles(symbol, interval);
  const qc = useQueryClient();

  // Mount the chart once. Resize observer keeps the canvas matched to the
  // container so layout shifts (sidebar collapse, window resize) don't leave
  // the chart frozen at its initial width.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBucketRef.current = null;
    };
  }, []);

  // Push the backfilled candles into the series whenever the query updates
  // (initial load, interval change, refetch).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles.data) return;
    const data = toCandlestickData(candles.data);
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
    const last = candles.data[candles.data.length - 1];
    lastBucketRef.current = last
      ? {
          time: last.time,
          open: scaledToNumber(last.open),
          high: scaledToNumber(last.high),
          low: scaledToNumber(last.low),
        }
      : null;
  }, [candles.data]);

  // Subscribe to the prices query cache so the latest candle ticks live
  // without opening a second EventSource. The trade page already mounts
  // useStreamPrices, which patches this cache as oracle ticks arrive.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const unsub = qc.getQueryCache().subscribe((event) => {
      if (event?.type !== "updated") return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key[0] !== "prices") return;
      const prices = event.query.state.data as PriceRow[] | undefined;
      const latest = prices?.find((p) => p.symbol === symbol);
      if (!latest) return;
      applyTick(series, lastBucketRef, latest, interval);
    });
    return () => unsub();
  }, [qc, symbol, interval]);

  const status = useMemo(() => {
    if (candles.isLoading) return "Loading candles…";
    if (candles.error) return "Failed to load candles.";
    if ((candles.data?.length ?? 0) === 0) return "No price history yet.";
    return null;
  }, [candles.data, candles.isLoading, candles.error]);

  return (
    <div className={cn("flex h-full flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <Tabs
          value={String(interval)}
          onValueChange={(v) => setInterval(Number(v) as CandleInterval)}
        >
          <TabsList className="bg-muted/40">
            {INTERVALS.map((i) => (
              <TabsTrigger key={i.value} value={String(i.value)} className="text-xs">
                {i.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="relative flex-1 min-h-[320px]">
        <div ref={containerRef} className="absolute inset-0" />
        {status && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

function scaledToNumber(scaled: string): number {
  return Number(scaled) / PRICE_UNIT;
}

function toCandlestickData(rows: CandleRow[]): CandlestickData<UTCTimestamp>[] {
  return rows.map((r) => ({
    time: r.time as UTCTimestamp,
    open: scaledToNumber(r.open),
    high: scaledToNumber(r.high),
    low: scaledToNumber(r.low),
    close: scaledToNumber(r.close),
  }));
}

/**
 * Fold a single oracle tick into the live candle. If the tick falls into a
 * new bucket we open a new candle; otherwise we extend the current one's
 * high/low/close.
 */
function applyTick(
  series: ISeriesApi<"Candlestick">,
  lastRef: React.MutableRefObject<{ time: number; high: number; low: number; open: number } | null>,
  price: PriceRow,
  interval: CandleInterval,
) {
  const ts = Number(price.timestamp);
  if (!Number.isFinite(ts)) return;
  const bucket = Math.floor(ts / interval) * interval;
  const value = scaledToNumber(price.price);
  const last = lastRef.current;
  if (!last || bucket > last.time) {
    const next = { time: bucket, open: value, high: value, low: value };
    lastRef.current = next;
    series.update({
      time: bucket as UTCTimestamp,
      open: value,
      high: value,
      low: value,
      close: value,
    });
    return;
  }
  if (bucket < last.time) return; // out-of-order tick — ignore
  const high = Math.max(last.high, value);
  const low = Math.min(last.low, value);
  lastRef.current = { time: last.time, open: last.open, high, low };
  series.update({
    time: last.time as UTCTimestamp,
    open: last.open,
    high,
    low,
    close: value,
  });
}
