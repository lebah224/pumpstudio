import { useCloudStatus } from './cloud';

/** Indicateur discret : chargement du compte, ou enregistrement en attente (réseau coupé) */
export function CloudNotice() {
  const s = useCloudStatus();
  if (!s.userId || (!s.loading && !s.error)) return null;
  return (
    <div className={'ts-cloud' + (s.error ? ' warn' : '')} role="status" aria-live="polite">
      <span className={'ts-cloud-dot' + (s.loading ? ' spin' : '')} aria-hidden="true" />
      <span>{s.loading ? 'Chargement de ton compte…' : 'Connexion au compte perdue : tes changements partiront dès son retour.'}</span>
    </div>
  );
}
