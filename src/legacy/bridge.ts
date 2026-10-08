import type { PrefsPatch } from '../lib/types';

export type HubState = {
  wallet: { name: string; pk: string; session: boolean; locked: boolean } | null;
  /** wallet externe connecté (Phantom…) et wallet rapide du studio */
  ext: { id: string; name: string; pk: string; bal: number | null } | null;
  quick: { pk: string; active: boolean; unlocked: boolean; bal: number | null } | null;
  quickSaved: { pk: string; unlocked: boolean } | null;
  srv: { pk: string; active: boolean; bal: number | null } | null;
  hasSession: boolean; bal: number | null; solUsd: number | null; sim: boolean; rpcOk: boolean | null; theme: string; depth: string;
  demo: { bal: number; positions: number };
};
/** Wallet démo : solde fictif, tokens détenus (démo ou vrais tokens à prix réel) et activité */
export type DemoInfo = {
  addr: string; bal: number; solUsd: number | null;
  hold: { mint: string; symbol: string; image: string; amount: number; sol: number | null; demo: boolean }[];
  acts: { t: number; type: string; symbol: string; sol: number; tokens: number }[];
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
    signOut: () => Promise<void>;
    walletAction: (a: string) => void;
    connect: (id: string) => Promise<string | null>;
    quickCreate: () => Promise<string | undefined>;
    quickRestore: () => Promise<string | undefined>;
    quickUnlock: () => Promise<boolean>;
    quickLock: () => void;
    legacyMigrate: () => Promise<void>;
    legacyExport: () => Promise<void>;
    legacyForget: () => Promise<void>;
    legacyDrop: () => void;
    quickKeypair: () => Keypair | null;
    useQuick: (on: boolean) => Promise<void>;
    useServer: (on: boolean) => Promise<void>;
    useExt: () => Promise<void>;
    setServer: (pk: string | null) => void;
    setAuth: (on: boolean) => void;
    authed: () => boolean;
    demoReset: () => void;
    demoInfo: () => DemoInfo;
    demoMove: (kind: 'deposit' | 'withdraw') => Promise<void>;
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
