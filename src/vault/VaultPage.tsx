import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { studio, toast } from '../legacy/bridge';
import { useAuth } from '../auth/AuthContext';
import { readable } from '../auth/SignIn';
import { Sol } from '../ui/Sol';
import { srvByAddress, srvLabel, useServerWallet } from '../serverWallet/api';
import { openServerWallet } from '../serverWallet/ServerWalletDialog';
import {
  balances, bridge, convert, getQuote, loadDests, loadMoves, loadRules, sendTo, solMarket, vault,
  type Asset, type Ctx, type Dest, type Move, type Quote, type Rule, type RuleKind, type Stable,
} from './api';
import { VaultChart } from './VaultChart';
import '../styles/vault.css';

const nf = (v: number, d = 2) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : nf(v, Math.abs(v) >= 1000 ? 0 : 2) + ' $');
const amt = (v: number, d = 4) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);
const ago = (iso: string | number) => {
  const m = Math.round((Date.now() - (typeof iso === 'number' ? iso : Date.parse(iso))) / 60_000);
  return m < 1 ? 'à l\'instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};
const parse = (s: string) => { const v = parseFloat(s.replace(',', '.').replace(/\s/g, '')); return isFinite(v) ? v : NaN; };
const SOL_KEEP = 0.02;

function useCtx(): Ctx | null {
  const read = () => bridge()?.ctx() ?? null;
  const [c, setC] = useState<Ctx | null>(read);
  useEffect(() => { const f = () => setC(read()); f(); window.addEventListener('pstudio-state', f); const t = setInterval(f, 4000); return () => { window.removeEventListener('pstudio-state', f); clearInterval(t); }; }, []);
  return c;
}
function useVisible() {
  const [on, setOn] = useState(() => studio()?.hub?.page() === 'vault');
  useEffect(() => { const f = (e: Event) => setOn((e as CustomEvent).detail === 'vault'); window.addEventListener('pstudio-page', f); return () => window.removeEventListener('pstudio-page', f); }, []);
  return on;
}

const ICON = {
  shield: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  swap: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>,
  wallet: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h13a2 2 0 002-2v-2" /><path d="M22 11h-6a2 2 0 000 4h6v-4z" /></svg>,
  bolt: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg>,
  send: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z" /></svg>,
  gear: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>,
  x: <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>,
};

/** Page Coffre-fort : mettre ses SOL à l'abri des baisses en USDT ou USDC, à la main ou automatiquement */
export function VaultPage() {
  const visible = useVisible();
  const ctx = useCtx();
  const { user } = useAuth();
  const srvSt = useServerWallet();
  const [realBal, setBal] = useState<{ SOL: number; USDT: number; USDC: number } | null>(null);
  const [balErr, setBalErr] = useState<string | null>(null);
  const [market, setMarket] = useState<{ price: number; change24: number } | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [dests, setDests] = useState<Dest[] | null>(null);
  const [moves, setMoves] = useState<Move[] | null>(null);
  const account = !!user;
  // wallet du coffre : un wallet rapide (n°…) ou le wallet connecté (Phantom…), choisi sur cet appareil
  const PICK = 'ts_vault_wallet';
  const [pick, setPick] = useState<string | null>(() => { try { return localStorage.getItem(PICK); } catch { return null; } });
  const extW = studio()?.hub?.state().ext ?? null;
  const options: NonNullable<Ctx['wallet']>[] = [
    ...(srvSt?.wallets ?? []).map((w) => ({ kind: 'server' as const, pk: w.address, name: srvLabel(w) })),
    ...(extW ? [{ kind: 'ext' as const, pk: extW.pk, name: extW.name }] : []),
  ];
  const chosen = options.find((o) => o.pk === pick) ?? (ctx?.wallet && options.find((o) => o.pk === ctx.wallet!.pk)) ?? options[0] ?? null;
  const choose = (pk: string) => { setPick(pk); try { localStorage.setItem(PICK, pk); } catch { /* navigation privée */ } };
  const vctx: Ctx | null = ctx ? { ...ctx, wallet: chosen } : null;

  const refreshBal = useCallback(async () => {
    if (!chosen) { setBal(null); return; }
    try { setBal(await balances(chosen.pk)); setBalErr(null); } catch (e) { setBalErr(readable(e)); }
  }, [chosen?.pk]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBal(null); }, [chosen?.pk]);
  const bal = realBal;
  const latest = useRef({ refreshBal, refreshLists: async () => {} });
  const refreshLists = useCallback(async () => {
    if (!account) { setRules([]); setDests([]); setMoves([]); return; }
    const [r, d, m] = await Promise.all([loadRules(), loadDests(), loadMoves()]);
    setRules(r); setDests(d); setMoves(m);
  }, [account]);

  useEffect(() => { if (!visible) return; refreshBal(); const t = setInterval(() => { if (!document.hidden) refreshBal(); }, 20_000); return () => clearInterval(t); }, [visible, refreshBal]);
  useEffect(() => { if (visible) refreshLists(); }, [visible, refreshLists]);
  useEffect(() => { if (!visible) return; const f = () => solMarket().then(setMarket).catch(() => {}); f(); const t = setInterval(f, 60_000); return () => clearInterval(t); }, [visible]);

  latest.current = { refreshBal, refreshLists };
  const after = () => { latest.current.refreshBal(); latest.current.refreshLists(); setTimeout(() => latest.current.refreshBal(), 4000); };
  const price = market?.price ?? ctx?.solUsd ?? null;
  const stableTotal = bal ? bal.USDT + bal.USDC : 0, solUsdV = bal && price ? bal.SOL * price : null;
  const total = solUsdV != null ? solUsdV + stableTotal : null;
  const share = total ? (stableTotal / total) * 100 : 0;
  if (!visible || !ctx || !vctx) return null;

  return (
    <div className="vt">
      <div className="vt-top">
        <VaultSettings options={options} chosen={chosen} onChoose={choose} />
      </div>
      <section className="card vt-hero">
        <div className="vt-hero-l">
          <span className="vt-eyebrow">{ICON.shield}Valeur protégée</span>
          <b className="vt-big mono">{bal ? usd(stableTotal) : '…'}</b>
          <span className="vt-sub">{bal ? <>{nf(bal.USDT)} USDT · {nf(bal.USDC)} USDC</> : balErr ?? 'Lecture des soldes…'}</span>
        </div>
        <div className="vt-hero-r">
          <div className="vt-kv"><span>SOL exposé au marché</span><b>{bal ? <Sol v={bal.SOL} d={4} /> : '…'}</b></div>
          <div className="vt-kv"><span>Valeur totale</span><b className="mono">{usd(total)}</b></div>
          <div className="vt-kv"><span>SOL sur 24 h</span><b className={'mono ' + (market ? (market.change24 >= 0 ? 'up' : 'down') : '')}>{market ? (market.change24 >= 0 ? '+' : '−') + nf(Math.abs(market.change24)) + ' %' : '—'}</b><small className="dim">{market ? '1 SOL = ' + usd(market.price) : ''}</small></div>
        </div>
        <div className="vt-split" aria-label={'Part protégée : ' + nf(share, 0) + ' %'}>
          <div className="vt-split-bar"><i style={{ width: Math.min(100, share) + '%' }} /></div>
          <span><b>{nf(share, 0)} %</b> à l'abri en dollars · {nf(100 - share, 0)} % en SOL</span>
        </div>
      </section>

      <VaultChart wallet={chosen?.pk ?? null} moves={moves} stableNow={bal ? stableTotal : null} />

      {!vctx.wallet && <div className="ts-note warn">Connectez un wallet (menu en haut à droite) ou créez votre wallet rapide pour utiliser le coffre-fort.</div>}

      {/* deux colonnes : conversion et mouvements à gauche, automatismes et destinations à droite */}
      <div className="vt-cols">
        <div className="vt-col">
          <ConvertCard ctx={vctx} bal={bal} price={price} onDone={after} />
          <HistoryCard moves={moves} account={account} />
        </div>
        <div className="vt-col">
          <RulesCard ctx={vctx} account={account} rules={rules} dests={dests} hasServer={!!srvSt?.address} serverActive={vctx.wallet?.kind === 'server'} onChange={refreshLists} />
          <DestCard ctx={vctx} account={account} dests={dests} bal={bal} onChange={after} />
        </div>
      </div>
      <p className="dim vt-foot">Les conversions passent par Jupiter, au meilleur prix du marché. L'USDT (Tether) et l'USDC (Circle) suivent le dollar mais dépendent de leur émetteur. Rien de ceci n'est un conseil en investissement.</p>
    </div>
  );
}

