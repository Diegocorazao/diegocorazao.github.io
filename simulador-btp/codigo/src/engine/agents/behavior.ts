// ============================================================
// agents/behavior.ts — comportamiento de los agentes por reglas.
//
// Un solo motor parametrizado: cada institución se comporta distinto
// según su arquetipo, tamaño, preferencia de plazo, actividad y grado
// contrarian. No consumen IA.
// ============================================================
import type { Rng } from '../rng';
import type { SimState, Bond } from '../types';
import { NODES } from '../types';
import { AGENTS, type AgentDef } from './registry';

export interface AgentBook {
  cash: number;                        // PEN MM disponibles
  pos: Record<string, number>;         // PEN MM nominal por bono
}

export function initBooks(): Record<string, AgentBook> {
  const b: Record<string, AgentBook> = {};
  for (const a of AGENTS) {
    // cada institución arranca invertida en su tramo preferido
    const pos: Record<string, number> = {};
    b[a.id] = { cash: a.aum * 0.12, pos };
  }
  return b;
}

/** Elige el bono que mejor calza con las preferencias del agente. */
function pickBond(a: AgentDef, s: SimState, rng: Rng): Bond {
  const pesos = s.bonds.map(b => {
    const p = a.prefs[b.node] ?? 0.05;
    return p * (0.7 + rng() * 0.6);
  });
  const tot = pesos.reduce((x, y) => x + y, 0);
  let r = rng() * tot;
  for (let i = 0; i < s.bonds.length; i++) {
    r -= pesos[i];
    if (r <= 0) return s.bonds[i];
  }
  return s.bonds[Math.floor(s.bonds.length / 2)];
}

/** Tamaño de operación proporcional al tamaño de la casa. */
function size(a: AgentDef, rng: Rng, factor = 1): number {
  return Math.max(2, a.ticketMM * (0.25 + rng() * 0.75) * factor) * 1e6;
}

export function runRuleAgents(
  s: SimState, rng: Rng,
  books: Record<string, AgentBook>,
  momentum: number,                    // cambio del 10Y en bps (ventana corta)
  exec: (side: 'BUY'|'SELL', ticker: string, nominal: number, who: string) => any,
) {
  const noticia = s.activeNews[0];
  const fresca = noticia && s.t - noticia.t < 30 && !noticia.texto
                 ? noticia.bias : 0;

  for (const a of AGENTS) {
    if (a.brain === 'llm') continue;                 // esos deciden con el modelo
    if (rng() > a.actividad * 0.055) continue;       // no todos actúan cada tick

    const book = books[a.id];
    const b = pickBond(a, s, rng);
    const tenencia = book.pos[b.ticker] ?? 0;

    // ---- señal según arquetipo ----
    let señal = 0;                                   // >0 comprar, <0 vender

    switch (a.archetype) {
      case 'AFP': {
        // compradores estructurales: entran cuando el nodo se abre
        const res = s.curve.residual[b.node] ?? 0;
        señal = res * 0.35 - momentum * (1 - a.contrarian) * 0.15;
        señal += fresca * (a.contrarian > 0.6 ? -0.45 : 0.35);
        break;
      }
      case 'SEGURO': {
        // ALM: compran si el largo paga por encima de su tasa objetivo
        const y = b.ytm;
        señal = (y - 7.30) * 1.6;
        if (b.maturityYears < 12) señal -= 0.6;      // no les interesa el corto
        señal += fresca * -0.5;                      // aprovechan sell-offs
        break;
      }
      case 'BANCO_LOCAL': {
        // creadores de mercado: giran inventario, no toman vistas fuertes
        señal = (rng() - 0.5) * 1.2 - momentum * 0.06;
        if (fresca > 0.6) señal -= 0.7;              // recortan inventario en estrés
        break;
      }
      case 'BANCO_US': {
        // trading + flujo de clientes: siguen algo el momentum global
        señal = -momentum * 0.14 + (rng() - 0.5) * 0.9 + fresca * 0.35;
        break;
      }
      case 'OFFSHORE': {
        señal = -momentum * 0.22 + fresca * 0.6;
        if (s.macro.regime === 'RISK_OFF') señal -= 0.8;
        break;
      }
      case 'HEDGE': {
        // relative value: arbitra el nodo más dislocado
        let peor = 10, val = 0;
        for (const n of NODES) {
          if (Math.abs(s.curve.residual[n]) > Math.abs(val)) {
            val = s.curve.residual[n]; peor = n;
          }
        }
        if (Math.abs(val) < 2.5) continue;
        const obj = s.bonds.reduce((x, y) =>
          Math.abs(y.node - peor) < Math.abs(x.node - peor) ? y : x, s.bonds[0]);
        const lado = val > 0 ? 'BUY' : 'SELL';
        const tn = book.pos[obj.ticker] ?? 0;
        if (lado === 'SELL' && tn <= 0) continue;
        const q = Math.min(size(a, rng), (lado === 'SELL' ? tn * 1e6 : Infinity));
        if (q < 1e6) continue;
        const r = exec(lado, obj.ticker, q, a.name);
        if (r?.ok) {
          book.pos[obj.ticker] = tn + (lado === 'BUY' ? q / 1e6 : -q / 1e6);
          book.cash += (lado === 'BUY' ? -1 : 1) * q / 1e6;
        }
        continue;
      }
      case 'FONDO_MUTUO': {
        // procíclicos: siguen la noticia y el momentum de frente
        señal = momentum * 0.18 * -1 + fresca * 0.9;
        señal = -señal;                              // venden con malas noticias
        break;
      }
    }

    if (Math.abs(señal) < 0.35) continue;
    const lado: 'BUY'|'SELL' = señal > 0 ? 'BUY' : 'SELL';
    if (lado === 'SELL' && tenencia <= 0) continue;  // nadie vende lo que no tiene

    const intensidad = Math.min(1.4, Math.abs(señal) / 1.2);
    let q = size(a, rng, intensidad);
    if (lado === 'SELL') q = Math.min(q, tenencia * 1e6);
    if (lado === 'BUY') q = Math.min(q, Math.max(0, book.cash) * 1e6);
    if (q < 1e6) continue;

    const r = exec(lado, b.ticker, q, a.name);
    if (r?.ok) {
      book.pos[b.ticker] = tenencia + (lado === 'BUY' ? q / 1e6 : -q / 1e6);
      book.cash += (lado === 'BUY' ? -1 : 1) * q / 1e6;
    }
  }
}
