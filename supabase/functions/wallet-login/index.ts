// Ouvre la session d'un compte à partir d'un wallet lié (ajouté depuis Mon compte), après vérification d'une signature ed25519.
// Ne crée jamais de compte. Aucune clé privée n'est reçue : seulement l'adresse publique, le message et sa signature.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import nacl from 'npm:tweetnacl@1.0.3';
import bs58 from 'npm:bs58@6.0.0';
import { Fail, clientIp, rate, verifyCaptcha } from '../_shared/security.ts';

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

  let body: { address?: unknown; message?: unknown; signature?: unknown; captchaToken?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'Requête invalide.' }, h); }
  const { address, message, signature } = body;
  // limite par adresse IP et case « Je ne suis pas un robot »
  const ip = clientIp(req);
  try { await rate('wallet_login:' + (ip || 'inconnue'), 30, 600, 'Trop de tentatives de connexion : réessaie dans 10 minutes.'); } catch (e) { return json((e as Fail).status, { error: (e as Fail).message }, h); }
  if (!(await verifyCaptcha(body.captchaToken, ip))) return json(403, { error: 'Vérification anti-robot échouée : coche de nouveau la case.', code: 'captcha' }, h);
  if (typeof address !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return json(400, { error: 'Adresse invalide.' }, h);
  if (typeof message !== 'string' || message.length > 600) return json(400, { error: 'Message invalide.' }, h);
  if (typeof signature !== 'string' || signature.length > 200) return json(400, { error: 'Signature invalide.' }, h);

  // Le message doit viser ce wallet, un domaine TokenStudio, dater de moins de 2 minutes et porter un nonce neuf
  const field = (k: string) => (message.match(new RegExp('^' + k + ' : (.+)$', 'm')) || [])[1]?.trim();
  if (!message.startsWith('TokenStudio : connexion avec ce wallet.')) return json(400, { error: 'Message inattendu.' }, h);
  if (field('Wallet') !== address) return json(400, { error: 'Le message vise un autre wallet.' }, h);
  if (!allowedHost(field('Domaine') ?? '')) return json(403, { error: 'Domaine non autorisé.' }, h);
  const at = Date.parse(field('Date') ?? '');
  if (!Number.isFinite(at) || Date.now() - at > 2 * 60_000 || at - Date.now() > 60_000) return json(400, { error: 'Signature expirée : recommence.' }, h);
  const nonce = field('Nonce') ?? '';
  if (!/^[0-9a-f]{32}$/.test(nonce)) return json(400, { error: 'Message invalide.' }, h);

  let pk: Uint8Array, sig: Uint8Array;
  try { pk = bs58.decode(address); sig = b64decode(signature); } catch { return json(400, { error: 'Format de signature invalide.' }, h); }
  if (pk.length !== 32 || sig.length !== 64) return json(400, { error: 'Format de signature invalide.' }, h);
  if (!nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk)) return json(403, { error: 'Signature incorrecte.' }, h);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: fresh, error: nerr } = await admin.rpc('consume_login_nonce', { n: nonce });
  if (nerr) return json(500, { error: 'Connexion impossible pour le moment.' }, h);
  if (!fresh) return json(409, { error: 'Signature déjà utilisée : recommence.' }, h);

  const { data: row } = await admin.from('wallets').select('user_id').eq('address', address).maybeSingle();
  if (!row) return json(404, { error: 'Aucun compte n\'est lié à ce wallet.' }, h);
  const { data: { user }, error: uerr } = await admin.auth.admin.getUserById(row.user_id);
  if (uerr || !user) return json(404, { error: 'Compte introuvable.' }, h);
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return json(403, { error: 'Compte suspendu.' }, h);
  if (!user.email) {
    // compte créé avec un autre wallet et sans e-mail : la session ne peut s'ouvrir qu'avec ce wallet de connexion
    return json(409, { error: 'Ce wallet est lié à un compte qui se connecte avec son wallet principal. Connecte-toi avec celui-ci.' }, h);
  }
  // lien de connexion à usage unique, jamais envoyé par e-mail : son jeton est échangé aussitôt par le navigateur
  const { data: link, error: lerr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  if (lerr || !link?.properties?.hashed_token) return json(500, { error: 'Connexion impossible pour le moment.' }, h);
  return json(200, { token_hash: link.properties.hashed_token }, h);
});
