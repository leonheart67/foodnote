# FoodNote beta 0.24.39 — Repas rapide contextuel

## Principe

Cette version ajoute un bouton nuage à côté du bouton `+` des groupes de repas.

- `+` garde le menu d'ajout complet : recherche, code-barres, photo, tableau, recette, IA texte.
- `☁` ouvre un nuage d'aliments fréquents pour le repas courant.

## Logique

Repas rapide n'est pas un template de repas complet.
Il propose les aliments qui reviennent souvent dans le même repas, avec leur quantité habituelle calculée depuis l'historique.

Le clic sur une suggestion ajoute directement l'aliment au journal via la fonction d'ajout existante. Il ne lance pas la recherche et ne simule pas de clic DOM.

## Fichiers modifiés

- `public/assets/js/30-nutrition-foods.js`
  - génération du bouton `☁`
  - calcul des suggestions rapides depuis l'historique
  - ajout direct via la logique existante du journal

- `public/assets/js/94-capture-workflow-core.js`
  - popup nuage des aliments fréquents
  - intégration au bouton repas

- `public/assets/css/app.css`
  - section consolidée issue de `94-capture-workflow-core.css` : style du nuage rapide et de ses chips macro

## Non modifié

- logique fonctionnelle de `index.html`
- `server.js`
- base SQLite
- recherche alimentaire
- OCR / recette / IA photo
