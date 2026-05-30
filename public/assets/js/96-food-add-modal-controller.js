/* FoodNote beta 0.22.118 — JOURNAL_ADD_REAL_FREEZE_FIX
 * Contrôleur unique du popup Ajouter.
 * Correctif : recherche après ajout synchronisée avec l’ancien moteur + actions caméra détachées.
 */
(function FoodNoteFoodAddModalControllerModule(){
  'use strict';

  const VERSION = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const MODES = Object.freeze({
    SEARCH: 'search',
    ESTIMATE: 'estimate',
    RECIPES: 'recipes',
    QUICK: 'quick',
    BARCODE: 'barcode',
    NUTRITION_TABLE: 'nutrition_table',
    RECIPE: 'recipe',
    CAPTURE: 'capture',
    SAVED: 'saved',
    ERROR: 'error'
  });

  const MODE_LABELS = Object.freeze({
    search: 'Recherche aliment',
    estimate: 'Estimation IA',
    recipes: 'Recette',
    quick: 'Mémoire rapide',
    barcode: 'Scan code-barres',
    nutrition_table: 'Tableau nutritionnel',
    recipe: 'Photo recette',
    capture: 'Capture alimentaire',
    saved: 'Ajout confirmé',
    error: 'Erreur'
  });


  const VIEW_REGISTRY = Object.freeze({
    search: {
      label: 'Recherche aliment',
      workflow: 'idle',
      expanded: false,
      show: [],
      hide: ['#barcode-scan-panel', '#ocr-panel']
    },
    estimate: {
      label: 'Estimation IA',
      workflow: 'idle',
      expanded: true,
      show: ['#groq-response'],
      hide: ['#barcode-scan-panel', '#ocr-panel', '#db-suggestions', '#quick-foods-card']
    },
    recipes: {
      label: 'Recettes enregistrées',
      workflow: 'idle',
      expanded: true,
      show: [],
      hide: ['#barcode-scan-panel', '#ocr-panel', '#db-suggestions']
    },
    quick: {
      label: 'Mémoire rapide',
      workflow: 'idle',
      expanded: true,
      show: ['#quick-foods-card'],
      hide: ['#barcode-scan-panel', '#ocr-panel', '#db-suggestions']
    },
    barcode: {
      label: 'Scan code-barres',
      workflow: 'barcode_scan',
      expanded: true,
      show: ['#barcode-scan-panel'],
      hide: ['#ocr-panel', '#db-suggestions', '#quick-foods-card']
    },
    nutrition_table: {
      label: 'Tableau nutritionnel',
      workflow: 'nutrition_ocr',
      expanded: true,
      show: ['#ocr-panel'],
      hide: ['#barcode-scan-panel', '#db-suggestions', '#quick-foods-card']
    },
    recipe: {
      label: 'Photo recette',
      workflow: 'recipe_ocr',
      expanded: true,
      show: ['#ocr-panel'],
      hide: ['#barcode-scan-panel', '#db-suggestions', '#quick-foods-card']
    },
    capture: {
      label: 'Photo aliment libre',
      workflow: 'capture_workflow',
      expanded: true,
      show: [],
      hide: ['#barcode-scan-panel', '#ocr-panel', '#db-suggestions', '#quick-foods-card']
    },
    saved: {
      label: 'Ajout confirmé',
      workflow: 'idle',
      expanded: true,
      show: ['#journal-last-added'],
      hide: ['#barcode-scan-panel', '#ocr-panel', '#db-suggestions', '#quick-foods-card']
    },
    error: {
      label: 'Erreur',
      workflow: 'error',
      expanded: true,
      show: [],
      hide: ['#db-suggestions', '#quick-foods-card']
    }
  });

  const CONTROLLER_OWNS_POPUP = !!window.__FoodNoteFoodAddModalControllerOwnsPopup;

  const state = {
    installed: false,
    open: false,
    mode: MODES.SEARCH,
    previousMode: '',
    expanded: false,
    busy: false,
    workflow: 'idle',
    targetMeal: '',
    suppressSearchFocusUntil: 0,
    opening: false,
    closing: false,
    reconciling: false,
    syncingEnhancer: false,
    mutationTimer: 0,
    savedTimer: 0,
    originals: Object.create(null),
    wrappers: Object.create(null),
    observer: null,
    observerEnabled: false,
    observerDisabledReason: 'hardening_checkpoint_event_driven',
    reconcileRequests: 0,
    lastReason: '',
    lastAction: '',
    lastError: '',
    blockedActions: 0,
    actionLocks: Object.create(null),
    lastStateAt: 0,
    lastView: '',
    lastViewAppliedAt: 0
  };

  const $ = (id) => document.getElementById(id);
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const now = () => Date.now();

  function log(){
    try { console.debug.apply(console, ['[FoodAddModalController]'].concat(Array.from(arguments))); } catch(e) {}
  }

  function emit(name, detail){
    try { window.dispatchEvent(new CustomEvent('foodnote:food-add-modal:' + name, { detail: detail || snapshot() })); } catch(e) {}
  }

  function snapshot(){
    return {
      version: VERSION,
      open: state.open,
      mode: state.mode,
      previousMode: state.previousMode,
      expanded: state.expanded,
      busy: state.busy,
      workflow: state.workflow,
      targetMeal: state.targetMeal,
      lastReason: state.lastReason,
      lastAction: state.lastAction,
      lastError: state.lastError,
      blockedActions: state.blockedActions,
      lastStateAt: state.lastStateAt
    };
  }

  function modal(){ return $('food-add-modal'); }
  function isVisible(el){
    if (!el) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return !(el.hidden || el.getAttribute('aria-hidden') === 'true' || el.style.display === 'none' || (style && style.display === 'none'));
  }
  function modalIsOpen(){
    const m = modal();
    return !!(m && (m.classList.contains('is-open') || m.getAttribute('aria-hidden') === 'false' || m.style.display === 'flex'));
  }

  function keepSearchSuggestionsVisible(){
    try {
      if (typeof window.foodnoteShouldKeepDBSuggestionsVisible === 'function' && window.foodnoteShouldKeepDBSuggestionsVisible()) return true;
      if (typeof window.foodnoteIsDBQuantityFlowActive === 'function' && window.foodnoteIsDBQuantityFlowActive()) return true;
      if (Number(window.__foodnoteKeepDBSuggestionsVisibleUntil || 0) > now()) return true;
      const box = $('db-suggestions');
      return !!(box && box.dataset.foodnoteKeepVisible === '1' && Number(box.dataset.foodnoteKeepVisibleUntil || 0) > now());
    } catch(e) { return false; }
  }

  function restoreSearchSuggestionsVisibility(){
    const box = $('db-suggestions');
    if (!box || !keepSearchSuggestionsVisible()) return false;
    box.classList.add('visible');
    box.removeAttribute('aria-hidden');
    try {
      box.style.removeProperty('display');
      box.style.removeProperty('visibility');
      box.style.removeProperty('pointer-events');
    } catch(e) {}
    const m = modal();
    if (m) {
      m.classList.add('food-add-expanded', 'fn-suggestions-open');
      m.classList.remove('fn-modal-view-capture-family');
      m.classList.add('fn-modal-view-search-family', 'fn-modal-mode-search');
      m.dataset.fnModalMode = MODES.SEARCH;
      m.dataset.fnModalView = MODES.SEARCH;
    }
    return true;
  }

  function normalizeMode(mode){
    const raw = String(mode || '').toLowerCase().replace(/-/g, '_').trim();
    if (!raw) return MODES.SEARCH;
    if (raw === 'ia' || raw === 'ai' || raw === 'ai_analysis' || raw === 'ia_text' || raw === 'estimate_food') return MODES.ESTIMATE;
    if (raw === 'recipe_ocr' || raw === 'recipe_photo' || raw === 'photo_recipe' || raw === 'recette') return MODES.RECIPE;
    if (raw === 'nutrition' || raw === 'nutrition_ocr' || raw === 'nutrition_table_ocr' || raw === 'tableau' || raw === 'table') return MODES.NUTRITION_TABLE;
    if (raw === 'barcode_scan' || raw === 'barcode_result' || raw === 'scan' || raw === 'scan_barcode' || raw === 'codebarre' || raw === 'code_barres') return MODES.BARCODE;
    if (raw === 'capture_workflow' || raw === 'photo_food' || raw === 'photo_capture' || raw === 'crop') return MODES.CAPTURE;
    if (raw === 'confirm_food' || raw === 'confirm_recipe' || raw === 'saved') return MODES.SAVED;
    if (raw === 'error') return MODES.ERROR;
    if (raw === 'quick' || raw === 'memory') return MODES.QUICK;
    if (raw === 'recipes' || raw === 'recipe_list') return MODES.RECIPES;
    return Object.values(MODES).includes(raw) ? raw : MODES.SEARCH;
  }

  function legacyModeFor(mode){
    if (mode === MODES.ESTIMATE) return 'ia';
    if (mode === MODES.QUICK) return 'quick';
    return 'search';
  }

  function rememberOriginal(name){
    const fn = window[name];
    if (typeof fn !== 'function') return null;
    if (fn.__fnFoodAddModalControllerWrapped) return state.originals[name] || null;
    state.originals[name] = fn;
    return fn;
  }

  function callOriginal(name, thisArg, args){
    const fn = state.originals[name];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(thisArg || window, args || []);
  }

  function wrap(name, wrapperFactory){
    const current = window[name];
    if (typeof current !== 'function') return false;
    if (current.__fnFoodAddModalControllerWrapped) return true;
    state.originals[name] = current;
    const wrapped = wrapperFactory(current);
    if (typeof wrapped !== 'function') return false;
    wrapped.__fnFoodAddModalControllerWrapped = true;
    wrapped.__fnFoodAddModalControllerOriginal = current;
    window[name] = wrapped;
    state.wrappers[name] = wrapped;
    return true;
  }

  function hideElement(el, important){
    if (!el) return;
    if (important && el.style && typeof el.style.setProperty === 'function') el.style.setProperty('display', 'none', 'important');
    else el.style.display = 'none';
    el.classList.remove('visible', 'is-open', 'active');
    el.setAttribute('aria-hidden', 'true');
  }

  function showElement(el){
    if (!el) return;
    el.style.removeProperty('display');
    el.removeAttribute('aria-hidden');
  }


  function selectorElements(selector){
    if (!selector) return [];
    try { return qa(selector); } catch(e) { return []; }
  }

  function showSurface(selector){
    selectorElements(selector).forEach(el => {
      if (!el) return;
      if (el.id === 'capture-workflow-modal') {
        // La modale de capture a son propre contrôleur : on ne force pas son affichage ici.
        return;
      }
      el.style.removeProperty('display');
      if (window.getComputedStyle && window.getComputedStyle(el).display === 'none') {
        el.style.display = 'block';
      }
      el.removeAttribute('aria-hidden');
      el.classList.add('fn-modal-surface-active');
    });
  }

  function hideSurface(selector){
    selectorElements(selector).forEach(el => {
      if (!el) return;
      if (selector === '#db-suggestions' && keepSearchSuggestionsVisible()) { restoreSearchSuggestionsVisibility(); return; }
      if (el.id === 'journal-last-added' && el.classList.contains('visible')) return;
      hideElement(el, selector === '#db-suggestions' || selector === '#quick-foods-card');
      el.classList.remove('fn-modal-surface-active');
    });
  }

  function viewForMode(mode){
    return VIEW_REGISTRY[normalizeMode(mode)] || VIEW_REGISTRY.search;
  }

  function applyViewState(reason = 'view'){
    const m = modal();
    if (!m) return;
    const view = viewForMode(state.mode);
    const key = normalizeMode(state.mode);
    state.lastView = key;
    state.lastViewAppliedAt = now();
    m.dataset.fnModalView = key;
    m.dataset.fnModalViewLabel = view.label || MODE_LABELS[key] || key;
    if (view.workflow && state.workflow === 'idle') state.workflow = view.workflow;
    if (view.expanded === true) state.expanded = true;
    const allHide = new Set(view.hide || []);
    Object.keys(VIEW_REGISTRY).forEach(name => {
      if (name === key) return;
      (VIEW_REGISTRY[name].show || []).forEach(sel => allHide.add(sel));
    });

    // 0.22.109 : en mode recherche, la carte de prédictions/suggestions rapides
    // appartient au moteur FoodNoteAddV0160. Le registre de vues ne doit pas la
    // masquer systématiquement, sinon les prédictions alimentaires disparaissent.
    // On ne force pas son affichage ici : on lui laisse juste le droit d'exister.
    if (key === MODES.SEARCH) {
      allHide.delete('#quick-foods-card');
    }

    (view.show || []).forEach(sel => allHide.delete(sel));
    allHide.forEach(hideSurface);
    (view.show || []).forEach(showSurface);
    const badge = $('food-add-mode-badge');
    if (badge) {
      badge.textContent = view.label || MODE_LABELS[key] || 'Ajouter';
      badge.dataset.fnModalView = key;
    }
    m.classList.toggle('fn-modal-view-search-family', key === MODES.SEARCH || key === MODES.ESTIMATE || key === MODES.RECIPES || key === MODES.QUICK);
    m.classList.toggle('fn-modal-view-capture-family', key === MODES.BARCODE || key === MODES.NUTRITION_TABLE || key === MODES.RECIPE || key === MODES.CAPTURE);
    emit('view', Object.assign(snapshot(), { view: key, reason }));
  }

  function hideSearchOutputs(){
    if (keepSearchSuggestionsVisible()) {
      restoreSearchSuggestionsVisibility();
      const quickKeep = $('quick-foods-card');
      if (quickKeep) hideElement(quickKeep, true);
      return;
    }
    const suggestions = $('db-suggestions');
    if (suggestions) {
      suggestions.classList.remove('visible');
      suggestions.innerHTML = '';
    }
    const quick = $('quick-foods-card');
    if (quick) hideElement(quick, true);
    const modalEl = modal();
    if (modalEl) modalEl.classList.remove('fn-suggestions-open');
  }

  function hideDetachedWorkAreas(options = {}){
    if (options.keepCamera !== true) {
      const barcode = $('barcode-scan-panel');
      if (barcode) hideElement(barcode, false);
      const cameraWrap = $('barcode-camera-wrap');
      if (cameraWrap) hideElement(cameraWrap, false);
    }
    if (options.keepOcr !== true) {
      const ocr = $('ocr-panel');
      if (ocr) hideElement(ocr, false);
    }
  }

  function inferWorkflowFromDom(){
    const m = modal();
    if (!m) return 'idle';
    if (q('#capture-workflow-modal.visible')) return 'capture_workflow';
    const ds = String(m.dataset.foodnoteWorkflow || '').trim();
    if (ds) return ds;
    if (m.classList.contains('food-add-recipe-processing')) return 'recipe_processing';
    if (m.classList.contains('food-add-recipe-crop') || m.classList.contains('food-add-nutrition-crop')) return 'crop';
    if (m.classList.contains('food-add-recipe-mode') || m.classList.contains('food-add-recipe-result')) return 'recipe_ocr';
    if (isVisible($('barcode-scan-panel'))) return 'barcode_scan';
    if (isVisible($('ocr-panel'))) return 'nutrition_ocr';
    return 'idle';
  }

  function inferModeFromDom(){
    const workflow = inferWorkflowFromDom();
    if (workflow === 'capture_workflow') return MODES.CAPTURE;
    if (/recipe/i.test(workflow)) return MODES.RECIPE;
    if (/barcode/i.test(workflow)) return MODES.BARCODE;
    if (/nutrition|ocr|crop/i.test(workflow)) return MODES.NUTRITION_TABLE;
    const m = modal();
    if (!m) return state.mode || MODES.SEARCH;
    if (m.classList.contains('food-intent-estimate')) return MODES.ESTIMATE;
    if (m.classList.contains('food-intent-recipes')) return MODES.RECIPES;
    return state.mode || MODES.SEARCH;
  }

  function setSearchFocusSuppressed(ms = 900){
    state.suppressSearchFocusUntil = Math.max(state.suppressSearchFocusUntil, now() + Math.max(0, Number(ms) || 0));
  }

  function intentForMode(mode){
    if (mode === MODES.ESTIMATE) return 'estimate';
    if (mode === MODES.RECIPES) return 'recipes';
    return 'search';
  }

  function syncFoodAddEnhancer(mode, options = {}){
    const enhancer = window.FoodNoteAddV0160;
    if (!enhancer || state.syncingEnhancer) return;
    state.syncingEnhancer = true;
    try {
      if (typeof enhancer.init === 'function' && modalIsOpen()) enhancer.init(true, { deferSuggestions: mode === MODES.SEARCH });
      if (typeof enhancer.setIntent === 'function' && (mode === MODES.SEARCH || mode === MODES.ESTIMATE || mode === MODES.RECIPES)) {
        enhancer.setIntent(intentForMode(mode), { keepText:true, deferSuggestions: mode === MODES.SEARCH, forceWorkflowExit: options.forceWorkflowExit === true });
      }
    } catch(e) {}
    finally { state.syncingEnhancer = false; }
  }

  function shouldSuppressSearchFocus(){
    if (now() < state.suppressSearchFocusUntil) return true;
    if (!modalIsOpen()) return false;
    const mode = state.mode;
    return mode !== MODES.SEARCH && mode !== MODES.ESTIMATE && mode !== MODES.QUICK && mode !== MODES.RECIPES && mode !== MODES.SAVED;
  }

  function blurSearchIfNeeded(){
    const input = $('db-search');
    if (!input) return;
    if (document.activeElement === input && shouldSuppressSearchFocus()) {
      try { input.blur(); } catch(e) {}
    }
  }

  function applyDomState(reason = 'apply'){
    const m = modal();
    if (!m || state.reconciling) return;
    state.reconciling = true;
    try {
      state.open = modalIsOpen();
      state.workflow = inferWorkflowFromDom();
      const inferred = inferModeFromDom();
      if (state.workflow !== 'idle' && inferred !== state.mode && state.mode !== MODES.SAVED) {
        state.previousMode = state.mode;
        state.mode = inferred;
      }
      state.lastReason = reason;
      state.lastStateAt = now();

      m.classList.add('fn-food-add-managed', 'fn-modal-controller-ready');
      m.dataset.fnModalController = VERSION;
      m.dataset.fnModalMode = state.mode;
      m.dataset.fnModalWorkflow = state.workflow;
      m.dataset.fnModalOpen = state.open ? '1' : '0';
      m.dataset.fnModalExpanded = state.expanded ? '1' : '0';
      applyViewState(reason);
      m.dataset.fnModalMode = state.mode;
      m.dataset.fnModalWorkflow = state.workflow;
      m.dataset.fnModalExpanded = state.expanded ? '1' : '0';

      Object.values(MODES).forEach(mode => m.classList.remove('fn-modal-mode-' + mode.replace(/_/g, '-')));
      m.classList.add('fn-modal-mode-' + state.mode.replace(/_/g, '-'));
      m.classList.toggle('fn-modal-has-workflow', state.workflow !== 'idle');
      m.classList.toggle('fn-modal-is-busy', !!state.busy || /processing/i.test(state.workflow));
      m.classList.toggle('food-add-expanded', !!state.expanded || state.workflow !== 'idle');

      if (state.mode !== MODES.SEARCH && state.mode !== MODES.SAVED) hideSearchOutputs();
      if (state.mode === MODES.SEARCH) {
        const selectedCard = $('db-selected-card');
        if (selectedCard && selectedCard.textContent && selectedCard.textContent.trim()) m.classList.add('food-add-expanded');
      }
      restoreSearchSuggestionsVisibility();
      blurSearchIfNeeded();
      emit('state', snapshot());
    } finally {
      state.reconciling = false;
    }
  }

  function scheduleReconcile(reason = 'event', delay = 30){
    state.reconcileRequests += 1;
    clearTimeout(state.mutationTimer);
    state.mutationTimer = setTimeout(() => applyDomState(reason), Math.max(0, Number(delay) || 0));
  }

  function setExpanded(expanded, options = {}){
    state.expanded = !!expanded;
    if (options.callLegacy !== false && typeof state.originals.setFoodAddExpanded === 'function') {
      try { callOriginal('setFoodAddExpanded', window, [expanded]); } catch(e) {}
    }
    applyDomState(options.reason || 'expanded');
  }

  function setMode(mode, options = {}){
    const next = normalizeMode(mode);
    if (next !== state.mode) state.previousMode = state.mode;
    state.mode = next;
    if (next === MODES.BARCODE || next === MODES.NUTRITION_TABLE || next === MODES.RECIPE || next === MODES.CAPTURE) {
      state.workflow = next;
      setSearchFocusSuppressed(options.focusSuppressMs || 1800);
    } else if (next === MODES.SEARCH || next === MODES.ESTIMATE || next === MODES.RECIPES || next === MODES.QUICK) {
      state.workflow = inferWorkflowFromDom();
      if (state.workflow === 'idle') setSearchFocusSuppressed(options.noFocus ? 700 : 0);
    }

    if (options.callLegacy !== false && (next === MODES.SEARCH || next === MODES.ESTIMATE || next === MODES.QUICK)) {
      try { callOriginal('setFoodAddMode', window, [legacyModeFor(next)]); } catch(e) {}
    }
    syncFoodAddEnhancer(next, options);

    if (next !== MODES.SEARCH && next !== MODES.SAVED) hideSearchOutputs();
    applyDomState(options.reason || 'mode');
    return state.mode;
  }

  function resetTransientUi(options = {}){
    clearTimeout(state.savedTimer);
    state.busy = false;
    state.workflow = 'idle';
    state.expanded = false;
    hideSearchOutputs();
    try { window.FoodNoteFoodAddUX1513 && window.FoodNoteFoodAddUX1513.closeToolSheet && window.FoodNoteFoodAddUX1513.closeToolSheet(); } catch(e) {}
    try { window.FoodNoteAddV0160 && window.FoodNoteAddV0160.endWorkflow && window.FoodNoteAddV0160.endWorkflow(); } catch(e) {}
    if (options.closePanels !== false) hideDetachedWorkAreas({ keepCamera:false, keepOcr:false });
    const lastAdded = $('journal-last-added');
    if (lastAdded && options.keepLastAdded !== true) {
      lastAdded.classList.remove('visible');
      lastAdded.innerHTML = '';
      delete lastAdded.dataset.foodIdx;
    }
    const status = $('ia-parse-status');
    if (status && options.keepStatus !== true) {
      status.textContent = '';
      status.classList.remove('error');
    }
    const ocrStatus = $('ocr-status');
    if (ocrStatus && options.keepStatus !== true) ocrStatus.textContent = '';
    const barcodeStatus = $('barcode-status');
    if (barcodeStatus && options.keepStatus !== true) barcodeStatus.textContent = '';
    const groq = $('groq-response');
    if (groq && options.keepIA !== true) { groq.style.display = 'none'; groq.textContent = ''; groq.innerHTML = ''; }
  }

  function callGlobal(name, args = []){
    const fn = window[name];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(window, args);
  }

  function runAction(name, args = [], options = {}){
    const fn = window[name];
    if (typeof fn !== 'function') {
      if (options.required) showError(options.error || ('Action indisponible : ' + name));
      return undefined;
    }
    try { return fn.apply(window, args); }
    catch(e) {
      showError(e && e.message ? e.message : e);
      return undefined;
    }
  }



  function runCaptureFlow(method, args = [], options = {}){
    const flows = window.FoodNoteFoodCaptureFlows;
    if (flows && typeof flows[method] === 'function') {
      try { return flows[method].apply(flows, Array.isArray(args) ? args : [args]); }
      catch(e) { showError(e && e.message ? e.message : e); return undefined; }
    }
    if (options.fallbackAction) return runAction(options.fallbackAction, args, options);
    if (options.required) showError(options.error || ('Flux capture indisponible : ' + method));
    return undefined;
  }


  function runSearchResultFlow(method, args = [], options = {}){
    const flow = window.FoodNoteFoodAddSearchResults;
    if (flow && typeof flow[method] === 'function') {
      try { return flow[method].apply(flow, Array.isArray(args) ? args : [args]); }
      catch(e) { showError(e && e.message ? e.message : e); return undefined; }
    }
    if (options.fallbackAction) return runAction(options.fallbackAction, args, options);
    if (options.required) showError(options.error || ('Flux recherche indisponible : ' + method));
    return undefined;
  }

  function runUxAction(method, args = [], options = {}){
    const candidates = [window.FoodNoteAddV0160, window.FoodNoteFoodAddUX1513, window.FoodNoteFoodAddUX1512, window.FoodNoteFoodAddUX1511].filter(Boolean);
    const target = candidates.find(obj => obj && typeof obj[method] === 'function');
    if (!target) {
      if (options.required) showError(options.error || ('Action popup indisponible : ' + method));
      return undefined;
    }
    try { return target[method].apply(target, args); }
    catch(e) { showError(e && e.message ? e.message : e); return undefined; }
  }

  function runOpenSideEffects(){
    try { callGlobal('scheduleFoodsWarmup', [0]); } catch(e) {}
    try { callGlobal('resetFoodAddGroqVisualState'); } catch(e) {}
    try { callGlobal('syncFoodSourceFilterButtons'); } catch(e) {}
    try { callGlobal('syncFoodAddMealButtons'); } catch(e) {}
    try { callGlobal('renderCurrentMealFoods'); } catch(e) {}
  }

  function ensureModalInBody(){
    const m = modal();
    if (!m) return null;
    if (m.parentElement !== document.body) {
      try { document.body.appendChild(m); } catch(e) {}
    }
    return m;
  }

  function applyOpenDom(){
    const m = ensureModalInBody();
    if (!m) return null;
    try { m.inert = false; } catch(e) {}
    m.style.display = 'flex';
    m.style.position = 'fixed';
    m.style.inset = '0';
    m.style.zIndex = '12000';
    m.classList.add('is-open', 'fn-food-add-managed');
    m.setAttribute('aria-hidden', 'false');
    m.dataset.fnModalOwner = 'FoodNoteFoodAddModalController';
    document.body.classList.add('food-add-modal-open');
    return m;
  }

  function applyClosedDom(){
    const m = modal();
    if (!m) return;
    try {
      const active = document.activeElement;
      if (active && m.contains(active) && typeof active.blur === 'function') active.blur();
    } catch(e) {}
    m.classList.remove('is-open', 'food-add-expanded', 'fn-suggestions-open');
    m.setAttribute('aria-hidden', 'true');
    m.dataset.fnModalOpen = '0';
    try { m.inert = true; } catch(e) {}
    m.style.display = 'none';
    document.body.classList.remove('food-add-modal-open');
  }

  function runCloseSideEffects(){
    try {
      if (window.FoodNoteFoodCaptureFlows && typeof window.FoodNoteFoodCaptureFlows.closeAll === 'function') {
        window.FoodNoteFoodCaptureFlows.closeAll({ reason:'modal-close' });
      } else {
        callGlobal('closeBarcodeScannerPanel');
        callGlobal('closeOCRPanel');
      }
    } catch(e) {
      try { callGlobal('closeBarcodeScannerPanel'); } catch(err) {}
      try { callGlobal('closeOCRPanel'); } catch(err) {}
    }
    try { callGlobal('resetFoodAddGroqVisualState'); } catch(e) {}
    try {
      setTimeout(() => {
        try {
          if (typeof window.reconcileVisibleMealLines === 'function') {
            window.reconcileVisibleMealLines('modal-controller-close', { regroup:true, currentMeal:false, carousel:true });
          }
        } catch(e) {}
      }, 0);
    } catch(e) {}
  }

  function focusSearchIfRequested(options = {}){
    if (options.focus !== true) return;
    setTimeout(() => {
      if (!modalIsOpen() || shouldSuppressSearchFocus()) return;
      const input = $('db-search');
      if (!input) return;
      try { input.focus({ preventScroll:true }); if (input.value && typeof input.select === 'function') input.select(); } catch(e) {}
    }, 70);
  }

  function stripLegacyInlineCloseHandlers(){
    const m = modal();
    if (m && m.getAttribute('onclick')) {
      m.removeAttribute('onclick');
      m.dataset.fnOverlayClose = '1';
    }
    const closeBtn = q('#food-add-modal .food-add-close');
    if (closeBtn) {
      if (closeBtn.getAttribute('onclick')) closeBtn.removeAttribute('onclick');
      closeBtn.setAttribute('data-food-add-close', '1');
      closeBtn.setAttribute('type', 'button');
    }
  }

  function open(options = {}){
    const opts = typeof options === 'string' ? { meal: options } : (options || {});
    state.opening = true;
    state.closing = false;
    state.open = true;
    state.targetMeal = opts.meal || state.targetMeal || '';
    setSearchFocusSuppressed(opts.focus === true ? 0 : 900);

    try {
      if (state.targetMeal && typeof window.setFoodAddTargetMeal === 'function') window.setFoodAddTargetMeal(state.targetMeal);
    } catch(e) {}

    let out;
    try {
      runOpenSideEffects();
      applyOpenDom();
      stripLegacyInlineCloseHandlers();
      syncFoodAddEnhancer(opts.mode || MODES.SEARCH, { forceWorkflowExit:true });
      setMode(opts.mode || MODES.SEARCH, { callLegacy: opts.callLegacy !== false, reason:'open', noFocus: opts.focus !== true, forceWorkflowExit:true });
      focusSearchIfRequested(opts);
      emit('opened', snapshot());
    } finally {
      state.opening = false;
    }

    scheduleReconcile('open-after-paint', 80);
    return out;
  }

  function close(options = {}){
    if (state.closing) return;
    state.closing = true;
    state.opening = false;
    try {
      runCloseSideEffects();
      applyClosedDom();
    } finally {
      resetTransientUi({ closePanels: options.closePanels !== false });
      state.open = false;
      state.mode = MODES.SEARCH;
      state.previousMode = '';
      state.workflow = 'idle';
      state.expanded = false;
      state.busy = false;
      state.closing = false;
      applyDomState('close');
      emit('closed', snapshot());
    }
  }

  function goToFoodAdd(meal){
    state.targetMeal = meal || state.targetMeal || '';
    try {
      if (state.targetMeal && typeof window.setFoodAddTargetMeal === 'function') window.setFoodAddTargetMeal(state.targetMeal);
    } catch(e) {}
    try {
      if (typeof window.showPage === 'function') window.showPage('journal', $('nav-journal'));
    } catch(e) {}
    return setTimeout(() => open({ meal: state.targetMeal, callLegacy:true }), 80);
  }

  function markWorkflow(mode, options = {}){
    setMode(mode, { callLegacy:false, reason: options.reason || 'workflow', focusSuppressMs: options.focusSuppressMs || 1800 });
    setExpanded(true, { callLegacy:true, reason: 'workflow-expanded' });
  }

  function captureModeFor(mode, name){
    const cap = window.FoodNoteCapture && window.FoodNoteCapture.MODES;
    if (!cap) return '';
    if (name === 'openFoodPhotoOption' || name === 'openFoodBarcodeFromPhoto' || name === 'toggleBarcodeScanner') return cap.BARCODE;
    if (mode === MODES.BARCODE) return cap.BARCODE;
    if (mode === MODES.NUTRITION_TABLE) return cap.NUTRITION_TABLE;
    if (mode === MODES.RECIPE) return cap.RECIPE;
    if (mode === MODES.CAPTURE) return cap.PHOTO_FOOD;
    return '';
  }

  function openCaptureFlow(mode, name){
    if (!CONTROLLER_OWNS_POPUP) return false;
    const flows = window.FoodNoteFoodCaptureFlows;
    if (flows && typeof flows.open === 'function') {
      try {
        const handled = flows.open(mode, { legacyName:name, source:'modal-controller' });
        if (handled !== false) return true;
      } catch(e) {
        showError(e && e.message ? e.message : e);
        return true;
      }
    }
    if (!window.FoodNoteCapture || typeof window.FoodNoteCapture.open !== 'function') return false;
    const captureMode = captureModeFor(mode, name);
    if (!captureMode) return false;
    try { close({ closePanels:true }); } catch(e) {}
    try { window.FoodNoteCapture.open(captureMode); return true; }
    catch(e) { showError(e && e.message ? e.message : e); return true; }
  }

  function notifySaved(idx){
    setMode(MODES.SAVED, { callLegacy:false, reason:'saved', noFocus:true });
    setExpanded(true, { callLegacy:true, reason:'saved-expanded' });
    clearTimeout(state.savedTimer);
    state.savedTimer = setTimeout(() => {
      const box = $('journal-last-added');
      if (box && box.contains(document.activeElement)) {
        notifySaved(idx);
        return;
      }
      if (state.mode === MODES.SAVED) {
        state.mode = MODES.SEARCH;
        state.workflow = inferWorkflowFromDom();
        if (state.workflow === 'idle') setExpanded(false, { callLegacy:true, reason:'saved-autohide' });
        applyDomState('saved-autohide');
      }
    }, 3200);
  }

  function showError(message){
    state.mode = MODES.ERROR;
    state.busy = false;
    state.lastError = String(message || 'Une erreur est survenue.');
    const status = $('ia-parse-status') || $('ocr-status') || $('barcode-status');
    if (status) {
      status.textContent = state.lastError;
      status.classList.add('error');
    }
    applyDomState('error');
  }

  function handleMainAction(){
    state.busy = true;
    applyDomState('main-action-start');
    try { return callOriginal('handleFoodMainAction', window, Array.from(arguments)); }
    finally {
      setTimeout(() => { state.busy = false; applyDomState('main-action-end'); }, 120);
    }
  }

  function installFocusGuard(){
    if (document.__fnFoodAddModalControllerFocusGuard) return;
    document.addEventListener('focusin', (ev) => {
      const target = ev.target;
      if (!target || target.id !== 'db-search') return;
      if (shouldSuppressSearchFocus()) {
        setTimeout(() => { try { target.blur(); } catch(e) {} }, 0);
      }
    }, true);
    document.__fnFoodAddModalControllerFocusGuard = true;
  }



  const CRITICAL_ACTIONS = new Set([
    'main',
    'estimate-run',
    'open-plate-photo',
    'open-product-photo',
    'scan-recipe',
    'toggle-nutrition-auto',
    'nutrition-ocr-read',
    'recipe-ocr-read',
    'retake-recipe-photo',
    'recipe-ocr-full',
    'recipe-ocr-crop',
    'ocr-save-personal',
    'ocr-add-day',
    'recipe-ai-estimate',
    'recipe-create',
    'recipe-save-personal',
    'recipe-add-day',
    'barcode-nutrition-from-camera',
    'barcode-save-product',
    'barcode-add-day',
    'quantity-confirm',
    'history-add'
  ]);

  function isActionLocked(action){
    const key = String(action || '');
    const until = Number(state.actionLocks[key] || 0);
    return until && until > now();
  }

  function lockAction(action, ms = 900){
    const key = String(action || '');
    if (!key) return;
    state.actionLocks[key] = now() + Math.max(250, Number(ms) || 900);
    setTimeout(() => {
      if (Number(state.actionLocks[key] || 0) <= now()) delete state.actionLocks[key];
    }, Math.max(260, Number(ms) || 900) + 40);
  }

  function statusInline(message, isError = false){
    const el = $('ia-parse-status') || $('ocr-status') || $('barcode-status');
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.toggle('error', !!isError);
  }

  function runDelegatedAction(action, actionEl, ev){
    const handlers = actionHandlers();
    const handler = handlers[action];
    if (typeof handler !== 'function') return scheduleReconcile('action-unknown-' + action, 50);

    state.lastAction = action;
    state.lastError = '';

    if (CRITICAL_ACTIONS.has(action)) {
      if (isActionLocked(action) || state.busy) {
        state.blockedActions += 1;
        statusInline('Action déjà en cours…', false);
        emit('action-blocked', { action, state: snapshot() });
        return false;
      }
      lockAction(action, action === 'barcode-add-day' || action === 'ocr-add-day' || action === 'recipe-add-day' ? 1400 : 900);
      state.busy = true;
      applyDomState('action-' + action + '-start');
    }

    try {
      const out = handler(actionEl, ev);
      emit('action', { action, state: snapshot() });
      return out;
    } catch(e) {
      showError(e && e.message ? e.message : e);
      return false;
    } finally {
      if (CRITICAL_ACTIONS.has(action)) {
        setTimeout(() => {
          state.busy = false;
          applyDomState('action-' + action + '-end');
        }, 180);
      }
    }
  }

  function actionSearchBarcodeCode(actionEl){
    const code = actionEl?.dataset?.barcodeCode || actionEl?.dataset?.code || '';
    const input = $('db-search');
    if (input) {
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles:true }));
    }
    setMode(MODES.SEARCH, { callLegacy:false, reason:'action-barcode-search-code', noFocus:true });
    runAction('handleDBSearchInput');
    scheduleReconcile('action-barcode-search-code', 80);
  }


  function actionSearchPick(actionEl){
    const index = Number(actionEl?.dataset?.searchIndex ?? actionEl?.dataset?.index ?? -1);
    try { if (typeof window.foodnoteKeepDBSuggestionsVisibleAfterPick === 'function') window.foodnoteKeepDBSuggestionsVisibleAfterPick(index, 9000); } catch(e) {}
    const out = runSearchResultFlow('pick', [index], { required:true, error:'Résultat de recherche indisponible.', fallbackAction:'pickDBSuggestion' });
    try {
      const st = window.FoodNoteFoodAddSearchState;
      const picked = st && typeof st.getSuggestion === 'function' ? st.getSuggestion(index) : null;
      const food = picked && (picked.item || picked.food || picked);
      if (typeof window.foodnoteStabilizeSearchPickSurface === 'function') window.foodnoteStabilizeSearchPickSurface(food, index, { sticky:true, ms:12000 });
    } catch(e) {}
    restoreSearchSuggestionsVisibility();
    scheduleReconcile('action-search-pick-keep-suggestions', 80);
    setTimeout(restoreSearchSuggestionsVisibility, 120);
    setTimeout(restoreSearchSuggestionsVisibility, 320);
    return out;
  }

  function actionHistoryAdd(actionEl){
    const payload = actionEl?.dataset?.historyFood || actionEl?.dataset?.food || '';
    const out = runSearchResultFlow('addHistoryPayload', [payload], { required:true, error:'Suggestion rapide indisponible.' });
    scheduleReconcile('action-history-add', 120);
    return out;
  }

  function actionSearchClear(){
    const out = runSearchResultFlow('clear', [], { required:false });
    scheduleReconcile('action-search-clear', 50);
    return out;
  }

  function actionHandlers(){
    return {
      main: () => handleMainAction(),
      'set-intent': (el) => { const intent = el.dataset.intent || el.dataset.foodIntent || 'search'; setMode(intent, { callLegacy:true, reason:'action-set-intent', noFocus:true }); runUxAction('setIntent', [intent]); scheduleReconcile('action-set-intent', 80); },
      'open-memory': () => { setMode(MODES.QUICK, { callLegacy:true, reason:'action-open-memory', noFocus:true }); runUxAction('openMemory', [], { required:false }); scheduleReconcile('action-open-memory', 80); },
      'focus-estimate': () => { setMode(MODES.ESTIMATE, { callLegacy:true, reason:'action-focus-estimate' }); runUxAction('focusEstimateText', [], { required:true, error:'Saisie estimation indisponible.' }); scheduleReconcile('action-focus-estimate', 80); },
      'estimate-run': () => { setMode(MODES.ESTIMATE, { callLegacy:true, reason:'action-estimate-run' }); runUxAction('runEstimate', [], { required:true, error:'Estimation IA indisponible.' }); scheduleReconcile('action-estimate-run', 120); },
      'open-plate-photo': () => { markWorkflow(MODES.CAPTURE, { reason:'action-open-plate-photo' }); runCaptureFlow('openPlatePhoto', [], { required:true, error:'Photo de plat indisponible.', fallbackAction:'openPlatePhoto' }); scheduleReconcile('action-open-plate-photo', 100); },
      'open-product-photo': () => { markWorkflow(MODES.NUTRITION_TABLE, { reason:'action-open-product-photo' }); runCaptureFlow('openNutritionTable', [], { required:true, error:'Lecture étiquette indisponible.', fallbackAction:'openProductPhoto' }); scheduleReconcile('action-open-product-photo', 100); },
      'new-recipe': () => { setMode(MODES.RECIPES, { callLegacy:true, reason:'action-new-recipe', noFocus:true }); runUxAction('newRecipe', [], { required:true, error:'Création recette indisponible.' }); scheduleReconcile('action-new-recipe', 100); },
      'scan-recipe': () => { markWorkflow(MODES.RECIPE, { reason:'action-scan-recipe' }); runCaptureFlow('openRecipe', [], { required:true, error:'Scan recette indisponible.', fallbackAction:'scanRecipe' }); scheduleReconcile('action-scan-recipe', 100); },
      'open-recipes-list': () => { setMode(MODES.RECIPES, { callLegacy:true, reason:'action-open-recipes-list', noFocus:true }); runUxAction('openRecipesList', [], { required:true, error:'Liste recettes indisponible.' }); scheduleReconcile('action-open-recipes-list', 100); },
      'toggle-source': (el) => { runAction('toggleFoodSourceFilter', [el.dataset.sourceFilter], { required:true, error:'Filtre de source indisponible.' }); scheduleReconcile('action-toggle-source', 50); },
      'set-meal': (el) => { state.targetMeal = el.dataset.foodMeal || state.targetMeal || ''; runAction('setFoodAddTargetMeal', [state.targetMeal], { required:true, error:'Sélection du repas indisponible.' }); scheduleReconcile('action-set-meal', 50); },
      'quick-panel': (el) => { runAction('setQuickFoodsPanel', [el.dataset.quickPanel || 'recents'], { required:true, error:'Mémoire rapide indisponible.' }); scheduleReconcile('action-quick-panel', 50); },
      'search-pick': actionSearchPick,
      'history-add': actionHistoryAdd,
      'search-clear': actionSearchClear,
      'suggestion-tab': (el) => { runUxAction('setSuggestionTab', [el.dataset.suggestionTab || 'meal'], { required:true, error:'Onglet suggestion indisponible.' }); scheduleReconcile('action-suggestion-tab', 50); },
      'suggestion-add': (el) => { runUxAction('addSuggestion', [el.dataset.suggestion || ''], { required:true, error:'Suggestion indisponible.' }); scheduleReconcile('action-suggestion-add', 90); },
      'suggestion-favorite': (el) => { runUxAction('toggleFavorite', [el.dataset.suggestion || ''], { required:true, error:'Favori indisponible.' }); scheduleReconcile('action-suggestion-favorite', 90); },
      'close-ocr': () => { runCaptureFlow('closeOCR', [], { fallbackAction:'closeOCRPanel' }); setMode(MODES.SEARCH, { callLegacy:false, reason:'action-close-ocr', noFocus:true }); scheduleReconcile('action-close-ocr', 50); },
      'toggle-nutrition-auto': () => { markWorkflow(MODES.NUTRITION_TABLE, { reason:'action-toggle-nutrition-auto' }); runCaptureFlow('toggleNutritionAuto', [], { required:true, error:'Déclencheur OCR indisponible.', fallbackAction:'toggleNutritionOCRAuto' }); scheduleReconcile('action-toggle-nutrition-auto', 80); },
      'nutrition-ocr-read': () => { markWorkflow(MODES.NUTRITION_TABLE, { reason:'action-nutrition-ocr-read' }); runCaptureFlow('readNutritionFrame', [], { required:true, error:'Lecture tableau indisponible.', fallbackAction:'captureNutritionOCRFrame' }); scheduleReconcile('action-nutrition-ocr-read', 80); },
      'recipe-ocr-read': () => { markWorkflow(MODES.RECIPE, { reason:'action-recipe-ocr-read' }); runCaptureFlow('captureRecipeFrame', [], { required:true, error:'Photo recette indisponible.', fallbackAction:'captureRecipeOCRFrame' }); scheduleReconcile('action-recipe-ocr-read', 80); },
      'stop-nutrition-camera': () => { runCaptureFlow('stopNutritionCamera', [], { fallbackAction:'stopNutritionOCRCamera' }); scheduleReconcile('action-stop-nutrition-camera', 80); },
      'retake-recipe-photo': () => { markWorkflow(MODES.RECIPE, { reason:'action-retake-recipe-photo' }); runCaptureFlow('retakeRecipePhoto', [], { required:true, error:'Reprise photo indisponible.', fallbackAction:'retakeRecipePhoto' }); scheduleReconcile('action-retake-recipe-photo', 80); },
      'recipe-ocr-full': () => { markWorkflow(MODES.RECIPE, { reason:'action-recipe-ocr-full' }); runCaptureFlow('recipeOCRFull', [], { required:true, error:'Lecture pleine image indisponible.', fallbackAction:'runRecipeOCRFromFullPhoto' }); scheduleReconcile('action-recipe-ocr-full', 80); },
      'recipe-ocr-crop': () => { markWorkflow(MODES.RECIPE, { reason:'action-recipe-ocr-crop' }); runCaptureFlow('recipeOCRCrop', [], { required:true, error:'Lecture du recadrage indisponible.', fallbackAction:'runRecipeOCRFromCrop' }); scheduleReconcile('action-recipe-ocr-crop', 80); },
      'ocr-save-personal': () => { runCaptureFlow('saveOCRFood', [false], { required:true, error:'Sauvegarde OCR indisponible.', fallbackAction:'saveOCRFoodToBDD' }); scheduleReconcile('action-ocr-save-personal', 120); },
      'ocr-add-day': () => { runCaptureFlow('saveOCRFood', [true], { required:true, error:'Ajout OCR à la journée indisponible.', fallbackAction:'saveOCRFoodToBDD' }); scheduleReconcile('action-ocr-add-day', 120); },
      'recipe-ai-estimate': () => { markWorkflow(MODES.RECIPE, { reason:'action-recipe-ai-estimate' }); runCaptureFlow('estimateRecipe', [], { required:true, error:'Analyse IA recette indisponible.', fallbackAction:'estimateRecipeFromOCRText' }); scheduleReconcile('action-recipe-ai-estimate', 120); },
      'focus-recipe-text': () => { try { $('recipe-ocr-text')?.focus(); } catch(e) {} },
      'recipe-create': () => { runAction('importRecipeAIToRecipes', [], { required:true, error:'Création recette indisponible.' }); scheduleReconcile('action-recipe-create', 120); },
      'recipe-save-personal': () => { runCaptureFlow('saveRecipeFood', [false], { required:true, error:'Sauvegarde plat indisponible.', fallbackAction:'saveRecipeFoodToBDD' }); scheduleReconcile('action-recipe-save-personal', 120); },
      'recipe-add-day': () => { runCaptureFlow('saveRecipeFood', [true], { required:true, error:'Ajout plat à la journée indisponible.', fallbackAction:'saveRecipeFoodToBDD' }); scheduleReconcile('action-recipe-add-day', 120); },
      'quantity-set': (el) => { runAction('setDBQuantityValue', [el.dataset.quantityValue], { required:true, error:'Réglage quantité indisponible.' }); scheduleReconcile('action-quantity-set', 40); },
      'quantity-nudge': (el) => { runAction('nudgeDBQuantity', [Number(el.dataset.quantityDelta || 0)], { required:true, error:'Réglage quantité indisponible.' }); scheduleReconcile('action-quantity-nudge', 40); },
      'quantity-close': () => { runAction('closeDBQuantitySelector', [{keepSearch:true}], { required:true, error:'Fermeture quantité indisponible.' }); scheduleReconcile('action-quantity-close', 50); },
      'quantity-confirm': () => { runAction('confirmDBQuantitySelection', [], { required:true, error:'Ajout quantité indisponible.' }); scheduleReconcile('action-quantity-confirm', 120); },
      'barcode-nutrition-from-camera': () => { markWorkflow(MODES.NUTRITION_TABLE, { reason:'action-barcode-nutrition-from-camera' }); runCaptureFlow('nutritionFromBarcodeCamera', [], { required:true, error:'Capture tableau depuis caméra indisponible.', fallbackAction:'captureNutritionFromBarcodeCamera' }); scheduleReconcile('action-barcode-nutrition-from-camera', 80); },
      'barcode-close': () => { runCaptureFlow('closeBarcode', [], { fallbackAction:'closeBarcodeScannerPanel' }); setMode(MODES.SEARCH, { callLegacy:false, reason:'action-barcode-close', noFocus:true }); scheduleReconcile('action-barcode-close', 80); },
      'barcode-search-code': actionSearchBarcodeCode,
      'barcode-fill-search': () => { runCaptureFlow('selectBarcodeInSearch', [], { required:true, error:'Produit code-barres indisponible.', fallbackAction:'selectBarcodeProductInSearch' }); setMode(MODES.SEARCH, { callLegacy:false, reason:'action-barcode-fill-search', noFocus:true }); scheduleReconcile('action-barcode-fill-search', 80); },
      'barcode-save-product': () => { runCaptureFlow('saveBarcodeProduct', [], { required:true, error:'Sauvegarde OpenFoodFacts indisponible.', fallbackAction:'saveBarcodeProductToBDD' }); scheduleReconcile('action-barcode-save-product', 120); },
      'barcode-add-day': () => { runCaptureFlow('addBarcodeProductToDay', [], { required:true, error:'Ajout OpenFoodFacts indisponible.', fallbackAction:'addBarcodeProductToDay' }); scheduleReconcile('action-barcode-add-day', 120); }
    };
  }

  function isDetachedCaptureActionHost(actionEl){
    if (!actionEl || !actionEl.closest) return false;
    // 94-camera-skin peut déplacer #ocr-panel directement sous <body> pour un
    // rendu caméra plein écran. Dans ce cas les boutons restent des actions du
    // popup, mais ne sont plus contenus dans #food-add-modal : il faut continuer
    // à les router par le contrôleur.
    return !!actionEl.closest('#ocr-panel, #barcode-scan-panel, #capture-workflow-modal');
  }

  function installActionDelegation(){
    if (document.__fnFoodAddModalControllerActionDelegation) return;
    document.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!target || !target.closest) return;
      const actionEl = target.closest('[data-food-add-action]');
      if (!actionEl) return;
      const m = modal();
      const insideModal = !!(m && m.contains(actionEl));
      const insideDetachedCapture = isDetachedCaptureActionHost(actionEl);
      if (!insideModal && !insideDetachedCapture) return;
      const action = String(actionEl.dataset.foodAddAction || '').trim();
      if (!action) return;

      ev.preventDefault();
      ev.stopPropagation();

      return runDelegatedAction(action, actionEl, ev);
    }, true);
    document.addEventListener('input', (ev) => {
      const target = ev.target;
      if (!target || !target.matches || !target.matches('[data-food-add-quantity-input]')) return;
      const m = modal();
      if (!m || !m.contains(target)) return;
      try { runAction('setDBQuantityValue', [target.value], { required:false }); }
      catch(e) { showError(e && e.message ? e.message : e); }
    }, true);
    document.__fnFoodAddModalControllerActionDelegation = true;
  }

  function installKeyboardGuard(){
    if (document.__fnFoodAddModalControllerKeyGuard) return;
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (!modalIsOpen()) return;
      ev.stopPropagation();
      close();
    }, true);
    document.__fnFoodAddModalControllerKeyGuard = true;
  }


  function forceLegacySearchMode(reason = 'search-recovery'){
    // 0.22.115 : le contrôleur peut afficher la vue recherche alors que l'ancien
    // moteur de 30-nutrition-foods.js garde encore foodAddMode='ia'/'quick' ou
    // un état recette. Dans ce cas handleDBSearchInput() sort immédiatement et
    // CIQUAL/OpenFoodFacts ne sont plus relancés. On resynchronise l'ancien état
    // explicitement, mais uniquement suite à une interaction réelle sur la recherche.
    const m = modal();
    try {
      if (typeof state.originals.setFoodAddMode === 'function') {
        state.originals.setFoodAddMode.call(window, 'search');
      } else if (typeof window.setFoodAddMode === 'function' && !window.setFoodAddMode.__fnFoodAddModalControllerWrapped) {
        window.setFoodAddMode('search');
      }
    } catch(e) {}
    try {
      const enhancer = window.FoodNoteAddV0160;
      if (enhancer && typeof enhancer.endWorkflow === 'function') enhancer.endWorkflow();
      if (enhancer && typeof enhancer.setIntent === 'function') enhancer.setIntent('search', { keepText:true, deferSuggestions:true, forceWorkflowExit:true });
    } catch(e) {}
    if (m) {
      delete m.dataset.foodnoteWorkflow;
      delete m.dataset.foodnoteRecipeStep;
      m.classList.remove(
        'food-add-ai-mode', 'food-add-quick-mode',
        'food-add-recipe-mode', 'food-add-recipe-camera', 'food-add-recipe-crop',
        'food-add-recipe-result', 'food-add-recipe-ocr-result', 'food-add-recipe-ai-result',
        'food-add-recipe-processing', 'fn-capture-flow-active', 'fn-modal-has-workflow'
      );
      m.classList.add('food-intent-search');
      m.dataset.fnCaptureFlow = '';
    }
    try { window.FoodNoteRecipeWorkflowActive = false; } catch(e) {}
    try { window.FoodNoteRecipeWorkflow = { active:false, name:'recipe_ocr', step:'', updatedAt:Date.now(), reason }; } catch(e) {}
    return true;
  }

  function resumeSearchFromSearchInput(reason = 'search-input'){
    // 0.22.114 : repasser visuellement en recherche après "Ajouté".
    // 0.22.115 : resynchroniser aussi l'ancien foodAddMode, sinon CIQUAL/OFF/Base
    // peuvent rester bloqués silencieusement malgré une vue recherche correcte.
    const input = $('db-search');
    if (!input) return false;
    const m = modal();
    const hadSavedView = state.mode === MODES.SAVED;
    const legacyBlockingView = !!(m && (
      m.classList.contains('food-add-ai-mode') ||
      m.classList.contains('food-add-quick-mode') ||
      m.classList.contains('food-add-recipe-mode') ||
      m.classList.contains('food-add-recipe-camera') ||
      m.classList.contains('food-add-recipe-crop') ||
      m.classList.contains('food-add-recipe-result') ||
      m.dataset.foodnoteWorkflow
    ));
    const hadBlockingView = state.mode !== MODES.SEARCH || legacyBlockingView;

    if (hadBlockingView) {
      state.previousMode = state.mode;
      state.mode = MODES.SEARCH;
      state.workflow = 'idle';
      state.busy = false;
      state.expanded = !!String(input.value || '').trim();
      state.lastReason = reason;
      setSearchFocusSuppressed(0);
      forceLegacySearchMode(reason);
    }

    if (hadSavedView) {
      clearTimeout(state.savedTimer);
      const lastAdded = $('journal-last-added');
      if (lastAdded && !lastAdded.contains(document.activeElement)) {
        lastAdded.classList.remove('visible');
        lastAdded.innerHTML = '';
        delete lastAdded.dataset.foodIdx;
      }
    }

    const suggestions = $('db-suggestions');
    if (suggestions) {
      suggestions.removeAttribute('aria-hidden');
      suggestions.style.removeProperty('display');
    }
    const quick = $('quick-foods-card');
    if (quick) {
      quick.removeAttribute('aria-hidden');
      quick.style.removeProperty('display');
    }
    return hadBlockingView || hadSavedView;
  }

  function installSearchInputBridge(){
    if (document.__fnFoodAddModalControllerSearchInputBridge) return;
    const isSearch = target => target && target.matches && target.matches('#db-search, [data-food-add-search-input="1"]');
    document.addEventListener('input', (ev) => {
      if (!isSearch(ev.target)) return;
      resumeSearchFromSearchInput('search-input');
      runAction('handleDBSearchInput', [], { required:false });
      scheduleReconcile('search-input', 90);
    }, true);
    document.addEventListener('focusin', (ev) => {
      if (!isSearch(ev.target)) return;
      resumeSearchFromSearchInput('search-focus');
      runAction('handleDBSearchInput', [], { required:false });
      scheduleReconcile('search-focus', 90);
    }, true);
    document.addEventListener('keydown', (ev) => {
      if (!isSearch(ev.target)) return;
      resumeSearchFromSearchInput('search-key');
      runAction('handleDBSearchKey', [ev], { required:false });
      scheduleReconcile('search-key', 40);
    }, true);
    document.__fnFoodAddModalControllerSearchInputBridge = true;
  }

  function installOverlayGuard(){
    stripLegacyInlineCloseHandlers();
    const m = modal();
    if (m && !m.__fnFoodAddModalControllerOverlayGuard) {
      m.addEventListener('click', (ev) => {
        if (ev.target === m) {
          ev.preventDefault();
          ev.stopPropagation();
          close();
        }
      }, true);
      m.__fnFoodAddModalControllerOverlayGuard = true;
    }
    if (!document.__fnFoodAddModalControllerDelegatedClose) {
      document.addEventListener('click', (ev) => {
        const target = ev.target;
        if (!target || !target.closest) return;
        const closeTarget = target.closest('[data-food-add-close]');
        if (!closeTarget) return;
        const m = modal();
        if (!m || !m.contains(closeTarget)) return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
      }, true);
      document.__fnFoodAddModalControllerDelegatedClose = true;
    }
  }

  function installMutationObserver(){
    // 0.22.110 : volontairement désactivé.
    // Le popup est maintenant piloté par actions/événements explicites ; observer
    // document.documentElement en continu est trop risqué sur une interface qui rerend souvent.
    state.observerEnabled = false;
    state.observerDisabledReason = 'hardening_checkpoint_event_driven';
    return false;
  }

  function wrapLegacyFunctions(){
    wrap('openFoodAddModal', function(){
      return function controlledOpenFoodAddModal(){ return open({ callLegacy:true }); };
    });
    wrap('closeFoodAddModal', function(){
      return function controlledCloseFoodAddModal(){ return close(); };
    });
    wrap('goToFoodAdd', function(){
      return function controlledGoToFoodAdd(meal){ return goToFoodAdd(meal); };
    });
    wrap('openFoodAddForMeal', function(){
      return function controlledOpenFoodAddForMeal(meal){ return goToFoodAdd(meal); };
    });
    wrap('setFoodAddExpanded', function(){
      return function controlledSetFoodAddExpanded(expanded){ return setExpanded(expanded, { callLegacy:true, reason:'legacy-expanded' }); };
    });
    wrap('setFoodAddMode', function(){
      return function controlledSetFoodAddMode(mode){ return setMode(mode, { callLegacy:true, reason:'legacy-mode' }); };
    });
    wrap('handleFoodMainAction', function(){
      return function controlledFoodMainAction(){ return handleMainAction.apply(this, arguments); };
    });
    wrap('showJournalLastAdded', function(original){
      return function controlledShowJournalLastAdded(idx){
        const out = original.apply(this, arguments);
        notifySaved(idx);
        return out;
      };
    });

    const workflowRoutes = {
      openFoodPhotoOption: MODES.BARCODE,
      openFoodBarcodeFromPhoto: MODES.BARCODE,
      toggleBarcodeScanner: MODES.BARCODE,
      openFoodRecipePhotoOption: MODES.RECIPE,
      startNutritionOCRCamera: MODES.NUTRITION_TABLE,
      captureNutritionFromBarcodeCamera: MODES.NUTRITION_TABLE,
      captureNutritionOCRFrame: MODES.NUTRITION_TABLE,
      captureRecipeOCRFrame: MODES.RECIPE,
      processRecipeOCRImage: MODES.RECIPE,
      estimateRecipeFromOCRText: MODES.RECIPE,
      estimerGroq: MODES.ESTIMATE
    };
    function workflowRouteFor(name){
      if (name === 'startNutritionOCRCamera') {
        const m = modal();
        if (state.mode === MODES.RECIPE || (m && m.classList.contains('food-add-recipe-mode'))) return MODES.RECIPE;
      }
      return workflowRoutes[name];
    }
    Object.keys(workflowRoutes).forEach(name => {
      wrap(name, function(original){
        return function controlledWorkflowFunction(){
          const routedMode = workflowRouteFor(name);
          markWorkflow(routedMode, { reason:name });
          if (openCaptureFlow(routedMode, name)) return false;
          try { return original.apply(this, arguments); }
          finally { scheduleReconcile(name + '-after', 90); }
        };
      });
    });
  }

  function wrapFoodAddUxObjects(){
    const names = ['FoodNoteAddV0160','FoodNoteFoodAddUX1513','FoodNoteFoodAddUX1512','FoodNoteFoodAddUX1511','FoodNoteFoodAddUX1510','FoodNoteFoodAddUX159','FoodNoteFoodAddUX158'];
    const routes = {
      setIntent: 'dynamic-intent',
      focusEstimateText: MODES.ESTIMATE,
      runEstimate: MODES.ESTIMATE,
      openProductPhoto: MODES.NUTRITION_TABLE,
      startNutritionTableScan: MODES.NUTRITION_TABLE,
      openPlatePhoto: MODES.CAPTURE,
      startPlateCamera: MODES.CAPTURE,
      startBarcodeScan: MODES.BARCODE,
      scanRecipe: MODES.RECIPE,
      newRecipe: MODES.RECIPES,
      openRecipesList: MODES.RECIPES
    };
    names.forEach(objName => {
      const obj = window[objName];
      if (!obj || obj.__fnFoodAddModalControllerWrapped) return;
      Object.keys(routes).forEach(method => {
        if (typeof obj[method] !== 'function' || obj[method].__fnFoodAddModalControllerWrapped) return;
        const original = obj[method];
        const wrapped = function controlledFoodAddUxMethod(){
          const route = routes[method];
          if (route === 'dynamic-intent') {
            const out = original.apply(this, arguments);
            if (!state.syncingEnhancer) {
              const inferred = inferModeFromDom();
              const requested = String(arguments[0] || '').toLowerCase() === 'estimate' ? MODES.ESTIMATE : String(arguments[0] || '').toLowerCase() === 'recipes' ? MODES.RECIPES : MODES.SEARCH;
              setMode(inferred || requested, { callLegacy:false, reason:objName + '.' + method });
            }
            scheduleReconcile(objName + '.' + method + '-after', 90);
            return out;
          }
          const routedMode = route;
          markWorkflow(routedMode, { reason:objName + '.' + method });
          if (openCaptureFlow(routedMode, method)) return false;
          try { return original.apply(this, arguments); }
          finally { scheduleReconcile(objName + '.' + method + '-after', 90); }
        };
        wrapped.__fnFoodAddModalControllerWrapped = true;
        wrapped.__fnFoodAddModalControllerOriginal = original;
        obj[method] = wrapped;
      });
      obj.__fnFoodAddModalControllerWrapped = true;
    });
  }

  function installEventBridges(){
    if (window.__fnFoodAddModalControllerEvents) return;
    window.addEventListener('foodnote:capture:state', (ev) => {
      const detail = ev && ev.detail || {};
      setMode(normalizeMode(detail.state || detail.mode || MODES.CAPTURE), { callLegacy:false, reason:'capture-event', noFocus:true });
    });
    window.addEventListener('foodnote:deferred-ready', () => {
      setTimeout(() => { wrapLegacyFunctions(); wrapFoodAddUxObjects(); scheduleReconcile('deferred-ready', 80); }, 0);
      setTimeout(() => { wrapLegacyFunctions(); wrapFoodAddUxObjects(); scheduleReconcile('deferred-ready-late', 80); }, 800);
    });
    window.addEventListener('foodnote-ui-rendered', () => scheduleReconcile('ui-rendered', 80));
    window.addEventListener('foodnote:food-add-search-results:changed', () => scheduleReconcile('search-results-changed', 80));
    window.addEventListener('foodnote:food-add-domain:ready', () => scheduleReconcile('domain-ready', 80));
    window.addEventListener('foodnote:food-capture-flows:ready', () => scheduleReconcile('capture-flows-ready', 80));
    window.__fnFoodAddModalControllerEvents = true;
  }


  function collectIssues(){
    const issues = [];
    const m = modal();
    if (!m) issues.push('popup_absent');
    if (m && m.getAttribute('onclick')) issues.push('legacy_overlay_onclick_present');
    const inlineClicks = qa('#food-add-modal [onclick]').length;
    const inlineInputs = qa('#food-add-modal [oninput], #food-add-modal [onchange]').length;
    if (inlineClicks > 0) issues.push('legacy_inline_onclick:' + inlineClicks);
    if (inlineInputs > 0) issues.push('legacy_inline_input_handler:' + inlineInputs);
    if (!document.__fnFoodAddModalControllerActionDelegation) issues.push('action_delegation_missing');
    if (!window.FoodNoteFoodAddDomain) issues.push('domain_core_missing');
    if (!window.FoodNoteFoodCaptureFlows) issues.push('capture_flows_missing');
    if (!window.FoodNoteFoodAddSearchResults) issues.push('search_results_core_missing');
    if (m && state.lastView && m.dataset.fnModalView !== state.lastView) issues.push('modal_view_dataset_mismatch');
    if (state.busy && state.lastAction && !isActionLocked(state.lastAction)) issues.push('busy_without_action_lock');
    if (state.observer) issues.push('controller_mutation_observer_active');
    return issues;
  }

  function audit(){
    return {
      controller: VERSION,
      ownsPopup: CONTROLLER_OWNS_POPUP,
      state: snapshot(),
      wrappedFunctions: Object.keys(state.originals).sort(),
      issues: collectIssues(),
      knownSurfaces: {
        legacyInlineCloseRemoved: !(modal() && modal().getAttribute('onclick')),
        modal: !!modal(),
        search: !!$('db-search'),
        suggestions: !!$('db-suggestions'),
        quick: !!$('quick-foods-card'),
        ocr: !!$('ocr-panel'),
        barcode: !!$('barcode-scan-panel'),
        capture: !!$('capture-workflow-modal'),
        delegatedActions: qa('#food-add-modal [data-food-add-action]').length,
        inlineModalClicks: qa('#food-add-modal [onclick]').length,
        inlineModalInputHandlers: qa('#food-add-modal [oninput], #food-add-modal [onchange]').length,
        quantityActions: qa('#db-quantity-panel [data-food-add-action]').length,
        searchResultActions: qa('#db-suggestions [data-food-add-action="search-pick"]').length,
        quickHistoryActions: qa('#quick-foods-card [data-food-add-action="history-add"]').length,
        searchResultsCore: !!window.FoodNoteFoodAddSearchResults,
        actionDelegationInstalled: !!document.__fnFoodAddModalControllerActionDelegation,
        searchInputBridge: !!document.__fnFoodAddModalControllerSearchInputBridge,
        blockedActions: state.blockedActions,
        reconcileRequests: state.reconcileRequests,
        observerEnabled: !!state.observer,
        observerDisabledReason: state.observerDisabledReason,
        eventDrivenReconcile: true,
        searchAfterAddRecovery: true,
        legacySearchRecovery: true,
        detachedCaptureActionBridge: true,
        activeActionLocks: Object.keys(state.actionLocks || {}).length,
        currentView: state.lastView,
        registeredViews: Object.keys(VIEW_REGISTRY),
        viewRegistry: true,
        domainCore: !!window.FoodNoteFoodAddDomain,
        domainAudit: window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.audit === 'function' ? window.FoodNoteFoodAddDomain.audit() : null,
        captureFlowsCore: !!window.FoodNoteFoodCaptureFlows,
        captureFlowsAudit: window.FoodNoteFoodCaptureFlows && typeof window.FoodNoteFoodCaptureFlows.audit === 'function' ? window.FoodNoteFoodCaptureFlows.audit() : null
      }
    };
  }

  function install(){
    if (state.installed) {
      wrapLegacyFunctions();
      wrapFoodAddUxObjects();
      installOverlayGuard();
      scheduleReconcile('reinstall', 80);
      return;
    }
    state.installed = true;
    installFocusGuard();
    installActionDelegation();
    installKeyboardGuard();
    installSearchInputBridge();
    installOverlayGuard();
    installMutationObserver();
    installEventBridges();
    wrapLegacyFunctions();
    wrapFoodAddUxObjects();
    applyDomState('install');
    setTimeout(() => { wrapLegacyFunctions(); wrapFoodAddUxObjects(); installOverlayGuard(); scheduleReconcile('late-wrap-1', 80); }, 450);
    setTimeout(() => { wrapLegacyFunctions(); wrapFoodAddUxObjects(); installOverlayGuard(); scheduleReconcile('late-wrap-2', 80); }, 1400);
    setTimeout(() => { wrapLegacyFunctions(); wrapFoodAddUxObjects(); installOverlayGuard(); scheduleReconcile('late-wrap-3', 80); }, 2600);
    console.info('[FoodAddModalController] chargé', VERSION);
  }

  window.FoodNoteFoodAddModalController = {
    version: VERSION,
    MODES,
    VIEWS: VIEW_REGISTRY,
    get state(){ return snapshot(); },
    open,
    close,
    goToFoodAdd,
    setMode,
    setExpanded,
    resetTransientUi,
    notifySaved,
    showError,
    resumeSearchFromSearchInput,
    reconcile: applyDomState,
    wrapLegacyFunctions,
    wrapFoodAddUxObjects,
    audit,
    health: audit,
    install
  };

  window.FoodNoteFoodAddModal = window.FoodNoteFoodAddModalController;


  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
