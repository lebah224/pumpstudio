/* eslint-disable */
// Studio historique (lancement, trading, ordres, journal, tableau de bord), migré tel quel.
/* █████████████████████████████████████████████████████████████████████
   PUMPSTUDIO — lancement et suivi de token pump.fun
   • Le wallet (Phantom, Solflare, Backpack) signe tout : la clé privée ne
     quitte jamais le wallet, le studio ne la voit jamais.
   • Transactions construites par PumpPortal (API « locale »), vérifiées par
     simulation sur la blockchain avant toute signature.
   • Mode simulation par défaut : rien n'est envoyé tant qu'il est actif.
   • Données lues directement sur Solana (courbe de liaison, détenteurs,
     transactions) via le RPC configuré.
   █████████████████████████████████████████████████████████████████████ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const W3 = () => window.solanaWeb3;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
  const fr = (x, d) => x == null || !isFinite(x) ? '—' : x.toLocaleString('fr-FR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const fSol = (x, d) => x == null || !isFinite(x) ? '—' : fr(x, d == null ? (Math.abs(x) >= 10 ? 2 : 4) : d) + ' SOL';
  const fUsd = (x) => x == null || !isFinite(x) ? '—' : (Math.abs(x) >= 1e6 ? fr(x / 1e6, 2) + ' M$' : Math.abs(x) >= 1e4 ? fr(x / 1e3, 1) + ' k$' : fr(x, 2) + ' $');
  // Montant en SOL avec son équivalent en dollars : le dollar est ajouté à côté par usdPaint (attribut data-usd),
  // et suit le prix du SOL sans redessiner la page. Pour du texte brut (notifications, titres), fSol reste sans balise.
  const fSolH = (x, d) => x == null || !isFinite(x) ? '—' : '<span class="sol" data-sol="' + (+x) + '">' + fSol(x, d) + '</span>';
  const fUsdS = (v) => !isFinite(v) ? '' : v !== 0 && Math.abs(v) < 0.01 ? (v < 0 ? '−' : '') + '< 0,01 $' : fUsd(v);
  const fTok = (x) => x == null || !isFinite(x) ? '—' : Math.abs(x) >= 1e6 ? fr(x / 1e6, 2) + ' M' : Math.abs(x) >= 1e3 ? fr(x / 1e3, 1) + ' k' : fr(x, 2);
  const fPct = (x, d) => x == null || !isFinite(x) ? '—' : fr(x, d == null ? 1 : d) + ' %';
  const fPrice = (x) => x == null || !isFinite(x) || x <= 0 ? '—' : x >= 0.01 ? fr(x, 4) : x.toLocaleString('fr-FR', { maximumSignificantDigits: 4, maximumFractionDigits: 20 });
  const short = (a, n) => a ? a.slice(0, n || 4) + '…' + a.slice(-(n || 4)) : '—';
  const fT = (t) => t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const fAgo = (t) => { if (!t) return '—'; const s = (Date.now() - t) / 1000; return s < 60 ? Math.round(s) + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' j'; };
  const cls = (x) => x > 0 ? 'pos' : x < 0 ? 'neg' : '';
  const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  /* ================================================================ constantes pump.fun */
  const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';
  // Plateforme de lancement (pump.fun : programme direct ou PumpPortal)
  const PLATFORMS = {
    pump: { n: 'pump.fun', tag: 'Courbe pump.fun · migration PumpSwap', d: 'La référence des memecoins Solana : le plus de trafic, moteur direct sans intermédiaire.', url: (m) => 'https://pump.fun/coin/' + m, fee: 0.02 },
  };
  const WSOL_MINT = 'So11111111111111111111111111111111111111112';
  const INIT_CURVE = { vSol: 30e9, vTok: 1.073e15, realTok: 7.931e14, realSol: 0, supply: 1e15, complete: false };
  const INIT_REAL_TOK = 7.931e14;
  const FAMOUS = ['DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'POPCAT', 'MEW', 'BOME', 'SLERF', 'PNUT', 'GOAT', 'MOODENG', 'FARTCOIN', 'BRETT', 'MOG', 'TURBO', 'NEIRO', 'CHILLGUY', 'SOL', 'BTC', 'ETH', 'USDC', 'USDT', 'TRUMP', 'MELANIA'];

  /* ================================================================ réglages */
  const DEF = { engine: 'direct', speed: 'fast', maxPriority: 0.003, rpc: '', metaMethod: 'pump', pinataJwt: '', slippage: 15, priorityFee: 0.0005, maxSol: 1, feePct: 1.25, portalFeePct: 0.5, devMaxPct: 10, sim: true, notify: true, sound: true, pollSec: 10, ppLive: true, sender: 'swqos', useSess: false, autoExec: true, slSlippage: 30, autoRetry: 2 };
  const LS = { cfg: 'pstudio_cfg_v1', draft: 'pstudio_draft_v1', tokens: 'pstudio_tokens_v1', journal: 'pstudio_journal_v1', orders: 'pstudio_orders_v1', wallet: 'pstudio_wallet_v1', sess: 'pstudio_sess_v1' };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  // Réglages appliqués depuis le compte (synchronisation) : on ne les renvoie pas au serveur
  let REMOTE_APPLY = false;
  // Où vivent les données :
  // - réel (compte connecté) : uniquement dans la base de données. Le studio les garde en mémoire (REAL) et chaque
  //   écriture part vers le compte (CLOUD, branché par l'application) ; rien n'est copié dans le navigateur ;
  // - démo : dans le navigateur, sous des clés « démo », jamais envoyées au compte ;
  // - invité : seul le brouillon reste dans le navigateur (il n'y a pas de compte où l'enregistrer).
  const DEMO_KEYS = { pstudio_tokens_v1: 'pstudio_demo_tokens_v1', pstudio_orders_v1: 'pstudio_demo_orders_v1', pstudio_journal_v1: 'pstudio_demo_journal_v1', pstudio_dist_v1: 'pstudio_demo_dist_v1' };
  const REAL_KIND = { pstudio_tokens_v1: 'tokens', pstudio_orders_v1: 'orders', pstudio_journal_v1: 'journal', pstudio_dist_v1: 'dist' };
  const REAL = { tokens: [], journal: [], orders: [], dist: {} };
  let CLOUD = null;   // { write(kind, value) } quand un compte est connecté
  const dk = (k) => (cfg.sim && DEMO_KEYS[k]) || k;
  const save = (k0, v) => {
    if (cfg.sim && DEMO_KEYS[k0]) { try { localStorage.setItem(DEMO_KEYS[k0], JSON.stringify(v)); } catch (e) {} return; }
    if (REAL_KIND[k0]) { REAL[REAL_KIND[k0]] = v; if (CLOUD && !REMOTE_APPLY) CLOUD.write(REAL_KIND[k0], v); return; }
    if (k0 === LS.draft && CLOUD) { if (!REMOTE_APPLY) CLOUD.write('draft', v); return; }
    // réglages : ceux du compte quand il est connecté (clés API chiffrées sur le serveur), sinon ceux de l'invité
    if (k0 === LS.cfg && CLOUD) { if (!REMOTE_APPLY) { CLOUD.write('cfg', cfgForAccount()); try { window.dispatchEvent(new CustomEvent('pstudio-cfg', { detail: { cfg: v } })); } catch (e) {} } return; }
    try { localStorage.setItem(k0, JSON.stringify(v)); } catch (e) { if (k0 === LS.draft) { try { localStorage.setItem(k0, JSON.stringify(Object.assign({}, v, { image: null }))); } catch (e2) {} } }
    if (k0 === LS.cfg && !REMOTE_APPLY) { try { window.dispatchEvent(new CustomEvent('pstudio-cfg', { detail: { cfg: v } })); } catch (e) {} }
  };
  const cfg = Object.assign({}, DEF, load(LS.cfg, {}));
  // un seul wallet rapide : celui du compte, sur le serveur. L'ancien wallet rapide du navigateur ne signe plus
  // (il reste seulement le temps d'en transférer les fonds vers le compte).
  cfg.useSess = false;
  // réglages enregistrés sur le compte : tout sauf le mode (colonne des préférences) et l'ancien wallet rapide
  const CFG_LOCAL_ONLY = ['sim', 'useSess', 'quickOff'];
  function cfgForAccount() { const o = {}; Object.keys(cfg).forEach((k) => { if (!CFG_LOCAL_ONLY.includes(k)) o[k] = cfg[k]; }); return o; }
  // brouillon vide (nouveau compte, déconnexion)
  function draftDefaults() { return { name: '', symbol: '', desc: '', tw: '', tg: '', web: '', dev: 0.1, image: null, imgSrc: '', theme: 'meme', tone: 'luxe', lang: 'en', word: '', logo: { style: 'meme', pal: 0, emoji: '', text: '', seed: 7 }, platform: 'pump', tpOn: true, tp: [{ x: 2, pct: 25 }, { x: 3, pct: 25 }, { x: 5, pct: 25 }], sl: 0 }; }
  const S = {
    page: 'dash', step: 1, ext: null, extBal: null, bal: null, solUsd: null, rpcOk: null,
    draft: Object.assign(draftDefaults(), load(LS.draft, {})),
    tokens: cfg.sim ? load(dk(LS.tokens), []) : REAL.tokens, journal: cfg.sim ? load(dk(LS.journal), []) : REAL.journal, orders: cfg.sim ? load(dk(LS.orders), []) : REAL.orders,
    ideas: [], cache: {}, view: { mine: null, trade: null }, side: { mine: 'buy', trade: 'buy' }, jf: 'real', busy: false, imgBlob: null,
  };
  const saveDraft = () => save(LS.draft, S.draft);
  // plateforme d'un token : celle du lancement pour les tokens du studio, sinon déduite du marché lu
  function platOf(mint) { const t = S.tokens.find((x) => x.mint === mint); if (t && t.platform) return t.platform; const C = S.cache[mint]; return C && C.curve && C.curve.ext ? null : 'pump'; }
  // Deux wallets possibles : le wallet externe (Phantom…) et le wallet rapide du studio.
  // S.wallet désigne toujours celui qui signe : le wallet rapide quand il est choisi, sinon l'externe.
  let SESSREC = load(LS.sess, null);
  const SESSW = { id: 'session', name: 'Wallet rapide', pk: null, kp: null, prov: null };
  // Wallet rapide serveur : sa clé reste sur le serveur, qui signe selon sa politique (trading seulement, plafonds)
  const SRVW = { id: 'server', name: 'Wallet rapide', pk: null, prov: null };
  let SRVPK = null;
  Object.defineProperty(S, 'wallet', {
    get() {
      if (cfg.useSrv && SRVPK && window.TSServerWallet) { SRVW.pk = SRVPK; return SRVW; }
      if (cfg.useSess && SESSREC) { SESSW.pk = SESSREC.pk; return SESSW; } return S.ext;
    },
    set(v) { S.ext = v; }, enumerable: true,
  });
  // brouillons des versions précédentes : univers, ton et style de logo d'avant
  (function migrate() { const d = S.draft; d.platform = 'pump'; d.theme = ({ prestige: 'luxe', myth: 'gaming', ocean: 'meme', food: 'meme', nature: 'meme', brand: 'tech' })[d.theme] || (['meme', 'internet', 'luxe', 'space', 'tech', 'gaming'].includes(d.theme) ? d.theme : 'meme'); if (!['luxe', 'minimal', 'witty', 'community'].includes(d.tone)) d.tone = 'luxe'; if (!['en', 'fr'].includes(d.lang)) d.lang = 'en'; if (!['meme', 'illus', 'mono', 'coin', 'orb', 'shield', 'hex', 'seal', 'glass', 'geo', 'word', 'mascot'].includes(d.logo.style)) { d.logo.style = 'mono'; d.logo.pal = 0; } })();

  /* ================================================================ outils binaires */
  function b64ToBytes(b64) { const s = atob(b64), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function validMint(s) { try { const p = new (W3().PublicKey)(s.trim()); return p.toBase58(); } catch (e) { return null; } }

  /* ================================================================ toasts, modales */
  function toast(title, text, kind) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || '');
    el.innerHTML = '<b>' + esc(title) + '</b>' + esc(text || '');
    $('toasts').appendChild(el); while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => el.remove(), 6000);
  }
  let modalResolve = null;
  // Panneau : affiche un bloc existant de la page dans la fenêtre (comme « Personnaliser »), puis le remet en place à la fermeture
  const PANEL = { cur: null, susp: null };
  function panelRestore() { const c = PANEL.cur; if (!c) return; PANEL.cur = null; try { c.ph.replaceWith(c.node); } catch (e) {} if (c.onClose) { try { c.onClose(); } catch (e) {} } }
  function openPanel(title, node, opts) {
    if (!node) return; opts = opts || {};
    panelRestore();
    const ph = document.createComment('panneau'), p = modal(title, opts.intro || '', [{ label: 'Fermer', cls: 'primary' }], true);
    node.replaceWith(ph); $('mBody').appendChild(node); $('mBox').classList.add('panel');
    PANEL.cur = { node, ph, onClose: opts.onClose, reopen: () => openPanel(title, node, opts) };
    if (opts.onOpen) { try { opts.onOpen(); } catch (e) {} }
    p.then(() => { if (PANEL.cur && PANEL.cur.node === node) panelRestore(); });
  }
  function modal(title, html, buttons, wide) {
    if (PANEL.cur) { PANEL.susp = PANEL.cur.reopen; panelRestore(); }  // une confirmation demandée depuis un panneau : on rouvre le panneau après
    $('mTitle').textContent = title; $('mBody').innerHTML = html; $('mBox').className = 'box' + (wide ? ' wide' : '');
    $('mRow').innerHTML = (buttons || []).map((b, i) => '<button class="btn ' + (b.cls || '') + '" data-mb="' + i + '" type="button">' + esc(b.label) + '</button>').join('');
    $('modal').classList.add('open');
    return new Promise((res) => { modalResolve = (i) => { modalResolve = null; res(i); if (PANEL.susp && !PANEL.cur) { const r = PANEL.susp; PANEL.susp = null; setTimeout(r, 40); } }; $('mRow').onclick = (e) => { const b = e.target.closest('[data-mb]'); if (!b) return; const i = +b.dataset.mb; if (!buttons[i].keep) closeModal(); if (modalResolve) modalResolve(i); }; });
  }
  function closeModal() { $('modal').classList.remove('open'); if (PANEL.cur) panelRestore(); }
  const confirmBox = (title, html, ok, danger) => modal(title, html, [{ label: 'Annuler' }, { label: ok || 'Confirmer', cls: danger ? 'danger' : 'primary' }], true).then((i) => i === 1);
  // En réel, chaque action importante propose aussi « Tester » (« Tester avant de lancer » pour un lancement) : vérifiée sur la blockchain, jamais envoyée
  async function confirmTest(title, html, ok, danger, testLabel) {
    if (cfg.sim) return (await modal(title, html, [{ label: 'Annuler' }, { label: ok, cls: 'primary' }], true)) === 1 ? 'demo' : null;
    const i = await modal(title, html, [{ label: 'Annuler' }, { label: testLabel || 'Tester' }, { label: ok, cls: danger ? 'danger' : 'primary' }], true);
    return i === 2 ? 'real' : i === 1 ? 'test' : null;
  }
  const dryNote = (how) => how === 'test' ? '<div class="notice info">Test réussi : la transaction passerait. Rien n\'a été envoyé ; relancez pour l\'exécuter.</div>' : '<div class="notice info">Démo réussie : l\'opération est vérifiée sur la blockchain et passerait en réel. Rien n\'a été envoyé.</div>';

  /* ================================================================ RPC Solana */
  let rpcId = 0;
  // RPC du compte (relais TokenStudio) quand un compte est connecté et qu'aucune clé personnelle n'est réglée.
  // En cas de panne du relais, retour au RPC direct pendant une minute.
  let RELAY_DOWN = 0;
  const relay = () => (!cfg.rpc && window.TSRelay && Date.now() > RELAY_DOWN ? window.TSRelay : null);
  const rpcKind = () => (cfg.rpc ? 'privé' : relay() ? 'TokenStudio' : 'public');
  async function rpcPost(body) {
    const R = relay();
    if (R) {
      try {
        const h = await R.headers();
        if (h) {
          const r = await fetch(R.url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body });
          if (r.ok || r.status === 400 || r.status === 403 || r.status === 429) return r;
        }
      } catch (e) {}
      RELAY_DOWN = Date.now() + 60000;
    }
    return fetch(cfg.rpc || PUBLIC_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  }
  window.addEventListener('ts-relay', () => { RELAY_DOWN = 0; S.rpcOk = null; testRpc(true); renderTop(); });
  async function rpc(method, params) {
    let r;
    try { r = await rpcPost(JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })); }
    catch (e) { setRpc(false); throw new Error(cfg.rpc ? 'RPC injoignable : vérifiez l\'adresse dans Réglages.' : 'Le RPC public de Solana bloque cette page. Ajoutez votre clé Helius gratuite dans Réglages (helius.dev).'); }
    if ((r.status === 429 || r.status === 403) && r.url.includes('/functions/v1/')) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'RPC TokenStudio : requête refusée.'); }
    if (r.status === 429 || r.status === 403) { setRpc(false); throw new Error(cfg.rpc ? 'Votre RPC refuse ou limite les requêtes (' + r.status + '). Vérifiez votre clé Helius.' : 'Le RPC public de Solana refuse les requêtes de cette page (' + r.status + '). Ajoutez votre clé Helius gratuite dans Réglages.'); }
    if (!r.ok) { setRpc(false); throw new Error('RPC : erreur ' + r.status); }
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'Erreur RPC');
    setRpc(true);
    return j.result;
  }
  function setRpc(ok) { if (S.rpcOk === ok) return; S.rpcOk = ok; renderTop(); }

  async function solPrice() {
    const prev = S.solUsd;
    try { const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT'); const j = await r.json(); if (+j.price > 0) S.solUsd = +j.price; } catch (e) {}
    if (!S.solUsd || S.solUsd === prev) { try { const r = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot'); const j = await r.json(); if (+j.data.amount > 0) S.solUsd = +j.data.amount; } catch (e) {} }
    if (S.solUsd !== prev) usdPaintAll();
  }

  /* ================================================================ équivalent en dollars des montants en SOL */
  // Tout élément [data-sol] (studio ou écrans React) reçoit data-usd, affiché à côté par le CSS (.sol::after).
  function usdPaint(el) {
    const x = +el.getAttribute('data-sol');
    const v = S.solUsd && isFinite(x) ? '≈ ' + fUsdS(x * S.solUsd) : '';
    if (v) { if (el.getAttribute('data-usd') !== v) el.setAttribute('data-usd', v); } else if (el.hasAttribute('data-usd')) el.removeAttribute('data-usd');
  }
  function usdPaintAll(root) { (root || document).querySelectorAll('[data-sol]').forEach(usdPaint); }
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'attributes') { usdPaint(m.target); continue; }
      m.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; if (n.hasAttribute('data-sol')) usdPaint(n); if (n.firstElementChild) usdPaintAll(n); });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sol'] });

  /* ================================================================ courbe de liaison */
  function curvePda(mint) {
    const { PublicKey } = W3();
    return PublicKey.findProgramAddressSync([new TextEncoder().encode('bonding-curve'), new PublicKey(mint).toBytes()], new PublicKey(PUMP_PROGRAM))[0].toBase58();
  }
  async function readCurve(mint) {
    const pda = curvePda(mint);
    const r = await rpc('getAccountInfo', [pda, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!r || !r.value) return { pda, exists: false };
    return parseCurve(pda, b64ToBytes(r.value.data[0]));
  }
  function parseCurve(pda, bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 49) return { pda, exists: false };
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), u = (o) => Number(dv.getBigUint64(o, true));
    const c = { pda, exists: true, vTok: u(8), vSol: u(16), realTok: u(24), realSol: u(32), supply: u(40), complete: b[48] === 1 };
    if (b.length >= 81) { try { c.creator = new (W3().PublicKey)(b.slice(49, 81)).toBase58(); } catch (e) {} }
    return c;
  }
  function curveStats(c) {
    if (!c || !c.exists && !c.vSol) return null;
    const price = (c.vSol / 1e9) / (c.vTok / 1e6), supplyTok = (c.supply || 1e15) / 1e6;
    const progress = c.complete ? 100 : clamp((1 - c.realTok / INIT_REAL_TOK) * 100, 0, 100);
    return { price, mcapSol: price * supplyTok, mcapUsd: S.solUsd ? price * supplyTok * S.solUsd : null, progress, realSol: c.realSol / 1e9, supplyTok };
  }
  const feeRate = () => (cfg.feePct + (cfg.engine === 'portal' ? cfg.portalFeePct : 0)) / 100;
  function quoteBuy(c, sol) {
    if (!(sol > 0)) return null;
    const net = sol * (1 - feeRate()) * 1e9, k = c.vSol * c.vTok, nS = c.vSol + net, nT = k / nS;
    let out = Math.min(c.vTok - nT, c.realTok);
    const tokens = out / 1e6, p0 = (c.vSol / 1e9) / (c.vTok / 1e6), p1 = (nS / 1e9) / (nT / 1e6);
    return { sol, tokens, minOut: tokens * (1 - cfg.slippage / 100), impact: (p1 / p0 - 1) * 100, avg: sol / tokens, supplyPct: out / (c.supply || 1e15) * 100, fees: sol * feeRate(), priceAfter: p1, mcapAfterSol: p1 * (c.supply || 1e15) / 1e6 };
  }
  function quoteSell(c, tokens) {
    if (!(tokens > 0)) return null;
    const raw = tokens * 1e6, k = c.vSol * c.vTok, nT = c.vTok + raw, nS = k / nT;
    const gross = (c.vSol - nS) / 1e9, sol = gross * (1 - feeRate());
    const p0 = (c.vSol / 1e9) / (c.vTok / 1e6), p1 = (nS / 1e9) / (nT / 1e6);
    return { tokens, sol, minOut: sol * (1 - cfg.slippage / 100), impact: (p1 / p0 - 1) * 100, fees: gross * feeRate(), avg: sol / tokens };
  }

  /* ================================================================ données d'un token */
  async function tokenMeta(mint) {
    const mine = S.tokens.find((t) => t.mint === mint);
    if (mine) return { name: mine.name, symbol: mine.symbol, image: mine.image };
    try {
      const a = await rpc('getAsset', { id: mint });
      if (a && a.content) return { name: (a.content.metadata || {}).name || '', symbol: (a.content.metadata || {}).symbol || '', image: (a.content.links || {}).image || (a.content.files && a.content.files[0] && a.content.files[0].uri) || '' };
    } catch (e) {}
    return { name: '', symbol: '', image: '' };
  }
  async function holders(mint, c) {
    const lg = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
    const list = (lg && lg.value || []).slice(0, 20);
    if (!list.length) return [];
    const acc = await rpc('getMultipleAccounts', [list.map((x) => x.address), { encoding: 'jsonParsed' }]);
    const sup = (c && c.supply || 1e15) / 1e6;
    return list.map((x, i) => {
      const a = acc && acc.value && acc.value[i], owner = a && a.data && a.data.parsed && a.data.parsed.info && a.data.parsed.info.owner;
      const amt = +x.uiAmount || (+x.amount / 1e6);
      let label = '';
      if (owner && c && owner === c.pda) label = 'Courbe de liaison'; else if (owner && c && owner === c.creator) label = 'Créateur'; else if (S.wallet && owner === S.wallet.pk) label = 'Vous';
      return { owner: owner || x.address, amount: amt, pct: amt / sup * 100, label };
    });
  }
  async function tokenBalance(owner, mint) {
    const r = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    return (r && r.value || []).reduce((s, a) => s + (+(((a.account.data.parsed || {}).info || {}).tokenAmount || {}).uiAmount || 0), 0);
  }
  function parseTrade(tx, mint, sig) {
    if (!tx || !tx.meta || tx.meta.err) return null;
    const keys = tx.transaction.message.accountKeys.map((k) => typeof k === 'string' ? k : k.pubkey);
    const signer = keys[0];
    const amt = (arr) => (arr || []).filter((b) => b.mint === mint && b.owner === signer).reduce((s, b) => s + (+b.uiTokenAmount.uiAmount || 0), 0);
    const dTok = amt(tx.meta.postTokenBalances) - amt(tx.meta.preTokenBalances);
    if (!dTok) return null;
    const dSol = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / 1e9;
    return { sig, t: (tx.blockTime || 0) * 1000, wallet: signer, side: dTok > 0 ? 'buy' : 'sell', tokens: Math.abs(dTok), sol: Math.abs(dSol), price: Math.abs(dSol) / Math.abs(dTok) };
  }
  async function trades(mint, c, cache) {
    const sigs = await rpc('getSignaturesForAddress', [c.pda, { limit: 30, commitment: 'confirmed' }]);
    const known = new Set(cache.map((x) => x.sig)), fresh = (sigs || []).filter((s) => !s.err && !known.has(s.signature) && !(cache.skip || []).includes(s.signature)).map((s) => s.signature);
    cache.skip = cache.skip || [];
    for (let i = 0; i < fresh.length; i += 4) {
      const part = fresh.slice(i, i + 4);
      const txs = await Promise.all(part.map((s) => rpc('getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null)));
      txs.forEach((tx, j) => { const tr = parseTrade(tx, mint, part[j]); if (tr) cache.push(tr); else cache.skip.push(part[j]); });
    }
    cache.sort((a, b) => b.t - a.t);
    if (cache.length > 300) cache.length = 300;
    return cache;
  }
  // Token hors pump.fun (Raydium, Meteora…) : prix et capitalisation lus sur DEX Screener (gratuit).
  // Il est traité comme un token « hors courbe » : pas de devis exact, achats et ventes routés par PumpPortal (pool auto).
  async function dexMarket(mint) {
    try {
      const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + mint); if (!r.ok) return null;
      const j = await r.json(), ps = (Array.isArray(j) ? j : []).filter((p) => p.baseToken && p.baseToken.address === mint);
      const liq = (p) => (p.liquidity || {}).usd || 0, sol = ps.filter((p) => p.quoteToken && p.quoteToken.address === WSOL_MINT).sort((a, b) => liq(b) - liq(a));
      const p = sol[0] || ps.sort((a, b) => liq(b) - liq(a))[0]; if (!p) return null;
      const price = p.quoteToken.address === WSOL_MINT ? +p.priceNative : (S.solUsd ? +p.priceUsd / S.solUsd : null);
      if (!(price > 0)) return null;
      const cap = +p.marketCap || +p.fdv || 0, supplyTok = cap && +p.priceUsd ? cap / +p.priceUsd : 1e9, realSol = p.quoteToken.address === WSOL_MINT ? +((p.liquidity || {}).quote || 0) : 0;
      return { curve: { pda: null, exists: true, ext: true, complete: true, dex: p.dexId || '', pair: p.pairAddress || '', supply: supplyTok * 1e6 },
        stats: { price, mcapSol: price * supplyTok, mcapUsd: S.solUsd ? price * supplyTok * S.solUsd : null, progress: p.dexId === 'launchlab' ? clamp(realSol / 85 * 100, 0, 100) : 100, realSol, supplyTok, liqUsd: liq(p) },  // Raydium LaunchLab : migration vers Raydium à ~85 SOL
        meta: { name: p.baseToken.name || '', symbol: p.baseToken.symbol || '', image: (p.info || {}).imageUrl || '' } };
    } catch (e) { return null; }
  }
  const DEX_NAMES = { launchlab: 'Raydium LaunchLab', raydium: 'Raydium', pumpswap: 'PumpSwap', meteora: 'Meteora', orca: 'Orca', moonshot: 'Moonshot' };
  const dexName = (c) => DEX_NAMES[c && c.dex] || (c && c.dex ? c.dex : 'DEX');
  async function loadToken(mint, full) {
    if (isDemoMint(mint)) { dmRun(); return dmLoad(mint); }
    const C = S.cache[mint] = S.cache[mint] || { trades: [], meta: null, holders: [], at: 0 };
    let c, X = null;
    try { c = await readCurve(mint); } catch (e) { if (!cfg.sim) throw e; c = { exists: false }; }   // démo sans RPC : prix lu sur DexScreener
    if (!c.exists) { X = await dexMarket(mint); if (X) c = X.curve; }
    C.curve = c; C.stats = X ? X.stats : c.exists ? curveStats(c) : null; C.at = Date.now(); C.error = null;
    if (!C.meta || (X && !C.meta.name)) { C.meta = await tokenMeta(mint); if (X && !C.meta.name) C.meta = Object.assign({}, X.meta, { image: C.meta.image || X.meta.image }); }
    if (c.exists && full) {
      if (!c.ext) try { await trades(mint, c, C.trades); } catch (e) { C.tradeErr = e.message; }
      if (!C.holdersAt || Date.now() - C.holdersAt > 45000) { try { C.holders = await holders(mint, c); C.holdersAt = Date.now(); } catch (e) { C.holdErr = e.message; } }
    }
    if (cfg.sim) C.myBal = DEMO.pos[mint] || 0;
    else if (S.wallet) { try { C.myBal = await tokenBalance(S.wallet.pk, mint); } catch (e) {} }
    return C;
  }

  /* ================================================================ analyse de risque */
  function risks(C) {
    const out = [], c = C.curve, st = C.stats;
    if (!c || !c.exists) return [{ lvl: 'r', t: 'Marché introuvable', d: 'Ni courbe pump.fun ni paire sur DEX Screener : l\'adresse est fausse, ou le token vient d\'être créé (il apparaît en général en moins d\'une minute).' }];
    if (c.ext) out.push({ lvl: 'b', t: 'Hors pump.fun · ' + dexName(c), d: 'Prix lu sur DEX Screener' + (C.stats && C.stats.liqUsd ? ' · liquidité ' + fUsd(C.stats.liqUsd) : '') + '. Les achats et ventes passent par PumpPortal (pool auto), sans devis exact.' });
    else if (c.complete) out.push({ lvl: 'b', t: 'Migré', d: 'La courbe est terminée : le token s\'échange maintenant sur PumpSwap. Les achats et ventes passent par le pool « auto ».' });
    else out.push({ lvl: st.progress > 60 ? 'g' : 'b', t: 'Courbe à ' + fPct(st.progress, 0), d: fSol(st.realSol, 2) + ' déjà dans la courbe.' });
    const H = C.holders || [], creator = H.find((h) => h.label === 'Créateur'), others = H.filter((h) => h.label !== 'Courbe de liaison');
    if (C.holdersAt) {
      const cp = creator ? creator.pct : 0;
      out.push(cp > 10 ? { lvl: 'r', t: 'Créateur : ' + fPct(cp), d: 'Le créateur détient une grosse part : il peut faire chuter le prix en vendant.' }
        : cp > 5 ? { lvl: 'a', t: 'Créateur : ' + fPct(cp), d: 'Part notable du créateur.' } : { lvl: 'g', t: 'Créateur : ' + fPct(cp), d: creator ? 'Part limitée.' : 'Le créateur n\'apparaît pas parmi les 20 plus gros détenteurs.' });
      const top10 = others.slice(0, 10).reduce((s, h) => s + h.pct, 0);
      out.push(top10 > 40 ? { lvl: 'r', t: 'Top 10 : ' + fPct(top10), d: 'Très concentré : quelques portefeuilles contrôlent le prix.' }
        : top10 > 25 ? { lvl: 'a', t: 'Top 10 : ' + fPct(top10), d: 'Concentration moyenne.' } : { lvl: 'g', t: 'Top 10 : ' + fPct(top10), d: 'Bonne répartition.' });
    }
    const T = C.trades || [];
    if (c.creator && T.some((x) => x.wallet === c.creator && x.side === 'sell')) out.push({ lvl: 'r', t: 'Le créateur a vendu', d: 'Au moins une vente du créateur dans les transactions récentes.' });
    const recent = T.filter((x) => Date.now() - x.t < 10 * 60000);
    if (!c.complete) out.push(recent.length ? { lvl: recent.length > 8 ? 'g' : 'b', t: recent.length + ' trades en 10 min', d: recent.filter((x) => x.side === 'buy').length + ' achats, ' + recent.filter((x) => x.side === 'sell').length + ' ventes.' } : { lvl: 'a', t: 'Aucune activité récente', d: 'Personne n\'a acheté ni vendu depuis 10 minutes.' });
    return out;
  }
  const LVL = { g: 'var(--green)', a: 'var(--amber)', r: 'var(--red)', b: 'var(--blue)' };

  /* ================================================================ wallet */
  function providers() {
    // catalogue partagé avec le menu de compte (src/wallets/catalog.ts) : Phantom, Solflare, Backpack, Coinbase…
    if (window.TSWallets) return window.TSWallets.detect().map((x) => ({ id: x.id, name: x.name, p: x.p }));
    const out = [];
    const ph = window.phantom && window.phantom.solana; if (ph && ph.isPhantom) out.push({ id: 'phantom', name: 'Phantom', p: ph });
    if (window.solflare && window.solflare.isSolflare) out.push({ id: 'solflare', name: 'Solflare', p: window.solflare });
    if (window.backpack && window.backpack.isBackpack) out.push({ id: 'backpack', name: 'Backpack', p: window.backpack });
    if (!out.length && window.solana) out.push({ id: 'solana', name: 'Wallet', p: window.solana });
    return out;
  }
  async function connectWallet(pv, silent) {
    try {
      if (!silent) toast('Connexion…', 'Validez la demande dans la fenêtre ' + pv.name + '.', '');
      const res = await Promise.race([pv.p.connect(silent ? { onlyIfTrusted: true } : undefined), sleep(silent ? 4000 : 45000).then(() => { throw new Error(pv.name + ' ne répond pas. Vérifiez qu\'il est déverrouillé, puis réessayez.'); })]);
      const pk = ((res && res.publicKey) || pv.p.publicKey).toString();
      S.wallet = { id: pv.id, name: pv.name, prov: pv.p, pk };
      save(LS.wallet, pv.id);
      if (pv.p.on && !pv.p.__ps) {
        pv.p.__ps = true;
        pv.p.on('accountChanged', (k) => { if (k && S.ext) { S.ext.pk = k.toString(); refreshBal(); toast('Compte changé', short(S.wallet.pk), ''); } else disconnectWallet(true); });
        pv.p.on('disconnect', () => disconnectWallet(true));
      }
      if (!silent) toast('Wallet connecté', pv.name + ' · ' + short(pk), 'g');
      await refreshBal(); renderAll();
      return pk;
    } catch (e) { if (!silent) toast('Connexion refusée', e.message || 'Le wallet a refusé la connexion.', 'r'); return null; }
  }
  async function disconnectWallet(external) {
    try { if (!external && S.ext && S.ext.prov.disconnect) await S.ext.prov.disconnect(); } catch (e) {}
    S.ext = null; S.extBal = null; if (!(cfg.useSess && SESSREC)) S.bal = null; save(LS.wallet, null); renderAll();
  }
  async function refreshBal() {
    const w = S.wallet; if (!w) return;
    try {
      const [a, b] = await Promise.all([rpc('getBalance', [w.pk, { commitment: 'confirmed' }]), S.ext && S.ext !== w ? rpc('getBalance', [S.ext.pk, { commitment: 'confirmed' }]) : null]);
      S.bal = a.value / 1e9; S.extBal = S.ext === w ? S.bal : b ? b.value / 1e9 : null;
    } catch (e) {}
    renderTop();
  }
  async function walletMenu() {
    // sans wallet, la connexion passe par le menu de compte (choix du wallet, compte, simulation)
    if (!S.wallet && window.__tsConnectUI && location.protocol !== 'file:') { window.dispatchEvent(new CustomEvent('ts-connect')); return; }
    if (S.wallet && S.wallet.id === 'session') return walletPanel();
    if (S.wallet) {
      const i = await modal('Wallet connecté', '<div class="recap"><div class="kv"><span>Wallet</span><span>' + esc(S.wallet.name) + '</span><span>Adresse</span><span>' + short(S.wallet.pk, 6) + '</span><span>Solde</span><span>' + fSolH(S.bal) + '</span></div></div><p>L\'adresse publique sert à préparer les transactions. Chaque transaction réelle vous sera présentée par votre wallet pour signature.</p>',
        [{ label: 'Fermer' }, { label: 'Copier l\'adresse' }, { label: 'Déconnecter', cls: 'danger' }, { label: 'Wallet rapide', cls: 'primary' }]);
      if (i === 1) { try { await navigator.clipboard.writeText(S.wallet.pk); toast('Adresse copiée', '', 'g'); } catch (e) {} }
      if (i === 2) disconnectWallet(false);
      if (i === 3) walletPanel();
      return;
    }
    if (location.protocol === 'file:') {
      modal('Phantom ne fonctionne pas sur un fichier', '<p>Phantom accepte seulement les pages en <b>https</b> ou servies par votre ordinateur (<b>localhost</b>). Ouvert depuis Téléchargements, le studio ne peut pas s\'y connecter, même avec l\'autorisation des fichiers.</p><ol class="steps"><li><b>Le plus simple</b> : ouvrez l\'adresse en ligne du studio (https), une fois mis en ligne.</li><li><b>Sur votre PC</b> : dans le dossier du fichier, lancez <span class="mono">python -m http.server 8000</span>, puis ouvrez <span class="mono">http://localhost:8000/TokenStudio.html</span>.</li></ol><p style="margin-top:12px">En attendant, tout le reste fonctionne : génération, logo, plan, devis.</p>', [{ label: 'Compris' }], true);
      return;
    }
    const list = providers();
    if (list.length === 1) return connectWallet(list[0]);
    if (list.length > 1) {
      const i = await modal('Choisir un wallet', '<p>Plusieurs wallets sont installés.</p>', list.map((x) => ({ label: x.name, cls: 'primary' })).concat([{ label: 'Annuler' }]));
      if (i < list.length) connectWallet(list[i]);
      return;
    }
    const https = location.protocol === 'https:';
    const deep = 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin);
    const html = isMobile()
      ? (https ? '<p>Sur téléphone, Chrome et Safari ne peuvent pas utiliser l\'extension Phantom : Phantom ne se connecte aux sites que dans le navigateur intégré à son app.</p><p><a class="btn" href="' + esc(deep) + '">Ouvrir le studio dans l\'app Phantom</a></p><p class="dim" style="font-size:13px">Chaque navigateur garde ses propres données : dans l\'app Phantom, il faudra restaurer votre wallet rapide avec son code de sauvegarde.</p>'
        : '<p>Sur téléphone, il faut ouvrir le studio dans le navigateur intégré de l\'app Phantom. Pour cela, le studio doit être en ligne (adresse https), pas ouvert comme fichier.</p><p>Mettez le fichier en ligne (GitHub Pages, Vercel, Netlify), puis ouvrez son adresse dans Phantom → onglet Explorer.</p>')
      : location.protocol === 'file:'
        ? '<p>Le studio est ouvert comme <b>fichier</b> : Chrome n\'y laisse pas entrer les extensions comme Phantom, sauf si vous l\'autorisez.</p><ol class="steps"><li>Ouvrez <span class="mono">chrome://extensions</span> dans un nouvel onglet.</li><li>Sur <b>Phantom</b>, cliquez <b>Détails</b>.</li><li>Activez <b>Autoriser l\'accès aux URL de fichier</b>.</li><li>Rechargez cette page, puis recliquez sur « Connecter le wallet ».</li></ol><p style="margin-top:12px">Si Phantom n\'est pas installé : <b>phantom.app</b>. Autre solution : mettre le studio en ligne (adresse https).</p>'
        : '<p>Aucun wallet Solana détecté dans ce navigateur. Installez l\'extension <b>Phantom</b> (phantom.app) ou <b>Solflare</b>, puis rechargez la page.</p>';
    const fast = '<div class="wcard" style="margin-top:14px"><div class="wh"><b>Ou utiliser le wallet rapide</b><span class="badge g">fonctionne ici</span></div><p>Il marche dans ce navigateur, sans extension ni app : il signe seul, et vos ventes automatiques partent sans fenêtre de confirmation. Déjà créé sur un autre appareil ? Restaurez-le avec son code de sauvegarde.</p><div class="row-btns"><button class="btn sm primary" data-sw="create" type="button">Créer un wallet rapide</button><button class="btn sm" data-sw="import" type="button">Restaurer un wallet rapide</button></div></div>';
    modal('Aucun wallet détecté', html + fast, [{ label: 'Fermer' }]);
  }

  /* ================================================================ wallet rapide (clé du studio, chiffrée dans ce navigateur) */
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) {
    let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
    let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out;
  }
  const TXT = new TextEncoder();
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', TXT.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealSecret(sk, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(pass, salt), sk));
    return { salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct) };
  }
  async function openSecret(rec, pass) {
    const k = await deriveKey(pass, b64ToBytes(rec.salt));
    try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(rec.iv) }, k, b64ToBytes(rec.ct))); }
    catch (e) { throw new Error('Mot de passe incorrect.'); }
  }
  // règle commune des mots de passe (src/lib/password.ts) : 10 caractères, majuscule, minuscule, chiffre, symbole
  const pwWeak = (p) => (window.TSPassword ? window.TSPassword.error(p) : p.length < 10 ? 'Mot de passe trop court : 10 caractères minimum.' : null);
  const PASS_FIELD = (id, label, auto) => '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="password" autocomplete="' + auto + '"></div>';
  async function askPass(title, intro, okLabel) {
    const i = await modal(title, intro + PASS_FIELD('pw1', 'Mot de passe du wallet rapide', 'current-password'), [{ label: 'Annuler' }, { label: okLabel || 'Déverrouiller', cls: 'primary', keep: true }], true);
    if (i !== 1) return null;
    const p = $('pw1').value; closeModal(); return p || null;
  }
  function quickOn() { if (!cfg.quickOff) return; cfg.quickOff = false; save(LS.cfg, cfg); renderAll(); }
  async function sessUnlock(quiet) {
    if (!SESSREC) return false;
    if (SESSW.kp) return true;
    const pass = await askPass('Déverrouiller le wallet rapide', '<p>Adresse <span class="mono">' + short(SESSREC.pk, 6) + '</span>. La clé reste en mémoire tant que cet onglet est ouvert.</p>');
    if (!pass) return false;
    try {
      const sk = await openSecret(SESSREC, pass), kp = W3().Keypair.fromSecretKey(sk);
      if (kp.publicKey.toBase58() !== SESSREC.pk) throw new Error('Clé incohérente.');
      SESSW.kp = kp; quickOn();
      if (!quiet) toast('Wallet rapide déverrouillé', canAuto() ? 'Ventes automatiques actives.' : 'Prêt à signer.', 'g');
      refreshBal(); renderAll(); watchOrders().catch(() => {});
      return true;
    } catch (e) { toast('Déverrouillage impossible', e.message, 'r'); return false; }
  }
  async function ensureSigner() {
    const w = S.wallet; if (!w || w.id !== 'session' || SESSW.kp) return true;   // wallet serveur : rien à déverrouiller
    return sessUnlock(true);
  }
  const signLabel = () => S.wallet && S.wallet.id === 'server' ? 'Signature par le wallet rapide' : S.wallet && S.wallet.id === 'session' ? 'Signature par le wallet rapide' : 'Signature dans votre wallet';

  async function sessCreate(noPanel) {
    if (!(window.crypto && crypto.subtle)) return toast('Navigateur incompatible', 'Le chiffrement exige une page https ou localhost.', 'r');
    const html = '<p>Le studio crée un wallet Solana qui lui est propre. Sa clé est <b>chiffrée avec votre mot de passe</b> et rangée dans ce navigateur. Il signe seul, en quelques millisecondes : les paliers de prise de profit et le stop partent à l\'instant où le prix les atteint.</p>' +
      '<div class="notice">Ce wallet est un « portefeuille de poche ». Si cet appareil ou ce navigateur est compromis, son contenu peut être volé. N\'y mettez que ce que vous acceptez de risquer, et retirez les gains vers Phantom.</div>' +
      PASS_FIELD('pw1', 'Choisissez un mot de passe (10 caractères, majuscule, minuscule, chiffre et symbole)', 'new-password') + PASS_FIELD('pw2', 'Confirmez le mot de passe', 'new-password') +
      '<label class="check"><input type="checkbox" id="pwAck"><span>J\'ai compris : sans ce mot de passe ni la sauvegarde de la clé, les fonds de ce wallet sont perdus.</span></label>';
    const i = await modal('Créer le wallet rapide', html, [{ label: 'Annuler' }, { label: 'Créer', cls: 'primary', keep: true }], true);
    if (i !== 1) return;
    const p1 = $('pw1').value, p2 = $('pw2').value, ack = $('pwAck').checked;
    const weak1 = pwWeak(p1); if (weak1) return toast('Mot de passe trop faible', weak1, 'r');
    if (p1 !== p2) return toast('Mots de passe différents', 'Retapez-les à l\'identique.', 'r');
    if (!ack) return toast('Confirmation manquante', 'Cochez la case pour continuer.', 'a');
    closeModal();
    const kp = W3().Keypair.generate();
    const rec = Object.assign({ pk: kp.publicKey.toBase58(), at: Date.now() }, await sealSecret(kp.secretKey, p1));
    save(LS.sess, rec); SESSREC = rec; SESSW.kp = kp; quickOn();
    cfg.useSess = true; save(LS.cfg, cfg);
    S.bal = 0; renderAll();
    await sessBackup(kp.secretKey, true);
    await sessBackupCode();
    if (noPanel) return rec.pk;
    walletPanel();
  }
  function b58dec(s) {
    let n = 0n; for (const ch of s) { const v = B58.indexOf(ch); if (v < 0) throw new Error('Caractère « ' + ch + ' » impossible dans une clé Solana.'); n = n * 58n + BigInt(v); }
    const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
    for (const ch of s) { if (ch === '1') out.unshift(0); else break; }
    return new Uint8Array(out);
  }
  // Clé privée base58 (export Phantom, Solflare) ou tableau JSON de 64 nombres (fichier id.json de Solana)
  function parseSecret(raw) {
    const t = String(raw || '').trim(); if (!t) throw new Error('Collez la clé privée du wallet.');
    let bytes;
    if (t[0] === '[') {
      let arr; try { arr = JSON.parse(t); } catch (e) { throw new Error('Tableau illisible : il doit ressembler à [12,34,…] avec 64 nombres.'); }
      if (!Array.isArray(arr) || arr.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error('Le tableau doit contenir des nombres de 0 à 255.');
      bytes = Uint8Array.from(arr);
    } else if (t.split(/\s+/).length >= 12) {
      throw new Error('C\'est une phrase secrète : elle n\'est pas acceptée ici. Exportez plutôt la clé privée du compte (Phantom : Paramètres → Gérer les comptes → Afficher la clé privée).');
    } else bytes = b58dec(t.replace(/\s+/g, ''));
    try {
      if (bytes.length === 64) return W3().Keypair.fromSecretKey(bytes);
      if (bytes.length === 32) return W3().Keypair.fromSeed(bytes);
    } catch (e) { throw new Error('Clé invalide : elle ne correspond à aucun wallet Solana.'); }
    throw new Error('Clé invalide : 64 octets attendus, ' + bytes.length + ' trouvés.');
  }
  // Code de sauvegarde du wallet rapide : la clé chiffrée par son mot de passe, propre au studio
  const BK_PREFIX = 'pstudio-wallet:';
  const backupCode = (rec) => BK_PREFIX + btoa(JSON.stringify({ v: 1, pk: rec.pk, salt: rec.salt, iv: rec.iv, ct: rec.ct }));
  function parseBackup(t) {
    let o; try { o = JSON.parse(atob(t.slice(BK_PREFIX.length).replace(/\s+/g, ''))); } catch (e) { throw new Error('Code de sauvegarde illisible : copiez-le en entier, de « pstudio-wallet: » jusqu\'au dernier caractère.'); }
    if (!o || !o.pk || !o.salt || !o.iv || !o.ct) throw new Error('Code de sauvegarde incomplet.');
    return o;
  }
  async function sessBackupCode() {
    if (!SESSREC) return;
    const code = backupCode(SESSREC);
    await modal('Code de sauvegarde du wallet rapide',
      '<p>Ce code contient votre wallet rapide <b>chiffré par son mot de passe</b>. Gardez-le avec ce mot de passe : ensemble, ils permettent de restaurer le wallet sur un autre navigateur ou appareil (Wallets → Restaurer un wallet rapide).</p>' +
      '<div class="notice">Sans le mot de passe, le code ne sert à rien. Avec le mot de passe, il donne accès aux fonds : ne partagez jamais les deux.</div>' +
      '<div class="skbox"><span class="mono" id="bkTxt">' + esc(code) + '</span></div>' +
      '<div class="row-btns"><button class="btn sm" id="bkCopy" type="button">Copier</button><button class="btn sm" id="bkDl" type="button">Télécharger (.txt)</button></div>',
      [{ label: 'Fermer', cls: 'primary' }], true);
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('#bkCopy, #bkDl'); if (!b || !SESSREC) return;
    const code = backupCode(SESSREC);
    if (b.id === 'bkCopy') { try { await navigator.clipboard.writeText(code); toast('Code copié', 'Rangez-le avec le mot de passe du wallet.', 'g'); } catch (e2) { const r = document.createRange(); r.selectNodeContents($('bkTxt')); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); } return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code + '\n'], { type: 'text/plain' })); a.download = 'wallet-rapide-' + SESSREC.pk.slice(0, 6) + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  // Restaurer un wallet rapide créé par le studio : code de sauvegarde (+ mot de passe du wallet) ou clé notée à la création
  async function sessImport(noPanel) {
    if (!(window.crypto && crypto.subtle)) return toast('Navigateur incompatible', 'Le chiffrement exige une page https ou localhost.', 'r');
    let curBal = null; if (SESSREC) { try { curBal = (await rpc('getBalance', [SESSREC.pk, { commitment: 'confirmed' }])).value / 1e9; } catch (e) {} }
    const html = '<p>Récupérez un wallet rapide créé par le studio, par exemple sur un autre navigateur ou après l\'avoir supprimé. Collez son <b>code de sauvegarde</b> (Wallets → Sauvegarde), ou la <b>clé privée notée à sa création</b>.</p>' +
      (SESSREC ? '<div class="notice">Le wallet rapide actuel (<span class="mono">' + short(SESSREC.pk, 6) + '</span>' + (curBal == null ? ', solde inconnu' : ', ' + fSolH(curBal, 4)) + ') sera remplacé. Sauvegardez-le ou retirez ses fonds avant.</div>' : '') +
      '<div class="field"><label for="impKey">Code de sauvegarde ou clé notée à la création</label><input id="impKey" class="mono" type="password" autocomplete="off" spellcheck="false"><label class="check sm-check" style="margin-top:4px"><input type="checkbox" id="impShow">Afficher</label><div class="dim" id="impPk" style="font-size:13px">L\'adresse du wallet s\'affichera ici.</div></div>' +
      '<div id="impPw"></div>' +
      (SESSREC ? '<label class="check"><input type="checkbox" id="pwAck"><span>Je confirme le remplacement du wallet rapide actuel.</span></label>' : '');
    const pr = modal(SESSREC ? 'Remplacer le wallet rapide' : 'Restaurer un wallet rapide', html, [{ label: 'Annuler' }, { label: 'Restaurer', cls: 'primary', keep: true }], true);
    let mode = '';
    const setMode = (m) => {
      if (m === mode) return; mode = m;
      $('impPw').innerHTML = m === 'code' ? PASS_FIELD('pw1', 'Mot de passe de ce wallet rapide', 'current-password')
        : m === 'key' ? PASS_FIELD('pw1', 'Nouveau mot de passe (10 caractères, majuscule, minuscule, chiffre et symbole)', 'new-password') + PASS_FIELD('pw2', 'Confirmez le mot de passe', 'new-password') : '';
    };
    const update = () => {
      const t = $('impKey').value.trim(), el = $('impPk');
      if (!t) { setMode(''); el.textContent = 'L\'adresse du wallet s\'affichera ici.'; return; }
      try {
        let pk;
        if (t.startsWith(BK_PREFIX)) { setMode('code'); pk = parseBackup(t).pk; }
        else { setMode('key'); pk = parseSecret(t).publicKey.toBase58(); }
        el.innerHTML = 'Wallet rapide : <b class="mono">' + esc(pk) + '</b>' + (S.ext && pk === S.ext.pk ? ' <span class="neg">· c\'est votre wallet principal : refusé</span>' : '');
      } catch (e) { el.textContent = e.message; }
    };
    $('impKey').addEventListener('input', update);
    $('impShow').addEventListener('change', (e) => { $('impKey').type = e.target.checked ? 'text' : 'password'; });
    const i = await pr;
    if (i !== 1) { const k = $('impKey'); if (k) k.value = ''; return; }
    const t = $('impKey').value.trim(), p1 = $('pw1') ? $('pw1').value : '', p2 = $('pw2') ? $('pw2').value : '';
    if (SESSREC && !$('pwAck').checked) return toast('Confirmation manquante', 'Cochez la case pour remplacer le wallet rapide actuel.', 'a');
    let kp, rec;
    try {
      if (t.startsWith(BK_PREFIX)) {
        const o = parseBackup(t); if (!p1) throw new Error('Saisissez le mot de passe de ce wallet rapide.');
        kp = W3().Keypair.fromSecretKey(await openSecret(o, p1));
        if (kp.publicKey.toBase58() !== o.pk) throw new Error('Code de sauvegarde altéré.');
        rec = { pk: o.pk, salt: o.salt, iv: o.iv, ct: o.ct, at: Date.now(), restored: true };
      } else {
        kp = parseSecret(t);
        const weak2 = pwWeak(p1); if (weak2) throw new Error(weak2);
        if (p1 !== p2) throw new Error('Les deux mots de passe sont différents.');
        rec = Object.assign({ pk: kp.publicKey.toBase58(), at: Date.now(), restored: true }, await sealSecret(kp.secretKey, p1));
      }
    } catch (e) { return toast('Restauration impossible', e.message, 'r'); }
    if (S.ext && rec.pk === S.ext.pk) return toast('Wallet principal refusé', 'Le wallet rapide doit rester distinct de votre wallet Phantom.', 'r');
    if (SESSREC && rec.pk === SESSREC.pk) { $('impKey').value = ''; closeModal(); SESSW.kp = kp; renderAll(); toast('Déjà en place', 'C\'est votre wallet rapide actuel. Il est déverrouillé.', 'g'); return noPanel ? rec.pk : walletPanel(); }
    $('impKey').value = ''; closeModal();
    save(LS.sess, rec); SESSREC = rec; SESSW.kp = kp; quickOn();
    cfg.useSess = true; save(LS.cfg, cfg);
    S.bal = null; await refreshBal().catch(() => {}); renderAll();
    toast('Wallet rapide restauré', short(rec.pk, 6) + ' est prêt et déverrouillé.', 'g');
    if (noPanel) return rec.pk;
    walletPanel();
  }
  async function sessBackup(sk, first) {
    const key = b58(sk);
    await modal(first ? 'Sauvegardez la clé maintenant' : 'Clé du wallet rapide',
      '<p>Cette clé privée donne un accès total au wallet rapide. Notez-la <b>hors ligne</b> (papier, gestionnaire de mots de passe). Elle s\'importe dans Phantom : <i>Ajouter un compte → Importer une clé privée</i>.</p>' +
      '<div class="notice bad">Ne la partagez avec personne, ni support, ni « admin », ni assistant. Personne n\'en a besoin pour vous aider.</div>' +
      '<div class="skbox"><span class="mono" id="skTxt" data-blur="1">' + esc(key) + '</span></div>' +
      '<div class="row-btns"><button class="btn sm" data-sk="show" type="button">Afficher</button><button class="btn sm" data-sk="copy" type="button">Copier</button></div>',
      [{ label: first ? 'Je l\'ai sauvegardée' : 'Fermer', cls: 'primary' }], true);
  }
  async function sessExport() {
    if (!SESSREC) return;
    const pass = await askPass('Afficher la clé', '<p>Saisissez votre mot de passe pour afficher la clé privée du wallet rapide.</p>', 'Afficher');
    if (!pass) return;
    try { await sessBackup(await openSecret(SESSREC, pass), false); } catch (e) { toast('Impossible', e.message, 'r'); }
  }
  async function sessDelete() {
    let bal = null; try { bal = (await rpc('getBalance', [SESSREC.pk, { commitment: 'confirmed' }])).value / 1e9; } catch (e) {}
    const rich = bal == null || bal > 0.001;
    const ok = await confirmBox('Supprimer le wallet rapide ?', '<p>La clé chiffrée sera effacée de ce navigateur.</p>' + (rich ? '<div class="notice bad">Le wallet contient ' + (bal == null ? 'peut-être des fonds' : fSolH(bal, 4)) + '. Retirez-les vers Phantom avant, ou assurez-vous d\'avoir sauvegardé la clé : sinon ils seront perdus.</div>' : ''), 'Supprimer', true);
    if (!ok) return;
    try { localStorage.removeItem(LS.sess); } catch (e) {}
    SESSREC = null; SESSW.kp = null; cfg.useSess = false; save(LS.cfg, cfg); S.bal = null;
    toast('Wallet rapide supprimé', '', 'g'); refreshBal(); renderAll();
  }
  // Alimenter le wallet rapide du compte depuis le wallet connecté (Phantom…) : un virement de SOL signé dans Phantom
  async function sessFund() {
    if (!S.ext) { toast('Wallet non connecté', 'Connectez Phantom (ou un autre wallet) pour alimenter votre wallet rapide.', 'a'); return; }
    if (!SRVPK) { toast('Pas encore de wallet rapide', 'Créez d\'abord votre wallet rapide, puis alimentez-le depuis ' + S.ext.name + '.', 'a'); try { window.dispatchEvent(new CustomEvent('ts-srv', { detail: 'create' })); } catch (e) {} return; }
    if (cfg.sim) return toast('Mode démo', 'Passez en réel pour alimenter votre wallet rapide.', 'a');
    const ext = S.ext, to = SRVPK;
    let have = S.extBal; try { have = (await rpc('getBalance', [ext.pk, { commitment: 'confirmed' }])).value / 1e9; } catch (e) {}
    const max = have != null ? Math.max(0, have - 0.003) : null;   // garde de quoi payer les frais du wallet
    const i = await modal('Alimenter le wallet rapide', '<p>Virement de SOL depuis <b>' + esc(ext.name) + '</b> <span class="mono">' + short(ext.pk) + '</span> vers votre wallet rapide <span class="mono">' + short(to) + '</span>. ' + esc(ext.name) + ' vous demandera de signer.</p>' +
      '<div class="field"><label for="fundAmt">Montant' + (max != null ? ' <small>disponible : ' + fSolH(have, 4) + '</small>' : '') + '</label><span class="unit"><input id="fundAmt" type="number" min="0.001" step="any" value="' + (max != null ? Math.min(0.3, Math.floor(max * 1000) / 1000) : 0.3) + '"><em>SOL</em></span></div>' +
      (max != null ? '<div class="row-btns">' + [0.1, 0.5, 1].filter((v) => v <= max).map((v) => '<button class="btn sm" type="button" data-fundset="' + v + '">' + fSolH(v, 1) + '</button>').join('') + '<button class="btn sm" type="button" data-fundset="' + Math.floor(max * 1e6) / 1e6 + '">Maximum</button></div>' : '') +
      '<p class="muted" style="font-size:13.5px">Conseil : juste de quoi couvrir vos achats et les frais (environ 0,03 SOL pour un lancement). Les plafonds de votre wallet rapide s\'appliquent ensuite.</p>',
      [{ label: 'Annuler' }, { label: 'Alimenter', cls: 'primary', keep: true }], true);
    if (i !== 1) return;
    const amt = num($('fundAmt').value);
    if (!(amt >= 0.001) || amt > 1000) return toast('Montant invalide', 'Entre 0,001 et 1 000 SOL.', 'r');
    if (max != null && amt > max) return toast('Solde insuffisant', ext.name + ' a ' + fSol(have, 4) + ' (frais du virement compris).', 'r');
    closeModal();
    const { web3 } = KIT();
    const ctx = await runFlow('Alimenter le wallet rapide', [
      { label: 'Préparation du virement', run: async (x) => { x.tx = await txFrom([web3.SystemProgram.transfer({ fromPubkey: new web3.PublicKey(ext.pk), toPubkey: new web3.PublicKey(to), lamports: Math.round(amt * 1e9) })], 1000, { payer: ext.pk, tip: false }); return fSol(amt, 4); } },
      { label: 'Signature dans ' + ext.name, run: async (x) => { x.sig = await signAndSend(x.tx, null, ext); return short(x.sig, 6); } },
      { label: 'Confirmation sur la blockchain', run: async (x) => await confirmSig(x.sig) },
    ]);
    if (!ctx.error) {
      $('mBody').insertAdjacentHTML('beforeend', '<div class="notice good">' + fSolH(amt, 4) + ' envoyés sur votre wallet rapide. <a href="' + solscan(ctx.sig) + '" target="_blank" rel="noopener">Voir sur Solscan</a></div>');
      toast('Wallet rapide alimenté', '+' + fSol(amt, 4), 'g'); S.bal = null; refreshBal(); renderAll();
    }
  }
  // Ancien wallet rapide du navigateur → wallet rapide du compte (même adresse, mêmes fonds), puis retiré d'ici
  async function legacyMigrate() {
    if (!SESSREC) return;
    if (SRVPK && SRVPK !== SESSREC.pk) return sessWithdraw(SRVPK);   // le compte a déjà un wallet rapide : on y vire les SOL
    const i = await modal('Transférer votre ancien wallet rapide', '<p>Votre wallet rapide <b class="mono">' + short(SESSREC.pk, 4) + '</b> était gardé dans ce navigateur. Il devient le wallet rapide de votre compte : <b>même adresse, mêmes fonds</b>. Il signera ensuite seul, sans fenêtre de confirmation.</p>' +
      PASS_FIELD('lgPw', 'Mot de passe de ce wallet rapide', 'current-password'), [{ label: 'Annuler' }, { label: 'Transférer', cls: 'primary', keep: true }], true);
    if (i !== 1) return;
    const pass = $('lgPw').value;
    let kp; try { kp = W3().Keypair.fromSecretKey(await openSecret(SESSREC, pass)); if (kp.publicKey.toBase58() !== SESSREC.pk) throw new Error(); }
    catch (e) { toast('Mot de passe incorrect', 'Le wallet rapide n\'a pas pu être ouvert.', 'r'); return; }
    let pw = pass;
    if (pwWeak(pass)) {
      const j = await modal('Nouveau mot de passe', '<p>Sur votre compte, le wallet rapide demande un mot de passe solide : au moins 10 caractères, avec une majuscule, une minuscule, un chiffre et un symbole.</p>' + PASS_FIELD('lgPw2', 'Nouveau mot de passe', 'new-password'), [{ label: 'Annuler' }, { label: 'Valider', cls: 'primary', keep: true }], true);
      if (j !== 1) return;
      pw = $('lgPw2').value; const weak3 = pwWeak(pw); if (weak3) { toast('Mot de passe trop faible', weak3, 'a'); return; }
    }
    closeModal();
    if (!window.TSServerWalletImport) { toast('Compte requis', 'Connectez-vous à votre compte pour transférer le wallet.', 'a'); return; }
    try { await window.TSServerWalletImport(pw, b58(kp.secretKey)); }
    catch (e) { toast('Transfert impossible', e.message, 'r'); return; }
    try { localStorage.removeItem(LS.sess); } catch (e) {}
    SESSREC = null; SESSW.kp = null; cfg.useSess = false; cfg.useSrv = true; save(LS.cfg, cfg);
    toast('Wallet rapide transféré', short(kp.publicKey.toBase58(), 4) + ' est maintenant le wallet rapide de votre compte.', 'g');
    renderAll();
  }
  async function sessWithdraw(destTo) {
    if (!SESSW.kp && !(await sessUnlock(true))) return;
    const dest0 = typeof destTo === 'string' ? destTo : S.ext ? S.ext.pk : '';
    let bal = 0; try { bal = (await rpc('getBalance', [SESSREC.pk, { commitment: 'confirmed' }])).value; } catch (e) { return toast('RPC en erreur', e.message, 'r'); }
    const i = await modal('Retirer vers votre wallet', '<p>Solde du wallet rapide : <b>' + fSolH(bal / 1e9, 4) + '</b>. Les tokens ne sont pas déplacés : vendez-les d\'abord si vous voulez tout récupérer en SOL.</p>' +
      '<div class="field"><label for="wdDest">Adresse de destination</label><input id="wdDest" class="mono" value="' + esc(dest0) + '" autocomplete="off" spellcheck="false"></div>' +
      '<div class="field"><label for="wdAmt">Montant <small>vide = tout le solde, frais déduits</small></label><span class="unit"><input id="wdAmt" type="number" min="0" step="any" placeholder="tout"><em>SOL</em></span></div>',
      [{ label: 'Annuler' }, { label: 'Retirer', cls: 'danger', keep: true }], true);
    if (i !== 1) return;
    const dest = validMint($('wdDest').value || ''), amtIn = $('wdAmt').value.trim();
    if (!dest) return toast('Adresse invalide', 'Collez une adresse Solana complète.', 'r');
    if (dest === SESSREC.pk) return toast('Adresse invalide', 'C\'est l\'adresse du wallet rapide lui-même.', 'r');
    closeModal();
    if (cfg.sim) return toast('Mode démo', 'Le retrait n\'est pas envoyé en démo. Passez en réel pour retirer.', 'a');
    const { web3 } = KIT(), price = 20000, feeLam = 5000 + Math.ceil(price * 1000 / 1e6);
    const lam = amtIn ? Math.round(num(amtIn) * 1e9) : bal - feeLam;
    if (!(lam > 0) || lam + feeLam > bal) return toast('Montant trop élevé', 'Disponible : ' + fSol((bal - feeLam) / 1e9, 6) + '.', 'r');
    const ctx = await runFlow('Retrait du wallet rapide', [
      { label: 'Préparation du transfert', run: async (x) => { x.tx = await txFrom([web3.SystemProgram.transfer({ fromPubkey: new web3.PublicKey(SESSREC.pk), toPubkey: new web3.PublicKey(dest), lamports: lam })], 1000, { payer: SESSREC.pk, price, tip: false }); } },
      { label: 'Signature par le wallet rapide', run: async (x) => { x.sig = await signAndSend(x.tx, null, SESSW); return short(x.sig, 6); } },
      { label: 'Confirmation sur la blockchain', run: async (x) => await confirmSig(x.sig) },
    ]);
    if (!ctx.error) { toast('Retrait confirmé', fSol(lam / 1e9, 4) + ' → ' + short(dest), 'g'); refreshBal(); }
  }
  // l'ancien panneau du wallet rapide du navigateur laisse place à la page Portefeuille
  async function walletPanel() { setPage('wallet'); }
  async function walletPanelOld() {
    await refreshBal().catch(() => {});
    const ses = !!SESSREC, act = S.wallet && S.wallet.id === 'session';
    let sesBal = null; if (ses) { if (act) sesBal = S.bal; else { try { sesBal = (await rpc('getBalance', [SESSREC.pk, { commitment: 'confirmed' }])).value / 1e9; } catch (e) {} } }
    const extBal = S.ext ? (act ? S.extBal : S.bal) : null;
    const card = (title, badge, body, btns, pk) => '<div class="wcard' + (badge && badge.on ? ' on' : '') + '"><div class="wh">' + (pk ? wAv(pk, 'lg') : '<span class="wav lg none" aria-hidden="true">' + WI.plug + '</span>') + '<div class="sw-id"><b>' + title + '</b>' + (pk ? '<span class="mono dim" style="font-size:12.5px">' + short(pk, 6) + '</span>' : '') + '</div>' + (badge ? '<span class="pill ' + (badge.c === 'g' ? 'ok' : badge.c === 'a' ? 'lock' : badge.c === 'b' ? 'ext' : '') + '">' + badge.t + '</span>' : '') + '</div>' + body + '<div class="row-btns">' + btns + '</div></div>';
    const balHtml = (b, meta) => '<div class="wbal">' + (b == null ? '<b>—</b><em>SOL</em>' : '<span class="sol stack" data-sol="' + b + '" style="font-size:24px"><b>' + fr(b, 4) + '</b><em style="margin-left:7px">SOL</em></span>') + '</div><div class="wmeta">' + meta + '</div>';
    const B = (sw, label, c) => '<button class="btn sm ' + (c || '') + '" data-sw="' + sw + '" type="button">' + label + '</button>';
    const sesHtml = !ses
      ? card('Wallet rapide', null, '<p>Signe seul, sans fenêtre Phantom : les ventes de vos paliers partent dès que le prix les atteint (moins d\'une seconde au lieu de 3 à 6).</p>', B('create', 'Créer le wallet rapide', 'primary') + B('import', 'Restaurer un wallet rapide'))
      : card('Wallet rapide', act ? { t: SESSW.kp ? 'actif · déverrouillé' : 'actif · verrouillé', c: SESSW.kp ? 'g' : 'a', on: true } : { t: 'en veille', c: '' },
        balHtml(sesBal, 'ventes automatiques ' + (cfg.autoExec ? 'activées' : 'désactivées')),
        (act ? '' : B('use', 'Utiliser pour signer', 'primary')) + (SESSW.kp ? B('lock', 'Verrouiller') : B('unlock', 'Déverrouiller', act ? 'primary' : '')) + B('fund', 'Alimenter') + B('withdraw', 'Retirer') + B('copyses', 'Copier l\'adresse') + B('backup', 'Sauvegarde') + B('export', 'Clé privée', 'ghost') + B('import', 'Restaurer un autre', 'ghost') + B('delete', 'Supprimer', 'ghost'), SESSREC.pk);
    const extHtml = S.ext
      ? card(esc(S.ext.name), act ? { t: 'connecté', c: 'b' } : { t: 'actif · signe', c: 'g', on: true }, balHtml(extBal, 'wallet principal'),
        (act ? B('useext', 'Utiliser pour signer') : '') + B('disc', 'Déconnecter', 'ghost'), S.ext.pk)
      : card('Wallet principal (Phantom…)', null, '<p>Sert à alimenter le wallet rapide et à récupérer les gains.</p>', B('connect', 'Connecter', ses ? '' : 'primary'));
    modal('Wallets', '<div class="wgrid">' + sesHtml + extHtml + '</div>', [{ label: 'Fermer' }], true);
  }
  async function swAction(a) {
    closeModal();
    if (a === 'panel') return walletPanel();
    if (a === 'create' || a === 'import') { try { window.dispatchEvent(new CustomEvent('ts-srv', { detail: 'create' })); } catch (e) {} return; }
    if (a === 'backup') return sessBackupCode();
    if (a === 'unlock') { await sessUnlock(); return; }
    if (a === 'lock') { SESSW.kp = null; toast('Wallet rapide verrouillé', 'Ventes automatiques en pause.', ''); renderAll(); return walletPanel(); }
    if (a === 'use') { if (SRVPK) { cfg.useSrv = true; save(LS.cfg, cfg); S.bal = null; await refreshBal(); renderAll(); } return; }
    if (a === 'useOld') { cfg.useSess = true; save(LS.cfg, cfg); S.bal = null; await refreshBal(); renderAll(); toast('Wallet rapide sélectionné', SESSW.kp ? 'Il signe vos transactions.' : 'Déverrouillez-le pour signer.', 'g'); return walletPanel(); }
    if (a === 'useext') { cfg.useSess = false; save(LS.cfg, cfg); S.bal = null; await refreshBal(); renderAll(); toast(S.ext.name + ' sélectionné', 'Chaque transaction demandera votre signature.', 'g'); return walletPanel(); }
    if (a === 'fund') return sessFund();
    if (a === 'withdraw') return sessWithdraw();
    if (a === 'export') return sessExport();
    if (a === 'delete') return sessDelete();
    if (a === 'copyaddr') { const pk = S.wallet && S.wallet.pk; if (pk) { try { await navigator.clipboard.writeText(pk); toast('Adresse copiée', short(pk, 6), 'g'); } catch (e) {} } return; }
    if (a === 'copyses') { try { await navigator.clipboard.writeText(SESSREC.pk); toast('Adresse copiée', short(SESSREC.pk, 6), 'g'); } catch (e) {} return; }
    if (a === 'disc') { await disconnectWallet(false); return walletPanel(); }
    if (a === 'connect') {
      const list = providers();
      if (!list.length) { const keep = SESSREC; SESSREC = null; await walletMenu(); SESSREC = keep; return; }
      await connectWallet(list[0]); return walletPanel();
    }
  }

  /* ================================================================ moteur direct : programme pump.fun (kit officiel) */
  const KIT = () => window.PumpKit;
  let PST = { url: null };
  let LAST_FEE = null;
  function pumpConn() {
    const R = relay(), url = R ? 'relais' : cfg.rpc || PUBLIC_RPC;
    // via le relais, le kit passe par rpcPost (jeton du compte, repli automatique sur le RPC direct)
    if (PST.url !== url) { const { web3, P } = KIT(); const conn = R ? new web3.Connection(R.url, { commitment: 'confirmed', fetch: (u, init) => rpcPost(init.body) }) : new web3.Connection(url, 'confirmed'); PST = { url, conn, online: new P.OnlinePumpSdk(conn), global: null, fee: null, at: 0 }; }
    return PST;
  }
  async function pumpGlobal() {
    const st = pumpConn();
    if (!st.global || Date.now() - st.at > 300000) {
      try { st.global = await st.online.fetchGlobal(); } catch (e) { throw new Error('Lecture de la configuration pump.fun impossible : ' + (e.message || e)); }
      st.fee = await st.online.fetchFeeConfig().catch(() => null); st.at = Date.now();
    }
    return st;
  }
  // Comptes de pourboire de Helius Sender (envoi direct aux validateurs)
  const TIP_ACCOUNTS = ['4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE', 'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ', '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta'];
  const SENDER_TIP = { off: 0, swqos: 5000, max: 1000000 };   // lamports
  const TIPPED = new WeakSet();
  async function txFrom(ixs, units, o) {
    o = o || {};
    const { web3 } = KIT();
    const [hash, pr] = await Promise.all([blockhash(), o.price != null ? { price: o.price, label: 'fixe' } : priorityPrice(units)]);
    const price = pr.price, payer = new web3.PublicKey(o.payer || S.wallet.pk);
    const base = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units }), web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })].concat(ixs);
    const build = (list) => new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: payer, recentBlockhash: hash, instructions: list }).compileToV0Message());
    let tip = o.tip === false ? 0 : (SENDER_TIP[cfg.sender] || 0), tx = null;
    if (tip) {
      const t = build(base.concat([web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: new web3.PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]), lamports: tip })]));
      const size = t.message.serialize().length + 1 + 64 * t.message.header.numRequiredSignatures;
      if (size <= 1232) { tx = t; TIPPED.add(tx); } else tip = 0;   // trop gros : on garde l'envoi classique
    }
    if (!tx) tx = build(base);
    LAST_FEE = { sol: price * units / 1e6 / 1e9 + tip / 1e9, label: pr.label, tip };
    return tx;
  }
  const MPC = {};
  async function mintProgram(mint) {
    if (MPC[mint]) return MPC[mint];
    const r = await rpc('getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]);
    const { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = KIT();
    if (!(r && r.value)) return TOKEN_PROGRAM_ID;
    return (MPC[mint] = r.value.owner === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
  }
  // creatorPk : wallet affiché comme créateur sur pump.fun et destinataire des frais de créateur ;
  // le wallet actif (user) paie, signe et reçoit l'achat du créateur
  async function directCreate(mintKp, d, uri, dev, creatorPk) {
    const { P, BN, web3, NATIVE_MINT } = KIT(), st = await pumpGlobal();
    const user = new web3.PublicKey(S.wallet.pk), mint = mintKp.publicKey, creator = new web3.PublicKey(creatorPk || S.wallet.pk);
    let ixs;
    if (dev > 0) {
      const solAmount = new BN(Math.round(dev * 1e9));
      const amount = P.getBuyTokenAmountFromSolAmount({ global: st.global, feeConfig: st.fee, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_MINT });
      ixs = await P.PUMP_SDK.createV2AndBuyInstructions({ global: st.global, mint, name: d.name, symbol: d.symbol, uri, creator, user, amount, solAmount, mayhemMode: false });
    } else ixs = [await P.PUMP_SDK.createV2Instruction({ mint, name: d.name, symbol: d.symbol, uri, creator, user, mayhemMode: false })];
    return txFrom(ixs, 400000);
  }
  // pk : wallet qui achète ou vend (par défaut le wallet actif)
  async function directTrade(mint, side, amt, slip, pk) {
    const { P, BN, web3 } = KIT(), slippage = slip || cfg.slippage, payer = pk || S.wallet.pk;
    const [st, tp] = await Promise.all([pumpGlobal(), mintProgram(mint)]);
    const user = new web3.PublicKey(payer), m = new web3.PublicKey(mint);
    if (side === 'buy') {
      const s = await st.online.fetchBuyState(m, user, tp);
      if (s.bondingCurve.complete) throw new Error('MIGRATED');
      const solAmount = new BN(Math.round(amt * 1e9));
      const amount = P.getBuyTokenAmountFromSolAmount({ global: st.global, feeConfig: st.fee, mintSupply: s.bondingCurve.tokenTotalSupply, bondingCurve: s.bondingCurve, amount: solAmount, quoteMint: s.quoteMint });
      const ixs = await P.PUMP_SDK.buyInstructions({ global: st.global, bondingCurveAccountInfo: s.bondingCurveAccountInfo, bondingCurve: s.bondingCurve, associatedUserAccountInfo: s.associatedUserAccountInfo, mint: m, user, amount, solAmount, slippage, tokenProgram: tp });
      return txFrom(ixs, 250000, { payer });
    }
    let s;
    try { s = await st.online.fetchSellState(m, user, tp); } catch (e) { throw new Error(/Associated token account/.test(e.message) ? 'Vous ne détenez pas ce token dans ce wallet.' : e.message); }
    if (s.bondingCurve.complete) throw new Error('MIGRATED');
    const amount = new BN(String(amt));
    const solAmount = P.getSellSolAmountFromTokenAmount({ global: st.global, feeConfig: st.fee, mintSupply: s.bondingCurve.tokenTotalSupply, bondingCurve: s.bondingCurve, amount });
    const ixs = await P.PUMP_SDK.sellInstructions({ global: st.global, bondingCurveAccountInfo: s.bondingCurveAccountInfo, bondingCurve: s.bondingCurve, mint: m, user, amount, solAmount, slippage, tokenProgram: tp, mayhemMode: !!s.bondingCurve.isMayhemMode });
    return txFrom(ixs, 250000, { payer });
  }
  async function tokenRaw(owner, mint) {
    const r = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    return (r && r.value || []).reduce((s2, a) => s2 + BigInt((((a.account.data.parsed || {}).info || {}).tokenAmount || {}).amount || '0'), 0n);
  }

  /* ================================================================ temps réel : abonnement à la courbe */
  const LIVE = {};
  let liveUrl = null;
  function liveSub(mint) {
    if (!cfg.rpc || LIVE[mint]) return; // le RPC public n'accepte pas les abonnements depuis une page
    try {
      const st = pumpConn(); if (liveUrl !== st.url) { Object.keys(LIVE).forEach((k) => delete LIVE[k]); liveUrl = st.url; }
      const pda = curvePda(mint);
      const id = st.conn.onAccountChange(new (W3().PublicKey)(pda), (info) => {
        const C = S.cache[mint]; if (!C) return;
        C.curve = parseCurve(pda, info.data);
        C.stats = C.curve.exists ? curveStats(C.curve) : null; C.live = Date.now(); C.at = Date.now();
        onLive(mint);
      }, 'processed');
      LIVE[mint] = { id, at: Date.now() };
    } catch (e) {}
  }
  function liveKeep(set) {
    Object.keys(LIVE).forEach((m) => { if (!set.has(m)) { try { pumpConn().conn.removeAccountChangeListener(LIVE[m].id); } catch (e) {} delete LIVE[m]; } });
    set.forEach((m) => liveSub(m));
  }
  const liveTimers = {};
  function onLive(mint) {
    checkOrdersFor(mint);                                  // réaction immédiate des paliers
    if (liveTimers[mint]) return;                          // rendu limité à ~3 fois par seconde
    liveTimers[mint] = setTimeout(() => { delete liveTimers[mint]; ['mine', 'trade'].forEach((ctx) => { if (S.view[ctx] === mint && S.page === ctx && !$('modal').classList.contains('open')) renderTokenView(ctx); }); if (S.page === 'mine') renderMineList(); }, 350);
  }

  /* ================================================================ vitesse : frais de priorité et blockhash */
  const SPEEDS = { eco: { label: 'Économique', pct: 0.5, floor: 20000 }, fast: { label: 'Rapide', pct: 0.75, floor: 150000 }, turbo: { label: 'Turbo', pct: 0.95, floor: 800000 } };
  let FEES = { at: 0, list: [] }, BH = { at: 0, hash: null };
  async function recentFees() {
    if (Date.now() - FEES.at < 20000 && FEES.list.length) return FEES.list;
    try { const r = await rpc('getRecentPrioritizationFees', [[PUMP_PROGRAM]]); FEES = { at: Date.now(), list: (r || []).map((x) => x.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b) }; } catch (e) { FEES = { at: Date.now(), list: [] }; }
    return FEES.list;
  }
  async function priorityPrice(units) {      // micro-lamports par unité de calcul
    if (cfg.speed === 'manual') return { price: Math.max(1, Math.round(cfg.priorityFee * 1e9 * 1e6 / units)), label: 'Manuel' };
    const sp = SPEEDS[cfg.speed] || SPEEDS.fast, list = await recentFees();
    let p = list.length ? list[Math.min(list.length - 1, Math.floor(list.length * sp.pct))] : 0;
    p = Math.max(p, sp.floor);
    const cap = Math.round(cfg.maxPriority * 1e9 * 1e6 / units); p = Math.min(p, cap);
    return { price: p, label: sp.label };
  }
  async function blockhash() {
    if (BH.hash && Date.now() - BH.at < 25000) return BH.hash;
    const r = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]); BH = { at: Date.now(), hash: r.value.blockhash }; return BH.hash;
  }
  function prefetch() { if (S.wallet && !document.hidden) { blockhash().catch(() => {}); recentFees().catch(() => {}); if (!PST.global) pumpGlobal().catch(() => {}); } }

  /* ================================================================ transactions */
  async function portalTx(body) {
    let r;
    try { r = await fetch('https://pumpportal.fun/api/trade-local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('PumpPortal injoignable (réseau).'); }
    if (r.status !== 200) { let t = ''; try { t = await r.text(); } catch (e) {} throw new Error('PumpPortal a refusé (' + r.status + ') ' + t.slice(0, 180)); }
    return W3().VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
  }
  async function simulate(tx) {
    const r = await rpc('simulateTransaction', [bytesToB64(tx.serialize()), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }]);
    return r.value || r;
  }
  function simError(v) {
    const logs = (v.logs || []).join('\n');
    if (/insufficient lamports|insufficient funds/i.test(logs) || /InsufficientFunds/.test(JSON.stringify(v.err))) return 'Solde SOL insuffisant pour cette opération.';
    if (/TooMuchSolRequired|TooLittleSolReceived|slippage/i.test(logs)) return 'Le prix a trop bougé : augmentez le slippage ou réduisez le montant.';
    return 'La blockchain refuse cette transaction (' + JSON.stringify(v.err).slice(0, 120) + ').';
  }
  // Envoi rapide : la transaction a déjà été simulée, on l'envoie sans contrôle préalable et on la
  // renvoie toutes les 2 s jusqu'à confirmation (les validateurs en surcharge en perdent parfois).
  const INFLIGHT = {};
  function senderUrl() {
    const key = (/api-key=([A-Za-z0-9-]+)/.exec(cfg.rpc || '') || [])[1];
    return 'https://sender.helius-rpc.com/fast' + (cfg.sender === 'swqos' ? '?swqos_only=true' : '') + (key ? (cfg.sender === 'swqos' ? '&' : '?') + 'api-key=' + key : '');
  }
  function senderSend(raw) {
    return fetch(senderUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [raw, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }] }) })
      .then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error.message || 'Sender'); return j.result; });
  }
  async function sendRaw(tx) {
    const raw = bytesToB64(tx.serialize()), viaSender = TIPPED.has(tx);
    const local = tx.signatures && tx.signatures[0] && tx.signatures[0].some((b) => b) ? b58(tx.signatures[0]) : null;
    const sends = [rpc('sendTransaction', [raw, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }])];
    if (viaSender) sends.push(senderSend(raw));
    let sig;
    try { sig = await Promise.any(sends); } catch (e) { const er = (e.errors && e.errors[0]) || e; throw new Error('Envoi refusé : ' + (er.message || er)); }
    sig = local || sig;
    INFLIGHT[sig] = { raw, viaSender };
    return sig;
  }
  async function confirmSig(sig) {
    const t0 = Date.now(); let lastSend = Date.now();
    for (let i = 0; Date.now() - t0 < 75000; i++) {
      await sleep(i < 6 ? 350 : 700);
      if (INFLIGHT[sig] && Date.now() - lastSend > 2000) { lastSend = Date.now(); const f = INFLIGHT[sig]; rpc('sendTransaction', [f.raw, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]).catch(() => {}); if (f.viaSender) senderSend(f.raw).catch(() => {}); }
      let st; try { st = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]); } catch (e) { continue; }
      const v = st && st.value && st.value[0];
      if (v && v.err) throw new Error('Transaction rejetée par la blockchain : ' + JSON.stringify(v.err).slice(0, 120));
      if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) { delete INFLIGHT[sig]; return ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',') + ' s'; }
    }
    delete INFLIGHT[sig];
    throw new Error('Pas de confirmation dans les 75 s. Vérifiez sur Solscan avant de réessayer : la transaction a peut-être expiré.');
  }
  async function signAndSend(tx, extraSigners, w) {
    w = w || S.wallet;
    if (w.id === 'server') {
      if (!window.TSServerWallet) throw new Error('Wallet serveur indisponible : reconnectez-vous à votre compte.');
      if (extraSigners && extraSigners.length) tx.sign(extraSigners);   // ex. clé du mint au lancement
      const r = await window.TSServerWallet.signSend(bytesToB64(tx.serialize()));
      INFLIGHT[r.signature] = { raw: r.raw, viaSender: false };
      return r.signature;
    }
    if (w.id === 'session') {
      if (!SESSW.kp) throw new Error('Wallet rapide verrouillé : déverrouillez-le puis relancez.');
      tx.sign([SESSW.kp].concat(extraSigners || []));
      return sendRaw(tx);
    }
    const p = w.prov;
    if (p.signTransaction) {
      const signed = await p.signTransaction(tx);           // le wallet signe en premier
      if (extraSigners && extraSigners.length) signed.sign(extraSigners); // puis la clé du mint (création)
      return sendRaw(signed);
    }
    if (extraSigners && extraSigners.length) tx.sign(extraSigners);
    const r = await p.signAndSendTransaction(tx); return r.signature || r;
  }
  async function actualDeltas(sig, mint) {
    try {
      const tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      const tr = parseTrade(tx, mint, sig); return tr ? { sol: tr.sol, tokens: tr.tokens } : null;
    } catch (e) { return null; }
  }

  // Déroulé visible étape par étape, dans une fenêtre qui reste ouverte
  async function runFlow(title, steps) {
    const box = (st) => '<div class="stage">' + steps.map((s, i) => '<div class="s ' + (st[i] || '') + '"><i></i><span>' + esc(s.label) + (s.note ? ' <span class="muted">· ' + esc(s.note) + '</span>' : '') + '</span></div>').join('') + '</div>';
    const st = [];
    modal(title, box(st), [{ label: 'Fermer', keep: false }], true);
    $('mRow').hidden = true;
    const ctx = {};
    for (let i = 0; i < steps.length; i++) {
      st[i] = 'run'; $('mBody').innerHTML = box(st);
      try { const note = await steps[i].run(ctx); if (typeof note === 'string') steps[i].note = note; st[i] = 'ok'; }
      catch (e) {
        st[i] = 'ko'; steps[i].note = '';
        $('mBody').innerHTML = box(st) + '<div class="notice bad">' + esc(e.message || String(e)) + '</div>' + (ctx.logs ? '<div class="logs">' + esc(ctx.logs) + '</div>' : '');
        $('mRow').hidden = false; ctx.error = e; return ctx;
      }
      $('mBody').innerHTML = box(st);
    }
    $('mRow').hidden = false;
    return ctx;
  }
  function journalAdd(e) { e.id = e.id || (Date.now() + '-' + Math.random().toString(36).slice(2, 7)); e.t = e.t || Date.now(); S.journal.unshift(e); if (S.journal.length > 2000) S.journal.length = 2000; save(LS.journal, S.journal); }
  const solscan = (sig) => 'https://solscan.io/tx/' + sig;

  /* ---------- démo : wallet fictif de 10 SOL et marché simulé. Rien ne touche la blockchain ---------- */
  // Adresses démo volontairement invalides sur Solana (elles contiennent « 0 ») : impossible d'y envoyer de vrais SOL.
  const B58A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const rndB58 = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); let o = ''; b.forEach((x) => { o += B58A[x % 58]; }); return o; };
  const DEMO = Object.assign({ bal: 10, pos: {}, addr: '' }, load('pstudio_demo_v1', {}));
  if (!DEMO.addr) DEMO.addr = 'DEMO0' + rndB58(39);
  const demoSave = () => save('pstudio_demo_v1', DEMO);
  const isDemoMint = (m) => typeof m === 'string' && m.startsWith('DEMO0');
  // invitation au réel : créer un compte (invité) ou passer en réel (compte connecté)
  const demoCta = () => '<div class="notice info ts-acct-cta"><span><b>Opération fictive.</b> ' + (AUTH ? 'En réel, la même opération est vérifiée sur la blockchain puis envoyée après votre signature.' : 'Créez votre compte pour passer en réel : chaque opération y est vérifiée sur la blockchain avant votre signature.') + '</span>' +
    '<button class="btn sm primary" data-act="' + (AUTH ? 'simoff' : 'needacct') + '" type="button">Passer en réel</button></div>';

  // Marché simulé des tokens lancés en démo : courbe de liaison, acheteurs et vendeurs fictifs, détenteurs, frais créateur
  const DM = Object.assign({ tok: {} }, load('pstudio_demo_mkt_v1', {}));
  let dmDirty = 0;
  const dmSave = () => { dmDirty = 0; save('pstudio_demo_mkt_v1', DM); };
  const DEMO_FEE = 0.003;   // part des échanges reversée au créateur, simulée
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const poisson = (l) => { let n = 0, p = Math.exp(-Math.min(l, 30)), s = p; const u = Math.random(); while (u > s && n < 40) { n++; p *= l / n; s += p; } return n; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const dmCurve = (T) => ({ pda: 'DEMO0curve', exists: true, demo: true, vSol: T.vSol, vTok: T.vTok, realTok: T.realTok, realSol: T.realSol, supply: 1e15, complete: T.complete, creator: DEMO.addr });
  function dmApply(T, who, side, amt, t) {
    const c = dmCurve(T), me = who === DEMO.addr;
    let tr;
    if (side === 'buy') {
      const q = quoteBuy(c, amt); if (!q || !(q.tokens > 0)) return null;
      const net = amt * (1 - feeRate()) * 1e9, raw = q.tokens * 1e6;
      T.vSol += net; T.vTok -= raw; T.realSol += net; T.realTok -= raw;
      if (!me) T.hold[who] = (T.hold[who] || 0) + q.tokens;
      tr = { sig: 'DEMO0' + rndB58(40), t, wallet: who, side, tokens: q.tokens, sol: amt, price: amt / q.tokens };
    } else {
      const have = me ? (DEMO.pos[T.mint] || 0) : (T.hold[who] || 0), tok = Math.min(amt, have);
      const q = quoteSell(c, tok); if (!q || !(q.sol > 0)) return null;
      const gross = q.sol / (1 - feeRate()) * 1e9, raw = tok * 1e6;
      T.vTok += raw; T.vSol -= gross; T.realTok += raw; T.realSol = Math.max(0, T.realSol - gross);
      if (!me) T.hold[who] = have - tok;
      tr = { sig: 'DEMO0' + rndB58(40), t, wallet: who, side, tokens: tok, sol: q.sol, price: q.sol / tok };
    }
    T.fees += tr.sol * DEMO_FEE;
    // courbe terminée : migration simulée, les échanges continuent sur un pool
    if (!T.complete && T.realTok <= 1e9) { T.complete = true; T.migratedAt = t; T.realTok = T.vTok * 0.8; }
    T.trades.unshift(tr); if (T.trades.length > 300) T.trades.length = 300;
    dmDirty++;
    return tr;
  }
  function dmStep(T, t, dt) {
    const age = (t - T.createdAt) / 60000, lam = (0.45 * Math.exp(-age / 40) + 0.05) * T.heat;
    const n = Math.min(poisson(lam * dt), 15);
    for (let i = 0; i < n; i++) {
      T.mood = clamp(T.mood * 0.97 + gauss() * 0.16 - 0.006, -1, 1);
      const ts = t - Math.random() * dt * 1000;
      if (Math.random() < 0.5 + 0.3 * T.mood) {
        let who = T.traders.length && Math.random() > 0.35 ? pick(T.traders) : null;
        if (!who) { who = rndB58(44); T.traders.push(who); if (T.traders.length > 120) T.traders.shift(); }
        dmApply(T, who, 'buy', clamp(Math.exp(Math.log(0.18) + gauss() * 0.9), 0.01, 6), ts);
      } else {
        const hs = Object.keys(T.hold).filter((k) => T.hold[k] > 1); if (!hs.length) continue;
        const who = pick(hs); dmApply(T, who, 'sell', T.hold[who] * (Math.random() < 0.4 ? 1 : 0.2 + Math.random() * 0.6), ts);
      }
    }
    Object.keys(T.hold).forEach((k) => { if (T.hold[k] <= 1) delete T.hold[k]; });
  }
  // fait avancer le marché jusqu'à maintenant (rattrape au plus 30 minutes d'absence)
  function dmRun() {
    const now = Date.now();
    Object.values(DM.tok).forEach((T) => {
      let t = Math.max(T.last, now - 30 * 60000);
      while (now - t >= 4000) { t += 4000; dmStep(T, t, 4); }
      T.last = now - (now - t);
      T.trades.sort((a, b) => b.t - a.t);
    });
    if (dmDirty) dmSave();
  }
  function dmLoad(mint) {
    const T = DM.tok[mint], C = S.cache[mint] = S.cache[mint] || { trades: [], meta: null, holders: [], at: 0 };
    if (!T) { C.curve = { exists: false }; C.stats = null; return C; }
    C.curve = dmCurve(T); C.stats = curveStats(C.curve); C.at = Date.now(); C.error = null;
    C.meta = { name: T.name, symbol: T.symbol, image: T.image || '' };
    C.trades = T.trades.slice(); C.myBal = DEMO.pos[mint] || 0;
    const sup = 1e9, me = DEMO.pos[mint] || 0;
    const H = Object.keys(T.hold).map((o) => ({ owner: o, amount: T.hold[o], pct: T.hold[o] / sup * 100, label: '' }));
    if (me > 0) H.push({ owner: DEMO.addr, amount: me, pct: me / sup * 100, label: 'Créateur' });
    const pool = T.complete ? T.realTok / 1e6 : (T.realTok + (1e15 - INIT_REAL_TOK)) / 1e6;
    H.push({ owner: 'DEMO0curve', amount: pool, pct: pool / sup * 100, label: T.complete ? 'Pool PumpSwap' : 'Courbe de liaison' });
    C.holders = H.sort((a, b) => b.amount - a.amount).slice(0, 20); C.holdersAt = Date.now();
    return C;
  }

  // Devis et exécution d'un échange démo : token démo (courbe simulée) ou vrai token (prix DexScreener, SOL fictifs)
  async function demoQuote(mint, side, amountStr) {
    let sym, price = null, T = null;
    if (isDemoMint(mint)) { dmRun(); T = DM.tok[mint]; if (!T) throw new Error('Token démo introuvable.'); sym = T.symbol; }
    else {
      const X = await dexMarket(mint); price = X && X.stats && X.stats.price;
      if (!(price > 0)) throw new Error('Prix introuvable pour ce token sur DexScreener. Essayez un token déjà échangé, ou lancez votre propre token en démo.');
      sym = (X.meta && X.meta.symbol) || short(mint);
    }
    let sol, tokens;
    if (side === 'buy') {
      sol = num(amountStr); if (!(sol > 0)) throw new Error('Montant SOL invalide.');
      if (sol > DEMO.bal) throw new Error('Solde démo insuffisant : ' + fSol(DEMO.bal) + ' disponibles.');
      if (T) { const q = quoteBuy(dmCurve(T), sol); if (!q || !(q.tokens > 0)) throw new Error('Plus aucun token à acheter sur la courbe.'); tokens = q.tokens; }
      else tokens = sol * (1 - feeRate()) / price;
    } else {
      const held = DEMO.pos[mint] || 0;
      tokens = /%$/.test(String(amountStr)) ? held * num(String(amountStr).replace('%', '')) / 100 : num(amountStr);
      if (!(tokens > 0)) throw new Error(held ? 'Quantité invalide.' : 'Le wallet démo ne détient pas ce token.');
      if (tokens > held * 1.0001) throw new Error('Le wallet démo ne détient que ' + fTok(held) + ' ' + sym + '.');
      tokens = Math.min(tokens, held);
      if (T) { const q = quoteSell(dmCurve(T), tokens); sol = q ? q.sol : 0; } else sol = tokens * price * (1 - feeRate());
    }
    return { sym, sol, tokens, src: T ? (T.complete ? 'Pool simulé (après migration)' : 'Courbe de liaison simulée') : 'DexScreener, en direct' };
  }
  function demoApply(mint, side, Q, extra) {
    let sol = Q.sol, tokens = Q.tokens, sig = '';
    if (isDemoMint(mint)) {
      const tr = dmApply(DM.tok[mint], DEMO.addr, side, side === 'buy' ? sol : tokens, Date.now());
      if (!tr) throw new Error('Échange impossible sur la courbe simulée.');
      tokens = tr.tokens; sol = tr.sol; sig = tr.sig; dmSave();
    }
    DEMO.bal = Math.max(0, DEMO.bal + (side === 'buy' ? -sol : sol));
    DEMO.pos[mint] = Math.max(0, (DEMO.pos[mint] || 0) + (side === 'buy' ? tokens : -tokens));
    demoSave();
    journalAdd(Object.assign({ type: side, mint, symbol: Q.sym, sim: true, demo: true, status: 'ok', sig, sol: side === 'buy' ? -sol : sol, tokens: side === 'buy' ? tokens : -tokens, est: !isDemoMint(mint) }, extra || {}));
    if (S.cache[mint] && isDemoMint(mint)) dmLoad(mint);
    return { sol, tokens };
  }
  // dépôt et retrait fictifs sur le wallet démo
  async function demoMove(kind) {
    const dep = kind === 'deposit';
    const i = await modal(dep ? 'Ajouter des SOL fictifs' : 'Retirer du wallet démo', '<p>' + (dep ? 'Simulez un dépôt sur le wallet démo. Aucun vrai SOL n\'est envoyé, et l\'adresse démo ne peut pas en recevoir.' : 'Simulez un retrait vers votre wallet. Rien n\'est envoyé.') + '</p>' +
      '<div class="field"><label for="dmAmt">Montant</label><span class="unit"><input id="dmAmt" type="number" min="0.01" step="any" value="' + (dep ? '5' : fr(Math.min(1, DEMO.bal), 2).replace(',', '.')) + '"><em>SOL</em></span></div>' +
      '<p class="muted" style="font-size:13.5px">Solde démo actuel : ' + fSolH(DEMO.bal, 3) + (dep ? ' · maximum 1 000 SOL.' : '.') + '</p>',
      [{ label: 'Annuler' }, { label: dep ? 'Ajouter' : 'Retirer', cls: 'primary', keep: true }], true);
    if (i !== 1) return;
    const amt = num($('dmAmt').value);
    if (!(amt > 0)) return toast('Montant invalide', 'Entrez un montant positif.', 'r');
    if (dep && DEMO.bal + amt > 1000) return toast('Montant trop élevé', 'Le wallet démo est limité à 1 000 SOL.', 'r');
    if (!dep && amt > DEMO.bal) return toast('Solde insuffisant', 'Disponible : ' + fSol(DEMO.bal, 3) + '.', 'r');
    closeModal();
    DEMO.bal += dep ? amt : -amt; demoSave();
    if (cfg.sim) journalAdd({ type: dep ? 'deposit' : 'withdraw', mint: '', symbol: 'SOL', sim: true, demo: true, status: 'ok', sol: dep ? amt : -amt, tokens: 0 });
    toast(dep ? 'Dépôt démo' : 'Retrait démo', (dep ? '+' : '−') + fSol(amt, 3) + ' · wallet démo ' + fSol(DEMO.bal, 3), 'g');
    renderAll();
  }
  async function demoTrade(mint, side, amountStr, opts) {
    opts = opts || {};
    if (S.busy) return; S.busy = true;
    try {
      const Q = await demoQuote(mint, side, amountStr);
      const recap = '<div class="recap"><div class="kv"><span>Opération</span><span>' + (side === 'buy' ? 'Achat' : 'Vente') + ' de ' + esc(Q.sym) + '</span>' +
        (side === 'buy' ? '<span>Vous payez</span><span>' + fSolH(Q.sol) + '</span><span>Vous recevez environ</span><span>' + fTok(Q.tokens) + ' ' + esc(Q.sym) + '</span>' : '<span>Vous vendez</span><span>' + fTok(Q.tokens) + ' ' + esc(Q.sym) + '</span><span>Vous recevez environ</span><span>' + fSolH(Q.sol) + '</span>') +
        '<span>Prix</span><span>' + Q.src + '</span><span>Wallet</span><span>Wallet démo · ' + fSolH(DEMO.bal) + '</span><span>Mode</span><span><span class="badge v">démo</span></span></div></div>' + (opts.note ? '<div class="notice">' + esc(opts.note) + '</div>' : '') + demoCta();
      if (!(await confirmBox(opts.title || (side === 'buy' ? 'Acheter ' : 'Vendre ') + Q.sym + ' en démo ?', recap, side === 'buy' ? 'Acheter en démo' : 'Vendre en démo'))) return;
      const r = demoApply(mint, side, Q);
      toast(side === 'buy' ? 'Achat démo' : 'Vente démo', Q.sym + ' · ' + (side === 'buy' ? fTok(r.tokens) + ' reçus' : '+' + fSol(r.sol, 4)) + ' · wallet démo ' + fSol(DEMO.bal), 'g');
      renderAll(); refreshView();
      return true;
    } catch (e) { toast('Opération impossible', e.message, 'r'); }
    finally { S.busy = false; renderTop(); }
  }
  // ordre déclenché en démo : vendu aussitôt dans le wallet démo, sans signature
  async function demoOrderSell(o) {
    try {
      const held = DEMO.pos[o.mint] || 0;
      const tok = Math.min(held, o.tokens ? o.tokens : held * o.pct / 100);
      if (!(tok > 0)) throw new Error('Le wallet démo ne détient plus ce token.');
      const Q = await demoQuote(o.mint, 'sell', String(tok));
      const r = demoApply(o.mint, 'sell', Q, { auto: true });
      o.done = true; o.auto = 'ok'; o.failed = null; save(LS.orders, S.orders);
      toast('Vente automatique (démo)', Q.sym + ' · +' + fSol(r.sol, 4) + ' · wallet démo ' + fSol(DEMO.bal), 'g');
    } catch (e) { o.auto = 'ko'; o.failed = e.message; save(LS.orders, S.orders); toast('Vente démo impossible', e.message, 'r'); }
    renderAll();
  }

  async function demoLaunch() {
    const R = readiness();
    if (R.blocking.length) { toast('Pas encore prêt', R.blocking[0], 'a'); return; }
    const d = S.draft, PL = PLATFORMS.pump, dev = num(d.dev) || 0, q = dev > 0 ? quoteBuy(INIT_CURVE, dev) : null, cost = dev + PL.fee;
    if (cost > DEMO.bal) { toast('Solde démo insuffisant', 'Le wallet démo a ' + fSol(DEMO.bal) + '.', 'a'); return; }
    const recap = '<div class="recap"><div class="kv"><span>Token</span><span>' + esc(d.name) + ' · $' + esc(d.symbol) + '</span>' +
      '<span>Achat du créateur</span><span>' + (dev ? fSolH(dev) + (q ? ' → ' + fTok(q.tokens) + ' (' + fPct(q.supplyPct, 2) + ' de l\'offre)' : '') : 'aucun') + '</span>' +
      '<span>Coût total estimé</span><span>' + fSolH(cost) + '</span><span>Wallet</span><span>Wallet démo · ' + fSolH(DEMO.bal) + '</span><span>Mode</span><span><span class="badge v">démo</span></span></div></div>' +
      '<p>Le token est créé sur un marché simulé : des acheteurs et vendeurs fictifs le font vivre, et vous le suivez comme un vrai token.</p>' + demoCta();
    if (!(await confirmBox('Lancer ' + d.name + ' en démo ?', recap, 'Lancer en démo'))) return;
    const now = Date.now(), mint = 'DEMO0' + rndB58(39);
    const T = { mint, name: d.name, symbol: d.symbol, image: '', createdAt: now, last: now, vSol: INIT_CURVE.vSol, vTok: INIT_CURVE.vTok, realTok: INIT_CURVE.realTok, realSol: 0, complete: false,
      hold: {}, traders: [], trades: [], mood: 0.2 + gauss() * 0.25, heat: 0.6 + Math.random(), fees: 0, claimed: 0 };
    let buy = null;
    const ctx = await runFlow('Démo · ' + d.name, [
      { label: 'Logo et fiche du token préparés', run: async () => { await sleep(300); T.image = await thumbnail(d.image); return 'prêts'; } },
      { label: 'Token créé sur la courbe simulée', run: async () => { await sleep(400); DM.tok[mint] = T; return short(mint); } },
      { label: dev > 0 ? 'Achat du créateur' : 'Aucun achat du créateur', run: async () => {
        await sleep(300); if (!(dev > 0)) return 'aucun';
        buy = dmApply(T, DEMO.addr, 'buy', dev, now); if (!buy) throw new Error('Achat impossible.');
        return fTok(buy.tokens) + ' ' + d.symbol;
      } },
    ]);
    if (ctx.error) { delete DM.tok[mint]; return; }
    dmSave();
    DEMO.bal = Math.max(0, DEMO.bal - cost); if (buy) DEMO.pos[mint] = buy.tokens; demoSave();
    S.tokens.unshift({ mint, name: d.name, symbol: d.symbol, image: T.image, createdAt: now, sig: buy ? buy.sig : '', dev, platform: 'pump', creator: DEMO.addr, desc: d.desc, tw: d.tw, tg: d.tg, web: d.web, demo: true });
    save(LS.tokens, S.tokens);
    journalAdd({ type: 'create', mint, symbol: d.symbol, sim: true, demo: true, status: 'ok', sig: buy ? buy.sig : '', sol: -cost, tokens: buy ? buy.tokens : 0 });
    // plan de prise de profit → ordres démo, vendus automatiquement dans le wallet démo
    if (buy && d.tpOn && tpValid().ok) {
      const ref = dev / buy.tokens;
      d.tp.forEach((l, i) => S.orders.push({ id: Date.now().toString(36) + i, mint, symbol: d.symbol, kind: 'tp', value: Math.round((l.x - 1) * 100), pct: l.pct, tokens: buy.tokens * l.pct / 100, ref, active: true, createdAt: Date.now(), plan: true }));
      save(LS.orders, S.orders);
    }
    $('mBody').insertAdjacentHTML('beforeend', '<div class="notice good">' + esc(d.name) + ' est lancé en démo. Le marché simulé démarre : suivez son prix, vos ordres et sa diffusion comme pour un vrai token. <button class="btn sm primary" data-dtok="' + mint + '" type="button">Voir le token</button></div>' + demoCta());
    toast('Lancement démo', d.name + ' · wallet démo ' + fSol(DEMO.bal), 'g');
    renderAll();
  }
  // le marché simulé avance tant que la démo est ouverte
  setInterval(() => {
    if (!cfg.sim || !Object.keys(DM.tok).length || document.hidden) return;
    dmRun();
    Object.keys(DM.tok).forEach((m) => { if (S.cache[m]) dmLoad(m); });
  }, 3000);

  /* ---------- achat / vente */
  async function trade(mint, side, amountStr, opts) {
    opts = opts || {};
    // démo sans compte ou sans wallet : opération locale sur le wallet démo, sans vérification
    if (cfg.sim) return demoTrade(mint, side, amountStr, opts);
    if (!S.wallet) { toast('Wallet non connecté', 'Connectez votre wallet pour préparer la transaction.', 'a'); return walletMenu(); }
    if (!cfg.sim && !(await ensureSigner())) return;
    if (S.busy) return; S.busy = true;
    let dry = !!cfg.sim, how = cfg.sim ? 'demo' : 'real';
    try {
      const C = await loadToken(mint, false);
      if (!C.curve.exists) throw new Error('Marché introuvable pour ce token (ni pump.fun, ni DEX Screener).');
      const sym = (C.meta && C.meta.symbol) || short(mint);
      let q = null, amount, denom;
      if (side === 'buy') {
        const sol = num(amountStr); if (!(sol > 0)) throw new Error('Montant SOL invalide.');
        if (sol > cfg.maxSol) throw new Error('Au-delà de votre limite par trade (' + fSol(cfg.maxSol) + '). Modifiez-la dans Réglages si c\'est voulu.');
        if (!cfg.sim && S.bal != null && sol + 0.01 > S.bal) throw new Error('Solde insuffisant : ' + fSol(S.bal) + ' disponibles.');
        q = C.curve.complete ? null : quoteBuy(C.curve, sol); amount = sol; denom = 'true';
      } else {
        const bal = C.myBal || 0;
        let tokens;
        if (/%$/.test(String(amountStr))) { const p = num(String(amountStr).replace('%', '')); if (!(p > 0 && p <= 100)) throw new Error('Pourcentage invalide.'); tokens = bal * p / 100; amount = p + '%'; }
        else { tokens = num(amountStr); amount = tokens; }
        if (!(tokens > 0)) throw new Error(bal ? 'Quantité invalide.' : 'Vous ne détenez pas ce token.');
        if (!cfg.sim && tokens > bal * 1.0001) throw new Error('Vous ne détenez que ' + fTok(bal) + ' ' + sym + '.');
        q = C.curve.complete ? null : quoteSell(C.curve, tokens); denom = 'false';
      }
      const recap = '<div class="recap"><div class="kv">' +
        '<span>Opération</span><span>' + (side === 'buy' ? 'Achat' : 'Vente') + ' de ' + esc(sym) + '</span>' +
        (side === 'buy' ? '<span>Vous payez</span><span>' + fSolH(amount) + '</span><span>Vous recevez environ</span><span>' + (q ? fTok(q.tokens) + ' ' + esc(sym) : 'selon le pool') + '</span>'
          : '<span>Vous vendez</span><span>' + (typeof amount === 'string' ? amount + ' · ' : '') + (q ? fTok(q.tokens) : '') + ' ' + esc(sym) + '</span><span>Vous recevez environ</span><span>' + (q ? fSolH(q.sol) : 'selon le pool') + '</span>') +
        (q ? '<span>Impact sur le prix</span><span class="' + (Math.abs(q.impact) > 5 ? 'warn' : '') + '">' + fPct(q.impact, 2) + '</span><span>Frais estimés</span><span>' + fSolH(q.fees, 4) + '</span><span>Minimum garanti</span><span>' + (side === 'buy' ? fTok(q.minOut) + ' ' + esc(sym) : fSolH(q.minOut)) + '</span>' : '') +
        '<span>Slippage max</span><span>' + fPct(cfg.slippage, 0) + '</span>' + (cfg.sim ? '<span>Mode</span><span><span class="badge v">démo</span></span>' : '') + '</div></div>' +
        (opts.note ? '<div class="notice info">' + esc(opts.note) + '</div>' : '') +
        (cfg.sim ? '<p>La transaction sera préparée et vérifiée sur la blockchain, sans être envoyée.</p>' : S.wallet.id === 'session' ? '<p>Le wallet rapide signe dès que vous confirmez : aucune autre fenêtre.</p>' : '<p>Votre wallet va vous présenter la transaction : vérifiez le montant avant de signer.</p>');
      how = await confirmTest(opts.title || (side === 'buy' ? 'Acheter ' : 'Vendre ') + sym + ' ?', recap, cfg.sim ? 'Vérifier en démo' : (side === 'buy' ? 'Acheter' : 'Vendre'), side === 'sell');
      if (!how) return; dry = how !== 'real';
      const body = { publicKey: S.wallet.pk, action: side, mint, amount, denominatedInSol: denom, slippage: cfg.slippage, priorityFee: cfg.priorityFee, pool: C.curve.complete ? 'auto' : 'pump' };
      // token migré (PumpSwap) : PumpPortal automatiquement, quel que soit le moteur choisi
      const migrated = !!C.curve.complete, direct = cfg.engine !== 'portal' && !migrated;
      const viaPortal = async (x) => { x.tx = await portalTx(Object.assign({}, body, { pool: 'auto' })); return C.curve.ext ? dexName(C.curve) + ', routé par PumpPortal' : migrated ? 'token migré, routé par PumpPortal' : ''; };
      const steps = [
        { label: direct ? 'Préparation de la transaction (programme pump.fun)' : 'Préparation de la transaction (PumpPortal)', run: async (x) => {
          if (!direct) return viaPortal(x);
          try {
            if (side === 'buy') { x.tx = await directTrade(mint, 'buy', amount); return; }
            const raw = await tokenRaw(S.wallet.pk, mint);
            let sellRaw = typeof amount === 'string' ? raw * BigInt(Math.round(num(amount) * 100)) / 10000n : BigInt(Math.floor(amount * 1e6));
            if (sellRaw > raw) sellRaw = raw;
            if (sellRaw <= 0n) throw new Error('Vous ne détenez pas ce token dans ce wallet.');
            x.tx = await directTrade(mint, 'sell', sellRaw.toString());
          } catch (e) { if (e.message !== 'MIGRATED') throw e; await viaPortal(x); return 'token migré entre-temps, routé par PumpPortal'; }
        } },
        { label: 'Vérification sur la blockchain', run: async (x) => { const v = await simulate(x.tx); x.logs = (v.logs || []).slice(-12).join('\n'); if (v.err) throw new Error(simError(v)); x.logs = ''; return 'acceptée' + (direct && LAST_FEE ? ' · priorité ' + LAST_FEE.label.toLowerCase() + ' ≈ ' + fSol(LAST_FEE.sol, 5) : ''); } },
      ];
      if (!dry) {
        steps.push({ label: signLabel(), run: async (x) => { x.sig = await signAndSend(x.tx); return short(x.sig, 6); } });
        steps.push({ label: 'Confirmation sur la blockchain', run: async (x) => await confirmSig(x.sig) });
      }
      const ctx = await runFlow((side === 'buy' ? 'Achat ' : 'Vente ') + sym, steps);
      if (ctx.error) { journalAdd({ type: side, mint, symbol: sym, sim: dry, status: 'err', err: ctx.error.message, sol: 0, tokens: 0 }); return; }
      let sol = side === 'buy' ? -amount : (q ? q.sol : 0), tokens = q ? (side === 'buy' ? q.tokens : -q.tokens) : 0, est = true;
      if (!dry) { const d = await actualDeltas(ctx.sig, mint); if (d) { sol = side === 'buy' ? -d.sol : d.sol; tokens = side === 'buy' ? d.tokens : -d.tokens; est = false; } }
      journalAdd({ type: side, mint, symbol: sym, sim: dry, status: 'ok', sig: ctx.sig || '', sol, tokens, est });
      $('mBody').insertAdjacentHTML('beforeend', dry ? dryNote(how) : '<div class="notice good">Transaction confirmée. <a href="' + solscan(ctx.sig) + '" target="_blank" rel="noopener">Voir sur Solscan</a></div>');
      toast(dry ? (how === 'test' ? 'Test réussi' : 'Démo réussie') : (side === 'buy' ? 'Achat confirmé' : 'Vente confirmée'), sym, 'g');
      refreshBal(); delete S.cache[mint]; refreshView();
      return true;
    } catch (e) { toast('Opération impossible', e.message, 'r'); }
    finally { S.busy = false; renderTop(); }
  }

  /* ---------- création */
  const imgExt = (b) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[b && b.type] || 'png');
  // image en ligne → fichier, sans réseau (la politique de sécurité du site interdit fetch sur data:)
  function dataBlob(u) {
    if (!/^data:/.test(u || '')) return null;
    const i = u.indexOf(','), type = (u.slice(5, i).split(';')[0]) || 'image/png', bin = atob(u.slice(i + 1)), out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return new Blob([out], { type });
  }
  async function uploadMeta(d) {
    const blob = S.imgBlob || (d.image ? (dataBlob(d.image) || await (await fetch(d.image)).blob()) : null);
    if (!blob) throw new Error('Logo manquant.');
    if (cfg.metaMethod === 'pinata') {
      if (!cfg.pinataJwt) throw new Error('Jeton Pinata manquant (Réglages).');
      const up = async (file, name) => {
        const fd = new FormData(); fd.append('file', file, name); fd.append('network', 'public');
        const r = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.pinataJwt }, body: fd });
        if (!r.ok) throw new Error('Pinata a refusé l\'envoi (' + r.status + ').');
        const j = await r.json(); return 'https://ipfs.io/ipfs/' + j.data.cid;
      };
      const img = await up(blob, 'logo.' + imgExt(blob));
      const meta = { name: d.name, symbol: d.symbol, description: d.desc, image: img, showName: true, createdOn: 'https://pump.fun', twitter: d.tw || undefined, telegram: d.tg || undefined, website: d.web || undefined };
      return up(new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'metadata.json');
    }
    const fd = new FormData();
    fd.append('file', blob, 'logo.' + imgExt(blob)); fd.append('name', d.name); fd.append('symbol', d.symbol); fd.append('description', d.desc);
    fd.append('twitter', d.tw || ''); fd.append('telegram', d.tg || ''); fd.append('website', d.web || ''); fd.append('showName', 'true');
    // par le serveur TokenStudio (compte connecté) : pas de blocage du navigateur, aucune clé à fournir
    if (CLOUD && window.TSUploadMeta) return window.TSUploadMeta(fd);
    let r;
    try { r = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: fd }); }
    catch (e) { throw new Error('pump.fun n\'accepte pas l\'envoi depuis cette page. Choisissez Pinata dans Réglages (gratuit).'); }
    if (!r.ok) throw new Error('pump.fun a refusé les métadonnées (' + r.status + '). Essayez Pinata dans Réglages.');
    const j = await r.json(); if (!j.metadataUri) throw new Error('Réponse inattendue de pump.fun.');
    return j.metadataUri;
  }
  async function launch() {
    const R = readiness();
    if (R.blocking.length) { toast('Pas encore prêt', R.blocking[0], 'a'); return; }
    if (cfg.sim) return demoLaunch();
    if (!S.wallet) return walletMenu();
    if (!cfg.sim && !(await ensureSigner())) return;
    const d = S.draft, PL = PLATFORMS.pump, dev = num(d.dev) || 0, q = dev > 0 ? quoteBuy(INIT_CURVE, dev) : null;
    // Créateur affiché sur pump.fun : le wallet principal (Phantom…) de préférence, même quand le wallet rapide signe
    const ses = S.wallet.id === 'session' || S.wallet.id === 'server', ext = S.ext, canPick = ses && !!ext && cfg.engine !== 'portal';
    const who = (w) => (w.id === 'session' ? 'Wallet rapide' : esc(w.name)) + ' · <span class="mono">' + short(w.pk) + '</span>';
    const creatorHtml = canPick
      ? '<div class="cr-pick"><div class="cr-h">Créateur affiché sur pump.fun</div>' +
        '<label class="cr-opt"><input type="radio" name="crWho" value="ext" checked><span><b>' + who(ext) + '</b><small>Recommandé · votre profil pump.fun s\'affiche et les frais de créateur arrivent sur ' + esc(ext.name) + '. Le wallet rapide paie et signe, sans fenêtre.</small></span></label>' +
        '<label class="cr-opt"><input type="radio" name="crWho" value="quick"><span><b>' + who(S.wallet) + '</b><small>Son adresse s\'affiche comme créateur et reçoit les frais.</small></span></label></div>'
      : '';
    const recap = '<div class="recap"><div class="kv">' +
      '<span>Token</span><span>' + esc(d.name) + ' · $' + esc(d.symbol) + '</span>' +
      (canPick ? '' : '<span>Créateur affiché</span><span>' + who(S.wallet) + (ses ? '' : ' <small class="dim">(ou votre pseudo pump.fun)</small>') + '</span>') +
      '<span>Achat du créateur</span><span>' + (dev ? fSolH(dev) + (q ? ' → ' + fTok(q.tokens) + ' (' + fPct(q.supplyPct, 2) + ' de l\'offre)' : '') : 'aucun') + '</span>' +
      '<span>Frais de réseau et comptes</span><span>≈ ' + fSolH(PL.fee, 2) + '</span>' +
      '<span>Coût total estimé</span><span>' + fSolH(dev + PL.fee) + '</span>' +
      '<span>Logo et fiche</span><span>' + (cfg.metaMethod === 'pinata' ? 'Pinata (IPFS)' : 'pump.fun (IPFS), envoyés par le serveur') + '</span>' +
      (cfg.sim ? '<span>Mode</span><span><span class="badge v">démo</span></span>' : '') + '</div></div>' + creatorHtml +
      (ses && !ext ? '<div class="notice">Le wallet rapide sera affiché comme créateur et recevra les frais de créateur. Pour lancer en votre nom, connectez Phantom (ou votre wallet principal) : il sera proposé comme créateur.</div>' : '') +
      (ses && ext && cfg.engine === 'portal' ? '<div class="notice">Avec PumpPortal, le créateur est forcément le wallet qui signe (wallet rapide). Choisissez le moteur Direct dans Réglages pour afficher ' + esc(ext.name) + '.</div>' : '') +
      (d.tpOn && dev > 0 ? '<div class="notice info">Plan de prise de profit : ' + d.tp.map((l) => '×' + fr(l.x, 1).replace(',0', '') + ' → ' + l.pct + ' %').join(' · ') + (d.sl > 0 ? (d.slMode === 'trail' ? ' · stop suiveur −' : ' · stop −') + d.sl + ' %' : '') + '. ' + (canAuto() ? 'Le wallet rapide exécutera chaque vente automatiquement.' : 'Chaque vente vous sera présentée à signer.') + '</div>' : '') +
      (cfg.sim ? '<p>Simulation : le token est préparé et vérifié sur la blockchain, mais rien n\'est publié ni envoyé.</p>' : '<p>Le token sera publié sur ' + PL.n + ' et visible par tous. Votre wallet va vous présenter la transaction : vérifiez avant de signer. Une création ne s\'annule pas.</p>');
    const how = await confirmTest(cfg.sim ? 'Lancer ' + d.name + ' en démo ?' : 'Lancer ' + d.name + ' ?', recap, cfg.sim ? 'Vérifier en démo' : 'Lancer le token', !cfg.sim, 'Tester avant de lancer');
    if (!how) return;
    const dry = how !== 'real';
    const pick = document.querySelector('input[name="crWho"]:checked');
    const creatorPk = canPick && (!pick || pick.value === 'ext') ? ext.pk : S.wallet.pk;
    S.busy = true;
    const mintKp = W3().Keypair.generate(), mint = mintKp.publicKey.toBase58();
    const steps = [
      { label: dry ? 'Métadonnées (non envoyées)' : 'Envoi du logo et des métadonnées (IPFS)', run: async (x) => { x.uri = dry ? 'https://ipfs.io/ipfs/simulation' : await uploadMeta(d); return dry ? 'ignoré' : 'ok'; } },
      { label: cfg.engine === 'portal' ? 'Préparation de la création (PumpPortal)' : 'Préparation de la création (programme pump.fun)', run: async (x) => {
        x.tx = cfg.engine === 'portal' ? await portalTx({ publicKey: S.wallet.pk, action: 'create', tokenMetadata: { name: d.name, symbol: d.symbol, uri: x.uri }, mint, denominatedInSol: 'true', amount: dev, slippage: cfg.slippage, priorityFee: cfg.priorityFee, pool: 'pump' })
          : await directCreate(mintKp, d, x.uri, dev, creatorPk);
      } },
      { label: 'Vérification sur la blockchain', run: async (x) => { const v = await simulate(x.tx); x.logs = (v.logs || []).slice(-12).join('\n'); if (v.err) throw new Error(simError(v)); x.logs = ''; return 'acceptée'; } },
    ];
    if (!dry) {
      steps.push({ label: signLabel(), run: async (x) => { x.sig = await signAndSend(x.tx, [mintKp]); return short(x.sig, 6); } });
      steps.push({ label: 'Confirmation sur la blockchain', run: async (x) => await confirmSig(x.sig) });
    }
    try {
      const ctx = await runFlow((dry ? 'Test · ' : 'Lancement · ') + d.name, steps);
      if (ctx.error) {
        journalAdd({ type: 'create', mint, symbol: d.symbol, sim: dry, status: 'err', err: ctx.error.message, sol: 0, tokens: 0 });
        if (/pump\.fun n'accepte pas|refusé les métadonnées|refusé la fiche|pump\.fun ne répond|Réponse inattendue|Pinata/.test(ctx.error.message || '')) $('mBody').insertAdjacentHTML('beforeend', '<div class="notice info">L\'envoi du logo a échoué. Un jeton Pinata gratuit règle le problème. <button class="btn sm primary" data-act="keyhelp" data-k="pinata" type="button">Ajouter un jeton Pinata</button></div>');
        return;
      }
      if (dry) {
        journalAdd({ type: 'create', mint, symbol: d.symbol, sim: true, status: 'ok', sol: -dev, tokens: q ? q.tokens : 0, est: true });
        $('mBody').insertAdjacentHTML('beforeend', dryNote(how));
        toast(how === 'test' ? 'Test réussi' : 'Démo réussie', d.name + ' est prêt à être lancé.', 'g');
        return;
      }
      const real = await actualDeltas(ctx.sig, mint);
      const thumb = await thumbnail(d.image);
      S.tokens.unshift({ mint, name: d.name, symbol: d.symbol, image: thumb, createdAt: Date.now(), sig: ctx.sig, dev, platform: 'pump', creator: creatorPk, desc: d.desc, tw: d.tw, tg: d.tg, web: d.web });
      save(LS.tokens, S.tokens);
      journalAdd({ type: 'create', mint, symbol: d.symbol, sim: false, status: 'ok', sig: ctx.sig, sol: -(real ? real.sol : dev), tokens: real ? real.tokens : (q ? q.tokens : 0), est: !real });
      $('mBody').insertAdjacentHTML('beforeend', '<div class="notice good">' + esc(d.name) + ' est en ligne. <a href="' + PL.url(mint) + '" target="_blank" rel="noopener">' + PL.n + '</a> · <a href="' + solscan(ctx.sig) + '" target="_blank" rel="noopener">Solscan</a></div>');
      toast('Token lancé', d.name + ' · ' + short(mint), 'g');
      // plan de prise de profit → ordres préparés (chaque vente demandera votre signature)
      const devTok = real ? real.tokens : (q ? q.tokens : 0), devSol = real ? real.sol : dev;
      if (d.tpOn && devTok > 0 && tpValid().ok) {
        const ref = devSol / devTok;
        d.tp.forEach((l, i) => S.orders.push({ id: Date.now().toString(36) + i, mint, symbol: d.symbol, kind: 'tp', value: Math.round((l.x - 1) * 100), pct: l.pct, tokens: devTok * l.pct / 100, ref, active: true, createdAt: Date.now(), plan: true }));
        if (d.sl > 0) S.orders.push(Object.assign({ id: Date.now().toString(36) + 's', mint, symbol: d.symbol, kind: d.slMode === 'trail' ? 'trail' : 'sl', value: d.sl, pct: 100, ref, active: true, createdAt: Date.now(), plan: true }, d.slMode === 'trail' ? { arm: 0, armed: true, peak: ref } : {}));
        save(LS.orders, S.orders);
        $('mBody').insertAdjacentHTML('beforeend', '<div class="notice info">Plan de prise de profit actif : ' + d.tp.length + ' palier(s)' + (d.sl > 0 ? ' et un stop' : '') + '. Le studio surveille le prix et vous présentera chaque vente à signer.</div>');
      }
      S.view.mine = mint; refreshBal(); renderAll();
    } finally { S.busy = false; }
  }
  function thumbnail(src) {
    return new Promise((res) => {
      if (!src) return res('');
      const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').drawImage(im, 0, 0, 96, 96); try { res(c.toDataURL('image/webp', 0.85));   /* vignette légère, gardée avec le token sur le compte */ } catch (e) { res(''); } }; im.onerror = () => res(''); im.src = src;
    });
  }

  /* ================================================================ générateur de concept (v3, international) */
  // Noms courts, prononçables dans toutes les langues, sans accent ni référence locale.
  const THEMES = {
    luxe: { label: 'Luxe et rareté', ic: '◈', pal: 0, mascot: ['💎', '👑', '🦢', '🐆'],
      nouns: ['Aurelia', 'Velora', 'Opaline', 'Seraph', 'Elysia', 'Noctis', 'Aether', 'Sable', 'Vesper', 'Lustre', 'Regalia', 'Argent', 'Celeste', 'Solenne', 'Aurion', 'Valen', 'Orra', 'Maison'],
      adj: ['Gilded', 'Rare', 'Noble', 'Silent', 'Velvet', 'Ivory'], pairs: false, premium: true },
    meme: { label: 'Mèmes animaux', ic: '◐', pal: 8, mascot: ['🐸', '🦦', '🐧', '🦫', '🦥', '🐼', '🦊', '🐹'],
      nouns: ['Otter', 'Toad', 'Capy', 'Gecko', 'Quokka', 'Corgi', 'Panda', 'Lynx', 'Hippo', 'Moose', 'Goose', 'Walrus', 'Axolotl', 'Koala', 'Llama', 'Raccoon'],
      adj: ['Lil', 'Big', 'Chill', 'Rich', 'Sleepy', 'Tiny', 'Smug', 'Lucky', 'Sad', 'Based'] },
    internet: { label: 'Culture internet', ic: '◇', pal: 5, mascot: ['🗿', '😶', '🫠', '💎'],
      nouns: ['Aura', 'Vibe', 'Lore', 'Rizz', 'Sigma', 'Mog', 'Cope', 'Fren', 'Gm', 'Ser', 'Npc', 'Grind', 'Delulu', 'Cooked'],
      adj: ['Peak', 'Main', 'Pure', 'Final'] },
    space: { label: 'Espace', ic: '✦', pal: 2, mascot: ['🪐', '☄️', '🌙', '🛸'],
      nouns: ['Nova', 'Orbit', 'Lumen', 'Zenith', 'Comet', 'Nebula', 'Quasar', 'Vega', 'Astra', 'Eclipse', 'Halo', 'Pulsar'],
      adj: ['Dark', 'Deep', 'Silent', 'Outer', 'Lunar'] },
    tech: { label: 'IA et tech', ic: '⬡', pal: 7, mascot: ['🤖', '👾', '⚡'],
      nouns: ['Neuron', 'Cortex', 'Synth', 'Vector', 'Pixel', 'Kernel', 'Cipher', 'Echo', 'Glitch', 'Signal', 'Proxy', 'Logic'],
      adj: ['Hyper', 'Zero', 'Neo', 'Quantum', 'Open', 'Infinite'] },
    prestige: { label: 'Prestige', ic: '♛', pal: 6, premium: true, mascot: ['👑', '💎'],
      nouns: ['Crown', 'Onyx', 'Ivory', 'Velvet', 'Monarch', 'Opal', 'Regent', 'Sterling', 'Aurum', 'Marquis', 'Laurel', 'Ermine'],
      adj: ['Royal', 'Black', 'Silver', 'Grand', 'Old'] },
    myth: { label: 'Mythologie', ic: 'Ω', pal: 3, mascot: ['🐉', '🦅', '🔱'],
      nouns: ['Atlas', 'Kraken', 'Phoenix', 'Hydra', 'Titan', 'Midas', 'Icarus', 'Golem', 'Oracle', 'Cerberus', 'Minotaur', 'Valkyrie'],
      adj: ['Last', 'Iron', 'Young', 'Lost', 'Wild', 'Elder'] },
    ocean: { label: 'Océan', ic: '≈', pal: 2, mascot: ['🐬', '🐙', '🐚', '🦈'],
      nouns: ['Tide', 'Coral', 'Marlin', 'Reef', 'Wave', 'Nautilus', 'Lagoon', 'Orca', 'Squid', 'Anchor', 'Drift', 'Abyss', 'Manta', 'Shoal', 'Koi', 'Harbor', 'Siren', 'Surf'],
      adj: ['Deep', 'Blue', 'Salty', 'Tidal', 'Lost', 'Wild', 'Calm'] },
    food: { label: 'Gourmandise', ic: '◔', pal: 6, mascot: ['🍩', '🍒', '🧁', '☕'],
      nouns: ['Donut', 'Mochi', 'Cherry', 'Waffle', 'Bagel', 'Taco', 'Latte', 'Honey', 'Muffin', 'Pudding', 'Nacho', 'Sushi', 'Biscuit', 'Toffee', 'Gelato', 'Bao', 'Mocha', 'Berry'],
      adj: ['Sweet', 'Crispy', 'Hot', 'Glazed', 'Sticky', 'Fresh', 'Tiny'] },
    gaming: { label: 'Jeux vidéo', ic: '◩', pal: 4, mascot: ['🎮', '👾', '🕹️'],
      nouns: ['Pixel', 'Combo', 'Respawn', 'Loot', 'Quest', 'Boss', 'Arcade', 'Joystick', 'Speedrun', 'Critical', 'Level', 'Raid', 'Glitch', 'Ghost', 'Coin', 'Save', 'Lobby', 'Noob'],
      adj: ['Final', 'Retro', 'Mega', 'Super', 'Hard', 'Ultra', 'Pro'] },
    nature: { label: 'Nature', ic: '❦', pal: 3, mascot: ['🌿', '🍄', '🌸', '🌳'],
      nouns: ['Fern', 'Moss', 'Willow', 'Cedar', 'Maple', 'Clover', 'Lotus', 'Sprout', 'Acorn', 'Birch', 'Sage', 'Ivy', 'Bloom', 'Pine', 'Meadow', 'Mushroom', 'Spore', 'Oak'],
      adj: ['Wild', 'Green', 'Little', 'Ancient', 'Quiet', 'Golden', 'Forest'] },
    brand: { label: 'Nom de marque', ic: '◆', pal: 1, premium: true, mascot: ['✨'], nouns: [], adj: [] },
  };
  // Noms supplémentaires pour varier les idées
  const MORE_NOUNS = {
    luxe: ['Perle', 'Emerald', 'Satin', 'Riviera', 'Cartier', 'Ivoire', 'Jewel', 'Essence', 'Couture', 'Ambre', 'Opaline', 'Velvet', 'Pearl', 'Gem'],
    meme: ['Doge', 'Shiba', 'Penguin', 'Duck', 'Kitty', 'Bunny', 'Pug', 'Hamster', 'Sloth', 'Frog', 'Cat', 'Puppy', 'Seal', 'Owl'],
    internet: ['Smile', 'Heart', 'Crush', 'Lol', 'Based', 'Chad', 'Wagmi', 'Hodl', 'Kek', 'Mood', 'Touch Grass', 'Meme'],
    space: ['Sol', 'Helios', 'Meteor', 'Ufo', 'Alien', 'Cosmos', 'Galaxy', 'Starlight', 'Apollo', 'Mars', 'Titan', 'Solar'],
    tech: ['Quantum', 'Atom', 'Node', 'Mesh', 'Byte', 'Nexus', 'Circuit', 'Bolt', 'Volt', 'Matrix', 'Agent', 'Core'],
    prestige: ['Aegis', 'Shield', 'Victor', 'Laurel', 'Baron', 'Duke', 'Empire', 'Legacy', 'Noble', 'Sovereign'],
    myth: ['Blade', 'Valhalla', 'Seer', 'Angel', 'Aether', 'Odin', 'Thor', 'Anubis', 'Zeus', 'Ember', 'Inferno', 'Saber'],
  };
  Object.keys(MORE_NOUNS).forEach((k) => { if (THEMES[k]) MORE_NOUNS[k].forEach((n) => { if (!THEMES[k].nouns.includes(n)) THEMES[k].nouns.push(n); }); });
  // Six univers affichés ; les noms des anciens univers sont fusionnés dans le plus proche
  const THEME_SHOWN = ['meme', 'internet', 'luxe', 'space', 'tech', 'gaming'];
  const THEME_MERGE = { luxe: ['prestige'], meme: ['food', 'ocean', 'nature'], gaming: ['myth'] };
  Object.keys(THEME_MERGE).forEach((k) => THEME_MERGE[k].forEach((src) => { const a = THEMES[k], b = THEMES[src]; if (!a || !b) return; b.nouns.forEach((n) => { if (!a.nouns.includes(n)) a.nouns.push(n); }); (b.adj || []).forEach((n) => { if (!a.adj.includes(n)) a.adj.push(n); }); }));
  // Illustrations des univers (SVG compacts, teinte propre à chaque univers via --th)
  const UNIV_ART = {
    luxe: '<svg viewBox="0 0 120 72" aria-hidden="true"><defs><linearGradient id="ua-l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6dc"/><stop offset=".55" stop-color="var(--th)"/><stop offset="1" stop-color="#6b4f1d"/></linearGradient></defs><path d="M44 22h32l10 12-26 28-26-28z" fill="url(#ua-l)"/><path d="M34 34h52M44 22l16 40 16-40M50 22l10 12 10-12" fill="none" stroke="#1b1407" stroke-opacity=".35" stroke-width="1.2"/><path d="M92 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="var(--th)"/><circle cx="26" cy="52" r="2" fill="var(--th)" opacity=".7"/></svg>',
    meme: '<svg viewBox="0 0 120 72" aria-hidden="true"><ellipse cx="60" cy="46" rx="30" ry="20" fill="var(--th)"/><circle cx="46" cy="28" r="10" fill="var(--th)"/><circle cx="74" cy="28" r="10" fill="var(--th)"/><circle cx="46" cy="28" r="6" fill="#fff"/><circle cx="74" cy="28" r="6" fill="#fff"/><circle cx="47.5" cy="29" r="3" fill="#14120f"/><circle cx="75.5" cy="29" r="3" fill="#14120f"/><path d="M48 50q12 9 24 0" fill="none" stroke="#14120f" stroke-width="2.4" stroke-linecap="round"/><circle cx="40" cy="47" r="3.5" fill="#ff8a8a" opacity=".55"/><circle cx="80" cy="47" r="3.5" fill="#ff8a8a" opacity=".55"/></svg>',
    internet: '<svg viewBox="0 0 120 72" aria-hidden="true"><rect x="22" y="12" width="76" height="48" rx="7" fill="none" stroke="var(--th)" stroke-width="2"/><path d="M22 22h76" stroke="var(--th)" stroke-width="2"/><circle cx="29" cy="17" r="1.6" fill="var(--th)"/><circle cx="35" cy="17" r="1.6" fill="var(--th)"/><rect x="31" y="29" width="34" height="6" rx="3" fill="var(--th)" opacity=".85"/><rect x="31" y="39" width="22" height="6" rx="3" fill="var(--th)" opacity=".45"/><path d="M74 36l14 6-6 2-2 6z" fill="#fff"/><path d="M84 24c2-3 7-1 5 3l-5 4-5-4c-2-4 3-6 5-3z" fill="#ff8a8a"/></svg>',
    space: '<svg viewBox="0 0 120 72" aria-hidden="true"><defs><radialGradient id="ua-s" cx=".35" cy=".35"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="var(--th)"/><stop offset="1" stop-color="#1d2a4a"/></radialGradient></defs><circle cx="60" cy="38" r="17" fill="url(#ua-s)"/><ellipse cx="60" cy="40" rx="32" ry="8" fill="none" stroke="var(--th)" stroke-width="2.2" transform="rotate(-14 60 40)"/><circle cx="22" cy="16" r="1.6" fill="#fff"/><circle cx="98" cy="22" r="1.2" fill="#fff"/><circle cx="92" cy="58" r="1.8" fill="#fff" opacity=".8"/><circle cx="30" cy="60" r="1" fill="#fff"/><path d="M100 10l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill="var(--th)"/></svg>',
    tech: '<svg viewBox="0 0 120 72" aria-hidden="true"><path d="M14 24h22M14 48h22M84 24h22M84 48h22M48 8v14M72 8v14M48 50v14M72 50v14" stroke="var(--th)" stroke-width="2" stroke-linecap="round" opacity=".7"/><circle cx="14" cy="24" r="3" fill="var(--th)"/><circle cx="106" cy="48" r="3" fill="var(--th)"/><circle cx="48" cy="64" r="3" fill="var(--th)"/><rect x="38" y="20" width="44" height="32" rx="6" fill="#16140f" stroke="var(--th)" stroke-width="2"/><rect x="48" y="28" width="24" height="16" rx="3" fill="var(--th)" opacity=".9"/><path d="M53 36h14" stroke="#16140f" stroke-width="2"/></svg>',
    prestige: '<svg viewBox="0 0 120 72" aria-hidden="true"><defs><linearGradient id="ua-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3d1"/><stop offset="1" stop-color="var(--th)"/></linearGradient></defs><path d="M34 52l-6-30 18 14 14-22 14 22 18-14-6 30z" fill="url(#ua-p)"/><rect x="34" y="54" width="52" height="7" rx="2" fill="var(--th)"/><circle cx="60" cy="13" r="3.5" fill="var(--th)"/><circle cx="28" cy="20" r="3" fill="var(--th)"/><circle cx="92" cy="20" r="3" fill="var(--th)"/><circle cx="60" cy="44" r="4" fill="#c2404a"/></svg>',
    myth: '<svg viewBox="0 0 120 72" aria-hidden="true"><path d="M60 66V14M60 14l-5 8h10z" stroke="var(--th)" stroke-width="3" fill="var(--th)" stroke-linejoin="round"/><path d="M40 20c0 16 8 22 20 22s20-6 20-22" fill="none" stroke="var(--th)" stroke-width="3" stroke-linecap="round"/><path d="M40 20l-4 6h8zM80 20l-4 6h8z" fill="var(--th)"/><path d="M14 56c10-8 18-8 26-2M106 56c-10-8-18-8-26-2" fill="none" stroke="var(--th)" stroke-width="2" opacity=".5" stroke-linecap="round"/></svg>',
    brand: '<svg viewBox="0 0 120 72" aria-hidden="true"><circle cx="60" cy="36" r="24" fill="none" stroke="var(--th)" stroke-width="2"/><circle cx="60" cy="36" r="19" fill="var(--th)" opacity=".14"/><path d="M50 46l10-22 10 22M53.5 39h13" fill="none" stroke="var(--th)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 36c-6-4-8-10-6-16M92 36c6-4 8-10 6-16M26 30l-5-2M94 30l5-2" fill="none" stroke="var(--th)" stroke-width="1.8" stroke-linecap="round" opacity=".6"/></svg>',
  };
  Object.assign(UNIV_ART, {
    ocean: '<svg viewBox="0 0 120 72" aria-hidden="true"><path d="M16 58C24 30 50 12 78 16C92 18 100 30 98 42C90 30 76 30 72 40C70 48 80 52 88 50C72 62 40 62 16 58Z" fill="var(--th)"/><path d="M30 52C40 40 52 32 66 30" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.6"/><circle cx="86" cy="22" r="2" fill="#fff" opacity=".8"/><circle cx="94" cy="28" r="1.4" fill="#fff" opacity=".8"/></svg>',
    food: '<svg viewBox="0 0 120 72" aria-hidden="true"><circle cx="60" cy="38" r="23" fill="#e2a86a"/><circle cx="60" cy="38" r="19.5" fill="var(--th)"/><circle cx="60" cy="38" r="9" fill="#16140f"/><circle cx="60" cy="38" r="8" fill="#e2a86a"/><circle cx="60" cy="38" r="7" fill="#16140f"/><rect x="44" y="27" width="6" height="2" fill="#fff" transform="rotate(25 47 28)"/><rect x="68" y="29" width="6" height="2" fill="#7cc4ff" transform="rotate(-35 71 30)"/><rect x="50" y="49" width="6" height="2" fill="#ffe27a" transform="rotate(60 53 50)"/><rect x="70" y="45" width="6" height="2" fill="#7fd18a"/></svg>',
    gaming: '<svg viewBox="0 0 120 72" aria-hidden="true"><path d="M38 22h44a16 16 0 0 1 16 16v6a14 14 0 0 1-24 10l-6-6H52l-6 6a14 14 0 0 1-24-10v-6a16 16 0 0 1 16-16z" fill="var(--th)"/><path d="M34 36h4v-4h4v4h4v4h-4v4h-4v-4h-4z" fill="#16140f"/><circle cx="80" cy="32" r="3" fill="#ff6b81"/><circle cx="86" cy="38" r="3" fill="#5fb6ff"/><circle cx="74" cy="38" r="3" fill="#ffd257"/><circle cx="80" cy="44" r="3" fill="#6fcf7f"/></svg>',
    nature: '<svg viewBox="0 0 120 72" aria-hidden="true"><path d="M50 40h20v18a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6z" fill="#f5ecdc"/><path d="M26 42C26 16 94 16 94 42Z" fill="var(--th)"/><circle cx="42" cy="30" r="4.4" fill="#fff5ee"/><circle cx="60" cy="24" r="5" fill="#fff5ee"/><circle cx="78" cy="32" r="3.8" fill="#fff5ee"/><ellipse cx="36" cy="64" rx="10" ry="2.4" fill="#6fcf7f"/><ellipse cx="86" cy="64" rx="8" ry="2" fill="#6fcf7f"/></svg>',
  });
  const UNIV_TINT = { luxe: '#d6b26e', meme: '#7fd18a', internet: '#7cc4ff', space: '#8fb4ff', tech: '#5fd4c4', prestige: '#e2c27a', myth: '#e8925a', brand: '#cfc6b4', ocean: '#5fb6ff', food: '#f59ac0', gaming: '#b59cff', nature: '#e0524f' };
  const UNIV_HINT = { luxe: 'Aurelia · Monarch', meme: 'Capy · Donut · Koi', internet: 'Aura · Rizz', space: 'Nova · Orbit', tech: 'Neuron · Synth', prestige: 'Crown · Onyx', myth: 'Phoenix · Atlas', brand: 'Votre propre nom', ocean: 'Coral · Orca', food: 'Mochi · Latte', gaming: 'Loot · Phoenix', nature: 'Fern · Lotus' };
  const TONES = { luxe: 'Premium', minimal: 'Sobre', witty: 'Décalé', community: 'Communauté' };
  const LANGS = { en: 'Anglais', fr: 'Français' };
  // Descriptions : courtes, sans superlatifs creux ni formules « Bienvenue dans… », ni promesse de gains.
  const DESC = {
    en: {
      luxe: ['{n}. Rare by design.', 'Quiet confidence, on-chain. {n}.', 'Fewer promises. Better taste. {n}.', 'Made for holders with patience.', '{n} is not for everyone. That is the point.', 'A fair launch, finished with care.', 'A {k} with standards.', 'Understated. Uncompromising. {n}.'],
      minimal: ['{n}. Nothing more, nothing less.', 'One coin. One idea. {n}.', '{n}. Simple by design.', 'No roadmap. No presale. Just {n}.', 'Less noise. More {n}.', '{n}, quietly on-chain.', 'A clean ticker for a clean idea.', 'Fair launch. Nothing hidden.'],
      witty: ['{n} doesn\'t do roadmaps. It does vibes.', 'The only {k} that checks the chart before breakfast.', '{n} has no utility and fully accepts it.', 'Somebody had to launch {n}. It was us.', 'Powered by conviction and very little sleep.', '{n}: zero utility, maximum character.', 'Your portfolio called. It asked for {n}.', 'The {k} your timeline didn\'t see coming.'],
      community: ['{n} belongs to whoever holds it.', 'Built by holders, for holders. That\'s {n}.', 'Fair launch. No team allocation. {n} is yours.', 'A {k} for the people who stay.', 'No insiders, no allocations. Only holders.', 'Every holder is part of the story.', 'Started small. Built together.', 'The community is the roadmap.'],
    },
    fr: {
      luxe: ['{n}. Rare par nature.', 'L\'assurance tranquille, sur la blockchain. {n}.', 'Moins de promesses. Plus de goût. {n}.', 'Pensé pour les holders patients.', '{n} n\'est pas fait pour tout le monde. C\'est voulu.', 'Un lancement équitable, soigné jusqu\'au détail.', 'Un {k} qui a des exigences.', 'Discret. Sans compromis. {n}.'],
      minimal: ['{n}. Rien de plus, rien de moins.', 'Un coin, une idée : {n}.', 'Pas de roadmap. Pas de prévente. Juste {n}.', '{n}, simple par principe.', 'Moins de bruit. Plus de {n}.', '{n}, discrètement sur la blockchain.', 'Un ticker net pour une idée nette.', 'Lancement équitable. Rien de caché.'],
      witty: ['{n} n\'a pas de roadmap. {n} a des vibes.', 'Le seul {k} qui regarde le graphique avant le café.', '{n} n\'a aucune utilité et l\'assume.', 'Il fallait bien que quelqu\'un lance {n}.', 'Alimenté par la conviction et peu de sommeil.', '{n} : zéro utilité, beaucoup de caractère.', 'Votre portefeuille a appelé. Il voulait {n}.', 'Le {k} que personne n\'avait vu venir.'],
      community: ['{n} appartient à ceux qui le gardent.', 'Fait par les holders, pour les holders.', 'Lancement équitable, aucune part réservée. {n} est à vous.', 'Un {k} pour ceux qui restent.', 'Pas d\'initiés, pas de réserve. Que des holders.', 'Chaque holder fait partie de l\'histoire.', 'Parti de rien, construit ensemble.', 'La communauté, c\'est la roadmap.'],
    },
  };
  const DESC2 = {
    en: { luxe: 'Fair launch on Solana. No presale, no team allocation.', minimal: '', witty: 'Not financial advice. Barely advice at all.', community: 'Fair launch on Solana.' },
    fr: { luxe: 'Lancement équitable sur Solana. Sans prévente ni réserve d\'équipe.', minimal: '', witty: 'Pas un conseil financier. À peine un conseil.', community: 'Lancement équitable sur Solana.' },
  };
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  // Mots inventés « marque » : syllabes simples, prononçables partout (Zuno, Kivra, Lumo…)
  const SYL_C = ['b', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'br', 'kr', 'tr', 'pl', 'st', 'fl'];
  const SYL_V = ['a', 'e', 'i', 'o', 'u', 'a', 'o'];
  const SYL_END = ['', '', '', 'x', 'n', 's', 'ra', 'na', 'lo', 'ix', 'on', 'ex', 'el', 'ia'];
  // Variante premium : finales douces et sonorités de maison (Velora, Aurion, Solenne…)
  const LUX_C = ['v', 'l', 'm', 'n', 's', 'r', 'th', 'c', 'el', 'au', 'or'], LUX_V = ['a', 'e', 'i', 'o', 'au', 'e'], LUX_END = ['ra', 'ria', 'lia', 'nne', 'on', 'ion', 'is', 'ys', 'elle', 'ora', 'ine', 'ium'];
  function brandableLux() {
    const w = cap(rnd(LUX_C) + rnd(LUX_V) + rnd(['l', 'r', 'v', 'n', 's', 'th']) + rnd(LUX_END));
    return w.length < 5 || w.length > 8 || /(.)\1\1|[aeiou]{3}|([^aeiou])\2|[^aeiouy]{3}/i.test(w) ? brandableLux() : w;
  }
  function brandable() {
    let w = rnd(SYL_C) + rnd(SYL_V);
    if (Math.random() < 0.7) w += rnd(SYL_C.filter((c) => c.length === 1)) + rnd(SYL_V);
    w += rnd(SYL_END);
    w = w.replace(/(.)\1\1/, '$1$1');
    const cons = w.replace(/[aeiou]/g, '');
    const ugly = /(.)\1/.test(w) || new Set(cons).size < cons.length || /(ar|ur|ir)r?$|^.?[aeiou]$/.test(w) || /[aeiou]{2}/.test(w);
    return ugly || w.length < 4 || w.length > 6 ? brandable() : cap(w);
  }
  function tickerFor(name) {
    const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    const one = words.length === 1 ? words[0] : null, last = words[words.length - 1] || 'COIN', first = words[0] || '';
    const cands = [];
    if (one) { if (one.length <= 7) cands.push(one); cands.push(one.slice(0, 4)); }
    else {
      if (last.length >= 3 && last.length <= 7 && !/^(LABS|ONE)$/.test(last)) cands.push(last);
      if (first.length >= 3 && first.length <= 7 && !/^(LIL|BIG|THE|MAX)$/.test(first)) cands.push(first);
      cands.push((first[0] + last.slice(0, 3)));
      cands.push((first[0] + last.replace(/[AEIOU]/g, '')).slice(0, 4));
    }
    return cands.find((t) => t.length >= 3 && t.length <= 7 && !FAMOUS.includes(t)) || cands[0] || 'COIN';
  }
  function scoreIdea(name, ticker, word) {
    const parts = [], L = name.length, words = name.split(' ');
    parts.push({ k: L <= 8 ? 'Nom très court' : L <= 12 ? 'Nom court' : 'Nom long', v: L <= 8 ? 20 : L <= 12 ? 14 : 5 });
    const tl = ticker.length; parts.push({ k: 'Ticker ' + tl + ' lettres', v: tl >= 3 && tl <= 5 ? 15 : tl <= 7 ? 12 : 4 });
    const lw = name.toLowerCase().replace(/[^a-z]/g, ''), vow = (lw.match(/[aeiouy]/g) || []).length / Math.max(1, lw.length);
    const pron = vow >= 0.3 && vow <= 0.6 && !/[bcdfghjklmnpqrstvwxz]{3}/.test(lw);
    parts.push({ k: pron ? 'Prononçable partout' : 'Difficile à dire', v: pron ? 15 : 4 });
    parts.push({ k: words.length === 1 ? 'Un seul mot' : words.length === 2 ? 'Deux mots' : 'Trop de mots', v: words.length === 1 ? 15 : words.length === 2 ? 10 : 2 });
    const mine = word && name.toLowerCase().includes(word.toLowerCase());
    const sound = /^[A-Za-z ]+$/.test(name);
    parts.push({ k: mine ? 'Votre mot' : sound ? 'Sonne international' : 'Caractères spéciaux', v: mine || sound ? 10 : 0 });
    const famous = FAMOUS.includes(ticker) || FAMOUS.some((f) => name.toUpperCase().replace(/\s/g, '') === f);
    const used = S.tokens.some((t) => t.symbol === ticker);
    parts.push({ k: famous ? 'Ticker déjà célèbre' : used ? 'Déjà utilisé par vous' : 'Original', v: famous || used ? 0 : 25 });
    return { score: parts.reduce((s2, p) => s2 + p.v, 0), parts };
  }
  function nameFor(th, word) {
    if (th === THEMES.brand || (!th.nouns.length)) return Math.random() < 0.6 ? brandableLux() : Math.random() < 0.6 ? brandable() : brandableLux() + ' ' + rnd(['Maison', 'Reserve', 'One']);
    if (th === THEMES.luxe && Math.random() < 0.35) return brandableLux();
    const n = word && Math.random() < 0.6 ? cap(word) : rnd(th.nouns), p = Math.random();
    if (p < 0.38) return n;                                   // un mot
    if (p < 0.68) return rnd(th.adj) + ' ' + n;               // adjectif + nom
    if (p < 0.80 && th.pairs !== false) { const n2 = rnd(th.nouns.filter((x) => x !== n)); return n2 ? n + ' ' + n2 : n; } // deux noms
    return n;
  }
  function genIdeas() {
    const th = THEMES[S.draft.theme] || THEMES.luxe, word = (S.draft.word || '').trim().replace(/[^A-Za-z0-9 ]/g, '');
    S.ideas = makeIdeas(th, word, 8); renderIdeas();
  }
  function makeIdeas(th, word, count, reject) {
    const thKey = Object.keys(THEMES).find((k) => THEMES[k] === th) || S.draft.theme;
    const out = [], seen = new Set(), tick = new Set();
    let guard = 0;
    while (out.length < count && guard++ < 400) {
      const name = nameFor(th, word).replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!name || seen.has(name.toLowerCase())) continue;
      const ticker = tickerFor(name); if (tick.has(ticker)) continue;
      if (reject && reject(name, ticker)) continue;
      seen.add(name.toLowerCase()); tick.add(ticker);
      const sc = scoreIdea(name, ticker, word);
      out.push({ name, ticker, emo: rnd(th.mascot), tag: descFor(name, ticker, name.split(' ').pop(), true, out.length), score: sc.score, parts: sc.parts, pal: Math.floor(Math.random() * MEME.bg.length), style: 'meme', seed: nameSeed(name), theme: thKey, motif: pickMotif(thKey, name, out.length) });
    }
    out.sort((a, b) => b.score - a.score);
    // une fois triées, les idées sans motif lié à leur nom reçoivent les motifs de l'univers à tour de rôle
    const list = MOTIFS[thKey] || MOTIFS.luxe; let rot = Math.floor(Math.random() * list.length);
    out.forEach((x) => { if (!MOTIF_WORDS.some(([re, m]) => re.test(x.name) && list.includes(m))) x.motif = list[rot++ % list.length]; });
    // personnages du style Mème : celui que le nom évoque, sinon tous ceux de l'univers à tour de rôle
    const mc = MEME.theme[thKey] || MEME.theme.meme; let mr = Math.floor(Math.random() * mc.length);
    out.forEach((x) => { x.mchar = (MEME_WORDS.find(([re]) => re.test(x.name)) || [])[1] || mc[mr++ % mc.length]; });
    // tous les styles dans la liste : surtout des Mèmes, plus des Illustrations et des styles premium
    const prem = shuffled(['coin', 'shield', 'hex', 'seal', 'glass', 'geo', 'orb', 'mono']), plan = ['meme', 'meme', 'illus', 'meme', 'P', 'meme', 'illus', 'P'];
    out.forEach((x, i) => { const st = plan[i % plan.length]; x.style = st === 'P' ? prem.pop() : st; if (x.style !== 'meme') x.pal = (th.pal + i * 3) % PALS.length; });
    return out;
  }
  function descFor(name, ticker, n1, short, idx) {
    const lang = DESC[S.draft.lang] ? S.draft.lang : 'en', tone = DESC[lang][S.draft.tone] ? S.draft.tone : 'witty';
    const pool = S.draft.theme === 'brand' ? DESC[lang][tone].filter((l) => !l.includes('{k}')) : DESC[lang][tone]; if (idx === 0 || !descFor.order) descFor.order = pool.map((_, i) => i).sort(() => Math.random() - 0.5);
    const line = (idx == null ? rnd(pool) : pool[descFor.order[idx % pool.length]]).replace(/\{n\}/g, name).replace(/\{k\}/g, (n1 || name).toLowerCase()).replace(/\{s\}/g, '$' + ticker);
    if (short) return line;
    const extra = DESC2[lang][tone];
    return extra ? line + '\n\n' + extra : line;
  }
  function pickIdea(i, silent) {
    const x = S.ideas[i]; if (!x) return;
    Object.assign(S.draft, { name: x.name, symbol: x.ticker, desc: (() => { const lang = DESC[S.draft.lang] ? S.draft.lang : 'en', ex = (DESC2[lang] || {})[S.draft.tone]; return x.tag + (ex ? '\n\n' + ex : ''); })(), idea: i });
    S.draft.logo = Object.assign({}, S.draft.logo, { emoji: x.emo, text: x.ticker, pal: x.pal, style: x.style || 'meme', theme: x.theme || S.draft.theme, motif: x.motif || '', mchar: x.mchar || '', mexpr: '', macc: null, name: x.name, textCustom: false, seed: x.seed || Math.floor(Math.random() * 1e6) });
    S.imgBlob = null; S.draft.imgSrc = 'gen';
    saveDraft(); drawLogo(); fillFields(); renderIdeas(); renderLaunchSide();
    if (!silent) toast('Idée reprise', x.name + ' · $' + x.ticker + '. Ajustez le logo à l\'étape 2.', 'g');
  }

  /* ================================================================ logo (v3, premium) */
  // Palettes : fond (sombre, clair), métal (reflet, principal, mi-ton, profond), accent. light : fond clair.
  const PALS = [
    { n: 'Obsidienne et or', bg: ['#060709', '#1b1d26'], m: ['#fff6d8', '#e8c26a', '#a8741f', '#5a3a0e'], fg: '#e8c26a', ac: '#fff1c9' },
    { n: 'Ivoire et encre', bg: ['#e6ddca', '#fbf8f1'], m: ['#7a7a88', '#22222b', '#111117', '#000000'], fg: '#22222b', ac: '#8a6a2e', light: true },
    { n: 'Minuit et glace', bg: ['#020617', '#13264d'], m: ['#f2fcff', '#a5e6ff', '#3ea7d8', '#13507a'], fg: '#a5e6ff', ac: '#f2fcff' },
    { n: 'Émeraude et laiton', bg: ['#02140f', '#0d3d2f'], m: ['#fbf0c8', '#d9b45a', '#9a7425', '#4f3a0c'], fg: '#d9b45a', ac: '#fbf0c8' },
    { n: 'Améthyste et argent', bg: ['#0e0619', '#311856'], m: ['#ffffff', '#ddd6f3', '#9a8fbf', '#4f466e'], fg: '#ddd6f3', ac: '#ffffff' },
    { n: 'Graphite et chrome', bg: ['#08080a', '#28282e'], m: ['#ffffff', '#d4d7de', '#7d828d', '#363a42'], fg: '#d4d7de', ac: '#ffffff' },
    { n: 'Bordeaux et or rose', bg: ['#16050c', '#4c1128'], m: ['#ffe8dc', '#f0ab8c', '#b4674c', '#6a3122'], fg: '#f0ab8c', ac: '#ffe8dc' },
    { n: 'Saphir et platine', bg: ['#040a1c', '#142a5e'], m: ['#ffffff', '#e1e6f0', '#97a2b8', '#4b5568'], fg: '#e1e6f0', ac: '#ffffff' },
    { n: 'Pétrole et cuivre', bg: ['#03141a', '#0c363e'], m: ['#ffe3c8', '#e3925a', '#a65524', '#572a0f'], fg: '#e3925a', ac: '#ffe3c8' },
    { n: 'Champagne', bg: ['#e6d5b4', '#f9f2e4'], m: ['#fff3cf', '#b8892e', '#7d5a17', '#3f2c08'], fg: '#9c7322', ac: '#3f2c08', light: true },
  ];
  const STYLES = { meme: 'Mème', illus: 'Illustration', mono: 'Monogramme', coin: 'Pièce frappée', orb: 'Sphère', shield: 'Écusson', hex: 'Insigne', seal: 'Sceau de cire', glass: 'Cristal', geo: 'Emblème', word: 'Logotype', mascot: 'Médaillon' };
  const LOGO_FONTS = { serif: '"Cormorant Garamond","DM Serif Display",Georgia,serif', caps: '"Cinzel","Cormorant Garamond",Georgia,serif', display: '"Syne","Inter Tight",system-ui,sans-serif', grotesk: '"Space Grotesk","Inter Tight",system-ui,sans-serif' };
  let fontsReady = false;
  function loadFonts() {
    if (!document.fonts || !document.fonts.load) { fontsReady = true; return Promise.resolve(); }
    return Promise.all(['700 200px "Cormorant Garamond"', '600 200px "Cinzel"', '700 200px "Cinzel"', '800 200px "Syne"', '400 200px "DM Serif Display"', '700 200px "Space Grotesk"'].map((f) => document.fonts.load(f).catch(() => {}))).then(() => { fontsReady = true; });
  }
  function seeded(seed) { let s = Math.imul(seed >>> 0, 2654435761) >>> 0 || 1; const next = () => { s = (s * 1664525 + 1013904223) >>> 0; s ^= s >>> 15; return (s >>> 0) / 4294967296; }; next(); next(); return next; }
  let GRAIN = null;
  function grain(W) {
    if (GRAIN && GRAIN.width === W) return GRAIN;
    const c = document.createElement('canvas'); c.width = c.height = W; const g = c.getContext('2d'), im = g.createImageData(W, W);
    for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); GRAIN = c; return c;
  }
  function hexA(hex, a) { const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  // Métal brossé : bandes de reflets le long de l'axe donné
  function metal(g, x0, y0, x1, y1, P) {
    const m = P.light ? [P.m[2], P.m[1], P.m[2], P.m[3]] : P.m, lg = g.createLinearGradient(x0, y0, x1, y1); // fond clair : métal plus dense pour rester lisible
    [[0, m[1]], [0.18, m[0]], [0.4, m[1]], [0.6, m[2]], [0.78, m[1]], [0.92, m[0]], [1, m[2]]].forEach((s) => lg.addColorStop(s[0], s[1]));
    return lg;
  }
  function background(g, W, P) {
    const lg = g.createLinearGradient(0, 0, 0, W); lg.addColorStop(0, P.bg[1]); lg.addColorStop(1, P.bg[0]); g.fillStyle = lg; g.fillRect(0, 0, W, W);
    const rg = g.createRadialGradient(W * 0.5, W * 0.4, W * 0.02, W * 0.5, W * 0.4, W * 0.72);
    rg.addColorStop(0, P.light ? 'rgba(255,255,255,.6)' : hexA(P.m[1], 0.17)); rg.addColorStop(1, P.light ? 'rgba(255,255,255,0)' : hexA(P.m[1], 0)); g.fillStyle = rg; g.fillRect(0, 0, W, W);
  }
  function finish(g, W, P) {
    try { g.save(); g.globalAlpha = 0.045; g.globalCompositeOperation = 'overlay'; g.drawImage(grain(W), 0, 0); g.restore(); } catch (e) {}
    const v = g.createRadialGradient(W / 2, W / 2, W * 0.42, W / 2, W / 2, W * 0.76); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, P.light ? 'rgba(60,40,10,.14)' : 'rgba(0,0,0,.38)'); g.fillStyle = v; g.fillRect(0, 0, W, W);
  }
  function fitText(g, txt, font, maxW, size) { let s = size; do { g.font = font.replace('{s}', s); s -= 4; } while (g.measureText(txt).width > maxW && s > 20); return s + 4; }
  // Ordonnée de la ligne de base pour centrer visuellement un texte (ligne de base « alphabetic »)
  function midY(g, txt, cy) { const m = g.measureText(txt); return m.actualBoundingBoxAscent != null ? cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 : cy + m.width * 0.25; }
  // Texte espacé, centré sur x ; renvoie sa largeur
  function spaced(g, txt, x, y, sp, draw) {
    const ch = [...txt], ws = ch.map((c) => g.measureText(c).width), tot = ws.reduce((a, b) => a + b, 0) + sp * (ch.length - 1);
    if (draw !== false) { let cx = x - tot / 2; const al = g.textAlign; g.textAlign = 'left'; ch.forEach((c, i) => { g.fillText(c, cx, y); cx += ws[i] + sp; }); g.textAlign = al; }
    return tot;
  }
  // Relief : ombre portée sombre, liseré clair, puis la matière
  function emboss(g, P, paint, d) {
    g.save(); g.translate(d * 0.9, d * 1.1); g.fillStyle = hexA(P.m[3], P.light ? 0.35 : 0.8); paint(); g.restore();
    g.save(); g.translate(-d * 0.45, -d * 0.55); g.fillStyle = P.light ? 'rgba(255,255,255,.9)' : hexA(P.m[0], 0.55); paint(); g.restore();
  }
  function gem(g, x, y, r) { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.62, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.62, y); g.closePath(); g.fill(); }
  // Légende sous le symbole : TICKER en capitales gravées, filets et losanges de part et d'autre
  function caption(g, W, P, txt, y, u) {
    g.font = '600 ' + Math.round(50 * u) + 'px ' + LOGO_FONTS.caps; g.textBaseline = 'alphabetic';
    const sp = 15 * u, tw = spaced(g, txt, 0, 0, sp, false), by = midY(g, txt, y);
    g.fillStyle = metal(g, W / 2 - tw / 2, y - 30 * u, W / 2 + tw / 2, y + 30 * u, P); spaced(g, txt, W / 2, by, sp);
    const x0 = W / 2 - tw / 2 - 30 * u, x1 = W / 2 + tw / 2 + 30 * u, len = 44 * u;
    g.fillStyle = hexA(P.m[1], 0.75); g.fillRect(x0 - len, y - 1.5 * u, len, 3 * u); g.fillRect(x1, y - 1.5 * u, len, 3 * u);
    gem(g, x0 - len - 14 * u, y, 9 * u); gem(g, x1 + len + 14 * u, y, 9 * u);
  }
  // Texte réparti sur tout le tour de la pièce : « TICKER · TICKER · … »
  function ringText(g, word, cx, cy, R, sep) {
    const unit = word + (sep || '  •  '), circ = 2 * Math.PI * R, uw = g.measureText(unit).width;
    const n = Math.max(1, Math.floor(circ / (uw * 1.1))), chars = unit.repeat(n).split('');
    const ws = chars.map((ch) => g.measureText(ch).width), tot = ws.reduce((a, b) => a + b, 0), gap = (circ - tot) / chars.length;
    let a = -Math.PI / 2;
    chars.forEach((ch, i) => { const w = ws[i]; a += (w / 2) / R; g.save(); g.translate(cx + R * Math.cos(a), cy + R * Math.sin(a)); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore(); a += (w / 2 + gap) / R; });
  }
  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }
  function dropShadow(g, u, a) { g.shadowColor = 'rgba(0,0,0,' + (a == null ? 0.5 : a) + ')'; g.shadowBlur = 70 * u; g.shadowOffsetY = 28 * u; }
  function noShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; }
  // Lettre à empattements, en relief, remplie de métal
  function serifLetter(g, P, letter, cx, cy, maxW, maxS, u) {
    const s = fitText(g, letter, '700 {s}px ' + LOGO_FONTS.serif, maxW, maxS);
    g.font = '700 ' + s + 'px ' + LOGO_FONTS.serif; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const y = midY(g, letter, cy), paint = () => g.fillText(letter, cx, y);
    emboss(g, P, paint, 7 * u);
    g.fillStyle = metal(g, cx - s * 0.45, cy - s * 0.5, cx + s * 0.45, cy + s * 0.5, P); paint();
    return s;
  }
  // Style « Illustration » : un motif dessiné en grand dans la zone ronde visible sur pump.fun.
  // Chaque univers a plusieurs motifs ; une idée reçoit le motif qui colle à son nom, sinon un motif différent de ses voisines.
  const MOTIFS = { luxe: ['diamond', 'ring', 'pearl', 'gem', 'perfume'], meme: ['frog', 'cat', 'panda', 'dog', 'penguin', 'duck'], internet: ['browser', 'chat', 'smiley', 'heart'],
    space: ['planet', 'moon', 'rocket', 'comet', 'sun', 'ufo'], tech: ['chip', 'robot', 'bolt', 'atom', 'nodes'], prestige: ['crown', 'key', 'shield', 'laurel'], myth: ['trident', 'flame', 'sword', 'eye', 'wing'],
    brand: ['mono', 'squaremono', 'hexmono'], ocean: ['wave', 'fish', 'shell', 'anchor'], food: ['donut', 'cherry', 'cup', 'icecream'], gaming: ['gamepad', 'pcoin', 'ghost', 'heart'], nature: ['leaf', 'mushroom', 'flower', 'tree'] };
  MOTIFS.luxe = MOTIFS.luxe.concat(MOTIFS.prestige); MOTIFS.meme = MOTIFS.meme.concat(MOTIFS.food, MOTIFS.ocean, MOTIFS.nature); MOTIFS.gaming = MOTIFS.gaming.concat(MOTIFS.myth.filter((m) => !MOTIFS.gaming.includes(m))); MOTIFS.tech = MOTIFS.tech.concat(MOTIFS.brand);
  const MOTIF_WORDS = [[/panda|koala|hippo|llama|walrus/i, 'panda'], [/lynx|raccoon|moose|cat|kit/i, 'cat'], [/doge|shib|dog|corgi|inu|pup|pug/i, 'dog'], [/penguin|pingu|frost/i, 'penguin'], [/duck|goose|quack/i, 'duck'],
    [/otter|toad|gecko|axolotl|capy|quokka|frog/i, 'frog'], [/comet|meteor/i, 'comet'], [/sun|solar|helio/i, 'sun'], [/ufo|alien/i, 'ufo'], [/nova|lumen|halo|eclipse|luna|lunar|moon/i, 'moon'],
    [/rocket|zenith|vega|astra|apollo/i, 'rocket'], [/orbit|nebula|quasar|pulsar|planet/i, 'planet'], [/quantum|atom|proton/i, 'atom'], [/net|mesh|node|proxy|chain/i, 'nodes'],
    [/neuron|cortex|synth|echo|signal|logic/i, 'robot'], [/glitch|volt|bolt|flash|zero/i, 'bolt'], [/phoenix|ember|inferno|flame|fire/i, 'flame'], [/blade|sword|valkyrie|saber/i, 'sword'],
    [/oracle|eye|seer/i, 'eye'], [/wing|icarus|angel|aether/i, 'wing'], [/kraken|hydra|titan|atlas|poseidon|trident/i, 'trident'], [/shield|aegis|guard|regent/i, 'shield'], [/laurel|victor|caesar/i, 'laurel'],
    [/key|marquis|sterling/i, 'key'], [/perfume|scent|velvet|essence/i, 'perfume'], [/emerald|gem|jewel|onyx/i, 'gem'], [/pearl|ivory|opaline/i, 'pearl'], [/ring|opal|orra|lustre/i, 'ring'],
    [/smile|happy|lol/i, 'smiley'], [/love|heart|fren|crush/i, 'heart'], [/vibe|rizz|lore|\bgm\b|\bser\b|chat/i, 'chat'], [/tide|wave|surf|lagoon|drift/i, 'wave'], [/fish|marlin|tuna|koi|orca|shoal|manta/i, 'fish'],
    [/shell|nautilus|conch|coral/i, 'shell'], [/anchor|harbor|abyss/i, 'anchor'], [/donut|glaz/i, 'donut'], [/cherry|berry/i, 'cherry'], [/latte|coffee|mocha|brew|honey/i, 'cup'], [/ice|gelato|sundae|cream|pudding/i, 'icecream'],
    [/pad|joystick|arcade|combo|controller/i, 'gamepad'], [/loot|coin|gold|cash|save/i, 'pcoin'], [/ghost|boss|respawn|spook/i, 'ghost'], [/fern|leaf|ivy|sage|clover|moss/i, 'leaf'], [/mushroom|shroom|spore/i, 'mushroom'],
    [/lotus|bloom|rose|lily|blossom|meadow/i, 'flower'], [/cedar|pine|willow|maple|birch|oak|acorn|tree/i, 'tree']];
  function pickMotif(theme, name, i) {
    const list = MOTIFS[theme] || MOTIFS.luxe;
    for (const [re, m] of MOTIF_WORDS) if (re.test(name || '') && list.includes(m)) return m;
    return list[(i || 0) % list.length];
  }
  function drawIllus(g, W, P, motif, letter, u) {
    if (MOTIFS[motif]) motif = MOTIFS[motif][0];
    const k = W * 0.0074, dark = !P.light, ink = dark ? '#14120f' : '#1b1407', fg = P.fg && P.fg.length === 7 ? P.fg : '#d6b26e';
    const tint = { frog: '#7fd18a', cat: '#f0a35e', panda: '#f3efe6', flame: '#f39a4b', dog: '#f0a35e', penguin: '#cfd6e3', duck: '#ffd257', smiley: '#ffd257', heart: '#ff6b81', sun: '#ffc24a', fish: '#5fb6ff', wave: '#5fb6ff', shell: '#f2a77f', donut: '#f59ac0', cherry: '#e0414f', cup: '#c58b5c', icecream: '#f6c1d0', pcoin: '#ffd257', ghost: '#ff6b81', leaf: '#6fcf7f', mushroom: '#e0524f', flower: '#f59ac0', tree: '#5fbf72', gem: '#3cc98a' }[motif] || fg;
    // fond plat, comme les cartes d'univers : aplat sombre + lueur douce qui monte du bas
    g.fillStyle = dark ? shade(P.bg[0], 0.02) : P.bg[1]; g.fillRect(0, 0, W, W);
    const glow = g.createRadialGradient(W / 2, W * 1.02, 0, W / 2, W * 1.02, W * 0.95);
    glow.addColorStop(0, hexA(tint, dark ? 0.26 : 0.2)); glow.addColorStop(0.55, hexA(tint, dark ? 0.08 : 0.06)); glow.addColorStop(1, hexA(tint, 0));
    g.fillStyle = glow; g.fillRect(0, 0, W, W);
    g.save(); g.translate(W / 2 - 60 * k, W / 2 - 37 * k); g.scale(k, k);
    const shadowOn = () => { g.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(60,40,10,.3)'; g.shadowBlur = 40 * u / k; g.shadowOffsetY = 14 * u / k; };
    const shadowOff = () => { g.shadowColor = 'transparent'; };
    shadowOn();
    const P2 = (d) => new Path2D(d), lin = (x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((s) => gr.addColorStop(s[0], s[1])); return gr; };
    const metalG = lin(30, 10, 90, 64, [[0, P.m[0]], [0.45, P.m[1]], [0.8, P.m[2]], [1, P.m[3]]]);
    const dot = (x, y, r, c) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = c; g.fill(); };
    const ell = (x, y, rx, ry, rot, c) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); g.fillStyle = c; g.fill(); };
    const stroke = (d, c, w) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(P2(d)); };
    const fill = (d, c) => { g.fillStyle = c; g.fill(P2(d)); };
    const star = (x, y, s, c) => fill('M' + x + ' ' + (y - 2.5 * s) + 'l' + s + ' ' + 1.5 * s + ' ' + 1.5 * s + ' ' + s + '-' + 1.5 * s + ' ' + s + '-' + s + ' ' + 1.5 * s + '-' + s + '-' + 1.5 * s + '-' + 1.5 * s + '-' + s + ' ' + 1.5 * s + '-' + s + 'z', c);
    const sky = dark ? '#fff' : ink;
    if (motif === 'frog') {
      ell(60, 46, 30, 20, 0, lin(30, 20, 90, 66, [[0, '#a6e6a8'], [1, '#4fae67']]));
      dot(46, 28, 10, '#86d48f'); dot(74, 28, 10, '#86d48f'); shadowOff();
      dot(46, 28, 6, '#fff'); dot(74, 28, 6, '#fff'); dot(47.5, 29, 3, ink); dot(75.5, 29, 3, ink); dot(48.6, 27.6, 1, '#fff'); dot(76.6, 27.6, 1, '#fff');
      stroke('M48 50q12 9 24 0', ink, 2.4); dot(40, 47, 3.5, 'rgba(255,138,138,.55)'); dot(80, 47, 3.5, 'rgba(255,138,138,.55)');
    } else if (motif === 'cat') {
      const fur = lin(36, 14, 84, 64, [[0, '#ffd2a1'], [1, '#e08a45']]);
      fill('M38 30L34 8l18 12zM82 30l4-22-18 12z', fur); ell(60, 40, 25, 22, 0, fur); shadowOff();
      fill('M39 26l-2-11 9 7zM81 26l2-11-9 7z', 'rgba(255,170,170,.7)');
      ell(50, 38, 3.4, 4.6, 0, ink); ell(70, 38, 3.4, 4.6, 0, ink); dot(51, 36.5, 1.1, '#fff'); dot(71, 36.5, 1.1, '#fff');
      fill('M57 46h6l-3 3z', '#e86f7a'); stroke('M60 49q-3 4-7 2M60 49q3 4 7 2', ink, 1.4);
      stroke('M30 44h14M31 49l13-2M90 44H76M89 49l-13-2', hexA('#ffffff', 0.8), 1);
    } else if (motif === 'panda') {
      dot(40, 22, 8, '#1d1b19'); dot(80, 22, 8, '#1d1b19'); dot(60, 40, 24, lin(40, 18, 80, 64, [[0, '#ffffff'], [1, '#d9d4cb']])); shadowOff();
      ell(50, 38, 6, 8, -0.5, '#1d1b19'); ell(70, 38, 6, 8, 0.5, '#1d1b19'); dot(51, 37, 2.6, '#fff'); dot(69, 37, 2.6, '#fff'); dot(51.5, 37.5, 1.3, ink); dot(69.5, 37.5, 1.3, ink);
      ell(60, 48, 3.6, 2.6, 0, '#1d1b19'); stroke('M60 50.5v3M60 53.5q-3 3-6 1M60 53.5q3 3 6 1', '#1d1b19', 1.4); dot(44, 48, 3, 'rgba(255,138,138,.4)'); dot(76, 48, 3, 'rgba(255,138,138,.4)');
    } else if (motif === 'browser') {
      fill('M29 12h62a7 7 0 0 1 7 7v34a7 7 0 0 1-7 7H29a7 7 0 0 1-7-7V19a7 7 0 0 1 7-7z', hexA(P.bg[0], 0.85)); shadowOff();
      stroke('M29 12h62a7 7 0 0 1 7 7v34a7 7 0 0 1-7 7H29a7 7 0 0 1-7-7V19a7 7 0 0 1 7-7zM22 22h76', tint, 2);
      dot(29, 17, 1.6, tint); dot(35, 17, 1.6, tint);
      fill('M34 29h28a3 3 0 0 1 0 6H34a3 3 0 0 1 0-6z', tint); g.globalAlpha = 0.45; fill('M34 39h16a3 3 0 0 1 0 6H34a3 3 0 0 1 0-6z', tint); g.globalAlpha = 1;
      fill('M74 36l14 6-6 2-2 6z', sky); fill('M84 24c2-3 7-1 5 3l-5 4-5-4c-2-4 3-6 5-3z', '#ff8a8a');
    } else if (motif === 'chat') {
      fill('M30 14h46a9 9 0 0 1 9 9v18a9 9 0 0 1-9 9H48l-12 10v-10h-6a9 9 0 0 1-9-9V23a9 9 0 0 1 9-9z', metalG); shadowOff();
      dot(41, 32, 3.2, ink); dot(53, 32, 3.2, ink); dot(65, 32, 3.2, ink);
      fill('M74 34h18a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7h-2v7l-8-7h-8a7 7 0 0 1-7-7V41a7 7 0 0 1 7-7z', hexA(fg, 0.35)); fill('M86 42c2-3 7-1 5 3l-5 4-5-4c-2-4 3-6 5-3z', '#ff8a8a');
    } else if (motif === 'moon') {
      g.save(); const cut = new Path2D(); cut.rect(-200, -200, 600, 600); cut.arc(70, 28, 17, 0, Math.PI * 2); g.clip(cut, 'evenodd');
      dot(58, 36, 22, lin(40, 14, 76, 58, [[0, '#ffffff'], [0.4, tint], [1, shade(tint, -0.35)]])); g.restore(); shadowOff();
      dot(46, 42, 2.6, hexA(ink, 0.18)); dot(52, 52, 1.8, hexA(ink, 0.18)); dot(42, 30, 1.6, hexA(ink, 0.18));
      [[88, 44, 1.6], [96, 20, 1.2], [24, 18, 1.4], [20, 52, 1], [100, 60, 1.2]].forEach((s) => dot(s[0], s[1], s[2], sky)); star(90, 32, 1.3, tint);
    } else if (motif === 'rocket') {
      fill('M60 6c11 9 15 24 12 40H48c-3-16 1-31 12-40z', metalG); fill('M48 34l-10 14 10-2zM72 34l10 14-10-2z', tint); shadowOff();
      dot(60, 26, 6, hexA(P.bg[0], 0.95)); dot(60, 26, 4, hexA(tint, 0.9)); dot(58.5, 24.5, 1.3, '#fff');
      fill('M52 47h16l-3 8q-5 9-10 0z', lin(52, 47, 60, 64, [[0, '#ffd27a'], [1, '#ff6b3d']]));
      [[24, 18, 1.4], [94, 14, 1.2], [98, 46, 1.6], [22, 54, 1]].forEach((s) => dot(s[0], s[1], s[2], sky)); star(30, 34, 1.2, tint);
    } else if (motif === 'planet') {
      const pl = g.createRadialGradient(54, 32, 1, 60, 38, 18); pl.addColorStop(0, '#fff'); pl.addColorStop(0.4, tint); pl.addColorStop(1, shade(P.bg[1], -0.2));
      dot(60, 38, 17, pl); shadowOff();
      g.save(); g.translate(60, 40); g.rotate(-14 * Math.PI / 180); g.strokeStyle = tint; g.lineWidth = 2.2; g.beginPath(); g.ellipse(0, 0, 32, 8, 0, 0, Math.PI * 2); g.stroke(); g.restore();
      [[22, 16, 1.6], [98, 22, 1.2], [92, 58, 1.8], [30, 60, 1], [16, 40, 1.1], [106, 44, 0.9]].forEach((s) => dot(s[0], s[1], s[2], sky)); star(100, 13, 1.4, tint);
    } else if (motif === 'robot') {
      stroke('M60 10v8', tint, 2.2); dot(60, 9, 3, tint);
      fill('M42 18h36a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H42a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z', metalG); shadowOff();
      fill('M30 30h4v12h-4zM86 30h4v12h-4z', tint);
      fill('M44 26h32a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z', hexA(P.bg[0], 0.92));
      dot(51, 34, 3.4, tint); dot(69, 34, 3.4, tint); dot(51, 34, 1.4, '#fff'); dot(69, 34, 1.4, '#fff');
      stroke('M50 49h20M54 47v4M60 47v4M66 47v4', hexA(ink, 0.6), 1.4);
    } else if (motif === 'bolt') {
      fill('M68 6L38 40h18l-8 26 34-38H64z', lin(40, 6, 80, 66, [[0, P.m[0]], [0.5, tint], [1, P.m[2]]])); shadowOff();
      stroke('M68 6L38 40h18l-8 26 34-38H64z', hexA(P.m[3], 0.5), 1);
      [[28, 20, 1.3], [94, 50, 1.3]].forEach((s) => star(s[0], s[1], s[2], tint)); dot(30, 56, 1.5, hexA(tint, 0.7)); dot(92, 18, 1.5, hexA(tint, 0.7));
    } else if (motif === 'chip') {
      stroke('M14 24h22M14 48h22M84 24h22M84 48h22M48 8v14M72 8v14M48 50v14M72 50v14', tint, 2);
      dot(14, 24, 3, tint); dot(106, 48, 3, tint); dot(48, 64, 3, tint); dot(72, 8, 3, tint);
      fill('M44 20h32a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6z', shade(P.bg[0], 0.04)); shadowOff();
      stroke('M44 20h32a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6z', tint, 2);
      fill('M51 28h18a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H51a3 3 0 0 1-3-3V31a3 3 0 0 1 3-3z', metalG); stroke('M53 36h14', shade(P.bg[0], 0.04), 2);
    } else if (motif === 'crown') {
      fill('M34 52l-6-30 18 14 14-22 14 22 18-14-6 30z', metalG); g.fillStyle = metalG; g.fillRect(34, 54, 52, 7); shadowOff();
      stroke('M34 52l-6-30 18 14 14-22 14 22 18-14-6 30z', hexA(P.m[3], 0.5), 0.8);
      dot(60, 12, 3.5, P.m[1]); dot(28, 20, 3, P.m[1]); dot(92, 20, 3, P.m[1]); dot(60, 44, 4, '#c2404a'); dot(46, 46, 2.6, '#3e7bd6'); dot(74, 46, 2.6, '#2f9e6a'); dot(59, 43, 1.2, 'rgba(255,255,255,.7)');
    } else if (motif === 'key') {
      g.strokeStyle = metalG; g.lineWidth = 7; g.beginPath(); g.arc(40, 36, 13, 0, Math.PI * 2); g.stroke();
      fill('M52 32h40v8H52z', metalG); fill('M78 40h6v10h-6zM88 40h4v7h-4z', metalG); shadowOff();
      dot(40, 36, 4, hexA(P.m[1], 0.5)); star(96, 18, 1.3, P.m[1]); star(22, 58, 1, P.m[1]);
    } else if (motif === 'flame') {
      fill('M60 66c-16 0-23-12-19-25 2 6 6 9 9 9-3-11 4-24 15-33-2 11 4 15 8 21 4-6 3-12 3-12 8 9 10 19 6 29-3 7-11 11-22 11z', lin(60, 8, 60, 66, [[0, '#fff1c4'], [0.35, '#ffc14d'], [0.7, '#ff7a3d'], [1, '#c2402a']])); shadowOff();
      fill('M60 64c-7 0-11-5-9-11 2 3 4 4 6 4-1-6 3-11 7-14 0 5 3 8 5 11 2 4 0 10-9 10z', 'rgba(255,248,220,.75)');
      star(26, 22, 1.2, '#ffc14d'); star(96, 26, 1, '#ffc14d'); dot(32, 52, 1.4, 'rgba(255,193,77,.6)');
    } else if (motif === 'trident') {
      stroke('M60 66V16M40 20c0 16 8 22 20 22s20-6 20-22', metalG, 3.2);
      fill('M60 10l-6 10h12zM40 14l-5 8h10zM80 14l-5 8h10z', metalG); shadowOff();
      stroke('M14 58c10-8 18-8 26-2M106 58c-10-8-18-8-26-2', hexA(P.m[1], 0.5), 2);
      star(22, 18, 1, P.m[1]); star(99, 16, 1.2, P.m[1]);
    } else if (motif === 'mono') {
      dot(60, 36, 22, hexA(P.m[1], 0.12)); shadowOff();
      g.strokeStyle = metalG; g.lineWidth = 2; g.beginPath(); g.arc(60, 36, 25, 0, Math.PI * 2); g.stroke();
      stroke('M30 38c-6-4-8-11-6-17M90 38c6-4 8-11 6-17M28 31l-5-2M92 31l5-2M27 24l-4-3M93 24l4-3', hexA(P.m[1], 0.7), 1.8);
      g.fillStyle = metalG; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 30px ' + LOGO_FONTS.caps; g.fillText(letter, 60, 38);
    } else if (motif === 'ring') {
      g.strokeStyle = metalG; g.lineWidth = 6; g.beginPath(); g.ellipse(60, 44, 20, 16, 0, 0, Math.PI * 2); g.stroke();
      fill('M52 22h16l5 6-13 13-13-13z', lin(52, 22, 68, 40, [[0, '#ffffff'], [0.5, '#cfe8ff'], [1, '#7aa9d6']])); shadowOff();
      stroke('M47 28h26M52 22l8 19 8-19', 'rgba(0,0,0,.25)', 0.8); star(86, 18, 1.3, P.m[1]); star(30, 26, 0.9, P.m[1]);
    } else if (motif === 'pearl') {
      const pr = g.createRadialGradient(53, 27, 1, 60, 34, 19); pr.addColorStop(0, '#ffffff'); pr.addColorStop(0.55, '#efe6d8'); pr.addColorStop(1, '#a89a86');
      dot(60, 32, 18, pr); shadowOff(); dot(53, 25, 4.5, 'rgba(255,255,255,.85)');
      [[30, 55], [39, 59], [49, 62], [60, 63], [71, 62], [81, 59], [90, 55]].forEach((q) => { const sp = g.createRadialGradient(q[0] - 1, q[1] - 1, 0.3, q[0], q[1], 3.4); sp.addColorStop(0, '#fff'); sp.addColorStop(1, '#b9ab98'); dot(q[0], q[1], 3.2, sp); });
      star(92, 16, 1.2, P.m[1]);
    } else if (motif === 'gem') {
      fill('M46 16h28l10 10v20l-10 10H46l-10-10V26z', lin(36, 16, 84, 56, [[0, '#d6ffe9'], [0.45, '#3cc98a'], [1, '#0b5a3a']])); shadowOff();
      fill('M51 24h18l6 6v12l-6 6H51l-6-6V30z', 'rgba(255,255,255,.16)');
      stroke('M46 16l5 8M74 16l-5 8M84 26l-9 4M84 46l-9-4M74 56l-5-8M46 56l5-8M36 46l9-4M36 26l9 4', 'rgba(0,0,0,.25)', 1);
      star(94, 14, 1.3, P.m[1]); dot(26, 52, 1.4, hexA(P.m[1], 0.7));
    } else if (motif === 'perfume') {
      fill('M42 30h36a6 6 0 0 1 6 6v20a8 8 0 0 1-8 8H44a8 8 0 0 1-8-8V36a6 6 0 0 1 6-6z', lin(36, 30, 84, 64, [[0, hexA(fg, 0.75)], [1, hexA(fg, 0.35)]])); shadowOff();
      g.fillStyle = metalG; g.fillRect(54, 22, 12, 9); fill('M50 8h20a3 3 0 0 1 3 3v10H47V11a3 3 0 0 1 3-3z', metalG);
      fill('M50 40h20v12H50z', 'rgba(255,255,255,.75)'); fill('M41 36h4v20h-4z', 'rgba(255,255,255,.25)'); star(92, 22, 1.2, P.m[1]);
    } else if (motif === 'dog') {
      const fur = lin(36, 10, 84, 64, [[0, '#ffc98a'], [1, '#d9823c']]);
      fill('M40 28L37 8l15 12zM80 28l3-20-15 12z', fur); ell(60, 40, 24, 21, 0, fur); shadowOff();
      ell(60, 48, 13, 10, 0, '#fff3e0'); ell(48, 40, 5, 4, 0, '#fff3e0'); ell(72, 40, 5, 4, 0, '#fff3e0');
      ell(50, 35, 3, 3.6, 0, ink); ell(70, 35, 3, 3.6, 0, ink); dot(51, 34, 1, '#fff'); dot(71, 34, 1, '#fff');
      ell(60, 44, 3.6, 2.6, 0, ink); stroke('M60 46.5q-3 4-6 2M60 46.5q3 4 6 2', ink, 1.4);
    } else if (motif === 'penguin') {
      ell(60, 40, 21, 26, 0, '#2b2f3a'); ell(40, 44, 5, 12, 0.35, '#2b2f3a'); ell(80, 44, 5, 12, -0.35, '#2b2f3a'); shadowOff();
      ell(60, 46, 14, 18, 0, '#f5f5f5'); dot(53, 30, 3, '#fff'); dot(67, 30, 3, '#fff'); dot(53.5, 30.5, 1.5, ink); dot(67.5, 30.5, 1.5, ink);
      fill('M55 35h10l-5 6z', '#ffb03a'); ell(52, 66, 6, 2.2, 0, '#ffb03a'); ell(68, 66, 6, 2.2, 0, '#ffb03a');
    } else if (motif === 'duck') {
      ell(64, 48, 27, 16, 0, '#ffd257'); dot(46, 30, 13, '#ffd257'); shadowOff();
      ell(32, 33, 9, 4.2, 0, '#ff9a3c'); dot(48, 27, 2.6, ink); dot(48.8, 26.2, 0.9, '#fff');
      fill('M58 44q14-8 24 4q-12 6-24-4z', '#f2b93a'); dot(42, 36, 3, 'rgba(255,138,138,.45)');
    } else if (motif === 'smiley') {
      dot(60, 36, 22, lin(44, 14, 76, 58, [[0, '#ffe98a'], [1, '#f2b02a']])); shadowOff();
      ell(52, 31, 2.8, 4.2, 0, ink); ell(68, 31, 2.8, 4.2, 0, ink); stroke('M47 41q13 13 26 0', ink, 2.8);
      dot(44, 40, 3.5, 'rgba(255,120,120,.45)'); dot(76, 40, 3.5, 'rgba(255,120,120,.45)'); star(92, 14, 1.3, tint);
    } else if (motif === 'heart') {
      const rows = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'], c = 6;
      rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') { g.fillStyle = '#ff5c7a'; g.fillRect(33 + x * c, 12 + y * c, c, c); } }));
      shadowOff(); g.fillStyle = 'rgba(255,255,255,.65)'; g.fillRect(39, 18, c, c); g.fillRect(45, 18, c, c); g.fillRect(39, 24, c, c);
      g.fillStyle = 'rgba(0,0,0,.18)'; [[7, 3], [7, 4], [6, 5], [5, 6]].forEach((q) => g.fillRect(33 + q[0] * c, 12 + q[1] * c, c, c));
    } else if (motif === 'comet') {
      fill('M84 18L26 50l5 9 57-31z', lin(84, 22, 28, 54, [[0, hexA(tint, 0.85)], [1, hexA(tint, 0)]])); shadowOff();
      const ch = g.createRadialGradient(83, 22, 1, 84, 23, 10); ch.addColorStop(0, '#fff'); ch.addColorStop(0.5, tint); ch.addColorStop(1, shade(tint, -0.3)); dot(84, 23, 9, ch);
      [[24, 16, 1.4], [100, 50, 1.2], [44, 64, 1], [16, 34, 1]].forEach((q) => dot(q[0], q[1], q[2], sky)); star(98, 10, 1.2, tint);
    } else if (motif === 'sun') {
      for (let a = 0; a < 12; a++) { const r = a * Math.PI / 6; stroke('M' + (60 + Math.cos(r) * 21) + ' ' + (36 + Math.sin(r) * 21) + 'L' + (60 + Math.cos(r) * 30) + ' ' + (36 + Math.sin(r) * 30), '#ffc24a', 3); }
      const sc = g.createRadialGradient(56, 32, 1, 60, 36, 17); sc.addColorStop(0, '#fff6d0'); sc.addColorStop(0.5, '#ffc24a'); sc.addColorStop(1, '#f08a24'); dot(60, 36, 16, sc); shadowOff();
    } else if (motif === 'ufo') {
      fill('M48 44h24l12 22H36z', hexA(tint, 0.18)); ell(60, 40, 30, 8, 0, metalG); shadowOff();
      fill('M46 38a14 13 0 0 1 28 0z', hexA(tint, 0.75)); dot(54, 30, 2.4, 'rgba(255,255,255,.7)');
      [40, 52, 64, 76].forEach((x) => dot(x + 2, 41, 1.8, '#ffe27a')); [[20, 14, 1.4], [98, 18, 1.2], [104, 56, 1.4]].forEach((q) => dot(q[0], q[1], q[2], sky));
    } else if (motif === 'atom') {
      [0, 60, 120].forEach((d) => { g.save(); g.translate(60, 36); g.rotate(d * Math.PI / 180); g.strokeStyle = tint; g.lineWidth = 2.2; g.beginPath(); g.ellipse(0, 0, 30, 10, 0, 0, Math.PI * 2); g.stroke(); g.restore(); });
      dot(60, 36, 6, metalG); shadowOff(); dot(90, 36, 2.6, tint); dot(45, 10, 2.6, tint); dot(45, 62, 2.6, tint);
    } else if (motif === 'nodes') {
      const N = [[28, 22], [58, 12], [90, 24], [40, 48], [72, 42], [56, 64], [94, 58]], E = [[0, 1], [1, 2], [0, 3], [1, 4], [2, 4], [3, 4], [3, 5], [4, 5], [4, 6], [2, 6]];
      E.forEach((e) => stroke('M' + N[e[0]].join(' ') + 'L' + N[e[1]].join(' '), hexA(tint, 0.55), 1.6)); shadowOff();
      N.forEach((n, i) => dot(n[0], n[1], i === 4 ? 6 : 3.6, i === 4 ? metalG : tint)); dot(72, 42, 2.4, hexA(P.bg[0], 0.9));
    } else if (motif === 'shield') {
      fill('M60 6l26 8v18c0 17-11 27-26 34-15-7-26-17-26-34V14z', metalG); shadowOff();
      fill('M60 13l20 6v13c0 13-8 21-20 27-12-6-20-14-20-27V19z', hexA(P.bg[0], 0.85));
      star(60, 36, 3.4, P.m[1]); stroke('M48 50h24', hexA(P.m[1], 0.5), 1.4);
    } else if (motif === 'laurel') {
      // deux branches de laurier qui montent de part et d'autre, feuilles posées le long de la tige
      g.strokeStyle = hexA(P.m[2], 0.9); g.lineWidth = 1.6; g.beginPath(); g.arc(60, 36, 25, Math.PI * 0.62, Math.PI * 1.32); g.stroke(); g.beginPath(); g.arc(60, 36, 25, Math.PI * 1.68, Math.PI * 2.38); g.stroke();
      for (let i = 0; i < 6; i++) { [0, 1].forEach((side) => { const a = side ? Math.PI * (2.34 - i * 0.12) : Math.PI * (0.66 + i * 0.12), x = 60 + Math.cos(a) * 25, y = 36 + Math.sin(a) * 25; [-1, 1].forEach((o) => { g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2 + (side ? -1 : 1) * (0.55 * o)); g.beginPath(); g.ellipse(0, -4.5, 2.4, 5.2, 0, 0, Math.PI * 2); g.fillStyle = metalG; g.fill(); g.restore(); }); }); }
      shadowOff(); star(60, 34, 3.4, P.m[1]); dot(60, 63, 2.6, P.m[1]);
    } else if (motif === 'sword') {
      fill('M60 4l5 8v34h-10V12z', lin(55, 4, 65, 46, [[0, '#ffffff'], [0.5, '#cfd6e3'], [1, '#7d828d']])); shadowOff();
      stroke('M60 12v32', 'rgba(0,0,0,.2)', 1); fill('M42 46h36a2 2 0 0 1 0 5H42a2 2 0 0 1 0-5z', metalG); fill('M57 51h6v11h-6z', shade(P.m[3], -0.2)); dot(60, 65, 3.6, P.m[1]);
      star(30, 20, 1.2, P.m[1]); star(90, 28, 1, P.m[1]);
    } else if (motif === 'eye') {
      fill('M24 38q36-32 72 0q-36 32-72 0z', hexA(P.bg[0], 0.9)); shadowOff(); stroke('M24 38q36-32 72 0q-36 32-72 0z', metalG, 2.4);
      const ir = g.createRadialGradient(58, 35, 1, 60, 38, 12); ir.addColorStop(0, '#fff'); ir.addColorStop(0.4, tint); ir.addColorStop(1, shade(tint, -0.4)); dot(60, 38, 11, ir); dot(60, 38, 4.5, ink); dot(57, 35, 1.8, '#fff');
      stroke('M60 4v8M40 8l4 7M80 8l-4 7M26 18l7 5M94 18l-7 5', metalG, 2);
    } else if (motif === 'wing') {
      fill('M28 58C28 30 52 12 94 10C86 18 82 22 72 26C82 26 88 26 92 29C82 35 74 37 64 39C72 41 76 43 78 47C64 52 50 55 28 58Z', metalG); shadowOff();
      stroke('M34 54C46 40 60 30 86 16M40 54C54 46 66 38 86 30M46 55C58 50 66 46 74 45', 'rgba(0,0,0,.22)', 1.2); star(98, 40, 1.2, P.m[1]);
    } else if (motif === 'squaremono' || motif === 'hexmono') {
      const d = motif === 'hexmono' ? 'M60 6l26 15v30L60 66 34 51V21z' : 'M44 12h32a8 8 0 0 1 8 8v32a8 8 0 0 1-8 8H44a8 8 0 0 1-8-8V20a8 8 0 0 1 8-8z';
      fill(d, hexA(P.m[1], 0.12)); shadowOff(); stroke(d, metalG, 2.4);
      g.fillStyle = metalG; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 30px ' + LOGO_FONTS.caps; g.fillText(letter, 60, 38);
      star(98, 14, 1.2, P.m[1]); star(22, 58, 1, P.m[1]);
    } else if (motif === 'wave') {
      fill('M16 58C24 30 50 12 78 16C92 18 100 30 98 42C90 30 76 30 72 40C70 48 80 52 88 50C72 62 40 62 16 58Z', lin(20, 12, 90, 62, [[0, '#d6f2ff'], [0.4, tint], [1, shade(tint, -0.45)]])); shadowOff();
      stroke('M30 52C40 40 52 32 66 30', 'rgba(255,255,255,.45)', 1.6); [[86, 22, 2], [94, 28, 1.4], [82, 14, 1.2]].forEach((q) => dot(q[0], q[1], q[2], 'rgba(255,255,255,.8)'));
    } else if (motif === 'fish') {
      fill('M82 36l14-11v22z', shade(tint, -0.2)); fill('M28 36C40 18 70 18 84 36C70 54 40 54 28 36Z', lin(28, 20, 84, 52, [[0, shade(tint, 0.35)], [1, tint]])); shadowOff();
      fill('M54 22l8-9 4 12z', shade(tint, -0.1)); dot(40, 33, 3.6, '#fff'); dot(41, 33.5, 1.8, ink); stroke('M52 28q4 8 0 16', 'rgba(0,0,0,.18)', 1.4);
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.2; [[20, 22, 3], [14, 12, 2], [24, 10, 1.5]].forEach((q) => { g.beginPath(); g.arc(q[0], q[1], q[2], 0, Math.PI * 2); g.stroke(); });
    } else if (motif === 'shell') {
      fill('M60 62L28 34C32 14 88 14 92 34Z', lin(30, 14, 90, 62, [[0, '#fff0e4'], [1, '#f0a07a']])); shadowOff();
      stroke('M60 62L35 28M60 62L45 20M60 62V18M60 62L75 20M60 62L85 28', 'rgba(120,60,30,.25)', 1.3); fill('M52 60h16l-3 7h-10z', '#e89a74'); dot(28, 60, 2, 'rgba(255,255,255,.6)');
    } else if (motif === 'anchor') {
      g.strokeStyle = metalG; g.lineWidth = 3; g.beginPath(); g.arc(60, 12, 5, 0, Math.PI * 2); g.stroke();
      stroke('M60 17v44M47 26h26', metalG, 4); stroke('M33 44q4 18 27 18q23 0 27-18', metalG, 4); fill('M28 44l9-3-2 9zM92 44l-9-3 2 9z', metalG); shadowOff();
      stroke('M16 66q8-4 16 0t16 0M72 66q8-4 16 0t16 0', hexA(tint, 0.5), 1.6);
    } else if (motif === 'donut') {
      const ring = (ro, ri) => { const p = new Path2D(); p.arc(60, 38, ro, 0, Math.PI * 2); p.arc(60, 38, ri, 0, Math.PI * 2, true); return p; };
      g.fillStyle = '#e2a86a'; g.fill(ring(23, 8)); shadowOff(); g.fillStyle = '#f59ac0'; g.fill(ring(19.5, 9.5));
      [['#ffffff', 46, 28, 0.4], ['#7cc4ff', 70, 30, -0.6], ['#ffe27a', 52, 50, 1], ['#7fd18a', 72, 46, 0.2], ['#ffffff', 64, 22, 1.3], ['#ff6b6b', 44, 42, -1]].forEach((q) => { g.save(); g.translate(q[1], q[2]); g.rotate(q[3]); g.fillStyle = q[0]; g.fillRect(-3, -1, 6, 2); g.restore(); });
    } else if (motif === 'cherry') {
      stroke('M50 40q6-20 22-28M72 42q0-18 0-30', '#6b8e3a', 2.4); ell(80, 14, 9, 4, -0.4, '#6fcf7f');
      [[48, 48], [72, 50]].forEach((q) => { const c2 = g.createRadialGradient(q[0] - 4, q[1] - 4, 1, q[0], q[1], 13); c2.addColorStop(0, '#ff8a94'); c2.addColorStop(1, '#b81a2e'); dot(q[0], q[1], 12, c2); });
      shadowOff(); dot(44, 44, 2.6, 'rgba(255,255,255,.6)'); dot(68, 46, 2.6, 'rgba(255,255,255,.6)');
    } else if (motif === 'cup') {
      ell(58, 64, 28, 4, 0, '#d9d0c0'); fill('M38 30h40v18a14 14 0 0 1-14 14H52a14 14 0 0 1-14-14z', lin(38, 30, 78, 62, [[0, '#fbf7ef'], [1, '#cfc6b4']])); shadowOff();
      g.strokeStyle = '#cfc6b4'; g.lineWidth = 3.4; g.beginPath(); g.arc(80, 41, 7, -Math.PI / 2, Math.PI / 2); g.stroke();
      ell(58, 30, 20, 4, 0, '#6b3f22'); stroke('M50 22q-4-6 0-12M58 20q-4-6 0-12M66 22q-4-6 0-12', 'rgba(255,255,255,.55)', 1.8);
    } else if (motif === 'icecream') {
      fill('M47 38h26L60 68z', '#e2a86a'); shadowOff(); stroke('M51 44l13 14M57 40l10 11M69 44L56 58M63 40L53 51', 'rgba(120,70,30,.35)', 1);
      dot(51, 32, 11, '#f6c1d0'); dot(69, 32, 11, '#bfe3c8'); dot(60, 22, 11, '#fff1c4'); dot(60, 10, 3.6, '#e0414f'); dot(56, 18, 2.4, 'rgba(255,255,255,.7)');
    } else if (motif === 'gamepad') {
      fill('M38 22h44a16 16 0 0 1 16 16v6a14 14 0 0 1-24 10l-6-6H52l-6 6a14 14 0 0 1-24-10v-6a16 16 0 0 1 16-16z', metalG); shadowOff();
      fill('M34 36h4v-4h4v4h4v4h-4v4h-4v-4h-4z', hexA(P.bg[0], 0.9)); dot(80, 32, 3, '#ff6b81'); dot(86, 38, 3, '#5fb6ff'); dot(74, 38, 3, '#ffd257'); dot(80, 44, 3, '#6fcf7f');
      fill('M54 30h12v4H54z', hexA(P.bg[0], 0.6));
    } else if (motif === 'pcoin') {
      dot(60, 36, 22, lin(42, 14, 78, 58, [[0, '#fff0a0'], [0.5, '#ffcc3a'], [1, '#d98b14']])); shadowOff();
      g.strokeStyle = 'rgba(150,90,10,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(60, 36, 16, 0, Math.PI * 2); g.stroke(); star(60, 36, 3.4, '#fff7d6');
      [[26, 18, 1.4], [94, 54, 1.2]].forEach((q) => star(q[0], q[1], q[2], '#ffd257'));
    } else if (motif === 'ghost') {
      fill('M40 62V36a20 20 0 0 1 40 0v26l-6-5-7 5-7-5-7 5-7-5z', lin(40, 16, 80, 62, [[0, '#ff9aae'], [1, '#e8455f']])); shadowOff();
      ell(52, 36, 5, 6, 0, '#fff'); ell(68, 36, 5, 6, 0, '#fff'); dot(54, 37, 2.6, '#2b4aa0'); dot(70, 37, 2.6, '#2b4aa0'); [[24, 20], [96, 24], [98, 52]].forEach((q) => dot(q[0], q[1], 1.6, '#ffd257'));
    } else if (motif === 'leaf') {
      fill('M30 60C30 30 54 12 92 12C92 44 70 64 40 62Z', lin(30, 12, 92, 62, [[0, '#b8efb6'], [1, '#2f9e5a']])); shadowOff();
      stroke('M36 58C50 44 64 32 86 16M50 46L48 32M60 38L60 24M70 30L74 20M58 44L70 46M68 36L80 36', 'rgba(0,40,10,.28)', 1.4);
    } else if (motif === 'mushroom') {
      fill('M50 40h20v18a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6z', '#f5ecdc'); fill('M26 42C26 16 94 16 94 42Z', lin(26, 16, 94, 42, [[0, '#ff8a7a'], [1, '#c8322a']])); shadowOff();
      [[42, 30, 4.4], [60, 24, 5], [78, 32, 3.8], [55, 37, 2.6], [70, 38, 2.2]].forEach((q) => dot(q[0], q[1], q[2], '#fff5ee')); ell(36, 64, 10, 2.4, 0, '#6fcf7f'); ell(86, 64, 8, 2, 0, '#6fcf7f');
    } else if (motif === 'flower') {
      stroke('M60 46v20', '#5fbf72', 2.6); ell(67, 58, 7, 3, -0.5, '#6fcf7f');
      for (let i = 0; i < 6; i++) { const r = i * Math.PI / 3; ell(60 + Math.cos(r) * 11, 32 + Math.sin(r) * 11, 8, 5, r, i % 2 ? '#f7b2cf' : '#f59ac0'); }
      shadowOff(); dot(60, 32, 7, '#ffd257'); dot(58, 30, 2, 'rgba(255,255,255,.6)');
    } else if (motif === 'tree') {
      fill('M56 42h8v22h-8z', '#8a5a3a'); [[60, 22, 15], [45, 32, 12], [75, 32, 12], [60, 38, 13]].forEach((q) => dot(q[0], q[1], q[2], lin(40, 6, 80, 52, [[0, '#9be59b'], [1, '#3a9a56']]))); shadowOff();
      dot(54, 20, 3, 'rgba(255,255,255,.3)'); ell(60, 65, 20, 2.6, 0, 'rgba(111,207,127,.5)');
    } else {                                    // diamant taillé
      fill('M44 22h32l10 12-26 28-26-28z', lin(44, 22, 76, 62, [[0, P.m[0]], [0.5, P.m[1]], [1, P.m[3]]])); shadowOff();
      fill('M44 22l6 12h-16z', 'rgba(255,255,255,.18)'); fill('M76 22l10 12h-16z', 'rgba(0,0,0,.14)');
      stroke('M34 34h52M44 22l16 40 16-40M50 22l10 12 10-12', 'rgba(0,0,0,.3)', 1.1);
      star(94, 16, 1.3, P.m[1]); star(24, 50, 0.8, P.m[1]); dot(98, 50, 1.3, hexA(P.m[1], 0.7));
    }
    g.restore();
  }
  // Dessine un logo complet sur un canvas de taille W (256 à 1024)
  /* ---------- style « Mème » : personnage cartoon plein cadre, contour épais, couleurs vives ---------- */
  const MEME = {
    bg: ['#ffd23f', '#4cc9f0', '#ff6b9d', '#7ae582', '#ff9f1c', '#a685e2', '#00c2a8', '#ff5d5d', '#5d9cec', '#f7a8d8', '#c3f584', '#ffb86b'],
    chars: { frog: 'Grenouille', shiba: 'Chien', cat: 'Chat', penguin: 'Pingouin', panda: 'Panda', duck: 'Canard', hamster: 'Hamster', monkey: 'Singe', alien: 'Alien', robot: 'Robot', blob: 'Smiley', ghost: 'Fantôme' },
    exprs: { happy: 'Content', smug: 'Malin', cool: 'Lunettes', laugh: 'Mort de rire', shocked: 'Choqué', derp: 'Débile' },
    accs: { '': 'Aucun', crown: 'Couronne', chain: 'Chaîne en or', party: 'Chapeau de fête', beanie: 'Bonnet', cap: 'Casquette', headset: 'Casque', helmet: 'Casque spatial', horns: 'Cornes', halo: 'Auréole' },
    theme: { meme: ['frog', 'shiba', 'cat', 'penguin', 'panda', 'duck', 'hamster', 'monkey'], luxe: ['cat', 'shiba', 'frog', 'panda', 'monkey'], internet: ['blob', 'frog', 'monkey', 'cat', 'shiba'], space: ['alien', 'penguin', 'shiba', 'robot', 'frog'],
      tech: ['robot', 'alien', 'cat', 'hamster'], prestige: ['cat', 'shiba', 'panda', 'monkey', 'frog'], myth: ['ghost', 'frog', 'monkey', 'cat'], brand: ['blob', 'robot', 'frog', 'shiba'], ocean: ['penguin', 'duck', 'frog', 'cat'],
      food: ['hamster', 'blob', 'panda', 'duck', 'monkey'], gaming: ['ghost', 'robot', 'alien', 'frog', 'monkey'], nature: ['frog', 'hamster', 'monkey', 'panda', 'duck'] },
    acc: { meme: ['party', 'beanie', 'cap', 'chain'], luxe: ['crown', 'chain'], prestige: ['crown', 'chain', 'halo'], internet: ['cap', 'chain', 'beanie'], space: ['helmet'], tech: ['headset', 'cap'], myth: ['horns', 'halo'],
      brand: ['chain', 'cap'], ocean: ['cap', 'beanie'], food: ['party', 'beanie'], gaming: ['headset', 'cap'], nature: ['beanie', 'party'] },
    col: { frog: '#69c95d', shiba: '#f2a541', cat: '#ff9f43', penguin: '#2f3550', panda: '#f7f5ef', duck: '#ffd23f', hamster: '#f4c27a', monkey: '#9a6240', alien: '#a3e46b', robot: '#c9d3dd', blob: '#ffd23f', ghost: '#f4f4f8' },
  };
  const MEME_WORDS = [[/frog|toad|ribbit|gecko|axolotl|lizard/i, 'frog'], [/doge|shib|dog|inu|pup|pug|corgi|\bwif\b|bonk/i, 'shiba'], [/cat|kit|meow|lynx|neko|mog/i, 'cat'], [/pengu|pingu|frost|\bice/i, 'penguin'],
    [/panda|bear|koala/i, 'panda'], [/duck|goose|quack/i, 'duck'], [/hamster|capy|quokka|otter|mouse|raccoon/i, 'hamster'], [/monkey|ape|chimp|gorilla|banana/i, 'monkey'], [/alien|ufo|zorp|martian|astro/i, 'alien'],
    [/robot|\bbot\b|\bai\b|cyber|neuron|synth|droid/i, 'robot'], [/ghost|spook|\bboo\b|phantom/i, 'ghost'], [/smile|happy|vibe|blob|\bgm\b/i, 'blob']];
  const MEME_EXPR_WORDS = [[/cool|based|rich|chad|sigma|alpha|boss|king/i, 'cool'], [/chill|sleepy|smug|lazy|comfy|cozy|zen/i, 'smug'], [/wtf|omg|shock|panic|scared|cope|rekt|sad/i, 'shocked'],
    [/lol|lmao|haha|laugh|joy|funny/i, 'laugh'], [/derp|dumb|smol|silly|goofy|tiny|lil/i, 'derp']];
  const hexRgb = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const nearCol = (a, b) => { const x = hexRgb(a), y = hexRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 95; };
  const nameSeed = (s) => [...String(s || '')].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  function memePick(L, name) {
    const R = seeded((L.seed || 7) + 17), th = MEME.theme[L.theme] ? L.theme : 'meme', list = MEME.theme[th];
    let ch = MEME.chars[L.mchar] ? L.mchar : null;
    if (!ch) for (const [re, c] of MEME_WORDS) if (re.test(name || '')) { ch = c; break; }
    if (!ch) ch = list[Math.floor(R() * list.length)];
    let ex = MEME.exprs[L.mexpr] ? L.mexpr : null;
    if (!ex) for (const [re, e] of MEME_EXPR_WORDS) if (re.test(name || '')) { ex = e; break; }
    const ek = Object.keys(MEME.exprs); if (!ex) ex = ek[Math.floor(R() * ek.length)];
    let acc = L.macc != null && MEME.accs[L.macc] != null ? L.macc : (R() < 0.65 ? (MEME.acc[th] || MEME.acc.meme)[Math.floor(R() * (MEME.acc[th] || MEME.acc.meme).length)] : '');
    if ((acc === 'beanie' || acc === 'cap') && ['frog', 'alien', 'robot'].includes(ch)) acc = 'party';  // les yeux sont trop hauts : le chapeau les cacherait
    let bi = ((L.pal || 0) % MEME.bg.length + MEME.bg.length) % MEME.bg.length;
    for (let t = 0; t < MEME.bg.length && nearCol(MEME.bg[bi], MEME.col[ch]); t++) bi = (bi + 1) % MEME.bg.length;
    let si = (bi + 4 + Math.floor(R() * 4)) % MEME.bg.length; if (nearCol(MEME.bg[si], MEME.col[ch])) si = (si + 1) % MEME.bg.length;
    return { ch, ex, acc, bg: MEME.bg[bi], shirt: MEME.bg[si], fx: Math.floor(R() * 3), R };
  }
  function drawMeme(g, W, L, name, letter) {
    const M = memePick(L, name), OL = '#161616', s = W / 100, R = M.R, C = MEME.col[M.ch];
    g.save(); g.scale(s, s); g.lineJoin = 'round'; g.lineCap = 'round';
    // fond : aplat vif + rayons, trame ou étincelles
    g.fillStyle = M.bg; g.fillRect(0, 0, 100, 100);
    if (M.fx === 0) { g.save(); g.translate(50, 56); g.fillStyle = 'rgba(255,255,255,.2)'; for (let i = 0; i < 14; i++) { g.rotate(Math.PI * 2 / 14); g.beginPath(); g.moveTo(0, 0); g.lineTo(-11, -95); g.lineTo(11, -95); g.closePath(); g.fill(); } g.restore(); }
    else if (M.fx === 1) { g.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 3; y < 100; y += 6) for (let x = (y % 12 ? 3 : 0) + 1; x < 100; x += 6) { g.beginPath(); g.arc(x, y, 0.5 + (x + y) / 200 * 1.7, 0, Math.PI * 2); g.fill(); } }
    else { g.fillStyle = 'rgba(255,255,255,.6)'; for (let i = 0; i < 7; i++) { const x = 6 + R() * 88, y = 5 + R() * 40, r = 1.2 + R() * 2.2; g.beginPath(); g.moveTo(x, y - r * 2); g.quadraticCurveTo(x, y, x + r * 2, y); g.quadraticCurveTo(x, y, x, y + r * 2); g.quadraticCurveTo(x, y, x - r * 2, y); g.quadraticCurveTo(x, y, x, y - r * 2); g.fill(); } }
    const P = (d) => new Path2D(d);
    const circle = (x, y, r) => { const p = new Path2D(); p.arc(x, y, r, 0, Math.PI * 2); return p; };
    const oval = (x, y, rx, ry, rot) => { const p = new Path2D(); p.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); return p; };
    const rrect = (x, y, w, h, r) => { const p = new Path2D(); if (p.roundRect) p.roundRect(x, y, w, h, r); else p.rect(x, y, w, h); return p; };
    // silhouette unie : tous les contours d'abord, puis tous les aplats par-dessus
    const sil = (parts) => { g.strokeStyle = OL; g.lineWidth = 5.4; parts.forEach((p) => g.stroke(p[0])); parts.forEach((p) => { g.fillStyle = p[1]; g.fill(p[0]); }); };
    const fo = (p, c) => { g.fillStyle = c; g.fill(p); };
    const fs = (p, c, w) => { g.fillStyle = c; g.fill(p); g.strokeStyle = OL; g.lineWidth = w || 2; g.stroke(p); };
    const ln = (d, w, c) => { g.strokeStyle = c || OL; g.lineWidth = w || 2.2; g.stroke(P(d)); };
    const blush = (x1, x2, y) => { fo(oval(x1, y, 4.5, 2.6), 'rgba(255,105,140,.45)'); fo(oval(x2, y, 4.5, 2.6), 'rgba(255,105,140,.45)'); };
    // corps (épaules) : sweat de couleur
    const shirt = () => { if (M.ch === 'ghost') return; sil([[P('M6 104 C8 88 26 81 50 81 C74 81 92 88 94 104 Z'), M.ch === 'robot' ? '#9fb0c2' : M.ch === 'penguin' ? C : M.shirt]]); if (M.ch === 'penguin') fo(P('M34 104 C36 90 42 86 50 86 C58 86 64 90 66 104 Z'), '#ffffff'); };
    shirt();
    let A = { ay: 28, hw: 26, ey: 52, ex1: 39, ex2: 61, er: 5.5, my: 68, mw: 14, skin: C, mouth: true };
    const ch = M.ch;
    if (ch === 'frog') {
      sil([[circle(34, 37, 12.5), C], [circle(66, 37, 12.5), C], [oval(50, 59, 37, 24), C]]);
      fo(oval(50, 68, 24, 9), 'rgba(255,255,255,.18)'); blush(26, 74, 63);
      A = { ay: 26, hw: 30, ey: 36, ex1: 34, ex2: 66, er: 7.5, my: 63, mw: 34, skin: C, mouth: true };
    } else if (ch === 'shiba') {
      sil([[P('M23 46 L25 13 L45 30 Z'), C], [P('M77 46 L75 13 L55 30 Z'), C], [oval(50, 58, 31, 27), C]]);
      fo(P('M28 38 L29 20 L40 31 Z'), '#fff3dc'); fo(P('M72 38 L71 20 L60 31 Z'), '#fff3dc');
      fo(oval(50, 69, 21, 13), '#fff3dc'); fo(oval(31, 64, 7, 6), '#fff3dc'); fo(oval(69, 64, 7, 6), '#fff3dc');
      fo(oval(40, 44, 3, 2, -0.3), '#fff3dc'); fo(oval(60, 44, 3, 2, 0.3), '#fff3dc');
      fs(oval(50, 62, 4.6, 3.2), OL, 1);
      A = { ay: 31, hw: 25, ey: 52, ex1: 39, ex2: 61, er: 5, my: 67, mw: 13, skin: C, mouth: true };
    } else if (ch === 'cat') {
      const cc = ['#ff9f43', '#bfc5cc', '#3d3d45', '#f7f2ea'][Math.floor(R() * 4)]; A.skin = cc;
      sil([[P('M21 47 L21 11 L43 30 Z'), cc], [P('M79 47 L79 11 L57 30 Z'), cc], [oval(50, 59, 31, 26), cc]]);
      fo(P('M25 38 L25 19 L37 30 Z'), '#ffb3c7'); fo(P('M75 38 L75 19 L63 30 Z'), '#ffb3c7');
      fs(P('M46.5 61 L53.5 61 L50 65 Z'), '#ff8fab', 1.2);
      const wc = cc === '#3d3d45' ? '#f2f2f2' : OL; ln('M18 60 L33 62 M18 66 L33 65 M82 60 L67 62 M82 66 L67 65', 1.2, wc);
      A = { ay: 31, hw: 26, ey: 53, ex1: 39, ex2: 61, er: 6, my: 68, mw: 12, skin: cc, mouth: true, dark: cc === '#3d3d45' };
    } else if (ch === 'penguin') {
      sil([[oval(50, 55, 31, 30), C]]);
      const face = new Path2D(); face.addPath(circle(40, 57, 13)); face.addPath(circle(60, 57, 13)); face.addPath(oval(50, 66, 19, 12)); fo(face, '#ffffff');
      fs(P('M42 61 L58 61 L50 71 Z'), '#ffb238', 1.8); blush(29, 71, 64);
      A = { ay: 26, hw: 26, ey: 54, ex1: 40, ex2: 60, er: 5.5, my: 74, mw: 10, skin: '#ffffff', mouth: false };
    } else if (ch === 'panda') {
      sil([[circle(26, 33, 9.5), OL], [circle(74, 33, 9.5), OL], [oval(50, 57, 32, 28), C]]);
      fo(oval(38, 53, 9, 11.5, -0.55), OL); fo(oval(62, 53, 9, 11.5, 0.55), OL);
      fs(oval(50, 63, 4.4, 3), OL, 1); blush(30, 70, 65);
      A = { ay: 29, hw: 27, ey: 53, ex1: 38, ex2: 62, er: 4.8, my: 69, mw: 12, skin: OL, mouth: true, patch: true };
    } else if (ch === 'duck') {
      sil([[circle(50, 55, 29), C]]); ln('M47 27 Q50 14 60 18 M50 26 Q46 16 39 19', 2.6);
      fs(oval(50, 67, 17, 7.5), '#ff9f1c', 2); ln('M36 67 L64 67', 1.4);
      A = { ay: 27, hw: 24, ey: 50, ex1: 39, ex2: 61, er: 5.5, my: 76, mw: 10, skin: C, mouth: false };
    } else if (ch === 'hamster') {
      sil([[circle(28, 33, 8.5), C], [circle(72, 33, 8.5), C], [circle(26, 64, 12), C], [circle(74, 64, 12), C], [oval(50, 57, 31, 27), C]]);
      fo(circle(28, 33, 4.5), '#ffb3c7'); fo(circle(72, 33, 4.5), '#ffb3c7');
      fo(oval(50, 66, 17, 12), '#fff1dc'); blush(27, 73, 63);
      fs(oval(50, 60, 2.8, 2), '#ff8fab', 1); fs(rrect(46.4, 64, 3.4, 4.6, 0.8), '#fff', 1.1); fs(rrect(50.2, 64, 3.4, 4.6, 0.8), '#fff', 1.1);
      A = { ay: 30, hw: 27, ey: 51, ex1: 40, ex2: 60, er: 4.4, my: 71, mw: 10, skin: C, mouth: true };
    } else if (ch === 'monkey') {
      sil([[circle(21, 55, 10), C], [circle(79, 55, 10), C], [circle(50, 53, 28), C]]);
      fo(circle(21, 55, 5.5), '#f3cfa4'); fo(circle(79, 55, 5.5), '#f3cfa4');
      const face = new Path2D(); face.addPath(circle(41, 50, 11)); face.addPath(circle(59, 50, 11)); face.addPath(oval(50, 64, 18, 12)); fo(face, '#f3cfa4');
      fo(circle(47.5, 60.5, 1.1), OL); fo(circle(52.5, 60.5, 1.1), OL);
      A = { ay: 25, hw: 24, ey: 50, ex1: 41, ex2: 59, er: 5, my: 66, mw: 16, skin: '#f3cfa4', mouth: true };
    } else if (ch === 'alien') {
      ln('M40 28 L33 13 M60 28 L67 13', 2.4); sil([[circle(33, 12, 3.6), C], [circle(67, 12, 3.6), C], [P('M50 22 C78 22 84 44 78 60 C72 76 60 86 50 86 C40 86 28 76 22 60 C16 44 22 22 50 22 Z'), C]]);
      A = { ay: 24, hw: 26, ey: 51, ex1: 38, ex2: 62, er: 6.5, my: 72, mw: 10, skin: C, mouth: true, alien: true };
    } else if (ch === 'robot') {
      ln('M50 24 L50 13', 2.4); sil([[circle(50, 11, 3.8), '#ff5d5d'], [rrect(14, 42, 7, 16, 2), '#9fb0c2'], [rrect(79, 42, 7, 16, 2), '#9fb0c2'], [rrect(21, 23, 58, 54, 11), C]]);
      fs(rrect(28, 33, 44, 29, 7), '#1d2633', 2);
      ln('M38 70 L62 70 M42 67 L42 73 M50 67 L50 73 M58 67 L58 73', 1.6);
      A = { ay: 24, hw: 28, ey: 47, ex1: 40, ex2: 60, er: 5, my: 57, mw: 12, skin: '#1d2633', mouth: false, robot: true };
    } else if (ch === 'blob') {
      sil([[circle(50, 54, 32), C]]);
      A = { ay: 23, hw: 26, ey: 47, ex1: 39, ex2: 61, er: 6, my: 64, mw: 26, skin: C, mouth: true };
    } else if (ch === 'ghost') {
      sil([[P('M21 96 L21 50 C21 29 35 18 50 18 C65 18 79 29 79 50 L79 96 L71.5 89 L64 96 L57 89 L50 96 L43 89 L36 96 L28.5 89 Z'), C]]); blush(31, 69, 60);
      A = { ay: 20, hw: 25, ey: 47, ex1: 40, ex2: 60, er: 6, my: 62, mw: 14, skin: C, mouth: true };
    }
    // yeux
    const ex = M.ex, glow = A.robot ? '#5cf2ff' : null;
    const eye = (x, y, r, side) => {
      if (glow) { g.shadowColor = glow; g.shadowBlur = 4; if (ex === 'laugh') ln('M' + (x - r) + ' ' + (y + 2) + ' Q' + x + ' ' + (y - r) + ' ' + (x + r) + ' ' + (y + 2), 2.4, glow); else if (ex === 'smug') ln('M' + (x - r) + ' ' + y + ' L' + (x + r) + ' ' + y, 2.6, glow); else fo(circle(x, y, ex === 'shocked' ? r * 1.2 : ex === 'derp' && side > 0 ? r * 0.7 : r * 0.9), glow); g.shadowBlur = 0; g.shadowColor = 'transparent'; return; }
      if (A.alien && ex !== 'laugh') { fs(oval(x, y, r * 1.35 * (ex === 'shocked' ? 1.15 : 1), r * 0.95 * (ex === 'shocked' ? 1.15 : 1), side * -0.45), OL, 1.5); fo(circle(x - side * 1.5, y - 1.8, 1.5), '#fff'); if (ex === 'smug') fo(P('M' + (x - r * 1.5) + ' ' + (y - r * 1.2) + ' L' + (x + r * 1.5) + ' ' + (y - r * 1.2) + ' L' + (x + r * 1.5) + ' ' + y + ' L' + (x - r * 1.5) + ' ' + y + ' Z'), A.skin); return; }
      if (ex === 'laugh') { ln('M' + (x - r) + ' ' + (y + r * 0.35) + ' Q' + x + ' ' + (y - r * 0.95) + ' ' + (x + r) + ' ' + (y + r * 0.35), 2.4, A.dark || A.patch ? '#fff' : OL); fs(P('M' + (x + side * r * 1.1) + ' ' + (y + r * 0.6) + ' q' + side * 2.5 + ' 4 0 6.5 q' + -side * 2.5 + ' -2.5 0 -6.5 Z'), '#7fd3ff', 1.2); return; }
      const rr = ex === 'shocked' ? r * 1.18 : ex === 'derp' ? (side < 0 ? r * 1.18 : r * 0.82) : r;
      fs(circle(x, y, rr), '#ffffff', 1.6);
      const px = ex === 'smug' ? x + side * 0.35 * rr : ex === 'derp' ? x - side * 0.35 * rr : x + 0.12 * rr, py = ex === 'derp' ? y + (side < 0 ? -0.3 : 0.3) * rr : y + 0.12 * rr, pr = ex === 'shocked' ? rr * 0.24 : rr * 0.56;
      fo(circle(px, py, pr), OL); if (ex !== 'shocked') fo(circle(px + pr * 0.35, py - pr * 0.4, pr * 0.32), '#fff');
      if (ex === 'smug') { g.beginPath(); g.arc(x, y, rr + 1.2, Math.PI, 0); g.closePath(); g.fillStyle = A.skin; g.fill(); ln('M' + (x - rr - 0.5) + ' ' + y + ' L' + (x + rr + 0.5) + ' ' + y, 2, A.dark || A.patch ? '#fff' : OL); }
    };
    if (ex === 'cool') {
      const r = A.er, y = A.ey;
      const lens = (x) => rrect(x - r * 1.7, y - r * 1.05, r * 3.4, r * 2.1, r * 0.8);
      ln('M' + (A.ex1 + r * 1.6) + ' ' + (y - r * 0.4) + ' L' + (A.ex2 - r * 1.6) + ' ' + (y - r * 0.4), 2.4, '#111');
      fs(lens(A.ex1), '#111', 1.4); fs(lens(A.ex2), '#111', 1.4);
      ln('M' + (A.ex1 - r * 1.1) + ' ' + (y - r * 0.4) + ' L' + (A.ex1 - r * 0.3) + ' ' + (y - r * 0.4) + ' M' + (A.ex2 - r * 1.1) + ' ' + (y - r * 0.4) + ' L' + (A.ex2 - r * 0.3) + ' ' + (y - r * 0.4), 1.4, 'rgba(255,255,255,.75)');
    } else { eye(A.ex1, A.ey, A.er, -1); eye(A.ex2, A.ey, A.er, 1); }
    // bouche
    if (A.mouth) {
      const x = 50, y = A.my, w = A.mw, mc = A.robot ? '#5cf2ff' : OL;
      if (A.robot) { /* grille déjà dessinée */ }
      else if (ex === 'happy' || ex === 'laugh') {
        const h = ex === 'laugh' ? w * 0.72 : w * 0.55;
        const m = P('M' + (x - w / 2) + ' ' + y + ' L' + (x + w / 2) + ' ' + y + ' Q' + (x + w / 2) + ' ' + (y + h) + ' ' + x + ' ' + (y + h) + ' Q' + (x - w / 2) + ' ' + (y + h) + ' ' + (x - w / 2) + ' ' + y + ' Z');
        fs(m, '#5a1420', 2); g.save(); g.clip(m); fo(oval(x, y + h * 0.95, w * 0.28, h * 0.42), '#ff6b81'); if (ex === 'laugh') g.fillStyle = '#fff', g.fillRect(x - w / 2, y - 1, w, h * 0.22); g.restore(); g.strokeStyle = OL; g.lineWidth = 2; g.stroke(m);
      } else if (ex === 'smug') ln('M' + (x - w * 0.38) + ' ' + (y + 1.5) + ' Q' + (x + w * 0.05) + ' ' + (y + w * 0.22) + ' ' + (x + w * 0.45) + ' ' + (y - w * 0.12), 2.4, mc);
      else if (ex === 'shocked') fs(oval(x, y + 2.5, Math.max(3, w * 0.17), Math.max(4, w * 0.24)), '#5a1420', 2);
      else if (ex === 'cool') ln('M' + (x - w * 0.4) + ' ' + y + ' Q' + x + ' ' + (y + w * 0.32) + ' ' + (x + w * 0.42) + ' ' + (y - w * 0.06), 2.4, mc);
      else if (ex === 'derp') { ln('M' + (x - w * 0.42) + ' ' + y + ' q' + w * 0.2 + ' ' + 3 + ' ' + w * 0.42 + ' 0 q' + w * 0.2 + ' -3 ' + w * 0.42 + ' 0', 2.2, mc); fs(oval(x + w * 0.12, y + 4, Math.max(2.6, w * 0.13), Math.max(3.4, w * 0.18)), '#ff6b81', 1.6); }
    }
    // accessoire
    const ax = 50, ay = A.ay, hw = A.hw;
    if (M.acc === 'crown') { fs(P('M' + (ax - 15) + ' ' + (ay + 3) + ' L' + (ax - 17) + ' ' + (ay - 13) + ' L' + (ax - 7.5) + ' ' + (ay - 4) + ' L' + ax + ' ' + (ay - 17) + ' L' + (ax + 7.5) + ' ' + (ay - 4) + ' L' + (ax + 17) + ' ' + (ay - 13) + ' L' + (ax + 15) + ' ' + (ay + 3) + ' Z'), '#ffd23f', 2.4); fs(circle(ax, ay - 2, 2.4), '#ff5d5d', 1.2); fs(circle(ax - 9, ay - 1, 1.8), '#4cc9f0', 1.1); fs(circle(ax + 9, ay - 1, 1.8), '#4cc9f0', 1.1); }
    else if (M.acc === 'party') { g.save(); g.translate(ax + 4, ay); g.rotate(0.2); const cone = P('M-11 3 L1 -25 L12 3 Z'); fs(cone, '#ff5d8f', 2.4); g.save(); g.clip(cone); g.strokeStyle = '#ffd23f'; g.lineWidth = 3; for (let i = -30; i < 10; i += 8) { g.beginPath(); g.moveTo(-14, i + 14); g.lineTo(14, i); g.stroke(); } g.restore(); g.strokeStyle = OL; g.lineWidth = 2.4; g.stroke(cone); fs(circle(1, -26, 3.8), '#7ae582', 2); g.restore(); }
    else if (M.acc === 'beanie') { const bc = M.shirt; fs(P('M' + (ax - hw - 2) + ' ' + (ay + 13) + ' Q' + (ax - hw - 2) + ' ' + (ay - 13) + ' ' + ax + ' ' + (ay - 13) + ' Q' + (ax + hw + 2) + ' ' + (ay - 13) + ' ' + (ax + hw + 2) + ' ' + (ay + 13) + ' Z'), bc, 2.4); fs(rrect(ax - hw - 4, ay + 7, 2 * hw + 8, 9, 3), shade(bc, -0.18), 2.2); fs(circle(ax, ay - 15, 5), '#ffffff', 2.2); }
    else if (M.acc === 'cap') { const bc = M.shirt; fs(P('M' + (ax - hw + 2) + ' ' + (ay + 9) + ' Q' + (ax - hw + 2) + ' ' + (ay - 12) + ' ' + ax + ' ' + (ay - 12) + ' Q' + (ax + hw - 2) + ' ' + (ay - 12) + ' ' + (ax + hw - 2) + ' ' + (ay + 9) + ' Z'), bc, 2.4); fs(oval(ax + hw * 0.55, ay + 9, hw * 0.75, 4, -0.08), shade(bc, -0.2), 2.2); fs(circle(ax, ay - 12, 2), shade(bc, -0.3), 1.2); }
    else if (M.acc === 'headset') { g.strokeStyle = OL; g.lineWidth = 6; g.beginPath(); g.arc(ax, ay + 26, hw + 5, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); g.strokeStyle = '#3a3f4b'; g.lineWidth = 3; g.stroke(); fs(rrect(ax - hw - 10, ay + 18, 10, 17, 4), '#3a3f4b', 2.2); fs(rrect(ax + hw, ay + 18, 10, 17, 4), '#3a3f4b', 2.2); fs(rrect(ax - hw - 8, ay + 21, 4, 11, 2), M.shirt, 1); fs(rrect(ax + hw + 4, ay + 21, 4, 11, 2), M.shirt, 1); }
    else if (M.acc === 'horns') { fs(P('M' + (ax - hw * 0.7) + ' ' + (ay + 7) + ' Q' + (ax - hw * 0.95) + ' ' + (ay - 8) + ' ' + (ax - hw * 1.05) + ' ' + (ay - 12) + ' Q' + (ax - hw * 0.45) + ' ' + (ay - 5) + ' ' + (ax - hw * 0.35) + ' ' + (ay + 5) + ' Z'), '#ff4d4d', 2.2); fs(P('M' + (ax + hw * 0.7) + ' ' + (ay + 7) + ' Q' + (ax + hw * 0.95) + ' ' + (ay - 8) + ' ' + (ax + hw * 1.05) + ' ' + (ay - 12) + ' Q' + (ax + hw * 0.45) + ' ' + (ay - 5) + ' ' + (ax + hw * 0.35) + ' ' + (ay + 5) + ' Z'), '#ff4d4d', 2.2); }
    else if (M.acc === 'halo') { g.strokeStyle = OL; g.lineWidth = 6; g.beginPath(); g.ellipse(ax, ay - 9, 15, 4.2, 0, 0, Math.PI * 2); g.stroke(); g.strokeStyle = '#ffe680'; g.lineWidth = 3; g.stroke(); }
    else if (M.acc === 'helmet') { const hp = circle(50, 54, 41); fo(hp, 'rgba(255,255,255,.16)'); g.strokeStyle = OL; g.lineWidth = 5; g.stroke(hp); g.strokeStyle = '#ffffff'; g.lineWidth = 2.4; g.stroke(hp); ln('M24 38 Q30 22 46 17', 3, 'rgba(255,255,255,.85)'); }
    if (M.acc === 'chain' && M.ch !== 'ghost') { g.strokeStyle = OL; g.lineWidth = 5; g.beginPath(); g.arc(50, 70, 22, Math.PI * 0.22, Math.PI * 0.78); g.stroke(); g.strokeStyle = '#ffd23f'; g.lineWidth = 2.6; g.setLineDash([2.2, 1.2]); g.stroke(); g.setLineDash([]); fs(circle(50, 91, 7), '#ffd23f', 2.4); g.fillStyle = OL; g.font = '800 9px "Inter Tight",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter || '$', 50, 91.5); }
    g.restore();
  }
  function paintLogo(cv, L, sym) {
    const W = cv.width, g = cv.getContext('2d'), P = PALS[(L.pal || 0) % PALS.length], R = seeded(L.seed || 7);
    const txt = (L.text || sym || 'COIN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) || 'COIN', letter = txt[0];
    const u = W / 1024;
    g.save(); g.clearRect(0, 0, W, W); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    background(g, W, P);
    if (L.style === 'meme') {
      drawMeme(g, W, L, L.name || S.draft.name || txt, letter);
    } else if (L.style === 'illus') {
      drawIllus(g, W, P, L.motif || L.theme || S.draft.theme || 'luxe', letter, u);
    } else if (L.style === 'coin') {
      const cx = W / 2, cy = W / 2, r = W * 0.41, f = r * 0.9;
      g.save(); dropShadow(g, u, P.light ? 0.28 : 0.6); g.fillStyle = P.m[2]; circle(g, cx, cy, r); g.fill(); g.restore();
      g.fillStyle = metal(g, cx - r, cy - r, cx + r, cy + r, P); circle(g, cx, cy, r); g.fill();
      g.strokeStyle = hexA(P.m[3], 0.45); g.lineWidth = 2.2 * u;
      for (let i = 0; i < 200; i++) { const a = i / 200 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.955, cy + Math.sin(a) * r * 0.955); g.lineTo(cx + Math.cos(a) * r * 0.995, cy + Math.sin(a) * r * 0.995); g.stroke(); }
      const fg = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, f); fg.addColorStop(0, P.m[0]); fg.addColorStop(0.45, P.m[1]); fg.addColorStop(1, P.m[2]);
      g.fillStyle = fg; circle(g, cx, cy, f); g.fill();
      const bv = g.createLinearGradient(cx - f, cy - f, cx + f, cy + f); bv.addColorStop(0, hexA(P.m[3], 0.85)); bv.addColorStop(0.5, hexA(P.m[2], 0.3)); bv.addColorStop(1, hexA(P.m[0], 0.9));
      g.strokeStyle = bv; g.lineWidth = 7 * u; circle(g, cx, cy, f); g.stroke();
      g.fillStyle = hexA(P.m[3], 0.6); for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; circle(g, cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66, 3.4 * u); g.fill(); }
      g.font = '700 ' + Math.round(42 * u) + 'px ' + LOGO_FONTS.caps; g.textBaseline = 'middle'; g.fillStyle = hexA(P.m[3], 0.9);
      ringText(g, txt, cx, cy, r * 0.775, '   ·   ');
      g.textBaseline = 'alphabetic';
      serifLetter(g, P, letter, cx, cy, r * 0.9, Math.round(r * 1.05), u);
      g.save(); circle(g, cx, cy, r); g.clip(); g.globalCompositeOperation = 'screen';
      const sh = g.createRadialGradient(cx - r * 0.45, cy - r * 0.55, 0, cx - r * 0.45, cy - r * 0.55, r * 1.1); sh.addColorStop(0, 'rgba(255,255,255,.32)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(0, 0, W, W); g.restore();
    } else if (L.style === 'orb') {
      const cx = W / 2, cy = W * 0.47, r = W * 0.33;
      const fl = g.createRadialGradient(cx, cy + r * 1.08, 0, cx, cy + r * 1.08, r * 0.95); fl.addColorStop(0, P.light ? 'rgba(60,40,10,.35)' : 'rgba(0,0,0,.65)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
      g.save(); g.translate(cx, cy + r * 1.08); g.scale(1, 0.16); g.translate(-cx, -(cy + r * 1.08)); g.fillStyle = fl; circle(g, cx, cy + r * 1.08, r * 0.95); g.fill(); g.restore();
      const sp = g.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.04, cx - r * 0.1, cy - r * 0.1, r * 1.3);
      sp.addColorStop(0, P.m[0]); sp.addColorStop(0.28, P.m[1]); sp.addColorStop(0.72, P.m[2]); sp.addColorStop(1, P.m[3]);
      g.fillStyle = sp; circle(g, cx, cy, r); g.fill();
      const rim = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r); rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(0.7, 'rgba(255,255,255,0)'); rim.addColorStop(1, hexA(P.m[0], 0.75));
      g.strokeStyle = rim; g.lineWidth = 5 * u; circle(g, cx, cy, r - 3 * u); g.stroke();
      const s = fitText(g, letter, '700 {s}px ' + LOGO_FONTS.serif, r * 1.05, Math.round(r * 1.25));
      g.font = '700 ' + s + 'px ' + LOGO_FONTS.serif; const y = midY(g, letter, cy);
      g.fillStyle = hexA(P.m[0], 0.55); g.fillText(letter, cx + 3 * u, y + 4 * u);
      g.fillStyle = hexA(P.m[3], 0.92); g.fillText(letter, cx, y);
      g.save(); g.translate(cx - r * 0.3, cy - r * 0.56); g.rotate(-0.45); g.scale(1, 0.5);
      const hl = g.createLinearGradient(0, -r * 0.4, 0, r * 0.4); hl.addColorStop(0, 'rgba(255,255,255,.8)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl; circle(g, 0, 0, r * 0.4); g.fill(); g.restore();
    } else if (L.style === 'geo') {
      const cx = W / 2, cy = W * 0.41, kind = Math.floor(R() * 5), s = W * 0.25;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, s * 1.6); glow.addColorStop(0, hexA(P.m[1], P.light ? 0.12 : 0.22)); glow.addColorStop(1, hexA(P.m[1], 0)); g.fillStyle = glow; g.fillRect(0, 0, W, W);
      g.save(); dropShadow(g, u, P.light ? 0.2 : 0.45);
      if (kind === 0) { // diamant taillé
        const ty = cy - s * 0.42, gy = cy - s * 0.05, by = cy + s * 0.95;
        const T = [-0.56, -0.19, 0.19, 0.56].map((k) => [cx + k * s, ty]), Gd = [-1, -0.5, 0, 0.5, 1].map((k) => [cx + k * s, gy]);
        const facets = [[Gd[0], T[0], Gd[1]], [T[0], Gd[1], T[1]], [Gd[1], T[1], Gd[2]], [T[1], Gd[2], T[2]], [Gd[2], T[2], Gd[3]], [T[2], Gd[3], T[3]], [Gd[3], T[3], Gd[4]]];
        for (let i = 0; i < 4; i++) facets.push([Gd[i], Gd[i + 1], [cx, by]]);
        const tones = [P.m[1], P.m[0], P.m[2], P.m[1], P.m[0], P.m[2], P.m[1], P.m[2], P.m[1], P.m[3], P.m[2]];
        facets.forEach((pts, i) => { g.fillStyle = tones[i % tones.length]; g.beginPath(); pts.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); if (i === 0) noShadow(g); });
        g.strokeStyle = hexA(P.m[0], 0.55); g.lineWidth = 2 * u;
        facets.forEach((pts) => { g.beginPath(); pts.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke(); });
      } else if (kind === 1) { // orbites
        g.strokeStyle = metal(g, cx - s, cy - s, cx + s, cy + s, P); g.lineWidth = 9 * u;
        for (let i = 0; i < 3; i++) { g.save(); g.translate(cx, cy); g.rotate(i * Math.PI / 3); g.scale(1, 0.36); circle(g, 0, 0, s); g.restore(); g.stroke(); if (i === 0) noShadow(g); }
        const c = g.createRadialGradient(cx - s * 0.08, cy - s * 0.08, 0, cx, cy, s * 0.24); c.addColorStop(0, P.m[0]); c.addColorStop(0.5, P.m[1]); c.addColorStop(1, P.m[3]); g.fillStyle = c; circle(g, cx, cy, s * 0.22); g.fill();
      } else if (kind === 2) { // soleil rayonnant
        g.strokeStyle = metal(g, cx - s, cy - s, cx + s, cy + s, P); g.lineCap = 'round';
        for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, l = i % 2 ? 0.72 : 1; g.lineWidth = (i % 2 ? 4 : 7) * u; g.beginPath(); g.moveTo(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42); g.lineTo(cx + Math.cos(a) * s * l, cy + Math.sin(a) * s * l); g.stroke(); if (i === 0) noShadow(g); }
        g.fillStyle = metal(g, cx - s * 0.34, cy - s * 0.34, cx + s * 0.34, cy + s * 0.34, P); circle(g, cx, cy, s * 0.33); g.fill();
        g.fillStyle = hexA(P.m[3], 0.85); gem(g, cx, cy, s * 0.17);
      } else if (kind === 3) { // anneaux entrelacés
        const d = s * 0.42, rr = s * 0.55; g.lineWidth = 26 * u;
        g.strokeStyle = metal(g, cx - d - rr, cy - rr, cx - d + rr, cy + rr, P); circle(g, cx - d, cy, rr); g.stroke(); noShadow(g);
        g.strokeStyle = metal(g, cx + d - rr, cy - rr, cx + d + rr, cy + rr, P); circle(g, cx + d, cy, rr); g.stroke();
        g.save(); g.beginPath(); g.rect(cx - d, cy - rr - 20 * u, rr * 2, rr + 20 * u); g.clip();
        g.strokeStyle = metal(g, cx - d - rr, cy - rr, cx - d + rr, cy + rr, P); circle(g, cx - d, cy, rr); g.stroke(); g.restore();
      } else { // couronne
        const bw = s * 1.6, bh = s * 0.24, by = cy + s * 0.45, x0 = cx - bw / 2;
        g.fillStyle = metal(g, x0, cy - s, x0 + bw, by + bh, P);
        g.beginPath(); g.moveTo(x0, by);
        const peaks = [[0, -0.55], [0.25, -0.85], [0.5, -1.05], [0.75, -0.85], [1, -0.55]], vals = [[0.125, -0.15], [0.375, -0.25], [0.625, -0.25], [0.875, -0.15]];
        g.lineTo(x0 + peaks[0][0] * bw, cy + peaks[0][1] * s);
        for (let i = 0; i < 4; i++) { g.lineTo(x0 + vals[i][0] * bw, cy + vals[i][1] * s); g.lineTo(x0 + peaks[i + 1][0] * bw, cy + peaks[i + 1][1] * s); }
        g.lineTo(x0 + bw, by); g.closePath(); g.fill(); noShadow(g);
        g.fillRect(x0, by + 10 * u, bw, bh);
        peaks.forEach((p) => { const c = g.createRadialGradient(x0 + p[0] * bw - 6 * u, cy + p[1] * s - 6 * u, 0, x0 + p[0] * bw, cy + p[1] * s, 26 * u); c.addColorStop(0, P.m[0]); c.addColorStop(1, P.m[2]); g.fillStyle = c; circle(g, x0 + p[0] * bw, cy + p[1] * s - 14 * u, 22 * u); g.fill(); });
        g.fillStyle = hexA(P.m[3], 0.8); [0.25, 0.5, 0.75].forEach((k) => gem(g, x0 + k * bw, by + 10 * u + bh / 2, bh * 0.32));
      }
      g.restore();
      caption(g, W, P, txt, W * 0.8, u);
    } else if (L.style === 'shield') { // écusson
      const cx = W / 2, cy = W * 0.48, w = W * 0.56, h = W * 0.62;
      const path = (k, dy) => { const ww = w * k, hh = h * k, x0 = cx - ww / 2, x1 = cx + ww / 2, y0 = cy + (dy || 0) - hh / 2, y1 = cy + (dy || 0) + hh / 2;
        g.beginPath(); g.moveTo(x0, y0 + hh * 0.07); g.quadraticCurveTo(cx, y0 - hh * 0.05, x1, y0 + hh * 0.07); g.lineTo(x1, y0 + hh * 0.5);
        g.bezierCurveTo(x1, y0 + hh * 0.78, cx + ww * 0.2, y0 + hh * 0.9, cx, y1); g.bezierCurveTo(cx - ww * 0.2, y0 + hh * 0.9, x0, y0 + hh * 0.78, x0, y0 + hh * 0.5); g.closePath(); };
      g.save(); dropShadow(g, u, P.light ? 0.25 : 0.55); g.fillStyle = metal(g, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, P); path(1); g.fill(); g.restore();
      const fd = g.createRadialGradient(cx, cy - h * 0.25, 0, cx, cy, h * 0.6); fd.addColorStop(0, P.bg[1]); fd.addColorStop(1, P.bg[0]);
      g.fillStyle = fd; path(0.86, -h * 0.01); g.fill();
      g.strokeStyle = hexA(P.m[0], P.light ? 0.5 : 0.35); g.lineWidth = 2.5 * u; path(0.8, -h * 0.015); g.stroke();
      g.fillStyle = metal(g, cx - 60 * u, cy - h * 0.36, cx + 60 * u, cy - h * 0.3, P); [-1, 0, 1].forEach((k) => gem(g, cx + k * 44 * u, cy - h * 0.32, (k ? 9 : 13) * u));
      serifLetter(g, P, letter, cx, cy + h * 0.03, w * 0.55, Math.round(h * 0.5), u);
    } else if (L.style === 'hex') { // insigne hexagonal biseauté
      const cx = W / 2, cy = W / 2, r = W * 0.39, ri = r * 0.84;
      const pts = (rr) => Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
      const O = pts(r), I = pts(ri), poly = (A) => { g.beginPath(); A.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      g.save(); dropShadow(g, u, P.light ? 0.25 : 0.55); g.fillStyle = P.m[2]; poly(O); g.fill(); g.restore();
      const tones = [P.m[0], P.m[1], P.m[2], P.m[3], P.m[2], P.m[1]];
      for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; g.fillStyle = tones[i]; poly([O[i], O[j], I[j], I[i]]); g.fill(); }
      const fd = g.createRadialGradient(cx, cy - ri * 0.4, 0, cx, cy, ri); fd.addColorStop(0, P.bg[1]); fd.addColorStop(1, P.bg[0]); g.fillStyle = fd; poly(I); g.fill();
      g.strokeStyle = hexA(P.m[1], 0.55); g.lineWidth = 2 * u; poly(pts(ri * 0.9)); g.stroke();
      serifLetter(g, P, letter, cx, cy, ri * 1.05, Math.round(ri * 1.2), u);
    } else if (L.style === 'seal') { // sceau de cire
      const cx = W / 2, cy = W / 2, r = W * 0.37, n = 30, pts = [];
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * (0.94 + R() * 0.09); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      g.save(); dropShadow(g, u, P.light ? 0.3 : 0.6);
      const wax = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r * 1.05); wax.addColorStop(0, P.m[1]); wax.addColorStop(0.55, P.m[2]); wax.addColorStop(1, P.m[3]);
      g.fillStyle = wax; g.beginPath();
      pts.forEach((p, i) => { const q = pts[(i + 1) % n], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; if (!i) g.moveTo(mx, my); else g.quadraticCurveTo(p[0], p[1], mx, my); });
      const p0 = pts[0], p1 = pts[1]; g.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2); g.closePath(); g.fill(); g.restore();
      const ri = r * 0.72, inner = g.createRadialGradient(cx + ri * 0.2, cy + ri * 0.25, 0, cx, cy, ri); inner.addColorStop(0, P.m[1]); inner.addColorStop(1, P.m[2]);
      g.fillStyle = inner; circle(g, cx, cy, ri); g.fill();
      const bv = g.createLinearGradient(cx - ri, cy - ri, cx + ri, cy + ri); bv.addColorStop(0, hexA(P.m[3], 0.85)); bv.addColorStop(1, hexA(P.m[0], 0.75));
      g.strokeStyle = bv; g.lineWidth = 9 * u; circle(g, cx, cy, ri); g.stroke();
      g.fillStyle = hexA(P.m[3], 0.55); for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; circle(g, cx + Math.cos(a) * ri * 0.86, cy + Math.sin(a) * ri * 0.86, 3.2 * u); g.fill(); }
      const s = fitText(g, letter, '700 {s}px ' + LOGO_FONTS.serif, ri * 1.05, Math.round(ri * 1.15));
      g.font = '700 ' + s + 'px ' + LOGO_FONTS.serif; const y = midY(g, letter, cy);
      g.fillStyle = hexA(P.m[0], 0.6); g.fillText(letter, cx + 3 * u, y + 4 * u);
      g.fillStyle = hexA(P.m[3], 0.9); g.fillText(letter, cx, y);
    } else if (L.style === 'glass') { // tuile de cristal sur halo coloré
      const cx = W / 2, cy = W / 2, hs = W * 0.31, rr = W * 0.085;
      [[0.32, 0.34, P.m[1], 0.55], [0.68, 0.62, P.m[2], 0.5], [0.55, 0.28, P.m[0], 0.35]].forEach((b) => { const bg2 = g.createRadialGradient(W * b[0], W * b[1], 0, W * b[0], W * b[1], W * 0.36); bg2.addColorStop(0, hexA(b[2], b[3])); bg2.addColorStop(1, hexA(b[2], 0)); g.fillStyle = bg2; g.fillRect(0, 0, W, W); });
      const tile = () => { g.beginPath(); g.moveTo(cx - hs + rr, cy - hs); g.arcTo(cx + hs, cy - hs, cx + hs, cy + hs, rr); g.arcTo(cx + hs, cy + hs, cx - hs, cy + hs, rr); g.arcTo(cx - hs, cy + hs, cx - hs, cy - hs, rr); g.arcTo(cx - hs, cy - hs, cx + hs, cy - hs, rr); g.closePath(); };
      g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 60 * u; g.shadowOffsetY = 24 * u; g.fillStyle = P.light ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.07)'; tile(); g.fill(); g.restore();
      const gl = g.createLinearGradient(cx, cy - hs, cx, cy + hs); gl.addColorStop(0, 'rgba(255,255,255,.2)'); gl.addColorStop(0.5, 'rgba(255,255,255,.04)'); gl.addColorStop(1, 'rgba(255,255,255,.1)'); g.fillStyle = gl; tile(); g.fill();
      const st = g.createLinearGradient(cx - hs, cy - hs, cx + hs, cy + hs); st.addColorStop(0, 'rgba(255,255,255,.75)'); st.addColorStop(0.5, 'rgba(255,255,255,.12)'); st.addColorStop(1, 'rgba(255,255,255,.4)');
      g.strokeStyle = st; g.lineWidth = 3 * u; tile(); g.stroke();
      serifLetter(g, P, letter, cx, cy, hs * 1.3, Math.round(hs * 1.45), u);
    } else if (L.style === 'word') {
      const sp0 = 0.09; let s = Math.round(220 * u), tw;
      do { g.font = '700 ' + s + 'px ' + LOGO_FONTS.caps; tw = spaced(g, txt, 0, 0, s * sp0, false); s -= 4; } while (tw > W * 0.76 && s > 30);
      s += 4; g.font = '700 ' + s + 'px ' + LOGO_FONTS.caps; tw = spaced(g, txt, 0, 0, s * sp0, false);
      const cy = W * 0.5, y = midY(g, txt, cy), paint = () => spaced(g, txt, W / 2, y, s * sp0);
      emboss(g, P, paint, 5 * u);
      g.fillStyle = metal(g, W / 2 - tw / 2, cy - s / 2, W / 2 + tw / 2, cy + s / 2, P); paint();
      const top = cy - s * 0.62, btm = cy + s * 0.62, half = Math.min(tw / 2, W * 0.32);
      g.fillStyle = hexA(P.m[1], 0.8);
      g.fillRect(W / 2 - half, top - 1.5 * u, half - 30 * u, 3 * u); g.fillRect(W / 2 + 30 * u, top - 1.5 * u, half - 30 * u, 3 * u); gem(g, W / 2, top, 14 * u);
      g.fillRect(W / 2 - half, btm - 1.5 * u, half * 2, 3 * u);
      g.fillStyle = hexA(P.m[1], 0.9); [-1, 0, 1].forEach((k) => gem(g, W / 2 + k * 36 * u, btm + 40 * u, 8 * u));
    } else if (L.style === 'mascot') {
      const cx = W / 2, cy = W * 0.43, r = W * 0.29, f = r * 0.84;
      g.save(); dropShadow(g, u, P.light ? 0.25 : 0.55); g.fillStyle = metal(g, cx - r, cy - r, cx + r, cy + r, P); circle(g, cx, cy, r); g.fill(); g.restore();
      g.strokeStyle = hexA(P.m[3], 0.5); g.lineWidth = 2 * u; circle(g, cx, cy, r * 0.93); g.stroke();
      const fd = g.createRadialGradient(cx, cy - f * 0.3, 0, cx, cy, f); fd.addColorStop(0, P.bg[1]); fd.addColorStop(1, P.bg[0]); g.fillStyle = fd; circle(g, cx, cy, f); g.fill();
      const bv = g.createLinearGradient(cx - f, cy - f, cx + f, cy + f); bv.addColorStop(0, hexA(P.m[3], 0.9)); bv.addColorStop(1, hexA(P.m[0], 0.9)); g.strokeStyle = bv; g.lineWidth = 6 * u; circle(g, cx, cy, f); g.stroke();
      g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 36 * u; g.shadowOffsetY = 14 * u; g.textBaseline = 'middle';
      g.font = Math.round(f * 1.05) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.fillText(L.emoji || '✨', cx, cy + 10 * u); g.restore();
      g.save(); circle(g, cx, cy, f); g.clip(); g.translate(cx, cy - f * 0.62); g.scale(1, 0.42);
      const gl = g.createLinearGradient(0, -f * 0.7, 0, f * 0.7); gl.addColorStop(0, 'rgba(255,255,255,.2)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; circle(g, 0, 0, f * 0.8); g.fill(); g.restore();
      caption(g, W, P, txt, W * 0.8, u);
    } else { // monogramme
      const cx = W / 2, cy = W * 0.43, r = W * 0.29;
      g.strokeStyle = metal(g, cx - r, cy - r, cx + r, cy + r, P);
      [[r, 7], [r - 20 * u, 2.5]].forEach((k) => { const gap = 34 * u / k[0]; g.lineWidth = k[1] * u; [-Math.PI / 2, Math.PI / 2].forEach((a) => { g.beginPath(); g.arc(cx, cy, k[0], a + gap, a + Math.PI - gap); g.stroke(); }); });
      g.fillStyle = metal(g, cx - 20 * u, cy - r - 20 * u, cx + 20 * u, cy - r + 20 * u, P); gem(g, cx, cy - r, 16 * u); gem(g, cx, cy + r, 16 * u);
      serifLetter(g, P, letter, cx, cy + 4 * u, r * 1.15, Math.round(r * 1.5), u);
      caption(g, W, P, txt, W * 0.8, u);
    }
    if (L.style === 'meme') { /* aplat net, sans grain */ }
    else if (L.style === 'illus') { try { g.save(); g.globalAlpha = 0.03; g.globalCompositeOperation = 'overlay'; g.drawImage(grain(W), 0, 0); g.restore(); } catch (e) {} }
    else finish(g, W, P);
    g.restore();
  }
  function shade(hex, f) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; const n = parseInt(m[1], 16);
    const ch = (c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f);
    return 'rgb(' + ch(n >> 16) + ',' + ch((n >> 8) & 255) + ',' + ch(n & 255) + ')';
  }
  function drawLogo() {
    const cv = $('logoCv'); if (!cv) return;
    if (cv.width !== 1024) { cv.width = 1024; cv.height = 1024; }
    if (S.draft.imgSrc === 'upload') { renderLaunchSide(); return; }
    const key = JSON.stringify([S.draft.logo, S.draft.symbol, S.draft.name, fontsReady]);
    const visible = S.page === 'launch' && S.ltab === 'studio' && S.step === 2;
    // à l'ouverture, l'image enregistrée suffit : le canevas 1024 px n'est dessiné qu'à l'étape Logo ou quand le logo change
    if (drawLogo.key === undefined && !visible) { drawLogo.key = key; renderLaunchSide(); return; }
    if (key === drawLogo.key && (drawLogo.painted || !visible)) { renderLaunchSide(); return; }
    drawLogo.key = key; drawLogo.painted = true;
    paintLogo(cv, S.draft.logo, S.draft.symbol);
    try { S.draft.image = cv.toDataURL('image/jpeg', 0.92); } catch (e) {}
    if (cv.toBlob) cv.toBlob((b) => { if (b && S.draft.imgSrc !== 'upload') S.imgBlob = b; }, 'image/jpeg', 0.92);
    S.draft.imgSrc = 'gen'; saveDraft();
    renderLaunchSide();
    if (!fontsReady) loadFonts().then(() => { if (S.draft.imgSrc !== 'upload') drawLogo(); renderIdeas(); });
  }
  function ideaLogo(x) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    paintLogo(c, { style: x.style || 'meme', pal: x.pal, theme: x.theme, motif: x.motif, mchar: x.mchar, name: x.name, text: x.ticker, emoji: x.emo, seed: x.seed || nameSeed(x.name) }, x.ticker);
    try { return c.toDataURL('image/png'); } catch (e) { return ''; }
  }

  /* ================================================================ logo : génération pour le token, import, aperçus */
  S.logoVars = null; S.uploadWarn = [];
  const shuffled = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  function logoThumb(L, sym, size) {
    const c = document.createElement('canvas'); c.width = c.height = size || 256;
    paintLogo(c, L, sym);
    try { return c.toDataURL('image/jpeg', 0.9); } catch (e) { return ''; }
  }
  function logoTicker() { const d = S.draft; return (d.symbol || '').trim() || (d.name.trim() ? tickerFor(d.name) : ''); }
  // Six propositions pour le nom et le ticker en cours : styles et palettes tous différents
  function logoVariants() {
    const d = S.draft, txt = logoTicker();
    if (!txt) { toast('Nom du token manquant', 'Choisissez une idée à l\'étape 1, ou saisissez un nom et un ticker à l\'étape 3.', 'a'); return; }
    const th = THEMES[d.theme] || THEMES.luxe;
    const styles = ['meme', 'meme', 'meme', 'illus'].concat(shuffled(Object.keys(STYLES).filter((k) => !['mascot', 'illus', 'meme'].includes(k))).slice(0, 2));
    const pals = shuffled(PALS.map((_, i) => i).filter((i) => i !== th.pal)); pals.unshift(th.pal);
    const emoji = d.logo.emoji || rnd(th.mascot || ['✨']);
    const mot = MOTIFS[d.theme] || MOTIFS.luxe, m0 = d.logo.motif && mot.includes(d.logo.motif) ? d.logo.motif : pickMotif(d.theme, d.name, 0), m1 = mot.find((m) => m !== m0) || m0;
    const mcl = MEME.theme[d.theme] || MEME.theme.meme, c0 = MEME.chars[d.logo.mchar] ? d.logo.mchar : ((MEME_WORDS.find(([re]) => re.test(d.name)) || [])[1] || mcl[0]), c1 = shuffled(mcl.filter((c) => c !== c0))[0] || c0;
    S.logoVars = styles.map((st, i) => ({ style: st, pal: st === 'meme' ? Math.floor(Math.random() * MEME.bg.length) : pals[i % pals.length], seed: Math.floor(Math.random() * 1e6), emoji, text: txt, theme: d.theme, motif: i === 3 ? m1 : m0, mchar: st === 'meme' ? (i === 2 ? c1 : c0) : '', name: d.name }));
    S.logoVars.forEach((v) => { v.img = logoThumb(v, txt); });
    renderLogoVars();
    if (!fontsReady) loadFonts().then(() => { if (S.logoVars) { S.logoVars.forEach((v) => { v.img = logoThumb(v, v.text); }); renderLogoVars(); } });
  }
  function renderLogoVars() {
    const el = $('logoVars'); if (!el) return;
    const txt = logoTicker();
    $('logoGenHint').textContent = txt ? 'Pour $' + txt + (S.draft.name ? ' · ' + S.draft.name : '') : 'Choisissez d\'abord un nom à l\'étape 1 ou 3.';
    if (!S.logoVars) { el.hidden = true; return; }
    el.hidden = false;
    const L = S.draft.logo, cur = S.draft.imgSrc !== 'upload';
    el.innerHTML = S.logoVars.map((v, i) => '<button class="lvar' + (cur && L.style === v.style && L.pal === v.pal && L.seed === v.seed ? ' on' : '') + '" data-lvar="' + i + '" type="button"><img src="' + v.img + '" alt=""><span>' + esc(STYLES[v.style]) + '<small>' + esc(v.style === 'meme' ? (MEME.chars[v.mchar] || 'Personnage') : (PALS[v.pal % PALS.length] || PALS[0]).n) + '</small></span></button>').join('');
  }
  function applyLogoVar(i) {
    const v = S.logoVars && S.logoVars[i]; if (!v) return;
    S.draft.logo = Object.assign({}, S.draft.logo, { style: v.style, pal: v.pal, seed: v.seed, emoji: v.emoji, text: v.text, theme: v.theme, motif: v.motif, mchar: v.mchar || '', mexpr: '', macc: null, name: v.name, textCustom: false });
    S.draft.imgSrc = 'gen'; S.imgBlob = null; S.uploadWarn = [];
    saveDraft(); renderLaunch();
  }
  function renderLogoSrc() {
    const up = S.draft.imgSrc === 'upload';
    $('logoSrc').innerHTML = up ? '<b>Image importée.</b> ' + (S.uploadWarn.length ? esc(S.uploadWarn.join(' · ')) : 'Elle remplace le logo généré.') : 'Logo généré · JPEG 1024 × 1024';
    $('logoSrc').classList.toggle('warn', up && S.uploadWarn.length > 0);
    $('logoBackGen').hidden = !up;
  }
  // L'image importée occupe tout le canevas (recadrage carré déjà fait à l'import)
  function drawUploaded() {
    const cv = $('logoCv'); if (!cv || !S.draft.image) return;
    const im = new Image();
    im.onload = () => { const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); const sd = Math.min(im.naturalWidth, im.naturalHeight); g.drawImage(im, (im.naturalWidth - sd) / 2, (im.naturalHeight - sd) / 2, sd, sd, 0, 0, cv.width, cv.height); };
    im.src = S.draft.image;
  }
  function readFile(f) { return new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = () => rej(new Error('Lecture du fichier impossible.')); rd.readAsDataURL(f); }); }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Image illisible ou corrompue.')); im.src = src; }); }
  // Carré centré, 512 à 1024 px, JPEG si opaque, PNG si transparent ; les GIF animés sont gardés tels quels
  async function importLogo(f) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return toast('Format refusé', 'PNG, JPG, GIF ou WEBP uniquement.', 'r');
    if (f.size > 4 * 1024 * 1024) return toast('Image trop lourde', '4 Mo maximum. Réduisez-la ou exportez-la en JPG.', 'r');
    try {
      const src = await readFile(f), im = await loadImg(src), w = im.naturalWidth, h = im.naturalHeight, warn = [];
      if (Math.min(w, h) < 400) warn.push('petite image (' + w + ' × ' + h + '), elle peut paraître floue');
      let url = src, blob = f;
      if (f.type === 'image/gif') {
        if (Math.abs(w - h) > 2) warn.push('GIF non carré : les plateformes le recadreront');
      } else {
        const side = Math.min(w, h), size = Math.min(1024, Math.max(512, side)), c = document.createElement('canvas'); c.width = c.height = size;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
        if (Math.abs(w - h) > 2) warn.push('recadrée au centre en carré');
        let alpha = false; try { const px = g.getImageData(0, 0, size, size).data; for (let i = 3; i < px.length; i += 4 * 13) if (px[i] < 250) { alpha = true; break; } } catch (e) {}
        if (alpha) warn.push('fond transparent : il prendra la couleur de chaque plateforme');
        const type = alpha ? 'image/png' : 'image/jpeg';
        url = c.toDataURL(type, 0.92); blob = await new Promise((r) => c.toBlob(r, type, 0.92)) || f;
      }
      S.draft.image = url; S.draft.imgSrc = 'upload'; S.imgBlob = blob; S.uploadWarn = warn; S.logoVars = null; drawLogo.key = null;
      saveDraft(); renderLaunch();
      toast('Logo remplacé', f.name + (warn.length ? ' · ' + warn[0] : ''), warn.length ? 'a' : 'g');
    } catch (e) { toast('Import impossible', e.message, 'r'); }
  }
  // Aperçus aux tailles réelles des plateformes
  function renderLogoPrev() {
    const el = $('logoPrev'); if (!el || S.step !== 2 || S.ltab !== 'studio') return;   // visible seulement à l'étape Logo
    const img = S.draft.image, k = img ? img.length + img.slice(-48) : '';
    if (el.dataset.k === k && el.firstChild) return;   // même image : on n'insère pas à nouveau 4 copies d'une grosse image
    el.dataset.k = k;
    const src = img && /^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/.test(img) ? img : esc(img || '');
    const i = (cls) => img ? '<img class="' + cls + '" src="' + src + '" alt="">' : '<span class="' + cls + ' none"></span>';
    el.innerHTML = '<div class="lp-t">Aperçu sur les plateformes</div><div class="lp-row">' +
      '<figure>' + i('lp-card') + '<figcaption>pump.fun<br>fiche</figcaption></figure>' +
      '<figure>' + i('lp-list') + '<figcaption>pump.fun<br>liste</figcaption></figure>' +
      '<figure>' + i('lp-round') + '<figcaption>Phantom,<br>DexScreener</figcaption></figure>' +
      '<figure>' + i('lp-tiny') + '<figcaption>Notification</figcaption></figure></div>';
  }
  const drop = $('logoDrop');
  if (drop) {
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) importLogo(f); });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'logoGen') return logoVariants();
    if (b.id === 'logoVary') { if (!logoTicker()) return logoVariants(); S.draft.logo.seed = Math.floor(Math.random() * 1e6); S.draft.logo.pal = (S.draft.logo.pal + 1 + Math.floor(Math.random() * (PALS.length - 1))) % PALS.length; S.draft.logo.text = S.draft.logo.textCustom ? S.draft.logo.text : logoTicker(); S.draft.imgSrc = 'gen'; S.imgBlob = null; S.uploadWarn = []; saveDraft(); renderLaunch(); return; }
    if (b.dataset.lvar != null) return applyLogoVar(+b.dataset.lvar);
    if (b.id === 'logoBackGen') { S.draft.imgSrc = 'gen'; S.imgBlob = null; S.uploadWarn = []; saveDraft(); renderLaunch(); toast('Logo généré rétabli', 'L\'image importée n\'est plus utilisée.', 'g'); }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'logoSafe') $('logoStage').classList.toggle('safe', e.target.checked); });

  /* ================================================================ préparation (checklist) */
  function readiness() {
    const d = S.draft, dev = num(d.dev) || 0, q = dev > 0 ? quoteBuy(INIT_CURVE, dev) : null, items = [];
    const add = (ok, label, kind) => items.push({ ok, label, kind: kind || 'req' });
    add(d.name.trim().length >= 1 && d.name.length <= 32, 'Nom (1 à 32 caractères)');
    add(/^[A-Z0-9]{2,10}$/.test(d.symbol), 'Ticker de 2 à 10 lettres ou chiffres');
    add(d.desc.trim().length >= 10, 'Description');
    add(d.desc.trim().length >= 60, 'Description d\'au moins 60 caractères', 'rec');
    add(!!d.image, 'Logo');
    add(!!(d.tw || d.tg || d.web), 'Au moins un lien (X, Telegram ou site)', 'rec');
    add(!FAMOUS.includes(d.symbol), 'Ticker différent des tokens célèbres', 'rec');
    // démo : wallet démo et marché simulé, aucun wallet ni RPC nécessaire
    if (cfg.sim) {
      add(true, 'Wallet démo (' + fSol(DEMO.bal, 2) + ' fictifs)');
      add(DEMO.bal >= dev + 0.03, 'Solde démo suffisant (' + fSol(dev + 0.03, 2) + ' nécessaires)');
    } else {
      add(!!S.wallet, 'Wallet connecté');
      if (S.wallet) add(S.bal != null && S.bal >= dev + 0.03, 'Solde suffisant (' + fSol(dev + 0.03, 2) + ' nécessaires)');
    }
    add(!q || q.supplyPct <= cfg.devMaxPct, 'Achat du créateur ≤ ' + cfg.devMaxPct + ' % de l\'offre');
    if (!cfg.sim) add(!!cfg.rpc || !!relay(), cfg.rpc ? 'RPC privé configuré (Helius)' : 'RPC TokenStudio ou clé Helius', 'rec');
    if (d.tpOn && dev > 0) add(tpValid().ok, 'Plan de prise de profit cohérent');
    if (!cfg.sim && cfg.metaMethod === 'pinata') add(!!cfg.pinataJwt, 'Jeton Pinata renseigné');
    const urlOk = (u) => !u || /^https?:\/\/\S+\.\S+/.test(u);
    add(urlOk(d.tw) && urlOk(d.tg) && urlOk(d.web), 'Liens au bon format (https://…)');
    const req = items.filter((x) => x.kind === 'req'), rec = items.filter((x) => x.kind === 'rec');
    const score = Math.round((req.filter((x) => x.ok).length / req.length) * 75 + (rec.filter((x) => x.ok).length / Math.max(1, rec.length)) * 25);
    return { items, score, blocking: req.filter((x) => !x.ok).map((x) => x.label), q };
  }

  /* ================================================================ plan de prise de profit */
  function tpValid() {
    const d = S.draft, errs = [];
    let prev = 1, sum = 0;
    d.tp.forEach((l, i) => { if (!(l.x > prev)) errs.push('Palier ' + (i + 1) + ' : multiplicateur supérieur au précédent attendu'); prev = l.x || prev; if (!(l.pct > 0 && l.pct <= 100)) errs.push('Palier ' + (i + 1) + ' : part entre 1 et 100 %'); sum += l.pct || 0; });
    if (sum > 100) errs.push('Total vendu supérieur à 100 %');
    if (d.sl && !(d.sl > 0 && d.sl < 100)) errs.push('Stop entre 1 et 99 %');
    return { ok: !errs.length, errs, sum };
  }
  const TP_PRESETS = {
    safe: { n: 'Prudent', d: 'Mise récupérée dès ×2', tp: [{ x: 1.5, pct: 30 }, { x: 2, pct: 30 }, { x: 3, pct: 20 }], sl: 35, slMode: 'fixed' },
    balanced: { n: 'Équilibré', d: 'Mise récupérée à ×2, le reste court', tp: [{ x: 2, pct: 55 }, { x: 4, pct: 20 }, { x: 8, pct: 15 }], sl: 40, slMode: 'trail' },
    bold: { n: 'Ambitieux', d: 'Vise les gros multiplicateurs', tp: [{ x: 3, pct: 25 }, { x: 6, pct: 20 }, { x: 10, pct: 20 }, { x: 20, pct: 15 }], sl: 50, slMode: 'trail' },
  };
  const fx = (x) => '×' + fr(x, x % 1 ? 1 : 0);
  // Ce que rapporte chaque palier, en part de la mise (1 = mise récupérée), frais déduits, hors impact sur le prix
  function tpCalc() {
    const d = S.draft, dev = num(d.dev) || 0, f = 1 - feeRate();
    let cum = 0, sold = 0, back = null;
    const rows = d.tp.map((l, i) => { const x = l.x || 0, p = l.pct || 0, part = x * p / 100 * f; cum += part; sold += p; if (back == null && cum >= 1) back = i; return { x, p, part, cum }; });
    const last = rows.length ? rows[rows.length - 1].x : 1, keep = Math.max(0, 100 - sold);
    return { dev, rows, sold, keep, back, cum, keepVal: keep / 100 * last * f, slLoss: d.sl > 0 ? 1 - (1 - d.sl / 100) * f : null };
  }
  const tpAmt = (k, dev) => dev > 0 ? fSol(dev * k, 3) : fr(k * 100, 0) + ' % de la mise';
  const tpAmtH = (k, dev) => dev > 0 ? fSolH(dev * k, 3) : fr(k * 100, 0) + ' % de la mise';
  function renderTpPlan() {
    const d = S.draft, dev = num(d.dev) || 0;
    const head = '<div class="tp-head"><span class="switch"><input type="checkbox" id="tpOn"' + (d.tpOn ? ' checked' : '') + ' aria-label="Activer le plan de prise de profit"><i></i></span><div><h4>Plan de prise de profit</h4><p>Des ventes par paliers, préparées dès le lancement : vous sécurisez vos gains quand le prix monte, sans rester devant l\'écran.</p></div></div>';
    if (!d.tpOn) { $('tpPlan').innerHTML = head + '<p class="tp-off">Désactivé. Vous pourrez toujours créer des ordres plus tard depuis « Ordres préparés ».</p>'; return; }
    const pre = '<div class="tp-presets">' + Object.keys(TP_PRESETS).map((k) => '<button class="tp-pre" data-tppre="' + k + '" type="button"><b>' + TP_PRESETS[k].n + '</b><span>' + TP_PRESETS[k].d + '</span></button>').join('') + '</div>';
    const rows = d.tp.map((l, i) => '<div class="tp-tr"><span class="tp-n">' + (i + 1) + '</span>' +
      '<span class="tp-in"><em>×</em><input type="number" min="1.1" step="0.1" data-tpx="' + i + '" value="' + l.x + '" aria-label="Multiplicateur du palier ' + (i + 1) + '"><small id="tpG' + i + '"></small></span>' +
      '<span class="tp-in"><input type="number" min="1" max="100" step="1" data-tpp="' + i + '" value="' + l.pct + '" aria-label="Part vendue au palier ' + (i + 1) + '"><em>%</em></span>' +
      '<span class="tp-v" id="tpE' + i + '"></span><span class="tp-v" id="tpC' + i + '"></span>' +
      '<button class="btn sm ghost" data-tpdel="' + i + '" type="button" aria-label="Supprimer le palier ' + (i + 1) + '">✕</button></div>').join('');
    $('tpPlan').innerHTML = head + (dev > 0 ? '' : '<div class="notice info">Le plan vend les tokens de votre achat de créateur. Indiquez un montant ci-dessus pour qu\'il s\'applique ; les montants sont affichés en part de la mise en attendant.</div>') + pre +
      '<div class="tp-table"><div class="tp-tr tp-th"><span>#</span><span>Quand le prix atteint</span><span>Vendre <small>de vos tokens</small></span><span>Vous récupérez</span><span>Cumul</span><span></span></div>' + rows + '</div>' +
      '<div class="tp-foot">' + (d.tp.length < 6 ? '<button class="btn sm" data-tpadd="1" type="button">Ajouter un palier</button>' : '') + '</div>' +
      '<div class="tp-ladder" id="tpLadder"></div>' +
      '<div class="tp-stop"><div><b>Stop de protection</b><div class="seg tp-seg" role="group" aria-label="Type de stop"><button type="button" data-slmode="fixed" class="' + (d.slMode === 'trail' ? '' : 'on') + '">Fixe</button><button type="button" data-slmode="trail" class="' + (d.slMode === 'trail' ? 'on' : '') + '">Suiveur</button></div><p>' + (d.slMode === 'trail' ? 'Le stop suit le prix : il retient le plus haut atteint et vend tout ce qui reste si le prix recule de ce pourcentage depuis ce sommet. Il protège vos gains pendant la montée.' : 'Si le prix descend sous votre prix d\'achat de ce pourcentage, tout ce qui reste est vendu.') + ' Laissez vide pour ne pas en mettre.</p></div><span class="tp-in"><em>−</em><input type="number" min="0" max="99" step="1" id="tpSl" value="' + (d.sl || '') + '" placeholder="aucun" aria-label="Seuil du stop en pourcentage"><em>%</em></span></div>' +
      '<div class="tp-sum" id="tpSum"></div><div id="tpErr"></div>' +
      '<p class="tp-note">Estimations frais pump.fun déduits, hors impact de votre vente sur le prix : une grosse vente rapporte un peu moins. Le multiplicateur se compte depuis votre prix d\'achat.</p>';
    renderTpLive();
  }
  // Mise à jour sans reconstruire les champs (la saisie garde le focus)
  function renderTpLive() {
    if (!$('tpSum')) return;
    const d = S.draft, C = tpCalc(), V = tpValid();
    C.rows.forEach((r, i) => {
      const g = $('tpG' + i), e = $('tpE' + i), c = $('tpC' + i); if (!g) return;
      g.textContent = r.x > 1 ? '+' + fr((r.x - 1) * 100, 0) + ' %' : '';
      e.textContent = tpAmt(r.part, C.dev);
      c.innerHTML = '<span class="' + (r.cum >= 1 ? 'pos' : '') + '">' + fr(r.cum * 100, 0) + ' %</span>' + (C.back === i ? ' <span class="badge g">mise récupérée</span>' : '');
    });
    const over = C.sold > 100;
    $('tpLadder').innerHTML = '<div class="tp-bar' + (over ? ' over' : '') + '">' + C.rows.map((r, i) => '<i style="flex:' + Math.max(0, r.p) + ';opacity:' + (1 - i * 0.14) + '" title="' + fx(r.x) + ' : ' + r.p + ' %"><span>' + fx(r.x) + '</span></i>').join('') + (C.keep > 0 ? '<i class="keep" style="flex:' + C.keep + '"><span>gardé</span></i>' : '') + '</div>' +
      '<div class="tp-bar-l"><span>' + (over ? '<b class="neg">' + C.sold + ' % vendu : plus que vos tokens</b>' : C.sold + ' % vendu par paliers') + '</span><span>' + C.keep + ' % gardé jusqu\'à votre décision</span></div>';
    const st = (l, v, s, cl) => '<div class="stat"><div class="l">' + l + '</div><div class="v ' + (cl || '') + '">' + v + '</div><div class="s">' + s + '</div></div>';
    $('tpSum').innerHTML =
      st('Mise récupérée', C.back != null ? 'à ' + fx(C.rows[C.back].x) : 'jamais', C.back != null ? 'au palier ' + (C.back + 1) + ', le reste est du bonus' : 'augmentez la part vendue aux premiers paliers', C.back != null ? 'pos' : 'warn') +
      st('Si tous les paliers sont atteints', tpAmtH(C.cum, C.dev), C.keep > 0 ? '+ ' + C.keep + ' % gardés (≈ ' + tpAmtH(C.keepVal, C.dev) + ' au dernier palier)' : 'tout est vendu', 'pos') +
      st('Perte maximale', C.slLoss != null ? (C.dev > 0 ? '<span class="sol" data-sol="' + (-Math.abs(C.dev * C.slLoss)) + '">−' + tpAmt(C.slLoss, C.dev).replace(/^-/, '') + '</span>' : '−' + tpAmt(C.slLoss, C.dev).replace(/^-/, '')) : 'non limitée', C.slLoss != null ? (d.slMode === 'trail' ? 'si le prix recule dès l\'achat ; ensuite le stop remonte avec le prix' : 'si le stop se déclenche avant le 1er palier') : 'pas de stop : le prix peut aller jusqu\'à 0', C.slLoss != null ? '' : 'neg');
    $('tpErr').innerHTML = V.ok ? '' : '<div class="danger-note">' + V.errs.map(esc).join(' · ') + '</div>';
    const cur = JSON.stringify({ tp: d.tp.map((l) => ({ x: l.x, pct: l.pct })), sl: d.sl || 0, m: d.slMode === 'trail' ? 'trail' : 'fixed' });
    document.querySelectorAll('[data-tppre]').forEach((b) => { const p = TP_PRESETS[b.dataset.tppre]; b.classList.toggle('on', JSON.stringify({ tp: p.tp, sl: p.sl, m: p.slMode }) === cur); });
  }
  document.addEventListener('click', (e) => {
    const sm = e.target.closest('[data-slmode]'); if (sm) { S.draft.slMode = sm.dataset.slmode; saveDraft(); renderTpPlan(); renderLaunchSide(); return; }
    const b = e.target.closest('[data-tppre]'); if (!b) return;
    const p = TP_PRESETS[b.dataset.tppre]; S.draft.tp = p.tp.map((l) => Object.assign({}, l)); S.draft.sl = p.sl; S.draft.slMode = p.slMode; S.draft.tpOn = true;
    saveDraft(); renderTpPlan(); renderLaunchSide();
  });

  /* ================================================================ génération automatique */
  const AUTO_THEMES = Object.keys(THEMES);
  async function autoGenerate() {
    if (!S.draft.word && Math.random() < 0.5) S.draft.theme = AUTO_THEMES[Math.floor(Math.random() * AUTO_THEMES.length)];
    S.draft.tone = S.draft.tone || 'drole';
    genIdeas();
    const best = S.ideas[0]; if (!best) return;
    pickIdea(0, true);
    if (S.draft.logo.style === 'mascot') S.draft.logo.style = 'mono';
    S.draft.imgSrc = 'gen'; S.imgBlob = null;
    if (!S.draft.tp || !S.draft.tp.length) S.draft.tp = [{ x: 2, pct: 25 }, { x: 3, pct: 25 }, { x: 5, pct: 25 }];
    S.draft.tpOn = true;
    saveDraft(); S.step = 4; renderLaunch();
    toast('Token généré', best.name + ' · $' + best.ticker + ' · note ' + best.score + '/100. Vérifiez puis lancez.', 'g');
  }

  /* ================================================================ palettes de l'interface (bouton « Personnaliser » de la barre latérale) */
  const NEUT = ['bg', 'bg2', 'panel', 'panel2', 'panel3', 'line', 'line2', 'text', 'muted', 'dim'];
  const UI_THEMES = [
    { id: 'or', n: 'Or champagne', d: 'Graphite chaud et or', a: ['#d6b26e', '#f0dfb6', '#1b1407'], amber: '#f2894b', x: ['#0b0a09', '#0f0e0c', '#141311', '#1a1916', '#211f1b', '#2a2722', '#37332c', '#f3efe6', '#b9b1a2', '#8b8375'] },
    { id: 'platine', n: 'Platine', d: 'Anthracite et argent', a: ['#cfd6e3', '#eef2f8', '#12151b'], amber: '#f3b53f', x: ['#0b0c0e', '#0f1013', '#141518', '#1a1b1f', '#212227', '#2a2b31', '#36383f', '#f2f3f5', '#b3b6bd', '#868a93'] },
    { id: 'saphir', n: 'Saphir', d: 'Nuit marine et bleu', a: ['#6aa8ff', '#d4e6ff', '#06142b'], amber: '#f3b53f', x: ['#090c12', '#0c1018', '#10151f', '#151b27', '#1b2230', '#222a39', '#2d3748', '#eef3fa', '#a9b6c8', '#7f8ca0'] },
    { id: 'jade', n: 'Jade', d: 'Ardoise et vert d\'eau', a: ['#4fd1b5', '#c9f3e8', '#04201a'], amber: '#f3b53f', x: ['#090d0c', '#0c1110', '#111716', '#161d1c', '#1c2422', '#232c2a', '#2e3a37', '#eef5f3', '#a8bab5', '#7d8f8a'] },
    { id: 'cuivre', n: 'Cuivre', d: 'Brun fumé et cuivre', a: ['#e0956a', '#f7d6c2', '#2a1206'], amber: '#f3c74b', x: ['#0d0a09', '#110e0c', '#171311', '#1d1816', '#241e1b', '#2d2522', '#3a302b', '#f5eee9', '#bcaea5', '#8e7f76'] },
    { id: 'iris', n: 'Iris', d: 'Encre et violet (d\'origine)', a: ['#9483ff', '#d9d3ff', '#120d2b'], amber: '#f3b53f', x: ['#0a0b12', '#0d0f17', '#11131c', '#161925', '#1c202e', '#212536', '#2d3247', '#f1f2f8', '#acb2c6', '#848ba2'] },
  ];
  // Intensité du fond : on éclaircit les neutres vers un gris doux et on baisse un peu l'éclat du texte
  const UI_DEPTH = { nuit: { n: 'Nuit', bg: -0.4, ln: -0.18, tx: 0.02, glow: '2%' }, profond: { n: 'Profond', bg: 0, ln: 0, tx: 0.02, glow: '3%' }, doux: { n: 'Doux', bg: 0.05, ln: 0.05, tx: 0.06, glow: '3%' } };
  let uiTheme = 'or', uiDepth = 'profond';
  function tone(h, v) { return v < 0 ? mixHex(h, '#000000', -v) : mixHex(h, '#ffffff', v); }
  function mixHex(a, b, t) { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
  function applyUiTheme(id, quiet, depth, origin) {
    if (depth) uiDepth = depth;
    const t = UI_THEMES.find((x) => x.id === id) || UI_THEMES[0], st = document.documentElement.style, D = UI_DEPTH[uiDepth] || UI_DEPTH.profond;
    // panneaux un peu plus sombres que la palette d'origine ; textes secondaires éclaircis pour la lisibilité, texte principal sans blanc pur
    const PANEL_DARK = [0, 0, 0.24, 0.2, 0.16], TEXT_LIFT = [0, 0, 0, 0, 0, 0, 0, 0, 0.16, 0.2];
    NEUT.forEach((k, i) => st.setProperty('--' + k, i < 5 ? tone(tone(t.x[i], -PANEL_DARK[i]), i ? D.bg * (1 - i * 0.12) : D.bg) : i < 7 ? tone(t.x[i], D.ln) : i === 7 ? mixHex(t.x[i], t.x[0], D.tx) : mixHex(t.x[i], '#ffffff', TEXT_LIFT[i])));
    st.setProperty('--glow', D.glow);
    try { localStorage.setItem('pstudio_ui_depth2', uiDepth); } catch (e) {}
    st.setProperty('--accent', t.a[0]); st.setProperty('--accent-ink', t.a[1]); st.setProperty('--on-accent', t.a[2]); st.setProperty('--amber', t.amber);
    const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.setAttribute('content', tone(t.x[0], D.bg));
    uiTheme = t.id;
    try { localStorage.setItem('pstudio_ui_theme', t.id); } catch (e) {}
    const sw = $('sideThemeDots'); if (sw) sw.innerHTML = '<i style="background:' + t.a[0] + '"></i><i style="background:' + t.x[4] + '"></i><i style="background:' + t.x[7] + '"></i>';
    document.querySelectorAll('[data-uitheme]').forEach((b) => { b.classList.toggle('on', b.dataset.uitheme === t.id); b.setAttribute('aria-pressed', b.dataset.uitheme === t.id); });
    document.querySelectorAll('[data-uidepth]').forEach((b) => { b.classList.toggle('on', b.dataset.uidepth === uiDepth); b.setAttribute('aria-pressed', b.dataset.uidepth === uiDepth); });
    try { window.dispatchEvent(new CustomEvent('pstudio-theme', { detail: Object.assign({}, t, { depth: uiDepth, origin: origin || 'app' }) })); } catch (e) {}
    if (!quiet) toast('Palette appliquée', t.n, 'g');
  }
  function themePicker() {
    const card = (t) => '<button type="button" class="uit-card' + (t.id === uiTheme ? ' on' : '') + '" data-uitheme="' + t.id + '" aria-pressed="' + (t.id === uiTheme) + '">' +
      '<span class="uit-prev" style="background:' + t.x[0] + ';border-color:' + t.x[5] + '"><span class="uit-side" style="background:' + t.x[1] + ';border-color:' + t.x[5] + '"><i style="background:' + t.a[0] + '"></i><i style="background:' + t.x[6] + '"></i><i style="background:' + t.x[6] + '"></i></span>' +
      '<span class="uit-main"><span class="uit-card-in" style="background:' + t.x[2] + ';border-color:' + t.x[5] + '"><b style="color:' + t.x[7] + '">Aa</b><em style="color:' + t.x[8] + '">5,000 SOL</em></span>' +
      '<span class="uit-btn" style="background:' + t.a[0] + ';color:' + t.a[2] + '">Lancer</span></span></span>' +
      '<span class="uit-t"><b>' + esc(t.n) + '</b><small>' + esc(t.d) + '</small></span></button>';
    modal('Personnaliser les couleurs', '<p class="muted" style="margin:0 0 14px">La palette s\'applique tout de suite à tout le studio et reste enregistrée dans ce navigateur. Les couleurs de gain, de perte et d\'alerte ne changent pas.</p>' +
      '<div class="uit-depth"><span><b>Intensité du fond</b><small>Nuit = le plus sombre · Doux = gris charbon</small></span><div class="seg">' + Object.keys(UI_DEPTH).map((k) => '<button type="button" data-uidepth="' + k + '" class="' + (k === uiDepth ? 'on' : '') + '" aria-pressed="' + (k === uiDepth) + '">' + UI_DEPTH[k].n + '</button>').join('') + '</div></div><div class="uit-grid">' + UI_THEMES.map(card).join('') + '</div>', [{ label: 'Fermer', cls: 'primary' }], true);
  }
  try { const dp = localStorage.getItem('pstudio_ui_depth2'); if (dp && UI_DEPTH[dp]) uiDepth = dp; } catch (e) {}
  try { applyUiTheme(localStorage.getItem('pstudio_ui_theme') || 'or', true); } catch (e) { applyUiTheme('or', true); }
  /* ================================================================ rendu : en-tête */
  const PAGES = { account: ['Mon compte', 'Profil, préférences, wallets et sécurité'], dash: ['Tableau de bord','Solde, marché, ordres et activité en un coup d\'œil'], wallet: ['Portefeuille', 'Solde, actifs, dépôts, retraits et activité de vos wallets'], launch: ['Lancer un token', 'Du concept à la publication sur pump.fun'], mine: ['Mes tokens', 'Suivi en direct depuis la blockchain'], trade: ['Trader', 'Analyse de risque, achat et vente'], orders: ['Ordres préparés', 'Surveillance du prix et ventes automatiques'], journal: ['Journal', 'Historique des opérations'], social: ['Communication', 'Messages prêts à publier'], dist: ['Diffusion', 'Référencement sur les grandes plateformes crypto'], settings: ['Réglages', 'Connexion, coûts et sécurité'] };
  function renderTop() {
    const w = S.wallet, ses = w && w.id === 'session';
    // le bouton wallet historique est remplacé par le menu de compte (React) ; on le met à jour s'il existe encore
    const wt = $('walletTxt'); if (wt) wt.innerHTML = w ? (ses ? '<span class="dot ' + (SESSW.kp ? 'on' : 'wait') + '"></span>' : '') + esc(w.name) + (ses && !SESSW.kp ? ' · verrouillé' : '') + ' <span class="addr-s">' + short(w.pk) + '</span>' : 'Connecter le wallet';
    const wb = $('walletBtn'); if (wb) wb.classList.toggle('primary', !S.wallet);
    const rs = $('rpcStatus');
    rs.innerHTML = '<span class="dot ' + (S.rpcOk ? 'on' : S.rpcOk === false ? '' : 'wait') + '"></span><span>' + (S.rpcOk ? 'RPC ' + rpcKind() + ' connecté' : S.rpcOk === false ? 'RPC en erreur' : 'RPC non testé') + '</span>';
    const sb = $('simbar');
    // bandeau en démo seulement : en réel, aucune mention de simulation (le mode se change dans le menu du compte)
    sb.className = 'simbar'; sb.hidden = !cfg.sim;
    sb.innerHTML = cfg.sim ? '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg><span><b>Mode démo.</b> Tout est simulé avec le wallet démo de 10 SOL fictifs : rien n\'est envoyé sur la blockchain.</span>' +
      '<button class="btn sm primary" data-act="' + (AUTH ? 'simoff' : 'needacct') + '" type="button">Passer en réel</button>' : '';
    const fb = $('filebar'); if (fb) { fb.hidden = location.protocol !== 'file:'; fb.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg><span><b>Studio ouvert comme fichier.</b> Phantom ne peut pas s\'y connecter : ouvrez la version en ligne (https) ou via localhost.</span><button class="btn sm" id="fileHelp" type="button">Comment faire</button>'; }
    const rb = $('rpcbar'); if (rb) { rb.hidden = !(S.rpcOk === false) || !!cfg.sim; /* la démo n'utilise pas la blockchain */ rb.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg><span>' + (cfg.rpc ? '<b>Votre RPC ne répond pas.</b> Vérifiez l\'adresse dans Réglages.' : window.TSRelay ? '<b>Le RPC TokenStudio ne répond pas pour le moment.</b> Réessayez dans une minute, ou collez votre clé Helius gratuite dans Réglages.' : '<b>Le RPC public de Solana bloque cette page.</b> Connectez-vous à votre compte pour utiliser le RPC TokenStudio, ou collez votre clé Helius gratuite dans Réglages.') + '</span><button class="btn sm" data-page="settings" type="button">Ouvrir les réglages</button>'; }
    // seule la démo porte une étiquette de mode
    $('footMode').textContent = cfg.sim ? '● Démo' : ''; $('footMode').hidden = !cfg.sim;
    $('footMode').style.color = 'var(--violet)';
    const sc = (attr, dot, label, val) => '<button class="sc-it" type="button" ' + attr + '><span class="dot ' + dot + '"></span>' + label + '<em>' + val + '</em></button>';
    $('sideCheck').innerHTML =       sc('data-sc="pp" data-page="settings"', 'wait', 'Flux direct', '…') +
      (cfg.sim ? '' : sc('data-page="settings"', S.rpcOk ? 'on' : S.rpcOk === false ? 'bad' : 'wait', 'RPC Solana', S.rpcOk ? rpcKind() : S.rpcOk === false ? 'en erreur' : 'non testé')) +
      (cfg.sim ? sc('data-act="simoff"', 'demo', 'Mode', 'démo') : '');
    ppStatus(); renderWalletCard();
    $('cMine').textContent = S.tokens.length; $('cOrders').textContent = S.orders.filter((o) => o.active).length; { const n = S.orders.filter((o) => o.active).length, bo = $('bOrders'); if (bo) { bo.hidden = !n; bo.textContent = n; } } $('cJournal').textContent = S.journal.length;
    try { window.dispatchEvent(new CustomEvent('pstudio-state')); } catch (e) {}
  }
  // Bascule simulation / réel : le passage en réel demande toujours une confirmation explicite
  // Le mode réel demande un compte connecté (le menu de compte transmet l'état de connexion)
  let AUTH = null;
  function setAuth(on) {
    AUTH = !!on;
    if (!AUTH && !cfg.sim) { cfg.sim = true; save(LS.cfg, cfg); toast('Mode démo', 'Connectez-vous à votre compte pour passer en réel.', 'a'); }
    renderAll();
  }
  async function goReal() {
    if (!cfg.sim) return;
    if (!AUTH) { try { window.dispatchEvent(new CustomEvent('ts-need-account', { detail: 'real' })); } catch (e) {} if (AUTH === false) toast('Compte requis', 'Créez votre compte ou connectez-vous pour passer en réel. La démo reste ouverte à tous.', 'a'); return; }
    if (await confirmBox('Passer en mode réel ?', '<p>Les transactions que vous signez partiront réellement sur la blockchain et engageront votre SOL. Un lancement ou un trade confirmé ne s\'annule pas.</p><p>Vérifiez d\'abord vos réglages : limite par achat ' + fSolH(cfg.maxSol, 2) + ', slippage ' + cfg.slippage + ' %.</p>', 'Passer en réel', true)) { cfg.sim = false; save(LS.cfg, cfg); toast('Mode réel activé', 'Chaque transaction demandera votre signature.', 'a'); renderAll(); }
  }
  function goSim() { if (cfg.sim) return; cfg.sim = true; save(LS.cfg, cfg); toast('Mode démo', 'Plus rien n\'est envoyé.', 'g'); renderAll(); }
  function openSettings() {
    const sec = $('p-settings'); if (!sec) return;
    let body = $('setBody');
    if (!body) { body = document.createElement('div'); body.id = 'setBody'; [...sec.children].filter((c) => !c.classList.contains('page-head')).forEach((c) => body.appendChild(c)); sec.appendChild(body); }
    navOpen(false);
    openPanel('Réglages', body, { intro: '<p class="muted" style="margin:0 0 14px">Chaque bloc a ses boutons Valider et Annuler : rien n\'est appliqué avant validation.</p>' });
  }
  function setPage(p) {
    if (p === 'settings') return openSettings();
    S.page = p;
    document.querySelectorAll('#menu button[data-page], #bnav button[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === p));
    navOpen(false);
    document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === 'p-' + p));
    $('pageTitle').textContent = PAGES[p][0]; $('pageSub').textContent = PAGES[p][1];
    try { window.dispatchEvent(new CustomEvent('pstudio-page', { detail: p })); } catch (e) {}
    $('pageEyebrow').textContent = { account: 'Compte', dash: 'Vue d\'ensemble', wallet: 'Vue d\'ensemble', launch: 'Créer', social: 'Créer', dist: 'Créer', mine: 'Suivre', trade: 'Suivre', orders: 'Suivre', journal: 'Suivre', settings: 'Outil' }[p] || '';
    try { localStorage.setItem('pstudio_page', p); } catch (e) {}
    renderPage(); window.scrollTo(0, 0); ppSync(liveSet());
    if (p === 'launch') setLaunchTab(S.ltab);
  }

  /* ================================================================ tableau de bord */
  const DASH = { mode: null, range: '1d', hist: {}, histAt: {}, src: 'Binance', tokAt: 0 };
  try { const m = localStorage.getItem('pstudio_dash_mode'); if (['real', 'sim', 'all'].includes(m)) DASH.mode = m; } catch (e) {}
  const RANGES = { '1d': { bi: '15m', n: 96, cb: 900, ms: 864e5 }, '7d': { bi: '1h', n: 168, cb: 3600, ms: 6048e5 }, '30d': { bi: '4h', n: 180, cb: 21600, ms: 2592e6 } };
  async function solHist(force) {
    const k = DASH.range, R = RANGES[k];
    if (!force && DASH.hist[k] && Date.now() - DASH.histAt[k] < 60000) return;
    DASH.histAt[k] = Date.now();
    let pts = null;
    try { const r = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=' + R.bi + '&limit=' + R.n); const j = await r.json(); if (Array.isArray(j) && j.length > 1) { pts = j.map((x) => ({ t: +x[0], v: +x[4], hi: +x[2], lo: +x[3] })); DASH.src = 'Binance'; } } catch (e) {}
    if (!pts) try { const r = await fetch('https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=' + R.cb); const j = await r.json(); if (Array.isArray(j) && j.length > 1) { const from = Date.now() - R.ms; pts = j.map((x) => ({ t: x[0] * 1000, v: +x[4], hi: +x[2], lo: +x[1] })).filter((x) => x.t >= from).sort((a, b) => a.t - b.t); DASH.src = 'Coinbase'; } } catch (e) {}
    if (pts && pts.length > 1) { DASH.hist[k] = pts; if (S.page === 'dash') renderDash(); }
  }
  // couleurs lues sur le thème en cours : les graphiques suivent la palette choisie
  function dcol() {
    const cs = getComputedStyle(document.documentElement), v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    return { accent: v('--accent', '#d6b26e'), green: v('--green', '#3ccf8e'), red: v('--red', '#ff6b6b'), amber: v('--amber', '#f2894b'), blue: v('--blue', '#6aa8ff'), text: v('--text', '#f3efe6'), muted: v('--muted', '#b9b1a2'), dim: v('--dim', '#8b8375'), line: v('--line', '#2a2722'), panel: v('--panel', '#141311'), panel3: v('--panel3', '#211f1b') };
  }
  function rgba(c, a) {
    let h = String(c).trim(); if (h[0] !== '#') return c;
    h = h.slice(1); if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  const fDay = (t) => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const fHm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // courbe avec aire dégradée, grille discrète et lecture au survol
  function lineChart(cv, pts, o) {
    cv._lc = { pts, o }; if (!cv._bound) { cv._bound = 1; const mv = (e) => { const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; cv._hx = x; lineDraw(cv); }; cv.addEventListener('mousemove', mv); cv.addEventListener('touchmove', mv, { passive: true }); cv.addEventListener('mouseleave', () => { cv._hx = null; lineDraw(cv); }); }
    lineDraw(cv);
  }
  function lineDraw(cv) {
    const { pts, o } = cv._lc, K = dcol(), { g, w, h } = setupCanvas(cv);
    g.font = '11.5px "Geist Mono",monospace';
    if (!pts || pts.length < 2) { g.fillStyle = K.dim; g.textAlign = 'center'; g.font = '13px Geist,system-ui,sans-serif'; g.fillText(o.empty || 'Pas encore de données', w / 2, h / 2); return; }
    const pl = 4, pr = o.yw || 64, pt = 14, pb = 22;
    let y0 = Infinity, y1 = -Infinity; pts.forEach((p) => { y0 = Math.min(y0, p.v); y1 = Math.max(y1, p.v); });
    if (o.zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (y1 - y0 < 1e-9) { y1 += Math.abs(y1) * 0.05 || 1; y0 -= Math.abs(y0) * 0.05 || 1; }
    const pad = (y1 - y0) * 0.12; y0 -= pad; y1 += pad;
    const n = pts.length, X = (i) => pl + i / (n - 1) * (w - pl - pr), Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (h - pt - pb);
    for (let i = 0; i <= 3; i++) { const v = y0 + (y1 - y0) * i / 3, y = Math.round(Y(v)) + 0.5; g.strokeStyle = rgba(K.line, 0.9); g.lineWidth = 1; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(pl, y); g.lineTo(w - pr, y); g.stroke(); g.setLineDash([]); g.fillStyle = K.dim; g.textAlign = 'left'; g.fillText(o.fy(v), w - pr + 8, y + 4); }
    if (o.zero && y0 < 0 && y1 > 0) { const y = Math.round(Y(0)) + 0.5; g.strokeStyle = rgba(K.muted, 0.35); g.beginPath(); g.moveTo(pl, y); g.lineTo(w - pr, y); g.stroke(); }
    const col = o.col || (pts[n - 1].v >= (o.zero ? 0 : pts[0].v) ? K.green : K.red);
    const base = o.zero ? Y(Math.max(y0, Math.min(0, y1))) : h - pb;
    const grd = g.createLinearGradient(0, pt, 0, h - pb); grd.addColorStop(0, rgba(col, 0.26)); grd.addColorStop(1, rgba(col, 0));
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.v)) : g.moveTo(X(i), Y(p.v)))); g.lineTo(X(n - 1), base); g.lineTo(X(0), base); g.closePath(); g.fillStyle = grd; g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.v)) : g.moveTo(X(i), Y(p.v)))); g.stroke();
    const lx = X(n - 1), ly = Y(pts[n - 1].v); g.fillStyle = rgba(col, 0.22); g.beginPath(); g.arc(lx, ly, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(lx, ly, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = K.dim; g.textAlign = 'left'; g.fillText(o.fx(pts[0]), pl, h - 5); g.textAlign = 'right'; g.fillText(o.fx(pts[n - 1]), w - pr, h - 5);
    if (cv._hx != null && cv._hx >= pl && cv._hx <= w - pr) {
      const i = Math.max(0, Math.min(n - 1, Math.round((cv._hx - pl) / (w - pl - pr) * (n - 1)))), x = X(i), y = Y(pts[i].v);
      g.strokeStyle = rgba(K.muted, 0.45); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, h - pb); g.stroke(); g.setLineDash([]);
      g.fillStyle = K.panel; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      const t1 = o.fy(pts[i].v, true), t2 = o.ft ? o.ft(pts[i]) : o.fx(pts[i]); g.font = '600 12px "Geist Mono",monospace'; const tw = Math.max(g.measureText(t1).width, g.measureText(t2).width) + 18;
      let bx = x + 10; if (bx + tw > w - pr) bx = x - 10 - tw; const by = Math.max(pt, Math.min(y - 22, h - pb - 44));
      g.fillStyle = rgba(K.panel3, 0.96); g.strokeStyle = K.line; g.lineWidth = 1; g.beginPath(); g.roundRect ? g.roundRect(bx, by, tw, 40, 8) : g.rect(bx, by, tw, 40); g.fill(); g.stroke();
      g.textAlign = 'left'; g.fillStyle = K.text; g.fillText(t1, bx + 9, by + 17); g.font = '11px "Geist Mono",monospace'; g.fillStyle = K.dim; g.fillText(t2, bx + 9, by + 32);
    }
  }
  function sparkline(cv, vals, col) {
    const { g, w, h } = setupCanvas(cv); if (!vals || vals.length < 2) { const K = dcol(); g.strokeStyle = rgba(K.dim, 0.4); g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); return; }
    let a = Math.min(...vals), b = Math.max(...vals); if (b - a < 1e-12) { a -= 1; b += 1; }
    const X = (i) => 1 + i / (vals.length - 1) * (w - 2), Y = (v) => 3 + (1 - (v - a) / (b - a)) * (h - 6);
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, rgba(col, 0.22)); grd.addColorStop(1, rgba(col, 0));
    g.beginPath(); vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.lineTo(X(vals.length - 1), h); g.lineTo(X(0), h); g.closePath(); g.fillStyle = grd; g.fill();
    g.strokeStyle = col; g.lineWidth = 1.6; g.lineJoin = 'round'; g.beginPath(); vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
  }
  function donut(cv, parts, center) {
    const K = dcol(), dpr = window.devicePixelRatio || 1, sz = 168; cv.width = sz * dpr; cv.height = sz * dpr; cv.style.width = sz + 'px'; cv.style.height = sz + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, sz, sz);
    const tot = parts.reduce((a, p) => a + p.n, 0), c = sz / 2, r = 72, lw = 15;
    g.lineWidth = lw; g.strokeStyle = rgba(K.line, 1); g.beginPath(); g.arc(c, c, r - lw / 2, 0, Math.PI * 2); g.stroke();
    if (tot) { let a = -Math.PI / 2; const gap = parts.filter((p) => p.n).length > 1 ? 0.05 : 0; parts.forEach((p) => { if (!p.n) return; const da = p.n / tot * Math.PI * 2; g.strokeStyle = p.c; g.lineCap = 'round'; g.beginPath(); g.arc(c, c, r - lw / 2, a + gap, a + da - gap); g.stroke(); a += da; }); }
    g.textAlign = 'center'; g.fillStyle = K.text; g.font = '600 26px "Geist Mono",monospace'; g.fillText(center[0], c, c + 6); g.fillStyle = K.dim; g.font = '12px Geist,system-ui,sans-serif'; g.fillText(center[1], c, c + 25);
  }
  function bars(cv, days, keys) {
    const K = dcol(), { g, w, h } = setupCanvas(cv), pl = 2, pr = 28, pt = 10, pb = 22;
    const max = Math.max(1, ...days.map((d) => keys.reduce((a, k) => a + d[k.k], 0))), top = Math.max(2, Math.ceil(max * 1.15));
    const Y = (v) => pt + (1 - v / top) * (h - pt - pb), bw = (w - pl - pr) / days.length;
    g.font = '11px "Geist Mono",monospace';
    [0, Math.round(top / 2), top].forEach((v) => { const y = Math.round(Y(v)) + 0.5; g.strokeStyle = rgba(K.line, 0.9); g.setLineDash([2, 4]); g.beginPath(); g.moveTo(pl, y); g.lineTo(w - pr, y); g.stroke(); g.setLineDash([]); g.fillStyle = K.dim; g.textAlign = 'left'; g.fillText(String(v), w - pr + 7, y + 4); });
    days.forEach((d, i) => {
      let acc = 0; const x = pl + i * bw + bw * 0.2, ww = Math.max(3, bw * 0.6);
      keys.forEach((k) => { const v = d[k.k]; if (!v) return; const y1 = Y(acc), y2 = Y(acc + v); g.fillStyle = k.c; g.beginPath(); g.roundRect ? g.roundRect(x, y2, ww, y1 - y2 - 1, 3) : g.rect(x, y2, ww, y1 - y2 - 1); g.fill(); acc += v; });
      if (!acc) { g.fillStyle = rgba(K.dim, 0.25); g.fillRect(x, Y(0) - 2, ww, 2); }
      if (i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2)) { g.fillStyle = K.dim; g.textAlign = 'center'; g.fillText(fDay(d.t), x + ww / 2, h - 5); }
    });
  }
  const DTYPE = { buy: 'Achat', sell: 'Vente', create: 'Lancement', fees: 'Frais créateur', deposit: 'Dépôt', withdraw: 'Retrait' };
  function dashOps() {
    // opérations du mode en cours seulement (démo ou réel), comme le journal
    const m = cfg.sim ? 'sim' : 'real';
    return { m, L: S.journal.filter((j) => (m === 'sim' ? !!j.sim : !j.sim)) };
  }
  function dashTokens() {
    if (Date.now() - DASH.tokAt < 60000) return; DASH.tokAt = Date.now();
    S.tokens.slice(0, 8).forEach((t) => { if (!S.cache[t.mint] || Date.now() - S.cache[t.mint].at > 60000) loadToken(t.mint, false).then(() => { if (S.page === 'dash') renderDash(); }).catch(() => {}); });
  }
  function renderDash() {
    if (!$('p-dash')) return;
    const K = dcol(), now = new Date(), hr = now.getHours();
    $('dHello').textContent = hr < 5 || hr >= 18 ? 'Bonsoir' : 'Bonjour';
    $('dDate').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const { m, L } = dashOps();
    { const dm = $('dMode'); if (dm) dm.hidden = true; }
    renderKeysCard();
    document.querySelectorAll('#dMode [data-dmode]').forEach((b) => { b.classList.toggle('on', b.dataset.dmode === m); b.setAttribute('aria-pressed', b.dataset.dmode === m); });
    document.querySelectorAll('#dRange [data-drange]').forEach((b) => b.classList.toggle('on', b.dataset.drange === DASH.range));
    const ppl = ppLabel(); $('dLive').innerHTML = '<span class="dot ' + ppl[0] + '"></span>Flux direct · ' + esc(ppl[1]) + (cfg.sim ? '' : '<i></i><span class="dot ' + (S.rpcOk ? 'on' : S.rpcOk === false ? 'bad' : 'wait') + '"></span>RPC ' + (S.rpcOk ? rpcKind() : S.rpcOk === false ? 'en erreur' : 'non testé'));
    // portefeuille
    const w = S.wallet;
    $('dModeBadge').className = 'badge v'; $('dModeBadge').textContent = 'Démo'; $('dModeBadge').hidden = !cfg.sim;
    const demoW = cfg.sim && (!w || !AUTH);   // démo sans wallet ou sans compte : solde du wallet démo
    $('dBal').innerHTML = demoW ? '<span class="sol stack" data-sol="' + DEMO.bal + '">' + fr(DEMO.bal, 2) + '<small> SOL démo</small></span>' : w && S.bal != null ? '<span class="sol stack" data-sol="' + S.bal + '">' + fr(S.bal, S.bal >= 100 ? 2 : 4) + '<small> SOL</small></span>' : '—';
    $('dBalS').textContent = demoW ? 'Wallet démo · fonds fictifs' : w ? (w.id === 'session' ? 'Wallet rapide' : w.name) + ' · ' + short(w.pk) : 'Connectez un wallet pour voir votre solde';
    const ok = L.filter((j) => j.status === 'ok'), spent = Math.abs(ok.filter((j) => j.sol < 0).reduce((a, j) => a + j.sol, 0)), recv = ok.filter((j) => j.sol > 0).reduce((a, j) => a + j.sol, 0), net = recv - spent;
    const hs = (l, x, c, sg) => '<div><span>' + l + '</span><b class="sol ' + (c || '') + '" data-sol="' + x + '">' + (sg && x > 0 ? '+' : '') + fSol(x, 3) + '</b></div>';
    $('dHero').innerHTML = hs('Dépensé', spent) + hs('Reçu', recv) + hs('Flux net', net, cls(net), true);
    // prix du SOL
    const H = DASH.hist[DASH.range], last = S.solUsd || (H && H[H.length - 1].v);
    $('dSol').textContent = last ? fr(last, 2) + ' $' : '—'; $('dSolSrc').textContent = DASH.src;
    if (H && H.length > 1) {
      const chg = (last / H[0].v - 1) * 100, hi = Math.max(...H.map((p) => p.hi || p.v)), lo = Math.min(...H.map((p) => p.lo || p.v));
      $('dSolChg').className = 'd-chg ' + cls(chg); $('dSolChg').textContent = (chg > 0 ? '▲ +' : chg < 0 ? '▼ ' : '') + fr(chg, 2) + ' %';
      const pts = H.slice(); if (S.solUsd) pts[pts.length - 1] = Object.assign({}, pts[pts.length - 1], { v: S.solUsd });
      lineChart($('dSolCv'), pts, { fy: (v, hv) => fr(v, hv ? 2 : (v >= 100 ? 0 : 1)) + ' $', fx: (p) => DASH.range === '1d' ? fHm(p.t) : fDay(p.t), ft: (p) => fDay(p.t) + ' · ' + fHm(p.t) });
      $('dSolFoot').innerHTML = '<span>Plus haut <b>' + fr(hi, 2) + ' $</b></span><span>Plus bas <b>' + fr(lo, 2) + ' $</b></span><span>Amplitude <b>' + fr((hi / lo - 1) * 100, 1) + ' %</b></span>' + (S.bal != null && w ? '<span>Votre solde <b>' + fUsd(S.bal * last) + '</b></span>' : '');
    } else { $('dSolChg').textContent = ''; lineChart($('dSolCv'), null, { empty: 'Chargement de l\'historique du SOL…', fy: (v) => v, fx: () => '' }); $('dSolFoot').innerHTML = ''; }
    // tuiles
    const act = S.orders.filter((o) => o.active), kinds = { tp: 0, sl: 0, trail: 0 }; act.forEach((o) => { kinds[o.kind === 'trail' ? 'trail' : o.kind === 'sl' ? 'sl' : 'tp']++; });
    const weeks = []; for (let i = 7; i >= 0; i--) { const a = Date.now() - (i + 1) * 6048e5, b = Date.now() - i * 6048e5; weeks.push(S.tokens.filter((t) => t.createdAt >= a && t.createdAt < b).length); }
    const okAsc = ok.slice().sort((a, b) => a.t - b.t); let cum = 0; const flowVals = [0].concat(okAsc.map((j) => (cum += j.sol || 0)));
    const tile = (id, ic, l, v, sub, c) => '<div class="d-tile"><div class="d-tl"><span class="d-ic">' + ic + '</span>' + l + '</div><div class="d-tv ' + (c || '') + '">' + v + '</div><div class="d-ts">' + sub + '</div><canvas id="' + id + '" height="38"></canvas></div>';
    $('dTiles').innerHTML =
      tile('dSpTok', IC.spark, 'Tokens lancés', String(S.tokens.length), S.tokens.filter((t) => Date.now() - t.createdAt < 6048e5).length + ' cette semaine') +
      tile('dSpOrd', IC.shield, 'Ordres actifs', String(act.length), act.length ? kinds.tp + ' objectifs · ' + kinds.sl + ' stops' + (kinds.trail ? ' · ' + kinds.trail + ' suiveurs' : '') : 'aucun ordre surveillé') +
      tile('dSpFlow', IC.pulse, 'Flux net', ok.length ? '<span class="sol" data-sol="' + net + '">' + (net > 0 ? '+' : '') + fr(net, 3) + '<small> SOL</small></span>' : '—', ok.length + ' opération' + (ok.length > 1 ? 's' : '') + (m === 'all' ? '' : (m === 'real' ? ' réelle' : ' simulée') + (ok.length > 1 ? 's' : '')), cls(net));
    sparkline($('dSpTok'), weeks, K.accent);
    { const el = $('dSpOrd'), parts = [[kinds.tp, K.green], [kinds.sl, K.red], [kinds.trail, K.blue]]; const bar = document.createElement('div'); bar.className = 'd-split'; bar.innerHTML = act.length ? parts.filter((x) => x[0]).map((x) => '<i style="flex:' + x[0] + ';background:' + x[1] + '"></i>').join('') : '<i style="flex:1;background:var(--panel3)"></i>'; el.replaceWith(bar); }
    sparkline($('dSpFlow'), flowVals.length > 1 ? flowVals : null, net >= 0 ? K.green : K.red);
    // flux net cumulé
    let c2 = 0; const fpts = okAsc.length ? [{ t: okAsc[0].t - 1, v: 0 }].concat(okAsc.map((j) => ({ t: j.t, v: (c2 += j.sol || 0), j }))) : null;
    $('dFlowNote').textContent = 'SOL reçu moins SOL dépensé · opérations ' + (m === 'real' ? 'réelles' : m === 'sim' ? 'simulées' : 'réelles et simulées');
    lineChart($('dFlowCv'), fpts, { zero: true, yw: 76, empty: 'La courbe apparaîtra après votre première opération.', fy: (v, hv) => (v > 0 ? '+' : '') + fr(v, hv ? 4 : Math.abs(v) >= 10 ? 1 : 3), fx: (p) => fDay(p.t), ft: (p) => (p.j ? (DTYPE[p.j.type] || p.j.type) + ' ' + (p.j.symbol || '') + ' · ' : '') + fDay(p.t) + ' ' + fHm(p.t) });
    // répartition
    const mix = [{ k: 'buy', l: 'Achats', c: K.green }, { k: 'sell', l: 'Ventes', c: K.red }, { k: 'create', l: 'Lancements', c: K.accent }, { k: 'err', l: 'Échecs', c: K.dim }].map((x) => Object.assign(x, { n: L.filter((j) => x.k === 'err' ? j.status === 'err' : j.status === 'ok' && j.type === x.k).length }));
    donut($('dMixCv'), mix, [String(L.length), 'opérations']);
    $('dMixLeg').innerHTML = mix.map((x) => '<div><i style="background:' + x.c + '"></i>' + x.l + '<b>' + x.n + '</b><em>' + (L.length ? Math.round(x.n / L.length * 100) : 0) + ' %</em></div>').join('');
    // activité 14 jours
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const days = [];
    for (let i = 13; i >= 0; i--) { const t = d0.getTime() - i * 864e5, e = t + 864e5, J = L.filter((j) => j.t >= t && j.t < e); days.push({ t, buy: J.filter((j) => j.type === 'buy').length, sell: J.filter((j) => j.type === 'sell').length, create: J.filter((j) => j.type === 'create').length }); }
    const bk = [{ k: 'buy', l: 'Achats', c: K.green }, { k: 'sell', l: 'Ventes', c: K.red }, { k: 'create', l: 'Lancements', c: K.accent }];
    bars($('dActCv'), days, bk);
    $('dActLeg').innerHTML = bk.map((x) => '<div><i style="background:' + x.c + '"></i>' + x.l + '<b>' + days.reduce((a, d) => a + d[x.k], 0) + '</b></div>').join('');
    // ordres actifs
    $('dOrders').innerHTML = act.length ? act.slice(0, 6).map((o) => {
      const C = S.cache[o.mint], cur = C && C.stats ? C.stats.price : null, r = cur && o.ref ? (cur / o.ref - 1) * 100 : null;
      const lab = o.kind === 'trail' ? 'Stop suiveur −' + o.value + ' %' : o.kind === 'sl' ? 'Stop −' + o.value + ' %' : o.kind === 'tp' ? (o.plan ? 'Objectif ×' + fr(1 + o.value / 100, 1).replace(',0', '') : 'Objectif +' + o.value + ' %') : 'Objectif ' + o.value;
      let prog = null; if (r != null) { if (o.kind === 'tp') prog = Math.max(0, Math.min(1, r / o.value)); else if (o.kind === 'sl') prog = Math.max(0, Math.min(1, -r / o.value)); }
      return '<div class="d-row"><span class="d-tag ' + (o.kind === 'tp' ? 'g' : o.kind === 'sl' ? 'r' : 'b') + '">' + (o.kind === 'tp' ? 'TP' : o.kind === 'sl' ? 'SL' : 'TS') + '</span><span class="d-main"><b>' + esc(o.symbol || short(o.mint)) + '</b><small>' + lab + ' · ' + (o.pct || 100) + ' % des tokens</small>' + (prog != null ? '<span class="d-prog ' + (o.kind === 'sl' ? 'r' : '') + '"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></span>' : '') + '</span><span class="d-val ' + cls(r) + '">' + (r != null ? (r > 0 ? '+' : '') + fr(r, 1) + ' %' : '<span class="dim">prix…</span>') + '</span></div>';
    }).join('') + (act.length > 6 ? '<div class="d-more">+ ' + (act.length - 6) + ' autres ordres</div>' : '') : '<div class="d-empty"><b>Aucun ordre actif</b>Ajoutez un objectif ou un stop depuis un token.</div>';
    // dernières opérations
    const last6 = L.slice(0, 6);
    $('dOps').innerHTML = last6.length ? last6.map((j) => '<div class="d-row"><span class="d-tag ' + (j.status === 'err' ? '' : j.type === 'buy' || j.type === 'fees' ? 'g' : j.type === 'sell' ? 'r' : 'v') + '">' + (j.status === 'err' ? '!' : j.type === 'buy' ? 'A' : j.type === 'sell' ? 'V' : j.type === 'fees' ? 'F' : 'L') + '</span><span class="d-main"><b>' + (DTYPE[j.type] || esc(j.type)) + (j.type === 'fees' ? '' : ' · ' + esc(j.symbol || short(j.mint))) + '</b><small>' + fDay(j.t) + ' ' + fHm(j.t) + (j.sim ? ' · simulation' : '') + (j.auto ? ' · auto' : '') + (j.status === 'err' ? ' · échec' : '') + '</small></span><span class="d-val ' + cls(j.sol) + '">' + (j.status === 'err' ? '<span class="dim">—</span>' : '<span class="sol" data-sol="' + (j.sol || 0) + '">' + (j.sol > 0 ? '+' : '') + fr(j.sol || 0, 3) + ' SOL</span>') + '</span></div>').join('') : '<div class="d-empty"><b>Aucune opération</b>Vos achats, ventes et lancements apparaîtront ici.</div>';
    // tokens lancés
    $('dToks').innerHTML = S.tokens.length ? S.tokens.slice(0, 8).map((t) => { const C = S.cache[t.mint], st = C && C.stats; return '<button class="d-tok" type="button" data-dtok="' + esc(t.mint) + '"><span class="d-timg">' + (t.image ? '<img src="' + esc(t.image) + '" alt="" loading="lazy">' : esc((t.symbol || '?').slice(0, 2))) + '</span><span class="d-main"><b>' + esc(t.symbol || '?') + '</b><small>' + esc(t.name || '') + '</small></span><span class="d-tm"><b>' + (st ? (S.solUsd ? fUsd(st.mcapSol * S.solUsd) : fSol(st.mcapSol, 1)) : '…') + '</b><small>' + (st ? (C.curve && C.curve.ext ? (PLATFORMS[t.platform] || PLATFORMS.pump).n + (C.curve.dex === 'launchlab' ? ' · ≈ ' + fr(st.progress, 0) + ' %' : ' · ' + dexName(C.curve)) : C.curve && C.curve.complete ? 'migré' : 'courbe ' + fr(st.progress, 0) + ' %') : fDay(t.createdAt)) + '</small></span>' + (st ? '<span class="d-prog"><i style="width:' + Math.min(100, st.progress).toFixed(1) + '%"></i></span>' : '') + '</button>'; }).join('') : '<div class="d-empty"><b>Aucun token lancé</b>Créez votre premier token dans le studio. <button class="btn sm primary" data-page="launch" type="button">Lancer un token</button></div>';
    solHist(false);
  }
  /* ================================================================ diffusion : référencement sur les grandes plateformes */
  // Aucune de ces plateformes n'accepte d'envoi automatique (compte + formulaire du projet). Le studio détecte
  // où le token est déjà visible (API publiques gratuites), prépare le dossier et ouvre les formulaires choisis.
  const DIST = [
    { id: 'dexscreener', n: 'DEX Screener', k: 'Agrégateur DEX', cost: 'auto', costL: 'Automatique', note: 'Indexé seul dès le premier échange. Fiche enrichie (logo, liens, bannière) : service payant optionnel.', page: (m, X) => 'https://dexscreener.com/solana/' + (X.pair || m), form: 'https://marketplace.dexscreener.com/product/token-info', formL: 'Fiche enrichie (payant)' },
    { id: 'geckoterminal', n: 'GeckoTerminal', k: 'Agrégateur DEX', cost: 'auto', costL: 'Automatique', note: 'Indexé seul avec le pool. Logo et liens : demande de mise à jour via le support CoinGecko.', page: (m, X) => X.pair ? 'https://www.geckoterminal.com/solana/pools/' + X.pair : '', form: 'https://support.coingecko.com/hc/en-us/sections/22611282215833-Token-Information-Update', formL: 'Mettre à jour les infos' },
    { id: 'birdeye', n: 'Birdeye', k: 'Agrégateur DEX', cost: 'auto', costL: 'Automatique', note: 'Indexé seul. Le formulaire officiel est le seul moyen de modifier les infos affichées (il ne donne pas la coche verte).', page: (m) => 'https://birdeye.so/token/' + m + '?chain=solana', form: 'https://docs.birdeye.so/docs/token-info-update-service', formL: 'Formulaire d\'infos' },
    { id: 'jupiter', n: 'Jupiter', k: 'Vérification', cost: 'free', costL: 'Gratuit', note: 'Liste vérifiée VRFD : coche verte dans Jupiter, Phantom et l\'explorateur Solana. Examinée sur la liquidité, les métadonnées et la communauté.', page: (m) => 'https://jup.ag/tokens/' + m, form: 'https://verified.jup.ag/tokens', formL: 'Demander la vérification' },
    { id: 'coingecko', n: 'CoinGecko', k: 'Listing', cost: 'free', costL: 'Gratuit', note: 'Le token doit s\'échanger sur une plateforme suivie par CoinGecko. Connexion à un compte, puis « New Coin/Token Listing ». Plus de chances après la migration, avec un volume régulier.', page: (m, X) => X.cgId ? 'https://www.coingecko.com/en/coins/' + X.cgId : '', form: 'https://www.coingecko.com/request-form', formL: 'Formulaire de listing' },
    { id: 'coinmarketcap', n: 'CoinMarketCap', k: 'Listing', cost: 'free', costL: 'Gratuit · délai variable', note: 'Formulaire unique accepté. Un dossier complet et prouvé est traité en priorité ; le délai gratuit va de quelques jours à plusieurs mois.', page: () => '', form: 'https://support.coinmarketcap.com/hc/en-us/requests/new', formL: 'Formulaire de listing' },
    { id: 'solscan', n: 'Solscan', k: 'Explorateur', cost: 'free', costL: 'Gratuit', note: 'Page créée automatiquement. Le formulaire sert à mettre à jour les infos affichées ou la réputation du token.', page: (m) => 'https://solscan.io/token/' + m, form: 'https://kb.solscan.io/solscan-token-update-guideline', formL: 'Mise à jour des infos' },
    { id: 'rugcheck', n: 'RugCheck', k: 'Confiance', cost: 'auto', costL: 'Automatique', note: 'Rapport de risque automatique, utilisé par l\'explorateur Solana et de nombreux traders avant d\'acheter.', page: (m) => 'https://rugcheck.xyz/tokens/' + m, form: '', formL: '' },
  ];
  const LSD = 'pstudio_dist_v1';
  const DS = { mint: '', sel: null, cache: {}, rec: cfg.sim ? load(dk(LSD), {}) : REAL.dist };
  try { DS.sel = new Set(JSON.parse(localStorage.getItem('pstudio_dist_sel') || 'null') || ['jupiter', 'coingecko', 'coinmarketcap', 'solscan']); } catch (e) { DS.sel = new Set(['jupiter', 'coingecko', 'coinmarketcap', 'solscan']); }
  const saveSel = () => { try { localStorage.setItem('pstudio_dist_sel', JSON.stringify([...DS.sel])); } catch (e) {} };
  const tfetch = (u, ms) => Promise.race([fetch(u), new Promise((_, r) => setTimeout(() => r(new Error('délai')), ms || 8000))]);
  // démo : la diffusion progresse avec l'âge et l'activité du token simulé (aucun site n'est interrogé)
  function demoDist(mint) {
    dmRun(); const T = DM.tok[mint];
    const X = DS.cache[mint] = { at: Date.now(), st: {}, loading: false };
    const set = (id, s2, t) => { X.st[id] = { s: s2, t }; };
    if (!T) { if (S.page === 'dist' && DS.mint === mint) renderDist(); return X; }
    const age = (Date.now() - T.createdAt) / 60000, n = T.trades.length, vol = T.trades.filter((x) => Date.now() - x.t < 864e5).reduce((a, x) => a + x.sol, 0);
    if (n) { X.pair = 'DEMO0pair'; X.dex = T.complete ? 'pumpswap' : 'pumpfun'; X.vol = S.solUsd ? vol * S.solUsd : null; X.liq = S.solUsd ? T.realSol / 1e9 * 2 * S.solUsd : null; }
    set('dexscreener', n ? 'on' : 'off', n ? '1 paire · indexé automatiquement' : 'pas encore indexé (aucun échange)');
    set('geckoterminal', age > 3 && n ? 'on' : 'off', age > 3 && n ? 'indexé · logo à ajouter' : 'pas encore indexé');
    set('jupiter', T.complete ? 'on' : n && age > 2 ? 'mid' : 'off', T.complete ? 'vérifié ✓' : n && age > 2 ? 'échangeable, non vérifié' : 'pas encore dans Jupiter');
    set('coingecko', 'off', 'non listé (demande à déposer)');
    set('rugcheck', age > 1 ? 'on' : 'unk', age > 1 ? 'rapport disponible · score ' + Math.max(1, Math.round(60 - Math.min(50, n / 4))) : 'rapport pas encore disponible');
    set('birdeye', n ? 'mid' : 'off', n ? 'indexé automatiquement avec la paire' : 'apparaît avec le premier échange');
    set('solscan', 'on', 'page du token disponible');
    set('coinmarketcap', 'man', 'statut à vérifier sur le site');
    if (S.page === 'dist' && DS.mint === mint) renderDist();
    return X;
  }
  async function distCheck(mint, force) {
    if (isDemoMint(mint)) return demoDist(mint);
    const X0 = DS.cache[mint]; if (X0 && !force && Date.now() - X0.at < 120000) return X0;
    const X = DS.cache[mint] = { at: Date.now(), st: {}, loading: true }; if (S.page === 'dist') renderDist();
    const set = (id, s, t) => { X.st[id] = { s, t }; };
    await Promise.all([
      tfetch('https://api.dexscreener.com/tokens/v1/solana/' + mint).then((r) => r.json()).then((j) => {
        const ps = (Array.isArray(j) ? j : []).filter((p) => p.baseToken && p.baseToken.address === mint).sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
        if (ps.length) { const p = ps[0]; X.pair = p.pairAddress; X.dex = p.dexId; X.vol = (p.volume || {}).h24; X.liq = (p.liquidity || {}).usd; X.enh = !!(p.info && (p.info.imageUrl || (p.info.socials || []).length)); set('dexscreener', 'on', ps.length + ' paire' + (ps.length > 1 ? 's' : '') + ' · ' + (DEX_NAMES[p.dexId] || p.dexId) + (X.enh ? ' · fiche enrichie' : '')); }
        else set('dexscreener', 'off', 'pas encore indexé (aucun échange)');
      }).catch(() => set('dexscreener', 'unk', 'vérification impossible')),
      tfetch('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + mint).then((r) => { if (r.status === 404) return null; if (!r.ok) throw new Error(); return r.json(); }).then((j) => {
        if (!j || !j.data) return set('geckoterminal', 'off', 'pas encore indexé');
        const a = j.data.attributes || {}; set('geckoterminal', 'on', 'indexé' + (a.image_url && !/missing/.test(a.image_url) ? ' · logo affiché' : ' · logo à ajouter'));
      }).catch(() => set('geckoterminal', 'unk', 'vérification impossible')),
      tfetch('https://lite-api.jup.ag/tokens/v2/search?query=' + mint).then((r) => r.json()).then((j) => {
        const t = (Array.isArray(j) ? j : []).find((x) => x.id === mint || x.address === mint);
        if (!t) return set('jupiter', 'off', 'pas encore dans Jupiter');
        const v = t.isVerified || (t.tags || []).includes('verified');
        set('jupiter', v ? 'on' : 'mid', v ? 'vérifié ✓' : 'échangeable, non vérifié');
      }).catch(() => set('jupiter', 'unk', 'vérification impossible')),
      tfetch('https://api.coingecko.com/api/v3/coins/solana/contract/' + mint).then((r) => { if (r.status === 404) return set('coingecko', 'off', 'non listé'); if (!r.ok) throw new Error(); return r.json().then((j) => { X.cgId = j.id; set('coingecko', 'on', 'listé'); }); }).catch(() => set('coingecko', 'unk', 'à vérifier sur le site')),
      tfetch('https://api.rugcheck.xyz/v1/tokens/' + mint + '/report/summary').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((j) => {
        const lv = (j.risks || []).filter((x) => x.level === 'danger').length; set('rugcheck', lv ? 'mid' : 'on', 'rapport disponible' + (j.score_normalised != null ? ' · score ' + j.score_normalised : '') + (lv ? ' · ' + lv + ' alerte' + (lv > 1 ? 's' : '') : ''));
      }).catch(() => set('rugcheck', 'unk', 'rapport pas encore disponible')),
    ]);
    set('birdeye', X.pair ? 'mid' : 'off', X.pair ? 'indexé automatiquement avec la paire' : 'apparaît avec le premier échange');
    set('solscan', 'on', 'page du token disponible');
    set('coinmarketcap', 'man', 'statut à vérifier sur le site');
    X.loading = false; X.at = Date.now();
    if (S.page === 'dist' && DS.mint === mint) renderDist();
    return X;
  }
  function distKit(t) {
    const C = S.cache[t.mint] || {}, X = DS.cache[t.mint] || {}, st = C.stats, PL = PLATFORMS[t.platform] || PLATFORMS.pump;
    const desc = t.desc || (S.draft.symbol === t.symbol ? S.draft.desc : '') || '';
    return [
      ['Nom', t.name], ['Symbole', t.symbol], ['Réseau', 'Solana'], ['Adresse du contrat (mint)', t.mint], ['Décimales', '6'],
      ['Offre totale', st && st.supplyTok ? Math.round(st.supplyTok).toLocaleString('fr-FR') : '1 000 000 000'],
      ['Plateforme de lancement', PL.n + ' · ' + PL.url(t.mint)],
      ['Paire principale', X.pair ? (DEX_NAMES[X.dex] || X.dex || 'DEX') + ' · ' + X.pair : 'après le premier échange'],
      ['Date de lancement', new Date(t.createdAt).toLocaleDateString('fr-FR')],
      ['Description courte', desc.split(/(?<=[.!?])\s/)[0] || ''], ['Description complète', desc],
      ['Site web', t.web || ''], ['X (Twitter)', t.tw || ''], ['Telegram', t.tg || ''],
      ['Logo', (C.meta && C.meta.image && /^https?:/.test(C.meta.image)) ? C.meta.image : 'logo de la fiche ' + PL.n],
      ['Explorateur', 'https://solscan.io/token/' + t.mint],
    ];
  }
  function renderDist() {
    const box = $('distBody'); if (!box) return;
    const list = S.tokens.filter((t) => t.mint);
    const sel = $('distTok');
    sel.innerHTML = list.length ? list.map((t) => '<option value="' + esc(t.mint) + '">' + esc(t.name) + ' · $' + esc(t.symbol) + ' · ' + esc((PLATFORMS[t.platform] || PLATFORMS.pump).n) + '</option>').join('') : '<option value="">Aucun token lancé</option>';
    if (!list.find((t) => t.mint === DS.mint)) DS.mint = list.length ? list[0].mint : '';
    sel.value = DS.mint;
    if (!DS.mint) { box.innerHTML = '<div class="card"><div class="empty"><b>Aucun token à diffuser</b>Lancez un token (ou ajoutez-en un existant dans Mes tokens) : son adresse est nécessaire pour toutes les plateformes. <button class="btn sm primary" data-page="launch" type="button">Lancer un token</button></div></div>'; return; }
    const t = list.find((x) => x.mint === DS.mint), X = DS.cache[t.mint], rec = DS.rec[t.mint] || {};
    if (!X || (!X.loading && Date.now() - X.at > 120000)) { distCheck(t.mint); if (!S.cache[t.mint]) loadToken(t.mint, false).then(() => { if (S.page === 'dist') renderDist(); }).catch(() => {}); }
    const XX = X || { st: {}, loading: true }, vis = DIST.filter((p) => (XX.st[p.id] || {}).s === 'on').length;
    const nSel = DIST.filter((p) => DS.sel.has(p.id) && p.form).length, sent = DIST.filter((p) => rec[p.id]).length;
    const SL = { on: ['g', 'Visible'], mid: ['a', 'Partiel'], off: ['', 'Absent'], unk: ['', 'Inconnu'], man: ['b', 'Manuel'] };
    box.innerHTML =
      '<div class="dist-top">' +
        '<div class="card dist-sum"><div class="ring" style="--p:' + Math.round(vis / DIST.length * 100) + '">' + ring(vis / DIST.length * 100, 'var(--accent)') + '</div><div><b>Visible sur ' + vis + ' / ' + DIST.length + ' plateformes</b><span>' + (XX.loading ? 'Vérification en cours…' : 'Vérifié ' + fAgo(XX.at)) + ' · ' + sent + ' demande' + (sent > 1 ? 's' : '') + ' envoyée' + (sent > 1 ? 's' : '') + '</span>' + (XX.vol != null ? '<span>Volume 24 h ' + fUsd(XX.vol) + ' · liquidité ' + fUsd(XX.liq) + '</span>' : '') + '</div><button class="btn sm" data-dist="refresh" type="button">Revérifier</button></div>' +
        '<div class="card dist-act"><b>Soumettre en une fois</b><span>Cochez les plateformes, copiez le dossier, puis ouvrez tous leurs formulaires d\'un clic.</span><div class="toolbar"><button class="btn sm" data-dist="free" type="button">Sélection gratuite</button><button class="btn sm" data-dist="none" type="button">Aucune</button><button class="btn primary" data-dist="open" type="button"' + (nSel ? '' : ' disabled') + '>Ouvrir la sélection (' + nSel + ')</button></div></div>' +
      '</div>' +
      '<div class="dist-grid">' + DIST.map((p) => {
        const st = XX.st[p.id] || { s: XX.loading ? 'unk' : 'unk', t: XX.loading ? 'vérification…' : '—' }, l = SL[st.s] || SL.unk, r = rec[p.id], pg = p.page(t.mint, XX);
        return '<div class="dist-card' + (DS.sel.has(p.id) && p.form ? ' sel' : '') + '">' +
          '<div class="dist-h">' + (p.form ? '<label class="dist-ck"><input type="checkbox" data-distsel="' + p.id + '"' + (DS.sel.has(p.id) ? ' checked' : '') + '><span></span></label>' : '<span class="dist-ck off" title="Rien à soumettre"></span>') +
          '<span class="dist-logo">' + esc(p.n.replace(/[^A-Za-z]/g, '').slice(0, 2)) + '</span><span class="dist-n"><b>' + p.n + '</b><small>' + p.k + ' · <em class="c-' + p.cost + '">' + p.costL + '</em></small></span><span class="badge ' + l[0] + '">' + l[1] + '</span></div>' +
          '<div class="dist-st">' + (XX.loading && !XX.st[p.id] ? '<span class="dim">vérification…</span>' : esc(st.t)) + (r ? ' · <span class="pos">demande ' + (r.done ? 'acceptée' : 'envoyée le ' + new Date(r.at).toLocaleDateString('fr-FR')) + '</span>' : '') + '</div>' +
          '<p>' + esc(p.note) + '</p>' +
          '<div class="dist-b">' + (pg ? '<a class="btn sm" href="' + esc(pg) + '" target="_blank" rel="noopener">Voir la fiche</a>' : '') + (p.form ? '<a class="btn sm' + (p.cost === 'free' ? ' primary' : '') + '" href="' + esc(p.form) + '" target="_blank" rel="noopener" data-distform="' + p.id + '">' + esc(p.formL) + '</a><button class="btn sm ghost" data-distmark="' + p.id + '" type="button">' + (r ? (r.done ? 'Annuler' : 'Acceptée ?') : 'Marquer envoyé') + '</button>' : '') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="card"><div class="card-h"><h3>Dossier de soumission</h3><p>Les mêmes informations sont demandées partout : copiez chaque champ, ou tout le dossier d\'un coup. Les champs vides sont à compléter dans Lancer un token (liens) avant d\'envoyer une demande.</p></div>' +
      '<div class="dist-kit">' + distKit(t).map((f, i) => '<div class="' + (f[1] ? '' : 'miss') + '"><span>' + esc(f[0]) + '</span><b>' + (f[1] ? esc(f[1]) : 'à compléter') + '</b>' + (f[1] ? '<button class="btn sm ghost" data-distcp="' + i + '" type="button">Copier</button>' : '') + '</div>').join('') + '</div>' +
      '<div class="toolbar"><button class="btn primary" data-distcp="all" type="button">Copier tout le dossier</button><span class="muted" style="font-size:13px">Conseil : un site web, un compte X actif et un volume régulier font la différence pour CoinGecko, CoinMarketCap et Jupiter.</span></div></div>';
  }
  async function distAction(b) {
    const d = b.dataset, t = S.tokens.find((x) => x.mint === DS.mint);
    if (d.dist === 'refresh') { if (DS.mint) distCheck(DS.mint, true); return; }
    if (d.dist === 'free') { DS.sel = new Set(DIST.filter((p) => p.form && p.cost === 'free').map((p) => p.id)); saveSel(); return renderDist(); }
    if (d.dist === 'none') { DS.sel = new Set(); saveSel(); return renderDist(); }
    if (d.dist === 'open') {
      const ps = DIST.filter((p) => DS.sel.has(p.id) && p.form); let blocked = 0;
      try { await navigator.clipboard.writeText(distKit(t).map((f) => f[0] + ' : ' + (f[1] || '')).join('\n')); } catch (e) {}
      ps.forEach((p) => { const w = window.open(p.form, '_blank', 'noopener'); if (!w) blocked++; distMark(p.id, true); });
      if (blocked) toast('Onglets bloqués', blocked + ' formulaire(s) bloqué(s) par le navigateur : autorisez les fenêtres pop-up pour ce site, ou ouvrez-les depuis chaque carte.', 'a');
      else toast(ps.length + ' formulaires ouverts', 'Le dossier complet est copié : collez-le au fur et à mesure.', 'g');
      return renderDist();
    }
    if (d.distmark) { const r = (DS.rec[DS.mint] || {})[d.distmark]; if (!r) distMark(d.distmark, true); else if (!r.done) { r.done = true; save(LSD, DS.rec); } else { delete DS.rec[DS.mint][d.distmark]; save(LSD, DS.rec); } return renderDist(); }
    if (d.distcp) {
      const K = distKit(t), txt = d.distcp === 'all' ? K.map((f) => f[0] + ' : ' + (f[1] || '')).join('\n') : K[+d.distcp][1];
      try { await navigator.clipboard.writeText(txt); toast('Copié', d.distcp === 'all' ? 'Dossier complet' : K[+d.distcp][0], 'g'); } catch (e) { toast('Copie impossible', 'Sélectionnez le texte à la main.', 'a'); }
    }
  }
  function distMark(id, on) { if (!DS.mint) return; const R = DS.rec[DS.mint] = DS.rec[DS.mint] || {}; if (on && !R[id]) R[id] = { at: Date.now() }; save(LSD, DS.rec); }
  /* ================================================================ frais de créateur */
  // pump.fun reverse au créateur une part des frais de chaque échange. Ils s'accumulent par wallet créateur
  // (tous ses tokens confondus), sur la courbe pump.fun et sur PumpSwap après migration.
  const CFEE = { pk: null, sol: null, at: 0, loading: false, err: null };
  // wallet créateur : le wallet principal (Phantom…) s'il est connecté, c'est lui que le studio propose comme créateur
  const feeWallet = () => (cfg.sim ? { id: 'demo', name: 'démo', pk: DEMO.addr } : S.ext || S.wallet);
  const demoFees = () => Object.values(DM.tok).reduce((a, T) => a + Math.max(0, T.fees - T.claimed), 0);
  async function feesRead(force) {
    if (cfg.sim) { dmRun(); Object.assign(CFEE, { pk: DEMO.addr, sol: demoFees(), err: null, loading: false, at: Date.now() }); renderFees(); return; }
    const pk = feeWallet() && feeWallet().pk; if (!pk) return;
    if (!force && CFEE.pk === pk && (CFEE.loading || Date.now() - CFEE.at < 60000)) return;
    if (CFEE.pk !== pk) { CFEE.sol = null; CFEE.err = null; }
    CFEE.pk = pk; CFEE.loading = true; renderFees();
    try { const { web3 } = KIT(), bn = await pumpConn().online.getCreatorVaultBalanceBothPrograms(new web3.PublicKey(pk)); CFEE.sol = Number(bn.toString()) / 1e9; CFEE.err = null; }
    catch (e) { CFEE.err = 'Lecture impossible : ' + (/fetch|RPC|403|429/i.test(e.message || '') ? 'le RPC ne répond pas (ajoutez votre clé Helius dans Réglages).' : (e.message || e)); }
    CFEE.loading = false; CFEE.at = Date.now(); renderFees();
  }
  function feesHtml() {
    const w = feeWallet();
    if (!w) return '<div class="fee-l"><span class="fee-ic">' + IC.wallet + '</span><span><b>Frais de créateur</b><small>Connectez le wallet qui a créé vos tokens pour voir ce qu\'ils vous ont rapporté.</small></span></div>';
    const amt = CFEE.pk === w.pk ? CFEE.sol : null, has = amt > 0;
    return '<div class="fee-l"><span class="fee-ic">' + IC.wallet + '</span><span><b>Frais de créateur à récupérer</b><small>' +
      (CFEE.err && CFEE.pk === w.pk ? esc(CFEE.err) : 'Part des frais de chaque échange sur vos tokens · wallet ' + esc(w.id === 'session' ? 'rapide' : w.name) + ' ' + short(w.pk)) + '</small></span></div>' +
      '<div class="fee-r"><span class="fee-v' + (has ? ' pos' : '') + '">' + (amt == null ? (CFEE.loading ? '…' : '—') : '<span class="sol" data-sol="' + amt + '">' + fr(amt, amt >= 1 ? 3 : 5) + '<small> SOL</small></span>') + '</span>' +
      '<button class="btn sm ghost" data-fees="refresh" type="button" title="Relire">' + (CFEE.loading ? '…' : 'Actualiser') + '</button>' +
      '<button class="btn sm ' + (has ? 'primary' : '') + '" data-fees="claim" type="button"' + (has && !S.busy ? '' : ' disabled') + '>' + (has ? 'Récupérer' : 'Rien à récupérer') + '</button></div>';
  }
  function renderFees() { ['dFees', 'mineFees'].forEach((id) => { const el = $(id); if (el) el.innerHTML = feesHtml(); }); }
  // démo : frais cumulés par le marché simulé, récupérés dans le wallet démo
  async function demoClaimFees() {
    await feesRead(true);
    const amt = CFEE.sol || 0;
    if (!(amt > 0)) { toast('Rien à récupérer', 'Vos tokens démo n\'ont pas encore généré de frais.', 'a'); return; }
    const recap = '<div class="recap"><div class="kv"><span>Montant</span><span>' + fSolH(amt, 5) + '</span><span>Wallet</span><span>Wallet démo · ' + fSolH(DEMO.bal) + '</span><span>Mode</span><span><span class="badge v">démo</span></span></div></div>' + demoCta();
    if (!(await confirmBox('Récupérer ' + fSol(amt, 4) + ' en démo ?', recap, 'Récupérer en démo'))) return;
    const ctx = await runFlow('Démo · Frais de créateur', [{ label: 'Frais récupérés sur vos tokens démo', run: async () => { await sleep(400); return fSol(amt, 5); } }]);
    if (ctx.error) return;
    Object.values(DM.tok).forEach((T) => { T.claimed = T.fees; }); dmSave();
    DEMO.bal += amt; demoSave();
    journalAdd({ type: 'fees', mint: '', symbol: 'Frais créateur', sim: true, demo: true, status: 'ok', sol: amt, tokens: 0 });
    toast('Frais récupérés (démo)', '+' + fSol(amt, 5) + ' · wallet démo ' + fSol(DEMO.bal), 'g');
    CFEE.sol = 0; renderAll();
  }
  async function claimFees() {
    if (cfg.sim) return demoClaimFees();
    const W = feeWallet();
    if (!W) return walletMenu();
    if (!cfg.sim && W.id === 'session' && !(await ensureSigner())) return;
    if (S.busy) return;
    await feesRead(true);
    const amt = CFEE.sol || 0, pk = W.pk;
    if (!(amt > 0)) { toast('Rien à récupérer', CFEE.err || 'Aucun frais de créateur en attente pour ce wallet.', 'a'); return; }
    const recap = '<div class="recap"><div class="kv"><span>Montant</span><span>' + fSolH(amt, 5) + '</span><span>Wallet créateur</span><span>' + short(pk, 6) + '</span><span>Sources</span><span>courbe pump.fun + PumpSwap</span><span>Frais de réseau</span><span>≈ ' + fSolH(0.0001, 4) + '</span>' + (cfg.sim ? '<span>Mode</span><span><span class="badge v">démo</span></span>' : '') + '</div></div>' +
      (cfg.sim ? '<p>La transaction sera préparée et vérifiée sur la blockchain, sans être envoyée.</p>' : '<p>Les SOL arrivent directement sur ce wallet. ' + (W.id === 'session' ? 'Le wallet rapide signe dès que vous confirmez.' : 'Votre wallet va vous présenter la transaction.') + '</p>');
    if (!(await confirmBox(cfg.sim ? 'Vérifier la récupération en démo ?' : 'Récupérer ' + fSol(amt, 4) + ' ?', recap, cfg.sim ? 'Vérifier en démo' : 'Récupérer'))) return;
    S.busy = true; renderFees();
    try {
      const steps = [
        { label: 'Préparation (pump.fun et PumpSwap)', run: async (x) => { const { web3 } = KIT(), u = new web3.PublicKey(pk); const ixs = await pumpConn().online.collectCoinCreatorFeeInstructions(u, u); x.tx = await txFrom(ixs, 200000, { payer: pk }); } },
        { label: 'Vérification sur la blockchain', run: async (x) => { const v = await simulate(x.tx); x.logs = (v.logs || []).slice(-12).join('\n'); if (v.err) throw new Error(simError(v)); x.logs = ''; return 'acceptée'; } },
      ];
      if (!cfg.sim) {
        steps.push({ label: W.id === 'session' ? 'Signature par le wallet rapide' : 'Signature dans votre wallet', run: async (x) => { x.sig = await signAndSend(x.tx, null, W); return short(x.sig, 6); } });
        steps.push({ label: 'Confirmation sur la blockchain', run: async (x) => await confirmSig(x.sig) });
      }
      const ctx = await runFlow((cfg.sim ? 'Simulation · ' : '') + 'Frais de créateur', steps);
      if (ctx.error) { journalAdd({ type: 'fees', mint: '', symbol: 'Frais créateur', sim: cfg.sim, status: 'err', err: ctx.error.message, sol: 0, tokens: 0 }); return; }
      journalAdd({ type: 'fees', mint: '', symbol: 'Frais créateur', sim: cfg.sim, status: 'ok', sig: ctx.sig || '', sol: amt, tokens: 0, est: true });
      if (cfg.sim) { $('mBody').insertAdjacentHTML('beforeend', '<div class="notice info">Démo réussie : la récupération réelle passerait. Passez en réel pour recevoir les SOL.</div>'); return; }
      $('mBody').insertAdjacentHTML('beforeend', '<div class="notice good">' + fSolH(amt, 5) + ' récupérés. <a href="' + solscan(ctx.sig) + '" target="_blank" rel="noopener">Voir sur Solscan</a></div>');
      toast('Frais récupérés', fSol(amt, 5), 'g');
      CFEE.sol = 0; refreshBal();
    } finally { S.busy = false; setTimeout(() => feesRead(true), 1500); renderAll(); }
  }
  /* ================================================================ onglet Créer : création manuelle guidée */
  const CR_FIELDS = { crName: 'name', crSym: 'symbol', crDesc: 'desc', crTw: 'tw', crTg: 'tg', crWeb: 'web' };
  const CHECK_SVG = '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  let crTimer = null;
  function crLogoSoon() {
    clearTimeout(crTimer);
    crTimer = setTimeout(() => { if (S.draft.imgSrc !== 'upload') { if (!S.draft.logo.textCustom) S.draft.logo.text = S.draft.symbol; S.draft.logo.name = S.draft.name; drawLogo(); } renderCreate(); }, 450);
  }
  function crInput(t) {
    const k = CR_FIELDS[t.id]; if (!k) return false;
    const d = S.draft;
    if (k === 'symbol') { const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (t.value !== v) t.value = v; d.symbol = v; d.symManual = !!v; crLogoSoon(); }
    else if (k === 'name') { d.name = t.value; if (!d.symManual) { d.symbol = t.value.trim() ? tickerFor(t.value) : ''; const sy = $('crSym'); if (sy) sy.value = d.symbol; } d.idea = null; crLogoSoon(); }
    else d[k] = t.value.trim() && k !== 'desc' ? t.value.trim() : t.value;
    saveDraft(); renderCreate(); return true;
  }
  function crSteps() {
    const d = S.draft, urlOk = (u) => !u || /^https?:\/\/\S+\.\S+/.test(u);
    return {
      s1: d.name.trim().length >= 1 && /^[A-Z0-9]{2,10}$/.test(d.symbol || '') && (d.desc || '').trim().length >= 10,
      s2: !!d.image,
      s3: !!(d.tw || d.tg || d.web) && urlOk(d.tw) && urlOk(d.tg) && urlOk(d.web),
    };
  }
  function renderCreate() {
    if (!$('lt-create') || S.ltab !== 'create') return;
    const d = S.draft, set = (id, v) => { const el = $(id); if (el && el !== document.activeElement && el.value !== (v || '')) el.value = v || ''; };
    Object.keys(CR_FIELDS).forEach((id) => set(id, d[CR_FIELDS[id]]));
    $('crDescCnt').textContent = (d.desc || '').length + ' / 1000';
    $('crSymHelp').textContent = d.symManual ? 'Ticker saisi à la main.' : 'Rempli tout seul à partir du nom, modifiable.';
    $('crLogo').innerHTML = d.image ? '<img src="' + d.image + '" alt="Logo du token"><em>' + (d.imgSrc === 'upload' ? 'Votre image' : 'Logo généré') + '</em>' : '<span>Pas encore de logo</span>';
    $('crPvImg').innerHTML = d.image ? '<img src="' + d.image + '" alt="">' : esc((d.symbol || '?').slice(0, 3));
    $('crPvName').textContent = d.name.trim() || 'Nom du token'; $('crPvSym').textContent = '$' + (d.symbol || 'TICKER');
    $('crPvDesc').textContent = (d.desc || '').trim() || 'Votre description apparaîtra ici.';
    const st = crSteps();
    [['crOk1', 'crS1', st.s1], ['crOk2', 'crS2', st.s2], ['crOk3', 'crS3', st.s3]].forEach(([o, sec, ok]) => { $(o).innerHTML = ok ? CHECK_SVG : ''; $(sec).classList.toggle('done', ok); });
    const it = (ok, l, opt) => '<div class="' + (ok ? 'ok' : opt ? 'opt' : '') + '"><i>' + (ok ? CHECK_SVG : '') + '</i>' + l + '</div>';
    $('crCheck').innerHTML = it(d.name.trim().length >= 1, 'Un nom') + it(/^[A-Z0-9]{2,10}$/.test(d.symbol || ''), 'Un ticker de 2 à 10 caractères') + it((d.desc || '').trim().length >= 10, 'Une description') + it(st.s2, 'Un logo') + it(st.s3, 'Au moins un lien', true);
    const v = $('crVars');
    if (v) { if (!S.logoVars || d.imgSrc === 'upload') { v.hidden = true; v.innerHTML = ''; } else { v.hidden = false; const L = d.logo; v.innerHTML = S.logoVars.map((x, i) => '<button class="lvar' + (L.style === x.style && L.pal === x.pal && L.seed === x.seed ? ' on' : '') + '" data-lvar="' + i + '" type="button"><img src="' + x.img + '" alt=""><span>' + esc(STYLES[x.style]) + '</span></button>').join(''); } }
  }
  function crAction(a) {
    const d = S.draft;
    if (a === 'desc') { if (!d.name.trim()) { toast('Nom manquant', 'Écrivez d\'abord le nom de votre token.', 'a'); $('crName').focus(); return; } d.desc = descFor(d.name, d.symbol || tickerFor(d.name), d.name.split(' ').pop()); saveDraft(); renderCreate(); return; }
    if (a === 'gen') {
      if (!d.symbol) { toast('Nom manquant', 'Écrivez d\'abord le nom de votre token : le logo s\'en inspire.', 'a'); $('crName').focus(); return; }
      if (d.imgSrc === 'upload') { d.imgSrc = 'gen'; drawLogo.key = null; }
      d.logo.name = d.name; if (!d.logo.textCustom) d.logo.text = d.symbol;
      logoVariants(); if (S.logoVars) applyLogoVar(0); renderCreate(); return;
    }
    if (a === 'edit') { setLaunchTab('studio'); S.step = 2; renderLaunch(); window.scrollTo(0, 0); return; }
    if (a === 'launch') {
      const st = crSteps();
      if (!st.s1) { toast('Bloc 1 à compléter', 'Il faut un nom, un ticker de 2 à 10 caractères et une description.', 'a'); $('crS1').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (!st.s2) { toast('Logo manquant', 'Importez votre image ou cliquez sur « Proposer des logos ».', 'a'); $('crS2').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      setLaunchTab('studio'); S.step = 4; renderLaunch(); window.scrollTo(0, 0);
      toast('Prêt pour le lancement', d.name + ' · $' + d.symbol + '. Choisissez l\'achat du créateur, puis lancez.', 'g');
    }
  }
  /* ================================================================ rendu : lancer */
  function renderLaunch() {
    document.querySelectorAll('#stepper button').forEach((b) => { const n = +b.dataset.step; b.classList.toggle('on', n === S.step); b.classList.toggle('done', n < S.step); });
    document.querySelectorAll('[data-stepcard]').forEach((c) => { c.hidden = +c.dataset.stepcard !== S.step; });
    $('genThemes').innerHTML = THEME_SHOWN.map((k) => '<button class="univ-card' + (S.draft.theme === k ? ' on' : '') + '" data-theme="' + k + '" type="button" style="--th:' + (UNIV_TINT[k] || 'var(--accent)') + '" aria-pressed="' + (S.draft.theme === k) + '"><span class="univ-art">' + (UNIV_ART[k] || '') + '</span><span class="univ-t"><b>' + esc(THEMES[k].label) + '</b><small>' + esc(UNIV_HINT[k] || '') + '</small></span></button>').join('');
    $('genLangs').innerHTML = Object.keys(LANGS).map((k) => '<button class="chip ' + (S.draft.lang === k ? 'on' : '') + '" data-lang="' + k + '" type="button">' + LANGS[k] + '</button>').join('');
    $('genTones').innerHTML = Object.keys(TONES).map((k) => '<button class="chip ' + (S.draft.tone === k ? 'on' : '') + '" data-tone="' + k + '" type="button">' + TONES[k] + '</button>').join('');
    if ($('genWord') !== document.activeElement) $('genWord').value = S.draft.word || '';
    renderIdeas();
    $('logoStyles').innerHTML = Object.keys(STYLES).map((k) => '<button class="chip ' + (S.draft.logo.style === k ? 'on' : '') + '" data-lstyle="' + k + '" type="button">' + STYLES[k] + '</button>').join('');
    { const L = S.draft.logo, on = L.style === 'meme', box = $('logoMeme'); if (box) { box.hidden = !on; if (on) { const M = memePick(L, L.name || S.draft.name);
      $('logoChar').innerHTML = Object.keys(MEME.chars).map((k) => '<button class="chip ' + (M.ch === k ? 'on' : '') + '" data-mchar="' + k + '" type="button">' + MEME.chars[k] + '</button>').join('');
      $('logoExpr').innerHTML = Object.keys(MEME.exprs).map((k) => '<button class="chip ' + (M.ex === k ? 'on' : '') + '" data-mexpr="' + k + '" type="button">' + MEME.exprs[k] + '</button>').join('');
      $('logoAcc').innerHTML = Object.keys(MEME.accs).map((k) => '<button class="chip ' + (M.acc === k ? 'on' : '') + '" data-macc="' + k + '" type="button">' + MEME.accs[k] + '</button>').join(''); } } }
    if (S.draft.logo.style === 'meme') $('logoPal').innerHTML = MEME.bg.map((c, i) => '<button type="button" data-pal="' + i + '" class="' + (S.draft.logo.pal % MEME.bg.length === i ? 'on' : '') + '" style="background:' + c + '" title="Fond ' + (i + 1) + '" aria-label="Fond ' + (i + 1) + '"></button>').join('');
    else $('logoPal').innerHTML = PALS.map((p, i) => '<button type="button" data-pal="' + i + '" class="' + (S.draft.logo.pal === i ? 'on' : '') + '" style="background:linear-gradient(135deg,' + p.bg[1] + ' 0 55%,' + p.fg + ' 55% 100%)" title="' + esc(p.n) + '" aria-label="' + esc(p.n) + '"></button>').join('');
    if ($('logoEmoji') !== document.activeElement) $('logoEmoji').value = S.draft.logo.emoji || '';
    if ($('logoText') !== document.activeElement) $('logoText').value = S.draft.logo.text || '';
    renderLogoSrc();
    if (S.draft.imgSrc === 'upload' && S.draft.image) drawUploaded();
    else drawLogo();
    renderLogoVars();
    fillFields(); renderDevQuote(); renderLaunchSide(); renderTpPlan(); renderCreate();
  }
  function renderIdeas() {
    $('ideas').innerHTML = S.ideas.length ? S.ideas.map((x, i) => '<button class="idea ' + (S.draft.idea === i && S.draft.name === x.name ? 'on' : '') + '" data-idea="' + i + '" type="button"><div class="h"><img class="idea-logo" alt="" src="' + (x.logo || (x.logo = ideaLogo(x))) + '"><b>' + esc(x.name) + '</b><span class="sc ' + (x.score >= 80 ? 'pos' : x.score >= 60 ? 'warn' : 'neg') + '">' + x.score + '</span></div><span class="tk-l">$' + esc(x.ticker) + '</span><small>' + esc(x.tag) + '</small><div class="why-score">' + x.parts.map((p) => '<span class="' + (p.v >= 10 ? 'p' : p.v <= 3 ? 'm' : '') + '">' + esc(p.k) + '</span>').join('') + '</div></button>').join('')
      : '<div class="empty"><b>Choisissez un univers ci-dessus</b>Les idées apparaissent ici : nom, ticker et logo. Cliquez sur celle qui vous plaît, le studio passe tout seul à l\'étape suivante.</div>';
  }
  function fillFields() {
    const set = (id, v) => { const el = $(id); if (el && el !== document.activeElement) el.value = v || ''; };
    set('fName', S.draft.name); set('fSymbol', S.draft.symbol); set('fDesc', S.draft.desc); set('fTw', S.draft.tw); set('fTg', S.draft.tg); set('fWeb', S.draft.web);
    if ($('fDev') !== document.activeElement) $('fDev').value = S.draft.dev;
    const cnt = (id, v, max) => { const el = $(id); el.textContent = (v || '').length + ' / ' + max; el.classList.toggle('over', (v || '').length > max); };
    cnt('cName', S.draft.name, 32); cnt('cSymbol', S.draft.symbol, 10); cnt('cDesc', S.draft.desc, 1000);
  }
  function renderDevQuote() {
    const dev = num(S.draft.dev) || 0, q = dev > 0 ? quoteBuy(INIT_CURVE, dev) : null, st = curveStats(INIT_CURVE);
    $('devQuote').innerHTML = '<div class="kv">' + (q ? '<span>Vous recevez</span><span>' + fTok(q.tokens) + ' tokens</span><span>Part de l\'offre</span><span class="' + (q.supplyPct > cfg.devMaxPct ? 'neg' : q.supplyPct > 5 ? 'warn' : 'pos') + '">' + fPct(q.supplyPct, 2) + '</span><span>Capitalisation après</span><span>' + (S.solUsd ? fUsd(q.mcapAfterSol * S.solUsd) : fSol(q.mcapAfterSol, 1)) + '</span><span>Frais estimés</span><span>' + fSolH(q.fees, 4) + '</span>'
      : '<span>Achat du créateur</span><span>aucun</span><span>Capitalisation de départ</span><span>' + (S.solUsd ? fUsd(st.mcapSol * S.solUsd) : fSol(st.mcapSol, 1)) + '</span>') + '</div>';
    $('launchNote').innerHTML = q && q.supplyPct > 5 ? 'Un créateur qui détient plus de 5 % de l\'offre fait fuir les acheteurs prudents : les outils d\'analyse l\'affichent en rouge.' : 'L\'achat du créateur est visible publiquement. Une petite part rassure : vous montrez que vous croyez au projet sans contrôler le prix.';
    const R = readiness();
    $('launchBtn').textContent = cfg.sim ? 'Lancer en démo' : 'Lancer le token';
    $('launchBtn').className = 'btn ' + (cfg.sim ? 'primary' : 'danger');
    $('launchBtn').disabled = S.busy;
    $('launchHint').textContent = R.blocking.length ? 'À compléter : ' + R.blocking[0] : cfg.sim ? 'Prêt pour un lancement en démo.' : 'Prêt. Le token sera publié après votre signature.';
  }
  function ring(pct, color) { const r = 16, c = 2 * Math.PI * r; return '<svg viewBox="0 0 38 38"><circle cx="19" cy="19" r="' + r + '" fill="none" stroke="var(--line2)" stroke-width="4"/><circle cx="19" cy="19" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + (c * pct / 100) + ' ' + c + '"/></svg><span>' + Math.round(pct) + '</span>'; }
  function renderLaunchSide() {
    const d = S.draft;
    { const pv = $('pvImg'), k = d.image ? d.image.length + d.image.slice(-48) : ''; if (pv.dataset.k !== k) { pv.dataset.k = k; pv.innerHTML = d.image ? '<img src="' + esc(d.image) + '" alt="">' : 'pas de logo'; } }
    renderLogoPrev();
    $('pvName').textContent = d.name || 'Nom du token'; $('pvSym').textContent = '$' + (d.symbol || 'TICKER');
    $('pvDesc').textContent = d.desc || 'La description apparaîtra ici.';
    $('pvLinks').innerHTML = [['X', d.tw], ['Telegram', d.tg], ['Site', d.web]].filter((x) => x[1]).map((x) => '<span>' + x[0] + '</span>').join('');
    const R = readiness();
    $('readyRing').innerHTML = ring(R.score, R.blocking.length ? 'var(--amber)' : 'var(--green)');
    $('readyTitle').textContent = R.blocking.length ? 'Pas encore prêt' : 'Prêt à lancer';
    $('readySub').textContent = R.blocking.length ? R.blocking.length + ' point(s) obligatoire(s) à compléter' : 'Les recommandations restantes sont facultatives';
    $('readyList').innerHTML = R.items.map((x) => '<div class="it ' + (x.ok ? 'ok' : x.kind === 'req' ? 'no' : 'wn') + '"><i>' + (x.ok ? '✓' : x.kind === 'req' ? '✕' : '!') + '</i><span>' + esc(x.label) + (x.kind === 'rec' && !x.ok ? ' <span class="dim">(conseillé)</span>' : '') + '</span></div>').join('');
    if (S.page === 'launch') renderDevQuote();
  }

  /* ================================================================ fiche token (Mes tokens, Trader) */
  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, h = +(cv.dataset.h || (cv.dataset.h = cv.getAttribute('height') || 200)), w = cv.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 600;
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr); if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h };
  }
  function drawPriceChart(cv, C) {
    const { g, w, h } = setupCanvas(cv);
    const T = (C.trades || []).slice().reverse().filter((x) => x.price > 0 && isFinite(x.price));
    const pts = T.map((x) => ({ t: x.t, p: x.price, side: x.side }));
    if (C.stats) pts.push({ t: Date.now(), p: C.stats.price, side: 'now' });
    g.font = '12px "Geist Mono","JetBrains Mono",monospace';
    if (pts.length < 2) { g.fillStyle = '#848ba2'; g.textAlign = 'center'; g.fillText('Le graphique apparaîtra avec les premières transactions.', w / 2, h / 2); return; }
    const pl = 10, pr = 86, pt = 12, pb = 22;
    let x0 = pts[0].t, x1 = pts[pts.length - 1].t; if (x1 <= x0) x1 = x0 + 1;
    let y0 = Math.min(...pts.map((p) => p.p)), y1 = Math.max(...pts.map((p) => p.p)); if (y1 <= y0) { y1 = y0 * 1.05; y0 *= 0.95; } const pad = (y1 - y0) * 0.1; y0 -= pad; y1 += pad;
    const X = (t) => pl + (t - x0) / (x1 - x0) * (w - pl - pr), Y = (p) => pt + (1 - (p - y0) / (y1 - y0)) * (h - pt - pb);
    const toUsd = (p) => S.solUsd ? p * 1e9 * S.solUsd : null;
    for (let i = 0; i <= 3; i++) { const v = y0 + (y1 - y0) * i / 3; g.strokeStyle = '#212536'; g.lineWidth = 1; g.beginPath(); g.moveTo(pl, Y(v)); g.lineTo(w - pr, Y(v)); g.stroke(); g.fillStyle = '#848ba2'; g.textAlign = 'left'; g.fillText(toUsd(v) != null ? fUsd(toUsd(v)) : fPrice(v), w - pr + 6, Y(v) + 4); }
    const last = pts[pts.length - 1].p, up = last >= pts[0].p, col = up ? '#34d58c' : '#ff5d6c';
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.p)) : g.moveTo(X(p.t), Y(p.p)))); g.lineTo(X(pts[pts.length - 1].t), h - pb); g.lineTo(X(pts[0].t), h - pb); g.closePath();
    g.fillStyle = up ? 'rgba(52,213,140,.13)' : 'rgba(255,93,108,.13)'; g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.p)) : g.moveTo(X(p.t), Y(p.p)))); g.stroke();
    pts.forEach((p) => { if (p.side === 'now') return; g.fillStyle = p.side === 'buy' ? '#34d58c' : '#ff5d6c'; g.beginPath(); g.arc(X(p.t), Y(p.p), 2.6, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = '#848ba2'; g.textAlign = 'left'; g.fillText(fT(x0), pl, h - 6); g.textAlign = 'right'; g.fillText(fT(x1), w - pr, h - 6);
  }
  function myPosition(mint, C) {
    const J = S.journal.filter((j) => j.mint === mint && (cfg.sim ? !!j.sim : !j.sim) && j.status === 'ok');
    const bought = J.filter((j) => j.tokens > 0), spent = -bought.reduce((s, j) => s + j.sol, 0), tokB = bought.reduce((s, j) => s + j.tokens, 0);
    const recv = J.filter((j) => j.tokens < 0).reduce((s, j) => s + j.sol, 0);
    const bal = C.myBal || 0, price = C.stats ? C.stats.price : 0, value = bal * price;
    const avg = tokB ? spent / tokB : null;
    return { bal, value, avg, spent, recv, pnl: value + recv - spent };
  }
  function tokenHtml(mint, ctx) {
    const C = S.cache[mint];
    if (!C) return '<div class="card"><div class="empty"><b>Chargement…</b>Lecture de la courbe de liaison sur la blockchain.</div></div>';
    if (C.error) return '<div class="notice bad">' + esc(C.error) + '</div>';
    const c = C.curve, st = C.stats, m = C.meta || {}, sym = m.symbol || short(mint), name = m.name || 'Token ' + short(mint);
    if (!c.exists) return '<div class="notice bad">Aucun marché pour cette adresse : ni courbe pump.fun, ni paire sur DEX Screener. Vérifiez le mint ; un token tout juste créé peut mettre une minute à apparaître.</div>';
    const plat = PLATFORMS[platOf(mint)];
    const pos = myPosition(mint, C), side = S.side[ctx], R = risks(C);
    const usd = (sol) => S.solUsd ? fUsd(sol * S.solUsd) : fSol(sol);
    const H = C.holders || [];
    const tradesHtml = (C.trades || []).slice(0, 40).map((x) => '<div class="tr"><span class="badge ' + (x.side === 'buy' ? 'g' : 'r') + '">' + (x.side === 'buy' ? 'Achat' : 'Vente') + '</span><span class="w">' + (x.wallet === c.creator ? '<b class="warn">créateur</b>' : S.wallet && x.wallet === S.wallet.pk ? '<b>vous</b>' : short(x.wallet)) + ' · ' + fAgo(x.t) + '</span><span class="num">' + fTok(x.tokens) + '</span><span class="num ' + (x.side === 'buy' ? 'pos' : 'neg') + '">' + fSolH(x.sol, 3) + '</span></div>').join('');
    const orders = S.orders.filter((o) => o.mint === mint);
    return '<div class="card"><div class="tok-head"><div class="av lg">' + (m.image ? '<img src="' + esc(m.image) + '" alt="">' : esc(sym.slice(0, 3))) + '</div><div><h2>' + esc(name) + ' <span class="badge v">$' + esc(sym) + '</span>' + (c.ext ? ' <span class="badge b">' + esc(plat ? plat.n : dexName(c)) + '</span>' : c.complete ? ' <span class="badge b">migré</span>' : '') + '</h2><p>' + short(mint, 8) + ' <button class="copy" data-copy="' + mint + '" type="button" title="Copier">⧉</button></p></div><div class="spacer"></div>' +
      (isDemoMint(mint) ? '<div class="links"><span class="badge v">token démo</span><span class="dim">Marché simulé : il n\'existe pas sur la blockchain.</span></div>'
        : '<div class="links">' + (plat ? '<a href="' + plat.url(mint) + '" target="_blank" rel="noopener">' + plat.n + '</a>' : '') + '<a href="https://solscan.io/token/' + mint + '" target="_blank" rel="noopener">Solscan</a><a href="https://dexscreener.com/solana/' + mint + '" target="_blank" rel="noopener">DEX Screener</a></div>') +
      (C.live && Date.now() - C.live < 60000 ? '<span class="badge g" title="Prix reçu en direct (' + esc(C.liveSrc || 'blockchain') + ')">● temps réel</span>' : LIVE[mint] ? '<span class="badge b" title="Abonnement actif, en attente d\'une transaction">● à l\'écoute</span>' : '<span class="badge" title="Ajoutez un RPC Helius pour le temps réel">actualisation ' + cfg.pollSec + ' s</span>') +
      '<button class="btn sm" data-refresh="' + ctx + '" type="button">Actualiser</button>' +
      (ctx === 'mine' && C.myBal != null && !(C.myBal > 0) ? '<button class="btn sm ghost" data-unmine="' + mint + '" type="button" title="Retirer ce token de votre liste (rien n\'est vendu ni modifié sur la blockchain)">Retirer de la liste</button>' : '') + '</div>' +
      '<div class="grid-stats" style="margin-top:14px">' +
      '<div class="stat"><div class="l">Capitalisation</div><div class="v">' + usd(st.mcapSol) + '</div><div class="s">' + fSol(st.mcapSol, 1) + '</div></div>' +
      '<div class="stat"><div class="l">Prix</div><div class="v">' + fPrice(st.price) + '</div><div class="s">SOL par token</div></div>' +
      (c.ext ? '<div class="stat"><div class="l">' + (c.dex === 'launchlab' ? 'Courbe LaunchLab' : 'Marché') + '</div><div class="v">' + (c.dex === 'launchlab' ? '≈ ' + fPct(st.progress, 0) : esc(dexName(c))) + '</div>' + (c.dex === 'launchlab' ? '<div class="progress-big"><i style="width:' + st.progress.toFixed(1) + '%"></i></div>' : '') + '<div class="s">' + (st.realSol ? fSolH(st.realSol, 2) + ' dans le pool' : 'liquidité ' + fUsd(st.liqUsd)) + (c.dex === 'launchlab' ? ' · migration à ~85 SOL' : '') + '</div></div>' :
      '<div class="stat"><div class="l">Courbe de liaison</div><div class="v">' + fPct(st.progress, 1) + '</div><div class="progress-big"><i style="width:' + st.progress.toFixed(1) + '%"></i></div><div class="s">' + fSolH(st.realSol, 2) + ' dans la courbe' + (c.complete ? ' · terminée' : '') + '</div></div>') +
      '<div class="stat"><div class="l">' + (cfg.sim ? 'Votre position démo' : 'Votre position') + '</div><div class="v">' + (S.wallet || cfg.sim ? fTok(pos.bal) : '—') + '</div><div class="s">' + (S.wallet || cfg.sim ? usd(pos.value) + (pos.avg ? ' · PRU ' + fPrice(pos.avg) : '') : 'wallet non connecté') + '</div></div>' +
      '<div class="stat"><div class="l">Résultat</div><div class="v ' + cls(pos.pnl) + '">' + (pos.spent || pos.recv ? fSolH(pos.pnl, 3) : '—') + '</div><div class="s">valeur + ventes − achats</div></div>' +
      '</div></div>' +
      '<div class="tok-grid"><div>' +
      (c.ext && c.pair ? '<div class="card"><div class="card-h"><h3>Graphique en direct</h3><p>Fourni par DEX Screener · ' + esc(dexName(c)) + '</p></div><div class="dexchart" data-pair="' + esc(c.pair) + '"><iframe src="https://dexscreener.com/solana/' + encodeURIComponent(c.pair) + '?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=1" title="Graphique DEX Screener" loading="lazy"></iframe></div></div>'
        : '<div class="card"><div class="card-h"><h3>Prix des dernières transactions</h3><p>Points verts : achats, rouges : ventes.</p></div><canvas class="pchart" data-mint="' + mint + '" height="230"></canvas></div>') +
      '<div class="card"><div class="card-h"><h3>Analyse</h3><p>Lue sur la blockchain, mise à jour toutes les ' + cfg.pollSec + ' s.</p></div><div class="risk-list">' + R.map((r) => '<div class="rk"><span class="sdot" style="background:' + LVL[r.lvl] + '"></span><div><b>' + esc(r.t) + '</b><div class="muted">' + esc(r.d) + '</div></div></div>').join('') + '</div></div>' +
      '<div class="card"><div class="card-h"><h3>Transactions récentes</h3><p>' + (C.tradeErr ? '<span class="warn">' + esc(C.tradeErr) + '</span>' : (C.trades || []).length + ' lues sur la courbe') + '</p></div><div class="feed">' + (tradesHtml || '<div class="empty">Aucune transaction lue pour l\'instant.</div>') + '</div></div>' +
      '</div><div>' +
      '<div class="trade-box"><div class="seg"><button class="buy ' + (side === 'buy' ? 'on' : '') + '" data-side="buy" data-ctx="' + ctx + '" type="button">Acheter</button><button class="sell ' + (side === 'sell' ? 'on' : '') + '" data-side="sell" data-ctx="' + ctx + '" type="button">Vendre</button></div>' +
      (side === 'buy'
        ? '<div class="amt"><input id="amt-' + ctx + '" type="number" min="0" step="0.01" placeholder="0,1" inputmode="decimal"><em>SOL</em></div><div class="presets">' + [0.05, 0.1, 0.25, 0.5, 1].map((v) => '<button class="btn sm" data-preset="' + v + '" data-ctx="' + ctx + '" type="button">' + fr(v, v < 0.1 ? 2 : 2).replace(/,?0+$/, '') + '</button>').join('') + '</div>'
        : '<div class="amt"><input id="amt-' + ctx + '" type="text" placeholder="50%" inputmode="decimal"><em>' + esc(sym) + '</em></div><div class="presets">' + ['25%', '50%', '75%', '100%'].map((v) => '<button class="btn sm" data-preset="' + v + '" data-ctx="' + ctx + '" type="button">' + v + '</button>').join('') + '</div>') +
      '<div class="quote" id="q-' + ctx + '"><span class="muted">Saisissez un montant pour voir le devis.</span></div>' +
      '<button class="btn ' + (side === 'buy' ? 'primary' : 'danger') + '" style="width:100%" data-go="' + ctx + '" data-mint="' + mint + '" type="button">' + (side === 'buy' ? 'Acheter' : 'Vendre') + (cfg.sim ? ' en démo' : '') + '</button>' +
      '<p class="dim" style="font-size:13.5px;margin:10px 0 0">Slippage ' + cfg.slippage + ' % · priorité ' + (cfg.speed === 'manual' ? fSolH(cfg.priorityFee, 4) : (SPEEDS[cfg.speed] || SPEEDS.fast).label.toLowerCase()) + ' · limite ' + fSolH(cfg.maxSol, 2) + ' par achat</p></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-h"><h3>Ordres préparés</h3><button class="btn sm" data-neworder="' + mint + '" type="button" style="margin-left:auto">Ajouter</button></div>' +
      (orders.length ? orders.map(orderRow).join('') : '<div class="muted" style="font-size:13.5px">Aucun ordre. Exemple : vendre 50 % si le prix double.</div>') + '</div>' +
      '<div class="card"><div class="card-h"><h3>Plus gros détenteurs</h3></div><div class="holders">' + (H.length ? H.slice(0, 12).map((x, i) => '<div class="h"><span class="dim">' + (i + 1) + '</span><div><div style="display:flex;justify-content:space-between;gap:8px"><span class="mono" style="font-size:13.5px">' + (x.label ? '<b class="' + (x.label === 'Créateur' ? 'warn' : '') + '">' + esc(x.label) + '</b>' : short(x.owner)) + '</span></div><div class="bar"><i style="width:' + Math.min(100, x.pct * 2).toFixed(1) + '%;background:' + (x.label === 'Courbe de liaison' ? 'var(--blue)' : x.label === 'Créateur' ? 'var(--amber)' : 'var(--violet)') + '"></i></div></div><span class="num mono" style="text-align:right">' + fPct(x.pct, 1) + '</span></div>').join('') : '<div class="muted">' + (C.holdErr ? esc(C.holdErr) : 'Chargement…') + '</div>') + '</div></div>' +
      '</div></div>';
  }
  function orderRow(o) {
    const cond = o.kind === 'trail' ? 'Stop suiveur −' + o.value + ' % ' + (o.armed ? '· plus haut ' + fPrice(o.peak) + ' · vend sous ' + fPrice(o.peak * (1 - o.value / 100)) : '· s\'active à +' + (o.arm || 0) + ' %') : o.kind === 'tp' ? (o.plan ? 'Prix ×' + fr(1 + o.value / 100, 1).replace(',0', '') : 'Prix ≥ +' + o.value + ' %') : o.kind === 'sl' ? 'Prix ≤ −' + o.value + ' %' : 'Capitalisation ≥ ' + fUsd(o.value);
    return '<div class="orow"><span class="badge ' + (o.active ? 'v' : o.auto === 'ok' ? 'g' : o.auto === 'ko' ? 'r' : o.triggered ? 'a' : '') + '">' + (o.active ? 'actif' : o.triggered ? (o.done ? (o.auto === 'ok' ? 'vendu auto' + (o.ms ? ' · ' + (o.ms / 1000).toFixed(1).replace('.', ',') + ' s' : '') : 'traité') : o.auto === 'run' ? 'vente en cours' : o.auto === 'ko' ? 'échec' : 'déclenché') : 'arrêté') + '</span><span class="ot"><b>' + esc(o.symbol) + '</b> · ' + cond + ' → vendre ' + (o.tokens ? fTok(o.tokens) + ' (' + o.pct + ' % de l\'achat initial)' : o.pct + ' %') + '<br><span class="dim">Référence ' + fPrice(o.ref) + ' SOL · créé ' + fAgo(o.createdAt) + '</span></span><span class="oa">' +
      (o.failed && !o.done ? '<span class="dim" style="color:var(--red)">' + esc(o.failed) + '</span>' : '') +
      (o.triggered && !o.done && o.auto !== 'run' ? '<button class="btn sm danger" data-osell="' + o.id + '" type="button">' + (canAuto() ? 'Vendre maintenant' : 'Signer la vente') + '</button>' : '') +
      '<button class="btn sm" data-otoggle="' + o.id + '" type="button">' + (o.active ? 'Arrêter' : 'Réactiver') + '</button><button class="btn sm ghost" data-odel="' + o.id + '" type="button">Supprimer</button></span></div>';
  }
  function updateQuote(ctx) {
    const mint = S.view[ctx], C = S.cache[mint], el = $('q-' + ctx), inp = $('amt-' + ctx);
    if (!el || !inp || !C || !C.curve || !C.curve.exists) return;
    const side = S.side[ctx], v = inp.value.trim();
    if (!v) { el.innerHTML = '<span class="muted">Saisissez un montant pour voir le devis.</span>'; return; }
    if (C.curve.complete) { el.innerHTML = '<span class="muted">' + (C.curve.ext ? 'Token ' + esc(dexName(C.curve)) + ' : le prix dépend du pool, devis exact non disponible ici.' : 'Token migré : le prix dépend du pool PumpSwap, devis non disponible ici.') + '</span>'; return; }
    const sym = (C.meta && C.meta.symbol) || 'tokens';
    if (side === 'buy') {
      const sol = num(v), q = quoteBuy(C.curve, sol);
      if (!q) { el.innerHTML = '<span class="neg">Montant invalide.</span>'; return; }
      el.innerHTML = '<div class="kv"><span>Vous recevez environ</span><span>' + fTok(q.tokens) + ' ' + esc(sym) + '</span><span>Impact sur le prix</span><span class="' + (q.impact > 5 ? 'warn' : '') + '">+' + fPct(q.impact, 2) + '</span><span>Minimum garanti</span><span>' + fTok(q.minOut) + '</span><span>Frais estimés</span><span>' + fSolH(q.fees, 4) + '</span></div>' + (sol > cfg.maxSol ? '<div class="danger-note">Au-delà de votre limite de ' + fSolH(cfg.maxSol, 2) + ' par achat.</div>' : '');
    } else {
      const bal = C.myBal || 0, tokens = /%$/.test(v) ? bal * (num(v.replace('%', '')) || 0) / 100 : num(v), q = quoteSell(C.curve, tokens);
      if (!q) { el.innerHTML = '<span class="' + (bal ? 'neg' : 'muted') + '">' + (bal ? 'Quantité invalide.' : 'Vous ne détenez pas ce token.') + '</span>'; return; }
      el.innerHTML = '<div class="kv"><span>Vous vendez</span><span>' + fTok(tokens) + ' ' + esc(sym) + '</span><span>Vous recevez environ</span><span>' + fSolH(q.sol) + '</span><span>Impact sur le prix</span><span class="' + (q.impact < -5 ? 'warn' : '') + '">' + fPct(q.impact, 2) + '</span><span>Minimum garanti</span><span>' + fSolH(q.minOut) + '</span></div>';
    }
  }
  async function showToken(ctx, mint) {
    S.view[ctx] = mint; ppSync(liveSet());
    const box = ctx === 'mine' ? $('mineDetail') : $('tradeDetail');
    if (!S.cache[mint]) box.innerHTML = tokenHtml(mint, ctx);
    try { await loadToken(mint, true); } catch (e) { S.cache[mint] = Object.assign(S.cache[mint] || {}, { error: e.message }); }
    renderTokenView(ctx); if (ctx === 'mine') renderMineList();
  }
  // Remplace le contenu sans toucher au graphique DEX Screener (une iframe déplacée ou recréée se recharge à chaque actualisation)
  function keepFrame(box, html) {
    const old = box.querySelector('.dexchart'), tmp = document.createElement('div'); tmp.innerHTML = html;
    const nw = tmp.querySelector('.dexchart');
    if (!old || !nw || old.dataset.pair !== nw.dataset.pair) { box.innerHTML = html; return; }
    const sync = (o, n) => {
      const oc = [...o.childNodes], nc = [...n.childNodes];
      if (oc.length !== nc.length) return false;
      for (let i = 0; i < nc.length; i++) { if (oc[i] === old) continue; if (oc[i].contains && oc[i].contains(old)) { if (!sync(oc[i], nc[i])) return false; } else o.replaceChild(nc[i], oc[i]); }
      return true;
    };
    if (!sync(box, tmp)) box.innerHTML = html;
  }
  function renderTokenView(ctx) {
    const mint = S.view[ctx]; if (!mint) return;
    const box = ctx === 'mine' ? $('mineDetail') : $('tradeDetail');
    const inp = $('amt-' + ctx), keep = inp ? inp.value : '', focus = inp && document.activeElement === inp;
    keepFrame(box, tokenHtml(mint, ctx));
    const ni = $('amt-' + ctx); if (ni && keep) { ni.value = keep; if (focus) ni.focus(); }
    box.querySelectorAll('canvas.pchart').forEach((cv) => drawPriceChart(cv, S.cache[mint] || {}));
    updateQuote(ctx);
  }

  /* ================================================================ rendu : pages */
  function renderMine() { renderMineList();
    if (S.view.mine) { if (!S.cache[S.view.mine] || !S.cache[S.view.mine].curve) showToken('mine', S.view.mine); else renderTokenView('mine'); } else if (S.tokens.length) showToken('mine', S.tokens[0].mint); else $('mineDetail').innerHTML = '';
  }
  /* ---------- Mes tokens : retirer de la liste les tokens que l'on ne détient plus (rien n'est vendu ni modifié sur la blockchain) */
  async function unMine(mints, skipAsk) {
    const set = new Set(mints), L = S.tokens.filter((t) => set.has(t.mint)); if (!L.length) return;
    if (!skipAsk) {
      const names = L.map((t) => '<b>' + esc(t.symbol || short(t.mint)) + '</b>').join(', ');
      if (!(await confirmBox(L.length > 1 ? 'Retirer ' + L.length + ' tokens de votre liste ?' : 'Retirer ' + (L[0].symbol || short(L[0].mint)) + ' de votre liste ?',
        '<p>' + names + '</p><p>' + (L.length > 1 ? 'Ils disparaissent' : 'Il disparaît') + ' seulement de « Mes tokens » : rien n\'est vendu ni modifié sur la blockchain. Vous pourrez ' + (L.length > 1 ? 'les' : 'le') + ' rajouter avec « Ajouter un token existant ».</p>', 'Retirer'))) return;
    }
    for (let i = S.tokens.length - 1; i >= 0; i--) if (set.has(S.tokens[i].mint)) S.tokens.splice(i, 1);   // même tableau : le compte reste synchronisé
    save(LS.tokens, S.tokens);
    if (set.has(S.view.mine)) { S.view.mine = null; $('mineDetail').innerHTML = ''; }
    toast(L.length > 1 ? L.length + ' tokens retirés' : 'Token retiré', 'Rien n\'a été vendu ni modifié sur la blockchain.', 'g');
    renderAll();
  }
  async function pruneMine() {
    if (!S.tokens.length) return;
    if (!cfg.sim && !S.wallet) { toast('Wallet non connecté', 'Connectez votre wallet : le studio vérifie vos soldes avant de retirer un token.', 'a'); return; }
    const btn = $('minePrune'); if (btn) { btn.disabled = true; btn.textContent = 'Vérification des soldes…'; }
    try {
      await Promise.all(S.tokens.map((t) => { const C = S.cache[t.mint]; return C && C.myBal != null && Date.now() - C.at < 60000 ? null : loadToken(t.mint, false).catch(() => null); }));
      const empty = S.tokens.filter((t) => { const C = S.cache[t.mint]; return C && C.myBal != null && !(C.myBal > 0); });
      const unknown = S.tokens.filter((t) => { const C = S.cache[t.mint]; return !C || C.myBal == null; }).length;
      if (!empty.length) { toast('Rien à retirer', unknown ? 'Solde illisible pour ' + unknown + ' token' + (unknown > 1 ? 's' : '') + ' : réessayez dans un instant.' : 'Vous détenez encore chacun de vos tokens.', unknown ? 'a' : 'g'); return; }
      await unMine(empty.map((t) => t.mint));
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Retirer ceux que je ne détiens pas'; } }
  }
  function renderMineList() {
    { const pb = $('minePrune'); if (pb) pb.hidden = !S.tokens.length; }
    $('mineList').innerHTML = S.tokens.length ? S.tokens.map((t) => {
      const C = S.cache[t.mint], st = C && C.stats;
      return '<button class="tok-card ' + (S.view.mine === t.mint ? 'on' : '') + '" data-mine="' + t.mint + '" type="button"><div class="tk"><div class="av">' + (t.image ? '<img src="' + esc(t.image) + '" alt="">' : esc(t.symbol.slice(0, 3))) + '</div><div class="nm"><b>' + esc(t.name) + '</b><small>$' + esc(t.symbol) + ' · ' + esc((PLATFORMS[t.platform] || PLATFORMS.pump).n) + ' · ' + fAgo(t.createdAt) + '</small></div></div>' +
        '<div class="kv"><span>Capitalisation</span><span>' + (st ? (S.solUsd ? fUsd(st.mcapSol * S.solUsd) : fSol(st.mcapSol, 1)) : '…') + '</span><span>Courbe</span><span>' + (st ? fPct(st.progress, 0) : '…') + '</span></div>' + (st ? '<div class="bar"><i style="width:' + st.progress.toFixed(1) + '%;background:var(--violet)"></i></div>' : '') + '</button>';
    }).join('') : '<div class="card"><div class="empty"><b>Aucun token lancé pour l\'instant</b>Lancez votre premier token depuis « Lancer un token », ou ajoutez un token existant.</div></div>';
  }
  function renderOrders() {
    const on = canAuto(), locked = S.wallet && S.wallet.id === 'session' && !SESSW.kp;
    const n = $('ordersNote');
    if (n) { n.className = 'notice ' + (on ? 'good' : locked ? 'warn' : 'info'); n.innerHTML = on ? '<b>Ventes automatiques actives.</b> Votre wallet rapide vend dès qu\'une condition est atteinte : à l\'instant quand l\'outil est ouvert, et par le serveur (vérification toutes les 10 secondes) quand il est fermé.' : locked ? '<b>Wallet rapide verrouillé :</b> les ventes automatiques sont en pause.' : 'Avec ' + (S.ext ? esc(S.ext.name) : 'votre wallet') + ', chaque vente demande votre signature. Pour des ventes automatiques, utilisez votre <button class="btn sm" data-sw="' + (SRVPK ? 'use' : 'create') + '" type="button">wallet rapide</button>.';
      if (cfg.sim) { n.className = 'notice info'; n.innerHTML = '<b>Démo.</b> Un ordre déclenché est vendu aussitôt dans le wallet démo, au prix simulé.'; } }
    $('ordersBody').innerHTML = S.orders.length ? '<div class="card">' + S.orders.map(orderRow).join('') + '</div>' : '<div class="card"><div class="empty"><b>Aucun ordre préparé</b>Ouvrez un token (Mes tokens ou Trader) et cliquez sur « Ajouter » dans le bloc Ordres préparés.</div></div>';
  }
  function renderJournal() {
    document.querySelectorAll('#jFilter .chip').forEach((b) => b.classList.toggle('on', b.dataset.jf === S.jf));
    // chaque mode a son propre historique : réel seulement en réel, démo seulement en démo
    const jf = $('jFilter'); if (jf) jf.hidden = true;
    const L = S.journal.filter((j) => (cfg.sim ? !!j.sim : !j.sim));
    const ok = L.filter((j) => j.status === 'ok'), spent = -ok.filter((j) => j.sol < 0).reduce((s, j) => s + j.sol, 0), recv = ok.filter((j) => j.sol > 0).reduce((s, j) => s + j.sol, 0);
    $('jStats').innerHTML = '<div class="stat"><div class="l">Opérations</div><div class="v">' + L.length + '</div><div class="s">' + L.filter((j) => j.status === 'err').length + ' échouées</div></div>' +
      '<div class="stat"><div class="l">SOL dépensé</div><div class="v">' + fSolH(spent, 3) + '</div></div><div class="stat"><div class="l">SOL reçu</div><div class="v">' + fSolH(recv, 3) + '</div></div>' +
      '<div class="stat"><div class="l">Flux net</div><div class="v ' + cls(recv - spent) + '">' + fSolH(recv - spent, 3) + '</div><div class="s">hors valeur des tokens détenus</div></div>';
    const TY = { create: 'Création', buy: 'Achat', sell: 'Vente', fees: 'Frais créateur', deposit: 'Dépôt', withdraw: 'Retrait' };
    $('jBody').innerHTML = L.length ? '<div class="tablebox"><table><thead><tr><th>Date</th><th>Opération</th><th>Token</th><th class="num">SOL</th><th class="num">Tokens</th><th>Statut</th><th>Lien</th></tr></thead><tbody>' +
      L.slice(0, 400).map((j) => '<tr><td class="dim">' + fT(j.t) + '</td><td>' + TY[j.type] + (j.sim ? ' <span class="badge v">démo</span>' : '') + '</td><td><b>' + esc(j.symbol || '') + '</b> <span class="dim mono">' + short(j.mint) + '</span></td><td class="num ' + cls(j.sol) + '">' + (j.sol ? fSolH(j.sol, 4) : '—') + (j.est ? ' <span class="dim">≈</span>' : '') + '</td><td class="num">' + (j.tokens ? fTok(j.tokens) : '—') + '</td><td>' + (j.status === 'ok' ? '<span class="badge g">ok</span>' : '<span class="badge r" title="' + esc(j.err || '') + '">échec</span>') + '</td><td>' + (j.sig && !j.demo ? '<a href="' + solscan(j.sig) + '" target="_blank" rel="noopener">Solscan</a>' : j.demo ? '<span class="dim">démo</span>' : '<span class="dim">—</span>') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="card"><div class="empty"><b>Aucune opération</b>' + (cfg.sim ? 'Les lancements, achats et ventes de la démo apparaîtront ici.' : 'Vos lancements, achats et ventes apparaîtront ici, avec leur lien Solscan.') + '</div></div>';
  }
  /* ---------- communication */
  let soTone = 'communaute';
  const SO_TONES = { communaute: 'Communauté', drole: 'Décalé', epique: 'Épique' };
  function renderSocial() {
    const list = S.tokens.slice();
    if (S.draft.name && S.draft.symbol) list.push({ mint: '', name: S.draft.name, symbol: S.draft.symbol, draft: true });
    const sel = $('soTok'), cur = sel.value;
    sel.innerHTML = list.length ? list.map((t, i) => '<option value="' + i + '">' + esc(t.name) + ' · $' + esc(t.symbol) + (t.draft ? ' (brouillon)' : '') + '</option>').join('') : '<option value="">Aucun token</option>';
    if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur;
    $('soTone').innerHTML = Object.keys(SO_TONES).map((k) => '<button class="chip ' + (soTone === k ? 'on' : '') + '" data-sotone="' + k + '" type="button">' + SO_TONES[k] + '</button>').join('');
    const t = list[+sel.value || 0];
    if (!t) { $('posts').innerHTML = '<div class="card"><div class="empty"><b>Rien à annoncer pour l\'instant</b>Préparez un token dans « Lancer un token ».</div></div>'; return; }
    const PLn = PLATFORMS[t.platform || (t.draft ? S.draft.platform : 'pump')] || PLATFORMS.pump;
    const link = t.mint ? PLn.url(t.mint) : (S.draft.lang !== 'fr' ? '[' + PLn.n + ' link after launch]' : '[lien ' + PLn.n + ' après lancement]'), ca = t.mint || (S.draft.lang !== 'fr' ? '[contract after launch]' : '[adresse après lancement]');
    const C = t.mint && S.cache[t.mint], mc = C && C.stats && S.solUsd ? fUsd(C.stats.mcapSol * S.solUsd) : '[capitalisation]';
    const en = S.draft.lang !== 'fr', nfaTxt = $('soNfa').checked ? (en ? '\n\nNot financial advice.' : '\n\nPas un conseil financier.') : '';
    const T = en ? {
      communaute: [['Launch announcement', '$' + t.symbol + ' is live on ' + PLn.n + '.\n\n' + t.name + ' belongs to whoever holds it. Fair launch, no presale.\n\nCA: ' + ca + '\n' + link + nfaTxt],
        ['Milestone', t.name + ' just crossed ' + mc + ' market cap.\n\nThank you to everyone who showed up early.\n\n$' + t.symbol + '\n' + link + nfaTxt],
        ['Telegram welcome', 'Welcome to ' + t.name + '.\n\nOfficial contract: ' + ca + '\nThe team will never DM you first. Ignore anyone who does.' + nfaTxt]],
      drole: [['Launch announcement', 'We launched $' + t.symbol + '. Nobody asked. Here it is anyway.\n\nCA: ' + ca + '\n' + link + nfaTxt],
        ['Milestone', t.name + ' is at ' + mc + '. Our parents still don\'t know what we do.\n\n$' + t.symbol + '\n' + link + nfaTxt],
        ['Telegram welcome', 'You found ' + t.name + '. Rule one: memes. Rule two: see rule one.\n\nOfficial contract: ' + ca + '\nNo one from the team will DM you.' + nfaTxt]],
      epique: [['Launch announcement', 'Every story starts small.\n\n' + t.name + ' ($' + t.symbol + ') is live on ' + PLn.n + '.\n\nCA: ' + ca + '\n' + link + nfaTxt],
        ['Milestone', t.name + ' reached ' + mc + '.\n\nThis is still the beginning.\n\n$' + t.symbol + '\n' + link + nfaTxt],
        ['Telegram welcome', 'Welcome to ' + t.name + '.\n\nOfficial contract: ' + ca + '\nNo team member will ever DM you first.' + nfaTxt]],
    }[soTone] : {
      communaute: [['Annonce du lancement', '$' + t.symbol + ' est en ligne sur ' + PLn.n + '.\n\n' + t.name + ' appartient à ceux qui le gardent. Lancement équitable, sans prévente.\n\nCA : ' + ca + '\n' + link + nfaTxt],
        ['Palier atteint', t.name + ' vient de passer ' + mc + ' de capitalisation.\n\nMerci à ceux qui étaient là tôt.\n\n$' + t.symbol + '\n' + link + nfaTxt],
        ['Message Telegram de bienvenue', 'Bienvenue sur ' + t.name + '.\n\nContrat officiel : ' + ca + '\nL\'équipe ne vous écrira jamais en privé la première.' + nfaTxt]],
      drole: [['Annonce du lancement', 'On a lancé $' + t.symbol + '. Personne ne l\'a demandé. Le voilà quand même.\n\nCA : ' + ca + '\n' + link + nfaTxt],
        ['Palier atteint', t.name + ' vaut ' + mc + '. Nos parents ne comprennent toujours pas ce qu\'on fait.\n\n$' + t.symbol + '\n' + link + nfaTxt],
        ['Message Telegram de bienvenue', 'Vous avez trouvé ' + t.name + '. Règle un : des mèmes. Règle deux : voir règle un.\n\nContrat officiel : ' + ca + '\nPersonne de l\'équipe ne vous écrira en privé.' + nfaTxt]],
      epique: [['Annonce du lancement', 'Chaque histoire commence petite.\n\n' + t.name + ' ($' + t.symbol + ') est en ligne sur ' + PLn.n + '.\n\nCA : ' + ca + '\n' + link + nfaTxt],
        ['Palier atteint', t.name + ' atteint ' + mc + '.\n\nCe n\'est que le début.\n\n$' + t.symbol + '\n' + link + nfaTxt],
        ['Message Telegram de bienvenue', 'Bienvenue sur ' + t.name + '.\n\nContrat officiel : ' + ca + '\nAucun membre de l\'équipe ne vous écrira en privé le premier.' + nfaTxt]],
    }[soTone];
    $('posts').innerHTML = T.map((p, i) => '<div class="post"><b>' + esc(p[0]) + '</b><textarea data-post="' + i + '">' + esc(p[1]) + '</textarea><div class="foot"><span class="cnt" data-cnt="' + i + '"></span><button class="btn sm" data-pcopy="' + i + '" type="button">Copier</button><a class="btn sm" data-px="' + i + '" target="_blank" rel="noopener" href="#">Publier sur X</a></div></div>').join('');
    document.querySelectorAll('#posts textarea').forEach(updatePost);
  }
  function updatePost(ta) {
    const i = ta.dataset.post, n = [...ta.value].length, c = document.querySelector('[data-cnt="' + i + '"]');
    c.textContent = n + ' / 280 caractères (X)'; c.classList.toggle('over', n > 280);
    document.querySelector('[data-px="' + i + '"]').href = 'https://x.com/intent/post?text=' + encodeURIComponent(ta.value);
  }

  /* ---------- réglages : formulaires avec Valider / Annuler */
  const FORMS = [
    { id: 'engine', title: 'Moteur de transaction', fields: [['engine', 'Construction des transactions', 'sel', 'Direct : programme pump.fun, sans intermédiaire ni frais en plus. PumpPortal : secours. Les tokens migrés passent automatiquement par PumpPortal, quel que soit ce choix.', [['direct', 'Direct (pump.fun)'], ['portal', 'PumpPortal (+0,5 %)']]]] },
    { id: 'conn', title: 'Connexion à Solana', help: 'helius', fields: [['rpc', 'Adresse RPC', 'text', 'Helius conseillé : https://mainnet.helius-rpc.com/?api-key=…', 'wide'], ['pollSec', 'Actualisation des fiches', 'num', 'Toutes les N secondes', 's'], ['ppLive', 'Flux en direct PumpPortal', 'bool', 'Prix et transactions pump.fun en temps réel : les ordres se déclenchent en moins d\'une seconde. Gratuit, sans clé.']] },
    { id: 'meta', title: 'Métadonnées du token', help: 'pinata', fields: [['metaMethod', 'Envoi du logo', 'sel', 'Par le serveur TokenStudio vers pump.fun, sans clé. Pinata en secours.', [['pump', 'Serveur → pump.fun (conseillé)'], ['pinata', 'Pinata (votre clé)']]], ['pinataJwt', 'Jeton Pinata (JWT)', 'password', 'Gratuit sur pinata.cloud, reste dans ce navigateur', 'wide']] },
    { id: 'speed', title: 'Vitesse d\'exécution', fields: [['speed', 'Priorité des transactions', 'sel', 'Calculée sur les frais réellement payés sur pump.fun ces dernières secondes', [['eco', 'Économique'], ['fast', 'Rapide (conseillé)'], ['turbo', 'Turbo'], ['manual', 'Manuelle']]], ['maxPriority', 'Plafond des frais de priorité', 'num', 'Jamais plus que ce montant par transaction', 'SOL'], ['priorityFee', 'Frais de priorité manuels', 'num', 'Utilisés seulement en mode Manuelle', 'SOL']] },
    { id: 'fast', title: 'Wallet rapide et envoi', fields: [['autoExec', 'Ventes automatiques', 'bool', 'Le wallet rapide exécute seul les paliers et le stop'], ['slSlippage', 'Slippage du stop', 'num', 'Plus large : mieux vaut vendre un peu moins cher que pas du tout', '%'], ['autoRetry', 'Nouveaux essais', 'num', 'Si le prix a trop bougé (0 à 3)', 'fois'], ['sender', 'Envoi direct aux validateurs', 'sel', 'Helius Sender, en plus de votre RPC. Pourboire inclus dans la transaction.', [['swqos', 'Rapide · 0,000005 SOL (conseillé)'], ['max', 'Maximum · 0,001 SOL'], ['off', 'Désactivé']]]] },
    { id: 'trade', title: 'Trading', fields: [['slippage', 'Slippage maximum', 'num', 'Écart de prix accepté', '%'], ['maxSol', 'Limite par achat', 'num', 'Garde-fou contre une erreur de saisie', 'SOL'], ['feePct', 'Frais pump.fun estimés', 'num', 'Pour les devis', '%'], ['portalFeePct', 'Frais PumpPortal', 'num', 'Seulement avec le moteur PumpPortal', '%']] },
    { id: 'launch', title: 'Lancement', fields: [['devMaxPct', 'Part maximale du créateur', 'num', 'Bloque un achat initial plus gros', '% offre']] },
    { id: 'alerts', title: 'Alertes', fields: [['notify', 'Notifications du navigateur', 'bool', 'Quand un ordre préparé se déclenche'], ['sound', 'Son', 'bool', '']] },
  ];
  function setFormsHtml() {
    $('setForms').innerHTML = FORMS.map((F) => '<fieldset data-form="' + F.id + '"><legend>' + esc(F.title) + '</legend>' + (F.help ? '<button class="btn sm ghost kp-help" data-act="keyhelp" data-k="' + F.help + '" type="button">' + (F.help === 'helius' ? 'Comment obtenir une clé Helius ?' : 'Comment obtenir un jeton Pinata ?') + '</button>' : '') + F.fields.map(([k, label, type, help, extra]) => {
      const id = 'set-' + k, lab = '<label for="' + id + '">' + esc(label) + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>';
      if (type === 'bool') return '<div class="f">' + lab + '<span class="switch"><input type="checkbox" id="' + id + '" data-k="' + k + '"' + (cfg[k] ? ' checked' : '') + '><i></i></span></div>';
      if (type === 'sel') return '<div class="f">' + lab + '<select class="sel" id="' + id + '" data-k="' + k + '">' + extra.map((o) => '<option value="' + o[0] + '"' + (cfg[k] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>';
      if (extra === 'wide') return '<div class="f wide">' + lab + '<input type="' + type + '" id="' + id + '" data-k="' + k + '" value="' + esc(cfg[k]) + '" autocomplete="off" spellcheck="false"></div>';
      return '<div class="f">' + lab + '<span class="unit"><input type="number" step="any" min="0" id="' + id + '" data-k="' + k + '" value="' + esc(cfg[k]) + '"><em>' + esc(extra || '') + '</em></span></div>';
    }).join('') + '<div class="actions"><span class="msg">Modifications non enregistrées</span><button class="btn sm" data-fa="cancel" type="button">Annuler</button><button class="btn sm primary" data-fa="save" type="button">Valider</button></div></fieldset>').join('') +
      '<fieldset><legend>Test</legend><p class="muted" style="font-size:13.5px;margin:0 0 10px">Vérifiez que le RPC répond et lit bien la blockchain.</p><button class="btn" data-act="testrpc" type="button">Tester le RPC</button></fieldset>';
  }
  const fieldsOf = (fs) => FORMS.find((F) => F.id === fs.dataset.form).fields;
  function readField(el, type) { return type === 'bool' ? el.checked : type === 'sel' || type === 'text' || type === 'password' ? el.value.trim() : num(el.value); }
  function formDirty(fs) { return fieldsOf(fs).some(([k, , type]) => { const el = fs.querySelector('[data-k="' + k + '"]'); return readField(el, type) !== cfg[k]; }); }
  function formSave(fs) {
    fs.querySelectorAll('.ferr').forEach((e) => e.remove()); fs.querySelectorAll('.err').forEach((e) => e.classList.remove('err'));
    const v = {}, errs = [];
    fieldsOf(fs).forEach(([k, label, type]) => { const el = fs.querySelector('[data-k="' + k + '"]'); v[k] = readField(el, type); if (type === 'num' && (v[k] == null || v[k] < 0)) errs.push([el, 'Nombre positif attendu']); });
    const bad = (k, c, m) => { if (k in v && c(v[k])) errs.push([fs.querySelector('[data-k="' + k + '"]'), m]); };
    bad('rpc', (x) => x && !/^https:\/\/\S+$/.test(x), 'Adresse https:// attendue');
    bad('slippage', (x) => x < 0.5 || x > 50, 'Entre 0,5 et 50 %');
    bad('priorityFee', (x) => x > 0.01, '0,01 SOL maximum');
    bad('maxPriority', (x) => x <= 0 || x > 0.05, 'Entre 0,0001 et 0,05 SOL');
    bad('maxSol', (x) => x <= 0 || x > 100, 'Entre 0,01 et 100 SOL');
    bad('devMaxPct', (x) => x < 0 || x > 50, 'Entre 0 et 50 %');
    bad('pollSec', (x) => x < 5 || x > 120, 'Entre 5 et 120 s');
    bad('feePct', (x) => x > 5, '5 % maximum');
    bad('slSlippage', (x) => x < 1 || x > 60, 'Entre 1 et 60 %');
    bad('autoRetry', (x) => x < 0 || x > 3 || Math.round(x) !== x, 'Entier de 0 à 3');
    if (errs.length) { errs.forEach(([el, m]) => { el.classList.add('err'); const d = document.createElement('div'); d.className = 'ferr'; d.textContent = m; el.closest('.f').appendChild(d); }); toast('Valeurs invalides', 'Corrigez les champs en rouge.', 'r'); return; }
    Object.assign(cfg, v); save(LS.cfg, cfg); fs.classList.remove('dirty');
    if ('notify' in v && v.notify && window.Notification && Notification.permission === 'default') Notification.requestPermission();
    if ('ppLive' in v) { if (cfg.ppLive) ppSync(liveSet()); else ppClose(); }
    if ('rpc' in v) { S.rpcOk = null; PST = { url: null }; Object.keys(LIVE).forEach((k) => delete LIVE[k]); BH = { at: 0, hash: null }; testRpc(true); }
    toast('Réglages enregistrés', FORMS.find((F) => F.id === fs.dataset.form).title, 'g'); renderTop();
  }
  function formCancel(fs) { fieldsOf(fs).forEach(([k, , type]) => { const el = fs.querySelector('[data-k="' + k + '"]'); if (type === 'bool') el.checked = !!cfg[k]; else el.value = cfg[k]; el.classList.remove('err'); }); fs.querySelectorAll('.ferr').forEach((e) => e.remove()); fs.classList.remove('dirty'); }
  /* ================================================================ temps réel : flux PumpPortal (gratuit, sans clé)
     Une seule connexion WebSocket pour tous les tokens suivis : PumpPortal bannit les clients qui en ouvrent plusieurs. */
  const PP = { ws: null, state: 'off', subs: new Set(), want: new Set(), retry: 0, timer: null, last: 0, msgs: 0, pending: new Set() };
  // page Trader (React) : tokens affichés, écouteurs des transactions brutes, flux des nouveaux tokens (même connexion unique)
  const PPX = { mints: new Set(), fns: new Set(), news: false };
  const PP_URL = 'wss://pumpportal.fun/api/data';
  const VIRT_TOK = INIT_CURVE.vTok - INIT_CURVE.realTok; // part virtuelle de la courbe (unités brutes)
  function ppSend(o) { try { if (PP.ws && PP.ws.readyState === 1) { PP.ws.send(JSON.stringify(o)); return true; } } catch (e) {} return false; }
  function ppConnect() {
    if (PP.ws || !cfg.ppLive || !window.WebSocket) return;
    clearTimeout(PP.timer); PP.state = 'connecting'; ppStatus();
    let ws; try { ws = new WebSocket(PP_URL); } catch (e) { PP.state = 'error'; ppStatus(); return ppRetry(); }
    PP.ws = ws;
    ws.onopen = () => { PP.state = 'on'; PP.retry = 0; PP.subs = new Set(); PP.newSub = false; ppStatus(); ppDiff(); };
    ws.onmessage = (ev) => {
      PP.last = Date.now(); PP.msgs++; let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || !m.mint || !m.txType) return;
      PPX.fns.forEach((f) => { try { f(m); } catch (e) {} });
      if (m.txType !== 'create') { try { ppApply(m); } catch (e) {} }
    };
    ws.onerror = () => { PP.state = 'error'; ppStatus(); };
    ws.onclose = () => { if (PP.ws === ws) { PP.ws = null; PP.subs = new Set(); if (PP.state !== 'off') { PP.state = 'error'; ppStatus(); ppRetry(); } } };
  }
  function ppRetry() {
    if (!cfg.ppLive || (!PP.want.size && !PPX.news)) return;
    const wait = [1000, 2000, 5000, 10000, 30000][Math.min(PP.retry++, 4)];
    clearTimeout(PP.timer); PP.timer = setTimeout(ppConnect, wait);
  }
  function ppClose() { clearTimeout(PP.timer); PP.state = 'off'; const ws = PP.ws; PP.ws = null; PP.subs = new Set(); try { if (ws) ws.close(); } catch (e) {} ppStatus(); }
  // Aligne les abonnements sur la liste voulue (ajouts et retraits en un message chacun)
  function ppDiff() {
    if (!PP.ws || PP.ws.readyState !== 1) return;
    const add = [...PP.want].filter((m) => !PP.subs.has(m)), del = [...PP.subs].filter((m) => !PP.want.has(m));
    if (add.length && ppSend({ method: 'subscribeTokenTrade', keys: add })) add.forEach((m) => PP.subs.add(m));
    if (del.length && ppSend({ method: 'unsubscribeTokenTrade', keys: del })) del.forEach((m) => PP.subs.delete(m));
    const news = !!(cfg.ppLive && PPX.news);
    if (news !== !!PP.newSub && ppSend({ method: news ? 'subscribeNewToken' : 'unsubscribeNewToken' })) PP.newSub = news;
    ppStatus();
  }
  function ppSync(set) {
    PP.ui = new Set([...set].filter(Boolean));               // tokens suivis par l'interface (fiches, ordres)
    PP.want = new Set(cfg.ppLive ? [...PP.ui, ...PPX.mints] : []);
    if (!PP.want.size && !(cfg.ppLive && PPX.news)) { if (PP.ws && (PP.subs.size || PP.newSub)) ppDiff(); return; }
    if (!PP.ws) ppConnect(); else ppDiff();
  }
  function ppApply(m) {
    const mint = m.mint, C = S.cache[mint];
    if (!C) { if (PP.ui && PP.ui.has(mint) && !PP.pending.has(mint)) { PP.pending.add(mint); loadToken(mint, false).catch(() => {}).finally(() => PP.pending.delete(mint)); } return; }
    const vs = +m.vSolInBondingCurve, vt = +m.vTokensInBondingCurve, sol = +m.solAmount, tok = +m.tokenAmount;
    if (vs > 0 && vt > 0) {
      const c = Object.assign({ supply: 1e15 }, C.curve || {}, { exists: true, vSol: vs * 1e9, vTok: vt * 1e6 });
      if (!c.pda) { try { c.pda = curvePda(mint); } catch (e) {} }
      c.realTok = Math.max(0, c.vTok - VIRT_TOK); c.realSol = Math.max(0, c.vSol - INIT_CURVE.vSol);
      if (c.realTok <= 0) c.complete = true;
      C.curve = c; C.stats = curveStats(c);
    } else if (sol > 0 && tok > 0 && C.stats) {           // token migré : prix tiré de la transaction elle-même
      const price = sol / tok; C.stats = Object.assign({}, C.stats, { price, mcapSol: price * C.stats.supplyTok, mcapUsd: S.solUsd ? price * C.stats.supplyTok * S.solUsd : null });
    }
    if (m.txType === 'migrate' && C.curve) { C.curve = Object.assign({}, C.curve, { complete: true }); if (C.stats) C.stats = Object.assign({}, C.stats, { progress: 100 }); }
    if ((m.txType === 'buy' || m.txType === 'sell') && sol > 0 && tok > 0 && m.signature && !C.trades.some((x) => x.sig === m.signature)) {
      C.trades.unshift({ sig: m.signature, t: Date.now(), wallet: m.traderPublicKey || '', side: m.txType, tokens: tok, sol, price: sol / tok, live: true });
      if (C.trades.length > 300) C.trades.length = 300;
    }
    C.live = Date.now(); C.liveSrc = 'PumpPortal'; C.at = Date.now();
    onLive(mint);
  }
  function ppLabel() {
    if (!cfg.ppLive) return ['', 'coupé'];
    if (PP.state === 'on') return ['on', PP.subs.size ? PP.subs.size + ' suivi' + (PP.subs.size > 1 ? 's' : '') : 'prêt'];
    if (PP.state === 'connecting') return ['wait', 'connexion…'];
    if (PP.state === 'error') return ['bad', 'reconnexion'];
    return ['', 'prêt · rien à suivre']; // se connecte dès qu'un token est suivi (ordre actif ou fiche ouverte)
  }
  function ppStatus() { const el = document.querySelector('[data-sc="pp"]'); if (!el) return; const l = ppLabel(); el.querySelector('.dot').className = 'dot ' + l[0]; el.querySelector('em').textContent = l[1]; }
  function liveSet() {
    const keep = new Set(S.orders.filter((o) => o.active).map((o) => o.mint));
    if (S.page === 'mine') { if (S.view.mine) keep.add(S.view.mine); S.tokens.slice(0, 20).forEach((t) => keep.add(t.mint)); }
    keep.forEach((m) => { if (isDemoMint(m)) keep.delete(m); });   // tokens démo : marché simulé, aucun abonnement
    return keep;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && cfg.ppLive && PP.want.size && !PP.ws) ppConnect(); });
  /* ---------- clés API (mode réel) : petit panneau en 3 étapes, vérifié avant d'enregistrer */
  const KEYS = {
    helius: { title: 'Ajouter votre clé Helius', label: 'Clé Helius', ph: 'ex. 1a2b3c4d-5e6f-…',
      why: '<b>Gratuite, conseillée.</b> Prix en temps réel, envois plus rapides et pas de blocage. Sans elle, l\'outil passe par le RPC TokenStudio, plus lent.',
      steps: ['Créez un compte gratuit sur <a href="https://dashboard.helius.dev/" target="_blank" rel="noopener">helius.dev</a>.', 'Dans votre tableau de bord, copiez votre clé <b>API Key</b>.', 'Collez-la ci-dessous, puis cliquez sur « Vérifier ».'] },
    pinata: { title: 'Ajouter votre jeton Pinata', label: 'Jeton Pinata (JWT)', ph: 'eyJhbGciOi…',
      why: '<b>Gratuit, en secours.</b> Le serveur TokenStudio envoie normalement le logo et la fiche à pump.fun. Si cet envoi échoue, votre propre jeton Pinata prend le relais.',
      steps: ['Créez un compte gratuit sur <a href="https://app.pinata.cloud/developers/api-keys" target="_blank" rel="noopener">pinata.cloud</a>.', 'Dans <b>API Keys</b>, créez une clé avec le droit d\'envoi de fichiers, puis copiez son <b>JWT</b>.', 'Collez-le ci-dessous, puis cliquez sur « Vérifier ».'] },
  };
  const heliusUrl = (v) => (/^https:\/\//i.test(v) ? v : 'https://mainnet.helius-rpc.com/?api-key=' + v);
  async function checkKey(kind, raw) {
    const v = (raw || '').trim(); if (!v) throw new Error('Collez d\'abord la clé.');
    const go = (url, o) => fetch(url, Object.assign({ signal: AbortSignal.timeout(10000) }, o)).catch(() => { throw new Error((kind === 'helius' ? 'Helius' : 'Pinata') + ' ne répond pas. Vérifiez votre connexion et réessayez.'); });
    if (kind === 'helius') {
      if (!/^https:\/\//i.test(v) && !/^[A-Za-z0-9-]{20,}$/.test(v)) throw new Error('Cela ne ressemble pas à une clé Helius (lettres, chiffres et tirets).');
      const url = heliusUrl(v), r = await go(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }) });
      if (r.status === 401 || r.status === 403) throw new Error('Clé refusée par Helius. Recopiez-la depuis votre tableau de bord.');
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error || typeof j.result !== 'number') throw new Error('Helius a répondu une erreur (' + r.status + '). Vérifiez la clé.');
      return url;
    }
    if (v.split('.').length !== 3) throw new Error('Ce n\'est pas un JWT : il commence par « eyJ » et contient deux points.');
    const r = await go('https://api.pinata.cloud/data/testAuthentication', { headers: { Authorization: 'Bearer ' + v } });
    if (!r.ok) throw new Error('Jeton refusé par Pinata (' + r.status + '). Vérifiez qu\'il a le droit d\'envoi de fichiers.');
    return v;
  }
  async function keyPanel(kind, intro) {
    const K = KEYS[kind]; let val = '', err = '';
    for (;;) {
      const html = (intro ? '<div class="notice">' + intro + '</div>' : '') + '<p class="kp-why">' + K.why + '</p><ol class="kp-steps">' + K.steps.map((t) => '<li><span>' + t + '</span></li>').join('') + '</ol>' +
        '<label class="kp-f" for="kpIn">' + esc(K.label) + '</label><input class="kp-in" id="kpIn" type="password" autocomplete="off" spellcheck="false" placeholder="' + esc(K.ph) + '" value="' + esc(val) + '">' +
        (err ? '<div class="notice bad kp-err">' + esc(err) + '</div>' : '') + '<p class="kp-note">La clé reste dans ce navigateur. Vous la retrouvez dans Réglages.</p>';
      const i = await modal(K.title, html, [{ label: 'Plus tard' }, { label: 'Vérifier', cls: 'primary', keep: true }]);
      if (i !== 1) return false;
      val = ($('kpIn') || {}).value || '';
      const btn = document.querySelector('#mRow [data-mb="1"]'); if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }
      try {
        const ok = await checkKey(kind, val);
        if (kind === 'helius') cfg.rpc = ok; else { cfg.pinataJwt = ok; cfg.metaMethod = 'pinata'; }
        save(LS.cfg, cfg); closeModal();
        toast(kind === 'helius' ? 'Clé Helius enregistrée' : 'Jeton Pinata enregistré', kind === 'helius' ? 'Temps réel et envois rapides actifs.' : 'Le logo partira par Pinata.', 'g');
        if (kind === 'helius') testRpc(true);
        if ($('setForms')) setFormsHtml();
        renderAll(); return true;
      } catch (e) { err = e.message || String(e); }
    }
  }
  // carte du tableau de bord : en réel seulement, tant que la clé Helius manque et qu'on ne l'a pas remise à plus tard
  function renderKeysCard() {
    const kc = $('keysCard'); if (!kc) return;
    const show = !cfg.sim && AUTH === true && !cfg.rpc && !cfg.keysLater;
    kc.hidden = !show; if (!show) { kc.innerHTML = ''; return; }
    kc.innerHTML = '<svg class="i" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg><span><b>Ajoutez votre clé Helius gratuite.</b> Prix en temps réel et envois plus rapides, en 2 minutes.</span>' +
      '<button class="btn sm" data-act="keylater" type="button">Plus tard</button><button class="btn sm primary" data-act="keyhelp" data-k="helius" type="button">Ajouter</button>';
  }

  async function testRpc(quiet) {
    try { const v = await rpc('getVersion', []); const slot = await rpc('getSlot', []); if (!quiet) toast('RPC opérationnel', 'Solana ' + (v['solana-core'] || '') + ' · bloc ' + slot.toLocaleString('fr-FR'), 'g'); }
    catch (e) { if (!quiet) toast('RPC en erreur', e.message, 'r'); }
  }

  /* ================================================================ ordres préparés */
  async function newOrder(mint) {
    const C = S.cache[mint]; if (!C || !C.stats) return;
    const sym = (C.meta && C.meta.symbol) || short(mint), pos = myPosition(mint, C), ref = pos.avg || C.stats.price;
    const html = '<div class="field"><label>Condition</label><select id="oKind"><option value="tp">Prise de profit : le prix monte de X %</option><option value="sl">Stop fixe : le prix baisse de X % sous la référence</option><option value="trail">Stop suiveur : le prix recule de X % depuis son plus haut</option><option value="mcap">La capitalisation atteint X $</option></select></div>' +
      '<div class="row2"><div class="field"><label for="oVal">Valeur X</label><input id="oVal" type="number" min="0" step="any" value="100"></div><div class="field"><label for="oPct">Part à vendre</label><input id="oPct" type="number" min="1" max="100" step="1" value="50"></div></div>' +
      '<div class="field" id="oArmF" hidden><label for="oArm">Commencer à suivre après une hausse de <small>en %, 0 = tout de suite</small></label><input id="oArm" type="number" min="0" step="any" value="0"><div class="dim" style="font-size:13px">Le stop suiveur retient le prix le plus haut atteint et vend si le prix recule de X % depuis ce sommet. Il protège vos gains pendant la montée.</div></div>' +
      '<p>Prix de référence : <b class="mono">' + fPrice(ref) + '</b> (' + (pos.avg ? 'votre prix moyen d\'achat' : 'prix actuel') + '). Quand la condition est atteinte, le studio vous prévient et prépare la vente : vous signez ou vous refusez.</p>';
    const pr = modal('Nouvel ordre · ' + sym, html, [{ label: 'Annuler' }, { label: 'Créer l\'ordre', cls: 'primary', keep: true }], true);
    $('oKind').onchange = () => { const tr = $('oKind').value === 'trail'; $('oArmF').hidden = !tr; if (tr && num($('oVal').value) >= 100) $('oVal').value = 30; };
    const i = await pr;
    if (i !== 1) return;
    const kind = $('oKind').value, val = num($('oVal').value), pct = num($('oPct').value), arm = Math.max(0, num($('oArm').value) || 0);
    if (!(val > 0) || !(pct >= 1 && pct <= 100) || ((kind === 'sl' || kind === 'trail') && val >= 100)) { toast('Valeurs invalides', 'Vérifiez la valeur et la part (1 à 100 %).', 'r'); return; }
    closeModal();
    const o = { id: Date.now().toString(36), mint, symbol: sym, kind, value: val, pct, ref, active: true, createdAt: Date.now() };
    if (kind === 'trail') Object.assign(o, arm > 0 ? { arm, armed: false } : { arm: 0, armed: true, peak: C.stats.price });
    S.orders.push(o);
    save(LS.orders, S.orders); toast('Ordre créé', sym + ' · surveillé en continu', 'g'); renderAll();
  }
  let ordersSavedAt = 0;
  function ordersSaveSoon() { if (Date.now() - ordersSavedAt > 3000) { ordersSavedAt = Date.now(); save(LS.orders, S.orders); } }
  function orderHit(o, C) {
    const st = C.stats; if (!st) return false;
    if (o.kind === 'tp') return st.price >= o.ref * (1 + o.value / 100);
    if (o.kind === 'sl') return st.price <= o.ref * (1 - o.value / 100);
    if (o.kind === 'trail') {                              // stop suiveur : suit le plus haut, vend au recul de X %
      if (!o.armed) { if (st.price < o.ref * (1 + (o.arm || 0) / 100)) return false; o.armed = true; o.peak = st.price; ordersSaveSoon(); }
      if (!(o.peak >= st.price)) { o.peak = st.price; ordersSaveSoon(); }
      return st.price <= o.peak * (1 - o.value / 100);
    }
    if (o.kind === 'mcap') return S.solUsd && st.mcapSol * S.solUsd >= o.value;
    return false;
  }
  function checkOrdersFor(mint) {
    const C = S.cache[mint]; if (!C || !C.stats) return;
    S.orders.filter((o) => o.active && o.mint === mint).forEach((o) => { if (orderHit(o, C)) fireOrder(o); });
  }
  // réservation des ordres (en mémoire seulement, jamais enregistrée avec l'ordre) : 'wait' en cours, 'ok' obtenue
  const CLAIMS = new Map();
  function fireOrder(o) {
    // un ordre ne s'exécute qu'une fois : l'onglet le réserve d'abord (le serveur peut aussi le vendre, outil fermé)
    if (!cfg.sim && window.TSClaimOrder) {
      const c = CLAIMS.get(o.id);
      if (c === 'wait') return;
      if (c !== 'ok') {
        CLAIMS.set(o.id, 'wait');
        window.TSClaimOrder(o.id).then((ok) => {
          if (ok) { CLAIMS.set(o.id, 'ok'); fireOrder(o); return; }
          CLAIMS.delete(o.id); o.active = false; o.triggered = Date.now(); save(LS.orders, S.orders);
          toast('Ordre pris en charge par le serveur', o.symbol + ' : votre wallet rapide le vend côté serveur.', ''); renderAll();
        });
        return;
      }
      CLAIMS.delete(o.id);
    }
    o.active = false; o.triggered = Date.now(); save(LS.orders, S.orders);
    if (cfg.sim) { toast('Ordre déclenché', o.symbol + ' : condition atteinte, vente démo en cours.', 'a'); if (cfg.sound) beep(); demoOrderSell(o); return; }
    const auto = canAuto();
    const msg = o.symbol + ' : condition atteinte, vente ' + (o.tokens ? 'de ' + fTok(o.tokens) : 'de ' + o.pct + ' %') + (auto ? ' en cours (automatique).' : ' prête à signer.');
    toast('Ordre déclenché', msg, 'a');
    if (cfg.sound) beep();
    if (cfg.notify && window.Notification && Notification.permission === 'granted') { try { new Notification('TokenStudio · ordre déclenché', { body: msg }); } catch (e) {} }
    if (auto) { o.auto = 'run'; AUTOQ = AUTOQ.then(() => autoSell(o)).catch(() => {}); }
    else if (!S.busy && !$('modal').classList.contains('open')) sellOrder(o);
    renderTop(); if (S.page === 'orders') renderOrders();
  }
  async function watchOrders() {
    const act = S.orders.filter((o) => o.active); if (!act.length) return;
    for (const mint of [...new Set(act.map((o) => o.mint))]) {
      let C; try { C = await loadToken(mint, false); } catch (e) { continue; }
      act.filter((o) => o.mint === mint).forEach((o) => { if (o.active && orderHit(o, C)) fireOrder(o); });
    }
    renderTop(); if (S.page === 'orders') renderOrders();
  }
  function sellOrder(o) { trade(o.mint, 'sell', o.tokens ? String(Math.floor(o.tokens)) : o.pct + '%', { title: 'Ordre déclenché · vendre ' + o.pct + ' % de ' + o.symbol + ' ?', note: 'Condition atteinte : ' + (o.kind === 'trail' ? 'recul de ' + o.value + ' % depuis le plus haut' : o.kind === 'tp' ? 'prix +' + o.value + ' %' : o.kind === 'sl' ? 'prix −' + o.value + ' %' : 'capitalisation ' + fUsd(o.value)) + '.' }).then((ok) => { if (ok) o.done = true; save(LS.orders, S.orders); renderAll(); }); } // vente refusée ou échouée : l'ordre reste « à signer »
  /* ---------- exécution automatique par le wallet rapide */
  let AUTOQ = Promise.resolve();
  function canAuto() { return !!(cfg.autoExec && S.wallet && ((S.wallet.id === 'session' && SESSW.kp) || S.wallet.id === 'server')); }
  async function autoSell(o) {
    const t0 = performance.now(), sym = o.symbol, pk = S.wallet.pk;
    const slip = o.kind === 'sl' || o.kind === 'trail' ? Math.max(cfg.slippage, cfg.slSlippage) : cfg.slippage;
    let lastErr = null;
    for (let attempt = 0; attempt <= cfg.autoRetry; attempt++) {
      let sent = false;
      try {
        const srv = S.wallet && S.wallet.id === 'server';
        if (!srv && !SESSW.kp) throw new Error('Wallet rapide verrouillé.');
        const raw = await tokenRaw(pk, o.mint);
        let sellRaw = o.tokens ? BigInt(Math.floor(o.tokens * 1e6)) : raw * BigInt(Math.round(o.pct * 100)) / 10000n;
        if (sellRaw > raw) sellRaw = raw;
        if (sellRaw <= 0n) throw new Error('Plus aucun ' + sym + ' dans le wallet rapide.');
        const C = S.cache[o.mint], q = C && C.curve && C.curve.exists ? quoteSell(C.curve, Number(sellRaw) / 1e6) : null;
        let tx = null;
        if (cfg.engine !== 'portal' && !(C && C.curve && C.curve.complete)) { try { tx = await directTrade(o.mint, 'sell', sellRaw.toString(), slip); } catch (e) { if (e.message !== 'MIGRATED') throw e; } }
        if (!tx) tx = await portalTx({ publicKey: pk, action: 'sell', mint: o.mint, amount: Number(sellRaw) / 1e6, denominatedInSol: 'false', slippage: slip, priorityFee: cfg.priorityFee, pool: 'auto' }); // token migré ou moteur PumpPortal
        if (cfg.sim) {
          const v = await simulate(tx); if (v.err) throw new Error(simError(v));
          journalAdd({ type: 'sell', mint: o.mint, symbol: sym, sim: true, status: 'ok', sol: q ? q.sol : 0, tokens: q ? -q.tokens : 0, est: true, auto: true });
          o.done = true; o.auto = 'ok'; o.ms = Math.round(performance.now() - t0); save(LS.orders, S.orders);
          toast('Vente automatique simulée', sym + ' · passerait en réel · ' + (o.ms / 1000).toFixed(1).replace('.', ',') + ' s', 'g'); renderAll(); return;
        }
        let sig;
        if (srv) sig = await signAndSend(tx, null, S.wallet); else { tx.sign([SESSW.kp]); sig = await sendRaw(tx); }
        sent = true;
        await confirmSig(sig);
        o.ms = Math.round(performance.now() - t0);
        const d = await actualDeltas(sig, o.mint);
        const sol = d ? d.sol : (q ? q.sol : 0);
        journalAdd({ type: 'sell', mint: o.mint, symbol: sym, sim: false, status: 'ok', sig, sol, tokens: d ? -d.tokens : (q ? -q.tokens : 0), est: !d, auto: true });
        o.done = true; o.auto = 'ok'; o.sig = sig; o.failed = null; save(LS.orders, S.orders);
        toast('Vente automatique confirmée', sym + ' · +' + fSol(sol, 4) + ' · ' + (o.ms / 1000).toFixed(1).replace('.', ',') + ' s', 'g');
        if (cfg.sound) beep();
        refreshBal(); refreshView(); renderAll(); return;
      } catch (e) {
        lastErr = e;
        // pas de nouvel essai si la transaction a pu passer (sinon double vente) ou si rien ne peut changer
        if (/Plus aucun|verrouillé|Pas de confirmation/.test(e.message) || (sent && !/rejetée/.test(e.message))) break;
        await sleep(300);
      }
    }
    o.auto = 'ko'; o.failed = lastErr ? lastErr.message : 'Échec'; save(LS.orders, S.orders);
    journalAdd({ type: 'sell', mint: o.mint, symbol: sym, sim: cfg.sim, status: 'err', err: o.failed, sol: 0, tokens: 0, auto: true });
    toast('Vente automatique échouée', sym + ' : ' + o.failed + ' Relancez-la depuis Ordres.', 'r');
    renderAll();
  }
  function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.08; o.start(); setTimeout(() => { o.frequency.value = 660; }, 140); setTimeout(() => { o.stop(); a.close(); }, 300); } catch (e) {} }

  /* ================================================================ rendu global */
  function renderPage() {
    renderTop();
    if (S.page === 'dash' || S.page === 'mine') { renderFees(); feesRead(false); }
    if (S.page === 'dash') renderDash();
    else if (S.page === 'launch') renderLaunch();
    else if (S.page === 'mine') renderMine();
    else if (S.page === 'orders') renderOrders();
    else if (S.page === 'journal') renderJournal();
    else if (S.page === 'social') renderSocial();
    else if (S.page === 'dist') renderDist();
  }
  // changement de mode : on recharge les données du mode (démo ou réel)
  let MODE_SIM = !!cfg.sim;
  function syncModeData() {
    if (!!cfg.sim === MODE_SIM) return; MODE_SIM = !!cfg.sim;
    showModeData();
    S.view.mine = null; S.view.trade = null; DS.mint = '';
  }
  // données affichées : celles de la démo (navigateur) ou celles du compte (mémoire, chargées depuis la base)
  function showModeData() {
    if (cfg.sim) { S.tokens = load(dk(LS.tokens), []); S.orders = load(dk(LS.orders), []); S.journal = load(dk(LS.journal), []); DS.rec = load(dk(LSD), {}); }
    else { S.tokens = REAL.tokens; S.orders = REAL.orders; S.journal = REAL.journal; DS.rec = REAL.dist; }
  }
  function renderAll() { syncModeData(); renderPage(); }
  // ouvre un token dans la page Trader (React) : depuis le portefeuille, la palette de commandes…
  function openTrade(mint) { setPage('trade'); window.dispatchEvent(new CustomEvent('ts-trade', { detail: mint })); }
  function refreshView() { if (S.page === 'mine' && S.view.mine) showToken('mine', S.view.mine); if (S.page === 'trade') window.dispatchEvent(new CustomEvent('ts-trade-refresh')); }

  /* ================================================================ évènements */
  document.addEventListener('click', (e) => { const a = e.target.closest('a[data-distform]'); if (a) { distMark(a.dataset.distform, true); setTimeout(renderDist, 300); } });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button, a[data-px]'); if (!b) return;
    const d = b.dataset;
    if (d.uitheme) return applyUiTheme(d.uitheme, false, null, 'user');
    if (d.uidepth) return applyUiTheme(uiTheme, true, d.uidepth, 'user');
    if (b.id === 'sideTheme') { navOpen(false); return themePicker(); }
    if (d.page) return setPage(d.page);
    if (d.dtok) { setPage('mine'); return typeof showToken === 'function' ? showToken('mine', d.dtok) : null; }
    if (d.fees === 'claim') return claimFees();
    if (d.fees === 'refresh') return feesRead(true);
    if (d.fundset) { const el = $('fundAmt'); if (el) el.value = d.fundset; return; }
    if (d.dist || d.distmark || d.distcp) return distAction(b);
    if (d.cr) return crAction(d.cr);
    if (d.dact === 'radar') { setPage('launch'); return setLaunchTab('radar'); }
    if (d.dmode) { DASH.mode = d.dmode; try { localStorage.setItem('pstudio_dash_mode', d.dmode); } catch (x) {} return renderDash(); }
    if (d.drange) { DASH.range = d.drange; renderDash(); return solHist(true); }
    if (b.id === 'walletBtn' || b.id === 'fileHelp') return walletMenu();
    if (d.sw) return swAction(d.sw);
    if (d.sk) { const el = $('skTxt'); if (!el) return; if (d.sk === 'show') { el.dataset.blur = el.dataset.blur === '1' ? '0' : '1'; b.textContent = el.dataset.blur === '1' ? 'Afficher' : 'Masquer'; } else { try { await navigator.clipboard.writeText(el.textContent); toast('Clé copiée', 'Collez-la dans un endroit sûr, puis effacez le presse-papiers.', 'a'); } catch (e2) {} } return; }
    if (d.act === 'simoff') return goReal();
    if (d.act === 'needacct') { try { window.dispatchEvent(new CustomEvent('ts-need-account', { detail: 'demo' })); } catch (e) {} return; }
    if (d.act === 'simon') return goSim();
    if (d.act === 'testrpc') return testRpc(false);
    if (d.act === 'keyhelp') return keyPanel(d.k === 'pinata' ? 'pinata' : 'helius');
    if (d.act === 'keylater') { cfg.keysLater = true; save(LS.cfg, cfg); renderKeysCard(); toast('Rappel masqué', 'Vous pouvez ajouter la clé à tout moment dans Réglages.', ''); return; }
    if (d.step) { S.step = +d.step; renderLaunch(); return; }
    if (d.theme) { S.draft.theme = d.theme; S.draft.logo.pal = THEMES[d.theme].pal; S.draft.logo.theme = d.theme; S.draft.logo.motif = ''; saveDraft(); genIdeas(); renderLaunch(); const el = $('ideas'); if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30); return; }
    if (d.tone) { S.draft.tone = d.tone; saveDraft(); renderLaunch(); return; }
    if (d.lang) { S.draft.lang = d.lang; saveDraft(); genIdeas(); renderLaunch(); return; }
    if (b.id === 'genGo') { genIdeas(); return; }
    if (b.id === 'autoGo') { autoGenerate(); return; }
    if (d.tpadd) { const last = S.draft.tp[S.draft.tp.length - 1]; S.draft.tp.push({ x: last ? Math.round((last.x * 2) * 10) / 10 : 2, pct: Math.max(1, Math.min(10, 100 - S.draft.tp.reduce((a, l) => a + (l.pct || 0), 0))) }); saveDraft(); renderTpPlan(); renderLaunchSide(); return; }
    if (d.tpdel != null) { S.draft.tp.splice(+d.tpdel, 1); saveDraft(); renderTpPlan(); renderLaunchSide(); return; }
    if (d.tpdef) { S.draft.tp = TP_PRESETS.balanced.tp.map((l) => Object.assign({}, l)); S.draft.sl = TP_PRESETS.balanced.sl; S.draft.slMode = TP_PRESETS.balanced.slMode; saveDraft(); renderTpPlan(); renderLaunchSide(); return; }
    if (d.idea != null) { pickIdea(+d.idea); S.step = 2; renderLaunch(); const st = $('stepper'); if (st) st.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (d.mchar != null || d.mexpr != null || d.macc != null) { const L = S.draft.logo; if (d.mchar != null) L.mchar = d.mchar; if (d.mexpr != null) L.mexpr = d.mexpr; if (d.macc != null) L.macc = d.macc; S.draft.imgSrc = 'gen'; S.imgBlob = null; saveDraft(); renderLaunch(); return; }
    if (d.lstyle) { S.draft.logo.style = d.lstyle; S.draft.logo.seed = Math.floor(Math.random() * 1e6); S.draft.imgSrc = 'gen'; S.imgBlob = null; saveDraft(); renderLaunch(); return; }
    if (d.pal != null) { S.draft.logo.pal = +d.pal; S.draft.imgSrc = 'gen'; S.imgBlob = null; saveDraft(); renderLaunch(); return; }
    if (b.id === 'logoDl') { const a = document.createElement('a'), src = S.draft.image || $('logoCv').toDataURL('image/jpeg', 0.92), ext = (/^data:image\/(\w+)/.exec(src) || [])[1] || 'png'; a.href = src; a.download = (S.draft.symbol || 'logo').toLowerCase() + '.' + (ext === 'jpeg' ? 'jpg' : ext); a.click(); return; }
    if (b.id === 'descRegen') { if (!S.draft.name) return toast('Nom manquant', 'Choisissez d\'abord un nom.', 'a'); S.draft.desc = descFor(S.draft.name, S.draft.symbol, S.draft.name.split(' ').pop()); saveDraft(); fillFields(); renderLaunchSide(); return; }
    if (d.dev != null) { S.draft.dev = +d.dev; saveDraft(); fillFields(); renderLaunchSide(); renderTpPlan(); return; }
    if (b.id === 'launchBtn') return launch();
    if (b.id === 'mineAdd') {
      const i = await modal('Ajouter un token existant', '<div class="field"><label for="addMint">Adresse du token (mint)</label><input id="addMint" style="font-family:var(--mono)" autocomplete="off"></div><p>Le token apparaîtra dans « Mes tokens » pour le suivre et créer des ordres.</p>', [{ label: 'Annuler' }, { label: 'Ajouter', cls: 'primary', keep: true }], true);
      if (i !== 1) return;
      const mint = validMint($('addMint').value || ''); if (!mint) return toast('Adresse invalide', 'Collez l\'adresse complète du token.', 'r');
      closeModal();
      if (S.tokens.some((t) => t.mint === mint)) return showToken('mine', mint);
      let m = { name: '', symbol: '' }; try { m = await tokenMeta(mint); } catch (e2) {}
      S.tokens.push({ mint, name: m.name || 'Token ' + short(mint), symbol: m.symbol || short(mint), image: m.image || '', createdAt: Date.now(), added: true });
      save(LS.tokens, S.tokens); renderAll(); showToken('mine', mint); return;
    }
    if (d.mine) { showToken('mine', d.mine); renderMineList(); return; }
    if (d.unmine) return unMine([d.unmine]);
    if (b.id === 'minePrune') return pruneMine();
    if (d.refresh) { const mint = S.view[d.refresh]; if (mint) { if (S.cache[mint]) S.cache[mint].holdersAt = 0; showToken(d.refresh, mint); } return; }
    if (d.side) { S.side[d.ctx] = d.side; renderTokenView(d.ctx); return; }
    if (d.preset) { const inp = $('amt-' + d.ctx); if (inp) { inp.value = d.preset; updateQuote(d.ctx); } return; }
    if (d.go) { const inp = $('amt-' + d.go); if (!inp || !inp.value.trim()) return toast('Montant manquant', 'Saisissez un montant.', 'a'); return trade(d.mint, S.side[d.go], inp.value.trim()); }
    if (d.copy) { try { await navigator.clipboard.writeText(d.copy); toast('Copié', short(d.copy, 6), 'g'); } catch (e2) {} return; }
    if (d.neworder) return newOrder(d.neworder);
    if (d.otoggle) { const o = S.orders.find((x) => x.id === d.otoggle); if (o) { o.active = !o.active; if (o.active) { o.triggered = null; o.done = false; } save(LS.orders, S.orders); renderAll(); } return; }
    if (d.odel) { const o = S.orders.find((x) => x.id === d.odel); if (o && await confirmBox('Supprimer cet ordre ?', '<p>' + esc(o.symbol) + ' · vendre ' + o.pct + ' %.</p>', 'Supprimer', true)) { S.orders = S.orders.filter((x) => x.id !== d.odel); save(LS.orders, S.orders); renderAll(); } return; }
    if (d.osell) { const o = S.orders.find((x) => x.id === d.osell); if (o) sellOrder(o); return; }
    if (d.jf) { S.jf = d.jf; renderJournal(); return; }
    if (b.id === 'jExport') {
      const rows = S.journal.map((j) => [new Date(j.t).toISOString(), j.type, j.sim ? 'démo' : 'réel', j.symbol, j.mint, j.sol, j.tokens, j.status, j.sig || '', (j.err || '').replace(/[\n,]/g, ' ')]);
      const csv = 'date,operation,mode,symbole,mint,sol,tokens,statut,signature,erreur\n' + rows.map((r) => r.join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'tokenstudio-journal.csv'; a.click(); return;
    }
    if (d.sotone) { soTone = d.sotone; renderSocial(); return; }
    if (d.pcopy != null) { const ta = document.querySelector('[data-post="' + d.pcopy + '"]'); try { await navigator.clipboard.writeText(ta.value); toast('Message copié', '', 'g'); } catch (e2) { ta.select(); } return; }
    if (d.fa) { const fs = b.closest('fieldset'); if (d.fa === 'save') formSave(fs); else formCancel(fs); return; }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (crInput(t)) return;
    const map = { fName: 'name', fDesc: 'desc', fTw: 'tw', fTg: 'tg', fWeb: 'web', fDev: 'dev' };
    if (map[t.id]) { S.draft[map[t.id]] = t.id === 'fDev' ? (num(t.value) || 0) : t.value; saveDraft(); fillFields(); renderLaunchSide(); if (t.id === 'fDev') renderTpPlan(); return; }
    if (t.id === 'fSymbol') { const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (t.value !== v) t.value = v; S.draft.symbol = v; saveDraft(); fillFields(); renderLaunchSide(); if (S.draft.imgSrc !== 'upload' && !S.draft.logo.textCustom) { S.draft.logo.text = v; drawLogo(); } return; }
    if (t.id === 'genWord') { S.draft.word = t.value; saveDraft(); return; }
    if (t.dataset && (t.dataset.tpx != null || t.dataset.tpp != null)) { const i = +(t.dataset.tpx != null ? t.dataset.tpx : t.dataset.tpp), v = num(t.value); if (t.dataset.tpx != null) S.draft.tp[i].x = v || 0; else S.draft.tp[i].pct = v || 0; saveDraft(); renderTpLive(); renderLaunchSide(); return; }
    if (t.id === 'tpSl') { S.draft.sl = num(t.value) || 0; saveDraft(); renderTpLive(); renderLaunchSide(); return; }
    if (t.id === 'logoEmoji') { S.draft.logo.emoji = t.value; S.draft.imgSrc = 'gen'; saveDraft(); drawLogo(); return; }
    if (t.id === 'logoText') { S.draft.logo.text = t.value.toUpperCase(); S.draft.logo.textCustom = true; S.draft.imgSrc = 'gen'; saveDraft(); drawLogo(); return; }
    if (t.id && t.id.startsWith('amt-')) { updateQuote(t.id.slice(4)); return; }
    if (t.dataset && t.dataset.post != null) { updatePost(t); return; }
    const fs = t.closest && t.closest('fieldset[data-form]'); if (fs) fs.classList.toggle('dirty', formDirty(fs));
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'logoFile' || t.id === 'crFile') {
      const f = t.files && t.files[0]; t.value = ''; if (f) importLogo(f);
      return;
    }
    if (t.id === 'soTok' || t.id === 'soNfa') { renderSocial(); return; }
    if (t.id === 'distTok') { DS.mint = t.value; renderDist(); return; }
    if (t.dataset && t.dataset.distsel) { if (t.checked) DS.sel.add(t.dataset.distsel); else DS.sel.delete(t.dataset.distsel); saveSel(); renderDist(); return; }
    if (t.id === 'tpOn') { S.draft.tpOn = t.checked; saveDraft(); renderTpPlan(); renderLaunchSide(); return; }
    if (t.dataset && (t.dataset.tpx != null || t.dataset.tpp != null)) { renderTpPlan(); return; }
    const fs = t.closest && t.closest('fieldset[data-form]'); if (fs) fs.classList.toggle('dirty', formDirty(fs));
  });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal') && $('mRow').hidden === false) { closeModal(); if (modalResolve) modalResolve(-1); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.type === 'password' && $('modal').classList.contains('open')) { const pb = $('mRow').querySelector('.primary, .danger'); if (pb) { e.preventDefault(); pb.click(); } } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal').classList.contains('open') && !$('mRow').hidden) { closeModal(); if (modalResolve) modalResolve(-1); } });

  /* ================================================================ radar des tendances (DexScreener + GeckoTerminal, lecture seule) */
  const RADAR = { rows: [], loading: false, errs: [], at: 0, chain: 'all', theme: '', sort: 'el', sel: null, ideas: [], checks: {} };
  const R_CHAINS = { solana: { n: 'Solana', gt: 'solana' }, base: { n: 'Base', gt: 'base' }, bsc: { n: 'BNB Chain', gt: 'bsc' }, ethereum: { n: 'Ethereum', gt: 'eth' } };
  // Ordre = priorité de détection. th : univers du générateur utilisé pour s'inspirer (null : pas de génération)
  const R_THEMES = [
    { k: 'people', n: 'Personnalités', th: null, re: /\b(trump|elon|musk|biden|kamala|obama|putin|vitalik|tate|kanye|drake|taylor|melania|barron|pope|president|cz)\b/i },
    { k: 'animal', n: 'Animaux', th: 'meme', re: /\b(dog|doge|inu|shib|cat|kitty|meow|frog|pepe|toad|otter|penguin|pengu|monkey|ape|bear|bull|fish|hamster|capy|capybara|hippo|cow|goat|duck|goose|bird|owl|fox|wolf|panda|koala|sloth|seal|whale|shark|bunny|rabbit|mouse|rat|pig|horse|lion|tiger|chicken|snail|turtle|crab|lobster|squirrel|beaver|raccoon|gecko|lizard|dragon|moodeng|pnut)\b/i },
    { k: 'ai', n: 'IA et tech', th: 'tech', re: /\b(ai|agent|agents|agi|gpt|bot|robot|neural|cyber|quantum|compute|gpu|llm|protocol|byte|virtual)\b/i },
    { k: 'space', n: 'Espace', th: 'space', re: /\b(mars|space|star|astro|rocket|galaxy|nova|orbit|alien|ufo|cosmic|planet|comet|moon)\b/i },
    { k: 'meme', n: 'Mèmes internet', th: 'internet', re: /\b(chad|wojak|sigma|based|npc|rizz|aura|cope|gm|wagmi|degen|lol|kek|meme|troll|giga|brain|vibe|cooked|delulu|retard|fart|coin)\b/i },
    { k: 'luxe', n: 'Luxe et argent', th: 'luxe', re: /\b(gold|golden|rich|money|cash|diamond|king|queen|royal|crown|lux|luxury|billion|million|bank|vault)\b/i },
    { k: 'myth', n: 'Mythes et héros', th: 'myth', re: /\b(god|zeus|thor|odin|titan|hero|legend|myth|phoenix|kraken|samurai|ninja|knight|wizard|magic)\b/i },
    { k: 'food', n: 'Nourriture', th: 'food', re: /\b(pizza|burger|taco|sushi|banana|apple|cookie|donut|coffee|tea|milk|cheese|bread|fries|noodle|ramen|candy|cake)\b/i },
  ];
  const R_OTHER = { k: 'other', n: 'Autres', th: 'brand' };
  const rTheme = (k) => R_THEMES.find((t) => t.k === k) || R_OTHER;
  async function rget(url) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
    try { const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  const nnum = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  function rAdd(map, r) {
    if (!r.address) return; const k = r.chain + ':' + r.address.toLowerCase(), o = map.get(k);
    if (!o) { map.set(k, r); return; }
    Object.keys(r).forEach((f) => { if ((o[f] == null || o[f] === '' || (typeof o[f] === 'number' && !isFinite(o[f]))) && r[f] != null && r[f] !== '') o[f] = r[f]; });
    if (r.src && !o.src.includes(r.src)) o.src += ' · ' + r.src;
  }
  function fromGecko(c, p, inc) {
    const a = p.attributes || {}, bid = (((p.relationships || {}).base_token || {}).data || {}).id || '', bt = inc[bid] || {};
    const tx = (a.transactions || {}).h1 || {}, pc = a.price_change_percentage || {}, vol = a.volume_usd || {};
    const img = bt.image_url && !/missing/.test(bt.image_url) ? bt.image_url : '';
    return { chain: c, address: bt.address || bid.split('_').slice(1).join('_'), name: bt.name || String(a.name || '').split(' / ')[0], symbol: bt.symbol || '', image: img, desc: '',
      pc1: nnum(pc.h1), pc24: nnum(pc.h24), v1: nnum(vol.h1), v24: nnum(vol.h24), liq: nnum(a.reserve_in_usd), mcap: nnum(a.market_cap_usd) || nnum(a.fdv_usd),
      b1: nnum(tx.buys), s1: nnum(tx.sells), created: Date.parse(a.pool_created_at) || null, url: 'https://www.geckoterminal.com/' + R_CHAINS[c].gt + '/pools/' + a.address, src: 'GeckoTerminal' };
  }
  function fromDex(c, p, boost) {
    const tx = (p.txns || {}).h1 || {}, pc = p.priceChange || {}, vol = p.volume || {};
    return { chain: c, address: p.baseToken.address, name: p.baseToken.name || '', symbol: p.baseToken.symbol || '', image: (p.info || {}).imageUrl || '', desc: (boost && boost.description) || '',
      pc1: nnum(pc.h1), pc24: nnum(pc.h24), v1: nnum(vol.h1), v24: nnum(vol.h24), liq: nnum((p.liquidity || {}).usd), mcap: nnum(p.marketCap) || nnum(p.fdv),
      b1: nnum(tx.buys), s1: nnum(tx.sells), created: p.pairCreatedAt || null, url: p.url || '', src: 'DexScreener' };
  }
  // Élan 0 à 100 : volume, accélération, hausse, pression acheteuse, jeunesse, activité ; pénalités si liquidité faible
  function rScore(r) {
    const v24 = r.v24 || 0, v1 = r.v1 || 0, acc = v24 > 0 ? v1 * 24 / v24 : 0, tx = (r.b1 || 0) + (r.s1 || 0), br = tx ? (r.b1 || 0) / tx : 0.5;
    const ageH = r.created ? (Date.now() - r.created) / 3.6e6 : null;
    let s = clamp(Math.log10(v24 + 1) / Math.log10(5e6), 0, 1) * 25 + clamp((acc - 0.5) / 2.5, 0, 1) * 20 + clamp((r.pc1 || 0) / 40, 0, 1) * 15 + clamp((r.pc24 || 0) / 300, 0, 1) * 10
      + clamp((br - 0.45) / 0.25, 0, 1) * 10 + (ageH == null ? 3 : ageH < 6 ? 10 : ageH < 24 ? 7 : ageH < 72 ? 4 : 1) + clamp(Math.log10(tx + 1) / 3, 0, 1) * 10;
    const thin = (r.liq || 0) < 10000, conc = r.mcap && r.liq && r.liq / r.mcap < 0.03;
    if (thin) s -= 15; if (conc) s -= 10;
    r.el = Math.round(clamp(s, 0, 100)); r.ageH = ageH; r.acc = acc; r.br = br; r.thin = thin;
    r.theme = (R_THEMES.find((t) => t.re.test(r.name + ' ' + r.symbol + ' ' + (r.desc || ''))) || R_OTHER).k;
    return r;
  }
  async function radarLoad(force) {
    if (RADAR.loading) return;
    if (!force && RADAR.rows.length && Date.now() - RADAR.at < 90000) { renderRadar(); return; }
    RADAR.loading = true; renderRadar();
    const chains = RADAR.chain === 'all' ? Object.keys(R_CHAINS) : [RADAR.chain], map = new Map(), errs = [];
    await Promise.all([
      ...chains.map(async (c) => {
        try {
          const j = await rget('https://api.geckoterminal.com/api/v2/networks/' + R_CHAINS[c].gt + '/trending_pools?include=base_token&page=1');
          const inc = {}; (j.included || []).forEach((x) => { inc[x.id] = x.attributes || {}; });
          (j.data || []).forEach((p) => rAdd(map, fromGecko(c, p, inc)));
        } catch (e) { errs.push('GeckoTerminal (' + R_CHAINS[c].n + ')'); }
      }),
      (async () => {
        try {
          const boosts = await rget('https://api.dexscreener.com/token-boosts/top/v1'), by = {};
          (Array.isArray(boosts) ? boosts : []).forEach((b) => { if (chains.includes(b.chainId)) (by[b.chainId] = by[b.chainId] || []).push(b); });
          await Promise.all(Object.keys(by).map(async (c) => {
            const list = by[c].slice(0, 30), pairs = await rget('https://api.dexscreener.com/tokens/v1/' + c + '/' + list.map((b) => b.tokenAddress).join(',')), best = {};
            (Array.isArray(pairs) ? pairs : []).forEach((p) => { const k = p.baseToken && p.baseToken.address; if (k && (!best[k] || ((p.liquidity || {}).usd || 0) > ((best[k].liquidity || {}).usd || 0))) best[k] = p; });
            list.forEach((b) => { if (best[b.tokenAddress]) rAdd(map, fromDex(c, best[b.tokenAddress], b)); });
          }));
        } catch (e) { errs.push('DexScreener'); }
      })(),
    ]);
    RADAR.rows = [...map.values()].filter((r) => r.name || r.symbol).map(rScore);
    RADAR.errs = errs; RADAR.at = Date.now(); RADAR.loading = false;
    renderRadar();
  }
  function rFiltered() {
    const k = { el: (r) => r.el, vol: (r) => r.v24 || 0, pc1: (r) => r.pc1 == null ? -1e9 : r.pc1, new: (r) => r.created || 0 }[RADAR.sort] || ((r) => r.el);
    return RADAR.rows.filter((r) => !RADAR.theme || r.theme === RADAR.theme).sort((a, b) => k(b) - k(a));
  }
  const fAge = (h) => h == null ? '—' : h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' j';
  const fPctS = (x) => x == null ? '—' : '<span class="' + cls(x) + '">' + (x > 0 ? '+' : '') + fr(x, Math.abs(x) >= 100 ? 0 : 1) + ' %</span>';
  function renderRadar() {
    const el = $('radarBody'); if (!el) return;
    $('rChains').innerHTML = [['all', 'Toutes']].concat(Object.keys(R_CHAINS).map((c) => [c, R_CHAINS[c].n])).map((c) => '<button class="chip ' + (RADAR.chain === c[0] ? 'on' : '') + '" data-rchain="' + c[0] + '" type="button">' + c[1] + '</button>').join('');
    $('rSort').value = RADAR.sort;
    $('rAt').textContent = RADAR.loading ? 'Chargement…' : RADAR.at ? 'Mis à jour à ' + new Date(RADAR.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    // thèmes qui montent
    const T = {}; RADAR.rows.forEach((r) => { const t = T[r.theme] = T[r.theme] || { n: 0, s: 0 }; t.n++; t.s += r.el; });
    const tk = Object.keys(T).sort((a, b) => (T[b].s / T[b].n + T[b].n * 3) - (T[a].s / T[a].n + T[a].n * 3));
    $('rThemes').innerHTML = tk.length ? tk.map((k) => '<button class="rtheme' + (RADAR.theme === k ? ' on' : '') + '" data-rth="' + k + '" type="button"><b>' + esc(rTheme(k).n) + '</b><span>' + T[k].n + ' token' + (T[k].n > 1 ? 's' : '') + ' · élan moyen ' + Math.round(T[k].s / T[k].n) + '</span></button>').join('') : '';
    $('rThemesWrap').hidden = !tk.length;
    renderRadarInspire();
    if (RADAR.loading && !RADAR.rows.length) { el.innerHTML = '<div class="empty"><b>Lecture des marchés…</b>DexScreener et GeckoTerminal, sur ' + (RADAR.chain === 'all' ? 'quatre blockchains' : R_CHAINS[RADAR.chain].n) + '.</div>'; return; }
    if (!RADAR.rows.length) {
      el.innerHTML = '<div class="empty"><b>' + (RADAR.errs.length ? 'Sources injoignables' : 'Aucun token pour l\'instant') + '</b>' + (RADAR.errs.length ? 'Impossible de joindre ' + esc(RADAR.errs.join(', ')) + '. Vérifiez votre connexion, ou désactivez un bloqueur de publicité qui filtrerait ces sites, puis réessayez.' : 'Aucun token tendance trouvé sur cette sélection.') + '<div style="margin-top:12px"><button class="btn sm" data-rload="1" type="button">Réessayer</button></div></div>';
      return;
    }
    const rows = rFiltered();
    el.innerHTML = (RADAR.errs.length ? '<div class="notice">Source partielle : ' + esc(RADAR.errs.join(', ')) + ' n\'a pas répondu. Les autres données sont affichées.</div>' : '') +
      '<div class="tablebox"><table class="rtable"><thead><tr><th>Token</th><th>Élan</th><th>Thème</th><th class="num">1 h</th><th class="num">24 h</th><th class="num">Volume 24 h</th><th class="num">Liquidité</th><th class="num">Âge</th><th></th></tr></thead><tbody>' +
      rows.map((r) => { const i = RADAR.rows.indexOf(r), t = rTheme(r.theme);
        return '<tr class="' + (RADAR.sel === i ? 'selrow' : '') + '"><td><div class="tk"><div class="av">' + (r.image ? '<img src="' + esc(r.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : esc((r.symbol || '?').slice(0, 3))) + '</div><div class="nm"><b>' + esc(r.name || r.symbol) + '</b><small>$' + esc(r.symbol) + ' · ' + R_CHAINS[r.chain].n + '</small></div></div></td>' +
          '<td><div class="rel"><div class="bar"><i style="width:' + r.el + '%;background:' + (r.el >= 70 ? 'var(--green)' : r.el >= 45 ? 'var(--amber)' : 'var(--dim)') + '"></i></div><span class="mono">' + r.el + '</span></div>' + (r.thin ? '<small class="warn">liquidité faible</small>' : '') + '</td>' +
          '<td><span class="badge ' + (t.th ? 'v' : 'a') + '">' + esc(t.n) + '</span></td>' +
          '<td class="num">' + fPctS(r.pc1) + '</td><td class="num">' + fPctS(r.pc24) + '</td><td class="num">' + fUsd(r.v24) + '</td><td class="num">' + fUsd(r.liq) + '</td><td class="num">' + fAge(r.ageH) + '</td>' +
          '<td><div class="oa"><button class="btn sm' + (t.th ? ' primary' : '') + '" data-rins="' + i + '" type="button"' + (t.th ? '' : ' disabled title="Thème lié à des personnes réelles : pas de génération"') + '>S\'inspirer</button>' + (r.url ? '<a class="btn sm ghost" href="' + esc(r.url) + '" target="_blank" rel="noopener" title="Ouvrir sur ' + esc(r.src.split(' · ')[0]) + '">↗</a>' : '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div><p class="tp-note">Élan : volume, accélération sur 1 h, hausse du prix, part d\'achats, jeunesse et activité, pénalisé si la liquidité est faible. Un score élevé dit qu\'un thème attire l\'attention, pas qu\'un nouveau token se vendra.</p>';
  }
  // Similarité 0..1 entre deux noms (distance d'édition normalisée)
  function simil(a, b) {
    a = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, ''); b = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!a || !b) return 0; if (a === b) return 1;
    const m = a.length, n = b.length, d = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= n; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
    return 1 - d[n] / Math.max(m, n);
  }
  function closest(name, ticker) {
    let best = { s: 0, r: null };
    RADAR.rows.forEach((r) => { const s = Math.max(simil(name, r.name), simil(ticker, r.symbol), simil(name, r.symbol)); if (s > best.s) best = { s, r }; });
    return best;
  }
  function radarInspire(i) {
    const r = RADAR.rows[i]; if (!r) return; const t = rTheme(r.theme); if (!t.th) return;
    RADAR.sel = i; const th = THEMES[t.th] || THEMES.brand;
    RADAR.ideas = makeIdeas(th, '', 6, (name, ticker) => { const c = closest(name, ticker); return c.s >= 0.72 || RADAR.rows.some((x) => (x.symbol || '').toUpperCase() === ticker); })
      .map((x) => Object.assign(x, { near: closest(x.name, x.ticker), th: t.th }));
    RADAR.ideas.forEach((x) => { checkTicker(x.ticker); });
    renderRadar();
    const p = $('rInspire'); if (p && p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Ticker déjà utilisé ? Recherche DexScreener, toutes blockchains
  async function checkTicker(tk) {
    if (RADAR.checks[tk]) return; RADAR.checks[tk] = { st: 'run' };
    try {
      const j = await rget('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(tk)), seen = new Set();
      (j.pairs || []).forEach((p) => { if (p.baseToken && String(p.baseToken.symbol).toUpperCase() === tk) seen.add(p.chainId + ':' + p.baseToken.address); });
      RADAR.checks[tk] = { st: 'ok', n: seen.size };
    } catch (e) { RADAR.checks[tk] = { st: 'err' }; }
    renderRadarInspire();
  }
  function renderRadarInspire() {
    const el = $('rInspire'); if (!el) return;
    const r = RADAR.rows[RADAR.sel]; if (!r || !RADAR.ideas.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false; const t = rTheme(r.theme);
    el.innerHTML = '<div class="card-h"><h3>Concepts originaux · ' + esc(t.n) + '</h3><button class="btn sm ghost" data-rclose="1" type="button" style="margin-left:auto">Fermer</button><p>Inspirés du thème de <b>' + esc(r.name || r.symbol) + '</b> ($' + esc(r.symbol) + '), sans reprendre son nom, son ticker, son logo ni ses liens. Cliquez sur un concept pour l\'ouvrir dans le studio.</p></div>' +
      '<div class="ideas">' + RADAR.ideas.map((x, i) => {
        const ck = RADAR.checks[x.ticker] || {}, near = x.near, pc = Math.round(near.s * 100);
        const tkb = ck.st === 'ok' ? (ck.n ? '<span class="badge a">$' + esc(x.ticker) + ' déjà utilisé ×' + ck.n + '</span>' : '<span class="badge g">Ticker libre</span>') : ck.st === 'err' ? '<span class="badge">Ticker non vérifié</span>' : '<span class="badge">Vérification…</span>';
        return '<button class="idea" data-ridea="' + i + '" type="button"><div class="h"><img class="idea-logo" alt="" src="' + (x.logo || (x.logo = ideaLogo(x))) + '"><b>' + esc(x.name) + '</b><span class="sc ' + (x.score >= 80 ? 'pos' : x.score >= 60 ? 'warn' : 'neg') + '">' + x.score + '</span></div><span class="tk-l">$' + esc(x.ticker) + '</span><small>' + esc(x.tag) + '</small><div class="why-score">' + tkb + '<span class="' + (pc < 50 ? 'p' : '') + '">Originalité ' + (100 - pc) + ' %' + (near.r && pc >= 35 ? ' · proche de ' + esc(near.r.symbol || near.r.name) : '') + '</span></div></button>';
      }).join('') + '</div><div class="toolbar" style="margin:12px 0 0"><button class="btn sm" data-rins="' + RADAR.sel + '" type="button">Autres concepts</button></div>';
  }
  function radarUse(i) {
    const x = RADAR.ideas[i]; if (!x) return;
    S.draft.theme = x.th; S.ideas = RADAR.ideas.slice(); pickIdea(i, true);
    S.draft.logo.style = rnd(['mono', 'coin', 'orb', 'shield', 'hex', 'glass']); S.draft.logo.seed = Math.floor(Math.random() * 1e6); saveDraft();
    setLaunchTab('studio'); S.step = 2; renderLaunch(); window.scrollTo(0, 0);
    toast('Concept repris', x.name + ' · $' + x.ticker + '. Choisissez le logo, puis vérifiez la description.', 'g');
  }
  function setLaunchTab(tab) {
    S.ltab = tab === 'radar' || tab === 'create' ? tab : 'studio';
    try { localStorage.setItem('pstudio_ltab', S.ltab); } catch (e) {}
    $('lt-studio').hidden = S.ltab !== 'studio'; $('lt-radar').hidden = S.ltab !== 'radar'; $('lt-create').hidden = S.ltab !== 'create';
    document.querySelectorAll('#launchTabs [data-ltab]').forEach((b) => { b.classList.toggle('on', b.dataset.ltab === S.ltab); b.setAttribute('aria-selected', b.dataset.ltab === S.ltab); });
    if (S.ltab === 'radar') radarLoad(false);
    if (S.ltab === 'create') renderCreate();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.ltab) return setLaunchTab(d.ltab);
    if (d.rchain) { RADAR.chain = d.rchain; RADAR.theme = ''; RADAR.sel = null; RADAR.ideas = []; return radarLoad(true); }
    if (d.rth) { RADAR.theme = RADAR.theme === d.rth ? '' : d.rth; return renderRadar(); }
    if (d.rload) return radarLoad(true);
    if (d.rins != null) return radarInspire(+d.rins);
    if (d.ridea != null) return radarUse(+d.ridea);
    if (d.rclose) { RADAR.sel = null; RADAR.ideas = []; return renderRadar(); }
  });
  $('rSort').addEventListener('change', (e) => { RADAR.sort = e.target.value; renderRadar(); });
  try { const lt = localStorage.getItem('pstudio_ltab'); S.ltab = lt === 'radar' || lt === 'create' ? lt : 'studio'; } catch (e) { S.ltab = 'studio'; }


  /* ================================================================ carte wallet (barre latérale, menu mobile, puce mobile) */
  function idGrad(pk) {
    let h = 2166136261; for (const ch of String(pk || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const a = h % 360, b = (a + 40 + (h >> 9) % 80) % 360;
    return 'linear-gradient(135deg,hsl(' + a + ' 70% 62%),hsl(' + b + ' 65% 42%))';
  }
  const wAv = (pk, cls) => '<span class="wav ' + (cls || '') + '" style="background:' + idGrad(pk) + '" aria-hidden="true"></span>';
  const WI = {
    fund: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    withdraw: '<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    lock: '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
    unlock: '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/></svg>',
    gear: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    copy: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
    plug: '<svg class="i" viewBox="0 0 24 24"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0zM12 16v5"/></svg>',
    bolt: '<svg class="i" viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z"/></svg>',
  };
  const wAct = (sw, ic, label, cls) => '<button class="wact ' + (cls || '') + '" data-sw="' + sw + '" type="button">' + WI[ic] + '<span>' + label + '</span></button>';
  function renderWalletCard() {
    const el = $('sideWallet'); if (!el) return;
    const w = S.wallet, ses = w && w.id === 'session';
    if (!w) {
      el.innerHTML = '<div class="sw sw-empty"><div class="sw-top">' + '<span class="wav none" aria-hidden="true">' + WI.plug + '</span><div class="sw-id"><b>Aucun wallet</b><small>Connectez Phantom ou utilisez le wallet rapide</small></div></div>' +
        '<div class="sw-act two">' + wAct('connect', 'plug', 'Connecter', 'primary') + wAct('panel', 'bolt', 'Wallet rapide') + '</div></div>';
    } else {
      const locked = ses && !SESSW.kp;
      const st = ses ? (locked ? ['lock', 'verrouillé'] : ['ok', 'actif']) : ['ext', 'signe avec ' + esc(w.name)];
      el.innerHTML = '<div class="sw' + (ses ? ' fast' : '') + '"><div class="sw-top"><span class="wav-w" title="' + st[1] + '">' + wAv(w.pk) + '<i class="wdot ' + st[0] + '"></i></span>' +
        '<div class="sw-id"><b>' + (ses ? 'Wallet rapide' : esc(w.name)) + '</b><button class="sw-addr" data-sw="copyaddr" type="button" title="Copier l\'adresse">' + short(w.pk, 4) + WI.copy + '</button></div></div>' +
        '<div class="sw-bal">' + (S.bal == null ? '<b class="mono">—</b><em>SOL</em></div><div class="sw-usd">solde en cours de lecture</div>' : '<span class="sol stack" data-sol="' + S.bal + '" style="font-size:26px"><b class="mono">' + fr(S.bal, S.bal >= 100 ? 2 : 4) + '</b><em style="margin-left:7px">SOL</em></span></div>') +
        '<div class="sw-act">' + (ses ? wAct('fund', 'fund', 'Dépôt') + wAct('withdraw', 'withdraw', 'Retrait') + (locked ? wAct('unlock', 'unlock', 'Ouvrir', 'primary') : wAct('lock', 'lock', 'Bloquer')) : wAct('copyaddr', 'copy', 'Copier')) + wAct('panel', 'gear', 'Gérer') + '</div></div>';
    }
    const mw = $('mWallet'); // ancien bouton mobile, remplacé par le menu de compte
    if (mw) mw.innerHTML = w ? wAv(w.pk, 'sm') + '<span class="mono">' + (S.bal == null ? '—' : fr(S.bal, S.bal >= 100 ? 1 : 3)) + '</span>' : WI.plug + '<span>Wallet</span>';
  }

  /* ================================================================ navigation : tiroir mobile, rail réductible */
  const APP = document.querySelector('.app');
  function navOpen(on) {
    if (!APP) return; const was = APP.classList.contains('nav-open'); if (was === !!on) return;
    APP.classList.toggle('nav-open', !!on); document.body.style.overflow = on ? 'hidden' : '';
    const mb = $('menuBtn'); if (mb) mb.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { const f = $('sideClose'); if (f) setTimeout(() => f.focus(), 50); }
  }
  document.querySelectorAll('#menu button[data-page]').forEach((b) => {
    [...b.childNodes].forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) { const sp = document.createElement('span'); sp.className = 'ml'; sp.textContent = n.textContent; b.replaceChild(sp, n); b.title = n.textContent.trim(); } });
  });
  document.querySelectorAll('#menu .menu-label').forEach((l) => l.insertAdjacentHTML('beforebegin', '<div class="menu-sep" aria-hidden="true"></div>'));
  try { if (localStorage.getItem('pstudio_sidemin') === '1') APP.classList.add('side-min'); } catch (e) {}
  $('sideCol').addEventListener('click', () => { const on = !APP.classList.contains('side-min'); APP.classList.toggle('side-min', on); $('sideCol').title = on ? 'Agrandir le menu' : 'Réduire le menu'; try { localStorage.setItem('pstudio_sidemin', on ? '1' : '0'); } catch (e) {} });
  $('menuBtn').addEventListener('click', () => navOpen(true));
  $('bnavMore').addEventListener('click', () => navOpen(true));
  $('sideClose').addEventListener('click', () => navOpen(false));
  $('scrim').addEventListener('click', () => navOpen(false));
  $('mSearch').addEventListener('click', () => $('cmdkBtn').click());
  { const mw = $('mWallet'); if (mw) mw.addEventListener('click', () => navOpen(true)); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && APP.classList.contains('nav-open')) navOpen(false); });
  document.addEventListener('click', (e) => { if (e.target.closest('#side [data-sc], #side [data-sw], #side .cmdk')) navOpen(false); });
  // balayage vers la gauche pour fermer le tiroir
  let swX = null; $('side').addEventListener('touchstart', (e) => { swX = e.touches[0].clientX; }, { passive: true });
  $('side').addEventListener('touchend', (e) => { if (swX != null && e.changedTouches[0].clientX - swX < -60) navOpen(false); swX = null; }, { passive: true });

  /* ================================================================ palette de commandes (Ctrl K) */
  const PAL = { open: false, items: [], sel: 0 };
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const navIcon = (p) => { const b = document.querySelector('#menu button[data-page="' + p + '"] svg'); return b ? b.outerHTML : ''; };
  const IC = {
    spark: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l2.1 4.9L19 10l-4.9 2.1L12 17l-2.1-4.9L5 10l4.9-2.1z"/></svg>',
    wallet: '<svg class="i" viewBox="0 0 24 24"><path d="M20 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h13a2 2 0 002-2v-2"/><path d="M22 11h-6a2 2 0 000 4h6v-4z"/></svg>',
    plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    down: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v12M6 10l6 6 6-6M5 20h14"/></svg>',
    pulse: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
    shield: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/></svg>',
    search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  };
  const clickWhenReady = (id) => setTimeout(() => { const el = $(id); if (el) el.click(); }, 0);
  function palCommands(q) {
    const out = [];
    const raw = q.trim();
    if (raw.length >= 32 && !/\s/.test(raw)) {
      const mint = validMint(raw);
      if (mint) out.push({ g: 'Token', ic: IC.search, label: 'Analyser ce token', hint: short(mint, 6), run: () => openTrade(mint) });
    }
    Object.keys(PAGES).forEach((p) => out.push({ g: 'Aller à', ic: navIcon(p), label: PAGES[p][0], hint: PAGES[p][1], kw: p, run: () => setPage(p) }));
    out.push(
      { g: 'Actions', ic: IC.pulse, label: 'Ouvrir le Radar des tendances', hint: 'tokens qui prennent de l\'élan', kw: 'radar tendance trend dexscreener', run: () => { setPage('launch'); setLaunchTab('radar'); } },
      { g: 'Actions', ic: IC.spark, label: 'Tout générer automatiquement', hint: 'nom, ticker, logo, description', kw: 'auto concept idee', run: () => { setPage('launch'); setLaunchTab('studio'); clickWhenReady('autoGo'); } },
      { g: 'Actions', ic: IC.spark, label: 'Générer de nouvelles idées', hint: 'étape Concept', kw: 'idee nom ticker', run: () => { S.step = 1; setPage('launch'); clickWhenReady('genGo'); } },
      { g: 'Actions', ic: IC.wallet, label: S.wallet ? 'Gérer le wallet' : 'Connecter le wallet', hint: S.wallet ? short(S.wallet.pk) : 'Phantom, Solflare, Backpack, wallet rapide', kw: 'phantom compte', run: () => walletMenu() },
      { g: 'Actions', ic: IC.plus, label: 'Ajouter un token existant', hint: 'Mes tokens', kw: 'suivre mint', run: () => { setPage('mine'); clickWhenReady('mineAdd'); } },
      { g: 'Actions', ic: IC.down, label: 'Exporter le journal en CSV', hint: 'Journal', kw: 'export historique', run: () => { setPage('journal'); clickWhenReady('jExport'); } },
      { g: 'Actions', ic: IC.pulse, label: 'Tester la connexion RPC', hint: S.rpcOk ? 'connecté' : S.rpcOk === false ? 'en erreur' : 'non testé', kw: 'solana helius reseau', run: () => testRpc(false) },
      // le passage en réel est proposé en démo ; le retour en démo se fait depuis le menu du compte
      ...(cfg.sim ? [{ g: 'Actions', ic: IC.shield, label: cfg.sim ? 'Passer en mode réel' : 'Revenir en démo', hint: cfg.sim ? 'demande confirmation' : 'plus rien n\'est envoyé', kw: 'simulation reel mode', run: () => { const b = document.querySelector('#simbar [data-act]'); if (b) b.click(); } }] : []),
    );
    const words = norm(raw).split(/\s+/).filter(Boolean);
    if (!words.length) return out;
    return out.filter((c) => c.g === 'Token' || words.every((w) => norm(c.label + ' ' + c.hint + ' ' + (c.kw || '') + ' ' + c.g).includes(w)));
  }
  function palRender() {
    const L = $('palList'); PAL.items = palCommands($('palQ').value);
    PAL.sel = clamp(PAL.sel, 0, Math.max(0, PAL.items.length - 1));
    if (!PAL.items.length) { L.innerHTML = '<div class="pal-empty">Aucune commande ne correspond. Collez une adresse de token complète pour l\'analyser.</div>'; return; }
    let g = '', h = '';
    PAL.items.forEach((c, i) => {
      if (c.g !== g) { g = c.g; h += '<div class="pal-grp">' + esc(g) + '</div>'; }
      h += '<button class="pal-it' + (i === PAL.sel ? ' on' : '') + '" type="button" role="option" aria-selected="' + (i === PAL.sel) + '" data-pal-i="' + i + '">' + c.ic + '<span>' + esc(c.label) + '</span><small>' + esc(c.hint || '') + '</small></button>';
    });
    L.innerHTML = h;
    const on = L.querySelector('.pal-it.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function palOpen() { if ($('modal').classList.contains('open')) return; PAL.open = true; PAL.sel = 0; $('pal').hidden = false; $('palQ').value = ''; palRender(); $('palQ').focus(); }
  function palClose() { PAL.open = false; $('pal').hidden = true; }
  function palRun(i) { const c = PAL.items[i]; if (!c) return; palClose(); c.run(); }
  $('palQ').addEventListener('input', () => { PAL.sel = 0; palRender(); });
  $('palList').addEventListener('click', (e) => { const b = e.target.closest('[data-pal-i]'); if (b) palRun(+b.dataset.palI); });
  $('palList').addEventListener('mousemove', (e) => { const b = e.target.closest('[data-pal-i]'); if (b && +b.dataset.palI !== PAL.sel) { PAL.sel = +b.dataset.palI; palRender(); } });
  $('pal').addEventListener('mousedown', (e) => { if (e.target === $('pal')) palClose(); });
  $('cmdkBtn').addEventListener('click', palOpen);
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-sc="wallet"]'); if (b) walletMenu(); });
  document.addEventListener('keydown', (e) => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); PAL.open ? palClose() : palOpen(); return; }
    if (!PAL.open) { if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); palOpen(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); palClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); PAL.sel = (PAL.sel + 1) % Math.max(1, PAL.items.length); palRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); PAL.sel = (PAL.sel - 1 + PAL.items.length) % Math.max(1, PAL.items.length); palRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); palRun(PAL.sel); }
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform || '')) { const k = document.querySelector('#cmdkBtn kbd'); if (k) k.textContent = '⌘ K'; }

  /* ================================================================ démarrage */
  function libReady() { return !!(window.solanaWeb3 && window.solanaWeb3.PublicKey && window.PumpKit); }
  async function boot() {
    if (!libReady()) {
      document.querySelector('.main').insertAdjacentHTML('afterbegin', '<div class="notice bad">La bibliothèque Solana n\'a pas pu être chargée (connexion internet ?). Rechargez la page.</div>');
      return;
    }
    setFormsHtml();
    const p = localStorage.getItem('pstudio_page'); if (p && PAGES[p] && p !== 'settings') S.page = p;
    setPage(S.page);
    await solPrice(); renderTop();
    testRpc(true);
    const last = load(LS.wallet, null), pv = providers().find((x) => x.id === last); if (pv) connectWallet(pv, true);
    if (cfg.useSess && SESSREC) { refreshBal(); if (S.orders.some((o) => o.active)) toast('Wallet rapide verrouillé', 'Des ordres sont actifs : déverrouillez-le pour qu\'ils s\'exécutent seuls.', 'a'); }
    setInterval(solPrice, 60000);
    setInterval(refreshBal, 30000);
    let tick = 0;
    setInterval(() => {
      tick++;
      if (S.busy || $('modal').classList.contains('open')) return;
      if (document.hidden) { if (tick % 4 === 0) watchOrders().catch(() => {}); return; } // onglet en arrière-plan : les ordres restent surveillés
      if (tick % Math.max(1, Math.round(cfg.pollSec / 5)) === 0) {
        const ctx = S.page === 'mine' ? 'mine' : null;   // la page Trader (React) a ses propres actualisations
        if (ctx && S.view[ctx]) loadToken(S.view[ctx], true).then(() => renderTokenView(ctx)).catch(() => {});
        if (S.page === 'mine') S.tokens.forEach((t) => { if (t.mint !== S.view.mine && (!S.cache[t.mint] || Date.now() - S.cache[t.mint].at > 60000)) loadToken(t.mint, false).then(() => { if (S.page === 'mine') renderMineList(); }).catch(() => {}); });
      }
      if (tick % 4 === 0) watchOrders().catch(() => {});
      if (S.page === 'dash') { dashTokens(); renderDash(); }
      const keep = new Set(S.orders.filter((o) => o.active && !isDemoMint(o.mint)).map((o) => o.mint)); if (S.page === 'mine' && S.view.mine && !isDemoMint(S.view.mine)) keep.add(S.view.mine);
      keep.forEach((m) => { if (!S.cache[m]) loadToken(m, false).catch(() => {}); });
      liveKeep(keep); ppSync(liveSet());
      if (tick % 4 === 1) prefetch();
    }, 5000);
    window.addEventListener('resize', () => { if (S.page === 'dash') renderDash(); }); window.addEventListener('pstudio-theme', () => { if (S.page === 'dash') renderDash(); });
    window.addEventListener('resize', () => { ['mine', 'trade'].forEach((c) => { document.querySelectorAll('#' + (c === 'mine' ? 'mineDetail' : 'tradeDetail') + ' canvas.pchart').forEach((cv) => drawPriceChart(cv, S.cache[cv.dataset.mint] || {})); }); });
  }
  window.PumpStudio = { PP, S, cfg, setPage, openPanel, openTrade,
    toast: (t, x, k) => toast(t, x, k), confirm: (t, x, ok, danger) => confirmBox(t, '<p>' + esc(x) + '</p>', ok, danger),
    // flux en direct pour la page Trader : abonnements aux transactions des tokens affichés et aux nouveaux tokens
    live: {
      watch: (mints) => { PPX.mints = new Set((mints || []).filter((m) => typeof m === 'string' && !isDemoMint(m)).slice(0, 60)); ppSync(liveSet()); },
      news: (on) => { PPX.news = !!on; ppSync(liveSet()); },
      on: (fn) => { PPX.fns.add(fn); return () => PPX.fns.delete(fn); },
      state: () => ({ on: !!cfg.ppLive, state: PP.state, last: PP.last }),
    },
    solUsd: () => S.solUsd,
    // panneau de trading de la page Trader : réglages, devis sur la courbe, position, ordres
    trader: {
      settings: () => ({ slippage: cfg.slippage, priorityFee: cfg.priorityFee, maxSol: cfg.maxSol, sim: !!cfg.sim, wallet: !!S.wallet, bal: cfg.sim ? DEMO.bal : S.bal, busy: !!S.busy }),
      set: (p) => {
        const ok = {};
        if (p && +p.slippage >= 1 && +p.slippage <= 50) ok.slippage = +p.slippage;
        if (p && +p.priorityFee >= 0 && +p.priorityFee <= 0.01) ok.priorityFee = +p.priorityFee;
        Object.assign(cfg, ok); save(LS.cfg, cfg);
      },
      quote: (mint, side, amount) => {
        const C = S.cache[mint], c = C && C.curve;
        if (!c || !c.exists || c.complete || c.ext || !(amount > 0)) return null;
        return side === 'buy' ? quoteBuy(c, amount) : quoteSell(c, amount);
      },
      position: (mint) => { const C = S.cache[mint]; return C && C.stats ? Object.assign(myPosition(mint, C), { price: C.stats.price }) : null; },
      newOrder: (mint) => newOrder(mint),
    },
    SESSW, sessUnlock, autoSell, canAuto, walletPanel, b58, isSim: () => !!cfg.sim, tpValid, autoGenerate, directTrade, directCreate, pumpGlobal, quoteBuy, quoteSell, curveStats, readCurve, loadToken, trade, launch, genIdeas, readiness, INIT_CURVE,
    // Menu de compte (React) : état du wallet et du mode, et actions associées
    hub: {
      state: () => {
        const w = S.wallet, ses = !!(w && w.id === 'session');
        return { wallet: w ? { name: ses ? 'Wallet rapide' : w.name, pk: w.pk, session: ses, locked: ses && !SESSW.kp } : null,
          ext: S.ext ? { id: S.ext.id, name: S.ext.name, pk: S.ext.pk, bal: ses ? S.extBal : S.bal } : null,
          // après une déconnexion, le wallet rapide reste chiffré dans ce navigateur mais n'est plus affiché ni utilisé
          quick: null,   // l'ancien wallet rapide du navigateur n'est plus utilisé (voir quickSaved pour le transférer)
          quickSaved: SESSREC ? { pk: SESSREC.pk, unlocked: !!SESSW.kp } : null,
          srv: SRVPK ? { pk: SRVPK, active: !!(w && w.id === 'server'), bal: w && w.id === 'server' ? S.bal : null } : null,
          hasSession: !!SESSREC, bal: S.bal, solUsd: S.solUsd, sim: !!cfg.sim, rpcOk: S.rpcOk, theme: uiTheme, depth: uiDepth,
          demo: { bal: DEMO.bal, positions: Object.values(DEMO.pos).filter((x) => x > 0).length } };
      },
      connect: async (id) => { const pv = providers().find((x) => x.id === id); return pv ? connectWallet(pv) : null; },
      quickCreate: async () => { try { window.dispatchEvent(new CustomEvent('ts-srv', { detail: 'create' })); } catch (e) {} return undefined; },
      quickRestore: async () => { try { window.dispatchEvent(new CustomEvent('ts-srv', { detail: 'create' })); } catch (e) {} return undefined; },
      legacyMigrate: () => legacyMigrate(),
      legacyExport: () => sessExport(),
      legacyForget: () => sessDelete(),
      legacyDrop: () => { try { localStorage.removeItem(LS.sess); } catch (e) {} SESSREC = null; SESSW.kp = null; cfg.useSess = false; save(LS.cfg, cfg); renderAll(); },
      quickUnlock: () => sessUnlock(),
      quickLock: () => { if (!SESSW.kp) return; SESSW.kp = null; toast('Wallet rapide verrouillé', 'Ventes automatiques en pause.', ''); renderAll(); },
      quickKeypair: () => SESSW.kp,
      useQuick: async (on) => { if (on && !SESSREC) return; if (!on && !S.ext && !SRVPK) return; cfg.useSess = !!on; if (on) { cfg.useSrv = false; cfg.quickOff = false; } save(LS.cfg, cfg); S.bal = null; await refreshBal(); renderAll(); },
      useServer: async (on) => { if (on && !SRVPK) return; cfg.useSrv = !!on; if (on) cfg.useSess = false; save(LS.cfg, cfg); S.bal = null; await refreshBal(); renderAll(); },
      setServer: (pk) => { if (SRVPK === pk) return; SRVPK = pk || null; S.bal = null; refreshBal().catch(() => {}); renderAll(); },
      useExt: async () => { cfg.useSess = false; cfg.useSrv = false; save(LS.cfg, cfg); S.bal = null; await refreshBal(); renderAll(); },
      setAuth,
      authed: () => AUTH === true,
      demoReset: async () => {
        if (!(await confirmBox('Réinitialiser la démo ?', '<p>Le wallet démo revient à 10 SOL fictifs. Vos tokens démo, leurs ordres et l\'historique démo sont effacés.</p>', 'Réinitialiser', true))) return;
        DEMO.bal = 10; DEMO.pos = {}; demoSave(); DM.tok = {}; dmSave();
        ['pstudio_demo_tokens_v1', 'pstudio_demo_orders_v1', 'pstudio_demo_journal_v1', 'pstudio_demo_dist_v1'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
        if (cfg.sim) { S.tokens = []; S.orders = []; S.journal = []; DS.rec = {}; S.view.mine = null; S.view.trade = null; }
        toast('Démo réinitialisée', 'Wallet démo : 10 SOL fictifs.', 'g'); renderAll();
      },
      demoInfo: () => {
        dmRun();
        const hold = Object.keys(DEMO.pos).filter((m) => DEMO.pos[m] > 0).map((m) => {
          const T = DM.tok[m], C = S.cache[m], st = T ? curveStats(dmCurve(T)) : C && C.stats;
          return { mint: m, symbol: T ? T.symbol : (C && C.meta && C.meta.symbol) || short(m), image: T ? T.image || '' : (C && C.meta && C.meta.image) || '', amount: DEMO.pos[m], sol: st && st.price ? st.price * DEMO.pos[m] : null, demo: !!T };
        }).sort((a, b) => (b.sol || 0) - (a.sol || 0));
        const acts = (cfg.sim ? S.journal : load('pstudio_demo_journal_v1', [])).slice(0, 15).map((j) => ({ t: j.t, type: j.type, symbol: j.symbol || '', sol: j.sol || 0, tokens: j.tokens || 0 }));
        return { addr: DEMO.addr, bal: DEMO.bal, solUsd: S.solUsd, hold, acts };
      },
      demoMove: (kind) => demoMove(kind),
      avatar: (pk, cls) => wAv(pk, cls),
      walletMenu: () => walletMenu(),
      walletPanel: () => walletPanel(),
      disconnect: () => disconnectWallet(false),
      // déconnexion du compte : plus aucun wallet affiché ni actif (extension déconnectée, wallet rapide verrouillé et mis de côté)
      signOut: async () => {
        await disconnectWallet(false);
        SESSW.kp = null; cfg.useSess = false; cfg.useSrv = false; cfg.quickOff = !!SESSREC; save(LS.cfg, cfg);
        S.bal = null; renderAll();
      },
      walletAction: (a) => swAction(a),
      rpc: (method, params) => rpc(method, params),
      page: () => S.page,
      copyAddress: async () => { const pk = S.wallet && S.wallet.pk; if (!pk) return; try { await navigator.clipboard.writeText(pk); toast('Adresse copiée', short(pk, 6), 'g'); } catch (e) {} },
      appearance: () => themePicker(),
      goReal, goSim,
    },
    // Données synchronisées avec le compte : export de l'état local, et fusion de celles du serveur
    // Données du compte : chargées depuis la base par l'application, écrites dans la base à chaque changement
    data: {
      setCloud: (h) => { CLOUD = h || null; },
      // données du compte chargées : elles remplacent l'affichage réel (sans être renvoyées au compte)
      loadReal: (x) => {
        REAL.tokens = x.tokens || []; REAL.journal = x.journal || []; REAL.orders = x.orders || []; REAL.dist = x.dist || {};
        if (!cfg.sim) { showModeData(); S.view.mine = null; S.view.trade = null; }
        if (x.draft) { REMOTE_APPLY = true; try { S.draft = Object.assign(draftDefaults(), x.draft); } finally { REMOTE_APPLY = false; } }
        renderAll();
      },
      // une table modifiée ailleurs (autre appareil) : remplacée sans être renvoyée
      replaceReal: (kind, v) => { if (!(kind in REAL)) return; REAL[kind] = v; if (!cfg.sim) showModeData(); renderAll(); },
      // déconnexion : plus aucune donnée du compte dans l'outil
      clearReal: () => {
        REAL.tokens = []; REAL.journal = []; REAL.orders = []; REAL.dist = {};
        if (!cfg.sim) { showModeData(); S.view.mine = null; S.view.trade = null; }
        S.draft = draftDefaults(); try { localStorage.removeItem(LS.draft); } catch (e) {}
        renderAll();
      },
      draft: () => S.draft,
      cfg: () => cfgForAccount(),
      // réglages du compte chargés : ils remplacent ceux de l'invité tant que le compte est ouvert
      loadCfg: (c) => { REMOTE_APPLY = true; try { Object.keys(c || {}).forEach((k) => { if (!CFG_LOCAL_ONLY.includes(k)) cfg[k] = c[k]; }); cfg.useSess = false; } finally { REMOTE_APPLY = false; } renderAll(); },
      // déconnexion : retour aux réglages de l'invité (sans clé API)
      guestCfg: () => { const sim = cfg.sim; Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, DEF, load(LS.cfg, {}), { useSess: false, sim: sim || true, rpc: '', pinataJwt: '' }); renderAll(); },
      // anciennes clés API gardées dans ce navigateur : passées sur le compte puis retirées d'ici
      dropLocalKeys: () => { const c = load(LS.cfg, {}); if (c.rpc || c.pinataJwt) { delete c.rpc; delete c.pinataJwt; try { localStorage.setItem(LS.cfg, JSON.stringify(c)); } catch (e) {} } },
      // anciennes données gardées dans ce navigateur (avant la base) : reprises une fois sur le compte, puis effacées
      legacyLocal: () => ({ tokens: load(LS.tokens, []), journal: load(LS.journal, []), orders: load(LS.orders, []), dist: load(LSD, {}), draft: load(LS.draft, null) }),
      dropLegacyLocal: () => { [LS.tokens, LS.journal, LS.orders, LSD, LS.draft].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} }); },
    },
    // Préférences du compte : lecture de l'état local, et application de celles du serveur
    prefs: {
      get: () => ({ ui_theme: uiTheme, ui_depth: uiDepth, sim_mode: !!cfg.sim, slippage_pct: cfg.slippage, max_buy_sol: cfg.maxSol, priority: cfg.speed, dev_max_pct: cfg.devMaxPct,
        studio_universe: S.draft.theme, studio_tone: S.draft.tone, studio_lang: S.draft.lang }),
      apply(p) {
        if (!p) return;
        REMOTE_APPLY = true;
        try {
          if (p.ui_theme || p.ui_depth) applyUiTheme(p.ui_theme || uiTheme, true, UI_DEPTH[p.ui_depth] ? p.ui_depth : null, 'remote');
          const c = {};
          if (p.sim_mode != null) c.sim = !!p.sim_mode;
          if (p.slippage_pct != null) c.slippage = +p.slippage_pct;
          if (p.max_buy_sol != null) c.maxSol = +p.max_buy_sol;
          if (p.priority) c.speed = p.priority;
          if (p.dev_max_pct != null) c.devMaxPct = +p.dev_max_pct;
          Object.assign(cfg, c); save(LS.cfg, cfg);
          if (THEME_SHOWN.includes(p.studio_universe)) S.draft.theme = p.studio_universe;
          if (TONES[p.studio_tone]) S.draft.tone = p.studio_tone;
          if (LANGS[p.studio_lang]) S.draft.lang = p.studio_lang;
          saveDraft(); renderAll();
        } finally { REMOTE_APPLY = false; }
      },
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
