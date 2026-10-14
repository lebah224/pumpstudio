// Achat rapide avec un wallet rapide, pour l'achat automatique au lancement (appelé par l'écoute continue).
// La transaction est construite ici, instruction pump.fun « buy » comme le kit officiel (@pump-fun/pump-sdk 2.0.0),
// sans intermédiaire. Pas de simulation (trop lente au lancement) : avant signature, elle est relue instruction par
// instruction et refusée si elle peut coûter plus que prévu :
//  - programmes admis : pump.fun, budget de calcul, comptes de tokens, création de comptes ; rien d'autre ;
//  - achat pump.fun : coût maximum inscrit dans l'instruction ≤ montant × (1 + glissement) ;
//  - frais de priorité ≤ ce que la règle autorise ; petits virements (frais de service) ≤ 0,05 SOL au total.
// La clé est déchiffrée avec la clé maître (même chiffrement que la fonction server-wallet) et reste en mémoire.
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from 'npm:@solana/web3.js@1.98.4';
import bs58 from 'npm:bs58@6.0.0';
import { Buffer } from 'node:buffer';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => { let s = ''; u.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const upstreams = () => {
  const own = (Deno.env.get('SOLANA_RPC_URL') ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('https://'));
  return own.length ? own : ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
};
export async function rpc<T>(method: string, params: unknown[], ms = 8000): Promise<T> {
  let last = 'RPC injoignable';
  for (const url of upstreams()) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(ms) });
      if (!r.ok) { last = 'RPC ' + r.status; continue; }
      const j = await r.json();
      if (j.error) throw new Error('RPC : ' + (j.error.message || 'erreur'));
      return j.result as T;
    } catch (e) { last = (e as Error).message || last; }
  }
  throw new Error(last);
}

/* ---------- clé du wallet rapide ---------- */
let master: CryptoKey | null = null;
async function masterKey(admin: SupabaseClient) {
  if (master) return master;
  const { data } = await admin.rpc('app_secret', { n: 'wallet_master_key' });
  if (!data) throw new Error('Configuration du serveur incomplète.');
  master = await crypto.subtle.importKey('raw', unb64(data as string), 'AES-GCM', false, ['decrypt']);
  return master;
}
export type Hot = { uid: string; address: string; kp: Keypair };
/** wallet rapide prêt à signer (déchiffré une fois par passage d'écoute) */
export async function hotWallet(admin: SupabaseClient, uid: string, address: string): Promise<Hot | null> {
  const { data } = await admin.rpc('sw_get', { uid, addr: address });
  const row = (data as { address: string; enc: string; iv: string }[] | null)?.[0];
  if (!row) return null;
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv), additionalData: enc.encode(uid + ':' + row.address) }, await masterKey(admin), unb64(row.enc));
  const kp = Keypair.fromSecretKey(new Uint8Array(p));
  return kp.publicKey.toBase58() === row.address ? { uid, address: row.address, kp } : null;
}

/* ---------- lecture stricte de la transaction d'achat ---------- */
const SYSTEM = '11111111111111111111111111111111', CB = 'ComputeBudget111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const CURVE = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP = new Set([CURVE, 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', 'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e']);
const WSOL = 'So11111111111111111111111111111111111111112';
const u32 = (d: Uint8Array, o: number) => (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;
const u64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getBigUint64(0, true);
const disc = async (name: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('global:' + name))).slice(0, 8);
let D: { buy: Uint8Array; exact: Uint8Array; sell: Uint8Array } | null = null;
const same8 = (a: Uint8Array, b: Uint8Array) => a.length >= 8 && b.every((x, i) => a[i] === x);

