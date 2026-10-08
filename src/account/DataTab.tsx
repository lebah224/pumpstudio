import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { cloudCounts, detachCloud, exportCloud, flushAll, useCloudStatus } from '../data/cloud';
import { toast } from '../legacy/bridge';
import { disablePush } from '../notify/push';
import { leaveDemoGuest, markLeaving } from '../lib/guest';

const ORDER = ['tokens', 'operations', 'orders', 'distributions', 'bot_trades'];
const LABELS: Record<string, string> = { tokens: 'tokens', operations: 'opérations du journal', orders: 'ordres', distributions: 'demandes de référencement', bot_trades: 'trades du bot' };

/** Onglet Données de Mon compte : sauvegarde automatique, export et suppression du compte */
export function DataTab() {
  const { user, aal, signOut } = useAuth();
  const s = useCloudStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const uid = user?.id;

  useEffect(() => { if (uid) cloudCounts(uid).catch(() => {}); }, [uid, s.lastSaved]);
  if (!uid) return null;

  async function download() {
    setBusy('export');
    try {
      const data = await exportCloud(uid!);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'tokenstudio-compte-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast('Export impossible', (e as Error).message, 'r'); } finally { setBusy(null); }
  }
  async function deleteAccount() {
    if (confirm !== 'SUPPRIMER') return;
    if (aal.next === 'aal2' && aal.current !== 'aal2') { setDelErr('Valide d\'abord ta double authentification.'); return; }
    setBusy('delete'); setDelErr(null);
    try {
      await disablePush().catch(() => {});
      const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'SUPPRIMER' } });
      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json()).error || msg; } catch { /* réponse non JSON */ } }
        throw new Error(msg);
      }
      // compte supprimé : plus rien de ce compte dans ce navigateur
      markLeaving();
      await detachCloud();
      await signOut().catch(() => {});
      leaveDemoGuest();
      try { sessionStorage.setItem('ts-account-deleted', '1'); } catch { /* navigation privée */ }
      location.replace('/');
    } catch (e) { setDelErr((e as Error).message); setBusy(null); }
  }

  return (
    <div className="ts-grid2">
      <div className="card">
        <div className="card-h"><h3>Enregistrées sur ton compte</h3><p>Tes données vivent dans la base de TokenStudio : chaque changement y est écrit aussitôt, et tu les retrouves sur chacun de tes appareils. Rien n'est gardé dans ce navigateur.</p></div>
        <div className="ts-row spread">
          <div><span className={'badge ' + (s.error ? 'a' : 'g')}>{s.error ? 'En attente' : 'À jour'}</span> <span className="muted ts-small">{s.loading ? 'chargement…' : s.saving || s.pending ? 'enregistrement…' : s.lastSaved ? 'dernier enregistrement : ' + new Date(s.lastSaved).toLocaleTimeString('fr-FR') : ''}</span></div>
          {s.error && <button type="button" className="btn sm" disabled={s.saving} onClick={() => flushAll()}>Réessayer</button>}
        </div>
        {s.error && <div className="ts-note bad" style={{ marginTop: 10 }}>{s.error}</div>}
        <table className="ts-sync-table">
          <thead><tr><th>Donnée</th><th>Sur ton compte</th></tr></thead>
          <tbody>{ORDER.map((k) => <tr key={k}><td>{LABELS[k] ?? k}</td><td className="mono">{s.cloud ? s.cloud[k] ?? 0 : '…'}</td></tr>)}</tbody>
        </table>
        <p className="muted ts-small">Jamais enregistrés : les clés privées de tes wallets (sauf celle du wallet rapide, chiffrée) et les opérations de la démo.</p>
      </div>
      <div className="card">
        <div className="card-h"><h3>Tes données</h3><p>Elles t'appartiennent : tu peux les récupérer ou supprimer ton compte quand tu veux.</p></div>
        <div className="ts-data-act">
          <div><b>Exporter</b><span>Profil, préférences, wallets, tokens, journal, ordres et bot dans un fichier JSON.</span></div>
          <button type="button" className="btn sm" disabled={!!busy} onClick={download}>{busy === 'export' ? 'Préparation…' : 'Télécharger'}</button>
        </div>
        <div className="ts-data-act danger">
          <div><b>Supprimer le compte</b><span>Efface définitivement ton compte et toutes ses données : profil, wallets liés, tokens, journal, ordres, alertes et bot. Impossible à annuler.</span></div>
          {confirm === null && <button type="button" className="btn sm danger" disabled={!!busy} onClick={() => { setConfirm(''); setDelErr(null); }}>Supprimer</button>}
        </div>
        {confirm !== null && (
          <div className="ts-del-confirm">
            <p>Si ton wallet rapide contient encore des SOL ou des tokens, retire-les d'abord : la suppression est refusée tant qu'il n'est pas vide, pour que rien ne soit perdu.</p>
            <label className="field"><span className="ts-lbl">Écris <b>SUPPRIMER</b> pour confirmer</span><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} autoFocus /></label>
            {delErr && <div className="ts-note bad">{delErr}</div>}
            <div className="ts-row">
              <button type="button" className="btn sm ghost" disabled={busy === 'delete'} onClick={() => { setConfirm(null); setDelErr(null); }}>Annuler</button>
              <button type="button" className="btn sm danger" disabled={confirm !== 'SUPPRIMER' || busy === 'delete'} onClick={deleteAccount}>{busy === 'delete' ? 'Suppression…' : 'Supprimer définitivement'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
