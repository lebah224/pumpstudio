// Écoute directe de la blockchain Solana (websocket du nœud de l'outil, gratuit) pour remplacer les abonnements payants
// du flux PumpPortal :
//  - wallets (acheteurs suivis, créateurs à surveiller) : journaux de chaque transaction confirmée qui les mentionne ;
//    une transaction pump.fun réussie est relue une fois pour en tirer le token, le sens et les montants ;
//  - tokens (stratégies de sortie, achats programmés) : compte de la courbe pump.fun ; chaque changement donne le prix,
//    la capitalisation et le SOL échangé (variation des réserves), sans aucune lecture supplémentaire.
// Les messages produits ont la forme de ceux du flux PumpPortal (TradeMsg), pour que les moteurs restent inchangés.
import { PublicKey } from 'npm:@solana/web3.js@1.98.4';
import type { TradeMsg } from './exits.ts';

const CURVE = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WSOL = 'So11111111111111111111111111111111111111112';
const P_CURVE = new PublicKey(CURVE);
const enc = new TextEncoder();
export const curveOf = (mint: string) => PublicKey.findProgramAddressSync([enc.encode('bonding-curve'), new PublicKey(mint).toBytes()], P_CURVE)[0].toBase58();
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const httpUrls = () => { const own = (Deno.env.get('SOLANA_RPC_URL') ?? '').split(',').map((x) => x.trim()).filter((x) => x.startsWith('https://')); return own.length ? own : ['https://api.mainnet-beta.solana.com']; };
const wsUrl = () => httpUrls()[0]!.replace(/^https:/, 'wss:');
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown = null;
  for (const u of httpUrls()) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(6000) });
      const j = await r.json(); if (j?.error) throw new Error(j.error.message); return j.result as T;
    } catch (e) { last = e; }
  }
  throw last ?? new Error('RPC');
}

export type WalletTrade = { sig: string; wallet: string; mint: string; side: 'buy' | 'sell'; sol: number; tokens: number };
type Any = Record<string, any>;
const num = (x: unknown) => { const v = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN; return isFinite(v) ? v : 0; };
// achat ou vente d'un seul token contre des SOL, lu dans les soldes avant / après de la transaction
function swapOf(tx: Any, addr: string, sig: string): WalletTrade | null {
  const m = tx?.meta; if (!m || m.err) return null;
  const keys = ((tx.transaction?.message?.accountKeys ?? []) as Any[]).map((k) => (typeof k === 'string' ? k : k?.pubkey));
  const i = keys.indexOf(addr); if (i < 0) return null;
  const lam = ((m.postBalances?.[i] ?? 0) - (m.preBalances?.[i] ?? 0)) / 1e9 + (i === 0 ? (m.fee ?? 0) / 1e9 : 0);
  const d = new Map<string, number>();
  for (const b of (m.preTokenBalances ?? []) as Any[]) if (b.owner === addr) d.set(b.mint, (d.get(b.mint) ?? 0) - num(b.uiTokenAmount?.uiAmount));
  for (const b of (m.postTokenBalances ?? []) as Any[]) if (b.owner === addr) d.set(b.mint, (d.get(b.mint) ?? 0) + num(b.uiTokenAmount?.uiAmount));
  const solD = lam + (d.get(WSOL) ?? 0);
  const toks = [...d].filter(([k, v]) => k !== WSOL && Math.abs(v) > 0);
  if (toks.length !== 1) return null;
  const [mint, tok] = toks[0]!;
  if (tok > 0 && solD < -0.0005) return { sig, wallet: addr, mint, side: 'buy', sol: -solD, tokens: tok };
  if (tok < 0 && solD > 0.0005) return { sig, wallet: addr, mint, side: 'sell', sol: solD, tokens: -tok };
  return null;
}

type Handlers = {
  /** transaction d'achat ou de vente d'un wallet écouté */
  onWalletTrade: (t: WalletTrade) => void;
  /** changement de la courbe d'un token écouté, au format du flux (prix, capitalisation, SOL échangé) */
  onCurveTrade: (m: TradeMsg) => void;
};

