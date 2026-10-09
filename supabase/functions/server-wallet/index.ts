// Wallet rapide serveur : la clé est chiffrée (AES-256-GCM, clé maître dans Vault) et ne quitte jamais cette fonction,
// sauf export demandé avec le mot de passe du wallet.
// Politique de signature : seulement des transactions de trading (pump.fun, PumpSwap, frais de créateur, comptes de
// tokens), simulées avant signature ; le SOL qui sort est compté dans la limite par achat et le plafond du jour.
// Retraits : uniquement vers les wallets liés et prouvés du compte, depuis plus de 24 heures (sauf le wallet de connexion).
// Actions sensibles (retrait, export, hausse du plafond, suppression) : mot de passe du wallet + code de confirmation.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction } from 'npm:@solana/web3.js@1.98.4';
import bs58 from 'npm:bs58@6.0.0';
import { Buffer } from 'node:buffer';
import type { User } from 'npm:@supabase/supabase-js@2.117.3';
import { alertMail, passwordError, rate, requireStepUp, Fail as Need } from '../_shared/security.ts';

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
class Fail extends Error { constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); } }

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => { let s = ''; u.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/* ---------- RPC : clé Helius du serveur si présente, sinon RPC publics ---------- */
const upstreams = () => {
  const own = (Deno.env.get('SOLANA_RPC_URL') ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('https://'));
  return own.length ? own : ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
};
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last = 'RPC injoignable';
  for (const url of upstreams()) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) { last = 'RPC ' + r.status; continue; }
      const j = await r.json();
      if (j.error) throw new Fail(400, 'RPC : ' + (j.error.message || 'erreur'));
      return j.result as T;
    } catch (e) { if (e instanceof Fail) throw e; last = 'RPC injoignable'; }
  }
  throw new Fail(502, last);
}

/* ---------- chiffrement de la clé et mot de passe ---------- */
let master: CryptoKey | null = null;
async function masterKey() {
  if (master) return master;
  const { data } = await admin.rpc('app_secret', { n: 'wallet_master_key' });
  if (!data) throw new Fail(500, 'Configuration du serveur incomplète.');
  master = await crypto.subtle.importKey('raw', unb64(data as string), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return master;
}
async function seal(secret: Uint8Array, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await masterKey(), secret);
  return { enc: b64(new Uint8Array(c)), iv: b64(iv) };
}
async function open(row: { enc: string; iv: string }, aad: string) {
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv), additionalData: enc.encode(aad) }, await masterKey(), unb64(row.enc));
  return Keypair.fromSecretKey(new Uint8Array(p));
}
const ITER = 150_000;
async function pwHash(pw: string, salt: Uint8Array, iter: number) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256)));
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

type Row = { address: string; daily_cap_sol: number; alert_balance_sol: number; enc: string; iv: string; pw_hash: string; pw_salt: string; pw_iter: number; fails: number; locked_until: string | null; spent_today: number };
async function load(uid: string): Promise<Row | null> {
  const { data, error } = await admin.rpc('srvw_get', { uid });
  if (error) throw new Fail(500, 'Lecture du wallet impossible.');
  return (data as Row[])?.[0] ?? null;
}
async function checkPw(uid: string, row: Row, pw: unknown) {
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) throw new Fail(429, 'Trop d\'essais : réessayez dans 15 minutes.');
  const ok = typeof pw === 'string' && same(await pwHash(pw, unb64(row.pw_salt), row.pw_iter), row.pw_hash);
  await admin.rpc('srvw_pw_result', { uid, ok });
  if (!ok) throw new Fail(403, 'Mot de passe incorrect.');
}
const audit = (uid: string, event: string, detail: Record<string, unknown>) => admin.from('audit_log').insert({ user_id: uid, event, detail });

