import { studio } from '../legacy/bridge';

// Données d'un wallet, lues sans API payante : RPC Solana (réglé dans le studio), DexScreener pour les prix
// des tokens, Binance (Coinbase en secours) pour l'historique du SOL.

export type Range = '1d' | '7d' | '30d';
export type Pt = { t: number; v: number };
export type Holding = { mint: string; amount: number; symbol: string; name: string; image: string; priceUsd: number | null; usd: number | null };
export type Tx = {
  sig: string; t: number; sol: number; fee: number; failed: boolean;
  kind: 'in' | 'out' | 'buy' | 'sell' | 'fail' | 'other';
  token: { mint: string; delta: number } | null; peer: string | null;
};

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const RANGES: Record<Range, { bi: string; n: number; cb: number; ms: number }> = {
  '1d': { bi: '15m', n: 96, cb: 900, ms: 864e5 },
  '7d': { bi: '1h', n: 168, cb: 3600, ms: 6048e5 },
  '30d': { bi: '4h', n: 180, cb: 21600, ms: 2592e6 },
};
export const rangeMs = (r: Range) => RANGES[r].ms;

function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const h = studio()?.hub;
  if (!h) return Promise.reject(new Error('Studio non chargé.'));
  return h.rpc<T>(method, params);
}

const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.v as T;
  const v = await fn(); cache.set(key, { at: Date.now(), v }); return v;
}
export const forget = (pk: string) => { [...cache.keys()].forEach((k) => { if (k.includes(pk)) cache.delete(k); }); };

/** Historique du prix du SOL en dollars */
export function solHistory(r: Range): Promise<Pt[]> {
  return cached('sol-' + r, 60_000, async () => {
    const R = RANGES[r];
    try {
      const j = await (await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=' + R.bi + '&limit=' + R.n)).json();
      if (Array.isArray(j) && j.length > 1) return j.map((x: unknown[]) => ({ t: +(x[0] as number), v: +(x[4] as string) }));
    } catch { /* Binance indisponible : Coinbase */ }
    const j = await (await fetch('https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=' + R.cb)).json();
    if (!Array.isArray(j)) throw new Error('Historique du SOL indisponible.');
    const from = Date.now() - R.ms;
    return j.map((x: number[]) => ({ t: x[0]! * 1000, v: +x[4]! })).filter((p: Pt) => p.t >= from).sort((a: Pt, b: Pt) => a.t - b.t);
  });
}

export const balanceOf = (pk: string) => cached('bal-' + pk, 15_000, async () => (await rpc<{ value: number }>('getBalance', [pk, { commitment: 'confirmed' }])).value / 1e9);

type ParsedAcc = { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } } };
type DexPair = { baseToken?: { address: string; name?: string; symbol?: string }; priceUsd?: string; liquidity?: { usd?: number }; info?: { imageUrl?: string } };

/** Tokens détenus (programmes Token et Token-2022), valorisés avec DexScreener */
export function holdings(pk: string): Promise<Holding[]> {
  return cached('hold-' + pk, 60_000, async () => {
    const lists = await Promise.all(TOKEN_PROGRAMS.map((programId) =>
      rpc<{ value: ParsedAcc[] }>('getTokenAccountsByOwner', [pk, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]).then((r) => r.value).catch(() => [] as ParsedAcc[])));
    const by = new Map<string, number>();
    lists.flat().forEach((a) => { const i = a.account.data.parsed.info, n = i.tokenAmount.uiAmount ?? 0; if (n > 0) by.set(i.mint, (by.get(i.mint) ?? 0) + n); });
    const mints = [...by.keys()];
    const meta = new Map<string, DexPair>();
    for (let i = 0; i < mints.length && i < 90; i += 30) {
      try {
        const j = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + mints.slice(i, i + 30).join(','))).json();
        (Array.isArray(j) ? (j as DexPair[]) : []).forEach((p) => {
          const m = p.baseToken?.address; if (!m || !by.has(m)) return;
          const cur = meta.get(m); if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) meta.set(m, p);
        });
      } catch { /* prix inconnus : affichés sans valeur */ }
    }
    return mints.map((mint) => {
      const p = meta.get(mint), amount = by.get(mint)!, price = p?.priceUsd ? +p.priceUsd : null;
      return { mint, amount, symbol: p?.baseToken?.symbol || mint.slice(0, 4) + '…', name: p?.baseToken?.name || 'Token inconnu', image: p?.info?.imageUrl || '', priceUsd: price, usd: price != null ? price * amount : null };
    }).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  });
}

