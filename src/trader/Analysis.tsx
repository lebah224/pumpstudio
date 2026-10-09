import { useEffect, useState, type ReactNode } from 'react';
import type { Analysis, TokenInfo } from './api';
import { age, fCompact, fPct, fTok, short } from './format';
import { CopyBtn, TokenLogo } from './bits';
import { Sol } from '../ui/Sol';

const solscan = (k: 'tx' | 'account', id: string) => 'https://solscan.io/' + k + '/' + id;
type Lvl = 'g' | 'a' | 'r' | 'b';
const ICON: Record<Lvl, ReactNode> = {
  g: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  a: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.5" /><path d="M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>,
  r: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>,
  b: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></svg>,
};
function Check({ lvl, t, d }: { lvl: Lvl; t: ReactNode; d?: ReactNode }) {
  return <li className={'an-chk ' + lvl}><span className="an-ic">{ICON[lvl]}</span><span><b>{t}</b>{d && <small>{d}</small>}</span></li>;
}

// risques RugCheck : traduction des intitulés courants, l'anglais d'origine sinon
const RISK_FR: Record<string, string> = {
  'Mutable metadata': 'Métadonnées modifiables', 'Freeze Authority still enabled': 'Autorité de gel encore active', 'Mint Authority still enabled': 'Création de nouveaux tokens encore possible',
  'Top 10 holders high ownership': 'Top 10 très concentré', 'Single holder ownership': 'Un seul wallet détient une grosse part', 'High holder concentration': 'Détention très concentrée',
  'Low Liquidity': 'Liquidité faible', 'Large Amount of LP Unlocked': 'Liquidité en grande partie non verrouillée', 'Low amount of LP Providers': 'Peu de fournisseurs de liquidité',
  'Creator history of rugged tokens': 'Le créateur a déjà abandonné des tokens', 'Copycat token': 'Copie d\'un token connu', 'Low amount of holders': 'Peu de détenteurs',
  'High amount of insiders': 'Beaucoup de wallets d\'initiés', 'Insiders detected': 'Wallets d\'initiés détectés', 'Rugged': 'Token abandonné (rug)', 'Transfer fee': 'Frais sur chaque transfert',
  'Permanent Delegate': 'Délégué permanent', 'Unknown creator': 'Créateur inconnu', 'Creator sold': 'Le créateur a vendu',
};
const lvlOf = (l: string): Lvl => (l === 'danger' ? 'r' : l === 'warn' ? 'a' : 'b');

