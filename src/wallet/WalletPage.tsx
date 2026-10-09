import { useCallback, useEffect, useMemo, useState } from 'react';
import { WalletMark } from '../auth/SignIn';
import { goTo, studio, toast, type HubState } from '../legacy/bridge';
import { walletById } from '../wallets/catalog';
import { AreaChart, Donut, QrCode, type Slice } from './charts';
import { useServerWallet } from '../serverWallet/api';
import { openServerWallet } from '../serverWallet/ServerWalletDialog';
import { DemoWallet } from './DemoWallet';
import { activity, balanceOf, balanceSeries, forget, holdings, solHistory, type Holding, type Pt, type Range, type Tx } from './walletData';

// Couleurs de répartition (palette catégorielle validée pour fond sombre, ordre fixe) et « Autres » en neutre
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
const OTHER = '#6b665c';
const RANGE_LABEL: Record<Range, string> = { '1d': '24 h', '7d': '7 j', '30d': '30 j' };

const nf = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (Math.abs(n) >= 1000 ? nf(n, 0) : nf(n, 2)) + ' $';
const sol = (n: number, d = 4) => nf(n, d) + ' SOL';
const amt = (n: number) => (n >= 1e6 ? nf(n / 1e6, 2) + ' M' : n >= 1e3 ? nf(n / 1e3, 2) + ' k' : nf(n, n < 1 ? 4 : 2));
const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'à l\'instant'; if (s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + ' h';
  return new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};
