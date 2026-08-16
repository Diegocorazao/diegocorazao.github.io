// ============================================================
// agents/registry.ts — el censo del mercado.
//
// Todos los participantes existen en el motor con cartera propia,
// preferencias de plazo y comportamiento distinto. Lo que cambia entre
// ellos es el CEREBRO:
//
//   brain 'llm'  → las instituciones grandes que mueven precio. Razonan
//                  con el modelo de lenguaje, por turnos rotativos, para
//                  que el costo no dependa de cuántas sean.
//   brain 'rule' → el resto. Reglas rápidas y gratuitas que mantienen el
//                  mercado vivo: cotizan, siguen momentum, arbitran.
//
// Cada agente tiene cartera real: no puede vender lo que no tiene, y su
// tamaño determina cuánto mueve el mercado cuando opera.
// ============================================================

export type Archetype =
  | 'AFP' | 'SEGURO' | 'BANCO_LOCAL' | 'BANCO_US' | 'OFFSHORE' | 'HEDGE' | 'FONDO_MUTUO';

export interface AgentDef {
  id: string;
  name: string;
  archetype: Archetype;
  /** AUM en PEN MM — determina tamaño de ticket e impacto */
  aum: number;
  brain: 'llm' | 'rule';
  /** Nodos preferidos (peso relativo por tenor) */
  prefs: Partial<Record<number, number>>;
  /** 0 = muy paciente, 1 = muy activo */
  actividad: number;
  /** 0 = sigue el momentum, 1 = contrarian puro */
  contrarian: number;
  /** Ticket máximo por operación, PEN MM */
  ticketMM: number;
  /** Solo para brain 'llm': mandato que lee el modelo */
  mandate?: string;
  limits?: string;
}

