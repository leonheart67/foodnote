/* FoodNote beta 0.22.179 — CLEANUP_PASS_13_DATE_SELECTION_REFRESH_CORE
 * Diagnostic global du popup Ajouter.
 * Objectif : vérifier la stabilité sans ajouter d'observer, intervalle ou recalcul permanent.
 */
(function FoodNoteFoodAddHardeningCheckpoint(){
  'use strict';

  // Marqueur immédiat : permet de confirmer que le fichier est bien exécuté, même avant DOMContentLoaded.
  window.__FoodNoteFoodAddHardeningScriptLoaded = true;

  const VERSION = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const installedAt = Date.now();
  const $ = (id) => document.getElementById(id);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function safeCall(obj, method){
    try {
      if (obj && typeof obj[method] === 'function') return obj[method]();
    } catch(e) {
      return { error: e && e.message ? e.message : String(e) };
    }
    return null;
  }

  function getModalHealth(){ return safeCall(window.FoodNoteFoodAddModal || window.FoodNoteFoodAddModalController, 'health') || safeCall(window.FoodNoteFoodAddModalController, 'audit'); }
  function getDomainHealth(){ return safeCall(window.FoodNoteFoodAddDomain, 'health') || safeCall(window.FoodNoteFoodAddDomain, 'audit'); }
  function getCaptureHealth(){ return safeCall(window.FoodNoteFoodCaptureFlows, 'health') || safeCall(window.FoodNoteFoodCaptureFlows, 'audit'); }
  function getSearchHealth(){ return safeCall(window.FoodNoteFoodAddSearchResults, 'health') || safeCall(window.FoodNoteFoodAddSearchResults, 'audit'); }
  function getUxHealth(){ return safeCall(window.FoodNoteFoodAddModalUX, 'health'); }

  function modal(){ return $('food-add-modal'); }

  function inlineHandlerCount(){
    const m = modal();
    if (!m) return 0;
    return qa('[onclick], [onpointerdown], [ontouchstart], [oninput], [onchange]', m).length;
  }

  function predictionSurfaceStatus(){
    const quick = $('quick-foods-card');
    const quickList = $('quick-foods-list');
    const db = $('db-suggestions');
    const m = modal();
    return {
      quickCardExists: !!quick,
      quickListExists: !!quickList,
      dbSuggestionsExists: !!db,
      quickCardHiddenByView: !!(quick && quick.getAttribute('aria-hidden') === 'true' && m && m.dataset.fnModalView === 'search'),
      quickCards: quick ? qa('[data-food-add-action="history-add"], .fn-suggestion-card, .quick-food-chip', quick).length : 0,
      dbCards: db ? qa('[data-food-add-action="search-pick"], .db-suggestion', db).length : 0
    };
  }

  function collectIssues(parts){
    const issues = [];
    const m = modal();
    const modalHealth = parts.modalHealth || {};
    const uxHealth = parts.uxHealth || {};
    const searchHealth = parts.searchHealth || {};
    const pred = parts.predictions || {};

    if (!m) issues.push('modal_missing');
    if (!window.FoodNoteFoodAddModalController) issues.push('modal_controller_missing');
    if (!window.FoodNoteFoodAddDomain) issues.push('domain_core_missing');
    if (!window.FoodNoteFoodCaptureFlows) issues.push('capture_flows_missing');
    if (!window.FoodNoteFoodAddSearchResults) issues.push('search_results_core_missing');
    if (!window.FoodNoteFoodAddModalUX) issues.push('ux_core_missing');

    if (inlineHandlerCount() > 0) issues.push('inline_handlers_inside_modal:' + inlineHandlerCount());
    if (modalHealth && modalHealth.knownSurfaces && modalHealth.knownSurfaces.observerEnabled) issues.push('controller_observer_enabled');
    if (uxHealth && uxHealth.observerEnabled) issues.push('ux_observer_enabled');
    if (uxHealth && uxHealth.intervalEnabled) issues.push('ux_interval_enabled');
    if (searchHealth && searchHealth.observerEnabled) issues.push('search_results_observer_enabled');
    if (pred.quickCardHiddenByView) issues.push('predictions_hidden_in_search_view');
    if (window.FoodNoteFoodAddModalController && !(modalHealth && modalHealth.knownSurfaces && modalHealth.knownSurfaces.searchAfterAddRecovery)) issues.push('search_after_add_recovery_missing');
    if (window.FoodNoteFoodAddModalController && !(modalHealth && modalHealth.knownSurfaces && modalHealth.knownSurfaces.legacySearchRecovery)) issues.push('legacy_search_recovery_missing');
    if (window.FoodNoteFoodAddModalController && !(modalHealth && modalHealth.knownSurfaces && modalHealth.knownSurfaces.detachedCaptureActionBridge)) issues.push('detached_capture_action_bridge_missing');
    if (m && !m.classList.contains('fn-food-add-managed')) issues.push('modal_not_marked_managed');

    const nested = [];
    [modalHealth, parts.domainHealth, parts.captureHealth, searchHealth, uxHealth].forEach(h => {
      if (h && Array.isArray(h.issues)) nested.push(...h.issues);
    });
    nested.filter(Boolean).forEach(it => issues.push('nested:' + it));

    return Array.from(new Set(issues));
  }

  function health(){
    const parts = {
      modalHealth: getModalHealth(),
      domainHealth: getDomainHealth(),
      captureHealth: getCaptureHealth(),
      searchHealth: getSearchHealth(),
      uxHealth: getUxHealth(),
      predictions: predictionSurfaceStatus()
    };
    const m = modal();
    const out = {
      version: VERSION,
      installedAt,
      installed: true,
      checkpoint: 'FOOD_ADD_HARDENING_CHECKPOINT',
      safeByDesign: true,
      observerPolicy: 'no_new_observer_no_interval',
      modalExists: !!m,
      modalView: m ? (m.dataset.fnModalView || m.dataset.fnModalMode || '') : '',
      inlineHandlersInsideModal: inlineHandlerCount(),
      controllerObserverEnabled: !!(parts.modalHealth && parts.modalHealth.knownSurfaces && parts.modalHealth.knownSurfaces.observerEnabled),
      uxObserverEnabled: !!(parts.uxHealth && parts.uxHealth.observerEnabled),
      uxIntervalEnabled: !!(parts.uxHealth && parts.uxHealth.intervalEnabled),
      searchResultsObserverEnabled: !!(parts.searchHealth && parts.searchHealth.observerEnabled),
      stableDialogSize: !!(parts.uxHealth && parts.uxHealth.stableDialogSize),
      predictionsLayoutFix: !!(parts.uxHealth && parts.uxHealth.predictionsLayoutFix),
      searchAfterAddRecovery: !!(parts.modalHealth && parts.modalHealth.knownSurfaces && parts.modalHealth.knownSurfaces.searchAfterAddRecovery),
      legacySearchRecovery: !!(parts.modalHealth && parts.modalHealth.knownSurfaces && parts.modalHealth.knownSurfaces.legacySearchRecovery),
      detachedCaptureActionBridge: !!(parts.modalHealth && parts.modalHealth.knownSurfaces && parts.modalHealth.knownSurfaces.detachedCaptureActionBridge),
      predictions: parts.predictions,
      modules: {
        modal: !!window.FoodNoteFoodAddModalController,
        domain: !!window.FoodNoteFoodAddDomain,
        capture: !!window.FoodNoteFoodCaptureFlows,
        searchResults: !!window.FoodNoteFoodAddSearchResults,
        ux: !!window.FoodNoteFoodAddModalUX
      },
      parts
    };
    out.issues = collectIssues(parts);
    out.ok = out.issues.length === 0;
    return out;
  }

  function print(){
    const h = health();
    try {
      if (h.ok) console.info('[FoodAddHardening] OK', h);
      else console.warn('[FoodAddHardening] points à vérifier', h);
    } catch(e) {}
    return h;
  }

  window.FoodNoteFoodAddHardening = { version: VERSION, health, audit: health, print, loaded: true };
  window.FoodNoteFoodAddHealth = health;
  window.FoodAddHealth = health;

  function install(){
    try { window.dispatchEvent(new CustomEvent('foodnote:food-add-hardening:ready', { detail: health() })); } catch(e) {}
    console.info('[FoodAddHardening] chargé', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();

/* FoodNote beta 0.22.179 — stabilisation finale du flux Recherche → Quantité → Ajout
 * Objectif : un seul chemin explicite pour les propositions de recherche.
 * - clic sur proposition : mémorise l'aliment réel et garde le bandeau visible ;
 * - modification quantité : mémorise la quantité utilisateur réelle ;
 * - confirmation : ajoute avec cet aliment + cette quantité, sans relire un ancien état à 100 g.
 */
(function FoodNoteSearchPickQuantityStablePath(){
  'use strict';

  const VERSION = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const state = {
    food: null,
    index: -1,
    source: '',
    bddId: null,
    pickedAt: 0,
    qty: null,
    qtyAt: 0,
    lastEventAt: 0,
    lastIndex: -1,
    addedAt: 0
  };

  const $ = id => document.getElementById(id);
  const now = () => Date.now();
  const num = value => {
    const n = Number(String(value ?? '').replace(',', '.').replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const text = value => String(value ?? '').trim();

  function getSearchState(){ return window.FoodNoteFoodAddSearchState || null; }

  function normalizeFood(raw, source){
    const src = raw && (raw.item || raw.food || raw) || null;
    if (!src || !text(src.nom || src.name)) return null;
    let food = Object.assign({}, src, { nom: text(src.nom || src.name), source: source || src.source || 'base' });
    try { if (typeof window.withUnitDefaults === 'function') food = window.withUnitDefaults(food); } catch(e) {}
    return food;
  }

  function getSuggestion(index){
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0) return null;
    const st = getSearchState();
    let s = null;
    try { if (st && typeof st.getSuggestion === 'function') s = st.getSuggestion(idx); } catch(e) {}
    if (!s) return null;
    if (s.type === 'loading' || s.type === 'status') return { type:s.type };
    if (s.type === 'create') return { type:'create', name:s.name || $('db-search')?.value || '' };
    const source = s.source || s.item?.source || s.food?.source || 'base';
    const food = normalizeFood(s.item || s.food || s, source);
    if (!food) return null;
    return { type:'item', food, source, bddId: food.bddId || food.id || null };
  }

  function selectedMeal(){
    try {
      const ctlMeal = window.FoodNoteFoodAddModal && window.FoodNoteFoodAddModal.state && window.FoodNoteFoodAddModal.state.targetMeal;
      if (['breakfast','lunch','dinner'].includes(ctlMeal)) return ctlMeal;
    } catch(e) {}
    const active = document.querySelector('#food-add-modal .food-meal-chip.active[data-food-meal], #food-add-modal [data-food-add-action="set-meal"].active[data-food-meal], #food-add-modal [data-foodnote-meal-selected="1"][data-food-meal]');
    const meal = active && active.getAttribute('data-food-meal');
    return ['breakfast','lunch','dinner'].includes(meal) ? meal : 'lunch';
  }

  function setSelectedInput(food){
    const name = text(food && (food.nom || food.name));
    if (!name) return;
    const input = $('db-search');
    if (input) {
      input.value = name;
      input.setAttribute('value', name);
      input.dataset.foodnoteStableSelectedName = name;
      input.dataset.foodnoteSearchSelectionLocked = '1';
    }
    const hidden = $('db-selected-id');
    const id = food && (food.bddId || food.id || state.bddId);
    if (hidden) hidden.value = id ? String(id) : '';
    try {
      window.__foodnoteSelectedSearchName = name;
      window.__foodnoteSelectedSearchFood = food || null;
      window.__foodnoteSelectedSearchLockUntil = now() + 60000;
    } catch(e) {}
  }

  function keepSuggestionsVisible(index){
    const box = $('db-suggestions');
    const until = now() + 60000;
    try { window.__foodnoteKeepDBSuggestionsVisibleUntil = until; } catch(e) {}
    if (!box) return;
    box.dataset.foodnoteKeepVisible = '1';
    box.dataset.foodnoteKeepVisibleUntil = String(until);
    box.dataset.foodnotePickedIndex = String(Number.isFinite(Number(index)) ? Number(index) : -1);
    box.classList.add('visible');
    box.removeAttribute('aria-hidden');
    try {
      box.style.setProperty('display', 'block', 'important');
      box.style.setProperty('visibility', 'visible', 'important');
      box.style.setProperty('opacity', '1', 'important');
      box.style.setProperty('pointer-events', 'auto', 'important');
      box.style.setProperty('height', 'min(42dvh, 360px)', 'important');
      box.style.setProperty('max-height', 'min(42dvh, 360px)', 'important');
      box.style.setProperty('overflow-y', 'auto', 'important');
      box.style.setProperty('padding-top', '4px', 'important');
      box.style.setProperty('padding-bottom', '4px', 'important');
    } catch(e) {}
    box.querySelectorAll('.db-suggestion').forEach(el => {
      const active = Number(el.dataset.index ?? el.dataset.searchIndex) === Number(index);
      el.classList.toggle('active', active);
      el.classList.toggle('selected', active);
      el.classList.toggle('is-selected', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const modal = $('food-add-modal');
    if (modal) {
      modal.classList.add('food-add-expanded', 'fn-suggestions-open', 'food-intent-search', 'fn-modal-mode-search');
      modal.classList.remove('food-intent-estimate', 'food-intent-recipes', 'fn-modal-view-capture-family');
      modal.dataset.fnModalView = 'search';
      modal.dataset.fnModalMode = 'search';
    }
  }

  function syncQuantityDom(qty){
    const q = num(qty);
    if (q == null) return null;
    state.qty = q;
    state.qtyAt = now();
    try {
      window.__foodnoteStableQuantityValue = q;
      window.__foodnoteStableQuantityAt = state.qtyAt;
      window.__foodnoteDbQuantityFinalValue = q;
      window.__foodnoteDbQuantityUserValue = q;
      window.__foodnoteDbQuantityUserTouchedAt = state.qtyAt;
      window.__foodnoteDbQuantityUserEditValue = q;
      window.__foodnoteDbQuantityUserEditAt = state.qtyAt;
    } catch(e) {}
    const ids = ['db-qty', 'db-quantity-input', 'db-quantity-range'];
    ids.forEach(id => {
      const el = $(id);
      if (!el) return;
      if (String(el.value) !== String(q)) el.value = String(q);
    });
    const panel = $('db-quantity-panel');
    if (panel) panel.dataset.foodnoteQuantityValue = String(q);
    try { if (state.food && typeof window.setDBQuantityValue === 'function') window.setDBQuantityValue(q, { touch:false, source:'stable-sync' }); } catch(e) {}
    keepSuggestionsVisible(state.index);
    setSelectedInput(state.food);
    return q;
  }

  function readStableQuantity(){
    if (state.qty != null && state.qtyAt >= state.pickedAt) return state.qty;
    const candidates = [
      $('db-quantity-input')?.value,
      $('db-quantity-range')?.value,
      $('db-qty')?.value,
      $('db-quantity-panel')?.dataset?.foodnoteQuantityValue,
      window.__foodnoteStableQuantityValue,
      window.__foodnoteDbQuantityFinalValue
    ].map(num).filter(v => v != null);
    return candidates.length ? candidates[0] : 100;
  }

  function openStableQuantity(food, index, meta){
    state.food = food;
    state.index = Number(index);
    state.source = meta && meta.source || food.source || 'base';
    state.bddId = meta && meta.bddId || food.bddId || food.id || null;
    state.pickedAt = now();
    state.qty = null;
    state.qtyAt = 0;
    setSelectedInput(food);
    keepSuggestionsVisible(index);
    try {
      if (typeof window.openDBQuantitySelector === 'function') {
        window.openDBQuantitySelector(food, Object.assign({}, meta || {}, {
          source: state.source,
          external: state.source !== 'base' || !!food.external,
          bddId: state.bddId,
          keepSuggestions: true,
          pickedIndex: index
        }));
      }
    } catch(e) { console.warn('[FoodNoteStablePick] ouverture quantité impossible', e); }
    [0, 40, 120, 260, 600].forEach(delay => setTimeout(() => {
      if (state.food !== food) return;
      setSelectedInput(food);
      keepSuggestionsVisible(index);
    }, delay));
  }

  function handlePick(index){
    const picked = getSuggestion(index);
    if (!picked) return false;
    if (picked.type === 'create') {
      try { if (typeof window.prepareNewFoodFromSearch === 'function') window.prepareNewFoodFromSearch(); } catch(e) {}
      return true;
    }
    if (picked.type !== 'item' || !picked.food) return true;
    openStableQuantity(picked.food, index, picked);
    return true;
  }

  function pickEvent(ev){
    const target = ev && ev.target;
    const el = target && target.closest && target.closest('#db-suggestions [data-food-add-action="search-pick"], #db-suggestions [data-food-search-result="1"]');
    if (!el) return;
    const index = Number(el.dataset.searchIndex ?? el.dataset.index ?? -1);
    if (!Number.isInteger(index) || index < 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    const t = now();
    if (state.lastIndex === index && t - state.lastEventAt < 350) {
      keepSuggestionsVisible(index);
      setSelectedInput(state.food);
      return;
    }
    state.lastIndex = index;
    state.lastEventAt = t;
    handlePick(index);
  }

  function quantityEvent(ev){
    const target = ev && ev.target;
    if (!target || !target.matches) return;
    if (!target.matches('#db-qty, #db-quantity-input, #db-quantity-range, [data-food-add-quantity-input]')) return;
    if (!state.food && !(typeof window.isDBQuantitySelectorOpen === 'function' && window.isDBQuantitySelectorOpen())) return;
    const q = syncQuantityDom(target.value);
    if (q != null && state.food) {
      setSelectedInput(state.food);
      keepSuggestionsVisible(state.index);
    }
  }


  function closeOrManualSearchEvent(ev){
    const target = ev && ev.target;
    if (!target) return;
    if (target.closest && target.closest('[data-food-add-action="quantity-close"]')) {
      state.food = null;
      state.index = -1;
      state.qty = null;
      state.qtyAt = 0;
      return;
    }
    if (target.id === 'db-search' && state.food) {
      const expected = text(state.food.nom || state.food.name);
      const current = text(target.value);
      if (current && expected && current !== expected && now() > Number(window.__foodnoteSelectedSearchLockUntil || 0)) {
        state.food = null;
        state.index = -1;
        state.qty = null;
        state.qtyAt = 0;
      }
    }
  }

  function addStableSelection(){
    const food = state.food || (getSearchState() && getSearchState().quantityFood) || window.__foodnoteSelectedSearchFood;
    if (!food || !text(food.nom || food.name)) return false;
    const qty = readStableQuantity();
    const payload = Object.assign({}, food, {
      nom: text(food.nom || food.name),
      defaut: qty,
      qty: qty,
      unite: 'g',
      poidsUnite: null,
      uniteLabel: '',
      bddId: state.bddId || food.bddId || food.id || null,
      source: food.source || state.source || 'base',
      meal: selectedMeal()
    });
    try {
      if (typeof window.addCustomAliment !== 'function') throw new Error('addCustomAliment indisponible');
      window.addCustomAliment(payload);
      state.addedAt = now();
      clearStableSelection(`✓ ${payload.nom} ajouté. Choisis le suivant.`);
      return true;
    } catch(e) {
      console.error('[FoodNoteStablePick] ajout impossible', e);
      try { alert('Ajout impossible : ' + (e && e.message ? e.message : e)); } catch(_) {}
      return false;
    }
  }

  function clearStableSelection(message){
    state.food = null;
    state.index = -1;
    state.source = '';
    state.bddId = null;
    state.qty = null;
    state.qtyAt = 0;
    try {
      window.__foodnoteStableQuantityValue = null;
      window.__foodnoteStableQuantityAt = 0;
      window.__foodnoteKeepDBSuggestionsVisibleUntil = 0;
      window.__foodnoteSelectedSearchLockUntil = 0;
    } catch(e) {}
    try {
      if (typeof window.resetFoodAddSearchAfterAdd === 'function') window.resetFoodAddSearchAfterAdd(message);
    } catch(e) {}
  }

  function confirmEvent(ev){
    const target = ev && ev.target;
    if (!target || !target.closest) return;
    const actionEl = target.closest('[data-food-add-action="quantity-confirm"], #food-main-action-btn');
    if (!actionEl) return;
    const action = actionEl.dataset && actionEl.dataset.foodAddAction;
    const isQuantityConfirm = action === 'quantity-confirm';
    const isMainWhileQuantity = actionEl.id === 'food-main-action-btn' && (state.food || (typeof window.isDBQuantitySelectorOpen === 'function' && window.isDBQuantitySelectorOpen()));
    if (!isQuantityConfirm && !isMainWhileQuantity) return;
    if (!state.food && !(getSearchState() && getSearchState().quantityFood)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    if (now() - state.addedAt < 900) return;
    addStableSelection();
  }

  function install(){
    ['pointerdown','mousedown','touchstart','touchend','click'].forEach(type => document.addEventListener(type, pickEvent, true));
    document.addEventListener('input', quantityEvent, true);
    document.addEventListener('change', quantityEvent, true);
    document.addEventListener('click', confirmEvent, true);
    document.addEventListener('pointerdown', confirmEvent, true);
    document.addEventListener('click', closeOrManualSearchEvent, true);
    document.addEventListener('input', closeOrManualSearchEvent, true);
    try { window.dispatchEvent(new CustomEvent('foodnote:stable-search-pick-quantity:ready', { detail: audit() })); } catch(e) {}
    console.info('[FoodNoteStablePickQuantity] chargé', VERSION);
  }

  function audit(){
    return {
      version: VERSION,
      installed: true,
      hasFood: !!state.food,
      selectedName: state.food && state.food.nom || '',
      quantity: state.qty,
      pickedIndex: state.index,
      suggestionsVisible: !!$('db-suggestions')?.classList.contains('visible')
    };
  }

  window.FoodNoteStablePickQuantity = { version: VERSION, audit, readQuantity: readStableQuantity };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
