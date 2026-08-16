// ============================================================
// ai/desk.ts — orquesta los agentes con cerebro LLM.
//
// Diseño clave: el tick del motor es SÍNCRONO y la llamada al LLM es
// asíncrona. Por eso el LLM nunca bloquea la simulación: se dispara la
// consulta, el mercado sigue corriendo, y cuando la respuesta llega se
// encola una intención que se ejecuta en un tick posterior — igual que
// un PM real que se demora en decidir mientras el mercado se mueve.
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
  everyTicks: number;      // cadencia mínima entre consultas
}

export const LLM_AGENTS: LlmAgentCfg[] = [
  {
    id: 'OFFSHORE_MACRO', name: 'Offshore Macro Fund',
    mandate: 'Fondo macro global, direccional y especulativo. Operas la vista de política monetaria del BCRP y el spillover de tasas de EEUU. Puedes revertir tu posición rápido. Horizonte de días a semanas.',
    limits: 'Ticket máximo 40mm. Cortas el mercado no está permitido en este nivel: solo compras o vendes lo que tienes.',
    maxTicketMM: 40, everyTicks: 45,
  },
  {
    id: 'HEDGE_RV', name: 'Hedge Fund Relative Value',
    mandate: 'Buscas dislocaciones en la curva: bonos ricos/baratos contra el ajuste Nelson-Siegel, y reversión a la media de los residuales por nodo. No tomas apuestas direccionales grandes.',
    limits: 'Ticket máximo 25mm. Prefieres el belly (5Y-15Y).',
    maxTicketMM: 25, everyTicks: 60,
  },
  {
    id: 'AFP_ALFA', name: 'AFP Alfa',
    mandate: 'Fondo de pensiones con gran AUM y baja rotación. Comprador estructural en caídas. Sensible a la regulación y a los flujos de aportes/retiros. Prefieres 7Y-20Y. Evitas decisiones especulativas agresivas.',
    limits: 'Ticket máximo 60mm. No vendes salvo necesidad de liquidez.',
    maxTicketMM: 60, everyTicks: 90,
  },
];

export interface DeskEntry {
  t: number; agent: string; action: string; bond: string | null;
  sizeMM: number; conviction: number; reason: string; executed: boolean;
}

export class AiDesk {
  client: LLMClient | null = null;
  log: DeskEntry[] = [];
  memory: Record<string, string> = {};
  private lastCall: Record<string, number> = {};
  private inFlight = new Set<string>();
  pending: { cfg: LlmAgentCfg; d: AgentDecision }[] = [];
  errors = 0;
  calls = 0;

  setClient(c: LLMClient | null) { this.client = c; }
  get active() { return this.client !== null; }

  /** Se llama en cada tick. No bloquea: dispara consultas y ejecuta pendientes. */
  step(s: SimState, exec: (side: 'BUY'|'SELL', ticker: string, nominal: number, who: string) => any) {
    // 1) ejecutar decisiones que ya llegaron
    while (this.pending.length) {
      const { cfg, d } = this.pending.shift()!;
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
        conviction: d.conviction, reason: d.reason, executed,
      });
      if (this.log.length > 25) this.log.pop();
    }

    if (!this.client) return;

    // 2) disparar una consulta si toca (máx 1 por tick, escalonadas)
    for (const cfg of LLM_AGENTS) {
      const last = this.lastCall[cfg.id] ?? -1e9;
      if (s.t - last < cfg.everyTicks) continue;
      if (this.inFlight.has(cfg.id)) continue;
      this.lastCall[cfg.id] = s.t;
      this.inFlight.add(cfg.id);
      this.calls++;
      const tickers = s.bonds.map(b => b.ticker);
      this.client.decide(brief(s, cfg, this.memory[cfg.id] ?? 'Sin vista previa.'), tickers)
        .then(d => { if (d) this.pending.push({ cfg, d }); else this.errors++; })
        .catch(() => { this.errors++; })
        .finally(() => this.inFlight.delete(cfg.id));
      break;                      // una sola llamada por tick: controla costos
    }
  }
}

/** Briefing comprimido: nunca se manda el historial completo. */
function brief(s: SimState, cfg: LlmAgentCfg, prevView: string): AgentBriefing {
  const curve = NODES.map(n => `${n}Y ${nodeYield(s, n).toFixed(2)}%`).join(' · ');
  const s2s10 = ((nodeYield(s, 10) - nodeYield(s, 2)) * 100).toFixed(0);
  const s10s30 = ((nodeYield(s, 30) - nodeYield(s, 10)) * 100).toFixed(0);
  const rich = s.bonds
    .map(b => `${b.ticker} ${b.ytm.toFixed(2)}%`).join(', ');
  return {
    agentName: cfg.name,
    mandate: cfg.mandate,
    limits: cfg.limits,
    portfolio: 'Portafolio institucional diversificado; caja disponible para operar.',
    previousView: prevView,
    curve: `${curve} | 2s10s ${s2s10}bp, 10s30s ${s10s30}bp | bonos: ${rich}`,
    macro: `Inflación ${s.macro.cpiYoY.toFixed(1)}% a/a (consenso próximo dato ${s.cpiConsensus.toFixed(1)}%), ` +
           `tasa BCRP ${s.macro.policyRate.toFixed(2)}%, UST10Y ${s.macro.ust10y.toFixed(2)}%, ` +
           `USD/PEN ${s.macro.usdpen.toFixed(3)}, EMBI ${s.macro.embi.toFixed(0)}, VIX ${s.macro.vix.toFixed(1)}, ` +
           `régimen ${s.macro.regime}`,
    news: s.news.slice(0, 3).map(n => n.headline).join(' | ') || 'Sin novedades.',
    flow: s.tape.slice(0, 6).map(e => e.text).join(' | ') || 'Sin flujo relevante.',
  };
}
