import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, userLabel } from '../auth/AuthContext';
import { WalletMark, readable } from '../auth/SignIn';
import { goTo, studio, toast, type HubState } from '../legacy/bridge';
import { useSyncStatus } from '../sync/useDataSync';
import { detect, walletById } from '../wallets/catalog';
import { linkWallet } from '../wallets/walletAuth';
import { useAccountStatus, useLinkedWallets } from '../wallets/useWallets';
import { disablePush } from '../notify/push';

const THEME_NAMES: Record<string, string> = { or: 'Or', platine: 'Platine', saphir: 'Saphir', jade: 'Jade', cuivre: 'Cuivre', iris: 'Iris' };
const DEPTH_NAMES: Record<string, string> = { nuit: 'Nuit', profond: 'Profond', doux: 'Doux' };
const fmt = (n: number, d: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);
const copy = async (pk: string) => { try { await navigator.clipboard.writeText(pk); toast('Adresse copiée', short(pk)); } catch { /* presse-papiers refusé */ } };

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
  cloud: <svg className="i" viewBox="0 0 24 24"><path d="M7 18a5 5 0 01-.6-9.96A6 6 0 0118 9a4.5 4.5 0 01-.5 9H7z" /><path d="M12 12v5M9.5 14.5L12 12l2.5 2.5" /></svg>,
  plus: <svg className="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>,
  lock: <svg className="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>,
  mail: <svg className="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>,
};

/**
 * Menu unique en haut à droite. Trois états :
 * - invité : choix de connexion (wallets, wallet rapide, e-mail) ou simulation sans compte ;
 * - wallet connecté sans compte : se connecter au compte de ce wallet, ou le créer (jamais automatiquement) ;
 * - connecté : wallets du compte (ajout, choix du signataire), mode, préférences, sécurité, déconnexion.
 */
