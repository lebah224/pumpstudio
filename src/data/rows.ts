// Conversions entre les données du studio et les lignes de la base (validées ici ET par les contraintes de la base).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = (ms: unknown) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null; };
const ms = (s: unknown) => { const n = Date.parse(String(s ?? '')); return Number.isFinite(n) ? n : Date.now(); };
const httpUrl = (v: unknown, max: number) => (typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= max ? v : null);
export const hash = (o: unknown) => { const s = JSON.stringify(o); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36) + s.length.toString(36); };
const OP_TYPES = new Set(['create', 'buy', 'sell', 'fees']);
const ORDER_KINDS = new Set(['tp', 'sl', 'trail', 'mcap']);
const ORDER_MAIN = new Set(['id', 'mint', 'symbol', 'kind', 'value', 'pct', 'ref', 'active']);

/* ---------- conversion navigateur → base ---------- */
export const toRow = {
  token(t: Obj) {
    if (!B58.test(t.mint || '')) return null;
    const symbol = String(t.symbol || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'TOKEN';
    return { mint: t.mint, name: str(t.name, 32) || symbol, symbol, platform: !t.platform || t.platform === 'pump' ? 'pump' : 'other',
      image_url: httpUrl(t.image, 500), thumb: typeof t.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(t.image) && t.image.length <= 24000 ? t.image : null, description: str(t.desc, 1000), twitter: str(t.tw, 200), telegram: str(t.tg, 200), website: str(t.web, 200),
      dev_sol: num(t.dev) != null && Number(t.dev) >= 0 ? Number(t.dev) : null, signature: str(t.sig, 100), added_manually: !!t.added, launched_at: iso(t.createdAt) };
  },
  op(j: Obj) {
    if (!OP_TYPES.has(j.type) || j.id == null) return null;
    return { client_id: String(j.id).slice(0, 64), type: j.type, status: j.status === 'err' ? 'err' : 'ok', sim: !!j.sim, mint: B58.test(j.mint || '') ? j.mint : null,
      symbol: str(j.symbol, 32), sol: num(j.sol), tokens: num(j.tokens), estimated: !!j.est, auto: !!j.auto, signature: str(j.sig, 100), error: str(j.err, 500), at: iso(j.t) || new Date().toISOString() };
  },
  order(o: Obj) {
    if (!B58.test(o.mint || '') || !ORDER_KINDS.has(o.kind) || num(o.value) == null || o.id == null) return null;
    const state: Obj = {}; Object.keys(o).forEach((k) => { if (!ORDER_MAIN.has(k)) state[k] = o[k]; });
    const st = JSON.stringify(state).length < 3500 ? state : {};
    const pct = num(o.pct); const ref = num(o.ref);
    return { client_id: String(o.id).slice(0, 64), mint: o.mint, symbol: str(o.symbol, 32), kind: o.kind, value: Number(o.value),
      pct: pct != null && pct > 0 && pct <= 100 ? pct : 100, ref_price: ref != null && ref >= 0 ? ref : null, active: !!o.active, state: st };
  },
  dist(mint: string, platform: string, r: Obj) {
    if (!B58.test(mint) || !/^[a-z0-9_-]{2,32}$/.test(platform)) return null;
    return { mint, platform, status: r?.done ? 'accepted' : 'sent', sent_at: iso(r?.at) || new Date().toISOString() };
  },
  draft(d: Obj) {
    if (!d || !str(d.name, 64)) return null;
    const data = JSON.parse(JSON.stringify(d)); delete data.image; delete data.imgSrc;
    return JSON.stringify(data).length < 60000 ? { client_id: 'current', title: str(d.name, 64), data } : null;
  },
};

/* ---------- conversion base → navigateur ---------- */
export const fromRow = {
  token: (r: Obj) => ({ mint: r.mint, name: r.name, symbol: r.symbol, image: r.image_url || r.thumb || '', createdAt: ms(r.launched_at || r.created_at), sig: r.signature || '',
    dev: r.dev_sol != null ? Number(r.dev_sol) : undefined, desc: r.description || '', tw: r.twitter || '', tg: r.telegram || '', web: r.website || '', platform: r.platform, added: r.added_manually || undefined }),
  op: (r: Obj) => ({ id: r.client_id || r.id, t: ms(r.at), type: r.type, mint: r.mint || '', symbol: r.symbol || '', sim: r.sim, status: r.status,
    sol: r.sol != null ? Number(r.sol) : 0, tokens: r.tokens != null ? Number(r.tokens) : 0, est: r.estimated || undefined, auto: r.auto || undefined, sig: r.signature || '', err: r.error || undefined }),
  order: (r: Obj) => Object.assign({}, r.state || {}, { id: r.client_id || r.id, mint: r.mint, symbol: r.symbol || '', kind: r.kind, value: Number(r.value), pct: Number(r.pct), ref: r.ref_price != null ? Number(r.ref_price) : undefined, active: r.active }),
};

