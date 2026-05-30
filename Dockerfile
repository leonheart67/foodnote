FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NODE_PATH=/srv/node_modules:/app/node_modules \
    PATH=/srv/node_modules/.bin:/app/node_modules/.bin:$PATH \
    PYTHON=/usr/bin/python3 \
    npm_config_python=/usr/bin/python3

RUN apt-get -o Acquire::Retries=5 update \
 && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-fra \
      tesseract-ocr-eng \
      imagemagick \
      ca-certificates \
      curl \
      python3 \
      make \
      g++ \
      pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances Node installées à la construction de l'image, pas à chaque démarrage.
# npm 10+ refuse `npm config set python`; on passe donc par ENV npm_config_python.
# /app peut ensuite être monté en lecture seule sans cacher /srv/node_modules.
COPY package.json /tmp/foodnote-package.json
RUN mkdir -p /srv/node_modules \
 && cp /tmp/foodnote-package.json /srv/package.json \
 && npm install --prefix /srv --omit=dev --no-audit --no-fund

# Le code applicatif est monté par docker-compose dans /app.
# On ne copie pas tout le projet ici pour éviter d'embarquer la base SQLite,
# les fichiers CIQUAL/OpenFoodFacts et les sauvegardes dans l'image.
# Le fichier .dockerignore réduit aussi fortement le contexte de build.
RUN mkdir -p /app

CMD ["sh", "/app/start.sh"]
