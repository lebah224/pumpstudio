import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sol } from '../ui/Sol';
import { fPct, fPrice, fTok } from './format';
import { solUsd } from './live';

type Quote = { sol: number; tokens: number; minOut: number; impact: number; fees: number };
type Pos = { bal: number; value: number; avg: number | null; spent: number; recv: number; pnl: number; price: number };
type TraderApi = {
  settings: () => { slippage: number; priorityFee: number; maxSol: number; sim: boolean; wallet: boolean; bal: number | null; busy: boolean };
  set: (p: { slippage?: number; priorityFee?: number }) => void;
  quote: (mint: string, side: 'buy' | 'sell', amount: number) => Quote | null;
  position: (mint: string) => Pos | null;
  newOrder: (mint: string) => Promise<void>;
};
type Studio = { trader?: TraderApi; trade?: (mint: string, side: 'buy' | 'sell', amount: string) => Promise<boolean | undefined>; loadToken?: (mint: string, full: boolean) => Promise<unknown> };
const st = () => window.PumpStudio as unknown as Studio | undefined;

const BUY_QUICK = [0.05, 0.1, 0.25, 0.5, 1];
const SELL_QUICK = [25, 50, 75, 100];
const SLIPS = [5, 10, 15, 25];
const PRIO: { v: number; l: string }[] = [{ v: 0.0001, l: 'Éco' }, { v: 0.0005, l: 'Normal' }, { v: 0.001, l: 'Rapide' }, { v: 0.003, l: 'Turbo' }];
const parse = (s: string) => { const v = parseFloat(s.replace(',', '.').replace(/\s/g, '')); return isFinite(v) ? v : NaN; };