/* ---------- politique de signature ---------- */
const SYSTEM = '11111111111111111111111111111111', CB = 'ComputeBudget111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const PUMP = new Set(['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', 'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e']);
const WSOL = 'So11111111111111111111111111111111111111112';
const u32 = (d: Uint8Array, o: number) => d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24);
const u64 = (d: Uint8Array, o: number) => Number(new DataView(d.buffer, d.byteOffset + o, 8).getBigUint64(0, true));
// sell : vente lancée par le serveur lui-même ; les frais de service ne sont pas plafonnés ici, car la simulation
// vérifie ensuite que le wallet ne perd pas de SOL
function policy(tx: VersionedTransaction, payer: string, sell = false) {
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== payer) throw new Fail(403, 'Transaction refusée : le wallet serveur doit payer la transaction.');
  const wsolAta = PublicKey.findProgramAddressSync([new PublicKey(payer).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(WSOL).toBuffer()], new PublicKey(ATA))[0].toBase58();
  let small = 0;
  for (const ix of tx.message.compiledInstructions) {
    const pid = keys[ix.programIdIndex];
    if (!pid) throw new Fail(403, 'Transaction refusée : programme inconnu.');
    if (pid === CB || pid === ATA || PUMP.has(pid)) continue;
    const d = ix.data;
    if (pid === SYSTEM) {
      const t = u32(d, 0);
      if (t === 0 || t === 3) continue;                       // création de compte (loyer des comptes de tokens)
      if (t === 2) {                                         // virement : vers son propre compte SOL enveloppé, ou petits frais (pourboire, frais de service)
        const to = keys[ix.accountKeyIndexes[1]!], lam = u64(d, 4);
        if (to === wsolAta) continue;
        small += lam; if (to && (sell || small <= 50_000_000)) continue; // 0,05 SOL au total
      }
      throw new Fail(403, 'Transaction refusée : virement de SOL non autorisé.');
    }
    if (pid === TOKEN || pid === TOKEN22) {
      const op = d[0];
      if (op === 17 || op === 1 || op === 16 || op === 18) continue;   // synchronisation et ouverture de compte
      if (op === 9 && keys[ix.accountKeyIndexes[1]!] === payer) continue; // fermeture vers le wallet lui-même
      throw new Fail(403, 'Transaction refusée : opération sur les tokens non autorisée (transfert, délégation…).');
    }
    throw new Fail(403, 'Transaction refusée : programme non autorisé (' + pid.slice(0, 6) + '…).');
  }
}

async function signSend(uid: string, row: Row, raw: unknown, sell = false) {
  if (typeof raw !== 'string' || raw.length > 4000) throw new Fail(400, 'Transaction invalide.');
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(unb64(raw)); } catch { throw new Fail(400, 'Transaction illisible.'); }
  policy(tx, row.address, sell);
  // simulation : combien de SOL sortent vraiment du wallet ?
  const [pre, sim] = await Promise.all([
    rpc<{ value: number }>('getBalance', [row.address, { commitment: 'confirmed' }]),
    rpc<{ value: { err: unknown; logs: string[] | null; accounts: ({ lamports: number } | null)[] | null } }>('simulateTransaction', [raw, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [row.address] } }]),
  ]);
  if (sim.value.err) throw new Fail(422, 'La blockchain refuse cette transaction (' + JSON.stringify(sim.value.err).slice(0, 120) + ').');
  const post = sim.value.accounts?.[0]?.lamports;
  if (post == null) throw new Fail(502, 'Simulation incomplète : réessayez.');
  const spent = Math.max(0, (pre.value - post) / 1e9);
  if (sell && pre.value - post > 10_000_000) throw new Fail(403, 'Vente refusée : elle ferait perdre du SOL au wallet.');
  const { data: pref } = await admin.from('preferences').select('max_buy_sol').eq('user_id', uid).maybeSingle();
  const maxBuy = Number(pref?.max_buy_sol ?? 1);
  if (spent > maxBuy + 0.05) throw new Fail(403, 'Au-delà de votre limite par achat (' + maxBuy + ' SOL). Modifiez-la dans Préférences si c\'est voulu.');
  const counted = spent > 0.001 ? spent : 0;
  if (counted) { const { error } = await admin.rpc('srvw_reserve', { uid, sol: counted }); if (error) throw new Fail(403, error.message); }
  try {
    const kp = await open(row, uid + ':' + row.address);
    if (kp.publicKey.toBase58() !== row.address) throw new Fail(500, 'Clé incohérente.');
    tx.sign([kp]);
    const signed = b64(tx.serialize());
    await rpc('sendTransaction', [signed, { encoding: 'base64', skipPreflight: true, maxRetries: 3 }]);
    const signature = bs58.encode(tx.signatures[0]!);
    await audit(uid, 'server_wallet_tx', { signature, spent_sol: Number(spent.toFixed(6)) });
    return { signature, raw: signed, spent };
  } catch (e) {
    if (counted) await admin.rpc('srvw_release', { uid, sol: counted });
    throw e;
  }
}

