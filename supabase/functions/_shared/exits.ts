// Ventes en temps réel : les stratégies de sortie actives sont évaluées à chaque transaction de leur token, reçue du
// flux continu (abonnement aux seuls tokens détenus). Mêmes conditions que la surveillance toutes les 5 secondes
// (strategy-watch, qui reste en filet de sécurité) ; une règle n'est prise qu'une fois, quelle que soit la surveillance.
// Vente directe sur la courbe pump.fun avec le wallet rapide ; token migré ou wallet indisponible : fonction server-wallet.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { fastSell, hotWallet, settle, type Hot } from './fastbuy.ts';

type Cond = { k: 'gain' | 'loss' | 'trail' | 'buys' | 'sells' | 'sell_sol' | 'creator_sell' | 'age' | 'mcap'; v?: number; arm?: number };
type Rule = { id: string; all: Cond[]; sell: number };
type Seen = { at?: number; buys?: number; sells?: number; sellSol?: number; creatorSold?: boolean };
type State = { fired?: string[]; peak?: number; ref?: number; fails?: number; retry_at?: number; seen?: Seen; log?: { t: number; rule: string; ok: boolean; msg: string; sig?: string; sol?: number }[] };
export type Strat = { id: string; user_id: string; mint: string; symbol: string | null; wallet: string | null; creator: string | null; entry_at: string;
  entry_price: number | null; slippage: number; rules: Rule[]; status: string; state: State };
export type TradeMsg = { mint?: string; txType?: string; traderPublicKey?: string; solAmount?: number; tokenAmount?: number; marketCapSol?: number;
  vSolInBondingCurve?: number; vTokensInBondingCurve?: number; signature?: string };
type Live = { s: Strat; since: number; buys: number; sells: number; sellSol: number; creatorSold: boolean; price: number | null; mcapSol: number | null; peak: number; firing: boolean; at: number };
type Push = (uid: string, title: string, body: string, url: string, tag: string) => Promise<void>;

const pct = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
const solTxt = (n: number) => (Math.round(n * 10000) / 10000).toString().replace('.', ',');

