// ============================================================
// ai/desk.ts — los tres cerebros de IA del mercado.
//
// Solo tres instituciones razonan con el modelo de lenguaje:
//   · AFP Integra  → el mayor tenedor local, comprador estructural
//   · BCP          → mesa de distribución: spread, inventario y flujo
//   · PIMCO EM     → el offshore grande, mira el mundo antes que Perú
//
// Las otras dieciséis operan por reglas con personalidad propia y no
// consumen API. Las consultas rotan y se espacian: el costo no crece
// con la cantidad de participantes.
// ============================================================
import type { LLMClient, AgentBriefing, AgentDecision } from './client';
import type { SimState } from '../types';
import { NODES } from '../types';
import { nodeYield } from '../sim';
import { LLM_POOL, type AgentDef } from '../agents/registry';

/** Cadencia y umbrales por institución. */
const CFG: Record<string, { everyTicks: number; reactMM: number; reactCooldown: number }> = {
  AFP_INTEGRA: { everyTicks: 260, reactMM: 60, reactCooldown: 130 },
  BCP:         { everyTicks: 160, reactMM: 25, reactCooldown: 80  },
  PIMCO:       { everyTicks: 220, reactMM: 40, reactCooldown: 110 },
};
const DEF = { everyTicks: 240, reactMM: 50, reactCooldown: 120 };
const cfgOf = (a: AgentDef) => CFG[a.id] ?? DEF;

/** Espaciado mínimo entre CUALQUIER par de consultas (controla costo). */
const GLOBAL_GAP = 45;

export interface DeskEntry {
  t: number; agent: string; action: string; bond: string | null;
  sizeMM: number; conviction: number; reason: string; view: string;
  executed: boolean; reacting: boolean;
}

export class AiDesk {
  client: LLMClient | null = null;
  log: DeskEntry[] = [];
  memory: Record<string, string> = {};
  private lastCall: Record<string, number> = {};
  private lastReact: Record<string, number> = {};
  private lastAny = -1e9;
  private reactingNow = new Set<string>();
  private seenPlayerTick = -1;
  private seenNewsTick = -1;
  private inFlight = new Set<string>();
  pending: { a: AgentDef; d: AgentDecision; reacting: boolean }[] = [];
  errors = 0;
  calls = 0;

  setClient(c: LLMClient | null) { this.client = c; }
  get active() { return this.client !== null; }

  step(s: SimState, exec: (side: 'BUY'|'SELL', ticker: string, nominal: number, who: string) => any) {
    // 1) ejecutar lo que ya llegó
    while (this.pending.length) {
      const { a, d, reacting } = this.pending.shift()!;
      let executed = false;
      if (d.action !== 'HOLD' && d.bond) {
        const size = Math.min(d.sizeMM, a.ticketMM) * 1e6;
        const r = exec(d.action, d.bond, size, a.name);
        executed = !!r?.ok;
      }
      if (d.view) this.memory[a.id] = d.view;
      this.log.unshift({
        t: s.t, agent: a.name, action: d.action, bond: d.bond,
        sizeMM: d.action === 'HOLD' ? 0 : Math.min(d.sizeMM, a.ticketMM),
        conviction: d.conviction, reason: d.reason, view: d.view,
        executed, reacting,
      });
      if (this.log.length > 30) this.log.pop();
    }

    if (!this.client) return;

    // 2) reacción a las operaciones del jugador
    const last = s.playerTrades[0];
    if (last && last.t > this.seenPlayerTick) {
      this.seenPlayerTick = last.t;
      for (const a of LLM_POOL) {
        const c = cfgOf(a);
        if (last.mm < c.reactMM) continue;
        if (s.t - (this.lastReact[a.id] ?? -1e9) < c.reactCooldown) continue;
        this.reactingNow.add(a.id);
      }
    }

    // 3) reacción a noticias mayores
    const news = s.activeNews[0];
    if (news && news.t > this.seenNewsTick && news.major) {
      this.seenNewsTick = news.t;
      for (const a of LLM_POOL) {
        if (s.t - (this.lastReact[a.id] ?? -1e9) < cfgOf(a).reactCooldown / 2) continue;
        this.reactingNow.add(a.id);
      }
    }

    // 4) una consulta a la vez, con espaciado global
    if (s.t - this.lastAny < GLOBAL_GAP) return;

    const cola = [...LLM_POOL].sort(
      (x, y) => (this.reactingNow.has(y.id) ? 1 : 0) - (this.reactingNow.has(x.id) ? 1 : 0));

    for (const a of cola) {
      const c = cfgOf(a);
      const reacting = this.reactingNow.has(a.id);
      if (!reacting && s.t - (this.lastCall[a.id] ?? -1e9) < c.everyTicks) continue;
      if (this.inFlight.has(a.id)) continue;

      this.lastCall[a.id] = s.t;
      this.lastAny = s.t;
      if (reacting) { this.lastReact[a.id] = s.t; this.reactingNow.delete(a.id); }
      this.inFlight.add(a.id);
      this.calls++;

      const tickers = s.bonds.map(b => b.ticker);
      this.client
        .decide(brief(s, a, this.memory[a.id] ?? '', reacting), tickers)
        .then(d => { if (d) this.pending.push({ a, d, reacting }); else this.errors++; })
        .catch(() => { this.errors++; })
        .finally(() => this.inFlight.delete(a.id));
      break;
    }
  }
}

