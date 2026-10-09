import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useAuth, walletOf } from '../auth/AuthContext';
import { toast } from '../legacy/bridge';
import { USERNAME_RE, suggestUsernames, updateProfile, useProfile, usernameFree } from './profile';
import { UserAvatar, cleanAvatars, generatedAvatar, uploadAvatar } from './Avatar';

const VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Choix de l'avatar : générés (un clic) ou photo envoyée. value : « gen:<n> » ou chemin du stockage */
export function AvatarPicker({ userId, value, onChange }: { userId: string; value: string | null; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const cur = value ?? 'gen:0';
  async function pick(f: File | undefined) {
    if (!f) return; setErr(null); setBusy(true);
    try { onChange(await uploadAvatar(userId, f)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  }
  return (
    <div className="ts-avpick">
      <UserAvatar profile={{ id: userId, avatar_url: cur }} size={88} className="lg" />
      <div className="ts-avpick-r">
        <div className="ts-avpick-grid" role="radiogroup" aria-label="Avatars générés">
          {VARIANTS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={cur === 'gen:' + n} aria-label={'Avatar ' + (n + 1)} className={cur === 'gen:' + n ? 'on' : ''} onClick={() => onChange('gen:' + n)}>
              <img src={generatedAvatar(userId, n)} alt="" width={36} height={36} />
            </button>
          ))}
        </div>
        <div className="ts-row">
          <button type="button" className="btn sm" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Envoi…' : 'Importer une photo'}</button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <span className="muted ts-small">Recadrée en carré, visible seulement par vous.</span>
        </div>
        {err && <div className="ts-note bad" role="alert">{err}</div>}
      </div>
    </div>
  );
}

/** Champ nom d'utilisateur : vérification de disponibilité en direct et propositions */
export function UsernameField({ value, onChange, base, onState }: { value: string; onChange: (v: string) => void; base: string; onState: (ok: boolean | null) => void }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'bad' | 'checking' | 'free' | 'taken' | 'error'>('idle');
  const [sugg, setSugg] = useState<string[]>(() => suggestUsernames(base));
  useEffect(() => { setSugg(suggestUsernames(base)); }, [base]);
  useEffect(() => {
    const v = value.trim();
    if (!v) { setState('idle'); onState(null); return; }
    if (!USERNAME_RE.test(v)) { setState('bad'); onState(false); return; }
    setState('checking'); onState(null);
    const t = setTimeout(async () => {
      const ok = await usernameFree(v);
      setState(ok === null ? 'error' : ok ? 'free' : 'taken'); onState(ok === null ? null : ok);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const msg = { idle: '3 à 24 caractères : lettres, chiffres ou _.', bad: '3 à 24 caractères : lettres, chiffres ou _ uniquement.', checking: 'Vérification…', free: 'Disponible', taken: 'Déjà pris ou réservé', error: 'Vérification impossible pour l\'instant' }[state];
  return (
    <div className="field">
      <label className="ts-lbl" htmlFor={id}>Nom d'utilisateur</label>
      <div className={'ts-at ' + state}>
        <span aria-hidden="true">@</span>
        <input id={id} className="ts-username" value={value} onChange={(e) => onChange(e.target.value.replace(/\s/g, '_').slice(0, 24))} maxLength={24} autoComplete="username" spellCheck={false} autoCapitalize="none" aria-describedby={id + '-h'} />
      </div>
      <small id={id + '-h'} className={'ts-at-h ' + state} role="status">{msg}</small>
      {(state === 'taken' || state === 'idle' || state === 'bad') && sugg.length > 0 && (
        <div className="ts-chips" aria-label="Propositions">{sugg.map((s) => <button key={s} type="button" className="ts-chip" onClick={() => onChange(s)}>@{s}</button>)}</div>
      )}
    </div>
  );
}

const SKIP = 'ts-onboard-later';

/** Fenêtre de bienvenue : affichée tant que le compte n'a pas de nom d'utilisateur (« Plus tard » la masque pour la session) */
export function Onboarding() {
  const { user, needsMfa } = useAuth();
  const p = useProfile();
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem(SKIP) === '1'; } catch { return false; } });
  const base = user?.email?.split('@')[0] || (walletOf(user) ? 'sol_' + walletOf(user)!.slice(0, 4) : 'trader');
  const [name, setName] = useState('');
  const [uname, setUname] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const open = !!user && !needsMfa && !!p && p.id === user.id && !p.username && !later;

  useEffect(() => {
    if (!open || !p) return;
    setName(p.display_name ?? base.split(/[._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 40));
    setAvatar(p.avatar_url ?? 'gen:0');
    setTimeout(() => first.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open || !user) return null;

  const skip = () => { try { sessionStorage.setItem(SKIP, '1'); } catch { /* navigation privée */ } setLater(true); };
  async function save(ev: FormEvent) {
    ev.preventDefault(); setErr(null);
    const u = uname.trim(), n = name.trim();
    if (!n) { setErr('Choisissez un nom affiché.'); return; }
    if (!USERNAME_RE.test(u)) { setErr('Nom d\'utilisateur : 3 à 24 lettres, chiffres ou _.'); return; }
    if (ok === false) { setErr('Ce nom d\'utilisateur n\'est pas disponible.'); return; }
    setBusy(true);
    const e = await updateProfile({ username: u, display_name: n.slice(0, 40), avatar_url: avatar });
    setBusy(false);
    if (e) { setErr(e); return; }
    cleanAvatars(user!.id, avatar).catch(() => {});
    toast('Profil créé', 'Bienvenue, ' + n + ' !');
  }

  return (
    <div className="ts-modal ts-onboard" role="dialog" aria-modal="true" aria-labelledby="ts-onb-t">
      <form className="ts-modal-box" onSubmit={save}>
        <div className="ts-onb-h">
          <p className="ts-onb-k">Bienvenue sur TokenStudio</p>
          <h2 id="ts-onb-t">Créez votre profil</h2>
          <p>Choisissez comment vous apparaissez dans l'outil. Vous pourrez tout changer plus tard dans Mon compte.</p>
        </div>
        <AvatarPicker userId={user.id} value={avatar} onChange={setAvatar} />
        <label className="field"><span className="ts-lbl">Nom affiché</span><input ref={first} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" placeholder="Votre nom ou votre pseudo" /></label>
        <UsernameField value={uname} onChange={setUname} base={name || base} onState={setOk} />
        {err && <div className="ts-note bad" role="alert">{err}</div>}
        <div className="ts-row ts-onb-act">
          <button type="button" className="btn ghost" onClick={skip}>Plus tard</button>
          <button className="btn primary" disabled={busy || ok === false || !uname.trim()}>{busy ? 'Enregistrement…' : 'Créer mon profil'}</button>
        </div>
      </form>
    </div>
  );
}
