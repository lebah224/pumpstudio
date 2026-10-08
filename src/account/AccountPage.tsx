import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { AuditEntry, Preferences, PrefsPatch, Profile, Wallet } from '../lib/types';
import { useAuth, userLabel, walletOf } from '../auth/AuthContext';
import { SignInPanel, readable } from '../auth/SignIn';
import { MfaSettings } from '../auth/Mfa';
import { savePrefs } from './usePrefsSync';
import { studio, toast } from '../legacy/bridge';
import { DataTab } from '../sync/DataTab';
import { PushCard } from '../notify/PushCard';

const GUEST = { start: 'choose' as const };
type Tab = 'profile' | 'prefs' | 'wallets' | 'data' | 'security';
const TABS: [Tab, string][] = [['profile', 'Profil'], ['prefs', 'Préférences'], ['wallets', 'Wallets'], ['data', 'Données'], ['security', 'Sécurité']];

export function AccountPage() {
  const { user, ready, needsMfa } = useAuth();
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('ts-account-tab') as Tab) || 'profile');
  useEffect(() => { try { sessionStorage.setItem('ts-account-tab', tab); } catch { /* navigation privée */ } }, [tab]);
  // ouverture d'un onglet précis depuis le menu de compte
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent).detail as Tab; if (TABS.some(([k]) => k === t)) setTab(t); };
    window.addEventListener('ts-account-tab', on); return () => window.removeEventListener('ts-account-tab', on);
  }, []);

  if (!ready) return <div className="card"><div className="empty"><b>Chargement…</b></div></div>;
  if (!user) return (
    <div className="ts-account-guest">
      <div className="card"><SignInPanel intent={GUEST} onHide={() => {}} /></div>
      <div className="card ts-why">
        <h3>Pourquoi un compte ?</h3>
        <ul>
          <li><b>Tes réglages partout</b> : palette, slippage, limites et préférences du studio sur tous tes appareils.</li>
          <li><b>Tes wallets</b> : plusieurs wallets liés, chacun prouvé par une signature gratuite.</li>
          <li><b>Sécurité</b> : double authentification et journal des actions sensibles.</li>
          <li><b>Non-custodial</b> : aucune clé privée n'est envoyée, jamais. Le studio continue de fonctionner sans compte.</li>
        </ul>
      </div>
    </div>
  );
  if (needsMfa) return <div className="card"><div className="empty"><b>Double authentification requise</b>Saisis ton code pour accéder à ton compte.</div></div>;

  return (
    <div className="ts-account">
      <div className="ltabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'profile' && <ProfileTab />}
      {tab === 'prefs' && <PrefsTab />}
      {tab === 'wallets' && <WalletsTab />}
      {tab === 'data' && <DataTab />}
      {tab === 'security' && <SecurityTab />}
    </div>
  );
}

