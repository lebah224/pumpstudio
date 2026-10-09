import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, walletOf } from '../auth/AuthContext';
import { studio, toast } from '../legacy/bridge';
import { supabase } from '../lib/supabase';
import { pwError } from '../lib/password';
import { PasswordMeter } from '../ui/PasswordMeter';
import { createServerWallet, deleteServerWallet, exportServerWallet, importServerWallet, setServerLimits, useServerWallet, withdrawServerWallet } from './api';

export type SrvMode = 'create' | 'withdraw' | 'limits' | 'export' | 'delete';
export const openServerWallet = (mode: SrvMode) => window.dispatchEvent(new CustomEvent('ts-srv', { detail: mode }));

const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);
const nf = (n: number, d = 4) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });

/** Fenêtre du wallet rapide serveur : création, retrait, plafonds, export de la clé, suppression */
export function ServerWalletDialog() {
  const { user } = useAuth();
  const srv = useServerWallet();
  const [mode, setMode] = useState<SrvMode | null>(null);
  const [how, setHow] = useState<'new' | 'move' | 'key'>('new');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [secret, setSecret] = useState(''); const [ack, setAck] = useState(false);
  const [to, setTo] = useState(''); const [amount, setAmount] = useState(''); const [all, setAll] = useState(false);
  const [cap, setCap] = useState(''); const [alert, setAlert] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [linked, setLinked] = useState<{ address: string; wait: number }[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  // ancien wallet rapide du navigateur : peut devenir le wallet rapide du compte (même adresse)
  const quick = studio()?.hub?.state().quickSaved ?? null;

  useEffect(() => {
    const f = (e: Event) => {
      const m = (e as CustomEvent).detail as SrvMode;
      setMode(m); setErr(null); setPw(''); setPw2(''); setSecret(''); setAck(false); setShown(null); setAmount(''); setAll(false);
      setHow(quick ? 'move' : 'new');
      setCap(String(srv?.daily_cap_sol ?? 10)); setAlert(String(srv?.alert_balance_sol ?? 5));
      // un wallet ajouté il y a moins de 24 h ne reçoit pas encore de retraits (sauf le wallet de connexion du compte)
      if (m === 'withdraw' && user) supabase.from('wallets').select('address, verified_at').eq('user_id', user.id).then(({ data }) => {
        const own = walletOf(user);
        const l = (data ?? []).map((x) => ({ address: x.address as string, wait: x.address === own ? 0 : Math.max(0, Math.ceil(24 - (Date.now() - Date.parse(x.verified_at as string)) / 3600_000)) }));
        setLinked(l); setTo(l.find((x) => !x.wait)?.address ?? '');
      });
    };
    window.addEventListener('ts-srv', f); return () => window.removeEventListener('ts-srv', f);
  }, [srv, user, quick]);
  if (!mode || !user) return null;
  const close = () => { setMode(null); setShown(null); setPw(''); };

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (mode === 'create') {
        const weak = pwError(pw); if (weak) throw new Error(weak);
        if (pw !== pw2) throw new Error('Les deux mots de passe sont différents.');
        if (!ack) throw new Error('Coche la case pour confirmer.');
        let addr: string;
        if (how === 'new') addr = await createServerWallet(pw);
        else if (how === 'move') {
          const h = studio()?.hub; let kp = h?.quickKeypair();
          if (!kp && (await h?.quickUnlock())) kp = h?.quickKeypair();
          if (!kp) throw new Error('Déverrouille d\'abord ton wallet rapide.');
          const b58 = (window.PumpStudio as unknown as { b58: (u: Uint8Array) => string }).b58;
          addr = await importServerWallet(pw, b58(kp.secretKey));
          h?.legacyDrop();   // un seul wallet rapide : la copie du navigateur est retirée
        } else addr = await importServerWallet(pw, secret.trim());
        await studio()?.hub?.useServer(true);
        toast('Wallet rapide prêt', short(addr) + ' signe maintenant tes transactions, sans fenêtre de confirmation.');
        close(); return;
      }
      if (!pw) throw new Error('Saisis le mot de passe du wallet rapide.');
      if (mode === 'withdraw') {
        if (!to) throw new Error('Choisis un wallet de destination.');
        const n = Number(amount.replace(',', '.'));
        if (!all && !(n > 0)) throw new Error('Montant invalide.');
        const r = await withdrawServerWallet(pw, to, all ? 'max' : n);
        toast('Retrait envoyé', nf(r.sol) + ' SOL → ' + short(to)); close();
      } else if (mode === 'limits') {
        await setServerLimits(pw, Number(cap.replace(',', '.')), Number(alert.replace(',', '.')));
        toast('Plafonds enregistrés', ''); close();
      } else if (mode === 'export') {
        setShown(await exportServerWallet(pw)); setPw('');
      } else if (mode === 'delete') {
        await deleteServerWallet(pw, ack); toast('Wallet rapide supprimé', '', 'a'); close();
      }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  const PW = (label = 'Mot de passe du wallet rapide', auto = 'current-password') => <label className="field"><span className="ts-lbl">{label}</span><input type="password" autoComplete={auto} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>;
  const TITLE: Record<SrvMode, string> = { create: 'Créer mon wallet rapide', withdraw: 'Retirer vers ton wallet', limits: 'Plafonds du wallet rapide', export: 'Exporter la clé privée', delete: 'Supprimer le wallet rapide' };

  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label={TITLE[mode]} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form className="ts-modal-box ts-srv" onSubmit={submit}>
        <button type="button" className="ts-x" aria-label="Fermer" onClick={close}>×</button>
        <div className="ts-si-h"><b>{TITLE[mode]}</b>
          <span>{mode === 'create' ? 'Un wallet de trading rattaché à ton compte : sa clé est gardée chiffrée sur le serveur. Il signe seul, sans fenêtre de confirmation, dans la limite de tes plafonds : trades et ventes automatiques de tes ordres.'
            : mode === 'withdraw' ? 'Les retraits ne vont que vers les wallets liés à ton compte depuis plus de 24 heures. Un code de confirmation te sera demandé.'
            : mode === 'limits' ? 'Le serveur refuse toute dépense au-delà du plafond du jour.'
            : mode === 'export' ? 'La clé donne un accès total aux fonds de ce wallet. Garde-la hors ligne et ne la partage avec personne.'
            : 'La clé chiffrée est effacée du serveur. Sans export préalable, les fonds restants seraient perdus.'}</span></div>

        {mode === 'create' && (<>
          <div className="seg sm ts-srv-how" role="group" aria-label="Origine du wallet">
            {quick && <button type="button" className={how === 'move' ? 'on' : ''} onClick={() => setHow('move')}>Mon ancien wallet rapide</button>}
            <button type="button" className={how === 'new' ? 'on' : ''} onClick={() => setHow('new')}>Nouveau wallet</button>
            <button type="button" className={how === 'key' ? 'on' : ''} onClick={() => setHow('key')}>Clé privée</button>
          </div>
          {how === 'move' && quick && <p className="muted ts-small">Ton ancien wallet rapide <b className="mono">{short(quick.pk)}</b> devient le wallet rapide de ton compte, à la même adresse et avec ses fonds. Rien n'est transféré sur la blockchain.</p>}
          {how === 'key' && <label className="field"><span className="ts-lbl">Clé privée (base58 ou tableau de 64 nombres)</span><input value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
          {PW('Mot de passe du wallet rapide', 'new-password')}
          <PasswordMeter value={pw} />
          <label className="field"><span className="ts-lbl">Confirme le mot de passe</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          <ul className="ts-srv-rules">
            <li>Il ne signe que des achats, ventes, lancements et récupérations de frais : jamais de virement ni de transfert de tokens.</li>
            <li>Plafond de dépense : 10 SOL par jour, réglable. Ta limite par achat s'applique aussi.</li>
            <li>Retraits uniquement vers tes wallets liés depuis plus de 24 h, avec ce mot de passe et un code de confirmation.</li>
          </ul>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Je comprends que TokenStudio garde la clé de ce wallet. Je n'y laisse que ce que je suis prêt à risquer.</span></label>
        </>)}

        {mode === 'withdraw' && (<>
          {linked.length ? (
            <label className="field"><span className="ts-lbl">Vers</span><select value={to} onChange={(e) => setTo(e.target.value)}>{linked.map((a) => <option key={a.address} value={a.address} disabled={a.wait > 0}>{short(a.address) + (a.wait > 0 ? ' · disponible dans ' + a.wait + ' h' : '')}</option>)}</select></label>
          ) : <div className="ts-note warn">Aucun wallet lié à ton compte. Ajoute d'abord ton Phantom (menu en haut à droite → Ajouter un wallet).</div>}
          <label className="field"><span className="ts-lbl">Montant (SOL)</span><input inputMode="decimal" value={all ? '' : amount} disabled={all} onChange={(e) => setAmount(e.target.value)} placeholder="ex. 0,5" /></label>
          <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Tout retirer</span></label>
          {PW()}
        </>)}

        {mode === 'limits' && (<>
          <div className="row2">
            <label className="field"><span className="ts-lbl">Plafond par jour <small>SOL</small></span><input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
            <label className="field"><span className="ts-lbl">Alerte de solde <small>SOL</small></span><input inputMode="decimal" value={alert} onChange={(e) => setAlert(e.target.value)} /></label>
          </div>
          <p className="muted ts-small">Dépensé aujourd'hui : {nf(srv?.spent_today ?? 0, 3)} SOL sur {nf(srv?.daily_cap_sol ?? 10, 2)} SOL. Entre 0,1 et 100 SOL par jour.</p>
          {PW()}
        </>)}

        {mode === 'export' && (shown
          ? <div className="ts-srv-key"><code className="mono">{shown}</code><button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(shown); toast('Clé copiée', 'Colle-la dans un endroit sûr, puis efface le presse-papiers.', 'a'); } catch { /* copie refusée */ } }}>Copier</button></div>
          : PW())}

        {mode === 'delete' && (<>
          {PW()}
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Supprimer même s'il reste des fonds (j'ai exporté la clé)</span></label>
        </>)}

        {err && <div className="ts-note bad" role="alert">{err}</div>}
        <div className="ts-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={close}>{shown ? 'Fermer' : 'Annuler'}</button>
          {!shown && <button className={'btn ' + (mode === 'delete' ? 'danger' : 'primary')} disabled={busy}>{busy ? 'Patiente…' : mode === 'create' ? (how === 'new' ? 'Créer le wallet serveur' : 'Placer sur le serveur') : mode === 'withdraw' ? 'Retirer' : mode === 'limits' ? 'Enregistrer' : mode === 'export' ? 'Afficher la clé' : 'Supprimer'}</button>}
        </div>
      </form>
    </div>
  );
}
