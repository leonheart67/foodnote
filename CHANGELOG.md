# Changelog

## FoodNote beta 0.22.179 — GitHub-ready package

- Préparation dépôt public GitHub sans changement fonctionnel applicatif.
- Ajout `.gitignore`, `.gitattributes`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`.
- Ajout templates GitHub issues / pull requests.
- README remplacé par une présentation transparente du projet bêta.
- Ajout documentation `docs/ATTRIBUTIONS.md` et `docs/GITHUB_RELEASE_CHECKLIST.md`.
- `docker-compose.yml` rendu plus portable via variables `FOODNOTE_APP_DIR` et `FOODNOTE_DATA_DIR`.

# FoodNote beta 0.22.179 — CAPTURE_SEARCH_SELECT_QTY_FIX

Base : 0.22.179.

## Correction ciblée

- Corrige le vrai flux utilisé par la recherche du workflow `94-capture-workflow-core.js`.
- Le clic sur un résultat de recherche ne reconstruit plus tout l'écran via `render()`.
- Le champ `#capture-search-input` reçoit maintenant le nom complet de l'aliment sélectionné.
- `#capture-search-results` reste visible après sélection.
- La quantité `#capture-search-qty` est copiée dans l'item sélectionné avant le passage au choix repas et avant l'ajout journal.

## Non touché

- Correction drag/drop repas conservée.
- Pas de nettoyage code mort.
- Pas de refactor caméra/OCR/IA.
