/* FoodNote 0.18.1 — visée caméra harmonisée
   Objectif : même fenêtre de prise de vue pour Photo d’un plat et Lire une étiquette.
*/
(function(){
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const $ = (id) => document.getElementById(id);
  const MODAL_CONTROLLER_OWNS_POPUP = !!window.__FoodNoteFoodAddModalControllerOwnsPopup;

  function injectStyles() {
    if ($('food-add-ux1513-style')) return;
    ['food-add-ux1511-style','food-add-ux1512-style'].forEach(id => { try { $(id)?.remove(); } catch(e) {} });
    const style = document.createElement('style');
    style.id = 'food-add-ux1513-style';
    style.textContent = `
      #food-add-modal .food-add-kicker{font-weight:800;letter-spacing:.01em}
      body > #food-add-modal.food-add-modal.is-open{display:flex!important;align-items:center!important;justify-content:center!important;padding:18px!important;box-sizing:border-box!important}
      body > #food-add-modal.food-add-modal .food-add-dialog{margin:auto!important;position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;transform:none!important;width:min(980px,calc(100vw - 28px))!important;max-height:calc(100dvh - 36px)!important;overflow-y:auto!important}
      body > #food-add-modal.food-add-modal .food-add-body{min-width:0!important}
      body > #food-add-modal.food-add-modal .food-add-main{min-width:0!important;width:100%!important}
      .food-add-intent-chooser{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 12px 0}
      .food-add-intent-btn{border:1px solid var(--border2);background:linear-gradient(180deg,var(--bg2),var(--bg));color:var(--text);border-radius:18px;padding:12px 12px;text-align:left;box-shadow:var(--shadow-soft);cursor:pointer;min-height:94px;transition:transform .15s ease,border-color .15s ease,background .15s ease}
      .food-add-intent-btn:hover{transform:translateY(-1px);border-color:rgba(123,216,143,.42)}
      .food-add-intent-btn.active{border-color:rgba(123,216,143,.75);background:linear-gradient(180deg,rgba(123,216,143,.15),var(--bg2));box-shadow:0 0 0 1px rgba(123,216,143,.16),var(--shadow-soft)}
      .food-add-intent-icon{display:inline-flex;width:34px;height:34px;border-radius:13px;align-items:center;justify-content:center;background:rgba(255,255,255,.06);font-size:18px;margin-bottom:8px}
      .food-add-intent-title{display:block;font-weight:900;font-size:13px;margin-bottom:3px;color:var(--text)}
      .food-add-intent-sub{display:block;font-size:11px;line-height:1.25;color:var(--text4)}
      .food-add-mode-panel{display:none;margin:0 0 12px 0;border:1px solid var(--border2);background:rgba(255,255,255,.035);border-radius:18px;padding:12px}
      .food-add-mode-panel strong{display:block;margin-bottom:3px;color:var(--text)}
      .food-add-mode-panel p{margin:0 0 10px 0;color:var(--text3);font-size:12px;line-height:1.35}
      .food-add-mode-actions{display:flex;gap:8px;flex-wrap:wrap}
      .food-add-mode-actions button{border-radius:999px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);padding:8px 11px;font-weight:800;cursor:pointer}
      .food-add-mode-actions button.btn-primary{background:var(--green);border-color:transparent;color:#07150a}
      #food-add-modal.food-intent-estimate #food-add-estimate-panel,
      #food-add-modal.food-intent-recipes #food-add-recipes-panel,
      #food-add-modal.food-intent-search #food-add-search-panel{display:block}
      #food-add-modal .food-tools-section{display:none!important}
      /* 0.15.17 : les sources ne sont visibles que dans l'intention Rechercher.
         Sélecteurs volontairement plus spécifiques que les règles historiques du thème. */
      body > #food-add-modal.food-add-modal:not(.food-intent-search) .food-inline-filters,
      body > #food-add-modal.food-add-modal:not(.food-intent-search) .food-source-chip,
      body > #food-add-modal.food-add-modal.food-intent-estimate .food-inline-filters,
      body > #food-add-modal.food-add-modal.food-intent-estimate .food-source-chip,
      body > #food-add-modal.food-add-modal.food-intent-estimate #db-qty,
      body > #food-add-modal.food-add-modal.food-intent-estimate #db-suggestions,
      body > #food-add-modal.food-add-modal.food-intent-estimate #db-selected-card,
      #food-add-modal.food-intent-estimate .food-inline-filters,
      #food-add-modal.food-intent-estimate .food-source-chip,
      #food-add-modal.food-intent-estimate #db-qty,
      #food-add-modal.food-intent-estimate #db-suggestions,
      #food-add-modal.food-intent-estimate #db-selected-card{display:none!important}
      body > #food-add-modal.food-add-modal.food-intent-search .food-inline-filters{display:flex!important}
      #food-add-modal.food-intent-estimate .db-search-wrap{grid-template-columns:1fr!important}
      #food-add-modal.food-intent-recipes .journal-add-row,
      #food-add-modal.food-intent-recipes .food-meal-section,
      #food-add-modal.food-intent-recipes #food-current-meal-card,
      #food-add-modal.food-intent-recipes #journal-last-added,
      #food-add-modal.food-intent-recipes #groq-response,
      #food-add-modal.food-intent-recipes #ia-parse-status,
      #food-add-modal.food-intent-recipes #ia-preview,
      #food-add-modal.food-intent-recipes #ocr-panel,
      #food-add-modal.food-intent-recipes #barcode-scan-panel{display:none!important}
      #food-add-modal.food-intent-search #ocr-panel,
      #food-add-modal.food-intent-search #barcode-scan-panel{margin-top:10px}
      #food-add-modal.food-intent-search #groq-response,
      #food-add-modal.food-intent-search #ia-parse-status,
      #food-add-modal.food-intent-search #ia-preview{display:none!important}
      .food-add-ux-note{font-size:11px;color:var(--text4);margin-top:7px;line-height:1.35}
      .food-add-tool-sheet{position:fixed!important;inset:0!important;z-index:100200!important;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.44);backdrop-filter:blur(8px)}
      .food-add-tool-sheet.is-open{display:flex!important}
      .food-add-tool-card{width:min(520px,calc(100vw - 32px));border:1px solid var(--border2);background:linear-gradient(180deg,var(--bg2),var(--bg));border-radius:24px;box-shadow:0 22px 80px rgba(0,0,0,.45);padding:14px}
      .food-add-tool-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
      .food-add-tool-head strong{display:block;font-size:16px;color:var(--text);line-height:1.15}
      .food-add-tool-head p{margin:4px 0 0;color:var(--text3);font-size:12px;line-height:1.35}
      .food-add-tool-close{border:1px solid var(--border2);background:var(--bg);color:var(--text);width:34px;height:34px;min-width:34px;border-radius:14px;font-weight:900;cursor:pointer}
      .food-add-tool-options{display:grid;gap:8px}
      .food-add-tool-option{border:1px solid var(--border2);background:rgba(255,255,255,.04);color:var(--text);border-radius:18px;padding:11px 12px;text-align:left;cursor:pointer;display:grid;grid-template-columns:36px 1fr;gap:9px;align-items:center}
      .food-add-tool-option:hover{border-color:rgba(123,216,143,.55);background:rgba(123,216,143,.10)}
      .food-add-tool-option.btn-primary{background:linear-gradient(180deg,rgba(123,216,143,.95),rgba(123,216,143,.82));color:#07150a;border-color:transparent}
      .food-add-tool-option .ico{font-size:22px;line-height:1;text-align:center}
      .food-add-tool-option b{display:block;font-size:13px;margin-bottom:2px}
      .food-add-tool-option span.txt{display:block;color:inherit;opacity:.78;font-size:11px;line-height:1.25}
      body > #food-add-modal.food-add-modal.food-scan-submodal-open .food-add-dialog{overflow:hidden!important}
      body > #food-add-modal.food-add-modal .food-camera-submodal{position:fixed!important;z-index:100150!important;left:50%!important;top:50%!important;right:auto!important;bottom:auto!important;transform:translate(-50%,-50%)!important;width:min(760px,calc(100vw - 28px))!important;max-height:min(84dvh,720px)!important;overflow:auto!important;border:1px solid var(--border2)!important;border-radius:24px!important;background:linear-gradient(180deg,var(--bg2),var(--bg))!important;box-shadow:0 28px 100px rgba(0,0,0,.55)!important;padding:12px!important;margin:0!important}
      body > #food-add-modal.food-add-modal .food-camera-submodal::before{content:'';position:fixed;inset:-100vmax;z-index:-1;background:rgba(0,0,0,.44);backdrop-filter:blur(6px)}
      body > #food-add-modal.food-add-modal .food-camera-submodal .barcode-scan-actions,
      body > #food-add-modal.food-add-modal .food-camera-submodal .ocr-panel-head{position:sticky;top:0;z-index:2;background:linear-gradient(180deg,var(--bg2),rgba(0,0,0,0));padding-bottom:8px}
      body > #food-add-modal.food-add-modal .food-camera-submodal #barcode-stop-btn{display:inline-flex!important}
      body > #food-add-modal.food-add-modal .food-camera-submodal .barcode-camera-wrap,
      body > #food-add-modal.food-add-modal .food-camera-submodal .ocr-video-wrap{min-height:260px;max-height:48dvh;border-radius:18px;overflow:hidden}
      body > #food-add-modal.food-add-modal .food-camera-submodal video{width:100%;height:100%;object-fit:cover}
      @media(max-width:760px){
        body > #food-add-modal.food-add-modal.is-open{align-items:flex-end!important;justify-content:center!important;padding:8px!important}
        body > #food-add-modal.food-add-modal .food-add-dialog{width:100%!important;max-height:92dvh!important}
        .food-add-intent-chooser{grid-template-columns:1fr;gap:8px}
        .food-add-intent-btn{min-height:auto;display:grid;grid-template-columns:42px 1fr;column-gap:8px;align-items:center;padding:10px}
        .food-add-intent-icon{margin-bottom:0}.food-add-intent-title{font-size:13px}.food-add-intent-sub{font-size:11px}
      }


      /* 0.15.17 : Android / petits écrans — la popup devient un vrai panneau bas compact.
         Les 3 intentions ne prennent plus la moitié de l'écran. */
      @media(max-width:760px){
        body > #food-add-modal.food-add-modal.is-open{
          align-items:flex-end!important;
          justify-content:center!important;
          padding:0 8px max(8px, env(safe-area-inset-bottom, 0px)) 8px!important;
          box-sizing:border-box!important;
        }
        body > #food-add-modal.food-add-modal .food-add-dialog{
          width:100%!important;
          max-width:520px!important;
          height:auto!important;
          max-height:min(82dvh, calc(100dvh - 54px))!important;
          margin:0 auto!important;
          border-radius:22px 22px 18px 18px!important;
          padding:10px!important;
          overflow-y:auto!important;
          -webkit-overflow-scrolling:touch!important;
        }
        #food-add-modal .food-add-head,
        body > #food-add-modal.food-add-modal .food-add-head{
          min-height:0!important;
          margin:0!important;
          padding:0!important;
        }
        #food-add-modal .food-add-close,
        body > #food-add-modal.food-add-modal .food-add-close{
          width:34px!important;
          height:34px!important;
          min-width:34px!important;
          font-size:20px!important;
        }
        #food-add-modal .food-add-panel,
        body > #food-add-modal.food-add-modal .food-add-panel{
          padding:8px!important;
          border-radius:16px!important;
        }
        .food-add-intent-chooser{
          grid-template-columns:repeat(3,minmax(0,1fr))!important;
          gap:6px!important;
          margin:0 0 8px 0!important;
        }
        .food-add-intent-btn{
          min-height:46px!important;
          height:46px!important;
          display:flex!important;
          flex-direction:column!important;
          align-items:center!important;
          justify-content:center!important;
          gap:2px!important;
          padding:5px 4px!important;
          border-radius:14px!important;
          text-align:center!important;
          box-shadow:none!important;
        }
        .food-add-intent-icon{
          width:auto!important;
          height:auto!important;
          margin:0!important;
          background:transparent!important;
          font-size:15px!important;
          line-height:1!important;
        }
        .food-add-intent-title{
          font-size:10.5px!important;
          line-height:1.05!important;
          margin:0!important;
          white-space:nowrap!important;
          overflow:hidden!important;
          text-overflow:ellipsis!important;
          max-width:100%!important;
        }
        .food-add-intent-sub{display:none!important;}
        .food-add-mode-panel{
          padding:8px!important;
          border-radius:15px!important;
          margin:0 0 8px 0!important;
        }
        .food-add-mode-panel strong{
          font-size:12px!important;
          line-height:1.15!important;
          margin:0 0 6px 0!important;
        }
        .food-add-mode-panel p,
        .food-add-ux-note{display:none!important;}
        .food-add-mode-actions{
          display:grid!important;
          grid-template-columns:repeat(3,minmax(0,1fr))!important;
          gap:6px!important;
        }
        .food-add-mode-actions button{
          min-height:38px!important;
          padding:0 6px!important;
          border-radius:12px!important;
          font-size:10.5px!important;
          line-height:1.05!important;
          white-space:normal!important;
          text-align:center!important;
        }
        .food-add-mode-actions button:only-child{
          grid-column:1 / -1!important;
        }
        body > #food-add-modal.food-add-modal .food-add-panel .journal-add-row{
          grid-template-columns:1fr!important;
          gap:8px!important;
        }
        body > #food-add-modal.food-add-modal .food-add-panel .db-search-wrap{
          grid-template-columns:minmax(0,1fr) 76px!important;
          gap:6px!important;
          padding:6px!important;
          border-radius:14px!important;
        }
        body > #food-add-modal.food-add-modal .food-add-panel #db-search{
          min-height:40px!important;
          font-size:13px!important;
        }
        body > #food-add-modal.food-add-modal .food-add-panel .journal-add-btn,
        body > #food-add-modal.food-add-modal .food-add-actions .journal-add-btn{
          min-height:40px!important;
          height:40px!important;
          max-height:40px!important;
          border-radius:13px!important;
          font-size:12px!important;
        }
        #food-add-modal.food-intent-estimate .db-search-wrap{grid-template-columns:1fr!important;}
        body > #food-add-modal.food-add-modal.food-add-expanded .db-suggestions.visible{
          height:min(36dvh, 270px)!important;
          max-height:min(36dvh, 270px)!important;
        }
        body > #food-add-modal.food-add-modal #groq-response,
        body > #food-add-modal.food-add-modal #ia-preview,
        body > #food-add-modal.food-add-modal .ocr-panel{
          max-height:min(34dvh, 250px)!important;
          overflow:auto!important;
        }
      }
        .food-add-tool-sheet{align-items:flex-end!important;padding:8px 8px max(8px, env(safe-area-inset-bottom, 0px)) 8px!important}
        .food-add-tool-card{width:100%!important;border-radius:22px 22px 18px 18px!important;padding:12px!important}
        .food-add-tool-head strong{font-size:14px!important}
        .food-add-tool-option{border-radius:15px!important;padding:9px 10px!important;grid-template-columns:30px 1fr!important}
        .food-add-tool-option b{font-size:12px!important}
        .food-add-tool-option span.txt{font-size:10.5px!important}
        body > #food-add-modal.food-add-modal .food-camera-submodal{left:8px!important;right:8px!important;top:auto!important;bottom:max(8px, env(safe-area-inset-bottom, 0px))!important;transform:none!important;width:auto!important;max-height:min(78dvh, calc(100dvh - 72px))!important;border-radius:22px 22px 18px 18px!important;padding:10px!important}
        body > #food-add-modal.food-add-modal .food-camera-submodal .barcode-camera-wrap,
        body > #food-add-modal.food-add-modal .food-camera-submodal .ocr-video-wrap{min-height:220px!important;max-height:42dvh!important}
      @media(max-width:380px){
        .food-add-intent-title{font-size:10px!important;}
        .food-add-mode-actions button{font-size:10px!important;padding:0 4px!important;}
        body > #food-add-modal.food-add-modal .food-add-dialog{max-height:min(80dvh, calc(100dvh - 48px))!important;}
      }


      /* 0.15.17 : Android — la popup Ajouter redevient une vraie modale centrée.
         On conserve les onglets compacts, mais on n'ancre plus le panneau sur la moitié basse. */
      @media(max-width:760px){
        body > #food-add-modal.food-add-modal.is-open{
          align-items:center!important;
          justify-content:center!important;
          padding:max(8px, env(safe-area-inset-top, 0px)) 8px max(8px, env(safe-area-inset-bottom, 0px)) 8px!important;
          box-sizing:border-box!important;
        }
        body > #food-add-modal.food-add-modal .food-add-dialog{
          width:min(520px, calc(100vw - 16px))!important;
          max-width:520px!important;
          height:auto!important;
          max-height:min(90dvh, calc(100dvh - 18px))!important;
          margin:auto!important;
          border-radius:22px!important;
          transform:none!important;
          overflow-y:auto!important;
          -webkit-overflow-scrolling:touch!important;
        }
        body > #food-add-modal.food-add-modal .food-add-panel{
          max-height:none!important;
        }
        .food-add-tool-sheet{
          align-items:center!important;
          justify-content:center!important;
          padding:max(8px, env(safe-area-inset-top, 0px)) 8px max(8px, env(safe-area-inset-bottom, 0px)) 8px!important;
        }
        .food-add-tool-card{
          width:min(520px, calc(100vw - 16px))!important;
          border-radius:22px!important;
          max-height:min(88dvh, calc(100dvh - 22px))!important;
          overflow:auto!important;
        }
        body > #food-add-modal.food-add-modal .food-camera-submodal{
          left:8px!important;
          right:8px!important;
          top:50%!important;
          bottom:auto!important;
          transform:translateY(-50%)!important;
          width:auto!important;
          max-height:min(88dvh, calc(100dvh - 22px))!important;
          border-radius:22px!important;
        }
      }
      @media(max-width:760px) and (max-height:640px){
        body > #food-add-modal.food-add-modal .food-add-dialog{
          max-height:min(94dvh, calc(100dvh - 10px))!important;
        }
        .food-add-tool-card,
        body > #food-add-modal.food-add-modal .food-camera-submodal{
          max-height:min(94dvh, calc(100dvh - 10px))!important;
        }
      }

      /* 0.15.17 : fenêtre caméra unique.
         Le scanner code-barres est déplacé dans <body> par l'ancien code, alors que
         la photo plat utilise #ocr-panel dans la popup Ajouter. On cible donc les deux
         pour obtenir la même visée, le même centrage et la même hauteur sur Android. */
      body > #barcode-scan-panel.food-camera-submodal,
      body > #food-add-modal.food-add-modal #ocr-panel.food-camera-submodal,
      #ocr-panel.food-camera-submodal{
        position:fixed!important;
        z-index:100250!important;
        left:50%!important;
        top:50%!important;
        right:auto!important;
        bottom:auto!important;
        transform:translate(-50%,-50%)!important;
        width:min(760px,calc(100vw - 28px))!important;
        max-height:min(88dvh,720px)!important;
        overflow:auto!important;
        display:flex!important;
        flex-direction:column!important;
        gap:10px!important;
        border:1px solid var(--border2)!important;
        border-radius:24px!important;
        background:linear-gradient(180deg,var(--bg2),var(--bg))!important;
        box-shadow:0 28px 100px rgba(0,0,0,.58)!important;
        padding:12px!important;
        margin:0!important;
        box-sizing:border-box!important;
      }
      body > #barcode-scan-panel.food-camera-submodal::before,
      #ocr-panel.food-camera-submodal::before{
        content:'';
        position:fixed;
        inset:-100vmax;
        z-index:-1;
        background:rgba(0,0,0,.46);
        backdrop-filter:blur(7px);
      }
      body > #barcode-scan-panel.food-camera-submodal .barcode-scan-actions,
      #ocr-panel.food-camera-submodal .ocr-panel-head{
        position:sticky!important;
        top:0!important;
        z-index:4!important;
        display:flex!important;
        align-items:center!important;
        justify-content:space-between!important;
        gap:10px!important;
        min-height:38px!important;
        padding:0 0 6px 0!important;
        margin:0!important;
        background:linear-gradient(180deg,var(--bg2),rgba(0,0,0,0))!important;
      }
      body > #barcode-scan-panel.food-camera-submodal .barcode-inline-title,
      #ocr-panel.food-camera-submodal .ocr-panel-head strong{
        font-size:15px!important;
        font-weight:900!important;
        color:var(--text)!important;
      }
      body > #barcode-scan-panel.food-camera-submodal #barcode-stop-btn,
      #ocr-panel.food-camera-submodal .ocr-panel-head button{
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        min-width:36px!important;
        width:36px!important;
        height:36px!important;
        padding:0!important;
        border-radius:14px!important;
        border:1px solid var(--border2)!important;
        background:var(--bg)!important;
        color:var(--text)!important;
        font-weight:900!important;
      }
      body > #barcode-scan-panel.food-camera-submodal .barcode-camera-wrap,
      #ocr-panel.food-camera-submodal .ocr-video-wrap{
        width:100%!important;
        height:min(56dvh,430px)!important;
        min-height:260px!important;
        max-height:430px!important;
        border-radius:18px!important;
        overflow:hidden!important;
        background:#000!important;
        border:1px solid color-mix(in srgb, var(--green) 24%, var(--border2))!important;
        box-sizing:border-box!important;
      }
      body > #barcode-scan-panel.food-camera-submodal video,
      body > #barcode-scan-panel.food-camera-submodal canvas,
      body > #barcode-scan-panel.food-camera-submodal #barcode-html5-reader,
      body > #barcode-scan-panel.food-camera-submodal #barcode-html5-reader > div,
      #ocr-panel.food-camera-submodal #ocr-video{
        width:100%!important;
        height:100%!important;
        max-height:none!important;
        object-fit:cover!important;
        display:block!important;
      }
      body > #barcode-scan-panel.food-camera-submodal .barcode-frame,
      #ocr-panel.food-camera-submodal .ocr-frame{
        position:absolute!important;
        inset:16% 8%!important;
        border:2px solid color-mix(in srgb, var(--green) 72%, white)!important;
        border-radius:14px!important;
        box-shadow:0 0 0 999px rgba(0,0,0,.24)!important;
        pointer-events:none!important;
      }
      #ocr-panel.food-camera-submodal .ocr-camera-box{
        display:block!important;
        margin:0!important;
      }
      #ocr-panel.food-camera-submodal .ocr-camera-actions{
        display:flex!important;
        gap:8px!important;
        flex-wrap:wrap!important;
        justify-content:center!important;
        margin-top:8px!important;
      }
      #ocr-panel.food-camera-submodal .ocr-camera-actions button,
      body > #barcode-scan-panel.food-camera-submodal .barcode-ocr-btn{
        min-height:38px!important;
        border-radius:14px!important;
      }
      #ocr-panel.food-camera-submodal #ocr-auto-btn{
        display:none!important;
      }
      #ocr-panel.food-camera-submodal .ocr-unified-note,
      body > #barcode-scan-panel.food-camera-submodal .barcode-ocr-hint,
      body > #barcode-scan-panel.food-camera-submodal .barcode-status,
      #ocr-panel.food-camera-submodal .ocr-status{
        font-size:12px!important;
        line-height:1.35!important;
        color:var(--text3)!important;
        margin:0!important;
      }
      @media(max-width:760px){
        body > #barcode-scan-panel.food-camera-submodal,
        body > #food-add-modal.food-add-modal #ocr-panel.food-camera-submodal,
        #ocr-panel.food-camera-submodal{
          left:8px!important;
          right:8px!important;
          top:50%!important;
          bottom:auto!important;
          transform:translateY(-50%)!important;
          width:auto!important;
          max-height:min(92dvh,calc(100dvh - 16px))!important;
          border-radius:22px!important;
          padding:10px!important;
        }
        body > #barcode-scan-panel.food-camera-submodal .barcode-camera-wrap,
        #ocr-panel.food-camera-submodal .ocr-video-wrap{
          height:min(52dvh,420px)!important;
          min-height:min(46dvh,300px)!important;
          max-height:420px!important;
        }
      }
      @media(max-width:760px) and (max-height:660px){
        body > #barcode-scan-panel.food-camera-submodal .barcode-camera-wrap,
        #ocr-panel.food-camera-submodal .ocr-video-wrap{
          height:min(48dvh,330px)!important;
          min-height:220px!important;
        }
        #ocr-panel.food-camera-submodal .ocr-unified-note,
        body > #barcode-scan-panel.food-camera-submodal .barcode-ocr-hint{
          font-size:11px!important;
        }
      }


    `;
    document.head.appendChild(style);
  }

  function injectChooser() {
    const panel = document.querySelector('#food-add-modal .food-add-panel');
    if (!panel || $('food-add-intent-chooser')) return;
    const chooser = document.createElement('div');
    chooser.id = 'food-add-intent-chooser';
    chooser.className = 'food-add-intent-chooser';
    chooser.innerHTML = `
      <button type="button" class="food-add-intent-btn active" data-food-intent="search" data-food-add-action="set-intent" data-intent="search">
        <span class="food-add-intent-icon">🔎</span><span><span class="food-add-intent-title">Rechercher</span><span class="food-add-intent-sub">Aliment connu ou recette enregistrée, avec sources visibles seulement ici.</span></span>
      </button>
      <button type="button" class="food-add-intent-btn" data-food-intent="estimate" data-food-add-action="set-intent" data-intent="estimate">
        <span class="food-add-intent-icon">⚡</span><span><span class="food-add-intent-title">Estimer un plat</span><span class="food-add-intent-sub">Texte ou photo pour un plat ponctuel mangé aujourd’hui.</span></span>
      </button>
      <button type="button" class="food-add-intent-btn" data-food-intent="recipes" data-food-add-action="set-intent" data-intent="recipes">
        <span class="food-add-intent-icon">🍲</span><span><span class="food-add-intent-title">Créer une recette</span><span class="food-add-intent-sub">Recette réutilisable : création ou scan complet.</span></span>
      </button>`;
    panel.insertBefore(chooser, panel.firstChild);

    const searchPanel = document.createElement('div');
    searchPanel.id = 'food-add-search-panel';
    searchPanel.className = 'food-add-mode-panel';
    searchPanel.innerHTML = `
      <strong>Rechercher un aliment ou une recette</strong>
      <p>Mode rapide : tu tapes un nom, FoodNote affiche d’abord les recettes et tes aliments, puis les autres sources.</p>
      <div class="food-add-mode-actions">
        <button type="button" data-food-add-action="open-memory">🧠 Mémoire rapide</button>
      </div>`;
    panel.insertBefore(searchPanel, chooser.nextSibling);

    const estimatePanel = document.createElement('div');
    estimatePanel.id = 'food-add-estimate-panel';
    estimatePanel.className = 'food-add-mode-panel';
    estimatePanel.innerHTML = `
      <strong>Estimer un plat ponctuel</strong>
      <p>Mode brouillon : décris ou photographie ce que tu as mangé. FoodNote estime, puis tu valides avant ajout à la journée.</p>
      <div class="food-add-mode-actions">
        <button type="button" class="btn-primary" data-food-add-action="focus-estimate">⚡ Décrire le plat</button>
        <button type="button" data-food-add-action="open-plate-photo">📷 Photo d’un plat</button>
        <button type="button" data-food-add-action="open-product-photo">🧾 Lire une étiquette</button>
      </div>
      <div class="food-add-ux-note">Ici on n’affiche pas les sources de recherche : on estime d’abord, puis tu choisis quoi faire du résultat.</div>`;
    panel.insertBefore(estimatePanel, searchPanel.nextSibling);

    const recipesPanel = document.createElement('div');
    recipesPanel.id = 'food-add-recipes-panel';
    recipesPanel.className = 'food-add-mode-panel';
    recipesPanel.innerHTML = `
      <strong>Créer une recette réutilisable</strong>
      <p>Pour construire une vraie recette FoodNote : création manuelle ou scan d’une recette complète, puis correction avant sauvegarde.</p>
      <div class="food-add-mode-actions">
        <button type="button" class="btn-primary" data-food-add-action="new-recipe">+ Nouvelle recette</button>
        <button type="button" data-food-add-action="scan-recipe">📷 Scanner une recette</button>
        <button type="button" data-food-add-action="open-recipes-list">📚 Voir mes recettes</button>
      </div>`;
    panel.insertBefore(recipesPanel, estimatePanel.nextSibling);
  }

  function ensureToolSheet() {
    let sheet = $('food-add-tool-sheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'food-add-tool-sheet';
    sheet.className = 'food-add-tool-sheet';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = '<div class="food-add-tool-card" role="dialog" aria-modal="true" aria-label="Choix scan"><div class="food-add-tool-head"><div><strong id="food-add-tool-title"></strong><p id="food-add-tool-sub"></p></div><button type="button" class="food-add-tool-close" aria-label="Fermer">×</button></div><div id="food-add-tool-options" class="food-add-tool-options"></div></div>';
    sheet.addEventListener('click', (ev) => { if (ev.target === sheet) closeToolSheet(); });
    sheet.querySelector('.food-add-tool-close')?.addEventListener('click', closeToolSheet);
    document.body.appendChild(sheet);
    return sheet;
  }

  function closeToolSheet() {
    const sheet = $('food-add-tool-sheet');
    if (!sheet) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function showToolSheet(title, sub, options) {
    const sheet = ensureToolSheet();
    const titleEl = $('food-add-tool-title');
    const subEl = $('food-add-tool-sub');
    const list = $('food-add-tool-options');
    if (titleEl) titleEl.textContent = title || '';
    if (subEl) subEl.textContent = sub || '';
    if (list) {
      list.innerHTML = '';
      (options || []).forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'food-add-tool-option' + (opt.primary ? ' btn-primary' : '');
        btn.innerHTML = '<span class="ico">' + (opt.icon || '•') + '</span><span><b>' + (opt.title || '') + '</b><span class="txt">' + (opt.text || '') + '</span></span>';
        btn.addEventListener('click', () => {
          closeToolSheet();
          setTimeout(() => { try { opt.action && opt.action(); } catch(e) { console.warn('[FoodNote]', e); } }, 40);
        });
        list.appendChild(btn);
      });
    }
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function markCameraSubmodal(kind) {
    // Le viseur ne doit jamais repasser au-dessus du recadrage.
    try {
      if (document.body.classList.contains('foodnote-crop-shell-open') || document.body.classList.contains('foodnote-crop-camera-suspended') || (window.FoodNoteCropShell && window.FoodNoteCropShell.isActive && window.FoodNoteCropShell.isActive())) return;
    } catch(e) {}
    const modal = $('food-add-modal');
    if (modal) modal.classList.add('food-scan-submodal-open');
    document.body.classList.add('foodnote-camera-view-open');
    const barcode = $('barcode-scan-panel');
    const ocr = $('ocr-panel');
    const active = kind === 'barcode' || kind === 'nutrition' ? barcode : ocr;
    [barcode, ocr].forEach(el => {
      if (!el) return;
      el.classList.toggle('food-camera-submodal', el === active);
      if (el !== active) el.style.removeProperty('z-index');
    });
    const stopBtn = $('barcode-stop-btn');
    if (stopBtn && (kind === 'barcode' || kind === 'nutrition')) stopBtn.style.display = '';

    if (kind === 'plate') {
      const title = document.querySelector('#ocr-panel .ocr-panel-head strong');
      const note = document.querySelector('#ocr-panel .ocr-unified-note');
      const status = $('ocr-status');
      const tableBtn = $('ocr-read-table-btn');
      const recipeBtn = $('recipe-ocr-read-btn');
      const autoBtn = $('ocr-auto-btn');
      if (title) title.textContent = '📷 Photo d’un plat';
      if (note) note.textContent = 'Cadre le plat dans la même fenêtre de prise de vue que les étiquettes, puis prends la photo. FoodNote estimera ensuite et tu valideras avant ajout.';
      if (status) status.textContent = 'Caméra active : cadre ton plat puis touche “📸 Prendre la photo”.';
      if (tableBtn) tableBtn.style.display = 'none';
      if (recipeBtn) {
        recipeBtn.style.display = '';
        recipeBtn.textContent = '📸 Prendre la photo';
      }
      if (autoBtn) autoBtn.style.display = 'none';
      return;
    }

    if (kind === 'barcode' || kind === 'nutrition') {
      const title = document.querySelector('#barcode-scan-panel .barcode-inline-title');
      const hint = document.querySelector('#barcode-scan-panel .barcode-ocr-hint');
      const ocrBtn = $('barcode-ocr-btn');
      if (title) title.textContent = kind === 'nutrition' ? '🧾 Lire un tableau nutritionnel' : '▥ Scanner un code-barres';
      if (hint) hint.innerHTML = kind === 'nutrition'
        ? 'Cadre le tableau nutritionnel dans la zone, puis touche <b>Lire tableau</b>.'
        : 'Cadre le code-barres du produit. Pour une étiquette sans code-barres, reviens et choisis “Tableau nutritionnel”.';
      if (ocrBtn) {
        ocrBtn.textContent = kind === 'nutrition' ? 'Lire tableau' : '📸';
        ocrBtn.title = kind === 'nutrition' ? 'Lire le tableau nutritionnel' : 'Lire le tableau nutritionnel';
        ocrBtn.setAttribute('aria-label', ocrBtn.title);
      }
    }
  }

  function clearCameraSubmodal() {
    const modal = $('food-add-modal');
    if (modal) modal.classList.remove('food-scan-submodal-open');
    document.body.classList.remove('foodnote-camera-view-open', 'barcode-modal-open');
    ['barcode-scan-panel', 'ocr-panel'].forEach(id => $(id)?.classList.remove('food-camera-submodal', 'foodnote-camera-unified'));
  }

  function startPlateCamera() {
    setIntent('estimate');
    safeCall(originalOpenFoodRecipePhotoOption || window.openFoodRecipePhotoOption);
    applyIntent('estimate');
    syncIntentVisibility();
    [90, 260, 700, 1300].forEach(delay => setTimeout(() => { markCameraSubmodal('plate'); }, delay));
  }

  function startBarcodeScan() {
    setIntent('estimate');
    safeCall(originalOpenFoodPhotoOption || window.openFoodPhotoOption);
    applyIntent('estimate');
    syncIntentVisibility();
    setTimeout(() => { markCameraSubmodal('barcode'); }, 120);
  }

  function startNutritionTableScan() {
    setIntent('estimate');
    safeCall(originalOpenFoodPhotoOption || window.openFoodPhotoOption);
    applyIntent('estimate');
    syncIntentVisibility();
    setTimeout(() => { markCameraSubmodal('nutrition'); }, 120);
  }

  function cleanupLegacyModes() {
    // 0.15.17 : l'ancien bloc “Modes” est supprimé visuellement et du DOM.
    document.querySelectorAll('#food-add-modal .food-tools-section').forEach(el => {
      try { el.remove(); } catch(e) { el.style.display = 'none'; }
    });
    const controls = document.querySelector('#food-add-modal .food-add-controls');
    if (controls) controls.classList.add('food-add-controls-clean');
  }

  function updateLabels() {
    const dock = document.querySelector('.journal-add-dock-btn .btn-food-label');
    if (dock) dock.textContent = 'Ajouter';
    const fab = document.querySelector('#floating-add-food-btn .fab-label');
    if (fab) fab.textContent = 'Ajouter';
    const floating = $('floating-add-food-btn');
    if (floating) {
      floating.title = 'Ajouter à ma journée';
      floating.setAttribute('aria-label', 'Ajouter à ma journée');
    }
  }

  function safeCall(fn, ...args) {
    try { return typeof fn === 'function' ? fn(...args) : undefined; } catch(e) { console.warn('[FoodNote]', e); }
  }

  let currentIntent = 'search';
  let originalSetFoodAddMode = null;
  let originalOpenFoodAddModal = null;
  let suppressDbFocusUntil = 0;

  function isTouchKeyboardDevice() {
    try {
      const ua = navigator.userAgent || '';
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const small = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
      return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (coarse && small);
    } catch(e) { return false; }
  }

  function suppressMobileDbAutofocus(ms = 650) {
    if (!isTouchKeyboardDevice()) return;
    suppressDbFocusUntil = Math.max(suppressDbFocusUntil, Date.now() + ms);
    const input = $('db-search');
    if (input && document.activeElement === input) {
      try { input.blur(); } catch(e) {}
    }
  }

  function installMobileFocusGuard() {
    if (window.__FoodNote1513FocusGuardInstalled) return;
    const proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    if (!proto || typeof proto.focus !== 'function') return;
    const nativeFocus = proto.focus;
    proto.focus = function(...args) {
      try {
        if (this && this.id === 'db-search' && isTouchKeyboardDevice() && Date.now() < suppressDbFocusUntil) {
          return;
        }
      } catch(e) {}
      return nativeFocus.apply(this, args);
    };
    window.__FoodNote1513FocusGuardInstalled = true;
  }

  function focusDbSearchIfAllowed(force = false) {
    const input = $('db-search');
    if (!input) return;
    if (!force && isTouchKeyboardDevice()) return;
    try { input.focus({ preventScroll:true }); } catch(e) {}
  }
  let originalOpenFoodPhotoOption = null;
  let originalOpenFoodRecipePhotoOption = null;


  function setDisplayImportant(el, value) {
    if (!el) return;
    try { el.style.setProperty('display', value, 'important'); }
    catch(e) { el.style.display = value; }
  }

  function recipeWorkflowActive() {
    try {
      const modal = $('food-add-modal');
      return !!(
        window.FoodNoteRecipeWorkflowActive ||
        (modal && (
          modal.dataset.foodnoteWorkflow === 'recipe_ocr' ||
          modal.classList.contains('food-add-recipe-mode') ||
          modal.classList.contains('food-add-recipe-camera') ||
          modal.classList.contains('food-add-recipe-crop') ||
          modal.classList.contains('food-add-recipe-result') ||
          modal.classList.contains('food-add-recipe-processing')
        ))
      );
    } catch(e) { return false; }
  }

  function preserveRecipeWorkflow() {
    const modal = $('food-add-modal');
    if (!modal || !recipeWorkflowActive()) return false;
    currentIntent = 'estimate';
    // Le moteur 0.22.78 possède maintenant la source de vérité du scan recette.
    // Ce module legacy ne reconstruit plus l'écran à sa manière : il délègue au contrôleur
    // pour éviter qu'un refresh UX renvoie OCR/crop vers le panneau Photo/OCR.
    try {
      if (window.FoodNoteRecipeWorkflowController && typeof window.FoodNoteRecipeWorkflowController.reconcile === 'function') {
        window.FoodNoteRecipeWorkflowController.reconcile('ux1513-preserve');
      }
    } catch(e) {}
    modal.dataset.foodnoteWorkflow = 'recipe_ocr';
    modal.classList.remove('food-intent-search', 'food-intent-recipes');
    modal.classList.add('food-intent-estimate', 'food-add-recipe-mode', 'food-add-expanded');
    document.querySelectorAll('[data-food-intent]').forEach(btn => {
      const active = btn.getAttribute('data-food-intent') === 'estimate';
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    ['food-add-search-panel', 'food-add-estimate-panel', 'food-add-recipes-panel', 'food-add-intent-chooser', 'db-suggestions', 'db-selected-card', 'db-qty'].forEach(id => setDisplayImportant($(id), 'none'));
    const p = $('ocr-panel');
    if (p) setDisplayImportant(p, 'block');
    return true;
  }

  function syncIntentVisibility() {
    const modal = $('food-add-modal');
    if (!modal) return;
    if (recipeWorkflowActive()) { preserveRecipeWorkflow(); return; }
    const isSearch = currentIntent === 'search';
    const isEstimate = currentIntent === 'estimate';
    const isRecipes = currentIntent === 'recipes';

    // Les filtres de sources appartiennent uniquement au mode Recherche.
    const filters = modal.querySelector('.food-inline-filters');
    if (filters) {
      filters.hidden = !isSearch;
      filters.setAttribute('aria-hidden', isSearch ? 'false' : 'true');
      setDisplayImportant(filters, isSearch ? 'flex' : 'none');
      filters.querySelectorAll('button,input,select').forEach(ctrl => {
        ctrl.disabled = !isSearch;
        ctrl.tabIndex = isSearch ? 0 : -1;
      });
    }

    // En estimation, on garde seulement le champ texte + IA/photo/étiquette.
    const qty = $('db-qty');
    if (qty) {
      qty.hidden = isEstimate || isRecipes;
      setDisplayImportant(qty, (isEstimate || isRecipes) ? 'none' : '');
    }
    ['db-suggestions', 'db-selected-card'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const keepSearchSuggestions = id === 'db-suggestions' && typeof window.foodnoteShouldKeepDBSuggestionsVisible === 'function' && window.foodnoteShouldKeepDBSuggestionsVisible();
      if (!isSearch && !keepSearchSuggestions) {
        el.classList.remove('visible');
        setDisplayImportant(el, 'none');
      } else {
        el.style.removeProperty('display');
        if (keepSearchSuggestions) el.classList.add('visible');
      }
    });

    // Le libellé du scanner suit l'intention : pas de vocabulaire “source/base/OFF” en estimation.
    // Si un vrai sous-popup caméra est ouvert, on ne réécrit pas son titre spécifique
    // (code-barres ou tableau nutritionnel).
    const barcodePanel = modal.querySelector('#barcode-scan-panel');
    const barcodeIsSubmodal = barcodePanel && barcodePanel.classList.contains('food-camera-submodal');
    const barcodeTitle = modal.querySelector('#barcode-scan-panel .barcode-inline-title');
    if (barcodeTitle && !barcodeIsSubmodal) barcodeTitle.textContent = isEstimate ? '🧾 Lire une étiquette' : '📷 Scanner aliment';
    const barcodeHint = modal.querySelector('#barcode-scan-panel .barcode-ocr-hint');
    if (barcodeHint && !barcodeIsSubmodal) barcodeHint.innerHTML = isEstimate
      ? 'Cadre l’étiquette ou le tableau nutritionnel, puis valide le résultat avant ajout.'
      : 'Le code-barres/QR est scanné automatiquement. Pour un tableau nutritionnel, cadre-le puis touche <b>Lire tableau</b>.';
  }

  function applyIntent(intent) {
    if (recipeWorkflowActive()) { preserveRecipeWorkflow(); return; }
    currentIntent = intent === 'estimate' || intent === 'recipes' ? intent : 'search';
    const modal = $('food-add-modal');
    if (modal) {
      modal.classList.toggle('food-intent-search', currentIntent === 'search');
      modal.classList.toggle('food-intent-estimate', currentIntent === 'estimate');
      modal.classList.toggle('food-intent-recipes', currentIntent === 'recipes');
    }
    document.querySelectorAll('[data-food-intent]').forEach(btn => {
      const active = btn.getAttribute('data-food-intent') === currentIntent;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const badge = $('food-add-mode-badge');
    if (badge) {
      badge.textContent = currentIntent === 'estimate'
        ? '⚡ Estimer un plat'
        : currentIntent === 'recipes'
          ? '🍲 Créer une recette'
          : '🍽 Ajouter à ma journée';
    }
    const input = $('db-search');
    const qty = $('db-qty');
    const action = $('food-main-action-btn');
    if (input) {
      input.placeholder = currentIntent === 'estimate'
        ? 'Décris le plat : une assiette de pâtes bolo maison, 1 yaourt...'
        : 'Rechercher un aliment, une recette ou un produit...';
    }
    if (qty) qty.title = currentIntent === 'estimate' ? 'Quantité non utilisée en estimation IA' : 'Quantité (g ou unité selon aliment)';
    if (action) action.textContent = currentIntent === 'estimate' ? 'Estimer' : 'Ajouter';
    syncIntentVisibility();
    setTimeout(syncIntentVisibility, 30);
    setTimeout(syncIntentVisibility, 180);
  }

  function setIntent(intent) {
    injectStyles(); injectChooser(); cleanupLegacyModes(); updateLabels();
    if (recipeWorkflowActive()) { preserveRecipeWorkflow(); return; }
    if (intent === 'estimate') {
      suppressMobileDbAutofocus();
      if (originalSetFoodAddMode) originalSetFoodAddMode('ia');
      applyIntent('estimate');
      setTimeout(() => focusDbSearchIfAllowed(false), 30);
      return;
    }
    if (intent === 'recipes') {
      if (originalSetFoodAddMode) originalSetFoodAddMode('search');
      try { if (typeof closeBarcodeScannerPanel === 'function') closeBarcodeScannerPanel(); } catch(e) {}
      try { if (typeof closeOCRPanel === 'function') closeOCRPanel(); } catch(e) {}
      applyIntent('recipes');
      return;
    }
    suppressMobileDbAutofocus();
    if (originalSetFoodAddMode) originalSetFoodAddMode('search');
    applyIntent('search');
    setTimeout(() => focusDbSearchIfAllowed(false), 30);
  }

  function openMemory() {
    if (originalSetFoodAddMode) originalSetFoodAddMode('quick');
    applyIntent('search');
  }
  function focusEstimateText() {
    // Action volontaire de saisie : ici seulement on ouvre le clavier sur Android.
    setIntent('estimate');
    suppressDbFocusUntil = 0;
    setTimeout(() => focusDbSearchIfAllowed(true), 90);
  }
  function openProductPhoto() {
    setIntent('estimate');
    showToolSheet('Lire une étiquette', 'Choisis ce que tu veux lire. Le scan s’ouvre ensuite dans une fenêtre dédiée.', [
      { icon:'▥', title:'Scanner un code-barres', text:'Pour retrouver rapidement un produit OpenFoodFacts.', primary:true, action:startBarcodeScan },
      { icon:'🧾', title:'Lire un tableau nutritionnel', text:'Pour extraire kcal/protéines/glucides/lipides depuis l’étiquette.', action:startNutritionTableScan }
    ]);
  }
  function openPlatePhoto() {
    setIntent('estimate');
    showToolSheet('Photo d’un plat', 'La caméra s’ouvre dans une fenêtre séparée pour garder l’ajout alimentaire lisible.', [
      { icon:'📷', title:'Ouvrir la caméra', text:'Photographier le plat puis corriger l’estimation avant ajout.', primary:true, action:startPlateCamera },
      { icon:'✍️', title:'Décrire plutôt le plat', text:'Revenir au champ texte IA sans caméra.', action:focusEstimateText }
    ]);
  }
  function newRecipe() {
    safeCall(window.closeFoodAddModal);
    setTimeout(() => {
      safeCall(window.showPage, 'recettes', $('nav-recettes'));
      setTimeout(() => safeCall(window.FoodNoteRecipes && window.FoodNoteRecipes.clearEditor), 80);
    }, 80);
  }
  function openRecipesList() {
    safeCall(window.closeFoodAddModal);
    setTimeout(() => safeCall(window.showPage, 'recettes', $('nav-recettes')), 80);
  }
  function scanRecipe() {
    safeCall(window.closeFoodAddModal);
    setTimeout(() => {
      safeCall(window.showPage, 'recettes', $('nav-recettes'));
      setTimeout(() => {
        if (window.FoodNoteRecipes && typeof window.FoodNoteRecipes.openScanRecipe === 'function') {
          window.FoodNoteRecipes.openScanRecipe();
        }
      }, 120);
    }, 80);
  }

  function wrapExistingFunctions() {
    installMobileFocusGuard();

    // 0.22.97 : le popup Ajouter est désormais possédé par FoodAddModalController.
    // Ce module garde ses aides visuelles/intentions, mais il ne remplace plus
    // openFoodAddModal / closeFoodAddModal / setFoodAddMode. Cela évite les doubles
    // wrappers qui réouvraient Recherche ou Photo/OCR sans raison claire.
    if (MODAL_CONTROLLER_OWNS_POPUP) {
      if (!originalOpenFoodAddModal && typeof window.openFoodAddModal === 'function') originalOpenFoodAddModal = window.openFoodAddModal;
      if (!originalSetFoodAddMode && typeof window.setFoodAddMode === 'function') originalSetFoodAddMode = window.setFoodAddMode;
      if (!originalOpenFoodPhotoOption && typeof window.openFoodPhotoOption === 'function') originalOpenFoodPhotoOption = window.openFoodPhotoOption;
      if (!originalOpenFoodRecipePhotoOption && typeof window.openFoodRecipePhotoOption === 'function') originalOpenFoodRecipePhotoOption = window.openFoodRecipePhotoOption;
      return;
    }

    if (!originalOpenFoodAddModal && typeof window.openFoodAddModal === 'function') {
      originalOpenFoodAddModal = window.openFoodAddModal;
      window.openFoodAddModal = function() {
        suppressMobileDbAutofocus(900);
        const out = originalOpenFoodAddModal.apply(this, arguments);
        setTimeout(() => { if (isTouchKeyboardDevice()) { try { $('db-search')?.blur(); } catch(e) {} } }, 120);
        setTimeout(() => { if (isTouchKeyboardDevice()) { try { $('db-search')?.blur(); } catch(e) {} } }, 320);
        return out;
      };
    }
    if (!originalSetFoodAddMode && typeof window.setFoodAddMode === 'function') {
      originalSetFoodAddMode = window.setFoodAddMode;
      window.setFoodAddMode = function(mode) {
        if (recipeWorkflowActive()) {
          preserveRecipeWorkflow();
          return;
        }
        if (mode === 'ia' || mode === 'search') suppressMobileDbAutofocus();
        const out = originalSetFoodAddMode.apply(this, arguments);
        if (mode === 'ia') applyIntent('estimate');
        else applyIntent('search');
        return out;
      };
    }
    if (!originalOpenFoodPhotoOption && typeof window.openFoodPhotoOption === 'function') {
      originalOpenFoodPhotoOption = window.openFoodPhotoOption;
      window.openFoodPhotoOption = function() {
        applyIntent('estimate');
        const out = originalOpenFoodPhotoOption.apply(this, arguments);
        applyIntent('estimate');
        return out;
      };
    }
    if (!originalOpenFoodRecipePhotoOption && typeof window.openFoodRecipePhotoOption === 'function') {
      originalOpenFoodRecipePhotoOption = window.openFoodRecipePhotoOption;
      window.openFoodRecipePhotoOption = function() {
        applyIntent('estimate');
        const out = originalOpenFoodRecipePhotoOption.apply(this, arguments);
        applyIntent('estimate');
        return out;
      };
    }
    if (!window.__FoodNote1511CloseWrapped) {
      const oldCloseBarcode = window.closeBarcodeScannerPanel;
      if (typeof oldCloseBarcode === 'function') {
        window.closeBarcodeScannerPanel = function() {
          const out = oldCloseBarcode.apply(this, arguments);
          clearCameraSubmodal();
          return out;
        };
      }
      const oldCloseOCR = window.closeOCRPanel;
      if (typeof oldCloseOCR === 'function') {
        window.closeOCRPanel = function() {
          const out = oldCloseOCR.apply(this, arguments);
          clearCameraSubmodal();
          return out;
        };
      }
      const oldCloseFoodAdd = window.closeFoodAddModal;
      if (typeof oldCloseFoodAdd === 'function') {
        window.closeFoodAddModal = function() {
          closeToolSheet();
          clearCameraSubmodal();
          const out = oldCloseFoodAdd.apply(this, arguments);
          clearCameraSubmodal();
          return out;
        };
      }
      window.__FoodNote1511CloseWrapped = true;
    }
  }

  function init() {
    injectStyles(); injectChooser(); cleanupLegacyModes(); updateLabels(); wrapExistingFunctions();
    if (recipeWorkflowActive()) preserveRecipeWorkflow();
    else applyIntent('search');
  }

  document.addEventListener('DOMContentLoaded', init);
  setTimeout(init, 500);
  setTimeout(init, 1500);

  window.FoodNoteFoodAddUX1513 = { setIntent, openMemory, focusEstimateText, openProductPhoto, openPlatePhoto, startBarcodeScan, startNutritionTableScan, startPlateCamera, closeToolSheet, newRecipe, scanRecipe, openRecipesList, get currentIntent(){ return currentIntent; } };
  window.FoodNoteFoodAddUX1512 = window.FoodNoteFoodAddUX1513;
  window.FoodNoteFoodAddUX1511 = window.FoodNoteFoodAddUX1513;
  window.FoodNoteFoodAddUX1510 = window.FoodNoteFoodAddUX1511; // compat version précédente
  window.FoodNoteFoodAddUX159 = window.FoodNoteFoodAddUX1511; // compat anciens onclick en cache
  window.FoodNoteFoodAddUX158 = window.FoodNoteFoodAddUX1511; // compat anciens onclick en cache
  window.FoodNoteFoodAddUX157 = window.FoodNoteFoodAddUX1511; // compat anciens onclick en cache
})();
