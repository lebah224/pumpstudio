import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Preferences, PrefsPatch, Profile } from '../lib/types';
import { studio, toast } from '../legacy/bridge';
import { useAuth } from '../auth/AuthContext';

const PREF_KEYS: (keyof PrefsPatch)[] = ['ui_theme', 'ui_depth', 'sim_mode', 'slippage_pct', 'max_buy_sol', 'priority', 'dev_max_pct', 'studio_universe', 'studio_tone', 'studio_lang'];

/** Ne garde que des valeurs acceptées par la base (les contraintes sont aussi vérifiées côté serveur) */
export function cleanPrefs(p: PrefsPatch): PrefsPatch {
  const out: PrefsPatch = {};
  for (const k of PREF_KEYS) if (p[k] !== undefined && p[k] !== null) (out as Record<string, unknown>)[k] = p[k];
  if (out.slippage_pct != null) out.slippage_pct = Math.min(50, Math.max(0.1, Number(out.slippage_pct)));
  if (out.max_buy_sol != null) out.max_buy_sol = Math.min(100, Math.max(0.0001, Number(out.max_buy_sol)));
  if (out.dev_max_pct != null) out.dev_max_pct = Math.min(100, Math.max(0, Number(out.dev_max_pct)));
  if (out.priority && !['eco', 'fast', 'turbo', 'manual'].includes(out.priority)) delete out.priority;
  if (out.studio_universe && !['meme', 'internet', 'luxe', 'space', 'tech', 'gaming'].includes(out.studio_universe)) delete out.studio_universe;
  return out;
}

export async function savePrefs(userId: string, patch: PrefsPatch) {
  const p = cleanPrefs(patch);
  if (!Object.keys(p).length) return null;
  const { data, error } = await supabase.from('preferences').update(p).eq('user_id', userId).select().single();
  if (error) throw error;
  return data as Preferences;
}

/**
 * Synchronisation des préférences :
 * - première connexion : les réglages de ce navigateur deviennent ceux du compte ;
 * - connexions suivantes : les réglages du compte s'appliquent au studio ;
 * - ensuite, chaque changement fait dans le studio (palette, réglages) est enregistré sur le compte.
 */
export function usePrefsSync() {
  const { user, needsMfa } = useAuth();
  const ready = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    ready.current = false;
    if (!user || needsMfa) return;
    let cancelled = false;
    (async () => {
      const [{ data: prof }, { data: prefs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single<Profile>(),
        supabase.from('preferences').select('*').eq('user_id', user.id).single<Preferences>(),
      ]);
      if (cancelled || !prof || !prefs) return;
      const st = studio();
      if (!prof.onboarded) {
        const local = st?.prefs?.get();
        if (local) { try { await savePrefs(user.id, local); } catch { /* valeurs locales hors limites : on garde celles du compte */ } }
        await supabase.from('profiles').update({ onboarded: true }).eq('id', user.id);
        toast('Compte prêt', 'Tes réglages de ce navigateur sont maintenant enregistrés sur ton compte.');
      } else {
        st?.prefs?.apply(prefs);
      }
      ready.current = true;
    })();
    return () => { cancelled = true; };
  }, [user, needsMfa]);

  useEffect(() => {
    if (!user) return;
    const push = () => {
      if (!ready.current) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const local = studio()?.prefs?.get();
        if (local) savePrefs(user.id, local).catch(() => toast('Synchronisation impossible', 'Les réglages restent enregistrés dans ce navigateur.', 'a'));
      }, 800);
    };
    const onTheme = (e: Event) => { const o = (e as CustomEvent).detail?.origin; if (o === 'user') push(); };
    window.addEventListener('pstudio-theme', onTheme);
    window.addEventListener('pstudio-cfg', push);
    return () => { window.removeEventListener('pstudio-theme', onTheme); window.removeEventListener('pstudio-cfg', push); window.clearTimeout(timer.current); };
  }, [user]);
}
