import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { Sol } from '../ui/Sol';
import { age, fCompact } from './format';
import { CopyBtn, TokenLogo } from './bits';
import {
  ADDR_RE, creatorName, follow, shortAddr, unfollow, updateCreator, useCreatorProfile, useFollowed, useLaunches,
  type CreatorProfile, type Followed,
} from './creators';
import { openSnipe } from './SnipeDialog';
import { useSnipeRuns, useSnipes, type Snipe, type SnipeRun } from './snipes';
import { CreatorBuyersSection } from './Discovery';
import '../styles/creators.css';

export const openCreator = (address: string) => window.dispatchEvent(new CustomEvent('ts-creator', { detail: address }));
const VERDICT_C: Record<string, string> = { Solide: 'g', Moyen: 'a', Risqué: 'r', Inconnu: '' };
const mins = (m: number | null) => (m == null ? '—' : m < 1 ? '< 1 min' : m < 60 ? Math.round(m) + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' j');
const pct = (v: number) => Math.round(v * 100) + ' %';

export function ScoreBadge({ p, size = 'sm' }: { p: CreatorProfile | null; size?: 'sm' | 'lg' }) {
  if (!p) return <span className={'cr-score ' + size + ' wait'} aria-label="Analyse en cours">…</span>;
  const c = VERDICT_C[p.verdict] ?? '';
  return <span className={'cr-score ' + size + ' ' + c} title={'Note indicative : ' + (p.score ?? '—') + ' / 100'}><b className="mono">{p.score ?? '—'}</b><span>{p.verdict}</span></span>;
}

/** Page « Créateurs » du Trader : liste suivie, ajout par adresse, derniers lancements */
export function CreatorsView({ onOpen }: { onOpen: (mint: string) => void }) {
  const list = useFollowed();
  const allLaunches = useLaunches();
  // seulement les créateurs encore suivis (un créateur retiré emporte ses lancements)
  const launches = allLaunches && list ? allLaunches.filter((l) => list.some((c) => c.address === l.creator)) : null;
  const snipes = useSnipes();
  const runs = useSnipeRuns();
  const [addr, setAddr] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = ADDR_RE.test(addr.trim());
  async function add(e: FormEvent) {
    e.preventDefault(); if (!valid) return;
    setBusy(true);
    try { await follow(addr, label); toast('Créateur suivi', (label.trim() || shortAddr(addr.trim())) + ' · vous serez prévenu à chaque lancement.', 'g'); setAddr(''); setLabel(''); }
    catch (e2) { toast('Ajout impossible', readable(e2), 'r'); } finally { setBusy(false); }
  }
  const names = new Map((list ?? []).map((f) => [f.address, creatorName(f)]));
  return (
    <div className="cr-view">
      <section className="card cr-add">
        <div className="cr-add-t"><b>Suivre un créateur</b><span>Collez l'adresse du wallet qui crée les tokens (visible dans l'onglet Créateur d'une fiche). Vous recevez une notification dès qu'il lance un token, même outil fermé.</span></div>
        <form className="cr-add-f" onSubmit={add}>
          <input className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Adresse du créateur" aria-label="Adresse du créateur" spellCheck={false} autoComplete="off" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom (facultatif)" aria-label="Nom du créateur" maxLength={32} />
          <button className="btn primary" disabled={!valid || busy}>{busy ? 'Ajout…' : 'Suivre'}</button>
        </form>
      </section>

      <div className="cr-grid">
        <section className="card cr-list">
          <div className="cr-h"><b>Créateurs suivis</b><span className="dim">{list ? list.length : '…'}</span></div>
          {!list ? <div className="empty"><b>Chargement…</b></div> : !list.length ? (
            <div className="empty"><b>Aucun créateur suivi</b><span>Ouvrez un token, onglet <b>Créateur</b>, puis « Suivre ce créateur ». Ou collez une adresse ci-dessus.</span></div>
          ) : <ul className="cr-rows">{list.map((f) => <CreatorRow key={f.id} f={f} snipe={snipes?.find((x) => x.creator === f.address) ?? null} />)}</ul>}
        </section>

        <section className="card cr-feed">
          <div className="cr-h"><b>Derniers lancements</b><span className="dim">de vos créateurs</span></div>
          {!launches ? <div className="empty"><b>Chargement…</b></div> : !launches.length ? (
            <div className="empty"><b>Rien pour l'instant</b><span>Chaque nouveau token d'un créateur suivi apparaît ici en quelques secondes.</span></div>
          ) : (
            <ul className="cr-launches">{launches.map((l) => (
              <li key={l.id}><button type="button" onClick={() => onOpen(l.mint)}>
                <TokenLogo src={l.image} mint={l.mint} name={l.symbol || '?'} size={34} />
                <span className="cr-l-t"><b>{l.symbol || '?'}</b><small>{l.name || ''}</small></span>
                <span className="cr-l-m"><b>{names.get(l.creator) ?? shortAddr(l.creator)}</b><small>il y a {age(Date.parse(l.launched_at))}</small></span>
              </button></li>
            ))}</ul>
          )}
        </section>
      </div>

      {!!runs?.length && (
        <section className="card cr-runs">
          <div className="cr-h"><b>Achats automatiques</b><span className="dim">dernières tentatives</span></div>
          <ul>{runs.map((r) => <RunRow key={r.id} r={r} name={names.get(r.creator) ?? shortAddr(r.creator)} onOpen={onOpen} />)}</ul>
        </section>
      )}
    </div>
  );
}

