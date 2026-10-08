/* eslint-disable */
// Terminal de trading historique (bot papier), migré tel quel.
/* =========================================================================
   Terminal de trading — moteur PumpBot v2 intégré au studio
   Flux PumpPortal (connexion unique du studio) → métriques partagées → 3 stratégies en parallèle
   → portefeuilles papier. Aucun ordre réel n'est envoyé.
   ========================================================================= */
(function () {
'use strict';
const ROOT = document.getElementById('p-bot');
const PS = window.PumpStudio;
if (!ROOT || !PS || !PS.pp) return;

const SUPPLY = 1e9;
const SNIPE_WINDOW = 3000;     // acheteurs dans les 3 premières secondes = snipers
const BUNDLE_WINDOW = 2000;    // supply achetée dans les 2 premières secondes = bundle probable
const FAST_SELL_SEC = 300;     // dev qui vend dans les 5 minutes = vente rapide
const C = { violet: '#6aa8ff', gold: '#d6b26e', green: '#3ccf8e', red: '#ff6b6b', amber: '#f2894b', blue: '#6aa8ff', dim: '#8b8375', grid: '#211f1b', line: '#37332c', bg: '#0b0a09', panel: '#141311' };
const MONO = '11px Geist Mono, ui-monospace, monospace';
function syncThemeColors() { try { const cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(k).trim(); C.dim = v('--dim') || C.dim; C.grid = v('--panel3') || C.grid; C.line = v('--line2') || C.line; C.bg = v('--bg') || C.bg; C.panel = v('--panel') || C.panel; } catch (e) {} }

/* --------------------------------------------------------------- réglages de collecte */
const CFG_DEFAULTS = {
  recordTrades: true, fetchMeta: true, snapshots: true, snapSec: 4,
  watchSec: 600, maxWatched: 300, gradVSol: 115,
  feedRows: 80, toastTrades: true, toastConn: true,
};
const CFG_SECTIONS = [
  { id: 'collect', title: 'Collecte', fields: [
    ['watchSec', 'Durée de suivi d\'un token', 'num', 'Après, on se désabonne de ses trades', 's'],
    ['maxWatched', 'Tokens suivis en même temps', 'num', 'Limite la charge et le coût éventuel', ''],
    ['recordTrades', 'Enregistrer les trades bruts', 'bool', 'Utile pour le backtest, prend de la place'],
    ['fetchMeta', 'Lire les métadonnées', 'bool', 'Image et réseaux sociaux du token'],
    ['gradVSol', 'SOL virtuel à la migration', 'num', 'Pour estimer la progression de la courbe', 'SOL'],
    ['snapshots', 'Instantanés DexScreener', 'bool', 'Prix, achats, ventes et volume lus à intervalle régulier quand PumpPortal ne transmet pas les trades (gratuit)'],
    ['snapSec', 'Intervalle des instantanés', 'num', 'Entre 2 et 30 secondes', 's'],
  ]},
  { id: 'ui', title: 'Affichage et alertes', fields: [
    ['feedRows', 'Lignes affichées dans le flux', 'num', 'Plus = plus lourd', ''],
    ['toastTrades', 'Notifier les entrées et sorties', 'bool', ''],
    ['toastConn', 'Notifier la connexion', 'bool', ''],
  ]},
];
let cfg = loadCfg();
function loadCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem('pstudio_pb_cfg') || 'null') || {}; } catch (e) {}
  return Object.assign({}, CFG_DEFAULTS, c);
}
function saveCfg() { try { localStorage.setItem('pstudio_pb_cfg', JSON.stringify(cfg)); } catch (e) {} }

/* --------------------------------------------------------------- stratégies */
const FLASH_SECTIONS = [
  { id: 'f_targets', title: 'Cibles', fields: [
    ['flashLaunch', 'Jouer les nouveaux lancements', 'bool', 'Achat dès la création du token'],
    ['flashMig', 'Jouer les migrations', 'bool', 'Achat dès l\'annonce de la migration'],
    ['phaseSec', 'Durée de la 1re phase', 'num', 'Après, la cible baisse', 's'],
    ['lTp1', 'Lancement : objectif 1re phase', 'num', 'Vente totale', '%'],
    ['lTp2', 'Lancement : objectif après la 1re phase', 'num', '', '%'],
    ['mTp1', 'Migration : objectif 1re phase', 'num', '', '%'],
    ['mTp2', 'Migration : objectif après la 1re phase', 'num', '', '%'],
    ['exitFlat', 'Vendre après la 1re phase si pas de hausse', 'bool', 'Si le prix est sous le prix d\'entrée'],
  ]},
  { id: 'f_risk', title: 'Protection', fields: [
    ['lSl', 'Lancement : stop loss', 'num', 'À tout moment', '%'],
    ['mSl', 'Migration : stop loss', 'num', '', '%'],
    ['maxHoldSec', 'Vente forcée après', 'num', 'Durée maximale d\'une position', 's'],
  ]},
  { id: 'f_filters', title: 'Filtres rapides', fields: [
    ['launchWindowSec', 'Lancement : entrer au plus tard', 'num', 'Après la création', 's'],
    ['migWindowSec', 'Migration : entrer au plus tard', 'num', 'Après la migration (attend le premier prix)', 's'],
    ['maxDevBuySol', 'Dev buy maximum', 'num', 'Achat du créateur au lancement', 'SOL'],
    ['serialMax', 'Rejet si le dev a lancé au moins', 'num', 'Tokens vus pendant la session', 'tok.'],
    ['requireName', 'Exiger un nom et un symbole', 'bool', ''],
    ['requireSocials', 'Réseaux sociaux obligatoires', 'bool', 'X, Telegram ou site web dans les métadonnées du token'],
    ['maxPerMin', 'Entrées maximum par minute', 'num', 'Évite d\'acheter tout le flux', ''],
  ]},
  { id: 'f_money', title: 'Capital', fields: [
    ['startBal', 'Solde de départ', 'num', '', 'SOL'],
    ['sizeSol', 'Mise par trade', 'num', '', 'SOL'],
    ['maxPositions', 'Positions simultanées', 'num', '', ''],
    ['feePct', 'Frais par transaction', 'num', 'pump.fun + réseau', '%'],
    ['slipPct', 'Slippage simulé', 'num', 'Pénalité d\'entrée et de sortie (on arrive après les snipers)', '%'],
  ]},
];
const STRAT_SECTIONS = [
  { id: 'entry', title: 'Fenêtre d\'entrée', fields: [
    ['minAgeSec', 'Âge minimum avant d\'entrer', 'num', 'Laisse passer les snipers', 's'],
    ['maxEntryAgeSec', 'Âge maximum pour entrer', 'num', '', 's'],
    ['minEntryMc', 'Market cap minimum', 'num', '', 'SOL'],
    ['maxEntryMc', 'Market cap maximum', 'num', '', 'SOL'],
    ['onlyMigrated', 'Seulement les tokens migrés', 'bool', 'Joue l\'après-migration : l\'âge compte depuis la migration'],
  ]},
  { id: 'filters', title: 'Filtres anti-rug', fields: [
    ['maxDevBuySol', 'Dev buy maximum', 'num', 'Achat du dev au lancement', 'SOL'],
    ['maxDevPct', 'Part du dev maximum', 'num', '', '%'],
    ['maxTop10', 'Top 10 holders maximum', 'num', 'Courbe de liquidité exclue', '%'],
    ['maxBundlePct', 'Bundle maximum', 'num', 'Supply achetée dans les 2 premières secondes', '%'],
    ['maxSnipers', 'Snipers maximum', 'num', 'Acheteurs des 3 premières secondes', ''],
    ['serialMax', 'Rejet si le dev a lancé au moins', 'num', 'Tokens vus depuis le début de la collecte', 'tok.'],
    ['rejectDevSell', 'Rejeter si le dev vend', 'bool', ''],
    ['requireSocials', 'Exiger des réseaux sociaux', 'bool', 'X, Telegram ou site dans les métadonnées'],
  ]},
  { id: 'score', title: 'Score de momentum', fields: [
    ['targetBuyers', 'Acheteurs uniques visés', 'num', 'Donne le maximum de points', ''],
    ['targetVolSol', 'Volume d\'achat visé', 'num', '', 'SOL'],
    ['scoreMin', 'Score minimum pour entrer', 'num', 'Sur 100', 'pts'],
  ]},
  { id: 'money', title: 'Capital', fields: [
    ['startBal', 'Solde de départ', 'num', '', 'SOL'],
    ['sizeSol', 'Mise par trade', 'num', '', 'SOL'],
    ['maxPositions', 'Positions simultanées', 'num', '', ''],
    ['feePct', 'Frais par transaction', 'num', 'pump.fun + réseau', '%'],
    ['slipPct', 'Slippage simulé', 'num', 'À l\'achat et à la vente', '%'],
  ]},
  { id: 'exits', title: 'Sorties', fields: [
    ['slPct', 'Stop loss', 'num', '', '%'],
    ['tp1Pct', 'Take profit 1', 'num', '', '%'],
    ['tp1Frac', 'Part vendue au TP1', 'num', '', '%'],
    ['trailPct', 'Trailing stop', 'num', 'Depuis le plus haut atteint', '%'],
    ['trailAlways', 'Trailing dès l\'entrée', 'bool', 'Sinon seulement après le TP1'],
    ['maxHoldSec', 'Durée maximale', 'num', '', 's'],
    ['exitOnDevSell', 'Sortir si le dev vend', 'bool', ''],
  ]},
];
const PRESETS = {
  equilibree: { onlyMigrated: false, minAgeSec: 20, maxEntryAgeSec: 180, minEntryMc: 30, maxEntryMc: 200, maxDevBuySol: 2, maxDevPct: 10, maxTop10: 35, maxBundlePct: 20, maxSnipers: 15, serialMax: 3, rejectDevSell: true, requireSocials: false,
    targetBuyers: 25, targetVolSol: 15, scoreMin: 65, startBal: 5, sizeSol: 0.1, maxPositions: 3, feePct: 1, slipPct: 3,
    slPct: 25, tp1Pct: 50, tp1Frac: 50, trailPct: 20, trailAlways: false, maxHoldSec: 600, exitOnDevSell: true },
  flash: { mode: 'flash', flashLaunch: true, flashMig: true, phaseSec: 60, lTp1: 100, lTp2: 50, mTp1: 50, mTp2: 25, exitFlat: true,
    lSl: 30, mSl: 20, maxHoldSec: 180, launchWindowSec: 20, migWindowSec: 60, maxDevBuySol: 2, serialMax: 2, requireName: true, requireSocials: true, maxPerMin: 6,
    startBal: 5, sizeSol: 0.1, maxPositions: 5, feePct: 1, slipPct: 5,
    targetBuyers: 25, targetVolSol: 15, scoreMin: 50, maxTop10: 100, maxDevPct: 100, maxSnipers: 1000, maxBundlePct: 100, slPct: 30, tp1Pct: 100 },
  migration: { onlyMigrated: true, minAgeSec: 45, maxEntryAgeSec: 900, minEntryMc: 300, maxEntryMc: 4000, maxDevBuySol: 5, maxDevPct: 20, maxTop10: 60, maxBundlePct: 40, maxSnipers: 40, serialMax: 5, rejectDevSell: true, requireSocials: true,
    targetBuyers: 150, targetVolSol: 150, scoreMin: 60, startBal: 5, sizeSol: 0.1, maxPositions: 3, feePct: 1, slipPct: 2,
    slPct: 15, tp1Pct: 30, tp1Frac: 50, trailPct: 12, trailAlways: true, maxHoldSec: 1800, exitOnDevSell: true },
};
const PRESET_NAMES = { equilibree: 'Équilibrée', migration: 'Migration', flash: 'Flash' };
const STRAT_DEFAULTS = [
  { id: 'equilibree', name: 'Équilibrée', color: C.green, enabled: true, P: Object.assign({}, PRESETS.equilibree) },
  { id: 'migration', name: 'Migration', color: C.violet, enabled: true, P: Object.assign({}, PRESETS.migration) },
  { id: 'flash', name: 'Flash', color: C.amber, enabled: true, P: Object.assign({}, PRESETS.flash) },
];
let STRATS = loadStrats();
function loadStrats() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('pstudio_pb_strats') || 'null'); } catch (e) {}
  return STRAT_DEFAULTS.map((d) => {
    const s = saved && saved.find((x) => x.id === d.id);
    return { id: d.id, color: d.color, name: (s && s.name) || d.name, enabled: s ? s.enabled !== false : true, P: Object.assign({}, d.P, s ? s.P : {}) };
  });
}
function saveStrats() { try { localStorage.setItem('pstudio_pb_strats', JSON.stringify(STRATS.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, P: s.P })))); } catch (e) {} try { window.dispatchEvent(new CustomEvent('pstudio-bot')); } catch (e) {} }
const stratById = (id) => STRATS.find((s) => s.id === id);
const isFlash = (s) => s && s.P.mode === 'flash';
const secsOf = (s) => isFlash(s) ? FLASH_SECTIONS : STRAT_SECTIONS;

/* --------------------------------------------------------------- état global */
const S = {
  tokens: new Map(), devStats: new Map(),
  port: {},                                  // id stratégie -> { positions: Map, closed: [] }
  createTimes: [], tradeTimes: [],
  tradeEvents: 0, totalTokens: 0, totalTrades: 0, migrations: 0,
  connected: false, wantConn: false, connAt: 0, lastServerMsg: '', ppState: 'off',
  demo: false, demoTimers: [],
  page: 'live', view: 'equilibree', selected: null, feedFilter: 'all', search: '',
  jStrat: 'all', jReason: 'all',
  dirty: { feed: true, header: true, pos: true, journal: true, strat: true, detail: true },
  perf: { ms: 0, n: 0, msWin: 0, nWin: 0, lastWin: 0, render: 0 },
};
STRATS.forEach((s) => { S.port[s.id] = { positions: new Map(), closed: [] }; });
try { const v = localStorage.getItem('pstudio_pb_view'); if (v && stratById(v)) S.view = v; } catch (e) {}
const persist = () => !S.demo;
function markAll() { for (const k in S.dirty) S.dirty[k] = true; }
const visible = () => ROOT.classList.contains('active') && !document.hidden;

