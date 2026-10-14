// Écoute en continu des créateurs suivis : connexion permanente au flux temps réel PumpPortal (transactions des
// wallets suivis + avis de création, triés en mémoire ; aucune interrogation de liste). Dès qu'un créateur suivi crée
// un token, le lancement est enregistré et notifié dans la seconde.
// Lancée chaque minute par la tâche planifiée : chaque passage écoute ~75 s en arrière-plan, les passages se
// chevauchent, il n'y a donc pas de trou d'écoute ; un même lancement n'est enregistré qu'une fois (base).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const PUMP_H = { Accept: 'application/json', Origin: 'https://pump.fun', Referer: 'https://pump.fun/' };
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LISTEN_MS = 75_000;

let keys: { pub: string; priv: string; watch: string } | null = null;
async function secrets() {
  if (keys) return keys;
  const get = async (n: string) => { const { data, error } = await admin.rpc('app_secret', { n }); if (error || !data) throw new Error('secret ' + n); return data as string; };
  keys = { pub: await get('vapid_public'), priv: await get('vapid_private'), watch: await get('watch_key') };
  webpush.setVapidDetails('https://tokenstudio-sol.vercel.app', keys.pub, keys.priv);
  return keys;
}
async function push(uid: string, title: string, body: string, url: string, tag: string) {
  const { data: subs } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', uid);
  await Promise.all(((subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url, tag }), { TTL: 600, urgency: 'high', topic: tag.slice(0, 32) }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await admin.from('push_subscriptions').delete().eq('id', s.id); }
  }));
}
const rpcUrl = () => (Deno.env.get('SOLANA_RPC_URL') ?? '').split(',').map((x) => x.trim()).find((x) => x.startsWith('https://')) ?? 'https://api.mainnet-beta.solana.com';
// heure du bloc de création (précision à la seconde), pour mesurer le délai réel de détection
async function blockTime(sig: string): Promise<number | null> {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed', encoding: 'json' }] }) });
      const t = (await r.json())?.result?.blockTime;
      if (t) return Number(t) * 1000;
    } catch { /* nouvel essai */ }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return null;
}

async function watched(): Promise<Set<string>> {
  const { data } = await admin.rpc('creators_watched');
  return new Set(((data ?? []) as { address: string }[]).map((x) => x.address).filter((a) => MINT.test(a)));
}

type Msg = { signature?: string; mint?: string; traderPublicKey?: string; txType?: string; name?: string; symbol?: string; uri?: string };
async function record(m: Msg, creator: string, seenAt: number, info?: { name?: string; symbol?: string; image?: string | null }) {
  const { data } = await admin.rpc('creator_launch_record2', {
    p_creator: creator, p_mint: m.mint, p_symbol: String(info?.symbol ?? m.symbol ?? '').slice(0, 32), p_name: String(info?.name ?? m.name ?? '').slice(0, 80),
    p_image: info?.image ?? null, p_at: new Date(seenAt).toISOString(), p_sig: m.signature ?? null, p_source: 'stream',
  });
  const users = (data ?? []) as { r_user: string; r_label: string | null }[];
  await Promise.all(users.map((u) => push(u.r_user, (u.r_label || creator.slice(0, 4) + '…' + creator.slice(-4)) + ' lance $' + (info?.symbol ?? m.symbol ?? '?'),
    ((info?.name ?? m.name) ? (info?.name ?? m.name) + ' · ' : '') + 'nouveau token d\'un créateur suivi. Touchez pour l\'ouvrir.', '/app?page=trade&mint=' + m.mint, 'launch-' + m.mint)));
  // délai réel : heure du bloc de création → heure de détection
  if (users.length && m.signature) {
    const bt = await blockTime(m.signature);
    if (bt) await admin.rpc('creator_launch_timing', { p_mint: m.mint, p_block_at: new Date(bt).toISOString() });
  }
  return users.length;
}
// achat d'un token par son créateur sans message « create » : on vérifie que le token est bien le sien et tout récent
async function ownFresh(mint: string, creator: string) {
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/coins-v2/' + mint, { headers: PUMP_H, signal: AbortSignal.timeout(4000) });
    const c = await r.json();
    const img = typeof c?.image_uri === 'string' ? (c.image_uri.match(/\/ipfs\/([A-Za-z0-9]{40,80})/)?.[1] ? 'https://ipfs.io/ipfs/' + c.image_uri.match(/\/ipfs\/([A-Za-z0-9]{40,80})/)[1] : null) : null;
    return c?.creator === creator && Date.now() - Number(c?.created_timestamp) < 120_000 ? { name: c.name, symbol: c.symbol, image: img } : null;
  } catch { return null; }
}

