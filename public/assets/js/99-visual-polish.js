/* UX v10.32 — polish visuel léger
   - animations de feedback non bloquantes
   - décoration sobre des états vides
   - micro-animation des macros quand elles changent
   Ne touche pas aux données : SQLite reste la source de vérité.
*/
(function(){
  'use strict';

  const macroIds = ['m-kcal','m-prot','m-gluc','m-lip','sticky-kcal','sticky-prot','sticky-gluc','sticky-lip','sticky-net'];
  const previousText = new Map();

  function pop(el) {
    if (!el) return;
    el.classList.remove('fn-macro-pop');
    // force reflow
    void el.offsetWidth;
    el.classList.add('fn-macro-pop');
  }

  function watchMacros() {
    macroIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const value = (el.textContent || '').trim();
      if (!previousText.has(id)) {
        previousText.set(id, value);
        return;
      }
      if (previousText.get(id) !== value) {
        previousText.set(id, value);
        pop(el);
      }
    });
  }

  function decorateEmptyStates(root) {
    (root || document).querySelectorAll('.empty-state').forEach(el => {
      el.classList.add('fn-empty-visual');
    });
  }

  function feedbackOnAddAndSave(e) {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    const label = (btn.textContent || '').toLowerCase();
    if (label.includes('ajouter') || label.includes('enregistrer') || label.includes('sauvegarder')) {
      btn.classList.remove('fn-save-feedback');
      void btn.offsetWidth;
      btn.classList.add('fn-save-feedback');
    }
  }

  function observeDynamicUI() {
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (node.nodeType === 1) decorateEmptyStates(node);
          });
        }
      }
      watchMacros();
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }



  // v11.92 — Dock nutrition flottant fiable du Journal.
  // Au lieu de déplacer la vraie carte (ce qui casse selon les conteneurs/overflows),
  // on affiche une copie fixe quand la carte d'origine sort de l'écran.
  let journalMacroClone = null;
  let journalMacroTicking = false;

  function getScrollTopSafe() {
    return Math.max(
      window.scrollY || 0,
      document.documentElement ? (document.documentElement.scrollTop || 0) : 0,
      document.body ? (document.body.scrollTop || 0) : 0
    );
  }

  function ensureJournalMacroClone(page) {
    const host = page || document.getElementById('page-journal') || document.body;
    if (!journalMacroClone || !document.documentElement.contains(journalMacroClone)) {
      journalMacroClone = document.createElement('div');
      journalMacroClone.id = 'journal-macro-fixed-dock';
      journalMacroClone.className = 'journal-macro-fixed-dock';
      journalMacroClone.setAttribute('aria-hidden', 'true');
      journalMacroClone.style.display = 'none';
    }
    if (journalMacroClone.parentElement !== host) host.appendChild(journalMacroClone);
    return journalMacroClone;
  }

  function stripDuplicateIds(root) {
    if (!root) return;
    root.querySelectorAll('[id]').forEach(el => {
      el.setAttribute('data-source-id', el.id);
      el.removeAttribute('id');
    });
  }

  function copyJournalMacroCardToClone(card, clone) {
    if (!card || !clone) return;
    if (!clone.dataset.ready) {
      clone.innerHTML = '';
      const cardCopy = card.cloneNode(true);
      cardCopy.classList.add('journal-macro-dock-card');
      stripDuplicateIds(cardCopy);
      clone.appendChild(cardCopy);
      clone.dataset.ready = '1';
    }
    clone.querySelectorAll('[data-source-id]').forEach(target => {
      const src = document.getElementById(target.getAttribute('data-source-id'));
      if (!src) return;
      if ((target.textContent || '') !== (src.textContent || '')) target.textContent = src.textContent || '';
      target.className = src.className;
    });
  }

  function syncJournalMacroDock() {
    const page = document.getElementById('page-journal');
    const card = page ? page.querySelector('.journal-floating-macro-card:not(.journal-macro-dock-card)') : null;
    const clone = ensureJournalMacroClone(page);
    if (!page || !card || !clone) return;

    // Neutralise l'ancien mode fixed si un cache CSS/JS l'a encore ajouté.
    card.classList.remove('is-scroll-fixed');
    card.style.removeProperty('--journal-macro-fixed-top');
    card.style.removeProperty('--journal-macro-fixed-left');
    card.style.removeProperty('--journal-macro-fixed-width');

    const active = page.classList.contains('active');
    const modalOpen = document.body.classList.contains('food-add-open') || document.querySelector('.food-add-modal[aria-hidden="false"]');
    if (!active || modalOpen) {
      clone.style.display = 'none';
      clone.classList.remove('visible');
      return;
    }

    const header = document.querySelector('.app-header');
    const headerRect = header ? header.getBoundingClientRect() : { bottom: 0 };
    const headerBottom = Math.max(0, Math.round(headerRect.bottom || 0));
    const cardRect = card.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    const scrollTop = getScrollTopSafe();

    // La copie apparait seulement quand la vraie carte est passée sous le header.
    const shouldShow = scrollTop > 10 && cardRect.bottom <= headerBottom + 8 && pageRect.bottom > headerBottom + 120;
    if (!shouldShow) {
      clone.style.display = 'none';
      clone.classList.remove('visible');
      return;
    }

    copyJournalMacroCardToClone(card, clone);

    // v11.93 : la copie fixe reprend EXACTEMENT la largeur et la position
    // de la carte originale. On ne recalcule plus depuis la largeur de page,
    // sinon le dock parait décalé à gauche et change de design.
    const realWidth = Math.round(cardRect.width || 0);
    const realLeft = Math.round(cardRect.left || 0);
    const fallbackWidth = Math.min(Math.round(pageRect.width || window.innerWidth - 16), 940, window.innerWidth - 16);
    const width = realWidth > 80 ? Math.min(realWidth, window.innerWidth - 16) : fallbackWidth;
    const left = realWidth > 80
      ? Math.max(8, Math.min(realLeft, window.innerWidth - width - 8))
      : Math.max(8, Math.round((window.innerWidth - width) / 2));
    clone.style.setProperty('--journal-dock-top', Math.round(headerBottom + 6) + 'px');
    clone.style.setProperty('--journal-dock-left', left + 'px');
    clone.style.setProperty('--journal-dock-width', Math.round(width) + 'px');
    clone.style.display = 'block';
    clone.classList.add('visible');
  }

  function requestJournalMacroDockSync() {
    if (journalMacroTicking) return;
    journalMacroTicking = true;
    requestAnimationFrame(() => {
      journalMacroTicking = false;
      syncJournalMacroDock();
    });
  }

  function initJournalMacroDock() {
    const request = requestJournalMacroDockSync;
    window.addEventListener('scroll', request, { passive: true });
    document.addEventListener('scroll', request, true);
    window.addEventListener('resize', request, { passive: true });
    window.addEventListener('orientationchange', request, { passive: true });
    document.addEventListener('click', () => setTimeout(request, 80), true);
    document.addEventListener('input', request, true);
    const main = document.querySelector('.main-wrap');
    if (main) main.addEventListener('scroll', request, { passive: true });
    setInterval(request, 1800);
    setTimeout(request, 80);
    setTimeout(request, 400);
  }

  document.addEventListener('DOMContentLoaded', function(){
    decorateEmptyStates(document);
    watchMacros();
    observeDynamicUI();
    initJournalMacroDock();
    document.addEventListener('click', feedbackOnAddAndSave, true);
  });
})();
