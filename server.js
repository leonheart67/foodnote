/*
 * FoodNote — serveur principal SQLite / API locale.
 * Rôle : exposer les API HTTP, gérer la base SQLite FoodNote, les imports locaux
 *        CIQUAL/OpenFoodFacts, les sauvegardes et les données utilisateur.
 * Gère : routes Express, accès SQLite, opérations serveur longues via scripts dédiés.
 * Ne doit pas gérer : rendu visuel frontend, logique d'affichage CSS/JS, ni état UI client.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
let mqttLib = null;
try { mqttLib = require('mqtt'); } catch (_) { mqttLib = null; }

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const PUBLIC_DIR = process.env.PUBLIC_DIR || '/app/public';
const DB_FILE = path.join(DATA_DIR, 'foodnote.db');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'journal.json');
const OFF_DB = path.join(DATA_DIR, 'off.db');
const AUTO_BACKUP_DIR = path.join(DATA_DIR, 'auto_backups');
const AUTO_BACKUP_SETTINGS_KEY = 'auto_backup_daily';
const DEFAULT_USER_ID = process.env.FOODNOTE_DEFAULT_USER || 'default';
const OFFLINE_MODE = process.env.FOODNOTE_OFFLINE_MODE === '1';
const APP_VERSION = '0.22.179';
const APP_LABEL = process.env.FOODNOTE_APP_LABEL || 'FoodNote beta 0.22.179';
const APP_BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
const FOODNOTE_DEBUG_SYNC = process.env.FOODNOTE_DEBUG_SYNC === '1';
const APP_RELEASE = 'Refactor code journal : sélections date via refresh centralisé';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(DATA_DIR);

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


function ensureTableColumn(table, column, definition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (e) {
    console.warn(`[FoodNote DB] colonne ${table}.${column} non ajoutée:`, e.message);
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  token_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_state (
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, namespace),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_targets (
  user_id TEXT PRIMARY KEY,
  kcal_target REAL,
  prot_target REAL,
  gluc_target REAL,
  lip_target REAL,
  source TEXT DEFAULT 'profile_json',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS secrets (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kcal100 REAL DEFAULT 0,
  prot100 REAL DEFAULT 0,
  gluc100 REAL DEFAULT 0,
  lip100 REAL DEFAULT 0,
  source TEXT DEFAULT 'user',
  favorite INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS food_deletions (
  user_id TEXT NOT NULL,
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, name_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  poids REAL,
  energie TEXT,
  faim TEXT,
  notes TEXT,
  extras TEXT,
  question TEXT,
  dep_sport REAL DEFAULT 0,
  net_kcal REAL DEFAULT 0,
  kcal REAL DEFAULT 0,
  prot REAL DEFAULT 0,
  gluc REAL DEFAULT 0,
  lip REAL DEFAULT 0,
  raw_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  write_id TEXT,
  client_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entry_foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  food_id INTEGER,
  name_snapshot TEXT NOT NULL,
  qty REAL DEFAULT 0,
  unit TEXT DEFAULT 'g',
  kcal REAL DEFAULT 0,
  prot REAL DEFAULT 0,
  gluc REAL DEFAULT 0,
  lip REAL DEFAULT 0,
  meal TEXT DEFAULT 'none',
  FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY(food_id) REFERENCES foods(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  hours REAL DEFAULT 0,
  kcal_h REAL DEFAULT 0,
  total REAL DEFAULT 0,
  FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  weeks INTEGER DEFAULT 1,
  kcal_target REAL,
  prot_target REAL,
  gluc_target REAL,
  lip_target REAL,
  order_index INTEGER DEFAULT 0,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS food_unit_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  grams REAL NOT NULL,
  source TEXT DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_unit_weights_user_label ON food_unit_weights(user_id, LOWER(label));

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_foods_user_name ON foods(user_id, name);
CREATE INDEX IF NOT EXISTS idx_app_state_user_namespace ON app_state(user_id, namespace);
`);




// ── FoodNote — Recettes + import scan/photo ───────────
db.exec(`
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  photo_data TEXT,
  portions REAL DEFAULT 1,
  total_weight REAL DEFAULT 0,
  kcal_total REAL DEFAULT 0,
  prot_total REAL DEFAULT 0,
  gluc_total REAL DEFAULT 0,
  lip_total REAL DEFAULT 0,
  kcal100 REAL DEFAULT 0,
  prot100 REAL DEFAULT 0,
  gluc100 REAL DEFAULT 0,
  lip100 REAL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  creation_source TEXT DEFAULT 'manual',
  is_ai_estimated INTEGER DEFAULT 0,
  raw_scan_text TEXT,
  ai_estimation_json TEXT,
  notes TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  qty REAL DEFAULT 0,
  unit TEXT DEFAULT 'g',
  unit_weight REAL,
  unit_label TEXT,
  kcal REAL DEFAULT 0,
  prot REAL DEFAULT 0,
  gluc REAL DEFAULT 0,
  lip REAL DEFAULT 0,
  kcal100 REAL DEFAULT 0,
  prot100 REAL DEFAULT 0,
  gluc100 REAL DEFAULT 0,
  lip100 REAL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipes_user_name ON recipes(user_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}
ensureColumn('foods', 'unit', "TEXT DEFAULT 'g'");
ensureColumn('foods', 'unit_weight', 'REAL');
ensureColumn('foods', 'unit_label', 'TEXT');
ensureColumn('entry_foods', 'unit_weight', 'REAL');
ensureColumn('entry_foods', 'unit_label', 'TEXT');
ensureColumn('entry_foods', 'line_uid', 'TEXT');

function foodnoteRoundGramQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

function normalizeEntryFoodStorageToGrams(row) {
  // 0.22.0 — source de vérité stricte : une ligne repas stocke des grammes.
  // Plus aucune conversion automatique unité × poids_unité pendant la sauvegarde.
  const qty = Number(row?.qty ?? row?.quantity ?? row?.quantite ?? 0) || 0;
  return foodnoteRoundGramQty(qty);
}

function migrateEntryFoodUnitsToGrams() {
  try {
    const cols = db.prepare('PRAGMA table_info(entry_foods)').all().map(c => c.name);
    if (!cols.includes('unit') || !cols.includes('unit_weight')) return;
    const rows = db.prepare(`
      SELECT id, qty, unit, unit_weight
      FROM entry_foods
      WHERE COALESCE(unit, 'g') <> 'g' OR COALESCE(unit_weight, 0) > 0 OR COALESCE(unit_label, '') <> ''
    `).all();
    const upd = db.prepare(`UPDATE entry_foods SET qty=?, unit='g', unit_weight=NULL, unit_label='' WHERE id=?`);
    let changed = 0;
    const tx = db.transaction(() => {
      for (const row of rows) {
        const grams = normalizeEntryFoodStorageToGrams(row);
        upd.run(grams, row.id);
        changed++;
      }
    });
    if (rows.length) tx();
    if (changed) console.log(`[FoodNote migration] ${changed} ligne(s) aliment convertie(s) en grammes pour stabiliser les quantités.`);
  } catch (e) {
    console.warn('[FoodNote migration] conversion unités -> grammes impossible:', e.message);
  }
}

migrateEntryFoodUnitsToGrams();
ensureColumn('recipes', 'creation_source', "TEXT DEFAULT 'manual'");
ensureColumn('recipes', 'is_ai_estimated', 'INTEGER DEFAULT 0');
ensureColumn('recipes', 'raw_scan_text', 'TEXT');
ensureColumn('recipes', 'ai_estimation_json', 'TEXT');

// Migrations douces pour les bases FoodNote déjà existantes.
// IMPORTANT v11.61 : on ne force plus la colonne entries.revision.
// Certaines bases existantes refusent/ignorent l'ALTER TABLE selon leur état,
// puis le POST plantait si le serveur tentait d'écrire cette colonne.
// La protection anti-écrasement reste active via le comptage aliments/sports/kcal.
ensureColumn('entries', 'raw_json', 'TEXT');
ensureColumn('entries', 'updated_at', 'TEXT');
ensureColumn('entries', 'created_at', 'TEXT');
ensureColumn('entries', 'extras', 'TEXT');
ensureColumn('entries', 'question', 'TEXT');
ensureColumn('entries', 'dep_sport', 'REAL DEFAULT 0');
ensureColumn('entries', 'net_kcal', 'REAL DEFAULT 0');
ensureColumn('entries', 'kcal', 'REAL DEFAULT 0');
ensureColumn('entries', 'prot', 'REAL DEFAULT 0');
ensureColumn('entries', 'gluc', 'REAL DEFAULT 0');
ensureColumn('entries', 'lip', 'REAL DEFAULT 0');
// FoodNote 0.18.10 — compat bases anciennes : ces colonnes existaient
// dans les nouvelles installations, mais pas toujours après migration.
// /api/entries?details=0 les sélectionnait et pouvait donc répondre HTTP 500.
ensureColumn('entries', 'revision', 'INTEGER DEFAULT 1');
ensureColumn('entries', 'write_id', 'TEXT');
ensureColumn('entries', 'client_id', 'TEXT');


// FoodNote 0.18.1 — centre d'anomalies données.
// Objectif : ne plus bloquer l'application quand une ancienne donnée est incohérente.
// On notifie, on garde le lien vers la source, puis l'utilisateur corrige/ignore depuis l'UI.
db.exec(`
CREATE TABLE IF NOT EXISTS data_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT,
  source_key TEXT NOT NULL,
  source_date TEXT,
  food_name TEXT,
  food_index INTEGER,
  severity TEXT NOT NULL DEFAULT 'warning',
  kind TEXT NOT NULL DEFAULT 'nutrition',
  message TEXT NOT NULL,
  detected_value TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_data_anomalies_user_status ON data_anomalies(user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_data_anomalies_user_date ON data_anomalies(user_id, source_date);
`);
ensureColumn('data_anomalies', 'source_table', "TEXT DEFAULT 'unknown'");
ensureColumn('data_anomalies', 'source_id', 'TEXT');
ensureColumn('data_anomalies', 'source_key', "TEXT DEFAULT ''");
ensureColumn('data_anomalies', 'source_date', 'TEXT');
ensureColumn('data_anomalies', 'food_name', 'TEXT');
ensureColumn('data_anomalies', 'food_index', 'INTEGER');
ensureColumn('data_anomalies', 'severity', "TEXT DEFAULT 'warning'");
ensureColumn('data_anomalies', 'kind', "TEXT DEFAULT 'nutrition'");
ensureColumn('data_anomalies', 'message', 'TEXT');
ensureColumn('data_anomalies', 'detected_value', 'TEXT');
ensureColumn('data_anomalies', 'status', "TEXT DEFAULT 'open'");
ensureColumn('data_anomalies', 'raw_json', 'TEXT');
ensureColumn('data_anomalies', 'updated_at', 'TEXT');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function getUserId(req) {
  const raw = req.get('x-foodnote-user') || req.query.user || DEFAULT_USER_ID;
  return String(raw || DEFAULT_USER_ID).replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80) || DEFAULT_USER_ID;
}

function ensureUser(userId, displayName = null) {
  db.prepare(`
    INSERT INTO users (id, display_name)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP
  `).run(userId, displayName);
}

function requireUser(req, res, next) {
  const userId = getUserId(req);
  ensureUser(userId);
  req.foodnoteUserId = userId;
  next();
}

function getState(userId, namespace, fallback = {}) {
  const row = db.prepare('SELECT data_json FROM app_state WHERE user_id=? AND namespace=?').get(userId, namespace);
  if (!row) return fallback;
  return safeJsonParse(row.data_json, fallback);
}

function setState(userId, namespace, data) {
  db.prepare(`
    INSERT INTO app_state (user_id, namespace, data_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, namespace) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP
  `).run(userId, namespace, JSON.stringify(data || {}, null, 2));
}

function looksLikeJournalEntry(item) {
  return !!(item && typeof item === 'object' && item.date && (
    Array.isArray(item.aliments) || Array.isArray(item.foods) || Array.isArray(item.sports) ||
    item.macros || item.kcal !== undefined || item.poids !== undefined || item.notes !== undefined
  ));
}

function entriesFromDateMap(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) continue;
    if (value && typeof value === 'object') out.push({ date: key, ...value });
  }
  return out.filter(looksLikeJournalEntry);
}

function normalizeEntriesPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload.filter(looksLikeJournalEntry);

  const directKeys = [
    'journal_entries', 'entries', 'entryList', 'history', 'historique', 'journal',
    'days', 'jours', 'diary', 'log', 'logs', 'records'
  ];
  for (const key of directKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const arr = value.filter(looksLikeJournalEntry);
      if (arr.length) return arr;
    }
    const mapped = entriesFromDateMap(value);
    if (mapped.length) return mapped;
  }

  const data = payload.data || payload.state || payload.db || payload.backup || payload.export;
  if (data && data !== payload) {
    const nested = normalizeEntriesPayload(data);
    if (nested.length) return nested;
  }

  const rootMap = entriesFromDateMap(payload);
  if (rootMap.length) return rootMap;

  // Dernier filet de sécurité : cherche une liste d'objets datés dans un ancien JSON,
  // sans confondre avec les listes d'aliments.
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      const arr = value.filter(looksLikeJournalEntry);
      if (arr.length) return arr;
    }
  }
  return [];
}

function getSqliteColumnSet(table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  } catch (_) {
    return new Set();
  }
}

function upsertNormalizedEntry(userId, entry) {
  if (!entry || !entry.date) return;
  assertNutritionEntryAllowed(entry);
  const macros = entry.macros || {};
  const entryCols = getSqliteColumnSet('entries');
  const now = new Date().toISOString();

  // 0.22.47 — Protection anti-écrasement résumé :
  // une sauvegarde générale peut arriver depuis une journée chargée en mode résumé.
  // Dans ce cas, on conserve les détails normalisés déjà présents au lieu de
  // réécrire raw_json avec aliments:[] / sports:[].
  const existingEntryForSport = db.prepare('SELECT id, dep_sport, raw_json FROM entries WHERE user_id=? AND date=?').get(userId, String(entry.date));
  const incomingFoodsRaw = Array.isArray(entry.aliments) ? entry.aliments.filter(Boolean) : [];
  const replaceFoodsExplicit = !!(entry.__replaceFoods || entry.replaceFoods || entry._replaceFoods);
  const existingFoodsForEntry = existingEntryForSport
    ? db.prepare(`
        SELECT id AS entryFoodId, id AS entry_food_id, line_uid, name_snapshot AS nom, qty, unit AS unite,
               unit_weight AS poidsUnite, unit_label AS uniteLabel, kcal, prot, gluc, lip, meal
        FROM entry_foods
        WHERE entry_id=?
        ORDER BY id
      `).all(existingEntryForSport.id).map(serverCleanEntryFoodRow)
    : [];
  const preserveExistingFoods = !replaceFoodsExplicit && incomingFoodsRaw.length === 0 && existingFoodsForEntry.length > 0;
  const foodRowsForRawJson = preserveExistingFoods ? existingFoodsForEntry : incomingFoodsRaw;

  const existingSportsForEntry = existingEntryForSport
    ? db.prepare('SELECT name AS nom, hours AS heures, kcal_h AS kcalH, total FROM sports WHERE entry_id=? ORDER BY id').all(existingEntryForSport.id)
    : [];
  const incomingSportsRaw = Array.isArray(entry.sports) ? entry.sports.filter(Boolean) : [];
  const replaceSportsExplicit = !!(entry.__replaceSports || entry.replaceSports || entry._replaceSports);
  const preserveExistingSports = !replaceSportsExplicit && incomingSportsRaw.length === 0 && existingSportsForEntry.length > 0;
  const sportRowsForDb = preserveExistingSports ? existingSportsForEntry : incomingSportsRaw;
  const computedDepSport = sportRowsForDb.reduce((sum, s) => {
    const heures = Number(s.heures ?? s.hours ?? s.duree ?? s.duration ?? 0) || 0;
    const kcalH = Number(s.kcalH ?? s.kcal_h ?? s.kcal_horaire ?? 0) || 0;
    const total = Number(s.total ?? (heures * kcalH) ?? 0) || 0;
    return sum + total;
  }, 0);
  const depSportForDb = computedDepSport > 0
    ? computedDepSport
    : Number(entry.depSport ?? entry.dep_sport ?? existingEntryForSport?.dep_sport ?? 0) || 0;
  const macrosForDb = preserveExistingFoods && (!entry.macros || Number(macros.kcal || 0) <= 0)
    ? recomputeMacrosFromApiFoods(foodRowsForRawJson)
    : macros;
  const rawEntryForDb = {
    ...entry,
    aliments: foodRowsForRawJson,
    sports: sportRowsForDb,
    depSport: depSportForDb,
    dep_sport: depSportForDb,
    macros: macrosForDb
  };

  const rowData = {
    user_id: userId,
    date: String(entry.date),
    poids: entry.poids === '' || entry.poids == null ? null : Number(entry.poids),
    energie: entry.energie || null,
    faim: entry.faim || null,
    notes: entry.notes || null,
    extras: entry.extras || null,
    question: entry.question || null,
    dep_sport: depSportForDb,
    net_kcal: Number((preserveExistingFoods ? (Number(macrosForDb.kcal || 0) - depSportForDb) : (entry.netKcal ?? entry.net_kcal)) || 0),
    kcal: Number(macrosForDb.kcal || entry.kcal || 0),
    prot: Number(macrosForDb.prot || entry.prot || 0),
    gluc: Number(macrosForDb.gluc || entry.gluc || 0),
    lip: Number(macrosForDb.lip || entry.lip || 0),
    raw_json: JSON.stringify(rawEntryForDb),
    write_id: String(entry.write_id || entry.writeId || crypto.randomUUID()),
    client_id: String(entry.client_id || entry.clientId || '').slice(0, 80) || null,
    updated_at: now,
  };

  // v11.61 : compat stricte avec les anciennes bases.
  // On n'écrit que dans les colonnes réellement présentes dans SQLite,
  // et on n'écrit jamais entries.revision pour éviter l'erreur
  // "table entries has no column named revision" sur les bases anciennes.
  const insertCols = Object.keys(rowData).filter(c => c !== 'revision' && entryCols.has(c));
  const placeholders = insertCols.map(() => '?').join(', ');
  const updateSql = insertCols
    .filter(c => c !== 'user_id' && c !== 'date' && c !== 'revision')
    .map(c => `${c}=excluded.${c}`)
    .join(',\n      ');

  const sql = `
    INSERT INTO entries (${insertCols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(user_id, date) DO UPDATE SET
      ${updateSql || 'date=excluded.date'}
  `;

  db.prepare(sql).run(...insertCols.map(c => rowData[c]));

  const e = db.prepare('SELECT id FROM entries WHERE user_id=? AND date=?').get(userId, String(entry.date));
  if (!e) return;
  const entryId = e.id;

  const existingFoodCount = db.prepare('SELECT COUNT(*) AS n FROM entry_foods WHERE entry_id=?').get(entryId).n || 0;
  // 0.22.0 : une sauvegarde générale ne remplace plus les lignes repas existantes.
  // Les aliments sont modifiés via POST/PATCH/DELETE atomiques pour éviter qu'une tomate
  // réécrive les quantités de pêches/pain/chocolat.
  const shouldReplaceFoods = replaceFoodsExplicit || (existingFoodCount === 0 && incomingFoodsRaw.length > 0);

  if (shouldReplaceFoods) {
    db.prepare('DELETE FROM entry_foods WHERE entry_id=?').run(entryId);
    const foodCols = getSqliteColumnSet('entry_foods');
    const requestedFoodCols = ['entry_id', 'food_id', 'line_uid', 'name_snapshot', 'qty', 'unit', 'unit_weight', 'unit_label', 'kcal', 'prot', 'gluc', 'lip', 'meal'];
    const insertFoodCols = requestedFoodCols.filter(c => foodCols.has(c));
    const foodSql = `INSERT INTO entry_foods (${insertFoodCols.join(', ')}) VALUES (${insertFoodCols.map(() => '?').join(', ')})`;
    const insertFood = db.prepare(foodSql);

    for (const a of incomingFoodsRaw) {
      const cleaned = cleanFoodAppendPayload(a);
      if (!cleaned) continue;
      const foodData = {
        entry_id: entryId,
        food_id: cleaned.food_id,
        line_uid: cleaned.line_uid,
        name_snapshot: cleaned.nom,
        qty: cleaned.qty,
        unit: 'g',
        unit_weight: null,
        unit_label: '',
        kcal: cleaned.kcal,
        prot: cleaned.prot,
        gluc: cleaned.gluc,
        lip: cleaned.lip,
        meal: cleaned.meal
      };
      insertFood.run(...insertFoodCols.map(c => foodData[c]));
    }
  }

  db.prepare('DELETE FROM sports WHERE entry_id=?').run(entryId);

  const sportCols = getSqliteColumnSet('sports');
  const requestedSportCols = ['entry_id', 'name', 'hours', 'kcal_h', 'total'];
  const insertSportCols = requestedSportCols.filter(c => sportCols.has(c));
  const sportSql = `INSERT INTO sports (${insertSportCols.join(', ')}) VALUES (${insertSportCols.map(() => '?').join(', ')})`;
  const insertSport = db.prepare(sportSql);

  for (const s of sportRowsForDb || []) {
    const hours = Number(s.hours ?? s.heures ?? s.duree ?? s.duration ?? 0) || 0;
    const kcalH = Number(s.kcal_h ?? s.kcalH ?? s.kcal_horaire ?? 0) || 0;
    const total = Number(s.total ?? (hours * kcalH) ?? 0) || 0;
    const sportData = {
      entry_id: entryId,
      name: String(s.name || s.nom || 'Sport'),
      hours,
      kcal_h: kcalH,
      total: Math.round(total)
    };
    insertSport.run(...insertSportCols.map(c => sportData[c]));
  }
  try { recalcEntryAggregatesFromRows(userId, entryId, entry); } catch(e) { console.warn('[FoodNote] recalc agrégats après upsert ignoré:', e.message); }
}

const normalizeAllEntries = db.transaction((userId, payload, options = {}) => {
  const entries = normalizeEntriesPayload(payload);
  let normalized = 0;
  let skipped = 0;
  for (const entry of entries) {
    try {
      upsertNormalizedEntry(userId, entry);
      normalized++;
    } catch (e) {
      if (!options.skipInvalid) throw e;
      skipped++;
      console.warn(`[FoodNote] Journée ignorée pendant normalisation SQLite (${entry?.date || 'date inconnue'}): ${e.message}`);
    }
  }
  return options.details ? { total: entries.length, normalized, skipped } : normalized;
});

function normalizeStoredStateForUser(userId, options = {}) {
  const state = getState(userId, 'data', {});
  const result = normalizeAllEntries(userId, state, { ...options, details: true });
  return { ok: true, user_id: userId, normalized_entries: result.normalized, skipped_entries: result.skipped, total_entries: result.total };
}

function normalizeStoredStateForAllUsers(options = {}) {
  const users = db.prepare('SELECT id FROM users').all();
  const results = [];
  for (const u of users) results.push(normalizeStoredStateForUser(u.id, options));
  return results;
}

function sqliteCountsForUser(userId) {
  const structuredEntries = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id=?').get(userId).n;
  const state = getState(userId, 'data', {});
  const compatibleEntries = normalizeEntriesPayload(state).length;
  return {
    user_id: userId,
    entries: structuredEntries,
    compatible_entries: compatibleEntries,
    entry_foods: db.prepare('SELECT COUNT(*) AS n FROM entry_foods ef JOIN entries e ON e.id=ef.entry_id WHERE e.user_id=?').get(userId).n,
    sports: db.prepare('SELECT COUNT(*) AS n FROM sports s JOIN entries e ON e.id=s.entry_id WHERE e.user_id=?').get(userId).n,
    foods: db.prepare('SELECT COUNT(*) AS n FROM foods WHERE user_id=?').get(userId).n,
    phases: db.prepare('SELECT COUNT(*) AS n FROM phases WHERE user_id=?').get(userId).n,
    unit_weights: db.prepare('SELECT COUNT(*) AS n FROM food_unit_weights WHERE user_id=?').get(userId).n,
    recipes: db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id=?').get(userId).n,
    recipe_ingredients: db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredients ri JOIN recipes r ON r.id=ri.recipe_id WHERE r.user_id=?').get(userId).n,
  };
}


function phaseTargetValue(rowValue, raw, keys) {
  const rowNum = toNumberOrNull(rowValue);
  if (rowNum !== null) return rowNum;
  for (const k of keys) {
    const v = toNumberOrNull(raw && raw[k]);
    if (v !== null) return v;
  }
  return null;
}

function enrichPhaseTargetsFromRow(row, rawPhase) {
  const ph = rawPhase && typeof rawPhase === 'object' ? { ...rawPhase } : {};
  ph.id = ph.id || String(row.name || row.id || '').toLowerCase().replace(/\s+/g, '_');
  ph.name = ph.name || row.name;
  ph.label = ph.label || row.name;
  ph.weeks = ph.weeks || row.weeks || 1;
  const kcal = phaseTargetValue(row.kcal_target, ph, ['cibleKcal','kcalTarget','kcal','kcal_target']);
  const prot = phaseTargetValue(row.prot_target, ph, ['cibleProt','protTarget','prot','prot_target']);
  const gluc = phaseTargetValue(row.gluc_target, ph, ['cibleGluc','glucTarget','gluc','gluc_target']);
  const lip  = phaseTargetValue(row.lip_target,  ph, ['cibleLip','lipTarget','lip','lip_target']);
  if (kcal !== null) ph.cibleKcal = ph.kcalTarget = ph.kcal = kcal;
  if (prot !== null) ph.cibleProt = ph.protTarget = ph.prot = prot;
  if (gluc !== null) ph.cibleGluc = ph.glucTarget = ph.gluc = gluc;
  if (lip  !== null) ph.cibleLip  = ph.lipTarget  = ph.lip  = lip;
  return ph;
}

function getPhasesForUser(userId) {
  return db.prepare('SELECT * FROM phases WHERE user_id=? ORDER BY order_index, id').all(userId).map(row => {
    const raw = safeJsonParse(row.raw_json, null);
    return enrichPhaseTargetsFromRow(row, raw);
  }).filter(Boolean);
}

function extractProfileCandidate(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.profile && typeof obj.profile === 'object') return extractProfileCandidate(obj.profile);
  if (obj.profil && typeof obj.profil === 'object') return extractProfileCandidate(obj.profil);
  if (obj.userProfile && typeof obj.userProfile === 'object') return extractProfileCandidate(obj.userProfile);
  if (obj.foodnote_profil && typeof obj.foodnote_profil === 'object') return extractProfileCandidate(obj.foodnote_profil);
  const keys = ['prenom','name','poids','taille','age','sexe','activite','activityFactor','phase','objectif','phaseLabel','cibleKcal','cibleProt','cibleGluc','cibleLip','tdee','onboardingDone','phases'];
  if (keys.some(k => Object.prototype.hasOwnProperty.call(obj, k))) return obj;
  return null;
}

function extractSettingsCandidate(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.settings && typeof obj.settings === 'object') return obj.settings;
  if (obj.options && typeof obj.options === 'object') return obj.options;
  return null;
}

function deriveProfileFromAppState(userId) {
  const rows = db.prepare('SELECT namespace, data_json FROM app_state WHERE user_id=? ORDER BY updated_at DESC').all(userId);
  let profile = null;
  let phases = [];
  let settings = null;
  for (const row of rows) {
    const data = safeJsonParse(row.data_json, null);
    if (!profile) profile = extractProfileCandidate(data);
    if (!phases.length) phases = normalizePhasesPayload(data);
    if (!settings) settings = extractSettingsCandidate(data);
    if (profile && phases.length && settings) break;
  }
  return { profile, phases, settings };
}

function normalizeProfileTargets(profile, phases) {
  const p = { ...(profileDefault ? profileDefault() : {}), ...(profile || {}) };
  const phaseList = Array.isArray(phases) && phases.length ? phases : (Array.isArray(p.phases) ? p.phases : []);
  if (phaseList.length) {
    p.phases = phaseList;
    p.phase = p.phase || phaseList[0]?.id || phaseList[0]?.name || 'maintenance';
    p.phaseLabel = p.phaseLabel || phaseList.map(ph => (ph.label || ph.name || ph.id || 'Phase') + ' (' + (ph.weeks || 1) + 'sem)').join(' → ');
    const active = phaseList.find(ph => (ph.id && ph.id === p.phase) || (ph.name && ph.name === p.phase)) || phaseList[0];
    p.cibleKcal = p.cibleKcal || active?.cibleKcal || active?.kcalTarget || active?.kcal || active?.kcal_target || 2000;
    p.cibleProt = p.cibleProt || active?.cibleProt || active?.protTarget || active?.prot || active?.prot_target || 120;
    p.cibleGluc = p.cibleGluc || active?.cibleGluc || active?.glucTarget || active?.gluc || active?.gluc_target || 220;
    p.cibleLip  = p.cibleLip  || active?.cibleLip  || active?.lipTarget  || active?.lip  || active?.lip_target  || 70;
    if (!p.objectif && typeof finalObjectiveFromServerPhases === 'function') p.objectif = finalObjectiveFromServerPhases(phaseList);
  }
  p.cibleKcal = Number(p.cibleKcal || 2000);
  p.cibleProt = Number(p.cibleProt || 120);
  p.cibleGluc = Number(p.cibleGluc || 220);
  p.cibleLip = Number(p.cibleLip || 70);
  return p;
}


function profileTargetSnapshot(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const snap = {
    kcal: toNumberOrNull(profile.cibleKcal ?? profile.kcalTarget ?? profile.kcal_target),
    prot: toNumberOrNull(profile.cibleProt ?? profile.protTarget ?? profile.prot_target),
    gluc: toNumberOrNull(profile.cibleGluc ?? profile.glucTarget ?? profile.gluc_target),
    lip:  toNumberOrNull(profile.cibleLip  ?? profile.lipTarget  ?? profile.lip_target)
  };
  return Object.values(snap).some(v => v !== null) ? snap : null;
}

function applyTargetsToProfile(profile, targets) {
  const p = { ...(profile || {}) };
  if (!targets) return p;
  if (targets.kcal !== null && targets.kcal !== undefined) p.cibleKcal = Number(targets.kcal);
  if (targets.prot !== null && targets.prot !== undefined) p.cibleProt = Number(targets.prot);
  if (targets.gluc !== null && targets.gluc !== undefined) p.cibleGluc = Number(targets.gluc);
  if (targets.lip  !== null && targets.lip  !== undefined) p.cibleLip  = Number(targets.lip);
  return p;
}

function getProfileTargetsForUser(userId) {
  try {
    const row = db.prepare('SELECT kcal_target, prot_target, gluc_target, lip_target, source, updated_at FROM profile_targets WHERE user_id=?').get(userId);
    if (!row) return null;
    const targets = {
      kcal: toNumberOrNull(row.kcal_target),
      prot: toNumberOrNull(row.prot_target),
      gluc: toNumberOrNull(row.gluc_target),
      lip:  toNumberOrNull(row.lip_target),
      source: row.source || 'profile_targets',
      updated_at: row.updated_at || null
    };
    return Object.values({kcal:targets.kcal, prot:targets.prot, gluc:targets.gluc, lip:targets.lip}).some(v => v !== null) ? targets : null;
  } catch (_) { return null; }
}

function upsertProfileTargetsForUser(userId, targets, source = 'profile_json') {
  if (!targets) return null;
  db.prepare(`
    INSERT INTO profile_targets (user_id, kcal_target, prot_target, gluc_target, lip_target, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      kcal_target=excluded.kcal_target,
      prot_target=excluded.prot_target,
      gluc_target=excluded.gluc_target,
      lip_target=excluded.lip_target,
      source=excluded.source,
      updated_at=CURRENT_TIMESTAMP
  `).run(userId, targets.kcal, targets.prot, targets.gluc, targets.lip, source);
  return getProfileTargetsForUser(userId);
}

function persistProfileWithTargets(userId, profile, source = 'profile_json') {
  const jsonTargets = profileTargetSnapshot(profile);
  let sqlTargets = getProfileTargetsForUser(userId);
  if (!sqlTargets && jsonTargets) sqlTargets = upsertProfileTargetsForUser(userId, jsonTargets, source);
  const finalTargets = sqlTargets || jsonTargets;
  const finalProfile = applyTargetsToProfile(profile, finalTargets);
  if (finalTargets) {
    db.prepare('UPDATE profiles SET data_json=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?')
      .run(JSON.stringify(finalProfile, null, 2), userId);
  }
  return { profile: finalProfile, targets: finalTargets };
}

function phaseKeySet(ph) {
  return new Set([ph?.id, ph?.name, ph?.label].filter(Boolean).map(v => String(v).toLowerCase()));
}

function syncActivePhaseTargetSnapshot(userId, profile) {
  const targets = profileTargetSnapshot(profile) || getProfileTargetsForUser(userId);
  if (!targets) return;
  const rows = db.prepare('SELECT id, name, order_index, raw_json FROM phases WHERE user_id=? ORDER BY order_index, id').all(userId);
  if (!rows.length) return;
  const wanted = String(profile?.phase || '').toLowerCase();
  let active = rows.find(row => {
    const raw = safeJsonParse(row.raw_json, {}) || {};
    const keys = phaseKeySet({ id: raw.id, name: raw.name || row.name, label: raw.label || row.name });
    return wanted && keys.has(wanted);
  }) || rows[0];
  const raw = safeJsonParse(active.raw_json, {}) || {};
  raw.cibleKcal = raw.kcalTarget = raw.kcal = targets.kcal;
  raw.cibleProt = raw.protTarget = raw.prot = targets.prot;
  raw.cibleGluc = raw.glucTarget = raw.gluc = targets.gluc;
  raw.cibleLip  = raw.lipTarget  = raw.lip  = targets.lip;
  db.prepare(`
    UPDATE phases SET
      kcal_target=?, prot_target=?, gluc_target=?, lip_target=?, raw_json=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND user_id=?
  `).run(targets.kcal, targets.prot, targets.gluc, targets.lip, JSON.stringify(raw), active.id, userId);
}

function finalObjectiveFromServerPhases(phases) {
  if (!Array.isArray(phases) || !phases.length) return 'maintenance';
  const last = phases[phases.length - 1] || {};
  return last.objectif || last.goal || last.id || last.name || 'maintenance';
}

function buildProfileResponseForUser(userId) {
  const row = db.prepare('SELECT data_json, updated_at FROM profiles WHERE user_id=?').get(userId);
  let phases = getPhasesForUser(userId);
  const fallback = deriveProfileFromAppState(userId);
  let source = 'default';
  let profile = null;

  if (row) {
    profile = safeJsonParse(row.data_json, null);
    source = 'profiles';
  } else if (fallback.profile) {
    profile = fallback.profile;
    source = 'app_state';
  }
  if (!phases.length && fallback.phases.length) phases = fallback.phases;
  if (!phases.length && Array.isArray(profile?.phases)) phases = profile.phases;

  profile = normalizeProfileTargets(profile, phases);
  if (row || fallback.profile) {
    const persisted = persistProfileWithTargets(userId, profile, source);
    profile = persisted.profile;
    syncActivePhaseTargetSnapshot(userId, profile);
    phases = getPhasesForUser(userId);
    if (!phases.length && Array.isArray(profile?.phases)) phases = profile.phases;
    if (phases.length) profile.phases = phases;
  }
  return {
    user_id: userId,
    exists: !!(row || fallback.profile || phases.length || profile.onboardingDone || profile.prenom || profile.poids),
    source,
    profile,
    targets: getProfileTargetsForUser(userId) || profileTargetSnapshot(profile),
    phases: Array.isArray(profile.phases) ? profile.phases : phases,
    updated_at: row?.updated_at || null
  };
}

function rebuildProfileFromFallbacks(userId) {
  const current = buildProfileResponseForUser(userId);
  const phases = current.phases || [];
  const tx = db.transaction(() => {
    ensureUser(userId, current.profile?.prenom || current.profile?.name || null);
    db.prepare(`
      INSERT INTO profiles (user_id, data_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP
    `).run(userId, JSON.stringify(current.profile, null, 2));
    if (phases.length) writePhasesForUser(userId, phases);
  });
  tx();
  return buildProfileResponseForUser(userId);
}


function normalizeFoodsPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.foods)) return payload.foods;
  if (Array.isArray(payload.bdd_aliments)) return payload.bdd_aliments;
  if (payload.data && Array.isArray(payload.data.bdd_aliments)) return payload.data.bdd_aliments;
  return [];
}


function serverNormUnitText(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const SERVER_UNIT_RULES = [
  { label: 'oeuf', grams: 60, aliases: ['oeuf','oeufs','oeuf entier','oeufs entiers'] },
  { label: 'banane', grams: 120, aliases: ['banane','banana'] },
  { label: 'pomme', grams: 150, aliases: ['pomme'] },
  { label: 'poire', grams: 160, aliases: ['poire'] },
  { label: 'orange', grams: 150, aliases: ['orange'] },
  { label: 'clementine', grams: 70, aliases: ['clementine','mandarine'] },
  { label: 'kiwi', grams: 75, aliases: ['kiwi'] },
  { label: 'peche', grams: 150, aliases: ['peche','nectarine'] },
  { label: 'abricot', grams: 45, aliases: ['abricot'] },
  { label: 'avocat', grams: 150, aliases: ['avocat'] },
  { label: 'tomate', grams: 120, aliases: ['tomate'] },
  { label: 'yaourt', grams: 125, aliases: ['yaourt','pot de yaourt','fromage blanc individuel','skyr individuel'] }
];
const SERVER_KNOWN_UNIT_LABELS = new Set(SERVER_UNIT_RULES.flatMap(r => [r.label, ...(r.aliases || [])].map(serverNormUnitText)));
const SERVER_DEFAULT_UNIT_GRAMS = new Set(SERVER_UNIT_RULES.map(r => Number(r.grams)));
const SERVER_SAFE_UNIT_DESCRIPTORS = new Set([
  'bio','frais','fraiche','fraiches','cru','crue','crues','cuit','cuite','cuites',
  'entier','entiere','entiers','entieres','dur','dure','durs','dures',
  'gros','grosse','grosses','petit','petite','petits','petites','moyen','moyenne','moyennes',
  'calibre','nature','blanc','blanche','blanches','rouge','rouges','vert','verte','vertes','jaune','jaunes',
  'mur','mure','mures','muri','murie','local','locale','locales','france','francais','francaise',
  'golden','granny','smith','royal','gala','pink','lady'
]);
const SERVER_UNIT_CONNECTORS = new Set(['de','des','du','d','a','au','aux','avec','sans','pour','en','et','type','style','facon']);
function serverTokens(v) { return serverNormUnitText(v).split(' ').filter(Boolean); }
function serverTokenMatchesAlias(token, base) {
  return token === base || token === base + 's' || (base.endsWith('s') && token === base.slice(0, -1));
}
function serverKnownToken(t) { return SERVER_KNOWN_UNIT_LABELS.has(serverNormUnitText(t)); }
function serverNameLooksComposedForAutoUnit(name) {
  const tokens = serverTokens(name);
  if (tokens.length <= 1) return false;
  if (tokens.some(t => SERVER_UNIT_CONNECTORS.has(t))) return true;
  if (tokens.some(serverKnownToken)) return tokens.some(t => !serverKnownToken(t) && !SERVER_SAFE_UNIT_DESCRIPTORS.has(t));
  return false;
}
function serverRuleMatchesNameStrict(rule, name) {
  const n = serverNormUnitText(name);
  const tokens = serverTokens(n);
  if (!n || !tokens.length || serverNameLooksComposedForAutoUnit(n)) return false;
  return (rule.aliases || [rule.label]).some(alias => {
    const a = serverNormUnitText(alias);
    if (!a) return false;
    const aliasTokens = serverTokens(a);
    if (aliasTokens.length === 1) {
      const base = aliasTokens[0];
      if (!tokens.some(t => serverTokenMatchesAlias(t, base))) return false;
      return tokens.every(t => serverTokenMatchesAlias(t, base) || SERVER_SAFE_UNIT_DESCRIPTORS.has(t));
    }
    if (n === a) return true;
    if (!(' ' + n + ' ').includes(' ' + a + ' ')) return false;
    return tokens.every(t => aliasTokens.includes(t) || SERVER_SAFE_UNIT_DESCRIPTORS.has(t));
  });
}
function serverHasStrictUnitInference(name) {
  return SERVER_UNIT_RULES.some(r => serverRuleMatchesNameStrict(r, name));
}
function serverKnownUnitLooksUnsafe(name, unit, unitWeight, unitLabel) {
  const raw = Number(unitWeight || 0);
  if (serverHasStrictUnitInference(name)) return false;
  const u = serverNormUnitText(unit || '');
  const lbl = serverNormUnitText(unitLabel || '');
  const nameNorm = serverNormUnitText(name || '');
  const knownLabel = SERVER_KNOWN_UNIT_LABELS.has(lbl) || SERVER_KNOWN_UNIT_LABELS.has(u);
  const genericUnit = ['unite','unites','piece','pieces','piece','pieces'].includes(lbl) || ['unite','unites','piece','pieces','piece','pieces'].includes(u);
  const defaultWeight = Number.isFinite(raw) && raw > 0 && SERVER_DEFAULT_UNIT_GRAMS.has(Math.round(raw));
  if (nameNorm.includes('boeuf') && (lbl === 'oeuf' || u === 'oeuf')) return true;
  // Règle générale plus stricte pour les unités automatiques.
  // Sans correspondance stricte du nom, toute unité générique/automatique est supprimée,
  // même si unit_weight est absent. Cela évite "pomme de terre alphabet" en unité.
  if (knownLabel || genericUnit) return true;
  if (defaultWeight && (!lbl || serverNameLooksComposedForAutoUnit(name))) return true;
  return false;
}
function serverCleanUnitForApi(obj) {
  if (!obj) return obj;
  if (serverKnownUnitLooksUnsafe(obj.nom || obj.name || obj.name_snapshot, obj.unite || obj.unit, obj.poidsUnite ?? obj.unit_weight, obj.uniteLabel || obj.unit_label)) {
    obj.unite = obj.unit = 'g';
    obj.poidsUnite = obj.unit_weight = null;
    obj.uniteLabel = obj.unit_label = '';
  }
  return obj;
}

function serverCleanEntryFoodRow(row) {
  if (!row) return row;
  const qtyGrams = normalizeEntryFoodStorageToGrams({ qty: row.qty });
  const id = row.entryFoodId || row.entry_food_id || row.id || null;
  return {
    ...row,
    id: row.id,
    entryFoodId: id,
    entry_food_id: id,
    line_uid: row.line_uid || row.lineUid || null,
    qty: qtyGrams,
    quantity: qtyGrams,
    unite: 'g',
    unit: 'g',
    poidsUnite: null,
    unit_weight: null,
    uniteLabel: '',
    unit_label: ''
  };
}

function foodToApi(row) {
  return serverCleanUnitForApi({
    id: row.id,
    nom: row.name,
    kcal100: Number(row.kcal100 || 0),
    prot100: Number(row.prot100 || 0),
    gluc100: Number(row.gluc100 || 0),
    lip100: Number(row.lip100 || 0),
    unite: row.unit || 'g',
    poidsUnite: row.unit_weight == null ? null : Number(row.unit_weight || 0),
    uniteLabel: row.unit_label || '',
    source: row.source || 'user',
    favorite: !!row.favorite,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}


// v11.86 — garde-fou nutrition côté serveur : la base SQLite refuse les valeurs impossibles.
function foodnoteBadRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
function foodnoteServerNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function foodnoteServerUnitWeightOrNull(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
function foodnoteServerFoodName(food) {
  return String(food?.name || food?.nom || food?.name_snapshot || 'Aliment').trim() || 'Aliment';
}
function assertFoodPer100Allowed(food) {
  const name = foodnoteServerFoodName(food);
  const kcal = foodnoteServerNum(food.kcal100 ?? food.kcalPer100 ?? food.kcal_100g);
  const prot = foodnoteServerNum(food.prot100 ?? food.protPer100 ?? food.proteins_100g);
  const gluc = foodnoteServerNum(food.gluc100 ?? food.glucPer100 ?? food.carbohydrates_100g);
  const lip = foodnoteServerNum(food.lip100 ?? food.lipPer100 ?? food.fat_100g);
  const unitWeightRaw = food.unit_weight ?? food.poidsUnite ?? food.poids_unite ?? food.unitWeight;
  const unitWeight = foodnoteServerUnitWeightOrNull(unitWeightRaw);
  if (kcal < 0 || prot < 0 || gluc < 0 || lip < 0) throw foodnoteBadRequest(`${name} : valeur nutritionnelle négative impossible.`);
  if (kcal > 950) throw foodnoteBadRequest(`${name} : ${Math.round(kcal)} kcal/100g est impossible. Maximum théorique ≈ 900 kcal/100g.`);
  if (prot > 100) throw foodnoteBadRequest(`${name} : protéines > 100g/100g impossible.`);
  if (gluc > 100) throw foodnoteBadRequest(`${name} : glucides > 100g/100g impossible.`);
  if (lip > 100) throw foodnoteBadRequest(`${name} : lipides > 100g/100g impossible.`);
  if ((prot + gluc + lip) > 105) throw foodnoteBadRequest(`${name} : protéines + glucides + lipides > 105g/100g impossible.`);
  if (unitWeight !== null) {
    if (unitWeight > 5000) throw foodnoteBadRequest(`${name} : 1 unité = ${Math.round(unitWeight)}g, valeur aberrante.`);
  }
}
function assertEntryFoodLineAllowed(food) {
  // 0.21.19.3 — une ancienne ligne suspecte ne doit pas bloquer toute la journée.
  // Exemple réel : "Pêches" à 5250 g empêchait d'ajouter "Tomate" car la sauvegarde
  // générale reposte toute la journée. Les quantités très hautes restent signalées
  // comme anomalies, mais seules les erreurs réellement critiques bloquent la sauvegarde.
  const anomaly = detectEntryFoodLineAnomaly(food, {});
  if (anomaly && anomaly.severity === 'critical') throw foodnoteBadRequest(anomaly.message);
}
function assertNutritionEntryAllowed(entry) {
  (entry.aliments || []).forEach(assertEntryFoodLineAllowed);
}


function foodnoteNormAnomalyKeyPart(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .trim().slice(0, 120) || 'aliment';
}
function anomalyNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function anomalyUnitWeightOrNull(food) {
  const raw = food?.unit_weight ?? food?.poidsUnite ?? food?.poids_unite ?? food?.unitWeight;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
function detectEntryFoodLineAnomaly(food, context = {}) {
  if (!food || typeof food !== 'object') return null;
  const name = foodnoteServerFoodName(food);
  const qty = anomalyNumber(food.qty ?? food.quantity ?? food.quantite ?? food.defaut);
  const unit = String(food.unit || food.unite || 'g').trim() || 'g';
  const unitWeight = anomalyUnitWeightOrNull(food);
  const grams = qty; // 0.22.0 : anomalies journal en grammes stricts, sans multiplication par poids unité
  const kcal = anomalyNumber(food.kcal);
  const prot = anomalyNumber(food.prot);
  const gluc = anomalyNumber(food.gluc);
  const lip = anomalyNumber(food.lip);
  const meta = { qty, unit, unit_weight: unitWeight, grams: Math.round((grams || 0) * 10) / 10, kcal, prot, gluc, lip };
  const make = (severity, message, extra = {}) => ({
    source_date: context.date || null,
    food_name: name,
    food_index: Number.isFinite(Number(context.food_index)) ? Number(context.food_index) : null,
    severity,
    kind: 'nutrition',
    message,
    detected_value: JSON.stringify({ ...meta, ...extra }),
    raw_json: JSON.stringify(food),
  });
  if (qty < 0 || kcal < 0 || prot < 0 || gluc < 0 || lip < 0) return make('critical', `${name} : quantité ou nutriments négatifs impossibles.`);
  if (unitWeight !== null && unitWeight > 5000) return make('warning', `${name} : 1 unité = ${Math.round(unitWeight)}g, valeur aberrante.`);
  if (grams > 5000) return make('warning', `${name} : quantité ≈ ${Math.round(grams)}g, valeur aberrante.`);
  if (grams > 0) {
    const k100 = kcal * 100 / grams;
    const p100 = prot * 100 / grams;
    const g100 = gluc * 100 / grams;
    const l100 = lip * 100 / grams;
    if (k100 > 950) return make('critical', `${name} : équivalent ${Math.round(k100)} kcal/100g, impossible.`, { kcal100_equiv: Math.round(k100) });
    if (p100 > 100 || g100 > 100 || l100 > 100) return make('critical', `${name} : macro équivalente > 100g/100g, impossible.`, { prot100_equiv: Math.round(p100), gluc100_equiv: Math.round(g100), lip100_equiv: Math.round(l100) });
    if ((p100 + g100 + l100) > 105) return make('critical', `${name} : macros équivalentes > 105g/100g, impossible.`, { macros100_sum: Math.round(p100 + g100 + l100) });
    if (k100 > 800 && kcal > 80) return make('warning', `${name} : équivalent ${Math.round(k100)} kcal/100g, très élevé.`, { kcal100_equiv: Math.round(k100) });
  }
  return null;
}
function upsertDataAnomaly(userId, anomaly) {
  if (!anomaly || !anomaly.source_key) return null;
  db.prepare(`
    INSERT INTO data_anomalies (
      user_id, source_table, source_id, source_key, source_date, food_name, food_index,
      severity, kind, message, detected_value, status, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, source_key) DO UPDATE SET
      source_table=excluded.source_table,
      source_id=excluded.source_id,
      source_date=excluded.source_date,
      food_name=excluded.food_name,
      food_index=excluded.food_index,
      severity=excluded.severity,
      kind=excluded.kind,
      message=excluded.message,
      detected_value=excluded.detected_value,
      raw_json=excluded.raw_json,
      status=CASE WHEN data_anomalies.status='ignored' THEN data_anomalies.status ELSE 'open' END,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    userId,
    anomaly.source_table || 'unknown',
    anomaly.source_id == null ? null : String(anomaly.source_id),
    String(anomaly.source_key),
    anomaly.source_date || null,
    anomaly.food_name || null,
    anomaly.food_index == null ? null : Number(anomaly.food_index),
    anomaly.severity || 'warning',
    anomaly.kind || 'nutrition',
    anomaly.message || 'Anomalie détectée',
    anomaly.detected_value || null,
    anomaly.raw_json || null
  );
  return String(anomaly.source_key);
}
function scanDataAnomaliesForUser(userId) {
  ensureUser(userId);
  const detectedKeys = [];
  const add = (source) => {
    const key = upsertDataAnomaly(userId, source);
    if (key) detectedKeys.push(key);
  };

  const state = getState(userId, 'data', {});
  const entries = normalizeEntriesPayload(state);
  for (const entry of entries) {
    const date = String(entry?.date || '').slice(0, 10);
    const foods = Array.isArray(entry?.aliments) ? entry.aliments : (Array.isArray(entry?.foods) ? entry.foods : []);
    foods.forEach((food, index) => {
      const anomaly = detectEntryFoodLineAnomaly(food, { date, food_index: index });
      if (anomaly) {
        add({
          ...anomaly,
          source_table: 'app_state.journal_entries',
          source_id: date || null,
          source_key: `state:${date || 'no-date'}:food:${index}:${foodnoteNormAnomalyKeyPart(anomaly.food_name)}`,
        });
      }
    });
  }

  try {
    const rows = db.prepare(`
      SELECT ef.*, e.date AS entry_date
      FROM entry_foods ef
      JOIN entries e ON e.id = ef.entry_id
      WHERE e.user_id=?
      ORDER BY e.date DESC, ef.id ASC
    `).all(userId);
    for (const row of rows) {
      const food = {
        nom: row.name_snapshot,
        qty: row.qty,
        unite: row.unit,
        poidsUnite: row.unit_weight,
        uniteLabel: row.unit_label,
        kcal: row.kcal,
        prot: row.prot,
        gluc: row.gluc,
        lip: row.lip,
        meal: row.meal,
      };
      const anomaly = detectEntryFoodLineAnomaly(food, { date: row.entry_date, food_index: row.id });
      if (anomaly) {
        add({
          ...anomaly,
          source_table: 'entry_foods',
          source_id: String(row.id),
          source_key: `entry_foods:${row.id}`,
        });
      }
    }
  } catch(e) {
    console.warn('[FoodNote anomalies] scan entry_foods impossible:', e.message);
  }

  if (detectedKeys.length) {
    const placeholders = detectedKeys.map(() => '?').join(',');
    db.prepare(`
      UPDATE data_anomalies
      SET status='resolved', updated_at=CURRENT_TIMESTAMP
      WHERE user_id=? AND kind='nutrition' AND status='open' AND source_key NOT IN (${placeholders})
    `).run(userId, ...detectedKeys);
  } else {
    db.prepare(`
      UPDATE data_anomalies
      SET status='resolved', updated_at=CURRENT_TIMESTAMP
      WHERE user_id=? AND kind='nutrition' AND status='open'
    `).run(userId);
  }

  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n
    FROM data_anomalies
    WHERE user_id=?
    GROUP BY status
  `).all(userId).reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});
  return { ok:true, detected: detectedKeys.length, counts };
}
function scanDataAnomaliesForAllUsers() {
  const users = db.prepare('SELECT id FROM users').all();
  return users.map(u => ({ user_id: u.id, ...scanDataAnomaliesForUser(u.id) }));
}
function listDataAnomaliesForUser(userId, options = {}) {
  if (options.rescan) scanDataAnomaliesForUser(userId);
  const status = String(options.status || 'open');
  const params = [userId];
  let where = 'user_id=?';
  if (status !== 'all') { where += ' AND status=?'; params.push(status); }
  const rows = db.prepare(`
    SELECT * FROM data_anomalies
    WHERE ${where}
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
             COALESCE(source_date, '') DESC,
             updated_at DESC,
             id DESC
    LIMIT 200
  `).all(...params);
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n
    FROM data_anomalies
    WHERE user_id=?
    GROUP BY status
  `).all(userId).reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});
  return { ok:true, user_id:userId, status, counts, anomalies: rows.map(anomalyToApi) };
}
function anomalyToApi(row) {
  return {
    id: row.id,
    source_table: row.source_table,
    source_id: row.source_id,
    source_key: row.source_key,
    source_date: row.source_date,
    food_name: row.food_name,
    food_index: row.food_index,
    severity: row.severity,
    kind: row.kind,
    message: row.message,
    detected_value: safeJsonParse(row.detected_value || '{}', {}),
    status: row.status,
    raw: safeJsonParse(row.raw_json || 'null', null),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ui_target: {
      page: 'bases',
      section: 'anomalies-card',
      row_id: `anomaly-row-${row.id}`,
      date: row.source_date || null,
    }
  };
}
function recordAnomaliesFromEntryPayload(userId, entry, prefix = 'incoming') {
  if (!entry || typeof entry !== 'object') return 0;
  const date = String(entry.date || '').slice(0, 10);
  const foods = Array.isArray(entry.aliments) ? entry.aliments : (Array.isArray(entry.foods) ? entry.foods : []);
  let n = 0;
  foods.forEach((food, index) => {
    const anomaly = detectEntryFoodLineAnomaly(food, { date, food_index: index });
    if (!anomaly) return;
    upsertDataAnomaly(userId, {
      ...anomaly,
      source_table: prefix,
      source_id: date || null,
      source_key: `${prefix}:${date || 'no-date'}:food:${index}:${foodnoteNormAnomalyKeyPart(anomaly.food_name)}`,
    });
    n++;
  });
  return n;
}


function recoveredFoodsFromEntries(userId, limit = 500) {
  // Recrée une base aliments exploitable depuis les aliments déjà présents dans les journées.
  // Requête volontairement sans JOIN direct pour éviter toute ambiguïté SQLite
  // sur les colonnes nutritionnelles (entries.kcal et entry_foods.kcal existent toutes les deux).
  // Toutes les colonnes utilisées proviennent explicitement de entry_foods AS ef.
  const safeLimit = Math.max(1, Math.min(5000, Number(limit || 500) || 500));
  const rows = db.prepare(`
    SELECT
      LOWER(TRIM(COALESCE(ef.name_snapshot, ''))) AS key_name,
      MAX(TRIM(COALESCE(ef.name_snapshot, ''))) AS name,
      MAX(COALESCE(ef.unit, 'g')) AS unit,
      MAX(ef.unit_weight) AS unit_weight,
      MAX(COALESCE(ef.unit_label, '')) AS unit_label,
      AVG(CASE WHEN COALESCE(ef.qty, 0) > 0 AND COALESCE(ef.unit, 'g') = 'g' THEN COALESCE(ef.kcal, 0) * 100.0 / ef.qty ELSE NULL END) AS kcal100_g,
      AVG(CASE WHEN COALESCE(ef.qty, 0) > 0 AND COALESCE(ef.unit, 'g') = 'g' THEN COALESCE(ef.prot, 0) * 100.0 / ef.qty ELSE NULL END) AS prot100_g,
      AVG(CASE WHEN COALESCE(ef.qty, 0) > 0 AND COALESCE(ef.unit, 'g') = 'g' THEN COALESCE(ef.gluc, 0) * 100.0 / ef.qty ELSE NULL END) AS gluc100_g,
      AVG(CASE WHEN COALESCE(ef.qty, 0) > 0 AND COALESCE(ef.unit, 'g') = 'g' THEN COALESCE(ef.lip, 0)  * 100.0 / ef.qty ELSE NULL END) AS lip100_g,
      MAX(COALESCE(ef.kcal, 0)) AS sample_kcal,
      MAX(COALESCE(ef.prot, 0)) AS sample_prot,
      MAX(COALESCE(ef.gluc, 0)) AS sample_gluc,
      MAX(COALESCE(ef.lip, 0)) AS sample_lip,
      COUNT(ef.id) AS uses
    FROM entry_foods AS ef
    WHERE ef.entry_id IN (SELECT e.id FROM entries AS e WHERE e.user_id = ?)
      AND TRIM(COALESCE(ef.name_snapshot, '')) != ''
    GROUP BY LOWER(TRIM(COALESCE(ef.name_snapshot, '')))
    ORDER BY uses DESC, name ASC
    LIMIT ?
  `).all(userId, safeLimit);
  const deletedNames = getFoodDeletionKeySet(userId);
  return rows.map((r, i) => {
    const hasG = Number.isFinite(Number(r.kcal100_g)) && Number(r.kcal100_g) > 0;
    const out = {
      id: -100000 - i,
      name: r.name,
      kcal100: hasG ? Math.round(Number(r.kcal100_g) * 10) / 10 : Math.round(Number(r.sample_kcal || 0) * 10) / 10,
      prot100: hasG ? Math.round(Number(r.prot100_g || 0) * 10) / 10 : Math.round(Number(r.sample_prot || 0) * 10) / 10,
      gluc100: hasG ? Math.round(Number(r.gluc100_g || 0) * 10) / 10 : Math.round(Number(r.sample_gluc || 0) * 10) / 10,
      lip100: hasG ? Math.round(Number(r.lip100_g || 0) * 10) / 10 : Math.round(Number(r.sample_lip || 0) * 10) / 10,
      unit: r.unit || 'g',
      unit_weight: r.unit_weight == null ? null : Number(r.unit_weight || 0),
      unit_label: r.unit_label || '',
      source: 'recovered_from_entries',
      favorite: 0,
      created_at: null,
      updated_at: null
    };
    const cleaned = serverCleanUnitForApi({ name: out.name, unit: out.unit, unit_weight: out.unit_weight, unit_label: out.unit_label });
    out.unit = cleaned.unit || 'g';
    out.unit_weight = cleaned.unit_weight == null ? null : cleaned.unit_weight;
    out.unit_label = cleaned.unit_label || '';
    return out;
  }).filter(f => f.name && Number(f.kcal100 || 0) >= 0 && !deletedNames.has(foodNameKeyForDb(f.name)));
}

function rebuildFoodsFromEntries(userId) {
  const recovered = recoveredFoodsFromEntries(userId, 1000).filter(f => Number(f.kcal100 || 0) > 0 || Number(f.prot100 || 0) > 0 || Number(f.gluc100 || 0) > 0 || Number(f.lip100 || 0) > 0);
  const existingNames = new Set(db.prepare('SELECT LOWER(TRIM(name)) AS name FROM foods WHERE user_id=?').all(userId).map(r => r.name));
  const ins = db.prepare(`
    INSERT INTO foods (user_id, name, kcal100, prot100, gluc100, lip100, unit, unit_weight, unit_label, source, favorite, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'recovered_from_entries', 0, CURRENT_TIMESTAMP)
  `);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const f of recovered) {
      const key = String(f.name || '').trim().toLowerCase();
      if (!key || existingNames.has(key)) continue;
      ins.run(userId, f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit || 'g', f.unit_weight, f.unit_label || '');
      existingNames.add(key);
      inserted++;
    }
  });
  tx();
  return { inserted, recoverable: recovered.length };
}

function foodPayloadToDb(food) {
  const name = String(food?.nom || food?.name || '').trim();
  if (!name) return null;
  const out = {
    id: food.id === undefined || food.id === null || food.id === '' ? null : Number(food.id),
    name,
    kcal100: Number(food.kcal100 ?? food.kcalPer100 ?? 0) || 0,
    prot100: Number(food.prot100 ?? food.protPer100 ?? 0) || 0,
    gluc100: Number(food.gluc100 ?? food.glucPer100 ?? 0) || 0,
    lip100: Number(food.lip100 ?? food.lipPer100 ?? 0) || 0,
    unit: String(food.unite || food.unit || 'g').slice(0, 20),
    unit_weight: food.poidsUnite === undefined || food.poidsUnite === null || food.poidsUnite === '' ? null : Number(food.poidsUnite),
    unit_label: String(food.uniteLabel || food.unit_label || '').slice(0, 40),
    source: String(food.source || (food.base ? 'starter' : 'user')).slice(0, 40),
    favorite: food.favorite || food.favori ? 1 : 0
  };
  const cleaned = serverCleanUnitForApi({ nom: out.name, unite: out.unit, poidsUnite: out.unit_weight, uniteLabel: out.unit_label });
  out.unit = cleaned.unite || 'g';
  out.unit_weight = cleaned.poidsUnite == null ? null : cleaned.poidsUnite;
  out.unit_label = cleaned.uniteLabel || '';
  assertFoodPer100Allowed(out);
  return out;
}

const replaceFoodsForUser = db.transaction((userId, foods) => {
  const normalized = normalizeFoodsPayload(foods).map(foodPayloadToDb).filter(Boolean);
  const ids = normalized.filter(f => Number.isFinite(f.id)).map(f => f.id);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM foods WHERE user_id=? AND id NOT IN (${placeholders})`).run(userId, ...ids);
  } else {
    db.prepare('DELETE FROM foods WHERE user_id=?').run(userId);
  }

  const insertWithId = db.prepare(`
    INSERT INTO foods (id, user_id, name, kcal100, prot100, gluc100, lip100, unit, unit_weight, unit_label, source, favorite, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      kcal100=excluded.kcal100,
      prot100=excluded.prot100,
      gluc100=excluded.gluc100,
      lip100=excluded.lip100,
      unit=excluded.unit,
      unit_weight=excluded.unit_weight,
      unit_label=excluded.unit_label,
      source=excluded.source,
      favorite=excluded.favorite,
      updated_at=CURRENT_TIMESTAMP
  `);
  const insertNoId = db.prepare(`
    INSERT INTO foods (user_id, name, kcal100, prot100, gluc100, lip100, unit, unit_weight, unit_label, source, favorite, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  for (const f of normalized) {
    clearFoodDeletionTombstone(userId, f.name);
    if (Number.isFinite(f.id)) {
      insertWithId.run(f.id, userId, f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite);
    } else {
      insertNoId.run(userId, f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite);
    }
  }
  return normalized.length;
});

function foodNameKeyForDb(name) {
  return String(name || '').trim().toLowerCase();
}

function addFoodDeletionTombstone(userId, name) {
  const cleanName = String(name || '').trim();
  const key = foodNameKeyForDb(cleanName);
  if (!userId || !key) return false;
  db.prepare(`
    INSERT INTO food_deletions (user_id, name_key, name, deleted_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, name_key) DO UPDATE SET
      name=excluded.name,
      deleted_at=CURRENT_TIMESTAMP
  `).run(userId, key, cleanName);
  return true;
}

function clearFoodDeletionTombstone(userId, name) {
  const key = foodNameKeyForDb(name);
  if (!userId || !key) return 0;
  return db.prepare('DELETE FROM food_deletions WHERE user_id=? AND name_key=?').run(userId, key).changes || 0;
}

function getFoodDeletionKeySet(userId) {
  try {
    return new Set(db.prepare('SELECT name_key FROM food_deletions WHERE user_id=?').all(userId).map(r => r.name_key));
  } catch (_) {
    return new Set();
  }
}

const mergeFoodsForUser = db.transaction((userId, foods) => {
  // Sauvegarde protectrice : le client n'est pas toujours une copie complète de la base
  // (chargement différé, cache local volontairement réduit, WebView mobile). Donc ce mode
  // ajoute/met à jour, mais ne supprime jamais les aliments absents du payload.
  const normalized = normalizeFoodsPayload(foods).map(foodPayloadToDb).filter(Boolean);
  const updateById = db.prepare(`
    UPDATE foods SET
      name=?, kcal100=?, prot100=?, gluc100=?, lip100=?, unit=?, unit_weight=?, unit_label=?, source=?, favorite=?, updated_at=CURRENT_TIMESTAMP
    WHERE user_id=? AND id=?
  `);
  const updateByName = db.prepare(`
    UPDATE foods SET
      kcal100=?, prot100=?, gluc100=?, lip100=?, unit=?, unit_weight=?, unit_label=?, source=?, favorite=?, updated_at=CURRENT_TIMESTAMP
    WHERE user_id=? AND LOWER(TRIM(name))=?
  `);
  const insertWithId = db.prepare(`
    INSERT INTO foods (id, user_id, name, kcal100, prot100, gluc100, lip100, unit, unit_weight, unit_label, source, favorite, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      kcal100=excluded.kcal100,
      prot100=excluded.prot100,
      gluc100=excluded.gluc100,
      lip100=excluded.lip100,
      unit=excluded.unit,
      unit_weight=excluded.unit_weight,
      unit_label=excluded.unit_label,
      source=excluded.source,
      favorite=excluded.favorite,
      updated_at=CURRENT_TIMESTAMP
  `);
  const insertNoId = db.prepare(`
    INSERT INTO foods (user_id, name, kcal100, prot100, gluc100, lip100, unit, unit_weight, unit_label, source, favorite, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const existingById = db.prepare('SELECT id FROM foods WHERE user_id=? AND id=?');
  const existingByName = db.prepare('SELECT id FROM foods WHERE user_id=? AND LOWER(TRIM(name))=? ORDER BY id LIMIT 1');

  let inserted = 0;
  let updated = 0;
  const seenNames = new Set();
  for (const f of normalized) {
    const key = foodNameKeyForDb(f.name);
    if (!key || seenNames.has(key)) continue;
    seenNames.add(key);
    clearFoodDeletionTombstone(userId, f.name);

    if (Number.isFinite(f.id) && existingById.get(userId, f.id)) {
      const info = updateById.run(f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite, userId, f.id);
      updated += info.changes || 0;
      continue;
    }

    const byName = existingByName.get(userId, key);
    if (byName) {
      const info = updateByName.run(f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite, userId, key);
      updated += info.changes || 0;
      continue;
    }

    if (Number.isFinite(f.id)) insertWithId.run(f.id, userId, f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite);
    else insertNoId.run(userId, f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite);
    inserted++;
  }
  return { received: normalized.length, inserted, updated };
});

function hydrateFoodsFromEntriesIfEmpty(userId) {
  const foodCount = db.prepare('SELECT COUNT(*) AS c FROM foods WHERE user_id=?').get(userId)?.c || 0;
  if (foodCount > 0) return { skipped: true, reason: 'foods_not_empty', count: foodCount };
  const entryFoodCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM entry_foods ef
    JOIN entries e ON e.id=ef.entry_id
    WHERE e.user_id=?
  `).get(userId)?.c || 0;
  if (entryFoodCount <= 0) return { skipped: true, reason: 'no_history_foods', count: 0 };
  const rebuilt = rebuildFoodsFromEntries(userId);
  return { skipped: false, ...rebuilt };
}

function hydrateFoodsFromEntriesForAllUsersIfEmpty() {
  const users = db.prepare('SELECT id FROM users').all();
  return users.map(u => ({ user_id: u.id, ...hydrateFoodsFromEntriesIfEmpty(u.id) }));
}

function migrateFoodsFromState(userId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM foods WHERE user_id=?').get(userId)?.c || 0;
  if (count > 0) return { ok: true, skipped: true, count };
  const state = getState(userId, 'data', {});
  const foods = normalizeFoodsPayload(state);
  if (!foods.length) return { ok: true, skipped: true, count: 0 };
  const n = replaceFoodsForUser(userId, foods);
  return { ok: true, skipped: false, count: n };
}

function migrateFoodsForAllUsers() {
  const users = db.prepare('SELECT id FROM users').all();
  return users.map(u => ({ user_id: u.id, ...migrateFoodsFromState(u.id) }));
}

function migrateLegacyJournal() {
  const key = db.prepare("SELECT value FROM meta WHERE key='legacy_journal_migrated'").get();
  if (key?.value === '1') return;
  ensureUser(DEFAULT_USER_ID);
  if (fs.existsSync(LEGACY_DATA_FILE)) {
    const legacy = safeJsonParse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8'), {});
    setState(DEFAULT_USER_ID, 'data', legacy);
    normalizeAllEntries(DEFAULT_USER_ID, legacy);
    const date = new Date().toISOString().split('T')[0];
    const backup = path.join(DATA_DIR, `journal_migrated_${date}.json`);
    if (!fs.existsSync(backup)) fs.copyFileSync(LEGACY_DATA_FILE, backup);
    console.log(`Ancien journal.json migré vers SQLite (${DB_FILE}). Backup: ${backup}`);
  }
  db.prepare(`INSERT INTO meta (key, value) VALUES ('legacy_journal_migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'`).run();
}

migrateLegacyJournal();
migrateFoodsForAllUsers();
try {
  const hydrated = hydrateFoodsFromEntriesForAllUsersIfEmpty();
  const changed = hydrated.filter(r => !r.skipped && Number(r.inserted || 0) > 0);
  if (changed.length) console.log('[FoodNote DB] Base aliments auto-récupérée depuis historique:', changed);
} catch(e) {
  console.warn('[FoodNote DB] auto-récupération base aliments ignorée:', e.message);
}
try {
  const rebuilt = normalizeStoredStateForAllUsers({ skipInvalid: true });
  const total = rebuilt.reduce((sum, r) => sum + Number(r.normalized_entries || 0), 0);
  const skipped = rebuilt.reduce((sum, r) => sum + Number(r.skipped_entries || 0), 0);
  if (total) console.log(`[FoodNote] Journées normalisées depuis app_state vers SQLite entries: ${total}`);
  if (skipped) console.warn(`[FoodNote] Normalisation SQLite partielle: ${skipped} journée(s) ancienne(s) ignorée(s) car incohérentes. Les données brutes restent dans app_state.`);
} catch (e) {
  console.warn('[FoodNote] Normalisation automatique des journées impossible:', e.message);
}
try {
  const scans = scanDataAnomaliesForAllUsers();
  const open = scans.reduce((sum, r) => sum + Number((r.counts && r.counts.open) || 0), 0);
  if (open) console.warn(`[FoodNote] ${open} anomalie(s) données détectée(s). Voir Bases de données → Anomalies.`);
} catch (e) {
  console.warn('[FoodNote] Scan anomalies données impossible:', e.message);
}
try {
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    const r = buildProfileResponseForUser(u.id);
    // Si une ancienne base contient le profil uniquement dans app_state, on le matérialise
    // dans profiles/phases pour que les objectifs soient visibles sur tous les appareils.
    if (r.source === 'app_state' || (!db.prepare('SELECT user_id FROM profiles WHERE user_id=?').get(u.id) && r.exists)) {
      rebuildProfileFromFallbacks(u.id);
      console.log(`[FoodNote] Profil/objectifs reconstruits depuis app_state pour ${u.id}`);
    }
  }
} catch (e) {
  console.warn('[FoodNote] Reconstruction automatique profil/objectifs impossible:', e.message);
}

app.use(express.json({ limit: '25mb' }));

// ── FoodNote — MQTT / Home Assistant ───────────
function envFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return !!defaultValue;
  return ['1', 'true', 'yes', 'on', 'oui'].includes(String(value).trim().toLowerCase());
}
function foodnoteMqttCleanTopic(topic, fallback = 'foodnote') {
  const cleaned = String(topic || fallback).trim().replace(/^\/+|\/+$/g, '').replace(/[#+]/g, '_');
  return cleaned || fallback;
}
function foodnoteMqttTopicPart(value, fallback = 'default') {
  const cleaned = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}
function foodnoteMqttNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}
function foodnoteDateInTimezone(d = new Date()) {
  const tz = process.env.FOODNOTE_TZ || 'Europe/Paris';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
  } catch (_) {}
  return foodnoteLocalDateStamp(d);
}
const FOODNOTE_MQTT_CONFIG = {
  enabled: envFlag(process.env.FOODNOTE_MQTT_ENABLED || process.env.MQTT_ENABLED, false),
  url: process.env.FOODNOTE_MQTT_URL || process.env.MQTT_URL || '',
  username: process.env.FOODNOTE_MQTT_USERNAME || process.env.MQTT_USERNAME || '',
  password: process.env.FOODNOTE_MQTT_PASSWORD || process.env.MQTT_PASSWORD || '',
  baseTopic: foodnoteMqttCleanTopic(process.env.FOODNOTE_MQTT_BASE_TOPIC || process.env.MQTT_BASE_TOPIC || 'foodnote', 'foodnote'),
  discovery: envFlag(process.env.FOODNOTE_MQTT_DISCOVERY, true),
  discoveryPrefix: foodnoteMqttCleanTopic(process.env.FOODNOTE_MQTT_DISCOVERY_PREFIX || 'homeassistant', 'homeassistant'),
  retain: envFlag(process.env.FOODNOTE_MQTT_RETAIN, true),
  timezone: process.env.FOODNOTE_TZ || 'Europe/Paris',
};
let foodnoteMqttClient = null;
let foodnoteMqttStarted = false;
let foodnoteMqttDiscoveryPublished = false;
const foodnoteMqttPending = new Map();
const foodnoteMqttState = {
  enabled: FOODNOTE_MQTT_CONFIG.enabled,
  configured: !!FOODNOTE_MQTT_CONFIG.url,
  connected: false,
  last_connect: null,
  last_disconnect: null,
  last_error: null,
  last_publish: null,
  published_count: 0,
};
function foodnoteMqttPublicConfig(userId = DEFAULT_USER_ID) {
  const base = `${FOODNOTE_MQTT_CONFIG.baseTopic}/${foodnoteMqttTopicPart(userId)}`;
  return {
    enabled: FOODNOTE_MQTT_CONFIG.enabled,
    configured: !!FOODNOTE_MQTT_CONFIG.url,
    module_installed: !!mqttLib,
    connected: !!foodnoteMqttState.connected,
    url: FOODNOTE_MQTT_CONFIG.url ? FOODNOTE_MQTT_CONFIG.url.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://***:***@') : '',
    username_set: !!FOODNOTE_MQTT_CONFIG.username,
    base_topic: FOODNOTE_MQTT_CONFIG.baseTopic,
    user_topic: base,
    state_topic: `${base}/state`,
    event_topic: `${base}/event`,
    status_topic: `${base}/status`,
    discovery: FOODNOTE_MQTT_CONFIG.discovery,
    discovery_prefix: FOODNOTE_MQTT_CONFIG.discoveryPrefix,
    retain: FOODNOTE_MQTT_CONFIG.retain,
    timezone: FOODNOTE_MQTT_CONFIG.timezone,
  };
}
function foodnoteMqttStatus(userId = DEFAULT_USER_ID) {
  return {
    ok: true,
    app: APP_LABEL,
    version: APP_VERSION,
    build: APP_BUILD,
    config: foodnoteMqttPublicConfig(userId),
    state: { ...foodnoteMqttState },
    last_meta: getMetaValue('mqtt_last_publish', null),
  };
}
function foodnoteMqttEnsureStarted() {
  if (foodnoteMqttStarted) return;
  foodnoteMqttStarted = true;
  if (!FOODNOTE_MQTT_CONFIG.enabled) return;
  if (!mqttLib) {
    foodnoteMqttState.last_error = 'Module npm mqtt absent. Redémarre le conteneur pour installer les dépendances.';
    console.warn('[FoodNote MQTT] module mqtt absent');
    return;
  }
  if (!FOODNOTE_MQTT_CONFIG.url) {
    foodnoteMqttState.last_error = 'FOODNOTE_MQTT_URL non configuré';
    console.warn('[FoodNote MQTT] URL broker absente');
    return;
  }
  const clientId = foodnoteMqttTopicPart(process.env.FOODNOTE_MQTT_CLIENT_ID || `foodnote_${DEFAULT_USER_ID}_${crypto.randomBytes(3).toString('hex')}`, 'foodnote');
  const statusTopic = `${FOODNOTE_MQTT_CONFIG.baseTopic}/status`;
  const options = {
    clientId,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    will: { topic: statusTopic, payload: 'offline', retain: true, qos: 0 },
  };
  if (FOODNOTE_MQTT_CONFIG.username) options.username = FOODNOTE_MQTT_CONFIG.username;
  if (FOODNOTE_MQTT_CONFIG.password) options.password = FOODNOTE_MQTT_CONFIG.password;
  try {
    foodnoteMqttClient = mqttLib.connect(FOODNOTE_MQTT_CONFIG.url, options);
    foodnoteMqttClient.on('connect', () => {
      foodnoteMqttState.connected = true;
      foodnoteMqttState.last_connect = new Date().toISOString();
      foodnoteMqttState.last_error = null;
      console.log(`[FoodNote MQTT] connecté à ${foodnoteMqttPublicConfig().url || 'broker'}`);
      foodnoteMqttPublish(`${FOODNOTE_MQTT_CONFIG.baseTopic}/status`, 'online', { retain: true }).catch(() => {});
      if (FOODNOTE_MQTT_CONFIG.discovery && !foodnoteMqttDiscoveryPublished) {
        foodnoteMqttPublishDiscovery(DEFAULT_USER_ID).catch(e => console.warn('[FoodNote MQTT] discovery:', e.message));
      }
      foodnoteMqttPublishSnapshot(DEFAULT_USER_ID, foodnoteDateInTimezone(), 'startup').catch(e => console.warn('[FoodNote MQTT] snapshot startup:', e.message));
    });
    foodnoteMqttClient.on('reconnect', () => { foodnoteMqttState.connected = false; });
    foodnoteMqttClient.on('close', () => { foodnoteMqttState.connected = false; foodnoteMqttState.last_disconnect = new Date().toISOString(); });
    foodnoteMqttClient.on('offline', () => { foodnoteMqttState.connected = false; });
    foodnoteMqttClient.on('error', err => { foodnoteMqttState.last_error = err.message; console.warn('[FoodNote MQTT]', err.message); });
  } catch (e) {
    foodnoteMqttState.last_error = e.message;
    console.warn('[FoodNote MQTT] démarrage impossible:', e.message);
  }
}
function foodnoteMqttPublish(topic, payload, options = {}) {
  return new Promise((resolve, reject) => {
    foodnoteMqttEnsureStarted();
    if (!FOODNOTE_MQTT_CONFIG.enabled) return reject(new Error('MQTT désactivé. Active FOODNOTE_MQTT_ENABLED=1.'));
    if (!foodnoteMqttClient) return reject(new Error(foodnoteMqttState.last_error || 'MQTT non initialisé'));

    const send = () => {
      const body = (typeof payload === 'string' || Buffer.isBuffer(payload)) ? payload : JSON.stringify(payload);
      foodnoteMqttClient.publish(topic, body, { qos: 0, retain: options.retain ?? FOODNOTE_MQTT_CONFIG.retain }, (err) => {
        if (err) { foodnoteMqttState.last_error = err.message; return reject(err); }
        foodnoteMqttState.last_publish = { at: new Date().toISOString(), topic };
        foodnoteMqttState.published_count += 1;
        setMetaValue('mqtt_last_publish', foodnoteMqttState.last_publish);
        resolve(foodnoteMqttState.last_publish);
      });
    };

    if (foodnoteMqttState.connected) return send();

    let done = false;
    const cleanup = () => {
      foodnoteMqttClient.off('connect', onConnect);
      foodnoteMqttClient.off('error', onError);
      clearTimeout(timer);
    };
    const onConnect = () => {
      if (done) return;
      done = true;
      cleanup();
      send();
    };
    const onError = (err) => {
      if (done) return;
      done = true;
      cleanup();
      foodnoteMqttState.last_error = err.message;
      reject(err);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(foodnoteMqttState.last_error || 'MQTT non connecté'));
    }, Number(options.waitMs || 2500));
    foodnoteMqttClient.once('connect', onConnect);
    foodnoteMqttClient.once('error', onError);
  });
}
function foodnoteMqttEntryPayload(userId, date, source = 'manual') {
  const row = db.prepare('SELECT * FROM entries WHERE user_id=? AND date=?').get(userId, date);
  const empty = {
    app: APP_LABEL,
    version: APP_VERSION,
    build: APP_BUILD,
    user_id: userId,
    date,
    source,
    updated_at: new Date().toISOString(),
    kcal: 0,
    net_kcal: 0,
    prot: 0,
    gluc: 0,
    lip: 0,
    sport_kcal: 0,
    poids: null,
    food_count: 0,
    sport_count: 0,
    review_done: false,
    checklist_done: false,
    has_entry: false,
  };
  if (!row) return empty;
  const entry = entryToApi(row, true);
  const foods = Array.isArray(entry.aliments) ? entry.aliments : [];
  const sports = Array.isArray(entry.sports) ? entry.sports : [];
  const review = entry.dailyReview && typeof entry.dailyReview === 'object' ? entry.dailyReview : {};
  const checklist = entry.dailyChecklist && typeof entry.dailyChecklist === 'object' ? entry.dailyChecklist : {};
  return {
    ...empty,
    updated_at: row.updated_at || empty.updated_at,
    kcal: foodnoteMqttNumber(row.kcal, 0) || 0,
    net_kcal: foodnoteMqttNumber(row.net_kcal, 0) || 0,
    prot: foodnoteMqttNumber(row.prot, 1) || 0,
    gluc: foodnoteMqttNumber(row.gluc, 1) || 0,
    lip: foodnoteMqttNumber(row.lip, 1) || 0,
    sport_kcal: foodnoteMqttNumber(row.dep_sport, 0) || 0,
    poids: foodnoteMqttNumber(row.poids, 2),
    food_count: foods.length,
    sport_count: sports.length,
    review_done: Object.keys(review).length > 0,
    checklist_done: Object.keys(checklist).some(k => checklist[k] === true),
    has_entry: true,
  };
}
function foodnoteMqttSensorDefinitions() {
  return [
    ['kcal', 'Calories jour', 'kcal', 'mdi:fire'],
    ['net_kcal', 'Calories nettes', 'kcal', 'mdi:calculator-variant'],
    ['prot', 'Protéines', 'g', 'mdi:food-drumstick'],
    ['gluc', 'Glucides', 'g', 'mdi:bread-slice'],
    ['lip', 'Lipides', 'g', 'mdi:oil'],
    ['sport_kcal', 'Sport', 'kcal', 'mdi:run'],
    ['poids', 'Poids', 'kg', 'mdi:scale-bathroom'],
    ['food_count', 'Aliments', null, 'mdi:food-apple'],
    ['sport_count', 'Activités sport', null, 'mdi:counter'],
  ];
}
async function foodnoteMqttPublishDiscovery(userId = DEFAULT_USER_ID) {
  const userSlug = foodnoteMqttTopicPart(userId);
  const base = `${FOODNOTE_MQTT_CONFIG.baseTopic}/${userSlug}`;
  const device = {
    identifiers: [`foodnote_${userSlug}`],
    name: APP_LABEL,
    manufacturer: 'FoodNote',
    model: `foodnote-${APP_VERSION}`, 
    sw_version: APP_VERSION,
  };
  const publications = [];
  for (const [key, name, unit, icon] of foodnoteMqttSensorDefinitions()) {
    const objectId = `foodnote_${userSlug}_${key}`;
    const config = {
      name: `FoodNote ${name}`,
      unique_id: objectId,
      object_id: objectId,
      state_topic: `${base}/state`,
      value_template: `{{ value_json.${key} }}`,
      availability_topic: `${base}/status`,
      payload_available: 'online',
      payload_not_available: 'offline',
      icon,
      device,
    };
    if (unit) config.unit_of_measurement = unit;
    if (key !== 'food_count' && key !== 'sport_count') config.state_class = 'measurement';
    publications.push(foodnoteMqttPublish(`${FOODNOTE_MQTT_CONFIG.discoveryPrefix}/sensor/foodnote/${objectId}/config`, config, { retain: true }));
  }
  await Promise.all(publications);
  foodnoteMqttDiscoveryPublished = true;
  return { ok: true, entities: publications.length, discovery_prefix: FOODNOTE_MQTT_CONFIG.discoveryPrefix };
}
async function foodnoteMqttPublishSnapshot(userId = DEFAULT_USER_ID, date = foodnoteDateInTimezone(), source = 'manual') {
  const userSlug = foodnoteMqttTopicPart(userId);
  const base = `${FOODNOTE_MQTT_CONFIG.baseTopic}/${userSlug}`;
  const payload = foodnoteMqttEntryPayload(userId, String(date || foodnoteDateInTimezone()).slice(0, 10), source);
  await foodnoteMqttPublish(`${base}/status`, 'online', { retain: true });
  await foodnoteMqttPublish(`${base}/state`, payload, { retain: FOODNOTE_MQTT_CONFIG.retain });
  return { ok: true, topic: `${base}/state`, payload };
}
function foodnoteMqttDateFromReq(req) {
  const fromBody = String(req.body?.date || req.body?.entry?.date || req.body?.jour || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromBody)) return fromBody;
  const p = String(req.path || req.url || '');
  const m = p.match(/\/api\/entries\/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return foodnoteDateInTimezone();
}
function foodnoteMqttQueueSnapshot(userId, date, reason) {
  if (!FOODNOTE_MQTT_CONFIG.enabled) return;
  const key = `${userId}|${date}`;
  if (foodnoteMqttPending.has(key)) clearTimeout(foodnoteMqttPending.get(key));
  foodnoteMqttPending.set(key, setTimeout(() => {
    foodnoteMqttPending.delete(key);
    foodnoteMqttPublishSnapshot(userId, date, reason).catch(e => {
      foodnoteMqttState.last_error = e.message;
      console.warn('[FoodNote MQTT] publish snapshot:', e.message);
    });
  }, 500));
}
function foodnoteMqttNotifyMutation(req) {
  if (!FOODNOTE_MQTT_CONFIG.enabled) return;
  const userId = req.foodnoteUserId || getUserId(req) || DEFAULT_USER_ID;
  const date = foodnoteMqttDateFromReq(req);
  const base = `${FOODNOTE_MQTT_CONFIG.baseTopic}/${foodnoteMqttTopicPart(userId)}`;
  const event = {
    app: APP_LABEL,
    type: 'foodnote_mutation',
    method: req.method,
    path: req.originalUrl || req.url,
    date,
    at: new Date().toISOString(),
  };
  foodnoteMqttPublish(`${base}/event`, event, { retain: false }).catch(() => {});
  foodnoteMqttQueueSnapshot(userId, date, 'mutation');
}

app.get('/api/mqtt/status', requireUser, (req, res) => {
  foodnoteMqttEnsureStarted();
  res.json(foodnoteMqttStatus(req.foodnoteUserId));
});
app.get('/api/mqtt/snapshot', requireUser, (req, res) => {
  try {
    const date = String(req.query.date || foodnoteDateInTimezone()).slice(0, 10);
    res.json({ ok: true, snapshot: foodnoteMqttEntryPayload(req.foodnoteUserId, date, 'preview') });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/mqtt/discovery', requireUser, async (req, res) => {
  try {
    const result = await foodnoteMqttPublishDiscovery(req.foodnoteUserId);
    res.json({ ok:true, result, status: foodnoteMqttStatus(req.foodnoteUserId) });
  } catch (e) { res.status(500).json({ ok:false, error:e.message, status: foodnoteMqttStatus(req.foodnoteUserId) }); }
});
app.post('/api/mqtt/publish-now', requireUser, async (req, res) => {
  try {
    const date = String(req.body?.date || req.query.date || foodnoteDateInTimezone()).slice(0, 10);
    if (FOODNOTE_MQTT_CONFIG.discovery) await foodnoteMqttPublishDiscovery(req.foodnoteUserId).catch(() => {});
    const result = await foodnoteMqttPublishSnapshot(req.foodnoteUserId, date, 'manual-ui');
    res.json({ ok:true, result, status: foodnoteMqttStatus(req.foodnoteUserId) });
  } catch (e) { res.status(500).json({ ok:false, error:e.message, status: foodnoteMqttStatus(req.foodnoteUserId) }); }
});
app.post('/api/mqtt/test', requireUser, async (req, res) => {
  try {
    const userSlug = foodnoteMqttTopicPart(req.foodnoteUserId);
    const topic = `${FOODNOTE_MQTT_CONFIG.baseTopic}/${userSlug}/test`;
    const payload = { app: APP_LABEL, type: 'test', at: new Date().toISOString(), message: 'Test MQTT FoodNote OK' };
    await foodnoteMqttPublish(topic, payload, { retain: false });
    res.json({ ok:true, topic, payload, status: foodnoteMqttStatus(req.foodnoteUserId) });
  } catch (e) { res.status(500).json({ ok:false, error:e.message, status: foodnoteMqttStatus(req.foodnoteUserId) }); }
});


// ── FoodNote — diagnostic parcours quotidien ─────
const FOODNOTE_STABILITY_MUTATION_PATHS = [
  /^\/api\/data(?:\/|$)/,
  /^\/api\/entries(?:\/|$)/,
  /^\/api\/journal(?:\/|$)/,
  /^\/api\/foods(?:\/|$)/,
  /^\/api\/recipes(?:\/|$)/,
  /^\/api\/unit-weights(?:\/|$)/,
  /^\/api\/profile(?:\/|$)/,
  /^\/api\/profiles(?:\/|$)/,
  /^\/api\/settings(?:\/|$)/,
  /^\/api\/phases(?:\/|$)/,
  /^\/api\/restore(?:\/|$)/,
  /^\/api\/admin\/rebuild(?:\/|$)/
];

function foodnoteStabilityLatestAutoBackup() {
  try {
    const backups = listAutoBackups();
    return backups.length ? backups[0] : null;
  } catch (_) {
    return null;
  }
}

function foodnoteStabilityDbInfo() {
  let size = 0;
  let mtime = null;
  try {
    if (fs.existsSync(DB_FILE)) {
      const st = fs.statSync(DB_FILE);
      size = st.size;
      mtime = st.mtime.toISOString();
    }
  } catch (_) {}
  return {
    file: 'data/foodnote.db',
    path: DB_FILE,
    exists: fs.existsSync(DB_FILE),
    wal_exists: fs.existsSync(DB_FILE + '-wal'),
    shm_exists: fs.existsSync(DB_FILE + '-shm'),
    size,
    size_mb: Math.round((size / 1024 / 1024) * 100) / 100,
    mtime
  };
}

function foodnoteStabilityStatusForUser(userId) {
  const backups = (() => { try { return listAutoBackups(); } catch (_) { return []; } })();
  const latestBackup = backups[0] || null;
  const profilePayload = (() => { try { return buildProfileResponseForUser(userId); } catch (_) { return {}; } })();
  return {
    ok: true,
    name: 'FoodNote',
    label: APP_LABEL,
    version: APP_VERSION,
    build: APP_BUILD,
    release: APP_RELEASE,
    storage: 'sqlite-native',
    db: foodnoteStabilityDbInfo(),
    counts: sqliteCountsForUser(userId),
    profile: {
      exists: !!profilePayload.exists,
      source: profilePayload.source || null,
      phases: Array.isArray(profilePayload.phases) ? profilePayload.phases.length : 0
    },
    last_write: getMetaValue('stability_last_write', null),
    last_checkpoint: getMetaValue('stability_last_checkpoint', null),
    auto_backup: {
      folder: 'data/auto_backups',
      count: backups.length,
      latest: latestBackup,
      last: getMetaValue('auto_backup_last', null),
      last_error: getMetaValue('auto_backup_last_error', null),
      settings: getAutoBackupSettingsForUser(userId)
    }
  };
}

function foodnoteStabilityRecordWrite(req, statusCode) {
  try {
    const info = {
      at: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl || req.url,
      status: statusCode,
      user_id: req.foodnoteUserId || getUserId(req)
    };
    try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (e) {
      info.checkpoint_warning = e.message;
    }
    setMetaValue('stability_last_write', info);
    setMetaValue('stability_last_checkpoint', { at: info.at, mode: 'PASSIVE', source: 'diagnostic mutation guard' });
    foodnoteMqttNotifyMutation(req);
  } catch (e) {
    console.warn('[FoodNote diagnostics] suivi sauvegarde mutation impossible:', e.message);
  }
}

app.use((req, res, next) => {
  const method = String(req.method || '').toUpperCase();
  const pathOnly = String(req.path || req.url || '');
  const shouldTrack = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    && FOODNOTE_STABILITY_MUTATION_PATHS.some(rx => rx.test(pathOnly));
  if (shouldTrack) {
    res.on('finish', () => {
      if (res.statusCode < 400) setImmediate(() => foodnoteStabilityRecordWrite(req, res.statusCode));
    });
  }
  next();
});

app.get('/api/version', (req, res) => {
  res.json({
    ok: true,
    name: 'FoodNote',
    label: APP_LABEL,
    version: APP_VERSION,
    build: APP_BUILD,
    release: APP_RELEASE,
    storage: 'sqlite-native',
    db: foodnoteStabilityDbInfo()
  });
});

app.get('/api/data/status', requireUser, (req, res) => {
  try {
    res.json(foodnoteStabilityStatusForUser(req.foodnoteUserId));
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/data/backup', requireUser, async (req, res) => {
  try {
    const settings = getAutoBackupSettingsForUser(req.foodnoteUserId);
    const reason = String(req.body?.reason || 'manual-diagnostic-check').slice(0, 80);
    const result = await createAutoSQLiteBackup(reason, settings);
    res.json({ ok:true, result, status: foodnoteStabilityStatusForUser(req.foodnoteUserId) });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});



// v11.85 — Routes auto-backup enregistrées avant les fichiers statiques.
// Si ces routes ne sont pas déclarées avant express.static(), certains déploiements peuvent renvoyer index.html,
// ce qui provoque côté UI : Unexpected token '<'.
function foodnoteAutoBackupStatusHandler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      ok: true,
      settings: getAutoBackupSettingsForUser(req.foodnoteUserId),
      enabledGlobal: !!getEnabledAutoBackupConfig(),
      last: getMetaValue('auto_backup_last', null),
      lastError: getMetaValue('auto_backup_last_error', null),
      backups: listAutoBackups()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
}
function foodnoteAutoBackupSettingsHandler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const settings = setAutoBackupSettingsForUser(req.foodnoteUserId, req.body || {});
    res.json({ ok:true, settings, backups:listAutoBackups(), last:getMetaValue('auto_backup_last', null) });
    setTimeout(() => checkAutoBackupSchedule().catch(e => console.error('[FoodNote AutoBackup] check après réglage:', e.message)), 250);
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
}
async function foodnoteAutoBackupRunHandler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const settings = getAutoBackupSettingsForUser(req.foodnoteUserId);
    const result = await createAutoSQLiteBackup('manual-ui', settings);
    res.json({ ok:true, result, settings, backups:listAutoBackups() });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
}
app.get('/api/auto-backup/status', requireUser, foodnoteAutoBackupStatusHandler);
app.post('/api/auto-backup/settings', requireUser, foodnoteAutoBackupSettingsHandler);
app.post('/api/auto-backup/run', requireUser, foodnoteAutoBackupRunHandler);
// Alias au cas où un cache front ou proxy remplace le tiret.
app.get('/api/autobackup/status', requireUser, foodnoteAutoBackupStatusHandler);
app.post('/api/autobackup/settings', requireUser, foodnoteAutoBackupSettingsHandler);
app.post('/api/autobackup/run', requireUser, foodnoteAutoBackupRunHandler);


// Librairie scanner code-barres locale.
// Important: avec Docker, /app est monté en lecture seule depuis l'hôte, tandis que
// les modules Node sont dans /srv/node_modules. On sert donc d'abord la copie
// embarquée dans public/vendor, puis les emplacements node_modules possibles.
app.get('/vendor/html5-qrcode.min.js', (req, res) => {
  const candidates = [
    path.join(PUBLIC_DIR, 'vendor', 'html5-qrcode.min.js'),
    path.join('/srv', 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'),
    path.join(__dirname, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js')
  ];
  const vendorFile = candidates.find((file) => {
    try { return fs.existsSync(file); } catch (_) { return false; }
  });
  if (!vendorFile) {
    return res.status(404).type('text/plain').send('html5-qrcode non disponible. Le scan natif BarcodeDetector reste utilisé si le navigateur le supporte.');
  }
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.type('application/javascript');
  res.sendFile(vendorFile);
});



// ── API Recettes : aliment composé maison réutilisable ─────
function recipeNum(v, fallback = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}
function recipeRound1(v) { return Math.round((Number(v) || 0) * 10) / 10; }
function recipeRoundKcal(v) { return Math.round(Number(v) || 0); }
function recipeCleanPhotoData(photo) {
  const txt = String(photo || '').trim();
  if (!txt) return '';
  if (!txt.startsWith('data:image/')) return '';
  // Limite volontaire : illustration légère, pas stockage de photos géantes dans SQLite.
  return txt.length > 900000 ? '' : txt;
}
function normalizeRecipeIngredientPayload(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || item.nom || '').trim();
  if (!name) return null;
  const qty = recipeNum(item.qty ?? item.quantity ?? item.quantite, 0);
  const unit = String(item.unit || item.unite || 'g').slice(0, 24) || 'g';
  const unitWeight = item.unit_weight == null && item.poidsUnite == null ? null : recipeNum(item.unit_weight ?? item.poidsUnite, 0);
  const grams = unit !== 'g' && unitWeight > 0 ? qty * unitWeight : qty;
  const kcal100 = recipeNum(item.kcal100 ?? item.kcalPer100, 0);
  const prot100 = recipeNum(item.prot100 ?? item.protPer100, 0);
  const gluc100 = recipeNum(item.gluc100 ?? item.glucPer100, 0);
  const lip100 = recipeNum(item.lip100 ?? item.lipPer100, 0);
  const kcal = item.kcal == null ? kcal100 * grams / 100 : recipeNum(item.kcal, 0);
  const prot = item.prot == null ? prot100 * grams / 100 : recipeNum(item.prot, 0);
  const gluc = item.gluc == null ? gluc100 * grams / 100 : recipeNum(item.gluc, 0);
  const lip = item.lip == null ? lip100 * grams / 100 : recipeNum(item.lip, 0);
  const out = {
    name,
    qty: Math.max(0, qty),
    unit,
    unit_weight: unitWeight > 0 ? unitWeight : null,
    unit_label: String(item.unit_label || item.uniteLabel || '').slice(0, 40),
    kcal: recipeRoundKcal(kcal),
    prot: recipeRound1(prot),
    gluc: recipeRound1(gluc),
    lip: recipeRound1(lip),
    kcal100: recipeRoundKcal(kcal100),
    prot100: recipeRound1(prot100),
    gluc100: recipeRound1(gluc100),
    lip100: recipeRound1(lip100),
    source: String(item.source || 'manual').slice(0, 40),
    raw_json: JSON.stringify(item)
  };
  assertEntryFoodLineAllowed({ nom: out.name, qty: grams || out.qty || 1, unite: 'g', kcal: out.kcal, prot: out.prot, gluc: out.gluc, lip: out.lip });
  return out;
}
function normalizeRecipePayload(body) {
  const name = String(body?.name || body?.nom || '').trim();
  if (!name) throw foodnoteBadRequest('Nom de recette obligatoire.');
  const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : []).map(normalizeRecipeIngredientPayload).filter(Boolean);
  const totals = ingredients.reduce((acc, it) => {
    acc.kcal += Number(it.kcal || 0); acc.prot += Number(it.prot || 0); acc.gluc += Number(it.gluc || 0); acc.lip += Number(it.lip || 0);
    return acc;
  }, { kcal:0, prot:0, gluc:0, lip:0 });
  let totalWeight = recipeNum(body.total_weight ?? body.totalWeight ?? body.poidsTotal, 0);
  if (!totalWeight) {
    totalWeight = ingredients.reduce((sum, it) => sum + (it.unit !== 'g' && it.unit_weight > 0 ? it.qty * it.unit_weight : it.qty), 0);
  }
  const portions = Math.max(0.1, recipeNum(body.portions, 1) || 1);
  const kcal100 = totalWeight > 0 ? totals.kcal * 100 / totalWeight : recipeNum(body.kcal100, 0);
  const prot100 = totalWeight > 0 ? totals.prot * 100 / totalWeight : recipeNum(body.prot100, 0);
  const gluc100 = totalWeight > 0 ? totals.gluc * 100 / totalWeight : recipeNum(body.gluc100, 0);
  const lip100 = totalWeight > 0 ? totals.lip * 100 / totalWeight : recipeNum(body.lip100, 0);
  const recipeFood = { nom: name, kcal100, prot100, gluc100, lip100, unite:'g' };
  assertFoodPer100Allowed(recipeFood);
  return {
    id: body?.id == null || body.id === '' ? null : Number(body.id),
    name,
    description: String(body.description || '').slice(0, 2000),
    photo_data: recipeCleanPhotoData(body.photo_data || body.photoData || body.photo || ''),
    portions,
    total_weight: recipeRound1(totalWeight),
    kcal_total: recipeRoundKcal(totals.kcal),
    prot_total: recipeRound1(totals.prot),
    gluc_total: recipeRound1(totals.gluc),
    lip_total: recipeRound1(totals.lip),
    kcal100: recipeRoundKcal(kcal100),
    prot100: recipeRound1(prot100),
    gluc100: recipeRound1(gluc100),
    lip100: recipeRound1(lip100),
    source: String(body.source || 'manual').slice(0, 40),
    creation_source: String(body.creation_source || body.creationSource || body.source || 'manual').slice(0, 40),
    is_ai_estimated: (body.is_ai_estimated === true || body.isAiEstimated === true || Number(body.is_ai_estimated || body.ai_estimated || 0) === 1) ? 1 : 0,
    raw_scan_text: String(body.raw_scan_text || body.rawScanText || '').slice(0, 20000),
    ai_estimation_json: (() => { try { return typeof body.ai_estimation_json === 'string' ? body.ai_estimation_json.slice(0, 60000) : JSON.stringify(body.ai_estimation_json || body.aiEstimation || null); } catch(_) { return ''; } })(),
    notes: String(body.notes || '').slice(0, 4000),
    raw_json: JSON.stringify({ ...body, photo_data: body?.photo_data ? '[stored]' : undefined, photoData: body?.photoData ? '[stored]' : undefined, photo: body?.photo ? '[stored]' : undefined }),
    ingredients
  };
}
function recipeIngredientToApi(row) {
  return {
    id: row.id,
    name: row.name,
    nom: row.name,
    qty: Number(row.qty || 0),
    unit: row.unit || 'g',
    unite: row.unit || 'g',
    unit_weight: row.unit_weight == null ? null : Number(row.unit_weight || 0),
    poidsUnite: row.unit_weight == null ? null : Number(row.unit_weight || 0),
    unit_label: row.unit_label || '',
    uniteLabel: row.unit_label || '',
    kcal: Number(row.kcal || 0),
    prot: Number(row.prot || 0),
    gluc: Number(row.gluc || 0),
    lip: Number(row.lip || 0),
    kcal100: Number(row.kcal100 || 0),
    prot100: Number(row.prot100 || 0),
    gluc100: Number(row.gluc100 || 0),
    lip100: Number(row.lip100 || 0),
    source: row.source || 'manual'
  };
}
function recipeToApi(row, includeIngredients = true) {
  const out = {
    id: row.id,
    name: row.name,
    nom: row.name,
    description: row.description || '',
    photo_data: row.photo_data || '',
    portions: Number(row.portions || 1),
    total_weight: Number(row.total_weight || 0),
    totalWeight: Number(row.total_weight || 0),
    kcal_total: Number(row.kcal_total || 0),
    prot_total: Number(row.prot_total || 0),
    gluc_total: Number(row.gluc_total || 0),
    lip_total: Number(row.lip_total || 0),
    kcal100: Number(row.kcal100 || 0),
    prot100: Number(row.prot100 || 0),
    gluc100: Number(row.gluc100 || 0),
    lip100: Number(row.lip100 || 0),
    source: row.source || 'manual',
    creation_source: row.creation_source || row.source || 'manual',
    creationSource: row.creation_source || row.source || 'manual',
    is_ai_estimated: Number(row.is_ai_estimated || 0) === 1,
    isAiEstimated: Number(row.is_ai_estimated || 0) === 1,
    raw_scan_text: row.raw_scan_text || '',
    rawScanText: row.raw_scan_text || '',
    ai_estimation_json: row.ai_estimation_json || '',
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    nutrition_per_portion: {
      kcal: recipeRoundKcal((row.kcal_total || 0) / Math.max(0.1, row.portions || 1)),
      prot: recipeRound1((row.prot_total || 0) / Math.max(0.1, row.portions || 1)),
      gluc: recipeRound1((row.gluc_total || 0) / Math.max(0.1, row.portions || 1)),
      lip: recipeRound1((row.lip_total || 0) / Math.max(0.1, row.portions || 1))
    }
  };
  if (includeIngredients) {
    out.ingredients = db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id=? ORDER BY id').all(row.id).map(recipeIngredientToApi);
  }
  return out;
}
function recipeAsFoodItem(recipe) {
  const perPortionWeight = recipe.total_weight > 0 && recipe.portions > 0 ? recipe.total_weight / recipe.portions : null;
  return {
    id: 'recipe_' + recipe.id,
    recipe_id: recipe.id,
    nom: recipe.name,
    name: recipe.name,
    kcal100: Number(recipe.kcal100 || 0),
    prot100: Number(recipe.prot100 || 0),
    gluc100: Number(recipe.gluc100 || 0),
    lip100: Number(recipe.lip100 || 0),
    unite: perPortionWeight ? 'portion' : 'g',
    unit: perPortionWeight ? 'portion' : 'g',
    poidsUnite: perPortionWeight ? recipeRound1(perPortionWeight) : null,
    unit_weight: perPortionWeight ? recipeRound1(perPortionWeight) : null,
    uniteLabel: perPortionWeight ? 'portion' : '',
    unit_label: perPortionWeight ? 'portion' : '',
    source: 'recipe',
    meta: `Recette · ${recipe.portions || 1} portion(s) · ${recipe.total_weight || 0}g`,
    portions: recipe.portions,
    total_weight: recipe.total_weight,
    photo_data: recipe.photo_data || ''
  };
}
function listRecipesForUser(userId, query = {}) {
  const q = String(query.q || query.search || '').trim();
  const limit = Math.min(Math.max(parseInt(query.limit || '100', 10) || 100, 1), 500);
  const params = [userId];
  let where = 'WHERE user_id=?';
  if (q) {
    where += ' AND LOWER(name) LIKE ?';
    params.push('%' + q.toLowerCase() + '%');
  }
  params.push(limit);
  const rows = db.prepare(`SELECT * FROM recipes ${where} ORDER BY updated_at DESC, LOWER(name) ASC LIMIT ?`).all(...params);
  return { ok:true, count: rows.length, recipes: rows.map(r => recipeToApi(r, true)) };
}
function saveRecipeForUser(userId, payload) {
  const recipe = normalizeRecipePayload(payload);
  let recipeId = recipe.id;
  const tx = db.transaction(() => {
    if (recipeId) {
      const exists = db.prepare('SELECT id FROM recipes WHERE user_id=? AND id=?').get(userId, recipeId);
      if (!exists) throw foodnoteBadRequest('Recette introuvable.');
      db.prepare(`
        UPDATE recipes SET name=?, description=?, photo_data=?, portions=?, total_weight=?, kcal_total=?, prot_total=?, gluc_total=?, lip_total=?, kcal100=?, prot100=?, gluc100=?, lip100=?, source=?, creation_source=?, is_ai_estimated=?, raw_scan_text=?, ai_estimation_json=?, notes=?, raw_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE user_id=? AND id=?
      `).run(recipe.name, recipe.description, recipe.photo_data, recipe.portions, recipe.total_weight, recipe.kcal_total, recipe.prot_total, recipe.gluc_total, recipe.lip_total, recipe.kcal100, recipe.prot100, recipe.gluc100, recipe.lip100, recipe.source, recipe.creation_source, recipe.is_ai_estimated, recipe.raw_scan_text, recipe.ai_estimation_json, recipe.notes, recipe.raw_json, userId, recipeId);
      db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id=?').run(recipeId);
    } else {
      const info = db.prepare(`
        INSERT INTO recipes (user_id, name, description, photo_data, portions, total_weight, kcal_total, prot_total, gluc_total, lip_total, kcal100, prot100, gluc100, lip100, source, creation_source, is_ai_estimated, raw_scan_text, ai_estimation_json, notes, raw_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(userId, recipe.name, recipe.description, recipe.photo_data, recipe.portions, recipe.total_weight, recipe.kcal_total, recipe.prot_total, recipe.gluc_total, recipe.lip_total, recipe.kcal100, recipe.prot100, recipe.gluc100, recipe.lip100, recipe.source, recipe.creation_source, recipe.is_ai_estimated, recipe.raw_scan_text, recipe.ai_estimation_json, recipe.notes, recipe.raw_json);
      recipeId = info.lastInsertRowid;
    }
    const ins = db.prepare(`
      INSERT INTO recipe_ingredients (recipe_id, name, qty, unit, unit_weight, unit_label, kcal, prot, gluc, lip, kcal100, prot100, gluc100, lip100, source, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    for (const it of recipe.ingredients) {
      ins.run(recipeId, it.name, it.qty, it.unit, it.unit_weight, it.unit_label, it.kcal, it.prot, it.gluc, it.lip, it.kcal100, it.prot100, it.gluc100, it.lip100, it.source, it.raw_json);
    }
  });
  tx();
  const row = db.prepare('SELECT * FROM recipes WHERE user_id=? AND id=?').get(userId, recipeId);
  return recipeToApi(row, true);
}

app.get('/api/recipes', requireUser, (req, res) => {
  try { res.json(listRecipesForUser(req.foodnoteUserId, req.query)); }
  catch(e) { res.status(e.status || 500).json({ ok:false, error:e.message }); }
});
app.get('/api/recipes/search', requireUser, (req, res) => {
  try {
    const payload = listRecipesForUser(req.foodnoteUserId, { q:req.query.q || '', limit:req.query.limit || 20 });
    res.json({ ok:true, items: payload.recipes.map(recipeAsFoodItem), recipes: payload.recipes });
  } catch(e) { res.status(e.status || 500).json({ ok:false, error:e.message }); }
});
app.get('/api/recipes/:id', requireUser, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM recipes WHERE user_id=? AND id=?').get(req.foodnoteUserId, req.params.id);
    if (!row) return res.status(404).json({ ok:false, error:'Recette introuvable' });
    res.json({ ok:true, recipe: recipeToApi(row, true) });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/recipes', requireUser, (req, res) => {
  try { res.json({ ok:true, recipe: saveRecipeForUser(req.foodnoteUserId, req.body || {}) }); }
  catch(e) { res.status(e.status || 500).json({ ok:false, error:e.message }); }
});
app.put('/api/recipes/:id', requireUser, (req, res) => {
  try { res.json({ ok:true, recipe: saveRecipeForUser(req.foodnoteUserId, { ...(req.body || {}), id:req.params.id }) }); }
  catch(e) { res.status(e.status || 500).json({ ok:false, error:e.message }); }
});
app.delete('/api/recipes/:id', requireUser, (req, res) => {
  try {
    const r = db.prepare('DELETE FROM recipes WHERE user_id=? AND id=?').run(req.foodnoteUserId, req.params.id);
    res.json({ ok:true, deleted: r.changes });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/recipes/:id/add-to-entry', requireUser, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM recipes WHERE user_id=? AND id=?').get(req.foodnoteUserId, req.params.id);
    if (!row) return res.status(404).json({ ok:false, error:'Recette introuvable' });
    const recipe = recipeToApi(row, false);
    const date = String(req.body?.date || '').slice(0, 10);
    if (!date) return res.status(400).json({ ok:false, error:'date obligatoire' });
    const qty = recipeNum(req.body?.qty, (recipe.total_weight && recipe.portions ? recipe.total_weight / recipe.portions : 100)) || 100;
    const food = {
      nom: recipe.name,
      qty,
      unite: 'g',
      kcal: recipeRoundKcal(recipe.kcal100 * qty / 100),
      prot: recipeRound1(recipe.prot100 * qty / 100),
      gluc: recipeRound1(recipe.gluc100 * qty / 100),
      lip: recipeRound1(recipe.lip100 * qty / 100),
      meal: req.body?.meal || 'lunch',
      source: 'recipe',
      recipeId: recipe.id
    };
    const existingRow = db.prepare('SELECT * FROM entries WHERE user_id=? AND date=?').get(req.foodnoteUserId, date);
    const existing = existingRow ? entryToApi(existingRow, true) : null;
    const merged = mergeFoodIntoEntryForAppend(existing, date, food, req.body || {});
    upsertNormalizedEntry(req.foodnoteUserId, merged);
    const savedRow = db.prepare('SELECT * FROM entries WHERE user_id=? AND date=?').get(req.foodnoteUserId, date);
    res.json({ ok:true, entry: entryToApi(savedRow, true), mode:'recipe-append' });
  } catch(e) { res.status(e.status || 500).json({ ok:false, error:e.message }); }
});


app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ── Health / debug ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const structuredEntries = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
  const stateRows = db.prepare("SELECT user_id, data_json FROM app_state WHERE namespace='data'").all();
  let compatibleEntries = 0;
  for (const r of stateRows) compatibleEntries += normalizeEntriesPayload(safeJsonParse(r.data_json, {})).length;
  res.json({
    ok: true,
    version: APP_VERSION,
    label: APP_LABEL,
    build: APP_BUILD,
    storage: 'sqlite',
    db: DB_FILE,
    default_user: DEFAULT_USER_ID,
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    entries: structuredEntries,
    compatible_entries: compatibleEntries,
    food_rows: db.prepare('SELECT COUNT(*) AS n FROM entry_foods').get().n,
    foods: db.prepare('SELECT COUNT(*) AS n FROM foods').get().n,
    recipes: db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n,
    recipe_ingredients: db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredients').get().n,
    sport_rows: db.prepare('SELECT COUNT(*) AS n FROM sports').get().n,
  });
});


function normalizePhasesPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.phases)) return payload.phases;
  if (payload.profile && Array.isArray(payload.profile.phases)) return payload.profile.phases;
  if (payload.profil && Array.isArray(payload.profil.phases)) return payload.profil.phases;
  return [];
}

function restoreJsonBackupForUser(userId, payload) {
  if (!payload || typeof payload !== 'object') throw new Error('JSON invalide');
  const state = {
    journal_entries: normalizeEntriesPayload(payload),
    custom_aliments: Array.isArray(payload.custom_aliments) ? payload.custom_aliments : [],
    bdd_aliments: normalizeFoodsPayload(payload),
    sports_config: Array.isArray(payload.sports_config) ? payload.sports_config : [],
    bdd_seed_version: payload.bdd_seed_version || 0,
  };

  const unitWeights = Array.isArray(payload.unit_weights) ? payload.unit_weights
    : (Array.isArray(payload.food_unit_weights) ? payload.food_unit_weights : []);
  const extractedProfile = extractProfileCandidate(payload);
  const phases = normalizePhasesPayload(payload);
  const profile = normalizeProfileTargets(extractedProfile, phases);
  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : extractSettingsCandidate(payload);

  const tx = db.transaction(() => {
    ensureUser(userId);

    // Remplacement volontaire : l'utilisateur a confirmé l'import.
    db.prepare('DELETE FROM entries WHERE user_id=?').run(userId); // cascade entry_foods + sports
    db.prepare('DELETE FROM foods WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM food_unit_weights WHERE user_id=?').run(userId);

    setState(userId, 'data', state);
    for (const entry of state.journal_entries) upsertNormalizedEntry(userId, entry);
    replaceFoodsForUser(userId, state.bdd_aliments);

    if (unitWeights.length) {
      const cleanUnits = unitWeights.map(unitWeightPayloadToDb).filter(Boolean);
      const stmt = db.prepare('INSERT INTO food_unit_weights (user_id, label, aliases_json, grams, source, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
      for (const w of cleanUnits) stmt.run(userId, w.label, JSON.stringify(w.aliases), w.grams, w.source);
    } else {
      seedUnitWeights(userId);
    }

    if (profile || phases.length) {
      const finalProfile = normalizeProfileTargets(profile || {}, phases);
      db.prepare(`
        INSERT INTO profiles (user_id, data_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP
      `).run(userId, JSON.stringify(finalProfile, null, 2));

      if (phases.length) {
        db.prepare('DELETE FROM phases WHERE user_id=?').run(userId);
        const pStmt = db.prepare(`
          INSERT INTO phases (user_id, name, weeks, kcal_target, prot_target, gluc_target, lip_target, order_index, raw_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        phases.forEach((ph, i) => pStmt.run(
          userId,
          String(ph.label || ph.name || ph.id || 'Phase ' + (i + 1)),
          Number(ph.weeks || 1),
          toNumberOrNull(ph.kcal ?? ph.kcalTarget ?? ph.cibleKcal),
          toNumberOrNull(ph.prot ?? ph.protTarget ?? ph.cibleProt),
          toNumberOrNull(ph.gluc ?? ph.glucTarget ?? ph.cibleGluc),
          toNumberOrNull(ph.lip ?? ph.lipTarget ?? ph.cibleLip),
          i,
          JSON.stringify(ph)
        ));
      }
    }

    if (settings) {
      for (const [key, value] of Object.entries(settings)) {
        db.prepare(`
          INSERT INTO settings (user_id, key, value_json, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP
        `).run(userId, String(key), JSON.stringify(value));
      }
    }
  });

  tx();

  return {
    entries: db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id=?').get(userId).n,
    foods: db.prepare('SELECT COUNT(*) AS n FROM foods WHERE user_id=?').get(userId).n,
    unit_weights: db.prepare('SELECT COUNT(*) AS n FROM food_unit_weights WHERE user_id=?').get(userId).n,
    phases: db.prepare('SELECT COUNT(*) AS n FROM phases WHERE user_id=?').get(userId).n,
    profile: !!db.prepare('SELECT user_id FROM profiles WHERE user_id=?').get(userId),
  };
}


function buildJsonMigrationBackupForUser(userId) {
  const entryRows = db.prepare('SELECT * FROM entries WHERE user_id=? ORDER BY date DESC').all(userId);
  const journal_entries = entryRows.map(e => entryToApi(e, true));
  const bdd_aliments = db.prepare('SELECT * FROM foods WHERE user_id=? ORDER BY name COLLATE NOCASE').all(userId).map(foodToApi);
  const unit_weights = db.prepare('SELECT * FROM food_unit_weights WHERE user_id=? ORDER BY label COLLATE NOCASE').all(userId).map(unitWeightToApi);
  const recipes = listRecipesForUser(userId, {}).recipes;
  const profilePayload = buildProfileResponseForUser(userId);
  const profile = profilePayload.profile;
  const phases = profilePayload.phases || [];
  const settingsRows = db.prepare('SELECT key, value_json FROM settings WHERE user_id=?').all(userId);
  const settings = {};
  for (const r of settingsRows) settings[r.key] = safeJsonParse(r.value_json, null);
  const state = getState(userId, 'data', {});
  return {
    version: 4,
    type: 'foodnote-json-migration-export',
    note: 'Export JSON serveur depuis SQLite. La sauvegarde complète officielle reste le fichier SQLite data/foodnote.db.',
    exportedAt: new Date().toISOString(),
    profile,
    phases,
    settings,
    unit_weights,
    recipes,
    journal_entries,
    entries: journal_entries,
    bdd_aliments,
    custom_aliments: Array.isArray(state.custom_aliments) ? state.custom_aliments : [],
    sports_config: Array.isArray(state.sports_config) ? state.sports_config : [],
    bdd_seed_version: state.bdd_seed_version || 0,
    counts: {
      journal_entries: journal_entries.length,
      bdd_aliments: bdd_aliments.length,
      unit_weights: unit_weights.length,
      phases: phases.length,
      recipes: recipes.length,
    }
  };
}

app.get('/api/backup/json', requireUser, (req, res) => {
  try {
    const payload = buildJsonMigrationBackupForUser(req.foodnoteUserId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="foodnote_export_migration_${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});


app.get('/api/backup/sqlite', requireUser, async (req, res) => {
  try {
    ensureDir(DATA_DIR);

    // Important avec SQLite en WAL : avant de servir une sauvegarde UI,
    // on force un checkpoint puis on crée une copie cohérente via l'API backup.
    // Comme ça le fichier téléchargé contient aussi les écritures récentes.
    try { db.pragma('wal_checkpoint(FULL)'); } catch (e) {
      console.warn('[FoodNote Backup] Checkpoint WAL non bloquant:', e.message);
    }

    const counts = sqliteCountsForUser(req.foodnoteUserId);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmpFile = path.join(DATA_DIR, `foodnote_backup_${stamp}.db`);
    await db.backup(tmpFile);

    // Vérification rapide de la copie générée avant téléchargement.
    try {
      const checkDb = new Database(tmpFile, { readonly: true, fileMustExist: true });
      const copiedEntries = checkDb.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id=?').get(req.foodnoteUserId).n;
      checkDb.close();
      res.setHeader('X-FoodNote-Entries', String(copiedEntries));
      res.setHeader('X-FoodNote-Compatible-Entries', String(counts.compatible_entries));
    } catch (e) {
      console.warn('[FoodNote Backup] Vérification sauvegarde impossible:', e.message);
    }

    res.download(tmpFile, `foodnote_${new Date().toISOString().slice(0,10)}.db`, (err) => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
      if (err && !res.headersSent) res.status(500).json({ ok:false, error: err.message });
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});


app.post('/api/restore/sqlite', requireUser, express.raw({ type: ['application/octet-stream', 'application/x-sqlite3', 'application/vnd.sqlite3'], limit: '200mb' }), async (req, res) => {
  let tmpFile = null;
  let currentBackup = null;
  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length < 1024) {
      return res.status(400).json({ ok:false, error:'Fichier SQLite invalide ou vide.' });
    }
    ensureDir(DATA_DIR);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    tmpFile = path.join(DATA_DIR, `foodnote_restore_upload_${stamp}.db`);
    currentBackup = path.join(DATA_DIR, `foodnote_before_restore_${stamp}.db`);
    fs.writeFileSync(tmpFile, req.body);

    // Validation du fichier uploadé avant remplacement.
    const uploaded = new Database(tmpFile, { readonly: true, fileMustExist: true });
    const tables = uploaded.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    const hasEntries = tables.includes('entries');
    const hasEntryFoods = tables.includes('entry_foods');
    const hasUsers = tables.includes('users');
    if (!hasEntries || !hasEntryFoods || !hasUsers) {
      uploaded.close();
      throw new Error('Ce fichier ne ressemble pas à une base FoodNote valide : tables entries/entry_foods/users manquantes.');
    }
    const uploadedCounts = {
      entries: uploaded.prepare('SELECT COUNT(*) AS n FROM entries').get().n,
      entry_foods: uploaded.prepare('SELECT COUNT(*) AS n FROM entry_foods').get().n,
      sports: tables.includes('sports') ? uploaded.prepare('SELECT COUNT(*) AS n FROM sports').get().n : 0,
      foods: tables.includes('foods') ? uploaded.prepare('SELECT COUNT(*) AS n FROM foods').get().n : 0,
      phases: tables.includes('phases') ? uploaded.prepare('SELECT COUNT(*) AS n FROM phases').get().n : 0,
      profiles: tables.includes('profiles') ? uploaded.prepare('SELECT COUNT(*) AS n FROM profiles').get().n : 0,
    };
    uploaded.close();

    // Sauvegarde de sécurité de la base actuelle avant remplacement.
    try { db.pragma('wal_checkpoint(FULL)'); } catch (_) {}
    try { await db.backup(currentBackup); } catch (e) {
      console.warn('[FoodNote Restore SQLite] Backup pré-restore impossible, copie brute tentée:', e.message);
      if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, currentBackup);
    }

    // On ferme SQLite puis on remplace le fichier. Le conteneur redémarre via restart: unless-stopped.
    try { db.close(); } catch (_) {}
    for (const suffix of ['', '-wal', '-shm']) {
      const f = DB_FILE + suffix;
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
    fs.copyFileSync(tmpFile, DB_FILE);
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    res.json({
      ok: true,
      message: 'Base SQLite restaurée. Le serveur redémarre automatiquement pour rouvrir la nouvelle base.',
      restored_counts: uploadedCounts,
      previous_backup: currentBackup,
      restart: true
    });
    setTimeout(() => process.exit(0), 700);
  } catch (e) {
    try { if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.get('/api/backup/status', requireUser, (req, res) => {
  try {
    const profilePayload = buildProfileResponseForUser(req.foodnoteUserId);
    res.json({
      ok: true,
      storage: 'sqlite',
      db: DB_FILE,
      counts: sqliteCountsForUser(req.foodnoteUserId),
      profile: {
        exists: profilePayload.exists,
        source: profilePayload.source,
        prenom: profilePayload.profile?.prenom || profilePayload.profile?.name || '',
        cibleKcal: profilePayload.profile?.cibleKcal || null,
        cibleProt: profilePayload.profile?.cibleProt || null,
        cibleGluc: profilePayload.profile?.cibleGluc || null,
        cibleLip: profilePayload.profile?.cibleLip || null,
        phases: Array.isArray(profilePayload.phases) ? profilePayload.phases.length : 0
      }
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});


function foodnoteLocalDateStamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function foodnoteLocalTimeStamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${foodnoteLocalDateStamp(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function getMetaValue(key, fallback = null) {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return row ? safeJsonParse(row.value, row.value) : fallback;
  } catch (_) { return fallback; }
}
function setMetaValue(key, value) {
  db.prepare(`
    INSERT INTO meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, JSON.stringify(value));
}
function normalizeAutoBackupSettings(value) {
  const v = value && typeof value === 'object' ? value : {};
  const hour = Math.max(0, Math.min(23, Number.isFinite(Number(v.hour)) ? Math.round(Number(v.hour)) : 3));
  const minute = Math.max(0, Math.min(59, Number.isFinite(Number(v.minute)) ? Math.round(Number(v.minute)) : 0));
  const keep = Math.max(3, Math.min(365, Number.isFinite(Number(v.keep)) ? Math.round(Number(v.keep)) : 14));
  return {
    enabled: !!v.enabled,
    hour,
    minute,
    keep,
    folder: 'data/auto_backups'
  };
}
function getAutoBackupSettingsForUser(userId) {
  const row = db.prepare('SELECT value_json FROM settings WHERE user_id=? AND key=?').get(userId, AUTO_BACKUP_SETTINGS_KEY);
  return normalizeAutoBackupSettings(row ? safeJsonParse(row.value_json, {}) : {});
}
function setAutoBackupSettingsForUser(userId, settings) {
  const normalized = normalizeAutoBackupSettings(settings);
  db.prepare(`
    INSERT INTO settings (user_id, key, value_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP
  `).run(userId, AUTO_BACKUP_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}
function listAutoBackups() {
  ensureDir(AUTO_BACKUP_DIR);
  return fs.readdirSync(AUTO_BACKUP_DIR)
    .filter(name => /^foodnote_auto_.*\.db$/i.test(name))
    .map(name => {
      const full = path.join(AUTO_BACKUP_DIR, name);
      const st = fs.statSync(full);
      return {
        name,
        path: `data/auto_backups/${name}`,
        size: st.size,
        sizeMb: Math.round((st.size / 1024 / 1024) * 100) / 100,
        mtime: st.mtime.toISOString()
      };
    })
    .sort((a, b) => String(b.name).localeCompare(String(a.name)));
}
function pruneAutoBackups(keep) {
  const backups = listAutoBackups();
  backups.slice(Math.max(0, keep)).forEach(item => {
    try { fs.unlinkSync(path.join(AUTO_BACKUP_DIR, item.name)); } catch (e) {
      console.warn('[FoodNote AutoBackup] Suppression ancienne sauvegarde impossible:', item.name, e.message);
    }
  });
  return listAutoBackups();
}
async function createAutoSQLiteBackup(reason = 'auto', options = {}) {
  ensureDir(AUTO_BACKUP_DIR);
  try { db.pragma('wal_checkpoint(FULL)'); } catch (e) {
    console.warn('[FoodNote AutoBackup] Checkpoint WAL non bloquant:', e.message);
  }
  const stamp = foodnoteLocalTimeStamp();
  const outFile = path.join(AUTO_BACKUP_DIR, `foodnote_auto_${stamp}.db`);
  await db.backup(outFile);
  let entries = null;
  try {
    const checkDb = new Database(outFile, { readonly: true, fileMustExist: true });
    entries = checkDb.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
    checkDb.close();
  } catch (e) {
    console.warn('[FoodNote AutoBackup] Vérification non bloquante:', e.message);
  }
  const keep = Math.max(3, Math.min(365, Number(options.keep || 14) || 14));
  const backups = pruneAutoBackups(keep);
  const info = {
    ok: true,
    reason,
    name: path.basename(outFile),
    path: `data/auto_backups/${path.basename(outFile)}`,
    createdAt: new Date().toISOString(),
    entries,
    keep,
    count: backups.length
  };
  setMetaValue('auto_backup_last', info);
  setMetaValue('auto_backup_last_date', foodnoteLocalDateStamp());
  console.log(`[FoodNote AutoBackup] ${info.name} créé (${reason})`);
  return info;
}
function getEnabledAutoBackupConfig() {
  const rows = db.prepare('SELECT user_id, value_json FROM settings WHERE key=?').all(AUTO_BACKUP_SETTINGS_KEY);
  const enabled = rows
    .map(r => ({ user_id: r.user_id, settings: normalizeAutoBackupSettings(safeJsonParse(r.value_json, {})) }))
    .filter(r => r.settings.enabled);
  if (!enabled.length) return null;
  // Un seul fichier SQLite global suffit. On prend l'heure la plus précoce configurée.
  enabled.sort((a, b) => (a.settings.hour * 60 + a.settings.minute) - (b.settings.hour * 60 + b.settings.minute));
  const keep = Math.max(...enabled.map(r => Number(r.settings.keep || 14) || 14));
  return { ...enabled[0], settings: { ...enabled[0].settings, keep } };
}
let autoBackupRunning = false;
async function checkAutoBackupSchedule() {
  if (autoBackupRunning) return;
  const cfg = getEnabledAutoBackupConfig();
  if (!cfg) return;
  const now = new Date();
  const today = foodnoteLocalDateStamp(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesTarget = cfg.settings.hour * 60 + cfg.settings.minute;
  const lastDate = getMetaValue('auto_backup_last_date', null);
  if (lastDate === today || minutesNow < minutesTarget) return;
  autoBackupRunning = true;
  try {
    await createAutoSQLiteBackup('daily', cfg.settings);
  } catch (e) {
    console.error('[FoodNote AutoBackup] Erreur sauvegarde journalière:', e.message);
    setMetaValue('auto_backup_last_error', { at: new Date().toISOString(), error: e.message });
  } finally {
    autoBackupRunning = false;
  }
}

app.get('/api/auto-backup/status', requireUser, (req, res) => {
  try {
    res.json({
      ok: true,
      settings: getAutoBackupSettingsForUser(req.foodnoteUserId),
      enabledGlobal: !!getEnabledAutoBackupConfig(),
      last: getMetaValue('auto_backup_last', null),
      lastError: getMetaValue('auto_backup_last_error', null),
      backups: listAutoBackups()
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/auto-backup/settings', requireUser, (req, res) => {
  try {
    const settings = setAutoBackupSettingsForUser(req.foodnoteUserId, req.body || {});
    res.json({ ok:true, settings, backups:listAutoBackups(), last:getMetaValue('auto_backup_last', null) });
    setTimeout(() => checkAutoBackupSchedule().catch(e => console.error('[FoodNote AutoBackup] check après réglage:', e.message)), 250);
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/auto-backup/run', requireUser, async (req, res) => {
  try {
    const settings = getAutoBackupSettingsForUser(req.foodnoteUserId);
    const result = await createAutoSQLiteBackup('manual-ui', settings);
    res.json({ ok:true, result, settings, backups:listAutoBackups() });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get('/api/admin/rebuild-days', requireUser, (req, res) => {
  res.status(405).json({
    ok: false,
    error: 'Cette action doit être appelée en POST.',
    example: 'curl -X POST http://IP:PORT/api/admin/rebuild-days'
  });
});

app.post('/api/admin/rebuild-days', requireUser, (req, res) => {
  try {
    const result = normalizeStoredStateForUser(req.foodnoteUserId);
    res.json({ ok: true, result, counts: sqliteCountsForUser(req.foodnoteUserId) });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});


app.post('/api/restore/json', requireUser, (req, res) => {
  try {
    const summary = restoreJsonBackupForUser(req.foodnoteUserId, req.body || {});
    res.json({ ok: true, user_id: req.foodnoteUserId, restored: summary });
  } catch (e) {
    console.error('[FoodNote API] restore JSON erreur:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/normalize', (req, res) => {
  try {
    const result = req.query.user || req.get('x-foodnote-user')
      ? [normalizeStoredStateForUser(getUserId(req))]
      : normalizeStoredStateForAllUsers();
    res.json({ ok: true, result, entries: db.prepare('SELECT COUNT(*) AS n FROM entries').get().n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/debug/entries', requireUser, (req, res) => {
  const rows = db.prepare(`
    SELECT id, date, kcal, prot, gluc, lip, net_kcal, dep_sport, poids
    FROM entries
    WHERE user_id=?
    ORDER BY date DESC
    LIMIT 30
  `).all(req.foodnoteUserId);
  res.json({ user_id: req.foodnoteUserId, entries: rows });
});

// ── User/bootstrap ─────────────────────────────────────────
app.post('/api/bootstrap', (req, res) => {
  const requested = String(req.body?.user_id || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80);
  const userId = requested || `u_${crypto.randomBytes(8).toString('hex')}`;
  ensureUser(userId, req.body?.display_name || null);
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET token_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashToken(token), userId);
  res.json({ ok: true, user_id: userId, token });
});

app.get('/api/users/current', requireUser, (req, res) => {
  const user = db.prepare('SELECT id, display_name, created_at, updated_at FROM users WHERE id=?').get(req.foodnoteUserId);
  res.json({ user });
});

// ── Journal data: compatible ancien front ──────────────────
app.get('/api/data', requireUser, (req, res) => {
  try {
    const state = getState(req.foodnoteUserId, 'data', {}) || {};
    const light = req.query.light === '1' || req.query.light === 'true';
    // Démarrage ultra-léger : en mode light, /api/data ne doit pas relire 1000 journées
    // ni reconstruire les aliments récupérables. Les journées sont chargées par /api/entries?limit=60.
    const entriesPayload = light ? { entries: [] } : listEntriesForApi(req.foodnoteUserId, { limit: 1000 });
    const foodCount = db.prepare('SELECT COUNT(*) AS n FROM foods WHERE user_id=?').get(req.foodnoteUserId).n;
    const { bdd_aliments, journal_entries, entries, ...stateWithoutHeavyLists } = state;
    const payload = {
      ...(light ? stateWithoutHeavyLists : state),
      journal_entries: entriesPayload.entries,
      entries: entriesPayload.entries,
      _storage_mode: light ? 'sqlite-native-light' : 'sqlite-native-hydrated',
      _foods_deferred: !!light,
      _counts: {
        entries: light ? db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id=?').get(req.foodnoteUserId).n : entriesPayload.entries.length,
        foods: foodCount,
        recipes: light ? 0 : db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id=?').get(req.foodnoteUserId).n,
        recovered_foods_available: light ? null : recoveredFoodsFromEntries(req.foodnoteUserId, 1000).length
      }
    };
    if (!light) {
      const foodsRows = db.prepare('SELECT * FROM foods WHERE user_id=? ORDER BY favorite DESC, LOWER(name) ASC').all(req.foodnoteUserId);
      const nativeFoods = foodsRows.map(foodToApi);
      payload.bdd_aliments = nativeFoods.length ? nativeFoods : (Array.isArray(state.bdd_aliments) ? state.bdd_aliments : []);
    }
    res.json(payload);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/data', requireUser, (req, res) => {
  try {
    // Compatibilité ancien front : /api/data sert surtout à sauvegarder l'état global
    // (BDD aliments, réglages, cache local, etc.).
    // IMPORTANT : ne PAS renormaliser automatiquement toutes les entrées ici,
    // sinon chaque sauvegarde globale réécrit updated_at sur toutes les journées.
    // Pour forcer une migration JSON -> tables structurées : POST /api/admin/normalize
    // ou POST /api/data?normalize=1 si nécessaire.
    setState(req.foodnoteUserId, 'data', req.body || {});
    let normalized = null;
    if (req.query.normalize === '1' || req.query.normalize === 'true') {
      normalizeAllEntries(req.foodnoteUserId, req.body || {});
      normalized = true;
    }
    res.json({ ok: true, storage: 'sqlite', user_id: req.foodnoteUserId, normalized });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/data/structured', requireUser, (req, res) => {
  try {
    const entries = db.prepare(`
      SELECT * FROM entries WHERE user_id=? ORDER BY date DESC
    `).all(req.foodnoteUserId).map(e => {
      const aliments = db.prepare('SELECT name_snapshot AS nom, qty, unit AS unite, unit_weight AS poidsUnite, unit_label AS uniteLabel, kcal, prot, gluc, lip, meal FROM entry_foods WHERE entry_id=? ORDER BY id').all(e.id).map(serverCleanEntryFoodRow);
      const sports = db.prepare('SELECT name AS nom, hours AS heures, kcal_h AS kcalH, total FROM sports WHERE entry_id=? ORDER BY id').all(e.id);
      return {
        id: e.id,
        date: e.date,
        poids: e.poids,
        sports,
        depSport: e.dep_sport,
        aliments,
        extras: e.extras,
        energie: e.energie,
        faim: e.faim,
        notes: e.notes,
        question: e.question,
        macros: { kcal: e.kcal, prot: e.prot, gluc: e.gluc, lip: e.lip },
        netKcal: e.net_kcal
      };
    });
    res.json({ journal_entries: entries });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Profile/settings: routes historiques conservées, mais format SQLite complet ──
// IMPORTANT : ces routes sont déclarées avant les routes plus bas. Elles doivent donc
// déjà renvoyer le format moderne attendu par le frontend, sinon un nouveau téléphone
// retombe sur le profil local vide et les phases n'apparaissent pas.
function readPhasesForUser(userId) {
  try {
    const rows = db.prepare('SELECT raw_json FROM phases WHERE user_id=? ORDER BY order_index, id').all(userId);
    return rows.map(r => safeJsonParse(r.raw_json, null)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function writePhasesForUser(userId, phases) {
  if (!Array.isArray(phases)) return;
  db.prepare('DELETE FROM phases WHERE user_id=?').run(userId);
  const ins = db.prepare(`
    INSERT INTO phases (user_id, name, weeks, kcal_target, prot_target, gluc_target, lip_target, order_index, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const tx = db.transaction((items) => {
    items.forEach((ph, idx) => ins.run(
      userId,
      ph.label || ph.name || ph.id || ('Phase ' + (idx + 1)),
      Number(ph.weeks || 1),
      ph.kcalTarget ?? ph.cibleKcal ?? null,
      ph.protTarget ?? ph.cibleProt ?? null,
      ph.glucTarget ?? ph.cibleGluc ?? null,
      ph.lipTarget ?? ph.cibleLip ?? null,
      idx,
      JSON.stringify(ph)
    ));
  });
  tx(phases);
}

app.get('/api/profile', requireUser, (req, res) => {
  try {
    const payload = buildProfileResponseForUser(req.foodnoteUserId);
    res.json(payload);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/profile', requireUser, (req, res) => {
  try {
    const incoming = req.body && req.body.profile ? req.body.profile : req.body;
    if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error:'Profil invalide' });
    const phases = Array.isArray(incoming.phases) ? incoming.phases : normalizePhasesPayload(incoming);
    const profile = normalizeProfileTargets(incoming, phases);
    const displayName = profile.prenom || profile.name || null;
    ensureUser(req.foodnoteUserId, displayName);
    db.prepare(`
      INSERT INTO profiles (user_id, data_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP
    `).run(req.foodnoteUserId, JSON.stringify(profile, null, 2));
    const savedProfile = persistProfileWithTargets(req.foodnoteUserId, profile, 'profile_save').profile;
    if (displayName) db.prepare('UPDATE users SET display_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(displayName, req.foodnoteUserId);
    if (Array.isArray(savedProfile.phases) && savedProfile.phases.length) writePhasesForUser(req.foodnoteUserId, savedProfile.phases);
    syncActivePhaseTargetSnapshot(req.foodnoteUserId, savedProfile);
    const payload = buildProfileResponseForUser(req.foodnoteUserId);
    res.json({ ok:true, ...payload });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/admin/rebuild-profile', requireUser, (req, res) => {
  res.status(405).json({
    ok: false,
    error: 'Cette action doit être appelée en POST.',
    example: 'curl -X POST http://IP:PORT/api/admin/rebuild-profile'
  });
});

app.post('/api/admin/rebuild-profile', requireUser, (req, res) => {
  try {
    const payload = rebuildProfileFromFallbacks(req.foodnoteUserId);
    res.json({ ok:true, ...payload });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.get('/api/settings', requireUser, (req, res) => {
  const rows = db.prepare('SELECT key, value_json FROM settings WHERE user_id=?').all(req.foodnoteUserId);
  const obj = {};
  for (const r of rows) obj[r.key] = safeJsonParse(r.value_json, null);
  res.json(obj);
});

app.post('/api/settings/:key', requireUser, (req, res) => {
  db.prepare(`
    INSERT INTO settings (user_id, key, value_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP
  `).run(req.foodnoteUserId, req.params.key, JSON.stringify(req.body?.value ?? req.body ?? null));
  res.json({ ok: true });
});




// ── Poids par unité SQLite ─────────────────────────────────
app.get('/api/unit-weights', requireUser, (req, res) => {
  try {
    seedUnitWeights(req.foodnoteUserId);
    const rows = db.prepare('SELECT * FROM food_unit_weights WHERE user_id=? ORDER BY LOWER(label) ASC').all(req.foodnoteUserId);
    res.json({ user_id: req.foodnoteUserId, count: rows.length, unit_weights: rows.map(unitWeightToApi) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/unit-weights', requireUser, (req, res) => {
  try {
    const w = unitWeightPayloadToDb(req.body || {});
    if (!w) return res.status(400).json({ error: 'Libellé et poids en grammes requis' });
    if (w.id) {
      db.prepare(`
        INSERT INTO food_unit_weights (id, user_id, label, aliases_json, grams, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          label=excluded.label,
          aliases_json=excluded.aliases_json,
          grams=excluded.grams,
          source=excluded.source,
          updated_at=CURRENT_TIMESTAMP
      `).run(w.id, req.foodnoteUserId, w.label, JSON.stringify(w.aliases), w.grams, w.source);
    } else {
      const info = db.prepare(`
        INSERT INTO food_unit_weights (user_id, label, aliases_json, grams, source, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(req.foodnoteUserId, w.label, JSON.stringify(w.aliases), w.grams, w.source);
      w.id = info.lastInsertRowid;
    }
    const row = db.prepare('SELECT * FROM food_unit_weights WHERE user_id=? AND id=?').get(req.foodnoteUserId, w.id);
    res.json({ ok: true, unit_weight: unitWeightToApi(row) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/unit-weights/bulk', requireUser, (req, res) => {
  try {
    const rows = Array.isArray(req.body?.unit_weights) ? req.body.unit_weights : Array.isArray(req.body) ? req.body : [];
    const clean = rows.map(unitWeightPayloadToDb).filter(Boolean);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM food_unit_weights WHERE user_id=?').run(req.foodnoteUserId);
      const stmt = db.prepare('INSERT INTO food_unit_weights (user_id, label, aliases_json, grams, source, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
      for (const w of clean) stmt.run(req.foodnoteUserId, w.label, JSON.stringify(w.aliases), w.grams, w.source);
    });
    tx();
    const saved = db.prepare('SELECT * FROM food_unit_weights WHERE user_id=? ORDER BY LOWER(label) ASC').all(req.foodnoteUserId);
    res.json({ ok: true, count: saved.length, unit_weights: saved.map(unitWeightToApi) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/unit-weights/:id', requireUser, (req, res) => {
  try {
    const info = db.prepare('DELETE FROM food_unit_weights WHERE user_id=? AND id=?').run(req.foodnoteUserId, Number(req.params.id));
    res.json({ ok: true, deleted: info.changes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── OCR étiquette nutritionnelle ───────────────────────────
function parseFrNumber(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normalizeOCRLine(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // petites confusions OCR fréquentes sur les unités
    .replace(/kca[il1]/g, 'kcal')
    .replace(/kcai/g, 'kcal')
    .replace(/kj/g, 'kj')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberCandidatesFromLine(line) {
  const out = [];
  const re = /(\d+(?:[,.]\d+)?)\s*(kcal|cal|kj|kJ|g)?\s*(%)?/gi;
  for (const m of line.matchAll(re)) {
    const rawNumber = String(m[1] || '');
    const value = parseFrNumber(rawNumber);
    if (value == null) continue;
    const dec = (rawNumber.match(/[,.](\d+)/) || [null, ''])[1] || '';
    out.push({ value, rawNumber, decimals: dec.length, decimalPart: dec, unit: String(m[2] || '').toLowerCase(), percent: !!m[3], index: m.index || 0, raw: m[0] });
  }
  return out;
}

function cleanOcrMacroValue(candidateOrValue) {
  const c = (candidateOrValue && typeof candidateOrValue === 'object') ? candidateOrValue : { value: candidateOrValue };
  let v = Number(c.value);
  if (!Number.isFinite(v)) return null;
  // Les tableaux nutritionnels sont presque toujours à l'entier ou au dixième.
  // Si l'OCR sort 3,39, c'est souvent le g de grammes lu comme 9 : on tronque au dixième, on n'arrondit pas à 3,4.
  if (c.rawNumber && /[,.]\d{2,}/.test(String(c.rawNumber))) {
    const m = String(c.rawNumber).replace(',', '.').match(/(-?\d+)\.(\d)/);
    if (m) v = Number(m[1] + '.' + m[2]);
  }
  // Si malgré tout une valeur avec 2 décimales arrive ici, on tronque au dixième.
  v = Math.trunc(v * 10) / 10;
  return Number.isFinite(v) ? v : null;
}

function cleanOcrKcalValue(value) {
  const v = Number(value);
  return Number.isFinite(v) ? Math.round(v) : null;
}

function findEnergyKcal(lines) {
  for (const raw of lines) {
    const line = normalizeOCRLine(raw);
    if (!line || !/(energie|energy|energi|kcal|calories?)/.test(line)) continue;

    const candidates = numberCandidatesFromLine(line);
    // Règle critique : ne jamais prendre les % AJR/VNR/RI comme kcal.
    const kcalUnit = candidates.filter(c => !c.percent && /^(kcal|cal)$/.test(c.unit) && c.value > 0 && c.value < 1000);
    if (kcalUnit.length) return cleanOcrKcalValue(kcalUnit[0].value);

    // Si seulement kJ est lisible, conversion approximative vers kcal.
    const kjUnit = candidates.filter(c => !c.percent && c.unit === 'kj' && c.value > 50 && c.value < 5000);
    if (kjUnit.length) return cleanOcrKcalValue(kjUnit[0].value / 4.184);

    // Fallback : ignorer 100g, les pourcentages et les petits % AJR en fin de ligne.
    const vals = candidates
      .filter(c => !c.percent && c.value !== 100 && c.value >= 20 && c.value < 1000)
      .map(c => c.value);
    if (vals.length) {
      // Sur une ligne énergie typique sans unités nettes, l'énergie kcal est souvent après kJ.
      // Mais on évite de choisir un 11/12/15% AJR grâce au seuil >=20.
      return cleanOcrKcalValue(vals.length > 1 ? vals[vals.length - 1] : vals[0]);
    }
  }
  return null;
}

function findNutritionValue(lines, patterns, options = {}) {
  const unitWanted = options.unit || 'g';
  for (const raw of lines) {
    const line = normalizeOCRLine(raw);
    if (!line) continue;
    if (!patterns.some(p => p.test(line))) continue;

    const candidates = numberCandidatesFromLine(line)
      .filter(c => !c.percent) // ignore AJR/VNR/RI, ex: 11%
      .filter(c => c.value !== 100); // ignore l'en-tête pour 100g
    if (!candidates.length) continue;

    // Pour protéines/glucides/lipides/fibres, on privilégie la valeur suivie de g.
    const withUnit = candidates.find(c => c.unit === unitWanted && c.value >= 0 && c.value <= 100);
    if (withUnit) return cleanOcrMacroValue(withUnit);

    const plausible = candidates.find(c => c.value >= 0 && c.value <= 100);
    if (plausible) return cleanOcrMacroValue(plausible);
  }
  return null;
}


function execFileText(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve(String(stdout || ''));
    });
  });
}

async function commandExists(cmd) {
  try { await execFileText('which', [cmd], { timeout: 4000, maxBuffer: 64 * 1024 }); return true; }
  catch(e) { return false; }
}

async function ensureNativeTesseractInstalled() {
  const version = await execFileText('tesseract', ['--version'], { timeout: 8000, maxBuffer: 1024 * 1024 });
  return { ok: true, engine: 'native', version: (version.split('\n')[0] || 'tesseract') };
}

async function ensureTesseractJsModuleInstalled() {
  const resolved = require.resolve('tesseract.js');
  return { ok: true, engine: 'tesseract.js', path: resolved };
}

async function buildOCRImageVariants(imagePath, mode = 'balanced') {
  const variants = [{ name: 'original', path: imagePath, temporary: false }];
  const useConvert = await commandExists('convert');
  if (!useConvert) return variants;

  const dir = path.dirname(imagePath);
  const ext = '.png';
  const base = path.join(dir, path.basename(imagePath).replace(/\.[^.]+$/, ''));
  const effectiveMode = String(mode || 'balanced').toLowerCase();

  async function addVariant(name, args) {
    const out = `${base}_${name}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
    try {
      await execFileText('convert', [imagePath, ...args, out], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      if (fs.existsSync(out) && fs.statSync(out).size > 1000) variants.push({ name, path: out, temporary: true });
    } catch(e) {
      console.warn('[FoodNote] OCR preprocess failed', name, e.message || e);
    }
  }

  // Une variante nette et lisible suffit pour le mode rapide, on ajoute plus d'essais seulement en balanced_plus/quality.
  await addVariant('sharp_gray', ['-auto-orient', '-colorspace', 'Gray', '-resize', '1900x>', '-filter', 'Lanczos', '-unsharp', '0x1.0+1.2+0.02', '-normalize']);
  if (effectiveMode === 'balanced_plus' || effectiveMode === 'quality') {
    await addVariant('soft_bw', ['-auto-orient', '-colorspace', 'Gray', '-resize', '1900x>', '-normalize', '-threshold', '62%', '-morphology', 'Close', 'Rectangle:1x1']);
    await addVariant('contrast', ['-auto-orient', '-colorspace', 'Gray', '-resize', '2100x>', '-contrast-stretch', '1%x1%', '-sharpen', '0x1.0']);
  }
  if (effectiveMode === 'quality') {
    await addVariant('deskew', ['-auto-orient', '-colorspace', 'Gray', '-resize', '2200x>', '-deskew', '40%', '-normalize', '-unsharp', '0x1.0+1.1+0.02']);
  }
  return variants;
}

async function runOCROnSingleImage(imagePath, psm = '6') {
  // Moteur natif en priorité : plus stable dans ton Docker, et souvent plus rapide.
  try {
    const outBase = path.join(path.dirname(imagePath), `ocr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
    const args = [imagePath, outBase, '-l', 'fra+eng', '--psm', String(psm), '--oem', '1', '-c', 'preserve_interword_spaces=1'];
    await execFileText('tesseract', args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const txtFile = outBase + '.txt';
    const text = fs.existsSync(txtFile) ? fs.readFileSync(txtFile, 'utf8') : '';
    try { if (fs.existsSync(txtFile)) fs.unlinkSync(txtFile); } catch(e) {}
    return { engine: 'native-tesseract', text };
  } catch(nativeErr) {
    try {
      const tesseract = require('tesseract.js');
      const result = await tesseract.recognize(imagePath, 'fra+eng', {
        tessedit_pageseg_mode: String(psm)
      });
      return { engine: 'tesseract.js', text: result && result.data && result.data.text || '' };
    } catch(jsErr) {
      const err = new Error('OCR indisponible: ' + (nativeErr.stderr || nativeErr.message || nativeErr) + ' | ' + (jsErr.message || jsErr));
      err.ocrDetail = err.message;
      throw err;
    }
  }
}

function extractNutritionFromText(text) {
  const cleanText = String(text || '').replace(/\r/g, '\n');
  const lines = cleanText.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const flat = normalizeOCRLine(cleanText).replace(/[|:;]/g, ' ').replace(/\s+/g, ' ');

  let kcal = findEnergyKcal(lines);
  if (kcal == null) {
    const m = flat.match(/(?:energie|energy|kcal|calories?)\D{0,45}(\d+(?:[,.]\d+)?)\s*kcal/);
    if (m) kcal = cleanOcrKcalValue(parseFrNumber(m[1]));
  }

  const prot = findNutritionValue(lines, [/proteines?/, /protein/]);
  const gluc = findNutritionValue(lines, [/glucides?/, /carbohydrate/, /carbs?/]);
  const lip = findNutritionValue(lines, [/lipides?/, /matieres? grasses?/, /fat\b/]);
  const fibres = findNutritionValue(lines, [/fibres?/, /fiber/]);
  const sucres = findNutritionValue(lines, [/sucres?/, /sugars?/]);
  const sel = findNutritionValue(lines, [/\bsel\b/, /salt/]);

  const confidenceFields = [kcal, prot, gluc, lip].filter(v => v != null).length;
  return {
    per: '100g',
    kcal100: cleanOcrKcalValue(kcal),
    prot100: cleanOcrMacroValue(prot),
    gluc100: cleanOcrMacroValue(gluc),
    lip100: cleanOcrMacroValue(lip),
    fibres100: cleanOcrMacroValue(fibres),
    sucres100: cleanOcrMacroValue(sucres),
    sel100: cleanOcrMacroValue(sel),
    confidence: confidenceFields >= 4 ? 'bonne' : confidenceFields >= 2 ? 'moyenne' : 'faible',
    fields_found: confidenceFields,
    text: cleanText.slice(0, 5000)
  };
}


function scoreNutritionParse(parsed, text) {
  let score = 0;
  if (parsed.kcal100 != null && parsed.kcal100 > 0 && parsed.kcal100 < 1000) score += 3;
  if (parsed.prot100 != null && parsed.prot100 >= 0 && parsed.prot100 <= 100) score += 2;
  if (parsed.gluc100 != null && parsed.gluc100 >= 0 && parsed.gluc100 <= 100) score += 2;
  if (parsed.lip100 != null && parsed.lip100 >= 0 && parsed.lip100 <= 100) score += 2;
  if (parsed.fibres100 != null && parsed.fibres100 >= 0 && parsed.fibres100 <= 100) score += 1;
  if (parsed.sucres100 != null && parsed.sucres100 >= 0 && parsed.sucres100 <= 100) score += 0.5;
  const t = String(text || '').toLowerCase();
  if (/nutrition|energie|energy|glucide|protein|proteine|lipide|gras|fat/.test(t)) score += 1;
  return score;
}


function mergeNutritionAttempts(attempts) {
  if (!Array.isArray(attempts) || !attempts.length) return null;
  const keys = ['kcal100','prot100','gluc100','lip100','fibres100','sucres100','sel100'];
  const merged = { per: '100g', confidence: 'faible', fields_found: 0 };
  const fieldRanges = {
    kcal100: [1, 999], prot100: [0, 100], gluc100: [0, 100], lip100: [0, 100], fibres100: [0, 100], sucres100: [0, 100], sel100: [0, 20]
  };
  for (const key of keys) {
    const [min, max] = fieldRanges[key] || [-Infinity, Infinity];
    const buckets = [];
    for (const a of attempts) {
      const p = a && a.parsed || {};
      const val = Number(p[key]);
      if (!Number.isFinite(val) || val < min || val > max) continue;
      // Regroupe les valeurs quasi identiques. Macros au dixième, kcal à l'unité.
      const rounded = key === 'kcal100' ? Math.round(val) : cleanOcrMacroValue(val);
      let b = buckets.find(x => Math.abs(x.value - rounded) <= (key === 'kcal100' ? 2 : 0.25));
      if (!b) { b = { value: rounded, weight: 0, count: 0 }; buckets.push(b); }
      b.count += 1;
      b.weight += 1 + Math.max(0, Number(a.score) || 0) / 10;
      if (key === 'kcal100') {
        // Évite de valider un % AJR pris pour des kcal (ex: 11%) quand une vraie valeur comme 157 existe.
        const txt = String(a.text || '').toLowerCase();
        const valueNearKcal = new RegExp('\\b' + Math.round(rounded) + '\\s*kcal\\b').test(txt.replace(/,/g,'.'));
        if (rounded < 30 && /%|ajr|vnr|ri|reference/.test(txt)) b.weight -= 2.5;
        if (valueNearKcal) b.weight += 3;
      }
    }
    buckets.sort((a,b) => b.weight - a.weight || b.count - a.count);
    if (buckets[0]) merged[key] = buckets[0].value;
  }
  const fields = ['kcal100','prot100','gluc100','lip100'].filter(k => merged[k] != null).length;
  merged.fields_found = fields;
  merged.confidence = fields >= 4 ? 'bonne' : fields >= 2 ? 'moyenne' : 'faible';
  return merged;
}

function combinedNutritionScore(parsed, text, attempts) {
  let score = scoreNutritionParse(parsed, text);
  if (Array.isArray(attempts)) {
    const fields = ['kcal100','prot100','gluc100','lip100','fibres100'].filter(k => parsed && parsed[k] != null).length;
    score += fields;
    // Bonus si plusieurs tentatives confirment une même extraction.
    score += Math.min(3, attempts.length * 0.5);
  }
  return score;
}

async function runNutritionOCR(imagePath, mode = 'balanced') {
  const envMode = process.env.FOODNOTE_OCR_QUALITY || '';
  const qualityMode = mode === 'quality' || envMode === 'quality';
  const balancedPlusMode = !qualityMode && (mode === 'balanced_plus' || envMode === 'balanced_plus');
  const balancedMode = !qualityMode && !balancedPlusMode && (mode === 'balanced' || envMode === 'balanced' || !mode);
  const effectiveMode = qualityMode ? 'quality' : (balancedPlusMode ? 'balanced_plus' : (balancedMode ? 'balanced' : 'fast'));
  const variants = await buildOCRImageVariants(imagePath, effectiveMode);
  const attempts = [];
  const errors = [];
  const psmList = qualityMode ? ['6', '4', '11'] : (balancedPlusMode ? ['6', '4'] : ['6']);
  try {
    for (const variant of variants) {
      for (const psm of psmList) {
        try {
          const ocr = await runOCROnSingleImage(variant.path, psm);
          const text = ocr.text || '';
          const parsed = extractNutritionFromText(text);
          const score = scoreNutritionParse(parsed, text);
          const attempt = {
            engine: ocr.engine,
            preprocessing: variant.name,
            text,
            parsed,
            score,
            mode: effectiveMode
          };
          attempts.push(attempt);
          // En mode rapide, si on a déjà les 4 champs principaux, on arrête tout de suite.
          if (!qualityMode && !balancedMode && parsed && parsed.fields_found >= 4 && score >= 8) return attempt;
        } catch(e) {
          errors.push(`${variant.name}/psm${psm}: ` + (e.ocrDetail || e.stderr || e.message || String(e)).slice(0, 500));
        }
      }
      // En mode rapide pur, on ne boucle pas. En mode équilibré, on teste 2 variantes max.
      if (!qualityMode && !balancedMode && attempts.length) break;
    }
    attempts.sort((a, b) => b.score - a.score || (b.text || '').length - (a.text || '').length);
    const best = attempts[0];
    if (best && (balancedPlusMode || qualityMode) && attempts.length > 1) {
      const mergedParsed = mergeNutritionAttempts(attempts) || best.parsed;
      const combinedText = attempts.map(a => `--- ${a.preprocessing}/${a.engine} ---\n${a.text || ''}`).join('\n');
      return {
        ...best,
        parsed: mergedParsed,
        text: combinedText,
        score: combinedNutritionScore(mergedParsed, combinedText, attempts),
        preprocessing: 'fusion-' + attempts.map(a => a.preprocessing).join('+').slice(0, 120),
        engine: 'multi-pass'
      };
    }
    if (best) return best;

    const detail = errors.join(' | ');
    const err = new Error('OCR indisponible. Détail: ' + detail);
    err.ocrDetail = detail;
    throw err;
  } finally {
    for (const v of variants) {
      if (v.temporary) {
        try { if (fs.existsSync(v.path)) fs.unlinkSync(v.path); } catch(e) {}
      }
    }
  }
}

app.get('/api/ocr/status', requireUser, async (req, res) => {
  const out = {
    ok: true,
    cwd: process.cwd(),
    app_dir: __dirname,
    node_env: process.env.NODE_ENV || '',
    native_tesseract: false,
    tesseractjs_module: false,
    package_has_tesseractjs: false,
    ocr_default_mode: process.env.FOODNOTE_OCR_QUALITY || 'balanced',
    node_modules_tesseractjs: false,
    path: process.env.PATH || '',
    errors: []
  };
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      out.package_has_tesseractjs = !!(pkg.dependencies && pkg.dependencies['tesseract.js']);
      out.package_tesseractjs = pkg.dependencies && pkg.dependencies['tesseract.js'] || null;
    }
  } catch(e) { out.errors.push('package.json: ' + (e.message || String(e))); }
  try {
    out.node_modules_tesseractjs = fs.existsSync(path.join(__dirname, 'node_modules', 'tesseract.js'));
  } catch(e) {}
  try {
    const v = await execFileText('tesseract', ['--version'], { timeout: 8000, maxBuffer: 1024 * 1024 });
    out.native_tesseract = true;
    out.native_version = v.split('\n')[0] || 'tesseract';
  } catch(e) {
    out.errors.push('native: ' + (e.message || String(e)));
  }
  try {
    out.tesseractjs_path = require.resolve('tesseract.js');
    out.tesseractjs_module = true;
  } catch(e) {
    out.errors.push('tesseract.js: module absent');
  }
  res.json(out);
});

app.post('/api/ocr/install', requireUser, async (req, res) => {
  const result = { native:null, tesseractjs:null };
  try { result.native = await ensureNativeTesseractInstalled(); } catch(e) { result.native = { ok:false, error: e.stderr || e.message || String(e) }; }
  try { result.tesseractjs = await ensureTesseractJsModuleInstalled(); } catch(e) { result.tesseractjs = { ok:false, error: e.stderr || e.message || String(e) }; }
  const ok = !!((result.native && result.native.ok) || (result.tesseractjs && result.tesseractjs.ok));
  res.status(ok ? 200 : 500).json({ ok, result });
});

app.get('/api/ocr/install', requireUser, async (req, res) => {
  const result = { native:null, tesseractjs:null };
  try { result.native = await ensureNativeTesseractInstalled(); } catch(e) { result.native = { ok:false, error: e.stderr || e.message || String(e) }; }
  try { result.tesseractjs = await ensureTesseractJsModuleInstalled(); } catch(e) { result.tesseractjs = { ok:false, error: e.stderr || e.message || String(e) }; }
  const ok = !!((result.native && result.native.ok) || (result.tesseractjs && result.tesseractjs.ok));
  res.status(ok ? 200 : 500).json({ ok, result });
});

app.post('/api/ocr/nutrition-label', requireUser, async (req, res) => {
  const started = Date.now();
  let tmpFile = null;
  try {
    const image = req.body && req.body.image;
    if (!image || typeof image !== 'string') return res.status(400).json({ ok:false, error:'Image manquante' });
    const m = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!m) return res.status(400).json({ ok:false, error:'Format image non supporté' });
    const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 18 * 1024 * 1024) return res.status(400).json({ ok:false, error:'Image trop lourde' });
    const ocrDir = path.join(DATA_DIR, 'ocr');
    ensureDir(ocrDir);
    tmpFile = path.join(ocrDir, `nutrition_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`);
    fs.writeFileSync(tmpFile, buf);

    const requestedRawMode = String(req.body && req.body.mode || 'balanced').toLowerCase().trim();
    const requestedMode = ['fast', 'balanced', 'balanced_plus', 'quality'].includes(requestedRawMode) ? requestedRawMode : 'balanced';
    const kind = String(req.body && req.body.kind || '').toLowerCase().trim();
    // 0.22.135 : les recettes n'ont pas besoin du mode quality multi-passes.
    // Sur mobile, ce mode peut rester très longtemps sur "OCR en cours".
    const effectiveMode = kind === 'recipe_ingredients' ? (requestedMode === 'fast' ? 'fast' : 'balanced') : requestedMode;
    const ocr = await runNutritionOCR(tmpFile, effectiveMode);
    const text = ocr.text || '';
    const parsed = extractNutritionFromText(text);
    res.json({ ok:true, kind, mode: ocr.mode || effectiveMode || requestedMode || 'balanced', requested_mode: requestedMode, engine: ocr.engine, preprocessing: ocr.preprocessing || 'none', ocr_score: ocr.score || 0, duration_ms: Date.now() - started, parsed, raw_text: text.slice(0, 5000) });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message || String(e) });
  } finally {
    try { if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch(e) {}
  }
});

// ── Foods personnelle SQLite ───────────────────────────────
app.get('/api/foods', requireUser, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM foods
      WHERE user_id=?
      ORDER BY favorite DESC, LOWER(name) ASC
    `).all(req.foodnoteUserId);
    let foods = rows.map(foodToApi);
    let recovered_preview = [];
    if (!foods.length || req.query.include_recovered === '1') {
      recovered_preview = recoveredFoodsFromEntries(req.foodnoteUserId, 1000).map(foodToApi);
      if (!foods.length) foods = recovered_preview;
    }
    res.json({
      user_id: req.foodnoteUserId,
      count: foods.length,
      sqlite_foods_count: rows.length,
      recovered_preview_count: recovered_preview.length,
      recovered_preview_used: rows.length === 0 && recovered_preview.length > 0,
      foods
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/foods', requireUser, (req, res) => {
  try {
    const f = foodPayloadToDb(req.body || {});
    if (!f) return res.status(400).json({ error: 'Nom aliment requis' });
    let info;
    if (Number.isFinite(f.id)) {
      info = db.prepare(`
        INSERT INTO foods (id, user_id, name, kcal100, prot100, gluc100, lip100, unit, unit_weight, unit_label, source, favorite, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,
          kcal100=excluded.kcal100,
          prot100=excluded.prot100,
          gluc100=excluded.gluc100,
          lip100=excluded.lip100,
          unit=excluded.unit,
          unit_weight=excluded.unit_weight,
          unit_label=excluded.unit_label,
          source=excluded.source,
          favorite=excluded.favorite,
          updated_at=CURRENT_TIMESTAMP
      `).run(f.id, req.foodnoteUserId, f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite);
    } else {
      info = db.prepare(`
        INSERT INTO foods (user_id, name, kcal100, prot100, gluc100, lip100, unit, unit_weight, unit_label, source, favorite, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(req.foodnoteUserId, f.name, f.kcal100, f.prot100, f.gluc100, f.lip100, f.unit, f.unit_weight, f.unit_label, f.source, f.favorite);
      f.id = info.lastInsertRowid;
    }
    try { clearFoodDeletionTombstone(req.foodnoteUserId, f.name); } catch (_) {}
    const row = db.prepare('SELECT * FROM foods WHERE user_id=? AND id=?').get(req.foodnoteUserId, f.id);
    res.json({ ok: true, food: foodToApi(row) });
  } catch(e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post('/api/foods/bulk', requireUser, (req, res) => {
  try {
    const body = req.body || {};
    // Par défaut on fusionne pour éviter qu'un cache client incomplet efface la base SQLite.
    // Le remplacement complet reste disponible uniquement pour les imports/restaurations explicites.
    const replace = body.replace === true || body.mode === 'replace';
    const result = replace
      ? { mode: 'replace', count: replaceFoodsForUser(req.foodnoteUserId, body) }
      : { mode: 'merge', ...mergeFoodsForUser(req.foodnoteUserId, body) };
    const rows = db.prepare('SELECT * FROM foods WHERE user_id=? ORDER BY favorite DESC, LOWER(name) ASC').all(req.foodnoteUserId);
    res.json({ ok: true, user_id: req.foodnoteUserId, ...result, count: rows.length, foods: rows.map(foodToApi) });
  } catch(e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post('/api/foods/delete', requireUser, (req, res) => {
  try {
    const name = String(req.body?.name || req.body?.nom || '').trim();
    const key = foodNameKeyForDb(name);
    if (!key) return res.status(400).json({ error: 'Nom aliment requis' });
    const info = db.prepare('DELETE FROM foods WHERE user_id=? AND LOWER(TRIM(name))=?').run(req.foodnoteUserId, key);
    addFoodDeletionTombstone(req.foodnoteUserId, name);
    res.json({ ok: true, deleted: info.changes || 0, tombstone: true, name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/foods/:id', requireUser, (req, res) => {
  try {
    const id = Number(req.params.id);
    let row = null;
    if (Number.isFinite(id) && id > 0) {
      row = db.prepare('SELECT name FROM foods WHERE user_id=? AND id=?').get(req.foodnoteUserId, id);
    }
    let info = Number.isFinite(id) && id > 0
      ? db.prepare('DELETE FROM foods WHERE user_id=? AND id=?').run(req.foodnoteUserId, id)
      : { changes: 0 };
    const fallbackName = String(req.query?.name || req.query?.nom || '').trim();
    // Si le client avait un ancien id local, on supprime quand même par nom.
    // Sinon une fiche "sans donnée" peut revenir au rechargement malgré le clic Supprimer.
    if ((!info.changes || info.changes <= 0) && fallbackName) {
      const key = foodNameKeyForDb(fallbackName);
      if (key) info = db.prepare('DELETE FROM foods WHERE user_id=? AND LOWER(TRIM(name))=?').run(req.foodnoteUserId, key);
    }
    const tombstoneName = row?.name || fallbackName;
    if (tombstoneName) addFoodDeletionTombstone(req.foodnoteUserId, tombstoneName);
    res.json({ ok: true, deleted: info.changes || 0, tombstone: !!tombstoneName });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/admin/rebuild-foods-from-entries', requireUser, (req, res) => {
  try {
    const result = rebuildFoodsFromEntries(req.foodnoteUserId);
    const rows = db.prepare('SELECT * FROM foods WHERE user_id=? ORDER BY favorite DESC, LOWER(name) ASC').all(req.foodnoteUserId);
    res.json({ ok: true, ...result, count: rows.length, foods: rows.map(foodToApi) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/normalize-foods', requireUser, (req, res) => {
  try {
    const result = migrateFoodsFromState(req.foodnoteUserId);
    res.json({ ok: true, result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


const DEFAULT_UNIT_WEIGHTS = [
  { label: 'œuf', grams: 60, aliases: ['oeuf', 'œuf', 'oeufs', 'œufs', 'oeuf entier', 'œuf entier'], source: 'default' },
  { label: 'banane', grams: 120, aliases: ['banane', 'banana'], source: 'default' },
  { label: 'pomme', grams: 150, aliases: ['pomme'], source: 'default' },
  { label: 'poire', grams: 160, aliases: ['poire'], source: 'default' },
  { label: 'orange', grams: 150, aliases: ['orange'], source: 'default' },
  { label: 'clémentine', grams: 70, aliases: ['clementine', 'clémentine', 'mandarine'], source: 'default' },
  { label: 'kiwi', grams: 75, aliases: ['kiwi'], source: 'default' },
  { label: 'pêche / nectarine', grams: 150, aliases: ['peche', 'pêche', 'nectarine'], source: 'default' },
  { label: 'abricot', grams: 45, aliases: ['abricot'], source: 'default' },
  { label: 'avocat', grams: 150, aliases: ['avocat'], source: 'default' },
  { label: 'tomate', grams: 120, aliases: ['tomate'], source: 'default' },
  { label: 'yaourt / pot', grams: 125, aliases: ['yaourt', 'pot de yaourt', 'fromage blanc individuel', 'skyr individuel'], source: 'default' }
];

function normalizeAliasesJson(value, fallbackLabel = '') {
  let arr = [];
  if (Array.isArray(value)) arr = value;
  else if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) arr = parsed; }
    catch (_) { arr = value.split(','); }
  }
  if (fallbackLabel) arr.unshift(fallbackLabel);
  return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))].slice(0, 30);
}

function seedUnitWeights(userId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM food_unit_weights WHERE user_id=?').get(userId)?.c || 0;
  if (count > 0) return;
  const stmt = db.prepare(`
    INSERT INTO food_unit_weights (user_id, label, aliases_json, grams, source, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const tx = db.transaction(() => {
    for (const r of DEFAULT_UNIT_WEIGHTS) stmt.run(userId, r.label, JSON.stringify(r.aliases || [r.label]), Number(r.grams), r.source || 'default');
  });
  tx();
}

function unitWeightToApi(row) {
  return {
    id: row.id,
    label: row.label,
    grams: Number(row.grams || 0),
    aliases: normalizeAliasesJson(row.aliases_json, row.label),
    source: row.source || 'user',
    updated_at: row.updated_at
  };
}

function unitWeightPayloadToDb(body) {
  const label = String(body?.label || body?.uniteLabel || '').trim();
  const grams = Number(body?.grams ?? body?.poidsUnite ?? body?.unit_weight);
  if (!label || !Number.isFinite(grams) || grams <= 0) return null;
  return {
    id: Number.isFinite(Number(body?.id)) ? Number(body.id) : null,
    label: label.slice(0, 80),
    grams,
    aliases: normalizeAliasesJson(body?.aliases, label),
    source: String(body?.source || 'user').slice(0, 30)
  };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function foodnoteEntryRawFoods(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const candidates = [raw.aliments, raw.foods, raw.food_items, raw.entry_foods];
  const arr = candidates.find(v => Array.isArray(v));
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

function foodnoteEntryRawSports(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const candidates = [raw.sports, raw.activites, raw.activities];
  const arr = candidates.find(v => Array.isArray(v));
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

function foodnoteRawNum(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(String(value).replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function foodnoteRawFoodTotal(food, totalKeys, per100Keys, qty) {
  for (const k of totalKeys) {
    const n = foodnoteRawNum(food?.[k]);
    if (n > 0) return n;
  }
  const grams = Math.abs(Number(qty || 0)) || 0;
  if (grams > 0) {
    for (const k of per100Keys) {
      const n = foodnoteRawNum(food?.[k]);
      if (n > 0) return n * grams / 100;
    }
  }
  return 0;
}

function foodnoteRawFoodToApi(food, index = 0) {
  if (!food || typeof food !== 'object') return null;
  const name = String(food.nom || food.name || food.label || food.name_snapshot || '').trim();
  if (!name) return null;
  const qty = Math.abs(foodnoteRawNum(food.qty, food.quantite, food.quantity, food.grams, food.poids, food.weight)) || 0;
  const line = {
    id: null,
    entryFoodId: food.entryFoodId || food.entry_food_id || null,
    entry_food_id: food.entry_food_id || food.entryFoodId || null,
    line_uid: food.line_uid || food.lineUid || ('legacy-raw-' + (index + 1)),
    nom: name,
    name,
    qty: qty || 1,
    unit: food.unit || food.unite || 'g',
    unite: food.unite || food.unit || 'g',
    unit_weight: food.unit_weight ?? food.poidsUnite ?? null,
    poidsUnite: food.poidsUnite ?? food.unit_weight ?? null,
    unit_label: food.unit_label || food.uniteLabel || '',
    uniteLabel: food.uniteLabel || food.unit_label || '',
    kcal: foodnoteRawFoodTotal(food, ['kcal', 'calories', 'energy'], ['kcal100', 'kcalPer100', 'calories100'], qty),
    prot: foodnoteRawFoodTotal(food, ['prot', 'protein', 'proteines'], ['prot100', 'protPer100', 'protein100'], qty),
    gluc: foodnoteRawFoodTotal(food, ['gluc', 'carbs', 'glucides'], ['gluc100', 'glucPer100', 'carbs100'], qty),
    lip: foodnoteRawFoodTotal(food, ['lip', 'fat', 'lipides'], ['lip100', 'lipPer100', 'fat100'], qty),
    meal: food.meal || food.repas || food.mealId || 'lunch',
    source: food.source || 'legacy_raw_json',
    _legacyRawJson: true
  };
  return serverCleanEntryFoodRow(line);
}

function foodnoteRawSportToApi(sport, index = 0) {
  if (!sport || typeof sport !== 'object') return null;
  const name = String(sport.nom || sport.name || sport.label || '').trim();
  if (!name) return null;
  const heures = foodnoteRawNum(sport.heures, sport.hours, sport.duree, sport.duration);
  const kcalH = foodnoteRawNum(sport.kcalH, sport.kcal_h, sport.kcal_horaire);
  const total = foodnoteRawNum(sport.total, heures * kcalH);
  return {
    id: sport.id || null,
    nom: name,
    heures,
    kcalH,
    total,
    _legacyRawJson: true
  };
}

function entryToApi(e, includeDetails = true) {
  const raw = normalizeLegacyRawEntryObject(safeJsonParse(e.raw_json || '{}', {}) || {});
  const rawFoods = foodnoteEntryRawFoods(raw);
  const rawSports = foodnoteEntryRawSports(raw);
  const dbFoodCount = Number(e.food_count ?? e.foodCount ?? db.prepare('SELECT COUNT(*) AS n FROM entry_foods WHERE entry_id=?').get(e.id).n ?? 0) || 0;
  const dbSportCount = Number(e.sport_count ?? e.sportCount ?? db.prepare('SELECT COUNT(*) AS n FROM sports WHERE entry_id=?').get(e.id).n ?? 0) || 0;
  const foodCount = dbFoodCount || rawFoods.length;
  const sportCount = dbSportCount || rawSports.length;
  const base = {
    id: e.id,
    date: e.date,
    poids: e.poids,
    energie: e.energie,
    faim: e.faim,
    notes: e.notes,
    extras: e.extras,
    question: e.question,
    depSport: e.dep_sport,
    netKcal: e.net_kcal,
    macros: { kcal: e.kcal, prot: e.prot, gluc: e.gluc, lip: e.lip },
    created_at: e.created_at,
    updated_at: e.updated_at,
    revision: Number(e.revision || 0),
    _revision: Number(e.revision || 0),
    write_id: e.write_id || null,
    client_id: e.client_id || null,
    foodCount,
    food_count: foodCount,
    sportCount,
    sport_count: sportCount,
    _detailsLoaded: includeDetails === true,
    _summaryOnly: includeDetails !== true,
    dailyChecklist: raw.dailyChecklist || raw.daily_checklist || {},
    dailyReview: raw.dailyReview || raw.daily_review || {},
  };
  if (!includeDetails) return base;

  const dbFoods = db.prepare(`
    SELECT id, line_uid, name_snapshot AS nom, qty, unit AS unite, unit_weight AS poidsUnite, unit_label AS uniteLabel, kcal, prot, gluc, lip, meal
    FROM entry_foods
    WHERE entry_id=?
    ORDER BY id
  `).all(e.id).map(serverCleanEntryFoodRow);
  const dbSports = db.prepare(`
    SELECT id, name AS nom, hours AS heures, kcal_h AS kcalH, total
    FROM sports
    WHERE entry_id=?
    ORDER BY id
  `).all(e.id);

  // 0.22.47 — compat historique ancien moteur : certaines journées avant la migration
  // ont leurs aliments uniquement dans entries.raw_json. SQLite reste la source de vérité,
  // mais la table normalisée entry_foods peut être vide. Dans ce cas on relit le détail
  // depuis raw_json au lieu d'afficher faussement une journée vide.
  base.aliments = dbFoods.length ? dbFoods : rawFoods.map(foodnoteRawFoodToApi).filter(Boolean);
  base.sports = dbSports.length ? dbSports : rawSports.map(foodnoteRawSportToApi).filter(Boolean);
  base.foodCount = base.food_count = base.aliments.length;
  base.sportCount = base.sport_count = base.sports.length;
  base._legacyRawJsonFoodsUsed = !dbFoods.length && base.aliments.length > 0;
  base._legacyRawJsonSportsUsed = !dbSports.length && base.sports.length > 0;
  base._detailsLoaded = true;
  base._summaryOnly = false;
  return base;
}


function normalizeLegacyRawEntryObject(raw) {
  // Compat robuste : certaines sauvegardes anciennes peuvent contenir raw_json
  // sous forme d'objet, de chaîne JSON, ou de chaîne JSON doublement encodée.
  let value = raw;
  for (let i = 0; i < 2; i++) {
    if (typeof value !== 'string') break;
    const parsed = safeJsonParse(value, null);
    if (!parsed) break;
    value = parsed;
  }
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
}

function normalizeMealForApi(meal) {
  const m = String(meal || 'lunch').trim();
  return (m === 'breakfast' || m === 'lunch' || m === 'dinner') ? m : 'lunch';
}

function backfillLegacyEntryFoodsFromRawJson(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 1000), 1), 10000);
  const userId = options.userId ? String(options.userId) : null;
  const whereUser = userId ? 'AND e.user_id=?' : '';
  const params = userId ? [userId, limit] : [limit];
  const candidates = db.prepare(`
    SELECT e.id, e.user_id, e.date, e.raw_json
    FROM entries e
    LEFT JOIN entry_foods ef ON ef.entry_id = e.id
    WHERE e.raw_json IS NOT NULL
      AND TRIM(e.raw_json) != ''
      ${whereUser}
    GROUP BY e.id
    HAVING COUNT(ef.id) = 0
    ORDER BY e.date ASC, e.id ASC
    LIMIT ?
  `).all(...params);

  const cols = getSqliteColumnSet('entry_foods');
  const insertCols = ['entry_id', 'name_snapshot', 'qty', 'unit', 'kcal', 'prot', 'gluc', 'lip', 'meal'];
  if (cols.has('unit_weight')) insertCols.push('unit_weight');
  if (cols.has('unit_label')) insertCols.push('unit_label');
  if (cols.has('line_uid')) insertCols.push('line_uid');
  const ins = db.prepare(`INSERT INTO entry_foods (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`);

  let entriesChecked = 0;
  let entriesBackfilled = 0;
  let foodsInserted = 0;
  const examples = [];

  const tx = db.transaction(() => {
    for (const e of candidates) {
      entriesChecked++;
      const raw = normalizeLegacyRawEntryObject(safeJsonParse(e.raw_json || '{}', {}));
      const rawFoods = foodnoteEntryRawFoods(raw);
      if (!rawFoods.length) continue;
      let insertedForEntry = 0;
      rawFoods.forEach((food, idx) => {
        const api = foodnoteRawFoodToApi(food, idx);
        if (!api || !api.nom) return;
        const meal = normalizeMealForApi(api.meal || api.repas || 'lunch');
        const lineUid = String(api.line_uid || api.lineUid || `legacy-${e.date}-${idx + 1}`).slice(0, 80);
        const valuesByCol = {
          entry_id: e.id,
          name_snapshot: String(api.nom || api.name || '').slice(0, 220),
          qty: Number(api.qty || 0) || 0,
          unit: String(api.unite || api.unit || 'g').slice(0, 40),
          kcal: Number(api.kcal || 0) || 0,
          prot: Number(api.prot || 0) || 0,
          gluc: Number(api.gluc || 0) || 0,
          lip: Number(api.lip || 0) || 0,
          meal,
          unit_weight: api.poidsUnite ?? api.unit_weight ?? null,
          unit_label: String(api.uniteLabel || api.unit_label || '').slice(0, 80),
          line_uid: lineUid
        };
        ins.run(...insertCols.map(c => valuesByCol[c]));
        insertedForEntry++;
        foodsInserted++;
      });
      if (insertedForEntry) {
        entriesBackfilled++;
        if (examples.length < 8) examples.push({ date: e.date, entry_id: e.id, foods: insertedForEntry });
      }
    }
  });
  tx();
  return { ok: true, entriesChecked, entriesBackfilled, foodsInserted, examples };
}

function scheduleLegacyRawJsonBackfill() {
  if (String(process.env.FOODNOTE_DISABLE_LEGACY_BACKFILL || '') === '1') return;
  setTimeout(() => {
    try {
      const result = backfillLegacyEntryFoodsFromRawJson({ limit: 10000 });
      if (result.foodsInserted) console.log('[FoodNote migration] entry_foods restaurés depuis raw_json:', result);
    } catch (e) {
      console.warn('[FoodNote migration] backfill raw_json -> entry_foods ignoré:', e.message);
    }
  }, 1200);
}

scheduleLegacyRawJsonBackfill();

function buildEntryPayloadFromBody(body) {
  const macros = body.macros || {};
  return {
    id: body.id,
    date: body.date,
    poids: body.poids,
    energie: body.energie,
    faim: body.faim,
    notes: body.notes,
    extras: body.extras,
    question: body.question,
    depSport: body.depSport ?? body.dep_sport ?? 0,
    netKcal: body.netKcal ?? body.net_kcal ?? 0,
    macros: {
      kcal: macros.kcal ?? body.kcal ?? 0,
      prot: macros.prot ?? body.prot ?? 0,
      gluc: macros.gluc ?? body.gluc ?? 0,
      lip: macros.lip ?? body.lip ?? 0,
    },
    aliments: Array.isArray(body.aliments) ? body.aliments : [],
    sports: Array.isArray(body.sports) ? body.sports.map(s => ({
      ...s,
      heures: Number(s.heures ?? s.hours ?? s.duree ?? s.duration ?? 0) || 0,
      kcalH: Number(s.kcalH ?? s.kcal_h ?? s.kcal_horaire ?? 0) || 0,
      total: Math.round(Number(s.total ?? ((Number(s.heures ?? s.hours ?? s.duree ?? s.duration ?? 0) || 0) * (Number(s.kcalH ?? s.kcal_h ?? s.kcal_horaire ?? 0) || 0))) || 0)
    })) : [],
    // 0.22.75 — Les intentions explicites doivent survivre à la normalisation serveur.
    // Sans ça, une sauvegarde sport vide était interprétée comme "préserver l'ancien sport",
    // donc une suppression ou un remplacement depuis la page Sport pouvait sembler enregistrée
    // côté UI puis réapparaître après recharge.
    __replaceSports: body.__replaceSports === true || body.replaceSports === true || body._replaceSports === true,
    __replaceFoods: body.__replaceFoods === true || body.replaceFoods === true || body._replaceFoods === true,
    __allowSummaryOverwrite: body.__allowSummaryOverwrite === true || body.allowSummaryOverwrite === true,
    __allowEmptyDayReplace: body.__allowEmptyDayReplace === true || body.allowEmptyDayReplace === true,
    _detailsLoaded: body._detailsLoaded,
    dailyChecklist: (body.dailyChecklist && typeof body.dailyChecklist === 'object') ? body.dailyChecklist : (body.daily_checklist || {}),
    dailyReview: (body.dailyReview && typeof body.dailyReview === 'object') ? body.dailyReview : (body.daily_review || {}),
  };
}


function getEntrySafetySummary(entryLike) {
  const foods = Array.isArray(entryLike?.aliments) ? entryLike.aliments : [];
  const sports = Array.isArray(entryLike?.sports) ? entryLike.sports : [];
  const macros = entryLike?.macros || {};
  const kcal = Number(macros.kcal ?? entryLike?.kcal ?? 0) || 0;
  const depSport = Number(entryLike?.depSport ?? entryLike?.dep_sport ?? 0) || 0;
  const foodCount = foods.length;
  const sportCount = sports.length;
  return {
    foodCount,
    sportCount,
    itemCount: foodCount + sportCount,
    kcal,
    depSport,
  };
}

function getStoredEntrySafetySummary(userId, date) {
  const row = db.prepare('SELECT * FROM entries WHERE user_id=? AND date=?').get(userId, String(date));
  if (!row) return null;
  const dbFoodCount = db.prepare('SELECT COUNT(*) AS n FROM entry_foods WHERE entry_id=?').get(row.id).n || 0;
  const dbSportCount = db.prepare('SELECT COUNT(*) AS n FROM sports WHERE entry_id=?').get(row.id).n || 0;
  const raw = normalizeLegacyRawEntryObject(safeJsonParse(row.raw_json || '{}', {}) || {});
  const rawFoodCount = foodnoteEntryRawFoods(raw).length;
  const rawSportCount = foodnoteEntryRawSports(raw).length;
  const foodCount = Math.max(dbFoodCount, rawFoodCount);
  const sportCount = Math.max(dbSportCount, rawSportCount);
  return {
    id: row.id,
    date: row.date,
    dbFoodCount,
    rawFoodCount,
    dbSportCount,
    rawSportCount,
    foodCount,
    sportCount,
    itemCount: foodCount + sportCount,
    kcal: Number(row.kcal || 0),
    depSport: Number(row.dep_sport || 0),
    updated_at: row.updated_at,
    revision: Number(row.revision || 0),
  };
}

function isIncomingEntrySummaryLike(body, incoming) {
  body = body || {};
  const explicitSummary = body._detailsLoaded === false || body.detailsLoaded === false || body.__summaryOnly === true || body._summaryOnly === true || body.details === false;
  if (explicitSummary) return true;
  const explicitDetails = body._detailsLoaded === true || body.detailsLoaded === true || body.__detailsLoaded === true;
  if (explicitDetails) return false;
  const foodCount = Number(incoming?.foodCount || 0) || 0;
  const sportCount = Number(incoming?.sportCount || 0) || 0;
  const kcal = Number(incoming?.kcal || 0) || 0;
  const hasOnlyEmptyArrays = Array.isArray(body.aliments) && body.aliments.length === 0 && (!Array.isArray(body.sports) || body.sports.length === 0);
  return hasOnlyEmptyArrays && foodCount === 0 && sportCount === 0 && kcal < 1;
}

function isSummaryOverwriteOfDetailedEntry(existing, incoming, body) {
  if (!existing) return false;
  if ((existing.itemCount || 0) <= 0 && (existing.kcal || 0) <= 0) return false;
  if (body && (body.__allowSummaryOverwrite === true || body.allowSummaryOverwrite === true || body.__allowEmptyDayReplace === true || body.allowEmptyDayReplace === true)) return false;
  if (!isIncomingEntrySummaryLike(body, incoming)) return false;
  return (Number(incoming?.itemCount || 0) || 0) < (Number(existing.itemCount || 0) || 0) || (Number(incoming?.kcal || 0) || 0) < Math.max(1, Number(existing.kcal || 0) * 0.35);
}

function isDangerousEntryOverwrite(existing, incoming) {
  if (!existing) return false;
  if ((existing.itemCount || 0) <= 0 && (existing.kcal || 0) <= 0) return false;
  if ((incoming.itemCount || 0) >= (existing.itemCount || 0)) return false;
  const incomingAlmostEmpty = (incoming.itemCount || 0) === 0 || (incoming.kcal || 0) < 100;
  const bigKcalDrop = (existing.kcal || 0) >= 300 && (incoming.kcal || 0) < (existing.kcal || 0) * 0.35;
  const bigItemDrop = (existing.itemCount || 0) >= 3 && (incoming.itemCount || 0) <= Math.max(1, Math.floor((existing.itemCount || 0) * 0.25));
  return incomingAlmostEmpty || bigKcalDrop || bigItemDrop;
}


function getExpectedEntryRevision(body) {
  const raw = body?._revision ?? body?.revision ?? body?.server_revision ?? body?.serverRevision;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function isEntryVersionConflict(existing, expectedRevision) {
  if (!existing || !expectedRevision) return false;
  const current = Number(existing.revision || 0);
  return current > 0 && current !== expectedRevision;
}

function periodStartExpr(kind) {
  if (kind === 'monthly') return "substr(date,1,7) || '-01'";
  return "date(date, '-' || ((CAST(strftime('%w', date) AS INTEGER) + 6) % 7) || ' days')";
}

function periodLabel(kind, periodStart) {
  if (!periodStart) return '';
  if (kind === 'monthly') {
    const [y, m] = periodStart.split('-');
    return `${m}/${y}`;
  }
  const d = new Date(`${periodStart}T00:00:00`);
  const end = new Date(d); end.setDate(end.getDate() + 6);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)} → ${pad(end.getDate())}/${pad(end.getMonth()+1)}`;
}

function getStatsPeriods(userId, kind, limit = 12) {
  const expr = periodStartExpr(kind);
  const rows = db.prepare(`
    SELECT
      ${expr} AS period_start,
      COUNT(*) AS days_logged,
      ROUND(AVG(kcal), 1) AS avg_kcal,
      ROUND(AVG(net_kcal), 1) AS avg_net_kcal,
      ROUND(AVG(prot), 1) AS avg_prot,
      ROUND(AVG(gluc), 1) AS avg_gluc,
      ROUND(AVG(lip), 1) AS avg_lip,
      ROUND(AVG(dep_sport), 1) AS avg_dep_sport,
      ROUND(SUM(dep_sport), 1) AS total_sport,
      ROUND(AVG(NULLIF(poids, 0)), 2) AS avg_poids,
      ROUND(MIN(NULLIF(poids, 0)), 2) AS min_poids,
      ROUND(MAX(NULLIF(poids, 0)), 2) AS max_poids,
      ROUND(SUM(kcal), 1) AS total_kcal,
      ROUND(SUM(prot), 1) AS total_prot
    FROM entries
    WHERE user_id=?
    GROUP BY period_start
    ORDER BY period_start DESC
    LIMIT ?
  `).all(userId, limit).map(r => ({
    ...r,
    label: periodLabel(kind, r.period_start),
  }));
  return rows;
}

function getStatsDaily(userId, days = 31) {
  return db.prepare(`
    SELECT date, kcal, prot, gluc, lip, net_kcal, dep_sport, poids
    FROM entries
    WHERE user_id=?
    ORDER BY date DESC
    LIMIT ?
  `).all(userId, days).reverse();
}

// ── Entries + Stats SQLite propres ──────────────────────────

const _tableColumnsCache = new Map();
function tableHasColumn(table, column) {
  const key = String(table || '');
  if (!_tableColumnsCache.has(key)) {
    try {
      _tableColumnsCache.set(key, new Set(db.prepare(`PRAGMA table_info(${key})`).all().map(c => c.name)));
    } catch(e) {
      _tableColumnsCache.set(key, new Set());
    }
  }
  return _tableColumnsCache.get(key).has(column);
}

function selectExistingColumns(table, cols) {
  const picked = cols.filter(c => tableHasColumn(table, c));
  return picked.length ? picked.join(', ') : '*';
}

function listEntriesForApi(userId, query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit || '100', 10) || 100, 1), 1000);
  const includeDetails = query.details !== '0';
  const from = String(query.from || '').slice(0, 10);
  const to = String(query.to || '').slice(0, 10);

  let where = 'WHERE user_id=?';
  const params = [userId];
  if (from) { where += ' AND date >= ?'; params.push(from); }
  if (to) { where += ' AND date <= ?'; params.push(to); }
  params.push(limit);

  // details=0 sert au démarrage : ne pas lire raw_json ni joindre les aliments.
  // Sur certaines bases, raw_json + 60 journées pouvait coûter plusieurs secondes
  // avant même le premier rendu.
  const selectCols = includeDetails
    ? '*'
    : selectExistingColumns('entries', [
        'id', 'user_id', 'date', 'poids', 'energie', 'faim', 'notes',
        'extras', 'question', 'dep_sport', 'net_kcal', 'kcal', 'prot',
        'gluc', 'lip', 'created_at', 'updated_at', 'revision',
        'write_id', 'client_id', 'raw_json'
      ]);
  const rows = db.prepare(`
    SELECT ${selectCols} FROM entries
    ${where}
    ORDER BY date DESC
    LIMIT ?
  `).all(...params);

  return {
    user_id: userId,
    count: rows.length,
    details: includeDetails,
    entries: rows.map(e => entryToApi(e, includeDetails)),
  };
}

// Compat ancienne UI / diagnostics : le journal est l'ancien nom public des entrées.
// La source SQLite réelle reste /api/entries.
app.get('/api/journal', requireUser, (req, res) => {
  try {
    res.json(listEntriesForApi(req.foodnoteUserId, req.query));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/entries', requireUser, (req, res) => {
  try {
    res.json(listEntriesForApi(req.foodnoteUserId, req.query));
  } catch(e) {
    console.error('[FoodNote API] GET /api/entries erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/admin/backfill-legacy-entry-foods', requireUser, (req, res) => {
  try {
    const result = backfillLegacyEntryFoodsFromRawJson({ userId: req.foodnoteUserId, limit: 10000 });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get('/api/admin/backfill-legacy-entry-foods', requireUser, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT e.date, e.id AS entry_id,
             COUNT(ef.id) AS normalized_foods,
             length(e.raw_json) AS raw_json_len,
             instr(e.raw_json, '"aliments"') AS has_aliments_key,
             instr(e.raw_json, '"foods"') AS has_foods_key
      FROM entries e
      LEFT JOIN entry_foods ef ON ef.entry_id=e.id
      WHERE e.user_id=?
      GROUP BY e.id
      ORDER BY e.date DESC
      LIMIT 80
    `).all(req.foodnoteUserId);
    res.json({ ok:true, rows });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get('/api/entries/:id', requireUser, (req, res) => {
  const e = db.prepare('SELECT * FROM entries WHERE user_id=? AND id=?').get(req.foodnoteUserId, req.params.id);
  if (!e) return res.status(404).json({ error: 'Entrée introuvable' });
  res.json(entryToApi(e, true));
});



// v11.57 — Ajout aliment atomique côté SQLite.
// Cet endpoint évite de dépendre de l'état complet de l'UI pour un simple ajout depuis la Mémoire/popup.
// Il fusionne l'aliment dans la journée existante sans supprimer les autres aliments/sports déjà sauvegardés.
function normalizeFoodAppendMeal(meal) {
  const m = String(meal || '').trim();
  return (m === 'breakfast' || m === 'lunch' || m === 'dinner') ? m : 'lunch';
}

function normalizeFoodAppendKey(food) {
  const name = String(food?.nom || food?.name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return name + '|' + normalizeFoodAppendMeal(food?.meal || food?.repas || food?.mealId || 'lunch');
}


function normalizeOptionalFoodReferenceId(foodIdRaw) {
  const n = Number(foodIdRaw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const id = Math.floor(n);
  try {
    // Une ligne de journal doit rester sauvegardable même si l'aliment source
    // n'existe plus dans la base `foods` (restauration, import, cache ancien,
    // OpenFoodFacts/CIQUAL, aliment custom, etc.). Dans ce cas le snapshot
    // nutritionnel suffit et la référence FK reste volontairement NULL.
    const row = db.prepare('SELECT id FROM foods WHERE id=? LIMIT 1').get(id);
    return row && row.id ? id : null;
  } catch (e) {
    return null;
  }
}

function cleanFoodAppendPayload(food) {
  if (!food || typeof food !== 'object') return null;
  const nom = String(food.nom || food.name || '').trim();
  if (!nom) return null;
  const qty = normalizeEntryFoodStorageToGrams({ qty: food.qty ?? food.quantity ?? food.quantite ?? food.defaut ?? 0 });
  const meal = normalizeFoodAppendMeal(food.meal || food.repas || food.mealId || 'lunch');
  const foodIdRaw = food.food_id ?? food.foodId ?? food.bddId ?? null;
  const foodId = normalizeOptionalFoodReferenceId(foodIdRaw);
  const out = {
    nom,
    qty,
    unite: 'g',
    poidsUnite: null,
    uniteLabel: '',
    meal,
    kcal: Math.round(Number(food.kcal || 0) || 0),
    prot: Number(Number(food.prot || 0).toFixed(1)),
    gluc: Number(Number(food.gluc || 0).toFixed(1)),
    lip: Number(Number(food.lip || 0).toFixed(1)),
    food_id: foodId,
    line_uid: String(food.line_uid || food.lineUid || crypto.randomUUID()).slice(0, 80)
  };
  assertEntryFoodLineAllowed(out);
  return out;
}

function recomputeMacrosFromApiFoods(foods) {
  const raw = (Array.isArray(foods) ? foods : []).reduce((acc, f) => {
    acc.kcal += Number(f.kcal || 0) || 0;
    acc.prot += Number(f.prot || 0) || 0;
    acc.gluc += Number(f.gluc || 0) || 0;
    acc.lip += Number(f.lip || 0) || 0;
    return acc;
  }, { kcal:0, prot:0, gluc:0, lip:0 });
  return {
    kcal: Math.round(raw.kcal),
    prot: Number(raw.prot.toFixed(1)),
    gluc: Number(raw.gluc.toFixed(1)),
    lip: Number(raw.lip.toFixed(1)),
  };
}

function mergeFoodIntoEntryForAppend(existingEntry, date, food, body = {}) {
  const base = existingEntry || {
    id: undefined,
    date,
    poids: body.poids ?? '',
    energie: body.energie ?? '',
    faim: body.faim ?? '',
    notes: body.notes ?? '',
    extras: body.extras ?? '',
    question: body.question ?? '',
    sports: [],
    depSport: 0,
    dailyChecklist: {},
    dailyReview: {},
  };

  const incomingKey = normalizeFoodAppendKey(food);
  let replaced = false;
  const foods = (Array.isArray(base.aliments) ? base.aliments : []).map(f => {
    if (normalizeFoodAppendKey(f) === incomingKey) {
      replaced = true;
      return food;
    }
    return f;
  });
  if (!replaced) foods.push(food);

  const sports = Array.isArray(base.sports) ? base.sports : [];
  const depSport = sports.reduce((s, r) => s + (Number(r.total || 0) || 0), 0);
  const macros = recomputeMacrosFromApiFoods(foods);

  const keep = (incoming, current) => {
    if (incoming === undefined || incoming === null) return current;
    if (typeof incoming === 'string' && !incoming.trim()) return current ?? incoming;
    return incoming;
  };

  return {
    ...base,
    date,
    poids: keep(body.poids, base.poids),
    energie: keep(body.energie, base.energie),
    faim: keep(body.faim, base.faim),
    notes: keep(body.notes, base.notes),
    extras: keep(body.extras, base.extras),
    question: keep(body.question, base.question),
    aliments: foods,
    sports,
    depSport,
    macros,
    netKcal: Math.round(macros.kcal - depSport),
    dailyChecklist: {
      ...((base && base.dailyChecklist) || {}),
      foodDone: true,
      ...(sports.length && depSport > 0 ? { sportDone:true } : {}),
      ...(String(keep(body.poids, base.poids) || '').trim() ? { weightDone:true } : {}),
    },
    dailyReview: (base && base.dailyReview) || {},
    write_id: String(body.write_id || body.writeId || crypto.randomUUID()),
    client_id: String(body.client_id || body.clientId || '').slice(0, 80) || null,
  };
}

app.post('/api/entries', requireUser, (req, res) => {
  try {
    const entry = buildEntryPayloadFromBody(req.body || {});
    if (!entry.date) return res.status(400).json({ error: 'date obligatoire' });

    const force = req.query.force === '1' || req.body?.force === true || req.body?.force === '1';
    const existingSummary = getStoredEntrySafetySummary(req.foodnoteUserId, entry.date);
    const incomingSummary = getEntrySafetySummary(entry);
    const expectedRevision = getExpectedEntryRevision(req.body || {});

    if (FOODNOTE_DEBUG_SYNC) console.log(`[FoodNote API] POST /api/entries date=${entry.date} aliments=${incomingSummary.foodCount} sports=${incomingSummary.sportCount} expectedRev=${expectedRevision || '-'} currentRev=${existingSummary?.revision || '-'} force=${force ? '1' : '0'}`);

    // 0.22.47 — garde-fou non contournable par force=1 :
    // une entrée chargée en résumé (_detailsLoaded:false / aliments:[]) ne doit jamais
    // remplacer une vraie journée détaillée. C'est le bug qui a vidé l'historique avant le 27.
    if (isSummaryOverwriteOfDetailedEntry(existingSummary, incomingSummary, req.body || {})) {
      return res.status(409).json({
        ok: false,
        code: 'ENTRY_SUMMARY_OVERWRITE_GUARD',
        error: 'Sauvegarde bloquée : cette journée semble venir d’un résumé sans détails. Recharge les détails avant de sauvegarder.',
        existing: existingSummary,
        incoming: incomingSummary,
      });
    }

    if (!force && isEntryVersionConflict(existingSummary, expectedRevision)) {
      return res.status(409).json({
        ok: false,
        code: 'ENTRY_VERSION_CONFLICT',
        error: 'Cette journée a été modifiée sur un autre appareil. Recharge avant de sauvegarder pour éviter un écrasement.',
        existing: existingSummary,
        incoming: incomingSummary,
        expected_revision: expectedRevision,
        current_revision: existingSummary ? existingSummary.revision : null,
      });
    }

    if (!force && isDangerousEntryOverwrite(existingSummary, incomingSummary)) {
      return res.status(409).json({
        ok: false,
        code: 'ENTRY_OVERWRITE_GUARD',
        error: 'Une journée existe déjà avec plus de contenu. Recharge-la avant de modifier, ou confirme le remplacement.',
        existing: existingSummary,
        incoming: incomingSummary,
      });
    }

    // Enregistre les anomalies non bloquantes sans empêcher la sauvegarde du reste.
    recordAnomaliesFromEntryPayload(req.foodnoteUserId, entry, 'incoming_entry');
    upsertNormalizedEntry(req.foodnoteUserId, entry);
    const e = db.prepare('SELECT * FROM entries WHERE user_id=? AND date=?').get(req.foodnoteUserId, String(entry.date));
    res.json({ ok: true, entry: entryToApi(e, true) });
  } catch(e) {
    try {
      const entryForAnomaly = buildEntryPayloadFromBody(req.body || {});
      if (e.status === 400) recordAnomaliesFromEntryPayload(req.foodnoteUserId, entryForAnomaly, 'incoming_entry');
    } catch(_) {}
    console.error('[FoodNote API] POST /api/entries erreur:', e.message);
    res.status(e.status || 500).json({ error: e.message, anomaly_hint: e.status === 400 ? 'Voir Bases de données → Anomalies' : undefined });
  }
});




function ensureEntryRowForAtomicWrite(userId, date, body = {}) {
  const existing = db.prepare('SELECT * FROM entries WHERE user_id=? AND date=?').get(userId, date);
  if (existing) return existing;
  const now = new Date().toISOString();
  const entryCols = getSqliteColumnSet('entries');
  const rowData = {
    user_id: userId,
    date,
    poids: body.poids === '' || body.poids == null ? null : Number(body.poids),
    energie: body.energie || null,
    faim: body.faim || null,
    notes: body.notes || null,
    extras: body.extras || null,
    question: body.question || null,
    dep_sport: 0,
    net_kcal: 0,
    kcal: 0,
    prot: 0,
    gluc: 0,
    lip: 0,
    raw_json: JSON.stringify({ date, dailyChecklist:{}, dailyReview:{} }),
    write_id: String(body.write_id || body.writeId || crypto.randomUUID()),
    client_id: String(body.client_id || body.clientId || '').slice(0, 80) || null,
    created_at: now,
    updated_at: now
  };
  const cols = Object.keys(rowData).filter(c => entryCols.has(c));
  db.prepare(`INSERT INTO entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => rowData[c]));
  return db.prepare('SELECT * FROM entries WHERE user_id=? AND date=?').get(userId, date);
}

function recalcEntryAggregatesFromRows(userId, entryId, patch = {}) {
  const row = db.prepare('SELECT * FROM entries WHERE user_id=? AND id=?').get(userId, entryId);
  if (!row) return null;
  const sums = db.prepare(`
    SELECT COALESCE(SUM(kcal),0) AS kcal, COALESCE(SUM(prot),0) AS prot, COALESCE(SUM(gluc),0) AS gluc, COALESCE(SUM(lip),0) AS lip
    FROM entry_foods WHERE entry_id=?
  `).get(entryId);
  const sport = db.prepare('SELECT COALESCE(SUM(total),0) AS dep FROM sports WHERE entry_id=?').get(entryId);
  let kcal = Math.round(Number(sums.kcal || 0));
  let prot = Number(Number(sums.prot || 0).toFixed(1));
  let gluc = Number(Number(sums.gluc || 0).toFixed(1));
  let lip = Number(Number(sums.lip || 0).toFixed(1));
  const depSport = Math.round(Number(sport.dep || 0));

  const raw = normalizeLegacyRawEntryObject(safeJsonParse(row.raw_json || '{}', {}) || {});
  raw.date = raw.date || row.date;

  // 0.22.75 — SQLite normalisé = source de vérité.
  // Quand une écriture atomique aliment/sport modifie les tables dédiées, raw_json est
  // resynchronisé depuis ces tables au lieu de conserver une vieille copie incohérente.
  // Pour les toutes vieilles journées encore non backfillées, on préserve les aliments raw
  // tant que entry_foods est vide, afin de ne pas effacer un historique ancien.
  const dbFoodsForRaw = db.prepare(`
    SELECT id AS entryFoodId, id AS entry_food_id, line_uid, name_snapshot AS nom, qty, unit AS unite,
           unit_weight AS poidsUnite, unit_label AS uniteLabel, kcal, prot, gluc, lip, meal
    FROM entry_foods
    WHERE entry_id=?
    ORDER BY id
  `).all(entryId).map(serverCleanEntryFoodRow);
  const dbSportsForRaw = db.prepare(`
    SELECT name AS nom, hours AS heures, kcal_h AS kcalH, total
    FROM sports
    WHERE entry_id=?
    ORDER BY id
  `).all(entryId);

  if (!dbFoodsForRaw.length) {
    const legacyFoods = foodnoteEntryRawFoods(raw).map(foodnoteRawFoodToApi).filter(Boolean);
    if (legacyFoods.length) {
      const legacyMacros = recomputeMacrosFromApiFoods(legacyFoods);
      kcal = legacyMacros.kcal;
      prot = legacyMacros.prot;
      gluc = legacyMacros.gluc;
      lip = legacyMacros.lip;
    } else if (Number(row.kcal || 0) > 0 || Number(row.prot || 0) > 0 || Number(row.gluc || 0) > 0 || Number(row.lip || 0) > 0) {
      kcal = Math.round(Number(row.kcal || 0));
      prot = Number(Number(row.prot || 0).toFixed(1));
      gluc = Number(Number(row.gluc || 0).toFixed(1));
      lip = Number(Number(row.lip || 0).toFixed(1));
    }
  }

  const syncFoods = dbFoodsForRaw.length > 0 || patch.__replaceFoods === true || patch.replaceFoods === true || patch._replaceFoods === true;
  const syncSports = dbSportsForRaw.length > 0 || patch.__replaceSports === true || patch.replaceSports === true || patch._replaceSports === true || patch.__sportsAtomic === true;
  if (syncFoods) raw.aliments = dbFoodsForRaw;
  if (syncSports) raw.sports = dbSportsForRaw;

  raw.depSport = depSport;
  raw.dep_sport = depSport;
  raw.macros = { kcal, prot, gluc, lip };
  raw.netKcal = Math.round(kcal - depSport);
  raw.net_kcal = raw.netKcal;
  raw.dailyChecklist = {
    ...((raw && raw.dailyChecklist) || {}),
    ...((patch && patch.dailyChecklist && typeof patch.dailyChecklist === 'object') ? patch.dailyChecklist : {}),
    ...(kcal > 0 ? { foodDone:true } : {}),
    ...(depSport > 0 ? { sportDone:true } : {})
  };
  if (syncSports && depSport <= 0 && raw.dailyChecklist) raw.dailyChecklist.sportDone = false;
  raw.dailyReview = (raw && raw.dailyReview) || {};

  const keepText = (v) => (v === undefined || v === null || String(v).trim() === '') ? null : String(v);
  const poidsPatch = patch.poids === undefined || patch.poids === null || patch.poids === '' ? null : Number(patch.poids);
  db.prepare(`
    UPDATE entries SET
      kcal=?, prot=?, gluc=?, lip=?, dep_sport=?, net_kcal=?, raw_json=?,
      poids=COALESCE(?, poids), energie=COALESCE(?, energie), faim=COALESCE(?, faim),
      notes=COALESCE(?, notes), extras=COALESCE(?, extras), question=COALESCE(?, question),
      revision=COALESCE(revision,0)+1, updated_at=?
    WHERE user_id=? AND id=?
  `).run(
    kcal, prot, gluc, lip, depSport, Math.round(kcal - depSport), JSON.stringify(raw),
    Number.isFinite(poidsPatch) ? poidsPatch : null,
    keepText(patch.energie), keepText(patch.faim), keepText(patch.notes), keepText(patch.extras), keepText(patch.question),
    new Date().toISOString(), userId, entryId
  );
  return db.prepare('SELECT * FROM entries WHERE user_id=? AND id=?').get(userId, entryId);
}

function entryFoodToApi(row) {
  if (!row) return null;
  return serverCleanEntryFoodRow({
    id: row.id,
    entryFoodId: row.id,
    entry_food_id: row.id,
    line_uid: row.line_uid || null,
    nom: row.name_snapshot,
    qty: row.qty,
    unite: row.unit || 'g',
    poidsUnite: row.unit_weight,
    uniteLabel: row.unit_label || '',
    kcal: row.kcal,
    prot: row.prot,
    gluc: row.gluc,
    lip: row.lip,
    meal: row.meal || 'lunch'
  });
}

function insertEntryFoodAtomic(userId, date, food, body = {}) {
  const entry = ensureEntryRowForAtomicWrite(userId, date, body);
  const foodCols = getSqliteColumnSet('entry_foods');
  const lineUid = String(food.line_uid || food.lineUid || crypto.randomUUID()).slice(0, 80);
  const foodData = {
    entry_id: entry.id,
    food_id: normalizeOptionalFoodReferenceId(food.food_id),
    line_uid: lineUid,
    name_snapshot: food.nom,
    qty: normalizeEntryFoodStorageToGrams(food),
    unit: 'g',
    unit_weight: null,
    unit_label: '',
    kcal: food.kcal,
    prot: food.prot,
    gluc: food.gluc,
    lip: food.lip,
    meal: normalizeFoodAppendMeal(food.meal)
  };

  // Principe 0.22.4 : line_uid est l'identité client d'une ligne tant que l'id SQLite n'est pas revenu.
  // Un POST rejoué pour le même line_uid ne doit donc jamais créer un doublon.
  let savedFood = null;
  if (foodCols.has('line_uid') && lineUid) {
    const existing = db.prepare('SELECT * FROM entry_foods WHERE entry_id=? AND line_uid=?').get(entry.id, lineUid);
    if (existing) {
      db.prepare(`
        UPDATE entry_foods
        SET food_id=?, name_snapshot=?, qty=?, unit='g', unit_weight=NULL, unit_label='', kcal=?, prot=?, gluc=?, lip=?, meal=?
        WHERE id=?
      `).run(foodData.food_id, foodData.name_snapshot, foodData.qty, foodData.kcal, foodData.prot, foodData.gluc, foodData.lip, foodData.meal, existing.id);
      savedFood = db.prepare('SELECT * FROM entry_foods WHERE id=?').get(existing.id);
    }
  }

  if (!savedFood) {
    const requested = ['entry_id', 'food_id', 'line_uid', 'name_snapshot', 'qty', 'unit', 'unit_weight', 'unit_label', 'kcal', 'prot', 'gluc', 'lip', 'meal'];
    const insertCols = requested.filter(c => foodCols.has(c));
    const sql = `INSERT INTO entry_foods (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`;
    const info = db.prepare(sql).run(...insertCols.map(c => foodData[c]));
    savedFood = db.prepare('SELECT * FROM entry_foods WHERE id=?').get(info.lastInsertRowid);
  }

  const savedEntry = recalcEntryAggregatesFromRows(userId, entry.id, body);
  return { entry: entryToApi(savedEntry, true), food: entryFoodToApi(savedFood) };
}

function updateEntryFoodAtomic(userId, foodRowId, patch = {}) {
  const current = db.prepare(`
    SELECT ef.*, e.id AS entry_id_real
    FROM entry_foods ef JOIN entries e ON e.id=ef.entry_id
    WHERE e.user_id=? AND ef.id=?
  `).get(userId, foodRowId);
  if (!current) return null;
  const clean = cleanFoodAppendPayload({
    nom: patch.nom ?? patch.name ?? current.name_snapshot,
    qty: patch.qty ?? patch.quantity ?? patch.quantite ?? current.qty,
    meal: patch.meal ?? patch.repas ?? current.meal,
    kcal: patch.kcal ?? current.kcal,
    prot: patch.prot ?? current.prot,
    gluc: patch.gluc ?? current.gluc,
    lip: patch.lip ?? current.lip,
    food_id: patch.food_id ?? patch.foodId ?? current.food_id,
    line_uid: current.line_uid || patch.line_uid || patch.lineUid
  });
  if (!clean) throw foodnoteBadRequest('aliment obligatoire');
  db.prepare(`
    UPDATE entry_foods
    SET food_id=?, line_uid=COALESCE(line_uid, ?), name_snapshot=?, qty=?, unit='g', unit_weight=NULL, unit_label='', kcal=?, prot=?, gluc=?, lip=?, meal=?
    WHERE id=?
  `).run(clean.food_id, clean.line_uid, clean.nom, clean.qty, clean.kcal, clean.prot, clean.gluc, clean.lip, clean.meal, foodRowId);
  const savedFood = db.prepare('SELECT * FROM entry_foods WHERE id=?').get(foodRowId);
  const savedEntry = recalcEntryAggregatesFromRows(userId, current.entry_id_real, patch);
  return { entry: entryToApi(savedEntry, true), food: entryFoodToApi(savedFood) };
}

function deleteEntryFoodAtomic(userId, foodRowId) {
  const current = db.prepare(`
    SELECT ef.id, ef.line_uid, e.id AS entry_id_real
    FROM entry_foods ef JOIN entries e ON e.id=ef.entry_id
    WHERE e.user_id=? AND ef.id=?
  `).get(userId, foodRowId);
  if (!current) return null;

  // Moteur 0.22.9 : si un ancien bug a créé deux lignes avec le même line_uid,
  // la suppression d'une ligne doit nettoyer toute l'identité logique dans la même journée.
  let deleted = 0;
  if (current.line_uid) {
    const info = db.prepare('DELETE FROM entry_foods WHERE entry_id=? AND (id=? OR line_uid=?)').run(current.entry_id_real, foodRowId, current.line_uid);
    deleted = info.changes || 0;
  } else {
    const info = db.prepare('DELETE FROM entry_foods WHERE id=?').run(foodRowId);
    deleted = info.changes || 0;
  }
  const savedEntry = recalcEntryAggregatesFromRows(userId, current.entry_id_real, {});
  return { entry: entryToApi(savedEntry, true), deleted: Number(foodRowId), deleted_count: deleted, line_uid: current.line_uid || null };
}

function deleteEntryFoodByLineUidAtomic(userId, date, lineUid) {
  const cleanDate = String(date || '').slice(0, 10);
  const cleanUid = String(lineUid || '').trim().slice(0, 80);
  if (!cleanDate || !cleanUid) return null;
  const current = db.prepare(`
    SELECT ef.id, e.id AS entry_id_real
    FROM entry_foods ef JOIN entries e ON e.id=ef.entry_id
    WHERE e.user_id=? AND e.date=? AND ef.line_uid=?
  `).get(userId, cleanDate, cleanUid);
  if (!current) return null;
  const info = db.prepare(`
    DELETE FROM entry_foods
    WHERE entry_id=? AND line_uid=?
  `).run(current.entry_id_real, cleanUid);
  const savedEntry = recalcEntryAggregatesFromRows(userId, current.entry_id_real, {});
  return { entry: entryToApi(savedEntry, true), deleted: Number(current.id), deleted_count: info.changes || 0, line_uid: cleanUid };
}


function deleteEntryFoodByMatchAtomic(userId, date, match = {}) {
  const cleanDate = String(date || '').slice(0, 10);
  if (!cleanDate) return null;
  const entry = db.prepare('SELECT id FROM entries WHERE user_id=? AND date=?').get(userId, cleanDate);
  if (!entry) return null;
  const norm = (v) => String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const target = {
    nom: norm(match.nom || match.name || match.name_snapshot),
    meal: String(match.meal || match.repas || 'lunch'),
    qty: Number(match.qty ?? match.quantite ?? 0) || 0,
    kcal: Number(match.kcal ?? 0) || 0,
    prot: Number(match.prot ?? 0) || 0,
    gluc: Number(match.gluc ?? 0) || 0,
    lip: Number(match.lip ?? 0) || 0
  };
  const rows = db.prepare('SELECT id, line_uid, name_snapshot, qty, kcal, prot, gluc, lip, meal FROM entry_foods WHERE entry_id=?').all(entry.id);
  let best = null;
  for (const row of rows) {
    const rn = norm(row.name_snapshot);
    let score = 0;
    if (target.nom && rn === target.nom) score += 60;
    else if (target.nom && (rn.includes(target.nom) || target.nom.includes(rn))) score += 32;
    if (target.meal && String(row.meal || '') === target.meal) score += 18;
    const qtyDiff = Math.abs((Number(row.qty) || 0) - target.qty);
    if (target.qty > 0 && qtyDiff <= 0.5) score += 16;
    else if (target.qty > 0 && qtyDiff <= 5) score += 8;
    const macroDiff = Math.abs((Number(row.kcal)||0)-target.kcal)
      + Math.abs((Number(row.prot)||0)-target.prot)
      + Math.abs((Number(row.gluc)||0)-target.gluc)
      + Math.abs((Number(row.lip)||0)-target.lip);
    if ((target.kcal || target.prot || target.gluc || target.lip) && macroDiff <= 2) score += 18;
    else if ((target.kcal || target.prot || target.gluc || target.lip) && macroDiff <= 8) score += 9;
    if (!best || score > best.score) best = { row, score };
  }
  if (!best || best.score < 45) return null;
  const current = best.row;
  let info;
  if (current.line_uid) info = db.prepare('DELETE FROM entry_foods WHERE entry_id=? AND (id=? OR line_uid=?)').run(entry.id, current.id, current.line_uid);
  else info = db.prepare('DELETE FROM entry_foods WHERE id=?').run(current.id);
  const savedEntry = recalcEntryAggregatesFromRows(userId, entry.id, {});
  return { entry: entryToApi(savedEntry, true), deleted: Number(current.id), deleted_count: info.changes || 0, line_uid: current.line_uid || null, score: best.score };
}


function normalizeSportRowsForAtomicSave(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(s => {
      const heures = Number(s?.heures ?? s?.hours ?? s?.duree ?? s?.duration ?? 0) || 0;
      const kcalH = Number(s?.kcalH ?? s?.kcal_h ?? s?.kcal_horaire ?? 0) || 0;
      const totalRaw = Number(s?.total ?? 0) || 0;
      const total = Math.round(totalRaw > 0 ? totalRaw : (heures * kcalH));
      const nom = String(s?.nom || s?.name || s?.label || 'Sport').trim() || 'Sport';
      return { nom, heures, kcalH, total };
    })
    .filter(s => s.total > 0 && (s.heures > 0 || s.kcalH > 0));
}

function replaceEntrySportsAtomic(userId, date, sports, body = {}) {
  const cleanDate = String(date || '').slice(0, 10);
  if (!cleanDate) throw foodnoteBadRequest('date obligatoire');
  const entry = ensureEntryRowForAtomicWrite(userId, cleanDate, body || {});
  const rows = normalizeSportRowsForAtomicSave(sports);
  const sportCols = getSqliteColumnSet('sports');
  const requestedSportCols = ['entry_id', 'name', 'hours', 'kcal_h', 'total'];
  const insertSportCols = requestedSportCols.filter(c => sportCols.has(c));
  const sportSql = `INSERT INTO sports (${insertSportCols.join(', ')}) VALUES (${insertSportCols.map(() => '?').join(', ')})`;
  const insertSport = insertSportCols.length ? db.prepare(sportSql) : null;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sports WHERE entry_id=?').run(entry.id);
    for (const s of rows) {
      if (!insertSport) continue;
      const sportData = {
        entry_id: entry.id,
        name: s.nom,
        hours: s.heures,
        kcal_h: s.kcalH,
        total: s.total
      };
      insertSport.run(...insertSportCols.map(c => sportData[c]));
    }
    return recalcEntryAggregatesFromRows(userId, entry.id, {
      ...(body || {}),
      __replaceSports: true,
      __sportsAtomic: true,
      dailyChecklist: {
        ...((body && body.dailyChecklist) || {}),
        sportDone: rows.length > 0
      }
    });
  });

  const savedEntry = tx();
  return { entry: entryToApi(savedEntry, true), sports: rows };
}

app.post('/api/entries/:date/sports', requireUser, (req, res) => {
  try {
    const date = String(req.params.date || req.body?.date || '').slice(0, 10);
    if (!date) return res.status(400).json({ ok:false, error:'date obligatoire' });
    const sports = Array.isArray(req.body?.sports) ? req.body.sports : [];
    const result = replaceEntrySportsAtomic(req.foodnoteUserId, date, sports, req.body || {});
    res.json({ ok:true, entry: result.entry, sports: result.sports, mode:'sports-replace-atomic' });
  } catch(e) {
    console.error('[FoodNote API] POST /api/entries/:date/sports erreur:', e.message);
    res.status(e.status || 500).json({ ok:false, error:e.message });
  }
});

app.post('/api/entries/:date/foods', requireUser, (req, res) => {
  try {
    const date = String(req.params.date || req.body?.date || '').slice(0, 10);
    if (!date) return res.status(400).json({ ok:false, error:'date obligatoire' });
    const food = cleanFoodAppendPayload(req.body?.food || req.body?.aliment || req.body || {});
    if (!food) return res.status(400).json({ ok:false, error:'aliment obligatoire' });
    const result = insertEntryFoodAtomic(req.foodnoteUserId, date, food, req.body || {});
    res.json({ ok:true, entry: result.entry, food: result.food, mode:'food-insert-atomic' });
  } catch(e) {
    try {
      if (e.status === 400) {
        const date = String(req.params.date || req.body?.date || '').slice(0, 10);
        const food = req.body?.food || req.body?.aliment || req.body || {};
        recordAnomaliesFromEntryPayload(req.foodnoteUserId, { date, aliments:[food] }, 'incoming_food_append');
      }
    } catch(_) {}
    console.error('[FoodNote API] POST /api/entries/:date/foods erreur:', e.message);
    res.status(e.status || 500).json({ ok:false, error:e.message, anomaly_hint: e.status === 400 ? 'Voir Bases de données → Anomalies' : undefined });
  }
});

app.patch('/api/entry-foods/:id', requireUser, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok:false, error:'id ligne aliment invalide' });
    const result = updateEntryFoodAtomic(req.foodnoteUserId, id, req.body || {});
    if (!result) return res.status(404).json({ ok:false, error:'ligne aliment introuvable' });
    res.json({ ok:true, entry: result.entry, food: result.food, mode:'food-update-atomic' });
  } catch(e) {
    console.error('[FoodNote API] PATCH /api/entry-foods/:id erreur:', e.message);
    res.status(e.status || 500).json({ ok:false, error:e.message });
  }
});

app.delete('/api/entry-foods/:id', requireUser, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok:false, error:'id ligne aliment invalide' });
    const result = deleteEntryFoodAtomic(req.foodnoteUserId, id);
    if (!result) return res.status(404).json({ ok:false, error:'ligne aliment introuvable' });
    res.json({ ok:true, entry: result.entry, deleted: result.deleted, mode:'food-delete-atomic' });
  } catch(e) {
    console.error('[FoodNote API] DELETE /api/entry-foods/:id erreur:', e.message);
    res.status(e.status || 500).json({ ok:false, error:e.message });
  }
});

app.delete('/api/entries/:date/foods/by-line/:line_uid', requireUser, (req, res) => {
  try {
    const date = String(req.params.date || '').slice(0, 10);
    const lineUid = String(req.params.line_uid || '').trim().slice(0, 80);
    if (!date) return res.status(400).json({ ok:false, error:'date obligatoire' });
    if (!lineUid) return res.status(400).json({ ok:false, error:'line_uid obligatoire' });
    const result = deleteEntryFoodByLineUidAtomic(req.foodnoteUserId, date, lineUid);
    if (!result) return res.status(404).json({ ok:false, error:'ligne aliment introuvable' });
    res.json({ ok:true, entry: result.entry, deleted: result.deleted, line_uid: result.line_uid, mode:'food-delete-by-line-uid' });
  } catch(e) {
    console.error('[FoodNote API] DELETE /api/entries/:date/foods/by-line/:line_uid erreur:', e.message);
    res.status(e.status || 500).json({ ok:false, error:e.message });
  }
});


app.post('/api/entries/:date/foods/delete-match', requireUser, (req, res) => {
  try {
    const date = String(req.params.date || '').slice(0, 10);
    if (!date) return res.status(400).json({ ok:false, error:'date obligatoire' });
    const result = deleteEntryFoodByMatchAtomic(req.foodnoteUserId, date, req.body?.food || req.body || {});
    if (!result) return res.status(404).json({ ok:false, error:'ligne aliment introuvable par contenu' });
    res.json({ ok:true, entry: result.entry, deleted: result.deleted, deleted_count: result.deleted_count, line_uid: result.line_uid, score: result.score, mode:'food-delete-by-match' });
  } catch(e) {
    console.error('[FoodNote API] POST /api/entries/:date/foods/delete-match erreur:', e.message);
    res.status(e.status || 500).json({ ok:false, error:e.message });
  }
});

app.delete('/api/entries/:date/foods/delete-match', requireUser, (req, res) => {
  try {
    const date = String(req.params.date || '').slice(0, 10);
    if (!date) return res.status(400).json({ ok:false, error:'date obligatoire' });
    const result = deleteEntryFoodByMatchAtomic(req.foodnoteUserId, date, req.body?.food || req.body || req.query || {});
    if (!result) return res.status(404).json({ ok:false, error:'ligne aliment introuvable par contenu' });
    res.json({ ok:true, entry: result.entry, deleted: result.deleted, deleted_count: result.deleted_count, line_uid: result.line_uid, score: result.score, mode:'food-delete-by-match-delete' });
  } catch(e) {
    console.error('[FoodNote API] DELETE /api/entries/:date/foods/delete-match erreur:', e.message);
    res.status(e.status || 500).json({ ok:false, error:e.message });
  }
});

app.delete('/api/entries/:id', requireUser, (req, res) => {
  try {
    const r = db.prepare('DELETE FROM entries WHERE user_id=? AND id=?').run(req.foodnoteUserId, req.params.id);
    res.json({ ok: true, deleted: r.changes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Anomalies données ─────────────────────────────────────
app.get('/api/anomalies', requireUser, (req, res) => {
  try {
    const rescan = req.query.rescan === '1' || req.query.rescan === 'true';
    res.json(listDataAnomaliesForUser(req.foodnoteUserId, { status: req.query.status || 'open', rescan }));
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/anomalies/rescan', requireUser, (req, res) => {
  try {
    const scan = scanDataAnomaliesForUser(req.foodnoteUserId);
    const list = listDataAnomaliesForUser(req.foodnoteUserId, { status: req.query.status || 'open' });
    res.json({ ...list, scan });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/anomalies/:id/status', requireUser, (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!['open', 'ignored', 'resolved'].includes(status)) return res.status(400).json({ ok:false, error:'status invalide' });
    const r = db.prepare(`
      UPDATE data_anomalies
      SET status=?, updated_at=CURRENT_TIMESTAMP
      WHERE user_id=? AND id=?
    `).run(status, req.foodnoteUserId, req.params.id);
    if (!r.changes) return res.status(404).json({ ok:false, error:'Anomalie introuvable' });
    res.json({ ok:true, id:Number(req.params.id), status });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.get('/api/stats/summary', requireUser, (req, res) => {
  const rows = db.prepare(`
    SELECT date, kcal, prot, gluc, lip, net_kcal, dep_sport, poids
    FROM entries
    WHERE user_id=?
    ORDER BY date DESC
    LIMIT 370
  `).all(req.foodnoteUserId);
  res.json({ user_id: req.foodnoteUserId, entries: rows });
});

app.get('/api/stats/weekly', requireUser, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '12', 10) || 12, 1), 104);
    const periods = getStatsPeriods(req.foodnoteUserId, 'weekly', limit);
    res.json({
      user_id: req.foodnoteUserId,
      type: 'weekly',
      current: periods[0] || null,
      previous: periods[1] || null,
      periods,
      daily: getStatsDaily(req.foodnoteUserId, 35),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/monthly', requireUser, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '12', 10) || 12, 1), 60);
    const periods = getStatsPeriods(req.foodnoteUserId, 'monthly', limit);
    res.json({
      user_id: req.foodnoteUserId,
      type: 'monthly',
      current: periods[0] || null,
      previous: periods[1] || null,
      periods,
      daily: getStatsDaily(req.foodnoteUserId, 370),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── OpenFoodFacts local search ────────────────────────────
let _sqljs = null;
async function getSQLDB() {
  if (!fs.existsSync(OFF_DB)) return null;
  if (!_sqljs) {
    const initSqlJs = require('sql.js');
    _sqljs = await initSqlJs();
  }
  const buf = fs.readFileSync(OFF_DB);
  return new _sqljs.Database(buf);
}

function openOffSqliteReadonly() {
  if (!fs.existsSync(OFF_DB)) return null;
  return new Database(OFF_DB, { readonly: true, fileMustExist: true });
}
function tableExistsSqlite(dbx, name) {
  return !!dbx.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function getOffColumnsSqlite(dbx) {
  if (!tableExistsSqlite(dbx, 'aliments')) return [];
  return dbx.prepare('PRAGMA table_info(aliments)').all().map(c => c.name);
}
function getOffStatusSync() {
  if (!fs.existsSync(OFF_DB)) return { available: false, scan_local: false, db: null };
  const info = fileInfo(OFF_DB);
  let dbOff = null;
  try {
    dbOff = openOffSqliteReadonly();
    const hasAliments = tableExistsSqlite(dbOff, 'aliments');
    const hasCiqual = tableExistsSqlite(dbOff, 'ciqual');
    const columns = hasAliments ? getOffColumnsSqlite(dbOff) : [];
    const codeColumn = ['code', 'barcode', 'ean', 'product_code'].find(c => columns.includes(c)) || null;
    const count = hasAliments ? Number(dbOff.prepare('SELECT COUNT(*) AS n FROM aliments').get().n || 0) : 0;
    const withBarcode = (hasAliments && codeColumn)
      ? Number(dbOff.prepare(`SELECT COUNT(*) AS n FROM aliments WHERE ${codeColumn} IS NOT NULL AND TRIM(${codeColumn}) != ''`).get().n || 0)
      : 0;
    const ciqual = hasCiqual ? Number(dbOff.prepare('SELECT COUNT(*) AS n FROM ciqual').get().n || 0) : 0;
    return {
      available: hasAliments && count > 0,
      size_mb: info ? info.size_mb : null,
      updated_at: info ? info.updated_at : null,
      table: hasAliments ? 'aliments' : null,
      products: count,
      barcode_products: withBarcode,
      without_barcode: Math.max(0, count - withBarcode),
      code_column: codeColumn,
      scan_local: !!(codeColumn && withBarcode > 0),
      ciqual: ciqual > 0,
      ciqual_products: ciqual,
      db: info
    };
  } catch(e) {
    return { available: false, scan_local: false, error: e.message, db: info };
  } finally {
    try { if (dbOff) dbOff.close(); } catch(_) {}
  }
}

app.get('/api/off/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ products: [] });
  if (!fs.existsSync(OFF_DB)) {
    return res.status(503).json({ error: 'Base OpenFoodFacts non disponible — import en cours ou non lancé.' });
  }
  let dbOff = null;
  try {
    dbOff = openOffSqliteReadonly();
    if (!tableExistsSqlite(dbOff, 'aliments')) return res.json({ products: [], error: 'Table aliments absente dans off.db' });
    const cols = getOffColumnsSqlite(dbOff);
    const selectCode = cols.includes('code') ? 'code' : "NULL AS code";
    const stmt = dbOff.prepare(`
      SELECT ${selectCode}, nom, marque, kcal100, prot100, gluc100, lip100, fibres100
      FROM aliments
      WHERE nom LIKE ?
        AND kcal100 IS NOT NULL
        AND kcal100 > 0
        AND kcal100 < 1000
      ORDER BY
        CASE WHEN nom LIKE ? THEN 0 ELSE 1 END,
        CASE WHEN marque IS NOT NULL AND marque != '' THEN 0 ELSE 1 END,
        (CASE WHEN prot100 IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN gluc100 IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN lip100  IS NOT NULL THEN 1 ELSE 0 END) DESC,
        LENGTH(nom)
      LIMIT 15
    `);
    const rows = stmt.all('%' + q + '%', q + '%');
    const seen = new Map();
    const deduped = [];
    for (const r of rows) {
      const key = (r.code || '') || ((r.nom||'').toLowerCase().trim() + '|' + (r.marque||'').toLowerCase().trim());
      if (!seen.has(key)) { seen.set(key, true); deduped.push(r); }
    }
    res.json({ products: deduped.slice(0, 10), source: 'local', barcode_ready: cols.includes('code') });
  } catch(e) {
    res.status(500).json({ error: e.message });
  } finally {
    try { if (dbOff) dbOff.close(); } catch(_) {}
  }
});

app.get('/api/off/barcode/:code', (req, res) => {
  const raw = String(req.params.code || '').trim();
  const code = raw.replace(/[^0-9A-Za-z_-]/g, '');
  if (!code || code.length < 4) return res.status(400).json({ found: false, error: 'Code-barres invalide' });
  if (!fs.existsSync(OFF_DB)) return res.status(503).json({ found: false, error: 'Base OpenFoodFacts locale absente' });
  let dbOff = null;
  try {
    dbOff = openOffSqliteReadonly();
    if (!tableExistsSqlite(dbOff, 'aliments')) return res.json({ found: false, source: 'local', error: 'Table aliments absente' });
    const cols = getOffColumnsSqlite(dbOff);
    const codeColumn = ['code', 'barcode', 'ean', 'product_code'].find(c => cols.includes(c));
    if (!codeColumn) return res.json({ found: false, source: 'local', scan_local: false, error: 'La base locale ne contient pas de colonne code-barres. Réimporte OpenFoodFacts avec la v10.46.' });
    const product = dbOff.prepare(`
      SELECT ${codeColumn} AS code, nom, marque, kcal100, prot100, gluc100, lip100, fibres100
      FROM aliments
      WHERE ${codeColumn} = ?
      LIMIT 1
    `).get(code);
    if (!product) return res.json({ found: false, source: 'local', code, scan_local: true });
    res.json({ found: true, source: 'local', code, product });
  } catch(e) {
    res.status(500).json({ found: false, error: e.message });
  } finally {
    try { if (dbOff) dbOff.close(); } catch(_) {}
  }
});

app.get('/api/off/status', (req, res) => {
  res.json(getOffStatusSync());
});

// ── CIQUAL local search / status / import ────────────────────
const CIQUAL_JSON_FILES = [
  path.join(DATA_DIR, 'ciqual_data.json'),
  path.join(__dirname, 'ciqual_data.json')
];
const CIQUAL_XML_CANDIDATES = {
  alim: [path.join(DATA_DIR, 'alim.xml'), path.join(DATA_DIR, 'alim_2025_11_03.xml'), path.join(__dirname, 'alim.xml'), path.join(__dirname, 'alim_2025_11_03.xml')],
  compo: [path.join(DATA_DIR, 'compo.xml'), path.join(DATA_DIR, 'compo_2025_11_03.xml'), path.join(__dirname, 'compo.xml'), path.join(__dirname, 'compo_2025_11_03.xml')],
  grp: [path.join(DATA_DIR, 'grp.xml'), path.join(DATA_DIR, 'alim_grp_2025_11_03.xml'), path.join(__dirname, 'grp.xml'), path.join(__dirname, 'alim_grp_2025_11_03.xml')],
  const: [path.join(DATA_DIR, 'const.xml'), path.join(DATA_DIR, 'const_2025_11_03.xml'), path.join(__dirname, 'const.xml'), path.join(__dirname, 'const_2025_11_03.xml')],
};
let ciqualCache = null;
let ciqualProc = null;
let ciqualRunningKind = '';

function normalizeStr(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function firstExisting(paths) {
  return paths.find(f => fs.existsSync(f)) || null;
}
function fileInfo(file) {
  if (!file || !fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  return { path: file, size_mb: Math.round((st.size / 1024 / 1024) * 10) / 10, updated_at: st.mtime.toISOString() };
}
function getCiqualXmlStatus() {
  const alim = fileInfo(firstExisting(CIQUAL_XML_CANDIDATES.alim));
  const compo = fileInfo(firstExisting(CIQUAL_XML_CANDIDATES.compo));
  const grp = fileInfo(firstExisting(CIQUAL_XML_CANDIDATES.grp));
  const constFile = fileInfo(firstExisting(CIQUAL_XML_CANDIDATES.const));
  return {
    alim: !!alim,
    compo: !!compo,
    grp: !!grp,
    const: !!constFile,
    ready: !!(alim && compo),
    ready_strict: !!(alim && compo && constFile),
    files: { alim, compo, grp, const: constFile }
  };
}
function getCiqualJsonStatus() {
  for (const file of CIQUAL_JSON_FILES) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(raw);
      return { available: Array.isArray(data) && data.length > 0, count: Array.isArray(data) ? data.length : 0, file: fileInfo(file) };
    } catch(e) {
      return { available: false, count: 0, error: e.message, file: fileInfo(file) };
    }
  }
  return { available: false, count: 0, file: null };
}
async function getCiqualSqliteStatus() {
  if (!fs.existsSync(OFF_DB)) return { available: false, count: 0, db: null };
  try {
    const dbOff = await getSQLDB();
    const check = dbOff.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ciqual'");
    if (!check.length) { dbOff.close(); return { available: false, count: 0, db: fileInfo(OFF_DB) }; }
    const r = dbOff.exec("SELECT COUNT(*) FROM ciqual");
    const count = r.length > 0 ? Number(r[0].values[0][0] || 0) : 0;
    dbOff.close();
    return { available: count > 0, count, db: fileInfo(OFF_DB) };
  } catch(e) {
    return { available: false, count: 0, error: e.message, db: fileInfo(OFF_DB) };
  }
}
function foodnoteCiqualNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function foodnoteCiqualRound1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}
function foodnoteCiqualNormText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function foodnoteCiqualAllowsHighProtein(row) {
  const t = foodnoteCiqualNormText([row?.nom, row?.name, row?.groupe, row?.group].filter(Boolean).join(' '));
  return /\b(viande|boeuf|porc|veau|agneau|poulet|dinde|canard|jambon|charcut|poisson|thon|saumon|cabillaud|sardine|maquereau|crevette|crabe|moule|oeuf|fromage|lait|yaourt|skyr|quark|soja|tofu|tempeh|seitan|proteine|whey|lentille|pois chiche|haricot|feve|legumineuse|amande|noix|cacahuete|pistache|graine)\b/.test(t);
}

function sanitizeCiqualNutritionRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  let kcal = foodnoteCiqualNum(out.kcal100 ?? out.kcal);
  let p = foodnoteCiqualNum(out.prot100 ?? out.prot);
  let g = foodnoteCiqualNum(out.gluc100 ?? out.gluc);
  let l = foodnoteCiqualNum(out.lip100 ?? out.lip);
  const warnings = [];

  function setValue(key, value, reason) {
    out[key] = value;
    warnings.push(reason);
  }
  function clampMacro(key) {
    const v = foodnoteCiqualNum(out[key]);
    if (v < 0 || v > 100) setValue(key, 0, key + ' hors borne');
  }

  // CIQUAL expose l'énergie en kJ et kcal. Si une valeur > 950 arrive dans
  // kcal100, c'est quasi forcément du kJ importé comme kcal.
  if (kcal > 950) {
    setValue('kcal100', Math.round(kcal / 4.184), 'énergie CIQUAL kJ convertie en kcal');
    kcal = foodnoteCiqualNum(out.kcal100 ?? out.kcal);
  }

  ['prot100', 'gluc100', 'lip100', 'fibres100'].forEach(clampMacro);
  if (foodnoteCiqualNum(out.sel100) < 0 || foodnoteCiqualNum(out.sel100) > 100) out.sel100 = 0;

  kcal = foodnoteCiqualNum(out.kcal100 ?? out.kcal);
  p = foodnoteCiqualNum(out.prot100 ?? out.prot);
  g = foodnoteCiqualNum(out.gluc100 ?? out.gluc);
  l = foodnoteCiqualNum(out.lip100 ?? out.lip);
  const highProteinOk = foodnoteCiqualAllowsHighProtein(out);

  // Exemple corrigé : tarte aux abricots avec 41,5 g de prot/100g.
  // Sur un aliment non protéique, une protéine >35 g est presque toujours un champ mal mappé.
  if (p > 35 && !highProteinOk) {
    const divided = foodnoteCiqualRound1(p / 10);
    if (kcal >= 120 && g >= 10 && l >= 1 && divided <= 8) {
      setValue('prot100', divided, 'protéines CIQUAL ramenées à une valeur plausible');
      p = divided;
    } else {
      setValue('prot100', 0, 'protéines CIQUAL incohérentes corrigées');
      p = 0;
    }
  }

  let macroKcal = p * 4 + g * 4 + l * 9;
  const limit = kcal > 0 ? Math.max(kcal * 1.35 + 80, kcal + 160) : 0;

  if (kcal > 0 && macroKcal > limit && p > 30 && !highProteinOk) {
    setValue('prot100', 0, 'protéines CIQUAL incohérentes corrigées');
    p = 0;
    macroKcal = g * 4 + l * 9;
  }
  if (kcal > 0 && macroKcal > limit && g > 90) {
    setValue('gluc100', 0, 'glucides CIQUAL incohérents corrigés');
    g = 0;
    macroKcal = p * 4 + l * 9;
  }
  if (kcal > 0 && macroKcal > limit && l > 70) {
    setValue('lip100', 0, 'lipides CIQUAL incohérents corrigés');
  }
  if (warnings.length) out.ciqual_warning = Array.from(new Set(warnings)).join(' · ');
  return out;
}

function sanitizeCiqualNutritionRows(rows) {
  return Array.isArray(rows) ? rows.map(sanitizeCiqualNutritionRow) : rows;
}

async function searchCiqualSqlite(q) {
  if (!fs.existsSync(OFF_DB)) return null;
  const dbOff = await getSQLDB();
  const check = dbOff.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ciqual'");
  if (!check.length) { dbOff.close(); return null; }
  const stmt = dbOff.prepare(
    'SELECT nom, groupe, kcal100, prot100, gluc100, lip100, fibres100, sel100 FROM ciqual WHERE nom LIKE ? ORDER BY CASE WHEN nom LIKE ? THEN 0 ELSE 1 END, LENGTH(nom) LIMIT 20'
  );
  const rows = [];
  stmt.bind(['%' + q + '%', q + '%']);
  while (stmt.step()) rows.push(sanitizeCiqualNutritionRow(stmt.getAsObject()));
  stmt.free(); dbOff.close();
  return rows;
}
function loadCiqualJsonCache() {
  const file = firstExisting(CIQUAL_JSON_FILES);
  if (!file) return [];
  if (!ciqualCache || ciqualCache.length === 0) {
    ciqualCache = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log('CIQUAL JSON chargé:', ciqualCache.length, 'aliments');
  }
  return ciqualCache;
}

app.get('/api/ciqual/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ products: [] });
  try {
    const sqliteRows = await searchCiqualSqlite(q);
    if (sqliteRows && sqliteRows.length) return res.json({ products: sqliteRows, source: 'sqlite' });
    const nq = normalizeStr(q);
    const rows = loadCiqualJsonCache()
      .filter(a => a.nom && normalizeStr(a.nom).includes(nq))
      .slice(0, 20)
      .map(sanitizeCiqualNutritionRow);
    res.json({ products: rows, source: rows.length ? 'json' : 'none' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ciqual/data', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const sqliteRows = await searchCiqualSqlite(q);
    if (sqliteRows && sqliteRows.length) return res.json(sqliteRows);
    const nq = normalizeStr(q);
    const results = loadCiqualJsonCache()
      .filter(a => a.nom && normalizeStr(a.nom).includes(nq))
      .slice(0, 20)
      .map(sanitizeCiqualNutritionRow);
    res.json(results);
  } catch(e) {
    console.error('CIQUAL erreur:', e.message);
    res.json([]);
  }
});

app.get('/api/ciqual/status', async (req, res) => {
  try {
    const sqlite = await getCiqualSqliteStatus();
    const json = getCiqualJsonStatus();
    const xml = getCiqualXmlStatus();
    const available = sqlite.available || json.available;
    res.json({
      available,
      source: sqlite.available ? 'sqlite' : (json.available ? 'json' : 'none'),
      count: sqlite.available ? sqlite.count : json.count,
      sqlite,
      json,
      xml,
      can_import: xml.ready,
      can_update: !!getCiqualUpdateScript(),
      running: isCiqualOperationRunning(),
      manual_download_required: !xml.ready && !getCiqualUpdateScript(),
      xml_provided: xml.ready,
      auto_import_enabled: process.env.FOODNOTE_CIQUAL_AUTO_IMPORT !== '0',
      import_button_useful: xml.ready,
      update_button_useful: !!getCiqualUpdateScript(),
      import_script_available: !!getCiqualImportScript(),
      download_script_available: !!getCiqualDownloadScript(),
      update_script_available: !!getCiqualUpdateScript(),
      message: available
        ? 'Base CIQUAL disponible localement.'
        : (xml.ready ? (xml.const ? 'Fichiers XML CIQUAL détectés : import automatique au démarrage ou import manuel possible.' : 'Fichiers CIQUAL détectés sans const.xml : import possible en mode secours, mais const.xml est recommandé pour éviter les erreurs de mapping.') : 'Base CIQUAL absente : les XML officiels peuvent être téléchargés dans /data ou copiés manuellement (alim.xml, compo.xml et idéalement const.xml).')
    });
  } catch(e) {
    res.json({ available: false, source: 'none', count: 0, error: e.message, xml: getCiqualXmlStatus(), running: isCiqualOperationRunning() });
  }
});

function getCiqualLogFile() { return path.join(DATA_DIR, 'ciqual_update.log'); }
function getCiqualPidFile() { return path.join(DATA_DIR, 'ciqual_update.pid'); }
function isCiqualOperationRunning() {
  if (ciqualProc && ciqualProc.exitCode === null && ciqualProc.signalCode === null) return true;
  const pidFile = getCiqualPidFile();
  try {
    if (!fs.existsSync(pidFile)) return false;
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (_) { try { fs.unlinkSync(pidFile); } catch(e) {} return false; }
  } catch(e) { return false; }
}
function appendCiqualLog(line) {
  const logFile = getCiqualLogFile();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(logFile, '[' + new Date().toISOString() + '] ' + line + '\n', { flag: 'a' });
  } catch(e) {
    console.error('CIQUAL log erreur:', e.message);
  }
}

function getCiqualImportScript() {
  const candidates = [
    path.join('/app', 'import_ciqual.py'),
    path.join(__dirname, 'import_ciqual.py')
  ];
  return candidates.find(f => fs.existsSync(f)) || null;
}

function getCiqualDownloadScript() {
  const candidates = [
    path.join('/app', 'download_ciqual.py'),
    path.join(__dirname, 'download_ciqual.py')
  ];
  return candidates.find(f => fs.existsSync(f)) || null;
}

function getCiqualUpdateScript() {
  const candidates = [
    path.join('/app', 'update_ciqual.sh'),
    path.join(__dirname, 'update_ciqual.sh')
  ];
  return candidates.find(f => fs.existsSync(f)) || null;
}


function startCiqualProcess(kind, command, args, cwd) {
  if (isCiqualOperationRunning()) return { ok: false, running: true, error: 'Opération CIQUAL déjà en cours' };
  const { spawn } = require('child_process');
  const logFile = getCiqualLogFile();
  const pidFile = getCiqualPidFile();
  const title = kind === 'update' ? 'Mise à jour CIQUAL' : 'Import CIQUAL';
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(logFile,
      'FoodNote — ' + title + ' depuis l’interface\n' +
      'Début : ' + new Date().toISOString() + '\n' +
      'Commande : ' + [command].concat(args || []).join(' ') + '\n\n'
    );
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');
    ciqualRunningKind = kind;
    ciqualProc = spawn(command, args || [], {
      cwd: cwd || '/app',
      env: { ...process.env, DATA_DIR },
      detached: false,
      stdio: ['ignore', out, err]
    });
    fs.writeFileSync(pidFile, String(ciqualProc.pid));
    ciqualProc.on('exit', (code, signal) => {
      try { fs.appendFileSync(logFile, '\nFin : ' + new Date().toISOString() + ' | code=' + code + ' signal=' + (signal || '') + '\n'); } catch(e) {}
      try { fs.unlinkSync(pidFile); } catch(e) {}
      try { fs.closeSync(out); } catch(e) {}
      try { fs.closeSync(err); } catch(e) {}
      ciqualCache = null;
      ciqualRunningKind = '';
      ciqualProc = null;
    });
    ciqualProc.on('error', (e) => {
      try { fs.appendFileSync(logFile, '\nERREUR lancement CIQUAL : ' + e.message + '\n'); } catch(_) {}
      try { fs.unlinkSync(pidFile); } catch(_) {}
      ciqualRunningKind = '';
      ciqualProc = null;
    });
    return { ok: true, running: true, kind, pid: ciqualProc.pid, log: '/api/ciqual/log' };
  } catch(e) {
    ciqualRunningKind = '';
    ciqualProc = null;
    return { ok: false, status: 500, error: e.message };
  }
}

function startCiqualImport(reason = 'manual') {
  const xml = getCiqualXmlStatus();
  if (!xml.ready) {
    return {
      ok: false,
      status: 400,
      error: 'Fichiers CIQUAL manquants : alim.xml et compo.xml doivent être présents dans /data ou téléchargés avec le bouton CIQUAL.',
      xml
    };
  }
  const script = getCiqualImportScript();
  if (!script) return { ok: false, status: 500, error: 'Script import_ciqual.py introuvable dans /app.', xml };
  return startCiqualProcess('import', 'python3', [script, '--data-dir', DATA_DIR], path.dirname(script));
}

function startCiqualUpdate(reason = 'manual') {
  const script = getCiqualUpdateScript();
  if (!script) return { ok: false, status: 500, error: 'Script update_ciqual.sh introuvable dans /app.' };
  return startCiqualProcess('update', 'sh', [script], path.dirname(script));
}

async function maybeAutoImportCiqualOnStartup() {
  if (process.env.FOODNOTE_CIQUAL_AUTO_IMPORT === '0') {
    appendCiqualLog('Import CIQUAL automatique désactivé par FOODNOTE_CIQUAL_AUTO_IMPORT=0');
    return;
  }
  const xml = getCiqualXmlStatus();
  if (!xml.ready) return;
  const sqlite = await getCiqualSqliteStatus();
  if (sqlite.available) return;
  const result = startCiqualImport('auto');
  if (!result.ok) appendCiqualLog('Import CIQUAL automatique impossible : ' + result.error);
}

app.post('/api/ciqual/import', (req, res) => {
  const result = startCiqualImport('manual');
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

app.post('/api/ciqual/update', (req, res) => {
  const result = startCiqualUpdate('manual');
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

app.get('/api/ciqual/log', (req, res) => {
  const logFile = path.join(DATA_DIR, 'ciqual_update.log');
  try {
    if (!fs.existsSync(logFile)) return res.json({ log: 'Aucun log disponible.', running: isCiqualOperationRunning() });
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n');
    res.json({ log: lines, running: isCiqualOperationRunning() });
  } catch(e) { res.json({ log: e.message, running: false }); }
});



// ── Profile / Settings / Phases SQLite ─────────────────────
function profileDefault() {
  return { prenom:'', phaseLabel:'Mon suivi nutritionnel', cibleKcal:2000, cibleProt:120, cibleGluc:220, cibleLip:70 };
}

app.get('/api/profile', requireUser, (req, res) => {
  try {
    const row = db.prepare('SELECT data_json, updated_at FROM profiles WHERE user_id=?').get(req.foodnoteUserId);
    if (!row) return res.json({ user_id:req.foodnoteUserId, exists:false, profile:profileDefault(), updated_at:null });
    res.json({ user_id:req.foodnoteUserId, exists:true, profile:safeJsonParse(row.data_json, profileDefault()), updated_at:row.updated_at });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/profile', requireUser, (req, res) => {
  try {
    const profile = req.body && req.body.profile ? req.body.profile : req.body;
    if (!profile || typeof profile !== 'object') return res.status(400).json({ error:'Profil invalide' });
    const displayName = profile.prenom || profile.name || null;
    ensureUser(req.foodnoteUserId, displayName);
    db.prepare(`
      INSERT INTO profiles (user_id, data_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP
    `).run(req.foodnoteUserId, JSON.stringify(profile, null, 2));
    if (displayName) {
      db.prepare('UPDATE users SET display_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(displayName, req.foodnoteUserId);
    }
    // Si le profil contient le programme de phases, on le garde aussi dans la table phases.
    if (Array.isArray(profile.phases)) {
      db.prepare('DELETE FROM phases WHERE user_id=?').run(req.foodnoteUserId);
      const ins = db.prepare(`
        INSERT INTO phases (user_id, name, weeks, kcal_target, prot_target, gluc_target, lip_target, order_index, raw_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const tx = db.transaction((items) => {
        items.forEach((ph, idx) => ins.run(
          req.foodnoteUserId,
          ph.label || ph.name || ph.id || ('Phase ' + (idx+1)),
          Number(ph.weeks || 1),
          ph.kcalTarget ?? ph.cibleKcal ?? null,
          ph.protTarget ?? ph.cibleProt ?? null,
          ph.glucTarget ?? ph.cibleGluc ?? null,
          ph.lipTarget ?? ph.cibleLip ?? null,
          idx,
          JSON.stringify(ph)
        ));
      });
      tx(profile.phases);
    }
    res.json({ ok:true, user_id:req.foodnoteUserId, profile });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/settings', requireUser, (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value_json, updated_at FROM settings WHERE user_id=? ORDER BY key').all(req.foodnoteUserId);
    const settings = {};
    for (const r of rows) settings[r.key] = safeJsonParse(r.value_json, null);
    res.json({ user_id:req.foodnoteUserId, settings });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/settings/:key', requireUser, (req, res) => {
  try {
    const row = db.prepare('SELECT value_json, updated_at FROM settings WHERE user_id=? AND key=?').get(req.foodnoteUserId, req.params.key);
    if (!row) return res.json({ user_id:req.foodnoteUserId, key:req.params.key, exists:false, value:null });
    res.json({ user_id:req.foodnoteUserId, key:req.params.key, exists:true, value:safeJsonParse(row.value_json, null), updated_at:row.updated_at });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/settings/:key', requireUser, (req, res) => {
  try {
    const value = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : req.body;
    db.prepare(`
      INSERT INTO settings (user_id, key, value_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP
    `).run(req.foodnoteUserId, req.params.key, JSON.stringify(value));
    res.json({ ok:true, user_id:req.foodnoteUserId, key:req.params.key, value });
  } catch(e) { res.status(500).json({ error:e.message }); }
});


app.post('/api/admin/repair-profile-targets', requireUser, (req, res) => {
  try {
    const payload = buildProfileResponseForUser(req.foodnoteUserId);
    syncActivePhaseTargetSnapshot(req.foodnoteUserId, payload.profile);
    const refreshed = buildProfileResponseForUser(req.foodnoteUserId);
    res.json({ ok:true, user_id:req.foodnoteUserId, profile:refreshed.profile, targets:refreshed.targets, phases:refreshed.phases });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/phases', requireUser, (req, res) => {
  try {
    const rows = db.prepare('SELECT raw_json FROM phases WHERE user_id=? ORDER BY order_index, id').all(req.foodnoteUserId);
    const phases = rows.map(r => safeJsonParse(r.raw_json, null)).filter(Boolean);
    res.json({ user_id:req.foodnoteUserId, phases });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/phases', requireUser, (req, res) => {
  try {
    const phases = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.phases) ? req.body.phases : []);
    db.prepare('DELETE FROM phases WHERE user_id=?').run(req.foodnoteUserId);
    const ins = db.prepare(`
      INSERT INTO phases (user_id, name, weeks, kcal_target, prot_target, gluc_target, lip_target, order_index, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const tx = db.transaction((items) => {
      items.forEach((ph, idx) => ins.run(
        req.foodnoteUserId,
        ph.label || ph.name || ph.id || ('Phase ' + (idx+1)),
        Number(ph.weeks || 1),
        ph.kcalTarget ?? ph.cibleKcal ?? null,
        ph.protTarget ?? ph.cibleProt ?? null,
        ph.glucTarget ?? ph.cibleGluc ?? null,
        ph.lipTarget ?? ph.cibleLip ?? null,
        idx,
        JSON.stringify(ph)
      ));
    });
    tx(phases);
    const profRow = db.prepare('SELECT data_json FROM profiles WHERE user_id=?').get(req.foodnoteUserId);
    if (profRow) {
      const profile = safeJsonParse(profRow.data_json, profileDefault());
      profile.phases = phases;
      profile.phaseLabel = phases.length ? phases.map(ph => (ph.label || ph.name || ph.id) + ' (' + (ph.weeks || 1) + 'sem)').join(' → ') : (profile.phaseLabel || '');
      db.prepare('UPDATE profiles SET data_json=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(JSON.stringify(profile, null, 2), req.foodnoteUserId);
      const saved = persistProfileWithTargets(req.foodnoteUserId, profile, 'phases_save').profile;
      syncActivePhaseTargetSnapshot(req.foodnoteUserId, saved);
    }
    res.json({ ok:true, user_id:req.foodnoteUserId, phases:getPhasesForUser(req.foodnoteUserId), targets:getProfileTargetsForUser(req.foodnoteUserId) });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── OFF update & log ─────────────────────────────────────────
let offUpdateRunning = false;
let offUpdateProc = null;
function isOffUpdateRunning() {
  if (offUpdateProc && offUpdateProc.exitCode === null && offUpdateProc.signalCode === null) return true;
  const pidFile = path.join(DATA_DIR, 'off_update.pid');
  try {
    if (!fs.existsSync(pidFile)) return false;
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (_) { try { fs.unlinkSync(pidFile); } catch(e) {} return false; }
  } catch(e) { return false; }
}
function startOffUpdate(req, res) {
  if (offUpdateRunning || isOffUpdateRunning()) {
    return res.json({ ok: false, running: true, error: 'Mise à jour OpenFoodFacts déjà en cours' });
  }
  const { spawn } = require('child_process');
  const logFile = path.join(DATA_DIR, 'off_update.log');
  const pidFile = path.join(DATA_DIR, 'off_update.pid');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(logFile,
      'FoodNote v10.54 — lancement OpenFoodFacts depuis l’interface\n' +
      'Commande équivalente : docker exec journal-nutrition sh /app/update_off.sh\n' +
      'Début : ' + new Date().toISOString() + '\n\n'
    );
    offUpdateRunning = true;
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');
    offUpdateProc = spawn('sh', ['/app/update_off.sh'], {
      cwd: '/app',
      env: { ...process.env, DATA_DIR },
      detached: false,
      stdio: ['ignore', out, err]
    });
    fs.writeFileSync(pidFile, String(offUpdateProc.pid));
    offUpdateProc.on('exit', (code, signal) => {
      offUpdateRunning = false;
      try { fs.appendFileSync(logFile, '\nFin : ' + new Date().toISOString() + ' | code=' + code + ' signal=' + (signal || '') + '\n'); } catch(e) {}
      try { fs.unlinkSync(pidFile); } catch(e) {}
      try { fs.closeSync(out); } catch(e) {}
      try { fs.closeSync(err); } catch(e) {}
    });
    offUpdateProc.on('error', (e) => {
      offUpdateRunning = false;
      try { fs.appendFileSync(logFile, '\nERREUR lancement UI : ' + e.message + '\n'); } catch(_) {}
      try { fs.unlinkSync(pidFile); } catch(_) {}
    });
    res.json({ ok: true, running: true, pid: offUpdateProc.pid, log: '/api/off/log' });
  } catch(e) {
    offUpdateRunning = false;
    res.status(500).json({ ok:false, error:e.message });
  }
}
app.post('/api/off/update', startOffUpdate);
app.get('/api/off/update', startOffUpdate);

app.get('/api/off/log', (req, res) => {
  const logFile = path.join(DATA_DIR, 'off_update.log');
  try {
    const running = offUpdateRunning || isOffUpdateRunning();
    if (!fs.existsSync(logFile)) return res.json({ log: 'Aucun log disponible.', running });
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').slice(-120).join('\n');
    res.json({ log: lines, running });
  } catch(e) { res.json({ log: e.message, running: false }); }
});

// ── Groq proxy + clé persistée SQLite optionnelle ────────────────────────
const GROQ_SECRET_KEY = 'groq_api_key';

function foodnoteEnvFlagEnabled(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(v);
}

function foodnoteGroqSqliteSecretStorageEnabled() {
  return foodnoteEnvFlagEnabled(
    process.env.FOODNOTE_ALLOW_UI_SECRET_STORAGE ||
    process.env.FOODNOTE_ENABLE_SQLITE_SECRETS ||
    process.env.FOODNOTE_ALLOW_SQLITE_SECRETS ||
    ''
  );
}

function foodnoteCleanGroqKey(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

function foodnoteMaskSecret(value) {
  const key = foodnoteCleanGroqKey(value);
  if (!key) return '';
  if (key.length <= 12) return key.slice(0, 3) + '…';
  return key.slice(0, 6) + '…' + key.slice(-4);
}

function foodnoteReadStoredGroqKey(userId) {
  if (!foodnoteGroqSqliteSecretStorageEnabled()) {
    return { key: '', source: 'sqlite_disabled' };
  }

  try {
    const row = db.prepare('SELECT value FROM secrets WHERE user_id=? AND key=?').get(userId, GROQ_SECRET_KEY);
    const key = foodnoteCleanGroqKey(row?.value);
    if (key) return { key, source: 'sqlite' };
  } catch (_) {}

  // Compatibilité : si une ancienne version a écrit la clé dans settings, on la récupère
  // seulement quand le stockage SQLite des secrets est explicitement activé.
  try {
    const row = db.prepare('SELECT value_json FROM settings WHERE user_id=? AND key=?').get(userId, GROQ_SECRET_KEY);
    const parsed = row ? safeJsonParse(row.value_json, null) : null;
    const legacyKey = foodnoteCleanGroqKey(typeof parsed === 'string' ? parsed : (parsed?.key || parsed?.value || ''));
    if (legacyKey) {
      foodnoteWriteStoredGroqKey(userId, legacyKey);
      db.prepare('DELETE FROM settings WHERE user_id=? AND key=?').run(userId, GROQ_SECRET_KEY);
      return { key: legacyKey, source: 'sqlite' };
    }
  } catch (_) {}

  return { key: '', source: 'none' };
}

function foodnoteWriteStoredGroqKey(userId, key) {
  if (!foodnoteGroqSqliteSecretStorageEnabled()) {
    const err = new Error('Stockage SQLite des clés IA désactivé. Configure GROQ_API_KEY dans Docker ou active FOODNOTE_ALLOW_UI_SECRET_STORAGE=1.');
    err.statusCode = 403;
    throw err;
  }
  const clean = foodnoteCleanGroqKey(key);
  if (!clean) throw new Error('Clé Groq vide.');
  db.prepare(`
    INSERT INTO secrets (user_id, key, value, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).run(userId, GROQ_SECRET_KEY, clean);
  return clean;
}

function foodnoteResolveGroqApiKey(userId) {
  const storageEnabled = foodnoteGroqSqliteSecretStorageEnabled();
  const envKey = foodnoteCleanGroqKey(process.env.GROQ_API_KEY || process.env.GROQ_KEY || '');
  if (envKey) {
    return { key: envKey, source: 'env', configured: true, masked: foodnoteMaskSecret(envKey), storage_enabled: storageEnabled };
  }
  const stored = foodnoteReadStoredGroqKey(userId || DEFAULT_USER_ID);
  if (stored.key) {
    return { key: stored.key, source: stored.source, configured: true, masked: foodnoteMaskSecret(stored.key), storage_enabled: storageEnabled };
  }
  return { key: '', source: stored.source === 'sqlite_disabled' ? 'sqlite_disabled' : 'none', configured: false, masked: '', storage_enabled: storageEnabled };
}

function foodnoteGroqPublicStatus(userId) {
  const resolved = foodnoteResolveGroqApiKey(userId);
  const storageEnabled = !!resolved.storage_enabled;
  let message = 'Aucune clé Groq configurée côté serveur.';
  if (resolved.configured) {
    message = resolved.source === 'env'
      ? 'Clé Groq fournie par GROQ_API_KEY/GROQ_KEY.'
      : 'Clé Groq persistée dans SQLite.';
  } else if (!storageEnabled) {
    message = 'Stockage SQLite des clés IA désactivé. Configure GROQ_API_KEY dans Docker ou active FOODNOTE_ALLOW_UI_SECRET_STORAGE=1.';
  }
  return {
    ok: true,
    configured: !!resolved.configured,
    source: resolved.source,
    masked: resolved.masked || '',
    storage_enabled: storageEnabled,
    can_save_key: storageEnabled && resolved.source !== 'env',
    recommended: 'GROQ_API_KEY',
    enable_flag: 'FOODNOTE_ALLOW_UI_SECRET_STORAGE=1',
    message
  };
}

app.get('/api/groq/key/status', requireUser, (req, res) => {
  try { res.json(foodnoteGroqPublicStatus(req.foodnoteUserId)); }
  catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/groq/key', requireUser, (req, res) => {
  try {
    if (!foodnoteGroqSqliteSecretStorageEnabled()) {
      return res.status(403).json({
        ok:false,
        error:'Stockage SQLite des clés IA désactivé. Configure GROQ_API_KEY dans Docker ou active FOODNOTE_ALLOW_UI_SECRET_STORAGE=1.',
        storage_enabled:false,
        enable_flag:'FOODNOTE_ALLOW_UI_SECRET_STORAGE=1'
      });
    }
    const key = foodnoteCleanGroqKey(req.body?.key || req.body?.value || '');
    if (!key) return res.status(400).json({ ok:false, error:'Clé Groq vide.' });
    if (!/^gsk_[A-Za-z0-9_-]{10,}/.test(key)) {
      return res.status(400).json({ ok:false, error:'Format de clé Groq invalide ou incomplet.' });
    }
    foodnoteWriteStoredGroqKey(req.foodnoteUserId, key);
    res.json(foodnoteGroqPublicStatus(req.foodnoteUserId));
  } catch (e) { res.status(e.statusCode || 500).json({ ok:false, error:e.message }); }
});

app.delete('/api/groq/key', requireUser, (req, res) => {
  try {
    db.prepare('DELETE FROM secrets WHERE user_id=? AND key=?').run(req.foodnoteUserId, GROQ_SECRET_KEY);
    db.prepare('DELETE FROM settings WHERE user_id=? AND key=?').run(req.foodnoteUserId, GROQ_SECRET_KEY);
    res.json(foodnoteGroqPublicStatus(req.foodnoteUserId));
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post(['/api/groq', '/api/groq/chat'], requireUser, async (req, res) => {
  try {
    const resolvedKey = foodnoteResolveGroqApiKey(req.foodnoteUserId);
    const apiKey = resolvedKey.key;
    if (!apiKey) {
      return res.status(400).json({
        error: resolvedKey.storage_enabled
          ? 'Clé Groq absente côté serveur. Enregistre-la dans IA > Clé API Groq, ou configure GROQ_API_KEY dans Docker.'
          : 'Clé Groq absente côté serveur. Configure GROQ_API_KEY dans Docker, ou active FOODNOTE_ALLOW_UI_SECRET_STORAGE=1 pour autoriser la sauvegarde SQLite depuis l’interface.',
        storage_enabled: !!resolvedKey.storage_enabled,
        enable_flag: 'FOODNOTE_ALLOW_UI_SECRET_STORAGE=1'
      });
    }
    const body = req.body || {};
    const messages = Array.isArray(body.messages)
      ? body.messages
      : [{ role: 'user', content: String(body.prompt || body.text || body.content || '') }];
    if (!messages.length || !messages.some(m => String(m.content || '').trim())) {
      return res.status(400).json({ error: 'Message Groq vide.' });
    }
    const payload = {
      model: body.model || 'llama-3.1-8b-instant',
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens || body.maxTokens || 700,
    };
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const txt = await response.text();
    let data;
    try { data = JSON.parse(txt); } catch (_) { data = { raw: txt }; }
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || data?.error || txt || 'Erreur Groq',
        details: data,
        source: resolvedKey.source
      });
    }
    res.json(data);
  } catch (e) {
    console.error('Groq proxy erreur:', e);
    res.status(500).json({ error: e.message });
  }
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

foodnoteMqttEnsureStarted();

app.listen(PORT, () => {
  console.log(`Serveur FoodNote SQLite démarré sur le port ${PORT} — DB ${DB_FILE}`);
  setTimeout(() => {
    maybeAutoImportCiqualOnStartup().catch(e => console.error('CIQUAL auto import erreur:', e.message));
  }, 1500);
  setTimeout(() => {
    checkAutoBackupSchedule().catch(e => console.error('[FoodNote AutoBackup] check startup:', e.message));
  }, 5000);
  setInterval(() => {
    checkAutoBackupSchedule().catch(e => console.error('[FoodNote AutoBackup] check interval:', e.message));
  }, 5 * 60 * 1000);
});
