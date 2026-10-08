import type { PrefsPatch } from '../lib/types';

// Accès typé au studio historique (window.PumpStudio), le temps de migrer ses pages vers React.
type LegacyStudio = {
  setPage: (p: string) => void;
  toast: (title: string, text?: string, kind?: 'g' | 'a' | 'r' | '') => void;
  prefs?: { get: () => PrefsPatch; apply: (p: PrefsPatch) => void };
  hub?: {
    state: () => {
      wallet: { name: string; pk: string; session: boolean; locked: boolean } | null;
      hasSession: boolean; bal: number | null; solUsd: number | null; sim: boolean; rpcOk: boolean | null; theme: string; depth: string;
    };
    avatar: (pk: string, cls?: string) => string;
    walletMenu: () => void;
    walletPanel: () => void;
    disconnect: () => void;
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
