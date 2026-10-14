import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { BuyFields, useBuySettings } from './BuySettings';
import { PRESETS, condText, sellText, type Rule } from './strategies';
import { Num, RulesEditor, rulesInvalid } from './StrategyDialog';
import { copyFilterTexts, removeCopy, saveCopy, useCopies, type Copy, type CopyFilters } from './copies';
import '../styles/strategy.css';

export type CopyOpen = { trader: string; name: string };
export const openCopy = (d: CopyOpen) => window.dispatchEvent(new CustomEvent('ts-copy', { detail: d }));

const BUY_SLIPS = [15, 25, 35, 50];
const SELL_SLIPS = [10, 15, 25, 35];

/** Fenêtre « Copier ses achats » d'un acheteur suivi : montant, wallet, filtres, revente, sortie attachée */
export function CopyDialog() {
  const [o, setO] = useState<CopyOpen | null>(null);
  useEffect(() => {
    const f = (e: Event) => setO((e as CustomEvent<CopyOpen>).detail);
    window.addEventListener('ts-copy', f); return () => window.removeEventListener('ts-copy', f);
  }, []);
  const list = useCopies();
  if (!o || !list) return null;
  const ex = list.find((c) => c.trader === o.trader) ?? null;
  return <Editor key={o.trader + (ex?.id ?? '')} o={o} ex={ex} onClose={() => setO(null)} />;
}

