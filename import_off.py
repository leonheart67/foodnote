#!/usr/bin/env python3
"""
FoodNote v10.50 — import OpenFoodFacts compatible Python/Node.

But : éviter définitivement :
    _csv.Error: field larger than field limit (131072)

Priorité : utiliser import_off.js, qui lit le dump OpenFoodFacts en streaming et
conserve le champ `code` pour le scan code-barres local.

Si Node/import_off.js est indisponible, ce fichier Python peut quand même importer
le TSV/CSV avec une limite CSV fortement augmentée.
"""
import csv
import gzip
import os
import sqlite3
import subprocess
import sys
import urllib.request
from pathlib import Path

# Corrige le vrai plantage Python : limite CSV par défaut trop basse.
try:
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            break
        except OverflowError:
            limit = int(limit / 10)
except Exception:
    csv.field_size_limit(1024 * 1024 * 1024)

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
OFF_DB = Path(os.environ.get("OFF_DB", str(DATA_DIR / "off.db")))
OFF_URL = os.environ.get("OFF_SOURCE_URL", "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz")
OFF_INPUT = os.environ.get("OFF_INPUT", "")
LIMIT = int(os.environ.get("OFF_IMPORT_LIMIT", "0") or "0")
LOG_FILE = DATA_DIR / "off_update.log"


