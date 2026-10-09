// Données de marché pour la page Trader : listes de tokens, fiche, bougies et transactions.
// Le navigateur ne parle qu'à cette fonction : elle interroge pump.fun, DEX Screener et GeckoTerminal (gratuits, sans clé),
// normalise les réponses et les garde quelques secondes en cache pour tous les utilisateurs.
// Lecture seule : rien n'est signé ni envoyé sur la blockchain.

const HOSTS = [
  /^tokenstudio-sol\.vercel\.app$/,
  /^pumpstudio\.vercel\.app$/,
  /^tokenstudio(-git)?-[a-z0-9-]+-sadou-9f22dc7f\.vercel\.app$/,
  /^localhost(:\d{2,5})?$/,
  /^127\.0\.0\.1(:\d{2,5})?$/,
];
function cors(origin: string | null) {
  let ok = false;
  try { ok = !!origin && HOSTS.some((re) => re.test(new URL(origin).host)); } catch { ok = false; }
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : 'https://tokenstudio-sol.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}
const json = (status: number, body: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
class Fail extends Error { constructor(public status: number, msg: string) { super(msg); } }

/* ---------- limites d'appels par adresse IP (mémoire de l'instance) ---------- */
const PER_MIN = 300;
const hits = new Map<string, { n: number; at: number }>();
function limited(key: string) {
  const now = Date.now(), h = hits.get(key);
  if (hits.size > 5000) hits.clear();
  if (!h || now - h.at > 60_000) { hits.set(key, { n: 1, at: now }); return false; }
  return ++h.n > PER_MIN;
}

/* ---------- cache partagé : une seule requête en cours par clé ---------- */
const cache = new Map<string, { at: number; ttl: number; p: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T> {
  const now = Date.now(), c = cache.get(key);
  if (c && now - c.at < c.ttl) return c.p as Promise<T>;
  if (cache.size > 2000) for (const [k, v] of cache) if (now - v.at > v.ttl) cache.delete(k);
  const p = run();
  cache.set(key, { at: now, ttl: ttlMs, p });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });   // une erreur n'est pas gardée en cache
  return p;
}

const PUMP_H = { Accept: 'application/json', Origin: 'https://pump.fun', Referer: 'https://pump.fun/' };
async function get(url: string, headers: Record<string, string> = { Accept: 'application/json' }, ms = 9000): Promise<unknown> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Fail(502, 'Source de marché indisponible (' + r.status + ').');
  return r.json();
}