/* ---------- vente automatique d'un ordre (appel interne de la surveillance des ordres, même outil fermé) ---------- */
const B58RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function tokenHeld(owner: string, mint: string) {
  const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } } } }[] }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  let raw = 0n, dec = 6;
  for (const a of r.value ?? []) { const t = a.account.data.parsed.info.tokenAmount; raw += BigInt(t.amount); dec = t.decimals; }
  return { raw, dec };
}
async function autoSell(uid: string, body: Record<string, unknown>) {
  const row = await load(uid);
  if (!row) throw new Fail(404, 'no_wallet');
  const mint = String(body.mint ?? '');
  if (!B58RE.test(mint)) throw new Fail(400, 'Token invalide.');
  const held = await tokenHeld(row.address, mint);
  if (held.raw <= 0n) throw new Fail(409, 'no_tokens');
  const pct = Math.min(100, Math.max(0, Number(body.pct) || 100)), tok = Number(body.tokens);
  let amount = tok > 0 ? BigInt(Math.floor(tok * 10 ** held.dec)) : held.raw * BigInt(Math.round(pct * 100)) / 10000n;
  if (amount > held.raw) amount = held.raw;
  if (amount <= 0n) throw new Fail(409, 'no_tokens');
  const ui = Number(amount) / 10 ** held.dec, slippage = Math.min(50, Math.max(1, Number(body.slippage) || 25));
  const r = await fetch('https://pumpportal.fun/api/trade-local', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: row.address, action: 'sell', mint, amount: ui, denominatedInSol: 'false', slippage, priorityFee: 0.0005, pool: 'auto' }), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Fail(502, 'PumpPortal ne peut pas préparer la vente (' + r.status + ').');
  const raw = b64(new Uint8Array(await r.arrayBuffer()));
  const before = (await rpc<{ value: number }>('getBalance', [row.address, { commitment: 'confirmed' }])).value;
  const sent = await signSend(uid, row, raw, true);
  // confirmation (jusqu'à ~30 s)
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>('getSignatureStatuses', [[sent.signature]]).catch(() => null);
    const v = st?.value?.[0];
    if (v?.err) throw new Fail(422, 'Vente refusée par la blockchain (' + JSON.stringify(v.err).slice(0, 100) + ').');
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) ok = true;
  }
  const after = (await rpc<{ value: number }>('getBalance', [row.address, { commitment: 'confirmed' }])).value;
  await audit(uid, 'server_auto_sell', { signature: sent.signature, mint, tokens: ui, confirmed: ok });
  return { signature: sent.signature, confirmed: ok, sol: Math.max(0, (after - before) / 1e9), tokens: ui };
}

