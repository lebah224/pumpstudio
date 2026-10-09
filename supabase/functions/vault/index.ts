// Coffre-fort : convertir du SOL en USDT ou USDC (et inversement) pour se protéger des baisses du SOL.
// - devis et transactions à signer dans le navigateur (Phantom…) via Jupiter, gratuit et sans clé ;
// - règles automatiques (surplus, part des ventes, baisse du SOL, montant régulier, envoi vers une plateforme) ;
// - adresses de destination (dépôt Binance…), utilisables 24 h après leur ajout, avec code de confirmation ;
// - tâche planifiée (toutes les minutes) qui applique les règles : le wallet rapide du compte convertit lui-même,
//   sinon l'utilisateur reçoit une notification pour signer dans son wallet.
// Les fonds ne quittent jamais le wallet de l'utilisateur, sauf envoi vers une destination qu'il a lui-même enregistrée.
import webpush from 'npm:web-push@3.6.7';
import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from 'npm:@solana/web3.js@1.98.4';
import { Buffer } from 'node:buffer';
import { admin, alertMail, audit, claims, cors, Fail, json, rate, requireStepUp, requireUser } from '../_shared/security.ts';

const WSOL = 'So11111111111111111111111111111111111111112';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const STABLES: Record<string, { mint: string; dec: number }> = {
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', dec: 6 },
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', dec: 6 },
};
const JUP_API = 'https://lite-api.jup.ag/swap/v1';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ataOf = (owner: string, mint: string) => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA))[0];