const fmtT = (r: Range) => (t: number) => (r === '1d' ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
const copy = async (pk: string) => { try { await navigator.clipboard.writeText(pk); toast('Adresse copiée', short(pk)); } catch { toast('Copie impossible', 'Sélectionne l\'adresse et copie-la à la main.', 'a'); } };

function useHub(): HubState | null {
  const read = () => studio()?.hub?.state() ?? null;
  const [st, setSt] = useState<HubState | null>(read);
  useEffect(() => { const up = () => setSt(read()); up(); window.addEventListener('pstudio-state', up); return () => window.removeEventListener('pstudio-state', up); }, []);
  return st;
}
function useVisible() {
  const [on, setOn] = useState(() => studio()?.hub?.page() === 'wallet');
  useEffect(() => { const f = (e: Event) => setOn((e as CustomEvent).detail === 'wallet'); window.addEventListener('pstudio-page', f); return () => window.removeEventListener('pstudio-page', f); }, []);
  return on;
}

const KIND: Record<Tx['kind'], { l: string; ic: string; c: string }> = {
  in: { l: 'Reçu', ic: '↓', c: 'in' }, out: { l: 'Envoyé', ic: '↑', c: 'out' }, buy: { l: 'Achat de token', ic: '+', c: 'buy' },
  sell: { l: 'Vente de token', ic: '−', c: 'sell' }, fail: { l: 'Échec', ic: '!', c: 'fail' }, other: { l: 'Opération', ic: '•', c: 'other' },
};

/** Page Portefeuille : valeur, évolution, répartition, tokens, activité, dépôt (QR) et retrait */
export function WalletPage() {
  const st = useHub();
  const visible = useVisible();
  const [pick, setPick] = useState<'ext' | 'quick' | 'srv' | null>(null);
  const srvSt = useServerWallet();
  const [range, setRange] = useState<Range>('7d');
  const [unit, setUnit] = useState<'usd' | 'sol'>('usd');
  const [bal, setBal] = useState<number | null>(null);
  const [hold, setHold] = useState<Holding[] | null>(null);
  const [act, setAct] = useState<{ txs: Tx[]; more: boolean } | null>(null);
  const [price, setPrice] = useState<Pt[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receive, setReceive] = useState(false);

  const ext = st?.ext ?? null, quick = st?.quick ?? null, srv = st?.srv ?? null;
  const which: 'ext' | 'quick' | 'srv' | null = pick === 'ext' && ext ? 'ext' : pick === 'quick' && quick ? 'quick' : pick === 'srv' && srv ? 'srv'
    : srv?.active ? 'srv' : quick?.active ? 'quick' : ext ? 'ext' : srv ? 'srv' : quick ? 'quick' : null;
  const pk = which === 'ext' ? ext!.pk : which === 'quick' ? quick!.pk : which === 'srv' ? srv!.pk : null;
  const solUsd = st?.solUsd ?? price[price.length - 1]?.v ?? null;

  const load = useCallback(async (force = false) => {
    if (!pk) return;
    if (force) forget(pk);
    setBusy(true); setErr(null);
    const [b, h, a] = await Promise.allSettled([balanceOf(pk), holdings(pk), activity(pk)]);
    if (b.status === 'fulfilled') setBal(b.value); else setErr((b.reason as Error).message);
    if (h.status === 'fulfilled') setHold(h.value); else setHold([]);
    if (a.status === 'fulfilled') setAct(a.value); else { setAct({ txs: [], more: false }); if (b.status === 'fulfilled') setErr((a.reason as Error).message); }
    setBusy(false);
  }, [pk]);
  useEffect(() => { setBal(null); setHold(null); setAct(null); setErr(null); }, [pk]);
  useEffect(() => { if (visible && pk) load(); }, [visible, pk, load]);
  useEffect(() => { if (visible) solHistory(range).then(setPrice).catch(() => setPrice([])); }, [visible, range]);
  // après un dépôt ou un retrait fait dans le studio, le solde affiché se met à jour
  useEffect(() => {
    if (!visible || !pk) return;
    const f = () => { balanceOf(pk).then(setBal).catch(() => {}); };
    window.addEventListener('pstudio-state', f); return () => window.removeEventListener('pstudio-state', f);
  }, [visible, pk]);

  const tokUsd = (hold ?? []).reduce((a, x) => a + (x.usd ?? 0), 0);
  const solVal = bal != null && solUsd ? bal * solUsd : null;
  const total = solVal != null ? solVal + tokUsd : null;
  const series = useMemo(() => (bal != null && act ? balanceSeries(bal, act.txs, price, act.more, range) : null), [bal, act, price, range]);
  const shown = series ? (unit === 'usd' && series.usd.length ? series.usd : series.sol) : [];
  const p0 = shown[0], p1 = shown[shown.length - 1];
  const delta = shown.length > 1 && p0 && p1 ? p1.v - p0.v : null;
  const deltaPct = delta != null && p0 && p1 && p0.v > Math.abs(p1.v) * 0.05 ? (delta / p0.v) * 100 : null;
  const fmtV = unit === 'usd' && series?.usd.length ? usd : (v: number) => sol(v);
  const slices: Slice[] = useMemo(() => {
    if (solVal == null) return [];
    const toks = (hold ?? []).filter((x) => (x.usd ?? 0) > 0.01);
    const top = toks.slice(0, 4), rest = toks.slice(4).reduce((a, x) => a + (x.usd ?? 0), 0);
    const out: Slice[] = [{ key: 'sol', label: 'SOL', value: solVal, color: SERIES[0]!, sub: sol(bal ?? 0, 3) }];
    top.forEach((x, i) => out.push({ key: x.mint, label: x.symbol, value: x.usd ?? 0, color: SERIES[i + 1]!, sub: amt(x.amount) }));
    if (rest > 0) out.push({ key: 'other', label: 'Autres', value: rest, color: OTHER, sub: (toks.length - 4) + ' token' + (toks.length - 4 > 1 ? 's' : '') });
    return out.filter((x) => x.value > 0);
  }, [solVal, hold, bal]);

  if (!st) return null;
  // démo : wallet fictif de 10 SOL, rien n'est lu sur la blockchain
  if (st.sim) return <DemoWallet visible={visible} />;
  if (!pk) return (
    <div className="card ts-wp-empty">
      <div className="ts-wp-empty-ic" aria-hidden="true"><svg className="i" viewBox="0 0 24 24"><path d="M20 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h13a2 2 0 002-2v-2" /><path d="M22 11h-6a2 2 0 000 4h6v-4z" /></svg></div>
      <h3>Aucun wallet connecté</h3>
      <p>Connecte ton wallet ou crée un wallet rapide pour voir ton solde, tes tokens, ton activité, et déposer ou retirer des SOL.</p>
      <div className="ts-row center">
        <button type="button" className="btn primary" onClick={() => window.dispatchEvent(new CustomEvent('ts-connect'))}>Connecter un wallet</button>
        <button type="button" className="btn" onClick={() => openServerWallet('create')}>Créer mon wallet rapide</button>
      </div>
    </div>
  );

  const activityCard = (
        <section className="card ts-wp-acts">
          <div className="card-h"><h3>Activité récente</h3><p>Transactions lues sur la blockchain.</p></div>
          {!act ? <div className="ts-skel" style={{ height: 160 }} /> : !act.txs.length ? <div className="empty"><b>Aucune transaction</b>Les dépôts, retraits et trades de ce wallet apparaîtront ici.</div> : (
            <ul className="ts-wp-list">
              {act.txs.slice(0, 15).map((x) => {
                const k = KIND[x.kind];
                return (
                  <li key={x.sig}>
                    <a href={'https://solscan.io/tx/' + x.sig} target="_blank" rel="noopener noreferrer">
                      <span className={'ts-wp-k ' + k.c} aria-hidden="true">{k.ic}</span>
                      <span className="ts-wp-n"><b>{k.l}</b><small>{ago(x.t)}{x.peer && (x.kind === 'in' || x.kind === 'out') ? (x.kind === 'in' ? ' · de ' : ' · vers ') + short(x.peer) : ''}{x.token ? ' · ' + amt(Math.abs(x.token.delta)) + ' ' + short(x.token.mint) : ''}</small></span>
                      <span className={'ts-wp-v ' + (x.sol >= 0 ? 'pos' : 'neg')}><b className="mono">{(x.sol >= 0 ? '+' : '−') + nf(Math.abs(x.sol), 4)}</b><small>SOL</small></span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
  );
  const isQuick = which === 'quick', isSrv = which === 'srv';
  const signer = srv?.active ? 'srv' : quick?.active ? 'quick' : 'ext';
  const signs = signer === which;
  const name = isSrv ? 'Wallet rapide' : isQuick ? 'Wallet rapide' : ext!.name;
  const useIt = () => (isSrv ? hub?.useServer(true) : isQuick ? hub?.useQuick(true) : hub?.useExt());
  const capPct = srvSt?.daily_cap_sol ? Math.min(100, ((srvSt.spent_today ?? 0) / srvSt.daily_cap_sol) * 100) : 0;
  const hub = studio()?.hub;

  return (
    <div className="ts-wp">
      {/* choix du wallet affiché */}
      <div className="ts-wp-bar">
        <div className="ts-wp-tabs" role="tablist" aria-label="Wallet affiché">
          {srv && <button type="button" role="tab" aria-selected={which === 'srv'} className={which === 'srv' ? 'on' : ''} onClick={() => setPick('srv')}><span className="ts-wmark quick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg></span><span><b>Wallet rapide</b><small className="mono">{short(srv.pk)}</small></span></button>}
          {ext && <button type="button" role="tab" aria-selected={which === 'ext'} className={which === 'ext' ? 'on' : ''} onClick={() => setPick('ext')}><WalletMark w={walletById(ext.id) ?? { name: ext.name, color: '#7c8595' }} /><span><b>{ext.name}</b><small className="mono">{short(ext.pk)}</small></span></button>}
          {quick && <button type="button" role="tab" aria-selected={which === 'quick'} className={which === 'quick' ? 'on' : ''} onClick={() => setPick('quick')}><span className="ts-wmark quick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg></span><span><b>Wallet rapide</b><small className="mono">{short(quick.pk)}</small></span></button>}
        </div>
        <span className="ts-wp-live"><span className="dot on" />Soldes réels, lus sur la blockchain</span>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => load(true)}>{busy ? 'Actualisation…' : 'Actualiser'}</button>
      </div>

      {err && <div className="ts-note warn ts-wp-err"><span>{err}</span><button type="button" className="btn sm" onClick={() => goTo('settings')}>Ouvrir les réglages</button></div>}

      <div className="ts-wp-grid">
        <div className="ts-wp-col">
        {/* valeur et évolution */}
        <section className="card ts-wp-hero">
          <div className="ts-wp-h">
            <div>
              <div className="ts-wp-eye">{name} · {signs ? <span className="ts-hub-pill ok">signe tes transactions</span> : <button type="button" className="ts-hub-pill" onClick={useIt}>Utiliser pour signer</button>}{isQuick && !quick!.unlocked && <span className="badge a">verrouillé</span>}</div>
              <div className="ts-wp-total mono">{total != null ? usd(total) : bal != null ? sol(bal) : '—'}</div>
              <div className="ts-wp-sub">
                <span className="mono">{bal != null ? sol(bal) : '…'}</span>
                {hold && hold.length > 0 && <span> · {hold.length} token{hold.length > 1 ? 's' : ''}{tokUsd > 0 ? ' (' + usd(tokUsd) + ')' : ''}</span>}
                {delta != null && Math.abs(delta) > 1e-9 && <span className={'ts-wp-chg ' + (delta >= 0 ? 'up' : 'down')}>{delta >= 0 ? '▲ +' : '▼ −'}{fmtV(Math.abs(delta))}{deltaPct != null ? ' (' + nf(Math.abs(deltaPct), 1) + ' %)' : ''} <small>{RANGE_LABEL[range]}</small></span>}
              </div>
            </div>
          </div>

          <div className="ts-wp-actions">
            <button type="button" className="ts-wp-act" onClick={() => setReceive(true)}><span className="ts-wp-aic">↓</span>Déposer</button>
            {isSrv ? <button type="button" className="ts-wp-act" onClick={() => openServerWallet('withdraw')}><span className="ts-wp-aic">↑</span>Retirer</button>
              : isQuick
              ? <button type="button" className="ts-wp-act" onClick={() => hub?.walletAction('withdraw')}><span className="ts-wp-aic">↑</span>Retirer</button>
              : srv ? <button type="button" className="ts-wp-act" title={'Envoyer des SOL de ' + name + ' vers ton wallet rapide (signé dans ' + name + ')'} onClick={() => hub?.walletAction('fund')}><span className="ts-wp-aic">⇢</span>Alimenter</button>
              : <button type="button" className="ts-wp-act" title="Wallet de ton compte qui signe seul, sans fenêtre : ventes automatiques de tes ordres" onClick={() => openServerWallet('create')}><span className="ts-wp-aic">ϟ</span>Wallet rapide</button>}
            <button type="button" className="ts-wp-act" onClick={() => copy(pk)}><span className="ts-wp-aic">⧉</span>Copier</button>
            <a className="ts-wp-act" href={'https://solscan.io/account/' + pk} target="_blank" rel="noopener noreferrer"><span className="ts-wp-aic">↗</span>Solscan</a>
          </div>

          <div className="ts-wp-ctl">
            <b>Évolution du solde</b>
            <div className="seg sm" role="group" aria-label="Unité"><button type="button" className={unit === 'usd' ? 'on' : ''} onClick={() => setUnit('usd')}>$</button><button type="button" className={unit === 'sol' ? 'on' : ''} onClick={() => setUnit('sol')}>SOL</button></div>
            <div className="seg sm" role="group" aria-label="Période">{(['1d', '7d', '30d'] as Range[]).map((r) => <button key={r} type="button" className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>)}</div>
          </div>
          {series ? <AreaChart pts={shown} fmt={fmtV} fmtT={fmtT(range)} fmtTip={(t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} label={'Solde ' + (unit === 'usd' ? 'en dollars' : 'en SOL')} />
            : <div className="ts-chart ts-skel" style={{ height: 220 }} />}
          <p className="ts-wp-foot">{series?.partial ? 'Historique partiel : reconstitué à partir des 25 dernières transactions. ' : ''}Courbe du SOL détenu{unit === 'usd' ? ', valorisé au prix du SOL à chaque instant' : ''}. Les tokens ne sont pas inclus dans la courbe.</p>
        </section>

        {/* activité */}
        {activityCard}
        </div>
        <div className="ts-wp-col">
        {/* répartition */}
        <section className="card ts-wp-alloc">
          <div className="card-h"><h3>Répartition</h3><p>Valeur en dollars au prix actuel.</p></div>
          {slices.length ? (
            <div className="ts-wp-alloc-b">
              <Donut items={slices} center={{ v: total != null ? usd(total) : '—', l: 'total' }} fmt={usd} />
              <ul className="ts-legend">
                {slices.map((x) => <li key={x.key}><i style={{ background: x.color }} /><b>{x.label}</b><span className="mono">{usd(x.value)}</span><small>{Math.round((x.value / (total || 1)) * 100)} % · {x.sub}</small></li>)}
              </ul>
            </div>
          ) : <div className="ts-skel" style={{ height: 168 }} />}
        </section>

        {/* tokens */}
        <section className="card ts-wp-toks">
          <div className="card-h"><h3>Tokens détenus</h3><p>{hold ? (hold.length ? hold.length + ' token' + (hold.length > 1 ? 's' : '') + ' · prix DexScreener' : 'Aucun token dans ce wallet') : 'Chargement…'}</p></div>
          {hold && hold.length > 0 && (
            <ul className="ts-wp-list">
              {hold.slice(0, 12).map((x) => (
                <li key={x.mint}>
                  <button type="button" onClick={() => (window.PumpStudio as unknown as { openTrade?: (m: string) => void })?.openTrade?.(x.mint)} title="Ouvrir dans Trader">
                    {x.image ? <img src={x.image} alt="" loading="lazy" data-rm-on-error="1" /> : <span className="ts-wp-tok">{x.symbol.slice(0, 2)}</span>}
                    <span className="ts-wp-n"><b>{x.symbol}</b><small>{x.name}</small></span>
                    <span className="ts-wp-v"><b className="mono">{x.usd != null ? usd(x.usd) : '—'}</b><small className="mono">{amt(x.amount)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>


        {/* gestion du wallet serveur */}
        {isSrv && srvSt?.address && (
          <section className="card ts-wp-sec">
            <div className="card-h"><h3>Wallet rapide</h3><p>Clé chiffrée sur ton compte. Il signe seul, uniquement des opérations de trading, dans la limite de tes plafonds.</p></div>
            <div className="ts-cap">
              <div className="ts-cap-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(capPct)} aria-label="Plafond du jour utilisé"><i className={capPct > 80 ? 'hot' : ''} style={{ width: capPct + '%' }} /></div>
              <div className="ts-cap-t"><span>Dépensé aujourd'hui : <b className="mono">{nf(srvSt.spent_today ?? 0, 3)} SOL</b></span><span>plafond {nf(srvSt.daily_cap_sol ?? 10, 2)} SOL</span></div>
            </div>
            {bal != null && srvSt.alert_balance_sol != null && bal > srvSt.alert_balance_sol && <div className="ts-note warn">Solde au-dessus de ton seuil d'alerte ({nf(srvSt.alert_balance_sol, 2)} SOL) : pense à retirer les gains vers ton wallet principal.</div>}
            <div className="ts-wp-secb">
              <button type="button" className="btn sm" onClick={() => openServerWallet('limits')}>Plafonds</button>
              <button type="button" className="btn sm ghost" onClick={() => openServerWallet('export')}>Exporter la clé</button>
              <button type="button" className="btn sm ghost danger" onClick={() => openServerWallet('delete')}>Supprimer</button>
            </div>
          </section>
        )}
        {/* ancien wallet rapide gardé dans ce navigateur : à transférer sur le compte */}
        {st.quickSaved && (
          <section className="card ts-wp-sec">
            <div className="card-h"><h3>Ancien wallet rapide</h3><p>L'adresse <span className="mono">{short(st.quickSaved.pk)}</span> est encore gardée dans ce navigateur. Transfère-la sur ton compte pour la retrouver partout : même adresse, mêmes fonds.</p></div>
            <div className="ts-wp-secb">
              <button type="button" className="btn sm primary" onClick={() => hub?.legacyMigrate()}>{srv ? 'Transférer les SOL vers mon wallet rapide' : 'Transférer sur mon compte'}</button>
              <button type="button" className="btn sm ghost" onClick={() => hub?.legacyExport()}>Clé privée</button>
              <button type="button" className="btn sm ghost danger" onClick={() => hub?.legacyForget()}>Retirer de ce navigateur</button>
            </div>
          </section>
        )}
        </div>
      </div>

      {receive && <ReceiveDialog pk={pk} name={name} canFund={isSrv && !!ext} onClose={() => setReceive(false)} />}
    </div>
  );
}

/** Dépôt : QR code à scanner depuis une app wallet, adresse à copier, montant optionnel (Solana Pay) */
function ReceiveDialog({ pk, name, canFund, onClose }: { pk: string; name: string; canFund: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const n = Number(amount.replace(',', '.'));
  const ok = amount.trim() !== '' && Number.isFinite(n) && n > 0 && n < 1e6;
  const uri = 'solana:' + pk + (ok ? '?amount=' + n + '&label=TokenStudio' : '');
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label="Déposer des SOL" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ts-modal-box ts-recv">
        <button type="button" className="ts-x" aria-label="Fermer" onClick={onClose}>×</button>
        <div className="ts-si-h"><b>Déposer sur {name}</b><span>Scanne ce QR code avec l'app de ton wallet ou de ton exchange, ou copie l'adresse. Envoie uniquement des SOL ou des tokens Solana.</span></div>
        <div className="ts-recv-qr"><QrCode text={uri} /></div>
        <button type="button" className="ts-recv-addr mono" onClick={() => copy(pk)} title="Copier l'adresse">{pk}<span>Copier</span></button>
        <label className="field"><span className="ts-lbl">Montant demandé (facultatif)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ex. 0,5 SOL" /></label>
        {ok && <p className="muted ts-small">Le QR code contient maintenant une demande de {nf(n, n < 1 ? 4 : 2)} SOL (Solana Pay) : l'app du wallet pré-remplit le montant.</p>}
        <div className="ts-note warn">Réseau Solana uniquement. Un envoi depuis un autre réseau (Ethereum, BNB…) serait perdu.</div>
        <div className="ts-row">
          {canFund && <button type="button" className="btn" onClick={() => { onClose(); studio()?.hub?.walletAction('fund'); }}>{'Alimenter depuis ' + (studio()?.hub?.state().ext?.name ?? 'mon wallet')}</button>}
          <button type="button" className="btn primary" onClick={() => copy(pk)}>Copier l'adresse</button>
        </div>
      </div>
    </div>
  );
}
