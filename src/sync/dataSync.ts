import { supabase } from '../lib/supabase';
import { studio } from '../legacy/bridge';

/* Synchronisation des données du studio avec le compte.
   Le navigateur reste la source de travail (le studio fonctionne hors ligne et sans compte) ;
   le compte en garde une copie et la redistribue sur les autres appareils.
   Chaque ligne est validée ici ET par les contraintes de la base ; seules les lignes modifiées sont envoyées. */

type Obj = Record<string, any>;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = (ms: unknown) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null; };
const ms = (s: unknown) => { const n = Date.parse(String(s ?? '')); return Number.isFinite(n) ? n : Date.now(); };
const httpUrl = (v: unknown, max: number) => (typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= max ? v : null);
const hash = (o: unknown) => { const s = JSON.stringify(o); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36) + s.length.toString(36); };
const OP_TYPES = new Set(['create', 'buy', 'sell', 'fees']);
const ORDER_KINDS = new Set(['tp', 'sl', 'trail', 'mcap']);
const ORDER_MAIN = new Set(['id', 'mint', 'symbol', 'kind', 'value', 'pct', 'ref', 'active']);

/* ---------- conversion navigateur → base ---------- */
export const toRow = {
  token(t: Obj) {
    if (!B58.test(t.mint || '')) return null;
    const symbol = String(t.symbol || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'TOKEN';
    return { mint: t.mint, name: str(t.name, 32) || symbol, symbol, platform: !t.platform || t.platform === 'pump' ? 'pump' : 'other',
      image_url: httpUrl(t.image, 500), description: str(t.desc, 1000), twitter: str(t.tw, 200), telegram: str(t.tg, 200), website: str(t.web, 200),
      dev_sol: num(t.dev) != null && Number(t.dev) >= 0 ? Number(t.dev) : null, signature: str(t.sig, 100), added_manually: !!t.added, launched_at: iso(t.createdAt) };
  },
  op(j: Obj) {
    if (!OP_TYPES.has(j.type) || j.id == null) return null;
    return { client_id: String(j.id).slice(0, 64), type: j.type, status: j.status === 'err' ? 'err' : 'ok', sim: !!j.sim, mint: B58.test(j.mint || '') ? j.mint : null,
      symbol: str(j.symbol, 32), sol: num(j.sol), tokens: num(j.tokens), estimated: !!j.est, auto: !!j.auto, signature: str(j.sig, 100), error: str(j.err, 500), at: iso(j.t) || new Date().toISOString() };
  },
  order(o: Obj) {
    if (!B58.test(o.mint || '') || !ORDER_KINDS.has(o.kind) || num(o.value) == null || o.id == null) return null;
    const state: Obj = {}; Object.keys(o).forEach((k) => { if (!ORDER_MAIN.has(k)) state[k] = o[k]; });
    const st = JSON.stringify(state).length < 3500 ? state : {};
    const pct = num(o.pct); const ref = num(o.ref);
    return { client_id: String(o.id).slice(0, 64), mint: o.mint, symbol: str(o.symbol, 32), kind: o.kind, value: Number(o.value),
      pct: pct != null && pct > 0 && pct <= 100 ? pct : 100, ref_price: ref != null && ref >= 0 ? ref : null, active: !!o.active, state: st };
  },
  dist(mint: string, platform: string, r: Obj) {
    if (!B58.test(mint) || !/^[a-z0-9_-]{2,32}$/.test(platform)) return null;
    return { mint, platform, status: r?.done ? 'accepted' : 'sent', sent_at: iso(r?.at) || new Date().toISOString() };
  },
  draft(d: Obj) {
    if (!d || !str(d.name, 64)) return null;
    const data = JSON.parse(JSON.stringify(d)); delete data.image; delete data.imgSrc;
    return JSON.stringify(data).length < 60000 ? { client_id: 'current', title: str(d.name, 64), data } : null;
  },
  strategy(s: Obj) {
    if (!/^[a-z0-9_-]{2,32}$/.test(s.id || '')) return null;
    const params = JSON.stringify(s.P || {}).length < 15000 ? s.P || {} : {};
    return { strategy_id: s.id, name: str(s.name, 40) || s.id, enabled: s.enabled !== false, params };
  },
  trade(c: Obj) {
    if (c.id == null || !c.sid || !c.mint || num(c.size) == null) return null;
    return { client_id: String(c.id).slice(0, 64), strategy_id: String(c.sid).slice(0, 32), mint: String(c.mint).slice(0, 44), symbol: str(c.symbol, 32),
      opened_at: iso(c.openedAt) || new Date().toISOString(), closed_at: iso(c.closedAt) || new Date().toISOString(),
      size_sol: Number(c.size), proceeds_sol: num(c.proceeds) ?? 0, pnl_sol: num(c.pnl) ?? 0, pnl_pct: num(c.pnlPct), reason: str(c.why, 120),
      data: { entryMc: num(c.entryMc), exitMc: num(c.exitMc), peakMc: num(c.peakMc), score: num(c.score) } };
  },
};

/* ---------- conversion base → navigateur ---------- */
const fromRow = {
  token: (r: Obj) => ({ mint: r.mint, name: r.name, symbol: r.symbol, image: r.image_url || '', createdAt: ms(r.launched_at || r.created_at), sig: r.signature || '',
    dev: r.dev_sol != null ? Number(r.dev_sol) : undefined, desc: r.description || '', tw: r.twitter || '', tg: r.telegram || '', web: r.website || '', platform: r.platform, added: r.added_manually || undefined }),
  op: (r: Obj) => ({ id: r.client_id || r.id, t: ms(r.at), type: r.type, mint: r.mint || '', symbol: r.symbol || '', sim: r.sim, status: r.status,
    sol: r.sol != null ? Number(r.sol) : 0, tokens: r.tokens != null ? Number(r.tokens) : 0, est: r.estimated || undefined, auto: r.auto || undefined, sig: r.signature || '', err: r.error || undefined }),
  order: (r: Obj) => Object.assign({}, r.state || {}, { id: r.client_id || r.id, mint: r.mint, symbol: r.symbol || '', kind: r.kind, value: Number(r.value), pct: Number(r.pct), ref: r.ref_price != null ? Number(r.ref_price) : undefined, active: r.active }),
};

/* ---------- état de la synchronisation (lisible par l'interface) ---------- */
export type SyncStatus = { userId: string | null; enabled: boolean | null; syncing: boolean; lastSync: number | null; error: string | null; cloud: Record<string, number> | null };
let status: SyncStatus = { userId: null, enabled: null, syncing: false, lastSync: null, error: null, cloud: null };
const listeners = new Set<() => void>();
const set = (p: Partial<SyncStatus>) => { status = { ...status, ...p }; listeners.forEach((l) => l()); };
export const syncStore = { get: () => status, subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); } };

