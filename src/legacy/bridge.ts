import type { PrefsPatch } from '../lib/types';

// Accès typé au studio historique (window.PumpStudio), le temps de migrer ses pages vers React.
type LegacyStudio = {
  setPage: (p: string) => void;
  toast: (title: string, text?: string, kind?: 'g' | 'a' | 'r' | '') => void;
  prefs?: { get: () => PrefsPatch; apply: (p: PrefsPatch) => void };
};

declare global {
  interface Window {
    PumpStudio?: LegacyStudio;
  }
}

export const studio = () => window.PumpStudio;
export const toast = (title: string, text?: string, kind: 'g' | 'a' | 'r' | '' = 'g') => studio()?.toast(title, text, kind);
export const goTo = (page: string) => studio()?.setPage(page);
