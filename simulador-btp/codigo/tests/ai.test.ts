import { describe, it, expect } from 'vitest';
import { validateDecision } from '../src/engine/ai/client';
import { AiDesk } from '../src/engine/ai/desk';
import { newSim, tick, execute } from '../src/engine/sim';

const T = ['SOB2030', 'SOB2037', 'SOB2055'];

describe('validación de decisiones del LLM', () => {
  it('acepta una decisión bien formada', () => {
    const d = validateDecision({ action: 'SELL', bond: 'SOB2037', sizeMM: 25,
      urgency: 0.8, conviction: 0.7, view: 'x', reason: 'y' }, T);
    expect(d?.action).toBe('SELL'); expect(d?.sizeMM).toBe(25);
  });
  it('rechaza instrumentos inventados', () => {
    expect(validateDecision({ action: 'BUY', bond: 'SOB2099', sizeMM: 10 }, T)).toBeNull();
  });
  it('rechaza acciones inválidas y tamaños absurdos', () => {
    expect(validateDecision({ action: 'SHORT_SQUEEZE', bond: 'SOB2030', sizeMM: 5 }, T)).toBeNull();
    expect(validateDecision({ action: 'BUY', bond: 'SOB2030', sizeMM: -5 }, T)).toBeNull();
  });
  it('acota tamaño y normaliza urgencia/convicción fuera de rango', () => {
    const d = validateDecision({ action: 'BUY', bond: 'SOB2030', sizeMM: 99999,
      urgency: 7, conviction: -3 }, T)!;
    expect(d.sizeMM).toBeLessThanOrEqual(400);
    expect(d.urgency).toBeLessThanOrEqual(1);
    expect(d.conviction).toBeGreaterThanOrEqual(0);
  });
  it('HOLD no requiere bono', () => {
    expect(validateDecision({ action: 'HOLD' }, T)?.action).toBe('HOLD');
  });
});

describe('AiDesk', () => {
  it('sin cliente, la simulación corre igual (fallback heurístico)', () => {
    const s = newSim(21); const desk = new AiDesk();
    for (let i = 0; i < 300; i++) {
      tick(s); desk.step(s, (a, b, c, d) => execute(s, a, b, c, d));
    }
    expect(desk.active).toBe(false);
    expect(s.totals.nav).toBeGreaterThan(0);
  });
  it('ejecuta decisiones pendientes respetando el techo del agente', () => {
    const s = newSim(22); const desk = new AiDesk();
    desk.pending.push({
      cfg: { id:'X', name:'Offshore Macro Fund', mandate:'', limits:'', maxTicketMM: 40, everyTicks: 10 },
      d: { action:'SELL', bond:'SOB2037', sizeMM: 500, urgency:1, conviction:1, view:'v', reason:'r' },
    });
    desk.step(s, (a, b, c, d) => execute(s, a, b, c, d));
    expect(desk.log[0].sizeMM).toBe(40);      // recortado al límite del mandato
  });
});
