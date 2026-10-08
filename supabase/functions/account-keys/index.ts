// Clés API du compte (adresse RPC Helius, jeton Pinata) : chiffrées ici (AES-256-GCM, clé maître du Vault,
// liées au compte) et rendues en clair seulement à leur propriétaire connecté.
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
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ''; u.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let master: CryptoKey | null = null;
async function masterKey() {
  if (master) return master;
  const { data } = await admin.rpc('app_secret', { n: 'wallet_master_key' });
  if (!data) throw new Error('config');
  master = await crypto.subtle.importKey('raw', unb64(data as string), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return master;
}

type Keys = { rpc?: string; pinataJwt?: string };
function clean(k: Keys): Keys {
  const out: Keys = {};
  if (typeof k.rpc === 'string' && k.rpc) {
    if (!/^https:\/\/[^\s]{8,300}$/.test(k.rpc)) throw new Error('Adresse RPC invalide.');
    out.rpc = k.rpc;
  }
  if (typeof k.pinataJwt === 'string' && k.pinataJwt) {
    if (k.pinataJwt.length > 4000 || k.pinataJwt.split('.').length !== 3) throw new Error('Jeton Pinata invalide.');
    out.pinataJwt = k.pinataJwt;
  }
  return out;
}
async function read(uid: string): Promise<Keys> {
  const { data } = await admin.rpc('akeys_get', { uid });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.enc) return {};
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv), additionalData: enc.encode('keys:' + uid) }, await masterKey(), unb64(row.enc));
  return JSON.parse(dec.decode(plain));
}
async function write(uid: string, k: Keys) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('keys:' + uid) }, await masterKey(), enc.encode(JSON.stringify(k))));
  const { error } = await admin.rpc('akeys_set', { uid, p_enc: b64(c), p_iv: b64(iv) });
  if (error) throw new Error('Enregistrement impossible.');
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' }, h);
  const { data: { user } } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
  if (!user) return json(401, { error: 'Connexion requise.' }, h);
  let body: { action?: string; keys?: Keys } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  try {
    if (body.action === 'get') return json(200, { keys: await read(user.id) }, h);
    if (body.action === 'set') { const k = clean(body.keys ?? {}); await write(user.id, k); return json(200, { ok: true }, h); }
    return json(400, { error: 'Action inconnue.' }, h);
  } catch (e) {
    const m = (e as Error).message;
    return json(m === 'config' ? 500 : 400, { error: m === 'config' ? 'Configuration du serveur incomplète.' : m }, h);
  }
});