/* ---------- RPC ---------- */
const upstreams = () => {
  const own = (Deno.env.get('SOLANA_RPC_URL') ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('https://'));
  return own.length ? own : ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
};
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (const url of upstreams()) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.error) throw new Fail(400, 'Lecture de la blockchain impossible.');
      return j.result as T;
    } catch (e) { if (e instanceof Fail) throw e; }
  }
  throw new Fail(502, 'Blockchain injoignable : réessayez dans un instant.');
}
async function stableBal(owner: string, mint: string): Promise<number> {
  const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  return (r.value ?? []).reduce((a, x) => a + (x.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

/* ---------- prix et variation du SOL sur 24 h ---------- */
let solCache: { at: number; v: { price: number; change24: number } } | null = null;
async function solMarket() {
  if (solCache && Date.now() - solCache.at < 30_000) return solCache.v;
  let v: { price: number; change24: number } | null = null;
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT', { signal: AbortSignal.timeout(6000) });
    const j = await r.json(); const p = Number(j.lastPrice), c = Number(j.priceChangePercent);
    if (p > 0 && isFinite(c)) v = { price: p, change24: c };
  } catch { /* repli ci-dessous */ }
  if (!v) {
    try {
      const r = await fetch('https://api.exchange.coinbase.com/products/SOL-USD/stats', { headers: { 'User-Agent': 'tokenstudio' }, signal: AbortSignal.timeout(6000) });
      const j = await r.json(); const p = Number(j.last), o = Number(j.open);
      if (p > 0 && o > 0) v = { price: p, change24: (p / o - 1) * 100 };
    } catch { /* indisponible */ }
  }
  if (!v) throw new Fail(502, 'Prix du SOL indisponible.');
  solCache = { at: Date.now(), v };
  return v;
}

/* ---------- devis Jupiter ---------- */
function pair(from: unknown, to: unknown) {
  const protect = from === 'SOL';
  const stable = String(protect ? to : from), S = STABLES[stable];
  if (!S || (!protect && to !== 'SOL')) throw new Fail(400, 'Échange possible seulement entre SOL et USDT ou USDC.');
  return { protect, stable, S, inMint: protect ? WSOL : S.mint, outMint: protect ? S.mint : WSOL, inDec: protect ? 9 : S.dec, outDec: protect ? S.dec : 9 };
}
async function quote(from: unknown, to: unknown, amount: unknown) {
  const P = pair(from, to), amt = Number(amount);
  if (!(amt > 0) || amt > 1e9) throw new Fail(400, 'Montant invalide.');
  const raw = BigInt(Math.floor(amt * 10 ** P.inDec));
  if (raw <= 0n) throw new Fail(400, 'Montant trop petit.');
  const r = await fetch(JUP_API + '/quote?inputMint=' + P.inMint + '&outputMint=' + P.outMint + '&amount=' + raw + '&slippageBps=50&restrictIntermediateTokens=true', { signal: AbortSignal.timeout(10_000) });
  const q = await r.json().catch(() => null);
  if (!r.ok || !q?.outAmount) throw new Fail(502, 'Aucun prix disponible pour cet échange : réessayez dans un instant.');
  const out = Number(q.outAmount) / 10 ** P.outDec, minOut = Number(q.otherAmountThreshold) / 10 ** P.outDec;
  const route = ((q.routePlan ?? []) as { swapInfo?: { label?: string } }[]).map((x) => String(x.swapInfo?.label ?? '')).filter(Boolean).slice(0, 4);
  return { P, q, view: { from, to, in: amt, out, minOut, impact: Number(q.priceImpactPct) * 100 || 0, rate: P.protect ? out / amt : amt / out, route } };
}

/* ---------- transactions à signer dans le navigateur (wallet externe) ---------- */
async function buildSwap(from: unknown, to: unknown, amount: unknown, owner: unknown) {
  if (typeof owner !== 'string' || !B58.test(owner)) throw new Fail(400, 'Wallet invalide.');
  const { q, view } = await quote(from, to, amount);
  if (view.impact > 1) throw new Fail(422, 'Impact sur le prix trop élevé (plus de 1 %) : réduisez le montant.');
  const r = await fetch(JUP_API + '/swap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ quoteResponse: q, userPublicKey: owner, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500_000, priorityLevel: 'high' } } }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || typeof j?.swapTransaction !== 'string') throw new Fail(502, 'Préparation de l\'échange impossible : réessayez.');
  return { tx: j.swapTransaction as string, quote: view };
}
async function knownDest(uid: string, to: string) {
  const [{ data: w }, { data: v }] = await Promise.all([
    admin.from('wallets').select('address').eq('user_id', uid).eq('address', to).maybeSingle(),
    admin.from('vault_addresses').select('address').eq('user_id', uid).eq('address', to).maybeSingle(),
  ]);
  return !!(w || v);
}
async function buildSend(uid: string, stable: unknown, to: unknown, amount: unknown, owner: unknown) {
  const S = STABLES[String(stable)];
  if (!S) throw new Fail(400, 'Seuls USDT et USDC peuvent être envoyés depuis le coffre.');
  if (typeof owner !== 'string' || !B58.test(owner) || typeof to !== 'string' || !B58.test(to)) throw new Fail(400, 'Adresse invalide.');
  if (!(await knownDest(uid, to))) throw new Fail(403, 'Enregistrez d\'abord cette adresse dans le coffre-fort.');
  const amt = Number(amount); if (!(amt >= 1)) throw new Fail(400, 'Minimum 1 ' + stable + '.');
  const raw = BigInt(Math.floor(amt * 10 ** S.dec));
  const data = new Uint8Array(10); data[0] = 12; new DataView(data.buffer).setBigUint64(1, raw, true); data[9] = S.dec;
  const payer = new PublicKey(owner), dst = ataOf(to, S.mint), mint = new PublicKey(S.mint);
  const { value } = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: value.blockhash, instructions: [
    new TransactionInstruction({ programId: new PublicKey(ATA), data: Buffer.from([1]), keys: [
      { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: new PublicKey(to), isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: new PublicKey(TOKEN), isSigner: false, isWritable: false }] }),
    new TransactionInstruction({ programId: new PublicKey(TOKEN), data: Buffer.from(data), keys: [
      { pubkey: ataOf(owner, S.mint), isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: false }] }),
  ] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  return { tx: btoa(String.fromCharCode(...tx.serialize())), amount: amt, symbol: stable };
}

/* ---------- règles ---------- */
type Rule = { id: string; user_id: string; kind: string; stable: string; params: Record<string, unknown>; active: boolean; last_run_at: string | null; last_result: Record<string, unknown> | null; next_at: string | null; created_at: string };
const num = (x: unknown, lo: number, hi: number, what: string) => { const v = Number(x); if (!(v >= lo && v <= hi)) throw new Fail(400, what + ' : entre ' + lo.toLocaleString('fr-FR') + ' et ' + hi.toLocaleString('fr-FR') + '.'); return v; };
async function cleanParams(uid: string, kind: string, p: Record<string, unknown>) {
  switch (kind) {
    case 'surplus': { const above = num(p.above, 0.1, 100000, 'Seuil'); const keep = num(p.keep, 0.05, above, 'SOL à garder'); if (above - keep < 0.05) throw new Fail(400, 'Le seuil doit dépasser d\'au moins 0,05 SOL le montant gardé.'); return { above, keep }; }
    case 'profit': return { pct: num(p.pct, 1, 100, 'Part des ventes') };
    case 'drop': return { drop: num(p.drop, 2, 50, 'Baisse du SOL'), pct: num(p.pct, 5, 100, 'Part à protéger') };
    case 'schedule': { if (p.every !== 'day' && p.every !== 'week') throw new Fail(400, 'Fréquence invalide.'); return { amount: num(p.amount, 0.01, 1000, 'Montant'), every: p.every }; }
    case 'send': {
      const to = String(p.to ?? '');
      if (!B58.test(to) || !(await knownDest(uid, to))) throw new Fail(400, 'Choisissez une adresse enregistrée dans le coffre-fort.');
      return { to, min: num(p.min, 1, 10_000_000, 'Montant minimum') };
    }
  }
  throw new Fail(400, 'Type de règle inconnu.');
}
async function ruleSave(uid: string, b: Record<string, unknown>) {
  const kind = String(b.kind ?? ''), stable = b.stable === 'USDC' ? 'USDC' : 'USDT';
  const params = await cleanParams(uid, kind, (b.params ?? {}) as Record<string, unknown>);
  if (kind === 'send') {
    const { data: sw } = await admin.from('server_wallets').select('address').eq('user_id', uid).maybeSingle();
    if (!sw) throw new Fail(400, 'L\'envoi automatique demande le wallet rapide : créez-le d\'abord dans Portefeuille.');
    await requireStepUp(uid, 'withdraw');   // une règle d'envoi déplace des fonds hors du wallet : code de confirmation
  }
  const id = typeof b.id === 'string' && /^[0-9a-f-]{36}$/.test(b.id) ? b.id : null;
  const row = { kind, stable, params, active: b.active !== false, next_at: kind === 'schedule' ? new Date().toISOString() : null, last_result: null };
  if (id) {
    const { data, error } = await admin.from('vault_rules').update(row).eq('id', id).eq('user_id', uid).select('id').maybeSingle();
    if (error || !data) throw new Fail(404, 'Règle introuvable.');
  } else {
    const { count } = await admin.from('vault_rules').select('id', { count: 'exact', head: true }).eq('user_id', uid);
    if ((count ?? 0) >= 10) throw new Fail(400, '10 règles au plus.');
    const { error } = await admin.from('vault_rules').insert({ user_id: uid, ...row });
    if (error) throw new Fail(500, 'Enregistrement impossible.');
  }
  await audit(uid, 'vault_rule_saved', { kind, stable, params });
  return { ok: true };
}

/* ---------- notifications sur les appareils ---------- */
let vapid = false;
async function push(uid: string, title: string, body: string) {
  try {
    if (!vapid) {
      const g = async (n: string) => (await admin.rpc('app_secret', { n })).data as string;
      webpush.setVapidDetails('https://tokenstudio-sol.vercel.app', await g('vapid_public'), await g('vapid_private'));
      vapid = true;
    }
    const { data: subs } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', uid);
    for (const s of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url: '/app?page=vault', tag: 'vault' }), { TTL: 3600, urgency: 'high' }); }
      catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await admin.from('push_subscriptions').delete().eq('id', s.id); }
    }
  } catch { /* notifications indisponibles */ }
}
const fr = (n: number, d = 4) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });

