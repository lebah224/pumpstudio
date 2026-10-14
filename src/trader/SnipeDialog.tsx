import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { BuyFields, useBuySettings } from './BuySettings';
import { PRESETS, condText, sellText, type Rule } from './strategies';
import { Num, RulesEditor, rulesInvalid } from './StrategyDialog';
import { filterTexts, removeSnipe, saveSnipe, useSnipes, type Snipe, type SnipeFilters } from './snipes';
import '../styles/strategy.css';

export type SnipeOpen = { creator: string; name: string };
export const openSnipe = (d: SnipeOpen) => window.dispatchEvent(new CustomEvent('ts-snipe', { detail: d }));

const BUY_SLIPS = [15, 25, 35, 50];
const SELL_SLIPS = [10, 15, 25, 35];

/** Fenêtre « Achat automatique » d'un créateur suivi : montant, wallet, filtres, sortie attachée */
export function SnipeDialog() {
  const [o, setO] = useState<SnipeOpen | null>(null);
  useEffect(() => {
    const f = (e: Event) => setO((e as CustomEvent<SnipeOpen>).detail);
    window.addEventListener('ts-snipe', f); return () => window.removeEventListener('ts-snipe', f);
  }, []);
  const list = useSnipes();
  if (!o || !list) return null;
  const ex = list.find((s) => s.creator === o.creator) ?? null;
  return <Editor key={o.creator + (ex?.id ?? '')} o={o} ex={ex} onClose={() => setO(null)} />;
}

