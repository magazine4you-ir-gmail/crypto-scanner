import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type LineStyle,
} from 'lightweight-charts';
import type { Candle } from '@/types/market';
import { ema } from '@/engine/indicators/movingAverage';
import { vwap } from '@/engine/indicators/vwap';
import { bollingerBands } from '@/engine/indicators/bollinger';

interface ChartProps {
  candles: Candle[];
  showEMA20?: boolean;
  showEMA50?: boolean;
  showEMA200?: boolean;
  showVWAP?: boolean;
  showBollinger?: boolean;
  showVolume?: boolean;
  entryLevel?: number | null;
  stopLevel?: number | null;
  targetLevels?: number[];
  supportLevels?: number[];
  resistanceLevels?: number[];
  /** extra labelled horizontal lines (entry range, liquidation, current price ...). Reverse Plus uses these. */
  extraLines?: ChartLine[];
  /** event markers (signal / entry / exit). `time` in ms; snapped to the candle that contains it. */
  markers?: ChartMarker[];
  /** bump these numbers to fit all content / jump to the latest candle */
  fitSignal?: number;
  scrollSignal?: number;
  heightClass?: string;
}

export interface ChartLine { price: number; color: string; title: string; style?: number; width?: number }
export interface ChartMarker { time: number; position: 'aboveBar' | 'belowBar'; color: string; shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; text: string }

export function PriceChart({
  candles,
  showEMA20 = true,
  showEMA50 = true,
  showEMA200 = true,
  showVWAP = false,
  showBollinger = false,
  showVolume = true,
  entryLevel,
  stopLevel,
  targetLevels,
  supportLevels,
  resistanceLevels,
  extraLines,
  markers,
  fitSignal,
  scrollSignal,
  heightClass,
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const overlaySeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const firstFitDone = useRef(false);

  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'Vazirmatn, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(45, 63, 90, 0.3)' },
        horzLines: { color: 'rgba(45, 63, 90, 0.3)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#3b82f6', width: 1, style: 3, labelBackgroundColor: '#2563eb' },
        horzLine: { color: '#3b82f6', width: 1, style: 3, labelBackgroundColor: '#2563eb' },
      },
      rightPriceScale: {
        borderColor: '#1c2939',
        scaleMargins: { top: 0.1, bottom: showVolume ? 0.3 : 0.1 },
      },
      timeScale: {
        borderColor: '#1c2939',
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
      overlaySeriesRef.current = [];
      markersRef.current = null;
      firstFitDone.current = false;
    };
  }, [showVolume]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || candles.length === 0) return;

    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;

    // Clear previous price lines (Entry / Stop / Targets / S-R)
    for (const line of priceLinesRef.current) {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        /* already removed */
      }
    }
    priceLinesRef.current = [];

    // Clear previous overlay series (EMA / VWAP / BB)
    for (const s of overlaySeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        /* already removed */
      }
    }
    overlaySeriesRef.current = [];

    const candleData = candles.map((c) => ({
      time: (c.openTime / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    if (volumeSeriesRef.current && showVolume) {
      volumeSeriesRef.current.setData(
        candles.map((c) => ({
          time: (c.openTime / 1000) as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        })),
      );
    }

    const closes = candles.map((c) => c.close);

    const addLine = (values: (number | null)[], color: string, lineStyle?: number) => {
      const data = values
        .map((v, i) =>
          v !== null ? { time: (candles[i].openTime / 1000) as UTCTimestamp, value: v } : null,
        )
        .filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: lineStyle as LineStyle | undefined,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(data);
      overlaySeriesRef.current.push(series);
    };

    if (showEMA20) addLine(ema(closes, 20), '#3b82f6');
    if (showEMA50) addLine(ema(closes, 50), '#f59e0b');
    if (showEMA200) addLine(ema(closes, 200), '#8b5cf6');
    if (showVWAP) addLine(vwap(candles), '#06b6d4', 2);
    if (showBollinger) {
      const bb = bollingerBands(closes, 20, 2);
      addLine(bb.upper, 'rgba(139, 92, 246, 0.5)');
      addLine(bb.lower, 'rgba(139, 92, 246, 0.5)');
    }

    const pushLine = (opts: Parameters<typeof candleSeries.createPriceLine>[0]) => {
      const line = candleSeries.createPriceLine(opts);
      priceLinesRef.current.push(line);
    };

    if (entryLevel != null && Number.isFinite(entryLevel)) {
      pushLine({
        price: entryLevel,
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }
    if (stopLevel != null && Number.isFinite(stopLevel)) {
      pushLine({
        price: stopLevel,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Stop',
      });
    }
    targetLevels?.forEach((tgt, i) => {
      if (tgt != null && Number.isFinite(tgt)) {
        pushLine({
          price: tgt,
          color: '#10b981',
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
          title: `T${i + 1}`,
        });
      }
    });
    extraLines?.forEach((l) => {
      if (Number.isFinite(l.price)) {
        pushLine({ price: l.price, color: l.color, lineWidth: (l.width ?? 1) as 1 | 2 | 3 | 4, lineStyle: l.style ?? 2, axisLabelVisible: true, title: l.title });
      }
    });
    supportLevels?.forEach((s) => {
      pushLine({
        price: s,
        color: 'rgba(16, 185, 129, 0.3)',
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: false,
      });
    });
    resistanceLevels?.forEach((r) => {
      pushLine({
        price: r,
        color: 'rgba(239, 68, 68, 0.3)',
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: false,
      });
    });

    // markers: snap each event to the candle that contains it
    const mk: SeriesMarker<Time>[] = (markers ?? []).flatMap((m) => {
      const c = candles.find((x) => m.time >= x.openTime && m.time <= x.closeTime);
      return c ? [{ time: (c.openTime / 1000) as UTCTimestamp, position: m.position, color: m.color, shape: m.shape, text: m.text }] : [];
    }).sort((a, b) => Number(a.time) - Number(b.time));
    if (!markersRef.current) markersRef.current = createSeriesMarkers(candleSeries, mk);
    else markersRef.current.setMarkers(mk);

    if (!firstFitDone.current) { chart.timeScale().fitContent(); firstFitDone.current = true; }
  }, [
    candles,
    showEMA20,
    showEMA50,
    showEMA200,
    showVWAP,
    showBollinger,
    showVolume,
    entryLevel,
    stopLevel,
    targetLevels,
    supportLevels,
    resistanceLevels,
    extraLines,
    markers,
  ]);

  useEffect(() => {
    if (fitSignal !== undefined && chartRef.current) chartRef.current.timeScale().fitContent();
  }, [fitSignal]);
  useEffect(() => {
    if (scrollSignal !== undefined && chartRef.current) chartRef.current.timeScale().scrollToRealTime();
  }, [scrollSignal]);

  return <div ref={chartContainerRef} className={`w-full ${heightClass ?? 'h-[400px] sm:h-[500px]'}`} />;
}
