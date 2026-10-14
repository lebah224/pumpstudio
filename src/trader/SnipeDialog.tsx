import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { studio, toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { srvLabel, useServerWallet } from '../serverWallet/api';
import { Sol } from '../ui/Sol';
import { PRESETS, condText, sellText, type Rule } from './strategies';
import { Num, RulesEditor, rulesInvalid } from './StrategyDialog';
import { SPEEDS, filterTexts, removeSnipe, saveSnipe, useSnipes, type Snipe, type SnipeFilters } from './snipes';
import '../styles/strategy.css';

export type SnipeOpen = { creator: string; name: string };
export const openSnipe = (d: SnipeOpen) => window.dispatchEvent(new CustomEvent('ts-snipe', { detail: d }));

const AMOUNTS = [0.05, 0.1, 0.25, 0.5];
const BUY_SLIPS = [15, 25, 35, 50];
const SELL_SLIPS = [10, 15, 25, 35];
type Hub = { rpc: <T>(m: string, p: unknown[]) => Promise<T> };

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
  const srv = useServerWallet();
  const wallets = srv?.wallets ?? [];
  const [wallet, setWallet] = useState<string | null>(ex?.wallet ?? srv?.address ?? wallets[0]?.address ?? null);
  const [amount, setAmount] = useState(ex?.amount_sol ?? 0.1);
  const [mode, setMode] = useState<'next' | 'every'>(ex?.mode ?? 'next');
  const [perDay, setPerDay] = useState(ex?.max_per_day ?? 3);
  const [priority, setPriority] = useState(ex?.priority ?? 0.003);
  const [slip, setSlip] = useState(ex ? Number(ex.slippage) : 25);
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
  const [bal, setBal] = useState<number | null>(null);

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => {
    setBal(null);
    const hub = studio()?.hub as unknown as Hub | undefined;
    if (!wallet || !hub) return;
    let alive = true;
    hub.rpc<{ value: number }>('getBalance', [wallet, { commitment: 'confirmed' }]).then((r) => { if (alive) setBal(r.value / 1e9); }).catch(() => {});
    return () => { alive = false; };
  }, [wallet]);

  const filters: SnipeFilters = useMemo(() => ({
    ...(devOn ? { dev_min: devMin, dev_max: devMax } : {}), ...(pctOn ? { dev_pct: pct } : {}), ...(mcOn ? { mcap_max: mc } : {}), ...(gapOn ? { gap_min: gap } : {}),
  }), [devOn, devMin, devMax, pctOn, pct, mcOn, mc, gapOn, gap]);
  const maxCost = amount * (1 + slip / 100);
  const low = bal != null && bal < maxCost + priority + 0.005;
  const badDev = devOn && devMax < devMin;
  const invalid = !wallet || !(amount >= 0.001 && amount <= 10) || badDev || (exitOn && rulesInvalid(rules)) || (mode === 'every' && !(perDay >= 1 && perDay <= 50));
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
            <div className="sn-grid">
              <label className="sg-field"><span className="sn-k">Wallet qui achète</span>
                <select value={wallet ?? ''} onChange={(e) => setWallet(e.target.value)}>{wallets.map((w) => <option key={w.address} value={w.address}>{srvLabel(w)}</option>)}</select>
                <small className={low ? 'sg-bad' : 'dim'}>{bal == null ? 'Solde…' : <>Solde <Sol v={bal} d={3} />{low ? ' : insuffisant pour cet achat' : ''}</>}</small></label>
              <div className="sg-field"><span className="sn-k">Montant</span>
                <div className="sn-amt"><Num v={amount} unit="SOL" label="Montant de l'achat" onChange={setAmount} />
                  <div className="sg-sell" role="group" aria-label="Montants rapides">{AMOUNTS.map((a) => <button key={a} type="button" className={amount === a ? 'on' : ''} aria-pressed={amount === a} onClick={() => setAmount(a)}>{a.toLocaleString('fr-FR')}</button>)}</div></div></div>
            </div>
            <div className="sn-grid">
              <div className="sg-field"><span className="sn-k">Quand</span>
                <div className="sg-sell" role="radiogroup" aria-label="Quand acheter">
                  <button type="button" role="radio" aria-checked={mode === 'next'} className={mode === 'next' ? 'on' : ''} onClick={() => setMode('next')}>Prochain lancement</button>
                  <button type="button" role="radio" aria-checked={mode === 'every'} className={mode === 'every' ? 'on' : ''} onClick={() => setMode('every')}>Chaque lancement</button></div>
                {mode === 'every' && <span className="sn-inline">au plus <Num v={perDay} unit="par jour" label="Achats par jour au plus" onChange={(v) => setPerDay(Math.round(v))} /></span>}</div>
              <div className="sg-field"><span className="sn-k">Vitesse</span>
                <div className="sg-sell" role="group" aria-label="Vitesse">{SPEEDS.map((s) => <button key={s.v} type="button" className={priority === s.v ? 'on' : ''} aria-pressed={priority === s.v} onClick={() => setPriority(s.v)}>{s.l}</button>)}</div>
                <small className="dim">Frais de priorité : <Sol v={priority} d={3} /></small></div>
            </div>
            <div className="sg-field"><span className="sn-k">Glissement maximum à l'achat</span>
              <div className="sg-sell" role="group" aria-label="Glissement à l'achat">{BUY_SLIPS.map((v) => <button key={v} type="button" className={slip === v ? 'on' : ''} aria-pressed={slip === v} onClick={() => setSlip(v)}>{v} %</button>)}</div>
              <small className="dim">Au lancement le prix grimpe en quelques blocs : vous payez au plus <Sol v={maxCost} d={3} />.</small></div>
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
