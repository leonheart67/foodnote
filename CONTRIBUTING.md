# Contribuer à FoodNote

FoodNote est en bêta active. Les contributions sont bienvenues, mais la priorité est la stabilité.

## Principes

- Garder l'interface simple.
- SQLite reste la source de vérité.
- Le localStorage ne doit jamais écraser les données serveur.
- Éviter les refactors massifs sans test réel.
- Une correction = un bug ciblé quand c'est possible.
- Ne pas ajouter de dépendance lourde sans raison forte.

## Avant une pull request

Lancez :

```bash
npm test
```

Vérifiez aussi manuellement les flux de base :

- ajout aliment ;
- changement quantité ;
- changement repas ;
- suppression aliment ;
- historique ;
- récapitulatif.

## Données et secrets

Ne committez jamais :

```text
.env
database/
*.db
*.sqlite
exports personnels
clés API
logs
```

## Style de contribution

Les petites PR ciblées sont préférées aux grosses réécritures. Si un bug touche un flux utilisateur, ajoutez si possible un garde-fou dans `scripts/foodnote-static-check.js`.