export async function checkBuy(tx: VersionedTransaction, payer: string, maxCostLamports: bigint, maxPriorityLamports: bigint) {
  D ??= { buy: await disc('buy'), exact: await disc('buy_exact_sol_in'), sell: await disc('sell') };
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== payer) throw new Error('Transaction refusée : le wallet doit payer.');
  if (tx.message.addressTableLookups?.length) throw new Error('Transaction refusée : tables d\'adresses non admises.');
  const wsolAta = PublicKey.findProgramAddressSync([new PublicKey(payer).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(WSOL).toBuffer()], new PublicKey(ATA))[0].toBase58();
  let small = 0n, units = 200_000n, price = 0n, buys = 0;
  for (const ix of tx.message.compiledInstructions) {
    const pid = keys[ix.programIdIndex], d = ix.data;
    if (!pid) throw new Error('Transaction refusée : programme inconnu.');
    if (pid === CB) {
      if (d[0] === 2) units = BigInt(u32(d, 1));
      else if (d[0] === 3) price = u64(d, 1);
      else if (d[0] !== 1 && d[0] !== 4) throw new Error('Transaction refusée : budget de calcul inattendu.');
      continue;
    }
    if (pid === ATA) continue;
    if (PUMP.has(pid)) {
      if (pid === CURVE && same8(d, D.sell)) throw new Error('Transaction refusée : vente inattendue.');
      if (pid === CURVE && same8(d, D.buy)) { buys++; if (u64(d, 16) > maxCostLamports) throw new Error('Transaction refusée : coût maximum trop élevé.'); }
      else if (pid === CURVE && same8(d, D.exact)) { buys++; if (u64(d, 8) > maxCostLamports) throw new Error('Transaction refusée : montant trop élevé.'); }
      continue;
    }
    if (pid === SYSTEM) {
      const t = u32(d, 0);
      if (t === 0 || t === 3) continue;                                   // création de compte (loyer des comptes de tokens)
      if (t === 2) {
        const to = keys[ix.accountKeyIndexes[1]!], lam = u64(d, 4);
        if (to === wsolAta) { if (lam > maxCostLamports) throw new Error('Transaction refusée : montant trop élevé.'); continue; }
        small += lam; if (small <= 50_000_000n) continue;                 // frais de service, 0,05 SOL au total
      }
      throw new Error('Transaction refusée : virement de SOL non autorisé.');
    }
    if (pid === TOKEN || pid === TOKEN22) {
      const op = d[0];
      if (op === 17 || op === 1 || op === 16 || op === 18) continue;
      if (op === 9 && keys[ix.accountKeyIndexes[1]!] === payer) continue;
      throw new Error('Transaction refusée : opération sur les tokens non autorisée.');
    }
    throw new Error('Transaction refusée : programme non autorisé (' + pid.slice(0, 6) + '…).');
  }
  if (buys !== 1) throw new Error('Transaction refusée : achat pump.fun introuvable.');
  if (units * price / 1_000_000n > maxPriorityLamports) throw new Error('Transaction refusée : frais de priorité trop élevés.');
}

/* ---------- construction directe : instruction « buy » du programme pump.fun, comptes dans l'ordre du kit officiel ---------- */
const P_CURVE = new PublicKey(CURVE), P_FEE = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'), P_ATA = new PublicKey(ATA);
const TOKEN_PK = new PublicKey(TOKEN), TOKEN22_PK = new PublicKey(TOKEN22);
const seed = (t: string) => enc.encode(t);
const pda = (seeds: Uint8Array[], prog: PublicKey) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const ataOf = (owner: PublicKey, mint: PublicKey, tp: PublicKey) => pda([owner.toBytes(), tp.toBytes(), mint.toBytes()], P_ATA);
const GLOBAL = pda([seed('global')], P_CURVE), EVENT_AUTH = pda([seed('__event_authority')], P_CURVE);
const GLOBAL_VOL = pda([seed('global_volume_accumulator')], P_CURVE), FEE_CONFIG = pda([seed('fee_config'), P_CURVE.toBytes()], P_FEE);
// destinataires des frais de rachat (liste du kit officiel)
const BUYBACK = ['5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD', '9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7', 'GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL', '3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR',
  '5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6', 'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL', '5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD', 'A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW'];
const pick = <T>(L: T[]) => L[Math.floor(Math.random() * L.length)]!;
const pkAt = (d: Uint8Array, o: number) => new PublicKey(d.slice(o, o + 32));
const isZero = (p: PublicKey) => p.toBytes().every((x) => x === 0);

