// Garde de démarrage de l'outil (script classique, chargé avant tout le reste).
// - L'interface reste masquée derrière un écran de chargement tant que l'application n'a pas démarré : plus d'affichage
//   d'une page vide ou figée avant la connexion.
// - Si le démarrage échoue (fichier non chargé, erreur) ou dure trop, un écran explique le problème et propose de
//   réparer : les données locales de l'outil sont effacées, la session du compte est gardée, puis la page se recharge.
(function () {
  var d = document, h = d.documentElement, errs = [], shown = false, AUTH = 'tokenstudio-auth';
  h.classList.add('ts-booting');
  var st = d.createElement('style');
  st.textContent =
    '.ts-booting body>*:not(#ts-boot){visibility:hidden!important}' +
    '#ts-boot{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;' +
    'background:#0d0c0a;color:#ece6da;font:15px/1.55 Geist,system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '#ts-boot .b{width:min(480px,100%);display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}' +
    '#ts-boot .sp{width:30px;height:30px;border-radius:50%;border:3px solid #2e2a22;border-top-color:#c9a24b;animation:tsb .9s linear infinite}' +
    '@keyframes tsb{to{transform:rotate(360deg)}}' +
    '#ts-boot .t{font-size:18px;font-weight:600}#ts-boot .m{color:#a9a191;font-size:14px}' +
    '#ts-boot pre{width:100%;max-height:140px;overflow:auto;margin:0;padding:10px 12px;border-radius:10px;background:#17150f;border:1px solid #2e2a22;' +
    'color:#d9b56a;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;text-align:left;white-space:pre-wrap;word-break:break-word}' +
    '#ts-boot .r{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}' +
    '#ts-boot button{border:1px solid #3a342a;background:#1d1a14;color:#ece6da;border-radius:10px;padding:10px 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}' +
    '#ts-boot button.p{background:#c9a24b;border-color:#c9a24b;color:#16130d}#ts-boot button:focus-visible{outline:2px solid #c9a24b;outline-offset:2px}';
  (d.head || h).appendChild(st);

  function box() {
    var el = d.getElementById('ts-boot');
    if (!el) { el = d.createElement('div'); el.id = 'ts-boot'; el.setAttribute('role', 'status'); (d.body || h).appendChild(el); }
    return el;
  }
  function node(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function loading() {
    if (shown) return;
    var el = box(); el.textContent = '';
    var b = node('div', 'b'); b.appendChild(node('div', 'sp')); b.appendChild(node('div', 'm', 'Chargement de TokenStudio…'));
    el.appendChild(b);
  }
  // efface les données locales de l'outil (réglages, caches, brouillons) mais garde la session du compte
  function repair() {
    try { Object.keys(localStorage).forEach(function (k) { if (k !== AUTH) localStorage.removeItem(k); }); } catch (e) { /* stockage indisponible */ }
    try { sessionStorage.clear(); } catch (e) { /* idem */ }
    location.reload();
  }
  function fail() {
    if (!h.classList.contains('ts-booting')) return;
    shown = true;
    var el = box(); el.textContent = ''; el.setAttribute('role', 'alert');
    var b = node('div', 'b');
    b.appendChild(node('div', 't', errs.length ? 'TokenStudio n\'a pas pu démarrer' : 'Le démarrage prend plus de temps que prévu'));
    b.appendChild(node('div', 'm', blocked
      ? 'Un programme de cet ordinateur empêche le fichier principal de l\'outil d\'arriver dans la page : le plus souvent la protection web d\'un antivirus, ou une extension du navigateur (bloqueur de publicités, sécurité). Ouvrez l\'outil dans une fenêtre de navigation privée sans extensions pour vérifier, puis ajoutez ce site aux exceptions du programme en cause.'
      : errs.length
      ?'Une donnée enregistrée dans ce navigateur ou un fichier non chargé bloque l\'ouverture. « Réparer » efface les réglages locaux de l\'outil (votre compte reste connecté) puis recharge la page.'
      : 'Votre connexion est peut-être lente. Vous pouvez patienter, recharger, ou réparer si le problème revient.'));
    if (errs.length) b.appendChild(node('pre', '', errs.slice(0, 6).join('\n')));
    var r = node('div', 'r');
    var fix = node('button', 'p', 'Réparer et recharger'); fix.type = 'button'; fix.onclick = repair;
    var again = node('button', '', 'Recharger'); again.type = 'button'; again.onclick = function () { location.reload(); };
    r.appendChild(fix); r.appendChild(again); b.appendChild(r);
    el.appendChild(b);
    try { fix.focus(); } catch (e) { /* rien */ }
  }

  // fichier principal non chargé : on regarde ce que le serveur renvoie vraiment, puis on retente une fois sans cache
  var retried = false;
  function retry(src) {
    if (retried) { fail(); return; }
    retried = true;
    loading();
    fetch(src, { cache: 'no-store' }).then(function (r) {
      return r.text().then(function (txt) {
        errs.push('Vérification : réponse ' + r.status + ', ' + (r.headers.get('content-type') || 'type inconnu') + ', ' + txt.length + ' caractères');
        if (!r.ok) throw new Error('réponse ' + r.status);
        return import(src + '?r=' + Date.now());
      });
    }, function (e) {
      errs.push('Vérification : le fichier est bloqué avant d\'arriver dans la page (' + (e && e.message ? e.message : e) + ')');
      blocked = true;
      throw e;
    }).catch(function (e) {
      if (!blocked) errs.push('Nouvel essai échoué : ' + String(e && e.message ? e.message : e).slice(0, 200));
      fail();
    });
  }
  var blocked = false;

  // erreurs du démarrage : scripts ou feuilles de style non chargés, erreurs JavaScript
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.tagName === 'SCRIPT' || (t.tagName === 'LINK' && t.rel === 'stylesheet'))) {
      // une police externe non chargée n'empêche pas le démarrage : on l'ignore
      if (String(t.src || t.href || '').indexOf(location.origin) !== 0 && t.tagName === 'LINK') return;
      var src = String(t.src || t.href || '');
      errs.push('Fichier non chargé : ' + src.split('/').pop());
      if (t.tagName === 'SCRIPT' && t.type === 'module' && src.indexOf(location.origin + '/assets/') === 0) retry(src);
      else if (t.tagName === 'SCRIPT') fail();
      return;
    }
    if (e.message) {
      errs.push(e.message + (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : ''));
      // erreur dans les fichiers de l'outil pendant le démarrage : inutile d'attendre
      if (String(e.filename || '').indexOf(location.origin + '/assets/') === 0) setTimeout(fail, 1500);
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; errs.push('Erreur : ' + (r && r.message ? r.message : String(r)).slice(0, 300));
  });

  // l'application signale son démarrage (ou son échec) ici
  window.__tsBoot = {
    done: function () { clearTimeout(timer); h.classList.remove('ts-booting'); var el = d.getElementById('ts-boot'); if (el) el.remove(); },
    fail: function (e) { errs.push(String(e && e.message ? e.message : e).slice(0, 300)); fail(); },
  };
  if (d.body) loading(); else d.addEventListener('DOMContentLoaded', loading);
  var timer = setTimeout(fail, 15000);
})();
