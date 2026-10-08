import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { studio, type DemoInfo } from '../legacy/bridge';
import { Donut, type Slice } from './charts';

// Portefeuille en démo : tout est fictif (solde, tokens, activité), rien n'est lu ni envoyé sur la blockchain.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
const OTHER = '#6b665c';
const nf = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const sol = (n: number, d = 3) => nf(n, d) + ' SOL';
const usd = (n: number) => (Math.abs(n) >= 1000 ? nf(n, 0) : nf(n, 2)) + ' $';
const amt = (n: number) => (n >= 1e6 ? nf(n / 1e6, 2) + ' M' : n >= 1e3 ? nf(n / 1e3, 2) + ' k' : nf(n, n < 1 ? 4 : 2));
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'à l\'instant'; if (s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + ' h';
  return new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};
const TYPE: Record<string, { l: string; ic: string; c: string }> = {
  buy: { l: 'Achat', ic: '+', c: 'buy' }, sell: { l: 'Vente', ic: '−', c: 'sell' }, create: { l: 'Lancement', ic: '✦', c: 'buy' },
  fees: { l: 'Frais créateur', ic: '↓', c: 'in' }, deposit: { l: 'Dépôt', ic: '↓', c: 'in' }, withdraw: { l: 'Retrait', ic: '↑', c: 'out' },
};