/** une connexion par passage d'écoute ; s'abonne et se désabonne au fil des listes */
export function chainFeed(h: Handlers) {
  let ws: WebSocket | null = null, nextId = 1;
  const wanted = { wallets: new Set<string>(), mints: new Set<string>() };
  const subs = new Map<string, number>();          // clé (w:adresse / c:mint) → abonnement
  const bySub = new Map<number, string>();
  const pendingReq = new Map<number, string>();    // requête → clé
  const curves = new Map<string, { vS: number; vT: number; rS: number }>();   // dernier état connu par mint
  const sigs = new Set<string>();
  const perWallet = new Map<string, number[]>();   // lectures de transactions par wallet sur la dernière minute
  let reads = 0, events = 0, opened = 0;

  const send = (o: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
  function subscribe(key: string) {
    if (subs.has(key) || [...pendingReq.values()].includes(key)) return;
    const id = nextId++;
    pendingReq.set(id, key);
    if (key.startsWith('w:')) send({ jsonrpc: '2.0', id, method: 'logsSubscribe', params: [{ mentions: [key.slice(2)] }, { commitment: 'confirmed' }] });
    else send({ jsonrpc: '2.0', id, method: 'accountSubscribe', params: [curveOf(key.slice(2)), { encoding: 'base64', commitment: 'processed' }] });
  }
  function unsubscribe(key: string) {
    const s = subs.get(key); if (s == null) return;
    send({ jsonrpc: '2.0', id: nextId++, method: key.startsWith('w:') ? 'logsUnsubscribe' : 'accountUnsubscribe', params: [s] });
    subs.delete(key); bySub.delete(s);
  }
  function sync() {
    const want = new Set([...[...wanted.wallets].map((a) => 'w:' + a), ...[...wanted.mints].map((m) => 'c:' + m)]);
    for (const k of [...subs.keys()]) if (!want.has(k)) unsubscribe(k);
    for (const k of want) subscribe(k);
  }

  // transaction d'un wallet : seulement les transactions pump.fun réussies, relues une fois (30 par minute et par wallet au plus)
  async function walletTx(addr: string, sig: string, logs: string[]) {
    if (sigs.has(sig)) return;
    if (!logs.some((l) => l.includes(CURVE) || l.includes(AMM))) return;
    if (!logs.some((l) => /Instruction: (Buy|Sell|BuyExactSolIn)/.test(l))) return;
    const now = Date.now(), L = (perWallet.get(addr) ?? []).filter((t) => t > now - 60_000);
    if (L.length >= 30) return;
    L.push(now); perWallet.set(addr, L);
    sigs.add(sig); if (sigs.size > 20_000) sigs.clear();
    for (let i = 0; i < 4; i++) {
      reads++;
      const tx = await rpc<Any | null>('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]).catch(() => null);
      if (tx) { const t = swapOf(tx, addr, sig); if (t) h.onWalletTrade(t); return; }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  // courbe d'un token : réserves virtuelles (8, 16), réelles en SOL (32), terminée (48)
  function curveUpdate(mint: string, b64: string) {
    const c = unb64(b64); if (c.length < 49) return;
    const dv = new DataView(c.buffer, c.byteOffset);
    const vT = Number(dv.getBigUint64(8, true)), vS = Number(dv.getBigUint64(16, true)), rS = Number(dv.getBigUint64(32, true));
    const prev = curves.get(mint);
    curves.set(mint, { vS, vT, rS });
    if (!prev || !vT) return;
    const d = rS - prev.rS; if (!d) return;
    const vSol = vS / 1e9, vTok = vT / 1e6, price = vSol / vTok;
    h.onCurveTrade({ mint, txType: d > 0 ? 'buy' : 'sell', solAmount: Math.abs(d) / 1e9, tokenAmount: Math.abs(d) / 1e9 / price,
      vSolInBondingCurve: vSol, vTokensInBondingCurve: vTok, marketCapSol: price * 1e9, signature: 'c:' + mint + ':' + rS + ':' + vT });
  }

  function connect(): Promise<void> {
    return new Promise((resolve) => {
      ws = new WebSocket(wsUrl());
      subs.clear(); bySub.clear(); pendingReq.clear();
      ws.onopen = () => { opened++; sync(); };
      ws.onmessage = (e) => {
        let j: Any; try { j = JSON.parse(String(e.data)); } catch { return; }
        if (j.id != null && pendingReq.has(j.id)) {
          const key = pendingReq.get(j.id)!; pendingReq.delete(j.id);
          if (typeof j.result === 'number') { subs.set(key, j.result); bySub.set(j.result, key); }
          return;
        }
        const key = bySub.get(j.params?.subscription); if (!key) return;
        events++;
        const v = j.params?.result?.value;
        if (j.method === 'logsNotification' && v && !v.err && typeof v.signature === 'string') walletTx(key.slice(2), v.signature, (v.logs ?? []) as string[]).catch(() => {});
        else if (j.method === 'accountNotification' && v?.data?.[0]) curveUpdate(key.slice(2), v.data[0]);
      };
      ws.onclose = () => resolve();
      ws.onerror = () => { try { ws?.close(); } catch { /* déjà fermé */ } };
    });
  }

  return {
    connect,
    close: () => { try { ws?.close(); } catch { /* déjà fermé */ } },
    /** listes voulues (remplacent les précédentes) */
    set(wallets: Iterable<string>, mints: Iterable<string>) { wanted.wallets = new Set(wallets); wanted.mints = new Set(mints); sync(); },
    stats: () => ({ opened, subs: subs.size, events, reads }),
  };
}
