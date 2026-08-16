// ============================================================
// events/catalog.ts — catálogo de noticias de mercado.
//
// Cada evento define:
//   · cuándo puede ocurrir (probabilidad condicionada al estado macro)
//   · qué le hace a la curva, con PERFIL POR MADUREZ (no un shock parejo)
//   · qué le hace a las variables macro
//   · cómo lo leen los agentes (sesgo direccional que interpretan)
//
// El perfil por madurez es lo que hace que un recorte del BCRP mueva el
// 2Y mucho y el 30Y casi nada, mientras que un deterioro fiscal haga lo
// contrario.
// ============================================================
import type { MacroState, Regime } from '../types';

export interface EventEffect {
  /** Shock en bps por nodo: [2Y, 3Y, 5Y, 7Y, 10Y, 15Y, 20Y, 30Y] */
  curveBp: number[];
  macro?: Partial<MacroState>;
  regime?: Regime;
  /** Cómo lo leen los agentes: -1 muy bullish bonos, +1 muy bearish */
  bias: number;
  /** Fuerza del evento para decidir si la IA consulta fuera de cadencia */
  major: boolean;
}

export interface MarketEvent {
  id: string;
  headline: (m: MacroState) => string;
  body: (m: MacroState) => string;
  /** Probabilidad por tick, condicionada al estado del mundo. */
  prob: (m: MacroState, day: number) => number;
  effect: (m: MacroState, rnd: number) => EventEffect;
}

// perfiles de shock reutilizables (suman al nodo correspondiente)
const P_CORTO   = [1.00, 0.92, 0.74, 0.55, 0.38, 0.20, 0.12, 0.06];  // política monetaria
const P_LARGO   = [0.06, 0.10, 0.20, 0.36, 0.55, 0.82, 0.95, 1.00];  // fiscal / term premium
const P_PAREJO  = [0.85, 0.88, 0.92, 0.95, 1.00, 0.98, 0.95, 0.90];  // riesgo país / global
const P_BELLY   = [0.25, 0.45, 0.80, 1.00, 0.92, 0.55, 0.35, 0.20];  // flujos locales

const esc = (perfil: number[], bp: number) => perfil.map(x => x * bp);

