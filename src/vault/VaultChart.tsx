import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import { solHistory, type Pt, type Range } from '../wallet/walletData';
import type { Move } from './api';

const RANGES: { r: Range; l: string }[] = [{ r: '1d', l: '24 h' }, { r: '7d', l: '7 j' }, { r: '30d', l: '30 j' }];
const css = (name: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
const theme = () => ({
  bg: css('--panel', '#141311'), text: css('--muted', '#b9b1a2'), line: css('--line', '#2a2722'),
  accent: css('--accent', '#d6b26e'), green: css('--green', '#3ccf8e'), red: css('--red', '#ff6b6b'),
});
// couleur CSS (#rgb, #rrggbb ou rgb()) avec transparence, pour le dégradé de la courbe
function alpha(c: string, a: number) {
  const h = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (h) { const x = h[1]!.length === 3 ? h[1]!.split('').map((d) => d + d).join('') : h[1]!; return 'rgba(' + parseInt(x.slice(0, 2), 16) + ',' + parseInt(x.slice(2, 4), 16) + ',' + parseInt(x.slice(4, 6), 16) + ',' + a + ')'; }
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1]!.split(/[,\s/]+/).filter(Boolean).slice(0, 3); return 'rgba(' + p.join(',') + ',' + a + ')'; }
  return c;
}
const nf = (v: number, d = 2) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (v: number) => nf(v, Math.abs(v) >= 1000 ? 0 : 2) + ' $';
type Legend = { t: number; price: number; prot: number | null };

/**
 * Graphique du coffre : prix du SOL sur la période, valeur protégée (USDT + USDC) du wallet du coffre reconstituée
 * à partir de ses conversions et envois, et chaque conversion marquée sur la courbe.
 */
