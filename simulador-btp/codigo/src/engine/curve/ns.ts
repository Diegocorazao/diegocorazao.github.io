// Nelson-Siegel: y(t) = b0 + b1·L(t) + b2·C(t)
import type { NSFactors } from '../types';

export function nsYield(f: NSFactors, t: number): number {
  const x = Math.max(t, 1e-6) / f.tau;
  const L = (1 - Math.exp(-x)) / x;
  const C = L - Math.exp(-x);
  return f.b0 + f.b1 * L + f.b2 * C;
}
