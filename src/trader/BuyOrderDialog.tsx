import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { PRESETS, condText, sellText, type Rule } from './strategies';
import { Num, RulesEditor, rulesInvalid } from './StrategyDialog';
import { BuyFields, useBuySettings } from './BuySettings';
import {
  BUY_CONDS, BUY_ORDER, EXPIRIES, WINDOWS, buyCondText, removeBuyOrder, saveBuyOrder, setBuyOrderStatus, useBuyOrders,
  type BuyCond, type BuyCondKind, type BuyOrder,
} from './buyOrders';
import '../styles/strategy.css';

export type BuyOrderOpen = { mint: string; symbol: string; creator: string | null; mcapUsd: number | null; existing?: BuyOrder | null };
export const openBuyOrder = (d: BuyOrderOpen) => window.dispatchEvent(new CustomEvent('ts-buyorder', { detail: d }));

const SLIPS = [5, 10, 15, 25];
const SELL_SLIPS = [10, 15, 25, 35];
const usd = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' $';
const round = (v: number) => { const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1)); return Math.round(v / p) * p; };
const winTxt = (s: number) => (s >= 60 ? s / 60 + ' min' : s + ' s');

/** Fenêtre « Achat programmé » d'un token : conditions combinables, achat, validité, sortie attachée */
export function BuyOrderDialog() {
  const [o, setO] = useState<BuyOrderOpen | null>(null);
  useEffect(() => {
    const f = (e: Event) => setO((e as CustomEvent<BuyOrderOpen>).detail);
    window.addEventListener('ts-buyorder', f); return () => window.removeEventListener('ts-buyorder', f);
  }, []);
  if (!o) return null;
  return <Editor key={o.mint + (o.existing?.id ?? '')} o={o} onClose={() => setO(null)} />;
}

