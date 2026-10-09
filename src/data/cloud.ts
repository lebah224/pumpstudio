import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { studio } from '../legacy/bridge';
import { fromRow, hash, toRow, type Obj } from './rows';

/* Données du compte : la base de données est la seule source.
   À la connexion, tout est chargé depuis la base et gardé en mémoire dans le studio ; chaque changement est écrit
   dans la base quelques instants après (seules les lignes modifiées partent). Rien n'est copié dans le navigateur. */

type Kind = 'tokens' | 'journal' | 'orders' | 'dist' | 'draft' | 'extra' | 'keys';
type WriteKind = Kind | 'cfg';
type Studio = { data?: { setCloud: (h: { write: (k: WriteKind, v: unknown) => void } | null) => void; cfg: () => Obj; loadCfg: (c: Obj) => void; guestCfg: () => void; dropLocalKeys: () => void; loadReal: (x: Obj) => void; replaceReal: (k: string, v: unknown) => void;
  clearReal: () => void; draft: () => Obj; legacyLocal: () => Obj; dropLegacyLocal: () => void } };
const st = () => studio() as unknown as Studio | undefined;

/* ---------- état visible par l'interface ---------- */
export type CloudStatus = { userId: string | null; loading: boolean; saving: boolean; pending: number; lastSaved: number | null; error: string | null; cloud: Record<string, number> | null };
let status: CloudStatus = { userId: null, loading: false, saving: false, pending: 0, lastSaved: null, error: null, cloud: null };
const subs = new Set<() => void>();
const set = (p: Partial<CloudStatus>) => { status = { ...status, ...p }; subs.forEach((f) => f()); };
export const cloudStore = { get: () => status, subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); } };
export const useCloudStatus = () => useSyncExternalStore(cloudStore.subscribe, cloudStore.get);

/* ---------- tables ---------- */
type Spec = { table: string; conflict: string; key: (r: Obj) => string; rows: (v: unknown) => Obj[]; deletes?: string };
const SPECS: Record<'tokens' | 'orders' | 'journal' | 'dist', Spec> = {
  tokens: { table: 'tokens', conflict: 'user_id,mint', key: (r) => r.mint, rows: (v) => ((v as Obj[]) ?? []).map(toRow.token).filter(Boolean) as Obj[], deletes: 'mint' },
  orders: { table: 'orders', conflict: 'user_id,client_id', key: (r) => r.client_id, rows: (v) => ((v as Obj[]) ?? []).map(toRow.order).filter(Boolean) as Obj[], deletes: 'client_id' },
  // le journal est un historique : jamais de suppression (le studio n'en garde que les 2 000 dernières lignes)
  journal: { table: 'operations', conflict: 'user_id,client_id', key: (r) => r.client_id, rows: (v) => ((v as Obj[]) ?? []).map(toRow.op).filter(Boolean) as Obj[] },
  dist: { table: 'distributions', conflict: 'user_id,mint,platform', key: (r) => r.mint + ':' + r.platform,
    rows: (v) => Object.entries((v ?? {}) as Obj).flatMap(([m, ps]) => Object.entries(ps as Obj).map(([p, r]) => toRow.dist(m, p, r as Obj))).filter(Boolean) as Obj[] },
};

/* ---------- moteur d'écriture ---------- */
let uid: string | null = null;
let ready = false;
const base: Record<string, Record<string, string>> = {};   // empreinte de chaque ligne connue dans la base
const latest: Partial<Record<Kind, unknown>> = {};         // dernière valeur à écrire, par type
const timers: Partial<Record<Kind, number>> = {};
let draftImg = '';                                          // empreinte du logo du brouillon déjà envoyé
let prefExtra: Obj = {};                                    // préférences.extra du compte (réglages du studio)
let keysHash = '';                                          // empreinte des clés API déjà enregistrées
const inflight = new Set<Kind>();                           // écritures en cours d'envoi
let retry = 0;

