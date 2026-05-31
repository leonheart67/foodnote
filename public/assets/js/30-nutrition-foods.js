/*
 * FoodNote — moteur nutrition et aliments du journal.
 * Rôle : calculer les macros, gérer les listes d'aliments affichées dans le Journal,
 *        les lignes repas, les unités, l'OCR nutritionnel et les passerelles historiques encore nécessaires.
 * Gère : calculs /100g, quantités, rendu des lignes alimentaires, validation nutritionnelle côté interface.
 * Ne doit pas gérer : navigation générale, stockage SQLite direct, import CIQUAL/OpenFoodFacts,
 *                    ni orchestration globale du popup Ajouter quand un module dédié existe.
 */
function getMacros(a, qty) {
  // Invariant moteur : un calcul nutritionnel ne doit jamais planter si une ligne UI
  // vient d'être supprimée ou si un handler DOM arrive en retard. Une ligne absente
  // vaut 0 et ne déclenche aucun autosave global.
  if (!a || typeof a !== 'object') return {kcal:0, prot:0, gluc:0, lip:0};
  const q = Number(qty) || 0;
  if (a.kcalU !== undefined) return {kcal:(Number(a.kcalU)||0)*q, prot:(Number(a.protU)||0)*q, gluc:(Number(a.glucU)||0)*q, lip:(Number(a.lipU)||0)*q};
  // Compatibilité ancien format (kcalPer100) et nouveau (kcal100)
  // Pour les fruits/œufs/etc., qty peut être un nombre d'unités : on convertit alors en grammes via poidsUnite.
  const k = Number(a.kcal100 ?? a.kcalPer100 ?? 0) || 0;
  const p = Number(a.prot100 ?? a.protPer100 ?? 0) || 0;
  const g = Number(a.gluc100 ?? a.glucPer100 ?? 0) || 0;
  const l = Number(a.lip100 ?? a.lipPer100 ?? 0) || 0;
  const grams = getEffectiveGrams(a, q);
  const f = grams / 100;
  return {kcal:k*f, prot:p*f, gluc:g*f, lip:l*f};
}

function round1(v) { return Math.round((Number(v) || 0) * 10) / 10; }

/* v11.86 — Garde-fou nutrition : bloque les valeurs impossibles et signale les valeurs suspectes */
const FOODNOTE_NUTRITION_GUARD = {
  maxKcal100Block: 950,
  warnKcal100: 700,
  maxMacro100Block: 100,
  maxMacroSumBlock: 105,
  warnProt100: 50,
  warnGluc100: 90,
  warnLip100: 70,
  kcalMacroRelWarn: 0.60,
  kcalMacroAbsWarn: 80,
  unitWeightWarn: 1000,
  unitWeightBlock: 5000,
  lineGramsWarn: 2000,
  lineGramsBlock: 5000,
  lineKcalWarn: 4000,
  dayKcalWarn: 8000
};

function foodnoteGuardNum(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function foodnoteGuardUnitWeightOrNull(raw) {
  // 0, vide ou non renseigné = pas de poids/unité.
  // On ne bloque que les vrais poids aberrants (> seuil), pas les aliments en grammes.
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function foodnoteGuardFoodLabel(food) {
  return String(food?.nom || food?.name || food?.label || 'Aliment').trim() || 'Aliment';
}

function foodnoteGuardIssueText(issues) {
  return (issues || []).map(i => '• ' + i.message).join('\n');
}

function foodnoteNutritionCheckFood100(food, opts = {}) {
  const cfg = FOODNOTE_NUTRITION_GUARD;
  const name = foodnoteGuardFoodLabel(food);
  const kcal = foodnoteGuardNum(food?.kcal100 ?? food?.kcalPer100 ?? food?.kcal_100g);
  const prot = foodnoteGuardNum(food?.prot100 ?? food?.protPer100 ?? food?.proteins_100g);
  const gluc = foodnoteGuardNum(food?.gluc100 ?? food?.glucPer100 ?? food?.carbohydrates_100g);
  const lip  = foodnoteGuardNum(food?.lip100  ?? food?.lipPer100  ?? food?.fat_100g);
  const unitWeightRaw = food?.poidsUnite ?? food?.poids_unite ?? food?.unitWeight ?? food?.unit_weight;
  const unitWeight = foodnoteGuardUnitWeightOrNull(unitWeightRaw);
  const block = [];
  const warn = [];

  [['kcal/100g', kcal], ['protéines/100g', prot], ['glucides/100g', gluc], ['lipides/100g', lip]].forEach(([label, val]) => {
    if (val < 0) block.push({message:`${name} : ${label} ne peut pas être négatif.`});
  });

  if (kcal > cfg.maxKcal100Block) block.push({message:`${name} : ${Math.round(kcal)} kcal/100g est impossible. Maximum théorique ≈ 900 kcal/100g.`});
  if (prot > cfg.maxMacro100Block) block.push({message:`${name} : protéines > 100g/100g impossible.`});
  if (gluc > cfg.maxMacro100Block) block.push({message:`${name} : glucides > 100g/100g impossible.`});
  if (lip > cfg.maxMacro100Block) block.push({message:`${name} : lipides > 100g/100g impossible.`});
  const macroSum = prot + gluc + lip;
  if (macroSum > cfg.maxMacroSumBlock) block.push({message:`${name} : protéines + glucides + lipides = ${round1(macroSum)}g/100g, trop haut.`});

  if (unitWeight !== null) {
    if (unitWeight > cfg.unitWeightBlock) block.push({message:`${name} : 1 unité = ${Math.round(unitWeight)}g, valeur aberrante.`});
    else if (unitWeight > cfg.unitWeightWarn) warn.push({message:`${name} : 1 unité = ${Math.round(unitWeight)}g, vérifie le poids par unité.`});
  }

  if (!block.length) {
    if (kcal > cfg.warnKcal100) warn.push({message:`${name} : ${Math.round(kcal)} kcal/100g est très élevé. Possible pour huile/noix/beurre, mais à vérifier.`});
    if (prot > cfg.warnProt100) warn.push({message:`${name} : ${round1(prot)}g protéines/100g est très élevé.`});
    if (gluc > cfg.warnGluc100) warn.push({message:`${name} : ${round1(gluc)}g glucides/100g est très élevé.`});
    if (lip > cfg.warnLip100) warn.push({message:`${name} : ${round1(lip)}g lipides/100g est très élevé.`});

    const kcalFromMacros = prot * 4 + gluc * 4 + lip * 9;
    if (kcal > 30 && kcalFromMacros > 30) {
      const diff = Math.abs(kcal - kcalFromMacros);
      const rel = diff / Math.max(kcal, kcalFromMacros);
      if (diff > cfg.kcalMacroAbsWarn && rel > cfg.kcalMacroRelWarn) {
        warn.push({message:`${name} : calories incohérentes avec les macros (${Math.round(kcal)} kcal affichées vs ≈ ${Math.round(kcalFromMacros)} kcal calculées).`});
      }
    }
  }

  return {ok: !block.length, block, warn};
}

function foodnoteNutritionCheckFoodLine(food, qty, opts = {}) {
  const cfg = FOODNOTE_NUTRITION_GUARD;
  if (!food || typeof food !== 'object') return {ok:true, block:[], warn:[], missing:true};
  const name = foodnoteGuardFoodLabel(food);
  const q = foodnoteGuardNum(qty);
  const block = [];
  const warn = [];
  if (q < 0) block.push({message:`${name} : quantité négative impossible.`});
  let grams = q;
  try {
    grams = (typeof getEffectiveGrams === 'function') ? getEffectiveGrams(food, q) : q;
  } catch(_) {}
  const m = (typeof getMacros === 'function') ? getMacros(food, q) : {kcal: 0};
  const kcal = Number(m?.kcal || 0) || 0;
  if (grams > cfg.lineGramsBlock) block.push({message:`${name} : quantité ≈ ${Math.round(grams)}g, valeur aberrante.`});
  else if (grams > cfg.lineGramsWarn) warn.push({message:`${name} : quantité ≈ ${Math.round(grams)}g, vérifie la saisie.`});
  if (kcal > cfg.lineKcalWarn) warn.push({message:`${name} : ${Math.round(kcal)} kcal sur une seule ligne, vérifie la quantité.`});
  return {ok: !block.length, block, warn};
}

function foodnoteNutritionGuardConfirm(check, title = 'Contrôle nutrition') {
  if (!check) return true;
  if (check.block && check.block.length) {
    alert('❌ ' + title + '\n\n' + foodnoteGuardIssueText(check.block));
    return false;
  }
  if (check.warn && check.warn.length) {
    return confirm('⚠️ ' + title + '\n\n' + foodnoteGuardIssueText(check.warn) + '\n\nGarder quand même ?');
  }
  return true;
}

function foodnoteValidateFoodBeforeSave(food, opts = {}) {
  const check100 = foodnoteNutritionCheckFood100(food, opts);
  if (!foodnoteNutritionGuardConfirm(check100, opts.title || 'Valeur nutritionnelle inhabituelle')) return false;
  if (opts.qty !== undefined) {
    const checkLine = foodnoteNutritionCheckFoodLine(food, opts.qty, opts);
    if (!foodnoteNutritionGuardConfirm(checkLine, opts.lineTitle || 'Quantité inhabituelle')) return false;
  }
  return true;
}

function foodnoteWarnDailyNutritionIfNeeded(kcal) {
  const n = Number(kcal || 0);
  if (n > FOODNOTE_NUTRITION_GUARD.dayKcalWarn && typeof showSaveStatus === 'function') {
    showSaveStatus(`⚠️ Journée très haute : ${Math.round(n)} kcal. Vérifie qu’il n’y a pas une quantité aberrante.`, true);
  }
}

function foodnoteNutritionGuardSilentFood(food, opts = {}) {
  const c = foodnoteNutritionCheckFood100(food, opts);
  return c.ok ? null : (c.block && c.block[0] ? c.block[0].message : 'Valeur nutritionnelle invalide');
}

function nutrientInlineHTML(m) {
  return `
    <span class="nutri-chip nutri-kcal macro-kcal" title="Calories">🔥 ${Math.round(m.kcal || 0)} kcal</span>
    <span class="nutri-chip nutri-prot macro-prot" title="Protéines">🍖 ${round1(m.prot)}g</span>
    <span class="nutri-chip nutri-gluc macro-gluc" title="Glucides">🍞 ${round1(m.gluc)}g</span>
    <span class="nutri-chip nutri-lip macro-lip" title="Lipides">🥑 ${round1(m.lip)}g</span>`;
}
function nutrient100HTML(a) {
  return nutrientInlineHTML({kcal:a.kcal100 ?? 0, prot:a.prot100 ?? 0, gluc:a.gluc100 ?? 0, lip:a.lip100 ?? 0}) + '<span class="nutri-chip" title="Valeurs pour 100g">/100g</span>';
}


const FOOD_UNIT_WEIGHTS_FALLBACK = [
  {label:'œuf', grams:60, aliases:['oeuf','œuf','oeufs','œufs','oeuf entier','œuf entier']},
  {label:'banane', grams:120, aliases:['banane','banana']},
  {label:'pomme', grams:150, aliases:['pomme']},
  {label:'poire', grams:160, aliases:['poire']},
  {label:'orange', grams:150, aliases:['orange']},
  {label:'clémentine', grams:70, aliases:['clementine','clémentine','mandarine']},
  {label:'kiwi', grams:75, aliases:['kiwi']},
  {label:'pêche / nectarine', grams:150, aliases:['peche','pêche','nectarine']},
  {label:'abricot', grams:45, aliases:['abricot']},
  {label:'avocat', grams:150, aliases:['avocat']},
  {label:'tomate', grams:120, aliases:['tomate']},
  {label:'yaourt / pot', grams:125, aliases:['yaourt','pot de yaourt','fromage blanc individuel','skyr individuel']}
];
let FOOD_UNIT_WEIGHTS = FOOD_UNIT_WEIGHTS_FALLBACK.slice();

function normalizeUnitText(v) {
  return String(v || '')
    .toLowerCase()
    // Important 0.16.5 : NFD ne transforme pas la ligature œ.
    // Sans ce remplacement, "bœuf" devenait "b uf" et pouvait matcher "œuf".
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unitPluralToken(base) {
  if (!base) return base;
  return base.endsWith('s') ? base : base + 's';
}

const UNIT_INFERENCE_SAFE_DESCRIPTORS = new Set([
  'bio','frais','fraiche','fraiches','cru','crue','crues','cuit','cuite','cuites',
  'entier','entiere','entiers','entieres','dur','dure','durs','dures',
  'gros','grosse','grosses','petit','petite','petits','petites','moyen','moyenne','moyennes',
  'calibre','nature','blanc','blanche','blanches','rouge','rouges','vert','verte','vertes','jaune','jaunes',
  'mur','mure','mures','muri','murie','local','locale','locales','france','francais','francaise',
  'golden','granny','smith','royal','gala','pink','lady'
]);

const UNIT_INFERENCE_CONNECTORS = new Set(['de','des','du','d','a','au','aux','avec','sans','pour','en','et','type','style','facon','façon']);

function isKnownDefaultUnitToken(t) {
  const x = normalizeUnitText(t);
  if (!x) return false;
  return FOOD_UNIT_WEIGHTS_FALLBACK.some(r => {
    if (normalizeUnitText(r.label) === x) return true;
    return (r.aliases || []).some(a => normalizeUnitText(a) === x);
  });
}

function nameLooksComposedForAutoUnit(name) {
  const tokens = normalizedTokens(name);
  if (tokens.length <= 1) return false;
  // Règle générale 0.16.15 : dès qu'un nom contient une liaison
  // type "de/du/des/avec/en...", on considère que c'est un aliment composé
  // et on refuse d'inférer une unité automatique depuis un simple mot.
  if (tokens.some(t => UNIT_INFERENCE_CONNECTORS.has(t))) return true;
  // Si un mot connu comme unité est noyé dans un nom avec d'autres mots non
  // descriptifs, on reste en grammes. Exemples génériques :
  // "compote pomme", "boulette boeuf", "pomme alphabet".
  const hasDefaultUnitWord = tokens.some(isKnownDefaultUnitToken);
  if (hasDefaultUnitWord) {
    return tokens.some(t => !isKnownDefaultUnitToken(t) && !UNIT_INFERENCE_SAFE_DESCRIPTORS.has(t));
  }
  return false;
}

const UNIT_INFERENCE_FORBIDDEN_PHRASES = [
  'pomme de terre','pommes de terre','pomme de tere','pommes de tere','pomme terre','pommes terre','terre pomme','terre pommes',
  'jus de pomme','compote de pomme','tarte aux pommes','tarte pomme','gateau aux pommes','gateau pomme',
  'boulette de boeuf','boulettes de boeuf','steak de boeuf','viande de boeuf'
];

function normalizedTokens(v) {
  return normalizeUnitText(v).split(' ').filter(Boolean);
}

function tokenMatchesAliasToken(token, base) {
  return token === base || token === unitPluralToken(base) || (base.endsWith('s') && token === base.slice(0, -1));
}

function hasForbiddenUnitPhrase(normalizedName) {
  const padded = ' ' + normalizedName + ' ';
  return UNIT_INFERENCE_FORBIDDEN_PHRASES.some(p => padded.includes(' ' + normalizeUnitText(p) + ' '));
}

function singleTokenUnitAliasMatchesStrict(aliasToken, name) {
  const n = normalizeUnitText(name);
  if (!n || hasForbiddenUnitPhrase(n) || nameLooksComposedForAutoUnit(n)) return false;
  const tokens = normalizedTokens(n);
  if (!tokens.length) return false;

  const hasAlias = tokens.some(t => tokenMatchesAliasToken(t, aliasToken));
  if (!hasAlias) return false;

  // FoodNote 0.18.1 : l'inférence d'unité devient volontairement stricte.
  // On accepte uniquement un aliment simple : "pomme", "pomme golden", "œuf dur".
  // On refuse les plats/composés : "pomme de terre", "jus de pomme", "boulette de bœuf".
  return tokens.every(t => tokenMatchesAliasToken(t, aliasToken) || UNIT_INFERENCE_SAFE_DESCRIPTORS.has(t));
}

function phraseUnitAliasMatchesStrict(alias, name) {
  const n = normalizeUnitText(name);
  const a = normalizeUnitText(alias);
  if (!n || !a || hasForbiddenUnitPhrase(n) || nameLooksComposedForAutoUnit(n)) return false;
  if (n === a) return true;

  const aliasTokens = a.split(' ').filter(Boolean);
  const nameTokens = n.split(' ').filter(Boolean);
  if (!aliasTokens.length || nameTokens.length < aliasTokens.length) return false;

  const phrase = ' ' + a + ' ';
  if (!(' ' + n + ' ').includes(phrase)) return false;

  // Pour les expressions connues comme "pot de yaourt", on tolère seulement
  // des qualificatifs simples autour, jamais une vraie préparation.
  return nameTokens.every(t => aliasTokens.includes(t) || UNIT_INFERENCE_SAFE_DESCRIPTORS.has(t));
}

function foodHasStandaloneEggWord(foodOrName) {
  const name = typeof foodOrName === 'string' ? foodOrName : (foodOrName?.nom || foodOrName?.name || '');
  const tokens = normalizedTokens(name);
  return tokens.includes('oeuf') || tokens.includes('oeufs');
}

function foodHasBeefWord(foodOrName) {
  const name = typeof foodOrName === 'string' ? foodOrName : (foodOrName?.nom || foodOrName?.name || '');
  const tokens = normalizedTokens(name);
  return tokens.includes('boeuf') || tokens.includes('boeufs');
}

function isEggUnitLabel(v) {
  const t = normalizeUnitText(v);
  return t === 'oeuf' || t === 'oeufs' || t === 'oeuf entier' || t === 'oeufs entiers';
}

function isKnownDefaultUnitLabel(v) {
  const t = normalizeUnitText(v);
  if (!t) return false;
  return FOOD_UNIT_WEIGHTS_FALLBACK.some(r => {
    if (normalizeUnitText(r.label) === t) return true;
    return (r.aliases || []).some(a => normalizeUnitText(a) === t);
  });
}

function isGenericUnitWord(v) {
  const t = normalizeUnitText(v);
  return ['unite','unites','piece','pieces'].includes(t);
}

function foodnoteIsEggBeefUnitFalsePositive(food) {
  if (!food || !foodHasBeefWord(food) || foodHasStandaloneEggWord(food)) return false;
  const label = food.uniteLabel || food.unit_label || food.label || '';
  const unit = food.unite || food.unit || '';
  const raw = Number(food.poidsUnite ?? food.poids_unite ?? food.unitWeight ?? food.unit_weight ?? 0);
  return isEggUnitLabel(label) || isEggUnitLabel(unit) || (raw > 0 && raw <= 75 && String(unit || '').toLowerCase() !== 'g');
}

function foodnoteKnownUnitFalsePositive(food) {
  if (!food) return false;
  if (foodnoteIsEggBeefUnitFalsePositive(food)) return true;

  const name = food.nom || food.name || food.name_snapshot || '';
  const inferred = inferUnitWeightStrictNameOnly(name);
  if (inferred) return false;

  const label = food.uniteLabel || food.unit_label || '';
  const unit = food.unite || food.unit || '';
  const raw = Number(food.poidsUnite ?? food.poids_unite ?? food.unitWeight ?? food.unit_weight ?? 0);

  const unitNorm = normalizeUnitText(unit);
  const labelNorm = normalizeUnitText(label);
  const hasKnownLabel = isKnownDefaultUnitLabel(labelNorm) || isKnownDefaultUnitLabel(unitNorm);
  const genericUnit = isGenericUnitWord(labelNorm) || isGenericUnitWord(unitNorm) || (!labelNorm && unitNorm && unitNorm !== 'g');
  const defaultGrams = FOOD_UNIT_WEIGHTS_FALLBACK.map(r => Number(r.grams)).filter(Boolean);
  const looksLikeDefaultAutoWeight = Number.isFinite(raw) && raw > 0 && defaultGrams.some(g => Math.abs(g - raw) < 0.001);
  const composedName = nameLooksComposedForAutoUnit(name) || hasForbiddenUnitPhrase(normalizeUnitText(name));

  // FoodNote 0.18.1 : règle générale plus exigeante.
  // Si le nom ne passe pas l'inférence stricte, on ne conserve jamais une unité
  // automatique/générique ("unité", "pièce", "pomme", "œuf"...) même sans poidsUnite.
  // C'est ce qui corrige "pomme de terre alphabet" resté en unité.
  if (hasKnownLabel || genericUnit) return true;
  if (looksLikeDefaultAutoWeight && (!labelNorm || composedName)) return true;

  return false;
}

function clearFoodUnitMeta(food) {
  if (!food) return food;
  food.poidsUnite = null;
  food.poids_unite = null;
  food.unitWeight = null;
  food.unit_weight = null;
  food.unite = 'g';
  food.unit = 'g';
  food.uniteLabel = '';
  food.unit_label = '';
  return food;
}

function inferUnitWeightStrictNameOnly(foodOrName) {
  const name = typeof foodOrName === 'string' ? foodOrName : (foodOrName?.nom || foodOrName?.name || '');
  const found = FOOD_UNIT_WEIGHTS.find(rule => unitRuleMatches(rule, name));
  return found ? {grams: Number(found.grams), label: found.label, id: found.id} : null;
}

function normalizeUnitWeights(list) {
  const rows = Array.isArray(list) ? list : [];
  return rows.map((r, i) => {
    const label = String(r.label || r.uniteLabel || '').trim();
    const grams = Number(r.grams ?? r.poidsUnite ?? r.unit_weight);
    const aliases = Array.isArray(r.aliases) ? r.aliases : String(r.aliases || label).split(',');
    return {id:r.id ?? (-(i+1)), label:label || 'unité', grams, aliases:[...new Set([label, ...aliases].map(a => String(a || '').trim()).filter(Boolean))], source:r.source || 'user'};
  }).filter(r => r.label && Number.isFinite(r.grams) && r.grams > 0 && r.grams <= 2000);
}

function setUnitWeights(list) {
  const normalized = normalizeUnitWeights(list);
  const normalizedKeys = new Set();
  normalized.forEach(r => (r.aliases || [r.label]).forEach(a => normalizedKeys.add(normalizeUnitText(a))));
  const fallback = FOOD_UNIT_WEIGHTS_FALLBACK.filter(r => !(r.aliases || [r.label]).some(a => normalizedKeys.has(normalizeUnitText(a))));
  FOOD_UNIT_WEIGHTS = normalized.length ? [...normalized, ...fallback] : FOOD_UNIT_WEIGHTS_FALLBACK.slice();
}

function unitRuleMatches(rule, name) {
  const n = normalizeUnitText(name);
  if (!n || hasForbiddenUnitPhrase(n)) return false;
  return (rule.aliases || [rule.label]).some(alias => {
    const a = normalizeUnitText(alias);
    if (!a) return false;
    const aliasTokens = a.split(' ').filter(Boolean);
    if (aliasTokens.length === 1) return singleTokenUnitAliasMatchesStrict(aliasTokens[0], n);
    return phraseUnitAliasMatchesStrict(a, n);
  });
}

function inferUnitWeight(foodOrName) {
  if (foodnoteKnownUnitFalsePositive(foodOrName)) return null;
  return inferUnitWeightStrictNameOnly(foodOrName);
}

const MAX_REASONABLE_UNIT_GRAMS = 2000;

function saneUnitWeightForFood(food) {
  if (foodnoteKnownUnitFalsePositive(food)) return 0;
  const raw = Number(food?.poidsUnite ?? food?.poids_unite ?? food?.unitWeight ?? food?.unit_weight ?? 0);
  const unit = String(food?.unite || food?.unit || 'g').toLowerCase();
  const label = food?.uniteLabel || food?.unit_label || '';
  const inferred = inferUnitWeight(food);

  // Cas corrigé v11.62 : anciennes journées ou récupérations BDD pouvaient stocker
  // 120g × 120 = 14400g pour une banane. Si un poids/unité est délirant,
  // on revient au poids connu du type d'aliment, sans toucher aux macros sauvegardées.
  if (!Number.isFinite(raw) || raw <= 0) return inferred ? Number(inferred.grams) : 0;
  if (raw > MAX_REASONABLE_UNIT_GRAMS) return inferred ? Number(inferred.grams) : 0;
  if (!inferred) {
    const defaultGrams = FOOD_UNIT_WEIGHTS_FALLBACK.map(r => Number(r.grams)).filter(Boolean);
    const looksLikeDefaultAutoWeight = defaultGrams.some(g => Math.abs(g - raw) < 0.001);
    if (looksLikeDefaultAutoWeight && nameLooksComposedForAutoUnit(food?.nom || food?.name || food?.name_snapshot || '')) return 0;
  }

  // FoodNote 0.18.1 : si l'unité ressemble à une unité automatique connue mais que
  // le nom ne passe pas l'inférence stricte, on ne propage pas ce poids.
  if (!inferred && unit !== 'g' && (isKnownDefaultUnitLabel(label) || isKnownDefaultUnitLabel(unit))) return 0;

  // Unités personnalisées conservées : portion, tranche, part, etc.
  return raw;
}

function sanitizeFoodUnitMeta(food) {
  const out = {...(food || {})};
  if (foodnoteKnownUnitFalsePositive(out)) return clearFoodUnitMeta(out);
  const inferred = inferUnitWeight(out);
  const raw = Number(out.poidsUnite ?? out.poids_unite ?? out.unitWeight ?? out.unit_weight ?? 0);
  const sane = saneUnitWeightForFood(out);

  if (sane > 0) {
    out.poidsUnite = sane;
    out.unite = out.unite && out.unite !== 'g' ? out.unite : 'unité';
    out.uniteLabel = out.uniteLabel || out.unit_label || inferred?.label || 'unité';
  } else if (raw > 0 || raw > MAX_REASONABLE_UNIT_GRAMS) {
    // Pas de règle sûre : mieux vaut revenir en grammes que coller une unité fausse
    // comme "pomme" pour "pomme de terre".
    out.poidsUnite = null;
    out.poids_unite = null;
    out.unitWeight = null;
    out.unit_weight = null;
    out.unite = 'g';
    out.unit = 'g';
    out.uniteLabel = '';
    out.unit_label = '';
  }
  return out;
}

function knownKcal100ForFood(food) {
  const direct = Number(food?.kcal100 ?? food?.kcalPer100 ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  try {
    if (typeof getBDD === 'function' && typeof normalizeSearchText === 'function') {
      const key = normalizeSearchText(food?.nom || food?.name || '');
      const found = (getBDD() || []).find(b => normalizeSearchText(b.nom || b.name || '') === key);
      const n = Number(found?.kcal100 ?? found?.kcalPer100 ?? 0);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch (_) {}
  return 0;
}

function unitQtyLooksLikeStoredGrams(food, qty) {
  const q = Number(qty) || 0;
  const unit = food?.unite || food?.unit || 'g';
  const unitWeight = saneUnitWeightForFood(food);
  if (!(unitWeight > 0) || unit === 'g' || q <= 20) return false;

  const kcal100 = knownKcal100ForFood(food);
  const savedKcal = Number(food?.kcal ?? food?.calories ?? food?.energy ?? NaN);
  if (Number.isFinite(savedKcal) && savedKcal > 0 && kcal100 > 0) {
    const asGrams = kcal100 * q / 100;
    const asUnits = kcal100 * q * unitWeight / 100;
    const errGrams = Math.abs(savedKcal - asGrams);
    const errUnits = Math.abs(savedKcal - asUnits);
    return errGrams <= errUnits;
  }

  // Sans total kcal fiable, 120 "unités" de banane/œuf/pomme est presque toujours
  // une ancienne quantité en grammes. On convertit seulement les valeurs vraiment hautes.
  return q >= Math.max(50, unitWeight * 0.5);
}

function displayQtyPartsForFood(food, qty) {
  const clean = sanitizeFoodUnitMeta(food);
  const q = Number(qty) || 0;
  const unit = clean?.unite || 'g';
  const unitWeight = saneUnitWeightForFood(clean);
  if (unitWeight > 0 && unit !== 'g') {
    const qtyIsGrams = unitQtyLooksLikeStoredGrams(clean, q);
    const grams = qtyIsGrams ? q : q * unitWeight;
    const unitQty = qtyIsGrams ? (grams / unitWeight) : q;
    return {
      unit,
      unitLabel: clean.uniteLabel || unit,
      unitWeight,
      qty: Math.round(unitQty * 10) / 10,
      grams: Math.round(grams)
    };
  }
  return {unit, unitLabel: unit, unitWeight: 0, qty:q, grams:Math.round(q)};
}

function shouldUseUnitByDefault(food) {
  // FoodNote beta 0.22.37 — sécurité données : les quantités du journal restent en grammes.
  // Les poids par unité pourront revenir plus tard comme aide de saisie explicite, mais ils ne doivent
  // jamais transformer automatiquement une ancienne quantité en "nombre d'unités".
  return false;
}

function withUnitDefaults(food) {
  const out = sanitizeFoodUnitMeta(food || {});
  out.unite = 'g';
  out.unit = 'g';
  out.poidsUnite = null;
  out.poids_unite = null;
  out.unitWeight = null;
  out.unit_weight = null;
  out.uniteLabel = '';
  out.unit_label = '';
  return out;
}

function getEffectiveGrams(a, qty) {
  // Source de vérité : la quantité enregistrée dans le journal est toujours en grammes.
  // On évite ainsi les conversions silencieuses type 25 pêches × 210g.
  const q = Number(qty) || 0;
  return q;
}

function foodnoteFmtNumber(v, decimals = 1) {
  const n = Number(v) || 0;
  const rounded = Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
  return String(rounded).replace('.', ',');
}

function foodnoteUnitDisplayLabel(parts) {
  const label = String(parts?.unitLabel || parts?.unit || 'unité').trim() || 'unité';
  return label;
}

function formatFoodQty(a, qty) {
  const q = Number(qty) || 0;
  return `${foodnoteFmtNumber(q, q % 1 ? 1 : 0)} g`;
}

function formatFoodQtyDetail(a, qty) {
  const q = Number(qty) || 0;
  return `${foodnoteFmtNumber(q, q % 1 ? 1 : 0)} g · calcul nutrition en grammes`;
}

function unitHintHTML(a, qty, idx = null) {
  const id = idx != null ? idx : allAliments.indexOf(a);
  const clean = sanitizeFoodUnitMeta(a);
  if (saneUnitWeightForFood(clean) > 0 && (clean.unite || 'g') !== 'g') {
    return `<small class="qty-equivalent" id="qty-eq-${id}" title="Les unités sont seulement un raccourci. Les calories sont calculées avec le poids en grammes.">${formatFoodQtyDetail(clean, qty)}</small>`;
  }
  return `<small class="qty-equivalent" id="qty-eq-${id}" title="Les grammes sont la valeur réelle utilisée pour le calcul.">calcul en grammes</small>`;
}

function qtyModeControlHTML(a, idx) {
  return `<span class="qty-unit" title="Quantité réelle en grammes">g</span>`;
}



const MEAL_OPTIONS = [
  {id:'breakfast', label:'Petit-déj', icon:'☕'},
  {id:'lunch', label:'Déjeuner', icon:'🍽️'},
  {id:'dinner', label:'Souper', icon:'🌙'},
];

function mealOption(id) { return MEAL_OPTIONS.find(m => m.id === id) || MEAL_OPTIONS[1]; }
function mealLabel(id) { const m = mealOption(id); return `${m.icon} ${m.label}`; }
function isMealGroupingEnabled() { return true; }
function mealAddButtonHTML(meal) {
  const label = meal && meal.label ? meal.label : 'repas';
  const mealId = meal && meal.id ? meal.id : 'lunch';
  return `<button type="button" class="meal-group-add-btn" onclick="event.preventDefault();event.stopPropagation();if(window.openMealQuickAddBubble){return openMealQuickAddBubble('${mealId}', this);}goToFoodAdd('${mealId}');return false;" title="Ajouter dans ${escapeHtml(label)}" aria-label="Ajouter dans ${escapeHtml(label)}">+</button>`;
}


function mealSelectHTML(idx, meal) {
  const current = (meal && meal !== 'none' && meal !== 'snack' && meal !== 'other') ? meal : 'lunch';
  return `<select class="food-meal-select" title="Classer dans un repas optionnel" onclick="event.stopPropagation()" onchange="changeFoodMeal(${idx}, this.value)">` +
    MEAL_OPTIONS.map(m => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${m.icon} ${m.label}</option>`).join('') +
    `</select>`;
}

function getFoodBlockNodes(idx) {
  return ['row-', 'ia-row-', 'off-row-', 'ciq-row-', 'er-'].map(prefix => document.getElementById(prefix + idx)).filter(Boolean);
}


function foodnoteRowVisibleName(idx) {
  const row = document.getElementById('row-' + idx);
  return String(row?.querySelector('.aliment-name')?.textContent || '').trim();
}

function foodnoteFoodVisibleName(food) {
  return String(food?.nom || food?.name || '').trim();
}

function foodnoteFoodNamesMatch(a, b) {
  const norm = (typeof normalizeSearchText === 'function')
    ? normalizeSearchText
    : (v => String(v || '').toLowerCase().trim());
  return norm(a) === norm(b);
}

function foodnoteRowStableKeyFromParts(name, meal) {
  const norm = (typeof normalizeSearchText === 'function')
    ? normalizeSearchText
    : (v => String(v || '').toLowerCase().trim());
  const m = (typeof normalizeMealId === 'function') ? normalizeMealId(meal || 'lunch') : (meal || 'lunch');
  return norm(name) + '|' + m;
}

function foodnoteRowStableKey(food) {
  return foodnoteRowStableKeyFromParts(foodnoteFoodVisibleName(food), food?.meal || 'lunch');
}

function foodnoteCaptureSelectedFoodRows() {
  const map = new Map();
  document.querySelectorAll('.food-row-compact.selected').forEach(row => {
    const idx = Number(String(row.id || '').replace(/^row-/, ''));
    const food = Number.isFinite(idx) ? allAliments[idx] : null;
    const rowName = String(row.querySelector('.aliment-name')?.textContent || foodnoteFoodVisibleName(food)).trim();
    const meal = row.querySelector('.food-meal-select')?.value || food?.meal || 'lunch';
    const key = foodnoteRowStableKeyFromParts(rowName, meal);
    if (!key || key === '|lunch') return;
    const qtyInput = row.querySelector('.qty-input');
    const qty = Number(qtyInput?.value || quantities[idx] || food?.defaut || 0) || 0;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ qty });
  });
  return map;
}

function rebuildFoodRowsFromMemory(reason = 'sync') {
  const customContainer = document.getElementById('list-custom');
  if (!customContainer) return false;
  const selectedByKey = foodnoteCaptureSelectedFoodRows();
  try {
    const activeEditDraft = foodnoteCaptureActiveEditDraft();
    if (typeof closeFoodAdvancedPanels === 'function') closeFoodAdvancedPanels({ resetIA: false });
    customContainer.innerHTML = '';
    allAliments = [...ALIMENTS_BASE, ...customAliments];
    Object.keys(quantities || {}).forEach(k => {
      const i = Number(k);
      if (Number.isFinite(i) && i >= ALIMENTS_BASE.length) delete quantities[k];
    });
    selected.clear();
    customAliments.forEach((food, ci) => {
      const idx = ALIMENTS_BASE.length + ci;
      createRow(food, idx, true, false);
      const key = foodnoteRowStableKey(food);
      const hits = selectedByKey.get(key);
      if (hits && hits.length) {
        const snap = hits.shift();
        selected.add(idx);
        quantities[idx] = Number(snap.qty || food.defaut || 0) || 0;
        const input = document.getElementById('qty-' + idx);
        if (input) input.value = quantities[idx];
        const row = document.getElementById('row-' + idx);
        if (row) row.classList.add('selected');
      }
      if (typeof updatePill === 'function') updatePill(idx);
      if (typeof updateUnitHint === 'function') updateUnitHint(idx);
    });
    if (typeof renderMealGrouping === 'function') renderMealGrouping();
    if (activeEditDraft && typeof foodnoteRestoreActiveEditAfterRender === 'function') foodnoteRestoreActiveEditAfterRender('rebuild-' + reason);
    if (typeof updateMacros === 'function') updateMacros();
    if (typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
    if (window.FOODNOTE_DEBUG_LINES) console.debug('[FoodNote] lignes aliments resynchronisées :', reason);
    return true;
  } catch (e) {
    console.warn('[FoodNote] resynchronisation lignes aliments impossible', e);
    return false;
  }
}
window.rebuildFoodRowsFromMemory = rebuildFoodRowsFromMemory;

function foodnoteGuardFoodIndex(idx, action = 'action') {
  const row = document.getElementById('row-' + idx);
  const food = allAliments && allAliments[idx];
  if (!row || !food || isFoodRuntimeDeleted(food) || isFoodLineDeleted(food)) return false;
  const rowName = foodnoteRowVisibleName(idx);
  const modelName = foodnoteFoodVisibleName(food);
  if (!rowName || !modelName || foodnoteFoodNamesMatch(rowName, modelName)) return true;
  console.warn('[FoodNote] index aliment désynchronisé', { action, idx, rowName, modelName, rowClass: row.className });
  rebuildFoodRowsFromMemory('index-drift-' + action);
  try { showSaveStatus && showSaveStatus('Lignes aliments resynchronisées. Reclique sur la ligne voulue.', true); } catch(e) {}
  return false;
}
window.foodnoteGuardFoodIndex = foodnoteGuardFoodIndex;

function foodnoteMaybeGuardFoodIndex(idx, action) {
  return (typeof foodnoteGuardFoodIndex === 'function') ? foodnoteGuardFoodIndex(idx, action) : true;
}

function foodnoteResolveFoodIndexFromRow(row, fallbackIdx, action = 'food-row') {
  const uid = String(row?.dataset?.lineUid || '').trim();
  if (uid && typeof findFoodIndexByLineUid === 'function') {
    const byUid = findFoodIndexByLineUid(uid);
    if (byUid >= 0 && allAliments[byUid]) return byUid;
    // Handler retardé sur une ligne déjà supprimée : on ignore silencieusement.
    // Important : ce n'est pas une erreur utilisateur, c'est un événement DOM déjà en file
    // avant la suppression. Ne jamais resauver la journée depuis ce chemin.
    if (window.FOODNOTE_DEBUG_LINES) console.debug('[FoodNote] handler ignoré sur ligne supprimée', { action, uid, fallbackIdx });
    return -1;
  }
  const dataIdx = Number(row?.dataset?.foodIdx);
  const candidates = [dataIdx, Number(fallbackIdx)].filter(n => Number.isFinite(n) && n >= 0);
  for (const idx of candidates) {
    const food = allAliments && allAliments[idx];
    if (food && !isFoodRuntimeDeleted(food) && !isFoodLineDeleted(food)) {
      if (!foodnoteMaybeGuardFoodIndex(idx, action)) return -1;
      return idx;
    }
  }
  if (window.FOODNOTE_DEBUG_LINES) console.debug('[FoodNote] handler ignoré : index aliment absent', { action, fallbackIdx, dataIdx });
  return -1;
}
window.foodnoteResolveFoodIndexFromRow = foodnoteResolveFoodIndexFromRow;

function pruneInvalidSelectedFoodRows() {
  if (!selected || !allAliments) return;
  Array.from(selected).forEach(i => {
    const idx = Number(i);
    const food = Number.isFinite(idx) ? allAliments[idx] : null;
    if (!Number.isFinite(idx) || !food || isFoodRuntimeDeleted(food) || isFoodLineDeleted(food)) selected.delete(i);
  });
}

// 0.22.47 — session d'édition stable.
// Le bug observé venait d'un rendu différé qui masquait/recyclait la ligne pendant
// que l'utilisateur était encore en train de modifier un aliment snapshot. L'identité
// sûre est le line_uid, pas l'index DOM qui peut changer après réconciliation.
const FOODNOTE_EDIT_SESSION = window.FOODNOTE_EDIT_SESSION || (window.FOODNOTE_EDIT_SESSION = {
  uid: '',
  idx: null,
  openedAt: 0,
  draft: null
});

function foodnoteSetActiveEdit(uid, idx) {
  uid = String(uid || '').trim();
  FOODNOTE_EDIT_SESSION.uid = uid;
  FOODNOTE_EDIT_SESSION.idx = Number.isFinite(Number(idx)) ? Number(idx) : null;
  FOODNOTE_EDIT_SESSION.openedAt = uid ? Date.now() : 0;
  FOODNOTE_EDIT_SESSION.draft = null;
  return uid;
}

function foodnoteClearActiveEdit(uid = '') {
  uid = String(uid || '').trim();
  if (!uid || !FOODNOTE_EDIT_SESSION.uid || FOODNOTE_EDIT_SESSION.uid === uid) {
    FOODNOTE_EDIT_SESSION.uid = '';
    FOODNOTE_EDIT_SESSION.idx = null;
    FOODNOTE_EDIT_SESSION.openedAt = 0;
    FOODNOTE_EDIT_SESSION.draft = null;
  }
}

function foodnoteActiveEditUid() {
  return String(FOODNOTE_EDIT_SESSION.uid || '').trim();
}

function foodnoteCaptureActiveEditDraft() {
  const uid = foodnoteActiveEditUid();
  if (!uid || typeof findFoodIndexByLineUid !== 'function') return null;
  const idx = findFoodIndexByLineUid(uid);
  if (idx < 0) return null;
  const er = document.getElementById('er-' + idx);
  if (!er || er.style.display === 'none') return null;
  const val = suffix => document.getElementById('ei-' + suffix + '-' + idx)?.value ?? '';
  const draft = {
    uid,
    n: val('n'), q: val('q'), k: val('k'), p: val('p'), g: val('g'), l: val('l'), w: val('w'),
    scope: document.getElementById('ei-scope-' + idx)?.value || 'line'
  };
  FOODNOTE_EDIT_SESSION.draft = draft;
  return draft;
}

function foodnoteApplyActiveEditDraft(idx) {
  const draft = FOODNOTE_EDIT_SESSION.draft;
  if (!draft || !draft.uid) return false;
  const uid = foodnoteActiveEditUid();
  if (!uid || uid !== draft.uid) return false;
  const set = (suffix, value) => {
    const el = document.getElementById('ei-' + suffix + '-' + idx);
    if (el) el.value = value;
  };
  set('n', draft.n); set('q', draft.q); set('k', draft.k); set('p', draft.p); set('g', draft.g); set('l', draft.l); set('w', draft.w);
  const scope = document.getElementById('ei-scope-' + idx);
  if (scope) scope.value = draft.scope || 'line';
  try { updateEditScopeHint(idx); } catch(e) {}
  return true;
}

function foodnoteResolveIndexFromButton(btn, fallbackIdx = null) {
  const uid = String(btn?.dataset?.lineUid || btn?.closest?.('[data-line-uid]')?.dataset?.lineUid || '').trim();
  if (uid && typeof findFoodIndexByLineUid === 'function') {
    const byUid = findFoodIndexByLineUid(uid);
    if (byUid >= 0) return byUid;
  }
  const row = btn?.closest?.('.food-row-compact');
  const rowIdx = Number(String(row?.id || '').replace(/^row-/, ''));
  if (Number.isFinite(rowIdx)) return foodnoteResolveEditIndex(rowIdx, 'button-action');
  const er = btn?.closest?.('.edit-row');
  const erIdx = Number(String(er?.id || '').replace(/^er-/, ''));
  if (Number.isFinite(erIdx)) return foodnoteResolveEditIndex(erIdx, 'button-action');
  const n = Number(fallbackIdx);
  if (Number.isFinite(n)) return foodnoteResolveEditIndex(n, 'button-action');
  return -1;
}

function foodnoteHandleEditButton(btn, fallbackIdx, ev) {
  try { ev?.preventDefault?.(); ev?.stopPropagation?.(); } catch(e) {}
  const idx = foodnoteResolveIndexFromButton(btn, fallbackIdx);
  if (idx >= 0) toggleEdit(idx);
  return false;
}

function foodnoteHandleSaveEditButton(btn, fallbackIdx, ev) {
  try { ev?.preventDefault?.(); ev?.stopPropagation?.(); } catch(e) {}
  const idx = foodnoteResolveIndexFromButton(btn, fallbackIdx);
  if (idx >= 0) saveEdit(idx);
  else if (typeof showSaveStatus === 'function') showSaveStatus('Ligne introuvable : ferme/réouvre le repas.', true);
  return false;
}

function foodnoteRestoreActiveEditAfterRender(reason = 'render') {
  const uid = foodnoteActiveEditUid();
  if (!uid || typeof findFoodIndexByLineUid !== 'function') return false;
  const idx = findFoodIndexByLineUid(uid);
  if (idx < 0) {
    foodnoteClearActiveEdit(uid);
    return false;
  }
  const row = document.getElementById('row-' + idx);
  const er = document.getElementById('er-' + idx);
  if (row) {
    row.classList.add('editing');
    row.dataset.lineUid = uid;
  }
  if (er) {
    er.dataset.lineUid = uid;
    // Si l'utilisateur est en train d'éditer, un rendu automatique ne doit pas
    // refermer le formulaire ni tuer le bouton OK.
    if (er.style.display !== 'flex') er.style.display = 'flex';
    er.querySelectorAll('button[data-foodnote-action="save-edit"]').forEach(btn => {
      btn.dataset.lineUid = uid;
      btn.disabled = false;
      btn.classList.remove('is-pending');
      if (btn.textContent !== 'OK') btn.textContent = 'OK';
    });
  }
  if (!foodnoteApplyActiveEditDraft(idx)) {
    // Si le DOM a été reconstruit et qu'aucun brouillon n'existe, on remet au moins
    // les valeurs actuelles de la ligne pour garder le bouton OK utilisable.
    const a = allAliments[idx];
    if (a) {
      const set = (suffix, value) => { const el = document.getElementById('ei-' + suffix + '-' + idx); if (el && el.value === '') el.value = value; };
      set('n', a.nom || '');
      set('q', a.defaut ?? quantities[idx] ?? 0);
      set('k', a.kcal100 ?? 0);
      set('p', +(Math.round((Number(a.prot100)||0)*10)/10));
      set('g', +(Math.round((Number(a.gluc100)||0)*10)/10));
      set('l', +(Math.round((Number(a.lip100)||0)*10)/10));
      set('w', Number(a.poidsUnite) > 0 ? Math.round(Number(a.poidsUnite)) : 0);
      const scope = document.getElementById('ei-scope-' + idx);
      if (scope && !scope.value) scope.value = 'line';
      try { updateEditScopeHint(idx); } catch(e) {}
    }
  }
  if (window.FOODNOTE_DEBUG_LINES) console.debug('[FoodNote] édition restaurée après rendu', {reason, uid, idx});
  return true;
}

window.foodnoteHandleEditButton = foodnoteHandleEditButton;
window.foodnoteHandleSaveEditButton = foodnoteHandleSaveEditButton;
window.foodnoteRestoreActiveEditAfterRender = foodnoteRestoreActiveEditAfterRender;

function closeFoodAdvancedPanels(options = {}) {
  // Les panneaux Groq/CIQUAL/OpenFoodFacts ne doivent jamais se rouvrir
  // simplement parce qu'une journée sauvegardée est rechargée ou qu'un repas est déroulé.
  // Ils ne s'ouvrent que sur un clic utilisateur explicite.
  const resetIA = options.resetIA !== false;
  const closeEdit = options.closeEdit === true;
  const activeUid = closeEdit ? '' : foodnoteActiveEditUid();

  document.querySelectorAll('[id^="ia-row-"],[id^="off-row-"],[id^="ciq-row-"]').forEach(el => {
    el.style.display = 'none';
    el.removeAttribute('data-opened-by-user');
  });

  document.querySelectorAll('.edit-row').forEach(el => {
    const uid = String(el.dataset.lineUid || '').trim();
    if (activeUid && uid && uid === activeUid) return;
    el.style.display = 'none';
    el.removeAttribute('data-opened-by-user');
  });

  document.querySelectorAll('.food-row-compact.editing').forEach(row => {
    const uid = String(row.dataset.lineUid || '').trim();
    if (activeUid && uid && uid === activeUid) return;
    row.classList.remove('editing');
  });

  if (activeUid) foodnoteRestoreActiveEditAfterRender('close-panels-preserve-edit');

  if (resetIA) {
    document.querySelectorAll('[id^="ia-val-"]').forEach(input => {
      input.value = '';
      input.placeholder = '120 | 5.2 | 15.0 | 4.1';
    });
    document.querySelectorAll('[id^="ia-val-status-"]').forEach(status => {
      status.textContent = '';
    });
  }
}

function foodnotePersistFoodMealChange(idx, reason = 'meal-change') {
  idx = Number(idx);
  if (!Number.isFinite(idx) || idx < 0) return;
  try { if (typeof markFoodUiWriteForImmediateSave === 'function') markFoodUiWriteForImmediateSave(); } catch(e) {}

  if (typeof persistFoodLineToSQLite === 'function') {
    try {
      const run = persistFoodLineToSQLite(idx, reason);
      if (run && typeof run.catch === 'function') {
        run.catch(e => {
          console.error('[FoodNote] persistance repas impossible', e);
          try { if (typeof showSaveStatus === 'function') showSaveStatus('Repas modifié localement, synchro SQLite à reprendre', true); } catch(_) {}
        });
      }
      return;
    } catch(e) {
      console.error('[FoodNote] lancement persistance repas impossible', e);
    }
  }

  // Fallback ancien moteur uniquement si l'API atomique n'est pas disponible.
  try { if (typeof autoSaveToday === 'function') autoSaveToday(120); } catch(e) {}
}

function changeFoodMeal(idx, meal) {
  if (!foodnoteMaybeGuardFoodIndex(idx, 'change-meal')) return;
  const a = allAliments[idx];
  if (!a) return;
  a.meal = normalizeMealId(meal || 'lunch');
  const ci = idx - ALIMENTS_BASE.length;
  if (customAliments[ci]) customAliments[ci].meal = a.meal;
  saveCustomList();
  renderMealGrouping();
  if (typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
  foodnotePersistFoodMealChange(idx, 'meal-select');
}

let foodnoteDraggedFoodIdx = null;
let foodnoteDragPointerState = null;

function foodnoteCreateDragGhost(row, startX, startY) {
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  ghost.classList.add('food-drag-ghost');
  ghost.style.width = Math.max(160, rect.width) + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.style.left = '0px';
  ghost.style.top = '0px';
  document.body.appendChild(ghost);
  const state = {
    ghost,
    offsetX: startX - rect.left,
    offsetY: startY - rect.top,
    x: rect.left,
    y: rect.top,
    raf: null
  };
  foodnoteUpdateDragGhost(state, startX, startY, true);
  return state;
}
function foodnoteUpdateDragGhost(state, x, y, immediate = false) {
  if (!state || !state.ghost) return;
  state.x = x - state.offsetX;
  state.y = y - state.offsetY;
  const apply = () => {
    state.raf = null;
    state.ghost.style.transform = `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0) rotate(-1deg) scale(1.025)`;
  };
  if (immediate) apply();
  else if (!state.raf) state.raf = requestAnimationFrame(apply);
}
function foodnoteRemoveDragGhost(state, dropToEl) {
  if (!state || !state.ghost) return;
  if (state.raf) cancelAnimationFrame(state.raf);
  const ghost = state.ghost;
  const finish = () => ghost.remove();
  if (dropToEl && typeof ghost.animate === 'function') {
    try {
      const target = dropToEl.getBoundingClientRect();
      const current = ghost.getBoundingClientRect();
      const dx = target.left - current.left;
      const dy = target.top - current.top;
      ghost.animate([
        { transform: ghost.style.transform, opacity: 1 },
        { transform: `translate3d(${Math.round(state.x + dx)}px, ${Math.round(state.y + dy)}px, 0) scale(.98)`, opacity: .18 }
      ], { duration: 180, easing: 'cubic-bezier(.2,.9,.2,1)' }).onfinish = finish;
      return;
    } catch(e) {}
  }
  ghost.classList.add('food-drag-ghost-drop');
  setTimeout(finish, 170);
}
function foodnoteAnimateMovedRowFromRect(row, oldRect) {
  if (!row || !oldRect || typeof row.animate !== 'function') return;
  try {
    const newRect = row.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    row.animate([
      { transform: `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0) scale(.985)`, opacity: .72 },
      { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }
    ], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1)' });
  } catch(e) {}
}

function foodnoteMoveFoodToMeal(idx, meal, options = {}) {
  idx = Number(idx);
  const targetMeal = normalizeMealId(meal || 'lunch');
  const a = allAliments[idx];
  if (!a) return false;
  const previousMeal = normalizeMealId(a.meal || 'lunch');
  if (previousMeal === targetMeal && !options.forceRender) return false;

  const oldRow = document.getElementById('row-' + idx);
  const oldRect = oldRow ? oldRow.getBoundingClientRect() : null;

  a.meal = targetMeal;
  const ci = idx - ALIMENTS_BASE.length;
  if (customAliments[ci]) customAliments[ci].meal = targetMeal;

  const select = document.querySelector(`#row-${idx} .food-meal-select`);
  if (select) select.value = targetMeal;

  saveCustomList();
  renderMealGrouping();

  const group = document.querySelector(`.meal-group[data-meal="${targetMeal}"]`);
  if (group) {
    group.open = true;
    if (typeof foodnoteRememberMealOpenState === 'function') foodnoteRememberMealOpenState(targetMeal, true);
    group.classList.add('meal-drop-confirm');
    setTimeout(() => group.classList.remove('meal-drop-confirm'), 700);
  }

  const row = document.getElementById('row-' + idx);
  if (row) {
    foodnoteAnimateMovedRowFromRect(row, options.fromRect || oldRect);
    row.classList.add('food-drag-moved');
    setTimeout(() => row.classList.remove('food-drag-moved'), 700);
  }

  if (typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
  foodnotePersistFoodMealChange(idx, options.reason || 'meal-drag');
  return true;
}

function foodnoteClearMealDropState() {
  document.querySelectorAll('.meal-group.meal-drop-target,.meal-group.meal-drop-active,.food-row-compact.food-dragging,.food-row-compact.food-drag-origin').forEach(el => {
    el.classList.remove('meal-drop-target', 'meal-drop-active', 'food-dragging', 'food-drag-origin');
  });
  foodnoteDraggedFoodIdx = null;
}

function foodnoteSetupMealDropZone(details) {
  if (!details || details.dataset.foodnoteDropReady === '1') return;
  details.dataset.foodnoteDropReady = '1';
  details.addEventListener('dragenter', ev => {
    if (!foodnoteDraggedFoodIdx) return;
    ev.preventDefault();
    details.classList.add('meal-drop-target');
  });
  details.addEventListener('dragover', ev => {
    if (!foodnoteDraggedFoodIdx) return;
    ev.preventDefault();
    details.classList.add('meal-drop-target', 'meal-drop-active');
    details.open = true;
    if (typeof foodnoteRememberMealOpenState === 'function') foodnoteRememberMealOpenState(details.dataset.meal || 'lunch', true);
    try { ev.dataTransfer.dropEffect = 'move'; } catch(e) {}
  });
  details.addEventListener('dragleave', ev => {
    if (details.contains(ev.relatedTarget)) return;
    details.classList.remove('meal-drop-target', 'meal-drop-active');
  });
  details.addEventListener('drop', ev => {
    if (!foodnoteDraggedFoodIdx) return;
    ev.preventDefault();
    ev.stopPropagation();
    const targetMeal = details.dataset.meal || 'lunch';
    foodnoteMoveFoodToMeal(foodnoteDraggedFoodIdx, targetMeal);
    foodnoteClearMealDropState();
  });
}

function foodnoteSetupMealDragForRow(row, idx) {
  if (!row || row.dataset.foodnoteDragReady === '1') return;
  row.dataset.foodnoteDragReady = '1';
  row.dataset.foodIdx = String(idx);

  // Drag fiable souris + tactile : on démarre uniquement depuis la poignée ⋮⋮.
  // Le drag HTML5 natif est trop instable dans les <details> sur mobile/WebView.
  row.setAttribute('draggable', 'false');
  const handle = row.querySelector('.food-drag-handle');
  if (!handle) return;
  handle.setAttribute('role', 'button');
  handle.setAttribute('tabindex', '0');
  handle.title = 'Glisser vers un autre repas';

  const startDrag = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();

    const pointerId = ev.pointerId;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const sourceMeal = normalizeMealId(allAliments[idx]?.meal || 'lunch');
    let active = false;
    let lastGroup = null;
    let ghostState = null;

    const activate = () => {
      if (active) return;
      active = true;
      foodnoteDraggedFoodIdx = idx;
      ghostState = foodnoteCreateDragGhost(row, startX, startY);
      foodnoteDragPointerState = { idx, pointerId, ghostState };
      row.classList.add('food-dragging', 'food-drag-origin');
      document.body.classList.add('foodnote-meal-drag-active');
      document.querySelectorAll('.meal-group').forEach(g => g.classList.add('meal-drop-target'));
      try { handle.setPointerCapture(pointerId); } catch(e) {}
    };

    const move = (moveEv) => {
      if (moveEv.pointerId !== pointerId) return;
      const dist = Math.abs(moveEv.clientX - startX) + Math.abs(moveEv.clientY - startY);
      if (!active && dist > 4) activate();
      if (!active) return;
      moveEv.preventDefault();
      foodnoteUpdateDragGhost(ghostState, moveEv.clientX, moveEv.clientY);

      document.querySelectorAll('.meal-group.meal-drop-active').forEach(g => g.classList.remove('meal-drop-active'));
      const el = document.elementFromPoint(moveEv.clientX, moveEv.clientY);
      const group = el?.closest?.('.meal-group[data-meal]');
      if (group) {
        group.open = true;
        if (typeof foodnoteRememberMealOpenState === 'function') foodnoteRememberMealOpenState(group.dataset.meal || 'lunch', true);
        group.classList.add('meal-drop-active');
        lastGroup = group;
      }
    };

    const finish = (upEv) => {
      if (upEv.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', cancel, true);
      try { handle.releasePointerCapture(pointerId); } catch(e) {}

      if (active) {
        upEv.preventDefault();
        upEv.stopPropagation();
        const el = document.elementFromPoint(upEv.clientX, upEv.clientY);
        const group = el?.closest?.('.meal-group[data-meal]') || lastGroup;
        const targetMeal = normalizeMealId(group?.dataset?.meal || sourceMeal);
        const fromRect = row.getBoundingClientRect();
        if (targetMeal && targetMeal !== sourceMeal) foodnoteMoveFoodToMeal(idx, targetMeal, { fromRect });
        const targetRow = document.getElementById('row-' + idx);
        foodnoteRemoveDragGhost(ghostState, targetRow || group);
      } else {
        foodnoteRemoveDragGhost(ghostState);
      }
      document.body.classList.remove('foodnote-meal-drag-active');
      foodnoteDragPointerState = null;
      foodnoteClearMealDropState();
    };

    const cancel = (cancelEv) => {
      if (cancelEv.pointerId !== pointerId) return;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', cancel, true);
      foodnoteRemoveDragGhost(ghostState);
      document.body.classList.remove('foodnote-meal-drag-active');
      foodnoteDragPointerState = null;
      foodnoteClearMealDropState();
    };

    document.addEventListener('pointermove', move, { capture:true, passive:false });
    document.addEventListener('pointerup', finish, { capture:true, passive:false });
    document.addEventListener('pointercancel', cancel, { capture:true, passive:false });
  };

  handle.addEventListener('pointerdown', startDrag, { passive:false });
  handle.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); }, true);
  handle.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    ev.stopPropagation();
    const current = normalizeMealId(allAliments[idx]?.meal || 'lunch');
    const meals = MEAL_OPTIONS.map(m => m.id);
    const next = meals[(meals.indexOf(current) + 1) % meals.length] || 'lunch';
    foodnoteMoveFoodToMeal(idx, next);
  });
}

function setMealGrouping(enabled) {
  safeLocalSet('foodnote_group_meals', enabled ? '1' : '0');
  renderMealGrouping();
}

function initMealToggle() {
  const cb = document.getElementById('meal-group-toggle');
  if (cb) cb.checked = isMealGroupingEnabled();
}

function getMealSafeMacros(a, idx) {
  const qty = quantities[idx] ?? a?.defaut ?? 0;
  let m = getMacros(a, qty);

  // Sécurité UI : un récap repas ne doit jamais exploser à cause d'une donnée BDD/OCR corrompue
  // ou d'une valeur totale sauvegardée relue comme valeur /100g.
  const kcal = Number(m.kcal) || 0;
  const prot = Number(m.prot) || 0;
  const gluc = Number(m.gluc) || 0;
  const lip  = Number(m.lip) || 0;
  const impossible = kcal > 5000 || prot > 1000 || gluc > 1500 || lip > 1000;

  if (impossible) {
    const fallback = {
      kcal: Number(a?.kcal) || 0,
      prot: Number(a?.prot) || 0,
      gluc: Number(a?.gluc) || 0,
      lip:  Number(a?.lip) || 0,
    };
    const fallbackLooksOk = fallback.kcal > 0 && fallback.kcal < 5000 && fallback.prot < 1000 && fallback.gluc < 1500 && fallback.lip < 1000;
    if (fallbackLooksOk) return fallback;
    if (window.FOODNOTE_DEBUG_LINES) console.debug('[FoodNote] macro repas ignorée car incohérente', a?.nom, {qty, m, a});
    return {kcal:0, prot:0, gluc:0, lip:0};
  }

  return m;
}

function mealMacroSummary(mealBlocks) {
  const sums = {kcal:0, prot:0, gluc:0, lip:0};
  mealBlocks.forEach(b => {
    const a = allAliments[b.idx];
    if (!a) return;
    const m = getMealSafeMacros(a, b.idx);
    sums.kcal += Number(m.kcal) || 0;
    sums.prot += Number(m.prot) || 0;
    sums.gluc += Number(m.gluc) || 0;
    sums.lip += Number(m.lip) || 0;
  });
  return sums;
}

function mealSummaryHTML(mealBlocks) {
  const s = mealMacroSummary(mealBlocks);
  const count = mealBlocks.length;
  if (!count) return '<span class="meal-recap-empty">vide</span>';
  return `
    <span class="meal-recap-kcal macro-kcal">${Math.round(s.kcal)} kcal</span>
    <span class="meal-recap-prot macro-prot">${Math.round(s.prot)}g prot</span>
    <span class="meal-recap-gluc macro-gluc">${Math.round(s.gluc)}g gluc</span>
    <span class="meal-recap-lip macro-lip">${Math.round(s.lip)}g lip</span>
    <span class="meal-recap-count">${count} aliment${count > 1 ? 's' : ''}</span>`;
}

// 0.22.1 — moteur de dérivés journal.
// Les données sélectionnées restent la source de vérité en mémoire, et les vues
// dérivées (récaps par repas, tuiles macros, carrousels) se rafraîchissent à partir
// de cette source. On évite ainsi les recalculs dispersés ou les refresh obligatoires.
function foodnoteCurrentMealIndexes() {
  const indexes = [];
  for (let i = ALIMENTS_BASE.length; i < allAliments.length; i++) {
    // Le récap repas doit compter uniquement les aliments réellement ajoutés à la journée.
    // Les lignes présentes dans la base locale mais non sélectionnées ne doivent pas entrer dans les totaux.
    const a = allAliments[i];
    if (selected.has(i) && isFoodLineActiveForUi(a) && document.getElementById('row-' + i)) indexes.push(i);
  }
  return indexes;
}

function foodnoteBuildCurrentMealBlocks() {
  return foodnoteCurrentMealIndexes().slice().reverse().map(idx => ({
    idx,
    meal: normalizeMealId((allAliments[idx] && allAliments[idx].meal) || 'lunch'),
    nodes: getFoodBlockNodes(idx)
  })).filter(b => b.nodes.length);
}

function foodnoteUpdateMealGroupRecaps(blocks = null) {
  const list = document.getElementById('list-custom');
  if (!list) return false;
  const groups = list.querySelectorAll('.meal-group[data-meal]');
  if (!groups.length) return false;

  const byMeal = {};
  MEAL_OPTIONS.forEach(meal => { byMeal[meal.id] = []; });
  (blocks || foodnoteBuildCurrentMealBlocks()).forEach(block => {
    const meal = normalizeMealId(block.meal || 'lunch');
    if (!byMeal[meal]) byMeal[meal] = [];
    byMeal[meal].push(block);
  });

  MEAL_OPTIONS.forEach(meal => {
    const group = list.querySelector(`.meal-group[data-meal="${meal.id}"]`);
    if (!group) return;
    const mealBlocks = byMeal[meal.id] || [];
    const recap = group.querySelector('.meal-group-recap');
    if (recap) recap.innerHTML = mealSummaryHTML(mealBlocks);
    group.classList.toggle('empty-meal', mealBlocks.length === 0);
    group.dataset.foodCount = String(mealBlocks.length);
  });
  return true;
}

function foodnoteRefreshJournalDerivedUI(reason = 'update', options = {}) {
  const opts = {
    regroup: false,
    recaps: true,
    currentMeal: false,
    carousel: false,
    ...options
  };
  if (opts.regroup && typeof renderMealGrouping === 'function') {
    renderMealGrouping();
  } else if (opts.recaps) {
    foodnoteUpdateMealGroupRecaps();
  }
  if (opts.currentMeal && typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
  if (opts.carousel && typeof renderJournalDayCarousel === 'function') renderJournalDayCarousel();
}

window.foodnoteUpdateMealGroupRecaps = foodnoteUpdateMealGroupRecaps;
window.foodnoteRefreshJournalDerivedUI = foodnoteRefreshJournalDerivedUI;


// État d'ouverture des groupes de repas, conservé pendant les sauvegardes/rendus.
// But UX : une sauvegarde SQLite ne doit pas replier automatiquement le repas que l'utilisateur consulte.
let foodnoteMealOpenStateByDate = window.foodnoteMealOpenStateByDate || {};
window.foodnoteMealOpenStateByDate = foodnoteMealOpenStateByDate;

function foodnoteMealOpenDateKey() {
  return String(document.getElementById('f-date')?.value || '__global');
}

function foodnoteMealOpenStateForCurrentDate() {
  const key = foodnoteMealOpenDateKey();
  if (!foodnoteMealOpenStateByDate[key]) foodnoteMealOpenStateByDate[key] = {};
  return foodnoteMealOpenStateByDate[key];
}

function foodnoteCaptureMealOpenState() {
  const state = {...foodnoteMealOpenStateForCurrentDate()};
  document.querySelectorAll('.meal-group[data-meal]').forEach(group => {
    const meal = normalizeMealId(group.dataset.meal || 'lunch');
    state[meal] = !!group.open;
  });
  foodnoteMealOpenStateByDate[foodnoteMealOpenDateKey()] = state;
  return state;
}

function foodnoteRememberMealOpenState(meal, isOpen) {
  const state = foodnoteMealOpenStateForCurrentDate();
  state[normalizeMealId(meal || 'lunch')] = !!isOpen;
}

function foodnoteApplyMealOpenState(details, meal, fallbackOpen = false) {
  if (!details) return;
  const state = foodnoteMealOpenStateForCurrentDate();
  const id = normalizeMealId(meal || 'lunch');
  if (Object.prototype.hasOwnProperty.call(state, id)) details.open = !!state[id];
  else details.open = !!fallbackOpen;
}

function foodnoteBindMealOpenMemory(details) {
  if (!details || details.dataset.foodnoteOpenMemoryReady === '1') return;
  details.dataset.foodnoteOpenMemoryReady = '1';
  details.addEventListener('toggle', () => {
    foodnoteRememberMealOpenState(details.dataset.meal || 'lunch', details.open);
  });
}

function normalizeMealId(meal) {
  if (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner') return meal;
  return 'lunch';
}

function renderMealGrouping() {
  const list = document.getElementById('list-custom');
  if (!list) return;
  const mealOpenStateBeforeRender = (typeof foodnoteCaptureMealOpenState === 'function') ? foodnoteCaptureMealOpenState() : {};
  foodnoteCaptureActiveEditDraft();
  if (typeof closeFoodAdvancedPanels === 'function') closeFoodAdvancedPanels({ resetIA: false });
  const blocks = foodnoteBuildCurrentMealBlocks();

  const temp = document.createDocumentFragment();
  blocks.forEach(b => b.nodes.forEach(n => temp.appendChild(n)));
  list.innerHTML = '';

  MEAL_OPTIONS.forEach(meal => {
    const details = document.createElement('details');
    details.className = 'fn-ui-row fn-ui-row--meal fn-ui-row--expandable meal-group meal-group-collapsible';
    details.dataset.meal = meal.id;
    foodnoteApplyMealOpenState(details, meal.id, !!mealOpenStateBeforeRender?.[meal.id]);
    const mealBlocks = blocks.filter(b => b.meal === meal.id);
    if (!mealBlocks.length) details.classList.add('empty-meal');

    details.innerHTML = `
      <summary class="meal-group-head">
        <div class="meal-group-title"><span class="meal-group-icon">${meal.icon}</span><span>${meal.label}</span></div>
        <div class="meal-group-head-right">
          <div class="meal-group-recap">${mealSummaryHTML(mealBlocks)}</div>
          ${mealAddButtonHTML(meal)}
          <div class="meal-group-chevron">⌄</div>
        </div>
      </summary>
      <div class="meal-group-body"></div>`;
    const body = details.querySelector('.meal-group-body');
    mealBlocks.forEach(b => b.nodes.forEach(n => body.appendChild(n)));
    foodnoteBindMealOpenMemory(details);
    foodnoteSetupMealDropZone(details);
    list.appendChild(details);
  });
  try { foodnoteRestoreActiveEditAfterRender('renderMealGrouping'); } catch(e) {}
}

function normalizeAliment(a) {
  // Migre les anciens champs vers le nouveau format
  a = sanitizeFoodUnitMeta(a || {});
  if (a.kcalPer100 !== undefined && a.kcal100 === undefined) {
    a.kcal100 = a.kcalPer100; a.prot100 = a.protPer100; a.gluc100 = a.glucPer100; a.lip100 = a.lipPer100;
  }
  if (!a.cat) a.cat = 'custom';
  // Sécurité 0.21.19.4 : une fiche aliment rechargée ne bascule plus automatiquement en unité.
  a.unite = 'g';
  a.unit = 'g';
  a.poidsUnite = null;
  a.poids_unite = null;
  a.unitWeight = null;
  a.unit_weight = null;
  a.uniteLabel = '';
  a.unit_label = '';
  if (!a.defaut) a.defaut = 100;
  if (!a.meal || a.meal === 'none' || a.meal === 'snack' || a.meal === 'other') a.meal = 'lunch';
  return a;
}

function createRow(a, idx, isCustom, hidden) {
  if (!a || typeof a !== 'object') return;
  quantities[idx] = a.defaut;
  const container = document.getElementById(CATS[a.cat]);
  if (!container) return;
  if (isCustom && typeof ensureFoodLineUid === 'function') ensureFoodLineUid(a);
  const row = document.createElement('div');
  const noData = !a.kcal100 && !a.prot100;
  row.className = 'fn-ui-row fn-ui-row--food aliment-row food-row-compact' + (a.fixe ? ' selected' : '') + (noData ? ' no-data' : '');
  row.id = 'row-' + idx;
  row.dataset.foodIdx = String(idx);
  if (isCustom && a.line_uid) row.dataset.lineUid = String(a.line_uid);
  if (a.fixe) selected.add(idx);
  const m = getMacros(a, a.defaut);
  const step = a.unite === 'g' ? 5 : 0.5;
  const qtyTitle = (Number(a.poidsUnite)||0)>0 ? 'Quantité : l’unité est un raccourci, le calcul se fait en grammes' : 'Quantité réelle en grammes';

  row.innerHTML = `
    <div class="aliment-check"><span class="chk-mark">✓</span></div>
    <div class="food-drag-handle" title="Glisser vers un autre repas" aria-label="Glisser vers un autre repas">⋮⋮</div>

    <div class="food-compact-info">
      <div class="food-compact-title">
        <span class="aliment-name">${escapeHtml(a.nom)}</span>
        ${noData ? '<span class="food-warning-v2">sans données</span>' : ''}
      </div>
      <div class="food-compact-meta" onclick="event.stopPropagation()">
        ${mealSelectHTML(idx, a.meal || 'none')}
      </div>
      <span class="macro-pill" id="pill-${idx}">${nutrientInlineHTML(m)}</span>
    </div>

    <div class="qty-wrap food-compact-qty" onclick="event.stopPropagation()">
      <input class="qty-input" type="number" id="qty-${idx}" value="${a.defaut}" min="0" step="${step}" title="${qtyTitle}">
      ${qtyModeControlHTML(a, idx)}
      ${unitHintHTML(a, a.defaut, idx)}
    </div>

    ${isCustom ? `
      <div class="food-corner-actions" onclick="event.stopPropagation()">
        <button type="button" class="food-corner-btn edit" data-foodnote-action="toggle-edit" data-line-uid="${escapeHtml(a.line_uid || a.lineUid || '')}" onclick="return foodnoteHandleEditButton(this, ${idx}, event)" title="Modifier" aria-label="Modifier">✎</button>
        <button type="button" class="food-corner-btn delete" onclick="event.stopPropagation();deleteCustom(${idx})" title="Supprimer" aria-label="Supprimer">✕</button>
      </div>
    ` : ''}

    <div class="food-compact-actions" onclick="event.stopPropagation()">
      <button class="food-mini-btn groq" onclick="event.stopPropagation();estimerGroqAliment(${idx})" title="Estimer avec Groq"><span class="btn-ico">⚡</span><span class="btn-label">Groq</span></button>
      <button class="food-mini-btn ciq" onclick="event.stopPropagation();toggleCIQSearch(${idx})" title="Rechercher dans CIQUAL"><span class="btn-ico">🔎</span><span class="btn-label">CIQ</span></button>
      <button class="food-mini-btn off" onclick="event.stopPropagation();toggleOFFSearch(${idx})" title="Rechercher dans OpenFoodFacts"><span class="btn-ico">🛒</span><span class="btn-label">OpenFoodFacts</span></button>
    </div>
  `;
  row.addEventListener('click', () => {
    const currentIdx = foodnoteResolveFoodIndexFromRow(row, idx, 'row-click');
    if (currentIdx >= 0) toggleRow(currentIdx);
  });
  foodnoteSetupMealDragForRow(row, idx);
  container.appendChild(row);

  // Ligne estimation Groq / IA
  const iaRow = document.createElement('div');
  iaRow.id = 'ia-row-' + idx;
  iaRow.className = 'fn-ui-subrow fn-ui-subrow--ai';
  iaRow.innerHTML = `
    <div class="fn-ui-subrow-line">
      <span class="fn-ui-subrow-label">Groq :</span>
      <input id="ia-val-${idx}" class="fn-ui-subrow-input fn-ui-subrow-input--mono" type="text" placeholder="120 | 5.2 | 15 | 4.1">
      <button class="fn-ui-subrow-btn" onclick="applyIALine(${idx})">Appliquer</button>
      <button class="fn-ui-subrow-btn fn-ui-subrow-btn--ghost" onclick="document.getElementById('ia-row-${idx}').style.display='none'">✕</button>
    </div>
    <div id="ia-val-status-${idx}" class="fn-ui-subrow-status"></div>
  `;
  container.appendChild(iaRow);

  // Ligne recherche OpenFoodFacts
  const offRow = document.createElement('div');
  offRow.id = 'off-row-' + idx;
  offRow.className = 'fn-ui-subrow fn-ui-subrow--off';
  offRow.innerHTML = `
    <div class="fn-ui-subrow-line fn-ui-subrow-line--nowrap">
      <span class="fn-ui-subrow-label">OpenFoodFacts :</span>
      <input id="off-search-${idx}" class="fn-ui-subrow-input" type="text" placeholder="Rechercher un aliment...">
      <button class="fn-ui-subrow-btn" onclick="searchOFF(${idx})">🔍</button>
      <button class="fn-ui-subrow-btn fn-ui-subrow-btn--ghost" onclick="document.getElementById('off-row-${idx}').style.display='none'">✕</button>
    </div>
    <div id="off-results-${idx}" class="fn-ui-subrow-results fn-ui-subrow-results--compact"></div>
  `;
  container.appendChild(offRow);

  // Ligne recherche CIQUAL
  const ciqRow = document.createElement('div');
  ciqRow.id = 'ciq-row-' + idx;
  ciqRow.className = 'fn-ui-subrow fn-ui-subrow--ciq';
  ciqRow.innerHTML = `
    <div class="fn-ui-subrow-line fn-ui-subrow-line--nowrap">
      <span class="fn-ui-subrow-label">CIQUAL :</span>
      <input id="ciq-search-${idx}" class="fn-ui-subrow-input" type="text" placeholder="Rechercher un aliment...">
      <button class="fn-ui-subrow-btn" onclick="searchCIQ(${idx})">🔍</button>
      <button class="fn-ui-subrow-btn fn-ui-subrow-btn--ghost" onclick="document.getElementById('ciq-row-${idx}').style.display='none'">✕</button>
    </div>
    <div id="ciq-results-${idx}" class="fn-ui-subrow-results"></div>
  `;
  container.appendChild(ciqRow);

  if (isCustom) {
    const er = document.createElement('div');
    er.className = 'edit-row'; er.id = 'er-' + idx;
    er.dataset.lineUid = String(a.line_uid || a.lineUid || '');
    er.innerHTML = `
      <span class="edit-lbl">Nom</span><input id="ei-n-${idx}" type="text" style="flex:2;min-width:100px">
      <span class="edit-lbl">Qté</span><input id="ei-q-${idx}" type="number" style="width:64px" oninput="updateEditScopeHint(${idx})" title="Quantité de cette ligne. En grammes si mode g, en nombre d’unités si mode unité.">
      <span class="edit-lbl">Kcal/100g</span><input id="ei-k-${idx}" type="number" style="width:70px" title="Valeur de référence pour 100 g, jamais les calories de la portion.">
      <span class="edit-lbl">Prot/100g</span><input id="ei-p-${idx}" type="number" step="0.1" style="width:58px">
      <span class="edit-lbl">Gluc/100g</span><input id="ei-g-${idx}" type="number" step="0.1" style="width:58px">
      <span class="edit-lbl">Lip/100g</span><input id="ei-l-${idx}" type="number" step="0.1" style="width:58px">
      <span class="edit-lbl">1 unité =</span><input id="ei-w-${idx}" type="number" step="1" min="0" style="width:64px" oninput="updateEditScopeHint(${idx})" title="Poids moyen d’une unité en grammes. Mets 0 pour désactiver."><span class="edit-lbl">g</span>
      <span class="edit-lbl">Appliquer</span><select id="ei-scope-${idx}" class="edit-scope-select" onchange="updateEditScopeHint(${idx})" title="Évite de modifier la fiche produit par erreur">
        <option value="line">à cette ligne seulement</option>
        <option value="base">à la fiche aliment en base</option>
      </select>
      <span class="edit-lbl edit-hint" id="ei-hint-${idx}"></span>
      <button type="button" data-foodnote-action="save-edit" data-line-uid="${escapeHtml(a.line_uid || a.lineUid || '')}" onclick="return foodnoteHandleSaveEditButton(this, ${idx}, event)" style="padding:4px 10px;font-size:13px;background:#1d9e75;color:#fff;border:none;border-radius:6px;cursor:pointer">OK</button>
    `;
    container.appendChild(er);
  }

  const qi = row.querySelector('#qty-' + idx);
  if (qi) qi.addEventListener('input', () => {
    const currentIdx = foodnoteResolveFoodIndexFromRow(row, idx, 'qty-input');
    if (currentIdx < 0) return;
    const currentFood = allAliments[currentIdx];
    if (!currentFood) return;
    const nextQty = parseFloat(qi.value)||0;
    const guardLine = foodnoteNutritionCheckFoodLine(currentFood, nextQty);
    if (!guardLine.ok) {
      showSaveStatus && showSaveStatus('Quantité bloquée : ' + foodnoteGuardIssueText(guardLine.block), true);
      qi.classList.add('foodnote-guard-invalid');
      return;
    }
    qi.classList.remove('foodnote-guard-invalid');
    quantities[currentIdx] = nextQty;
    updatePill(currentIdx); updateUnitHint(currentIdx); updateMacros();
    if (typeof markFoodUiWriteForImmediateSave === 'function') markFoodUiWriteForImmediateSave();
    // Moteur 0.22.9 : une quantité aliment ne reposte jamais toute la journée.
    // Si la ligne n'est pas sélectionnée, on garde seulement la valeur UI.
    if (selected.has(currentIdx) && typeof schedulePersistFoodLineToSQLite === 'function') schedulePersistFoodLineToSQLite(currentIdx, 350, 'qty');
  });
}


function foodnoteClearCachedUnitMacros(food) {
  if (!food || typeof food !== 'object') return food;
  ['kcalU','protU','glucU','lipU','kcal','prot','gluc','lip','calories','proteines','glucides','lipides'].forEach(k => {
    try { delete food[k]; } catch(e) {}
  });
  return food;
}


function foodnoteLineHasNutritionData(food) {
  if (typeof foodnoteFoodHasNutritionData === 'function') return foodnoteFoodHasNutritionData(food);
  return !!food && ['kcal100','prot100','gluc100','lip100'].some(k => Number(food[k] || 0) > 0);
}

function foodnoteFindBddFoodForLine(food) {
  try {
    const bdd = typeof getBDD === 'function' ? getBDD() : [];
    if (!Array.isArray(bdd) || !food) return null;
    const id = food.bddId || food.id || null;
    if (id != null && id !== '') {
      const byId = bdd.find(b => String(b.id || '') === String(id));
      if (byId) return byId;
    }
    const key = typeof normalizeSearchText === 'function'
      ? normalizeSearchText(food.nom || food.name || '')
      : String(food.nom || food.name || '').toLowerCase().trim();
    return key ? (bdd.find(b => (typeof normalizeSearchText === 'function' ? normalizeSearchText(b.nom || b.name || '') : String(b.nom || b.name || '').toLowerCase().trim()) === key) || null) : null;
  } catch(e) {
    return null;
  }
}

function foodnoteShouldDefaultEditToBase(food) {
  // 0.22.47 : une ligne déjà présente dans le journal est une ligne snapshot.
  // Elle doit rester éditable même si son aliment source n'existe pas dans la BDD.
  // On ne bascule donc jamais automatiquement en modification de fiche base pour
  // une ligne identifiée par SQLite/line_uid/replay historique.
  if (food && (food.entryFoodId || food.entry_food_id || food.line_uid || food.lineUid || food.__journalReplay)) return false;

  const bddFood = foodnoteFindBddFoodForLine(food);
  // Si aucune fiche base fiable n'existe, on corrige la ligne du journal par défaut.
  if (!bddFood && !(food && food.bddId)) return false;
  // Si la fiche base existe mais est vide, toute saisie nutritionnelle peut compléter la base.
  if (bddFood && !foodnoteLineHasNutritionData(bddFood)) return true;
  // Les aliments ajoutés depuis la recherche libre avec bddId peuvent compléter leur fiche.
  if (food?.bddId && !foodnoteLineHasNutritionData(food)) return true;
  return false;
}


function foodnoteResolveEditIndex(idx, action = 'edit') {
  const n = Number(idx);
  const row = Number.isFinite(n) ? document.getElementById('row-' + n) : null;
  const uid = String(row?.dataset?.lineUid || '').trim();
  if (uid && typeof findFoodIndexByLineUid === 'function') {
    const byUid = findFoodIndexByLineUid(uid);
    if (byUid >= 0) return byUid;
  }
  if (Number.isFinite(n) && n >= 0 && allAliments && allAliments[n] && !isFoodRuntimeDeleted(allAliments[n]) && !isFoodLineDeleted(allAliments[n])) {
    if (typeof foodnoteGuardFoodIndex === 'function') {
      const ok = foodnoteGuardFoodIndex(n, action);
      if (!ok) {
        const retryRow = document.getElementById('row-' + n);
        const retryUid = String(retryRow?.dataset?.lineUid || '').trim();
        if (retryUid && typeof findFoodIndexByLineUid === 'function') {
          const retry = findFoodIndexByLineUid(retryUid);
          if (retry >= 0) return retry;
        }
        return -1;
      }
    }
    return n;
  }
  return -1;
}
window.foodnoteResolveEditIndex = foodnoteResolveEditIndex;

function foodnoteClearEditLocks(uid = '', options = {}) {
  uid = String(uid || '').trim();
  const closeEdit = options.closeEdit === true;
  const activeUid = foodnoteActiveEditUid();
  try {
    document.querySelectorAll('.food-row-compact.saving,.food-row-compact.editing').forEach(row => {
      const rowUid = String(row.dataset.lineUid || '').trim();
      if (uid && rowUid !== uid) return;
      row.classList.remove('saving');
      // Ne jamais retirer l'état editing d'une session active à cause d'une
      // sauvegarde ou d'une réconciliation en arrière-plan.
      if (closeEdit || !activeUid || rowUid !== activeUid) row.classList.remove('editing');
    });
    document.querySelectorAll('.edit-row').forEach(er => {
      const erUid = String(er.dataset.lineUid || '').trim();
      const idx = Number(String(er.id || '').replace(/^er-/, ''));
      const row = Number.isFinite(idx) ? document.getElementById('row-' + idx) : null;
      const rowUid = String(row?.dataset?.lineUid || erUid || '').trim();
      if (uid && rowUid !== uid && erUid !== uid) return;
      er.querySelectorAll('button[data-foodnote-action="save-edit"]').forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('is-pending');
        btn.textContent = 'OK';
      });
      if (closeEdit) er.style.display = 'none';
    });
  } catch(e) {}
}
window.foodnoteClearEditLocks = foodnoteClearEditLocks;
window.foodnoteActiveEditUid = foodnoteActiveEditUid;

function toggleEdit(idx) {
  idx = foodnoteResolveEditIndex(idx, 'toggle-edit');
  if (idx < 0) return;
  const er = document.getElementById('er-' + idx);
  const row = document.getElementById('row-' + idx);
  if (!er) return;
  const open = er.style.display === 'flex';
  if (open) {
    const closeUid = row?.dataset?.lineUid || er?.dataset?.lineUid || foodLineUidOf(allAliments[idx]);
    foodnoteClearActiveEdit(closeUid);
    er.style.display = 'none';
    if (row) row.classList.remove('editing');
    foodnoteClearEditLocks(closeUid, { closeEdit:true });
    // On ferme aussi les panneaux avancés pour revenir à une ligne propre.
    ['ia-row-', 'off-row-', 'ciq-row-'].forEach(prefix => {
      const panel = document.getElementById(prefix + idx);
      if (panel) panel.style.display = 'none';
    });
    return;
  }
  const ci = idx - ALIMENTS_BASE.length;
  const a = customAliments[ci];
  if (!a) return;
  const pendingAge = Date.now() - Number(a.__editSavePendingAt || 0);
  if (a.__editSavePending && pendingAge > 15000) {
    a.__editSavePending = false;
    a.__editSavePendingAt = 0;
    foodnoteClearEditLocks(foodLineUidOf(a));
  }
  document.getElementById('ei-n-' + idx).value = a.nom;
  document.getElementById('ei-q-' + idx).value = a.defaut;
  document.getElementById('ei-k-' + idx).value = a.kcal100;
  document.getElementById('ei-p-' + idx).value = +(Math.round(a.prot100*10)/10);
  document.getElementById('ei-g-' + idx).value = +(Math.round(a.gluc100*10)/10);
  document.getElementById('ei-l-' + idx).value = +(Math.round(a.lip100*10)/10);
  const weightInput = document.getElementById('ei-w-' + idx);
  if (weightInput) weightInput.value = Number(a.poidsUnite) > 0 ? Math.round(Number(a.poidsUnite)) : 0;
  const hint = document.getElementById('ei-hint-' + idx);
  const scope = document.getElementById('ei-scope-' + idx);
  if (scope) scope.value = foodnoteShouldDefaultEditToBase(a) ? 'base' : 'line';
  updateEditScopeHint(idx);
  const openUid = ensureFoodLineUid(a);
  foodnoteSetActiveEdit(openUid, idx);
  er.dataset.lineUid = openUid;
  er.querySelectorAll('button[data-foodnote-action="save-edit"]').forEach(btn => {
    btn.dataset.lineUid = openUid;
    btn.disabled = false;
    btn.classList.remove('is-pending');
    btn.textContent = 'OK';
  });
  if (row) {
    row.dataset.lineUid = openUid;
    row.classList.add('editing');
  }
  er.style.display = 'flex';
}

function updateEditScopeHint(idx) {
  const a = allAliments[idx];
  const hint = document.getElementById('ei-hint-' + idx);
  const scope = document.getElementById('ei-scope-' + idx)?.value || 'line';
  if (!hint) return;
  const qty = Number(document.getElementById('ei-q-' + idx)?.value || quantities[idx] || a?.defaut || 0) || 0;
  const w = Number(document.getElementById('ei-w-' + idx)?.value || a?.poidsUnite || 0) || 0;
  const grams = (w > 0 && (a?.unite || 'g') !== 'g') ? Math.round(qty * w) : Math.round(qty);
  const baseMsg = scope === 'base'
    ? '⚠️ modifie la fiche produit pour les prochains ajouts'
    : 'corrige seulement cette ligne du journal';
  hint.textContent = `${baseMsg} · équivalent ${grams || 0} g`;
}

async function saveEdit(idx) {
  idx = foodnoteResolveEditIndex(idx, 'save-edit');
  if (idx < 0) return false;
  const ci = idx - ALIMENTS_BASE.length;
  const a = customAliments[ci];
  const er = document.getElementById('er-' + idx);
  const row = document.getElementById('row-' + idx);
  const okBtn = er ? (er.querySelector('button[data-foodnote-action="save-edit"]') || Array.from(er.querySelectorAll('button')).find(btn => String(btn.getAttribute('onclick') || '').includes('saveEdit('))) : null;

  if (!a || !er) return false;
  const editUid = ensureFoodLineUid(a);
  if (a.__editSavePending) {
    const age = Date.now() - Number(a.__editSavePendingAt || 0);
    if (age < 15000) {
      if (typeof showSaveStatus === 'function') showSaveStatus('Sauvegarde de cette ligne déjà en cours…', true);
      return false;
    }
    a.__editSavePending = false;
    a.__editSavePendingAt = 0;
    foodnoteClearEditLocks(editUid);
  }

  const setPending = (pending) => {
    a.__editSavePending = !!pending;
    a.__editSavePendingAt = pending ? Date.now() : 0;
    if (customAliments[ci]) {
      customAliments[ci].__editSavePending = !!pending;
      customAliments[ci].__editSavePendingAt = pending ? a.__editSavePendingAt : 0;
    }
    if (okBtn) {
      okBtn.disabled = !!pending;
      okBtn.classList.toggle('is-pending', !!pending);
      okBtn.textContent = pending ? 'OK…' : 'OK';
    }
    if (row) row.classList.toggle('saving', !!pending);
    if (!pending) foodnoteClearEditLocks(editUid);
  };

  const closeEditPanel = () => {
    try { foodnoteClearActiveEdit(editUid); } catch(e) {}
    try { er.style.display = 'none'; } catch(e) {}
    try { if (row) row.classList.remove('editing', 'saving'); } catch(e) {}
    try { foodnoteClearEditLocks(editUid, { closeEdit:true }); } catch(e) {}
    ['ia-row-', 'off-row-', 'ciq-row-'].forEach(prefix => {
      try { const panel = document.getElementById(prefix + idx); if (panel) panel.style.display = 'none'; } catch(e) {}
    });
  };

  const readNumber = (id, fallback = 0) => {
    const el = document.getElementById(id);
    const raw = el ? el.value : '';
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  };

  setPending(true);
  try {
    const nextFood = { ...a };
    nextFood.nom = (document.getElementById('ei-n-' + idx)?.value || '').trim() || a.nom;
    nextFood.defaut = readNumber('ei-q-' + idx, Number(a.defaut || quantities[idx] || 0) || 0);
    nextFood.kcal100 = readNumber('ei-k-' + idx, 0);
    nextFood.prot100 = readNumber('ei-p-' + idx, 0);
    nextFood.gluc100 = readNumber('ei-g-' + idx, 0);
    nextFood.lip100 = readNumber('ei-l-' + idx, 0);

    foodnoteClearCachedUnitMacros(nextFood);
    const wInput = document.getElementById('ei-w-' + idx);
    if (wInput) {
      const w = Number(String(wInput.value || '').replace(',', '.')) || 0;
      nextFood.poidsUnite = w > 0 ? w : null;
      if (!nextFood.poidsUnite) {
        nextFood.unite = 'g';
        nextFood.uniteLabel = '';
      } else {
        nextFood.unite = nextFood.unite && nextFood.unite !== 'g' ? nextFood.unite : 'unité';
        if (!nextFood.uniteLabel) nextFood.uniteLabel = inferUnitWeight(nextFood)?.label || 'unité';
      }
    }

    if (!foodnoteValidateFoodBeforeSave(nextFood, {qty: nextFood.defaut, title:'Modification aliment impossible ou suspecte', lineTitle:'Quantité par défaut suspecte'})) {
      return false;
    }

    const editScope = document.getElementById('ei-scope-' + idx)?.value || 'line';
    const wantsBase = editScope === 'base';

    if (wantsBase) {
      const ok = confirm('Appliquer cette correction à la fiche aliment en base ?\n\nLes prochains ajouts utiliseront ces valeurs. Les anciennes journées ne seront pas recalculées automatiquement.');
      if (!ok) return false;
    }

    // Vérité UI : on met d'abord à jour la ligne snapshot du journal.
    // Une ligne de journal ne doit jamais dépendre d'un food_id existant pour être éditable.
    foodnoteClearCachedUnitMacros(a);
    const keepMeal = a.meal;
    Object.assign(a, {
      nom: nextFood.nom,
      defaut: nextFood.defaut,
      kcal100: nextFood.kcal100,
      prot100: nextFood.prot100,
      gluc100: nextFood.gluc100,
      lip100: nextFood.lip100,
      unite: nextFood.unite || 'g',
      poidsUnite: saneUnitWeightForFood(nextFood) || null,
      uniteLabel: nextFood.uniteLabel || '',
      meal: keepMeal
    });

    customAliments[ci] = a;
    allAliments[idx] = a;
    quantities[idx] = nextFood.defaut;

    const nameEl = row?.querySelector('.aliment-name');
    const qi = document.getElementById('qty-' + idx);
    const modeSelect = document.getElementById('qty-mode-' + idx);
    if (nameEl) nameEl.textContent = a.nom;
    if (qi) { qi.value = nextFood.defaut; qi.step = (a.unite || 'g') === 'g' ? '5' : '0.5'; }
    if (modeSelect) modeSelect.value = (a.unite || 'g') === 'g' ? 'g' : 'unit';
    try { updatePill(idx); } catch(e) {}
    try { updateUnitHint(idx); } catch(e) {}
    try { updateMacros(); } catch(e) {}

    // Sauvegarde locale : les lignes issues de l'historique/journal ne doivent pas polluer la base rapide.
    if (!a.__journalReplay) {
      try { saveCustomList(); } catch(e) { console.warn('[FoodNote] saveCustomList après édition impossible', e); }
    }

    // Option : mise à jour de la fiche base, mais jamais bloquante pour l'édition journal.
    if (wantsBase) {
      try {
        const bdd = getBDD();
        let targetBddId = nextFood.bddId || a.bddId || null;
        let bi = bdd.findIndex(b => String(b.id || '') === String(targetBddId || ''));
        if (bi < 0 && !targetBddId) {
          targetBddId = Date.now();
          bdd.push({ id: targetBddId, source:'manual_edit' });
          bi = bdd.length - 1;
        }
        if (bi >= 0) {
          bdd[bi] = {
            ...bdd[bi],
            id: bdd[bi].id || targetBddId,
            nom: nextFood.nom,
            kcal100: nextFood.kcal100,
            prot100: nextFood.prot100,
            gluc100: nextFood.gluc100,
            lip100: nextFood.lip100,
            unite: nextFood.unite || 'g',
            poidsUnite: saneUnitWeightForFood(nextFood) || null,
            uniteLabel: nextFood.uniteLabel || ''
          };
          a.bddId = bdd[bi].id;
          customAliments[ci] = a;
          allAliments[idx] = a;
          saveBDD(bdd);
          try { refreshDBSelect(); } catch(e) {}
          if (typeof saveSingleFoodNativeNow === 'function') {
            saveSingleFoodNativeNow(bdd[bi]).then(saved => {
              if (saved && saved.id) {
                a.bddId = saved.id;
                customAliments[ci] = a;
                allAliments[idx] = a;
                try { saveCustomList(); } catch(_) {}
              }
            }).catch(e => {
              console.warn('/api/foods sauvegarde fiche impossible', e);
              if (typeof showSaveStatus === 'function') showSaveStatus('Fiche gardée localement, synchro différée', true);
            });
          }
        }
      } catch(e) {
        console.warn('[FoodNote] mise à jour fiche base non bloquante impossible', e);
        if (typeof showSaveStatus === 'function') showSaveStatus('Ligne corrigée, fiche base non synchronisée', true);
      }
    }

    // SQLite atomique : si la ligne est sélectionnée, on persiste le snapshot.
    // En cas d'erreur, on débloque toujours l'UI ; pas de mode édition coincé.
    let sqliteOk = true;
    if (selected.has(idx) && typeof persistFoodLineToSQLite === 'function') {
      sqliteOk = await persistFoodLineToSQLite(idx, wantsBase ? 'edit-base' : 'edit-line-only');
    }

    closeEditPanel();
    foodnoteRefreshJournalMutationViews('food-edit-save', {
      currentMeal: true,
      journalCarousel: true,
      notification: true,
      dashboard: true,
      recap: true
    });

    if (typeof showSaveStatus === 'function') {
      showSaveStatus(sqliteOk ? 'Ligne du journal corrigée ✓' : 'Ligne corrigée localement, synchro SQLite à reprendre', !sqliteOk);
    }
    return !!sqliteOk;
  } catch(e) {
    console.error('[FoodNote] édition ligne aliment impossible', e);
    if (typeof showSaveStatus === 'function') showSaveStatus('Erreur édition aliment : ' + (e && e.message ? e.message : e), true);
    // On ne ferme pas en cas d'erreur de validation/lecture inattendue, mais on rend le bouton.
    return false;
  } finally {
    setPending(false);
    try { foodnoteClearEditLocks(editUid); } catch(e) {}
    try { foodnoteRestoreActiveEditAfterRender('save-edit-finally'); } catch(e) {}
  }
}

function removeFoodDomBlock(idx) {
  ['row-', 'ia-row-', 'off-row-', 'ciq-row-', 'er-'].forEach(prefix => {
    const node = document.getElementById(prefix + idx);
    if (!node) return;
    // Avant de retirer le bloc, on neutralise ses contrôles. Des événements `input`
    // peuvent déjà être en file dans le navigateur : ils seront ignorés par uid.
    try {
      node.dataset.foodnoteDeleted = '1';
      node.querySelectorAll('input,select,button,textarea').forEach(el => {
        try { el.disabled = true; } catch(_) {}
        try { el.blur && el.blur(); } catch(_) {}
      });
    } catch(e) {}
    node.remove();
  });
}

function snapshotCustomFoodUiState() {
  return (customAliments || []).map((food, i) => {
    const globalIndex = ALIMENTS_BASE.length + i;
    return {
      food,
      uid: foodLineUidOf(food) || ensureFoodLineUid(food),
      id: foodLineIdOf(food),
      selected: selected.has(globalIndex),
      qty: Number(quantities[globalIndex] || food?.defaut || food?.qty || 0) || 0
    };
  });
}

function applyCustomFoodSnapshotsAfterDelete(snapshots, deletedUid) {
  const kept = (snapshots || []).filter(s => s && s.uid !== deletedUid);
  const baseSelected = Array.from(selected || []).filter(i => Number(i) >= 0 && Number(i) < ALIMENTS_BASE.length && allAliments[i]);
  const baseQuantities = {};
  baseSelected.forEach(i => { baseQuantities[i] = quantities[i]; });

  customAliments = kept.map(s => s.food).filter(Boolean);
  allAliments = [...ALIMENTS_BASE, ...customAliments];

  selected.clear();
  baseSelected.forEach(i => selected.add(i));
  Object.keys(quantities || {}).forEach(k => {
    const i = Number(k);
    if (Number.isFinite(i) && i >= ALIMENTS_BASE.length) delete quantities[k];
  });
  Object.keys(baseQuantities).forEach(k => { quantities[k] = baseQuantities[k]; });

  kept.forEach((snap, i) => {
    const globalIndex = ALIMENTS_BASE.length + i;
    if (snap.selected) selected.add(globalIndex);
    quantities[globalIndex] = snap.qty;
    if (customAliments[i]) customAliments[i].defaut = snap.qty;
  });
}

function rebuildCustomFoodRowsFromState() {
  const customContainer = document.getElementById('list-custom');
  if (!customContainer) return;
  customContainer.innerHTML = '';
  customAliments.forEach((food, i) => {
    if (!food || isFoodRuntimeDeleted(food) || isFoodLineDeleted(food)) return;
    const globalIndex = ALIMENTS_BASE.length + i;
    createRow(food, globalIndex, true, false);
    const q = Number(quantities[globalIndex] || food?.defaut || 0) || 0;
    const qi = document.getElementById('qty-' + globalIndex);
    if (qi) qi.value = q;
    if (selected.has(globalIndex)) document.getElementById('row-' + globalIndex)?.classList.add('selected');
    updatePill(globalIndex);
    updateUnitHint(globalIndex);
  });
  renderMealGrouping();
}

let _foodRowsRebuildTimer = null;
function scheduleFoodRowsRebuildAfterDelete() {
  clearTimeout(_foodRowsRebuildTimer);
  _foodRowsRebuildTimer = setTimeout(() => {
    try { rebuildCustomFoodRowsFromState(); } catch(e) { console.warn('[FoodNote] rebuild lignes aliments impossible', e); }
  }, 16);
}

function foodnoteSafeViewCall(label, fn, args = []) {
  if (typeof fn !== 'function') return null;
  try { return fn.apply(window, Array.isArray(args) ? args : []); }
  catch(e) { console.warn('[FoodNote] rafraîchissement vue impossible:', label, e); return null; }
}

function foodnotePageIsActive(id) {
  return !!document.getElementById(id)?.classList.contains('active');
}

function refreshFoodnoteRecapAfterJournalMutation() {
  // Le journal et SQLite peuvent être corrects mais le mini-bilan/Récap
  // garder une version calculée en mémoire. Après suppression/ajout/patch d'une ligne,
  // on rafraîchit uniquement les vues déjà présentes, sans navigation ni gros reload.
  foodnoteSafeViewCall('refreshFoodnoteSmartDashboards', window.refreshFoodnoteSmartDashboards);
  foodnoteSafeViewCall('renderRecap actif', () => {
    if (foodnotePageIsActive('page-recap') && typeof window.renderRecap === 'function') window.renderRecap();
  });
  foodnoteSafeViewCall('renderRecapDashboardBadges', window.renderRecapDashboardBadges);
}
window.refreshFoodnoteRecapAfterJournalMutation = refreshFoodnoteRecapAfterJournalMutation;

function refreshFoodnoteStatsAfterJournalMutation() {
  foodnoteSafeViewCall('renderStats actif', () => {
    if (foodnotePageIsActive('page-stats') && typeof window.renderStats === 'function') window.renderStats();
  });
}
window.refreshFoodnoteStatsAfterJournalMutation = refreshFoodnoteStatsAfterJournalMutation;

function foodnoteRefreshJournalMutationViews(reason = 'mutation', options = {}) {
  const opts = {
    history: false,
    currentMeal: false,
    journalCarousel: false,
    sportCarousel: false,
    sportSummary: false,
    phaseMini: false,
    notification: false,
    dashboard: false,
    recap: false,
    stats: false,
    ...options
  };
  foodnoteSafeViewCall('mutation-marker', () => { window.__foodnoteLastJournalMutationRefresh = { reason, options: opts, at: Date.now() }; });
  if (opts.history) foodnoteSafeViewCall('renderHistorique', window.renderHistorique);
  if (opts.currentMeal) foodnoteSafeViewCall('renderCurrentMealFoods', window.renderCurrentMealFoods);
  if (opts.sportSummary) foodnoteSafeViewCall('renderSportPageSummary', window.renderSportPageSummary);
  if (opts.journalCarousel) foodnoteSafeViewCall('renderJournalDayCarousel', window.renderJournalDayCarousel);
  if (opts.sportCarousel) foodnoteSafeViewCall('renderSportDayCarousel', window.renderSportDayCarousel);
  if (opts.phaseMini) foodnoteSafeViewCall('renderJournalPhaseMini', window.renderJournalPhaseMini);
  if (opts.notification) foodnoteSafeViewCall('renderFoodnoteNotificationBadge', window.renderFoodnoteNotificationBadge);
  if (opts.dashboard) foodnoteSafeViewCall('renderJournalDashboardBadges', window.renderJournalDashboardBadges);
  if (opts.recap) refreshFoodnoteRecapAfterJournalMutation();
  if (opts.stats) refreshFoodnoteStatsAfterJournalMutation();
}
window.foodnoteRefreshJournalMutationViews = foodnoteRefreshJournalMutationViews;

function scheduleFoodPostDeleteRenders() {
  setTimeout(() => {
    foodnoteRefreshJournalMutationViews('post-delete', { currentMeal:true, journalCarousel:true, recap:true });
  }, 24);
}

function removeFoodLineFromLocalEntryCache(date, lineUid, matchPayload) {
  if (!date || typeof getEntries !== 'function') return false;
  const entries = getEntries() || [];
  const entry = entries.find(e => String(e.date) === String(date));
  if (!entry || !Array.isArray(entry.aliments)) return false;
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const targetName = norm(matchPayload?.nom || matchPayload?.name || matchPayload?.name_snapshot);
  const targetMeal = normalizeMealId(matchPayload?.meal || matchPayload?.repas || 'lunch');
  const targetQty = num(matchPayload?.qty ?? matchPayload?.defaut ?? matchPayload?.quantity);
  let bestIdx = -1, bestScore = -1;
  entry.aliments.forEach((f, i) => {
    let score = 0;
    const uid = String(lineUid || matchPayload?.line_uid || matchPayload?.lineUid || '').trim();
    if (uid && String(f?.line_uid || f?.lineUid || '').trim() === uid) score += 999;
    const name = norm(f?.nom || f?.name || f?.name_snapshot);
    if (targetName && name === targetName) score += 60;
    else if (targetName && name && (name.includes(targetName) || targetName.includes(name))) score += 35;
    if (normalizeMealId(f?.meal || f?.repas || 'lunch') === targetMeal) score += 20;
    const diffQty = Math.abs(num(f?.qty ?? f?.defaut ?? f?.quantity) - targetQty);
    if (targetQty > 0 && diffQty <= 0.5) score += 15;
    else if (targetQty > 0 && diffQty <= 5) score += 8;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  if (bestIdx < 0 || bestScore < 45) return false;
  entry.aliments.splice(bestIdx, 1);
  entry.foodCount = entry.aliments.length;
  entry.food_count = entry.aliments.length;
  if (typeof recalcEntryMacrosFromFoodRows === 'function') recalcEntryMacrosFromFoodRows(entry);
  else if (typeof foodnoteRecalcDetailedEntryMacrosNative === 'function') foodnoteRecalcDetailedEntryMacrosNative(entry);
  if (typeof saveLocalOnly === 'function') saveLocalOnly();
  refreshFoodnoteRecapAfterJournalMutation();
  return true;
}

function scheduleCustomFoodListPersistAfterDelete() {
  setTimeout(() => { try { saveCustomList(); } catch(e) {} }, 32);
}


function buildFoodDeleteMatchPayload(food, lineUid, lineId) {
  const meal = typeof normalizeMealId === 'function' ? normalizeMealId(food?.meal || 'lunch') : (food?.meal || 'lunch');
  return {
    id: lineId || foodLineIdOf(food) || null,
    line_uid: lineUid || foodLineUidOf(food) || '',
    nom: food?.nom || food?.name || food?.name_snapshot || '',
    meal,
    qty: Number(food?.qty ?? food?.defaut ?? quantities?.[allAliments?.indexOf?.(food)] ?? 0) || 0,
    kcal: Number(food?.kcal ?? 0) || 0,
    prot: Number(food?.prot ?? 0) || 0,
    gluc: Number(food?.gluc ?? 0) || 0,
    lip: Number(food?.lip ?? 0) || 0
  };
}

async function deleteFoodLineOnServerByIdentity(lineId, lineUid, date, matchPayload) {
  // 0.22.149 : un id SQLite peut devenir obsolète après une écriture différée
  // ou un rechargement partiel. Si DELETE /api/entry-foods/:id répond 404,
  // on tente immédiatement le line_uid, qui est l'identité stable côté client.
  let idError = null;
  if (lineId && typeof deleteEntryFoodNative === 'function') {
    try {
      return await deleteEntryFoodNative(lineId);
    } catch(e) {
      idError = e;
      const notFound = Number(e && e.status) === 404 || /introuvable|not found/i.test(String(e && e.message || ''));
      if (!notFound || !lineUid || !date || typeof deleteEntryFoodNativeByLineUid !== 'function') throw e;
      console.warn('[FoodNote] DELETE par id introuvable, fallback line_uid', { lineId, lineUid, date });
    }
  }
  let uidError = null;
  if (lineUid && date && typeof deleteEntryFoodNativeByLineUid === 'function') {
    try {
      return await deleteEntryFoodNativeByLineUid(date, lineUid);
    } catch(e) {
      uidError = e;
      const notFound = Number(e && e.status) === 404 || /introuvable|not found/i.test(String(e && e.message || ''));
      if (!notFound) throw e;
      console.warn('[FoodNote] DELETE par line_uid introuvable, fallback par contenu', { lineUid, date, matchPayload });
    }
  }
  if (date && matchPayload && typeof deleteEntryFoodNativeByMatch === 'function') {
    return await deleteEntryFoodNativeByMatch(date, matchPayload);
  }
  if (uidError) throw uidError;
  if (idError) throw idError;
  return null;
}

function clearFoodRuntimeIdentity(food) {
  if (!food || typeof food !== 'object') return;
  try { delete food.entryFoodId; } catch(e) {}
  try { delete food.entry_food_id; } catch(e) {}
  try { delete food.idInEntry; } catch(e) {}
  try { delete food.line_uid; } catch(e) {}
  try { delete food.lineUid; } catch(e) {}
}

function removeFoodLineFromClientState(idx, lineUid, options = {}) {
  const ci = idx - ALIMENTS_BASE.length;
  const isCustomMealLine = ci >= 0 && ci < customAliments.length;

  selected.delete(idx);
  delete quantities[idx];

  if (isCustomMealLine) {
    // 0.22.9 : suppression sans réindexation immédiate.
    // Le bug venait du compactage de customAliments pendant que des événements DOM
    // retardés pointaient encore vers les anciens index. On garde donc un tombstone
    // runtime jusqu'au prochain rebuild global, et saveCustomList() l'exclut du cache.
    const food = allAliments[idx] || customAliments[ci];
    markFoodRuntimeDeleted(food, lineUid);
    if (customAliments[ci]) markFoodRuntimeDeleted(customAliments[ci], lineUid);
    selected.delete(idx);
    delete quantities[idx];
    removeFoodDomBlock(idx);
    scheduleCustomFoodListPersistAfterDelete();
  } else {
    const row = document.getElementById('row-' + idx);
    if (row) row.classList.remove('selected');
    const food = allAliments[idx];
    if (food) clearFoodRuntimeIdentity(food);
  }

  if (typeof pruneInvalidSelectedFoodRows === 'function') pruneInvalidSelectedFoodRows();
  updateMacros();
  scheduleFoodPostDeleteRenders();
}

async function deleteFoodLineCanonical(idx, options = {}) {
  const source = options.source || 'delete';
  const shouldConfirm = options.confirm !== false;
  if (!foodnoteMaybeGuardFoodIndex(idx, source)) return false;
  let food = allAliments[idx];
  if (!food) return false;

  const uid = foodLineUidOf(food) || ensureFoodLineUid(food);
  const resolvedIdx = uid ? findFoodIndexByLineUid(uid) : idx;
  if (resolvedIdx >= 0 && resolvedIdx !== idx) {
    idx = resolvedIdx;
    food = allAliments[idx];
  }
  if (!food) return false;

  if (shouldConfirm && !confirm('Supprimer cette ligne du repas ?')) return false;

  const lineUid = foodLineUidOf(food) || ensureFoodLineUid(food);
  const lineId = foodLineIdOf(food) || (lineUid ? FOOD_LINE_SYNC.serverIdByUid.get(lineUid) : null) || null;
  const date = document.getElementById('f-date')?.value || '';
  const matchPayload = buildFoodDeleteMatchPayload(food, lineUid, lineId);

  markFoodLineDeleted(lineUid);
  if (typeof markFoodUiWriteForImmediateSave === 'function') markFoodUiWriteForImmediateSave();

  removeFoodLineFromClientState(idx, lineUid, options);
  try { removeFoodLineFromLocalEntryCache(date, lineUid, matchPayload); } catch(e) { console.warn('[FoodNote] cache récap suppression non mis à jour', e); }

  const deleteAfterPendingWrite = async () => {
    try {
      const pending = lineUid && FOOD_LINE_SYNC.pendingByUid.get(lineUid);
      if (pending) {
        showSaveStatus && showSaveStatus('Suppression prise en compte, attente de l’id SQLite…');
        try { await pending; } catch(_) {}
      }
      const idNow = lineId || (lineUid ? FOOD_LINE_SYNC.serverIdByUid.get(lineUid) : null) || null;
      const saved = await deleteFoodLineOnServerByIdentity(idNow, lineUid, date, matchPayload);
      if (saved) {
        updateLocalEntryFromServerFoodSave(saved);
        showSaveStatus && showSaveStatus('Ligne supprimée SQLite ✓');
      } else {
        showSaveStatus && showSaveStatus('Ligne supprimée localement ✓');
      }
    } catch(e) {
      const notFound = Number(e && e.status) === 404 || /introuvable|not found/i.test(String(e && e.message || ''));
      if (notFound) {
        showSaveStatus && showSaveStatus('Suppression serveur non retrouvée : recharge si la ligne revient', true);
        return;
      }
      console.warn('[FoodNote] suppression atomique impossible', e);
      showSaveStatus && showSaveStatus('Suppression locale faite, SQLite non confirmé', true);
    }
  };

  deleteAfterPendingWrite();
  return true;
}
window.deleteFoodLineCanonical = deleteFoodLineCanonical;

function deleteCustom(idx) {
  const row = document.getElementById('row-' + idx);
  const currentIdx = foodnoteResolveFoodIndexFromRow(row, idx, 'delete-button');
  if (currentIdx < 0) return;
  deleteFoodLineCanonical(currentIdx, { confirm:true, source:'delete-button' });
}

function toggleRow(i) {
  const row = document.getElementById('row-' + i);
  const idx = foodnoteResolveFoodIndexFromRow(row, i, 'toggle-row');
  if (idx < 0) return;
  const currentRow = document.getElementById('row-' + idx) || row;
  if (selected.has(idx)) {
    // Moteur 0.22.9 : désélection d'une ligne repas = suppression atomique de la ligne,
    // pas POST global de toute la journée. Le garde-fou 409 reste réservé aux vrais remplacements.
    deleteFoodLineCanonical(idx, { confirm:false, source:'toggle-remove' });
    return;
  }

  selected.add(idx);
  if (currentRow) currentRow.classList.add('selected');
  updateMacros();
  if (typeof markFoodUiWriteForImmediateSave === 'function') markFoodUiWriteForImmediateSave();
  if (typeof persistFoodLineToSQLite === 'function') persistFoodLineToSQLite(idx, 'toggle-add');
}

function placeFoodBlockAtTop(idx) {
  const a = allAliments[idx]; if (!a) return;
  let container = document.getElementById(CATS[a.cat] || 'list-custom');
  if (!container) return;
  if (isMealGroupingEnabled()) {
    const meal = normalizeMealId(a.meal || 'lunch');
    container = document.querySelector(`.meal-group[data-meal="${meal}"] .meal-group-body`) || container;
  }
  const ids = ['row-', 'ia-row-', 'off-row-', 'ciq-row-', 'er-'];
  const nodes = ids.map(prefix => document.getElementById(prefix + idx)).filter(Boolean);
  if (!nodes.length) return;
  const first = container.firstChild;
  nodes.forEach(node => container.insertBefore(node, first));
}

function ensureFoodRowExists(idx) {
  const a = allAliments[idx];
  if (!a) return false;
  if (document.getElementById('row-' + idx)) return true;
  const isCustom = idx >= ALIMENTS_BASE.length;
  createRow(a, idx, isCustom, false);
  return !!document.getElementById('row-' + idx);
}

function openMealGroupForFood(idx) {
  const a = allAliments[idx];
  if (!a) return;
  const meal = normalizeMealId(a.meal || 'lunch');
  const group = document.querySelector(`.meal-group[data-meal="${meal}"]`);
  if (group) group.open = true;
  if (typeof foodnoteRememberMealOpenState === 'function') foodnoteRememberMealOpenState(meal, true);
}

function focusFoodQuantity(idx) {
  const doFocus = () => {
    ensureFoodRowExists(idx);
    openMealGroupForFood(idx);
    const row = document.getElementById('row-' + idx);
    const input = document.getElementById('qty-' + idx);
    if (row) row.scrollIntoView({ behavior:'smooth', block:'center' });
    if (input) {
      setTimeout(() => {
        input.focus({ preventScroll:true });
        try { input.select(); } catch(e) {}
      }, 180);
    }
  };
  if (typeof closeFoodAddModal === 'function' && document.getElementById('food-add-modal')?.classList.contains('is-open')) {
    closeFoodAddModal();
    setTimeout(doFocus, 180);
  } else {
    doFocus();
  }
}

function popupFoodQtyStep(a) {
  return 5;
}

let _foodnoteLastFoodUiWriteAt = 0;
function markFoodUiWriteForImmediateSave() {
  _foodnoteLastFoodUiWriteAt = Date.now();
}
function isRecentFoodUiWriteForImmediateSave(ms = 30000) {
  return !!_foodnoteLastFoodUiWriteAt && (Date.now() - _foodnoteLastFoodUiWriteAt) < ms;
}

function setFoodQuantityFromPopup(idx, value) {
  const a = allAliments[idx];
  if (!a) return;
  let qty = parseFloat(value);
  if (!Number.isFinite(qty) || qty < 0) qty = 0;
  const step = popupFoodQtyStep(a);
  if (step < 1) qty = Math.round(qty * 10) / 10;
  else qty = Math.round(qty);

  quantities[idx] = qty;
  const rowInput = document.getElementById('qty-' + idx);
  if (rowInput && document.activeElement !== rowInput) rowInput.value = qty;
  const popupInput = document.getElementById('last-added-qty-' + idx);
  if (popupInput && document.activeElement !== popupInput) popupInput.value = qty;

  updatePill(idx);
  updateUnitHint(idx);
  updateMacros();

  const m = getMacros(a, qty);
  const macroLine = document.getElementById('last-added-macros-' + idx);
  if (macroLine) macroLine.innerHTML = nutrientInlineHTML(m);
  const qtyLabel = document.getElementById('last-added-qty-label-' + idx);
  if (qtyLabel) qtyLabel.textContent = formatFoodQty(a, qty);
  const gramTruthNote = qtyLabel?.parentElement?.querySelector('.food-gram-truth-note');
  if (gramTruthNote) gramTruthNote.textContent = formatFoodQtyDetail(a, qty);

  markFoodUiWriteForImmediateSave();
  schedulePersistFoodLineToSQLite(idx, 220, 'qty');
}

function stepFoodQuantityFromPopup(idx, direction) {
  const a = allAliments[idx];
  if (!a) return;
  const step = popupFoodQtyStep(a);
  const current = Number(quantities[idx] || a.defaut || 0) || 0;
  const next = Math.max(0, current + (Number(direction) || 0) * step);
  setFoodQuantityFromPopup(idx, next);
  const popupInput = document.getElementById('last-added-qty-' + idx);
  if (popupInput) {
    popupInput.focus({ preventScroll:true });
    try { popupInput.select(); } catch(e) {}
  }
}

let journalLastAddedAutoHideTimer = null;

function scrollLastAddedIntoView() {
  const box = document.getElementById('journal-last-added');
  const dialog = document.querySelector('#food-add-modal .food-add-dialog');
  if (!box) return;
  const delay = foodnoteJournalAddCriticalActive() ? 260 : 40;
  setTimeout(() => {
    try {
      // Pas de smooth pendant l'ajout : certains WebView figent sur scrollIntoView + mutation du popup.
      if (!foodnoteJournalAddCriticalActive()) box.scrollIntoView({ behavior:'auto', block:'nearest' });
    } catch(e) {}
    if (!foodnoteJournalAddCriticalActive() && dialog && window.matchMedia && window.matchMedia('(max-width: 720px)').matches) {
      dialog.scrollTop = Math.max(0, box.offsetTop - 12);
    }
  }, delay);
}

function hideJournalLastAdded(idx) {
  const box = document.getElementById('journal-last-added');
  if (!box) return;
  const expected = String(idx ?? '');
  if (expected && box.dataset.foodIdx && box.dataset.foodIdx !== expected) return;

  // Si l'utilisateur est en train d'ajuster la quantité, on ne lui retire pas le contrôle sous les doigts.
  if (box.contains(document.activeElement)) {
    scheduleJournalLastAddedAutoHide(idx, 1400);
    return;
  }

  box.classList.remove('visible');
  box.innerHTML = '';
  delete box.dataset.foodIdx;

  const modal = document.getElementById('food-add-modal');
  const hasOpenWorkArea = !!(
    modal?.classList.contains('food-quantity-open') ||
    document.getElementById('db-suggestions')?.classList.contains('visible') ||
    document.getElementById('db-selected-card')?.classList.contains('visible') ||
    document.getElementById('groq-response')?.textContent?.trim() ||
    document.getElementById('ia-preview')?.textContent?.trim()
  );
  if (!hasOpenWorkArea && typeof setFoodAddExpanded === 'function') setFoodAddExpanded(false);
}

function scheduleJournalLastAddedAutoHide(idx, delay = 3000) {
  clearTimeout(journalLastAddedAutoHideTimer);
  journalLastAddedAutoHideTimer = setTimeout(() => hideJournalLastAdded(idx), delay);
}

function showJournalLastAdded(idx) {
  const box = document.getElementById('journal-last-added');
  const a = allAliments[idx];
  if (!box || !a) return;
  const panel = document.querySelector('#food-add-modal .food-add-panel');
  if (panel && panel.firstElementChild !== box) panel.insertBefore(box, panel.firstElementChild);
  const qty = quantities[idx] || a.defaut || 100;
  const m = getMacros(a, qty);
  const step = popupFoodQtyStep(a);
  const unit = (a.unite || 'g') === 'g' ? 'g' : (a.uniteLabel || a.unite || 'unité');
  box.innerHTML = `
    <div class="journal-last-added-inner">
      <div class="journal-last-added-info">
        <div class="journal-last-added-title">✅ Ajouté : <strong>${escapeHtml(a.nom)}</strong></div>
        <div class="journal-last-added-qty-label" id="last-added-qty-label-${idx}">${formatFoodQty(a, qty)}</div>
        <div class="food-gram-truth-note">${formatFoodQtyDetail(a, qty)}</div>
        <div class="food-macro-line" id="last-added-macros-${idx}">${nutrientInlineHTML(m)}</div>
      </div>
      <div class="journal-last-added-popup-qty" aria-label="Ajuster la quantité ajoutée">
        <button type="button" onclick="stepFoodQuantityFromPopup(${idx}, -1)" aria-label="Diminuer">−</button>
        <input type="number" id="last-added-qty-${idx}" value="${qty}" min="0" step="${step}" inputmode="decimal" oninput="setFoodQuantityFromPopup(${idx}, this.value)" onchange="setFoodQuantityFromPopup(${idx}, this.value)">
        <button type="button" onclick="stepFoodQuantityFromPopup(${idx}, 1)" aria-label="Augmenter">+</button>
        <span>${escapeHtml(unit)}</span>
      </div>
    </div>`;
  box.dataset.foodIdx = String(idx);
  box.classList.add('visible');
  setFoodAddExpanded(true);
  scrollLastAddedIntoView();
  scheduleJournalLastAddedAutoHide(idx, 3000);
}

function updatePill(i) {
  const a = allAliments[i]; if (!a) return;
  const m = getMacros(a, quantities[i]||0);
  const pill = document.getElementById('pill-' + i);
  if (pill) pill.innerHTML = nutrientInlineHTML(m);
}

function updateUnitHint(i) {
  const a = allAliments[i]; if (!a) return;
  const el = document.getElementById('qty-eq-' + i);
  if (!el) return;
  const clean = sanitizeFoodUnitMeta(a);
  el.classList.remove('hidden');
  el.textContent = formatFoodQtyDetail(clean, quantities[i] || clean.defaut || 0);
  el.title = (saneUnitWeightForFood(clean) > 0 && (clean.unite || 'g') !== 'g')
    ? 'Unité = raccourci. Le calcul se fait avec l’équivalent en grammes.'
    : 'Quantité réelle en grammes.';
}

function changeFoodQtyMode(idx, mode) {
  // Ancien sélecteur unité/grammes désactivé : on ne modifie plus automatiquement les quantités.
  const a = allAliments[idx];
  if (!a) return;
  a.unite = 'g';
  a.poidsUnite = null;
  a.uniteLabel = '';
  const qi = document.getElementById('qty-' + idx);
  if (qi) { qi.step = '5'; qi.title = 'Quantité réelle en grammes'; }
  updateUnitHint(idx);
  updatePill(idx);
  updateMacros();
  if (typeof showSaveStatus === 'function') showSaveStatus('Quantité en grammes conservée. Aucun changement automatique d’unité.', false);
}


function updateMacroTile(id, val, unit, target, higherIsBetter) {
  const el = document.getElementById(id);
  if (!el) return;
  const cell = el.closest('.macro-cell');
  const safeTarget = Math.max(Number(target) || 0, 1);
  const numericVal = Number(val) || 0;
  const ratio = numericVal / safeTarget;
  const pct = Math.max(0, Math.min(130, ratio * 100));
  const pctCapped = Math.max(0, Math.min(100, ratio * 100));
  // Barre du panneau Accueil : la largeur doit venir des valeurs réelles,
  // pas d'un rendu CSS fixe. On garde un calcul unique, utilisé ensuite en
  // variable CSS ET en style inline pour résister aux anciens blocs thème.
  const progressWidth = numericVal <= 0 ? 0 : Math.max(0, Math.min(100, ratio * 100));
  const overWidth = (!higherIsBetter && numericVal > safeTarget)
    ? Math.max(0, Math.min(100, ((numericVal - safeTarget) / safeTarget) * 100))
    : 0;
  const rounded = Math.round(numericVal);
  const isKcal = id === 'm-kcal' || id === 'sticky-kcal' || id === 'm-net' || /kcal/i.test(id || '');
  const displayUnit = unit || '';
  const targetUnit = unit || (isKcal ? ' kcal' : '');
  const isHomePanelTile = !!(cell && (cell.classList.contains('fn-home-macro-row') || cell.classList.contains('fn-calorie-summary-card')));

  if (isHomePanelTile && !isKcal) {
    el.innerHTML = `${rounded}<span class="macro-unit">${displayUnit}</span><span class="macro-goal">/${Math.round(safeTarget)}${targetUnit}</span>`;
  } else {
    el.textContent = rounded + displayUnit;
  }

  let state;
  let semanticState;
  if (numericVal <= 0) {
    state = 'neutral';
    semanticState = 'neutral';
  } else if (higherIsBetter) {
    // Protéines : dans l'esprit du mockup, 90%+ est considéré "dans la zone".
    // Le détail "manque Xg" reste visible, mais le statut ne crie pas à l'alerte.
    state = ratio >= 0.90 ? 'ok' : ratio >= 0.50 ? 'warn' : 'bad';
    semanticState = state;
  } else {
    // Calories / glucides / lipides : OK quand on est dans une zone raisonnable.
    // Le rouge/orange sert aux vrais écarts, pas à une macro simplement un peu en-dessous.
    if (ratio >= 0.80 && ratio <= 1.08) state = 'ok';
    else if ((ratio >= 0.60 && ratio < 0.80) || (ratio > 1.08 && ratio <= 1.20)) state = 'warn';
    else state = 'bad';
    semanticState = ratio > 1.20 ? 'over' : state;
  }
  el.className = 'macro-val ' + state;

  if (cell) {
    cell.style.setProperty('--macro-pct', pctCapped.toFixed(1) + '%');
    cell.style.setProperty('--macro-ratio', Math.max(0, Math.min(1.35, ratio)).toFixed(3));
    cell.style.setProperty('--macro-progress-width', progressWidth.toFixed(1) + '%');
    cell.style.setProperty('--macro-over-width', overWidth.toFixed(1) + '%');
    cell.dataset.progress = Math.round(progressWidth) + '%';
    cell.dataset.ratio = Math.round(ratio * 1000) / 1000;
    cell.classList.remove('macro-state-ok','macro-state-warn','macro-state-bad','macro-state-over','macro-state-neutral');
    cell.classList.add('macro-state-' + semanticState);
    cell.setAttribute('data-state', semanticState);

    const diff = Math.round(safeTarget - numericVal);
    let targetText = '';

    if (id === 'm-kcal') {
      const kcalTarget = document.getElementById('m-kcal-target');
      if (kcalTarget) kcalTarget.textContent = Math.round(safeTarget);
      const kcalPercent = document.getElementById('m-kcal-percent');
      if (kcalPercent) {
        const pctText = (Math.round(ratio * 1000) / 10).toFixed(1).replace('.', ',') + '%';
        kcalPercent.textContent = pctText;
      }
      const kcalStateLine = document.getElementById('m-kcal-state-line');
      if (kcalStateLine) {
        if (semanticState === 'neutral') targetText = 'Suivi actif';
        else if (diff >= 0) targetText = (semanticState === 'ok' ? '✓ ' : '') + 'reste ' + diff + ' kcal';
        else targetText = '⚠ +' + Math.abs(diff) + ' kcal';
        kcalStateLine.textContent = targetText;
        kcalStateLine.className = 'fn-calorie-state-line macro-status-' + semanticState;
      }

      const status = document.getElementById('fn-orbit-status');
      if (status) {
        const statusState = numericVal <= 0 ? 'neutral' : (diff < 0 ? 'over' : (ratio >= 0.9 ? 'ok' : (ratio >= 0.70 ? 'warn' : 'low')));
        status.textContent = numericVal <= 0 ? 'suivi actif' : (diff >= 0 ? 'reste ' + diff + ' kcal' : '+' + Math.abs(diff) + ' kcal');
        status.className = 'fn-orbit-status fn-orbit-status-' + statusState;
        status.setAttribute('data-state', statusState);
      }
    }

    let progress = cell.querySelector('.macro-progress');
    if (!progress) {
      progress = document.createElement('div');
      progress.className = 'macro-progress';
      progress.innerHTML = '<div class="macro-progress-fill"></div>';
      cell.appendChild(progress);
    }
    const fill = progress.querySelector('.macro-progress-fill');
    if (fill) {
      const widthText = semanticState === 'neutral' ? '0%' : progressWidth.toFixed(1) + '%';
      fill.style.width = widthText;
      fill.style.setProperty('--macro-progress-width', widthText);
      fill.className = 'macro-progress-fill ' + semanticState;
    }
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(Math.round(safeTarget)));
    progress.setAttribute('aria-valuenow', String(Math.max(0, Math.round(numericVal))));
    progress.setAttribute('aria-label', (cell.dataset.macro || 'macro') + ' : ' + Math.round(progressWidth) + '% de la cible');

    const targetEl = cell.querySelector('.macro-target');
    if (targetEl) {
      if (semanticState === 'neutral') {
        targetText = 'cible ' + Math.round(safeTarget) + targetUnit;
      } else if (higherIsBetter) {
        targetText = diff > 0 ? 'manque ' + diff + targetUnit + ' · cible ' + Math.round(safeTarget) + targetUnit : 'objectif atteint · cible ' + Math.round(safeTarget) + targetUnit;
      } else {
        targetText = diff >= 0 ? 'reste ' + diff + targetUnit + ' · cible ' + Math.round(safeTarget) + targetUnit : '+' + Math.abs(diff) + targetUnit + ' au-dessus · cible ' + Math.round(safeTarget) + targetUnit;
      }
      targetEl.textContent = targetText;
    }

    const badge = cell.querySelector('.macro-status-badge');
    if (badge) {
      // Symboles texte volontairement simples : les emojis ⚠️ ignorent souvent la couleur CSS
      // et deviennent peu lisibles dans les petites pastilles mobiles.
      const icon = semanticState === 'neutral' ? '•' : (semanticState === 'ok' ? '✓' : (semanticState === 'warn' ? '!' : (semanticState === 'over' ? '!' : '×')));
      const label = semanticState === 'neutral' ? 'Pas encore renseigné' : (semanticState === 'ok' ? 'Dans la cible' : (semanticState === 'warn' ? 'À surveiller' : (semanticState === 'over' ? 'Dépassement' : 'Écart important')));
      badge.textContent = icon;
      badge.className = 'macro-status-badge macro-status-' + semanticState;
      badge.dataset.state = semanticState;
      badge.setAttribute('aria-label', label + (targetText ? ' — ' + targetText : ''));
      badge.title = label;
    }
  }
}

function updateStickySummary(kcal, prot, gluc, lip) {
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const net = Math.round((Number(kcal) || 0) - getSportDepense());
  set('sticky-kcal', Math.round(kcal || 0));
  set('sticky-prot', Math.round(prot || 0) + 'g');
  set('sticky-gluc', Math.round(gluc || 0) + 'g');
  set('sticky-lip', Math.round(lip || 0) + 'g');
  set('sticky-net', net + ' kcal');
}

function updateMacros() {
  if (typeof pruneInvalidSelectedFoodRows === 'function') pruneInvalidSelectedFoodRows();
  let kcal=0,prot=0,gluc=0,lip=0;
  selected.forEach(i => { const a=allAliments[i]; if(!a || isFoodRuntimeDeleted(a) || isFoodLineDeleted(a)) return; const m=getMacros(a,quantities[i]||0); kcal+=Number(m.kcal||0);prot+=Number(m.prot||0);gluc+=Number(m.gluc||0);lip+=Number(m.lip||0); });
  updateMacroTile('m-kcal', kcal, '', PROFIL.cibleKcal, false);
  updateMacroTile('m-prot', prot, 'g', PROFIL.cibleProt, true);
  updateMacroTile('m-gluc', gluc, 'g', PROFIL.cibleGluc, false);
  updateMacroTile('m-lip', lip, 'g', PROFIL.cibleLip, false);
  const netKcal = Math.round((Number(kcal) || 0) - getSportDepense());
  const mNet = document.getElementById('m-net');
  if (mNet) {
    mNet.textContent = netKcal;
    mNet.className = 'macro-val ' + (netKcal <= PROFIL.cibleKcal * 1.08 ? 'ok' : 'warn');
    const netCell = mNet.closest('.macro-cell');
    const netTarget = netCell ? netCell.querySelector('.macro-target') : null;
    if (netTarget) netTarget.textContent = 'après sport · cible ' + PROFIL.cibleKcal;
  }
  { const el = document.getElementById('bilan-apport'); if (el) el.textContent = Math.round(kcal) + ' kcal'; }
  // Mettre à jour le header
  const hm = document.getElementById('header-macros');
  if (hm) {
    const kpct = Math.round(kcal / PROFIL.cibleKcal * 100);
    const ppct = Math.round(prot / PROFIL.cibleProt * 100);
    hm.innerHTML = Math.round(kcal) + ' kcal<br>' + Math.round(prot) + 'g prot';
    hm.style.color = prot >= PROFIL.cibleProt ? 'rgba(167,243,208,1)' : 'rgba(255,255,255,0.75)';
  }
  updateBilan(kcal);
  updateStickySummary(kcal, prot, gluc, lip);
  if (typeof foodnoteUpdateMealGroupRecaps === 'function') foodnoteUpdateMealGroupRecaps();
  if (typeof renderJournalDayCarousel === 'function') renderJournalDayCarousel();
  if (typeof renderSportDayCarousel === 'function') renderSportDayCarousel();
}

function getSportDepense() {
  return sportRows.reduce((sum, r) => {
    const h = parseFloat(document.getElementById('sh-'+r)?.value)||0;
    const k = parseFloat(document.getElementById('sk-'+r)?.value)||0;
    return sum + h * k;
  }, 0);
}

function updateBilan(kcalApport) {
  const dep = getSportDepense();
  const net = kcalApport - dep;
  { const el = document.getElementById('bilan-sport'); if (el) el.textContent = Math.round(dep) + ' kcal'; }
  const el = document.getElementById('bilan-net');
  if (el) { el.textContent = Math.round(net) + ' kcal';
  el.className = 'deficit-val ' + (net > PROFIL.cibleKcal * 1.1 ? 'warn' : net < PROFIL.cibleKcal * 0.8 ? 'bad' : 'ok'); }
  if (typeof renderSportPageSummary === 'function') renderSportPageSummary();
  if (typeof renderSportDayCarousel === 'function') renderSportDayCarousel();
}

function addSportRow(nomPrefill, kcalPrefill, heuresPrefill, totalPrefill) {
  const sports = getSports();
  let prefillTotal = Number(totalPrefill || 0) || 0;
  let prefillHours = Number(heuresPrefill || 0) || 0;
  let prefillKcalH = Number(kcalPrefill || 0) || 0;
  // v12.08 — compatibilité avec les sports saisis en kcal total depuis le bilan.
  // Si une ancienne entrée possède depSport/total mais heures=0, on évite la ligne à 0 kcal.
  if (prefillTotal > 0 && (!prefillHours || !prefillKcalH || Math.round(prefillHours * prefillKcalH) !== Math.round(prefillTotal))) {
    if (prefillKcalH > 0 && !prefillHours) prefillHours = Math.max(0.1, Math.round((prefillTotal / prefillKcalH) * 100) / 100);
    else if (prefillHours > 0 && !prefillKcalH) prefillKcalH = Math.round(prefillTotal / prefillHours);
    else { prefillHours = 1; prefillKcalH = Math.round(prefillTotal); }
  }
  const id = ++sportCounter;
  sportRows.push(id);
  const cats = [...new Set(sports.map(s => s.cat||'Autres'))];
  const opts = cats.map(cat => {
    const items = sports.filter(s => (s.cat||'Autres') === cat);
    return '<optgroup label="' + cat + '">' + items.map(s => '<option value="' + s.kcalH + '" ' + (s.nom===(nomPrefill||'VTT (modéré)')?'selected':'') + '>' + s.nom + ' (' + s.kcalH + ' kcal/h)</option>').join('') + '</optgroup>';
  }).join('') + '<optgroup label="────"><option value="custom">✏ Saisir manuellement...</option></optgroup>';
  const div = document.createElement('div');
  div.id = 'sport-row-' + id;
  div.className = 'fn-ui-row fn-ui-row--sport fn-ui-tile fn-ui-tile-pad';
  div.innerHTML = `
    <div class="fn-ui-sport-row-title"><span aria-hidden="true">🏃</span><span>Activité</span></div>
    <div class="fn-ui-form-row">
      <select id="ss-${id}" onchange="onSportChange(${id})" aria-label="Sport">${opts}</select>
      <input type="text" id="sn-${id}" placeholder="Nom du sport" style="display:none" aria-label="Nom du sport">
      <input type="number" id="sh-${id}" placeholder="heures" step="0.25" min="0" value="${prefillHours || ''}" aria-label="Durée en heures">
      <span class="fn-ui-plain-note">h ×</span>
      <input type="number" id="sk-${id}" placeholder="kcal/h" step="10" min="0" value="${prefillKcalH || (sports.find(s=>s.nom===(nomPrefill||'VTT'))?.kcalH||430)}" aria-label="Calories par heure">
      <span class="fn-ui-plain-note">kcal/h =</span>
      <span id="stot-${id}" class="fn-ui-total-pill">0 kcal</span>
      <button type="button" class="fn-ui-button fn-ui-button-danger" onclick="removeSportRow(${id})" title="Supprimer" aria-label="Supprimer l'activité">✕</button>
    </div>
  `;
  const sportList = document.getElementById('sport-list'); if (!sportList) return; sportList.appendChild(div);
  if (nomPrefill && !sports.some(s => s.nom === nomPrefill)) {
    const sel = document.getElementById('ss-' + id);
    const ni = document.getElementById('sn-' + id);
    const ki = document.getElementById('sk-' + id);
    if (sel) sel.value = 'custom';
    if (ni) { ni.style.display = 'inline'; ni.value = nomPrefill; }
    if (ki && prefillKcalH) ki.value = prefillKcalH;
  }
  ['sh-'+id,'sk-'+id].forEach(eid => {
    document.getElementById(eid)?.addEventListener('input', () => { updateSportRow(id); updateMacros(); if (typeof autoSaveSportOnly === 'function') autoSaveSportOnly(700); });
  });
  document.getElementById('sn-'+id)?.addEventListener('input', () => { updateSportRow(id); if (typeof autoSaveSportOnly === 'function') autoSaveSportOnly(700); });
  updateSportRow(id);
  if (typeof renderSportPageSummary === 'function') renderSportPageSummary();
  if (typeof renderSportDayCarousel === 'function') renderSportDayCarousel();
}

function onSportChange(id) {
  const sel = document.getElementById('ss-' + id);
  const val = sel.options[sel.selectedIndex]?.value;
  const ki = document.getElementById('sk-'+id);
  const ni = document.getElementById('sn-'+id);
  if (val === 'custom') {
    if (ki) { ki.value = ''; ki.style.display = 'inline'; ki.focus(); }
    if (ni) ni.style.display = 'inline';
  } else {
    if (ki) { ki.value = val; ki.style.display = 'inline'; }
    if (ni) ni.style.display = 'none';
  }
  updateSportRow(id); updateMacros(); if (typeof autoSaveSportOnly === 'function') autoSaveSportOnly(700);
}

function updateSportRow(id) {
  const h = parseFloat(document.getElementById('sh-'+id)?.value)||0;
  const k = parseFloat(document.getElementById('sk-'+id)?.value)||0;
  const tot = document.getElementById('stot-'+id);
  if (tot) tot.textContent = Math.round(h*k) + ' kcal';
  let apport = 0;
  selected.forEach(i => { const a=allAliments[i]; if(!a || isFoodRuntimeDeleted(a) || isFoodLineDeleted(a)) return; apport += getMacros(a,quantities[i]||0).kcal; });
  updateBilan(apport);
}

function removeSportRow(id) {
  sportRows = sportRows.filter(r => r !== id);
  document.getElementById('sport-row-' + id)?.remove();
  let apport = 0;
  selected.forEach(i => { const a=allAliments[i]; if(!a || isFoodRuntimeDeleted(a) || isFoodLineDeleted(a)) return; apport += getMacros(a,quantities[i]||0).kcal; });
  updateBilan(apport);
  if (typeof autoSaveSportOnly === 'function') autoSaveSportOnly(250);
  if (typeof renderSportDayCarousel === 'function') renderSportDayCarousel();
}

function foodnoteHasRuntimeJournalLines(list) {
  return Array.isArray(list) && list.some(a => {
    if (!a || typeof a !== 'object' || a.__foodnoteDeletedRuntime || a.__foodnoteDeleted) return false;
    if (a.__journalReplay || a.source === 'journal_replay') return true;
    if (a.line_uid || a.lineUid || a.entryFoodId || a.entry_food_id || a.idInEntry) return true;
    try { if (foodLineUidOf(a) || foodLineIdOf(a)) return true; } catch(e) {}
    return false;
  });
}

function foodnoteCleanCustomFoodListForArrays(list) {
  return (Array.isArray(list) ? list : [])
    .filter(a => a && !a.__foodnoteDeletedRuntime && !isFoodLineDeleted(a))
    .map(a => normalizeAliment(a));
}

function foodnoteJournalSurfaceIsActive() {
  const journal = document.getElementById('page-journal');
  const modal = document.getElementById('food-add-modal');
  if (journal && journal.classList.contains('active')) return true;
  if (modal && modal.classList.contains('is-open')) return true;
  return false;
}

function buildFoodArraysOnly(options = {}) {
  const forceCache = !!(options && options.forceCache === true);
  const preserveRuntime = options && options.preserveRuntime === false ? false : foodnoteJournalSurfaceIsActive();

  // beta 0.22.49 : le cache global des aliments ne doit jamais remplacer
  // les lignes runtime de la journée ouverte. Ces lignes portent line_uid /
  // entryFoodId ; le cache compact, lui, ne garde que des fiches aliment.
  if (!forceCache && preserveRuntime && foodnoteHasRuntimeJournalLines(customAliments)) {
    customAliments = foodnoteCleanCustomFoodListForArrays(customAliments);
    allAliments = [...ALIMENTS_BASE, ...customAliments];
    return;
  }

  customAliments = foodnoteCleanCustomFoodListForArrays(getCustomList())
    .filter(a => !a.__journalReplay && a.source !== 'journal_replay');
  // Nettoie les anciennes lignes déjà contaminées par les fausses unités automatiques,
  // sans construire toute l'interface aliments au démarrage.
  const cleanedCustom = customAliments.map(a => foodnoteKnownUnitFalsePositive(a) ? clearFoodUnitMeta({...a}) : sanitizeFoodUnitMeta(a));
  if (JSON.stringify(cleanedCustom) !== JSON.stringify(customAliments)) {
    customAliments = cleanedCustom;
    try { saveCustomList(); } catch(e) {}
  }
  allAliments = [...ALIMENTS_BASE, ...customAliments];
}

function buildLists(options = {}) {
  const light = options && options.light === true;
  buildFoodArraysOnly();

  // Mode manuel : on affiche uniquement les aliments créés/réutilisés par l'utilisateur.
  // En démarrage léger avec une journée déjà existante, editEntry() reconstruit seulement
  // les lignes du journal courant. On évite donc de créer toute la liste deux fois.
  const customContainer = document.getElementById('list-custom');
  if (customContainer) customContainer.innerHTML = '';
  if (!light) {
    customAliments.forEach((a, ci) => {
      createRow(a, ALIMENTS_BASE.length + ci, true, false);
    });
  }

  if (customContainer && !customAliments.length) {
    customContainer.innerHTML = '<div class="empty-state fn-ui-note-compact fn-ui-pad-md">Aucune entrée pour l’instant. Ajoute un aliment ci-dessus.</div>';
  }

  initMealToggle();
  if (!light) {
    renderMealGrouping();
    updateMacros();
  }
  refreshDBSelect();
}
window.buildFoodArraysOnly = buildFoodArraysOnly;

function previewMacros() {
  const el = document.getElementById('new-preview');
  const qtyEl = document.getElementById('new-qty');
  const kcalEl = document.getElementById('new-kcal');
  const protEl = document.getElementById('new-prot');
  const glucEl = document.getElementById('new-gluc');
  const lipEl = document.getElementById('new-lip');
  // Le formulaire manuel global a été retiré en UX v10.5.
  // La fonction reste tolérante pour compatibilité avec d'anciens appels.
  if (!el || !qtyEl || !kcalEl || !protEl || !glucEl || !lipEl) return;
  const qty = parseFloat(qtyEl.value)||0;
  const k = parseFloat(kcalEl.value)||0;
  const p = parseFloat(protEl.value)||0;
  const g = parseFloat(glucEl.value)||0;
  const l = parseFloat(lipEl.value)||0;
  if (qty > 0 && (k||p||g||l)) {
    const f = 100/qty;
    el.textContent = '→ Pour 100g : ' + Math.round(k*f) + ' kcal · ' + Math.round(p*f*10)/10 + 'g prot · ' + Math.round(g*f*10)/10 + 'g gluc · ' + Math.round(l*f*10)/10 + 'g lip';
    el.style.color = '#1d9e75';
  } else {
    el.textContent = '';
  }
}

function makeFoodLineUid() {
  return 'fl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function stripEntryRuntimeMeta(food) {
  if (!food || typeof food !== 'object') return food;
  delete food.entryFoodId;
  delete food.entry_food_id;
  delete food.line_uid;
  delete food.lineUid;
  return food;
}

// Cycle de vie d'une ligne de repas : l'index UI peut changer, l'id SQLite arrive après l'ajout.
// La vraie identité temporaire est donc line_uid, puis elle est réconciliée avec entryFoodId.
const FOOD_LINE_SYNC = window.FOODNOTE_FOOD_LINE_SYNC || (window.FOODNOTE_FOOD_LINE_SYNC = {
  pendingByUid: new Map(),
  tombstones: new Set(),
  serverIdByUid: new Map()
});

function foodLineUidOf(foodOrUid) {
  if (!foodOrUid) return '';
  if (typeof foodOrUid === 'string') return foodOrUid.trim();
  return String(foodOrUid.line_uid || foodOrUid.lineUid || '').trim();
}

function ensureFoodLineUid(food) {
  if (!food || typeof food !== 'object') return '';
  const uid = foodLineUidOf(food) || makeFoodLineUid();
  food.line_uid = uid;
  food.lineUid = uid;
  return uid;
}

function foodLineIdOf(food) {
  const raw = food && (food.entryFoodId || food.entry_food_id || food.id || food.idInEntry);
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function rememberFoodLineServerId(uid, id) {
  uid = foodLineUidOf(uid);
  id = Number(id);
  if (uid && Number.isFinite(id) && id > 0) FOOD_LINE_SYNC.serverIdByUid.set(uid, id);
}

function markFoodLineDeleted(foodOrUid) {
  const uid = foodLineUidOf(foodOrUid);
  if (uid) FOOD_LINE_SYNC.tombstones.add(uid);
  return uid;
}

function isFoodLineDeleted(foodOrUid) {
  const uid = foodLineUidOf(foodOrUid);
  return !!uid && FOOD_LINE_SYNC.tombstones.has(uid);
}

function trackFoodLineWrite(uid, promise) {
  uid = foodLineUidOf(uid);
  if (!uid || !promise || typeof promise.finally !== 'function') return promise;
  FOOD_LINE_SYNC.pendingByUid.set(uid, promise);
  return promise.finally(() => {
    if (FOOD_LINE_SYNC.pendingByUid.get(uid) === promise) FOOD_LINE_SYNC.pendingByUid.delete(uid);
  });
}

function markFoodRuntimeDeleted(food, uid = '') {
  if (!food || typeof food !== 'object') return food;
  const lineUid = foodLineUidOf(uid) || foodLineUidOf(food);
  food.__foodnoteDeletedRuntime = true;
  food.__deleted = true;
  if (lineUid) {
    food.line_uid = lineUid;
    food.lineUid = lineUid;
  }
  return food;
}

function isFoodRuntimeDeleted(food) {
  return !!(food && (food.__foodnoteDeletedRuntime || food.__deleted || food._deleted));
}

function isFoodLineActiveForUi(food) {
  return !!(food && typeof food === 'object' && !isFoodRuntimeDeleted(food) && !isFoodLineDeleted(food));
}
window.isFoodLineActiveForUi = isFoodLineActiveForUi;

function findActiveFoodIndexByNameMeal(name, meal) {
  const key = normalizeSearchText ? normalizeSearchText(name || '') : String(name || '').toLowerCase().trim();
  const targetMeal = normalizeMealId(meal || 'lunch');
  if (!key || !Array.isArray(allAliments)) return -1;
  return allAliments.findIndex(a =>
    isFoodLineActiveForUi(a) &&
    (normalizeSearchText ? normalizeSearchText(a.nom || '') : String(a.nom || '').toLowerCase().trim()) === key &&
    normalizeMealId(a.meal || 'lunch') === targetMeal
  );
}

function findActiveFoodIndexByName(name) {
  const key = normalizeSearchText ? normalizeSearchText(name || '') : String(name || '').toLowerCase().trim();
  if (!key || !Array.isArray(allAliments)) return -1;
  return allAliments.findIndex(a =>
    isFoodLineActiveForUi(a) &&
    (normalizeSearchText ? normalizeSearchText(a.nom || '') : String(a.nom || '').toLowerCase().trim()) === key
  );
}

function reconcileVisibleMealLines(reason = 'reconcile', options = {}) {
  // Moteur ligne-repas : la source UI est selected + active food line.
  // Les tombstones restent en mémoire pour stabiliser les anciens handlers, mais ne doivent
  // jamais compter dans le journal visible ni bloquer un nouvel ajout.
  const opts = { regroup:true, currentMeal:true, carousel:true, macros:true, ...options };
  try {
    if (!Array.isArray(allAliments) || !(selected && typeof selected.forEach === 'function')) return false;
    const customContainer = document.getElementById('list-custom');
    if (customContainer && customContainer.querySelector('.empty-state') && selected.size) customContainer.innerHTML = '';

    Array.from(selected).forEach(i => {
      const idx = Number(i);
      const food = allAliments[idx];
      if (!Number.isFinite(idx) || !isFoodLineActiveForUi(food)) {
        selected.delete(i);
        delete quantities[i];
      }
    });

    Array.from(selected).sort((a, b) => Number(a) - Number(b)).forEach(i => {
      const idx = Number(i);
      const food = allAliments[idx];
      if (idx >= ALIMENTS_BASE.length && isFoodLineActiveForUi(food)) {
        if (!document.getElementById('row-' + idx) && typeof ensureFoodRowExists === 'function') ensureFoodRowExists(idx);
        const row = document.getElementById('row-' + idx);
        if (row) {
          row.classList.add('selected');
          row.dataset.foodIdx = String(idx);
          const uid = foodLineUidOf(food);
          if (uid) row.dataset.lineUid = uid;
        }
        const qi = document.getElementById('qty-' + idx);
        if (qi && document.activeElement !== qi) qi.value = Number(quantities[idx] ?? food.defaut ?? 0) || 0;
      }
    });

    if (opts.regroup && typeof renderMealGrouping === 'function') renderMealGrouping();
    if (Number.isFinite(Number(opts.focusIdx)) && typeof openMealGroupForFood === 'function') openMealGroupForFood(Number(opts.focusIdx));
    if (opts.macros && typeof updateMacros === 'function') updateMacros();
    if (opts.currentMeal && typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
    if (opts.carousel && typeof renderJournalDayCarousel === 'function') renderJournalDayCarousel();
    if (typeof foodnoteUpdateMealGroupRecaps === 'function') foodnoteUpdateMealGroupRecaps();
    try { foodnoteRestoreActiveEditAfterRender('reconcile-' + reason); } catch(e) {}
    return true;
  } catch(e) {
    console.warn('[FoodNote] réconciliation repas impossible', reason, e);
    return false;
  }
}
window.reconcileVisibleMealLines = reconcileVisibleMealLines;
window.foodnoteReconcileVisibleMealLines = reconcileVisibleMealLines;

function findFoodIndexByLineUid(uid) {
  uid = foodLineUidOf(uid);
  if (!uid || !Array.isArray(allAliments)) return -1;
  return allAliments.findIndex(a => a && !isFoodRuntimeDeleted(a) && !isFoodLineDeleted(a) && (a.line_uid === uid || a.lineUid === uid));
}

function findFoodIndexForSavedFood(savedFood) {
  if (!savedFood || !Array.isArray(allAliments)) return -1;
  const uid = foodLineUidOf(savedFood);
  const id = foodLineIdOf(savedFood);
  if (uid) {
    const byUid = findFoodIndexByLineUid(uid);
    if (byUid >= 0) return byUid;
  }
  if (id) {
    const byId = allAliments.findIndex(a => isFoodLineActiveForUi(a) && foodLineIdOf(a) === id);
    if (byId >= 0) return byId;
  }
  // Compat ancienne réponse sans line_uid/id : fallback seulement si aucune identité stable n'est disponible.
  if (!uid && !id) {
    const targetMeal = normalizeMealId(savedFood.meal || savedFood.repas || 'lunch');
    const targetName = normalizeSearchText(savedFood.nom || savedFood.name || '');
    return allAliments.findIndex(a => isFoodLineActiveForUi(a) && normalizeSearchText(a.nom || '') === targetName && normalizeMealId(a.meal || 'lunch') === targetMeal);
  }
  return -1;
}

function recalcEntryMacrosFromFoodRows(entry) {
  if (!entry || !Array.isArray(entry.aliments)) return entry;
  const sums = entry.aliments.reduce((acc, a) => {
    acc.kcal += Number(a && a.kcal || 0) || 0;
    acc.prot += Number(a && a.prot || 0) || 0;
    acc.gluc += Number(a && a.gluc || 0) || 0;
    acc.lip += Number(a && a.lip || 0) || 0;
    return acc;
  }, {kcal:0, prot:0, gluc:0, lip:0});
  const depSport = Number(entry.depSport ?? entry.dep_sport ?? 0) || 0;
  entry.macros = {
    kcal: Math.round(sums.kcal),
    prot: round1(sums.prot),
    gluc: round1(sums.gluc),
    lip: round1(sums.lip)
  };
  entry.kcal = entry.macros.kcal;
  entry.prot = entry.macros.prot;
  entry.gluc = entry.macros.gluc;
  entry.lip = entry.macros.lip;
  entry.netKcal = Math.round(entry.macros.kcal - depSport);
  entry.net_kcal = entry.netKcal;
  return entry;
}

function safeReusableQty(raw, fallback = 100) {
  const q = Number(raw?.qty ?? raw?.quantite ?? raw?.quantity ?? raw?.defaut ?? fallback);
  if (!Number.isFinite(q) || q < 5 || q > 1500) return fallback;
  return Math.round(q);
}

let _foodnoteAfterFoodAddJobs = [];
let _foodnoteAfterFoodAddScheduled = false;

function foodnoteJournalAddCriticalActive() {
  try { return Date.now() < Number(window.__foodnoteJournalAddCriticalUntil || 0); }
  catch(e) { return false; }
}

function foodnoteMarkJournalAddCritical(ms = 2200) {
  try {
    const until = Date.now() + Math.max(500, Number(ms) || 2200);
    window.__foodnoteJournalAddCriticalUntil = until;
    window.__foodnoteSuppressDBRefreshUntil = Math.max(Number(window.__foodnoteSuppressDBRefreshUntil || 0), until);
  } catch(e) {}
}

function foodnoteAfterNextPaint(fn) {
  const run = () => { try { fn(); } catch(e) { console.warn('[FoodNote] post-ajout journal impossible', e); } };
  const delay = foodnoteJournalAddCriticalActive() ? 220 : 0;
  try {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => setTimeout(run, delay));
      return;
    }
  } catch(e) {}
  setTimeout(run, delay);
}

function foodnoteScheduleAfterFoodAdd(idx, reason = 'add') {
  _foodnoteAfterFoodAddJobs.push({ idx, reason });
  if (_foodnoteAfterFoodAddScheduled) return;
  _foodnoteAfterFoodAddScheduled = true;
  foodnoteAfterNextPaint(() => {
    const jobs = _foodnoteAfterFoodAddJobs.splice(0);
    _foodnoteAfterFoodAddScheduled = false;
    const last = jobs[jobs.length - 1] || {};
    const focusIdx = Number.isFinite(Number(last.idx)) ? Number(last.idx) : null;

    try {
      if (typeof reconcileVisibleMealLines === 'function') {
        reconcileVisibleMealLines(last.reason || reason || 'add-deferred', {
          focusIdx,
          regroup: true,
          macros: true,
          currentMeal: true,
          carousel: true
        });
      } else {
        if (typeof renderMealGrouping === 'function') renderMealGrouping();
        if (typeof updateMacros === 'function') updateMacros();
      }
    } catch(e) {}
    if (focusIdx != null && focusIdx >= 0) {
      try { if (typeof placeFoodBlockAtTop === 'function') placeFoodBlockAtTop(focusIdx); } catch(e) {}
    }
  });
}

function foodnotePersistFoodLineSoon(idx, reason = 'add') {
  setTimeout(() => {
    try { if (typeof persistFoodLineToSQLite === 'function') persistFoodLineToSQLite(idx, reason); }
    catch(e) { console.warn('[FoodNote] sauvegarde différée aliment impossible', e); }
  }, 0);
}

function addCustomAliment(aIn) {
  if (typeof resetFoodAddGroqVisualState === 'function' && (typeof foodAddMode === 'undefined' || foodAddMode !== 'ia')) resetFoodAddGroqVisualState();
  const nom = aIn ? aIn.nom : (document.getElementById('new-nom')?.value.trim() || '');
  if (!nom) { alert('Indique un nom.'); return; }
  if (aIn) aIn = sanitizeFoodUnitMeta(withUnitDefaults(aIn));
  const qty = aIn ? aIn.defaut : (parseFloat(document.getElementById('new-qty')?.value)||100);
  // aIn passes already-converted per100 values; form inputs are for the real quantity
  const rawK = aIn ? null : (parseFloat(document.getElementById('new-kcal')?.value)||0);
  const rawP = aIn ? null : (parseFloat(document.getElementById('new-prot')?.value)||0);
  const rawG = aIn ? null : (parseFloat(document.getElementById('new-gluc')?.value)||0);
  const rawL = aIn ? null : (parseFloat(document.getElementById('new-lip')?.value)||0);
  if (!aIn && rawK === 0 && rawP === 0 && rawG === 0 && rawL === 0) {
    alert('Remplis au moins les calories (kcal) pour ajouter cet aliment.\nOu utilise le bouton G pour estimer avec Groq.');
    document.getElementById('new-kcal')?.focus();
    return;
  }
  const f = qty > 0 ? 100/qty : 1;
  const k = aIn ? aIn.kcal100 : Math.round(rawK * f);
  const p = aIn ? aIn.prot100 : Math.round(rawP * f * 10) / 10;
  const g = aIn ? aIn.gluc100 : Math.round(rawG * f * 10) / 10;
  const l = aIn ? aIn.lip100 : Math.round(rawL * f * 10) / 10;

  const candidateForGuard = {
    ...(aIn || {}),
    nom,
    defaut: qty,
    kcal100: k,
    prot100: p,
    gluc100: g,
    lip100: l,
    unite: (aIn && aIn.unite) || 'g',
    poidsUnite: aIn ? saneUnitWeightForFood(aIn) : null,
    uniteLabel: (aIn && aIn.uniteLabel) || ''
  };
  if (!foodnoteValidateFoodBeforeSave(candidateForGuard, {qty, title:'Aliment impossible ou suspect', lineTitle:'Quantité suspecte'})) return;

  // 0.22.118 : le clic d'ajout doit rester ultra court. Pendant la fenêtre critique,
  // on bloque les recalculs de recherche/BDD et on décale les rendus lourds après le repaint.
  foodnoteMarkJournalAddCritical(2400);

  const targetMeal = normalizeMealId((aIn && aIn.meal && aIn.meal !== 'none') ? aIn.meal : (foodAddTargetMeal || 'lunch'));
  const foodNameKey = nom.toLowerCase().trim();
  const sameNameIdx = findActiveFoodIndexByName(nom);

  // Anti-doublons limité au même repas, uniquement sur les lignes actives.
  // Invariant 0.22.10 : un tombstone de suppression ne doit jamais être réutilisé
  // par un nouvel ajout, sinon la ligne peut rester invisible jusqu'au refresh.
  const existIdx = findActiveFoodIndexByNameMeal(nom, targetMeal);
  if (existIdx >= 0) {
    // Aliment déjà présent dans CE repas — on met à jour la quantité.
    // Si le même nom existe dans un autre repas, on crée une nouvelle ligne plus bas.
    const qty2 = aIn ? aIn.defaut : (parseFloat(document.getElementById('new-qty')?.value)||100);
    // 0.22.0 : le journal reste strictement en grammes, même si la fiche aliment possède un poids par unité.
    clearFoodUnitMeta(allAliments[existIdx]);
    if (customAliments[existIdx - ALIMENTS_BASE.length]) clearFoodUnitMeta(customAliments[existIdx - ALIMENTS_BASE.length]);
    const ci2 = existIdx - ALIMENTS_BASE.length;
    allAliments[existIdx].meal = targetMeal;
    if (customAliments[ci2]) customAliments[ci2].meal = targetMeal;
    selected.add(existIdx);
    quantities[existIdx] = qty2;
    showJournalLastAdded(existIdx);
    if (typeof resetFoodAddGroqVisualState === 'function') resetFoodAddGroqVisualState();
    foodnoteScheduleAfterFoodAdd(existIdx, 'add-existing');
    foodnotePersistFoodLineSoon(existIdx, 'add-existing');
    setTimeout(() => {
      try {
        ensureFoodRowExists(existIdx);
        const row2 = document.getElementById('row-' + existIdx);
        const qi2 = document.getElementById('qty-' + existIdx);
        if (row2) { row2.classList.add('selected'); row2.style.background='var(--green-bg)'; setTimeout(()=>{row2.style.background='';},1200); }
        if (qi2 && document.activeElement !== qi2) qi2.value = qty2;
        updatePill(existIdx);
        previewMacros();
      } catch(e) { console.warn('[FoodNote] rendu différé ligne existante impossible', e); }
    }, foodnoteJournalAddCriticalActive() ? 240 : 80);
    return;
  }

  const bdd = getBDD();
  const shouldSaveToBase = !(aIn && (aIn.saveToBase === false || aIn.journalOnly === true));
  let bddId = aIn ? aIn.bddId : null;
  if (shouldSaveToBase && !bddId && sameNameIdx >= 0 && allAliments[sameNameIdx]?.bddId) {
    // Réutilise la même fiche BDD pour éviter de dupliquer la base,
    // mais crée bien une ligne distincte dans le repas cible.
    bddId = allAliments[sameNameIdx].bddId;
  }
  if (shouldSaveToBase && !bddId) {
    bddId = Date.now();
    const bddFoodToSave = sanitizeFoodUnitMeta({id:bddId, nom, kcal100:k, prot100:p, gluc100:g, lip100:l, unite:(aIn && aIn.unite) || 'g', poidsUnite:(aIn ? saneUnitWeightForFood(aIn) : null), uniteLabel:(aIn && aIn.uniteLabel) || ''});
    bdd.push(bddFoodToSave);
    // 0.22.118 : saveBDD() peut normaliser une grosse base ; on l'écarte du chemin critique.
    setTimeout(() => { try { saveBDD(bdd); } catch(e) { console.warn('[FoodNote] sauvegarde BDD différée impossible', e); } }, 950);
    try {
      if (typeof saveSingleFoodNativeNow === 'function') {
        saveSingleFoodNativeNow(bddFoodToSave).then(saved => {
          if (saved && saved.id && String(saved.id) !== String(bddId)) {
            const oldId = bddId;
            bddId = saved.id;
            const current = getBDD();
            const i = current.findIndex(x => String(x.id) === String(oldId) || (typeof normalizeSearchText === 'function' && normalizeSearchText(x.nom) === normalizeSearchText(saved.nom)));
            if (i >= 0) current[i] = {...current[i], ...saved};
            _db.bdd_aliments = current;
            saveFoodnoteDbLocalCache && saveFoodnoteDbLocalCache();
          }
        }).catch(e => console.warn('/api/foods sauvegarde aliment libre impossible', e));
      }
    } catch(e) {}
  }
  if (!shouldSaveToBase) bddId = null;

  const inheritedSameName = sameNameIdx >= 0 ? sanitizeFoodUnitMeta(allAliments[sameNameIdx]) : null;
  const a = sanitizeFoodUnitMeta({
    nom,
    unite:'g',
    poidsUnite:null,
    uniteLabel:'',
    defaut:qty,
    kcal100:k,
    prot100:p,
    gluc100:g,
    lip100:l,
    cat:'custom',
    bddId,
    meal:targetMeal,
    line_uid: makeFoodLineUid()
  });
  const customContainer = document.getElementById('list-custom');
  if (customContainer && customContainer.querySelector('.empty-state')) customContainer.innerHTML = '';

  customAliments.push(a);
  allAliments = [...ALIMENTS_BASE, ...customAliments];
  saveCustomList();

  const newIdx = allAliments.length - 1;
  selected.add(newIdx);
  quantities[newIdx] = qty;

  // 0.22.118 : ne construit plus immédiatement toute la ligne DOM repas au moment exact du clic.
  // La ligne existe déjà dans l'état JS + SQLite peut sauvegarder ; le rendu visuel est recréé juste après.
  showJournalLastAdded(newIdx);
  if (typeof resetFoodAddGroqVisualState === 'function') resetFoodAddGroqVisualState();
  foodnoteScheduleAfterFoodAdd(newIdx, 'add-new');
  foodnotePersistFoodLineSoon(newIdx, 'add-new');

  if (!aIn) ['new-nom','new-qty','new-kcal','new-prot','new-gluc','new-lip'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Réinitialiser le champ de recherche AVANT toute éventuelle réconciliation : sinon refreshDBSelect()
  // peut refaire une recherche CIQUAL/OpenFoodFacts/Base pendant le clic "Ajouter".
  const dbSearch = document.getElementById('db-search');
  if (dbSearch) dbSearch.value = '';
  const dbQty = document.getElementById('db-qty');
  if (dbQty) dbQty.value = 100;
  const suggestionsEl = document.getElementById('db-suggestions');
  if (suggestionsEl) { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('visible'); }
  document.getElementById('db-selected-id') && (document.getElementById('db-selected-id').value = '');
  dbSelectedFood = null;
  updateDBSelectedCard && updateDBSelectedCard(null);
  setFoodAddExpanded(true);

  setTimeout(() => {
    try {
      ensureFoodRowExists(newIdx);
      const row = document.getElementById('row-' + newIdx);
      const qi = document.getElementById('qty-' + newIdx);
      if (row) {
        row.classList.add('selected');
        row.style.transition = 'background 0.3s';
        row.style.background = 'var(--green-bg)';
        setTimeout(() => { row.style.background = ''; }, 1200);
      }
      if (qi && document.activeElement !== qi) qi.value = qty;
      updatePill(newIdx);
      previewMacros();
    } catch(e) { console.warn('[FoodNote] rendu différé de la ligne ajoutée impossible', e); }
  }, foodnoteJournalAddCriticalActive() ? 240 : 80);
}


function normalizeHistoryFoodItemForReuse(item) {
  const out = sanitizeFoodUnitMeta({...(item || {})});
  // 0.22.2 : une suggestion rapide est une proposition, pas une ligne de journal à rejouer telle quelle.
  // On force les grammes et on neutralise les anciennes valeurs corrompues type 0.8g ou unité héritée.
  const q = safeReusableQty(out, 100);
  out.qty = q;
  out.defaut = q;
  out.unite = 'g';
  out.unit = 'g';
  out.poidsUnite = null;
  out.unit_weight = null;
  out.uniteLabel = '';
  out.unit_label = '';
  stripEntryRuntimeMeta(out);
  return out;
}


function getFoodMacrosFromHistoryItem(item) {
  item = normalizeHistoryFoodItemForReuse(item || {});
  const qty = safeReusableQty(item, 100);
  const bdd = getBDD ? getBDD() : [];
  const bddItem = bdd.find(b => normalizeSearchText(b.nom) === normalizeSearchText(item.nom));
  if (bddItem) {
    const cleanBdd = sanitizeFoodUnitMeta(bddItem);
    const candidate = {
      kcal100: Number(cleanBdd.kcal100) || 0,
      prot100: Number(cleanBdd.prot100) || 0,
      gluc100: Number(cleanBdd.gluc100) || 0,
      lip100: Number(cleanBdd.lip100) || 0,
      bddId: cleanBdd.id || cleanBdd.bddId || null,
      source: cleanBdd.source || 'base'
    };
    try {
      const guard = foodnoteNutritionCheckFood100({ nom:item.nom, ...candidate });
      if (!guard || guard.ok) return candidate;
    } catch(e) { return candidate; }
    // Base locale corrompue : on n'utilise pas cette fiche pour une suggestion rapide.
    // On tente de reconstruire depuis l'historique, puis l'utilisateur pourra corriger la fiche.
  }
  const total = {
    kcal: Number(item.kcal),
    prot: Number(item.prot),
    gluc: Number(item.gluc),
    lip: Number(item.lip)
  };
  const hasSavedTotals = Number.isFinite(total.kcal) || Number.isFinite(total.prot) || Number.isFinite(total.gluc) || Number.isFinite(total.lip);
  if (hasSavedTotals && qty >= 5) {
    const f = 100 / qty;
    const derived = {
      kcal100: Math.round((Number.isFinite(total.kcal) ? total.kcal : 0) * f),
      prot100: round1((Number.isFinite(total.prot) ? total.prot : 0) * f),
      gluc100: round1((Number.isFinite(total.gluc) ? total.gluc : 0) * f),
      lip100: round1((Number.isFinite(total.lip) ? total.lip : 0) * f),
      bddId: null,
      source: 'historique'
    };
    try {
      const guard = foodnoteNutritionCheckFood100({ nom:item.nom, ...derived });
      if (!guard || guard.ok) return derived;
    } catch(e) { return derived; }
  }
  return null;
}


function openFoodFromSuggestionItem(item) {
  if (!item || !item.nom) return false;
  const normalized = normalizeHistoryFoodItemForReuse(item);
  const macros = getFoodMacrosFromHistoryItem(normalized);
  const qty = safeReusableQty(item, 100);
  if (!macros) {
    const input = document.getElementById('db-search');
    const qtyEl = document.getElementById('db-qty');
    if (input) input.value = normalized.nom;
    if (qtyEl) qtyEl.value = String(qty);
    if (typeof handleDBSearchInput === 'function') handleDBSearchInput();
    return false;
  }
  const food = sanitizeFoodUnitMeta(withUnitDefaults({
    nom: normalized.nom,
    defaut: qty,
    unite: 'g',
    poidsUnite: null,
    uniteLabel: '',
    kcal100: macros.kcal100,
    prot100: macros.prot100,
    gluc100: macros.gluc100,
    lip100: macros.lip100,
    bddId: macros.bddId || normalized.bddId || null,
    source: macros.source || normalized.source || 'suggestion'
  }));
  stripEntryRuntimeMeta(food);
  if (typeof openDBQuantitySelector === 'function') {
    openDBQuantitySelector(food, { source: food.source || 'suggestion', qty, bddId: food.bddId || null });
    return true;
  }
  addCustomAliment({ ...food, defaut: qty, meal: foodAddTargetMeal || 'lunch' });
  return true;
}
window.openFoodFromSuggestionItem = openFoodFromSuggestionItem;

function addFoodFromHistoryItem(item) {
  if (!item || !item.nom) return;
  item = normalizeHistoryFoodItemForReuse(item);
  const macros = getFoodMacrosFromHistoryItem(item);
  if (!macros) {
    document.getElementById('db-search').value = item.nom;
    document.getElementById('db-qty').value = item.qty || 100;
    handleDBSearchInput();
    return;
  }
  addCustomAliment({
    nom: item.nom,
    defaut: Number(item.qty) || 100,
    unite: 'g',
    poidsUnite: null,
    uniteLabel: '',
    kcal100: macros.kcal100,
    prot100: macros.prot100,
    gluc100: macros.gluc100,
    lip100: macros.lip100,
    bddId: macros.bddId || null,
    meal: foodAddTargetMeal || 'lunch',
  });
}


// Ancienne mémoire rapide supprimée : l'ajout passe désormais par la recherche intégrée,
// les aliments récents peuvent être retrouvés via l'historique et la base personnelle.


let dbSuggestionIndex = -1;
let dbSuggestionItems = [];
let dbSelectedFood = null;
let dbQuantityFood = null;
let dbQuantityMeta = null;
let dbQuantitySearchLockUntil = 0;
let dbQuantityLastValue = 100;
let dbQuantityDefaultAtOpen = 100;
let dbQuantityLastTouchedAt = 0;
let dbQuantityOpenedAt = 0;
let dbQuantityUserValue = null;
let dbQuantityUserTouchedAt = 0;
let dbQuantityUserEditValue = null;
let dbQuantityUserEditAt = 0;
let dbAutoTimer = null;
let dbAutoToken = 0;

// FoodNote beta 0.22.105 : passerelle d'état du flux recherche/quantité.
// Le module 30 garde le rendu historique, mais le domaine alimentaire + SearchResults pilotent
// la sélection des résultats, la quantité et l'ajout final au journal.
try {
  if (!window.FoodNoteFoodAddSearchState) {
    window.FoodNoteFoodAddSearchState = {
      get selectedFood() { return dbSelectedFood; },
      set selectedFood(value) { dbSelectedFood = value; },
      get quantityFood() { return dbQuantityFood; },
      set quantityFood(value) { dbQuantityFood = value; },
      get quantityMeta() { return dbQuantityMeta; },
      set quantityMeta(value) { dbQuantityMeta = value; },
      clearSelection() {
        dbSelectedFood = null;
        dbSuggestionIndex = -1;
        try { updateDBSelectedCard && updateDBSelectedCard(null); } catch(e) {}
      },
      readQuantity() {
        try { return typeof dbQuantityReadValue === 'function' ? dbQuantityReadValue() : 100; }
        catch(e) { return 100; }
      },
      getUserQuantity() {
        try {
          return (dbQuantityUserTouchedAt >= dbQuantityOpenedAt && Number.isFinite(Number(dbQuantityUserValue)) && Number(dbQuantityUserValue) > 0)
            ? Number(dbQuantityUserValue)
            : null;
        } catch(e) { return null; }
      },
      setQuantity(value) {
        try { if (typeof setDBQuantityValue === 'function') return setDBQuantityValue(value); } catch(e) {}
      },
      nudgeQuantity(delta) {
        try { if (typeof nudgeDBQuantity === 'function') return nudgeDBQuantity(delta); } catch(e) {}
      },
      getQuery() {
        try { return String(document.getElementById('db-search')?.value || '').trim(); } catch(e) { return ''; }
      },
      getSuggestions() {
        try { return Array.isArray(dbSuggestionItems) ? dbSuggestionItems.slice() : []; } catch(e) { return []; }
      },
      getSuggestion(index) {
        try { return Array.isArray(dbSuggestionItems) ? dbSuggestionItems[Number(index)] || null : null; } catch(e) { return null; }
      },
      pickSuggestion(index) {
        try { if (typeof pickDBSuggestion === 'function') return pickDBSuggestion(Number(index)); } catch(e) {}
        return null;
      },
      clearSuggestions() {
        try { hideDBSuggestionsOnly(); } catch(e) {}
        try { dbSuggestionItems = []; dbSuggestionIndex = -1; } catch(e) {}
      },
      closeQuantity(options) {
        try { if (typeof closeDBQuantitySelector === 'function') return closeDBQuantitySelector(options || {keepSearch:true}); } catch(e) {}
      },
      clearAfterAdd(message) {
        try { if (typeof resetFoodAddSearchAfterAdd === 'function') return resetFoodAddSearchAfterAdd(message); } catch(e) {}
      },
      snapshot() {
        return {
          hasSelectedFood: !!dbSelectedFood,
          selectedName: dbSelectedFood && dbSelectedFood.nom || '',
          hasQuantityFood: !!dbQuantityFood,
          quantityName: dbQuantityFood && dbQuantityFood.nom || '',
          quantityValue: (() => { try { return typeof dbQuantityReadValue === 'function' ? dbQuantityReadValue() : null; } catch(e) { return null; } })(),
          quantityMeta: dbQuantityMeta ? {...dbQuantityMeta} : null,
          suggestionCount: Array.isArray(dbSuggestionItems) ? dbSuggestionItems.length : 0
        };
      }
    };
  }
} catch(e) {}

// Index mémoire pour la recherche d'aliments.
// Avant 0.21.18.2, chaque frappe reconstruisait toute la base, normalisait les noms,
// triait et faisait le fuzzy sur toutes les lignes. Sur une grosse base SQLite, cela
// rendait l'input lent. Ici on garde le même résultat logique, mais on pré-indexe.
let _foodSearchCache = null;
let _foodSearchCacheSignature = '';
let _foodSearchLastKey = '';
let _foodSearchLastResult = null;
let _foodSearchBuildState = null;
let _foodSearchBuildTimer = null;

function invalidateFoodSearchCache() {
  _foodSearchCache = null;
  _foodSearchCacheSignature = '';
  _foodSearchLastKey = '';
  _foodSearchLastResult = null;
  _foodSearchBuildState = null;
  if (_foodSearchBuildTimer) clearTimeout(_foodSearchBuildTimer);
  _foodSearchBuildTimer = null;
}
window.invalidateFoodSearchCache = invalidateFoodSearchCache;

function foodSearchListSignature(list) {
  const arr = Array.isArray(list) ? list : [];
  const len = arr.length;
  if (!len) return '0';
  const first = arr[0] || {};
  const mid = arr[Math.floor(len / 2)] || {};
  const last = arr[len - 1] || {};
  return [
    len,
    first.id ?? first.nom ?? first.name ?? '',
    mid.id ?? mid.nom ?? mid.name ?? '',
    last.id ?? last.nom ?? last.name ?? ''
  ].join('|');
}

function foodnoteNowMs() {
  try { return performance.now(); } catch(e) { return Date.now(); }
}

function foodnoteScheduleSearchSlice(delay = 0) {
  if (_foodSearchBuildTimer) return;
  _foodSearchBuildTimer = setTimeout(() => {
    _foodSearchBuildTimer = null;
    try { processFoodSearchCacheSlice(7); } catch(e) { _foodSearchBuildState = null; }
  }, Math.max(0, Number(delay) || 0));
}

function startFoodSearchCacheBuild(signature, bddList, customList) {
  _foodSearchCache = [];
  _foodSearchCacheSignature = signature;
  _foodSearchLastKey = '';
  _foodSearchLastResult = null;
  _foodSearchBuildState = {
    signature,
    lists: [Array.isArray(bddList) ? bddList : [], Array.isArray(customList) ? customList : []],
    listIndex: 0,
    itemIndex: 0,
    seen: new Set(),
    rows: _foodSearchCache,
    done: false
  };
}

function processFoodSearchCacheSlice(budgetMs = 7) {
  const st = _foodSearchBuildState;
  if (!st || st.done) return _foodSearchCache || [];
  const start = foodnoteNowMs();
  const budget = Math.max(3, Number(budgetMs) || 7);
  while (st.listIndex < st.lists.length) {
    const list = st.lists[st.listIndex] || [];
    while (st.itemIndex < list.length) {
      const raw = list[st.itemIndex++];
      const item = withUnitDefaults(raw || {});
      const key = normalizeSearchText(item.nom || item.name || '');
      if (key && !st.seen.has(key)) {
        st.seen.add(key);
        st.rows.push({ item, key, sortName: item.nom || item.name || '' });
      }
      if ((st.itemIndex % 80) === 0 && foodnoteNowMs() - start >= budget) {
        foodnoteScheduleSearchSlice(16);
        return st.rows;
      }
    }
    st.listIndex += 1;
    st.itemIndex = 0;
  }
  st.done = true;
  _foodSearchBuildState = null;
  return st.rows;
}

function buildFoodSearchCache(options = {}) {
  const bddList = typeof getBDD === 'function' ? (getBDD() || []) : [];
  const customList = typeof getCustomList === 'function' ? (getCustomList() || []) : [];
  const signature = foodSearchListSignature(bddList) + '::' + foodSearchListSignature(customList);
  if (_foodSearchCache && _foodSearchCacheSignature === signature) {
    if (_foodSearchBuildState && !_foodSearchBuildState.done) {
      processFoodSearchCacheSlice(options.budgetMs || 5);
      foodnoteScheduleSearchSlice(16);
    }
    return _foodSearchCache;
  }

  startFoodSearchCacheBuild(signature, bddList, customList);
  processFoodSearchCacheSlice(options.budgetMs || 7);
  foodnoteScheduleSearchSlice(16);
  return _foodSearchCache || [];
}
let _foodSearchWarmupHandle = null;
let _foodSearchWarmupSignature = '';
function currentFoodSearchSignature() {
  try {
    const bddList = typeof getBDD === 'function' ? (getBDD() || []) : [];
    const customList = typeof getCustomList === 'function' ? (getCustomList() || []) : [];
    return foodSearchListSignature(bddList) + '::' + foodSearchListSignature(customList);
  } catch(e) { return ''; }
}
window.warmFoodSearchCache = function warmFoodSearchCache() {
  try {
    const signature = currentFoodSearchSignature();
    if (_foodSearchCache && _foodSearchCacheSignature === signature && !_foodSearchBuildState) return;
    if (_foodSearchWarmupHandle && _foodSearchWarmupSignature === signature) return;
    const run = () => {
      _foodSearchWarmupHandle = null;
      _foodSearchWarmupSignature = '';
      try { buildFoodSearchCache({ budgetMs: 6 }); } catch(e) {}
    };
    _foodSearchWarmupSignature = signature;
    _foodSearchWarmupHandle = setTimeout(run, 220);
  } catch(e) {}
};

const CIQUAL_AUTOCOMPLETE_FALLBACK = [
  {nom:'Pain courant français', kcal100:287, prot100:8.4, gluc100:57.5, lip100:1.6, meta:'CIQUAL approx.', source:'ciq'},
  withUnitDefaults({nom:'Œuf de poule entier cru', kcal100:140, prot100:12.7, gluc100:0.3, lip100:9.8, meta:'CIQUAL approx.', source:'ciq'}),
  {nom:'Pâtes alimentaires cuites', kcal100:126, prot100:4.5, gluc100:25.2, lip100:0.7, meta:'CIQUAL approx.', source:'ciq'},
  {nom:'Riz blanc cuit', kcal100:145, prot100:2.7, gluc100:31.8, lip100:0.4, meta:'CIQUAL approx.', source:'ciq'},
  {nom:'Pomme de terre cuite à l’eau', kcal100:80, prot100:1.8, gluc100:16.7, lip100:0.1, meta:'CIQUAL approx.', source:'ciq'},
  withUnitDefaults({nom:'Banane pulpe crue', kcal100:90, prot100:1.1, gluc100:19.7, lip100:0.3, meta:'CIQUAL approx.', source:'ciq'}),
  withUnitDefaults({nom:'Pomme pulpe crue', kcal100:53, prot100:0.3, gluc100:11.6, lip100:0.3, meta:'CIQUAL approx.', source:'ciq'}),
  {nom:'Poulet rôti viande', kcal100:197, prot100:28.1, gluc100:0, lip100:8.9, meta:'CIQUAL approx.', source:'ciq'},
  {nom:'Jambon cuit supérieur', kcal100:126, prot100:20.3, gluc100:1.1, lip100:4.2, meta:'CIQUAL approx.', source:'ciq'},
  {nom:'Thon au naturel égoutté', kcal100:111, prot100:26.8, gluc100:0, lip100:0.8, meta:'CIQUAL approx.', source:'ciq'}
];

function normalizeSearchText(txt) {
  return (txt || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function sourceLabel(source) {
  if (source === 'off') return 'OpenFoodFacts';
  if (source === 'ciq') return 'CIQUAL';
  return 'Base';
}

function sourceBadgeHTML(source) {
  return `<span class="source-badge ${source || 'base'}">${sourceLabel(source)}</span>`;
}

async function readJSONResponse(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error((label || 'API') + ' HTTP ' + response.status);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error((label || 'API') + ' JSON invalide : ' + e.message);
  }
}

function parseNutritionNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const txt = String(value).replace(',', '.');
  const m = txt.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normalizeNutritionKey(key) {
  return String(key || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_');
}

function findNutritionValue(raw, aliases, matcher) {
  const sources = [raw, raw?.nutriments, raw?.nutrition, raw?.values].filter(Boolean);
  for (const src of sources) {
    for (const key of aliases) {
      const val = parseNutritionNumber(src[key]);
      if (val != null) return val;
    }
    for (const [key, value] of Object.entries(src)) {
      const norm = normalizeNutritionKey(key);
      if (matcher(norm)) {
        const val = parseNutritionNumber(value);
        if (val != null) return val;
      }
    }
  }
  return null;
}

function foodnoteExternalRound1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}
function foodnoteExternalNormText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function foodnoteExternalAllowsHighProtein(item) {
  const t = foodnoteExternalNormText([item?.nom, item?.name, item?.meta, item?.groupe, item?.group].filter(Boolean).join(' '));
  return /\b(viande|boeuf|porc|veau|agneau|poulet|dinde|canard|jambon|charcut|poisson|thon|saumon|cabillaud|sardine|maquereau|crevette|crabe|moule|oeuf|fromage|lait|yaourt|skyr|quark|soja|tofu|tempeh|seitan|proteine|whey|lentille|pois chiche|haricot|feve|legumineuse|amande|noix|cacahuete|pistache|graine)\b/.test(t);
}

function sanitizeExternalNutritionItem(item, raw, source) {
  if (!item || typeof item !== 'object') return item;
  const src = String(source || item.source || '').toLowerCase();
  if (src !== 'ciq' && src !== 'ciqual') return item;
  const out = {...item};
  let kcal = Number(out.kcal100 || 0);
  let p = Number(out.prot100 || 0);
  let g = Number(out.gluc100 || 0);
  let l = Number(out.lip100 || 0);
  const warning = [];

  function setValue(key, value, reason) {
    out[key] = value;
    warning.push(reason);
  }
  function clear(key, reason) {
    setValue(key, 0, reason);
  }

  if (kcal > 950) {
    setValue('kcal100', Math.round(kcal / 4.184), 'énergie CIQUAL kJ convertie en kcal');
    kcal = Number(out.kcal100 || 0);
  }

  ['prot100','gluc100','lip100'].forEach(key => {
    const v = Number(out[key] || 0);
    if (!Number.isFinite(v) || v < 0 || v > 100) clear(key, key + ' incohérent');
  });

  p = Number(out.prot100 || 0);
  g = Number(out.gluc100 || 0);
  l = Number(out.lip100 || 0);
  const highProteinOk = foodnoteExternalAllowsHighProtein(out);

  if (p > 35 && !highProteinOk) {
    const divided = foodnoteExternalRound1(p / 10);
    if (kcal >= 120 && g >= 10 && l >= 1 && divided <= 8) {
      setValue('prot100', divided, 'protéines CIQUAL ramenées à une valeur plausible');
      p = divided;
    } else {
      clear('prot100', 'protéines CIQUAL corrigées');
      p = 0;
    }
  }

  let macroKcal = p * 4 + g * 4 + l * 9;
  const limit = kcal > 0 ? Math.max(kcal * 1.35 + 80, kcal + 160) : 0;
  if (kcal > 0 && macroKcal > limit && p > 30 && !highProteinOk) {
    clear('prot100', 'protéines CIQUAL corrigées');
    p = 0;
    macroKcal = g * 4 + l * 9;
  }
  if (kcal > 0 && macroKcal > limit && g > 90) {
    clear('gluc100', 'glucides CIQUAL corrigés');
    g = 0;
    macroKcal = p * 4 + l * 9;
  }
  if (kcal > 0 && macroKcal > limit && l > 70) {
    clear('lip100', 'lipides CIQUAL corrigés');
  }
  if (warning.length) out.ciqualWarning = [...new Set(warning)].join(' · ');
  return out;
}

function normalizeFoodNutritionFromExternal(raw, source) {
  raw = raw || {};
  const kcal = findNutritionValue(
    raw,
    ['kcal100','kcal','kcal_100g','energy_kcal_100g','energy-kcal_100g','energie_kcal_100g','energie_kcal','calories','calories_100g'],
    k => (k.includes('kcal') || k.includes('calorie') || (k.includes('energie') && !k.includes('kj')))
  );
  const kj = findNutritionValue(raw, ['energy_kj_100g','energy_100g','energie_kj_100g','energie_kj'], k => k.includes('kj') || (k.includes('energie') && !k.includes('kcal')));
  const prot = findNutritionValue(
    raw,
    ['prot100','prot','proteines100','proteines_100g','proteines','protein100','protein_100g','proteins_100g','proteins'],
    k => k.includes('prot') || k.includes('protein')
  );
  const gluc = findNutritionValue(
    raw,
    ['gluc100','gluc','glucides100','glucides_100g','glucides','carbohydrates_100g','carbohydrate_100g','carbs_100g','carbs'],
    k => k.includes('gluc') || k.includes('carbohydrate') || k.includes('carbs') || k.includes('hydrates_de_carbone')
  );
  const lip = findNutritionValue(
    raw,
    ['lip100','lip','lipides100','lipides_100g','lipides','fat_100g','fat','matieres_grasses_100g','matieres_grasses'],
    k => k.includes('lip') || k.includes('fat') || k.includes('matiere_grasse') || k.includes('matieres_grasses')
  );
  const item = {
    nom: raw.nom || raw.product_name_fr || raw.product_name || raw.name || raw.alim_nom_fr || 'Inconnu',
    kcal100: Math.round(kcal ?? (kj != null ? kj / 4.184 : 0)),
    prot100: round1(prot ?? 0),
    gluc100: round1(gluc ?? 0),
    lip100: round1(lip ?? 0),
    meta: raw.marque || raw.groupe || raw.group || raw.brands || raw.brand || raw.famille || '',
    source
  };
  return withUnitDefaults(sanitizeExternalNutritionItem(item, raw, source));
}

function makeFoodFromExternal(raw, source) {
  return normalizeFoodNutritionFromExternal(raw, source);
}

function getFilteredBDD(query) {
  const rows = buildFoodSearchCache({ budgetMs: 8 });
  const q = normalizeSearchText(query);
  if (!q) return rows.slice(0, 12).map(r => r.item);

  const cacheKey = _foodSearchCacheSignature + '::' + q + '::' + rows.length + '::' + (_foodSearchBuildState ? 'partial' : 'done');
  if (_foodSearchLastKey === cacheKey && Array.isArray(_foodSearchLastResult)) {
    return _foodSearchLastResult;
  }

  const ranked = [];
  for (const row of rows) {
    const name = row.key;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 86;
    else if (name.split(/\s+/).some(part => part.startsWith(q))) score = 72;
    else if (name.includes(q)) score = 55;
    else if (q.length >= 3) score = fuzzyScore(name, q);
    if (score > 0) {
      ranked.push({ item: row.item, score });
      // On conserve un petit panier des meilleurs résultats. Trier des milliers de lignes
      // à chaque frappe est inutile pour une autocomplétion qui n'affiche que 8 choix.
      if (ranked.length > 40) ranked.sort((a, b) => b.score - a.score).splice(28);
    }
  }

  ranked.sort((a, b) => b.score - a.score || (a.item.nom || '').localeCompare(b.item.nom || '', 'fr'));
  _foodSearchLastKey = cacheKey;
  _foodSearchLastResult = ranked.slice(0, 8).map(r => ({...r.item, _score: r.score}));
  return _foodSearchLastResult;
}

function fuzzyScore(name, q) {
  let pos = -1;
  let score = 0;
  for (const ch of q) {
    pos = name.indexOf(ch, pos + 1);
    if (pos === -1) return 0;
    score += 2;
  }
  return score;
}


// v10.72 — mode unique dans la modale Aliment : recherche ou IA, même champ
let foodAddMode = 'search';
let foodAddTargetMeal = 'lunch';

// v10.70 — filtres de sources dans la modale Aliment
let foodSourceFilters = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('foodnote_food_source_filters') || '{}');
    return { base: saved.base !== false, off: saved.off !== false, ciq: saved.ciq !== false };
  } catch(e) {
    return { base: true, off: true, ciq: true };
  }
})();

function persistFoodSourceFilters() {
  try { localStorage.setItem('foodnote_food_source_filters', JSON.stringify(foodSourceFilters)); } catch(e) {}
}

function syncFoodAddMealButtons() {
  const target = normalizeMealId(foodAddTargetMeal || 'lunch');
  document.querySelectorAll('[data-food-meal]').forEach(btn => {
    const meal = normalizeMealId(btn.getAttribute('data-food-meal') || 'lunch');
    const active = meal === target;
    btn.classList.toggle('active', active);
    btn.classList.toggle('is-selected', active);
    btn.classList.toggle('selected', active);
    btn.dataset.foodnoteMealSelected = active ? '1' : '0';
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-fn-meal-choice]').forEach(btn => {
    const meal = normalizeMealId(btn.getAttribute('data-fn-meal-choice') || 'lunch');
    const active = meal === target;
    btn.classList.toggle('active', active);
    btn.classList.toggle('is-selected', active);
    btn.classList.toggle('selected', active);
    btn.dataset.foodnoteMealSelected = active ? '1' : '0';
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
}

function getCurrentMealAddedFoodItems(meal = foodAddTargetMeal) {
  const target = normalizeMealId(meal || 'lunch');
  const items = [];
  try {
    for (let i = ALIMENTS_BASE.length; i < allAliments.length; i++) {
      const a = allAliments[i];
      if (!isFoodLineActiveForUi(a) || !selected.has(i)) continue;
      if (normalizeMealId(a.meal || 'lunch') !== target) continue;
      const qty = quantities[i] ?? a.defaut ?? 0;
      const m = getMealSafeMacros ? getMealSafeMacros(a, i) : getMacros(a, qty);
      items.push({ idx:i, a, qty, m });
    }
  } catch(e) {
    console.warn('[FoodNote] liste aliments repas indisponible', e);
  }
  return items.reverse();
}

function renderCurrentMealFoods() {
  const card = document.getElementById('food-current-meal-card');
  if (!card) return;
  const meal = mealOption(foodAddTargetMeal || 'lunch');
  const items = getCurrentMealAddedFoodItems(meal.id);
  const title = `${meal.icon} Déjà dans ${meal.label}`;
  if (!items.length) {
    card.innerHTML = `
      <div class="food-current-meal-head"><span>${escapeHtml(title)}</span><b>0</b></div>
      <div class="food-current-meal-empty">Aucun aliment dans cette rubrique pour l’instant.</div>`;
    card.classList.add('is-empty');
    return;
  }
  card.classList.remove('is-empty');
  const shown = items.slice(0, 8);
  const rows = shown.map(({idx, a, qty}) => {
    const qtyText = typeof formatFoodQty === 'function' ? formatFoodQty(a, qty) : ((qty || 0) + ' ' + (a.unite || 'g'));
    return `
    <button type="button" class="fn-ui-row fn-ui-row--food food-current-meal-row food-current-meal-tile" onclick="focusExistingFoodFromAddModal(${idx})" title="Voir ${escapeHtml(a.nom)} — ${escapeHtml(qtyText)}">
      <span class="food-current-meal-name">${escapeHtml(a.nom)}</span>
      <span class="food-current-meal-meta">${escapeHtml(qtyText)}</span>
    </button>`;
  }).join('');
  const more = items.length > shown.length ? `<div class="food-current-meal-more">+${items.length - shown.length} autre${items.length - shown.length > 1 ? 's' : ''}</div>` : '';
  card.innerHTML = `
    <div class="food-current-meal-head"><span>${escapeHtml(title)}</span><b>${items.length}</b></div>
    <div class="food-current-meal-list">${rows}${more}</div>`;
}

function focusExistingFoodFromAddModal(idx) {
  try {
    if (typeof closeFoodAddModal === 'function') closeFoodAddModal();
    if (typeof openMealGroupForFood === 'function') openMealGroupForFood(idx);
    setTimeout(() => {
      const row = document.getElementById('row-' + idx);
      const qty = document.getElementById('qty-' + idx);
      if (row) {
        row.scrollIntoView({ behavior:'smooth', block:'center' });
        row.style.background = 'var(--green-bg)';
        setTimeout(() => { row.style.background = ''; }, 1300);
      }
      if (qty) qty.focus({ preventScroll:true });
    }, 120);
  } catch(e) {
    console.warn('[FoodNote] focus aliment existant impossible', e);
  }
}

function setFoodAddTargetMeal(meal) {
  foodAddTargetMeal = (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner') ? meal : 'lunch';
  try { localStorage.setItem('foodnote_food_add_target_meal', foodAddTargetMeal); } catch(e) {}
  syncFoodAddMealButtons();
  if (typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
}

(function initFoodAddTargetMeal(){
  try {
    const saved = localStorage.getItem('foodnote_food_add_target_meal');
    if (saved === 'breakfast' || saved === 'lunch' || saved === 'dinner') foodAddTargetMeal = saved;
  } catch(e) {}
})();

function syncFoodSourceFilterButtons() {
  document.querySelectorAll('[data-source-filter]').forEach(btn => {
    const src = btn.getAttribute('data-source-filter');
    const active = foodSourceFilters[src] !== false;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function toggleFoodSourceFilter(src) {
  if (!foodSourceFilters || !(src in foodSourceFilters)) return;
  foodSourceFilters[src] = !foodSourceFilters[src];
  // Garde au moins une source active pour éviter un écran vide incompréhensible.
  if (!foodSourceFilters.base && !foodSourceFilters.off && !foodSourceFilters.ciq) foodSourceFilters[src] = true;
  persistFoodSourceFilters();
  syncFoodSourceFilterButtons();
  dbAutoToken++;
  clearTimeout(dbAutoTimer);
  handleDBSearchInput();
}

function setFoodAddMode(mode) {
  const next = mode === 'ia' ? 'ia' : 'search';
  if (next === 'ia' && typeof isAIEnabled === 'function' && !isAIEnabled()) {
    alert('Les fonctions IA sont désactivées dans Options de l’application.');
    return;
  }
  foodAddMode = next;
  const modal = document.getElementById('food-add-modal');
  const input = document.getElementById('db-search');
  const btn = document.getElementById('food-main-action-btn');
  const iaBtn = document.getElementById('food-ai-mode-btn');
  const recipeBtn = document.getElementById('food-recipe-mode-btn');
  const modeBadge = document.getElementById('food-add-mode-badge');
  const suggestions = document.getElementById('db-suggestions');
  const selectedCard = document.getElementById('db-selected-card');
  const hidden = document.getElementById('db-selected-id');
  if (modal) {
    modal.classList.toggle('food-add-ai-mode', foodAddMode === 'ia');
    modal.classList.remove('food-add-quick-mode');
    modal.classList.remove('food-add-expanded', 'food-add-recipe-mode', 'food-add-recipe-camera', 'food-add-recipe-crop', 'food-add-recipe-result', 'food-add-recipe-processing');
  }
  if (iaBtn) iaBtn.classList.toggle('active', foodAddMode === 'ia');
  if (recipeBtn) recipeBtn.classList.remove('active');
  foodRecipeOCRMode = false;
  syncOCRPanelMode && syncOCRPanelMode();
  syncFoodAddMealButtons();
  if (typeof renderCurrentMealFoods === 'function') renderCurrentMealFoods();
  if (input) {
    input.placeholder = foodAddMode === 'ia'
      ? 'Plat ou repas à estimer : pâtes bolo maison, 1 assiette'
      : 'Rechercher un aliment : pain, yaourt, poulet...';
    input.focus({ preventScroll: true });
  }
  if (btn) btn.textContent = foodAddMode === 'ia' ? 'Estimer' : 'Ajouter';
  if (modeBadge) modeBadge.textContent = foodAddMode === 'ia' ? '⚡ IA' : '🍽 Aliment';
  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.classList.remove('visible');
  }
  const respEl = document.getElementById('groq-response');
  if (foodAddMode === 'ia') {
    dbSelectedFood = null;
    closeDBQuantitySelector({keepSearch:true});
    if (hidden) hidden.value = '';
    if (selectedCard) selectedCard.innerHTML = '';
  } else {
    if (respEl) respEl.style.display = 'none';
    handleDBSearchInput();
  }
}

function toggleFoodAIMode() {
  setFoodAddMode(foodAddMode === 'ia' ? 'search' : 'ia');
}

function toggleFoodQuickMode() {
  // Compatibilité anciens appels : la mémoire rapide a été retirée du Journal.
  setFoodAddMode('search');
}

function openFoodIAPanel() { setFoodAddMode('ia'); }
function closeFoodIAPanel() { setFoodAddMode('search'); }
function estimateCurrentFoodWithIA() { setFoodAddMode('ia'); }

function setFoodAddExpanded(expanded) {
  const modal = document.getElementById('food-add-modal');
  if (modal) modal.classList.toggle('food-add-expanded', !!expanded);
}

function resetFoodAddGroqVisualState(options = {}) {
  const keepIA = options && options.keepIA === true;
  const respEl = document.getElementById('groq-response');
  if (respEl && !keepIA) {
    respEl.style.display = 'none';
    respEl.textContent = '';
    respEl.innerHTML = '';
    respEl.style.color = '';
  }
  const parseStatus = document.getElementById('ia-parse-status');
  if (parseStatus && !keepIA) {
    parseStatus.textContent = '';
    parseStatus.style.color = '';
  }
  const preview = document.getElementById('ia-preview');
  if (preview && !keepIA) {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
  if (!keepIA) window._groqReponse = '';
  document.querySelectorAll('[id^="ia-row-"]').forEach(el => {
    if (!keepIA || !el.dataset.openedByUser) {
      el.style.display = 'none';
      el.removeAttribute('data-opened-by-user');
    }
  });
  document.querySelectorAll('[id^="ia-val-status-"]').forEach(el => {
    if (!keepIA) el.textContent = '';
  });
}
function openFoodPhotoOption() {
  foodRecipeOCRMode = false;
  const modal = document.getElementById('food-add-modal');
  if (modal) {
    modal.classList.remove('food-add-recipe-mode', 'food-add-recipe-camera', 'food-add-recipe-crop', 'food-add-recipe-result', 'food-add-recipe-ocr-result', 'food-add-recipe-ai-result', 'food-add-recipe-processing');
    delete modal.dataset.foodnoteWorkflow;
    delete modal.dataset.foodnoteRecipeStep;
  }
  try { window.FoodNoteRecipeWorkflowActive = false; window.FoodNoteRecipeWorkflow = { active:false, name:'recipe_ocr', step:'', updatedAt:Date.now() }; } catch(e) {}
  syncOCRPanelMode && syncOCRPanelMode();
  const recipeBox = document.getElementById('recipe-ocr-result');
  if (recipeBox) recipeBox.style.display = 'none';
  // v10.86 : on rouvre le scanner éprouvé (BarcodeDetector + fallback html5-qrcode).
  // La caméra OCR unifiée v10.85 détectait moins bien sur certains WebView car elle ne passait
  // pas par le fallback html5-qrcode qui fonctionnait déjà avec tes codes-barres.
  try { if (typeof closeOCRPanel === 'function') closeOCRPanel(); } catch(e) {}
  try { if (typeof stopNutritionOCRCamera === 'function') stopNutritionOCRCamera(false); } catch(e) {}
  if (typeof toggleBarcodeScanner === 'function') toggleBarcodeScanner();
}

function syncOCRPanelMode() {
  const title = document.querySelector('#ocr-panel .ocr-panel-head strong');
  const note = document.querySelector('#ocr-panel .ocr-unified-note');
  const tableBtn = document.getElementById('ocr-read-table-btn');
  const recipeBtn = document.getElementById('recipe-ocr-read-btn');
  const ocrResult = document.getElementById('ocr-result');
  if (title) title.textContent = foodRecipeOCRMode ? 'Photo recette' : 'Lecture étiquette';
  if (note) note.textContent = foodRecipeOCRMode
    ? 'Cadre la liste d’ingrédients. L’OCR extrait le texte, puis tu valides avant l’envoi IA.'
    : 'La caméra scanne automatiquement les codes-barres/QR. L’OCR tableau ne part au serveur que si le déclencheur est activé.';
  if (tableBtn) tableBtn.style.display = foodRecipeOCRMode ? 'none' : '';
  if (recipeBtn) {
    recipeBtn.style.display = foodRecipeOCRMode ? '' : 'none';
    if (foodRecipeOCRMode) recipeBtn.textContent = '📸 Prendre la photo';
  }
  if (ocrResult && foodRecipeOCRMode) ocrResult.style.display = 'none';
  const cropBox = document.getElementById('recipe-crop-box');
  if (cropBox && !foodRecipeOCRMode) cropBox.style.display = 'none';
}

function foodnoteBeginRecipePhotoWorkflow(options = {}) {
  try {
    const silent = options && options.silent === true;
    const step = String((window.FoodNoteRecipeWorkflow && window.FoodNoteRecipeWorkflow.step) || 'camera');
    window.FoodNoteRecipeWorkflowActive = true;
    window.FoodNoteRecipeWorkflow = { active:true, name:'recipe_ocr', step, updatedAt:Date.now() };
    if (!silent) window.FoodNoteAddV0160 && window.FoodNoteAddV0160.beginWorkflow && window.FoodNoteAddV0160.beginWorkflow('recipe_ocr', 240000);
    const modal = document.getElementById('food-add-modal');
    if (modal) {
      modal.dataset.foodnoteWorkflow = 'recipe_ocr';
      if (!modal.dataset.foodnoteRecipeStep) modal.dataset.foodnoteRecipeStep = step;
      modal.classList.remove('food-intent-search', 'food-intent-recipes');
      modal.classList.add('food-intent-estimate', 'food-add-recipe-mode');
    }
  } catch(e) {}
}

function foodnoteSetRecipeWorkflowStep(step, options = {}) {
  // 0.22.78 — état central recette photo : caméra → recadrage → OCR → IA.
  // Les modules de popup peuvent encore rafraîchir leur affichage, mais ils ne décident
  // plus quel écran du scan recette est visible. Cette fonction reconstruit l'UI depuis
  // l'état métier stocké sur window.FoodNoteRecipeWorkflow + dataset du modal.
  // Avant, plusieurs moteurs (ancien foodAddMode, UX1513, AddV0160, crop shell)
  // pouvaient réafficher le panneau Photo/OCR après analyse. Ici, chaque étape
  // réconcilie le DOM depuis l'état métier, au lieu de dépendre d'un ancien onglet.
  const normalized = String(step || 'camera').replace(/-/g, '_');
  foodnoteBeginRecipePhotoWorkflow({ silent: options && options.reconcile === true });
  window.FoodNoteRecipeWorkflowActive = true;
  window.FoodNoteRecipeWorkflow = { active:true, name:'recipe_ocr', step:normalized, updatedAt:Date.now() };
  const modal = document.getElementById('food-add-modal');
  const panel = document.getElementById('ocr-panel');
  const cropBox = document.getElementById('recipe-crop-box');
  const recipeBox = document.getElementById('recipe-ocr-result');
  const aiBox = document.getElementById('recipe-ai-result');
  const tableBox = document.getElementById('ocr-result');
  const cameraBox = document.getElementById('ocr-camera-box');
  const chooser = document.getElementById('food-add-intent-chooser');
  const searchPanel = document.getElementById('food-add-search-panel');
  const estimatePanel = document.getElementById('food-add-estimate-panel');
  const recipesPanel = document.getElementById('food-add-recipes-panel');
  const suggestions = document.getElementById('db-suggestions');
  const selected = document.getElementById('db-selected-card');
  const qty = document.getElementById('db-qty');

  if (modal) {
    modal.dataset.foodnoteWorkflow = 'recipe_ocr';
    modal.dataset.foodnoteRecipeStep = normalized;
    modal.classList.remove(
      'food-intent-search', 'food-intent-recipes',
      'food-add-recipe-camera', 'food-add-recipe-crop', 'food-add-recipe-result',
      'food-add-recipe-ocr-result', 'food-add-recipe-ai-result', 'food-add-recipe-processing'
    );
    modal.classList.add('food-intent-estimate', 'food-add-expanded', 'food-add-recipe-mode');
    if (normalized === 'camera') modal.classList.add('food-add-recipe-camera');
    else if (normalized === 'crop') modal.classList.add('food-add-recipe-crop');
    else if (normalized === 'processing') modal.classList.add('food-add-recipe-processing');
    else if (normalized === 'ai_result' || normalized === 'ai') modal.classList.add('food-add-recipe-result', 'food-add-recipe-ai-result');
    else modal.classList.add('food-add-recipe-result', 'food-add-recipe-ocr-result');
  }

  if (panel) panel.style.setProperty('display', 'block', 'important');
  [chooser, searchPanel, estimatePanel, recipesPanel, suggestions, selected, qty].forEach(el => {
    if (!el) return;
    try { el.style.setProperty('display', 'none', 'important'); } catch(e) { el.style.display = 'none'; }
    if (el === suggestions) el.classList.remove('visible');
  });
  if (tableBox) tableBox.style.setProperty('display', 'none', 'important');
  if (cameraBox) cameraBox.style.setProperty('display', normalized === 'camera' ? 'block' : 'none', 'important');
  if (cropBox) cropBox.style.setProperty('display', normalized === 'crop' ? 'block' : 'none', 'important');
  if (recipeBox) recipeBox.style.setProperty('display', (normalized === 'ocr_result' || normalized === 'result' || normalized === 'ai_result' || normalized === 'ai') ? 'block' : 'none', 'important');
  if (aiBox) aiBox.style.setProperty('display', (normalized === 'ai_result' || normalized === 'ai') ? 'block' : 'none', 'important');

  try {
    const title = document.querySelector('#ocr-panel .ocr-panel-head strong');
    const note = document.querySelector('#ocr-panel .ocr-unified-note');
    if (title) title.textContent = normalized === 'crop' ? 'Recadrage recette' : (normalized === 'ocr_result' || normalized === 'result') ? 'Texte recette reconnu' : (normalized === 'ai_result' || normalized === 'ai') ? 'Recette estimée' : 'Photo recette';
    if (note) note.textContent = normalized === 'crop'
      ? 'Déplace le cadre sur la liste d’ingrédients, puis lis uniquement cette zone.'
      : (normalized === 'ocr_result' || normalized === 'result')
        ? 'Corrige le texte si besoin, puis envoie à l’IA pour créer une recette réutilisable.'
        : (normalized === 'ai_result' || normalized === 'ai')
          ? 'Vérifie les valeurs avant d’enregistrer la recette ou de l’ajouter au journal.'
          : 'Cadre la liste d’ingrédients. La photo reste locale jusqu’à l’analyse.';
  } catch(e) {}

  try {
    const activeBtn = document.querySelector('#food-add-modal [data-food-intent="estimate"]');
    document.querySelectorAll('#food-add-modal [data-food-intent]').forEach(btn => {
      const isActive = btn === activeBtn;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  } catch(e) {}
}


function foodnoteReconcileRecipeWorkflow(reason = '') {
  try {
    const modal = document.getElementById('food-add-modal');
    const wf = window.FoodNoteRecipeWorkflow || {};
    const active = !!(window.FoodNoteRecipeWorkflowActive || (wf && wf.active) || (modal && (modal.dataset.foodnoteWorkflow === 'recipe_ocr' || modal.classList.contains('food-add-recipe-mode'))));
    if (!active || !modal) return false;
    const step = String(modal.dataset.foodnoteRecipeStep || wf.step || 'camera').replace(/-/g, '_');
    if (modal.__fnRecipeWorkflowReconciling) return true;
    modal.__fnRecipeWorkflowReconciling = true;
    try { foodnoteSetRecipeWorkflowStep(step, { reconcile:true, reason }); }
    finally { modal.__fnRecipeWorkflowReconciling = false; }
    return true;
  } catch(e) { return false; }
}

window.FoodNoteRecipeWorkflowController = {
  begin(step = 'camera') { foodnoteBeginRecipePhotoWorkflow(); foodnoteSetRecipeWorkflowStep(step); return true; },
  step(step) { foodnoteSetRecipeWorkflowStep(step); return true; },
  reconcile(reason) { return foodnoteReconcileRecipeWorkflow(reason); },
  end() {
    window.FoodNoteRecipeWorkflowActive = false;
    window.FoodNoteRecipeWorkflow = { active:false, name:'recipe_ocr', step:'', updatedAt:Date.now() };
    const modal = document.getElementById('food-add-modal');
    if (modal) {
      delete modal.dataset.foodnoteWorkflow;
      delete modal.dataset.foodnoteRecipeStep;
    }
  },
  get state() { return window.FoodNoteRecipeWorkflow || { active:false, step:'' }; }
};

function openFoodRecipePhotoOption() {
  foodnoteBeginRecipePhotoWorkflow();
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) {
    alert('Les fonctions IA sont désactivées dans Options de l’application.');
    return;
  }
  foodRecipeOCRMode = true;
  foodCropMode = 'recipe';
  try { window.FoodNoteCropMode = foodCropMode; } catch(e) {}
  document.getElementById('food-recipe-mode-btn')?.classList.add('active');
  document.getElementById('food-ai-mode-btn')?.classList.remove('active');
  const modeBadge = document.getElementById('food-add-mode-badge');
  if (modeBadge) modeBadge.textContent = '🧾 Plat / recette';
  try { if (typeof resetFoodAddGroqVisualState === 'function') resetFoodAddGroqVisualState(); } catch(e) {}
  try { if (typeof closeBarcodeScannerPanel === 'function') closeBarcodeScannerPanel(); } catch(e) {}
  const panel = document.getElementById('ocr-panel');
  const recipeBox = document.getElementById('recipe-ocr-result');
  const recipeAi = document.getElementById('recipe-ai-result');
  const recipeCrop = document.getElementById('recipe-crop-box');
  const status = document.getElementById('recipe-ai-status');
  const modal = document.getElementById('food-add-modal');
  if (panel) panel.style.display = 'block';
  // En mode caméra recette, on n'affiche pas encore le bloc texte.
  // Sinon la popup devient trop haute et la caméra descend sous l'écran.
  if (recipeBox) recipeBox.style.display = 'none';
  if (recipeAi) recipeAi.style.display = 'none';
  if (recipeCrop) recipeCrop.style.display = 'none';
  foodRecipeCropPhotoDataUrl = '';
  foodRecipeCropReady = false;
  if (status) { status.textContent = ''; status.classList.remove('error'); }
  const recipeText = document.getElementById('recipe-ocr-text');
  if (recipeText) recipeText.value = '';
  foodRecipeOCRCaptureSerial++;
  foodnoteSetRecipeWorkflowStep('camera');
  syncOCRPanelMode();
  setOCRStatus('Photo recette : cadre la page, touche “📸 Prendre la photo”, puis recadre uniquement la liste.', false);
  startNutritionOCRCamera();
}


function openFoodBarcodeFromPhoto() {
  closeOCRPanel();
  if (typeof toggleBarcodeScanner === 'function') toggleBarcodeScanner();
}


function handleFoodMainAction() {
  if (foodAddMode === 'ia') {
    if (typeof estimerGroq === 'function') estimerGroq();
    return;
  }
  if (isDBQuantitySelectorOpen()) {
    confirmDBQuantitySelection();
    return;
  }
  addFromDB();
}

function handleDBSearchInput() {
  const input = document.getElementById('db-search');
  const hidden = document.getElementById('db-selected-id');
  if (!input || !hidden) return;
  if (foodAddMode === 'ia') {
    hidden.value = '';
    dbSelectedFood = null;
    updateDBSelectedCard(null);
    const box = document.getElementById('db-suggestions');
    if (box) { box.innerHTML = ''; box.classList.remove('visible'); }
    setFoodAddExpanded(false);
    return;
  }
  if (isDBQuantitySelectorOpen() && Date.now() < Number(window.__foodnoteSelectedSearchLockUntil || 0)) {
    try {
      const picked = Number(document.getElementById('db-suggestions')?.dataset?.foodnotePickedIndex ?? window.__foodnoteSelectedSearchIndex ?? -1);
      foodnoteStabilizeSearchPickSurface(dbQuantityFood || dbSelectedFood || window.__foodnoteSelectedSearchFood, picked, { sticky:false, ms:12000 });
    } catch(e) {}
    return;
  }
  if (isDBQuantitySelectorOpen()) {
    if (isDBQuantitySearchGuardActive()) {
      hideDBSuggestionsOnly();
      return;
    }
    // L'utilisateur a modifié le texte de recherche : on quitte explicitement le choix quantité.
    closeDBQuantitySelector({keepSearch:true});
  }
  hidden.value = '';
  dbSelectedFood = null;
  updateDBSelectedCard(null);
  const q = input.value.trim();
  if (!q) {
    dbAutoToken++;
    clearTimeout(dbAutoTimer);
    const box = document.getElementById('db-suggestions');
    if (box) { box.innerHTML = ''; box.classList.remove('visible'); }
    setFoodAddExpanded(false);
    return;
  }
  renderDBSuggestions(q);
  if (q.length >= 2 && typeof ensureFoodsReadyForSearch === 'function') {
    const requested = q;
    ensureFoodsReadyForSearch().then(() => {
      const currentInput = document.getElementById('db-search');
      const currentQuery = currentInput ? currentInput.value.trim() : '';
      if (foodAddMode === 'search' && normalizeSearchText(currentQuery) === normalizeSearchText(requested)) {
        renderDBSuggestions(requested);
      }
    }).catch(() => {});
  }
  clearTimeout(dbAutoTimer);
  if (q.length >= 2) {
    const token = ++dbAutoToken;
    dbAutoTimer = setTimeout(() => enrichDBSuggestionsWithExternal(q, token), 420);
  } else {
    dbAutoToken++;
  }
}

function suggestionHTML(s, i) {
  const item = sanitizeFoodUnitMeta(s.item || {});
  const source = s.source || 'base';
  const meta = item.meta || item.marque || item.groupe || '';
  const unitWeight = saneUnitWeightForFood(item);
  // 0.21.18.6 : ne plus dépendre de item.id pour ouvrir la sélection.
  // Certains aliments issus de la base utilisateur n'ont pas encore d'id SQL stable ;
  // on passe donc par l'index de dbSuggestionItems et on ouvre le sélecteur quantité
  // avec l'objet réellement affiché.
  return `
    <div class="db-suggestion" data-index="${i}" data-food-add-action="search-pick" data-search-index="${i}" data-food-search-result="1" role="button" tabindex="0">
      <div class="db-suggestion-top">
        <div class="db-suggestion-name">${escapeHtml(item.nom)}</div>
        ${sourceBadgeHTML(source)}
      </div>
      ${meta ? `<div class="db-suggestion-meta">${escapeHtml(meta)}</div>` : ''}
      ${unitWeight > 0 ? `<div class="db-unit-hint">Par défaut : 1 ${escapeHtml(item.uniteLabel || 'unité')} ≈ ${Math.round(unitWeight)}g</div>` : ''}
      <div class="db-suggestion-macros">${nutrient100HTML(item)}</div>
    </div>`;
}

function renderDBSuggestions(query, extraItems = []) {
  const box = document.getElementById('db-suggestions');
  if (!box) return;
  if (isDBQuantitySearchGuardActive()) {
    hideDBSuggestionsOnly();
    return;
  }
  const q = (query || '').trim();
  const localResults = foodSourceFilters.base ? getFilteredBDD(q).map(item => ({type:'item', source:'base', item})) : [];
  dbSuggestionItems = [...localResults, ...extraItems];

  let html = dbSuggestionItems.map((s, i) => {
    if (s.type === 'create') {
      return `<div class="db-suggestion db-create" data-index="${i}" data-food-add-action="search-pick" data-search-index="${i}" data-food-search-result="1" role="button" tabindex="0">
        <div class="db-suggestion-top"><div class="db-suggestion-name">+ Ajouter “${escapeHtml(s.name)}” à la base</div>${sourceBadgeHTML('base')}</div>
        <div class="db-suggestion-macros"><span>🔥 kcal</span><span>🍖 protéines</span><span>🍞 glucides</span><span>🥑 lipides</span></div>
      </div>`;
    }
    if (s.type === 'loading') {
      return `<div class="db-suggestion db-status" data-index="${i}"><div class="db-suggestion-macros">🔎 Recherche dans les sources activées...</div></div>`;
    }
    if (s.type === 'status') {
      return `<div class="db-suggestion db-status" data-index="${i}"><div class="db-suggestion-macros">${escapeHtml(s.text)}</div></div>`;
    }
    return suggestionHTML(s, i);
  }).join('');

  const exact = localResults.some(s => normalizeSearchText(s.item.nom) === normalizeSearchText(q));
  if (q && !exact) {
    const createIndex = dbSuggestionItems.length;
    dbSuggestionItems.push({type:'create', name:q});
    html += `<div class="db-suggestion db-create" data-index="${createIndex}" data-food-add-action="search-pick" data-search-index="${createIndex}" data-food-search-result="1" role="button" tabindex="0">
      <div class="db-suggestion-top"><div class="db-suggestion-name">+ Ajouter “${escapeHtml(q)}” à la base</div>${sourceBadgeHTML('base')}</div>
      <div class="db-suggestion-macros"><span>🔥 kcal</span><span>🍖 protéines</span><span>🍞 glucides</span><span>🥑 lipides</span></div>
    </div>`;
  }

  if (!html) html = '<div class="db-suggestion"><div class="db-suggestion-macros">Aucun aliment trouvé dans les sources activées.</div></div>';
  box.innerHTML = html;
  dbSuggestionIndex = -1;
  box.classList.add('visible');
  setFoodAddExpanded(true);
  if (window.FoodNoteRecipes && typeof window.FoodNoteRecipes.scheduleFoodSearchRecipeAppend === 'function') {
    window.FoodNoteRecipes.scheduleFoodSearchRecipeAppend(70);
  }
}

async function enrichDBSuggestionsWithExternal(q, token) {
  const box = document.getElementById('db-suggestions');
  if (!box || token !== dbAutoToken || isDBQuantitySearchGuardActive()) return;
  const local = foodSourceFilters.base ? getFilteredBDD(q).map(item => ({type:'item', source:'base', item})) : [];
  renderDBSuggestions(q, [{type:'loading'}]);

  const external = [];
  const status = [];
  const seen = new Set(local.map(s => normalizeSearchText(s.item.nom)));
  function addList(list, source) {
    (list || []).forEach(item => {
      const key = normalizeSearchText(item.nom);
      if (!key || seen.has(key)) return;
      seen.add(key);
      external.push({type:'item', source, item});
    });
  }

  if (foodSourceFilters.ciq) {
    const ciq = await searchCIQForAutocomplete(q);
    if (token !== dbAutoToken || isDBQuantitySearchGuardActive()) return;
    addList(ciq.items, 'ciq');
    if (ciq.error) status.push('CIQUAL backend non disponible');
    if (foodSourceFilters.off) renderDBSuggestions(q, external.length ? external.slice(0, 10) : [{type:'loading'}]);
  }

  if (foodSourceFilters.off) {
    const off = await searchOFFForAutocomplete(q);
    if (token !== dbAutoToken || isDBQuantitySearchGuardActive()) return;
    addList(off.items, 'off');
    if (off.error) status.push('OpenFoodFacts indisponible ici');
  }

  const extras = external.slice(0, 12);
  if (!extras.length && status.length) extras.push({type:'status', text: status.join(' · ')});
  renderDBSuggestions(q, extras);
}

async function searchOFFForAutocomplete(q) {
  const out = [];
  let hadError = false;
  function addProduct(p) {
    const n = p.nutriments || p || {};
    const kcal = Number(n['energy-kcal_100g'] ?? n.energy_kcal_100g ?? n.kcal100 ?? 0)
      || Math.round((Number(n['energy-kj_100g'] ?? n.energy_100g ?? 0) || 0) / 4.184);
    const item = {
      nom: p.product_name_fr || p.product_name || p.generic_name_fr || p.generic_name || p.nom || 'Inconnu',
      kcal100: Math.round(kcal || 0),
      prot100: round1(n.proteins_100g ?? n.prot100 ?? 0),
      gluc100: round1(n.carbohydrates_100g ?? n.gluc100 ?? 0),
      lip100: round1(n.fat_100g ?? n.lip100 ?? 0),
      meta: (p.brands || p.marque || '').toString().split(',')[0],
      source:'off'
    };
    if (item.nom && item.nom !== 'Inconnu' && item.kcal100 > 0) out.push(withUnitDefaults(item));
  }

  // 1) Backend local, si ton app en a un.
  try {
    const r = await fetch('/api/off/search?q=' + encodeURIComponent(q));
    if (r.ok) {
      const data = await r.json();
      (data.products || data.items || []).slice(0, 8).forEach(addProduct);
      if (out.length) return {items: out, error:false};
    }
  } catch(e) { hadError = true; }

  // 2) API publique OFF directe. Fonctionne si la WebView/le navigateur autorise l'accès réseau.
  try {
    const params = new URLSearchParams({
      search_terms: q,
      search_simple: '1',
      action: 'process',
      json: '1',
      page_size: '8',
      fields: 'product_name_fr,product_name,generic_name_fr,generic_name,nutriments,brands'
    });
    const r = await fetch('https://world.openfoodfacts.org/cgi/search.pl?' + params.toString(), {mode:'cors'});
    if (!r.ok) throw new Error('OFF HTTP ' + r.status);
    const data = await r.json();
    (data.products || []).forEach(addProduct);
  } catch(e) {
    hadError = true;
    console.warn('Autocomplete OFF indisponible:', e);
  }
  return {items: out.slice(0, 8), error: hadError && !out.length};
}

async function searchCIQForAutocomplete(q) {
  const out = [];
  let hadError = false;
  try {
    const r = await fetch('/api/ciqual/data?q=' + encodeURIComponent(q));
    const data = await readJSONResponse(r, 'CIQUAL');
    (Array.isArray(data) ? data : (data.products || data.items || [])).slice(0, 8).forEach(p => {
      const item = makeFoodFromExternal(p, 'ciq');
      item.meta = p.groupe || p.group || 'ANSES CIQUAL';
      if (item.nom && item.kcal100) out.push(item);
    });
    if (out.length) return {items: out, error:false};
  } catch(e) {
    hadError = true;
    console.warn('Autocomplete CIQUAL indisponible:', e);
  }

  // Fallback hors backend : mini-liste locale CIQUAL pour que l'autocomplétion propose quand même des sources CIQUAL.
  const qn = normalizeSearchText(q);
  CIQUAL_AUTOCOMPLETE_FALLBACK
    .map(item => {
      const name = normalizeSearchText(item.nom);
      let score = name === qn ? 100 : name.startsWith(qn) ? 80 : name.includes(qn) ? 50 : fuzzyScore(name, qn);
      return {...item, _score: score};
    })
    .filter(item => item._score > 0)
    .sort((a,b) => b._score - a._score)
    .slice(0, 6)
    .forEach(item => out.push(item));

  return {items: out, error: hadError && !out.length};
}


function foodnoteApplySelectedSearchFoodToInput(food, options = {}) {
  const name = String(food && (food.nom || food.name) || '').trim();
  if (!name) return;
  const apply = () => {
    const input = document.getElementById('db-search');
    if (!input) return;
    if (input.value !== name) input.value = name;
    input.setAttribute('value', name);
    input.dataset.foodnoteSelectedName = name;
    input.dataset.foodnoteSearchSelectionLocked = '1';
    const hidden = document.getElementById('db-selected-id');
    if (hidden && (food.id || food.bddId)) hidden.value = String(food.id || food.bddId);
  };
  apply();
  // 0.22.179 : la sélection d'une proposition est une écriture UI explicite.
  // On ne déclenche pas l'event input, sinon l'ancien moteur relance la recherche sur le
  // texte tapé avant le clic. On réapplique simplement le libellé complet après les
  // micro-rendus qui peuvent encore passer juste après le pointerdown/click.
  if (options.sticky !== false) {
    try {
      window.__foodnoteSelectedSearchName = name;
      window.__foodnoteSelectedSearchFood = food || null;
      window.__foodnoteSelectedSearchLockUntil = Date.now() + 12000;
    } catch(e) {}
    [0, 40, 120, 260, 520, 1000].forEach(delay => setTimeout(() => {
      try {
        if (Date.now() < Number(window.__foodnoteSelectedSearchLockUntil || 0)) apply();
      } catch(e) {}
    }, delay));
  }
}
window.foodnoteApplySelectedSearchFoodToInput = foodnoteApplySelectedSearchFoodToInput;

function foodnoteStabilizeSearchPickSurface(food, index, options = {}) {
  const name = String(food && (food.nom || food.name) || window.__foodnoteSelectedSearchName || '').trim();
  const until = Date.now() + Math.max(1800, Number(options.ms) || 12000);
  try {
    window.__foodnoteSelectedSearchName = name;
    window.__foodnoteSelectedSearchFood = food || window.__foodnoteSelectedSearchFood || null;
    window.__foodnoteSelectedSearchIndex = Number.isFinite(Number(index)) ? Number(index) : Number(window.__foodnoteSelectedSearchIndex ?? -1);
    window.__foodnoteSelectedSearchLockUntil = until;
    window.__foodnoteKeepDBSuggestionsVisibleUntil = until;
  } catch(e) {}

  const apply = () => {
    try {
      const input = document.getElementById('db-search');
      if (input && name) {
        input.value = name;
        input.setAttribute('value', name);
        input.dataset.foodnoteSelectedName = name;
        input.dataset.foodnoteSearchSelectionLocked = '1';
      }
      const hidden = document.getElementById('db-selected-id');
      const foodId = food && (food.id || food.bddId);
      if (hidden && foodId) hidden.value = String(foodId);

      const modal = document.getElementById('food-add-modal');
      if (modal) {
        modal.classList.remove('food-add-ai-mode', 'food-add-quick-mode', 'food-add-recipe-mode', 'food-add-recipe-camera', 'food-add-recipe-crop', 'food-add-recipe-result', 'food-add-recipe-processing', 'food-intent-estimate', 'food-intent-recipes', 'fn-modal-view-capture-family', 'fn-modal-mode-barcode', 'fn-modal-mode-nutrition-table', 'fn-modal-mode-recipe', 'fn-modal-mode-capture');
        modal.classList.add('food-intent-search', 'fn-modal-mode-search', 'food-add-expanded');
        modal.dataset.fnModalView = 'search';
        delete modal.dataset.foodnoteWorkflow;
      }

      const box = document.getElementById('db-suggestions');
      if (box) {
        box.dataset.foodnoteKeepVisible = '1';
        box.dataset.foodnoteKeepVisibleUntil = String(until);
        if (Number.isFinite(Number(index))) box.dataset.foodnotePickedIndex = String(Number(index));
        box.classList.add('visible');
        box.removeAttribute('aria-hidden');
        box.style.setProperty('display', 'block', 'important');
        box.style.setProperty('visibility', 'visible', 'important');
        box.style.setProperty('pointer-events', 'auto', 'important');
        box.style.setProperty('height', 'min(42dvh, 360px)', 'important');
        box.style.setProperty('max-height', 'min(42dvh, 360px)', 'important');
        box.style.setProperty('opacity', '1', 'important');
        box.style.setProperty('overflow-y', 'auto', 'important');
        box.style.setProperty('padding-top', '4px', 'important');
        box.style.setProperty('padding-bottom', '4px', 'important');
        box.querySelectorAll('.db-suggestion').forEach(el => {
          const active = Number(el.dataset.index) === Number(index);
          el.classList.toggle('active', active);
          el.classList.toggle('selected', active);
          el.classList.toggle('is-selected', active);
          el.setAttribute('aria-selected', active ? 'true' : 'false');
        });
      }
    } catch(e) {}
  };

  apply();
  if (options.sticky !== false) {
    [0, 30, 80, 160, 320, 700, 1200, 2200].forEach(delay => setTimeout(apply, delay));
  }
}
window.foodnoteStabilizeSearchPickSurface = foodnoteStabilizeSearchPickSurface;

function installDBSearchSelectionInputLock() {
  if (document.__foodnoteDBSearchSelectionInputLock === '1') return;
  document.__foodnoteDBSearchSelectionInputLock = '1';
  const restore = (ev) => {
    const target = ev && ev.target;
    if (!target || target.id !== 'db-search') return;
    const until = Number(window.__foodnoteSelectedSearchLockUntil || 0);
    const name = String(window.__foodnoteSelectedSearchName || '').trim();
    if (!name || Date.now() > until) return;
    if (String(target.value || '').trim() === name) return;
    setTimeout(() => {
      try {
        const food = window.__foodnoteSelectedSearchFood || dbQuantityFood || dbSelectedFood || { nom:name };
        foodnoteStabilizeSearchPickSurface(food, window.__foodnoteSelectedSearchIndex, { sticky:false });
      } catch(e) {}
    }, 0);
  };
  document.addEventListener('input', restore, true);
  document.addEventListener('change', restore, true);
}
installDBSearchSelectionInputLock();

function keepDBSuggestionsVisibleAfterPick(index, ms = 9000) {
  const until = Date.now() + Math.max(1200, Number(ms) || 9000);
  try { window.__foodnoteKeepDBSuggestionsVisibleUntil = until; } catch(e) {}
  const box = document.getElementById('db-suggestions');
  if (!box) return;
  box.dataset.foodnoteKeepVisible = '1';
  box.dataset.foodnotePickedIndex = String(Number.isFinite(Number(index)) ? Number(index) : -1);
  box.dataset.foodnoteKeepVisibleUntil = String(until);
  box.classList.add('visible');
  box.removeAttribute('aria-hidden');
  try {
    box.style.setProperty('display', 'block', 'important');
    box.style.setProperty('visibility', 'visible', 'important');
    box.style.setProperty('pointer-events', 'auto', 'important');
    box.style.setProperty('height', 'min(42dvh, 360px)', 'important');
    box.style.setProperty('max-height', 'min(42dvh, 360px)', 'important');
    box.style.setProperty('opacity', '1', 'important');
    box.style.setProperty('overflow-y', 'auto', 'important');
    box.style.setProperty('padding-top', '4px', 'important');
    box.style.setProperty('padding-bottom', '4px', 'important');
    const modal = document.getElementById('food-add-modal');
    if (modal) modal.classList.add('food-add-expanded', 'fn-suggestions-open');
  } catch(e) {}
}

function shouldKeepDBSuggestionsVisible() {
  try {
    const box = document.getElementById('db-suggestions');
    const globalUntil = Number(window.__foodnoteKeepDBSuggestionsVisibleUntil || 0);
    const boxUntil = Number(box?.dataset?.foodnoteKeepVisibleUntil || 0);
    return Math.max(globalUntil, boxUntil) > Date.now();
  } catch(e) { return false; }
}
window.foodnoteShouldKeepDBSuggestionsVisible = shouldKeepDBSuggestionsVisible;
window.foodnoteKeepDBSuggestionsVisibleAfterPick = keepDBSuggestionsVisibleAfterPick;

function clearDBSuggestionsKeepVisibleFlag() {
  try { window.__foodnoteKeepDBSuggestionsVisibleUntil = 0; } catch(e) {}
  const box = document.getElementById('db-suggestions');
  if (!box) return;
  delete box.dataset.foodnoteKeepVisible;
  delete box.dataset.foodnotePickedIndex;
  delete box.dataset.foodnoteKeepVisibleUntil;
}

function markDBSuggestionPicked(index) {
  keepDBSuggestionsVisibleAfterPick(index);
  const box = document.getElementById('db-suggestions');
  if (!box) return;
  box.classList.add('visible');
  box.removeAttribute('aria-hidden');
  box.querySelectorAll('.db-suggestion').forEach(el => {
    const active = Number(el.dataset.index) === Number(index);
    el.classList.toggle('active', active);
    el.classList.toggle('selected', active);
    el.classList.toggle('is-selected', active);
    el.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

let _lastDBSuggestionPick = { index: -1, at: 0 };
function pickDBSuggestion(index, options = {}) {
  const now = Date.now();
  index = Number(index);
  if (!Number.isInteger(index) || index < 0) return;
  // onpointerdown + onclick peuvent parfois se succéder sur mobile : anti double-ajout.
  if (_lastDBSuggestionPick.index === index && now - _lastDBSuggestionPick.at < 450) return;
  _lastDBSuggestionPick = { index, at: now };
  const s = dbSuggestionItems[index];
  if (!s || s.type === 'loading' || s.type === 'status') return;
  if (s.type === 'create') {
    prepareNewFoodFromSearch();
    return;
  }
  if (s.type === 'item') {
    const source = s.source || s.item?.source || 'base';
    const item = withUnitDefaults({...s.item, source});
    const meta = {
      source,
      external: source !== 'base' || !!s.item?.external,
      bddId: item.id || item.bddId || null,
      keepSuggestions: true,
      pickedIndex: index
    };
    dbSelectedFood = item;
    keepDBSuggestionsVisibleAfterPick(index, 12000);
    foodnoteStabilizeSearchPickSurface(item, index, { sticky:true, ms:12000 });
    const hidden = document.getElementById('db-selected-id');
    if (hidden) hidden.value = String(meta.bddId || '');
    foodnoteApplySelectedSearchFoodToInput(item, { sticky:true });
    updateDBSelectedCard(item);
    openDBQuantitySelector(item, meta);
    markDBSuggestionPicked(index);
    foodnoteStabilizeSearchPickSurface(item, index, { sticky:true, ms:12000 });
    foodnoteApplySelectedSearchFoodToInput(item, { sticky:true });
  }
}
window.pickDBSuggestion = pickDBSuggestion;

function installDBSuggestionDirectPickGuard() {
  if (document.__foodnoteDBSuggestionDirectPickGuard === '1') return;
  document.__foodnoteDBSuggestionDirectPickGuard = '1';
  const handle = (ev) => {
    const target = ev.target;
    const el = target && target.closest && target.closest('#db-suggestions [data-food-add-action="search-pick"]');
    if (!el) return;
    const index = Number(el.dataset.searchIndex ?? el.dataset.index ?? -1);
    if (!Number.isInteger(index) || index < 0) return;
    // 0.22.179 : on sélectionne dès le pointerdown, avant que d'autres contrôleurs
    // puissent fermer/reconcilier la liste. Le bandeau reste visible et la ligne cliquée
    // reste marquée, ce qui rend la sélection compréhensible.
    ev.preventDefault();
    ev.stopImmediatePropagation();
    pickDBSuggestion(index, { keepSuggestions:true, eventType:ev.type });
  };
  document.addEventListener('pointerdown', handle, true);
  document.addEventListener('mousedown', handle, true);
  document.addEventListener('touchstart', handle, true);
  document.addEventListener('touchend', handle, true);
  document.addEventListener('click', handle, true);
}
installDBSuggestionDirectPickGuard();

function handleDBSearchKey(event) {
  const box = document.getElementById('db-suggestions');
  if (!box || !box.classList.contains('visible')) return;
  const max = dbSuggestionItems.length - 1;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    dbSuggestionIndex = Math.min(max, dbSuggestionIndex + 1);
    markDBSuggestionActive();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    dbSuggestionIndex = Math.max(0, dbSuggestionIndex - 1);
    markDBSuggestionActive();
  } else if (event.key === 'Enter') {
    if (dbSuggestionIndex >= 0 && dbSuggestionItems[dbSuggestionIndex]) {
      event.preventDefault();
      pickDBSuggestion(dbSuggestionIndex);
    }
  } else if (event.key === 'Escape') {
    box.classList.remove('visible');
    setFoodAddExpanded(false);
  }
}

function markDBSuggestionActive() {
  document.querySelectorAll('#db-suggestions .db-suggestion').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.index) === dbSuggestionIndex);
  });
}


function ensureDBQuantitySelector() {
  let panel = document.getElementById('db-quantity-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'db-quantity-panel';
  panel.className = 'db-quantity-panel fn-ui-surface fn-ui-surface-soft';
  panel.setAttribute('aria-live', 'polite');
  const selected = document.getElementById('db-selected-card');
  const suggestions = document.getElementById('db-suggestions');
  const parent = selected?.parentElement || suggestions?.parentElement || document.querySelector('#food-add-modal .db-autocomplete');
  if (selected && selected.parentElement) selected.parentElement.insertBefore(panel, selected.nextSibling);
  else if (suggestions && suggestions.parentElement) suggestions.parentElement.insertBefore(panel, suggestions.nextSibling);
  else parent?.appendChild(panel);
  return panel;
}

function isDBQuantitySelectorOpen() {
  return !!(document.getElementById('db-quantity-panel')?.classList.contains('visible') && dbQuantityFood);
}
window.isDBQuantitySelectorOpen = isDBQuantitySelectorOpen;

function isDBQuantitySearchGuardActive() {
  if (!isDBQuantitySelectorOpen()) return false;
  const input = document.getElementById('db-search');
  const currentQuery = normalizeSearchText(input?.value || '');
  const selectedName = normalizeSearchText(dbQuantityFood?.nom || '');
  // Si le sélecteur quantité est ouvert, les focus différés / résultats async
  // de recherche ne doivent pas fermer la carte ni rouvrir la liste.
  // On ne laisse repartir une recherche que si l'utilisateur a vraiment changé le texte.
  return Date.now() < dbQuantitySearchLockUntil || !currentQuery || currentQuery === selectedName;
}
window.foodnoteIsDBQuantityFlowActive = function(){
  try { return isDBQuantitySelectorOpen() || Date.now() < dbQuantitySearchLockUntil; } catch(e) { return false; }
};

function hideDBSuggestionsOnly(options = {}) {
  clearTimeout(dbAutoTimer);
  dbAutoToken++;
  if (options.force !== true && shouldKeepDBSuggestionsVisible()) {
    const picked = Number(document.getElementById('db-suggestions')?.dataset?.foodnotePickedIndex ?? -1);
    keepDBSuggestionsVisibleAfterPick(picked);
    markDBSuggestionPicked(picked);
    return;
  }
  const box = document.getElementById('db-suggestions');
  if (box) {
    clearDBSuggestionsKeepVisibleFlag();
    box.innerHTML = '';
    box.classList.remove('visible');
  }
}

function closeDBQuantitySelector(options = {}) {
  const panel = document.getElementById('db-quantity-panel');
  if (panel) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
  }
  dbQuantityFood = null;
  dbQuantityMeta = null;
  dbQuantitySearchLockUntil = 0;
  document.getElementById('food-add-modal')?.classList.remove('food-quantity-open');
  const btn = document.getElementById('food-main-action-btn');
  if (btn && foodAddMode !== 'ia') btn.textContent = `Ajouter au ${mealLabel(foodAddTargetMeal || 'lunch')}`;
  if (!options.keepSearch) {
    clearDBSuggestionsKeepVisibleFlag();
    const hidden = document.getElementById('db-selected-id');
    if (hidden) hidden.value = '';
    dbQuantityResetMemory(100);
  }
}

function mealLabel(mealId) {
  const id = (typeof normalizeMealId === 'function') ? normalizeMealId(mealId || 'lunch') : (mealId || 'lunch');
  const fallbackMeals = [
    {id:'breakfast', label:'Petit-déj', icon:'☕'},
    {id:'lunch', label:'Déjeuner', icon:'🍽️'},
    {id:'dinner', label:'Souper', icon:'🌙'},
  ];
  const list = (typeof MEAL_OPTIONS !== 'undefined' && Array.isArray(MEAL_OPTIONS)) ? MEAL_OPTIONS : fallbackMeals;
  const m = list.find(x => x && x.id === id) || list.find(x => x && x.id === 'lunch') || fallbackMeals[1];
  return m ? `${m.icon ? m.icon + ' ' : ''}${m.label || 'repas'}` : 'repas';
}

function dbQuantityIsUnit(food) {
  return false;
}

function dbQuantityConfig(food, value) {
  const cur = Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 100;
  const max = Math.max(500, Math.ceil(cur * 2), 1000);
  return { isUnit:false, unitWeight:0, min:5, max, step:5, quick:[50, 100, 150, 200, 250, 300] };
}

function dbQuantityLabel(food, qty) {
  qty = Number(qty) || 100;
  return `${Math.round(qty)} g`;
}

function dbQuantityRawNumber(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dbQuantityNormalizeValue(food, value, fallback = null) {
  const raw = dbQuantityRawNumber(value);
  const safeFallback = dbQuantityRawNumber(fallback);
  const base = raw ?? safeFallback ?? (dbQuantityIsUnit(food || {}) ? 1 : 100);
  const cfg = dbQuantityConfig(food || {}, base);
  return cfg.isUnit ? Math.round(base * 4) / 4 : Math.round(base);
}

function foodnoteRecordDBQuantityUserEdit(value, source = 'user') {
  const food = dbQuantityFood || {};
  const fallback = dbQuantityIsUnit(food) ? 1 : 100;
  const raw = dbQuantityRawNumber(value);
  if (raw == null) return null;
  const qty = dbQuantityNormalizeValue(food, raw, fallback);
  const at = Date.now();
  dbQuantityUserEditValue = qty;
  dbQuantityUserEditAt = at;
  dbQuantityUserValue = qty;
  dbQuantityUserTouchedAt = at;
  dbQuantityLastValue = qty;
  dbQuantityLastTouchedAt = at;
  try {
    window.__foodnoteDbQuantityUserEditValue = qty;
    window.__foodnoteDbQuantityUserEditAt = at;
    window.__foodnoteDbQuantityUserValue = qty;
    window.__foodnoteDbQuantityUserTouchedAt = at;
    window.__foodnoteDbQuantityFinalValue = qty;
    window.__foodnoteDbQuantityEditSource = String(source || 'user');
  } catch(e) {}
  return qty;
}

function foodnoteGetLastDBQuantityUserEdit() {
  const value = dbQuantityRawNumber(dbQuantityUserEditValue ?? window.__foodnoteDbQuantityUserEditValue);
  const at = Number(dbQuantityUserEditAt || window.__foodnoteDbQuantityUserEditAt || 0);
  const openedAt = Number(dbQuantityOpenedAt || window.__foodnoteDbQuantityOpenedAt || 0);
  if (value == null || !at) return null;
  if (openedAt && at < openedAt) return null;
  if (Date.now() - at > 10 * 60 * 1000) return null;
  return dbQuantityNormalizeValue(dbQuantityFood || {}, value, dbQuantityIsUnit(dbQuantityFood || {}) ? 1 : 100);
}
window.foodnoteGetLastDBQuantityUserEdit = foodnoteGetLastDBQuantityUserEdit;

function dbQuantityRememberValue(value, food = dbQuantityFood) {
  const qty = dbQuantityNormalizeValue(food || {}, value, dbQuantityDefaultAtOpen);
  const now = Date.now();
  dbQuantityLastValue = qty;
  dbQuantityLastTouchedAt = now;
  dbQuantityUserValue = qty;
  dbQuantityUserTouchedAt = now;
  try {
    window.__foodnoteDbQuantityUserValue = qty;
    window.__foodnoteDbQuantityUserTouchedAt = now;
    window.__foodnoteDbQuantityFinalValue = qty;
  } catch(e) {}
  return qty;
}

function dbQuantityResetMemory(value = 100) {
  const qty = dbQuantityNormalizeValue(dbQuantityFood || {}, value, 100);
  dbQuantityLastValue = qty;
  dbQuantityDefaultAtOpen = qty;
  dbQuantityLastTouchedAt = 0;
  dbQuantityOpenedAt = 0;
  dbQuantityUserValue = null;
  dbQuantityUserTouchedAt = 0;
  dbQuantityUserEditValue = null;
  dbQuantityUserEditAt = 0;
  try {
    window.__foodnoteDbQuantityUserValue = null;
    window.__foodnoteDbQuantityUserTouchedAt = 0;
    window.__foodnoteDbQuantityUserEditValue = null;
    window.__foodnoteDbQuantityUserEditAt = 0;
    window.__foodnoteDbQuantityOpenedAt = 0;
    window.__foodnoteDbQuantityFinalValue = null;
  } catch(e) {}
}

function foodnoteReadFinalDBQuantityFromDOM(options = {}) {
  const food = dbQuantityFood || {};
  const fallback = dbQuantityIsUnit(food) ? 1 : 100;
  const openedDefault = dbQuantityRawNumber(dbQuantityDefaultAtOpen) ?? fallback;
  const panel = document.getElementById('db-quantity-panel');
  const panelVisible = !!(panel && panel.classList.contains('visible'));
  const input = document.getElementById('db-quantity-input');
  const range = document.getElementById('db-quantity-range');
  const legacyQty = document.getElementById('db-qty');
  const panelRaw = dbQuantityRawNumber(panel?.dataset?.foodnoteQuantityValue);
  const inputRaw = dbQuantityRawNumber(input?.value);
  const rangeRaw = dbQuantityRawNumber(range?.value);
  const legacyRaw = dbQuantityRawNumber(legacyQty?.value);
  const userRaw = dbQuantityRawNumber(dbQuantityUserValue ?? window.__foodnoteDbQuantityUserValue);
  const finalRaw = dbQuantityRawNumber(window.__foodnoteDbQuantityFinalValue);
  const active = document.activeElement;

  const normalize = (value) => dbQuantityNormalizeValue(food, value, fallback);
  if (active === input && inputRaw != null) return normalize(inputRaw);
  if (active === range && rangeRaw != null) return normalize(rangeRaw);
  if (active === legacyQty && legacyRaw != null) return normalize(legacyRaw);

  const lastUserEdit = foodnoteGetLastDBQuantityUserEdit();
  if (lastUserEdit != null) return normalize(lastUserEdit);

  if (panelVisible && inputRaw != null && rangeRaw != null && Math.abs(inputRaw - rangeRaw) >= 0.001) {
    const inputChanged = Math.abs(inputRaw - openedDefault) >= 0.001;
    const rangeChanged = Math.abs(rangeRaw - openedDefault) >= 0.001;
    if (inputChanged && !rangeChanged) return normalize(inputRaw);
    if (rangeChanged && !inputChanged) return normalize(rangeRaw);
    if (inputChanged && rangeChanged) return normalize(inputRaw);
  }

  if (panelVisible && inputRaw != null) return normalize(inputRaw);
  if (panelVisible && rangeRaw != null) return normalize(rangeRaw);
  if (panelVisible && panelRaw != null) return normalize(panelRaw);
  if (userRaw != null && dbQuantityUserTouchedAt >= dbQuantityOpenedAt) return normalize(userRaw);
  if (finalRaw != null) return normalize(finalRaw);
  if (legacyRaw != null) return normalize(legacyRaw);
  return normalize(fallback);
}
window.foodnoteReadFinalDBQuantityFromDOM = foodnoteReadFinalDBQuantityFromDOM;

function dbQuantityReadValue() {
  const forcedDom = foodnoteReadFinalDBQuantityFromDOM();
  if (Number.isFinite(Number(forcedDom)) && Number(forcedDom) > 0) return forcedDom;
  const input = document.getElementById('db-quantity-input');
  const range = document.getElementById('db-quantity-range');
  const legacyQty = document.getElementById('db-qty');
  const panel = document.getElementById('db-quantity-panel');
  const food = dbQuantityFood || {};
  const fallback = dbQuantityIsUnit(food) ? 1 : 100;
  const openedDefault = dbQuantityRawNumber(dbQuantityDefaultAtOpen) ?? fallback;
  const panelRaw = dbQuantityRawNumber(panel?.dataset?.foodnoteQuantityValue);
  const inputRaw = dbQuantityRawNumber(input?.value);
  const rangeRaw = dbQuantityRawNumber(range?.value);
  const legacyRaw = dbQuantityRawNumber(legacyQty?.value);
  const lastRaw = dbQuantityRawNumber(dbQuantityLastValue);
  const userRaw = dbQuantityRawNumber(dbQuantityUserValue);
  const finalRaw = dbQuantityRawNumber(window.__foodnoteDbQuantityFinalValue);
  const active = document.activeElement;

  // 0.22.179 : lecture finale déterministe.
  // Le DOM visible gagne toujours sur une mémoire ancienne. C'est le point qui cassait
  // le cas "je sélectionne l'aliment puis je règle 75 g" : une valeur interne à 100
  // pouvait encore être lue avant le contrôle réellement modifié.
  const activeValue = active === input ? inputRaw : active === range ? rangeRaw : active === legacyQty ? legacyRaw : null;
  if (activeValue != null) return dbQuantityNormalizeValue(food, activeValue, fallback);
  const lastUserEdit = foodnoteGetLastDBQuantityUserEdit();
  if (lastUserEdit != null) return dbQuantityNormalizeValue(food, lastUserEdit, fallback);

  const domCandidates = [
    { name:'input', value:inputRaw },
    { name:'range', value:rangeRaw },
    { name:'legacy', value:legacyRaw },
    { name:'panel', value:panelRaw }
  ].filter(c => c.value != null);

  const changed = domCandidates.filter(c => Math.abs(c.value - openedDefault) >= 0.001);
  if (changed.length) {
    const priority = ['input', 'range', 'legacy', 'panel'];
    const chosen = priority.map(name => changed.find(c => c.name === name)).find(Boolean) || changed[0];
    return dbQuantityNormalizeValue(food, chosen.value, fallback);
  }

  if (dbQuantityUserTouchedAt >= dbQuantityOpenedAt && userRaw != null) return dbQuantityNormalizeValue(food, userRaw, fallback);
  if (finalRaw != null) return dbQuantityNormalizeValue(food, finalRaw, fallback);
  if (panelRaw != null) return dbQuantityNormalizeValue(food, panelRaw, fallback);
  if (inputRaw != null) return dbQuantityNormalizeValue(food, inputRaw, fallback);
  if (rangeRaw != null) return dbQuantityNormalizeValue(food, rangeRaw, fallback);
  if (legacyRaw != null) return dbQuantityNormalizeValue(food, legacyRaw, fallback);
  if (dbQuantityLastTouchedAt && lastRaw != null) return dbQuantityNormalizeValue(food, lastRaw, fallback);
  return fallback;
}

function setDBQuantityValue(value, options = {}) {
  if (!dbQuantityFood) return;
  const cfg = dbQuantityConfig(dbQuantityFood, value);
  let qty = dbQuantityNormalizeValue(dbQuantityFood, value, dbQuantityDefaultAtOpen);
  if (!Number.isFinite(qty) || qty <= 0) qty = cfg.isUnit ? 1 : 100;
  qty = cfg.isUnit ? Math.round(qty * 4) / 4 : Math.round(qty);
  dbQuantityLastValue = qty;
  if (!(options && options.touch === false)) {
    const now = Date.now();
    dbQuantityLastTouchedAt = now;
    dbQuantityUserValue = qty;
    dbQuantityUserTouchedAt = now;
    dbQuantityUserEditValue = qty;
    dbQuantityUserEditAt = now;
    try {
      window.__foodnoteDbQuantityUserValue = qty;
      window.__foodnoteDbQuantityUserTouchedAt = now;
      window.__foodnoteDbQuantityUserEditValue = qty;
      window.__foodnoteDbQuantityUserEditAt = now;
      window.__foodnoteDbQuantityFinalValue = qty;
      window.__foodnoteDbQuantityEditSource = String(options.source || 'setDBQuantityValue');
    } catch(e) {}
  }
  const range = document.getElementById('db-quantity-range');
  const input = document.getElementById('db-quantity-input');
  if (range) {
    if (qty > Number(range.max)) range.max = String(Math.ceil(qty));
    range.value = String(qty);
  }
  if (input) input.value = String(qty);
  const legacyQty = document.getElementById('db-qty');
  if (legacyQty) legacyQty.value = String(qty);
  const panel = document.getElementById('db-quantity-panel');
  if (panel) panel.dataset.foodnoteQuantityValue = String(qty);
  if (dbQuantityMeta) dbQuantityMeta.qty = qty;
  try { if (window.FoodNoteFoodAddSearchState) window.FoodNoteFoodAddSearchState.quantityMeta = dbQuantityMeta; } catch(e) {}
  renderDBQuantityPreview(qty);
}

function nudgeDBQuantity(delta) {
  const current = dbQuantityReadValue();
  const cfg = dbQuantityConfig(dbQuantityFood || {}, current);
  setDBQuantityValue(Math.max(cfg.min, current + delta));
}

function renderDBQuantityPreview(qty) {
  if (!dbQuantityFood) return;
  qty = Number(qty) || (dbQuantityIsUnit(dbQuantityFood) ? 1 : 100);
  const m = getMacros(dbQuantityFood, qty);
  const label = document.getElementById('db-quantity-label');
  const macros = document.getElementById('db-quantity-macros');
  const kcal = document.getElementById('db-quantity-kcal');
  if (label) label.textContent = dbQuantityLabel(dbQuantityFood, qty);
  if (macros) macros.innerHTML = nutrientInlineHTML(m);
  if (kcal) kcal.textContent = `${Math.round(m.kcal || 0)} kcal`;
}

function bindDBQuantityPanelEvents(panel) {
  if (!panel || panel.dataset.foodnoteQuantityEventsReady === '1') return;
  panel.dataset.foodnoteQuantityEventsReady = '1';
  const sync = (ev) => {
    const target = ev && ev.target;
    if (!target || !target.matches || !target.matches('[data-food-add-quantity-input]')) return;
    setDBQuantityValue(target.value, { source:'quantity-panel-event' });
  };
  panel.addEventListener('input', sync, true);
  panel.addEventListener('change', sync, true);
}

function bindDBLegacyQtyInputSync() {
  if (document.__foodnoteDbLegacyQtyInputSync === '1') return;
  document.__foodnoteDbLegacyQtyInputSync = '1';
  const sync = (ev) => {
    const target = ev && ev.target;
    if (!target || target.id !== 'db-qty') return;
    if (!isDBQuantitySelectorOpen()) return;
    setDBQuantityValue(target.value, { source:'legacy-db-qty' });
  };
  document.addEventListener('input', sync, true);
  document.addEventListener('change', sync, true);
}

function installDBQuantityUserEditCapture() {
  if (document.__foodnoteDbQuantityUserEditCapture === '1') return;
  document.__foodnoteDbQuantityUserEditCapture = '1';
  const capture = (ev) => {
    const target = ev && ev.target;
    if (!target || !target.matches) return;
    if (!target.matches('#db-qty, #db-quantity-input, #db-quantity-range, [data-food-add-quantity-input]')) return;
    if (!isDBQuantitySelectorOpen() && target.id !== 'db-qty') return;
    foodnoteRecordDBQuantityUserEdit(target.value, target.id || 'quantity-control');
    try {
      const box = document.getElementById('db-suggestions');
      const picked = Number(box?.dataset?.foodnotePickedIndex ?? window.__foodnoteSelectedSearchIndex ?? -1);
      if (typeof foodnoteStabilizeSearchPickSurface === 'function' && dbQuantityFood) {
        foodnoteStabilizeSearchPickSurface(dbQuantityFood, picked, { sticky:false, ms:12000 });
      }
    } catch(e) {}
  };
  document.addEventListener('input', capture, true);
  document.addEventListener('change', capture, true);
}
installDBQuantityUserEditCapture();

function openDBQuantitySelector(food, meta = {}) {
  if (!food || !food.nom) return;
  food = sanitizeFoodUnitMeta(withUnitDefaults({...food}));
  dbQuantityFood = food;
  dbQuantityMeta = {...meta};
  dbQuantitySearchLockUntil = Date.now() + 10 * 60 * 1000;
  if (meta && meta.keepSuggestions) markDBSuggestionPicked(meta.pickedIndex);
  else hideDBSuggestionsOnly();
  const defaultQty = dbQuantityNormalizeValue(food, meta.qty ?? qtyForSelectedFood(food), dbQuantityIsUnit(food) ? 1 : 100);
  dbQuantityDefaultAtOpen = defaultQty;
  dbQuantityLastValue = defaultQty;
  dbQuantityLastTouchedAt = 0;
  dbQuantityOpenedAt = Date.now();
  dbQuantityUserValue = null;
  dbQuantityUserTouchedAt = 0;
  dbQuantityUserEditValue = null;
  dbQuantityUserEditAt = 0;
  try {
    window.__foodnoteDbQuantityOpenedAt = dbQuantityOpenedAt;
    window.__foodnoteDbQuantityUserValue = null;
    window.__foodnoteDbQuantityUserTouchedAt = 0;
    window.__foodnoteDbQuantityUserEditValue = null;
    window.__foodnoteDbQuantityUserEditAt = 0;
    window.__foodnoteDbQuantityFinalValue = null;
  } catch(e) {}
  const cfg = dbQuantityConfig(food, defaultQty);
  const panel = ensureDBQuantitySelector();
  if (!panel) return;
  bindDBQuantityPanelEvents(panel);
  bindDBLegacyQtyInputSync();
  const meal = normalizeMealId(foodAddTargetMeal || 'lunch');
  const mealTxt = mealLabel(meal);
  const quick = cfg.quick.map(v => `<button type="button" class="db-quantity-chip" data-food-add-action="quantity-set" data-quantity-value="${v}">${escapeHtml(dbQuantityLabel(food, v))}</button>`).join('');
  panel.innerHTML = `
    <div class="db-quantity-head">
      <div>
        <div class="db-quantity-kicker">Quantité à ajouter</div>
        <div class="db-quantity-title">${escapeHtml(food.nom)}</div>
        <div class="db-quantity-sub">Ajout dans <b>${escapeHtml(mealTxt)}</b> · ${sourceBadgeHTML(food.source || meta.source || 'base')}</div>
      </div>
      <button type="button" class="db-quantity-close" data-food-add-action="quantity-close" aria-label="Annuler">×</button>
    </div>
    <div class="db-quantity-main">
      <button type="button" class="db-quantity-step" data-food-add-action="quantity-nudge" data-quantity-delta="-${cfg.step}" aria-label="Diminuer">−</button>
      <div class="db-quantity-center">
        <div class="db-quantity-value"><span id="db-quantity-label"></span><small id="db-quantity-kcal"></small></div>
        <input id="db-quantity-range" class="db-quantity-range" type="range" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${defaultQty}" data-food-add-quantity-input="1">
        <label class="db-quantity-number"><span>${cfg.isUnit ? 'Unités' : 'Grammes'}</span><input id="db-quantity-input" type="number" min="${cfg.min}" step="${cfg.step}" value="${defaultQty}" inputmode="decimal" data-food-add-quantity-input="1"></label>
      </div>
      <button type="button" class="db-quantity-step" data-food-add-action="quantity-nudge" data-quantity-delta="${cfg.step}" aria-label="Augmenter">+</button>
    </div>
    <div class="db-quantity-quick" aria-label="Quantités rapides">${quick}</div>
    <div id="db-quantity-macros" class="db-quantity-macros food-macro-line"></div>
    <div class="db-quantity-actions">
      <button type="button" class="btn-secondary" data-food-add-action="quantity-close">Annuler</button>
      <button type="button" class="btn-primary" data-food-add-action="quantity-confirm">Ajouter cette quantité</button>
    </div>`;
  panel.classList.add('visible');
  document.getElementById('food-add-modal')?.classList.add('food-quantity-open');
  const suggestionsBox = document.getElementById('db-suggestions');
  if (meta && meta.keepSuggestions) {
    if (suggestionsBox) {
      suggestionsBox.classList.add('visible');
      suggestionsBox.removeAttribute('aria-hidden');
    }
    markDBSuggestionPicked(meta.pickedIndex);
  } else {
    suggestionsBox?.classList.remove('visible');
  }
  document.getElementById('db-selected-card')?.classList.remove('visible');
  setFoodAddExpanded(true);
  const search = document.getElementById('db-search');
  if (search) {
    search.value = food.nom;
    try { search.blur(); } catch(e) {}
  }
  const btn = document.getElementById('food-main-action-btn');
  if (btn) btn.textContent = 'Ajouter cette quantité';
  setDBQuantityValue(defaultQty, { touch:false, source:'quantity-open-init' });
  setTimeout(() => {
    try { panel.scrollIntoView({block:'nearest', behavior:'smooth'}); } catch(e) {}
  }, 30);
}


function showFoodAddKeepOpenStatus(message) {
  const modal = document.getElementById('food-add-modal');
  if (!modal) return;
  let st = document.getElementById('db-add-status');
  if (!st) {
    st = document.createElement('div');
    st.id = 'db-add-status';
    st.className = 'fn-ui-inline-status ok';
    st.setAttribute('role', 'status');
    st.setAttribute('aria-live', 'polite');
    const panel = document.getElementById('db-quantity-panel');
    const suggestions = document.getElementById('db-suggestions');
    const selected = document.getElementById('db-selected-card');
    const anchor = panel || suggestions || selected || modal.querySelector('.db-autocomplete') || modal;
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(st, anchor.nextSibling);
    else modal.appendChild(st);
  }
  st.hidden = false;
  st.className = 'fn-ui-inline-status ok';
  st.textContent = message || '✓ Ajouté. Choisis le suivant.';
  clearTimeout(window.__foodnoteDbAddStatusTimer);
  window.__foodnoteDbAddStatusTimer = setTimeout(() => {
    const el = document.getElementById('db-add-status');
    if (el) {
      el.textContent = '';
      el.hidden = true;
    }
  }, 3000);
}

function resetFoodAddSearchAfterAdd(message) {
  const input = document.getElementById('db-search');
  const hidden = document.getElementById('db-selected-id');
  const suggestions = document.getElementById('db-suggestions');
  clearDBSuggestionsKeepVisibleFlag();
  if (input) input.value = '';
  if (hidden) hidden.value = '';
  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.classList.remove('visible');
  }
  dbSuggestionItems = [];
  dbSuggestionIndex = -1;
  dbSelectedFood = null;
  updateDBSelectedCard && updateDBSelectedCard(null);
  resetDBQty && resetDBQty();
  closeDBQuantitySelector({keepSearch:false});
  setFoodAddExpanded(false);
  showFoodAddKeepOpenStatus(message);
  const btn = document.getElementById('food-main-action-btn');
  if (btn && foodAddMode !== 'ia') btn.textContent = `Ajouter au ${mealLabel(foodAddTargetMeal || 'lunch')}`;
  setTimeout(() => {
    const stillOpen = document.getElementById('food-add-modal')?.classList.contains('is-open');
    if (stillOpen && input) {
      try { input.focus({preventScroll:true}); } catch(e) { input.focus(); }
    }
  }, 80);
}

function confirmDBQuantitySelection() {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.confirmQuantitySelection === 'function' && !window.FoodNoteFoodAddDomain.__confirmingQuantity) {
    return window.FoodNoteFoodAddDomain.confirmQuantitySelection();
  }
  if (!dbQuantityFood) return;
  const preparedFood = sanitizeFoodUnitMeta(withUnitDefaults({...dbQuantityFood}));
  const qty = dbQuantityReadValue();
  let bddId = dbQuantityMeta?.bddId || preparedFood.bddId || null;
  if (dbQuantityMeta?.external || preparedFood.external) {
    const bdd = getBDD();
    const exists = bdd.find(b => normalizeSearchText(b.nom) === normalizeSearchText(preparedFood.nom));
    if (exists) {
      bddId = exists.id;
    } else {
      bddId = Date.now();
      const pendingFood = {id:bddId, nom:preparedFood.nom, kcal100:preparedFood.kcal100, prot100:preparedFood.prot100, gluc100:preparedFood.gluc100, lip100:preparedFood.lip100, unite:'g', poidsUnite:null, uniteLabel:'', source:preparedFood.source};
      bdd.unshift(pendingFood);
      // 0.22.118 : ne pas normaliser/sauvegarder toute la BDD pendant le clic d'ajout.
      setTimeout(() => { try { saveBDD(bdd); } catch(e) { console.warn('[FoodNote] sauvegarde BDD différée impossible', e); } }, 950);
    }
  }
  addCustomAliment({
    nom:preparedFood.nom,
    defaut:qty,
    unite:'g',
    poidsUnite:null,
    uniteLabel:'',
    kcal100:preparedFood.kcal100,
    prot100:preparedFood.prot100,
    gluc100:preparedFood.gluc100,
    lip100:preparedFood.lip100,
    bddId,
    source:preparedFood.source || dbQuantityMeta?.source || 'base',
    meal: foodAddTargetMeal || 'lunch'
  });
  resetFoodAddSearchAfterAdd(`✓ ${preparedFood.nom} ajouté. Choisis le suivant.`);
}

window.setDBQuantityValue = setDBQuantityValue;
window.nudgeDBQuantity = nudgeDBQuantity;
window.closeDBQuantitySelector = closeDBQuantitySelector;
window.confirmDBQuantitySelection = confirmDBQuantitySelection;

function qtyForSelectedFood(food) {
  const input = document.getElementById('db-qty');
  const raw = parseFloat(input?.value);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

function resetDBQty() {
  const q = document.getElementById('db-qty');
  if (q) { q.value = 100; q.title = 'Quantité (g ou unité selon aliment)'; }
  dbQuantityResetMemory(100);
}

function selectDBFood(idOrItem) {
  let item = null;
  if (idOrItem && typeof idOrItem === 'object') item = idOrItem;
  const bdd = getBDD();
  const custom = typeof getCustomList === 'function' ? getCustomList() : [];
  if (!item) {
    item = bdd.find(b => String(b.id) === String(idOrItem) || String(b.bddId) === String(idOrItem))
        || custom.find(b => String(b.id) === String(idOrItem) || String(b.bddId) === String(idOrItem));
  }
  if (!item) {
    const q = normalizeSearchText(document.getElementById('db-search')?.value || '');
    item = bdd.find(b => normalizeSearchText(b.nom) === q)
        || custom.find(b => normalizeSearchText(b.nom) === q);
  }
  if (!item) return;
  item = withUnitDefaults({...item, source:'base'});
  dbSelectedFood = item;
  openDBQuantitySelector(item, {source:'base', bddId:item.id || item.bddId || null});
}

function selectExternalDBFood(index) {
  pickDBSuggestion(index);
}

function updateDBSelectedCard(item) {
  const card = document.getElementById('db-selected-card');
  if (!card) return;
  if (!item) {
    card.classList.remove('visible');
    card.innerHTML = '';
    return;
  }
  item = withUnitDefaults(item);
  const qty = qtyForSelectedFood(item);
  const m = getMacros(item, qty);
  card.innerHTML = `<div class="db-selected-top"><strong>${escapeHtml(item.nom)}</strong>${sourceBadgeHTML(item.source || 'base')}</div><div class="db-selected-sub">Produit sélectionné. Touche Ajouter pour choisir la quantité.</div><span class="food-macro-line">${nutrientInlineHTML(m)}</span>`;
  card.classList.add('visible');
}

function prepareNewFoodFromSearch() {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.prepareTypedSearchFood === 'function') {
    return window.FoodNoteFoodAddDomain.prepareTypedSearchFood();
  }
  const name = document.getElementById('db-search')?.value.trim();
  if (!name) return;
  const qty = parseFloat(document.getElementById('db-qty')?.value) || 100;
  clearDBSuggestionsKeepVisibleFlag();
  document.getElementById('db-suggestions')?.classList.remove('visible'); setFoodAddExpanded(false);
  document.getElementById('db-search').value = '';
  document.getElementById('db-selected-id').value = '';
  dbSelectedFood = null;
  updateDBSelectedCard && updateDBSelectedCard(null);

  // Créer directement la ligne avec nom pré-rempli et macros à 0
  // L'utilisateur utilisera le bouton G pour estimer les macros
  addCustomAliment(withUnitDefaults({nom: name, defaut: qty, kcal100: 0, prot100: 0, gluc100: 0, lip100: 0, bddId: null}));

  // Pas d'appel Groq automatique : l'IA ne doit partir que sur clic explicite du bouton Groq.
  // Cela évite les requêtes involontaires quand une journée sauvegardée est rechargée sur un autre appareil.
  if (typeof resetFoodAddGroqVisualState === 'function') resetFoodAddGroqVisualState();
  if (typeof showSaveStatus === 'function') showSaveStatus('Aliment ajouté. Clique sur Groq seulement si tu veux estimer.', false);
  resetFoodAddSearchAfterAdd(`✓ ${name} ajouté. Choisis le suivant.`);
}

function addFromDB() {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.addFromSearch === 'function') {
    return window.FoodNoteFoodAddDomain.addFromSearch();
  }
  const input = document.getElementById('db-search');
  const selectedFood = dbSelectedFood;
  if (isDBQuantitySelectorOpen()) {
    confirmDBQuantitySelection();
    return;
  }
  if (!selectedFood) {
    const typed = input?.value.trim();
    if (typed) {
      prepareNewFoodFromSearch();
      return;
    }
    return;
  }
  const preparedFood = withUnitDefaults(selectedFood);
  openDBQuantitySelector(preparedFood, {source:preparedFood.source || 'base', external:!!preparedFood.external, bddId:preparedFood.bddId || null});
}

function refreshDBSelect() {
  const input = document.getElementById('db-search');
  if (!input) return;
  try {
    if (Date.now() < Number(window.__foodnoteSuppressDBRefreshUntil || 0)) return;
  } catch(e) {}
  const value = String(input.value || '').trim();
  if (document.activeElement === input && value) renderDBSuggestions(value);
}

let _autoSaveTimer = null;
function autoSaveToday(delay = 800) {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    const date = document.getElementById('f-date')?.value;
    if (!date) return;
    saveEntry(true); // silent save
  }, Math.max(0, Number(delay) || 0));
}

function autoSaveTodayAfterFoodAdd() {
  // Ajout depuis Mémoire/popup : on marque explicitement l'action puis on sauvegarde vite côté SQLite.
  // Le marquage permet à saveEntry(true) de résoudre automatiquement un conflit de révision
  // sans afficher de popup, uniquement pour cet ajout récent.
  markFoodUiWriteForImmediateSave();
  autoSaveToday(80);
}

let _sportAutoSaveTimer = null;
let _sportSaveInFlight = false;
let _sportSaveQueued = false;
let _sportDirty = false;

function buildCurrentSportPayload() {
  return sportRows.map(r => {
    const sel = document.getElementById('ss-' + r);
    const nameInput = document.getElementById('sn-' + r);
    const selectedName = sel?.options?.[sel.selectedIndex]?.text?.split(' (')[0] || '';
    const customName = String(nameInput?.value || '').trim();
    const heures = parseFloat(document.getElementById('sh-' + r)?.value) || 0;
    const kcalH = parseFloat(document.getElementById('sk-' + r)?.value) || 0;
    const total = Math.round(heures * kcalH);
    return {
      nom: customName || selectedName || 'Activité',
      heures,
      kcalH,
      total
    };
  }).filter(s => s.heures > 0 && s.kcalH > 0 && s.total > 0);
}

function updateLocalEntryFromSportSave(savedEntry) {
  if (!savedEntry || !savedEntry.date) return;
  try {
    const entries = getEntries();
    const idx = entries.findIndex(e => e.date === savedEntry.date || String(e.id) === String(savedEntry.id));
    if (idx >= 0) entries[idx] = savedEntry; else entries.unshift(savedEntry);
    _db.journal_entries = sortEntriesDesc(entries);
    saveLocalOnly();
  } catch(e) {
    console.warn('[FoodNote] maj locale sport impossible', e);
  }
}

async function loadEntryDetailForDateBeforeSportSave(date) {
  if (!date) return null;
  const url = '/api/entries?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date) + '&limit=1&details=1';
  try {
    const fetcher = (typeof foodnoteFetchTimeout === 'function')
      ? foodnoteFetchTimeout(url, { cache:'no-store' }, 2500)
      : fetch(url, { cache:'no-store' });
    const r = await fetcher;
    if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?'));
    const d = await r.json();
    const row = Array.isArray(d.entries) ? d.entries[0] : (d.entry || null);
    if (!row) return null;
    const detail = (typeof normalizeServerEntry === 'function') ? normalizeServerEntry({ ...row, _detailsLoaded:true }) : { ...row, _detailsLoaded:true };
    try {
      const entries = typeof getEntries === 'function' ? getEntries() : (_db.journal_entries || []);
      const idx = entries.findIndex(e => e && (String(e.id) === String(detail.id) || e.date === detail.date));
      if (idx >= 0) entries[idx] = { ...entries[idx], ...detail, _detailsLoaded:true };
      else entries.unshift(detail);
      _db.journal_entries = sortEntriesDesc(entries);
      if (typeof saveLocalOnly === 'function') saveLocalOnly();
    } catch(e) {
      console.warn('[FoodNote] cache local détail sport non mis à jour', e);
    }
    return detail;
  } catch(e) {
    console.warn('[FoodNote] détail journée sport indisponible avant sauvegarde', e);
    return null;
  }
}

function currentSportSaveDate() {
  return document.getElementById('sport-f-date')?.value || document.getElementById('f-date')?.value;
}

async function saveSportPayloadForDate(date, sports, silent = true) {
  const depSport = (sports || []).reduce((sum, s) => sum + (Number(s.total) || 0), 0);

  // 0.22.75 — chemin canonique : écriture atomique dédiée au sport.
  // Elle remplace uniquement les lignes sport de la journée et ne touche jamais aux aliments.
  if (typeof postEntrySportsNative === 'function') {
    const saved = await postEntrySportsNative(date, sports, { __replaceSports:true, _detailsLoaded:true });
    updateLocalEntryFromSportSave(saved);
    return saved;
  }

  // Repli compatibilité pour anciennes archives : on conserve les aliments détaillés
  // avant de poster la journée complète, mais le serveur 0.22.75 garde aussi __replaceSports.
  let serverEntry = await loadEntryDetailForDateBeforeSportSave(date);
  if (!serverEntry) {
    try {
      if (typeof loadEntriesNative === 'function') await loadEntriesNative();
    } catch(e) {
      console.warn('[FoodNote] recharge serveur avant sauvegarde sport impossible', e);
    }
    serverEntry = (typeof getEntries === 'function' ? getEntries() : []).find(e => e && e.date === date && e._detailsLoaded === true)
      || (typeof getEntries === 'function' ? getEntries() : []).find(e => e && e.date === date)
      || null;
  }
  const macros = serverEntry?.macros || {kcal:0, prot:0, gluc:0, lip:0};
  const next = {
    ...(serverEntry || {}),
    id: serverEntry?.id || Date.now(),
    date,
    sports,
    depSport,
    aliments: Array.isArray(serverEntry?.aliments) ? serverEntry.aliments : (Array.isArray(serverEntry?.foods) ? serverEntry.foods : []),
    extras: serverEntry?.extras || '',
    poids: serverEntry?.poids || '',
    energie: serverEntry?.energie || '',
    faim: serverEntry?.faim || '',
    notes: serverEntry?.notes || '',
    macros,
    netKcal: Math.round((Number(macros.kcal) || 0) - depSport),
    __replaceSports: true,
    _detailsLoaded: true,
    dailyChecklist: {
      ...(serverEntry?.dailyChecklist || {}),
      sportDone: sports.length > 0 && depSport > 0
    },
    dailyReview: serverEntry?.dailyReview || {}
  };
  if (typeof postEntryNative !== 'function') throw new Error('postEntryNative indisponible');
  const saved = await postEntryNative(next, {force:true});
  updateLocalEntryFromSportSave(saved || next);
  return saved || next;
}

async function saveSportOnlyNow(silent = true) {
  if (_sportSaveInFlight) {
    _sportSaveQueued = true;
    return;
  }
  _sportSaveInFlight = true;
  try {
    do {
      _sportSaveQueued = false;
      const date = currentSportSaveDate();
      if (!date) return;
      const sports = buildCurrentSportPayload();
      _sportDirty = false;
      try {
        if (!silent) showSaveStatus('Sauvegarde sport SQLite…');
        await saveSportPayloadForDate(date, sports, silent);
        foodnoteRefreshJournalMutationViews('sport-save', { sportCarousel:true, journalCarousel:true, notification:true, dashboard:true });
        if (!silent) showSaveStatus('Sport enregistré SQLite ✓');
      } catch(e) {
        _sportDirty = true;
        console.error('[FoodNote] sauvegarde sport impossible', e);
        showSaveStatus('Sport non enregistré : ' + (e && e.message ? e.message : e), true);
        break;
      }
    } while (_sportSaveQueued);
  } finally {
    _sportSaveInFlight = false;
  }
}

function autoSaveSportOnly(delay = 700) {
  _sportDirty = true;
  clearTimeout(_sportAutoSaveTimer);
  _sportAutoSaveTimer = setTimeout(() => saveSportOnlyNow(true), Math.max(0, Number(delay) || 0));
}

function flushSportAutosaveBeforeDateChange() {
  const date = currentSportSaveDate();
  if (!date || !_sportDirty) return;
  const sports = buildCurrentSportPayload();
  clearTimeout(_sportAutoSaveTimer);
  _sportAutoSaveTimer = null;
  // Capture immédiate de l'ancienne date avant que l'UI ne remplace sportRows.
  saveSportPayloadForDate(date, sports, true)
    .then(saved => {
      updateLocalEntryFromSportSave(saved);
      foodnoteRefreshJournalMutationViews('sport-flush', { journalCarousel:true, sportCarousel:true });
    })
    .catch(e => {
      _sportDirty = true;
      console.error('[FoodNote] flush sport avant changement de date impossible', e);
      showSaveStatus('Sport non enregistré avant changement de date : ' + (e && e.message ? e.message : e), true);
    });
  _sportDirty = false;
}


function buildFoodPayloadFromIndex(idx) {
  const a = allAliments[idx];
  if (!a || isFoodLineDeleted(a)) return null;
  const lineUid = ensureFoodLineUid(a);
  const qty = Number(quantities[idx] || a.defaut || 0) || 0;
  const safeFood = { ...a, unite:'g', poidsUnite:null, unit:'g', unit_weight:null };
  const guard100 = foodnoteNutritionCheckFood100(safeFood);
  const guardLine = foodnoteNutritionCheckFoodLine(safeFood, qty);
  if (!guard100.ok) throw new Error(foodnoteGuardIssueText(guard100.block));
  if (!guardLine.ok) throw new Error(foodnoteGuardIssueText(guardLine.block));
  const m = getMacros(safeFood, qty);
  return {
    entryFoodId: a.entryFoodId || a.entry_food_id || null,
    entry_food_id: a.entry_food_id || a.entryFoodId || null,
    line_uid: lineUid || null,
    food_id: a.bddId || a.food_id || a.foodId || null,
    nom: a.nom,
    qty,
    unite: 'g',
    poidsUnite: null,
    uniteLabel: '',
    meal: normalizeMealId(a.meal || foodAddTargetMeal || 'lunch'),
    kcal: Math.round(m.kcal || 0),
    prot: round1(m.prot || 0),
    gluc: round1(m.gluc || 0),
    lip: round1(m.lip || 0)
  };
}

function currentJournalFormMetaForFoodSave() {
  const val = (id) => document.getElementById(id)?.value ?? '';
  return {
    poids: val('f-poids'),
    energie: val('f-energie'),
    faim: val('f-faim'),
    notes: val('f-notes'),
    extras: val('f-extras')
  };
}

function updateLocalEntryFromServerFoodSave(savedEntry) {
  if (!savedEntry || !savedEntry.date) return;
  const normalized = (typeof normalizeServerEntry === 'function') ? normalizeServerEntry(savedEntry) : savedEntry;
  const savedFood = normalized._savedFood || savedEntry._savedFood || null;

  if (savedFood) {
    const uid = foodLineUidOf(savedFood);
    const id = foodLineIdOf(savedFood);
    rememberFoodLineServerId(uid, id);
    if (uid && isFoodLineDeleted(uid)) {
      // Réponse tardive d'un ajout/patch déjà supprimé côté UI : ne jamais réinjecter la ligne.
      return;
    }
    const idx = findFoodIndexForSavedFood(savedFood);
    if (idx >= 0) {
      allAliments[idx].entryFoodId = id || allAliments[idx].entryFoodId;
      allAliments[idx].entry_food_id = id || allAliments[idx].entry_food_id;
      allAliments[idx].line_uid = uid || allAliments[idx].line_uid || null;
      allAliments[idx].lineUid = allAliments[idx].line_uid;
      customAliments = allAliments.slice(ALIMENTS_BASE.length);
      saveCustomList();
      if (typeof reconcileVisibleMealLines === 'function') reconcileVisibleMealLines('server-food-save', { focusIdx: idx, regroup:false, carousel:true });
    }
  }

  if (Array.isArray(normalized.aliments)) {
    const before = normalized.aliments.length;
    normalized.aliments = normalized.aliments.filter(a => !isFoodLineDeleted(a));
    if (normalized.aliments.length !== before) recalcEntryMacrosFromFoodRows(normalized);
  }

  const entries = getEntries ? getEntries() : (_db.journal_entries || []);
  const idx = entries.findIndex(e => String(e.date) === String(normalized.date) || String(e.id) === String(normalized.id));
  if (idx >= 0) entries[idx] = normalized; else entries.unshift(normalized);
  _db.journal_entries = (typeof sortEntriesDesc === 'function') ? sortEntriesDesc(entries) : entries;
  if (typeof saveLocalOnly === 'function') saveLocalOnly();
  foodnoteRefreshJournalMutationViews('server-food-save', { history:true, journalCarousel:true, notification:true, dashboard:true, recap:true });
}

let _foodLineSQLiteTimers = {};
function schedulePersistFoodLineToSQLite(idx, delay = 250, reason = 'qty') {
  const a = allAliments[idx];
  const uid = a ? ensureFoodLineUid(a) : ('idx:' + idx);
  clearTimeout(_foodLineSQLiteTimers[uid]);
  _foodLineSQLiteTimers[uid] = setTimeout(() => {
    const currentIdx = uid && !uid.startsWith('idx:') ? findFoodIndexByLineUid(uid) : idx;
    const currentFood = currentIdx >= 0 ? allAliments[currentIdx] : null;
    if (currentIdx < 0 || !currentFood || isFoodRuntimeDeleted(currentFood) || isFoodLineDeleted(uid)) return;
    persistFoodLineToSQLite(currentIdx, reason);
  }, Math.max(0, Number(delay) || 0));
}

function buildCurrentJournalEntryForFoodWrite() {
  const date = document.getElementById('f-date')?.value;
  if (!date) throw new Error('date obligatoire');

  let kcal = 0, prot = 0, gluc = 0, lip = 0;
  const alimList = [];
  selected.forEach(i => {
    const a = allAliments[i];
    if (!a || isFoodRuntimeDeleted(a) || isFoodLineDeleted(a)) return;
    const qty = Number(quantities[i] || 0) || 0;
    const m = getMacros(a, qty);
    kcal += Number(m.kcal || 0);
    prot += Number(m.prot || 0);
    gluc += Number(m.gluc || 0);
    lip += Number(m.lip || 0);
    alimList.push({
      nom: a.nom,
      entryFoodId: a.entryFoodId || a.entry_food_id || null,
      entry_food_id: a.entry_food_id || a.entryFoodId || null,
      line_uid: a.line_uid || a.lineUid || null,
      qty,
      unite: 'g',
      poidsUnite: null,
      uniteLabel: '',
      meal: normalizeMealId(a.meal || 'lunch'),
      kcal: Math.round(m.kcal || 0),
      prot: round1(m.prot || 0),
      gluc: round1(m.gluc || 0),
      lip: round1(m.lip || 0)
    });
  });

  const sportList = sportRows.map(r => ({
    nom: document.getElementById('ss-' + r)?.options[document.getElementById('ss-' + r)?.selectedIndex]?.text?.split(' (')[0] || '',
    heures: parseFloat(document.getElementById('sh-' + r)?.value) || 0,
    kcalH: parseFloat(document.getElementById('sk-' + r)?.value) || 0,
    total: Math.round((parseFloat(document.getElementById('sh-' + r)?.value) || 0) * (parseFloat(document.getElementById('sk-' + r)?.value) || 0))
  }));

  const depSport = sportList.reduce((s, r) => s + (Number(r.total || 0) || 0), 0);
  const existing = getEntries().find(e => e && e.date === date) || null;
  const existingChecklist = (existing && existing.dailyChecklist && typeof existing.dailyChecklist === 'object') ? existing.dailyChecklist : {};
  const existingReview = (existing && existing.dailyReview && typeof existing.dailyReview === 'object') ? existing.dailyReview : {};
  const poidsValue = document.getElementById('f-poids')?.value ?? '';
  const energieValue = document.getElementById('f-energie')?.value ?? '';
  const faimValue = document.getElementById('f-faim')?.value ?? '';
  const notesValue = document.getElementById('f-notes')?.value ?? '';
  const extrasValue = document.getElementById('f-extras')?.value ?? '';

  return {
    id: existing?.id || Date.now(),
    date,
    revision: Number(existing?.revision ?? existing?._revision ?? 0) || undefined,
    _revision: Number(existing?._revision ?? existing?.revision ?? 0) || undefined,
    updated_at: existing?.updated_at || null,
    poids: poidsValue,
    sports: sportList,
    depSport,
    aliments: alimList,
    extras: extrasValue,
    energie: energieValue,
    faim: faimValue,
    notes: notesValue,
    macros: {
      kcal: Math.round(kcal),
      prot: round1(prot),
      gluc: round1(gluc),
      lip: round1(lip)
    },
    netKcal: Math.round(kcal - depSport),
    dailyChecklist: {
      ...existingChecklist,
      ...(String(poidsValue || '').trim() ? { weightDone:true } : {}),
      ...(alimList.length ? { foodDone:true } : {}),
      ...(sportList.length && depSport > 0 ? { sportDone:true } : {}),
      ...((String(energieValue || '').trim() || String(faimValue || '').trim()) ? { feelingDone:true } : {}),
      ...((String(notesValue || '').trim() || String(extrasValue || '').trim()) ? { noteDone:true } : {})
    },
    dailyReview: existingReview
  };
}

async function forcePersistCurrentJournalAfterFoodWrite(reason = 'add', idx = null) {
  // 0.22.47 : pour une ligne de journal, l'identité sûre est (date + line_uid).
  // On évite de PATCHer directement entryFoodId, car un id ancien dans le cache peut
  // pointer vers une autre journée et bloquer l'édition après une première sauvegarde.
  if (idx == null) return null;
  const date = document.getElementById('f-date')?.value;
  let food = buildFoodPayloadFromIndex(idx);
  if (!date || !food) return null;
  const uid = foodLineUidOf(food) || ensureFoodLineUid(allAliments[idx]);
  if (uid) {
    food.line_uid = uid;
    food.lineUid = uid;
  }

  const run = async () => {
    const form = currentJournalFormMetaForFoodSave ? currentJournalFormMetaForFoodSave() : {};
    let saved;

    if (typeof postEntryFoodNative === 'function') {
      // POST /api/entries/:date/foods est volontairement un upsert par line_uid.
      // C'est le chemin canonique pour ajout, quantité et édition de snapshot.
      saved = await postEntryFoodNative(date, food, { form });
    } else {
      const lineId = food.entryFoodId || food.entry_food_id || null;
      if (!lineId || typeof patchEntryFoodNative !== 'function') throw new Error('API aliment atomique indisponible');
      saved = await patchEntryFoodNative(lineId, food, { form });
    }

    const savedFood = saved && (saved._savedFood || null);
    const savedUid = foodLineUidOf(savedFood) || uid;
    const savedId = foodLineIdOf(savedFood) || foodLineIdOf(food);
    rememberFoodLineServerId(savedUid, savedId);

    if (savedUid && isFoodLineDeleted(savedUid)) {
      if (savedId && typeof deleteEntryFoodNative === 'function') {
        const deletedEntry = await deleteEntryFoodNative(savedId);
        updateLocalEntryFromServerFoodSave(deletedEntry);
        return deletedEntry;
      }
      return saved;
    }

    updateLocalEntryFromServerFoodSave(saved);
    return saved;
  };

  return uid ? trackFoodLineWrite(uid, run()) : run();
}

async function persistFoodLineToSQLite(idx, reason = 'add') {
  const date = document.getElementById('f-date')?.value;
  const food = buildFoodPayloadFromIndex(idx);
  if (!date || !food) return false;
  if (isFoodRuntimeDeleted(food) || isFoodLineDeleted(food)) return false;
  markFoodUiWriteForImmediateSave();

  try {
    if (reason !== 'qty') showSaveStatus('Sauvegarde aliment SQLite…');
    await forcePersistCurrentJournalAfterFoodWrite(reason, idx);
    showSaveStatus(isFoodLineDeleted(food) ? 'Ligne supprimée SQLite ✓' : 'Aliment sauvegardé SQLite ✓');
    return true;
  } catch(e) {
    console.error('[FoodNote] sauvegarde aliment SQLite impossible', e);
    showSaveStatus('Erreur sauvegarde aliment : ' + (e && e.message ? e.message : e), true);
    return false;
  }
}

function foodAutosaveKey(a, fallbackIndex) {
  const name = normalizeSearchText(String(a?.nom || a?.name || '').trim());
  const meal = normalizeMealId(a?.meal || 'none');
  return name ? (name + '|' + meal) : ('__row_' + fallbackIndex + '_' + Date.now());
}

function recomputeEntryMacrosFromFoodsForAutosave(foods) {
  return (foods || []).reduce((acc, a) => {
    acc.kcal += Number(a.kcal || 0);
    acc.prot += Number(a.prot || 0);
    acc.gluc += Number(a.gluc || 0);
    acc.lip += Number(a.lip || 0);
    return acc;
  }, {kcal:0, prot:0, gluc:0, lip:0});
}

function mergeServerEntryWithFoodAutosave(serverEntry, incomingEntry) {
  const serverFoods = Array.isArray(serverEntry?.aliments) ? serverEntry.aliments : [];
  const incomingFoods = Array.isArray(incomingEntry?.aliments) ? incomingEntry.aliments : [];
  const foodMap = new Map();
  serverFoods.forEach((a, i) => foodMap.set(foodAutosaveKey(a, i), a));
  incomingFoods.forEach((a, i) => foodMap.set(foodAutosaveKey(a, i), a));
  const aliments = Array.from(foodMap.values());

  const serverSports = Array.isArray(serverEntry?.sports) ? serverEntry.sports : [];
  const incomingSports = Array.isArray(incomingEntry?.sports) ? incomingEntry.sports : [];
  const sports = incomingSports.length >= serverSports.length ? incomingSports : serverSports;
  const depSport = sports.reduce((s, r) => s + (Number(r.total || 0) || 0), 0);
  const macrosRaw = recomputeEntryMacrosFromFoodsForAutosave(aliments);
  const macros = {
    kcal: Math.round(macrosRaw.kcal),
    prot: round1(macrosRaw.prot),
    gluc: round1(macrosRaw.gluc),
    lip: round1(macrosRaw.lip),
  };

  const keepIncomingIfFilled = (incomingValue, serverValue) => {
    if (incomingValue === undefined || incomingValue === null) return serverValue;
    if (typeof incomingValue === 'string' && !incomingValue.trim()) return serverValue ?? incomingValue;
    return incomingValue;
  };

  return {
    ...(serverEntry || {}),
    ...(incomingEntry || {}),
    id: serverEntry?.id || incomingEntry?.id || Date.now(),
    date: incomingEntry?.date || serverEntry?.date,
    revision: Number(serverEntry?.revision ?? serverEntry?._revision ?? incomingEntry?.revision ?? incomingEntry?._revision ?? 0) || undefined,
    _revision: Number(serverEntry?._revision ?? serverEntry?.revision ?? incomingEntry?._revision ?? incomingEntry?.revision ?? 0) || undefined,
    updated_at: serverEntry?.updated_at || incomingEntry?.updated_at || null,
    poids: keepIncomingIfFilled(incomingEntry?.poids, serverEntry?.poids),
    energie: keepIncomingIfFilled(incomingEntry?.energie, serverEntry?.energie),
    faim: keepIncomingIfFilled(incomingEntry?.faim, serverEntry?.faim),
    notes: keepIncomingIfFilled(incomingEntry?.notes, serverEntry?.notes),
    extras: keepIncomingIfFilled(incomingEntry?.extras, serverEntry?.extras),
    aliments,
    sports,
    depSport,
    macros,
    netKcal: Math.round(macros.kcal - depSport),
    dailyChecklist: {
      ...((serverEntry && serverEntry.dailyChecklist) || {}),
      ...((incomingEntry && incomingEntry.dailyChecklist) || {}),
      ...(aliments.length ? {foodDone:true} : {}),
      ...(sports.length && depSport > 0 ? {sportDone:true} : {}),
    },
    dailyReview: (incomingEntry && incomingEntry.dailyReview) || (serverEntry && serverEntry.dailyReview) || {}
  };
}

async function saveEntry(silent = false) {
  const date = document.getElementById('f-date').value;
  if (!date) { if (!silent) alert('Indique la date.'); return; }
  let kcal=0,prot=0,gluc=0,lip=0;
  const alimList = [];
  if (typeof pruneInvalidSelectedFoodRows === 'function') pruneInvalidSelectedFoodRows();
  selected.forEach(i => {
    const a=allAliments[i]; if(!a || isFoodRuntimeDeleted(a) || isFoodLineDeleted(a)) return;
    const m=getMacros(a,quantities[i]||0);
    kcal+=Number(m.kcal||0);prot+=Number(m.prot||0);gluc+=Number(m.gluc||0);lip+=Number(m.lip||0);
    alimList.push({nom:a.nom, entryFoodId:a.entryFoodId||a.entry_food_id||null, entry_food_id:a.entry_food_id||a.entryFoodId||null, line_uid:a.line_uid||a.lineUid||null, qty:quantities[i], unite:'g', poidsUnite:null, uniteLabel:'', meal:a.meal || 'none', kcal:Math.round(m.kcal||0), prot:round1(m.prot||0), gluc:round1(m.gluc||0), lip:round1(m.lip||0)});
  });
  const existing = getEntries().find(e=>e.date===date);
  // 0.21.19.3 — Correction ordre de calcul : existing doit être résolu AVANT
  // la préservation du sport existant, sinon saveEntry peut planter et la ligne
  // aliment ajoutée (ex. tomate au dîner) reste seulement en mémoire locale.
  // Ne plus envoyer de ligne sport vide depuis la sauvegarde générale.
  // Les suppressions/ajouts sport explicites passent par saveSportOnlyNow(__replaceSports).
  let sportList = (typeof buildCurrentSportPayload === 'function') ? buildCurrentSportPayload() : sportRows.map(r => {
    const h = parseFloat(document.getElementById('sh-'+r)?.value)||0;
    const k = parseFloat(document.getElementById('sk-'+r)?.value)||0;
    return {
      nom: document.getElementById('ss-'+r)?.options[document.getElementById('ss-'+r)?.selectedIndex]?.text?.split(' (')[0] || '',
      heures: h,
      kcalH: k,
      total: Math.round(h*k)
    };
  }).filter(r => Number(r.heures || 0) > 0 && Number(r.kcalH || 0) > 0);
  const existingSportList = Array.isArray(existing?.sports) ? existing.sports : [];
  if (!sportList.length && existingSportList.length) sportList = existingSportList;
  const depSport = sportList.length
    ? sportList.reduce((s,r)=>s+(Number(r.total || 0) || Math.round((Number(r.heures || r.hours || 0)||0)*(Number(r.kcalH || r.kcal_h || 0)||0))),0)
    : (Number(existing?.depSport ?? existing?.dep_sport ?? 0) || 0);
  foodnoteWarnDailyNutritionIfNeeded(kcal);
  const existingChecklist = (existing && existing.dailyChecklist && typeof existing.dailyChecklist === 'object') ? existing.dailyChecklist : {};
  const existingReview = (existing && existing.dailyReview && typeof existing.dailyReview === 'object') ? existing.dailyReview : {};
  const poidsValue = document.getElementById('f-poids').value;
  const energieValue = document.getElementById('f-energie').value;
  const faimValue = document.getElementById('f-faim').value;
  const notesValue = document.getElementById('f-notes').value;
  const extrasValue = document.getElementById('f-extras').value;
  const entry = {
    id: existing?.id || Date.now(), date,
    revision: Number(existing?.revision ?? existing?._revision ?? 0) || undefined,
    _revision: Number(existing?._revision ?? existing?.revision ?? 0) || undefined,
    updated_at: existing?.updated_at || null,
    poids: poidsValue,
    sports: sportList, depSport,
    aliments: alimList, extras: extrasValue,
    energie: energieValue,
    faim: faimValue,
    notes: notesValue,
    macros:{kcal:Math.round(kcal),prot:Math.round(prot),gluc:Math.round(gluc),lip:Math.round(lip)},
    netKcal: Math.round(kcal - depSport),
    dailyChecklist: {
      ...existingChecklist,
      ...(String(poidsValue || '').trim() ? {weightDone:true} : {}),
      ...(alimList.length ? {foodDone:true} : {}),
      ...(sportList.length && depSport > 0 ? {sportDone:true} : {}),
      ...((String(energieValue || '').trim() || String(faimValue || '').trim()) ? {feelingDone:true} : {}),
      ...((String(notesValue || '').trim() || String(extrasValue || '').trim()) ? {noteDone:true} : {})
    },
    dailyReview: existingReview
  };

  const updateLocal = (savedEntry) => {
    const entries = getEntries();
    const idx = entries.findIndex(e=>e.date===savedEntry.date || e.id===savedEntry.id);
    if (idx>=0) entries[idx]=savedEntry; else entries.unshift(savedEntry);
    _db.journal_entries = sortEntriesDesc(entries);
    saveLocalOnly();
  };

  try {
    if (!silent) showSaveStatus('Envoi SQLite…');
    if (window.FOODNOTE_DEBUG_SYNC) console.debug('[FoodNote] saveEntry → /api/entries', entry.date, entry);
    if (typeof postEntryNative !== 'function') throw new Error('postEntryNative indisponible');
    const saved = await postEntryNative(entry);
    if (window.FOODNOTE_DEBUG_SYNC) console.debug('[FoodNote] saveEntry OK SQLite', saved);
    updateLocal(saved);
    foodnoteRefreshJournalMutationViews('entry-save', { notification:true, dashboard:true });
    if (!silent) showSaveStatus('Journée enregistrée SQLite ✓');
  } catch(e) {
    if (!silent || !(e && (e.status === 409 || e.code === 'ENTRY_OVERWRITE_GUARD' || e.code === 'ENTRY_VERSION_CONFLICT' || e.code === 'ENTRY_SUMMARY_OVERWRITE_GUARD'))) console.error('[FoodNote] saveEntry erreur SQLite', e);

    if (e && (e.status === 409 || e.code === 'ENTRY_OVERWRITE_GUARD' || e.code === 'ENTRY_VERSION_CONFLICT' || e.code === 'ENTRY_SUMMARY_OVERWRITE_GUARD')) {
      const existing = e.data && e.data.existing ? e.data.existing : null;
      const incoming = e.data && e.data.incoming ? e.data.incoming : null;

      if (e.code === 'ENTRY_SUMMARY_OVERWRITE_GUARD') {
        try {
          if (typeof loadEntriesNative === 'function') await loadEntriesNative();
          if (typeof loadEntry === 'function') loadEntry(date);
        } catch(reloadErr) {
          console.error('[FoodNote] rechargement après résumé bloqué impossible', reloadErr);
        }
        showSaveStatus('Sauvegarde bloquée : détails serveur rechargés', true);
        return;
      }

      if (silent) {
        const recentFoodWrite = isRecentFoodUiWriteForImmediateSave();
        const noFoodDeletion = !existing || !incoming || (Number(incoming.foodCount || 0) >= Number(existing.foodCount || 0));
        const noSportDeletion = !existing || !incoming || (Number(incoming.sportCount || 0) >= Number(existing.sportCount || 0));

        if (recentFoodWrite) {
          try {
            let serverEntry = getEntries().find(x => x && x.date === date) || null;
            if (typeof loadEntriesNative === 'function') {
              await loadEntriesNative();
              serverEntry = getEntries().find(x => x && x.date === date) || serverEntry;
            }

            const mergedEntry = serverEntry ? mergeServerEntryWithFoodAutosave(serverEntry, entry) : entry;
            const stillNoDeletion = !serverEntry || (
              (Array.isArray(mergedEntry.aliments) ? mergedEntry.aliments.length : 0) >= (Array.isArray(serverEntry.aliments) ? serverEntry.aliments.length : 0) &&
              (Array.isArray(mergedEntry.sports) ? mergedEntry.sports.length : 0) >= (Array.isArray(serverEntry.sports) ? serverEntry.sports.length : 0)
            );

            if ((noFoodDeletion && noSportDeletion) || stillNoDeletion) {
              if (window.FOODNOTE_DEBUG_SYNC) console.debug('[FoodNote] autosave conflit résolu automatiquement après ajout aliment', e.data || e);
              const forced = await postEntryNative(mergedEntry, {force:true});
              updateLocal(forced);
              foodnoteRefreshJournalMutationViews('entry-autosave-force', { notification:true, dashboard:true });
              showSaveStatus('Ajout sauvegardé SQLite ✓');
              return;
            }
          } catch(autoForceErr) {
            console.error('[FoodNote] autosave ajout : remplacement sûr impossible', autoForceErr);
          }
        }

        if (window.FOODNOTE_DEBUG_SYNC) console.debug('[FoodNote] autosave bloqué pour éviter un écrasement accidentel', e.data || e);
        showSaveStatus('Sauvegarde auto bloquée : journée existante à recharger', true);
        return;
      }

      const msg = [
        e.code === 'ENTRY_VERSION_CONFLICT' ? 'Cette journée a été modifiée sur un autre appareil.' : 'Une journée existe déjà pour cette date.',
        '',
        existing ? `Existant : ${existing.foodCount || 0} aliment(s), ${existing.sportCount || 0} sport(s), ${Math.round(existing.kcal || 0)} kcal.` : '',
        incoming ? `À enregistrer : ${incoming.foodCount || 0} aliment(s), ${incoming.sportCount || 0} sport(s), ${Math.round(incoming.kcal || 0)} kcal.` : '',
        '',
        e.code === 'ENTRY_VERSION_CONFLICT' ? 'OK = forcer le remplacement malgré le conflit.' : 'OK = remplacer volontairement la journée existante.',
        'Annuler = ne pas écraser et recharger les données serveur.'
      ].filter(Boolean).join('\n');

      if (confirm(msg)) {
        try {
          showSaveStatus('Remplacement confirmé…');
          const forced = await postEntryNative(entry, {force:true});
          updateLocal(forced);
          foodnoteRefreshJournalMutationViews('entry-conflict-force', { notification:true, dashboard:true });
          showSaveStatus('Journée remplacée SQLite ✓');
        } catch(forceErr) {
          console.error('[FoodNote] remplacement forcé impossible', forceErr);
          showSaveStatus('Erreur remplacement : ' + (forceErr && forceErr.message ? forceErr.message : forceErr), true);
        }
      } else {
        try {
          if (typeof loadEntriesNative === 'function') await loadEntriesNative();
          if (typeof loadEntry === 'function') loadEntry(date);
          showSaveStatus('Journée existante rechargée ✓');
        } catch(reloadErr) {
          console.error('[FoodNote] rechargement journée impossible', reloadErr);
          showSaveStatus('Recharge impossible : ' + (reloadErr && reloadErr.message ? reloadErr.message : reloadErr), true);
        }
      }
      return;
    }

    updateLocal(entry);
    foodnoteRefreshJournalMutationViews('entry-save-fallback-local', { notification:true, dashboard:true });
    try {
      saveLocalOnly();
    } catch(localErr) {
      console.error('[FoodNote] sauvegarde locale impossible', localErr);
    }
    if (!silent) showSaveStatus('Erreur SQLite : ' + (e && e.message ? e.message : e), true);
  }
}

function resetForm() {
  selected.clear();
  allAliments.forEach((a,i)=>{
    quantities[i]=a.defaut;
    const row=document.getElementById('row-'+i); const qi=document.getElementById('qty-'+i);
    if(row){if(a.fixe){selected.add(i);row.classList.add('selected');}else row.classList.remove('selected');}
    if(qi) qi.value=a.defaut;
    updatePill(i);
    updateUnitHint(i);
  });
  sportRows.forEach(r => document.getElementById('sport-row-'+r)?.remove());
  sportRows = [];
  ['f-poids','f-extras','f-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const energieEl = document.getElementById('f-energie'); if (energieEl) energieEl.value = '';
  const faimEl = document.getElementById('f-faim'); if (faimEl) faimEl.value = '';
  updateMacros();
}

// v10.53 — Scanner code-barres local OpenFoodFacts avec fallback Html5Qrcode
let barcodeStream = null;
let barcodeDetector = null;
let barcodeScanActive = false;
let barcodeLastValue = '';
let barcodeLastAt = 0;
let barcodeLastProduct = null;
try {
  if (!window.FoodNoteBarcodeFlowState) {
    Object.defineProperty(window, 'FoodNoteBarcodeLastProduct', {
      configurable: true,
      get: () => barcodeLastProduct,
      set: (value) => { barcodeLastProduct = value; }
    });
    window.FoodNoteBarcodeFlowState = {
      get lastProduct() { return barcodeLastProduct; },
      set lastProduct(value) { barcodeLastProduct = value; },
      clear() { barcodeLastProduct = null; }
    };
  }
} catch(e) {}
let html5BarcodeScanner = null;
let html5BarcodeRunning = false;
let barcodePanelOriginalParent = null;
let barcodePanelOriginalNext = null;

function setBarcodeStatus(msg, warn = false) {
  const el = document.getElementById('barcode-status');
  if (!el) return;
  el.innerHTML = msg;
  el.style.color = warn ? 'var(--orange)' : 'var(--text3)';
}

async function toggleBarcodeScanner() {
  const panel = document.getElementById('barcode-scan-panel');
  const btn = document.getElementById('barcode-inline-btn');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  if (open) {
    closeBarcodeScannerPanel();
    return;
  }

  // v10.58 : on sort le panneau du flux de la carte avant affichage.
  // Certains WebView/parents avec scroll/transforms gardent sinon la caméra en bas de page
  // même si le fond modal est bien centré. Une fois dans <body>, le fixed est réel viewport.
  if (panel.parentElement !== document.body) {
    barcodePanelOriginalParent = panel.parentElement;
    barcodePanelOriginalNext = panel.nextSibling;
    document.body.appendChild(panel);
  }

  panel.style.display = 'flex';
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('role', 'dialog');
  document.body.classList.add('barcode-modal-open');
  if (btn) btn.classList.add('active');
  const result = document.getElementById('barcode-result');
  if (result) { result.style.display = 'none'; result.innerHTML = ''; }
  setBarcodeStatus('📷 Ouverture de la caméra…');
  await startBarcodeScanner();
}

function closeBarcodeScannerPanel() {
  stopBarcodeScanner();
  const panel = document.getElementById('barcode-scan-panel');
  const btn = document.getElementById('barcode-inline-btn');
  if (panel) {
    panel.style.display = 'none';
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('role');
  }
  document.body.classList.remove('barcode-modal-open');
  if (btn) btn.classList.remove('active');
}

async function startBarcodeScanner() {
  const video = document.getElementById('barcode-video');
  const wrap = document.getElementById('barcode-camera-wrap');
  const stopBtn = document.getElementById('barcode-stop-btn');
  if (!video || !wrap) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setBarcodeStatus('⚠️ Caméra indisponible. Vérifie HTTPS et la permission caméra Android/WebView.', true);
    return;
  }

  // Méthode 1 : API native Chrome/Edge récents
  if ('BarcodeDetector' in window) {
    try {
      barcodeDetector = new BarcodeDetector({ formats: ['qr_code','ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'] });
      barcodeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = barcodeStream;
      await video.play();
      barcodeScanActive = true;
      barcodeLastValue = '';
      wrap.style.display = 'block';
      video.style.display = '';
      const reader = document.getElementById('barcode-html5-reader');
      if (reader) reader.style.display = 'none';
      if (stopBtn) stopBtn.style.display = '';
      setBarcodeStatus('📷 Caméra active. Place le code-barres dans le cadre.');
      requestAnimationFrame(scanBarcodeFrame);
      return;
    } catch (e) {
      console.warn('Scanner natif indisponible, tentative fallback Html5Qrcode:', e);
      stopBarcodeScanner();
    }
  }

  // Méthode 2 : fallback JS plus compatible Android/WebView via html5-qrcode
  if (window.Html5Qrcode) {
    try {
      await startHtml5BarcodeScanner();
      return;
    } catch (e) {
      console.warn('Fallback Html5Qrcode indisponible:', e);
      stopBarcodeScanner();
      setBarcodeStatus('⚠️ Impossible de démarrer le scanner. Vérifie HTTPS, les permissions caméra de l’APK/WebView, ou essaie Chrome Android.', true);
      return;
    }
  }

  setBarcodeStatus('⚠️ Scanner caméra non disponible : API native absente et fallback html5-qrcode non chargé.', true);
}

async function startHtml5BarcodeScanner() {
  const wrap = document.getElementById('barcode-camera-wrap');
  const video = document.getElementById('barcode-video');
  const reader = document.getElementById('barcode-html5-reader');
  const stopBtn = document.getElementById('barcode-stop-btn');
  if (!wrap || !reader) throw new Error('Bloc scanner introuvable');

  wrap.style.display = 'block';
  if (video) video.style.display = 'none';
  reader.style.display = 'block';
  reader.innerHTML = '';

  const formats = [];
  try {
    const F = window.Html5QrcodeSupportedFormats || {};
    ['QR_CODE','EAN_13','EAN_8','UPC_A','UPC_E','CODE_128','CODE_39','ITF'].forEach(k => { if (F[k] !== undefined) formats.push(F[k]); });
  } catch (_) {}

  html5BarcodeScanner = new Html5Qrcode('barcode-html5-reader', formats.length ? { formatsToSupport: formats, verbose: false } : { verbose: false });
  html5BarcodeRunning = true;
  barcodeLastValue = '';
  if (stopBtn) stopBtn.style.display = '';
  setBarcodeStatus('📷 Scanner fallback actif. Autorise la caméra puis vise le code-barres.');

  await html5BarcodeScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: function(w, h) { const size = Math.floor(Math.min(w * 0.9, h * 0.45)); return { width: Math.max(240, size), height: Math.max(120, Math.floor(size * 0.45)) }; }, aspectRatio: 1.777 },
    async (decodedText) => {
      const raw = cleanBarcodeCode(decodedText || '');
      const now = Date.now();
      if (raw && (raw !== barcodeLastValue || now - barcodeLastAt > 2500)) {
        barcodeLastValue = raw;
        barcodeLastAt = now;
        await lookupBarcode(raw, true);
      }
    },
    () => {}
  );
}


function getActiveScannerVideoForOCR() {
  const nativeVideo = document.getElementById('barcode-video');
  if (nativeVideo && nativeVideo.videoWidth > 0 && nativeVideo.readyState >= 2 && nativeVideo.style.display !== 'none') return nativeVideo;
  const html5Video = document.querySelector('#barcode-html5-reader video');
  if (html5Video && html5Video.videoWidth > 0 && html5Video.readyState >= 2) return html5Video;
  return null;
}


// v10.96 — capture OCR uniquement dans le cadre visible (le scan code-barres garde la frame complète)
function getVisibleOCRFrameElement(video, preferredSelector) {
  const selectors = [preferredSelector, '#barcode-scan-panel .barcode-frame', '#ocr-camera-box .ocr-frame'].filter(Boolean);
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    if (r.width > 20 && r.height > 20 && st.display !== 'none' && st.visibility !== 'hidden') return el;
  }
  return null;
}

function computeVideoSourceCrop(video, frameEl) {
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  const vr = video.getBoundingClientRect();
  if (!vw || !vh || !vr.width || !vr.height) return { sx:0, sy:0, sw:vw, sh:vh, usedFrame:false };

  let fr = frameEl ? frameEl.getBoundingClientRect() : null;
  if (!fr || fr.width < 20 || fr.height < 20) {
    // fallback : zone centrale proche du cadre affiché (environ 56% de la largeur/hauteur)
    const fw = vr.width * 0.56;
    const fh = vr.height * 0.56;
    fr = { left: vr.left + (vr.width - fw) / 2, top: vr.top + (vr.height - fh) / 2, width: fw, height: fh, right: vr.left + (vr.width + fw) / 2, bottom: vr.top + (vr.height + fh) / 2 };
  }

  const fit = (window.getComputedStyle(video).objectFit || 'cover').toLowerCase();
  const videoRatio = vw / vh;
  const boxRatio = vr.width / vr.height;
  let drawW, drawH;
  if (fit === 'contain') {
    if (videoRatio > boxRatio) { drawW = vr.width; drawH = vr.width / videoRatio; }
    else { drawH = vr.height; drawW = vr.height * videoRatio; }
  } else {
    // cover par défaut : c'est ce qui est utilisé par la caméra FoodNote
    if (videoRatio > boxRatio) { drawH = vr.height; drawW = vr.height * videoRatio; }
    else { drawW = vr.width; drawH = vr.width / videoRatio; }
  }
  const contentLeft = vr.left + (vr.width - drawW) / 2;
  const contentTop = vr.top + (vr.height - drawH) / 2;

  const cropLeft = Math.max(fr.left, vr.left);
  const cropTop = Math.max(fr.top, vr.top);
  const cropRight = Math.min(fr.right, vr.right);
  const cropBottom = Math.min(fr.bottom, vr.bottom);

  let sx = Math.round((cropLeft - contentLeft) / drawW * vw);
  let sy = Math.round((cropTop - contentTop) / drawH * vh);
  let sw = Math.round((cropRight - cropLeft) / drawW * vw);
  let sh = Math.round((cropBottom - cropTop) / drawH * vh);

  sx = Math.max(0, Math.min(vw - 1, sx));
  sy = Math.max(0, Math.min(vh - 1, sy));
  sw = Math.max(1, Math.min(vw - sx, sw));
  sh = Math.max(1, Math.min(vh - sy, sh));
  return { sx, sy, sw, sh, usedFrame:true };
}

function drawOCRFrameToCanvas(video, canvas, preferredFrameSelector) {
  const frameEl = getVisibleOCRFrameElement(video, preferredFrameSelector);
  const crop = computeVideoSourceCrop(video, frameEl);
  // v10.97 — compromis lisibilité/vitesse : le cadre fait foi,
  // mais il est ré-échantillonné vers une largeur utile OCR.
  // 600px était rapide mais trop imprécis ; 1500px donne à Tesseract
  // assez de pixels sans revenir à la frame complète.
  const targetW = 1900;
  const maxW = 2200;
  const nativeW = Math.max(1, crop.sw);
  const outW = Math.round(Math.min(maxW, Math.max(targetW, nativeW)));
  const scale = outW / nativeW;
  const outH = Math.max(1, Math.round(crop.sh * scale));
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
  return { ...crop, outW: canvas.width, outH: canvas.height, scale: Math.round(scale * 100) / 100 };
}

async function captureNutritionFromBarcodeCamera() {
  const btn = document.getElementById('barcode-ocr-btn');
  const video = getActiveScannerVideoForOCR();
  const canvas = document.getElementById('ocr-canvas');
  if (!canvas) {
    setBarcodeStatus('⚠️ Module OCR introuvable.', true);
    return;
  }
  if (!video) {
    setBarcodeStatus('⚠️ Image caméra pas encore prête. Attends 1 seconde puis réessaie.', true);
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; btn.setAttribute('aria-label', 'Préparation du recadrage'); }
    const frameInfo = drawNutritionFullFrameToCanvas(video, canvas);
    const dataUrl = canvas.toDataURL('image/png');
    setBarcodeStatus(`📷 Photo prête (${frameInfo.outW}×${frameInfo.outH}). Ouverture du recadrage…`);
    closeBarcodeScannerPanel();
    showNutritionLabelCropPreview(dataUrl, { source:'camera', crop:frameInfo });
  } catch (e) {
    setBarcodeStatus('⚠️ Erreur préparation OCR : ' + (e.message || e), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Lire tableau'; btn.setAttribute('aria-label', 'Lire le tableau nutritionnel'); }
  }
}

function stopBarcodeScanner() {
  barcodeScanActive = false;
  if (html5BarcodeScanner && html5BarcodeRunning) {
    try {
      const inst = html5BarcodeScanner;
      html5BarcodeRunning = false;
      inst.stop().then(() => inst.clear()).catch(() => {});
    } catch (_) {}
  }
  html5BarcodeScanner = null;
  html5BarcodeRunning = false;
  const reader = document.getElementById('barcode-html5-reader');
  if (reader) { reader.style.display = 'none'; reader.innerHTML = ''; }
  if (barcodeStream) {
    barcodeStream.getTracks().forEach(t => t.stop());
    barcodeStream = null;
  }
  const video = document.getElementById('barcode-video');
  if (video) { video.srcObject = null; video.style.display = ''; }
  const wrap = document.getElementById('barcode-camera-wrap');
  if (wrap) wrap.style.display = 'none';
  const stopBtn = document.getElementById('barcode-stop-btn');
  if (stopBtn) stopBtn.style.display = 'none';
}

async function scanBarcodeFrame() {
  if (!barcodeScanActive || !barcodeDetector) return;
  const video = document.getElementById('barcode-video');
  if (!video || video.readyState < 2) {
    requestAnimationFrame(scanBarcodeFrame);
    return;
  }
  try {
    const codes = await barcodeDetector.detect(video);
    if (codes && codes.length) {
      const raw = String(codes[0].rawValue || '').trim();
      const now = Date.now();
      if (raw && (raw !== barcodeLastValue || now - barcodeLastAt > 2500)) {
        barcodeLastValue = raw;
        barcodeLastAt = now;
        await lookupBarcode(raw, true);
      }
    }
  } catch (e) {
    console.warn('Erreur détection code-barres:', e);
  }
  if (barcodeScanActive) setTimeout(() => requestAnimationFrame(scanBarcodeFrame), 220);
}

function cleanBarcodeCode(code) {
  return String(code || '').replace(/[^0-9A-Za-z]/g, '').trim();
}

function searchBarcodeManual() {
  // v10.56 : la saisie manuelle du code-barres a été retirée de l’UI.
  // Fonction conservée seulement pour éviter une erreur si un ancien cache navigateur l’appelle encore.
  setBarcodeStatus('Utilise l’icône caméra pour scanner le code-barres.', true);
}

function normalizeOFFBarcodeProduct(p, code) {
  p = p || {};
  return withUnitDefaults({
    code: p.code || code || '',
    nom: p.nom || p.product_name_fr || p.product_name || 'Produit OpenFoodFacts',
    meta: p.marque || p.brands || '',
    marque: p.marque || p.brands || '',
    kcal100: Math.round(Number(p.kcal100 ?? p.kcal_100g ?? p.energy_kcal_100g ?? 0) || 0),
    prot100: round1(Number(p.prot100 ?? p.proteins_100g ?? 0) || 0),
    gluc100: round1(Number(p.gluc100 ?? p.carbohydrates_100g ?? 0) || 0),
    lip100: round1(Number(p.lip100 ?? p.fat_100g ?? 0) || 0),
    source: 'off',
    external: true,
    unite: 'g'
  });
}

async function lookupBarcode(code, fromCamera = false) {
  const clean = cleanBarcodeCode(code);
  if (!clean) return;
  setBarcodeStatus('🔎 Recherche locale OpenFoodFacts : ' + escapeHtml(clean) + '...');
  const result = document.getElementById('barcode-result');
  if (result) { result.style.display = 'none'; result.innerHTML = ''; }
  try {
    const r = await fetch('/api/off/barcode/' + encodeURIComponent(clean), { cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    if (!data.found || !data.product) {
      barcodeLastProduct = null;
      renderBarcodeNotFound(clean, data.error || 'Produit absent de la base OpenFoodFacts locale.');
      if (fromCamera) stopBarcodeScanner();
      return;
    }
    barcodeLastProduct = normalizeOFFBarcodeProduct(data.product, clean);
    selectBarcodeProductInSearch(false);
    renderBarcodeProduct(barcodeLastProduct, data.source || 'local');
    setBarcodeStatus('✅ Produit trouvé en local. Vérifie la quantité puis clique sur Ajouter.');
    if (fromCamera) stopBarcodeScanner();
  } catch (e) {
    console.warn('Recherche code-barres impossible:', e);
    barcodeLastProduct = null;
    renderBarcodeNotFound(clean, 'Recherche locale impossible : ' + (e.message || e));
    setBarcodeStatus('⚠️ Recherche code-barres impossible.', true);
    if (fromCamera) stopBarcodeScanner();
  }
}

function renderBarcodeNotFound(code, msg) {
  const box = document.getElementById('barcode-result');
  if (!box) return;
  box.innerHTML = `
    <div class="barcode-result-top">
      <div>
        <div class="barcode-result-name">Produit non trouvé localement</div>
        <div class="barcode-result-meta">Code : ${escapeHtml(code)}</div>
      </div>
      ${sourceBadgeHTML ? sourceBadgeHTML('off') : ''}
    </div>
    <div class="barcode-status" style="margin-top:8px">${escapeHtml(msg)}</div>
    <div class="barcode-result-actions">
      <button type="button" data-food-add-action="barcode-search-code" data-barcode-code="${escapeHtml(code).replace(/\"/g, '&quot;')}">Rechercher par texte/code</button>
    </div>`;
  box.style.display = 'block';
}

function renderBarcodeProduct(food, source) {
  const box = document.getElementById('barcode-result');
  if (!box) return;
  const meta = food.meta || food.marque || '';
  box.innerHTML = `
    <div class="barcode-result-top">
      <div>
        <div class="barcode-result-name">${escapeHtml(food.nom)}</div>
        <div class="barcode-result-meta">${meta ? escapeHtml(meta) + ' · ' : ''}Code : ${escapeHtml(food.code || '')}</div>
      </div>
      ${sourceBadgeHTML ? sourceBadgeHTML('off') : '<span>OpenFoodFacts</span>'}
    </div>
    <div class="barcode-result-macros">
      <span>🔥 ${Math.round(Number(food.kcal100)||0)} kcal / 100g</span>
      <span>🍖 ${round1(food.prot100)}g prot</span>
      <span>🍞 ${round1(food.gluc100)}g gluc</span>
      <span>🥑 ${round1(food.lip100)}g lip</span>
    </div>
    <div class="barcode-result-actions">
      <button type="button" class="btn-primary" data-food-add-action="barcode-fill-search">Remplir le champ</button>
      <button type="button" data-food-add-action="barcode-save-product">Ajouter à mes aliments</button>
    </div>`;
  box.style.display = 'block';
}

function barcodeFoodForSave(food) {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.barcodeFoodForSave === 'function') {
    return window.FoodNoteFoodAddDomain.barcodeFoodForSave(food || barcodeLastProduct);
  }
  return {
    nom: food.nom,
    kcal100: Number(food.kcal100) || 0,
    prot100: Number(food.prot100) || 0,
    gluc100: Number(food.gluc100) || 0,
    lip100: Number(food.lip100) || 0,
    unite: food.unite || 'g',
    poidsUnite: saneUnitWeightForFood(food) || null,
    uniteLabel: food.uniteLabel || '',
    source: 'off',
    code: food.code || '',
    barcode: food.code || ''
  };
}

function saveBarcodeProductToBDD() {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.saveBarcodeProduct === 'function') {
    return window.FoodNoteFoodAddDomain.saveBarcodeProduct();
  }
  if (!barcodeLastProduct) return;
  if (!foodnoteValidateFoodBeforeSave(barcodeLastProduct, {title:'OpenFoodFacts : valeur nutritionnelle suspecte'})) return;
  const bdd = getBDD();
  const key = normalizeSearchText(barcodeLastProduct.nom);
  const code = String(barcodeLastProduct.code || '');
  const exists = bdd.find(b => (code && String(b.code || b.barcode || '') === code) || normalizeSearchText(b.nom) === key);
  if (exists) {
    setBarcodeStatus('ℹ️ Produit déjà présent dans Mes aliments.');
    return exists.id;
  }
  const id = Date.now();
  bdd.unshift({ id, ...barcodeFoodForSave(barcodeLastProduct) });
  saveBDD(bdd);
  refreshDBSelect && refreshDBSelect();
  setBarcodeStatus('✅ Produit ajouté à Mes aliments.');
  return id;
}

function addBarcodeProductToDay() {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.addBarcodeProductToDay === 'function') {
    return window.FoodNoteFoodAddDomain.addBarcodeProductToDay();
  }
  if (!barcodeLastProduct) return;
  let bddId = saveBarcodeProductToBDD();
  const qty = parseFloat(document.getElementById('db-qty')?.value) || 100;
  addCustomAliment({
    ...barcodeFoodForSave(barcodeLastProduct),
    defaut: qty,
    bddId,
    meal: 'none'
  });
  setBarcodeStatus('✅ Produit ajouté à la journée.');
  if (typeof closeFoodAddModal === 'function') setTimeout(closeFoodAddModal, 220);
}

function selectBarcodeProductInSearch(showStatus = true) {
  if (!barcodeLastProduct) return;
  const input = document.getElementById('db-search');
  const hidden = document.getElementById('db-selected-id');
  dbSelectedFood = withUnitDefaults({ ...barcodeLastProduct, external:true, source:'off' });
  if (input) input.value = barcodeLastProduct.nom;
  if (hidden) hidden.value = '';
  updateDBSelectedCard && updateDBSelectedCard(dbSelectedFood);
  clearDBSuggestionsKeepVisibleFlag();
  document.getElementById('db-suggestions')?.classList.remove('visible'); setFoodAddExpanded(false);
  if (showStatus) setBarcodeStatus('Produit prêt dans le champ unique. Vérifie la quantité puis clique sur Ajouter.');
}

window.addEventListener('pagehide', () => { stopBarcodeScanner(); stopNutritionOCRCamera && stopNutritionOCRCamera(false); });


// v10.83 — OCR caméra directe tableau nutritionnel
let ocrCameraStream = null;
let ocrAutoEnabled = false;
let ocrAutoBusy = false;
let ocrAutoLoopId = 0;
let ocrAutoStableSince = 0;
let ocrAutoLastScore = null;
let ocrAutoLastShotAt = 0;
let ocrBarcodeDetector = null;
let ocrBarcodeScanActive = false;
let ocrBarcodeLoopId = 0;
let foodRecipeOCRMode = false;
let foodRecipeOCRCaptureSerial = 0;
let foodRecipeCropPhotoDataUrl = '';
let foodRecipeCropReady = false;
let foodRecipeCropState = { x: 10, y: 12, w: 80, h: 62 };
let foodRecipeCropPointerCleanup = null;
let foodCropMode = 'recipe'; // 'recipe' ou 'nutrition_label' : le recadrage est commun, le traitement reste séparé.
let foodNutritionCropLastSource = 'camera';
try { window.FoodNoteCropMode = foodCropMode; } catch(e) {}

async function startNutritionOCRCamera() {
  const box = document.getElementById('ocr-camera-box');
  const video = document.getElementById('ocr-video');
  const resultBox = document.getElementById('ocr-result');
  if (!box || !video) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setOCRStatus('Caméra indisponible. Vérifie HTTPS et la permission caméra Android/WebView.', true);
    return;
  }
  try {
    stopNutritionOCRCamera(false);
    if (resultBox) resultBox.style.display = 'none';
    setOCRStatus(foodRecipeOCRMode ? 'Caméra active : cadre la liste d’ingrédients puis touche “📸 Prendre la photo”.' : 'Caméra active : scan code-barres/QR automatique. OCR tableau seulement avec déclencheur.', false);
    syncOCRPanelMode && syncOCRPanelMode();
    ocrCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = ocrCameraStream;
    await video.play();
    box.style.display = 'block';
    setFoodAddExpanded(true);
    syncNutritionOCRAutoButton();
    startOCRBarcodeAutoLoop();
    if (ocrAutoEnabled) startNutritionOCRAutoLoop();
  } catch (e) {
    setOCRStatus('Impossible d’ouvrir la caméra : ' + (e.message || e), true);
  }
}

function stopNutritionOCRCamera(updateStatus = true) {
  stopNutritionOCRAutoLoop(false);
  stopOCRBarcodeAutoLoop();
  if (ocrCameraStream) {
    try { ocrCameraStream.getTracks().forEach(t => t.stop()); } catch(e) {}
  }
  ocrCameraStream = null;
  const video = document.getElementById('ocr-video');
  if (video) video.srcObject = null;
  const box = document.getElementById('ocr-camera-box');
  if (box) box.style.display = 'none';
  if (updateStatus) setOCRStatus('Caméra fermée.', false);
}


function stopOCRBarcodeAutoLoop() {
  ocrBarcodeScanActive = false;
  ocrBarcodeLoopId++;
}

async function startOCRBarcodeAutoLoop() {
  const video = document.getElementById('ocr-video');
  if (!video || !video.srcObject) return;
  stopOCRBarcodeAutoLoop();
  if (!('BarcodeDetector' in window)) {
    setOCRStatus('Caméra active. Scan code-barres/QR automatique indisponible ici, OCR possible avec déclencheur.', false);
    return;
  }
  try {
    ocrBarcodeDetector = new BarcodeDetector({ formats: ['qr_code','ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'] });
  } catch(e) {
    setOCRStatus('Caméra active. BarcodeDetector indisponible, OCR possible avec déclencheur.', false);
    return;
  }
  ocrBarcodeScanActive = true;
  const loopId = ++ocrBarcodeLoopId;
  const tick = async () => {
    if (loopId !== ocrBarcodeLoopId || !ocrBarcodeScanActive || !video.srcObject) return;
    if (video.readyState >= 2) {
      try {
        const codes = await ocrBarcodeDetector.detect(video);
        if (codes && codes.length) {
          const raw = String(codes[0].rawValue || '').trim();
          const now = Date.now();
          if (raw && (raw !== barcodeLastValue || now - barcodeLastAt > 2500)) {
            barcodeLastValue = raw;
            barcodeLastAt = now;
            setOCRStatus('Code détecté : recherche OpenFoodFacts locale…', false);
            await lookupBarcode(raw, false);
          }
        }
      } catch(e) {}
    }
    setTimeout(() => requestAnimationFrame(tick), 220);
  };
  requestAnimationFrame(tick);
}

async function captureNutritionOCRFrame(fromAuto = false) {
  if (foodRecipeOCRMode) return captureRecipeOCRFrame(fromAuto);
  if (ocrAutoBusy) return;
  ocrAutoBusy = true;
  const video = document.getElementById('ocr-video');
  const canvas = document.getElementById('ocr-canvas');
  const resultBox = document.getElementById('ocr-result');
  if (!video || !canvas || !video.videoWidth) {
    ocrAutoBusy = false;
    setOCRStatus('Image caméra pas encore prête.', true);
    return;
  }
  try {
    const cropInfo = drawOCRFrameToCanvas(video, canvas, '#ocr-camera-box .ocr-frame');
    const dataUrl = canvas.toDataURL('image/png');
    if (fromAuto) stopNutritionOCRAutoLoop(false);
    setOCRStatus((fromAuto ? 'Image stable détectée. ' : '') + `Lecture OCR qualité équilibrée du cadre (${cropInfo.outW}×${cropInfo.outH})…`, false);
    const resp = await fetch('/api/ocr/nutrition-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, filename: 'camera-nutrition.png', mode: 'balanced_plus', crop: cropInfo })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || 'OCR impossible');
    fillOCRForm(data.parsed || {}, data.raw_text || '');
    setOCRStatus('Valeurs détectées. Vérifie avant sauvegarde.', false);
    if (resultBox) resultBox.style.display = 'block';
    stopNutritionOCRCamera(false);
    setFoodAddExpanded(true);
  } catch (e) {
    setOCRStatus('Erreur OCR : ' + (e.message || e), true);
    if (fromAuto && ocrAutoEnabled) startNutritionOCRAutoLoop();
  } finally {
    ocrAutoBusy = false;
  }
}

function syncNutritionOCRAutoButton() {
  const btn = document.getElementById('ocr-auto-btn');
  if (!btn) return;
  btn.textContent = ocrAutoEnabled ? 'Déclencheur OCR ON' : 'Déclencheur OCR OFF';
  btn.classList.toggle('active', !!ocrAutoEnabled);
}

function toggleNutritionOCRAuto() {
  ocrAutoEnabled = !ocrAutoEnabled;
  syncNutritionOCRAutoButton();
  if (ocrAutoEnabled) {
    ocrAutoStableSince = 0;
    ocrAutoLastScore = null;
    setOCRStatus('Déclencheur OCR actif : cadre le tableau, l’envoi serveur partira seulement quand l’image sera stable.', false);
    startNutritionOCRAutoLoop();
  } else {
    stopNutritionOCRAutoLoop(true);
  }
}

function stopNutritionOCRAutoLoop(showStatus = false) {
  ocrAutoLoopId++;
  ocrAutoStableSince = 0;
  ocrAutoLastScore = null;
  if (showStatus) setOCRStatus('Auto désactivé.', false);
}

function startNutritionOCRAutoLoop() {
  const video = document.getElementById('ocr-video');
  if (!ocrAutoEnabled || !video || !video.srcObject) return;
  const loopId = ++ocrAutoLoopId;
  const sample = document.createElement('canvas');
  sample.width = 64;
  sample.height = 36;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (loopId !== ocrAutoLoopId || !ocrAutoEnabled || !video.srcObject || ocrAutoBusy) return;
    try {
      if (video.videoWidth && video.videoHeight) {
        ctx.drawImage(video, 0, 0, sample.width, sample.height);
        const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i+1] + data[i+2]) / 3;
        const score = sum / (data.length / 4);
        const now = Date.now();
        const diff = ocrAutoLastScore == null ? 999 : Math.abs(score - ocrAutoLastScore);
        ocrAutoLastScore = score;
        if (diff < 1.8) {
          if (!ocrAutoStableSince) ocrAutoStableSince = now;
          const stableMs = now - ocrAutoStableSince;
          if (stableMs > 1100 && now - ocrAutoLastShotAt > 6000) {
            ocrAutoLastShotAt = now;
            setOCRStatus('Image stable détectée, lecture automatique…', false);
            captureNutritionOCRFrame(true);
            return;
          }
          if (stableMs > 500) setOCRStatus('Image presque stable… déclencheur OCR actif.', false);
        } else {
          ocrAutoStableSince = 0;
          setOCRStatus('Déclencheur OCR actif : stabilise le téléphone devant le tableau.', false);
        }
      }
    } catch(e) {}
    setTimeout(() => requestAnimationFrame(tick), 330);
  };
  requestAnimationFrame(tick);
}

// v10.82 — OCR photo d'étiquette nutritionnelle
function closeOCRPanel() {
  stopNutritionOCRCamera(false);
  try { window.FoodNoteCropShell && window.FoodNoteCropShell.close && window.FoodNoteCropShell.close({ keepPanelVisible:false }); } catch(e) {}
  foodRecipeOCRMode = false;
  const p = document.getElementById('ocr-panel');
  if (p) p.style.display = 'none';
  const modal = document.getElementById('food-add-modal');
  if (modal) {
    modal.classList.remove('food-add-recipe-mode', 'food-add-recipe-camera', 'food-add-recipe-crop', 'food-add-recipe-result', 'food-add-recipe-ocr-result', 'food-add-recipe-ai-result', 'food-add-recipe-processing');
    delete modal.dataset.foodnoteWorkflow;
    delete modal.dataset.foodnoteRecipeStep;
  }
  try { window.FoodNoteRecipeWorkflowActive = false; } catch(e) {}
  const cropBox = document.getElementById('recipe-crop-box');
  if (cropBox) cropBox.style.display = 'none';
  foodRecipeCropPhotoDataUrl = '';
  foodRecipeCropReady = false;
  foodCropMode = 'recipe';
  try { window.FoodNoteCropMode = foodCropMode; } catch(e) {}
  syncOCRPanelMode && syncOCRPanelMode();
}

function setOCRStatus(msg, isError) {
  const el = document.getElementById('ocr-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}

async function handleNutritionPhotoSelected(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const panel = document.getElementById('ocr-panel');
  const resultBox = document.getElementById('ocr-result');
  if (panel) panel.style.display = 'block';
  if (resultBox) resultBox.style.display = 'none';
  setOCRStatus('Photo chargée. Recadre le tableau nutritionnel avant lecture OCR.', false);
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    showNutritionLabelCropPreview(dataUrl, { source:'file', filename:file.name || 'photo' });
    if (input) input.value = '';
  } catch (e) {
    setOCRStatus('Erreur photo : ' + (e.message || e), true);
  }
}


function drawNutritionFullFrameToCanvas(video, canvas) {
  const vw = video && video.videoWidth || 0;
  const vh = video && video.videoHeight || 0;
  if (!vw || !vh) throw new Error('Image caméra pas encore prête.');
  const maxW = 2200;
  const outW = Math.min(maxW, vw);
  const scale = outW / vw;
  const outH = Math.max(1, Math.round(vh * scale));
  canvas.width = Math.round(outW);
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, canvas.width, canvas.height);
  return { sx:0, sy:0, sw:vw, sh:vh, outW:canvas.width, outH:canvas.height, scale:Math.round(scale * 100) / 100, fullFrame:true, nutritionLabel:true };
}

function suspendCameraBeforeCrop(mode = 'nutrition_label') {
  // 0.22.15 : transition atomique viseur -> recadrage.
  // On ne laisse aucun ancien modal caméra actif pendant que le crop est visible.
  try { stopNutritionOCRCamera(false); } catch(e) {}
  try { stopBarcodeScanner(); } catch(e) {}
  const barcodePanel = document.getElementById('barcode-scan-panel');
  if (barcodePanel) {
    barcodePanel.style.display = 'none';
    barcodePanel.classList.remove('foodnote-camera-unified', 'food-camera-submodal');
    barcodePanel.removeAttribute('aria-modal');
    barcodePanel.removeAttribute('role');
  }
  const ocrPanel = document.getElementById('ocr-panel');
  if (ocrPanel) ocrPanel.classList.remove('foodnote-camera-unified', 'food-camera-submodal');
  const ocrBox = document.getElementById('ocr-camera-box');
  if (ocrBox) ocrBox.style.display = 'none';
  const modal = document.getElementById('food-add-modal');
  if (modal) modal.classList.remove('food-scan-submodal-open');
  document.body.classList.remove('foodnote-camera-view-open', 'barcode-modal-open');
  try {
    if (window.FoodNoteCropShell && typeof window.FoodNoteCropShell.suspendCameraView === 'function') {
      window.FoodNoteCropShell.suspendCameraView(mode);
    }
  } catch(e) {}
}

function syncNutritionCropLabels() {
  if (foodCropMode !== 'nutrition_label') return;
  const panel = document.getElementById('ocr-panel');
  const crop = document.getElementById('recipe-crop-box');
  const title = panel?.querySelector('.ocr-panel-head strong');
  const note = panel?.querySelector('.ocr-unified-note');
  const headTitle = crop?.querySelector('.recipe-crop-head strong');
  const hint = crop?.querySelector('.recipe-crop-head span');
  const actions = crop?.querySelector('.recipe-crop-actions');
  const buttons = actions ? Array.from(actions.querySelectorAll('button')) : [];
  const retakeBtn = buttons[0];
  const fullBtn = buttons[1];
  const readBtn = document.getElementById('recipe-crop-read-btn');
  if (title) title.textContent = 'Recadrage tableau nutritionnel';
  if (note) note.textContent = 'La photo reste locale jusqu’à validation. Déplace le cadre sur le tableau kcal/protéines/glucides/lipides, puis lance la lecture.';
  if (headTitle) headTitle.textContent = 'Recadrer le tableau nutritionnel';
  if (hint) {
    hint.textContent = 'Garde seulement le tableau utile : valeurs pour 100 g, kcal, protéines, glucides, lipides. Évite le logo et le reste de l’emballage.';
    hint.__fn01610Text = false;
  }
  if (retakeBtn) retakeBtn.textContent = foodNutritionCropLastSource === 'file' ? '↩ Choisir une autre photo' : '↩ Reprendre photo';
  if (fullBtn) fullBtn.textContent = 'Lire toute l’image';
  if (readBtn && !readBtn.disabled) readBtn.textContent = '📖 Lire ce tableau';
  const resultBox = document.getElementById('ocr-result');
  const recipeBox = document.getElementById('recipe-ocr-result');
  if (resultBox) resultBox.style.display = 'none';
  if (recipeBox) recipeBox.style.display = 'none';
}

function showNutritionLabelCropPreview(dataUrl, opts = {}) {
  if (!dataUrl) {
    setOCRStatus('Photo nutritionnelle indisponible.', true);
    return;
  }
  suspendCameraBeforeCrop('nutrition_label');
  foodCropMode = 'nutrition_label';
  foodNutritionCropLastSource = opts.source || 'camera';
  try { window.FoodNoteCropMode = foodCropMode; } catch(e) {}
  foodRecipeOCRMode = false;
  const panel = document.getElementById('ocr-panel');
  const resultBox = document.getElementById('ocr-result');
  const recipeBox = document.getElementById('recipe-ocr-result');
  const modal = document.getElementById('food-add-modal');
  if (panel) panel.style.display = 'block';
  if (resultBox) resultBox.style.display = 'none';
  if (recipeBox) recipeBox.style.display = 'none';
  if (modal) {
    modal.classList.remove('food-add-recipe-camera', 'food-add-recipe-result', 'food-add-recipe-processing');
    modal.classList.add('food-add-expanded', 'food-add-recipe-mode', 'food-add-recipe-crop', 'food-add-nutrition-crop');
  }
  // Le moteur d'affichage du crop est commun avec les recettes, mais le mode reste typé nutrition_label.
  showRecipeCropPreview(dataUrl);
  foodCropMode = 'nutrition_label';
  try { window.FoodNoteCropMode = foodCropMode; } catch(e) {}
  try { window.FoodNoteCropShell && window.FoodNoteCropShell.activate && window.FoodNoteCropShell.activate('nutrition_label'); } catch(e) {}
  setOCRStatus('Photo prête. Recadre le tableau nutritionnel puis touche “Lire ce tableau”.', false);
  [0, 80, 260, 700].forEach(delay => setTimeout(syncNutritionCropLabels, delay));
}

async function processNutritionLabelImage(dataUrl, cropInfo = {}, label = 'zone recadrée') {
  if (ocrAutoBusy) {
    setOCRStatus('Lecture OCR déjà en cours… attends le résultat.', false);
    return;
  }
  if (!dataUrl) {
    setOCRStatus('Aucune image nutritionnelle à lire.', true);
    return;
  }
  ocrAutoBusy = true;
  const modal = document.getElementById('food-add-modal');
  const cropBox = document.getElementById('recipe-crop-box');
  const resultBox = document.getElementById('ocr-result');
  const recipeBox = document.getElementById('recipe-ocr-result');
  const readBtn = document.getElementById('recipe-crop-read-btn');
  try {
    if (modal) modal.classList.add('food-add-recipe-processing');
    if (resultBox) resultBox.style.display = 'none';
    if (recipeBox) recipeBox.style.display = 'none';
    setOCRStatus(`⏳ Lecture OCR du tableau nutritionnel (${label})…`, false);
    const resp = await fetch('/api/ocr/nutrition-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, filename: 'nutrition-label.png', mode: 'balanced_plus', kind: 'nutrition_label', crop: { ...(cropInfo || {}), nutritionLabel:true, source:foodNutritionCropLastSource } })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || 'OCR impossible');
    try { window.FoodNoteCropShell && window.FoodNoteCropShell.complete && window.FoodNoteCropShell.complete({ mode:'nutrition_label', showResultId:'ocr-result' }); } catch(e) {}
    fillOCRForm(data.parsed || {}, data.raw_text || '');
    if (cropBox) cropBox.style.display = 'none';
    if (resultBox) resultBox.style.display = 'block';
    if (recipeBox) recipeBox.style.display = 'none';
    if (modal) {
      modal.classList.remove('food-add-recipe-camera', 'food-add-recipe-crop', 'food-add-nutrition-crop', 'food-add-recipe-processing');
      modal.classList.add('food-add-expanded', 'food-add-recipe-result');
    }
    setFoodAddExpanded(true);
    setOCRStatus('Valeurs détectées. Vérifie kcal/protéines/glucides/lipides avant sauvegarde.', false);
    requestAnimationFrame(() => {
      try {
        const dialog = document.querySelector('#food-add-modal .food-add-dialog');
        const panel = document.querySelector('#food-add-modal .food-add-panel');
        [dialog, panel, document.getElementById('ocr-panel')].forEach(el => { if (el) el.scrollTop = 0; });
        resultBox?.scrollIntoView({ block:'start', inline:'nearest' });
      } catch(e) {}
    });
  } catch (e) {
    if (modal) modal.classList.remove('food-add-recipe-processing');
    setOCRStatus('Erreur OCR tableau nutritionnel : ' + (e.message || e), true);
  } finally {
    ocrAutoBusy = false;
    if (readBtn && foodCropMode === 'nutrition_label' && !readBtn.disabled) readBtn.textContent = '📖 Lire ce tableau';
  }
}
try { window.processNutritionLabelImage = processNutritionLabelImage; } catch(e) {}

function retakeNutritionLabelPhoto() {
  foodCropMode = 'nutrition_label';
  try { window.FoodNoteCropMode = foodCropMode; } catch(e) {}
  try { window.FoodNoteCropShell && window.FoodNoteCropShell.close && window.FoodNoteCropShell.close({ keepPanelVisible:true }); } catch(e) {}
  const cropBox = document.getElementById('recipe-crop-box');
  const resultBox = document.getElementById('ocr-result');
  if (cropBox) cropBox.style.display = 'none';
  if (resultBox) resultBox.style.display = 'none';
  foodRecipeCropPhotoDataUrl = '';
  foodRecipeCropReady = false;
  setOCRStatus('Reprise tableau nutritionnel : cadre l’étiquette puis touche “Lire tableau”.', false);
  try {
    const flows = window.FoodNoteFoodCaptureFlows;
    if (flows && typeof flows.openNutritionTable === 'function') {
      flows.openNutritionTable();
      return;
    }
    if (flows && typeof flows.open === 'function') {
      flows.open('nutrition_table', { reason:'retake-nutrition-label' });
      return;
    }
  } catch(e) {
    console.warn('[FoodNote] reprise OCR nutrition via FoodNoteFoodCaptureFlows impossible', e);
  }
  try { if (typeof openFoodPhotoOption === 'function') openFoodPhotoOption(); } catch(e) {}
}

function fillOCRForm(parsed, rawText) {
  const search = document.getElementById('db-search');
  const baseName = (search && search.value.trim()) || '';
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val == null ? '' : val; };
  set('ocr-food-name', baseName || 'Aliment OCR');
  set('ocr-kcal', parsed.kcal100);
  set('ocr-prot', parsed.prot100);
  set('ocr-gluc', parsed.gluc100);
  set('ocr-lip', parsed.lip100);
  set('ocr-fibres', parsed.fibres100);
  const raw = document.getElementById('ocr-raw-text');
  if (raw) raw.textContent = rawText || parsed.text || '';
}



function drawRecipeFullFrameToCanvas(video, canvas) {
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (!vw || !vh) throw new Error('Image caméra pas encore prête.');
  const maxW = 2200;
  const outW = Math.min(maxW, vw);
  const scale = outW / vw;
  const outH = Math.max(1, Math.round(vh * scale));
  canvas.width = Math.round(outW);
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, canvas.width, canvas.height);
  return { sx:0, sy:0, sw:vw, sh:vh, outW:canvas.width, outH:canvas.height, scale:Math.round(scale * 100) / 100, usedFrame:false, fullFrame:true };
}

function setRecipeCropState(next) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const minW = 18;
  const minH = 14;
  let x = Number(next.x ?? foodRecipeCropState.x);
  let y = Number(next.y ?? foodRecipeCropState.y);
  let w = Number(next.w ?? foodRecipeCropState.w);
  let h = Number(next.h ?? foodRecipeCropState.h);
  w = clamp(w, minW, 96);
  h = clamp(h, minH, 92);
  x = clamp(x, 1, 99 - w);
  y = clamp(y, 1, 99 - h);
  foodRecipeCropState = { x, y, w, h };
  const sel = document.getElementById('recipe-crop-selection');
  if (sel) {
    sel.style.left = x + '%';
    sel.style.top = y + '%';
    sel.style.width = w + '%';
    sel.style.height = h + '%';
  }
}

function initRecipeCropInteractions() {
  const stage = document.getElementById('recipe-crop-stage');
  const sel = document.getElementById('recipe-crop-selection');
  if (!stage || !sel) return;
  if (foodRecipeCropPointerCleanup) {
    try { foodRecipeCropPointerCleanup(); } catch(e) {}
    foodRecipeCropPointerCleanup = null;
  }
  let active = null;
  const toPct = ev => {
    const r = stage.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * 100,
      y: ((ev.clientY - r.top) / r.height) * 100,
      w: r.width,
      h: r.height
    };
  };
  const down = ev => {
    if (!ev.target.closest('#recipe-crop-selection')) return;
    ev.preventDefault();
    const p = toPct(ev);
    active = {
      pointerId: ev.pointerId,
      mode: ev.target.dataset.handle || 'move',
      startX: p.x,
      startY: p.y,
      state: { ...foodRecipeCropState }
    };
    try { sel.setPointerCapture(ev.pointerId); } catch(e) {}
    sel.classList.add('dragging');
  };
  const move = ev => {
    if (!active) return;
    ev.preventDefault();
    const p = toPct(ev);
    const dx = p.x - active.startX;
    const dy = p.y - active.startY;
    let { x, y, w, h } = active.state;
    if (active.mode === 'move') {
      x += dx; y += dy;
    } else {
      if (active.mode.includes('w')) { x += dx; w -= dx; }
      if (active.mode.includes('e')) { w += dx; }
      if (active.mode.includes('n')) { y += dy; h -= dy; }
      if (active.mode.includes('s')) { h += dy; }
    }
    setRecipeCropState({ x, y, w, h });
  };
  const up = ev => {
    if (!active) return;
    try { sel.releasePointerCapture(active.pointerId); } catch(e) {}
    active = null;
    sel.classList.remove('dragging');
  };
  sel.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive:false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  foodRecipeCropPointerCleanup = () => {
    sel.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
}

function showRecipeCropPreview(dataUrl) {
  const modal = document.getElementById('food-add-modal');
  const cropBox = document.getElementById('recipe-crop-box');
  const img = document.getElementById('recipe-crop-img');
  const recipeBox = document.getElementById('recipe-ocr-result');
  const aiBox = document.getElementById('recipe-ai-result');
  const tableBox = document.getElementById('ocr-result');
  if (!cropBox || !img) return;
  if (recipeBox) recipeBox.style.display = 'none';
  if (aiBox) aiBox.style.display = 'none';
  if (tableBox) tableBox.style.display = 'none';
  foodRecipeCropPhotoDataUrl = dataUrl;
  window.FoodNoteRecipeScanPhotoData = dataUrl;
  foodRecipeCropReady = false;
  img.onload = () => {
    try {
      const max = 720;
      let w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
      const ratio = Math.min(1, max / Math.max(w || max, h || max));
      w = Math.max(1, Math.round(w * ratio)); h = Math.max(1, Math.round(h * ratio));
      const thumb = document.createElement('canvas'); thumb.width = w; thumb.height = h;
      thumb.getContext('2d').drawImage(img, 0, 0, w, h);
      window.FoodNoteRecipeScanPhotoData = thumb.toDataURL('image/jpeg', .72);
    } catch(e) {}
    foodRecipeCropReady = true;
    setRecipeCropState({ x: 10, y: 14, w: 80, h: 58 });
    initRecipeCropInteractions();
    setOCRStatus(foodCropMode === 'nutrition_label' ? 'Photo prise. Ajuste le cadre sur le tableau nutritionnel puis touche “📖 Lire ce tableau”.' : 'Photo prise. Ajuste le cadre sur la liste d’ingrédients puis touche “📖 Lire cette zone”.', false);
    try { window.FoodNoteCropShell && window.FoodNoteCropShell.activate && window.FoodNoteCropShell.activate(foodCropMode); } catch(e) {}
  };
  img.src = dataUrl;
  cropBox.style.display = 'block';
  foodnoteSetRecipeWorkflowStep('crop');
  requestAnimationFrame(() => {
    try {
      const dialog = document.querySelector('#food-add-modal .food-add-dialog');
      const panel = document.querySelector('#food-add-modal .food-add-panel');
      [dialog, panel].forEach(el => { if (el) el.scrollTop = 0; });
      cropBox.scrollIntoView({ block:'start', inline:'nearest' });
    } catch(e) {}
  });
}

async function captureRecipeOCRFrame(fromAuto = false) {
  const video = document.getElementById('ocr-video');
  const canvas = document.getElementById('ocr-canvas');
  const btn = document.getElementById('recipe-ocr-read-btn');
  if (!video || !canvas || !video.videoWidth) {
    setOCRStatus('Image caméra pas encore prête.', true);
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '📸 Photo…'; }
    foodCropMode = 'recipe';
    try { window.FoodNoteCropMode = foodCropMode; } catch(e) {}
    const info = drawRecipeFullFrameToCanvas(video, canvas);
    const dataUrl = canvas.toDataURL('image/png');
    try { stopNutritionOCRCamera(false); } catch(e) {}
    showRecipeCropPreview(dataUrl);
    setOCRStatus(`📸 Photo prise (${info.outW}×${info.outH}). Recadre la liste avant OCR.`, false);
  } catch(e) {
    setOCRStatus('Erreur photo recette : ' + (e.message || e), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📸 Prendre la photo'; }
  }
}

function retakeRecipePhoto() {
  if (foodCropMode === 'nutrition_label' || window.FoodNoteCropMode === 'nutrition_label') return retakeNutritionLabelPhoto();
  try { window.FoodNoteCropShell && window.FoodNoteCropShell.close && window.FoodNoteCropShell.close({ keepPanelVisible:true }); } catch(e) {}
  const modal = document.getElementById('food-add-modal');
  const cropBox = document.getElementById('recipe-crop-box');
  const recipeBox = document.getElementById('recipe-ocr-result');
  if (cropBox) cropBox.style.display = 'none';
  if (recipeBox) recipeBox.style.display = 'none';
  foodRecipeCropPhotoDataUrl = '';
  foodRecipeCropReady = false;
  foodRecipeOCRCaptureSerial++;
  foodnoteSetRecipeWorkflowStep('camera');
  setOCRStatus('Reprise photo : cadre la page, puis touche “📸 Prendre la photo”.', false);
  startNutritionOCRCamera();
}

function drawRecipeCropToCanvas() {
  const img = document.getElementById('recipe-crop-img');
  const canvas = document.getElementById('ocr-canvas');
  if (!img || !canvas || !foodRecipeCropReady || !img.naturalWidth) throw new Error('Photo à recadrer indisponible.');
  const st = foodRecipeCropState;
  const sx = Math.round((st.x / 100) * img.naturalWidth);
  const sy = Math.round((st.y / 100) * img.naturalHeight);
  const sw = Math.max(1, Math.round((st.w / 100) * img.naturalWidth));
  const sh = Math.max(1, Math.round((st.h / 100) * img.naturalHeight));
  const targetW = 1900;
  const maxW = 2200;
  const outW = Math.round(Math.min(maxW, Math.max(targetW, sw)));
  const scale = outW / sw;
  const outH = Math.max(1, Math.round(sh * scale));
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { sx, sy, sw, sh, outW:canvas.width, outH:canvas.height, scale:Math.round(scale * 100) / 100, usedFrame:true, manualCrop:true };
}

async function runRecipeOCRFromCrop() {
  const btn = document.getElementById('recipe-crop-read-btn');
  const isNutritionCrop = foodCropMode === 'nutrition_label' || window.FoodNoteCropMode === 'nutrition_label';
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyse…'; }
    const cropInfo = drawRecipeCropToCanvas();
    const dataUrl = document.getElementById('ocr-canvas').toDataURL('image/png');
    if (isNutritionCrop) await processNutritionLabelImage(dataUrl, cropInfo, 'zone recadrée');
    else await processRecipeOCRImage(dataUrl, cropInfo, 'zone recadrée');
  } catch(e) {
    setOCRStatus((isNutritionCrop ? 'Erreur OCR tableau nutritionnel : ' : 'Erreur OCR recette : ') + (e.message || e), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = isNutritionCrop ? '📖 Lire ce tableau' : '📖 Lire cette zone'; }
  }
}

async function runRecipeOCRFromFullPhoto() {
  if (!foodRecipeCropPhotoDataUrl) {
    setOCRStatus('Aucune photo à lire.', true);
    return;
  }
  const isNutritionCrop = foodCropMode === 'nutrition_label' || window.FoodNoteCropMode === 'nutrition_label';
  if (isNutritionCrop) await processNutritionLabelImage(foodRecipeCropPhotoDataUrl, { fullFrame:true, nutritionLabel:true }, 'image complète');
  else await processRecipeOCRImage(foodRecipeCropPhotoDataUrl, { fullFrame:true }, 'image complète');
}

async function processRecipeOCRImage(dataUrl, cropInfo = {}, label = 'zone') {
  foodnoteBeginRecipePhotoWorkflow();
  if (ocrAutoBusy) {
    setOCRStatus('Lecture OCR déjà en cours… attends le résultat.', false);
    return;
  }
  const serial = ++foodRecipeOCRCaptureSerial;
  ocrAutoBusy = true;
  const modal = document.getElementById('food-add-modal');
  const cropBox = document.getElementById('recipe-crop-box');
  const recipeBox = document.getElementById('recipe-ocr-result');
  const aiBox = document.getElementById('recipe-ai-result');
  const tableBox = document.getElementById('ocr-result');
  const textEl = document.getElementById('recipe-ocr-text');
  try {
    foodnoteSetRecipeWorkflowStep('processing');
    if (modal) modal.classList.add('food-add-recipe-processing');
    if (recipeBox) recipeBox.style.display = 'none';
    if (aiBox) aiBox.style.display = 'none';
    if (tableBox) tableBox.style.display = 'none';
    if (textEl) textEl.value = '';
    setOCRStatus(`⏳ Analyse de la ${label}…`, false);
    const resp = await fetch('/api/ocr/nutrition-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, mode: 'quality', kind: 'recipe_ingredients', crop: cropInfo })
    });
    const data = await resp.json().catch(() => ({}));
    if (serial !== foodRecipeOCRCaptureSerial) return;
    if (!resp.ok || !data.ok) throw new Error(data.error || 'OCR recette impossible');
    const raw = String(data.raw_text || '').trim();
    const cleaned = cleanRecipeOCRText(raw);
    try { window.FoodNoteCropShell && window.FoodNoteCropShell.complete && window.FoodNoteCropShell.complete({ mode:'recipe', showResultId:'recipe-ocr-result' }); } catch(e) {}
    if (cropBox) cropBox.style.display = 'none';
    if (tableBox) tableBox.style.display = 'none';
    if (recipeBox) recipeBox.style.display = 'block';
    if (aiBox) aiBox.style.display = 'none';
    if (textEl) textEl.value = cleaned || raw;
    foodnoteSetRecipeWorkflowStep('ocr_result');
    setTimeout(() => foodnoteReconcileRecipeWorkflow('ocr-result-afterpaint'), 60);
    setTimeout(() => foodnoteReconcileRecipeWorkflow('ocr-result-late'), 260);
    setFoodAddExpanded(true);
    const keptCount = (cleaned || raw || '').split('\n').map(l => l.trim()).filter(Boolean).length;
    setOCRStatus(`✅ OCR terminé : ${keptCount} ligne(s) utile(s) retenue(s). Corrige si besoin, puis envoie à l’IA.`, false);
    requestAnimationFrame(() => {
      try {
        const dialog = document.querySelector('#food-add-modal .food-add-dialog');
        const panel = document.querySelector('#food-add-modal .food-add-panel');
        const ocrPanel = document.getElementById('ocr-panel');
        [dialog, panel, ocrPanel].forEach(el => { if (el) el.scrollTop = 0; });
        recipeBox?.scrollIntoView({ block:'start', inline:'nearest' });
      } catch(e) {}
    });
  } catch(e) {
    if (modal) modal.classList.remove('food-add-recipe-processing');
    setOCRStatus('Erreur OCR recette : ' + (e.message || e), true);
  } finally {
    ocrAutoBusy = false;
  }
}

function cleanRecipeOCRText(raw) {
  const original = String(raw || '');

  // v12.03 — filtre générique OCR recette :
  // aucune règle liée à une recette précise. On garde les lignes qui ressemblent
  // structurellement à des ingrédients, on supprime le bruit OCR, puis on fusionne
  // les doublons par similarité.
  const UNITS = [
    'mg','g','gr','gramme','grammes','kg','kilo','kilos',
    'ml','cl','l','litre','litres',
    'cuillere','cuilleres','cuillère','cuillères','cas','càs','cac','càc',
    'sachet','sachets','paquet','paquets','boite','boites','boîte','boîtes',
    'bouteille','bouteilles','pot','pots','barquette','barquettes',
    'tranche','tranches','piece','pieces','pièce','pièces','unite','unites','unité','unités',
    'pincee','pincees','pincée','pincées','verre','verres','tasse','tasses'
  ];
  const UNIT_RE = '(?:' + UNITS
    .map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|') + '|c\\.?\\s*[aà]\\s*[sc]\\.?)';
  const QTY_RE = '(?:\\d+(?:[,.]\\d+)?|[¼½¾⅓⅔⅛]|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|des|quelques)';
  const qtyAtStartRe = new RegExp('^\\s*' + QTY_RE + '\\b', 'i');
  const qtyUnitAnywhereRe = new RegExp('\\b' + QTY_RE + '\\s*(?:' + UNIT_RE + ')?\\s+', 'i');
  const unitRe = new RegExp('\\b' + UNIT_RE + '\\b', 'i');

  function stripAccents(v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function safeLower(v) {
    return stripAccents(v).toLowerCase();
  }
  function wordsOf(v) {
    return safeLower(v).match(/[a-zœ]{2,}/g) || [];
  }
  function vowelRatio(v) {
    const s = safeLower(v).replace(/[^a-z]/g, '');
    if (!s) return 0;
    const vowels = (s.match(/[aeiouy]/g) || []).length;
    return vowels / s.length;
  }
  function isOcrMarker(l) {
    return /(?:^|\b)(deskew|contrast|sharp_gray|sharp|soft_bw|soft|original|native[-/]?tesseract|tesseract)(?:\b|$)/i.test(l);
  }
  function isHeadingOrNoise(l) {
    const s = String(l || '').trim();
    const n = safeLower(s).trim();
    if (!s) return true;
    if (isOcrMarker(s)) return true;
    if (/^-{2,}/.test(s)) return true;
    if (/^(ingredients?|ingr[eé]dients?|dients?|liste|recette|preparation|préparation|mode d.?emploi|nutrition|valeurs?|tableau)\s*:?$/i.test(s)) return true;
    if (/^\d+\s*(pers\.?|personnes?|parts?)\b/i.test(s)) return true;
    if (/^[a-z]{1,2}$/i.test(n)) return true;
    if (/^(rer|wee|cre|cad|cads?|ts|ls|mf|nes|borg|aud|pen|ven|yay|drs|pnr|rare)$/i.test(n)) return true;
    return false;
  }
  function removeBulletAndPrefixNoise(l) {
    let s = String(l || '')
      .replace(/\r/g, ' ')
      .replace(/[|{}\[\]<>]/g, ' ')
      .replace(/[•●▪]/g, ' ')
      .replace(/[“”"'‘’`´]/g, '')
      .replace(/[_~^=]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    s = s.replace(/^[-–—*.)#°_&+,:;\s]+/, '').trim();

    // Certains OCR ajoutent des fragments avant une quantité : "Ka e 25 g ...".
    // On coupe au premier début plausible d'ingrédient si le préfixe est court.
    const m = s.match(new RegExp('(?:^|\\s)(' + QTY_RE + '\\s*(?:' + UNIT_RE + ')?\\s+)', 'i'));
    if (m && m.index > 0 && m.index <= 14) s = s.slice(m.index).trim();

    // Puce lue comme une lettre isolée juste avant une quantité.
    s = s.replace(new RegExp('^(?:[a-zà-ÿœ]{1,3}\\s+){1,3}(?=' + QTY_RE + '\\s*(?:' + UNIT_RE + ')?\\b)', 'i'), '').trim();

    // Corrections OCR génériques de chiffres/unités, pas liées à un aliment.
    s = s
      .replace(/^([Il])\s+(?=[A-Za-zÀ-ÿŒœ]{2,})/u, '1 ')
      .replace(/^([Il])(?=\s*(?:' + UNIT_RE + ')\\b)/i, '1')
      .replace(/^I5\s+(?=(?:' + UNIT_RE + ')\\b)/i, '15 ')
      .replace(/^IS\s+(?=(?:' + UNIT_RE + ')\\b)/i, '15 ')
      .replace(/\b0\s*(?=g\b)/gi, '0 g')
      .replace(/^(\d+)(?=[A-Za-zÀ-ÿŒœ])/u, '$1 ')
      .replace(/\){2,}\s*$/g, ')')
      .replace(/liqu\s+ide/gi, 'liquide')
      .replace(/enti[eéè]re/gi, 'entière')
      .replace(/\s+/g, ' ')
      .trim();

    // Normalisation générique d'une expression OCR fréquente dans les recettes :
    // quantité + unité de volume + mot abîmé + "liquide entière".
    // On ne cible pas une recette précise, on répare seulement la structure "crème liquide entière".
    s = s.replace(new RegExp('^(\\d+(?:[,.]\\d+)?\\s*(?:ml|cl|l|litre|litres)\\s+)(?:[A-Za-zÀ-ÿŒœ]{1,8}\\s+)?(liquide\\s+entière?s?)$', 'i'), '$1Crème $2');

    // Supprime les restes de bruit très courts en fin de ligne, mais sans toucher
    // aux vrais mots longs.
    s = s.replace(/\s+\b(?:a|ae|eae|e|oe|sy|no|ay|ps|pnr)\b(?:\s+\b(?:a|ae|eae|e|oe|sy|no|ay|ps|pnr)\b)*\s*$/i, '').trim();

    return s;
  }
  function baseCandidate(line) {
    if (isHeadingOrNoise(line)) return '';
    const s = removeBulletAndPrefixNoise(line);
    if (isHeadingOrNoise(s)) return '';
    if (s.length < 3 || s.length > 90) return '';
    return s;
  }
  function hasQty(line) {
    return qtyAtStartRe.test(line);
  }
  function hasUnit(line) {
    return unitRe.test(line);
  }
  function usefulIngredientTail(line) {
    let tail = safeLower(line)
      .replace(new RegExp('^\\s*' + QTY_RE + '\\s*', 'i'), ' ')
      .replace(new RegExp('^\\s*(?:' + UNIT_RE + ')\\b', 'i'), ' ')
      .replace(/\b(de|d|du|des|la|le|les|l|a|au|aux|et|ou|avec|sans|en)\b/g, ' ')
      .replace(/[()0-9.,/+\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = tail.match(/[a-zœ]{3,}/g) || [];
    return words.length;
  }
  function looksLikeShortOcrJunkAfterQty(line) {
    const s = String(line || '').trim();
    if (!hasQty(s)) return false;
    if (hasUnit(s)) return false;
    const tailWords = usefulIngredientTail(s);
    if (tailWords > 0) return false;
    const tail = safeLower(s)
      .replace(new RegExp('^\\s*' + QTY_RE + '\\s*', 'i'), '')
      .replace(/[^a-z0-9œ]+/g, ' ')
      .trim();
    return tail.length <= 8;
  }
  function numericQtyValue(line) {
    const m = safeLower(line).match(/^\s*(\d+(?:[,.]\d+)?)/);
    if (!m) return null;
    const n = Number(String(m[1]).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function firstWordAfterQty(line) {
    const s = safeLower(line).replace(new RegExp('^\s*' + QTY_RE + '\s*', 'i'), '').trim();
    return (s.match(/[a-zœ]{1,}/) || [''])[0] || '';
  }
  function hasHardOcrGarbage(line) {
    const s = String(line || '');
    if (/[€$£¥@]/.test(s)) return true;
    const opens = (s.match(/[([{]/g) || []).length;
    const closes = (s.match(/[)\]}]/g) || []).length;
    if (opens > closes + 1) return true;
    return false;
  }
  function isStrongRecipeIngredient(line, score) {
    const s = String(line || '').trim();
    if (score < 52) return false;
    if (hasHardOcrGarbage(s)) return false;
    const qty = hasQty(s);
    const unit = hasUnit(s);
    const tailWords = usefulIngredientTail(s);
    if (!qty && !unit) return false;
    if (tailWords < 1) return false;
    const n = numericQtyValue(s);
    if (qty && !unit && n != null && n >= 10) return false;
    const fw = firstWordAfterQty(s);
    if (qty && !unit && fw && fw.length <= 2) return false;
    return true;
  }
  function candidateScore(line) {
    const s = String(line || '').trim();
    const clean = safeLower(s);
    const letters = (s.match(/[A-Za-zÀ-ÿŒœ]/g) || []).length;
    const digits = (s.match(/\d/g) || []).length;
    const tokens = wordsOf(s);
    const weird = (s.match(/[^A-Za-zÀ-ÿŒœ0-9()\s,.\/+-]/g) || []).length;
    const oneLetterTokens = tokens.filter(w => w.length <= 1).length;
    const upperTokens = (s.match(/\b[A-Z]{2,}\b/g) || []).length;
    const qty = hasQty(s);
    const unit = hasUnit(s);
    const vr = vowelRatio(s);

    let score = 0;
    if (qty) score += 48;
    if (unit) score += 24;
    if (digits && unit) score += 12;
    if (letters >= 3) score += Math.min(20, letters);
    if (tokens.length >= 1 && tokens.length <= 8) score += 8;
    if (s.length >= 5 && s.length <= 60) score += 6;
    if (vr >= .28) score += 8;
    if (vr < .20 && letters >= 6) score -= 24;
    if (weird) score -= weird * 8;
    if (oneLetterTokens) score -= oneLetterTokens * 6;
    if (upperTokens && !unit) score -= upperTokens * 8;
    if (/^[A-Z]{2,}(?:\s+[A-Z]{2,})+/.test(s) && !unit) score -= 25;
    if (/\b(http|www|barcode|ean|qr|ocr|resultat|retour|filtrer|renvoye|renvoyé)\b/i.test(clean)) score -= 60;
    if (/^\d+\s*(pers|personnes|parts)/i.test(s)) score -= 80;
    if (looksLikeShortOcrJunkAfterQty(s)) score -= 90;
    if (qty && usefulIngredientTail(s) === 0) score -= 55;
    if (!qty && unit && new RegExp('^\\s*(?:' + UNIT_RE + ')\\b', 'i').test(s)) score -= 45;

    // Sans quantité ni unité, on accepte seulement une ligne simple et très propre,
    // pour permettre "sel" / "poivre" / "vanille", mais pas les gros déchets OCR.
    if (!qty && !unit) {
      score -= 20;
      if (tokens.length > 3) score -= 20;
      if (letters < 3) score -= 30;
      if (digits) score -= 12;
    }
    return score;
  }
  function quantitySignature(line) {
    const s = safeLower(line);
    const m = s.match(new RegExp('^\\s*(' + QTY_RE + ')\\s*(' + UNIT_RE + ')?\\b', 'i'));
    if (!m) return '';
    return (m[1] || '').replace(',', '.') + ' ' + (m[2] || '').replace(/\s+/g, '');
  }
  function ingredientKey(line) {
    let s = safeLower(line);
    s = s
      .replace(new RegExp('^\\s*' + QTY_RE + '\\s*', 'i'), ' ')
      .replace(new RegExp('\\b' + UNIT_RE + '\\b', 'gi'), ' ')
      .replace(/\b(de|d|du|des|la|le|les|l|a|au|aux|et|ou|avec|sans|en)\b/g, ' ')
      .replace(/\b(entier|entiere|entiers|entieres|frais|fraiche|fraiches|sec|seche|seches|poudre|liquide|rapee|rape|hache|hachee|coupe|coupes|morceaux|petit|petite|gros|grosse)\b/g, ' ')
      .replace(/[()]/g, ' ')
      .replace(/[^a-z0-9œ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return s;
  }
  function editDistance(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const dp = Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) dp[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(
          dp[j] + 1,
          dp[j - 1] + 1,
          prev + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        prev = tmp;
      }
    }
    return dp[b.length];
  }
  function similarity(a, b) {
    a = String(a || ''); b = String(b || '');
    if (!a || !b) return 0;
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length) || 1;
    const lev = 1 - (editDistance(a, b) / maxLen);
    const ta = new Set(wordsOf(a));
    const tb = new Set(wordsOf(b));
    const inter = [...ta].filter(x => tb.has(x)).length;
    const union = new Set([...ta, ...tb]).size || 1;
    const jac = inter / union;
    const minLen = Math.min(a.length, b.length);
    const contains = (minLen >= 4 && (a.includes(b) || b.includes(a))) ? .82 : 0;
    return Math.max(lev, jac, contains);
  }
  function isDuplicate(a, b) {
    const ak = ingredientKey(a.line);
    const bk = ingredientKey(b.line);
    const sim = similarity(ak, bk);
    const rawSim = similarity(
      safeLower(a.line).replace(new RegExp('^\\s*' + QTY_RE + '\\s*(?:' + UNIT_RE + ')?', 'i'), ' '),
      safeLower(b.line).replace(new RegExp('^\\s*' + QTY_RE + '\\s*(?:' + UNIT_RE + ')?', 'i'), ' ')
    );
    const aq = quantitySignature(a.line);
    const bq = quantitySignature(b.line);
    if (ak && bk && ak === bk) return true;
    if (sim >= .72) return true;
    if (aq && aq === bq && sim >= .45) return true;
    if (aq && aq === bq && rawSim >= .50) return true;
    if (aq && aq === bq && (a.score < 65 || b.score < 65) && rawSim >= .35) return true;
    return false;
  }
  function chooseBetter(a, b) {
    // Préfère la ligne la plus structurée : quantité + unité + score élevé.
    // Si les scores sont proches, on garde la première occurrence : c’est souvent
    // la variante OCR la plus lisible avant les répétitions des autres passes.
    const aw = a.score + (hasQty(a.line) ? 12 : 0) + (hasUnit(a.line) ? 8 : 0) - Math.max(0, a.line.length - 70) * .4;
    const bw = b.score + (hasQty(b.line) ? 12 : 0) + (hasUnit(b.line) ? 8 : 0) - Math.max(0, b.line.length - 70) * .4;
    if (Math.abs(bw - aw) <= 6) return a.index <= b.index ? a : b;
    return bw > aw ? b : a;
  }

  const rawLines = original
    .replace(/---\s*[^\n]*tesseract\s*---/gi, '\n')
    .replace(/[;]+/g, '\n')
    .split('\n');

  const preCandidates = rawLines
    .map((rawLine, rawIndex) => ({ rawIndex, line: baseCandidate(rawLine) }))
    .filter(x => x.line)
    .map((x, index) => ({ line: x.line, index, rawIndex: x.rawIndex, score: candidateScore(x.line) }));

  // v12.05 — Général : une recette OCR contient souvent un premier bloc propre,
  // puis une queue bruitée issue d'autres passes OCR. Après 4 ingrédients solides,
  // 3 lignes faibles consécutives indiquent très souvent cette queue bruitée.
  let strongSeen = 0;
  let weakAfterStrong = 0;
  let cutoffRawIndex = Infinity;
  for (const cand of preCandidates) {
    const strong = isStrongRecipeIngredient(cand.line, cand.score);
    if (strong) {
      strongSeen += 1;
      weakAfterStrong = 0;
      continue;
    }
    if (strongSeen >= 4) {
      weakAfterStrong += 1;
      if (weakAfterStrong >= 3) {
        cutoffRawIndex = cand.rawIndex - weakAfterStrong + 1;
        break;
      }
    }
  }

  const lines = preCandidates
    .filter(x => x.rawIndex < cutoffRawIndex)
    .filter(x => x.score >= 32)
    .filter(x => !looksLikeShortOcrJunkAfterQty(x.line))
    .filter(x => !(hasQty(x.line) && usefulIngredientTail(x.line) === 0))
    .filter(x => {
      const qty = hasQty(x.line);
      const unit = hasUnit(x.line);
      const tokens = wordsOf(x.line);
      if (qty || unit) return true;
      // Lignes sans quantité : seulement si elles sont très propres.
      return x.score >= 44 && tokens.length >= 1 && tokens.length <= 3 && vowelRatio(x.line) >= .30;
    });

  const merged = [];
  for (const cand of lines) {
    const existingIndex = merged.findIndex(prev => isDuplicate(prev, cand));
    if (existingIndex >= 0) {
      const chosen = chooseBetter(merged[existingIndex], cand);
      chosen.index = Math.min(merged[existingIndex].index, cand.index);
      merged[existingIndex] = chosen;
    } else {
      merged.push(cand);
    }
  }

  const finalLines = merged
    .sort((a, b) => a.index - b.index)
    .map(x => x.line)
    .slice(0, 20);

  return finalLines.join('\n');
}


function recipeSetStatus(msg, isError) {
  const el = document.getElementById('recipe-ai-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}

function extractJsonObjectFromText(txt) {
  const s = String(txt || '').trim();
  try { return JSON.parse(s); } catch(e) {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch(e) {}
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch(e) {}
  }
  throw new Error('Réponse IA non exploitable. Réessaie ou corrige la liste OCR.');
}

function normalizeRecipeAIResult(obj) {
  const per100 = obj.per100 || obj.pour_100g || obj.valeurs_100g || obj.nutrition_100g || {};
  const totals = obj.totals || obj.total || obj.recette_complete || obj.global || {};
  const num = v => {
    const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const rawIngredients = Array.isArray(obj.ingredients) ? obj.ingredients : (Array.isArray(obj.ingredients_detectes) ? obj.ingredients_detectes : []);
  const name = String(obj.name || obj.nom || obj.plat || obj.nom_plat || 'Recette maison').trim();
  const weight = Math.round(num(obj.final_weight_g ?? obj.poids_final_g ?? obj.poids_final_estime_g ?? obj.poids_g ?? totals.poids_g));
  const kcal100 = Math.round(num(per100.kcal ?? per100.calories ?? obj.kcal100));
  const prot100 = Math.round(num(per100.prot ?? per100.proteines ?? per100.protéines ?? obj.prot100) * 10) / 10;
  const gluc100 = Math.round(num(per100.gluc ?? per100.glucides ?? obj.gluc100) * 10) / 10;
  const lip100 = Math.round(num(per100.lip ?? per100.lipides ?? obj.lip100) * 10) / 10;
  const ingredients = rawIngredients.map(it => ({
    name: String(it.name || it.nom || it.ingredient || '').trim(),
    qty: Math.max(0, Math.round(num(it.qty ?? it.quantity ?? it.quantite ?? it.quantité ?? it.poids_g) * 10) / 10),
    unit: String(it.unit || it.unite || it.unité || 'g').slice(0, 24) || 'g',
    kcal100: Math.round(num(it.kcal100 ?? it.kcal_per_100g ?? it.kcal)),
    prot100: Math.round(num(it.prot100 ?? it.proteines100 ?? it.protéines100 ?? it.prot) * 10) / 10,
    gluc100: Math.round(num(it.gluc100 ?? it.glucides100 ?? it.gluc) * 10) / 10,
    lip100: Math.round(num(it.lip100 ?? it.lipides100 ?? it.lip) * 10) / 10,
    source: String(it.source || 'ia')
  })).filter(it => it.name && it.qty > 0);
  return {
    name,
    portions: Math.max(1, Math.round(num(obj.portions ?? obj.parts ?? obj.nb_portions) || 4)),
    weight,
    confidence: String(obj.confidence || obj.fiabilite || 'moyenne').trim(),
    kcal100,
    prot100,
    gluc100,
    lip100,
    totalKcal: Math.round(num(totals.kcal ?? totals.calories ?? obj.total_kcal)),
    totalProt: Math.round(num(totals.prot ?? totals.proteines ?? totals.protéines ?? obj.total_prot) * 10) / 10,
    totalGluc: Math.round(num(totals.gluc ?? totals.glucides ?? obj.total_gluc) * 10) / 10,
    totalLip: Math.round(num(totals.lip ?? totals.lipides ?? obj.total_lip) * 10) / 10,
    notes: String(obj.notes || obj.commentaire || obj.hypotheses || '').trim(),
    ingredients,
    raw_ai: obj
  };
}

async function estimateRecipeFromOCRText() {
  foodnoteBeginRecipePhotoWorkflow();
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) { alert('Les fonctions IA sont désactivées dans Options de l’application.'); return; }
  const textEl = document.getElementById('recipe-ocr-text');
  const raw = String(textEl?.value || '').trim();
  if (!raw) { recipeSetStatus('Aucune liste d’ingrédients à envoyer.', true); return; }
  const btn = document.querySelector('#recipe-ocr-result .recipe-ocr-actions .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ IA…'; }
  recipeSetStatus('IA : estimation du plat complet et des valeurs /100g…', false);
  const prompt = `Tu es un expert nutrition spécialisé recettes.
À partir de cette liste d’ingrédients OCR déjà filtrée, corrige les petites erreurs OCR restantes puis prépare une RECETTE FoodNote réutilisable.
FoodNote enregistre les recettes comme des aliments composés : nom, poids final, portions, valeurs /100g et ingrédients modifiables.
Estime le poids final si absent, sans demander à l’utilisateur de le peser.
Retourne uniquement un JSON valide, sans markdown, avec cette structure exacte :
{
  "nom": "Nom du plat",
  "portions": 4,
  "poids_final_estime_g": 850,
  "ingredients": [
    {"name":"pâtes cuites","qty":250,"unit":"g","kcal100":150,"prot100":5,"gluc100":30,"lip100":1,"source":"ia"}
  ],
  "totals": {"kcal": 1870, "proteines": 92, "glucides": 55, "lipides": 128},
  "per100": {"kcal": 220, "proteines": 10.8, "glucides": 6.5, "lipides": 15.1},
  "fiabilite": "faible|moyenne|haute",
  "notes": "hypothèses courtes"
}
Règles : valeurs réalistes, ingrédients en grammes quand possible, source="ia" si non relié à CIQUAL/OpenFoodFacts, kcal /100g maximum 950, macros /100g cohérentes, pas d’explication hors JSON.
Liste OCR :
${raw}`;
  try {
    const response = await callGroqChat(prompt, { max_tokens: 1400, temperature: 0.15 });
    const parsed = normalizeRecipeAIResult(extractJsonObjectFromText(response));
    fillRecipeAIForm(parsed);
    foodnoteBeginRecipePhotoWorkflow();
    recipeSetStatus('Estimation prête. Choisis ajout ponctuel au journal ou création d’une recette enregistrée.', false);
  } catch(e) {
    recipeSetStatus('Erreur IA recette : ' + (e.message || e), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Envoyer à l’IA'; }
  }
}

function fillRecipeAIForm(r) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val == null ? '' : val; };
  set('recipe-food-name', r.name || 'Recette maison');
  set('recipe-weight', r.weight || '');
  set('recipe-kcal', r.kcal100 || '');
  set('recipe-prot', r.prot100 || '');
  set('recipe-gluc', r.gluc100 || '');
  set('recipe-lip', r.lip100 || '');
  window.FoodNoteRecipeScanDraft = buildRecipeDraftFromAIResult(r);
  const totals = document.getElementById('recipe-ai-totals');
  if (totals) {
    const bits = [];
    if (r.weight) bits.push(`Poids final estimé : ${r.weight} g`);
    if (r.totalKcal) bits.push(`Total recette : ${r.totalKcal} kcal · ${r.totalProt || 0}g P · ${r.totalGluc || 0}g G · ${r.totalLip || 0}g L`);
    bits.push(`Fiabilité : ${r.confidence || 'moyenne'}`);
    if (r.notes) bits.push(r.notes);
    totals.textContent = bits.join(' — ');
  }
  const box = document.getElementById('recipe-ai-result');
  if (box) box.style.display = 'block';
  foodnoteSetRecipeWorkflowStep('ai_result');
  setTimeout(() => foodnoteReconcileRecipeWorkflow('ai-result-afterpaint'), 60);
  setTimeout(() => foodnoteReconcileRecipeWorkflow('ai-result-late'), 260);
  setFoodAddExpanded(true);
}


function buildRecipeDraftFromAIResult(r) {
  const rawText = String(document.getElementById('recipe-ocr-text')?.value || '').trim();
  const photo = window.FoodNoteRecipeScanPhotoData || foodRecipeCropPhotoDataUrl || '';
  const weight = Math.max(0, Number(r.weight || 0));
  let ingredients = Array.isArray(r.ingredients) ? r.ingredients.slice() : [];
  if (!ingredients.length && weight > 0) {
    ingredients = [{
      name: r.name || 'Recette estimée IA',
      qty: weight,
      unit: 'g',
      kcal100: r.kcal100 || 0,
      prot100: r.prot100 || 0,
      gluc100: r.gluc100 || 0,
      lip100: r.lip100 || 0,
      source: 'ia'
    }];
  }
  return {
    name: r.name || 'Recette maison',
    portions: r.portions || 4,
    total_weight: weight || ingredients.reduce((sum, it) => sum + (Number(it.qty) || 0), 0),
    photo_data: photo,
    source: 'ia',
    creation_source: photo ? 'photo_scan' : 'ia_import',
    is_ai_estimated: true,
    raw_scan_text: rawText,
    ai_estimation_json: r.raw_ai || r,
    notes: ['Import scan/photo IA', r.confidence ? ('fiabilité : ' + r.confidence) : '', r.notes || ''].filter(Boolean).join(' — '),
    ingredients: ingredients.map(it => ({ ...it, source: it.source || 'ia' }))
  };
}

function importRecipeAIToRecipes() {
  const draft = window.FoodNoteRecipeScanDraft;
  if (!draft) { recipeSetStatus('Aucune estimation IA à importer.', true); return; }
  try {
    if (window.FoodNoteRecipes && typeof window.FoodNoteRecipes.importScanDraft === 'function') {
      window.FoodNoteRecipes.importScanDraft(draft);
      recipeSetStatus('Recette transférée dans la section Recettes. Vérifie puis enregistre.', false);
      return;
    }
    localStorage.setItem('foodnote_pending_recipe_scan_draft', JSON.stringify(draft));
    if (typeof showPage === 'function') showPage('recettes', document.getElementById('nav-recettes'));
    recipeSetStatus('Recette transférée dans la section Recettes. Vérifie puis enregistre.', false);
  } catch(e) {
    recipeSetStatus('Import vers Recettes impossible : ' + (e.message || e), true);
  }
}

function getRecipeFoodPayload() {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.readRecipeFoodPayload === 'function') {
    return window.FoodNoteFoodAddDomain.readRecipeFoodPayload();
  }
  const val = id => document.getElementById(id)?.value;
  const num = id => {
    const n = parseFloat(String(val(id) || '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const name = String(val('recipe-food-name') || '').trim();
  if (!name) { alert('Nom du plat manquant.'); return null; }
  return {
    id: Date.now(),
    nom: name,
    kcal100: Math.round(num('recipe-kcal')),
    prot100: Math.round(num('recipe-prot') * 10) / 10,
    gluc100: Math.round(num('recipe-gluc') * 10) / 10,
    lip100: Math.round(num('recipe-lip') * 10) / 10,
    unite: 'g',
    source: 'recette_ia',
    recipeWeight: Math.round(num('recipe-weight')) || null,
    recipeText: String(document.getElementById('recipe-ocr-text')?.value || '').trim()
  };
}

function saveRecipeFoodToBDD(addToDay) {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.saveRecipeFood === 'function') {
    return window.FoodNoteFoodAddDomain.saveRecipeFood(!!addToDay);
  }
  const food = getRecipeFoodPayload();
  if (!food) return;
  if (typeof foodnoteValidateFoodBeforeSave === 'function' && !foodnoteValidateFoodBeforeSave(food, {title:'Recette IA : valeur nutritionnelle suspecte'})) return;
  const bdd = getBDD();
  const key = normalizeSearchText(food.nom);
  const idx = bdd.findIndex(b => normalizeSearchText(b.nom) === key);
  const saved = { ...food, id: idx >= 0 ? (bdd[idx].id || food.id) : food.id };
  if (idx >= 0) bdd[idx] = { ...bdd[idx], ...saved };
  else bdd.unshift(saved);
  saveBDD(bdd);
  refreshDBSelect && refreshDBSelect();
  if (typeof renderBDD === 'function') renderBDD();
  if (addToDay) {
    const qty = parseFloat(document.getElementById('db-qty')?.value) || 100;
    addCustomAliment({ ...saved, defaut: qty, bddId: saved.id, meal: (typeof foodAddTargetMeal !== 'undefined' ? foodAddTargetMeal : 'lunch') });
    recipeSetStatus('Plat estimé ajouté à la journée.', false);
    closeFoodAddModal && setTimeout(closeFoodAddModal, 180);
  } else {
    recipeSetStatus('Plat estimé créé dans ta base. Tu peux l’ajouter au journal.', false);
  }
}

function getOCRFoodPayload() {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.readOCRFoodPayload === 'function') {
    return window.FoodNoteFoodAddDomain.readOCRFoodPayload();
  }
  const val = id => document.getElementById(id)?.value;
  const num = id => {
    const n = parseFloat(String(val(id) || '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const name = (val('ocr-food-name') || '').trim();
  if (!name) { alert('Nom de l’aliment manquant.'); return null; }
  return {
    id: Date.now(),
    nom: name,
    kcal100: num('ocr-kcal'),
    prot100: num('ocr-prot'),
    gluc100: num('ocr-gluc'),
    lip100: num('ocr-lip'),
    fibres100: num('ocr-fibres'),
    unite: 'g',
    source: 'ocr'
  };
}

function saveOCRFoodToBDD(addToDay) {
  if (window.FoodNoteFoodAddDomain && typeof window.FoodNoteFoodAddDomain.saveOCRFood === 'function') {
    return window.FoodNoteFoodAddDomain.saveOCRFood(!!addToDay);
  }
  const food = getOCRFoodPayload();
  if (!food) return;
  if (!foodnoteValidateFoodBeforeSave(food, {title:'OCR : valeur nutritionnelle suspecte'})) return;
  const bdd = getBDD();
  const key = normalizeSearchText(food.nom);
  const idx = bdd.findIndex(b => normalizeSearchText(b.nom) === key);
  if (idx >= 0) bdd[idx] = { ...bdd[idx], ...food, id: bdd[idx].id || food.id };
  else bdd.unshift(food);
  saveBDD(bdd);
  refreshDBSelect && refreshDBSelect();
  if (typeof renderBDD === 'function') renderBDD();
  if (addToDay) {
    const qty = parseFloat(document.getElementById('db-qty')?.value) || 100;
    addCustomAliment({ ...food, defaut: qty, bddId: idx >= 0 ? bdd[idx].id : food.id });
    closeFoodAddModal && setTimeout(closeFoodAddModal, 120);
  } else {
    setOCRStatus('Ajouté à ta base. Tu peux le rechercher dans Aliment.', false);
  }
}