function Editor({ o, onClose }: { o: BuyOrderOpen; onClose: () => void }) {
  const ex = o.existing ?? null;
  const b = useBuySettings(ex ? { wallet: ex.wallet, amount: ex.amount_sol, priority: ex.priority, slippage: Number(ex.slippage) } : {}, 15);
  const defCond = (k: BuyCondKind): BuyCond => {
    const m = o.mcapUsd;
    const v = k === 'mcap_below' && m ? round(m * 0.7) : k === 'mcap_above' && m ? round(m * 1.5) : BUY_CONDS[k].def;
    return { k, v, ...(BUY_CONDS[k].win ? { w: BUY_CONDS[k].win } : {}) };
  };
  const [conds, setConds] = useState<BuyCond[]>(() => ex?.conds ?? [defCond('mcap_below')]);
  const [guard, setGuard] = useState(ex?.cancel_on_creator_sell ?? true);
  const [hours, setHours] = useState(() => (ex ? 0 : 24));   // 0 : garder l'échéance actuelle
  const [exitOn, setExitOn] = useState(ex ? !!ex.exit_rules : true);
  const [preset, setPreset] = useState<string | null>(ex?.exit_rules ? null : 'tiers');
  const [rules, setRulesState] = useState<Rule[]>(() => ex?.exit_rules ?? PRESETS[1]!.rules());
  const [exitSlip, setExitSlip] = useState(ex ? Number(ex.exit_slippage) : 25);
  const [consent, setConsent] = useState(!!ex);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const setCond = (i: number, c: BuyCond) => setConds((L) => L.map((x, j) => (j === i ? c : x)));
  const both = conds.some((c) => c.k === 'mcap_below') && conds.some((c) => c.k === 'mcap_above') &&
    (conds.find((c) => c.k === 'mcap_below')!.v < conds.find((c) => c.k === 'mcap_above')!.v);
  const badCond = conds.some((c) => !(c.v > 0)) || both;
  const invalid = !b.valid || !conds.length || badCond || (exitOn && rulesInvalid(rules));
  const canSave = !busy && !invalid && consent;
  const expires = hours ? new Date(Date.now() + hours * 3600_000).toISOString() : ex!.expires_at;

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!canSave || !b.wallet) return;
    setBusy(true); setErr(null);
    try {
      await saveBuyOrder({ mint: o.mint, symbol: o.symbol, creator: o.creator, wallet: b.wallet, amount_sol: b.amount, slippage: b.slip, priority: b.priority,
        conds, cancel_on_creator_sell: guard, expires_at: expires, exit_rules: exitOn ? rules : null, exit_slippage: exitSlip }, ex?.id);
      toast(ex ? 'Achat programmé mis à jour' : 'Achat programmé', o.symbol + ' · ' + b.amount.toLocaleString('fr-FR') + ' SOL dès que ' + conds.map(buyCondText).join(' et ') + '.', 'g');
      onClose();
    } catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }
  const validity = (
    <div className="sg-field"><span className="sn-k">Valable</span>
      <div className="sg-sell" role="group" aria-label="Durée de validité">
        {ex && <button type="button" className={hours === 0 ? 'on' : ''} aria-pressed={hours === 0} onClick={() => setHours(0)}>Inchangé</button>}
        {EXPIRIES.map((x) => <button key={x.h} type="button" className={hours === x.h ? 'on' : ''} aria-pressed={hours === x.h} onClick={() => setHours(x.h)}>{x.l}</button>)}</div>
      <small className="dim">Jusqu'au {new Date(expires).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
  );

  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label={'Achat programmé · ' + o.symbol} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="ts-modal-box sg sn" onSubmit={submit}>
        <button type="button" className="ts-x" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="ts-si-h"><b>Achat programmé · {o.symbol}</b>
          <span>Le serveur vérifie vos conditions à chaque transaction du token et achète aussitôt avec votre wallet rapide, même outil fermé.{o.mcapUsd ? <> Capitalisation actuelle : <b>{usd(o.mcapUsd)}</b>.</> : null}</span></div>

        {!b.wallets.length ? <div className="ts-note bad">Il faut un wallet rapide pour programmer un achat : créez-en un dans Portefeuille.</div> : (<>
          <section className="sn-sec">
            <span className="sg-lbl">Conditions <em className="dim">toutes doivent être remplies</em></span>
            {conds.map((c, i) => (
              <div key={i} className="sg-cond bo-cond">
                <span className="sg-kw">{i === 0 ? 'Si' : 'et'}</span>
                <select value={c.k} aria-label="Condition" onChange={(e) => setCond(i, defCond(e.target.value as BuyCondKind))}>
                  {BUY_ORDER.map((k) => <option key={k} value={k}>{BUY_CONDS[k].l}</option>)}
                </select>
                <Num v={c.v} unit={BUY_CONDS[c.k].unit} label={BUY_CONDS[c.k].l} onChange={(v) => setCond(i, { ...c, v })} />
                {BUY_CONDS[c.k].win && (
                  <span className="sg-arm">en <select className="bo-win" value={c.w ?? 60} aria-label="Période" onChange={(e) => setCond(i, { ...c, w: Number(e.target.value) })}>
                    {WINDOWS.map((w) => <option key={w} value={w}>{winTxt(w)}</option>)}</select></span>
                )}
                {conds.length > 1 && <button type="button" className="sg-x" aria-label="Retirer cette condition" onClick={() => setConds((L) => L.filter((_, j) => j !== i))}>×</button>}
              </div>
            ))}
            {conds.length < 4 && <button type="button" className="sg-and" onClick={() => setConds((L) => [...L, defCond(L.some((x) => x.k === 'buys') ? 'buy_sol' : 'buys')])}>+ et une autre condition</button>}
            <p className="sg-hint bo-hint">{BUY_CONDS[conds[conds.length - 1]?.k ?? 'mcap_below'].hint}</p>
            {both && <p className="sg-bad">« Descend sous » doit être supérieur à « dépasse », sinon l'ordre ne peut jamais se déclencher.</p>}
            <label className="sg-check"><input type="checkbox" checked={guard} onChange={(e) => setGuard(e.target.checked)} />
              <span>Annuler l'ordre si le <b>créateur vend</b> avant le déclenchement</span></label>
          </section>

          <section className="sn-sec">
            <span className="sg-lbl">Achat</span>
            <BuyFields b={b} slips={SLIPS} slipNote="Si le prix bouge pendant l'envoi," middle={validity} />
          </section>

          <section className="sn-sec">
            <label className="sg-check sn-exit"><input type="checkbox" checked={exitOn} onChange={(e) => setExitOn(e.target.checked)} />
              <span><b>Stratégie de sortie</b>, activée dès que l'achat est confirmé</span></label>
            {exitOn ? (<>
              <RulesEditor rules={rules} setRules={(f) => setRulesState(f)} preset={preset} setPreset={setPreset} />
              <div className="sg-field"><span className="sn-k">Glissement maximum à la vente</span>
                <div className="sg-sell" role="group" aria-label="Glissement à la vente">{SELL_SLIPS.map((v) => <button key={v} type="button" className={exitSlip === v ? 'on' : ''} aria-pressed={exitSlip === v} onClick={() => setExitSlip(v)}>{v} %</button>)}</div></div>
            </>) : <p className="dim tr-small">Sans stratégie, rien ne vend : vous gérez la position vous-même. Si une stratégie est déjà active sur ce token, elle est conservée.</p>}
          </section>

          <div className="sg-sum" aria-live="polite"><span className="sg-lbl">En clair</span>
            <ul>
              <li>Si {conds.map(buyCondText).join(' et ')} → <b>acheter {b.amount.toLocaleString('fr-FR')} SOL</b> de {o.symbol}, une seule fois</li>
              <li>valable {hours ? EXPIRIES.find((x) => x.h === hours)?.l : 'jusqu\'à l\'échéance actuelle'}{guard ? ', annulé si le créateur vend' : ''}</li>
              {exitOn && rules.map((r) => <li key={r.id}>puis {r.all.map(condText).join(' et ')} → <b>{sellText(r.sell)}</b></li>)}
            </ul></div>

          {!ex && <label className="sg-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>J'autorise le serveur à acheter avec ce wallet <b>sans me demander de confirmation</b> quand ces conditions sont remplies, dans la limite de son plafond journalier.</span></label>}
          {err && <div className="ts-note bad" role="alert">{err}</div>}
          <div className="ts-row sg-act">
            <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
            <button className="btn primary" disabled={!canSave}>{busy ? 'Enregistrement…' : ex ? 'Enregistrer' : 'Programmer l\'achat'}</button></div>
        </>)}
      </form>
    </div>
  );
}

