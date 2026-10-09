import { useSyncExternalStore } from 'react';
import { invokeSecure } from '../security/stepUp';
import { studio } from '../legacy/bridge';

// Wallet rapide serveur : la clé reste sur le serveur (chiffrée) ; le navigateur envoie des transactions à signer,
// le serveur applique sa politique (programmes de trading seulement, plafonds) puis signe et envoie.

export type SrvStatus = { address: string | null; daily_cap_sol?: number; alert_balance_sol?: number; spent_today?: number; locked?: boolean };

// retrait, export, hausse du plafond, suppression : le serveur peut demander un code de confirmation (fenêtre dédiée)
const call = <T,>(action: string, body: Record<string, unknown> = {}): Promise<T> => invokeSecure<T>('server-wallet', { action, ...body });

/* ---------- état partagé (menu, portefeuille, studio) ---------- */
let state: SrvStatus | null = null;
const subs = new Set<() => void>();
const setState = (s: SrvStatus | null) => { state = s; subs.forEach((f) => f()); syncLegacy(); };
export const srvStore = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); } };
export const useServerWallet = () => useSyncExternalStore(srvStore.subscribe, srvStore.get);

declare global { interface Window {
  TSServerWallet?: { pk: string; signSend: (tx: string) => Promise<{ signature: string; raw: string }> };
  TSServerWalletImport?: (password: string | null, secret: string) => Promise<string>;
} }
/** Le studio historique signe via le serveur quand le wallet serveur est choisi */
function syncLegacy() {
  const pk = state?.address ?? null;
  if (pk) window.TSServerWallet = { pk, signSend: (tx) => call('sign_send', { tx }) };
  else delete window.TSServerWallet;
  studio()?.hub?.setServer(pk);
}

export async function refreshServerWallet() {
  try { setState(await call<SrvStatus>('status')); } catch { setState({ address: null }); }
}
export function clearServerWallet() { setState(null); }

export async function createServerWallet(password: string) { const r = await call<{ address: string }>('create', { password }); await refreshServerWallet(); return r.address; }
export async function importServerWallet(password: string, secret: string) { const r = await call<{ address: string }>('import', { password, secret }); await refreshServerWallet(); return r.address; }
// le studio place l'ancien wallet rapide du navigateur sur le serveur avec son propre mot de passe
window.TSServerWalletImport = (password, secret) => importServerWallet(password ?? '', secret);
export async function withdrawServerWallet(password: string, to: string, amount: number | 'max') { return call<{ signature: string; sol: number }>('withdraw', { password, to, amount }); }
export async function exportServerWallet(password: string) { return (await call<{ secret: string }>('export', { password })).secret; }
export async function setServerLimits(password: string, daily_cap_sol: number, alert_balance_sol: number) { await call('limits', { password, daily_cap_sol, alert_balance_sol }); await refreshServerWallet(); }
export async function deleteServerWallet(password: string, force = false) { await call('delete', { password, force }); studio()?.hub?.useServer(false); setState({ address: null }); }
