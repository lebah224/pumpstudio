// Listes de choix aux couleurs du studio, à la place du menu natif du navigateur (gris sur Android, bleu sur iOS).
// Chaque <select> reste dans la page, masqué, et garde sa valeur : le code existant (studio historique, React)
// continue de le lire et de l'écouter. Un bouton affiche le choix ; il ouvre un panneau sous le champ sur
// ordinateur, un panneau du bas sur mobile. Clavier : flèches, Entrée, Échap, Début/Fin, saisie d'une lettre.

type Enhanced = HTMLSelectElement & { __tsBtn?: HTMLButtonElement };
const CHEV = '<svg class="ts-sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
let uid = 0;
let open: { sel: Enhanced; close: (focus?: boolean) => void } | null = null;

const mobile = () => window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function labelOf(sel: HTMLSelectElement): string {
  const own = sel.getAttribute('aria-label'); if (own) return own;
  const byFor = sel.id ? document.querySelector<HTMLLabelElement>('label[for="' + CSS.escape(sel.id) + '"]') : null;
  const lab = byFor ?? sel.closest('label');
  if (!lab) return 'Choisir';
  const t = lab.querySelector('.ts-lbl, span')?.textContent ?? lab.childNodes[0]?.textContent ?? lab.textContent ?? '';
  return t.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Choisir';
}

function sync(sel: Enhanced) {
  const b = sel.__tsBtn; if (!b) return;
  const o = sel.options[sel.selectedIndex];
  b.querySelector('.ts-sel-v')!.textContent = o ? o.textContent : '';
  b.disabled = sel.disabled;
  b.classList.toggle('ts-sel-empty', !o || !o.value);
}

function choose(sel: Enhanced, i: number) {
  if (sel.selectedIndex === i) return;
  sel.selectedIndex = i;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function openMenu(sel: Enhanced) {
  open?.close(false);
  const btn = sel.__tsBtn!; const sheet = mobile();
  const id = 'ts-sel-l' + ++uid;
  const items: { i: number; el: HTMLElement }[] = [];
  const scrim = document.createElement('div'); scrim.className = 'ts-sel-scrim' + (sheet ? ' sheet' : '');
  const pop = document.createElement('div'); pop.className = 'ts-sel-pop' + (sheet ? ' sheet' : '');
  let html = sheet ? '<div class="ts-sel-head"><b>' + esc(labelOf(sel)) + '</b><button type="button" class="ts-sel-x" aria-label="Fermer">×</button></div>' : '';
  html += '<div class="ts-sel-list" role="listbox" id="' + id + '" aria-label="' + esc(labelOf(sel)) + '">';
  [...sel.children].forEach((node) => {
    const opts = node instanceof HTMLOptGroupElement ? (html += '<div class="ts-sel-grp">' + esc(node.label) + '</div>', [...node.children]) : [node];
    opts.forEach((o) => {
      if (!(o instanceof HTMLOptionElement) || o.hidden) return;
      const on = o.index === sel.selectedIndex;
      html += '<div class="ts-sel-opt' + (on ? ' on' : '') + (o.disabled ? ' dis' : '') + '" role="option" id="' + id + '-' + o.index + '" data-i="' + o.index + '" aria-selected="' + on + '"' + (o.disabled ? ' aria-disabled="true"' : '') + '><span>' + esc(o.textContent ?? '') + '</span>' + (on ? CHECK : '') + '</div>';
    });
  });
  pop.innerHTML = html + '</div>';
  pop.querySelectorAll<HTMLElement>('.ts-sel-opt').forEach((el) => items.push({ i: +el.dataset.i!, el }));
  document.body.append(scrim, pop);

  if (!sheet) {
    const r = btn.getBoundingClientRect(), vh = window.innerHeight;
    const below = vh - r.bottom - 12, above = r.top - 12, up = below < 220 && above > below;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8)) + 'px';
    pop.style.minWidth = r.width + 'px';
    pop.style.maxHeight = Math.min(340, up ? above : below) + 'px';
    if (up) pop.style.bottom = (vh - r.top + 6) + 'px'; else pop.style.top = (r.bottom + 6) + 'px';
  }

  let active = Math.max(0, items.findIndex((x) => x.i === sel.selectedIndex));
  const mark = (k: number, scroll = true) => {
    items.forEach((x, j) => x.el.classList.toggle('act', j === k));
    active = k; const it = items[k]; if (!it) return;
    pop.querySelector('.ts-sel-list')!.setAttribute('aria-activedescendant', it.el.id);
    if (scroll) it.el.scrollIntoView({ block: 'nearest' });
  };
  mark(active);
  let typed = '', typedAt = 0;
  const onKey = (e: KeyboardEvent) => {
    const n = items.length; if (!n) return;
    // le menu ouvert garde les touches : elles n'atteignent pas le bouton (qui le rouvrirait) ni la page
    if (e.key !== 'Tab') e.stopPropagation();
    const step = (d: number) => { let k = active; for (let t = 0; t < n; t++) { k = (k + d + n) % n; if (!items[k]!.el.classList.contains('dis')) break; } mark(k); };
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); mark(0); }
    else if (e.key === 'End') { e.preventDefault(); mark(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const it = items[active]; if (it && !it.el.classList.contains('dis')) { choose(sel, it.i); close(); } }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      typed = (Date.now() - typedAt > 700 ? '' : typed) + e.key.toLowerCase(); typedAt = Date.now();
      const k = items.findIndex((x) => (x.el.textContent ?? '').trim().toLowerCase().startsWith(typed)); if (k >= 0) mark(k);
    }
  };
  const onScroll = (e: Event) => { if (!sheet && !pop.contains(e.target as Node)) close(false); };
  function close(focus = true) {
    document.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize);
    pop.classList.add('out'); scrim.classList.add('out');
    setTimeout(() => { pop.remove(); scrim.remove(); }, sheet ? 160 : 90);
    btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('on');
    if (open?.sel === sel) open = null;
    if (focus) btn.focus({ preventScroll: true });
  }
  const onResize = () => close(false);
  pop.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.ts-sel-x')) return close();
    const o = t.closest<HTMLElement>('.ts-sel-opt'); if (!o || o.classList.contains('dis')) return;
    choose(sel, +o.dataset.i!); close();
  });
  pop.addEventListener('mousemove', (e) => { const o = (e.target as HTMLElement).closest<HTMLElement>('.ts-sel-opt'); if (o) { const k = items.findIndex((x) => x.el === o); if (k !== active) mark(k, false); } });
  scrim.addEventListener('click', () => close(false));
  document.addEventListener('keydown', onKey, true); window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', onResize);
  btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', id); btn.classList.add('on');
  open = { sel, close };
}

