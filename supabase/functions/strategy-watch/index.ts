// Stratégies de sortie : appelée toutes les 5 secondes par la tâche planifiée (clé de surveillance).
// Pour chaque position suivie, elle lit les dernières transactions du token (pump.fun, courbe et PumpSwap), calcule
// le gain, le recul depuis le plus haut, les achats et ventes des autres après notre achat, la vente du créateur,
// la durée et la capitalisation, puis fait vendre le wallet rapide par la fonction server-wallet dès qu'une règle est
// remplie. Chaque règle ne s'exécute qu'une fois ; elle ne signe jamais rien elle-même.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const WSOL = 'So11111111111111111111111111111111111111112';
const PUMP_H = { Accept: 'application/json', Origin: 'https://pump.fun', Referer: 'https://pump.fun/' };

let keys: { pub: string; priv: string; watch: string } | null = null;
async function secrets() {
  if (keys) return keys;
  const get = async (n: string) => { const { data, error } = await admin.rpc('app_secret', { n }); if (error || !data) throw new Error('secret ' + n); return data as string; };
  keys = { pub: await get('vapid_public'), priv: await get('vapid_private'), watch: await get('watch_key') };
  webpush.setVapidDetails('https://tokenstudio-sol.vercel.app', keys.pub, keys.priv);
  return keys;
}

/* ---------- types ---------- */
type Cond = { k: 'gain' | 'loss' | 'trail' | 'buys' | 'sells' | 'sell_sol' | 'creator_sell' | 'age' | 'mcap'; v?: number; arm?: number };
type Rule = { id: string; all: Cond[]; sell: number };
type Strat = {
  id: string; user_id: string; mint: string; symbol: string | null; name: string | null; wallet: string | null; creator: string | null;
  entry_at: string; entry_price: number | null; entry_tokens: number | null; slippage: number; rules: Rule[]; status: string;
  state: { fired?: string[]; peak?: number; ref?: number; fails?: number; retry_at?: number; log?: { t: number; rule: string; ok: boolean; msg: string; sig?: string; sol?: number }[] };
};
type Trade = { t: number; w: string; side: 'buy' | 'sell'; sol: number; pSol: number; pUsd: number | null };
type Market = { price: number | null; mcapUsd: number | null; trades: Trade[] | null };

/* ---------- marché ---------- */
const num = (x: unknown) => { const v = Number(x); return isFinite(v) ? v : null; };
async function pumpTrades(mint: string): Promise<Trade[] | null> {
  try {
    const r = await fetch('https://swap-api.pump.fun/v2/coins/' + mint + '/trades?limit=100', { headers: PUMP_H, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    return ((j?.trades ?? []) as Record<string, unknown>[]).map((x) => ({
      t: Date.parse(String(x.timestamp)) || 0, w: String(x.userAddress ?? ''), side: x.type === 'sell' ? 'sell' as const : 'buy' as const,
      sol: num(x.amountSol) ?? 0, pSol: num(x.priceSol) ?? 0, pUsd: num(x.priceUsd),
    })).filter((x) => x.t && x.pSol > 0).sort((a, b) => b.t - a.t);
  } catch { return null; }
}
async function dexPrices(mints: string[]) {
  const out = new Map<string, { price: number; mcapUsd: number | null }>();
  for (let i = 0; i < mints.length; i += 30) {
    try {
      const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + mints.slice(i, i + 30).join(','), { signal: AbortSignal.timeout(6000) });
      const list = (await r.json()) as { baseToken?: { address: string }; quoteToken?: { address: string }; priceNative?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number } }[];
      const best = new Map<string, (typeof list)[number]>();
      for (const p of Array.isArray(list) ? list : []) {
        const m = p.baseToken?.address; if (!m || p.quoteToken?.address !== WSOL) continue;
        const cur = best.get(m); if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(m, p);
      }
      best.forEach((p, m) => { const price = Number(p.priceNative); if (price > 0) out.set(m, { price, mcapUsd: Number(p.marketCap || p.fdv) || null }); });
    } catch { /* indisponible : prochain passage */ }
  }
  return out;
}
async function markets(mints: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  const tr = await Promise.all(mints.map((m) => pumpTrades(m)));
  const missing: string[] = [];
  mints.forEach((m, i) => {
    const L = tr[i] ?? null, last = L?.[0];
    if (last) out.set(m, { price: last.pSol, mcapUsd: last.pUsd != null ? last.pUsd * 1e9 : null, trades: L });   // offre pump.fun : 1 milliard
    else { out.set(m, { price: null, mcapUsd: null, trades: L }); missing.push(m); }
  });
  if (missing.length) (await dexPrices(missing)).forEach((q, m) => { const x = out.get(m)!; x.price = q.price; x.mcapUsd = q.mcapUsd; });
  return out;
}

