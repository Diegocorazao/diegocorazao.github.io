// ============================================================
// events/engine.ts — dispara eventos y aplica sus efectos.
//
// Dos vías de entrada:
//   1. ORGÁNICA: probabilidades condicionadas al estado macro (catalog.ts)
//   2. INYECTADA: el jugador provoca un evento desde la terminal
//        · botones predefinidos → signo ALEATORIO y magnitud aleatoria:
//          el jugador no sabe si le vendrá bien o mal, y debe reaccionar
//        · texto libre → NO produce shock directo; solo entra al briefing
//          de los agentes de IA, y el mercado se mueve únicamente por cómo
//          ellos lo interpreten
// ============================================================
import type { NodeTenor, SimState } from '../types';
import { NODES } from '../types';
import { EVENTS, type EventEffect } from './catalog';
import type { Rng } from '../rng';

export interface ActiveNews {
  t: number; headline: string; bias: number; major: boolean; texto?: boolean;
}

/** Aplica el shock de un evento sobre los factores y residuales de la curva. */
export function applyEffect(s: SimState, e: EventEffect) {
  // el shock por nodo entra como residual; la parte común empuja el nivel
  const avg = e.curveBp.reduce((a, b) => a + b, 0) / e.curveBp.length;
  s.curve.ns.b0 += avg / 100 * 0.55;
  NODES.forEach((n: NodeTenor, i: number) => {
    s.curve.residual[n] += (e.curveBp[i] - avg) * 0.9;
  });
  if (e.macro) {
    for (const [k, v] of Object.entries(e.macro)) {
      const key = k as keyof typeof s.macro;
      if (typeof (s.macro as any)[key] === 'number' && typeof v === 'number') {
        (s.macro as any)[key] += v;      // los deltas se suman
      }
    }
  }
  if (e.regime) s.macro.regime = e.regime as any;
}

/** Evalúa el catálogo y quizá dispara un evento orgánico. */
export function maybeEvent(s: SimState, rng: Rng): ActiveNews | null {
  for (const ev of EVENTS) {
    if (rng() < ev.prob(s.macro, s.day)) {
      const eff = ev.effect(s.macro, rng());
      applyEffect(s, eff);
      const news = {
        t: s.t, headline: ev.headline(s.macro), bias: eff.bias, major: eff.major,
      };
      s.news.unshift({ t: s.t, kind: 'event', headline: news.headline,
                       body: ev.body(s.macro) });
      if (s.news.length > 30) s.news.pop();
      return news;
    }
  }
  return null;
}

// ---------------- inyección desde la terminal ----------------
export type PresetId = 'inflacion' | 'bcrp' | 'desempleo' | 'crisis' | 'fiscal' | 'global';

