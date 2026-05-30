#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/data';
const OFF_DB = process.env.OFF_DB || path.join(DATA_DIR, 'off.db');
const LOG_FILE = path.join(DATA_DIR, 'off_update.log');
const OFF_URL = process.env.OFF_SOURCE_URL || 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const OFF_INPUT = process.env.OFF_INPUT || '';
const LIMIT = Number(process.env.OFF_IMPORT_LIMIT || '0') || 0;
const TMP_TABLE = 'aliments_import_tmp';

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
ensureDir(DATA_DIR);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function val(row, name) { return row[name] == null ? '' : String(row[name]).trim(); }
function num(row, ...names) {
  for (const name of names) {
    const raw = val(row, name).replace(',', '.');
    if (raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function kcal(row) {
  const k = num(row, 'energy-kcal_100g', 'energy-kcal_value_100g', 'kcal100');
  if (k != null && k > 0) return k;
  const kj = num(row, 'energy-kj_100g', 'energy_100g');
  if (kj != null && kj > 0) return Math.round((kj / 4.184) * 10) / 10;
  return null;
}
function pickName(row) {
  return val(row, 'product_name_fr') || val(row, 'product_name') || val(row, 'generic_name_fr') || val(row, 'generic_name');
}
function makeRow(headers, parts) {
  const row = {};
  for (let i = 0; i < headers.length; i++) row[headers[i]] = parts[i] || '';
  return row;
}
function normalizeCode(code) {
  const c = String(code || '').trim().replace(/[^0-9A-Za-z_-]/g, '');
  return c || null;
}

function download(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'FoodNote self-hosted importer/10.49' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount > 5) return reject(new Error('Trop de redirections OpenFoodFacts'));
        const nextUrl = new URL(res.headers.location, url).toString();
        log(`Redirection OpenFoodFacts: ${nextUrl}`);
        res.resume();
        return resolve(download(nextUrl, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} lors du téléchargement OpenFoodFacts`));
      }
      resolve(url.endsWith('.gz') ? res.pipe(zlib.createGunzip()) : res);
    });
    req.on('error', reject);
  });
}

async function openInputStream() {
  if (OFF_INPUT) {
    log(`Lecture fichier local: ${OFF_INPUT}`);
    const stream = fs.createReadStream(OFF_INPUT);
    return OFF_INPUT.endsWith('.gz') ? stream.pipe(zlib.createGunzip()) : stream;
  }
  log(`Téléchargement OpenFoodFacts: ${OFF_URL}`);
  return download(OFF_URL);
}

function createImportTable(db) {
  db.exec(`
    DROP TABLE IF EXISTS ${TMP_TABLE};
    CREATE TABLE ${TMP_TABLE} (
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
    CREATE INDEX IF NOT EXISTS idx_${TMP_TABLE}_code ON ${TMP_TABLE}(code);
    CREATE INDEX IF NOT EXISTS idx_${TMP_TABLE}_nom ON ${TMP_TABLE}(nom);
  `);
}

function replaceOfficialTable(db) {
  db.exec(`
    DROP TABLE IF EXISTS aliments_old_before_barcode;
    ALTER TABLE aliments RENAME TO aliments_old_before_barcode;
    ALTER TABLE ${TMP_TABLE} RENAME TO aliments;
    DROP TABLE IF EXISTS aliments_old_before_barcode;
    CREATE INDEX IF NOT EXISTS idx_off_aliments_code ON aliments(code);
    CREATE INDEX IF NOT EXISTS idx_off_aliments_nom ON aliments(nom);
    ANALYZE;
  `);
}

async function main() {
  fs.writeFileSync(LOG_FILE, '');
  log('Import OpenFoodFacts v10.49 — code-barres + import robuste gros champs');
  log(`Base cible: ${OFF_DB}`);
  log(`Source: ${OFF_INPUT || OFF_URL}`);

  const db = new Database(OFF_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS aliments (
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
  `);
  createImportTable(db);

  const insert = db.prepare(`
    INSERT INTO ${TMP_TABLE} (code, nom, marque, kcal100, prot100, gluc100, lip100, fibres100)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((items) => { for (const it of items) insert.run(...it); });

  let inserted = 0, skipped = 0, withCode = 0, lineNo = 0, rowsRead = 0;
  let batch = [];
  let headers = null;
  let hasCodeHeader = false;
  let codeHeaderName = null;

  const input = await openInputStream();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    lineNo++;
    if (!headers) {
      headers = line.split('\t').map(h => h.trim());
      codeHeaderName = ['code', 'barcode', 'ean', 'product_code'].find(h => headers.includes(h)) || null;
      hasCodeHeader = !!codeHeaderName;
      log(`Colonnes détectées: ${headers.length}`);
      log(`Premières colonnes: ${headers.slice(0, 25).join(', ')}`);
      log(`Colonne code-barres source: ${codeHeaderName || 'ABSENTE'}`);
      if (!hasCodeHeader) {
        db.exec(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
        db.close();
        throw new Error('La source OpenFoodFacts ne contient aucune colonne code/barcode/ean/product_code. Import annulé pour ne pas remplacer la base par une version non scannable.');
      }
      continue;
    }
    rowsRead++;
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const row = makeRow(headers, parts);
    const code = normalizeCode(val(row, codeHeaderName));
    const nom = pickName(row);
    const k = kcal(row);
    if (!nom || !k || k <= 0 || k >= 1000) { skipped++; continue; }
    const item = [
      code,
      nom.slice(0, 240),
      (val(row, 'brands') || val(row, 'marque')).split(',')[0].slice(0, 160) || null,
      k,
      num(row, 'proteins_100g', 'prot100'),
      num(row, 'carbohydrates_100g', 'gluc100'),
      num(row, 'fat_100g', 'lip100'),
      num(row, 'fiber_100g', 'fibres100')
    ];
    if (code) withCode++;
    batch.push(item);
    inserted++;
    if (batch.length >= 2000) { tx(batch); batch = []; }
    if (inserted % 50000 === 0) log(`Importés: ${inserted} produits (${withCode} avec code-barres, ${skipped} ignorés)`);
    if (LIMIT && inserted >= LIMIT) break;
  }
  if (batch.length) tx(batch);

  const tmpTotal = db.prepare(`SELECT COUNT(*) AS n FROM ${TMP_TABLE}`).get().n;
  const tmpWithCode = db.prepare(`SELECT COUNT(*) AS n FROM ${TMP_TABLE} WHERE code IS NOT NULL AND TRIM(code) != ''`).get().n;
  log(`Table temporaire terminée: ${tmpTotal} produits, ${tmpWithCode} avec code-barres, ${skipped} ignorés, ${rowsRead} lignes lues.`);

  if (tmpTotal === 0) {
    db.exec(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
    db.close();
    throw new Error('Import annulé: aucun produit exploitable trouvé. Ancienne base conservée.');
  }
  if (tmpWithCode === 0) {
    db.exec(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
    db.close();
    throw new Error('Import annulé: 0 produit avec code-barres. Ancienne base conservée. Vérifie la source OpenFoodFacts utilisée.');
  }

  replaceOfficialTable(db);
  const cols = db.prepare('PRAGMA table_info(aliments)').all().map(c => c.name).join(', ');
  const total = db.prepare('SELECT COUNT(*) AS n FROM aliments').get().n;
  const barcode = db.prepare("SELECT COUNT(*) AS n FROM aliments WHERE code IS NOT NULL AND TRIM(code) != ''").get().n;
  db.close();
  log(`Schéma final aliments: ${cols}`);
  log(`Terminé. Produits: ${total}. Avec code-barres: ${barcode}. Sans code-barres: ${Math.max(0, total - barcode)}. Ignorés: ${skipped}.`);
}

main().catch(err => { log(`ERREUR: ${err.stack || err.message}`); process.exit(1); });
