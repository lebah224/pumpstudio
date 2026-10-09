import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marketList, tokenInfo, type Row, type Tab } from './api';
import { age, fCompact, fNum, fPct, fPrice, tone } from './format';
import { solUsd, useLiveNew, useLiveTrades, type LiveMsg } from './live';
import { TokenLogo, useFavs, Star } from './bits';

type View = Tab | 'favs';
const TABS: { id: View; l: string; hint: string }[] = [
  { id: 'trending', l: 'Tendance', hint: 'Les paires Solana les plus actives en ce moment (GeckoTerminal).' },
  { id: 'new', l: 'Nouveaux', hint: 'Les derniers tokens créés sur pump.fun, en direct.' },
  { id: 'graduating', l: 'Bientôt migrés', hint: 'Courbes pump.fun les plus avancées, encore échangées ces 3 dernières heures.' },
  { id: 'migrated', l: 'Migrés', hint: 'Tokens récents dont la courbe est terminée : ils s\'échangent sur PumpSwap.' },
  { id: 'favs', l: 'Favoris', hint: 'Vos tokens suivis, enregistrés dans ce navigateur.' },
];
type SortKey = 'age' | 'price' | 'mc' | 'liq' | 'vol' | 'm5' | 'h1' | 'h24' | 'tx' | 'prog';
const COLS: { k: SortKey; l: string; cls?: string; title: string }[] = [
  { k: 'age', l: 'Âge', title: 'Âge du token' }, { k: 'price', l: 'Prix', cls: 'hide-s', title: 'Prix en dollars' },
  { k: 'mc', l: 'Capi.', title: 'Capitalisation' }, { k: 'liq', l: 'Liquidité', cls: 'hide-m', title: 'Liquidité de la paire' },
  { k: 'vol', l: 'Vol. 24 h', cls: 'hide-s', title: 'Volume sur 24 heures' }, { k: 'm5', l: '5 min', cls: 'hide-l', title: 'Variation sur 5 minutes' },
  { k: 'h1', l: '1 h', title: 'Variation sur 1 heure' }, { k: 'h24', l: '24 h', cls: 'hide-s', title: 'Variation sur 24 heures' },
  { k: 'tx', l: 'Achats / ventes 1 h', cls: 'hide-m', title: 'Nombre d\'achats et de ventes sur 1 heure' }, { k: 'prog', l: 'Courbe', cls: 'hide-s', title: 'Avancement de la courbe pump.fun' },
];
const val = (r: Row, k: SortKey): number => {
  const v = k === 'age' ? -(r.created ?? 0) : k === 'price' ? r.priceUsd : k === 'mc' ? r.mcUsd : k === 'liq' ? r.liqUsd : k === 'vol' ? r.vol.h24
    : k === 'm5' ? r.chg.m5 : k === 'h1' ? r.chg.h1 : k === 'h24' ? r.chg.h24 : k === 'tx' ? (r.tx1.b ?? 0) + (r.tx1.s ?? 0) : r.progress;
  return v == null || !isFinite(v) ? -Infinity : v;
};
const REFRESH: Record<View, number> = { trending: 20_000, new: 5_000, graduating: 8_000, migrated: 10_000, favs: 15_000 };

/** Signaux rapides, sans appel supplémentaire : à compléter par l'analyse détaillée de la fiche */
function badges(r: Row, now: number) {
  const out: { t: string; k: 'g' | 'a' | 'r' | 'b'; title: string }[] = [];
  if (r.created && now - r.created < 10 * 60_000) out.push({ t: 'Nouveau', k: 'b', title: 'Créé il y a moins de 10 minutes' });
  if (r.complete && r.liqUsd != null && r.liqUsd < 5000) out.push({ t: 'Liquidité faible', k: 'r', title: 'Moins de 5 000 $ de liquidité : prix très instable' });
  if (!r.links.twitter && !r.links.telegram && !r.links.website) out.push({ t: 'Sans réseaux', k: 'a', title: 'Aucun site, X ou Telegram déclaré' });
  if (r.tx1.b != null && r.tx1.s != null && r.tx1.s > r.tx1.b * 2 && r.tx1.s > 20) out.push({ t: 'Ventes fortes', k: 'r', title: 'Deux fois plus de ventes que d\'achats sur 1 heure' });
  return out;
}

