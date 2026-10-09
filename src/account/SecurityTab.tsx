import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { AuditEntry } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { MfaSettings } from '../auth/Mfa';
import { readable } from '../auth/SignIn';
import { toast } from '../legacy/bridge';
import { uaLabel } from '../notify/push';
import { security } from '../security/stepUp';
import { logoutEverywhere } from './logout';
import { Sol } from '../ui/Sol';

// montant en SOL du journal (avec son équivalent en dollars), texte brut si la valeur n'est pas un nombre
const solOf = (x: unknown): ReactNode => { const n = Number(x); return x != null && x !== '' && isFinite(n) ? <Sol v={n} /> : String(x) + ' SOL'; };

type Sess = { id: string; created_at: string; updated_at: string | null; refreshed_at: string | null; user_agent: string | null; ip: string | null; aal: string | null };
const EVENTS: Record<string, string> = {
  account_created: 'Compte créé', wallet_added: 'Wallet ajouté', wallet_removed: 'Wallet retiré', withdraw_wallet_pending: 'Wallet de retrait ajouté (actif dans 24 h)',
  mode_reel: 'Passage en mode réel', mode_simulation: 'Retour en démo', limite_achat_modifiee: 'Limite par achat modifiée',
  login_new_device: 'Connexion depuis un nouvel appareil', session_revoked: 'Appareil déconnecté', sessions_revoked: 'Autres appareils déconnectés',
  anti_phishing_set: 'Code anti-hameçonnage modifié', server_wallet_withdraw: 'Retrait du wallet rapide', server_wallet_export: 'Clé du wallet rapide exportée',
  server_wallet_limits: 'Plafond du wallet rapide modifié', server_wallet_deleted: 'Wallet rapide supprimé', server_wallet_imported: 'Wallet rapide importé',
  server_auto_sell: 'Vente automatique', server_wallet_tx: 'Transaction du wallet rapide', token_meta_upload: 'Fiche de token envoyée',
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 2 ? 'à l\'instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : 'il y a ' + Math.round(m / 1440) + ' j';
};
const DEV = <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
const PHONE = <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>;

