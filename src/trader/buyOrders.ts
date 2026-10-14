import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Rule } from './strategies';

// Achats programmés sur un token : conditions combinables évaluées par le serveur à chaque transaction du token,
// achat avec le wallet rapide choisi (même outil fermé), stratégie de sortie attachée à la confirmation.

export type BuyCondKind = 'mcap_below' | 'mcap_above' | 'dip' | 'buys' | 'buy_sol';
export type BuyCond = { k: BuyCondKind; v: number; w?: number };
export type BuyOrder = {
  id: string; mint: string; symbol: string | null; creator: string | null; wallet: string; amount_sol: number; slippage: number; priority: number;
  conds: BuyCond[]; cancel_on_creator_sell: boolean; expires_at: string; exit_rules: Rule[] | null; exit_slippage: number;
  status: 'active' | 'paused' | 'firing' | 'done' | 'failed' | 'expired' | 'cancelled'; created_at: string;
  state: { peak?: number; reason?: string; signature?: string; sol?: number; tokens?: number; send_ms?: number; strategy_id?: string | null; at?: number };
};

/** conditions : libellés, unités, valeurs par défaut ; w = fenêtre de temps en secondes */
export const BUY_CONDS: Record<BuyCondKind, { l: string; unit: string; def: number; win?: number; hint: string }> = {
  mcap_below: { l: 'Capitalisation descend sous', unit: '$', def: 20000, hint: 'Achat sur repli : la capitalisation passe sous ce montant.' },
  mcap_above: { l: 'Capitalisation dépasse', unit: '$', def: 60000, hint: 'Achat sur cassure : la capitalisation franchit ce montant.' },
  dip: { l: 'Recul depuis le plus haut', unit: '%', def: 30, hint: 'Le prix redescend de ce pourcentage depuis le plus haut relevé après la création de l\'ordre.' },
  buys: { l: 'Achats des autres', unit: 'achats', def: 5, win: 60, hint: 'Confirmation de l\'élan : au moins ce nombre d\'achats d\'autres wallets sur la période.' },
  buy_sol: { l: 'SOL achetés par les autres', unit: 'SOL', def: 3, win: 60, hint: 'Confirmation par le volume : au moins ce montant acheté par d\'autres wallets sur la période.' },
};
export const BUY_ORDER: BuyCondKind[] = ['mcap_below', 'mcap_above', 'dip', 'buys', 'buy_sol'];
export const WINDOWS = [30, 60, 120, 300];
export const EXPIRIES: { h: number; l: string }[] = [{ h: 1, l: '1 h' }, { h: 6, l: '6 h' }, { h: 24, l: '24 h' }, { h: 72, l: '3 j' }, { h: 168, l: '7 j' }];

const nf = (v: number, d = 2) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
const win = (w?: number) => { const s = w ?? 60; return s >= 60 && s % 60 === 0 ? (s === 60 ? '1 min' : s / 60 + ' min') : s + ' s'; };
export function buyCondText(c: BuyCond) {
  switch (c.k) {
    case 'mcap_below': return 'capitalisation ≤ ' + nf(c.v, 0) + ' $';
    case 'mcap_above': return 'capitalisation ≥ ' + nf(c.v, 0) + ' $';
    case 'dip': return 'recul ≥ ' + nf(c.v, 1) + ' % depuis le plus haut';
    case 'buys': return nf(c.v, 0) + ' achats des autres en ' + win(c.w);
    case 'buy_sol': return nf(c.v) + ' SOL achetés par les autres en ' + win(c.w);
  }
}

const COLS = 'id,mint,symbol,creator,wallet,amount_sol,slippage,priority,conds,cancel_on_creator_sell,expires_at,exit_rules,exit_slippage,status,state,created_at';
const bus = () => window.dispatchEvent(new Event('ts-buyorders'));
const num = (r: Record<string, unknown>) => ({ ...r, amount_sol: Number(r.amount_sol), slippage: Number(r.slippage), priority: Number(r.priority), exit_slippage: Number(r.exit_slippage) }) as BuyOrder;

export type BuyOrderInput = Pick<BuyOrder, 'mint' | 'symbol' | 'creator' | 'wallet' | 'amount_sol' | 'slippage' | 'priority' | 'conds' | 'cancel_on_creator_sell' | 'expires_at' | 'exit_rules' | 'exit_slippage'>;
export async function saveBuyOrder(o: BuyOrderInput, id?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Connectez-vous pour programmer un achat.');
  const row = { wallet: o.wallet, amount_sol: o.amount_sol, slippage: o.slippage, priority: o.priority, conds: o.conds, cancel_on_creator_sell: o.cancel_on_creator_sell, expires_at: o.expires_at, exit_rules: o.exit_rules, exit_slippage: o.exit_slippage };
  const { error } = id ? await supabase.from('buy_orders').update(row).eq('id', id)
    : await supabase.from('buy_orders').insert({ ...row, user_id: user.id, mint: o.mint, symbol: o.symbol?.slice(0, 32) ?? null, creator: o.creator });
  if (error) throw new Error(/row-level security/i.test(error.message) ? 'Wallet rapide introuvable, ou 50 achats programmés en cours au plus.' : /expires_at/.test(error.message) ? 'Durée de validité : 7 jours au plus.' : error.message);
  bus();
}
export async function setBuyOrderStatus(id: string, status: 'active' | 'paused' | 'cancelled') {
  const { error } = await supabase.from('buy_orders').update({ status }).eq('id', id);
  if (error) throw error;
  bus();
}
export async function removeBuyOrder(id: string) {
  const { error } = await supabase.from('buy_orders').delete().eq('id', id);
  if (error) throw error;
  bus();
}

/** Achats programmés du compte, tenus à jour en temps réel (exécutions par le serveur) */
export function useBuyOrders() {
  const [list, setList] = useState<BuyOrder[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('buy_orders').select(COLS).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { if (alive) setList(((data ?? []) as Record<string, unknown>[]).map(num)); });
    load();
    const ch = supabase.channel('buy-orders-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: '*', schema: 'public', table: 'buy_orders' }, load).subscribe();
    window.addEventListener('ts-buyorders', load);
    const t = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => { alive = false; clearInterval(t); window.removeEventListener('ts-buyorders', load); supabase.removeChannel(ch); };
  }, []);
  return list;
}