const loginWallet = (u: User) => {
  const id = u.identities?.find((i) => i.provider === 'web3');
  const a = (id?.identity_data as { address?: string } | undefined)?.address || id?.id?.split(':').pop();
  return a && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
};
const DELAY_H = 24;
// destinations autorisées : wallets liés et prouvés, ou adresses du coffre-fort (plateforme d'échange…), après 24 h
async function destination(user: User, to: string) {
  const uid = user.id;
  const [{ data: w }, { data: v }] = await Promise.all([
    admin.from('wallets').select('address, verified_at').eq('user_id', uid).eq('address', to).maybeSingle(),
    admin.from('vault_addresses').select('address, created_at').eq('user_id', uid).eq('address', to).maybeSingle(),
  ]);
  if (!w && !v) throw new Fail(403, 'Envoi refusé : la destination doit être un wallet lié à votre compte ou une adresse enregistrée dans le coffre-fort.');
  if (to === loginWallet(user)) return;
  // une destination ajoutée récemment ne reçoit rien pendant 24 h : une session volée ne peut pas vider le wallet rapide
  const since = Math.min(w ? Date.parse(w.verified_at) : Infinity, v ? Date.parse(v.created_at) : Infinity);
  const age = (Date.now() - since) / 3600_000;
  if (age < DELAY_H) throw new Fail(403, 'Cette destination a été ajoutée il y a moins de 24 heures : par sécurité, elle pourra recevoir des fonds dans ' + Math.ceil(DELAY_H - age) + ' h.', { code: 'cooldown' });
}
async function withdraw(user: User, row: Row, to: unknown, amount: unknown) {
  const uid = user.id;
  if (typeof to !== 'string') throw new Fail(400, 'Adresse de destination manquante.');
  await destination(user, to);
  const bal = (await rpc<{ value: number }>('getBalance', [row.address, { commitment: 'confirmed' }])).value;
  const fee = 5000;
  const lam = amount === 'max' ? bal - fee : Math.round(Number(amount) * 1e9);
  if (!(lam > 0) || lam + fee > bal) throw new Fail(400, 'Montant invalide ou solde insuffisant.');
  await requireStepUp(uid, 'withdraw');
  const kp = await open(row, uid + ':' + row.address);
  const { value } = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: value.blockhash }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(to), lamports: lam }));
  tx.sign(kp);
  const raw = b64(tx.serialize());
  await rpc('sendTransaction', [raw, { encoding: 'base64', maxRetries: 3 }]);
  const signature = bs58.encode(tx.signature!);
  await audit(uid, 'server_wallet_withdraw', { signature, to, sol: lam / 1e9 });
  alertMail(user, 'withdraw', { sol: Number((lam / 1e9).toFixed(6)), to, signature }).catch(() => {});
  return { signature, raw, sol: lam / 1e9 };
}

/* ---------- coffre-fort : SOL ↔ USDT/USDC dans le wallet rapide (Jupiter), envoi des stablecoins ---------- */
const STABLES: Record<string, { mint: string; dec: number }> = {
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', dec: 6 },
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', dec: 6 },
};
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', JUP_API = 'https://lite-api.jup.ag/swap/v1';
const SOL_RESERVE = 20_000_000;   // 0,02 SOL gardés pour les frais
const ataOf = (owner: string, mint: string) => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA))[0].toBase58();
const tokAmount = (b64data: string | undefined) => { if (!b64data) return 0n; const d = unb64(b64data); return d.length >= 72 ? new DataView(d.buffer, d.byteOffset + 64, 8).getBigUint64(0, true) : 0n; };
async function stableHeld(owner: string, mint: string) { return (await tokenHeld(owner, mint)).raw; }

// transaction d'échange Jupiter : seuls Jupiter, le budget de calcul, les comptes de tokens et l'enveloppe du SOL sont admis
function swapPolicy(tx: VersionedTransaction, payer: string) {
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== payer) throw new Fail(403, 'Échange refusé : le wallet doit payer la transaction.');
  const wsolAta = ataOf(payer, WSOL);
  for (const ix of tx.message.compiledInstructions) {
    const pid = keys[ix.programIdIndex];
    if (pid === CB || pid === ATA || pid === JUP) continue;
    const d = ix.data;
    if (pid === SYSTEM) { const t = u32(d, 0); if (t === 0 || t === 3) continue; if (t === 2 && keys[ix.accountKeyIndexes[1]!] === wsolAta) continue; }
    if (pid === TOKEN) { const op = d[0]; if (op === 17 || op === 1 || op === 16 || op === 18) continue; if (op === 9 && keys[ix.accountKeyIndexes[1]!] === payer) continue; }
    throw new Fail(403, 'Échange refusé : instruction non autorisée.');
  }
}
async function confirm(signature: string) {
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>('getSignatureStatuses', [[signature]]).catch(() => null);
    const v = st?.value?.[0];
    if (v?.err) throw new Fail(422, 'Transaction refusée par la blockchain (' + JSON.stringify(v.err).slice(0, 100) + ').');
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return true;
  }
  return false;
}
type Move = { kind: 'protect' | 'release' | 'send'; stable: string; sol?: number | null; stable_amount?: number | null; dest?: string | null; signature?: string | null; auto?: boolean; rule_id?: string | null; status?: 'ok' | 'err'; error?: string | null };
const logMove = (uid: string, wallet: string, m: Move) => admin.from('vault_moves').insert({ user_id: uid, wallet, auto: false, status: 'ok', ...m, rule_id: m.rule_id && /^[0-9a-f-]{36}$/.test(m.rule_id) ? m.rule_id : null, error: m.error ? m.error.slice(0, 300) : null });