def log(msg):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    line = str(msg)
    print(line, flush=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def run_node_import_if_available():
    script = Path(__file__).with_name("import_off.js")
    if not script.exists():
        script = Path("/app/import_off.js")
    if script.exists():
        log("FoodNote v10.50: import OpenFoodFacts via import_off.js")
        return subprocess.call(["node", str(script)], env=os.environ.copy())
    return None


def clean_num(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", ".")
    if not s:
        return None
    try:
        n = float(s)
        if n != n:
            return None
        return n
    except Exception:
        return None


def first(row, *names):
    for name in names:
        v = row.get(name, "")
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def kcal(row):
    k = clean_num(first(row, "energy-kcal_100g", "energy-kcal_value_100g", "kcal100"))
    if k and k > 0:
        return k
    kj = clean_num(first(row, "energy-kj_100g", "energy_100g"))
    if kj and kj > 0:
        return round(kj / 4.184, 1)
    return None


def open_source():
    if OFF_INPUT:
        p = Path(OFF_INPUT)
        log(f"Lecture source locale OpenFoodFacts: {p}")
        raw = p.open("rb")
        return gzip.open(raw, "rt", encoding="utf-8", errors="replace", newline="") if p.suffix == ".gz" else open(p, "r", encoding="utf-8", errors="replace", newline="")
    log(f"Téléchargement OpenFoodFacts: {OFF_URL}")
    resp = urllib.request.urlopen(OFF_URL, timeout=120)
    return gzip.open(resp, "rt", encoding="utf-8", errors="replace", newline="") if OFF_URL.endswith(".gz") else resp


def build_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_FILE.write_text("", encoding="utf-8")
    log("FoodNote v10.50: import Python robuste OpenFoodFacts")
    log(f"Base cible: {OFF_DB}")

    con = sqlite3.connect(str(OFF_DB))
    cur = con.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.executescript("""
    DROP TABLE IF EXISTS aliments_import_tmp;
    CREATE TABLE aliments_import_tmp (
      id INTEGER PRIMARY KEY,
      code TEXT,
      nom TEXT NOT NULL,
      marque TEXT,
      kcal100 REAL,
      prot100 REAL,
      gluc100 REAL,
      lip100 REAL,
      fibres100 REAL
    );
    CREATE INDEX IF NOT EXISTS idx_aliments_import_tmp_code ON aliments_import_tmp(code);
    CREATE INDEX IF NOT EXISTS idx_aliments_import_tmp_nom ON aliments_import_tmp(nom);
    """)
    con.commit()

    inserted = 0
    with_code = 0
    skipped = 0
    rows_read = 0
    batch = []

    with open_source() as f:
        reader = csv.DictReader(f, delimiter="\t")
        headers = reader.fieldnames or []
        code_col = next((x for x in ["code", "barcode", "ean", "product_code"] if x in headers), None)
        log(f"Colonnes détectées: {len(headers)}")
        log("Premières colonnes: " + ", ".join(headers[:25]))
        log("Colonne code-barres source: " + (code_col or "ABSENTE"))
        if not code_col:
            cur.execute("DROP TABLE IF EXISTS aliments_import_tmp")
            con.commit(); con.close()
            raise SystemExit("ERREUR: aucune colonne code/barcode/ean/product_code. Import annulé.")

        for row in reader:
            rows_read += 1
            name = first(row, "product_name_fr", "product_name", "generic_name_fr", "generic_name")
            k = kcal(row)
            if not name or not k or k <= 0 or k >= 1000:
                skipped += 1
                continue
            code = first(row, code_col)
            code = "".join(ch for ch in code if ch.isalnum() or ch in "_-") or None
            if code:
                with_code += 1
            marque = first(row, "brands", "marque").split(",")[0][:160] or None
            batch.append((code, name[:240], marque, k,
                          clean_num(first(row, "proteins_100g", "prot100")),
                          clean_num(first(row, "carbohydrates_100g", "gluc100")),
                          clean_num(first(row, "fat_100g", "lip100")),
                          clean_num(first(row, "fiber_100g", "fibres100"))))
            inserted += 1
            if len(batch) >= 2000:
                cur.executemany("""
                  INSERT INTO aliments_import_tmp
                  (code, nom, marque, kcal100, prot100, gluc100, lip100, fibres100)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, batch)
                con.commit(); batch.clear()
            if inserted and inserted % 50000 == 0:
                log(f"Importés: {inserted} produits ({with_code} avec code-barres, {skipped} ignorés)")
            if LIMIT and inserted >= LIMIT:
                break

    if batch:
        cur.executemany("""
          INSERT INTO aliments_import_tmp
          (code, nom, marque, kcal100, prot100, gluc100, lip100, fibres100)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, batch)
        con.commit()

    total = cur.execute("SELECT COUNT(*) FROM aliments_import_tmp").fetchone()[0]
    bc = cur.execute("SELECT COUNT(*) FROM aliments_import_tmp WHERE code IS NOT NULL AND TRIM(code) != ''").fetchone()[0]
    log(f"Table temporaire: {total} produits, {bc} avec code-barres, {skipped} ignorés, {rows_read} lignes lues")
    if total <= 0 or bc <= 0:
        cur.execute("DROP TABLE IF EXISTS aliments_import_tmp")
        con.commit(); con.close()
        raise SystemExit("ERREUR: import annulé, aucun produit exploitable ou aucun code-barres. Ancienne base conservée.")

    cur.executescript("""
    DROP TABLE IF EXISTS aliments_old_before_barcode;
    ALTER TABLE aliments RENAME TO aliments_old_before_barcode;
    ALTER TABLE aliments_import_tmp RENAME TO aliments;
    DROP TABLE IF EXISTS aliments_old_before_barcode;
    CREATE INDEX IF NOT EXISTS idx_off_aliments_code ON aliments(code);
    CREATE INDEX IF NOT EXISTS idx_off_aliments_nom ON aliments(nom);
    ANALYZE;
    """)
    con.commit(); con.close()
    log(f"Terminé. Produits: {total}. Avec code-barres: {bc}. Sans code-barres: {max(0,total-bc)}.")


if __name__ == "__main__":
    # Par défaut, on privilégie le nouvel import Node. Si OFF_FORCE_PYTHON=1,
    # on utilise l'import Python robuste ci-dessus.
    if os.environ.get("OFF_FORCE_PYTHON") != "1":
        code = run_node_import_if_available()
        if code is not None:
            raise SystemExit(code)
    build_db()
