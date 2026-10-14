import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { fPrice, fTok } from './format';
import {
  COND_ORDER, CONDS, PRESETS, condText, lastBuy, mkRule, quickHolders, ruleText, saveStrategy, sellText,
  type Cond, type CondKind, type Rule, type Strategy,
} from './strategies';
import '../styles/strategy.css';

export type StrategyOpen = { mint: string; symbol: string; creator: string | null; priceSol: number | null; avg: number | null; existing?: Strategy | null };
export const openStrategy = (d: StrategyOpen) => window.dispatchEvent(new CustomEvent('ts-strategy', { detail: d }));

const SELLS = [25, 50, 75, 100];
const SLIPS = [10, 15, 25, 35];
const parse = (s: string) => { const v = parseFloat(String(s).replace(',', '.').replace(/\s/g, '')); return isFinite(v) ? v : NaN; };
const hm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Fenêtre « Stratégie de sortie » : modèles, règles combinables, position et réglages d'exécution */
export function StrategyDialog() {
  const [o, setO] = useState<StrategyOpen | null>(null);
  useEffect(() => {
    const f = (e: Event) => setO((e as CustomEvent<StrategyOpen>).detail);
    window.addEventListener('ts-strategy', f); return () => window.removeEventListener('ts-strategy', f);
  }, []);
  if (!o) return null;
  return <Editor key={o.mint + (o.existing?.id ?? '')} o={o} onClose={() => setO(null)} />;
}

