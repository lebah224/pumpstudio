import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { readable } from './SignIn';
import { toast } from '../legacy/bridge';

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string; created_at: string };

/** Demande le code à 6 chiffres quand le compte a la double authentification et que la session ne l'a pas encore validée */
export function MfaChallenge() {
  const { needsMfa, refreshAal, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!needsMfa) return null;
  async function submit(ev: FormEvent) {
    ev.preventDefault(); setErr(null); setBusy(true);
    try {
      const { data: f, error: e1 } = await supabase.auth.mfa.listFactors(); if (e1) throw e1;
      const totp = f.totp.find((x) => x.status === 'verified'); if (!totp) throw new Error('Aucun facteur actif.');
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.replace(/\D/g, '') });
      if (error) throw error;
      await refreshAal();
    } catch (e) { setErr(readable(e)); } finally { setBusy(false); }
  }
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Double authentification">
      <form className="ts-modal-box" onSubmit={submit}>
        <div className="ts-si-h"><b>Double authentification</b><span>Saisis le code à 6 chiffres affiché par ton application (Google Authenticator, 1Password, Authy…).</span></div>
        <label className="field"><span className="ts-lbl">Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></label>
        {err && <div className="ts-note bad" role="alert">{err}</div>}
        <div className="ts-row"><button type="button" className="btn ghost" onClick={() => signOut()}>Se déconnecter</button><button className="btn primary" disabled={busy}>{busy ? 'Vérification…' : 'Valider'}</button></div>
      </form>
    </div>
  );
}

/** Activation / désactivation de la double authentification (TOTP) */
export function MfaSettings() {
  const { refreshAal, aal } = useAuth();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.factor_type === 'totp'));
  }, []);
  useEffect(() => { load(); }, [load]);
  const active = factors.find((f) => f.status === 'verified');

  async function start() {
    setErr(null); setBusy(true);
    try {
      for (const f of factors.filter((x) => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'TokenStudio ' + new Date().toLocaleDateString('fr-FR') });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (e) { setErr(readable(e)); } finally { setBusy(false); }
  }
  async function confirm(ev: FormEvent) {
    ev.preventDefault(); if (!enroll) return; setErr(null); setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.replace(/\D/g, '') });
      if (error) throw error;
      setEnroll(null); setCode(''); await load(); await refreshAal();
      toast('Double authentification activée', 'Le code sera demandé à chaque nouvelle connexion.');
    } catch (e) { setErr(readable(e)); } finally { setBusy(false); }
  }
  async function disable() {
    if (!active) return;
    if (aal.current !== 'aal2') { setErr('Valide d\'abord un code dans cette session pour pouvoir désactiver la protection.'); return; }
    if (!window.confirm('Désactiver la double authentification ? Ton compte sera moins protégé.')) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: active.id });
    setBusy(false);
    if (error) { setErr(readable(error)); return; }
    await load(); await refreshAal(); toast('Double authentification désactivée', '', 'a');
  }

  return (
    <div className="ts-mfa">
      {active ? (
        <div className="ts-row spread"><div><span className="badge g">Activée</span> <span className="muted">depuis le {new Date(active.created_at).toLocaleDateString('fr-FR')}</span></div><button className="btn sm ghost" type="button" disabled={busy} onClick={disable}>Désactiver</button></div>
      ) : enroll ? (
        <form onSubmit={confirm} className="ts-mfa-enroll">
          <img src={enroll.qr} alt="QR code à scanner avec ton application d'authentification" width={168} height={168} />
          <div>
            <ol className="ts-steps"><li>Scanne ce QR code avec ton application d'authentification.</li><li>Ou saisis la clé : <code className="ts-secret">{enroll.secret}</code></li><li>Entre le code à 6 chiffres affiché.</li></ol>
            <div className="ts-row"><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" aria-label="Code à 6 chiffres" /><button className="btn primary" disabled={busy}>Activer</button></div>
          </div>
        </form>
      ) : (
        <div className="ts-row spread"><span className="muted">Un code de ton téléphone sera demandé à chaque connexion, en plus du wallet ou de l'e-mail.</span><button className="btn primary sm" type="button" disabled={busy} onClick={start}>Activer</button></div>
      )}
      {err && <div className="ts-note bad" role="alert">{err}</div>}
    </div>
  );
}
