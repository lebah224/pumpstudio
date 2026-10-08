import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { cloudCounts, exportCloud, localCounts, setStatus, setSyncEnabled, syncNow, syncStore, wipeCloud } from './dataSync';
import { syncLabel, useSyncStatus } from './useDataSync';
import { toast } from '../legacy/bridge';

const ORDER = ['tokens', 'operations', 'orders', 'distributions', 'drafts', 'bot_strategies', 'bot_trades'];

/** Onglet Données de Mon compte : synchronisation, export et suppression */
export function DataTab() {
  const { user, aal } = useAuth();
  const s = useSyncStatus();
  const [local, setLocal] = useState<Record<string, number>>(() => localCounts());
  const [busy, setBusy] = useState<string | null>(null);
  const uid = user?.id;

  useEffect(() => { if (uid) cloudCounts(uid).then((c) => setStatus({ cloud: c })).catch(() => {}); }, [uid]);
  useEffect(() => { setLocal(localCounts()); }, [s.lastSync]);
  if (!uid) return null;

  async function toggle() {
    setBusy('toggle');
    try { const on = !s.enabled; await setSyncEnabled(uid!, on); if (on) await syncNow(uid!); toast(on ? 'Synchronisation activée' : 'Synchronisation arrêtée', on ? 'Tes données sont enregistrées sur ton compte.' : 'Les données déjà enregistrées restent sur ton compte.', on ? 'g' : 'a'); }
    catch (e) { toast('Action impossible', (e as Error).message, 'r'); } finally { setBusy(null); }
  }
  async function now() { setBusy('now'); await syncNow(uid!); setBusy(null); const e = syncStore.get().error; if (e) toast('Synchronisation incomplète', e, 'a'); else toast('Synchronisé'); }
  async function download() {
    setBusy('export');
    try {
      const data = await exportCloud(uid!);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'tokenstudio-compte-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast('Export impossible', (e as Error).message, 'r'); } finally { setBusy(null); }
  }
  async function wipe() {
    if (aal.next === 'aal2' && aal.current !== 'aal2') { toast('Code de sécurité requis', 'Valide ta double authentification avant de supprimer des données.', 'a'); return; }
    const word = window.prompt('Supprimer toutes les données de travail de ton compte (tokens, journal, ordres, bot…) ? Les données de ce navigateur restent intactes.\n\nÉcris SUPPRIMER pour confirmer.');
    if (word !== 'SUPPRIMER') return;
    setBusy('wipe');
    try { if (s.enabled) await setSyncEnabled(uid!, false); await wipeCloud(uid!); toast('Données du compte supprimées', 'La synchronisation est arrêtée.', 'a'); }
    catch (e) { toast('Suppression impossible', (e as Error).message, 'r'); } finally { setBusy(null); }
  }

  return (
    <div className="ts-grid2">
      <div className="card">
        <div className="card-h"><h3>Synchronisation</h3><p>Ce navigateur reste ton espace de travail ; ton compte en garde une copie et la partage avec tes autres appareils.</p></div>
        <div className="ts-row spread">
          <div><span className={'badge ' + (s.enabled ? 'g' : '')}>{s.enabled ? 'Activée' : 'Arrêtée'}</span> <span className="muted ts-small">{s.syncing ? 'synchronisation…' : s.lastSync ? 'dernière : ' + new Date(s.lastSync).toLocaleTimeString('fr-FR') : 'pas encore synchronisé'}</span></div>
          <div className="ts-row">
            {s.enabled && <button type="button" className="btn sm" disabled={!!busy || s.syncing} onClick={now}>Synchroniser maintenant</button>}
            <button type="button" className={'btn sm ' + (s.enabled ? 'ghost' : 'primary')} disabled={!!busy} onClick={toggle}>{s.enabled ? 'Arrêter' : 'Activer'}</button>
          </div>
        </div>
        {s.error && <div className="ts-note bad" style={{ marginTop: 10 }}>{s.error}</div>}
        <table className="ts-sync-table">
          <thead><tr><th>Donnée</th><th>Ce navigateur</th><th>Compte</th></tr></thead>
          <tbody>{ORDER.map((k) => <tr key={k}><td>{syncLabel(k)}</td><td className="mono">{local[k] ?? 0}</td><td className="mono">{s.cloud ? s.cloud[k] ?? 0 : '…'}</td></tr>)}</tbody>
        </table>
        <p className="muted ts-small">Jamais envoyés : les clés privées, le wallet rapide, les images de logo en cours d'édition. Le journal local garde les 2 000 dernières opérations ; le compte garde tout l'historique.</p>
      </div>
      <div className="card">
        <div className="card-h"><h3>Tes données</h3><p>Elles t'appartiennent : tu peux les récupérer ou les effacer quand tu veux.</p></div>
        <div className="ts-data-act">
          <div><b>Exporter</b><span>Profil, préférences, wallets, tokens, journal, ordres et bot dans un fichier JSON.</span></div>
          <button type="button" className="btn sm" disabled={!!busy} onClick={download}>{busy === 'export' ? 'Préparation…' : 'Télécharger'}</button>
        </div>
        <div className="ts-data-act danger">
          <div><b>Supprimer les données du compte</b><span>Efface tokens, journal, ordres, diffusion et bot du serveur. Ce navigateur n'est pas touché.</span></div>
          <button type="button" className="btn sm danger" disabled={!!busy} onClick={wipe}>{busy === 'wipe' ? 'Suppression…' : 'Supprimer'}</button>
        </div>
      </div>
    </div>
  );
}
