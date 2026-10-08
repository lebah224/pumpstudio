// Suppression définitive du compte, demandée par l'utilisateur connecté.
// Toutes ses données sont effacées (tables liées au compte en cascade, logos du stockage).
// Garde-fou : si son wallet rapide serveur contient encore des SOL ou des tokens, la suppression est refusée,
// car la clé chiffrée disparaîtrait avec le compte et les fonds seraient perdus.
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
const json = (status: number, body: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const upstreams = () => {
  const own = (Deno.env.get('SOLANA_RPC_URL') ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('https://'));
  return own.length ? own : ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
};
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (const url of upstreams()) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const j = await r.json();
      if (!j.error) return j.result as T;
    } catch { /* RPC suivant */ }
  }
  throw new Error('rpc');
}
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
/** Le wallet serveur est-il vide (moins de 0,001 SOL et aucun token) ? null si la vérification est impossible */
async function walletEmpty(address: string): Promise<{ empty: boolean; sol: number; tokens: number } | null> {
  try {
    const bal = await rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
    let tokens = 0;
    for (const programId of TOKEN_PROGRAMS) {
      const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[] }>('getTokenAccountsByOwner', [address, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      tokens += (r.value ?? []).filter((a) => (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0) > 0).length;
    }
    const sol = bal.value / 1e9;
    return { empty: sol < 0.001 && tokens === 0, sol, tokens };
  } catch { return null; }
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json(401, { error: 'Connexion requise.' }, h);

  // double authentification activée : la session doit l'avoir validée
  try {
    const claims = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    const { data: f } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    if ((f?.factors ?? []).some((x) => x.status === 'verified') && claims.aal !== 'aal2') return json(403, { error: 'Valide d\'abord ta double authentification.' }, h);
  } catch { return json(401, { error: 'Session invalide.' }, h); }

  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  if (body.confirm !== 'SUPPRIMER') return json(400, { error: 'Confirmation manquante : écris SUPPRIMER.' }, h);

  // garde-fou des fonds du wallet rapide serveur
  const { data: w } = await admin.from('server_wallets').select('address').eq('user_id', user.id).maybeSingle();
  if (w?.address) {
    const st = await walletEmpty(w.address);
    if (!st) return json(503, { error: 'Impossible de vérifier le solde de ton wallet rapide. Réessaie dans un instant.' }, h);
    if (!st.empty) return json(409, { error: 'Ton wallet rapide contient encore ' + (st.sol >= 0.001 ? st.sol.toFixed(4).replace('.', ',') + ' SOL' : '') + (st.sol >= 0.001 && st.tokens ? ' et ' : '') + (st.tokens ? st.tokens + ' token' + (st.tokens > 1 ? 's' : '') : '') + '. Vends tes tokens et retire tes SOL avant de supprimer le compte : sinon ils seraient perdus.', code: 'wallet_not_empty' }, h);
  }

  // logos du stockage (dossier <uid>/), puis le compte : toutes les tables liées suivent en cascade
  try {
    const { data: files } = await admin.storage.from('logos').list(user.id, { limit: 1000 });
    if (files?.length) await admin.storage.from('logos').remove(files.map((f) => user.id + '/' + f.name));
  } catch { /* pas de logo */ }
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json(500, { error: 'Suppression impossible : ' + error.message }, h);
  return json(200, { deleted: true }, h);
});
