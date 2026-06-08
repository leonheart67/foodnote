/*
 * FoodNote — diagnostic Ajouter / recherche / quantité.
 * Rôle : exposer un audit passif du flux Ajouter pour vérifier les modules chargés,
 *        l'état de la recherche intégrée et le sélecteur de quantité.
 * Gère : diagnostics console, fonctions health/audit, compatibilité des anciens alias.
 * Ne doit pas gérer : clics utilisateur, quantité, sauvegarde, rendu CSS, timers correctifs,
 *                     observateurs MutationObserver ou style inline.
 */
(function FoodNoteFoodAddHealthDiagnostics(){
  'use strict';

  const VERSION = 'foodnote_beta_0_24_js_health_cleanup_20260608';
  const installedAt = Date.now();
  const $ = (id) => document.getElementById(id);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  window.__FoodNoteFoodAddHealthDiagnosticsLoaded = true;
  window.__FoodNoteFoodAddHardeningScriptLoaded = true; // alias conservé pour vieux contrôles console.

  function safeCall(obj, method){
    try {
      if (obj && typeof obj[method] === 'function') return obj[method]();
    } catch(e) {
      return { error: e && e.message ? e.message : String(e) };
    }
    return null;
  }

  function modal(){ return $('food-add-modal'); }

  function getModalHealth(){
    return safeCall(window.FoodNoteFoodAddModal || window.FoodNoteFoodAddModalController, 'health')
      || safeCall(window.FoodNoteFoodAddModalController, 'audit');
  }

  function getDomainHealth(){
    return safeCall(window.FoodNoteFoodAddDomain, 'health')
      || safeCall(window.FoodNoteFoodAddDomain, 'audit');
  }

  function getCaptureHealth(){
    return safeCall(window.FoodNoteFoodCaptureFlows, 'health')
      || safeCall(window.FoodNoteFoodCaptureFlows, 'audit');
  }

  function integratedSearchStatus(){
    const input = $('db-search');
    const suggestions = $('db-suggestions');
    const selectedCard = $('db-selected-card');
    const quantityPanel = $('db-quantity-panel');
    const state = window.FoodNoteFoodAddSearchState || null;
    const hasSearchHandler = typeof window.handleDBSearchInput === 'function';
    const hasPickHandler = typeof window.pickDBSuggestion === 'function';
    const hasQuantityOpen = typeof window.openDBQuantitySelector === 'function';
    const hasQuantityConfirm = typeof window.confirmDBQuantitySelection === 'function';
    return {
      mode: 'integrated',
      input: !!input,
      suggestions: !!suggestions,
      selectedCard: !!selectedCard,
      quantityPanel: !!quantityPanel,
      searchStateBridge: !!state,
      handleDBSearchInput: hasSearchHandler,
      pickDBSuggestion: hasPickHandler,
      openDBQuantitySelector: hasQuantityOpen,
      confirmDBQuantitySelection: hasQuantityConfirm,
      suggestionCount: suggestions ? qa('[data-food-add-action="search-pick"], .db-suggestion', suggestions).length : 0,
      ok: !!input && !!suggestions && !!state && hasSearchHandler && hasPickHandler && hasQuantityOpen && hasQuantityConfirm,
      note: 'Recherche intégrée dans 30-nutrition-foods.js avec validation domaine dans 97-food-add-domain-core.js.'
    };
  }

  function getSearchHealth(){
    return integratedSearchStatus();
  }

  function getUxHealth(){
    return safeCall(window.FoodNoteFoodAddModalUX, 'health');
  }

  function inlineHandlerCount(){
    const m = modal();
    if (!m) return 0;
    return qa('[onclick], [onpointerdown], [ontouchstart], [oninput], [onchange]', m).length;
  }

  function collectIssues(parts){
    const issues = [];
    const m = modal();
    const modalHealth = parts.modalHealth || {};
    const uxHealth = parts.uxHealth || {};
    const searchHealth = parts.searchHealth || {};

    if (!m) issues.push('modal_missing');
    if (!window.FoodNoteFoodAddModalController) issues.push('modal_controller_missing');
    if (!window.FoodNoteFoodAddDomain) issues.push('domain_core_missing');
    if (!window.FoodNoteFoodCaptureFlows) issues.push('capture_flows_missing');
    if (!(searchHealth && searchHealth.ok)) issues.push('integrated_search_incomplete');
    if (!window.FoodNoteFoodAddModalUX) issues.push('ux_core_missing');
    if (inlineHandlerCount() > 0) issues.push('inline_handlers_inside_modal:' + inlineHandlerCount());
    if (modalHealth && modalHealth.knownSurfaces && modalHealth.knownSurfaces.observerEnabled) issues.push('controller_observer_enabled');
    if (uxHealth && uxHealth.observerEnabled) issues.push('ux_observer_enabled');
    if (uxHealth && uxHealth.intervalEnabled) issues.push('ux_interval_enabled');

    [modalHealth, parts.domainHealth, parts.captureHealth, searchHealth, uxHealth].forEach(h => {
      if (h && Array.isArray(h.issues)) h.issues.filter(Boolean).forEach(it => issues.push('nested:' + it));
    });
    return Array.from(new Set(issues));
  }

  function health(){
    const parts = {
      modalHealth: getModalHealth(),
      domainHealth: getDomainHealth(),
      captureHealth: getCaptureHealth(),
      searchHealth: getSearchHealth(),
      uxHealth: getUxHealth()
    };
    const m = modal();
    const out = {
      version: VERSION,
      installedAt,
      installed: true,
      diagnostic: 'FOOD_ADD_HEALTH_DIAGNOSTICS',
      passive: true,
      noRuntimePatch: true,
      modalExists: !!m,
      modalView: m ? (m.dataset.fnModalView || m.dataset.fnModalMode || '') : '',
      inlineHandlersInsideModal: inlineHandlerCount(),
      modules: {
        modal: !!window.FoodNoteFoodAddModalController,
        domain: !!window.FoodNoteFoodAddDomain,
        capture: !!window.FoodNoteFoodCaptureFlows,
        integratedSearch: !!(parts.searchHealth && parts.searchHealth.ok),
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
      console[h.ok ? 'info' : 'warn']('[FoodAddHealth]', h.ok ? 'OK' : 'points à vérifier', h);
    } catch(e) {}
    return h;
  }

  const api = { version: VERSION, loaded: true, passive: true, health, audit: health, print };
  window.FoodNoteFoodAddDiagnostics = api;
  window.FoodNoteFoodAddHealthModule = api;
  window.FoodNoteFoodAddHealth = health;
  window.FoodAddHealth = health;
  window.FoodNoteFoodAddHardening = api; // compatibilité console / anciens smoke tests.

  function install(){
    try { window.dispatchEvent(new CustomEvent('foodnote:food-add-health:ready', { detail: health() })); } catch(e) {}
    console.info('[FoodAddHealth] diagnostic passif chargé', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
