/* FoodNote beta 0.22.146 — Mobile Bottom Add Hub
   Le + mobile devient le hub d'ajout principal : recherche, code-barres, photo, tableau, recette, IA texte + sport. */
(function(){
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const NAV_ID = 'foodnote-mobile-nav-shell';
  let root = null;
  let refreshTimer = null;
  let toastTimer = null;
  let observer = null;
  let wrappedShowPage = false;

  function byId(id){ return document.getElementById(id); }

  function isMobileViewport(){
    try {
      return window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
    } catch(e) {
      return window.innerWidth <= 820;
    }
  }

  function currentPageId(){
    const active = document.querySelector('.page.active');
    if (!active || !active.id) return 'journal';
    return String(active.id).replace(/^page-/, '') || 'journal';
  }

  function icon(cls, fallback){
    return `<i class="ti ${cls}" aria-hidden="true"></i><span class="fn-mobile-nav-emoji" aria-hidden="true">${fallback}</span>`;
  }

  function build(){
    if (root) return root;
    root = document.createElement('nav');
    root.id = NAV_ID;
    root.className = 'fn-mobile-bottom-nav';
    root.setAttribute('aria-label', 'Navigation mobile FoodNote');
    root.innerHTML = `
      <div class="fn-mobile-bubble-backdrop" data-fn-mobile-close-panels aria-hidden="true"></div>

      <div class="fn-mobile-action-bubble fn-mobile-add-hub" id="foodnote-mobile-action-bubble" aria-hidden="true" role="dialog" aria-label="Ajouter">
        <div class="fn-mobile-bubble-tail" aria-hidden="true"></div>
        <div class="fn-mobile-add-head">
          <strong>Ajouter</strong>
          <small>Choisis une méthode. Le repas sera demandé si besoin.</small>
        </div>
        <div class="fn-mobile-add-grid">
          <button type="button" class="fn-mobile-action-choice is-primary" data-fn-mobile-capture="search">
            ${icon('ti-search', '🔎')}
            <span><b>Rechercher</b><small>Base, CIQUAL, OpenFoodFacts</small></span>
          </button>
          <button type="button" class="fn-mobile-action-choice" data-fn-mobile-capture="barcode">
            ${icon('ti-barcode', '🏷️')}
            <span><b>Code-barres</b><small>Produit emballé</small></span>
          </button>
          <button type="button" class="fn-mobile-action-choice" data-fn-mobile-capture="photo_food">
            ${icon('ti-camera', '📷')}
            <span><b>Photo plat</b><small>Estimation IA</small></span>
          </button>
          <button type="button" class="fn-mobile-action-choice" data-fn-mobile-capture="nutrition_table">
            ${icon('ti-table', '📊')}
            <span><b>Tableau</b><small>OCR nutritionnel</small></span>
          </button>
          <button type="button" class="fn-mobile-action-choice" data-fn-mobile-capture="recipe">
            ${icon('ti-tools-kitchen-2', '🍲')}
            <span><b>Recette</b><small>Plat complet</small></span>
          </button>
          <button type="button" class="fn-mobile-action-choice" data-fn-mobile-capture="ia_text">
            ${icon('ti-sparkles', '⚡')}
            <span><b>IA texte</b><small>Coller un repas</small></span>
          </button>
          <button type="button" class="fn-mobile-action-choice fn-mobile-action-sport" data-fn-mobile-plus="sport">
            ${icon('ti-run', '🏃')}
            <span><b>Sport</b><small>Activité / calories</small></span>
          </button>
        </div>
      </div>

      <div class="fn-mobile-bilan-sheet" id="foodnote-mobile-bilan-sheet" aria-hidden="true" role="dialog" aria-label="Bilan">
        <div class="fn-mobile-bilan-head">
          <div><strong>Bilan</strong><small>Vue rapide ou tendances</small></div>
          <button type="button" class="fn-mobile-bilan-close" data-fn-mobile-close-panels aria-label="Fermer le bilan">×</button>
        </div>
        <div class="fn-mobile-bilan-grid">
          <button type="button" class="fn-mobile-bilan-choice" data-fn-mobile-page="recap">
            ${icon('ti-clipboard-check', '✅')}
            <b>Récap</b><small>Résumé du jour, alertes et conseils.</small>
          </button>
          <button type="button" class="fn-mobile-bilan-choice" data-fn-mobile-page="stats">
            ${icon('ti-chart-bar', '📊')}
            <b>Stats</b><small>Courbes, semaine, mois et tendances.</small>
          </button>
        </div>
      </div>

      <div class="fn-mobile-nav-toast" aria-live="polite" aria-hidden="true"></div>

      <div class="fn-mobile-nav-bar">
        <button type="button" class="fn-mobile-nav-btn" data-fn-mobile-page="journal" aria-label="Journal">
          ${icon('ti-notebook', '🍽')}<span>Journal</span>
        </button>
        <button type="button" class="fn-mobile-nav-btn" data-fn-mobile-page="objectif" aria-label="Objectifs">
          ${icon('ti-target-arrow', '🎯')}<span>Objectifs</span>
        </button>
        <button type="button" class="fn-mobile-nav-btn fn-mobile-nav-add" data-fn-mobile-action="add" aria-haspopup="dialog" aria-expanded="false" aria-controls="foodnote-mobile-action-bubble" aria-label="Ajouter">
          ${icon('ti-plus', '+')}<span>Ajouter</span>
        </button>
        <button type="button" class="fn-mobile-nav-btn" data-fn-mobile-action="bilan" aria-haspopup="dialog" aria-expanded="false" aria-controls="foodnote-mobile-bilan-sheet" aria-label="Bilan">
          ${icon('ti-chart-dots-3', '📈')}<span>Bilan</span>
        </button>
        <button type="button" class="fn-mobile-nav-btn" data-fn-mobile-action="menu" aria-label="Menu">
          ${icon('ti-menu-2', '☰')}<span>Menu</span>
        </button>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    return root;
  }

  function setExpanded(action, open){
    if (!root) return;
    const btn = root.querySelector(`[data-fn-mobile-action="${action}"]`);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closePanels(){
    if (!root) return;
    root.classList.remove('is-bilan-open', 'is-action-open');
    const bilan = byId('foodnote-mobile-bilan-sheet');
    const action = byId('foodnote-mobile-action-bubble');
    if (bilan) bilan.setAttribute('aria-hidden', 'true');
    if (action) action.setAttribute('aria-hidden', 'true');
    setExpanded('bilan', false);
    setExpanded('add', false);
  }

  function toggleBilan(){
    build();
    const open = !root.classList.contains('is-bilan-open');
    root.classList.toggle('is-bilan-open', open);
    root.classList.remove('is-action-open');
    const sheet = byId('foodnote-mobile-bilan-sheet');
    const action = byId('foodnote-mobile-action-bubble');
    if (sheet) sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (action) action.setAttribute('aria-hidden', 'true');
    setExpanded('bilan', open);
    setExpanded('add', false);
  }

  function toggleActionBubble(){
    build();
    const open = !root.classList.contains('is-action-open');
    root.classList.toggle('is-action-open', open);
    root.classList.remove('is-bilan-open');
    const action = byId('foodnote-mobile-action-bubble');
    const sheet = byId('foodnote-mobile-bilan-sheet');
    if (action) action.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (sheet) sheet.setAttribute('aria-hidden', 'true');
    setExpanded('add', open);
    setExpanded('bilan', false);
  }

  function showToast(message){
    build();
    const t = root.querySelector('.fn-mobile-nav-toast');
    if (!t) return;
    clearTimeout(toastTimer);
    t.textContent = String(message || '');
    t.setAttribute('aria-hidden', 'false');
    root.classList.add('is-toast-open');
    toastTimer = setTimeout(() => {
      root.classList.remove('is-toast-open');
      t.setAttribute('aria-hidden', 'true');
    }, 2200);
  }

  function navigate(page){
    closePanels();
    if (!page) return;
    try {
      const navEl = byId('nav-' + page);
      if (typeof window.showPage === 'function') window.showPage(page, navEl || null);
      else if (byId('page-' + page)) byId('page-' + page).scrollIntoView({behavior:'smooth'});
    } catch(e) {
      console.warn('[FoodNoteMobileNav] navigation impossible:', page, e);
    }
    scheduleRefresh(30);
  }

  function openCaptureMode(mode){
    closePanels();
    const captureMode = String(mode || 'search');
    try {
      if (window.FoodNoteCapture && typeof window.FoodNoteCapture.open === 'function') {
        window.FoodNoteCapture.open({ mode: captureMode, skipMealSelect: false, fromMealButton: false });
        return;
      }
      if (typeof window.openFoodNoteCapture === 'function') {
        window.openFoodNoteCapture();
        return;
      }
      // Fallback doux si le moteur Capture n'est pas encore chargé.
      navigate('journal');
      setTimeout(() => {
        if (window.FoodNoteCapture && typeof window.FoodNoteCapture.open === 'function') {
          window.FoodNoteCapture.open({ mode: captureMode, skipMealSelect: false, fromMealButton: false });
        } else if (typeof window.openFoodAddModal === 'function') {
          window.openFoodAddModal();
        } else {
          showToast('Capture alimentaire indisponible pour le moment.');
        }
      }, 120);
    } catch(e) {
      console.warn('[FoodNoteMobileNav] capture impossible', captureMode, e);
      showToast('Impossible d’ouvrir la capture.');
    }
  }

  function openFoodAdd(){
    openCaptureMode('search');
  }

  function openSportAdd(){
    closePanels();
    try {
      if (typeof window.goToSportAdd === 'function') { window.goToSportAdd(); return; }
      if (typeof window.openSportAddModal === 'function') { window.openSportAddModal(); return; }
      if (byId('page-sport')) { navigate('sport'); return; }
      showToast('Sport arrive bientôt : la bulle est prête.');
    } catch(e) {
      showToast('Sport arrive bientôt.');
    }
  }

  function openMenu(){
    closePanels();
    try {
      if (typeof window.toggleSidebar === 'function') window.toggleSidebar();
      else navigate('profil');
    } catch(e) {}
    scheduleRefresh(120);
  }

  function onClick(event){
    const close = event.target.closest('[data-fn-mobile-close-panels]');
    if (close) { event.preventDefault(); closePanels(); return; }

    const captureChoice = event.target.closest('[data-fn-mobile-capture]');
    if (captureChoice) {
      event.preventDefault();
      openCaptureMode(captureChoice.dataset.fnMobileCapture || 'search');
      return;
    }

    const plusChoice = event.target.closest('[data-fn-mobile-plus]');
    if (plusChoice) {
      event.preventDefault();
      const choice = plusChoice.dataset.fnMobilePlus;
      if (choice === 'food') openFoodAdd();
      else if (choice === 'sport') openSportAdd();
      return;
    }

    const pageBtn = event.target.closest('[data-fn-mobile-page]');
    if (pageBtn) { event.preventDefault(); navigate(pageBtn.dataset.fnMobilePage); return; }

    const actionBtn = event.target.closest('[data-fn-mobile-action]');
    if (!actionBtn) return;
    event.preventDefault();
    const action = actionBtn.dataset.fnMobileAction;
    if (action === 'add') toggleActionBubble();
    else if (action === 'bilan') toggleBilan();
    else if (action === 'menu') openMenu();
  }

  function overlayActive(){
    const b = document.body;
    if (!b) return true;
    if (b.classList.contains('food-add-modal-open')
      || b.classList.contains('foodnote-camera-view-open')
      || b.classList.contains('foodnote-crop-shell-open')
      || b.classList.contains('foodnote-crop-camera-suspended')
      || b.classList.contains('barcode-modal-open')
      || b.classList.contains('capture-modal-open')) return true;
    const onboarding = byId('page-onboarding');
    if (onboarding && onboarding.classList.contains('active')) return true;
    const sidebar = byId('sidebar');
    if (sidebar && sidebar.classList.contains('open')) return true;
    const foodModal = byId('food-add-modal');
    if (foodModal && foodModal.classList.contains('is-open') && foodModal.getAttribute('aria-hidden') !== 'true') return true;
    const ocr = byId('ocr-panel');
    if (ocr && (ocr.classList.contains('foodnote-camera-unified') || ocr.classList.contains('foodnote-crop-shell-active'))) return true;
    const barcode = byId('barcode-scan-panel');
    if (barcode && barcode.classList.contains('foodnote-camera-unified')) return true;
    return false;
  }

  function updateActive(){
    if (!root) return;
    const page = currentPageId();
    root.querySelectorAll('.fn-mobile-nav-btn').forEach(btn => btn.classList.remove('is-active'));
    const direct = root.querySelector(`[data-fn-mobile-page="${page}"]`);
    if (direct) direct.classList.add('is-active');
    if (page === 'recap' || page === 'stats') {
      const bilan = root.querySelector('[data-fn-mobile-action="bilan"]');
      if (bilan) bilan.classList.add('is-active');
    }
  }

  function refresh(){
    build();
    const mobile = isMobileViewport();
    document.body.classList.toggle('foodnote-mobile-nav-enabled', mobile);
    if (!mobile) closePanels();
    const hidden = !mobile || overlayActive();
    root.classList.toggle('is-hidden', hidden);
    if (hidden) closePanels();
    updateActive();
  }

  function scheduleRefresh(delay = 60){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, Math.max(0, Number(delay) || 0));
  }

  function observe(){
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => scheduleRefresh(50));
    const nodes = [document.body]
      .concat(Array.from(document.querySelectorAll('.page, #sidebar, #food-add-modal, #ocr-panel, #barcode-scan-panel')))
      .filter(Boolean);
    nodes.forEach(node => {
      try { observer.observe(node, { attributes:true, attributeFilter:['class', 'aria-hidden', 'style'] }); } catch(e) {}
    });
  }

  function wrapShowPage(){
    if (wrappedShowPage || typeof window.showPage !== 'function') return;
    const original = window.showPage;
    window.showPage = function(id, tab){
      const result = original.apply(this, arguments);
      closePanels();
      scheduleRefresh(20);
      try { window.dispatchEvent(new CustomEvent('foodnote:pagechange', {detail:{page:id}})); } catch(e) {}
      return result;
    };
    wrappedShowPage = true;
  }

  function init(){
    build();
    wrapShowPage();
    observe();
    refresh();
    window.addEventListener('resize', () => scheduleRefresh(80), {passive:true});
    window.addEventListener('orientationchange', () => scheduleRefresh(180), {passive:true});
    window.addEventListener('foodnote:deferred-ready', () => scheduleRefresh(120));
    document.addEventListener('visibilitychange', () => scheduleRefresh(60));
    setInterval(() => scheduleRefresh(0), 1800);
  }

  window.FoodNoteMobileNav = { init, refresh, closePanels, closeSheet: closePanels, openCaptureMode, openFoodAdd, openAdd: openFoodAdd, openSportAdd, navigate, build, BUILD };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
