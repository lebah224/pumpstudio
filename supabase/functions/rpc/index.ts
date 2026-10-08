// Relais RPC Solana pour les comptes connectés : le navigateur n'a plus besoin de sa propre clé Helius.
// La clé reste côté serveur (secret SOLANA_RPC_URL) ; sans elle, on passe par des RPC publics gratuits,
// qui acceptent les requêtes d'un serveur mais refusent souvent celles d'une page web.
// Ce relais ne signe jamais rien : il transmet des lectures et des transactions déjà signées par le wallet.

const HOSTS = [
  /^tokenstudio-sol\.vercel\.app$/,
  /^pumpstudio\.vercel\.app$/,
  /^tokenstudio(-git)?-[a-z0-9-]+-sadou-9f22dc7f\.vercel\.app$/,
  /^localhost(:\d{2,5})?$/,
  /^127\.0\.0\.1(:\d{2,5})?$/,
];
const allowedHost = (h: string) => HOSTS.some((re) => re.test(h));
function cors(origin: string | null) {
  let ok = false;
  try { ok = !!origin && allowedHost(new URL(origin).host); } catch { ok = false; }
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : 'https://tokenstudio-sol.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, solana-client',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}
const json = (status: number, body: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// lectures et envoi de transactions signées ; rien qui coûte cher au fournisseur (getProgramAccounts, blocs entiers)
const METHODS = new Set([
  'getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getTokenAccountsByOwner', 'getTokenAccountBalance',
  'getTokenLargestAccounts', 'getTokenSupply', 'getSignaturesForAddress', 'getTransaction', 'getSignatureStatuses',
  'getLatestBlockhash', 'isBlockhashValid', 'getFeeForMessage', 'getRecentPrioritizationFees',
  'getMinimumBalanceForRentExemption', 'getSlot', 'getBlockHeight', 'getEpochInfo', 'getVersion', 'getHealth',
  'getBlockTime', 'simulateTransaction', 'sendTransaction', 'getAsset', 'getAssetsByOwner',
]);
const MAX_BODY = 256_000, MAX_BATCH = 40, PER_MIN = 900;
const hits = new Map<string, { n: number; at: number }>();
function limited(uid: string, cost: number) {
  const now = Date.now(), h = hits.get(uid);
  if (!h || now - h.at > 60_000) { hits.set(uid, { n: cost, at: now }); return false; }
  h.n += cost; return h.n > PER_MIN;
}
const upstreams = () => {
  const own = (Deno.env.get('SOLANA_RPC_URL') ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('https://'));
  return own.length ? own : ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
};
function subject(auth: string): string | null {
  try { const p = JSON.parse(atob(auth.slice(7).split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))); return p.role === 'authenticated' && typeof p.sub === 'string' ? p.sub : null; }
  catch { return null; }
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);
  // jeton vérifié par la passerelle (verify_jwt) ; on exige en plus un utilisateur connecté, pas la clé publique
  const uid = subject(req.headers.get('Authorization') ?? '');
  if (!uid) return json(401, { error: 'Connexion au compte requise pour le RPC TokenStudio.' }, h);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: 'Requête trop volumineuse.' }, h);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'JSON invalide.' }, h); }
  const calls = (Array.isArray(body) ? body : [body]) as { method?: unknown }[];
  if (!calls.length || calls.length > MAX_BATCH) return json(400, { error: 'Lot de requêtes invalide.' }, h);
  const bad = calls.find((c) => typeof c?.method !== 'string' || !METHODS.has(c.method));
  if (bad) return json(403, { error: 'Méthode RPC non relayée : ' + String(bad?.method).slice(0, 40) }, h);
  if (limited(uid, calls.length)) return json(429, { error: 'Trop de requêtes : patiente une minute.' }, h);

  let last = 'aucun RPC joignable';
  for (const url of upstreams()) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw, signal: AbortSignal.timeout(20_000) });
      if (r.status === 429 || r.status === 403 || r.status >= 500) { last = 'RPC ' + r.status; continue; }
      return new Response(r.body, { status: r.status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch (e) { last = (e as Error).name === 'TimeoutError' ? 'délai dépassé' : 'RPC injoignable'; }
  }
  return json(502, { error: 'RPC indisponible (' + last + ').' }, h);
});
