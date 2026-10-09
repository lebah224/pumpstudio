import { useCallback, useEffect, useRef, useState } from 'react';
import { analysis as fetchAnalysis, tokenInfo, tradesOf, type Analysis, type Row, type TokenInfo, type Trade } from './api';
import { age, fCompact, fNum, fPct, fPrice, fTok, short, tone } from './format';
import { solUsd, useLiveTrades, type LiveMsg } from './live';
import { PriceChart, type Tick } from './Chart';
import { TradePanel } from './TradePanel';
import { CopyBtn, Star, TokenLogo, useFavs } from './bits';
import { dexLabel } from './MarketList';
import { CreatorPanel, HoldersPanel, SecurityPanel, verdict } from './Analysis';
import { PriceAlerts } from './alerts';

const EXT = <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg>;
const solscan = (k: 'tx' | 'account' | 'token', id: string) => 'https://solscan.io/' + k + '/' + id;

/** Fiche d'un token : en-tête, graphique en direct, chiffres clés, transactions et panneau de trading */
type Tab = 'tx' | 'sec' | 'holders' | 'creator';
const TABS: { id: Tab; l: string }[] = [{ id: 'tx', l: 'Transactions' }, { id: 'sec', l: 'Sécurité' }, { id: 'holders', l: 'Détenteurs' }, { id: 'creator', l: 'Créateur' }];

