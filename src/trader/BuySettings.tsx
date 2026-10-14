import { useEffect, useState, type ReactNode } from 'react';
import { studio } from '../legacy/bridge';
import { srvLabel, useServerWallet } from '../serverWallet/api';
import { Sol } from '../ui/Sol';
import { Num } from './StrategyDialog';
import { SPEEDS } from './snipes';

// Réglages d'un achat exécuté par le serveur (achat automatique, achat programmé) : wallet rapide, montant,
// vitesse, glissement. Mêmes champs et mêmes libellés dans les deux fenêtres.

const AMOUNTS = [0.05, 0.1, 0.25, 0.5];
type Hub = { rpc: <T>(m: string, p: unknown[]) => Promise<T> };
export type BuyInit = { wallet?: string | null; amount?: number; priority?: number; slippage?: number };

export function useBuySettings(init: BuyInit, defSlip: number) {
  const srv = useServerWallet();
  const wallets = srv?.wallets ?? [];
  const [wallet, setWallet] = useState<string | null>(init.wallet ?? srv?.address ?? wallets[0]?.address ?? null);
  const [amount, setAmount] = useState(init.amount ?? 0.1);
  const [priority, setPriority] = useState(init.priority ?? 0.003);
  const [slip, setSlip] = useState(init.slippage ?? defSlip);
  const [bal, setBal] = useState<number | null>(null);
  useEffect(() => {
    setBal(null);
    const hub = studio()?.hub as unknown as Hub | undefined;
    if (!wallet || !hub) return;
    let alive = true;
    hub.rpc<{ value: number }>('getBalance', [wallet, { commitment: 'confirmed' }]).then((r) => { if (alive) setBal(r.value / 1e9); }).catch(() => {});
    return () => { alive = false; };
  }, [wallet]);
  const maxCost = amount * (1 + slip / 100);
  return { wallets, wallet, setWallet, amount, setAmount, priority, setPriority, slip, setSlip, bal, maxCost,
    low: bal != null && bal < maxCost + priority + 0.005, valid: !!wallet && amount >= 0.001 && amount <= 10 };
}
export type BuyState = ReturnType<typeof useBuySettings>;

/** Champs « Achat » ; middle : champ propre à la fenêtre, placé à côté de la vitesse */
export function BuyFields({ b, slips, slipNote, middle }: { b: BuyState; slips: number[]; slipNote: string; middle?: ReactNode }) {
  return (<>
    <div className="sn-grid">
      <label className="sg-field"><span className="sn-k">Wallet qui achète</span>
        <select value={b.wallet ?? ''} onChange={(e) => b.setWallet(e.target.value)}>{b.wallets.map((w) => <option key={w.address} value={w.address}>{srvLabel(w)}</option>)}</select>
        <small className={b.low ? 'sg-bad' : 'dim'}>{b.bal == null ? 'Solde…' : <>Solde <Sol v={b.bal} d={3} />{b.low ? ' : insuffisant pour cet achat' : ''}</>}</small></label>
      <div className="sg-field"><span className="sn-k">Montant</span>
        <div className="sn-amt"><Num v={b.amount} unit="SOL" label="Montant de l'achat" onChange={b.setAmount} />
          <div className="sg-sell" role="group" aria-label="Montants rapides">{AMOUNTS.map((a) => <button key={a} type="button" className={b.amount === a ? 'on' : ''} aria-pressed={b.amount === a} onClick={() => b.setAmount(a)}>{a.toLocaleString('fr-FR')}</button>)}</div></div></div>
    </div>
    <div className="sn-grid">
      {middle}
      <div className="sg-field"><span className="sn-k">Vitesse</span>
        <div className="sg-sell" role="group" aria-label="Vitesse">{SPEEDS.map((s) => <button key={s.v} type="button" className={b.priority === s.v ? 'on' : ''} aria-pressed={b.priority === s.v} onClick={() => b.setPriority(s.v)}>{s.l}</button>)}</div>
        <small className="dim">Frais de priorité : <Sol v={b.priority} d={3} /></small></div>
    </div>
    <div className="sg-field"><span className="sn-k">Glissement maximum à l'achat</span>
      <div className="sg-sell" role="group" aria-label="Glissement à l'achat">{slips.map((v) => <button key={v} type="button" className={b.slip === v ? 'on' : ''} aria-pressed={b.slip === v} onClick={() => b.setSlip(v)}>{v} %</button>)}</div>
      <small className="dim">{slipNote} vous payez au plus <Sol v={b.maxCost} d={3} />.</small></div>
  </>);
}
