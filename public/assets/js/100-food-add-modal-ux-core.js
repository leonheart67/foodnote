// FoodNote beta 0.22.113 — SUGGESTIONS_TINT_POLISH
// Couche UX sûre pour le popup Ajouter : teinte des suggestions renforcée, sans logique continue.
// Règle : pas de MutationObserver, pas de boucle, pas de recalcul permanent.
(function(){
  'use strict';

  const CORE = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const $ = (id) => document.getElementById(id);
  const qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  let installed = false;
  let refreshPending = false;
  let lastRefreshAt = 0;

  function modal(){
    return $('food-add-modal');
  }

  function normalizeDisabledMainAction(m){
    const btn = $('food-main-action-btn');
    if (!btn || !m || !m.classList.contains('food-intent-search')) return;

    const disabled = !!btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('fn-add-confirm-disabled');
    if (!disabled) return;

    const wanted = 'Sélectionne un aliment ci-dessus pour continuer';
    const txt = String(btn.textContent || '').trim();
    if (/choisis un aliment|sélectionne un aliment|aliment ci-dessus/i.test(txt) && txt !== wanted) {
      btn.textContent = wanted;
    }
    btn.setAttribute('aria-label', wanted);
  }

  function annotateSourceChips(m){
    qa('[data-source-filter]', m).forEach(btn => {
      const src = btn.getAttribute('data-source-filter') || '';
      const label = src === 'off' ? 'OpenFoodFacts' : src === 'ciq' ? 'CIQUAL' : 'Base locale';
      const active = btn.classList.contains('active') || btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.title = (active ? 'Source active : ' : 'Source inactive : ') + label;
    });
  }

  function refresh(reason){
    refreshPending = false;
    const now = Date.now();
    if (now - lastRefreshAt < 60) return;
    lastRefreshAt = now;

    const m = modal();
    if (!m) return;

    m.classList.add('fn-food-add-ux-core', 'fn-food-add-ux-safe-polish', 'fn-food-add-unified-suggestion-layout');
    m.dataset.fnFoodAddUxCore = '1';
    m.dataset.fnFoodAddUxSafe = '1';
    m.dataset.fnFoodAddUnifiedSuggestions = '1';
    if (reason) m.dataset.fnFoodAddUxLastReason = String(reason).slice(0, 32);

    normalizeDisabledMainAction(m);
    annotateSourceChips(m);
  }

  function scheduleRefresh(reason){
    if (refreshPending) return;
    refreshPending = true;
    window.requestAnimationFrame(() => {
      try { refresh(reason || 'event'); }
      catch(e) { console.warn('[FoodNote] UX modal safe refresh impossible', e); }
    });
  }

  function onScopedEvent(event){
    const target = event && event.target;
    if (!target || !target.closest || !target.closest('#food-add-modal')) return;
    scheduleRefresh(event.type);
  }

  function install(){
    if (installed) return;
    installed = true;

    scheduleRefresh('install');
    window.addEventListener('load', () => scheduleRefresh('load'), {once:true});

    // Événements ponctuels seulement. Aucune surveillance continue du DOM.
    document.addEventListener('click', onScopedEvent, {passive:true});
    document.addEventListener('input', onScopedEvent, {passive:true});
    document.addEventListener('change', onScopedEvent, {passive:true});
    document.addEventListener('keydown', (event) => {
      if (event && event.key === 'Tab') onScopedEvent(event);
    }, {passive:true});
  }

  function health(){
    const m = modal();
    const issues = [];
    const cssLoaded = !!document.querySelector('link[href*="100-food-add-modal-ux-core.css"]');
    if (!m) issues.push('modal_missing');
    if (m && !m.classList.contains('fn-food-add-managed')) issues.push('modal_controller_missing');
    if (!cssLoaded) issues.push('css_not_loaded');

    return {
      core: CORE,
      installed,
      classApplied: !!(m && m.classList.contains('fn-food-add-ux-safe-polish')),
      observerEnabled: false,
      intervalEnabled: false,
      freezeFix: true,
      safePolish: true,
      predictionsLayoutFix: true,
      stableDialogSize: true,
      hardeningCheckpoint: true,
      unifiedSuggestionLayout: true,
      suggestionsDifferentiatedByBackgroundOnly: true,
      suggestionTintPolish: true,
      refreshMode: 'requestAnimationFrame_on_user_events_only',
      dialogMaxTarget: 980,
      unifiedSuggestionClassApplied: !!(m && m.classList.contains('fn-food-add-unified-suggestion-layout')),
      sourceChips: m ? qa('[data-source-filter]', m).length : 0,
      quickSuggestionCards: m ? qa('#quick-foods-list .fn-suggestion-card', m).length : 0,
      dbSuggestionCards: m ? qa('#db-suggestions .db-suggestion', m).length : 0,
      disabledMainText: $('food-main-action-btn') ? String($('food-main-action-btn').textContent || '').trim() : '',
      issues
    };
  }

  window.FoodNoteFoodAddModalUX = { version: CORE, refresh: () => refresh('manual'), scheduleRefresh, health };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