/* ---------- état d'un ordre ---------- */
export const BO_STATUS: Record<BuyOrder['status'], { l: string; c: string }> = {
  active: { l: 'En attente', c: 'ok' }, paused: { l: 'En pause', c: 'wait' }, firing: { l: 'Achat…', c: 'wait' }, done: { l: 'Acheté', c: 'ok' },
  failed: { l: 'Échoué', c: 'bad' }, expired: { l: 'Expiré', c: 'off' }, cancelled: { l: 'Annulé', c: 'off' },
};
const left = (iso: string) => { const m = Math.max(0, (Date.parse(iso) - Date.now()) / 60000); return m < 60 ? Math.round(m) + ' min' : m < 2880 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' j'; };
export function boDetail(x: BuyOrder) {
  if (x.status === 'done') return 'Acheté' + (x.state.sol ? ' ' + x.state.sol.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' SOL' : '') + (x.state.send_ms ? ', parti en ' + (x.state.send_ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' s' : '');
  if (x.state.reason) return x.state.reason;
  if (x.status === 'active' || x.status === 'paused') return 'reste ' + left(x.expires_at);
  return '';
}
function useOrderActions(symbol: string) {
  const [busy, setBusy] = useState(false);
  const act = async (f: () => Promise<void>, ok: string) => { setBusy(true); try { await f(); toast(ok, symbol); } catch (e) { toast('Action impossible', readable(e), 'r'); } finally { setBusy(false); } };
  return { busy, act };
}

/** Panneau de trading : bouton « Programmer un achat » et ordres de ce token */
export function BuyOrdersCard({ mint, symbol, creator, mcapUsd }: { mint: string; symbol: string; creator: string | null; mcapUsd: number | null }) {
  const list = useBuyOrders();
  const { busy, act } = useOrderActions(symbol);
  const mine = (list ?? []).filter((x) => x.mint === mint && (['active', 'paused', 'firing'].includes(x.status) || Date.now() - Date.parse(x.created_at) < 6 * 3600_000));
  return (
    <div className="bo-card">
      <div className="bo-card-h"><span><b>Achat programmé</b><small>Sur repli, sur cassure ou à la confirmation des acheteurs, même outil fermé.</small></span>
        <button type="button" className="btn sm" onClick={() => openBuyOrder({ mint, symbol, creator, mcapUsd })}>Programmer</button></div>
      {!!mine.length && <ul className="bo-items">{mine.map((x) => { const st = BO_STATUS[x.status], open = x.status === 'active' || x.status === 'paused'; return (
        <li key={x.id}>
          <div className="bo-l"><span className={'ts-hub-pill ' + st.c}>{st.l}</span><b className="mono">{x.amount_sol.toLocaleString('fr-FR')} SOL</b>
            <span className="bo-c">si {x.conds.map(buyCondText).join(' et ')}</span><small className="dim">{boDetail(x)}</small></div>
          <div className="bo-a">
            {open && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => openBuyOrder({ mint, symbol, creator, mcapUsd, existing: x })}>Modifier</button>}
            {x.status === 'active' && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => act(() => setBuyOrderStatus(x.id, 'paused'), 'Achat programmé en pause')}>Pause</button>}
            {x.status === 'paused' && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => act(() => setBuyOrderStatus(x.id, 'active'), 'Achat programmé repris')}>Reprendre</button>}
            {open ? <button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => act(() => setBuyOrderStatus(x.id, 'cancelled'), 'Achat programmé annulé')}>Annuler</button>
              : x.status !== 'firing' && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => act(() => removeBuyOrder(x.id), 'Retiré de la liste')}>Effacer</button>}
          </div>
        </li>
      ); })}</ul>}
    </div>
  );
}

