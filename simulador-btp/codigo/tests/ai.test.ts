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
      cfg: { id:'X', name:'PIMCO EM', mandate:'', limits:'', maxTicketMM: 40,
             everyTicks: 10, reactMM: 30, reactCooldown: 50 },
      d: { action:'SELL', bond:'SOB2037', sizeMM: 500, urgency:1, conviction:1, view:'v', reason:'r' },
      reacting: false,
    });
    desk.step(s, (a, b, c, d) => execute(s, a, b, c, d));
    expect(desk.log[0].sizeMM).toBe(40);      // recortado al límite del mandato
  });
});

describe('reacción a las operaciones del jugador', () => {
  it('registra las operaciones del jugador en el estado', () => {
    const s = newSim(31);
    execute(s, 'BUY', 'SOB2037', 45e6, 'PLAYER');
    expect(s.playerTrades.length).toBe(1);
    expect(s.playerTrades[0].mm).toBe(45);
    expect(s.playerTrades[0].side).toBe('BUY');
  });
  it('no registra las operaciones de los agentes', () => {
    const s = newSim(32);
    execute(s, 'SELL', 'SOB2034', 20e6, 'BANCO');
    expect(s.playerTrades.length).toBe(0);
  });
  it('una operación grande del jugador encola reacciones de la IA', async () => {
    const s = newSim(33); const desk = new AiDesk();
    let consultas = 0;
    desk.setClient({ name: 'test', async decide() { consultas++; return null; } });
    tick(s);
    execute(s, 'BUY', 'SOB2040', 90e6, 'PLAYER');   // sobre el umbral de los tres
    desk.step(s, () => ({ ok: true }));
    await new Promise(r => setTimeout(r, 10));
    expect(consultas).toBeGreaterThan(0);
  });
});