/* ---------- évaluation ---------- */
const pct = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
function facts(s: Strat, m: Market, ours: Set<string>) {
  const since = Date.parse(s.entry_at), after = (m.trades ?? []).filter((x) => x.t > since && !ours.has(x.w));
  const ref = Number(s.entry_price) || s.state.ref || m.price || null;
  const tops = (m.trades ?? []).filter((x) => x.t > since).map((x) => x.pSol);
  const peak = Math.max(s.state.peak ?? 0, m.price ?? 0, ...tops);
  return {
    price: m.price, ref, peak: peak || null, mcapUsd: m.mcapUsd,
    buys: after.filter((x) => x.side === 'buy').length, sells: after.filter((x) => x.side === 'sell').length,
    sellSol: after.filter((x) => x.side === 'sell').reduce((a, x) => a + x.sol, 0),
    creatorSold: !!s.creator && after.some((x) => x.w === s.creator && x.side === 'sell'),
    capped: (m.trades?.length ?? 0) >= 100 && after.length >= 100,
    ageMin: (Date.now() - since) / 60000, hasTrades: m.trades != null,
  };
}
type F = ReturnType<typeof facts>;
function check(c: Cond, f: F): { ok: boolean; why: string } {
  const v = Number(c.v) || 0;
  switch (c.k) {
    case 'gain': return { ok: !!(f.price && f.ref && f.price >= f.ref * (1 + v / 100)), why: 'gain de +' + pct(v) + ' %' };
    case 'loss': return { ok: !!(f.price && f.ref && f.price <= f.ref * (1 - v / 100)), why: 'perte de −' + pct(v) + ' %' };
    case 'trail': {
      const arm = Number(c.arm) || 0, armed = !!(f.peak && f.ref && f.peak >= f.ref * (1 + arm / 100));
      return { ok: !!(armed && f.price && f.peak && f.price <= f.peak * (1 - v / 100)), why: 'recul de ' + pct(v) + ' % depuis le plus haut' };
    }
    case 'buys': return { ok: f.hasTrades && f.buys >= v, why: Math.round(v) + ' achat' + (v > 1 ? 's' : '') + ' après le vôtre' };
    case 'sells': return { ok: f.hasTrades && f.sells >= v, why: Math.round(v) + ' vente' + (v > 1 ? 's' : '') + ' après votre achat' };
    case 'sell_sol': return { ok: f.hasTrades && f.sellSol >= v, why: pct(v) + ' SOL vendus par les autres' };
    case 'creator_sell': return { ok: f.creatorSold, why: 'le créateur a vendu' };
    case 'age': return { ok: f.ageMin >= v, why: Math.round(v) + ' min écoulées' };
    case 'mcap': return { ok: !!(f.mcapUsd && f.mcapUsd >= v), why: 'capitalisation de ' + Math.round(v).toLocaleString('fr-FR') + ' $' };
  }
  return { ok: false, why: '' };
}

/* ---------- vente et notifications ---------- */
async function sell(s: Strat, rule: Rule, watchKey: string) {
  try {
    const r = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/server-wallet', {
      method: 'POST', signal: AbortSignal.timeout(55_000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), 'x-watch-key': watchKey },
      body: JSON.stringify({ action: 'auto_sell', uid: s.user_id, mint: s.mint, pct: Math.min(100, Math.max(1, Number(rule.sell) || 100)), slippage: Number(s.slippage) || 25, address: s.wallet, priority: 0.001 }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && !!j.signature, ...j } as { ok: boolean; signature?: string; sol?: number; tokens?: number; confirmed?: boolean; error?: string };
  } catch (e) { return { ok: false, error: (e as Error).message || 'injoignable' }; }
}
async function push(uid: string, title: string, body: string, tag: string) {
  const { data: subs } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', uid);
  for (const s of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url: '/app?page=trade', tag }), { TTL: 3600, urgency: 'high', topic: tag.slice(0, 32) }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await admin.from('push_subscriptions').delete().eq('id', s.id); }
  }
}
const solTxt = (n: number) => (Math.round(n * 10000) / 10000).toString().replace('.', ',');