/** Verdict global à partir des contrôles : le pire niveau l'emporte */
export function verdict(a: Analysis | null, info: TokenInfo | null): { lvl: Lvl; label: string } | null {
  if (!a || !a.source) return null;
  const L = checks(a, info);
  const r = L.filter((c) => c.lvl === 'r').length, w = L.filter((c) => c.lvl === 'a').length;
  return a.rugged || r >= 2 ? { lvl: 'r', label: 'Risque élevé' } : r || w >= 2 ? { lvl: 'a', label: 'Prudence' } : { lvl: 'g', label: 'Bons signaux' };
}
function checks(a: Analysis, info: TokenInfo | null): { lvl: Lvl; t: string; d: string }[] {
  const out: { lvl: Lvl; t: string; d: string }[] = [];
  if (a.rugged) out.push({ lvl: 'r', t: 'Token signalé comme abandonné (rug)', d: 'La liquidité a été retirée ou le projet est mort.' });
  out.push(a.mintAuthority ? { lvl: 'r', t: 'Création de nouveaux tokens possible', d: 'Une adresse peut encore créer des tokens et diluer les détenteurs.' } : { lvl: 'g', t: 'Offre figée', d: 'Plus personne ne peut créer de nouveaux tokens.' });
  out.push(a.freezeAuthority ? { lvl: 'r', t: 'Gel des comptes possible', d: 'Une adresse peut bloquer votre solde et vous empêcher de vendre.' } : { lvl: 'g', t: 'Pas de gel possible', d: 'Personne ne peut bloquer vos tokens.' });
  if (a.mutable != null) out.push(a.mutable ? { lvl: 'a', t: 'Nom et logo modifiables', d: 'Le créateur peut changer le nom, le ticker ou le logo.' } : { lvl: 'g', t: 'Nom et logo définitifs', d: 'Les métadonnées ne peuvent plus être modifiées.' });
  const D = a.danger, bad = [D.permanentDelegate && 'délégué permanent (peut déplacer vos tokens)', D.transferHook && 'programme appelé à chaque transfert', D.nonTransferable && 'tokens non transférables', D.frozenDefault && 'comptes gelés par défaut', a.transferFee > 0 && 'frais de ' + a.transferFee + ' % sur chaque transfert'].filter(Boolean);
  out.push(bad.length ? { lvl: 'r', t: 'Fonctions Token-2022 dangereuses', d: bad.join(', ') + '.' } : { lvl: 'g', t: 'Aucune fonction cachée', d: (a.program || 'Programme') + ' sans frais de transfert ni délégué permanent.' });
  if (info?.complete) out.push(a.lpLockedPct != null && a.lpLockedPct >= 95 ? { lvl: 'g', t: 'Liquidité verrouillée à ' + Math.round(a.lpLockedPct) + ' %', d: 'Le créateur ne peut pas retirer la liquidité du pool.' } : { lvl: a.lpLockedPct != null && a.lpLockedPct < 50 ? 'r' : 'a', t: 'Liquidité verrouillée à ' + (a.lpLockedPct == null ? '?' : Math.round(a.lpLockedPct)) + ' %', d: 'Une partie de la liquidité peut être retirée.' });
  else out.push({ lvl: 'b', t: 'Liquidité dans la courbe pump.fun', d: 'Tant que la courbe n\'est pas terminée, personne ne peut retirer la liquidité.' });
  out.push(a.top10 > 40 ? { lvl: 'r', t: 'Top 10 : ' + fPct(a.top10).replace('+', ''), d: 'Très concentré : quelques wallets contrôlent le prix (pools exclus).' } : a.top10 > 25 ? { lvl: 'a', t: 'Top 10 : ' + fPct(a.top10).replace('+', ''), d: 'Concentration moyenne (pools exclus).' } : { lvl: 'g', t: 'Top 10 : ' + fPct(a.top10).replace('+', ''), d: 'Bonne répartition (pools exclus).' });
  const C = a.creator;
  if (C && C.pct != null) out.push(C.pct > 10 ? { lvl: 'r', t: 'Créateur : ' + fPct(C.pct).replace('+', '') + ' de l\'offre', d: 'Il peut faire chuter le prix en vendant.' } : C.pct > 3 ? { lvl: 'a', t: 'Créateur : ' + fPct(C.pct).replace('+', '') + ' de l\'offre', d: 'Part notable du créateur.' } : { lvl: 'g', t: 'Créateur : ' + fPct(C.pct).replace('+', '') + ' de l\'offre', d: C.pct === 0 ? 'Il ne détient plus rien.' : 'Part limitée.' });
  if (C && C.sold.n) out.push({ lvl: C.balance === 0 ? 'a' : 'b', t: 'Le créateur a vendu ' + C.sold.sol.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' SOL', d: C.sold.n + ' vente' + (C.sold.n > 1 ? 's' : '') + ' sur ce token.' });
  if (a.insiders.wallets > 0) out.push({ lvl: a.insiders.wallets > 15 ? 'r' : 'a', t: a.insiders.wallets + ' wallets d\'initiés', d: a.insiders.networks + ' groupe' + (a.insiders.networks > 1 ? 's' : '') + ' de wallets liés entre eux (transferts communs).' });
  if (a.totalHolders != null) out.push(a.totalHolders < 100 ? { lvl: 'a', t: fTok(a.totalHolders) + ' détenteurs', d: 'Encore peu de détenteurs.' } : { lvl: 'g', t: a.totalHolders.toLocaleString('fr-FR') + ' détenteurs', d: 'Communauté déjà large.' });
  return out;
}

