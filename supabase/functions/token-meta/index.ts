// Envoi du logo et de la fiche d'un token vers IPFS par pump.fun, depuis le serveur :
// pump.fun refuse souvent ces envois venant d'une page web, et l'utilisateur n'a ainsi besoin d'aucune clé (Pinata…).
// Réservé aux comptes connectés, contrôlé (image, longueurs) et limité (30 envois par heure).
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

const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? '').trim().slice(0, max);
const url = (s: string) => (!s || /^https?:\/\/\S+\.\S+$/.test(s) ? s : '');

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);
  const { data: { user } } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
  if (!user) return json(401, { error: 'Connexion requise.' }, h);

  // limite : 30 envois par heure et par compte
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('audit_log').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('event', 'token_meta_upload').gte('created_at', since);
  if ((count ?? 0) >= 30) return json(429, { error: 'Trop d\'envois en une heure : réessayez un peu plus tard.' }, h);

  let f: FormData;
  try { f = await req.formData(); } catch { return json(400, { error: 'Envoi illisible.' }, h); }
  const file = f.get('file');
  if (!(file instanceof File)) return json(400, { error: 'Logo manquant.' }, h);
  if (!TYPES.has(file.type)) return json(400, { error: 'Logo : PNG, JPEG, GIF ou WebP seulement.' }, h);
  if (file.size > 4 * 1024 * 1024) return json(400, { error: 'Logo trop lourd (4 Mo maximum).' }, h);
  const name = text(f, 'name', 32), symbol = text(f, 'symbol', 10).replace(/[^A-Za-z0-9]/g, '');
  if (!name || !symbol) return json(400, { error: 'Nom et symbole obligatoires.' }, h);

  const out = new FormData();
  out.append('file', file, 'logo.' + (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg'));
  out.append('name', name); out.append('symbol', symbol); out.append('description', text(f, 'description', 1000));
  out.append('twitter', url(text(f, 'twitter', 200))); out.append('telegram', url(text(f, 'telegram', 200))); out.append('website', url(text(f, 'website', 200)));
  out.append('showName', 'true');
  let r: Response;
  try { r = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: out, signal: AbortSignal.timeout(30_000) }); }
  catch { return json(502, { error: 'pump.fun ne répond pas. Réessayez dans un instant.' }, h); }
  if (!r.ok) return json(502, { error: 'pump.fun a refusé la fiche du token (' + r.status + ').' }, h);
  const j = await r.json().catch(() => ({}));
  if (typeof j.metadataUri !== 'string' || !/^https:\/\//.test(j.metadataUri)) return json(502, { error: 'Réponse inattendue de pump.fun.' }, h);
  await admin.from('audit_log').insert({ user_id: user.id, event: 'token_meta_upload', detail: { symbol, uri: j.metadataUri } });
  return json(200, { metadataUri: j.metadataUri, image: j.metadata?.image ?? null }, h);
});
