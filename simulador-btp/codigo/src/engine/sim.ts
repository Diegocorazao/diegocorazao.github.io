// ============================================================
// sim.ts — orquestador del simulador (1 tick = 1 minuto)
// El LLM/heurísticas solo emiten intenciones; el precio sale de aquí.
// ============================================================
import { makeRng, normal, type Rng } from './rng';
import { nsYield } from './curve/ns';
import { priceFromYtm, modDuration, dv01PerMM } from './pricing/bond';
import {
  MIN_PER_DAY, NODES, type Bond, type SimState, type TapeEntry,
} from './types';
import {
  attributeDaily, attributeTick, emptyAttr, execCost, snapshotYields,
  type Attribution,
} from './portfolio/attribution';

// ---------- universo inicial (config) ----------
const BOND_DEFS = [
  { ticker: 'SOB2028', mat: 2.0,  coupon: 6.35, out: 9800,  node: 2  as const },
  { ticker: 'SOB2030', mat: 4.0,  coupon: 6.85, out: 12500, node: 5  as const },
  { ticker: 'SOB2032', mat: 6.0,  coupon: 6.15, out: 15400, node: 7  as const },
  { ticker: 'SOB2034', mat: 8.0,  coupon: 6.90, out: 18200, node: 10 as const },
  { ticker: 'SOB2037', mat: 11.0, coupon: 6.71, out: 16900, node: 10 as const },
  { ticker: 'SOB2040', mat: 14.0, coupon: 6.95, out: 13100, node: 15 as const },
  { ticker: 'SOB2042', mat: 16.0, coupon: 7.05, out: 9400,  node: 20 as const },
  { ticker: 'SOB2050', mat: 24.0, coupon: 7.30, out: 7200,  node: 20 as const },
  { ticker: 'SOB2055', mat: 29.0, coupon: 7.40, out: 6100,  node: 30 as const },
];

function liqFor(mat: number) {
  // los cortos/medios son más líquidos; los ultra largos, menos
  const normalSize = mat < 5 ? 30e6 : mat < 12 ? 25e6 : mat < 20 ? 15e6 : 8e6;
  const impactK = mat < 5 ? 1.2 : mat < 12 ? 1.6 : mat < 20 ? 2.4 : 3.4;
  const baseSpreadBp = mat < 5 ? 3 : mat < 12 ? 4 : mat < 20 ? 6 : 9;
  return { normalSize, impactK, baseSpreadBp };
}

export function newSim(seed: number): SimState {
  const rng = makeRng(seed);
  const ns = { b0: 7.62, b1: -1.42, b2: -0.55, tau: 2.6 };
  const residual: Record<number, number> = {};
  for (const n of NODES) residual[n] = (rng() - 0.5) * 4;

  const bonds: Bond[] = BOND_DEFS.map(d => ({
    ticker: d.ticker, maturityYears: d.mat, coupon: d.coupon,
    outstanding: d.out, node: d.node, liq: liqFor(d.mat),
    ytm: 0, price: 0, bidY: 0, askY: 0, modDur: 0, dv01PerMM: 0,
  }));

  const state: SimState = {
    t: 0, day: 1, seed, speed: 1,
    macro: {
      cpiYoY: 3.1, cpiExp: 2.9, policyRate: 4.75, gdpYoY: 2.6,
      usdpen: 3.62, embi: 168, ust10y: 4.18, vix: 15.2, regime: 'CARRY',
    },
    curve: { ns, nsFair: { ...ns }, residual, prevDay: {} },
    bonds,
    portfolio: { cash: 100e6, positions: {}, realizedTotal: 0, startNav: 100e6 },
    tape: [], news: [],
    pendingCpiTick: 120 + Math.floor(rng() * 60),
    cpiConsensus: 3.2,
    dailyPnlBase: 100e6,
    totals: { nav: 100e6, dailyPnl: 0, totalPnl: 0, dv01: 0 },
    attr: emptyAttr(),
  };
  repriceAll(state);
  for (const n of NODES) state.curve.prevDay[n] = nodeYield(state, n);
  state.news.push({
    t: 0, kind: 'event',
    headline: 'Apertura de mercado — Mesa BTP',
    body: 'Administras PEN 100 MM. Dato de inflación esperado hoy. Consenso: 3.2% a/a (anterior 3.1%).',
  });
  (state as any)._rng = rng;
  return state;
}