// configuration pump.fun (destinataires des frais) et blockhash, gardés à jour pendant l'écoute
const W: { fee: PublicKey[]; reserved: PublicKey[]; at: number; hash: string | null; hashAt: number } = { fee: [], reserved: [], at: 0, hash: null, hashAt: 0 };
export async function warm() {
  const jobs: Promise<unknown>[] = [];
  if (!W.fee.length || Date.now() - W.at > 300_000) jobs.push(rpc<{ value: { data: [string, string] } | null }>('getAccountInfo', [GLOBAL.toBase58(), { encoding: 'base64', commitment: 'confirmed' }]).then((r) => {
    if (!r.value) return;
    // Global : fee_recipient à l'octet 41, fee_recipients[7] à 162, reserved_fee_recipient à 483, reserved_fee_recipients[7] à 516
    const d = unb64(r.value.data[0]);
    const list = (one: number, many: number) => [pkAt(d, one), ...Array.from({ length: 7 }, (_, i) => pkAt(d, many + 32 * i))].filter((p) => !isZero(p));
    W.fee = list(41, 162); W.reserved = list(483, 516); W.at = Date.now();
  }));
  if (!W.hash || Date.now() - W.hashAt > 10_000) jobs.push(rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]).then((r) => { W.hash = r.value.blockhash; W.hashAt = Date.now(); }));
  await Promise.allSettled(jobs);
}
const u64le = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
export async function buildDirect(payer: PublicKey, mint: string, sol: number, slippage: number, priority: number) {
  if (!W.fee.length || !W.hash || Date.now() - W.hashAt > 45_000) await warm();
  if (!W.fee.length || !W.hash) throw new Error('Configuration pump.fun indisponible.');
  const m = new PublicKey(mint), curve = pda([seed('bonding-curve'), m.toBytes()], P_CURVE);
  // une seule lecture (« processed » : le token vient d'être créé) : programme du token et état de la courbe
  const r = await rpc<{ value: ({ owner: string; data: [string, string] } | null)[] }>('getMultipleAccounts', [[mint, curve.toBase58()], { encoding: 'base64', commitment: 'processed' }], 3000);
  const [mi, ci] = r.value;
  if (!mi || !ci) throw new Error('Token pas encore visible sur le réseau.');
  const tp = mi.owner === TOKEN22 ? TOKEN22_PK : TOKEN_PK, c = unb64(ci.data[0]);
  // BondingCurve : réserves virtuelles (8, 16), réelles en tokens (24), terminée (48), créateur (49), mode mayhem (81)
  const dv = new DataView(c.buffer, c.byteOffset);
  const vT = dv.getBigUint64(8, true), vS = dv.getBigUint64(16, true), rT = dv.getBigUint64(24, true);
  if (c[48]) throw new Error('Token déjà migré.');
  const creator = pkAt(c, 49), mayhem = c[81] === 1;
  // tokens visés pour ce montant (frais comptés large : 3 %), coût maximum = montant × (1 + glissement)
  const lam = BigInt(Math.round(sol * 1e9)), net = lam * 10_000n / 10_300n;
  let amount = (net - 1n) * vT / (vS + net - 1n);
  if (amount > rT) amount = rT;
  if (amount <= 0n) throw new Error('Plus de tokens disponibles sur la courbe.');
  const maxCost = lam + lam * BigInt(Math.floor(slippage * 10)) / 1000n;
  const user = payer, assocUser = ataOf(user, m, tp);
  const feeRecipient = pick(mayhem && W.reserved.length ? W.reserved : W.fee);
  const keys = [
    { pubkey: GLOBAL, isSigner: false, isWritable: false },
    { pubkey: feeRecipient, isSigner: false, isWritable: true },
    { pubkey: m, isSigner: false, isWritable: false },
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: ataOf(curve, m, tp), isSigner: false, isWritable: true },
    { pubkey: assocUser, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: tp, isSigner: false, isWritable: false },
    { pubkey: pda([seed('creator-vault'), creator.toBytes()], P_CURVE), isSigner: false, isWritable: true },
    { pubkey: EVENT_AUTH, isSigner: false, isWritable: false },
    { pubkey: P_CURVE, isSigner: false, isWritable: false },
    { pubkey: GLOBAL_VOL, isSigner: false, isWritable: false },
    { pubkey: pda([seed('user_volume_accumulator'), user.toBytes()], P_CURVE), isSigner: false, isWritable: true },
    { pubkey: FEE_CONFIG, isSigner: false, isWritable: false },
    { pubkey: P_FEE, isSigner: false, isWritable: false },
    // comptes complémentaires du kit : courbe v2, destinataire des frais de rachat
    { pubkey: pda([seed('bonding-curve-v2'), m.toBytes()], P_CURVE), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(pick(BUYBACK)), isSigner: false, isWritable: true },
  ];
  D ??= { buy: await disc('buy'), exact: await disc('buy_exact_sol_in'), sell: await disc('sell') };
  const data = new Uint8Array(25); data.set(D.buy, 0); data.set(u64le(amount), 8); data.set(u64le(maxCost), 16); data[24] = 1;   // track_volume
  const buy = new TransactionInstruction({ programId: P_CURVE, keys, data: Buffer.from(data) });
  // compte de tokens de l'acheteur : création « idempotente » (sans effet s'il existe déjà)
  const ata = new TransactionInstruction({ programId: P_ATA, data: Buffer.from([1]), keys: [
    { pubkey: user, isSigner: true, isWritable: true }, { pubkey: assocUser, isSigner: false, isWritable: true }, { pubkey: user, isSigner: false, isWritable: false },
    { pubkey: m, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tp, isSigner: false, isWritable: false } ] });
  const units = 150_000, price = Math.max(1, Math.round(priority * 1e9 * 1e6 / units));
  const msg = new TransactionMessage({ payerKey: user, recentBlockhash: W.hash!, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), ata, buy] }).compileToV0Message();
  return new VersionedTransaction(msg);
}
/** prépare (programme pump.fun en direct), vérifie, signe et envoie un achat ; renvoie la signature dès l'envoi.
 *  gate : autorisation (prise de la règle, plafond du jour) obtenue pendant la préparation ; faux = rien n'est envoyé */