/* --------------------------------------------------------------- utilitaires */
const $ = (id) => document.getElementById('pb-' + id);
const num = (v) => (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (a) => a ? a.slice(0, 4) + '…' + a.slice(-4) : '—';
const fx = (x, d) => x == null || !isFinite(x) ? '—' : (+x).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const f1 = (x) => fx(x, 1), f2 = (x) => fx(x, 2), f3 = (x) => fx(x, 3);
const sgn = (x) => (x > 0 ? '+' : '');
const pct = (x) => x == null || !isFinite(x) ? '—' : sgn(x) + fx(x, 1) + ' %';
const cls = (x) => x > 0 ? 'pos' : x < 0 ? 'neg' : '';
const sol = (x) => x == null || !isFinite(x) ? '—' : sgn(x) + f3(x) + ' SOL';
function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0');
  return Math.floor(s / 3600) + ' h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0');
}
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function safeUrl(u) {
  if (!u || typeof u !== 'string') return '';
  u = u.trim();
  if (u.startsWith('ipfs://')) u = 'https://ipfs.io/ipfs/' + u.slice(7);
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch (e) { return ''; }
}
function socialUrl(v, kind) {
  if (!v || typeof v !== 'string') return '';
  v = v.trim();
  if (/^https?:\/\//i.test(v)) return safeUrl(v);
  if (kind === 'twitter') return safeUrl('https://x.com/' + v.replace(/^@/, ''));
  if (kind === 'telegram') return safeUrl('https://t.me/' + v.replace(/^@/, ''));
  return safeUrl('https://' + v);
}
function initials(t) { return esc((t.symbol || t.name || '?').slice(0, 2).toUpperCase()); }
function avatar(t, lg) {
  const img = t.meta && t.meta.image;
  return '<div class="av' + (lg ? ' lg' : '') + '">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-rm-on-error="1">' : initials(t)) + '</div>';
}
function ring(score, color, size) {
  size = size || 38; const r = size / 2 - 3, c = 2 * Math.PI * r, v = clamp(score, 0, 100) / 100;
  return '<span class="ring" style="width:' + size + 'px;height:' + size + 'px" title="Score ' + score + ' / 100"><svg width="' + size + '" height="' + size + '">' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke="' + C.line + '" stroke-width="4" fill="none"/>' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke="' + color + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="' + (c * v).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><span>' + score + '</span></span>';
}
const toast = (title, text, kind) => PS.toast(title, text ? ' ' + text : '', kind);
const confirmBox = (title, text, ok, danger) => PS.confirm(title, text, ok, danger);

/* --------------------------------------------------------------- IndexedDB */
const IDB = {
  db: null, q: { tokens: [], trades: [], closed: [] },
  open() {
    return new Promise((res) => {
      if (!window.indexedDB) return res();
      let r; try { r = indexedDB.open('pstudio_pumpbot', 1); } catch (e) { return res(); }
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('tokens')) d.createObjectStore('tokens', { keyPath: 'mint' });
        if (!d.objectStoreNames.contains('trades')) d.createObjectStore('trades', { autoIncrement: true });
        if (!d.objectStoreNames.contains('closed')) d.createObjectStore('closed', { keyPath: 'id' });
      };
      r.onsuccess = () => { IDB.db = r.result; res(); };
      r.onerror = () => res();
    });
  },
  put(store, v) { if (this.db && persist()) this.q[store].push(v); },
  pending() { return this.q.tokens.length + this.q.trades.length + this.q.closed.length; },
  flush() {
    if (!this.db) return;
    const stores = Object.keys(this.q).filter((k) => this.q[k].length);
    if (!stores.length) return;
    try {
      const tx = this.db.transaction(stores, 'readwrite');
      for (const k of stores) { const os = tx.objectStore(k); for (const v of this.q[k]) os.put(v); this.q[k] = []; }
    } catch (e) { console.warn('IDB', e); }
  },
  all(store) {
    return new Promise((res) => {
      if (!this.db) return res([]);
      const r = this.db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => res([]);
    });
  },
  count(store) {
    return new Promise((res) => {
      if (!this.db) return res(0);
      const r = this.db.transaction(store).objectStore(store).count();
      r.onsuccess = () => res(r.result || 0); r.onerror = () => res(0);
    });
  },
  each(store, fn) {
    return new Promise((res) => {
      if (!this.db) return res();
      const r = this.db.transaction(store).objectStore(store).openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { fn(c.value); c.continue(); } else res(); };
      r.onerror = () => res();
    });
  },
  clear() {
    return new Promise((res) => {
      if (!this.db) return res();
      const tx = this.db.transaction(['tokens', 'trades', 'closed'], 'readwrite');
      ['tokens', 'trades', 'closed'].forEach((k) => tx.objectStore(k).clear());
      tx.oncomplete = () => res(); tx.onerror = () => res();
    });
  },
};

/* --------------------------------------------------------------- connexion : passe par le flux PumpPortal unique du studio */
function setConn(state, txt) {
  $('connDot').className = 'dot ' + state;
  $('connTxt').textContent = txt;
  $('btnConn').querySelector('span').textContent = S.wantConn ? 'Déconnecter' : 'Connecter';
  $('btnConn').classList.toggle('primary', !S.wantConn);
}
function watchedKeys() { const out = []; for (const t of S.tokens.values()) if (t.watching) out.push(t.mint); return out; }
function syncKeys() { if (!S.demo && S.wantConn) PS.pp.setKeys(watchedKeys()); }
function connect() {
  if (S.demo) stopDemo(true);
  S.wantConn = true; S.connAt = Date.now(); S.tradeEvents0 = S.tradeEvents;
  PS.pp.connect(true); syncKeys();
  onPPState(PS.pp.state());
  S.dirty.header = true;
}
function disconnect() {
  if (!S.wantConn) return;
  S.wantConn = false; S.connected = false;
  PS.pp.connect(false);
  if (!S.demo) setConn('', 'Déconnecté');
}
function onPPState(st) {
  const was = S.connected;
  S.ppState = st;
  if (!S.wantConn || S.demo) return;
  S.connected = st === 'on';
  if (st === 'on') {
    setConn('on', 'Connecté — flux en direct');
    if (!was) { S.connAt = Date.now(); syncKeys(); if (cfg.toastConn) toast('Terminal connecté', 'Lancements, trades et migrations pump.fun en direct.', 'g'); }
  } else if (st === 'connecting') setConn('wait', 'Connexion…');
  else if (st === 'error') { setConn('wait', 'Coupé — reconnexion automatique'); if (was && cfg.toastConn) toast('Connexion interrompue', 'Reconnexion automatique en cours.', 'a'); }
  else setConn('wait', 'En attente du flux');
  S.dirty.header = true;
}
PS.pp.onState(onPPState);
PS.pp.onMsg((m) => { if (S.wantConn && !S.demo) handleMsg(m, Date.now()); });

/* --------------------------------------------------------------- messages */
function classify(m) {
  if (m.message || m.errors) return 'info';
  if (m.txType === 'create') return 'create';
  if (m.txType === 'buy' || m.txType === 'sell') return 'trade';
  if (m.txType === 'migrate' || (m.mint && m.pool && !m.txType)) return 'migration';
  return 'unknown';
}
function handleMsg(m, now) {
  const t0 = performance.now();
  const k = classify(m);
  if (k === 'create' && m.mint) onCreate(m, now);
  else if (k === 'trade' && m.mint) onTrade(m, now);
  else if (k === 'migration' && m.mint) onMigration(m);
  else if (k === 'info') {
    const txt = String(m.errors || m.message || '').slice(0, 160);
    if (txt) { S.lastServerMsg = txt; if (m.errors) { setConn('wait', 'PumpPortal : ' + txt); toast('Message de PumpPortal', txt, 'r'); } }
  }
  const dt = performance.now() - t0;
  S.perf.ms += dt; S.perf.n++; S.perf.msWin += dt; S.perf.nWin++;
}

function devStat(c) {
  let d = S.devStats.get(c);
  if (!d) { d = { n: 0, migrated: 0, fastSell: 0 }; S.devStats.set(c, d); }
  return d;
}
const canTrack = () => S.demo || S.wantConn;
let keysTimer = 0;
function keysLater() { if (S.demo || keysTimer) return; keysTimer = setTimeout(() => { keysTimer = 0; syncKeys(); }, 150); }
function onCreate(m, now, fromMig) {
  if (S.tokens.has(m.mint)) return;
  const mc = num(m.marketCapSol) || 0;
  const t = {
    mint: m.mint, name: String(m.name || ''), symbol: String(m.symbol || ''), uri: String(m.uri || ''),
    creator: m.traderPublicKey || '', createdAt: now,
    devBuySol: num(m.solAmount) || 0, devTokens: num(m.initialBuy) || 0,
    mc0: mc, mc, mcMax: mc, vSol: num(m.vSolInBondingCurve), trades: [],
    buys: 0, sells: 0, buyers: new Set(), firstBuy: new Map(), volBuy: 0, volSell: 0,
    balances: new Map(), devSold: false, devSoldAt: 0, snipers: new Set(), bundleTok: 0,
    top10: 0, devPct: 0, bundlePct: 0, rec30: 0, prev30: 0,
    meta: { state: 'none' }, track: 'ok', watching: false, watchEnd: 0, migrated: false,
    st: {}, ver: 1, rv: 0, lastMcShown: mc, isNew: true, src: 'none', hist: [], lastTrade: 0, fromMigration: !!fromMig, migratedAt: 0, lastPx: mc ? now : 0,
  };
  if (t.creator) { t.balances.set(t.creator, t.devTokens); devStat(t.creator).n++; }
  S.tokens.set(t.mint, t);
  if (!fromMig) { S.totalTokens++; S.createTimes.push(now); }

  if (canTrack()) {
    if (countWatched() < cfg.maxWatched) { t.watching = true; t.watchEnd = now + cfg.watchSec * 1000; keysLater(); }
    else t.track = 'skipped';
  } else t.track = 'nodata';

  if (t.track === 'ok' && cfg.fetchMeta && !S.demo) queueMeta(t);
  updateMetrics(t, now);
  STRATS.forEach((s) => evaluate(t, s, now));
  IDB.put('tokens', tokenRecord(t));
  S.dirty.feed = S.dirty.header = true;
}
function onTrade(m, now) {
  S.tradeEvents++;
  const t = S.tokens.get(m.mint);
  if (!t) return;
  if (t.src === 'snap') { t.buys = t.sells = 0; t.volBuy = t.volSell = 0; t.hist = []; }
  t.src = 'trades'; t.lastTrade = now; S.lastTradeAt = now; t.lastPx = now;
  const side = m.txType, amount = num(m.solAmount) || 0, tok = num(m.tokenAmount) || 0, who = m.traderPublicKey || '';
  const age = now - t.createdAt;
  if (side === 'buy') {
    t.buys++; t.volBuy += amount;
    if (!t.buyers.has(who)) { t.buyers.add(who); t.firstBuy.set(who, now); if (age <= SNIPE_WINDOW && who !== t.creator) t.snipers.add(who); }
    if (age <= BUNDLE_WINDOW && who !== t.creator) t.bundleTok += tok;
  } else { t.sells++; t.volSell += amount; }
  if (who && who === t.creator && side === 'sell' && !t.devSold) {
    t.devSold = true; t.devSoldAt = now;
    if (age <= FAST_SELL_SEC * 1000) { devStat(t.creator).fastSell++; t.devSoldFast = true; }
  }
  const nb = num(m.newTokenBalance);
  if (nb != null) t.balances.set(who, nb);
  else t.balances.set(who, Math.max(0, (t.balances.get(who) || 0) + (side === 'buy' ? tok : -tok)));
  const mc = num(m.marketCapSol);
  if (mc) { t.mc = mc; if (mc > t.mcMax) t.mcMax = mc; }
  const vs = num(m.vSolInBondingCurve); if (vs) t.vSol = vs;
  t.trades.push([now, t.mc, side === 'buy' ? 1 : -1, amount]);
  if (t.trades.length > 2500) t.trades.splice(0, t.trades.length - 2500);
  S.totalTrades++; S.tradeTimes.push(now);
  if (cfg.recordTrades) IDB.put('trades', { mint: t.mint, ts: now, trader: who, side, sol: amount, amt: tok, mc: t.mc, sig: m.signature || '' });
  updateMetrics(t, now);
  STRATS.forEach((s) => { evaluate(t, s, now); onPrice(t, s, now); });
  t.ver++;
  S.dirty.feed = true;
  if (S.selected === t.mint) S.dirty.detail = true;
}
function onMigration(m) {
  S.migrations++;
  const now = Date.now();
  if (!S.tokens.has(m.mint)) onCreate({ mint: m.mint, txType: 'create' }, now, true);
  const t = S.tokens.get(m.mint);
  if (t) markMigrated(t, now);
}
// Token migré : on le (re)suit pour les stratégies d'après-migration
function markMigrated(t, now) {
  if (t.migrated) return;
  t.migrated = true; t.migratedAt = now;
  if (t.creator) devStat(t.creator).migrated++;
  if (canTrack() && (t.watching || countWatched() < cfg.maxWatched)) { t.watching = true; t.track = 'ok'; t.watchEnd = Math.max(t.watchEnd, now + cfg.watchSec * 1000); keysLater(); }
  for (const s of STRATS) if (s.P.onlyMigrated || (isFlash(s) && s.P.flashMig)) { const st = stOf(t, s.id); if (st.status === 'expired' || st.status === 'late' || st.status === 'skipped') { st.status = 'watch'; st.reason = ''; } }
  t.ver++; IDB.put('tokens', tokenRecord(t)); S.dirty.feed = true;
}

/* --------------------------------------------------------------- instantanés DexScreener : quand PumpPortal ne transmet pas les trades
   Lecture groupée (30 tokens par requête) du prix, des achats, des ventes et du volume. Gratuit, sans clé. */
