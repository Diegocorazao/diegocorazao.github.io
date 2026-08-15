import { describe, it, expect } from 'vitest';
import { nsYield } from '../ns';

describe('nelson-siegel', () => {
  const f = { b0: 7.2, b1: -2.4, b2: -1.0, tau: 2.2 };
  it('corto ≈ b0+b1, largo ≈ b0', () => {
    expect(nsYield(f, 0.05)).toBeCloseTo(f.b0 + f.b1, 1);
    expect(nsYield(f, 60)).toBeCloseTo(f.b0, 0);
  });
  it('con b1<0 la curva es creciente', () => {
    expect(nsYield(f, 2)).toBeLessThan(nsYield(f, 10));
    expect(nsYield(f, 10)).toBeLessThan(nsYield(f, 30));
  });
});
