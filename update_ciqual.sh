#!/bin/sh
# FoodNote — mise à jour CIQUAL officielle.
# Rôle : orchestrer le téléchargement des XML CIQUAL puis l'import local.
# Gère : téléchargement atomique via download_ciqual.py, import via import_ciqual.py,
#        écriture dans DATA_DIR et logs stdout/stderr capturés par server.js.
# Ne doit pas gérer : routes HTTP, affichage frontend, recherche alimentaire ou logique SQLite applicative.

set -eu

DATA_DIR="${DATA_DIR:-/data}"
APP_DIR="${APP_DIR:-/app}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
# Par défaut on ne retélécharge pas un XML local déjà présent et validé MD5.
# Pour forcer : FORCE_CIQUAL_DOWNLOAD=1 /app/update_ciqual.sh
FORCE_CIQUAL_DOWNLOAD="${FORCE_CIQUAL_DOWNLOAD:-0}"
CIQUAL_DOWNLOAD_RETRIES="${CIQUAL_DOWNLOAD_RETRIES:-5}"
CIQUAL_DOWNLOAD_TIMEOUT="${CIQUAL_DOWNLOAD_TIMEOUT:-300}"

DOWNLOAD_SCRIPT="$APP_DIR/download_ciqual.py"
IMPORT_SCRIPT="$APP_DIR/import_ciqual.py"
JSON_OUT="$DATA_DIR/ciqual_data.json"
DB_OUT="$DATA_DIR/off.db"

echo "[CIQUAL] FoodNote — mise à jour officielle ANSES"
echo "[CIQUAL] Début : $(date -Iseconds)"
echo "[CIQUAL] DATA_DIR=$DATA_DIR"
echo "[CIQUAL] APP_DIR=$APP_DIR"

mkdir -p "$DATA_DIR"

if [ ! -f "$DOWNLOAD_SCRIPT" ]; then
  echo "[CIQUAL] ERREUR : $DOWNLOAD_SCRIPT introuvable" >&2
  exit 2
fi
if [ ! -f "$IMPORT_SCRIPT" ]; then
  echo "[CIQUAL] ERREUR : $IMPORT_SCRIPT introuvable" >&2
  exit 2
fi

DOWNLOAD_ARGS="--dest $DATA_DIR --retries $CIQUAL_DOWNLOAD_RETRIES --timeout $CIQUAL_DOWNLOAD_TIMEOUT"
if [ "$FORCE_CIQUAL_DOWNLOAD" = "1" ]; then
  DOWNLOAD_ARGS="$DOWNLOAD_ARGS --force"
fi

echo "[CIQUAL] Étape 1/2 — téléchargement/validation des XML officiels"
# shellcheck disable=SC2086
"$PYTHON_BIN" "$DOWNLOAD_SCRIPT" $DOWNLOAD_ARGS

echo "[CIQUAL] Étape 2/2 — import XML vers JSON + SQLite"
"$PYTHON_BIN" "$IMPORT_SCRIPT" --data-dir "$DATA_DIR" --json-out "$JSON_OUT" --db-out "$DB_OUT"

echo "[CIQUAL] Fin : $(date -Iseconds)"
echo "[CIQUAL] Mise à jour terminée"
