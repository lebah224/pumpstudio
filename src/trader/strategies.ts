import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { studio } from '../legacy/bridge';

// Stratégies de sortie : règles de vente appliquées par le serveur (toutes les 5 s), même outil fermé.

export type CondKind = 'gain' | 'loss' | 'trail' | 'buys' | 'sells' | 'sell_sol' | 'creator_sell' | 'age' | 'mcap';
export type Cond = { k: CondKind; v?: number; arm?: number };
export type Rule = { id: string; all: Cond[]; sell: number };
export type Seen = { at: number; price: number | null; mcapUsd: number | null; buys: number; sells: number; sellSol: number; creatorSold: boolean; capped?: boolean };
export type Strategy = {
  id: string; mint: string; symbol: string | null; name: string | null; wallet: string | null; creator: string | null;
  entry_at: string; entry_price: number | null; entry_tokens: number | null; entry_sol: number | null; slippage: number;
  rules: Rule[]; status: 'active' | 'paused' | 'done' | 'error'; created_at: string;
  state: { fired?: string[]; peak?: number; ref?: number; seen?: Seen; fails?: number; last_error?: string; end?: string;
    log?: { t: number; rule: string; ok: boolean; msg: string; sig?: string; sol?: number }[] };
};

/* ---------- conditions : libellés, unités, valeurs par défaut ---------- */
export const CONDS: Record<CondKind, { l: string; short: string; unit: string; def: number; step: number; min: number; max: number; hint: string; noValue?: boolean }> = {
  gain: { l: 'Gain atteint', short: 'Gain', unit: '%', def: 50, step: 5, min: 1, max: 10000, hint: 'Le prix dépasse votre prix d\'achat de ce pourcentage.' },
  loss: { l: 'Perte atteinte', short: 'Perte', unit: '%', def: 25, step: 5, min: 1, max: 99, hint: 'Le prix passe sous votre prix d\'achat de ce pourcentage.' },
  trail: { l: 'Recul depuis le plus haut', short: 'Recul', unit: '%', def: 20, step: 5, min: 1, max: 99, hint: 'Le prix redescend de ce pourcentage depuis le plus haut atteint après votre achat.' },
  buys: { l: 'Achats des autres après le mien', short: 'Achats après', unit: 'achats', def: 2, step: 1, min: 1, max: 100, hint: 'Nombre d\'achats d\'autres wallets depuis votre achat.' },
  sells: { l: 'Ventes des autres après mon achat', short: 'Ventes après', unit: 'ventes', def: 2, step: 1, min: 1, max: 100, hint: 'Nombre de ventes d\'autres wallets depuis votre achat.' },
  sell_sol: { l: 'SOL vendus par les autres', short: 'SOL vendus', unit: 'SOL', def: 1, step: 0.5, min: 0.01, max: 10000, hint: 'Total vendu par les autres wallets depuis votre achat.' },
  creator_sell: { l: 'Le créateur vend', short: 'Créateur vend', unit: '', def: 0, step: 1, min: 0, max: 0, hint: 'Le wallet qui a créé le token vend, même un peu.', noValue: true },
  age: { l: 'Temps écoulé', short: 'Temps', unit: 'min', def: 10, step: 1, min: 1, max: 10080, hint: 'Minutes depuis votre achat.' },
  mcap: { l: 'Capitalisation atteinte', short: 'Capi.', unit: '$', def: 50000, step: 5000, min: 1000, max: 1e9, hint: 'La capitalisation du token dépasse ce montant en dollars.' },
};
export const COND_ORDER: CondKind[] = ['gain', 'loss', 'trail', 'buys', 'sells', 'sell_sol', 'creator_sell', 'age', 'mcap'];

const nf = (v: number, d = 2) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
export function condText(c: Cond) {
  const v = Number(c.v) || 0;
  switch (c.k) {
    case 'gain': return 'gain ≥ +' + nf(v, 1) + ' %';
    case 'loss': return 'perte ≥ −' + nf(v, 1) + ' %';
    case 'trail': return 'recul ≥ ' + nf(v, 1) + ' % depuis le plus haut' + (c.arm ? ' (après +' + nf(c.arm, 1) + ' %)' : '');
    case 'buys': return nf(v, 0) + ' achat' + (v > 1 ? 's' : '') + ' après le mien';
    case 'sells': return nf(v, 0) + ' vente' + (v > 1 ? 's' : '') + ' après mon achat';
    case 'sell_sol': return nf(v) + ' SOL vendus par les autres';
    case 'creator_sell': return 'le créateur vend';
    case 'age': return v >= 60 && v % 60 === 0 ? nf(v / 60, 0) + ' h écoulée' + (v > 60 ? 's' : '') : nf(v, 0) + ' min écoulées';
    case 'mcap': return 'capitalisation ≥ ' + nf(v, 0) + ' $';
  }
}
export const sellText = (p: number) => (p >= 100 ? 'vendre tout' : 'vendre ' + nf(p, 0) + ' %');
export const ruleText = (r: Rule) => 'Si ' + r.all.map(condText).join(' et ') + ' → ' + sellText(r.sell);