export function SecurityPanel({ a, info }: { a: Analysis; info: TokenInfo | null }) {
  if (!a.source) return <div className="empty"><b>Analyse de sécurité indisponible</b><span>RugCheck ne répond pas pour ce token. Réessayez dans un instant.</span></div>;
  const v = verdict(a, info)!, L = checks(a, info);
  return (
    <div className="an-sec">
      <div className={'an-verdict ' + v.lvl}>
        <span className="an-ic">{ICON[v.lvl]}</span>
        <div><b>{v.label}</b><small>{L.filter((c) => c.lvl === 'g').length} points positifs · {L.filter((c) => c.lvl === 'a').length} à surveiller · {L.filter((c) => c.lvl === 'r').length} risques</small></div>
        {a.score != null && <span className="an-score" title="Score de risque RugCheck : plus il est bas, mieux c'est">RugCheck <b className="mono">{Math.round(a.score)}</b></span>}
      </div>
      <ul className="an-list">{L.map((c, i) => <Check key={i} lvl={c.lvl} t={c.t} d={c.d} />)}</ul>
      {a.risks.length > 0 && (<>
        <h4 className="an-h">Alertes RugCheck</h4>
        <ul className="an-list">{a.risks.map((r, i) => <Check key={i} lvl={lvlOf(r.level)} t={(RISK_FR[r.name] ?? r.name) + (r.value ? ' · ' + r.value : '')} d={r.description} />)}</ul>
      </>)}
      <p className="dim an-foot">Analyse automatique (RugCheck et données on-chain), sans garantie : elle ne remplace pas votre propre vérification.</p>
    </div>
  );
}

