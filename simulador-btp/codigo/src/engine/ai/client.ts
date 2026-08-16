// ============================================================
// ai/client.ts — capa de LLM desacoplada del motor.
// El proveedor es intercambiable: el motor solo conoce LLMClient.
// El modelo NUNCA fija precios; solo emite intenciones que pasan
// por la misma validación que las órdenes del jugador.
// ============================================================

export interface AgentBriefing {
  agentName: string;
  mandate: string;
  portfolio: string;
  limits: string;
  curve: string;
  macro: string;
  news: string;
  flow: string;
  previousView: string;
}

export interface AgentDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  bond: string | null;
  sizeMM: number;          // PEN millones
  urgency: number;         // 0-1
  conviction: number;      // 0-1
  view: string;            // vista actualizada, se guarda en memoria
  reason: string;          // se muestra en el panel AI DESK
}

export interface LLMClient {
  name: string;
  decide(b: AgentBriefing, tickers: string[]): Promise<AgentDecision | null>;
}

// ---------- validación estricta (sin dependencias externas) ----------
export function validateDecision(raw: any, tickers: string[]): AgentDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action ?? '').toUpperCase();
  if (!['BUY', 'SELL', 'HOLD'].includes(action)) return null;

  let bond: string | null = raw.bond ? String(raw.bond).toUpperCase().trim() : null;
  if (action !== 'HOLD') {
    if (!bond || !tickers.includes(bond)) return null;   // no inventa instrumentos
  } else bond = null;

  const sizeMM = Number(raw.sizeMM ?? raw.size ?? 0);
  if (action !== 'HOLD' && (!isFinite(sizeMM) || sizeMM <= 0)) return null;

  const clamp01 = (x: any, d: number) => {
    const v = Number(x); return isFinite(v) ? Math.min(1, Math.max(0, v)) : d;
  };
  return {
    action: action as AgentDecision['action'],
    bond,
    sizeMM: Math.min(Math.abs(sizeMM), 400),    // techo duro; el motor recorta más
    urgency: clamp01(raw.urgency, 0.5),
    conviction: clamp01(raw.conviction, 0.5),
    view: String(raw.view ?? raw.thesis ?? '').slice(0, 200),
    reason: String(raw.reason ?? '').slice(0, 220),
  };
}

const SYSTEM = `Eres el portfolio manager de una institución que opera bonos soberanos peruanos.
Compites contra otros inversionistas institucionales. NO conoces sus posiciones privadas.
Respondes EXCLUSIVAMENTE con un objeto JSON, sin markdown ni texto adicional, con este esquema:
{"action":"BUY"|"SELL"|"HOLD","bond":"<ticker o null>","sizeMM":<número, PEN millones>,
"urgency":<0-1>,"conviction":<0-1>,"view":"<tu tesis en una frase>","reason":"<justificación breve>"}
Reglas: solo puedes usar los tickers listados. Respeta tus límites de riesgo y tu mandato.
Si no hay una operación con convicción razonable, responde HOLD.`;

function userPrompt(b: AgentBriefing, tickers: string[]): string {
  return `INSTITUCIÓN: ${b.agentName}
MANDATO: ${b.mandate}
LÍMITES: ${b.limits}
TU PORTAFOLIO: ${b.portfolio}
TU VISTA PREVIA: ${b.previousView}

CURVA: ${b.curve}
MACRO: ${b.macro}
NOTICIAS RECIENTES: ${b.news}
FLUJO OBSERVADO: ${b.flow}

TICKERS VÁLIDOS: ${tickers.join(', ')}

Decide tu acción y responde solo con el JSON.`;
}

// ---------- DeepSeek ----------
export class DeepSeekClient implements LLMClient {
  name = 'DeepSeek';
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.deepseek.com/chat/completions',
    private model = 'deepseek-chat',
  ) {}

  async decide(b: AgentBriefing, tickers: string[]): Promise<AgentDecision | null> {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userPrompt(b, tickers) },
          ],
          response_format: { type: 'json_object' },
          temperature: 1.0,
          max_tokens: 300,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const txt: string = data?.choices?.[0]?.message?.content ?? '';
      const clean = txt.replace(/```json|```/g, '').trim();
      return validateDecision(JSON.parse(clean), tickers);
    } catch {
      return null;          // el llamador cae a la heurística
    } finally {
      clearTimeout(to);
    }
  }
}

/**
 * Cliente vía proxy: el navegador NO tiene la API key.
 * El proxy (Cloudflare Worker) la guarda y aplica límites de uso.
 * Esto permite que cualquier visitante juegue con la IA activa.
 */
export class ProxyClient implements LLMClient {
  name = 'DeepSeek (demo)';
  constructor(private url: string) {}

  async decide(b: AgentBriefing, tickers: string[]): Promise<AgentDecision | null> {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userPrompt(b, tickers) },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const txt: string = data?.choices?.[0]?.message?.content ?? '';
      return validateDecision(JSON.parse(txt.replace(/```json|```/g, '').trim()), tickers);
    } catch {
      return null;
    } finally { clearTimeout(to); }
  }
}

/** Cliente de prueba: no llama a la red, útil para tests y demos. */
export class MockClient implements LLMClient {
  name = 'Mock';
  async decide(_b: AgentBriefing, tickers: string[]): Promise<AgentDecision> {
    return {
      action: 'HOLD', bond: null, sizeMM: 0, urgency: 0, conviction: 0.3,
      view: 'Sin señal clara', reason: 'Cliente de prueba', 
    };
  }
}
