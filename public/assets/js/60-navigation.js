function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-overlay');
  document.body.classList.remove('sidebar-collapsed');
  sb.classList.toggle('open');
  if (ov) ov.classList.toggle('visible', sb.classList.contains('open'));
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-overlay');
  sb.classList.remove('open');
  if (ov) ov.classList.remove('visible');
}

function setSidebarCollapsed(collapsed) {
  if (window.innerWidth <= 700) collapsed = false;
  document.body.classList.toggle('sidebar-collapsed', !!collapsed);
  const btn = document.querySelector('.sb-collapse-btn');
  if (btn) {
    btn.title = collapsed ? 'Déplier le menu' : 'Réduire le menu';
    btn.setAttribute('aria-label', btn.title);
  }
  try { localStorage.setItem('foodnote_sidebar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
}

function toggleSidebarCollapsed() {
  setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
}

function initSidebarCollapse() {
  document.querySelectorAll('.sb-item').forEach(el => {
    const label = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (label) {
      el.setAttribute('data-collapsed-title', label);
      if (!el.getAttribute('title')) el.setAttribute('title', label);
    }
  });
  let saved = '0';
  try { saved = localStorage.getItem('foodnote_sidebar_collapsed') || '0'; } catch(e) {}
  setSidebarCollapsed(saved === '1');
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 700) document.body.classList.remove('sidebar-collapsed');
    else {
      let keep = '0';
      try { keep = localStorage.getItem('foodnote_sidebar_collapsed') || '0'; } catch(e) {}
      document.body.classList.toggle('sidebar-collapsed', keep === '1');
    }
  });
}

document.addEventListener('DOMContentLoaded', initSidebarCollapse);

function toggleSubMenu(subId, chevId) {
  const subEl = document.getElementById(subId);
  const chevEl = document.getElementById(chevId);
  if (!subEl) return;
  const isOpen = subEl.style.display === 'flex';
  subEl.style.display = isOpen ? 'none' : 'flex';
  subEl.style.flexDirection = 'column';
  if (chevEl) chevEl.classList.toggle('open', !isOpen);
}

function scrollTo(id, tries = 0) {
  const run = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries < 8) setTimeout(() => scrollTo(id, tries + 1), 80);
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('section-focus');
    setTimeout(() => el.classList.remove('section-focus'), 1200);
  };
  setTimeout(run, tries ? 80 : 180);
}

function showPageSection(pageId, sectionId, tab) {
  showPage(pageId, tab);
  scrollTo(sectionId);
}

function showPage(id, tab) {
  const targetPage = document.getElementById('page-' + id);
  if (!targetPage) {
    console.warn('[FoodNote] Page introuvable:', 'page-' + id);
    return;
  }

  document.querySelectorAll('.page').forEach(pageEl => pageEl.classList.remove('active'));
  document.querySelectorAll('.sb-item, .sb-sub-item').forEach(navItem => navItem.classList.remove('active'));
  targetPage.classList.add('active');

  // Mettre à jour le titre de la page
  const titles = { journal:'Saisie du jour', sport:'Sport & activité', historique:'Historique', export:'Export avancé',
    ref:'Référence', bddalim:'Mes aliments', donnees:'Données', stats:'Statistiques', objectif:'Objectif',
    profil:'Mon profil', ia:'IA — Groq', bases:'Bases de données', recap:'Récap', themelab:'Laboratoire couleurs', recettes:'Recettes', onboarding:'Configuration' };
  const titleIcons = { journal:'🍽', sport:'🚴', historique:'🕘', export:'📤', ref:'📚', bddalim:'🥫', donnees:'📁', stats:'📊', objectif:'🎯', profil:'👤', ia:'🤖', bases:'🗄', recap:'✅', themelab:'🎨', recettes:'🍲', onboarding:'⚙️' };
  const parentOf = { ia:'nav-ia', bases:'nav-bases', donnees:'nav-donnees' };
  const parentId = parentOf[id];
  if (parentId) { const parentNav = document.getElementById(parentId); if (parentNav) parentNav.classList.add('active'); }
  const pt = document.getElementById('page-title');
  if (pt) pt.textContent = titles[id] || id;
  const pi = document.getElementById('page-title-icon');
  if (pi) pi.textContent = titleIcons[id] || '•';

  // Activer l'item du sidebar
  const navEl = document.getElementById('nav-' + id);
  if (navEl) navEl.classList.add('active');
  if (tab && tab.classList) tab.classList.add('active');

  // Fermer le sidebar sur mobile
  if (window.innerWidth <= 700) closeSidebar();

  if ((id === 'historique' || id === 'stats' || id === 'recap' || id === 'export' || id === 'donnees') && typeof loadEntriesFullNative === 'function') {
    loadEntriesFullNative().then(() => {
      if (id === 'historique' && typeof renderHistorique === 'function') renderHistorique();
      if (id === 'stats' && typeof renderStats === 'function') renderStats();
      if (id === 'recap' && typeof renderRecap === 'function') renderRecap();
      if (id === 'export' && typeof renderExportSelect === 'function') renderExportSelect();
      if (id === 'donnees' && typeof renderDonnees === 'function') renderDonnees();
    }).catch(e => console.warn('[FoodNote] historique complet non chargé', e));
  }
  if (id === 'historique' && typeof renderHistorique === 'function') renderHistorique();
  if (id === 'export' && typeof renderExportSelect === 'function') renderExportSelect();
  if (id === 'ref' && typeof renderRef === 'function') renderRef();
  if ((id === 'bddalim' || id === 'bases') && typeof renderBDD === 'function') renderBDD();
  if (id === 'donnees' && typeof renderDonnees === 'function') renderDonnees();
  if (id === 'bases') {
    if (typeof checkOFFStatus === 'function') checkOFFStatus();
    if (typeof checkCIQUALStatus === 'function') checkCIQUALStatus();
    if (typeof renderUnitWeights === 'function') renderUnitWeights();

  }
  if (id === 'profil' && typeof renderCfgProfil === 'function') renderCfgProfil();
  if (id === 'objectif' && typeof renderObjectif === 'function') renderObjectif();
  if (id === 'ia' && typeof loadGroqKey === 'function') loadGroqKey();
  if (id === 'stats' && typeof renderStats === 'function') renderStats();
  if (id === 'recap' && typeof renderRecap === 'function') renderRecap();
  if (id === 'recettes' && window.FoodNoteRecipes && typeof FoodNoteRecipes.load === 'function') FoodNoteRecipes.load();
  if (id === 'sport') {
    if (typeof syncSportDateProxy === 'function') syncSportDateProxy();
    if (typeof renderSportDayCarousel === 'function') renderSportDayCarousel();
    if (typeof renderSportPageSummary === 'function') renderSportPageSummary();
  }
  if (typeof updateFloatingAddFoodButton === 'function') updateFloatingAddFoodButton();
  try { window.dispatchEvent(new CustomEvent('foodnote-ui-rendered', { detail:{ source:'showPage', page:id } })); } catch(e) {}
}



