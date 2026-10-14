import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { Sol } from '../ui/Sol';
import { age, fCompact } from './format';
import { CopyBtn, TokenLogo } from './bits';
import { ADDR_RE, shortAddr } from './creators';
import {
  openTrader, track, traderName, untrack, updateTracked, useTraderProfile, useTracked, useTrackedTrades,
  type TraderProfile, type Tracked,
} from './traders';
import { DiscoverSection } from './Discovery';
import '../styles/creators.css';

export { openTrader };

const VERDICT_C: Record<string, string> = { Rentable: 'g', Moyen: 'a', Perdant: 'r', Inconnu: '' };
const mins = (m: number | null) => (m == null ? '—' : m < 1 ? '< 1 min' : m < 60 ? Math.round(m) + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' j');
const secs = (s: number | null) => (s == null ? '—' : s < 90 ? Math.round(s) + ' s' : mins(s / 60));
const pct = (v: number | null) => (v == null ? '—' : Math.round(v * 100) + ' %');
const signed = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const MINS = [0, 0.1, 0.5, 1, 5];

function TraderBadge({ p, size = 'sm' }: { p: TraderProfile | null; size?: 'sm' | 'lg' }) {
  if (!p) return <span className={'cr-score ' + size + ' wait'} aria-label="Analyse en cours">…</span>;
  return <span className={'cr-score ' + size + ' ' + (VERDICT_C[p.verdict] ?? '')} title={'Note indicative : ' + (p.score ?? '—') + ' / 100'}><b className="mono">{p.score ?? '—'}</b><span>{p.verdict}</span></span>;
}