/* empreintes des lignes déjà envoyées, par compte, pour n'envoyer que les changements */
type Hashes = Record<string, Record<string, string>>;
const HKEY = (uid: string) => 'ts-sync-' + uid;
const loadHashes = (uid: string): Hashes => { try { return JSON.parse(localStorage.getItem(HKEY(uid)) || '{}'); } catch { return {}; } };
const saveHashes = (uid: string, h: Hashes) => { try { localStorage.setItem(HKEY(uid), JSON.stringify(h)); } catch { /* stockage plein : on renverra tout */ } };

async function upsertChunks(table: string, rows: Obj[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 400) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 400), { onConflict });
    if (error) throw new Error(table + ' : ' + error.message);
  }
}
async function fetchAll(table: string, uid: string, order: string, max = 5000) {
  const out: Obj[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', uid).order(order, { ascending: false }).range(from, from + 999);
    if (error) throw new Error(table + ' : ' + error.message);
    out.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return out;
}

/** Collecte l'état local sous forme de lignes prêtes à envoyer, avec leur clé */
function localRows() {
  const st = studio(); const x = (st as Obj)?.data?.export?.() as Obj | undefined; const bot = (window as Obj).PumpBotUI?.data?.() as Obj | undefined;
  const sets: Record<string, { key: (r: Obj) => string; rows: Obj[]; table: string; conflict: string }> = {
    tokens: { table: 'tokens', conflict: 'user_id,mint', key: (r) => r.mint, rows: (x?.tokens ?? []).map(toRow.token).filter(Boolean) as Obj[] },
    operations: { table: 'operations', conflict: 'user_id,client_id', key: (r) => r.client_id, rows: (x?.journal ?? []).map(toRow.op).filter(Boolean) as Obj[] },
    orders: { table: 'orders', conflict: 'user_id,client_id', key: (r) => r.client_id, rows: (x?.orders ?? []).map(toRow.order).filter(Boolean) as Obj[] },
    distributions: { table: 'distributions', conflict: 'user_id,mint,platform', key: (r) => r.mint + ':' + r.platform,
      rows: Object.entries((x?.dist ?? {}) as Obj).flatMap(([m, ps]) => Object.entries(ps as Obj).map(([p, r]) => toRow.dist(m, p, r as Obj))).filter(Boolean) as Obj[] },
    drafts: { table: 'drafts', conflict: 'user_id,client_id', key: () => 'current', rows: [toRow.draft(x?.draft ?? {})].filter(Boolean) as Obj[] },
    bot_strategies: { table: 'bot_strategies', conflict: 'user_id,strategy_id', key: (r) => r.strategy_id, rows: (bot?.strategies ?? []).map(toRow.strategy).filter(Boolean) as Obj[] },
    bot_trades: { table: 'bot_trades', conflict: 'user_id,client_id', key: (r) => r.client_id, rows: (bot?.closed ?? []).map(toRow.trade).filter(Boolean) as Obj[] },
  };
  return sets;
}

/** Nombre d'éléments présents dans ce navigateur */
export function localCounts() {
  const s = localRows(); const out: Record<string, number> = {};
  Object.keys(s).forEach((k) => { out[k] = s[k]!.rows.length; });
  return out;
}

/** Envoie au compte les éléments nouveaux ou modifiés ; retire du compte les tokens et ordres supprimés ici */
export async function push(uid: string) {
  const sets = localRows(); const h = loadHashes(uid);
  for (const [name, s] of Object.entries(sets)) {
    const prev = h[name] ?? {}; const next: Record<string, string> = {};
    const changed = s.rows.filter((r) => { const k = s.key(r), v = hash(r); next[k] = v; return prev[k] !== v; });
    if (changed.length) await upsertChunks(s.table, changed.map((r) => ({ ...r, user_id: uid })), s.conflict);
    // suppressions : seulement pour les tokens et les ordres (le journal et les trades du bot sont un historique)
    if (name === 'tokens' || name === 'orders') {
      const gone = Object.keys(prev).filter((k) => !(k in next));
      if (gone.length) {
        const col = name === 'tokens' ? 'mint' : 'client_id';
        const { error } = await supabase.from(s.table).delete().eq('user_id', uid).in(col, gone);
        if (error) throw new Error(s.table + ' : ' + error.message);
      }
    }
    h[name] = next;
  }
  saveHashes(uid, h);
}

/** Récupère les données du compte et les fusionne dans ce navigateur (rien n'est écrasé localement) */
export async function pull(uid: string) {
  const [tokens, ops, orders, dist, drafts] = await Promise.all([
    fetchAll('tokens', uid, 'created_at'), fetchAll('operations', uid, 'at', 2000), fetchAll('orders', uid, 'created_at'),
    fetchAll('distributions', uid, 'sent_at'), supabase.from('drafts').select('*').eq('user_id', uid).eq('client_id', 'current').maybeSingle().then((r) => r.data),
  ]);
  const d: Obj = {};
  dist.forEach((r) => { (d[r.mint] ||= {})[r.platform] = { at: ms(r.sent_at), done: r.status === 'accepted' || undefined }; });
  const st = studio() as Obj | undefined;
  return st?.data?.merge?.({ tokens: tokens.map(fromRow.token), journal: ops.map(fromRow.op), orders: orders.map(fromRow.order), dist: d, draft: drafts?.data ?? null }) ?? null;
}

export async function cloudCounts(uid: string) {
  const tables = ['tokens', 'operations', 'orders', 'distributions', 'drafts', 'bot_strategies', 'bot_trades'];
  const res = await Promise.all(tables.map((t) => supabase.from(t).select('user_id', { count: 'exact', head: true }).eq('user_id', uid)));
  const out: Record<string, number> = {}; tables.forEach((t, i) => { out[t] = res[i]?.count ?? 0; });
  return out;
}

/** Synchronisation complète : récupère, fusionne, puis envoie */
export async function syncNow(uid: string) {
  if (status.syncing) return;
  set({ syncing: true, error: null });
  try { await pull(uid); await push(uid); set({ lastSync: Date.now(), cloud: await cloudCounts(uid) }); }
  catch (e) { set({ error: (e as Error).message.slice(0, 200) }); }
  finally { set({ syncing: false }); }
}
export async function pushSoon(uid: string) {
  if (status.syncing || !status.enabled) return;
  set({ syncing: true, error: null });
  try { await push(uid); set({ lastSync: Date.now() }); }
  catch (e) { set({ error: (e as Error).message.slice(0, 200) }); }
  finally { set({ syncing: false }); }
}

export async function setSyncEnabled(uid: string, on: boolean) {
  const { data } = await supabase.from('preferences').select('extra').eq('user_id', uid).single();
  const extra = { ...((data?.extra as Obj) ?? {}), sync: on };
  const { error } = await supabase.from('preferences').update({ extra }).eq('user_id', uid);
  if (error) throw error;
  set({ enabled: on });
}
export async function readSyncEnabled(uid: string) {
  const { data } = await supabase.from('preferences').select('extra').eq('user_id', uid).single();
  const on = (data?.extra as Obj | undefined)?.sync;
  return on === true ? true : on === false ? false : null;   // null : jamais choisi
}
export function setStatus(p: Partial<SyncStatus>) { set(p); }

/** Supprime toutes les données de travail du compte (les données de ce navigateur restent) */
export async function wipeCloud(uid: string) {
  for (const t of ['operations', 'orders', 'tokens', 'distributions', 'drafts', 'bot_trades', 'bot_strategies']) {
    const { error } = await supabase.from(t).delete().eq('user_id', uid);
    if (error) throw new Error(t + ' : ' + error.message);
  }
  saveHashes(uid, {});
  set({ cloud: await cloudCounts(uid) });
}

/** Export complet du compte (portabilité des données) */
export async function exportCloud(uid: string) {
  const [profile, preferences, wallets, tokens, operations, orders, distributions, drafts, bot_strategies, bot_trades] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).single().then((r) => r.data),
    supabase.from('preferences').select('*').eq('user_id', uid).single().then((r) => r.data),
    fetchAll('wallets', uid, 'created_at'), fetchAll('tokens', uid, 'created_at'), fetchAll('operations', uid, 'at', 20000), fetchAll('orders', uid, 'created_at'),
    fetchAll('distributions', uid, 'sent_at'), fetchAll('drafts', uid, 'updated_at'), fetchAll('bot_strategies', uid, 'updated_at'), fetchAll('bot_trades', uid, 'closed_at', 20000),
  ]);
  return { exported_at: new Date().toISOString(), profile, preferences, wallets, tokens, operations, orders, distributions, drafts, bot_strategies, bot_trades };
}
