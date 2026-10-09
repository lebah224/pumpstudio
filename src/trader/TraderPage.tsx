import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { studio, toast } from '../legacy/bridge';
import { MINT_RE, type Row } from './api';
import { MarketList } from './MarketList';
import { TokenView } from './TokenView';
import { useLiveState } from './live';
import { useAlertWatcher } from './alerts';
import '../styles/trader.css';

function useVisible() {
  const [on, setOn] = useState(() => studio()?.hub?.page() === 'trade');
  useEffect(() => { const f = (e: Event) => setOn((e as CustomEvent).detail === 'trade'); window.addEventListener('pstudio-page', f); return () => window.removeEventListener('pstudio-page', f); }, []);
  return on;
}

/** Page Trader : marché en direct, fiche du token avec graphique et panneau de trading */
export function TraderPage() {
  const visible = useVisible();
  const [open, setOpen] = useState<{ mint: string; seed: Row | null } | null>(null);
  const [q, setQ] = useState('');
  const live = useLiveState();
  const search = useRef<HTMLInputElement>(null);
  useAlertWatcher();
  // « / » place le curseur dans la recherche, comme sur les grandes plateformes
  useEffect(() => {
    if (!visible) return;
    const f = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); search.current?.focus(); } };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [visible]);

  const openMint = useCallback((mint: string, seed: Row | null = null) => {
    setOpen({ mint, seed }); setQ('');
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); }
  }, []);
  // ouverture depuis le reste du studio (portefeuille, palette de commandes)
  useEffect(() => {
    const f = (e: Event) => { const m = (e as CustomEvent).detail; if (typeof m === 'string' && MINT_RE.test(m)) openMint(m); };
    window.addEventListener('ts-trade', f); return () => window.removeEventListener('ts-trade', f);
  }, [openMint]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (MINT_RE.test(v)) openMint(v);
    else if (v.length > 30) toast('Adresse invalide', 'Collez l\'adresse complète du token (mint).', 'r');
  };

  return (
    <div className="tr-page">
      <div className="page-head tr-page-head">
        <div><h1>Trader</h1><p>Le marché pump.fun et Solana en direct : choisissez un token, suivez son graphique et tradez sans quitter la page.</p></div>
        <div className="spacer" />
        <span className={'tr-live ' + live} title="Flux PumpPortal : chaque transaction arrive en moins d'une seconde"><i />{live === 'on' ? 'En direct' : live === 'wait' ? 'Connexion…' : 'Flux coupé'}</span>
      </div>
      <form className="tr-search" onSubmit={submit} role="search">
        <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={open ? 'Coller l\'adresse d\'un autre token' : 'Rechercher un nom, un ticker, ou coller une adresse de token  ( / )'} aria-label="Rechercher un token" spellCheck={false} autoComplete="off" />
        {MINT_RE.test(q.trim()) && <button className="btn sm primary" type="submit">Ouvrir</button>}
      </form>
      {/* hors de la page, rien n'est suivi ni relu : la fiche se recharge au retour */}
      {!visible ? null : open ? <TokenView key={open.mint} mint={open.mint} seed={open.seed} onBack={() => setOpen(null)} onOpen={(m) => openMint(m)} />
        : <MarketList visible query={MINT_RE.test(q.trim()) ? '' : q} onOpen={(r) => openMint(r.mint, r)} />}
    </div>
  );
}
