import { useEffect, useState } from 'react';

// Sources du logo, dans l'ordre : service d'images de pump.fun (redimensionné, pour les tokens pump.fun), puis l'image
// d'origine. La passerelle IPFS publique refuse les demandes en rafale : un logo IPFS passe d'abord par la passerelle
// dédiée de pump.fun, puis par deux passerelles publiques en secours.
const CID = /\/ipfs\/([A-Za-z0-9]{40,80})/;
export function logoSources(src: string | null | undefined, mint?: string | null, big = false): string[] {
  const out: string[] = [];
  if (mint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) && !big) out.push('https://images.pump.fun/coin-image/' + mint + '?variant=86x86');
  const cid = src?.match(CID)?.[1];
  if (cid) out.push('https://pump.mypinata.cloud/ipfs/' + cid, 'https://dweb.link/ipfs/' + cid, 'https://ipfs.io/ipfs/' + cid);
  else if (src && /^https:\/\//.test(src)) out.push(src);
  if (big && mint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) out.push('https://images.pump.fun/coin-image/' + mint + '?variant=86x86');
  return [...new Set(out)];
}
/** agrandissement d'un logo (fenêtre ouverte par LogoViewer) */
export type LogoOpen = { src: string | null | undefined; mint?: string | null; name: string };
export const openLogo = (d: LogoOpen) => window.dispatchEvent(new CustomEvent('ts-logo', { detail: d }));

/** Logo du token, avec initiales sur fond teinté si aucune image ne charge ; zoom : un clic l'affiche en grand */
export function TokenLogo({ src, name, size = 32, mint, zoom }: { src: string | null | undefined; name: string; size?: number; mint?: string | null; zoom?: boolean }) {
  const list = logoSources(src, mint);
  const key = list.join('|');
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [key]);
  const label = (name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
  let h = 0; for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) % 360;
  const cur = list[i];
  const el = !cur
    ? <span className="tr-logo tr-logo-x" style={{ width: size, height: size, ['--h' as string]: h }} aria-hidden="true">{label}</span>
    : <img className="tr-logo" src={cur} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setI((x) => x + 1)} />;
  if (!zoom || !list.length) return el;
  return (
    <button type="button" className="tr-logo-btn" aria-label={'Agrandir le logo de ' + (name || 'ce token')}
      onClick={(e) => { e.stopPropagation(); openLogo({ src, mint, name }); }} onKeyDown={(e) => e.stopPropagation()}>{el}</button>
  );
}

/** Fenêtre d'agrandissement du logo (une seule, montée dans la page Trader) */
export function LogoViewer() {
  const [o, setO] = useState<LogoOpen | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    const f = (e: Event) => { setO((e as CustomEvent<LogoOpen>).detail); setI(0); };
    window.addEventListener('ts-logo', f); return () => window.removeEventListener('ts-logo', f);
  }, []);
  useEffect(() => { if (!o) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setO(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [o]);
  if (!o) return null;
  const list = logoSources(o.src, o.mint, true), cur = list[i];
  return (
    <div className="ts-modal tr-zoom" role="dialog" aria-modal="true" aria-label={'Logo de ' + (o.name || 'ce token')} onMouseDown={(e) => { if (e.target === e.currentTarget) setO(null); }}>
      <div className="ts-modal-box tr-zoom-box">
        <button type="button" className="ts-x" aria-label="Fermer" onClick={() => setO(null)} autoFocus>×</button>
        {cur ? <img src={cur} alt={'Logo de ' + (o.name || 'ce token')} referrerPolicy="no-referrer" onError={() => setI((x) => x + 1)} />
          : <div className="empty"><b>Logo indisponible</b><span>Aucune source n'a pu afficher cette image.</span></div>}
        <div className="tr-zoom-f"><b>{o.name || 'Token'}</b>{cur && <a href={cur} target="_blank" rel="noopener noreferrer">Ouvrir l'image ↗</a>}</div>
      </div>
    </div>
  );
}

export const Star = ({ on }: { on: boolean }) => (
  <svg className={'i tr-star' + (on ? ' on' : '')} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
);

// favoris : liste locale au navigateur, partagée entre la liste et la fiche
const KEY = 'ts-trader-favs';
const subs = new Set<() => void>();
const read = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 50) : []; } catch { return []; } };
let favs = read();
export function useFavs() {
  const [list, setList] = useState(favs);
  useEffect(() => { const f = () => setList(favs); subs.add(f); return () => { subs.delete(f); }; }, []);
  return {
    list,
    has: (m: string) => list.includes(m),
    toggle: (m: string) => {
      favs = favs.includes(m) ? favs.filter((x) => x !== m) : [m, ...favs].slice(0, 50);
      try { localStorage.setItem(KEY, JSON.stringify(favs)); } catch { /* stockage indisponible */ }
      subs.forEach((f) => f());
    },
  };
}

/** Copie l'adresse, avec retour visuel */
export function CopyBtn({ text, label = 'Copier l\'adresse' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="tr-copy" aria-label={label} title={label} onClick={async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1400); } catch { /* copie refusée */ }
    }}>
      {ok ? <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        : <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" /></svg>}
    </button>
  );
}
