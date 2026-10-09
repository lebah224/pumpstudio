import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { readable } from '../auth/SignIn';
import { security, stepUpStore, type StepUpPurpose } from './stepUp';

const LABEL: Record<StepUpPurpose, string> = {
  withdraw: 'Retrait depuis ton wallet rapide',
  limits_up: 'Hausse du plafond du wallet rapide',
  export_key: 'Export de la clé du wallet rapide',
  delete_wallet: 'Suppression du wallet rapide',
  link_wallet: 'Ajout d\'un wallet à ton compte',
  delete_account: 'Suppression de ton compte',
};
const SHIELD = <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;

/** Fenêtre de confirmation des actions sensibles : code reçu par e-mail ou code de l'application de double authentification */
export function StepUpDialog() {
  const [ask, setAsk] = useState(stepUpStore.get());
  const [methods, setMethods] = useState<{ email: string | null; totp: boolean } | null>(null);
  const [via, setVia] = useState<'email' | 'totp'>('email');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => stepUpStore.subscribe((a) => setAsk(a)), []);
  useEffect(() => {
    if (!ask) return;
    setMethods(null); setSentTo(null); setCode(''); setErr(null); setWait(0);
    security<{ email: string | null; totp: boolean }>('stepup_methods').then((m) => { setMethods(m); setVia(m.totp ? 'totp' : 'email'); })
      .catch((e) => setErr(readable(e)));
  }, [ask]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => { if (sentTo || via === 'totp') setTimeout(() => input.current?.focus(), 30); }, [sentTo, via]);
  if (!ask) return null;

  const cancel = () => ask.resolve(false);
  async function send() {
    setErr(null); setBusy('send');
    try { const r = await security<{ to: string }>('stepup_send', { purpose: ask!.purpose }); setSentTo(r.to); setWait(30); }
    catch (e) { setErr(readable(e)); } finally { setBusy(null); }
  }
  async function verify(ev: FormEvent) {
    ev.preventDefault(); setErr(null);
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) { setErr('Le code fait 6 chiffres.'); return; }
    setBusy('verify');
    try {
      if (via === 'totp') {
        const { data: f, error: e1 } = await supabase.auth.mfa.listFactors(); if (e1) throw e1;
        const totp = f.totp.find((x) => x.status === 'verified'); if (!totp) throw new Error('Aucune application d\'authentification active.');
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: c }); if (error) throw error;
        await security('stepup_verify', { purpose: ask!.purpose, method: 'totp' });
      } else {
        await security('stepup_verify', { purpose: ask!.purpose, code: c });
      }
      ask!.resolve(true);
    } catch (e) { setErr(readable(e)); setCode(''); } finally { setBusy(null); }
  }

  const none = methods && !methods.email && !methods.totp;
  return (
    <div className="ts-modal ts-stepup" role="dialog" aria-modal="true" aria-labelledby="ts-su-t" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <form className="ts-modal-box" onSubmit={verify}>
        <div className="ts-su-h"><span className="ts-su-ic">{SHIELD}</span><div><b id="ts-su-t">Confirme qu'il s'agit bien de toi</b><span>{LABEL[ask.purpose]}</span></div></div>
        {!methods && !err && <p className="muted">Chargement…</p>}
        {none && <div className="ts-note warn">Pour confirmer cette action, ajoute une adresse e-mail à ton compte (Mon compte → Profil) ou active la double authentification (Mon compte → Sécurité).</div>}
        {methods && !none && (<>
          {methods.email && methods.totp && (
            <div className="seg sm ts-su-via" role="group" aria-label="Moyen de confirmation">
              <button type="button" className={via === 'totp' ? 'on' : ''} aria-pressed={via === 'totp'} onClick={() => { setVia('totp'); setCode(''); setErr(null); }}>Application 2FA</button>
              <button type="button" className={via === 'email' ? 'on' : ''} aria-pressed={via === 'email'} onClick={() => { setVia('email'); setCode(''); setErr(null); }}>Code par e-mail</button>
            </div>
          )}
          {via === 'email' && !sentTo && (<>
            <p className="ts-su-p">Nous allons envoyer un code à 6 chiffres à <b>{methods.email}</b>. Il est valable 10 minutes.</p>
            <button type="button" className="btn primary ts-su-send" disabled={!!busy} onClick={send}>{busy === 'send' ? 'Envoi…' : 'Envoyer le code'}</button>
          </>)}
          {(via === 'totp' || sentTo) && (<>
            <p className="ts-su-p">{via === 'totp' ? 'Saisis le code affiché par ton application d\'authentification.' : <>Code envoyé à <b>{sentTo}</b>. Pense à regarder dans les indésirables.</>}</p>
            <label className="field"><span className="ts-lbl">Code de sécurité</span>
              <input ref={input} className="ts-su-code mono" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} placeholder="123456" />
            </label>
            {via === 'email' && <button type="button" className="ts-su-resend" disabled={wait > 0 || !!busy} onClick={send}>{wait > 0 ? 'Renvoyer le code dans ' + wait + ' s' : 'Renvoyer le code'}</button>}
          </>)}
        </>)}
        {err && <div className="ts-note bad" role="alert">{err}</div>}
        <div className="ts-row ts-su-act">
          <button type="button" className="btn ghost" onClick={cancel}>Annuler</button>
          {(via === 'totp' || sentTo) && !none && <button className="btn primary" disabled={!!busy || code.replace(/\D/g, '').length !== 6}>{busy === 'verify' ? 'Vérification…' : 'Confirmer'}</button>}
        </div>
        <p className="ts-su-foot">TokenStudio ne te demandera jamais ce code par téléphone, message privé ou réseau social.</p>
      </form>
    </div>
  );
}
