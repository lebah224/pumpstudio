import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

type SolWallet = { isConnected?: boolean; publicKey?: unknown; connect: () => Promise<unknown>; signMessage: (...a: unknown[]) => Promise<unknown> };
type WalletOpt = { id: string; name: string; get: () => SolWallet | undefined };

const w = window as unknown as Record<string, any>;
const WALLETS: WalletOpt[] = [
  { id: 'phantom', name: 'Phantom', get: () => w.phantom?.solana },
  { id: 'solflare', name: 'Solflare', get: () => w.solflare },
  { id: 'backpack', name: 'Backpack', get: () => w.backpack?.solana ?? w.backpack },
  { id: 'other', name: 'Autre wallet Solana', get: () => w.solana },
];

const STATEMENT = 'Connexion à TokenStudio. Cette signature est gratuite : elle prouve que ce wallet t\'appartient et n\'autorise aucune transaction.';

export function SignInPanel({ compact }: { compact?: boolean }) {
  const [mode, setMode] = useState<'choose' | 'email' | 'code'>('choose');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const available = WALLETS.filter((x) => x.get());
  const fileProto = location.protocol === 'file:';

  async function withWallet(opt: WalletOpt) {
    setErr(null); setBusy(opt.id);
    try {
      const wallet = opt.get(); if (!wallet) throw new Error(opt.name + ' n\'est pas installé.');
      if (!wallet.isConnected || !wallet.publicKey) await wallet.connect();
      const { error } = await supabase.auth.signInWithWeb3({ chain: 'solana', statement: STATEMENT, wallet: wallet as never });
      if (error) throw error;
    } catch (e) { setErr(readable(e)); } finally { setBusy(null); }
  }
  async function sendEmail(ev: FormEvent) {
    ev.preventDefault(); setErr(null);
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setErr('Adresse e-mail invalide.'); return; }
    setBusy('email');
    const { error } = await supabase.auth.signInWithOtp({ email: v, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
    setBusy(null);
    if (error) { setErr(readable(error)); return; }
    setEmail(v); setMode('code');
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

  return (
    <div className={'ts-signin' + (compact ? ' compact' : '')}>
      {mode === 'choose' && (<>
        <div className="ts-si-h"><b>Connexion à TokenStudio</b><span>Un compte garde ton profil, tes préférences et ton historique sur tous tes appareils. Tes clés privées ne quittent jamais ton wallet.</span></div>
        <div className="ts-si-sec">Avec ton wallet</div>
        {fileProto && <div className="ts-note warn">Les wallets ne fonctionnent pas sur une page ouverte comme fichier : utilise la version en ligne.</div>}
        <div className="ts-si-wallets">
          {(available.length ? available : WALLETS.slice(0, 1)).map((opt) => (
            <button key={opt.id} type="button" className="btn ts-si-w" disabled={!!busy || !opt.get()} onClick={() => withWallet(opt)}>
              <span className="ts-si-dot" />{busy === opt.id ? 'Signature en attente…' : opt.get() ? 'Continuer avec ' + opt.name : opt.name + ' non détecté'}
            </button>
          ))}
        </div>
        <div className="ts-si-or"><span>ou</span></div>
        <button type="button" className="btn ts-si-mail" onClick={() => { setErr(null); setMode('email'); }}>Continuer avec un e-mail</button>
      </>)}
      {mode === 'email' && (
        <form onSubmit={sendEmail} className="ts-si-form">
          <div className="ts-si-h"><b>Connexion par e-mail</b><span>On t'envoie un lien et un code de connexion. Pas de mot de passe à retenir.</span></div>
          <label className="field"><span className="ts-lbl">Adresse e-mail</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@exemple.com" autoFocus /></label>
          <div className="ts-row"><button type="button" className="btn ghost" onClick={() => setMode('choose')}>Retour</button><button className="btn primary" disabled={busy === 'email'}>{busy === 'email' ? 'Envoi…' : 'Recevoir le lien'}</button></div>
        </form>
      )}
      {mode === 'code' && (
        <form onSubmit={verify} className="ts-si-form">
          <div className="ts-si-h"><b>Vérifie ta boîte mail</b><span>Clique sur le lien reçu à <b>{email}</b>, ou saisis le code qu'il contient.</span></div>
          <label className="field"><span className="ts-lbl">Code reçu</span><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={10} autoFocus /></label>
          <div className="ts-row"><button type="button" className="btn ghost" onClick={() => setMode('email')}>Changer d'adresse</button><button className="btn primary" disabled={busy === 'code'}>{busy === 'code' ? 'Vérification…' : 'Se connecter'}</button></div>
        </form>
      )}
      {err && <div className="ts-note bad" role="alert">{err}</div>}
    </div>
  );
}

export function SignInDialog() {
  const { signInOpen, openSignIn, session } = useAuth();
  useEffect(() => {
    if (!signInOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') openSignIn(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [signInOpen, openSignIn]);
  if (!signInOpen || session) return null;
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Connexion" onMouseDown={(e) => { if (e.target === e.currentTarget) openSignIn(false); }}>
      <div className="ts-modal-box">
        <button type="button" className="ts-x" aria-label="Fermer" onClick={() => openSignIn(false)}>×</button>
        <SignInPanel />
      </div>
    </div>
  );
}

export function readable(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e);
  if (/rejected|denied|declined|cancel/i.test(m)) return 'Signature refusée dans le wallet.';
  if (/web3.*(disabled|not enabled)|provider.*disabled|unsupported provider/i.test(m)) return 'La connexion par wallet n\'est pas encore activée sur le serveur.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives : réessaie dans quelques minutes.';
  if (/expired|invalid.*(otp|token)|otp.*invalid/i.test(m)) return 'Code invalide ou expiré : demande un nouveau lien.';
  if (/redirect|url.*not allowed|uri/i.test(m)) return 'Cette adresse de site n\'est pas autorisée dans la configuration du serveur.';
  return m.slice(0, 200);
}