const SNAP = { busy: false, last: 0, ok: 0, err: 0, at: 0, n: 0 };
const isSnap = (t) => t.src === 'snap';
const uniq = (t) => isSnap(t) ? t.buys : t.buyers.size;
const WSOL = 'So11111111111111111111111111111111111111112';
const solQuoted = (p) => !!(p.quoteToken && p.quoteToken.address === WSOL);
const pairRank = (p) => (solQuoted(p) ? 1e16 : 0) + (p.dexId === 'pumpswap' ? 1e15 : p.dexId === 'pumpfun' ? 1e14 : 0) + ((p.liquidity && +p.liquidity.usd) || 0) + ((p.volume && +p.volume.h24) || 0) / 1e6;
async function snapPoll() {
  if (SNAP.busy || S.demo || !S.wantConn || !cfg.snapshots) return;
  const now = Date.now();
  if (now - SNAP.last < clamp(cfg.snapSec || 4, 2, 30) * 1000) return;
  SNAP.last = now;
  const held = new Set(allPositions().map((p) => p.mint)), list = [];
  for (const t of S.tokens.values()) {
    if (!t.watching && !held.has(t.mint)) continue;
    if (t.lastTrade && now - t.lastTrade < 20000) continue;          // les trades en direct passent avant
    if (!t.fromMigration && now - t.createdAt < 6000) continue;      // pas encore indexé
    list.push(t);
  }
  if (!list.length) return;
  list.sort((a, b) => (held.has(b.mint) - held.has(a.mint)) || ((a.snapAt || 0) - (b.snapAt || 0)));
  const pick = list.slice(0, 180), batches = [];
  for (let i = 0; i < pick.length; i += 30) batches.push(pick.slice(i, i + 30));
  SNAP.busy = true;
  try {
    await Promise.all(batches.map(async (bt) => {
      const ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(() => ctl && ctl.abort(), 8000);
      try {
        const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + bt.map((t) => t.mint).join(','), ctl ? { signal: ctl.signal } : {});
        if (!r.ok) throw new Error(r.status);
        const arr = await r.json(), by = new Map(), ts = Date.now();
        SNAP.ok++; SNAP.at = ts;
        (Array.isArray(arr) ? arr : []).forEach((p) => { const m = p && p.baseToken && p.baseToken.address; if (!m) return; const cur = by.get(m); if (!cur || pairRank(p) > pairRank(cur)) by.set(m, p); });
        bt.forEach((t) => { t.snapAt = ts; const p = by.get(t.mint); if (p && S.tokens.get(t.mint) === t) applySnap(t, p, ts); });
      } catch (e) { SNAP.err++; } finally { clearTimeout(timer); }
    }));
  } finally { SNAP.busy = false; S.dirty.header = true; }
}
function applySnap(t, p, now) {
  // priceNative est exprimé dans le jeton de cotation de la paire : on ne l'utilise que si c'est du SOL
  const pn = num(p.priceNative), pu = num(p.priceUsd), sq = solQuoted(p), su = (PS.S && PS.S.solUsd) || (sq && pu && pn ? pu / pn : 0);
  const mc = sq && pn > 0 ? pn * SUPPLY : pu > 0 && su ? pu * SUPPLY / su : 0;
  if (!(mc > 0)) { SNAP.bad = (SNAP.bad || 0) + 1; return; }
  // garde-fous : sur la courbe pump.fun le MC reste entre ~28 et ~420 SOL ; un saut énorme doit être confirmé
  if (p.dexId === 'pumpfun' && (mc < 20 || mc > 500)) { SNAP.bad = (SNAP.bad || 0) + 1; return; }
  if (t.mc > 0 && (mc > t.mc * 15 || mc < t.mc / 15)) {
    if (!t.jump || Math.abs(t.jump / mc - 1) > 0.3) { t.jump = mc; SNAP.bad = (SNAP.bad || 0) + 1; return; }
  }
  t.jump = 0;
  const solUsd = su;
  const h1 = (p.txns && p.txns.h1) || {}, b = +h1.buys || 0, sl = +h1.sells || 0, tot = b + sl;
  const volSol = solUsd ? ((p.volume && +p.volume.h1) || 0) / solUsd : 0;
  if (t.src !== 'snap') { t.src = 'snap'; t.buys = 0; t.sells = 0; t.hist = []; if (t.fromMigration) t.mc0 = mc; }
  SNAP.n++;
  const db = Math.max(0, b - t.buys), ds = Math.max(0, sl - t.sells), prevMc = t.mc;
  t.buys = Math.max(t.buys, b); t.sells = Math.max(t.sells, sl);
  t.volBuy = tot ? volSol * b / tot : 0; t.volSell = tot ? volSol * sl / tot : 0;
  t.mc = mc; t.lastPx = now; if (mc > t.mcMax) t.mcMax = mc; if (!t.mc0) t.mc0 = mc;
  if (!t.migrated) { t.vSol = Math.sqrt(mc * 32.19); if (p.dexId === 'pumpswap') markMigrated(t, now); }
  t.hist.push([now, t.buys]); if (t.hist.length > 60) t.hist.shift();
  if (db || ds || mc !== prevMc) { t.trades.push([now, mc, db >= ds ? 1 : -1, tot ? (db + ds) * volSol / tot : 0]); if (t.trades.length > 2500) t.trades.shift(); }
  if (!t.symbol && p.baseToken) { t.symbol = String(p.baseToken.symbol || ''); t.name = String(p.baseToken.name || ''); }
  const inf = p.info || {}, so = (k) => { const x = (inf.socials || []).find((y) => y && y.type === k); return x ? socialUrl(x.url, k) : ''; };
  if (!hasSocials(t) && (inf.socials || inf.websites)) {
    const w = (inf.websites || [])[0];
    t.meta = Object.assign({}, t.meta, { state: 'ok', twitter: so('twitter'), telegram: so('telegram'), website: w ? socialUrl(w.url, 'web') : '' });
  }
  if (!(t.meta && t.meta.image) && inf.imageUrl) t.meta = Object.assign({}, t.meta, { state: t.meta.state === 'ok' ? 'ok' : t.meta.state, image: safeUrl(inf.imageUrl) });
  updateMetrics(t, now);
  STRATS.forEach((s) => { evaluate(t, s, now); onPrice(t, s, now); });
  t.ver++; S.dirty.feed = true;
  if (S.selected === t.mint) S.dirty.detail = true;
}
function countWatched() { let n = 0; for (const t of S.tokens.values()) if (t.watching) n++; return n; }

/* --------------------------------------------------------------- métadonnées (image + réseaux) */
const metaQ = []; let metaBusy = 0;
function queueMeta(t) {
  const u = safeUrl(t.uri);
  if (!u) { t.meta = { state: 'none' }; return; }
  t.meta = { state: 'queued' };
  metaQ.push(t.mint);
  if (metaQ.length > 150) { const drop = metaQ.shift(); const d = S.tokens.get(drop); if (d) d.meta = { state: 'skip' }; }
  pumpMeta();
}
function pumpMeta() {
  while (metaBusy < 3 && metaQ.length) {
    const t = S.tokens.get(metaQ.shift());
    if (!t) continue;
    metaBusy++;
    t.meta = { state: 'loading' };
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 7000);
    fetch(safeUrl(t.uri), ctl ? { signal: ctl.signal } : {})
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => {
        t.meta = { state: 'ok', image: safeUrl(j.image), twitter: socialUrl(j.twitter, 'twitter'), telegram: socialUrl(j.telegram, 'telegram'),
          website: socialUrl(j.website, 'web'), desc: String(j.description || '').slice(0, 280) };
      })
      .catch(() => { t.meta = { state: 'err' }; })
      .finally(() => { clearTimeout(timer); metaBusy--; t.ver++; S.dirty.feed = true; if (S.selected === t.mint) S.dirty.detail = true; pumpMeta(); });
  }
}
const hasSocials = (t) => !!(t.meta && (t.meta.twitter || t.meta.telegram || t.meta.website));

/* --------------------------------------------------------------- métriques partagées */
function updateMetrics(t, now) {
  let top = 0;
  if (t.balances.size <= 10) { for (const v of t.balances.values()) if (v > 0) top += v; }
  else { const vals = [...t.balances.values()].filter((v) => v > 0).sort((a, b) => b - a); for (let i = 0; i < 10 && i < vals.length; i++) top += vals[i]; }
  t.top10 = top / SUPPLY * 100;
  t.devPct = (t.balances.get(t.creator) || 0) / SUPPLY * 100;
  t.bundlePct = t.bundleTok / SUPPLY * 100;
  let r = 0, p = 0;
  for (const ts of t.firstBuy.values()) { const a = now - ts; if (a <= 30000) r++; else if (a <= 60000) p++; }
  t.rec30 = r; t.prev30 = p;
  if (isSnap(t)) {                    // activité tirée de l'historique des instantanés
    let a30 = null, a60 = null;
    for (const [ts, n] of t.hist) { if (now - ts >= 30000) a30 = n; if (now - ts >= 60000) a60 = n; }
    t.rec30 = a30 != null ? t.buys - a30 : t.hist.length ? t.buys - t.hist[0][1] : 0;
    t.prev30 = a30 != null && a60 != null ? a30 - a60 : 0;
  }
}
function topHolders(t) {
  return [...t.balances.entries()].filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([w, v]) => ({ w, pct: v / SUPPLY * 100, dev: w === t.creator }));
}
function bondingPct(t) {
  if (t.migrated) return 100;
  if (t.vSol == null) return null;
  return clamp((t.vSol - 30) / Math.max(1, cfg.gradVSol - 30) * 100, 0, 100);
}

/* --------------------------------------------------------------- score et décision, par stratégie */
function scoreParts(t, P) {
  const tot = t.buys + t.sells, ratio = tot ? t.buys / tot : 0;
  const growth = t.mc0 ? t.mc / t.mc0 - 1 : 0;
  const parts = {
    buyers: { l: isSnap(t) ? 'Achats (1 h)' : 'Acheteurs uniques', max: 25, v: Math.min(uniq(t) / Math.max(1, P.targetBuyers), 1) * 25 },
    activity: { l: 'Activité (30 s)', max: 15, v: Math.min(t.rec30 / Math.max(1, P.targetBuyers * 0.25), 1) * 15 },
    ratio: { l: 'Achats vs ventes', max: 15, v: clamp((ratio - 0.5) * 2, 0, 1) * 15 },
    growth: { l: 'Hausse du MC', max: 15, v: clamp(growth, 0, 1) * 15 },
    volume: { l: 'Volume d\'achat', max: 10, v: Math.min(t.volBuy / Math.max(0.01, P.targetVolSol), 1) * 10 },
    spread: isSnap(t) ? { l: 'Répartition (non mesurée)', max: 10, v: 5 } : { l: 'Répartition', max: 10, v: clamp(1 - t.top10 / Math.max(1, P.maxTop10), 0, 1) * 10 },
    quality: { l: 'Qualité', max: 10, v: (hasSocials(t) ? 5 : 0) + (isSnap(t) ? 2.5 : clamp(1 - t.snipers.size / Math.max(1, P.maxSnipers), 0, 1) * 5) },
  };
  let s = 0; for (const k in parts) s += parts[k].v;
  if (t.devSold) s *= 0.3;
  return { parts, score: Math.round(s) };
}
function stOf(t, sid) {
  let st = t.st[sid];
  if (!st) { st = t.st[sid] = { status: 'watch', reason: '', blockers: [], score: 0, scoreMax: 0, parts: null }; }
  return st;
}
function evaluate(t, s, now) {
  const st = stOf(t, s.id), P = s.P;
  if (t.track !== 'ok') { st.status = t.track; st.reason = t.track === 'nodata' ? 'Terminal déconnecté : trades non reçus' : 'Limite de tokens suivis atteinte'; return; }
  const sp = scoreParts(t, P); st.parts = sp.parts; st.score = sp.score; if (st.score > st.scoreMax) st.scoreMax = st.score;
  if (st.status !== 'watch' || !s.enabled) { if (!s.enabled && st.status === 'watch') st.blockers = ['Stratégie en pause']; return; }

  if (P.mode === 'flash') return evaluateFlash(t, s, st, now);
  if (P.onlyMigrated && !t.migrated) { st.blockers = ['Attend la migration']; return; }
  if (!P.onlyMigrated && t.fromMigration) { st.status = 'late'; st.reason = 'Déjà migré à son arrivée'; st.blockers = []; return; }
  const snap = isSnap(t), dev = S.devStats.get(t.creator);
  if (P.rejectDevSell && t.devSold) return reject(st, 'Le dev a vendu');
  if (dev && dev.n >= P.serialMax) return reject(st, 'Lanceur en série (' + dev.n + ' tokens)');
  if (t.devBuySol > P.maxDevBuySol) return reject(st, 'Dev buy trop gros (' + f2(t.devBuySol) + ' SOL)');
  if (!snap && t.bundlePct > P.maxBundlePct) return reject(st, 'Bundle détecté (' + f1(t.bundlePct) + ' % en 2 s)');

  const age = (now - (P.onlyMigrated ? t.migratedAt : t.createdAt)) / 1000, b = [];
  if (age > P.maxEntryAgeSec) { st.status = 'late'; st.reason = 'Fenêtre d\'entrée passée'; st.blockers = []; return; }
  if (age < P.minAgeSec) b.push('Trop jeune (' + Math.floor(age) + ' / ' + P.minAgeSec + ' s)');
  if (!snap && t.snipers.size > P.maxSnipers) b.push(t.snipers.size + ' snipers (max ' + P.maxSnipers + ')');
  if (t.devPct > P.maxDevPct) b.push('Dev détient ' + f1(t.devPct) + ' %');
  if (!snap && t.top10 > P.maxTop10) b.push('Top 10 à ' + f1(t.top10) + ' %');
  if (t.mc < P.minEntryMc) b.push('MC sous ' + P.minEntryMc + ' SOL');
  if (t.mc > P.maxEntryMc) b.push('MC au-dessus de ' + P.maxEntryMc + ' SOL');
  if (P.requireSocials && !hasSocials(t)) b.push(t.meta.state === 'ok' ? 'Aucun réseau social' : 'Réseaux sociaux inconnus');
  if (st.score < P.scoreMin) b.push('Score ' + st.score + ' < ' + P.scoreMin);
  const port = S.port[s.id];
  if (!b.length && port.positions.size >= P.maxPositions) b.push('Positions max atteintes');
  if (!b.length && balance(s) < P.sizeSol) b.push('Solde insuffisant');
  st.blockers = b;
  if (!b.length) openPosition(t, s, now);
}
// Flash : achat immédiat au lancement ou à la migration, après quelques filtres lisibles tout de suite
function evaluateFlash(t, s, st, now) {
  const P = s.P, mig = t.migrated && P.flashMig, launch = !t.migrated && !t.fromMigration && P.flashLaunch;
  if (!mig && !launch) { if (!t.migrated && P.flashMig && !P.flashLaunch) { st.blockers = ['Attend la migration']; return; } st.status = 'late'; st.reason = t.migrated ? 'Migrations désactivées' : 'Lancements désactivés'; st.blockers = []; return; }
  const age = (now - (mig ? t.migratedAt : t.createdAt)) / 1000, win = mig ? P.migWindowSec : P.launchWindowSec;
  if (age > win) { st.status = 'late'; st.reason = 'Fenêtre d\'achat passée (' + win + ' s)'; st.blockers = []; return; }
  const dev = S.devStats.get(t.creator);
  if (launch && t.devBuySol > P.maxDevBuySol) return reject(st, 'Dev buy trop gros (' + f2(t.devBuySol) + ' SOL)');
  if (launch && dev && dev.n >= P.serialMax) return reject(st, 'Lanceur en série (' + dev.n + ' tokens)');
  if (launch && P.requireName && (!t.symbol.trim() || !t.name.trim())) return reject(st, 'Nom ou symbole manquant');
  const b = [];
  if (P.requireSocials && !hasSocials(t)) {
    const ms = t.meta && t.meta.state;
    if (ms === 'ok') return reject(st, 'Aucun réseau social');
    if (ms === 'queued' || ms === 'loading') { st.blockers = ['Lecture des réseaux sociaux…']; return; }
    b.push(cfg.fetchMeta ? 'Réseaux sociaux inconnus' : 'Réseaux inconnus : lecture des métadonnées coupée');
  }
  if (!(t.mc > 0) || (mig && !(t.lastPx > t.migratedAt))) b.push('Attend le premier prix');
  const port = S.port[s.id];
  port.ent = (port.ent || []).filter((x) => now - x < 60000);
  if (port.positions.size >= P.maxPositions) b.push('Positions max atteintes');
  if (port.ent.length >= P.maxPerMin) b.push('Limite d\'entrées par minute');
  if (balance(s) < P.sizeSol) b.push('Solde insuffisant');
  st.blockers = b;
  if (b.length) return;
  port.ent.push(now);
  openPosition(t, s, now);
  const p = port.positions.get(t.mint);
  if (p) { p.kind = mig ? 'mig' : 'launch'; p.sl = mig ? P.mSl : P.lSl; p.tpA = mig ? P.mTp1 : P.lTp1; p.tpB = mig ? P.mTp2 : P.lTp2; st.reason = mig ? 'Acheté à la migration' : 'Acheté au lancement'; }
}
function flashCheck(p, s, t, now) {
  const P = s.P, mc = t.mc;
  if (mc > p.peak) p.peak = mc;
  const r = factor(p, P, mc) - 1, phase2 = (now - p.openedAt) / 1000 >= P.phaseSec, tp = phase2 ? p.tpB : p.tpA;
  if (r <= -p.sl / 100) return sell(p, s, p.remaining, mc, 'Stop loss', now);
  if (r >= tp / 100) return sell(p, s, p.remaining, mc, 'Objectif +' + tp + ' %', now);
  if (phase2 && P.exitFlat && mc <= p.entryMc) return sell(p, s, p.remaining, mc, t.lastPx > p.openedAt ? 'Pas de hausse après ' + P.phaseSec + ' s' : 'Prix non lu après ' + P.phaseSec + ' s', now);
}
function reject(st, why) { st.status = 'rejected'; st.reason = why; st.blockers = []; }

