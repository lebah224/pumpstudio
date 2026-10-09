import { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, ColorType, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp, type CandlestickData, type HistogramData, type IPriceLine } from 'lightweight-charts';
import { candles as fetchCandles, TF_SEC, type Candle, type Tf } from './api';
import { fCompact, fPrice } from './format';
import { solUsd, useLiveTrades, useLiveState, type LiveMsg } from './live';

export const TFS: { tf: Tf; l: string }[] = [
  { tf: '1s', l: '1s' }, { tf: '15s', l: '15s' }, { tf: '1m', l: '1m' }, { tf: '5m', l: '5m' }, { tf: '15m', l: '15m' },
  { tf: '1h', l: '1h' }, { tf: '4h', l: '4h' }, { tf: '24h', l: '1j' },
];
type Props = { mint: string; created: number | null; supply: number; pump: boolean; avgSol?: number | null };
type Legend = { o: number; h: number; l: number; c: number; v: number; t: number } | null;

const css = (name: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
const theme = () => ({
  bg: css('--panel', '#141311'), text: css('--muted', '#b9b1a2'), line: css('--line', '#2a2722'),
  up: css('--green', '#3ccf8e'), down: css('--red', '#ff6b6b'), accent: css('--accent', '#d6b26e'),
});
const PREF = 'ts-chart';
function loadPref(): { tf: Tf; cur: 'USD' | 'SOL'; mode: 'price' | 'mc' } {
  try { const p = JSON.parse(localStorage.getItem(PREF) || '{}'); return { tf: TF_SEC[p.tf as Tf] ? p.tf : '1m', cur: p.cur === 'SOL' ? 'SOL' : 'USD', mode: p.mode === 'mc' ? 'mc' : 'price' }; }
  catch { return { tf: '1m', cur: 'USD', mode: 'price' }; }
}

/**
 * Graphique en chandeliers TokenStudio : historique pump.fun (ou GeckoTerminal hors pump.fun), puis bougie en cours
 * construite transaction par transaction depuis le flux en direct. Aucun rechargement : chaque achat ou vente déplace
 * la bougie à l'instant où il passe sur la blockchain.
 */
export function PriceChart({ mint, created, supply, pump, avgSol }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const cs = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vs = useRef<ISeriesApi<'Histogram'> | null>(null);
  const avgLine = useRef<IPriceLine | null>(null);
  const last = useRef<{ t: number; o: number; h: number; l: number; c: number; v: number } | null>(null);
  const [pref, setPref] = useState(loadPref);
  const [state, setState] = useState<'load' | 'ok' | 'empty' | 'err'>('load');
  const [src, setSrc] = useState('');
  const [legend, setLegend] = useState<Legend>(null);
  const [lastC, setLastC] = useState<Legend>(null);
  const liveSt = useLiveState();
  const { tf, cur, mode } = pref;
  const mult = mode === 'mc' ? supply : 1;
  const unit = cur === 'USD' ? '$' : 'SOL';
  const savePref = (p: Partial<typeof pref>) => setPref((o) => { const n = { ...o, ...p }; try { localStorage.setItem(PREF, JSON.stringify(n)); } catch { /* stockage indisponible */ } return n; });

  // création du graphique (une fois), thème et taille suivis
  useEffect(() => {
    const el = box.current; if (!el) return;
    const T = theme();
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: T.bg }, textColor: T.text, fontFamily: css('--mono', 'ui-monospace, monospace'), fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: T.line, style: LineStyle.Dotted }, horzLines: { color: T.line, style: LineStyle.Dotted } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: T.line, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: T.line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: 2 },
      localization: { locale: 'fr-FR' },
    });
    const s = c.addCandlestickSeries({ upColor: T.up, downColor: T.down, borderUpColor: T.up, borderDownColor: T.down, wickUpColor: T.up, wickDownColor: T.down, priceLineVisible: true, lastValueVisible: true });
    const v = c.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    c.subscribeCrosshairMove((p) => {
      const d = p.time ? (p.seriesData.get(s) as CandlestickData | undefined) : undefined;
      const hv = p.time ? (p.seriesData.get(v) as HistogramData | undefined) : undefined;
      setLegend(d ? { o: d.open, h: d.high, l: d.low, c: d.close, v: hv?.value ?? 0, t: d.time as number } : null);
    });
    chart.current = c; cs.current = s; vs.current = v;
    const retheme = () => {
      const X = theme();
      c.applyOptions({ layout: { background: { type: ColorType.Solid, color: X.bg }, textColor: X.text }, grid: { vertLines: { color: X.line }, horzLines: { color: X.line } }, rightPriceScale: { borderColor: X.line }, timeScale: { borderColor: X.line } });
      s.applyOptions({ upColor: X.up, downColor: X.down, borderUpColor: X.up, borderDownColor: X.down, wickUpColor: X.up, wickDownColor: X.down });
    };
    window.addEventListener('pstudio-theme', retheme);
    return () => { window.removeEventListener('pstudio-theme', retheme); c.remove(); chart.current = null; cs.current = null; vs.current = null; };
  }, []);

  // format des prix selon l'échelle (très petits prix de pump.fun)
  useEffect(() => {
    cs.current?.applyOptions({ priceFormat: { type: 'custom', minMove: 1e-12, formatter: (p: number) => mode === 'mc' ? fCompact(p, '') : fPrice(p) } });
    chart.current?.applyOptions({ timeScale: { secondsVisible: TF_SEC[tf] < 60 } });
  }, [mode, tf]);

  const volColor = (up: boolean) => { const T = theme(); return (up ? T.up : T.down) + '66'; };
  const paint = useCallback((k: { t: number; o: number; h: number; l: number; c: number; v: number }) => {
    cs.current?.update({ time: k.t as UTCTimestamp, open: k.o * mult, high: k.h * mult, low: k.l * mult, close: k.c * mult });
    vs.current?.update({ time: k.t as UTCTimestamp, value: k.v, color: volColor(k.c >= k.o) });
    setLastC({ ...k, o: k.o * mult, h: k.h * mult, l: k.l * mult, c: k.c * mult });
  }, [mult]);

  // historique : à chaque token, période, devise ou échelle
  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) { setState('load'); last.current = null; }
    try {
      const r = await fetchCandles(mint, tf, cur, created, TF_SEC[tf] < 60 ? 600 : 500);
      if (!cs.current) return;
      setSrc(r.src);
      if (!r.c.length) { if (!quiet) { cs.current.setData([]); vs.current?.setData([]); setState('empty'); } return; }
      if (quiet && last.current) {
        // resynchronisation : seules les bougies récentes sont corrigées, sans toucher au zoom
        const Lt = last.current.t;
        r.c.forEach((x: Candle) => {
          if (x[0] < Lt) return;
          const L0 = last.current!, k = { t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] };
          if (x[0] === L0.t) { k.o = L0.o; k.h = Math.max(k.h, L0.h); k.l = Math.min(k.l, L0.l); k.c = L0.c; k.v = Math.max(k.v, L0.v); }
          last.current = k; paint(k);
        });
        return;
      }
      cs.current.setData(r.c.map((x) => ({ time: x[0] as UTCTimestamp, open: x[1] * mult, high: x[2] * mult, low: x[3] * mult, close: x[4] * mult })));
      vs.current?.setData(r.c.map((x) => ({ time: x[0] as UTCTimestamp, value: x[5], color: volColor(x[4] >= x[1]) })));
      const z = r.c[r.c.length - 1]!;
      last.current = { t: z[0], o: z[1], h: z[2], l: z[3], c: z[4], v: z[5] };
      setLastC({ t: z[0], o: z[1] * mult, h: z[2] * mult, l: z[3] * mult, c: z[4] * mult, v: z[5] });
      const ts = chart.current?.timeScale(); const n = r.c.length;
      ts?.setVisibleLogicalRange({ from: Math.max(0, n - 120), to: n + 6 });
      setState('ok');
    } catch { if (!quiet) setState('err'); }
  }, [mint, tf, cur, created, mult, paint]);
  useEffect(() => { load(false); }, [load]);

  // bougie en cours : chaque transaction du flux en direct
  const onTrade = useCallback((m: LiveMsg) => {
    const pSol = m.mcSol && supply > 0 ? m.mcSol / supply : m.tok > 0 ? m.sol / m.tok : 0;
    const rate = cur === 'USD' ? solUsd() : 1; if (!rate || !(pSol > 0)) return;
    const price = pSol * rate;
    const vol = m.sol * (cur === 'USD' ? rate : 1);
    const step = TF_SEC[tf], t = Math.floor(Date.now() / 1000 / step) * step;
    const L = last.current;
    let k;
    if (!L) k = { t, o: price, h: price, l: price, c: price, v: vol };
    else if (t < L.t) return;
    else if (t === L.t) k = { ...L, h: Math.max(L.h, price), l: Math.min(L.l, price), c: price, v: L.v + vol };
    else k = { t, o: L.c, h: Math.max(L.c, price), l: Math.min(L.c, price), c: price, v: vol };
    last.current = k; paint(k);
    if (state !== 'ok') setState('ok');
  }, [cur, tf, supply, paint, state]);
  useLiveTrades('chart', [mint], onTrade, pump);

  // sans flux en direct (token hors pump.fun ou flux coupé) : relecture fréquente ; avec : correction toutes les 30 s
  useEffect(() => {
    const every = !pump || liveSt !== 'on' ? (TF_SEC[tf] < 60 ? 3000 : 6000) : 30_000;
    const id = setInterval(() => { if (!document.hidden) load(true); }, every);
    return () => clearInterval(id);
  }, [load, pump, liveSt, tf]);

  // prix moyen d'achat de l'utilisateur, en ligne pointillée
  useEffect(() => {
    const s = cs.current; if (!s) return;
    if (avgLine.current) { s.removePriceLine(avgLine.current); avgLine.current = null; }
    if (!avgSol || !(avgSol > 0)) return;
    const rate = cur === 'USD' ? solUsd() : 1; if (!rate) return;
    avgLine.current = s.createPriceLine({ price: avgSol * rate * mult, color: theme().accent, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Mon prix moyen' });
  }, [avgSol, cur, mult, state]);

  const L = legend ?? lastC;
  const fmt = (x: number) => (mode === 'mc' ? fCompact(x, '') : fPrice(x));
  return (
    <div className="tr-chart">
      <div className="tr-chart-bar">
        <div className="seg sm" role="group" aria-label="Période des bougies">
          {TFS.map((x) => <button key={x.tf} type="button" className={tf === x.tf ? 'on' : ''} aria-pressed={tf === x.tf} onClick={() => savePref({ tf: x.tf })}>{x.l}</button>)}
        </div>
        <div className="tr-chart-r">
          <div className="seg sm" role="group" aria-label="Échelle">
            <button type="button" className={mode === 'price' ? 'on' : ''} aria-pressed={mode === 'price'} onClick={() => savePref({ mode: 'price' })}>Prix</button>
            <button type="button" className={mode === 'mc' ? 'on' : ''} aria-pressed={mode === 'mc'} onClick={() => savePref({ mode: 'mc' })}>Capitalisation</button>
          </div>
          <div className="seg sm" role="group" aria-label="Devise">
            <button type="button" className={cur === 'USD' ? 'on' : ''} aria-pressed={cur === 'USD'} onClick={() => savePref({ cur: 'USD' })}>USD</button>
            <button type="button" className={cur === 'SOL' ? 'on' : ''} aria-pressed={cur === 'SOL'} onClick={() => savePref({ cur: 'SOL' })}>SOL</button>
          </div>
        </div>
      </div>
      <div className="tr-legend mono" aria-live="off">
        {L ? (<>
          <span>O <b className={L.c >= L.o ? 'up' : 'down'}>{fmt(L.o)}</b></span><span>H <b className={L.c >= L.o ? 'up' : 'down'}>{fmt(L.h)}</b></span>
          <span>B <b className={L.c >= L.o ? 'up' : 'down'}>{fmt(L.l)}</b></span><span>C <b className={L.c >= L.o ? 'up' : 'down'}>{fmt(L.c)}</b></span>
          <span>Vol <b>{fCompact(L.v, cur === 'USD' ? '$' : 'SOL')}</b></span>
          <span className={L.c >= L.o ? 'up' : 'down'}>{(L.o ? ((L.c / L.o - 1) * 100) : 0).toLocaleString('fr-FR', { maximumFractionDigits: 2, signDisplay: 'always' })} %</span>
        </>) : <span className="dim">{unit} · {mode === 'mc' ? 'capitalisation' : 'prix'}</span>}
      </div>
      <div className="tr-chart-box" ref={box}>
        {state === 'load' && <div className="tr-chart-msg"><span className="tr-spin" aria-hidden="true" />Chargement de l'historique…</div>}
        {state === 'empty' && <div className="tr-chart-msg">Pas encore de transaction sur cette période.<small>Les bougies apparaissent ici à la première transaction.</small></div>}
        {state === 'err' && <div className="tr-chart-msg">Historique indisponible.<button type="button" className="btn sm" onClick={() => load(false)}>Réessayer</button></div>}
      </div>
      <div className="tr-chart-foot">
        <span className={'tr-live ' + (pump ? liveSt : 'poll')}><i />{pump ? (liveSt === 'on' ? 'En direct · chaque transaction' : liveSt === 'wait' ? 'Connexion au flux en direct…' : 'Flux en direct coupé (Réglages) · actualisation toutes les quelques secondes') : 'Actualisation automatique'}</span>
        <span className="dim">Historique : {src || '…'} · graphique <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts</a></span>
      </div>
    </div>
  );
}
