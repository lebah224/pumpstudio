import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { MARKET_REGION } from './api';
import { ADDR_RE, shortAddr } from './creators';
import type { Reason } from './creators';

// Acheteurs suivis : wallets de traders observés. Fiche d'analyse (fonction market, 100 derniers échanges lus sur
// Solana), achats et ventes captés en temps réel par le serveur, alertes réglables par wallet.

export type Tracked = {
  id: string; address: string; label: string | null; note: string | null; alerts: boolean; alert_sells: boolean; alert_min_sol: number;
  last_trade_at: string | null; created_at: string;
};
export type TrackedTrade = {
  id: string; trader: string; mint: string; side: 'buy' | 'sell'; sol: number; tokens: number; mcap_sol: number | null;
  symbol: string | null; name: string | null; image: string | null; sig: string; at: string;
};
export type TraderToken = {
  mint: string; symbol: string | null; name: string | null; image: string | null; mcUsd: number | null; complete: boolean | null;
  buySol: number; sellSol: number; pnl: number | null; roi: number | null; open: boolean; soldPct: number | null; n: number; last: number;
  entrySec: number | null; holdMin: number | null;
};
export type TraderProfile = {
  address: string; score: number | null; verdict: 'Rentable' | 'Moyen' | 'Perdant' | 'Inconnu'; reasons: Reason[];
  stats: {
    swaps: number; tokens: number; closed: number; wins: number; winRate: number | null; pnlSol: number; best: number | null; worst: number | null;
    buyMedian: number | null; volume: number; entryMedianSec: number | null; holdMedianMin: number | null; perDay: number | null; spanDays: number;
    open: number; first: number | null; last: number | null;
  };
  tokens: TraderToken[];
  trades: { sig: string; t: number; mint: string; side: 'buy' | 'sell'; sol: number; tok: number; symbol: string | null; image: string | null }[];
};
export const traderName = (f: Pick<Tracked, 'label' | 'address'>) => f.label || shortAddr(f.address);

/* ---------- fiche (cache de 90 s côté serveur, 60 s ici) ---------- */
const memo = new Map<string, { at: number; p: Promise<TraderProfile> }>();
export function traderProfile(address: string, force = false): Promise<TraderProfile> {
  const c = memo.get(address);
  if (c && !force && Date.now() - c.at < 60_000) return c.p;
  const p = supabase.functions.invoke('market', { body: { action: 'trader', address }, region: MARKET_REGION }).then(async ({ data, error }) => {
    if (error) {
      let msg = 'Analyse du wallet indisponible. Réessayez dans un instant.';
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* réponse non JSON */ }
      throw new Error(msg);
    }
    return data as TraderProfile;
  });
  memo.set(address, { at: Date.now(), p });
  p.catch(() => memo.delete(address));
  return p;
}
export function useTraderProfile(address: string | null) {
  const [st, setSt] = useState<{ p: TraderProfile | null; err: string | null }>({ p: null, err: null });
  useEffect(() => {
    if (!address) return;
    let alive = true; setSt({ p: null, err: null });
    traderProfile(address).then((p) => alive && setSt({ p, err: null })).catch((e) => alive && setSt({ p: null, err: (e as Error).message }));
    return () => { alive = false; };
  }, [address]);
  return st;
}

/* ---------- liste suivie ---------- */
const bus = () => window.dispatchEvent(new Event('ts-traders'));
export async function track(address: string, label?: string | null) {
  const a = address.trim();
  if (!ADDR_RE.test(a)) throw new Error('Adresse de wallet invalide.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Connectez-vous pour suivre un wallet.');
  const { error } = await supabase.from('traders').insert({ user_id: user.id, address: a, label: label?.trim().slice(0, 32) || null });
  if (error) throw new Error(/duplicate|unique/.test(error.message) ? 'Ce wallet est déjà dans votre liste.' : /row-level security/i.test(error.message) ? '100 wallets suivis au plus.' : error.message);
  bus();
}
export async function updateTracked(id: string, p: Partial<Pick<Tracked, 'label' | 'note' | 'alerts' | 'alert_sells' | 'alert_min_sol'>>) {
  const { error } = await supabase.from('traders').update(p).eq('id', id);
  if (error) throw error;
  bus();
}
export async function untrack(id: string) {
  const { error } = await supabase.from('traders').delete().eq('id', id);
  if (error) throw error;
  bus();
}
export function useTracked() {
  const [list, setList] = useState<Tracked[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('traders').select('id,address,label,note,alerts,alert_sells,alert_min_sol,last_trade_at,created_at').order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setList(((data ?? []) as Tracked[]).map((t) => ({ ...t, alert_min_sol: Number(t.alert_min_sol) }))); });
    load();
    window.addEventListener('ts-traders', load);
    const t = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => { alive = false; clearInterval(t); window.removeEventListener('ts-traders', load); };
  }, []);
  return list;
}
/** Achats et ventes des wallets suivis, en temps réel */
export function useTrackedTrades() {
  const [list, setList] = useState<TrackedTrade[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('trader_trades').select('id,trader,mint,side,sol,tokens,mcap_sol,symbol,name,image,sig,at').order('at', { ascending: false }).limit(60)
      .then(({ data }) => { if (alive) setList(((data ?? []) as TrackedTrade[]).map((x) => ({ ...x, sol: Number(x.sol), tokens: Number(x.tokens), mcap_sol: x.mcap_sol == null ? null : Number(x.mcap_sol) }))); });
    load();
    const ch = supabase.channel('ttrades-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trader_trades' }, load).subscribe();
    // wallet retiré : ses transactions sont effacées par le serveur, la liste se recharge
    window.addEventListener('ts-traders', load);
    return () => { alive = false; window.removeEventListener('ts-traders', load); supabase.removeChannel(ch); };
  }, []);
  return list;
}