export function DemoWallet({ visible }: { visible: boolean }) {
  const hub = studio()?.hub;
  const { user } = useAuth();
  const [info, setInfo] = useState<DemoInfo | null>(() => hub?.demoInfo() ?? null);
  // le marché simulé avance : la valeur des tokens se met à jour tant que la page est ouverte
  useEffect(() => {
    if (!visible) return;
    const up = () => setInfo(studio()?.hub?.demoInfo() ?? null);
    up(); const id = setInterval(up, 3000);
    window.addEventListener('pstudio-state', up);
    return () => { clearInterval(id); window.removeEventListener('pstudio-state', up); };
  }, [visible]);

  const tokSol = (info?.hold ?? []).reduce((a, x) => a + (x.sol ?? 0), 0);
  const total = info ? info.bal + tokSol : 0;
  const px = info?.solUsd ?? null;
  const slices: Slice[] = useMemo(() => {
    if (!info) return [];
    const top = info.hold.filter((x) => (x.sol ?? 0) > 1e-6).slice(0, 4), rest = info.hold.slice(4).reduce((a, x) => a + (x.sol ?? 0), 0);
    const out: Slice[] = [{ key: 'sol', label: 'SOL', value: info.bal, color: SERIES[0]!, sub: sol(info.bal) }];
    top.forEach((x, i) => out.push({ key: x.mint, label: x.symbol, value: x.sol ?? 0, color: SERIES[i + 1]!, sub: amt(x.amount) }));
    if (rest > 0) out.push({ key: 'other', label: 'Autres', value: rest, color: OTHER, sub: 'autres tokens' });
    return out.filter((x) => x.value > 0);
  }, [info]);
  if (!info) return null;
  const goReal = () => (user ? hub?.goReal() : location.assign('/connexion'));

  return (
    <div className="ts-wp">
      <div className="ts-wp-bar">
        <div className="ts-wp-tabs"><span className="ts-wp-demo"><span className="badge v">démo</span><b>Wallet démo</b><small className="mono">adresse fictive</small></span></div>
        <span className="ts-wp-live"><span className="dot" />Solde et tokens fictifs : rien n'est sur la blockchain</span>
        <button type="button" className="btn sm primary" onClick={goReal}>Passer en réel</button>
      </div>

      <div className="ts-wp-grid">
        <div className="ts-wp-col">
          <section className="card ts-wp-hero">
            <div className="ts-wp-eye">Wallet démo · 10 SOL fictifs au départ</div>
            <div className="ts-wp-total mono">{sol(total)}</div>
            <div className="ts-wp-sub">
              <span className="mono">{sol(info.bal)} disponibles</span>
              {info.hold.length > 0 && <span> · {info.hold.length} token{info.hold.length > 1 ? 's' : ''} ({sol(tokSol)})</span>}
              {px ? <span> · ≈ {usd(total * px)}</span> : null}
            </div>
            <div className="ts-wp-actions">
              <button type="button" className="ts-wp-act" onClick={() => hub?.demoMove('deposit')}><span className="ts-wp-aic">↓</span>Déposer</button>
              <button type="button" className="ts-wp-act" onClick={() => hub?.demoMove('withdraw')}><span className="ts-wp-aic">↑</span>Retirer</button>
              <button type="button" className="ts-wp-act" onClick={() => hub?.demoReset()}><span className="ts-wp-aic">↺</span>Réinitialiser</button>
            </div>
            <p className="ts-wp-foot">Dépôts, retraits, achats et lancements sont simulés. L'adresse du wallet démo n'existe pas sur Solana : n'y envoie jamais de vrais SOL.</p>
          </section>

          <section className="card ts-wp-acts">
            <div className="card-h"><h3>Activité démo</h3><p>Opérations fictives de la démo.</p></div>
            {!info.acts.length ? <div className="empty"><b>Aucune opération</b>Lance un token ou fais un achat en démo : il apparaîtra ici.</div> : (
              <ul className="ts-wp-list">
                {info.acts.map((x, i) => {
                  const k = TYPE[x.type] ?? { l: 'Opération', ic: '•', c: 'other' };
                  return (
                    <li key={x.t + '-' + i}><div className="ts-wp-row">
                      <span className={'ts-wp-k ' + k.c} aria-hidden="true">{k.ic}</span>
                      <span className="ts-wp-n"><b>{k.l}{x.symbol && x.symbol !== 'SOL' ? ' · ' + x.symbol : ''}</b><small>{ago(x.t)}{x.tokens ? ' · ' + amt(Math.abs(x.tokens)) + ' tokens' : ''}</small></span>
                      <span className={'ts-wp-v ' + (x.sol >= 0 ? 'pos' : 'neg')}><b className="mono">{x.sol ? (x.sol > 0 ? '+' : '−') + nf(Math.abs(x.sol), 4) : '—'}</b><small>SOL</small></span>
                    </div></li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
        <div className="ts-wp-col">
          <section className="card ts-wp-alloc">
            <div className="card-h"><h3>Répartition</h3><p>Valeur en SOL au prix simulé.</p></div>
            <div className="ts-wp-alloc-b">
              <Donut items={slices} center={{ v: sol(total, 2), l: 'total' }} fmt={(v) => sol(v)} />
              <ul className="ts-legend">
                {slices.map((x) => <li key={x.key}><i style={{ background: x.color }} /><b>{x.label}</b><span className="mono">{sol(x.value)}</span><small>{Math.round((x.value / (total || 1)) * 100)} % · {x.sub}</small></li>)}
              </ul>
            </div>
          </section>
          <section className="card ts-wp-toks">
            <div className="card-h"><h3>Tokens détenus</h3><p>{info.hold.length ? 'Tokens démo (marché simulé) et vrais tokens achetés avec des SOL fictifs' : 'Aucun token dans le wallet démo'}</p></div>
            {info.hold.length > 0 && (
              <ul className="ts-wp-list">
                {info.hold.map((x) => (
                  <li key={x.mint}>
                    <button type="button" onClick={() => (window.PumpStudio as unknown as { openTrade?: (m: string) => void })?.openTrade?.(x.mint)} title="Ouvrir dans Trader">
                      {x.image ? <img src={x.image} alt="" loading="lazy" data-rm-on-error="1" /> : <span className="ts-wp-tok">{x.symbol.slice(0, 2)}</span>}
                      <span className="ts-wp-n"><b>{x.symbol}</b><small>{x.demo ? 'token démo' : 'prix réel, SOL fictifs'}</small></span>
                      <span className="ts-wp-v"><b className="mono">{x.sol != null ? sol(x.sol, 4) : '—'}</b><small className="mono">{amt(x.amount)}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
