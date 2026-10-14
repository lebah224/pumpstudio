// Achats programmés : chaque ordre actif est évalué à chaque transaction de son token, reçue du flux continu
// (abonnement aux seuls tokens visés). Conditions, toutes vraies : capitalisation sous / au-dessus d'un seuil, recul
// depuis le plus haut (relevé depuis la création de l'ordre), achats des autres ou SOL achetés sur une fenêtre de temps.
// Garde : l'ordre s'annule si le créateur vend. Achat direct sur la courbe pump.fun (même chemin que l'achat
// automatique), une seule fois par ordre ; la stratégie de sortie est attachée à la confirmation.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { fastBuy, hotWallet, settle, type Hot } from './fastbuy.ts';
import type { Strat, TradeMsg } from './exits.ts';

type Cond = { k: 'mcap_below' | 'mcap_above' | 'dip' | 'buys' | 'buy_sol'; v: number; w?: number };
type Order = { id: string; user_id: string; mint: string; symbol: string | null; creator: string | null; wallet: string; amount_sol: number; slippage: number;
  priority: number; conds: Cond[]; cancel_on_creator_sell: boolean; expires_at: string; exit_rules: unknown[] | null; exit_slippage: number;
  state: { peak?: number }; created_at: string; max_buy_sol: number };
type Live = { o: Order; price: number | null; mcapSol: number | null; peak: number; peakSaved: number; buys: [number, number][]; firing: boolean; done: boolean };
type Push = (uid: string, title: string, body: string, url: string, tag: string) => Promise<void>;