async function listen() {
  const end = Date.now() + LISTEN_MS;
  let creators = await watched();
  if (!creators.size) return { creators: 0 };
  const seen = new Set<string>();
  let found = 0, msgs = 0, ws: WebSocket | null = null, subscribed = new Set<string>();
  const connect = () => new Promise<void>((resolve) => {
    ws = new WebSocket('wss://pumpportal.fun/api/data');
    // transactions des créateurs suivis + avis de création (filtré ici en mémoire, rien n'est stocké ni interrogé)
    ws.onopen = () => {
      subscribed = new Set(creators);
      ws!.send(JSON.stringify({ method: 'subscribeAccountTrade', keys: [...creators] }));
      ws!.send(JSON.stringify({ method: 'subscribeNewToken' }));
    };
    ws.onmessage = (e) => {
      msgs++;
      let m: Msg; try { m = JSON.parse(String(e.data)); } catch { return; }
      const who = m.traderPublicKey;
      if (!m.mint || !MINT.test(m.mint) || !who || !creators.has(who) || seen.has(m.mint)) return;
      seen.add(m.mint);
      const at = Date.now();
      if (m.txType === 'create') record(m, who, at).then((n) => { found += n; }).catch(() => seen.delete(m.mint!));
      else if (m.txType === 'buy') ownFresh(m.mint, who).then((info) => (info ? record(m, who, at, info).then((n) => { found += n; }) : null)).catch(() => {});
    };
    ws.onclose = () => resolve();
    ws.onerror = () => { try { ws?.close(); } catch { /* déjà fermé */ } };
  });
  // nouvelles adresses suivies en cours de route : abonnement sans couper la connexion
  const refresh = setInterval(async () => {
    try {
      creators = await watched();
      const add = [...creators].filter((a) => !subscribed.has(a));
      if (add.length && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ method: 'subscribeAccountTrade', keys: add })); add.forEach((a) => subscribed.add(a)); }
    } catch { /* prochain essai */ }
  }, 15_000);
  try {
    while (Date.now() < end) {
      const closed = connect();
      const timer = new Promise<void>((res) => setTimeout(res, Math.max(0, end - Date.now())));
      await Promise.race([closed, timer]);
      if (Date.now() < end) await new Promise((res) => setTimeout(res, 500));   // reconnexion rapide si le flux coupe
      else { try { (ws as WebSocket | null)?.close(); } catch { /* déjà fermé */ } }
    }
  } finally { clearInterval(refresh); }
  return { creators: creators.size, msgs, found };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  let k: Awaited<ReturnType<typeof secrets>>;
  try { k = await secrets(); } catch { return json(500, { error: 'Configuration du serveur incomplète.' }); }
  const key = req.headers.get('x-watch-key');
  if (!key || !same(key, k.watch)) return json(401, { error: 'Clé invalide.' });
  // l'écoute continue en arrière-plan après la réponse
  const job = listen().catch((e) => ({ error: (e as Error).message })).then((r) => { console.log('creator-stream', JSON.stringify(r)); return r; });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) { EdgeRuntime.waitUntil(job); return json(202, { listening: LISTEN_MS }); }
  return json(200, await job);
});