// ---------- helpers de curva/pricing ----------
export function nodeYield(s: SimState, tenor: number): number {
  return nsYield(s.curve.ns, tenor) + (s.curve.residual[tenor] ?? 0) / 100;
}

function bondYield(s: SimState, b: Bond): number {
  // interpola residual entre nodos vecinos
  const t = b.maturityYears;
  let lo = NODES[0], hi = NODES[NODES.length - 1];
  for (const n of NODES) { if (n <= t) lo = n; }
  for (let i = NODES.length - 1; i >= 0; i--) { if (NODES[i] >= t) hi = NODES[i]; }
  const rlo = s.curve.residual[lo], rhi = s.curve.residual[hi];
  const w = hi === lo ? 0 : (t - lo) / (hi - lo);
  const res = rlo + (rhi - rlo) * w;
  return nsYield(s.curve.ns, t) + res / 100;
}

function repriceAll(s: SimState) {
  let dv01 = 0, mv = 0;
  for (const b of s.bonds) {
    b.ytm = bondYield(s, b);
    b.price = priceFromYtm(b.coupon, b.maturityYears, b.ytm);
    const half = b.liq.baseSpreadBp * stressMult(s) / 2 / 100;
    b.bidY = b.ytm + half; b.askY = b.ytm - half;   // en yield: bid paga más tasa
    b.modDur = modDuration(b.coupon, b.maturityYears, b.ytm);
    b.dv01PerMM = dv01PerMM(b.coupon, b.maturityYears, b.ytm);
    const pos = s.portfolio.positions[b.ticker];
    if (pos && pos.nominal !== 0) {
      mv += pos.nominal * b.price / 100;
      dv01 += (pos.nominal / 1e6) * b.dv01PerMM;
    }
  }
  const nav = s.portfolio.cash + mv;
  s.totals = {
    nav, dv01,
    dailyPnl: nav - s.dailyPnlBase,
    totalPnl: nav - s.portfolio.startNav,
  };
}

function stressMult(s: SimState): number {
  return s.macro.regime === 'RISK_OFF' ? 2.6
       : s.macro.regime === 'INFLATION_FEAR' ? 1.7 : 1.0;
}

// ---------- ejecución (jugador y agentes comparten esta puerta) ----------
export interface ExecResult { ok: boolean; msg: string; execYield?: number; execPrice?: number }

export function execute(s: SimState, side: 'BUY'|'SELL', ticker: string,
                        nominal: number, who: 'PLAYER'|string = 'PLAYER'): ExecResult {
  const b = s.bonds.find(x => x.ticker === ticker);
  if (!b) return { ok: false, msg: 'Bono inexistente' };
  if (!(nominal > 0)) return { ok: false, msg: 'Monto inválido' };

  // impacto raíz-cuadrada sobre el yield del nodo
  const q = nominal / b.liq.normalSize;
  const impactBp = b.liq.impactK * Math.pow(Math.min(q, 60), 0.62) * stressMult(s);
  // el que compra presiona el yield a la baja; el que vende, al alza
  const dir = side === 'BUY' ? -1 : 1;
  const crossY = side === 'BUY' ? b.askY : b.bidY;      // cruza el spread
  const execY = crossY + dir * impactBp / 100 * 0.55;    // slippage parcial propio
  const execP = priceFromYtm(b.coupon, b.maturityYears, execY);
  const midP = priceFromYtm(b.coupon, b.maturityYears, b.ytm);

  if (who === 'PLAYER') {
    s.attr.execution += execCost(midP, execP, nominal, side);
    const cashDelta = (side === 'BUY' ? -1 : 1) * nominal * execP / 100;
    const pos = s.portfolio.positions[ticker] ?? { nominal: 0, avgPrice: 0, realized: 0 };
    if (side === 'BUY') {
      if (s.portfolio.cash + cashDelta < 0) return { ok: false, msg: 'Caja insuficiente' };
      pos.avgPrice = (pos.avgPrice * pos.nominal + execP * nominal) / (pos.nominal + nominal);
      pos.nominal += nominal;
    } else {
      if (pos.nominal < nominal) return { ok: false, msg: 'No tienes ese nominal (sin cortos en Nivel 1)' };
      pos.realized += (execP - pos.avgPrice) / 100 * nominal;
      s.portfolio.realizedTotal += (execP - pos.avgPrice) / 100 * nominal;
      pos.nominal -= nominal;
    }
    s.portfolio.cash += cashDelta;
    s.portfolio.positions[ticker] = pos;
  }

  // impacto de mercado: 60% al residual del nodo, 40% al nivel NS ponderado
  const bpMove = dir * impactBp;
  s.curve.residual[b.node] += bpMove * 0.6;
  s.curve.ns.b0 += bpMove * 0.4 * (b.modDur / 12) / 100;

  const mm = (nominal / 1e6).toFixed(0);
  tape(s, who === 'PLAYER'
    ? `TÚ ${side === 'BUY' ? 'COMPRASTE' : 'VENDISTE'} PEN ${mm}mm ${ticker} @ ${execY.toFixed(3)}%`
    : `${who} ${side === 'BUY' ? 'BOUGHT' : 'SOLD'} ~PEN ${mm}mm ${ticker}`, 'flow');

  repriceAll(s);
  return { ok: true, msg: 'ok', execYield: execY, execPrice: execP };
}

