# 🥗 FoodNote

**Application web self-hosted de suivi alimentaire avec SQLite, CIQUAL, OpenFoodFacts et IA optionnelle.**

![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg)
![Node.js](https://img.shields.io/badge/Node.js-backend-339933.svg)
![Status](https://img.shields.io/badge/status-beta-orange.svg)

FoodNote est une application de suivi nutritionnel pensée pour un usage personnel, local et self-hosted.

L’objectif : garder une interface simple pour suivre ses repas au quotidien, tout en utilisant des bases nutritionnelles sérieuses comme **CIQUAL** et **OpenFoodFacts**, avec une aide IA optionnelle.

> ⚠️ FoodNote est en bêta active.  
> Le projet fonctionne, mais certaines parties sont encore en stabilisation et nettoyage.

> ⚕️ FoodNote n’est pas un dispositif médical.  
> Les valeurs nutritionnelles, estimations IA et calculs doivent être considérés comme des aides au suivi personnel.

--- 

## ✨ Fonctionnalités

- 📊 **Suivi quotidien** — calories, protéines, glucides, lipides
- 🍽️ **Journal par repas** — petit-déjeuner, déjeuner, dîner, collations
- ⚖️ **Quantités personnalisées** — ajout, modification, déplacement entre repas
- 🔍 **Recherche alimentaire** — CIQUAL, OpenFoodFacts et base personnelle
- 📦 **OpenFoodFacts** — produits industriels et codes-barres
- 🇫🇷 **CIQUAL / Anses** — base nutritionnelle française de référence
- 🤖 **IA optionnelle** — estimation de repas via Groq
- 🚴 **Sport** — suivi des dépenses et bilan net
- 📈 **Stats & phases** — suivi de progression et objectifs nutritionnels
- 🌙 **Thème clair / sombre**
- 💾 **SQLite local** — vos données restent chez vous
- 🐳 **Docker ready**
- 📱 **Utilisable sur mobile** via navigateur / WebView

---

## 🚀 Installation rapide

### Prérequis

- Docker
- Docker Compose
- Git

### 1. Cloner le dépôt

```bash
git clone https://github.com/leonheart67/foodnote.git
cd foodnote
```

### 2. Créer le fichier `.env`

```bash
cp .env.example .env
```

Exemple minimal :

```env
PORT=3000
DATA_DIR=/data
PUBLIC_DIR=/app/public

FOODNOTE_APP_DIR=.
FOODNOTE_DATA_DIR=./database

GROQ_API_KEY=
FOODNOTE_ALLOW_UI_SECRET_STORAGE=0

FOODNOTE_CIQUAL_AUTO_DOWNLOAD=0
OFF_IMPORT_LIMIT=0
```

### 3. Lancer FoodNote

```bash
docker compose up -d
```

Accès :

```text
http://localhost:3000
```

---

## 📁 Structure du projet

```text
foodnote/
├── server.js              # Backend Node.js + API
├── package.json
├── Dockerfile
├── docker-compose.yml
├── start.sh               # Script de démarrage conteneur
├── update_off.sh          # Mise à jour OpenFoodFacts
├── import_off.py          # Import OpenFoodFacts
├── import_ciqual.py       # Import CIQUAL / Anses
├── download_ciqual.py     # Téléchargement optionnel CIQUAL
├── public/
│   ├── index.html         # Application web
│   └── assets/
│       ├── css/
│       └── js/
└── scripts/
    └── foodnote-static-check.js
```

La structure est volontairement simple :

- `server.js` reste à la racine ;
- les scripts d’import restent à la racine ;
- le frontend est dans `public/` ;
- les contrôles projet sont dans `scripts/`.

---

## 🗄️ Bases de données nutritionnelles

| Source | Usage | Qualité | Import |
|---|---|---:|---|
| **CIQUAL / Anses** | aliments bruts et références nutritionnelles françaises | ⭐⭐⭐ | manuel ou optionnel |
| **OpenFoodFacts** | produits industriels, marques, codes-barres | ⭐⭐ | manuel / script / interface |
| **BDD personnelle** | aliments et recettes utilisateur | ⭐⭐⭐ | via l’app |

---

## 🇫🇷 CIQUAL

FoodNote peut utiliser les fichiers officiels CIQUAL de l’Anses.

Par défaut, le téléchargement automatique peut être désactivé :

```env
FOODNOTE_CIQUAL_AUTO_DOWNLOAD=0
```

Cela évite qu’un conteneur télécharge automatiquement des données externes au premier démarrage.

---

## 📦 OpenFoodFacts

OpenFoodFacts est utilisé pour :

- les produits industriels ;
- les codes-barres ;
- les données nutritionnelles de produits emballés.

La base OpenFoodFacts peut être volumineuse.  
L’import est donc volontairement manuel ou déclenché depuis l’interface / les scripts.

```env
OFF_IMPORT_LIMIT=0
```

`0` signifie : pas de limite d’import.

---

## 🤖 IA / Groq

FoodNote peut utiliser une clé API Groq pour certaines fonctions IA.

Deux modes sont possibles.

### 1. Mode serveur recommandé

La clé est configurée côté serveur, dans `.env` ou dans les variables Docker :

```env
GROQ_API_KEY=your_groq_api_key_here
FOODNOTE_ALLOW_UI_SECRET_STORAGE=0
```

Dans ce mode, l’interface web ne permet pas d’enregistrer une clé IA.

C’est le mode recommandé pour :

- une installation publique ;
- une installation partagée ;
- une instance exposée ;
- un dépôt GitHub public.

### 2. Mode interface utilisateur

Pour un usage personnel self-hosted, il est possible d’autoriser la saisie de la clé Groq depuis l’interface FoodNote :

```env
FOODNOTE_ALLOW_UI_SECRET_STORAGE=1
```

Dans ce mode, la clé peut être saisie dans l’interface et enregistrée côté serveur dans SQLite.

⚠️ Ce mode doit être utilisé uniquement sur une instance personnelle et maîtrisée.

Ne publiez jamais :

- votre fichier `.env` ;
- votre base SQLite ;
- une capture d’écran contenant une clé API ;
- une clé API dans une issue GitHub.

---

## 📱 Mobile / Android

FoodNote est utilisable depuis un navigateur mobile.

Il peut aussi être intégré dans une application Android WebView.  
L’APK Android n’est pas fourni comme version stable pour le moment.

---

## 🧪 Tests

FoodNote contient un contrôle statique du projet :

```bash
npm test
```

Ce test vérifie notamment :

- la présence des fichiers importants ;
- les références JS/CSS dans `index.html` ;
- certains contrats entre modules ;
- des garde-fous sur les flux critiques ;
- la cohérence minimale avant publication.

---

## 🔐 Sécurité

FoodNote est conçu pour un usage self-hosted.

Recommandations :

- ne publiez jamais `.env` ;
- ne publiez jamais votre base SQLite ;
- ne mettez jamais de clé API dans le frontend ;
- gardez `FOODNOTE_ALLOW_UI_SECRET_STORAGE=0` sur une instance exposée ;
- utilisez un reverse proxy sécurisé si l’app est accessible depuis Internet ;
- sauvegardez régulièrement le dossier `database/`.

---

## 💾 Sauvegarde

Les données principales sont stockées côté serveur, dans SQLite.

Sauvegardez régulièrement :

```text
database/
```

Selon votre configuration Docker, ce dossier peut être monté avec :

```env
FOODNOTE_DATA_DIR=./database
```

ou avec un chemin serveur personnalisé.

---

## 🚫 Données à ne pas publier

Avant de pousser sur GitHub, vérifiez que ces fichiers ne sont pas suivis par Git :

```text
.env
database/
data/
*.db
*.sqlite
*.sqlite3
node_modules/
*.zip
*.log
alim.xml
compo.xml
grp.xml
ciqual_data.json
openfoodfacts*.json
openfoodfacts*.csv
openfoodfacts*.csv.gz
```

Ces fichiers peuvent contenir :

- des données personnelles ;
- des exports ;
- des clés API ;
- des bases nutritionnelles volumineuses ;
- des journaux alimentaires.

---

## 🗺️ Roadmap

Idées prévues ou envisagées :

- nettoyage progressif du code mort ;
- amélioration du thème sombre ;
- simplification des flux d’ajout ;
- meilleure séparation IA texte / OCR / photo ;
- amélioration mobile ;
- documentation d’installation plus détaillée ;
- meilleure gestion CIQUAL / OpenFoodFacts ;
- statistiques plus lisibles ;
- sauvegarde / restauration simplifiée ;
- tests automatisés plus complets.

---

## 🤝 Contribuer

Les contributions sont bienvenues, mais FoodNote est encore en bêta.

Avant une grosse modification, ouvrez idéalement une issue pour en discuter.

Contributions utiles :

- corrections de bugs ;
- amélioration du README ;
- amélioration UI/UX ;
- nettoyage de code ;
- tests ;
- documentation Docker ;
- corrections d’installation.

En proposant une contribution, vous acceptez qu’elle soit distribuée sous la même licence que le projet :

```text
GNU AGPL-3.0-or-later
```

---

## 📚 Sources de données

### CIQUAL / Anses

FoodNote peut utiliser la table de composition nutritionnelle des aliments CIQUAL publiée par l’Anses.

Citation recommandée :

```text
Anses. Table de composition nutritionnelle des aliments Ciqual.
```

### OpenFoodFacts

FoodNote peut utiliser les données OpenFoodFacts pour les produits alimentaires.

OpenFoodFacts possède ses propres licences et conditions d’utilisation.  
Consultez la documentation officielle OpenFoodFacts pour les détails d’attribution.

---

## 📄 Licence

FoodNote est distribué sous licence :

```text
GNU Affero General Public License v3.0 or later
AGPL-3.0-or-later
```

Vous pouvez utiliser, modifier et redistribuer FoodNote, y compris dans un contexte professionnel, à condition de respecter les termes de l’AGPL.

Si vous modifiez FoodNote et le mettez à disposition d’utilisateurs via un réseau ou un service hébergé, vous devez rendre disponible le code source correspondant de cette version modifiée.

Pour une utilisation commerciale avec des conditions différentes de l’AGPL, contactez l’auteur du projet.

---

## ⭐ Support

Si FoodNote vous est utile, une ⭐ sur GitHub est toujours appréciée.

Les retours de test, rapports de bugs et suggestions sont les bienvenus.
