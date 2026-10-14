// Copie des achats d'un acheteur suivi (règles « copies »), exécutée par l'écoute continue (creator-stream).
// Achat : dès qu'un achat du wallet copié est confirmé et lu (_shared/chain.ts), un achat direct sur la courbe pump.fun
// part avec le wallet rapide choisi (une seule fois par token, filtres lus dans l'achat copié, plafond du jour).
// La stratégie de sortie choisie est attachée à la confirmation. Revente : si le wallet copié vend ce token, la position
// copiée est revendue en entier dans la foulée (si la règle le prévoit).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { fastBuy, fastSell, hotWallet, settle, type Hot } from './fastbuy.ts';
import type { Strat } from './exits.ts';
import type { WalletTrade } from './chain.ts';

type Push = (uid: string, title: string, body: string, url: string, tag: string) => Promise<void>;
type Copy = { id: string; user_id: string; trader: string; wallet: string; amount_sol: number; slippage: number; priority: number; max_per_day: number;
  filters: { min_sol?: number; max_sol?: number; mcap_max?: number }; copy_sells: boolean; exit_rules: unknown[] | null; exit_slippage: number; max_buy_sol: number };

const nf = (v: number, d = 3) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
const shortA = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);

export function copyEngine(admin: SupabaseClient, push: Push, onStrategy: (s: Strat) => void, symbolOf: (mint: string) => Promise<string | null>) {
  const rules = new Map<string, Copy[]>();          // par wallet copié
  const hot = new Map<string, Promise<Hot | null>>(); // wallets prêts à signer (uid:adresse)
  const pending = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };
  let bought = 0, skipped = 0, failed = 0, sold = 0;

  const hotOf = (uid: string, addr: string) => {
    const k = uid + ':' + addr;
    if (!hot.has(k)) { const h = hotWallet(admin, uid, addr).catch(() => null); hot.set(k, h); h.then((w) => { if (!w) hot.delete(k); }); }
    return hot.get(k)!;
  };

  async function load() {
    const { data, error } = await admin.rpc('copies_active');
    if (error) return;
    rules.clear();
    for (const c of (data ?? []) as Copy[]) {
      c.amount_sol = Number(c.amount_sol); c.slippage = Number(c.slippage); c.priority = Number(c.priority); c.max_buy_sol = Number(c.max_buy_sol); c.exit_slippage = Number(c.exit_slippage);
      (rules.get(c.trader) ?? rules.set(c.trader, []).get(c.trader)!).push(c);
      hotOf(c.user_id, c.wallet);
    }
  }

  function skipReason(c: Copy, t: WalletTrade, mc: number | null): string | null {
    const F = c.filters ?? {};
    if (F.min_sol != null && t.sol < F.min_sol) return 'Il engage ' + nf(t.sol) + ' SOL, sous votre minimum de ' + nf(F.min_sol) + ' SOL';
    if (F.max_sol != null && t.sol > F.max_sol) return 'Il engage ' + nf(t.sol) + ' SOL, au-dessus de votre maximum de ' + nf(F.max_sol) + ' SOL';
    if (F.mcap_max != null && mc != null && mc > F.mcap_max) return 'Capitalisation ' + nf(mc, 1) + ' SOL (maximum ' + nf(F.mcap_max, 1) + ' SOL)';
    if (c.amount_sol > c.max_buy_sol) return 'Montant au-delà de votre limite par achat (' + nf(c.max_buy_sol) + ' SOL, réglable dans Préférences)';
    return null;
  }

  async function buyOne(c: Copy, t: WalletTrade, at: number) {
    const mint = t.mint, mc = t.tokens > 0 ? (t.sol / t.tokens) * 1e9 : null;
    const sym = ((await Promise.race([symbolOf(mint), new Promise<null>((r) => setTimeout(() => r(null), 300))])) ?? '').slice(0, 32);
    const why = skipReason(c, t, mc);
    if (why) { skipped++; await admin.rpc('copy_skip', { p_id: c.id, p_mint: mint, p_symbol: sym, p_trader_sol: t.sol, p_reason: why }); return; }
    const w = await hotOf(c.user_id, c.wallet);
    const maxCost = c.amount_sol * (1 + c.slippage / 100);
    let run = null as string | null, reserved = 0;
    const fail = async (reason: string) => {
      failed++;
      if (reserved) await admin.rpc('sw_release', { uid: c.user_id, addr: c.wallet, sol: reserved });
      if (run) await admin.rpc('copy_run_set', { p_id: run, p: { status: 'failed', reason } });
      if (run) await push(c.user_id, 'Copie échouée · $' + (sym || '?'), reason, '/app?page=trade&mint=' + mint, 'copy-' + mint);
    };
    // autorisation pendant la préparation : prise de la règle (une fois par token), puis plafond du jour du wallet
    const gate = (async () => {
      const { data } = await admin.rpc('copy_claim', { p_id: c.id, p_mint: mint, p_symbol: sym, p_trader_sol: t.sol });
      run = (data as string | null) ?? null;
      if (!run) return false;
      if (!w) { await fail('Wallet rapide introuvable ou illisible.'); return false; }
      const { error } = await admin.rpc('sw_reserve', { uid: c.user_id, addr: c.wallet, sol: maxCost });
      if (error) { await fail(error.message.includes('Plafond') ? error.message : 'Plafond journalier du wallet atteint.'); return false; }
      reserved = maxCost;
      return true;
    })();
    let sent: Awaited<ReturnType<typeof fastBuy>> = null;
    try {
      if (!w) { await gate; return; }
      sent = await fastBuy(w, mint, c.amount_sol, c.slippage, c.priority, gate);
    } catch (e) {
      const ok = await gate.catch(() => false);
      const msg = (e as Error).message;
      if (run && ok) await fail(/migré/i.test(msg) ? 'Token déjà migré sur PumpSwap : la copie ne suit que les tokens encore sur la courbe pump.fun.' : msg);
      return;
    }
    if (!sent || !run) return;
    const sendMs = Date.now() - at;
    await admin.rpc('copy_run_set', { p_id: run, p: { status: 'sent', signature: sent.signature, send_ms: sendMs } });
    const res = await settle(sent.signature, c.wallet, mint);
    if (!res.ok) { await fail(res.reason); return; }
    const sol = res.sol ?? c.amount_sol, tokens = res.tokens ?? 0;
    if (reserved > sol) await admin.rpc('sw_release', { uid: c.user_id, addr: c.wallet, sol: reserved - sol });
    let strategy: string | null = null;
    if (c.exit_rules?.length && tokens > 0) {
      const { data } = await admin.from('strategies').insert({ user_id: c.user_id, mint, symbol: sym || null, wallet: c.wallet, entry_at: new Date().toISOString(),
        entry_price: sol / tokens, entry_tokens: tokens, entry_sol: sol, slippage: c.exit_slippage, rules: c.exit_rules, status: 'active' }).select('*').maybeSingle();
      strategy = (data as { id: string } | null)?.id ?? null;
      if (data) onStrategy(data as Strat);
    }
    bought++;
    await admin.rpc('copy_run_set', { p_id: run, p: { status: 'bought', sol, tokens, strategy_id: strategy } });
    await admin.from('audit_log').insert({ user_id: c.user_id, event: 'server_copy_buy', detail: { signature: sent.signature, mint, sol, tokens, send_ms: sendMs, trader: c.trader, trader_sig: t.sig } });
    await push(c.user_id, 'Copie · $' + (sym || '?'), nf(sol) + ' SOL, ' + nf(sendMs / 1000, 2) + ' s après l\'achat de ' + shortA(c.trader) + (strategy ? ' · stratégie de sortie active' : ''),
      '/app?page=trade&mint=' + mint, 'copy-' + mint);
  }

  // le wallet copié revend : chaque position copiée encore ouverte sur ce token est revendue en entier (une seule fois)
  async function sellAll(t: WalletTrade) {
    const { data } = await admin.rpc('copy_sell_claim', { p_trader: t.wallet, p_mint: t.mint });
    type R = { r_id: string; r_user: string; r_wallet: string; r_symbol: string | null; r_slippage: number; r_priority: number; r_strategy: string | null; r_sol: number | null };
    await Promise.all(((data ?? []) as R[]).map(async (r) => {
      const sym = r.r_symbol || '?';
      // la stratégie de sortie s'arrête : la position part en entier
      if (r.r_strategy) await admin.rpc('strategy_save', { p_id: r.r_strategy, p_state: { end: 'copy_sell' }, p_status: 'done' });
      const w = await hotOf(r.r_user, r.r_wallet);
      const back = async (reason: string) => {
        await admin.rpc('copy_run_set', { p_id: r.r_id, p: { status: 'bought', reason } });
        await push(r.r_user, 'Revente copiée impossible · $' + sym, reason, '/app?page=trade&mint=' + t.mint, 'copy-' + t.mint);
      };
      if (!w) { await back('Wallet rapide introuvable ou illisible : revendez depuis la fiche du token.'); return; }
      try {
        const s = await fastSell(w, t.mint, 100, Number(r.r_slippage) || 25, Number(r.r_priority) || 0.003);
        if ('migrated' in s) { await back('Token migré sur PumpSwap : revendez-le depuis la fiche du token.'); return; }
        if ('empty' in s) { await admin.rpc('copy_run_set', { p_id: r.r_id, p: { reason: 'Plus rien à revendre sur ce wallet' } }); return; }
        await admin.rpc('copy_run_set', { p_id: r.r_id, p: { sell_signature: s.signature } });
        const res = await settle(s.signature, r.r_wallet, t.mint);
        if (!res.ok) { await back('Revente refusée : ' + res.reason); return; }
        sold++;
        const got = res.received ?? 0, pnl = r.r_sol != null ? got - Number(r.r_sol) : null;
        await admin.rpc('copy_run_set', { p_id: r.r_id, p: { sold_sol: got, reason: 'Revendu avec le wallet copié' } });
        await admin.from('audit_log').insert({ user_id: r.r_user, event: 'server_copy_sell', detail: { signature: s.signature, mint: t.mint, sol: got, trader: t.wallet } });
        await push(r.r_user, 'Revente copiée · $' + sym, nf(got) + ' SOL récupérés' + (pnl != null ? ' (' + (pnl >= 0 ? '+' : '') + nf(pnl) + ' SOL)' : '') + ' : ' + shortA(t.wallet) + ' a vendu.',
          '/app?page=trade&mint=' + t.mint, 'copy-' + t.mint);
      } catch (e) { await back('Revente impossible : ' + (e as Error).message); }
    }));
  }

  return {
    load,
    traders: () => rules.keys(),
    size: () => rules.size,
    onTrade(t: WalletTrade, at: number) {
      const L = rules.get(t.wallet);
      if (t.side === 'buy') { if (L?.length) for (const c of L) track(buyOne(c, t, at).catch(() => {})); }
      else if (L?.length) track(sellAll(t).catch(() => {}));
    },
    idle: () => Promise.allSettled([...pending]),
    stats: () => ({ rules: [...rules.values()].reduce((a, L) => a + L.length, 0), bought, skipped, failed, sold }),
  };
}
