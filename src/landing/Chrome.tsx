import { t } from '../lib/i18n';
import { LangSwitch } from './LangSwitch';

/** Logo TokenStudio (courbe de liaison) */
export function Brand({ small }: { small?: boolean }) {
  return (
    <a className={'lp-brand' + (small ? ' sm' : '')} href="/" aria-label={t('TokenStudio, accueil', 'TokenStudio, home')}>
      <span className="lp-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 20.5h17" /><path d="M4 18c7 0 11-3.5 15.5-13" /><circle cx="19.5" cy="5" r="1.6" /></svg></span>
      <span>Token<b>Studio</b></span>
    </a>
  );
}

/** Pages légales : adresse et titre dans chaque langue */
export const LEGAL = () => [
  { href: '/conditions', label: t('Conditions d\'utilisation', 'Terms of use') },
  { href: '/confidentialite', label: t('Confidentialité', 'Privacy') },
  { href: '/risques', label: t('Avertissement sur les risques', 'Risk disclosure') },
  { href: '/mentions-legales', label: t('Mentions légales', 'Legal notice') },
];

/** Pied de page commun à l'accueil et aux pages légales */
export function Footer() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot-in">
        <div className="lp-foot-top">
          <Brand small />
          <LangSwitch />
        </div>
        <p className="lp-risk">{t(
          'Les memecoins sont des actifs extrêmement risqués. TokenStudio est un outil : il ne fournit pas de conseil en investissement et ne garantit aucun gain. TokenStudio n\'est affilié ni à pump.fun ni aux wallets cités.',
          'Memecoins are extremely risky assets. TokenStudio is a tool: it does not provide investment advice and guarantees no profit. TokenStudio is not affiliated with pump.fun or with the wallets mentioned.',
        )}</p>
        <div className="lp-foot-nav">
          <nav className="lp-foot-links" aria-label={t('Liens', 'Links')}>
            <a href="/app?demo=1">{t('Démo', 'Demo')}</a><a href="/connexion">{t('Connexion', 'Sign in')}</a><a href="/inscription">{t('Créer un compte', 'Create an account')}</a>
          </nav>
          <nav className="lp-foot-links" aria-label={t('Informations légales', 'Legal information')}>
            {LEGAL().map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
          </nav>
        </div>
      </div>
    </footer>
  );
}
