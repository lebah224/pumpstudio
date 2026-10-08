import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthContext';
import { localCounts, pushSoon, readSyncEnabled, setStatus, setSyncEnabled, syncNow, syncStore } from './dataSync';
import { toast } from '../legacy/bridge';

export const useSyncStatus = () => useSyncExternalStore(syncStore.subscribe, syncStore.get);

const LABELS: Record<string, string> = { tokens: 'tokens', operations: 'opérations du journal', orders: 'ordres', distributions: 'demandes de référencement', drafts: 'brouillon', bot_strategies: 'stratégies du bot', bot_trades: 'trades du bot' };
export const syncLabel = (k: string) => LABELS[k] ?? k;

/**
 * Démarre la synchronisation après connexion :
 * - choix déjà fait : on applique (synchronisation ou non) ;
 * - premier passage avec des données dans ce navigateur : on demande l'accord avant tout envoi ;
 * - navigateur vide : on récupère simplement les données du compte.
 */
export function useDataSync() {
  const { user, needsMfa } = useAuth();
  const [ask, setAsk] = useState<Record<string, number> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const uid = user?.id ?? null;

  useEffect(() => {
    setStatus({ userId: uid, enabled: null, lastSync: null, error: null, cloud: null });
    if (!uid || needsMfa) return;
    let cancelled = false;
    (async () => {
      const on = await readSyncEnabled(uid).catch(() => null);
      if (cancelled) return;
      if (on === true) { setStatus({ enabled: true }); syncNow(uid); return; }
      if (on === false) { setStatus({ enabled: false }); return; }
      const counts = localCounts();
      const total = Object.entries(counts).filter(([k]) => k !== 'drafts' && k !== 'bot_strategies').reduce((a, [, n]) => a + n, 0);
      if (total > 0) setAsk(counts);
      else { try { await setSyncEnabled(uid, true); syncNow(uid); } catch { /* réessayé à la prochaine connexion */ } }
    })();
    return () => { cancelled = true; };
  }, [uid, needsMfa]);

  // chaque changement dans le studio est envoyé quelques secondes plus tard
  useEffect(() => {
    if (!uid) return;
    const later = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => pushSoon(uid), 2500); };
    const onVisible = () => { const s = syncStore.get(); if (document.visibilityState === 'visible' && s.enabled && (!s.lastSync || Date.now() - s.lastSync > 60000)) syncNow(uid); };
    window.addEventListener('pstudio-data', later); window.addEventListener('pstudio-bot', later); document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('pstudio-data', later); window.removeEventListener('pstudio-bot', later); document.removeEventListener('visibilitychange', onVisible); window.clearTimeout(timer.current); };
  }, [uid]);

  async function choose(on: boolean | null) {
    const counts = ask; setAsk(null);
    if (!uid || on === null) return;
    try {
      await setSyncEnabled(uid, on);
      if (on) { await syncNow(uid); const s = syncStore.get(); if (s.error) toast('Synchronisation incomplète', s.error, 'a'); else toast('Données synchronisées', Object.values(counts ?? {}).reduce((a, n) => a + n, 0) + ' éléments enregistrés sur ton compte.'); }
    } catch (e) { toast('Synchronisation impossible', (e as Error).message, 'r'); }
  }

  if (!ask) return null;
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Synchroniser les données">
      <div className="ts-modal-box">
        <div className="ts-si-h"><b>Synchroniser ce navigateur avec ton compte ?</b><span>Ce navigateur contient déjà des données. En les synchronisant, tu les retrouves sur tous tes appareils, et elles sont sauvegardées si ce navigateur est vidé.</span></div>
        <ul className="ts-sync-list">
          {Object.entries(ask).filter(([, n]) => n > 0).map(([k, n]) => <li key={k}><b>{n}</b> {syncLabel(k)}</li>)}
        </ul>
        <p className="muted ts-small">Ton wallet rapide et ses clés ne sont jamais envoyés. Tu peux arrêter la synchronisation ou supprimer ces données du compte à tout moment (Mon compte → Données).</p>
        <div className="ts-row spread" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={() => choose(null)}>Plus tard</button>
          <div className="ts-row"><button type="button" className="btn" onClick={() => choose(false)}>Ne pas synchroniser</button><button type="button" className="btn primary" onClick={() => choose(true)}>Synchroniser</button></div>
        </div>
      </div>
    </div>
  );
}
