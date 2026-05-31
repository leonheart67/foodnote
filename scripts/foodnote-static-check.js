#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const INDEX = path.join(PUBLIC, 'index.html');
const JS_DIR = path.join(PUBLIC, 'assets', 'js');
const CSS_DIR = path.join(PUBLIC, 'assets', 'css');
const IMG_DIR = path.join(PUBLIC, 'assets', 'img');

const errors = [];
const warnings = [];

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function exists(file, label) {
  if (!fs.existsSync(file)) errors.push(`${label || rel(file)} introuvable`);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, ext, out);
    else if (!ext || file.endsWith(ext)) out.push(file);
  }
  return out;
}

function checkJsSyntax() {
  const files = [path.join(ROOT, 'server.js'), ...walk(JS_DIR, '.js')].filter(fs.existsSync);
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (e) {
      const out = String(e.stderr || e.stdout || e.message || '');
      errors.push(`Syntaxe JS invalide: ${rel(file)}\n${out}`);
    }
  }
}

function extractLocalRefs(html, tag, attr) {
  const refs = [];
  const re = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["'][^>]*>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    let src = m[1];
    if (!src || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue;
    src = src.split('?')[0].replace(/^\.\//, '');
    if (src.startsWith('/vendor/')) continue; // servi par Express depuis node_modules
    if (src.startsWith('/')) src = src.slice(1);
    refs.push(src);
  }
  return refs;
}

function extractDeferredRefs(html) {
  const refs = [];
  const deferredBlock = html.match(/const\s+deferred\s*=\s*\[([\s\S]*?)\];/);
  if (!deferredBlock) return refs;
  const re = /['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(deferredBlock[1]))) {
    let src = m[1];
    if (src.startsWith('/vendor/')) continue;
    src = src.split('?')[0].replace(/^\.\//, '');
    if (src.startsWith('/')) src = src.slice(1);
    refs.push(src);
  }
  return refs;
}

function checkIndexRefs() {
  exists(INDEX, 'public/index.html');
  if (!fs.existsSync(INDEX)) return;
  const html = read(INDEX);
  const refs = [
    ...extractLocalRefs(html, 'script', 'src'),
    ...extractLocalRefs(html, 'link', 'href'),
    ...extractDeferredRefs(html)
  ];
  for (const ref of refs) {
    if (!ref.startsWith('assets/') && ref !== 'favicon.ico') continue;
    exists(path.join(PUBLIC, ref), ref);
  }

  const localScripts = extractLocalRefs(html, 'script', 'src').filter(s => s.startsWith('assets/js/'));
  const count = new Map();
  for (const s of localScripts) count.set(s, (count.get(s) || 0) + 1);
  for (const [s, n] of count) {
    if (n > 1) warnings.push(`Script local chargé ${n} fois: ${s}`);
  }

  if (!html.includes('00-foodnote-smoke-tests.js')) {
    errors.push('Harnais navigateur non chargé: 00-foodnote-smoke-tests.js');
  }
}


function normalizePublicRef(src) {
  if (!src) return null;
  src = String(src).trim();
  if (!src || src.startsWith('#')) return null;
  if (/^(?:https?:|data:|blob:|mailto:|tel:)/i.test(src)) return null;
  src = src.split('?')[0].split('#')[0].replace(/^\.\//, '');
  if (src.startsWith('/')) src = src.slice(1);
  if (src.startsWith('public/')) src = src.slice('public/'.length);
  return src || null;
}

function collectIndexRefs(html) {
  const refs = new Set();
  for (const ref of [
    ...extractLocalRefs(html, 'script', 'src'),
    ...extractLocalRefs(html, 'link', 'href'),
    ...extractLocalRefs(html, 'img', 'src'),
    ...extractDeferredRefs(html)
  ]) {
    const normalized = normalizePublicRef(ref);
    if (normalized) refs.add(normalized);
  }

  // Thèmes chargés dynamiquement par applyTheme()/bootstrap thème.
  if (html.includes('style-') && html.includes('.css')) {
    refs.add('assets/css/style-dark.css');
    refs.add('assets/css/style-light.css');
  }
  return refs;
}

function collectCssUrlRefs(cssFile) {
  const refs = new Set();
  if (!fs.existsSync(cssFile)) return refs;
  const css = read(cssFile);
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(css))) {
    const raw = normalizePublicRef(m[1]);
    if (!raw) continue;
    let resolved;
    if (raw.startsWith('assets/')) resolved = raw;
    else resolved = path.relative(PUBLIC, path.resolve(path.dirname(cssFile), raw)).replace(/\\/g, '/');
    if (resolved && !resolved.startsWith('..')) refs.add(resolved);
  }
  return refs;
}

function checkAssetInventory() {
  if (!fs.existsSync(INDEX)) return;
  const html = read(INDEX);
  const refs = collectIndexRefs(html);

  for (const cssFile of walk(CSS_DIR, '.css')) {
    for (const cssRef of collectCssUrlRefs(cssFile)) refs.add(cssRef);
  }

  const scanned = [
    ...walk(JS_DIR, '.js'),
    ...walk(CSS_DIR, '.css'),
    ...walk(IMG_DIR)
  ].filter(fs.existsSync);

  for (const file of scanned) {
    const publicRel = rel(file).replace(/^public\//, '');
    if (!refs.has(publicRel)) {
      errors.push(`Asset non référencé ou non déclaré: ${publicRel}`);
    }
  }
}

function checkCaptureContracts() {
  const capture = path.join(JS_DIR, '94-capture-workflow-core.js');
  exists(capture, rel(capture));
  if (!fs.existsSync(capture)) return;
  const code = read(capture);
  const required = [
    'window.FoodNoteCapture',
    'MODES.NUTRITION_TABLE',
    'MODES.RECIPE',
    'MODES.IA_TEXT',
    'STATES.PHOTO_CAPTURE',
    'STATES.CROP',
    'parseNutritionRows',
    'confirmWithMeal'
  ];
  for (const token of required) {
    if (!code.includes(token)) errors.push(`Contrat capture absent: ${token}`);
  }
}

function checkDeleteContracts() {
  const storage = path.join(JS_DIR, '70-history-export-storage.js');
  const nutrition = path.join(JS_DIR, '30-nutrition-foods.js');
  for (const f of [storage, nutrition]) exists(f, rel(f));
  if (fs.existsSync(storage)) {
    const s = read(storage);
    for (const token of ['deleteEntryFoodNative', 'deleteEntryFoodNativeByLineUid']) {
      if (!s.includes(token)) errors.push(`Contrat suppression absent dans 70: ${token}`);
    }
  }
  if (fs.existsSync(nutrition)) {
    const s = read(nutrition);
    for (const token of ['deleteFoodLineOnServerByIdentity', 'deleteAfterPendingWrite']) {
      if (!s.includes(token)) errors.push(`Contrat suppression absent dans 30: ${token}`);
    }
  }
}

function checkCss() {
  exists(path.join(CSS_DIR, 'style-dark.css'), 'CSS thème sombre dynamique');
  exists(path.join(CSS_DIR, 'style-light.css'), 'CSS thème clair dynamique');
  exists(path.join(CSS_DIR, '94-capture-workflow-core.css'), 'CSS capture');
  exists(path.join(CSS_DIR, '31-mobile-bottom-nav.css'), 'CSS bottom nav mobile');

  if (fs.existsSync(INDEX)) {
    const html = read(INDEX);
    if (html.includes('style-' + "' + theme + '" + '.css') || html.includes('style-' + ' + theme + ' + '.css')) {
      for (const theme of ['dark', 'light']) {
        exists(path.join(CSS_DIR, `style-${theme}.css`), `CSS thème ${theme} requis par applyTheme()`);
      }
    }
  }
}


function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) scripts.push(m[1] || '');
  return scripts;
}

function checkDiagnosticFallbackScope() {
  if (!fs.existsSync(INDEX)) return;
  const html = read(INDEX);
  const fallbackScript = extractInlineScripts(html).find(code => code.includes('hardening_module_not_loaded_or_cached_index'));
  if (!fallbackScript) {
    errors.push('Fallback FoodAddHealth absent dans index.html');
    return;
  }
  if (fallbackScript.includes('version: BUILD') && !/\b(?:const|let|var)\s+BUILD\s*=/.test(fallbackScript)) {
    errors.push('Fallback FoodAddHealth utilise BUILD sans constante locale autonome');
  }
  if (!fallbackScript.includes('window.FoodAddHealth')) {
    errors.push('Fallback FoodAddHealth ne publie pas window.FoodAddHealth');
  }
}

function checkBuildMetadata() {
  const pkgFile = path.join(ROOT, 'package.json');
  const versionFile = path.join(ROOT, 'VERSION.txt');
  exists(pkgFile, 'package.json');
  exists(versionFile, 'VERSION.txt');
  if (!fs.existsSync(pkgFile) || !fs.existsSync(versionFile) || !fs.existsSync(INDEX)) return;

  let pkg;
  try { pkg = JSON.parse(read(pkgFile)); }
  catch(e) { errors.push('package.json invalide: ' + e.message); return; }

  const version = String(pkg.version || '').trim();
  if (!version) errors.push('Version package.json absente');

  const versionTxt = read(versionFile);
  const html = read(INDEX);
  const versionToken = version.replace(/\./g, '_');

  if (version && !versionTxt.includes(version)) {
    errors.push(`VERSION.txt ne correspond pas à package.json (${version})`);
  }
  if (version && !html.includes(`foodnote_beta_${versionToken}`)) {
    errors.push(`Cache-buster index absent ou incohérent pour ${version}`);
  }
  if (version && !html.includes(`<title>FoodNote beta ${version}</title>`)) {
    errors.push(`Titre index incohérent avec package.json (${version})`);
  }

  const staleDiagnostics = [
    'foodnote_beta_0_22_111_hardening_global_fix_20260529',
    'foodnote_beta_0_22_117_journal_add_real_freeze_fix_20260529',
    '0.22.135'
  ];
  for (const token of staleDiagnostics) {
    if (html.includes(token)) errors.push(`Diagnostic index obsolète détecté: ${token}`);
  }

  const hardening = path.join(JS_DIR, '101-food-add-hardening-checkpoint.js');
  exists(hardening, rel(hardening));
  if (fs.existsSync(hardening)) {
    const code = read(hardening);
    if (!code.includes(`foodnote_beta_${versionToken}`)) {
      errors.push(`Version du diagnostic 101 incohérente avec package.json (${version})`);
    }
    for (const token of staleDiagnostics) {
      if (code.includes(token)) errors.push(`Diagnostic 101 obsolète détecté: ${token}`);
    }
  }
}

function checkRuntimeMetadata() {
  const pkgFile = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgFile)) return;
  let pkg;
  try { pkg = JSON.parse(read(pkgFile)); }
  catch(e) { return; }
  const version = String(pkg.version || '').trim();
  if (!version) return;
  const versionToken = version.replace(/\./g, '_');
  const expectedBuildPrefix = `foodnote_beta_${versionToken}`;

  const server = path.join(ROOT, 'server.js');
  exists(server, 'server.js');
  if (fs.existsSync(server)) {
    const code = read(server);
    if (!code.includes(`const APP_VERSION = '${version}';`)) {
      errors.push(`server.js APP_VERSION incohérent avec package.json (${version})`);
    }
    if (!code.includes(`FoodNote beta ${version}`)) {
      errors.push(`server.js APP_LABEL incohérent avec package.json (${version})`);
    }
    const buildMatch = code.match(/const\s+APP_BUILD\s*=\s*'([^']+)'/);
    if (!buildMatch || !buildMatch[1].startsWith(expectedBuildPrefix)) {
      errors.push(`server.js APP_BUILD incohérent avec package.json (${version})`);
    }
  }

  const diagnostics = path.join(JS_DIR, '90-diagnostics.js');
  exists(diagnostics, rel(diagnostics));
  if (fs.existsSync(diagnostics)) {
    const code = read(diagnostics);
    if (!code.includes(`const VERSION = '${version}';`)) {
      errors.push(`90-diagnostics.js VERSION incohérent avec package.json (${version})`);
    }
    if (!code.includes(`const LABEL = 'FoodNote beta ${version}';`)) {
      errors.push(`90-diagnostics.js LABEL incohérent avec package.json (${version})`);
    }
    const buildMatch = code.match(/const\s+BUILD\s*=\s*'([^']+)'/);
    if (!buildMatch || !buildMatch[1].startsWith(expectedBuildPrefix)) {
      errors.push(`90-diagnostics.js BUILD incohérent avec package.json (${version})`);
    }
  }
}


