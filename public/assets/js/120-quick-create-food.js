/*
 * FoodNote — 120-quick-create-food.js
 * Rôle : Ajouter le bouton “Créer un aliment” dans les recherches et piloter la mini-modale de création rapide.
 * Ne doit pas gérer : le rendu CSS, les styles inline, SQLite directement, CIQUAL/OpenFoodFacts ou le moteur de recherche principal.
 */
(function () {
  'use strict';
  if (window.__fnQuickCreateFood) return;
  window.__fnQuickCreateFood = true;

  /* Champs de recherche à équiper. place: où insérer le bouton vs l'ancre. */
  var TARGETS = [
    { input: 'db-search', qty: 'db-qty',
      anchor: function () { return document.querySelector('#food-add-modal .food-inline-filters'); }, place: 'after' },
    { input: 'capture-search-input', qty: 'capture-search-qty',
      anchor: function () { return document.getElementById('capture-search-results'); }, place: 'before' }
  ];


  /* Les styles .fn-qcf-* sont dans modules/43-quick-create-food.css. */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function numVal(id) { var v = parseFloat((document.getElementById(id) || {}).value); return isFinite(v) && v >= 0 ? v : 0; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function btnId(t) { return 'fn-qcf-btn-' + t.input; }

  function ensureButton(t) {
    var input = document.getElementById(t.input);
    if (!input) return;
    if (document.getElementById(btnId(t))) { syncButton(t); return; }
    var anchor = t.anchor() || input.closest('.db-row') || input.parentElement;
    if (!anchor || !anchor.parentNode) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = btnId(t);
    btn.className = 'fn-qcf-btn';
    btn.setAttribute('data-qcf-input', t.input);
    btn.setAttribute('data-qcf-qty', t.qty);
    btn.hidden = true;
    if (t.place === 'before') anchor.parentNode.insertBefore(btn, anchor);
    else anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    syncButton(t);
  }
  function syncButton(t) {
    var input = document.getElementById(t.input);
    var btn = document.getElementById(btnId(t));
    if (!input || !btn) return;
    var v = (input.value || '').trim();
    if (v) { btn.hidden = false; btn.innerHTML = '＋ Créer « ' + esc(trunc(v, 28)) + ' »'; }
    else { btn.hidden = true; }
  }
  function targetFor(inputId) {
    for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i].input === inputId) return TARGETS[i];
    return null;
  }

  function openCreator(inputId, qtyId) {
    var input = document.getElementById(inputId);
    var name = (input && input.value.trim()) || '';
    var qtyEl = qtyId ? document.getElementById(qtyId) : null;
    var qty = (qtyEl && parseFloat(qtyEl.value)) || 100;
    closeModal();
    var ov = document.createElement('div');
    ov.className = 'fn-qcf-overlay';
    ov.id = 'fn-qcf-overlay';
    ov.setAttribute('data-qcf-src', inputId);
    ov.innerHTML =
      '<div class="fn-qcf-modal" role="dialog" aria-modal="true" aria-label="Créer un aliment">' +
        '<div class="fn-qcf-head"><strong>Créer un aliment</strong>' +
          '<button type="button" class="fn-qcf-close" aria-label="Fermer">×</button></div>' +
        '<label class="fn-qcf-field"><span>Nom</span>' +
          '<input type="text" id="fn-qcf-nom" value="' + esc(name) + '" placeholder="Nom de l\u2019aliment"></label>' +
        '<div class="fn-qcf-grid">' +
          '<label class="fn-qcf-field"><span>\uD83D\uDD25 Kcal / 100 g</span><input type="number" id="fn-qcf-kcal" min="0" step="1"></label>' +
          '<label class="fn-qcf-field"><span>\uD83E\uDD69 Protéines / 100 g</span><input type="number" id="fn-qcf-prot" min="0" step="0.1"></label>' +
          '<label class="fn-qcf-field"><span>\uD83C\uDF5E Glucides / 100 g</span><input type="number" id="fn-qcf-gluc" min="0" step="0.1"></label>' +
          '<label class="fn-qcf-field"><span>\uD83E\uDD51 Lipides / 100 g</span><input type="number" id="fn-qcf-lip" min="0" step="0.1"></label>' +
        '</div>' +
        '<label class="fn-qcf-field"><span>Quantité (g)</span><input type="number" id="fn-qcf-qty" min="1" step="1" value="' + qty + '"></label>' +
        '<label class="fn-qcf-save"><input type="checkbox" id="fn-qcf-save" checked> Enregistrer comme aliment perso (réutilisable)</label>' +
        '<div class="fn-qcf-actions">' +
          '<button type="button" class="fn-qcf-cancel">Annuler</button>' +
          '<button type="button" class="fn-qcf-add">Ajouter au journal</button>' +
        '</div>' +
        '<div class="fn-qcf-err" id="fn-qcf-err" hidden></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    ov.querySelector('.fn-qcf-close').addEventListener('click', closeModal);
    ov.querySelector('.fn-qcf-cancel').addEventListener('click', closeModal);
    ov.querySelector('.fn-qcf-add').addEventListener('click', function () { submit(inputId); });
    document.addEventListener('keydown', onEsc);
    setTimeout(function () { var k = document.getElementById('fn-qcf-kcal'); if (k) k.focus(); }, 30);
  }
  function onEsc(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    var ov = document.getElementById('fn-qcf-overlay');
    if (ov) ov.remove();
    document.removeEventListener('keydown', onEsc);
  }

  function submit(srcInputId) {
    var err = document.getElementById('fn-qcf-err');
    var nom = (document.getElementById('fn-qcf-nom').value || '').trim();
    if (!nom) { err.hidden = false; err.textContent = 'Indique un nom.'; return; }
    if (typeof window.addCustomAliment !== 'function') {
      err.hidden = false; err.textContent = 'Ajout indisponible (addCustomAliment introuvable).'; return;
    }
    var qty = numVal('fn-qcf-qty') || 100;
    var payload = {
      nom: nom, defaut: qty,
      kcal100: Math.round(numVal('fn-qcf-kcal')),
      prot100: r1(numVal('fn-qcf-prot')),
      gluc100: r1(numVal('fn-qcf-gluc')),
      lip100: r1(numVal('fn-qcf-lip')),
      bddId: null, source: 'manual',
      meal: window.foodAddTargetMeal || 'lunch',
      saveToBase: !!(document.getElementById('fn-qcf-save') || {}).checked,
      forceNutritionUpdate: true
    };
    try { window.addCustomAliment(payload); }
    catch (e) { err.hidden = false; err.textContent = 'Erreur : ' + (e && e.message || e); return; }
    closeModal();
    try { var inp = document.getElementById(srcInputId); if (inp) { inp.value = ''; } } catch (e) {}
    for (var i = 0; i < TARGETS.length; i++) syncButton(TARGETS[i]);
    try { if (typeof window.closeFoodAddModal === 'function') window.closeFoodAddModal(); } catch (e) {}
    try { var cc = document.querySelector('#capture-workflow-modal .capture-close'); if (cc) cc.click(); } catch (e) {}
  }

  /* branchements délégués (robustes aux re-rendus des deux modales) */
  document.addEventListener('input', function (e) {
    var t = e.target && targetFor(e.target.id);
    if (t) { ensureButton(t); syncButton(t); }
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target && targetFor(e.target.id);
    if (t) ensureButton(t);
  });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('.fn-qcf-btn');
    if (b) { e.preventDefault(); openCreator(b.getAttribute('data-qcf-input'), b.getAttribute('data-qcf-qty')); }
  });

  function ensureAll() { for (var i = 0; i < TARGETS.length; i++) ensureButton(TARGETS[i]); }

  /* Les modales se redessinent à chaque frappe -> on ré-injecte le bouton
     après chaque mutation (callback léger : simples getElementById). */
  var scheduled = false;
  function scheduleEnsure() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () { scheduled = false; ensureAll(); }, 0);
  }
  try {
    new MutationObserver(scheduleEnsure).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  function init() { ensureAll(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
  console.log('[FoodNote] quick-create-food prêt');
})();