/* v10.60 — ajout aliment par bouton flottant + modal unique */
function openFoodAddModal() {
  if (typeof scheduleFoodsWarmup === 'function') scheduleFoodsWarmup(0);
  const modal = document.getElementById('food-add-modal');
  if (!modal) return;
  // v10.61 : sortir la modale du flux de la carte journal.
  // Certains WebView/Chrome Android gardent le contenu en bas si le modal reste dans un parent scrollable.
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  try { modal.inert = false; } catch(e) {}
  modal.style.display = 'flex';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.zIndex = '12000';
  modal.classList.add('is-open');
  modal.classList.remove('food-add-expanded');
  modal.setAttribute('aria-hidden', 'false');
  if (typeof resetFoodAddGroqVisualState === 'function') resetFoodAddGroqVisualState();
  if (typeof syncFoodSourceFilterButtons === 'function') syncFoodSourceFilterButtons();
  if (typeof syncFoodAddMealButtons === 'function') syncFoodAddMealButtons();
  if (typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
  if (typeof setFoodAddMode === 'function') setFoodAddMode('search');
  document.body.classList.add('food-add-modal-open');
  setTimeout(() => {
    const input = document.getElementById('db-search');
    if (input) {
      input.focus({ preventScroll: true });
      if (typeof input.select === 'function' && input.value) input.select();
    }
  }, 90);
}

function closeFoodAddModal() {
  try { if (typeof closeBarcodeScannerPanel === 'function') closeBarcodeScannerPanel(); } catch(e) {}
  try { if (typeof closeOCRPanel === 'function') closeOCRPanel(); } catch(e) {}
  const modal = document.getElementById('food-add-modal');
  if (!modal) return;

  // Accessibilité robuste : Chrome refuse aria-hidden si le focus reste dans le modal.
  // On sort donc le focus AVANT de masquer, puis on rend le bloc inerte.
  try {
    const active = document.activeElement;
    if (active && modal.contains(active) && typeof active.blur === 'function') active.blur();
  } catch(e) {}

  modal.classList.remove('is-open');
  modal.classList.remove('food-add-expanded');
  modal.setAttribute('aria-hidden', 'true');
  try { modal.inert = true; } catch(e) {}
  modal.style.display = 'none';
  document.body.classList.remove('food-add-modal-open');
  document.getElementById('db-suggestions')?.classList.remove('visible');
  if (typeof resetFoodAddGroqVisualState === 'function') resetFoodAddGroqVisualState();
  if (typeof setFoodAddExpanded === 'function') setFoodAddExpanded(false);

  // Fermeture du popup = réconciliation visuelle ciblée du repas, pas refresh global.
  // Cela garantit qu'un ajout atomique visible dans SQLite apparaît aussi dans le journal immédiatement.
  setTimeout(() => {
    try {
      if (typeof reconcileVisibleMealLines === 'function') reconcileVisibleMealLines('modal-close', { regroup:true, currentMeal:false, carousel:true });
    } catch(e) {}
  }, 0);
}

function goToFoodAdd(meal) {
  try {
    if (meal && typeof setFoodAddTargetMeal === 'function') {
      setFoodAddTargetMeal(meal);
    }
    if (typeof showPage === 'function') {
      showPage('journal', document.getElementById('nav-journal'));
    }
  } catch (e) {}
  setTimeout(() => openFoodAddModal(), 80);
}

function openFoodAddForMeal(meal) {
  goToFoodAdd(meal);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.getElementById('food-add-modal')?.classList.contains('is-open')) {
    closeFoodAddModal();
  }
});

function updateFloatingAddFoodButton() {
  const btn = document.getElementById('floating-add-food-btn');
  if (!btn) return;
  const onboarding = document.getElementById('page-onboarding');
  const hidden = onboarding && onboarding.classList.contains('active');
  btn.classList.toggle('is-hidden', !!hidden);
}

document.addEventListener('DOMContentLoaded', () => {
  updateFloatingAddFoodButton();
  setTimeout(updateFloatingAddFoodButton, 600);
});
