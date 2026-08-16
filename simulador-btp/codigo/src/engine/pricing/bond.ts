// ============================================================
// pricing/bond.ts — matemática de bonos (cupón semestral)
// Precio por 100 de nominal; yields en % anual (bond-equivalent)
// ============================================================

/** Precio desde el YTM. */
export function priceFromYtm(coupon: number, maturityYears: number, ytm: number): number {
  const n = Math.max(1, Math.round(maturityYears * 2));   // períodos semestrales
  const c = coupon / 2, y = ytm / 200;
  let pv = 0;
  for (let k = 1; k <= n; k++) pv += c / Math.pow(1 + y, k);
  pv += 100 / Math.pow(1 + y, n);
  return pv;
}

/** YTM desde precio (Newton con salvaguarda de bisección). */
export function ytmFromPrice(coupon: number, maturityYears: number, price: number): number {
  let lo = -5, hi = 60, y = coupon || 5;
  for (let i = 0; i < 60; i++) {
    const p = priceFromYtm(coupon, maturityYears, y);
    const dp = (priceFromYtm(coupon, maturityYears, y + 0.0001) - p) / 0.0001;
    const step = dp !== 0 ? (p - price) / dp : 0;
    let yn = y - step;
    if (!(yn > lo && yn < hi) || !isFinite(yn)) yn = (lo + hi) / 2;
    if (priceFromYtm(coupon, maturityYears, yn) > price) lo = Math.min(yn, hi); else hi = Math.max(yn, lo);
    if (Math.abs(yn - y) < 1e-10) return yn;
    y = yn;
  }
  return y;
}

/** Duration modificada (años). */
export function modDuration(coupon: number, maturityYears: number, ytm: number): number {
  const n = Math.max(1, Math.round(maturityYears * 2));
  const c = coupon / 2, y = ytm / 200;
  let pv = 0, dpv = 0;
  for (let k = 1; k <= n; k++) {
    const df = Math.pow(1 + y, -k);
    pv += c * df; dpv += (k / 2) * c * df / (1 + y);
  }
  const dfn = Math.pow(1 + y, -n);
  pv += 100 * dfn; dpv += (n / 2) * 100 * dfn / (1 + y);
  return dpv / pv;
}

export function convexity(coupon: number, maturityYears: number, ytm: number): number {
  const h = 0.01;
  const p0 = priceFromYtm(coupon, maturityYears, ytm);
  const pU = priceFromYtm(coupon, maturityYears, ytm + h);
  const pD = priceFromYtm(coupon, maturityYears, ytm - h);
  return (pU + pD - 2 * p0) / (p0 * Math.pow(h / 100, 2));
}

/** DV01 en PEN por bp, por PEN 1MM de nominal. */
export function dv01PerMM(coupon: number, maturityYears: number, ytm: number): number {
  const p = priceFromYtm(coupon, maturityYears, ytm);
  const md = modDuration(coupon, maturityYears, ytm);
  return (p / 100) * md * 1e6 * 0.0001;
}
