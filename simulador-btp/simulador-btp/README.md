# Mesa BTP — Simulador de trading de bonos soberanos

Simulador de mesa de renta fija: administras PEN 100 MM en bonos soberanos
peruanos contra agentes institucionales (AFP, aseguradora, offshore macro,
banco) que operan por reglas propias. **El P&L al final te dice de dónde
salió**: carry, rolldown, movimiento de tasas, posicionamiento de curva y
costo de ejecución.

**[▶ Jugar](https://diegocorazao.github.io/simulador-btp/)**

## Qué lo hace distinto de un juego de números aleatorios

**La curva es Nelson-Siegel + residuales por nodo.** Los tres factores son
los movimientos canónicos de una curva: nivel (parallel shift), pendiente
(steepener/flattener) y curvatura (butterfly). Los residuales por nodo son
dislocaciones con mean reversion — lo que un hedge fund de relative value
arbitra.

**Los precios se derivan de las tasas, nunca al revés.** Precio, duration
modificada, convexidad y DV01 salen de fórmulas de descuento semestral con
tests que verifican el bono a la par (cupón = ytm → 100), la monotonía
precio-yield, el round-trip y el DV01 contra diferencia finita.

**El impacto de mercado es raíz cuadrada con régimen de liquidez.** Una
orden de PEN 5 MM casi no mueve el mercado; PEN 300 MM en el tramo largo en
risk-off se lleva decenas de bps. En estrés los spreads se abren y la
profundidad cae.

**El mercado es reflexivo.** Nadie programó la cascada: una venta grande
mueve el yield, el momentum del offshore la amplifica, la liquidez se
adelgaza, y la aseguradora aparece recién cuando el 30Y cruza su tasa
objetivo de ALM. Comportamiento emergente de reglas simples.

**La sorpresa macro emerge.** El dato de inflación se genera del estado
verdadero de la economía; el consenso, del estado observable. La sorpresa
es la diferencia — no está escrita en ningún lado. El shock se aplica con
perfil por madurez: golpea el tramo corto y decae hacia el largo.

## Arquitectura

```
src/engine/          motor puro en TypeScript, sin dependencias de UI
  pricing/           precio↔yield, duration, convexidad, DV01 (+tests)
  curve/             Nelson-Siegel (+tests)
  portfolio/         atribución de P&L
  sim.ts             orquestador: 1 tick = 1 minuto de mercado
src/ui/              terminal React (7 paneles, tema oscuro)
tests/               comportamiento del motor (reproducibilidad, límites)
```

El motor no importa nada de la UI: es testeable de forma aislada y podría
correr en Node, en un backend o en el navegador sin cambios.

## Correr localmente

```bash
npm install
npm test      # 13 tests
npm run dev
```

## Estado y hoja de ruta

MVP jugable: 9 bonos, curva de 8 nodos, 4 agentes heurísticos, dato de
inflación con sorpresa, régimen de liquidez, atribución de P&L.

Siguientes cortes: escenario de retiro de AFP con liquidación endógena,
trades de curva (2s10s, butterflies), capa LLM opcional para la vista
estratégica de los agentes (el motor de precios queda intacto: el modelo
solo emite intenciones que pasan por la misma validación que las órdenes
del jugador).

Datos ficticios, proyecto educativo. No constituye asesoría de inversión.