async function run(watchKey: string) {
  if (!(await admin.rpc('strategy_lease', { p_seconds: 20 })).data) return { skipped: true };
  let due: Strat[] = [];
  const fires: { s: Strat; rule: Rule; why: string }[] = [];
  try {
    const { data, error } = await admin.rpc('strategies_due');
    if (error) throw new Error(error.message);
    due = (data ?? []) as Strat[];
    if (!due.length) return { strategies: 0 };
    const users = [...new Set(due.map((s) => s.user_id))];
    const { data: sw } = await admin.from('server_wallets').select('user_id,address').in('user_id', users);
    const ours = new Map<string, Set<string>>();
    (sw ?? []).forEach((w: { user_id: string; address: string }) => { const set = ours.get(w.user_id) ?? new Set<string>(); set.add(w.address); ours.set(w.user_id, set); });
    const mk = await markets([...new Set(due.map((s) => s.mint))]);
    const marks: { id: string; state: Record<string, unknown> }[] = [];
    for (const s of due) {
      if (s.state.retry_at && s.state.retry_at > Date.now()) continue;
      const m = mk.get(s.mint); if (!m) continue;
      const f = facts(s, m, ours.get(s.user_id) ?? new Set());
      const fired = new Set(s.state.fired ?? []);
      marks.push({ id: s.id, state: { peak: f.peak, ref: s.state.ref ?? (Number(s.entry_price) ? undefined : f.price), seen: { at: Date.now(), price: f.price, mcapUsd: f.mcapUsd, buys: f.buys, sells: f.sells, sellSol: Math.round(f.sellSol * 1e4) / 1e4, creatorSold: f.creatorSold, capped: f.capped } } });
      for (const rule of s.rules) {
        if (fired.has(rule.id) || !rule.all?.length) continue;
        const res = rule.all.map((c) => check(c, f));
        if (res.every((x) => x.ok)) { fires.push({ s, rule, why: res.map((x) => x.why).join(' et ') }); break; }   // une règle par passage
      }
    }
    if (marks.length) await admin.rpc('strategies_mark', { rows: marks });
  } finally { await admin.rpc('strategy_unlease'); }

  // ventes (en parallèle, chaque stratégie verrouillée)
  let sold = 0;
  await Promise.all(fires.map(async ({ s, rule, why }) => {
    if (!(await admin.rpc('strategy_claim', { p_id: s.id })).data) return;
    const sym = s.symbol || s.mint.slice(0, 4);
    const r = await sell(s, rule, watchKey);
    const fired = [...new Set([...(s.state.fired ?? []), rule.id])];
    const log = [...(s.state.log ?? []), { t: Date.now(), rule: rule.id, ok: r.ok, msg: why, sig: r.signature, sol: r.sol }].slice(-20);
    const Why = why[0]!.toUpperCase() + why.slice(1);
    if (r.ok && r.signature) {
      sold++;
      const left = s.rules.filter((x) => !fired.includes(x.id)).length;
      const finished = rule.sell >= 100 || !left;
      await admin.rpc('strategy_save', { p_id: s.id, p_state: { fired, log, fails: 0, retry_at: 0, last: { t: Date.now(), sig: r.signature, sol: r.sol ?? 0 } }, p_status: finished ? 'done' : null });
      await admin.from('operations').insert({ user_id: s.user_id, client_id: 'stg-' + s.id.slice(0, 8) + '-' + Date.now().toString(36), type: 'sell', status: 'ok',
        mint: s.mint, symbol: s.symbol, sol: r.sol ?? 0, tokens: -(r.tokens ?? 0), estimated: !r.confirmed, auto: true, signature: r.signature, at: new Date().toISOString() });
      await push(s.user_id, 'Vendu · ' + sym, Why + ' : ' + (rule.sell >= 100 ? 'tout vendu' : rule.sell + ' % vendus') + (r.sol ? ' · +' + solTxt(r.sol) + ' SOL' : '') + '.', 'stg-' + s.id);
    } else if (r.error === 'no_tokens' || r.error === 'no_wallet') {
      // plus rien à vendre dans les wallets rapides : la stratégie s'arrête
      await admin.rpc('strategy_save', { p_id: s.id, p_state: { fired, log, end: 'no_tokens' }, p_status: 'done' });
      await push(s.user_id, 'Stratégie terminée · ' + sym, Why + ', mais vos wallets rapides ne détiennent plus ce token.', 'stg-' + s.id);
    } else {
      const fails = (s.state.fails ?? 0) + 1, stop = fails >= 5;
      await admin.rpc('strategy_save', { p_id: s.id, p_state: { log, fails, retry_at: Date.now() + Math.min(60_000, 5_000 * fails), last_error: (r.error ?? 'erreur').slice(0, 160) }, p_status: stop ? 'error' : null });
      if (fails === 1 || stop) await push(s.user_id, (stop ? 'Stratégie en erreur · ' : 'Vente en échec · ') + sym, Why + '. ' + (stop ? 'Cinq essais ont échoué : vendez depuis TokenStudio.' : 'Nouvel essai dans quelques secondes.') + ' (' + (r.error ?? '').slice(0, 70) + ')', 'stg-' + s.id);
    }
  }));
  return { strategies: due.length, fires: fires.length, sold };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  let k: Awaited<ReturnType<typeof secrets>>;
  try { k = await secrets(); } catch { return json(500, { error: 'Configuration du serveur incomplète.' }); }
  const key = req.headers.get('x-watch-key');
  if (!key || !same(key, k.watch)) return json(401, { error: 'Clé invalide.' });
  try { return json(200, await run(k.watch)); } catch (e) { return json(500, { error: (e as Error).message }); }
});
