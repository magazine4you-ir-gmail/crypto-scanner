// Core types are defined once in the shared engine and re-exported here.
import type {
  SignalType,
  TrendDirection,
  MarketRegime,
  StructureLabel,
  RiskLevel,
  SwingPoint,
  SRLevel,
  RiskPlan,
  ScoringWeights,
  SignalThresholds,
  Direction,
} from '@engine';

export type {
  SignalType,
  TrendDirection,
  MarketRegime,
  StructureLabel,
  RiskLevel,
  SwingPoint,
  RiskPlan,
  ScoringWeights,
  SignalThresholds,
  Direction,
};

export type SupportResistanceLevel = SRLevel;

export interface ScoreBreakdown {
  trend: number;
  structure: number;
  momentum: number;
  volume: number;
  volatility: number;
  supportResistance: number;
  riskReward: number;
  total: number;
}

export interface ConfluenceFactor {
  key: string;
  label_fa: string;
  label_en: string;
  positive: boolean;
  weight: number;
}

export interface SignalResult {
  symbol: string;
  timeframe: string;
  signalType: SignalType;
  /** Direction the score/plan refer to (LONG for BUY, SHORT for SELL; dominant side for WAIT). */
  bias: Direction;
  score: number;
  regime: MarketRegime;
  trend: TrendDirection;
  structure: StructureLabel;
  riskLevel: RiskLevel;
  priceAtSignal: number;
  factors: ConfluenceFactor[];
  reasons: string[];
  risk: RiskPlan | null;
  explanationFa: string;
  explanationEn: string;
  generatedAt: number;
  /** Close time (ms) of the last candle the analysis is based on. */
  candleCloseTime: number | null;
  dataQualityOk: boolean;
}
