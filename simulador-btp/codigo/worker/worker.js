/**
 * worker.js — proxy para el simulador Mesa BTP
 * ---------------------------------------------------------------
 * Esconde la API key de DeepSeek: el navegador nunca la ve.
 * Se despliega en Cloudflare Workers (plan gratuito).
 *
 * Protecciones incluidas (importantes: es un endpoint público):
 *   · solo acepta POST desde tu dominio (CORS restringido)
 *   · límite de llamadas por IP y por día global (KV opcional)
 *   · fuerza modelo, max_tokens y formato JSON: nadie puede usarlo
 *     como un chatbot gratis con prompts arbitrarios
 *   · rechaza cuerpos grandes
 * ---------------------------------------------------------------
 * Variables a configurar en el panel de Cloudflare:
 *   DEEPSEEK_API_KEY  (Secret)  → tu key
 *   ALLOWED_ORIGIN    (Variable) → https://diegocorazao.github.io
 *   DAILY_CAP         (Variable) → p.ej. 3000  (llamadas por día)
 * KV opcional: crear namespace y enlazarlo como  LIMITS
 */

const MODEL = 'deepseek-chat';
const MAX_TOKENS = 300;
const MAX_BODY = 6000;          // caracteres
const PER_IP_PER_HOUR = 120;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')
      return json({ error: 'Método no permitido' }, 405, cors);

    // origen
    const reqOrigin = request.headers.get('Origin') || '';
    if (origin !== '*' && reqOrigin && reqOrigin !== origin)
      return json({ error: 'Origen no permitido' }, 403, cors);

    // cuerpo
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'Cuerpo muy grande' }, 413, cors);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'JSON inválido' }, 400, cors); }
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length !== 2)
      return json({ error: 'Formato no permitido' }, 400, cors);

    // límites
    if (env.LIMITS) {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      const hour = new Date().toISOString().slice(0, 13);
      const day = new Date().toISOString().slice(0, 10);
      const kIp = `ip:${ip}:${hour}`, kDay = `day:${day}`;
      const [nIp, nDay] = await Promise.all([
        env.LIMITS.get(kIp).then(v => +v || 0),
        env.LIMITS.get(kDay).then(v => +v || 0),
      ]);
      const cap = +(env.DAILY_CAP || 3000);
      if (nIp >= PER_IP_PER_HOUR)
        return json({ error: 'Límite por hora alcanzado' }, 429, cors);
      if (nDay >= cap)
        return json({ error: 'Cupo diario del demo agotado' }, 429, cors);
      await Promise.all([
        env.LIMITS.put(kIp, String(nIp + 1), { expirationTtl: 7200 }),
        env.LIMITS.put(kDay, String(nDay + 1), { expirationTtl: 172800 }),
      ]);
    }

    // llamada a DeepSeek con parámetros forzados
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        response_format: { type: 'json_object' },
        temperature: 1.0,
        max_tokens: MAX_TOKENS,
      }),
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