/* ---------- tâche planifiée : application des règles ---------- */
async function internal(action: string, body: Record<string, unknown>, key: string) {
  const r = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/server-wallet', {
    method: 'POST', signal: AbortSignal.timeout(80_000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), 'x-watch-key': key },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j.error ?? 'erreur ' + r.status).slice(0, 160));
  return j as { signature: string; sol?: number; stable?: number; amount?: number; symbol?: string };
}
async function runRules(key: string) {
  const { data } = await admin.from('vault_rules').select('*').eq('active', true).limit(500);
  const rules = (data ?? []) as Rule[];
  if (!rules.length) return { rules: 0, done: 0 };
  const users = [...new Set(rules.map((r) => r.user_id))];
  const [{ data: sws }, { data: wls }] = await Promise.all([
    admin.from('server_wallets').select('user_id,address').in('user_id', users),
    admin.from('wallets').select('user_id,address,created_at').in('user_id', users).order('created_at'),
  ]);
  const server = new Map(((sws ?? []) as { user_id: string; address: string }[]).map((x) => [x.user_id, x.address]));
  const ext = new Map<string, string>(); ((wls ?? []) as { user_id: string; address: string }[]).forEach((x) => { if (!ext.has(x.user_id)) ext.set(x.user_id, x.address); });
  let market: { price: number; change24: number } | null = null;
  try { market = await solMarket(); } catch { market = null; }
  const bal = new Map<string, number>();
  const solOf = async (a: string) => { if (!bal.has(a)) bal.set(a, ((await rpc<{ value: number }>('getBalance', [a, { commitment: 'confirmed' }])).value) / 1e9); return bal.get(a)!; };
  const now = Date.now(); let done = 0;
  for (const r of rules) {
    if (done >= 8) break;   // au plus 8 opérations par minute : les suivantes passent à la minute d'après
    const srv = server.get(r.user_id), wallet = srv ?? ext.get(r.user_id);
    if (!wallet) continue;
    const last = r.last_run_at ? Date.parse(r.last_run_at) : 0, P = r.params as Record<string, number & string>;
    if (r.last_result?.ok === false && now - last < 30 * 60_000) continue;   // échec récent : nouvel essai dans 30 min
    let amount = 0, why = '', cursor: string | null = null;
    try {
      if (r.kind === 'surplus') {
        if (now - last < 10 * 60_000) continue;
        const b = await solOf(wallet); if (b <= Number(P.above)) continue;
        amount = b - Number(P.keep); why = 'solde au-dessus de ' + fr(Number(P.above)) + ' SOL';
      } else if (r.kind === 'drop') {
        if (!market || market.change24 > -Number(P.drop) || now - last < 24 * 3600_000) continue;
        amount = Math.max(0, (await solOf(wallet)) - 0.05) * Number(P.pct) / 100; why = 'SOL en baisse de ' + fr(-market.change24, 1) + ' % sur 24 h';
      } else if (r.kind === 'schedule') {
        if (r.next_at && Date.parse(r.next_at) > now) continue;
        amount = Math.min(Number(P.amount), Math.max(0, (await solOf(wallet)) - 0.05)); why = P.every === 'week' ? 'montant de la semaine' : 'montant du jour';
      } else if (r.kind === 'profit') {
        if (!srv) continue;   // les ventes du wallet rapide seulement : les autres wallets sont suivis dans le navigateur
        const since = (r.last_result?.cursor as string | undefined) ?? r.created_at;
        const { data: ops } = await admin.from('operations').select('sol,at').eq('user_id', r.user_id).eq('type', 'sell').eq('status', 'ok').eq('sim', false).gt('at', since).order('at');
        const L = (ops ?? []) as { sol: number; at: string }[];
        if (!L.length) continue;
        const gain = L.reduce((a, x) => a + Math.max(0, Number(x.sol)), 0);
        amount = gain * Number(P.pct) / 100; cursor = L[L.length - 1]!.at;
        if (amount < 0.01) { await admin.from('vault_rules').update({ last_result: { ok: true, cursor, skipped: 'petit montant' } }).eq('id', r.id); continue; }
        why = fr(Number(P.pct), 0) + ' % de vos ventes';
      } else if (r.kind === 'send') {
        if (!srv || now - last < 60 * 60_000) continue;
        const have = await stableBal(srv, STABLES[r.stable]!.mint); if (have < Number(P.min)) continue;
      } else continue;
      if (r.kind !== 'send' && amount < 0.01) continue;
      // verrou : une règle ne s'exécute qu'une fois, même si deux tâches se chevauchent
      const lockBefore = new Date(now - 50_000).toISOString();
      const { data: claimed } = await admin.from('vault_rules').update({ last_run_at: new Date().toISOString() }).eq('id', r.id).or('last_run_at.is.null,last_run_at.lt.' + lockBefore).select('id').maybeSingle();
      if (!claimed) continue;
      const nextAt = r.kind === 'schedule' ? new Date(now + (P.every === 'week' ? 7 * 86400_000 : 86400_000)).toISOString() : r.next_at;
      if (!srv) {
        // wallet externe : rien n'est signé sans l'utilisateur, on le prévient
        await push(r.user_id, 'Coffre-fort · ' + why, 'Convertissez ' + fr(amount) + ' SOL en ' + r.stable + ' : ouvrez TokenStudio pour signer avec votre wallet.');
        await admin.from('vault_rules').update({ last_result: { ok: true, notified: true, sol: amount }, next_at: nextAt }).eq('id', r.id);
        done++; continue;
      }
      if (r.kind === 'send') {
        const res = await internal('vault_send', { uid: r.user_id, stable: r.stable, to: P.to, amount: 'max', rule: r.id }, key);
        await admin.from('vault_rules').update({ last_result: { ok: true, sig: res.signature, amount: res.amount } }).eq('id', r.id);
        await push(r.user_id, 'Coffre-fort · envoi effectué', fr(res.amount ?? 0, 2) + ' ' + r.stable + ' envoyés vers votre adresse enregistrée.');
      } else {
        const res = await internal('vault_swap', { uid: r.user_id, from: 'SOL', to: r.stable, amount: Number(amount.toFixed(6)), rule: r.id }, key);
        await admin.from('vault_rules').update({ last_result: { ok: true, sig: res.signature, sol: res.sol, stable: res.stable, cursor }, next_at: nextAt }).eq('id', r.id);
        await push(r.user_id, 'Coffre-fort · ' + why, fr(res.sol ?? amount) + ' SOL convertis en ' + fr(res.stable ?? 0, 2) + ' ' + r.stable + '.');
      }
      done++;
    } catch (e) {
      const msg = (e as Error).message || 'erreur';
      await admin.from('vault_rules').update({ last_run_at: new Date().toISOString(), last_result: { ok: false, error: msg.slice(0, 160) } }).eq('id', r.id);
      if (!/no_wallet/.test(msg)) await push(r.user_id, 'Coffre-fort · règle en échec', msg.slice(0, 120) + ' Nouvel essai dans 30 minutes.');
    }
  }
  return { rules: rules.length, done, sol: market };
}

