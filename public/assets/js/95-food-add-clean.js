/* FoodNote 0.18.1 — ajout alimentaire propre consolidé
   Objectifs :
   - remplacer le mode Mémoire rapide par des Suggestions rapides compactes ;
   - garder un seul popup Ajouter, centré, desktop/mobile ;
   - un seul scroll interne ;
   - résultat IA dans le même popup ;
   - séparer clairement Rechercher / Estimer / Recette sans doublons.
*/
(function(){
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const $ = (id) => document.getElementById(id);
  const q = (sel, root=document) => root.querySelector(sel);
  const MODAL_CONTROLLER_OWNS_POPUP = !!window.__FoodNoteFoodAddModalControllerOwnsPopup;
  const qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const MEAL_LABELS = {
    breakfast: { icon:'☕', full:'Petit-déj', short:'Matin' },
    lunch: { icon:'🍽', full:'Déjeuner', short:'Midi' },
    dinner: { icon:'🌙', full:'Dîner', short:'Soir' }
  };
  let currentIntent = 'search';
  let suggestionTab = 'meal';
  let originalOpenFoodAddModal = null;
  let originalSetFoodAddMode = null;
  let originalHandleDBSearchInput = null;
  let originalEstimerGroq = null;
  let originalImporterGroq = null;
  let originalParseIAPaste = null;
  let suppressFocusUntil = 0;
  let suggestionsDismissed = false;
  let initialized = false;
  let renderSuggestionsTimer = null;
  let renderSuggestionsToken = 0;
  let popupOpenToken = 0;
  let popupRefreshTimer = null;
  let entryFoodsCacheSignature = '';
  let entryFoodsCacheRows = null;
  let confirmStateTimer = null;
  let confirmStateObserver = null;
  let activeWorkflow = '';
  let activeWorkflowUntil = 0;
  let originalOpenFoodRecipePhotoOption = null;
  let originalProcessRecipeOCRImage = null;
  let originalCloseFoodAddModal = null;

  function runAfterPaint(fn){
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { try { fn(); } catch(e) {} });
    else setTimeout(() => { try { fn(); } catch(e) {} }, 0);
  }

  function runWhenIdle(fn, timeout = 700){
    // On évite requestIdleCallback pour les tâches UI visibles : sur mobile/WebView,
    // un callback idle peut tout de même monopoliser le thread et créer des saccades.
    const delay = Math.max(0, Math.min(Number(timeout) || 0, 180));
    setTimeout(() => runAfterPaint(fn), delay);
  }


  function quantityFlowActive(){
    try {
      if (typeof window.foodnoteIsDBQuantityFlowActive === 'function' && window.foodnoteIsDBQuantityFlowActive()) return true;
      return !!document.querySelector('#food-add-modal.food-quantity-open #db-quantity-panel.visible');
    } catch(e) { return false; }
  }
  function scheduleRenderSuggestions(delay = 90){
    if (workflowActive()) return;
    const token = ++renderSuggestionsToken;
    clearTimeout(renderSuggestionsTimer);
    renderSuggestionsTimer = setTimeout(() => {
      runWhenIdle(() => {
        if (token !== renderSuggestionsToken) return;
        if (!modalIsOpen() || quantityFlowActive() || workflowActive()) return;
        renderSuggestions();
      }, 900);
    }, Math.max(0, Number(delay) || 0));
  }

  function schedulePopupRefresh(reason = 'ui', delay = 70){
    const token = popupOpenToken;
    clearTimeout(popupRefreshTimer);
    popupRefreshTimer = setTimeout(() => {
      runWhenIdle(() => {
        if (token !== popupOpenToken || !modalIsOpen()) return;
        if (workflowActive()) currentIntent = 'estimate';
        ensureUI();
        applyIntentOnly();
        relabelMealButtons();
        updateMealContextUI();
        // 0.22.118 : après un clic Ajouter, ne relance pas immédiatement le bloc
        // suggestions / contexte repas. Il peut recalculer l'historique et rerendre
        // le popup au moment exact où le journal sauvegarde la nouvelle ligne.
        if (!quantityFlowActive() && reason !== 'main-action') scheduleRenderSuggestions(reason === 'open' ? 160 : 90);
      }, 900);
    }, Math.max(0, Number(delay) || 0));
  }

  function isTouchDevice(){
    try {
      const ua = navigator.userAgent || '';
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const small = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
      return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (coarse && small);
    } catch(e) { return false; }
  }

  function workflowFromDom(){
    const modal = $('food-add-modal');
    if (!modal) return '';
    const ds = String(modal.dataset.foodnoteWorkflow || '').trim();
    if (ds) return ds;
    if (modal.classList.contains('food-add-recipe-mode') ||
        modal.classList.contains('food-add-recipe-camera') ||
        modal.classList.contains('food-add-recipe-crop') ||
        modal.classList.contains('food-add-recipe-result') ||
        modal.classList.contains('food-add-recipe-processing')) return 'recipe_ocr';
    if (modal.classList.contains('food-add-nutrition-crop')) return 'nutrition_ocr';
    return '';
  }

  function workflowActive(){
    const dom = workflowFromDom();
    if (dom) {
      activeWorkflow = dom;
      activeWorkflowUntil = Math.max(activeWorkflowUntil, Date.now() + 120000);
      return true;
    }
    return !!(activeWorkflow && Date.now() < activeWorkflowUntil);
  }

  function beginWorkflow(name = 'recipe_ocr', ttl = 120000){
    activeWorkflow = String(name || 'recipe_ocr');
    activeWorkflowUntil = Date.now() + Math.max(1000, Number(ttl) || 120000);
    currentIntent = 'estimate';
    clearTimeout(renderSuggestionsTimer);
    hideSuggestions();
    const modal = $('food-add-modal');
    if (modal) {
      modal.dataset.foodnoteWorkflow = activeWorkflow;
      if (activeWorkflow === 'recipe_ocr' && !modal.dataset.foodnoteRecipeStep) modal.dataset.foodnoteRecipeStep = (window.FoodNoteRecipeWorkflow && window.FoodNoteRecipeWorkflow.step) || 'camera';
      modal.classList.remove('food-intent-search', 'food-intent-recipes', 'fn-suggestions-open');
      modal.classList.add('food-intent-estimate');
      if (activeWorkflow === 'recipe_ocr') modal.classList.add('food-add-recipe-mode');
    }
    runAfterPaint(applyIntentOnly);
  }

  function endWorkflow(){
    activeWorkflow = '';
    activeWorkflowUntil = 0;
    try {
      window.FoodNoteRecipeWorkflowActive = false;
      window.FoodNoteRecipeWorkflow = { active:false, name:'recipe_ocr', step:'', updatedAt:Date.now() };
    } catch(e) {}
    const modal = $('food-add-modal');
    if (modal) {
      delete modal.dataset.foodnoteWorkflow;
      delete modal.dataset.foodnoteRecipeStep;
    }
  }

  function syncWorkflowIntent(){
    if (!workflowActive()) return false;
    currentIntent = 'estimate';
    const modal = $('food-add-modal');
    if (modal) {
      modal.classList.remove('food-intent-search', 'food-intent-recipes', 'fn-suggestions-open');
      modal.classList.add('food-intent-estimate', 'food-add-recipe-mode');
    }
    clearTimeout(renderSuggestionsTimer);
    hideSuggestions();
    try {
      if (window.FoodNoteRecipeWorkflowController && typeof window.FoodNoteRecipeWorkflowController.reconcile === 'function') {
        window.FoodNoteRecipeWorkflowController.reconcile('add-v0160-sync');
      }
    } catch(e) {}
    return true;
  }

  function esc(s){
    try { if (typeof escapeHtml === 'function') return escapeHtml(s); } catch(e) {}
    return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function normalize(s){
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function currentMeal(){
    const active = q('#food-add-modal .food-meal-chip.active[data-food-meal]');
    const v = active && active.getAttribute('data-food-meal');
    return (v === 'breakfast' || v === 'lunch' || v === 'dinner') ? v : 'lunch';
  }

  function mealMeta(id){
    const map = {
      breakfast: { id:'breakfast', icon:'☕', label:'Petit-déj', title:'petit-déj' },
      lunch: { id:'lunch', icon:'🍽', label:'Déjeuner', title:'déjeuner' },
      dinner: { id:'dinner', icon:'🌙', label:'Dîner', title:'dîner' }
    };
    return map[id] || map.lunch;
  }

  function currentMealFromState(){
    const meal = currentMeal();
    if (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner') return meal;
    try {
      const saved = localStorage.getItem('foodnote_food_add_target_meal');
      if (saved === 'breakfast' || saved === 'lunch' || saved === 'dinner') return saved;
    } catch(e) {}
    return 'lunch';
  }

  function currentMealItemCount(){
    const meal = currentMealFromState();
    try {
      if (typeof window.getCurrentMealAddedFoodItems === 'function') {
        const items = window.getCurrentMealAddedFoodItems(meal);
        if (Array.isArray(items)) return items.length;
      }
    } catch(e) {}
    const card = $('food-current-meal-card');
    const n = card && q('.food-current-meal-head b', card);
    const parsed = n ? parseInt(n.textContent || '0', 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function renderMealContextCard(){
    try { if (typeof window.renderCurrentMealFoods === 'function') window.renderCurrentMealFoods(); } catch(e) {}
  }


  function shortLabel(text, max = 30){
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, Math.max(1, max - 1)).trim() + '…' : s;
  }

  function visibleText(selector){
    const el = q(selector);
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function updateConfirmButtonUI(){
    const modal = $('food-add-modal');
    const btn = $('food-main-action-btn');
    if (!modal || !btn) return;

    if (currentIntent !== 'search') {
      // 0.22.118 : mise à jour idempotente. L'ancien code réécrivait toujours
      // texte/classes/attributs ; combiné au MutationObserver du popup cela pouvait
      // créer une boucle de mutations et figer le clic Ajouter au journal.
      if (btn.disabled) btn.disabled = false;
      if (btn.getAttribute('aria-disabled') !== 'false') btn.setAttribute('aria-disabled', 'false');
      if (btn.classList.contains('fn-add-confirm-disabled')) btn.classList.remove('fn-add-confirm-disabled');
      return;
    }

    const input = $('db-search');
    const query = String(input && input.value || '').replace(/\s+/g, ' ').trim();
    const selectedCard = $('db-selected-card');
    const selectedVisible = !!(selectedCard && selectedCard.classList.contains('visible'));
    const selectedName = selectedVisible ? (visibleText('#db-selected-card strong') || query) : '';
    const quantityOpen = quantityFlowActive();
    const qtyName = visibleText('#db-quantity-title') || query || selectedName;

    let enabled = false;
    let label = 'Sélectionne un aliment ci-dessus pour continuer';
    if (quantityOpen) {
      enabled = true;
      label = qtyName ? `Ajouter ${shortLabel(qtyName, 32)}` : 'Ajouter cette quantité';
    } else if (selectedName) {
      enabled = true;
      label = `Choisir la quantité · ${shortLabel(selectedName, 26)}`;
    } else if (query) {
      enabled = true;
      label = `Ajouter “${shortLabel(query, 28)}”`;
    }

    const disabled = !enabled;
    const aria = enabled ? 'false' : 'true';
    if (btn.textContent !== label) btn.textContent = label;
    if (btn.disabled !== disabled) btn.disabled = disabled;
    if (btn.getAttribute('aria-disabled') !== aria) btn.setAttribute('aria-disabled', aria);
    if (btn.classList.contains('fn-add-confirm-disabled') !== disabled) btn.classList.toggle('fn-add-confirm-disabled', disabled);
  }

  function scheduleConfirmButtonUI(delay = 0){
    clearTimeout(confirmStateTimer);
    confirmStateTimer = setTimeout(() => runAfterPaint(updateConfirmButtonUI), Math.max(0, Number(delay) || 0));
  }

  function ensureConfirmStateObserver(){
    // 0.22.118 : désactivé volontairement.
    // Le bouton est maintenant rafraîchi par les vrais événements utilisateur
    // (input, clic, ouverture, changement de quantité). Observer tout le popup
    // provoquait une boucle : updateConfirmButtonUI modifie le bouton -> mutation
    // -> scheduleConfirmButtonUI -> updateConfirmButtonUI, surtout visible au clic
    // “Ajouter au journal”.
    try { if (confirmStateObserver && typeof confirmStateObserver.disconnect === 'function') confirmStateObserver.disconnect(); } catch(e) {}
    confirmStateObserver = null;
    try { window.__FoodNoteConfirmButtonObserverDisabled = true; } catch(e) {}
    return false;
  }

  function ensureMealContextUI(){
    const modal = $('food-add-modal');
    const panel = q('#food-add-modal .food-add-panel');
    const chooser = $('food-add-intent-chooser');
    if (!modal || !panel || !chooser) return;

    let wrap = $('fn-meal-context-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'fn-meal-context-wrap';
      wrap.innerHTML = `
        <div id="fn-meal-context-bar">
          <button type="button" id="fn-meal-current-pill" class="fn-meal-current-pill">
            <span class="fn-meal-current-icon">🍽</span>
            <span class="fn-meal-current-copy"><span class="fn-meal-current-label">Déjeuner</span><small>Repas cible</small></span>
          </button>
          <button type="button" id="fn-meal-content-btn">
            <span>👀</span><span class="fn-meal-content-text">Voir le repas</span><b class="fn-meal-content-count">0</b>
          </button>
          <button type="button" id="fn-meal-change-btn" class="fn-meal-change-btn">Changer</button>
        </div>
        <div id="fn-meal-context-picker">
          <button type="button" class="fn-meal-choice-btn" data-fn-meal-choice="breakfast">☕ <span>Petit-déj</span></button>
          <button type="button" class="fn-meal-choice-btn" data-fn-meal-choice="lunch">🍽 <span>Déjeuner</span></button>
          <button type="button" class="fn-meal-choice-btn" data-fn-meal-choice="dinner">🌙 <span>Dîner</span></button>
        </div>
        <div id="fn-meal-content-popover" aria-live="polite"></div>`;
      panel.insertBefore(wrap, chooser);
    }

    const currentPill = $('fn-meal-current-pill');
    const changeBtn = $('fn-meal-change-btn');
    const contentBtn = $('fn-meal-content-btn');

    if (currentPill && !currentPill.__fn170Bound) {
      currentPill.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); toggleMealPicker(); }, true);
      currentPill.__fn170Bound = true;
    }
    if (changeBtn && !changeBtn.__fn170Bound) {
      changeBtn.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); toggleMealPicker(); }, true);
      changeBtn.__fn170Bound = true;
    }
    if (contentBtn && !contentBtn.__fn170Bound) {
      contentBtn.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); toggleMealContentPanel(); }, true);
      contentBtn.__fn170Bound = true;
    }

    qa('[data-fn-meal-choice]', wrap).forEach(btn => {
      if (btn.__fn170Bound) return;
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const meal = btn.getAttribute('data-fn-meal-choice');
        if (typeof window.setFoodAddTargetMeal === 'function') window.setFoodAddTargetMeal(meal);
        closeMealPicker();
        closeMealContentPanel();
        runAfterPaint(() => { renderMealContextCard(); updateMealContextUI(); scheduleRenderSuggestions(80); });
      }, true);
      btn.__fn170Bound = true;
    });

    const pop = $('fn-meal-content-popover');
    const card = $('food-current-meal-card');
    if (pop && card && card.parentElement !== pop) pop.appendChild(card);

    const searchPanel = $('food-add-search-panel');
    if (searchPanel) {
      searchPanel.innerHTML = '';
      searchPanel.setAttribute('aria-hidden', 'true');
      searchPanel.style.setProperty('display', 'none', 'important');
    }
  }

  function toggleMealPicker(force){
    const picker = $('fn-meal-context-picker');
    if (!picker) return;
    const open = typeof force === 'boolean' ? force : !picker.classList.contains('is-open');
    picker.classList.toggle('is-open', open);
  }

  function closeMealPicker(){ toggleMealPicker(false); }

  function toggleMealContentPanel(force){
    const pop = $('fn-meal-content-popover');
    const btn = $('fn-meal-content-btn');
    if (!pop || !btn || !btn.classList.contains('has-items')) return;
    const open = typeof force === 'boolean' ? force : !pop.classList.contains('is-open');
    pop.classList.toggle('is-open', open);
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      renderMealContextCard();
      setTimeout(updateMealContextUI, 0);
    }
  }

  function closeMealContentPanel(){ toggleMealContentPanel(false); }

  function updateMealContextUI(){
    const modal = $('food-add-modal');
    if (!modal) return;
    const meal = mealMeta(currentMealFromState());

    const title = q('#food-add-modal .fn-add-title');
    if (title) title.textContent = `Ajouter au ${meal.title}`;

    const label = q('#fn-meal-current-pill .fn-meal-current-label');
    const icon = q('#fn-meal-current-pill .fn-meal-current-icon');
    if (label) label.textContent = meal.label;
    if (icon) icon.textContent = meal.icon;

    qa('[data-fn-meal-choice]').forEach(btn => {
      const active = btn.getAttribute('data-fn-meal-choice') === meal.id;
      btn.classList.toggle('active', active);
      btn.classList.toggle('is-selected', active);
      btn.classList.toggle('selected', active);
      btn.dataset.foodnoteMealSelected = active ? '1' : '0';
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
    qa('#food-add-modal .food-meal-chip[data-food-meal]').forEach(btn => {
      const active = btn.getAttribute('data-food-meal') === meal.id;
      btn.classList.toggle('active', active);
      btn.classList.toggle('is-selected', active);
      btn.classList.toggle('selected', active);
      btn.dataset.foodnoteMealSelected = active ? '1' : '0';
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });

    const mainBtn = $('food-main-action-btn');
    if (mainBtn && currentIntent === 'search') scheduleConfirmButtonUI(0);

    const count = currentMealItemCount();
    const contentBtn = $('fn-meal-content-btn');
    if (contentBtn) {
      const countEl = q('.fn-meal-content-count', contentBtn);
      if (countEl) countEl.textContent = String(count);
      contentBtn.classList.toggle('has-items', count > 0);
      contentBtn.setAttribute('aria-label', count > 0 ? `Voir les ${count} aliments déjà dans ${meal.label}` : `Aucun aliment dans ${meal.label}`);
      contentBtn.title = count > 0 ? `${count} déjà dans ${meal.label}` : '';
      if (count <= 0) closeMealContentPanel();
    }
  }

  function entryFoodsSignature(entries){
    const arr = Array.isArray(entries) ? entries : [];
    return arr.slice(0, 60).map(e => {
      const foods = Array.isArray(e && e.aliments) ? e.aliments : [];
      const last = foods[foods.length - 1] || {};
      return [e && (e.id || e.date || ''), foods.length, last.line_uid || last.lineUid || last.entryFoodId || last.entry_food_id || '', last.nom || '', last.qty || last.defaut || ''].join(':');
    }).join('|');
  }

  function invalidateSuggestionsCache(){
    entryFoodsCacheSignature = '';
    entryFoodsCacheRows = null;
  }
  window.invalidateFoodQuickSuggestionsCache = invalidateSuggestionsCache;

  function getEntryFoods(){
    let entries = [];
    try { entries = (typeof getEntries === 'function') ? getEntries() : []; } catch(e) { entries = []; }
    const sig = entryFoodsSignature(entries);
    if (entryFoodsCacheRows && entryFoodsCacheSignature === sig) return entryFoodsCacheRows;
    const out = [];
    const limitedEntries = (entries || []).slice(0, 60);
    for (const e of limitedEntries) {
      if (!e || !Array.isArray(e.aliments)) continue;
      for (const a of (e.aliments || [])) {
        if (!a || !a.nom) continue;
        const item = Object.assign({}, a);
        item.meal = (item.meal === 'breakfast' || item.meal === 'lunch' || item.meal === 'dinner') ? item.meal : 'lunch';
        out.push({ item, date: e.date || '', meal: item.meal });
        if (out.length >= 240) break;
      }
      if (out.length >= 240) break;
    }
    entryFoodsCacheRows = out.sort((a,b) => String(b.date).localeCompare(String(a.date)));
    entryFoodsCacheSignature = sig;
    return entryFoodsCacheRows;
  }

  function foodKey(item){
    const qty = Number(item && (item.qty ?? item.defaut ?? item.quantity)) || 100;
    const unit = item && (item.unite || item.unit || 'g');
    return normalize((item && item.nom) + '|' + qty + '|' + unit);
  }

  function compactItem(raw){
    try {
      if (typeof normalizeHistoryFoodItemForReuse === 'function') return normalizeHistoryFoodItemForReuse(raw || {});
    } catch(e) {}
    return Object.assign({ qty: Number(raw && (raw.qty ?? raw.defaut)) || 100, unite: (raw && (raw.unite || raw.unit)) || 'g' }, raw || {});
  }

  function uniqueLatest(list, limit=12){
    const seen = new Set();
    const out = [];
    list.forEach(row => {
      const item = compactItem(row.item || row);
      const key = foodKey(item);
      if (!item.nom || seen.has(key)) return;
      seen.add(key);
      out.push({ item, extra: row.extra || row.date || '' });
    });
    return out.slice(0, limit);
  }

  function frequentFoods(limit=12, meal=null){
    const map = new Map();
    getEntryFoods().forEach(row => {
      if (meal && row.meal !== meal) return;
      const item = compactItem(row.item);
      const key = foodKey(item);
      if (!item.nom) return;
      const cur = map.get(key) || { item, count:0, lastDate:'' };
      cur.count += 1;
      if (String(row.date) > String(cur.lastDate || '')) { cur.lastDate = row.date || ''; cur.item = item; }
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a,b) => b.count - a.count || String(b.lastDate).localeCompare(String(a.lastDate))).slice(0, limit).map(v => ({ item:v.item, extra:v.count + '×' }));
  }

  function recentFoods(limit=12, meal=null){
    const rows = getEntryFoods().filter(row => !meal || row.meal === meal).map(row => ({ item: row.item, extra: '' }));
    return uniqueLatest(rows, limit);
  }

  function favoriteKeyStore(){ return 'foodnote_quick_favorites_v1'; }
  function readFavorites(){
    try {
      const arr = JSON.parse(localStorage.getItem(favoriteKeyStore()) || '[]');
      return Array.isArray(arr) ? arr.filter(x => x && x.item && x.item.nom).slice(0, 40) : [];
    } catch(e) { return []; }
  }
  function writeFavorites(items){
    try { localStorage.setItem(favoriteKeyStore(), JSON.stringify((items || []).slice(0, 40))); } catch(e) {}
  }
  function isFavorite(item){ return readFavorites().some(f => foodKey(f.item) === foodKey(item)); }
  function toggleFavorite(item){
    const normalized = compactItem(item);
    const key = foodKey(normalized);
    let favs = readFavorites();
    if (favs.some(f => foodKey(f.item) === key)) favs = favs.filter(f => foodKey(f.item) !== key);
    else favs.unshift({ item: normalized, at: new Date().toISOString() });
    writeFavorites(favs);
    scheduleRenderSuggestions(60);
  }


  function hideSuggestions(){
    const modal = $('food-add-modal');
    const card = $('quick-foods-card');
    if (card) {
      card.style.setProperty('display', 'none', 'important');
      card.setAttribute('aria-hidden', 'true');
    }
    if (modal) modal.classList.remove('fn-suggestions-open');
  }

  function showSuggestionsCard(){
    const modal = $('food-add-modal');
    const card = $('quick-foods-card');
    if (card) {
      card.style.setProperty('display', 'block', 'important');
      card.setAttribute('aria-hidden', 'false');
    }
    if (modal) modal.classList.add('fn-suggestions-open');
  }

  function dismissSuggestions(){
    suggestionsDismissed = true;
    hideSuggestions();
  }

  function resetSuggestionsDismissed(){
    suggestionsDismissed = false;
  }

  function ensureSuggestionCloseButton(){
    // 0.22.37 : les suggestions font partie du composant Ajouter, avec une couche visuelle chaleureuse.
    // On ne crée plus de deuxième croix interne qui concurrence la fermeture du popup.
    const card = $('quick-foods-card');
    const head = card && q('.quick-foods-head', card);
    if (!head) return;
    qa('.quick-foods-close-inline', head).forEach(btn => { try { btn.remove(); } catch(e) {} });
  }

  function relocateSuggestionsCard(){
    const modal = $('food-add-modal');
    const panel = q('#food-add-modal .food-add-panel');
    const row = q('#food-add-modal .journal-add-row');
    const card = $('quick-foods-card');
    if (!modal || !panel || !row || !card) return;
    if (card.parentElement !== panel || row.nextElementSibling !== card) {
      row.insertAdjacentElement('afterend', card);
    }
    card.classList.add('fn-suggestions-relocated');
  }

  function baseFoods(limit=12){
    const out = [];
    const seen = new Set();
    const max = Math.max(1, Number(limit) || 12);
    try {
      const lists = [];
      if (typeof getCustomList === 'function') lists.push(getCustomList());
      if (typeof getBDD === 'function') lists.push(getBDD());
      outer: for (const list of lists) {
        for (const raw of (list || [])) {
          const item = compactItem(raw || {});
          const key = foodKey(item);
          if (!item.nom || seen.has(key)) continue;
          seen.add(key);
          out.push({ item, extra:'base' });
          if (out.length >= max) break outer;
        }
      }
    } catch(e) {}
    return out;
  }

  function uniqueSuggestionRows(rows, limit=12){
    return (rows || []).filter((v, i, arr) => v && v.item && arr.findIndex(x => foodKey(x.item) === foodKey(v.item)) === i).slice(0, limit);
  }

  function suggestionItems(){
    const meal = currentMeal();
    const mealRows = uniqueSuggestionRows(recentFoods(12, meal).concat(frequentFoods(12, meal)), 12);
    if (suggestionTab === 'meal') return mealRows.length ? mealRows : uniqueSuggestionRows(recentFoods(12).concat(frequentFoods(12)).concat(baseFoods(12)), 12);
    if (suggestionTab === 'recent') return uniqueSuggestionRows(recentFoods(12).concat(baseFoods(12)), 12);
    if (suggestionTab === 'favorite') return readFavorites().map(f => ({ item:f.item, extra:'favori' }));
    return uniqueSuggestionRows(frequentFoods(12, meal).concat(frequentFoods(12)).concat(baseFoods(12)), 12);
  }

  function qtyLabel(item){
    const qty = Number(item && (item.qty ?? item.defaut ?? item.quantity)) || 100;
    const unit = (item && (item.unite || item.unit)) || 'g';
    try { if (typeof formatFoodQty === 'function') return formatFoodQty(item, qty); } catch(e) {}
    return qty + ' ' + unit;
  }

  function macrosLine(item){
    const kcal = item.kcal ?? item.kcal100;
    const p = item.prot ?? item.prot100;
    const g = item.gluc ?? item.gluc100;
    const l = item.lip ?? item.lip100;
    if (kcal == null && p == null && g == null && l == null) return '';
    return `<span class="fn-suggestion-macros"><b class="fn-nutri-pill macro-kcal">${Math.round(Number(kcal)||0)} kcal</b><b class="fn-nutri-pill macro-prot">P ${Number(p||0).toFixed(1)}g</b><b class="fn-nutri-pill macro-gluc">G ${Number(g||0).toFixed(1)}g</b><b class="fn-nutri-pill macro-lip">L ${Number(l||0).toFixed(1)}g</b></span>`;
  }

  function addSuggestionItem(encoded){
    try {
      const item = JSON.parse(decodeURIComponent(encoded));
      // 0.22.2 : une suggestion rapide ouvre toujours le sélecteur de quantité.
      // Elle ne rejoue plus directement une ancienne ligne d'historique avec ses IDs/quantités potentiellement périmés.
      if (typeof window.openFoodFromSuggestionItem === 'function') window.openFoodFromSuggestionItem(item);
      else if (typeof addFoodFromHistoryItem === 'function') addFoodFromHistoryItem(item);
      runWhenIdle(() => { try { if (typeof updateMacros === 'function') updateMacros(); } catch(e) {} }, 900);
    } catch(e) { if (window.FOODNOTE_DEBUG_UI) console.debug('[FoodNote beta 0.22.37] ouverture suggestion impossible', e); }
  }

  function renderSuggestions(){
    if (quantityFlowActive()) return;
    const modal = $('food-add-modal');
    const card = $('quick-foods-card');
    const list = $('quick-foods-list');
    const actions = $('quick-foods-actions');
    const input = $('db-search');
    if (!modal || !card || !list || currentIntent !== 'search' || workflowActive()) return;
    const hasQuery = !!(input && input.value && input.value.trim());
    if (hasQuery || suggestionsDismissed) {
      hideSuggestions();
      return;
    }
    relocateSuggestionsCard();
    ensureSuggestionCloseButton();
    ensureMealContextUI();
    if (!card.__fnMealContextRenderedAt || Date.now() - card.__fnMealContextRenderedAt > 900) {
      card.__fnMealContextRenderedAt = Date.now();
      renderMealContextCard();
    }
    updateMealContextUI();
    try { if (typeof scheduleFoodsWarmup === 'function') scheduleFoodsWarmup(1800); } catch(e) {}
    const items = suggestionItems();
    const renderKey = [currentMeal(), suggestionTab, items.length, items.map(({item, extra}) => foodKey(compactItem(item)) + ':' + (extra || '')).join(',')].join('|');
    showSuggestionsCard();
    card.classList.add('fn-suggestions-card');
    const title = q('.quick-foods-title', card);
    const sub = q('.quick-foods-sub', card);
    const tabs = q('.quick-foods-tabs', card);
    if (title) title.innerHTML = '<span class="quick-foods-icon">✨</span> Suggestions';
    if (sub) sub.textContent = 'Des aliments utiles, proposés sans masquer la recherche.';
    if (tabs) {
      tabs.innerHTML = `
        <button type="button" class="quick-tab ${suggestionTab==='meal'?'active':''}" data-food-add-action="suggestion-tab" data-suggestion-tab="meal">Ce repas</button>
        <button type="button" class="quick-tab ${suggestionTab==='recent'?'active':''}" data-food-add-action="suggestion-tab" data-suggestion-tab="recent">Récents</button>
        <button type="button" class="quick-tab ${suggestionTab==='favorite'?'active':''}" data-food-add-action="suggestion-tab" data-suggestion-tab="favorite">Favoris</button>
        <button type="button" class="quick-tab ${suggestionTab==='habit'?'active':''}" data-food-add-action="suggestion-tab" data-suggestion-tab="habit">Habitudes</button>`;
    }
    if (actions) {
      const label = MEAL_LABELS[currentMeal()] || MEAL_LABELS.lunch;
      actions.innerHTML = `<div class="fn-suggestions-context">Repas cible : <b>${esc(label.icon + ' ' + label.full)}</b></div>`;
    }
    if (list.__fnLastSuggestionRenderKey === renderKey) return;
    list.__fnLastSuggestionRenderKey = renderKey;
    if (!items.length) {
      const empty = suggestionTab === 'favorite'
        ? 'Aucun favori. Touche ☆ sur une suggestion récente pour l’épingler.'
        : 'Pas encore assez d’historique pour proposer ce bloc.';
      list.innerHTML = `<div class="fn-suggestion-empty">${empty}</div>`;
      return;
    }
    list.innerHTML = items.map(({item, extra}) => {
      const normalized = compactItem(item);
      const encoded = encodeURIComponent(JSON.stringify(normalized));
      const fav = isFavorite(normalized);
      const extraLabel = String(extra || '').trim();
      const tag = extraLabel ? `<span class="fn-suggestion-tag">${esc(extraLabel)}</span>` : '';
      return `<div class="fn-suggestion-card fn-suggestion-row" data-suggestion-kind="${esc(suggestionTab)}">
        <button type="button" class="fn-suggestion-main" data-food-add-action="suggestion-add" data-suggestion="${encoded}">
          <span class="fn-suggestion-topline">
            <span class="fn-suggestion-name">${esc(normalized.nom)}</span>
            ${tag}
          </span>
          <span class="fn-suggestion-meta">${esc(qtyLabel(normalized))}</span>
          ${macrosLine(normalized)}
        </button>
        <button type="button" class="fn-suggestion-fav ${fav?'is-fav':''}" data-food-add-action="suggestion-favorite" data-suggestion="${encoded}" title="${fav?'Retirer des favoris':'Ajouter aux favoris'}" aria-label="${fav?'Retirer des favoris':'Ajouter aux favoris'}">${fav?'★':'☆'}</button>
      </div>`;
    }).join('');
  }

  function setSuggestionTab(tab){
    suggestionTab = (tab === 'recent' || tab === 'favorite' || tab === 'habit') ? tab : 'meal';
    scheduleRenderSuggestions(30);
  }

  function setIntent(intent, options={}){
    ensureUI();
    if (intent === 'estimate' && options && options.workflow) beginWorkflow(options.workflow, options.ttl || 120000);
    if ((intent === 'search' || intent === 'recipes') && workflowActive() && !(options && options.forceWorkflowExit)) {
      currentIntent = 'estimate';
      applyIntentOnly();
      return;
    }
    if ((intent === 'search' || intent === 'recipes') && options && options.forceWorkflowExit) endWorkflow();
    if (quantityFlowActive() && intent !== 'estimate' && intent !== 'recipes') return;
    currentIntent = (intent === 'estimate' || intent === 'recipes') ? intent : 'search';
    if (currentIntent === 'search' && !(options && options.keepDismissed)) resetSuggestionsDismissed();
    const modal = $('food-add-modal');
    if (!modal) return;
    modal.classList.toggle('food-intent-search', currentIntent === 'search');
    modal.classList.toggle('food-intent-estimate', currentIntent === 'estimate');
    modal.classList.toggle('food-intent-recipes', currentIntent === 'recipes');
    modal.classList.toggle('fn-add-estimate-result', false);
    qa('[data-food-intent]', modal).forEach(btn => {
      const active = btn.getAttribute('data-food-intent') === currentIntent;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const badge = $('food-add-mode-badge');
    if (badge) badge.textContent = currentIntent === 'estimate' ? '⚡ Estimer un plat' : currentIntent === 'recipes' ? '🍲 Recette' : '🍽 Ajouter à ma journée';
    const input = $('db-search');
    const qty = $('db-qty');
    const btn = $('food-main-action-btn');
    const filters = q('#food-add-modal .food-inline-filters');
    if (input) {
      input.placeholder = currentIntent === 'estimate'
        ? 'Décris le plat : pâtes bolo maison, assiette de chili...'
        : 'Rechercher un aliment, une recette ou un produit...';
      if (currentIntent !== 'estimate' && !options.keepText) input.value = input.value || '';
    }
    if (qty) qty.style.setProperty('display', currentIntent === 'search' ? '' : 'none', 'important');
    if (filters) filters.style.setProperty('display', currentIntent === 'search' ? 'flex' : 'none', 'important');
    if (btn) {
      if (currentIntent === 'estimate') btn.textContent = 'Estimer avec IA';
      else scheduleConfirmButtonUI(0);
    }
    if (originalSetFoodAddMode) {
      try {
        // Le flux Photo recette possède son propre état visuel (caméra → crop → OCR → IA).
        // Rejouer setFoodAddMode('ia') pendant ce flux supprime les classes food-add-recipe-*
        // et renvoie la popup vers le panneau Recherche. On le fait uniquement hors workflow actif.
        if (!workflowActive()) originalSetFoodAddMode(currentIntent === 'estimate' ? 'ia' : 'search');
      } catch(e) {}
    }
    // originalSetFoodAddMode réécrit parfois l'état visuel ; on réapplique après peinture, pas en double setTimeout lourd.
    runAfterPaint(applyIntentOnly);
    if (currentIntent !== 'search') {
      $('quick-foods-card')?.style.setProperty('display', 'none', 'important');
      modal.classList.remove('fn-suggestions-open');
      try { if (currentIntent === 'recipes' && typeof closeOCRPanel === 'function') closeOCRPanel(); } catch(e) {}
    } else if (!(options && options.deferSuggestions)) {
      scheduleRenderSuggestions(60);
    }
    if (isTouchDevice()) blurSearchSoon();
  }

  function applyIntentOnly(){
    syncWorkflowIntent();
    const modal = $('food-add-modal');
    if (!modal) return;
    modal.classList.toggle('food-intent-search', currentIntent === 'search');
    modal.classList.toggle('food-intent-estimate', currentIntent === 'estimate');
    modal.classList.toggle('food-intent-recipes', currentIntent === 'recipes');
    qa('[data-food-intent]', modal).forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-food-intent') === currentIntent));
    const filters = q('#food-add-modal .food-inline-filters');
    if (filters) filters.style.setProperty('display', currentIntent === 'search' ? 'flex' : 'none', 'important');
    const qty = $('db-qty');
    if (qty) qty.style.setProperty('display', currentIntent === 'search' ? '' : 'none', 'important');
    if (workflowActive()) {
      $('quick-foods-card')?.style.setProperty('display', 'none', 'important');
      if (!(typeof window.foodnoteShouldKeepDBSuggestionsVisible === 'function' && window.foodnoteShouldKeepDBSuggestionsVisible())) {
        $('db-suggestions')?.style.setProperty('display', 'none', 'important');
      }
    }
    scheduleConfirmButtonUI(0);
  }

  function blurSearchSoon(){
    suppressFocusUntil = Date.now() + 800;
    [0, 80, 250].forEach(t => setTimeout(() => { try { if (Date.now() < suppressFocusUntil) $('db-search')?.blur(); } catch(e) {} }, t));
  }

  function runEstimate(){
    setIntent('estimate', { keepText:true });
    const input = $('db-search');
    const text = input ? String(input.value || '').trim() : '';
    if (!text) {
      try { input && input.focus({ preventScroll:true }); } catch(e) {}
      try { if (typeof toast === 'function') toast('Décris le plat avant de lancer l’estimation IA.'); else alert('Décris le plat avant de lancer l’estimation IA.'); } catch(e) {}
      return;
    }
    try {
      if (typeof window.estimerGroq === 'function') window.estimerGroq();
    } catch(e) {
      if (window.FOODNOTE_DEBUG_UI) console.debug('[FoodNote] estimation IA impossible', e);
    }
  }

  function focusEstimate(){
    setIntent('estimate', { keepText:true });
    suppressFocusUntil = 0;
    setTimeout(() => { try { $('db-search')?.focus({ preventScroll:true }); } catch(e) {} }, 60);
  }

  function clearEstimateResult(){
    const modal = $('food-add-modal');
    if (modal) modal.classList.remove('fn-add-estimate-result', 'food-estimate-result-active');
    const resp = $('groq-response');
    const prev = $('ia-preview');
    const status = $('ia-parse-status');
    if (resp) { resp.style.display = 'none'; resp.innerHTML = ''; resp.textContent = ''; }
    if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
    if (status) status.textContent = '';
  }

  function showEstimateResult(){
    const modal = $('food-add-modal');
    if (!modal || currentIntent !== 'estimate') return;
    modal.classList.add('fn-add-estimate-result');
    modal.classList.remove('food-estimate-result-active');
    // Les anciens modules peuvent remettre cette classe après coup ; on garde le nouveau layout.
    [40, 160, 360, 800].forEach(t => setTimeout(() => modal.classList.remove('food-estimate-result-active'), t));
    const result = $('ia-preview')?.style.display !== 'none' ? $('ia-preview') : $('groq-response');
    try { result && result.scrollIntoView({ block:'nearest' }); } catch(e) {}
  }

  function ensureUI(){
    injectStyles();
    const modal = $('food-add-modal');
    const panel = q('#food-add-modal .food-add-panel');
    if (!modal || !panel) return;
    modal.classList.remove('fn-add-component-v02217', 'fn-add-component-v02216');
    modal.classList.add('fn-add-v0160', 'fn-add-component-v02218');
    ensureConfirmStateObserver();

    // Header compact : titre + fermeture, sans grande bande vide.
    const head = q('.food-add-head', modal);
    if (head && !q('.fn-add-title', head)) {
      const title = document.createElement('div');
      title.className = 'fn-add-title';
      title.textContent = 'Ajouter à ma journée';
      head.insertBefore(title, head.firstChild);
    }

    // Tabs d'intention compacts.
    let chooser = $('food-add-intent-chooser');
    if (!chooser) {
      chooser = document.createElement('div');
      chooser.id = 'food-add-intent-chooser';
      chooser.className = 'food-add-intent-chooser';
      panel.insertBefore(chooser, panel.firstChild);
    }
    if (!chooser.__fn0160Built) {
      chooser.innerHTML = `
        <button type="button" class="food-add-intent-btn" data-food-intent="search" data-food-add-action="set-intent" data-intent="search"><span>🔎</span><b>Rechercher</b></button>
        <button type="button" class="food-add-intent-btn" data-food-intent="estimate" data-food-add-action="set-intent" data-intent="estimate"><span>📷</span><b>Photo / OCR</b></button>
        <button type="button" class="food-add-intent-btn" data-food-intent="recipes" data-food-add-action="set-intent" data-intent="recipes"><span>🍲</span><b>Recette</b></button>`;
      chooser.__fn0160Built = true;
    }

    // Cartes de mode : compactes, sans doublon de sources.
    let searchPanel = $('food-add-search-panel');
    if (!searchPanel) {
      searchPanel = document.createElement('div');
      searchPanel.id = 'food-add-search-panel';
      searchPanel.className = 'food-add-mode-panel';
      chooser.insertAdjacentElement('afterend', searchPanel);
    }
    if (!searchPanel.__fn0160Built) { searchPanel.innerHTML = ''; searchPanel.__fn0160Built = true; }
    searchPanel.setAttribute('aria-hidden','true');

    let estimatePanel = $('food-add-estimate-panel');
    if (!estimatePanel) {
      estimatePanel = document.createElement('div');
      estimatePanel.id = 'food-add-estimate-panel';
      estimatePanel.className = 'food-add-mode-panel';
      searchPanel.insertAdjacentElement('afterend', estimatePanel);
    }
    if (!estimatePanel.__fn0160Built) {
      estimatePanel.innerHTML = `
        <div class="fn-mode-title"><strong>Estimer un plat</strong><span>Texte, photo ou étiquette. Tu valides avant ajout.</span></div>
        <div class="food-add-mode-actions fn-estimate-actions">
          <button type="button" class="btn-primary" data-food-add-action="focus-estimate">✍️ Décrire le plat</button>
          <button type="button" data-food-add-action="open-plate-photo">📷 Photo d’un plat</button>
          <button type="button" data-food-add-action="open-product-photo">🧾 Lire une étiquette</button>
        </div>
        <div class="fn-estimate-submit-row">
          <button type="button" class="btn-primary fn-estimate-submit" data-food-add-action="estimate-run">⚡ Estimer avec IA</button>
        </div>`;
      estimatePanel.__fn0160Built = true;
    }

    let recipesPanel = $('food-add-recipes-panel');
    if (!recipesPanel) {
      recipesPanel = document.createElement('div');
      recipesPanel.id = 'food-add-recipes-panel';
      recipesPanel.className = 'food-add-mode-panel';
      estimatePanel.insertAdjacentElement('afterend', recipesPanel);
    }
    if (!recipesPanel.__fn0160Built) {
      recipesPanel.innerHTML = `
        <div class="fn-mode-title"><strong>Créer une recette</strong><span>Recette réutilisable, manuelle ou scannée.</span></div>
        <div class="food-add-mode-actions fn-recipe-actions">
          <button type="button" class="btn-primary" data-food-add-action="new-recipe">+ Nouvelle recette</button>
          <button type="button" data-food-add-action="scan-recipe">📷 Scanner une recette</button>
          <button type="button" data-food-add-action="open-recipes-list">📚 Mes recettes</button>
        </div>`;
      recipesPanel.__fn0160Built = true;
    }

    const quick = $('quick-foods-card');
    if (quick) quick.classList.add('fn-suggestions-card');
    relocateSuggestionsCard();
    ensureSuggestionCloseButton();

    // Le bouton Mémoire rapide n'existe plus comme mode séparé.
    qa('#food-add-modal #food-quick-mode-btn, #food-add-modal .quick-foods-launch, #quick-foods-launch').forEach(el => {
      try { el.style.setProperty('display','none','important'); } catch(e) {}
    });

    // Recherche : taper revient automatiquement au mode recherche standard et masque les suggestions.
    const input = $('db-search');
    if (input && !input.__fn0160InputBound) {
      input.addEventListener('input', () => {
        if (currentIntent !== 'estimate') currentIntent = 'search';
        applyIntentOnly();
        scheduleRenderSuggestions(90);
      }, true);
      input.addEventListener('focus', () => {
        if (isTouchDevice() && Date.now() < suppressFocusUntil) { try { input.blur(); } catch(e) {} }
      }, true);
      input.__fn0160InputBound = true;
    }

    // En mode Estimer, le lancement IA est dans la même ligne que le champ.
    const searchWrap = q('#food-add-modal .db-search-wrap');
    if (searchWrap && !$('fn-estimate-inline-submit')) {
      const btn = document.createElement('button');
      btn.id = 'fn-estimate-inline-submit';
      btn.type = 'button';
      btn.className = 'btn-primary fn-estimate-inline-submit';
      btn.innerHTML = '<span class="fn-estimate-full">⚡ Estimer avec IA</span><span class="fn-estimate-short">⚡ IA</span>';
      btn.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); runEstimate(); }, true);
      searchWrap.appendChild(btn);
    }

    ensureConfirmBarPlacement();
    relabelMealButtons();
    applyIntentOnly();
  }

  function relabelMealButtons(){
    const small = window.matchMedia && window.matchMedia('(max-width: 430px)').matches;
    qa('#food-add-modal .food-meal-chip[data-food-meal]').forEach(btn => {
      const m = btn.getAttribute('data-food-meal');
      const b = q('b', btn);
      if (b && MEAL_LABELS[m]) b.textContent = small ? MEAL_LABELS[m].short : MEAL_LABELS[m].full;
    });
  }

  function injectCleanMealContextStyles(){
    if ($('foodnote-add-clean-0170-style')) return;
    const style = document.createElement('style');
    style.id = 'foodnote-add-clean-0170-style';
    style.textContent = `
      .meal-group-head-right{display:flex!important;align-items:center!important;gap:8px!important;min-width:0!important;margin-left:auto!important;}
      .meal-group-add-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;border-radius:999px!important;border:1px solid color-mix(in srgb, var(--green) 58%, var(--border2))!important;background:color-mix(in srgb, var(--green) 12%, var(--bg))!important;color:var(--green)!important;font-size:22px!important;font-weight:900!important;line-height:1!important;padding:0!important;box-shadow:0 1px 4px rgba(0,0,0,.08)!important;cursor:pointer!important;touch-action:manipulation!important;}
      .meal-group-add-btn:hover{transform:translateY(-1px)!important;}
      .meal-group-add-btn:active{transform:translateY(0)!important;}
      @media(max-width:760px){.meal-group-add-btn{width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important;font-size:20px!important;}}

      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-head{align-items:flex-start!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-add-title{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-context-wrap{position:static!important;display:flex!important;flex-direction:column!important;gap:7px!important;margin:0 0 2px 0!important;padding:0!important;flex:0 0 auto!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-context-bar{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;flex-wrap:nowrap!important;padding:8px 10px!important;border-radius:15px!important;border:1px solid var(--border2)!important;background:linear-gradient(180deg, color-mix(in srgb, var(--bg) 94%, transparent), color-mix(in srgb, var(--bg2) 88%, transparent))!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-current-pill{display:inline-flex!important;align-items:center!important;gap:7px!important;flex:1 1 auto!important;min-width:0!important;border:0!important;background:transparent!important;padding:0!important;margin:0!important;color:var(--text)!important;font-size:13px!important;font-weight:900!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-current-pill small{display:block!important;font-size:11px!important;font-weight:700!important;color:var(--text3)!important;line-height:1.15!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-change-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:30px!important;height:30px!important;padding:0 11px!important;border-radius:999px!important;border:1px solid var(--border2)!important;background:var(--bg)!important;color:var(--text)!important;font-size:11px!important;font-weight:900!important;white-space:nowrap!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-context-picker{display:none!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-context-picker.is-open{display:grid!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-choice-btn{min-width:0!important;height:34px!important;min-height:34px!important;border-radius:13px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;border:1px solid var(--border2)!important;background:var(--bg)!important;color:var(--text2)!important;padding:0 6px!important;font-size:11px!important;font-weight:850!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-choice-btn.active{background:var(--green-bg)!important;border-color:var(--green)!important;color:var(--text)!important;}

      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-btn{display:none!important;align-items:center!important;justify-content:center!important;gap:5px!important;height:30px!important;min-height:30px!important;padding:0 10px!important;border-radius:999px!important;border:1px solid color-mix(in srgb, var(--green) 42%, var(--border2))!important;background:color-mix(in srgb, var(--green) 8%, var(--bg))!important;color:var(--text)!important;font-size:11px!important;font-weight:900!important;white-space:nowrap!important;flex:0 0 auto!important;touch-action:manipulation!important;cursor:pointer!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-btn.has-items{display:inline-flex!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-btn.is-open{border-color:var(--green)!important;background:var(--green-bg)!important;color:var(--green)!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover{display:none!important;position:static!important;margin-top:8px!important;padding:10px!important;border-radius:16px!important;border:1px solid var(--border2)!important;background:linear-gradient(180deg, color-mix(in srgb, var(--card) 98%, transparent), color-mix(in srgb, var(--bg2) 92%, transparent))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)!important;box-sizing:border-box!important;overflow:hidden!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover.is-open{display:block!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover::before{display:none!important;content:none!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #food-current-meal-card{display:none!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover #food-current-meal-card{display:block!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;max-height:min(245px, 32dvh)!important;overflow-y:auto!important;overscroll-behavior:contain!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover #food-current-meal-card.is-empty{display:none!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;margin:0 0 8px 0!important;padding:0 0 8px 0!important;font-size:12px!important;color:var(--text)!important;border-bottom:1px solid var(--border2)!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-head span{font-weight:950!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-head b{min-width:24px!important;height:24px!important;border-radius:999px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;background:var(--green-bg)!important;color:var(--green)!important;font-size:11px!important;font-weight:950!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-row,
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-tile{min-width:0!important;min-height:46px!important;border-radius:13px!important;border:1px solid var(--border2)!important;background:var(--bg)!important;padding:8px 9px!important;text-align:left!important;display:flex!important;flex-direction:column!important;gap:3px!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-name{font-size:11.5px!important;font-weight:900!important;color:var(--text)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-meta,
      body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-more{font-size:10.5px!important;color:var(--text3)!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 #food-add-search-panel{display:none!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-controls{display:none!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160.food-intent-search .food-add-actions{display:block!important;width:100%!important;padding:0!important;border:0!important;margin:0!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160.food-intent-search #food-main-action-btn{width:100%!important;max-width:none!important;min-height:40px!important;height:40px!important;border-radius:14px!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160.food-intent-estimate .food-add-actions,
      body > #food-add-modal.food-add-modal.fn-add-v0160.food-intent-recipes .food-add-actions{display:none!important;}
      @media(max-width:760px){
        body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-context-bar{gap:6px!important;padding:7px 9px!important;border-radius:14px!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-current-pill{font-size:12px!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-change-btn{height:28px!important;min-height:28px!important;padding:0 10px!important;font-size:10.5px!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-choice-btn{height:32px!important;min-height:32px!important;font-size:10.5px!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-btn{height:28px!important;min-height:28px!important;padding:0 8px!important;font-size:10.5px!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover{margin-top:6px!important;padding:8px!important;border-radius:15px!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover #food-current-meal-card{max-height:min(215px, 30dvh)!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-popover .food-current-meal-list{grid-template-columns:1fr!important;gap:5px!important;}
      }
      @media(max-width:430px){
        body > #food-add-modal.food-add-modal.fn-add-v0160 .fn-meal-current-pill small{display:none!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-btn .fn-meal-content-text{display:none!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 #fn-meal-content-btn{padding:0 9px!important;}
      }
    `;
    document.head.appendChild(style);
  }

  function injectStyles(){
    injectCleanMealContextStyles();
    if ($('foodnote-add-0160-style')) return;
    const style = document.createElement('style');
    style.id = 'foodnote-add-0160-style';
    style.textContent = `
      body > #food-add-modal.food-add-modal.fn-add-v0160.is-open{
        display:flex!important;align-items:center!important;justify-content:center!important;
        padding:max(10px, env(safe-area-inset-top,0px)) 10px max(10px, env(safe-area-inset-bottom,0px)) 10px!important;
        box-sizing:border-box!important;overflow:hidden!important;
      }
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-dialog{
        width:min(1040px, calc(100vw - 20px))!important;max-width:1040px!important;
        max-height:min(96dvh, calc(100dvh - 16px))!important;height:auto!important;
        margin:auto!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;
        border-radius:24px!important;padding:10px!important;background:var(--card)!important;
        border:1px solid color-mix(in srgb, var(--border2) 88%, transparent)!important;
        box-shadow:0 26px 80px rgba(0,0,0,.42)!important;
        box-sizing:border-box!important;transform:none!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
      }
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-head{
        flex:0 0 auto!important;display:flex!important;align-items:center!important;justify-content:space-between!important;
        gap:10px!important;min-height:46px!important;margin:0 0 8px 0!important;padding:7px 8px 7px 14px!important;
        border-radius:18px!important;background:linear-gradient(180deg, color-mix(in srgb, var(--bg2) 96%, transparent), color-mix(in srgb, var(--bg) 88%, transparent))!important;
        border:1px solid color-mix(in srgb, var(--border2) 84%, transparent)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.04)!important;overflow:hidden!important;
      }
      #food-add-modal.fn-add-v0160 .fn-add-title{font-weight:950;color:var(--text);font-size:15px;line-height:1.1;padding-left:0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-close{
        position:relative!important;inset:auto!important;margin:0!important;flex:0 0 34px!important;width:34px!important;height:34px!important;
        min-width:34px!important;min-height:34px!important;border-radius:999px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;
        font-size:24px!important;line-height:1!important;z-index:5!important;
      }
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-body,
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-main{min-height:0!important;flex:1 1 auto!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;width:100%!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-intro{display:none!important;}
      body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-panel{
        min-height:0!important;flex:1 1 auto!important;overflow:hidden!important;
        display:flex!important;flex-direction:column!important;gap:9px!important;width:100%!important;padding:0!important;box-sizing:border-box!important;
      }
      body > #food-add-modal.food-add-modal.fn-add-v0160.food-intent-estimate .food-add-panel,
      body > #food-add-modal.food-add-modal.fn-add-v0160.food-intent-recipes .food-add-panel,
      body > #food-add-modal.food-add-modal.fn-add-v0160.food-scan-submodal-open .food-add-panel{
        overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch!important;
      }
      #food-add-modal.fn-add-v0160 #food-add-intent-chooser.food-add-intent-chooser{
        flex:0 0 auto!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important;margin:0!important;position:sticky!important;top:0!important;z-index:4!important;background:linear-gradient(180deg,var(--bg2),color-mix(in srgb,var(--bg2) 82%,transparent))!important;padding:1px 0 4px 0!important;
      }
      #food-add-modal.fn-add-v0160 .food-add-intent-btn{
        min-width:0!important;height:38px!important;min-height:38px!important;border-radius:14px!important;padding:0 8px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;text-align:center!important;background:var(--bg)!important;border:1px solid var(--border2)!important;color:var(--text2)!important;box-shadow:none!important;
      }
      #food-add-modal.fn-add-v0160 .food-add-intent-btn.active{background:var(--green-bg)!important;border-color:var(--green)!important;color:var(--text)!important;}
      #food-add-modal.fn-add-v0160 .food-add-intent-btn b{font-size:12px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}
      #food-add-modal.fn-add-v0160 .food-add-intent-icon,
      #food-add-modal.fn-add-v0160 .food-add-intent-sub{display:none!important;}
      #food-add-modal.fn-add-v0160 .food-add-mode-panel{display:none!important;flex:0 0 auto!important;border:1px solid var(--border2)!important;background:var(--bg)!important;border-radius:16px!important;padding:9px!important;margin:0!important;box-shadow:none!important;}
      #food-add-modal.fn-add-v0160.food-intent-search #food-add-search-panel,
      #food-add-modal.fn-add-v0160.food-intent-estimate #food-add-estimate-panel,
      #food-add-modal.fn-add-v0160.food-intent-recipes #food-add-recipes-panel{display:block!important;}
      #food-add-modal.fn-add-v0160 .fn-mode-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;}
      #food-add-modal.fn-add-v0160 .fn-mode-title strong{font-size:13px;color:var(--text);}
      #food-add-modal.fn-add-v0160 .fn-mode-title span{font-size:11px;color:var(--text3);}
      #food-add-modal.fn-add-v0160 .food-add-mode-actions{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important;margin-top:8px!important;}
      #food-add-modal.fn-add-v0160 .food-add-mode-actions button{min-width:0!important;min-height:38px!important;border-radius:13px!important;font-size:12px!important;padding:7px 8px!important;white-space:normal!important;line-height:1.15!important;}
      #food-add-modal.fn-add-v0160 .fn-estimate-submit-row{display:none!important;margin-top:8px!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate .fn-estimate-submit-row{display:none!important;}
      #food-add-modal.fn-add-v0160 .fn-estimate-submit{width:100%!important;min-height:42px!important;border-radius:14px!important;font-weight:900!important;}
      #food-add-modal.fn-add-v0160 .fn-estimate-inline-submit{display:none!important;white-space:nowrap!important;min-height:42px!important;height:42px!important;border-radius:14px!important;padding:0 14px!important;font-weight:900!important;align-items:center!important;justify-content:center!important;}
      #food-add-modal.fn-add-v0160 .fn-estimate-short{display:none!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate .db-search-wrap{grid-template-columns:minmax(0,1fr) auto!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate #db-qty{display:none!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate .fn-estimate-inline-submit{display:inline-flex!important;}
      #food-add-modal.fn-add-v0160 .journal-add-row{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(140px,180px)!important;gap:10px!important;align-items:start!important;width:100%!important;min-width:0!important;overflow:visible!important;}
      #food-add-modal.fn-add-v0160 .db-autocomplete{width:100%!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:8px!important;overflow:visible!important;}
      #food-add-modal.fn-add-v0160 .db-search-wrap{width:100%!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:7px!important;margin:0!important;min-width:0!important;}
      #food-add-modal.fn-add-v0160.food-intent-search:not(.fn-barcode-ready) .db-search-wrap{grid-template-columns:minmax(0,1fr)!important;}
      #food-add-modal.fn-add-v0160.food-intent-search:not(.fn-barcode-ready) #db-qty{display:none!important;}
      #food-add-modal.fn-add-v0160 #db-search{min-width:0!important;width:100%!important;height:42px!important;min-height:42px!important;border-radius:14px!important;font-size:14px!important;}
      #food-add-modal.fn-add-v0160 #db-qty{width:86px!important;height:42px!important;min-height:42px!important;border-radius:14px!important;}
      #food-add-modal.fn-add-v0160 .food-inline-filters{width:100%!important;display:flex;align-items:center;gap:6px!important;flex-wrap:wrap!important;margin:0!important;}
      #food-add-modal.fn-add-v0160 .food-inline-filters-label{font-size:11px;color:var(--text3);font-weight:800;margin-right:2px;}
      #food-add-modal.fn-add-v0160 .food-source-chip{height:30px!important;min-height:30px!important;border-radius:999px!important;padding:0 9px!important;font-size:11px!important;}
      #food-add-modal.fn-add-v0160 .food-add-actions{width:100%!important;display:grid!important;grid-template-columns:minmax(130px,180px) minmax(0,1fr)!important;align-items:stretch!important;gap:8px!important;padding:0!important;border:0!important;overflow:visible!important;}
      #food-add-modal.fn-add-v0160 .journal-add-btn{width:100%!important;min-height:40px!important;height:40px!important;border-radius:14px!important;}
      #food-add-modal.fn-add-v0160 .food-add-controls,
      #food-add-modal.fn-add-v0160 .food-control-section{width:100%!important;min-width:0!important;margin:0!important;padding:0!important;}
      #food-add-modal.fn-add-v0160 .food-control-label{display:none!important;}
      #food-add-modal.fn-add-v0160 .food-meal-inline{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px!important;width:100%!important;min-width:0!important;}
      #food-add-modal.fn-add-v0160 .food-meal-chip{width:100%!important;min-width:0!important;height:40px!important;min-height:40px!important;justify-content:center!important;border-radius:14px!important;padding:0 8px!important;overflow:hidden!important;}
      #food-add-modal.fn-add-v0160 .food-meal-chip b{min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font-size:12px!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate .food-add-actions,
      #food-add-modal.fn-add-v0160.food-intent-recipes .food-add-actions{display:none!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate .food-inline-filters,
      #food-add-modal.fn-add-v0160.food-intent-recipes .food-inline-filters,
      #food-add-modal.fn-add-v0160.food-intent-estimate #db-suggestions,
      #food-add-modal.fn-add-v0160.food-intent-recipes #db-suggestions,
      #food-add-modal.fn-add-v0160.food-intent-estimate #db-selected-card,
      #food-add-modal.fn-add-v0160.food-intent-recipes #db-selected-card{display:none!important;}
      #food-add-modal.fn-add-v0160.food-intent-recipes .journal-add-row{display:none!important;}
      /* 0.22.78 — Photo recette : un workflow caméra/crop/OCR ne doit jamais être
         réinterprété comme un retour à Recherche par les rafraîchissements UI différés. */
      #food-add-modal.fn-add-v0160.food-add-recipe-mode #food-add-search-panel,
      #food-add-modal.fn-add-v0160.food-add-recipe-mode #food-add-estimate-panel,
      #food-add-modal.fn-add-v0160.food-add-recipe-mode #food-add-recipes-panel,
      #food-add-modal.fn-add-v0160.food-add-recipe-mode #food-add-intent-chooser,
      #food-add-modal.fn-add-v0160.food-add-recipe-mode .quick-foods-card.fn-suggestions-card,
      #food-add-modal.fn-add-v0160.food-add-recipe-mode #db-suggestions,
      #food-add-modal.fn-add-v0160.food-add-recipe-mode #db-selected-card{display:none!important;}
      #food-add-modal.fn-add-v0160.food-add-recipe-mode #ocr-panel{display:block!important;}
      #food-add-modal.fn-add-v0160 .quick-foods-card.fn-suggestions-card{display:none;border:1px solid var(--border2)!important;background:linear-gradient(180deg, color-mix(in srgb, var(--bg) 92%, transparent), color-mix(in srgb, var(--bg2) 86%, transparent))!important;border-radius:17px!important;padding:10px!important;margin:0!important;box-shadow:none!important;width:100%!important;max-width:100%!important;overflow:hidden!important;box-sizing:border-box!important;min-height:0!important;max-height:clamp(220px, 40dvh, 420px)!important;}
      #food-add-modal.fn-add-v0160.food-intent-search.fn-suggestions-open .quick-foods-card.fn-suggestions-card{display:block!important;}
      #food-add-modal.fn-add-v0160 .quick-foods-head{display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:8px!important;margin-bottom:7px!important;}
      #food-add-modal.fn-add-v0160 .quick-foods-close-inline{display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 34px!important;width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;margin:0!important;border-radius:12px!important;border:1px solid var(--border2)!important;background:var(--bg2)!important;color:var(--text)!important;font-size:18px!important;font-weight:950!important;line-height:1!important;cursor:pointer!important;touch-action:manipulation!important;}
      #food-add-modal.fn-add-v0160 .quick-foods-title{font-size:13px!important;color:var(--text)!important;font-weight:900!important;}
      #food-add-modal.fn-add-v0160 .quick-foods-sub{font-size:11px!important;color:var(--text3)!important;line-height:1.25!important;}
      #food-add-modal.fn-add-v0160 .quick-foods-tabs{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:5px!important;margin:0 0 7px 0!important;}
      #food-add-modal.fn-add-v0160 .quick-tab{min-width:0!important;height:32px!important;border-radius:12px!important;padding:0 5px!important;font-size:11px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}
      #food-add-modal.fn-add-v0160 .quick-foods-actions{margin:0 0 6px 0!important;min-height:0!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestions-context{font-size:11px;color:var(--text3);}
      #food-add-modal.fn-add-v0160 .quick-foods-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important;max-height:min(28dvh, 300px)!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important;padding:1px 4px 2px 0!important;min-height:0!important;}
      /* 0.22.82 — Suggestions neutres + nutriments colorés : ces cartes ne sont plus des .fn-ui-row.
         On évite ainsi le double contour arrondi hérité du moteur de lignes global. */
      #food-add-modal.fn-add-v0160 .fn-suggestion-card{position:relative!important;display:grid!important;grid-template-columns:minmax(0,1fr) 34px!important;gap:6px!important;min-width:0!important;overflow:hidden!important;border:0!important;border-radius:16px!important;background:linear-gradient(135deg, color-mix(in srgb, var(--fn-add-surface, var(--bg2)) 94%, white 6%), color-mix(in srgb, var(--fn-add-soft, var(--green-bg)) 10%, var(--bg) 90%))!important;box-shadow:none!important;padding:7px!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-card:hover{background:linear-gradient(135deg, color-mix(in srgb, var(--fn-add-surface, var(--bg2)) 86%, var(--fn-add-accent, var(--green)) 14%), color-mix(in srgb, var(--bg) 92%, transparent))!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-row{min-width:0!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-card::before,#food-add-modal.fn-add-v0160 .fn-suggestion-main::before{content:none!important;display:none!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-main{min-width:0!important;text-align:left!important;border:0!important;background:transparent!important;background-image:none!important;color:var(--text)!important;border-radius:12px!important;padding:1px!important;display:flex!important;flex-direction:column!important;gap:3px!important;min-height:56px!important;box-shadow:none!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-topline{display:flex!important;align-items:center!important;gap:6px!important;min-width:0!important;width:100%!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-name{font-size:12px!important;font-weight:950!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;min-width:0!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-tag{flex:0 0 auto!important;max-width:70px!important;padding:2px 6px!important;border-radius:999px!important;background:color-mix(in srgb, var(--fn-add-accent, var(--green)) 13%, var(--bg))!important;color:color-mix(in srgb, var(--fn-add-accent, var(--green)) 65%, var(--text))!important;font-size:9px!important;font-weight:900!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-meta{font-size:10.5px!important;color:var(--text3)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-macros{display:flex!important;gap:5px!important;flex-wrap:wrap!important;font-size:9.5px!important;line-height:1.15!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-macros b{display:inline-flex!important;align-items:center!important;justify-content:center!important;font-weight:900!important;padding:3px 6px!important;border-radius:999px!important;border:1px solid color-mix(in srgb, var(--nutri-color, var(--text3)) 34%, transparent)!important;color:color-mix(in srgb, var(--nutri-color, var(--text3)) 72%, var(--text))!important;background:color-mix(in srgb, var(--nutri-color, var(--text3)) 14%, var(--bg) 86%)!important;box-shadow:none!important;white-space:nowrap!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-macros b.macro-kcal{--nutri-color:var(--fn-badge-kcal, var(--fn-macro-kcal, #854F0B))!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-macros b.macro-prot{--nutri-color:var(--fn-badge-prot, var(--fn-macro-prot, #5DCAA5))!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-macros b.macro-gluc{--nutri-color:var(--fn-badge-gluc, var(--fn-macro-gluc, #EF9F27))!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-macros b.macro-lip{--nutri-color:var(--fn-badge-lip, var(--fn-macro-lip, #7F77DD))!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-fav{border:0!important;background:color-mix(in srgb, var(--bg) 72%, transparent)!important;color:var(--text3)!important;border-radius:12px!important;font-size:17px!important;line-height:1!important;box-shadow:none!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-fav.is-fav{color:#fff!important;background:linear-gradient(135deg, var(--orange), color-mix(in srgb, var(--orange) 72%, var(--red)))!important;box-shadow:none!important;}
      #food-add-modal.fn-add-v0160 .fn-suggestion-empty{font-size:12px!important;color:var(--text3)!important;padding:10px!important;border:0!important;border-radius:16px!important;background:color-mix(in srgb, var(--bg2) 90%, var(--green-bg) 10%)!important;grid-column:1/-1!important;}
      #food-add-modal.fn-add-v0160 #groq-response,
      #food-add-modal.fn-add-v0160 #ia-preview,
      #food-add-modal.fn-add-v0160 #recipe-ai-result,
      #food-add-modal.fn-add-v0160 #recipe-ocr-result,
      #food-add-modal.fn-add-v0160 #ocr-result{max-height:none!important;overflow:visible!important;margin:0!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate #groq-response,
      #food-add-modal.fn-add-v0160.food-intent-estimate #ia-preview{border-radius:16px!important;border:1px solid var(--border2)!important;background:var(--bg)!important;padding:9px!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate.fn-add-estimate-result #food-add-estimate-panel{display:block!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate.fn-add-estimate-result #food-add-intent-chooser{display:grid!important;}
      #food-add-modal.fn-add-v0160.food-intent-estimate.food-estimate-result-active #food-add-intent-chooser,
      #food-add-modal.fn-add-v0160.food-intent-estimate.food-estimate-result-active #food-add-estimate-panel,
      #food-add-modal.fn-add-v0160.food-intent-estimate.food-estimate-result-active .journal-add-row{display:flex!important;}
      #food-add-modal.fn-add-v0160 .db-quantity-panel.visible{display:grid!important;visibility:visible!important;opacity:1!important;}
      #food-add-modal.fn-add-v0160 .db-suggestions.visible{max-height:42dvh!important;overflow-y:auto!important;border-radius:16px!important;}
      @media(max-width:760px){
        body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-dialog{width:min(520px, calc(100vw - 14px))!important;max-height:min(94dvh, calc(100dvh - 14px))!important;border-radius:20px!important;padding:8px!important;}
        body > #food-add-modal.food-add-modal.fn-add-v0160 .food-add-panel{gap:7px!important;padding:1px!important;}
        #food-add-modal.fn-add-v0160 .fn-add-title{font-size:14px;}
        #food-add-modal.fn-add-v0160 .food-add-intent-btn{height:34px!important;min-height:34px!important;border-radius:12px!important;padding:0 5px!important;}
        #food-add-modal.fn-add-v0160 .food-add-intent-btn b{font-size:11px!important;}
        #food-add-modal.fn-add-v0160 .food-add-mode-panel{padding:8px!important;border-radius:15px!important;}
        #food-add-modal.fn-add-v0160 .fn-mode-title span{display:none!important;}
        #food-add-modal.fn-add-v0160 .food-add-mode-actions{grid-template-columns:1fr!important;gap:6px!important;}
        #food-add-modal.fn-add-v0160 .food-add-mode-actions button{min-height:36px!important;font-size:12px!important;}
        #food-add-modal.fn-add-v0160 .fn-estimate-submit{min-height:38px!important;font-size:12px!important;}
        #food-add-modal.fn-add-v0160 .db-search-wrap{grid-template-columns:minmax(0,1fr)!important;gap:6px!important;}
        #food-add-modal.fn-add-v0160.food-intent-search:not(.fn-barcode-ready) #db-qty{display:none!important;}
        #food-add-modal.fn-add-v0160.food-intent-estimate .db-search-wrap{grid-template-columns:minmax(0,1fr) 74px!important;}
        #food-add-modal.fn-add-v0160 #db-search{height:38px!important;min-height:38px!important;font-size:13px!important;}
        #food-add-modal.fn-add-v0160 #db-qty{width:72px!important;height:38px!important;min-height:38px!important;font-size:12px!important;}
        #food-add-modal.fn-add-v0160 .fn-estimate-inline-submit{height:38px!important;min-height:38px!important;border-radius:13px!important;padding:0 8px!important;font-size:12px!important;}
        #food-add-modal.fn-add-v0160 .fn-estimate-full{display:none!important;}
        #food-add-modal.fn-add-v0160 .fn-estimate-short{display:inline!important;}
        #food-add-modal.fn-add-v0160 .food-source-chip{height:28px!important;min-height:28px!important;font-size:10.5px!important;padding:0 7px!important;}
        #food-add-modal.fn-add-v0160 .journal-add-row{grid-template-columns:1fr!important;gap:7px!important;}
        #food-add-modal.fn-add-v0160 .food-add-actions{grid-template-columns:1fr!important;gap:6px!important;}
        #food-add-modal.fn-add-v0160 .journal-add-btn{height:38px!important;min-height:38px!important;}
        #food-add-modal.fn-add-v0160 .food-meal-chip{height:36px!important;min-height:36px!important;padding:0 5px!important;}
        #food-add-modal.fn-add-v0160 .food-meal-chip span{font-size:13px!important;}
        #food-add-modal.fn-add-v0160 .food-meal-chip b{font-size:11px!important;}
        #food-add-modal.fn-add-v0160 .quick-foods-tabs{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:4px!important;}
        #food-add-modal.fn-add-v0160 .quick-tab{height:30px!important;font-size:10px!important;padding:0 3px!important;}
        #food-add-modal.fn-add-v0160 .quick-foods-list{grid-template-columns:1fr!important;gap:5px!important;max-height:min(20dvh, 175px)!important;}
        #food-add-modal.fn-add-v0160 .fn-suggestion-main{min-height:52px!important;padding:7px!important;}
        #food-add-modal.fn-add-v0160 .quick-foods-sub{display:none!important;}
      }
      @media(max-height:760px){
        #food-add-modal.fn-add-v0160 .quick-foods-card.fn-suggestions-card{max-height:clamp(150px, 30dvh, 260px)!important;}
        #food-add-modal.fn-add-v0160 .quick-foods-list{max-height:min(20dvh, 175px)!important;}
        #food-add-modal.fn-add-v0160 #food-current-meal-card{max-height:150px!important;overflow-y:auto!important;overscroll-behavior:contain!important;}
      }
      @media(max-width:380px){
        #food-add-modal.fn-add-v0160 .food-add-intent-btn span{display:none!important;}
        #food-add-modal.fn-add-v0160 .food-source-chip span{display:none!important;}
        #food-add-modal.fn-add-v0160 .food-meal-chip span{display:none!important;}
        #food-add-modal.fn-add-v0160 .quick-tab{font-size:9.5px!important;}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureConfirmBarPlacement(){
    const modal = $('food-add-modal');
    const panel = q('#food-add-modal .food-add-panel');
    const actions = q('#food-add-modal .food-add-actions');
    if (!modal || !panel || !actions) return;
    actions.classList.add('fn-add-confirm-bar');
    if (actions.parentElement !== panel) {
      try { panel.appendChild(actions); } catch(e) {}
    }
  }

  function wrapFunctions(){
    if (!originalSetFoodAddMode && typeof window.setFoodAddMode === 'function') originalSetFoodAddMode = window.setFoodAddMode;

    if (!MODAL_CONTROLLER_OWNS_POPUP && !originalOpenFoodAddModal && typeof window.openFoodAddModal === 'function') {
      originalOpenFoodAddModal = window.openFoodAddModal;
      window.openFoodAddModal = function(){
        suppressFocusUntil = Date.now() + 900;
        popupOpenToken++;
        resetSuggestionsDismissed();
        const out = originalOpenFoodAddModal.apply(this, arguments);
        runAfterPaint(() => {
          initPopup({ deferSuggestions:true });
          if (!quantityFlowActive() && !workflowActive()) { setIntent('search', { deferSuggestions:true }); blurSearchSoon(); }
          else applyIntentOnly();
          schedulePopupRefresh('open', 120);
        });
        return out;
      };
    } else if (MODAL_CONTROLLER_OWNS_POPUP && !originalOpenFoodAddModal && typeof window.openFoodAddModal === 'function') {
      originalOpenFoodAddModal = window.openFoodAddModal;
    }

    if (!MODAL_CONTROLLER_OWNS_POPUP && !originalCloseFoodAddModal && typeof window.closeFoodAddModal === 'function') {
      originalCloseFoodAddModal = window.closeFoodAddModal;
      window.closeFoodAddModal = function(){
        endWorkflow();
        return originalCloseFoodAddModal.apply(this, arguments);
      };
    } else if (MODAL_CONTROLLER_OWNS_POPUP && !originalCloseFoodAddModal && typeof window.closeFoodAddModal === 'function') {
      originalCloseFoodAddModal = window.closeFoodAddModal;
    }

    if (!MODAL_CONTROLLER_OWNS_POPUP && !originalOpenFoodRecipePhotoOption && typeof window.openFoodRecipePhotoOption === 'function') {
      originalOpenFoodRecipePhotoOption = window.openFoodRecipePhotoOption;
      window.openFoodRecipePhotoOption = function(){
        beginWorkflow('recipe_ocr', 180000);
        const out = originalOpenFoodRecipePhotoOption.apply(this, arguments);
        beginWorkflow('recipe_ocr', 180000);
        return out;
      };
    } else if (MODAL_CONTROLLER_OWNS_POPUP && !originalOpenFoodRecipePhotoOption && typeof window.openFoodRecipePhotoOption === 'function') {
      originalOpenFoodRecipePhotoOption = window.openFoodRecipePhotoOption;
    }

    if (!MODAL_CONTROLLER_OWNS_POPUP && !originalProcessRecipeOCRImage && typeof window.processRecipeOCRImage === 'function') {
      originalProcessRecipeOCRImage = window.processRecipeOCRImage;
      window.processRecipeOCRImage = async function(){
        beginWorkflow('recipe_ocr', 180000);
        try { return await originalProcessRecipeOCRImage.apply(this, arguments); }
        finally { beginWorkflow('recipe_ocr', 180000); }
      };
    } else if (MODAL_CONTROLLER_OWNS_POPUP && !originalProcessRecipeOCRImage && typeof window.processRecipeOCRImage === 'function') {
      originalProcessRecipeOCRImage = window.processRecipeOCRImage;
    }
    if (!originalHandleDBSearchInput && typeof window.handleDBSearchInput === 'function') {
      originalHandleDBSearchInput = window.handleDBSearchInput;
      window.handleDBSearchInput = function(){
        if (quantityFlowActive()) return;
        const out = originalHandleDBSearchInput.apply(this, arguments);
        const input = $('db-search');
        if (!(input && input.value && input.value.trim())) scheduleRenderSuggestions(20);
        return out;
      };
    }
    if (!originalEstimerGroq && typeof window.estimerGroq === 'function') {
      originalEstimerGroq = window.estimerGroq;
      window.estimerGroq = async function(){
        setIntent('estimate', { keepText:true });
        const out = originalEstimerGroq.apply(this, arguments);
        try { if (out && typeof out.then === 'function') await out; } finally { showEstimateResult(); }
        return out;
      };
    }
    if (!originalImporterGroq && typeof window.importerReponseGroq === 'function') {
      originalImporterGroq = window.importerReponseGroq;
      window.importerReponseGroq = function(){
        const out = originalImporterGroq.apply(this, arguments);
        setTimeout(showEstimateResult, 40);
        return out;
      };
    }
    if (!originalParseIAPaste && typeof window.parseIAPaste === 'function') {
      originalParseIAPaste = window.parseIAPaste;
      window.parseIAPaste = function(){
        const out = originalParseIAPaste.apply(this, arguments);
        setTimeout(showEstimateResult, 40);
        return out;
      };
    }

    // Depuis 0.22.98, si le contrôleur possède le popup, la fermeture passe
    // uniquement par sa délégation centrale. On garde ce fallback seulement
    // pour les anciennes bases sans contrôleur.
    if (!MODAL_CONTROLLER_OWNS_POPUP) {
      const close = q('#food-add-modal .food-add-close');
      if (close && !close.__fn0160CloseBound) {
        close.addEventListener('pointerup', ev => { ev.preventDefault(); ev.stopPropagation(); try { window.closeFoodAddModal && window.closeFoodAddModal(); } catch(e) {} }, true);
        close.__fn0160CloseBound = true;
      }
    }
  }

  function modalIsOpen(){
    const modal = $('food-add-modal');
    return !!(modal && modal.classList.contains('is-open'));
  }

  function init(forceHeavy, options = {}){
    // Initialisation légère au démarrage : styles + wrappers seulement.
    // Le rendu complet du popup et des suggestions est coûteux et ne sert
    // que lorsque le popup Ajouter est ouvert.
    injectStyles();
    wrapFunctions();
    if (forceHeavy || modalIsOpen()) {
      ensureUI();
      applyIntentOnly();
      relabelMealButtons();
      updateMealContextUI();
      scheduleConfirmButtonUI(0);
      if (!options.deferSuggestions && !quantityFlowActive()) scheduleRenderSuggestions(90);
    }
    initialized = true;
  }

  function initLight(){ init(false); }
  function initPopup(options){ init(true, options || {}); }

  document.addEventListener('DOMContentLoaded', initLight);
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    const inModal = target && target.closest && target.closest('#food-add-modal');
    const mealBtn = target && target.closest && target.closest('#food-add-modal .food-meal-chip[data-food-meal]');
    if (mealBtn) schedulePopupRefresh('meal', 70);
    const mainAction = target && target.closest && target.closest('#food-main-action-btn');
    if (mainAction) {
      updateConfirmButtonUI();
      if (mainAction.disabled || mainAction.getAttribute('aria-disabled') === 'true') {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      // 0.22.118 : pas de refresh complet du popup pendant l'ajout au journal.
      // Les modules domaine/journal font déjà l'ajout et les rendus différés.
      scheduleConfirmButtonUI(160);
    }
    if (target && target.closest && !target.closest('#fn-meal-context-wrap')) {
      closeMealPicker();
      closeMealContentPanel();
    }
    if (inModal && modalIsOpen()) {
      runAfterPaint(() => updateMealContextUI());
    }
  }, true);
  document.addEventListener('input', (ev) => {
    if (ev.target && ev.target.id === 'db-search') {
      scheduleConfirmButtonUI(0);
      if (!quantityFlowActive()) scheduleRenderSuggestions(80);
    }
  }, true);
  window.addEventListener('resize', () => { if (modalIsOpen()) { relabelMealButtons(); if (!quantityFlowActive()) scheduleRenderSuggestions(120); } }, { passive:true });
  // Plus de réinitialisations lourdes répétées au démarrage : elles causaient ~900 ms de blocage chacune.
  runWhenIdle(initLight, 1200);

  window.FoodNoteAddV0160 = {
    build: BUILD,
    init: initPopup,
    setIntent,
    focusEstimateText: focusEstimate,
    runEstimate,
    setSuggestionTab,
    renderSuggestions,
    dismissSuggestions,
    addSuggestion: addSuggestionItem,
    toggleFavorite(encoded){ try { toggleFavorite(JSON.parse(decodeURIComponent(encoded))); } catch(e) {} },
    clearEstimateResult,
    beginWorkflow,
    endWorkflow,
    workflowActive,
    updateMealContextUI,
    toggleMealContentPanel,
    get currentIntent(){ return currentIntent; },
    get suggestionTab(){ return suggestionTab; }
  };
})();