const RUN_L: Record<SnipeRun['status'], [string, string]> = {
  pending: ['En cours', 'a'], sent: ['Envoyé', 'a'], bought: ['Acheté', 'g'], failed: ['Échoué', 'r'], skipped: ['Ignoré', ''],
};
function RunRow({ r, name, onOpen }: { r: SnipeRun; name: string; onOpen: (mint: string) => void }) {
  const [l, c] = RUN_L[r.status];
  return (
    <li><button type="button" onClick={() => onOpen(r.mint)}>
      <span className={'cr-run-st ' + c}>{l}</span>
      <span className="cr-l-t"><b>{r.symbol ? '$' + r.symbol : shortAddr(r.mint)}</b><small>{name}{r.reason ? ' · ' + r.reason : ''}</small></span>
      <span className="cr-l-m">
        <b>{r.sol != null ? <Sol v={Number(r.sol)} d={3} /> : r.amount_sol != null ? <Sol v={Number(r.amount_sol)} d={3} /> : '—'}</b>
        <small>{r.send_ms != null ? 'parti en ' + (r.send_ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' s · ' : ''}il y a {age(Date.parse(r.created_at))}</small></span>
    </button></li>
  );
}

function CreatorRow({ f, snipe }: { f: Followed; snipe: Snipe | null }) {
  const { p } = useCreatorProfile(f.address);
  const [busy, setBusy] = useState(false);
  const toggle = async () => { setBusy(true); try { await updateCreator(f.id, { alerts: !f.alerts }); } catch (e) { toast('Action impossible', readable(e), 'r'); } finally { setBusy(false); } };
  return (
    <li className="cr-row">
      <button type="button" className="cr-row-main" onClick={() => openCreator(f.address)}>
        <ScoreBadge p={p} />
        <span className="cr-row-t"><b>{creatorName(f)}</b><small className="mono">{shortAddr(f.address)}</small></span>
        <span className="cr-row-k hide-s"><small>Tokens</small><b className="mono">{p ? p.stats.count : '…'}</b></span>
        <span className="cr-row-k"><small>Migrés</small><b className="mono">{p ? pct(p.stats.migRate) : '…'}</b></span>
        <span className="cr-row-k hide-s"><small>Vend après</small><b className="mono">{p ? (p.stats.sellMedianMin == null ? 'jamais' : mins(p.stats.sellMedianMin)) : '…'}</b></span>
        <span className="cr-row-k hide-m"><small>Dernier</small><b>{p?.stats.lastLaunch ? age(p.stats.lastLaunch) : '—'}</b></span>
      </button>
      <button type="button" className={'cr-auto' + (snipe?.enabled ? ' on' : snipe ? ' off' : '')} onClick={() => openSnipe({ creator: f.address, name: creatorName(f) })}
        title={snipe?.enabled ? 'Achat automatique actif : ' + snipe.amount_sol + ' SOL' : snipe ? 'Achat automatique en pause' : 'Programmer un achat automatique'}>
        {snipe?.enabled ? <><i aria-hidden="true" />Auto · {Number(snipe.amount_sol).toLocaleString('fr-FR')}</> : 'Auto'}</button>
      <label className="cr-bell" title={f.alerts ? 'Alertes de lancement activées' : 'Alertes coupées'}>
        <input type="checkbox" checked={f.alerts} disabled={busy} onChange={toggle} /><span aria-hidden="true" /><em className="sr">Alerte de lancement</em>
      </label>
    </li>
  );
}

/** Fiche d'un créateur (fenêtre) : note, raisons, comportement, tokens, suivi */
export function CreatorSheet({ onOpen }: { onOpen: (mint: string) => void }) {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const f = (e: Event) => { const a = (e as CustomEvent).detail; if (typeof a === 'string' && ADDR_RE.test(a)) setAddr(a); };
    window.addEventListener('ts-creator', f); return () => window.removeEventListener('ts-creator', f);
  }, []);
  useEffect(() => { if (!addr) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddr(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [addr]);
  if (!addr) return null;
  return <Sheet key={addr} address={addr} onClose={() => setAddr(null)} onOpen={(m) => { setAddr(null); onOpen(m); }} />;
}

function Sheet({ address, onClose, onOpen }: { address: string; onClose: () => void; onOpen: (mint: string) => void }) {
  const { p, err } = useCreatorProfile(address);
  const list = useFollowed();
  const f = list?.find((x) => x.address === address) ?? null;
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (f && label == null) setLabel(f.label ?? ''); }, [f, label]);
  const run = async (fn: () => Promise<void>, ok: string) => { setBusy(true); try { await fn(); toast(ok); } catch (e) { toast('Action impossible', readable(e), 'r'); } finally { setBusy(false); } };
  const S = p?.stats, behav = new Map((p?.behav ?? []).map((b) => [b.mint, b]));
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Fiche créateur" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ts-modal-box cr-sheet">
        <button type="button" className="ts-x" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="cr-sheet-h">
          <ScoreBadge p={p} size="lg" />
          <div className="cr-sheet-t"><b>{f ? creatorName(f) : 'Créateur'}</b>
            <span className="mono">{shortAddr(address)} <CopyBtn text={address} label="Copier l'adresse du créateur" /></span>
            <a href={'https://pump.fun/profile/' + address} target="_blank" rel="noopener noreferrer">Profil pump.fun ↗</a></div>
        </div>

        {err ? <div className="ts-note bad">{err}</div> : !p ? <div className="empty"><b>Analyse de ses tokens…</b></div> : (<>
          <ul className="cr-reasons">{p.reasons.map((r, i) => <li key={i} className={r.k}><i aria-hidden="true" />{r.t}</li>)}</ul>
          <div className="cr-kpis">
            <div><small>Tokens créés</small><b className="mono">{S!.count}</b><span className="dim">{S!.week} cette semaine</span></div>
            <div><small>Migrés</small><b className="mono">{S!.migrated}</b><span className="dim">{pct(S!.migRate)} des {S!.sample} derniers</span></div>
            <div><small>Sommet médian</small><b className="mono">{fCompact(S!.athMedian)}</b><span className="dim">meilleur {fCompact(S!.athBest)}</span></div>
            <div><small>Première vente</small><b className="mono">{S!.sellMedianMin == null ? 'jamais' : mins(S!.sellMedianMin)}</b><span className="dim">après le lancement (médiane)</span></div>
            <div><small>Achat de départ</small><b>{S!.devBuyMedian == null ? '—' : <Sol v={S!.devBuyMedian} d={2} />}</b><span className="dim">médiane, 6 derniers</span></div>
            <div><small>Résultat du créateur</small><b className={S!.pnlSol >= 0 ? 'up' : 'down'}><Sol v={S!.pnlSol} d={2} /></b><span className="dim">ventes − achats, 6 derniers</span></div>
          </div>
          <p className="dim cr-disclaim">Note indicative calculée sur ses 50 derniers tokens : elle ne garantit rien sur le prochain.</p>

          <div className="tr-table-wrap cr-coins-wrap">
            <table className="tr-table cr-coins">
              <thead><tr><th>Token</th><th>Lancé</th><th className="num">Sommet</th><th className="num">Capi.</th><th className="hide-s">Créateur</th></tr></thead>
              <tbody>{p.coins.map((c) => { const b = behav.get(c.mint); return (
                <tr key={c.mint} tabIndex={0} onClick={() => onOpen(c.mint)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(c.mint); }}>
                  <td><span className="cr-coin"><TokenLogo src={c.image} mint={c.mint} name={c.symbol} size={26} /><b>{c.symbol}</b>{c.complete && <em className="tr-badge g">migré</em>}</span></td>
                  <td className="dim">{c.created ? age(c.created) : '—'}</td>
                  <td className="num mono">{fCompact(c.ath)}</td>
                  <td className="num mono">{fCompact(c.mcUsd)}</td>
                  <td className="hide-s dim">{!b ? '' : b.sellAfterMin == null ? 'garde' : 'vend après ' + mins(b.sellAfterMin) + (b.soldPct != null ? ' · ' + Math.round(b.soldPct) + ' %' : '')}</td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
          <CreatorBuyersSection address={address} onOpen={onOpen} />
        </>)}

        <div className="cr-sheet-f">
          {f ? (<>
            <label className="cr-name"><span className="sg-lbl">Nom</span><input value={label ?? ''} maxLength={32} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if ((label ?? '') !== (f.label ?? '')) run(() => updateCreator(f.id, { label: (label ?? '').trim() || null }), 'Nom enregistré'); }} placeholder={shortAddr(address)} /></label>
            <label className="sg-check"><input type="checkbox" checked={f.alerts} disabled={busy} onChange={() => run(() => updateCreator(f.id, { alerts: !f.alerts }), f.alerts ? 'Alertes coupées' : 'Alertes activées')} /><span>M'avertir à chaque lancement</span></label>
            <button type="button" className="btn sm primary" onClick={() => { onClose(); openSnipe({ creator: address, name: creatorName(f) }); }}>Achat automatique</button>
            <button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => run(() => unfollow(f.id), 'Créateur retiré')}>Ne plus suivre</button>
          </>) : <button type="button" className="btn primary" disabled={busy || !list} onClick={() => run(() => follow(address), 'Créateur suivi')}>Suivre ce créateur</button>}
        </div>
      </div>
    </div>
  );
}