export async function fastBuy(w: Hot, mint: string, sol: number, slippage: number, priority: number, gate: Promise<boolean>) {
  // la courbe peut n'être pas encore visible quelques dizaines de ms après l'avis : deux nouvelles lectures rapides
  let tx: VersionedTransaction | null = null, last: Error | null = null;
  for (let i = 0; i < 3 && !tx; i++) {
    try { tx = await buildDirect(w.kp.publicKey, mint, sol, slippage, priority); }
    catch (e) { last = e as Error; if (i < 2) await new Promise((res) => setTimeout(res, 150)); }
  }
  if (!tx) throw last ?? new Error('Préparation de l\'achat impossible.');
  const maxCost = BigInt(Math.ceil(sol * (1 + slippage / 100) * 1e9)) + 10_000n;
  await checkBuy(tx, w.address, maxCost, BigInt(Math.ceil(priority * 1.5e9)) + 1_000_000n);
  tx.sign([w.kp]);
  const raw = b64(tx.serialize()), signature = bs58.encode(tx.signatures[0]!);
  if (!(await gate)) return null;
  // envoi en parallèle à tous les nœuds : le premier qui la transmet gagne
  const sends = upstreams().map((url) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [raw, { encoding: 'base64', skipPreflight: true, maxRetries: 3 }] }) })
    .then((x) => x.json()).then((j) => { if (j.error) throw new Error(j.error.message); return true; }));
  await Promise.any(sends).catch(() => { throw new Error('Envoi de la transaction impossible.'); });
  return { signature, maxCostSol: Number(maxCost) / 1e9 };
}

/** attend la confirmation puis lit le résultat réel : SOL dépensés (frais compris) et tokens reçus */
export async function settle(signature: string, owner: string, mint: string, maxMs = 30_000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    await new Promise((res) => setTimeout(res, 500));
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>('getSignatureStatuses', [[signature]], 4000).catch(() => null);
    const v = st?.value?.[0];
    if (v?.err) return { ok: false as const, reason: 'Refusé par la blockchain (' + JSON.stringify(v.err).slice(0, 80) + ')' };
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) {
      for (let i = 0; i < 6; i++) {
        type Bal = { owner?: string; mint: string; uiTokenAmount: { uiAmount: number | null } };
        const t = await rpc<{ meta: { preBalances: number[]; postBalances: number[]; preTokenBalances?: Bal[]; postTokenBalances?: Bal[] } } | null>('getTransaction',
          [signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed', encoding: 'json' }], 5000).catch(() => null);
        if (t?.meta) {
          const tok = (L?: Bal[]) => (L ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((a, b) => a + (b.uiTokenAmount.uiAmount ?? 0), 0);
          return { ok: true as const, sol: Math.max(0, (t.meta.preBalances[0]! - t.meta.postBalances[0]!) / 1e9), tokens: tok(t.meta.postTokenBalances) - tok(t.meta.preTokenBalances) };
        }
        await new Promise((res) => setTimeout(res, 700));
      }
      return { ok: true as const, sol: null, tokens: null };
    }
  }
  return { ok: false as const, reason: 'Non confirmé après 30 s (transaction probablement perdue).' };
}
