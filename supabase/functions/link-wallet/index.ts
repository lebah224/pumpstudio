// Lie un wallet Solana à un compte après vérification d'une signature ed25519.
// Aucune clé privée n'est jamais reçue : seulement l'adresse publique, le message et sa signature.
// Si le compte a un wallet rapide (les wallets liés peuvent recevoir ses retraits) : code de confirmation demandé,
// alerte par e-mail, et le nouveau wallet ne reçoit des retraits qu'après 24 heures.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import nacl from 'npm:tweetnacl@1.0.3';
import bs58 from 'npm:bs58@6.0.0';
import { Fail, alertMail, audit, rate, requireStepUp } from '../_shared/security.ts';

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (status: number, body: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function b64decode(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Connexion requise.' }, h);
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: { user }, error: uerr } = await userClient.auth.getUser();
  if (uerr || !user) return json(401, { error: 'Session invalide : reconnectez-vous.' }, h);

  // Double authentification activée : la session doit l'avoir validée (niveau aal2)
  const hasMfa = (user.factors ?? []).some((f) => f.status === 'verified');
  if (hasMfa) {
    let aal = '';
    try { aal = JSON.parse(atob(auth.slice(7).split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).aal; } catch { aal = ''; }
    if (aal !== 'aal2') return json(403, { error: 'Validez d\'abord votre double authentification.' }, h);
  }

  try { await rate('link:' + user.id, 10, 3600, 'Trop d\'ajouts de wallets : réessayez dans une heure.'); } catch (e) { return json((e as Fail).status, { error: (e as Fail).message }, h); }

  let body: { address?: unknown; message?: unknown; signature?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'Requête invalide.' }, h); }
  const { address, message, signature } = body;
  if (typeof address !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json(400, { error: 'Adresse invalide.' }, h);
  if (typeof message !== 'string' || message.length > 600) return json(400, { error: 'Message invalide.' }, h);
  if (typeof signature !== 'string' || signature.length > 200) return json(400, { error: 'Signature invalide.' }, h);

  // Le message doit viser ce compte, ce wallet, un domaine TokenStudio, et dater de moins de 5 minutes
  const field = (k: string) => (message.match(new RegExp('^' + k + ' : (.+)$', 'm')) || [])[1]?.trim();
  if (!message.startsWith('TokenStudio : lier ce wallet à mon compte.')) return json(400, { error: 'Message inattendu.' }, h);
  if (field('Compte') !== user.id) return json(403, { error: 'Le message vise un autre compte.' }, h);
  if (field('Wallet') !== address) return json(400, { error: 'Le message vise un autre wallet.' }, h);
  if (!allowedHost(field('Domaine') ?? '')) return json(403, { error: 'Domaine non autorisé.' }, h);
  const at = Date.parse(field('Date') ?? '');
  if (!Number.isFinite(at) || Date.now() - at > 5 * 60_000 || at - Date.now() > 60_000) return json(400, { error: 'Signature expirée : recommencez.' }, h);

  let pk: Uint8Array, sig: Uint8Array;
  try { pk = bs58.decode(address); sig = b64decode(signature); } catch { return json(400, { error: 'Format de signature invalide.' }, h); }
  if (pk.length !== 32 || sig.length !== 64) return json(400, { error: 'Format de signature invalide.' }, h);
  if (!nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk)) return json(403, { error: 'Signature incorrecte.' }, h);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: existing } = await admin.from('wallets').select('*').eq('address', address).maybeSingle();
  if (existing) {
    if (existing.user_id === user.id) return json(200, { wallet: existing }, h);
    return json(409, { error: 'Ce wallet est déjà lié à un autre compte.' }, h);
  }
  const { data: srv } = await admin.from('server_wallets').select('user_id').eq('user_id', user.id).maybeSingle();
  if (srv) {
    try { await requireStepUp(user.id, 'link_wallet'); } catch (e) { return json((e as Fail).status, { error: (e as Fail).message, ...(e as Fail).extra }, h); }
  }
  const { count } = await admin.from('wallets').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_primary', true);
  const { data: wallet, error } = await admin.from('wallets')
    .insert({ user_id: user.id, address, label: 'Wallet', is_primary: !count })
    .select().single();
  if (error) return json(/Limite/.test(error.message) ? 429 : 500, { error: /Limite/.test(error.message) ? 'Limite de 10 wallets atteinte.' : 'Enregistrement impossible.' }, h);
  if (srv) { await audit(user.id, 'withdraw_wallet_pending', { address }); }
  await alertMail(user, 'wallet_added', { address }).catch(() => false);
  return json(200, { wallet }, h);
});