/* ---------------- Profil ---------------- */
function ProfileTab() {
  const { user } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', bio: '', locale: 'fr', timezone: 'Europe/Paris' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('id', user.id).single<Profile>().then(({ data }) => {
      if (!data) return; setP(data);
      setForm({ username: data.username ?? '', display_name: data.display_name ?? '', bio: data.bio ?? '', locale: data.locale, timezone: data.timezone });
    });
  }, [user]);

  async function save(ev: FormEvent) {
    ev.preventDefault(); if (!user) return; setErr(null);
    const u = form.username.trim();
    if (u && !/^[A-Za-z0-9_]{3,24}$/.test(u)) { setErr('Pseudo : 3 à 24 lettres, chiffres ou _.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('profiles').update({
      username: u || null, display_name: form.display_name.trim() || null, bio: form.bio.trim() || null, locale: form.locale, timezone: form.timezone.trim() || 'Europe/Paris',
    }).eq('id', user.id).select().single<Profile>();
    setBusy(false);
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? 'Ce pseudo est déjà pris.' : readable(error)); return; }
    setP(data); toast('Profil enregistré');
  }
  async function addEmail(ev: FormEvent) {
    ev.preventDefault(); setErr(null);
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setErr('Adresse e-mail invalide.'); return; }
    const { error } = await supabase.auth.updateUser({ email: v }, { emailRedirectTo: location.origin + location.pathname });
    if (error) { setErr(readable(error)); return; }
    setEmail(''); toast('Vérifie ta boîte mail', 'Clique sur le lien envoyé à ' + v + ' pour confirmer l\'adresse.');
  }

  const initial = (form.display_name || form.username || userLabel(user)).slice(0, 1).toUpperCase();
  return (
    <div className="ts-grid2">
      <form className="card" onSubmit={save}>
        <div className="card-h"><h3>Profil</h3><p>Ce qui te représente dans TokenStudio. Rien n'est public pour l'instant.</p></div>
        <div className="ts-avatar-row"><div className="ts-avatar">{initial}</div><div><b>{form.display_name || form.username || userLabel(user)}</b><small>Membre depuis le {p ? new Date(p.created_at).toLocaleDateString('fr-FR') : '…'}</small></div></div>
        <div className="row2">
          <label className="field"><span className="ts-lbl">Pseudo</span><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} maxLength={24} placeholder="satoshi_fr" autoComplete="nickname" /></label>
          <label className="field"><span className="ts-lbl">Nom affiché</span><input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={40} /></label>
        </div>
        <label className="field"><span className="ts-lbl">Bio <small>280 caractères max</small></span><textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={280} /></label>
        <div className="row2">
          <label className="field"><span className="ts-lbl">Langue</span><select value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}><option value="fr">Français</option><option value="en">English</option></select></label>
          <label className="field"><span className="ts-lbl">Fuseau horaire</span><input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} maxLength={64} /></label>
        </div>
        {err && <div className="ts-note bad" role="alert">{err}</div>}
        <div className="toolbar"><button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
      <div className="card">
        <div className="card-h"><h3>Identifiants de connexion</h3><p>Tu peux te connecter avec l'un ou l'autre.</p></div>
        <div className="ts-kv"><span>E-mail</span><b>{user?.email || 'aucun'}</b></div>
        <div className="ts-kv"><span>Wallet de connexion</span><b className="mono">{walletOf(user) || 'aucun'}</b></div>
        {user?.new_email && <div className="ts-note">Confirmation en attente pour <b>{user.new_email}</b> : clique sur le lien reçu.</div>}
        <form onSubmit={addEmail} className="ts-row" style={{ marginTop: 12 }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={user?.email ? 'Nouvelle adresse e-mail' : 'Ajouter un e-mail'} aria-label="Adresse e-mail" />
          <button className="btn">{user?.email ? 'Changer' : 'Ajouter'}</button>
        </form>
        <p className="muted ts-small">Un e-mail permet de récupérer ton compte et de recevoir les alertes de tes ordres.</p>
      </div>
    </div>
  );
}

/* ---------------- Préférences ---------------- */
const THEMES: [Preferences['ui_theme'], string][] = [['or', 'Or'], ['platine', 'Platine'], ['saphir', 'Saphir'], ['jade', 'Jade'], ['cuivre', 'Cuivre'], ['iris', 'Iris']];
const DEPTHS: [Preferences['ui_depth'], string][] = [['nuit', 'Nuit'], ['profond', 'Profond'], ['doux', 'Doux']];
const UNIVERSES: [Preferences['studio_universe'], string][] = [['meme', 'Mèmes animaux'], ['internet', 'Culture internet'], ['luxe', 'Luxe et rareté'], ['space', 'Espace'], ['tech', 'IA et tech'], ['gaming', 'Jeux vidéo']];
const TONES: [Preferences['studio_tone'], string][] = [['luxe', 'Premium'], ['minimal', 'Sobre'], ['witty', 'Décalé'], ['community', 'Communauté']];
const SPEEDS: [Preferences['priority'], string][] = [['eco', 'Économique'], ['fast', 'Rapide'], ['turbo', 'Turbo'], ['manual', 'Manuel']];