export function VaultChart({ wallet, moves, stableNow }: { wallet: string | null; moves: Move[] | null; stableNow: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<'Area'> | null>(null);
  const prot = useRef<ISeriesApi<'Line'> | null>(null);
  const [ready, setReady] = useState(false);
  const [range, setRange] = useState<Range>(() => { try { const r = localStorage.getItem('ts_vault_range'); return r === '1d' || r === '30d' ? r : '7d'; } catch { return '7d'; } });
  const [pts, setPts] = useState<Pt[] | null>(null);
  const [err, setErr] = useState(false);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [last, setLast] = useState<Legend | null>(null);

  // création du graphique (bibliothèque chargée seulement sur cette page)
  useEffect(() => {
    let alive = true, off = () => {};
    import('lightweight-charts').then(({ createChart, ColorType, CrosshairMode, LineStyle, LineType }) => {
      const el = box.current; if (!alive || !el) return;
      const T = theme();
      const c = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: T.bg }, textColor: T.text, fontFamily: css('--mono', 'ui-monospace, monospace'), fontSize: 11, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: T.line, style: LineStyle.Dotted } },
        crosshair: { mode: CrosshairMode.Magnet, vertLine: { labelBackgroundColor: T.accent }, horzLine: { labelBackgroundColor: T.accent } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        leftPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderColor: T.line, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
        handleScroll: false, handleScale: false,
        localization: { locale: 'fr-FR' },
      });
      const a = c.addAreaSeries({ lineColor: T.accent, topColor: alpha(T.accent, 0.28), bottomColor: alpha(T.accent, 0.02), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
      const p = c.addLineSeries({ priceScaleId: 'left', color: T.green, lineWidth: 2, lineType: LineType.WithSteps, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
      c.subscribeCrosshairMove((e) => {
        const d = e.time ? (e.seriesData.get(a) as { value: number } | undefined) : undefined;
        const q = e.time ? (e.seriesData.get(p) as { value: number } | undefined) : undefined;
        setLegend(d ? { t: (e.time as number) * 1000, price: d.value, prot: q?.value ?? null } : null);
      });
      const retheme = () => {
        const X = theme();
        c.applyOptions({ layout: { background: { type: ColorType.Solid, color: X.bg }, textColor: X.text }, grid: { horzLines: { color: X.line } }, timeScale: { borderColor: X.line }, crosshair: { vertLine: { labelBackgroundColor: X.accent }, horzLine: { labelBackgroundColor: X.accent } } });
        a.applyOptions({ lineColor: X.accent, topColor: alpha(X.accent, 0.28), bottomColor: alpha(X.accent, 0.02) });
        p.applyOptions({ color: X.green });
      };
      window.addEventListener('pstudio-theme', retheme);
      chart.current = c; price.current = a; prot.current = p; setReady(true);
      off = () => { window.removeEventListener('pstudio-theme', retheme); c.remove(); };
    }).catch(() => setErr(true));
    return () => { alive = false; off(); chart.current = null; price.current = null; prot.current = null; };
  }, []);

  useEffect(() => {
    let alive = true; setPts(null); setErr(false);
    solHistory(range).then((p) => { if (alive) setPts(p); }).catch(() => { if (alive) setErr(true); });
    try { localStorage.setItem('ts_vault_range', range); } catch { /* navigation privée */ }
    return () => { alive = false; };
  }, [range]);

  // données : prix, valeur protégée reconstituée, conversions
  useEffect(() => {
    const a = price.current, p = prot.current, c = chart.current;
    if (!ready || !a || !p || !c || !pts?.length) return;
    const T = theme();
    const data = pts.map((x) => ({ time: Math.floor(x.t / 1000) as UTCTimestamp, value: x.v }));
    a.setData(data);
    const mine = (moves ?? []).filter((m) => m.status !== 'err' && (!wallet || !m.wallet || m.wallet === wallet)).map((m) => ({ ...m, ms: Date.parse(m.created_at) })).sort((x, y) => y.ms - x.ms);
    if (stableNow != null) {
      // valeur à l'instant t = valeur actuelle moins l'effet des conversions et envois faits après t
      const eff = (m: Move) => (m.kind === 'protect' ? 1 : -1) * (Number(m.stable_amount) || 0);
      p.setData(pts.map((x, k) => ({ time: data[k]!.time, value: Math.max(0, mine.reduce((v, m) => (m.ms > x.t ? v - eff(m) : v), stableNow)) })));
    } else p.setData([]);
    const first = pts[0]!.t;
    const marks: SeriesMarker<UTCTimestamp>[] = mine.filter((m) => m.ms >= first && m.kind !== 'send').reverse().map((m) => {
      let k = data.length - 1; while (k > 0 && pts[k]!.t > m.ms) k--;
      const pr = m.kind === 'protect';
      return { time: data[k]!.time, position: pr ? 'aboveBar' : 'belowBar', shape: pr ? 'arrowDown' : 'arrowUp', color: pr ? T.green : T.accent, text: (pr ? 'Protégé ' : 'Repris ') + nf(Number(m.stable_amount) || 0, 0) + ' $' };
    });
    a.setMarkers(marks);
    c.timeScale().fitContent();
    const lp = pts[pts.length - 1]!;
    setLast({ t: lp.t, price: lp.v, prot: stableNow });
  }, [ready, pts, moves, wallet, stableNow]);

  const L = legend ?? last;
  const first = pts?.[0]?.v, end = pts?.[pts.length - 1]?.v;
  const ch = first && end ? ((end - first) / first) * 100 : null;
  const hi = pts?.length ? Math.max(...pts.map((x) => x.v)) : null, lo = pts?.length ? Math.min(...pts.map((x) => x.v)) : null;
  const when = L ? new Date(L.t).toLocaleString('fr-FR', range === '1d' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <section className="card vt-chart">
      <div className="vt-chart-h">
        <div className="vt-chart-l">
          <span className="vt-chart-k"><i className="vt-dot acc" />Prix du SOL</span>
          <b className="mono">{L ? usd(L.price) : '…'}</b>
          {ch != null && <span className={'mono vt-chart-ch ' + (ch >= 0 ? 'up' : 'down')}>{(ch >= 0 ? '+' : '−') + nf(Math.abs(ch)) + ' %'}<small className="dim"> sur {RANGES.find((x) => x.r === range)!.l}</small></span>}
        </div>
        <div className="vt-chart-l">
          <span className="vt-chart-k"><i className="vt-dot grn" />Valeur protégée</span>
          <b className="mono">{L?.prot != null ? usd(L.prot) : '—'}</b>
          <small className="dim">{legend ? when : 'USDT + USDC du wallet du coffre'}</small>
        </div>
        <div className="vt-chart-stats">
          <span><small>Haut</small><b className="mono">{hi != null ? usd(hi) : '—'}</b></span>
          <span><small>Bas</small><b className="mono">{lo != null ? usd(lo) : '—'}</b></span>
        </div>
        <div className="vt-range" role="tablist" aria-label="Période">
          {RANGES.map((x) => <button key={x.r} type="button" role="tab" aria-selected={range === x.r} className={range === x.r ? 'on' : ''} onClick={() => setRange(x.r)}>{x.l}</button>)}
        </div>
      </div>
      <div className="vt-chart-box" ref={box} role="img" aria-label={'Graphique : prix du SOL et valeur protégée sur ' + RANGES.find((x) => x.r === range)!.l}>
        {(err || !pts) && <div className="vt-chart-msg">{err ? 'Historique du prix indisponible pour le moment.' : 'Chargement…'}</div>}
      </div>
      <div className="vt-chart-f dim"><span><i className="vt-mk grn">▼</i> mise à l'abri</span><span><i className="vt-mk acc">▲</i> reprise en SOL</span><span>Prix : Binance (Coinbase en secours)</span></div>
    </section>
  );
}