/* ---------- normalisation ---------- */
type Num = number | null;
type Row = {
  mint: string; name: string; symbol: string; image: string | null; created: Num; dex: string | null; pump: boolean;
  complete: boolean; progress: Num; priceUsd: Num; priceSol: Num; mcUsd: Num; liqUsd: Num; supply: Num;
  vol: { m5: Num; h1: Num; h24: Num }; chg: { m5: Num; h1: Num; h24: Num }; tx: { b: Num; s: Num }; tx1: { b: Num; s: Num };
  pair: string | null; creator: string | null; links: { twitter?: string; telegram?: string; website?: string }; lastTrade: Num; ath: Num;
};
const n = (x: unknown): Num => { const v = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN; return isFinite(v) ? v : null; };
const s = (x: unknown, max = 80) => (typeof x === 'string' ? x.slice(0, max) : '');
const url = (x: unknown) => (typeof x === 'string' && /^https:\/\/[^\s"'<>]{4,300}$/.test(x) ? x : undefined);
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const VIRT_TOK = 1.073e15 - 7.931e14, REAL_TOK0 = 7.931e14;

type Any = Record<string, any>; // réponses externes, lues champ par champ ci-dessous
function img(u: unknown): string | null {
  const v = typeof u === 'string' ? u : '';
  const cid = v.match(/\/ipfs\/([A-Za-z0-9]{40,80})/);
  if (cid) return 'https://ipfs.io/ipfs/' + cid[1];
  return url(v) ?? null;
}
function fromPump(c: Any): Row {
  const vTok = n(c.virtual_token_reserves), complete = !!c.complete;
  const progress = complete ? 100 : vTok != null ? Math.max(0, Math.min(100, 100 * (1 - (vTok - VIRT_TOK) / REAL_TOK0))) : null;
  const supplyTok = (n(c.total_supply) ?? 1e15) / 1e6, mcUsd = n(c.usd_market_cap), mcSol = n(c.market_cap);
  return {
    mint: s(c.mint, 50), name: s(c.name, 60), symbol: s(c.symbol, 20), image: img(c.image_uri), created: n(c.created_timestamp),
    dex: complete ? 'pumpswap' : 'pumpfun', pump: true, complete, progress,
    priceUsd: mcUsd != null ? mcUsd / supplyTok : null, priceSol: mcSol != null ? mcSol / supplyTok : null, mcUsd, liqUsd: null, supply: supplyTok,
    vol: { m5: null, h1: null, h24: null }, chg: { m5: null, h1: null, h24: null }, tx: { b: null, s: null }, tx1: { b: null, s: null },
    pair: s(c.pump_swap_pool, 50) || null, creator: s(c.creator, 50) || null,
    links: { twitter: url(c.twitter), telegram: url(c.telegram), website: url(c.website) },
    lastTrade: n(c.last_trade_timestamp), ath: n(c.ath_market_cap),
  };
}
// enrichit avec DEX Screener : variation, volume, transactions, liquidité (paire la plus liquide de chaque token)
async function dexPairs(mints: string[]): Promise<Map<string, Any>> {
  const out = new Map<string, Any>();
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
  await Promise.all(chunks.map(async (ch) => {
    const key = ch.slice().sort().join(',');
    const arr = await cached('dx:' + key, 12_000, () => get('https://api.dexscreener.com/tokens/v1/solana/' + ch.join(','))).catch(() => null);
    if (!Array.isArray(arr)) return;
    for (const p of arr as Any[]) {
      const m = p?.baseToken?.address; if (typeof m !== 'string') continue;
      const cur = out.get(m);
      if (!cur || (n(p?.liquidity?.usd) ?? 0) > (n(cur?.liquidity?.usd) ?? 0)) out.set(m, p);
    }
  }));
  return out;
}
function mergeDex(r: Row, p: Any | undefined): Row {
  if (!p) return r;
  const priceUsd = n(p.priceUsd);
  return {
    ...r,
    name: r.name || s(p.baseToken?.name, 60), symbol: r.symbol || s(p.baseToken?.symbol, 20), image: r.image || img(p.info?.imageUrl),
    created: r.created ?? n(p.pairCreatedAt), dex: r.pump ? r.dex : s(p.dexId, 30) || r.dex,
    priceUsd: priceUsd ?? r.priceUsd, priceSol: n(p.priceNative) ?? r.priceSol,
    mcUsd: n(p.marketCap) ?? n(p.fdv) ?? r.mcUsd, liqUsd: n(p.liquidity?.usd) ?? r.liqUsd,
    vol: { m5: n(p.volume?.m5), h1: n(p.volume?.h1), h24: n(p.volume?.h24) },
    chg: { m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1), h24: n(p.priceChange?.h24) },
    tx: { b: n(p.txns?.h24?.buys), s: n(p.txns?.h24?.sells) }, tx1: { b: n(p.txns?.h1?.buys), s: n(p.txns?.h1?.sells) },
    pair: r.pair || s(p.pairAddress, 50) || null,
    links: { website: r.links.website ?? url(p.info?.websites?.[0]?.url), twitter: r.links.twitter ?? url((p.info?.socials ?? []).find((x: Any) => x?.type === 'twitter')?.url), telegram: r.links.telegram ?? url((p.info?.socials ?? []).find((x: Any) => x?.type === 'telegram')?.url) },
  };
}
function fromGecko(pool: Any, inc: Map<string, Any>): Row | null {
  const a = pool?.attributes ?? {}, bid = pool?.relationships?.base_token?.data?.id as string | undefined;
  const mint = bid?.replace(/^solana_/, '') ?? ''; if (!MINT.test(mint)) return null;
  const t = inc.get(bid!)?.attributes ?? {}, dex = s(pool?.relationships?.dex?.data?.id, 30);
  const pc = a.price_change_percentage ?? {}, v = a.volume_usd ?? {}, tx = a.transactions ?? {};
  return {
    mint, name: s(t.name, 60) || s(a.name, 60).split(' / ')[0]!, symbol: s(t.symbol, 20), image: img(t.image_url), created: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    dex, pump: /pump/.test(dex) || mint.endsWith('pump'), complete: dex !== 'pump-fun', progress: dex === 'pump-fun' ? null : 100,
    priceUsd: n(a.base_token_price_usd), priceSol: n(a.base_token_price_quote_token), mcUsd: n(a.market_cap_usd) ?? n(a.fdv_usd), liqUsd: n(a.reserve_in_usd), supply: null,
    vol: { m5: n(v.m5), h1: n(v.h1), h24: n(v.h24) }, chg: { m5: n(pc.m5), h1: n(pc.h1), h24: n(pc.h24) },
    tx: { b: n(tx.h24?.buys), s: n(tx.h24?.sells) }, tx1: { b: n(tx.h1?.buys), s: n(tx.h1?.sells) },
    pair: s(a.address, 50) || null, creator: null, links: {}, lastTrade: null, ath: null,
  };
}

/* ---------- actions ---------- */
const PUMP = 'https://frontend-api-v3.pump.fun';
const pumpList = (q: string) => get(PUMP + '/coins?offset=0&includeNsfw=false&' + q, PUMP_H) as Promise<Any[] | null>;

async function lists(tab: string): Promise<Row[]> {
  if (tab === 'trending') {
    const g = await get('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token,dex&page=1') as Any | null;
    const inc = new Map<string, Any>(((g?.included ?? []) as Any[]).map((x) => [x.id, x]));
    const seen = new Set<string>(), rows: Row[] = [];
    for (const p of (g?.data ?? []) as Any[]) { const r = fromGecko(p, inc); if (r && !seen.has(r.mint)) { seen.add(r.mint); rows.push(r); } }
    // compléments pump.fun (logo, liens, créateur) pour les tokens qui en viennent
    const pumpOnes = rows.filter((r) => r.pump).slice(0, 12);
    await Promise.all(pumpOnes.map(async (r) => {
      const c = await coin(r.mint).catch(() => null); if (!c) return;
      const P = fromPump(c);
      r.image = r.image || P.image; r.created = P.created ?? r.created; r.creator = P.creator; r.links = P.links; r.progress = P.progress; r.complete = P.complete; r.supply = P.supply; r.ath = P.ath;
    }));
    return rows;
  }
  let arr: Any[];
  if (tab === 'new') arr = (await pumpList('limit=50&sort=created_timestamp&order=DESC&complete=false')) ?? [];
  else if (tab === 'migrated') arr = (await pumpList('limit=50&sort=created_timestamp&order=DESC&complete=true')) ?? [];
  else if (tab === 'graduating') {
    // les plus grosses courbes encore actives : beaucoup de courbes presque pleines sont abandonnées depuis longtemps
    const [a, b] = await Promise.all([pumpList('limit=50&sort=market_cap&order=DESC&complete=false'), pumpList('limit=50&sort=last_trade_timestamp&order=DESC&complete=false')]);
    const seen = new Set<string>(); arr = [...(a ?? []), ...(b ?? [])].filter((c) => !seen.has(c?.mint) && seen.add(c?.mint));
  } else throw new Fail(400, 'Liste inconnue.');
  let rows = arr.filter((c) => MINT.test(c?.mint ?? '')).map(fromPump);
  if (tab === 'graduating') {
    const fresh = Date.now() - 3 * 3600_000;
    rows = rows.filter((r) => (r.progress ?? 0) < 100 && (r.lastTrade ?? 0) > fresh).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0)).slice(0, 40);
  }
  const dx = await dexPairs(rows.map((r) => r.mint));
  return rows.map((r) => mergeDex(r, dx.get(r.mint)));
}

