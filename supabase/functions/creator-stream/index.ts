// Écoute en continu des créateurs suivis : connexion permanente au flux temps réel PumpPortal (transactions des
// wallets suivis + avis de création, triés en mémoire ; aucune interrogation de liste). Dès qu'un créateur suivi crée
// un token, le lancement est enregistré et notifié dans la seconde.
// Achat automatique : pour un créateur qui a une règle active, l'achat part dès l'avis de création (filtres lus dans
// l'avis, wallet déjà prêt), en même temps que l'enregistrement ; la stratégie de sortie est attachée à la confirmation.
// Lancée chaque minute par la tâche planifiée : chaque passage écoute ~75 s en arrière-plan, les passages se
// chevauchent, il n'y a donc pas de trou d'écoute ; un même lancement n'est enregistré qu'une fois (base).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { buildDirect, checkBuy, fastBuy, hotWallet, rpc, settle, warm, type Hot } from '../_shared/fastbuy.ts';
import { PublicKey } from 'npm:@solana/web3.js@1.98.4';

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

type Msg = { signature?: string; mint?: string; traderPublicKey?: string; txType?: string; name?: string; symbol?: string; uri?: string;
  solAmount?: number; initialBuy?: number; marketCapSol?: number };

/* ---------- achat automatique ---------- */
type Snipe = { id: string; user_id: string; creator: string; wallet: string; mode: string; amount_sol: number; slippage: number; priority: number;
  max_per_day: number; filters: { dev_min?: number; dev_max?: number; dev_pct?: number; mcap_max?: number; gap_min?: number };
  exit_rules: unknown[] | null; exit_slippage: number; max_buy_sol: number; prev_launch: string | null };
