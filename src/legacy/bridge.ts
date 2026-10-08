import type { PrefsPatch } from '../lib/types';

export type HubState = {
  wallet: { name: string; pk: string; session: boolean; locked: boolean } | null;
  /** wallet externe connecté (Phantom…) et wallet rapide du studio */
  ext: { id: string; name: string; pk: string; bal: number | null } | null;
  quick: { pk: string; active: boolean; unlocked: boolean; bal: number | null } | null;
  hasSession: boolean; bal: number | null; solUsd: number | null; sim: boolean; rpcOk: boolean | null; theme: string; depth: string;
};
type Keypair = { publicKey: { toBase58: () => string }; secretKey: Uint8Array };

// Accès typé au studio historique (window.PumpStudio), le temps de migrer ses pages vers React.
type LegacyStudio = {
  setPage: (p: string) => void;
  toast: (title: string, text?: string, kind?: 'g' | 'a' | 'r' | '') => void;
  prefs?: { get: () => PrefsPatch; apply: (p: PrefsPatch) => void };
  hub?: {
    state: () => HubState;
    avatar: (pk: string, cls?: string) => string;
    walletMenu: () => void;
    walletPanel: () => void;
    disconnect: () => Promise<void>;
    walletAction: (a: string) => void;
    connect: (id: string) => Promise<string | null>;
    quickCreate: () => Promise<string | undefined>;
    quickRestore: () => Promise<string | undefined>;
    quickUnlock: () => Promise<boolean>;
    quickLock: () => void;
    quickKeypair: () => Keypair | null;
    useQuick: (on: boolean) => Promise<void>;
    setAuth: (on: boolean) => void;
    rpc: <T = any>(method: string, params: unknown[]) => Promise<T>;
    page: () => string;
    copyAddress: () => void;
    appearance: () => void;
    goReal: () => void;
    goSim: () => void;
  };
};

declare global {
  interface Window {
    PumpStudio?: LegacyStudio;
  }
}

export const studio = () => window.PumpStudio;
export const toast = (title: string, text?: string, kind: 'g' | 'a' | 'r' | '' = 'g') => studio()?.toast(title, text, kind);
export const goTo = (page: string) => studio()?.setPage(page);
