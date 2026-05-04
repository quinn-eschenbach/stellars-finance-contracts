import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCandles } from "@/api/hooks";
import type { CandleInterval, CandleRow, PriceRow } from "@/api/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, descale, priceDecimals } from "@/lib/utils";

const INTERVALS: ReadonlyArray<{ label: string; value: CandleInterval }> = [
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
  { label: "1h", value: 3600 },
  { label: "1d", value: 86400 },
];

/**
 * One horizontal price line keyed by `id` for stable diffing across renders.
 * The chart adds/updates/removes lines as the array changes — callers don't
 * have to imperatively manage line lifecycle.
 */
export interface ChartPriceLine {
  id: string;
  price: number;
  color: string;
  title: string;
}

interface MarkChartProps {
  symbol: string;
  className?: string;
  priceLines?: ChartPriceLine[];
}

/**
 * Mark-price candlestick chart. Backfills from `/prices/:symbol/candles` and
 * keeps the latest candle live by reading the React Query prices cache (kept
 * fresh by the global price SSE stream — no extra subscription here).
 *
 * Optional `priceLines` renders horizontal price lines, identified by `id`
 * so updates don't recreate the whole set.
 */
export function MarkChart({ symbol, className, priceLines }: MarkChartProps) {
  const [interval, setInterval] = useState<CandleInterval>(60);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastBucketRef = useRef<{ time: number; high: number; low: number; open: number } | null>(null);
  const linesRef = useRef<Map<string, IPriceLine>>(new Map());

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
        textColor: "rgba(232, 218, 195, 0.55)",
        fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,225,180,0.04)" },
        horzLines: { color: "rgba(255,225,180,0.04)" },
      },
      rightPriceScale: { borderColor: "rgba(255,225,180,0.08)" },
      timeScale: {
        borderColor: "rgba(255,225,180,0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });
    // Muted painterly palette — sage/moss for bull, brick/terracotta for bear.
    const BULL = "#9ab59b";
    const BEAR = "#cc7a6f";
    const series = chart.addSeries(CandlestickSeries, {
      upColor: BULL,
      downColor: BEAR,
      borderUpColor: BULL,
      borderDownColor: BEAR,
      wickUpColor: BULL,
      wickDownColor: BEAR,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBucketRef.current = null;
      linesRef.current.clear();
    };
  }, []);

  // Push the backfilled candles into the series whenever the query updates
  // (initial load, interval change, refetch). Also reset the series'
  // priceFormat to match the symbol's magnitude — lightweight-charts caps at
  // 2dp by default, which renders XLM ($0.16) as a flat band of "0.16"
  // labels without any meaningful precision.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles.data) return;
    const data = toCandlestickData(candles.data);
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
    const last = candles.data[candles.data.length - 1];
    if (last) {
      const precision = priceDecimals(last.close);
      series.applyOptions({
        priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) },
      });
    }
    lastBucketRef.current = last
      ? {
          time: last.time,
          open: descale(last.open),
          high: descale(last.high),
          low: descale(last.low),
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

  // Reconcile the keyed price-line set against the latest `priceLines` prop.
  // New ids are added, existing ones updated in place, and missing ids
  // removed — so the chart never flickers when only one line moves.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const lines = linesRef.current;
    const desired = new Map<string, ChartPriceLine>();
    for (const l of priceLines ?? []) {
      if (!Number.isFinite(l.price) || l.price <= 0) continue;
      desired.set(l.id, l);
    }
    for (const [id, line] of lines) {
      if (!desired.has(id)) {
        series.removePriceLine(line);
        lines.delete(id);
      }
    }
    for (const [id, l] of desired) {
      const existing = lines.get(id);
      if (existing) {
        existing.applyOptions({ price: l.price, color: l.color, title: l.title });
      } else {
        lines.set(
          id,
          series.createPriceLine({
            price: l.price,
            color: l.color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: l.title,
          }),
        );
      }
    }
  }, [priceLines]);

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
          <TabsList className="h-8 p-0.5">
            {INTERVALS.map((i) => (
              <TabsTrigger key={i.value} value={String(i.value)} className="px-3 py-1 text-[11px] font-mono">
                {i.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="relative flex-1 min-h-[320px] overflow-hidden rounded-xl border border-border/40 bg-background/40">
        <div ref={containerRef} className="absolute inset-0" />
        {status && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

function toCandlestickData(rows: CandleRow[]): CandlestickData<UTCTimestamp>[] {
  return rows.map((r) => ({
    time: r.time as UTCTimestamp,
    open: descale(r.open),
    high: descale(r.high),
    low: descale(r.low),
    close: descale(r.close),
  }));
}

/**
 * Fold a single oracle tick into the live candle. If the tick falls into a
 * new bucket we open a new candle; otherwise we extend the current one's
 * high/low/close.
 */
function applyTick(
  series: ISeriesApi<"Candlestick">,
  lastRef: React.RefObject<{ time: number; high: number; low: number; open: number } | null>,
  price: PriceRow,
  interval: CandleInterval,
) {
  const ts = Number(price.timestamp);
  if (!Number.isFinite(ts)) return;
  const bucket = Math.floor(ts / interval) * interval;
  const value = descale(price.price);
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

