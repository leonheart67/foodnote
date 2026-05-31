# FoodNote beta 0.22.179


FoodNote est une application web self-hosted de suivi alimentaire, pensée pour rester simple côté utilisateur tout en gardant les données en local.

> État du projet : **bêta active**. L'application fonctionne, mais le code est encore en nettoyage et certaines zones restent expérimentales.

## Objectif

FoodNote sert à suivre une journée alimentaire : repas, aliments, poids, calories, macronutriments, historique, statistiques et imports nutritionnels.

Le projet a été créé pour un usage personnel, avec une approche pragmatique : SQLite comme source de vérité, Docker pour le déploiement, interface web légère et options avancées cachées autant que possible.

## Fonctionnalités principales

- Journal alimentaire par jour et par repas.
- Ajout manuel d'aliments.
- Recherche dans la base nutritionnelle locale.
- Import CIQUAL / OpenFoodFacts.
- Historique, export et récapitulatif.
- Statistiques nutritionnelles.
- OCR pour certains flux photo / tableau nutritionnel.
- IA texte optionnelle via Groq, si une clé API est fournie.
- Stockage local SQLite côté serveur.
- Déploiement Docker / Docker Compose.

## Limites actuelles

FoodNote n'est pas un outil médical. Les valeurs nutritionnelles peuvent être approximatives, surtout pour les estimations IA, les plats préparés, les restaurants et les portions visuelles.

Certaines sections sont encore en bêta : capture photo, OCR, IA, recette et nettoyage de vieux modules. Le projet assume cette transparence.

## Structure du projet

```text
.
├── server.js
├── package.json
├── Dockerfile
├── docker-compose.yml
├── start.sh
├── update_off.sh
├── import_ciqual.py
├── import_off.py
├── import_off.js
├── download_ciqual.py
├── public/
│   ├── index.html
│   ├── vendor/
│   └── assets/
│       ├── css/
│       ├── img/
│       └── js/
└── scripts/
    └── foodnote-static-check.js
```

Le serveur Node est à la racine, le frontend est dans `public/`, et les scripts d'import restent à la racine pour simplifier Docker et le self-hosting.

## Démarrage rapide avec Docker Compose

Copiez l'exemple d'environnement :

```bash
cp .env.example .env
```

Puis lancez :

```bash
docker compose up -d --build
```

Par défaut, l'application écoute le port `8085` côté hôte :

```text
http://localhost:8085
```

Les données persistantes sont stockées dans `./database` par défaut.

Pour un déploiement Dockge / Proxmox avec un chemin fixe, adaptez `.env` :

```env
FOODNOTE_APP_DIR=/mnt/Docker/data/nginx
FOODNOTE_DATA_DIR=/mnt/Docker/data/nginx/database
```

## Variables utiles

```env
PORT=3000
DATA_DIR=/data
PUBLIC_DIR=/app/public
GROQ_API_KEY=
FOODNOTE_ALLOW_UI_SECRET_STORAGE=0
FOODNOTE_CIQUAL_AUTO_DOWNLOAD=0
FOODNOTE_CIQUAL_AUTO_IMPORT=1
```

Par sécurité, la clé Groq doit être fournie via `.env` ou Docker, pas commitée dans le dépôt.

## CIQUAL et OpenFoodFacts

FoodNote peut utiliser des données issues de :

- CIQUAL / Anses pour les données nutritionnelles françaises.
- OpenFoodFacts pour les produits et codes-barres.

Les fichiers lourds ou générés ne sont pas destinés à être commités dans GitHub. Placez-les localement ou laissez FoodNote/import scripts les reconstruire selon votre configuration.

Exemples de fichiers exclus :

```text
alim.xml
compo.xml
grp.xml
ciqual_data.json
openfoodfacts*.json
openfoodfacts*.csv
*.sqlite
*.db
```

## Tests / contrôles statiques

FoodNote fournit un contrôle statique maison :

```bash
npm test
```

ou :

```bash
npm run check
```

Ce test vérifie notamment :

- syntaxe JS ;
- cohérence des références chargées par `index.html` ;
- présence des assets critiques ;
- garde-fous sur certains flux sensibles ;
- absence de métadonnées incohérentes connues.

## Sécurité et confidentialité

Les données alimentaires, profils, historiques, clés API et bases SQLite doivent rester locales.

Ne publiez jamais :

```text
.env
database/
*.db
*.sqlite
exports personnels
logs
```

## Licence

Code publié sous licence MIT. Les bases de données nutritionnelles externes gardent leurs propres licences et conditions d'attribution.

## Avertissement

FoodNote est un projet personnel en bêta. Les calculs nutritionnels sont fournis à titre indicatif et ne remplacent pas l'avis d'un professionnel de santé.
