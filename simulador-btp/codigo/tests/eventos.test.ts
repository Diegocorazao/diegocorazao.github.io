import { describe, it, expect } from 'vitest';
import { newSim, tick, nodeYield, execute, CAPITAL } from '../src/engine/sim';
import { injectPreset, injectTexto } from '../src/engine/events/engine';
import { makeRng } from '../src/engine/rng';

describe('capital y escala', () => {
  it('el jugador arranca con PEN 2,000 MM', () => {
    const s = newSim(1);
    expect(CAPITAL).toBe(2_000e6);
    expect(s.portfolio.cash).toBe(2_000e6);
  });
  it('puede operar tickets grandes sin quedarse sin caja', () => {
    const s = newSim(2);
    expect(execute(s, 'BUY', 'SOB2037', 300e6, 'PLAYER').ok).toBe(true);
  });
});

describe('eventos inyectados', () => {
  it('un preset mueve la curva y publica noticia', () => {
    const s = newSim(3); const rng = makeRng(7);
    const y0 = nodeYield(s, 2);
    const n = injectPreset(s, 'bcrp', rng);
    expect(n.headline.length).toBeGreaterThan(5);
    expect(s.news[0].headline).toBe(n.headline);
    // el tramo corto es el más sensible a una decisión del BCRP
    const d2 = Math.abs(nodeYield(s, 2) - y0) * 100;
    const d30 = Math.abs(nodeYield(s, 30) - nodeYield(newSim(3), 30)) * 100;
    expect(d2).toBeGreaterThanOrEqual(d30);
  });
  it('una crisis empuja el mercado y cambia el régimen', () => {
    const s = newSim(4); const rng = makeRng(11);
    const y10 = nodeYield(s, 10);
    injectPreset(s, 'crisis', rng);
    expect(nodeYield(s, 10)).toBeGreaterThan(y10);
    expect(s.macro.regime).toBe('RISK_OFF');
  });
  it('el titular escrito NO mueve precios por sí solo', () => {
    const s = newSim(5);
    const antes = s.bonds.map(b => b.ytm);
    injectTexto(s, 'El Congreso aprueba un retiro masivo de AFP');
    s.bonds.forEach((b, i) => expect(b.ytm).toBe(antes[i]));
    expect(s.news[0].headline).toContain('retiro masivo');
  });
});

describe('historial de bonos', () => {
  it('acumula series de yield y precio', () => {
    const s = newSim(6);
    for (let i = 0; i < 60; i++) tick(s);
    const h = s.history['SOB2037'];
    expect(h.ytm.length).toBeGreaterThan(5);
    expect(h.price.length).toBe(h.ytm.length);
    expect(h.price[0]).toBeGreaterThan(50);
  });
});
