# Plan de test FoodNote

## Avant push GitHub

1. Lancer `npm test`.
2. Vérifier qu'aucun secret n'est présent : `.env`, base SQLite, clé API, logs.
3. Lancer l'application avec `docker compose up -d --build`.
4. Tester `/api/health`.
5. Tester ajout aliment avec quantité personnalisée.
6. Tester déplacement aliment entre repas puis refresh navigateur.
7. Tester suppression aliment.
8. Tester historique / récapitulatif.

## Notes version 0.22.179

La base fonctionnelle attendue est la correction du workflow Capture/Rechercher : sélection d'un résultat, champ rempli, propositions conservées, quantité transmise au journal.


---

# Test plan — 0.22.179

1. Ouvrir Ajouter via le workflow Capture/Rechercher.
2. Taper `pomme`.
3. Cliquer `compote de pomme`.
4. Vérifier que le champ affiche `compote de pomme`.
5. Vérifier que la liste de propositions reste visible.
6. Régler la quantité à `75 g`.
7. Cliquer Ajouter / choisir le repas.
8. Vérifier que le journal affiche `75 g`.
9. Vérifier que le déplacement drag/drop entre repas reste persistant après refresh.
