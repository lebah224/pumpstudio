import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '../legacy/bridge';
import { tokenInfo } from './api';
import { fCompact } from './format';
import { solUsd, useLiveTrades, type LiveMsg } from './live';

/**
 * Alertes de capitalisation : « prévenez-moi quand ce token passe au-dessus / sous X $ ».
 * Enregistrées dans ce navigateur, surveillées en direct tant que TokenStudio est ouvert (même sur une autre page).
 * Une alerte se déclenche une seule fois, puis disparaît.
 */
export type Alert = { id: string; mint: string; symbol: string; dir: 'above' | 'below'; mc: number; at: number };
const KEY = 'ts-trader-alerts';
const subs = new Set<() => void>();
const read = (): Alert[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((a) => a && typeof a.mint === 'string' && a.mc > 0).slice(0, 30) : []; } catch { return []; } };
let list = read();
const write = (L: Alert[]) => { list = L; try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { /* stockage indisponible */ } subs.forEach((f) => f()); };
export function useAlerts() {
  const [L, setL] = useState(list);
  useEffect(() => { const f = () => setL(list); subs.add(f); return () => { subs.delete(f); }; }, []);
  return L;
}
const add = (a: Omit<Alert, 'id' | 'at'>) => write([...list, { ...a, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now() }]);
const remove = (id: string) => write(list.filter((a) => a.id !== id));

/** « 50k », « 1,2 M », « 250 000 » → nombre */
export function parseAmount(s: string): number {
  const m = s.trim().toLowerCase().replace(/\s|\$/g, '').replace(',', '.').match(/^(\d+(?:\.\d+)?)(k|m|md|b)?$/);
  if (!m) return NaN;
  return +m[1]! * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'md' || m[2] === 'b' ? 1e9 : 1);
}

function fire(a: Alert, mc: number) {
  remove(a.id);
  const title = a.symbol + (a.dir === 'above' ? ' dépasse ' : ' passe sous ') + fCompact(a.mc);
  const text = 'Capitalisation actuelle : ' + fCompact(mc) + '.';
  toast(title, text, a.dir === 'above' ? 'g' : 'a');
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('TokenStudio · ' + title, { body: text, tag: 'ts-alert-' + a.id }); } catch { /* notifications indisponibles */ }
}
const check = (mint: string, mc: number) => list.filter((a) => a.mint === mint).forEach((a) => { if (a.dir === 'above' ? mc >= a.mc : mc <= a.mc) fire(a, mc); });

/** Surveillance des alertes : flux en direct pour les tokens pump.fun, relecture toutes les 30 s pour tous */
export function useAlertWatcher() {
  const L = useAlerts();
  const mints = useMemo(() => [...new Set(L.map((a) => a.mint))].slice(0, 20), [L]);
  const onTrade = useCallback((m: LiveMsg) => { const r = solUsd(); if (m.mcSol && r) check(m.mint, m.mcSol * r); }, []);
  useLiveTrades('alerts', mints, onTrade, mints.length > 0);
  useEffect(() => {
    if (!mints.length) return;
    const id = setInterval(() => { if (document.hidden) return; mints.forEach((m) => tokenInfo(m).then((t) => { if (t.mcUsd) check(m, t.mcUsd); }).catch(() => {})); }, 30_000);
    return () => clearInterval(id);
  }, [mints]);
}

export function PriceAlerts({ mint, symbol, mcUsd }: { mint: string; symbol: string; mcUsd: number | null }) {
  const L = useAlerts().filter((a) => a.mint === mint);
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const target = parseAmount(v);
  const dir: 'above' | 'below' = mcUsd != null && target < mcUsd ? 'below' : 'above';
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!(target > 0)) { setErr('Saisissez une capitalisation, par exemple 100k ou 1,5 M.'); return; }
    if (L.length >= 5) { setErr('5 alertes au plus par token.'); return; }
    add({ mint, symbol, dir, mc: target }); setV('');
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* notifications indisponibles */ }
    toast('Alerte créée', symbol + (dir === 'above' ? ' au-dessus de ' : ' sous ') + fCompact(target) + ' de capitalisation.');
  };
  return (
    <div className="card tr-alerts">
      <h3>Alertes de prix</h3>
      <p className="dim tr-small">Soyez prévenu quand la capitalisation atteint un niveau. Actif tant que TokenStudio est ouvert.</p>
      <form className="tr-alert-f" onSubmit={submit}>
        <label className="tr-amt-in sm"><input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={mcUsd ? fCompact(mcUsd * 2, '') : '100k'} aria-label="Capitalisation visée en dollars" /><em>$</em></label>
        <button className="btn sm" type="submit" disabled={!v.trim()}>{target > 0 ? (dir === 'above' ? 'Au-dessus' : 'En dessous') : 'Créer'}</button>
      </form>
      {err && <p className="tr-warn">{err}</p>}
      {L.length > 0 && (
        <ul className="tr-alert-l">{L.map((a) => (
          <li key={a.id}><span className={a.dir === 'above' ? 'up' : 'down'}>{a.dir === 'above' ? '↑ au-dessus de' : '↓ sous'}</span> <b className="mono">{fCompact(a.mc)}</b>
            <button type="button" className="tr-copy" aria-label="Supprimer l'alerte" onClick={() => remove(a.id)}><svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg></button></li>
        ))}</ul>
      )}
    </div>
  );
}