/** from / to : 'SOL', 'USDT' ou 'USDC' ; amount : montant à convertir (unités lisibles) */
async function vaultSwap(uid: string, row: Row, from: unknown, to: unknown, amount: unknown, rule: string | null = null) {
  const protect = from === 'SOL', stable = String(protect ? to : from);
  const S = STABLES[stable];
  if (!S || (protect ? to : from) === 'SOL' || (!protect && to !== 'SOL')) throw new Fail(400, 'Échange possible seulement entre SOL et USDT ou USDC.');
  const amt = Number(amount);
  if (!(amt > 0) || amt > 1e9) throw new Fail(400, 'Montant invalide.');
  const solBal = (await rpc<{ value: number }>('getBalance', [row.address, { commitment: 'confirmed' }])).value;
  let raw: bigint;
  if (protect) {
    raw = BigInt(Math.floor(amt * 1e9));
    if (raw < 10_000_000n) throw new Fail(400, 'Minimum 0,01 SOL.');
    if (Number(raw) > solBal - SOL_RESERVE) throw new Fail(400, 'Solde insuffisant : gardez au moins 0,02 SOL pour les frais.');
  } else {
    raw = BigInt(Math.floor(amt * 10 ** S.dec));
    const held = await stableHeld(row.address, S.mint);
    if (raw > held) raw = held;
    if (raw < 1_000_000n) throw new Fail(400, 'Minimum 1 ' + stable + '.');
    if (solBal < 5_000_000) throw new Fail(400, 'Il faut au moins 0,005 SOL pour payer les frais.');
  }
  const inMint = protect ? WSOL : S.mint, outMint = protect ? S.mint : WSOL;
  const qr = await fetch(JUP_API + '/quote?inputMint=' + inMint + '&outputMint=' + outMint + '&amount=' + raw + '&slippageBps=50&restrictIntermediateTokens=true', { signal: AbortSignal.timeout(10_000) });
  const q = await qr.json().catch(() => null);
  if (!qr.ok || !q?.outAmount) throw new Fail(502, 'Aucun prix disponible pour cet échange : réessayez dans un instant.');
  if (Number(q.priceImpactPct) > 0.01) throw new Fail(422, 'Impact sur le prix trop élevé (plus de 1 %) : réduisez le montant.');
  const sr = await fetch(JUP_API + '/swap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ quoteResponse: q, userPublicKey: row.address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500_000, priorityLevel: 'high' } } }) });
  const sj = await sr.json().catch(() => null);
  if (!sr.ok || typeof sj?.swapTransaction !== 'string') throw new Fail(502, 'Préparation de l\'échange impossible : réessayez.');
  const tx = VersionedTransaction.deserialize(unb64(sj.swapTransaction));
  swapPolicy(tx, row.address);
  // simulation : le SOL et le stablecoin bougent-ils comme prévu ?
  const stableAta = ataOf(row.address, S.mint);
  const pre = await rpc<{ value: ({ data: [string, string] } | null)[] }>('getMultipleAccounts', [[stableAta], { encoding: 'base64', commitment: 'confirmed' }]);
  const preTok = tokAmount(pre.value?.[0]?.data?.[0]);
  const sim = await rpc<{ value: { err: unknown; accounts: ({ lamports: number; data: [string, string] } | null)[] | null } }>('simulateTransaction', [sj.swapTransaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [row.address, stableAta] } }]);
  if (sim.value.err) throw new Fail(422, 'La blockchain refuse cet échange (' + JSON.stringify(sim.value.err).slice(0, 100) + ').');
  const postSol = sim.value.accounts?.[0]?.lamports, postTok = tokAmount(sim.value.accounts?.[1]?.data?.[0]);
  if (postSol == null) throw new Fail(502, 'Simulation incomplète : réessayez.');
  const minOut = BigInt(q.otherAmountThreshold);
  if (protect) {
    if (solBal - postSol > Number(raw) + 10_000_000) throw new Fail(403, 'Échange refusé : il coûterait plus de SOL que prévu.');
    if (postTok - preTok < minOut) throw new Fail(403, 'Échange refusé : moins de ' + stable + ' reçus que prévu.');
  } else {
    if (preTok - postTok > raw) throw new Fail(403, 'Échange refusé : il prendrait plus de ' + stable + ' que prévu.');
    if (postSol - solBal < Number(minOut) - 10_000_000) throw new Fail(403, 'Échange refusé : moins de SOL reçus que prévu.');
  }
  const kp = await open(row, uid + ':' + row.address);
  if (kp.publicKey.toBase58() !== row.address) throw new Fail(500, 'Clé incohérente.');
  tx.sign([kp]);
  const signed = b64(tx.serialize());
  await rpc('sendTransaction', [signed, { encoding: 'base64', skipPreflight: true, maxRetries: 3 }]);
  const signature = bs58.encode(tx.signatures[0]!);
  const confirmed = await confirm(signature);
  const solAmt = protect ? Number(raw) / 1e9 : Number(q.outAmount) / 1e9, stAmt = protect ? Number(q.outAmount) / 10 ** S.dec : Number(raw) / 10 ** S.dec;
  await logMove(uid, row.address, { kind: protect ? 'protect' : 'release', stable, sol: solAmt, stable_amount: stAmt, signature, auto: !!rule, rule_id: rule, status: 'ok' });
  await audit(uid, 'vault_swap', { signature, from, to, sol: Number(solAmt.toFixed(6)), stable: Number(stAmt.toFixed(2)), auto: !!rule });
  return { signature, confirmed, sol: solAmt, stable: stAmt, symbol: stable };
}

