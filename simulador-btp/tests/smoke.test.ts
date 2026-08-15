import { describe, it, expect } from 'vitest';
import { newSim, tick, execute, nodeYield } from '../src/engine/sim';

describe('motor', () => {
  it('reproducibilidad por semilla', () => {
    const a = newSim(42), b = newSim(42);
    for (let i = 0; i < 500; i++) { tick(a); tick(b); }
    expect(nodeYield(a, 10)).toBeCloseTo(nodeYield(b, 10), 10);
  });
  it('curva se mantiene en rango razonable tras 3000 ticks', () => {
    const s = newSim(7);
    for (let i = 0; i < 3000; i++) tick(s);
    for (const n of [2,5,10,30]) {
      const y = nodeYield(s, n);
      expect(y).toBeGreaterThan(1); expect(y).toBeLessThan(15);
    }
  });
  it('comprar reduce caja y crea posición; vender realiza P&L', () => {
    const s = newSim(3);
    const c0 = s.portfolio.cash;
    const r = execute(s, 'BUY', 'SOB2037', 20e6, 'PLAYER');
    expect(r.ok).toBe(true);
    expect(s.portfolio.cash).toBeLessThan(c0);
    expect(s.portfolio.positions['SOB2037'].nominal).toBe(20e6);
    const r2 = execute(s, 'SELL', 'SOB2037', 20e6, 'PLAYER');
    expect(r2.ok).toBe(true);
    expect(s.portfolio.positions['SOB2037'].nominal).toBe(0);
  });
  it('no permite vender lo que no se tiene ni exceder caja', () => {
    const s = newSim(5);
    expect(execute(s, 'SELL', 'SOB2042', 5e6, 'PLAYER').ok).toBe(false);
    expect(execute(s, 'BUY', 'SOB2042', 5000e6, 'PLAYER').ok).toBe(false);
  });
  it('orden grande mueve más el mercado que una chica', () => {
    const a = newSim(11), b = newSim(11);
    const y0 = nodeYield(a, 10);
    execute(a, 'SELL', 'SOB2034', 5e6, 'X');
    execute(b, 'SELL', 'SOB2034', 300e6, 'X');
    expect(nodeYield(b, 10) - y0).toBeGreaterThan(nodeYield(a, 10) - y0);
  });
  it('atribución acumula y aproxima el P&L total', () => {
    const s = newSim(9);
    execute(s, 'BUY', 'SOB2037', 30e6, 'PLAYER');
    for (let i = 0; i < 800; i++) tick(s);
    const sum = s.attr.carry + s.attr.rolldown + s.attr.rates + s.attr.curve + s.attr.execution;
    const err = Math.abs(sum - s.totals.totalPnl) / Math.max(1e6, Math.abs(s.totals.totalPnl));
    expect(err).toBeLessThan(0.35);   // atribución de primer orden
  });
});
