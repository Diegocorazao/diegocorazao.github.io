// ============================================================
// ai/desk.ts — agentes institucionales grandes con cerebro LLM.
//
// Reparto de responsabilidades:
//   · Estos tres (AFP, Aseguradora, PIMCO) mueven el dinero grande y
//     deciden despacio, con consultas espaciadas: consumen IA.
//   · Banco, fondo mutuo y hedge RV viven en sim.ts como reglas rápidas
//     y NO consumen IA: dan el ruido de mercado entre decisión y decisión.
//
// Los tres observan las operaciones del jugador y pueden reaccionar a
// ellas fuera de su cadencia normal cuando el tamaño es relevante.
// ============================================================
import type { LLMClient, AgentBriefing, AgentDecision } from './client';
import type { SimState } from '../types';
import { NODES } from '../types';
import { nodeYield } from '../sim';

export interface LlmAgentCfg {
  id: string;
  name: string;
  mandate: string;
  limits: string;
  maxTicketMM: number;
  everyTicks: number;        // cadencia normal entre consultas
  reactMM: number;           // tamaño del jugador que dispara reacción
  reactCooldown: number;     // ticks mínimos entre reacciones
}

export const LLM_AGENTS: LlmAgentCfg[] = [
  {
    id: 'AFP',
    name: 'AFP Integra',
    mandate:
      'Fondo de pensiones peruano, el mayor tenedor local de soberanos. Horizonte de años, ' +
      'baja rotación, mandato de retorno ajustado por riesgo. Eres comprador estructural en ' +
      'caídas y sueles esperar niveles antes de entrar. Prefieres 7Y-20Y. Muy sensible a la ' +
      'regulación y a los flujos de aportes y retiros. No especulas con movimientos de corto plazo.',
    limits: 'Ticket máximo 80mm. Rara vez vendes: solo por necesidad de liquidez o revaluación de riesgo país.',
    maxTicketMM: 80, everyTicks: 240, reactMM: 40, reactCooldown: 120,
  },
  {
    id: 'SEGUROS',
    name: 'Seguros del Pacífico',
    mandate:
      'Compañía de seguros de vida. Tu prioridad es el calce de activos y pasivos (ALM): ' +
      'necesitas duration larga para cubrir obligaciones de muy largo plazo. Eres el comprador ' +
      'natural del tramo 20Y-30Y y aprovechas los sell-offs para calzar a mejores tasas. ' +
      'Indiferente a movimientos intradía. Casi nunca vendes duration.',
    limits: 'Ticket máximo 50mm. Solo operas 15Y en adelante salvo razón excepcional.',
    maxTicketMM: 50, everyTicks: 300, reactMM: 60, reactCooldown: 150,
  },
  {
    id: 'PIMCO',
    name: 'PIMCO EM (offshore)',
    mandate:
      'Gran fondo global de renta fija emergente. Operas Perú dentro de una cartera mundial: ' +
      'te importan los Treasuries, el dólar, el cobre y el apetito por riesgo global tanto como ' +
      'la macro local. Puedes tomar posiciones grandes y direccionales, y también salir rápido ' +
      'si el entorno global se deteriora. Tu tamaño mueve el mercado, así que dosificas.',
    limits: 'Ticket máximo 120mm. Puedes operar cualquier plazo. En risk-off global reduces exposición.',
    maxTicketMM: 120, everyTicks: 200, reactMM: 30, reactCooldown: 100,
  },
];

export interface DeskEntry {
  t: number; agent: string; action: string; bond: string | null;
  sizeMM: number; conviction: number; reason: string; executed: boolean;
  reacting: boolean;
}

export class AiDesk {
  client: LLMClient | null = null;
  log: DeskEntry[] = [];
  memory: Record<string, string> = {};
  private lastCall: Record<string, number> = {};
  private lastReact: Record<string, number> = {};
  private reactingNow = new Set<string>();
  private seenPlayerTick = -1;
  private seenNewsTick = -1;
  private inFlight = new Set<string>();
  pending: { cfg: LlmAgentCfg; d: AgentDecision; reacting: boolean }[] = [];
  errors = 0;
  calls = 0;

  setClient(c: LLMClient | null) { this.client = c; }
  get active() { return this.client !== null; }

