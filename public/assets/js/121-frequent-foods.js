/*
 * FoodNote — 121-frequent-foods.js
 * Rôle : Calculer les aliments fréquents par repas et ajouter le bouton étoile à côté du bouton “+” des repas.
 * Ne doit pas gérer : le rendu CSS, les styles inline, les modules Journal, SQLite serveur ou l’import de données alimentaires.
 */
(function () {
  if (window.__fnFrequentFoods) return;
  window.__fnFrequentFoods = true;

  var BTN_CLASS = 'fn-freq-btn';
  var BUBBLE_ID = 'fn-freq-bubble';
  var cache = null, cacheAt = 0;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }
  function r0(n) { return Math.round(Number(n) || 0); }
  function r1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* --- agrégation de l'historique --------------------------------------- */
  async function getEntries() {
    try {
      if (typeof window.loadEntriesFullNative === 'function') return await window.loadEntriesFullNative();
    } catch (e) {}
    return (window._db && window._db.journal_entries) || [];
  }

  async function computeFrequents(force) {
    if (cache && !force && (Date.now() - cacheAt < 120000)) return cache;
    var entries = await getEntries();
    var byMeal = {};
    (entries || []).forEach(function (e) {
      ((e && e.aliments) || []).forEach(function (a) {
        var nom = (a.nom || a.name || '').trim();
        var qty = Number(a.qty) || 0;
        if (!nom || qty <= 0) return;
        var meal = a.meal || 'lunch';
        var key = norm(nom);
        byMeal[meal] = byMeal[meal] || {};
        var g = byMeal[meal][key] || (byMeal[meal][key] = { nom: nom, count: 0, qtys: {}, bddId: a.bddId || null });
        g.count++;
        var qk = String(r0(qty));
        g.qtys[qk] = (g.qtys[qk] || 0) + 1;
        function per100(v100, total) {
          if (v100 !== undefined && v100 !== null && v100 !== '') return Number(v100) || 0;
          if (total !== undefined && qty > 0) return (Number(total) || 0) / qty * 100;
          return undefined;
        }
        var k = per100(a.kcal100, a.kcal), p = per100(a.prot100, a.prot),
            gl = per100(a.gluc100, a.gluc), l = per100(a.lip100, a.lip);
        if (g.k === undefined && k !== undefined) g.k = k;
        if (g.p === undefined && p !== undefined) g.p = p;
        if (g.gl === undefined && gl !== undefined) g.gl = gl;
        if (g.l === undefined && l !== undefined) g.l = l;
        if (!g.bddId && a.bddId) g.bddId = a.bddId;
      });
    });
    var out = {};
    Object.keys(byMeal).forEach(function (meal) {
      var arr = Object.keys(byMeal[meal]).map(function (key) {
        var g = byMeal[meal][key], bestQ = 0, bestC = -1;
        Object.keys(g.qtys).forEach(function (q) { if (g.qtys[q] > bestC) { bestC = g.qtys[q]; bestQ = Number(q); } });
        return { nom: g.nom, qty: bestQ || 100, count: g.count, bddId: g.bddId,
          kcal100: r0(g.k || 0), prot100: r1(g.p || 0), gluc100: r1(g.gl || 0), lip100: r1(g.l || 0) };
      });
      arr.sort(function (a, b) { return b.count - a.count; });
      out[meal] = arr.slice(0, 8);
    });
    cache = out; cacheAt = Date.now();
    return out;
  }

  /* Les styles .fn-freq-* sont dans modules/88-frequent-foods.css. */

  /* --- bulle ------------------------------------------------------------ */
  function closeBubble() { var b = document.getElementById(BUBBLE_ID); if (b) b.remove(); document.removeEventListener('click', onDocClick, true); }
  function onDocClick(e) {
    var b = document.getElementById(BUBBLE_ID);
    if (b && !b.contains(e.target) && !(e.target.closest && e.target.closest('.' + BTN_CLASS))) closeBubble();
  }
  function toast(msg) {
    var t = document.getElementById('fn-freq-toast') || document.createElement('div');
    t.id = 'fn-freq-toast';
    t.className = 'fn-freq-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-visible'); });
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('is-visible'); }, 1600);
  }

  async function openBubble(meal, anchor, mealLabel) {
    closeBubble();
    var data = {};
    try { data = await computeFrequents(false); } catch (e) {}
    var items = data[meal] || [];
    var b = document.createElement('div');
    b.id = BUBBLE_ID;
    var head = '<div class="fn-freq-h">\u2B50 Fr\u00e9quents \u2014 ' + esc(mealLabel || meal) + '</div>';
    var body;
    if (!items.length) {
      body = '<div class="fn-freq-empty">Pas encore d\'historique pour ce repas.<br>Ajoute des aliments, ils appara\u00eetront ici.</div>';
    } else {
      body = items.map(function (it, i) {
        return '<button type="button" class="fn-freq-item" data-i="' + i + '">' +
          '<div class="fn-freq-main"><div class="fn-freq-name">' + esc(it.nom) + '</div>' +
          '<div class="fn-freq-macros"><span class="mk">\uD83D\uDD25 ' + it.kcal100 + '</span><span class="mp">\uD83C\uDF56 ' + it.prot100 + '</span><span class="mg">\uD83C\uDF5E ' + it.gluc100 + '</span><span class="ml">\uD83E\uDD51 ' + it.lip100 + '</span></div></div>' +
          '<span class="fn-freq-qty">' + r0(it.qty) + ' g</span></button>';
      }).join('');
    }
    b.innerHTML = head + body;
    document.body.appendChild(b);

    // position : feuille basse sur mobile, sinon ancrée au bouton avec hauteur bornée
    var isMobile = window.innerWidth <= 600;
    b.classList.toggle('is-mobile-sheet', isMobile);
    if (isMobile) {
      // La feuille basse mobile est décrite en CSS ; seules les positions calculées desktop restent en JS.
    } else {
      var rc = anchor.getBoundingClientRect();
      var w = b.offsetWidth;
      var left = Math.min(Math.max(8, rc.right - w), window.innerWidth - w - 8);
      var spaceBelow = window.innerHeight - rc.bottom - 16;
      var spaceAbove = rc.top - 16;
      b.style.left = left + 'px';
      if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
        b.style.top = (rc.bottom + 8) + 'px';
        b.style.maxHeight = Math.max(180, spaceBelow) + 'px';
      } else {
        b.style.maxHeight = Math.max(180, spaceAbove) + 'px';
        b.style.top = Math.max(8, rc.top - Math.min(b.offsetHeight, spaceAbove) - 8) + 'px';
      }
    }

    b.querySelectorAll('.fn-freq-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var it = items[Number(el.getAttribute('data-i'))];
        if (!it) return;
        try {
          window.addCustomAliment({
            nom: it.nom, defaut: it.qty,
            kcal100: it.kcal100, prot100: it.prot100, gluc100: it.gluc100, lip100: it.lip100,
            bddId: it.bddId || null, source: 'history', meal: meal, forceNutritionUpdate: true
          });
          toast('\u2713 ' + it.nom + ' ajout\u00e9 (' + r0(it.qty) + ' g)');
        } catch (e) { console.warn('[FoodNote] freq add', e); }
        closeBubble();
      });
    });
    setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);
  }

  /* --- injection du bouton à côté du "+" -------------------------------- */
  function ensureButtons() {
    var addBtns = document.querySelectorAll('.meal-group[data-meal] .meal-group-add-btn');
    addBtns.forEach(function (add) {
      if (add.nextElementSibling && add.nextElementSibling.classList && add.nextElementSibling.classList.contains(BTN_CLASS)) return;
      var group = add.closest('.meal-group[data-meal]');
      if (!group) return;
      var meal = group.getAttribute('data-meal');
      var label = (group.querySelector('.meal-group-title') || {}).textContent || meal;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BTN_CLASS;
      btn.title = 'Aliments fr\u00e9quents \u2014 ' + label;
      btn.setAttribute('aria-label', btn.title);
      btn.textContent = '\u2B50';
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openBubble(meal, btn, (label || '').trim());
      });
      add.parentNode.insertBefore(btn, add.nextSibling);
    });
  }

  var scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(function () { scheduled = false; ensureButtons(); }); }
  try { new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  window.addEventListener('resize', closeBubble);
  if (document.readyState !== 'loading') ensureButtons();
  else document.addEventListener('DOMContentLoaded', ensureButtons);
  console.log('[FoodNote] frequent-foods prêt');
})();
