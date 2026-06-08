/*
 * FoodNote — moteur central de capture alimentaire.
 * Rôle : piloter les parcours Ajouter/Rechercher/Code-barres/Photo plat/OCR/Recette/IA texte.
 * Gère : état du workflow, caméra navigateur, prévisualisation, appels IA via serveur,
 *   suggestions modifiables, validation utilisateur et balisage sémantique des macros affichées.
 * Ne doit pas gérer : écriture SQLite directe, clé Groq côté navigateur, stockage permanent d'images
 *   ou rendu CSS global.
 */
(function FoodNoteCaptureWorkflowCore(){
  'use strict';

  if (window.FoodNoteCapture && window.FoodNoteCapture.version) {
    console.warn('[FoodNoteCapture] déjà chargé:', window.FoodNoteCapture.version);
    return;
  }

  const VERSION = 'foodnote_beta_0_24_add_capture_style_cleanup_20260608';
  const STATES = Object.freeze({
    MEAL_SELECT: 'meal_select',
    IDLE: 'idle',
    SEARCH_FOOD: 'search_food',
    BARCODE_SCAN: 'barcode_scan',
    BARCODE_RESULT: 'barcode_result',
    PHOTO_CAPTURE: 'photo_capture',
    CROP: 'crop',
    NUTRITION_TABLE_OCR: 'nutrition_table_ocr',
    RECIPE_OCR: 'recipe_ocr',
    AI_ANALYSIS: 'ai_analysis',
    CONFIRM_FOOD: 'confirm_food',
    CONFIRM_RECIPE: 'confirm_recipe',
    SAVED: 'saved',
    ERROR: 'error'
  });

  const MODES = Object.freeze({
    SEARCH: 'search',
    BARCODE: 'barcode',
    PHOTO_FOOD: 'photo_food',
    NUTRITION_TABLE: 'nutrition_table',
    RECIPE: 'recipe',
    IA_TEXT: 'ia_text'
  });

  const TITLES = {
    [MODES.SEARCH]: 'Rechercher un aliment',
    [MODES.BARCODE]: 'Scan code-barres',
    [MODES.PHOTO_FOOD]: 'Photo du plat',
    [MODES.NUTRITION_TABLE]: 'Photo tableau nutritionnel',
    [MODES.RECIPE]: 'Photo recette',
    [MODES.IA_TEXT]: 'Texte / IA Groq'
  };

  const MODAL_CONTROLLER_OWNS_POPUP = !!window.__FoodNoteFoodAddModalControllerOwnsPopup;

  const state = {
    current: STATES.IDLE,
    previous: null,
    mode: null,
    targetMeal: 'lunch',
    token: 0,
    busy: false,
    stream: null,
    scanTimer: null,
    video: null,
    canvas: null,
    imageDataUrl: '',
    ocrText: '',
    aiText: '',
    results: [],
    selectedIndex: 0,
    lastError: '',
    lastTransitionAt: 0,
    allowDbFocusUntil: 0,
    installed: false,
    wrapped: new Set(),
    pendingIaTextReturnToList: false,
    iaTextMealConfirmed: false,
    crop: { x: 8, y: 10, w: 84, h: 68 },
    cropDrag: null,
    skipMealSelect: false,
    openedFromMealButton: false,
    ocrPassSummary: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const now = () => Date.now();

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function round1(value) {
    const n = Number(value) || 0;
    return Math.round(n * 10) / 10;
  }

  function clampNumber(value, fallback = 0) {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  }

  function captureMacroSummaryHTML(macros, options = {}) {
    const m = macros || {};
    const compact = options.compact !== false;
    const suffix = options.suffix ? `<small>${escapeHtml(options.suffix)}</small>` : '';
    const unitGap = compact ? '' : ' ';
    return `
      <span class="capture-macro" data-macro="kcal">🔥 ${Math.round(clampNumber(m.kcal, 0))} kcal</span>
      <span class="capture-macro" data-macro="prot">🍖 ${round1(clampNumber(m.prot, 0))}${unitGap}g</span>
      <span class="capture-macro" data-macro="gluc">🍞 ${round1(clampNumber(m.gluc, 0))}${unitGap}g</span>
      <span class="capture-macro" data-macro="lip">🥑 ${round1(clampNumber(m.lip, 0))}${unitGap}g</span>
      ${suffix}
    `;
  }

  function looseNumber(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const raw = String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(',', '.')
      .replace(/kcal|calories?|prot(?:é|e)ines?|proteins?|glucides?|carbohydrates?|lipides?|fat|mati(?:è|e)res?\s+grasses?|grammes?|\bg\b|%/gi, ' ')
      .trim();
    const match = raw.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) return fallback;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : fallback;
  }

  function numberFromAny(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') {
      const keys = ['value', 'amount', 'total', 'estimated', 'estimate', 'estime', 'estimé', 'qty', 'quantity', 'grams', 'grammes', 'g', 'kcal'];
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = numberFromAny(value[key], NaN);
          if (Number.isFinite(n)) return n;
        }
      }
      const firstPrimitive = Object.values(value).find(v => typeof v === 'number' || typeof v === 'string');
      if (firstPrimitive !== undefined) return numberFromAny(firstPrimitive, fallback);
      return fallback;
    }
    const txt = String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/,/g, '.')
      .replace(/≈|~|environ|env\.?/gi, ' ')
      .trim();
    const match = txt.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) return fallback;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : fallback;
  }

  function pickObjectNumber(obj, keys, fallback = 0) {
    if (!obj || typeof obj !== 'object') return fallback;
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return numberFromAny(obj[key], fallback);
    }
    const normalizedKeys = Object.keys(obj);
    for (const wanted of keys) {
      const w = normalizeText(wanted);
      const found = normalizedKeys.find(k => normalizeText(k) === w || normalizeText(k).includes(w) || w.includes(normalizeText(k)));
      if (found && obj[found] !== undefined && obj[found] !== null && obj[found] !== '') return numberFromAny(obj[found], fallback);
    }
    return fallback;
  }

  function pickObjectText(obj, keys, fallback = '') {
    if (!obj || typeof obj !== 'object') return fallback;
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) return String(obj[key]).trim();
    }
    const normalizedKeys = Object.keys(obj);
    for (const wanted of keys) {
      const w = normalizeText(wanted);
      const found = normalizedKeys.find(k => normalizeText(k) === w || normalizeText(k).includes(w) || w.includes(normalizeText(k)));
      if (found && obj[found] !== undefined && obj[found] !== null && String(obj[found]).trim()) return String(obj[found]).trim();
    }
    return fallback;
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeCaptureMeal(value) {
    const meal = String(value || '').trim();
    return ['breakfast', 'lunch', 'dinner', 'snack'].includes(meal) ? meal : 'lunch';
  }

  function getGroqKey() {
    try {
      return localStorage.getItem('groq_api_key') || localStorage.getItem('foodnote_groq_api_key') || '';
    } catch (e) {
      return '';
    }
  }

  function apiUserHeaders(extra = {}) {
    const headers = { ...extra };
    try {
      const u = localStorage.getItem('foodnote_user_id') || localStorage.getItem('foodnote_current_user') || '';
      if (u) headers['x-foodnote-user'] = u;
    } catch (e) {}
    return headers;
  }

  function getSourceFilters() {
    if (!state.sourceFilters) state.sourceFilters = { base: true, recipe: true, off: true, ciq: true };
    if (!Object.prototype.hasOwnProperty.call(state.sourceFilters, 'base')) state.sourceFilters.base = true;
    if (!Object.prototype.hasOwnProperty.call(state.sourceFilters, 'recipe')) state.sourceFilters.recipe = true;
    if (!Object.prototype.hasOwnProperty.call(state.sourceFilters, 'off')) state.sourceFilters.off = true;
    if (!Object.prototype.hasOwnProperty.call(state.sourceFilters, 'ciq')) state.sourceFilters.ciq = true;
    return state.sourceFilters;
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent('foodnote:capture:' + name, { detail: detail || {} }));
  }

  function isIaSuggestionMode() {
    return state.mode === MODES.IA_TEXT || state.mode === MODES.PHOTO_FOOD;
  }

  function confidenceLabel(value) {
    const v = normalizeText(value);
    if (!v) return '';
    if (v.includes('high') || v.includes('elevee') || v.includes('forte')) return 'élevée';
    if (v.includes('medium') || v.includes('moyenne')) return 'moyenne';
    if (v.includes('low') || v.includes('faible')) return 'faible';
    return String(value || '').trim();
  }

  function visionItemTypeLabel(value) {
    const v = normalizeText(value).replace(/[\s-]+/g, '_');
    if (!v) return '';
    if (v.includes('plat_compose') || v.includes('composed_dish')) return 'plat composé';
    if (v.includes('sauce') || v.includes('extra') || v.includes('condiment')) return 'sauce / extra';
    if (v.includes('boisson') || v.includes('drink')) return 'boisson';
    if (v.includes('incertain') || v.includes('uncertain')) return 'incertain';
    if (v.includes('aliment_simple') || v.includes('ingredient_simple') || v === 'simple') return 'aliment simple';
    return String(value || '').trim();
  }

  function transition(nextState, payload = {}) {
    const valid = Object.values(STATES).includes(nextState);
    if (!valid) throw new Error('État capture inconnu: ' + nextState);
    state.previous = state.current;
    state.current = nextState;
    state.lastTransitionAt = now();
    if (payload.mode) state.mode = payload.mode;
    if (payload.results) state.results = payload.results;
    if (typeof payload.selectedIndex === 'number') state.selectedIndex = payload.selectedIndex;
    if (payload.error) state.lastError = payload.error;
    render();
    emit('state', { state: state.current, previous: state.previous, mode: state.mode, payload });
    console.debug('[FoodNoteCapture]', state.previous, '→', state.current, payload);
  }

  function setBusy(value, label) {
    state.busy = !!value;
    renderStatus(label || (value ? 'Traitement en cours…' : ''));
    const root = $('#capture-workflow-modal');
    if (root) root.classList.toggle('is-busy', state.busy);
  }

  function ensureModal() {
    let modal = $('#capture-workflow-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'capture-workflow-modal';
    modal.className = 'capture-modal';
    modal.innerHTML = `
      <div class="capture-backdrop" data-capture-close="1"></div>
      <section class="capture-panel" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <header class="capture-header">
          <div>
            <div class="capture-eyebrow">Capture alimentaire</div>
            <h2 id="capture-title">FoodNote Capture</h2>
          </div>
          <button class="capture-close" data-capture-close="1" aria-label="Fermer">×</button>
        </header>
        <div class="capture-steps" id="capture-steps"></div>
        <div class="capture-status" id="capture-status"></div>
        <div class="capture-body" id="capture-body"></div>
        <footer class="capture-footer" id="capture-footer"></footer>
      </section>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (ev) => {
      if (ev.target && ev.target.getAttribute('data-capture-close') === '1') close();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal.classList.contains('visible')) close();
    });
    return modal;
  }

  function showModal() {
    ensureModal().classList.add('visible');
    document.body.classList.add('capture-modal-open');
  }

  function hideModal() {
    const modal = $('#capture-workflow-modal');
    if (modal) modal.classList.remove('visible');
    document.body.classList.remove('capture-modal-open');
  }

  function stopMedia() {
    if (state.scanTimer) {
      clearInterval(state.scanTimer);
      state.scanTimer = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      state.stream = null;
    }
    state.video = null;
  }

  function close() {
    stopMedia();
    closeLegacyPanels();
    state.mode = null;
    state.skipMealSelect = false;
    state.openedFromMealButton = false;
    state.results = [];
    state.pendingIaTextReturnToList = false;
    state.iaTextMealConfirmed = false;
    state.ocrText = '';
    state.aiText = '';
    state.imageDataUrl = '';
    state.lastError = '';
    state.crop = { x: 8, y: 10, w: 84, h: 68 };
    state.cropDrag = null;
    transition(STATES.IDLE);
    hideModal();
  }

  function stepsForMode() {
    const common = {
      [MODES.SEARCH]: [STATES.SEARCH_FOOD, STATES.MEAL_SELECT, STATES.CONFIRM_FOOD, STATES.SAVED],
      [MODES.BARCODE]: [STATES.BARCODE_SCAN, STATES.BARCODE_RESULT, STATES.CONFIRM_FOOD, STATES.SAVED],
      [MODES.PHOTO_FOOD]: [STATES.PHOTO_CAPTURE, STATES.AI_ANALYSIS, STATES.CONFIRM_FOOD, STATES.SAVED],
      [MODES.NUTRITION_TABLE]: [STATES.PHOTO_CAPTURE, STATES.CROP, STATES.NUTRITION_TABLE_OCR, STATES.AI_ANALYSIS, STATES.CONFIRM_FOOD, STATES.SAVED],
      [MODES.RECIPE]: [STATES.PHOTO_CAPTURE, STATES.CROP, STATES.RECIPE_OCR, STATES.AI_ANALYSIS, STATES.CONFIRM_RECIPE, STATES.SAVED],
      [MODES.IA_TEXT]: [STATES.AI_ANALYSIS, STATES.CONFIRM_FOOD, STATES.SAVED]
    };
    return common[state.mode] || [];
  }

  function labelState(s) {
    return ({
      [STATES.IDLE]: 'Accueil',
      [STATES.SEARCH_FOOD]: 'Recherche',
      [STATES.BARCODE_SCAN]: 'Scan',
      [STATES.BARCODE_RESULT]: 'Résultat',
      [STATES.PHOTO_CAPTURE]: 'Photo',
      [STATES.CROP]: 'Recadrage',
      [STATES.NUTRITION_TABLE_OCR]: 'OCR tableau',
      [STATES.RECIPE_OCR]: 'OCR recette',
      [STATES.AI_ANALYSIS]: 'IA',
      [STATES.MEAL_SELECT]: 'Repas cible',
      [STATES.CONFIRM_FOOD]: 'Validation',
      [STATES.CONFIRM_RECIPE]: 'Validation recette',
      [STATES.SAVED]: 'Ajouté',
      [STATES.ERROR]: 'Erreur'
    })[s] || s;
  }

  function renderSteps() {
    const el = $('#capture-steps');
    if (!el) return;
    const steps = stepsForMode();
    if (!steps.length) { el.innerHTML = ''; return; }
    const activeIdx = Math.max(0, steps.indexOf(state.current));
    el.innerHTML = steps.map((s, i) => `<span class="capture-step ${i < activeIdx ? 'done' : ''} ${i === activeIdx ? 'active' : ''}">${escapeHtml(labelState(s))}</span>`).join('');
  }

  function renderStatus(text) {
    const el = $('#capture-status');
    if (!el) return;
    const value = text || statusText();
    el.className = 'capture-status ' + (state.current === STATES.ERROR ? 'error' : state.current === STATES.SAVED ? 'ok' : '');
    el.textContent = value;
    el.style.display = value ? 'block' : 'none';
  }

  function statusText() {
    if (state.busy) return 'Traitement en cours…';
    if (state.current === STATES.ERROR) return state.lastError || 'Une erreur est survenue.';
    if (state.current === STATES.SAVED) return 'Ajout effectué. Tu peux continuer ou fermer.';
    if (state.current === STATES.SEARCH_FOOD) return 'Recherche locale + bases disponibles. Rien ne change l’écran sans validation.';
    if (state.current === STATES.BARCODE_SCAN) return 'Place le code-barres dans le cadre, ou saisis le code manuellement.';
    if (state.current === STATES.PHOTO_CAPTURE) return state.mode === MODES.PHOTO_FOOD ? 'Prends ou choisis une photo du plat. Groq Vision proposera des aliments à valider.' : 'Prends une photo avec la caméra. L’étape suivante dépend du mode choisi.';
    if (state.current === STATES.CROP) return state.mode === MODES.NUTRITION_TABLE ? 'Recadre uniquement le tableau nutritionnel, puis lance la lecture.' : 'Recadre uniquement la liste d’ingrédients, puis lance la lecture.';
    if (state.current === STATES.NUTRITION_TABLE_OCR) return 'OCR du tableau nutritionnel : vérifie le texte avant l’analyse.';
    if (state.current === STATES.RECIPE_OCR) return 'OCR recette : vérifie les ingrédients avant l’analyse.';
    if (state.current === STATES.AI_ANALYSIS) return 'Analyse IA : le résultat sera affiché avant ajout au journal.';
    return '';
  }

  function render() {
    const modal = ensureModal();
    const title = $('#capture-title', modal);
    const body = $('#capture-body', modal);
    const footer = $('#capture-footer', modal);
    if (title) title.textContent = TITLES[state.mode] || 'FoodNote Capture';
    renderSteps();
    renderStatus();
    if (!body || !footer) return;

    body.innerHTML = '';
    footer.innerHTML = '';

    if (state.current === STATES.IDLE) {
      body.innerHTML = renderModePicker();
      footer.innerHTML = `<button data-action="close">Fermer</button>`;
    } else if (state.current === STATES.SEARCH_FOOD) {
      body.innerHTML = renderSearch();
      const hasResults = state.results && state.results.length > 0;
      footer.innerHTML = hasResults
        ? `<button class="btn-primary" data-action="confirm-selected">&#x2713; Ajouter au journal</button><button data-action="close">Annuler</button>`
        : `<button data-action="close">Annuler</button>`;
      setTimeout(() => $('#capture-search-input')?.focus(), 60);
    } else if (state.current === STATES.MEAL_SELECT) {
      body.innerHTML = renderMealSelect();
      footer.innerHTML = `<button class="btn-primary" data-action="confirm-with-meal">✓ Ajouter</button><button data-action="back-mode">↩ Retour</button><button data-action="close">Annuler</button>`;
    } else if (state.current === STATES.BARCODE_SCAN) {
      body.innerHTML = renderBarcodeScan();
      footer.innerHTML = `<button data-action="manual-barcode">Rechercher le code</button><button data-action="close">Annuler</button>`;
    } else if (state.current === STATES.BARCODE_RESULT || state.current === STATES.CONFIRM_FOOD || state.current === STATES.CONFIRM_RECIPE) {
      body.innerHTML = state.mode === MODES.NUTRITION_TABLE
        ? renderNutritionConfirm()
        : state.mode === MODES.RECIPE
          ? renderRecipeDishConfirm()
          : isIaSuggestionMode()
            ? renderIaTextResults()
            : renderResults();
      if (isIaSuggestionMode()) {
        footer.innerHTML = `<button class="btn-primary" data-action="confirm-selected">Ajouter la sélection</button><button data-action="select-all-ia">Tout sélectionner</button><button data-action="clear-ia-selection">Tout désélectionner</button><button data-action="back-mode">Retour</button><button data-action="close">Fermer</button>`;
        requestAnimationFrame(updateIaTextSelectionSummary);
      } else {
        footer.innerHTML = `<button class="btn-primary" data-action="confirm-selected">Ajouter au journal</button><button data-action="back-mode">Retour</button><button data-action="close">Fermer</button>`;
      }
    } else if (state.current === STATES.PHOTO_CAPTURE) {
      body.innerHTML = renderPhotoCapture();
      footer.innerHTML = `<button class="btn-primary" data-action="use-photo">Continuer</button><button data-action="close">Annuler</button>`;
    } else if (state.current === STATES.CROP) {
      body.innerHTML = renderInlineCrop();
      footer.innerHTML = state.mode === MODES.NUTRITION_TABLE
        ? `<button class="btn-primary" data-action="read-crop">📖 Lire ce tableau</button><button data-action="back-photo">↩ Reprendre photo</button><button data-action="close">Annuler</button>`
        : `<button class="btn-primary" data-action="read-crop">📖 Lire cette zone</button><button data-action="back-photo">↩ Reprendre photo</button><button data-action="close">Annuler</button>`;
      requestAnimationFrame(syncInlineCropSelection);
    } else if (state.current === STATES.NUTRITION_TABLE_OCR || state.current === STATES.RECIPE_OCR) {
      body.innerHTML = renderOcrReview();
      footer.innerHTML = state.mode === MODES.NUTRITION_TABLE
        ? `<button class="btn-primary" data-action="analyse-ocr">📊 Extraire les valeurs</button><button data-action="groq-nutrition-label-fallback">✨ Relire avec Groq</button><button data-action="back-photo">Retour photo</button><button data-action="close">Annuler</button>`
        : `<button class="btn-primary" data-action="analyse-ocr">✨ Analyser avec IA</button><button data-action="groq-recipe-photo-fallback">📷 OCR mauvais ? Envoyer la photo à Groq</button><button data-action="back-photo">Retour photo</button><button data-action="close">Annuler</button>`;
    } else if (state.current === STATES.AI_ANALYSIS) {
      body.innerHTML = renderAiInput();
      footer.innerHTML = `<button class="btn-primary" data-action="run-ai">Analyser avec Groq</button><button data-action="close">Annuler</button>`;
    } else if (state.current === STATES.SAVED) {
      body.innerHTML = renderSaved();
      footer.innerHTML = `<button class="btn-primary" data-action="restart">Nouvelle capture</button><button data-action="close">Fermer</button>`;
    } else if (state.current === STATES.ERROR) {
      body.innerHTML = renderError();
      footer.innerHTML = `<button class="btn-primary" data-action="restart-current">Réessayer</button><button data-action="restart">Changer de mode</button><button data-action="close">Fermer</button>`;
    }
  }

  function renderModePicker() {
    return `
      <div class="capture-mode-grid">
        ${modeButton(MODES.SEARCH, '🔎', 'Recherche base aliments', 'Aliment connu, CIQUAL ou OpenFoodFacts.')}
        ${modeButton(MODES.BARCODE, '🏷️', 'Scan code-barres', 'Produit emballé avec code EAN.')}
        ${modeButton(MODES.PHOTO_FOOD, '📷', 'Photo plat', 'Photo analysée par Groq Vision, puis validation.')}
        ${modeButton(MODES.NUTRITION_TABLE, '📊', 'Tableau nutritionnel', 'Photo/OCR des valeurs pour 100 g.')}
        ${modeButton(MODES.RECIPE, '🍲', 'Recette', 'Ingrédients ou préparation à convertir en portions.')}
        ${modeButton(MODES.IA_TEXT, '⚡', 'Coller / IA', 'Texte libre, repas restaurant, liste d’aliments.')}
      </div>`;
  }

  function modeButton(mode, icon, title, desc) {
    return `<button class="capture-mode-card" data-capture-mode="${mode}"><span>${icon}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(desc)}</small></button>`;
  }

  function renderSearch() {
    const qty = state.searchQty || 100;
    const sf = getSourceFilters();
    return `
      <div class="capture-field-row">
        <label>Aliment</label>
        <input id="capture-search-input" type="text" autocomplete="off" placeholder="Ex : banane, skyr, riz cuit…" value="${escapeHtml(state.lastQuery || '')}">
      </div>
      <div class="capture-source-filters">
        <button class="capture-source-chip ${sf.base ? 'active' : ''}" data-action="toggle-source" data-source="base"><span>&#128190;</span><b>Base</b></button>
        <button class="capture-source-chip ${sf.recipe ? 'active' : ''}" data-action="toggle-source" data-source="recipe"><span>&#127858;</span><b>Recettes</b></button>
        <button class="capture-source-chip ${sf.off ? 'active' : ''}" data-action="toggle-source" data-source="off"><span>&#128722;</span><b>OpenFoodFacts</b></button>
        <button class="capture-source-chip ${sf.ciq ? 'active' : ''}" data-action="toggle-source" data-source="ciq"><span>&#127807;</span><b>CIQUAL</b></button>
      </div>
      <div class="capture-qty-row">
        <label class="capture-qty-label">Quantité : <strong id="capture-qty-display">${qty}</strong> g</label>
        <input id="capture-search-qty" type="range" min="5" max="500" step="5" value="${qty}" class="capture-qty-slider">
      </div>
      <div id="capture-search-results" class="capture-results-list muted">Tape au moins 2 caractères.</div>`;
  }

  function renderMealSelect() {
    const item = state.results[state.selectedIndex] || state.results[0];
    const meal = state.targetMeal || 'lunch';
    const qty = state.searchQty || item?.qty || 100;
    const m = item ? macrosForQty(item, qty) : null;
    const preview = m ? `<div class="capture-meal-preview">
      <strong>${escapeHtml(item.nom || 'Aliment')}</strong>
      <div class="capture-macros">${captureMacroSummaryHTML(m)}</div>
      <div class="capture-meal-qty">${qty} g</div>
    </div>` : '';
    return `
      ${preview}
      <div class="capture-meal-label">Dans quel repas ?</div>
      <div id="capture-meal-select" class="capture-meal-grid">
        <button class="capture-meal-chip ${meal === 'breakfast' ? 'active' : ''}" data-action="set-meal" data-meal="breakfast"><span>☕</span><b>Petit-déj</b></button>
        <button class="capture-meal-chip ${meal === 'lunch' ? 'active' : ''}" data-action="set-meal" data-meal="lunch"><span>🍽</span><b>Déjeuner</b></button>
        <button class="capture-meal-chip ${meal === 'dinner' ? 'active' : ''}" data-action="set-meal" data-meal="dinner"><span>🌙</span><b>Dîner</b></button>
        <button class="capture-meal-chip ${meal === 'snack' ? 'active' : ''}" data-action="set-meal" data-meal="snack"><span>🍎</span><b>Collation</b></button>
      </div>`;
  }

  function renderBarcodeScan() {
    return `
      <div class="capture-camera-box">
        <video id="capture-barcode-video" playsinline muted></video>
        <div class="capture-scan-frame"></div>
      </div>
      <div class="capture-inline-fields">
        <div><label>Code manuel</label><input id="capture-barcode-manual" inputmode="numeric" placeholder="Ex : 3274080005003"></div>
        <div><label>Quantité consommée</label><input id="capture-barcode-qty" type="number" inputmode="decimal" value="100"></div>
      </div>
      <div class="capture-help">Si la caméra ou BarcodeDetector n’est pas disponible, la saisie manuelle reste fiable.</div>`;
  }

  function renderPhotoCapture() {
    const isPhotoFood = state.mode === MODES.PHOTO_FOOD;
    const isRecipe = state.mode === MODES.RECIPE;
    const isNutrition = state.mode === MODES.NUTRITION_TABLE;
    const modeHint = isNutrition
      ? 'Cadre le tableau nutritionnel, puis prends la photo. Tu pourras corriger l’OCR avant IA.'
      : isRecipe
        ? 'Cadre la recette ou la liste d’ingrédients, puis prends la photo. Tu pourras corriger l’OCR avant IA.'
        : 'Cadre ton plat ou choisis une photo existante. Groq Vision proposera les aliments et quantités, puis tu valideras avant ajout.';
    return `
      <div class="capture-help">${escapeHtml(modeHint)}</div>
      <input id="capture-photo-file" type="file" accept="image/*" capture="environment" hidden>
      <div class="capture-photo-camera-actions capture-photo-source-actions">
        <button type="button" class="btn-primary" data-action="choose-photo-file">📷 Prendre / choisir une photo</button>
        <button type="button" data-action="start-photo-camera">Ouvrir la caméra intégrée</button>
      </div>
      <div class="capture-camera-box capture-photo-camera-box" id="capture-photo-camera-box" hidden>
        <video id="capture-photo-video" playsinline muted autoplay></video>
        <div class="capture-scan-frame"></div>
      </div>
      <div class="capture-photo-camera-actions" id="capture-photo-camera-actions" hidden>
        <button type="button" class="btn-primary" data-action="capture-photo-frame">✓ Utiliser cette photo</button>
        <button type="button" data-action="stop-photo-camera">Fermer la caméra</button>
      </div>
      <canvas id="capture-photo-canvas" hidden></canvas>
      <div class="capture-preview" id="capture-image-preview" ${state.imageDataUrl ? '' : 'hidden aria-hidden="true"'}>${state.imageDataUrl ? `<img src="${state.imageDataUrl}" alt="Photo capturée">` : ''}</div>
      ${isPhotoFood ? `
        <div class="capture-field-row">
          <label>Précisions optionnelles</label>
          <textarea id="capture-photo-desc" placeholder="Ex : restaurant entreprise, sauce à part, riz plutôt petit volume…">${escapeHtml(state.aiText || '')}</textarea>
        </div>
        <div class="capture-help">La photo est envoyée temporairement au serveur pour Groq Vision. Aucune image n’est stockée et rien n’est ajouté au journal tant que tu ne valides pas les cartes.</div>` : ''}`;
  }

  function renderInlineCrop() {
    if (!state.imageDataUrl) {
      return '<div class="capture-empty">Aucune photo à recadrer.</div>';
    }
    const isNutrition = state.mode === MODES.NUTRITION_TABLE;
    const title = isNutrition ? 'Recadrer le tableau nutritionnel' : 'Recadrer la recette';
    const hint = isNutrition
      ? 'Garde seulement les lignes utiles : kcal, protéines, glucides, lipides, idéalement pour 100 g.'
      : 'Garde surtout la liste d’ingrédients. Évite les longues instructions de préparation si possible.';
    const c = normalizeCropRect(state.crop || { x: 8, y: 10, w: 84, h: 68 });
    return `
      <div class="capture-crop-wrap">
        <div class="capture-help"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(hint)}</div>
        <div id="capture-crop-stage" class="capture-crop-stage">
          <img id="capture-crop-img" src="${state.imageDataUrl}" alt="Photo à recadrer" draggable="false">
          <div id="capture-crop-selection" class="capture-crop-selection" style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%;">
            ${['nw','ne','sw','se','n','s','w','e'].map(h => `<span class="capture-crop-handle ${h}" data-handle="${h}"></span>`).join('')}
          </div>
        </div>
        <div class="capture-help">Déplace le cadre ou tire les poignées. Cette étape remplace l’ancien écran de recadrage, sans changer d’interface.</div>
      </div>`;
  }

  function renderOcrReview() {
    const label = state.current === STATES.NUTRITION_TABLE_OCR ? 'Texte détecté sur le tableau nutritionnel' : 'Texte détecté sur la recette';
    const summary = state.ocrPassSummary ? renderOcrPassSummary(state.ocrPassSummary) : '';
    return `
      ${state.imageDataUrl ? `<img class="capture-image-small" src="${state.imageDataUrl}" alt="Image OCR">` : ''}
      ${summary}
      <div class="capture-field-row">
        <label>${label}</label>
        <textarea id="capture-ocr-text" class="capture-large-textarea" placeholder="Le résultat OCR apparait ici. Tu peux corriger avant IA.">${escapeHtml(state.ocrText || '')}</textarea>
      </div>
      <div class="capture-help">FoodNote lance maintenant plusieurs passes OCR automatiquement. Si le texte reste mauvais, corrige-le ou utilise le bouton Groq en secours, sans créer de doublon de parcours.</div>`;
  }

  function renderOcrPassSummary(summary) {
    const quality = summary.quality || 'à vérifier';
    const label = summary.bestLabel || 'meilleure passe automatique';
    const attempts = Array.isArray(summary.attempts) ? summary.attempts.length : 0;
    return `<div class="capture-help"><strong>OCR automatique :</strong> ${escapeHtml(quality)} · ${escapeHtml(label)}${attempts ? ` · ${attempts} passe${attempts > 1 ? 's' : ''}` : ''}</div>`;
  }

  function renderAiInput() {
    const placeholder = state.mode === MODES.RECIPE
      ? 'Ex : Recette pour 4 portions : 300 g riz cru, 500 g poulet, 200 ml crème…'
      : state.mode === MODES.NUTRITION_TABLE
        ? 'Colle ici les valeurs OCR du tableau nutritionnel…'
        : 'Ex : Boeuf grillé 120 g, pommes sautées 150 g, choux de Bruxelles 100 g…';
    return `
      <div class="capture-field-row">
        <label>Texte à analyser</label>
        <textarea id="capture-ai-text" class="capture-large-textarea" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.aiText || state.ocrText || '')}</textarea>
      </div>
      ${state.mode === MODES.RECIPE ? `
        <div class="capture-inline-fields">
          <div><label>Portions recette</label><input id="capture-recipe-servings" type="number" step="1" min="1" value="4"></div>
          <div><label>Portions consommées</label><input id="capture-recipe-eaten" type="number" step="0.5" min="0.5" value="1"></div>
        </div>` : `
        <div class="capture-inline-fields">
          <div><label>Quantité par défaut</label><input id="capture-ai-default-qty" type="number" step="1" value="100"></div>
        </div>`}
      <div class="capture-help">La réponse IA sera convertie en aliments validables ligne par ligne.</div>`;
  }

  function renderNutritionConfirm() {
    const item = state.results[0];
    if (!item) return '<p>Aucun résultat.</p>';
    const qty = state.searchQty || 100;
    const r = qty / 100;
    return `
      <div class="nutr-confirm-wrap">
        <div class="nutr-confirm-name-row">
          <label>Nom</label>
          <input id="nc-nom" class="nutr-confirm-input" type="text" value="${escapeHtml(item.nom || 'Produit scanné')}">
        </div>
        <div class="nutr-confirm-fields">
          <div class="nutr-confirm-field">
            <label>🔥 Kcal</label>
            <input id="nc-kcal-input" class="nutr-confirm-num" type="number" value="${Math.round((item.kcal||0)*r)}" min="0">
          </div>
          <div class="nutr-confirm-field">
            <label>🥩 Protéines g</label>
            <input id="nc-prot-input" class="nutr-confirm-num" type="number" value="${((item.prot||0)*r).toFixed(1)}" min="0" step="0.1">
          </div>
          <div class="nutr-confirm-field">
            <label>🍞 Glucides g</label>
            <input id="nc-gluc-input" class="nutr-confirm-num" type="number" value="${((item.gluc||0)*r).toFixed(1)}" min="0" step="0.1">
          </div>
          <div class="nutr-confirm-field">
            <label>🥑 Lipides g</label>
            <input id="nc-lip-input" class="nutr-confirm-num" type="number" value="${((item.lip||0)*r).toFixed(1)}" min="0" step="0.1">
          </div>
        </div>
        <div class="nutr-confirm-qty-row">
          <label class="nutr-confirm-qty-label">Quantité : <strong id="nc-qty-display">${qty}</strong> g</label>
          <input id="nc-qty-slider" type="range" min="5" max="500" step="5" value="${qty}" class="capture-qty-slider">
        </div>
        <label class="nutr-confirm-save-row">
          <input type="checkbox" id="nc-save-base" checked>
          <span>Sauvegarder dans ma base (valeurs pour 100g)</span>
        </label>

      </div>`;
  }


  function renderRecipeDishConfirm() {
    const item = state.results[0];
    if (!item) return '<p>Aucun résultat recette.</p>';
    const totalWeight = Math.max(1, Math.round(clampNumber(item.totalWeight || item.total_weight || item.poidsTotal || item.qty, 100)));
    const qty = Math.max(1, Math.round(clampNumber(state.searchQty || item.qty, totalWeight)));
    const per100 = totalsToPer100(item);
    const kcal100 = round1(clampNumber(item.kcal100, per100.kcal100));
    const prot100 = round1(clampNumber(item.prot100, per100.prot100));
    const gluc100 = round1(clampNumber(item.gluc100, per100.gluc100));
    const lip100  = round1(clampNumber(item.lip100,  per100.lip100));
    const maxQty = Math.max(100, totalWeight, qty);
    const kcalQ = Math.round(kcal100 * qty / 100);
    const protQ = round1(prot100 * qty / 100);
    const glucQ = round1(gluc100 * qty / 100);
    const lipQ  = round1(lip100  * qty / 100);
    return `
      <div class="nutr-confirm-wrap recipe-confirm-wrap">
        <div class="nutr-confirm-name-row">
          <label>Nom du plat</label>
          <input id="rc-nom" class="nutr-confirm-input" type="text" value="${escapeHtml(item.nom || 'Plat maison')}">
        </div>
        <div class="nutr-confirm-fields">
          <div class="nutr-confirm-field">
            <label>⚖️ Poids total estimé g</label>
            <input id="rc-total-weight" class="nutr-confirm-num" type="number" value="${totalWeight}" min="1" step="1">
          </div>
          <div class="nutr-confirm-field">
            <label>🔥 Kcal / 100 g</label>
            <input id="rc-kcal100" class="nutr-confirm-num" type="number" value="${kcal100}" min="0" step="1">
          </div>
          <div class="nutr-confirm-field">
            <label>🥩 Protéines / 100 g</label>
            <input id="rc-prot100" class="nutr-confirm-num" type="number" value="${prot100}" min="0" step="0.1">
          </div>
          <div class="nutr-confirm-field">
            <label>🍞 Glucides / 100 g</label>
            <input id="rc-gluc100" class="nutr-confirm-num" type="number" value="${gluc100}" min="0" step="0.1">
          </div>
          <div class="nutr-confirm-field">
            <label>🥑 Lipides / 100 g</label>
            <input id="rc-lip100" class="nutr-confirm-num" type="number" value="${lip100}" min="0" step="0.1">
          </div>
        </div>
        <div class="nutr-confirm-qty-row">
          <label class="nutr-confirm-qty-label">Quantité consommée : <strong id="rc-qty-display">${qty}</strong> g</label>
          <input id="rc-qty-slider" type="range" min="5" max="${maxQty}" step="5" value="${qty}" class="capture-qty-slider">
          <input id="rc-qty-input" class="nutr-confirm-input" type="number" min="1" step="1" value="${qty}">
        </div>
        <div class="nutr-confirm-macros capture-macros" id="rc-consumed-macros">
          ${captureMacroSummaryHTML({ kcal: kcalQ, prot: protQ, gluc: glucQ, lip: lipQ }, { compact: false })}
        </div>
        <div class="capture-help">Le nom, le poids total et les valeurs pour 100 g restent éditables avant ajout.</div>
      </div>`;
  }

  function updateRecipeConfirmPreview() {
    const qty = clampNumber($('#rc-qty-input')?.value || $('#rc-qty-slider')?.value, 100);
    const kcal100 = clampNumber($('#rc-kcal100')?.value, 0);
    const prot100 = clampNumber($('#rc-prot100')?.value, 0);
    const gluc100 = clampNumber($('#rc-gluc100')?.value, 0);
    const lip100 = clampNumber($('#rc-lip100')?.value, 0);
    const disp = $('#rc-qty-display');
    if (disp) disp.textContent = Math.round(qty);
    const box = $('#rc-consumed-macros');
    if (box) {
      box.innerHTML = captureMacroSummaryHTML({
        kcal: Math.round(kcal100 * qty / 100),
        prot: round1(prot100 * qty / 100),
        gluc: round1(gluc100 * qty / 100),
        lip: round1(lip100 * qty / 100)
      }, { compact: false });
    }
  }


  function renderIaTextResults() {
    if (!state.results.length) return '<div class="capture-empty">Aucun aliment IA à valider.</div>';
    normalizeIaTextSelectionDefaults();
    const remaining = state.results.filter(item => !item._addedToJournal).length;
    const selected = getIaTextSelectedIndexes().length;
    const total = state.results.length;
    return `
      <div class="capture-ia-list-head">
        <strong>${remaining ? remaining + ' aliment' + (remaining > 1 ? 's' : '') + ' restant' + (remaining > 1 ? 's' : '') : 'Tous les aliments sont ajoutés'}</strong>
        <small><span id="capture-ia-selected-count">${selected}</span> sélectionné${selected > 1 ? 's' : ''} · poids et sauvegarde en base réglables ligne par ligne.</small>
      </div>
      <div class="capture-results-list capture-ia-results-list">
        ${state.results.map((item, idx) => iaTextResultCard(item, idx)).join('')}
      </div>
      <div class="capture-help">Coche les lignes à ajouter, ajuste le poids avec le slider, puis touche “Ajouter la sélection”. Les valeurs sauvegardées en base sont recalculées pour 100 g.</div>`;
  }

  function ensureIaTextPer100(item) {
    if (!item || typeof item !== 'object') return;
    const qty = Math.max(1, looseNumber(item.qty || item.defaut, 100));
    item.qty = qty;
    item.defaut = qty;
    const hasPer100 = looseNumber(item.kcal100, 0) || looseNumber(item.prot100, 0) || looseNumber(item.gluc100, 0) || looseNumber(item.lip100, 0);
    if (!hasPer100) {
      item.kcal100 = Math.round(looseNumber(item.kcal, 0) * 100 / qty);
      item.prot100 = round1(looseNumber(item.prot, 0) * 100 / qty);
      item.gluc100 = round1(looseNumber(item.gluc, 0) * 100 / qty);
      item.lip100  = round1(looseNumber(item.lip, 0)  * 100 / qty);
    }
  }

  function iaTextMacrosForQty(item, qty) {
    ensureIaTextPer100(item);
    const q = Math.max(1, clampNumber(qty || item.qty || item.defaut, 100));
    return {
      kcal: Math.round(looseNumber(item.kcal100, 0) * q / 100),
      prot: round1(looseNumber(item.prot100, 0) * q / 100),
      gluc: round1(looseNumber(item.gluc100, 0) * q / 100),
      lip:  round1(looseNumber(item.lip100, 0)  * q / 100)
    };
  }

  function iaTextNutritionSummaryContent(item, qty) {
    const m = iaTextMacrosForQty(item, qty);
    return captureMacroSummaryHTML(m, { compact: false, suffix: `pour ${round1(qty)} g` });
  }

  function iaTextMacroEditHtml(item, idx, qty) {
    const m = iaTextMacrosForQty(item, qty);
    // V6 : bloc nutrition autonome et visible.
    // Rôle : afficher et modifier kcal/prot/gluc/lip reçus du serveur pour la quantité validée.
    // Ne doit pas gérer : calcul serveur, appel Groq ou écriture SQLite directe.
    return `
      <section class="capture-ia-nutrition-visible" id="capture-ia-macros-${idx}" aria-label="Calories et nutriments estimés">
        <div class="capture-ia-nutrition-visible-head">
          <strong>Calories / nutriments</strong>
          <small>pour ${round1(qty)} g</small>
        </div>
        <div class="capture-ia-nutrition-visible-grid">
          <label class="capture-ia-nutrition-visible-cell">
            <span>🔥 kcal</span>
            <input class="capture-ia-macro-input" data-ia-idx="${idx}" data-macro="kcal" type="number" min="0" step="1" value="${Math.round(m.kcal)}">
          </label>
          <label class="capture-ia-nutrition-visible-cell">
            <span>🍖 prot.</span>
            <input class="capture-ia-macro-input" data-ia-idx="${idx}" data-macro="prot" type="number" min="0" step="0.1" value="${round1(m.prot)}">
          </label>
          <label class="capture-ia-nutrition-visible-cell">
            <span>🍞 gluc.</span>
            <input class="capture-ia-macro-input" data-ia-idx="${idx}" data-macro="gluc" type="number" min="0" step="0.1" value="${round1(m.gluc)}">
          </label>
          <label class="capture-ia-nutrition-visible-cell">
            <span>🥑 lip.</span>
            <input class="capture-ia-macro-input" data-ia-idx="${idx}" data-macro="lip" type="number" min="0" step="0.1" value="${round1(m.lip)}">
          </label>
        </div>
      </section>`;
  }

  function visionConfidenceHtml(item) {
    const type = visionItemTypeLabel(item?.item_type || item?.food_type || item?.type || '');
    const food = confidenceLabel(item?.confidence_food || item?.confiance_aliment || '');
    const qty = confidenceLabel(item?.confidence_quantity || item?.confiance_quantite || item?.confiance_quantité || '');
    const notes = String(item?.notes || item?.note || '').trim();
    if (!type && !food && !qty && !notes) return '';
    const bits = [];
    if (type) bits.push('type : ' + type);
    if (food) bits.push('aliment : ' + food);
    if (qty) bits.push('quantité : ' + qty);
    const source = String(item?.nutrition_source || '').trim();
    if (source === 'groq_batch_obligatoire' || source === 'groq_batch_obligatoire_v4') bits.push('nutrition : Groq batch');
    else if (source === 'groq_batch') bits.push('nutrition : Groq batch');
    else if (source === 'ciqual') bits.push('nutrition : CIQUAL');
    else if (source === 'base_personnelle') bits.push('nutrition : base personnelle');
    if (notes) bits.push(notes);
    return `<div class="capture-help capture-vision-confidence">${escapeHtml(bits.join(' · '))}</div>`;
  }

  function iaTextResultCard(item, idx) {
    // Photo plat / IA : le nom proposé par Groq est une prédiction, donc il reste éditable
    // avant validation au même titre que le poids et les nutriments.
    if (item._selectedForAdd === undefined) item._selectedForAdd = !item._addedToJournal;
    ensureIaTextPer100(item);
    const qty = Math.max(1, clampNumber(item.qty || item.defaut, 100));
    const maxQty = Math.max(250, Math.ceil(qty * 3 / 50) * 50, 1000);
    const selected = item._selectedForAdd !== false && !item._addedToJournal;
    const added = !!item._addedToJournal;
    const saveBase = item.saveToBase !== false;
    return `
      <div class="capture-result-card capture-ia-result-card ${selected ? 'selected' : ''} ${added ? 'is-added' : ''}" data-ia-row="${idx}">
        <div class="capture-ia-card-top">
          <label class="capture-ia-title-check">
            <input class="capture-ia-select" data-ia-idx="${idx}" type="checkbox" ${selected ? 'checked' : ''} ${added ? 'disabled' : ''} aria-label="Sélectionner ${escapeHtml(item.nom || item.name || 'Aliment IA')}">
            <span class="capture-ia-name-wrap">
              <small>Aliment détecté, corrigible</small>
              <input class="capture-ia-name-input" data-ia-idx="${idx}" type="text" value="${escapeHtml(item.nom || item.name || 'Aliment IA')}" ${added ? 'disabled' : ''} aria-label="Nom de l’aliment détecté">
            </span>
          </label>
          ${added ? '<span class="capture-source-tag ok">✓ Ajouté</span>' : sourceBadge(item)}
        </div>
        ${visionConfidenceHtml(item)}
        <div class="capture-macros capture-ia-macro-summary" id="capture-ia-summary-${idx}">${iaTextNutritionSummaryContent(item, qty)}</div>

        <div class="capture-ia-qty-compact">
          <div class="capture-ia-qty-head">
            <span>Poids consommé</span>
            <strong id="capture-ia-qty-display-${idx}">${round1(qty)} g</strong>
          </div>
          <div class="capture-ia-qty-line">
            <input id="ia-qty-slider-${idx}" class="capture-ia-qty-slider" data-ia-idx="${idx}" type="range" min="1" max="${maxQty}" step="1" value="${round1(qty)}" ${added ? 'disabled' : ''}>
            <label class="capture-ia-number-wrap" aria-label="Poids en grammes">
              <input class="capture-ia-qty-input" data-ia-idx="${idx}" type="number" min="1" step="1" value="${round1(qty)}" ${added ? 'disabled' : ''}>
              <span>g</span>
            </label>
          </div>
        </div>

        ${iaTextMacroEditHtml(item, idx, qty)}

        <label class="capture-ia-save-row">
          <input class="capture-ia-save-base" data-ia-idx="${idx}" type="checkbox" ${saveBase ? 'checked' : ''} ${added ? 'disabled' : ''}>
          <span>Ajouter à ma base <small>valeurs recalculées pour 100 g</small></span>
        </label>
      </div>`;
  }

  function normalizeIaTextSelectionDefaults() {
    if (!Array.isArray(state.results)) return;
    state.results.forEach(item => {
      if (!item) return;
      if (item._addedToJournal) item._selectedForAdd = false;
      else if (item._selectedForAdd === undefined) item._selectedForAdd = true;
      if (item.saveToBase === undefined) item.saveToBase = true;
    });
  }

  function getIaTextSelectedIndexes() {
    normalizeIaTextSelectionDefaults();
    if (!Array.isArray(state.results)) return [];
    return state.results
      .map((item, idx) => ({ item, idx }))
      .filter(x => x.item && !x.item._addedToJournal && x.item._selectedForAdd !== false)
      .map(x => x.idx);
  }

  function updateIaTextSelectionSummary() {
    const selected = getIaTextSelectedIndexes().length;
    const el = document.getElementById('capture-ia-selected-count');
    if (el) el.textContent = String(selected);
    const primary = document.querySelector('#capture-footer [data-action="confirm-selected"]');
    if (primary && isIaSuggestionMode()) {
      primary.textContent = selected > 1 ? `Ajouter la sélection (${selected})` : selected === 1 ? 'Ajouter la sélection' : 'Sélection vide';
      primary.disabled = selected < 1;
    }
  }

  function syncIaTextRowFromInputs(idx, source = 'auto') {
    if (!Array.isArray(state.results) || idx < 0 || idx >= state.results.length) return;
    const item = state.results[idx];
    if (!item || item._addedToJournal) return;
    const qtyInput = document.querySelector(`.capture-ia-qty-input[data-ia-idx="${idx}"]`);
    const qtySlider = document.querySelector(`.capture-ia-qty-slider[data-ia-idx="${idx}"]`);
    const saveInput = document.querySelector(`.capture-ia-save-base[data-ia-idx="${idx}"]`);
    const selectInput = document.querySelector(`.capture-ia-select[data-ia-idx="${idx}"]`);
    const nameInput = document.querySelector(`.capture-ia-name-input[data-ia-idx="${idx}"]`);
    const rawQty = qtyInput && qtyInput.value !== '' ? qtyInput.value : qtySlider && qtySlider.value !== '' ? qtySlider.value : item.qty || 100;
    const qty = Math.max(1, clampNumber(rawQty, item.qty || 100));
    const editedName = nameInput ? String(nameInput.value || '').trim().replace(/\s{2,}/g, ' ') : '';
    if (editedName) {
      item.nom = editedName;
      item.name = editedName;
      item._nameEdited = true;
    }
    item.qty = qty;
    item.defaut = qty;
    item.saveToBase = saveInput ? !!saveInput.checked : item.saveToBase !== false;
    item._selectedForAdd = selectInput ? !!selectInput.checked : item._selectedForAdd !== false;

    if (source === 'macro') {
      const kcal = clampNumber(document.querySelector(`.capture-ia-macro-input[data-ia-idx="${idx}"][data-macro="kcal"]`)?.value, item.kcal || 0);
      const prot = clampNumber(document.querySelector(`.capture-ia-macro-input[data-ia-idx="${idx}"][data-macro="prot"]`)?.value, item.prot || 0);
      const gluc = clampNumber(document.querySelector(`.capture-ia-macro-input[data-ia-idx="${idx}"][data-macro="gluc"]`)?.value, item.gluc || 0);
      const lip  = clampNumber(document.querySelector(`.capture-ia-macro-input[data-ia-idx="${idx}"][data-macro="lip"]`)?.value,  item.lip  || 0);
      item.kcal = Math.round(kcal);
      item.prot = round1(prot);
      item.gluc = round1(gluc);
      item.lip  = round1(lip);
      item.kcal100 = Math.round(item.kcal * 100 / qty);
      item.prot100 = round1(item.prot * 100 / qty);
      item.gluc100 = round1(item.gluc * 100 / qty);
      item.lip100  = round1(item.lip  * 100 / qty);
    } else {
      const m = iaTextMacrosForQty(item, qty);
      item.kcal = m.kcal;
      item.prot = m.prot;
      item.gluc = m.gluc;
      item.lip  = m.lip;
      const macroBox = document.getElementById('capture-ia-macros-' + idx);
      if (macroBox) macroBox.outerHTML = iaTextMacroEditHtml(item, idx, qty);
    }

    if (qtyInput && Number(qtyInput.value) !== qty) qtyInput.value = round1(qty);
    if (qtySlider && Number(qtySlider.value) !== qty) qtySlider.value = round1(qty);
    const qtyDisplay = document.getElementById('capture-ia-qty-display-' + idx);
    if (qtyDisplay) qtyDisplay.textContent = round1(qty) + ' g';
    const summary = document.getElementById('capture-ia-summary-' + idx);
    if (summary) summary.innerHTML = iaTextNutritionSummaryContent(item, qty);
    const card = document.querySelector(`.capture-ia-result-card[data-ia-row="${idx}"]`);
    if (card) card.classList.toggle('selected', item._selectedForAdd !== false);
    updateIaTextSelectionSummary();
  }

  function syncAllIaTextRowsFromInputs() {
    if (!Array.isArray(state.results)) return;
    state.results.forEach((_, idx) => syncIaTextRowFromInputs(idx));
  }

  function setAllIaTextSelection(value) {
    normalizeIaTextSelectionDefaults();
    state.results.forEach((item, idx) => {
      if (!item || item._addedToJournal) return;
      item._selectedForAdd = !!value;
      const input = document.querySelector(`.capture-ia-select[data-ia-idx="${idx}"]`);
      if (input) input.checked = !!value;
      const card = document.querySelector(`.capture-ia-result-card[data-ia-row="${idx}"]`);
      if (card) card.classList.toggle('selected', !!value);
    });
    updateIaTextSelectionSummary();
  }

  function toggleIaTextSelection(idx) {
    if (!Array.isArray(state.results) || idx < 0 || idx >= state.results.length) return;
    const item = state.results[idx];
    if (!item || item._addedToJournal) return;
    item._selectedForAdd = !(item._selectedForAdd !== false);
    const input = document.querySelector(`.capture-ia-select[data-ia-idx="${idx}"]`);
    if (input) input.checked = item._selectedForAdd !== false;
    const card = document.querySelector(`.capture-ia-result-card[data-ia-row="${idx}"]`);
    if (card) card.classList.toggle('selected', item._selectedForAdd !== false);
    updateIaTextSelectionSummary();
  }

  function selectNextPendingIaTextResult() {
    if (!Array.isArray(state.results)) return false;
    const next = state.results.findIndex(item => !item._addedToJournal);
    if (next >= 0) {
      state.selectedIndex = next;
      return true;
    }
    return false;
  }

  function renderResults() {
    if (!state.results.length) {
      return '<div class="capture-empty">Aucun résultat à valider.</div>';
    }
    return `<div class="capture-results-list">${state.results.map((item, idx) => resultCard(item, idx)).join('')}</div>`;
  }

  function sourceBadge(item) {
    const src = (item.source || item._source || 'base').toLowerCase();
    if (src.includes('ciqual') || src === 'ciq') return '<span class="capture-source-tag ciq">🌿 CIQUAL</span>';
    if (src.includes('recipe') || src.includes('recette')) return '<span class="capture-source-tag recipe">🍲 Recette</span>';
    if (src.includes('openfoodfacts') || src === 'off') return '<span class="capture-source-tag off">🛒 OFF</span>';
    if (src.includes('vision')) return '<span class="capture-source-tag ia">📷 IA photo</span>';
    if (src === 'ia' || src === 'groq' || src.includes('groq')) return '<span class="capture-source-tag ia">✨ IA</span>';
    return '<span class="capture-source-tag base">💾 Base</span>';
  }

  function resultCard(item, idx) {
    const qty = state.searchQty || clampNumber(item.qty, 100);
    const m = macrosForQty(item, qty);
    const checked = idx === state.selectedIndex ? 'checked' : '';
    const brand = item.brand ? `<span class="capture-result-brand">${escapeHtml(item.brand)}</span>` : '';
    return `
      <label class="capture-result-card ${checked ? 'selected' : ''}">
        <input type="radio" name="capture-result" value="${idx}" ${checked}>
        <div class="capture-result-main">
          <div class="capture-result-header">
            <strong>${escapeHtml(item.nom || item.name || 'Aliment')}</strong>
            ${sourceBadge(item)}
          </div>
          ${brand}
          <div class="capture-macros">${captureMacroSummaryHTML(m)}</div>
        </div>
        <div class="capture-result-qty"><span>${round1(qty)}</span><small>${escapeHtml(item.unite || item.unit || 'g')}</small></div>
      </label>`;
  }

  function renderSaved() {
    return `
      <div class="capture-saved-box">
        <div class="capture-saved-icon">✓</div>
        <div><strong>Ajout validé</strong><p>L’aliment ou la recette a été transmis au journal via le chemin central.</p></div>
      </div>`;
  }

  function renderError() {
    return `
      <div class="capture-error-box">
        <strong>${escapeHtml(state.lastError || 'Erreur inconnue')}</strong>
        <p>Le workflow reste dans un état explicite. Aucune bascule silencieuse vers Recherche ou Photo/OCR.</p>
      </div>`;
  }

  function legacySearchSuggestionKeepActive() {
    try {
      if (typeof window.foodnoteShouldKeepDBSuggestionsVisible === 'function' && window.foodnoteShouldKeepDBSuggestionsVisible()) return true;
      if (typeof window.foodnoteIsDBQuantityFlowActive === 'function' && window.foodnoteIsDBQuantityFlowActive()) return true;
      return Number(window.__foodnoteKeepDBSuggestionsVisibleUntil || 0) > now();
    } catch(e) { return false; }
  }

  function preserveLegacySearchSuggestions(index) {
    const box = document.getElementById('db-suggestions');
    if (!box) return;
    try {
      if (typeof window.foodnoteKeepDBSuggestionsVisibleAfterPick === 'function') {
        window.foodnoteKeepDBSuggestionsVisibleAfterPick(index, 9000);
      } else {
        window.__foodnoteKeepDBSuggestionsVisibleUntil = now() + 9000;
      }
      box.classList.add('visible');
      box.removeAttribute('aria-hidden');
      box.style.removeProperty('display');
      box.style.removeProperty('visibility');
      box.style.removeProperty('pointer-events');
    } catch(e) {}
  }

  function installLegacySearchSuggestionGuard() {
    if (document.__foodnoteCaptureLegacySearchSuggestionGuard === '1') return;
    document.__foodnoteCaptureLegacySearchSuggestionGuard = '1';
    const handle = (ev) => {
      const target = ev.target;
      const el = target && target.closest && target.closest('#db-suggestions [data-food-add-action="search-pick"]');
      if (!el) return;
      const index = Number(el.dataset.searchIndex ?? el.dataset.index ?? -1);
      if (!Number.isInteger(index) || index < 0) return;
      preserveLegacySearchSuggestions(index);
      if (typeof window.pickDBSuggestion === 'function') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        window.pickDBSuggestion(index, { keepSuggestions:true, source:'capture-workflow-legacy-suggestion-guard' });
        try {
          const st = window.FoodNoteFoodAddSearchState;
          const picked = st && typeof st.getSuggestion === 'function' ? st.getSuggestion(index) : null;
          const food = picked && (picked.item || picked.food || picked);
          if (typeof window.foodnoteStabilizeSearchPickSurface === 'function') window.foodnoteStabilizeSearchPickSurface(food, index, { sticky:true, ms:12000 });
        } catch(e) {}
        preserveLegacySearchSuggestions(index);
        setTimeout(() => preserveLegacySearchSuggestions(index), 60);
        setTimeout(() => preserveLegacySearchSuggestions(index), 180);
        setTimeout(() => preserveLegacySearchSuggestions(index), 420);
        setTimeout(() => preserveLegacySearchSuggestions(index), 900);
      }
    };
    document.addEventListener('pointerdown', handle, true);
    document.addEventListener('mousedown', handle, true);
    document.addEventListener('touchstart', handle, true);
    document.addEventListener('touchend', handle, true);
    document.addEventListener('click', handle, true);
  }

  function bindEvents() {
    installLegacySearchSuggestionGuard();
    document.addEventListener('click', async (ev) => {
      const target = ev.target;
      if (!target || !target.closest) return;

      const modeBtn = target.closest('[data-capture-mode]');
      if (modeBtn && (modeBtn.closest('#capture-workflow-modal') || modeBtn.closest('#foodnote-capture-launcher'))) {
        ev.preventDefault();
        ev.stopPropagation();
        open(modeBtn.getAttribute('data-capture-mode'));
        return;
      }

      const iaRow = target.closest('.capture-ia-result-card[data-ia-row]');
      if (iaRow && iaRow.closest('#capture-workflow-modal')) {
        const interactive = target.closest('input, button, textarea, select, a, .capture-ia-row-actions, .capture-ia-save-row, .capture-ia-qty-block');
        if (!interactive) {
          ev.preventDefault();
          ev.stopPropagation();
          toggleIaTextSelection(clampNumber(iaRow.getAttribute('data-ia-row'), -1));
          return;
        }
      }

      const actionBtn = target.closest('[data-action]');
      // 0.22.119 : ne jamais intercepter les data-action globaux de FoodNote.
      // Le workflow capture ne traite que ses propres boutons. Sinon un clic
      // dans le journal/popup legacy peut être preventDefault par erreur.
      if (!actionBtn || !actionBtn.closest('#capture-workflow-modal')) return;

      ev.preventDefault();
      ev.stopPropagation();
      await handleAction(actionBtn.getAttribute('data-action'), actionBtn);
    }, true);

    document.addEventListener('pointerdown', handleInlineCropPointerDown, true);
    document.addEventListener('pointermove', handleInlineCropPointerMove, true);
    document.addEventListener('pointerup', handleInlineCropPointerUp, true);
    document.addEventListener('pointercancel', handleInlineCropPointerUp, true);

    document.addEventListener('input', (ev) => {
      if (ev.target && ev.target.id === 'nc-qty-slider') {
        state.searchQty = Number(ev.target.value) || 100;
        const q = state.searchQty;
        const item = state.results && state.results[0];
        if (item) {
          const r = q / 100;
          const d = document;
          if (d.getElementById('nc-qty-display')) d.getElementById('nc-qty-display').textContent = q;
          if (d.getElementById('nc-kcal-input')) d.getElementById('nc-kcal-input').value = Math.round((item.kcal||0)*r);
          if (d.getElementById('nc-prot-input')) d.getElementById('nc-prot-input').value = ((item.prot||0)*r).toFixed(1);
          if (d.getElementById('nc-gluc-input')) d.getElementById('nc-gluc-input').value = ((item.gluc||0)*r).toFixed(1);
          if (d.getElementById('nc-lip-input'))  d.getElementById('nc-lip-input').value  = ((item.lip||0)*r).toFixed(1);
        }
      }
      if (ev.target && ['rc-qty-slider','rc-qty-input','rc-kcal100','rc-prot100','rc-gluc100','rc-lip100','rc-total-weight'].includes(ev.target.id)) {
        if (ev.target.id === 'rc-qty-slider') {
          const input = document.getElementById('rc-qty-input');
          if (input) input.value = ev.target.value;
          state.searchQty = Number(ev.target.value) || 100;
        } else if (ev.target.id === 'rc-qty-input') {
          const slider = document.getElementById('rc-qty-slider');
          if (slider) slider.value = ev.target.value;
          state.searchQty = Number(ev.target.value) || 100;
        }
        updateRecipeConfirmPreview();
      }
      if (ev.target && ev.target.matches && (ev.target.matches('.capture-ia-name-input') || ev.target.matches('.capture-ia-qty-input') || ev.target.matches('.capture-ia-qty-slider') || ev.target.matches('.capture-ia-save-base') || ev.target.matches('.capture-ia-select') || ev.target.matches('.capture-ia-macro-input'))) {
        const idx = clampNumber(ev.target.getAttribute('data-ia-idx'), -1);
        if (idx >= 0) {
          let source = 'auto';
          if (ev.target.matches('.capture-ia-qty-slider')) {
            source = 'qty';
            const n = document.querySelector(`.capture-ia-qty-input[data-ia-idx="${idx}"]`);
            if (n) n.value = ev.target.value;
          } else if (ev.target.matches('.capture-ia-qty-input')) {
            source = 'qty';
            const s = document.querySelector(`.capture-ia-qty-slider[data-ia-idx="${idx}"]`);
            if (s) s.value = ev.target.value;
          } else if (ev.target.matches('.capture-ia-macro-input')) {
            source = 'macro';
          } else if (ev.target.matches('.capture-ia-name-input')) {
            source = 'name';
          }
          syncIaTextRowFromInputs(idx, source);
        }
      }
    });
    document.addEventListener('input', debounceAsync(async (ev) => {
      const target = ev.target;
      if (!target || !target.closest || !target.closest('#capture-workflow-modal')) return;
      if (target.id === 'capture-search-input') {
        state.lastQuery = target.value;
        await runCaptureSearch(target.value);
      }
      if (target.id === 'capture-search-qty') {
        state.searchQty = Number(target.value) || 100;
        const disp = document.getElementById('capture-qty-display');
        if (disp) disp.textContent = state.searchQty;
        // 0.22.146 : ajuster la quantité ne doit pas relancer la recherche.
        // On garde les résultats existants, y compris Recettes, et on recalcule seulement les macros affichées.
        refreshSearchResultsForQty();
      }
    }, 180), true);

    document.addEventListener('change', async (ev) => {
      const target = ev.target;
      if (!target || !target.closest || !target.closest('#capture-workflow-modal')) return;
      if (target.id === 'capture-photo-file') {
        await loadSelectedImage(target.files && target.files[0]);
        return;
      }
      if (target.name === 'capture-result') {
        if (state.current === STATES.SEARCH_FOOD && state.mode === MODES.SEARCH) {
          applyCaptureSearchSelection(target.value, { source:'capture-result-change' });
          return;
        }
        state.selectedIndex = clampNumber(target.value, 0);
        if (isIaSuggestionMode()) syncAllIaTextRowsFromInputs();
        render();
      }
      if (target.matches && (target.matches('.capture-ia-save-base') || target.matches('.capture-ia-select'))) {
        const idx = clampNumber(target.getAttribute('data-ia-idx'), -1);
        if (idx >= 0) syncIaTextRowFromInputs(idx);
      }
    }, true);

    document.addEventListener('focusin', (ev) => {
      if (ev.target && ev.target.id === 'db-search') {
        const modalOpen = $('#capture-workflow-modal')?.classList.contains('visible');
        const allowed = state.current === STATES.SEARCH_FOOD || now() < state.allowDbFocusUntil;
        if (modalOpen && !allowed) {
          ev.target.blur();
          closeLegacySuggestions();
          renderStatus('Ancien champ recherche bloqué pendant la capture : utilise le workflow central.');
        }
      }
    }, true);
  }

  async function handleAction(action, el) {
    try {
      if (action === 'close') return close();
      if (action === 'restart') return openPicker();
      if (action === 'restart-current') return restartCurrent();
      if (action === 'back-mode') return backToModeStart();
      if (action === 'back-photo') {
        transition(STATES.PHOTO_CAPTURE);
        schedulePhotoCameraStart();
        return;
      }
      if (action === 'choose-photo-file') { document.getElementById('capture-photo-file')?.click(); return; }
      if (action === 'start-photo-camera') return startPhotoCamera();
      if (action === 'stop-photo-camera') return stopPhotoCameraOnly();
      if (action === 'capture-photo-frame') return capturePhotoFrame();
      if (action === 'manual-barcode') return lookupManualBarcode();
      if (action === 'use-photo') return continueAfterPhoto();
      if (action === 'read-crop') return continueAfterInlineCrop();
      if (action === 'analyse-ocr') return analyseOcrText();
      if (action === 'groq-nutrition-label-fallback') return runNutritionLabelGroqFallback();
      if (action === 'groq-recipe-photo-fallback') return runRecipePhotoGroqFallback();
      if (action === 'run-ai') return runAiFromInput();
      if (action === 'confirm-selected') return confirmSelected();
      if (action === 'select-all-ia') { setAllIaTextSelection(true); return; }
      if (action === 'clear-ia-selection') { setAllIaTextSelection(false); return; }
      if (action === 'reparse-ocr') {
        const txt = document.getElementById('nc-ocr-raw')?.value || state.ocrRaw || '';
        const parsed = parseNutritionTableOcr(txt);
        if (parsed.length) {
          state.results = parsed;
          state.searchQty = 100;
          const body = document.getElementById('capture-body');
          if (body) body.innerHTML = renderNutritionConfirm();
        }
        return;
      }
      if (action === 'confirm-with-meal') return confirmWithMeal();
      if (action === 'set-meal') {
        state.targetMeal = el && el.dataset.meal ? el.dataset.meal : 'lunch';
        // Mettre à jour visuellement
        document.querySelectorAll('#capture-meal-select .capture-meal-chip').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.meal === state.targetMeal);
        });
        return;
      }
      if (action === 'toggle-source') {
        const src = el && el.dataset.source;
        if (src) {
          getSourceFilters();
          state.sourceFilters[src] = !state.sourceFilters[src];
          const q = $('#capture-search-input')?.value || '';
          render();
          if (q.length >= 2) await runCaptureSearch(q);
        }
        return;
      }
    } catch (e) {
      fail(e.message || String(e));
    }
  }

  function debounceAsync(fn, wait) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args).catch(e => fail(e.message || String(e))), wait);
    };
  }

  function openPicker() {
    state.skipMealSelect = false;
    state.openedFromMealButton = false;
    showModal();
    transition(STATES.IDLE);
  }

  function open(mode, options = {}) {
    const opts = (mode && typeof mode === 'object') ? mode : Object.assign({}, options || {}, { mode });
    showModal();
    state.mode = opts.mode || MODES.SEARCH;
    state.targetMeal = normalizeCaptureMeal(opts.meal || state.targetMeal || 'lunch');
    state.skipMealSelect = !!opts.skipMealSelect;
    state.openedFromMealButton = !!opts.fromMealButton;
    try { if (state.skipMealSelect && typeof window.setFoodAddTargetMeal === 'function') window.setFoodAddTargetMeal(state.targetMeal); } catch(e) {}
    state.token++;
    state.results = [];
    state.ocrText = '';
    state.aiText = '';
    state.imageDataUrl = '';
    state.lastError = '';
    state.crop = { x: 8, y: 10, w: 84, h: 68 };
    state.cropDrag = null;
    closeLegacySuggestions();
    closeLegacyPanels();

    if (state.mode === MODES.SEARCH) {
      state.allowDbFocusUntil = now() + 250;
      transition(STATES.SEARCH_FOOD, { mode: state.mode });
    } else if (state.mode === MODES.BARCODE) {
      transition(STATES.BARCODE_SCAN, { mode: state.mode });
      setTimeout(startBarcodeCamera, 120);
    } else if (state.mode === MODES.PHOTO_FOOD || state.mode === MODES.NUTRITION_TABLE || state.mode === MODES.RECIPE) {
      transition(STATES.PHOTO_CAPTURE, { mode: state.mode });
      schedulePhotoCameraStart();
    } else if (isIaSuggestionMode()) {
      transition(STATES.AI_ANALYSIS, { mode: state.mode });
    } else {
      fail('Mode de capture inconnu : ' + state.mode);
    }
  }

  function restartCurrent() {
    const mode = state.mode || MODES.SEARCH;
    open({ mode, meal: state.targetMeal, skipMealSelect: state.skipMealSelect, fromMealButton: state.openedFromMealButton });
  }

  function backToModeStart() {
    if (state.mode === MODES.SEARCH) return transition(STATES.SEARCH_FOOD);
    if (state.mode === MODES.BARCODE) { transition(STATES.BARCODE_SCAN); setTimeout(startBarcodeCamera, 120); return; }
    if (state.mode === MODES.PHOTO_FOOD || state.mode === MODES.NUTRITION_TABLE || state.mode === MODES.RECIPE) {
      transition(STATES.PHOTO_CAPTURE);
      schedulePhotoCameraStart();
      return;
    }
    return transition(STATES.AI_ANALYSIS);
  }

  function schedulePhotoCameraStart() {
    const token = state.token;
    renderStatus('Ouverture de la caméra…');
    setTimeout(() => {
      if (token !== state.token) return;
      if (state.current !== STATES.PHOTO_CAPTURE) return;
      if (state.mode !== MODES.PHOTO_FOOD && state.mode !== MODES.NUTRITION_TABLE && state.mode !== MODES.RECIPE) return;
      startPhotoCamera();
    }, 120);
  }

  function fail(message) {
    stopMedia();
    state.busy = false;
    transition(STATES.ERROR, { error: message || 'Erreur inconnue.' });
  }

  function closeLegacySuggestions() {
    ['db-suggestions', 'food-add-suggestions', 'barcode-suggestions'].forEach(id => {
      if (id === 'db-suggestions' && legacySearchSuggestionKeepActive()) {
        preserveLegacySearchSuggestions(Number(document.getElementById('db-suggestions')?.dataset?.foodnotePickedIndex ?? -1));
        return;
      }
      const el = document.getElementById(id);
      if (el) el.classList.remove('visible');
    });
  }

  function closeLegacyPanels() {
    // Le moteur central doit rester propriétaire de la capture : on ferme les anciens panneaux
    // sans les laisser provoquer un retour silencieux vers Recherche / Photo-OCR.
    try { if (typeof window.closeBarcodeScannerPanel === 'function') window.closeBarcodeScannerPanel(); } catch (e) {}
    try { if (typeof window.closeOCRPanel === 'function') window.closeOCRPanel(); } catch (e) {}
    try { if (typeof window.stopNutritionOCRCamera === 'function') window.stopNutritionOCRCamera(false); } catch (e) {}
    ['barcode-scan-panel', 'ocr-panel', 'food-add-tool-sheet'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.body.classList.remove('barcode-modal-open', 'foodnote-crop-shell-open', 'foodnote-crop-camera-suspended');
  }


  function refreshSearchResultsForQty() {
    if (state.current !== STATES.SEARCH_FOOD) return;
    const box = document.getElementById('capture-search-results');
    if (!box || !Array.isArray(state.results) || !state.results.length) return;
    box.className = 'capture-results-list';
    box.innerHTML = state.results.map((item, idx) => resultCard(item, idx)).join('') + '<div class="capture-help">Sélectionne un résultat puis valide.</div>';
    const footer = document.getElementById('capture-footer');
    if (footer) {
      footer.innerHTML = '<button class="btn-primary" data-action="confirm-selected">✓ Ajouter au journal</button><button data-action="close">Annuler</button>';
    }
  }

  function captureSearchSelectedFoodName(item) {
    return String((item && (item.nom || item.name)) || '').trim();
  }

  function syncCaptureSearchSelectedItemQty(item) {
    if (!item) return null;
    const qty = Math.max(1, Math.round(clampNumber(state.searchQty || item.qty || item.defaut, 100)));
    item.qty = qty;
    item.defaut = qty;
    return qty;
  }

  function applyCaptureSearchSelection(index, options = {}) {
    if (!Array.isArray(state.results) || !state.results.length) return null;
    const idx = clampNumber(index, 0);
    if (!state.results[idx]) return null;
    state.selectedIndex = idx;
    const item = state.results[idx];
    syncCaptureSearchSelectedItemQty(item);
    const name = captureSearchSelectedFoodName(item);
    if (name) {
      state.lastQuery = name;
      const input = document.getElementById('capture-search-input');
      if (input && input.value !== name) input.value = name;
    }

    // 0.22.179 : ne pas appeler render() ici. render() reconstruit tout l'écran
    // recherche, remet le champ à l'ancienne requête et vide #capture-search-results.
    // C'est ce qui faisait disparaître les propositions après clic, puis les faisait
    // revenir quand le poids déclenchait refreshSearchResultsForQty().
    refreshSearchResultsForQty();
    const radio = document.querySelector(`#capture-search-results input[name="capture-result"][value="${idx}"]`);
    if (radio) radio.checked = true;
    return item;
  }

  async function runCaptureSearch(query) {
    const box = $('#capture-search-results');
    if (!box) return;
    const q = (query || '').trim();
    if (q.length < 2) {
      box.className = 'capture-results-list muted';
      box.textContent = 'Tape au moins 2 caractères.';
      return;
    }
    const token = ++state.token;
    box.className = 'capture-results-list muted';
    box.textContent = 'Recherche…';

    const qty = clampNumber($('#capture-search-qty')?.value, 100);
    const found = [];
    const seen = new Set();
    function add(item, source) {
      if (!item) return;
      const normalized = normalizeFoodItem(item, qty, source);
      const key = normalizeText(normalized.nom) + '|' + (normalized.brand || normalized.source || '');
      if (!normalized.nom || seen.has(key)) return;
      seen.add(key);
      found.push(normalized);
    }

    const sf = getSourceFilters();
    try {
      if (sf.base !== false) getLocalFoods().forEach(item => add(item, item.source || 'base'));
      const localFiltered = found.filter(item => normalizeText(item.nom).includes(normalizeText(q))).slice(0, 8);
      let recipeMatches = [];
      let external = [];
      // Ordre voulu : Recettes → Base → CIQUAL → OpenFoodFacts.
      // Les recettes sont des aliments composés maison : elles doivent sortir dans la même recherche, avec leur filtre dédié.
      if (sf.recipe !== false) recipeMatches = await searchEndpoint('/api/recipes/search?q=' + encodeURIComponent(q) + '&limit=8', 'recipe');
      if (sf.ciq !== false) external = external.concat(await searchEndpoint('/api/ciqual/search?q=' + encodeURIComponent(q), 'CIQUAL'));
      if (sf.off !== false) external = external.concat(await searchEndpoint('/api/off/search?q=' + encodeURIComponent(q), 'OpenFoodFacts'));
      if (token !== state.token) return;
      const merged = [];
      const mergedSeen = new Set();
      recipeMatches.concat(localFiltered, external).forEach(item => {
        const n = normalizeFoodItem(item, qty, item.source || item._source || 'base');
        const key = normalizeText(n.nom) + '|' + (n.brand || n.source || '');
        if (!n.nom || mergedSeen.has(key)) return;
        mergedSeen.add(key);
        merged.push(n);
      });

      if (!merged.length) {
        const free = { nom: q, qty, kcal: 0, prot: 0, gluc: 0, lip: 0, source: 'création manuelle', note: 'À compléter ou analyser par IA' };
        state.results = [free];
        box.innerHTML = `<button class="capture-result-card selected" data-action="confirm-selected"><div class="capture-result-main"><strong>+ Créer “${escapeHtml(q)}”</strong><small>Valeurs à 0 : utilise ensuite IA/Groq ou édition.</small></div></button>`;
        return;
      }
      state.results = merged;
      state.selectedIndex = 0;
      box.className = 'capture-results-list';
      box.innerHTML = merged.map((item, idx) => resultCard(item, idx)).join('') + `<div class="capture-help">Sélectionne un résultat puis valide.</div>`;
      const footer = document.getElementById('capture-footer');
      if (footer && state.current === STATES.SEARCH_FOOD) {
        footer.innerHTML = `<button class="btn-primary" data-action="confirm-selected">✓ Ajouter au journal</button><button data-action="close">Annuler</button>`;
      }
    } catch (e) {
      box.className = 'capture-results-list muted';
      box.textContent = 'Recherche partielle : ' + (e.message || e);
    }
  }

  function getLocalFoods() {
    const list = [];
    try {
      if (typeof window.getBDD === 'function') list.push(...(window.getBDD() || []));
    } catch (e) {}
    try {
      if (Array.isArray(window.ALIMENTS_BASE)) list.push(...window.ALIMENTS_BASE);
    } catch (e) {}
    try {
      if (Array.isArray(window.allAliments)) list.push(...window.allAliments);
    } catch (e) {}
    return list;
  }

  async function searchEndpoint(url, source) {
    try {
      const res = await fetch(url, { headers: apiUserHeaders({ 'Accept': 'application/json' }) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.products || data.items || []).map(x => ({ ...x, _source: source, source: source }));
    } catch (e) {
      return [];
    }
  }

  function normalizeFoodItem(item, qty, source) {
    const itemSource = source || item.source || item._source || 'base';
    const isRecipe = String(itemSource || '').toLowerCase().includes('recipe') || String(itemSource || '').toLowerCase().includes('recette');
    const kcal100 = firstNumber(item.kcal100, item.kcalPer100, item['energy-kcal_100g'], item.energy_kcal_100g);
    const prot100 = firstNumber(item.prot100, item.protPer100, item.proteins_100g, item.proteines_100g);
    const gluc100 = firstNumber(item.gluc100, item.glucPer100, item.carbohydrates_100g, item.glucides_100g);
    const lip100 = firstNumber(item.lip100, item.lipPer100, item.fat_100g, item.lipides_100g);
    const defaultQty = isRecipe ? firstNumber(item.qty, item.defaut, item.unit_weight, item.poidsUnite, 100) : firstNumber(qty, item.qty, item.defaut, 100);
    const q = clampNumber(qty || defaultQty, defaultQty || 100);
    return {
      nom: item.nom || item.name || item.product_name || item.productName || 'Aliment',
      brand: isRecipe ? (item.meta || item.description || item.notes || '') : (item.marque || item.brands || item.brand || ''),
      source: itemSource,
      recipeId: item.recipe_id || item.recipeId || null,
      bddId: item.id || (item.recipe_id ? 'recipe_' + item.recipe_id : null),
      qty: q,
      unite: isRecipe ? 'g' : (item.unite || item.unit || 'g'),
      kcal100, prot100, gluc100, lip100,
      kcal: kcal100 * q / 100,
      prot: prot100 * q / 100,
      gluc: gluc100 * q / 100,
      lip: lip100 * q / 100
    };
  }

  function firstNumber(...values) {
    for (const value of values) {
      const n = clampNumber(value, NaN);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  function macrosForQty(item, qty) {
    const q = clampNumber(qty, 100);
    if (Number(item.kcal100 || item.prot100 || item.gluc100 || item.lip100)) {
      return {
        kcal: clampNumber(item.kcal100) * q / 100,
        prot: clampNumber(item.prot100) * q / 100,
        gluc: clampNumber(item.gluc100) * q / 100,
        lip: clampNumber(item.lip100) * q / 100
      };
    }
    return {
      kcal: clampNumber(item.kcal),
      prot: clampNumber(item.prot),
      gluc: clampNumber(item.gluc),
      lip: clampNumber(item.lip)
    };
  }

  async function startPhotoCamera() {
    const box = $('#capture-photo-camera-box');
    const actions = $('#capture-photo-camera-actions');
    const video = $('#capture-photo-video');
    if (!video) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      renderStatus('Caméra indisponible dans ce navigateur. Vérifie les permissions caméra.');
      return;
    }
    try {
      stopMedia();
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = state.stream;
      state.video = video;
      if (box) box.hidden = false;
      if (actions) actions.hidden = false;
      await video.play();
      renderStatus('Caméra active : cadre l’image puis touche “Utiliser cette photo”.');
    } catch (e) {
      renderStatus('Caméra indisponible : ' + (e.message || e) + '. Vérifie les permissions caméra.');
    }
  }

  function stopPhotoCameraOnly() {
    stopMedia();
    const box = $('#capture-photo-camera-box');
    const actions = $('#capture-photo-camera-actions');
    if (box) box.hidden = true;
    if (actions) actions.hidden = true;
    renderStatus();
  }

  function capturePhotoFrame() {
    const video = $('#capture-photo-video') || state.video;
    if (!video || !video.videoWidth || !video.videoHeight) {
      renderStatus('La caméra n’est pas encore prête. Attends une seconde puis réessaie.');
      return;
    }
    const canvas = $('#capture-photo-canvas') || document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    state.imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const preview = $('#capture-image-preview');
    if (preview) {
      preview.hidden = false;
      preview.removeAttribute('aria-hidden');
      preview.innerHTML = `<img src="${state.imageDataUrl}" alt="Photo capturée">`;
    }
    stopPhotoCameraOnly();
    renderStatus('Photo capturée. Tu peux continuer.');
  }

  async function startBarcodeCamera() {
    const video = $('#capture-barcode-video');
    if (!video) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      renderStatus('Caméra indisponible : utilise la saisie manuelle du code-barres.');
      return;
    }
    if (!('BarcodeDetector' in window)) {
      renderStatus('BarcodeDetector non disponible dans ce navigateur : utilise la saisie manuelle.');
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = state.stream;
      state.video = video;
      await video.play();
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      state.scanTimer = setInterval(async () => {
        try {
          const codes = await detector.detect(video);
          if (codes && codes[0] && codes[0].rawValue) {
            const code = String(codes[0].rawValue).trim();
            stopMedia();
            await lookupBarcode(code);
          }
        } catch (e) {
          renderStatus('Lecture code-barres impossible : ' + (e.message || e));
        }
      }, 450);
    } catch (e) {
      renderStatus('Caméra indisponible : ' + (e.message || e) + '. Tu peux saisir le code manuellement.');
    }
  }

  async function lookupManualBarcode() {
    const code = ($('#capture-barcode-manual')?.value || '').trim();
    if (!code) throw new Error('Code-barres vide.');
    await lookupBarcode(code);
  }

  async function lookupBarcode(code) {
    setBusy(true, 'Recherche OpenFoodFacts du code ' + code + '…');
    try {
      const qty = clampNumber($('#capture-barcode-qty')?.value, 100);
      let item = null;
      let localError = '';

      try {
        const localRes = await fetch('/api/off/barcode/' + encodeURIComponent(code), { headers: { 'Accept': 'application/json' } });
        if (localRes.ok) {
          const localData = await localRes.json();
          if (localData && localData.found && localData.product) {
            item = normalizeFoodItem({ ...localData.product, source: 'OpenFoodFacts local' }, qty, 'OpenFoodFacts local');
          } else if (localData && localData.error) {
            localError = localData.error;
          }
        } else {
          localError = 'Base locale indisponible (' + localRes.status + ')';
        }
      } catch (e) {
        localError = e.message || String(e);
      }

      if (!item) {
        const url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=product_name,brands,nutriments,quantity,serving_size';
        const res = await fetch(url, { headers: apiUserHeaders({ 'Accept': 'application/json' }) });
        if (!res.ok) throw new Error('OpenFoodFacts indisponible (' + res.status + ').' + (localError ? ' Local : ' + localError : ''));
        const data = await res.json();
        if (!data || data.status !== 1 || !data.product) throw new Error('Code-barres introuvable dans OpenFoodFacts.' + (localError ? ' Local : ' + localError : ''));
        const p = data.product;
        const n = p.nutriments || {};
        const kcal100 = firstNumber(n['energy-kcal_100g'], n.energy_kcal_100g, n['energy-kcal'], n.energy_kcal, n.energy_100g ? n.energy_100g / 4.184 : 0);
        item = normalizeFoodItem({
          nom: p.product_name || 'Produit sans nom',
          marque: p.brands || '',
          kcal100,
          prot100: firstNumber(n.proteins_100g, n.proteins),
          gluc100: firstNumber(n.carbohydrates_100g, n.carbohydrates),
          lip100: firstNumber(n.fat_100g, n.fat),
          source: 'OpenFoodFacts'
        }, qty, 'OpenFoodFacts');
      }

      state.results = [item];
      state.selectedIndex = 0;
      setBusy(false);
      transition(STATES.BARCODE_RESULT, { results: state.results });
    } catch (e) {
      setBusy(false);
      fail(e.message || String(e));
    }
  }


  async function loadSelectedImage(file) {
    const preview = $('#capture-image-preview');
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      fail('Le fichier sélectionné n’est pas une image.');
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Lecture image impossible.'));
      reader.readAsDataURL(file);
    });
    state.imageDataUrl = dataUrl;
    stopPhotoCameraOnly();
    if (preview) {
      preview.hidden = false;
      preview.removeAttribute('aria-hidden');
      preview.innerHTML = `<img src="${dataUrl}" alt="Photo capturée">`;
    }
    renderStatus('Photo capturée. Tu peux continuer.');
  }

  function normalizeNutritionOcrLine(line) {
    return cleanOcrLine(line)
      .replace(/\u00a0/g, ' ')
      .replace(/[’`´]/g, "'")
      .replace(/[|¦]/g, ' ')
      .replace(/[•·]/g, ' ')
      .replace(/([0-9])\s*[oO]\s*([0-9])/g, '$1 0 $2')
      .replace(/([0-9])\s*[lI]\s*([0-9])/g, '$1 1 $2')
      .replace(/\b[oO](?=\s*(?:g|kcal|kj|,|\.))/g, '0')
      .replace(/k\s*[cç]?[a4][l1iI]/gi, 'kcal')
      .replace(/kcai|kcaI|kca1/gi, 'kcal')
      .replace(/k\s*j/gi, 'kJ')
      .replace(/[ée]ner[gjq]ie/gi, 'énergie')
      .replace(/protei?nes?|prot[eé]lnes?|prot[eé]ines?/gi, 'protéines')
      .replace(/proteins?/gi, 'protein')
      .replace(/gluc[li1]des?|gIucides?/gi, 'glucides')
      .replace(/carbohydrat(?:es)?/gi, 'carbohydrates')
      .replace(/mati[eèé]res?\s+grasses?/gi, 'matières grasses')
      .replace(/matieres?\s+grasses?/gi, 'matières grasses')
      .replace(/lip[li1]des?/gi, 'lipides')
      .replace(/\bfa[tl]\b/gi, 'fat')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function normalizeNutritionOcrText(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(normalizeNutritionOcrLine)
      .filter(l => l.length > 1);
  }

  function repairOcrNumberText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/([0-9])\s*,\s*([0-9])/g, '$1,$2')
      .replace(/([0-9])\s*\.\s*([0-9])/g, '$1.$2')
      .replace(/\b([0-9])\s+[oO]\s*([0-9])\b/g, (_, a, b) => a + '0' + b)
      .replace(/\b([0-9])\s+[lI]\s*([0-9])\b/g, (_, a, b) => a + '1' + b)
      .replace(/\b([oO])(?=\d)/g, '0')
      .replace(/(?<=\d)[oO]\b/g, '0');
  }

  function ocrLineKey(line) {
    return normalizeText(line)
      .replace(/k\s*cal/g, 'kcal')
      .replace(/kj/g, 'kj')
      .replace(/proteines/g, 'proteine')
      .replace(/matieres grasses/g, 'matiere grasse');
  }

  function numericMatches(line) {
    const out = [];
    const re = /\d+(?:[.,]\d+)?/g;
    let m;
    while ((m = re.exec(line))) {
      const raw = m[0];
      const value = parseFloat(raw.replace(',', '.'));
      if (Number.isFinite(value)) out.push({ value, raw, index: m.index });
    }
    return out;
  }

  function removeServingReferences(line) {
    return String(line || '')
      .replace(/(?:pour|par|per)\s*100\s*g/gi, ' ')
      .replace(/100\s*g\s*(?:contient|contains|valeurs?|nutritionnelles?)?/gi, ' ')
      .replace(/\bRI\b|\bAR\b|%/gi, ' ');
  }

  function extractEnergyValue(line) {
    const src = normalizeNutritionOcrLine(line);
    // Toujours prioriser kcal avant les grammes : sinon "pour 100 g ... 220 kcal"
    // pouvait donner 100 au lieu de 220.
    const kcalMatches = [...src.matchAll(/(\d+(?:[.,]\d+)?)\s*kcal\b/gi)];
    if (kcalMatches.length) {
      const values = kcalMatches.map(m => parseFloat(m[1].replace(',', '.'))).filter(Number.isFinite);
      const plausible = values.find(v => v > 5 && v < 950);
      if (plausible != null) return plausible;
      if (values.length) return values[0];
    }
    const noKj = src.replace(/\d+(?:[.,]\d+)?\s*kJ\b/gi, ' ');
    const nums = numericMatches(removeServingReferences(noKj))
      .map(n => n.value)
      .filter(v => v !== 100 && v > 5 && v < 950);
    if (nums.length) return nums[nums.length - 1];
    const kj = src.match(/(\d+(?:[.,]\d+)?)\s*kJ\b/i);
    if (kj) {
      const kjVal = parseFloat(kj[1].replace(',', '.'));
      if (Number.isFinite(kjVal) && kjVal > 20) return Math.round(kjVal / 4.184);
    }
    return 0;
  }

  function extractMacroValue(line, keywordIndex = 0) {
    let src = normalizeNutritionOcrLine(line);
    src = removeServingReferences(src);
    // On préfère les valeurs suivies de g, mais on ignore les références 100 g.
    const gramMatches = [...src.matchAll(/(\d+(?:[.,]\d+)?)\s*g\b/gi)]
      .map(m => ({ value: parseFloat(m[1].replace(',', '.')), index: m.index }))
      .filter(x => Number.isFinite(x.value) && x.value <= 100 && x.value !== 100);
    if (gramMatches.length) {
      const afterKeyword = gramMatches.filter(x => x.index >= keywordIndex);
      return (afterKeyword[0] || gramMatches[0]).value;
    }
    const nums = numericMatches(src)
      .filter(x => x.value <= 100 && x.value !== 100 && x.index >= Math.max(0, keywordIndex - 2));
    if (nums.length) return nums[0].value;
    return 0;
  }

  function findNutritionLine(lines, patterns, rejectPatterns = []) {
    for (const line of lines) {
      const key = ocrLineKey(line);
      if (rejectPatterns.some(p => p.test(key))) continue;
      if (patterns.some(p => p.test(key))) return line;
    }
    return '';
  }

  function parseNutritionTableOcr(text) {
    const lines = normalizeNutritionOcrText(text);
    if (!lines.length) return [];

    const rejectDont = [/^dont\b/, /^of which\b/, /^waarvan\b/, /satures?$/, /sucres?$/];
    const energyLine = findNutritionLine(lines, [/kcal\b/, /\benergie\b/, /\benergy\b/, /calories?/]);
    const protLine = findNutritionLine(lines, [/prot[eé]?ine/, /protein/], rejectDont);
    const glucLine = findNutritionLine(lines, [/glucide/, /carbohyd/, /hydrates? de carbone/], rejectDont);
    const lipLine  = findNutritionLine(lines, [/lipide/, /matiere grasse/, /\bfat\b/, /graisse/], rejectDont);

    const kcal = energyLine ? extractEnergyValue(energyLine) : 0;
    const prot = protLine ? extractMacroValue(protLine, Math.max(0, ocrLineKey(protLine).search(/prot|protein/))) : 0;
    const gluc = glucLine ? extractMacroValue(glucLine, Math.max(0, ocrLineKey(glucLine).search(/gluc|carbo|hydrate/))) : 0;
    const lip  = lipLine  ? extractMacroValue(lipLine,  Math.max(0, ocrLineKey(lipLine).search(/lip|matiere|fat|graisse/))) : 0;

    let qty = 100;
    for (const line of lines) {
      const m = line.match(/(?:pour|par|per)\s*(\d+)\s*g/i) || line.match(/portion[^\d]*(\d+)\s*g/i);
      if (m) { qty = parseInt(m[1], 10) || 100; break; }
    }

    let nom = 'Produit scanné';
    for (const line of lines) {
      const key = ocrLineKey(line);
      if (line.length < 3 || line.length > 80) continue;
      if (/^[\d.,\s%gkJkcal]+$/i.test(line)) continue;
      if (/kcal|energie|energy|calorie|proteine|protein|glucide|carbo|lipide|matiere grasse|graisse|fat|sucre|fibre|sel|sodium|pour 100|par 100|per 100|valeurs?|nutrition/i.test(key)) continue;
      nom = line.slice(0, 60).trim();
      break;
    }

    const hasAny = [kcal, prot, gluc, lip].some(v => Number(v) > 0);
    if (!hasAny) return [];

    return [{
      nom,
      qty,
      kcal: Math.round(kcal || 0),
      prot: parseFloat((prot || 0).toFixed(1)),
      gluc: parseFloat((gluc || 0).toFixed(1)),
      lip: parseFloat((lip || 0).toFixed(1)),
      source: 'OCR',
      unite: 'g'
    }];
  }



  function isUsableNutritionTableResult(item) {
    if (!item) return false;
    const kcal = Number(item.kcal || 0);
    const macros = [item.prot, item.gluc, item.lip].filter(v => Number(v) > 0).length;
    return kcal > 0 && macros >= 2;
  }

  function scoreNutritionTableOcrText(text) {
    const repaired = repairOcrNumberText(text);
    const lines = normalizeNutritionOcrText(repaired);
    const parsed = parseNutritionTableOcr(repaired)[0] || null;
    let score = 0;
    const flags = [];
    const joined = ocrLineKey(lines.join(' '));
    if (lines.length >= 4) { score += 10; flags.push('lignes'); }
    if (/pour\s*100\s*g|par\s*100\s*g|per\s*100\s*g|100\s*g/.test(joined)) { score += 8; flags.push('100g'); }
    if (lines.some(l => /kcal|energie|energy|calorie/i.test(l))) { score += 18; flags.push('énergie'); }
    if (lines.some(l => /prot[eé]?ine|protein/i.test(l))) { score += 14; flags.push('protéines'); }
    if (lines.some(l => /glucide|carbo|hydrate/i.test(l))) { score += 14; flags.push('glucides'); }
    if (lines.some(l => /lipide|mati[eèé]re grasse|graisse|fat/i.test(l))) { score += 14; flags.push('lipides'); }
    if (parsed) {
      if (Number(parsed.kcal) > 0) score += 14;
      const macroValues = [parsed.prot, parsed.gluc, parsed.lip].map(v => Number(v || 0));
      const macroCount = macroValues.filter(v => v > 0).length;
      score += macroCount * 6;
      if (macroValues.some(v => v > 100)) score -= 18;
      if (Number(parsed.kcal) > 900) score -= 12;
      const macroKcal = Number(parsed.prot || 0) * 4 + Number(parsed.gluc || 0) * 4 + Number(parsed.lip || 0) * 9;
      if (Number(parsed.kcal) > 0 && macroKcal > 0) {
        const delta = Math.abs(Number(parsed.kcal) - macroKcal) / Math.max(Number(parsed.kcal), macroKcal, 1);
        if (delta < 0.35) { score += 12; flags.push('cohérence'); }
        else if (delta < 0.6) score += 4;
        else { score -= 10; flags.push('incohérence'); }
      }
    }
    const digitCount = (repaired.match(/\d/g) || []).length;
    if (digitCount >= 8) score += 4;
    if (!String(repaired || '').trim()) score = 0;
    return { score: Math.max(0, Math.min(100, Math.round(score))), details: flags.join(', ') };
  }

  function scoreRecipeOcrText(text) {
    const grid = reconstructRecipeGridOcr(text);
    const cleaned = cleanRecipeOcr(repairOcrNumberText(text));
    const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let score = Math.min(28, lines.length * 7);
    const joined = cleaned.toLowerCase();
    const numberCount = (joined.match(/\d+(?:[.,]\d+)?/g) || []).length;
    const unitCount = (joined.match(/\b(?:g|kg|ml|cl|l|cuill[eè]res?|c[àa]s|c[àa]c|sachets?|oeufs?|œufs?|poign[ée]es?|pinc[ée]es?|tranches?|bo[iî]tes?)\b/g) || []).length;
    const foodWords = (joined.match(/farine|sucre|huile|beurre|oeuf|œuf|riz|p[aâ]tes?|semoule|tomate|poulet|viande|lait|cr[eè]me|fromage|l[eé]gume|pomme|banane|thon|saumon|chocolat|avoine|yaourt|skyr|lentilles?|haricots?|courgettes?|carottes?|oignons?|ail|citron|sel|p[ée]pites?/g) || []).length;
    const pairedLines = countRecipePairedLines(cleaned);
    score += Math.min(22, numberCount * 5);
    score += Math.min(22, unitCount * 7);
    score += Math.min(18, foodWords * 3);
    score += Math.min(28, pairedLines * 9);
    if (grid) score += 18;
    if (cleaned.length > 40) score += 6;
    if (cleaned.length > 120) score += 4;
    if (/pr[ée]paration|ingr[ée]dients?|recette/i.test(text)) score += 4;
    if (pairedLines < 2 && numberCount >= 3) score -= 18;
    if (/["#~_|]{2,}|[A-Z]{1}\s+["']\s+[a-z]/.test(text)) score -= 8;
    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      details: grid ? `${pairedLines} paires, grille reconstruite` : `${lines.length} lignes, ${pairedLines} paires, ${unitCount} unités`
    };
  }

  function ocrQualityLabel(score, profile) {
    const n = Number(score || 0);
    if (profile === 'nutrition_table') {
      if (n >= 86) return 'bonne';
      if (n >= 58) return 'moyenne';
      return 'faible, à vérifier';
    }
    if (n >= 78) return 'bonne';
    if (n >= 48) return 'moyenne';
    return 'faible, à vérifier';
  }

  function normalizeCropRect(rect) {
    const source = rect || {};
    let x = Number(source.x), y = Number(source.y), w = Number(source.w), h = Number(source.h);
    if (!Number.isFinite(x)) x = 8;
    if (!Number.isFinite(y)) y = 10;
    if (!Number.isFinite(w)) w = 84;
    if (!Number.isFinite(h)) h = 68;
    const minW = 14, minH = 12;
    w = Math.max(minW, Math.min(96, w));
    h = Math.max(minH, Math.min(94, h));
    x = Math.max(1, Math.min(99 - w, x));
    y = Math.max(1, Math.min(99 - h, y));
    return { x: round1(x), y: round1(y), w: round1(w), h: round1(h) };
  }

  function setInlineCropRect(rect) {
    state.crop = normalizeCropRect(rect);
    syncInlineCropSelection();
  }

  function syncInlineCropSelection() {
    const sel = document.getElementById('capture-crop-selection');
    if (!sel) return;
    const c = normalizeCropRect(state.crop);
    sel.style.left = c.x + '%';
    sel.style.top = c.y + '%';
    sel.style.width = c.w + '%';
    sel.style.height = c.h + '%';
  }

  function handleInlineCropPointerDown(ev) {
    if (state.current !== STATES.CROP) return;
    const target = ev.target;
    if (!target || !target.closest) return;
    const stage = document.getElementById('capture-crop-stage');
    const selection = target.closest('#capture-crop-selection');
    const handle = target.closest('.capture-crop-handle');
    if (!stage || (!selection && !handle)) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    state.cropDrag = {
      mode: handle ? (handle.dataset.handle || 'move') : 'move',
      startX: ev.clientX,
      startY: ev.clientY,
      rect,
      start: normalizeCropRect(state.crop)
    };
    try { (selection || handle).setPointerCapture?.(ev.pointerId); } catch(e) {}
  }

  function handleInlineCropPointerMove(ev) {
    const drag = state.cropDrag;
    if (!drag || state.current !== STATES.CROP) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    const dx = ((ev.clientX - drag.startX) / Math.max(1, drag.rect.width)) * 100;
    const dy = ((ev.clientY - drag.startY) / Math.max(1, drag.rect.height)) * 100;
    const start = drag.start;
    let next = { ...start };
    if (drag.mode === 'move') {
      next.x = start.x + dx;
      next.y = start.y + dy;
    } else {
      if (drag.mode.includes('e')) next.w = start.w + dx;
      if (drag.mode.includes('s')) next.h = start.h + dy;
      if (drag.mode.includes('w')) { next.x = start.x + dx; next.w = start.w - dx; }
      if (drag.mode.includes('n')) { next.y = start.y + dy; next.h = start.h - dy; }
    }
    setInlineCropRect(next);
  }

  function handleInlineCropPointerUp(ev) {
    if (!state.cropDrag) return;
    ev.preventDefault();
    ev.stopPropagation();
    state.cropDrag = null;
  }

  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image recadrage illisible.'));
      img.src = dataUrl;
    });
  }

  async function cropCurrentImageDataUrl() {
    if (!state.imageDataUrl) throw new Error('Aucune photo capturée.');
    const img = await dataUrlToImage(state.imageDataUrl);
    const c = normalizeCropRect(state.crop);
    const sx = Math.max(0, Math.round(img.naturalWidth * c.x / 100));
    const sy = Math.max(0, Math.round(img.naturalHeight * c.y / 100));
    const sw = Math.max(1, Math.round(img.naturalWidth * c.w / 100));
    const sh = Math.max(1, Math.round(img.naturalHeight * c.h / 100));
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(1800, sw);
    canvas.height = Math.max(1, Math.round(sh * (canvas.width / sw)));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.94);
  }

  async function continueAfterInlineCrop() {
    if (state.mode !== MODES.NUTRITION_TABLE && state.mode !== MODES.RECIPE) return continueAfterPhoto();
    setBusy(true, state.mode === MODES.NUTRITION_TABLE ? 'OCR automatique du tableau recadré…' : 'OCR automatique de la recette recadrée…');
    try {
      const cropped = await cropCurrentImageDataUrl();
      state.imageDataUrl = cropped;
      state.ocrPassSummary = null;
      const ocr = state.mode === MODES.NUTRITION_TABLE
        ? await runNutritionTableOCR(cropped)
        : await runRecipeOCR(cropped);
      const rawText = typeof ocr === 'string' ? ocr : (ocr.text || '');
      state.ocrPassSummary = typeof ocr === 'object' ? ocr.summary : null;
      if (state.mode === MODES.NUTRITION_TABLE) {
        state.ocrRaw = rawText;
        const parsed = parseNutritionTableOcr(rawText);
        if (parsed.length && isUsableNutritionTableResult(parsed[0])) {
          state.results = parsed;
          state.selectedIndex = 0;
          setBusy(false);
          transition(STATES.CONFIRM_FOOD);
          return;
        }
        state.ocrText = rawText.trim();
        setBusy(false);
        transition(STATES.NUTRITION_TABLE_OCR);
        return;
      }
      state.ocrText = cleanRecipeOcr(rawText);
      setBusy(false);
      if (!state.ocrText) throw new Error('OCR vide : zone trop floue, mal cadrée ou texte non lisible.');
      transition(STATES.RECIPE_OCR);
    } catch (e) {
      setBusy(false);
      fail(e.message || String(e));
    }
  }

  // 0.22.137 : l'ancien recadrage visuel (#ocr-panel / food-add-modal) n'est plus utilisé
  // dans le workflow Capture. Le recadrage est maintenant intégré à STATES.CROP.

  async function continueAfterPhoto() {
    if (state.mode !== MODES.PHOTO_FOOD && !state.imageDataUrl) throw new Error('Aucune photo capturée.');
    if (state.mode === MODES.NUTRITION_TABLE || state.mode === MODES.RECIPE) {
      // 0.22.137 : recadrage intégré dans la même UI Capture.
      // On ne bascule plus vers l'ancien #ocr-panel / food-add-modal.
      transition(STATES.CROP);
      return;
    }
    if (state.mode === MODES.PHOTO_FOOD) {
      await runVisionMealAnalysis();
      return;
    }
    setBusy(true, 'OCR automatique en cours…');
    try {
      state.ocrPassSummary = null;
      const ocr = state.mode === MODES.NUTRITION_TABLE
        ? await runNutritionTableOCR(state.imageDataUrl)
        : await runRecipeOCR(state.imageDataUrl);
      const rawText = typeof ocr === 'string' ? ocr : (ocr.text || '');
      state.ocrPassSummary = typeof ocr === 'object' ? ocr.summary : null;
      if (state.mode === MODES.NUTRITION_TABLE) {
        state.ocrRaw = rawText; // garder pour diagnostic discret
        const parsed = parseNutritionTableOcr(rawText);
        if (!parsed.length || !isUsableNutritionTableResult(parsed[0])) {
          // Fallback : montrer le meilleur texte brut dans une textarea pour correction manuelle ou Groq.
          state.ocrText = rawText.trim();
          setBusy(false);
          transition(STATES.NUTRITION_TABLE_OCR);
          return;
        }
        state.results = parsed;
        state.selectedIndex = 0;
        setBusy(false);
        transition(STATES.CONFIRM_FOOD);
        return;
      } else if (state.mode === MODES.RECIPE) {
        state.ocrText = cleanRecipeOcr(rawText);
      } else {
        state.ocrText = rawText.trim();
      }
      setBusy(false);
      if (!state.ocrText) throw new Error('OCR vide : photo trop floue, mal cadrée ou texte non lisible.');
      transition(state.mode === MODES.RECIPE ? STATES.RECIPE_OCR : STATES.NUTRITION_TABLE_OCR);
    } catch (e) {
      setBusy(false);
      fail(e.message || String(e));
    }
  }

  function dataUrlApproxBytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.ceil(base64.length * 3 / 4);
  }

  function compressImageForVision(dataUrl, options = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = options.maxSide || 1536;
        const maxBytes = options.maxBytes || Math.floor(3.75 * 1024 * 1024);
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width || 1) * scale));
        canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height || 1) * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = options.quality || 0.82;
        let out = canvas.toDataURL('image/jpeg', quality);
        while (dataUrlApproxBytes(out) > maxBytes && quality > 0.48) {
          quality = Math.max(0.48, quality - 0.08);
          out = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error('Image illisible pour l’analyse vision.'));
      img.src = dataUrl;
    });
  }

  function rowFromVisionServerSuggestion(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const nom = pickObjectText(obj, ['nom', 'name', 'aliment', 'food', 'plat'], '').replace(/^[-*•]\s*/, '').trim();
    if (!nom || /quantit|kcal|prot/i.test(nom)) return null;
    const nutrition = obj.nutrition || obj.nutriments || obj.macros || obj.macro || {};
    const qty = Math.max(1, numberFromAny(obj.qty ?? obj.defaut ?? obj.quantity_g ?? obj.quantite ?? obj['quantité'] ?? nutrition.qty ?? nutrition.quantity_g, 100));
    let kcal = numberFromAny(obj.kcal ?? obj.calories ?? obj.energy_kcal ?? nutrition.kcal ?? nutrition.calories ?? nutrition.energy_kcal, 0);
    let prot = numberFromAny(obj.prot ?? obj.proteines ?? obj['protéines'] ?? obj.protein ?? obj.proteins ?? nutrition.prot ?? nutrition.proteines ?? nutrition['protéines'] ?? nutrition.protein ?? nutrition.proteins, 0);
    let gluc = numberFromAny(obj.gluc ?? obj.glucides ?? obj.carbs ?? obj.carbohydrates ?? nutrition.gluc ?? nutrition.glucides ?? nutrition.carbs ?? nutrition.carbohydrates, 0);
    let lip = numberFromAny(obj.lip ?? obj.lipides ?? obj.fat ?? obj.graisses ?? nutrition.lip ?? nutrition.lipides ?? nutrition.fat ?? nutrition.graisses, 0);
    const kcal100 = numberFromAny(obj.kcal100 ?? obj.kcal_100g ?? nutrition.kcal100 ?? nutrition.kcal_100g, 0);
    const prot100 = numberFromAny(obj.prot100 ?? obj.prot_100g ?? nutrition.prot100 ?? nutrition.prot_100g, 0);
    const gluc100 = numberFromAny(obj.gluc100 ?? obj.gluc_100g ?? nutrition.gluc100 ?? nutrition.gluc_100g, 0);
    const lip100 = numberFromAny(obj.lip100 ?? obj.lip_100g ?? nutrition.lip100 ?? nutrition.lip_100g, 0);
    if (!kcal && kcal100 > 0) kcal = kcal100 * qty / 100;
    if (!prot && prot100 > 0) prot = prot100 * qty / 100;
    if (!gluc && gluc100 > 0) gluc = gluc100 * qty / 100;
    if (!lip && lip100 > 0) lip = lip100 * qty / 100;
    const row = makeIaNutritionRow(nom, qty, kcal, prot, gluc, lip);
    if (kcal100 > 0) row.kcal100 = Math.round(kcal100);
    if (prot100 > 0) row.prot100 = round1(prot100);
    if (gluc100 > 0) row.gluc100 = round1(gluc100);
    if (lip100 > 0) row.lip100 = round1(lip100);
    return row;
  }

  function normalizeVisionMealSuggestions(payload) {
    const rawList = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.suggestions)
        ? payload.suggestions
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.aliments)
            ? payload.aliments
            : [];
    return rawList.map((obj, idx) => {
      const row = rowFromVisionServerSuggestion(obj) || rowFromNutritionObject(obj);
      if (!row) return null;
      row.source = 'Groq Vision';
      row.item_type = pickObjectText(obj, ['item_type', 'food_type', 'type', 'categorie', 'category'], 'aliment_simple');
      row.decomposition_recommended = !!(obj?.decomposition_recommended || obj?.decomposition || obj?.decomposer);
      row.saveToBase = obj?.save_to_base === false || row.item_type === 'incertain' ? false : true;
      row._selectedForAdd = true;
      row.confidence_food = pickObjectText(obj, ['confidence_food', 'confiance_aliment', 'confiance', 'food_confidence'], '');
      row.confidence_quantity = pickObjectText(obj, ['confidence_quantity', 'confiance_quantite', 'confiance_quantité', 'quantity_confidence'], '');
      row.notes = pickObjectText(obj, ['notes', 'note', 'commentaire', 'reason'], row.item_type === 'plat_compose' ? 'Plat composé : détail des ingrédients non estimé depuis la photo.' : '');
      row.nutrition_source = pickObjectText(obj, ['nutrition_source', 'source_nutrition'], '');
      row._visionIndex = idx;
      return row;
    }).filter(Boolean);
  }

  function assertVisionMealNutritionRows(rows, payload) {
    if (!Array.isArray(rows) || !rows.length) {
      const names = Array.isArray(payload?.missing_nutrition) ? payload.missing_nutrition.join(', ') : '';
      const suffix = names ? ' Aliments incomplets : ' + names + '.' : '';
      throw new Error((payload?.error || 'Groq Vision n’a pas renvoyé de calories/macros exploitables.') + suffix);
    }
    const bad = rows.filter(row => !(Number(row.kcal) > 0 && (Number(row.prot) > 0 || Number(row.gluc) > 0 || Number(row.lip) > 0)));
    if (bad.length) {
      throw new Error('Analyse photo incomplète : calories/macros absents pour ' + bad.map(x => x.nom || 'aliment').join(', ') + '.');
    }
  }

  async function runVisionMealAnalysis() {
    if (!state.imageDataUrl) throw new Error('Photo plat : prends ou choisis une photo avant analyse.');
    const note = ($('#capture-photo-desc')?.value || '').trim();
    state.aiText = note;
    setBusy(true, 'Groq Vision analyse la photo du plat…');
    try {
      const image = await compressImageForVision(state.imageDataUrl);
      const res = await fetch('/api/groq/vision-meal', {
        method: 'POST',
        headers: apiUserHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
        body: JSON.stringify({ image, note, meal: state.targetMeal || 'lunch' })
      });
      const data = await res.json().catch(() => ({}));
      let parsed = normalizeVisionMealSuggestions(data);
      // Si le serveur joint une table de normalisation nutritionnelle, elle sert de filet de sécurité
      // quand la réponse principale ne contient pas encore des kcal/macros exploitables.
      const parsedLooksComplete = Array.isArray(parsed) && parsed.length && parsed.every(row => Number(row.kcal) > 0 && (Number(row.prot) > 0 || Number(row.gluc) > 0 || Number(row.lip) > 0));
      if (!parsedLooksComplete && Array.isArray(data?.debug_nutrition) && data.debug_nutrition.length) {
        const parsedFromDebug = normalizeVisionMealSuggestions(data.debug_nutrition);
        if (parsedFromDebug.length) parsed = parsedFromDebug;
      }
      if (!res.ok || data.ok === false) throw new Error(data.error || data.message || ('Erreur Groq Vision ' + res.status));
      assertVisionMealNutritionRows(parsed, data);
      if (typeof window.fnIARecordGroqUsage === 'function') {
        window.fnIARecordGroqUsage({ feature: 'Photo plat', model: data.model || 'Groq Vision', usage: data.usage, usage_summary: data.usage_summary, image_bytes: data.image_bytes, rate_limits: data.rate_limits });
      }
      state.results = parsed;
      state.selectedIndex = 0;
      setBusy(false);
      transition(STATES.CONFIRM_FOOD, { results: parsed });
    } catch (e) {
      setBusy(false);
      fail(e.message || String(e));
    }
  }

  function rotateCanvasSource(ctx, img, width, height, rotation) {
    const angle = Number(rotation || 0) % 360;
    if (angle === 90) { ctx.translate(width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(img, 0, 0, height, width); return; }
    if (angle === 180) { ctx.translate(width, height); ctx.rotate(Math.PI); ctx.drawImage(img, 0, 0, width, height); return; }
    if (angle === 270 || angle === -90) { ctx.translate(0, height); ctx.rotate(-Math.PI / 2); ctx.drawImage(img, 0, 0, height, width); return; }
    ctx.drawImage(img, 0, 0, width, height);
  }

  function trimCanvasMargins(canvas, profile = 'default') {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || canvas.width < 80 || canvas.height < 80) return canvas;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1, ink = 0;
    const threshold = profile === 'nutrition_table' ? 232 : 224;
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const i = (y * canvas.width + x) * 4;
        const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        if (gray < threshold) {
          ink += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const sampled = Math.max(1, (canvas.width / 2) * (canvas.height / 2));
    const inkRatio = ink / sampled;
    if (maxX < minX || maxY < minY || inkRatio < 0.002 || inkRatio > 0.72) return canvas;
    const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.035);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(canvas.width - 1, maxX + pad); maxY = Math.min(canvas.height - 1, maxY + pad);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (w < canvas.width * 0.38 || h < canvas.height * 0.20 || (w > canvas.width * 0.94 && h > canvas.height * 0.94)) return canvas;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const octx = out.getContext('2d');
    octx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    return out;
  }

  function adaptiveThreshold(d, w, h) {
    const n = w * h;
    const gray = new Float32Array(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const integ = new Float64Array(n);
    for (let y = 0; y < h; y++) {
      let rs = 0;
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        rs += gray[idx];
        integ[idx] = (y > 0 ? integ[idx - w] : 0) + rs;
      }
    }
    const half = Math.max(6, Math.floor(w / 24));
    const t = 0.15;
    for (let y = 0; y < h; y++) {
      const y1 = y - half < 0 ? 0 : y - half;
      const y2 = y + half >= h ? h - 1 : y + half;
      for (let x = 0; x < w; x++) {
        const x1 = x - half < 0 ? 0 : x - half;
        const x2 = x + half >= w ? w - 1 : x + half;
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const A = (x1 > 0 && y1 > 0) ? integ[(y1 - 1) * w + (x1 - 1)] : 0;
        const B = (y1 > 0) ? integ[(y1 - 1) * w + x2] : 0;
        const C = (x1 > 0) ? integ[y2 * w + (x1 - 1)] : 0;
        const D = integ[y2 * w + x2];
        const sum = D - B - C + A;
        const idx = y * w + x;
        const val = (gray[idx] * count <= sum * (1 - t)) ? 0 : 255;
        const di = idx * 4;
        d[di] = d[di + 1] = d[di + 2] = val; d[di + 3] = 255;
      }
    }
  }

  function preprocessImageForOcr(dataUrl, profile = 'default', variant = 'soft', rotation = 0) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const rotated = Math.abs(Number(rotation || 0)) % 180 === 90;
        const maxSide = profile === 'nutrition_table' ? 2600 : 2200;
        const sourceMax = Math.max(img.width, img.height, 1);
        const baseScale = Math.min(3.8, maxSide / sourceMax);
        const scaleBoost = variant === 'enlarge' || variant === 'bw_strong' ? 1.22 : 1;
        const scale = Math.max(1, baseScale * scaleBoost);
        const sourceW = Math.max(1, Math.round(img.width * scale));
        const sourceH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width  = rotated ? sourceH : sourceW;
        canvas.height = rotated ? sourceW : sourceH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        rotateCanvasSource(ctx, img, canvas.width, canvas.height, Number(rotation || 0));
        if (variant === 'original') {
          resolve(trimCanvasMargins(canvas, profile).toDataURL('image/png'));
          return;
        }
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        if (variant === 'adaptive') {
          adaptiveThreshold(d, canvas.width, canvas.height);
          ctx.putImageData(imageData, 0, 0);
          resolve(trimCanvasMargins(canvas, profile).toDataURL('image/png'));
          return;
        }
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        const avg = sum / Math.max(1, d.length / 4);
        const contrast = variant === 'bw_strong' ? 2.05 : variant === 'gray_strong' ? 1.85 : variant === 'enlarge' ? 1.62 : profile === 'nutrition_table' ? 1.50 : 1.68;
        const threshold = variant === 'bw_strong' ? Math.max(92, Math.min(176, avg * 0.98)) : variant === 'bw' ? Math.max(96, Math.min(168, avg)) : 128;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          let val;
          if (variant === 'bw' || variant === 'bw_strong') val = gray > threshold ? 255 : 0;
          else val = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
          d[i] = d[i+1] = d[i+2] = val;
          d[i+3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(trimCanvasMargins(canvas, profile).toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function ocrPassesForProfile(profile) {
    if (profile === 'nutrition_table') {
      return [
        { variant: 'soft', psm: '6', rotation: 0, label: 'contraste doux tableau' },
        { variant: 'adaptive', psm: '6', rotation: 0, label: 'seuillage adaptatif tableau' },
        { variant: 'gray_strong', psm: '6', rotation: 0, label: 'contraste fort tableau' },
        { variant: 'enlarge', psm: '6', rotation: 0, label: 'agrandi tableau' },
        { variant: 'original', psm: '6', rotation: 0, label: 'image originale tableau' }
      ];
    }
    return [
      { variant: 'soft', psm: '6', rotation: 0, label: 'contraste doux recette' },
      { variant: 'adaptive', psm: '6', rotation: 0, label: 'seuillage adaptatif recette' },
      { variant: 'gray_strong', psm: '6', rotation: 0, label: 'contraste fort recette' },
      { variant: 'enlarge', psm: '6', rotation: 0, label: 'agrandi recette' },
      { variant: 'original', psm: '11', rotation: 0, label: 'texte épars recette' }
    ];
  }

  function ocrRotationFallbackPasses(profile) {
    if (profile === 'nutrition_table') {
      return [
        { variant: 'gray_strong', psm: '6', rotation: 90, label: 'rotation 90° tableau' },
        { variant: 'gray_strong', psm: '6', rotation: 270, label: 'rotation 270° tableau' },
        { variant: 'gray_strong', psm: '6', rotation: 180, label: 'rotation 180° tableau' }
      ];
    }
    return [
      { variant: 'gray_strong', psm: '6', rotation: 90, label: 'rotation 90° recette' },
      { variant: 'gray_strong', psm: '6', rotation: 270, label: 'rotation 270° recette' },
      { variant: 'original', psm: '11', rotation: 180, label: 'rotation 180° recette' }
    ];
  }

  let _ocrWorker = null, _ocrWorkerPromise = null, _ocrPassLabel = '';
  function getOcrWorker() {
    if (_ocrWorkerPromise) return _ocrWorkerPromise;
    _ocrWorkerPromise = (async () => {
      await ensureTesseract();
      if (!window.Tesseract || !window.Tesseract.createWorker) throw new Error('worker-unavailable');
      const worker = await window.Tesseract.createWorker('fra+eng', 1, {
        logger: m => {
          if (m && m.status) {
            const label = _ocrPassLabel ? ' · ' + _ocrPassLabel : '';
            renderStatus('OCR' + label + ' : ' + m.status + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''));
          }
        }
      });
      _ocrWorker = worker;
      return worker;
    })().catch(e => { _ocrWorkerPromise = null; throw e; });
    return _ocrWorkerPromise;
  }

  async function recognizeOcrPass(dataUrl, options = {}, pass = {}) {
    await ensureTesseract();
    if (!window.Tesseract) throw new Error('OCR indisponible : Tesseract.js non chargé.');
    const profile = options.profile || 'default';
    const processed = await preprocessImageForOcr(dataUrl, profile, pass.variant || 'soft', pass.rotation || 0);
    const psm = pass.psm || options.psm || (profile === 'nutrition_table' ? '6' : '3');
    // Worker Tesseract persistant (réutilisé entre passes ET scans) -> beaucoup plus rapide.
    // Repli automatique sur l'API simple si le worker est indisponible.
    try {
      const worker = await getOcrWorker();
      _ocrPassLabel = pass.label || '';
      await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
      const result = await worker.recognize(processed);
      return (result && result.data && result.data.text) || '';
    } catch (e) {
      const result = await window.Tesseract.recognize(processed, 'fra+eng', {
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: '1',
        logger: m => {
          if (m && m.status) {
            const label = pass.label ? ' · ' + pass.label : '';
            renderStatus('OCR' + label + ' : ' + m.status + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''));
          }
        }
      });
      return (result && result.data && result.data.text) || '';
    }
  }

  async function runOcrPasses(dataUrl, options = {}) {
    const profile = options.profile || 'default';
    const passes = options.passes || ocrPassesForProfile(profile);
    const scorer = typeof options.scorer === 'function' ? options.scorer : scoreRecipeOcrText;
    const stopScore = Number(options.stopScore || 90);
    let best = { text: '', score: -1, label: '', pass: null };
    const attempts = [];

    async function runPassList(passList, offset = 0) {
      for (let i = 0; i < passList.length; i += 1) {
        const pass = passList[i];
        const text = await recognizeOcrPass(dataUrl, options, pass);
        const scoreInfo = scorer(text);
        const score = Number(scoreInfo.score || 0);
        const label = pass.label || pass.variant || ('passe ' + (offset + i + 1));
        attempts.push({ label, score, details: scoreInfo.details || '' });
        if (score > best.score || (score === best.score && String(text || '').length > String(best.text || '').length)) {
          best = { text, score, label, pass };
        }
        if (score >= stopScore) return true;
      }
      return false;
    }

    const stopped = await runPassList(passes, 0);
    const rotationThreshold = Number(options.rotationThreshold || (profile === 'nutrition_table' ? 62 : 54));
    if (!stopped && best.score < rotationThreshold && options.autoRotate !== false) {
      await runPassList(ocrRotationFallbackPasses(profile), passes.length);
    }

    return {
      text: best.text || '',
      summary: {
        score: Math.max(0, best.score),
        quality: ocrQualityLabel(best.score, profile),
        bestLabel: best.label,
        attempts
      }
    };
  }

  async function runOCR(dataUrl, options = {}) {
    if (options.multiPass === false) {
      return recognizeOcrPass(dataUrl, options, { variant: 'soft', psm: options.psm, label: 'passe unique' });
    }
    const result = await runOcrPasses(dataUrl, {
      ...options,
      profile: options.profile || 'default',
      scorer: options.scorer || scoreRecipeOcrText,
      stopScore: options.stopScore || 86
    });
    return result.text || '';
  }

  async function runRecipeOCR(dataUrl) {
    return runOcrPasses(dataUrl, {
      profile: 'recipe',
      scorer: scoreRecipeOcrText,
      stopScore: 82
    });
  }

  async function runNutritionTableOCR(dataUrl) {
    // OCR automatique : plusieurs prétraitements sont testés sans changer le parcours utilisateur.
    // Le meilleur texte est choisi par score nutritionnel, puis le workflow existant reprend.
    const result = await runOcrPasses(dataUrl, {
      profile: 'nutrition_table',
      scorer: scoreNutritionTableOcrText,
      stopScore: 92
    });
    const repaired = repairOcrNumberText(result.text);
    return {
      text: normalizeNutritionOcrText(repaired).join('\n'),
      summary: result.summary
    };
  }

  function ensureTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-foodnote-tesseract]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Chargement OCR impossible.')), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.async = true;
      s.setAttribute('data-foodnote-tesseract', '1');
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('OCR indisponible : impossible de charger Tesseract.js.'));
      document.head.appendChild(s);
    });
  }

  function cleanOcrLine(line) {
    return repairOcrNumberText(line)
      .replace(/^[=\-_|>\s*#~•·]+/, '')
      .replace(/[<>|*~]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }




  function normalizeRecipeOcrLexicon(text) {
    return repairOcrNumberText(text)
      .replace(/[œŒ]/g, 'oe')
      .replace(/\bC?E[uµ]l\s*\(s\)/gi, 'oeufs')
      .replace(/\bOe[uµ]l\s*\(s\)/gi, 'oeufs')
      .replace(/\bE[uµ]l\s*\(s\)/gi, 'oeufs')
      .replace(/\bOeuf\s*\(s\)/gi, 'oeufs')
      .replace(/\bOeufs?\b/gi, 'oeufs')
      .replace(/\bCEufs?\b/gi, 'oeufs')
      .replace(/\bP[eé]pit[0o]\s*\(s\)/gi, 'pépites')
      .replace(/\bP[eé]pito\s*\(s\)/gi, 'pépites')
      .replace(/\bP[eé]pite\s*\(s\)/gi, 'pépites')
      .replace(/\bBanane\s*\(s\)/gi, 'bananes')
      .replace(/\bOeuf\s*\(s\)/gi, 'oeufs')
      .replace(/\bSucre\s+en\s+poudre\b/gi, 'Sucre en poudre')
      .replace(/\bCreme\s+liquide\b/gi, 'Crème liquide')
      .replace(/\bCr[èe]me\s+liquide\b/gi, 'Crème liquide')
      .replace(/\s{2,}/g, ' ');
  }

  function recipeGridIngredientSpecs() {
    return [
      { key:'farine', name:'Farine', re:/\bfarine\b/i },
      { key:'sucre_poudre', name:'Sucre en poudre', re:/\bs[uµ]cr[eé]\b|\bp[o0]u?d?r?e\b|\bs[uµ]cr[eé]\s+(?:en\s+)?p[o0]u?d?r?e\b/i },
      { key:'oeufs', name:'Œufs', re:/\b(?:oeufs?|eufs?|ceufs?|ceuls?|oeul|eul|ceul|[o0]euf\s*\(?s?\)?)\b/i },
      { key:'bananes', name:'Bananes', re:/\bbananes?\b/i },
      { key:'pepites_chocolat', name:'Pépites de chocolat noir', re:/\bp[eé]pit(?:e|es|o|0|os|0s)?\b|\bp[eé]pit[0o]\s*\(?s?\)?\b|\bchocolat\s+noir\b|\bchocolat\b/i },
      { key:'creme_liquide', name:'Crème liquide', re:/\bcr[èe]me\s+liquide\b|\bcreme\s+liquide\b/i },
      { key:'sel', name:'Sel', re:/\bsel\b/i }
    ];
  }

  function findRecipeGridIngredients(text) {
    const normalized = normalizeRecipeOcrLexicon(text);
    const joined = normalized.replace(/\r?\n/g, ' ');
    const items = [];
    for (const spec of recipeGridIngredientSpecs()) {
      const match = joined.match(spec.re);
      if (!match) continue;
      // Pour le chocolat, on évite de créer une ligne isolée si aucune trace de pépites n'existe.
      if (spec.key === 'pepites_chocolat' && !/p[eé]pit|chocolat\s+noir/i.test(joined)) continue;
      items.push({ key: spec.key, name: spec.name, index: match.index || 0 });
    }
    items.sort((a, b) => a.index - b.index);
    const seen = new Set();
    return items.filter(it => {
      if (seen.has(it.key)) return false;
      seen.add(it.key);
      return true;
    });
  }

  function normalizeRecipeQuantityToken(token) {
    let t = String(token || '').trim()
      .replace(/,/g, '.')
      .replace(/\s+/g, ' ')
      .replace(/pincee/gi, 'pincée')
      .replace(/pinc[ée]e\s*\(s\)/gi, 'pincée')
      .replace(/\bgr\b/gi, 'g')
      .replace(/\bg\.\b/gi, 'g')
      .replace(/\bcl\.\b/gi, 'cl')
      .replace(/\bml\.\b/gi, 'ml');
    return t;
  }

  function extractRecipeGridQuantities(text) {
    const normalized = normalizeRecipeOcrLexicon(text);
    const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    const unitRe = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr\.?|ml|cl|l|pinc[ée]e(?:\(s\))?|pincee(?:\(s\))?|c[àa]s|c[àa]c|cuill[eè]res?)(?=\b|[^A-Za-zÀ-ÿ]|$)/gi;
    lines.forEach((line, lineIndex) => {
      const masked = line.replace(unitRe, (m, offset) => {
        out.push({ token: normalizeRecipeQuantityToken(m), lineIndex, index: offset });
        return ' '.repeat(m.length);
      });
      const numbers = [];
      const singleRe = /\b\d+(?:[.,]\d+)?\b/g;
      let m;
      while ((m = singleRe.exec(masked))) {
        numbers.push({ token: normalizeRecipeQuantityToken(m[0]), lineIndex, index: m.index });
      }
      const hasCountableWord = /oeufs?|bananes?|pommes?|sachets?|tranches?|portions?/i.test(line);
      const looksLikeQuantityRow = numbers.length >= 2 || /^\s*\d+(?:[.,]\d+)?(?:\s+\d+(?:[.,]\d+)?)+\s*$/.test(line);
      if (looksLikeQuantityRow || hasCountableWord) {
        for (const n of numbers) {
          // Ignore les fragments parasites isolés comme "de 1" vus sur certaines OCR de grilles.
          if (numbers.length === 1 && /\bde\s+\d+\b/i.test(line) && !hasCountableWord) continue;
          out.push(n);
        }
      }
    });
    // Déduplication locale simple, en gardant l'ordre lu.
    const cleaned = [];
    for (const q of out) {
      const token = normalizeRecipeQuantityToken(q.token);
      if (!token) continue;
      cleaned.push(token);
    }
    return cleaned;
  }

  function looksLikeBananaCakeGridCase(ingredients, quantities) {
    const keys = new Set((ingredients || []).map(it => it.key));
    const q = (quantities || []).map(v => String(v || '').toLowerCase());
    const hasBase = keys.has('farine') && keys.has('oeufs') && keys.has('bananes');
    const hasTwo120 = q.filter(v => /^120\s*g$/.test(v)).length >= 2;
    const hasTwoCounts = q.filter(v => /^3$/.test(v)).length >= 2;
    return hasBase && hasTwo120 && hasTwoCounts;
  }

  function insertRecipeGridIngredient(items, afterKey, item) {
    if (!Array.isArray(items) || items.some(it => it.key === item.key)) return items;
    const out = items.slice();
    const idx = out.findIndex(it => it.key === afterKey);
    if (idx >= 0) out.splice(idx + 1, 0, item);
    else out.push(item);
    return out;
  }

  function normalizeRecipeGridPairsForKnownLayouts(ingredients, quantities, text) {
    let items = Array.isArray(ingredients) ? ingredients.slice() : [];
    let qtys = Array.isArray(quantities) ? quantities.slice() : [];
    const joined = normalizeRecipeOcrLexicon(text || '').toLowerCase();

    // Cas observé : recette en grille avec images, noms sur une ligne et quantités en dessous.
    // Certaines OCR lisent "Farine 120 g / Œufs 120 g / Bananes 3..." et perdent "Sucre en poudre".
    // Si le motif farine + deux 120 g + œufs/bananes est présent, le second 120 g correspond très probablement au sucre.
    if (!items.some(it => it.key === 'sucre_poudre') && looksLikeBananaCakeGridCase(items, qtys)) {
      items = insertRecipeGridIngredient(items, 'farine', { key: 'sucre_poudre', name: 'Sucre en poudre', index: 999999 });
    }

    // Même logique pour les pépites : si chocolat/pépite est visible et qu'une troisième quantité 120 g existe,
    // on insère l'ingrédient entre bananes et crème liquide.
    const count120g = qtys.filter(v => /^120\s*g$/i.test(String(v || ''))).length;
    if (!items.some(it => it.key === 'pepites_chocolat') && count120g >= 3 && /(p[eé]pit|chocolat)/i.test(joined)) {
      items = insertRecipeGridIngredient(items, 'bananes', { key: 'pepites_chocolat', name: 'Pépites de chocolat noir', index: 999999 });
    }

    // Si le sel est détecté mais que l'OCR a perdu "1 pincée", on garde une quantité prudente et modifiable.
    if (items.some(it => it.key === 'sel') && qtys.length < items.length && !qtys.some(v => /pinc/i.test(String(v || '')))) {
      qtys = qtys.concat(['1 pincée']);
    }

    return { ingredients: items, quantities: qtys };
  }

  function reconstructRecipeGridOcr(text) {
    const baseIngredients = findRecipeGridIngredients(text);
    const baseQuantities = extractRecipeGridQuantities(text);
    const normalized = normalizeRecipeGridPairsForKnownLayouts(baseIngredients, baseQuantities, text);
    const ingredients = normalized.ingredients;
    const quantities = normalized.quantities;
    const pairCount = Math.min(ingredients.length, quantities.length);
    if (pairCount < 3) return '';
    // Cette reconstruction cible les recettes affichées en grille : une ligne de noms, une ligne de quantités.
    // Elle ne remplace le texte OCR que si plusieurs paires aliment + quantité sont réellement retrouvées.
    const lines = [];
    for (let i = 0; i < pairCount; i += 1) {
      lines.push(`${ingredients[i].name} ${quantities[i]}`);
    }
    return lines.join('\n');
  }

  function countRecipePairedLines(text) {
    return String(text || '').split(/\r?\n/).filter(line => {
      const l = line.trim();
      return /[A-Za-zÀ-ÿ]/.test(l) && /\d/.test(l) && /(\b(?:kg|g|ml|cl|l|pinc[ée]e|c[àa]s|c[àa]c)\b|\b\d+\b)/i.test(l);
    }).length;
  }


  function cleanNutritionOcr(text) {
    const NUTRITION = /kcal|energie|energy|calorie|proteine|protein|glucide|carbohyd|lipide|matiere grasse|graisse|\bfat\b|sucre|fibre|\bsel\b|sodium/i;
    const HAS_NUM = /\d/;
    const PORTION_ONLY = /^(pour|per|par)\s*\d+\s*g/i;
    return normalizeNutritionOcrText(text)
      .filter(l => l.length > 1 && ((NUTRITION.test(ocrLineKey(l)) && HAS_NUM.test(l)) || PORTION_ONLY.test(l)))
      .join('\n');
  }


  function cleanRecipeOcr(text) {
    const INSTR = /pr[ée]chauf|m[ée]lang|fouett|enfour|laisser|reposer|servir|cuire|cuisson|mixer|rincer|[ée]goutter|sal[ée]r|poivrer|\bfour\b|\bmin\b/i;
    const grid = reconstructRecipeGridOcr(text);
    const source = grid || normalizeRecipeOcrLexicon(text);
    return repairOcrNumberText(source).split(/\r?\n/)
      .map(l => l.trim()
        .replace(/(ingr[ée]dients?|recette|préparation)\s*:?/gi, '')
        .replace(/(\d+)\s*gde\s+/gi, '$1 g de ')
        .replace(/(\d+)\s*mlde\s+/gi, '$1 ml de ')
        .replace(/(\d+)\s*clde\s+/gi, '$1 cl de ')
        .replace(/(\d+)\s*sachets?de\s+/gi, '$1 sachet de ')
        .replace(/(\d+)\s*(?:grammes?|gr\.?|g\.)\b/gi, '$1 g')
        .replace(/(\d+)\s*(?:kilogrammes?|kilo?s?|kg\.)\b/gi, '$1 kg')
        .replace(/(\d+)\s*(?:millilitres?|ml\.)\b/gi, '$1 ml')
        .replace(/(\d+)\s*(?:centilitres?|cl\.)\b/gi, '$1 cl')
        .replace(/cuill[eè]res?\s*[àa]\s*soupe/gi, 'càs')
        .replace(/cuill[eè]res?\s*[àa]\s*caf[ée]/gi, 'càc')
        .replace(/(\d+)\s*pommes/gi, '$1 pommes')
        .replace(/(\d+)\s*oeufs?/gi, '$1 oeufs')
        .replace(/(\d+)\s*œufs?/gi, '$1 œufs')
        .replace(/([A-Za-zÀ-ÿ])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-zÀ-ÿ])/g, '$1 $2')
      )
      .map(l => cleanOcrLine(l))
      .filter(l => l.length > 2 && !INSTR.test(l))
      .join('\n');
  }

  function normalizeGroqNutritionLabelFallbackPayload(payload) {
    const data = payload || {};
    const item = data.item || data.label || data.food || data.product || (Array.isArray(data.items) ? data.items[0] : null) || (Array.isArray(data.suggestions) ? data.suggestions[0] : null) || data;
    const per100 = item.per_100g || item.per100 || item.nutrition_100g || item.nutrition || item.nutriments || item.macros || item;
    const nom = String(item.nom || item.name || item.product_name || item.produit || data.nom || data.name || data.product_name || 'Produit scanné').trim() || 'Produit scanné';
    const qty = Math.max(1, Math.round(numberFromAny(item.qty || item.quantity_g || item.quantite || item['quantité'] || 100, 100)));
    const kcal = Math.round(numberFromAny(per100.kcal ?? per100.calories ?? per100.energy_kcal ?? per100.energie ?? per100['énergie'] ?? item.kcal ?? item.calories ?? item.energy_kcal, 0));
    const prot = round1(numberFromAny(per100.prot ?? per100.proteines ?? per100['protéines'] ?? per100.protein ?? per100.proteins ?? item.prot ?? item.proteines ?? item.protein, 0));
    const gluc = round1(numberFromAny(per100.gluc ?? per100.glucides ?? per100.carbs ?? per100.carbohydrates ?? item.gluc ?? item.glucides ?? item.carbs, 0));
    const lip = round1(numberFromAny(per100.lip ?? per100.lipides ?? per100.fat ?? per100.graisses ?? item.lip ?? item.lipides ?? item.fat, 0));
    if (!(kcal > 0) && !(prot > 0 || gluc > 0 || lip > 0)) return null;
    return {
      nom,
      qty: qty || 100,
      defaut: qty || 100,
      kcal,
      prot,
      gluc,
      lip,
      kcal100: kcal,
      prot100: prot,
      gluc100: gluc,
      lip100: lip,
      source: 'Groq fallback OCR',
      unite: 'g',
      confidence: item.confidence || data.confidence || '',
      notes: item.notes || data.notes || 'Lecture assistée par Groq depuis le parcours OCR existant.'
    };
  }

  function normalizeGroqRecipeFallbackPayload(payload) {
    const data = payload || {};
    const item = data.item || data.recipe || data.recette || (Array.isArray(data.items) ? data.items[0] : null) || data;
    const totalWeight = Math.max(1, Math.round(numberFromAny(item.totalWeight ?? item.total_weight ?? item.total_weight_g ?? item.poids_total_g ?? item.poidsTotal ?? item.qty ?? item.quantity_g, 100)));
    const servings = Math.max(1, clampNumber($('#capture-recipe-servings')?.value, numberFromAny(data.servings || item.servings, 4)));
    const eaten = Math.max(0.1, clampNumber($('#capture-recipe-eaten')?.value, 1));
    const consumedQty = Math.max(1, Math.round(totalWeight * eaten / servings));
    const nutrition = item.per_100g || item.nutrition_100g || item.nutrition || item.macros || item;
    const kcal100 = numberFromAny(nutrition.kcal100 ?? nutrition.kcal_100g ?? nutrition.kcal ?? nutrition.calories ?? nutrition.energy_kcal ?? item.kcal100 ?? item.kcal_100g, 0);
    const prot100 = numberFromAny(nutrition.prot100 ?? nutrition.prot_100g ?? nutrition.prot ?? nutrition.proteines ?? nutrition['protéines'] ?? nutrition.protein ?? item.prot100 ?? item.prot_100g, 0);
    const gluc100 = numberFromAny(nutrition.gluc100 ?? nutrition.gluc_100g ?? nutrition.gluc ?? nutrition.glucides ?? nutrition.carbs ?? nutrition.carbohydrates ?? item.gluc100 ?? item.gluc_100g, 0);
    const lip100 = numberFromAny(nutrition.lip100 ?? nutrition.lip_100g ?? nutrition.lip ?? nutrition.lipides ?? nutrition.fat ?? nutrition.graisses ?? item.lip100 ?? item.lip_100g, 0);
    if (!(kcal100 > 0) && !(prot100 > 0 || gluc100 > 0 || lip100 > 0)) return null;
    return recipeDishItem({
      nom: String(item.nom || item.name || item.recipe_name || item.nom_recette || data.recipe_name || estimateRecipeName(state.ocrText) || 'Plat maison').trim(),
      totalWeight,
      consumedQty,
      kcal100,
      prot100,
      gluc100,
      lip100
    });
  }

  async function runNutritionLabelGroqFallback() {
    if (state.mode !== MODES.NUTRITION_TABLE) return;
    if (!state.imageDataUrl) throw new Error('Aucune image de tableau à envoyer à Groq. Reprends une photo.');
    const ocrText = ($('#capture-ocr-text')?.value || state.ocrText || '').trim();
    state.ocrText = ocrText;
    setBusy(true, 'Groq relit le tableau nutritionnel…');
    try {
      const image = await compressImageForVision(state.imageDataUrl, { maxSide: 1400, quality: 0.82, maxBytes: 3.8 * 1024 * 1024 });
      const payload = JSON.stringify({ image, ocrText });
      const endpoints = ['/api/groq/nutrition-label-fallback', '/api/groq/nutrition-table-fallback', '/api/groq/nutrition-ocr-fallback'];
      let res = null;
      let data = {};
      let last404 = false;
      for (const endpoint of endpoints) {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: apiUserHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
          body: payload
        });
        data = await res.json().catch(() => ({}));
        if (res.status !== 404) break;
        last404 = true;
      }
      if (!res || !res.ok || data.ok === false) {
        if (last404 && res && res.status === 404) throw new Error('Endpoint Groq OCR absent côté serveur : réinstalle le patch et redémarre le conteneur foodnote.');
        throw new Error(data.error || data.message || ('Erreur Groq OCR ' + (res ? res.status : '')));
      }
      const item = normalizeGroqNutritionLabelFallbackPayload(data);
      if (!item) throw new Error('Groq n’a pas renvoyé de kcal/macros exploitables pour ce tableau.');
      state.results = [item];
      state.searchQty = item.qty || 100;
      state.selectedIndex = 0;
      setBusy(false);
      transition(STATES.CONFIRM_FOOD, { results: state.results });
    } catch (e) {
      setBusy(false);
      fail(e.message || String(e));
    }
  }

  async function runRecipePhotoGroqFallback() {
    if (state.mode !== MODES.RECIPE) return;
    if (!state.imageDataUrl) throw new Error('Aucune image de recette à envoyer à Groq. Reprends une photo.');
    const ocrText = ($('#capture-ocr-text')?.value || state.ocrText || '').trim();
    state.ocrText = ocrText;
    setBusy(true, 'Groq relit la photo de recette…');
    try {
      const image = await compressImageForVision(state.imageDataUrl, { maxSide: 1400, quality: 0.82, maxBytes: 3.8 * 1024 * 1024 });
      const servings = Math.max(1, clampNumber($('#capture-recipe-servings')?.value, 4));
      const eaten = Math.max(0.1, clampNumber($('#capture-recipe-eaten')?.value, 1));
      const payload = JSON.stringify({ image, ocrText, servings, eaten });
      const endpoints = ['/api/groq/recipe-photo-fallback', '/api/groq/recipe-fallback', '/api/groq/recipe-ocr-fallback', '/api/groq/recipe-image-fallback'];
      let res = null;
      let data = {};
      let last404 = false;
      for (const endpoint of endpoints) {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: apiUserHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
          body: payload
        });
        data = await res.json().catch(() => ({}));
        if (res.status !== 404) break;
        last404 = true;
      }
      if (!res || !res.ok || data.ok === false) {
        if (last404 && res && res.status === 404) throw new Error('Endpoint Groq recette absent côté serveur : réinstalle le patch et redémarre le conteneur foodnote.');
        throw new Error(data.error || data.message || ('Erreur Groq recette ' + (res ? res.status : '')));
      }
      const item = normalizeGroqRecipeFallbackPayload(data);
      if (!item) throw new Error('Groq n’a pas renvoyé de recette exploitable avec valeurs pour 100 g.');
      state.results = [item];
      state.searchQty = item.qty || item.totalWeight || 100;
      state.selectedIndex = 0;
      setBusy(false);
      transition(STATES.CONFIRM_RECIPE, { results: state.results });
    } catch (e) {
      setBusy(false);
      fail(e.message || String(e));
    }
  }

  function analyseOcrText() {
    const text = ($('#capture-ocr-text')?.value || '').trim();
    if (!text) throw new Error('OCR vide : corrige ou recadre la photo avant analyse.');
    state.ocrText = text;
    state.aiText = text;
    transition(STATES.AI_ANALYSIS);
  }

  async function runAiFromInput() {
    const text = ($('#capture-ai-text')?.value || '').trim();
    if (!text) throw new Error('Texte IA vide.');
    state.aiText = text;
    setBusy(true, 'Groq analyse le contenu…');
    try {
      const prompt = buildPrompt(text);
      // 0.22.138 : même chemin IA que le reste de FoodNote.
      // On privilégie callGroqChat() / proxy serveur (/api/groq/chat), donc la clé
      // Docker/SQLite fonctionne et on évite les blocages navigateur/WebView.
      const answer = await callGroq(prompt, { max_tokens: state.mode === MODES.RECIPE ? 900 : 1100, temperature: 0.1 });
      const parsed = state.mode === MODES.RECIPE ? parseRecipeDishRows(answer, text) : parseNutritionRows(answer);
      if (!parsed.length) throw new Error('IA disponible mais réponse non comprise. Réponse brute : ' + answer.slice(0, 280));
      state.results = parsed;
      if (state.mode === MODES.RECIPE && parsed[0]) state.searchQty = parsed[0].qty || parsed[0].totalWeight || 100;
      state.selectedIndex = 0;
      window._foodnoteCaptureLastGroq = answer;
      setBusy(false);
      transition(state.mode === MODES.RECIPE ? STATES.CONFIRM_RECIPE : STATES.CONFIRM_FOOD, { results: parsed });
    } catch (e) {
      setBusy(false);
      fail(e.message || String(e));
    }
  }

  function buildPrompt(text) {
    if (state.mode === MODES.NUTRITION_TABLE) {
      return `Tu es un expert nutrition. À partir du texte OCR d'un tableau nutritionnel, reconstruis un aliment unique.\n\nTexte OCR :\n${text}\n\nRéponds UNIQUEMENT au format tableau :\nNom | Quantité (g) | Kcal | Protéines (g) | Glucides (g) | Lipides (g)\nUtilise Quantité 100 g si le tableau est pour 100 g. Pas de commentaire.`;
    }
    if (state.mode === MODES.RECIPE) {
      const servings = clampNumber($('#capture-recipe-servings')?.value, 4);
      const eaten = clampNumber($('#capture-recipe-eaten')?.value, 1);
      return `Tu es un expert nutrition. Analyse cette recette comme UN PLAT COMPLET, pas comme une liste d'ingrédients.

Recette / ingrédients OCR :
${text}

Règles importantes :
- estime un nom de plat court et naturel à partir des ingrédients ;
- additionne les poids des ingrédients pour estimer le poids total final du plat en grammes ;
- si un ingrédient n'a pas de poids clair, estime un poids réaliste ;
- calcule les valeurs nutritionnelles POUR 100 g du plat complet ;
- ne renvoie PAS une ligne par ingrédient ;
- la recette fait environ ${servings} portion(s), l'utilisateur mangera ${eaten} portion(s), mais la ligne demandée doit rester basée sur le plat complet et ses valeurs pour 100 g.

Réponds UNIQUEMENT avec une seule ligne au format exact :
Nom du plat | Poids total estimé (g) | Kcal / 100 g | Protéines / 100 g | Glucides / 100 g | Lipides / 100 g

Exemple de forme :
Gratin de courgettes | 920 | 132 | 6.5 | 9.8 | 7.1

Pas de commentaire, pas d'autre ligne.`;
    }
    return `Tu es un expert nutrition. Estime les valeurs nutritionnelles réalistes pour les aliments suivants.

${text}

Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaire.
Format exact :
[
  {"nom":"Aliment", "qty":100, "kcal":123, "prot":4.5, "gluc":12.3, "lip":6.7}
]
Règles :
- une entrée par aliment détecté ;
- qty = quantité consommée en grammes ;
- kcal/prot/gluc/lip = valeurs pour cette quantité consommée, pas pour 100 g ;
- n'utilise pas de chaînes avec unités dans le JSON, seulement des nombres ;
- si tu n'es pas sûr du poids, estime un poids réaliste.`;
  }

  async function callGroq(promptOrKey, maybePromptOrOptions, maybeOptions) {
    // Compatibilité : ancien appel callGroq(key, prompt) ou nouvel appel callGroq(prompt, options).
    let prompt = '';
    let options = {};
    let key = '';
    if (typeof maybePromptOrOptions === 'string') {
      key = String(promptOrKey || '');
      prompt = maybePromptOrOptions;
      options = maybeOptions || {};
    } else {
      prompt = String(promptOrKey || '');
      options = maybePromptOrOptions || {};
      key = getGroqKey();
    }

    const maxTokens = options.max_tokens || options.maxTokens || 1400;
    const temperature = options.temperature ?? 0.1;
    const model = options.model || (typeof window.fnIAGetModel === 'function' ? window.fnIAGetModel() : 'llama-3.3-70b-versatile');
    const messages = options.messages || [{ role: 'user', content: prompt }];

    if (typeof window.callGroqChat === 'function') {
      return await window.callGroqChat(prompt, { model, messages, max_tokens: maxTokens, temperature });
    }

    async function readGroqResponse(res, contextLabel) {
      const txt = await res.text();
      let data = {};
      try { data = txt ? JSON.parse(txt) : {}; }
      catch (e) { throw new Error((contextLabel || 'Groq') + ' : réponse non JSON ' + (res.status || '') + ' ' + txt.slice(0, 120)); }
      if (!res.ok) throw new Error(data?.error?.message || data?.error || data?.message || ((contextLabel || 'Groq') + ' erreur ' + res.status));
      return (data.response || data.content || data.choices?.[0]?.message?.content || '').trim();
    }

    if (location.protocol === 'http:' || location.protocol === 'https:') {
      let lastErr = null;
      const payload = { model, messages, prompt, temperature, max_tokens: maxTokens };
      for (const endpoint of ['/api/groq/chat', '/api/groq']) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return await readGroqResponse(res, 'Proxy Groq');
        } catch (e) {
          lastErr = e;
          if (!String(e.message || e).includes('404')) break;
        }
      }
      console.warn('[FoodNoteCapture] Proxy Groq indisponible, tentative API directe:', lastErr);
    }

    if (!key) {
      throw new Error('Clé Groq absente. Configure GROQ_API_KEY côté serveur, ou enregistre la clé dans IA > Clé API Groq.');
    }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens })
    });
    return await readGroqResponse(res, 'API Groq');
  }


  function parseRecipeDishRows(answer, originalText) {
    const servings = Math.max(1, clampNumber($('#capture-recipe-servings')?.value, 4));
    const eaten = Math.max(0.1, clampNumber($('#capture-recipe-eaten')?.value, 1));
    const parsedLines = [];

    String(answer || '').split(/\r?\n/).forEach(line => {
      const clean = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .replace(/\*\*/g, '')
        .replace(/^[-*•]\s*/, '')
        .trim();
      if (!clean || /^[-|;\s]+$/.test(clean)) return;
      if (/nom\s+du\s+plat|poids\s+total|kcal\s*\/\s*100|prot/i.test(clean)) return;
      let parts = clean.includes('|') ? clean.split('|').map(p => p.trim()) : [];
      if (parts.length < 6 && clean.includes(';')) parts = clean.split(';').map(p => p.trim());
      if (parts.length < 6) parts = splitLooseNutritionLine(clean);
      if (parts.length < 6) return;
      const nom = parts[0].replace(/^[-*•]\s*/, '').trim();
      const qty = looseNumber(parts[1], 0);
      const kcal = looseNumber(parts[2], 0);
      const prot = looseNumber(parts[3], 0);
      const gluc = looseNumber(parts[4], 0);
      const lip = looseNumber(parts[5], 0);
      if (!nom || !qty || (!kcal && !prot && !gluc && !lip)) return;
      parsedLines.push({ nom, qty, kcal, prot, gluc, lip });
    });

    if (!parsedLines.length) return [];

    // Cas attendu : une seule ligne = plat complet avec valeurs pour 100 g.
    if (parsedLines.length === 1) {
      const row = parsedLines[0];
      const totalWeight = Math.max(1, Math.round(row.qty));
      const consumedQty = Math.max(1, Math.round(totalWeight * eaten / servings));
      return [recipeDishItem({
        nom: row.nom || estimateRecipeName(originalText),
        totalWeight,
        consumedQty,
        kcal100: row.kcal,
        prot100: row.prot,
        gluc100: row.gluc,
        lip100: row.lip
      })];
    }

    // Sécurité : si le modèle renvoie encore une liste d'ingrédients, on agrège.
    const totalWeight = parsedLines.reduce((sum, r) => sum + clampNumber(r.qty, 0), 0);
    if (!totalWeight) return [];
    const totalKcal = parsedLines.reduce((sum, r) => sum + clampNumber(r.kcal, 0), 0);
    const totalProt = parsedLines.reduce((sum, r) => sum + clampNumber(r.prot, 0), 0);
    const totalGluc = parsedLines.reduce((sum, r) => sum + clampNumber(r.gluc, 0), 0);
    const totalLip  = parsedLines.reduce((sum, r) => sum + clampNumber(r.lip, 0), 0);
    const consumedQty = Math.max(1, Math.round(totalWeight * eaten / servings));
    return [recipeDishItem({
      nom: estimateRecipeName(originalText) || 'Plat maison',
      totalWeight: Math.round(totalWeight),
      consumedQty,
      kcal100: totalKcal * 100 / totalWeight,
      prot100: totalProt * 100 / totalWeight,
      gluc100: totalGluc * 100 / totalWeight,
      lip100:  totalLip  * 100 / totalWeight
    })];
  }

  function recipeDishItem({ nom, totalWeight, consumedQty, kcal100, prot100, gluc100, lip100 }) {
    const qty = Math.max(1, Math.round(clampNumber(consumedQty, totalWeight || 100)));
    const item = {
      nom: nom || 'Plat maison',
      totalWeight: Math.max(1, Math.round(clampNumber(totalWeight, qty))),
      qty,
      kcal100: Math.round(clampNumber(kcal100, 0)),
      prot100: round1(clampNumber(prot100, 0)),
      gluc100: round1(clampNumber(gluc100, 0)),
      lip100: round1(clampNumber(lip100, 0)),
      source: 'Recette IA',
      unite: 'g'
    };
    item.kcal = Math.round(item.kcal100 * qty / 100);
    item.prot = round1(item.prot100 * qty / 100);
    item.gluc = round1(item.gluc100 * qty / 100);
    item.lip  = round1(item.lip100  * qty / 100);
    return item;
  }

  function estimateRecipeName(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => cleanOcrLine(l)).filter(Boolean);
    for (const line of lines) {
      if (line.length < 4 || line.length > 70) continue;
      if (/^\d|\d+\s*(g|kg|ml|cl|l|oeufs?|sachets?)/i.test(line)) continue;
      if (/farine|sucre|beurre|huile|sel|poivre|oeuf|lait|cr[eè]me|levure|vanille|pomme|riz|poulet/i.test(line) && line.split(/\s+/).length <= 3) continue;
      return line.slice(0, 60);
    }
    return 'Plat maison';
  }

  function extractJsonArrayText(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    const first = candidate.indexOf('[');
    const last = candidate.lastIndexOf(']');
    if (first >= 0 && last > first) return candidate.slice(first, last + 1);
    return candidate;
  }

  function rowFromNutritionObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const nom = pickObjectText(obj, ['nom', 'name', 'aliment', 'food', 'ingredient', 'plat'], '').replace(/^[-*•]\s*/, '').trim();
    if (!nom || /quantit|kcal|prot/i.test(nom)) return null;
    const nutrition = obj.nutrition || obj.nutriments || obj.macros || obj.macro || obj.nutrition_estimee || obj.nutrition_estimee_par_portion || obj.nutrition_per_serving || obj.per_serving || {};
    const qty = Math.max(1, pickObjectNumber(obj, ['qty', 'quantite', 'quantité', 'poids', 'grammes', 'g', 'quantity', 'quantity_g', 'portion_g'], pickObjectNumber(nutrition, ['qty', 'quantite', 'quantity_g', 'poids', 'grammes', 'portion_g'], 100)));
    const kcal100 = pickObjectNumber(obj, ['kcal100', 'kcal_100g', 'kcalPer100', 'calories100', 'calories_100g', 'caloriesPer100', 'energy_kcal_100g', 'energie_100g', 'énergie_100g', 'kcal_per_100g', 'calories_per_100g'], pickObjectNumber(nutrition, ['kcal100', 'kcal_100g', 'kcalPer100', 'calories100', 'calories_100g', 'caloriesPer100', 'energy_kcal_100g', 'energie_100g', 'énergie_100g', 'kcal_per_100g', 'calories_per_100g'], 0));
    const prot100 = pickObjectNumber(obj, ['prot100', 'prot_100g', 'protPer100', 'proteins100', 'protein100', 'proteines100', 'protéines100', 'proteins_100g', 'protein_100g', 'proteines_100g', 'protéines_100g', 'protein_per_100g', 'proteins_per_100g'], pickObjectNumber(nutrition, ['prot100', 'prot_100g', 'protPer100', 'proteins100', 'protein100', 'proteines100', 'protéines100', 'proteins_100g', 'protein_100g', 'proteines_100g', 'protéines_100g', 'protein_per_100g', 'proteins_per_100g'], 0));
    const gluc100 = pickObjectNumber(obj, ['gluc100', 'gluc_100g', 'glucPer100', 'carbs100', 'carbohydrates100', 'glucides100', 'carbohydrates_100g', 'carbs_100g', 'glucides_100g', 'carbs_per_100g', 'carbohydrates_per_100g'], pickObjectNumber(nutrition, ['gluc100', 'gluc_100g', 'glucPer100', 'carbs100', 'carbohydrates100', 'glucides100', 'carbohydrates_100g', 'carbs_100g', 'glucides_100g', 'carbs_per_100g', 'carbohydrates_per_100g'], 0));
    const lip100  = pickObjectNumber(obj, ['lip100', 'lip_100g', 'lipPer100', 'fat100', 'lipides100', 'graisses100', 'fat_100g', 'lipides_100g', 'graisses_100g', 'matières_grasses_100g', 'matieres_grasses_100g', 'fat_per_100g'], pickObjectNumber(nutrition, ['lip100', 'lip_100g', 'lipPer100', 'fat100', 'lipides100', 'graisses100', 'fat_100g', 'lipides_100g', 'graisses_100g', 'matières_grasses_100g', 'matieres_grasses_100g', 'fat_per_100g'], 0));
    let kcal = pickObjectNumber(obj, ['kcal', 'calories', 'calorie', 'calories_kcal', 'energy_kcal', 'energie', 'énergie', 'energie_kcal', 'kcal_total', 'total_kcal', 'calories_total', 'total_calories'], pickObjectNumber(nutrition, ['kcal', 'calories', 'calorie', 'calories_kcal', 'energy_kcal', 'energie', 'énergie', 'energie_kcal', 'kcal_total', 'total_kcal', 'calories_total', 'total_calories'], 0));
    let prot = pickObjectNumber(obj, ['prot', 'proteines', 'protéines', 'proteins', 'protein', 'protein_g', 'proteins_g', 'proteines_g', 'protéines_g', 'prot_g', 'protein_total', 'total_prot', 'total_protein'], pickObjectNumber(nutrition, ['prot', 'proteines', 'protéines', 'proteins', 'protein', 'protein_g', 'proteins_g', 'proteines_g', 'protéines_g', 'prot_g', 'protein_total', 'total_prot', 'total_protein'], 0));
    let gluc = pickObjectNumber(obj, ['gluc', 'glucides', 'carbohydrates', 'carbs', 'hydrates', 'carbs_g', 'glucides_g', 'gluc_g', 'carbohydrates_g', 'glucides_total', 'total_gluc', 'total_carbs', 'total_carbohydrates'], pickObjectNumber(nutrition, ['gluc', 'glucides', 'carbohydrates', 'carbs', 'hydrates', 'carbs_g', 'glucides_g', 'gluc_g', 'carbohydrates_g', 'glucides_total', 'total_gluc', 'total_carbs', 'total_carbohydrates'], 0));
    let lip  = pickObjectNumber(obj, ['lip', 'lipides', 'fat', 'graisses', 'matières grasses', 'matieres grasses', 'fat_g', 'lipides_g', 'lip_g', 'fat_total', 'total_lip', 'total_fat'], pickObjectNumber(nutrition, ['lip', 'lipides', 'fat', 'graisses', 'matières grasses', 'matieres grasses', 'fat_g', 'lipides_g', 'lip_g', 'fat_total', 'total_lip', 'total_fat'], 0));
    if (!kcal && kcal100 > 0) kcal = kcal100 * qty / 100;
    if (!prot && prot100 > 0) prot = prot100 * qty / 100;
    if (!gluc && gluc100 > 0) gluc = gluc100 * qty / 100;
    if (!lip && lip100 > 0) lip = lip100 * qty / 100;
    if (!kcal && !prot && !gluc && !lip) return null;
    return makeIaNutritionRow(nom, qty, kcal, prot, gluc, lip);
  }


  function makeIaNutritionRow(nom, qty, kcal, prot, gluc, lip) {
    const q = Math.max(1, numberFromAny(qty, 100));
    const k = numberFromAny(kcal, 0);
    const p = numberFromAny(prot, 0);
    const g = numberFromAny(gluc, 0);
    const l = numberFromAny(lip, 0);
    const factor = q > 0 ? 100 / q : 1;
    return {
      nom: String(nom || 'Aliment IA').replace(/^[-*•]\s*/, '').trim(),
      qty: q,
      defaut: q,
      kcal: Math.round(k),
      prot: round1(p),
      gluc: round1(g),
      lip: round1(l),
      kcal100: Math.round(k * factor),
      prot100: round1(p * factor),
      gluc100: round1(g * factor),
      lip100: round1(l * factor),
      source: 'Groq',
      unite: 'g',
      saveToBase: true,
      _selectedForAdd: true
    };
  }

  function parseNutritionRows(text) {
    const rows = [];
    const raw = String(text || '').trim();
    if (!raw) return rows;

    // 0.22.153 : le prompt IA texte demande du JSON. On le lit en priorité.
    try {
      const jsonTxt = extractJsonArrayText(raw);
      const parsed = JSON.parse(jsonTxt);
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.aliments) ? parsed.aliments : []);
      list.forEach(obj => {
        const row = rowFromNutritionObject(obj);
        if (row) rows.push(row);
      });
      if (rows.length) return rows;
    } catch (e) {
      // Fallback texte/tableau ci-dessous.
    }

    String(raw).split(/\r?\n/).forEach(line => {
      const clean = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .replace(/\*\*/g, '')
        .replace(/^[-*•]\s*/, '')
        .trim();
      if (!clean || /nom\s*\|/i.test(clean) || /^[-|;\s]+$/.test(clean)) return;

      let parts = clean.includes('|') ? clean.split('|').map(p => p.trim()).filter(Boolean) : [];
      if (parts.length < 6 && clean.includes(';')) parts = clean.split(';').map(p => p.trim()).filter(Boolean);
      if (parts.length < 6 && /\t/.test(clean)) parts = clean.split(/\t+/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 6) {
        const nom = parts[0].replace(/^[-*•]\s*/, '').trim();
        if (!nom || /quantit|kcal|prot/i.test(nom)) return;
        const row = makeIaNutritionRow(nom, parts[1], parts[2], parts[3], parts[4], parts[5]);
        if (row.nom && (row.kcal || row.prot || row.gluc || row.lip)) rows.push(row);
        return;
      }

      const row = parseLooseIaNutritionLine(clean);
      if (row) rows.push(row);
    });

    return rows;
  }

  function valueAfterLabel(line, labelRegex) {
    const txt = String(line || '').replace(/\u00a0/g, ' ');
    const re1 = new RegExp(labelRegex.source + String.raw`[^0-9-]{0,18}([-+]?\d+(?:[,.]\d+)?)`, 'i');
    const m1 = txt.match(re1);
    if (m1) return numberFromAny(m1[1], 0);
    const re2 = new RegExp(String.raw`([-+]?\d+(?:[,.]\d+)?)\s*(?:g|kcal)?\s*(?:de\s+)?` + labelRegex.source, 'i');
    const m2 = txt.match(re2);
    if (m2) return numberFromAny(m2[1], 0);
    return 0;
  }

  function parseLooseIaNutritionLine(line) {
    const clean = String(line || '').trim();
    if (!clean || /quantit|kcal\s*\|/i.test(clean)) return null;

    const kcalL = valueAfterLabel(clean, /kcal|calories?/);
    const protL = valueAfterLabel(clean, /prot(?:é|e)ines?|proteins?/);
    const glucL = valueAfterLabel(clean, /glucides?|carbohydrates?|carbs?/);
    const lipL  = valueAfterLabel(clean, /lipides?|fat|graisses?|mati(?:è|e)res?\s+grasses?/);
    const qtyM = clean.match(/(?:quantit(?:é|e)|poids|qty)\D{0,12}(\d+(?:[,.]\d+)?)\s*g?/i)
      || clean.match(/(?:^|[^\d])(\d+(?:[,.]\d+)?)\s*(?:g|gr|grammes)\b/i);
    const qtyL = qtyM ? numberFromAny(qtyM[1], 100) : 100;

    let nom = clean
      .replace(/(?:quantit(?:é|e)|poids|qty)\D{0,12}\d+(?:[,.]\d+)?\s*g?/ig, ' ')
      .replace(/\d+(?:[,.]\d+)?\s*(?:kcal|calories?|g)?\s*(?:de\s+)?(?:prot(?:é|e)ines?|proteins?|glucides?|carbohydrates?|carbs?|lipides?|fat|graisses?|mati(?:è|e)res?\s+grasses?)/ig, ' ')
      .replace(/(?:kcal|calories?|prot(?:é|e)ines?|proteins?|glucides?|carbohydrates?|carbs?|lipides?|fat|graisses?|mati(?:è|e)res?\s+grasses?)\D{0,18}\d+(?:[,.]\d+)?/ig, ' ')
      .replace(/[|;:=,]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (kcalL || protL || glucL || lipL) {
      if (!nom || /^\d/.test(nom)) nom = clean.split(/[:|;,]/)[0].replace(/^[-*•]\s*/, '').trim() || 'Aliment IA';
      return makeIaNutritionRow(nom, qtyL, kcalL, protL, glucL, lipL);
    }

    const loose = splitLooseNutritionLine(clean);
    if (loose.length >= 6) {
      return makeIaNutritionRow(loose[0], loose[1], loose[2], loose[3], loose[4], loose[5]);
    }
    return null;
  }

  function splitLooseNutritionLine(line) {
    const clean = String(line || '').replace(/\u00a0/g, ' ').replace(/,/g, '.').trim();
    const nums = [...clean.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map(m => ({ value: Number(m[0]), index: m.index || 0 }));
    if (nums.length < 5) return [];
    // On prend les 5 derniers nombres pour éviter les numéros parasites dans le nom, ex. "2 œufs".
    const picked = nums.slice(-5);
    let name = clean.slice(0, picked[0].index).replace(/^[-*•]\s*/, '').replace(/[|;:,-]+\s*$/, '').trim();
    if (!name) name = clean.replace(/[-+]?\d+(?:\.\d+)?\s*(?:g|kcal)?/gi, ' ').replace(/[|;:=,]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return [name || 'Aliment IA', picked[0].value, picked[1].value, picked[2].value, picked[3].value, picked[4].value];
  }

  async function confirmSelected() {
    if (!state.results.length) throw new Error('Aucun aliment à ajouter.');
    if (state.busy) return;
    if (isIaSuggestionMode() && state.current === STATES.CONFIRM_FOOD) {
      syncAllIaTextRowsFromInputs();
      const selectedIndexes = getIaTextSelectedIndexes();
      if (!selectedIndexes.length) throw new Error('Sélection vide : coche au moins un aliment IA à ajouter.');
      state.pendingIaTextBulkIndexes = selectedIndexes;
      state.pendingIaTextReturnToList = false;
      if (state.skipMealSelect || state.iaTextMealConfirmed) {
        state.targetMeal = normalizeCaptureMeal(state.targetMeal || 'lunch');
        return confirmWithMeal();
      }
    }
    // Mode tableau nutritionnel : lire les inputs corrigés + sauvegarder en base
    if (state.mode === MODES.NUTRITION_TABLE) {
      const qty = state.searchQty || 100;
      const ratio = qty > 0 ? qty / 100 : 1;
      const item = state.results[0];
      if (item) {
        const nom   = document.getElementById('nc-nom')?.value.trim() || item.nom;
        const kcalI = parseFloat(document.getElementById('nc-kcal-input')?.value) || 0;
        const protI = parseFloat(document.getElementById('nc-prot-input')?.value) || 0;
        const glucI = parseFloat(document.getElementById('nc-gluc-input')?.value) || 0;
        const lipI  = parseFloat(document.getElementById('nc-lip-input')?.value)  || 0;
        item.nom = nom; item.qty = qty;
        item.kcal = kcalI; item.prot = protI; item.gluc = glucI; item.lip = lipI;
        if (document.getElementById('nc-save-base')?.checked) {
          try {
            await fetch('/api/foods/custom', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nom, unite: 'g', source: 'OCR',
                kcal100: ratio > 0 ? Math.round(kcalI/ratio) : kcalI,
                prot100: ratio > 0 ? parseFloat((protI/ratio).toFixed(1)) : protI,
                gluc100: ratio > 0 ? parseFloat((glucI/ratio).toFixed(1)) : glucI,
                lip100:  ratio > 0 ? parseFloat((lipI /ratio).toFixed(1)) : lipI
              })
            });
          } catch(e) { console.warn('Sauvegarde ignorée:', e.message); }
        }
      }
    }
    if (state.mode === MODES.RECIPE && state.current === STATES.CONFIRM_RECIPE) {
      const item = state.results[0];
      if (item) {
        const nom = document.getElementById('rc-nom')?.value.trim() || item.nom || 'Plat maison';
        const totalWeight = Math.max(1, Math.round(clampNumber(document.getElementById('rc-total-weight')?.value, item.totalWeight || item.qty || 100)));
        const qty = Math.max(1, Math.round(clampNumber(document.getElementById('rc-qty-input')?.value || document.getElementById('rc-qty-slider')?.value, item.qty || totalWeight)));
        const kcal100 = Math.round(clampNumber(document.getElementById('rc-kcal100')?.value, item.kcal100 || 0));
        const prot100 = round1(clampNumber(document.getElementById('rc-prot100')?.value, item.prot100 || 0));
        const gluc100 = round1(clampNumber(document.getElementById('rc-gluc100')?.value, item.gluc100 || 0));
        const lip100  = round1(clampNumber(document.getElementById('rc-lip100')?.value,  item.lip100  || 0));
        Object.assign(item, recipeDishItem({ nom, totalWeight, consumedQty: qty, kcal100, prot100, gluc100, lip100 }));
        state.searchQty = qty;
      }
    }
    if (state.mode === MODES.SEARCH && state.current === STATES.SEARCH_FOOD) {
      const item = applyCaptureSearchSelection(state.selectedIndex, { source:'confirm-selected' });
      if (item) syncCaptureSearchSelectedItemQty(item);
    }
    // Annule les recherches encore en vol pour éviter qu'elles rerendent la liste
    // pendant le passage vers le choix du repas.
    state.token++;
    if (state.skipMealSelect) {
      state.targetMeal = normalizeCaptureMeal(state.targetMeal);
      return confirmWithMeal();
    }
    transition(STATES.MEAL_SELECT);
  }

  async function confirmWithMeal() {
    if (!state.results.length) throw new Error('Aucun aliment à ajouter.');
    if (state.busy) return;
    state.targetMeal = normalizeCaptureMeal(state.targetMeal || 'lunch');
    if (typeof window !== 'undefined') {
      window.foodAddTargetMeal = state.targetMeal || 'lunch';
      const until = Date.now() + 2600;
      window.__foodnoteJournalAddCriticalUntil = Math.max(Number(window.__foodnoteJournalAddCriticalUntil || 0), until);
      window.__foodnoteSuppressDBRefreshUntil = Math.max(Number(window.__foodnoteSuppressDBRefreshUntil || 0), until);
      window.__foodnoteCaptureAddingToJournal = true;
    }
    const isIaBulk = isIaSuggestionMode() && Array.isArray(state.pendingIaTextBulkIndexes) && state.pendingIaTextBulkIndexes.length;
    setBusy(true, isIaBulk ? 'Ajout de la sélection au journal…' : 'Ajout au journal…');
    try {
      if (isIaBulk) {
        syncAllIaTextRowsFromInputs();
        const indexes = Array.from(new Set(state.pendingIaTextBulkIndexes))
          .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < state.results.length);
        let addedCount = 0;
        for (const idx of indexes) {
          const item = state.results[idx];
          if (!item || item._addedToJournal || item._selectedForAdd === false) continue;
          state.selectedIndex = idx;
          await addResultToJournal(item);
          item._addedToJournal = true;
          item._selectedForAdd = false;
          addedCount++;
        }
        state.iaTextMealConfirmed = true;
        state.pendingIaTextBulkIndexes = [];
        setBusy(false);
        if (!addedCount) throw new Error('Aucun aliment sélectionné n’a été ajouté.');
        if (selectNextPendingIaTextResult()) {
          transition(STATES.CONFIRM_FOOD, { results: state.results, selectedIndex: state.selectedIndex });
          renderStatus(addedCount + ' aliment' + (addedCount > 1 ? 's ajoutés' : ' ajouté') + '. Tu peux ajouter le reste si besoin.');
          return;
        }
        transition(STATES.SAVED);
        return;
      }

      const item = state.results[state.selectedIndex] || state.results[0];
      if (state.mode === MODES.SEARCH) syncCaptureSearchSelectedItemQty(item);
      await addResultToJournal(item);
      setBusy(false);
      if (isIaSuggestionMode()) {
        state.iaTextMealConfirmed = true;
        state.pendingIaTextReturnToList = false;
        if (state.results[state.selectedIndex]) {
          state.results[state.selectedIndex]._addedToJournal = true;
          state.results[state.selectedIndex]._selectedForAdd = false;
        }
        if (selectNextPendingIaTextResult()) {
          transition(STATES.CONFIRM_FOOD, { results: state.results, selectedIndex: state.selectedIndex });
          renderStatus('Aliment ajouté. Tu peux ajouter le suivant.');
          return;
        }
      }
      transition(STATES.SAVED);
    } finally {
      if (typeof window !== 'undefined') {
        setTimeout(() => { try { window.__foodnoteCaptureAddingToJournal = false; } catch(e) {} }, 350);
      }
    }
  }

  async function addResultToJournal(item) {
    const normalized = asIAParsedItem(item);
    if (typeof window.addCustomAliment === 'function') {
      const per100 = totalsToPer100(normalized);
      window.addCustomAliment({
        nom: normalized.nom,
        defaut: normalized.qty,
        kcal100: per100.kcal100,
        prot100: per100.prot100,
        gluc100: per100.gluc100,
        lip100: per100.lip100,
        bddId: null,
        source: item.source || 'Groq Vision',
        meal: state.targetMeal || window.foodAddTargetMeal || 'lunch',
        saveToBase: item.saveToBase !== false,
        forceNutritionUpdate: true
      });
      afterJournalMutation();
      return;
    }
    if (typeof window.confirmIAItem === 'function') {
      const previous = Array.isArray(window._iaParsed) ? window._iaParsed.slice() : null;
      window._iaParsed = [normalized];
      window.confirmIAItem(0);
      if (previous) window._iaParsed = previous;
      afterJournalMutation();
      return;
    }
    throw new Error('Impossible d’ajouter au journal : confirmIAItem/addCustomAliment introuvable.');
  }

  function asIAParsedItem(item) {
    const qty = clampNumber(item.qty || item.defaut, 100);
    const m = macrosForQty(item, qty);
    return {
      nom: item.nom || item.name || 'Aliment capture',
      qty,
      kcal: Math.round(m.kcal),
      prot: round1(m.prot),
      gluc: round1(m.gluc),
      lip: round1(m.lip)
    };
  }

  function totalsToPer100(item) {
    const qty = clampNumber(item.qty, 100);
    const factor = qty > 0 ? 100 / qty : 1;
    return {
      kcal100: Math.round(clampNumber(item.kcal) * factor),
      prot100: round1(clampNumber(item.prot) * factor),
      gluc100: round1(clampNumber(item.gluc) * factor),
      lip100: round1(clampNumber(item.lip) * factor)
    };
  }

  function afterJournalMutation() {
    try { if (typeof window.showSaveStatus === 'function') window.showSaveStatus('Ajouté via Capture'); } catch (e) {}
    setTimeout(() => {
      try { if (typeof window.autoSaveToday === 'function') window.autoSaveToday(300); } catch (e) {}
    }, 0);
  }

  function injectLauncher() {
    if ($('#foodnote-capture-launcher')) return;
    const journal = $('#page-journal') || $('.journal-premium-page') || document.body;
    if (!journal) return;
    const target = $('.journal-card-head', journal) || $('.journal-hero', journal) || journal.firstElementChild || journal;
    const card = document.createElement('div');
    card.id = 'foodnote-capture-launcher';
    card.className = 'capture-launcher card';
    card.innerHTML = `
      <div class="capture-launcher-head">
        <div><strong>Capture alimentaire</strong><small>Moteur central : recherche, code-barres, photo, OCR, recette, IA.</small></div>
        <span class="capture-version">0.22.179</span>
      </div>
      <div class="capture-launcher-actions">
        <button data-capture-mode="${MODES.SEARCH}">🔎 Rechercher</button>
        <button data-capture-mode="${MODES.BARCODE}">🏷️ Code-barres</button>
        <button data-capture-mode="${MODES.PHOTO_FOOD}">📷 Photo plat</button>
        <button data-capture-mode="${MODES.NUTRITION_TABLE}">📊 Tableau</button>
        <button data-capture-mode="${MODES.RECIPE}">🍲 Recette</button>
        <button data-capture-mode="${MODES.IA_TEXT}">⚡ IA texte</button>
      </div>`;
    if (target && target.parentNode) target.parentNode.insertBefore(card, target.nextSibling);
    else journal.prepend(card);
  }

  function wrapLegacyFunctions() {
    if (MODAL_CONTROLLER_OWNS_POPUP) return;
    const routes = {
      openFoodCapture: MODES.SEARCH,
      openFoodAddTools: MODES.SEARCH,
      openAddFoodTools: MODES.SEARCH,
      startBarcodeScan: MODES.BARCODE,
      toggleBarcodeScanner: MODES.BARCODE,
      openFoodBarcodeFromPhoto: MODES.BARCODE,
      openBarcodeScan: MODES.BARCODE,
      openBarcodeScanner: MODES.BARCODE,
      scanBarcode: MODES.BARCODE,
      startFoodCamera: MODES.PHOTO_FOOD,
      openFoodPhotoOption: MODES.BARCODE,
      openFoodRecipePhotoOption: MODES.RECIPE,
      startNutritionOCRCamera: MODES.NUTRITION_TABLE,
      openFoodCamera: MODES.PHOTO_FOOD,
      openCameraCapture: MODES.PHOTO_FOOD,
      openPhotoOCR: MODES.NUTRITION_TABLE,
      startPhotoOCR: MODES.NUTRITION_TABLE,
      openNutritionTableOCR: MODES.NUTRITION_TABLE,
      analyzeNutritionTable: MODES.NUTRITION_TABLE,
      openRecipeOCR: MODES.RECIPE,
      analyzeRecipePhoto: MODES.RECIPE,
      startRecipeCapture: MODES.RECIPE
    };
    Object.keys(routes).forEach(name => {
      if (state.wrapped.has(name)) return;
      const original = window[name];
      if (typeof original !== 'function') return;
      window['__foodnote_legacy_' + name] = original;
      window[name] = function captureWorkflowBridge() {
        console.debug('[FoodNoteCapture] ancien flux intercepté:', name);
        open(routes[name]);
        return false;
      };
      state.wrapped.add(name);
    });
  }

  function wrapFoodAddUX() {
    if (MODAL_CONTROLLER_OWNS_POPUP) return;
    const ux = window.FoodNoteFoodAddUX1513 || window.FoodNoteFoodAddUX1512 || window.FoodNoteFoodAddUX1511;
    if (!ux || ux.__captureWorkflowWrapped) return;
    const map = {
      openProductPhoto: MODES.NUTRITION_TABLE,
      startNutritionTableScan: MODES.NUTRITION_TABLE,
      openPlatePhoto: MODES.PHOTO_FOOD,
      startPlateCamera: MODES.PHOTO_FOOD,
      startBarcodeScan: MODES.BARCODE,
      focusEstimateText: MODES.IA_TEXT,
      scanRecipe: MODES.RECIPE
    };
    Object.keys(map).forEach(name => {
      if (typeof ux[name] !== 'function') return;
      const original = ux[name];
      ux['__legacy_' + name] = original;
      ux[name] = function captureUxBridge() {
        console.debug('[FoodNoteCapture] action popup interceptée:', name);
        try { if (typeof window.closeFoodAddModal === 'function') window.closeFoodAddModal(); } catch (e) {}
        open(map[name]);
        return false;
      };
    });
    ux.__captureWorkflowWrapped = true;
  }


  function openForMeal(mode, meal) {
    closeMealQuickAddBubble();
    return open({ mode: mode || MODES.SEARCH, meal: normalizeCaptureMeal(meal), skipMealSelect: true, fromMealButton: true });
  }

  function mealLabelForBubble(meal) {
    const m = normalizeCaptureMeal(meal);
    if (m === 'breakfast') return 'Petit-déj';
    if (m === 'dinner') return 'Dîner';
    if (m === 'snack') return 'Collation';
    return 'Déjeuner';
  }

  function closeMealQuickAddBubble() {
    const old = document.getElementById('foodnote-meal-quick-add-bubble');
    if (old) old.remove();
  }

  function openMealQuickAddBubble(meal, anchor) {
    const targetMeal = normalizeCaptureMeal(meal);
    const existing = document.getElementById('foodnote-meal-quick-add-bubble');
    if (existing && existing.dataset.meal === targetMeal) {
      existing.remove();
      return false;
    }
    closeMealQuickAddBubble();
    const bubble = document.createElement('div');
    bubble.id = 'foodnote-meal-quick-add-bubble';
    bubble.className = 'meal-quick-add-bubble';
    bubble.dataset.meal = targetMeal;
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-label', 'Ajouter au ' + mealLabelForBubble(targetMeal));
    bubble.innerHTML = `
      <div class="meal-quick-add-pointer" aria-hidden="true"></div>
      <div class="meal-quick-add-head">
        <div class="meal-quick-add-title">
          <span class="meal-quick-add-meal-icon" aria-hidden="true">+</span>
          <div>
            <strong>Ajouter au ${escapeHtml(mealLabelForBubble(targetMeal))}</strong>
            <small>Choisis une méthode, le repas est déjà sélectionné.</small>
          </div>
        </div>
        <button type="button" class="meal-quick-add-close" data-meal-quick-close="1" aria-label="Fermer">×</button>
      </div>
      <div class="meal-quick-add-grid">
        <button type="button" class="meal-quick-add-item" data-meal-quick-mode="${MODES.SEARCH}"><span>🔎</span><b>Rechercher</b><small>Base / CIQUAL / OpenFoodFacts</small></button>
        <button type="button" class="meal-quick-add-item" data-meal-quick-mode="${MODES.BARCODE}"><span>🏷️</span><b>Code-barres</b><small>Produit emballé</small></button>
        <button type="button" class="meal-quick-add-item" data-meal-quick-mode="${MODES.PHOTO_FOOD}"><span>📷</span><b>Photo plat</b><small>Estimation IA</small></button>
        <button type="button" class="meal-quick-add-item" data-meal-quick-mode="${MODES.NUTRITION_TABLE}"><span>📊</span><b>Tableau</b><small>Étiquette nutrition</small></button>
        <button type="button" class="meal-quick-add-item" data-meal-quick-mode="${MODES.RECIPE}"><span>🍲</span><b>Recette</b><small>Plat complet</small></button>
        <button type="button" class="meal-quick-add-item" data-meal-quick-mode="${MODES.IA_TEXT}"><span>⚡</span><b>IA texte</b><small>Coller un repas</small></button>
      </div>`;
    document.body.appendChild(bubble);

    const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const width = Math.min(360, Math.max(300, window.innerWidth - 24));
    bubble.style.width = width + 'px';
    let left = rect ? rect.left + rect.width / 2 - width / 2 : (window.innerWidth - width) / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    let top = rect ? rect.bottom + 12 : 120;
    let placement = 'below';
    const estimatedHeight = 318;
    const maxTop = Math.max(12, window.innerHeight - estimatedHeight - 12);
    if (top > maxTop && rect) {
      top = Math.max(12, rect.top - estimatedHeight - 12);
      placement = 'above';
    }
    bubble.dataset.placement = placement;
    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
    if (rect) {
      const arrowX = Math.max(28, Math.min(width - 28, rect.left + rect.width / 2 - left));
      bubble.style.setProperty('--meal-bubble-arrow-x', Math.round(arrowX) + 'px');
    }

    bubble.addEventListener('click', (ev) => {
      const closeBtn = ev.target.closest('[data-meal-quick-close]');
      if (closeBtn) {
        ev.preventDefault(); ev.stopPropagation(); closeMealQuickAddBubble(); return;
      }
      const btn = ev.target.closest('[data-meal-quick-mode]');
      if (!btn) return;
      ev.preventDefault(); ev.stopPropagation();
      openForMeal(btn.getAttribute('data-meal-quick-mode'), targetMeal);
    }, true);

    setTimeout(() => {
      const outside = (ev) => {
        const b = document.getElementById('foodnote-meal-quick-add-bubble');
        if (!b) { document.removeEventListener('pointerdown', outside, true); return; }
        if (b.contains(ev.target) || (anchor && anchor.contains && anchor.contains(ev.target))) return;
        closeMealQuickAddBubble();
        document.removeEventListener('pointerdown', outside, true);
      };
      document.addEventListener('pointerdown', outside, true);
    }, 0);
    return false;
  }

  function installMutationGuard() {
    // 0.22.135 : garde du fix freeze 0.22.119, observer toujours désactivé.
    // L'ancien observer surveillait tout document.documentElement (subtree + class/style).
    // Pendant l'ajout au journal, FoodNote modifie beaucoup de lignes/classes :
    // l'observer se déclenchait en rafale et pouvait figer l'UI.
    // Les panneaux legacy sont déjà fermés explicitement à l'ouverture/fermeture du workflow.
    return null;
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    ensureModal();
    bindEvents();
    injectLauncher();
    wrapLegacyFunctions();
    wrapFoodAddUX();
    installMutationGuard();
    setTimeout(() => { wrapLegacyFunctions(); wrapFoodAddUX(); }, 500);
    setTimeout(() => { wrapLegacyFunctions(); wrapFoodAddUX(); }, 1800);
    window.addEventListener('foodnote:deferred-ready', () => { wrapLegacyFunctions(); wrapFoodAddUX(); injectLauncher(); });
    setTimeout(injectLauncher, 800);
    console.info('[FoodNoteCapture] chargé', VERSION);
  }

  window.FoodNoteCapture = {
    version: VERSION,
    STATES,
    MODES,
    get state() { return { ...state, stream: !!state.stream, video: !!state.video }; },
    open,
    openForMeal,
    close,
    openPicker,
    transition,
    fail,
    install,
    restartCurrent,
    wrapLegacyFunctions,
    wrapFoodAddUX
  };

  window.openFoodNoteCapture = openPicker;
  window.openFoodNoteCaptureForMeal = openForMeal;
  window.openMealQuickAddBubble = openMealQuickAddBubble;
  window.closeMealQuickAddBubble = closeMealQuickAddBubble;
  window.captureWorkflowSetState = transition;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