function checkDeploymentMetadata() {
  const pkgFile = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgFile)) return;
  let pkg;
  try { pkg = JSON.parse(read(pkgFile)); }
  catch(e) { return; }
  const version = String(pkg.version || '').trim();
  if (!version) return;

  const readme = path.join(ROOT, 'README.md');
  const compose = path.join(ROOT, 'docker-compose.yml');
  const envExample = path.join(ROOT, '.env.example');
  exists(readme, 'README.md');
  exists(compose, 'docker-compose.yml');
  exists(envExample, '.env.example');

  if (fs.existsSync(readme)) {
    const txt = read(readme);
    if (!txt.startsWith(`# FoodNote beta ${version}`)) {
      errors.push(`README.md incohérent avec package.json (${version})`);
    }
  }

  function checkDeploymentFile(file, label) {
    if (!fs.existsSync(file)) return;
    const txt = read(file);
    const imageMatches = [...txt.matchAll(/foodnote:([0-9]+\.[0-9]+\.[0-9]+)/g)].map(m => m[1]);
    for (const found of imageMatches) {
      if (found !== version) errors.push(`${label} image FoodNote incohérente: ${found} au lieu de ${version}`);
    }
    const labelMatches = [...txt.matchAll(/FOODNOTE_APP_LABEL=FoodNote beta ([0-9]+\.[0-9]+\.[0-9]+)/g)].map(m => m[1]);
    for (const found of labelMatches) {
      if (found !== version) errors.push(`${label} FOODNOTE_APP_LABEL incohérent: ${found} au lieu de ${version}`);
    }
  }

  checkDeploymentFile(compose, 'docker-compose.yml');
  checkDeploymentFile(envExample, '.env.example');
}


