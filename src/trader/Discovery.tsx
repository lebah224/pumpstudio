import { useState } from 'react';
import { toast } from '../legacy/bridge';
import { readable } from '../auth/SignIn';
import { Sol } from '../ui/Sol';
import { age } from './format';
import { TokenLogo } from './bits';
import { shortAddr } from './creators';
import { openTrader, track, useCreatorBuyers, useDiscover, useTokenBuyers, useTracked, type TopBuyer } from './traders';
import '../styles/creators.css';

// Découverte : meilleurs acheteurs d'un token, du moment, et des lancements d'un créateur.
// Chaque wallet s'ouvre sur sa fiche et se suit en un geste.
const secs = (s: number | null) => (s == null ? '—' : s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h');
const signed = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const roiTxt = (r: number | null) => (r == null ? '' : (r >= 0 ? '+' : '') + Math.round(r * 100).toLocaleString('fr-FR') + ' %');

/** Bouton « Suivre » : une fois suivi, le wallet arrive dans « Acheteurs suivis » avec ses achats en direct */
function FollowBtn({ address, tracked }: { address: string; tracked: Set<string> | null }) {
  const [busy, setBusy] = useState(false);
  if (tracked?.has(address)) return <span className="tr-badge g">Suivi</span>;
  return (
    <button type="button" className="btn sm" disabled={busy || !tracked} aria-label={'Suivre le wallet ' + shortAddr(address)}
      onClick={async (e) => { e.stopPropagation(); setBusy(true); try { await track(address); toast('Wallet suivi', shortAddr(address) + ' · ses achats arrivent dans « Acheteurs suivis ».', 'g'); } catch (er) { toast('Ajout impossible', readable(er), 'r'); } finally { setBusy(false); } }}>
      {busy ? '…' : 'Suivre'}</button>
  );
}
const useTrackedSet = () => { const l = useTracked(); return l ? new Set(l.map((x) => x.address)) : null; };
function WalletCell({ address, robot, creator }: { address: string; robot?: boolean; creator?: boolean }) {
  return (
    <span className="dc-w">
      <button type="button" className="tr-wbtn mono" onClick={(e) => { e.stopPropagation(); openTrader(address); }} title="Fiche de cet acheteur : résultats, style, suivi">{shortAddr(address)}</button>
      {creator && <em className="tr-badge a" title="Ce wallet a créé le token">Créateur</em>}
      {robot && <em className="tr-badge" title="Achète dans les 3 premières secondes : un robot, très difficile à copier">Robot</em>}
    </span>
  );
}

/** Onglet « Meilleurs acheteurs » de la fiche d'un token */
export function TokenBuyersPanel({ mint, pump }: { mint: string; pump: boolean }) {
  const { d, err, busy, reload } = useTokenBuyers(pump ? mint : null);
  const tracked = useTrackedSet();
  if (!pump) return <div className="empty"><b>Analyse indisponible</b><span>Les résultats par acheteur sont calculés pour les tokens pump.fun et PumpSwap.</span></div>;
  if (!d) return err ? <div className="empty"><b>Analyse indisponible</b><span>{err}</span></div> : <div className="empty"><b>Lecture des acheteurs…</b><span>Premiers entrés, plus gros acheteurs et vendeurs du moment : une dizaine de secondes.</span></div>;
  if (!d.buyers.length) return <div className="empty"><b>Aucun acheteur notable</b><span>Pas d'achat d'au moins 0,02 SOL trouvé sur ce token.</span></div>;
  return (<>
    <div className="tr-table-wrap dc-wrap">
      <table className="tr-table cr-coins dc-t">
        <thead><tr>
          <th>Wallet</th><th className="num hide-s">Misé</th><th className="num">Résultat</th><th className="num hide-m">Encaissé</th>
          <th className="hide-s">Entrée</th><th className="hide-m">Garde</th><th aria-label="Suivre" />
        </tr></thead>
        <tbody>{d.buyers.map((b) => (
          <tr key={b.address} tabIndex={0} onClick={() => openTrader(b.address)} onKeyDown={(e) => { if (e.key === 'Enter') openTrader(b.address); }}>
            <td><WalletCell address={b.address} robot={b.sniper} creator={b.creator} /></td>
            <td className="num mono hide-s"><Sol v={b.buySol} d={2} stack /></td>
            <td className={'num mono ' + signed(b.pnl)}><Sol v={b.pnl} d={2} stack />{b.roi != null && <small> {roiTxt(b.roi)}</small>}</td>
            <td className={'num mono hide-m ' + signed(b.realized)}>{b.sellSol > 0 ? <Sol v={b.realized} d={2} stack /> : <span className="dim">—</span>}</td>
            <td className="hide-s dim">{b.rank === 1 ? '1er · ' : b.rank + 'e · '}{secs(b.entrySec)}</td>
            <td className="hide-m dim">{Math.round(b.holdPct)} %</td>
            <td className="dc-act"><FollowBtn address={b.address} tracked={tracked} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    <p className="dim cr-disclaim dc-foot">
      Résultat = ventes + valeur au prix actuel de ce qu'il garde − achats. Calculé sur {d.buyers.length} wallets parmi les premiers entrés, les plus gros acheteurs et les vendeurs récents.
      <button type="button" className="btn sm ghost" disabled={busy} onClick={reload}>{busy ? 'Actualisation…' : 'Actualiser'}</button>
    </p>
  </>);
}

/** Tableau de wallets classés sur plusieurs tokens (classement du moment, acheteurs d'un créateur) */
function TopBuyersTable({ rows, tracked, onOpen, col }: { rows: TopBuyer[]; tracked: Set<string> | null; onOpen: (mint: string) => void; col: 'wins' | 'count' }) {
  return (
    <div className="tr-table-wrap dc-wrap">
      <table className="tr-table cr-coins dc-t">
        <thead><tr>
          <th>Wallet</th><th className="num">{col === 'wins' ? 'Gagnants' : 'Lancements'}</th><th className="num">Résultat</th><th className="num hide-s">Misé</th>
          <th className="hide-s">Entrée</th><th className="hide-m">Tokens</th><th aria-label="Suivre" />
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.address} tabIndex={0} onClick={() => openTrader(r.address)} onKeyDown={(e) => { if (e.key === 'Enter') openTrader(r.address); }}>
            <td><WalletCell address={r.address} robot={r.sniper} /></td>
            <td className="num mono">{col === 'wins' ? r.wins + ' / ' + r.count : r.count + (r.wins ? ' · ' + r.wins + ' gagnant' + (r.wins > 1 ? 's' : '') : '')}</td>
            <td className={'num mono ' + signed(r.pnl)}><Sol v={r.pnl} d={2} stack />{r.roi != null && <small> {roiTxt(r.roi)}</small>}</td>
            <td className="num mono hide-s"><Sol v={r.invested} d={2} stack /></td>
            <td className="hide-s dim">{secs(r.entryMedianSec)}</td>
            <td className="hide-m"><span className="dc-toks">{r.tokens.slice(0, 4).map((t) => (
              <button key={t.mint} type="button" className={'dc-tok ' + signed(t.pnl)} onClick={(e) => { e.stopPropagation(); onOpen(t.mint); }} title={'Ouvrir ' + (t.symbol || 'le token')}>{t.symbol || shortAddr(t.mint)}</button>
            ))}{r.tokens.length > 4 && <span className="dim">+{r.tokens.length - 4}</span>}</span></td>
            <td className="dc-act"><FollowBtn address={r.address} tracked={tracked} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Section « Meilleurs acheteurs du moment » de la page Acheteurs */
export function DiscoverSection({ onOpen }: { onOpen: (mint: string) => void }) {
  const { d, err, busy, reload } = useDiscover();
  const tracked = useTrackedSet();
  const [robots, setRobots] = useState(false);
  const rows = d ? d.rows.filter((r) => robots || !r.sniper) : null;
  const hidden = d ? d.rows.length - (rows?.length ?? 0) : 0;
  return (
    <section className="card dc-sec">
      <div className="cr-h dc-h">
        <b>Meilleurs acheteurs du moment</b>
        <span className="dim">tokens qui marchent, 3 derniers jours{d ? ' · il y a ' + age(d.at) : ''}</span>
        <span className="dc-tools">
          <label className="sg-check"><input type="checkbox" checked={robots} onChange={() => setRobots(!robots)} /><span>Afficher les robots{hidden ? ' (' + hidden + ')' : ''}</span></label>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={reload}>{busy ? 'Analyse…' : 'Actualiser'}</button>
        </span>
      </div>
      {!d ? (err ? <div className="empty"><b>Classement indisponible</b><span>{err}</span></div>
        : <div className="empty"><b>Analyse des tokens qui marchent…</b><span>Chaque acheteur est vérifié sur tout son historique du token : jusqu'à une trentaine de secondes la première fois.</span></div>)
        : (<>
          {!!d.tokens.length && <div className="dc-src"><span className="dim">Tokens analysés</span>{d.tokens.map((t) => (
            <button key={t.mint} type="button" className="dc-chip" onClick={() => onOpen(t.mint)}><TokenLogo src={t.image} name={t.symbol || '?'} size={18} />{t.symbol || shortAddr(t.mint)}</button>
          ))}</div>}
          {!rows!.length ? <div className="empty"><b>Aucun gagnant hors robots pour l'instant</b><span>{hidden ? 'Cochez « Afficher les robots » pour voir les ' + hidden + ' wallets qui achètent dans les premières secondes.' : 'Réessayez dans quelques minutes.'}</span></div>
            : <TopBuyersTable rows={rows!} tracked={tracked} onOpen={onOpen} col="wins" />}
          <p className="dim cr-disclaim">Un gagnant a au moins 0,05 SOL et 20 % de gain sur le token (ventes + valeur actuelle de ce qu'il garde). Passé ne vaut pas promesse : ouvrez la fiche d'un wallet pour voir ses 100 derniers échanges avant de le suivre.</p>
        </>)}
    </section>
  );
}

/** Section « Acheteurs de ses lancements » de la fiche d'un créateur */
export function CreatorBuyersSection({ address, onOpen }: { address: string; onOpen: (mint: string) => void }) {
  const { d, err } = useCreatorBuyers(address);
  const tracked = useTrackedSet();
  return (
    <div className="dc-cr">
      <div className="cr-h"><b>Acheteurs de ses lancements</b><span className="dim">{d ? (d.tokens.length > 1 ? 'sur ses ' + d.tokens.length + ' derniers tokens' : 'sur son dernier token') : ''}</span></div>
      {!d ? (err ? <div className="ts-note bad">{err}</div> : <div className="empty"><b>Analyse des acheteurs de ses tokens…</b></div>) : (<>
        {d.recurring.length ? (<>
          <p className="dim cr-disclaim">Wallets présents sur plusieurs de ses lancements : des habitués, parfois des proches du créateur.</p>
          <TopBuyersTable rows={d.recurring} tracked={tracked} onOpen={onOpen} col="count" />
        </>) : <p className="dim cr-disclaim">Aucun wallet n'achète régulièrement ses lancements.</p>}
        {!!d.best.length && (<>
          <p className="dim cr-disclaim">Ceux qui ont le plus gagné sur ses tokens :</p>
          <TopBuyersTable rows={d.best} tracked={tracked} onOpen={onOpen} col="wins" />
        </>)}
      </>)}
    </div>
  );
}
