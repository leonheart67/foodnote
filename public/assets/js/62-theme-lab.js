/* FoodNote beta 0.22.51 — Theme Lab
   Outil temporaire de réglage live des couleurs. Aucun moteur métier modifié. */
(function(){
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const STORAGE_KEY = 'foodnote_theme_lab_v1';
  const ACTIVE_KEY = 'foodnote_theme_lab_active';
  const SYNC_KEY = 'foodnote_theme_lab_sync_v1';
  const CHANNEL_NAME = 'foodnote_theme_lab_live_sync_v1';
  const CLIENT_ID = (() => {
    try { return 'fnlab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    catch(e) { return 'fnlab-' + String(Math.random()).slice(2); }
  })();
  let themeLabChannel = null;
  let applyingRemoteSync = false;
  let lastRemoteToken = '';
  let lastStoreSnapshot = '';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));


  function ensureGlobalBridgeStyles() {
    let style = document.getElementById('foodnote-theme-lab-global-bridge');
    if (!style) {
      style = document.createElement('style');
      style.id = 'foodnote-theme-lab-global-bridge';
      document.head.appendChild(style);
    }
    style.textContent = `
/* FoodNote beta 0.22.51 — pont global Theme Lab
   Ces règles sont chargées sur toutes les pages pour que les variables du labo
   pilotent les vrais écrans, pas seulement les aperçus. */
body.fn-theme-lab-active {
  --fn-theme-live: 1;
}
body.fn-theme-lab-active .journal-hero,
body.fn-theme-lab-active .profile-summary-main,
body.fn-theme-lab-active .recap-hero,
body.fn-theme-lab-active .stats-hero {
  background:
    radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--fn-lab-page-glow-3, var(--fn-energy-green, var(--green))) var(--fn-lab-page-glow-3-strength, 10%), transparent) 0, transparent var(--fn-lab-page-glow-3-size, 34vw)),
    radial-gradient(circle at 90% 0%, color-mix(in srgb, var(--fn-lab-page-glow-1, var(--fn-energy-orange, var(--orange))) var(--fn-lab-page-glow-1-strength, 18%), transparent) 0, transparent var(--fn-lab-page-glow-1-size, 31vw)),
    linear-gradient(var(--fn-lab-card-angle, 145deg), color-mix(in srgb, var(--bg2) 78%, var(--fn-lab-page-base-1, var(--fn-energy-page-1, var(--bg))) 22%), color-mix(in srgb, var(--bg2) 82%, var(--fn-lab-page-base-2, var(--fn-energy-page-2, var(--bg))) 18%)) !important;
}
body.fn-theme-lab-active .card,
body.fn-theme-lab-active .hist-card,
body.fn-theme-lab-active .stats-panel,
body.fn-theme-lab-active .data-card,
body.fn-theme-lab-active .journal-meals-card,
body.fn-theme-lab-active .journal-section-card,
body.fn-theme-lab-active .journal-tile-card,
body.fn-theme-lab-active .recap-card,
body.fn-theme-lab-active .recap-smart-card,
body.fn-theme-lab-active .stats-card,
body.fn-theme-lab-active .stats-mini-card,
body.fn-theme-lab-active .fn-ui-surface,
body.fn-theme-lab-active .fn-ui-panel,
body.fn-theme-lab-active .fn-ui-card {
  border-color: color-mix(in srgb, var(--fn-energy-border, var(--border2)) 72%, var(--calm-line, var(--border)) 28%) !important;
  background:
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--fn-lab-card-glow, var(--fn-energy-orange, var(--orange))) var(--fn-lab-card-glow-strength, 8%), transparent) 0, transparent 48%),
    linear-gradient(var(--fn-lab-card-angle, 145deg), color-mix(in srgb, var(--calm-surface, var(--bg2)) 82%, var(--fn-lab-card-tint, var(--fn-energy-card-tint, transparent)) 18%), color-mix(in srgb, var(--calm-surface, var(--bg2)) 90%, var(--fn-lab-card-accent, var(--fn-energy-green, var(--green))) 4%)) !important;
}
body.fn-theme-lab-active .macro-cell-kcal,
body.fn-theme-lab-active .journal-main-macros .macro-cell-kcal { --macro-accent: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important; }
body.fn-theme-lab-active .macro-cell-prot,
body.fn-theme-lab-active .journal-main-macros .macro-cell-prot { --macro-accent: var(--fn-macro-prot, var(--blue)) !important; }
body.fn-theme-lab-active .macro-cell-gluc,
body.fn-theme-lab-active .journal-main-macros .macro-cell-gluc { --macro-accent: var(--fn-macro-gluc, var(--orange)) !important; }
body.fn-theme-lab-active .macro-cell-lip,
body.fn-theme-lab-active .journal-main-macros .macro-cell-lip { --macro-accent: var(--fn-macro-lip, #f2cf66) !important; }
body.fn-theme-lab-active .journal-main-macros .macro-cell,
body.fn-theme-lab-active #page-journal .macro-cell.fn-macro-satellite,
body.fn-theme-lab-active #page-journal .macro-cell.fn-calorie-ring {
  border-color: color-mix(in srgb, var(--macro-accent, var(--green)) var(--fn-home-macro-border-strength, 42%), var(--fn-badge-border, var(--border2))) !important;
  background:
    radial-gradient(circle at 94% 0%, color-mix(in srgb, var(--macro-accent, var(--green)) var(--fn-home-macro-gradient-spot, 38%), transparent) 0, transparent 62%),
    linear-gradient(145deg,
      color-mix(in srgb, var(--fn-badge-surface-strong, var(--bg2)) 68%, var(--macro-accent, var(--green)) var(--fn-home-macro-gradient-strong, 15%)),
      color-mix(in srgb, var(--fn-badge-surface, var(--bg2)) 76%, var(--macro-accent, var(--green)) var(--fn-home-macro-gradient-soft, 11%))) !important;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--macro-accent, var(--green)) var(--fn-home-macro-shadow-strength, 13%), transparent) !important;
}

body.fn-theme-lab-active .journal-dashboard-badge.macro-kcal,
body.fn-theme-lab-active .recap-badge-compact.macro-kcal,
body.fn-theme-lab-active .fn-smart-chip.macro-kcal,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-kcal { --badge-accent: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important; }
body.fn-theme-lab-active .journal-dashboard-badge.macro-prot,
body.fn-theme-lab-active .recap-badge-compact.macro-prot,
body.fn-theme-lab-active .fn-smart-chip.macro-prot,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-prot { --badge-accent: var(--fn-macro-prot, var(--blue)) !important; }
body.fn-theme-lab-active .journal-dashboard-badge.macro-gluc,
body.fn-theme-lab-active .recap-badge-compact.macro-gluc,
body.fn-theme-lab-active .fn-smart-chip.macro-gluc,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-gluc { --badge-accent: var(--fn-macro-gluc, var(--orange)) !important; }
body.fn-theme-lab-active .journal-dashboard-badge.macro-lip,
body.fn-theme-lab-active .recap-badge-compact.macro-lip,
body.fn-theme-lab-active .fn-smart-chip.macro-lip,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-lip { --badge-accent: var(--fn-macro-lip, #f2cf66) !important; }
body.fn-theme-lab-active .journal-dashboard-badge,
body.fn-theme-lab-active .recap-badge-compact,
body.fn-theme-lab-active .fn-smart-chip,
body.fn-theme-lab-active .fn-ui-smart-badge {
  background:
    radial-gradient(circle at 96% 0%, color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-gradient-spot, 38%), transparent) 0, transparent 62%),
    radial-gradient(circle at 4% 0%, rgba(255,255,255,.18) 0, transparent 44%),
    linear-gradient(135deg,
      color-mix(in srgb, var(--fn-badge-surface-strong, var(--bg2)) 68%, var(--badge-accent, var(--green)) var(--fn-badge-gradient-strong, 15%)),
      color-mix(in srgb, var(--fn-badge-surface, var(--bg2)) 76%, var(--badge-accent, var(--green)) var(--fn-badge-gradient-soft, 11%))) !important;
  border-color: color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-border-strength, 42%), var(--fn-badge-border, var(--border2))) !important;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-shadow-strength, 13%), transparent), inset 0 1px 0 rgba(255,255,255,.18) !important;
}
body.fn-theme-lab-active .journal-dashboard-track span,
body.fn-theme-lab-active .recap-badge-track span,
body.fn-theme-lab-active .fn-chip-progress i,
body.fn-theme-lab-active .fn-ui-smart-progress i {
  background: linear-gradient(90deg, color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-track-strength, 72%), #fff 6%), var(--badge-accent, var(--green))) !important;
}
body.fn-theme-lab-active .fn-mobile-bottom-nav,
body.fn-theme-lab-active .mobile-bottom-nav,
body.fn-theme-lab-active #fn-mobile-bottom-nav {
  color: var(--fn-nav-text, #5f4035) !important;
  border-color: var(--fn-nav-line, #ffb26f) !important;
  background: linear-gradient(135deg, var(--fn-nav-surface, #fff1dc), var(--fn-nav-surface-2, #ffe2c2)) !important;
}
body.fn-theme-lab-active .fn-mobile-nav-plus,
body.fn-theme-lab-active .mobile-bottom-nav-plus,
body.fn-theme-lab-active [data-mobile-nav-plus] {
  color: var(--fn-nav-plus-text, #5f2448) !important;
  background: linear-gradient(135deg, var(--fn-nav-coral, #ff8a72), var(--fn-nav-magenta, #d77ab7)) !important;
}
body.fn-theme-lab-active .food-add-dialog,
body.fn-theme-lab-active #food-add-modal .food-add-dialog {
  border-color: var(--fn-add-line, var(--border2)) !important;
  background: linear-gradient(180deg, var(--fn-add-surface, var(--bg2)), var(--fn-add-card, var(--card))) !important;
}
body.fn-theme-lab-active #food-add-modal .food-add-head,
body.fn-theme-lab-active #food-add-modal .journal-add-row,
body.fn-theme-lab-active #food-add-modal .quick-foods-card {
  border-color: var(--fn-add-line, var(--border2)) !important;
  background: color-mix(in srgb, var(--fn-add-surface, var(--bg2)) 88%, var(--fn-add-soft, transparent) 12%) !important;
}
body.fn-theme-lab-active #food-add-modal .journal-add-btn,
body.fn-theme-lab-active #food-add-modal #food-main-action-btn {
  background: linear-gradient(135deg, var(--fn-add-accent, var(--green)), var(--fn-add-accent-2, var(--orange))) !important;
}
body.fn-theme-lab-active #page-objectif .profile-summary-main,
body.fn-theme-lab-active #page-objectif .objectif-method-card,
body.fn-theme-lab-active #page-objectif .stats-commercial-card,
body.fn-theme-lab-active #page-objectif .fn-ui-program-panel {
  border-color: color-mix(in srgb, var(--calm-orange, var(--fn-energy-orange, var(--orange))) 28%, var(--calm-line, var(--border2))) !important;
}
body.fn-theme-lab-active .theme-lab-ui-panel .bar i {
  background: linear-gradient(90deg, var(--calm-green, var(--green)), var(--calm-orange, var(--orange)), var(--calm-blue, var(--blue))) !important;
}
body.fn-theme-lab-active #page-objectif .fn-ui-phase-segments {
  background: color-mix(in srgb, var(--text) 6%, transparent) !important;
}

body.fn-theme-lab-active #page-objectif .fn-ui-phase-bar {
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
}
body.fn-theme-lab-active #page-objectif .fn-ui-phase-segments {
  height: 22px !important;
  overflow: hidden !important;
  background: color-mix(in srgb, var(--text) 6%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--border2) 58%, transparent) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.34) !important;
}
body.fn-theme-lab-active #page-objectif .fn-ui-phase-segments i {
  height: 100% !important;
  background: color-mix(in srgb, var(--phase-color, var(--calm-green, var(--green))) 42%, transparent) !important;
  border-right: 1px solid color-mix(in srgb, var(--phase-color, var(--calm-green, var(--green))) 48%, transparent) !important;
  color: color-mix(in srgb, var(--phase-color, var(--calm-green, var(--green))) 86%, var(--text)) !important;
  font-size: 10px !important;
}
body.fn-theme-lab-active #page-objectif #objectif-programme::before,
body.fn-theme-lab-active #page-objectif #objectif-programme-builder::before {
  content: none !important;
  display: none !important;
}
body.fn-theme-lab-active #page-journal .macro-cell-kcal,
body.fn-theme-lab-active #page-journal .fn-calorie-ring,
body.fn-theme-lab-active #page-journal .fn-calorie-ring-visual {
  --macro-color: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important;
  --macro-accent: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important;
}
body.fn-theme-lab-active #page-journal .macro-cell-prot {
  --macro-color: var(--fn-macro-prot, var(--blue)) !important;
  --macro-accent: var(--fn-macro-prot, var(--blue)) !important;
}
body.fn-theme-lab-active #page-journal .macro-cell-gluc {
  --macro-color: var(--fn-macro-gluc, var(--orange)) !important;
  --macro-accent: var(--fn-macro-gluc, var(--orange)) !important;
}
body.fn-theme-lab-active #page-journal .macro-cell-lip {
  --macro-color: var(--fn-macro-lip, #f2cf66) !important;
  --macro-accent: var(--fn-macro-lip, #f2cf66) !important;
}
body.fn-theme-lab-active #page-journal .macro-cell .macro-val,
body.fn-theme-lab-active #page-journal .fn-calorie-ring .macro-val {
  color: var(--macro-accent, var(--fn-calorie-accent, var(--green))) !important;
}
body.fn-theme-lab-active,
html.fn-theme-lab-active body {
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--fn-lab-page-glow-1, var(--fn-energy-orange, var(--orange))) var(--fn-lab-page-glow-1-strength, 18%), transparent) 0, transparent var(--fn-lab-page-glow-1-size, 31vw)),
    radial-gradient(circle at 88% 6%, color-mix(in srgb, var(--fn-lab-page-glow-2, var(--fn-energy-pink, #d77ac8)) var(--fn-lab-page-glow-2-strength, 14%), transparent) 0, transparent var(--fn-lab-page-glow-2-size, 28vw)),
    linear-gradient(var(--fn-lab-page-angle, 145deg), var(--fn-lab-page-base-1, var(--bg)), var(--fn-lab-page-base-2, var(--bg))) !important;
}

/* beta 0.22.51 — Theme Lab : pont global badges / accueil / pages déjà ouvertes */
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.macro-kcal,
/* beta 0.22.51 — Accueil : les grosses cartes calories/macros ne passent plus par les tokens Badge. */
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .macro-cell-kcal,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .macro-cell-kcal {
  --macro-color: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important;
  --macro-accent: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important;
}
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .macro-cell-prot,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .macro-cell-prot {
  --macro-color: var(--fn-macro-prot, var(--blue)) !important;
  --macro-accent: var(--fn-macro-prot, var(--blue)) !important;
}
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .macro-cell-gluc,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .macro-cell-gluc {
  --macro-color: var(--fn-macro-gluc, var(--orange)) !important;
  --macro-accent: var(--fn-macro-gluc, var(--orange)) !important;
}
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .macro-cell-lip,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .macro-cell-lip {
  --macro-color: var(--fn-macro-lip, var(--fn-energy-yellow, #f2cf66)) !important;
  --macro-accent: var(--fn-macro-lip, var(--fn-energy-yellow, #f2cf66)) !important;
}
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-orbit-macros .macro-cell.fn-calorie-ring,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-orbit-macros .macro-cell.fn-macro-satellite,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-orbit-macros .macro-cell.fn-calorie-ring,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-orbit-macros .macro-cell.fn-macro-satellite {
  background:
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--macro-color, var(--macro-accent, var(--green))) var(--fn-home-macro-gradient-spot, 30%), transparent) 0, transparent 58%),
    radial-gradient(circle at 0% 0%, color-mix(in srgb, white 9%, transparent) 0, transparent 42%),
    linear-gradient(135deg,
      color-mix(in srgb, var(--fn-badge-surface-strong, var(--bg2)) 82%, var(--macro-color, var(--macro-accent, var(--green))) var(--fn-home-macro-gradient-strong, 15%)),
      color-mix(in srgb, var(--fn-badge-surface, var(--bg2)) 88%, var(--macro-color, var(--macro-accent, var(--green))) var(--fn-home-macro-gradient-soft, 11%))) !important;
  border-color: color-mix(in srgb, var(--macro-color, var(--macro-accent, var(--green))) var(--fn-home-macro-border-strength, 42%), var(--fn-badge-border, var(--border2))) !important;
  box-shadow:
    0 16px 38px color-mix(in srgb, var(--macro-color, var(--macro-accent, var(--green))) var(--fn-home-macro-shadow-strength, 13%), transparent),
    inset 0 1px 0 rgba(255,255,255,.10) !important;
}
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .fn-calorie-ring-visual,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .fn-mini-ring,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .fn-calorie-ring-visual,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .fn-mini-ring {
  background: conic-gradient(var(--macro-color, var(--macro-accent, var(--green))) var(--macro-pct, 0%), var(--fn-ring-track, var(--bg3)) 0) !important;
  box-shadow:
    0 14px 32px color-mix(in srgb, var(--macro-color, var(--macro-accent, var(--green))) 20%, transparent),
    inset 0 1px 0 rgba(255,255,255,.18) !important;
}
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .macro-cell .macro-progress-fill,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .macro-cell .macro-progress-fill {
  background: var(--macro-color, var(--macro-accent, var(--green))) !important;
}

html.fn-theme-lab-active body .journal-dashboard-badge.macro-kcal,
html.fn-theme-lab-active body .recap-badge-compact.macro-kcal,
html.fn-theme-lab-active body .fn-smart-chip.macro-kcal,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-macro-kcal,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge.macro-kcal,
body.fn-theme-lab-active .journal-dashboard-badge.macro-kcal,
body.fn-theme-lab-active .recap-badge-compact.macro-kcal,
body.fn-theme-lab-active .fn-smart-chip.macro-kcal,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-kcal {
  --badge-accent: var(--fn-badge-kcal, var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green)))) !important;
  --chip-accent: var(--badge-accent) !important;
  --macro-accent: var(--badge-accent) !important;
  --macro-color: var(--badge-accent) !important;
}
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.macro-prot,
html.fn-theme-lab-active body .journal-dashboard-badge.macro-prot,
html.fn-theme-lab-active body .recap-badge-compact.macro-prot,
html.fn-theme-lab-active body .fn-smart-chip.macro-prot,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-macro-prot,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge.macro-prot,
body.fn-theme-lab-active .journal-dashboard-badge.macro-prot,
body.fn-theme-lab-active .recap-badge-compact.macro-prot,
body.fn-theme-lab-active .fn-smart-chip.macro-prot,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-prot {
  --badge-accent: var(--fn-badge-prot, var(--fn-macro-prot, var(--blue))) !important;
  --chip-accent: var(--badge-accent) !important;
  --macro-accent: var(--badge-accent) !important;
  --macro-color: var(--badge-accent) !important;
}
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.macro-gluc,
html.fn-theme-lab-active body .journal-dashboard-badge.macro-gluc,
html.fn-theme-lab-active body .recap-badge-compact.macro-gluc,
html.fn-theme-lab-active body .fn-smart-chip.macro-gluc,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-macro-gluc,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge.macro-gluc,
body.fn-theme-lab-active .journal-dashboard-badge.macro-gluc,
body.fn-theme-lab-active .recap-badge-compact.macro-gluc,
body.fn-theme-lab-active .fn-smart-chip.macro-gluc,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-gluc {
  --badge-accent: var(--fn-badge-gluc, var(--fn-macro-gluc, var(--orange))) !important;
  --chip-accent: var(--badge-accent) !important;
  --macro-accent: var(--badge-accent) !important;
  --macro-color: var(--badge-accent) !important;
}
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.macro-lip,
html.fn-theme-lab-active body .journal-dashboard-badge.macro-lip,
html.fn-theme-lab-active body .recap-badge-compact.macro-lip,
html.fn-theme-lab-active body .fn-smart-chip.macro-lip,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-macro-lip,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge.macro-lip,
body.fn-theme-lab-active .journal-dashboard-badge.macro-lip,
body.fn-theme-lab-active .recap-badge-compact.macro-lip,
body.fn-theme-lab-active .fn-smart-chip.macro-lip,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-lip {
  --badge-accent: var(--fn-badge-lip, var(--fn-macro-lip, var(--fn-energy-yellow, #f2cf66))) !important;
  --chip-accent: var(--badge-accent) !important;
  --macro-accent: var(--badge-accent) !important;
  --macro-color: var(--badge-accent) !important;
}
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.is-ok,
html.fn-theme-lab-active body .journal-dashboard-badge.is-ok,
html.fn-theme-lab-active body .journal-dashboard-badge.trend-down,
html.fn-theme-lab-active body .recap-badge-compact.is-ok,
html.fn-theme-lab-active body .recap-badge-compact.trend-down,
html.fn-theme-lab-active body .fn-smart-chip.is-ok,
html.fn-theme-lab-active body .fn-smart-chip.trend-down,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-is-ok,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-trend-down,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge.is-ok,
body.fn-theme-lab-active .journal-dashboard-badge.is-ok,
body.fn-theme-lab-active .journal-dashboard-badge.trend-down,
body.fn-theme-lab-active .recap-badge-compact.is-ok,
body.fn-theme-lab-active .recap-badge-compact.trend-down,
body.fn-theme-lab-active .fn-smart-chip.is-ok,
body.fn-theme-lab-active .fn-smart-chip.trend-down,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-is-ok,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-trend-down { --badge-accent: var(--fn-badge-good, var(--green)) !important; --chip-accent: var(--badge-accent) !important; }
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.is-warn,
html.fn-theme-lab-active body .journal-dashboard-badge.is-warn,
html.fn-theme-lab-active body .journal-dashboard-badge.trend-up,
html.fn-theme-lab-active body .recap-badge-compact.is-warn,
html.fn-theme-lab-active body .recap-badge-compact.trend-up,
html.fn-theme-lab-active body .fn-smart-chip.is-warn,
html.fn-theme-lab-active body .fn-smart-chip.trend-up,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-is-warn,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-trend-up,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge.is-warn,
body.fn-theme-lab-active .journal-dashboard-badge.is-warn,
body.fn-theme-lab-active .journal-dashboard-badge.trend-up,
body.fn-theme-lab-active .recap-badge-compact.is-warn,
body.fn-theme-lab-active .recap-badge-compact.trend-up,
body.fn-theme-lab-active .fn-smart-chip.is-warn,
body.fn-theme-lab-active .fn-smart-chip.trend-up,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-is-warn,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-trend-up { --badge-accent: var(--fn-badge-warn, var(--orange)) !important; --chip-accent: var(--badge-accent) !important; }
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.is-phase,
html.fn-theme-lab-active body .journal-dashboard-badge.is-phase,
html.fn-theme-lab-active body .recap-badge-compact.is-phase,
html.fn-theme-lab-active body .fn-smart-chip.is-phase,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-is-phase,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge.is-phase,
body.fn-theme-lab-active .journal-dashboard-badge.is-phase,
body.fn-theme-lab-active .recap-badge-compact.is-phase,
body.fn-theme-lab-active .fn-smart-chip.is-phase,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-is-phase { --badge-accent: var(--phase-color, var(--calm-blue, var(--blue))) !important; --chip-accent: var(--badge-accent) !important; }
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge,
html.fn-theme-lab-active body .journal-dashboard-badge,
html.fn-theme-lab-active body .recap-badge-compact,
html.fn-theme-lab-active body .fn-smart-chip,
html.fn-theme-lab-active body .fn-ui-smart-badge,
body.fn-theme-lab-active #journal-dashboard-badges .journal-dashboard-badge,
body.fn-theme-lab-active .journal-dashboard-badge,
body.fn-theme-lab-active .recap-badge-compact,
body.fn-theme-lab-active .fn-smart-chip,
body.fn-theme-lab-active .fn-ui-smart-badge {
  background:
    radial-gradient(circle at 96% 0%, color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-gradient-spot, 38%), transparent) 0, transparent 62%),
    radial-gradient(circle at 4% 0%, rgba(255,255,255,.16) 0, transparent 44%),
    linear-gradient(135deg,
      color-mix(in srgb, var(--fn-badge-surface-strong, var(--fn-chip-surface-strong, var(--bg2))) 68%, var(--badge-accent, var(--green)) var(--fn-badge-gradient-strong, 15%)),
      color-mix(in srgb, var(--fn-badge-surface, var(--fn-chip-surface, var(--bg2))) 76%, var(--badge-accent, var(--green)) var(--fn-badge-gradient-soft, 11%))) !important;
  border-color: color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-border-strength, 42%), var(--fn-badge-border, var(--fn-chip-border, var(--border2)))) !important;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-shadow-strength, 13%), transparent), inset 0 1px 0 rgba(255,255,255,.16) !important;
}
html.fn-theme-lab-active body #journal-dashboard-badges .fn-chip-dot,
html.fn-theme-lab-active body .journal-dashboard-badge .fn-chip-dot,
html.fn-theme-lab-active body .recap-badge-icon,
html.fn-theme-lab-active body .journal-dashboard-icon,
html.fn-theme-lab-active body .fn-ui-smart-dot,
body.fn-theme-lab-active #journal-dashboard-badges .fn-chip-dot,
body.fn-theme-lab-active .journal-dashboard-badge .fn-chip-dot,
body.fn-theme-lab-active .recap-badge-icon,
body.fn-theme-lab-active .journal-dashboard-icon,
body.fn-theme-lab-active .fn-ui-smart-dot {
  background: color-mix(in srgb, var(--badge-accent, var(--green)) 20%, var(--fn-badge-surface-strong, var(--bg2))) !important;
  border-color: color-mix(in srgb, var(--badge-accent, var(--green)) 34%, var(--fn-badge-border, var(--border2))) !important;
}
html.fn-theme-lab-active body #journal-dashboard-badges .fn-chip-ring,
html.fn-theme-lab-active body .journal-dashboard-badge .fn-chip-ring,
body.fn-theme-lab-active #journal-dashboard-badges .fn-chip-ring,
body.fn-theme-lab-active .journal-dashboard-badge .fn-chip-ring {
  background: conic-gradient(var(--badge-accent, var(--green)) var(--p), color-mix(in srgb, var(--text) 9%, transparent) 0) !important;
}
html.fn-theme-lab-active body #journal-dashboard-badges .fn-chip-progress i,
html.fn-theme-lab-active body .journal-dashboard-badge .fn-chip-progress i,
html.fn-theme-lab-active body .recap-badge-track span,
html.fn-theme-lab-active body .journal-dashboard-track span,
html.fn-theme-lab-active body .fn-ui-smart-progress i,
body.fn-theme-lab-active #journal-dashboard-badges .fn-chip-progress i,
body.fn-theme-lab-active .journal-dashboard-badge .fn-chip-progress i,
body.fn-theme-lab-active .recap-badge-track span,
body.fn-theme-lab-active .journal-dashboard-track span,
body.fn-theme-lab-active .fn-ui-smart-progress i {
  background: linear-gradient(90deg, color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-track-strength, 72%), #fff 6%), var(--badge-accent, var(--green))) !important;
}


/* beta 0.22.56 — Accueil macros : le Theme Lab respecte les 3 couches.
   Fond signature stable, couleur macro sur l'icône, status sur badge + barre. */
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .fn-home-macro-grid,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card .fn-home-macro-grid {
  grid-template-columns: repeat(4, minmax(142px, 1fr)) !important;
  grid-template-areas: none !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .fn-macro-home-card,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .fn-macro-home-card {
  background:
    radial-gradient(circle at 9% 0%, color-mix(in srgb, var(--fn-home-macro-signature, var(--fn-energy-green, #74c984)) var(--fn-home-macro-aura-strength, 11%), transparent) 0, transparent 58%),
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--macro-color, var(--fn-macro-kcal, #74c984)) var(--fn-home-macro-category-aura-strength, 7%), transparent) 0, transparent 52%),
    linear-gradient(145deg, color-mix(in srgb, var(--fn-home-macro-surface, var(--card, #fff)) 92%, white 5%), color-mix(in srgb, var(--fn-home-macro-surface-2, var(--bg2, #fff7ec)) 94%, var(--fn-home-macro-signature, var(--fn-energy-green, #74c984)) 6%)) !important;
  border-color: color-mix(in srgb, var(--fn-home-macro-signature, var(--fn-energy-green, #74c984)) 22%, var(--border2, rgba(0,0,0,.08))) !important;
  box-shadow: 0 14px 34px color-mix(in srgb, var(--fn-home-macro-signature, var(--fn-energy-green, #74c984)) 12%, transparent), inset 0 1px 0 rgba(255,255,255,.55) !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-cell-kcal,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-cell-kcal { --macro-color: var(--fn-macro-kcal, var(--fn-calorie-accent, #74c984)) !important; --macro-label-text: var(--fn-home-kcal-label-text, var(--fn-home-macro-label-text, var(--text2))) !important; --macro-value-text: var(--fn-home-kcal-value-text, var(--fn-home-macro-value-text, var(--text))) !important; --macro-sub-text: var(--fn-home-kcal-sub-text, var(--fn-home-macro-sub-text, var(--text3))) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-cell-prot,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-cell-prot { --macro-color: var(--fn-macro-prot, #63b77b) !important; --macro-label-text: var(--fn-home-prot-label-text, var(--fn-home-macro-label-text, var(--text2))) !important; --macro-value-text: var(--fn-home-prot-value-text, var(--fn-home-macro-value-text, var(--text))) !important; --macro-sub-text: var(--fn-home-prot-sub-text, var(--fn-home-macro-sub-text, var(--text3))) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-cell-gluc,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-cell-gluc { --macro-color: var(--fn-macro-gluc, #d89442) !important; --macro-label-text: var(--fn-home-gluc-label-text, var(--fn-home-macro-label-text, var(--text2))) !important; --macro-value-text: var(--fn-home-gluc-value-text, var(--fn-home-macro-value-text, var(--text))) !important; --macro-sub-text: var(--fn-home-gluc-sub-text, var(--fn-home-macro-sub-text, var(--text3))) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-cell-lip,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-cell-lip { --macro-color: var(--fn-macro-lip, #8b8ee8) !important; --macro-label-text: var(--fn-home-lip-label-text, var(--fn-home-macro-label-text, var(--text2))) !important; --macro-value-text: var(--fn-home-lip-value-text, var(--fn-home-macro-value-text, var(--text))) !important; --macro-sub-text: var(--fn-home-lip-sub-text, var(--fn-home-macro-sub-text, var(--text3))) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-state-neutral,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-state-neutral { --macro-status-color: var(--fn-home-status-neutral, color-mix(in srgb, var(--text3, #667066) 70%, transparent)) !important; --macro-status-text: var(--fn-home-status-neutral-text, var(--fn-home-macro-status-text, #fffdf7)) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-state-ok,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-state-ok { --macro-status-color: var(--fn-home-status-ok, var(--fn-badge-good, #74c984)) !important; --macro-status-text: var(--fn-home-status-ok-text, var(--fn-home-macro-status-text, #fffdf7)) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-state-warn,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-state-warn { --macro-status-color: var(--fn-home-status-warn, var(--fn-badge-warn, #ffb15f)) !important; --macro-status-text: var(--fn-home-status-warn-text, var(--fn-home-macro-status-text, #fffdf7)) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-state-bad,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-state-bad { --macro-status-color: var(--fn-home-status-bad, var(--red, #d96060)) !important; --macro-status-text: var(--fn-home-status-bad-text, var(--fn-home-macro-status-text, #fffdf7)) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-state-over,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-state-over { --macro-status-color: var(--fn-home-status-over, var(--fn-kcal-over, var(--red, #d96060))) !important; --macro-status-text: var(--fn-home-status-over-text, var(--fn-home-macro-status-text, #fffdf7)) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .fn-mini-ring,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .fn-mini-ring {
  color: var(--fn-home-icon-text, var(--fn-home-macro-value-text, var(--text))) !important;
  background: radial-gradient(circle at 32% 20%, rgba(255,255,255,.72), transparent 40%), color-mix(in srgb, var(--macro-color, #74c984) 22%, var(--fn-home-macro-icon-surface, rgba(255,255,255,.74))) !important;
  border-color: color-mix(in srgb, var(--macro-color, #74c984) 34%, rgba(255,255,255,.36)) !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-val,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-val { color: var(--macro-value-text, var(--fn-home-macro-value-text, var(--text))) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-lbl,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-lbl { color: var(--macro-label-text, var(--fn-home-macro-label-text, var(--text2))) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-target,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-target { color: var(--macro-sub-text, var(--fn-home-macro-sub-text, var(--text3))) !important; }
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-status-badge,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-status-badge {
  color: var(--macro-status-text, var(--fn-home-macro-status-text, #fffdf7)) !important;
  background: linear-gradient(135deg, color-mix(in srgb, var(--macro-status-color, #74c984) 86%, white 14%), var(--macro-status-color, #74c984)) !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-macro-grid .macro-progress-fill,
body.fn-theme-lab-active #page-journal .fn-home-macro-grid .macro-progress-fill {
  background: linear-gradient(90deg, color-mix(in srgb, var(--macro-status-color, #74c984) 76%, white 18%), var(--macro-status-color, #74c984)) !important;
}

/* beta 0.22.58 — Theme Lab bridge : panneau Accueil rééquilibré, sans chevauchement. */
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout {
  display: grid !important;
  grid-template-columns: minmax(320px, .95fr) minmax(360px, 1.35fr) !important;
  gap: clamp(16px, 2.2vw, 24px) !important;
  align-items: stretch !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
  --macro-color: var(--fn-macro-kcal, var(--fn-calorie-accent, #5a9f30)) !important;
  background:
    radial-gradient(circle at 2% 2%, color-mix(in srgb, var(--fn-home-macro-signature, #74c984) 7%, transparent) 0, transparent 52%),
    linear-gradient(145deg, var(--fn-home-calorie-surface, var(--fn-home-panel-surface, #fffdf7)), color-mix(in srgb, var(--fn-home-calorie-surface, #fffdf7) 94%, var(--fn-home-macro-signature, #74c984) 6%)) !important;
  border-color: var(--fn-home-calorie-border, var(--fn-home-panel-border, var(--border2))) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.58) !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-home-macro-list,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-home-macro-list {
  display: grid !important;
  grid-template-columns: 1fr !important;
  grid-template-rows: repeat(3, minmax(var(--fn-home-macro-row-min-height, 82px), 1fr)) !important;
  gap: 13px !important;
  background: transparent !important;
  padding: 0 !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-home-macro-row,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-home-macro-row {
  display: grid !important;
  grid-template-columns: 54px minmax(0, 1fr) 36px !important;
  grid-template-rows: auto auto !important;
  min-height: var(--fn-home-macro-row-min-height, 74px) !important;
  gap: 0 14px !important;
  align-items: center !important;
  padding: 14px 18px 17px 14px !important;
  border-radius: var(--fn-home-macro-row-radius, 18px) !important;
  background:
    radial-gradient(circle at 3% 0%, rgba(255,255,255,.40), transparent 52%),
    radial-gradient(circle at 98% 0%, color-mix(in srgb, var(--macro-color, var(--macro-accent, #74c984)) var(--fn-home-macro-row-aura-strength, 13%), transparent) 0, transparent 55%),
    linear-gradient(145deg, color-mix(in srgb, var(--fn-home-panel-surface, #fffdf7) var(--fn-home-macro-row-surface-mix, 92%), var(--macro-color, var(--macro-accent, #74c984)) 8%), color-mix(in srgb, var(--fn-home-panel-surface-2, #fff9ef) 90%, var(--macro-color, var(--macro-accent, #74c984)) 10%)) !important;
  border-color: color-mix(in srgb, var(--macro-color, var(--macro-accent, #74c984)) var(--fn-home-macro-row-border-strength, 34%), var(--fn-home-panel-border, var(--border2))) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.55) !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-home-macro-row > .macro-status-badge,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-home-macro-row > .macro-status-badge {
  position: static !important;
  grid-column: 3 !important;
  grid-row: 1 / span 2 !important;
  background: linear-gradient(135deg, color-mix(in srgb, var(--macro-status-color, #74c984) 88%, white 12%), var(--macro-status-color, #74c984)) !important;
  color: var(--macro-status-text, var(--fn-home-macro-status-text, #fffdf7)) !important;
  border: 1px solid color-mix(in srgb, var(--macro-status-color, #74c984) 72%, white 28%) !important;
  box-shadow: 0 7px 16px color-mix(in srgb, var(--macro-status-color, #74c984) 28%, transparent), inset 0 1px 0 rgba(255,255,255,.32) !important;
}
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress-fill,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress-fill {
  background: var(--macro-status-color, var(--fn-home-status-ok, #74c984)) !important;
}
@media (max-width: 860px) {
  html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout { grid-template-columns: 1fr !important; }
}



/* beta 0.22.59 — Theme Lab runtime bridge : anneau calories circulaire + mobile cohérent. */
#page-journal .fn-home-nutrition-panel {
  --fn-home-calorie-ring-size: clamp(126px, 13.8vw, 154px);
  --fn-home-calorie-ring-thickness: clamp(11px, 1.25vw, 15px);
}

#page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
  grid-template-columns: var(--fn-home-calorie-ring-size) minmax(0, 1fr) !important;
  gap: clamp(18px, 2.4vw, 26px) !important;
  align-items: center !important;
}

#page-journal .fn-calorie-ring-wrap {
  width: var(--fn-home-calorie-ring-size) !important;
  height: var(--fn-home-calorie-ring-size) !important;
  min-width: var(--fn-home-calorie-ring-size) !important;
  min-height: var(--fn-home-calorie-ring-size) !important;
  display: grid !important;
  place-items: center !important;
  overflow: visible !important;
}

#page-journal .fn-calorie-ring-visual,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual,
.journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual {
  width: var(--fn-home-calorie-ring-size) !important;
  height: var(--fn-home-calorie-ring-size) !important;
  min-width: var(--fn-home-calorie-ring-size) !important;
  min-height: var(--fn-home-calorie-ring-size) !important;
  max-width: var(--fn-home-calorie-ring-size) !important;
  max-height: var(--fn-home-calorie-ring-size) !important;
  aspect-ratio: 1 / 1 !important;
  border-radius: 50% !important;
  flex: 0 0 var(--fn-home-calorie-ring-size) !important;
  display: grid !important;
  place-items: center !important;
  overflow: hidden !important;
  background:
    conic-gradient(from -90deg,
      var(--fn-calorie-accent, var(--fn-macro-kcal, #5a9f30)) var(--macro-pct, 0%),
      var(--fn-ring-track, rgba(46,55,44,.12)) 0) !important;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--fn-calorie-accent, #5a9f30) 12%, transparent) !important;
  transform: none !important;
}

/* Ancien moteur : il ajoutait un ::before avec un autre disque intérieur.
   Combiné au nouveau ::after, il créait un faux rendu/point parasite. */
#page-journal .fn-calorie-ring-visual::before,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::before,
.journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::before {
  content: none !important;
  display: none !important;
}

#page-journal .fn-calorie-ring-visual::after,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::after,
.journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::after {
  content: "" !important;
  position: absolute !important;
  inset: var(--fn-home-calorie-ring-thickness) !important;
  border-radius: 50% !important;
  width: auto !important;
  height: auto !important;
  top: var(--fn-home-calorie-ring-thickness) !important;
  right: var(--fn-home-calorie-ring-thickness) !important;
  bottom: var(--fn-home-calorie-ring-thickness) !important;
  left: var(--fn-home-calorie-ring-thickness) !important;
  transform: none !important;
  display: block !important;
  background: var(--fn-home-calorie-surface, #fffdf7) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.72) !important;
}

#page-journal .fn-calorie-ring-core {
  z-index: 2 !important;
  max-width: calc(var(--fn-home-calorie-ring-size) - (var(--fn-home-calorie-ring-thickness) * 2.2)) !important;
}

#page-journal .fn-calorie-ring-core #m-kcal {
  font-size: clamp(34px, calc(var(--fn-home-calorie-ring-size) * .32), 50px) !important;
}

@media (max-width: 860px) {
  #page-journal .fn-home-nutrition-layout {
    grid-template-columns: 1fr !important;
  }
  #page-journal .fn-home-nutrition-panel {
    --fn-home-calorie-ring-size: clamp(126px, 32vw, 150px);
  }
  #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
    grid-template-columns: var(--fn-home-calorie-ring-size) minmax(0, 1fr) !important;
    text-align: left !important;
    min-height: auto !important;
  }
  #page-journal .fn-calorie-copy {
    justify-items: start !important;
    text-align: left !important;
  }
}

@media (max-width: 560px) {
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel {
    padding: 15px !important;
    border-radius: 24px !important;
  }
  #page-journal .fn-home-panel-head {
    align-items: flex-start !important;
    gap: 10px !important;
  }
  #page-journal .fn-home-panel-head .fn-orbit-status {
    font-size: 12px !important;
    padding: 6px 10px !important;
  }
  #page-journal .fn-home-nutrition-panel {
    --fn-home-calorie-ring-size: clamp(116px, 34vw, 142px);
    --fn-home-calorie-ring-thickness: 11px;
  }
  #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
    grid-template-columns: var(--fn-home-calorie-ring-size) minmax(0, 1fr) !important;
    gap: 14px !important;
    padding: 15px !important;
    text-align: left !important;
  }
  #page-journal .fn-calorie-target-line {
    font-size: clamp(14px, 4vw, 18px) !important;
  }
  #page-journal .fn-calorie-percent {
    font-size: clamp(13px, 3.7vw, 16px) !important;
    margin-top: 7px !important;
  }
  #page-journal .fn-calorie-state-line {
    font-size: 12px !important;
    margin-top: 7px !important;
  }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row {
    grid-template-columns: 46px minmax(0,1fr) 28px !important;
    padding: 12px 12px 15px !important;
  }
  #page-journal .fn-home-nutrition-layout .fn-mini-ring {
    width: 36px !important;
    height: 36px !important;
    min-width: 36px !important;
    border-radius: 12px !important;
  }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-val {
    font-size: 22px !important;
  }
  #page-journal .fn-home-nutrition-layout .macro-target {
    font-size: 10.5px !important;
  }
}

@media (max-width: 390px) {
  #page-journal .fn-home-nutrition-panel {
    --fn-home-calorie-ring-size: 106px;
    --fn-home-calorie-ring-thickness: 10px;
  }
  #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
    grid-template-columns: 106px minmax(0, 1fr) !important;
    gap: 11px !important;
    padding: 13px !important;
  }
  #page-journal .fn-calorie-copy .macro-lbl {
    font-size: 10px !important;
    letter-spacing: .13em !important;
    margin-bottom: 7px !important;
  }
  #page-journal .fn-calorie-ring-core #m-kcal {
    font-size: 34px !important;
  }
  #page-journal .fn-calorie-unit {
    font-size: 10px !important;
    margin-top: 6px !important;
  }
  #page-journal .fn-calorie-flame {
    font-size: 14px !important;
    margin-bottom: 4px !important;
  }
}

@media (max-width: 980px) {
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .fn-home-macro-grid,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card .fn-home-macro-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
@media (max-width: 520px) {
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card .fn-home-macro-grid,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card .fn-home-macro-grid { grid-template-columns: 1fr !important; }
}

/* FoodNote beta 0.22.60 — Accueil nutrition : anneau avec valeur visible + mobile non empilé.
   Le bloc est consolidé ici pour garder la même logique visuelle desktop/mobile :
   calories à gauche, macros empilées à droite, avec une version compacte sur Android. */
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel {
  --fn-home-calorie-ring-size: clamp(126px, 13.5vw, 154px);
  --fn-home-calorie-ring-thickness: clamp(11px, 1.15vw, 14px);
  --fn-home-panel-gap: clamp(14px, 2.1vw, 22px);
}
#page-journal .fn-home-nutrition-layout {
  display: grid !important;
  grid-template-columns: minmax(310px, .74fr) minmax(340px, 1.26fr) !important;
  gap: var(--fn-home-panel-gap) !important;
  align-items: stretch !important;
}
#page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
  display: grid !important;
  grid-template-columns: var(--fn-home-calorie-ring-size) minmax(112px, 1fr) !important;
  gap: clamp(16px, 2vw, 24px) !important;
  align-items: center !important;
  min-height: clamp(166px, 18vw, 206px) !important;
  padding: clamp(16px, 2vw, 22px) !important;
  text-align: left !important;
  overflow: hidden !important;
}
#page-journal .fn-home-nutrition-layout .fn-calorie-summary-card > .macro-status-badge { display: none !important; }
#page-journal .fn-calorie-ring-wrap {
  width: var(--fn-home-calorie-ring-size) !important;
  height: var(--fn-home-calorie-ring-size) !important;
  min-width: var(--fn-home-calorie-ring-size) !important;
  min-height: var(--fn-home-calorie-ring-size) !important;
  display: grid !important;
  place-items: center !important;
  overflow: visible !important;
}
#page-journal .fn-calorie-ring-visual,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual,
.journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual {
  width: var(--fn-home-calorie-ring-size) !important;
  height: var(--fn-home-calorie-ring-size) !important;
  min-width: var(--fn-home-calorie-ring-size) !important;
  min-height: var(--fn-home-calorie-ring-size) !important;
  max-width: var(--fn-home-calorie-ring-size) !important;
  max-height: var(--fn-home-calorie-ring-size) !important;
  aspect-ratio: 1 / 1 !important;
  border-radius: 50% !important;
  display: grid !important;
  place-items: center !important;
  position: relative !important;
  isolation: isolate !important;
  overflow: hidden !important;
  background: conic-gradient(from -90deg, var(--fn-calorie-accent, var(--fn-macro-kcal, #5a9f30)) var(--macro-pct, 0%), var(--fn-ring-track, rgba(46,55,44,.12)) 0) !important;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--fn-calorie-accent, #5a9f30) 12%, transparent) !important;
  transform: none !important;
}
#page-journal .fn-calorie-ring-visual::before,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::before,
.journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::before {
  content: none !important;
  display: none !important;
}
#page-journal .fn-calorie-ring-visual::after,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::after,
.journal-floating-macro-card.fn-orbit-nutrition-card .fn-calorie-ring-visual::after {
  content: "" !important;
  position: absolute !important;
  z-index: 1 !important;
  inset: var(--fn-home-calorie-ring-thickness) !important;
  border-radius: 50% !important;
  display: block !important;
  background: var(--fn-home-calorie-surface, #fffdf7) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.72) !important;
  pointer-events: none !important;
}
#page-journal .fn-calorie-ring-core {
  position: relative !important;
  z-index: 3 !important;
  display: grid !important;
  place-items: center !important;
  text-align: center !important;
  max-width: calc(var(--fn-home-calorie-ring-size) - (var(--fn-home-calorie-ring-thickness) * 2.35)) !important;
  min-width: 0 !important;
  pointer-events: none !important;
  opacity: 1 !important;
  visibility: visible !important;
}
#page-journal .fn-calorie-flame {
  display: block !important;
  color: var(--fn-macro-kcal, var(--fn-calorie-accent, #b77822)) !important;
  font-size: clamp(14px, calc(var(--fn-home-calorie-ring-size) * .12), 18px) !important;
  line-height: 1 !important;
  margin: 0 0 clamp(3px, .45vw, 6px) !important;
  opacity: 1 !important;
  visibility: visible !important;
}
#page-journal .fn-calorie-ring-core #m-kcal,
#page-journal .fn-calorie-ring-core .macro-val {
  display: block !important;
  position: relative !important;
  z-index: 4 !important;
  color: var(--fn-home-calorie-value-text, var(--fn-home-kcal-value-text, var(--text, #20231f))) !important;
  font-size: clamp(33px, calc(var(--fn-home-calorie-ring-size) * .32), 50px) !important;
  line-height: .9 !important;
  font-weight: 1000 !important;
  letter-spacing: -.055em !important;
  opacity: 1 !important;
  visibility: visible !important;
}
#page-journal .fn-calorie-unit {
  display: block !important;
  color: var(--fn-home-calorie-unit-text, var(--text3, #747a70)) !important;
  margin-top: clamp(5px, .7vw, 8px) !important;
  font-size: clamp(9px, calc(var(--fn-home-calorie-ring-size) * .075), 12px) !important;
  line-height: 1 !important;
  font-weight: 950 !important;
  letter-spacing: .18em !important;
  opacity: 1 !important;
  visibility: visible !important;
}
#page-journal .fn-calorie-copy {
  display: grid !important;
  align-content: center !important;
  justify-items: start !important;
  min-width: 0 !important;
  text-align: left !important;
}
#page-journal .fn-calorie-copy .macro-lbl {
  margin: 0 0 10px !important;
  color: var(--fn-home-calorie-label-text, var(--fn-home-kcal-label-text, var(--text2, #3f463f))) !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-list {
  display: grid !important;
  grid-template-columns: 1fr !important;
  gap: clamp(10px, 1.35vw, 14px) !important;
  align-content: stretch !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row {
  display: grid !important;
  grid-template-columns: 48px minmax(0, 1fr) 30px !important;
  grid-template-rows: auto auto !important;
  gap: 0 13px !important;
  align-items: center !important;
  min-height: clamp(62px, 7vw, 74px) !important;
  padding: 12px 16px 15px 14px !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-mini-ring,
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-macro-icon-bubble {
  width: 42px !important;
  height: 42px !important;
  min-width: 42px !important;
  border-radius: 15px !important;
  grid-column: 1 !important;
  grid-row: 1 / span 2 !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-macro-copy {
  grid-column: 2 !important;
  grid-row: 1 / span 2 !important;
  padding-right: 0 !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-lbl {
  font-size: 10.5px !important;
  line-height: 1.05 !important;
  letter-spacing: .12em !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-val {
  font-size: clamp(24px, 3.8vw, 31px) !important;
  line-height: .95 !important;
  letter-spacing: -.055em !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-val .macro-unit {
  font-size: .72em !important;
  letter-spacing: -.025em !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-val .macro-goal {
  margin-left: .18em !important;
  font-size: .68em !important;
  letter-spacing: -.03em !important;
  font-weight: 850 !important;
  color: var(--macro-sub-text, var(--fn-home-macro-sub-text, var(--text3))) !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-target {
  margin-top: 4px !important;
  font-size: 10.5px !important;
  line-height: 1.16 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row > .macro-status-badge {
  position: static !important;
  grid-column: 3 !important;
  grid-row: 1 / span 2 !important;
  width: 26px !important;
  height: 26px !important;
  border-radius: 999px !important;
  font-size: 13px !important;
  justify-self: center !important;
  align-self: center !important;
  background: linear-gradient(135deg, color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 88%, white 12%), var(--macro-status-color, var(--fn-home-status-ok, #74c984))) !important;
  color: var(--macro-status-text, var(--fn-home-macro-status-text, #fffdf7)) !important;
  border: 1px solid color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 72%, white 28%) !important;
  box-shadow: 0 7px 16px color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 28%, transparent), inset 0 1px 0 rgba(255,255,255,.32) !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress {
  display: block !important;
  position: absolute !important;
  left: 14px !important;
  right: 14px !important;
  bottom: 7px !important;
  height: 3px !important;
  border-radius: 999px !important;
  overflow: hidden !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress-fill {
  height: 100% !important;
  min-width: 0 !important;
  border-radius: inherit !important;
  background: var(--macro-status-color, var(--fn-home-status-ok, #74c984)) !important;
}
@media (max-width: 720px) {
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel {
    --fn-home-calorie-ring-size: clamp(84px, 23vw, 104px);
    --fn-home-calorie-ring-thickness: 9px;
    --fn-home-panel-gap: 8px;
    padding: 13px !important;
    border-radius: 24px !important;
  }
  #page-journal .fn-home-panel-head { margin-bottom: 12px !important; gap: 8px !important; }
  #page-journal .fn-orbit-kicker { font-size: 10px !important; letter-spacing: .22em !important; }
  #page-journal .fn-orbit-title { font-size: clamp(24px, 7vw, 32px) !important; line-height: 1.02 !important; }
  #page-journal .fn-home-panel-head .fn-orbit-status { font-size: 11.5px !important; padding: 5px 9px !important; white-space: nowrap !important; }
  #page-journal .fn-home-nutrition-layout {
    grid-template-columns: minmax(118px, .39fr) minmax(0, .61fr) !important;
    gap: var(--fn-home-panel-gap) !important;
    align-items: stretch !important;
  }
  #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
    grid-template-columns: 1fr !important;
    grid-template-rows: auto minmax(0, 1fr) !important;
    gap: 8px !important;
    min-height: 190px !important;
    padding: 10px 8px !important;
    align-content: center !important;
    justify-items: center !important;
    text-align: center !important;
    border-radius: 20px !important;
  }
  #page-journal .fn-calorie-copy { justify-items: center !important; align-content: start !important; text-align: center !important; }
  #page-journal .fn-calorie-copy .macro-lbl { font-size: 9px !important; letter-spacing: .13em !important; margin-bottom: 5px !important; }
  #page-journal .fn-calorie-target-line { font-size: 12px !important; line-height: 1.15 !important; }
  #page-journal .fn-calorie-percent { font-size: 11.5px !important; line-height: 1.15 !important; margin-top: 5px !important; }
  #page-journal .fn-calorie-state-line { font-size: 10.5px !important; line-height: 1.15 !important; margin-top: 5px !important; white-space: normal !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-list { gap: 7px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row {
    grid-template-columns: 34px minmax(0, 1fr) 22px !important;
    gap: 0 8px !important;
    min-height: 58px !important;
    padding: 8px 9px 11px 8px !important;
    border-radius: 16px !important;
  }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-mini-ring,
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-macro-icon-bubble { width: 31px !important; height: 31px !important; min-width: 31px !important; border-radius: 11px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-mini-ring span { font-size: 16px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-head { margin-bottom: 3px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-lbl { font-size: 8.5px !important; letter-spacing: .12em !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-val { font-size: clamp(18px, 5.2vw, 22px) !important; letter-spacing: -.055em !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-target { font-size: 8.5px !important; line-height: 1.08 !important; margin-top: 2px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row > .macro-status-badge { width: 21px !important; height: 21px !important; font-size: 10.5px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress { left: 8px !important; right: 8px !important; bottom: 5px !important; height: 2px !important; }
}
@media (max-width: 390px) {
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel { --fn-home-calorie-ring-size: 78px; --fn-home-calorie-ring-thickness: 8px; padding: 11px !important; }
  #page-journal .fn-home-nutrition-layout { grid-template-columns: minmax(104px, .38fr) minmax(0, .62fr) !important; gap: 7px !important; }
  #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card { min-height: 178px !important; padding: 9px 7px !important; }
  #page-journal .fn-calorie-ring-core #m-kcal,
  #page-journal .fn-calorie-ring-core .macro-val { font-size: 27px !important; }
  #page-journal .fn-calorie-flame { font-size: 12px !important; margin-bottom: 2px !important; }
  #page-journal .fn-calorie-unit { font-size: 8px !important; margin-top: 4px !important; }
  #page-journal .fn-calorie-target-line { font-size: 11px !important; }
  #page-journal .fn-calorie-percent { font-size: 10.5px !important; }
  #page-journal .fn-calorie-state-line { font-size: 9.5px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row { grid-template-columns: 29px minmax(0, 1fr) 19px !important; gap: 0 6px !important; min-height: 54px !important; padding: 7px 8px 10px 7px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-mini-ring,
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .fn-macro-icon-bubble { width: 27px !important; height: 27px !important; min-width: 27px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-lbl { font-size: 7.8px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-val { font-size: 17px !important; }
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-target { font-size: 7.8px !important; }
}
@media (max-width: 340px) {
  #page-journal .fn-home-nutrition-layout { grid-template-columns: 1fr !important; }
  #page-journal .fn-home-nutrition-layout .fn-calorie-summary-card {
    grid-template-columns: var(--fn-home-calorie-ring-size) minmax(0,1fr) !important;
    min-height: 116px !important;
    text-align: left !important;
    justify-items: stretch !important;
  }
  #page-journal .fn-calorie-copy { justify-items: start !important; text-align: left !important; }
}


/* FoodNote beta 0.22.63 — Accueil mobile compact : deux colonnes, hauteur réduite.
   Correction de fond : le layout mobile n'empile plus, et la carte Calories redevient horizontale
   pour gagner environ 35% de hauteur visuelle sans sacrifier la lisibilité. */
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel {
  container-type: inline-size;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-list,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row {
  min-width: 0 !important;
  max-width: 100% !important;
}

@media (max-width: 860px) {
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout {
    display: grid !important;
    grid-template-columns: minmax(132px, 42%) minmax(0, 58%) !important;
    grid-template-areas: "calorie macros" !important;
    gap: 8px !important;
    align-items: stretch !important;
  }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card { grid-area: calorie !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-list { grid-area: macros !important; }
}

@media (max-width: 720px) {
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel {
    --fn-home-calorie-ring-size: clamp(66px, 18vw, 82px) !important;
    --fn-home-calorie-ring-thickness: clamp(6px, 1.55vw, 8px) !important;
    --fn-home-panel-gap: 6px !important;
    padding: 8px !important;
    border-radius: 20px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-panel-head,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-panel-head {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    gap: 6px !important;
    align-items: start !important;
    margin-bottom: 6px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-kicker,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-kicker {
    font-size: 8px !important;
    letter-spacing: .18em !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-title,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-title {
    font-size: clamp(20px, 5.5vw, 26px) !important;
    line-height: 1 !important;
    letter-spacing: -.045em !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-status,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-status {
    font-size: 9.5px !important;
    padding: 4px 7px !important;
    white-space: nowrap !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout {
    grid-template-columns: minmax(142px, 45%) minmax(0, 55%) !important;
    grid-template-areas: "calorie macros" !important;
    gap: var(--fn-home-panel-gap) !important;
    align-items: stretch !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card {
    display: grid !important;
    grid-template-columns: var(--fn-home-calorie-ring-size) minmax(0, 1fr) !important;
    grid-template-rows: 1fr !important;
    justify-items: stretch !important;
    align-items: center !important;
    align-content: center !important;
    text-align: left !important;
    gap: 7px !important;
    min-height: 118px !important;
    padding: 7px 7px !important;
    border-radius: 17px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-copy,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-copy {
    justify-items: start !important;
    align-content: center !important;
    text-align: left !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-copy .macro-lbl {
    font-size: 7.5px !important;
    letter-spacing: .13em !important;
    margin-bottom: 3px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-target-line {
    font-size: 10px !important;
    line-height: 1.08 !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-percent,
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-state-line {
    font-size: 8.8px !important;
    line-height: 1.08 !important;
    margin-top: 2px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core #m-kcal,
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core .macro-val {
    font-size: clamp(21px, 6vw, 27px) !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-flame { font-size: 10px !important; margin-bottom: 1px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-unit { font-size: 7px !important; margin-top: 3px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-list {
    display: grid !important;
    grid-template-columns: 1fr !important;
    grid-auto-rows: minmax(36px, 1fr) !important;
    gap: 5px !important;
    align-content: stretch !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row {
    grid-template-columns: 31px minmax(0, 1fr) 17px !important;
    gap: 0 5px !important;
    min-height: 36px !important;
    padding: 5px 6px 7px 5px !important;
    border-radius: 14px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble {
    width: 29px !important;
    height: 25px !important;
    min-width: 29px !important;
    border-radius: 10px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring span,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring span { font-size: 13px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-head { margin-bottom: 1px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-lbl { font-size: 6.9px !important; letter-spacing: .10em !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val { font-size: clamp(13.5px, 3.7vw, 17px) !important; line-height: .92 !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target { font-size: 6.8px !important; line-height: 1.02 !important; margin-top: 0 !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row > .macro-status-badge { width: 17px !important; height: 17px !important; font-size: 8.5px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress { left: 5px !important; right: 5px !important; bottom: 3px !important; height: 2px !important; }
}

@media (max-width: 390px) {
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel {
    --fn-home-calorie-ring-size: clamp(58px, 17vw, 68px) !important;
    --fn-home-calorie-ring-thickness: 6px !important;
    padding: 7px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout {
    grid-template-columns: minmax(136px, 46%) minmax(0, 54%) !important;
    grid-template-areas: "calorie macros" !important;
    gap: 5px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card {
    min-height: 104px !important;
    padding: 6px 6px !important;
    gap: 6px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core #m-kcal,
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core .macro-val { font-size: 21px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-flame { font-size: 9px !important; margin-bottom: 1px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-unit { font-size: 6.5px !important; margin-top: 2px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-target-line { font-size: 8.8px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-percent,
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-state-line { font-size: 7.8px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list { grid-auto-rows: minmax(32px, 1fr) !important; gap: 4px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row {
    grid-template-columns: 27px minmax(0, 1fr) 15px !important;
    min-height: 32px !important;
    padding: 4px 5px 6px 4px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble {
    width: 26px !important;
    height: 22px !important;
    min-width: 26px !important;
    border-radius: 9px !important;
  }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-lbl { font-size: 6.2px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val { font-size: 13px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target { font-size: 6.1px !important; }
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row > .macro-status-badge { width: 15px !important; height: 15px !important; font-size: 7.5px !important; }
}

@media (max-width: 340px) {
  html body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout {
    grid-template-columns: minmax(126px, 46%) minmax(0, 54%) !important;
    grid-template-areas: "calorie macros" !important;
  }
}



/* FoodNote beta 0.22.69 — Accueil macros : barres utiles + badges status contrastés.
   Source de vérité : 30-nutrition-foods.js écrit --macro-progress-width et --macro-over-width
   à partir des valeurs réelles. Le CSS ne force plus une barre pleine identique. */
:root {
  --fn-home-progress-track: #dfe6d8;
  --fn-home-progress-height: 6px;
  --fn-home-progress-over-opacity: 70%;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row {
  --macro-progress-width: var(--macro-pct, 0%);
  --macro-over-width: 0%;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row > .macro-status-badge,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row > .macro-status-badge,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row > .macro-status-badge,
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-home-macro-row > .macro-status-badge,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-home-macro-row > .macro-status-badge {
  color: var(--macro-status-text, var(--fn-home-macro-status-text, #fffdf7)) !important;
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 88%, white 12%),
    color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 96%, black 4%)) !important;
  border: 1px solid color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 72%, white 28%) !important;
  box-shadow:
    0 7px 16px color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 28%, transparent),
    inset 0 1px 0 rgba(255,255,255,.32) !important;
  text-shadow: 0 1px 1px rgba(0,0,0,.22) !important;
  font-weight: 1000 !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row.macro-state-neutral > .macro-status-badge,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row.macro-state-neutral > .macro-status-badge,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row.macro-state-neutral > .macro-status-badge {
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-neutral, #7b8278)) 56%, var(--fn-home-panel-surface, #fffdf7) 44%),
    color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-neutral, #7b8278)) 70%, black 3%)) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.26) !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress,
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress {
  display: block !important;
  position: absolute !important;
  z-index: 2 !important;
  left: 14px !important;
  right: 14px !important;
  bottom: 7px !important;
  height: var(--fn-home-progress-height, 6px) !important;
  border-radius: 999px !important;
  overflow: hidden !important;
  background: color-mix(in srgb, var(--fn-home-progress-track, #dfe6d8) 74%, var(--macro-status-color, #74c984) 10%) !important;
  box-shadow: inset 0 1px 1px rgba(0,0,0,.08) !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress::after,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress::after,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress::after {
  content: "" !important;
  position: absolute !important;
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: var(--macro-over-width, 0%) !important;
  max-width: 42% !important;
  opacity: 0 !important;
  background: repeating-linear-gradient(135deg,
    color-mix(in srgb, var(--macro-status-color, #d96060) 88%, white 12%) 0 4px,
    color-mix(in srgb, var(--macro-status-color, #d96060) 58%, transparent) 4px 8px) !important;
  pointer-events: none !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row.macro-state-over .macro-progress::after,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row.macro-state-over .macro-progress::after,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row.macro-state-over .macro-progress::after {
  opacity: var(--fn-home-progress-over-opacity, 70%) !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress-fill,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress-fill,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress-fill,
html.fn-theme-lab-active body #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress-fill,
body.fn-theme-lab-active #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress-fill {
  display: block !important;
  height: 100% !important;
  width: var(--macro-progress-width, var(--macro-pct, 0%)) !important;
  max-width: 100% !important;
  min-width: 0 !important;
  border-radius: inherit !important;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--macro-status-color, var(--fn-home-status-ok, #74c984)) 72%, white 20%),
    var(--macro-status-color, var(--fn-home-status-ok, #74c984))) !important;
  box-shadow: 0 0 12px color-mix(in srgb, var(--macro-status-color, #74c984) 22%, transparent) !important;
  transition: width .22s ease, background .18s ease, box-shadow .18s ease !important;
}
#page-journal .fn-home-nutrition-layout .fn-home-macro-row.macro-state-neutral .macro-progress-fill,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row.macro-state-neutral .macro-progress-fill,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row.macro-state-neutral .macro-progress-fill {
  width: 0% !important;
  box-shadow: none !important;
}
@media (max-width: 720px) {
  #page-journal .fn-home-nutrition-layout .fn-home-macro-row .macro-progress,
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress {
    left: 8px !important;
    right: 8px !important;
    bottom: 5px !important;
  }
}
`;
  }

  const GROUPS = [
    {
      id:'base', icon:'🎛️', title:'Base du site', sub:'Fond, surfaces, textes et bordures. Ce sont les couleurs les plus structurantes.',
      items:[
        c('--bg','Fond principal','#141614'), c('--bg2','Surface principale','#1e211e'), c('--bg3','Surface hover / relief','#252825'), c('--bg4','Surface forte','#2e322e'),
        c('--card','Cartes','#1e211e'), c('--text','Texte principal','#e8eae4'), c('--text2','Texte secondaire','#b0b4aa'), c('--text3','Texte discret','#6a6e62'), c('--text4','Texte très discret','#464a42'),
        t('--border','Bordure fine','rgba(255,255,255,0.08)'), t('--border2','Bordure forte','rgba(255,255,255,0.12)'), c('--pill-bg','Fond pilule','#252825')
      ]
    },
    {
      id:'nutrition', icon:'🥗', title:'Accents nutrition', sub:'Couleurs fonctionnelles utilisées dans les aliments, alertes et boutons.',
      items:[
        c('--green','Vert principal','#3aaa80'), c('--green-dark','Vert texte / actif','#5dcaa5'), c('--green-mid','Vert intermédiaire','#2a5040'), c('--green-bg','Fond vert doux','#1a2e25'),
        c('--orange','Orange','#e0a830'), c('--orange-dark','Orange texte','#f0c060'), c('--orange-bg','Fond orange','#2a1e08'),
        c('--red','Rouge alerte','#d96060'), c('--red-dark','Rouge texte','#f09090'), c('--red-bg','Fond rouge','#2a1010'),
        c('--blue','Bleu','#5b9fd4'), c('--blue-dark','Bleu texte','#5b9fd4'), c('--blue-bg','Fond bleu','#0f2030')
      ]
    },
    {
      id:'energy', icon:'✨', title:'Palette Energy Theme', sub:'Couleurs fortes de la couche thème globale 0.22.25 / 0.22.47.',
      items:[
        c('--fn-energy-green','Energy vert','#74c984'), c('--fn-energy-mint','Energy menthe','#58d5b2'), c('--fn-energy-orange','Energy orange','#ffb15f'), c('--fn-energy-coral','Energy corail','#ff7d6e'),
        c('--fn-energy-pink','Energy rose','#d77ac8'), c('--fn-energy-blue','Energy bleu','#7bbff2'), c('--fn-energy-violet','Energy violet','#9d8cff'), c('--fn-energy-yellow','Energy jaune','#f2cf66'),
        c('--fn-energy-page-1','Fond dégradé 1','#201911'), c('--fn-energy-page-2','Fond dégradé 2','#10251b'), c('--fn-energy-page-3','Fond dégradé 3','#181d35'),
        t('--fn-energy-card-tint','Teinte cards','rgba(37,45,38,.74)'), t('--fn-energy-border','Bordure energy','rgba(255, 197, 123, .16)'), c('--fn-energy-logo-bg','Fond logo','#2f241a')
      ]
    },
    {
      id:'gradients', icon:'🌈', title:'Dégradés globaux', sub:'Réglage du fond de page et du glow des cartes. Les forces sont en pourcentage CSS.',
      items:[
        c('--fn-lab-page-base-1','Base fond 1','#201911'), c('--fn-lab-page-base-2','Base fond 2','#10251b'), c('--fn-lab-page-base-3','Base fond 3','#181d35'),
        c('--fn-lab-page-glow-1','Glow page 1','#ffb15f'), t('--fn-lab-page-glow-1-strength','Force glow 1','18%'), t('--fn-lab-page-glow-1-size','Taille glow 1','31vw'),
        c('--fn-lab-page-glow-2','Glow page 2','#d77ac8'), t('--fn-lab-page-glow-2-strength','Force glow 2','14%'), t('--fn-lab-page-glow-2-size','Taille glow 2','28vw'),
        c('--fn-lab-page-glow-3','Glow page 3','#74c984'), t('--fn-lab-page-glow-3-strength','Force glow 3','10%'), t('--fn-lab-page-glow-3-size','Taille glow 3','34vw'),
        t('--fn-lab-page-angle','Angle fond','145deg'), c('--fn-lab-card-glow','Glow cartes','#ffb15f'), t('--fn-lab-card-glow-strength','Force glow cartes','8%'), c('--fn-lab-card-tint','Teinte cartes','#263228'), c('--fn-lab-card-accent','Accent cartes','#74c984'), t('--fn-lab-card-angle','Angle cartes','145deg')
      ]
    },
    {
      id:'home', icon:'🔥', title:'Accueil / Calories / Macros', sub:'Cercle calories, macros, alertes et valeurs principales.',
      items:[
        c('--fn-calorie-accent','Accent calories','#74c984'), c('--fn-kcal-good','Calories OK','#74c984'), c('--fn-kcal-over','Calories dépassement','#ff7d6e'), c('--fn-ring-track','Anneau fond','#2c342c'),
        c('--fn-macro-kcal','Macro kcal','#74c984'), c('--fn-macro-prot','Macro protéines','#7bbff2'), c('--fn-macro-gluc','Macro glucides','#ffb15f'), c('--fn-macro-lip','Macro lipides','#f2cf66'),
        c('--fn-home-macro-signature','Aura signature accueil','#74c984'), c('--fn-home-panel-surface','Surface panneau accueil','#fffdf7'), c('--fn-home-panel-surface-2','Surface panneau 2','#fff9ef'), c('--fn-home-panel-border','Bordure panneau','#d8ddce'),
        c('--fn-home-panel-kicker-text','Texte Objectif du jour','#72786e'), c('--fn-home-panel-title-text','Texte titre accueil','#20231f'), c('--fn-home-panel-status-surface','Fond pilule kcal','#eff6e8'), c('--fn-home-panel-status-text','Texte pilule kcal','#4e812f'),
        c('--fn-home-calorie-card-surface','Fond case calories','#fff3ea'), t('--fn-home-calorie-card-opacity','Opacité case calories','70%','Alpha pur : la teinte choisie reste la source, sans mélange avec l’aura verte.'), t('--fn-home-calorie-card-blur','Flou glass case calories','10px','Effet verre dépoli de la case Calories.'), c('--fn-home-calorie-border','Bordure bloc calories','#d8ddce'), t('--fn-home-calorie-card-border-opacity','Opacité bordure calories','48%'), c('--fn-home-calorie-ring-inner-surface','Fond intérieur cercle','#fffdf7'), t('--fn-home-calorie-ring-inner-opacity','Opacité intérieur cercle','92%','Opacité du voile intérieur. Le masque neutre coupe l’anneau : baisser cette valeur ne vire plus au vert.'), c('--fn-home-calorie-label-text','Texte label calories','#626860'), c('--fn-home-calorie-value-text','Texte valeur calories','#20231f'), c('--fn-home-calorie-unit-text','Texte unité KCAL','#747a70'), c('--fn-home-calorie-detail-text','Texte cible calories','#5e645c'), c('--fn-home-calorie-percent-text','Texte pourcentage calories','#747a70'), c('--fn-home-calorie-state-text','Texte état calories','#4e8d28'),
        c('--fn-home-macro-surface','Surface cartes macros','#fffdf7'), c('--fn-home-macro-surface-2','Surface cartes macros 2','#fff7ec'), c('--fn-home-macro-icon-surface','Fond icône macro','#ffffff'),
        c('--fn-home-macro-label-text','Texte libellés macros','#3f463f'), c('--fn-home-macro-value-text','Texte valeurs macros','#111827'), c('--fn-home-macro-goal-text','Texte /cible macros','#667066'), c('--fn-home-macro-sub-text','Texte reste/cible','#667066'), c('--fn-home-macro-status-text','Texte badge status','#fffdf7'), c('--fn-home-icon-text','Texte icône macro','#fffdf7'),
        c('--fn-home-kcal-icon-text','Icône calories','#fffdf7'), c('--fn-home-prot-icon-text','Icône protéines','#fffdf7'), c('--fn-home-gluc-icon-text','Icône glucides','#fffdf7'), c('--fn-home-lip-icon-text','Icône lipides','#fffdf7'),
        c('--fn-home-kcal-label-text','Libellé calories','#3f463f'), c('--fn-home-prot-label-text','Libellé protéines','#3f463f'), c('--fn-home-gluc-label-text','Libellé glucides','#3f463f'), c('--fn-home-lip-label-text','Libellé lipides','#3f463f'),
        c('--fn-home-kcal-value-text','Valeur calories','#111827'), c('--fn-home-prot-value-text','Valeur protéines','#111827'), c('--fn-home-gluc-value-text','Valeur glucides','#111827'), c('--fn-home-lip-value-text','Valeur lipides','#111827'),
        c('--fn-home-kcal-sub-text','Reste/cible calories','#667066'), c('--fn-home-prot-sub-text','Reste/cible protéines','#667066'), c('--fn-home-gluc-sub-text','Reste/cible glucides','#667066'), c('--fn-home-lip-sub-text','Reste/cible lipides','#667066'),
        c('--fn-home-status-neutral','Status neutre','#7b8278'), c('--fn-home-status-ok','Status OK','#74c984'), c('--fn-home-status-warn','Status attention','#ffb15f'), c('--fn-home-status-bad','Status écart fort','#d96060'), c('--fn-home-status-over','Status dépassement','#d96060'),
        c('--fn-home-status-neutral-text','Texte status neutre','#fffdf7'), c('--fn-home-status-ok-text','Texte status OK','#fffdf7'), c('--fn-home-status-warn-text','Texte status attention','#fffdf7'), c('--fn-home-status-bad-text','Texte status écart','#fffdf7'), c('--fn-home-status-over-text','Texte status dépassement','#fffdf7'),
        c('--fn-home-progress-track','Fond barre status','#dfe6d8'), t('--fn-home-progress-height','Hauteur barre status','6px'), t('--fn-home-progress-over-opacity','Intensité dépassement barre','70%'),
        c('--fn-glow-green','Glow vert','#74c984'), c('--fn-glow-orange','Glow orange','#ffb15f'),
        t('--fn-home-macro-aura-strength','Force aura signature','11%','Aura de fond commune vert sauge/crème. Elle ne dépend pas du status.'),
        t('--fn-home-macro-category-aura-strength','Force aura macro','7%','Petite nuance de catégorie, à garder basse pour éviter les aplats rouges/bleus.'),
        t('--fn-home-macro-gradient-spot','Ancien halo macros','0%','Ancien réglage conservé pour compatibilité.'),
        t('--fn-home-macro-gradient-strong','Ancien dégradé haut','0%','Ancien réglage conservé pour compatibilité.'),
        t('--fn-home-macro-gradient-soft','Ancien dégradé bas','0%','Ancien réglage conservé pour compatibilité.'),
        t('--fn-home-macro-border-strength','Ancienne bordure macros','0%'),
        t('--fn-home-macro-shadow-strength','Ancienne ombre macros','0%')
      ]
    },
    {
      id:'badges', icon:'🏷️', title:'Badges et effets', sub:'Les badges colorés, chips, états et petits effets visuels.',
      items:[
        c('--fn-badge-kcal','Badge kcal','#74c984'), c('--fn-badge-prot','Badge protéines','#7bbff2'), c('--fn-badge-gluc','Badge glucides','#ffb15f'), c('--fn-badge-lip','Badge lipides','#f2cf66'),
        c('--fn-badge-good','Badge succès','#74c984'), c('--fn-badge-warn','Badge alerte','#ffb15f'), c('--fn-badge-info','Badge info','#7bbff2'),
        c('--fn-badge-surface','Surface badge','#263228'), c('--fn-badge-surface-strong','Surface badge forte','#303a31'), c('--fn-badge-border','Bordure badge','#45624c'),
        t('--fn-badge-gradient-spot','Force halo badge','38%','Pourcentage du halo radial coloré.'), t('--fn-badge-gradient-strong','Force dégradé haut','15%','Mélange de la couleur du badge dans la surface forte.'), t('--fn-badge-gradient-soft','Force dégradé bas','11%','Mélange de la couleur du badge dans la surface basse.'),
        t('--fn-badge-border-strength','Force bordure badge','42%'), t('--fn-badge-shadow-strength','Force ombre badge','13%'), t('--fn-badge-track-strength','Force barre badge','72%'),
        c('--fn-chip-surface','Surface chip','#263228'), c('--fn-chip-surface-strong','Surface chip forte','#303a31'), c('--fn-chip-border','Bordure chip','#45624c')
      ]
    },
    {
      id:'mobile', icon:'📱', title:'Barre mobile', sub:'Couleurs de la navigation basse et des bulles d’action.',
      items:[
        c('--fn-nav-warm','Mobile orange pastel','#ffb26f'), c('--fn-nav-coral','Mobile corail','#ff8a72'), c('--fn-nav-coral-2','Mobile corail 2','#ff9f7a'), c('--fn-nav-magenta','Mobile magenta','#d77ab7'),
        c('--fn-nav-text','Texte barre','#5f4035'), c('--fn-nav-muted','Texte discret barre','#7b604b'), c('--fn-nav-active-text','Texte actif barre','#3f2b24'), c('--fn-nav-plus-text','Texte +','#5f2448'),
        t('--fn-nav-plus-pill','Pastille +','rgba(255,255,255,.88)'), c('--fn-nav-surface','Surface nav','#fff1dc'), c('--fn-nav-surface-2','Surface nav 2','#ffe2c2'), c('--fn-nav-line','Bordure nav','#ffb26f')
      ]
    },
    {
      id:'popup', icon:'➕', title:'Popup Ajouter', sub:'Composant ajouter aliment : surfaces, accents et texte.',
      items:[
        c('--fn-add-accent','Accent popup','#3aaa80'), c('--fn-add-accent-2','Accent secondaire popup','#e5b75c'), c('--fn-add-soft','Fond doux popup','#203024'), c('--fn-add-soft-2','Fond miel popup','#2b2416'),
        c('--fn-add-line','Bordure popup','#3a4038'), c('--fn-add-line-strong','Bordure active popup','#4d735f'), c('--fn-add-surface','Surface popup','#1e211e'), c('--fn-add-card','Carte popup','#232823'), c('--fn-add-muted','Texte discret popup','#9da49a')
      ]
    },
    {
      id:'ui', icon:'🧩', title:'UI globale / Objectifs / Récap', sub:'Tokens partagés par panels, listes, objectifs, récap et statistiques.',
      items:[
        c('--calm-surface','Surface calme','#1e211e'), c('--calm-surface-strong','Surface forte calme','#252b25'), c('--calm-soft','Fond doux calme','#172018'), c('--calm-line','Ligne calme','#394039'),
        c('--calm-green','Calm vert','#74c984'), c('--calm-orange','Calm orange','#ffb15f'), c('--calm-red','Calm rouge','#ff7d6e'), c('--calm-blue','Calm bleu','#7bbff2'), c('--calm-yellow','Calm jaune','#f2cf66'),
        c('--fn-ui-surface','UI surface','#1e211e'), c('--fn-ui-surface-2','UI surface 2','#252825'), c('--fn-ui-line','UI ligne','#394039'), c('--fn-ui-green','UI vert','#74c984'), c('--fn-ui-orange','UI orange','#ffb15f'), c('--fn-ui-blue','UI bleu','#7bbff2')
      ]
    }
  ];

  function c(key, label, fallback, hint='') { return { key, label, fallback, kind:'color', hint }; }
  function t(key, label, fallback, hint='') { return { key, label, fallback, kind:'text', hint }; }
  const ALL_ITEMS = GROUPS.flatMap(g => g.items.map(item => ({...item, group:g.id})));
  const KNOWN_KEYS = new Set(ALL_ITEMS.map(i => i.key));
  const ORIGIN_VALUES = {};

  function captureOrigins(keys) {
    const wanted = keys && keys.length ? keys : ALL_ITEMS.map(i => i.key);
    wanted.forEach(key => {
      if (!key || ORIGIN_VALUES[key] !== undefined) return;
      const direct = cssValue(key);
      ORIGIN_VALUES[key] = direct || fallbackFor(key) || '';
    });
  }
  function originValue(key) {
    if (ORIGIN_VALUES[key] === undefined) captureOrigins([key]);
    return ORIGIN_VALUES[key] || fallbackFor(key) || '';
  }
  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
  }

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch(e) { return {}; }
  }
  function writeStore(values) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values || {}, null, 2)); } catch(e) {}
  }
  function isActiveStored() {
    try { return localStorage.getItem(ACTIVE_KEY) === '1'; } catch(e) { return false; }
  }
  function setActiveStored(v) {
    try { v ? localStorage.setItem(ACTIVE_KEY, '1') : localStorage.removeItem(ACTIVE_KEY); } catch(e) {}
  }
  function cssValue(key) {
    const body = getComputedStyle(document.body).getPropertyValue(key).trim();
    if (body) return body;
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  }
  function fallbackFor(key) {
    const item = ALL_ITEMS.find(i => i.key === key);
    return item ? item.fallback : '';
  }
  function rgbToHex(value) {
    const s = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(x => x + x).join('');
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return '';
    return '#' + [m[1],m[2],m[3]].map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2,'0')).join('');
  }
  function colorInputValue(key, value) {
    return rgbToHex(value) || rgbToHex(fallbackFor(key)) || '#3aaa80';
  }
  function currentValue(key) {
    const store = readStore();
    return store[key] || cssValue(key) || fallbackFor(key) || '';
  }

  function cssEscapeIdent(key) {
    return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '');
  }
  function cssSafeValue(value) {
    return String(value ?? '').trim().replace(/<\/style/gi, '<\/ style').replace(/[\u0000-\u001f]/g, ' ');
  }

  function normalizeThemeAlpha(value, fallback='.92') {
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return fallback;
    const percent = raw.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    let n = percent ? Number(percent[1]) / 100 : Number(raw);
    if (!Number.isFinite(n)) return fallback;
    if (!percent && n > 1) n = n / 100;
    n = Math.max(0, Math.min(1, n));
    return String(Math.round(n * 1000) / 1000);
  }
  function withDerivedThemeValues(values) {
    const out = Object.assign({}, values && typeof values === 'object' ? values : {});
    if (out['--fn-home-calorie-ring-inner-opacity'] !== undefined) {
      out['--fn-home-calorie-ring-inner-alpha'] = normalizeThemeAlpha(out['--fn-home-calorie-ring-inner-opacity'], '.92');
    }
    return out;
  }
  function ensureRuntimeVarsStyle() {
    let style = document.getElementById('foodnote-theme-lab-runtime-vars');
    if (!style) {
      style = document.createElement('style');
      style.id = 'foodnote-theme-lab-runtime-vars';
      document.head.appendChild(style);
    }
    return style;
  }
  function writeRuntimeVarsStyle(values, active=true) {
    const style = ensureRuntimeVarsStyle();
    const data = withDerivedThemeValues(values && typeof values === 'object' ? values : {});
    if (!active || !Object.keys(data).length) { style.textContent = ''; return; }
    const rows = Object.entries(data)
      .filter(([key, value]) => String(key || '').startsWith('--') && String(value ?? '').trim())
      .map(([key, value]) => `  ${cssEscapeIdent(key)}: ${cssSafeValue(value)} !important;`)
      .join('\n');
    style.textContent = `/* FoodNote Theme Lab runtime vars — appliqué sur toutes les pages */\n:root, html.fn-theme-lab-active, body.fn-theme-lab-active {\n${rows}\n}\n`;
  }
  function setVar(key, value) {
    const v = String(value ?? '').trim();
    if (!key || !key.startsWith('--')) return;
    if (v) {
      document.documentElement.style.setProperty(key, v);
      if (document.body) document.body.style.setProperty(key, v);
    } else {
      document.documentElement.style.removeProperty(key);
      if (document.body) document.body.style.removeProperty(key);
    }
  }
  function applyValues(values, active=true, options={}) {
    ensureGlobalBridgeStyles();
    ensureHomeNutritionReferenceStyle();
    const data = withDerivedThemeValues(values || readStore());
    Object.entries(data).forEach(([key, value]) => setVar(key, value));
    writeRuntimeVarsStyle(data, !!active);
    document.documentElement.classList.toggle('fn-theme-lab-active', !!active);
    if (document.body) document.body.classList.toggle('fn-theme-lab-active', !!active);
    try {
      if (window.FoodNoteThemeLabRuntime && typeof window.FoodNoteThemeLabRuntime.apply === 'function') {
        window.FoodNoteThemeLabRuntime.apply(data, !!active, { reason:'theme-lab-ui' });
      }
    } catch(e) {}
    if (options.persistActive !== false) setActiveStored(!!active);
    try { window.dispatchEvent(new CustomEvent('foodnote-theme-lab-applied', { detail:{ active:!!active, keys:Object.keys(data) } })); } catch(e) {}
    if (!options.silent) updateStatus();
    updateExportBox();
  }

  function removeInlineVars(keys) {
    (keys || Object.keys(readStore())).forEach(key => {
      document.documentElement.style.removeProperty(key);
      if (document.body) document.body.style.removeProperty(key);
    });
    writeRuntimeVarsStyle(readStore(), isActiveStored());
  }

  function allKnownThemeKeys(extra=[]) {
    return Array.from(new Set([
      ...ALL_ITEMS.map(i => i.key),
      ...Object.keys(readStore()),
      ...(Array.isArray(extra) ? extra : [])
    ].filter(Boolean)));
  }

  function emitLiveSync(reason, extra={}) {
    if (applyingRemoteSync) return;
    const payload = {
      type: 'foodnote-theme-lab-sync',
      source: CLIENT_ID,
      build: BUILD,
      reason: reason || 'change',
      active: isActiveStored(),
      values: readStore(),
      removedKeys: Array.isArray(extra.removedKeys) ? extra.removedKeys : [],
      changedKeys: Array.isArray(extra.changedKeys) ? extra.changedKeys : [],
      ts: Date.now()
    };
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(payload)); } catch(e) {}
    try { if (themeLabChannel) themeLabChannel.postMessage(payload); } catch(e) {}
    try { if (window.FoodNoteThemeLabRuntime && typeof window.FoodNoteThemeLabRuntime.publish === 'function') window.FoodNoteThemeLabRuntime.publish(reason || 'theme-lab'); } catch(e) {}
    try { window.dispatchEvent(new CustomEvent('foodnote-theme-lab-change', { detail: payload })); } catch(e) {}
    lastStoreSnapshot = snapshotStoreState();
  }

  function applyRemoteSync(payload, source='sync') {
    if (!payload || payload.type !== 'foodnote-theme-lab-sync') return;
    if (payload.source && payload.source === CLIENT_ID) return;
    const token = String(payload.source || 'unknown') + ':' + String(payload.ts || '0') + ':' + String(payload.reason || '');
    if (token && token === lastRemoteToken) return;
    lastRemoteToken = token;
    applyingRemoteSync = true;
    try {
      const values = payload.values && typeof payload.values === 'object' ? payload.values : readStore();
      const active = !!payload.active;
      const removed = Array.isArray(payload.removedKeys) ? payload.removedKeys : [];
      if (removed.length) removeInlineVars(removed);
      if (active) {
        applyValues(values, true, { persistActive:false, silent:true });
        updateStatus(source === 'broadcast' ? 'Synchro live reçue' : 'Synchro multi-fenêtre reçue');
      } else {
        removeInlineVars(allKnownThemeKeys(removed));
        document.body.classList.remove('fn-theme-lab-active');
        document.documentElement.classList.remove('fn-theme-lab-active');
        updateStatus('Thème temporaire désactivé sur une autre fenêtre');
        updateExportBox();
      }
      refreshAllControlStates();
    } finally {
      applyingRemoteSync = false;
    }
  }

  function parseJsonSafe(raw, fallback=null) {
    try { return JSON.parse(raw || ''); } catch(e) { return fallback; }
  }

  function setupLiveSync() {
    try {
      if ('BroadcastChannel' in window) {
        themeLabChannel = new BroadcastChannel(CHANNEL_NAME);
        themeLabChannel.onmessage = (event) => applyRemoteSync(event.data, 'broadcast');
      }
    } catch(e) { themeLabChannel = null; }
    window.addEventListener('storage', (event) => {
      if (!event || ![STORAGE_KEY, ACTIVE_KEY, SYNC_KEY].includes(event.key)) return;
      if (event.key === SYNC_KEY) {
        applyRemoteSync(parseJsonSafe(event.newValue), 'storage');
        return;
      }
      const oldValues = event.key === STORAGE_KEY ? (parseJsonSafe(event.oldValue, {}) || {}) : {};
      const newValues = readStore();
      const removed = Object.keys(oldValues).filter(key => !Object.prototype.hasOwnProperty.call(newValues, key));
      const active = isActiveStored();
      applyingRemoteSync = true;
      try {
        if (removed.length) removeInlineVars(removed);
        if (active) {
          applyValues(newValues, true, { persistActive:false, silent:true });
          updateStatus('Synchro localStorage reçue');
        } else {
          removeInlineVars(allKnownThemeKeys(removed));
          document.body.classList.remove('fn-theme-lab-active');
        document.documentElement.classList.remove('fn-theme-lab-active');
          updateStatus('Thème temporaire désactivé');
          updateExportBox();
        }
        refreshAllControlStates();
      } finally {
        applyingRemoteSync = false;
      }
    });
  }
  function snapshotStoreState() {
    let raw = '{}';
    try { raw = localStorage.getItem(STORAGE_KEY) || '{}'; } catch(e) {}
    return raw + '::active=' + (isActiveStored() ? '1' : '0');
  }
  function applyStoredThemeSnapshot(reason='poll') {
    const active = isActiveStored();
    const values = readStore();
    if (active) applyValues(values, true, { persistActive:false, silent:true });
    else {
      removeInlineVars(allKnownThemeKeys());
      document.body.classList.remove('fn-theme-lab-active');
        document.documentElement.classList.remove('fn-theme-lab-active');
    }
    refreshAllControlStates();
    if (reason) updateStatus(reason === 'poll' ? 'Synchro live appliquée' : 'Réglages appliqués');
  }
  function startStorePoll() {
    // 0.22.47 : polling supprimé. La synchro passe par BroadcastChannel, storage, focus/visibilitychange.
  }

  function runtimeStatus() {
    return {
      build: BUILD,
      activeStored: isActiveStored(),
      activeHtml: document.documentElement.classList.contains('fn-theme-lab-active'),
      activeBody: !!(document.body && document.body.classList.contains('fn-theme-lab-active')),
      values: Object.keys(readStore()).length,
      syncRaw: (() => { try { return localStorage.getItem(SYNC_KEY) || ''; } catch(e) { return ''; } })(),
      snapshot: snapshotStoreState()
    };
  }

  function clearValues(keys) {
    const data = readStore();
    const removedKeys = (keys && keys.length ? keys : Object.keys(data)).filter(Boolean);
    removedKeys.forEach(key => {
      delete data[key];
      document.documentElement.style.removeProperty(key);
      document.body.style.removeProperty(key);
    });
    writeStore(data);
    const keepActive = Object.keys(data).length > 0 && isActiveStored();
    applyValues(data, keepActive);
    emitLiveSync(keys && keys.length ? 'reset-vars' : 'reset-all', { removedKeys });
    render();
  }
  function refreshControlState(key) {
    const store = readStore();
    let controls = [];
    try { controls = Array.from(document.querySelectorAll(`.theme-lab-control[data-var="${CSS.escape(key)}"]`)); }
    catch(e) { controls = Array.from(document.querySelectorAll('.theme-lab-control')).filter(el => el.dataset.var === key); }
    controls.forEach(control => {
      const modified = hasOwn(store, key);
      control.classList.toggle('is-modified', modified);
      const origin = originValue(key);
      const now = currentValue(key);
      const valueInput = control.querySelector('input[data-role="value"]');
      const colorInput = control.querySelector('input[data-role="color"]');
      const originEl = control.querySelector('.theme-lab-origin-value');
      const stateEl = control.querySelector('.theme-lab-modified-chip');
      const resetBtn = control.querySelector('[data-action="reset-var"]');
      const marker = control.querySelector('.theme-lab-mod-marker');
      if (valueInput && valueInput !== document.activeElement) valueInput.value = now;
      if (colorInput) { const hex = colorInputValue(key, now); if (hex) colorInput.value = hex; }
      if (originEl) originEl.textContent = origin || '—';
      if (stateEl) stateEl.textContent = modified ? 'Modifié' : 'Origine';
      if (resetBtn) resetBtn.disabled = !modified;
      if (marker) marker.textContent = modified ? '●' : '○';
    });
  }
  function refreshAllControlStates() {
    const keys = new Set([...ALL_ITEMS.map(i => i.key), ...Object.keys(readStore())]);
    keys.forEach(refreshControlState);
    updateStatus();
    updateExportBox();
  }
  function resetVar(key) {
    if (!key) return;
    clearValues([key]);
  }
  function saveValue(key, value) {
    const data = readStore();
    const v = String(value ?? '').trim();
    const removedKeys = [];
    if (v) data[key] = v;
    else { delete data[key]; removedKeys.push(key); }
    writeStore(data);
    applyValues(data, true);
    emitLiveSync('save-value', { changedKeys:[key], removedKeys });
    refreshControlState(key);
    const item = ALL_ITEMS.find(i => i.key === key);
    if (item && item.group) updateActiveGroupPreview(item.group, true);
    updateStatus('Aperçu live mis à jour : ' + key);
  }
  function exportObject() {
    return {
      foodnote_theme_lab: 1,
      build: BUILD,
      saved_at: new Date().toISOString(),
      values: readStore()
    };
  }
  function exportCss() {
    const data = readStore();
    const rows = Object.entries(data).sort((a,b) => a[0].localeCompare(b[0]));
    return ':root, body {\n' + rows.map(([k,v]) => `  ${k}: ${v};`).join('\n') + '\n}\n';
  }
  function updateExportBox() {
    const out = $('theme-lab-export-box');
    if (!out) return;
    out.value = JSON.stringify(exportObject(), null, 2) + '\n\n/* CSS variables */\n' + exportCss();
  }
  function updateStatus(msg) {
    const el = $('theme-lab-status');
    if (!el) return;
    const count = Object.keys(readStore()).length;
    const active = document.body.classList.contains('fn-theme-lab-active');
    el.textContent = msg || (active ? `${count} réglage${count>1?'s':''} appliqué${count>1?'s':''} en live` : `${count} réglage${count>1?'s':''} sauvegardé${count>1?'s':''}, labo désactivé`);
  }
  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      updateStatus((label || 'Copie') + ' copié');
    } catch(e) {
      const box = $('theme-lab-export-box');
      if (box) { box.value = text; box.focus(); box.select(); }
      updateStatus('Copie impossible automatiquement, texte sélectionné');
    }
  }
  function extractFirstJsonObject(raw) {
    const text = String(raw || '').trim();
    if (!text) return '{}';
    const start = text.indexOf('{');
    if (start < 0) return '{}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return text;
  }

  function parseThemeCssVariables(raw) {
    const clean = {};
    const text = String(raw || '');
    text.replace(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)\s*;/g, (_, key, value) => {
      const v = String(value || '').trim();
      if (v) clean[key] = v;
      return '';
    });
    return clean;
  }

  function parseThemeImport(raw) {
    const text = String(raw || '').trim();
    if (!text) return {};
    try {
      const obj = JSON.parse(text);
      return obj && obj.values && typeof obj.values === 'object' ? obj.values : obj;
    } catch(e) {}
    try {
      const jsonText = extractFirstJsonObject(text);
      const obj = JSON.parse(jsonText || '{}');
      return obj && obj.values && typeof obj.values === 'object' ? obj.values : obj;
    } catch(e) {}
    return parseThemeCssVariables(text);
  }

  function importTheme(raw) {
    try {
      const values = parseThemeImport(raw);
      const clean = {};
      Object.entries(values || {}).forEach(([k,v]) => { if (String(k).startsWith('--')) clean[k] = String(v).trim(); });
      Object.keys(clean).forEach(key => { if (!clean[key]) delete clean[key]; });
      if (!Object.keys(clean).length) {
        updateStatus('Import vide : aucun réglage Theme Lab trouvé');
        return;
      }
      const previousKeys = Object.keys(readStore());
      const removedKeys = previousKeys.filter(key => !Object.prototype.hasOwnProperty.call(clean, key));
      writeStore(clean);
      applyValues(clean, true);
      emitLiveSync('import-theme', { removedKeys, changedKeys:Object.keys(clean) });
      render();
      updateStatus('Thème importé et appliqué');
    } catch(e) {
      updateStatus('Import invalide : colle le JSON exporté ou le bloc CSS variables');
    }
  }

  function renderControl(item) {
    captureOrigins([item.key]);
    const store = readStore();
    const modified = hasOwn(store, item.key);
    const val = currentValue(item.key);
    const origin = originValue(item.key);
    const isColor = item.kind === 'color';
    const colorVal = colorInputValue(item.key, val);
    const originalColorVal = colorInputValue(item.key, origin);
    return `<div class="theme-lab-control ${modified ? 'is-modified' : ''}" data-var="${esc(item.key)}" data-group="${esc(item.group || '')}">
      <div class="theme-lab-mod-marker" title="${modified ? 'Valeur modifiée' : 'Valeur d’origine'}" aria-hidden="true">${modified ? '●' : '○'}</div>
      <div class="theme-lab-swatch-wrap ${isColor ? '' : 'theme-lab-swatch-text'}" title="Origine : ${esc(origin || '')}">
        ${isColor ? `<input type="color" data-role="color" data-var="${esc(item.key)}" value="${esc(colorVal)}" aria-label="${esc(item.label)}"><span class="theme-lab-origin-dot" style="--origin-color:${esc(originalColorVal)}"></span>` : '⌘'}
      </div>
      <div class="theme-lab-control-body">
        <div class="theme-lab-control-label"><span>${esc(item.label)}</span><code>${esc(item.key)}</code></div>
        <input type="text" data-role="value" data-var="${esc(item.key)}" value="${esc(val)}" placeholder="${esc(item.fallback || '#HEX / rgba / gradient')}">
        <div class="theme-lab-control-meta">
          <span class="theme-lab-modified-chip">${modified ? 'Modifié' : 'Origine'}</span>
          <span class="theme-lab-origin-label">Origine <code class="theme-lab-origin-value">${esc(origin || '—')}</code></span>
          <button type="button" class="theme-lab-reset-var" data-action="reset-var" data-var="${esc(item.key)}" ${modified ? '' : 'disabled'} title="Revenir à la valeur d’origine">↺</button>
        </div>
        ${item.hint ? `<div class="theme-lab-control-hint">${esc(item.hint)}</div>` : ''}
      </div>
    </div>`;
  }
  function renderGroupPreview(group) {
    const id = group && group.id ? group.id : 'base';
    if (id === 'base') return `<aside class="theme-lab-group-preview is-base" aria-label="Aperçu Base du site">
      <div class="theme-lab-preview-panel"><b>Surface principale</b><span>Texte secondaire, bordure et carte.</span><div class="theme-lab-preview-field">Champ / pilule</div></div>
      <div class="theme-lab-preview-split"><i></i><i></i><i></i></div>
    </aside>`;
    if (id === 'nutrition') return `<aside class="theme-lab-group-preview is-nutrition" aria-label="Aperçu Accents nutrition">
      <div class="theme-lab-mini-macros"><span style="--c:var(--green)">Vert</span><span style="--c:var(--orange)">Orange</span><span style="--c:var(--red)">Alerte</span><span style="--c:var(--blue)">Info</span></div>
      <div class="theme-lab-preview-panel is-success">Objectif atteint</div>
    </aside>`;
    if (id === 'energy') return `<aside class="theme-lab-group-preview is-energy" aria-label="Aperçu Energy Theme"><div class="theme-lab-energy-hero"><b>FoodNote</b><span>Logo, header, énergie visuelle</span></div><div class="theme-lab-energy-dots"><i></i><i></i><i></i><i></i></div></aside>`;
    if (id === 'gradients') return `<aside class="theme-lab-group-preview is-gradients" aria-label="Aperçu Dégradés globaux"><div class="theme-lab-gradient-page"><div class="theme-lab-gradient-card">Fond + glows</div></div></aside>`;
    if (id === 'home') return `<aside class="theme-lab-group-preview is-home" aria-label="Aperçu Accueil calories macros">
      <div class="theme-lab-home-ring"><span>🔥</span><b>6519</b><em>kcal</em></div>
      <div class="theme-lab-home-macros"><i class="kcal">Kcal</i><i class="prot">Prot</i><i class="gluc">Gluc</i><i class="lip">Lip</i></div>
      <small>Les forces à 0% neutralisent le dégradé accueil.</small>
    </aside>`;
    if (id === 'badges') return `<aside class="theme-lab-group-preview is-badges" aria-label="Aperçu Badges">
      <div class="theme-lab-preview-badges mini">
        <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-kcal"><span class="recap-badge-icon fn-chip-dot">🔥</span><span class="fn-chip-body"><b>Kcal</b><small>Badge kcal</small><span class="fn-chip-progress"><i style="width:72%"></i></span></span></div>
        <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-prot"><span class="recap-badge-icon fn-chip-dot">🍖</span><span class="fn-chip-body"><b>Prot</b><small>Badge protéines</small><span class="fn-chip-progress"><i style="width:82%"></i></span></span></div>
        <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-gluc"><span class="recap-badge-icon fn-chip-dot">🍞</span><span class="fn-chip-body"><b>Gluc</b><small>Badge glucides</small><span class="fn-chip-progress"><i style="width:62%"></i></span></span></div>
        <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-lip"><span class="recap-badge-icon fn-chip-dot">🥑</span><span class="fn-chip-body"><b>Lip</b><small>Badge lipides</small><span class="fn-chip-progress"><i style="width:54%"></i></span></span></div>
      </div>
    </aside>`;
    if (id === 'mobile') return `<aside class="theme-lab-group-preview is-mobile" aria-label="Aperçu Barre mobile"><div class="theme-lab-mobile-nav-mini"><span>Journal</span><span>Objectifs</span><b>+</b><span>Bilan</span><span>Menu</span></div><div class="theme-lab-mobile-bubble-mini">🍽 Aliment<br>🏃 Sport</div></aside>`;
    if (id === 'popup') return `<aside class="theme-lab-group-preview is-popup" aria-label="Aperçu Popup Ajouter"><div class="theme-lab-popup-mini"><b>+ Ajouter au petit-déj</b><input value="Banane" readonly><button>Ajouter</button></div></aside>`;
    return `<aside class="theme-lab-group-preview is-ui" aria-label="Aperçu UI globale"><div class="theme-lab-ui-panel"><b>Objectifs</b><span class="bar"><i></i></span><p>Récap, panels, statistiques</p></div></aside>`;
  }
  function renderGroup(group) {
    return `<section class="theme-lab-card theme-lab-card-group" id="theme-lab-group-${esc(group.id)}" data-group="${esc(group.id)}">
      <div class="theme-lab-group-head">
        <div><div class="theme-lab-group-title"><span>${esc(group.icon)}</span><b>${esc(group.title)}</b></div><div class="theme-lab-group-sub">${esc(group.sub || '')}</div></div>
        <div class="theme-lab-group-actions"><button type="button" class="theme-lab-reset-group" data-action="reset-group" data-group="${esc(group.id)}">Reset groupe</button></div>
      </div>
      <div class="theme-lab-group-body">
        <div class="theme-lab-controls">${group.items.map(item => renderControl({...item, group: group.id})).join('')}</div>
        <div class="theme-lab-inline-preview" aria-label="Aperçu ${esc(group.title)}">${renderGroupPreview(group)}</div>
      </div>
    </section>`;
  }

  function renderGroupPreviewCard(group, activeId='base') {
    const active = group && group.id === activeId ? ' is-active' : '';
    return `<article class="theme-lab-preview-catalog-item${active}" id="theme-lab-right-preview-${esc(group.id)}" data-preview-group="${esc(group.id)}">
      <button type="button" class="theme-lab-preview-catalog-head" data-action="preview-group" data-group="${esc(group.id)}" aria-label="Voir l'aperçu ${esc(group.title)}">
        <span>${esc(group.icon)}</span>
        <b>${esc(group.title)}</b>
        <small>${esc(group.items.length)} réglages</small>
      </button>
      <div class="theme-lab-preview-catalog-body">${renderGroupPreview(group)}</div>
    </article>`;
  }

  function renderPreviewCatalog(activeId='base') {
    const active = GROUPS.some(g => g.id === activeId) ? activeId : 'base';
    return `<section class="theme-lab-card theme-lab-preview-catalog-card" id="theme-lab-right-preview-card" aria-label="Aperçus des groupes">
      <div class="theme-lab-group-head compact">
        <div>
          <div class="theme-lab-group-title"><span>👁️</span><b>Aperçus des groupes</b></div>
          <div class="theme-lab-group-sub">Chaque groupe possède son aperçu à droite. Les réglages restent uniquement dans la colonne centrale.</div>
        </div>
      </div>
      ${renderPreviewTabs(active)}
      <div id="theme-lab-active-preview" class="theme-lab-preview-catalog-list" data-active-group="${esc(active)}">
        ${GROUPS.map(g => renderGroupPreviewCard(g, active)).join('')}
      </div>
    </section>`;
  }

  function renderPreviewTabs(activeId) {
    const active = activeId || 'base';
    return `<div class="theme-lab-preview-tabs" aria-label="Choix de l’aperçu">${GROUPS.map(g => `<button type="button" class="theme-lab-preview-tab ${g.id === active ? 'active' : ''}" data-action="preview-group" data-group="${esc(g.id)}"><span>${esc(g.icon)}</span><b>${esc(g.title)}</b></button>`).join('')}</div>`;
  }

  function renderRightGroupPreview(groupId) {
    return renderPreviewCatalog(groupId || 'base');
  }
  function updateActiveGroupPreview(groupId, force=false) {
    const group = GROUPS.find(g => g.id === groupId) || GROUPS[0];
    const wrap = $('theme-lab-active-preview');
    if (!wrap) return;
    const previous = wrap.dataset.activeGroup || 'base';
    if (!force && previous === group.id) return;
    wrap.dataset.activeGroup = group.id;
    Array.from(document.querySelectorAll('.theme-lab-preview-tab')).forEach(btn => btn.classList.toggle('active', btn.dataset.group === group.id));
    Array.from(document.querySelectorAll('.theme-lab-preview-catalog-item')).forEach(item => item.classList.toggle('is-active', item.dataset.previewGroup === group.id));
    const target = $('theme-lab-right-preview-' + group.id);
    if (target && force) {
      try { target.scrollIntoView({block:'nearest', behavior:'smooth'}); } catch(e) { try { target.scrollIntoView(false); } catch(_) {} }
    }
  }
  function setupGroupPreviewFocus() {
    const cards = Array.from(document.querySelectorAll('.theme-lab-card-group[id^="theme-lab-group-"]'));
    if (!cards.length) return;
    const setFromEl = (el) => {
      const id = String(el.id || '').replace('theme-lab-group-', '');
      if (id) updateActiveGroupPreview(id);
    };
    cards.forEach(card => {
      card.addEventListener('mouseenter', () => setFromEl(card), {passive:true});
      card.addEventListener('focusin', () => setFromEl(card));
      card.addEventListener('click', () => setFromEl(card));
    });
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setFromEl(visible.target);
      }, {root:null, rootMargin:'-18% 0px -55% 0px', threshold:[0.12,0.22,0.35,0.5]});
      cards.forEach(card => obs.observe(card));
    }
  }
  function renderPreview() {
    return `<section class="theme-lab-card theme-lab-preview">
      <div class="theme-lab-preview-mini">
        <div class="theme-lab-preview-hero">
          <div class="theme-lab-preview-badge">⚡ Aperçu live</div>
          <div class="theme-lab-preview-title">Saisie du jour</div>
          <div class="theme-lab-preview-sub">Chaque changement est appliqué immédiatement : pas besoin de quitter la page.</div>
        </div>
        <div class="theme-lab-preview-row">
          <div class="theme-lab-preview-chip"><strong style="color:var(--fn-calorie-accent,var(--green))">6519</strong><em>Calories</em></div>
          <div class="theme-lab-preview-chip"><strong style="color:var(--fn-macro-prot,var(--blue))">177g</strong><em>Protéines</em></div>
        </div>
        <div class="theme-lab-preview-badges" aria-label="Aperçu direct des badges">
          <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-kcal"><span class="recap-badge-icon fn-chip-dot">🔥</span><span class="recap-badge-text fn-chip-body"><span class="recap-badge-top"><span class="fn-chip-label">Kcal</span><strong class="fn-chip-value">2335</strong></span><small class="recap-badge-sub fn-chip-sub">Badge kcal</small><span class="fn-chip-progress"><i style="width:72%"></i></span></span></div>
          <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-prot"><span class="recap-badge-icon fn-chip-dot">🍖</span><span class="recap-badge-text fn-chip-body"><span class="recap-badge-top"><span class="fn-chip-label">Prot</span><strong class="fn-chip-value">142g</strong></span><small class="recap-badge-sub fn-chip-sub">Badge protéines</small><span class="fn-chip-progress"><i style="width:88%"></i></span></span></div>
          <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-gluc"><span class="recap-badge-icon fn-chip-dot">🍞</span><span class="recap-badge-text fn-chip-body"><span class="recap-badge-top"><span class="fn-chip-label">Gluc</span><strong class="fn-chip-value">272g</strong></span><small class="recap-badge-sub fn-chip-sub">Badge glucides</small><span class="fn-chip-progress"><i style="width:65%"></i></span></span></div>
          <div class="journal-dashboard-badge fn-smart-chip fn-smart-chip-mini macro-lip"><span class="recap-badge-icon fn-chip-dot">🥑</span><span class="recap-badge-text fn-chip-body"><span class="recap-badge-top"><span class="fn-chip-label">Lip</span><strong class="fn-chip-value">77g</strong></span><small class="recap-badge-sub fn-chip-sub">Badge lipides</small><span class="fn-chip-progress"><i style="width:58%"></i></span></span></div>
        </div>
        <div class="theme-lab-preview-card"><b>Carte / panel</b><br><span style="color:var(--text3);font-size:12px">Fond, bordure, glow et texte.</span></div>
      </div>
    </section>`;
  }
  function scanCssVariables() {
    const found = new Set();
    const add = (txt) => {
      String(txt || '').replace(/--[a-zA-Z0-9_-]+/g, m => found.add(m));
    };
    try {
      Array.from(document.styleSheets || []).forEach(sheet => {
        try { Array.from(sheet.cssRules || []).forEach(rule => add(rule.cssText)); } catch(e) {}
      });
    } catch(e) {}
    ALL_ITEMS.forEach(i => found.add(i.key));
    return Array.from(found).sort((a,b) => a.localeCompare(b));
  }
  function renderExpertList(filter='') {
    const list = $('theme-lab-expert-list');
    if (!list) return;
    const q = String(filter || '').toLowerCase().trim();
    const vars = scanCssVariables().filter(k => !q || k.toLowerCase().includes(q));
    if (!vars.length) { list.innerHTML = '<div class="theme-lab-empty">Aucune variable trouvée.</div>'; return; }
    list.innerHTML = `<div class="theme-lab-controls">${vars.map(key => renderControl({key, label: KNOWN_KEYS.has(key) ? key.replace(/^--/,'') : 'Variable détectée', fallback: cssValue(key), kind: looksLikeColor(cssValue(key)) ? 'color' : 'text'})).join('')}</div>`;
  }
  function looksLikeColor(v) {
    const s = String(v || '').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) || /^rgba?\(/i.test(s) || /^hsl/i.test(s);
  }

  function render() {
    const root = $('theme-lab-root');
    if (!root) return;
    root.innerHTML = `<div class="theme-lab-page">
      <section class="theme-lab-hero">
        <h1>Laboratoire couleurs</h1>
        <p>Modifie les couleurs, gradients et variables FoodNote. Chaque groupe affiche ses réglages à gauche et son aperçu directement en face à droite. Les changements restent synchronisés entre fenêtres.</p>
        <div class="theme-lab-hero-actions">
          <button type="button" class="theme-lab-btn primary" data-action="apply">Appliquer / réactiver</button>
          <button type="button" class="theme-lab-btn" data-action="disable">Désactiver temporaire</button>
          <button type="button" class="theme-lab-btn warn" data-action="reset-all">Tout réinitialiser</button>
        </div>
      </section>
      <section class="theme-lab-sticky-actions" aria-label="Actions du laboratoire couleurs">
        <button type="button" class="theme-lab-btn primary" data-action="apply">Appliquer / réactiver</button>
        <button type="button" class="theme-lab-btn" data-action="disable">Désactiver</button>
        <button type="button" class="theme-lab-btn warn" data-action="reset-all">Tout reset</button>
        <span class="theme-lab-status" id="theme-lab-status"></span>
      </section>
      <div class="theme-lab-layout theme-lab-layout-inline">
        <main class="theme-lab-main">
          ${GROUPS.map(renderGroup).join('')}
          <section class="theme-lab-card theme-lab-export">
            <div class="theme-lab-group-head"><div><div class="theme-lab-group-title"><span>📦</span><b>Export / import</b></div><div class="theme-lab-group-sub">Copie les réglages quand le thème te convient, ou importe un JSON déjà exporté.</div></div></div>
            <div class="theme-lab-toolbar">
              <button type="button" class="theme-lab-btn" data-action="copy-json">Copier JSON</button>
              <button type="button" class="theme-lab-btn" data-action="copy-css">Copier CSS</button>
            </div>
            <textarea id="theme-lab-export-box" spellcheck="false"></textarea>
            <div class="theme-lab-import-row"><textarea id="theme-lab-import-box" placeholder="Colle ici le JSON exporté, ou le contenu complet JSON + CSS variables" spellcheck="false"></textarea><button type="button" class="theme-lab-btn primary" data-action="import-json">Importer</button></div>
          </section>
          <section class="theme-lab-card">
            <div class="theme-lab-group-head"><div><div class="theme-lab-group-title"><span>🧪</span><b>Variables avancées détectées</b></div><div class="theme-lab-group-sub">Pour vraiment tout régler : scanner toutes les variables CSS chargées par l'application.</div></div><button type="button" class="theme-lab-reset-group" data-action="scan-vars">Scanner</button></div>
            <div class="theme-lab-search"><input type="text" id="theme-lab-var-search" placeholder="Rechercher une variable : --fn-energy, --green, --bg..."><button type="button" class="theme-lab-btn" data-action="scan-vars">Scanner</button></div>
            <div id="theme-lab-expert-list" class="theme-lab-expert-list"><div class="theme-lab-empty">Clique sur Scanner pour afficher toutes les variables CSS disponibles.</div></div>
          </section>
        </main>
      </div>
    </div>`;
    updateStatus();
    updateExportBox();
  }

  function onInput(e) {
    const el = e.target;
    const key = el && el.dataset ? el.dataset.var : '';
    if (!key) return;
    if (el.dataset.role === 'color') {
      const text = document.querySelector(`input[data-role="value"][data-var="${CSS.escape(key)}"]`);
      if (text) text.value = el.value;
      saveValue(key, el.value);
      return;
    }
    if (el.dataset.role === 'value') {
      const color = document.querySelector(`input[data-role="color"][data-var="${CSS.escape(key)}"]`);
      if (color) {
        const hex = rgbToHex(el.value);
        if (hex) color.value = hex;
      }
      saveValue(key, el.value);
    }
  }
  function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'apply') { applyValues(readStore(), true); emitLiveSync('apply'); refreshAllControlStates(); updateStatus('Réglages appliqués au site et synchronisés'); return; }
    if (action === 'disable') { const removedKeys = allKnownThemeKeys(); removeInlineVars(removedKeys); document.body.classList.remove('fn-theme-lab-active');
        document.documentElement.classList.remove('fn-theme-lab-active'); setActiveStored(false); emitLiveSync('disable', { removedKeys }); refreshAllControlStates(); updateStatus('Thème temporaire désactivé et synchronisé'); return; }
    if (action === 'reset-all') { if (confirm('Réinitialiser tous les réglages du laboratoire couleurs ?')) clearValues(); return; }
    if (action === 'reset-var') { resetVar(btn.dataset.var); return; }
    if (action === 'preview-group') { const card = document.getElementById('theme-lab-group-' + (btn.dataset.group || 'base')); if (card) { try { card.scrollIntoView({block:'start', behavior:'smooth'}); } catch(e) { card.scrollIntoView(); } } return; }
    if (action === 'reset-group') {
      const group = GROUPS.find(g => g.id === btn.dataset.group);
      if (group) clearValues(group.items.map(i => i.key));
      return;
    }
    if (action === 'scan-vars') { renderExpertList(($('theme-lab-var-search')||{}).value || ''); return; }
    if (action === 'copy-json') return copyText(JSON.stringify(exportObject(), null, 2), 'JSON');
    if (action === 'copy-css') return copyText(exportCss(), 'CSS');
    if (action === 'import-json') return importTheme(($('theme-lab-import-box')||{}).value || '');
  }
  function bind() {
    document.addEventListener('input', (e) => {
      if (e.target && e.target.closest && e.target.closest('#theme-lab-root')) onInput(e);
      if (e.target && e.target.id === 'theme-lab-var-search') renderExpertList(e.target.value);
    });
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('#theme-lab-root')) onClick(e);
    });
  }

  function ensureHomeNutritionReferenceStyle() {
    let style = document.getElementById('foodnote-home-nutrition-reference-core');
    if (!style) {
      style = document.createElement('style');
      style.id = 'foodnote-home-nutrition-reference-core';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = `

/* FoodNote beta 0.22.63 — Accueil nutrition : layout référence compact.
   Source de vérité visuelle : carte Calories étroite à gauche, macros longues à droite.
   Le mobile conserve le même dessin en deux colonnes au lieu de basculer en pile. */
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel {
  --fn-home-calorie-ring-size: clamp(92px, 11.5vw, 116px) !important;
  --fn-home-calorie-ring-thickness: clamp(8px, 1vw, 11px) !important;
  --fn-home-panel-gap: clamp(10px, 1.45vw, 16px) !important;
  padding: clamp(15px, 2.1vw, 22px) clamp(16px, 2.4vw, 28px) !important;
  border-radius: clamp(22px, 3vw, 30px) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-panel-head,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-panel-head {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto !important;
  gap: 10px !important;
  align-items: start !important;
  margin-bottom: clamp(14px, 2vw, 18px) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-kicker,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-kicker {
  font-size: clamp(9px, 1.15vw, 12px) !important;
  line-height: 1.05 !important;
  letter-spacing: .23em !important;
  font-weight: 900 !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-title,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-title {
  font-size: clamp(22px, 3.65vw, 34px) !important;
  line-height: 1.02 !important;
  letter-spacing: -.045em !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-status,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-status {
  font-size: clamp(10px, 1.25vw, 13px) !important;
  line-height: 1 !important;
  padding: 7px 13px !important;
  border-radius: 999px !important;
  white-space: nowrap !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout {
  display: grid !important;
  grid-template-columns: minmax(158px, 23.5%) minmax(0, 1fr) !important;
  grid-template-areas: "calorie macros" !important;
  gap: var(--fn-home-panel-gap) !important;
  align-items: stretch !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card {
  grid-area: calorie !important;
  display: grid !important;
  grid-template-columns: 1fr !important;
  grid-template-rows: auto auto !important;
  justify-items: center !important;
  align-content: center !important;
  align-items: center !important;
  gap: clamp(9px, 1.4vw, 12px) !important;
  min-height: clamp(188px, 25vw, 212px) !important;
  padding: clamp(15px, 2vw, 19px) 10px !important;
  text-align: center !important;
  border-radius: clamp(16px, 2.3vw, 20px) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-wrap,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-wrap {
  width: var(--fn-home-calorie-ring-size) !important;
  height: var(--fn-home-calorie-ring-size) !important;
  min-width: var(--fn-home-calorie-ring-size) !important;
  min-height: var(--fn-home-calorie-ring-size) !important;
  justify-self: center !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual {
  width: var(--fn-home-calorie-ring-size) !important;
  height: var(--fn-home-calorie-ring-size) !important;
  min-width: var(--fn-home-calorie-ring-size) !important;
  min-height: var(--fn-home-calorie-ring-size) !important;
  max-width: var(--fn-home-calorie-ring-size) !important;
  max-height: var(--fn-home-calorie-ring-size) !important;
  aspect-ratio: 1 / 1 !important;
  border-radius: 50% !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before { content: none !important; display: none !important; }
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after { inset: var(--fn-home-calorie-ring-thickness) !important; }
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-core { max-width: calc(var(--fn-home-calorie-ring-size) - (var(--fn-home-calorie-ring-thickness) * 2.35)) !important; }
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core #m-kcal,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core .macro-val,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-core #m-kcal,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-core .macro-val {
  font-size: clamp(30px, calc(var(--fn-home-calorie-ring-size) * .36), 42px) !important;
  line-height: .9 !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-flame,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-flame {
  font-size: clamp(12px, calc(var(--fn-home-calorie-ring-size) * .12), 15px) !important;
  margin-bottom: 3px !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-unit,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-unit {
  font-size: clamp(8px, calc(var(--fn-home-calorie-ring-size) * .078), 10px) !important;
  margin-top: 5px !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-copy,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-copy {
  justify-items: center !important;
  align-content: start !important;
  text-align: center !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-copy .macro-lbl,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-copy .macro-lbl {
  margin: 0 0 5px !important;
  font-size: clamp(8px, 1.05vw, 10px) !important;
  line-height: 1.05 !important;
  letter-spacing: .14em !important;
  font-weight: 950 !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-target-line,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-target-line {
  font-size: clamp(11px, 1.25vw, 13px) !important;
  line-height: 1.15 !important;
  font-weight: 700 !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-percent,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-state-line,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-percent,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-state-line {
  display: none !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-list,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list {
  grid-area: macros !important;
  display: grid !important;
  grid-template-columns: 1fr !important;
  grid-template-rows: repeat(3, minmax(clamp(58px, 7.5vw, 66px), 1fr)) !important;
  gap: clamp(10px, 1.4vw, 14px) !important;
  align-content: stretch !important;
  padding: 0 !important;
  background: transparent !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row {
  display: grid !important;
  grid-template-columns: clamp(34px, 4.8vw, 42px) minmax(0, 1fr) clamp(20px, 3vw, 26px) !important;
  grid-template-rows: auto auto !important;
  align-items: center !important;
  gap: 0 clamp(9px, 1.4vw, 13px) !important;
  min-height: clamp(58px, 7.5vw, 66px) !important;
  padding: clamp(9px, 1.35vw, 12px) clamp(12px, 1.9vw, 16px) clamp(11px, 1.8vw, 15px) clamp(10px, 1.55vw, 14px) !important;
  border-radius: clamp(15px, 2.1vw, 18px) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble {
  width: clamp(32px, 4.6vw, 40px) !important;
  height: clamp(32px, 4.6vw, 40px) !important;
  min-width: clamp(32px, 4.6vw, 40px) !important;
  border-radius: clamp(10px, 1.7vw, 14px) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring span,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring span { font-size: clamp(13px, 2vw, 17px) !important; }
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-lbl,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-lbl {
  font-size: clamp(8px, 1.05vw, 10px) !important;
  line-height: 1.05 !important;
  letter-spacing: .13em !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val {
  font-size: clamp(18px, 3.1vw, 26px) !important;
  line-height: .95 !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target {
  margin-top: 3px !important;
  font-size: clamp(8px, 1.15vw, 10px) !important;
  line-height: 1.1 !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row > .macro-status-badge,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row > .macro-status-badge {
  width: clamp(18px, 3vw, 24px) !important;
  height: clamp(18px, 3vw, 24px) !important;
  font-size: clamp(9px, 1.6vw, 12px) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-progress {
  left: clamp(8px, 1.45vw, 14px) !important;
  right: clamp(8px, 1.45vw, 14px) !important;
  bottom: 5px !important;
  height: 2px !important;
}
@media (max-width: 720px) {
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel {
    --fn-home-calorie-ring-size: clamp(72px, 19vw, 88px) !important;
    --fn-home-calorie-ring-thickness: 7px !important;
    --fn-home-panel-gap: 7px !important;
    padding: 11px 12px !important;
    border-radius: 22px !important;
  }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-panel-head,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-panel-head { margin-bottom: 8px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-title,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-title { font-size: clamp(16px, 4.6vw, 22px) !important; letter-spacing: -.035em !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-kicker,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-kicker { font-size: 8px !important; letter-spacing: .18em !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-orbit-status,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-orbit-status { font-size: 9px !important; padding: 5px 8px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout {
    grid-template-columns: minmax(124px, 31%) minmax(0, 1fr) !important;
    grid-template-areas: "calorie macros" !important;
  }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card { min-height: 166px !important; padding: 11px 6px !important; gap: 7px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-list { grid-template-rows: repeat(3, minmax(49px, 1fr)) !important; gap: 6px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row { grid-template-columns: 30px minmax(0,1fr) 17px !important; min-height: 49px !important; gap: 0 7px !important; padding: 7px 8px 9px 7px !important; border-radius: 14px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble { width: 28px !important; height: 28px !important; min-width: 28px !important; border-radius: 10px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring span,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring span { font-size: 13px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-lbl,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-lbl { font-size: 7px !important; letter-spacing: .10em !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val { font-size: clamp(14px, 4.2vw, 17px) !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target { font-size: 6.8px !important; margin-top: 1px !important; }
}
@media (max-width: 390px) {
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel { --fn-home-calorie-ring-size: clamp(62px, 18vw, 72px) !important; padding: 9px 10px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout { grid-template-columns: minmax(112px, 32%) minmax(0,1fr) !important; gap: 6px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card { min-height: 150px !important; padding: 9px 5px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core #m-kcal,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-core #m-kcal { font-size: 22px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-flame,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-flame { font-size: 9px !important; margin-bottom: 1px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-unit,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-unit { font-size: 6.5px !important; margin-top: 2px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-copy .macro-lbl,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-copy .macro-lbl { font-size: 7px !important; margin-bottom: 3px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-target-line,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-target-line { font-size: 9px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-list,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-list { grid-template-rows: repeat(3, minmax(45px, 1fr)) !important; gap: 5px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row { grid-template-columns: 26px minmax(0,1fr) 15px !important; min-height: 45px !important; padding: 6px 7px 8px 6px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-mini-ring,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .fn-macro-icon-bubble { width: 24px !important; height: 24px !important; min-width: 24px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-val { font-size: 13px !important; }
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-macro-row .macro-target { font-size: 6px !important; }
}
@media (max-width: 340px) {
  #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout,
  body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-home-nutrition-layout { grid-template-columns: minmax(104px, 34%) minmax(0,1fr) !important; }
}

/* FoodNote beta 0.22.66 — Accueil calories : fond glass conservé ; masque intérieur ajouté plus bas.
   L'opacité ne remixe plus la couleur avec l'aura signature. La couleur choisie reste la source ; seul l'alpha change. */
:root {
  --fn-home-calorie-card-surface: var(--fn-home-calorie-surface, #fff3ea);
  --fn-home-calorie-card-opacity: 70%;
  --fn-home-calorie-card-blur: 10px;
  --fn-home-calorie-card-border-opacity: 48%;
  --fn-home-calorie-ring-inner-surface: var(--fn-home-calorie-surface, #fffdf7);
  --fn-home-calorie-ring-inner-opacity: 92%;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-summary-card,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-summary-card {
  background: rgb(from var(--fn-home-calorie-card-surface, var(--fn-home-calorie-surface, #fff3ea)) r g b / var(--fn-home-calorie-card-opacity, 70%)) !important;
  border: 1px solid rgb(from var(--fn-home-calorie-border, #d8ddce) r g b / var(--fn-home-calorie-card-border-opacity, 48%)) !important;
  -webkit-backdrop-filter: blur(var(--fn-home-calorie-card-blur, 10px)) saturate(1.06) !important;
  backdrop-filter: blur(var(--fn-home-calorie-card-blur, 10px)) saturate(1.06) !important;
  box-shadow:
    0 10px 28px color-mix(in srgb, var(--fn-home-calorie-card-surface, var(--fn-home-calorie-surface, #fff3ea)) 16%, transparent),
    inset 0 1px 0 rgba(255,255,255,.46) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after {
  background: rgb(from var(--fn-home-calorie-ring-inner-surface, var(--fn-home-calorie-card-surface, #fffdf7)) r g b / var(--fn-home-calorie-ring-inner-opacity, 92%)) !important;
}


/* FoodNote beta 0.22.66 — Calories : opacité intérieur cercle sans dérive vers l'anneau.
   Le centre du cercle a maintenant deux couches :
   1) un masque neutre opaque qui coupe l'anneau calories ;
   2) la couleur choisie dans le labo, avec opacité réglable.
   Résultat : baisser "Opacité intérieur cercle" n'expose plus le vert de l'anneau. */
:root {
  --fn-home-calorie-ring-inner-backdrop: var(--fn-home-panel-surface, #fffdf7);
  --fn-home-calorie-ring-inner-surface: var(--fn-home-calorie-ring-inner-surface, var(--fn-home-calorie-surface, #fffdf7));
  --fn-home-calorie-ring-inner-opacity: var(--fn-home-calorie-ring-inner-opacity, 92%);
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::before {
  content: "" !important;
  position: absolute !important;
  inset: var(--fn-home-calorie-ring-thickness, clamp(11px, 1.25vw, 14px)) !important;
  border-radius: inherit !important;
  display: block !important;
  background: var(--fn-home-calorie-ring-inner-backdrop, var(--fn-home-panel-surface, #fffdf7)) !important;
  opacity: 1 !important;
  z-index: 0 !important;
  pointer-events: none !important;
  transform: none !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.68) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-visual::after {
  content: "" !important;
  position: absolute !important;
  inset: var(--fn-home-calorie-ring-thickness, clamp(11px, 1.25vw, 14px)) !important;
  border-radius: inherit !important;
  display: block !important;
  background: var(--fn-home-calorie-ring-inner-surface, #fffdf7) !important;
  opacity: var(--fn-home-calorie-ring-inner-alpha, var(--fn-home-calorie-ring-inner-opacity, 92%)) !important;
  z-index: 1 !important;
  pointer-events: none !important;
  transform: none !important;
  border: 0 !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.52) !important;
}
#page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core,
#page-journal .journal-floating-macro-card.fn-orbit-nutrition-card.fn-home-nutrition-panel .fn-calorie-ring-core,
html.fn-theme-lab-active body #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core,
body.fn-theme-lab-active #page-journal .journal-floating-macro-card.fn-home-nutrition-panel .fn-calorie-ring-core {
  position: relative !important;
  z-index: 3 !important;
}

`;
  }

  function init() {
    ensureGlobalBridgeStyles();
    captureOrigins();
    setupLiveSync();
    bind();
    render();
    const values = readStore();
    if (Object.keys(values).length) applyValues(values, isActiveStored(), { persistActive:false });
    try { if (window.FoodNoteThemeLabRuntime) window.FoodNoteThemeLabRuntime.pull('theme-lab-init'); } catch(e) {}
  }

  window.FoodNoteThemeLab = {
    init, render,
    apply: () => { applyValues(readStore(), true); emitLiveSync('api-apply'); },
    pull: () => applyStoredThemeSnapshot('manual'),
    reset: () => clearValues(),
    exportObject, exportCss,
    sync: () => emitLiveSync('manual-sync'),
    status: runtimeStatus
  };
  if (!window.FoodNoteThemeLabRuntime) window.FoodNoteThemeLabRuntime = { status: runtimeStatus, pull: () => applyStoredThemeSnapshot('manual'), apply: () => applyValues(readStore(), isActiveStored(), {persistActive:false}) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
