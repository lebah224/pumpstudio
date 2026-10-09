import { useEffect, useState } from 'react';

/** Logo du token, avec initiales sur fond teinté si l'image manque ou ne charge pas */
export function TokenLogo({ src, name, size = 32 }: { src: string | null | undefined; name: string; size?: number }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  const label = (name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
  let h = 0; for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) % 360;
  if (!src || bad) return <span className="tr-logo tr-logo-x" style={{ width: size, height: size, ['--h' as string]: h }} aria-hidden="true">{label}</span>;
  return <img className="tr-logo" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
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