export function TokenView({ mint, seed, onBack, onOpen }: { mint: string; seed: Row | null; onBack: () => void; onOpen: (mint: string) => void }) {
  const [info, setInfo] = useState<TokenInfo | null>(seed ? { ...seed, description: '', koth: null, curve: null, dexPair: null } : null);
  const [err, setErr] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [live, setLive] = useState<{ mcSol: number; at: number; dir: 'up' | 'down' } | null>(null);
  const [avg, setAvg] = useState<number | null>(null);
  const [, tick] = useState(0);
  const favs = useFavs();
  const feed = useRef<((x: Tick) => void) | null>(null);
  const seen = useRef(new Set<string>());
  const [tab, setTab] = useState<Tab>('tx');
  const [an, setAn] = useState<Analysis | null>(null);
  const [anErr, setAnErr] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setErr(null); setTrades(null); setLive(null);
    const load = () => tokenInfo(mint).then((t) => { if (!off) setInfo(t); }).catch((e) => { if (!off) setErr((e as Error).message); });
    load();
    seen.current = new Set();
    tradesOf(mint, 60).then((t) => { if (off) return; t.forEach((x) => seen.current.add(x.sig)); setTrades(t); }).catch(() => { if (!off) setTrades([]); });
    setAn(null); setAnErr(null);
    const loadAn = () => fetchAnalysis(mint).then((x) => { if (!off) { setAn(x); setAnErr(null); } }).catch((e) => { if (!off) setAnErr((e as Error).message); });
    loadAn();
    const ia = setInterval(() => { if (!document.hidden) loadAn(); }, 60_000);
    const id = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { off = true; clearInterval(id); clearInterval(t); clearInterval(ia); };
  }, [mint]);

  const pump = info ? info.pump : mint.endsWith('pump');
  const supply = info?.supply ?? 1e9;
  // transactions en direct : ruban, prix et capitalisation de l'en-tête
  const onTrade = useCallback((m: LiveMsg) => {
    if (m.kind === 'migrate') { tokenInfo(mint).then(setInfo).catch(() => {}); return; }
    const rate = solUsd();
    if (m.sig && seen.current.has(m.sig)) return;          // déjà reçue par la relecture
    if (m.sig) seen.current.add(m.sig);
    if (m.mcSol) setLive({ mcSol: m.mcSol, at: Date.now(), dir: m.kind === 'sell' ? 'down' : 'up' });
    feed.current?.({ t: Date.now(), sol: m.sol, mcSol: m.mcSol, pSol: m.mcSol ? null : m.tok > 0 ? m.sol / m.tok : null });
    if (!m.sig) return;
    setTrades((T) => {
      const L = T ?? [];
      if (L.some((x) => x.sig === m.sig)) return L;
      const pSol = m.tok > 0 ? m.sol / m.tok : null;
      return [{ sig: m.sig, t: Date.now(), w: m.wallet, side: m.kind === 'sell' ? 'sell' : 'buy', sol: m.sol, tok: m.tok, usd: rate ? m.sol * rate : null, pSol, pUsd: pSol && rate ? pSol * rate : null, live: true } as Trade, ...L].slice(0, 120);
    });
  }, [mint]);
  useLiveTrades('token', [mint], onTrade, pump);
  // relecture des dernières transactions toutes les 2,5 s (en plus du flux) : le graphique et le ruban bougent même
  // quand le flux en direct ne transmet rien pour ce token (pool PumpSwap, coupure, pare-feu…)
  useEffect(() => {
    let off = false, n = 0;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (!pump && n++ % 2) return;                        // hors pump.fun : toutes les 5 s
      tradesOf(mint, 40).then((list) => {
        if (off || !list.length) return;
        const fresh = list.filter((x) => !seen.current.has(x.sig)).sort((a, b) => a.t - b.t);
        if (!fresh.length) return;
        fresh.forEach((x) => { seen.current.add(x.sig); feed.current?.({ t: x.t, sol: x.sol ?? 0, usd: x.usd, pSol: x.pSol, pUsd: x.pUsd }); });
        const z = fresh[fresh.length - 1]!;
        if (z.pSol) setLive({ mcSol: z.pSol * supply, at: Date.now(), dir: z.side === 'sell' ? 'down' : 'up' });
        setTrades((T) => [...fresh.reverse().map((x) => ({ ...x, live: true })), ...(T ?? [])].slice(0, 120));
      }).catch(() => {});
    }, 2500);
    return () => { off = true; clearInterval(id); };
  }, [mint, pump, supply]);

  const rate = solUsd();
  const mcUsd = live && rate ? live.mcSol * rate : info?.mcUsd ?? null;
  const priceUsd = live && rate ? (live.mcSol * rate) / supply : info?.priceUsd ?? null;
  const priceSol = live ? live.mcSol / supply : info?.priceSol ?? null;
  const sym = info?.symbol || short(mint);
  const onPosition = useCallback((p: { avg: number | null } | null) => setAvg(p?.avg ?? null), []);

  return (
    <div className="tr-token">
      <div className="tr-head card">
        <button type="button" className="btn ghost sm tr-back" onClick={onBack} aria-label="Retour au marché">
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>Marché
        </button>
        <TokenLogo src={info?.image} name={sym} size={46} />
        <div className="tr-head-t">
          <h2>{info?.name || 'Token'} <span className="tr-sym">{sym}</span>
            <button type="button" className="tr-fav" aria-pressed={favs.has(mint)} aria-label={favs.has(mint) ? 'Retirer des favoris' : 'Ajouter aux favoris'} onClick={() => favs.toggle(mint)}><Star on={favs.has(mint)} /></button>
          </h2>
          <div className="tr-head-m">
            <span className="mono tr-addr">{short(mint, 6)}<CopyBtn text={mint} /></span>
            {info?.created && <span title={new Date(info.created).toLocaleString('fr-FR')}>Créé il y a {age(info.created)} · {new Date(info.created).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
            {info && <span className="tr-badge b">{info.complete ? dexLabel(info.dexPair?.dex ?? info.dex) : 'Courbe pump.fun'}</span>}
            {(() => { const v = verdict(an, info); return v ? <button type="button" className={'tr-badge tr-verdict ' + v.lvl} onClick={() => setTab('sec')} title="Voir l'analyse de sécurité">{v.label}</button> : null; })()}
          </div>
        </div>
        <div className={'tr-head-p ' + (live ? 'fl-' + live.dir : '')} key={live?.at}>
          <b className="mono">{fPrice(priceUsd, '$')}</b>
          <span className="mono dim">{fPrice(priceSol, 'SOL')}</span>
          <span className={'mono ' + tone(info?.chg.h24)}>{fPct(info?.chg.h24)} <small className="dim">24 h</small></span>
        </div>
        <nav className="tr-links" aria-label="Liens du token">
          {pump && <a href={'https://pump.fun/coin/' + mint} target="_blank" rel="noopener noreferrer">pump.fun{EXT}</a>}
          <a href={'https://dexscreener.com/solana/' + mint} target="_blank" rel="noopener noreferrer">DEX Screener{EXT}</a>
          <a href={solscan('token', mint)} target="_blank" rel="noopener noreferrer">Solscan{EXT}</a>
          {info?.links.twitter && <a href={info.links.twitter} target="_blank" rel="noopener noreferrer nofollow">X{EXT}</a>}
          {info?.links.telegram && <a href={info.links.telegram} target="_blank" rel="noopener noreferrer nofollow">Telegram{EXT}</a>}
          {info?.links.website && <a href={info.links.website} target="_blank" rel="noopener noreferrer nofollow">Site{EXT}</a>}
        </nav>
      </div>
      {err && !info && <div className="ts-note bad" role="alert">{err}</div>}

      <div className="tr-grid">
        <div className="tr-main">
          <div className="card tr-chart-card">
            <PriceChart mint={mint} created={info?.created ?? null} supply={supply} pump={pump} avgSol={avg} feed={feed} />
          </div>

          <div className="tr-stats card">
            <div><span>Capitalisation</span><b className="mono">{fCompact(mcUsd)}</b></div>
            <div><span>Liquidité</span><b className="mono">{info?.complete ? fCompact(info?.liqUsd) : 'Courbe'}</b></div>
            <div><span>Volume 24 h</span><b className="mono">{fCompact(info?.vol.h24)}</b></div>
            <div><span>Variation 5 min · 1 h</span><b className="mono"><span className={tone(info?.chg.m5)}>{fPct(info?.chg.m5)}</span> · <span className={tone(info?.chg.h1)}>{fPct(info?.chg.h1)}</span></b></div>
            <div><span>Achats / ventes 24 h</span><b className="mono"><span className="up">{fNum(info?.tx.b)}</span> / <span className="down">{fNum(info?.tx.s)}</span></b></div>
            <div><span>Record de capitalisation</span><b className="mono">{fCompact(info?.ath)}</b></div>
            {info && !info.complete && info.progress != null && (
              <div className="tr-stats-prog"><span>Courbe de liaison</span><span className="tr-prog wide"><span className="tr-bar"><i style={{ width: info.progress + '%' }} /></span><b className="mono">{info.progress.toFixed(1).replace('.', ',')} %</b></span><small className="dim">Migration vers PumpSwap à 100 %.</small></div>
            )}
          </div>

          <div className="card tr-tape">
            <div className="tr-tabs tr-tok-tabs" role="tablist" aria-label="Analyse du token">
              {TABS.map((x) => <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>{x.l}{x.id === 'sec' && (() => { const v = verdict(an, info); return v ? <i className={'tr-dot ' + v.lvl} aria-hidden="true" /> : null; })()}</button>)}
              <span className="tr-tabs-hint">{tab === 'tx' ? (pump ? 'En direct, au moment où elles passent sur la blockchain.' : 'Actualisées toutes les 5 secondes.') : 'Analyse actualisée chaque minute.'}</span>
            </div>
            <div className="tr-tab-body">
            {tab !== 'tx' ? (!an ? (anErr ? <div className="empty"><b>Analyse indisponible</b><span>{anErr}</span></div> : <div className="empty"><b>Analyse en cours…</b><span>Sécurité, détenteurs et historique du créateur.</span></div>)
              : tab === 'sec' ? <SecurityPanel a={an} info={info} /> : tab === 'holders' ? <HoldersPanel a={an} priceUsd={priceUsd} creator={info?.creator ?? null} /> : <CreatorPanel a={an} info={info} onOpen={onOpen} />)
            : <>
            {!trades ? <div className="empty"><b>Chargement…</b></div> : !trades.length ? <div className="empty"><b>Aucune transaction récente</b>{!pump && <span>Le détail des transactions est disponible pour les tokens pump.fun et PumpSwap.</span>}</div> : (
              <div className="tr-table-wrap tr-tape-wrap">
                <table className="tr-table tr-tape-t">
                  <thead><tr><th>Heure</th><th>Type</th><th className="num">Montant</th><th className="num hide-s">{sym}</th><th className="num hide-m">Prix</th><th>Wallet</th><th aria-label="Transaction" /></tr></thead>
                  <tbody>
                    {trades.slice(0, 60).map((x) => (
                      <tr key={x.sig} className={(x.live ? 'tr-new ' : '') + (x.w && info?.creator === x.w ? 'tr-dev' : '')}>
                        <td className="mono dim" title={new Date(x.t).toLocaleString('fr-FR')}>{age(x.t)}</td>
                        <td><span className={'tr-side-b ' + x.side}>{x.side === 'buy' ? 'Achat' : 'Vente'}</span>{x.w && info?.creator === x.w && <em className="tr-badge a" title="Ce wallet a créé le token">Créateur</em>}</td>
                        <td className={'num mono ' + (x.side === 'buy' ? 'up' : 'down')}>{x.sol != null ? x.sol.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' SOL' : '—'}<small className="dim"> {x.usd != null ? fCompact(x.usd) : ''}</small></td>
                        <td className="num mono hide-s">{fTok(x.tok)}</td>
                        <td className="num mono hide-m">{fPrice(x.pUsd, '$')}</td>
                        <td className="mono"><a href={solscan('account', x.w)} target="_blank" rel="noopener noreferrer">{short(x.w)}</a></td>
                        <td><a className="tr-tx" href={solscan('tx', x.sig)} target="_blank" rel="noopener noreferrer" aria-label="Voir la transaction sur Solscan">{EXT}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>}
            </div>
          </div>
        </div>

        <aside className="tr-aside">
          <TradePanel mint={mint} symbol={sym} priceSol={priceSol} onPosition={onPosition} />
          {info?.description && <div className="card tr-desc"><h3>À propos</h3><p>{info.description}</p></div>}
          <PriceAlerts mint={mint} symbol={sym} mcUsd={mcUsd} />
        </aside>
      </div>
    </div>
  );
}
