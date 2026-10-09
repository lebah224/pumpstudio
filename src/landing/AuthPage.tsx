import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { SignInPanel } from '../auth/SignIn';
import { MfaChallenge } from '../auth/Mfa';
import { t } from '../lib/i18n';
import { Brand, LEGAL } from './Chrome';
import { LangSwitch } from './LangSwitch';

const CHECK = <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

/** Pages /connexion et /inscription : visuel de marque à gauche, connexion à droite. Une fois connecté, direction l'outil. */
export function AuthPage({ signup }: { signup: boolean }) {
  const { ready, session, needsMfa } = useAuth();
  useEffect(() => { if (ready && session && !needsMfa) location.replace('/app'); }, [ready, session, needsMfa]);
  const intent = { start: 'choose' as const };

  return (
    <div className="lp lp-auth">
      <aside className="lp-auth-brand">
        <div className="lp-auth-top"><Brand /><LangSwitch /></div>
        <div className="lp-auth-copy">
          <h1>{signup ? t('Votre studio de tokens, prêt en une signature.', 'Your token studio, ready in one signature.') : t('Bon retour sur TokenStudio.', 'Welcome back to TokenStudio.')}</h1>
          <ul>
            <li>{CHECK}{t('Lancements vérifiés sur la blockchain avant signature', 'Launches checked on-chain before you sign')}</li>
            <li>{CHECK}{t('Ordres automatiques et alertes, avec plafonds', 'Automatic orders and alerts, with caps')}</li>
            <li>{CHECK}{t('Vos clés restent dans votre wallet', 'Your keys stay in your wallet')}</li>
          </ul>
        </div>
        <div className="lp-auth-art" aria-hidden="true">
          <svg viewBox="0 0 400 160">
            <defs><linearGradient id="lpAu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--gold)" stopOpacity=".35" /><stop offset="1" stopColor="var(--gold)" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 150 C 90 148, 170 138, 240 110 S 350 40, 400 10 L 400 160 L 0 160 Z" fill="url(#lpAu)" />
            <path d="M0 150 C 90 148, 170 138, 240 110 S 350 40, 400 10" className="lp-line" pathLength={1} />
          </svg>
        </div>
        <p className="lp-auth-foot">{t('Gratuit. Aucun compte n\'est créé sans votre accord.', 'Free. No account is created without your consent.')}</p>
      </aside>
      <main className="lp-auth-main">
        <div className="lp-auth-card">
          <div className="lp-tabs" role="tablist" aria-label={t('Connexion ou inscription', 'Sign in or sign up')}>
            <a role="tab" aria-selected={!signup} className={!signup ? 'on' : ''} href="/connexion">{t('Se connecter', 'Sign in')}</a>
            <a role="tab" aria-selected={signup} className={signup ? 'on' : ''} href="/inscription">{t('Créer un compte', 'Create an account')}</a>
          </div>
          {ready && (!session || needsMfa) && <SignInPanel key={signup ? 'up' : 'in'} intent={intent} onHide={() => {}} standalone signup={signup} />}
          {ready && session && !needsMfa && <p className="lp-auth-wait">{t('Connexion réussie. Ouverture de l\'outil…', 'Signed in. Opening the tool…')}</p>}
          {ready && (!session || needsMfa) && <p className="lp-agree">{t('En continuant, vous acceptez les', 'By continuing, you accept the')} <a href={LEGAL()[0]!.href}>{LEGAL()[0]!.label.toLowerCase()}</a>{t(' et la ', ' and the ')}<a href={LEGAL()[1]!.href}>{t('politique de confidentialité', 'privacy policy')}</a>{t(', et vous avez lu l\'', ', and you have read the ')}<a href={LEGAL()[2]!.href}>{LEGAL()[2]!.label.toLowerCase()}</a>.</p>}
        </div>
        <a className="lp-auth-back" href="/">{t('← Retour à l\'accueil', '← Back to home')}</a>
      </main>
      <MfaChallenge />
    </div>
  );
}