function Editor({ o, onClose }: { o: StrategyOpen; onClose: () => void }) {
  const ex = o.existing ?? null, fired = new Set(ex?.state.fired ?? []);
  const [preset, setPreset] = useState<string | null>(ex ? null : 'flash');
  const [rules, setRules] = useState<Rule[]>(() => ex ? ex.rules : PRESETS[0]!.rules());
  const [slip, setSlip] = useState(ex ? Number(ex.slippage) : 25);
  const [holders, setHolders] = useState<{ address: string; name: string; tokens: number }[] | null>(ex ? [] : null);
  const [wallet, setWallet] = useState<string | null>(ex?.wallet ?? null);
  const [fromNow, setFromNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const buy = useMemo(() => lastBuy(o.mint), [o.mint]);

  useEffect(() => {
    if (ex) return;
    let alive = true;
    quickHolders(o.mint).then((L) => { if (!alive) return; setHolders(L); setWallet((w) => w ?? L[0]?.address ?? null); }).catch(() => alive && setHolders([]));
    return () => { alive = false; };
  }, [o.mint, ex]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const holder = holders?.find((h) => h.address === wallet) ?? null;
  const entryPrice = ex?.entry_price ?? o.avg ?? o.priceSol;
  const invalid = rulesInvalid(rules);
  const canSave = !busy && !invalid && rules.length > 0 && (ex || !!holder);

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!canSave) return;
    setBusy(true); setErr(null);
    try {
      const at = ex ? (fromNow ? new Date().toISOString() : ex.entry_at) : new Date(fromNow || !buy ? Date.now() : buy.t).toISOString();
      await saveStrategy({
        mint: o.mint, symbol: o.symbol, creator: o.creator, wallet: ex?.wallet ?? wallet, rules, slippage: slip, status: 'active', entry_at: at,
        entry_price: entryPrice && entryPrice > 0 ? entryPrice : null, entry_tokens: ex ? ex.entry_tokens : holder?.tokens ?? null, entry_sol: buy?.sol ?? null,
      }, ex?.id);
      toast(ex ? 'Stratégie mise à jour' : 'Stratégie activée', o.symbol + ' · ' + rules.length + ' règle' + (rules.length > 1 ? 's' : '') + ', surveillées en temps réel.', 'g');
      onClose();
    } catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }

  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label={'Stratégie de sortie · ' + o.symbol} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="ts-modal-box sg" onSubmit={submit}>
        <button type="button" className="ts-x" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="ts-si-h"><b>Stratégie de sortie · {o.symbol}</b>
          <span>Le serveur vérifie vos règles à chaque transaction du token et vend aussitôt avec votre wallet rapide, même outil fermé. La première règle remplie s'exécute ; chacune une seule fois.</span></div>

        <RulesEditor rules={rules} setRules={setRules} preset={preset} setPreset={setPreset} fired={fired} showPresets={!ex} />

        <div className="sg-pos">
          <div className="sg-pos-l"><span className="sg-lbl">Position</span>
            {ex ? <span>{ex.entry_tokens ? fTok(Number(ex.entry_tokens)) + ' ' + o.symbol : o.symbol} · prix d'achat {entryPrice ? fPrice(Number(entryPrice), 'SOL') : '—'}</span>
              : holders == null ? <span className="dim">Lecture de vos wallets rapides…</span>
              : !holders.length ? <span className="sg-bad">Aucun wallet rapide ne détient {o.symbol}. Achetez avec un wallet rapide pour que la stratégie puisse vendre seule.</span>
              : <span>{fTok(holder?.tokens ?? 0)} {o.symbol}{entryPrice ? <> · prix d'achat <b className="mono">{fPrice(entryPrice, 'SOL')}</b></> : null}{buy ? ' · acheté à ' + hm(buy.t) : ''}</span>}
          </div>
          {holders && holders.length > 1 && (
            <label className="sg-field"><span className="sg-lbl">Wallet qui vend</span>
              <select value={wallet ?? ''} onChange={(e) => setWallet(e.target.value)}>{holders.map((h) => <option key={h.address} value={h.address}>{h.name} · {fTok(h.tokens)}</option>)}</select></label>
          )}
          <label className="sg-check"><input type="checkbox" checked={fromNow} onChange={(e) => setFromNow(e.target.checked)} />
            <span>Compter les achats et ventes des autres <b>à partir de maintenant</b>{!fromNow && (ex || buy) ? ' (sinon : depuis votre achat' + (buy && !ex ? ' de ' + hm(buy.t) : '') + ')' : ''}</span></label>
          <div className="sg-field"><span className="sg-lbl">Glissement maximum à la vente</span>
            <div className="sg-sell" role="group" aria-label="Glissement maximum">{SLIPS.map((v) => <button key={v} type="button" className={slip === v ? 'on' : ''} aria-pressed={slip === v} onClick={() => setSlip(v)}>{v} %</button>)}</div>
            <small className="dim">Sur pump.fun le prix bouge vite : 25 % évite qu'une vente urgente soit refusée.</small></div>
        </div>

        <div className="sg-sum" aria-live="polite"><span className="sg-lbl">En clair</span>
          <ul>{rules.map((r) => <li key={r.id} className={fired.has(r.id) ? 'done' : ''}>{r.all.map(condText).join(' et ')} → <b>{sellText(r.sell)}</b></li>)}</ul></div>

        {invalid && <p className="sg-bad">Complétez chaque condition avec une valeur supérieure à zéro.</p>}
        {err && <div className="ts-note bad" role="alert">{err}</div>}
        <div className="ts-row sg-act"><button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={!canSave}>{busy ? 'Enregistrement…' : ex ? 'Enregistrer' : 'Activer la stratégie'}</button></div>
      </form>
    </div>
  );
}

export const rulesInvalid = (rules: Rule[]) => !rules.length || rules.some((r) => !r.all.length || r.all.some((c) => !CONDS[c.k].noValue && !(Number(c.v) > 0)) || !(r.sell > 0 && r.sell <= 100));

/** Règles de vente : modèles, conditions combinables (ET), part vendue ; partagé avec l'achat automatique */
export function RulesEditor({ rules, setRules, preset, setPreset, fired = new Set<string>(), showPresets = true }: {
  rules: Rule[]; setRules: (f: (L: Rule[]) => Rule[]) => void; preset: string | null; setPreset: (p: string | null) => void; fired?: Set<string>; showPresets?: boolean;
}) {
  const edit = (i: number, f: (r: Rule) => Rule) => { setPreset(null); setRules((L) => L.map((r, j) => (j === i ? f(r) : r))); };
  const setCond = (i: number, j: number, c: Cond) => edit(i, (r) => ({ ...r, all: r.all.map((x, k) => (k === j ? c : x)) }));
  const usePreset = (id: string) => { const p = PRESETS.find((x) => x.id === id)!; setPreset(id); setRules(() => p.rules()); };
  return (<>
    {showPresets && (
      <div className="sg-presets" role="radiogroup" aria-label="Modèle">
        {PRESETS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className={preset === p.id ? 'on' : ''} onClick={() => usePreset(p.id)}>{p.l}</button>)}
        <button type="button" role="radio" aria-checked={preset === null} className={preset === null ? 'on' : ''} onClick={() => setPreset(null)}>Personnalisée</button>
      </div>
    )}
    {preset && <p className="sg-pdesc">{PRESETS.find((p) => p.id === preset)!.d}</p>}

    <ol className="sg-rules">
      {rules.map((r, i) => {
        const done = fired.has(r.id);
        return (
          <li key={r.id} className={'sg-rule' + (done ? ' done' : '')}>
            <div className="sg-rule-h"><span className="sg-num">{i + 1}</span><b>{done ? 'Exécutée' : 'Règle ' + (i + 1)}</b>
              {!done && rules.length > 1 && <button type="button" className="sg-del" aria-label={'Supprimer la règle ' + (i + 1)} onClick={() => { setPreset(null); setRules((L) => L.filter((_, j) => j !== i)); }}>Supprimer</button>}</div>
            {done ? <p className="sg-done">{ruleText(r)}</p> : (<>
              {r.all.map((c, j) => (
                <div key={j} className="sg-cond">
                  <span className="sg-kw">{j === 0 ? 'Si' : 'et'}</span>
                  <select value={c.k} aria-label="Condition" onChange={(e) => { const k = e.target.value as CondKind; setCond(i, j, { k, v: CONDS[k].noValue ? undefined : CONDS[k].def, arm: k === 'trail' ? 20 : undefined }); }}>
                    {COND_ORDER.map((k) => <option key={k} value={k}>{CONDS[k].l}</option>)}
                  </select>
                  {!CONDS[c.k].noValue && <Num v={c.v} unit={CONDS[c.k].unit} label={CONDS[c.k].l} onChange={(v) => setCond(i, j, { ...c, v })} />}
                  {c.k === 'trail' && <span className="sg-arm">après <Num v={c.arm} unit="%" label="Gain avant d'armer le recul" onChange={(arm) => setCond(i, j, { ...c, arm })} allowZero /></span>}
                  {r.all.length > 1 && <button type="button" className="sg-x" aria-label="Retirer cette condition" onClick={() => edit(i, (x) => ({ ...x, all: x.all.filter((_, k) => k !== j) }))}>×</button>}
                </div>
              ))}
              {r.all.length < 4 && <button type="button" className="sg-and" onClick={() => edit(i, (x) => ({ ...x, all: [...x.all, { k: 'sells', v: 2 }] }))}>+ et une autre condition</button>}
              <div className="sg-then"><span className="sg-kw">alors</span>
                <div className="sg-sell" role="group" aria-label="Part à vendre">
                  {SELLS.map((p) => <button key={p} type="button" className={r.sell === p ? 'on' : ''} aria-pressed={r.sell === p} onClick={() => edit(i, (x) => ({ ...x, sell: p }))}>{p === 100 ? 'Tout' : p + ' %'}</button>)}
                </div>
                <small className="dim">{r.sell >= 100 ? 'de la position' : 'de ce qui reste'}</small>
              </div>
              <p className="sg-hint">{CONDS[r.all[0]!.k].hint}</p>
            </>)}
          </li>
        );
      })}
    </ol>
    {rules.length < 8 && <button type="button" className="btn sm sg-add" onClick={() => { setPreset(null); setRules((L) => [...L, mkRule([{ k: 'gain', v: 100 }])]); }}>+ Ajouter une règle</button>}
  </>);
}

export function Num({ v, unit, label, onChange, allowZero }: { v?: number; unit: string; label: string; onChange: (v: number) => void; allowZero?: boolean }) {
  const [s, setS] = useState(v != null ? String(v).replace('.', ',') : '');
  useEffect(() => { const n = parse(s); if (v != null && n !== v) setS(String(v).replace('.', ',')); }, [v]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="sg-num-in"><input inputMode="decimal" value={s} aria-label={label} onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setS(t); const n = parse(t); if (n > 0 || (allowZero && n === 0)) onChange(n); }} />{unit && <em>{unit}</em>}</span>
  );
}
