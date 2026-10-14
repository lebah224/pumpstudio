import { useEffect, useState } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { Sol } from '../ui/Sol';
import { openStrategy } from './StrategyDialog';
import { condText, quickHolders, removeStrategy, sellText, setStatus, useStrategies, type Strategy } from './strategies';

const STATUS: Record<Strategy['status'], { l: string; c: string }> = {
  active: { l: 'Active', c: 'ok' }, paused: { l: 'En pause', c: 'wait' }, done: { l: 'Terminée', c: 'off' }, error: { l: 'En erreur', c: 'bad' },
};
const nf = (v: number, d = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'il y a ' + s + ' s' : s < 3600 ? 'il y a ' + Math.round(s / 60) + ' min' : new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
const hm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Gain actuel par rapport au prix d'achat, d'après le dernier relevé du serveur */
export function gainOf(s: Strategy) {
  const p = s.state.seen?.price, ref = Number(s.entry_price) || s.state.ref;
  return p && ref ? (p / ref - 1) * 100 : null;
}
function useTick(ms: number) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]); }

/** Stratégie du token ouvert (panneau « Ma position ») */
export function StrategyCard({ mint, symbol, creator, priceSol, avg, held }: { mint: string; symbol: string; creator: string | null; priceSol: number | null; avg: number | null; held: number }) {
  const list = useStrategies();
  useTick(5000);
  const s = list?.find((x) => x.mint === mint && (x.status === 'active' || x.status === 'paused' || x.status === 'error'))
    ?? list?.find((x) => x.mint === mint && x.status === 'done' && Date.now() - Date.parse(x.created_at) < 6 * 3600_000) ?? null;
  const [busy, setBusy] = useState(false);
  const act = async (f: () => Promise<void>, ok: string) => { setBusy(true); try { await f(); toast(ok, symbol); } catch (e) { toast('Action impossible', readable(e), 'r'); } finally { setBusy(false); } };
  const open = (existing: Strategy | null) => openStrategy({ mint, symbol, creator, priceSol, avg, existing });
  // un wallet rapide détient-il ce token ? (le wallet actif peut être Phantom)
  const [quick, setQuick] = useState(0);
  useEffect(() => {
    if (s) return;
    let alive = true;
    const f = () => quickHolders(mint).then((L) => { if (alive) setQuick(L.reduce((a, x) => a + x.tokens, 0)); }).catch(() => {});
    f(); const t = setInterval(() => { if (!document.hidden) f(); }, 20_000);
    window.addEventListener('ts-trade-refresh', f);
    return () => { alive = false; clearInterval(t); window.removeEventListener('ts-trade-refresh', f); };
  }, [mint, !!s, held]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return held > 0 || quick > 0 ? (
    <div className="sg-card empty">
      <div><b>Stratégie de sortie</b><span>Vente automatique sur gain, perte, achats ou ventes après le vôtre, vente du créateur… même outil fermé.</span></div>
      <button type="button" className="btn sm primary" onClick={() => open(null)}>Définir</button>
    </div>
  ) : null;

  const fired = new Set(s.state.fired ?? []), seen = s.state.seen, g = gainOf(s), st = STATUS[s.status];
  const peak = s.state.peak && (Number(s.entry_price) || s.state.ref) ? (s.state.peak / (Number(s.entry_price) || s.state.ref!) - 1) * 100 : null;
  const logFor = (id: string) => [...(s.state.log ?? [])].reverse().find((l) => l.rule === id && l.ok);
  return (
    <div className={'sg-card ' + s.status}>
      <div className="sg-card-h">
        <b>Stratégie de sortie</b><span className={'ts-hub-pill ' + st.c}>{st.l}</span>
        <span className="sg-card-acts">
          {(s.status === 'active' || s.status === 'paused' || s.status === 'error') && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => open(s)}>Modifier</button>}
          {s.status === 'active' && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => act(() => setStatus(s.id, 'paused'), 'Stratégie en pause')}>Pause</button>}
          {(s.status === 'paused' || s.status === 'error') && <button type="button" className="btn sm" disabled={busy} onClick={() => act(() => setStatus(s.id, 'active'), 'Stratégie relancée')}>Reprendre</button>}
          {s.status !== 'done' ? <button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => { if (window.confirm('Arrêter cette stratégie ? Vos tokens restent dans le wallet.')) act(() => setStatus(s.id, 'done'), 'Stratégie arrêtée'); }}>Arrêter</button>
            : <button type="button" className="btn sm ghost" disabled={busy} onClick={() => act(() => removeStrategy(s.id), 'Stratégie effacée')}>Effacer</button>}
        </span>
      </div>
      {seen && s.status !== 'done' && (
        <div className="sg-facts">
          <span><small>Gain</small><b className={'mono ' + (g == null ? '' : g >= 0 ? 'up' : 'down')}>{g == null ? '—' : (g >= 0 ? '+' : '') + nf(g) + ' %'}</b></span>
          <span><small>Plus haut</small><b className="mono">{peak == null ? '—' : '+' + nf(Math.max(0, peak)) + ' %'}</b></span>
          <span><small>Après vous</small><b className="mono">{seen.buys}{seen.capped ? '+' : ''} A · {seen.sells}{seen.capped ? '+' : ''} V</b></span>
          <span><small>Créateur</small><b className={seen.creatorSold ? 'down' : ''}>{s.creator ? (seen.creatorSold ? 'a vendu' : 'garde') : '—'}</b></span>
        </div>
      )}
      <ul className="sg-card-rules">
        {s.rules.map((r) => { const l = logFor(r.id), done = fired.has(r.id); return (
          <li key={r.id} className={done ? 'done' : ''}><i aria-hidden="true">{done ? '✓' : '○'}</i>
            <span>{r.all.map(condText).join(' et ')} → <b>{sellText(r.sell)}</b>{done && l ? <em> · {hm(l.t)}{l.sol ? <> · +<Sol v={l.sol} d={4} /></> : null}</em> : null}</span></li>
        ); })}
      </ul>
      <p className="sg-card-f dim">
        {s.status === 'error' ? <span className="down">Ventes en échec : {s.state.last_error ?? 'erreur inconnue'}. Vérifiez le solde de SOL du wallet pour les frais.</span>
          : s.status === 'done' ? (s.state.end === 'no_tokens' ? 'Terminée : le wallet rapide ne détient plus ce token.' : 'Terminée.')
          : s.status === 'paused' ? 'En pause : aucune vente ne part.'
          : seen ? 'Vérifiée ' + ago(seen.at) + ' · toutes les 5 s, même outil fermé' : 'Première vérification dans quelques secondes…'}
        {s.state.fails && s.status === 'active' ? <span className="down"> · dernier essai en échec, nouvel essai automatique</span> : null}
      </p>
    </div>
  );
}

