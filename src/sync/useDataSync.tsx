import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthContext';
import { claimBrowser, pushSoon, setStatus, syncNow, syncStore } from './dataSync';

export const useSyncStatus = () => useSyncExternalStore(syncStore.subscribe, syncStore.get);

const LABELS: Record<string, string> = { tokens: 'tokens', operations: 'opérations du journal', orders: 'ordres', distributions: 'demandes de référencement', drafts: 'brouillon', bot_strategies: 'stratégies du bot', bot_trades: 'trades du bot' };
export const syncLabel = (k: string) => LABELS[k] ?? k;

/**
 * Sauvegarde automatique sur le compte, sans réglage :
 * à la connexion, les données du compte sont chargées ; chaque changement est enregistré quelques secondes après ;
 * l'outil se remet à jour régulièrement (autres appareils).
 */
export function useDataSync() {
  const { user, needsMfa } = useAuth();
  const timer = useRef<number | undefined>(undefined);
  const uid = user && !needsMfa ? user.id : null;

  useEffect(() => {
    if (!uid) return;
    claimBrowser(uid);
    setStatus({ userId: uid, enabled: true, error: null });
    syncNow(uid);
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') syncNow(uid); }, 60000);
    return () => window.clearInterval(id);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const later = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => pushSoon(uid), 2000); };
    const onVisible = () => { if (document.visibilityState === 'visible') syncNow(uid); else pushSoon(uid); };
    window.addEventListener('pstudio-data', later); window.addEventListener('pstudio-bot', later); document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('pstudio-data', later); window.removeEventListener('pstudio-bot', later); document.removeEventListener('visibilitychange', onVisible); window.clearTimeout(timer.current); };
  }, [uid]);

  return null;
}