function PrefsTab() {
  const { user } = useAuth();
  const [p, setP] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (user) supabase.from('preferences').select('*').eq('user_id', user.id).single<Preferences>().then(({ data }) => data && setP(data)); }, [user]);
  if (!p) return <div className="card"><div className="empty"><b>Chargement…</b></div></div>;
  const set = (patch: PrefsPatch) => setP({ ...p, ...patch } as Preferences);

  async function save(ev: FormEvent) {
    ev.preventDefault(); if (!user || !p) return; setErr(null);
    if (!p.sim_mode && !window.confirm('Mode réel : les transactions que tu signes partiront vraiment sur la blockchain. Confirmer ?')) return;
    setBusy(true);
    try {
      const saved = await savePrefs(user.id, p);
      if (saved) { setP(saved); studio()?.prefs?.apply(saved); }
      toast('Préférences enregistrées', 'Appliquées au studio et sur tous tes appareils.');
    } catch (e) { setErr(readable(e)); } finally { setBusy(false); }
  }
  const seg = <T extends string>(list: [T, string][], v: T, on: (x: T) => void) => (
    <div className="seg">{list.map(([k, l]) => <button key={k} type="button" className={v === k ? 'on' : ''} aria-pressed={v === k} onClick={() => on(k)}>{l}</button>)}</div>
  );
  return (
    <form onSubmit={save} className="ts-prefs">
      <div className="ts-grid2">
        <div className="card">
          <div className="card-h"><h3>Apparence</h3><p>Palette et intensité du fond de l'interface.</p></div>
          <div className="field"><span className="ts-lbl">Palette</span>{seg(THEMES, p.ui_theme, (x) => set({ ui_theme: x }))}</div>
          <div className="field"><span className="ts-lbl">Intensité du fond</span>{seg(DEPTHS, p.ui_depth, (x) => set({ ui_depth: x }))}</div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Studio de création</h3><p>Valeurs proposées par défaut à chaque nouveau token.</p></div>
          <label className="field"><span className="ts-lbl">Univers</span><select value={p.studio_universe} onChange={(e) => set({ studio_universe: e.target.value as Preferences['studio_universe'] })}>{UNIVERSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <div className="row2">
            <label className="field"><span className="ts-lbl">Ton</span><select value={p.studio_tone} onChange={(e) => set({ studio_tone: e.target.value as Preferences['studio_tone'] })}>{TONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span className="ts-lbl">Langue des textes</span><select value={p.studio_lang} onChange={(e) => set({ studio_lang: e.target.value as Preferences['studio_lang'] })}><option value="en">Anglais</option><option value="fr">Français</option></select></label>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Trading</h3><p>Garde-fous appliqués à chaque achat et vente.</p></div>
          <div className="field"><span className="ts-lbl">Mode</span>{seg<'sim' | 'real'>([['sim', 'Simulation'], ['real', 'Réel']], p.sim_mode ? 'sim' : 'real', (x) => set({ sim_mode: x === 'sim' }))}</div>
          <div className="row2">
            <label className="field"><span className="ts-lbl">Slippage maximum <small>%</small></span><input type="number" min={0.1} max={50} step="any" value={p.slippage_pct} onChange={(e) => set({ slippage_pct: Number(e.target.value) })} /></label>
            <label className="field"><span className="ts-lbl">Limite par achat <small>SOL</small></span><input type="number" min={0.001} max={100} step="any" value={p.max_buy_sol} onChange={(e) => set({ max_buy_sol: Number(e.target.value) })} /></label>
          </div>
          <div className="row2">
            <label className="field"><span className="ts-lbl">Priorité des transactions</span><select value={p.priority} onChange={(e) => set({ priority: e.target.value as Preferences['priority'] })}>{SPEEDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span className="ts-lbl">Part max du créateur <small>% de l'offre</small></span><input type="number" min={0} max={100} step="any" value={p.dev_max_pct} onChange={(e) => set({ dev_max_pct: Number(e.target.value) })} /></label>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Notifications</h3><p>Alertes quand un prix atteint la condition d'un de tes ordres.</p></div>
          <label className="check"><input type="checkbox" checked={p.notify_orders} onChange={(e) => set({ notify_orders: e.target.checked })} /><span>M'alerter quand un ordre se déclenche</span></label>
          <PushCard enabled={p.notify_orders} />
          <label className="check"><input type="checkbox" checked={false} disabled /><span>Par e-mail <small className="muted">(bientôt : arrive avec l'envoi d'e-mails du domaine TokenStudio)</small></span></label>
        </div>
      </div>
      {err && <div className="ts-note bad" role="alert">{err}</div>}
      <div className="toolbar"><button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les préférences'}</button><span className="muted ts-small">Modifiées le {new Date(p.updated_at).toLocaleString('fr-FR')}</span></div>
    </form>
  );
}

/* ---------------- Wallets ---------------- */
function WalletsTab() {
  const { user, openSignIn } = useAuth();
  const [list, setList] = useState<Wallet[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('wallets').select('*').eq('user_id', user.id).order('created_at');
    setList((data as Wallet[]) ?? []);
  }, [user]);
  useEffect(() => { load(); window.addEventListener('ts-wallets-changed', load); return () => window.removeEventListener('ts-wallets-changed', load); }, [load]);

  async function rename(w: Wallet) {
    const label = window.prompt('Nom du wallet (32 caractères max)', w.label ?? '');
    if (label == null) return;
    const { error } = await supabase.from('wallets').update({ label: label.trim().slice(0, 32) || null }).eq('id', w.id);
    if (error) setErr(readable(error)); else load();
  }
  async function makePrimary(w: Wallet) {
    if (!list) return; setBusy(w.id);
    const cur = list.find((x) => x.is_primary);
    if (cur) await supabase.from('wallets').update({ is_primary: false }).eq('id', cur.id);
    const { error } = await supabase.from('wallets').update({ is_primary: true }).eq('id', w.id);
    setBusy(null); if (error) setErr(readable(error)); load();
  }
  async function remove(w: Wallet) {
    if (!window.confirm('Retirer ' + w.address.slice(0, 6) + '… de ton compte ? Les fonds ne sont pas touchés.')) return;
    const { error } = await supabase.from('wallets').delete().eq('id', w.id);
    if (error) setErr(readable(error)); else { toast('Wallet retiré', '', 'a'); load(); }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Wallets liés</h3><p>Seules les adresses publiques sont enregistrées. Chaque wallet est ajouté après une signature gratuite qui prouve qu'il t'appartient.</p></div>
      {!list ? <div className="empty"><b>Chargement…</b></div> : !list.length ? <div className="empty"><b>Aucun wallet lié</b>Lie ton wallet pour retrouver tes tokens sur tous tes appareils.</div> : (
        <div className="ts-wallets">{list.map((w) => (
          <div key={w.id} className="ts-wallet">
            <div className="ts-w-main"><b>{w.label || 'Wallet'} {w.is_primary && <span className="badge v">principal</span>}</b><code className="mono">{w.address}</code><small>Vérifié le {new Date(w.verified_at).toLocaleDateString('fr-FR')}</small></div>
            <div className="ts-w-act">
              <a className="btn sm ghost" href={'https://solscan.io/account/' + w.address} target="_blank" rel="noopener noreferrer">Solscan</a>
              <button className="btn sm ghost" type="button" onClick={() => rename(w)}>Renommer</button>
              {!w.is_primary && <button className="btn sm" type="button" disabled={busy === w.id} onClick={() => makePrimary(w)}>Principal</button>}
              <button className="btn sm ghost" type="button" onClick={() => remove(w)}>Retirer</button>
            </div>
          </div>
        ))}</div>
      )}
      {err && <div className="ts-note bad" role="alert">{err}</div>}
      <div className="toolbar"><button className="btn primary" type="button" onClick={() => openSignIn({ start: 'add' })}>Ajouter un wallet</button><span className="muted ts-small">Phantom, Solflare, Backpack, Coinbase, OKX, Trust… ou ton wallet rapide. Une signature gratuite prouve qu'il t'appartient.</span></div>
    </div>
  );
}

/* ---------------- Sécurité ---------------- */
const EVENTS: Record<string, string> = {
  account_created: 'Compte créé', wallet_added: 'Wallet ajouté', wallet_removed: 'Wallet retiré',
  mode_reel: 'Passage en mode réel', mode_simulation: 'Retour en simulation', limite_achat_modifiee: 'Limite par achat modifiée',
};
function SecurityTab() {
  const { user, signOut } = useAuth();
  const [log, setLog] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    if (!user) return;
    supabase.from('audit_log').select('id,event,detail,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50).then(({ data }) => setLog((data as AuditEntry[]) ?? []));
  }, [user]);
  return (
    <div className="ts-grid2">
      <div className="card">
        <div className="card-h"><h3>Double authentification</h3><p>Protège ton compte même si ton e-mail ou ta session est compromis.</p></div>
        <MfaSettings />
      </div>
      <div className="card">
        <div className="card-h"><h3>Sessions</h3><p>Déconnecte tous les appareils si tu as un doute.</p></div>
        <div className="toolbar"><button className="btn" type="button" onClick={() => signOut()}>Se déconnecter</button><button className="btn danger" type="button" onClick={() => { if (window.confirm('Déconnecter tous tes appareils ?')) signOut(true); }}>Déconnecter tous les appareils</button></div>
        <ul className="ts-promise">
          <li>Aucune clé privée n'est envoyée au serveur, jamais.</li>
          <li>Le wallet rapide reste chiffré dans ce navigateur uniquement.</li>
          <li>Chaque table de la base est privée à ton compte (règles RLS).</li>
        </ul>
      </div>
      <div className="card ts-span2">
        <div className="card-h"><h3>Journal de sécurité</h3><p>Les actions sensibles de ton compte, enregistrées par le serveur. Personne ne peut les modifier, pas même toi.</p></div>
        {!log ? <div className="empty"><b>Chargement…</b></div> : !log.length ? <div className="empty"><b>Rien pour l'instant</b></div> : (
          <div className="ts-log">{log.map((e) => (
            <div key={e.id}><span className="mono dim">{new Date(e.created_at).toLocaleString('fr-FR')}</span><b>{EVENTS[e.event] || e.event}</b><span className="dim mono">{typeof e.detail?.address === 'string' ? (e.detail.address as string).slice(0, 4) + '…' + (e.detail.address as string).slice(-4) : e.detail?.apres != null ? e.detail.avant + ' → ' + e.detail.apres + ' SOL' : ''}</span></div>
          ))}</div>
        )}
      </div>
    </div>
  );
}
