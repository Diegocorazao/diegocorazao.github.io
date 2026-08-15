// ============================================================
// portfolio/attribution.ts
// Descompone el P&L en sus fuentes económicas. Se acumula por tick:
//   carry      = cupón devengado
//   rolldown   = ganancia por envejecer sobre curva con pendiente
//   rates      = movimiento paralelo del nivel (b0)
//   curve      = pendiente/curvatura + dislocación del nodo (b1,b2,residual)
//   execution  = costo de cruzar el spread + impacto propio
// La suma debe reconciliar con el cambio de NAV (test de cierre).
// ============================================================
import type { Bond, SimState } from '../types';

export interface Attribution {
  carry: number; rolldown: number; rates: number;
  curve: number; execution: number;
}

export const emptyAttr = (): Attribution =>
  ({ carry: 0, rolldown: 0, rates: 0, curve: 0, execution: 0 });

/** Snapshot de los yields de cada bono antes de mover la curva. */
export function snapshotYields(s: SimState): Record<string, number> {
  const m: Record<string, number> = {};
  for (const b of s.bonds) m[b.ticker] = b.ytm;
  return m;
}

/**
 * Atribuye el P&L del tick a cada factor.
 * `dLevelBp` es el movimiento del nivel de curva (b0) en bps; el resto del
 * cambio de yield de cada bono se imputa a curva (pendiente/curvatura/residual).
 */
export function attributeTick(
  s: SimState, prevY: Record<string, number>, dLevelBp: number, attr: Attribution
) {
  for (const b of s.bonds) {
    const pos = s.portfolio.positions[b.ticker];
    if (!pos || pos.nominal <= 0) continue;
    const mmNom = pos.nominal / 1e6;
    const dv01 = b.dv01PerMM * mmNom;              // PEN por bp

    const dYbp = (b.ytm - (prevY[b.ticker] ?? b.ytm)) * 100;
    // separación: nivel vs resto (pendiente + curvatura + residual del nodo)
    const lvl = dLevelBp;
    const rest = dYbp - lvl;

    attr.rates += -dv01 * lvl;                     // yield sube → pierdes
    attr.curve += -dv01 * rest;
  }
}

/** Devengo diario de cupón + rolldown, al cierre de cada día. */
export function attributeDaily(s: SimState, attr: Attribution) {
  for (const b of s.bonds) {
    const pos = s.portfolio.positions[b.ticker];
    if (!pos || pos.nominal <= 0) continue;
    attr.carry += pos.nominal * (b.coupon / 100) / 252;
    // rolldown: el bono envejece 1/252 y "rueda" por la pendiente local
    const slopeBpPerYear = rollSlope(s, b);
    const dv01 = b.dv01PerMM * (pos.nominal / 1e6);
    attr.rolldown += dv01 * slopeBpPerYear / 252;
  }
}

/** Pendiente local de la curva alrededor del bono (bps por año). */
function rollSlope(s: SimState, b: Bond): number {
  const y1 = bondCurveYield(s, b.maturityYears);
  const y0 = bondCurveYield(s, Math.max(0.5, b.maturityYears - 1));
  return (y1 - y0) * 100;   // si la curva sube con el plazo, rodar hacia abajo gana
}

function bondCurveYield(s: SimState, t: number): number {
  const f = s.curve.ns;
  const x = Math.max(t, 1e-6) / f.tau;
  const L = (1 - Math.exp(-x)) / x;
  return f.b0 + f.b1 * L + f.b2 * (L - Math.exp(-x));
}

/** Costo de ejecución de un trade: diferencia vs el mid teórico. */
export function execCost(midPrice: number, execPrice: number,
                         nominal: number, side: 'BUY' | 'SELL'): number {
  const diff = side === 'BUY' ? (midPrice - execPrice) : (execPrice - midPrice);
  return diff / 100 * nominal;    // negativo = costo
}

export function attrTotal(a: Attribution): number {
  return a.carry + a.rolldown + a.rates + a.curve + a.execution;
}