/* --------------------------------------------------------------- paper trading */
function openPosition(t, s, now) {
  const P = s.P, slip = P.slipPct / 100, fee = P.feePct / 100;
  const p = {
    id: s.id + ':' + t.mint + ':' + now, sid: s.id, mint: t.mint, symbol: t.symbol, name: t.name,
    openedAt: now, entryMc: t.mc, entryEff: t.mc * (1 + slip), size: P.sizeSol, invested: P.sizeSol * (1 - fee),
    remaining: 1, proceeds: 0, peak: t.mc, tp1Done: false, score: stOf(t, s.id).score, exits: [],
  };
  S.port[s.id].positions.set(t.mint, p);
  const st = stOf(t, s.id); st.status = 'entered'; st.reason = 'Entré à score ' + p.score; st.blockers = [];
  if (cfg.toastTrades) toast('Entrée · ' + s.name, (t.symbol || '?') + ' à ' + f1(t.mc) + ' SOL de MC, score ' + p.score, 'g');
  S.dirty.pos = S.dirty.header = S.dirty.strat = true;
}
function factor(p, P, mc) { return mc * (1 - P.slipPct / 100) / p.entryEff; }
function valueOf(p, P, mc, frac) { return p.invested * frac * factor(p, P, mc) * (1 - P.feePct / 100); }
function sell(p, s, frac, mc, why, now) {
  frac = Math.min(frac, p.remaining);
  if (frac <= 0) return;
  p.proceeds += valueOf(p, s.P, mc, frac);
  p.remaining -= frac;
  p.exits.push({ t: now, frac, mc, why });
  if (p.remaining <= 1e-9) closePosition(p, s, mc, why, now);
  S.dirty.pos = S.dirty.header = true;
}
function closePosition(p, s, mc, why, now) {
  S.port[s.id].positions.delete(p.mint);
  const rec = {
    id: p.id, sid: s.id, mint: p.mint, symbol: p.symbol, name: p.name, openedAt: p.openedAt, closedAt: now,
    size: p.size, proceeds: p.proceeds, pnl: p.proceeds - p.size, pnlPct: (p.proceeds / p.size - 1) * 100,
    entryMc: p.entryMc, exitMc: mc, peakMc: p.peak, why, score: p.score, exits: p.exits, demo: S.demo,
  };
  S.port[s.id].closed.push(rec);
  IDB.put('closed', rec);
  if (!S.demo) { try { window.dispatchEvent(new CustomEvent('pstudio-bot')); } catch (e) {} }
  const t = S.tokens.get(p.mint);
  if (t) { const st = stOf(t, s.id); st.status = 'closed'; st.reason = why + ' (' + pct(rec.pnlPct) + ')'; t.ver++; }
  if (cfg.toastTrades) toast('Sortie · ' + s.name, (p.symbol || '?') + ' · ' + why + ' · ' + pct(rec.pnlPct), rec.pnl > 0 ? 'g' : 'r');
  S.dirty.journal = S.dirty.strat = S.dirty.feed = true;
}
function onPrice(t, s, now) {
  const p = S.port[s.id].positions.get(t.mint);
  if (!p) return;
  if (p.kind) return flashCheck(p, s, t, now);
  const P = s.P, mc = t.mc;
  if (mc > p.peak) p.peak = mc;
  const r = factor(p, P, mc) - 1;
  if (P.exitOnDevSell && t.devSold) return sell(p, s, p.remaining, mc, 'Le dev a vendu', now);
  if (r <= -P.slPct / 100) return sell(p, s, p.remaining, mc, 'Stop loss', now);
  if (!p.tp1Done && r >= P.tp1Pct / 100) { p.tp1Done = true; sell(p, s, p.remaining * P.tp1Frac / 100, mc, 'Take profit 1', now); }
  if (p.remaining > 0 && (p.tp1Done || P.trailAlways) && mc <= p.peak * (1 - P.trailPct / 100)) sell(p, s, p.remaining, mc, 'Trailing stop', now);
}
function realized(s) { return S.port[s.id].closed.reduce((a, c) => a + c.pnl, 0); }
function balance(s) {
  let open = 0; for (const p of S.port[s.id].positions.values()) open += p.size - p.proceeds;
  return s.P.startBal + realized(s) - open;
}
function unrealized(p) {
  const t = S.tokens.get(p.mint), s = stratById(p.sid);
  return p.proceeds + (t && s ? valueOf(p, s.P, t.mc, p.remaining) : 0) - p.size;
}
function allPositions() { const out = []; STRATS.forEach((s) => S.port[s.id].positions.forEach((p) => out.push(p))); return out; }
function allClosed() { const out = []; STRATS.forEach((s) => out.push(...S.port[s.id].closed)); return out.sort((a, b) => a.closedAt - b.closedAt); }
function statsOf(list, startBal) {
  const n = list.length, w = list.filter((x) => x.pnl > 0), l = list.filter((x) => x.pnl <= 0);
  let bal = startBal, peak = startBal, dd = 0;
  for (const x of list) { bal += x.pnl; peak = Math.max(peak, bal); if (peak > 0) dd = Math.max(dd, (peak - bal) / peak * 100); }
  const sum = (a) => a.reduce((q, x) => q + x.pnl, 0);
  const pf = sum(l) < 0 ? sum(w) / -sum(l) : (w.length ? Infinity : null);
  return {
    n, wins: w.length, winrate: n ? w.length / n * 100 : null, pnl: sum(list),
    avgW: w.length ? w.reduce((a, x) => a + x.pnlPct, 0) / w.length : null,
    avgL: l.length ? l.reduce((a, x) => a + x.pnlPct, 0) / l.length : null,
    best: n ? Math.max(...list.map((x) => x.pnlPct)) : null, worst: n ? Math.min(...list.map((x) => x.pnlPct)) : null,
    dd, pf, avgHold: n ? list.reduce((a, x) => a + (x.closedAt - x.openedAt), 0) / n : null,
  };
}

/* --------------------------------------------------------------- boucle 1 s */
function tokenRecord(t) {
  const sts = {}; for (const k in t.st) sts[k] = t.st[k].status;
  return {
    mint: t.mint, name: t.name, symbol: t.symbol, creator: t.creator, createdAt: t.createdAt, uri: t.uri,
    devBuySol: t.devBuySol, mc0: t.mc0, mcMax: t.mcMax, mcLast: t.mc, buys: t.buys, sells: t.sells,
    uniqueBuyers: t.buyers.size, snipers: t.snipers.size, bundlePct: t.bundlePct, volBuy: t.volBuy, volSell: t.volSell,
    devSold: t.devSold, devSoldFast: !!t.devSoldFast, top10: t.top10, devPct: t.devPct, migrated: t.migrated,
    socials: hasSocials(t), statuses: JSON.stringify(sts),
  };
}
function tick() {
  const now = Date.now();
  snapPoll();
  for (const s of STRATS) {
    for (const p of [...S.port[s.id].positions.values()]) {
      const t = S.tokens.get(p.mint);
      if (t && (now - p.openedAt) / 1000 >= s.P.maxHoldSec) sell(p, s, p.remaining, t.mc, 'Durée max', now);
      else if (t && p.kind) flashCheck(p, s, t, now);
    }
  }
  let done = 0;
  for (const t of S.tokens.values()) {
    if (t.watching) {
      updateMetrics(t, now);
      for (const s of STRATS) if (stOf(t, s.id).status === 'watch') evaluate(t, s, now);
      if (now >= t.watchEnd && !STRATS.some((s) => S.port[s.id].positions.has(t.mint))) {
        t.watching = false; done++;
        for (const s of STRATS) { const st = stOf(t, s.id); if (st.status === 'watch' || st.status === 'late') { st.status = 'expired'; st.reason = 'Suivi terminé sans entrée'; } }
        t.trades = t.trades.length > 600 ? t.trades.slice(-600) : t.trades;
        IDB.put('tokens', tokenRecord(t));
      }
      t.ver++;
    }
  }
  if (done) syncKeys();
  if (S.tokens.size > 2500) {
    for (const [m, t] of S.tokens) {
      if (S.tokens.size <= 2000) break;
      if (!t.watching && !STRATS.some((s) => S.port[s.id].positions.has(m))) { S.tokens.delete(m); const r = feedRows.get(m); if (r) r.tr.remove(); feedRows.delete(m); if (S.selected === m) S.selected = null; }
    }
  }
  while (S.createTimes.length && now - S.createTimes[0] > 60000) S.createTimes.shift();
  while (S.tradeTimes.length && now - S.tradeTimes[0] > 60000) S.tradeTimes.shift();
  if (now - S.perf.lastWin > 10000) { S.perf.lastWinMs = S.perf.nWin ? S.perf.msWin / S.perf.nWin : 0; S.perf.lastWinN = S.perf.nWin; S.perf.msWin = 0; S.perf.nWin = 0; S.perf.lastWin = now; }
  IDB.flush();
  S.dirty.feed = S.dirty.header = S.dirty.pos = true;
  if (S.selected) S.dirty.detail = true;
}

/* =========================================================================
   RENDU
   ========================================================================= */
const STATUS = {
  watch: ['watch', 'Surveillé'], entered: ['entered', 'En position'], rejected: ['rejected', 'Rejeté'],
  closed: ['closed', 'Fermé'], expired: ['', 'Expiré'], late: ['', 'Trop tard'], nodata: ['', 'Sans trades'], skipped: ['', 'Non suivi'],
};
const viewStrat = () => stratById(S.view) || STRATS[0];
function scoreColor(score, P) { return score >= P.scoreMin ? C.green : score >= P.scoreMin * 0.7 ? C.amber : C.dim; }
const sBadge = (s) => '<span class="badge" style="color:' + s.color + ';border-color:' + s.color + '66;background:' + s.color + '14">' + esc(s.name) + '</span>';