/** envoi d'USDT/USDC vers un wallet lié ou une adresse du coffre (plateforme d'échange…) */
async function vaultSend(user: User, row: Row, stable: unknown, to: unknown, amount: unknown, rule: string | null = null) {
  const uid = user.id, S = STABLES[String(stable)];
  if (!S) throw new Fail(400, 'Seuls USDT et USDC peuvent être envoyés depuis le coffre.');
  if (typeof to !== 'string' || !B58RE.test(to)) throw new Fail(400, 'Adresse de destination invalide.');
  await destination(user, to);
  const held = await stableHeld(row.address, S.mint);
  let raw = amount === 'max' ? held : BigInt(Math.floor(Number(amount) * 10 ** S.dec));
  if (raw > held) throw new Fail(400, 'Solde ' + stable + ' insuffisant.');
  if (raw < 1_000_000n) throw new Fail(400, 'Minimum 1 ' + stable + '.');
  if (!rule) await requireStepUp(uid, 'withdraw');
  const kp = await open(row, uid + ':' + row.address);
  const src = new PublicKey(ataOf(row.address, S.mint)), dst = new PublicKey(ataOf(to, S.mint)), mint = new PublicKey(S.mint), owner = new PublicKey(to);
  const data = new Uint8Array(10); data[0] = 12; new DataView(data.buffer).setBigUint64(1, raw, true); data[9] = S.dec;
  const { value } = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: value.blockhash }).add(
    // compte de tokens du destinataire (créé s'il n'existe pas encore)
    new TransactionInstruction({ programId: new PublicKey(ATA), data: Buffer.from([1]), keys: [
      { pubkey: kp.publicKey, isSigner: true, isWritable: true }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: new PublicKey(TOKEN), isSigner: false, isWritable: false }] }),
    new TransactionInstruction({ programId: new PublicKey(TOKEN), data: Buffer.from(data), keys: [
      { pubkey: src, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: kp.publicKey, isSigner: true, isWritable: false }] }),
  );
  tx.sign(kp);
  const signed = b64(tx.serialize());
  await rpc('sendTransaction', [signed, { encoding: 'base64', maxRetries: 3 }]);
  const signature = bs58.encode(tx.signature!);
  const confirmed = await confirm(signature);
  const amt = Number(raw) / 10 ** S.dec;
  await logMove(uid, row.address, { kind: 'send', stable: String(stable), stable_amount: amt, dest: to, signature, auto: !!rule, rule_id: rule, status: 'ok' });
  await audit(uid, 'vault_send', { signature, to, amount: amt, stable, auto: !!rule });
  alertMail(user, 'token_sent', { amount: amt.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + stable, to, signature }).catch(() => {});
  return { signature, confirmed, amount: amt, symbol: stable };
}

