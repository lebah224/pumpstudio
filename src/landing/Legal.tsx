import { useEffect, type ReactNode } from 'react';
import { lang, t } from '../lib/i18n';
import { Brand, Footer, LEGAL } from './Chrome';
import { LangSwitch } from './LangSwitch';

export type LegalId = 'terms' | 'privacy' | 'risks' | 'notice';
type Doc = { title: string; summary: ReactNode; sections: [string, ReactNode][] };

/** Adresse de contact affichée dans les pages légales */
const CONTACT = 'sadoutv0@gmail.com';
const UPDATED = { fr: '9 octobre 2026', en: 'October 9, 2026' };

const mail = () => CONTACT ? <a href={'mailto:' + CONTACT}>{CONTACT}</a> : <b>{t('adresse de contact à venir', 'contact address coming soon')}</b>;

export const legalTitle = (id: LegalId) => ({
  terms: t('Conditions d\'utilisation', 'Terms of use'),
  privacy: t('Politique de confidentialité', 'Privacy policy'),
  risks: t('Avertissement sur les risques', 'Risk disclosure'),
  notice: t('Mentions légales', 'Legal notice'),
})[id];

/* ---------------------------------------------------------------- français */
function fr(id: LegalId): Doc {
  if (id === 'terms') return {
    title: legalTitle(id),
    summary: <p>En bref : TokenStudio est un outil gratuit. Vous gardez le contrôle de vos wallets et vous êtes seul responsable des tokens que vous créez et des transactions que vous signez. Les memecoins peuvent perdre toute leur valeur.</p>,
    sections: [
      ['1. Objet', <><p>TokenStudio est un outil logiciel qui aide à créer, lancer et gérer des tokens sur pump.fun (blockchain Solana) : studio de création, lancement, suivi, trading, ordres de vente automatiques, portefeuille et diffusion.</p><p>Ces conditions s'appliquent dès que vous utilisez le site, en démo comme en mode réel. En créant un compte, vous les acceptez.</p></>],
      ['2. Accès et compte', <><ul><li>La démo est ouverte sans compte : tout y est simulé, aucun SOL réel n'est engagé.</li><li>Le mode réel demande un compte. Aucun compte n'est créé sans votre accord explicite.</li><li>Vous devez être majeur et avoir le droit, dans votre pays, d'utiliser des crypto-actifs.</li><li>Vous êtes responsable de la sécurité de votre compte, de votre e-mail et de vos wallets. Nous vous conseillons d'activer la double authentification.</li></ul></>],
      ['3. Vos wallets et vos fonds', <><p>TokenStudio est non-custodial : les transactions sont préparées par l'outil et signées par votre wallet (Phantom, Solflare…). Vos clés privées ne nous sont jamais transmises.</p><p>Exception, si vous le créez : le <b>wallet rapide</b>. Sa clé est générée et conservée chiffrée sur nos serveurs pour signer sans fenêtre. Il est protégé par votre mot de passe, ne signe que des opérations de trading, dans la limite de votre plafond journalier (10 SOL au plus), et ses retraits ne peuvent aller que vers les wallets liés à votre compte. N'y laissez que ce dont vous avez besoin.</p></>],
      ['4. Transactions', <><ul><li>Une transaction sur la blockchain est définitive : personne, pas même nous, ne peut l'annuler.</li><li>La vérification avant signature réduit les erreurs mais ne garantit ni le prix, ni le résultat, ni la réussite de la transaction.</li><li>Les ventes automatiques sont exécutées par le serveur selon les ordres que vous avez réglés. Elles peuvent être retardées (contrôle toutes les 10 secondes environ), partielles, subir un glissement de prix ou échouer, par exemple si le réseau est saturé ou si le wallet n'a plus assez de SOL.</li><li>Les frais du réseau Solana, de pump.fun et des services tiers sont à votre charge.</li></ul></>],
      ['5. Usages interdits', <><p>Vous vous engagez à ne pas utiliser TokenStudio pour :</p><ul><li>imiter une marque, une entreprise, une personne ou un projet existant, ou tromper les acheteurs sur l'origine d'un token ;</li><li>manipuler un marché : wash trading, achats groupés coordonnés (bundling), sniping organisé, pump and dump, fausses promesses de gains ;</li><li>publier un contenu illégal, haineux, violent, sexuel impliquant des mineurs, ou qui porte atteinte aux droits d'autrui (marques, droits d'auteur, image) ;</li><li>blanchir de l'argent, contourner des sanctions ou enfreindre les lois de votre pays, y compris celles sur les offres de titres financiers ;</li><li>attaquer, surcharger ou contourner les limites du service.</li></ul><p>En cas d'abus, nous pouvons suspendre ou supprimer un compte.</p></>],
      ['6. Votre contenu', <p>Vous restez propriétaire des noms, textes et logos que vous créez. Vous nous autorisez à les conserver et à les afficher dans votre compte pour faire fonctionner le service. Une fois un token lancé, son nom, son logo et sa fiche sont publiés sur IPFS et sur la blockchain : ils deviennent publics et ne peuvent plus être effacés. Vous garantissez disposer des droits nécessaires sur ce que vous publiez.</p>],
      ['7. Services tiers', <p>TokenStudio s'appuie sur des services indépendants : pump.fun, PumpPortal, les nœuds RPC Solana, Jupiter, DexScreener, votre wallet. Nous ne les contrôlons pas. Leurs propres conditions s'appliquent, et une panne ou un changement de leur part peut empêcher une fonction de marcher.</p>],
      ['8. Aucun conseil, aucune garantie', <><p>TokenStudio ne fournit aucun conseil en investissement, juridique ou fiscal, et ne promet aucun gain. Les idées du studio et les analyses de risque sont des aides, pas des recommandations. Les résultats de la démo sont simulés et ne prédisent rien.</p><p>Le service est fourni « en l'état », sans garantie de disponibilité continue ni d'absence d'erreur. Dans toute la mesure permise par la loi, nous ne sommes pas responsables des pertes liées à la valeur des tokens, aux transactions que vous signez, aux ordres que vous réglez ou aux services tiers.</p></>],
      ['9. Fin d\'utilisation', <p>Vous pouvez supprimer votre compte à tout moment depuis le menu de votre compte → Données. Si votre wallet rapide contient encore des SOL ou des tokens, la suppression est refusée tant que vous ne les avez pas retirés, pour éviter que vous les perdiez.</p>],
      ['10. Modifications', <p>Nous pouvons faire évoluer ces conditions. La date de mise à jour figure en haut de la page ; en cas de changement important, nous vous prévenons dans l'outil. Continuer à utiliser TokenStudio après un changement vaut acceptation.</p>],
      ['11. Contact', <p>Pour toute question : {mail()}. Les protections que la loi de votre pays accorde aux consommateurs continuent de s'appliquer.</p>],
    ],
  };
  if (id === 'privacy') return {
    title: legalTitle(id),
    summary: <p>En bref : nous gardons seulement ce qu'il faut pour faire marcher votre compte. Pas de publicité, pas de traceur, aucune revente. Vous pouvez tout exporter ou tout supprimer depuis votre compte.</p>,
    sections: [
      ['Qui est responsable', <p>TokenStudio, joignable à {mail()}, est responsable du traitement des données décrites ici.</p>],
      ['Ce que nous enregistrons', <>
        <div className="lp-legal-tbl" tabIndex={0} role="region" aria-label="Données enregistrées"><table>
          <thead><tr><th>Donnée</th><th>Pourquoi</th></tr></thead>
          <tbody>
            <tr><td>Adresse e-mail, si vous vous connectez par e-mail</td><td>Connexion, codes de vérification, messages liés au compte</td></tr>
            <tr><td>Adresses publiques de vos wallets</td><td>Connexion par wallet, wallets liés, retraits autorisés</td></tr>
            <tr><td>Contenu du compte : tokens, brouillons, logos, ordres, opérations, diffusion, réglages</td><td>Vous rendre votre travail sur tous vos appareils</td></tr>
            <tr><td>Clés API que vous ajoutez (RPC, Pinata)</td><td>Utiliser vos services ; chiffrées (AES-256-GCM)</td></tr>
            <tr><td>Clé du wallet rapide, si vous le créez</td><td>Signer vos opérations de trading ; chiffrée, protégée par votre mot de passe</td></tr>
            <tr><td>Abonnements aux notifications (avec un nom d'appareil comme « Android · Chrome »)</td><td>Vous envoyer les alertes d'ordres</td></tr>
            <tr><td>Journal de sécurité : création du compte, wallets ajoutés, envois de logos</td><td>Sécurité, limites contre les abus</td></tr>
            <tr><td>Données techniques de connexion (adresse IP, navigateur), gérées par nos hébergeurs</td><td>Sécurité et bon fonctionnement</td></tr>
          </tbody>
        </table></div>
        <p>Base légale : l'exécution du service que vous demandez, et notre intérêt légitime à le sécuriser.</p></>],
      ['Ce que nous ne faisons pas', <ul><li>Aucune publicité, aucun outil de mesure d'audience ni traceur tiers.</li><li>Aucune vente ni location de vos données.</li><li>Votre e-mail et votre compte ne sont jamais publiés avec vos tokens.</li></ul>],
      ['Dans votre navigateur', <p>Le site garde dans votre navigateur votre session de connexion, votre langue, quelques préférences d'affichage et les données de la démo. Ce stockage est nécessaire au fonctionnement du site ; il ne sert pas à vous suivre. Il n'y a donc pas de bandeau de cookies.</p>],
      ['Qui traite vos données pour nous', <>
        <div className="lp-legal-tbl" tabIndex={0} role="region" aria-label="Prestataires"><table>
          <thead><tr><th>Prestataire</th><th>Rôle</th><th>Lieu</th></tr></thead>
          <tbody>
            <tr><td>Supabase</td><td>Base de données, comptes, fonctions serveur, stockage des logos</td><td>Union européenne (Francfort)</td></tr>
            <tr><td>Vercel</td><td>Hébergement du site</td><td>Réseau mondial, société aux États-Unis</td></tr>
            <tr><td>Brevo</td><td>Envoi des e-mails du compte</td><td>Union européenne (France)</td></tr>
            <tr><td>Services de notification de votre navigateur (Google, Apple, Mozilla…)</td><td>Acheminer les alertes</td><td>Selon votre navigateur</td></tr>
          </tbody>
        </table></div>
        <p>Quand vous lancez ou échangez un token, les données nécessaires partent vers pump.fun, PumpPortal, IPFS et les nœuds de la blockchain Solana. Ce sont des services indépendants, et ces informations y deviennent publiques.</p></>],
      ['Blockchain : public et permanent', <p>Les transactions, les adresses de wallets, ainsi que le nom, le logo et la fiche d'un token lancé sont publics et inscrits pour toujours sur la blockchain et sur IPFS. Personne, pas même nous, ne peut les effacer, y compris après la suppression de votre compte.</p>],
      ['Durée de conservation', <p>Vos données restent tant que votre compte existe. Quand vous supprimez votre compte, elles sont effacées immédiatement de notre base, logos compris ; les sauvegardes techniques de l'hébergeur disparaissent ensuite selon son propre cycle.</p>],
      ['Vos droits', <><p>Vous pouvez à tout moment :</p><ul><li>consulter et exporter vos données : menu du compte → Données → Exporter ;</li><li>les corriger depuis l'outil ;</li><li>supprimer votre compte et toutes ses données : menu du compte → Données → Supprimer le compte ;</li><li>nous écrire pour toute autre demande (accès, opposition, limitation) : {mail()}.</li></ul><p>Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l'autorité de protection des données de votre pays (en France, la CNIL).</p></>],
      ['Sécurité', <p>Chaque compte ne peut lire que ses propres données (règles d'accès dans la base), les secrets sont chiffrés, et vous pouvez activer la double authentification. Aucun système n'est parfait : signalez-nous tout problème à {mail()}.</p>],
      ['Mineurs', <p>TokenStudio n'est pas destiné aux personnes de moins de 18 ans.</p>],
    ],
  };
  if (id === 'risks') return {
    title: legalTitle(id),
    summary: <p>Les memecoins sont parmi les actifs les plus risqués qui existent. Vous pouvez perdre la totalité de ce que vous engagez, très vite. N'utilisez que des sommes que vous acceptez de perdre.</p>,
    sections: [
      ['Volatilité extrême', <p>Le prix d'un token pump.fun peut monter ou s'effondrer de plus de 90 % en quelques minutes. La plupart des tokens perdent presque toute leur valeur peu après leur lancement.</p>],
      ['Liquidité et glissement', <p>Sur la courbe de liaison comme après la migration, le prix bouge à chaque achat et vente. Une grosse vente peut être exécutée bien en dessous du prix affiché, et il peut ne plus y avoir d'acheteurs.</p>],
      ['Autres acteurs du marché', <p>Des bots rapides, des développeurs qui revendent tout d'un coup (rug pull) ou des groupes coordonnés agissent sur ces marchés. Ils peuvent acheter avant vous ou vendre juste avant une chute.</p>],
      ['Transactions définitives', <p>Une transaction signée ne peut pas être annulée. Une erreur d'adresse, de montant ou de token est en général irréversible.</p>],
      ['Ordres automatiques', <p>Les ventes automatiques suivent les règles que vous avez réglées, sans jugement. Un contrôle a lieu toutes les 10 secondes environ : un prix peut s'effondrer entre deux contrôles, et une vente peut échouer (réseau saturé, frais, manque de SOL). Les résultats passés ou ceux de la démo ne garantissent rien.</p>],
      ['Sécurité de vos wallets', <p>Méfiez-vous des sites imitant TokenStudio, des messages privés et des liens inconnus. Ne communiquez jamais votre phrase de récupération. TokenStudio ne vous la demandera jamais.</p>],
      ['Services tiers et technique', <p>pump.fun, PumpPortal, les nœuds Solana ou votre wallet peuvent tomber en panne, changer leurs règles ou présenter des failles. Le réseau Solana peut être ralenti ou interrompu.</p>],
      ['Lois et impôts', <p>Les règles sur les crypto-actifs varient selon les pays et évoluent. Il vous appartient de vérifier que vous avez le droit de créer et d'échanger des tokens chez vous, et de déclarer vos gains ou pertes si votre pays l'exige.</p>],
      ['Responsabilité du créateur', <p>Lancer un token, c'est inviter d'autres personnes à acheter. Ne promettez jamais de gain, ne vous faites pas passer pour un autre projet, et ne lancez pas un token pour le revendre aussitôt aux acheteurs.</p>],
    ],
  };
  return {
    title: legalTitle(id),
    summary: <p>Informations sur l'éditeur et l'hébergement du site.</p>,
    sections: [
      ['Éditeur', <p><b>TokenStudio</b>, projet indépendant.<br />Contact : {mail()}</p>],
      ['Hébergement du site', <p><b>Vercel Inc.</b><br />440 N Barranca Ave #4133, Covina, CA 91723, États-Unis<br /><a href="https://vercel.com" target="_blank" rel="noopener noreferrer">vercel.com</a></p>],
      ['Base de données et comptes', <p><b>Supabase Inc.</b>, serveurs dans l'Union européenne (Francfort)<br /><a href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a></p>],
      ['Envoi des e-mails', <p><b>Brevo</b> (Sendinblue SAS)<br />106 boulevard Haussmann, 75008 Paris, France<br /><a href="https://www.brevo.com" target="_blank" rel="noopener noreferrer">brevo.com</a></p>],
      ['Indépendance', <p>TokenStudio n'est affilié ni à pump.fun, ni à PumpPortal, ni à Solana, ni aux wallets cités (Phantom, Solflare, Backpack…). Leurs noms et marques appartiennent à leurs propriétaires et ne sont cités que pour décrire la compatibilité.</p>],
      ['Propriété intellectuelle', <p>Le site, son code, son design et ses textes appartiennent à TokenStudio. Les tokens, noms, textes et logos créés par les utilisateurs restent à leurs auteurs.</p>],
    ],
  };
}

/* ---------------------------------------------------------------- English */
function en(id: LegalId): Doc {
  if (id === 'terms') return {
    title: legalTitle(id),
    summary: <p>In short: TokenStudio is a free tool. You stay in control of your wallets and you alone are responsible for the tokens you create and the transactions you sign. Memecoins can lose all their value.</p>,
    sections: [
      ['1. Purpose', <><p>TokenStudio is a software tool that helps you create, launch and manage tokens on pump.fun (Solana blockchain): creation studio, launch, tracking, trading, automatic sell orders, portfolio and listings.</p><p>These terms apply as soon as you use the site, in the demo and in live mode. By creating an account, you accept them.</p></>],
      ['2. Access and account', <><ul><li>The demo is open without an account: everything is simulated and no real SOL is used.</li><li>Live mode requires an account. No account is created without your explicit consent.</li><li>You must be of legal age and allowed, in your country, to use crypto-assets.</li><li>You are responsible for the security of your account, your email and your wallets. We recommend enabling two-factor authentication.</li></ul></>],
      ['3. Your wallets and funds', <><p>TokenStudio is non-custodial: transactions are prepared by the tool and signed by your wallet (Phantom, Solflare…). Your private keys are never sent to us.</p><p>One exception, if you create it: the <b>quick wallet</b>. Its key is generated and stored encrypted on our servers so it can sign without a pop-up. It is protected by your password, only signs trading operations, within your daily cap (10 SOL at most), and its withdrawals can only go to wallets linked to your account. Only keep in it what you need.</p></>],
      ['4. Transactions', <><ul><li>A blockchain transaction is final: nobody, not even us, can reverse it.</li><li>The check before signing reduces mistakes but guarantees neither the price, the outcome nor the success of the transaction.</li><li>Automatic sells are executed by the server according to the orders you set. They may be delayed (checked about every 10 seconds), partial, suffer price slippage or fail, for example when the network is congested or the wallet lacks SOL.</li><li>Solana network, pump.fun and third-party fees are paid by you.</li></ul></>],
      ['5. Prohibited uses', <><p>You agree not to use TokenStudio to:</p><ul><li>imitate an existing brand, company, person or project, or mislead buyers about a token's origin;</li><li>manipulate a market: wash trading, coordinated group buys (bundling), organised sniping, pump and dump, false promises of profit;</li><li>publish content that is illegal, hateful, violent, sexual involving minors, or that infringes the rights of others (trademarks, copyright, likeness);</li><li>launder money, evade sanctions or break the laws of your country, including those on securities offerings;</li><li>attack, overload or bypass the limits of the service.</li></ul><p>In case of abuse, we may suspend or delete an account.</p></>],
      ['6. Your content', <p>You keep ownership of the names, texts and logos you create. You allow us to store and display them in your account to run the service. Once a token is launched, its name, logo and metadata are published on IPFS and on the blockchain: they become public and can no longer be erased. You confirm you hold the necessary rights to what you publish.</p>],
      ['7. Third-party services', <p>TokenStudio relies on independent services: pump.fun, PumpPortal, Solana RPC nodes, Jupiter, DexScreener, your wallet. We do not control them. Their own terms apply, and an outage or change on their side can stop a feature from working.</p>],
      ['8. No advice, no warranty', <><p>TokenStudio provides no investment, legal or tax advice and promises no profit. The studio's ideas and risk analyses are aids, not recommendations. Demo results are simulated and predict nothing.</p><p>The service is provided “as is”, with no guarantee of continuous availability or freedom from errors. To the fullest extent permitted by law, we are not liable for losses related to token values, transactions you sign, orders you set or third-party services.</p></>],
      ['9. Ending use', <p>You can delete your account at any time from your account menu → Données (Data). If your quick wallet still holds SOL or tokens, deletion is refused until you withdraw them, so that you don't lose them.</p>],
      ['10. Changes', <p>We may update these terms. The update date is shown at the top of the page; for significant changes, we let you know in the tool. Continuing to use TokenStudio after a change means you accept it.</p>],
      ['11. Contact', <p>For any question: {mail()}. The consumer protections granted by the law of your country continue to apply.</p>],
    ],
  };
  if (id === 'privacy') return {
    title: legalTitle(id),
    summary: <p>In short: we only keep what your account needs to work. No ads, no trackers, no resale. You can export or delete everything from your account.</p>,
    sections: [
      ['Who is responsible', <p>TokenStudio, reachable at {mail()}, is responsible for the processing of the data described here.</p>],
      ['What we store', <>
        <div className="lp-legal-tbl" tabIndex={0} role="region" aria-label="Data stored"><table>
          <thead><tr><th>Data</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>Email address, if you sign in by email</td><td>Sign-in, verification codes, account messages</td></tr>
            <tr><td>Public addresses of your wallets</td><td>Wallet sign-in, linked wallets, allowed withdrawals</td></tr>
            <tr><td>Account content: tokens, drafts, logos, orders, operations, listings, settings</td><td>Giving you back your work on all your devices</td></tr>
            <tr><td>API keys you add (RPC, Pinata)</td><td>Using your services; encrypted (AES-256-GCM)</td></tr>
            <tr><td>Quick wallet key, if you create one</td><td>Signing your trading operations; encrypted, protected by your password</td></tr>
            <tr><td>Notification subscriptions (with a device name such as “Android · Chrome”)</td><td>Sending you order alerts</td></tr>
            <tr><td>Security log: account creation, wallets added, logo uploads</td><td>Security, abuse limits</td></tr>
            <tr><td>Technical connection data (IP address, browser), handled by our hosting providers</td><td>Security and proper operation</td></tr>
          </tbody>
        </table></div>
        <p>Legal basis: performing the service you request, and our legitimate interest in keeping it secure.</p></>],
      ['What we don\'t do', <ul><li>No advertising, no audience measurement or third-party trackers.</li><li>No sale or rental of your data.</li><li>Your email and account are never published with your tokens.</li></ul>],
      ['In your browser', <p>The site keeps your sign-in session, your language, a few display preferences and the demo data in your browser. This storage is needed for the site to work; it is not used to track you. That's why there is no cookie banner.</p>],
      ['Who processes your data for us', <>
        <div className="lp-legal-tbl" tabIndex={0} role="region" aria-label="Service providers"><table>
          <thead><tr><th>Provider</th><th>Role</th><th>Location</th></tr></thead>
          <tbody>
            <tr><td>Supabase</td><td>Database, accounts, server functions, logo storage</td><td>European Union (Frankfurt)</td></tr>
            <tr><td>Vercel</td><td>Website hosting</td><td>Global network, US company</td></tr>
            <tr><td>Brevo</td><td>Sending account emails</td><td>European Union (France)</td></tr>
            <tr><td>Your browser's notification services (Google, Apple, Mozilla…)</td><td>Delivering alerts</td><td>Depends on your browser</td></tr>
          </tbody>
        </table></div>
        <p>When you launch or trade a token, the required data goes to pump.fun, PumpPortal, IPFS and Solana blockchain nodes. These are independent services, and this information becomes public there.</p></>],
      ['Blockchain: public and permanent', <p>Transactions, wallet addresses, and the name, logo and metadata of a launched token are public and recorded forever on the blockchain and on IPFS. Nobody, not even us, can erase them, including after you delete your account.</p>],
      ['Retention', <p>Your data is kept as long as your account exists. When you delete your account, it is erased from our database immediately, logos included; the hosting provider's technical backups then expire on their own cycle.</p>],
      ['Your rights', <><p>At any time you can:</p><ul><li>view and export your data: account menu → Données (Data) → Exporter (Export);</li><li>correct it from the tool;</li><li>delete your account and all its data: account menu → Données (Data) → Supprimer le compte (Delete account);</li><li>write to us for any other request (access, objection, restriction): {mail()}.</li></ul><p>If you believe your rights are not respected, you can contact your country's data protection authority.</p></>],
      ['Security', <p>Each account can only read its own data (access rules in the database), secrets are encrypted, and you can enable two-factor authentication. No system is perfect: report any issue to {mail()}.</p>],
      ['Minors', <p>TokenStudio is not intended for people under 18.</p>],
    ],
  };
  if (id === 'risks') return {
    title: legalTitle(id),
    summary: <p>Memecoins are among the riskiest assets there are. You can lose everything you put in, very quickly. Only use amounts you can afford to lose.</p>,
    sections: [
      ['Extreme volatility', <p>A pump.fun token's price can rise or crash by more than 90% within minutes. Most tokens lose almost all their value soon after launch.</p>],
      ['Liquidity and slippage', <p>On the bonding curve and after migration, the price moves with every buy and sell. A large sell can execute well below the displayed price, and there may be no buyers left.</p>],
      ['Other market players', <p>Fast bots, developers who dump everything at once (rug pulls) and coordinated groups are active in these markets. They can buy before you or sell just before a crash.</p>],
      ['Final transactions', <p>A signed transaction cannot be reversed. A mistake in an address, an amount or a token is usually irreversible.</p>],
      ['Automatic orders', <p>Automatic sells follow the rules you set, without judgement. A check runs about every 10 seconds: a price can collapse between two checks, and a sell can fail (congested network, fees, not enough SOL). Past or demo results guarantee nothing.</p>],
      ['Wallet security', <p>Beware of sites imitating TokenStudio, private messages and unknown links. Never share your recovery phrase. TokenStudio will never ask for it.</p>],
      ['Third-party and technical risks', <p>pump.fun, PumpPortal, Solana nodes or your wallet can go down, change their rules or have flaws. The Solana network can slow down or halt.</p>],
      ['Laws and taxes', <p>Crypto-asset rules vary by country and change over time. It is up to you to check that you are allowed to create and trade tokens where you live, and to report your gains or losses if your country requires it.</p>],
      ['Creator responsibility', <p>Launching a token invites other people to buy. Never promise profits, never pose as another project, and don't launch a token to dump it on buyers right away.</p>],
    ],
  };
  return {
    title: legalTitle(id),
    summary: <p>Information about the publisher and hosting of the site.</p>,
    sections: [
      ['Publisher', <p><b>TokenStudio</b>, independent project.<br />Contact: {mail()}</p>],
      ['Website hosting', <p><b>Vercel Inc.</b><br />440 N Barranca Ave #4133, Covina, CA 91723, United States<br /><a href="https://vercel.com" target="_blank" rel="noopener noreferrer">vercel.com</a></p>],
      ['Database and accounts', <p><b>Supabase Inc.</b>, servers in the European Union (Frankfurt)<br /><a href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a></p>],
      ['Email delivery', <p><b>Brevo</b> (Sendinblue SAS)<br />106 boulevard Haussmann, 75008 Paris, France<br /><a href="https://www.brevo.com" target="_blank" rel="noopener noreferrer">brevo.com</a></p>],
      ['Independence', <p>TokenStudio is not affiliated with pump.fun, PumpPortal, Solana or the wallets mentioned (Phantom, Solflare, Backpack…). Their names and trademarks belong to their owners and are only cited to describe compatibility.</p>],
      ['Intellectual property', <p>The site, its code, design and texts belong to TokenStudio. Tokens, names, texts and logos created by users remain their authors' property.</p>],
    ],
  };
}

/** Page légale : en-tête simple, résumé, sections, liens vers les autres pages */
export function LegalPage({ id }: { id: LegalId }) {
  const d = lang() === 'en' ? en(id) : fr(id);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const here = LEGAL().find((l) => l.href === location.pathname.replace(/\/+$/, ''))?.href;
  return (
    <div className="lp">
      <header className="lp-nav on">
        <div className="lp-wrap lp-nav-in">
          <Brand />
          <div className="lp-nav-cta">
            <LangSwitch />
            <a className="lp-btn ghost" href="/">{t('Accueil', 'Home')}</a>
          </div>
        </div>
      </header>
      <main className="lp-legal lp-wrap">
        <article className="lp-legal-in">
          <h1>{d.title}</h1>
          <p className="lp-legal-date">{t('Mise à jour le ', 'Updated ')}{UPDATED[lang()]}</p>
          <div className="lp-legal-sum">{d.summary}</div>
          {d.sections.map(([h, body]) => <section key={h}><h2>{h}</h2>{body}</section>)}
          <nav className="lp-legal-nav" aria-label={t('Informations légales', 'Legal information')}>
            {LEGAL().map((l) => <a key={l.href} href={l.href} aria-current={l.href === here ? 'page' : undefined}>{l.label}</a>)}
          </nav>
        </article>
      </main>
      <Footer />
    </div>
  );
}