export function HoldersPanel({ a, priceUsd, creator }: { a: Analysis; priceUsd: number | null; creator: string | null }) {
  if (!a.holders.length) return <div className="empty"><b>Détenteurs indisponibles</b><span>La liste n'a pas pu être lue. Réessayez dans un instant.</span></div>;
  const max = Math.max(...a.holders.map((h) => h.pct), 1);
  return (
    <div>
      <div className="an-kpis">
        <div><span>Détenteurs</span><b className="mono">{a.totalHolders != null ? a.totalHolders.toLocaleString('fr-FR') : '—'}</b></div>
        <div><span>Top 10 (hors pools)</span><b className="mono">{fPct(a.top10).replace('+', '')}</b></div>
        <div><span>Créateur</span><b className="mono">{a.creator?.pct != null ? fPct(a.creator.pct).replace('+', '') : '—'}</b></div>
        <div><span>Wallets d'initiés</span><b className="mono">{a.insiders.wallets}</b></div>
      </div>
      <div className="tr-table-wrap">
        <table className="tr-table an-holders">
          <thead><tr><th>#</th><th>Wallet</th><th className="num">Part</th><th className="num hide-s">Quantité</th><th className="num hide-m">Valeur</th></tr></thead>
          <tbody>
            {a.holders.map((h, i) => (
              <tr key={h.account} className={h.kind === 'AMM' || h.kind === 'LOCKER' ? 'an-pool' : ''}>
                <td className="mono dim">{i + 1}</td>
                <td>
                  <a className="mono" href={solscan('account', h.owner)} target="_blank" rel="noopener noreferrer">{short(h.owner)}</a>
                  {h.label && <em className={'tr-badge ' + (h.kind === 'CREATOR' || h.owner === creator ? 'a' : 'b')}>{h.label}</em>}
                  {h.insider && <em className="tr-badge r" title="Wallet lié à d'autres détenteurs par des transferts">Initié</em>}
                </td>
                <td className="num"><span className="an-pct"><span className="tr-bar"><i style={{ width: (h.pct / max) * 100 + '%' }} /></span><b className="mono">{h.pct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</b></span></td>
                <td className="num mono hide-s">{fTok(h.amount)}</td>
                <td className="num mono hide-m">{priceUsd ? fCompact(h.amount * priceUsd) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim an-foot">Les pools (courbe pump.fun, PumpSwap…) détiennent la liquidité : ils sont exclus du calcul du top 10.</p>
    </div>
  );
}

type Fees = { v: number | null; err: boolean };
export function CreatorPanel({ a, info, onOpen }: { a: Analysis; info: TokenInfo | null; onOpen: (mint: string) => void }) {
  const C = a.creator;
  const [fees, setFees] = useState<Fees | null>(null);
  useEffect(() => {
    if (!C) return;
    let off = false; setFees(null);
    const f = (window.PumpStudio as unknown as { trader?: { creatorFees?: (pk: string) => Promise<number> } } | undefined)?.trader?.creatorFees;
    if (!f) { setFees({ v: null, err: true }); return; }
    f(C.address).then((v) => { if (!off) setFees({ v, err: false }); }).catch(() => { if (!off) setFees({ v: null, err: true }); });
    return () => { off = true; };
  }, [C?.address]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!C) return <div className="empty"><b>Créateur inconnu</b><span>Ce token ne vient pas de pump.fun : son créateur n'est pas identifié.</span></div>;
  const net = C.sold.sol - C.bought.sol;
  const others = C.coins.filter((x) => x.mint !== info?.mint);
  const migrated = C.coins.filter((x) => x.complete).length;
  return (
    <div className="an-creator">
      <div className="an-who">
        <span className="mono"><a href={solscan('account', C.address)} target="_blank" rel="noopener noreferrer">{short(C.address, 6)}</a></span><CopyBtn text={C.address} label="Copier l'adresse du créateur" />
        <a className="tr-badge b" href={'https://pump.fun/profile/' + C.address} target="_blank" rel="noopener noreferrer">Profil pump.fun</a>
      </div>
      <div className="an-kpis">
        <div><span>Solde actuel</span><b className="mono">{C.balance != null ? fTok(C.balance) : '—'}</b><small className="dim">{C.pct != null ? fPct(C.pct).replace('+', '') + ' de l\'offre' : ''}</small></div>
        <div><span>Achat initial</span><b>{C.first && C.first.side === 'buy' ? <Sol v={C.first.sol} d={3} /> : '—'}</b><small className="dim">{C.first ? 'il y a ' + age(C.first.t) : ''}</small></div>
        <div><span>Achats / ventes</span><b className="mono"><span className="up">{C.bought.n}</span> / <span className="down">{C.sold.n}</span></b><small className="dim">{C.bought.sol.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} → {C.sold.sol.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} SOL</small></div>
        <div><span>Résultat sur ce token</span><b className={net >= 0 ? 'up' : 'down'}><Sol v={net} d={3} /></b><small className="dim">ventes moins achats</small></div>
        <div><span>Frais créateur à réclamer</span><b>{!fees ? '…' : fees.err || fees.v == null ? '—' : <Sol v={fees.v} d={4} />}</b><small className="dim">{fees?.err ? 'lecture impossible (RPC)' : 'tous ses tokens'}</small></div>
        <div><span>Tokens créés</span><b className="mono">{C.coinsCount}</b><small className="dim">{migrated} migré{migrated > 1 ? 's' : ''}</small></div>
      </div>

      <h4 className="an-h">Ses autres tokens</h4>
      {!others.length ? <p className="dim">Aucun autre token créé avec ce wallet.</p> : (
        <ul className="an-coins">{others.slice(0, 12).map((x) => (
          <li key={x.mint}><button type="button" onClick={() => onOpen(x.mint)}>
            <TokenLogo src={x.image} name={x.symbol || x.name} size={28} />
            <span className="an-coin-t"><b>{x.symbol}</b><small>{x.name} · il y a {age(x.created)}</small></span>
            <span className="an-coin-v mono">{fCompact(x.mcUsd)}<small>{x.complete ? 'migré' : 'courbe'} · record {fCompact(x.ath)}</small></span>
          </button></li>
        ))}</ul>
      )}

      <h4 className="an-h">Ses transactions sur ce token</h4>
      {!C.trades.length ? <p className="dim">Aucune transaction du créateur trouvée.</p> : (
        <div className="tr-table-wrap">
          <table className="tr-table">
            <thead><tr><th>Quand</th><th>Type</th><th className="num">SOL</th><th className="num hide-s">Tokens</th><th aria-label="Transaction" /></tr></thead>
            <tbody>{C.trades.map((x) => (
              <tr key={x.sig}>
                <td className="mono dim" title={new Date(x.t).toLocaleString('fr-FR')}>il y a {age(x.t)}</td>
                <td><span className={'tr-side-b ' + x.side}>{x.side === 'buy' ? 'Achat' : 'Vente'}</span></td>
                <td className={'num mono ' + (x.side === 'buy' ? 'up' : 'down')}>{x.sol.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</td>
                <td className="num mono hide-s">{fTok(x.tok)}</td>
                <td><a className="tr-tx" href={solscan('tx', x.sig)} target="_blank" rel="noopener noreferrer">Solscan</a></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