const nf = (v: number, d = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
const WIN_MAX = 600_000;   // fenêtre la plus longue gardée en mémoire : 10 minutes

export function entryEngine(admin: SupabaseClient, push: Push, onBought: (s: Strat) => void) {
  const live = new Map<string, Live>();
  const ours = new Map<string, Set<string>>();
  const hot = new Map<string, Promise<Hot | null>>();
  const sigs = new Set<string>();
  const pending = new Set<Promise<unknown>>();
  let solUsd: number | null = null, solAt = 0, bought = 0;

  async function solPrice() {
    if (solUsd && Date.now() - solAt < 300_000) return;
    try {
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDC', { signal: AbortSignal.timeout(4000) });
      const v = Number((await r.json())?.price); if (v > 0) { solUsd = v; solAt = Date.now(); }
    } catch { /* conditions en dollars : prochain chargement */ }
  }
  async function load() {
    const { data, error } = await admin.rpc('buy_orders_active');
    if (error) return;
    const rows = (data ?? []) as Order[], keep = new Set(rows.map((o) => o.id));
    for (const [id, l] of live) if (!keep.has(id) && !l.firing) live.delete(id);
    for (const o of rows) {
      o.amount_sol = Number(o.amount_sol); o.slippage = Number(o.slippage); o.priority = Number(o.priority); o.exit_slippage = Number(o.exit_slippage); o.max_buy_sol = Number(o.max_buy_sol);
      const cur = live.get(o.id);
      if (cur) { if (!cur.firing) cur.o = o; continue; }
      const peak = Number(o.state?.peak) || 0;
      live.set(o.id, { o, price: null, mcapSol: null, peak, peakSaved: peak, buys: [], firing: false, done: false });
    }
    const users = [...new Set(rows.map((o) => o.user_id))].filter((u) => !ours.has(u));
    if (users.length) {
      const { data: sw } = await admin.from('server_wallets').select('user_id,address').in('user_id', users);
      users.forEach((u) => ours.set(u, new Set()));
      (sw ?? []).forEach((w: { user_id: string; address: string }) => ours.get(w.user_id)!.add(w.address));
    }
    await solPrice();
    // plus haut relevé : gardé pour la prochaine écoute (condition « recul »)
    const marks = [...live.values()].filter((l) => l.peak > l.peakSaved * 1.001).map((l) => { l.peakSaved = l.peak; return { id: l.o.id, state: { peak: l.peak } }; });
    if (marks.length) await admin.rpc('buy_orders_mark', { rows: marks });
  }
  const mints = () => new Set([...live.values()].filter((l) => !l.done).map((l) => l.o.mint));

  function check(c: Cond, l: Live, now: number): boolean {
    const v = Number(c.v) || 0, mcapUsd = l.mcapSol != null && solUsd ? l.mcapSol * solUsd : null;
    const since = now - Math.min(WIN_MAX, Math.max(5, Number(c.w) || 60) * 1000);
    switch (c.k) {
      case 'mcap_below': return mcapUsd != null && mcapUsd <= v;
      case 'mcap_above': return mcapUsd != null && mcapUsd >= v;
      case 'dip': return !!(l.price && l.peak && l.price <= l.peak * (1 - v / 100));
      case 'buys': return l.buys.filter((b) => b[0] >= since).length >= v;
      case 'buy_sol': return l.buys.filter((b) => b[0] >= since).reduce((a, b) => a + b[1], 0) >= v;
    }
    return false;
  }
  function evaluate(l: Live) {
    if (l.firing || l.done) return;
    const now = Date.now();
    if (Date.parse(l.o.expires_at) < now) { l.done = true; return; }
    if (l.o.conds.length && l.o.conds.every((c) => check(c, l, now))) track(fire(l));
  }
  const track = (p: Promise<unknown>) => { pending.add(p); p.finally(() => pending.delete(p)); };

  function onTrade(m: TradeMsg) {
    // vente du créateur (vue sur son wallet) : annule les ordres qui le demandent
    if (m.txType === 'creator_sell') {
      for (const l of live.values()) if (l.o.mint === m.mint && !l.done && !l.firing && l.o.cancel_on_creator_sell && l.o.creator === m.traderPublicKey) track(cancel(l));
      return;
    }
    if (!m.mint || (m.txType !== 'buy' && m.txType !== 'sell')) return;
    if (m.signature) { if (sigs.has(m.signature)) return; sigs.add(m.signature); if (sigs.size > 5000) sigs.clear(); }
    const vS = Number(m.vSolInBondingCurve), vT = Number(m.vTokensInBondingCurve), sol = Number(m.solAmount) || 0, tok = Number(m.tokenAmount) || 0;
    const price = vS > 0 && vT > 0 ? vS / vT : sol > 0 && tok > 0 ? sol / tok : null;
    const now = Date.now(), who = m.traderPublicKey ?? '';
    for (const l of live.values()) {
      if (l.o.mint !== m.mint || l.done) continue;
      if (price) { l.price = price; l.peak = Math.max(l.peak, price); }
      if (Number(m.marketCapSol) > 0) l.mcapSol = Number(m.marketCapSol);
      if (!(who && ours.get(l.o.user_id)?.has(who))) {
        if (m.txType === 'buy') { l.buys.push([now, sol]); while (l.buys.length && l.buys[0]![0] < now - WIN_MAX) l.buys.shift(); }
        else if (who && who === l.o.creator && l.o.cancel_on_creator_sell && !l.firing) { track(cancel(l)); continue; }
      }
      evaluate(l);
    }
  }

  async function cancel(l: Live) {
    l.done = true;
    await admin.rpc('buy_order_finish', { p_id: l.o.id, p_status: 'cancelled', p_state: { reason: 'Le créateur a vendu : achat annulé.', at: Date.now() } });
    await push(l.o.user_id, 'Achat programmé annulé · ' + (l.o.symbol || l.o.mint.slice(0, 4)), 'Le créateur a vendu : l\'ordre ne s\'exécutera pas.', '/app?page=trade&mint=' + l.o.mint, 'bo-' + l.o.id);
    live.delete(l.o.id);
  }

  async function fire(l: Live) {
    l.firing = true;
    const o = l.o, t0 = Date.now(), sym = o.symbol || o.mint.slice(0, 4);
    let reserved = 0;
    const fail = async (reason: string) => {
      if (reserved) await admin.rpc('sw_release', { uid: o.user_id, addr: o.wallet, sol: reserved });
      await admin.rpc('buy_order_finish', { p_id: o.id, p_status: 'failed', p_state: { reason: reason.slice(0, 200), at: Date.now() } });
      await push(o.user_id, 'Achat programmé échoué · ' + sym, reason, '/app?page=trade&mint=' + o.mint, 'bo-' + o.id);
    };
    try {
      if (!(await admin.rpc('buy_order_claim', { p_id: o.id })).data) { l.done = true; return; }
      l.done = true;
      if (o.amount_sol > o.max_buy_sol) return await fail('Montant au-delà de votre limite par achat (' + nf(o.max_buy_sol) + ' SOL, réglable dans Préférences).');
      const k = o.user_id + ':' + o.wallet;
      if (!hot.has(k)) hot.set(k, hotWallet(admin, o.user_id, o.wallet).catch(() => null));
      const w = await hot.get(k);
      if (!w) return await fail('Wallet rapide introuvable ou illisible.');
      const maxCost = o.amount_sol * (1 + o.slippage / 100);
      const { error } = await admin.rpc('sw_reserve', { uid: o.user_id, addr: o.wallet, sol: maxCost });
      if (error) return await fail(error.message.includes('Plafond') ? error.message : 'Plafond journalier du wallet atteint.');
      reserved = maxCost;
      let sent: Awaited<ReturnType<typeof fastBuy>>;
      try { sent = await fastBuy(w, o.mint, o.amount_sol, o.slippage, o.priority, Promise.resolve(true)); }
      catch (e) { const msg = (e as Error).message; return await fail(/migré/.test(msg) ? 'Token migré : l\'achat programmé fonctionne sur la courbe pump.fun, avant la migration.' : msg); }
      if (!sent) return await fail('Achat non envoyé.');
      const sendMs = Date.now() - t0;
      const res = await settle(sent.signature, o.wallet, o.mint);
      if (!res.ok) return await fail(res.reason);
      const sol = res.sol ?? o.amount_sol, tokens = res.tokens ?? 0;
      if (reserved > sol) await admin.rpc('sw_release', { uid: o.user_id, addr: o.wallet, sol: reserved - sol });
      reserved = 0;
      let strategy: string | null = null;
      if (o.exit_rules?.length && tokens > 0) {
        const { data } = await admin.from('strategies').insert({ user_id: o.user_id, mint: o.mint, symbol: o.symbol, wallet: o.wallet, creator: o.creator, entry_at: new Date().toISOString(),
          entry_price: sol / tokens, entry_tokens: tokens, entry_sol: sol, slippage: o.exit_slippage, rules: o.exit_rules, status: 'active' }).select('*').maybeSingle();
        if (data) { strategy = (data as { id: string }).id; onBought(data as Strat); }
      }
      bought++;
      await admin.rpc('buy_order_finish', { p_id: o.id, p_status: 'done', p_state: { signature: sent.signature, sol, tokens, send_ms: sendMs, strategy_id: strategy, at: Date.now() } });
      await admin.from('operations').insert({ user_id: o.user_id, client_id: 'bo-' + o.id.slice(0, 8) + '-' + Date.now().toString(36), type: 'buy', status: 'ok',
        mint: o.mint, symbol: o.symbol, sol: -sol, tokens, estimated: false, auto: true, signature: sent.signature, at: new Date().toISOString() });
      await admin.from('audit_log').insert({ user_id: o.user_id, event: 'server_scheduled_buy', detail: { signature: sent.signature, mint: o.mint, sol, tokens, send_ms: sendMs } });
      await push(o.user_id, 'Achat programmé · ' + sym, nf(sol) + ' SOL · conditions remplies, achat parti en ' + nf(sendMs / 1000, 2) + ' s' + (strategy ? ' · stratégie de sortie active' : '') + '.', '/app?page=trade&mint=' + o.mint, 'bo-' + o.id);
    } catch (e) { await fail((e as Error).message || 'Erreur inattendue.').catch(() => {}); }
    finally { l.firing = false; live.delete(o.id); }
  }

  const creators = () => new Set([...live.values()].filter((l) => !l.done && l.o.cancel_on_creator_sell && l.o.creator).map((l) => l.o.creator!));
  return { load, mints, creators, onTrade, tick: () => { for (const l of live.values()) evaluate(l); }, size: () => live.size,
    idle: () => Promise.allSettled([...pending]), stats: () => ({ tracked: live.size, bought }) };
}
