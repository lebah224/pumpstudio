import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { maybeSignedIn } from '../lib/guest';

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
    <svg className="lp-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Courbe de liaison remplie à 62,4 %">
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
      <text x={W - 8} y={H - 1} className="lp-axis" textAnchor="end">85 SOL · migration</text>
    </svg>
  );
}

function HeroDesk() {
  return (
    <div className="lp-desk" aria-label="Aperçu de TokenStudio (exemple)">
      <div className="lp-card lp-main">
        <div className="lp-card-h">
          <span className="lp-tok">RP</span>
          <span className="lp-tok-n"><b>Rocket Pup</b><small className="mono">$PUP · 7xKX…gAsU</small></span>
          <span className="lp-pill">exemple</span>
        </div>
        <Curve />
        <div className="lp-stats">
          <div><small>Courbe de liaison</small><b className="mono">62,4 %</b></div>
          <div><small>SOL dans la courbe</small><b className="mono">53,0 / 85</b></div>
          <div><small>Capitalisation</small><b className="mono">41,2 k$</b></div>
        </div>
        <div className="lp-bar" aria-hidden="true"><i style={{ width: '62.4%' }} /></div>
      </div>
      <div className="lp-card lp-side lp-plan">
        <div className="lp-mini-h">{IC.gauge}<b>Plan de sortie</b></div>
        <ul>
          <li><span className="mono">×2</span><span>vendre 25 %</span><em className="ok">atteint</em></li>
          <li><span className="mono">×3</span><span>vendre 25 %</span><em>en attente</em></li>
          <li><span className="mono">×5</span><span>vendre 25 %</span><em>en attente</em></li>
          <li><span className="mono">−30 %</span><span>stop suiveur</span><em>armé</em></li>
        </ul>
      </div>
      <div className="lp-card lp-side lp-check">
        <div className="lp-mini-h">{IC.lock}<b>Lancement vérifié</b></div>
        <ol>
          <li>{IC.check}Logo et fiche sur IPFS</li>
          <li>{IC.check}Transaction préparée</li>
          <li>{IC.check}Simulation acceptée</li>
          <li className="now"><i />Signature dans ton wallet</li>
        </ol>
      </div>
    </div>
  );
}

const FEATURES: { ic: ReactNode; t: string; d: string; unit: string }[] = [
  { ic: IC.spark, t: 'Studio de création', d: 'Idées de noms, symboles, descriptions et logos dans six univers. Ou pars de ton propre concept.', unit: '6 univers · 12 styles de logo' },
  { ic: IC.rocket, t: 'Lancement vérifié', d: 'Le token est préparé, simulé sur la blockchain, puis publié sur pump.fun après ta signature.', unit: '≈ 0,02 SOL de frais réseau' },
  { ic: IC.swap, t: 'Trader et ordres', d: 'Achat, vente, analyse de risque, prises de profit par paliers et stop suiveur, surveillés en continu.', unit: 'Alertes push même studio fermé' },
  { ic: IC.bot, t: 'Bot de trading', d: 'Trois stratégies sur le flux pump.fun en direct. Entraîne-toi en démo, puis passe en réel avec plafonds.', unit: 'Équilibrée · Migration · Flash' },
  { ic: IC.wallet, t: 'Portefeuille', d: 'Valeur, évolution, répartition, tokens détenus et activité. Dépôt par QR code, retrait en un geste.', unit: 'Solana Pay inclus' },
  { ic: IC.radio, t: 'Diffusion', d: 'Les étapes pour être référencé sur DexScreener, GeckoTerminal, Jupiter, CoinGecko et les autres.', unit: '8 plateformes suivies' },
];

