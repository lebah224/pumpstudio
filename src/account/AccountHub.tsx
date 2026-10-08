import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, userLabel } from '../auth/AuthContext';
import { goTo, studio } from '../legacy/bridge';

type HubState = {
  wallet: { name: string; pk: string; session: boolean; locked: boolean } | null;
  hasSession: boolean; bal: number | null; solUsd: number | null; sim: boolean; rpcOk: boolean | null; theme: string; depth: string;
};
const THEME_NAMES: Record<string, string> = { or: 'Or', platine: 'Platine', saphir: 'Saphir', jade: 'Jade', cuivre: 'Cuivre', iris: 'Iris' };
const DEPTH_NAMES: Record<string, string> = { nuit: 'Nuit', profond: 'Profond', doux: 'Doux' };
const fmt = (n: number, d: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);

/** Lit l'état du studio historique et se met à jour à chaque changement (wallet, solde, mode, palette) */
function useHubState(): HubState | null {
  const read = () => studio()?.hub?.state() ?? null;
  const [st, setSt] = useState<HubState | null>(read);
  useEffect(() => {
    const up = () => setSt(read());
    up();
    window.addEventListener('pstudio-state', up); window.addEventListener('pstudio-theme', up);
    return () => { window.removeEventListener('pstudio-state', up); window.removeEventListener('pstudio-theme', up); };
  }, []);
  return st;
}
const Avatar = ({ pk, cls }: { pk: string; cls?: string }) => <span className="ts-hub-wav" dangerouslySetInnerHTML={{ __html: studio()?.hub?.avatar(pk, cls) ?? '' }} />;
const I = {
  user: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
  sliders: <svg className="i" viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>,
  palette: <svg className="i" viewBox="0 0 24 24"><path d="M12 3a9 9 0 100 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.1-2.2H17a4 4 0 004-4c0-5.5-4-10-9-10z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="14.5" cy="7" r="1" /></svg>,
  gear: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>,
  search: <svg className="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  out: <svg className="i" viewBox="0 0 24 24"><path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3" /></svg>,
  wallet: <svg className="i" viewBox="0 0 24 24"><path d="M20 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h13a2 2 0 002-2v-2" /><path d="M22 11h-6a2 2 0 000 4h6v-4z" /></svg>,
  bolt: <svg className="i" viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg>,
  copy: <svg className="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>,
  chev: <svg className="i ts-hub-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>,
  shield: <svg className="i" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /></svg>,
};