function checkStartupCiqualMetadata() {
  const pkgFile = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgFile)) return;
  let pkg;
  try { pkg = JSON.parse(read(pkgFile)); }
  catch(e) { return; }
  const version = String(pkg.version || '').trim();
  if (!version) return;

  const start = path.join(ROOT, 'start.sh');
  const downloader = path.join(ROOT, 'download_ciqual.py');
  exists(start, 'start.sh');
  exists(downloader, 'download_ciqual.py');

  if (fs.existsSync(start)) {
    const txt = read(start);
    if (!txt.includes(`FOODNOTE_IMAGE:=foodnote:${version}`)) {
      errors.push(`start.sh FOODNOTE_IMAGE par défaut incohérent avec package.json (${version})`);
    }
    const imageMatches = [...txt.matchAll(/foodnote:([0-9]+\.[0-9]+\.[0-9]+)/g)].map(m => m[1]);
    for (const found of imageMatches) {
      if (found !== version) errors.push(`start.sh référence image FoodNote obsolète: ${found} au lieu de ${version}`);
    }
    if (!txt.includes('${FOODNOTE_IMAGE} sh -lc')) {
      errors.push('start.sh commande aide CIQUAL ne réutilise pas ${FOODNOTE_IMAGE}');
    }
  }

  if (fs.existsSync(downloader)) {
    const txt = read(downloader);
    if (!txt.includes(`FoodNote-CIQUAL/${version}`)) {
      errors.push(`download_ciqual.py User-Agent incohérent avec package.json (${version})`);
    }
  }

  const server = path.join(ROOT, 'server.js');
  if (fs.existsSync(server)) {
    const code = read(server);
    const releaseMatch = code.match(/const\s+APP_RELEASE\s*=\s*'([^']+)'/);
    if (!releaseMatch || !String(releaseMatch[1] || '').trim()) {
      errors.push('server.js APP_RELEASE absent ou vide');
    }
  }
}

