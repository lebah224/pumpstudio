import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import qrcode from 'qrcode-generator';
import { Sol } from '../ui/Sol';
import type { Pt } from './walletData';

/** Largeur réelle d'un conteneur, suivie au redimensionnement */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Courbe d'une seule série avec aire dégradée : grille discrète, deux repères d'axe,
 * réticule et infobulle au survol (souris et doigt).
 * sol : valeurs en SOL, l'infobulle affiche aussi l'équivalent en dollars.
 */
export function AreaChart({ pts, height = 220, fmt, fmtT, fmtTip = fmtT, label, sol }: { pts: Pt[]; height?: number; fmt: (v: number) => string; fmtT: (t: number) => string; fmtTip?: (t: number) => string; label: string; sol?: boolean }) {
  const [box, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const pad = { l: 4, r: 4, t: 12, b: 22 };
  const geo = useMemo(() => {
    if (pts.length < 2 || w < 40) return null;
    const t0 = pts[0]!.t, t1 = pts[pts.length - 1]!.t;
    let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
    if (hi - lo < Math.max(1e-9, Math.abs(hi) * 0.002)) { const m = Math.abs(hi) * 0.01 || 1; lo -= m; hi += m; }
    const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
    const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    const area = line + ' L' + x(t1).toFixed(1) + ' ' + (height - pad.b) + ' L' + x(t0).toFixed(1) + ' ' + (height - pad.b) + ' Z';
    return { x, y, line, area, lo, hi, t0, t1 };
  }, [pts, w, height]);

  function onMove(e: PointerEvent<SVGSVGElement>) {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left;
    let best = 0, d = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(geo.x(p.t) - px); if (dd < d) { d = dd; best = i; } });
    setHover(best);
  }
  const hp = hover != null && geo ? pts[hover] ?? null : null;
  const first = pts[0], last = pts[pts.length - 1];
  const sum = first && last ? label + ' : de ' + fmt(first.v) + ' à ' + fmt(last.v) : label;

  return (
    <div className="ts-chart" ref={box} style={{ height }}>
      {geo ? (
        <svg width={w} height={height} role="img" aria-label={sum}
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={'g' + gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} className="ts-grid" x1={pad.l} x2={w - pad.r} y1={pad.t + f * (height - pad.t - pad.b)} y2={pad.t + f * (height - pad.t - pad.b)} />)}
          <path d={geo.area} fill={'url(#g' + gid + ')'} />
          <path d={geo.line} className="ts-line" />
          <text className="ts-axis" x={pad.l} y={height - 6}>{fmtT(geo.t0)}</text>
          <text className="ts-axis" x={w - pad.r} y={height - 6} textAnchor="end">{fmtT(geo.t1)}</text>
          {hp && (<>
            <line className="ts-cross" x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={pad.t} y2={height - pad.b} />
            <circle className="ts-dot" cx={geo.x(hp.t)} cy={geo.y(hp.v)} r={5} />
          </>)}
        </svg>
      ) : <div className="ts-chart-empty">{pts.length < 2 ? 'Pas assez de données pour tracer la courbe.' : ''}</div>}
      {hp && geo && (
        <div className="ts-tip" style={{ left: Math.min(Math.max(geo.x(hp.t), 70), w - 70), top: Math.max(geo.y(hp.v) - 54, 0) }}>
          <b className="mono">{sol ? <Sol v={hp.v} d={4} /> : fmt(hp.v)}</b><small>{fmtTip(hp.t)}</small>
        </div>
      )}
    </div>
  );
}

export type Slice = { key: string; label: string; value: number; color: string; sub?: string };

/** Anneau de répartition : segments séparés par un fin espace, total au centre, détail au survol */
export function Donut({ items, size = 168, center, fmt }: { items: Slice[]; size?: number; center: { v: string; l: string }; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = items.reduce((a, x) => a + x.value, 0);
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  let acc = 0;
  const h = items.find((x) => x.key === hover);
  return (
    <div className="ts-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={'Répartition : ' + items.map((x) => x.label + ' ' + Math.round((x.value / (total || 1)) * 100) + ' %').join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ts-donut-bg" />
        {total > 0 && items.map((x) => {
          const len = (x.value / total) * c, gap = items.length > 1 ? Math.min(3, len / 2) : 0;
          const el = (
            <circle key={x.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x.color} strokeWidth={hover === x.key ? 16 : 13}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`}
              onPointerEnter={() => setHover(x.key)} onPointerLeave={() => setHover(null)} style={{ cursor: 'default', transition: 'stroke-width .12s' }} />
          );
          acc += len; return el;
        })}
      </svg>
      <div className="ts-donut-c">
        {h ? (<><b className="mono">{Math.round((h.value / (total || 1)) * 100)} %</b><small>{h.label} · {fmt(h.value)}</small></>)
          : (<><b className="mono">{center.v}</b><small>{center.l}</small></>)}
      </div>
    </div>
  );
}

/** QR code à scanner (modules sombres sur fond clair, marge de 4 modules pour les lecteurs) */
export function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(); let path = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { n, path };
  }, [text]);
  return (
    <svg className="ts-qr" width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label="QR code de l'adresse" shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={path} fill="#0b0a09" />
    </svg>
  );
}