function parseSecret(s: unknown): Keypair {
  if (typeof s !== 'string' || s.length > 400) throw new Fail(400, 'Clé invalide.');
  const t = s.trim();
  let bytes: Uint8Array;
  try { bytes = t.startsWith('[') ? Uint8Array.from(JSON.parse(t)) : bs58.decode(t); } catch { throw new Fail(400, 'Clé illisible.'); }
  if (bytes.length !== 64) throw new Fail(400, 'Clé invalide : 64 octets attendus.');
  return Keypair.fromSecretKey(bytes);
}
async function create(uid: string, pw: unknown, kp: Keypair) {
  const weak = passwordError(pw); if (weak) throw new Fail(400, weak);
  const addr = kp.publicKey.toBase58();
  const { data: linked } = await admin.from('wallets').select('user_id').eq('address', addr).maybeSingle();
  if (linked && linked.user_id !== uid) throw new Fail(409, 'Ce wallet appartient à un autre compte.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const s = await seal(kp.secretKey, uid + ':' + addr);
  const { error } = await admin.rpc('srvw_create', { uid, addr, p_enc: s.enc, p_iv: s.iv, p_hash: await pwHash(pw as string, salt, ITER), p_salt: b64(salt), p_iter: ITER });
  if (error) throw new Fail(/duplicate|unique/i.test(error.message) ? 409 : 500, /duplicate|unique/i.test(error.message) ? 'Vous avez déjà un wallet rapide serveur, ou cette adresse est déjà utilisée.' : 'Création impossible.');
  return { address: addr };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  // appel interne de la surveillance des ordres (clé secrète du serveur) : vente automatique d'un ordre
  const wk = req.headers.get('x-watch-key');
  if (wk) {
    const { data: key } = await admin.rpc('app_secret', { n: 'watch_key' });
    if (!key || !same(wk, key as string)) return json(401, { error: 'Clé invalide.' });
    let b: Record<string, unknown>; try { b = await req.json(); } catch { return json(400, { error: 'Requête invalide.' }); }
    try {
      if (b.action === 'auto_sell' && typeof b.uid === 'string') return json(200, await autoSell(b.uid, b));
      // règles automatiques du coffre-fort (fonction vault)
      if ((b.action === 'vault_swap' || b.action === 'vault_send') && typeof b.uid === 'string') {
        const row = await load(b.uid); if (!row) throw new Fail(404, 'no_wallet');
        const rule = typeof b.rule === 'string' ? b.rule : 'auto';
        if (b.action === 'vault_swap') return json(200, await vaultSwap(b.uid, row, b.from, b.to, b.amount, rule));
        const { data: { user: u } } = await admin.auth.admin.getUserById(b.uid);
        if (!u) throw new Fail(404, 'Compte introuvable.');
        return json(200, await vaultSend(u, row, b.stable, b.to, b.amount, rule));
      }
      return json(400, { error: 'Action inconnue.' });
    } catch (e) {
      if (e instanceof Fail) return json(e.status, { error: e.message });
      return json(500, { error: ((e as Error).message || 'erreur').slice(0, 160) });
    }
  }
  const { data: { user } } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
  if (!user) return json(401, { error: 'Connexion requise.' });
  const uid = user.id;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: 'Requête invalide.' }); }
  try {
    const action = body.action;
    // limites d'appels : signatures des trades et des ordres, et actions du compte
    if (action === 'sign_send') await rate('sw_sign:' + uid, 600, 3600);
    else if (action !== 'status') await rate('sw:' + uid, 60, 3600);
    if (action === 'create') return json(200, await create(uid, body.password, Keypair.generate()));
    if (action === 'import') { const kp = parseSecret(body.secret); const r = await create(uid, body.password, kp); await audit(uid, 'server_wallet_imported', { address: r.address }); return json(200, r); }
    const row = await load(uid);
    if (action === 'status') return json(200, row ? { address: row.address, daily_cap_sol: Number(row.daily_cap_sol), alert_balance_sol: Number(row.alert_balance_sol), spent_today: Number(row.spent_today), locked: !!(row.locked_until && Date.parse(row.locked_until) > Date.now()) } : { address: null });
    if (!row) throw new Fail(404, 'Aucun wallet rapide serveur sur ce compte.');
    if (action === 'sign_send') return json(200, await signSend(uid, row, body.tx));
    if (action === 'vault_swap') return json(200, await vaultSwap(uid, row, body.from, body.to, body.amount));
    await checkPw(uid, row, body.password);
    if (action === 'withdraw') return json(200, await withdraw(user, row, body.to, body.amount));
    if (action === 'vault_send') return json(200, await vaultSend(user, row, body.stable, body.to, body.amount));
    if (action === 'export') {
      await requireStepUp(uid, 'export_key');
      const kp = await open(row, uid + ':' + row.address); await audit(uid, 'server_wallet_export', {});
      alertMail(user, 'export_key').catch(() => {});
      return json(200, { secret: bs58.encode(kp.secretKey) });
    }
    if (action === 'limits') {
      const cap = Number(body.daily_cap_sol), alert = Number(body.alert_balance_sol);
      if (!(cap >= 0.1 && cap <= 100) || !(alert >= 0 && alert <= 100000)) throw new Fail(400, 'Plafond entre 0,1 et 100 SOL par jour.');
      const before = Number(row.daily_cap_sol);
      if (cap > before) await requireStepUp(uid, 'limits_up');   // baisser le plafond ne demande pas de code
      await admin.rpc('srvw_limits', { uid, cap, alert });
      if (cap !== before) { await audit(uid, 'server_wallet_limits', { before, after: cap }); alertMail(user, 'limits', { before, after: cap }).catch(() => {}); }
      return json(200, { ok: true });
    }
    if (action === 'delete') {
      const bal = (await rpc<{ value: number }>('getBalance', [row.address, { commitment: 'confirmed' }])).value;
      if (bal > 1_000_000 && body.force !== true) throw new Fail(409, 'Le wallet contient encore ' + (bal / 1e9).toFixed(4) + ' SOL : retirez-les d\'abord.');
      await requireStepUp(uid, 'delete_wallet');
      await admin.rpc('srvw_delete', { uid }); await audit(uid, 'server_wallet_deleted', { address: row.address });
      alertMail(user, 'delete_wallet').catch(() => {});
      return json(200, { ok: true });
    }
    throw new Fail(400, 'Action inconnue.');
  } catch (e) {
    if (e instanceof Need) return json(e.status, { error: e.message, ...e.extra });
    if (e instanceof Fail) return json(e.status, { error: e.message, ...e.extra });
    return json(500, { error: 'Erreur du serveur : ' + ((e as Error).message || 'inconnue').slice(0, 160) });
  }
});
