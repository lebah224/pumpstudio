import { supabase } from '../lib/supabase';

// Données de marché servies par la fonction serveur « market » (pump.fun, DEX Screener, GeckoTerminal)
export type Num = number | null;
export type Row = {
  mint: string; name: string; symbol: string; image: string | null; created: Num; dex: string | null; pump: boolean;
  complete: boolean; progress: Num; priceUsd: Num; priceSol: Num; mcUsd: Num; liqUsd: Num; supply: Num;
  vol: { m5: Num; h1: Num; h24: Num }; chg: { m5: Num; h1: Num; h24: Num }; tx: { b: Num; s: Num }; tx1: { b: Num; s: Num };
  pair: string | null; creator: string | null; links: { twitter?: string; telegram?: string; website?: string }; lastTrade: Num; ath: Num;
};
export type TokenInfo = Row & { description: string; koth: Num; curve: string | null; dexPair: { dex: string; pair: string; url: string | null; quote: string } | null };
export type Candle = [number, number, number, number, number, number]; // temps (s), ouverture, haut, bas, clôture, volume
export type Trade = { sig: string; t: number; w: string; side: 'buy' | 'sell'; usd: Num; sol: Num; tok: Num; pUsd: Num; pSol: Num; amm?: boolean; live?: boolean };
export type Tab = 'trending' | 'new' | 'graduating' | 'migrated';
export type Tf = '1s' | '15s' | '30s' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '6h' | '12h' | '24h';
export const TF_SEC: Record<Tf, number> = { '1s': 1, '15s': 15, '30s': 30, '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200, '24h': 86400 };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('market', { body });
  if (error) {
    let msg = 'Données de marché indisponibles. Réessayez dans un instant.';
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* réponse non JSON */ }
    throw new Error(msg);
  }
  return data as T;
}
export const marketList = (tab: Tab) => call<{ tab: Tab; at: number; rows: Row[] }>({ action: 'lists', tab });
export const tokenInfo = (mint: string) => call<TokenInfo>({ action: 'token', mint });
export const candles = (mint: string, tf: Tf, cur: 'USD' | 'SOL', created: Num, limit = 500) =>
  call<{ src: string; tf: Tf; cur: string; c: Candle[] }>({ action: 'candles', mint, tf, cur, created, limit });
export const tradesOf = (mint: string, limit = 60) => call<{ trades: Trade[] }>({ action: 'trades', mint, limit }).then((r) => r.trades);

export type Holder = { owner: string; account: string; pct: number; amount: number; insider: boolean; label: string | null; kind: string | null };
export type CreatorTrade = { sig: string; t: number; side: 'buy' | 'sell'; sol: number; usd: Num; tok: number };
export type Analysis = {
  source: string | null; score: Num; rugged: boolean; risks: { name: string; value: string; description: string; level: string }[];
  program: string | null; mintAuthority?: string | null; freezeAuthority?: string | null; mutable: boolean | null; transferFee: number;
  danger: { permanentDelegate: boolean; transferHook: boolean; nonTransferable: boolean; frozenDefault: boolean };
  lpLockedPct: Num; liqUsd: Num; totalHolders: Num; insiders: { networks: number; wallets: number }; supply: number; holders: Holder[]; top10: number;
  creator: null | {
    address: string; balance: Num; pct: Num; bought: { n: number; sol: number; tok: number }; sold: { n: number; sol: number; tok: number };
    first: CreatorTrade | null; trades: CreatorTrade[]; coinsCount: number;
    coins: { mint: string; name: string; symbol: string; image: string | null; created: Num; mcUsd: Num; complete: boolean; ath: Num }[];
  };
};
export const analysis = (mint: string) => call<Analysis>({ action: 'analysis', mint });

export const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