function checkModuleRuntimeMetadata() {
  const pkgFile = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgFile)) return;
  let pkg;
  try { pkg = JSON.parse(read(pkgFile)); }
  catch(e) { return; }
  const version = String(pkg.version || '').trim();
  if (!version) return;
  const expectedBuildPrefix = `foodnote_beta_${version.replace(/\./g, '_')}`;

  for (const file of walk(JS_DIR, '.js')) {
    const code = read(file);
    const jsRel = rel(file);

    const literalMeta = /const\s+(BUILD|VERSION|CORE)\s*=\s*(?:window\.FOODNOTE_BUILD\s*\|\|\s*)?'([^']+)'/g;
    let m;
    while ((m = literalMeta.exec(code))) {
      const name = m[1];
      const value = m[2];
      if (value.includes('foodnote_beta_') && !value.startsWith(expectedBuildPrefix)) {
        errors.push(`${jsRel} ${name} incohérent avec package.json (${version}): ${value}`);
      }
      if (/^0\.22\.|^0\.21\./.test(value) && value !== version) {
        errors.push(`${jsRel} ${name} version courte obsolète: ${value}`);
      }
    }
  }

  const ui = path.join(JS_DIR, '05-ui-components.js');
  if (fs.existsSync(ui)) {
    const code = read(ui);
    if (!code.includes(`version:'${version}'`)) {
      errors.push(`05-ui-components.js version FoodNoteUI incohérente avec package.json (${version})`);
    }
  }

  const capture = path.join(JS_DIR, '94-capture-workflow-core.js');
  if (fs.existsSync(capture)) {
    const code = read(capture);
    if (!code.includes(`<span class="capture-version">${version}</span>`)) {
      errors.push(`94-capture-workflow-core.js badge capture-version incohérent avec package.json (${version})`);
    }
  }

  const recipes = path.join(JS_DIR, '92-recipes.js');
  if (fs.existsSync(recipes)) {
    const code = read(recipes);
    if (!code.includes(`FoodNote beta ${version}`)) {
      errors.push(`92-recipes.js badge recette incohérent avec package.json (${version})`);
    }
  }
}