function countPending() { set({ pending: Object.keys(latest).length }); }
function schedule(kind: Kind, delay = 600) {
  window.clearTimeout(timers[kind]);
  timers[kind] = window.setTimeout(() => { flush(kind).catch(() => {}); }, delay);
}
function write(kind0: WriteKind, value: unknown) {
  let kind: Kind;
  if (kind0 === 'cfg') {
    // réglages du studio : clés API chiffrées à part, le reste dans les préférences du compte
    const { rpc = '', pinataJwt = '', ...rest } = (value ?? {}) as Obj;
    prefExtra = { ...prefExtra, studio: rest };
    if (hash({ rpc, pinataJwt }) !== keysHash) { latest.keys = { rpc, pinataJwt }; if (ready) schedule('keys', 600); }
    kind = 'extra'; value = prefExtra;
  } else kind = kind0;
  latest[kind] = value; countPending();
  if (ready) schedule(kind, kind === 'draft' ? 1200 : 600);
}
async function flushOther(kind: Kind, value: unknown) {
  if (kind === 'extra') {
    const { error } = await supabase.from('preferences').update({ extra: value }).eq('user_id', uid!);
    if (error) throw new Error(error.message);
  } else if (kind === 'keys') {
    const k = value as Obj;
    const { error } = await supabase.functions.invoke('account-keys', { body: { action: 'set', keys: k } });
    if (error) throw new Error('clés API : ' + error.message);
    keysHash = hash({ rpc: k.rpc || '', pinataJwt: k.pinataJwt || '' });
  }
}

async function flushTable(kind: keyof typeof SPECS, value: unknown) {
  const s = SPECS[kind], prev = base[kind] ?? {}, next: Record<string, string> = {};
  const rows = s.rows(value);
  const changed = rows.filter((r) => { const k = s.key(r), h = hash(r); next[k] = h; return prev[k] !== h; });
  for (let i = 0; i < changed.length; i += 400) {
    const { error } = await supabase.from(s.table).upsert(changed.slice(i, i + 400).map((r) => ({ ...r, user_id: uid })), { onConflict: s.conflict });
    if (error) throw new Error(error.message);
  }
  if (s.deletes) {
    const gone = Object.keys(prev).filter((k) => !(k in next));
    if (gone.length) {
      const { error } = await supabase.from(s.table).delete().eq('user_id', uid!).in(s.deletes, gone);
      if (error) throw new Error(error.message);
    }
  } else Object.keys(prev).forEach((k) => { if (!(k in next)) next[k] = prev[k]!; });
  base[kind] = next;
}
// image en ligne → fichier, sans réseau (la politique de sécurité du site interdit fetch sur data:)
const dataUrlBlob = async (u: string) => {
  const [head, b64 = ''] = u.split(','); const type = head!.match(/^data:([^;]+)/)?.[1] ?? 'image/png';
  const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type });
};
async function flushDraft(value: unknown) {
  const d = (value ?? {}) as Obj;
  const row = toRow.draft(d) ?? { client_id: 'current', title: null, data: {} };
  // logo du brouillon : dans le stockage du compte (dossier privé), seulement quand il change
  let logo_path: string | null = null;
  const img = typeof d.image === 'string' && d.image.startsWith('data:image/') ? d.image : '';
  if (img) {
    const h = hash(img.length + img.slice(-200));
    logo_path = uid + '/draft-logo';   // un seul fichier, remplacé à chaque nouveau logo
    if (h !== draftImg) {
      const blob = await dataUrlBlob(img);
      const { error } = await supabase.storage.from('logos').upload(logo_path, blob, { upsert: true, contentType: blob.type || 'image/png' });
      if (error) throw new Error('logo : ' + error.message);
      draftImg = h;
    }
  }
  const { error } = await supabase.from('drafts').upsert({ ...row, logo_path, user_id: uid }, { onConflict: 'user_id,client_id' });
  if (error) throw new Error(error.message);
}

