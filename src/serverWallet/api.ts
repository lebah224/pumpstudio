import { useSyncExternalStore } from 'react';
import { invokeSecure } from '../security/stepUp';
import { studio } from '../legacy/bridge';

// Wallets rapides du compte (n°1, n°2…) : leurs clés restent sur le serveur (chiffrées) ; le navigateur envoie des
// transactions à signer, le serveur applique sa politique (programmes de trading seulement, plafonds) puis signe.
// Un seul mot de passe protège tous les wallets rapides du compte.

export type SrvWallet = { address: string; num: number; daily_cap_sol: number; alert_balance_sol: number; spent_today: number };
/** address : wallet rapide actif (celui qui signe), wallets : tous, dans l'ordre de création */
export type SrvStatus = { address: string | null; wallets: SrvWallet[]; hasPassword: boolean; locked?: boolean; daily_cap_sol?: number; alert_balance_sol?: number; spent_today?: number };

const call = <T,>(action: string, body: Record<string, unknown> = {}): Promise<T> => invokeSecure<T>('server-wallet', { action, ...body });

/* ---------- wallet actif, choisi sur cet appareil ---------- */
const ACTIVE = 'ts_srv_active';
const getActive = () => { try { return localStorage.getItem(ACTIVE); } catch { return null; } };
const putActive = (a: string | null) => { try { if (a) localStorage.setItem(ACTIVE, a); else localStorage.removeItem(ACTIVE); } catch { /* navigation privée */ } };

/* ---------- état partagé (menu, portefeuille, studio) ---------- */
let state: SrvStatus | null = null;
const subs = new Set<() => void>();
function setState(s: SrvStatus | null) {
  if (s) {
    const want = getActive(), w = s.wallets.find((x) => x.address === want) ?? s.wallets[0] ?? null;
    s = { ...s, address: w?.address ?? null, daily_cap_sol: w?.daily_cap_sol, alert_balance_sol: w?.alert_balance_sol, spent_today: w?.spent_today };
  }
  state = s; subs.forEach((f) => f()); syncLegacy();
}
export const srvStore = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); } };
export const useServerWallet = () => useSyncExternalStore(srvStore.subscribe, srvStore.get);
export const srvLabel = (w: { num: number }) => 'Wallet rapide n°' + w.num;
export const srvByAddress = (a: string | null | undefined) => state?.wallets.find((w) => w.address === a) ?? null;

declare global { interface Window {
  TSServerWallet?: { pk: string; wallets: { address: string; num: number }[]; signSend: (tx: string, address?: string) => Promise<{ signature: string; raw: string }> };
  TSServerWalletImport?: (password: string | null, secret: string) => Promise<string>;
} }
/** Le studio historique signe via le serveur avec le wallet rapide actif, ou celui choisi pour une opération */
function syncLegacy() {
  const pk = state?.address ?? null;
  if (pk) window.TSServerWallet = { pk, wallets: state!.wallets.map((w) => ({ address: w.address, num: w.num })), signSend: (tx, address) => call('sign_send', { tx, address: address ?? pk }) };
  else delete window.TSServerWallet;
  studio()?.hub?.setServer(pk);
}

export async function refreshServerWallet() {
  try { setState(await call<SrvStatus>('status')); } catch { setState({ address: null, wallets: [], hasPassword: false }); }
}
export function clearServerWallet() { setState(null); }
/** Choisit le wallet rapide qui signe sur cet appareil */
export async function selectServerWallet(address: string) {
  putActive(address);
  if (state) setState({ ...state });
  await studio()?.hub?.useServer(true);
}

export async function createServerWallet(password: string) { const r = await call<{ address: string; num: number }>('create', { password }); await refreshServerWallet(); return r; }
export async function importServerWallet(password: string, secret: string) { const r = await call<{ address: string; num: number }>('import', { password, secret }); await refreshServerWallet(); return r; }
// le studio place l'ancien wallet rapide du navigateur sur le serveur
window.TSServerWalletImport = async (password, secret) => (await importServerWallet(password ?? '', secret)).address;
export async function withdrawServerWallet(address: string, password: string, to: string, amount: number | 'max') { return call<{ signature: string; sol: number }>('withdraw', { address, password, to, amount }); }
export async function exportServerWallet(address: string, password: string) { return (await call<{ secret: string }>('export', { address, password })).secret; }
export async function setServerLimits(address: string, password: string, daily_cap_sol: number, alert_balance_sol: number) { await call('limits', { address, password, daily_cap_sol, alert_balance_sol }); await refreshServerWallet(); }
export async function deleteServerWallet(address: string, password: string, force = false) {
  await call('delete', { address, password, force });
  if (getActive() === address) putActive(null);
  await refreshServerWallet();
  if (!state?.address) studio()?.hub?.useServer(false);
}