/** Onglet Sécurité : double authentification, appareils connectés, code anti-hameçonnage, alertes, journal */
export function SecurityTab() {
  const { user, signOut } = useAuth();
  const [log, setLog] = useState<AuditEntry[] | null>(null);
  const [sess, setSess] = useState<{ current: string | null; sessions: Sess[] } | null>(null);
  const [sessErr, setSessErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [anti, setAnti] = useState((user?.user_metadata?.anti_phishing as string | undefined) ?? '');
  const [antiErr, setAntiErr] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    security<{ current: string | null; sessions: Sess[] }>('sessions').then(setSess).catch((e) => setSessErr(readable(e)));
  }, []);
  useEffect(() => {
    if (!user) return;
    loadSessions();
    supabase.from('audit_log').select('id,event,detail,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50).then(({ data }) => setLog((data as AuditEntry[]) ?? []));
  }, [user, loadSessions]);

  async function revoke(id: string) {
    setBusy(id);
    try { await security('revoke', { session_id: id }); toast('Appareil déconnecté', 'Il devra se reconnecter pour accéder au compte.'); loadSessions(); }
    catch (e) { toast('Déconnexion impossible', readable(e), 'r'); } finally { setBusy(null); }
  }
  async function revokeOthers() {
    if (!window.confirm('Déconnecter tous vos autres appareils ? Cet appareil reste connecté.')) return;
    setBusy('others');
    try { const r = await security<{ revoked: number }>('revoke_others'); toast('Autres appareils déconnectés', r.revoked + ' session' + (r.revoked > 1 ? 's' : '') + ' fermée' + (r.revoked > 1 ? 's' : '') + '.'); loadSessions(); }
    catch (e) { toast('Déconnexion impossible', readable(e), 'r'); } finally { setBusy(null); }
  }
  async function saveAnti(ev: FormEvent) {
    ev.preventDefault(); setAntiErr(null); setBusy('anti');
    try { await security('anti_phishing', { code: anti.trim() }); await supabase.auth.refreshSession(); toast(anti.trim() ? 'Code anti-hameçonnage enregistré' : 'Code anti-hameçonnage retiré', anti.trim() ? 'Il apparaîtra en haut de tous nos e-mails.' : ''); }
    catch (e) { setAntiErr(readable(e)); } finally { setBusy(null); }
  }
  async function mailTest() {
    setBusy('mail');
    try { await security('mail_test'); toast('E-mail d\'essai envoyé', 'Regardez votre boîte de réception (et les indésirables).'); }
    catch (e) { toast('Envoi impossible', readable(e), 'r'); } finally { setBusy(null); }
  }

  return (
    <div className="ts-grid2">
      <div className="card">
        <div className="card-h"><h3>Double authentification</h3><p>Un code de votre téléphone en plus du wallet ou de l'e-mail. Il sert aussi à confirmer les actions sensibles.</p></div>
        <MfaSettings />
      </div>

      <div className="card">
        <div className="card-h"><h3>Code anti-hameçonnage</h3><p>Un mot que vous seul connaissez, affiché en haut de tous nos e-mails. Un e-mail sans ce code ne vient pas de TokenStudio.</p></div>
        <form className="ts-row" onSubmit={saveAnti}>
          <input value={anti} onChange={(e) => setAnti(e.target.value)} maxLength={24} placeholder="ex. Lune bleue 42" aria-label="Code anti-hameçonnage" autoComplete="off" />
          <button className="btn" disabled={busy === 'anti'}>{busy === 'anti' ? 'Enregistrement…' : 'Enregistrer'}</button>
        </form>
        {antiErr && <div className="ts-note bad" role="alert" style={{ marginTop: 10 }}>{antiErr}</div>}
        <p className="muted ts-small">4 à 24 lettres ou chiffres. Ne choisissez pas un mot de passe.</p>
      </div>

      <div className="card ts-span2">
        <div className="card-h ts-row spread"><div><h3>Appareils connectés</h3><p>Les sessions ouvertes sur votre compte. Déconnectez celles que vous ne reconnaissez pas.</p></div>
          {sess && sess.sessions.length > 1 && <button type="button" className="btn sm" disabled={!!busy} onClick={revokeOthers}>{busy === 'others' ? 'Déconnexion…' : 'Déconnecter les autres appareils'}</button>}</div>
        {sessErr ? <div className="ts-note bad">{sessErr}</div> : !sess ? <div className="empty"><b>Chargement…</b></div> : (
          <ul className="ts-sess">{sess.sessions.map((x) => {
            const label = x.user_agent ? uaLabel(x.user_agent) : 'Appareil inconnu', cur = x.id === sess.current;
            const last = x.refreshed_at ? x.refreshed_at + 'Z' : x.updated_at ?? x.created_at;
            return (
              <li key={x.id} className={cur ? 'cur' : ''}>
                <span className="ts-sess-ic">{/iPhone|Android/.test(label) ? PHONE : DEV}</span>
                <span className="ts-sess-t"><b>{label}{cur && <em className="badge g">Cet appareil</em>}{x.aal === 'aal2' && <em className="badge">2FA</em>}</b>
                  <small>{(x.ip || 'IP inconnue') + ' · active ' + ago(last) + ' · ouverte le ' + new Date(x.created_at).toLocaleDateString('fr-FR')}</small></span>
                {cur ? <button type="button" className="btn sm ghost" onClick={() => logoutEverywhere(signOut)}>Se déconnecter</button>
                  : <button type="button" className="btn sm" disabled={!!busy} onClick={() => revoke(x.id)}>{busy === x.id ? '…' : 'Déconnecter'}</button>}
              </li>
            );
          })}</ul>
        )}
        <p className="muted ts-small">Un appareil déconnecté garde l'accès quelques minutes au plus, le temps que son jeton expire, puis doit se reconnecter.</p>
      </div>

      <div className="card">
        <div className="card-h"><h3>Alertes de sécurité</h3><p>Vous recevez un e-mail à chaque événement important de votre compte.</p></div>
        <ul className="ts-promise">
          <li>Connexion depuis un nouvel appareil</li>
          <li>Retrait, export de clé, plafond ou suppression du wallet rapide</li>
          <li>Ajout d'un wallet (il ne reçoit des retraits qu'après 24 h)</li>
        </ul>
        <div className="toolbar"><button type="button" className="btn sm" disabled={!!busy || !user?.email} onClick={mailTest}>{busy === 'mail' ? 'Envoi…' : 'Envoyer un e-mail d\'essai'}</button>{!user?.email && <span className="muted ts-small">Ajoutez un e-mail dans Profil pour recevoir les alertes.</span>}</div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Protections actives</h3><p>Ce que TokenStudio fait pour garder votre compte et vos fonds.</p></div>
        <ul className="ts-promise">
          <li>Aucune clé privée de vos wallets n'est envoyée au serveur.</li>
          <li>La clé du wallet rapide est chiffrée sur le serveur et ne signe que dans vos plafonds.</li>
          <li>Retrait, export et hausse de plafond : mot de passe + code de confirmation.</li>
          <li>Chaque table de la base est privée à votre compte (règles RLS).</li>
        </ul>
        <div className="toolbar"><button className="btn danger sm" type="button" onClick={() => { if (window.confirm('Déconnecter tous vos appareils, y compris celui-ci ?')) logoutEverywhere(signOut, true); }}>Déconnecter tous les appareils</button></div>
      </div>

      <div className="card ts-span2">
        <div className="card-h"><h3>Journal de sécurité</h3><p>Les actions sensibles de votre compte, enregistrées par le serveur. Personne ne peut les modifier, pas même vous.</p></div>
        {!log ? <div className="empty"><b>Chargement…</b></div> : !log.length ? <div className="empty"><b>Rien pour l'instant</b></div> : (
          <div className="ts-log">{log.map((e) => (
            <div key={e.id}><span className="mono dim">{new Date(e.created_at).toLocaleString('fr-FR')}</span><b>{EVENTS[e.event] || e.event}</b><span className="dim mono">{typeof e.detail?.address === 'string' ? (e.detail.address as string).slice(0, 4) + '…' + (e.detail.address as string).slice(-4) : typeof e.detail?.device === 'string' ? String(e.detail.device) + (e.detail.ip ? ' · ' + e.detail.ip : '') : e.detail?.apres != null ? <>{solOf(e.detail.avant)} → {solOf(e.detail.apres)}</> : e.detail?.after != null ? <>{solOf(e.detail.before)} → {solOf(e.detail.after)}</> : e.detail?.sol != null ? solOf(e.detail.sol) : ''}</span></div>
          ))}</div>
        )}
      </div>
    </div>
  );
}
