/* ==========================================================================
   FoodNote — 122-swipe-nav.js  (navigation par swipe horizontal, WebView OK)
   Swipe gauche -> page suivante, swipe droite -> page précédente.
   Clés : touch-action CSS centralisé + écoute en capture + preventDefault dès que le
   geste est horizontal (le WebView ne peut plus voler le geste).
   Déclenche aussi un glissement directionnel des pages (classe fn-pg-next/prev).
   Debug optionnel : window.__fnSwipe.debug = true (logs console).
   ========================================================================== */
(function () {
  'use strict';
  if (window.__fnSwipe && window.__fnSwipe.__v === 11) return;

  var PAGE_ORDER = ['journal', 'objectif', 'recap', 'stats']; // Journal / Objectif / Bilan(=Récap) / Stats
  var MIN_DX = 30, EDGE_IGNORE = 12;

  /*
   * Les règles touch-action sont maintenant dans le CSS propriétaire :
   * public/assets/css/modules/86-mobile-swipe-motion.css
   * Le script ne doit plus injecter de style runtime ; il ne gère que la logique du geste.
   */

  var g = null, lastNavAt = 0;
  var api = { __v: 11, debug: false, go: go, info: info };
  window.__fnSwipe = api;
  function log() { if (api.debug) try { console.log.apply(console, ['[swipe]'].concat([].slice.call(arguments))); } catch (e) {} }

  function info() { return { v: api.__v, hasShowPage: typeof window.showPage === 'function', pages: existingMainPages(), current: currentPageId() }; }
  function existingMainPages() { return PAGE_ORDER.filter(function (id) { return document.getElementById('page-' + id); }); }
  function currentPageId() { var a = document.querySelector('.page.active'); return (a && a.id) ? a.id.replace(/^page-/, '') : null; }
  function anyOverlayOpen() {
    var n = document.querySelectorAll('.capture-modal.visible, .fn-modal.visible, .fn-modal.open, .fn-modal.is-open, .modal.visible, .modal.open, .modal.show, .fn-sheet.open, .fn-bottom-sheet.open, .fn-profile-menu.open, .profile-menu.open');
    for (var i = 0; i < n.length; i++) {
      var el = n[i];
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        var cs = getComputedStyle(el);
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return true;
      }
    }
    return false;
  }
  function excluded(target) {
    if (!(target instanceof Element)) return false;
    var el = target, depth = 0;
    while (el && el !== document.body && depth < 12) {
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
      if (el.matches && el.matches('input[type="range"], .slider, .noUi-target, [data-no-swipe], .frigate-card, .journal-day-carousel, .journal-day-carousel-wrap, .fn-hscroll')) return true;
      el = el.parentElement; depth++;
    }
    return false;
  }
  function animatePage(id, delta) {
    var pg = document.getElementById('page-' + id);
    if (!pg) return;
    pg.classList.remove('fn-pg-next', 'fn-pg-prev');
    void pg.offsetWidth; // reflow -> relance l'animation
    pg.classList.add(delta > 0 ? 'fn-pg-next' : 'fn-pg-prev');
    setTimeout(function () { pg.classList.remove('fn-pg-next', 'fn-pg-prev'); }, 380);
  }
  function go(delta) {
    var now = Date.now();
    if (now - lastNavAt < 400) return;
    if (typeof window.showPage !== 'function') return;
    var pages = existingMainPages(), cur = currentPageId(), idx = pages.indexOf(cur);
    if (idx === -1) return;
    var next = idx + delta;
    if (next < 0 || next >= pages.length) return;
    lastNavAt = now;
    var id = pages[next];
    try { window.showPage(id, document.getElementById('nav-' + id) || null); animatePage(id, delta); log('->', id); }
    catch (e) { console.warn('[FoodNote] swipe', e); }
  }

  function begin(x, y, target) {
    g = { x0: x, y0: y, fired: false, tracking: false, horiz: false };
    if (x <= EDGE_IGNORE) return;
    if (anyOverlayOpen()) return;
    if (excluded(target)) return;
    g.tracking = true;
  }
  function move(x, y) {
    if (!g || g.fired || !g.tracking) return false;
    var dx = x - g.x0, dy = y - g.y0, adx = Math.abs(dx), ady = Math.abs(dy);
    if (!g.horiz) {
      if (adx >= 8 && adx >= ady) { g.horiz = true; }
      else if (ady >= 28 && ady > adx * 1.5) { g.tracking = false; return false; }
      else return true;
    }
    if (adx >= MIN_DX) { g.fired = true; g.tracking = false; go(dx < 0 ? 1 : -1); }
    return true;
  }
  function terminal(x, y) {
    if (!g) return;
    if (typeof x === 'number' && !g.fired && g.tracking) move(x, y);
    g = null;
  }

  var CAP = { passive: true, capture: true };
  var CAPNP = { passive: false, capture: true };
  function bindTouch(t) {
    t.addEventListener('touchstart', function (e) { var p = e.touches && e.touches[0]; if (p) begin(p.clientX, p.clientY, e.target); }, CAP);
    t.addEventListener('touchmove', function (e) { var p = e.touches && e.touches[0]; if (!p) return; if (move(p.clientX, p.clientY) && e.cancelable) e.preventDefault(); }, CAPNP);
    t.addEventListener('touchend', function (e) { var p = e.changedTouches && e.changedTouches[0]; terminal(p ? p.clientX : undefined, p ? p.clientY : undefined); }, CAP);
    t.addEventListener('touchcancel', function (e) { var p = e.changedTouches && e.changedTouches[0]; terminal(p ? p.clientX : undefined, p ? p.clientY : undefined); }, CAP);
  }
  function bindPointer(t) {
    if (!window.PointerEvent) return;
    var pid = null;
    t.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && e.button !== 0) return; pid = e.pointerId; begin(e.clientX, e.clientY, e.target); }, CAP);
    t.addEventListener('pointermove', function (e) { if (e.pointerId === pid) move(e.clientX, e.clientY); }, CAP);
    t.addEventListener('pointerup', function (e) { if (e.pointerId === pid) terminal(e.clientX, e.clientY); }, CAP);
    t.addEventListener('pointercancel', function () { terminal(); }, CAP);
  }
  bindTouch(document); bindTouch(window); bindPointer(document);
  console.log('[FoodNote] swipe-nav prêt');
})();