  step(s: SimState, exec: (side: 'BUY'|'SELL', ticker: string, nominal: number, who: string) => any) {
    // 1) ejecutar decisiones que ya llegaron
    while (this.pending.length) {
      const { cfg, d, reacting } = this.pending.shift()!;
      let executed = false;
      if (d.action !== 'HOLD' && d.bond) {
        const size = Math.min(d.sizeMM, cfg.maxTicketMM) * 1e6;
        const r = exec(d.action, d.bond, size, cfg.name.split(' ')[0].toUpperCase());
        executed = !!r?.ok;
      }
      this.memory[cfg.id] = d.view || this.memory[cfg.id] || '';
      this.log.unshift({
        t: s.t, agent: cfg.name, action: d.action, bond: d.bond,
        sizeMM: d.action === 'HOLD' ? 0 : Math.min(d.sizeMM, cfg.maxTicketMM),
        conviction: d.conviction, reason: d.reason, executed, reacting,
      });
      if (this.log.length > 25) this.log.pop();
    }

    if (!this.client) return;

    // 2) ¿el jugador hizo una operación relevante? → reacción fuera de cadencia
    const last = s.playerTrades[0];
    if (last && last.t > this.seenPlayerTick) {
      this.seenPlayerTick = last.t;
      for (const cfg of LLM_AGENTS) {
        if (last.mm < cfg.reactMM) continue;
        if (s.t - (this.lastReact[cfg.id] ?? -1e9) < cfg.reactCooldown) continue;
        this.reactingNow.add(cfg.id);
      }
    }

    // 2b) ¿noticia relevante? → todos los agentes de IA la evalúan
    const news = s.activeNews[0];
    if (news && news.t > this.seenNewsTick && news.major) {
      this.seenNewsTick = news.t;
      for (const cfg of LLM_AGENTS) {
        if (s.t - (this.lastReact[cfg.id] ?? -1e9) < cfg.reactCooldown / 2) continue;
        this.reactingNow.add(cfg.id);
      }
    }

    // 3) una consulta por tick como máximo (las reacciones tienen prioridad)
    const cola = [...LLM_AGENTS].sort(
      (a, b) => (this.reactingNow.has(b.id) ? 1 : 0) - (this.reactingNow.has(a.id) ? 1 : 0));

    for (const cfg of cola) {
      const reacting = this.reactingNow.has(cfg.id);
      if (!reacting && s.t - (this.lastCall[cfg.id] ?? -1e9) < cfg.everyTicks) continue;
      if (this.inFlight.has(cfg.id)) continue;

      this.lastCall[cfg.id] = s.t;
      if (reacting) { this.lastReact[cfg.id] = s.t; this.reactingNow.delete(cfg.id); }
      this.inFlight.add(cfg.id);
      this.calls++;

      const tickers = s.bonds.map(b => b.ticker);
      this.client
        .decide(brief(s, cfg, this.memory[cfg.id] ?? 'Sin vista previa.', reacting), tickers)
        .then(d => { if (d) this.pending.push({ cfg, d, reacting }); else this.errors++; })
        .catch(() => { this.errors++; })
        .finally(() => this.inFlight.delete(cfg.id));
      break;
    }
  }
}

/** Briefing comprimido. Incluye la actividad reciente del jugador. */
function brief(s: SimState, cfg: LlmAgentCfg, prevView: string, reacting: boolean): AgentBriefing {
  const curve = NODES.map(n => `${n}Y ${nodeYield(s, n).toFixed(2)}%`).join(' · ');
  const s2s10 = ((nodeYield(s, 10) - nodeYield(s, 2)) * 100).toFixed(0);
  const s10s30 = ((nodeYield(s, 30) - nodeYield(s, 10)) * 100).toFixed(0);
  const bonos = s.bonds.map(b => `${b.ticker} ${b.ytm.toFixed(2)}%`).join(', ');

  const pt = s.playerTrades.slice(0, 5);
  const flujoJugador = pt.length
    ? pt.map(x => `${x.side === 'BUY' ? 'compró' : 'vendió'} PEN ${x.mm.toFixed(0)}mm ` +
                  `${x.ticker} a ${x.yield.toFixed(2)}%`).join('; ')
    : 'Sin actividad reciente de esa mesa.';

  const nota = reacting
    ? '\nATENCIÓN: una mesa local acaba de operar un tamaño relevante (ver FLUJO DE OTRA MESA). ' +
      'Evalúa si eso cambia tu lectura: puede ser información, presión temporal de precio que ' +
      'te conviene aprovechar en contra, o algo irrelevante para tu horizonte.'
    : '';

  return {
    agentName: cfg.name,
    mandate: cfg.mandate + nota,
    limits: cfg.limits,
    portfolio: 'Cartera institucional diversificada en soberanos locales; hay caja para operar.',
    previousView: prevView,
    curve: `${curve} | 2s10s ${s2s10}bp, 10s30s ${s10s30}bp | ${bonos}`,
    macro:
      `Inflación ${s.macro.cpiYoY.toFixed(1)}% a/a (consenso próximo dato ${s.cpiConsensus.toFixed(1)}%), ` +
      `tasa BCRP ${s.macro.policyRate.toFixed(2)}%, UST10Y ${s.macro.ust10y.toFixed(2)}%, ` +
      `USD/PEN ${s.macro.usdpen.toFixed(3)}, EMBI ${s.macro.embi.toFixed(0)}, ` +
      `VIX ${s.macro.vix.toFixed(1)}, régimen ${s.macro.regime}, día ${s.day}`,
    news: (() => {
      const ult = s.activeNews[0];
      const base = s.news.slice(0, 3).map(n => n.headline).join(' | ') || 'Sin novedades.';
      if (ult && ult.texto && s.t - ult.t < 60) {
        return `TITULAR DE ÚLTIMO MINUTO (el mercado AÚN NO lo ha descontado; ` +
               `evalúa tú mismo si es relevante para tu mandato y qué implica ` +
               `para la curva peruana): "${ult.headline}" || ${base}`;
      }
      return base;
    })(),
    flow:
      `FLUJO DE OTRA MESA (un participante local): ${flujoJugador}\n` +
      `CINTA: ${s.tape.slice(0, 6).map(e => e.text).join(' | ') || 'sin flujo relevante'}`,
  };
}
