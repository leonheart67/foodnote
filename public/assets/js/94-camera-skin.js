/*
 * FoodNote — caméra UI runtime
 * Rôle : Gérer les classes d'état caméra, les boutons de fermeture et la synchronisation du viseur.
 * Ne doit pas gérer : l'apparence CSS, l'OCR, le scan code-barres ou les appels IA.
 */
(function(){
  'use strict';
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const $ = (id) => document.getElementById(id);
  let installed = false;
  let queued = false;
  let ocrActive = false;
  let barcodeActive = false;
  let barcodeOcrButtonOriginalParent = null;
  let barcodeOcrButtonOriginalNext = null;
  let ocrOriginalParent = null;
  let ocrOriginalNext = null;

  function visible(el){
    if (!el) return false;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    } catch(e) {
      return el.style.display !== 'none';
    }
  }


  function cropShellOpen(){
    try {
      if (document.body.classList.contains('foodnote-crop-shell-open') || document.body.classList.contains('foodnote-crop-camera-suspended')) return true;
      return !!(window.FoodNoteCropShell && typeof window.FoodNoteCropShell.isActive === 'function' && window.FoodNoteCropShell.isActive());
    } catch(e) {
      return false;
    }
  }

  function suspendUnifiedCameraSkin(){
    const ocr = $('ocr-panel');
    const barcode = $('barcode-scan-panel');
    if (ocr) {
      ocr.classList.remove('foodnote-camera-unified', 'food-camera-submodal');
      restoreOcrShotButtons();
    }
    if (barcode) {
      barcode.classList.remove('foodnote-camera-unified', 'food-camera-submodal');
      restoreBarcodeShotButton();
    }
    ocrActive = false;
    barcodeActive = false;
    document.body.classList.remove('foodnote-camera-view-open', 'barcode-modal-open');
  }


  function getThemeName(){
    try {
      if (typeof window.getCurrentTheme === 'function') return window.getCurrentTheme() === 'light' ? 'light' : 'dark';
      const stored = localStorage.getItem('foodnote_theme');
      if (stored === 'light' || stored === 'dark') return stored;
      const domTheme = document.documentElement?.dataset?.theme || document.body?.dataset?.theme;
      if (domTheme === 'light' || domTheme === 'dark') return domTheme;
      return document.body?.classList?.contains('foodnote-theme-light') ? 'light' : 'dark';
    } catch(e) { return 'dark'; }
  }

  function updateThemeClass(){
    const theme = getThemeName();
    document.body.classList.toggle('foodnote-theme-light', theme === 'light');
    document.body.classList.toggle('foodnote-theme-dark', theme !== 'light');
    document.body.dataset.theme = theme;
  }

  function wrapApplyTheme(){
    if (typeof window.applyTheme !== 'function' || window.applyTheme.__foodnoteCameraThemeWrapped) return;
    const original = window.applyTheme;
    const wrapped = function(theme){
      const out = original.apply(this, arguments);
      updateThemeClass();
      schedule(40);
      schedule(180);
      return out;
    };
    wrapped.__foodnoteCameraThemeWrapped = true;
    window.applyTheme = wrapped;
  }

  function moveOcrToBody(panel){
    if (!panel || panel.parentElement === document.body) return;
    ocrOriginalParent = panel.parentElement;
    ocrOriginalNext = panel.nextSibling;
    document.body.appendChild(panel);
  }
  function restoreOcr(panel){
    if (!panel || !ocrOriginalParent || panel.parentElement !== document.body) return;
    try {
      if (ocrOriginalNext && ocrOriginalNext.parentElement === ocrOriginalParent) ocrOriginalParent.insertBefore(panel, ocrOriginalNext);
      else ocrOriginalParent.appendChild(panel);
    } catch(e) {}
  }

  function ensurePill(panel, text){
    if (!panel) return;
    let pill = panel.querySelector('.foodnote-scan-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'foodnote-scan-pill';
      const head = panel.querySelector('.ocr-panel-head, .barcode-scan-actions');
      if (head && head.parentNode) head.parentNode.insertBefore(pill, head.nextSibling);
      else panel.prepend(pill);
    }
    pill.textContent = text;
  }

  function setShotButton(btn, active){
    if (!btn) return;
    if (active) {
      if (!btn.dataset.foodnoteFullLabel) btn.dataset.foodnoteFullLabel = (btn.textContent || '').trim() || btn.getAttribute('aria-label') || 'Prendre la photo';
      btn.classList.add('foodnote-camera-shot');
      btn.textContent = ''; // évite le double emoji : l'icône vient uniquement du CSS ::before
      btn.title = btn.dataset.foodnoteFullLabel;
      btn.setAttribute('aria-label', btn.dataset.foodnoteFullLabel);
    } else {
      btn.classList.remove('foodnote-camera-shot');
      if (btn.dataset.foodnoteFullLabel && !(btn.textContent || '').trim()) btn.textContent = btn.dataset.foodnoteFullLabel;
    }
  }
  function normalizeOcrShotButton(){
    const recipe = $('recipe-ocr-read-btn');
    const table = $('ocr-read-table-btn');
    const candidates = [recipe, table].filter(Boolean);
    const activeBtn = candidates.find(visible) || recipe || table;
    candidates.forEach(btn => setShotButton(btn, btn === activeBtn));
  }
  function restoreOcrShotButtons(){
    ['recipe-ocr-read-btn','ocr-read-table-btn'].forEach(id => {
      const btn = $(id); if (!btn) return;
      btn.classList.remove('foodnote-camera-shot');
      if (btn.dataset.foodnoteFullLabel && !(btn.textContent || '').trim()) btn.textContent = btn.dataset.foodnoteFullLabel;
    });
  }
  function moveBarcodeShotButtonToPanel(btn){
    const panel = $('barcode-scan-panel');
    if (!btn || !panel) return;
    if (!barcodeOcrButtonOriginalParent && btn.parentElement) {
      barcodeOcrButtonOriginalParent = btn.parentElement;
      barcodeOcrButtonOriginalNext = btn.nextSibling;
    }
    if (btn.parentElement !== panel) panel.appendChild(btn);
  }
  function restoreBarcodeShotButtonParent(btn){
    if (!btn || !barcodeOcrButtonOriginalParent || btn.parentElement === barcodeOcrButtonOriginalParent) return;
    try {
      if (barcodeOcrButtonOriginalNext && barcodeOcrButtonOriginalNext.parentElement === barcodeOcrButtonOriginalParent) barcodeOcrButtonOriginalParent.insertBefore(btn, barcodeOcrButtonOriginalNext);
      else barcodeOcrButtonOriginalParent.appendChild(btn);
    } catch(e) {}
  }
  function normalizeBarcodeShotButton(show){
    const btn = $('barcode-ocr-btn');
    if (!btn) return;
    if (!show) {
      setShotButton(btn, false);
      btn.style.display = 'none';
      return;
    }
    moveBarcodeShotButtonToPanel(btn);
    btn.style.display = 'inline-flex';
    setShotButton(btn, true);
  }
  function restoreBarcodeShotButton(){
    const btn = $('barcode-ocr-btn');
    if (!btn) return;
    btn.classList.remove('foodnote-camera-shot');
    if (btn.dataset.foodnoteFullLabel && !(btn.textContent || '').trim()) btn.textContent = btn.dataset.foodnoteFullLabel;
    btn.style.display = '';
    restoreBarcodeShotButtonParent(btn);
  }

  function cleanOldClasses(panel){
    if (!panel) return;
    panel.classList.remove('foodnote-label-camera','food-camera-submodal','foodnote-camera-standard','foodnote-ocr-camera-standard','foodnote-etiquette-scan-view');
  }

  function normalizeOcrText(panel){
    const title = panel?.querySelector('.ocr-panel-head strong');
    const titleText = (title?.textContent || '').toLowerCase();
    const isRecipe = titleText.includes('recette');
    const isLabel = titleText.includes('étiquette') || titleText.includes('etiquette') || titleText.includes('tableau');
    const kindText = isRecipe ? 'la recette' : (isLabel ? 'le tableau nutritionnel' : 'le plat');
    if (title) {
      if (isRecipe) title.textContent = '📷 Scanner une recette';
      else if (isLabel) title.textContent = '📋 Lire un tableau nutritionnel';
      else title.textContent = '📷 Photo d’un plat';
    }
    ensurePill(panel, 'Place ' + kindText + ' dans le cadre');
    const note = panel?.querySelector('.ocr-unified-note');
    if (note) {
      note.innerHTML = '💡 Conseils<br>• Assure-toi d’avoir une bonne luminosité<br>• Évite les reflets<br>• Place ' + kindText + ' bien centré dans le cadre';
    }
    const close = panel?.querySelector('.ocr-panel-head button');
    if (close) {
      close.textContent = 'Fermer';
      close.title = 'Fermer la caméra';
      close.setAttribute('aria-label','Fermer la caméra');
      close.type = 'button';
    }
  }

  function normalizeBarcodeText(panel){
    const title = panel?.querySelector('.barcode-inline-title');
    const titleText = (title?.textContent || '').toLowerCase();
    const isNutrition = titleText.includes('nutrition') || titleText.includes('tableau');
    const label = isNutrition ? 'le tableau nutritionnel' : 'le code-barres';
    if (title) title.textContent = isNutrition ? '📋 Lire un tableau nutritionnel' : '▦ Scanner un code-barres';
    ensurePill(panel, 'Place ' + label + ' dans le cadre');
    const hint = panel?.querySelector('.barcode-ocr-hint');
    if (hint) {
      hint.innerHTML = isNutrition
        ? '💡 Conseils<br>• Assure-toi d’avoir une bonne luminosité<br>• Évite les reflets<br>• Place le tableau nutritionnel bien centré puis déclenche la lecture'
        : '💡 Conseils<br>• Place le code-barres bien centré dans le cadre<br>• La détection est automatique, sans bouton déclencheur';
    }
    const stop = $('barcode-stop-btn');
    if (stop) {
      stop.textContent = 'Fermer';
      stop.style.display = '';
      stop.title = 'Fermer le scanner';
      stop.setAttribute('aria-label','Fermer le scanner');
      stop.type = 'button';
    }
    return isNutrition;
  }

  function syncOcr(){
    const panel = $('ocr-panel');
    if (cropShellOpen()) {
      if (panel) panel.classList.remove('foodnote-camera-unified', 'food-camera-submodal');
      if (ocrActive) restoreOcrShotButtons();
      ocrActive = false;
      return;
    }
    const cam = $('ocr-camera-box');
    const should = !!(panel && cam && visible(panel) && visible(cam));
    if (!panel) return;
    if (!should) {
      if (ocrActive) {
        panel.classList.remove('foodnote-camera-unified');
        restoreOcrShotButtons();
        restoreOcr(panel);
      }
      ocrActive = false;
      return;
    }
    moveOcrToBody(panel);
    cleanOldClasses(panel);
    panel.classList.add('foodnote-camera-unified');
    normalizeOcrText(panel);
    normalizeOcrShotButton();
    bindCloseButtons();
    ocrActive = true;
  }

  function syncBarcode(){
    const panel = $('barcode-scan-panel');
    if (cropShellOpen()) {
      if (panel) panel.classList.remove('foodnote-camera-unified', 'food-camera-submodal');
      if (barcodeActive) restoreBarcodeShotButton();
      barcodeActive = false;
      return;
    }
    const cam = $('barcode-camera-wrap');
    const should = !!(panel && visible(panel) && (visible(cam) || panel.style.display !== 'none'));
    if (!panel) return;
    if (!should) {
      if (barcodeActive) {
        panel.classList.remove('foodnote-camera-unified');
        restoreBarcodeShotButton();
      }
      barcodeActive = false;
      return;
    }
    cleanOldClasses(panel);
    panel.classList.add('foodnote-camera-unified');
    const barcodeNeedsShot = normalizeBarcodeText(panel);
    normalizeBarcodeShotButton(barcodeNeedsShot);
    bindCloseButtons();
    barcodeActive = true;
  }

  function sync(){
    queued = false;
    if (cropShellOpen()) {
      suspendUnifiedCameraSkin();
      return;
    }
    syncOcr();
    syncBarcode();
    document.body.classList.toggle('foodnote-camera-view-open', !!(ocrActive || barcodeActive));
  }

  function schedule(delay){
    if (delay) { setTimeout(() => schedule(0), delay); return; }
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(sync, 16);
  }
  function burst(){ [0,60,150,320,700].forEach(schedule); }

  function hardCloseBarcode(ev){
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    try { if (typeof window.closeBarcodeScannerPanel === 'function') window.closeBarcodeScannerPanel(); } catch(e) {}
    try { if (typeof window.stopBarcodeScanner === 'function') window.stopBarcodeScanner(); } catch(e) {}
    const panel = $('barcode-scan-panel');
    const cam = $('barcode-camera-wrap');
    if (cam) cam.style.display = 'none';
    if (panel) {
      panel.style.display = 'none';
      panel.classList.remove('foodnote-camera-unified');
      panel.removeAttribute('aria-modal');
      panel.removeAttribute('role');
    }
    barcodeActive = false;
    document.body.classList.remove('barcode-modal-open','foodnote-camera-view-open');
    restoreBarcodeShotButton();
    schedule(60);
  }

  function hardCloseOcr(ev){
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    try { if (typeof window.closeOCRPanel === 'function') window.closeOCRPanel(); } catch(e) {}
    try { if (typeof window.stopNutritionOCRCamera === 'function') window.stopNutritionOCRCamera(false); } catch(e) {}
    const panel = $('ocr-panel');
    const cam = $('ocr-camera-box');
    if (cam) cam.style.display = 'none';
    if (panel) {
      panel.style.display = 'none';
      panel.classList.remove('foodnote-camera-unified');
    }
    ocrActive = false;
    document.body.classList.remove('foodnote-camera-view-open');
    restoreOcrShotButtons();
    restoreOcr(panel);
    schedule(60);
  }

  function bindCloseButton(btn, fn){
    if (!btn || btn.dataset.foodnoteCloseBound01524 === '1') return;
    btn.dataset.foodnoteCloseBound01524 = '1';
    btn.onclick = fn;
    btn.addEventListener('pointerdown', fn, {capture:true, passive:false});
    btn.addEventListener('click', fn, {capture:true});
    btn.addEventListener('touchend', fn, {capture:true, passive:false});
  }

  function bindCloseButtons(){
    bindCloseButton($('barcode-stop-btn'), hardCloseBarcode);
    const ocrClose = document.querySelector('#ocr-panel .ocr-panel-head button');
    bindCloseButton(ocrClose, hardCloseOcr);
  }

  function forceCloseFromClick(ev){
    const target = ev.target;
    if (!target || !target.closest) return;
    if (target.closest('#barcode-stop-btn')) return hardCloseBarcode(ev);
    if (target.closest('#ocr-panel .ocr-panel-head button')) return hardCloseOcr(ev);
  }

  function install(){
    if (installed) return;
    installed = true;
    updateThemeClass();
    wrapApplyTheme();
    bindCloseButtons();
    ['pointerdown','click','touchend'].forEach(ev => document.addEventListener(ev, forceCloseFromClick, {capture:true, passive:false}));
    ['click','touchend','change','transitionend','resize','orientationchange'].forEach(ev => window.addEventListener(ev, burst, {capture:true, passive:true}));
    document.addEventListener('visibilitychange', burst, {passive:true});
    setInterval(() => { updateThemeClass(); bindCloseButtons(); if (ocrActive || barcodeActive || visible($('ocr-panel')) || visible($('barcode-scan-panel'))) schedule(); }, 2200);
    burst();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();

  window.FoodNoteCameraSkin01524 = { build: BUILD, sync: schedule, burst };
})();