function checkJournalMutationRefreshCore() {
  const nutrition = path.join(JS_DIR, '30-nutrition-foods.js');
  const history = path.join(JS_DIR, '70-history-export-storage.js');
  exists(nutrition, rel(nutrition));
  exists(history, rel(history));
  if (!fs.existsSync(nutrition)) return;
  const code = read(nutrition);
  const required = [
    'function foodnoteSafeViewCall',
    'function foodnotePageIsActive',
    'function foodnoteRefreshJournalMutationViews',
    'window.foodnoteRefreshJournalMutationViews = foodnoteRefreshJournalMutationViews',
    'function refreshFoodnoteStatsAfterJournalMutation',
    "foodnoteRefreshJournalMutationViews('post-delete'",
    "foodnoteRefreshJournalMutationViews('server-food-save'",
    "foodnoteRefreshJournalMutationViews('entry-save'",
    "foodnoteRefreshJournalMutationViews('sport-save'",
    "foodnoteRefreshJournalMutationViews('food-edit-save'",
    'stats: false',
    'sportSummary: false',
    'quickFoods: false',
    'phaseMini: false',
    "if (opts.sportSummary) foodnoteSafeViewCall('renderSportPageSummary'",
    "if (opts.quickFoods) foodnoteSafeViewCall('renderQuickFoods'",
    "if (opts.phaseMini) foodnoteSafeViewCall('renderJournalPhaseMini'",
    'if (opts.stats) refreshFoodnoteStatsAfterJournalMutation()'
  ];
  for (const token of required) {
    if (!code.includes(token)) errors.push(`Rafraîchissement centralisé journal absent: ${token}`);
  }

  const forbiddenNutrition = [
    "try { if (typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods(); } catch(e) {}",
    "try { if (typeof renderJournalDayCarousel === 'function') renderJournalDayCarousel(); } catch(e) {}"
  ];
  for (const token of forbiddenNutrition) {
    if (code.includes(token)) errors.push(`Ancien rafraîchissement direct encore présent dans 30: ${token}`);
  }

  const smoke = path.join(JS_DIR, '00-foodnote-smoke-tests.js');
  exists(smoke, rel(smoke));
  if (fs.existsSync(smoke)) {
    const sm = read(smoke);
    for (const token of [
      "check('Refresh journal centralisé'",
      "check('Refresh stats centralisé'",
      "check('Refresh récap centralisé'"
    ]) {
      if (!sm.includes(token)) errors.push(`Smoke test refresh absent: ${token}`);
    }
  }

  if (fs.existsSync(history)) {
    const h = read(history);
    if (!h.includes("foodnoteRefreshJournalMutationViews('history-hydration'")) {
      errors.push('Hydratation historique ne passe pas par foodnoteRefreshJournalMutationViews');
    }
    if (!h.includes('{ recap:true, stats:true }')) {
      errors.push('Hydratation historique ne demande pas recap+stats via le noyau central');
    }
    if (!h.includes("foodnoteRefreshJournalMutationViews('entry-edit-open'")) {
      errors.push('Ouverture édition historique ne passe pas par foodnoteRefreshJournalMutationViews');
    }
    const forbiddenHistory = [
      "try { if (typeof renderRecap === 'function'",
      "try { if (typeof renderStats === 'function'"
    ];
    for (const token of forbiddenHistory) {
      if (h.includes(token)) errors.push(`Ancien rafraîchissement direct encore présent dans 70: ${token}`);
    }
  }

  const onboarding = path.join(JS_DIR, '80-stats-onboarding-init.js');
  exists(onboarding, rel(onboarding));
  if (fs.existsSync(onboarding)) {
    const o = read(onboarding);
    for (const token of [
      "foodnoteRefreshJournalMutationViews('journal-open-today'",
      "foodnoteRefreshJournalMutationViews('journal-date-select'",
      "foodnoteRefreshJournalMutationViews('sport-date-select'"
    ]) {
      if (!o.includes(token)) errors.push(`Sélection date non centralisée dans 80: ${token}`);
    }
    for (const token of [
      "journal-date-select', { journalCarousel:true, sportCarousel:true, quickFoods:true }",
      "sport-date-select', { sportSummary:true, sportCarousel:true, journalCarousel:true }",
      "journal-open-today', { journalCarousel:true, phaseMini:true }"
    ]) {
      if (!o.includes(token)) errors.push(`Options refresh date incomplètes dans 80: ${token}`);
    }
  }
}

