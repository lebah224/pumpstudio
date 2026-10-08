// Surveillance des ordres et alertes push. Appelée chaque minute par la tâche planifiée (pg_cron),
// ou par un utilisateur connecté pour envoyer une notification de test à ses appareils.
// Ne signe et n'exécute jamais rien : elle compare les prix aux conditions et prévient l'utilisateur.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const HOSTS = [
  /^tokenstudio-sol\.vercel\.app$/,
  /^pumpstudio\.vercel\.app$/,
  /^tokenstudio(-git)?-[a-z0-9-]+-sadou-9f22dc7f\.vercel\.app$/,
  /^localhost(:\d{2,5})?$/,
];
function cors(origin: string | null) {
  let ok = false;
  try { ok = !!origin && HOSTS.some((re) => re.test(new URL(origin).host)); } catch { ok = false; }
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : 'https://tokenstudio-sol.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (status: number, body: unknown, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const WSOL = 'So11111111111111111111111111111111111111112';
let keys: { pub: string; priv: string; watch: string } | null = null;
async function secrets() {
  if (keys) return keys;
  const get = async (n: string) => { const { data, error } = await admin.rpc('app_secret', { n }); if (error || !data) throw new Error('secret ' + n); return data as string; };
  keys = { pub: await get('vapid_public'), priv: await get('vapid_private'), watch: await get('watch_key') };
  webpush.setVapidDetails('https://tokenstudio-sol.vercel.app', keys.pub, keys.priv);
  return keys;
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Note = { title: string; body: string; url: string; tag: string };
async function notify(userIds: string[], notes: Map<string, Note[]>) {
  if (!userIds.length) return { sent: 0, gone: 0, reached: new Set<string>() };
  const { data: subs } = await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', userIds);
  let sent = 0, gone = 0; const ok: string[] = []; const reached = new Set<string>();
  for (const s of (subs ?? []) as Sub[]) {
    for (const n of notes.get(s.user_id) ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(n), { TTL: 3600, urgency: 'high', topic: n.tag.slice(0, 32) });
        sent++; reached.add(s.user_id); if (!ok.includes(s.id)) ok.push(s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await admin.from('push_subscriptions').delete().eq('id', s.id); gone++; break; }
      }
    }
  }
  if (ok.length) await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).in('id', ok);
  return { sent, gone, reached };
}

type Pair = { baseToken?: { address: string }; quoteToken?: { address: string }; priceNative?: string; priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number } };
async function prices(mints: string[]) {
  const out = new Map<string, { price: number; mcapUsd: number | null }>();
  for (let i = 0; i < mints.length; i += 30) {
    try {
      const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + mints.slice(i, i + 30).join(','), { signal: AbortSignal.timeout(10_000) });
      const list = (await r.json()) as Pair[];
      const best = new Map<string, Pair>();
      for (const p of Array.isArray(list) ? list : []) {
        const m = p.baseToken?.address; if (!m || p.quoteToken?.address !== WSOL) continue;
        const cur = best.get(m); if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(m, p);
      }
      best.forEach((p, m) => { const price = Number(p.priceNative); if (price > 0) out.set(m, { price, mcapUsd: Number(p.marketCap || p.fdv) || null }); });
    } catch { /* prix indisponibles : on réessaie à la prochaine minute */ }
  }
  return out;
}

type Due = { order_id: string; user_id: string; mint: string; symbol: string | null; kind: string; value: number; pct: number; ref_price: number | null; state: Record<string, unknown>; peak: number | null; armed: boolean };
const pctTxt = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
async function watch() {
  const { data, error } = await admin.rpc('watch_orders_due');
  if (error) throw new Error(error.message);
  const due = (data ?? []) as Due[];
  if (!due.length) return { orders: 0, hits: 0, sent: 0 };
  const px = await prices([...new Set(due.map((o) => o.mint))]);
  const save: (Record<string, unknown> & { user_id: string })[] = [];
  const notes = new Map<string, Note[]>();
  for (const o of due) {
    const q = px.get(o.mint); if (!q) continue;
    const v = Number(o.value), ref = o.ref_price != null ? Number(o.ref_price) : null, sym = o.symbol || o.mint.slice(0, 4);
    let hit = false, why = '', peak = o.peak != null ? Number(o.peak) : null, armed = o.armed || o.state?.armed === true;
    if (o.kind === 'tp' && ref) { hit = q.price >= ref * (1 + v / 100); why = 'prise de profit +' + pctTxt(v) + ' % atteinte'; }
    else if (o.kind === 'sl' && ref) { hit = q.price <= ref * (1 - v / 100); why = 'stop −' + pctTxt(v) + ' % atteint'; }
    else if (o.kind === 'mcap') { hit = q.mcapUsd != null && q.mcapUsd >= v; why = 'capitalisation de ' + Math.round(v).toLocaleString('fr-FR') + ' $ atteinte'; }
    else if (o.kind === 'trail' && ref) {
      const arm = Number(o.state?.arm ?? 0);
      if (!armed && q.price >= ref * (1 + arm / 100)) { armed = true; peak = q.price; }
      if (armed) {
        peak = Math.max(peak ?? Number(o.state?.peak ?? 0), q.price);
        hit = q.price <= peak * (1 - v / 100); why = 'recul de ' + pctTxt(v) + ' % depuis le plus haut';
      }
      save.push({ user_id: o.user_id, order_id: o.order_id, peak, armed, alerted: hit, price: hit ? q.price : null });
    }
    if (!hit) continue;
    if (o.kind !== 'trail') save.push({ user_id: o.user_id, order_id: o.order_id, peak, armed, alerted: true, price: q.price });
    const list = notes.get(o.user_id) ?? []; notes.set(o.user_id, list);
    list.push({ title: 'Ordre déclenché · ' + sym, body: why[0]!.toUpperCase() + why.slice(1) + '. Ouvre TokenStudio pour vendre ' + pctTxt(Number(o.pct)) + ' % : rien n\'est vendu sans toi.', url: '/?page=orders', tag: 'order-' + o.order_id });
  }
  const r = await notify([...notes.keys()], notes);
  // une alerte n'est marquée envoyée que si au moins un appareil l'a reçue ; sinon on réessaie à la minute suivante
  const rows = save.map(({ user_id, ...x }) => (x.alerted && !r.reached.has(user_id) ? { ...x, alerted: false, price: null } : x));
  if (rows.length) await admin.rpc('watch_orders_save', { rows });
  return { orders: due.length, hits: [...notes.values()].reduce((a, l) => a + l.length, 0), sent: r.sent, gone: r.gone };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);
  let k: Awaited<ReturnType<typeof secrets>>;
  try { k = await secrets(); } catch { return json(500, { error: 'Configuration du serveur incomplète.' }, h); }

  // tâche planifiée
  const key = req.headers.get('x-watch-key');
  if (key) {
    if (!same(key, k.watch)) return json(401, { error: 'Clé invalide.' });
    try { return json(200, await watch()); } catch (e) { return json(500, { error: (e as Error).message }); }
  }

  // notification de test, pour l'utilisateur connecté seulement
  const auth = req.headers.get('Authorization') ?? '';
  const { data: { user } } = await admin.auth.getUser(auth.replace(/^Bearer /, ''));
  if (!user) return json(401, { error: 'Connexion requise.' }, h);
  const r = await notify([user.id], new Map([[user.id, [{ title: 'TokenStudio', body: 'Les alertes d\'ordres fonctionnent sur cet appareil.', url: '/?page=orders', tag: 'test' }]]]));
  return json(200, { sent: r.sent, gone: r.gone }, h);
});
