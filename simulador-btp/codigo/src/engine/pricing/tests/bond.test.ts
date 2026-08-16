import { describe, it, expect } from 'vitest';
import { priceFromYtm, ytmFromPrice, modDuration, dv01PerMM, convexity } from '../bond';

describe('pricing', () => {
  it('bono a la par: cupón = ytm → precio 100', () => {
    expect(priceFromYtm(7, 10, 7)).toBeCloseTo(100, 8);
    expect(priceFromYtm(5.35, 8.5, 5.35)).toBeCloseTo(100, 8);
  });
  it('monotonía: sube yield, baja precio', () => {
    expect(priceFromYtm(6, 12, 7)).toBeLessThan(priceFromYtm(6, 12, 6));
  });
  it('round-trip precio ↔ ytm', () => {
    for (const y of [3.2, 5.75, 8.4, 11.1]) {
      const p = priceFromYtm(6.85, 14, y);
      expect(ytmFromPrice(6.85, 14, p)).toBeCloseTo(y, 7);
    }
  });
  it('DV01 coincide con diferencia finita', () => {
    const c = 6.9, m = 11, y = 6.4;
    const fd = (priceFromYtm(c, m, y - 0.01) - priceFromYtm(c, m, y + 0.01)) / 2;
    expect(dv01PerMM(c, m, y)).toBeCloseTo(fd / 100 * 1e6, -1);
  });
  it('duration y convexidad razonables', () => {
    const md = modDuration(6.35, 15, 6.9);
    expect(md).toBeGreaterThan(8); expect(md).toBeLessThan(11);
    expect(convexity(6.35, 15, 6.9)).toBeGreaterThan(0);
  });
});
