# FoodNote beta 0.24.40 — Repas rapide : charte graphique + coeur

## Objectif

Ajustement visuel du repas rapide contextuel sans changer sa logique métier.

## Inclus

- Le bouton de suggestions rapides passe de `☁` à `♥`.
- Le libellé devient “Aliments fréquents”, plus clair que “nuage”.
- Les cartes de propositions rapides sont alignées sur la charte FoodNote : surface douce, bordure commune, coins moins ovales, macros lisibles.
- Les propositions restent calculées par repas : petit-déj, déjeuner ou souper.
- Le clic ajoute toujours directement l’aliment au repas ciblé, sans passer par la recherche.

## Fichiers modifiés

- `public/assets/js/30-nutrition-foods.js`
- `public/assets/js/94-capture-workflow-core.js`
- `public/assets/css/app.css`
  - section consolidée issue de `94-capture-workflow-core.css`

## Non modifié

- logique fonctionnelle de `index.html`
- `server.js`
- SQLite
- recherche alimentaire classique
- OCR / code-barres / recette
