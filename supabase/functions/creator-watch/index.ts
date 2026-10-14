// Filet de sécurité des lancements des créateurs suivis (la détection principale est l'écoute continue creator-stream) :
// appelée toutes les 30 secondes, elle relit les derniers tokens de chaque créateur suivi, et seulement eux.
// Un lancement manqué par le flux est enregistré une fois par compte et notifié sur ses appareils.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const PUMP_H = { Accept: 'application/json', Origin: 'https://pump.fun', Referer: 'https://pump.fun/' };
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
  for (const s of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url, tag }), { TTL: 600, urgency: 'high', topic: tag.slice(0, 32) }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await admin.from('push_subscriptions').delete().eq('id', s.id); }
  }
}
const img = (u: unknown) => { const v = typeof u === 'string' ? u : ''; const cid = v.match(/\/ipfs\/([A-Za-z0-9]{40,80})/); return cid ? 'https://ipfs.io/ipfs/' + cid[1] : /^https:\/\/\S{4,280}$/.test(v) ? v : null; };

type Coin = { mint?: string; creator?: string; symbol?: string; name?: string; image_uri?: string; created_timestamp?: number };
async function ofCreator(addr: string): Promise<Coin[]> {
  try {
    const r = await fetch('https://frontend-api-v3.pump.fun/coins-v2/user-created-coins/' + addr + '?offset=0&limit=5&includeNsfw=true', { headers: PUMP_H, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const j = await r.json();
    return ((Array.isArray(j) ? j : (j?.coins ?? [])) as Coin[]).map((c) => ({ ...c, creator: c.creator ?? addr }));
  } catch { return []; }
}
// par paquets de 8 pour ménager la source
async function latest(addrs: string[]): Promise<Coin[]> {
  const out: Coin[] = [];
  for (let i = 0; i < addrs.length; i += 8) out.push(...(await Promise.all(addrs.slice(i, i + 8).map(ofCreator))).flat());
  return out;
}

async function run() {
  const { data: w } = await admin.rpc('creators_watched');
  const watched = new Set(((w ?? []) as { address: string }[]).map((x) => x.address));
  if (!watched.size) return { creators: 0 };
  const coins = await latest([...watched]);
  const fresh = Date.now() - 10 * 60_000;   // au démarrage, on ignore les lancements trop anciens
  let found = 0, notified = 0;
  for (const c of coins) {
    if (!c.mint || !MINT.test(c.mint) || !c.creator || !watched.has(c.creator)) continue;
    const at = Number(c.created_timestamp) || Date.now();
    if (at < fresh) continue;
    found++;
    const { data } = await admin.rpc('creator_launch_record2', { p_creator: c.creator, p_mint: c.mint, p_symbol: String(c.symbol ?? '').slice(0, 32), p_name: String(c.name ?? '').slice(0, 80), p_image: img(c.image_uri), p_at: new Date(at).toISOString(), p_sig: null, p_source: 'poll' });
    for (const u of (data ?? []) as { r_user: string; r_label: string | null }[]) {
      notified++;
      const who = u.r_label || c.creator.slice(0, 4) + '…' + c.creator.slice(-4);
      await push(u.r_user, who + ' lance $' + (c.symbol || '?'), (c.name ? c.name + ' · ' : '') + 'nouveau token d\'un créateur suivi. Touchez pour l\'ouvrir.', '/app?page=trade&mint=' + c.mint, 'launch-' + c.mint);
    }
  }
  return { creators: watched.size, coins: coins.length, found, notified };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  let k: Awaited<ReturnType<typeof secrets>>;
  try { k = await secrets(); } catch { return json(500, { error: 'Configuration du serveur incomplète.' }); }
  const key = req.headers.get('x-watch-key');
  if (!key || !same(key, k.watch)) return json(401, { error: 'Clé invalide.' });
  try { return json(200, await run()); } catch (e) { return json(500, { error: (e as Error).message }); }
});
