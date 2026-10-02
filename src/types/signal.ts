export type SignalType = 'BUY' | 'WAIT' | 'EXIT' | 'NO_TRADE';

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type MarketRegime =
  | 'BULLISH_TREND'
  | 'BEARISH_TREND'
  | 'RANGE'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'TRANSITION'
  | 'UNCLEAR';

export type StructureLabel =
  | 'HH_HL'
  | 'LH_LL'
  | 'RANGING'
  | 'BOS_BULLISH'
  | 'BOS_BEARISH'
  | 'CHOCH_BULLISH'
  | 'CHOCH_BEARISH'
  | 'UNDEFINED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
}

export interface SupportResistanceLevel {
  price: number;
  type: 'SUPPORT' | 'RESISTANCE';
  strength: number;
  touches: number;
}

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

export interface RiskPlan {
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskReward: number;
  riskLevel: RiskLevel;
  positionSize: number | null;
}

export interface SignalResult {
  symbol: string;
  timeframe: string;
  signalType: SignalType;
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
  dataQualityOk: boolean;
}

export interface ScoringWeights {
  trend: number;
  structure: number;
  momentum: number;
  volume: number;
  volatility: number;
  supportResistance: number;
  riskReward: number;
}

export interface SignalThresholds {
  strong: number;
  buy: number;
  watch: number;
}
