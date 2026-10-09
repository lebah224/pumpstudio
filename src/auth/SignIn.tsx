import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth, type SignInIntent } from './AuthContext';
import { studio, toast } from '../legacy/bridge';
import { initials, isMobile, walletChoices, type WalletInfo } from '../wallets/catalog';
import { createAccountWithWallet, linkWallet, signInWithWallet, type Source } from '../wallets/walletAuth';
import { useServerWallet } from '../serverWallet/api';
import { lang, t } from '../lib/i18n';
import { Captcha, captchaMissing, captchaOn, takeCaptcha, useCaptchaToken } from './Captcha';
import { openServerWallet } from '../serverWallet/ServerWalletDialog';

type Step = 'choose' | 'quick' | 'none' | 'email' | 'email-none' | 'code' | 'add';
const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);

// texte foncé sur les couleurs claires (contraste lisible), clair sur les foncées
const inkFor = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return '#fff'; const n = parseInt(m[1]!, 16), l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; return l > 0.55 ? '#0b0a09' : '#fff'; };
export const WalletMark = ({ w }: { w: Pick<WalletInfo, 'name' | 'color'> }) => <span className="ts-wmark" style={{ background: w.color, color: inkFor(w.color) }} aria-hidden="true">{initials(w.name)}</span>;
const QuickMark = () => <span className="ts-wmark quick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg></span>;

/**
 * Connexion et ajout de wallets.
 * Invité : wallet (Phantom, Solflare…), wallet rapide ou e-mail. Un compte n'est jamais créé sans accord :
 * si le wallet ou l'e-mail n'a pas de compte, on propose de le créer ou de continuer en démo.
 * Connecté (écran « add ») : ajoute un wallet au compte après une signature gratuite.
 */
/**
 * standalone : page de connexion hors de l'outil (le code Solana du studio n'y est pas chargé) ;
 * signup : l'utilisateur a choisi « Créer un compte », un compte est donc créé s'il n'existe pas.
 */
