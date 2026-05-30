#!/bin/sh
set -eu
cd /app
: "${DATA_DIR:=/data}"
mkdir -p "$DATA_DIR"

# v10.50 : on lance import_off.py, qui délègue à import_off.js si présent,
# et contient aussi un fallback Python avec csv.field_size_limit augmenté.
python3 /app/import_off.py