function tape(s: SimState, text: string, kind: TapeEntry['kind']) {
  s.tape.unshift({ t: s.t, text, kind });
  if (s.tape.length > 80) s.tape.pop();
}

// ---------- agentes heurísticos ----------
interface AgentCtx { mem: { mom: number[]; insurerCd: number; afpCd: number } }

function agentsAct(s: SimState, rng: Rng, ctx: AgentCtx) {
  const y10 = nodeYield(s, 10);
  ctx.mem.mom.push(y10); if (ctx.mem.mom.length > 20) ctx.mem.mom.shift();

  // OFFSHORE MACRO: momentum en 10Y con probabilidad
  if (ctx.mem.mom.length >= 12 && rng() < 0.06) {
    const chg = (y10 - ctx.mem.mom[0]) * 100;
    if (Math.abs(chg) > 2.5) {
      const side = chg > 0 ? 'SELL' : 'BUY';
      const size = (8 + rng() * 25) * 1e6;
      execute(s, side, rng() < 0.5 ? 'SOB2034' : 'SOB2037', size, 'OFFSHORE');
    }
  }
  // ASEGURADORA: comprador natural del ultra largo sobre su tasa ALM
  ctx.mem.insurerCd = Math.max(0, ctx.mem.insurerCd - 1);
  const y30 = nodeYield(s, 30);
  if (y30 > 7.45 && ctx.mem.insurerCd === 0 && rng() < 0.25) {
    execute(s, 'BUY', rng() < 0.6 ? 'SOB2055' : 'SOB2050', (5 + rng() * 12) * 1e6, 'INSURER');
    ctx.mem.insurerCd = 25;
  }
  // AFP: compra caídas del belly con paciencia
  ctx.mem.afpCd = Math.max(0, ctx.mem.afpCd - 1);
  const res10 = s.curve.residual[10];
  if (res10 > 4.5 && ctx.mem.afpCd === 0 && rng() < 0.3) {
    execute(s, 'BUY', 'SOB2037', (10 + rng() * 30) * 1e6, 'AFP');
    ctx.mem.afpCd = 30;
  }
  // BANCO: ruido de cotización / inventario
  if (rng() < 0.05) {
    const b = s.bonds[Math.floor(rng() * s.bonds.length)];
    tape(s, `Bank ${rng() < 0.5 ? 'bids' : 'offers'} ${b.ticker} @ ${(rng() < 0.5 ? b.bidY : b.askY).toFixed(2)}%`, 'quote');
  }
}