const PRESETS: Record<PresetId, {
  label: string;
  build: (r1: number, r2: number, s: SimState) => { headline: string; body: string; eff: EventEffect };
}> = {
  inflacion: {
    label: 'Dato de inflación',
    build: (r1, r2, s) => {
      const sorpresa = Math.round((r1 - 0.5) * 120);            // ±60bp
      const actual = +(s.macro.cpiYoY + sorpresa / 100).toFixed(1);
      const bp = sorpresa * (0.18 + r2 * 0.12);
      return {
        headline: `INFLACIÓN PERÚ: ${actual.toFixed(1)}% a/a — sorpresa ${sorpresa >= 0 ? '+' : ''}${sorpresa}bp`,
        body: `Consenso era ${s.macro.cpiYoY.toFixed(1)}%. El mercado repricea la trayectoria del BCRP.`,
        eff: {
          curveBp: [1.00, 0.92, 0.74, 0.55, 0.38, 0.20, 0.12, 0.06].map(x => x * bp),
          macro: { cpiYoY: sorpresa / 100 } as any,
          regime: sorpresa > 35 ? 'INFLATION_FEAR' : undefined,
          bias: Math.sign(sorpresa) * 0.8, major: true,
        },
      };
    },
  },
  bcrp: {
    label: 'Decisión del BCRP',
    build: (r1, r2, s) => {
      const opciones = [-50, -25, 0, 0, 25, 50];
      const mov = opciones[Math.floor(r1 * opciones.length)];
      const bp = mov * (0.22 + r2 * 0.15);
      const txt = mov === 0
        ? `BCRP mantiene la tasa en ${s.macro.policyRate.toFixed(2)}%`
        : `BCRP ${mov < 0 ? 'RECORTA' : 'SUBE'} la tasa ${Math.abs(mov)}bp a ` +
          `${(s.macro.policyRate + mov / 100).toFixed(2)}%`;
      return {
        headline: txt,
        body: mov === 0
          ? 'Sin cambios, pero el comunicado ajusta el sesgo. El mercado busca señales.'
          : 'Movimiento no anticipado por completo. Reprecio inmediato del tramo corto.',
        eff: {
          curveBp: [1.00, 0.92, 0.74, 0.55, 0.38, 0.20, 0.12, 0.06].map(x => x * bp),
          macro: { policyRate: mov / 100 } as any,
          bias: Math.sign(mov) * 0.9, major: true,
        },
      };
    },
  },
  desempleo: {
    label: 'Actividad y empleo',
    build: (r1, r2) => {
      const sorpresa = (r1 - 0.5) * 2;                          // -1 a +1
      const debil = sorpresa < 0;
      const bp = sorpresa * (7 + r2 * 6);
      return {
        headline: debil
          ? 'Actividad económica se desacelera más de lo esperado'
          : 'Actividad económica sorprende al alza',
        body: debil
          ? 'El mercado descuenta una postura más laxa del BCRP en los próximos meses.'
          : 'La fortaleza de la demanda interna reduce la expectativa de recortes.',
        eff: {
          curveBp: [0.95, 0.90, 0.80, 0.66, 0.50, 0.30, 0.20, 0.12].map(x => x * bp),
          macro: { gdpYoY: sorpresa * 0.4 } as any,
          bias: Math.sign(sorpresa) * 0.6, major: true,
        },
      };
    },
  },
  crisis: {
    label: 'Crisis (tipo aleatorio)',
    build: (r1, r2) => {
      const tipos = [
        { h: 'CRISIS POLÍTICA: moción de vacancia presidencial avanza en el Congreso',
          b: 'La incertidumbre institucional golpea los activos locales y el tipo de cambio.',
          p: [0.35, 0.45, 0.60, 0.75, 0.90, 1.00, 1.00, 0.95], m: { embi: 22, usdpen: 0.05, vix: 2 } },
        { h: 'CRISIS DE LIQUIDEZ: se secan los libros en el mercado local',
          b: 'Los market makers amplían spreads y reducen profundidad. Operar cuesta caro.',
          p: [0.80, 0.85, 0.95, 1.00, 1.00, 0.95, 0.90, 0.85], m: { vix: 6 } },
        { h: 'CRISIS GLOBAL: fuerte salida de capitales de mercados emergentes',
          b: 'Fondos dedicados registran redemptions masivos. Perú vende con el bloque.',
          p: [0.70, 0.75, 0.85, 0.92, 1.00, 1.00, 0.98, 0.95], m: { embi: 30, vix: 9, usdpen: 0.06 } },
        { h: 'CRISIS FISCAL: el Congreso aprueba un paquete de gasto no financiado',
          b: 'El deterioro del resultado fiscal presiona el term premium del tramo largo.',
          p: [0.10, 0.15, 0.28, 0.45, 0.68, 0.90, 1.00, 1.00], m: { embi: 18 } },
      ];
      const c = tipos[Math.floor(r1 * tipos.length)];
      const bp = 14 + r2 * 22;
      return {
        headline: c.h, body: c.b,
        eff: {
          curveBp: c.p.map(x => x * bp), macro: c.m as any,
          regime: 'RISK_OFF', bias: 1, major: true,
        },
      };
    },
  },
  fiscal: {
    label: 'Anuncio del MEF',
    build: (r1, r2) => {
      const emite = r1 < 0.55;
      const bp = (emite ? 1 : -1) * (5 + r2 * 9);
      return {
        headline: emite
          ? 'MEF anuncia emisión de bonos soberanos en el tramo largo'
          : 'MEF anuncia recompra de bonos con caja disponible',
        body: emite
          ? 'Oferta adicional concentrada en 20Y y 30Y.'
          : 'Retiro de papel del mercado; menor oferta neta esperada.',
        eff: {
          curveBp: [0.06, 0.10, 0.20, 0.36, 0.55, 0.82, 0.95, 1.00].map(x => x * bp),
          bias: Math.sign(bp) * 0.6, major: true,
        },
      };
    },
  },
  global: {
    label: 'Shock global',
    build: (r1, r2) => {
      const risk = r1 < 0.5;
      const bp = (risk ? 1 : -1) * (6 + r2 * 10);
      return {
        headline: risk
          ? 'Fed hawkish: Treasuries se venden y el dólar se fortalece'
          : 'Rally global de Treasuries impulsa la deuda emergente',
        body: risk
          ? 'El movimiento de tasas externas arrastra a los emergentes.'
          : 'La expectativa de recortes de la Fed reactiva el apetito por riesgo.',
        eff: {
          curveBp: [0.85, 0.88, 0.92, 0.95, 1.00, 0.98, 0.95, 0.90].map(x => x * bp),
          macro: { ust10y: (risk ? 1 : -1) * 0.10, usdpen: (risk ? 1 : -1) * 0.02 } as any,
          bias: risk ? 0.8 : -0.8, major: true,
        },
      };
    },
  },
};

export const PRESET_LIST = (Object.keys(PRESETS) as PresetId[])
  .map(id => ({ id, label: PRESETS[id].label }));

/** Inyecta un evento predefinido con signo y magnitud aleatorios. */
export function injectPreset(s: SimState, id: PresetId, rng: Rng): ActiveNews {
  const { headline, body, eff } = PRESETS[id].build(rng(), rng(), s);
  applyEffect(s, eff);
  s.news.unshift({ t: s.t, kind: 'macro', headline, body });
  if (s.news.length > 30) s.news.pop();
  return { t: s.t, headline, bias: eff.bias, major: true };
}

/**
 * Inyecta un titular escrito por el jugador.
 * NO produce shock directo: el mercado solo se moverá si los agentes de IA
 * deciden operar tras leerlo. Es el experimento de reflexividad pura.
 */
export function injectTexto(s: SimState, texto: string): ActiveNews {
  const headline = texto.trim().slice(0, 160);
  s.news.unshift({
    t: s.t, kind: 'event', headline,
    body: 'Titular en desarrollo. El mercado aún no lo ha descontado: el movimiento ' +
          'dependerá de cómo lo interpreten los participantes.',
  });
  if (s.news.length > 30) s.news.pop();
  return { t: s.t, headline, bias: 0, major: true, texto: true };
}