export const AGENTS: AgentDef[] = [
  // ---------------- AFPs (las cuatro del sistema) ----------------
  {
    id: 'AFP_INTEGRA', name: 'AFP Integra', archetype: 'AFP', aum: 38_000,
    brain: 'llm', prefs: { 7: 1, 10: 1.4, 15: 1.2, 20: 0.8 },
    actividad: 0.25, contrarian: 0.75, ticketMM: 120,
    mandate:
      'Eres la AFP más grande del sistema peruano y el mayor tenedor local de soberanos. ' +
      'Horizonte de años, baja rotación, retorno ajustado por riesgo. Comprador estructural ' +
      'en caídas: cuando el mercado vende con pánico, tú sueles estar del otro lado si el nivel ' +
      'compensa. Prefieres 7Y-20Y. Muy sensible a cambios regulatorios y a retiros de afiliados.',
    limits: 'Ticket máximo 120mm. Vendes solo por liquidez forzada o cambio real en riesgo país.',
  },
  {
    id: 'AFP_PRIMA', name: 'AFP Prima', archetype: 'AFP', aum: 30_000,
    brain: 'rule', prefs: { 5: 0.8, 7: 1.2, 10: 1.3, 15: 1 },
    actividad: 0.3, contrarian: 0.65, ticketMM: 100,
  },
  {
    id: 'AFP_PROFUTURO', name: 'AFP Profuturo', archetype: 'AFP', aum: 26_000,
    brain: 'rule', prefs: { 7: 1, 10: 1.2, 15: 1.1, 20: 0.9 },
    actividad: 0.28, contrarian: 0.7, ticketMM: 80,
  },
  {
    id: 'AFP_HABITAT', name: 'AFP Habitat', archetype: 'AFP', aum: 14_000,
    brain: 'rule', prefs: { 5: 1, 7: 1.1, 10: 1.2, 15: 0.8 },
    actividad: 0.35, contrarian: 0.6, ticketMM: 50,
  },

  // ---------------- Aseguradoras ----------------
  {
    id: 'SEG_PACIFICO', name: 'Pacífico Seguros', archetype: 'SEGURO', aum: 16_000,
    brain: 'rule', prefs: { 15: 0.9, 20: 1.4, 30: 1.6 },
    actividad: 0.2, contrarian: 0.85, ticketMM: 70,
  },
  {
    id: 'SEG_RIMAC', name: 'Rímac Seguros', archetype: 'SEGURO', aum: 15_000,
    brain: 'rule', prefs: { 15: 1, 20: 1.3, 30: 1.5 },
    actividad: 0.2, contrarian: 0.85, ticketMM: 60,
  },
  {
    id: 'SEG_INTERSEGURO', name: 'Interseguro', archetype: 'SEGURO', aum: 8_000,
    brain: 'rule', prefs: { 15: 0.9, 20: 1.2, 30: 1.4 },
    actividad: 0.22, contrarian: 0.8, ticketMM: 40,
  },
  {
    id: 'SEG_POSITIVA', name: 'La Positiva', archetype: 'SEGURO', aum: 5_000,
    brain: 'rule', prefs: { 10: 0.8, 15: 1.1, 20: 1.2, 30: 1 },
    actividad: 0.25, contrarian: 0.75, ticketMM: 30,
  },

  // ---------------- Offshore ----------------
  {
    id: 'PIMCO', name: 'PIMCO EM', archetype: 'OFFSHORE', aum: 120_000,
    brain: 'llm', prefs: { 5: 0.9, 10: 1.3, 20: 1.1, 30: 0.9 },
    actividad: 0.55, contrarian: 0.35, ticketMM: 250,
    mandate:
      'Gran fondo global de renta fija emergente. Perú es una posición dentro de una cartera ' +
      'mundial: te importan los Treasuries, el dólar, el cobre y el apetito por riesgo global ' +
      'tanto como la macro local. Tu tamaño mueve el mercado, así que dosificas la ejecución. ' +
      'Puedes tomar posiciones grandes y direccionales, y también salir rápido si el entorno ' +
      'global se deteriora. Compites contra otros globales por el mismo papel.',
    limits: 'Ticket máximo 250mm. Cualquier plazo. En risk-off global reduces exposición a EM.',
  },
  {
    id: 'OFFSHORE_RM', name: 'Real money offshore', archetype: 'OFFSHORE', aum: 45_000,
    brain: 'rule', prefs: { 10: 1.2, 15: 1, 20: 1 },
    actividad: 0.4, contrarian: 0.4, ticketMM: 90,
  },
  {
    id: 'HEDGE_RV', name: 'Hedge fund RV', archetype: 'HEDGE', aum: 9_000,
    brain: 'rule', prefs: { 5: 1.2, 7: 1.3, 10: 1.2, 15: 0.9 },
    actividad: 0.85, contrarian: 0.9, ticketMM: 45,
  },

  // ---------------- Bancos internacionales ----------------
  {
    id: 'BANK_US_1', name: 'JP Morgan', archetype: 'BANCO_US', aum: 60_000,
    brain: 'rule', prefs: { 5: 1, 10: 1.2, 20: 0.9, 30: 0.8 },
    actividad: 0.7, contrarian: 0.45, ticketMM: 120,
  },
  {
    id: 'BANK_US_2', name: 'Citi', archetype: 'BANCO_US', aum: 50_000,
    brain: 'rule', prefs: { 5: 1, 10: 1.1, 20: 1 },
    actividad: 0.65, contrarian: 0.45, ticketMM: 100,
  },
  {
    id: 'BANK_US_3', name: 'Goldman Sachs', archetype: 'BANCO_US', aum: 45_000,
    brain: 'rule', prefs: { 7: 1.1, 10: 1.2, 30: 0.9 },
    actividad: 0.75, contrarian: 0.4, ticketMM: 90,
  },

  // ---------------- Bancos locales (proveen liquidez) ----------------
  {
    id: 'BCP', name: 'BCP — Mesa de Distribución', archetype: 'BANCO_LOCAL', aum: 34_000,
    brain: 'llm', prefs: { 2: 1.1, 3: 1.2, 5: 1.2, 7: 1, 10: 0.9 },
    actividad: 0.9, contrarian: 0.5, ticketMM: 90,
    mandate:
      'Eres la mesa de trading del banco más grande del Perú. Tu negocio es distinto al de un ' +
      'fondo: ganas con el spread bid-ask, el carry del inventario y el flujo de clientes, no ' +
      'con apuestas direccionales grandes. Provees liquidez al mercado, pero no eres una ' +
      'obra de caridad: si el mercado se pone feo reduces inventario rápido y ensanchas ' +
      'precios. Ves flujo que otros no ven, y eso te da lectura del posicionamiento real. ' +
      'Prefieres el tramo corto y medio, donde giras inventario con más facilidad. ' +
      'Tu límite real es el balance: no acumulas riesgo de tasa por convicción macro.',
    limits: 'Ticket máximo 90mm. Prefieres 2Y-10Y. Reduces inventario en regímenes de estrés.',
  },
  {
    id: 'BBVA', name: 'BBVA', archetype: 'BANCO_LOCAL', aum: 26_000,
    brain: 'rule', prefs: { 2: 1, 3: 1.1, 5: 1.2, 10: 0.9 },
    actividad: 0.85, contrarian: 0.5, ticketMM: 50,
  },
  {
    id: 'SCOTIA', name: 'Scotiabank', archetype: 'BANCO_LOCAL', aum: 18_000,
    brain: 'rule', prefs: { 3: 1, 5: 1.1, 7: 1.1, 10: 1 },
    actividad: 0.8, contrarian: 0.5, ticketMM: 40,
  },
  {
    id: 'INTERBANK', name: 'Interbank', archetype: 'BANCO_LOCAL', aum: 16_000,
    brain: 'rule', prefs: { 2: 1, 3: 1.1, 5: 1.1, 7: 1 },
    actividad: 0.8, contrarian: 0.5, ticketMM: 35,
  },
  {
    id: 'BCI', name: 'BCI', archetype: 'BANCO_LOCAL', aum: 7_000,
    brain: 'rule', prefs: { 3: 1, 5: 1.1, 7: 0.9 },
    actividad: 0.7, contrarian: 0.5, ticketMM: 20,
  },
  {
    id: 'FONDO_MUTUO', name: 'Fondos mutuos locales', archetype: 'FONDO_MUTUO', aum: 12_000,
    brain: 'rule', prefs: { 3: 1.1, 5: 1.2, 7: 1, 10: 0.8 },
    actividad: 0.6, contrarian: 0.1, ticketMM: 35,
  },
];

export const LLM_POOL = AGENTS.filter(a => a.brain === 'llm');
export const RULE_POOL = AGENTS.filter(a => a.brain === 'rule');
