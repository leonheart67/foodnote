/* FoodNote beta 0.22.155 — SMOKE_TESTS
 * Harnais passif : ne lance aucun test automatiquement et ne modifie pas l'état de l'application.
 * Utilisation console : FoodNoteSmokeTest.run()
 */
(function FoodNoteSmokeTests(){
  'use strict';

  const VERSION = 'foodnote_beta_0_24_js_health_cleanup_20260608';

  function check(label, ok, detail) {
    return { label, ok: !!ok, detail: detail || '' };
  }

  function hasFn(name) {
    return typeof window[name] === 'function';
  }

  function selector(sel) {
    try { return !!document.querySelector(sel); } catch (e) { return false; }
  }

  function run() {
    const capture = window.FoodNoteCapture;
    const modes = capture && capture.MODES ? capture.MODES : {};
    const checks = [
      check('FoodNoteCapture chargé', !!capture && typeof capture.open === 'function', capture && capture.version),
      check('Mode recherche', modes.SEARCH === 'search'),
      check('Mode code-barres', modes.BARCODE === 'barcode'),
      check('Mode photo plat', modes.PHOTO_FOOD === 'photo_food'),
      check('Mode tableau', modes.NUTRITION_TABLE === 'nutrition_table'),
      check('Mode recette', modes.RECIPE === 'recipe'),
      check('Mode IA texte', modes.IA_TEXT === 'ia_text'),
      check('Contrôleur modal ajouter', !!window.FoodNoteFoodAddModalController),
      check('Domaine ajout aliment', !!window.FoodNoteFoodAddDomain),
      check('Flux capture popup', !!window.FoodNoteFoodCaptureFlows),
      check('Recherche intégrée', !!window.FoodNoteFoodAddSearchState && hasFn('handleDBSearchInput') && hasFn('pickDBSuggestion')),
      check('Diagnostic ajout', !!window.FoodNoteFoodAddDiagnostics || !!window.FoodNoteFoodAddHardening),
      check('Refresh journal centralisé', hasFn('foodnoteRefreshJournalMutationViews')),
      check('Refresh stats centralisé', hasFn('refreshFoodnoteStatsAfterJournalMutation')),
      check('Refresh récap centralisé', hasFn('refreshFoodnoteRecapAfterJournalMutation')),
      check('Fonction suppression par id', hasFn('deleteEntryFoodNative')),
      check('Fonction suppression par line_uid', hasFn('deleteEntryFoodNativeByLineUid')),
      check('Page journal présente', selector('#page-journal') || selector('.journal-premium-page')),
      check('Hub capture ou bouton + présent', selector('#foodnote-capture-launcher') || selector('[data-foodnote-mobile-plus]') || selector('.mobile-bottom-nav'))
    ];
    const ok = checks.every(c => c.ok);
    const summary = { version: VERSION, ok, checks };
    const table = checks.map(c => ({ ok: c.ok ? '✓' : '✗', test: c.label, detail: c.detail || '' }));
    try { console.table(table); } catch (e) { console.log(table); }
    console[ok ? 'info' : 'warn']('[FoodNoteSmokeTest]', ok ? 'OK' : 'À vérifier', summary);
    return summary;
  }

  function checklist() {
    const lines = [
      'Plan de test rapide FoodNote :',
      '1. Recherche : chercher banane, modifier le poids, vérifier que la recherche ne se relance pas.',
      '2. IA texte : coller 3 aliments, vérifier kcal/prot/gluc/lip, modifier un poids, ajouter la sélection.',
      '3. Suppression : supprimer une ligne, rafraîchir, vérifier journal + récap.',
      '4. Code-barres : ouvrir caméra, scanner ou saisir un code manuel.',
      '5. Tableau nutritionnel : photo, recadrage, OCR, validation.',
      '6. Recette : photo, recadrage, OCR, IA, validation plat complet.',
      '7. + repas : choisir une action, vérifier que le repas n’est pas redemandé.',
      '8. + mobile : hub complet avec sport, vérifier que le repas est demandé si nécessaire.'
    ];
    console.info(lines.join('\n'));
    return lines;
  }

  window.FoodNoteSmokeTest = { version: VERSION, run, checklist };
})();