function Editor({ o, ex, onClose }: { o: SnipeOpen; ex: Snipe | null; onClose: () => void }) {
  const b = useBuySettings(ex ? { wallet: ex.wallet, amount: ex.amount_sol, priority: ex.priority, slippage: Number(ex.slippage) } : {}, 25);
  const { wallets, wallet, amount, priority, slip } = b;
  const [mode, setMode] = useState<'next' | 'every'>(ex?.mode ?? 'next');
  const [perDay, setPerDay] = useState(ex?.max_per_day ?? 3);
  const F0 = ex?.filters ?? {};
  const [devOn, setDevOn] = useState(F0.dev_min != null || F0.dev_max != null);
  const [devMin, setDevMin] = useState(F0.dev_min ?? 0.5);
  const [devMax, setDevMax] = useState(F0.dev_max ?? 3);
  const [pctOn, setPctOn] = useState(F0.dev_pct != null);
  const [pct, setPct] = useState(F0.dev_pct ?? 10);
  const [mcOn, setMcOn] = useState(F0.mcap_max != null);
  const [mc, setMc] = useState(F0.mcap_max ?? 40);
  const [gapOn, setGapOn] = useState(F0.gap_min != null);
  const [gap, setGap] = useState(F0.gap_min ?? 30);
  const [exitOn, setExitOn] = useState(ex ? !!ex.exit_rules : true);
  const [preset, setPreset] = useState<string | null>(ex?.exit_rules ? null : 'flash');
  const [rules, setRulesState] = useState<Rule[]>(() => ex?.exit_rules ?? PRESETS[0]!.rules());
  const setRules = (f: (L: Rule[]) => Rule[]) => setRulesState(f);
  const [exitSlip, setExitSlip] = useState(ex ? Number(ex.exit_slippage) : 25);
  const [consent, setConsent] = useState(!!ex);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const filters: SnipeFilters = useMemo(() => ({
    ...(devOn ? { dev_min: devMin, dev_max: devMax } : {}), ...(pctOn ? { dev_pct: pct } : {}), ...(mcOn ? { mcap_max: mc } : {}), ...(gapOn ? { gap_min: gap } : {}),
  }), [devOn, devMin, devMax, pctOn, pct, mcOn, mc, gapOn, gap]);
  const badDev = devOn && devMax < devMin;
  const invalid = !b.valid || badDev || (exitOn && rulesInvalid(rules)) || (mode === 'every' && !(perDay >= 1 && perDay <= 50));
  const canSave = !busy && !invalid && consent;

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!canSave || !wallet) return;
    setBusy(true); setErr(null);
    try {
      await saveSnipe({ creator: o.creator, wallet, enabled: true, mode, amount_sol: amount, slippage: slip, priority, max_per_day: mode === 'next' ? 1 : perDay, filters, exit_rules: exitOn ? rules : null, exit_slippage: exitSlip }, ex?.id);
      toast(ex ? 'Achat automatique mis à jour' : 'Achat automatique activé', o.name + ' · ' + amount.toLocaleString('fr-FR') + ' SOL ' + (mode === 'next' ? 'sur son prochain lancement.' : 'à chaque lancement.'), 'g');
      onClose();
    } catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!ex) return;
    setBusy(true);
    try { await removeSnipe(ex.id); toast('Achat automatique supprimé', o.name); onClose(); } catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }

  const ft = filterTexts(filters);
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label={'Achat automatique · ' + o.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="ts-modal-box sg sn" onSubmit={submit}>
        <button type="button" className="ts-x" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="ts-si-h"><b>Achat automatique · {o.name}</b>
          <span>Dès que ce créateur lance un token, le serveur achète avec votre wallet rapide, dans la seconde, même outil fermé. Les filtres sont lus dans l'avis de création : ils ne ralentissent pas l'achat.</span></div>

        {!wallets.length ? <div className="ts-note bad">Il faut un wallet rapide pour l'achat automatique : créez-en un dans Portefeuille.</div> : (<>
          <section className="sn-sec">
            <span className="sg-lbl">Achat</span>
            <BuyFields b={b} slips={BUY_SLIPS} slipNote="Au lancement le prix grimpe en quelques blocs :" middle={
              <div className="sg-field"><span className="sn-k">Quand</span>
                <div className="sg-sell" role="radiogroup" aria-label="Quand acheter">
                  <button type="button" role="radio" aria-checked={mode === 'next'} className={mode === 'next' ? 'on' : ''} onClick={() => setMode('next')}>Prochain lancement</button>
                  <button type="button" role="radio" aria-checked={mode === 'every'} className={mode === 'every' ? 'on' : ''} onClick={() => setMode('every')}>Chaque lancement</button></div>
                {mode === 'every' && <span className="sn-inline">au plus <Num v={perDay} unit="par jour" label="Achats par jour au plus" onChange={(v) => setPerDay(Math.round(v))} /></span>}</div>} />
          </section>

          <section className="sn-sec">
            <span className="sg-lbl">Filtres <em className="dim">facultatifs</em></span>
            <label className="sg-check sn-f"><input type="checkbox" checked={devOn} onChange={(e) => setDevOn(e.target.checked)} />
              <span>Le créateur achète lui-même entre <Num v={devMin} unit="SOL" label="Achat du créateur minimum" onChange={setDevMin} allowZero /> et <Num v={devMax} unit="SOL" label="Achat du créateur maximum" onChange={setDevMax} /></span></label>
            <label className="sg-check sn-f"><input type="checkbox" checked={pctOn} onChange={(e) => setPctOn(e.target.checked)} />
              <span>Le créateur détient au plus <Num v={pct} unit="%" label="Part maximum du créateur" onChange={setPct} /> des tokens</span></label>
            <label className="sg-check sn-f"><input type="checkbox" checked={mcOn} onChange={(e) => setMcOn(e.target.checked)} />
              <span>Capitalisation au plus <Num v={mc} unit="SOL" label="Capitalisation maximum" onChange={setMc} /> au moment de l'achat</span></label>
            <label className="sg-check sn-f"><input type="checkbox" checked={gapOn} onChange={(e) => setGapOn(e.target.checked)} />
              <span>Ignorer s'il a lancé un autre token il y a moins de <Num v={gap} unit="min" label="Délai minimum depuis son lancement précédent" onChange={(v) => setGap(Math.round(v))} /></span></label>
            {badDev && <p className="sg-bad">Le maximum doit être supérieur au minimum.</p>}
          </section>

          <section className="sn-sec">
            <label className="sg-check sn-exit"><input type="checkbox" checked={exitOn} onChange={(e) => setExitOn(e.target.checked)} />
              <span><b>Stratégie de sortie</b>, activée dès que l'achat est confirmé</span></label>
            {exitOn ? (<>
              <RulesEditor rules={rules} setRules={setRules} preset={preset} setPreset={setPreset} />
              <div className="sg-field"><span className="sn-k">Glissement maximum à la vente</span>
                <div className="sg-sell" role="group" aria-label="Glissement à la vente">{SELL_SLIPS.map((v) => <button key={v} type="button" className={exitSlip === v ? 'on' : ''} aria-pressed={exitSlip === v} onClick={() => setExitSlip(v)}>{v} %</button>)}</div></div>
            </>) : <p className="sg-bad">Sans stratégie, rien ne vend : vous devrez surveiller la position vous-même.</p>}
          </section>

          <div className="sg-sum" aria-live="polite"><span className="sg-lbl">En clair</span>
            <ul>
              <li>Au <b>{mode === 'next' ? 'prochain lancement' : 'lancement'}</b> de {o.name}, acheter <b>{amount.toLocaleString('fr-FR')} SOL</b>{mode === 'every' ? <>, {perDay} fois par jour au plus</> : <>, une seule fois</>}</li>
              {ft.length ? <li>seulement si {ft.join(', ')}</li> : <li>sans filtre</li>}
              {exitOn && rules.map((r) => <li key={r.id}>puis {r.all.map(condText).join(' et ')} → <b>{sellText(r.sell)}</b></li>)}
            </ul></div>

          {!ex && <label className="sg-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>J'autorise le serveur à acheter avec ce wallet <b>sans me demander de confirmation</b>, selon ces règles, dans la limite de son plafond journalier.</span></label>}
          {err && <div className="ts-note bad" role="alert">{err}</div>}
          <div className="ts-row sg-act">
            {ex && <button type="button" className="btn ghost danger sn-del" disabled={busy} onClick={remove}>Supprimer</button>}
            <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
            <button className="btn primary" disabled={!canSave}>{busy ? 'Enregistrement…' : ex ? 'Enregistrer' : 'Activer l\'achat automatique'}</button></div>
        </>)}
      </form>
    </div>
  );
}
