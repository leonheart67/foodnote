# Contribuer à FoodNote

Les contributions sont bienvenues, mais FoodNote est encore en bêta.

En proposant une contribution, vous acceptez qu’elle soit distribuée sous la licence du projet : GNU AGPL-3.0-or-later.


Pour le moment, les contributions recommandées sont :
- corrections de bugs ;
- amélioration de documentation ;
- nettoyage de code ;
- améliorations UI simples.

Les grosses modifications fonctionnelles doivent être discutées dans une issue avant PR.

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

