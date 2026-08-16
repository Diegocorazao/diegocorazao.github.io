// ============================================================
// types.ts — modelo de datos del motor (independiente de la UI)
// ============================================================

export type NodeTenor = 2 | 3 | 5 | 7 | 10 | 15 | 20 | 30;
export const NODES: NodeTenor[] = [2, 3, 5, 7, 10, 15, 20, 30];

export interface NSFactors { b0: number; b1: number; b2: number; tau: number }

export interface CurveState {
  ns: NSFactors;
  nsFair: NSFactors;                    // curva fundamental (macro)
  residual: Record<number, number>;     // bps por nodo, mean-reverting
  prevDay: Record<number, number>;      // yields del cierre anterior (%)
}

export interface LiquidityParams {
  normalSize: number;    // PEN MM sin impacto apreciable
  impactK: number;       // bps por sqrt(tamaño normalizado)
  baseSpreadBp: number;  // bid/ask en yield (bps)
}

export interface Bond {
  ticker: string;
  maturityYears: number;   // se reduce con el reloj
  coupon: number;          // % anual, cupón semestral
  outstanding: number;     // PEN MM
  node: NodeTenor;         // nodo de curva al que carga
  liq: LiquidityParams;
  // estado derivado cada tick:
  ytm: number; price: number; bidY: number; askY: number;
  modDur: number; dv01PerMM: number;    // PEN por bp por PEN 1MM nominal
}

export interface Position {
  nominal: number;         // PEN
  avgPrice: number;        // precio promedio de compra (por 100)
  realized: number;        // PEN
}

export interface Portfolio {
  cash: number;            // PEN
  positions: Record<string, Position>;
  realizedTotal: number;
  startNav: number;
}

export interface TapeEntry { t: number; text: string; kind: 'flow'|'quote'|'move'|'news' }

/** Operaciones del jugador: los agentes de IA las observan y reaccionan. */
export interface PlayerTrade {
  t: number; side: 'BUY'|'SELL'; ticker: string; mm: number; yield: number;
}

/** Serie histórica por bono para los gráficos. */
export interface BondHistory { t: number[]; ytm: number[]; price: number[] }

export interface NewsItem {
  t: number; headline: string; body?: string;
  kind: 'macro'|'event'|'flow';
}

export interface AgentMemory { view: string; conviction: number; lastYield10: number }

export type Regime = 'CARRY' | 'RISK_OFF' | 'INFLATION_FEAR' | 'FISCAL_STRESS';

export interface MacroState {
  cpiYoY: number; cpiExp: number; policyRate: number;
  gdpYoY: number; usdpen: number; embi: number;
  ust10y: number; vix: number;
  regime: Regime;
}

export interface SimState {
  t: number;               // ticks (1 tick = 1 minuto simulado)
  day: number;
  seed: number;
  speed: 0 | 1 | 5 | 20;
  macro: MacroState;
  curve: CurveState;
  bonds: Bond[];
  portfolio: Portfolio;
  tape: TapeEntry[];
  playerTrades: PlayerTrade[];
  history: Record<string, BondHistory>;
  /** Últimas noticias con su sesgo, para que los agentes reaccionen. */
  activeNews: { t: number; headline: string; bias: number; major: boolean; texto?: boolean }[];
  news: NewsItem[];
  pendingCpiTick: number;  // próximo dato de inflación
  cpiConsensus: number;
  dailyPnlBase: number;    // NAV al inicio del día
  totals: { nav: number; dailyPnl: number; totalPnl: number; dv01: number };
  attr: { carry: number; rolldown: number; rates: number; curve: number; execution: number };
}

// Duración de la jornada en ticks (1 tick = 1 minuto simulado).
// A 1x un día toma ~8 min reales; a 5x ~1.6 min; a 20x ~24 s.
// Sube este número si quieres jornadas más largas.
export const MIN_PER_DAY = 480;   // 9:00 - 17:00 hora Lima
