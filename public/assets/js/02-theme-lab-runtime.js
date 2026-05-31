/* FoodNote beta 0.22.51 — Theme Lab Runtime
   Pont global léger : applique les overrides du laboratoire sur toutes les pages.
   Pas de polling permanent : BroadcastChannel + storage + focus/visibilitychange. */
(function(){
  'use strict';
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const STORAGE_KEY = 'foodnote_theme_lab_v1';
  const ACTIVE_KEY = 'foodnote_theme_lab_active';
  const SYNC_KEY = 'foodnote_theme_lab_sync_v1';
  const DEBUG_KEY = 'foodnote_theme_lab_debug';
  const CHANNEL_NAME = 'foodnote_theme_lab_live_sync_v1';
  const CLIENT_ID = (() => {
    try { return 'fnrt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); }
    catch(e) { return 'fnrt-' + Math.random().toString(36).slice(2,8); }
  })();

  let channel = null;
  let lastToken = '';
  let lastApplyAt = 0;
  let lastReason = 'init';
  let lastKeys = [];
  let debugPanel = null;

  function parse(raw, fallback) { try { return JSON.parse(raw || ''); } catch(e) { return fallback; } }
  function readValues() { try { return parse(localStorage.getItem(STORAGE_KEY), {}) || {}; } catch(e) { return {}; } }
  function writeValues(values) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values || {}, null, 2)); } catch(e) {} }
  function isActive() { try { return localStorage.getItem(ACTIVE_KEY) === '1'; } catch(e) { return false; } }
  function setActive(v) { try { v ? localStorage.setItem(ACTIVE_KEY, '1') : localStorage.removeItem(ACTIVE_KEY); } catch(e) {} }
  function debugEnabled() {
    try {
      /* Diagnostic uniquement sur demande explicite, jamais via un vieux localStorage. */
      const params = new URLSearchParams(location.search || '');
      return params.get('fn_theme_debug') === '1' || params.get('theme_debug') === '1';
    } catch(e) { return false; }
  }
  try { localStorage.removeItem(DEBUG_KEY); } catch(e) {}

  function safeCssValue(value) {
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
  function ensureVarsStyle() {
    let style = document.getElementById('foodnote-theme-lab-runtime-vars');
    if (!style) {
      style = document.createElement('style');
      style.id = 'foodnote-theme-lab-runtime-vars';
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }
  function ensureBridgeStyle() {
    let style = document.getElementById('foodnote-theme-lab-runtime-bridge');
    if (!style) {
      style = document.createElement('style');
      style.id = 'foodnote-theme-lab-runtime-bridge';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = `
/* FoodNote Theme Lab Runtime Bridge — chargé sur toutes les pages */
html.fn-theme-lab-active, body.fn-theme-lab-active { --fn-theme-live: 1; }
html.fn-theme-lab-active body,
body.fn-theme-lab-active {
  background:
    radial-gradient(circle at 12% -8%, color-mix(in srgb, var(--fn-lab-page-glow-1, var(--fn-energy-orange, var(--orange))) var(--fn-lab-page-glow-1-strength, 12%), transparent) 0, transparent var(--fn-lab-page-glow-1-size, 34vw)),
    radial-gradient(circle at 92% 2%, color-mix(in srgb, var(--fn-lab-page-glow-3, var(--fn-energy-green, var(--green))) var(--fn-lab-page-glow-3-strength, 8%), transparent) 0, transparent var(--fn-lab-page-glow-3-size, 34vw)),
    linear-gradient(180deg, var(--fn-lab-page-base-1, var(--fn-energy-page-1, var(--bg))), var(--fn-lab-page-base-2, var(--fn-energy-page-2, var(--bg))) !important;
}
html.fn-theme-lab-active body .card,
html.fn-theme-lab-active body .hist-card,
html.fn-theme-lab-active body .stats-panel,
html.fn-theme-lab-active body .data-card,
html.fn-theme-lab-active body .journal-meals-card,
html.fn-theme-lab-active body .journal-section-card,
html.fn-theme-lab-active body .journal-tile-card,
html.fn-theme-lab-active body .recap-card,
html.fn-theme-lab-active body .recap-smart-card,
html.fn-theme-lab-active body .stats-card,
html.fn-theme-lab-active body .stats-mini-card,
html.fn-theme-lab-active body .fn-ui-surface,
html.fn-theme-lab-active body .fn-ui-panel,
html.fn-theme-lab-active body .fn-ui-card,
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
  border-color: var(--fn-energy-border, var(--border2)) !important;
  background:
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--fn-lab-card-glow, var(--fn-energy-orange, var(--orange))) var(--fn-lab-card-glow-strength, 8%), transparent) 0, transparent 48%),
    linear-gradient(var(--fn-lab-card-angle, 145deg), color-mix(in srgb, var(--calm-surface, var(--bg2)) 86%, var(--fn-lab-card-tint, transparent) 14%), color-mix(in srgb, var(--calm-surface-strong, var(--bg2)) 92%, var(--fn-lab-card-accent, var(--green)) 8%)) !important;
}
html.fn-theme-lab-active body .macro-cell-kcal, body.fn-theme-lab-active .macro-cell-kcal { --macro-accent: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important; --badge-accent: var(--fn-macro-kcal, var(--fn-calorie-accent, var(--green))) !important; }
html.fn-theme-lab-active body .macro-cell-prot, body.fn-theme-lab-active .macro-cell-prot { --macro-accent: var(--fn-macro-prot, var(--blue)) !important; --badge-accent: var(--fn-macro-prot, var(--blue)) !important; }
html.fn-theme-lab-active body .macro-cell-gluc, body.fn-theme-lab-active .macro-cell-gluc { --macro-accent: var(--fn-macro-gluc, var(--orange)) !important; --badge-accent: var(--fn-macro-gluc, var(--orange)) !important; }
html.fn-theme-lab-active body .macro-cell-lip, body.fn-theme-lab-active .macro-cell-lip { --macro-accent: var(--fn-macro-lip, #f2cf66) !important; --badge-accent: var(--fn-macro-lip, #f2cf66) !important; }
html.fn-theme-lab-active body .journal-main-macros .macro-cell,
html.fn-theme-lab-active body #page-journal .macro-cell.fn-macro-satellite,
html.fn-theme-lab-active body #page-journal .macro-cell.fn-calorie-ring,
body.fn-theme-lab-active .journal-main-macros .macro-cell,
body.fn-theme-lab-active #page-journal .macro-cell.fn-macro-satellite,
body.fn-theme-lab-active #page-journal .macro-cell.fn-calorie-ring {
  border-color: color-mix(in srgb, var(--macro-accent, var(--green)) var(--fn-home-macro-border-strength, 42%), var(--fn-badge-border, var(--border2))) !important;
  background:
    radial-gradient(circle at 94% 0%, color-mix(in srgb, var(--macro-accent, var(--green)) var(--fn-home-macro-gradient-spot, 38%), transparent) 0, transparent 62%),
    linear-gradient(145deg, color-mix(in srgb, var(--fn-badge-surface-strong, var(--bg2)) 68%, var(--macro-accent, var(--green)) var(--fn-home-macro-gradient-strong, 15%)), color-mix(in srgb, var(--fn-badge-surface, var(--bg2)) 76%, var(--macro-accent, var(--green)) var(--fn-home-macro-gradient-soft, 11%))) !important;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--macro-accent, var(--green)) var(--fn-home-macro-shadow-strength, 13%), transparent) !important;
}
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

body.fn-theme-lab-active .journal-dashboard-badge.macro-kcal,
body.fn-theme-lab-active .recap-badge-compact.macro-kcal,
body.fn-theme-lab-active .fn-smart-chip.macro-kcal,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-kcal { --badge-accent: var(--fn-badge-kcal, var(--fn-macro-kcal, var(--green))) !important; }
html.fn-theme-lab-active body .journal-dashboard-badge.macro-prot,
html.fn-theme-lab-active body .recap-badge-compact.macro-prot,
html.fn-theme-lab-active body .fn-smart-chip.macro-prot,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-macro-prot,
body.fn-theme-lab-active .journal-dashboard-badge.macro-prot,
body.fn-theme-lab-active .recap-badge-compact.macro-prot,
body.fn-theme-lab-active .fn-smart-chip.macro-prot,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-prot { --badge-accent: var(--fn-badge-prot, var(--fn-macro-prot, var(--blue))) !important; }
html.fn-theme-lab-active body .journal-dashboard-badge.macro-gluc,
html.fn-theme-lab-active body .recap-badge-compact.macro-gluc,
html.fn-theme-lab-active body .fn-smart-chip.macro-gluc,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-macro-gluc,
body.fn-theme-lab-active .journal-dashboard-badge.macro-gluc,
body.fn-theme-lab-active .recap-badge-compact.macro-gluc,
body.fn-theme-lab-active .fn-smart-chip.macro-gluc,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-gluc { --badge-accent: var(--fn-badge-gluc, var(--fn-macro-gluc, var(--orange))) !important; }
html.fn-theme-lab-active body .journal-dashboard-badge.macro-lip,
html.fn-theme-lab-active body .recap-badge-compact.macro-lip,
html.fn-theme-lab-active body .fn-smart-chip.macro-lip,
html.fn-theme-lab-active body .fn-ui-smart-badge.fn-ui-macro-lip,
body.fn-theme-lab-active .journal-dashboard-badge.macro-lip,
body.fn-theme-lab-active .recap-badge-compact.macro-lip,
body.fn-theme-lab-active .fn-smart-chip.macro-lip,
body.fn-theme-lab-active .fn-ui-smart-badge.fn-ui-macro-lip { --badge-accent: var(--fn-badge-lip, var(--fn-macro-lip, #f2cf66)) !important; }
html.fn-theme-lab-active body .journal-dashboard-badge,
html.fn-theme-lab-active body .recap-badge-compact,
html.fn-theme-lab-active body .fn-smart-chip,
html.fn-theme-lab-active body .fn-ui-smart-badge,
body.fn-theme-lab-active .journal-dashboard-badge,
body.fn-theme-lab-active .recap-badge-compact,
body.fn-theme-lab-active .fn-smart-chip,
body.fn-theme-lab-active .fn-ui-smart-badge {
  background:
    radial-gradient(circle at 96% 0%, color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-gradient-spot, 38%), transparent) 0, transparent 62%),
    radial-gradient(circle at 4% 0%, rgba(255,255,255,.18) 0, transparent 44%),
    linear-gradient(135deg, color-mix(in srgb, var(--fn-badge-surface-strong, var(--bg2)) 68%, var(--badge-accent, var(--green)) var(--fn-badge-gradient-strong, 15%)), color-mix(in srgb, var(--fn-badge-surface, var(--bg2)) 76%, var(--badge-accent, var(--green)) var(--fn-badge-gradient-soft, 11%))) !important;
  border-color: color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-border-strength, 42%), var(--fn-badge-border, var(--border2))) !important;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-shadow-strength, 13%), transparent), inset 0 1px 0 rgba(255,255,255,.18) !important;
}
html.fn-theme-lab-active body .journal-dashboard-track span,
html.fn-theme-lab-active body .recap-badge-track span,
html.fn-theme-lab-active body .fn-chip-progress i,
html.fn-theme-lab-active body .fn-ui-smart-progress i,
body.fn-theme-lab-active .journal-dashboard-track span,
body.fn-theme-lab-active .recap-badge-track span,
body.fn-theme-lab-active .fn-chip-progress i,
body.fn-theme-lab-active .fn-ui-smart-progress i {
  background: linear-gradient(90deg, color-mix(in srgb, var(--badge-accent, var(--green)) var(--fn-badge-track-strength, 72%), #fff 6%), var(--badge-accent, var(--green))) !important;
}
html.fn-theme-lab-active body .fn-mobile-bottom-nav,
html.fn-theme-lab-active body .mobile-bottom-nav,
html.fn-theme-lab-active body #fn-mobile-bottom-nav,
body.fn-theme-lab-active .fn-mobile-bottom-nav,
body.fn-theme-lab-active .mobile-bottom-nav,
body.fn-theme-lab-active #fn-mobile-bottom-nav {
  color: var(--fn-nav-text, #5f4035) !important;
  border-color: var(--fn-nav-line, #ffb26f) !important;
  background: linear-gradient(135deg, var(--fn-nav-surface, #fff1dc), var(--fn-nav-surface-2, #ffe2c2)) !important;
}
html.fn-theme-lab-active body .fn-mobile-nav-plus,
html.fn-theme-lab-active body .mobile-bottom-nav-plus,
html.fn-theme-lab-active body [data-mobile-nav-plus],
body.fn-theme-lab-active .fn-mobile-nav-plus,
body.fn-theme-lab-active .mobile-bottom-nav-plus,
body.fn-theme-lab-active [data-mobile-nav-plus] {
  color: var(--fn-nav-plus-text, #5f2448) !important;
  background: linear-gradient(135deg, var(--fn-nav-coral, #ff8a72), var(--fn-nav-magenta, #d77ab7)) !important;
}
html.fn-theme-lab-active body .food-add-dialog,
html.fn-theme-lab-active body #food-add-modal .food-add-dialog,
body.fn-theme-lab-active .food-add-dialog,
body.fn-theme-lab-active #food-add-modal .food-add-dialog {
  border-color: var(--fn-add-line, var(--border2)) !important;
  background: linear-gradient(180deg, var(--fn-add-surface, var(--bg2)), var(--fn-add-card, var(--card))) !important;
}
html.fn-theme-lab-active body #page-objectif .profile-summary-main,
html.fn-theme-lab-active body #page-objectif .objectif-method-card,
html.fn-theme-lab-active body #page-objectif .stats-commercial-card,
html.fn-theme-lab-active body #page-objectif .fn-ui-program-panel,
body.fn-theme-lab-active #page-objectif .profile-summary-main,
body.fn-theme-lab-active #page-objectif .objectif-method-card,
body.fn-theme-lab-active #page-objectif .stats-commercial-card,
body.fn-theme-lab-active #page-objectif .fn-ui-program-panel {
  border-color: color-mix(in srgb, var(--fn-energy-green, var(--green)) 28%, var(--border2)) !important;
  background:
    radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--fn-energy-green, var(--green)) 16%, transparent), transparent 42%),
    linear-gradient(145deg, color-mix(in srgb, var(--fn-ui-surface, var(--bg2)) 86%, var(--fn-energy-orange, var(--orange)) 8%), color-mix(in srgb, var(--fn-ui-surface-2, var(--bg2)) 86%, var(--fn-energy-green, var(--green)) 7%)) !important;
}
/* beta 0.22.51 — Theme Lab : pont global badges / accueil / pages déjà ouvertes */
html.fn-theme-lab-active body #journal-dashboard-badges .journal-dashboard-badge.macro-kcal,
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

#foodnote-theme-lab-debug {
  position: fixed; right: 10px; bottom: 10px; z-index: 20000;
  max-width: min(360px, calc(100vw - 20px)); padding: 10px 12px;
  border-radius: 16px; border: 1px solid rgba(255,255,255,.25);
  background: rgba(15,18,16,.86); color: #f5f7f2; font: 12px/1.35 system-ui, sans-serif;
  box-shadow: 0 12px 32px rgba(0,0,0,.35); backdrop-filter: blur(10px);
}
#foodnote-theme-lab-debug b { display:block; margin-bottom: 3px; }
#foodnote-theme-lab-debug code { color:#ffcf88; }


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
  function writeVarsStyle(values, active) {
    const style = ensureVarsStyle();
    const data = withDerivedThemeValues(values && typeof values === 'object' ? values : {});
    if (!active || !Object.keys(data).length) { style.textContent = ''; return; }
    const rows = Object.entries(data)
      .filter(([key, value]) => String(key || '').startsWith('--') && String(value ?? '').trim())
      .map(([key, value]) => `  ${key}: ${safeCssValue(value)} !important;`)
      .join('\n');
    style.textContent = `/* FoodNote Theme Lab variables */\n:root, html.fn-theme-lab-active, body.fn-theme-lab-active {\n${rows}\n}\n`;
  }
  function setInlineVars(values, active) {
    const data = values && typeof values === 'object' ? values : {};
    Object.entries(data).forEach(([key, value]) => {
      if (!String(key || '').startsWith('--')) return;
      const v = String(value ?? '').trim();
      if (!v) return;
      document.documentElement.style.setProperty(key, v);
      if (document.body) document.body.style.setProperty(key, v);
    });
    document.documentElement.classList.toggle('fn-theme-lab-active', !!active);
    if (document.body) document.body.classList.toggle('fn-theme-lab-active', !!active);
  }
  function clearInlineVars(keys) {
    (keys || []).forEach(key => {
      if (!String(key || '').startsWith('--')) return;
      document.documentElement.style.removeProperty(key);
      if (document.body) document.body.style.removeProperty(key);
    });
  }
  function allCurrentKeys() { return Object.keys(readValues()).filter(k => String(k).startsWith('--')); }
  function apply(values, active, options) {
    const data = withDerivedThemeValues(values && typeof values === 'object' ? values : readValues());
    const isOn = typeof active === 'boolean' ? active : isActive();
    ensureBridgeStyle();
    ensureHomeNutritionReferenceStyle();
    if (isOn) {
      writeVarsStyle(data, true);
      setInlineVars(data, true);
    } else {
      clearInlineVars(allCurrentKeys());
      writeVarsStyle({}, false);
      document.documentElement.classList.remove('fn-theme-lab-active');
      if (document.body) document.body.classList.remove('fn-theme-lab-active');
    }
    lastApplyAt = Date.now();
    lastReason = (options && options.reason) || lastReason || 'apply';
    lastKeys = Object.keys(data || {});
    updateDebug();
    try { window.dispatchEvent(new CustomEvent('foodnote-theme-lab-runtime-applied', {detail: status()})); } catch(e) {}
    return status();
  }
  function pull(reason) { return apply(readValues(), isActive(), {reason: reason || 'pull'}); }
  function publish(reason) {
    const payload = { type:'foodnote-theme-lab-sync', source:CLIENT_ID, build:BUILD, reason:reason || 'publish', active:isActive(), values:readValues(), ts:Date.now() };
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(payload)); } catch(e) {}
    try { if (channel) channel.postMessage(payload); } catch(e) {}
    return payload;
  }
  function receive(payload, source) {
    if (!payload || payload.type !== 'foodnote-theme-lab-sync') return;
    if (payload.source === CLIENT_ID) return;
    const token = `${payload.source || ''}:${payload.ts || ''}:${payload.reason || ''}`;
    if (token === lastToken) return;
    lastToken = token;
    if (payload.values && typeof payload.values === 'object') writeValues(payload.values);
    if (typeof payload.active === 'boolean') setActive(payload.active);
    apply(payload.values || readValues(), !!payload.active, {reason: source || payload.reason || 'receive'});
  }
  function setupChannel() {
    try {
      if ('BroadcastChannel' in window) {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (ev) => receive(ev.data, 'broadcast');
      }
    } catch(e) { channel = null; }
    window.addEventListener('storage', (ev) => {
      if (!ev || ![STORAGE_KEY, ACTIVE_KEY, SYNC_KEY].includes(ev.key)) return;
      if (ev.key === SYNC_KEY) receive(parse(ev.newValue, null), 'storage-sync');
      else pull('storage');
    });
    window.addEventListener('focus', () => pull('focus'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull('visible'); });
    window.addEventListener('foodnote-ui-rendered', (ev) => {
      const src = ev && ev.detail && ev.detail.source ? ev.detail.source : 'ui-rendered';
      requestAnimationFrame(() => pull('ui:' + src));
    });
  }
  function status() {
    return {
      build: BUILD,
      clientId: CLIENT_ID,
      activeStored: isActive(),
      activeHtml: document.documentElement.classList.contains('fn-theme-lab-active'),
      activeBody: !!(document.body && document.body.classList.contains('fn-theme-lab-active')),
      values: Object.keys(readValues()).length,
      lastApplyAt,
      lastReason,
      lastKeys: lastKeys.slice(0, 20),
      origin: location.origin,
      url: location.href
    };
  }
  function updateDebug() {
    if (!debugEnabled()) {
      const existing = document.getElementById('foodnote-theme-lab-debug');
      if (existing) existing.remove();
      if (debugPanel) debugPanel.remove();
      debugPanel = null;
      return;
    }
    if (!debugPanel) {
      debugPanel = document.createElement('div');
      debugPanel.id = 'foodnote-theme-lab-debug';
      document.body ? document.body.appendChild(debugPanel) : document.documentElement.appendChild(debugPanel);
    }
    const st = status();
    debugPanel.textContent = `ThemeLab Runtime\nactif: ${st.activeStored ? 'oui' : 'non'} · vars: ${st.values}\nraison: ${st.lastReason}\norigine: ${st.origin}`;
  }
  function showDebug(on) { updateDebug(); return status(); }
  function hideDebug() { try { localStorage.removeItem(DEBUG_KEY); } catch(e) {} if (debugPanel) debugPanel.remove(); debugPanel = null; return status(); }

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
    ensureBridgeStyle();
    setupChannel();
    pull('init');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { pull('dom'); updateDebug(); }, {once:true});
    else updateDebug();
  }

  window.FoodNoteThemeLabRuntime = {
    apply,
    pull,
    publish,
    status,
    showDebug,
    hideDebug,
    refresh(reason='manual-refresh') { return pull(reason); },
    setValues(values, active=true) { writeValues(values || {}); setActive(!!active); apply(values || {}, !!active, {reason:'setValues'}); publish('setValues'); return status(); }
  };
  init();
})();