async function flush(kind: Kind) {
  if (!uid || !ready || !(kind in latest)) return;
  const value = latest[kind]; delete latest[kind];
  inflight.add(kind);
  set({ saving: true });
  try {
    if (kind === 'draft') await flushDraft(value);
    else if (kind === 'tokens' || kind === 'orders' || kind === 'journal' || kind === 'dist') await flushTable(kind, value);
    else await flushOther(kind, value);
    retry = 0; set({ lastSaved: Date.now(), error: Object.keys(latest).length ? status.error : null });
  } catch (e) {
    // réseau coupé ou refus : on garde la valeur et on réessaie, de plus en plus espacé
    if (!(kind in latest)) latest[kind] = value;
    retry = Math.min(retry + 1, 6);
    set({ error: 'Enregistrement en attente : ' + ((e as Error).message || 'réseau indisponible').slice(0, 140) });
    schedule(kind, 2000 * 2 ** (retry - 1));
  } finally { inflight.delete(kind); set({ saving: inflight.size > 0 }); countPending(); }
}
/** Tout ce qui attend part maintenant (déconnexion, fermeture) */
export async function flushAll() {
  for (const k of Object.keys(latest) as Kind[]) { window.clearTimeout(timers[k]); await flush(k).catch(() => {}); }
}

/* ---------- chargement ---------- */
async function fetchAll(table: string, order: string, max = 5000) {
  const out: Obj[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', uid!).order(order, { ascending: false }).range(from, from + 999);
    if (error) throw new Error(table + ' : ' + error.message);
    out.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return out;
}
async function signedImage(path: string) {
  const { data } = await supabase.storage.from('logos').download(path);
  if (!data) return null;
  return await new Promise<string | null>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsDataURL(data); });
}
// union par clé : les éléments du compte, plus ceux qui n'existent qu'ici (anciennes données du navigateur)
function union<T extends Obj>(cloud: T[], local: T[] | undefined, key: (x: T) => string) {
  const seen = new Set(cloud.map(key)); const extra = (local ?? []).filter((x) => x && !seen.has(key(x)));
  return extra.length ? cloud.concat(extra) : cloud;
}

// verrou d'exécution d'un ordre, partagé avec le serveur (false : déjà pris en charge ailleurs)
(window as unknown as { TSClaimOrder?: (id: string) => Promise<boolean> }).TSClaimOrder = async (id: string) => {
  if (!uid || !ready) return true;
  await flushAll();   // l'ordre doit exister dans la base pour être réservé
  const { data, error } = await supabase.rpc('order_claim', { p_client_id: String(id) });
  return !error && data === true;
};