/** Page Trader : tous les achats programmés du compte */
export function BuyOrderList({ onOpen }: { onOpen: (mint: string) => void }) {
  const list = useBuyOrders();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('ts-bo-open') !== '0'; } catch { return true; } });
  const waiting = (list ?? []).filter((x) => ['active', 'paused', 'firing'].includes(x.status));
  const recent = (list ?? []).filter((x) => !['active', 'paused', 'firing'].includes(x.status) && Date.now() - Date.parse(x.created_at) < 3 * 86400_000).slice(0, 8);
  if (!list || (!waiting.length && !recent.length)) return null;
  const toggle = () => setOpen((v) => { try { localStorage.setItem('ts-bo-open', v ? '0' : '1'); } catch { /* navigation privée */ } return !v; });
  return (
    <section className="card sg-list">
      <button type="button" className="sg-list-h" aria-expanded={open} onClick={toggle}>
        <b>Mes achats programmés</b><span className="dim">{waiting.length} en attente{recent.length ? ' · ' + recent.length + ' terminé' + (recent.length > 1 ? 's' : '') + ' récemment' : ''}</span>
        <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
      </button>
      {open && (
        <div className="tr-table-wrap">
          <table className="tr-table sg-table">
            <thead><tr><th>Token</th><th>État</th><th className="num">Montant</th><th>Conditions</th><th className="hide-s">Détail</th></tr></thead>
            <tbody>
              {[...waiting, ...recent].map((x) => { const st = BO_STATUS[x.status]; return (
                <tr key={x.id} tabIndex={0} onClick={() => onOpen(x.mint)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(x.mint); }}>
                  <td><b>{x.symbol || x.mint.slice(0, 4)}</b></td>
                  <td><span className={'ts-hub-pill ' + st.c}>{st.l}</span></td>
                  <td className="num mono">{x.amount_sol.toLocaleString('fr-FR')} SOL</td>
                  <td className="bo-td">{x.conds.map(buyCondText).join(' et ')}</td>
                  <td className="hide-s dim">{boDetail(x)}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
