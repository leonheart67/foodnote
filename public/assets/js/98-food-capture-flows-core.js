/* FoodNote beta 0.22.103 — FOOD_ADD_SEARCH_DOMAIN_CORE
 * Façade unique pour les flux caméra / code-barres / OCR / recette, avec fermeture centralisée et verrous anti-double-action.
 * But : éviter que le contrôleur du popup appelle directement des fonctions historiques de 30/93/95.
 */
(function FoodNoteFoodCaptureFlowsCore(){
  'use strict';

  const VERSION = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const MODES = Object.freeze({
    BARCODE: 'barcode',
    NUTRITION_TABLE: 'nutrition_table',
    RECIPE: 'recipe',
    PHOTO_FOOD: 'capture',
    SEARCH: 'search'
  });

  const FLOW_TO_MODAL_MODE = Object.freeze({
    barcode: 'barcode',
    nutrition_table: 'nutrition_table',
    recipe: 'recipe',
    capture: 'capture',
    photo_food: 'capture',
    search: 'search'
  });

  const state = {
    installedAt: Date.now(),
    current: 'idle',
    lastAction: '',
    lastError: '',
    originalCalls: 0,
    temporaryUnwraps: 0,
    blockedActions: 0,
    activeActions: Object.create(null),
    closeAllCalls: 0
  };

  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();


  function runExclusive(key, kind, task, ms = 900){
    const id = String(key || 'capture');
    const until = Number(state.activeActions[id] || 0);
    if (until && until > now()) {
      state.blockedActions += 1;
      status(kind || 'capture', 'Action déjà en cours…', false);
      emit('blocked', { action:id, audit: audit() });
      return true;
    }
    state.activeActions[id] = now() + Math.max(250, Number(ms) || 900);
    try { return task(); }
    finally {
      setTimeout(() => {
        if (Number(state.activeActions[id] || 0) <= now()) delete state.activeActions[id];
      }, Math.max(260, Number(ms) || 900) + 40);
    }
  }

  function log(){
    try { console.debug.apply(console, ['[FoodCaptureFlows]'].concat(Array.from(arguments))); } catch(e) {}
  }

  function emit(name, detail){
    try { window.dispatchEvent(new CustomEvent('foodnote:food-capture-flows:' + name, { detail: detail || audit() })); } catch(e) {}
  }

  function normalizeMode(mode){
    const raw = String(mode || '').toLowerCase().replace(/-/g, '_').trim();
    if (raw === 'barcode_scan' || raw === 'barcode_result' || raw === 'scan' || raw === 'openfoodfacts') return MODES.BARCODE;
    if (raw === 'nutrition' || raw === 'nutrition_ocr' || raw === 'nutrition_table_ocr' || raw === 'tableau') return MODES.NUTRITION_TABLE;
    if (raw === 'recipe_ocr' || raw === 'recipe_photo' || raw === 'photo_recipe' || raw === 'recette') return MODES.RECIPE;
    if (raw === 'photo_food' || raw === 'photo_capture' || raw === 'plate' || raw === 'capture_workflow') return MODES.PHOTO_FOOD;
    if (raw === 'search_food') return MODES.SEARCH;
    return FLOW_TO_MODAL_MODE[raw] ? raw : raw;
  }

  function unwrapFunction(fn){
    let current = fn;
    const seen = new Set();
    while (typeof current === 'function' && !seen.has(current)) {
      seen.add(current);
      const next = current.__fnFoodCaptureFlowsOriginal
        || current.__fnFoodAddModalControllerOriginal
        || current.__fnFoodAddDomainOriginal
        || current.__fnFoodAddModalControllerOriginal
        || current.__fnFoodAddCleanerOriginal
        || current.__captureWorkflowOriginal
        || null;
      if (!next || next === current || typeof next !== 'function') break;
      current = next;
    }
    return typeof current === 'function' ? current : null;
  }

  function original(name){
    const fn = window[name];
    return unwrapFunction(fn);
  }

  function hasOriginal(name){
    return typeof original(name) === 'function';
  }

  function status(kind, message, isError = false){
    state.lastError = isError ? String(message || '') : '';
    try {
      if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.status === 'function') {
        window.FoodNoteFoodAddDomain.status(kind || 'capture', message, isError);
        return;
      }
    } catch(e) {}
    const id = kind === 'barcode' ? 'barcode-status' : kind === 'recipe' ? 'recipe-ai-status' : 'ocr-status';
    const el = $(id) || $('ia-parse-status');
    if (el) {
      if (id === 'barcode-status') el.innerHTML = String(message || '');
      else el.textContent = String(message || '');
      el.classList.toggle('error', !!isError);
      if (isError && el.style) el.style.color = 'var(--orange)';
    }
  }

  function modalController(){
    return window.FoodNoteFoodAddModal || window.FoodNoteFoodAddModalController || null;
  }

  function setModalMode(mode, reason){
    const normalized = FLOW_TO_MODAL_MODE[normalizeMode(mode)] || normalizeMode(mode) || 'search';
    const ctrl = modalController();
    try {
      if (ctrl && typeof ctrl.open === 'function') {
        const st = ctrl.state || {};
        if (!st.open) ctrl.open({ mode: normalized, callLegacy:false, focus:false });
      }
      if (ctrl && typeof ctrl.setMode === 'function') ctrl.setMode(normalized, { callLegacy:false, reason: reason || 'capture-flows', noFocus:true, focusSuppressMs: 2200 });
      if (ctrl && typeof ctrl.setExpanded === 'function') ctrl.setExpanded(true, { callLegacy:true, reason: (reason || 'capture-flows') + '-expanded' });
    } catch(e) {}
    const modal = $('food-add-modal');
    if (modal) {
      modal.dataset.fnCaptureFlow = normalized;
      modal.classList.add('fn-capture-flow-active');
    }
    state.current = normalized;
    state.lastAction = reason || normalized;
    emit('state');
  }

  function callOriginal(name, args = [], options = {}){
    const fn = original(name);
    if (typeof fn !== 'function') {
      if (options.required !== false) status(options.kind || 'capture', options.error || ('Action indisponible : ' + name), true);
      return undefined;
    }
    state.originalCalls++;
    try { return fn.apply(window, Array.isArray(args) ? args : [args]); }
    catch(e) {
      status(options.kind || 'capture', e && e.message ? e.message : String(e), true);
      return undefined;
    }
  }

  function withUnwrapped(names, task){
    const list = Array.from(new Set((names || []).filter(Boolean)));
    const backups = [];
    list.forEach(name => {
      const fn = original(name);
      if (typeof fn === 'function' && window[name] !== fn) {
        backups.push([name, window[name]]);
        try { window[name] = fn; state.temporaryUnwraps++; } catch(e) {}
      }
    });
    try { return task(); }
    finally {
      for (let i = backups.length - 1; i >= 0; i--) {
        const item = backups[i];
        try { window[item[0]] = item[1]; } catch(e) {}
      }
    }
  }

  function hideSearchOutputs(){
    ['db-suggestions', 'quick-foods-card'].forEach(id => {
      const el = $(id);
      if (el) {
        if (id === 'db-suggestions' && typeof window.foodnoteShouldKeepDBSuggestionsVisible === 'function' && window.foodnoteShouldKeepDBSuggestionsVisible()) {
          el.classList.add('visible');
          el.removeAttribute('aria-hidden');
          return;
        }
        el.classList.remove('visible', 'active');
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function showOcrPanel(){
    const panel = $('ocr-panel');
    if (panel) {
      panel.style.display = 'block';
      panel.removeAttribute('aria-hidden');
      panel.classList.add('fn-modal-surface-active');
    }
    const modal = $('food-add-modal');
    if (modal) modal.classList.add('food-add-expanded');
  }

  function openBarcode(){
    setModalMode(MODES.BARCODE, 'open-barcode');
    hideSearchOutputs();
    withUnwrapped(['closeOCRPanel', 'stopNutritionOCRCamera', 'toggleBarcodeScanner', 'startBarcodeScanner', 'closeBarcodeScannerPanel'], () => {
      callOriginal('closeOCRPanel', [], { required:false, kind:'barcode' });
      const panel = $('barcode-scan-panel');
      const alreadyOpen = panel && panel.style.display !== 'none';
      if (!alreadyOpen) callOriginal('toggleBarcodeScanner', [], { kind:'barcode', error:'Ouverture du scanner code-barres indisponible.' });
      else status('barcode', 'Caméra code-barres déjà ouverte.', false);
    });
    emit('opened', { mode: MODES.BARCODE, audit: audit() });
    return true;
  }

  function openNutritionTable(){
    setModalMode(MODES.NUTRITION_TABLE, 'open-nutrition-table');
    hideSearchOutputs();
    withUnwrapped([
      'closeBarcodeScannerPanel', 'closeOCRPanel', 'stopNutritionOCRCamera', 'startNutritionOCRCamera',
      'syncOCRPanelMode', 'setOCRStatus'
    ], () => {
      callOriginal('closeBarcodeScannerPanel', [], { required:false, kind:'ocr' });
      callOriginal('closeOCRPanel', [], { required:false, kind:'ocr' });
      showOcrPanel();
      const recipeBox = $('recipe-ocr-result');
      const aiBox = $('recipe-ai-result');
      const cropBox = $('recipe-crop-box');
      const tableBox = $('ocr-result');
      if (recipeBox) recipeBox.style.display = 'none';
      if (aiBox) aiBox.style.display = 'none';
      if (cropBox) cropBox.style.display = 'none';
      if (tableBox) tableBox.style.display = 'none';
      callOriginal('syncOCRPanelMode', [], { required:false, kind:'ocr' });
      status('ocr', 'Tableau nutritionnel : cadre l’étiquette puis déclenche la lecture.', false);
      callOriginal('startNutritionOCRCamera', [], { kind:'ocr', error:'Ouverture caméra OCR indisponible.' });
    });
    emit('opened', { mode: MODES.NUTRITION_TABLE, audit: audit() });
    return true;
  }

  function openRecipe(){
    setModalMode(MODES.RECIPE, 'open-recipe');
    hideSearchOutputs();
    withUnwrapped([
      'openFoodRecipePhotoOption', 'startNutritionOCRCamera', 'closeBarcodeScannerPanel', 'resetFoodAddGroqVisualState',
      'foodnoteBeginRecipePhotoWorkflow', 'foodnoteSetRecipeWorkflowStep', 'syncOCRPanelMode', 'setOCRStatus'
    ], () => {
      const done = callOriginal('openFoodRecipePhotoOption', [], { kind:'recipe', error:'Ouverture photo recette indisponible.' });
      showOcrPanel();
      return done;
    });
    emit('opened', { mode: MODES.RECIPE, audit: audit() });
    return true;
  }

  function openPlatePhoto(){
    setModalMode(MODES.PHOTO_FOOD, 'open-plate-photo');
    hideSearchOutputs();
    if (window.FoodNoteCapture && window.FoodNoteCapture.MODES && typeof window.FoodNoteCapture.open === 'function') {
      try {
        if (modalController() && typeof modalController().close === 'function') modalController().close({ closePanels:true });
        window.FoodNoteCapture.open(window.FoodNoteCapture.MODES.PHOTO_FOOD);
        emit('opened', { mode: MODES.PHOTO_FOOD, engine:'FoodNoteCapture', audit: audit() });
        return true;
      } catch(e) {
        status('capture', e && e.message ? e.message : String(e), true);
        return true;
      }
    }
    status('capture', 'Photo aliment libre indisponible : moteur FoodNoteCapture non chargé.', true);
    return true;
  }

  function open(mode, options = {}){
    const normalized = normalizeMode(mode);
    log('open', normalized, options && options.legacyName ? options.legacyName : '');
    return runExclusive('open:' + normalized, normalized === MODES.BARCODE ? 'barcode' : normalized === MODES.RECIPE ? 'recipe' : 'capture', () => {
      if (normalized === MODES.BARCODE) return openBarcode();
      if (normalized === MODES.NUTRITION_TABLE) return openNutritionTable();
      if (normalized === MODES.RECIPE) return openRecipe();
      if (normalized === MODES.PHOTO_FOOD || normalized === 'photo_food') return openPlatePhoto();
      return false;
    }, 800);
  }


  function closeAll(options = {}){
    state.closeAllCalls += 1;
    withUnwrapped(['closeBarcodeScannerPanel', 'closeOCRPanel', 'stopNutritionOCRCamera', 'stopBarcodeScanner'], () => {
      callOriginal('closeBarcodeScannerPanel', [], { required:false, kind:'barcode' });
      callOriginal('closeOCRPanel', [], { required:false, kind:'ocr' });
      callOriginal('stopNutritionOCRCamera', [true], { required:false, kind:'ocr' });
      callOriginal('stopBarcodeScanner', [], { required:false, kind:'barcode' });
    });
    try {
      if (window.FoodNoteCapture && typeof window.FoodNoteCapture.close === 'function') window.FoodNoteCapture.close();
    } catch(e) {}
    const modal = $('food-add-modal');
    if (modal) {
      delete modal.dataset.fnCaptureFlow;
      modal.classList.remove('fn-capture-flow-active');
    }
    state.current = 'idle';
    state.lastAction = options.reason || 'close-all';
    emit('closed-all', { audit: audit(), options });
    return true;
  }

  function closeBarcode(){
    withUnwrapped(['closeBarcodeScannerPanel', 'stopBarcodeScanner'], () => callOriginal('closeBarcodeScannerPanel', [], { required:false, kind:'barcode' }));
    setModalMode(MODES.SEARCH, 'close-barcode');
    return true;
  }

  function closeOCR(){
    withUnwrapped(['closeOCRPanel', 'stopNutritionOCRCamera'], () => callOriginal('closeOCRPanel', [], { required:false, kind:'ocr' }));
    setModalMode(MODES.SEARCH, 'close-ocr');
    return true;
  }

  function stopNutritionCamera(){
    withUnwrapped(['stopNutritionOCRCamera'], () => callOriginal('stopNutritionOCRCamera', [true], { required:false, kind:'ocr' }));
    return true;
  }

  function toggleNutritionAuto(){
    setModalMode(MODES.NUTRITION_TABLE, 'toggle-nutrition-auto');
    withUnwrapped(['toggleNutritionOCRAuto'], () => callOriginal('toggleNutritionOCRAuto', [], { kind:'ocr', error:'Déclencheur OCR indisponible.' }));
    return true;
  }

  function readNutritionFrame(){
    setModalMode(MODES.NUTRITION_TABLE, 'read-nutrition-frame');
    withUnwrapped(['captureNutritionOCRFrame'], () => callOriginal('captureNutritionOCRFrame', [false], { kind:'ocr', error:'Lecture tableau indisponible.' }));
    return true;
  }

  function captureRecipeFrame(){
    setModalMode(MODES.RECIPE, 'capture-recipe-frame');
    withUnwrapped(['captureRecipeOCRFrame'], () => callOriginal('captureRecipeOCRFrame', [false], { kind:'recipe', error:'Photo recette indisponible.' }));
    return true;
  }

  function retakeRecipePhoto(){
    setModalMode(MODES.RECIPE, 'retake-recipe-photo');
    withUnwrapped(['retakeRecipePhoto', 'retakeNutritionLabelPhoto'], () => callOriginal('retakeRecipePhoto', [], { kind:'recipe', error:'Reprise photo indisponible.' }));
    return true;
  }

  function recipeOCRFull(){
    setModalMode(MODES.RECIPE, 'recipe-ocr-full');
    withUnwrapped(['runRecipeOCRFromFullPhoto', 'processRecipeOCRImage', 'processNutritionLabelImage'], () => callOriginal('runRecipeOCRFromFullPhoto', [], { kind:'recipe', error:'Lecture pleine image indisponible.' }));
    return true;
  }

  function recipeOCRCrop(){
    setModalMode(MODES.RECIPE, 'recipe-ocr-crop');
    withUnwrapped(['runRecipeOCRFromCrop', 'processRecipeOCRImage', 'processNutritionLabelImage'], () => callOriginal('runRecipeOCRFromCrop', [], { kind:'recipe', error:'Lecture du recadrage indisponible.' }));
    return true;
  }

  function estimateRecipe(){
    setModalMode(MODES.RECIPE, 'estimate-recipe');
    withUnwrapped(['estimateRecipeFromOCRText'], () => callOriginal('estimateRecipeFromOCRText', [], { kind:'recipe', error:'Analyse IA recette indisponible.' }));
    return true;
  }

  function nutritionFromBarcodeCamera(){
    setModalMode(MODES.NUTRITION_TABLE, 'nutrition-from-barcode-camera');
    withUnwrapped(['captureNutritionFromBarcodeCamera', 'showNutritionLabelCropPreview', 'closeBarcodeScannerPanel'], () => callOriginal('captureNutritionFromBarcodeCamera', [], { kind:'barcode', error:'Capture tableau depuis caméra indisponible.' }));
    return true;
  }

  function selectBarcodeInSearch(){
    withUnwrapped(['selectBarcodeProductInSearch'], () => callOriginal('selectBarcodeProductInSearch', [], { kind:'barcode', error:'Produit code-barres indisponible.' }));
    setModalMode(MODES.SEARCH, 'barcode-fill-search');
    return true;
  }

  function saveBarcodeProduct(){
    if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.saveBarcodeProduct === 'function') {
      window.FoodNoteFoodAddDomain.saveBarcodeProduct();
      return true;
    }
    withUnwrapped(['saveBarcodeProductToBDD'], () => callOriginal('saveBarcodeProductToBDD', [], { kind:'barcode', error:'Sauvegarde OpenFoodFacts indisponible.' }));
    return true;
  }

  function addBarcodeProductToDay(){
    if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.addBarcodeProductToDay === 'function') {
      window.FoodNoteFoodAddDomain.addBarcodeProductToDay();
      return true;
    }
    withUnwrapped(['addBarcodeProductToDay'], () => callOriginal('addBarcodeProductToDay', [], { kind:'barcode', error:'Ajout OpenFoodFacts indisponible.' }));
    return true;
  }

  function saveOCRFood(addToDay){
    if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.saveOCRFood === 'function') {
      window.FoodNoteFoodAddDomain.saveOCRFood(!!addToDay);
      return true;
    }
    withUnwrapped(['saveOCRFoodToBDD'], () => callOriginal('saveOCRFoodToBDD', [!!addToDay], { kind:'ocr', error:'Sauvegarde OCR indisponible.' }));
    return true;
  }

  function saveRecipeFood(addToDay){
    if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.saveRecipeFood === 'function') {
      window.FoodNoteFoodAddDomain.saveRecipeFood(!!addToDay);
      return true;
    }
    withUnwrapped(['saveRecipeFoodToBDD'], () => callOriginal('saveRecipeFoodToBDD', [!!addToDay], { kind:'recipe', error:'Sauvegarde plat indisponible.' }));
    return true;
  }

  function install(){
    console.info('[FoodCaptureFlows] chargé', VERSION);
    emit('ready');
  }


  function collectIssues(){
    const issues = [];
    if (!modalController()) issues.push('modal_controller_missing');
    if (!window.FoodNoteFoodAddDomain) issues.push('domain_core_missing');
    if (state.current !== 'idle') {
      const modal = $('food-add-modal');
      if (modal && !modal.classList.contains('fn-capture-flow-active')) issues.push('modal_missing_capture_class');
    }
    if (Object.keys(state.activeActions || {}).length > 1) issues.push('multiple_capture_actions_locked');
    return issues;
  }

  function audit(){
    const display = id => {
      const el = $(id);
      return el ? (el.style.display || (window.getComputedStyle ? window.getComputedStyle(el).display : '')) : null;
    };
    return {
      version: VERSION,
      installedAt: state.installedAt,
      current: state.current,
      lastAction: state.lastAction,
      lastError: state.lastError,
      originalCalls: state.originalCalls,
      temporaryUnwraps: state.temporaryUnwraps,
      blockedActions: state.blockedActions,
      activeActionLocks: Object.keys(state.activeActions || {}).length,
      closeAllCalls: state.closeAllCalls,
      issues: collectIssues(),
      hasModalController: !!modalController(),
      hasDomain: !!window.FoodNoteFoodAddDomain,
      originals: {
        toggleBarcodeScanner: hasOriginal('toggleBarcodeScanner'),
        startNutritionOCRCamera: hasOriginal('startNutritionOCRCamera'),
        openFoodRecipePhotoOption: hasOriginal('openFoodRecipePhotoOption'),
        captureNutritionOCRFrame: hasOriginal('captureNutritionOCRFrame'),
        captureRecipeOCRFrame: hasOriginal('captureRecipeOCRFrame')
      },
      panels: {
        barcode: display('barcode-scan-panel'),
        ocr: display('ocr-panel'),
        crop: display('recipe-crop-box'),
        barcodeResult: display('barcode-result'),
        ocrResult: display('ocr-result'),
        recipeResult: display('recipe-ocr-result')
      }
    };
  }

  window.FoodNoteFoodCaptureFlows = {
    version: VERSION,
    MODES,
    open,
    openBarcode,
    openNutritionTable,
    openRecipe,
    openPlatePhoto,
    closeAll,
    closeBarcode,
    closeOCR,
    stopNutritionCamera,
    toggleNutritionAuto,
    readNutritionFrame,
    captureRecipeFrame,
    retakeRecipePhoto,
    recipeOCRFull,
    recipeOCRCrop,
    estimateRecipe,
    nutritionFromBarcodeCamera,
    selectBarcodeInSearch,
    saveBarcodeProduct,
    addBarcodeProductToDay,
    saveOCRFood,
    saveRecipeFood,
    callOriginal,
    original,
    audit,
    health: audit,
    install
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