export function MarketList({ onOpen, visible, query }: { onOpen: (r: Row) => void; visible: boolean; query: string }) {
  const [view, setView] = useState<View>(() => { try { const v = localStorage.getItem('ts-trader-tab') as View; return TABS.some((t) => t.id === v) ? v : 'trending'; } catch { return 'trending'; } });
  const [data, setData] = useState<Partial<Record<View, Row[]>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({});
  const favs = useFavs();
  const liveRows = useRef<Map<string, Row>>(new Map());     // nouveaux tokens arrivés par le flux, avant la prochaine liste serveur
  const pending = useRef<Map<string, Partial<Row>>>(new Map());

  const pick = (v: View) => { setView(v); setSort(null); try { localStorage.setItem('ts-trader-tab', v); } catch { /* stockage indisponible */ } };

  const load = useCallback(async (v: View) => {
    try {
      let rows: Row[];
      if (v === 'favs') rows = (await Promise.all(favs.list.slice(0, 30).map((m) => tokenInfo(m).catch(() => null)))).filter(Boolean) as Row[];
      else rows = (await marketList(v)).rows;
      setData((d) => ({ ...d, [v]: rows })); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [favs.list]);
  useEffect(() => {
    if (!visible) return;
    load(view);
    const id = setInterval(() => { if (!document.hidden) load(view); }, REFRESH[view]);
    return () => clearInterval(id);
  }, [view, visible, load]);
  useEffect(() => { if (!visible) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [visible]);

  const base = data[view];
  const rows = useMemo(() => {
    let list = base ? [...base] : [];
    if (view === 'new') {
      const have = new Set(list.map((r) => r.mint));
      const extra = [...liveRows.current.values()].filter((r) => !have.has(r.mint) && now - (r.created ?? 0) < 90_000);
      list = [...extra, ...list];
    }
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q) || r.mint.toLowerCase() === q);
    if (sort) list.sort((a, b) => (val(a, sort.k) - val(b, sort.k)) * sort.d);
    return list;
  }, [base, view, query, sort, now]);

  // transactions en direct des 40 premières lignes : prix et capitalisation à jour à chaque échange
  const top = useMemo(() => rows.slice(0, 40).filter((r) => r.pump).map((r) => r.mint), [rows]);
  const onTrade = useCallback((m: LiveMsg) => {
    const rate = solUsd(); if (!m.mcSol || !rate) return;
    pending.current.set(m.mint, { mcUsd: m.mcSol * rate, priceUsd: (m.mcSol * rate) / 1e9, priceSol: m.mcSol / 1e9, lastTrade: Date.now() });
    setFlash((f) => ({ ...f, [m.mint]: m.kind === 'sell' ? 'down' : 'up' }));
  }, []);
  useLiveTrades('list', top, onTrade, visible);
  // les mises à jour sont appliquées par lots (4 fois par seconde) pour garder un défilement fluide
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      if (pending.current.size) {
        const p = new Map(pending.current); pending.current.clear();
        setData((d) => { const L = d[view]; if (!L) return d; return { ...d, [view]: L.map((r) => (p.has(r.mint) ? { ...r, ...p.get(r.mint)! } : r)) }; });
        p.forEach((v, k) => { const r = liveRows.current.get(k); if (r) liveRows.current.set(k, { ...r, ...v }); });
      }
      setFlash((f) => (Object.keys(f).length ? {} : f));
    }, 250);
    return () => clearInterval(id);
  }, [visible, view]);
  const onNew = useCallback((m: LiveMsg) => {
    const rate = solUsd();
    liveRows.current.set(m.mint, {
      mint: m.mint, name: m.name || '', symbol: m.symbol || '', image: null, created: Date.now(), dex: 'pumpfun', pump: true, complete: false, progress: 0,
      priceUsd: m.mcSol && rate ? (m.mcSol * rate) / 1e9 : null, priceSol: m.mcSol ? m.mcSol / 1e9 : null, mcUsd: m.mcSol && rate ? m.mcSol * rate : null,
      liqUsd: null, supply: 1e9, vol: { m5: null, h1: null, h24: null }, chg: { m5: null, h1: null, h24: null }, tx: { b: null, s: null }, tx1: { b: null, s: null },
      pair: null, creator: m.wallet || null, links: {}, lastTrade: Date.now(), ath: null,
    });
    if (liveRows.current.size > 40) liveRows.current.delete(liveRows.current.keys().next().value!);
  }, []);
  useLiveNew(onNew, visible && view === 'new');

  const sortBy = (k: SortKey) => setSort((s) => (s && s.k === k ? (s.d === -1 ? { k, d: 1 } : null) : { k, d: -1 }));
  const hint = TABS.find((t) => t.id === view)!.hint;

  return (
    <div className="tr-market card">
      <div className="tr-tabs" role="tablist" aria-label="Listes du marché">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={view === t.id} className={view === t.id ? 'on' : ''} onClick={() => pick(t.id)}>
            {t.id === 'favs' && <Star on={view === 'favs'} />}{t.l}{t.id === 'favs' && favs.list.length > 0 && <em>{favs.list.length}</em>}
          </button>
        ))}
        <span className="tr-tabs-hint">{hint}</span>
      </div>
      {err && <div className="ts-note bad" role="alert" style={{ margin: '0 0 10px' }}>{err}</div>}
      <div className="tr-table-wrap">
        <table className="tr-table">
          <thead>
            <tr>
              <th className="tr-c-fav" aria-label="Favori" />
              <th className="tr-c-tok">Token</th>
              {COLS.map((c) => (
                <th key={c.k} className={'num ' + (c.cls ?? '')} title={c.title} aria-sort={sort?.k === c.k ? (sort.d === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => sortBy(c.k)}>{c.l}{sort?.k === c.k && <span aria-hidden="true">{sort.d === 1 ? ' ↑' : ' ↓'}</span>}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!base && !err && Array.from({ length: 8 }, (_, i) => <tr key={i} className="tr-skel"><td colSpan={12}><span /></td></tr>)}
            {base && !rows.length && <tr><td colSpan={12} className="tr-empty">{view === 'favs' ? 'Aucun favori : cliquez sur l\'étoile d\'un token pour le suivre ici.' : query ? 'Aucun token ne correspond à « ' + query + ' ».' : 'Aucun token pour l\'instant.'}</td></tr>}
            {rows.map((r) => {
              const f = flash[r.mint], b = badges(r, now);
              return (
                <tr key={r.mint} className={f ? 'fl-' + f : ''} onClick={() => onOpen(r)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r); }}>
                  <td className="tr-c-fav"><button type="button" className="tr-fav" aria-label={favs.has(r.mint) ? 'Retirer des favoris' : 'Ajouter aux favoris'} aria-pressed={favs.has(r.mint)} onClick={(e) => { e.stopPropagation(); favs.toggle(r.mint); }}><Star on={favs.has(r.mint)} /></button></td>
                  <td className="tr-c-tok">
                    <div className="tr-tok">
                      <TokenLogo src={r.image} name={r.symbol || r.name} />
                      <div className="tr-tok-t">
                        <b>{r.symbol || '—'}<span className="tr-tok-n">{r.name}</span></b>
                        <small>{b.slice(0, 2).map((x) => <em key={x.t} className={'tr-badge ' + x.k} title={x.title}>{x.t}</em>)}{!b.length && <span className="dim mono">{r.mint.slice(0, 4)}…{r.mint.slice(-4)}</span>}</small>
                      </div>
                    </div>
                  </td>
                  <td className="num mono dim">{age(r.created, now)}</td>
                  <td className="num mono tr-px hide-s">{fPrice(r.priceUsd, '$')}</td>
                  <td className="num mono">{fCompact(r.mcUsd)}</td>
                  <td className="num mono hide-m">{fCompact(r.liqUsd)}</td>
                  <td className="num mono hide-s">{fCompact(r.vol.h24)}</td>
                  <td className={'num mono hide-l ' + tone(r.chg.m5)}>{fPct(r.chg.m5)}</td>
                  <td className={'num mono ' + tone(r.chg.h1)}>{fPct(r.chg.h1)}</td>
                  <td className={'num mono hide-s ' + tone(r.chg.h24)}>{fPct(r.chg.h24)}</td>
                  <td className="num mono hide-m"><span className="up">{fNum(r.tx1.b)}</span><span className="dim"> / </span><span className="down">{fNum(r.tx1.s)}</span></td>
                  <td className="num hide-s">{r.progress == null ? <span className="dim">—</span> : r.complete ? <span className="tr-badge g" title={'Échangé sur ' + (r.dex || 'un DEX')}>{dexLabel(r.dex)}</span>
                    : <span className="tr-prog" title={'Courbe à ' + r.progress.toFixed(1).replace('.', ',') + ' %'}><span className="tr-bar"><i style={{ width: r.progress + '%' }} /></span><b className="mono">{Math.floor(r.progress)} %</b></span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export const dexLabel = (d: string | null) => ({ pumpswap: 'PumpSwap', 'pump-fun': 'pump.fun', pumpfun: 'pump.fun', raydium: 'Raydium', 'raydium-clmm': 'Raydium', 'raydium-cp': 'Raydium', meteora: 'Meteora', 'meteora-dlmm': 'Meteora', 'meteora-damm-v2': 'Meteora', orca: 'Orca' } as Record<string, string>)[d ?? ''] ?? (d ? d[0]!.toUpperCase() + d.slice(1) : 'DEX');
