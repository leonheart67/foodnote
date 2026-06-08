/*
 * FoodNote — code-barres retour ajout runtime
 * Rôle : Gérer le retour du scan code-barres vers le flux Ajouter.
 * Ne doit pas gérer : l'apparence CSS, la base OpenFoodFacts ou le moteur de recherche/quantité.
 */
(function(){
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const $ = (id) => document.getElementById(id);
  const q = (sel, root=document) => root.querySelector(sel);

  function safe(fn){ try { return fn && fn(); } catch(e) { console.warn('[FoodNote]', e); } }

  function ensureReadyNote(){
    const card = $('db-selected-card');
    if (!card || !card.parentElement) return;
    let note = $('fn-barcode-ready-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'fn-barcode-ready-note';
      note.className = 'fn-barcode-ready-note';
      note.innerHTML = '<b>Produit scanné.</b> Vérifie la quantité et le repas, puis touche Ajouter.';
      card.parentElement.insertBefore(note, card);
    }
    note.style.display = 'block';
  }

  function hideReadyNoteIfTyping(){
    const note = $('fn-barcode-ready-note');
    if (note) note.style.display = 'none';
    $('food-add-modal')?.classList.remove('fn-barcode-ready');
  }

  function forceBarcodeReadyLayout(){
    const modal = $('food-add-modal');
    if (!modal) return;

    // Le scan code-barres donne un produit OpenFoodFacts connu : on revient au flux normal d'ajout.
    // Depuis 0.22.97, on privilégie le contrôleur du popup plutôt que de repasser
    // par les anciens wrappers globaux.
    safe(() => window.FoodNoteAddV0160 && window.FoodNoteAddV0160.setIntent && window.FoodNoteAddV0160.setIntent('search', { keepText:true }));
    safe(() => {
      if (window.FoodNoteFoodAddModalController && typeof window.FoodNoteFoodAddModalController.setMode === 'function') {
        window.FoodNoteFoodAddModalController.setMode('search', { callLegacy:false, reason:'barcode-ready' });
      } else if (typeof window.setFoodAddMode === 'function') {
        window.setFoodAddMode('search');
      }
    });

    modal.classList.add('is-open', 'fn-barcode-ready', 'food-intent-search');
    modal.classList.remove('food-intent-estimate', 'food-intent-recipes', 'food-scan-submodal-open', 'food-add-ai-mode', 'food-estimate-result-active', 'fn-add-estimate-result');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.remove('foodnote-camera-view-open', 'barcode-modal-open');

    const barcodePanel = $('barcode-scan-panel');
    if (barcodePanel) {
      barcodePanel.classList.remove('food-camera-submodal', 'foodnote-label-camera');
      barcodePanel.style.display = 'none';
    }
    const ocrPanel = $('ocr-panel');
    if (ocrPanel) ocrPanel.classList.remove('food-camera-submodal');

    const row = q('#food-add-modal .journal-add-row');
    if (row) {
      row.style.setProperty('display', 'flex', 'important');
      row.style.setProperty('flex-direction', 'column', 'important');
      row.style.setProperty('gap', '8px', 'important');
      row.style.setProperty('width', '100%', 'important');
    }

    const qty = $('db-qty');
    if (qty) qty.style.setProperty('display', 'block', 'important');

    const filters = q('#food-add-modal .food-inline-filters');
    if (filters) filters.style.setProperty('display', 'none', 'important');

    const suggestions = $('db-suggestions');
    if (suggestions) { suggestions.classList.remove('visible'); suggestions.style.setProperty('display', 'none', 'important'); }

    const card = $('db-selected-card');
    if (card && card.innerHTML.trim()) {
      card.classList.add('visible');
      card.style.setProperty('display', 'block', 'important');
      card.style.setProperty('visibility', 'visible', 'important');
    }

    const actions = q('#food-add-modal .food-add-actions');
    if (actions) actions.style.setProperty('display', 'flex', 'important');

    const btn = $('food-main-action-btn');
    if (btn) {
      btn.textContent = 'Ajouter';
      btn.classList.add('btn-primary');
      btn.style.removeProperty('display');
    }

    ensureReadyNote();

    // Ne force pas le focus sur Android : cela rouvrirait le clavier.
    const dialog = q('#food-add-modal .food-add-dialog');
    safe(() => dialog && dialog.scrollTo({ top: 0, behavior: 'smooth' }));
    safe(() => card && card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    safe(() => window.FoodNoteFoodAddModalController && window.FoodNoteFoodAddModalController.reconcile && window.FoodNoteFoodAddModalController.reconcile('barcode-ready-layout'));
  }

  function patchBarcodeFlow(){
    if (window.__foodnote01617BarcodePatched) return;
    window.__foodnote01617BarcodePatched = true;

    const originalSelect = window.selectBarcodeProductInSearch;
    if (typeof originalSelect === 'function') {
      window.selectBarcodeProductInSearch = function(showStatus){
        const out = originalSelect.apply(this, arguments);
        [0, 80, 220, 520].forEach(t => setTimeout(forceBarcodeReadyLayout, t));
        return out;
      };
    }

    const originalRender = window.renderBarcodeProduct;
    if (typeof originalRender === 'function') {
      window.renderBarcodeProduct = function(){
        const out = originalRender.apply(this, arguments);
        [0, 120, 320].forEach(t => setTimeout(forceBarcodeReadyLayout, t));
        return out;
      };
    }

    const originalLookup = window.lookupBarcode;
    if (typeof originalLookup === 'function') {
      window.lookupBarcode = async function(code, fromCamera){
        const out = await originalLookup.apply(this, arguments);
        if (fromCamera) [80, 260, 620].forEach(t => setTimeout(forceBarcodeReadyLayout, t));
        return out;
      };
    }

    document.addEventListener('input', ev => {
      if (ev.target && ev.target.id === 'db-search') hideReadyNoteIfTyping();
    }, true);
  }

  function init(){ patchBarcodeFlow(); }
  document.addEventListener('DOMContentLoaded', init);
  [300, 900, 1800].forEach(t => setTimeout(init, t));

  window.FoodNoteBarcodeModule01617 = { build: BUILD, forceBarcodeReadyLayout };
})();