// ---------- evento macro: dato de inflación ----------
function maybeCpi(s: SimState, rng: Rng) {
  if (s.t !== s.pendingCpiTick) return;
  const truth = s.macro.cpiYoY + (rng() - 0.42) * 0.9;   // sesgo leve al alza
  const actual = Math.round(truth * 10) / 10;
  const surpBp = Math.round((actual - s.cpiConsensus) * 100);
  s.macro.cpiYoY = actual;

  // perfil por madurez: golpea corto/medio, decae al largo
  const k = surpBp / 50;                                  // normalizado
  s.curve.ns.b1 += 0.11 * k;                              // el corto sube más
  s.curve.ns.b0 += 0.020 * k;
  if (Math.abs(surpBp) >= 40) s.macro.regime = surpBp > 0 ? 'INFLATION_FEAR' : 'CARRY';

  s.news.unshift({
    t: s.t, kind: 'macro',
    headline: `INFLACIÓN PERÚ: ${actual.toFixed(1)}% a/a — consenso ${s.cpiConsensus.toFixed(1)}%`,
    body: `Sorpresa: ${surpBp >= 0 ? '+' : ''}${surpBp} bps vs consenso. Anterior: 3.1%.`,
  });
  tape(s, `CPI ${actual.toFixed(1)}% vs ${s.cpiConsensus.toFixed(1)}%e — repricing del BCRP en curso`, 'news');
  // próximo dato: mañana
  s.pendingCpiTick = s.t + MIN_PER_DAY + Math.floor(rng() * 120);
  s.cpiConsensus = Math.round((actual + (rng() - 0.5) * 0.3) * 10) / 10;
}

// ---------- tick principal ----------
export function tick(s: SimState) {
  const rng: Rng = (s as any)._rng ?? makeRng(s.seed + s.t);
  const ctx: AgentCtx = ((s as any)._ctx ??= { mem: { mom: [], insurerCd: 0, afpCd: 0 } });

  s.t += 1;
  // fin de día
  if (s.t % MIN_PER_DAY === 0) {
    s.day += 1;
    for (const n of NODES) s.curve.prevDay[n] = nodeYield(s, n);
    s.dailyPnlBase = s.totals.nav;
    // devengo diario de cupón + rolldown (atribución)
    attributeDaily(s, s.attr);
    for (const b of s.bonds) {
      const pos = s.portfolio.positions[b.ticker];
      if (pos && pos.nominal > 0) s.portfolio.cash += pos.nominal * (b.coupon / 100) / 252;
      b.maturityYears = Math.max(0.5, b.maturityYears - 1 / 252);
    }
    tape(s, `— Cierre día ${s.day - 1} · P&L día: PEN ${(s.totals.dailyPnl / 1e6).toFixed(2)}mm —`, 'move');
  }

  // macro continuo
  s.macro.ust10y = Math.max(2.5, s.macro.ust10y + normal(rng) * 0.006);
  s.macro.usdpen = Math.max(3.2, s.macro.usdpen + normal(rng) * 0.0009);
  s.macro.vix = Math.max(10, s.macro.vix + normal(rng) * 0.12
    + (s.macro.regime === 'RISK_OFF' ? 0.05 : -0.01));
  if (s.macro.vix > 26 && s.macro.regime === 'CARRY') {
    s.macro.regime = 'RISK_OFF';
    s.news.unshift({ t: s.t, kind: 'event', headline: 'RISK-OFF GLOBAL: VIX sobre 26, ventas en EM',
      body: 'Spreads más anchos, menor profundidad. Offshore reduce riesgo.' });
  }
  if (s.macro.vix < 18 && s.macro.regime === 'RISK_OFF') s.macro.regime = 'CARRY';

  maybeCpi(s, rng);

  // snapshot para atribución
  const prevY = snapshotYields(s);
  const prevB0 = s.curve.ns.b0;

  // dinámica de curva: mean reversion + spillover UST + ruido
  const c = s.curve;
  c.ns.b0 += 0.02 * (c.nsFair.b0 - c.ns.b0) / 390
           + 0.25 * (s.macro.ust10y - 4.18) * 0.0004
           + normal(rng) * 0.00055 * stressMult(s);
  c.ns.b1 += 0.02 * (c.nsFair.b1 - c.ns.b1) / 390 + normal(rng) * 0.00045;
  c.ns.b2 += 0.03 * (c.nsFair.b2 - c.ns.b2) / 390 + normal(rng) * 0.00035;
  for (const n of NODES) {
    c.residual[n] += -0.012 * c.residual[n] + normal(rng) * 0.022;
  }

  agentsAct(s, rng, ctx);
  repriceAll(s);
  attributeTick(s, prevY, (s.curve.ns.b0 - prevB0) * 100, s.attr);
}