/** Connexion : charge le compte, reprend une fois les anciennes données du navigateur, puis branche l'écriture */
export async function attachCloud(userId: string) {
  if (uid === userId && (ready || status.loading)) return;
  uid = userId; ready = false; Object.keys(base).forEach((k) => delete base[k]); draftImg = '';
  set({ userId, loading: true, error: null });
  const S = st();
  S?.data?.setCloud({ write });
  try {
    const [tokens, ops, orders, dist, draft, prefs, keys] = await Promise.all([
      fetchAll('tokens', 'created_at'), fetchAll('operations', 'at', 2000), fetchAll('orders', 'created_at'), fetchAll('distributions', 'sent_at'),
      supabase.from('drafts').select('*').eq('user_id', userId).eq('client_id', 'current').maybeSingle().then((r) => r.data as Obj | null),
      supabase.from('preferences').select('extra').eq('user_id', userId).maybeSingle().then((r) => (r.data?.extra ?? {}) as Obj),
      supabase.functions.invoke('account-keys', { body: { action: 'get' } }).then((r) => { if (r.error) throw new Error('clés API : ' + r.error.message); return ((r.data as Obj)?.keys ?? {}) as Obj; }),
    ]);
    if (uid !== userId) return;
    const d: Obj = {}; dist.forEach((r) => { (d[r.mint] ||= {})[r.platform] = { at: Date.parse(r.sent_at), done: r.status === 'accepted' || undefined }; });
    const x: Obj = { tokens: tokens.map(fromRow.token), journal: ops.map(fromRow.op), orders: orders.map(fromRow.order), dist: d, draft: draft?.data && Object.keys(draft.data).length ? { ...draft.data } : null };
    if (x.draft && draft?.logo_path) { const img = await signedImage(draft.logo_path); if (img) { x.draft.image = img; draftImg = hash(img.length + img.slice(-200)); } }
    // empreintes de ce qui est déjà dans la base : seules les modifications partiront
    (['tokens', 'orders', 'journal', 'dist'] as const).forEach((k) => { const s = SPECS[k], m: Record<string, string> = {}; s.rows(x[k]).forEach((r) => { m[s.key(r)] = hash(r); }); base[k] = m; });
    // anciennes données de ce navigateur (avant la base) : reprises une fois, puis effacées d'ici
    const old = S?.data?.legacyLocal() ?? {};
    const pend = latest;   // changements faits pendant le chargement
    x.tokens = union(x.tokens, [...((pend.tokens as Obj[]) ?? []), ...(old.tokens ?? [])], (t) => t.mint);
    x.orders = union(x.orders, [...((pend.orders as Obj[]) ?? []), ...(old.orders ?? [])], (o) => String(o.id));
    x.journal = union(x.journal, [...((pend.journal as Obj[]) ?? []), ...(old.journal ?? [])], (j) => String(j.id)).sort((a: Obj, b: Obj) => (b.t || 0) - (a.t || 0)).slice(0, 2000);
    Object.entries({ ...(old.dist ?? {}), ...((pend.dist as Obj) ?? {}) }).forEach(([m, ps]) => { x.dist[m] = { ...(ps as Obj), ...(x.dist[m] ?? {}) }; });
    if (!x.draft && (pend.draft || (old.draft && (old.draft as Obj).name))) x.draft = (pend.draft ?? old.draft) as Obj;
    S?.data?.loadReal(x);
    // réglages du studio : ceux du compte ; au premier passage, ceux de ce navigateur (clés comprises) y sont versés
    prefExtra = prefs; keysHash = hash({ rpc: keys.rpc || '', pinataJwt: keys.pinataJwt || '' });
    const localCfg = S?.data?.cfg() ?? {};
    const mergedKeys = { rpc: keys.rpc || localCfg.rpc || '', pinataJwt: keys.pinataJwt || localCfg.pinataJwt || '' };
    S?.data?.loadCfg({ ...(prefs.studio ?? localCfg), ...mergedKeys });
    const firstCfg = !prefs.studio, newKeys = hash(mergedKeys) !== keysHash;
    S?.data?.dropLocalKeys();
    S?.data?.dropLegacyLocal();
    // traces de l'ancienne synchronisation
    try { Object.keys(localStorage).filter((k) => k.startsWith('ts-sync-') || k === 'pstudio_owner').forEach((k) => localStorage.removeItem(k)); } catch { /* rien */ }
    ready = true;
    // ce qui manque dans la base (anciennes données, changements pendant le chargement) part maintenant
    (['tokens', 'orders', 'journal', 'dist'] as const).forEach((k) => { latest[k] = x[k]; schedule(k, 50); });
    if (x.draft && !draft) { latest.draft = x.draft; schedule('draft', 50); }
    if (firstCfg || newKeys) write('cfg', { ...(S?.data?.cfg() ?? {}) });
    Object.keys(latest).forEach((k) => schedule(k as Kind, 50));
    set({ loading: false, lastSaved: Date.now() });
    listen(userId);
  } catch (e) {
    set({ loading: false, error: 'Chargement du compte impossible : ' + (e as Error).message.slice(0, 140) });
    // nouvel essai dans quelques secondes (réseau)
    window.setTimeout(() => { if (uid === userId && !ready) { uid = null; attachCloud(userId); } }, 5000);
  }
}
/** Déconnexion : les derniers changements partent, puis plus rien du compte ne reste dans l'outil */
export async function detachCloud() {
  if (!uid) return;   // aucun compte branché : rien à faire (le brouillon d'un invité reste intact)
  if (ready) await flushAll();
  if (channel) { supabase.removeChannel(channel); channel = null; }
  st()?.data?.setCloud(null);
  st()?.data?.clearReal();
  st()?.data?.guestCfg();
  prefExtra = {}; keysHash = '';
  uid = null; ready = false; Object.keys(latest).forEach((k) => delete latest[k as Kind]);
  set({ userId: null, loading: false, saving: false, pending: 0, lastSaved: null, error: null, cloud: null });
}
// fermeture de l'onglet avec des changements pas encore enregistrés : on prévient
window.addEventListener('beforeunload', (e) => { if (ready && Object.keys(latest).length) { flushAll(); e.preventDefault(); e.returnValue = ''; } });