/** Menu unique en haut à droite : compte, wallet de trading, mode, préférences, apparence et réglages */
export function AccountHub({ mobile }: { mobile?: boolean }) {
  const { ready, user, needsMfa, aal, openSignIn, signOut } = useAuth();
  const st = useHubState();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((focus = true) => { setOpen(false); if (focus) btn.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !btn.current?.contains(t)) close(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('[data-hub-item]') ?? [])]; if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-hub-item]')?.focus(), 30);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open, close]);

  const act = (fn: () => void) => () => { close(false); setTimeout(fn, 0); };
  const hub = studio()?.hub;
  const w = st?.wallet ?? null;
  const label = user ? userLabel(user) : '';
  const usd = w && st?.bal != null && st.solUsd ? '≈ ' + fmt(st.bal * st.solUsd, 2) + ' $' : '';
  const openTab = (tab: string) => { try { sessionStorage.setItem('ts-account-tab', tab); } catch { /* navigation privée */ } window.dispatchEvent(new CustomEvent('ts-account-tab', { detail: tab })); goTo('account'); };
  if (!ready || !st) return null;

  // bouton déclencheur
  const trigger = w ? (
    <><Avatar pk={w.pk} cls="sm" /><span className="ts-hub-bal mono">{st.bal == null ? '—' : fmt(st.bal, st.bal >= 100 ? 2 : mobile ? 3 : 4)}<small> SOL</small></span>{w.locked && <span className="ts-hub-lock" title="Wallet rapide verrouillé">●</span>}</>
  ) : user ? (
    <><span className="ts-hub-av">{label.slice(0, 1).toUpperCase()}</span>{!mobile && <span className="ts-hub-name">{label}</span>}</>
  ) : (
    <>{I.wallet}<span>{mobile ? 'Connexion' : 'Se connecter'}</span></>
  );

  return (
    <div className={'ts-hub' + (mobile ? ' m' : '')}>
      <button ref={btn} type="button" className={'ts-hub-btn' + (!w && !user ? ' primary' : '') + (!st.sim ? ' real' : '') + (open ? ' on' : '')}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {!st.sim && <span className="ts-hub-real">Réel</span>}
        {trigger}
        {user && w && <span className="ts-hub-av xs" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>}
        {I.chev}
      </button>
      {open && sheet(mobile, (
        <>
          {mobile && <div className="ts-hub-scrim" onClick={() => close(false)} />}
          <div ref={panel} id={id} className={'ts-hub-panel' + (mobile ? ' sheet' : '')} role="dialog" aria-label="Compte et wallet">
            {/* compte */}
            <section className="ts-hub-sec ts-hub-acc">
              {user ? (
                <div className="ts-hub-id">
                  <span className="ts-hub-av lg">{label.slice(0, 1).toUpperCase()}</span>
                  <span className="ts-hub-t"><b>{label}</b><small>{needsMfa ? 'Code de sécurité requis' : aal.current === 'aal2' ? 'Compte protégé · double authentification' : 'Compte TokenStudio'}</small></span>
                  {aal.current === 'aal2' && <span className="ts-hub-shield" title="Double authentification active">{I.shield}</span>}
                </div>
              ) : (
                <div className="ts-hub-guest">
                  <b>Compte TokenStudio</b>
                  <small>Retrouve tes préférences, tes wallets et ton historique sur tous tes appareils.</small>
                  <button type="button" className="btn primary sm" data-hub-item onClick={act(() => openSignIn())}>Se connecter ou créer un compte</button>
                </div>
              )}
            </section>

            {/* wallet de trading */}
            <section className="ts-hub-sec">
              <div className="ts-hub-h">Wallet de trading</div>
              {w ? (
                <>
                  <div className="ts-hub-w">
                    <Avatar pk={w.pk} />
                    <span className="ts-hub-t"><b>{w.name}{w.locked && <em className="badge a">verrouillé</em>}</b>
                      <button type="button" className="ts-hub-addr mono" data-hub-item onClick={() => hub?.copyAddress()} title="Copier l'adresse">{short(w.pk)} {I.copy}</button></span>
                    <span className="ts-hub-wb"><b className="mono">{st.bal == null ? '—' : fmt(st.bal, 4)}</b><small>{usd || 'SOL'}</small></span>
                  </div>
                  <div className="ts-hub-row">
                    <button type="button" className="btn sm" data-hub-item onClick={act(() => hub?.walletMenu())}>Gérer</button>
                    <button type="button" className="btn sm" data-hub-item onClick={act(() => hub?.walletPanel())}>{I.bolt}Wallet rapide</button>
                    {!w.session && <button type="button" className="btn sm ghost" data-hub-item onClick={act(() => hub?.disconnect())}>Déconnecter</button>}
                  </div>
                </>
              ) : (
                <div className="ts-hub-row">
                  <button type="button" className="btn primary sm" data-hub-item onClick={act(() => hub?.walletMenu())}>{I.wallet}Connecter un wallet</button>
                  <button type="button" className="btn sm" data-hub-item onClick={act(() => hub?.walletPanel())}>{I.bolt}{st.hasSession ? 'Wallet rapide' : 'Créer un wallet rapide'}</button>
                </div>
              )}
              <p className="ts-hub-note">Tes clés privées restent dans ton wallet : le studio ne fait que préparer les transactions.</p>
            </section>

            {/* mode */}
            <section className="ts-hub-sec">
              <div className="ts-hub-h">Mode</div>
              <div className="seg ts-hub-mode" role="group" aria-label="Mode de trading">
                <button type="button" className={st.sim ? 'on' : ''} aria-pressed={st.sim} data-hub-item onClick={act(() => hub?.goSim())}>Simulation</button>
                <button type="button" className={!st.sim ? 'on real' : ''} aria-pressed={!st.sim} data-hub-item onClick={act(() => hub?.goReal())}>Réel</button>
              </div>
            </section>

            {/* navigation */}
            <nav className="ts-hub-sec ts-hub-menu" aria-label="Compte">
              {user && <button type="button" data-hub-item onClick={act(() => openTab('profile'))}>{I.user}<span>Mon compte</span></button>}
              <button type="button" data-hub-item onClick={act(() => (user ? openTab('prefs') : hub?.appearance()))}>{I.sliders}<span>Préférences</span><em>{user ? 'trading, studio, notifications' : 'apparence'}</em></button>
              <button type="button" data-hub-item onClick={act(() => hub?.appearance())}>{I.palette}<span>Apparence</span><em>{(THEME_NAMES[st.theme] ?? st.theme) + ' · ' + (DEPTH_NAMES[st.depth] ?? st.depth)}</em></button>
              <button type="button" data-hub-item onClick={act(() => goTo('settings'))}>{I.gear}<span>Réglages avancés</span><em>RPC, vitesse, frais</em></button>
              {user && <button type="button" data-hub-item onClick={act(() => openTab('security'))}>{I.shield}<span>Sécurité</span><em>{aal.current === 'aal2' ? '2FA active' : 'activer la 2FA'}</em></button>}
              <button type="button" data-hub-item onClick={act(() => document.getElementById('cmdkBtn')?.click())}>{I.search}<span>Rechercher</span><kbd>Ctrl K</kbd></button>
            </nav>

            {user && (
              <section className="ts-hub-sec ts-hub-foot">
                <button type="button" className="ts-hub-out" data-hub-item onClick={act(() => signOut())}>{I.out}<span>Se déconnecter du compte</span></button>
              </section>
            )}
          </div>
        </>
      ))}
    </div>
  );
}

/** Sur mobile, le panneau est rendu à la racine de la page pour passer au-dessus des barres fixes */
function sheet(mobile: boolean | undefined, node: ReactNode) {
  return mobile ? createPortal(node, document.body) : node;
}
