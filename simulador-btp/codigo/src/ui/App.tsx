import { useEffect, useRef, useState } from 'react';
import { newSim, tick, execute, nodeYield } from '../engine/sim';
import { NODES, type SimState } from '../engine/types';
import { AiDesk } from '../engine/ai/desk';
import { DeepSeekClient, ProxyClient } from '../engine/ai/client';
import { PROXY_URL } from '../config/ai';

const fmt = (x: number, d = 2) => x.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
const mm = (x: number) => (x / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 2 });

export default function App() {
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const simRef = useRef<SimState>(newSim(seed));
  const deskRef = useRef((() => {
    const d = new AiDesk();
    if (PROXY_URL) d.setClient(new ProxyClient(PROXY_URL));   // IA activa para todos
    return d;
  })());
  const [, force] = useState(0);
  const [showCfg, setShowCfg] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [nominal, setNominal] = useState('10');
  const [sel, setSel] = useState('SOB2037');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const id = setInterval(() => {
      const s = simRef.current;
      if (s.speed === 0) return;
      for (let i = 0; i < s.speed; i++) {
        tick(s);
        deskRef.current.step(s, (side, tk, nom, who) => execute(s, side, tk, nom, who));
      }
      force(x => x + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const s = simRef.current;
  const hh = 9 + Math.floor((s.t % 390) / 60), mn = (s.t % 390) % 60;

  function trade(side: 'BUY' | 'SELL') {
    const n = parseFloat(nominal) * 1e6;
    const r = execute(s, side, sel, n, 'PLAYER');
    setMsg(r.ok ? `${side} ${sel} PEN ${nominal}mm @ ${r.execYield!.toFixed(3)}% (precio ${r.execPrice!.toFixed(3)})` : `⚠ ${r.msg}`);
    force(x => x + 1);
  }

  return (
    <div className="term">
      <header>
        <div className="brand">MESA BTP <span className="dim">· simulador de bonos soberanos</span></div>
        <div className="clock">Día {s.day} · {String(hh).padStart(2,'0')}:{String(mn).padStart(2,'0')}
          <span className={`regime ${s.macro.regime}`}>{s.macro.regime}</span></div>
        <div className="speeds">
          {[0, 1, 5, 20].map(v => (
            <button key={v} className={s.speed === v ? 'on' : ''}
              onClick={() => { s.speed = v as any; force(x => x + 1); }}>
              {v === 0 ? '⏸' : `${v}x`}</button>
          ))}
        </div>
        <button className={`aibtn ${deskRef.current.active ? 'on' : ''}`}
                onClick={() => setShowCfg(true)}>
          IA {deskRef.current.active ? '● ON' : '○ OFF'}
        </button>
        <div className="pnl">
          <span>NAV <b>PEN {mm(s.totals.nav)}mm</b></span>
          <span className={s.totals.dailyPnl >= 0 ? 'up' : 'dn'}>Día {s.totals.dailyPnl >= 0 ? '+' : ''}{mm(s.totals.dailyPnl)}mm</span>
          <span className={s.totals.totalPnl >= 0 ? 'up' : 'dn'}>Total {s.totals.totalPnl >= 0 ? '+' : ''}{mm(s.totals.totalPnl)}mm</span>
          <span>DV01 PEN {fmt(s.totals.dv01, 0)}/bp</span>
        </div>
      </header>

      <div className="grid">
        <section className="panel curve">
          <h2>CURVA SOBERANA <span className="dim">hoy vs cierre anterior · Δbp</span></h2>
          <CurveChart s={s} />
          <div className="spreads">
            {([['2s10s',2,10],['5s10s',5,10],['10s30s',10,30]] as const).map(([n,a,b]) => (
              <span key={n}>{n}: <b>{((nodeYield(s,b)-nodeYield(s,a))*100).toFixed(1)}bp</b></span>
            ))}
          </div>
        </section>

        <section className="panel bonds">
          <h2>BONOS</h2>
          <table>
            <thead><tr><th>Ticker</th><th>YTM</th><th>Δd(bp)</th><th>Precio</th><th>Bid/Ask</th><th>MDur</th><th>DV01/mm</th></tr></thead>
            <tbody>
              {s.bonds.map(b => {
                const prev = s.curve.prevDay[b.node] ?? b.ytm;
                const chg = (b.ytm - prev) * 100;
                return (
                  <tr key={b.ticker} className={sel === b.ticker ? 'sel' : ''} onClick={() => setSel(b.ticker)}>
                    <td>{b.ticker}</td>
                    <td>{b.ytm.toFixed(3)}%</td>
                    <td className={chg <= 0 ? 'up' : 'dn'}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}</td>
                    <td>{b.price.toFixed(3)}</td>
                    <td className="dim">{b.bidY.toFixed(2)}/{b.askY.toFixed(2)}</td>
                    <td>{b.modDur.toFixed(2)}</td>
                    <td>{fmt(b.dv01PerMM, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="ticket">
            <span className="dim">TICKET</span>
            <b>{sel}</b>
            <input value={nominal} onChange={e => setNominal(e.target.value)} /> <span className="dim">PEN mm</span>
            <button className="buy" onClick={() => trade('BUY')}>COMPRAR</button>
            <button className="sell" onClick={() => trade('SELL')}>VENDER</button>
          </div>
          {msg && <div className="msg">{msg}</div>}
        </section>

        <section className="panel news">
          <h2>NEWS</h2>
          {s.news.slice(0, 8).map((n, i) => (
            <div key={i} className="newsitem">
              <div className="hl">{n.headline}</div>
              {n.body && <div className="dim">{n.body}</div>}
            </div>
          ))}
        </section>

        <section className="panel tape">
          <h2>ORDER FLOW</h2>
          <div className="tapebox">
            {s.tape.slice(0, 30).map((e, i) => (
              <div key={i} className={`t-${e.kind}`}>
                <span className="dim">{String(9 + Math.floor((e.t % 390) / 60)).padStart(2,'0')}:{String((e.t % 390) % 60).padStart(2,'0')}</span> {e.text}
              </div>
            ))}
          </div>
        </section>

        <section className="panel port">
          <h2>PORTAFOLIO <span className="dim">caja PEN {mm(s.portfolio.cash)}mm</span></h2>
          <table>
            <thead><tr><th>Bono</th><th>Nominal</th><th>P.Prom</th><th>P.Mkt</th><th>P&L no real.</th></tr></thead>
            <tbody>
              {Object.entries(s.portfolio.positions).filter(([,p]) => p.nominal > 0).length === 0 && (
                <tr><td colSpan={5} className="dim">Sin posiciones — usa el ticket para operar</td></tr>
              )}
              {Object.entries(s.portfolio.positions).filter(([,p]) => p.nominal > 0).map(([tk, p]) => {
                const b = s.bonds.find(x => x.ticker === tk)!;
                const upl = (b.price - p.avgPrice) / 100 * p.nominal;
                return (
                  <tr key={tk}>
                    <td>{tk}</td><td>{mm(p.nominal)}mm</td>
                    <td>{p.avgPrice.toFixed(3)}</td><td>{b.price.toFixed(3)}</td>
                    <td className={upl >= 0 ? 'up' : 'dn'}>{upl >= 0 ? '+' : ''}{mm(upl)}mm</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="dim" style={{marginTop: 6}}>Realizado: PEN {mm(s.portfolio.realizedTotal)}mm</div>
        </section>

        <section className="panel aidesk">
          <h2>AI DESK <span className="dim">
            {deskRef.current.active
              ? `${deskRef.current.client?.name} · ${deskRef.current.calls} consultas`
              : 'inactivo — agentes por reglas'}</span></h2>
          {deskRef.current.log.length === 0 && (
            <div className="dim">
              {deskRef.current.active
                ? 'Esperando la primera decisión de los agentes…'
                : 'Activa la IA en el botón del encabezado para que tres agentes institucionales razonen sus operaciones con un modelo de lenguaje.'}
            </div>
          )}
          {deskRef.current.log.slice(0, 6).map((e, i) => (
            <div key={i} className="deskrow">
              <div>
                <b className="agent">{e.agent}</b>
                <span className={`act ${e.action}`}>{e.action}</span>
                {e.bond && <span> {e.bond} {e.sizeMM.toFixed(0)}mm</span>}
                <span className="dim"> conv {(e.conviction * 100).toFixed(0)}%</span>
                {!e.executed && e.action !== 'HOLD' && <span className="rej"> rechazado</span>}
              </div>
              <div className="dim reason">{e.reason}</div>
            </div>
          ))}
        </section>

        <section className="panel attr">
          <h2>ATRIBUCIÓN DE P&L <span className="dim">acumulada</span></h2>
          <AttrBars s={s} />
        </section>

        <section className="panel macro">
          <h2>MACRO</h2>
          <div className="kv"><span>Inflación a/a</span><b>{s.macro.cpiYoY.toFixed(1)}%</b></div>
          <div className="kv"><span>Tasa BCRP</span><b>{s.macro.policyRate.toFixed(2)}%</b></div>
          <div className="kv"><span>UST 10Y</span><b>{s.macro.ust10y.toFixed(2)}%</b></div>
          <div className="kv"><span>USD/PEN</span><b>{s.macro.usdpen.toFixed(3)}</b></div>
          <div className="kv"><span>EMBI</span><b>{s.macro.embi.toFixed(0)}</b></div>
          <div className="kv"><span>VIX</span><b>{s.macro.vix.toFixed(1)}</b></div>
          <div className="dim" style={{marginTop: 8}}>Próximo CPI: consenso {s.cpiConsensus.toFixed(1)}%</div>
        </section>
      </div>
      {showCfg && (
        <div className="modal" onClick={() => setShowCfg(false)}>
          <div className="modalbox" onClick={e => e.stopPropagation()}>
            <h3>Agentes con IA</h3>
            <p className="dim">
              Tres agentes institucionales (Offshore Macro, Hedge RV y AFP Alfa) pueden
              razonar sus decisiones con un modelo de lenguaje en vez de reglas fijas.
              El modelo <b>no fija precios</b>: solo emite intenciones que pasan por la
              misma validación que tus órdenes.
            </p>
            <p className="dim">
              Tu API key se guarda <b>solo en la memoria de esta pestaña</b>. No viaja a
              ningún servidor propio ni queda en el código. Al cerrar la pestaña se borra.
            </p>
            {PROXY_URL && (
              <p className="dim">
                Esta demo ya viene con los agentes de IA activos mediante un proxy con
                cupo limitado: no necesitas key. Si el cupo diario se agota, puedes usar
                la tuya abajo.
              </p>
            )}
            <input type="password" placeholder="API key de DeepSeek (sk-...) — opcional"
                   value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <div className="modalbtns">
              <button className="buy" onClick={() => {
                deskRef.current.setClient(
                  apiKey.trim() ? new DeepSeekClient(apiKey.trim())
                  : PROXY_URL ? new ProxyClient(PROXY_URL) : null);
                setShowCfg(false); force(x => x + 1);
              }}>Activar</button>
              <button onClick={() => {
                deskRef.current.setClient(null); setApiKey('');
                setShowCfg(false); force(x => x + 1);
              }}>Desactivar</button>
            </div>
            {deskRef.current.errors > 0 && (
              <p className="dim" style={{marginTop:10}}>
                {deskRef.current.errors} consultas fallidas — si son todas, probablemente el
                navegador bloquea la llamada (CORS) o la key es inválida. Los agentes siguen
                operando con sus reglas heurísticas.
              </p>
            )}
          </div>
        </div>
      )}

      <footer className="dim">
        Motor cuantitativo determina precios · agentes (AFP, aseguradora, offshore, banco) operan por reglas ·
        semilla {s.seed} · proyecto educativo, datos ficticios
      </footer>
    </div>
  );
}

function AttrBars({ s }: { s: SimState }) {
  const rows: [string, number][] = [
    ['Carry', s.attr.carry],
    ['Rolldown', s.attr.rolldown],
    ['Tasas (nivel)', s.attr.rates],
    ['Curva', s.attr.curve],
    ['Ejecución', s.attr.execution],
  ];
  const max = Math.max(1e5, ...rows.map(r => Math.abs(r[1])));
  const total = rows.reduce((a, r) => a + r[1], 0);
  return (
    <div className="attr-wrap">
      {rows.map(([k, v]) => (
        <div className="attr-row" key={k}>
          <span className="attr-k">{k}</span>
          <div className="attr-track">
            <div className={`attr-bar ${v >= 0 ? 'pos' : 'neg'}`}
                 style={{ width: `${Math.abs(v) / max * 46}%`,
                          left: v >= 0 ? '50%' : undefined,
                          right: v < 0 ? '50%' : undefined }} />
            <div className="attr-mid" />
          </div>
          <span className={`attr-v ${v >= 0 ? 'up' : 'dn'}`}>
            {v >= 0 ? '+' : ''}{(v / 1e6).toFixed(2)}mm
          </span>
        </div>
      ))}
      <div className="attr-total">
        <span>Total explicado</span>
        <b className={total >= 0 ? 'up' : 'dn'}>{total >= 0 ? '+' : ''}{(total / 1e6).toFixed(2)}mm</b>
      </div>
    </div>
  );
}

function CurveChart({ s }: { s: SimState }) {
  const W = 520, H = 190, P = 34;
  const ys = NODES.map(n => nodeYield(s, n));
  const yPrev = NODES.map(n => s.curve.prevDay[n] ?? nodeYield(s, n));
  const all = [...ys, ...yPrev];
  const yMin = Math.min(...all) - 0.12, yMax = Math.max(...all) + 0.12;
  const X = (i: number) => P + (i / (NODES.length - 1)) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v - yMin) / (yMax - yMin)) * (H - 2 * P);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="curvechart">
      {NODES.map((n, i) => (
        <g key={n}>
          <text x={X(i)} y={H - 10} className="ax">{n}Y</text>
          <text x={X(i)} y={Y(ys[i]) - 8} className="val">{ys[i].toFixed(2)}</text>
        </g>
      ))}
      <path d={path(yPrev)} className="prev" />
      <path d={path(ys)} className="curr" />
      {NODES.map((n, i) => <circle key={n} cx={X(i)} cy={Y(ys[i])} r={3} className="dot" />)}
    </svg>
  );
}