/** Panneau d'achat et de vente : le studio prépare, vérifie et fait signer la transaction (ou la simule en démo) */
export function TradePanel({ mint, symbol, priceSol, onPosition }: { mint: string; symbol: string; priceSol: number | null; onPosition: (p: Pos | null) => void }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amt, setAmt] = useState('0.1');
  const [pct, setPct] = useState(100);
  const [cfg, setCfg] = useState(() => st()?.trader?.settings() ?? null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adv, setAdv] = useState(false);

  // courbe, solde du token et position : relus à l'ouverture, après chaque opération et toutes les 20 s
  const refresh = useCallback(async () => {
    const S = st(); if (!S?.loadToken) return;
    try { await S.loadToken(mint, false); } catch { /* marché introuvable : le devis reste estimé */ }
    const p = S.trader?.position(mint) ?? null;
    setPos(p); onPosition(p); setCfg(S.trader?.settings() ?? null); setReady(true);
  }, [mint, onPosition]);
  useEffect(() => { setReady(false); setPos(null); refresh(); const id = setInterval(() => { if (!document.hidden) refresh(); }, 20_000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => {
    const f = () => refresh(); const g = () => setCfg(st()?.trader?.settings() ?? null);
    window.addEventListener('ts-trade-refresh', f); window.addEventListener('pstudio-state', g);
    return () => { window.removeEventListener('ts-trade-refresh', f); window.removeEventListener('pstudio-state', g); };
  }, [refresh]);

  const held = pos?.bal ?? 0;
  const solIn = parse(amt);
  const tokOut = held * pct / 100;
  const q = useMemo(() => {
    const T = st()?.trader; if (!T || !ready) return null;
    return side === 'buy' ? (solIn > 0 ? T.quote(mint, 'buy', solIn) : null) : (tokOut > 0 ? T.quote(mint, 'sell', tokOut) : null);
  }, [side, solIn, tokOut, mint, ready, priceSol]);   // eslint-disable-line react-hooks/exhaustive-deps
  // token migré ou hors pump.fun : estimation au prix du marché (le pool donne le montant exact à la signature)
  const est = !q && priceSol && priceSol > 0 ? (side === 'buy' ? (solIn > 0 ? solIn * 0.99 / priceSol : null) : tokOut > 0 ? tokOut * priceSol * 0.99 : null) : null;
  const bal = cfg?.bal ?? null;
  const warn = side === 'buy'
    ? (!(solIn > 0) ? 'Saisissez un montant.' : cfg && solIn > cfg.maxSol ? 'Au-delà de votre limite par achat (' + cfg.maxSol.toLocaleString('fr-FR') + ' SOL), modifiable dans Réglages.' : bal != null && solIn > bal ? 'Solde insuffisant.' : null)
    : (!(held > 0) ? 'Vous ne détenez pas ce token' + (cfg?.sim ? ' dans le wallet démo.' : '.') : null);

  const go = async () => {
    const S = st(); if (!S?.trade || warn) return;
    setBusy(true);
    try { const ok = await S.trade(mint, side, side === 'buy' ? String(solIn) : pct + '%'); if (ok) await refresh(); }
    finally { setBusy(false); setCfg(S.trader?.settings() ?? null); }
  };
  const set = (p: { slippage?: number; priorityFee?: number }) => { st()?.trader?.set(p); setCfg(st()?.trader?.settings() ?? null); };
  const rate = solUsd();

  return (
    <div className="tr-panel card">
      <div className="tr-side" role="tablist" aria-label="Sens de l'opération">
        <button type="button" role="tab" aria-selected={side === 'buy'} className={'buy' + (side === 'buy' ? ' on' : '')} onClick={() => setSide('buy')}>Acheter</button>
        <button type="button" role="tab" aria-selected={side === 'sell'} className={'sell' + (side === 'sell' ? ' on' : '')} onClick={() => setSide('sell')}>Vendre</button>
      </div>

      {cfg?.sim && <div className="tr-demo"><span className="badge v">démo</span>Prix réels du marché, opérations simulées sur votre wallet démo.</div>}

      {side === 'buy' ? (<>
        <label className="tr-amt">
          <span className="tr-lbl">Montant</span>
          <span className="tr-amt-in"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Montant en SOL" /><em>SOL</em></span>
          <small className="dim">{rate && solIn > 0 ? '≈ ' + (solIn * rate).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' $' : ' '}{bal != null && <> · solde <Sol v={bal} d={3} /></>}</small>
        </label>
        <div className="tr-quick">{BUY_QUICK.map((v) => <button key={v} type="button" className={solIn === v ? 'on' : ''} onClick={() => setAmt(String(v))}>{v.toLocaleString('fr-FR')}</button>)}</div>
      </>) : (<>
        <div className="tr-amt">
          <span className="tr-lbl">Quantité</span>
          <div className="tr-held"><b className="mono">{fTok(tokOut)}</b> <span className="dim">{symbol} sur {fTok(held)}</span></div>
        </div>
        <div className="tr-quick">{SELL_QUICK.map((v) => <button key={v} type="button" className={pct === v ? 'on' : ''} onClick={() => setPct(v)}>{v} %</button>)}</div>
      </>)}

      <dl className="tr-quote">
        {side === 'buy' ? (<>
          <dt>Vous recevez environ</dt><dd className="mono">{q ? fTok(q.tokens) : est ? '≈ ' + fTok(est) : '—'} {symbol}</dd>
          {q && <><dt>Minimum garanti</dt><dd className="mono">{fTok(q.minOut)}</dd></>}
        </>) : (<>
          <dt>Vous recevez environ</dt><dd>{q ? <Sol v={q.sol} /> : est ? <Sol v={est} /> : '—'}</dd>
          {q && <><dt>Minimum garanti</dt><dd><Sol v={q.minOut} /></dd></>}
        </>)}
        {q && <><dt>Impact sur le prix</dt><dd className={'mono ' + (Math.abs(q.impact) > 5 ? 'warn' : '')}>{fPct(q.impact, 2)}</dd></>}
        {!q && est != null && <><dt>Devis</dt><dd className="dim">au prix du marché · montant exact donné par le pool</dd></>}
      </dl>

      <button type="button" className="tr-adv-t" aria-expanded={adv} onClick={() => setAdv((a) => !a)}>
        <span>Slippage <b className="mono">{cfg?.slippage ?? '—'} %</b> · priorité <b className="mono">{cfg ? (PRIO.find((p) => p.v === cfg.priorityFee)?.l ?? cfg.priorityFee.toLocaleString('fr-FR') + ' SOL') : '—'}</b></span>
        <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d={adv ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
      </button>
      {adv && cfg && (
        <div className="tr-adv">
          <span className="tr-lbl">Slippage maximum</span>
          <div className="tr-quick">{SLIPS.map((v) => <button key={v} type="button" className={cfg.slippage === v ? 'on' : ''} onClick={() => set({ slippage: v })}>{v} %</button>)}</div>
          <span className="tr-lbl">Frais de priorité</span>
          <div className="tr-quick">{PRIO.map((p) => <button key={p.v} type="button" className={cfg.priorityFee === p.v ? 'on' : ''} title={p.v.toLocaleString('fr-FR') + ' SOL'} onClick={() => set({ priorityFee: p.v })}>{p.l}</button>)}</div>
          <p className="dim tr-small">Plus de slippage : la transaction passe même si le prix bouge vite, mais vous pouvez payer plus cher. La priorité accélère l'inclusion dans un bloc.</p>
        </div>
      )}

      {warn && (side === 'sell' || solIn > 0) && <p className="tr-warn">{warn}</p>}
      <button type="button" className={'btn tr-go ' + side} disabled={busy || !!warn || cfg?.busy} onClick={go}>
        {busy ? 'Préparation…' : side === 'buy' ? 'Acheter ' + symbol + (solIn > 0 ? ' · ' + solIn.toLocaleString('fr-FR') + ' SOL' : '') : 'Vendre ' + pct + ' % de ' + symbol}
      </button>
      {!cfg?.sim && !cfg?.wallet && <p className="dim tr-small">Connectez un wallet pour trader en réel : la transaction vous sera présentée avant signature.</p>}

      <div className="tr-pos">
        <div className="tr-pos-h"><b>Ma position</b>{held > 0 && <button type="button" className="btn sm" onClick={() => st()?.trader?.newOrder(mint)}>Prise de profit / stop</button>}</div>
        {!ready ? <p className="dim tr-small">Lecture…</p> : !(held > 0) && !pos?.spent ? <p className="dim tr-small">Aucune position sur ce token{cfg?.sim ? ' en démo' : ''}.</p> : (
          <dl className="tr-quote">
            <dt>Détenus</dt><dd className="mono">{fTok(held)} {symbol}</dd>
            <dt>Valeur</dt><dd><Sol v={pos!.value} /></dd>
            {pos!.avg != null && <><dt>Prix moyen d'achat</dt><dd className="mono">{fPrice(pos!.avg, 'SOL')}</dd></>}
            <dt>Résultat</dt><dd className={pos!.pnl >= 0 ? 'up' : 'down'}><Sol v={pos!.pnl} />{pos!.spent > 0 && <span className="mono"> ({fPct(pos!.pnl / pos!.spent * 100)})</span>}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
