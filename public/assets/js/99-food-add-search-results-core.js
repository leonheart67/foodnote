/* FoodNote beta 0.22.111 — HARDENING_GLOBAL_FIX
 * Façade propre pour résultats de recherche / suggestions rapides du popup Ajouter.
 * 0.22.109 : désactive l'observation DOM continue ; les résultats récents sont déjà rendus sans inline handlers.
 */
(function FoodNoteFoodAddSearchResultsCore(){
  'use strict';

  const VERSION = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const installedAt = Date.now();
  const locks = Object.create(null);
  const runtime = {
    lastAction: '',
    lastIndex: -1,
    lastError: '',
    blockedActions: 0,
    sanitizedNodes: 0
  };

  const $ = (id) => document.getElementById(id);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const now = () => Date.now();

  function stateBridge(){
    return window.FoodNoteFoodAddSearchState || null;
  }

  function modal(){
    return $('food-add-modal');
  }

  function withLock(key, task, ms = 450){
    const id = String(key || 'search-results');
    const until = Number(locks[id] || 0);
    if (until && until > now()) {
      runtime.blockedActions += 1;
      return null;
    }
    locks[id] = now() + Math.max(220, Number(ms) || 450);
    setTimeout(() => {
      if (Number(locks[id] || 0) <= now()) delete locks[id];
    }, Math.max(240, Number(ms) || 450) + 40);
    try { return task(); }
    catch(e) {
      runtime.lastError = e && e.message ? e.message : String(e);
      throw e;
    }
  }

  function decodePayload(raw){
    if (!raw) return null;
    try { return JSON.parse(decodeURIComponent(String(raw))); }
    catch(e) {
      try { return JSON.parse(String(raw)); }
      catch(e2) { return null; }
    }
  }

  function scheduleModalReconcile(reason){
    try {
      const ctl = window.FoodNoteFoodAddModal || window.FoodNoteFoodAddModalController;
      if (ctl && typeof ctl.reconcile === 'function') ctl.reconcile(reason || 'search-results');
      else window.dispatchEvent(new CustomEvent('foodnote:food-add-search-results:changed', { detail: snapshot() }));
    } catch(e) {}
  }

  function pick(index){
    return withLock('pick-' + index, () => {
      const idx = Number(index);
      runtime.lastAction = 'pick';
      runtime.lastIndex = idx;
      runtime.lastError = '';
      if (!Number.isInteger(idx) || idx < 0) return null;
      const st = stateBridge();
      if (st && typeof st.pickSuggestion === 'function') {
        const out = st.pickSuggestion(idx);
        scheduleModalReconcile('search-pick');
        return out;
      }
      if (typeof window.pickDBSuggestion === 'function') {
        const out = window.pickDBSuggestion(idx);
        scheduleModalReconcile('search-pick-legacy');
        return out;
      }
      runtime.lastError = 'Aucun gestionnaire de résultat de recherche.';
      return null;
    }, 520);
  }

  function addHistoryItem(item){
    if (!item || !item.nom) return null;
    runtime.lastAction = 'history-add';
    runtime.lastError = '';

    // Le chemin le plus propre ouvre le sélecteur quantité quand les macros sont connues.
    if (typeof window.openFoodFromSuggestionItem === 'function') {
      const out = window.openFoodFromSuggestionItem(item);
      scheduleModalReconcile('history-add-open');
      return out;
    }

    // Fallback historique : ajoute directement la ligne.
    if (typeof window.addFoodFromHistoryItem === 'function') {
      const out = window.addFoodFromHistoryItem(item);
      scheduleModalReconcile('history-add-legacy');
      return out;
    }

    runtime.lastError = 'Aucun gestionnaire de suggestion rapide.';
    return null;
  }

  function addHistoryPayload(rawPayload){
    return withLock('history-add', () => {
      const item = decodePayload(rawPayload);
      if (!item || !item.nom) {
        runtime.lastError = 'Suggestion rapide illisible.';
        return null;
      }
      return addHistoryItem(item);
    }, 900);
  }

  function clear(){
    const st = stateBridge();
    if (st && typeof st.clearSuggestions === 'function') {
      try { st.clearSuggestions(); } catch(e) {}
    }
    const suggestions = $('db-suggestions');
    if (suggestions) {
      suggestions.innerHTML = '';
      suggestions.classList.remove('visible');
      suggestions.setAttribute('aria-hidden', 'true');
    }
    const selected = $('db-selected-card');
    if (selected) {
      selected.innerHTML = '';
      selected.classList.remove('visible');
    }
    try { stateBridge() && stateBridge().clearSelection && stateBridge().clearSelection(); } catch(e) {}
    scheduleModalReconcile('search-clear');
  }

  function sanitizeLegacyInlineHandlers(root = document){
    let count = 0;
    qa('#db-suggestions [data-food-add-action="search-pick"], #quick-foods-card [data-food-add-action="history-add"]', root).forEach(el => {
      if (!el) return;
      if (el.getAttribute('onclick')) { el.removeAttribute('onclick'); count += 1; }
      if (el.getAttribute('onpointerdown')) { el.removeAttribute('onpointerdown'); count += 1; }
      if (el.getAttribute('ontouchstart')) { el.removeAttribute('ontouchstart'); count += 1; }
    });
    runtime.sanitizedNodes += count;
    return count;
  }

  function observeDynamicResults(){
    // 0.22.109 : volontairement inactif.
    // Les résultats de recherche sont rendus avec data-food-add-action dès la source ;
    // observer tout le document pour retirer d'anciens handlers n'apporte plus assez
    // de valeur et ajoute un risque de surcharge sur une zone qui rerend souvent.
    return false;
  }

  function bindKeyboardActivation(){
    if (document.__fnFoodAddSearchResultsKeyboard) return;
    document.addEventListener('keydown', (ev) => {
      const target = ev.target;
      if (!target || !target.matches || !target.matches('#db-suggestions [data-food-add-action="search-pick"]')) return;
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      ev.stopPropagation();
      pick(target.dataset.searchIndex || target.dataset.index || -1);
    }, true);
    document.__fnFoodAddSearchResultsKeyboard = true;
  }

  function inlineHandlerCount(){
    return qa('#db-suggestions .db-suggestion[onclick], #db-suggestions .db-suggestion[onpointerdown], #quick-foods-card .quick-food-chip[onclick], #quick-foods-card .quick-food-chip[onpointerdown]').length;
  }

  function snapshot(){
    const st = stateBridge();
    let bridgeSnap = null;
    try { bridgeSnap = st && typeof st.snapshot === 'function' ? st.snapshot() : null; } catch(e) {}
    return {
      version: VERSION,
      installedAt,
      hasStateBridge: !!st,
      hasPickBridge: !!(st && typeof st.pickSuggestion === 'function'),
      hasSuggestionGetter: !!(st && typeof st.getSuggestions === 'function'),
      bridge: bridgeSnap,
      inlineHandlers: inlineHandlerCount(),
      actionResults: qa('#db-suggestions [data-food-add-action="search-pick"]').length,
      quickHistoryActions: qa('#quick-foods-card [data-food-add-action="history-add"]').length,
      lastAction: runtime.lastAction,
      lastIndex: runtime.lastIndex,
      lastError: runtime.lastError,
      blockedActions: runtime.blockedActions,
      sanitizedNodes: runtime.sanitizedNodes,
      observerEnabled: false,
      continuousDomScan: false
    };
  }

  function collectIssues(){
    const issues = [];
    const snap = snapshot();
    if (!snap.hasStateBridge) issues.push('search_state_bridge_missing');
    if (!snap.hasPickBridge && typeof window.pickDBSuggestion !== 'function') issues.push('search_pick_missing');
    if (snap.inlineHandlers > 0) issues.push('legacy_inline_search_handlers_present');
    if (modal() && snap.actionResults === 0 && snap.bridge && snap.bridge.suggestionCount > 0) issues.push('search_results_without_action_delegate');
    return issues;
  }

  function audit(){
    const snap = snapshot();
    snap.issues = collectIssues();
    return snap;
  }

  function install(){
    sanitizeLegacyInlineHandlers(document);
    // Pas d'observation continue : la stabilité prime sur le nettoyage dynamique.
    observeDynamicResults();
    bindKeyboardActivation();
    try { window.dispatchEvent(new CustomEvent('foodnote:food-add-search-results:ready', { detail:audit() })); } catch(e) {}
    console.info('[FoodAddSearchResults] chargé', VERSION);
  }

  window.FoodNoteFoodAddSearchResults = {
    version: VERSION,
    decodePayload,
    pick,
    addHistoryItem,
    addHistoryPayload,
    clear,
    sanitizeLegacyInlineHandlers,
    audit,
    health: audit,
    install
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