const coin = (mint: string) => cached('coin:' + mint, 20_000, () => get(PUMP + '/coins-v2/' + mint, PUMP_H) as Promise<Any | null>);

async function token(mint: string) {
  const [c, dx] = await Promise.all([coin(mint).catch(() => null), dexPairs([mint])]);
  const p = dx.get(mint);
  if (!c && !p) throw new Fail(404, 'Token introuvable sur pump.fun et DEX Screener.');
  const base: Row = c ? fromPump(c) : {
    mint, name: '', symbol: '', image: null, created: null, dex: null, pump: false, complete: true, progress: null, priceUsd: null, priceSol: null,
    mcUsd: null, liqUsd: null, supply: null, vol: { m5: null, h1: null, h24: null }, chg: { m5: null, h1: null, h24: null },
    tx: { b: null, s: null }, tx1: { b: null, s: null }, pair: null, creator: null, links: {}, lastTrade: null, ath: null,
  };
  const r = mergeDex(base, p);
  if (r.supply == null && r.mcUsd && r.priceUsd) r.supply = r.mcUsd / r.priceUsd;
  return {
    ...r,
    description: c ? s(c.description, 600) : '',
    koth: c ? n(c.king_of_the_hill_timestamp) : null,
    curve: c ? s(c.bonding_curve, 50) || null : null,
    dexPair: p ? { dex: s(p.dexId, 30), pair: s(p.pairAddress, 50), url: url(p.url) ?? null, quote: s(p.quoteToken?.symbol, 12) } : null,
  };
}

