/*
 * FoodNote — domaine du popup Ajouter.
 * Rôle : valider et préparer les ajouts alimentaires issus du popup.
 * Gère : garde-fous anti-double-ajout, repas cible, confirmation quantité et ponts de sauvegarde.
 * Ne doit pas gérer : rendu global, thèmes CSS, import CIQUAL/OpenFoodFacts ni accès SQLite bas niveau.
 */
(function FoodNoteFoodAddDomainCore(){
  'use strict';

  const VERSION = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const originals = Object.create(null);
  const locks = Object.create(null);
  const runtime = { blockedActions: 0, lastAction:'', lastError:'' };
  const installedAt = Date.now();
  const MEALS = new Set(['breakfast', 'lunch', 'dinner']);

  const $ = (id) => document.getElementById(id);
  const q = (sel, root = document) => root.querySelector(sel);
  const now = () => Date.now();


  function withLock(key, kind, task, ms = 1300){
    const id = String(key || 'domain');
    const until = Number(locks[id] || 0);
    if (until && until > now()) {
      runtime.blockedActions += 1;
      status(kind || 'domain', 'Action déjà en cours…', false);
      return null;
    }
    locks[id] = now() + Math.max(400, Number(ms) || 1300);
    runtime.lastAction = id;
    runtime.lastError = '';
    try { return task(); }
    catch(e) {
      runtime.lastError = e && e.message ? e.message : String(e);
      throw e;
    }
    finally {
      setTimeout(() => {
        if (Number(locks[id] || 0) <= now()) delete locks[id];
      }, Math.max(420, Number(ms) || 1300) + 40);
    }
  }

  function esc(s){
    try { if (typeof window.escapeHtml === 'function') return window.escapeHtml(s); } catch(e) {}
    return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function num(value, fallback = 0){
    const n = parseFloat(String(value ?? '').replace(',', '.').replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  }

  function round1(value){
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  function normalizeText(s){
    try { if (typeof window.normalizeSearchText === 'function') return window.normalizeSearchText(s); } catch(e) {}
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function safeCall(name, args = [], fallback){
    const fn = window[name];
    if (typeof fn !== 'function') return fallback;
    try { return fn.apply(window, args); }
    catch(e) { console.warn('[FoodAddDomain] action impossible:', name, e); return fallback; }
  }

  function status(kind, message, isError = false){
    const msg = String(message || '');
    if (kind === 'recipe') {
      if (typeof window.recipeSetStatus === 'function') {
        try { window.recipeSetStatus(msg, !!isError); return; } catch(e) {}
      }
      const el = $('recipe-ai-status') || $('ia-parse-status');
      if (el) { el.textContent = msg; el.classList.toggle('error', !!isError); }
      return;
    }
    if (kind === 'barcode') {
      if (typeof window.setBarcodeStatus === 'function') {
        try { window.setBarcodeStatus(msg, !!isError); return; } catch(e) {}
      }
      const el = $('barcode-status');
      if (el) { el.innerHTML = esc(msg); el.classList.toggle('error', !!isError); }
      return;
    }
    if (kind === 'ocr') {
      if (typeof window.setOCRStatus === 'function') {
        try { window.setOCRStatus(msg, !!isError); return; } catch(e) {}
      }
      const el = $('ocr-status') || $('ia-parse-status');
      if (el) { el.textContent = msg; el.classList.toggle('error', !!isError); }
      return;
    }
    const el = $('ia-parse-status') || $('ocr-status') || $('barcode-status');
    if (el) { el.textContent = msg; el.classList.toggle('error', !!isError); }
  }

  function selectedMeal(){
    const controllerMeal = window.FoodNoteFoodAddModal && window.FoodNoteFoodAddModal.state && window.FoodNoteFoodAddModal.state.targetMeal;
    if (MEALS.has(controllerMeal)) return controllerMeal;
    const active = q('#food-add-modal .food-meal-chip.active[data-food-meal]');
    const domMeal = active && active.getAttribute('data-food-meal');
    if (MEALS.has(domMeal)) return domMeal;
    try {
      const saved = localStorage.getItem('foodnote_food_add_target_meal');
      if (MEALS.has(saved)) return saved;
    } catch(e) {}
    return 'lunch';
  }

  function selectedQty(){
    const st = searchState();
    try {
      if (typeof window.foodnoteGetLastDBQuantityUserEdit === 'function') {
        const userEditedQty = Number(window.foodnoteGetLastDBQuantityUserEdit());
        if (Number.isFinite(userEditedQty) && userEditedQty > 0) return userEditedQty;
      }
    } catch(e) {}
    try {
      if (typeof window.foodnoteReadFinalDBQuantityFromDOM === 'function') {
        const domQty = Number(window.foodnoteReadFinalDBQuantityFromDOM({ source:'domain-selectedQty' }));
        if (Number.isFinite(domQty) && domQty > 0) return domQty;
      }
    } catch(e) {}
    try {
      if (st && typeof st.getUserQuantity === 'function') {
        const userQty = Number(st.getUserQuantity());
        if (Number.isFinite(userQty) && userQty > 0) return userQty;
      }
    } catch(e) {}
    try {
      const userQty = Number(window.__foodnoteDbQuantityUserValue);
      const touchedAt = Number(window.__foodnoteDbQuantityUserTouchedAt || 0);
      if (Number.isFinite(userQty) && userQty > 0 && touchedAt > 0) return userQty;
    } catch(e) {}
    // 0.22.179 : le champ #db-qty peut être modifié après la sélection,
    // mais il peut aussi rester à 100 pendant qu'un curseur visible vaut 75.
    const candidates = [
      { el:$('db-qty'), value:$('db-qty') && $('db-qty').value },
      { el:$('db-quantity-input'), value:$('db-quantity-input') && $('db-quantity-input').value },
      { el:$('db-quantity-range'), value:$('db-quantity-range') && $('db-quantity-range').value },
      { el:$('db-quantity-panel'), value:$('db-quantity-panel') && $('db-quantity-panel').dataset && $('db-quantity-panel').dataset.foodnoteQuantityValue }
    ].map(c => ({...c, qty:num(c.value, NaN)})).filter(c => Number.isFinite(c.qty) && c.qty > 0);
    const changed = candidates.filter(c => Math.abs(c.qty - 100) >= 0.001);
    const active = document.activeElement;
    const activeCandidate = candidates.find(c => c.el && c.el === active);
    if (activeCandidate) return activeCandidate.qty;
    if (changed.length === 1) return changed[0].qty;
    if (changed.length > 1) {
      return (changed.find(c => c.el && c.el.id === 'db-qty')
        || changed.find(c => c.el && c.el.id === 'db-quantity-input')
        || changed.find(c => c.el && c.el.id === 'db-quantity-range')
        || changed[0]).qty;
    }
    return candidates.length ? candidates[0].qty : 100;
  }


  function normalizeFood(food, defaults = {}){
    const src = Object.assign({}, defaults || {}, food || {});
    const out = {
      id: src.id || Date.now(),
      nom: String(src.nom || src.name || 'Aliment').trim(),
      kcal100: Math.round(num(src.kcal100 ?? src.kcal_100g ?? src.calories_100g)),
      prot100: round1(num(src.prot100 ?? src.proteines100 ?? src.proteins_100g)),
      gluc100: round1(num(src.gluc100 ?? src.glucides100 ?? src.carbohydrates_100g)),
      lip100: round1(num(src.lip100 ?? src.lipides100 ?? src.fat_100g)),
      fibres100: src.fibres100 == null ? undefined : round1(num(src.fibres100)),
      unite: src.unite || 'g',
      source: src.source || defaults.source || 'perso'
    };
    ['code','barcode','marque','meta','recipeWeight','recipeText','poidsUnite','uniteLabel','creation_source','is_ai_estimated','external','bddId'].forEach(k => {
      if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k];
    });
    try {
      if (typeof window.withUnitDefaults === 'function') return window.withUnitDefaults(out);
    } catch(e) {}
    return out;
  }

  function validateFood(food, title){
    if (typeof window.foodnoteValidateFoodBeforeSave !== 'function') return true;
    try { return !!window.foodnoteValidateFoodBeforeSave(food, { title: title || 'Valeur nutritionnelle suspecte' }); }
    catch(e) { return true; }
  }

  function refreshFoodDatabase(){
    // 0.22.118 : après un ajout au journal, ne relance pas les recherches ni le rendu BDD.
    // La BDD complète ne se rend que si la page Bases de données est visible.
    try {
      if (!(Date.now() < Number(window.__foodnoteSuppressDBRefreshUntil || 0))) safeCall('refreshDBSelect');
    } catch(e) { safeCall('refreshDBSelect'); }
    try {
      const basesVisible = !!document.getElementById('page-bases')?.classList.contains('active');
      if (basesVisible) safeCall('renderBDD');
    } catch(e) {}
    try { window.FoodNoteFoodAddModal && window.FoodNoteFoodAddModal.reconcile && window.FoodNoteFoodAddModal.reconcile('domain-refresh'); } catch(e) {}
  }

  let refreshFoodDatabaseTimer = 0;
  function scheduleRefreshFoodDatabase(reason = 'domain-refresh') {
    clearTimeout(refreshFoodDatabaseTimer);
    refreshFoodDatabaseTimer = setTimeout(() => {
      try { refreshFoodDatabase(); } catch(e) { console.warn('[FoodAddDomain] refresh différé impossible', reason, e); }
    }, 650);
  }

  function getBDDList(){
    const bdd = safeCall('getBDD', [], []);
    return Array.isArray(bdd) ? bdd : [];
  }

  function saveBDDList(list){
    safeCall('saveBDD', [Array.isArray(list) ? list : []]);
  }

  function findPersonalFoodMatch(food, options = {}){
    const normalized = normalizeFood(food, options.defaults || {});
    const bdd = getBDDList();
    const key = normalizeText(normalized.nom);
    const code = String(normalized.code || normalized.barcode || '').trim();
    const idx = bdd.findIndex(item => {
      const itemCode = String(item && (item.code || item.barcode) || '').trim();
      if (options.matchCode !== false && code && itemCode && itemCode === code) return true;
      return normalizeText(item && item.nom) === key;
    });
    return { normalized, bdd, idx, previous: idx >= 0 ? bdd[idx] : null };
  }

  function upsertPersonalFood(food, options = {}){
    const match = findPersonalFoodMatch(food, options);
    const normalized = match.normalized;
    if (!normalized.nom) throw new Error('Nom de l’aliment manquant.');
    if (!validateFood(normalized, options.validationTitle)) return null;

    const bdd = match.bdd;
    const previous = match.previous;
    const saved = Object.assign({}, previous || {}, normalized, {
      id: previous && previous.id ? previous.id : (normalized.id || Date.now())
    });

    if (match.idx >= 0) bdd[match.idx] = saved;
    else bdd.unshift(saved);

    saveBDDList(bdd);
    scheduleRefreshFoodDatabase('upsert-personal-food');
    return { food: saved, id: saved.id, existed: match.idx >= 0 };
  }

  function reservePersonalFoodId(food, options = {}){
    try {
      const match = findPersonalFoodMatch(food, options);
      if (match.previous && match.previous.id) return { id: match.previous.id, existed:true, normalized: match.normalized };
      return { id: match.normalized.id || Date.now(), existed:false, normalized: match.normalized };
    } catch(e) {
      return { id: (food && (food.id || food.bddId)) || Date.now(), existed:false, normalized: normalizeFood(food || {}) };
    }
  }

  function schedulePersonalFoodUpsert(food, options = {}, delay = 900){
    setTimeout(() => {
      try { upsertPersonalFood(food, options); }
      catch(e) { console.warn('[FoodAddDomain] sauvegarde aliment externe différée impossible', e); }
    }, Math.max(250, Number(delay) || 900));
  }

  function addFoodToDay(food, options = {}){
    const qty = Math.max(1, num(options.qty ?? selectedQty(), 100));
    const meal = MEALS.has(options.meal) ? options.meal : selectedMeal();
    const explicitBddId = Object.prototype.hasOwnProperty.call(options, 'bddId')
      ? options.bddId
      : (food?.bddId || food?.id || null);
    const payload = Object.assign({}, food || {}, {
      defaut: qty,
      meal,
      bddId: explicitBddId
    });
    if (typeof window.addCustomAliment !== 'function') throw new Error('Ajout au journal indisponible.');
    try {
      const until = Date.now() + 2400;
      window.__foodnoteJournalAddCriticalUntil = until;
      window.__foodnoteSuppressDBRefreshUntil = Math.max(Number(window.__foodnoteSuppressDBRefreshUntil || 0), until);
    } catch(e) {}
    window.addCustomAliment(payload);
    try { window.FoodNoteFoodAddModal && window.FoodNoteFoodAddModal.notifySaved && window.FoodNoteFoodAddModal.notifySaved(); } catch(e) {}
    return payload;
  }

  function closeModalAfterSave(delay = 160){
    setTimeout(() => {
      try {
        if (window.FoodNoteFoodAddModal && typeof window.FoodNoteFoodAddModal.close === 'function') window.FoodNoteFoodAddModal.close();
        else if (typeof window.closeFoodAddModal === 'function') window.closeFoodAddModal();
      } catch(e) {}
    }, Math.max(0, Number(delay) || 0));
  }

  function readOCRFoodPayload(){
    const value = (id) => $(id)?.value;
    const name = String(value('ocr-food-name') || '').trim();
    if (!name) throw new Error('Nom de l’aliment manquant.');
    return normalizeFood({
      id: Date.now(),
      nom: name,
      kcal100: num(value('ocr-kcal')),
      prot100: num(value('ocr-prot')),
      gluc100: num(value('ocr-gluc')),
      lip100: num(value('ocr-lip')),
      fibres100: num(value('ocr-fibres')),
      unite: 'g',
      source: 'ocr'
    });
  }

  function saveOCRFood(addToDay){
    return withLock(addToDay ? 'ocr-add-day' : 'ocr-save', 'ocr', () => {
      try {
        const food = readOCRFoodPayload();
      const saved = upsertPersonalFood(food, { validationTitle:'OCR : valeur nutritionnelle suspecte' });
      if (!saved) return null;
      if (addToDay) {
        addFoodToDay(saved.food, { bddId: saved.id });
        status('ocr', '✅ Aliment OCR ajouté à la journée.', false);
        closeModalAfterSave(140);
      } else {
        status('ocr', saved.existed ? '✅ Aliment OCR mis à jour dans ta base.' : '✅ Aliment OCR ajouté à ta base.', false);
      }
      return saved.id;
      } catch(e) {
        status('ocr', e && e.message ? e.message : e, true);
        return null;
      }
    }, 1400);
  }

  function readRecipeFoodPayload(){
    const value = (id) => $(id)?.value;
    const name = String(value('recipe-food-name') || '').trim();
    if (!name) throw new Error('Nom du plat manquant.');
    return normalizeFood({
      id: Date.now(),
      nom: name,
      kcal100: num(value('recipe-kcal')),
      prot100: num(value('recipe-prot')),
      gluc100: num(value('recipe-gluc')),
      lip100: num(value('recipe-lip')),
      unite: 'g',
      source: 'recette_ia',
      recipeWeight: Math.round(num(value('recipe-weight'))) || null,
      recipeText: String($('recipe-ocr-text')?.value || '').trim(),
      is_ai_estimated: true
    });
  }

  function saveRecipeFood(addToDay){
    return withLock(addToDay ? 'recipe-add-day' : 'recipe-save', 'recipe', () => {
      try {
        const food = readRecipeFoodPayload();
      const saved = upsertPersonalFood(food, { validationTitle:'Recette IA : valeur nutritionnelle suspecte' });
      if (!saved) return null;
      if (addToDay) {
        addFoodToDay(saved.food, { bddId: saved.id });
        status('recipe', '✅ Plat estimé ajouté à la journée.', false);
        closeModalAfterSave(180);
      } else {
        status('recipe', saved.existed ? '✅ Plat estimé mis à jour dans ta base.' : '✅ Plat estimé créé dans ta base.', false);
      }
      return saved.id;
      } catch(e) {
        status('recipe', e && e.message ? e.message : e, true);
        return null;
      }
    }, 1500);
  }

  function getBarcodeProduct(){
    try {
      const state = window.FoodNoteBarcodeFlowState;
      if (state && state.lastProduct) return state.lastProduct;
    } catch(e) {}
    try { if (window.FoodNoteBarcodeLastProduct) return window.FoodNoteBarcodeLastProduct; } catch(e) {}
    return null;
  }

  function barcodeFoodForSave(food){
    const src = food || getBarcodeProduct();
    if (!src) throw new Error('Aucun produit code-barres à sauvegarder.');
    let unitWeight = null;
    try { if (typeof window.saneUnitWeightForFood === 'function') unitWeight = window.saneUnitWeightForFood(src) || null; } catch(e) {}
    return normalizeFood({
      nom: src.nom,
      kcal100: src.kcal100,
      prot100: src.prot100,
      gluc100: src.gluc100,
      lip100: src.lip100,
      unite: src.unite || 'g',
      poidsUnite: unitWeight,
      uniteLabel: src.uniteLabel || '',
      source: 'off',
      code: src.code || '',
      barcode: src.code || src.barcode || '',
      marque: src.marque || src.meta || '',
      meta: src.meta || src.marque || ''
    });
  }

  function saveBarcodeProduct(){
    return withLock('barcode-save', 'barcode', () => {
      try {
        const product = getBarcodeProduct();
      if (!product) throw new Error('Aucun produit OpenFoodFacts sélectionné.');
      const food = barcodeFoodForSave(product);
      const saved = upsertPersonalFood(food, { matchCode:true, validationTitle:'OpenFoodFacts : valeur nutritionnelle suspecte' });
      if (!saved) return null;
      status('barcode', saved.existed ? 'ℹ️ Produit déjà présent / mis à jour dans Mes aliments.' : '✅ Produit ajouté à Mes aliments.', false);
      return saved.id;
      } catch(e) {
        status('barcode', e && e.message ? e.message : e, true);
        return null;
      }
    }, 1300);
  }

  function addBarcodeProductToDay(){
    return withLock('barcode-add-day', 'barcode', () => {
      try {
        const product = getBarcodeProduct();
      if (!product) throw new Error('Aucun produit OpenFoodFacts sélectionné.');
      const food = barcodeFoodForSave(product);
      const savedId = saveBarcodeProduct();
      addFoodToDay(Object.assign({}, food, { id: savedId || food.id }), { bddId: savedId || food.id });
      status('barcode', '✅ Produit code-barres ajouté à la journée.', false);
      closeModalAfterSave(220);
      return savedId;
      } catch(e) {
        status('barcode', e && e.message ? e.message : e, true);
        return null;
      }
    }, 1600);
  }

  function searchState(){
    return window.FoodNoteFoodAddSearchState || null;
  }

  function readTypedSearchName(){
    return String(($('db-search') && $('db-search').value) || '').trim();
  }

  function clearSearchUi(message){
    const suggestions = $('db-suggestions');
    if (suggestions) {
      suggestions.innerHTML = '';
      suggestions.classList.remove('visible');
      suggestions.setAttribute('aria-hidden', 'true');
    }
    const input = $('db-search');
    if (input) input.value = '';
    const hidden = $('db-selected-id');
    if (hidden) hidden.value = '';
    const st = searchState();
    if (st && typeof st.clearSelection === 'function') {
      try { st.clearSelection(); } catch(e) {}
    } else if (typeof window.updateDBSelectedCard === 'function') {
      try { window.updateDBSelectedCard(null); } catch(e) {}
    }
    safeCall('setFoodAddExpanded', [false]);
    if (message && typeof window.resetFoodAddSearchAfterAdd === 'function') {
      try { window.resetFoodAddSearchAfterAdd(message); } catch(e) {}
    }
  }

  function prepareTypedSearchFood(){
    return withLock('search-typed-add', 'search', () => {
      const name = readTypedSearchName();
      if (!name) return null;
      const qty = selectedQty();
      const food = normalizeFood({
        nom: name,
        defaut: qty,
        kcal100: 0,
        prot100: 0,
        gluc100: 0,
        lip100: 0,
        bddId: null,
        source: 'manuel'
      });
      addFoodToDay(food, { qty, bddId:null, meal: selectedMeal() });
      safeCall('resetFoodAddGroqVisualState');
      safeCall('showSaveStatus', ['Aliment ajouté. Clique sur Groq seulement si tu veux estimer.', false]);
      clearSearchUi(`✓ ${name} ajouté. Choisis le suivant.`);
      return food;
    }, 900);
  }

  function addFromSearch(){
    return withLock('search-main-action', 'search', () => {
      if (typeof window.isDBQuantitySelectorOpen === 'function' && window.isDBQuantitySelectorOpen()) {
        return safeCall('confirmDBQuantitySelection');
      }
      const st = searchState();
      const selected = st && st.selectedFood ? st.selectedFood : null;
      if (!selected) {
        if (readTypedSearchName()) return prepareTypedSearchFood();
        return null;
      }
      const prepared = normalizeFood(selected, { source: selected.source || 'base' });
      if (typeof window.openDBQuantitySelector === 'function') {
        return window.openDBQuantitySelector(prepared, {
          source: prepared.source || 'base',
          external: !!prepared.external,
          bddId: prepared.bddId || prepared.id || null
        });
      }
      return addFoodToDay(prepared, { qty: selectedQty(), bddId: prepared.bddId || prepared.id || null, meal: selectedMeal() });
    }, 700);
  }

  function readQuantitySelection(){
    const st = searchState();
    const food = st && st.quantityFood ? st.quantityFood : null;
    if (!food) throw new Error('Aucun aliment en attente de quantité.');
    const meta = st && st.quantityMeta ? st.quantityMeta : {};
    const domQty = selectedQty();
    let qty = domQty;
    if (st && typeof st.readQuantity === 'function') {
      const n = Number(st.readQuantity());
      if (Number.isFinite(n) && n > 0) {
        // 0.22.179 : le pont readQuantity() lit maintenant le DOM final visible
        // et doit passer devant une mémoire utilisateur possiblement ancienne.
        qty = n;
      } else {
        const userQty = (typeof st.getUserQuantity === 'function') ? Number(st.getUserQuantity()) : NaN;
        if (Number.isFinite(userQty) && userQty > 0) qty = userQty;
      }
    }
    const prepared = normalizeFood(food, { source: food.source || meta.source || 'base' });
    return { food: prepared, meta, qty };
  }

  function clearQuantityAfterAdd(name){
    const st = searchState();
    const message = `✓ ${name || 'Aliment'} ajouté. Choisis le suivant.`;
    if (st && typeof st.clearAfterAdd === 'function') {
      try { st.clearAfterAdd(message); return; } catch(e) {}
    }
    clearSearchUi(message);
  }

  function confirmQuantitySelection(){
    return withLock('quantity-confirm', 'search', () => {
      window.FoodNoteFoodAddDomain.__confirmingQuantity = true;
      try {
        const selection = readQuantitySelection();
        const prepared = selection.food;
        const meta = selection.meta || {};
        const isExternal = !!(meta.external || prepared.external || (prepared.source && prepared.source !== 'base'));
        let bddId = Object.prototype.hasOwnProperty.call(meta, 'bddId') ? meta.bddId : (prepared.bddId || prepared.id || null);

        if (isExternal) {
          // 0.22.118 : ne plus normaliser/sauvegarder toute la base aliments avant
          // l'ajout journal. On réserve un id stable, on ajoute la ligne, puis
          // la fiche personnelle est enregistrée hors du clic.
          const reserved = reservePersonalFoodId(prepared, { matchCode:true });
          bddId = reserved.id;
          prepared.id = reserved.id;
          schedulePersonalFoodUpsert(prepared, { matchCode:true, validationTitle:'Aliment externe : valeur nutritionnelle suspecte' }, 950);
        }

        addFoodToDay(prepared, { qty: selection.qty, bddId, meal: selectedMeal() });
        clearQuantityAfterAdd(prepared.nom);
        return { food: prepared, qty: selection.qty, bddId };
      } catch(e) {
        status('search', e && e.message ? e.message : e, true);
        return null;
      } finally {
        window.FoodNoteFoodAddDomain.__confirmingQuantity = false;
      }
    }, 1100);
  }


  function bindOriginal(name){
    if (!originals[name] && typeof window[name] === 'function') originals[name] = window[name];
  }

  function expose(name, fn){
    bindOriginal(name);
    fn.__fnFoodAddDomainWrapped = true;
    fn.__fnFoodAddDomainOriginal = originals[name] || null;
    window[name] = fn;
  }

  function install(){
    expose('getOCRFoodPayload', readOCRFoodPayload);
    expose('saveOCRFoodToBDD', function domainSaveOCRFoodToBDD(addToDay){ return saveOCRFood(!!addToDay); });
    expose('getRecipeFoodPayload', readRecipeFoodPayload);
    expose('saveRecipeFoodToBDD', function domainSaveRecipeFoodToBDD(addToDay){ return saveRecipeFood(!!addToDay); });
    expose('barcodeFoodForSave', barcodeFoodForSave);
    expose('saveBarcodeProductToBDD', function domainSaveBarcodeProductToBDD(){ return saveBarcodeProduct(); });
    expose('addBarcodeProductToDay', function domainAddBarcodeProductToDay(){ return addBarcodeProductToDay(); });
    expose('confirmDBQuantitySelection', function domainConfirmDBQuantitySelection(){ return confirmQuantitySelection(); });
    try { window.dispatchEvent(new CustomEvent('foodnote:food-add-domain:ready', { detail: audit() })); } catch(e) {}
    console.info('[FoodAddDomain] chargé', VERSION);
  }

  function collectIssues(){
    const issues = [];
    if (typeof window.getBDD !== 'function' || typeof window.saveBDD !== 'function') issues.push('bdd_api_missing');
    if (typeof window.addCustomAliment !== 'function') issues.push('journal_add_missing');
    if (!window.FoodNoteFoodAddSearchState) issues.push('search_state_bridge_missing');
    else if (typeof window.FoodNoteFoodAddSearchState.readQuantity !== 'function') issues.push('quantity_bridge_missing');
    if (Object.keys(locks || {}).length > 2) issues.push('multiple_domain_locks');
    return issues;
  }

  function audit(){
    return {
      version: VERSION,
      installedAt,
      wrappedFunctions: Object.keys(originals).sort(),
      hasModalController: !!window.FoodNoteFoodAddModal,
      selectedMeal: selectedMeal(),
      selectedQty: selectedQty(),
      searchState: searchState() && typeof searchState().snapshot === 'function' ? searchState().snapshot() : null,
      hasQuantityBridge: !!(searchState() && typeof searchState().readQuantity === 'function'),
      hasBarcodeProduct: !!getBarcodeProduct(),
      hasBDD: typeof window.getBDD === 'function' && typeof window.saveBDD === 'function',
      hasJournalAdd: typeof window.addCustomAliment === 'function',
      blockedActions: runtime.blockedActions,
      lastAction: runtime.lastAction,
      lastError: runtime.lastError,
      activeLocks: Object.keys(locks || {}).length,
      issues: collectIssues()
    };
  }

  window.FoodNoteFoodAddDomain = {
    version: VERSION,
    selectedMeal,
    selectedQty,
    normalizeFood,
    validateFood,
    upsertPersonalFood,
    addFoodToDay,
    searchState,
    prepareTypedSearchFood,
    addFromSearch,
    readQuantitySelection,
    confirmQuantitySelection,
    readOCRFoodPayload,
    saveOCRFood,
    readRecipeFoodPayload,
    saveRecipeFood,
    getBarcodeProduct,
    barcodeFoodForSave,
    saveBarcodeProduct,
    addBarcodeProductToDay,
    refreshFoodDatabase,
    status,
    audit,
    health: audit,
    install
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
