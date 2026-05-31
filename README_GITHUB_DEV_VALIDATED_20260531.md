# FoodNote beta 0.22.179 — GitHub dev validé 2026-05-31

## Inclus

- Corrections visuelles utilisateur conservées : logos calories/protéines/glucides/lipides et couleurs des badges macro.
- Thèmes `style-dark.css` et `style-light.css` verrouillés comme nouvelle base visuelle.
- Correction CSS de cohérence : accolades parasites retirées dans les deux thèmes, sans modifier la logique UI.
- Ressenti et notes en pleine largeur dans le Journal.
- Nettoyage du champ Journal legacy “Question(s) pour l’IA”, sans supprimer l’IA texte dédiée.
- Diagnostics de recherche intégrée alignés sur le moteur réel, sans référence au module legacy supprimé.
- Suppression du bloc legacy “Mémoire rapide” et nettoyage CSS associé.
- Starter foods séparés dans `public/assets/js/11-starter-foods.js` avec 150 aliments courants.
- Explorateur lecture seule Starter / CIQUAL / OpenFoodFacts dans Bases de données.
- Notifications intégrées dans le Journal, sans bulle flottante globale.
- Suppression des pages legacy : Référence, ancienne page `bddalim`, ancienne page Export.
- Suppression du pont legacy `93-food-add-tools.js` et des assets orphelins déjà débranchés.
- CIQUAL : scripts `download_ciqual.py`, `import_ciqual.py`, `update_ciqual.sh` présents.

## Validation

- Archive consolidée : `FoodNote_beta_0.22.179_GITHUB_DEV_VALIDATED_20260531.zip`
- Cible : branche `dev`
- Tests statiques :
  - `node --check server.js`
  - `node --check public/assets/js/*.js`
  - `scripts/foodnote-static-check.js`
- Données SQLite non modifiées.
- IA texte conservée.