export const EVENTS: MarketEvent[] = [
  // ---------------- política monetaria ----------------
  {
    id: 'bcrp_dovish',
    headline: () => 'BCRP: comunicado con tono más dovish de lo esperado',
    body: m => `El directorio mantiene la tasa en ${m.policyRate.toFixed(2)}% pero abre la puerta ` +
               `a recortes si la inflación sigue convergiendo.`,
    prob: m => (m.cpiYoY < 3.0 && m.gdpYoY < 3.0 ? 0.00028 : 0.00006),
    effect: (_m, r) => ({
      curveBp: esc(P_CORTO, -(7 + r * 8)), bias: -0.7, major: true,
      macro: { cpiExp: -0.05 } as any,
    }),
  },
  {
    id: 'bcrp_hawkish',
    headline: () => 'BCRP advierte por persistencia inflacionaria',
    body: () => 'El comunicado señala preocupación por expectativas desancladas y no descarta ' +
                'mantener la tasa alta por más tiempo.',
    prob: m => (m.cpiYoY > 3.4 ? 0.00030 : 0.00006),
    effect: (_m, r) => ({
      curveBp: esc(P_CORTO, 6 + r * 9), bias: 0.7, major: true,
      regime: 'INFLATION_FEAR',
    }),
  },
  {
    id: 'bcrp_cut',
    headline: () => 'BCRP SORPRENDE: recorta la tasa de referencia en 50bp',
    body: m => `La tasa baja a ${(m.policyRate - 0.5).toFixed(2)}%. El consenso esperaba sin cambios.`,
    prob: m => (m.cpiYoY < 2.9 && m.gdpYoY < 2.5 ? 0.00012 : 0.00002),
    effect: m => ({
      curveBp: esc(P_CORTO, -16), bias: -1, major: true,
      macro: { policyRate: m.policyRate - 0.5 } as any, regime: 'CARRY',
    }),
  },

  // ---------------- fiscal y rating ----------------
  {
    id: 'fiscal_deterioro',
    headline: () => 'Déficit fiscal supera las proyecciones oficiales',
    body: () => 'El resultado económico del sector público no financiero se deteriora más de lo ' +
                'previsto. El mercado descuenta mayor emisión de deuda larga.',
    prob: () => 0.00016,
    effect: (_m, r) => ({
      curveBp: esc(P_LARGO, 6 + r * 7), bias: 0.6, major: true,
      macro: { embi: 6 } as any,
    }),
  },
  {
    id: 'rating_negativo',
    headline: () => 'Agencia coloca el rating soberano en perspectiva negativa',
    body: () => 'Cita el deterioro fiscal y la incertidumbre política como principales riesgos.',
    prob: m => (m.embi > 190 ? 0.00014 : 0.00003),
    effect: (_m, r) => ({
      curveBp: esc(P_PAREJO, 8 + r * 9), bias: 0.9, major: true,
      macro: { embi: 14 } as any, regime: 'FISCAL_STRESS' as any,
    }),
  },
  {
    id: 'rating_positivo',
    headline: () => 'Agencia mejora la perspectiva del rating soberano a estable',
    body: () => 'Destaca la solidez de las reservas internacionales y la consolidación fiscal.',
    prob: m => (m.embi < 160 ? 0.00012 : 0.00003),
    effect: (_m, r) => ({
      curveBp: esc(P_PAREJO, -(6 + r * 6)), bias: -0.7, major: true,
      macro: { embi: -11 } as any,
    }),
  },
  {
    id: 'ministro',
    headline: () => 'Renuncia el ministro de Economía',
    body: () => 'La salida abre incertidumbre sobre la continuidad del programa fiscal.',
    prob: () => 0.00006,
    effect: (_m, r) => ({
      curveBp: esc(P_LARGO, 9 + r * 10), bias: 0.8, major: true,
      macro: { embi: 12, usdpen: 0.02 } as any,
    }),
  },

  // ---------------- oferta / MEF ----------------
  {
    id: 'emision_larga',
    headline: () => 'MEF anuncia emisión de bonos soberanos a 20 y 30 años',
    body: () => 'La operación busca extender el perfil de vencimientos. El mercado anticipa ' +
                'presión de oferta en el tramo largo.',
    prob: () => 0.00020,
    effect: (_m, r) => ({
      curveBp: esc(P_LARGO, 5 + r * 8), bias: 0.5, major: true,
    }),
  },
  {
    id: 'recompra',
    headline: () => 'MEF anuncia recompra de bonos cortos financiada con emisión larga',
    body: () => 'Operación de administración de deuda: retira papel corto y coloca largo. ' +
                'Se espera un twist en la curva.',
    prob: () => 0.00014,
    effect: (_m, r) => ({
      curveBp: esc(P_CORTO, -(4 + r * 5)).map((x, i) => x + esc(P_LARGO, 5 + r * 6)[i]),
      bias: 0.1, major: true,
    }),
  },
  {
    id: 'subasta_fuerte',
    headline: () => 'Subasta soberana con demanda récord',
    body: () => 'El bid-to-cover más alto del año confirma apetito por papel local.',
    prob: () => 0.00022,
    effect: (_m, r) => ({ curveBp: esc(P_BELLY, -(3 + r * 4)), bias: -0.5, major: false }),
  },
  {
    id: 'subasta_debil',
    headline: () => 'Subasta soberana con bid-to-cover débil',
    body: () => 'La colocación queda por debajo del monto objetivo. Señal de saturación de oferta.',
    prob: () => 0.00016,
    effect: (_m, r) => ({ curveBp: esc(P_BELLY, 4 + r * 5), bias: 0.5, major: false }),
  },

  // ---------------- flujos locales ----------------
  {
    id: 'retiro_afp',
    headline: () => 'Congreso aprueba nuevo retiro extraordinario de fondos de AFP',
    body: () => 'Las administradoras deberán generar liquidez. El mercado sabe que habrá ventas, ' +
                'pero no cuánto ni en qué papeles.',
    prob: () => 0.00009,
    effect: (_m, r) => ({
      curveBp: esc(P_BELLY, 10 + r * 12), bias: 0.9, major: true,
    }),
  },
  {
    id: 'aportes_afp',
    headline: () => 'AFP reportan fuertes aportes netos en el mes',
    body: () => 'El flujo entrante deberá colocarse en el mercado local en las próximas semanas.',
    prob: () => 0.00016,
    effect: (_m, r) => ({ curveBp: esc(P_BELLY, -(5 + r * 6)), bias: -0.6, major: true }),
  },
  {
    id: 'seguros_duration',
    headline: () => 'Aseguradoras buscan alargar duration tras alza de primas',
    body: () => 'La necesidad de calce actuarial concentra demanda en el tramo 20Y-30Y.',
    prob: () => 0.00014,
    effect: (_m, r) => ({ curveBp: esc(P_LARGO, -(4 + r * 5)), bias: -0.4, major: false }),
  },

  // ---------------- global ----------------
  {
    id: 'fed_hawkish',
    headline: () => 'Fed sorprende con mensaje hawkish; Treasuries se venden',
    body: () => 'El tramo largo de la curva americana sube y arrastra a los emergentes.',
    prob: m => (m.ust10y > 4.3 ? 0.00022 : 0.00012),
    effect: (_m, r) => ({
      curveBp: esc(P_PAREJO, 6 + r * 7), bias: 0.7, major: true,
      macro: { ust10y: 0.09, usdpen: 0.015 } as any,
    }),
  },
  {
    id: 'rally_ust',
    headline: () => 'Fuerte rally de Treasuries tras datos débiles en EEUU',
    body: () => 'La expectativa de recortes de la Fed impulsa la deuda emergente.',
    prob: m => (m.ust10y > 4.0 ? 0.00020 : 0.00010),
    effect: (_m, r) => ({
      curveBp: esc(P_PAREJO, -(6 + r * 7)), bias: -0.7, major: true,
      macro: { ust10y: -0.10 } as any,
    }),
  },
  {
    id: 'risk_off',
    headline: () => 'Venta masiva de activos emergentes',
    body: () => 'Salida generalizada de fondos dedicados. Spreads más anchos y menor liquidez.',
    prob: m => (m.vix > 20 ? 0.00028 : 0.00006),
    effect: (_m, r) => ({
      curveBp: esc(P_PAREJO, 9 + r * 11), bias: 1, major: true,
      macro: { vix: 4.5, embi: 15, usdpen: 0.03 } as any, regime: 'RISK_OFF',
    }),
  },
  {
    id: 'cobre_cae',
    headline: () => 'Precio internacional del cobre cae con fuerza',
    body: () => 'El deterioro de términos de intercambio presiona al sol y a los activos locales.',
    prob: () => 0.00016,
    effect: (_m, r) => ({
      curveBp: esc(P_PAREJO, 4 + r * 5), bias: 0.5, major: false,
      macro: { usdpen: 0.025, embi: 6 } as any,
    }),
  },
  {
    id: 'china_estimulo',
    headline: () => 'China anuncia estímulo mayor a lo esperado; el cobre sube',
    body: () => 'Mejora la perspectiva de términos de intercambio para Perú.',
    prob: () => 0.00014,
    effect: (_m, r) => ({
      curveBp: esc(P_PAREJO, -(4 + r * 5)), bias: -0.5, major: false,
      macro: { usdpen: -0.02, embi: -5 } as any,
    }),
  },
  {
    id: 'banco_overweight',
    headline: () => 'Banco de inversión global recomienda sobreponderar Perú',
    body: () => 'Destaca el carry real y la estabilidad macro frente a pares de la región.',
    prob: () => 0.00018,
    effect: (_m, r) => ({ curveBp: esc(P_PAREJO, -(3 + r * 4)), bias: -0.5, major: false }),
  },
  {
    id: 'banco_underweight',
    headline: () => 'Banco de inversión recomienda subponderar el tramo largo peruano',
    body: () => 'Advierte que el term premium no compensa el riesgo fiscal.',
    prob: () => 0.00016,
    effect: (_m, r) => ({ curveBp: esc(P_LARGO, 4 + r * 5), bias: 0.5, major: false }),
  },
];
