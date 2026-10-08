import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { maybeSignedIn } from '../lib/guest';
import { t } from '../lib/i18n';
import { Brand, Footer } from './Chrome';
import { LangSwitch } from './LangSwitch';

/* ---------- petites icônes au trait ---------- */
const P = (d: ReactNode) => <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true">{d}</svg>;
const IC = {
  spark: P(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M7.8 7.8l1.8 1.8M14.4 14.4l1.8 1.8M7.8 16.2l1.8-1.8M14.4 9.6l1.8-1.8" /></>),
  rocket: P(<><path d="M5 19c1-4 3-7 7-9M12 10c3-3 6-4 9-4-1 3-1 6-4 9-2 2-5 3-7 3" /><circle cx="15" cy="9" r="1.5" /><path d="M7 14l-3 1 1-3" /></>),
  swap: P(<path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" />),
  bot: P(<><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" /></>),
  wallet: P(<><path d="M20 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h13a2 2 0 002-2v-2" /><path d="M22 11h-6a2 2 0 000 4h6v-4z" /></>),
  radio: P(<><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8" /></>),
  lock: P(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>),
  check: P(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  eye: P(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  gauge: P(<><path d="M4 18a8 8 0 1116 0" /><path d="M12 18l4-6" /></>),
  key: P(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>),
  bell: P(<><path d="M6 16V11a6 6 0 1112 0v5l2 2H4z" /><path d="M10 21h4" /></>),
  arrow: P(<path d="M5 12h14M13 6l6 6-6 6" />),
};

/* ---------- courbe de liaison pump.fun (produit constant : prix ∝ (30 + SOL)²) ---------- */
function Curve() {
  const W = 420, H = 190, n = 60, fill = 0.624;
  const pts = Array.from({ length: n + 1 }, (_, i) => { const x = i / n; return [x, ((30 + 85 * x) / 30) ** 2] as const; });
  const max = pts[n]![1];
  const X = (x: number) => 8 + x * (W - 16), Y = (v: number) => H - 14 - ((v - 1) / (max - 1)) * (H - 30);
  const line = pts.map(([x, v], i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const cut = pts.filter(([x]) => x <= fill);
  const area = cut.map(([x, v], i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ') + ` L${X(fill).toFixed(1)} ${H - 14} L${X(0)} ${H - 14} Z`;
  const v = ((30 + 85 * fill) / 30) ** 2;
  return (
    <svg className="lp-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Courbe de liaison remplie à 62,4 %', 'Bonding curve 62.4% filled')}>
      <defs>
        <linearGradient id="lpA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--gold)" stopOpacity=".38" /><stop offset="1" stopColor="var(--gold)" stopOpacity="0" /></linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="8" x2={W - 8} y1={14 + f * (H - 28)} y2={14 + f * (H - 28)} className="lp-grid" />)}
      <path d={area} fill="url(#lpA)" className="lp-area" />
      <path d={line} className="lp-line-ghost" />
      <path d={cut.map(([x, vv], i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(vv).toFixed(1)).join(' ')} className="lp-line" pathLength={1} />
      <line x1={X(fill)} x2={X(fill)} y1={Y(v)} y2={H - 14} className="lp-drop" />
      <circle cx={X(fill)} cy={Y(v)} r="6" className="lp-dot" />
      <text x="8" y={H - 1} className="lp-axis">0 SOL</text>
      <text x={W - 8} y={H - 1} className="lp-axis" textAnchor="end">{t('85 SOL · migration', '85 SOL · migration')}</text>
    </svg>
  );
}

function HeroDesk() {
  return (
    <div className="lp-desk" aria-label={t('Aperçu de TokenStudio (exemple)', 'TokenStudio preview (example)')}>
      <div className="lp-card lp-main">
        <div className="lp-card-h">
          <span className="lp-tok">RP</span>
          <span className="lp-tok-n"><b>Rocket Pup</b><small className="mono">$PUP · 7xKX…gAsU</small></span>
          <span className="lp-pill">{t('exemple', 'example')}</span>
        </div>
        <Curve />
        <div className="lp-stats">
          <div><small>{t('Courbe de liaison', 'Bonding curve')}</small><b className="mono">{t('62,4 %', '62.4%')}</b></div>
          <div><small>{t('SOL dans la courbe', 'SOL in the curve')}</small><b className="mono">{t('53,0 / 85', '53.0 / 85')}</b></div>
          <div><small>{t('Capitalisation', 'Market cap')}</small><b className="mono">{t('41,2 k$', '$41.2k')}</b></div>
        </div>
        <div className="lp-bar" aria-hidden="true"><i style={{ width: '62.4%' }} /></div>
      </div>
      <div className="lp-card lp-side lp-plan">
        <div className="lp-mini-h">{IC.gauge}<b>{t('Plan de sortie', 'Exit plan')}</b></div>
        <ul>
          <li><span className="mono">×2</span><span>{t('vendre 25 %', 'sell 25%')}</span><em className="ok">{t('atteint', 'hit')}</em></li>
          <li><span className="mono">×3</span><span>{t('vendre 25 %', 'sell 25%')}</span><em>{t('en attente', 'waiting')}</em></li>
          <li><span className="mono">×5</span><span>{t('vendre 25 %', 'sell 25%')}</span><em>{t('en attente', 'waiting')}</em></li>
          <li><span className="mono">−30 %</span><span>{t('stop suiveur', 'trailing stop')}</span><em>{t('armé', 'armed')}</em></li>
        </ul>
      </div>
      <div className="lp-card lp-side lp-check">
        <div className="lp-mini-h">{IC.lock}<b>{t('Lancement vérifié', 'Verified launch')}</b></div>
        <ol>
          <li>{IC.check}{t('Logo et fiche sur IPFS', 'Logo and metadata on IPFS')}</li>
          <li>{IC.check}{t('Transaction préparée', 'Transaction prepared')}</li>
          <li>{IC.check}{t('Simulation acceptée', 'Simulation passed')}</li>
          <li className="now"><i />{t('Signature dans ton wallet', 'Signing in your wallet')}</li>
        </ol>
      </div>
    </div>
  );
}

const FEATURES = (): { ic: ReactNode; t: string; d: string; unit: string }[] => [
  { ic: IC.spark, t: t('Studio de création', 'Creation studio'), d: t('Idées de noms, symboles, descriptions et logos dans six univers. Ou pars de ton propre concept.', 'Name, ticker, description and logo ideas across six themes. Or start from your own concept.'), unit: t('6 univers · 12 styles de logo', '6 themes · 12 logo styles') },
  { ic: IC.rocket, t: t('Lancement vérifié', 'Verified launch'), d: t('Le token est préparé, simulé sur la blockchain, puis publié sur pump.fun après ta signature.', 'Your token is prepared, simulated on-chain, then published on pump.fun once you sign.'), unit: t('≈ 0,02 SOL de frais réseau', '≈ 0.02 SOL in network fees') },
  { ic: IC.swap, t: t('Trader et ordres', 'Trading and orders'), d: t('Achat, vente, analyse de risque, prises de profit par paliers et stop suiveur, surveillés en continu.', 'Buy, sell, risk analysis, tiered take-profits and trailing stops, watched around the clock.'), unit: t('Ventes automatiques par le serveur', 'Automatic sells by the server') },
  { ic: IC.bot, t: t('Bot de trading', 'Trading bot'), d: t('Trois stratégies sur le flux pump.fun en direct. Entraîne-toi en démo, puis passe en réel avec plafonds.', 'Three strategies on the live pump.fun feed. Practise in the demo, then go live with spending caps.'), unit: t('Équilibrée · Migration · Flash', 'Balanced · Migration · Flash') },
  { ic: IC.wallet, t: t('Portefeuille', 'Portfolio'), d: t('Valeur, évolution, répartition, tokens détenus et activité. Dépôt par QR code, retrait en un geste.', 'Value, history, allocation, holdings and activity. Deposit by QR code, withdraw in one tap.'), unit: t('Solana Pay inclus', 'Solana Pay included') },
  { ic: IC.radio, t: t('Diffusion', 'Listings'), d: t('Les étapes pour être référencé sur DexScreener, GeckoTerminal, Jupiter, CoinGecko et les autres.', 'The steps to get listed on DexScreener, GeckoTerminal, Jupiter, CoinGecko and more.'), unit: t('8 plateformes suivies', '8 platforms tracked') },
];

const FAQ = (): [string, string][] => [
  [t('Combien coûte TokenStudio ?', 'How much does TokenStudio cost?'), t('L\'outil est gratuit. Tu ne paies que les frais du réseau Solana et de pump.fun lors d\'un lancement ou d\'un trade, environ 0,02 SOL pour une création.', 'The tool is free. You only pay Solana network and pump.fun fees when you launch or trade, about 0.02 SOL for a token creation.')],
  [t('TokenStudio peut-il toucher à mes fonds ?', 'Can TokenStudio touch my funds?'), t('Non. Tes clés restent dans ton wallet, qui te présente chaque transaction à signer. Seul le wallet rapide, si tu le crées, signe pour toi, et uniquement des opérations de trading dans la limite de tes plafonds.', 'No. Your keys stay in your wallet, which shows you every transaction to sign. Only the quick wallet, if you create one, signs for you, and only trading operations within your caps.')],
  [t('Sous quel nom mon token apparaît-il sur pump.fun ?', 'Under what name does my token appear on pump.fun?'), t('Sous l\'adresse de ton wallet, ou sous ton pseudo pump.fun si ce wallet a un profil. Ton compte TokenStudio et ton e-mail ne sont jamais publiés.', 'Under your wallet address, or your pump.fun username if that wallet has a profile. Your TokenStudio account and email are never published.')],
  [t('À quoi sert la démo ?', 'What is the demo for?'), t('À tout découvrir sans compte, avec un wallet démo de 10 SOL fictifs : création, lancement, ordres, bot, tout est simulé. Pour passer en réel, crée ton compte gratuit.', 'To try everything without an account, with a demo wallet holding 10 fake SOL: creation, launch, orders, bot, everything is simulated. To go live, create your free account.')],
  [t('Quels sont les risques ?', 'What are the risks?'), t('Les memecoins sont extrêmement volatils : leur valeur peut tomber à zéro en quelques minutes. N\'engage que ce que tu acceptes de perdre. TokenStudio ne promet aucun gain.', 'Memecoins are extremely volatile: their value can drop to zero within minutes. Only commit what you can afford to lose. TokenStudio promises no profit.')],
  [t('Où sont mes données ?', 'Where is my data?'), t('Sur ton compte : tout est enregistré automatiquement et te suit sur chaque appareil. Tu peux les exporter ou supprimer ton compte à tout moment.', 'In your account: everything is saved automatically and follows you on every device. You can export it or delete your account at any time.')],
];

export function Landing() {
  const { ready, session } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  // retour après une suppression de compte : confirmation affichée une fois
  const [deleted] = useState(() => { try { const v = sessionStorage.getItem('ts-account-deleted'); sessionStorage.removeItem('ts-account-deleted'); return v === '1'; } catch { return false; } });
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    f(); window.addEventListener('scroll', f, { passive: true }); return () => window.removeEventListener('scroll', f);
  }, []);
  const signed = ready && !!session;
  // connecté : l'accueil laisse place à l'outil
  useEffect(() => { if (signed) location.replace('/app'); }, [signed]);
  const start = signed ? { href: '/app', label: t('Ouvrir l\'outil', 'Open the tool') } : { href: '/inscription', label: t('Commencer gratuitement', 'Get started free') };
  const demo = t('Essayer la démo', 'Try the demo');

  // session enregistrée en cours de vérification, ou redirection vers l'outil : rien à afficher
  if ((!ready && maybeSignedIn()) || signed) return null;
  return (
    <div className="lp">
      {deleted && <div className="lp-flash" role="status">{t('Ton compte et toutes ses données ont été supprimés.', 'Your account and all its data have been deleted.')}</div>}
      <header className={'lp-nav' + (scrolled ? ' on' : '')}>
        <div className="lp-wrap lp-nav-in">
          <Brand />
          <nav className="lp-links" aria-label={t('Sections', 'Sections')}>
            <a href="#fonctionnalites">{t('Fonctionnalités', 'Features')}</a><a href="#etapes">{t('Comment ça marche', 'How it works')}</a><a href="#securite">{t('Sécurité', 'Security')}</a><a href="#faq">{t('FAQ', 'FAQ')}</a>
          </nav>
          <div className="lp-nav-cta">
            <LangSwitch />
            <a className="lp-btn ghost" href="/connexion">{t('Se connecter', 'Sign in')}</a>
            <a className="lp-btn" href="/app?demo=1">{demo}</a>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero lp-wrap">
          <div className="lp-hero-t">
            <p className="lp-eyebrow">{t('Studio de tokens Solana · pump.fun', 'Solana token studio · pump.fun')}</p>
            <h1>{t('Crée, lance et pilote tes tokens Solana.', 'Create, launch and manage your Solana tokens.')}<span>{t(' En toute maîtrise.', ' Fully in control.')}</span></h1>
            <p className="lp-lead">{t('Du concept au lancement sur pump.fun, puis le suivi, les ordres et le bot de trading. Chaque transaction est vérifiée sur la blockchain avant que tu la signes.', 'From concept to launch on pump.fun, then tracking, orders and the trading bot. Every transaction is checked on-chain before you sign it.')}</p>
            <div className="lp-cta">
              <a className="lp-btn lg" href={start.href}>{start.label}{IC.arrow}</a>
              <a className="lp-btn lg ghost" href="/app?demo=1">{demo}</a>
            </div>
            <ul className="lp-trust">
              <li>{IC.key}{t('Non-custodial : tes clés restent dans ton wallet', 'Non-custodial: your keys stay in your wallet')}</li>
              <li>{IC.eye}{t('Démo sans compte, 10 SOL fictifs', 'No-account demo, 10 fake SOL')}</li>
            </ul>
          </div>
          <HeroDesk />
        </section>

        <section className="lp-strip" aria-label={t('Compatibilité', 'Compatibility')}>
          <div className="lp-wrap lp-strip-in">
            <span>{t('Fonctionne avec', 'Works with')}</span>
            <ul><li>Phantom</li><li>Solflare</li><li>Backpack</li><li>Coinbase Wallet</li><li>OKX Wallet</li><li>Trust Wallet</li></ul>
            <span className="lp-strip-src">{t('Données pump.fun, DexScreener, Jupiter', 'Data from pump.fun, DexScreener, Jupiter')}</span>
          </div>
        </section>

        <section className="lp-sec lp-wrap" id="fonctionnalites">
          <div className="lp-sec-h"><p className="lp-eyebrow">{t('Fonctionnalités', 'Features')}</p><h2>{t('Tout le cycle de vie d\'un token, au même endroit.', 'A token\'s whole life cycle, in one place.')}</h2></div>
          <div className="lp-feat">
            {FEATURES().map((f) => (
              <article key={f.t} className="lp-f">
                <span className="lp-f-ic">{f.ic}</span>
                <h3>{f.t}</h3><p>{f.d}</p>
                <small className="mono">{f.unit}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-sec lp-wrap" id="etapes">
          <div className="lp-sec-h"><p className="lp-eyebrow">{t('Comment ça marche', 'How it works')}</p><h2>{t('Trois étapes, de l\'idée à la courbe.', 'Three steps, from idea to curve.')}</h2></div>
          <ol className="lp-steps">
            <li><span className="lp-n mono">1</span><h3>{t('Crée', 'Create')}</h3><p>{t('Choisis un univers, une idée, un logo. Le studio rédige la fiche et vérifie qu\'il ne manque rien.', 'Pick a theme, an idea, a logo. The studio writes the token page and checks nothing is missing.')}</p></li>
            <li><span className="lp-n mono">2</span><h3>{t('Lance', 'Launch')}</h3><p>{t('Le token est simulé sur la blockchain, puis publié sur pump.fun dès que tu signes. Ton achat de départ passe dans la même transaction.', 'The token is simulated on-chain, then published on pump.fun as soon as you sign. Your initial buy goes through in the same transaction.')}</p></li>
            <li><span className="lp-n mono">3</span><h3>{t('Pilote', 'Manage')}</h3><p>{t('Suis la courbe, fixe tes paliers de vente, reçois les alertes, laisse le bot travailler dans tes limites.', 'Follow the curve, set your sell tiers, get alerts, and let the bot work within your limits.')}</p></li>
          </ol>
        </section>

        <section className="lp-sec lp-wrap" id="modes">
          <div className="lp-sec-h"><p className="lp-eyebrow">{t('Démo ou réel', 'Demo or live')}</p><h2>{t('Entraîne-toi sans risque, passe en réel quand tu es prêt.', 'Practise risk-free, go live when you\'re ready.')}</h2></div>
          <div className="lp-modes">
            <article className="lp-mode demo">
              <header><span className="lp-tag v">{t('Démo', 'Demo')}</span><b>{t('Sans compte', 'No account')}</b></header>
              <ul>
                <li>{t('Wallet démo de 10 SOL fictifs', 'Demo wallet with 10 fake SOL')}</li>
                <li>{t('Lancements, achats et ventes simulés', 'Simulated launches, buys and sells')}</li>
                <li>{t('Bot sur données simulées', 'Bot on simulated data')}</li>
                <li>{t('Crée ton compte quand tu veux passer en réel', 'Create your account when you want to go live')}</li>
              </ul>
              <a className="lp-btn ghost" href="/app?demo=1">{t('Ouvrir la démo', 'Open the demo')}</a>
            </article>
            <article className="lp-mode real">
              <header><span className="lp-tag r">{t('Réel', 'Live')}</span><b>{t('Avec un compte gratuit', 'With a free account')}</b></header>
              <ul>
                <li>{t('Ton vrai wallet : Phantom, Solflare, Backpack…', 'Your real wallet: Phantom, Solflare, Backpack…')}</li>
                <li>{t('Vérification sur la blockchain avant chaque signature', 'On-chain check before every signature')}</li>
                <li>{t('« Tester avant de lancer » sur chaque action', '“Test before launching” on every action')}</li>
                <li>{t('Ordres et bot avec plafonds, alertes sur tes appareils', 'Orders and bot with caps, alerts on your devices')}</li>
              </ul>
              <a className="lp-btn" href={start.href}>{start.label}</a>
            </article>
          </div>
        </section>

        <section className="lp-sec lp-wrap lp-sec-split" id="securite">
          <div className="lp-sec-h"><p className="lp-eyebrow">{t('Sécurité', 'Security')}</p><h2>{t('Tes fonds restent à toi.', 'Your funds stay yours.')}</h2>
            <p className="lp-sub">{t('TokenStudio prépare les transactions. Ton wallet les signe. Rien ne part sans ton accord.', 'TokenStudio prepares transactions. Your wallet signs them. Nothing goes out without your approval.')}</p></div>
          <ul className="lp-sec-list">
            <li>{IC.key}<div><b>{t('Non-custodial', 'Non-custodial')}</b><span>{t('Tes clés ne quittent jamais ton wallet. L\'outil ne voit que ton adresse publique.', 'Your keys never leave your wallet. The tool only sees your public address.')}</span></div></li>
            <li>{IC.eye}<div><b>{t('Vérifié avant signature', 'Checked before signing')}</b><span>{t('Chaque transaction est simulée sur la blockchain : si elle doit échouer, tu ne paies rien.', 'Every transaction is simulated on-chain: if it would fail, you pay nothing.')}</span></div></li>
            <li>{IC.gauge}<div><b>{t('Plafonds', 'Caps')}</b><span>{t('Limite par achat et plafond journalier pour le bot et le wallet rapide.', 'A per-buy limit and a daily cap for the bot and the quick wallet.')}</span></div></li>
            <li>{IC.lock}<div><b>{t('Compte protégé', 'Protected account')}</b><span>{t('Connexion par wallet ou e-mail sans mot de passe, double authentification, journal de sécurité.', 'Sign in with your wallet or a passwordless email, two-factor authentication, security log.')}</span></div></li>
            <li>{IC.bell}<div><b>{t('Alertes, jamais d\'exécution cachée', 'Alerts, never hidden execution')}</b><span>{t('Le serveur te prévient quand un ordre se déclenche. Il ne vend que selon les ordres que tu as réglés.', 'The server lets you know when an order triggers. It only sells according to the orders you set.')}</span></div></li>
          </ul>
        </section>

        <section className="lp-sec lp-wrap" id="faq">
          <div className="lp-sec-h"><p className="lp-eyebrow">{t('Questions fréquentes', 'Frequently asked questions')}</p><h2>{t('Ce qu\'on nous demande le plus.', 'What people ask us most.')}</h2></div>
          <div className="lp-faq">
            {FAQ().map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </section>

        <section className="lp-final lp-wrap">
          <div className="lp-final-in">
            <h2>{t('Ton prochain token commence ici.', 'Your next token starts here.')}</h2>
            <p>{t('Découvre l\'outil en démo, ou crée ton compte gratuit pour passer en réel.', 'Explore the tool in the demo, or create your free account to go live.')}</p>
            <div className="lp-cta">
              <a className="lp-btn lg" href={start.href}>{start.label}{IC.arrow}</a>
              <a className="lp-btn lg ghost" href="/app?demo=1">{demo}</a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