const TF = ['1s', '15s', '30s', '1m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '24h'] as const;
const TF_SEC: Record<string, number> = { '1s': 1, '15s': 15, '30s': 30, '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200, '24h': 86400 };
// équivalent GeckoTerminal (tokens hors pump.fun) : période et regroupement
const GECKO_TF: Record<string, [string, number]> = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '30m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '6h': ['hour', 4], '12h': ['hour', 12], '24h': ['day', 1] };
type Candle = [number, number, number, number, number, number];

async function candles(mint: string, tf: string, cur: 'USD' | 'SOL', limit: number, createdIn: Num) {
  let created = createdIn;
  if (!created && mint.endsWith('pump')) created = n((await coin(mint).catch(() => null))?.created_timestamp);
  if (created) {
    const arr = await get('https://swap-api.pump.fun/v2/coins/' + mint + '/candles?interval=' + tf + '&limit=' + limit + '&currency=' + cur + '&createdTs=' + Math.round(created), PUMP_H).catch(() => null);
    if (Array.isArray(arr) && arr.length) {
      const c: Candle[] = (arr as Any[]).map((x) => [Math.floor(n(x.timestamp)! / 1000), n(x.open)!, n(x.high)!, n(x.low)!, n(x.close)!, n(x.volume) ?? 0] as Candle)
        .filter((x) => x.slice(0, 5).every((v) => v != null && isFinite(v as number)));
      c.sort((a, b) => a[0] - b[0]);
      return { src: 'pump.fun', tf, cur, c };
    }
  }
  // hors pump.fun (ou historique indisponible) : GeckoTerminal sur la paire la plus liquide
  const g = GECKO_TF[tf]; if (!g) return { src: 'none', tf, cur, c: [] as Candle[] };
  const p = (await dexPairs([mint])).get(mint), pool = p?.pairAddress;
  if (!pool) return { src: 'none', tf, cur, c: [] as Candle[] };
  const j = await get('https://api.geckoterminal.com/api/v2/networks/solana/pools/' + pool + '/ohlcv/' + g[0] + '?aggregate=' + g[1] + '&limit=' + Math.min(limit, 1000) + '&currency=' + (cur === 'SOL' ? 'token' : 'usd') + '&token=base') as Any | null;
  const list = (j?.data?.attributes?.ohlcv_list ?? []) as number[][];
  const c: Candle[] = list.map((x) => [x[0]!, +x[1]!, +x[2]!, +x[3]!, +x[4]!, +x[5]! || 0] as Candle).filter((x) => x.every((v) => isFinite(v)));
  c.sort((a, b) => a[0] - b[0]);
  return { src: 'GeckoTerminal', tf, cur, c };
}

async function trades(mint: string, limit: number) {
  const j = await get('https://swap-api.pump.fun/v2/coins/' + mint + '/trades?limit=' + limit, PUMP_H).catch(() => null) as Any | null;
  const list = (j?.trades ?? []) as Any[];
  return list.map((x) => ({
    sig: s(x.tx, 100), t: Date.parse(x.timestamp) || null, w: s(x.userAddress, 50), side: x.type === 'sell' ? 'sell' : 'buy',
    usd: n(x.amountUsd), sol: n(x.amountSol), tok: n(x.baseAmount), pUsd: n(x.priceUsd), pSol: n(x.priceSol), amm: x.program === 'pump_amm',
  })).filter((x) => x.sig && x.t);
}

/* ---------- analyse : sécurité (RugCheck), détenteurs, créateur ---------- */
const KNOWN_FR: Record<string, string> = { 'Pump Fun AMM': 'Pool PumpSwap', 'Pump Fun': 'Courbe pump.fun', Creator: 'Créateur', 'Raydium Authority V4': 'Pool Raydium', 'Meteora DLMM Pool': 'Pool Meteora', 'Meteora DAMM v2 Pool': 'Pool Meteora', 'Meteora DAMM v2 Position': 'Position Meteora' };
async function analysis(mint: string) {
  const [rc, c] = await Promise.all([
    cached('rc:' + mint, 60_000, () => get('https://api.rugcheck.xyz/v1/tokens/' + mint + '/report', { Accept: 'application/json' }, 12_000) as Promise<Any | null>).catch(() => null),
    coin(mint).catch(() => null),
  ]);
  const creator = s(c?.creator, 50) || s(rc?.creator, 50) || null;
  const [ctr, ccoins] = await Promise.all([
    creator ? get('https://swap-api.pump.fun/v2/coins/' + mint + '/trades?limit=100&userAddress=' + creator, PUMP_H).catch(() => null) as Promise<Any | null> : null,
    creator ? cached('cc:' + creator, 60_000, () => get(PUMP + '/coins-v2/user-created-coins/' + creator + '?offset=0&limit=30&includeNsfw=false', PUMP_H) as Promise<Any | null>).catch(() => null) : null,
  ]);
  const decimals = n(rc?.token?.decimals) ?? 6;
  const supply = (n(rc?.token?.supply) ?? n(c?.total_supply) ?? 1e15) / 10 ** decimals;
  const known: Record<string, { name: string; type: string }> = {};
  for (const [k, v] of Object.entries((rc?.knownAccounts ?? {}) as Record<string, Any>)) known[k] = { name: KNOWN_FR[s(v?.name, 60)] ?? s(v?.name, 60), type: s(v?.type, 20) };
  if (c?.bonding_curve) known[c.bonding_curve] = known[c.bonding_curve] ?? { name: 'Courbe pump.fun', type: 'AMM' };
  if (c?.pump_swap_pool) known[c.pump_swap_pool] = known[c.pump_swap_pool] ?? { name: 'Pool PumpSwap', type: 'AMM' };
  if (creator) known[creator] = { name: 'Créateur', type: 'CREATOR' };
  const holders = ((rc?.topHolders ?? []) as Any[]).slice(0, 20).map((h) => {
    const owner = s(h.owner, 50), k = known[owner];
    return { owner, account: s(h.address, 50), pct: n(h.pct) ?? 0, amount: n(h.uiAmount) ?? 0, insider: !!h.insider, label: k?.name ?? null, kind: k?.type ?? null };
  });
  const people = holders.filter((h) => h.kind !== 'AMM' && h.kind !== 'LOCKER');
  const ext = rc?.token_extensions ?? {};
  // liquidité verrouillée ou brûlée : celle du pool principal (le plus liquide)
  const main = ((rc?.markets ?? []) as Any[]).reduce((a: Any | null, m: Any) => ((n(m?.lp?.quoteUSD) ?? 0) + (n(m?.lp?.baseUSD) ?? 0) > ((n(a?.lp?.quoteUSD) ?? 0) + (n(a?.lp?.baseUSD) ?? 0)) ? m : a), null);
  const trades = ((ctr?.trades ?? []) as Any[]).filter((x) => x.userAddress === creator).map((x) => ({
    sig: s(x.tx, 100), t: Date.parse(x.timestamp) || 0, side: x.type === 'sell' ? 'sell' : 'buy', sol: n(x.amountSol) ?? 0, usd: n(x.amountUsd), tok: n(x.baseAmount) ?? 0,
  }));
  const bought = trades.filter((x) => x.side === 'buy'), sold = trades.filter((x) => x.side === 'sell');
  const sum = (L: { sol: number }[]) => L.reduce((a, x) => a + x.sol, 0), sumT = (L: { tok: number }[]) => L.reduce((a, x) => a + x.tok, 0);
  const coins = ((ccoins?.coins ?? []) as Any[]).filter((x) => MINT.test(x?.mint ?? '')).map((x) => { const r = fromPump(x); return { mint: r.mint, name: r.name, symbol: r.symbol, image: r.image, created: r.created, mcUsd: r.mcUsd, complete: r.complete, ath: r.ath }; });
  const creatorBal = rc?.creatorBalance != null ? (n(rc.creatorBalance) ?? 0) / 10 ** decimals : null;
  return {
    source: rc ? 'RugCheck' : null,
    score: n(rc?.score_normalised), rugged: !!rc?.rugged,
    risks: ((rc?.risks ?? []) as Any[]).slice(0, 20).map((r) => ({ name: s(r.name, 80), value: s(r.value, 40), description: s(r.description, 300), level: s(r.level, 10) })),
    program: rc?.tokenProgram === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? 'Token-2022' : rc ? 'SPL Token' : null,
    mintAuthority: rc ? s(rc.mintAuthority ?? rc.token?.mintAuthority, 50) || null : undefined,
    freezeAuthority: rc ? s(rc.freezeAuthority ?? rc.token?.freezeAuthority, 50) || null : undefined,
    mutable: rc?.tokenMeta ? !!rc.tokenMeta.mutable : null,
    transferFee: n(rc?.transferFee?.pct) ?? 0,
    danger: { permanentDelegate: !!ext.permanentDelegate, transferHook: !!ext.transferHook, nonTransferable: !!ext.nonTransferable, frozenDefault: s(ext.defaultAccountState?.state ?? ext.defaultAccountState, 20) === 'frozen' },
    lpLockedPct: n(main?.lp?.lpLockedPct), liqUsd: n(rc?.totalMarketLiquidity),
    totalHolders: n(rc?.totalHolders), insiders: { networks: ((rc?.insiderNetworks ?? []) as Any[]).length, wallets: n(rc?.graphInsidersDetected) ?? 0 },
    supply, holders,
    top10: people.slice(0, 10).reduce((a, h) => a + h.pct, 0),
    creator: creator ? {
      address: creator, balance: creatorBal, pct: creatorBal != null && supply ? (creatorBal / supply) * 100 : null,
      bought: { n: bought.length, sol: sum(bought), tok: sumT(bought) }, sold: { n: sold.length, sol: sum(sold), tok: sumT(sold) },
      first: trades.length ? trades.reduce((a, x) => (x.t < a.t ? x : a)) : null, trades: trades.slice(0, 50),
      coins, coinsCount: n(ccoins?.count) ?? coins.length,
    } : null,
  };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'x';
  if (limited(ip)) return json(429, { error: 'Trop de requêtes : patientez une minute.' }, h);
  let b: Any;
  try { b = await req.json(); } catch { return json(400, { error: 'JSON invalide.' }, h); }
  try {
    const mint = typeof b.mint === 'string' && MINT.test(b.mint) ? b.mint : null;
    switch (b.action) {
      case 'lists': {
        const tab = ['trending', 'new', 'graduating', 'migrated'].includes(b.tab) ? b.tab : 'trending';
        const rows = await cached('list:' + tab, tab === 'new' ? 4_000 : tab === 'trending' ? 20_000 : 8_000, () => lists(tab));
        return json(200, { tab, at: Date.now(), rows }, h);
      }
      case 'token': {
        if (!mint) throw new Fail(400, 'Adresse de token invalide.');
        return json(200, await cached('tok:' + mint, 8_000, () => token(mint)), h);
      }
      case 'candles': {
        if (!mint) throw new Fail(400, 'Adresse de token invalide.');
        const tf = (TF as readonly string[]).includes(b.tf) ? b.tf : '1m', cur = b.cur === 'SOL' ? 'SOL' : 'USD';
        const limit = Math.max(10, Math.min(1000, Math.round(+b.limit || 500)));
        const created = n(b.created);
        return json(200, await cached('c:' + mint + tf + cur + limit, TF_SEC[tf]! < 60 ? 2_000 : 5_000, () => candles(mint, tf, cur, limit, created)), h);
      }
      case 'trades': {
        if (!mint) throw new Fail(400, 'Adresse de token invalide.');
        const limit = Math.max(10, Math.min(100, Math.round(+b.limit || 50)));
        return json(200, { trades: await cached('t:' + mint + limit, 2_500, () => trades(mint, limit)) }, h);
      }
      case 'analysis': {
        if (!mint) throw new Fail(400, 'Adresse de token invalide.');
        return json(200, await cached('an:' + mint, 20_000, () => analysis(mint)), h);
      }
      default: throw new Fail(400, 'Action inconnue.');
    }
  } catch (e) {
    const st = e instanceof Fail ? e.status : 502;
    const msg = e instanceof Fail ? e.message : (e as Error).name === 'TimeoutError' ? 'Source de marché trop lente : réessayez.' : 'Source de marché indisponible.';
    return json(st, { error: msg }, h);
  }
});