type RawTx = {
  blockTime: number | null;
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[];
    preTokenBalances?: { owner?: string; mint: string; uiTokenAmount: { uiAmount: number | null } }[];
    postTokenBalances?: { owner?: string; mint: string; uiTokenAmount: { uiAmount: number | null } }[] } | null;
  transaction: { message: { accountKeys: { pubkey: string }[]; instructions: { program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string } } }[] } };
};

function parseTx(pk: string, sig: string, x: RawTx): Tx | null {
  if (!x?.meta) return null;
  const keys = x.transaction.message.accountKeys.map((k) => k.pubkey);
  const i = keys.indexOf(pk); if (i < 0) return null;
  const sol = ((x.meta.postBalances[i] ?? 0) - (x.meta.preBalances[i] ?? 0)) / 1e9;
  const fee = i === 0 ? x.meta.fee / 1e9 : 0;
  const tok = new Map<string, number>();
  (x.meta.preTokenBalances ?? []).filter((b) => b.owner === pk).forEach((b) => tok.set(b.mint, (tok.get(b.mint) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0)));
  (x.meta.postTokenBalances ?? []).filter((b) => b.owner === pk).forEach((b) => tok.set(b.mint, (tok.get(b.mint) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0)));
  const td = [...tok.entries()].filter(([, d]) => Math.abs(d) > 1e-12).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const tr = x.transaction.message.instructions.find((ins) => ins.program === 'system' && ins.parsed?.type === 'transfer')?.parsed?.info;
  const peer = tr ? (tr.source === pk ? tr.destination : tr.source) ?? null : null;
  const failed = !!x.meta.err;
  const kind: Tx['kind'] = failed ? 'fail' : td ? (td[1] > 0 ? 'buy' : 'sell') : sol > 0 ? 'in' : sol < 0 && Math.abs(sol) > fee + 1e-9 ? 'out' : 'other';
  return { sig, t: (x.blockTime ?? 0) * 1000, sol, fee, failed, kind, token: td ? { mint: td[0], delta: td[1] } : null, peer };
}

/** Dernières transactions du wallet (lecture on-chain), avec la variation de SOL et de token de chacune */
export function activity(pk: string, limit = 25): Promise<{ txs: Tx[]; more: boolean }> {
  return cached('act-' + pk, 60_000, async () => {
    const sigs = await rpc<{ signature: string }[]>('getSignaturesForAddress', [pk, { limit, commitment: 'confirmed' }]);
    const out: (Tx | null)[] = new Array(sigs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < sigs.length) {
        const k = next++, sig = sigs[k]!.signature;
        try {
          const x = await rpc<RawTx>('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
          out[k] = parseTx(pk, sig, x);
        } catch { /* transaction illisible : ignorée */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { txs: out.filter((t): t is Tx => !!t), more: sigs.length >= limit };
  });
}

/**
 * Solde reconstitué dans le temps : on part du solde actuel et on retire, en remontant,
 * la variation de chaque transaction. Partiel si l'activité lue ne couvre pas toute la période.
 */
export function balanceSeries(current: number, txs: Tx[], price: Pt[], more: boolean, r: Range) {
  const from = Date.now() - RANGES[r].ms;
  const sorted = [...txs].sort((a, b) => b.t - a.t);
  const oldest = sorted[sorted.length - 1]?.t ?? Infinity;
  const balAt = (t: number) => sorted.reduce((b, x) => (x.t > t ? b - x.sol : b), current);
  const times = price.length ? price.map((p) => p.t) : [from, Date.now()];
  const sol = times.map((t) => ({ t, v: Math.max(0, balAt(t)) }));
  sol.push({ t: Date.now(), v: current });
  const usd = price.length ? sol.map((p) => ({ t: p.t, v: p.v * (nearest(price, p.t) ?? 0) })) : [];
  return { sol, usd, partial: more && oldest > from };
}
function nearest(pts: Pt[], t: number) {
  let best: Pt | null = null;
  for (const p of pts) { if (p.t <= t) best = p; else break; }
  return (best ?? pts[0])?.v ?? null;
}