/** Liste des stratégies (page Trader, sous la recherche) */
export function StrategyList({ onOpen }: { onOpen: (mint: string) => void }) {
  const list = useStrategies();
  useTick(5000);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('ts-sg-open') !== '0'; } catch { return true; } });
  const live = (list ?? []).filter((s) => s.status !== 'done'), recent = (list ?? []).filter((s) => s.status === 'done').slice(0, 5);
  if (!list || (!live.length && !recent.length)) return null;
  const toggle = () => setOpen((o) => { try { localStorage.setItem('ts-sg-open', o ? '0' : '1'); } catch { /* navigation privée */ } return !o; });
  return (
    <section className="card sg-list">
      <button type="button" className="sg-list-h" aria-expanded={open} onClick={toggle}>
        <b>Mes stratégies</b><span className="dim">{live.length} en cours{recent.length ? ' · ' + recent.length + ' terminée' + (recent.length > 1 ? 's' : '') + ' récemment' : ''}</span>
        <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
      </button>
      {open && (
        <div className="tr-table-wrap">
          <table className="tr-table sg-table">
            <thead><tr><th>Token</th><th>État</th><th className="num">Gain</th><th className="num">Après vous</th><th>Règles</th><th className="hide-s">Vérifiée</th></tr></thead>
            <tbody>
              {[...live, ...recent].map((s) => { const g = gainOf(s), st = STATUS[s.status], seen = s.state.seen; return (
                <tr key={s.id} tabIndex={0} onClick={() => onOpen(s.mint)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.mint); }}>
                  <td><b>{s.symbol || s.mint.slice(0, 4)}</b></td>
                  <td><span className={'ts-hub-pill ' + st.c}>{st.l}</span></td>
                  <td className={'num mono ' + (g == null ? '' : g >= 0 ? 'up' : 'down')}>{g == null || s.status === 'done' ? '—' : (g >= 0 ? '+' : '') + nf(g) + ' %'}</td>
                  <td className="num mono">{seen && s.status !== 'done' ? seen.buys + ' A · ' + seen.sells + ' V' : '—'}</td>
                  <td className="mono">{(s.state.fired?.length ?? 0)}/{s.rules.length}</td>
                  <td className="hide-s dim">{seen ? ago(seen.at) : '—'}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
