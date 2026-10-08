import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { SignInPanel } from '../auth/SignIn';
import { MfaChallenge } from '../auth/Mfa';

const CHECK = <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

/** Pages /connexion et /inscription : visuel de marque à gauche, connexion à droite. Une fois connecté, direction l'outil. */
export function AuthPage({ signup }: { signup: boolean }) {
  const { ready, session, needsMfa } = useAuth();
  useEffect(() => { if (ready && session && !needsMfa) location.replace('/app'); }, [ready, session, needsMfa]);
  const intent = { start: 'choose' as const };

  return (
    <div className="lp lp-auth">
      <aside className="lp-auth-brand">
        <a className="lp-brand" href="/" aria-label="TokenStudio, accueil">
          <span className="lp-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 20.5h17" /><path d="M4 18c7 0 11-3.5 15.5-13" /><circle cx="19.5" cy="5" r="1.6" /></svg></span>
          <span>Token<b>Studio</b></span>
        </a>
        <div className="lp-auth-copy">
          <h1>{signup ? 'Ton studio de tokens, prêt en une signature.' : 'Bon retour sur TokenStudio.'}</h1>
          <ul>
            <li>{CHECK}Lancements vérifiés sur la blockchain avant signature</li>
            <li>{CHECK}Ordres, alertes et bot avec plafonds</li>
            <li>{CHECK}Tes clés restent dans ton wallet</li>
          </ul>
        </div>
        <div className="lp-auth-art" aria-hidden="true">
          <svg viewBox="0 0 400 160">
            <defs><linearGradient id="lpAu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--gold)" stopOpacity=".35" /><stop offset="1" stopColor="var(--gold)" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 150 C 90 148, 170 138, 240 110 S 350 40, 400 10 L 400 160 L 0 160 Z" fill="url(#lpAu)" />
            <path d="M0 150 C 90 148, 170 138, 240 110 S 350 40, 400 10" className="lp-line" pathLength={1} />
          </svg>
        </div>
        <p className="lp-auth-foot">Gratuit. Aucun compte n'est créé sans ton accord.</p>
      </aside>
      <main className="lp-auth-main">
        <div className="lp-auth-card">
          <div className="lp-tabs" role="tablist" aria-label="Connexion ou inscription">
            <a role="tab" aria-selected={!signup} className={!signup ? 'on' : ''} href="/connexion">Se connecter</a>
            <a role="tab" aria-selected={signup} className={signup ? 'on' : ''} href="/inscription">Créer un compte</a>
          </div>
          {ready && (!session || needsMfa) && <SignInPanel key={signup ? 'up' : 'in'} intent={intent} onHide={() => {}} standalone signup={signup} />}
          {ready && session && !needsMfa && <p className="lp-auth-wait">Connexion réussie. Ouverture de l'outil…</p>}
        </div>
        <a className="lp-auth-back" href="/">← Retour à l'accueil</a>
      </main>
      <MfaChallenge />
    </div>
  );
}