function checkBarcodeVendorGuard() {
  const pkgFile = path.join(ROOT, 'package.json');
  const vendorFile = path.join(PUBLIC, 'vendor', 'html5-qrcode.min.js');
  const server = path.join(ROOT, 'server.js');
  const start = path.join(ROOT, 'start.sh');

  exists(vendorFile, 'vendor code-barres html5-qrcode.min.js');
  if (fs.existsSync(vendorFile)) {
    const size = fs.statSync(vendorFile).size;
    if (size < 100000) errors.push(`vendor html5-qrcode.min.js anormalement petit (${size} octets)`);
  }

  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(read(pkgFile));
      const deps = Object.assign({}, pkg.dependencies || {}, pkg.optionalDependencies || {});
      if (!deps['html5-qrcode']) errors.push('package.json ne déclare pas html5-qrcode pour le fallback code-barres');
    } catch (e) {
      // checkBuildMetadata signale déjà package.json invalide.
    }
  }

  if (fs.existsSync(INDEX)) {
    const html = read(INDEX);
    if (!html.includes("'/vendor/html5-qrcode.min.js'") && !html.includes('"/vendor/html5-qrcode.min.js"')) {
      errors.push('index.html ne charge pas le vendor html5-qrcode dans les modules différés');
    }
    if (!/s\.src\s*=\s*src\s*\+\s*'\?v='\s*\+\s*BUILD/.test(html)) {
      errors.push('chargeur différé index.html ne cache-buste pas les vendors/modules avec BUILD');
    }
  }

  if (fs.existsSync(server)) {
    const code = read(server);
    if (!code.includes("app.get('/vendor/html5-qrcode.min.js'")) {
      errors.push('server.js ne déclare pas la route locale /vendor/html5-qrcode.min.js');
    }
    if (!code.includes("path.join(PUBLIC_DIR, 'vendor', 'html5-qrcode.min.js')")) {
      errors.push('server.js ne priorise pas public/vendor/html5-qrcode.min.js');
    }
    if (!code.includes("path.join('/srv', 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js')")) {
      errors.push('server.js ne garde pas le fallback /srv/node_modules/html5-qrcode');
    }
  }

  if (fs.existsSync(start)) {
    const txt = read(start);
    if (!txt.includes("require('html5-qrcode')")) {
      errors.push('start.sh ne vérifie pas le module html5-qrcode au démarrage');
    }
    if (!txt.includes("'html5-qrcode'")) {
      errors.push('start.sh ne journalise pas le diagnostic html5-qrcode');
    }
  }
}



function checkQuantitySelectorPersistence() {
  const nutrition = path.join(JS_DIR, '30-nutrition-foods.js');
  exists(nutrition, rel(nutrition));
  if (!fs.existsSync(nutrition)) return;
  const code = read(nutrition);
  for (const token of [
    'let dbQuantityLastValue = 100',
    'let dbQuantityDefaultAtOpen = 100',
    'let dbQuantityUserValue = null',
    'let dbQuantityUserTouchedAt = 0',
    'let dbQuantityUserEditValue = null',
    'let dbQuantityUserEditAt = 0',
    'function foodnoteRecordDBQuantityUserEdit',
    'function foodnoteGetLastDBQuantityUserEdit',
    'function dbQuantityRememberValue',
    'function dbQuantityResetMemory',
    'function bindDBQuantityPanelEvents',
    'function bindDBLegacyQtyInputSync',
    'function installDBQuantityUserEditCapture',
    "document.addEventListener('change', capture, true)",
    "document.addEventListener('change', sync, true)",
    "source:'legacy-db-qty'",
    "panel.dataset.foodnoteQuantityValue = String(qty)",
    'if (dbQuantityMeta) dbQuantityMeta.qty = qty',
    'const activeValue = active === input ? inputRaw',
    "panel.addEventListener('change', sync, true)",
    'dbQuantityLastTouchedAt && lastRaw != null',
    'dbQuantityUserTouchedAt >= dbQuantityOpenedAt',
    'window.__foodnoteDbQuantityUserValue = qty',
    'const domCandidates = [',
    'const changed = domCandidates.filter',
    'window.__foodnoteDbQuantityFinalValue = qty',
    'window.__foodnoteDbQuantityUserEditValue = qty',
    'window.__foodnoteDbQuantityOpenedAt = dbQuantityOpenedAt',
    'markDBSuggestionPicked(index)',
    'function installDBSuggestionDirectPickGuard',
    "document.addEventListener('pointerdown', handle, true)",
    'keepSuggestions: true',
    "source:'quantity-open-init'",
    'function foodnoteApplySelectedSearchFoodToInput',
    "input.setAttribute('value', name)",
    'input.dataset.foodnoteSelectedName = name',
    'const defaultQty = dbQuantityNormalizeValue(food, meta.qty ?? qtyForSelectedFood(food)',
    'function keepDBSuggestionsVisibleAfterPick',
    'function shouldKeepDBSuggestionsVisible',
    'window.foodnoteShouldKeepDBSuggestionsVisible = shouldKeepDBSuggestionsVisible',
    'window.foodnoteKeepDBSuggestionsVisibleAfterPick = keepDBSuggestionsVisibleAfterPick',
    "box.dataset.foodnoteKeepVisible = '1'",
    'function clearDBSuggestionsKeepVisibleFlag'
  ]) {
    if (!code.includes(token)) errors.push(`Isolation quantité sélection absente: ${token}`);
  }
}


