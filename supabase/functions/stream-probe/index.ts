// Sonde de diagnostic du flux temps réel (protégée par la clé de surveillance) : ouvre une connexion, s'abonne aux
// transactions d'un wallet, compte et renvoie les premiers messages reçus. Lecture seule, rien n'est enregistré.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

Deno.serve(async (req) => {
  const { data: key } = await admin.rpc('app_secret', { n: 'watch_key' });
  if (!key || req.headers.get('x-watch-key') !== key) return json(401, { error: 'Clé invalide.' });
  const b = await req.json().catch(() => ({})) as { address?: string; method?: string; ms?: number };
  if (!b.address || !MINT.test(b.address)) return json(400, { error: 'Adresse invalide.' });
  const method = b.method === 'subscribeTokenTrade' ? 'subscribeTokenTrade' : 'subscribeAccountTrade';
  const ms = Math.min(40_000, Math.max(5_000, Number(b.ms) || 25_000));
  const got: string[] = [];
  let n = 0, opened = false, closed: string | null = null;
  await new Promise<void>((done) => {
    const ws = new WebSocket('wss://pumpportal.fun/api/data');
    const t = setTimeout(() => { try { ws.close(); } catch { /* fermé */ } done(); }, ms);
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ method, keys: [b.address] })); };
    ws.onmessage = (e) => { n++; if (got.length < 6) got.push(String(e.data).slice(0, 400)); };
    ws.onclose = (e) => { closed = e.code + ' ' + e.reason; clearTimeout(t); done(); };
    ws.onerror = () => { closed = closed ?? 'erreur'; };
  });
  return json(200, { method, opened, messages: n, closed, sample: got });
});
