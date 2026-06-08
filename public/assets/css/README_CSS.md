# FoodNote — CSS structuré

`app.css` est un manifeste. Les règles sont rangées dans `assets/css/modules/`.

## Règle de maintenance

On ne crée plus de fichier de correction en fin de cascade. Une correction doit aller dans le module qui possède réellement le composant ou la page.

## Organisation actuelle

- `00-foundation-layout.css` — fondations visuelles et layout général.
- `01-nutrition-macros.css` — couleurs et badges calories/protéines/glucides/lipides.
- `10-ui-components-core.css` — composants UI communs.
- `20-navigation-mobile.css` — barre basse mobile.
- `30-theme-surfaces.css` — surfaces et accents de thème.
- `40-add-capture.css` — workflow Ajouter et capture alimentaire.
- `50-theme-runtime.css` — variables/runtime clair-sombre.
- `51-shell-header-sidebar.css` — shell desktop et en-tête mobile.
- `52-journal-meals.css` — Journal et repas.
- `53-components-forms-panels.css` — formulaires, panneaux, boutons, modales génériques.
- `54-journal-summary-sticky.css` — résumé nutritionnel collant.
- `55-page-layout.css` — largeur, centrage et comportements globaux de pages.
- `56-recap-dashboard.css` — Récap, badges et tableaux de bord.
- `57-add-capture-states.css` — états de la modale Ajouter/recette/OCR.
- `58-profile-objectives.css` — objectifs, phases et règles nutritionnelles visibles.
- `59-theme-bridges.css` — ponts de variables conservés par compatibilité.
- `5a-journal-macro-cards.css` — cartes macro du Journal.
- `60-database-explorer.css` — Bases de données.
- `61-notifications-inline.css` — notifications inline.
- `70-design-base.css` — base design générale.
- `71-design-tokens.css` — tokens design de haut niveau.
- `72-design-variables.css` — liaison entre tokens et variables historiques.
- `80-typography-page-shell.css` — typographie et shell commun des pages.
- `81-profile-menu.css` — menu profil.
- `82-journal-sport-carousels.css` — carrousels Journal/Sport.
- `83-recap-objective-pages.css` — pages Récap, Stats et Objectifs.
- `84-journal-food-items.css` — groupes de repas et lignes alimentaires.
- `85-capture-launcher-buttons.css` — boutons de lancement de capture.
- `86-mobile-swipe-motion.css` — touch-action, swipe horizontal et animations mobiles.
- `87-shared-page-components.css` — composants partagés qui ne sont pas encore spécifiques à une seule page.

## À ne pas refaire

- pas de `style-light.css` ;
- pas de `06-foodnote-design.css` ;
- pas de module nommé `legacy`, `fixes`, `overrides`, `patch` ou `theme-lab` ;
- pas de nouveau fichier qui corrige tout en dernier.

## Nettoyage déjà fait dans cette passe

- suppression du module fourre-tout `55-foodnote-page-rules.css` ;
- suppression du module fourre-tout `73-design-page-rules.css` ;
- redistribution de leurs règles vers des modules nommés par responsabilité ;
- conservation du moteur JS et de `server.js` sans modification fonctionnelle.

## Prochaine étape sûre

Réduire les `!important` uniquement module par module, avec test visuel à chaque fois. Les retirer globalement d’un coup est volontairement évité pour ne pas casser le rendu validé.

## Nettoyage complémentaire

- suppression de l’injection CSS runtime de `122-swipe-nav.js` ;
- déplacement des règles `touch-action` dans `86-mobile-swipe-motion.css` ;
- le script de swipe ne gère plus le style, uniquement le geste.

## Passe 2026-06-08 — JS health cleanup

- La visibilité persistante des suggestions Ajouter est portée par `57-add-capture-states.css`.
- Le module `101-food-add-health-diagnostics.js` est passif : diagnostic uniquement, pas de handlers utilisateur ni de style inline.

- `43-quick-create-food.css` : bouton et mini-modale de création rapide d’aliment.
- `88-frequent-foods.css` : bouton étoile, bulle et toast des aliments fréquents.