function checkSearchSuggestionVisibilityGuard() {
  const capture = path.join(JS_DIR, '94-capture-workflow-core.js');
  const controller = path.join(JS_DIR, '96-food-add-modal-controller.js');
  const init = path.join(JS_DIR, '80-stats-onboarding-init.js');
  const css = path.join(CSS_DIR, '96-food-add-modal-controller.css');
  for (const file of [capture, controller, init, css]) exists(file, rel(file));
  if (fs.existsSync(capture)) {
    const code = read(capture);
    for (const token of [
      'function installLegacySearchSuggestionGuard',
      'document.__foodnoteCaptureLegacySearchSuggestionGuard',
      'window.pickDBSuggestion(index, { keepSuggestions:true',
      'function preserveLegacySearchSuggestions',
      'legacySearchSuggestionKeepActive()',
      "if (id === 'db-suggestions' && legacySearchSuggestionKeepActive())"
    ]) {
      if (!code.includes(token)) errors.push(`Garde 94 suggestions recherche absent: ${token}`);
    }
  }
  if (fs.existsSync(controller)) {
    const code = read(controller);
    for (const token of [
      'function keepSearchSuggestionsVisible',
      'function restoreSearchSuggestionsVisibility',
      "selector === '#db-suggestions' && keepSearchSuggestionsVisible()",
      'if (keepSearchSuggestionsVisible()) {',
      "action-search-pick-keep-suggestions"
    ]) {
      if (!code.includes(token)) errors.push(`Garde contrôleur suggestions absent: ${token}`);
    }
  }
  if (fs.existsSync(init)) {
    const code = read(init);
    if (!code.includes('window.foodnoteShouldKeepDBSuggestionsVisible')) {
      errors.push('Click-outside historique ferme encore les suggestions malgré le lock de sélection');
    }
  }
  if (fs.existsSync(css)) {
    const code = read(css);
    if (!code.includes('#db-suggestions[data-foodnote-keep-visible="1"]')) {
      errors.push('CSS contrôleur ne protège pas #db-suggestions[data-foodnote-keep-visible="1"]');
    }
    for (const token of ['height: min(42dvh, 360px) !important', 'opacity: 1 !important', 'overflow-y: auto !important']) {
      if (!code.includes(token)) errors.push(`CSS suggestions sélectionnées incomplet: ${token}`);
    }
  }
}

function checkMealMovePersistence() {
  const nutrition = path.join(JS_DIR, '30-nutrition-foods.js');
  exists(nutrition, rel(nutrition));
  if (!fs.existsSync(nutrition)) return;
  const code = read(nutrition);
  for (const token of [
    'function foodnotePersistFoodMealChange',
    "persistFoodLineToSQLite(idx, reason)",
    "foodnotePersistFoodMealChange(idx, 'meal-select')",
    "foodnotePersistFoodMealChange(idx, options.reason || 'meal-drag')"
  ]) {
    if (!code.includes(token)) errors.push(`Persistance changement repas absente: ${token}`);
  }

  const moveBlock = code.match(/function\s+foodnoteMoveFoodToMeal[\s\S]*?\n}\n\nfunction\s+foodnoteClearMealDropState/);
  if (!moveBlock) {
    errors.push('Bloc foodnoteMoveFoodToMeal introuvable pour contrôle persistance repas');
  } else if (moveBlock[0].includes('autoSaveToday(120)')) {
    errors.push('Drag/drop repas utilise encore autoSaveToday(120) au lieu de la persistance atomique');
  }

  const changeBlock = code.match(/function\s+changeFoodMeal[\s\S]*?\n}\n\nlet\s+foodnoteDraggedFoodIdx/);
  if (!changeBlock) {
    errors.push('Bloc changeFoodMeal introuvable pour contrôle persistance repas');
  } else if (changeBlock[0].includes('selected.has(idx)')) {
    errors.push('changeFoodMeal dépend encore de selected.has(idx) pour persister le repas');
  }
}