/* ---------- réglages du coffre : wallet qui convertit, envoie et applique les règles ---------- */
type Opt = NonNullable<Ctx['wallet']>;
function VaultSettings({ options, chosen, onChoose }: { options: Opt[]; chosen: Opt | null; onChoose: (pk: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="vt-set" ref={root}>
      <button type="button" className="btn sm vt-set-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        {ICON.gear}<span>Réglages</span><small className="dim">{chosen ? chosen.name : 'aucun wallet'}</small>
      </button>
      {open && (
        <div className="vt-set-pop" role="dialog" aria-label="Réglages du coffre">
          <div className="vt-set-h"><b>Wallet du coffre</b><small className="dim">Celui qui convertit, envoie et applique vos règles automatiques. Choix gardé sur cet appareil.</small></div>
          {options.length ? (
            <div className="vt-set-list" role="radiogroup" aria-label="Wallet du coffre">
              {options.map((o) => (
                <label key={o.pk} className={chosen?.pk === o.pk ? 'on' : ''}>
                  <input type="radio" name="vt-wallet" checked={chosen?.pk === o.pk} onChange={() => { onChoose(o.pk); setOpen(false); }} />
                  <span><b>{o.name}</b><small className="mono dim">{short(o.pk)} · {o.kind === 'server' ? 'signe seul' : 'signature dans ' + o.name}</small></span>
                </label>
              ))}
            </div>
          ) : <p className="dim vt-small">Aucun wallet disponible : connectez un wallet ou créez un wallet rapide.</p>}
          <button type="button" className="btn sm ghost" onClick={() => { setOpen(false); openServerWallet('create'); }}>+ Nouveau wallet rapide</button>
        </div>
      )}
    </div>
  );
}

/* ---------- conversion ---------- */
function ConvertCard({ ctx, bal, price, onDone }: { ctx: Ctx; bal: { SOL: number; USDT: number; USDC: number } | null; price: number | null; onDone: () => void }) {
  const [dir, setDir] = useState<'protect' | 'release'>('protect');
  const [stable, setStable] = useState<Stable>('USDT');
  const [v, setV] = useState('');
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from: Asset = dir === 'protect' ? 'SOL' : stable, to: Asset = dir === 'protect' ? stable : 'SOL';
  const avail = bal ? (dir === 'protect' ? Math.max(0, bal.SOL - SOL_KEEP) : bal[stable]) : 0;
  const n = parse(v);
  // devis automatique (0,5 s après la saisie)
  useEffect(() => {
    setQ(null); setQErr(null);
    if (!(n > 0)) return;
    const t = setTimeout(() => { getQuote(from, to, n).then(setQ).catch((e) => setQErr(readable(e))); }, 500);
    return () => clearTimeout(t);
  }, [n, from, to]);
  const warn = !(n > 0) ? null : n > avail + 1e-9 ? 'Solde insuffisant' + (dir === 'protect' ? ' (0,02 SOL restent pour les frais)' : '') + '.' : dir === 'protect' && n < 0.01 ? 'Minimum 0,01 SOL.' : dir === 'release' && n < 1 ? 'Minimum 1 ' + stable + '.' : null;
  const can = !!ctx.wallet && n > 0 && !warn && !busy;
  async function go() {
    setBusy(true);
    try {
      const r = await convert(ctx, from, to, n);
      toast(dir === 'protect' ? 'SOL mis à l\'abri' : 'SOL récupérés', amt(n) + ' ' + from + ' → ' + amt(r.out, dir === 'protect' ? 2 : 4) + ' ' + to);
      setV(''); onDone();
    } catch (e) { toast('Conversion impossible', readable(e), 'r'); } finally { setBusy(false); }
  }
  return (
    <section className="card vt-conv">
      <div className="card-h"><h3>{ICON.swap} Convertir</h3><p>Mettez vos SOL à l'abri d'une baisse, puis reprenez-les quand vous voulez.</p></div>
      <div className="vt-dir" role="tablist" aria-label="Sens">
        <button type="button" role="tab" aria-selected={dir === 'protect'} className={dir === 'protect' ? 'on' : ''} onClick={() => { setDir('protect'); setV(''); }}>Protéger · SOL → dollars</button>
        <button type="button" role="tab" aria-selected={dir === 'release'} className={dir === 'release' ? 'on' : ''} onClick={() => { setDir('release'); setV(''); }}>Reprendre · dollars → SOL</button>
      </div>
      <div className="vt-stable" role="group" aria-label="Monnaie stable">
        {(['USDT', 'USDC'] as Stable[]).map((s) => <button key={s} type="button" className={stable === s ? 'on' : ''} aria-pressed={stable === s} onClick={() => setStable(s)}><span className={'vt-coin ' + s.toLowerCase()} aria-hidden="true">$</span>{s}<small>{s === 'USDT' ? 'Tether' : 'Circle'}</small></button>)}
      </div>
      <label className="vt-in">
        <span className="vt-lbl">Montant</span>
        <span className="vt-in-box"><input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" aria-label={'Montant en ' + from} /><em>{from}</em></span>
        <small className="dim">Disponible : {bal ? amt(avail, dir === 'protect' ? 4 : 2) + ' ' + from : '…'}{dir === 'protect' && price && n > 0 ? ' · ≈ ' + usd(n * price) : ''}</small>
      </label>
      <div className="vt-quick">{[25, 50, 75, 100].map((p) => <button key={p} type="button" disabled={!avail} onClick={() => setV(String(Math.floor(avail * p / 100 * (dir === 'protect' ? 1e4 : 1e2)) / (dir === 'protect' ? 1e4 : 1e2)))}>{p === 100 ? 'Max' : p + ' %'}</button>)}</div>
      <dl className="vt-quote">
        <dt>Vous recevez environ</dt><dd className="mono">{q ? amt(q.out, dir === 'protect' ? 2 : 4) + ' ' + to : qErr ? '—' : n > 0 ? '…' : '—'}</dd>
        {q && <><dt>Minimum garanti</dt><dd className="mono">{amt(q.minOut, dir === 'protect' ? 2 : 4)} {to}</dd>
          <dt>Taux</dt><dd className="mono">1 SOL = {nf(q.rate)} $</dd>
          <dt>Impact sur le prix</dt><dd className={'mono ' + (q.impact > 0.5 ? 'warn' : '')}>{nf(q.impact, 3)} %</dd>
          {q.route.length > 0 && <><dt>Chemin</dt><dd className="dim">{q.route.join(' → ')}</dd></>}</>}
      </dl>
      {(warn || qErr) && <p className="vt-warn">{warn ?? qErr}</p>}
      <button type="button" className={'btn primary vt-go ' + dir} disabled={!can} onClick={go}>
        {busy ? (ctx.wallet?.kind === 'ext' ? 'Signature dans votre wallet…' : 'Conversion…') : dir === 'protect' ? 'Protéger ' + (n > 0 ? amt(n) + ' SOL' : 'mes SOL') : 'Reprendre ' + (n > 0 ? amt(n, 2) + ' ' + stable : 'mes SOL')}
      </button>
      <p className="dim vt-small">{ctx.wallet?.kind === 'server' ? 'Votre wallet rapide signe aussitôt, sans fenêtre. Les fonds restent dans votre wallet.' : 'Votre wallet vous présentera la transaction à signer. Les fonds restent dans votre wallet.'}</p>
    </section>
  );
}

/* ---------- règles automatiques ---------- */
const KINDS: { k: RuleKind; t: string; d: string }[] = [
  { k: 'surplus', t: 'Garder un solde SOL fixe', d: 'Au-dessus d\'un seuil, le surplus de SOL passe en dollars.' },
  { k: 'drop', t: 'Se protéger d\'une chute', d: 'Si le SOL baisse fortement en 24 h, une part passe en dollars.' },
  { k: 'profit', t: 'Sécuriser mes gains', d: 'Une part du SOL de chaque vente de token passe en dollars.' },
  { k: 'schedule', t: 'Épargne régulière', d: 'Un montant fixe passe en dollars chaque jour ou chaque semaine.' },
  { k: 'send', t: 'Envoyer vers une plateforme', d: 'Dès qu\'un montant est atteint, les dollars partent vers votre adresse (Binance…).' },
];
function describe(r: Rule, dests: Dest[] | null) {
  const p = r.params, s = r.stable;
  switch (r.kind) {
    case 'surplus': return 'Au-dessus de ' + amt(Number(p.above)) + ' SOL, garder ' + amt(Number(p.keep)) + ' SOL et mettre le reste en ' + s + '.';
    case 'drop': return 'Si le SOL perd ' + amt(Number(p.drop), 1) + ' % en 24 h, mettre ' + amt(Number(p.pct), 0) + ' % de mes SOL en ' + s + ' (une fois par jour au plus).';
    case 'profit': return 'Mettre ' + amt(Number(p.pct), 0) + ' % du SOL de chaque vente en ' + s + '.';
    case 'schedule': return 'Mettre ' + amt(Number(p.amount)) + ' SOL en ' + s + (p.every === 'week' ? ' chaque semaine.' : ' chaque jour.');
    case 'send': { const d = dests?.find((x) => x.address === p.to); return 'Dès ' + amt(Number(p.min), 2) + ' ' + s + ', tout envoyer vers ' + (d?.label || short(String(p.to))) + '.'; }
  }
}
function RulesCard({ ctx, account, rules, dests, hasServer, serverActive, onChange }: { ctx: Ctx; account: boolean; rules: Rule[] | null; dests: Dest[] | null; hasServer: boolean; serverActive: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(key); try { await fn(); if (ok) toast(ok); onChange(); } catch (e) { toast('Action impossible', readable(e), 'r'); } finally { setBusy(null); } };
  let body: ReactNode;
  if (!account) body = <div className="empty"><b>Connectez-vous pour automatiser</b><span>Les règles automatiques sont enregistrées sur votre compte et surveillées en continu.</span></div>;
  else body = (<>
    <div className={'ts-note ' + (serverActive ? 'good' : 'info')}>
      {serverActive ? <><b>Automatique.</b> Les nouvelles règles sont appliquées par le <b>{ctx.wallet?.name}</b>, même outil fermé (vérification chaque minute).</>
        : hasServer ? <>Avec {ctx.wallet?.name ?? 'ce wallet'}, chaque conversion demande votre signature. Choisissez un <b>wallet rapide</b> dans les réglages du coffre pour que les règles s'appliquent seules.</>
        : <>Avec {ctx.wallet?.name ?? 'votre wallet'}, chaque conversion demande votre signature : vous recevez une notification quand une règle se déclenche. <button type="button" className="btn sm" onClick={() => openServerWallet('create')}>Créer le wallet rapide</button> pour tout automatiser.</>}
    </div>
    {!rules ? <div className="empty"><b>Chargement…</b></div> : !rules.length && !adding ? <div className="empty"><b>Aucune règle</b><span>Ajoutez-en une pour protéger vos SOL sans y penser.</span></div> : (
      <ul className="vt-rules">{rules.map((r) => {
        const K = KINDS.find((x) => x.k === r.kind)!, lr = r.last_result as { ok?: boolean; error?: string; notified?: boolean } | null;
        return (
          <li key={r.id} className={r.active ? '' : 'off'}>
            <div className="vt-rule-t"><b>{K.t}{(() => { const w = srvByAddress(String(r.params.wallet ?? '')); return <em className="vt-rule-w"> · {w ? srvLabel(w) : 'Wallet rapide n°1'}</em>; })()}</b><span>{describe(r, dests)}</span>
              <small className="dim">{lr?.ok === false ? <span className="down">Dernier essai en échec : {lr.error}</span> : r.last_run_at ? (lr?.notified ? 'Notification envoyée ' : 'Exécutée ') + ago(r.last_run_at) : 'Pas encore déclenchée'}</small></div>
            <label className="vt-switch" title={r.active ? 'Désactiver' : 'Activer'}><input type="checkbox" checked={r.active} disabled={!!busy} onChange={(e) => run(r.id, () => vault('rule_toggle', { id: r.id, active: e.target.checked }))} /><span aria-hidden="true" /><em className="sr">{r.active ? 'Active' : 'En pause'}</em></label>
            <button type="button" className="vt-x" aria-label="Supprimer la règle" disabled={!!busy} onClick={() => { if (window.confirm('Supprimer cette règle ?')) run(r.id, () => vault('rule_delete', { id: r.id }), 'Règle supprimée'); }}>{ICON.x}</button>
          </li>
        );
      })}</ul>
    )}
    {adding ? <RuleForm wallet={serverActive ? ctx.wallet?.pk ?? null : null} dests={dests ?? []} hasServer={hasServer} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onChange(); }} />
      : <button type="button" className="btn vt-add" disabled={(rules?.length ?? 0) >= 10} onClick={() => setAdding(true)}>+ Ajouter une règle</button>}
  </>);
  return (
    <section className="card vt-rulescard">
      <div className="card-h"><h3>{ICON.bolt} Règles automatiques</h3><p>Le coffre agit pour vous, selon vos conditions.</p></div>
      {body}
    </section>
  );
}
function RuleForm({ wallet, dests, hasServer, onCancel, onSaved }: { wallet: string | null; dests: Dest[]; hasServer: boolean; onCancel: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<RuleKind>('surplus');
  const [stable, setStable] = useState<Stable>('USDT');
  const [p, setP] = useState<Record<string, string>>({ above: '5', keep: '2', drop: '10', pct: '50', amount: '0.5', every: 'week', min: '100', to: dests[0]?.address ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setP((o) => ({ ...o, [k]: e.target.value }));
  const field = (k: string, label: string, unit: string, help?: string) => (
    <label className="vt-f"><span>{label}</span><span className="vt-in-box sm"><input inputMode="decimal" value={p[k]} onChange={set(k)} /><em>{unit}</em></span>{help && <small className="dim">{help}</small>}</label>
  );
  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    const P: Record<string, number | string> = {};
    const nums: Record<RuleKind, string[]> = { surplus: ['above', 'keep'], drop: ['drop', 'pct'], profit: ['pct'], schedule: ['amount'], send: ['min'] };
    for (const k of nums[kind]) P[k] = parse(p[k] ?? '');
    if (kind === 'schedule') P.every = p.every!;
    if (kind === 'send') P.to = p.to!;
    if (wallet) P.wallet = wallet;
    try { await vault('rule_save', { kind, stable, params: P }); toast('Règle enregistrée', KINDS.find((x) => x.k === kind)!.t); onSaved(); }
    catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }
  const sendOk = hasServer && dests.length > 0;
  return (
    <form className="vt-ruleform" onSubmit={save}>
      <div className="vt-kinds" role="radiogroup" aria-label="Type de règle">
        {KINDS.map((x) => (
          <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} className={kind === x.k ? 'on' : ''} disabled={x.k === 'send' && !sendOk} onClick={() => setKind(x.k)} title={x.k === 'send' && !sendOk ? (hasServer ? 'Enregistrez d\'abord une adresse de destination.' : 'Demande le wallet rapide.') : undefined}>
            <b>{x.t}</b><small>{x.d}</small>
          </button>
        ))}
      </div>
      <div className="vt-fields">
        {kind === 'surplus' && <>{field('above', 'Seuil', 'SOL', 'Quand votre solde dépasse ce montant…')}{field('keep', 'SOL à garder', 'SOL', '…il redescend à ce montant.')}</>}
        {kind === 'drop' && <>{field('drop', 'Baisse du SOL sur 24 h', '%')}{field('pct', 'Part de vos SOL à protéger', '%')}</>}
        {kind === 'profit' && field('pct', 'Part de chaque vente', '%', 'Ventes faites avec le wallet rapide.')}
        {kind === 'schedule' && <>{field('amount', 'Montant', 'SOL')}<label className="vt-f"><span>Fréquence</span><select value={p.every} onChange={set('every')}><option value="day">Chaque jour</option><option value="week">Chaque semaine</option></select></label></>}
        {kind === 'send' && <>{field('min', 'Dès que le coffre contient', stable)}<label className="vt-f"><span>Vers</span><select value={p.to} onChange={set('to')}>{dests.map((d) => <option key={d.id} value={d.address}>{(d.label || 'Adresse') + ' · ' + short(d.address)}</option>)}</select></label></>}
        <label className="vt-f"><span>{kind === 'send' ? 'Monnaie envoyée' : 'Convertir en'}</span><select value={stable} onChange={(e) => setStable(e.target.value as Stable)}><option value="USDT">USDT (Tether)</option><option value="USDC">USDC (Circle)</option></select></label>
      </div>
      {kind === 'send' && <p className="dim vt-small">Un code de confirmation vous sera demandé : cette règle envoie des fonds hors de votre wallet.</p>}
      {err && <div className="ts-note bad" role="alert">{err}</div>}
      <div className="ts-row"><button type="button" className="btn ghost" onClick={onCancel}>Annuler</button><button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la règle'}</button></div>
    </form>
  );
}

/* ---------- destinations (dépôt Binance…) et envois ---------- */
function DestCard({ ctx, account, dests, bal, onChange }: { ctx: Ctx; account: boolean; dests: Dest[] | null; bal: { SOL: number; USDT: number; USDC: number } | null; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('Binance');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState<Dest | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy('add');
    try { await vault('addr_add', { address: addr.trim(), label: label.trim() }); toast('Adresse enregistrée', 'Elle pourra recevoir des fonds dans 24 heures.'); setAdding(false); setAddr(''); onChange(); }
    catch (e2) { setErr(readable(e2)); } finally { setBusy(null); }
  }
  const ready = (d: Dest) => Date.now() - Date.parse(d.created_at) >= 24 * 3600_000;
  return (
    <section className="card vt-dests">
      <div className="card-h"><h3>{ICON.send} Destinations</h3><p>Vos adresses de dépôt (Binance, autre plateforme ou wallet) pour y envoyer vos dollars.</p></div>
      {!account ? <div className="empty"><b>Connectez-vous pour enregistrer des adresses</b></div> : (<>
        {!dests ? <div className="empty"><b>Chargement…</b></div> : !dests.length && !adding ? <div className="empty"><b>Aucune adresse</b><span>Ajoutez votre adresse de dépôt USDT Binance (réseau Solana).</span></div> : (
          <ul className="vt-dlist">{dests.map((d) => (
            <li key={d.id}>
              <span className="vt-d-ic" aria-hidden="true">{(d.label || '?').slice(0, 2).toUpperCase()}</span>
              <span className="vt-d-t"><b>{d.label || 'Adresse'}</b><small className="mono">{short(d.address)}</small></span>
              {ready(d) ? <button type="button" className="btn sm" onClick={() => setSending(d)}>Envoyer</button> : <em className="badge">active dans {Math.ceil(24 - (Date.now() - Date.parse(d.created_at)) / 3600_000)} h</em>}
              <button type="button" className="vt-x" aria-label="Supprimer l'adresse" disabled={!!busy} onClick={async () => { if (!window.confirm('Supprimer cette adresse ? Les règles d\'envoi vers elle seront mises en pause.')) return; setBusy(d.id); try { await vault('addr_delete', { id: d.id }); onChange(); } catch (e) { toast('Suppression impossible', readable(e), 'r'); } finally { setBusy(null); } }}>{ICON.x}</button>
            </li>
          ))}</ul>
        )}
        {sending && <SendForm ctx={ctx} dest={sending} bal={bal} onClose={() => setSending(null)} onDone={() => { setSending(null); onChange(); }} />}
        {adding ? (
          <form className="vt-addform" onSubmit={add}>
            <label className="vt-f"><span>Nom</span><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} placeholder="Binance" /></label>
            <label className="vt-f"><span>Adresse Solana</span><input className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Adresse de dépôt" spellCheck={false} autoComplete="off" /></label>
            <div className="ts-note info vt-howto"><b>Dans Binance :</b> Portefeuille → Dépôt → choisissez <b>USDT</b> (ou USDC) → réseau <b>Solana (SOL)</b> → copiez l'adresse. Un autre réseau ferait perdre les fonds.</div>
            {err && <div className="ts-note bad" role="alert">{err}</div>}
            <p className="dim vt-small">Un code de confirmation vous sera demandé. Par sécurité, l'adresse ne peut rien recevoir pendant 24 heures, et vous êtes prévenu par e-mail.</p>
            <div className="ts-row"><button type="button" className="btn ghost" onClick={() => setAdding(false)}>Annuler</button><button className="btn primary" disabled={busy === 'add' || !addr.trim()}>{busy === 'add' ? 'Enregistrement…' : 'Enregistrer'}</button></div>
          </form>
        ) : <button type="button" className="btn vt-add" disabled={(dests?.length ?? 0) >= 10} onClick={() => setAdding(true)}>+ Ajouter une adresse</button>}
      </>)}
    </section>
  );
}
function SendForm({ ctx, dest, bal, onClose, onDone }: { ctx: Ctx; dest: Dest; bal: { SOL: number; USDT: number; USDC: number } | null; onClose: () => void; onDone: () => void }) {
  const server = ctx.wallet?.kind === 'server';
  const [asset, setAsset] = useState<Asset>('USDT');
  const [v, setV] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const have = bal ? bal[asset] : 0, n = parse(v);
  async function go(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const sig = await sendTo(ctx, asset, dest.address, n >= have - 1e-9 && server ? 'max' : n, pw);
      toast('Envoi effectué', amt(n, 4) + ' ' + asset + ' vers ' + (dest.label || short(dest.address)) + ' · ' + short(sig));
      onDone();
    } catch (e2) { setErr(readable(e2)); } finally { setBusy(false); }
  }
  const assets: Asset[] = server ? ['USDT', 'USDC', 'SOL'] : ['USDT', 'USDC'];
  return (
    <form className="vt-sendform" onSubmit={go}>
      <b>Envoyer vers {dest.label || short(dest.address)}</b>
      <div className="vt-stable sm" role="group" aria-label="Monnaie">{assets.map((a) => <button key={a} type="button" className={asset === a ? 'on' : ''} aria-pressed={asset === a} onClick={() => setAsset(a)}>{a}</button>)}</div>
      <label className="vt-f"><span>Montant · disponible {amt(have, asset === 'SOL' ? 4 : 2)} {asset}</span><span className="vt-in-box sm"><input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.,]/g, ''))} /><em>{asset}</em><button type="button" className="vt-max" onClick={() => setV(String(asset === 'SOL' ? Math.max(0, Math.floor((have - 0.001) * 1e4) / 1e4) : Math.floor(have * 100) / 100))}>Max</button></span></label>
      {server && <label className="vt-f"><span>Mot de passe du wallet rapide</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>}
      {err && <div className="ts-note bad" role="alert">{err}</div>}
      <div className="ts-row"><button type="button" className="btn ghost" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy || !(n > 0) || n > have + 1e-9 || (server && !pw)}>{busy ? 'Envoi…' : 'Envoyer'}</button></div>
    </form>
  );
}

