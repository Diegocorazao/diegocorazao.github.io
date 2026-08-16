import { describe, it, expect } from 'vitest';
import { newSim, tick, nodeYield, execute } from '../src/engine/sim';
describe('calibración', () => {
  it('curva arranca en niveles peruanos', () => {
    const s = newSim(1);
    expect(nodeYield(s,2)).toBeGreaterThan(5.9); expect(nodeYield(s,2)).toBeLessThan(6.8);
    expect(nodeYield(s,10)).toBeGreaterThan(6.6); expect(nodeYield(s,10)).toBeLessThan(7.3);
    expect(nodeYield(s,30)).toBeGreaterThan(7.2); expect(nodeYield(s,30)).toBeLessThan(7.9);
  });
  it('movimiento diario típico bajo 12bp', () => {
    const s = newSim(4); const y0 = nodeYield(s,10);
    for (let i=0;i<390;i++) tick(s);
    expect(Math.abs(nodeYield(s,10)-y0)*100).toBeLessThan(12);
  });
  it('10mm barato, 300mm caro', () => {
    const a = newSim(6), b = newSim(6);
    const mid = a.bonds.find(x=>x.ticker==='SOB2030')!.ytm;
    const r1 = execute(a,'BUY','SOB2030',10e6,'PLAYER');
    const r2 = execute(b,'BUY','SOB2030',300e6,'AGENT');
    expect(Math.abs(r1.execYield!-mid)*100).toBeLessThan(2.2);   // ~half-spread del belly
    expect(Math.abs(r2.execYield!-mid)*100).toBeGreaterThan(4);
  });
});
