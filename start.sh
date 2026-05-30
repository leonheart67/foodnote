#!/bin/sh
set -eu

cd /app
export NODE_PATH="/srv/node_modules:/app/node_modules:${NODE_PATH:-}"
export PATH="/srv/node_modules/.bin:/app/node_modules/.bin:$PATH"
: "${FOODNOTE_IMAGE:=foodnote:0.22.179}"

mkdir -p /data

echo "[FoodNote] Node: $(node -v 2>/dev/null || true) | npm: $(npm -v 2>/dev/null || true)"
echo "[FoodNote] NODE_PATH=$NODE_PATH"

PYTHON_OK=0
if command -v python3 >/dev/null 2>&1; then
  PYTHON_OK=1
  export PYTHON="$(command -v python3)"
  echo "[FoodNote] python3 OK: $(python3 --version 2>&1)"
else
  echo "[FoodNote] python3 absent: l'image n'a probablement pas été reconstruite."
fi

if command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1; then
  echo "[FoodNote] ImageMagick OK"
else
  echo "[FoodNote] ImageMagick indisponible: OCR sans prétraitement image"
fi

if command -v tesseract >/dev/null 2>&1; then
  echo "[FoodNote] tesseract OK: $(tesseract --version | head -n 1)"
else
  echo "[FoodNote] tesseract système indisponible, fallback tesseract.js requis"
fi

check_node_modules() {
  node -e "require('express'); require('better-sqlite3'); require('html5-qrcode'); require('mqtt'); require('tesseract.js')" >/dev/null 2>&1
}

install_foodnote_node_deps() {
  echo "[FoodNote] dépendances Node absentes: tentative de réparation dans /srv/node_modules..."
  if [ "$PYTHON_OK" != "1" ]; then
    echo "[FoodNote] réparation impossible: python3 absent."
    echo "[FoodNote] Fais une reconstruction propre: docker compose down && docker compose build --no-cache foodnote && docker compose up -d"
    return 1
  fi
  mkdir -p /srv /srv/node_modules
  cp /app/package.json /srv/package.json
  npm config set python "$PYTHON" >/dev/null 2>&1 || true
  npm install --prefix /srv --omit=dev --no-audit --no-fund 2>/tmp/foodnote-npm-install.log || {
    echo "[FoodNote] npm install KO. Le conteneur ne peut pas démarrer sans modules Node:"
    cat /tmp/foodnote-npm-install.log || true
    return 1
  }
}

if ! check_node_modules; then
  install_foodnote_node_deps || exit 1
fi

node - <<'NODE'
const cp = require('child_process');
try {
  const v = cp.execFileSync('tesseract', ['--version'], {encoding:'utf8'}).split('\n')[0];
  console.log('[FoodNote] diagnostic native_tesseract=true', v);
} catch(e) {
  console.log('[FoodNote] diagnostic native_tesseract=false', e.message);
}
for (const m of ['express','better-sqlite3','html5-qrcode','tesseract.js','mqtt']) {
  try {
    console.log(`[FoodNote] diagnostic ${m.replace(/[^a-z0-9]/gi,'_')}_module=true`, require.resolve(m));
  } catch(e) {
    console.log(`[FoodNote] diagnostic ${m.replace(/[^a-z0-9]/gi,'_')}_module=false`, e.message);
  }
}
NODE

# CIQUAL officiel ANSES : par défaut, pas de téléchargement réseau au démarrage.
# Sur certains hôtes Proxmox/Dockge, le réseau bridge Docker provoque des timeouts TLS.
# Pour télécharger automatiquement quand le réseau Docker est fiable : FOODNOTE_CIQUAL_AUTO_DOWNLOAD=1.
if [ -f /app/download_ciqual.py ] && command -v python3 >/dev/null 2>&1; then
  if [ ! -s /data/alim.xml ] || [ ! -s /data/compo.xml ]; then
    if [ "${FOODNOTE_CIQUAL_AUTO_DOWNLOAD:-0}" = "1" ]; then
      echo "[FoodNote] CIQUAL XML absents: téléchargement vers /data..."
      python3 /app/download_ciqual.py --dest /data 2>/tmp/foodnote-ciqual-download.log || {
        echo "[FoodNote] téléchargement CIQUAL impossible pour l'instant (non bloquant):"
        cat /tmp/foodnote-ciqual-download.log || true
      }
    else
      echo "[FoodNote] CIQUAL XML absents: téléchargement auto désactivé."
      echo "[FoodNote] Pour importer CIQUAL: docker run --rm --network=host -v /mnt/Docker/data/nginx:/app:ro -v /mnt/Docker/data/nginx/database:/data -e DATA_DIR=/data ${FOODNOTE_IMAGE} sh -lc 'python3 /app/download_ciqual.py --dest /data && python3 /app/import_ciqual.py --data-dir /data'"
    fi
  else
    echo "[FoodNote] CIQUAL XML présents dans /data"
  fi
fi

exec node /app/server.js
