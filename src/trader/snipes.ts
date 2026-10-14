import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Rule } from './strategies';

// Achat automatique au lancement d'un créateur suivi : une règle par créateur, exécutée par le serveur dès l'avis de
// création (même outil fermé), avec la stratégie de sortie attachée une fois l'achat confirmé.

export type SnipeFilters = { dev_min?: number; dev_max?: number; dev_pct?: number; mcap_max?: number; gap_min?: number };
export type Snipe = {
  id: string; creator: string; wallet: string; enabled: boolean; mode: 'next' | 'every'; amount_sol: number; slippage: number; priority: number;
  max_per_day: number; filters: SnipeFilters; exit_rules: Rule[] | null; exit_slippage: number; fired_count: number; last_fired_at: string | null;
};
export type SnipeRun = {
  id: string; snipe_id: string | null; creator: string; mint: string; symbol: string | null; status: 'pending' | 'sent' | 'bought' | 'failed' | 'skipped';
  reason: string | null; amount_sol: number | null; sol: number | null; tokens: number | null; signature: string | null; send_ms: number | null; strategy_id: string | null; created_at: string;
};

/** vitesse = frais de priorité (SOL) ; plus ils sont élevés, plus la transaction passe tôt dans le bloc */
export const SPEEDS = [
  { v: 0.001, l: 'Normale' },
  { v: 0.003, l: 'Rapide' },
  { v: 0.006, l: 'Turbo' },
];

const COLS = 'id,creator,wallet,enabled,mode,amount_sol,slippage,priority,max_per_day,filters,exit_rules,exit_slippage,fired_count,last_fired_at';
const bus = () => window.dispatchEvent(new Event('ts-snipes'));
const num = (r: Record<string, unknown>) => ({ ...r, amount_sol: Number(r.amount_sol), slippage: Number(r.slippage), priority: Number(r.priority), exit_slippage: Number(r.exit_slippage) }) as Snipe;

export async function saveSnipe(s: Omit<Snipe, 'id' | 'fired_count' | 'last_fired_at'>, id?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Connectez-vous pour activer un achat automatique.');
  const row = { wallet: s.wallet, enabled: s.enabled, mode: s.mode, amount_sol: s.amount_sol, slippage: s.slippage, priority: s.priority, max_per_day: s.max_per_day, filters: s.filters, exit_rules: s.exit_rules, exit_slippage: s.exit_slippage };
  const { error } = id ? await supabase.from('snipes').update(row).eq('id', id) : await supabase.from('snipes').insert({ ...row, user_id: user.id, creator: s.creator });
  if (error) throw new Error(/duplicate|unique/.test(error.message) ? 'Un achat automatique existe déjà pour ce créateur : modifiez-le.' : /row-level|policy/.test(error.message) ? 'Wallet rapide introuvable, ou 50 achats automatiques au plus.' : error.message);
  bus();
}
export async function setSnipeEnabled(id: string, enabled: boolean) {
  const { error } = await supabase.from('snipes').update({ enabled }).eq('id', id);
  if (error) throw error;
  bus();
}
export async function removeSnipe(id: string) {
  const { error } = await supabase.from('snipes').delete().eq('id', id);
  if (error) throw error;
  bus();
}

/** Règles du compte, tenues à jour (une règle « prochain lancement » se coupe seule après l'achat) */
export function useSnipes() {
  const [list, setList] = useState<Snipe[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('snipes').select(COLS).order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setList(((data ?? []) as Record<string, unknown>[]).map(num)); });
    load();
    const ch = supabase.channel('snipes-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: '*', schema: 'public', table: 'snipes' }, load).subscribe();
    window.addEventListener('ts-snipes', load);
    return () => { alive = false; window.removeEventListener('ts-snipes', load); supabase.removeChannel(ch); };
  }, []);
  return list;
}
/** Journal des tentatives, en temps réel */
export function useSnipeRuns() {
  const [list, setList] = useState<SnipeRun[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('snipe_runs').select('id,snipe_id,creator,mint,symbol,status,reason,amount_sol,sol,tokens,signature,send_ms,strategy_id,created_at')
      .order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => { if (alive) setList((data ?? []) as SnipeRun[]); });
    load();
    const ch = supabase.channel('snipe-runs-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: '*', schema: 'public', table: 'snipe_runs' }, load).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);
  return list;
}

const nf = (v: number, d = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
/** Filtres en phrases courtes, pour le résumé */
export function filterTexts(F: SnipeFilters): string[] {
  const out: string[] = [];
  if (F.dev_min != null && F.dev_max != null) out.push('achat du créateur entre ' + nf(F.dev_min) + ' et ' + nf(F.dev_max) + ' SOL');
  else if (F.dev_min != null) out.push('achat du créateur ≥ ' + nf(F.dev_min) + ' SOL');
  else if (F.dev_max != null) out.push('achat du créateur ≤ ' + nf(F.dev_max) + ' SOL');
  if (F.dev_pct != null) out.push('créateur ≤ ' + nf(F.dev_pct, 1) + ' % des tokens');
  if (F.mcap_max != null) out.push('capitalisation ≤ ' + nf(F.mcap_max, 1) + ' SOL');
  if (F.gap_min != null) out.push('pas d\'autre lancement de sa part depuis ' + nf(F.gap_min, 0) + ' min');
  return out;
}
