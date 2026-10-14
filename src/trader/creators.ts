import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { MARKET_REGION } from './api';

// Créateurs suivis : liste du compte, fiche d'analyse (fonction market) et lancements détectés par le serveur.

export type Followed = { id: string; address: string; label: string | null; note: string | null; alerts: boolean; last_mint: string | null; last_launch_at: string | null; created_at: string };
export type Launch = { id: string; creator: string; mint: string; symbol: string | null; name: string | null; image: string | null; launched_at: string; seen_at: string };
export type Reason = { t: string; k: 'g' | 'a' | 'r' };
export type CreatorProfile = {
  address: string; score: number | null; verdict: 'Solide' | 'Moyen' | 'Risqué' | 'Inconnu'; reasons: Reason[];
  stats: {
    count: number; sample: number; migrated: number; migRate: number; athBest: number | null; athMedian: number | null; day: number; week: number;
    lastLaunch: number | null; sellMedianMin: number | null; neverSold: number; soldAllShare: number | null; devBuyMedian: number | null; pnlSol: number;
  };
  behav: { mint: string; symbol: string; created: number | null; devBuySol: number | null; devBuyPct: number | null; sellAfterMin: number | null; soldPct: number | null; pnlSol: number }[];
  coins: { mint: string; name: string; symbol: string; image: string | null; created: number | null; mcUsd: number | null; ath: number | null; complete: boolean; progress: number | null }[];
};
export const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const shortAddr = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);
export const creatorName = (f: Pick<Followed, 'label' | 'address'>) => f.label || shortAddr(f.address);

/* ---------- fiche (cache de 45 s côté serveur, 30 s ici) ---------- */
const memo = new Map<string, { at: number; p: Promise<CreatorProfile> }>();
export function creatorProfile(address: string, force = false): Promise<CreatorProfile> {
  const c = memo.get(address);
  if (c && !force && Date.now() - c.at < 30_000) return c.p;
  const p = supabase.functions.invoke('market', { body: { action: 'creator', address }, region: MARKET_REGION }).then(async ({ data, error }) => {
    if (error) {
      let msg = 'Analyse du créateur indisponible. Réessayez dans un instant.';
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* réponse non JSON */ }
      throw new Error(msg);
    }
    return data as CreatorProfile;
  });
  memo.set(address, { at: Date.now(), p });
  p.catch(() => memo.delete(address));
  return p;
}
export function useCreatorProfile(address: string | null) {
  const [st, setSt] = useState<{ p: CreatorProfile | null; err: string | null }>({ p: null, err: null });
  useEffect(() => {
    if (!address) return;
    let alive = true; setSt({ p: null, err: null });
    creatorProfile(address).then((p) => alive && setSt({ p, err: null })).catch((e) => alive && setSt({ p: null, err: (e as Error).message }));
    return () => { alive = false; };
  }, [address]);
  return st;
}

/* ---------- liste suivie ---------- */
const bus = () => window.dispatchEvent(new Event('ts-creators'));
export async function follow(address: string, label?: string | null, note?: string | null) {
  const a = address.trim();
  if (!ADDR_RE.test(a)) throw new Error('Adresse de wallet invalide.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Connectez-vous pour suivre un créateur.');
  const { error } = await supabase.from('creators').insert({ user_id: user.id, address: a, label: label?.trim().slice(0, 32) || null, note: note?.trim().slice(0, 280) || null });
  if (error) throw new Error(/duplicate|unique/.test(error.message) ? 'Ce créateur est déjà dans votre liste.' : /row-level security/i.test(error.message) ? '100 créateurs suivis au plus.' : error.message);
  bus();
}
export async function updateCreator(id: string, p: Partial<Pick<Followed, 'label' | 'note' | 'alerts'>>) {
  const { error } = await supabase.from('creators').update(p).eq('id', id);
  if (error) throw error;
  bus();
}
export async function unfollow(id: string) {
  const { error } = await supabase.from('creators').delete().eq('id', id);
  if (error) throw error;
  bus();
}
export function useFollowed() {
  const [list, setList] = useState<Followed[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('creators').select('id,address,label,note,alerts,last_mint,last_launch_at,created_at').order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setList((data ?? []) as Followed[]); });
    load();
    window.addEventListener('ts-creators', load);
    const t = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => { alive = false; clearInterval(t); window.removeEventListener('ts-creators', load); };
  }, []);
  return list;
}
export function useLaunches() {
  const [list, setList] = useState<Launch[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('creator_launches').select('id,creator,mint,symbol,name,image,launched_at,seen_at').order('seen_at', { ascending: false }).limit(30)
      .then(({ data }) => { if (alive) setList((data ?? []) as Launch[]); });
    load();
    const ch = supabase.channel('launches-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'creator_launches' }, load).subscribe();
    // créateur retiré : ses lancements sont effacés par le serveur, la liste se recharge
    window.addEventListener('ts-creators', load);
    return () => { alive = false; window.removeEventListener('ts-creators', load); supabase.removeChannel(ch); };
  }, []);
  return list;
}
