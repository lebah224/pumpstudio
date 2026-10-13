import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, walletOf } from '../auth/AuthContext';
import { studio, toast } from '../legacy/bridge';
import { supabase } from '../lib/supabase';
import { pwError } from '../lib/password';
import { PasswordMeter } from '../ui/PasswordMeter';
import { Sol } from '../ui/Sol';
import { createServerWallet, deleteServerWallet, exportServerWallet, importServerWallet, selectServerWallet, setServerLimits, srvLabel, useServerWallet, withdrawServerWallet } from './api';

export type SrvMode = 'create' | 'import' | 'withdraw' | 'limits' | 'export' | 'delete';
/** address : wallet rapide visé (sinon le wallet actif) */
export const openServerWallet = (mode: SrvMode, address?: string) => window.dispatchEvent(new CustomEvent('ts-srv', { detail: { mode, address } }));

const short = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);
const nf = (n: number, d = 4) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });

/** Fenêtre des wallets rapides : création, ajout par clé secrète, retrait, plafonds, export de la clé, suppression */
export function ServerWalletDialog() {
  const { user } = useAuth();
  const srv = useServerWallet();
  const [mode, setMode] = useState<SrvMode | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [how, setHow] = useState<'new' | 'move' | 'key'>('new');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [secret, setSecret] = useState(''); const [ack, setAck] = useState(false);
  const [to, setTo] = useState(''); const [amount, setAmount] = useState(''); const [all, setAll] = useState(false);
  const [cap, setCap] = useState(''); const [alert, setAlert] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [linked, setLinked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  // ancien wallet rapide du navigateur : peut devenir le wallet rapide du compte (même adresse)
  const quick = studio()?.hub?.state().quickSaved ?? null;

  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent).detail as SrvMode | { mode: SrvMode; address?: string };
      const m = typeof d === 'string' ? d : d.mode, addr = (typeof d === 'string' ? null : d.address) || srv?.address || null;
      const tw = srv?.wallets.find((x) => x.address === addr);
      setMode(m); setTarget(addr); setErr(null); setPw(''); setPw2(''); setSecret(''); setAck(false); setShown(null); setAmount(''); setAll(false);
      setHow(m === 'import' ? 'key' : quick && !srv?.wallets.length ? 'move' : 'new');
      setCap(String(tw?.daily_cap_sol ?? 10)); setAlert(String(tw?.alert_balance_sol ?? 5));
      // raccourcis : wallets liés au compte (le wallet de connexion d'abord) ; l'adresse reste libre
      setTo('');
      if (m === 'withdraw' && user) supabase.from('wallets').select('address').eq('user_id', user.id).then(({ data }) => {
        const own = walletOf(user);
        setLinked((data ?? []).map((x) => x.address as string).sort((a, b) => (a === own ? -1 : b === own ? 1 : 0)));
      });
    };
    window.addEventListener('ts-srv', f); return () => window.removeEventListener('ts-srv', f);
  }, [srv, user, quick]);
  if (!mode || !user) return null;
  const tw = srv?.wallets.find((x) => x.address === target) ?? null;
  const first = !srv?.hasPassword;   // premier wallet rapide : son mot de passe protégera tous les suivants
  const adding = mode === 'create' || mode === 'import';
  const close = () => { setMode(null); setShown(null); setPw(''); };

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (adding) {
        if (first) {
          const weak = pwError(pw); if (weak) throw new Error(weak);
          if (pw !== pw2) throw new Error('Les deux mots de passe sont différents.');
        } else if (!pw) throw new Error('Saisissez le mot de passe de vos wallets rapides.');
        if (!ack) throw new Error('Cochez la case pour confirmer.');
        let r: { address: string; num: number };
        if (how === 'new') r = await createServerWallet(pw);
        else if (how === 'move') {
          const h = studio()?.hub; let kp = h?.quickKeypair();
          if (!kp && (await h?.quickUnlock())) kp = h?.quickKeypair();
          if (!kp) throw new Error('Déverrouillez d\'abord votre wallet rapide.');
          const b58 = (window.PumpStudio as unknown as { b58: (u: Uint8Array) => string }).b58;
          r = await importServerWallet(pw, b58(kp.secretKey));
          h?.legacyDrop();   // la copie du navigateur est retirée : le wallet vit maintenant sur le compte
        } else {
          if (!secret.trim()) throw new Error('Collez la clé secrète du wallet.');
          r = await importServerWallet(pw, secret.trim());
        }
        if (first) await selectServerWallet(r.address);
        toast(srvLabel(r) + ' prêt', short(r.address) + (first ? ' signe maintenant vos transactions, sans fenêtre de confirmation.' : ' · choisissez-le dans Portefeuille pour qu\'il signe.'));
        close(); return;
      }
      if (!target) throw new Error('Aucun wallet rapide choisi.');
      if (!pw) throw new Error('Saisissez le mot de passe de vos wallets rapides.');
      if (mode === 'withdraw') {
        const dest = to.trim();
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(dest)) throw new Error('Adresse Solana de destination invalide.');
        if (dest === target) throw new Error('C\'est l\'adresse de ce wallet rapide lui-même.');
        const n = Number(amount.replace(',', '.'));
        if (!all && !(n > 0)) throw new Error('Montant invalide.');
        const r = await withdrawServerWallet(target, pw, dest, all ? 'max' : n);
        toast('Retrait envoyé', nf(r.sol) + ' SOL → ' + short(dest)); close();
      } else if (mode === 'limits') {
        await setServerLimits(target, pw, Number(cap.replace(',', '.')), Number(alert.replace(',', '.')));
        toast('Plafonds enregistrés', ''); close();
      } else if (mode === 'export') {
        setShown(await exportServerWallet(target, pw)); setPw('');
      } else if (mode === 'delete') {
        await deleteServerWallet(target, pw, ack); toast((tw ? srvLabel(tw) : 'Wallet rapide') + ' supprimé', 'Les numéros des autres wallets ne changent pas.', 'a'); close();
      }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  const PW = (label = 'Mot de passe de vos wallets rapides', auto = 'current-password', focus = true) => <label className="field"><span className="ts-lbl">{label}</span><input type="password" autoComplete={auto} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={focus} /></label>;
  const nameOf = tw ? srvLabel(tw) : 'Wallet rapide';
  const TITLE: Record<SrvMode, string> = { create: first ? 'Créer mon wallet rapide' : 'Nouveau wallet rapide', import: 'Ajouter un wallet par clé secrète', withdraw: 'Retirer · ' + nameOf, limits: 'Plafonds · ' + nameOf, export: 'Exporter la clé · ' + nameOf, delete: 'Supprimer · ' + nameOf };

  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label={TITLE[mode]} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form className="ts-modal-box ts-srv" onSubmit={submit}>
        <button type="button" className="ts-x" aria-label="Fermer" onClick={close}>×</button>
        <div className="ts-si-h"><b>{TITLE[mode]}</b>
          <span>{adding ? (first ? 'Un wallet de trading rattaché à votre compte : sa clé est gardée chiffrée par TokenStudio. Il signe seul, sans fenêtre de confirmation, dans la limite de vos plafonds : trades et ventes automatiques de vos ordres.'
              : 'Il prend le numéro suivant (n°' + ((srv?.wallets.reduce((m, x) => Math.max(m, x.num), 0) ?? 0) + 1) + ') et se protège avec le même mot de passe que vos autres wallets rapides.')
            : mode === 'withdraw' ? 'Collez l\'adresse Solana qui doit recevoir les SOL : la vôtre, celle d\'un ami ou d\'une plateforme. Vérifiez-la bien, un retrait ne s\'annule pas.'
            : mode === 'limits' ? 'TokenStudio refuse toute dépense au-delà du plafond du jour.'
            : mode === 'export' ? 'La clé donne un accès total aux fonds de ce wallet. Gardez-la hors ligne et ne la partage avec personne.'
            : 'La clé chiffrée est définitivement effacée. Sans export préalable, les fonds restants seraient perdus.'}</span></div>

        {adding && (<>
          <div className="seg sm ts-srv-how" role="group" aria-label="Origine du wallet">
            {quick && <button type="button" className={how === 'move' ? 'on' : ''} onClick={() => setHow('move')}>Mon ancien wallet rapide</button>}
            <button type="button" className={how === 'new' ? 'on' : ''} onClick={() => setHow('new')}>Nouveau wallet</button>
            <button type="button" className={how === 'key' ? 'on' : ''} onClick={() => setHow('key')}>Clé secrète</button>
          </div>
          {how === 'move' && quick && <p className="muted ts-small">Votre ancien wallet rapide <b className="mono">{short(quick.pk)}</b> devient le wallet rapide de votre compte, à la même adresse et avec ses fonds. Rien n'est transféré sur la blockchain.</p>}
          {how === 'key' && <label className="field"><span className="ts-lbl">Clé secrète (base58, comme dans Phantom, ou tableau de 64 nombres)</span><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
          {first ? (<>
            {PW('Mot de passe de vos wallets rapides', 'new-password')}
            <PasswordMeter value={pw} />
            <label className="field"><span className="ts-lbl">Confirmez le mot de passe</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          </>) : PW()}
          <ul className="ts-srv-rules">
            <li>Il ne signe que des achats, ventes, lancements et récupérations de frais : jamais de virement ni de transfert de tokens.</li>
            <li>Plafond de dépense : <Sol v={10} d={0} /> par jour, réglable. Votre limite par achat s'applique aussi.</li>
            <li>Retraits vers l'adresse de votre choix, avec ce mot de passe ; un e-mail vous prévient à chaque retrait.</li>
          </ul>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Je comprends que TokenStudio garde la clé de ce wallet. Je n'y laisse que ce que je suis prêt à risquer.</span></label>
        </>)}

        {mode === 'withdraw' && (<>
          <label className="field"><span className="ts-lbl">Adresse du destinataire</span><input className="mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Adresse Solana (ex. 7xKX…)" autoComplete="off" spellCheck={false} autoFocus /></label>
          {(() => {
            const picks = [...linked.map((a) => ({ a, l: short(a) })), ...(srv?.wallets ?? []).filter((w) => w.address !== target).map((w) => ({ a: w.address, l: srvLabel(w) }))].filter((x, i, A) => A.findIndex((y) => y.a === x.a) === i);
            return picks.length ? <div className="ts-srv-picks" role="group" aria-label="Mes wallets">{picks.map((x) => <button key={x.a} type="button" className={'ts-hub-pill' + (to.trim() === x.a ? ' ok' : '')} onClick={() => setTo(x.a)}>{x.l}</button>)}</div> : null;
          })()}
          <label className="field"><span className="ts-lbl">Montant (SOL)</span><input inputMode="decimal" value={all ? '' : amount} disabled={all} onChange={(e) => setAmount(e.target.value)} placeholder="ex. 0,5" /></label>
          <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Tout retirer</span></label>
          {PW('Mot de passe de vos wallets rapides', 'current-password', false)}
        </>)}

        {mode === 'limits' && (<>
          <div className="row2">
            <label className="field"><span className="ts-lbl">Plafond par jour <small>SOL</small></span><input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
            <label className="field"><span className="ts-lbl">Alerte de solde <small>SOL</small></span><input inputMode="decimal" value={alert} onChange={(e) => setAlert(e.target.value)} /></label>
          </div>
          <p className="muted ts-small">Dépensé aujourd'hui : <Sol v={tw?.spent_today ?? 0} d={3} /> sur <Sol v={tw?.daily_cap_sol ?? 10} d={2} />. Entre 0,1 et 100 SOL par jour.</p>
          {PW()}
        </>)}

        {mode === 'export' && (shown
          ? <div className="ts-srv-key"><code className="mono">{shown}</code><button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(shown); toast('Clé copiée', 'Collez-la dans un endroit sûr, puis effacez le presse-papiers.', 'a'); } catch { /* copie refusée */ } }}>Copier</button></div>
          : PW())}

        {mode === 'delete' && (<>
          {PW()}
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Supprimer même s'il reste des fonds (j'ai exporté la clé)</span></label>
        </>)}

        {err && <div className="ts-note bad" role="alert">{err}</div>}
        <div className="ts-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={close}>{shown ? 'Fermer' : 'Annuler'}</button>
          {!shown && <button className={'btn ' + (mode === 'delete' ? 'danger' : 'primary')} disabled={busy}>{busy ? 'Patientez…' : adding ? (how === 'new' ? 'Créer le wallet rapide' : how === 'key' ? 'Ajouter ce wallet' : 'Placer sur mon compte') : mode === 'withdraw' ? 'Retirer' : mode === 'limits' ? 'Enregistrer' : mode === 'export' ? 'Afficher la clé' : 'Supprimer'}</button>}
        </div>
      </form>
    </div>
  );
}