/* ---------- flux live, rendu incrémental ---------- */
const feedRows = new Map();   // mint -> { tr, cells, sv }
function feedList() {
  const s = viewStrat(), q = S.search.trim().toLowerCase();
  const counts = { all: 0, watch: 0, cand: 0, entered: 0, rejected: 0 };
  const out = [];
  for (const t of S.tokens.values()) {
    if (q && !(t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.mint.toLowerCase().includes(q))) continue;
    const st = stOf(t, s.id);
    const f = { all: true, watch: t.watching, cand: st.scoreMax >= s.P.scoreMin, entered: st.status === 'entered' || st.status === 'closed', rejected: st.status === 'rejected' };
    for (const k in counts) if (f[k]) counts[k]++;
    if (f[S.feedFilter]) out.push(t);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return { list: out.slice(0, Math.max(10, cfg.feedRows)), counts };
}
function makeFeedRow(t) {
  const tr = document.createElement('tr');
  tr.className = 'click' + (t.isNew && S.tokens.size > 1 ? ' new' : '');
  tr.dataset.mint = t.mint;
  t.isNew = false;
  tr.innerHTML = '<td class="c-tk"></td><td class="num c-age"></td><td class="num c-mc"></td><td class="c-bond"></td><td class="num c-buyers"></td><td class="num c-bs"></td><td class="num c-top"></td><td class="num c-dev"></td><td class="num c-snp"></td><td class="c-score"></td><td class="c-st"></td>';
  const cells = {}; tr.querySelectorAll('td').forEach((td) => { cells[td.className.split(' ').pop()] = td; });
  return { tr, cells, sv: '' };
}
function fillFeedRow(row, t, now, s) {
  const c = row.cells, st = stOf(t, s.id), P = s.P, tracked = t.track === 'ok';
  c['c-age'].textContent = ago(now - t.createdAt);
  const sig = t.ver + '|' + s.id + '|' + st.status + '|' + (S.selected === t.mint);
  if (row.sv === sig) return;
  row.sv = sig;
  row.tr.classList.toggle('selrow', S.selected === t.mint);
  const dev = S.devStats.get(t.creator) || { n: 1 };
  const badges = (t.migrated ? '<span class="badge g">migré</span>' : '') +
    (t.devSold ? '<span class="badge r">dev a vendu</span>' : '') +
    (dev.n >= 2 ? '<span class="badge a" title="Tokens lancés par ce dev">dev ×' + dev.n + '</span>' : '') +
    (hasSocials(t) ? '<span class="badge b">réseaux</span>' : '');
  c['c-tk'].innerHTML = '<div class="tk">' + avatar(t) + '<div class="nm"><b>' + esc(t.symbol || '?') + ' ' + badges + '</b><small>' + esc(t.name) + '</small></div></div>';
  const v = t.mc0 ? (t.mc / t.mc0 - 1) * 100 : 0;
  c['c-mc'].innerHTML = f1(t.mc) + '<div class="trend ' + cls(v) + '">' + (tracked ? pct(v) : '') + '</div>';
  if (t.mc !== t.lastMcShown && c['c-mc'].animate) {
    c['c-mc'].animate([{ background: t.mc > t.lastMcShown ? 'rgba(60,207,142,.2)' : 'rgba(255,107,107,.2)' }, { background: 'transparent' }], { duration: 700 });
  }
  t.lastMcShown = t.mc;
  const bp = bondingPct(t);
  c['c-bond'].innerHTML = bp == null ? '<span class="dim">—</span>' : '<div style="display:flex;align-items:center;gap:6px"><div class="bar" style="width:60px"><i style="width:' + bp.toFixed(0) + '%;background:' + (bp >= 100 ? C.green : 'var(--accent)') + '"></i></div><span class="mono dim" style="font-size:12px">' + bp.toFixed(0) + '%</span></div>';
  const accel = t.rec30 - t.prev30;
  c['c-buyers'].innerHTML = tracked ? uniq(t) + (isSnap(t) ? ' <span class="dim" title="Achats sur 1 h, DexScreener">ach.</span>' : '') + '<div class="trend ' + cls(accel) + '">' + (accel > 0 ? '▲ ' : accel < 0 ? '▼ ' : '') + t.rec30 + ' / 30 s</div>' : '<span class="dim">—</span>';
  c['c-bs'].innerHTML = tracked ? '<span class="pos">' + t.buys + '</span> / <span class="neg">' + t.sells + '</span>' : '<span class="dim">—</span>';
  c['c-top'].innerHTML = isSnap(t) ? '<span class="dim" title="Non mesuré sans trades">—</span>' : '<span class="' + (t.top10 > P.maxTop10 ? 'warn' : '') + '">' + f1(t.top10) + ' %</span>';
  c['c-dev'].innerHTML = t.devSold ? '<span class="neg">vendu</span>' : '<span class="' + (t.devPct > P.maxDevPct ? 'warn' : '') + '">' + f1(t.devPct) + ' %</span>';
  c['c-snp'].innerHTML = isSnap(t) ? '<span class="dim" title="Non mesuré sans trades">—</span>' : tracked ? '<span class="' + (t.snipers.size > P.maxSnipers ? 'warn' : '') + '">' + t.snipers.size + '</span> / <span class="' + (t.bundlePct > P.maxBundlePct ? 'neg' : '') + '">' + f1(t.bundlePct) + ' %</span>' : '<span class="dim">—</span>';
  c['c-score'].innerHTML = tracked ? ring(st.score, scoreColor(st.score, P)) : '<span class="dim">—</span>';
  const lab = STATUS[st.status] || ['', st.status];
  const others = STRATS.filter((x) => x.id !== s.id && (stOf(t, x.id).status === 'entered' || stOf(t, x.id).status === 'closed'))
    .map((x) => '<span class="sdot" style="background:' + x.color + '" title="' + esc(x.name) + ' : ' + esc(STATUS[stOf(t, x.id).status][1]) + '"></span>').join('');
  c['c-st'].innerHTML = '<div style="display:flex;align-items:center;gap:6px"><span class="st ' + lab[0] + '" title="' + esc(st.reason || st.blockers.join(' · ')) + '">' + lab[1] + '</span>' + others + '</div>';
}
function renderFeed(now) {
  const s = viewStrat(), { list, counts } = feedList(), body = $('feedBody');
  for (const k in counts) { const el = $('n' + k.charAt(0).toUpperCase() + k.slice(1)); if (el) el.textContent = counts[k]; }
  const keep = new Set(list.map((t) => t.mint));
  for (const [m, r] of feedRows) if (!keep.has(m)) { r.tr.remove(); feedRows.delete(m); }
  let prev = null;
  for (const t of list) {
    let r = feedRows.get(t.mint);
    if (!r) { r = makeFeedRow(t); feedRows.set(t.mint, r); }
    fillFeedRow(r, t, now, s);
    const want = prev ? prev.nextSibling : body.firstChild;
    if (want !== r.tr) body.insertBefore(r.tr, want);
    prev = r.tr;
  }
  $('feedEmpty').hidden = list.length > 0;
  if (!list.length && S.tokens.size) $('feedEmpty').innerHTML = '<b>Aucun token dans ce filtre</b>Change de filtre ou efface la recherche.';
  else if (!list.length) $('feedEmpty').innerHTML = S.wantConn ? '<b>En attente de nouveaux tokens</b>Les lancements pump.fun apparaîtront ici dès leur création.' : '<b>Terminal à l\'arrêt</b>Clique sur <strong>Connecter</strong> pour suivre pump.fun en direct, ou lance la <strong>Démo</strong>.';
  // PumpPortal peut refuser les trades sans clé : on le détecte au lieu de le supposer
  const nt = $('noTrades'), quiet = S.wantConn && !S.demo && S.connected && Date.now() - S.connAt > 30000 && S.totalTokens >= 3 && Date.now() - (S.lastTradeAt || 0) > 60000;
  nt.hidden = !quiet;
  if (quiet) {
    const snapOk = cfg.snapshots && SNAP.ok > 0 && Date.now() - SNAP.at < 60000;
    nt.className = 'notice ' + (snapOk ? 'info' : cfg.snapshots && SNAP.err ? 'bad' : '');
    nt.innerHTML = snapOk ? '<b>Mode sans trades actif.</b> PumpPortal transmet les lancements et les migrations, pas les trades : le terminal lit le prix, les achats, les ventes et le volume sur DexScreener toutes les ' + clamp(cfg.snapSec || 4, 2, 30) + ' s. Snipers, bundle et top 10 ne sont pas mesurés dans ce mode. La stratégie <b>Migration</b> est faite pour ces données.'
      : !cfg.snapshots ? '<b>Aucun trade reçu.</b> PumpPortal ne transmet que les lancements et les migrations. Active les <b>Instantanés DexScreener</b> dans Réglages pour que les stratégies puissent travailler.'
      : SNAP.err ? '<b>DexScreener ne répond pas.</b> Sans trades ni instantanés, les stratégies ne peuvent pas entrer. Nouvel essai automatique.'
      : '<b>Aucun trade reçu.</b> Lecture des premiers instantanés DexScreener…';
  }
}

/* ---------- en-tête ---------- */
function renderHeader() {
  const s = viewStrat(), st = statsOf(S.port[s.id].closed, s.P.startBal);
  $('kRate').textContent = S.createTimes.length;
  $('kRateS').textContent = S.tradeTimes.length + ' trades / min';
  $('kWatch').textContent = countWatched();
  $('kWatchS').textContent = 'max ' + cfg.maxWatched;
  $('kPos').textContent = S.port[s.id].positions.size + ' / ' + s.P.maxPositions;
  $('kPosS').textContent = allPositions().length + ' toutes stratégies';
  $('kBal').textContent = f3(balance(s)) + ' SOL';
  $('kBalS').textContent = esc(s.name) + ' · départ ' + f2(s.P.startBal);
  const r = realized(s); let u = 0; S.port[s.id].positions.forEach((p) => { u += unrealized(p); });
  $('kPnl').textContent = sol(r); $('kPnl').className = 'v ' + cls(r);
  $('kPnlS').textContent = 'latent ' + sol(u);
  $('kWin').textContent = st.winrate == null ? '—' : fx(st.winrate, 0) + ' %';
  $('kWinS').textContent = st.n + ' trades fermés';
  $('kCost').textContent = S.demo ? 'démo' : !S.wantConn ? 'arrêté' : S.connected ? 'en direct' : 'connexion…';
  $('kCostS').textContent = S.demo ? 'données simulées' : S.migrations + ' migrations · ' + (SNAP.ok ? SNAP.n + ' instantanés' : (S.createTimes.length + S.tradeTimes.length) + ' msg / min');
  $('cLive').textContent = S.tokens.size;
  $('cPos').textContent = allPositions().length;
  $('cJournal').textContent = allClosed().length;
}

/* ---------- positions ---------- */
function renderPositions(now) {
  const list = allPositions().sort((a, b) => b.openedAt - a.openedAt);
  let inv = 0, u = 0; list.forEach((p) => { inv += p.size; u += unrealized(p); });
  const stat = (l, v, k, sub) => '<div class="stat"><div class="l">' + l + '</div><div class="v ' + (k || '') + '">' + v + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  $('posStats').innerHTML = stat('Positions ouvertes', list.length) + stat('Capital engagé', f3(inv) + ' SOL') +
    stat('P&amp;L latent', sol(u), cls(u), inv ? pct(u / inv * 100) : '') +
    STRATS.map((s) => stat('<span class="sdot" style="background:' + s.color + '"></span> ' + esc(s.name), S.port[s.id].positions.size + ' / ' + s.P.maxPositions, '', 'solde ' + f3(balance(s)) + ' SOL')).join('');
  $('posBody').innerHTML = list.map((p) => {
    const t = S.tokens.get(p.mint), s = stratById(p.sid), P = s.P, ur = unrealized(p), r = t ? factor(p, P, t.mc) - 1 : 0;
    const fl = !!p.kind, ph2 = fl && (now - p.openedAt) / 1000 >= P.phaseSec, slv = fl ? p.sl : P.slPct, tpv = fl ? (ph2 ? p.tpB : p.tpA) : P.tp1Pct;
    const lo = -slv / 100, hi = tpv / 100, pos = clamp((r - lo) / (hi - lo), 0, 1) * 100;
    return '<tr class="click" data-mint="' + esc(p.mint) + '">' +
      '<td><div class="tk">' + (t ? avatar(t) : '') + '<div class="nm"><b>' + esc(p.symbol || '?') + '</b><small>' + esc(p.name) + '</small></div></div></td>' +
      '<td>' + sBadge(s) + '</td>' +
      '<td class="num">' + ago(now - p.openedAt) + '<div class="trend dim">max ' + ago(P.maxHoldSec * 1000) + '</div></td>' +
      '<td class="num">' + f3(p.size) + '</td>' +
      '<td class="num">' + f1(p.entryMc) + ' → ' + f1(t ? t.mc : null) + '<div class="trend dim">plus haut ' + f1(p.peak) + '</div></td>' +
      '<td class="num ' + cls(ur) + '">' + sol(ur) + '<div class="trend">' + pct(ur / p.size * 100) + '</div></td>' +
      '<td style="min-width:170px"><div class="pb-gauge" style="background:linear-gradient(90deg,var(--red-bg),var(--line) ' + (-lo / (hi - lo) * 100).toFixed(0) + '%,var(--green-bg))"><span style="left:calc(' + pos.toFixed(1) + '% - 7px);background:' + (r >= 0 ? C.green : C.red) + '"></span></div>' +
        '<div class="trend dim" style="display:flex;justify-content:space-between;margin-top:5px"><span>-' + slv + ' %</span><span>' + (fl ? (p.kind === 'mig' ? 'migration · ' : 'lancement · ') + 'objectif +' + tpv + ' %' + (ph2 ? ' (phase 2)' : '') : p.tp1Done ? 'TP1 atteint · trailing ' + P.trailPct + ' %' : '+' + P.tp1Pct + ' %') + '</span></div></td>' +
      '<td class="num">' + Math.round(p.remaining * 100) + ' %</td>' +
      '<td><button class="btn sm danger" data-close="' + esc(p.sid + '|' + p.mint) + '" type="button">Fermer</button></td></tr>';
  }).join('');
  $('posEmpty').hidden = list.length > 0;
}

/* ---------- graphiques canvas ---------- */
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 600, h = +cv.getAttribute('height');
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const g = cv.getContext('2d'); if (g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (g.clearRect) g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function emptyMsg(g, w, h, txt) { g.fillStyle = C.dim; g.font = '13px Geist, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(txt, w / 2, h / 2); }
function drawLines(cv, series, opts) {
  const { g, w, h } = setupCanvas(cv);
  const all = series.flatMap((s) => s.pts);
  if (!series.some((s) => s.pts.length >= 2)) return emptyMsg(g, w, h, opts.empty || 'Pas encore de données');
  const pl = 58, pr = 12, pt = 10, pb = 22;
  let x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  let y0 = Math.min(...all.map((p) => p[1]), ...(opts.refs || [])), y1 = Math.max(...all.map((p) => p[1]), ...(opts.refs || []));
  if (x1 === x0) x1 = x0 + 1; if (y1 === y0) { y1 += 1; y0 -= 1; }
  const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;
  const X = (x) => pl + (x - x0) / (x1 - x0) * (w - pl - pr), Y = (y) => h - pb - (y - y0) / (y1 - y0) * (h - pt - pb);
  g.font = MONO; g.fillStyle = C.dim; g.strokeStyle = C.grid; g.lineWidth = 1; g.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const y = y0 + (y1 - y0) * i / 4; g.beginPath(); g.moveTo(pl, Y(y)); g.lineTo(w - pr, Y(y)); g.stroke(); g.fillText(y.toFixed(opts.dec == null ? 2 : opts.dec), pl - 6, Y(y) + 3); }
  (opts.refs || []).forEach((r) => { g.strokeStyle = C.line; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(pl, Y(r)); g.lineTo(w - pr, Y(r)); g.stroke(); g.setLineDash([]); });
  series.forEach((s) => {
    if (s.pts.length < 2) return;
    g.strokeStyle = s.color; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
    s.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke();
  });
  if (opts.xlab) { g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText(opts.xlab[0], pl, h - 6); g.textAlign = 'right'; g.fillText(opts.xlab[1], w - pr, h - 6); }
}
function drawCandles(cv, t) {
  const { g, w, h } = setupCanvas(cv);
  if (t.trades.length < 2) return emptyMsg(g, w, h, 'Pas encore assez de trades pour les bougies');
  const span = (t.trades[t.trades.length - 1][0] - t.trades[0][0]) / 1000;
  const bucket = span > 600 ? 30000 : span > 240 ? 15000 : 5000;
  const cs = []; let cur = null, prevC = t.mc0;
  for (const [ts, mc, side, amt] of t.trades) {
    const k = Math.floor(ts / bucket);
    if (!cur || cur.k !== k) { cur = { k, o: prevC, h: Math.max(prevC, mc), l: Math.min(prevC, mc), c: mc, vb: 0, vs: 0 }; cs.push(cur); }
    cur.h = Math.max(cur.h, mc); cur.l = Math.min(cur.l, mc); cur.c = mc; prevC = mc;
    if (side > 0) cur.vb += amt; else cur.vs += amt;
  }
  const show = cs.slice(-70);
  const pl = 50, pr = 10, pt = 10, volH = 34, pb = 20, ch = h - pt - pb - volH - 6;
  let y0 = Math.min(...show.map((c) => c.l)), y1 = Math.max(...show.map((c) => c.h));
  if (y1 === y0) { y1 += 1; y0 -= 1; } const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const Y = (y) => pt + (1 - (y - y0) / (y1 - y0)) * ch;
  const cw = (w - pl - pr) / Math.max(show.length, 20), bw = Math.max(2, cw * 0.62);
  g.font = MONO; g.fillStyle = C.dim; g.strokeStyle = C.grid; g.lineWidth = 1; g.textAlign = 'right';
  for (let i = 0; i <= 3; i++) { const y = y0 + (y1 - y0) * i / 3; g.beginPath(); g.moveTo(pl, Y(y)); g.lineTo(w - pr, Y(y)); g.stroke(); g.fillText(y.toFixed(1), pl - 5, Y(y) + 3); }
  const vmax = Math.max(...show.map((c) => c.vb + c.vs), 0.0001);
  show.forEach((c, i) => {
    const x = pl + i * cw + cw / 2, up = c.c >= c.o, col = up ? C.green : C.red;
    g.strokeStyle = col; g.beginPath(); g.moveTo(x, Y(c.h)); g.lineTo(x, Y(c.l)); g.stroke();
    g.fillStyle = col; const yt = Y(Math.max(c.o, c.c)), yb = Y(Math.min(c.o, c.c)); g.fillRect(x - bw / 2, yt, bw, Math.max(1, yb - yt));
    const vb = c.vb / vmax * volH, vs = c.vs / vmax * volH, base = h - pb;
    g.fillStyle = 'rgba(60,207,142,.5)'; g.fillRect(x - bw / 2, base - vb, bw, vb);
    g.fillStyle = 'rgba(255,107,107,.5)'; g.fillRect(x - bw / 2, base - vb - vs, bw, vs);
  });
  // marqueurs d'entrée et de sortie, par stratégie
  const first = show[0].k * bucket, X = (ts) => pl + ((ts - first) / bucket + 0.5) * cw;
  STRATS.forEach((s) => {
    const marks = [];
    const p = S.port[s.id].positions.get(t.mint);
    const recs = S.port[s.id].closed.filter((c) => c.mint === t.mint);
    if (p) { marks.push([p.openedAt, p.entryMc, 'in']); p.exits.forEach((e) => marks.push([e.t, e.mc, 'out'])); }
    recs.forEach((r) => { marks.push([r.openedAt, r.entryMc, 'in']); r.exits.forEach((e) => marks.push([e.t, e.mc, 'out'])); });
    marks.forEach(([ts, mc, kind]) => {
      if (ts < first) return;
      const x = X(ts), y = Y(clamp(mc, y0, y1));
      g.fillStyle = s.color; g.strokeStyle = C.bg; g.lineWidth = 2; g.beginPath();
      if (kind === 'in') { g.moveTo(x, y - 8); g.lineTo(x - 6, y + 3); g.lineTo(x + 6, y + 3); } else { g.moveTo(x, y + 8); g.lineTo(x - 6, y - 3); g.lineTo(x + 6, y - 3); }
      g.closePath(); g.stroke(); g.fill();
    });
  });
  g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText('bougies ' + bucket / 1000 + ' s · MC en SOL', pl, h - 5);
}

/* ---------- fiche token ---------- */
function renderDetail(now) {
  const box = $('detail'), t = S.selected && S.tokens.get(S.selected);
  if (!t) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  const s = viewStrat(), st = stOf(t, s.id), dev = S.devStats.get(t.creator) || { n: 1, migrated: 0, fastSell: 0 };
  const m = t.meta || {}, bp = bondingPct(t);
  const link = (href, label) => href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : '<a class="off" aria-disabled="true">' + label + '</a>';
  const trust = dev.n >= s.P.serialMax || dev.fastSell >= 2 ? ['r', 'Risque élevé'] : dev.fastSell === 1 || dev.n >= 2 ? ['a', 'À surveiller'] : ['g', 'Pas d\'historique négatif'];
  const parts = st.parts ? Object.values(st.parts).map((p) =>
    '<div class="part"><span>' + p.l + '</span><div class="bar"><i style="width:' + (p.v / p.max * 100).toFixed(0) + '%;background:' + (p.v / p.max > 0.66 ? C.green : p.v / p.max > 0.33 ? C.amber : C.red) + '"></i></div><span class="v">' + p.v.toFixed(0) + ' / ' + p.max + '</span></div>').join('') : '<span class="dim">Pas de données de trades.</span>';
  const why = STRATS.map((x) => {
    const y = stOf(t, x.id), lab = STATUS[y.status] || ['', y.status];
    const txt = y.reason || (y.blockers.length ? y.blockers.join(' · ') : (y.status === 'watch' ? 'Conditions remplies, en attente' : ''));
    return '<div class="row"><span class="sdot" style="background:' + x.color + ';margin-top:5px"></span><div><b>' + esc(x.name) + '</b> · <span class="st ' + lab[0] + '">' + lab[1] + '</span> <span class="mono dim">score ' + y.score + '</span><div class="muted" style="margin-top:3px">' + esc(txt) + '</div></div></div>';
  }).join('');
  const holders = topHolders(t).map((h, i) => '<div class="h"><span class="dim mono">' + (i + 1) + '</span><div><div style="display:flex;justify-content:space-between;gap:8px"><a href="https://solscan.io/account/' + encodeURIComponent(h.w) + '" target="_blank" rel="noopener noreferrer" class="mono">' + esc(short(h.w)) + '</a>' + (h.dev ? '<span class="badge a">dev</span>' : '') + '</div><div class="bar" style="margin-top:3px"><i style="width:' + clamp(h.pct * 4, 0, 100).toFixed(0) + '%;background:' + (h.dev ? C.amber : 'var(--accent)') + '"></i></div></div><span class="mono" style="text-align:right">' + f2(h.pct) + ' %</span></div>').join('');
  const sc = box.scrollTop;
  box.innerHTML =
    '<div class="d-head">' + avatar(t, true) + '<div style="min-width:0"><h2>' + esc(t.symbol || '?') + (t.migrated ? ' <span class="badge g">migré</span>' : '') + '</h2><p>' + esc(t.name) + ' · ' + ago(now - t.createdAt) + '</p></div>' +
      '<button class="close-x" data-pbx="close" type="button" aria-label="Fermer la fiche">✕</button></div>' +
    '<div class="d-sec"><div class="links">' +
      link('https://pump.fun/coin/' + encodeURIComponent(t.mint), 'pump.fun') + link('https://solscan.io/token/' + encodeURIComponent(t.mint), 'Solscan') +
      link('https://dexscreener.com/solana/' + encodeURIComponent(t.mint), 'Dexscreener') + link(m.twitter, 'X') + link(m.telegram, 'Telegram') + link(m.website, 'Site') +
      '<a href="#" data-pbx="trade">Ouvrir dans Trader</a></div>' +
      (m.desc ? '<p class="muted" style="font-size:13px;margin:10px 0 0">' + esc(m.desc) + '</p>' : '') +
      (m.state === 'loading' || m.state === 'queued' ? '<p class="dim" style="font-size:12.5px;margin:8px 0 0">Lecture des métadonnées…</p>' : m.state === 'err' ? '<p class="dim" style="font-size:12.5px;margin:8px 0 0">Métadonnées illisibles (serveur IPFS lent ou bloqué).</p>' : '') + '</div>' +
    '<div class="d-sec"><h4>Graphique</h4><canvas id="pb-detChart" height="210"></canvas><div class="legend">' + STRATS.map((x) => '<span><span class="sdot" style="background:' + x.color + '"></span>' + esc(x.name) + '</span>').join('') + '<span>▲ entrée ▼ sortie</span></div></div>' +
    '<div class="d-sec"><h4>Décision par stratégie</h4><div class="why">' + why + '</div></div>' +
    '<div class="d-sec"><h4>Score détaillé · ' + esc(s.name) + ' ' + ring(st.score, scoreColor(st.score, s.P), 30) + '</h4><div class="parts">' + parts + '</div>' + (t.devSold ? '<p class="neg" style="font-size:12.5px;margin:10px 0 0">Score divisé par 3 : le dev a vendu.</p>' : '') + '</div>' +
    '<div class="d-sec"><h4>Marché</h4><div class="kv">' +
      '<span>MC départ · actuel · max</span><span>' + f1(t.mc0) + ' · ' + f1(t.mc) + ' · ' + f1(t.mcMax) + '</span>' +
      '<span>Progression de la courbe</span><span>' + (bp == null ? '—' : bp.toFixed(0) + ' % (estimation)') + '</span>' +
      (isSnap(t) ? '<span>Source</span><span>instantanés DexScreener</span><span>Achats sur 1 h</span><span>' + t.buys + '</span>' : '<span>Acheteurs uniques</span><span>' + t.buyers.size + '</span>') +
      (t.migrated && t.migratedAt ? '<span>Migré depuis</span><span>' + ago(now - t.migratedAt) + '</span>' : '') +
      '<span>Nouveaux acheteurs 30 s · 30 s avant</span><span>' + t.rec30 + ' · ' + t.prev30 + '</span>' +
      '<span>Achats · ventes</span><span>' + t.buys + ' · ' + t.sells + '</span>' +
      '<span>Volume achat · vente</span><span>' + f2(t.volBuy) + ' · ' + f2(t.volSell) + ' SOL</span>' +
      (isSnap(t) ? '<span>Snipers, bundle, top 10</span><span class="dim">non mesurés sans trades</span><span>Part du dev au lancement</span><span>' + f1(t.devPct) + ' %</span>' :
      '<span>Snipers (3 premières s)</span><span>' + t.snipers.size + '</span>' +
      '<span>Bundle (2 premières s)</span><span>' + f1(t.bundlePct) + ' %</span>' +
      '<span>Top 10 · dev</span><span>' + f1(t.top10) + ' % · ' + (t.devSold ? 'vendu' : f1(t.devPct) + ' %') + '</span>') + '</div></div>' +
    '<div class="d-sec"><h4>Profil du dev <span class="badge ' + trust[0] + '">' + trust[1] + '</span></h4><div class="kv">' +
      '<span>Wallet</span><span><a href="https://solscan.io/account/' + encodeURIComponent(t.creator) + '" target="_blank" rel="noopener noreferrer">' + esc(short(t.creator)) + '</a></span>' +
      '<span>Tokens lancés (collecte)</span><span>' + dev.n + '</span><span>Tokens migrés</span><span>' + dev.migrated + '</span>' +
      '<span>Ventes dans les 5 min</span><span class="' + (dev.fastSell ? 'neg' : '') + '">' + dev.fastSell + '</span>' +
      '<span>Dev buy</span><span>' + f2(t.devBuySol) + ' SOL</span></div></div>' +
    '<div class="d-sec"><h4>10 plus gros holders</h4><div class="holders">' + (holders || '<span class="dim">Aucun holder connu.</span>') + '</div><p class="dim" style="font-size:12px;margin:10px 0 0">Calculé à partir des trades reçus. La courbe de liquidité n\'est pas comptée.</p></div>';
  box.scrollTop = sc;
  drawCandles($('detChart'), t);
}

/* ---------- journal ---------- */
function journalList() {
  let l = S.jStrat === 'all' ? allClosed() : S.port[S.jStrat].closed.slice();
  if (S.jReason !== 'all') l = l.filter((c) => c.why === S.jReason);
  return l;
}
function renderJournal() {
  $('jStrat').innerHTML = '<option value="all">Toutes les stratégies</option>' + STRATS.map((s) => '<option value="' + s.id + '"' + (S.jStrat === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  if (S.jStrat === 'all') $('jStrat').value = 'all';
  const base = S.jStrat === 'all' ? allClosed() : S.port[S.jStrat].closed;
  const reasons = {}; base.forEach((c) => { reasons[c.why] = (reasons[c.why] || 0) + 1; });
  $('jReason').innerHTML = '<button class="chip' + (S.jReason === 'all' ? ' on' : '') + '" data-r="all" type="button">Toutes les sorties <span class="n">' + base.length + '</span></button>' +
    Object.keys(reasons).map((r) => '<button class="chip' + (S.jReason === r ? ' on' : '') + '" data-r="' + esc(r) + '" type="button">' + esc(r) + ' <span class="n">' + reasons[r] + '</span></button>').join('');
  const list = journalList();
  const startBal = S.jStrat === 'all' ? STRATS.reduce((a, s) => a + s.P.startBal, 0) : stratById(S.jStrat).P.startBal;
  const st = statsOf(list, startBal);
  $('jScope').textContent = (S.jStrat === 'all' ? 'Toutes les stratégies' : stratById(S.jStrat).name) + (S.jReason === 'all' ? '' : ' · sortie « ' + S.jReason + ' »');
  const box = (l, v, k, sub) => '<div class="stat"><div class="l">' + l + '</div><div class="v ' + (k || '') + '">' + v + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  $('perf').innerHTML = box('Trades fermés', st.n, '', st.wins + ' gagnants') +
    box('Winrate', st.winrate == null ? '—' : fx(st.winrate, 1) + ' %') +
    box('P&amp;L total', sol(st.pnl), cls(st.pnl)) +
    box('Profit factor', st.pf == null ? '—' : st.pf === Infinity ? '∞' : f2(st.pf), st.pf != null && st.pf >= 1 ? 'pos' : st.pf != null ? 'neg' : '', 'gains / pertes') +
    box('Gain moyen', pct(st.avgW), 'pos') + box('Perte moyenne', pct(st.avgL), 'neg') +
    box('Meilleur · pire', pct(st.best) + ' · ' + pct(st.worst)) +
    box('Drawdown max', f1(st.dd) + ' %', st.dd > 0 ? 'neg' : '') +
    box('Durée moyenne', st.avgHold == null ? '—' : ago(st.avgHold));
  let bal = startBal; const pts = [[0, bal]]; list.forEach((c, i) => { bal += c.pnl; pts.push([i + 1, bal]); });
  drawLines($('equity'), [{ pts, color: bal >= startBal ? C.green : C.red }], { refs: [startBal], dec: 3, empty: 'La courbe apparaîtra après le premier trade fermé.', xlab: ['trade 0', 'trade ' + list.length] });
  const buckets = [[0, 60], [60, 70], [70, 80], [80, 90], [90, 101]];
  const tbl = (head, rows) => rows.length ? '<div class="tablebox"><table><thead><tr>' + head.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '<div class="empty" style="padding:16px">Pas encore de données.</div>';
  $('byScore').innerHTML = tbl(['Score', 'Trades', 'Winrate', 'P&amp;L moyen'], buckets.map(([a, b]) => {
    const l = list.filter((c) => c.score >= a && c.score < b); if (!l.length) return '';
    const x = statsOf(l, 0), avg = l.reduce((q, c) => q + c.pnlPct, 0) / l.length;
    return '<tr><td>' + a + (b > 100 ? '+' : '–' + (b - 1)) + '</td><td class="num">' + l.length + '</td><td class="num">' + fx(x.winrate, 0) + ' %</td><td class="num ' + cls(avg) + '">' + pct(avg) + '</td></tr>';
  }).filter(Boolean));
  const rs = {}; list.forEach((c) => { (rs[c.why] = rs[c.why] || []).push(c); });
  $('byReason').innerHTML = tbl(['Sortie', 'Trades', 'Part', 'P&amp;L'], Object.entries(rs).sort((a, b) => b[1].length - a[1].length).map(([r, l]) => {
    const p = l.reduce((q, c) => q + c.pnl, 0);
    return '<tr><td>' + esc(r) + '</td><td class="num">' + l.length + '</td><td class="num">' + fx(l.length / list.length * 100, 0) + ' %</td><td class="num ' + cls(p) + '">' + sol(p) + '</td></tr>';
  }));
  const hours = new Array(24).fill(0); list.forEach((c) => { hours[new Date(c.openedAt).getUTCHours()] += c.pnl; });
  const cv = $('byHour'); const { g, w, h } = setupCanvas(cv);
  if (!list.length) emptyMsg(g, w, h, 'Pas encore de données.');
  else {
    const mx = Math.max(...hours.map(Math.abs), 0.0001), pb = 18, mid = (h - pb) / 2, bw = (w - 20) / 24;
    g.strokeStyle = C.line; g.beginPath(); g.moveTo(10, mid); g.lineTo(w - 10, mid); g.stroke();
    g.font = MONO; g.textAlign = 'center';
    hours.forEach((v, i) => {
      const bh = Math.abs(v) / mx * (mid - 6), x = 10 + i * bw;
      g.fillStyle = v >= 0 ? C.green : C.red; g.fillRect(x + bw * 0.18, v >= 0 ? mid - bh : mid, bw * 0.64, bh);
      if (i % 3 === 0) { g.fillStyle = C.dim; g.fillText(i + 'h', x + bw / 2, h - 4); }
    });
  }
  $('journalBody').innerHTML = list.slice().reverse().slice(0, 400).map((c) => {
    const s = stratById(c.sid) || { name: c.sid, color: C.dim };
    return '<tr class="click" data-mint="' + esc(c.mint) + '"><td class="mono dim">' + hhmm(c.closedAt) + '</td>' +
      '<td><b>' + esc(c.symbol || '?') + '</b>' + (c.demo ? ' <span class="badge v">démo</span>' : '') + '<div class="dim" style="font-size:12px">' + esc(c.name) + '</div></td>' +
      '<td>' + sBadge(s) + '</td>' +
      '<td class="num">' + ago(c.closedAt - c.openedAt) + '</td><td class="num">' + (c.score == null ? '—' : c.score) + '</td>' +
      '<td class="num">' + f1(c.entryMc) + ' / ' + f1(c.peakMc) + '</td>' +
      '<td class="num">' + f3(c.size) + ' → ' + f3(c.proceeds) + '</td>' +
      '<td class="num ' + cls(c.pnl) + '">' + sol(c.pnl) + '<div class="trend">' + pct(c.pnlPct) + '</div></td>' +
      '<td>' + esc(c.why) + (c.exits && c.exits.length > 1 ? '<div class="dim" style="font-size:12px">' + c.exits.map((e) => esc(e.why) + ' ' + Math.round(e.frac * 100) + ' %').join(' · ') + '</div>' : '') + '</td></tr>';
  }).join('');
  $('journalEmpty').hidden = list.length > 0;
}

/* ---------- stratégies ---------- */
function renderStratCompare() {
  $('cmpBody').innerHTML = STRATS.map((s) => {
    const st = statsOf(S.port[s.id].closed, s.P.startBal), b = balance(s);
    return '<tr><td><span style="display:inline-flex;align-items:center;gap:8px"><span class="sdot" style="background:' + s.color + '"></span><b>' + esc(s.name) + '</b></span></td>' +
      '<td>' + (s.enabled ? '<span class="badge g">active</span>' : '<span class="badge">en pause</span>') + '</td>' +
      '<td class="num">' + st.n + '</td><td class="num">' + (st.winrate == null ? '—' : fx(st.winrate, 0) + ' %') + '</td>' +
      '<td class="num ' + cls(st.pnl) + '">' + sol(st.pnl) + '</td><td class="num pos">' + pct(st.avgW) + '</td><td class="num neg">' + pct(st.avgL) + '</td>' +
      '<td class="num">' + f1(st.dd) + ' %</td><td class="num">' + S.port[s.id].positions.size + '</td><td class="num ' + cls(b - s.P.startBal) + '">' + f3(b) + '</td></tr>';
  }).join('');
  const series = STRATS.map((s) => { let bal = 0; const pts = [[0, 0]]; S.port[s.id].closed.forEach((c, i) => { bal += c.pnl; pts.push([i + 1, bal]); }); return { pts, color: s.color }; });
  drawLines($('cmpChart'), series, { refs: [0], dec: 3, empty: 'Les courbes de P&L apparaîtront après les premiers trades fermés.' });
  $('cmpLegend').innerHTML = STRATS.map((s) => '<span><span class="sdot" style="background:' + s.color + '"></span>' + esc(s.name) + ' · P&amp;L cumulé</span>').join('');
}

/* =========================================================================
   FORMULAIRES AVEC VALIDATION
   ========================================================================= */
function fieldHtml(prefix, f, value) {
  const [k, label, type, help, unit] = f, id = prefix + '_' + k;
  const lab = '<label for="' + id + '">' + esc(label) + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>';
  if (type === 'bool') return '<div class="f">' + lab + '<span class="switch"><input type="checkbox" id="' + id + '" data-k="' + k + '"' + (value ? ' checked' : '') + '><i></i></span></div>';
  if (type === 'text') return '<div class="f">' + lab + '<input type="text" id="' + id + '" data-k="' + k + '" value="' + esc(value) + '"></div>';
  return '<div class="f">' + lab + '<span class="unit"><input type="number" step="any" min="0" inputmode="decimal" id="' + id + '" data-k="' + k + '" value="' + esc(value) + '"><em>' + esc(unit || '') + '</em></span></div>';
}
function sectionHtml(scope, sec, values, prefix) {
  return '<fieldset data-scope="' + scope + '" data-sec="' + sec.id + '"><legend>' + esc(sec.title) + '</legend>' +
    sec.fields.map((f) => fieldHtml(prefix, f, values[f[0]])).join('') +
    '<div class="actions"><span class="msg">Modifications non enregistrées</span><button class="btn sm" data-fact="cancel" type="button">Annuler</button><button class="btn sm primary" data-fact="save" type="button">Valider</button></div></fieldset>';
}
function buildSettings() {
  $('settingsForms').innerHTML = CFG_SECTIONS.map((sec) => sectionHtml('cfg', sec, cfg, 'pbcfg')).join('');
  setConn($('connDot').className.replace('dot', '').trim(), $('connTxt').textContent);
}
function buildStratCards() {
  $('stratCards').innerHTML = STRATS.map((s) =>
    '<div class="strat-card" data-sid="' + s.id + '" style="border-top:3px solid ' + s.color + '">' +
      '<div class="strat-head"><h3><span class="sdot" style="background:' + s.color + ';width:12px;height:12px"></span>' + esc(s.name) + '</h3>' +
      (s.enabled ? '<span class="badge g">active</span>' : '<span class="badge">en pause</span>') +
      '<div class="spacer"></div>' +
      '<button class="btn sm" data-sact="toggle" type="button">' + (s.enabled ? 'Mettre en pause' : 'Activer') + '</button>' +
      '<select class="sel" data-sact="preset" aria-label="Modèle de réglages">' + Object.keys(PRESETS).filter((k) => (k === 'flash') === isFlash(s)).map((k) => '<option value="' + k + '"' + (k === s.id ? ' selected' : '') + '>Modèle ' + PRESET_NAMES[k] + '</option>').join('') + '</select>' +
      '<button class="btn sm" data-sact="applyPreset" type="button">Appliquer le modèle</button>' +
      '<button class="btn sm danger" data-sact="resetPort" type="button">Réinitialiser le portefeuille</button></div>' +
      '<div class="forms">' +
        sectionHtml('strat:' + s.id, { id: 'general', title: 'Général', fields: [['name', 'Nom de la stratégie', 'text', '']] }, { name: s.name }, 'pbs_' + s.id) +
        secsOf(s).map((sec) => sectionHtml('strat:' + s.id, sec, s.P, 'pbs_' + s.id)).join('') +
      '</div></div>').join('');
}
function fieldsOf(scope, secId) {
  if (scope === 'cfg') return CFG_SECTIONS.find((x) => x.id === secId).fields;
  if (secId === 'general') return [['name', 'Nom', 'text']];
  return secsOf(stratById(scope.split(':')[1])).find((x) => x.id === secId).fields;
}
function currentValues(scope, secId) {
  if (scope === 'cfg') return cfg;
  const s = stratById(scope.split(':')[1]);
  return secId === 'general' ? { name: s.name } : s.P;
}
function readFieldset(fs) {
  const scope = fs.dataset.scope, secId = fs.dataset.sec, out = {}, errs = [];
  fs.querySelectorAll('.ferr').forEach((e) => e.remove());
  fs.querySelectorAll('input.err').forEach((e) => e.classList.remove('err'));
  for (const [k, label, type] of fieldsOf(scope, secId)) {
    const el = fs.querySelector('[data-k="' + k + '"]');
    if (!el) continue;
    if (type === 'bool') out[k] = el.checked;
    else if (type === 'num') {
      const v = num(String(el.value).replace(',', '.'));
      if (v == null || v < 0) { errs.push([el, label + ' : nombre positif attendu']); continue; }
      out[k] = v;
    } else {
      const v = el.value.trim();
      if (type === 'text' && !v) { errs.push([el, 'Le nom ne peut pas être vide']); continue; }
      out[k] = v;
    }
  }
  if (out.minAgeSec != null && out.maxEntryAgeSec != null && out.minAgeSec >= out.maxEntryAgeSec) errs.push([fs.querySelector('[data-k="maxEntryAgeSec"]'), 'L\'âge max doit être supérieur à l\'âge min']);
  if (out.minEntryMc != null && out.maxEntryMc != null && out.minEntryMc >= out.maxEntryMc) errs.push([fs.querySelector('[data-k="maxEntryMc"]'), 'Le MC max doit être supérieur au MC min']);
  if (out.tp1Frac != null && out.tp1Frac > 100) errs.push([fs.querySelector('[data-k="tp1Frac"]'), 'La part vendue ne peut pas dépasser 100 %']);
  if (out.scoreMin != null && out.scoreMin > 100) errs.push([fs.querySelector('[data-k="scoreMin"]'), 'Le score est sur 100']);
  if (out.sizeSol != null && out.sizeSol <= 0) errs.push([fs.querySelector('[data-k="sizeSol"]'), 'La mise doit être supérieure à 0']);
  if (out.maxPositions != null && out.maxPositions < 1) errs.push([fs.querySelector('[data-k="maxPositions"]'), 'Au moins 1 position']);
  if (out.slPct != null && out.slPct >= 100) errs.push([fs.querySelector('[data-k="slPct"]'), 'Le stop loss doit rester sous 100 %']);
  errs.forEach(([el, msg]) => { if (!el) return; el.classList.add('err'); const d = document.createElement('div'); d.className = 'ferr'; d.textContent = msg; el.closest('.f').appendChild(d); });
  return errs.length ? null : out;
}
function isDirty(fs) {
  const scope = fs.dataset.scope, secId = fs.dataset.sec, cur = currentValues(scope, secId);
  for (const [k, , type] of fieldsOf(scope, secId)) {
    const el = fs.querySelector('[data-k="' + k + '"]'); if (!el) continue;
    if (type === 'bool') { if (el.checked !== !!cur[k]) return true; }
    else if (type === 'num') { if (num(String(el.value).replace(',', '.')) !== cur[k]) return true; }
    else if (el.value.trim() !== String(cur[k] == null ? '' : cur[k])) return true;
  }
  return false;
}
function onFormInput(e) {
  const fs = e.target.closest('fieldset[data-scope]'); if (!fs) return;
  fs.classList.toggle('dirty', isDirty(fs));
}
function resetFieldset(fs) {
  const cur = currentValues(fs.dataset.scope, fs.dataset.sec);
  for (const [k, , type] of fieldsOf(fs.dataset.scope, fs.dataset.sec)) {
    const el = fs.querySelector('[data-k="' + k + '"]'); if (!el) continue;
    if (type === 'bool') el.checked = !!cur[k]; else el.value = cur[k] == null ? '' : cur[k];
    el.classList.remove('err');
  }
  fs.querySelectorAll('.ferr').forEach((x) => x.remove());
  fs.classList.remove('dirty');
}
function saveFieldset(fs) {
  const vals = readFieldset(fs);
  if (!vals) { toast('Valeurs invalides', 'Corrige les champs en rouge.', 'r'); return; }
  const scope = fs.dataset.scope, secId = fs.dataset.sec;
  if (scope === 'cfg') {
    Object.assign(cfg, vals); saveCfg();
    fs.classList.remove('dirty');
    toast('Réglages enregistrés', CFG_SECTIONS.find((x) => x.id === secId).title, 'g');
    setConn($('connDot').className.replace('dot', '').trim(), $('connTxt').textContent);
  } else {
    const s = stratById(scope.split(':')[1]);
    if (secId === 'general') s.name = vals.name; else Object.assign(s.P, vals);
    saveStrats();
    toast('Stratégie mise à jour', s.name + ' · ' + (secId === 'general' ? 'Général' : secsOf(s).find((x) => x.id === secId).title), 'g');
    if (secId === 'general') { buildStratCards(); buildViewSelect(); buildStratSel(); } else fs.classList.remove('dirty');
    for (const t of S.tokens.values()) t.ver++;
  }
  markAll();
}
const DESC = { equilibree: 'Joue les nouveaux lancements pump.fun avec le score de momentum.', migration: 'Joue les tokens juste après leur migration.', flash: 'Achète dès le lancement ou la migration, vend à l\'objectif, au stop ou au bout du temps.' };
function buildStratSel() {
  const on = STRATS.filter((s) => s.enabled), all = on.length === STRATS.length, one = on.length === 1 ? on[0].id : null;
  $('stratSel').innerHTML = STRATS.map((s) => '<button type="button" role="radio" aria-checked="' + (one === s.id) + '" data-strat="' + s.id + '" class="' + (one === s.id ? 'on' : '') + '"><span class="sdot" style="background:' + s.color + '"></span>' + esc(s.name) + '</button>').join('') +
    '<button type="button" role="radio" aria-checked="' + all + '" data-strat="all" class="' + (all ? 'on' : '') + '">Toutes</button>';
  $('stratHint').textContent = all ? 'Toutes les stratégies ouvrent des positions, chacune avec son portefeuille.' : one ? DESC[one] || '' : 'Aucune stratégie active : le terminal observe sans entrer.';
}
function pickStrat(id) {
  STRATS.forEach((s) => { s.enabled = id === 'all' || s.id === id; });
  if (id !== 'all') { S.view = id; try { localStorage.setItem('pstudio_pb_view', id); } catch (e) {} }
  saveStrats(); buildStratSel(); buildViewSelect(); buildStratCards();
  for (const t of S.tokens.values()) { for (const s of STRATS) { const st = stOf(t, s.id); if (s.enabled && st.status === 'watch') st.blockers = []; } t.ver++; }
  toast('Stratégie active', id === 'all' ? 'Toutes les stratégies' : stratById(id).name, 'g');
  markAll(); render(true);
}
function openTune() {
  const on = STRATS.filter((s) => s.enabled), one = on.length === 1 ? on[0] : null, box = $('stratCards');
  if (one) box.dataset.only = one.id; else delete box.dataset.only;
  PS.openPanel(one ? 'Paramètres · ' + one.name : 'Paramètres des stratégies', box, { onClose: () => { delete box.dataset.only; } });
}
function openTermSettings() { PS.openPanel('Réglages du terminal', $('p-settings')); }
$('stratTune').addEventListener('click', openTune);
$('stratSel').addEventListener('click', (e) => { const b = e.target.closest('[data-strat]'); if (b) pickStrat(b.dataset.strat); });
function buildViewSelect() {
  $('viewStrat').innerHTML = STRATS.map((s) => '<option value="' + s.id + '"' + (S.view === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
}

/* =========================================================================
   DONNÉES, EXPORTS
   ========================================================================= */
async function renderData() {
  const [nt, ntr, nc] = await Promise.all([IDB.count('tokens'), IDB.count('trades'), IDB.count('closed')]);
  let est = '';
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = fx(e.usage / 1048576, 1) + ' Mo utilisés'; } } catch (e) {}
  const st = (l, v, sub) => '<div class="stat"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  let migr = 0; S.devStats.forEach((d) => { migr += d.migrated; });
  $('dataStats').innerHTML = st('Tokens en base', nt, est) + st('Trades en base', ntr, cfg.recordTrades ? 'enregistrement actif' : 'enregistrement coupé') +
    st('Trades papier en base', nc) + st('Tokens reçus (session)', S.totalTokens) + st('Trades reçus (session)', S.totalTrades) +
    st('Migrations vues', S.migrations) + st('Devs distincts', S.devStats.size, migr + ' tokens migrés au total');
  const p = S.perf;
  $('engineStats').innerHTML = st('Temps moyen par message', (p.n ? p.ms / p.n : 0).toFixed(3) + ' ms', 'depuis le démarrage') +
    st('Sur les 10 dernières s', (p.lastWinMs || 0).toFixed(3) + ' ms', (p.lastWinN || 0) + ' messages') +
    st('Rendu de l\'écran', p.render.toFixed(1) + ' ms', 'dernier rafraîchissement') +
    st('Tokens en mémoire', S.tokens.size, 'max 2 500') + st('Métadonnées en attente', metaQ.length, metaBusy + ' en cours') +
    st('Écritures en attente', IDB.pending(), 'écrites chaque seconde');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object');
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\n');
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/* =========================================================================
   MODE DÉMO — données simulées, rien n'est enregistré
   ========================================================================= */
function rnd(a, b) { return a + Math.random() * (b - a); }
function fakeAddr() { const c = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let s = ''; for (let i = 0; i < 44; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
const DEMO_NAMES = ['SIP', 'BREW', 'POUR', 'FOAMY', 'CHILL', 'MOON', 'TOAST', 'BRICK', 'SOCK', 'NOODLE', 'CAPY', 'SLOTH', 'CRAB', 'HAMSTR', 'BLOB', 'ATTAYA'];
const demoTok = new Map();
function startDemo() {
  disconnect();
  S.demo = true; resetSession();
  $('btnDemo').querySelector('span').textContent = 'Arrêter la démo';
  $('btnDemo').classList.add('on');
  setConn('demo', 'Démo — données simulées');
  toast('Mode démo', 'Tokens et trades simulés. Rien n\'est enregistré et les résultats ne veulent rien dire.', 'a');
  const devs = [fakeAddr(), fakeAddr(), fakeAddr()];
  S.demoTimers.push(setInterval(() => {
    const now = Date.now(), mint = fakeAddr() + 'pump';
    const serial = Math.random() < 0.15, dev = serial ? devs[Math.floor(Math.random() * devs.length)] : fakeAddr();
    const roll = Math.random(), profile = roll < 0.12 ? 'pump' : roll < 0.4 ? 'rug' : roll < 0.5 ? 'bundle' : 'dead';
    const devBuy = profile === 'rug' && Math.random() < 0.5 ? rnd(2, 5) : rnd(0, 1.2);
    const sym = DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)] + (Math.random() < 0.5 ? '' : Math.floor(rnd(1, 99)));
    const mc = 28 + devBuy * 2.5;
    demoTok.set(mint, { profile, dev, mc, born: now, rugAt: rnd(40, 160) * 1000, holders: [] });
    handleMsg({ txType: 'create', mint, name: sym + ' Coin', symbol: sym, traderPublicKey: dev, solAmount: devBuy, initialBuy: devBuy * 33e6, marketCapSol: mc, vSolInBondingCurve: 30 + devBuy }, now);
    const t = S.tokens.get(mint);
    if (t && Math.random() < 0.55) t.meta = { state: 'ok', twitter: 'https://x.com/' + sym.toLowerCase(), telegram: Math.random() < 0.6 ? 'https://t.me/' + sym.toLowerCase() : '', website: '' };
    if (profile === 'bundle') for (let i = 0; i < 6; i++) handleMsg({ txType: 'buy', mint, traderPublicKey: fakeAddr(), solAmount: rnd(0.8, 2), tokenAmount: rnd(2e7, 4e7), marketCapSol: (demoTok.get(mint).mc += 2) }, now);
  }, 1800));
  S.demoTimers.push(setInterval(() => {
    const now = Date.now();
    for (const [mint, d] of demoTok) {
      const age = now - d.born;
      if (age > 12 * 60000) { demoTok.delete(mint); continue; }
      const busy = d.profile === 'pump' ? 0.7 : d.profile === 'rug' ? 0.45 : d.profile === 'bundle' ? 0.3 : 0.06;
      if (Math.random() > busy) continue;
      let side = 'buy', amt = rnd(0.05, 1.2);
      let who = Math.random() < 0.3 && d.holders.length ? d.holders[Math.floor(Math.random() * d.holders.length)] : fakeAddr();
      if (d.profile === 'pump') side = Math.random() < (age < 240000 ? 0.28 : 0.6) ? 'sell' : 'buy';
      else if (d.profile === 'rug') {
        if (age > d.rugAt && !d.rugged) { d.rugged = true; who = d.dev; side = 'sell'; amt = rnd(3, 8); }
        else side = d.rugged ? (Math.random() < 0.75 ? 'sell' : 'buy') : (Math.random() < 0.3 ? 'sell' : 'buy');
      } else side = Math.random() < 0.5 ? 'sell' : 'buy';
      d.mc = Math.max(20, d.mc + amt * (side === 'buy' ? 1 : -1) * (d.mc / 30) * 0.9);
      if (side === 'buy' && who !== d.dev) d.holders.push(who);
      handleMsg({ txType: side, mint, traderPublicKey: who, solAmount: amt, tokenAmount: amt * 3e7 / (d.mc / 30), marketCapSol: d.mc, vSolInBondingCurve: 30 * Math.sqrt(d.mc / 28) }, now);
      if (d.mc > 380 && !d.migr) { d.migr = true; handleMsg({ txType: 'migrate', mint }, now); }
    }
  }, 250));
  markAll();
}
function stopDemo(silent) {
  S.demoTimers.forEach(clearInterval); S.demoTimers = []; demoTok.clear();
  S.demo = false; resetSession();
  $('btnDemo').querySelector('span').textContent = 'Démo';
  $('btnDemo').classList.remove('on');
  if (!S.wantConn) setConn('', 'Déconnecté');
  if (!silent) toast('Démo arrêtée', 'Les données simulées ont été effacées.', '');
  loadFromDb();
}
function resetSession() {
  S.tokens.clear(); feedRows.forEach((r) => r.tr.remove()); feedRows.clear();
  S.devStats.clear(); S.createTimes = []; S.tradeTimes = []; S.selected = null;
  STRATS.forEach((s) => { S.port[s.id].positions.clear(); S.port[s.id].closed = S.port[s.id].closed.filter((c) => !c.demo && !S.demo); });
  markAll();
}

/* =========================================================================
   ÉVÈNEMENTS (limités à la page du terminal)
   ========================================================================= */
function goPage(p) {
  S.page = p;
  ROOT.querySelectorAll('#pb-menu button').forEach((b) => b.classList.toggle('on', b.dataset.pb === p));
  ROOT.querySelectorAll('.pb-pg').forEach((x) => x.classList.toggle('on', x.id === 'pb-p-' + p));
  try { localStorage.setItem('pstudio_pb_page', p); } catch (e) {}
  if (p === 'data') renderData();
  markAll(); render(true);
}
function selectToken(m) { S.selected = m; for (const t of S.tokens.values()) t.ver++; markAll(); render(true); }
$('menu').addEventListener('click', (e) => { const b = e.target.closest('button[data-pb]'); if (!b) return; if (b.dataset.pb === 'settings') return openTermSettings(); goPage(b.dataset.pb); });
$('btnConn').addEventListener('click', async () => {
  if (S.wantConn) { if (await confirmBox('Déconnecter le terminal ?', 'Il arrête de recevoir les tokens et les trades. Les positions papier ouvertes ne seront plus mises à jour.', 'Déconnecter')) disconnect(); }
  else connect();
});
$('btnDemo').addEventListener('click', async () => {
  if (S.demo) { stopDemo(); return; }
  if (S.wantConn && !(await confirmBox('Lancer la démo ?', 'Le terminal se déconnecte du flux PumpPortal pendant la démo.', 'Lancer la démo'))) return;
  startDemo();
});
$('viewStrat').addEventListener('change', (e) => { S.view = e.target.value; try { localStorage.setItem('pstudio_pb_view', S.view); } catch (x) {} for (const t of S.tokens.values()) t.ver++; markAll(); render(true); });
$('feedFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  S.feedFilter = b.dataset.f;
  ROOT.querySelectorAll('#pb-feedFilter .chip').forEach((x) => x.classList.toggle('on', x === b));
  S.dirty.feed = true; render(true);
});
$('search').addEventListener('input', (e) => { S.search = e.target.value; S.dirty.feed = true; render(true); });
$('jStrat').addEventListener('change', (e) => { S.jStrat = e.target.value; S.jReason = 'all'; S.dirty.journal = true; render(true); });
$('jReason').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; S.jReason = b.dataset.r; S.dirty.journal = true; render(true); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.selected && ROOT.classList.contains('active') && !document.querySelector('.modal.open')) selectToken(null); });

const rootClick = async (e) => {
  const x = e.target.closest('[data-pbx]');
  if (x) {
    e.preventDefault();
    if (x.dataset.pbx === 'close') selectToken(null);
    else if (x.dataset.pbx === 'trade' && S.selected && PS.openTrade) PS.openTrade(S.selected);
    return;
  }
  const c = e.target.closest('[data-close]');
  if (c) {
    e.stopPropagation();
    const [sid, mint] = c.dataset.close.split('|'), s = stratById(sid), p = S.port[sid].positions.get(mint), t = S.tokens.get(mint);
    if (!p || !t) return;
    sell(p, s, p.remaining, t.mc, 'Fermeture manuelle', Date.now());
    render(true);
    return;
  }
  const act = e.target.closest('[data-fact]');
  if (act) { const fs = act.closest('fieldset'); if (act.dataset.fact === 'save') saveFieldset(fs); else resetFieldset(fs); render(true); return; }
  const sact = e.target.closest('[data-sact]');
  if (sact && sact.tagName === 'BUTTON') {
    const card = sact.closest('[data-sid]'), s = stratById(card.dataset.sid);
    if (sact.dataset.sact === 'toggle') {
      if (await confirmBox((s.enabled ? 'Mettre en pause ' : 'Activer ') + s.name + ' ?', s.enabled ? 'Elle n\'ouvrira plus de nouvelles positions. Les positions ouvertes continuent d\'être gérées.' : 'Elle recommencera à ouvrir des positions.', s.enabled ? 'Mettre en pause' : 'Activer')) {
        s.enabled = !s.enabled; saveStrats(); buildStratCards(); buildStratSel(); toast(s.name, s.enabled ? 'Stratégie activée' : 'Stratégie en pause', s.enabled ? 'g' : 'a'); markAll();
      }
    } else if (sact.dataset.sact === 'applyPreset') {
      const key = card.querySelector('select[data-sact="preset"]').value;
      if (await confirmBox('Appliquer le modèle ' + PRESET_NAMES[key] + ' ?', 'Tous les réglages de ' + s.name + ' seront remplacés. Le portefeuille et l\'historique sont conservés.', 'Appliquer')) {
        s.P = Object.assign({}, PRESETS[key]); saveStrats(); buildStratCards(); toast(s.name, 'Modèle ' + PRESET_NAMES[key] + ' appliqué', 'g'); for (const t of S.tokens.values()) t.ver++; markAll();
      }
    } else if (sact.dataset.sact === 'resetPort') {
      if (await confirmBox('Réinitialiser le portefeuille de ' + s.name + ' ?', 'Les positions ouvertes et l\'historique de cette stratégie seront effacés de l\'écran et de la base. C\'est définitif.', 'Réinitialiser', true)) {
        S.port[s.id].positions.clear(); const ids = S.port[s.id].closed.map((c) => c.id); S.port[s.id].closed = [];
        if (IDB.db) { try { const tx = IDB.db.transaction('closed', 'readwrite'); ids.forEach((id) => tx.objectStore('closed').delete(id)); } catch (er) {} }
        toast(s.name, 'Portefeuille réinitialisé', 'a'); markAll();
      }
    }
    render(true); return;
  }
  const row = e.target.closest('tbody tr[data-mint]');
  if (row && S.tokens.has(row.dataset.mint)) selectToken(row.dataset.mint);
};
ROOT.addEventListener('click', rootClick);
ROOT.addEventListener('input', onFormInput);
ROOT.addEventListener('change', onFormInput);
// les blocs du terminal ouverts en panneau restent actifs dans la fenêtre
const inPanel = (e) => e.target.closest && e.target.closest('#modal #pb-stratCards, #modal #pb-p-settings');
document.getElementById('modal').addEventListener('click', (e) => { if (inPanel(e)) rootClick(e); });
document.getElementById('modal').addEventListener('input', (e) => { if (inPanel(e)) onFormInput(e); });
document.getElementById('modal').addEventListener('change', (e) => { if (inPanel(e)) onFormInput(e); });

$('expTokens').addEventListener('click', async () => { const r = await IDB.all('tokens'); if (!r.length) return toast('Rien à exporter', 'Aucun token en base.', 'a'); download('tokenstudio-tokens-' + stamp() + '.csv', toCSV(r), 'text/csv'); toast('Export prêt', r.length + ' tokens', 'g'); });
$('expTrades').addEventListener('click', async () => { const r = await IDB.all('trades'); if (!r.length) return toast('Rien à exporter', 'Aucun trade en base.', 'a'); download('tokenstudio-trades-' + stamp() + '.json', JSON.stringify(r), 'application/json'); toast('Export prêt', r.length + ' trades', 'g'); });
$('expJournal').addEventListener('click', () => { const r = allClosed().filter((c) => !c.demo); if (!r.length) return toast('Rien à exporter', 'Aucun trade papier fermé.', 'a'); download('tokenstudio-journal-' + stamp() + '.csv', toCSV(r), 'text/csv'); toast('Export prêt', r.length + ' trades', 'g'); });
$('wipe').addEventListener('click', async () => {
  if (!(await confirmBox('Effacer toutes les données ?', 'Tokens, trades bruts et journaux des stratégies seront supprimés de ce navigateur. Exporte-les avant si tu veux les garder.', 'Tout effacer', true))) return;
  await IDB.clear();
  STRATS.forEach((s) => { S.port[s.id].closed = S.port[s.id].closed.filter((c) => c.demo); });
  S.devStats.clear(); for (const t of S.tokens.values()) devStat(t.creator).n++;
  toast('Données effacées', '', 'a'); renderData(); markAll();
});

/* =========================================================================
   BOUCLE DE RENDU ET DÉMARRAGE
   ========================================================================= */
function render(force) {
  if (!force && !visible()) return;
  if (!ROOT.classList.contains('active')) return;
  const t0 = performance.now(), now = Date.now(), d = S.dirty;
  if (d.header) { renderHeader(); d.header = false; }
  if (S.page === 'live' && d.feed) { renderFeed(now); d.feed = false; }
  if (S.page === 'positions' && d.pos) { renderPositions(now); d.pos = false; }
  if (S.page === 'journal' && d.journal) { renderJournal(); d.journal = false; }
  if (S.page === 'strategies' && d.strat) { renderStratCompare(); d.strat = false; }
  if (d.detail) { renderDetail(now); d.detail = false; }
  S.perf.render = performance.now() - t0;
}
async function loadFromDb() {
  S.devStats.clear();
  await IDB.each('tokens', (t) => { if (!t.creator) return; const d = devStat(t.creator); d.n++; if (t.migrated) d.migrated++; if (t.devSoldFast) d.fastSell++; });
  const closed = await IDB.all('closed');
  STRATS.forEach((s) => { S.port[s.id].closed = []; });
  closed.filter((c) => !c.demo).sort((a, b) => a.closedAt - b.closedAt).forEach((c) => {
    if (!c.sid || !S.port[c.sid]) return;               // stratégies retirées
    const sid = c.sid; if (c.score == null) c.score = c.scoreAtEntry;
    S.port[sid].closed.push(c);
  });
  markAll();
}
// API pour le studio (page, palette de commandes)
window.addEventListener('pstudio-theme', () => { syncThemeColors(); markAll(); render(true); });
syncThemeColors();
window.PumpBotUI = {
  show() { markAll(); render(true); if (S.page === 'data') renderData(); },
  running: () => S.wantConn || S.demo,
  toggle() { if (S.wantConn) disconnect(); else connect(); },
  stats: () => ({ tokens: S.tokens.size, positions: allPositions().length, closed: allClosed().length }),
  // sauvegarde sur le compte : stratégies et trades fermés (hors démo)
  data: () => ({
    strategies: STRATS.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, P: s.P })),
    closed: allClosed().filter((c) => !c.demo),
  }),
  summary: () => ({
    running: S.wantConn || S.demo, connected: S.connected, demo: S.demo, rate: S.createTimes.length, migrations: S.migrations, watched: countWatched(),
    strats: STRATS.map((s) => {
      const cl = S.port[s.id].closed, st = statsOf(cl, s.P.startBal); let u = 0, b = s.P.startBal; S.port[s.id].positions.forEach((p) => { u += unrealized(p); });
      const eq = [b]; cl.forEach((c) => { b += c.pnl; eq.push(b); });
      return { id: s.id, name: s.name, color: s.color, enabled: s.enabled, start: s.P.startBal, bal: balance(s), realized: realized(s), unreal: u, open: S.port[s.id].positions.size, n: cl.length, winrate: st.winrate, eq: eq.slice(-80) };
    }),
    recent: allClosed().slice(-6).reverse().map((c) => ({ sym: c.symbol, sid: c.sid, pnl: c.pnl, pnlPct: c.pnlPct, why: c.why, t: c.closedAt })),
  }),
};
(async function init() {
  buildViewSelect(); buildSettings(); buildStratCards(); buildStratSel();
  setConn('', 'Déconnecté');
  delete cfg.apiKey; saveCfg();
  try { const p = localStorage.getItem('pstudio_pb_page'); if (p && p !== 'settings' && $('p-' + p)) goPage(p); } catch (e) {}
  await IDB.open();
  await loadFromDb();
  setInterval(tick, 1000);
  setInterval(() => render(false), 400);
  setInterval(() => { if (S.page === 'data' && visible()) renderData(); }, 3000);
  window.addEventListener('beforeunload', () => IDB.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) IDB.flush(); });
  render(true);
})();
})();