export function AccountHub({ mobile }: { mobile?: boolean }) {
  const { ready, user, needsMfa, aal, openSignIn, signOut } = useAuth();
  const st = useHubState();
  const sync = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const signed = !!user && !needsMfa;
  const w = st?.wallet ?? null;
  const linked = useLinkedWallets(signed ? user!.id : null, open);
  const status = useAccountStatus(!user && w ? w.pk : null, open);

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
  const label = user ? userLabel(user) : '';
  const openTab = (tab: string) => { try { sessionStorage.setItem('ts-account-tab', tab); } catch { /* navigation privée */ } window.dispatchEvent(new CustomEvent('ts-account-tab', { detail: tab })); goTo('account'); };
  if (!ready || !st) return null;

  const ext = st.ext, quick = st.quick;
  const usd = (b: number | null) => (b != null && st.solUsd ? '≈ ' + fmt(b * st.solUsd, 2) + ' $' : 'SOL');
  const bal = (b: number | null) => (b == null ? '—' : fmt(b, b >= 100 ? 2 : 4));
  const signIn = (wallet?: string) => act(() => openSignIn({ start: 'choose', wallet }));
  async function link(src: 'ext' | 'quick') {
    setBusy('link-' + src);
    try { const r = await linkWallet(src === 'quick' ? { kind: 'quick' } : { kind: 'ext', id: ext!.id }); toast('Wallet ajouté à ton compte', short(r.address)); }
    catch (e) { toast('Ajout impossible', readable(e), 'r'); } finally { setBusy(null); }
  }
  async function logout() {
    // les alertes de ce compte ne doivent pas arriver sur un navigateur dont on se déconnecte
    await disablePush().catch(() => {});
    await signOut();
    await hub?.disconnect(); hub?.quickLock();
    toast('Déconnecté', 'Compte et wallet déconnectés. Le wallet rapide reste chiffré dans ce navigateur.', '');
  }

  // bouton déclencheur
  const trigger = w ? (
    <><Avatar pk={w.pk} cls="sm" /><span className="ts-hub-bal mono">{st.bal == null ? '—' : fmt(st.bal, st.bal >= 100 ? 2 : mobile ? 3 : 4)}<small> SOL</small></span>{w.locked && <span className="ts-hub-lock" title="Wallet rapide verrouillé">●</span>}</>
  ) : user ? (
    <><span className="ts-hub-av">{label.slice(0, 1).toUpperCase()}</span>{!mobile && <span className="ts-hub-name">{label}</span>}</>
  ) : (
    <>{I.wallet}<span>{mobile ? 'Connexion' : 'Se connecter'}</span></>
  );

  const modeSec = (
    <section className="ts-hub-sec">
      <div className="ts-hub-h">Mode</div>
      <div className="seg ts-hub-mode" role="group" aria-label="Mode de trading">
        <button type="button" className={st.sim ? 'on' : ''} aria-pressed={st.sim} data-hub-item onClick={act(() => hub?.goSim())}>Simulation</button>
        {signed
          ? <button type="button" className={!st.sim ? 'on real' : ''} aria-pressed={!st.sim} data-hub-item onClick={act(() => hub?.goReal())}>Réel</button>
          : <button type="button" className="locked" data-hub-item title="Le mode réel demande un compte" onClick={act(() => openSignIn({ start: 'choose', reason: 'real' }))}>{I.lock}Réel</button>}
      </div>
      {!signed && <p className="ts-hub-note">Le mode réel demande un compte. La simulation est ouverte à tous.</p>}
    </section>
  );
  const quickLinks = (
    <nav className="ts-hub-sec ts-hub-links" aria-label="Réglages">
      <button type="button" data-hub-item onClick={act(() => hub?.appearance())}>{I.palette}Apparence</button>
      <button type="button" data-hub-item onClick={act(() => goTo('settings'))}>{I.gear}Réglages</button>
      <button type="button" data-hub-item onClick={act(() => document.getElementById('cmdkBtn')?.click())}>{I.search}Rechercher</button>
    </nav>
  );

  // ligne d'un wallet : identité, solde, rôle (signe ou non) et actions
  const walletRow = (kind: 'ext' | 'quick') => {
    const x = kind === 'ext' ? ext! : quick!;
    const activeW = kind === 'quick' ? quick!.active : !quick?.active;
    const mark = kind === 'quick' ? <span className="ts-wmark quick" aria-hidden="true">{I.bolt}</span> : <WalletMark w={walletById(ext!.id) ?? { name: ext!.name, color: '#7c8595' }} />;
    const isLinked = !signed || !linked ? true : linked.includes(x.pk);
    return (
      <div className={'ts-hub-wr' + (activeW ? ' on' : '')}>
        {mark}
        <span className="ts-hub-t">
          <b>{kind === 'quick' ? 'Wallet rapide' : ext!.name}{kind === 'quick' && !quick!.unlocked && <em className="badge a">verrouillé</em>}</b>
          <button type="button" className="ts-hub-addr mono" data-hub-item onClick={() => copy(x.pk)} title="Copier l'adresse">{short(x.pk)} {I.copy}</button>
        </span>
        <span className="ts-hub-wb"><b className="mono">{bal(x.bal)}</b><small>{usd(x.bal)}</small></span>
        <div className="ts-hub-wa">
          {activeW ? <span className="ts-hub-pill ok" title="Ce wallet signe tes transactions">Signe</span>
            : <button type="button" className="ts-hub-pill" data-hub-item onClick={() => hub?.useQuick(kind === 'quick')}>Utiliser</button>}
          {kind === 'quick' && (quick!.unlocked
            ? <button type="button" className="ts-hub-pill ghost" data-hub-item onClick={() => hub?.quickLock()}>Verrouiller</button>
            : <button type="button" className="ts-hub-pill ghost" data-hub-item onClick={act(() => hub?.quickUnlock())}>Déverrouiller</button>)}
          {signed && !isLinked && <button type="button" className="ts-hub-pill warn" data-hub-item disabled={!!busy} title="Ajouter ce wallet à ton compte (signature gratuite)" onClick={() => link(kind)}>{busy === 'link-' + kind ? 'Signature…' : 'Lier au compte'}</button>}
          {kind === 'ext' && <button type="button" className="ts-hub-pill ghost" data-hub-item onClick={() => hub?.disconnect()}>Déconnecter</button>}
        </div>
      </div>
    );
  };

  let body: ReactNode;
  if (signed) {
    body = (<>
      <section className="ts-hub-sec ts-hub-acc">
        <div className="ts-hub-id">
          <span className="ts-hub-av lg">{label.slice(0, 1).toUpperCase()}</span>
          <span className="ts-hub-t"><b>{label}</b><small>{aal.current === 'aal2' ? 'Compte protégé · double authentification' : 'Compte TokenStudio'}</small></span>
          {aal.current === 'aal2' && <span className="ts-hub-shield" title="Double authentification active">{I.shield}</span>}
        </div>
      </section>
      <section className="ts-hub-sec">
        <div className="ts-hub-h">Wallets{linked && <em>{linked.length} lié{linked.length > 1 ? 's' : ''} au compte</em>}</div>
        {ext && walletRow('ext')}
        {quick && walletRow('quick')}
        {!ext && !quick && <p className="ts-hub-note">Aucun wallet connecté dans ce navigateur.</p>}
        <div className="ts-hub-row">
          <button type="button" className="btn sm" data-hub-item onClick={act(() => openSignIn({ start: 'add' }))}>{I.plus}Ajouter un wallet</button>
          {(ext || quick) && <button type="button" className="btn sm ghost" data-hub-item onClick={act(() => goTo('wallet'))}>{I.wallet}Portefeuille</button>}
        </div>
      </section>
      {modeSec}
      <nav className="ts-hub-sec ts-hub-menu" aria-label="Compte">
        <button type="button" data-hub-item onClick={act(() => openTab('profile'))}>{I.user}<span>Mon compte</span><em>profil, wallets</em></button>
        <button type="button" data-hub-item onClick={act(() => goTo('wallet'))}>{I.wallet}<span>Portefeuille</span><em>solde, dépôt, retrait</em></button>
        <button type="button" data-hub-item onClick={act(() => openTab('prefs'))}>{I.sliders}<span>Préférences</span><em>trading, studio, notifications</em></button>
        <button type="button" data-hub-item onClick={act(() => hub?.appearance())}>{I.palette}<span>Apparence</span><em>{(THEME_NAMES[st.theme] ?? st.theme) + ' · ' + (DEPTH_NAMES[st.depth] ?? st.depth)}</em></button>
        <button type="button" data-hub-item onClick={act(() => goTo('settings'))}>{I.gear}<span>Réglages avancés</span><em>RPC, vitesse, frais</em></button>
        <button type="button" data-hub-item onClick={act(() => openTab('data'))}>{I.cloud}<span>Données</span><em>{sync.syncing ? 'synchronisation…' : sync.enabled ? 'synchronisées' : 'non synchronisées'}</em></button>
        <button type="button" data-hub-item onClick={act(() => openTab('security'))}>{I.shield}<span>Sécurité</span><em>{aal.current === 'aal2' ? '2FA active' : 'activer la 2FA'}</em></button>
        <button type="button" data-hub-item onClick={act(() => document.getElementById('cmdkBtn')?.click())}>{I.search}<span>Rechercher</span><kbd>Ctrl K</kbd></button>
      </nav>
      <section className="ts-hub-sec ts-hub-foot">
        <button type="button" className="ts-hub-out" data-hub-item onClick={act(logout)}>{I.out}<span>Se déconnecter</span></button>
      </section>
    </>);
  } else if (user && needsMfa) {
    body = (<>
      <section className="ts-hub-sec ts-hub-guest">
        <b>Code de sécurité requis</b>
        <small>Valide ta double authentification pour ouvrir ton compte.</small>
      </section>
      <section className="ts-hub-sec ts-hub-foot"><button type="button" className="ts-hub-out" data-hub-item onClick={act(logout)}>{I.out}<span>Se déconnecter</span></button></section>
    </>);
  } else if (w) {
    const src = w.session ? 'quick' : ext?.id;
    body = (<>
      <section className="ts-hub-sec">
        <div className="ts-hub-h">Wallet connecté · sans compte</div>
        {w.session ? quick && walletRow('quick') : ext && walletRow('ext')}
      </section>
      <section className="ts-hub-sec ts-hub-guest">
        {status === null ? <small>Recherche d'un compte pour ce wallet…</small>
          : status === 'none' ? (<>
            <b>Aucun compte pour ce wallet</b>
            <small>Crée ton compte pour synchroniser tes données et passer en mode réel. Rien n'est créé sans ton accord.</small>
            <div className="ts-hub-row">
              <button type="button" className="btn primary sm" data-hub-item onClick={signIn(src)}>Créer mon compte</button>
              <button type="button" className="btn sm" data-hub-item onClick={act(() => openSignIn({ start: 'email' }))}>{I.mail}J'ai un compte e-mail</button>
            </div>
          </>) : (<>
            <b>Un compte est lié à ce wallet</b>
            <small>Signe un message gratuit pour l'ouvrir : aucune transaction n'est autorisée.</small>
            <button type="button" className="btn primary sm" data-hub-item onClick={signIn(src)}>Se connecter au compte</button>
          </>)}
      </section>
      {modeSec}
      {quickLinks}
    </>);
  } else {
    const found = detect().slice(0, 3);
    body = (<>
      <section className="ts-hub-sec ts-hub-guest">
        <b>Connexion à TokenStudio</b>
        <small>Avec ton wallet, ton wallet rapide ou ton e-mail. Aucun compte n'est créé sans ton accord.</small>
        <div className="ts-hub-opts">
          {found.map((x) => <button key={x.id} type="button" className="ts-si-opt" data-hub-item onClick={signIn(x.id)}><WalletMark w={x} /><span className="ts-si-n">{x.name}</span><em className="ts-si-tag ok">Détecté</em></button>)}
          <button type="button" className="ts-si-opt" data-hub-item onClick={act(() => openSignIn({ start: 'quick' }))}><span className="ts-wmark quick" aria-hidden="true">{I.bolt}</span><span className="ts-si-n">Wallet rapide<small>{quick ? short(quick.pk) : 'Créer ou restaurer'}</small></span></button>
          <button type="button" className="ts-si-opt" data-hub-item onClick={signIn()}><span className="ts-wmark ghost" aria-hidden="true">{I.wallet}</span><span className="ts-si-n">{found.length ? 'Autres wallets' : 'Phantom, Solflare et autres'}</span></button>
          <button type="button" className="ts-si-opt" data-hub-item onClick={act(() => openSignIn({ start: 'email' }))}><span className="ts-wmark ghost" aria-hidden="true">{I.mail}</span><span className="ts-si-n">E-mail</span></button>
        </div>
        <button type="button" className="ts-si-sim" data-hub-item onClick={act(() => { hub?.goSim(); })}>Continuer sans compte · simulation</button>
      </section>
      {quickLinks}
    </>);
  }

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
          <div ref={panel} id={id} className={'ts-hub-panel' + (mobile ? ' sheet' : '') + (signed ? '' : ' guest')} role="dialog" aria-label="Compte et wallet">
            {body}
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