/* ---------- modèles ---------- */
const rid = () => Math.random().toString(36).slice(2, 10);
export const mkRule = (all: Cond[], sell = 100): Rule => ({ id: rid(), all, sell });
export const PRESETS: { id: string; l: string; d: string; rules: () => Rule[] }[] = [
  { id: 'flash', l: 'Éclair', d: 'Entrée-sortie rapide : on encaisse vite, on coupe au premier signe de faiblesse.', rules: () => [
    mkRule([{ k: 'gain', v: 30 }]), mkRule([{ k: 'loss', v: 15 }]), mkRule([{ k: 'sells', v: 2 }]), mkRule([{ k: 'creator_sell' }]), mkRule([{ k: 'age', v: 5 }]),
  ] },
  { id: 'tiers', l: 'Paliers', d: 'On sécurise la mise en route, puis on laisse courir le reste.', rules: () => [
    mkRule([{ k: 'gain', v: 50 }], 50), mkRule([{ k: 'gain', v: 150 }]), mkRule([{ k: 'loss', v: 25 }]), mkRule([{ k: 'creator_sell' }]),
  ] },
  { id: 'trend', l: 'Tendance', d: 'Suit la hausse et sort quand le prix recule ou que les ventes s\'accumulent.', rules: () => [
    mkRule([{ k: 'trail', v: 20, arm: 30 }]), mkRule([{ k: 'loss', v: 30 }]), mkRule([{ k: 'sells', v: 5 }, { k: 'sell_sol', v: 2 }]), mkRule([{ k: 'creator_sell' }]),
  ] },
  { id: 'momentum', l: 'Élan', d: 'Sort dès que d\'autres acheteurs arrivent après vous, ou au premier vendeur.', rules: () => [
    mkRule([{ k: 'buys', v: 2 }]), mkRule([{ k: 'sells', v: 1 }]), mkRule([{ k: 'loss', v: 15 }]), mkRule([{ k: 'age', v: 3 }]),
  ] },
];

/* ---------- base ---------- */
const COLS = 'id,mint,symbol,name,wallet,creator,entry_at,entry_price,entry_tokens,entry_sol,slippage,rules,status,state,created_at';
export async function listStrategies(): Promise<Strategy[]> {
  const { data, error } = await supabase.from('strategies').select(COLS).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as Strategy[];
}
export async function saveStrategy(s: Partial<Strategy> & { mint: string; rules: Rule[] }, id?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Connectez-vous pour activer une stratégie.');
  const row = { name: s.name ?? null, rules: s.rules, slippage: s.slippage ?? 25, status: s.status ?? 'active', entry_price: s.entry_price ?? null, entry_tokens: s.entry_tokens ?? null, entry_at: s.entry_at };
  if (id) {
    const { error } = await supabase.from('strategies').update(row).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from('strategies').insert({ ...row, user_id: user.id, mint: s.mint, symbol: s.symbol ?? null, wallet: s.wallet ?? null, creator: s.creator ?? null, entry_sol: s.entry_sol ?? null }).select('id').single();
  if (error) throw new Error(/strategies_one_active|duplicate/.test(error.message) ? 'Une stratégie est déjà active sur ce token : modifiez-la.' : /row-level|policy/.test(error.message) ? '50 stratégies actives au plus.' : error.message);
  window.dispatchEvent(new Event('ts-strategies'));
  return data.id as string;
}
export async function setStatus(id: string, status: 'active' | 'paused' | 'done') {
  const { error } = await supabase.from('strategies').update({ status }).eq('id', id);
  if (error) throw error;
  window.dispatchEvent(new Event('ts-strategies'));
}
export async function removeStrategy(id: string) {
  const { error } = await supabase.from('strategies').delete().eq('id', id);
  if (error) throw error;
  window.dispatchEvent(new Event('ts-strategies'));
}

/** Liste des stratégies du compte, tenue à jour en temps réel (ventes exécutées par le serveur) */
export function useStrategies() {
  const [list, setList] = useState<Strategy[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => listStrategies().then((L) => { if (alive) setList(L); }).catch(() => { if (alive) setList((x) => x ?? []); });
    load();
    const ch = supabase.channel('strategies-' + rid()).on('postgres_changes', { event: '*', schema: 'public', table: 'strategies' }, load).subscribe();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    window.addEventListener('ts-strategies', load);
    return () => { alive = false; clearInterval(t); window.removeEventListener('ts-strategies', load); supabase.removeChannel(ch); };
  }, []);
  return list;
}

/* ---------- position : quel wallet rapide détient le token, depuis quand ---------- */
type Hub = { rpc: <T>(m: string, p: unknown[]) => Promise<T> };
export async function quickHolders(mint: string): Promise<{ address: string; name: string; tokens: number }[]> {
  const W = (window as unknown as { TSServerWallet?: { wallets: { address: string; num: number; label: string | null }[] } }).TSServerWallet?.wallets ?? [];
  const hub = studio()?.hub as unknown as Hub | undefined;
  if (!hub || !W.length) return [];
  const out = await Promise.all(W.map(async (w) => {
    try {
      const r = await hub.rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>('getTokenAccountsByOwner', [w.address, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      const tokens = (r.value ?? []).reduce((a, x) => a + (x.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
      return { address: w.address, name: w.label || 'Wallet rapide n°' + w.num, tokens };
    } catch { return { address: w.address, name: w.label || 'Wallet rapide n°' + w.num, tokens: 0 }; }
  }));
  return out.filter((x) => x.tokens > 0).sort((a, b) => b.tokens - a.tokens);
}
/** Dernier achat réussi de ce token dans le journal du studio */
export function lastBuy(mint: string): { t: number; sol: number | null } | null {
  const J = ((window as unknown as { PumpStudio?: { S?: { journal?: { t: number; type: string; mint?: string; status?: string; sol?: number }[] } } }).PumpStudio?.S?.journal) ?? [];
  const b = J.filter((j) => j.mint === mint && j.type === 'buy' && j.status !== 'err').sort((a, b) => b.t - a.t)[0];
  return b ? { t: b.t, sol: b.sol != null ? Math.abs(b.sol) : null } : null;
}