/* ---------- direct entre appareils ---------- */
// Une table du compte change (autre appareil, autre onglet) : elle est relue et remplace l'affichage.
// Nos propres écritures reviennent aussi : identiques à ce que l'on sait déjà, elles sont ignorées.
let channel: ReturnType<typeof supabase.channel> | null = null;
const TABLES: Record<string, 'tokens' | 'journal' | 'orders' | 'dist'> = { tokens: 'tokens', operations: 'journal', orders: 'orders', distributions: 'dist' };
const liveTimers: Record<string, number> = {};
function listen(userId: string) {
  channel = supabase.channel('compte-' + userId);
  Object.keys(TABLES).forEach((t) => channel!.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: 'user_id=eq.' + userId }, () => {
    window.clearTimeout(liveTimers[t]); liveTimers[t] = window.setTimeout(() => { refetch(t).catch(() => {}); }, 700);
  }));
  channel.subscribe();
}
async function refetch(table: string) {
  if (!uid || !ready) return;
  const kind = TABLES[table]!;
  if (kind in latest) return;   // changements faits ici en attente : ils partent d'abord, puis l'écho sera reçu
  // envoi en cours : relu après, pour ne jamais remplacer un changement local par un état plus ancien
  if (inflight.has(kind)) { window.clearTimeout(liveTimers[table]); liveTimers[table] = window.setTimeout(() => { refetch(table).catch(() => {}); }, 1000); return; }
  let value: unknown;
  if (kind === 'tokens') value = (await fetchAll('tokens', 'created_at')).map(fromRow.token);
  else if (kind === 'orders') value = (await fetchAll('orders', 'created_at')).map(fromRow.order);
  else if (kind === 'journal') value = (await fetchAll('operations', 'at', 2000)).map(fromRow.op);
  else { const d: Obj = {}; (await fetchAll('distributions', 'sent_at')).forEach((r) => { (d[r.mint] ||= {})[r.platform] = { at: Date.parse(r.sent_at), done: r.status === 'accepted' || undefined }; }); value = d; }
  if (kind in latest || inflight.has(kind) || !uid) return;
  const s = SPECS[kind], m: Record<string, string> = {}; s.rows(value).forEach((r) => { m[s.key(r)] = hash(r); });
  const prev = base[kind] ?? {}, same = Object.keys(m).length === Object.keys(prev).length && Object.keys(m).every((k) => prev[k] === m[k]);
  if (same) return;
  base[kind] = m;
  st()?.data?.replaceReal(kind, value);
}

/* ---------- compteurs et export (onglet Données) ---------- */
export async function cloudCounts(userId: string) {
  const tables = ['tokens', 'operations', 'orders', 'distributions', 'drafts'];
  const res = await Promise.all(tables.map((t) => supabase.from(t).select('user_id', { count: 'exact', head: true }).eq('user_id', userId)));
  const out: Record<string, number> = {}; tables.forEach((t, i) => { out[t] = res[i]?.count ?? 0; });
  set({ cloud: out });
  return out;
}
export async function exportCloud(userId: string) {
  const all = async (table: string, order: string, max = 20000) => {
    const out: Obj[] = [];
    for (let from = 0; from < max; from += 1000) {
      const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).order(order, { ascending: false }).range(from, from + 999);
      if (error) throw new Error(table + ' : ' + error.message);
      out.push(...(data ?? [])); if (!data || data.length < 1000) break;
    }
    return out;
  };
  const [profile, preferences, wallets, tokens, operations, orders, distributions, drafts] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single().then((r) => r.data),
    supabase.from('preferences').select('*').eq('user_id', userId).single().then((r) => r.data),
    all('wallets', 'created_at'), all('tokens', 'created_at'), all('operations', 'at'), all('orders', 'created_at'),
    all('distributions', 'sent_at'), all('drafts', 'updated_at'),
  ]);
  return { exported_at: new Date().toISOString(), profile, preferences, wallets, tokens, operations, orders, distributions, drafts };
}
export const replaceTable = (kind: string, v: unknown) => st()?.data?.replaceReal(kind, v);

/** Branche les données du compte dès qu'une session est ouverte, et les retire quand elle se ferme */
export function useCloud() {
  const { ready: authReady, user, needsMfa } = useAuth();
  const id = user && !needsMfa ? user.id : null;
  useEffect(() => { if (!authReady) return; if (id) attachCloud(id); else detachCloud(); }, [authReady, id]);
}