const FAQ: [string, string][] = [
  ['Combien coûte TokenStudio ?', 'L\'outil est gratuit. Tu ne paies que les frais du réseau Solana et de pump.fun lors d\'un lancement ou d\'un trade, environ 0,02 SOL pour une création.'],
  ['TokenStudio peut-il toucher à mes fonds ?', 'Non. Tes clés restent dans ton wallet, qui te présente chaque transaction à signer. Seul le wallet rapide, si tu le crées, signe pour toi, et uniquement des opérations de trading dans la limite de tes plafonds.'],
  ['Sous quel nom mon token apparaît-il sur pump.fun ?', 'Sous l\'adresse de ton wallet, ou sous ton pseudo pump.fun si ce wallet a un profil. Ton compte TokenStudio et ton e-mail ne sont jamais publiés.'],
  ['À quoi sert la démo ?', 'À tout découvrir sans compte, avec un wallet démo de 10 SOL fictifs : création, lancement, ordres, bot, tout est simulé. Pour passer en réel, crée ton compte gratuit.'],
  ['Quels sont les risques ?', 'Les memecoins sont extrêmement volatils : leur valeur peut tomber à zéro en quelques minutes. N\'engage que ce que tu acceptes de perdre. TokenStudio ne promet aucun gain.'],
  ['Où sont mes données ?', 'Sur ton compte : tout est enregistré automatiquement et te suit sur chaque appareil. Tu peux les exporter ou supprimer ton compte à tout moment.'],
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
  const start = signed ? { href: '/app', label: 'Ouvrir l\'outil' } : { href: '/inscription', label: 'Commencer gratuitement' };

  // session enregistrée en cours de vérification, ou redirection vers l'outil : rien à afficher
  if ((!ready && maybeSignedIn()) || signed) return null;
  return (
    <div className="lp">
      {deleted && <div className="lp-flash" role="status">Ton compte et toutes ses données ont été supprimés.</div>}
      <header className={'lp-nav' + (scrolled ? ' on' : '')}>
        <div className="lp-wrap lp-nav-in">
          <a className="lp-brand" href="/" aria-label="TokenStudio, accueil">
            <span className="lp-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 20.5h17" /><path d="M4 18c7 0 11-3.5 15.5-13" /><circle cx="19.5" cy="5" r="1.6" /></svg></span>
            <span>Token<b>Studio</b></span>
          </a>
          <nav className="lp-links" aria-label="Sections">
            <a href="#fonctionnalites">Fonctionnalités</a><a href="#etapes">Comment ça marche</a><a href="#securite">Sécurité</a><a href="#faq">FAQ</a>
          </nav>
          <div className="lp-nav-cta">
            {signed ? <a className="lp-btn" href="/app">Ouvrir l'outil</a> : (<>
              <a className="lp-btn ghost" href="/connexion">Se connecter</a>
              <a className="lp-btn" href="/app?demo=1">Essayer la démo</a>
            </>)}
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero lp-wrap">
          <div className="lp-hero-t">
            <p className="lp-eyebrow">Studio de tokens Solana · pump.fun</p>
            <h1>Crée, lance et pilote tes tokens Solana.<span> En toute maîtrise.</span></h1>
            <p className="lp-lead">Du concept au lancement sur pump.fun, puis le suivi, les ordres et le bot de trading. Chaque transaction est vérifiée sur la blockchain avant que tu la signes.</p>
            <div className="lp-cta">
              <a className="lp-btn lg" href={start.href}>{start.label}{IC.arrow}</a>
              <a className="lp-btn lg ghost" href="/app?demo=1">Essayer la démo</a>
            </div>
            <ul className="lp-trust">
              <li>{IC.key}Non-custodial : tes clés restent dans ton wallet</li>
              <li>{IC.eye}Démo sans compte, 10 SOL fictifs</li>
            </ul>
          </div>
          <HeroDesk />
        </section>

        <section className="lp-strip" aria-label="Compatibilité">
          <div className="lp-wrap lp-strip-in">
            <span>Fonctionne avec</span>
            <ul><li>Phantom</li><li>Solflare</li><li>Backpack</li><li>Coinbase Wallet</li><li>OKX Wallet</li><li>Trust Wallet</li></ul>
            <span className="lp-strip-src">Données pump.fun, DexScreener, Jupiter</span>
          </div>
        </section>

        <section className="lp-sec lp-wrap" id="fonctionnalites">
          <div className="lp-sec-h"><p className="lp-eyebrow">Fonctionnalités</p><h2>Tout le cycle de vie d'un token, au même endroit.</h2></div>
          <div className="lp-feat">
            {FEATURES.map((f) => (
              <article key={f.t} className="lp-f">
                <span className="lp-f-ic">{f.ic}</span>
                <h3>{f.t}</h3><p>{f.d}</p>
                <small className="mono">{f.unit}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-sec lp-wrap" id="etapes">
          <div className="lp-sec-h"><p className="lp-eyebrow">Comment ça marche</p><h2>Trois étapes, de l'idée à la courbe.</h2></div>
          <ol className="lp-steps">
            <li><span className="lp-n mono">1</span><h3>Crée</h3><p>Choisis un univers, une idée, un logo. Le studio rédige la fiche et vérifie qu'il ne manque rien.</p></li>
            <li><span className="lp-n mono">2</span><h3>Lance</h3><p>Le token est simulé sur la blockchain, puis publié sur pump.fun dès que tu signes. Ton achat de départ passe dans la même transaction.</p></li>
            <li><span className="lp-n mono">3</span><h3>Pilote</h3><p>Suis la courbe, fixe tes paliers de vente, reçois les alertes, laisse le bot travailler dans tes limites.</p></li>
          </ol>
        </section>

        <section className="lp-sec lp-wrap" id="modes">
          <div className="lp-sec-h"><p className="lp-eyebrow">Démo ou réel</p><h2>Entraîne-toi sans risque, passe en réel quand tu es prêt.</h2></div>
          <div className="lp-modes">
            <article className="lp-mode demo">
              <header><span className="lp-tag v">Démo</span><b>Sans compte</b></header>
              <ul>
                <li>Wallet démo de 10 SOL fictifs</li>
                <li>Lancements, achats et ventes simulés</li>
                <li>Bot sur données simulées</li>
                <li>Crée ton compte quand tu veux passer en réel</li>
              </ul>
              <a className="lp-btn ghost" href="/app?demo=1">Ouvrir la démo</a>
            </article>
            <article className="lp-mode real">
              <header><span className="lp-tag r">Réel</span><b>Avec un compte gratuit</b></header>
              <ul>
                <li>Ton vrai wallet : Phantom, Solflare, Backpack…</li>
                <li>Vérification sur la blockchain avant chaque signature</li>
                <li>« Tester avant de lancer » sur chaque action</li>
                <li>Ordres et bot avec plafonds, alertes sur tes appareils</li>
              </ul>
              <a className="lp-btn" href={start.href}>{start.label}</a>
            </article>
          </div>
        </section>

        <section className="lp-sec lp-wrap lp-sec-split" id="securite">
          <div className="lp-sec-h"><p className="lp-eyebrow">Sécurité</p><h2>Tes fonds restent à toi.</h2>
            <p className="lp-sub">TokenStudio prépare les transactions. Ton wallet les signe. Rien ne part sans ton accord.</p></div>
          <ul className="lp-sec-list">
            <li>{IC.key}<div><b>Non-custodial</b><span>Tes clés ne quittent jamais ton wallet. L'outil ne voit que ton adresse publique.</span></div></li>
            <li>{IC.eye}<div><b>Vérifié avant signature</b><span>Chaque transaction est simulée sur la blockchain : si elle doit échouer, tu ne paies rien.</span></div></li>
            <li>{IC.gauge}<div><b>Plafonds</b><span>Limite par achat et plafond journalier pour le bot et le wallet rapide.</span></div></li>
            <li>{IC.lock}<div><b>Compte protégé</b><span>Connexion par wallet ou e-mail sans mot de passe, double authentification, journal de sécurité.</span></div></li>
            <li>{IC.bell}<div><b>Alertes, jamais d'exécution cachée</b><span>Le serveur te prévient quand un ordre se déclenche. Il ne vend que selon les ordres que tu as réglés.</span></div></li>
          </ul>
        </section>

        <section className="lp-sec lp-wrap" id="faq">
          <div className="lp-sec-h"><p className="lp-eyebrow">Questions fréquentes</p><h2>Ce qu'on nous demande le plus.</h2></div>
          <div className="lp-faq">
            {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </section>

        <section className="lp-final lp-wrap">
          <div className="lp-final-in">
            <h2>Ton prochain token commence ici.</h2>
            <p>Découvre l'outil en démo, ou crée ton compte gratuit pour passer en réel.</p>
            <div className="lp-cta">
              <a className="lp-btn lg" href={start.href}>{start.label}{IC.arrow}</a>
              <a className="lp-btn lg ghost" href="/app?demo=1">Essayer la démo</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-brand sm"><span className="lp-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 20.5h17" /><path d="M4 18c7 0 11-3.5 15.5-13" /><circle cx="19.5" cy="5" r="1.6" /></svg></span><span>Token<b>Studio</b></span></div>
          <p className="lp-risk">Les memecoins sont des actifs extrêmement risqués. TokenStudio est un outil : il ne fournit pas de conseil en investissement et ne garantit aucun gain. TokenStudio n'est affilié ni à pump.fun ni aux wallets cités.</p>
          <nav className="lp-foot-links" aria-label="Liens"><a href="/app?demo=1">Démo</a><a href="/connexion">Connexion</a><a href="/inscription">Créer un compte</a></nav>
        </div>
      </footer>
    </div>
  );
}