const snipes = new Map<string, Snipe[]>();       // par créateur
const hot = new Map<string, Promise<Hot | null>>(); // wallets prêts à signer (uid:adresse)
const prevLaunch = new Map<string, number>();     // dernier lancement connu par créateur
const pending = new Set<Promise<unknown>>();
const track = <T>(p: Promise<T>) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };
async function loadSnipes() {
  const { data, error } = await admin.rpc('snipes_active');
  if (error) return;
  snipes.clear();
  for (const s of (data ?? []) as Snipe[]) {
    s.amount_sol = Number(s.amount_sol); s.slippage = Number(s.slippage); s.priority = Number(s.priority); s.max_buy_sol = Number(s.max_buy_sol); s.exit_slippage = Number(s.exit_slippage);
    (snipes.get(s.creator) ?? snipes.set(s.creator, []).get(s.creator)!).push(s);
    if (s.prev_launch) prevLaunch.set(s.creator, Math.max(prevLaunch.get(s.creator) ?? 0, Date.parse(s.prev_launch)));
    const k = s.user_id + ':' + s.wallet;
    if (!hot.has(k)) { const h = hotWallet(admin, s.user_id, s.wallet).catch(() => null); hot.set(k, h); h.then((w) => { if (!w) hot.delete(k); }); }
  }
}
const nf = (v: number, d = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
// filtres lus dans l'avis de création (aucune requête)
function skipReason(s: Snipe, m: Msg, prev: number | undefined, at: number): string | null {
  const F = s.filters ?? {}, dev = Number(m.solAmount ?? 0), pct = Number(m.initialBuy ?? 0) / 1e9 * 100, mc = Number(m.marketCapSol ?? 0);
  if (F.dev_min != null && dev < F.dev_min) return 'Achat du créateur ' + nf(dev) + ' SOL, sous le minimum de ' + nf(F.dev_min) + ' SOL';
  if (F.dev_max != null && dev > F.dev_max) return 'Achat du créateur ' + nf(dev) + ' SOL, au-dessus du maximum de ' + nf(F.dev_max) + ' SOL';
  if (F.dev_pct != null && pct > F.dev_pct) return 'Le créateur détient ' + nf(pct, 1) + ' % (maximum ' + nf(F.dev_pct, 1) + ' %)';
  if (F.mcap_max != null && mc > F.mcap_max) return 'Capitalisation ' + nf(mc, 1) + ' SOL (maximum ' + nf(F.mcap_max, 1) + ' SOL)';
  if (F.gap_min != null && prev && at - prev > 3000 && at - prev < F.gap_min * 60_000) return 'Lancement précédent il y a ' + nf((at - prev) / 60_000, 1) + ' min (minimum ' + nf(F.gap_min, 0) + ' min)';
  if (s.amount_sol > s.max_buy_sol) return 'Montant au-delà de votre limite par achat (' + nf(s.max_buy_sol) + ' SOL, réglable dans Préférences)';
  return null;
}
function snipeAll(m: Msg, creator: string, at: number) {
  const L = snipes.get(creator);
  const prev = prevLaunch.get(creator);
  prevLaunch.set(creator, at);
  if (!L?.length) return;
  for (const s of L) track(snipeOne(s, m, prev, at));
}
async function snipeOne(s: Snipe, m: Msg, prev: number | undefined, at: number) {
  const mint = m.mint!, sym = String(m.symbol ?? '').slice(0, 32);
  const why = skipReason(s, m, prev, at);
  if (why) { await admin.rpc('snipe_skip', { p_id: s.id, p_mint: mint, p_symbol: sym, p_reason: why }); return; }
  const w = await hot.get(s.user_id + ':' + s.wallet);
  const maxCost = s.amount_sol * (1 + s.slippage / 100);
  let run = null as string | null, reserved = 0;
  const fail = async (reason: string) => {
    if (reserved) await admin.rpc('sw_release', { uid: s.user_id, addr: s.wallet, sol: reserved });
    if (run) await admin.rpc('snipe_run_set', { p_id: run, p: { status: 'failed', reason } });
    if (run) await push(s.user_id, 'Achat auto échoué · $' + (sym || '?'), reason, '/app?page=trade&mint=' + mint, 'snipe-' + mint);
  };
  // autorisation pendant la préparation de la transaction : prise de la règle (une seule fois), puis plafond du jour
  const gate = (async () => {
    const { data } = await admin.rpc('snipe_claim', { p_id: s.id, p_mint: mint, p_symbol: sym });
    run = (data as string | null) ?? null;
    if (!run) return false;
    if (!w) { await fail('Wallet rapide introuvable ou illisible.'); return false; }
    const { error } = await admin.rpc('sw_reserve', { uid: s.user_id, addr: s.wallet, sol: maxCost });
    if (error) { await fail(error.message.includes('Plafond') ? error.message : 'Plafond journalier du wallet atteint.'); return false; }
    reserved = maxCost;
    return true;
  })();
  let sent: Awaited<ReturnType<typeof fastBuy>> = null;
  try {
    if (!w) { await gate; return; }
    sent = await fastBuy(w, mint, s.amount_sol, s.slippage, s.priority, gate);
  } catch (e) { await gate.catch(() => false); if (run) await fail((e as Error).message); return; }
  if (!sent || !run) return;
  const sendMs = Date.now() - at;
  await admin.rpc('snipe_run_set', { p_id: run, p: { status: 'sent', signature: sent.signature, send_ms: sendMs } });
  const res = await settle(sent.signature, s.wallet, mint);
  if (!res.ok) { await fail(res.reason); return; }
  const sol = res.sol ?? s.amount_sol, tokens = res.tokens ?? 0;
  if (reserved > sol) await admin.rpc('sw_release', { uid: s.user_id, addr: s.wallet, sol: reserved - sol });
  let strategy: string | null = null;
  if (s.exit_rules?.length && tokens > 0) {
    const { data } = await admin.from('strategies').insert({ user_id: s.user_id, mint, symbol: sym || null, wallet: s.wallet, creator: s.creator, entry_at: new Date().toISOString(),
      entry_price: sol / tokens, entry_tokens: tokens, entry_sol: sol, slippage: s.exit_slippage, rules: s.exit_rules, status: 'active' }).select('id').maybeSingle();
    strategy = (data as { id: string } | null)?.id ?? null;
  }
  await admin.rpc('snipe_run_set', { p_id: run, p: { status: 'bought', sol, tokens, strategy_id: strategy } });
  await admin.from('audit_log').insert({ user_id: s.user_id, event: 'server_auto_buy', detail: { signature: sent.signature, mint, sol, tokens, send_ms: sendMs } });
  await push(s.user_id, 'Achat auto · $' + (sym || '?'), nf(sol) + ' SOL · parti ' + nf(sendMs / 1000, 2) + ' s après la création' + (strategy ? ' · stratégie de sortie active' : ''),
    '/app?page=trade&mint=' + mint, 'snipe-' + mint);
}
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
  await Promise.all([loadSnipes(), warm()]);
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
      if (m.txType === 'create') snipeAll(m, who, at);
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
      await loadSnipes();
      const add = [...creators].filter((a) => !subscribed.has(a));
      if (add.length && ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ method: 'subscribeAccountTrade', keys: add })); add.forEach((a) => subscribed.add(a)); }
    } catch { /* prochain essai */ }
  }, 15_000);
  // configuration pump.fun et blockhash toujours frais : rien à lire au moment de l'achat
  const warmer = setInterval(() => { if (snipes.size) warm(); }, 8_000);
  try {
    while (Date.now() < end) {
      const closed = connect();
      const timer = new Promise<void>((res) => setTimeout(res, Math.max(0, end - Date.now())));
      await Promise.race([closed, timer]);
      if (Date.now() < end) await new Promise((res) => setTimeout(res, 500));   // reconnexion rapide si le flux coupe
      else { try { (ws as WebSocket | null)?.close(); } catch { /* déjà fermé */ } }
    }
  } finally { clearInterval(refresh); clearInterval(warmer); }
  // achats en cours de confirmation : on les mène au bout avant de rendre la main
  await Promise.race([Promise.allSettled([...pending]), new Promise((res) => setTimeout(res, 45_000))]);
  return { creators: creators.size, msgs, found, snipes: [...snipes.values()].reduce((a, L) => a + L.length, 0) };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  let k: Awaited<ReturnType<typeof secrets>>;
  try { k = await secrets(); } catch { return json(500, { error: 'Configuration du serveur incomplète.' }); }
  const key = req.headers.get('x-watch-key');
  if (!key || !same(key, k.watch)) return json(401, { error: 'Clé invalide.' });
  // contrôle à blanc : achat construit pour un wallet public approvisionné, vérifié puis simulé (jamais signé ni envoyé)
  const body = await req.json().catch(() => ({})) as { dry?: string; payer?: string };
  if (typeof body.dry === 'string' && MINT.test(body.dry)) {
    const payer = new PublicKey(typeof body.payer === 'string' && MINT.test(body.payer) ? body.payer : '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'), t0 = Date.now();
    try {
      await warm();
      const t1 = Date.now(), tx = await buildDirect(payer, body.dry, 0.01, 30, 0.003), t2 = Date.now();
      await checkBuy(tx, payer.toBase58(), BigInt(Math.ceil(0.013 * 1e9)) + 10_000n, BigInt(Math.ceil(0.003 * 1.5e9)) + 1_000_000n);
      const raw = btoa(String.fromCharCode(...tx.serialize()));
      const sim = await rpc<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>('simulateTransaction', [raw, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }]);
      return json(200, { ok: !sim.value.err, warm_ms: t1 - t0, build_ms: t2 - t1, err: sim.value.err, units: sim.value.unitsConsumed, logs: (sim.value.logs ?? []).slice(-8) });
    } catch (e) { return json(200, { ok: false, error: (e as Error).message }); }
  }
  // l'écoute continue en arrière-plan après la réponse
  const job = listen().catch((e) => ({ error: (e as Error).message })).then((r) => { console.log('creator-stream', JSON.stringify(r)); return r; });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) { EdgeRuntime.waitUntil(job); return json(202, { listening: LISTEN_MS }); }
  return json(200, await job);
});