export function SignInPanel({ intent, onHide, standalone, signup }: { intent: SignInIntent; onHide: (hidden: boolean) => void; standalone?: boolean; signup?: boolean }) {
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
  // wallet rapide de ce navigateur, même mis de côté après une déconnexion
  const quick = hub?.state().quickSaved ?? null;
  // ancien wallet rapide gardé dans ce navigateur : il sert encore à se connecter (le temps de le transférer sur le compte)
  const legacyQuick = !!quick || (!!standalone && (() => { try { return !!localStorage.getItem('pstudio_sess_v1'); } catch { return false; } })());
  const { found, others } = walletChoices();
  const adding = step === 'add';
  const srv = useServerWallet();
  const close = () => openSignIn(false);
  // case « Je ne suis pas un robot » : demandée pour toute connexion ou création de compte (pas pour ajouter un wallet)
  const robotToken = useCaptchaToken();
  const robotOk = !!session || !captchaOn() || !!robotToken;
  const robot = !session ? <Captcha /> : null;

  async function run(key: string, fn: () => Promise<void>) {
    setErr(null); setBusy(key);
    try { await fn(); } catch (e) { setErr(readable(e)); } finally { setBusy(null); }
  }
  // Le wallet est prêt dans le studio : on ajoute au compte, ou on cherche le compte de ce wallet
  async function afterConnect(s: Source, address: string, captcha?: string) {
    setSrc(s); setAddr(address);
    if (session) {
      await linkWallet(s);
      toast(t('Wallet ajouté à ton compte', 'Wallet added to your account'), short(address));
      close(); return;
    }
    if ((await signInWithWallet(s, captcha)) === 'none') { if (signup) await createAccountWithWallet(s, captcha); else setStep('none'); }
  }
  // Les fenêtres du studio (mot de passe, sauvegarde) passent au premier plan pendant qu'on masque celle-ci
  async function legacy<T>(fn: () => Promise<T>): Promise<T> {
    onHide(true);
    try { return await fn(); } finally { onHide(false); }
  }
  const pickWallet = (id: string) => run(id, async () => {
    const miss = session ? null : captchaMissing(); if (miss) throw new Error(miss);
    let pk: string | null | undefined;
    if (standalone) {
      // page de connexion : on connecte l'extension directement ; l'outil la reconnectera à l'ouverture
      const p = walletChoices().found.find((x) => x.id === id)?.p;
      if (!p) throw new Error(t('Wallet non détecté.', 'Wallet not detected.'));
      await p.connect();
      pk = p.publicKey?.toString();
      try { localStorage.setItem('pstudio_wallet_v1', JSON.stringify(id)); } catch { /* navigation privée */ }
    } else { pk = await hub?.connect(id); if (pk) await hub?.useExt(); }
    if (!pk) return;
    await afterConnect({ kind: 'ext', id }, pk, session ? undefined : takeCaptcha());
  });
  const pickQuick = (how: 'use' | 'create' | 'restore') => run('quick-' + how, async () => {
    const miss = session ? null : captchaMissing(); if (miss) throw new Error(miss);
    const pk = how === 'use' ? ((await legacy(() => hub!.quickUnlock())) ? quick?.pk : undefined)
      : await legacy(() => (how === 'create' ? hub!.quickCreate() : hub!.quickRestore()));
    if (!pk) return;
    // l'ancien wallet rapide sert seulement à se connecter : il ne signe plus de transactions
    await afterConnect({ kind: 'quick' }, pk, session ? undefined : takeCaptcha());
  });
  const create = () => run('create', async () => { const miss = captchaMissing(); if (miss) throw new Error(miss); if (src) await createAccountWithWallet(src, takeCaptcha()); });
  // ouverture depuis le menu avec un wallet déjà choisi : on enchaîne directement
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; started.current = true;
    if (!session && captchaOn()) return; // la case anti-robot doit d'abord être cochée : l'utilisateur choisit lui-même
    if (intent.wallet === 'quick') { if (quick) pickQuick('use'); }
    else if (intent.wallet) pickWallet(intent.wallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const simulate = () => { if (standalone) { location.href = '/app?demo=1'; return; } close(); hub?.goSim(); toast('Mode démo', 'Explore l\'outil avec un wallet démo de 10 SOL fictifs. Rien n\'est envoyé ; crée ton compte pour vérifier sur la blockchain.', 'g'); };

  async function sendEmail(ev: FormEvent | null, createUser: boolean) {
    ev?.preventDefault(); setErr(null);
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setErr(t('Adresse e-mail invalide.', 'Invalid email address.')); return; }
    const miss = captchaMissing(); if (miss) { setErr(miss); return; }
    setBusy('email');
    // langue des e-mails (modèles bilingues) : retenue à la création du compte
    const { error } = await supabase.auth.signInWithOtp({ email: v, options: { shouldCreateUser: createUser || !!signup, emailRedirectTo: location.origin + (standalone ? '/connexion' : location.pathname), data: { lang: lang() }, captchaToken: takeCaptcha() } });
    setBusy(null);
    if (error && /signups? not allowed|user not found/i.test(error.message)) { setEmail(v); setStep('email-none'); return; }
    if (error) { setErr(readable(error)); return; }
    setEmail(v); setStep('code');
  }
  async function verify(ev: FormEvent) {
    ev.preventDefault(); setErr(null);
    const tok = code.replace(/\D/g, '');
    if (tok.length < 6) { setErr(t('Le code fait 6 chiffres (ou plus).', 'The code is 6 digits (or more).')); return; }
    setBusy('code');
    const { error } = await supabase.auth.verifyOtp({ email, token: tok, type: 'email' });
    setBusy(null);
    if (error) setErr(readable(error));
  }

  const back = (to: Step) => <button type="button" className="btn ghost" onClick={() => { setErr(null); setStep(to); }}>{t('Retour', 'Back')}</button>;
  const head = (title: string, text: ReactNode) => <div className="ts-si-h"><b>{title}</b><span>{text}</span></div>;
  const here = location.href, ref = location.origin;

  const walletList = (
    <>
      {location.protocol === 'file:' && <div className="ts-note warn">{t('Les wallets ne fonctionnent pas sur une page ouverte comme fichier : utilise la version en ligne.', 'Wallets don\'t work on a page opened as a file: use the online version.')}</div>}
      <div className="ts-si-list" role="list">
        {found.map((x) => (
          <button key={x.id} type="button" role="listitem" className="ts-si-opt" disabled={!!busy || !robotOk} onClick={() => pickWallet(x.id)}>
            <WalletMark w={x} /><span className="ts-si-n">{x.name}</span>
            <em className="ts-si-tag ok">{busy === x.id ? t('Validation…', 'Confirming…') : t('Détecté', 'Detected')}</em>
          </button>
        ))}
        {legacyQuick && !adding && (
          <button type="button" role="listitem" className="ts-si-opt" disabled={!!busy} onClick={() => { setErr(null); if (standalone) { location.href = '/app?signin=quick'; return; } setStep('quick'); }}>
            <QuickMark /><span className="ts-si-n">{t('Ancien wallet rapide', 'Former quick wallet')}<small>{quick ? short(quick.pk) + ' · ' : ''}{t('dans ce navigateur', 'in this browser')}</small></span>
            <em className="ts-si-tag">{t('Mot de passe', 'Password')}</em>
          </button>
        )}
        {(more || !found.length ? others : others.slice(0, 2)).map((x) => {
          const link = isMobile() && x.mobile ? x.mobile(here, ref) : x.install;
          return (
            <a key={x.id} role="listitem" className="ts-si-opt" href={link} target={isMobile() && x.mobile ? undefined : '_blank'} rel="noopener noreferrer">
              <WalletMark w={x} /><span className="ts-si-n">{x.name}</span>
              <em className="ts-si-tag">{isMobile() && x.mobile ? t('Ouvrir l\'app', 'Open the app') : t('Installer ↗', 'Install ↗')}</em>
            </a>
          );
        })}
      </div>
      {found.length > 0 && others.length > 2 && <button type="button" className="ts-si-more" onClick={() => setMore((m) => !m)}>{more ? t('Moins de wallets', 'Fewer wallets') : t('Plus de wallets', 'More wallets') + ' (' + others.length + ')'}</button>}
    </>
  );

  return (
    <div className="ts-signin">
      {step === 'choose' && (<>
        {signup ? head(t('Créer ton compte', 'Create your account'), t('Avec ton wallet ou ton e-mail. Une signature gratuite suffit : aucune transaction, aucun frais.', 'With your wallet or your email. One free signature is enough: no transaction, no fees.'))
          : head(t('Connexion à TokenStudio', 'Sign in to TokenStudio'), t('Choisis comment te connecter. Tes clés privées ne quittent jamais ton wallet.', 'Choose how to sign in. Your private keys never leave your wallet.'))}
        {intent.reason === 'real' && <div className="ts-note warn">Le mode réel demande un compte. La démo reste ouverte sans compte.</div>}
        {robot}
        {walletList}
        <div className="ts-si-or"><span>{t('ou', 'or')}</span></div>
        <button type="button" className="btn ts-si-mail" onClick={() => { setErr(null); setStep('email'); }}>{t('Continuer avec un e-mail', 'Continue with email')}</button>
        <button type="button" className="ts-si-sim" onClick={simulate}>{t('Essayer la démo sans compte', 'Try the demo without an account')}</button>
      </>)}

      {step === 'add' && (<>
        {head('Ajouter un wallet', 'Connecte un wallet puis signe un message gratuit : il est ajouté à ton compte. Aucune transaction n\'est autorisée.')}
        {srv && !srv.address && (
          <button type="button" className="ts-si-opt ts-si-srv" onClick={() => { close(); setTimeout(() => openServerWallet('create'), 0); }}>
            <QuickMark />
            <span className="ts-si-n">Wallet rapide<small>Créé sur ton compte : il signe seul, sans fenêtre · recommandé pour le bot</small></span><em className="ts-si-tag ok">Conseillé</em>
          </button>
        )}
        {walletList}
      </>)}

      {step === 'quick' && (<>
        {head('Ancien wallet rapide', 'Ce navigateur garde encore ton ancien wallet rapide. Connecte-toi avec lui, puis transfère-le sur ton compte depuis le menu : tu le retrouveras partout.')}
        {robot}
        <div className="ts-si-list">
          {quick && (
            <button type="button" className="ts-si-opt" disabled={!!busy || !robotOk} onClick={() => pickQuick('use')}>
              <QuickMark /><span className="ts-si-n">Utiliser mon ancien wallet rapide<small className="mono">{short(quick.pk)}</small></span>
              <em className="ts-si-tag ok">{busy === 'quick-use' ? 'Validation…' : quick.unlocked ? 'Prêt' : 'Mot de passe'}</em>
            </button>
          )}
          {!quick && <p className="muted ts-small">Aucun ancien wallet rapide dans ce navigateur.</p>}
        </div>
        <div className="ts-row">{back(adding || session ? 'add' : 'choose')}</div>
      </>)}

      {step === 'none' && (<>
        {head(t('Aucun compte pour ce wallet', 'No account for this wallet'), <>{t('Le wallet', 'The wallet')} <b className="mono">{short(addr)}</b> {t('n\'est lié à aucun compte TokenStudio. Rien n\'a été créé.', 'isn\'t linked to any TokenStudio account. Nothing was created.')}</>)}
        {robot}
        <div className="ts-si-choices">
          <button type="button" className="btn primary" disabled={!!busy || !robotOk} onClick={create}>{busy === 'create' ? t('Signature en attente…', 'Waiting for signature…') : t('Créer mon compte avec ce wallet', 'Create my account with this wallet')}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => { setErr(null); setStep('email'); }}>{t('J\'ai déjà un compte (e-mail)', 'I already have an account (email)')}</button>
          <button type="button" className="btn ghost" onClick={simulate}>{t('Essayer la démo sans compte', 'Try the demo without an account')}</button>
        </div>
        <p className="muted ts-small">{t('Le compte garde tes préférences et ton historique sur tous tes appareils, et permet le mode réel. Connecté par e-mail, tu pourras ajouter ce wallet ensuite.', 'An account keeps your settings and history on all your devices, and unlocks live mode. Signed in by email, you can add this wallet afterwards.')}</p>
      </>)}

      {step === 'email' && (
        <form onSubmit={(e) => sendEmail(e, false)} className="ts-si-form">
          {head(t('Connexion par e-mail', 'Sign in by email'), t('On t\'envoie un lien et un code de connexion. Pas de mot de passe à retenir.', 'We send you a sign-in link and code. No password to remember.'))}
          <label className="field"><span className="ts-lbl">{t('Adresse e-mail', 'Email address')}</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('toi@exemple.com', 'you@example.com')} autoFocus /></label>
          {robot}
          <div className="ts-row">{back(src ? 'none' : 'choose')}<button className="btn primary" disabled={busy === 'email' || !robotOk}>{busy === 'email' ? t('Envoi…', 'Sending…') : t('Recevoir le code', 'Get the code')}</button></div>
        </form>
      )}

      {step === 'email-none' && (<>
        {head(t('Aucun compte avec cette adresse', 'No account with this address'), <>{t('Aucun compte TokenStudio n\'utilise', 'No TokenStudio account uses')} <b>{email}</b>. {t('Rien n\'a été créé.', 'Nothing was created.')}</>)}
        {robot}
        <div className="ts-si-choices">
          <button type="button" className="btn primary" disabled={busy === 'email' || !robotOk} onClick={() => sendEmail(null, true)}>{busy === 'email' ? t('Envoi…', 'Sending…') : t('Créer mon compte avec cet e-mail', 'Create my account with this email')}</button>
          <button type="button" className="btn" onClick={() => { setErr(null); setStep('email'); }}>{t('Changer d\'adresse', 'Change address')}</button>
          <button type="button" className="btn ghost" onClick={simulate}>{t('Essayer la démo sans compte', 'Try the demo without an account')}</button>
        </div>
      </>)}

      {step === 'code' && (
        <form onSubmit={verify} className="ts-si-form">
          {head(t('Vérifie ta boîte mail', 'Check your inbox'), <>{t('Clique sur le lien reçu à', 'Click the link sent to')} <b>{email}</b>{t(', ou saisis le code qu\'il contient.', ', or enter the code it contains.')}</>)}
          <label className="field"><span className="ts-lbl">{t('Code reçu', 'Code received')}</span><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={10} autoFocus /></label>
          <div className="ts-row"><button type="button" className="btn ghost" onClick={() => setStep('email')}>{t('Changer d\'adresse', 'Change address')}</button><button className="btn primary" disabled={busy === 'code'}>{busy === 'code' ? t('Vérification…', 'Verifying…') : t('Se connecter', 'Sign in')}</button></div>
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
  if (/rejected|denied|declined|cancel/i.test(m)) return t('Signature refusée dans le wallet.', 'Signature rejected in the wallet.');
  if (/web3.*(disabled|not enabled)|provider.*disabled|unsupported provider/i.test(m)) return t('La connexion par wallet n\'est pas encore activée sur le serveur.', 'Wallet sign-in isn\'t enabled on the server yet.');
  if (/rate limit|too many/i.test(m)) return t('Trop de tentatives : réessaie dans quelques minutes.', 'Too many attempts: try again in a few minutes.');
  if (/expired|invalid.*(otp|token)|otp.*invalid/i.test(m)) return t('Code invalide ou expiré : demande un nouveau code.', 'Invalid or expired code: request a new one.');
  if (/redirect|url.*not allowed|uri/i.test(m)) return t('Cette adresse de site n\'est pas autorisée dans la configuration du serveur.', 'This site address isn\'t allowed in the server configuration.');
  return m.slice(0, 200);
}
