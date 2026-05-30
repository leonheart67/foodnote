/* FoodNote beta 0.22.37 — moteur recadrage OCR unifié
   Principe : le CSS ne répare pas l'état. Le moteur expose un cycle explicite :
   activate(mode) -> reading -> complete()/close().
*/
(function(){
  const BUILD = window.FOODNOTE_BUILD || 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const STYLE_ID = 'foodnote-crop-shell-engine-02213';
  const state = {
    active: false,
    mode: 'recipe',
    parent: null,
    next: null,
    detached: false,
    pointerBound: false,
    cameraSuspended: false
  };

  function qs(sel){ return document.querySelector(sel); }
  function byId(id){ return document.getElementById(id); }
  function modeNow(mode){
    const m = mode || window.FoodNoteCropMode || state.mode || 'recipe';
    return m === 'nutrition_label' ? 'nutrition_label' : 'recipe';
  }


  function cropIsOpen(){
    return !!(state.active || document.body.classList.contains('foodnote-crop-shell-open'));
  }

  function suspendCameraView(reason){
    // Invariant 0.22.15 : un seul état plein écran à la fois.
    // Quand le recadrage démarre, le viseur est suspendu avant d'afficher le crop.
    const body = document.body;
    if (!body) return;
    state.cameraSuspended = true;
    body.classList.add('foodnote-crop-camera-suspended');
    body.classList.remove('foodnote-camera-view-open', 'barcode-modal-open');
    const modal = byId('food-add-modal');
    if (modal) modal.classList.remove('food-scan-submodal-open');
    ['ocr-panel', 'barcode-scan-panel'].forEach(id => {
      const el = byId(id);
      if (!el) return;
      el.classList.remove('foodnote-camera-unified', 'food-camera-submodal');
      el.removeAttribute('aria-modal');
      el.removeAttribute('role');
    });
    const ocrCam = byId('ocr-camera-box');
    if (ocrCam) ocrCam.style.display = 'none';
    const barcodePanel = byId('barcode-scan-panel');
    if (barcodePanel) barcodePanel.style.display = 'none';
    const barcodeWrap = byId('barcode-camera-wrap');
    if (barcodeWrap) barcodeWrap.style.display = 'none';
    const stopBtn = byId('barcode-stop-btn');
    if (stopBtn) stopBtn.style.display = 'none';
    try { if (window.FoodNoteCameraSkin01524 && typeof window.FoodNoteCameraSkin01524.sync === 'function') window.FoodNoteCameraSkin01524.sync(0); } catch(e) {}
  }

  function releaseCameraSuspension(){
    state.cameraSuspended = false;
    document.body.classList.remove('foodnote-crop-camera-suspended');
  }

  function addStyle(){
    if (byId(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.foodnote-crop-shell-open{overflow:hidden!important;}
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active{
        position:fixed!important;
        z-index:99998!important;
        left:50%!important;
        top:50%!important;
        right:auto!important;
        bottom:auto!important;
        transform:translate(-50%,-50%)!important;
        width:min(800px, calc(100vw - 16px))!important;
        max-width:calc(100vw - 16px)!important;
        height:auto!important;
        max-height:calc(100dvh - 16px)!important;
        margin:0!important;
        padding:10px!important;
        border-radius:22px!important;
        background:var(--bg2)!important;
        color:var(--text)!important;
        border:1px solid var(--border2)!important;
        box-shadow:0 24px 80px rgba(0,0,0,.38)!important;
        display:flex!important;
        flex-direction:column!important;
        gap:8px!important;
        overflow:hidden!important;
        box-sizing:border-box!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active::before{
        content:''!important;
        position:fixed!important;
        inset:-200vmax!important;
        background:rgba(0,0,0,.44)!important;
        z-index:-1!important;
        pointer-events:none!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .ocr-panel-head{
        flex:0 0 auto!important;
        display:flex!important;
        align-items:center!important;
        justify-content:space-between!important;
        gap:8px!important;
        margin:0!important;
        padding:0 2px!important;
        min-height:36px!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .ocr-panel-head strong{
        color:var(--text)!important;
        font-size:15px!important;
        line-height:1.15!important;
        font-weight:950!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .ocr-panel-head button{
        flex:0 0 auto!important;
        width:auto!important;
        min-width:74px!important;
        height:34px!important;
        min-height:34px!important;
        padding:0 12px!important;
        border-radius:999px!important;
        font-size:13px!important;
        font-weight:900!important;
        background:var(--bg)!important;
        color:var(--text)!important;
        border:1px solid var(--border2)!important;
        position:relative!important;
        inset:auto!important;
        transform:none!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .ocr-unified-note,
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active #ocr-camera-box,
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active #ocr-result,
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active #recipe-ocr-result,
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active #recipe-ai-result{
        display:none!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active #ocr-status{
        flex:0 0 auto!important;
        display:block!important;
        margin:0!important;
        padding:7px 10px!important;
        border-radius:14px!important;
        background:color-mix(in srgb, var(--green) 11%, var(--bg))!important;
        border:1px solid color-mix(in srgb, var(--green) 28%, var(--border2))!important;
        color:var(--text)!important;
        font-size:12px!important;
        line-height:1.25!important;
        font-weight:800!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active #recipe-crop-box{
        display:flex!important;
        flex-direction:column!important;
        flex:1 1 auto!important;
        min-height:0!important;
        max-height:calc(100dvh - 112px)!important;
        margin:0!important;
        padding:9px!important;
        border-radius:18px!important;
        background:var(--bg)!important;
        color:var(--text)!important;
        border:1px solid var(--border2)!important;
        box-sizing:border-box!important;
        overflow:hidden!important;
        gap:8px!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-head{
        flex:0 0 auto!important;
        display:flex!important;
        align-items:flex-start!important;
        justify-content:space-between!important;
        gap:8px!important;
        margin:0!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-head strong{
        color:var(--text)!important;
        font-size:13px!important;
        font-weight:950!important;
        line-height:1.15!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-head span{
        color:var(--text3)!important;
        font-size:11px!important;
        line-height:1.2!important;
        text-align:right!important;
        max-width:430px!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-stage{
        position:relative!important;
        flex:0 1 auto!important;
        width:fit-content!important;
        max-width:100%!important;
        min-width:0!important;
        max-height:min(58dvh, 520px)!important;
        margin:0 auto!important;
        border-radius:16px!important;
        overflow:hidden!important;
        background:#101614!important;
        border:1px solid var(--border2)!important;
        touch-action:none!important;
        user-select:none!important;
        box-sizing:border-box!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-stage img{
        display:block!important;
        width:auto!important;
        height:auto!important;
        max-width:100%!important;
        max-height:min(58dvh, 520px)!important;
        object-fit:contain!important;
        background:#101614!important;
        margin:0!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-selection{
        position:absolute!important;
        box-sizing:border-box!important;
        border:2px solid var(--green)!important;
        border-radius:14px!important;
        background:rgba(29,158,117,.12)!important;
        box-shadow:0 0 0 9999px rgba(0,0,0,.46), inset 0 1px 0 rgba(255,255,255,.24)!important;
        cursor:move!important;
        touch-action:none!important;
        z-index:3!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-selection::before{
        content:'zone à lire'!important;
        position:absolute!important;
        left:8px!important;
        top:8px!important;
        padding:4px 8px!important;
        border-radius:999px!important;
        background:rgba(0,0,0,.64)!important;
        color:#fff!important;
        font-size:11px!important;
        font-weight:900!important;
        pointer-events:none!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-handle{
        position:absolute!important;
        width:28px!important;
        height:28px!important;
        border-radius:999px!important;
        background:var(--green)!important;
        border:2px solid #fff!important;
        box-shadow:0 4px 14px rgba(0,0,0,.32)!important;
        z-index:4!important;
        touch-action:none!important;
      }
      .recipe-crop-handle.nw{left:-14px!important;top:-14px!important;cursor:nwse-resize!important;}
      .recipe-crop-handle.ne{right:-14px!important;top:-14px!important;cursor:nesw-resize!important;}
      .recipe-crop-handle.sw{left:-14px!important;bottom:-14px!important;cursor:nesw-resize!important;}
      .recipe-crop-handle.se{right:-14px!important;bottom:-14px!important;cursor:nwse-resize!important;}
      .recipe-crop-handle.n{left:50%!important;top:-14px!important;transform:translateX(-50%)!important;cursor:ns-resize!important;}
      .recipe-crop-handle.s{left:50%!important;bottom:-14px!important;transform:translateX(-50%)!important;cursor:ns-resize!important;}
      .recipe-crop-handle.w{left:-14px!important;top:50%!important;transform:translateY(-50%)!important;cursor:ew-resize!important;}
      .recipe-crop-handle.e{right:-14px!important;top:50%!important;transform:translateY(-50%)!important;cursor:ew-resize!important;}
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-actions{
        flex:0 0 auto!important;
        display:grid!important;
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
        gap:7px!important;
        margin:0!important;
        padding:0!important;
      }
      body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-actions button{
        min-width:0!important;
        width:100%!important;
        height:38px!important;
        min-height:38px!important;
        padding:0 8px!important;
        border-radius:13px!important;
        font-size:12px!important;
        font-weight:900!important;
        white-space:nowrap!important;
        overflow:hidden!important;
        text-overflow:ellipsis!important;
      }
      @media(max-width:760px){
        body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active{
          width:calc(100vw - 10px)!important;
          max-height:calc(100dvh - 10px)!important;
          padding:8px!important;
          border-radius:20px!important;
        }
        body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active #recipe-crop-box{
          max-height:calc(100dvh - 104px)!important;
          padding:8px!important;
        }
        body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-actions{
          grid-template-columns:1fr!important;
        }
        body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-stage,
        body.foodnote-crop-shell-open > #ocr-panel.foodnote-crop-shell-active .recipe-crop-stage img{
          max-height:58dvh!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function rememberPanel(panel){
    if (!panel || state.parent) return;
    state.parent = panel.parentNode;
    state.next = panel.nextSibling;
  }

  function detachPanel(){
    suspendCameraView('crop-open');
    const panel = byId('ocr-panel');
    if (!panel) return null;
    rememberPanel(panel);
    if (panel.parentNode !== document.body) document.body.appendChild(panel);
    state.detached = true;
    panel.classList.add('foodnote-crop-shell-active');
    panel.classList.remove('foodnote-recipe-crop-active', 'foodnote-crop-detached');
    document.body.classList.add('foodnote-crop-shell-open');
    document.body.classList.remove('foodnote-recipe-crop-open');
    panel.style.setProperty('display', 'flex', 'important');
    return panel;
  }

  function restorePanel(keepPanelVisible){
    const panel = byId('ocr-panel');
    document.body.classList.remove('foodnote-crop-shell-open', 'foodnote-recipe-crop-open');
    releaseCameraSuspension();
    if (!panel) return;
    panel.classList.remove('foodnote-crop-shell-active', 'foodnote-recipe-crop-active', 'foodnote-crop-detached');
    if (state.detached && state.parent && panel.parentNode === document.body) {
      try {
        if (state.next && state.next.parentNode === state.parent) state.parent.insertBefore(panel, state.next);
        else state.parent.appendChild(panel);
      } catch(e) {}
    }
    state.detached = false;
    if (keepPanelVisible === false) panel.style.display = 'none';
    else if (keepPanelVisible === true) panel.style.display = 'block';
  }

  function labelActions(mode){
    mode = modeNow(mode);
    const panel = byId('ocr-panel');
    const crop = byId('recipe-crop-box');
    if (!panel || !crop) return;
    const title = panel.querySelector('.ocr-panel-head strong');
    const note = panel.querySelector('.ocr-unified-note');
    const headTitle = crop.querySelector('.recipe-crop-head strong');
    const hint = crop.querySelector('.recipe-crop-head span');
    const read = byId('recipe-crop-read-btn');
    const actions = crop.querySelector('.recipe-crop-actions');
    const buttons = actions ? Array.from(actions.querySelectorAll('button')) : [];
    const retake = buttons[0];
    const full = buttons[1];
    if (mode === 'nutrition_label') {
      if (title) title.textContent = 'Recadrage tableau nutritionnel';
      if (note) note.textContent = 'La photo reste locale jusqu’à validation. Déplace le cadre sur le tableau kcal/protéines/glucides/lipides, puis lance la lecture.';
      if (headTitle) headTitle.textContent = 'Recadrer le tableau nutritionnel';
      if (hint) hint.textContent = 'Garde seulement le tableau utile : valeurs pour 100 g, kcal, protéines, glucides, lipides. Évite le logo et le reste de l’emballage.';
      if (retake) retake.textContent = '↩ Reprendre photo';
      if (full) full.textContent = 'Lire toute l’image';
      if (read && !read.disabled) read.textContent = '📖 Lire ce tableau';
    } else {
      if (title) title.textContent = 'Recadrage recette';
      if (note) note.textContent = 'La photo reste locale jusqu’à validation. Déplace le cadre sur la liste d’ingrédients, puis lance la lecture.';
      if (headTitle) headTitle.textContent = 'Recadrer la liste';
      if (hint) hint.textContent = 'Déplace le cadre, ou tire les ronds verts pour agrandir/réduire la zone.';
      if (retake) retake.textContent = '↩ Reprendre photo';
      if (full) full.textContent = 'Lire toute l’image';
      if (read && !read.disabled) read.textContent = '📖 Lire cette zone';
    }
  }

  function ensureHandles(){
    const sel = byId('recipe-crop-selection');
    if (!sel) return;
    ['nw','ne','sw','se','n','s','w','e'].forEach(mode => {
      let h = sel.querySelector('.recipe-crop-handle.' + mode);
      if (!h) {
        h = document.createElement('span');
        h.className = 'recipe-crop-handle ' + mode;
        sel.appendChild(h);
      }
      h.dataset.handle = mode;
    });
  }

  function readState(){
    const sel = byId('recipe-crop-selection');
    const pct = (value, fallback) => {
      const n = parseFloat(String(value || '').replace('%',''));
      return Number.isFinite(n) ? n : fallback;
    };
    if (!sel) return { x:10, y:12, w:80, h:62 };
    return {
      x: pct(sel.style.left, 10),
      y: pct(sel.style.top, 12),
      w: pct(sel.style.width, 80),
      h: pct(sel.style.height, 62)
    };
  }

  function applyState(next){
    const sel = byId('recipe-crop-selection');
    if (!sel) return;
    const minW = 18, minH = 14;
    let x = Number(next.x), y = Number(next.y), w = Number(next.w), h = Number(next.h);
    if (!Number.isFinite(x)) x = 10;
    if (!Number.isFinite(y)) y = 12;
    if (!Number.isFinite(w)) w = 80;
    if (!Number.isFinite(h)) h = 62;
    w = Math.max(minW, Math.min(96, w));
    h = Math.max(minH, Math.min(92, h));
    x = Math.max(1, Math.min(99 - w, x));
    y = Math.max(1, Math.min(99 - h, y));
    sel.style.left = x + '%';
    sel.style.top = y + '%';
    sel.style.width = w + '%';
    sel.style.height = h + '%';
  }

  function computeResize(start, mode, dx, dy){
    let {x,y,w,h} = start;
    if (mode === 'move') return { x:x+dx, y:y+dy, w, h };
    if (mode.includes('e')) w += dx;
    if (mode.includes('s')) h += dy;
    if (mode.includes('w')) { x += dx; w -= dx; }
    if (mode.includes('n')) { y += dy; h -= dy; }
    return { x, y, w, h };
  }

  function bindResizer(){
    const stage = byId('recipe-crop-stage');
    const sel = byId('recipe-crop-selection');
    if (!stage || !sel || sel.__fn02212ResizeBound) return;
    let active = null;
    const toPct = ev => {
      const r = stage.getBoundingClientRect();
      return {
        x: r.width ? ((ev.clientX - r.left) / r.width) * 100 : 0,
        y: r.height ? ((ev.clientY - r.top) / r.height) * 100 : 0
      };
    };
    const down = ev => {
      const handle = ev.target && ev.target.closest ? ev.target.closest('.recipe-crop-handle') : null;
      const selection = ev.target && ev.target.closest ? ev.target.closest('#recipe-crop-selection') : null;
      if (!handle && !selection) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      const p = toPct(ev);
      active = {
        pointerId: ev.pointerId,
        mode: handle ? (handle.dataset.handle || 'move') : 'move',
        startX: p.x,
        startY: p.y,
        state: readState()
      };
      try { sel.setPointerCapture(ev.pointerId); } catch(e) {}
      sel.classList.add('dragging');
      return false;
    };
    const move = ev => {
      if (!active) return;
      ev.preventDefault();
      ev.stopPropagation();
      const p = toPct(ev);
      applyState(computeResize(active.state, active.mode, p.x - active.startX, p.y - active.startY));
      return false;
    };
    const up = ev => {
      if (!active) return;
      ev.preventDefault();
      ev.stopPropagation();
      try { sel.releasePointerCapture(active.pointerId); } catch(e) {}
      sel.classList.remove('dragging');
      active = null;
      return false;
    };
    sel.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, { capture:true, passive:false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    sel.__fn02212ResizeBound = true;
  }

  function drawCropToCanvasFromDom(){
    const img = byId('recipe-crop-img');
    const canvas = byId('ocr-canvas');
    if (!img || !canvas || !img.naturalWidth) throw new Error('Photo à recadrer indisponible.');
    const st = readState();
    const sx = Math.round((st.x / 100) * img.naturalWidth);
    const sy = Math.round((st.y / 100) * img.naturalHeight);
    const sw = Math.max(1, Math.round((st.w / 100) * img.naturalWidth));
    const sh = Math.max(1, Math.round((st.h / 100) * img.naturalHeight));
    const targetW = 1900;
    const maxW = 2200;
    const outW = Math.round(Math.min(maxW, Math.max(targetW, sw)));
    const scale = outW / sw;
    const outH = Math.max(1, Math.round(sh * scale));
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha:false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    return { sx, sy, sw, sh, outW, outH, scale:Math.round(scale * 100) / 100, usedFrame:true, manualCrop:true, cropEngine:'0.22.15' };
  }

  function overrideReadButton(){
    if (window.runRecipeOCRFromCrop && window.runRecipeOCRFromCrop.__fn02212CropEngine) return;
    if (typeof window.runRecipeOCRFromCrop !== 'function') return;
    const original = window.runRecipeOCRFromCrop;
    const wrapped = async function(){
      const btn = byId('recipe-crop-read-btn');
      const mode = modeNow();
      try {
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyse…'; }
        const cropInfo = drawCropToCanvasFromDom();
        const canvas = byId('ocr-canvas');
        const dataUrl = canvas ? canvas.toDataURL('image/png') : '';
        if (mode === 'nutrition_label' && typeof window.processNutritionLabelImage === 'function') {
          return await window.processNutritionLabelImage(dataUrl, { ...cropInfo, nutritionLabel:true }, 'zone recadrée');
        }
        if (typeof window.processRecipeOCRImage === 'function') {
          return await window.processRecipeOCRImage(dataUrl, cropInfo, 'zone recadrée');
        }
        return await original.apply(this, arguments);
      } catch(e) {
        try { window.setOCRStatus && window.setOCRStatus((mode === 'nutrition_label' ? 'Erreur OCR tableau nutritionnel : ' : 'Erreur OCR recette : ') + (e.message || e), true); } catch(_) {}
      } finally {
        const cropStillActive = state.active;
        if (btn && cropStillActive) {
          btn.disabled = false;
          btn.textContent = mode === 'nutrition_label' ? '📖 Lire ce tableau' : '📖 Lire cette zone';
        }
      }
    };
    wrapped.__fn02212CropEngine = true;
    window.runRecipeOCRFromCrop = wrapped;
  }

  function activate(mode){
    mode = modeNow(mode);
    addStyle();
    state.active = true;
    state.mode = mode;
    try { window.FoodNoteCropMode = mode; } catch(e) {}
    const panel = detachPanel();
    const crop = byId('recipe-crop-box');
    if (crop) crop.style.setProperty('display', 'flex', 'important');
    const result = byId('ocr-result');
    const recipe = byId('recipe-ocr-result');
    const ai = byId('recipe-ai-result');
    if (result) result.style.display = 'none';
    if (recipe) recipe.style.display = 'none';
    if (ai) ai.style.display = 'none';
    const modal = byId('food-add-modal');
    if (modal) {
      modal.classList.add('food-add-expanded', 'food-add-recipe-mode', 'food-add-recipe-crop');
      modal.classList.toggle('food-add-nutrition-crop', mode === 'nutrition_label');
    }
    ensureHandles();
    bindResizer();
    overrideReadButton();
    labelActions(mode);
    requestAnimationFrame(() => {
      try {
        if (panel) panel.scrollTop = 0;
        if (crop) crop.scrollTop = 0;
        byId('recipe-crop-stage')?.scrollIntoView({ block:'nearest', inline:'nearest' });
      } catch(e) {}
    });
  }

  function complete(opts){
    opts = opts || {};
    state.active = false;
    restorePanel(true);
    const modal = byId('food-add-modal');
    if (modal) {
      modal.classList.remove('food-add-recipe-crop', 'food-add-nutrition-crop', 'food-add-recipe-processing');
      modal.classList.add('food-add-expanded');
    }
    const crop = byId('recipe-crop-box');
    if (crop) crop.style.display = 'none';
    const panel = byId('ocr-panel');
    if (panel) panel.style.display = 'block';
    if (opts.showResultId) {
      const target = byId(opts.showResultId);
      if (target) target.style.display = 'block';
      try {
        if (opts.showResultId === 'recipe-ocr-result' && window.FoodNoteRecipeWorkflowController) {
          window.FoodNoteRecipeWorkflowController.step('ocr_result');
        }
      } catch(e) {}
    }
    const btn = byId('recipe-crop-read-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = modeNow(opts.mode) === 'nutrition_label' ? '📖 Lire ce tableau' : '📖 Lire cette zone';
    }
  }

  function close(opts){
    opts = opts || {};
    state.active = false;
    restorePanel(opts.keepPanelVisible === true);
    const modal = byId('food-add-modal');
    if (modal) modal.classList.remove('food-add-recipe-crop', 'food-add-nutrition-crop', 'food-add-recipe-processing');
    const crop = byId('recipe-crop-box');
    if (crop) crop.style.display = 'none';
  }

  function wrapPreview(){
    if (typeof window.showRecipeCropPreview !== 'function') return;
    if (window.showRecipeCropPreview.__fn02212CropEngine) return;
    const original = window.showRecipeCropPreview;
    const wrapped = function(){
      const out = original.apply(this, arguments);
      const mode = modeNow();
      requestAnimationFrame(() => activate(mode));
      const img = byId('recipe-crop-img');
      if (img && !img.__fn02212CropLoadBound) {
        img.addEventListener('load', () => activate(modeNow()), { once:false });
        img.__fn02212CropLoadBound = true;
      }
      return out;
    };
    wrapped.__fn02212CropEngine = true;
    window.showRecipeCropPreview = wrapped;
  }

  function bindCloseButton(){
    const panel = byId('ocr-panel');
    const closeBtn = panel ? panel.querySelector('.ocr-panel-head button') : null;
    if (!closeBtn || closeBtn.__fn02212CloseBound) return;
    closeBtn.addEventListener('click', () => close({ keepPanelVisible:false }), true);
    closeBtn.__fn02212CloseBound = true;
  }

  function updateVersionBadges(){
    document.querySelectorAll('.fn-version-badge').forEach(el => { el.textContent = BUILD; });
  }

  function init(){
    addStyle();
    wrapPreview();
    overrideReadButton();
    bindCloseButton();
    updateVersionBadges();
    setTimeout(() => { wrapPreview(); overrideReadButton(); bindCloseButton(); }, 300);
    setTimeout(() => { wrapPreview(); overrideReadButton(); bindCloseButton(); }, 1200);
  }

  window.FoodNoteCropShell = {
    activate,
    complete,
    close,
    restore: restorePanel,
    readState,
    applyState,
    drawCropToCanvasFromDom,
    suspendCameraView,
    releaseCameraSuspension,
    isActive: () => cropIsOpen(),
    mode: () => state.mode
  };
  // Compatibilité avec d'anciens modules/outils de debug.
  window.FoodNoteCropResizeModule01610 = window.FoodNoteCropShell;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