/* ---------- historique ---------- */
function HistoryCard({ moves, account }: { moves: Move[] | null; account: boolean }) {
  const list: Move[] = moves ?? [];
  return (
    <section className="card vt-hist">
      <div className="card-h"><h3>Historique</h3><p>Conversions et envois du coffre.</p></div>
      {!account ? <div className="empty"><b>Aucun historique</b></div> : !list.length ? <div className="empty"><b>Rien pour l'instant</b><span>Vos conversions apparaîtront ici.</span></div> : (
        <ul className="vt-moves">{list.map((m, i) => (
          <li key={m.id ?? i}>
            <span className={'vt-m-ic ' + m.kind} aria-hidden="true">{m.kind === 'protect' ? '↓' : m.kind === 'release' ? '↑' : '→'}</span>
            <span className="vt-m-t"><b>{m.kind === 'protect' ? 'Mis à l\'abri' : m.kind === 'release' ? 'Repris en SOL' : 'Envoyé'}{m.auto && <em className="badge">auto</em>}{m.status === 'err' && <em className="badge r">échec</em>}</b>
              <small className="dim">{ago(m.created_at)}{m.dest ? ' · vers ' + short(m.dest) : ''}{m.signature ? <> · <a href={'https://solscan.io/tx/' + m.signature} target="_blank" rel="noopener noreferrer">Solscan</a></> : null}</small></span>
            <span className="vt-m-v mono">{m.kind === 'send' ? amt(Number(m.stable_amount), 2) + ' ' + m.stable : m.kind === 'protect' ? amt(Number(m.sol)) + ' SOL → ' + amt(Number(m.stable_amount), 2) + ' ' + m.stable : amt(Number(m.stable_amount), 2) + ' ' + m.stable + ' → ' + amt(Number(m.sol)) + ' SOL'}</span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
