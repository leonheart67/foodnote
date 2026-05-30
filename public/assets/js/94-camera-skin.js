/* FoodNote 0.18.1 — caméra raccord aux couleurs du thème
   Viseur unique pour plat/recette/étiquette, en utilisant les variables existantes du thème.
   Caméra raccordée au thème, déclencheur code-barres caché en mode scan automatique, bouton Fermer renforcé.
   Pas de MutationObserver : sync légère par événements + intervalle pendant affichage.
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

  function removeOldStyles(){
    [
      'foodnote-camera-skin-01515','foodnote-camera-skin-01516','foodnote-camera-skin-01517',
      'foodnote-camera-skin-01518','foodnote-camera-skin-01519','foodnote-camera-skin-01520','foodnote-camera-skin-01521','foodnote-camera-skin-01522','foodnote-camera-skin-01523','foodnote-camera-skin-01524'
    ].forEach(id => { try { $(id)?.remove(); } catch(e){} });
  }

  function injectStyle(){
    removeOldStyles();
    const style = document.createElement('style');
    style.id = 'foodnote-camera-skin-01524';
    style.textContent = `
      body.foodnote-camera-view-open{overflow:hidden!important;}

      /* 0.15.24 : aucune couleur grise forcée.
         Le viseur réutilise les couleurs déjà définies dans style-light/style-dark :
         --bg, --bg2, --bg3, --bg4, --text, --border, --green… */
      body > #ocr-panel.foodnote-camera-unified,
      body > #barcode-scan-panel.foodnote-camera-unified{
        --fncam-panel: var(--bg2);
        --fncam-panel-soft: var(--bg);
        --fncam-card: var(--bg2);
        --fncam-card-soft: var(--green-bg);
        --fncam-text: var(--text);
        --fncam-muted: var(--text2);
        --fncam-border: var(--border2);
        --fncam-accent: var(--green);
        --fncam-accent-soft: var(--green-bg);
        --fncam-accent-border: var(--green-mid);
        --fncam-accent-text: var(--green-dark);
        --fncam-overlay: rgba(0,0,0,.42);
        --fncam-frame-shadow: rgba(0,0,0,.20);
        --fncam-video-bg: var(--bg4);
        position:fixed!important;
        z-index:100420!important;
        left:50%!important;
        top:50%!important;
        right:auto!important;
        bottom:auto!important;
        transform:translate(-50%,-50%)!important;
        display:flex!important;
        flex-direction:column!important;
        gap:12px!important;
        width:min(720px,calc(100vw - 28px))!important;
        max-height:min(92dvh,780px)!important;
        overflow:auto!important;
        margin:0!important;
        padding:14px 14px calc(96px + env(safe-area-inset-bottom,0px)) 14px!important;
        box-sizing:border-box!important;
        border:1px solid var(--fncam-border)!important;
        border-radius:24px!important;
        background:linear-gradient(180deg,var(--fncam-panel),var(--fncam-panel-soft))!important;
        color:var(--fncam-text)!important;
        box-shadow:0 26px 90px rgba(0,0,0,.26)!important;
        -webkit-overflow-scrolling:touch!important;
      }
      body.foodnote-theme-dark > #ocr-panel.foodnote-camera-unified,
      body.foodnote-theme-dark > #barcode-scan-panel.foodnote-camera-unified,
      body[data-theme="dark"] > #ocr-panel.foodnote-camera-unified,
      body[data-theme="dark"] > #barcode-scan-panel.foodnote-camera-unified{
        --fncam-overlay: rgba(0,0,0,.66);
        --fncam-frame-shadow: rgba(0,0,0,.34);
        box-shadow:0 28px 110px rgba(0,0,0,.64)!important;
      }
      body > #ocr-panel.foodnote-camera-unified::before,
      body > #barcode-scan-panel.foodnote-camera-unified::before{
        content:''!important;
        position:fixed!important;
        inset:-100vmax!important;
        z-index:-1!important;
        background:var(--fncam-overlay)!important;
        backdrop-filter:blur(7px)!important;
      }

      body > #ocr-panel.foodnote-camera-unified .ocr-panel-head,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-scan-actions{
        position:sticky!important;
        top:0!important;
        z-index:50!important;
        display:grid!important;
        grid-template-columns:minmax(0,1fr) auto!important;
        align-items:center!important;
        gap:10px!important;
        min-height:44px!important;
        margin:0!important;
        padding:0!important;
        background:transparent!important;
        border:0!important;
      }
      body > #ocr-panel.foodnote-camera-unified .ocr-panel-head strong,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-inline-title{
        display:flex!important;
        align-items:center!important;
        gap:7px!important;
        min-width:0!important;
        margin:0!important;
        color:var(--fncam-text)!important;
        font-size:17px!important;
        line-height:1.12!important;
        font-weight:950!important;
        letter-spacing:-.01em!important;
        text-shadow:none!important;
      }
      body > #ocr-panel.foodnote-camera-unified .ocr-panel-head button,
      body > #barcode-scan-panel.foodnote-camera-unified #barcode-stop-btn{
        position:relative!important;
        z-index:70!important;
        pointer-events:auto!important;
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        width:auto!important;
        min-width:132px!important;
        height:44px!important;
        min-height:44px!important;
        padding:0 20px!important;
        border-radius:16px!important;
        border:1px solid var(--fncam-border)!important;
        background:var(--fncam-card)!important;
        color:var(--fncam-text)!important;
        font-size:15px!important;
        font-weight:950!important;
        box-shadow:0 10px 26px rgba(48,60,50,.14)!important;
        cursor:pointer!important;
        -webkit-tap-highlight-color:transparent!important;
      }
      body.dark > #ocr-panel.foodnote-camera-unified .ocr-panel-head button,
      body.dark > #barcode-scan-panel.foodnote-camera-unified #barcode-stop-btn,
      body[data-theme="dark"] > #ocr-panel.foodnote-camera-unified .ocr-panel-head button,
      body[data-theme="dark"] > #barcode-scan-panel.foodnote-camera-unified #barcode-stop-btn{
        box-shadow:0 10px 26px rgba(0,0,0,.35)!important;
      }

      body > #ocr-panel.foodnote-camera-unified .foodnote-scan-pill,
      body > #barcode-scan-panel.foodnote-camera-unified .foodnote-scan-pill{
        align-self:center!important;
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        max-width:calc(100% - 18px)!important;
        padding:8px 16px!important;
        border-radius:999px!important;
        border:1px solid var(--fncam-accent-border)!important;
        background:var(--fncam-accent-soft)!important;
        color:var(--fncam-accent-text)!important;
        font-size:14px!important;
        font-weight:850!important;
        line-height:1.2!important;
        text-align:center!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.10)!important;
        backdrop-filter:blur(8px)!important;
      }

      body > #ocr-panel.foodnote-camera-unified #ocr-camera-box,
      body > #ocr-panel.foodnote-camera-unified .ocr-camera-box{display:block!important;width:100%!important;margin:0!important;}
      body > #ocr-panel.foodnote-camera-unified .ocr-video-wrap,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-camera-wrap{
        position:relative!important;
        display:block!important;
        width:100%!important;
        height:min(56dvh,440px)!important;
        min-height:300px!important;
        max-height:440px!important;
        margin:0!important;
        border-radius:18px!important;
        overflow:hidden!important;
        background:var(--fncam-video-bg)!important;
        border:1px solid var(--fncam-accent-border)!important;
        box-shadow:0 16px 40px rgba(0,0,0,.18)!important;
        box-sizing:border-box!important;
      }
      body.dark > #ocr-panel.foodnote-camera-unified .ocr-video-wrap,
      body.dark > #barcode-scan-panel.foodnote-camera-unified .barcode-camera-wrap,
      body[data-theme="dark"] > #ocr-panel.foodnote-camera-unified .ocr-video-wrap,
      body[data-theme="dark"] > #barcode-scan-panel.foodnote-camera-unified .barcode-camera-wrap{
        box-shadow:0 16px 40px rgba(0,0,0,.45)!important;
      }
      body > #ocr-panel.foodnote-camera-unified #ocr-video,
      body > #ocr-panel.foodnote-camera-unified .ocr-video-wrap video,
      body > #ocr-panel.foodnote-camera-unified .ocr-video-wrap canvas,
      body > #barcode-scan-panel.foodnote-camera-unified video,
      body > #barcode-scan-panel.foodnote-camera-unified canvas,
      body > #barcode-scan-panel.foodnote-camera-unified #barcode-html5-reader,
      body > #barcode-scan-panel.foodnote-camera-unified #barcode-html5-reader > div{
        width:100%!important;
        height:100%!important;
        min-height:0!important;
        max-height:none!important;
        object-fit:cover!important;
        display:block!important;
        border-radius:0!important;
        background:var(--fncam-video-bg)!important;
      }

      /* Repères de visée : mêmes coins + même cadre, mais couleur issue du thème. */
      body > #ocr-panel.foodnote-camera-unified .ocr-frame,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-frame{
        position:absolute!important;
        inset:12% 8%!important;
        border:0!important;
        border-radius:16px!important;
        box-shadow:0 0 0 999px var(--fncam-frame-shadow)!important;
        pointer-events:none!important;
        background:transparent!important;
      }
      body > #ocr-panel.foodnote-camera-unified .ocr-frame::before,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-frame::before{
        content:''!important;
        position:absolute!important;
        inset:0!important;
        border-radius:16px!important;
        background:
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) left top/34px 4px no-repeat,
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) left top/4px 34px no-repeat,
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) right top/34px 4px no-repeat,
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) right top/4px 34px no-repeat,
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) left bottom/34px 4px no-repeat,
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) left bottom/4px 34px no-repeat,
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) right bottom/34px 4px no-repeat,
          linear-gradient(var(--fncam-accent-text),var(--fncam-accent-text)) right bottom/4px 34px no-repeat!important;
        filter:drop-shadow(0 1px 4px rgba(0,0,0,.28))!important;
      }
      body > #ocr-panel.foodnote-camera-unified .ocr-frame::after,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-frame::after{
        content:''!important;
        position:absolute!important;
        inset:0!important;
        border:1px solid var(--fncam-accent)!important;
        border-radius:16px!important;
        box-shadow:0 0 22px rgba(45,178,133,.18)!important;
      }

      body > #ocr-panel.foodnote-camera-unified .ocr-status,
      body > #ocr-panel.foodnote-camera-unified .ocr-unified-note,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-status,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-hint{
        position:relative!important;
        z-index:4!important;
        display:block!important;
        margin:0!important;
        padding:10px 12px!important;
        border-radius:13px!important;
        border:1px solid var(--fncam-border)!important;
        background:linear-gradient(180deg,var(--fncam-card-soft),var(--fncam-card))!important;
        color:var(--fncam-text)!important;
        font-size:13px!important;
        line-height:1.38!important;
        text-align:left!important;
        max-width:none!important;
        font-weight:650!important;
        backdrop-filter:blur(8px)!important;
      }
      body > #ocr-panel.foodnote-camera-unified .ocr-status{display:none!important;}
      body > #ocr-panel.foodnote-camera-unified .ocr-unified-note b,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-hint b{color:var(--fncam-accent-text)!important;font-weight:950!important;}

      body > #ocr-panel.foodnote-camera-unified .ocr-camera-actions{display:block!important;margin:0!important;padding:0!important;}
      body > #ocr-panel.foodnote-camera-unified .ocr-camera-actions button{display:none!important;}
      body > #ocr-panel.foodnote-camera-unified .ocr-camera-actions .foodnote-camera-shot,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-btn.foodnote-camera-shot{
        position:absolute!important;
        left:50%!important;
        bottom:calc(22px + env(safe-area-inset-bottom,0px))!important;
        transform:translateX(-50%)!important;
        z-index:60!important;
        pointer-events:auto!important;
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        width:78px!important;
        height:78px!important;
        min-width:78px!important;
        min-height:78px!important;
        max-width:78px!important;
        max-height:78px!important;
        padding:0!important;
        border-radius:999px!important;
        border:8px solid var(--fncam-accent-soft)!important;
        outline:1px solid var(--fncam-accent-border)!important;
        background:var(--fncam-accent)!important;
        color:#fff!important;
        font-size:0!important;
        line-height:1!important;
        box-shadow:0 16px 42px rgba(0,0,0,.22)!important;
      }
      body.dark > #ocr-panel.foodnote-camera-unified .ocr-camera-actions .foodnote-camera-shot,
      body.dark > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-btn.foodnote-camera-shot,
      body[data-theme="dark"] > #ocr-panel.foodnote-camera-unified .ocr-camera-actions .foodnote-camera-shot,
      body[data-theme="dark"] > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-btn.foodnote-camera-shot{
        color:#0f1412!important;
        box-shadow:0 16px 42px rgba(0,0,0,.45)!important;
      }
      body > #ocr-panel.foodnote-camera-unified .ocr-camera-actions .foodnote-camera-shot::before,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-btn.foodnote-camera-shot::before{
        content:'📷'!important;
        font-size:31px!important;
        line-height:1!important;
      }
      body > #ocr-panel.foodnote-camera-unified .ocr-camera-actions .foodnote-camera-shot:active,
      body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-btn.foodnote-camera-shot:active{transform:translateX(-50%) scale(.96)!important;}
      body > #ocr-panel.foodnote-camera-unified #ocr-auto-btn{display:none!important;}
      body > #ocr-panel.foodnote-camera-unified #recipe-ocr-result,
      body > #ocr-panel.foodnote-camera-unified #ocr-result,
      body > #ocr-panel.foodnote-camera-unified #recipe-crop-box{position:relative!important;z-index:4!important;color:var(--fncam-text)!important;background:var(--fncam-card)!important;border:1px solid var(--fncam-border)!important;border-radius:18px!important;}

      @media(max-width:760px){
        body > #ocr-panel.foodnote-camera-unified,
        body > #barcode-scan-panel.foodnote-camera-unified{
          left:12px!important;
          right:12px!important;
          top:50%!important;
          bottom:auto!important;
          transform:translateY(-50%)!important;
          width:auto!important;
          max-height:min(92dvh,calc(100dvh - 24px))!important;
          border-radius:22px!important;
          padding:12px 12px calc(88px + env(safe-area-inset-bottom,0px)) 12px!important;
        }
        body > #ocr-panel.foodnote-camera-unified .ocr-panel-head strong,
        body > #barcode-scan-panel.foodnote-camera-unified .barcode-inline-title{font-size:15px!important;}
        body > #ocr-panel.foodnote-camera-unified .ocr-panel-head button,
        body > #barcode-scan-panel.foodnote-camera-unified #barcode-stop-btn{
          min-width:110px!important;
          height:42px!important;
          min-height:42px!important;
          padding:0 15px!important;
          border-radius:15px!important;
          font-size:14px!important;
        }
        body > #ocr-panel.foodnote-camera-unified .foodnote-scan-pill,
        body > #barcode-scan-panel.foodnote-camera-unified .foodnote-scan-pill{font-size:12px!important;padding:7px 12px!important;}
        body > #ocr-panel.foodnote-camera-unified .ocr-video-wrap,
        body > #barcode-scan-panel.foodnote-camera-unified .barcode-camera-wrap{
          height:min(48dvh,390px)!important;
          min-height:min(41dvh,285px)!important;
          max-height:390px!important;
          border-radius:18px!important;
        }
        body > #ocr-panel.foodnote-camera-unified .ocr-unified-note,
        body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-hint{font-size:12px!important;}
        body > #ocr-panel.foodnote-camera-unified .ocr-camera-actions .foodnote-camera-shot,
        body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-btn.foodnote-camera-shot{
          width:72px!important;height:72px!important;min-width:72px!important;min-height:72px!important;max-width:72px!important;max-height:72px!important;
          bottom:calc(18px + env(safe-area-inset-bottom,0px))!important;
        }
      }
      @media(max-width:760px) and (max-height:660px){
        body > #ocr-panel.foodnote-camera-unified .ocr-video-wrap,
        body > #barcode-scan-panel.foodnote-camera-unified .barcode-camera-wrap{height:min(43dvh,305px)!important;min-height:220px!important;}
        body > #ocr-panel.foodnote-camera-unified .ocr-unified-note,
        body > #barcode-scan-panel.foodnote-camera-unified .barcode-ocr-hint{font-size:11px!important;}
      }
    `;
    document.head.appendChild(style);
  }


  function getThemeName(){
    try {
      if (typeof window.getCurrentTheme === 'function') return window.getCurrentTheme() === 'light' ? 'light' : 'dark';
      const stored = localStorage.getItem('foodnote_theme');
      if (stored === 'light' || stored === 'dark') return stored;
      const href = (document.getElementById('theme-css')?.getAttribute('href') || '').toLowerCase();
      return href.includes('style-light') ? 'light' : 'dark';
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
    injectStyle();
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
