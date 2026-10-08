import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth, type SignInIntent } from './AuthContext';
import { studio, toast } from '../legacy/bridge';
import { initials, isMobile, walletChoices, type WalletInfo } from '../wallets/catalog';
import { createAccountWithWallet, linkWallet, signInWithWallet, type Source } from '../wallets/walletAuth';
import { useServerWallet } from '../serverWallet/api';
import { openServerWallet } from '../serverWallet/ServerWalletDialog';

type Step = 'choose' | 'quick' | 'none' | 'email' | 'email-none' | 'code' | 'add';
const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);

export const WalletMark = ({ w }: { w: Pick<WalletInfo, 'name' | 'color'> }) => <span className="ts-wmark" style={{ background: w.color }} aria-hidden="true">{initials(w.name)}</span>;
const QuickMark = () => <span className="ts-wmark quick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg></span>;

/**
 * Connexion et ajout de wallets.
 * Invité : wallet (Phantom, Solflare…), wallet rapide ou e-mail. Un compte n'est jamais créé sans accord :
 * si le wallet ou l'e-mail n'a pas de compte, on propose de le créer ou de continuer en démo.
 * Connecté (écran « add ») : ajoute un wallet au compte après une signature gratuite.
 */
export function SignInPanel({ intent, onHide }: { intent: SignInIntent; onHide: (hidden: boolean) => void }) {
  const { session, openSignIn } = useAuth();
  const [step, setStep] = useState<Step>(intent.start ?? (session ? 'add' : 'choose'));
  const [src, setSrc] = useState<Source | null>(null);
  const [addr, setAddr] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const hub = studio()?.hub;
  const quick = hub?.state().quick ?? null;
  const { found, others } = walletChoices();
  const adding = step === 'add';
  const srv = useServerWallet();
  const close = () => openSignIn(false);

  async function run(key: string, fn: () => Promise<void>) {
    setErr(null); setBusy(key);
    try { await fn(); } catch (e) { setErr(readable(e)); } finally { setBusy(null); }
  }
  // Le wallet est prêt dans le studio : on ajoute au compte, ou on cherche le compte de ce wallet
  async function afterConnect(s: Source, address: string) {
    setSrc(s); setAddr(address);
    if (session) {
      await linkWallet(s);
      toast('Wallet ajouté à ton compte', short(address));
      close(); return;
    }
    if ((await signInWithWallet(s)) === 'none') setStep('none');
  }
  // Les fenêtres du studio (mot de passe, sauvegarde) passent au premier plan pendant qu'on masque celle-ci
  async function legacy<T>(fn: () => Promise<T>): Promise<T> {
    onHide(true);
    try { return await fn(); } finally { onHide(false); }
  }
  const pickWallet = (id: string) => run(id, async () => {
    const pk = await hub?.connect(id);
    if (!pk) return;
    await hub?.useExt();
    await afterConnect({ kind: 'ext', id }, pk);
  });
  const pickQuick = (how: 'use' | 'create' | 'restore') => run('quick-' + how, async () => {
    const pk = how === 'use' ? ((await legacy(() => hub!.quickUnlock())) ? quick?.pk : undefined)
      : await legacy(() => (how === 'create' ? hub!.quickCreate() : hub!.quickRestore()));
    if (!pk) return;
    await hub?.useQuick(true);
    await afterConnect({ kind: 'quick' }, pk);
  });
  const create = () => run('create', async () => { if (src) await createAccountWithWallet(src); });
  // ouverture depuis le menu avec un wallet déjà choisi : on enchaîne directement
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; started.current = true;
    if (intent.wallet === 'quick') { if (quick) pickQuick('use'); }
    else if (intent.wallet) pickWallet(intent.wallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const simulate = () => { close(); hub?.goSim(); toast('Mode démo', 'Explore l\'outil avec un wallet démo de 10 SOL fictifs. Rien n\'est envoyé ; crée ton compte pour vérifier sur la blockchain.', 'g'); };

  async function sendEmail(ev: FormEvent | null, createUser: boolean) {
    ev?.preventDefault(); setErr(null);
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setErr('Adresse e-mail invalide.'); return; }
    setBusy('email');
    const { error } = await supabase.auth.signInWithOtp({ email: v, options: { shouldCreateUser: createUser, emailRedirectTo: location.origin + location.pathname } });
    setBusy(null);
    if (error && /signups? not allowed|user not found/i.test(error.message)) { setEmail(v); setStep('email-none'); return; }
    if (error) { setErr(readable(error)); return; }
    setEmail(v); setStep('code');
  }
  async function verify(ev: FormEvent) {
    ev.preventDefault(); setErr(null);
    const t = code.replace(/\D/g, '');
    if (t.length < 6) { setErr('Le code fait 6 chiffres (ou plus).'); return; }
    setBusy('code');
    const { error } = await supabase.auth.verifyOtp({ email, token: t, type: 'email' });
    setBusy(null);
    if (error) setErr(readable(error));
  }

  const back = (to: Step) => <button type="button" className="btn ghost" onClick={() => { setErr(null); setStep(to); }}>Retour</button>;
  const head = (title: string, text: ReactNode) => <div className="ts-si-h"><b>{title}</b><span>{text}</span></div>;
  const here = location.href, ref = location.origin;

  const walletList = (
    <>
      {location.protocol === 'file:' && <div className="ts-note warn">Les wallets ne fonctionnent pas sur une page ouverte comme fichier : utilise la version en ligne.</div>}
      <div className="ts-si-list" role="list">
        {found.map((x) => (
          <button key={x.id} type="button" role="listitem" className="ts-si-opt" disabled={!!busy} onClick={() => pickWallet(x.id)}>
            <WalletMark w={x} /><span className="ts-si-n">{x.name}</span>
            <em className="ts-si-tag ok">{busy === x.id ? 'Validation…' : 'Détecté'}</em>
          </button>
        ))}
        <button type="button" role="listitem" className="ts-si-opt" disabled={!!busy} onClick={() => { setErr(null); setStep('quick'); }}>
          <QuickMark /><span className="ts-si-n">Wallet rapide<small>{quick ? short(quick.pk) + ' · dans ce navigateur' : 'Créer ou restaurer, sans extension'}</small></span>
          <em className="ts-si-tag">{quick ? (quick.unlocked ? 'Déverrouillé' : 'Verrouillé') : 'Studio'}</em>
        </button>
        {(more || !found.length ? others : others.slice(0, 2)).map((x) => {
          const link = isMobile() && x.mobile ? x.mobile(here, ref) : x.install;
          return (
            <a key={x.id} role="listitem" className="ts-si-opt" href={link} target={isMobile() && x.mobile ? undefined : '_blank'} rel="noopener noreferrer">
              <WalletMark w={x} /><span className="ts-si-n">{x.name}</span>
              <em className="ts-si-tag">{isMobile() && x.mobile ? 'Ouvrir l\'app' : 'Installer ↗'}</em>
            </a>
          );
        })}
      </div>
      {found.length > 0 && others.length > 2 && <button type="button" className="ts-si-more" onClick={() => setMore((m) => !m)}>{more ? 'Moins de wallets' : 'Plus de wallets (' + others.length + ')'}</button>}
    </>
  );

  return (
    <div className="ts-signin">
      {step === 'choose' && (<>
        {head('Connexion à TokenStudio', 'Choisis comment te connecter. Tes clés privées ne quittent jamais ton wallet.')}
        {intent.reason === 'real' && <div className="ts-note warn">Le mode réel demande un compte. La démo reste ouverte sans compte.</div>}
        {walletList}
        <div className="ts-si-or"><span>ou</span></div>
        <button type="button" className="btn ts-si-mail" onClick={() => { setErr(null); setStep('email'); }}>Continuer avec un e-mail</button>
        <button type="button" className="ts-si-sim" onClick={simulate}>Essayer la démo sans compte</button>
      </>)}

      {step === 'add' && (<>
        {head('Ajouter un wallet', 'Connecte un wallet puis signe un message gratuit : il est ajouté à ton compte. Aucune transaction n\'est autorisée.')}
        {srv && !srv.address && (
          <button type="button" className="ts-si-opt ts-si-srv" onClick={() => { close(); setTimeout(() => openServerWallet('create'), 0); }}>
            <span className="ts-wmark srv" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 18a5 5 0 01-.6-9.96A6 6 0 0118 9a4.5 4.5 0 01-.5 9H7z" /></svg></span>
            <span className="ts-si-n">Wallet rapide serveur<small>Signe seul, même studio fermé · recommandé pour le bot</small></span><em className="ts-si-tag ok">Nouveau</em>
          </button>
        )}
        {walletList}
      </>)}

      {step === 'quick' && (<>
        {head('Wallet rapide', 'Un wallet propre au studio, chiffré par ton mot de passe dans ce navigateur. Il signe seul, sans fenêtre : idéal pour les ventes automatiques.')}
        <div className="ts-si-list">
          {quick && (
            <button type="button" className="ts-si-opt" disabled={!!busy} onClick={() => pickQuick('use')}>
              <QuickMark /><span className="ts-si-n">Utiliser mon wallet rapide<small className="mono">{short(quick.pk)}</small></span>
              <em className="ts-si-tag ok">{busy === 'quick-use' ? 'Validation…' : quick.unlocked ? 'Prêt' : 'Mot de passe'}</em>
            </button>
          )}
          {!quick && (
            <button type="button" className="ts-si-opt" disabled={!!busy} onClick={() => pickQuick('create')}>
              <QuickMark /><span className="ts-si-n">Créer un wallet rapide<small>Nouveau wallet, sauvegarde guidée</small></span><em className="ts-si-tag">Nouveau</em>
            </button>
          )}
          <button type="button" className="ts-si-opt" disabled={!!busy} onClick={() => pickQuick('restore')}>
            <span className="ts-wmark ghost" aria-hidden="true">↺</span><span className="ts-si-n">{quick ? 'Restaurer un autre wallet rapide' : 'Restaurer un wallet rapide'}<small>Code de sauvegarde + mot de passe, ou clé privée</small></span>
          </button>
        </div>
        <div className="ts-row">{back(adding || session ? 'add' : 'choose')}</div>
      </>)}

      {step === 'none' && (<>
        {head('Aucun compte pour ce wallet', <>Le wallet <b className="mono">{short(addr)}</b> n'est lié à aucun compte TokenStudio. Rien n'a été créé.</>)}
        <div className="ts-si-choices">
          <button type="button" className="btn primary" disabled={!!busy} onClick={create}>{busy === 'create' ? 'Signature en attente…' : 'Créer mon compte avec ce wallet'}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => { setErr(null); setStep('email'); }}>J'ai déjà un compte (e-mail)</button>
          <button type="button" className="btn ghost" onClick={simulate}>Essayer la démo sans compte</button>
        </div>
        <p className="muted ts-small">Le compte garde tes préférences et ton historique sur tous tes appareils, et permet le mode réel. Connecté par e-mail, tu pourras ajouter ce wallet ensuite.</p>
      </>)}

      {step === 'email' && (
        <form onSubmit={(e) => sendEmail(e, false)} className="ts-si-form">
          {head('Connexion par e-mail', 'On t\'envoie un lien et un code de connexion. Pas de mot de passe à retenir.')}
          <label className="field"><span className="ts-lbl">Adresse e-mail</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@exemple.com" autoFocus /></label>
          <div className="ts-row">{back(src ? 'none' : 'choose')}<button className="btn primary" disabled={busy === 'email'}>{busy === 'email' ? 'Envoi…' : 'Recevoir le code'}</button></div>
        </form>
      )}

      {step === 'email-none' && (<>
        {head('Aucun compte avec cette adresse', <>Aucun compte TokenStudio n'utilise <b>{email}</b>. Rien n'a été créé.</>)}
        <div className="ts-si-choices">
          <button type="button" className="btn primary" disabled={busy === 'email'} onClick={() => sendEmail(null, true)}>{busy === 'email' ? 'Envoi…' : 'Créer mon compte avec cet e-mail'}</button>
          <button type="button" className="btn" onClick={() => { setErr(null); setStep('email'); }}>Changer d'adresse</button>
          <button type="button" className="btn ghost" onClick={simulate}>Essayer la démo sans compte</button>
        </div>
      </>)}

      {step === 'code' && (
        <form onSubmit={verify} className="ts-si-form">
          {head('Vérifie ta boîte mail', <>Clique sur le lien reçu à <b>{email}</b>, ou saisis le code qu'il contient.</>)}
          <label className="field"><span className="ts-lbl">Code reçu</span><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={10} autoFocus /></label>
          <div className="ts-row"><button type="button" className="btn ghost" onClick={() => setStep('email')}>Changer d'adresse</button><button className="btn primary" disabled={busy === 'code'}>{busy === 'code' ? 'Vérification…' : 'Se connecter'}</button></div>
        </form>
      )}
      {err && <div className="ts-note bad" role="alert">{err}</div>}
    </div>
  );
}

export function SignInDialog() {
  const { signInOpen, openSignIn, session } = useAuth();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!signInOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !hidden) openSignIn(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [signInOpen, openSignIn, hidden]);
  if (!signInOpen || (session && signInOpen.start !== 'add')) return null;
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Connexion" hidden={hidden} onMouseDown={(e) => { if (e.target === e.currentTarget) openSignIn(false); }}>
      <div className="ts-modal-box">
        <button type="button" className="ts-x" aria-label="Fermer" onClick={() => openSignIn(false)}>×</button>
        <SignInPanel intent={signInOpen} onHide={setHidden} />
      </div>
    </div>
  );
}

export function readable(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e);
  if (/rejected|denied|declined|cancel/i.test(m)) return 'Signature refusée dans le wallet.';
  if (/web3.*(disabled|not enabled)|provider.*disabled|unsupported provider/i.test(m)) return 'La connexion par wallet n\'est pas encore activée sur le serveur.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives : réessaie dans quelques minutes.';
  if (/expired|invalid.*(otp|token)|otp.*invalid/i.test(m)) return 'Code invalide ou expiré : demande un nouveau code.';
  if (/redirect|url.*not allowed|uri/i.test(m)) return 'Cette adresse de site n\'est pas autorisée dans la configuration du serveur.';
  return m.slice(0, 200);
}