const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);
  const wk = req.headers.get('x-watch-key');
  if (wk) {
    const { data: key } = await admin.rpc('app_secret', { n: 'watch_key' });
    if (!key || !same(wk, key as string)) return json(401, { error: 'Clé invalide.' }, h);
    try { return json(200, await runRules(key as string), h); } catch (e) { return json(500, { error: (e as Error).message }, h); }
  }
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(400, { error: 'Requête invalide.' }, h); }
  try {
    const action = String(b.action ?? '');
    // devis et prix du SOL : aussi pour la démo (sans compte)
    if (action === 'quote' || action === 'market') {
      const c = claims(req), who = String(c.sub ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0] ?? 'x');
      await rate('vault_q:' + who, 240, 3600);
      if (action === 'market') return json(200, await solMarket(), h);
      return json(200, (await quote(b.from, b.to, b.amount)).view, h);
    }
    const user = await requireUser(req), uid = user.id;
    if ((claims(req).is_anonymous as boolean | undefined) === true) throw new Fail(403, 'Le coffre-fort demande un compte.');
    await rate('vault:' + uid, 120, 3600);
    switch (action) {
      case 'build': return json(200, await buildSwap(b.from, b.to, b.amount, b.owner), h);
      case 'send_tx': return json(200, await buildSend(uid, b.stable, b.to, b.amount, b.owner), h);
      case 'rule_save': return json(200, await ruleSave(uid, b), h);
      case 'rule_toggle': {
        const { error } = await admin.from('vault_rules').update({ active: !!b.active, last_result: null }).eq('id', String(b.id)).eq('user_id', uid);
        if (error) throw new Fail(500, 'Modification impossible.');
        return json(200, { ok: true }, h);
      }
      case 'rule_delete': {
        await admin.from('vault_rules').delete().eq('id', String(b.id)).eq('user_id', uid);
        await audit(uid, 'vault_rule_deleted', { id: b.id });
        return json(200, { ok: true }, h);
      }
      case 'addr_add': {
        const address = String(b.address ?? '').trim(), label = String(b.label ?? '').trim().slice(0, 32);
        if (!B58.test(address)) throw new Fail(400, 'Adresse Solana invalide.');
        try { new PublicKey(address); } catch { throw new Fail(400, 'Adresse Solana invalide.'); }
        const { count } = await admin.from('vault_addresses').select('id', { count: 'exact', head: true }).eq('user_id', uid);
        if ((count ?? 0) >= 10) throw new Fail(400, '10 adresses au plus.');
        await requireStepUp(uid, 'link_wallet');
        const { error } = await admin.from('vault_addresses').insert({ user_id: uid, address, label });
        if (error) throw new Fail(/duplicate|unique/i.test(error.message) ? 409 : 500, /duplicate|unique/i.test(error.message) ? 'Cette adresse est déjà enregistrée.' : 'Enregistrement impossible.');
        await audit(uid, 'vault_address_added', { address, label });
        alertMail(user, 'address_added', { address, label }).catch(() => {});
        return json(200, { ok: true }, h);
      }
      case 'addr_delete': {
        const { data: a } = await admin.from('vault_addresses').select('address').eq('id', String(b.id)).eq('user_id', uid).maybeSingle();
        if (!a) throw new Fail(404, 'Adresse introuvable.');
        await admin.from('vault_rules').update({ active: false }).eq('user_id', uid).eq('kind', 'send').eq('params->>to', a.address);
        await admin.from('vault_addresses').delete().eq('id', String(b.id)).eq('user_id', uid);
        await audit(uid, 'vault_address_removed', { address: a.address });
        return json(200, { ok: true }, h);
      }
    }
    throw new Fail(400, 'Action inconnue.');
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message, ...e.extra }, h);
    return json(500, { error: 'Erreur technique : réessayez.' }, h);
  }
});
