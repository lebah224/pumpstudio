import { useEffect, useState } from 'react';

/**
 * Flux en direct PumpPortal, partagé avec le studio : une seule connexion WebSocket pour tout le site
 * (PumpPortal bannit les clients qui en ouvrent plusieurs). Chaque transaction arrive ici moins d'une seconde
 * après son passage sur la blockchain : le graphique, la liste et le ruban des transactions en sont tirés.
 */
type Raw = Record<string, unknown>;
type LiveApi = {
  watch: (mints: string[]) => void;
  news: (on: boolean) => void;
  on: (fn: (m: Raw) => void) => () => void;
  state: () => { on: boolean; state: string; last: number };
};
const api = () => (window.PumpStudio as unknown as { live?: LiveApi } | undefined)?.live;
export const solUsd = (): number | null => (window.PumpStudio as unknown as { solUsd?: () => number | null } | undefined)?.solUsd?.() ?? null;

export type LiveMsg = {
  mint: string; kind: 'buy' | 'sell' | 'create' | 'migrate'; sig: string; wallet: string; at: number;
  sol: number; tok: number; mcSol: number | null; name?: string; symbol?: string; uri?: string;
};
const num = (x: unknown) => { const v = typeof x === 'number' ? x : typeof x === 'string' ? parseFloat(x) : NaN; return isFinite(v) ? v : 0; };
const str = (x: unknown, max = 100) => (typeof x === 'string' ? x.slice(0, max) : '');
export function norm(m: Raw): LiveMsg | null {
  const kind = m.txType;
  if (kind !== 'buy' && kind !== 'sell' && kind !== 'create' && kind !== 'migrate') return null;
  const mint = str(m.mint, 50); if (!mint) return null;
  const mc = num(m.marketCapSol);
  return {
    mint, kind, sig: str(m.signature), wallet: str(m.traderPublicKey, 50), at: Date.now(),
    sol: num(m.solAmount), tok: num(m.tokenAmount), mcSol: mc > 0 ? mc : null,
    name: str(m.name, 60) || undefined, symbol: str(m.symbol, 20) || undefined, uri: str(m.uri, 300) || undefined,
  };
}

// plusieurs écrans suivent des tokens en même temps (liste, fiche) : l'abonnement est l'union de leurs demandes
const wants = new Map<string, string[]>();
let newsUsers = 0;
const push = () => { const all = new Set<string>(); wants.forEach((l) => l.forEach((m) => all.add(m))); api()?.watch([...all]); };

/** Suit les transactions de ces tokens tant que le composant est affiché */
export function useLiveTrades(key: string, mints: string[], onMsg: (m: LiveMsg) => void, enabled = true) {
  const sig = enabled ? mints.join(',') : '';
  useEffect(() => {
    if (!sig) return;
    wants.set(key, sig.split(',')); push();
    return () => { wants.delete(key); push(); };
  }, [key, sig]);
  useEffect(() => {
    const L = api(); if (!L || !enabled) return;
    const set = new Set(sig.split(','));
    return L.on((raw) => { const m = norm(raw); if (m && m.kind !== 'create' && set.has(m.mint)) onMsg(m); });
  }, [sig, enabled, onMsg]);
}
/** Nouveaux tokens créés sur pump.fun, en direct */
export function useLiveNew(onMsg: (m: LiveMsg) => void, enabled: boolean) {
  useEffect(() => {
    const L = api(); if (!L || !enabled) return;
    if (newsUsers++ === 0) L.news(true);
    const off = L.on((raw) => { const m = norm(raw); if (m && m.kind === 'create') onMsg(m); });
    return () => { off(); if (--newsUsers === 0) L.news(false); };
  }, [enabled, onMsg]);
}
/** État de la connexion : en direct, connexion…, coupé (réglage du studio) */
export function useLiveState(): 'on' | 'wait' | 'off' {
  const read = () => { const s = api()?.state(); return !s || !s.on ? 'off' : s.state === 'on' ? 'on' : 'wait'; };
  const [st, setSt] = useState<'on' | 'wait' | 'off'>(read);
  useEffect(() => { const t = setInterval(() => setSt(read()), 1500); return () => clearInterval(t); }, []);
  return st;
}
