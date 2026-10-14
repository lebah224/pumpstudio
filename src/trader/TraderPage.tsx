import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { studio, toast } from '../legacy/bridge';
import { MINT_RE, type Row } from './api';
import { MarketList } from './MarketList';
import { TokenView } from './TokenView';
import { useLiveState } from './live';
import { useAlertWatcher } from './alerts';
import { StrategyDialog } from './StrategyDialog';
import { SnipeDialog } from './SnipeDialog';
import { CopyDialog } from './CopyDialog';
import { LogoViewer } from './bits';
import { BuyOrderDialog, BuyOrderList } from './BuyOrderDialog';
import { StrategyList } from './StrategyCard';
import { CreatorSheet, CreatorsView } from './CreatorsView';
import { useFollowed } from './creators';
import { TraderSheet, TradersView } from './TradersView';
import { useTracked } from './traders';
import '../styles/trader.css';

function useVisible() {
  const [on, setOn] = useState(() => studio()?.hub?.page() === 'trade');
  useEffect(() => { const f = (e: Event) => setOn((e as CustomEvent).detail === 'trade'); window.addEventListener('pstudio-page', f); return () => window.removeEventListener('pstudio-page', f); }, []);
  return on;
}

type Mode = 'market' | 'creators' | 'traders';

/** Page Trader : marché en direct, fiche du token avec graphique et panneau de trading */
export function TraderPage() {
  const visible = useVisible();
  const [open, setOpen] = useState<{ mint: string; seed: Row | null } | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>(() => { try { const v = localStorage.getItem('ts-trader-mode'); return v === 'creators' || v === 'traders' ? v : 'market'; } catch { return 'market'; } });
  const setM = (m: Mode) => { setMode(m); setOpen(null); try { localStorage.setItem('ts-trader-mode', m); } catch { /* navigation privée */ } };
  const followed = useFollowed();
  const tracked = useTracked();
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
      {/* une seule barre : vue, recherche et état du flux en direct */}
      <div className="tr-tools">
        {!open && <div className="tr-mode" role="tablist" aria-label="Vue">
          <button type="button" role="tab" aria-selected={mode === 'market'} className={mode === 'market' ? 'on' : ''} onClick={() => setM('market')}>Marché</button>
          <button type="button" role="tab" aria-selected={mode === 'creators'} className={mode === 'creators' ? 'on' : ''} onClick={() => setM('creators')}>Créateurs suivis{followed?.length ? <em>{followed.length}</em> : null}</button>
          <button type="button" role="tab" aria-selected={mode === 'traders'} className={mode === 'traders' ? 'on' : ''} onClick={() => setM('traders')}>Acheteurs suivis{tracked?.length ? <em>{tracked.length}</em> : null}</button>
        </div>}
        <form className="tr-search" onSubmit={submit} role="search">
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={open ? 'Coller l\'adresse d\'un autre token' : 'Nom, ticker ou adresse de token'} aria-label="Rechercher un token" spellCheck={false} autoComplete="off" />
          {MINT_RE.test(q.trim()) ? <button className="btn sm primary" type="submit">Ouvrir</button> : <kbd aria-hidden="true">/</kbd>}
        </form>
        <span className={'tr-live ' + live} title="Flux PumpPortal : chaque transaction arrive en moins d'une seconde"><i />{live === 'on' ? 'En direct' : live === 'wait' ? 'Connexion…' : 'Flux coupé'}</span>
      </div>
      {/* hors de la page, rien n'est suivi ni relu : la fiche se recharge au retour */}
      {!visible ? null : open ? <TokenView key={open.mint} mint={open.mint} seed={open.seed} onBack={() => setOpen(null)} onOpen={(m) => openMint(m)} />
        : <>
          <BuyOrderList onOpen={(m) => openMint(m)} />
          <StrategyList onOpen={(m) => openMint(m)} />
          {mode === 'creators' ? <CreatorsView onOpen={(m) => openMint(m)} /> : mode === 'traders' ? <TradersView onOpen={(m) => openMint(m)} /> : <MarketList visible query={MINT_RE.test(q.trim()) ? '' : q} onOpen={(r) => openMint(r.mint, r)} />}
        </>}
      <StrategyDialog />
      <SnipeDialog />
      <CopyDialog />
      <LogoViewer />
      <BuyOrderDialog />
      <CreatorSheet onOpen={(m) => openMint(m)} />
      <TraderSheet onOpen={(m) => openMint(m)} />
    </div>
  );
}
