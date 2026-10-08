import { useAuth, userLabel } from '../auth/AuthContext';
import { goTo } from '../legacy/bridge';

/** Carte de compte dans la barre latérale du studio */
export function AccountChip() {
  const { ready, user, openSignIn, needsMfa } = useAuth();
  if (!ready) return null;
  if (!user) return (
    <button type="button" className="ts-chip guest" onClick={() => openSignIn()}>
      <span className="ts-chip-av">?</span>
      <span className="ts-chip-t"><b>Se connecter</b><small>Wallet ou e-mail</small></span>
    </button>
  );
  const label = userLabel(user);
  return (
    <button type="button" className="ts-chip" onClick={() => goTo('account')} title="Mon compte">
      <span className="ts-chip-av">{label.slice(0, 1).toUpperCase()}</span>
      <span className="ts-chip-t"><b>{label}</b><small>{needsMfa ? 'Code de sécurité requis' : 'Mon compte'}</small></span>
      <span className={'ts-chip-dot' + (needsMfa ? ' warn' : '')} aria-hidden="true" />
    </button>
  );
}