function checkMealSelectionUiGuard() {
  const nutrition = path.join(JS_DIR, '30-nutrition-foods.js');
  const ux = path.join(JS_DIR, '95-food-add-clean.js');
  [nutrition, ux].forEach(f => exists(f, rel(f)));
  if (fs.existsSync(nutrition)) {
    const code = read(nutrition);
    for (const token of [
      "btn.classList.toggle('is-selected', active)",
      "btn.dataset.foodnoteMealSelected = active ? '1' : '0'",
      "btn.setAttribute('aria-current', 'true')",
      "document.querySelectorAll('[data-fn-meal-choice]')"
    ]) {
      if (!code.includes(token)) errors.push(`Sélection repas visible absente côté noyau: ${token}`);
    }
  }
  if (fs.existsSync(ux)) {
    const code = read(ux);
    for (const token of [
      "btn.classList.toggle('is-selected', active)",
      "btn.dataset.foodnoteMealSelected = active ? '1' : '0'",
      "#food-add-modal .food-meal-chip[data-food-meal]"
    ]) {
      if (!code.includes(token)) errors.push(`Sélection repas visible absente côté UX: ${token}`);
    }
  }
}


function checkCaptureSearchSelectionQuantityGuard() {
  const file = path.join(JS_DIR, '94-capture-workflow-core.js');
  exists(file, rel(file));
  if (!fs.existsSync(file)) return;
  const code = read(file);
  for (const token of [
    'function applyCaptureSearchSelection(index, options = {})',
    'state.lastQuery = name',
    "document.getElementById('capture-search-input')",
    'ne pas appeler render() ici',
    'refreshSearchResultsForQty();',
    'syncCaptureSearchSelectedItemQty(item)',
    "if (state.current === STATES.SEARCH_FOOD && state.mode === MODES.SEARCH)",
    "const item = applyCaptureSearchSelection(state.selectedIndex, { source:'confirm-selected' });",
    'if (state.mode === MODES.SEARCH) syncCaptureSearchSelectedItemQty(item);'
  ]) {
    if (!code.includes(token)) errors.push(`Garde sélection/quantité Capture absent: ${token}`);
  }
  const changeBlock = code.match(new RegExp("if \\(target\\.name === 'capture-result'\\)[\\s\\S]*?\\n      }\\n      if \\(target\\.matches"));
  if (!changeBlock) errors.push('Bloc change capture-result introuvable');
  else if (!changeBlock[0].includes("applyCaptureSearchSelection(target.value, { source:'capture-result-change' });") || !changeBlock[0].includes('return;')) {
    errors.push('Le clic résultat Capture ne court-circuite pas render() pour le mode recherche');
  }
}

function main() {
  checkJsSyntax();
  checkIndexRefs();
  checkAssetInventory();
  checkCaptureContracts();
  checkDeleteContracts();
  checkCss();
  checkBuildMetadata();
  checkDiagnosticFallbackScope();
  checkRuntimeMetadata();
  checkDeploymentMetadata();
  checkStartupCiqualMetadata();
  checkModuleRuntimeMetadata();
  checkJournalMutationRefreshCore();
  checkBarcodeVendorGuard();
  checkQuantitySelectorPersistence();
  checkSearchSuggestionVisibilityGuard();
  checkMealMovePersistence();
  checkMealSelectionUiGuard();
  checkCaptureSearchSelectionQuantityGuard();

  if (warnings.length) {
    console.warn('\nAvertissements:');
    warnings.forEach(w => console.warn(' - ' + w));
  }
  if (errors.length) {
    console.error('\nÉCHEC foodnote-static-check:');
    errors.forEach(e => console.error('\n- ' + e));
    process.exit(1);
  }
  console.log('OK foodnote-static-check — syntaxe JS, références index, contrats capture/suppression, métadonnées build/runtime/déploiement/startup/modules, inventaire assets/vendor, rafraîchissement journal centralisé/callers/sélections date, quantité finale DOM/recherche visible verrouillée/repas UI/persistance repas, sélection Capture quantité, fallback diagnostic.');
}

main();