function Editor({ o, ex, onClose }: { o: CopyOpen; ex: Copy | null; onClose: () => void }) {
  const b = useBuySettings(ex ? { wallet: ex.wallet, amount: ex.amount_sol, priority: ex.priority, slippage: Number(ex.slippage) } : {}, 25);
  const { wallets, wallet, amount, priority, slip } = b;
  const [perDay, setPerDay] = useState(ex?.max_per_day ?? 5);
  const F0 = ex?.filters ?? {};
  const [minOn, setMinOn] = useState(ex ? F0.min_sol != null : true);
  const [minSol, setMinSol] = useState(F0.min_sol ?? 0.2);
  const [maxOn, setMaxOn] = useState(F0.max_sol != null);
  const [maxSol, setMaxSol] = useState(F0.max_sol ?? 5);
  const [mcOn, setMcOn] = useState(ex ? F0.mcap_max != null : true);
  const [mc, setMc] = useState(F0.mcap_max ?? 150);
  const [sells, setSells] = useState(ex?.copy_sells ?? true);
  const [exitOn, setExitOn] = useState(ex ? !!ex.exit_rules : true);
  const [preset, setPreset] = useState<string | null>(ex?.exit_rules ? null : 'flash');
  const [rules, setRulesState] = useState<Rule[]>(() => ex?.exit_rules ?? PRESETS[0]!.rules());
  const setRules = (f: (L: Rule[]) => Rule[]) => setRulesState(f);
  const [exitSlip, setExitSlip] = useState(ex ? Number(ex.exit_slippage) : 25);
  const [consent, setConsent] = useState(!!ex);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const filters: CopyFilters = useMemo(() => ({ ...(minOn ? { min_sol: minSol } : {}), ...(maxOn ? { max_sol: maxSol } : {}), ...(mcOn ? { mcap_max: mc } : {}) }), [minOn, minSol, maxOn, maxSol, mcOn, mc]);
  const badRange = minOn && maxOn && maxSol < minSol;
  const invalid = !b.valid || badRange || (exitOn && rulesInvalid(rules)) || !(perDay >= 1 && perDay <= 50);
  const canSave = !busy && !invalid && consent;

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!canSave || !wallet) return;
    setBusy(true); setErr(null);
    try {
      await saveCopy({ trader: o.trader, wallet, enabled: true, amount_sol: amount, slippage: slip, priority, max_per_day: perDay, filters, copy_sells: sells, exit_rules: exitOn ? rules : null, exit_slippage: exitSlip }, ex?.id);
      toast(ex ? 'Copie mise à jour' : 'Copie activée', o.name + ' · ' + amount.toLocaleString('fr-FR') + ' SOL à chacun de ses achats.', 'g');
      onClose();
    } catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!ex) return;
    setBusy(true);
    try { await removeCopy(ex.id); toast('Copie supprimée', o.name); onClose(); } catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }

  const ft = copyFilterTexts(filters);
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label={'Copier les achats · ' + o.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="ts-modal-box sg sn" onSubmit={submit}>
        <button type="button" className="ts-x" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="ts-si-h"><b>Copier les achats · {o.name}</b>
          <span>Dès qu'un achat de ce wallet est confirmé sur la blockchain, le serveur achète le même token avec votre wallet rapide, en général moins de 2 secondes après lui, même outil fermé. Un seul achat par token. Tokens encore sur la courbe pump.fun uniquement.</span></div>

        {!wallets.length ? <div className="ts-note bad">Il faut un wallet rapide pour copier un wallet : créez-en un dans Portefeuille.</div> : (<>
          <section className="sn-sec">
            <span className="sg-lbl">Achat</span>
            <BuyFields b={b} slips={BUY_SLIPS} slipNote="Vous achetez juste après lui, le prix a déjà un peu monté :" middle={
              <div className="sg-field"><span className="sn-k">Achats par jour</span>
                <span className="sn-inline">au plus <Num v={perDay} unit="par jour" label="Achats copiés par jour au plus" onChange={(v) => setPerDay(Math.round(v))} /></span></div>} />
          </section>

          <section className="sn-sec">
            <span className="sg-lbl">Filtres <em className="dim">facultatifs</em></span>
            <label className="sg-check sn-f"><input type="checkbox" checked={minOn} onChange={(e) => setMinOn(e.target.checked)} />
              <span>Il engage au moins <Num v={minSol} unit="SOL" label="Montant minimum de son achat" onChange={setMinSol} /> (ignore ses petits essais)</span></label>
            <label className="sg-check sn-f"><input type="checkbox" checked={maxOn} onChange={(e) => setMaxOn(e.target.checked)} />
              <span>Il engage au plus <Num v={maxSol} unit="SOL" label="Montant maximum de son achat" onChange={setMaxSol} /></span></label>
            <label className="sg-check sn-f"><input type="checkbox" checked={mcOn} onChange={(e) => setMcOn(e.target.checked)} />
              <span>Capitalisation au plus <Num v={mc} unit="SOL" label="Capitalisation maximum" onChange={setMc} /> au prix de son achat</span></label>
            {badRange && <p className="sg-bad">Le maximum doit être supérieur au minimum.</p>}
          </section>

          <section className="sn-sec">
            <label className="sg-check sn-exit"><input type="checkbox" checked={sells} onChange={(e) => setSells(e.target.checked)} />
              <span><b>Revendre quand il revend</b> : à sa première vente du token, toute la position copiée est revendue</span></label>
            <label className="sg-check sn-exit"><input type="checkbox" checked={exitOn} onChange={(e) => setExitOn(e.target.checked)} />
              <span><b>Stratégie de sortie</b>, activée dès que l'achat est confirmé{sells ? ' (s\'arrête s\'il revend avant)' : ''}</span></label>
            {exitOn ? (<>
              <RulesEditor rules={rules} setRules={setRules} preset={preset} setPreset={setPreset} />
              <div className="sg-field"><span className="sn-k">Glissement maximum à la vente</span>
                <div className="sg-sell" role="group" aria-label="Glissement à la vente">{SELL_SLIPS.map((v) => <button key={v} type="button" className={exitSlip === v ? 'on' : ''} aria-pressed={exitSlip === v} onClick={() => setExitSlip(v)}>{v} %</button>)}</div></div>
            </>) : !sells && <p className="sg-bad">Sans revente ni stratégie, rien ne vend : vous devrez surveiller chaque position vous-même.</p>}
          </section>

          <div className="sg-sum" aria-live="polite"><span className="sg-lbl">En clair</span>
            <ul>
              <li>À chaque achat de {o.name}, acheter <b>{amount.toLocaleString('fr-FR')} SOL</b> du même token, {perDay} fois par jour au plus</li>
              {ft.length ? <li>seulement si {ft.join(', ')}</li> : <li>sans filtre</li>}
              {sells && <li>dès qu'il revend ce token → <b>tout revendre</b></li>}
              {exitOn && rules.map((r) => <li key={r.id}>{sells ? 'sinon ' : 'puis '}{r.all.map(condText).join(' et ')} → <b>{sellText(r.sell)}</b></li>)}
            </ul></div>

          {!ex && <label className="sg-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>J'autorise le serveur à acheter et vendre avec ce wallet <b>sans me demander de confirmation</b>, selon ces règles, dans la limite de son plafond journalier. Je sais qu'un wallet copié peut perdre.</span></label>}
          {err && <div className="ts-note bad" role="alert">{err}</div>}
          <div className="ts-row sg-act">
            {ex && <button type="button" className="btn ghost danger sn-del" disabled={busy} onClick={remove}>Supprimer</button>}
            <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
            <button className="btn primary" disabled={!canSave}>{busy ? 'Enregistrement…' : ex ? 'Enregistrer' : 'Activer la copie'}</button></div>
        </>)}
      </form>
    </div>
  );
}
