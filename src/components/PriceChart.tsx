import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
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
}

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
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

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
    };
  }, [showVolume]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || candles.length === 0) return;

    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;

    const candleData = candles.map((c) => ({
      time: (c.openTime / 1000) as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(candleData);

    if (volumeSeriesRef.current && showVolume) {
      const volumeData = candles.map((c) => ({
        time: (c.openTime / 1000) as any,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
      }));
      volumeSeriesRef.current.setData(volumeData);
    }

    const closes = candles.map((c) => c.close);

    const addLine = (values: (number | null)[], color: string, lineStyle?: number) => {
      const data = values
        .map((v, i) => (v !== null ? { time: (candles[i].openTime / 1000) as any, value: v } : null))
        .filter(Boolean) as any;
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: lineStyle as any,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(data);
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

    if (entryLevel) {
      candleSeries.createPriceLine({ price: entryLevel, color: '#3b82f6', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'Entry' });
    }
    if (stopLevel) {
      candleSeries.createPriceLine({ price: stopLevel, color: '#ef4444', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Stop' });
    }
    if (targetLevels) {
      targetLevels.forEach((tgt, i) => {
        candleSeries.createPriceLine({ price: tgt, color: '#10b981', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: `T${i + 1}` });
      });
    }
    supportLevels?.forEach((s) => {
      candleSeries.createPriceLine({ price: s, color: 'rgba(16, 185, 129, 0.3)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
    });
    resistanceLevels?.forEach((r) => {
      candleSeries.createPriceLine({ price: r, color: 'rgba(239, 68, 68, 0.3)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
    });

    chart.timeScale().fitContent();
  }, [candles, showEMA20, showEMA50, showEMA200, showVWAP, showBollinger, showVolume, entryLevel, stopLevel, targetLevels, supportLevels, resistanceLevels]);

  return <div ref={chartContainerRef} className="w-full h-[400px] sm:h-[500px]" />;
}
