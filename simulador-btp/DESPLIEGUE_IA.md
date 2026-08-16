# Desplegar el proxy de IA (5 minutos)

Permite que **cualquier visitante** juegue con los agentes de IA activos,
sin que tu API key quede expuesta en el navegador ni en el repo.

## 1. Crear el Worker

1. Entra a `dash.cloudflare.com` → crea cuenta gratuita si no tienes.
2. Menú izquierdo: **Workers & Pages** → **Create** → **Create Worker**.
3. Nombre: `mesa-btp` → **Deploy** (crea uno de ejemplo, lo reemplazamos).
4. **Edit code** → borra todo → pega el contenido de `worker.js` → **Deploy**.

Anota la URL que te da, del tipo:
`https://mesa-btp.TUUSUARIO.workers.dev`

## 2. Configurar la key y el dominio

En el Worker → **Settings** → **Variables and Secrets**:

| Nombre | Tipo | Valor |
|---|---|---|
| `DEEPSEEK_API_KEY` | Secret | tu key `sk-...` |
| `ALLOWED_ORIGIN` | Text | `https://diegocorazao.github.io` |
| `DAILY_CAP` | Text | `2000` |

**Secret** es importante para la key: queda cifrada y no se puede leer
después, ni siquiera desde el panel.

## 3. Activar el límite por IP (recomendado)

En **Storage & Databases** → **KV** → **Create namespace**, nómbralo
`mesa-btp-limits`. Vuelve al Worker → **Settings** → **Bindings** →
**Add binding** → tipo KV, nombre de variable `LIMITS`, y elige el
namespace. Sin esto el proxy funciona, pero sin freno por visitante.

## 4. Conectar el simulador

En `codigo/src/config/ai.ts` pon tu URL:

```ts
export const PROXY_URL = 'https://mesa-btp.TUUSUARIO.workers.dev';
```

Recompila (`npm run build`), copia el contenido de `dist/` a la raíz de la
carpeta del proyecto en tu repo, commit y push. Listo: la IA queda activa
para todos los visitantes.

## Costos y control

Cada decisión de un agente consume unos 700 tokens de entrada y 150 de
salida. Con los precios de DeepSeek eso es del orden de centavos por cada
mil decisiones. Aun así:

- El `DAILY_CAP` corta el gasto diario pase lo que pase.
- El límite por IP evita que un solo visitante consuma el cupo.
- El proxy **fuerza** modelo, `max_tokens` y formato JSON, y solo acepta
  exactamente dos mensajes: nadie puede usarlo como chatbot gratuito.
- Revisa el consumo en el panel de DeepSeek de vez en cuando; si algo se
  dispara, borras el secret en Cloudflare y el proxy deja de funcionar al
  instante (el simulador cae solo a las heurísticas).

## Si el cupo se agota

El simulador lo detecta y sigue jugándose con los agentes heurísticos. El
visitante puede además pegar su propia key en el mismo panel.