/** Briefing con niveles concretos: mientras más específico, mejor razona. */
function brief(s: SimState, a: AgentDef, prevView: string, reacting: boolean): AgentBriefing {
  const curva = NODES.map(n => {
    const y = nodeYield(s, n);
    const prev = s.curve.prevDay[n] ?? y;
    const d = (y - prev) * 100;
    return `${n}Y ${y.toFixed(2)}% (${d >= 0 ? '+' : ''}${d.toFixed(1)}bp)`;
  }).join(' · ');

  const s2s10 = ((nodeYield(s, 10) - nodeYield(s, 2)) * 100).toFixed(0);
  const s10s30 = ((nodeYield(s, 30) - nodeYield(s, 10)) * 100).toFixed(0);

  // qué bonos están ricos o baratos contra el ajuste de curva
  const rv = s.bonds.map(b => {
    const res = s.curve.residual[b.node] ?? 0;
    const etiqueta = res > 2.5 ? ' [barato]' : res < -2.5 ? ' [rico]' : '';
    return `${b.ticker} ${b.ytm.toFixed(2)}% dur ${b.modDur.toFixed(1)}${etiqueta}`;
  }).join(', ');

  const pt = s.playerTrades.slice(0, 4);
  const flujoJugador = pt.length
    ? pt.map(x => `${x.side === 'BUY' ? 'compró' : 'vendió'} PEN ${x.mm.toFixed(0)}mm ` +
                  `${x.ticker} a ${x.yield.toFixed(2)}%`).join('; ')
    : 'sin actividad reciente';

  const nota = reacting
    ? '\n\nSITUACIÓN: acaba de ocurrir algo relevante (noticia nueva o una operación grande de ' +
      'otra mesa). Evalúa si cambia tu lectura o si es ruido para tu horizonte.'
    : '';

  return {
    agentName: a.name,
    mandate: (a.mandate ?? '') + nota,
    limits: a.limits ?? `Ticket máximo ${a.ticketMM}mm.`,
    portfolio:
      `AUM aproximado PEN ${(a.aum / 1000).toFixed(0)} mil MM. Cartera diversificada en ` +
      `soberanos locales con caja disponible para operar.`,
    previousView: prevView || 'Es tu primera evaluación de la sesión: fija una tesis inicial.',
    curve:
      `CURVA (nivel y cambio vs cierre anterior): ${curva}\n` +
      `PENDIENTES: 2s10s ${s2s10}bp · 10s30s ${s10s30}bp\n` +
      `BONOS: ${rv}`,
    macro:
      `Inflación ${s.macro.cpiYoY.toFixed(1)}% a/a (consenso próximo dato ` +
      `${s.cpiConsensus.toFixed(1)}%) · tasa BCRP ${s.macro.policyRate.toFixed(2)}% · ` +
      `UST10Y ${s.macro.ust10y.toFixed(2)}% · USD/PEN ${s.macro.usdpen.toFixed(3)} · ` +
      `EMBI ${s.macro.embi.toFixed(0)}pb · VIX ${s.macro.vix.toFixed(1)} · ` +
      `régimen ${s.macro.regime} · día ${s.day} de la sesión`,
    news: (() => {
      const ult = s.activeNews[0];
      const base = s.news.slice(0, 3).map(n => n.headline).join(' | ') || 'Sin novedades.';
      if (ult && ult.texto && s.t - ult.t < 60) {
        return `TITULAR DE ÚLTIMO MINUTO — el mercado AÚN NO lo ha descontado. Evalúa por tu ` +
               `cuenta si es creíble, qué implica para la curva peruana y para tu mandato: ` +
               `"${ult.headline}"\nOTRAS: ${base}`;
      }
      return base;
    })(),
    flow:
      `OTRA MESA LOCAL: ${flujoJugador}\n` +
      `CINTA RECIENTE: ${s.tape.slice(0, 8).map(e => e.text).join(' | ') || 'sin flujo'}`,
  };
}