/** Page « Acheteurs suivis » du Trader : wallets suivis, ajout par adresse, achats et ventes en direct */
export function TradersView({ onOpen }: { onOpen: (mint: string) => void }) {
  const list = useTracked();
  const all = useTrackedTrades();
  const trades = all && list ? all.filter((t) => list.some((w) => w.address === t.trader)) : null;
  const [addr, setAddr] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = ADDR_RE.test(addr.trim());
  async function add(e: FormEvent) {
    e.preventDefault(); if (!valid) return;
    setBusy(true);
    try { await track(addr, label); toast('Wallet suivi', (label.trim() || shortAddr(addr.trim())) + ' · ses achats arrivent ici en direct.', 'g'); setAddr(''); setLabel(''); }
    catch (e2) { toast('Ajout impossible', readable(e2), 'r'); } finally { setBusy(false); }
  }
  const names = new Map((list ?? []).map((f) => [f.address, traderName(f)]));
  return (
    <div className="cr-view">
      <section className="card cr-add">
        <div className="cr-add-t"><b>Suivre un acheteur</b><span>Collez l'adresse d'un wallet qui trade (visible dans les transactions d'une fiche de token). Chacun de ses achats arrive ici dans la seconde, avec une notification, même outil fermé.</span></div>
        <form className="cr-add-f" onSubmit={add}>
          <input className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Adresse du wallet" aria-label="Adresse du wallet à suivre" spellCheck={false} autoComplete="off" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom (facultatif)" aria-label="Nom du wallet" maxLength={32} />
          <button className="btn primary" disabled={!valid || busy}>{busy ? 'Ajout…' : 'Suivre'}</button>
        </form>
      </section>

      <div className="cr-grid">
        <section className="card cr-list">
          <div className="cr-h"><b>Acheteurs suivis</b><span className="dim">{list ? list.length : '…'}</span></div>
          {!list ? <div className="empty"><b>Chargement…</b></div> : !list.length ? (
            <div className="empty"><b>Aucun wallet suivi</b><span>Ouvrez un token, touchez une adresse dans ses <b>transactions</b> pour voir la fiche de l'acheteur, puis « Suivre ». Ou collez une adresse ci-dessus.</span></div>
          ) : <ul className="cr-rows">{list.map((f) => <TrackedRow key={f.id} f={f} />)}</ul>}
        </section>

        <section className="card cr-feed">
          <div className="cr-h"><b>En direct</b><span className="dim">achats et ventes de vos acheteurs</span></div>
          {!trades ? <div className="empty"><b>Chargement…</b></div> : !trades.length ? (
            <div className="empty"><b>Rien pour l'instant</b><span>Chaque achat ou vente d'un wallet suivi apparaît ici dans la seconde.</span></div>
          ) : (
            <ul className="cr-launches">{trades.map((t) => (
              <li key={t.id}><button type="button" onClick={() => onOpen(t.mint)}>
                <span className={'cr-run-st tt-side ' + (t.side === 'buy' ? 'g' : 'r')}>{t.side === 'buy' ? 'Achat' : 'Vente'}</span>
                <TokenLogo src={t.image} name={t.symbol || '?'} size={30} />
                <span className="cr-l-t"><b>{t.symbol ? '$' + t.symbol : shortAddr(t.mint)}</b><small>{names.get(t.trader) ?? shortAddr(t.trader)}{t.mcap_sol != null ? ' · capi. ' + Math.round(t.mcap_sol).toLocaleString('fr-FR') + ' SOL' : ''}</small></span>
                <span className="cr-l-m"><b><Sol v={t.sol} d={3} /></b><small>il y a {age(Date.parse(t.at))}</small></span>
              </button></li>
            ))}</ul>
          )}
        </section>
      </div>

      <DiscoverSection onOpen={onOpen} />
    </div>
  );
}

function TrackedRow({ f }: { f: Tracked }) {
  const { p } = useTraderProfile(f.address);
  const [busy, setBusy] = useState(false);
  const toggle = async () => { setBusy(true); try { await updateTracked(f.id, { alerts: !f.alerts }); } catch (e) { toast('Action impossible', readable(e), 'r'); } finally { setBusy(false); } };
  const S = p?.stats;
  return (
    <li className="cr-row">
      <button type="button" className="cr-row-main" onClick={() => openTrader(f.address)}>
        <TraderBadge p={p} />
        <span className="cr-row-t"><b>{traderName(f)}</b><small className="mono">{shortAddr(f.address)}</small></span>
        <span className="cr-row-k"><small>Réussite</small><b className="mono">{S ? pct(S.winRate) : '…'}</b></span>
        <span className="cr-row-k hide-s"><small>Résultat</small><b className={'mono ' + (S ? signed(S.pnlSol) : '')}>{S ? <Sol v={S.pnlSol} d={2} /> : '…'}</b></span>
        <span className="cr-row-k hide-m"><small>Dernier</small><b>{f.last_trade_at ? age(Date.parse(f.last_trade_at)) : S?.last ? age(S.last) : '—'}</b></span>
      </button>
      <label className="cr-bell" title={f.alerts ? 'Alertes d\'achat activées' : 'Alertes coupées'}>
        <input type="checkbox" checked={f.alerts} disabled={busy} onChange={toggle} /><span aria-hidden="true" /><em className="sr">Alerte à chaque achat</em>
      </label>
    </li>
  );
}

/** Fiche d'un acheteur (fenêtre) : note, raisons, résultats, style, tokens, alertes, suivi */
export function TraderSheet({ onOpen }: { onOpen: (mint: string) => void }) {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const f = (e: Event) => { const a = (e as CustomEvent).detail; if (typeof a === 'string' && ADDR_RE.test(a)) setAddr(a); };
    window.addEventListener('ts-trader-sheet', f); return () => window.removeEventListener('ts-trader-sheet', f);
  }, []);
  useEffect(() => { if (!addr) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddr(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [addr]);
  if (!addr) return null;
  return <Sheet key={addr} address={addr} onClose={() => setAddr(null)} onOpen={(m) => { setAddr(null); onOpen(m); }} />;
}

function Sheet({ address, onClose, onOpen }: { address: string; onClose: () => void; onOpen: (mint: string) => void }) {
  const { p, err } = useTraderProfile(address);
  const list = useTracked();
  const f = list?.find((x) => x.address === address) ?? null;
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (f && label == null) setLabel(f.label ?? ''); }, [f, label]);
  const run = async (fn: () => Promise<void>, ok: string) => { setBusy(true); try { await fn(); toast(ok); } catch (e) { toast('Action impossible', readable(e), 'r'); } finally { setBusy(false); } };
  const S = p?.stats;
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Fiche acheteur" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ts-modal-box cr-sheet">
        <button type="button" className="ts-x" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="cr-sheet-h">
          <TraderBadge p={p} size="lg" />
          <div className="cr-sheet-t"><b>{f ? traderName(f) : 'Acheteur'}</b>
            <span className="mono">{shortAddr(address)} <CopyBtn text={address} label="Copier l'adresse du wallet" /></span>
            <a href={'https://solscan.io/account/' + address} target="_blank" rel="noopener noreferrer">Voir sur Solscan ↗</a></div>
        </div>

        {err ? <div className="ts-note bad">{err}</div> : !p ? <div className="empty"><b>Lecture de ses derniers échanges…</b><span>Une dizaine de secondes au plus.</span></div> : (<>
          <ul className="cr-reasons">{p.reasons.map((r, i) => <li key={i} className={r.k}><i aria-hidden="true" />{r.t}</li>)}</ul>
          <div className="cr-kpis">
            <div><small>Résultat réalisé</small><b className={signed(S!.pnlSol)}><Sol v={S!.pnlSol} d={2} /></b><span className="dim">sur {S!.closed} token{S!.closed > 1 ? 's' : ''} revendu{S!.closed > 1 ? 's' : ''}</span></div>
            <div><small>Réussite</small><b className="mono">{pct(S!.winRate)}</b><span className="dim">{S!.wins} gagnant{S!.wins > 1 ? 's' : ''}</span></div>
            <div><small>Entrée</small><b className="mono">{secs(S!.entryMedianSec)}</b><span className="dim">après la création (médiane)</span></div>
            <div><small>Détention</small><b className="mono">{mins(S!.holdMedianMin)}</b><span className="dim">avant la 1re vente (médiane)</span></div>
            <div><small>Achat habituel</small><b>{S!.buyMedian == null ? '—' : <Sol v={S!.buyMedian} d={2} />}</b><span className="dim">médiane</span></div>
            <div><small>Activité</small><b className="mono">{S!.perDay == null ? '—' : Math.round(S!.perDay).toLocaleString('fr-FR') + ' tx / j'}</b><span className="dim">{S!.open} position{S!.open > 1 ? 's' : ''} ouverte{S!.open > 1 ? 's' : ''}</span></div>
          </div>
          <p className="dim cr-disclaim">Calculé sur ses {S!.swaps} derniers échanges contre des SOL{S!.first ? ', depuis ' + age(S!.first) : ''}. Note indicative : elle ne garantit rien sur ses prochains trades.</p>

          {!!p.tokens.length && (
            <div className="tr-table-wrap cr-coins-wrap">
              <table className="tr-table cr-coins">
                <thead><tr><th>Token</th><th className="num">Misé</th><th className="num">Résultat</th><th className="hide-s">Entrée</th><th className="hide-s">Revendu</th><th>Dernier</th></tr></thead>
                <tbody>{p.tokens.map((t) => (
                  <tr key={t.mint} tabIndex={0} onClick={() => onOpen(t.mint)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t.mint); }}>
                    <td><span className="cr-coin"><TokenLogo src={t.image} name={t.symbol ?? '?'} size={26} /><b>{t.symbol ?? shortAddr(t.mint)}</b>{t.open && <em className="tr-badge a">en cours</em>}</span></td>
                    <td className="num mono"><Sol v={t.buySol} d={2} /></td>
                    <td className={'num mono ' + (t.pnl == null ? 'dim' : signed(t.pnl))}>{t.pnl == null ? '—' : <><Sol v={t.pnl} d={2} />{t.roi != null && <small> {(t.roi >= 0 ? '+' : '') + Math.round(t.roi * 100)} %</small>}</>}</td>
                    <td className="hide-s dim">{secs(t.entrySec)}</td>
                    <td className="hide-s dim">{t.soldPct == null ? '—' : Math.round(t.soldPct) + ' %'}</td>
                    <td className="dim">{age(t.last)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {!!S && S.volume > 0 && <p className="dim cr-disclaim">Capitalisation actuelle des tokens : {p.tokens.filter((t) => t.mcUsd != null).slice(0, 3).map((t) => (t.symbol ?? '?') + ' ' + fCompact(t.mcUsd)).join(' · ') || '—'}</p>}
        </>)}

        <div className="cr-sheet-f">
          {f ? (<>
            <label className="cr-name"><span className="sg-lbl">Nom</span><input value={label ?? ''} maxLength={32} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if ((label ?? '') !== (f.label ?? '')) run(() => updateTracked(f.id, { label: (label ?? '').trim() || null }), 'Nom enregistré'); }} placeholder={shortAddr(address)} /></label>
            <div className="tt-alerts">
              <label className="sg-check"><input type="checkbox" checked={f.alerts} disabled={busy} onChange={() => run(() => updateTracked(f.id, { alerts: !f.alerts }), f.alerts ? 'Alertes d\'achat coupées' : 'Alertes d\'achat activées')} /><span>M'avertir à chaque achat</span></label>
              <label className="sg-check"><input type="checkbox" checked={f.alert_sells} disabled={busy} onChange={() => run(() => updateTracked(f.id, { alert_sells: !f.alert_sells }), f.alert_sells ? 'Alertes de vente coupées' : 'Alertes de vente activées')} /><span>… et à chaque vente</span></label>
              <label className="tt-min"><span>À partir de</span>
                <select value={f.alert_min_sol} disabled={busy} onChange={(e) => run(() => updateTracked(f.id, { alert_min_sol: Number(e.target.value) }), 'Seuil enregistré')} aria-label="Montant minimum pour être averti">
                  {[...new Set([...MINS, f.alert_min_sol])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v === 0 ? 'tout montant' : v.toLocaleString('fr-FR') + ' SOL'}</option>)}
                </select></label>
            </div>
            <button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => run(() => untrack(f.id), 'Wallet retiré')}>Ne plus suivre</button>
          </>) : <button type="button" className="btn primary" disabled={busy || !list} onClick={() => run(() => track(address), 'Wallet suivi')}>Suivre cet acheteur</button>}
        </div>
      </div>
    </div>
  );
}
