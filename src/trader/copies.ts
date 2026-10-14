import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Rule } from './strategies';

// Copie des achats d'un acheteur suivi : une règle par wallet copié, exécutée par le serveur dès qu'un de ses achats
// est confirmé (même outil fermé) ; stratégie de sortie attachée, revente quand il revend (au choix).

export type CopyFilters = { min_sol?: number; max_sol?: number; mcap_max?: number };
export type Copy = {
  id: string; trader: string; wallet: string; enabled: boolean; amount_sol: number; slippage: number; priority: number; max_per_day: number;
  filters: CopyFilters; copy_sells: boolean; exit_rules: Rule[] | null; exit_slippage: number; fired_count: number; last_fired_at: string | null;
};
export type CopyRun = {
  id: string; copy_id: string | null; trader: string; mint: string; symbol: string | null; status: 'pending' | 'sent' | 'bought' | 'failed' | 'skipped' | 'sold';
  reason: string | null; trader_sol: number | null; amount_sol: number | null; sol: number | null; tokens: number | null; signature: string | null;
  send_ms: number | null; sold_sol: number | null; created_at: string;
};

const COLS = 'id,trader,wallet,enabled,amount_sol,slippage,priority,max_per_day,filters,copy_sells,exit_rules,exit_slippage,fired_count,last_fired_at';
const bus = () => window.dispatchEvent(new Event('ts-copies'));
const num = (r: Record<string, unknown>) => ({ ...r, amount_sol: Number(r.amount_sol), slippage: Number(r.slippage), priority: Number(r.priority), exit_slippage: Number(r.exit_slippage) }) as Copy;

export async function saveCopy(c: Omit<Copy, 'id' | 'fired_count' | 'last_fired_at'>, id?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Connectez-vous pour copier un wallet.');
  const row = { wallet: c.wallet, enabled: c.enabled, amount_sol: c.amount_sol, slippage: c.slippage, priority: c.priority, max_per_day: c.max_per_day,
    filters: c.filters, copy_sells: c.copy_sells, exit_rules: c.exit_rules, exit_slippage: c.exit_slippage };
  const { error } = id ? await supabase.from('copies').update(row).eq('id', id) : await supabase.from('copies').insert({ ...row, user_id: user.id, trader: c.trader });
  if (error) throw new Error(/duplicate|unique/.test(error.message) ? 'Une copie existe déjà pour ce wallet : modifiez-la.' : /row-level security/i.test(error.message) ? 'Wallet rapide introuvable, ou 30 copies au plus.' : error.message);
  bus();
}
export async function setCopyEnabled(id: string, enabled: boolean) {
  const { error } = await supabase.from('copies').update({ enabled }).eq('id', id);
  if (error) throw error;
  bus();
}
export async function removeCopy(id: string) {
  const { error } = await supabase.from('copies').delete().eq('id', id);
  if (error) throw error;
  bus();
}

/** Règles de copie du compte, tenues à jour */
export function useCopies() {
  const [list, setList] = useState<Copy[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('copies').select(COLS).order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setList(((data ?? []) as Record<string, unknown>[]).map(num)); });
    load();
    const ch = supabase.channel('copies-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: '*', schema: 'public', table: 'copies' }, load).subscribe();
    window.addEventListener('ts-copies', load);
    return () => { alive = false; window.removeEventListener('ts-copies', load); supabase.removeChannel(ch); };
  }, []);
  return list;
}
/** Journal des copies, en temps réel */
export function useCopyRuns() {
  const [list, setList] = useState<CopyRun[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('copy_runs').select('id,copy_id,trader,mint,symbol,status,reason,trader_sol,amount_sol,sol,tokens,signature,send_ms,sold_sol,created_at')
      .order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => { if (alive) setList(((data ?? []) as CopyRun[]).map((r) => ({ ...r, sol: r.sol == null ? null : Number(r.sol), sold_sol: r.sold_sol == null ? null : Number(r.sold_sol), trader_sol: r.trader_sol == null ? null : Number(r.trader_sol), amount_sol: r.amount_sol == null ? null : Number(r.amount_sol) }))); });
    load();
    const ch = supabase.channel('copy-runs-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: '*', schema: 'public', table: 'copy_runs' }, load).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);
  return list;
}

const nf = (v: number, d = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
/** Filtres en phrases courtes, pour le résumé */
export function copyFilterTexts(F: CopyFilters): string[] {
  const out: string[] = [];
  if (F.min_sol != null && F.max_sol != null) out.push('il engage entre ' + nf(F.min_sol) + ' et ' + nf(F.max_sol) + ' SOL');
  else if (F.min_sol != null) out.push('il engage au moins ' + nf(F.min_sol) + ' SOL');
  else if (F.max_sol != null) out.push('il engage au plus ' + nf(F.max_sol) + ' SOL');
  if (F.mcap_max != null) out.push('capitalisation ≤ ' + nf(F.mcap_max, 1) + ' SOL');
  return out;
}