export function exitEngine(admin: SupabaseClient, push: Push, watchKey: () => string) {
  const live = new Map<string, Live>();          // par stratégie
  const ours = new Map<string, Set<string>>();   // wallets rapides de chaque compte (leurs transactions ne comptent pas)
  const hot = new Map<string, Promise<Hot | null>>();
  let solUsd: number | null = null, solAt = 0;
  let sold = 0, evals = 0;
  const sigs = new Set<string>();                // une transaction peut arriver par deux abonnements : comptée une fois
  const pending = new Set<Promise<unknown>>();

  async function solPrice() {
    if (solUsd && Date.now() - solAt < 300_000) return;
    try {
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDC', { signal: AbortSignal.timeout(4000) });
      const v = Number((await r.json())?.price); if (v > 0) { solUsd = v; solAt = Date.now(); }
    } catch { /* capitalisation : le filet de 5 s s'en charge */ }
  }

  /** stratégies actives ; les compteurs déjà relevés (state.seen) servent de point de départ */
  async function load() {
    const { data, error } = await admin.rpc('strategies_due');
    if (error) return;
    const rows = (data ?? []) as Strat[], keep = new Set(rows.map((s) => s.id));
    for (const id of [...live.keys()]) if (!keep.has(id) && !live.get(id)!.firing) live.delete(id);
    for (const s of rows) {
      const cur = live.get(s.id);
      if (cur) { if (!cur.firing) cur.s = s; continue; }
      const seen = s.state.seen ?? {}, entry = Date.parse(s.entry_at), base = seen.at && seen.at > entry ? seen.at : entry;
      live.set(s.id, { s, since: Math.max(base, Date.now() - 2000), buys: seen.at ? seen.buys ?? 0 : 0, sells: seen.at ? seen.sells ?? 0 : 0, sellSol: seen.at ? seen.sellSol ?? 0 : 0,
        creatorSold: !!seen.creatorSold, price: null, mcapSol: null, peak: Number(s.state.peak) || 0, firing: false, at: 0 });
    }
    const users = [...new Set(rows.map((s) => s.user_id))].filter((u) => !ours.has(u));
    if (users.length) {
      const { data: sw } = await admin.from('server_wallets').select('user_id,address').in('user_id', users);
      users.forEach((u) => ours.set(u, new Set()));
      (sw ?? []).forEach((w: { user_id: string; address: string }) => ours.get(w.user_id)!.add(w.address));
    }
    await solPrice();
  }
  /** nouvelle stratégie (achat automatique confirmé) : suivie aussitôt */
  function add(s: Strat) {
    if (!live.has(s.id)) live.set(s.id, { s, since: Date.parse(s.entry_at), buys: 0, sells: 0, sellSol: 0, creatorSold: false, price: null, mcapSol: null, peak: 0, firing: false, at: 0 });
    if (!ours.has(s.user_id)) admin.from('server_wallets').select('address').eq('user_id', s.user_id).then(({ data }) => ours.set(s.user_id, new Set((data ?? []).map((w: { address: string }) => w.address))));
  }
  const mints = () => new Set([...live.values()].map((l) => l.s.mint));

  function facts(l: Live) {
    const ref = Number(l.s.entry_price) || l.s.state.ref || null;
    return { price: l.price, ref, peak: Math.max(l.peak, l.price ?? 0) || null, mcapUsd: l.mcapSol != null && solUsd ? l.mcapSol * solUsd : null,
      buys: l.buys, sells: l.sells, sellSol: l.sellSol, creatorSold: l.creatorSold, ageMin: (Date.now() - Date.parse(l.s.entry_at)) / 60000 };
  }
  type F = ReturnType<typeof facts>;
  function check(c: Cond, f: F): { ok: boolean; why: string } {
    const v = Number(c.v) || 0;
    switch (c.k) {
      case 'gain': return { ok: !!(f.price && f.ref && f.price >= f.ref * (1 + v / 100)), why: 'gain de +' + pct(v) + ' %' };
      case 'loss': return { ok: !!(f.price && f.ref && f.price <= f.ref * (1 - v / 100)), why: 'perte de −' + pct(v) + ' %' };
      case 'trail': {
        const arm = Number(c.arm) || 0, armed = !!(f.peak && f.ref && f.peak >= f.ref * (1 + arm / 100));
        return { ok: !!(armed && f.price && f.peak && f.price <= f.peak * (1 - v / 100)), why: 'recul de ' + pct(v) + ' % depuis le plus haut' };
      }
      case 'buys': return { ok: f.buys >= v, why: Math.round(v) + ' achat' + (v > 1 ? 's' : '') + ' après le vôtre' };
      case 'sells': return { ok: f.sells >= v, why: Math.round(v) + ' vente' + (v > 1 ? 's' : '') + ' après votre achat' };
      case 'sell_sol': return { ok: f.sellSol >= v, why: pct(v) + ' SOL vendus par les autres' };
      case 'creator_sell': return { ok: f.creatorSold, why: 'le créateur a vendu' };
      case 'age': return { ok: f.ageMin >= v, why: Math.round(v) + ' min écoulées' };
      case 'mcap': return { ok: !!(f.mcapUsd && f.mcapUsd >= v), why: 'capitalisation de ' + Math.round(v).toLocaleString('fr-FR') + ' $' };
    }
    return { ok: false, why: '' };
  }
  function evaluate(l: Live) {
    if (l.firing || l.s.status !== 'active' || (l.s.state.retry_at && l.s.state.retry_at > Date.now())) return;
    evals++;
    const f = facts(l), fired = new Set(l.s.state.fired ?? []);
    for (const rule of l.s.rules) {
      if (fired.has(rule.id) || !rule.all?.length) continue;
      const res = rule.all.map((c) => check(c, f));
      if (res.every((x) => x.ok)) { const p = fire(l, rule, res.map((x) => x.why).join(' et ')); pending.add(p); p.finally(() => pending.delete(p)); return; }
    }
  }

  /** transaction reçue du flux pour un token suivi */
  function onTrade(m: TradeMsg) {
    // vente du créateur (vue sur son wallet) : signal à part, la vente elle-même est déjà comptée par la courbe
    if (m.txType === 'creator_sell') {
      for (const l of live.values()) if (l.s.mint === m.mint && l.s.creator && l.s.creator === m.traderPublicKey && Date.now() > l.since) { l.creatorSold = true; evaluate(l); }
      return;
    }
    if (!m.mint || (m.txType !== 'buy' && m.txType !== 'sell')) return;
    if (m.signature) { if (sigs.has(m.signature)) return; sigs.add(m.signature); if (sigs.size > 5000) sigs.clear(); }
    const vS = Number(m.vSolInBondingCurve), vT = Number(m.vTokensInBondingCurve), sol = Number(m.solAmount) || 0, tok = Number(m.tokenAmount) || 0;
    const price = vS > 0 && vT > 0 ? vS / vT : sol > 0 && tok > 0 ? sol / tok : null;
    const now = Date.now();
    for (const l of live.values()) {
      if (l.s.mint !== m.mint) continue;
      if (price) { l.price = price; l.peak = Math.max(l.peak, price); }
      if (Number(m.marketCapSol) > 0) l.mcapSol = Number(m.marketCapSol);
      l.at = now;
      const who = m.traderPublicKey ?? '';
      // transaction d'un autre (sans auteur connu quand elle vient de la courbe)
      if (now > l.since && !(who && ours.get(l.s.user_id)?.has(who))) {
        if (m.txType === 'buy') l.buys++; else { l.sells++; l.sellSol += sol; if (who === l.s.creator) l.creatorSold = true; }
      }
      evaluate(l);
    }
  }
  /** conditions de durée (et prix déjà connu) : vérifiées chaque seconde */
  function tick() { for (const l of live.values()) if (l.price != null || l.s.rules.some((r) => r.all.some((c) => c.k === 'age'))) evaluate(l); }

  async function serverSell(s: Strat, rule: Rule) {
    try {
      const r = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/server-wallet', {
        method: 'POST', signal: AbortSignal.timeout(55_000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), 'x-watch-key': watchKey() },
        body: JSON.stringify({ action: 'auto_sell', uid: s.user_id, mint: s.mint, pct: Math.min(100, Math.max(1, Number(rule.sell) || 100)), slippage: Number(s.slippage) || 25, address: s.wallet, priority: 0.003 }),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok && !!j.signature, ...j } as { ok: boolean; signature?: string; sol?: number; tokens?: number; confirmed?: boolean; error?: string };
    } catch (e) { return { ok: false, error: (e as Error).message || 'injoignable' }; }
  }
  async function sellNow(s: Strat, rule: Rule) {
    const share = Math.min(100, Math.max(1, Number(rule.sell) || 100));
    if (s.wallet) {
      const k = s.user_id + ':' + s.wallet;
      if (!hot.has(k)) hot.set(k, hotWallet(admin, s.user_id, s.wallet).catch(() => null));
      const w = await hot.get(k);
      if (w) {
        try {
          const r = await fastSell(w, s.mint, share, Number(s.slippage) || 25, 0.003);
          if ('signature' in r) {
            const st = await settle(r.signature, w.address, s.mint, 25_000);
            if (!st.ok) return { ok: false, error: st.reason };
            return { ok: true, signature: r.signature, sol: st.received ?? undefined, tokens: st.tokens != null ? Math.abs(st.tokens) : undefined, confirmed: true };
          }
          // token migré ou rien dans ce wallet : la fonction server-wallet choisit le bon chemin et le bon wallet
        } catch (e) { return { ok: false, error: (e as Error).message }; }
      }
    }
    return serverSell(s, rule);
  }

  async function fire(l: Live, rule: Rule, why: string) {
    l.firing = true;
    const s = l.s, t0 = Date.now();
    try {
      // déjà prise (l'autre surveillance, un autre passage) : on relit l'état au prochain chargement
      if (!(await admin.rpc('strategy_claim_rule', { p_id: s.id, p_rule: rule.id })).data) { s.state = { ...s.state, retry_at: Date.now() + 4000 }; return; }
      const sym = s.symbol || s.mint.slice(0, 4);
      const r = await sellNow(s, rule);
      const fired = [...new Set([...(s.state.fired ?? []), rule.id])];
      const log = [...(s.state.log ?? []), { t: Date.now(), rule: rule.id, ok: r.ok, msg: why, sig: r.signature, sol: r.sol }].slice(-20);
      const Why = why[0]!.toUpperCase() + why.slice(1);
      if (r.ok && r.signature) {
        sold++;
        const left = s.rules.filter((x) => !fired.includes(x.id)).length, finished = rule.sell >= 100 || !left;
        const patch = { fired, log, fails: 0, retry_at: 0, last: { t: Date.now(), sig: r.signature, sol: r.sol ?? 0, live: true, ms: Date.now() - t0 } };
        await admin.rpc('strategy_save', { p_id: s.id, p_state: patch, p_status: finished ? 'done' : null });
        s.state = { ...s.state, ...patch }; if (finished) { s.status = 'done'; live.delete(s.id); }
        await admin.from('operations').insert({ user_id: s.user_id, client_id: 'stg-' + s.id.slice(0, 8) + '-' + Date.now().toString(36), type: 'sell', status: 'ok',
          mint: s.mint, symbol: s.symbol, sol: r.sol ?? 0, tokens: -(r.tokens ?? 0), estimated: !r.confirmed, auto: true, signature: r.signature, at: new Date().toISOString() });
        await push(s.user_id, 'Vendu · ' + sym, Why + ' : ' + (rule.sell >= 100 ? 'tout vendu' : rule.sell + ' % vendus') + (r.sol ? ' · +' + solTxt(r.sol) + ' SOL' : '') + '.', '/app?page=trade&mint=' + s.mint, 'stg-' + s.id);
      } else if (r.error === 'no_tokens' || r.error === 'no_wallet') {
        await admin.rpc('strategy_save', { p_id: s.id, p_state: { fired, log, end: 'no_tokens' }, p_status: 'done' });
        s.status = 'done'; live.delete(s.id);
        await push(s.user_id, 'Stratégie terminée · ' + sym, Why + ', mais vos wallets rapides ne détiennent plus ce token.', '/app?page=trade&mint=' + s.mint, 'stg-' + s.id);
      } else {
        const fails = (s.state.fails ?? 0) + 1, stop = fails >= 5;
        const patch = { log, fails, retry_at: Date.now() + Math.min(60_000, 3_000 * fails), last_error: (r.error ?? 'erreur').slice(0, 160) };
        await admin.rpc('strategy_save', { p_id: s.id, p_state: patch, p_status: stop ? 'error' : null });
        s.state = { ...s.state, ...patch }; if (stop) { s.status = 'error'; live.delete(s.id); }
        if (fails === 1 || stop) await push(s.user_id, (stop ? 'Stratégie en erreur · ' : 'Vente en échec · ') + sym, Why + '. ' + (stop ? 'Cinq essais ont échoué : vendez depuis TokenStudio.' : 'Nouvel essai dans quelques secondes.') + ' (' + (r.error ?? '').slice(0, 70) + ')', '/app?page=trade&mint=' + s.mint, 'stg-' + s.id);
      }
    } finally { l.firing = false; }
  }

  /** créateurs des tokens suivis (leur vente est écoutée sur leur wallet) */
  const creators = () => new Set([...live.values()].filter((l) => l.s.creator && l.s.rules.some((r) => r.all?.some((c) => c.k === 'creator_sell'))).map((l) => l.s.creator!));
  return { load, add, mints, creators, onTrade, tick, size: () => live.size, idle: () => Promise.allSettled([...pending]), stats: () => ({ tracked: live.size, evals, sold }) };
}