function enhance(sel: Enhanced) {
  if (sel.__tsBtn || sel.multiple || sel.size > 1 || sel.dataset.native != null) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ts-sel ' + sel.className;
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span class="ts-sel-v"></span>' + CHEV;
  btn.setAttribute('aria-label', labelOf(sel));
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (open?.sel === sel) open.close(); else openMenu(sel); });
  btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(sel); } });
  sel.__tsBtn = btn;
  sel.classList.add('ts-sel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  // un clic sur l'étiquette donne le focus au select masqué : on le renvoie au bouton
  sel.addEventListener('focus', () => btn.focus({ preventScroll: true }));
  sel.addEventListener('change', () => sync(sel));
  sel.after(btn);
  new MutationObserver(() => sync(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
  sync(sel);
}

// valeur changée par le code (studio historique ou React) : le bouton suit
function patch(proto: object, key: string, target: (el: any) => HTMLSelectElement | null) {
  const d = Object.getOwnPropertyDescriptor(proto, key); if (!d?.set) return;
  Object.defineProperty(proto, key, { ...d, set(v) { d.set!.call(this, v); const s = target(this) as Enhanced | null; if (s?.__tsBtn) sync(s); } });
}

export function installSelectMenus() {
  patch(HTMLSelectElement.prototype, 'value', (el) => el);
  patch(HTMLSelectElement.prototype, 'selectedIndex', (el) => el);
  patch(HTMLOptionElement.prototype, 'selected', (el: HTMLOptionElement) => el.parentElement?.closest('select') ?? null);
  const scan = (root: ParentNode) => root.querySelectorAll<HTMLSelectElement>('select').forEach((s) => enhance(s));
  scan(document);
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => { if (n instanceof HTMLSelectElement) enhance(n); else if (n instanceof Element) scan(n); });
      m.removedNodes.forEach((n) => {
        const gone = n instanceof HTMLSelectElement ? [n] : n instanceof Element ? [...n.querySelectorAll('select')] : [];
        (gone as Enhanced[]).forEach((s) => { if (s.__tsBtn && !s.__tsBtn.isConnected) return; if (!s.isConnected) { if (open?.sel === s) open.close(false); s.__tsBtn?.remove(); } });
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}
