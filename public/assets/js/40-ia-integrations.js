/*
 * FoodNote — intégrations IA / Groq.
 * Rôle : gérer l’estimation texte, le parsing des retours IA, le proxy Groq et le compteur serveur de tokens avec limites Groq visibles.
 * Gère : modèle choisi, appels Groq texte, prévisualisation IA, résumé SQLite de consommation par modèle.
 * Ne doit pas gérer : capture caméra/photo plat, écriture SQLite directe, stockage de clé brute côté navigateur si le proxy serveur est disponible.
 */
const FOODNOTE_GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

function fnIAEscape(value) {
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function fnIARound1(value) { const n = Number(value) || 0; return Math.round(n * 10) / 10; }

function fnUISearchStatus(message, tone = '') {
  const toneCls = tone ? ' fn-ui-search-status-' + String(tone).replace(/[^a-z0-9_-]/gi, '') : '';
  return `<div class="fn-ui-search-status${toneCls}">${fnIAEscape(message)}</div>`;
}
function fnUISearchStatusHTML(html, tone = '') {
  const toneCls = tone ? ' fn-ui-search-status-' + String(tone).replace(/[^a-z0-9_-]/gi, '') : '';
  return `<div class="fn-ui-search-status${toneCls}">${String(html || '')}</div>`;
}
function fnUISearchResultRow(opts = {}) {
  const tone = opts.tone === 'ciq' ? ' fn-ui-search-kcal-ciq' : '';
  const meta = opts.metaHtml ? `<div class="fn-ui-search-meta">${opts.metaHtml}</div>` : '';
  return `<div class="fn-ui-row fn-ui-row--search fn-ui-search-row" onclick="${fnIAEscape(opts.onclick || '')}">
    <div class="fn-ui-search-main">
      <div class="fn-ui-search-title" title="${fnIAEscape(opts.title || '')}">${fnIAEscape(opts.title || '')}</div>
      ${meta}
    </div>
    <div class="fn-ui-search-side">
      <div class="fn-ui-search-kcal${tone}">🔥 ${fnIAEscape(opts.kcal ?? 0)} kcal</div>
      <div>${opts.macroHtml || '—'}</div>
      <div class="fn-ui-search-foot">${fnIAEscape(opts.foot || '/100g')}</div>
    </div>
  </div>`;
}
function fnIANormalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
function fnIASafeLocalGet(key, fallback = '') {
  try { if (typeof safeLocalGet === 'function') return safeLocalGet(key, fallback); const v = localStorage.getItem(key); return v == null ? fallback : v; } catch(e) { return fallback; }
}
function fnIASafeLocalSet(key, value) {
  try { if (typeof safeLocalSet === 'function') safeLocalSet(key, value); else localStorage.setItem(key, value); } catch(e) {}
}

// Compteur Groq serveur : partagé entre appareils car il est lu depuis SQLite.
// Le navigateur ne compte plus lui-même les tokens ; il rafraîchit simplement le résumé serveur.
const FOODNOTE_GROQ_LIMITS_UPDATED_AT = '2026-05-31';
let fnIAGroqUsageSummaryCache = null;
let fnIAGroqUsageLoading = false;

function fnIAUsageNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function fnIANormalizeUsagePayload(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = fnIAUsageNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens);
  const completion = fnIAUsageNumber(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens);
  const total = fnIAUsageNumber(usage.total_tokens ?? usage.totalTokens ?? (prompt + completion));
  const normalized = {
    prompt_tokens: Math.round(prompt),
    completion_tokens: Math.round(completion),
    total_tokens: Math.round(total || prompt + completion)
  };
  return normalized.total_tokens > 0 || normalized.prompt_tokens > 0 || normalized.completion_tokens > 0 ? normalized : null;
}
function fnIAFormatInt(value) {
  return Math.round(Number(value) || 0).toLocaleString('fr-FR');
}
function fnIAFormatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / 1024 / 1024).toFixed(2).replace('.', ',') + ' Mo';
}
function fnIAUsageRatioHtml(used, limit, unitLabel) {
  const u = Number(used || 0);
  const l = Number(limit || 0);
  if (!l) return `<span class="fn-ui-mini-badge">${fnIAFormatInt(u)} / limite inconnue ${fnIAEscape(unitLabel || '')}</span>`;
  const pct = Math.max(0, Math.min(999, Math.round(u * 1000 / l) / 10));
  const tone = pct >= 95 ? 'bad' : pct >= 75 ? 'warn' : 'ok';
  return `<span class="fn-ui-mini-badge fn-ui-mini-badge-${tone}">${fnIAFormatInt(u)} / ${fnIAFormatInt(l)} ${fnIAEscape(unitLabel || '')}</span>`;
}
async function fnIALoadGroqUsageSummary(options = {}) {
  const el = document.getElementById('groq-token-counter');
  if (fnIAGroqUsageLoading && !options.force) return fnIAGroqUsageSummaryCache;
  fnIAGroqUsageLoading = true;
  if (el && !fnIAGroqUsageSummaryCache) el.innerHTML = '<div class="fn-ui-muted">Chargement consommation Groq…</div>';
  try {
    const headers = (typeof apiUserHeaders === 'function') ? apiUserHeaders({'Accept':'application/json'}) : {'Accept':'application/json'};
    const res = await fetch('/api/groq/usage', { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Compteur Groq indisponible');
    fnIAGroqUsageSummaryCache = data;
  } catch (e) {
    fnIAGroqUsageSummaryCache = { ok:false, error:e.message || String(e), total:{calls:0,total_tokens:0,prompt_tokens:0,completion_tokens:0}, models:[] };
  } finally {
    fnIAGroqUsageLoading = false;
    fnIARenderTokenCounter();
  }
  return fnIAGroqUsageSummaryCache;
}
function fnIARecordGroqUsage(meta = {}) {
  // Les appels proxy serveur enregistrent déjà usage dans SQLite.
  // Pour un appel direct navigateur éventuel, on affiche au moins la dernière usage localement puis on retente le résumé serveur.
  if (meta?.usage_summary && meta.usage_summary.ok) fnIAGroqUsageSummaryCache = meta.usage_summary;
  setTimeout(() => fnIALoadGroqUsageSummary({ force:true }), 250);
  return fnIANormalizeUsagePayload(meta.usage || meta);
}
function fnIAUsageMinuteLimitsHtml(model) {
  const tpm = Number(model.limit_tokens_minute || 0);
  const rpm = Number(model.limit_calls_minute || 0);
  if (!tpm && !rpm) return '';
  const bits = [];
  if (tpm) bits.push(`${fnIAFormatInt(tpm)} TPM`);
  if (rpm) bits.push(`${fnIAFormatInt(rpm)} RPM`);
  return `<div class="fn-ui-limit-line fn-ui-limit-line-muted">Limites Groq actuelles : ${bits.join(' · ')}</div>`;
}
function fnIAUsageModelRow(model) {
  const label = model.label || model.model || 'Modèle Groq';
  const modelId = model.normalized_model || model.model || '';
  return `<div class="fn-ui-row fn-ui-row--search fn-ui-groq-usage-row">
    <div class="fn-ui-search-main">
      <div class="fn-ui-search-title">${fnIAEscape(label)}</div>
      <div class="fn-ui-search-meta">${fnIAEscape(modelId)}${model.plan ? ' · ' + fnIAEscape(model.plan) : ''}</div>
      <div class="fn-ui-limit-line">Tokens jour : ${fnIAUsageRatioHtml(model.total_tokens, model.limit_tokens_day, 'tokens')}</div>
      <div class="fn-ui-limit-line">Appels jour : ${fnIAUsageRatioHtml(model.calls, model.limit_calls_day, 'appels')}</div>
      ${fnIAUsageMinuteLimitsHtml(model)}
    </div>
  </div>`;
}
function fnIARenderTokenCounter() {
  const el = document.getElementById('groq-token-counter');
  if (!el) return;
  const data = fnIAGroqUsageSummaryCache;
  if (!data) {
    el.innerHTML = '<div class="fn-ui-muted">Chargement consommation Groq…</div>';
    fnIALoadGroqUsageSummary();
    return;
  }
  if (data.ok === false) {
    el.innerHTML = `<div class="fn-ui-alert fn-ui-alert-warn"><div class="fn-ui-alert-icon">⚠️</div><div><b>Compteur Groq indisponible</b><p>${fnIAEscape(data.error || 'Erreur inconnue')}</p></div></div>`;
    return;
  }
  const models = Array.isArray(data.models) ? data.models : [];
  el.innerHTML = `
    <div class="fn-ui-stack">
      ${models.length ? models.map(fnIAUsageModelRow).join('') : '<div class="fn-ui-muted">Aucune consommation Groq enregistrée aujourd’hui.</div>'}
    </div>
    <p class="fn-ui-muted">Compteur SQLite commun à tous les appareils · limites Groq intégrées datées du ${fnIAEscape(data.limits_updated_at || FOODNOTE_GROQ_LIMITS_UPDATED_AT)}.</p>
    <div class="fn-ui-actions fn-ui-actions-tight">
      <button type="button" class="fn-ui-button" onclick="fnIALoadGroqUsageSummary({force:true})">Rafraîchir</button>
      <button type="button" class="fn-ui-button" onclick="fnIAResetTokenUsage()">Réinitialiser aujourd’hui</button>
    </div>`;
}
async function fnIAResetTokenUsage() {
  if (!confirm('Réinitialiser le compteur Groq du jour dans SQLite ? Ce sera visible sur tous les appareils.')) return;
  try {
    const headers = (typeof apiUserHeaders === 'function') ? apiUserHeaders({'Accept':'application/json'}) : {'Accept':'application/json'};
    const res = await fetch('/api/groq/usage?scope=today', { method:'DELETE', headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Réinitialisation impossible');
    fnIAGroqUsageSummaryCache = data;
    fnIARenderTokenCounter();
  } catch (e) { alert(e.message || String(e)); }
}

function fnIAIsPageContext(context) {
  if (context === 'page') return true;
  if (context === 'modal') return false;
  const page = document.getElementById('page-ia');
  const pageInput = document.getElementById('ia-estimate-text');
  return !!(page && page.classList.contains('active') && pageInput);
}
function fnIAEls(context) {
  const pageMode = fnIAIsPageContext(context);
  return {
    context: pageMode ? 'page' : 'modal',
    input: pageMode ? document.getElementById('ia-estimate-text') : (document.getElementById('f-ia-paste') || document.getElementById('db-search')),
    fallbackInput: document.getElementById('db-search'),
    response: pageMode ? document.getElementById('groq-page-response') : document.getElementById('groq-response'),
    preview: pageMode ? document.getElementById('ia-page-preview') : document.getElementById('ia-preview'),
    status: pageMode ? document.getElementById('ia-page-parse-status') : document.getElementById('ia-parse-status'),
    button: pageMode ? document.getElementById('btn-page-groq') : (document.getElementById('food-main-action-btn') || document.getElementById('btn-groq'))
  };
}
function fnIAGetText(context) {
  const els = fnIAEls(context);
  const primary = (els.input && els.input.value || '').trim();
  const fallback = (els.fallbackInput && els.fallbackInput.value || '').trim();
  return { els, text: primary || fallback };
}
function fnIASetStatus(message, ok = null, context) {
  const el = fnIAEls(context || window._iaLastContext).status || document.getElementById('ia-parse-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList && el.classList.remove('ok', 'warn', 'bad');
  if (ok === true) el.classList && el.classList.add('ok');
  else if (ok === false) el.classList && el.classList.add('bad');
  else if (message) el.classList && el.classList.add('warn');
  el.style.color = ok === true ? 'var(--green)' : (ok === false ? 'var(--red)' : '');
}
function setParseStatus(msg, ok) { fnIASetStatus(msg, ok); }
function fnIASetGroqStatus(message, ok = null) {
  const el = document.getElementById('groq-key-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList && el.classList.remove('ok', 'warn', 'bad');
  if (ok === true) el.classList && el.classList.add('ok');
  else if (ok === false) el.classList && el.classList.add('bad');
  else if (message) el.classList && el.classList.add('warn');
  el.style.color = ok === true ? 'var(--green)' : (ok === false ? 'var(--red)' : '');
}
function fnIAGetModel() {
  const input = document.getElementById('groq-model-input');
  const model = (input && input.value.trim()) || fnIASafeLocalGet('groq_model', FOODNOTE_GROQ_DEFAULT_MODEL) || FOODNOTE_GROQ_DEFAULT_MODEL;
  return model.trim();
}
function fnIALoadModel() {
  fnIARenderTokenCounter();
  const input = document.getElementById('groq-model-input');
  if (!input) return;
  if (!input.value) input.value = fnIASafeLocalGet('groq_model', FOODNOTE_GROQ_DEFAULT_MODEL) || FOODNOTE_GROQ_DEFAULT_MODEL;
  if (input.dataset.boundGroqModel !== '1') {
    input.dataset.boundGroqModel = '1';
    input.addEventListener('change', () => fnIASafeLocalSet('groq_model', input.value.trim() || FOODNOTE_GROQ_DEFAULT_MODEL));
  }
}
function parseIANumber(value) {
  if (value === null || value === undefined) return NaN;
  const clean = String(value).replace(/\u00a0/g, ' ').replace(/,/g, '.').replace(/[^0-9.\-]/g, '').replace(/(\..*)\./g, '$1');
  return parseFloat(clean);
}
function sanitizeIAFoodRow(row) {
  const nom = String(row.nom || '').replace(/^[-*•\s]+/, '').trim();
  const qty = parseIANumber(row.qty), kcal = parseIANumber(row.kcal), prot = parseIANumber(row.prot), gluc = parseIANumber(row.gluc), lip = parseIANumber(row.lip);
  if (!nom || /^(nom|aliment|food|total)$/i.test(nom)) return null;
  if (![qty, kcal, prot, gluc, lip].every(Number.isFinite)) return null;
  if (qty <= 0 || kcal < 0 || prot < 0 || gluc < 0 || lip < 0) return null;
  if (qty > 5000 || kcal > 6000 || prot > 600 || gluc > 1200 || lip > 800) return null;
  return { nom, qty: fnIARound1(qty), kcal: Math.round(kcal), prot: fnIARound1(prot), gluc: fnIARound1(gluc), lip: fnIARound1(lip) };
}
function parseIANutritionTable(raw) {
  const text = String(raw || '').replace(/```(?:markdown|text|csv)?/gi, '').replace(/```/g, '').trim();
  const rows = [], seen = new Set();
  text.split(/\r?\n/).forEach(line => {
    let l = line.trim();
    if (!l || /^\|?\s*:?-{2,}/.test(l)) return;
    l = l.replace(/^\|/, '').replace(/\|$/, '').trim();
    if (!l.includes('|')) return;
    const cols = l.split('|').map(c => c.trim());
    if (cols.length < 5) return;
    const joined = cols.join(' ').toLowerCase();
    if (joined.includes('quant') && (joined.includes('prot') || joined.includes('kcal'))) return;
    const row = sanitizeIAFoodRow({ nom: cols[0], qty: cols[1], kcal: cols[2], prot: cols[3], gluc: cols[4], lip: cols[5] || 0 });
    if (!row) return;
    const key = fnIANormalizeText(row.nom) + '|' + row.qty + '|' + row.kcal;
    if (!seen.has(key)) { seen.add(key); rows.push(row); }
  });
  if (rows.length) return rows;
  text.split(/\r?\n/).forEach(line => {
    const l = line.trim(); if (!l) return;
    const nums = [...l.matchAll(/-?\d+(?:[,.]\d+)?/g)].map(m => m[0]);
    if (nums.length < 5) return;
    const first = l.search(/-?\d+(?:[,.]\d+)?/);
    const nom = l.slice(0, first).replace(/[|:;,-]+$/g, '').trim();
    const row = sanitizeIAFoodRow({ nom, qty: nums[0], kcal: nums[1], prot: nums[2], gluc: nums[3], lip: nums[4] });
    if (row) rows.push(row);
  });
  return rows;
}
function iaRowToPer100(row) {
  const f = row.qty > 0 ? 100 / row.qty : 0;
  return { kcal100: Math.round(row.kcal * f), prot100: fnIARound1(row.prot * f), gluc100: fnIARound1(row.gluc * f), lip100: fnIARound1(row.lip * f) };
}
function fnIASelectedMeal() {
  const ctx = window._iaLastContext || (fnIAIsPageContext() ? 'page' : 'modal');
  const sel = ctx === 'page' ? document.getElementById('ia-meal-select') : null;
  const raw = sel && sel.value ? sel.value : (typeof foodAddTargetMeal !== 'undefined' ? foodAddTargetMeal : 'lunch');
  return (typeof normalizeMealId === 'function') ? normalizeMealId(raw) : (raw || 'lunch');
}
function renderIAPreview(rows, raw = '', context) {
  const els = fnIAEls(context || window._iaLastContext);
  window._iaLastContext = els.context;
  const preview = els.preview;
  if (!preview) return;
  window._iaParsed = rows || [];
  if (!rows || !rows.length) {
    preview.style.display = 'block';
    preview.innerHTML = '<div class="fn-ui-ia-empty">Aucun aliment détecté. Format conseillé : Nom | Quantité (g) | Kcal | Protéines | Glucides | Lipides.</div>';
    fnIASetStatus('Aucun aliment détecté.', false, els.context);
    return;
  }
  const total = rows.reduce((acc,r) => { acc.kcal += r.kcal; acc.prot += r.prot; acc.gluc += r.gluc; acc.lip += r.lip; return acc; }, {kcal:0, prot:0, gluc:0, lip:0});
  preview.style.display = 'block';
  preview.innerHTML = `
    <div class="fn-ui-ia-preview-head">
      <div><div class="fn-ui-ia-preview-title">Prévisualisation avant import</div><div class="fn-ui-ia-preview-sub">${rows.length} aliment${rows.length > 1 ? 's' : ''} détecté${rows.length > 1 ? 's' : ''}. Tu peux ajouter ligne par ligne ou tout importer.</div></div>
      <div class="fn-ui-ia-total">${Math.round(total.kcal)} kcal · ${fnIARound1(total.prot)}g P · ${fnIARound1(total.gluc)}g G · ${fnIARound1(total.lip)}g L</div>
    </div>
    <div class="fn-ui-ia-list">
      ${rows.map((r,i) => `<div class="fn-ui-ia-result" id="ia-result-${i}"><div class="fn-ui-ia-result-main"><div class="fn-ui-ia-result-name">${fnIAEscape(r.nom)}</div><div class="fn-ui-ia-result-meta">${r.qty}g · ${r.kcal} kcal · ${r.prot}g P · ${r.gluc}g G · ${r.lip}g L</div></div><button type="button" class="fn-ui-button" onclick="confirmIAItem(${i})" id="ia-btn-${i}">+ Ajouter</button></div>`).join('')}
    </div>
    <div class="fn-ui-actions">
      <button type="button" class="fn-ui-button fn-ui-button-primary" onclick="confirmAllIAItems(${rows.length})">Tout ajouter</button>
      <button type="button" class="fn-ui-button" onclick="hideIAPreview()">Annuler</button>
      ${raw ? '<button type="button" class="fn-ui-button" onclick="toggleIARawResponse()">Voir réponse brute</button>' : ''}
    </div>
    ${raw ? `<pre id="ia-raw-response" class="fn-ui-code-log fn-ui-ia-raw" style="display:none">${fnIAEscape(raw)}</pre>` : ''}`;
  fnIASetStatus(rows.length + ' aliment(s) prêts à importer.', true, els.context);
}
function toggleIARawResponse() { const el = document.getElementById('ia-raw-response'); if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
function hideIAPreview() { const els = fnIAEls(window._iaLastContext); if (els.preview) els.preview.style.display = 'none'; fnIASetStatus('', null, els.context); }
function clearIAEstimator(context) {
  const els = fnIAEls(context || window._iaLastContext);
  if (els.input) els.input.value = '';
  if (els.response) { els.response.innerHTML = ''; els.response.style.display = 'none'; }
  if (els.preview) { els.preview.innerHTML = ''; els.preview.style.display = 'none'; }
  window._groqReponse = ''; window._iaParsed = [];
  fnIASetStatus('', null, els.context);
}
function parseIAPaste(context) {
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) { alert('Les fonctions IA sont désactivées dans Options de l’application.'); return; }
  const { els, text } = fnIAGetText(context);
  const raw = ((window._groqReponse || '') || text || '').trim();
  if (!raw) { fnIASetStatus('Aucun résultat IA à importer.', false, els.context); return; }
  renderIAPreview(parseIANutritionTable(raw), raw, els.context);
}
function confirmIAItem(i) {
  const r = window._iaParsed?.[i];
  if (!r) return;
  const per100 = iaRowToPer100(r);
  const meal = fnIASelectedMeal();
  const guardFood = { nom:r.nom, defaut:r.qty, unite:'g', meal, ...per100 };
  if (typeof foodnoteValidateFoodBeforeSave === 'function' && !foodnoteValidateFoodBeforeSave(guardFood, { qty:r.qty, title:'IA/Groq : valeur nutritionnelle suspecte' })) return;
  try {
    if (typeof addCustomAliment === 'function') addCustomAliment({ ...guardFood, cat:'custom', source:'ia', bddId:null });
    else throw new Error('addCustomAliment indisponible');
    // 0.22.118 : addCustomAliment déclenche déjà sauvegarde/rendu différés.
    // Ne relance pas updateMacros + autosave en synchrone pendant le clic IA.
    if (!(Date.now() < Number(window.__foodnoteJournalAddCriticalUntil || 0))) {
      if (typeof updateMacros === 'function') updateMacros();
      if (typeof autoSaveToday === 'function') autoSaveToday();
    } else {
      setTimeout(() => { try { if (typeof updateMacros === 'function') updateMacros(); } catch(e) {} }, 320);
      if (typeof autoSaveToday === 'function') autoSaveToday(420);
    }
    const btn = document.getElementById('ia-btn-' + i); if (btn) { btn.textContent = '✓ Ajouté'; btn.disabled = true; }
    const card = document.getElementById('ia-result-' + i); if (card) card.classList.add('done');
    if (typeof showSaveStatus === 'function') showSaveStatus('✓ Ajouté : ' + r.nom);
  } catch(e) {
    fnIASetStatus('Import impossible : ' + (e.message || e), false);
  }
}
function confirmAllIAItems(n) {
  for (let i = 0; i < n; i++) confirmIAItem(i);
  const els = fnIAEls(window._iaLastContext);
  if (els.input) els.input.value = '';
  window._groqReponse = '';
  fnIASetStatus('Tous les aliments IA ont été ajoutés.', true, els.context);
}

function toggleCIQSearch(idx) {
  document.querySelectorAll('[id^="ciq-row-"],[id^="off-row-"],[id^="ia-row-"]').forEach(el => {
    if (el.id !== 'ciq-row-' + idx) el.style.display = 'none';
  });
  const row = document.getElementById('ciq-row-' + idx);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) {
    const nomEl = document.getElementById('row-' + idx)?.querySelector('.aliment-name');
    const input = document.getElementById('ciq-search-' + idx);
    if (input && nomEl) input.value = nomEl.textContent.trim();
    setTimeout(() => {
      input?.focus();
      if (input?.value) searchCIQ(idx);
    }, 80);
  }
}

async function searchCIQ(idx) {
  const input = document.getElementById('ciq-search-' + idx);
  const results = document.getElementById('ciq-results-' + idx);
  if (!input || !results) return;
  const q = input.value.trim();
  if (!q) return;

  results.style.display = 'block';
  results.innerHTML = fnUISearchStatus('Recherche CIQUAL...');

  try {
    const r = await fetch('/api/ciqual/data?q=' + encodeURIComponent(q));
    const data = await readJSONResponse(r, 'CIQUAL');

    if (data.error) {
      results.innerHTML = fnUISearchStatus(data.error, 'warn');
      return;
    }

    const products = Array.isArray(data) ? data : (data.products || []);
    if (!products.length) {
      results.innerHTML = fnUISearchStatus('Aucun résultat CIQUAL — essaie un autre terme');
      return;
    }

    results.innerHTML = products.map(p => {
      const nf = (typeof normalizeFoodNutritionFromExternal === 'function')
        ? normalizeFoodNutritionFromExternal(p, 'ciq')
        : {
            nom: p.nom || p.name || 'Inconnu',
            kcal100: Math.round(p.kcal100 || p.kcal || 0),
            prot100: Math.round(((p.prot100 ?? p.prot ?? p.proteines ?? 0) || 0) * 10) / 10,
            gluc100: Math.round(((p.gluc100 ?? p.gluc ?? p.glucides ?? 0) || 0) * 10) / 10,
            lip100: Math.round(((p.lip100 ?? p.lip ?? p.lipides ?? 0) || 0) * 10) / 10,
            meta: p.groupe || ''
          };
      const nom = nf.nom || 'Inconnu';
      const groupe = nf.meta || p.groupe || '';
      const kcal = Math.round(nf.kcal100 || 0);
      const prot = nf.prot100;
      const gluc = nf.gluc100;
      const lip  = nf.lip100;
      const fibres = (p.fibres100 ?? p.fibres) != null ? Math.round((p.fibres100 ?? p.fibres) * 10) / 10 : null;
      if (!kcal) return '';
      const safenom = nom.substring(0,40).split("'").join('').split('"').join('');
      const pStr = prot ?? 0, gStr = gluc ?? 0, lStr = lip ?? 0;
      const macroStr = [
        prot  != null ? '🍖 ' + prot  + 'g' : null,
        gluc  != null ? '🍞 ' + gluc  + 'g' : null,
        lip   != null ? '🥑 ' + lip   + 'g' : null,
        fibres != null ? '🌾 ' + fibres + 'g' : null,
      ].filter(Boolean).join(' · ');
      return fnUISearchResultRow({
        onclick: `applyOFF(${idx},'${safenom}',${kcal},${pStr},${gStr},${lStr})`,
        title: nom,
        metaHtml: groupe ? fnIAEscape(groupe) : '',
        kcal,
        macroHtml: fnIAEscape(macroStr || '—'),
        foot: '/100g · ANSES',
        tone: 'ciq'
      });
    }).filter(Boolean).join('');
  } catch(e) {
    console.warn('Recherche CIQUAL indisponible:', e);
    const qn = normalizeSearchText(q);
    const fallback = CIQUAL_AUTOCOMPLETE_FALLBACK
      .filter(item => normalizeSearchText(item.nom).includes(qn))
      .slice(0, 6);
    if (fallback.length) {
      results.innerHTML = fallback.map(p => {
        const nom = p.nom || 'Inconnu';
        const kcal = Math.round(p.kcal100 || 0);
        const prot = round1(p.prot100 || 0);
        const gluc = round1(p.gluc100 || 0);
        const lip = round1(p.lip100 || 0);
        const safenom = nom.substring(0,40).split("'").join('').split('"').join('');
        return fnUISearchResultRow({
          onclick: `applyOFF(${idx},'${safenom}',${kcal},${prot},${gluc},${lip})`,
          title: nom,
          metaHtml: '<span class="fn-ui-text-soft">Fallback local CIQUAL</span>',
          kcal,
          macroHtml: fnIAEscape(`🍖 ${prot}g · 🍞 ${gluc}g · 🥑 ${lip}g`),
          foot: '/100g · CIQUAL',
          tone: 'ciq'
        });
      }).join('');
    } else {
      results.innerHTML = fnUISearchStatus('CIQUAL local ne renvoie pas du JSON. L’endpoint /api/ciqual/data retourne probablement une page HTML. Import CIQUAL ou désactive le backend local.', 'warn');
    }
  }
}

// Recherche CIQUAL avec Entrée
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  const active = document.activeElement;
  if (active?.id?.startsWith('ciq-search-')) searchCIQ(active.id.replace('ciq-search-', ''));
});

function toggleOFFSearch(idx) {
  document.querySelectorAll('[id^="off-row-"],[id^="ia-row-"],[id^="ciq-row-"]').forEach(el => {
    if (el.id !== 'off-row-' + idx) el.style.display = 'none';
  });
  const row = document.getElementById('off-row-' + idx);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) {
    const nomEl = document.getElementById('row-' + idx)?.querySelector('.aliment-name');
    const input = document.getElementById('off-search-' + idx);
    if (input && nomEl) input.value = nomEl.textContent.trim();
    setTimeout(() => {
      input?.focus();
      if (input?.value) searchOFF(idx);
    }, 80);
  }
}

async function searchOFF(idx) {
  const input = document.getElementById('off-search-' + idx);
  const results = document.getElementById('off-results-' + idx);
  if (!input || !results) return;
  const q = input.value.trim();
  if (!q) return;

  results.style.display = 'block';
  results.innerHTML = fnUISearchStatus('Recherche en cours...');

  try {
    const r = await fetch('/api/off/search?q=' + encodeURIComponent(q));
    if (!r.ok) {
      const err = await r.json();
      results.innerHTML = fnUISearchStatus(err.error || 'Erreur serveur', 'danger');
      return;
    }
    const data = await r.json();
    const products = Array.isArray(data) ? data : (data.products || []);

    if (!products.length) {
      results.innerHTML = fnUISearchStatus('Aucun résultat — essaie un autre terme');
      return;
    }

    results.innerHTML = products.map(p => {
      const nom = p.nom || 'Inconnu';
      const marque = p.marque || '';
      const kcal = Math.round(p.kcal100 || p.kcal || 0);
      const prot = (p.prot100 ?? p.prot) != null ? Math.round((p.prot100 ?? p.prot) * 10) / 10 : null;
      const gluc = (p.gluc100 ?? p.gluc) != null ? Math.round((p.gluc100 ?? p.gluc) * 10) / 10 : null;
      const lip  = (p.lip100  ?? p.lip)  != null ? Math.round((p.lip100  ?? p.lip)  * 10) / 10 : null;
      const fibres = (p.fibres100 ?? p.fibres) != null ? Math.round((p.fibres100 ?? p.fibres) * 10) / 10 : null;
      if (!kcal) return '';
      const safenom = (nom||'').substring(0,40).split("'").join('').split('"').join('');
      const macroStr = [
        prot  != null ? '🍖 ' + prot  + 'g' : null,
        gluc  != null ? '🍞 ' + gluc  + 'g' : null,
        lip   != null ? '🥑 ' + lip   + 'g' : null,
        fibres != null ? '🌾 ' + fibres + 'g' : null,
      ].filter(Boolean).join(' · ');
      const complete = prot != null && gluc != null && lip != null;
      const pStr  = prot  ?? 0;
      const gStr  = gluc  ?? 0;
      const lStr  = lip   ?? 0;
      return fnUISearchResultRow({
        onclick: `applyOFF(${idx}, '${safenom}', ${kcal}, ${pStr}, ${gStr}, ${lStr})`,
        title: nom,
        metaHtml: `${marque ? '<span class="fn-ui-search-brand">' + fnIAEscape(marque) + '</span>' : '<span class="fn-ui-search-muted">—</span>'}${!complete ? '<span class="fn-ui-search-warning">⚠ données partielles</span>' : ''}`,
        kcal,
        macroHtml: fnIAEscape(macroStr || '—'),
        foot: '/100g'
      });
    }).join('');
  } catch(e) {
    // Fallback API en ligne si base locale absente
    results.innerHTML = fnUISearchStatusHTML('Base locale indisponible — <a href="#" onclick="searchOFF_online(' + idx + ')">chercher en ligne</a>');
  }
}

async function searchOFF_online(idx) {
  const input = document.getElementById('off-search-' + idx);
  const results = document.getElementById('off-results-' + idx);
  if (!input || !results) return;
  const q = input.value.trim();
  results.innerHTML = fnUISearchStatus('Recherche en ligne...');
  try {
    const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(q) + '&search_simple=1&action=process&json=1&page_size=8&fields=product_name,nutriments,brands';
    const r = await fetch(url);
    const data = await r.json();
    const products = (data.products || []).filter(p => p.product_name && p.nutriments?.['energy-kcal_100g'] !== undefined);
    if (!products.length) { results.innerHTML = fnUISearchStatus('Aucun résultat'); return; }
    results.innerHTML = products.map(p => {
      const nom = p.product_name || 'Inconnu';
      const brand = p.brands ? ' · ' + p.brands.split(',')[0] : '';
      const kcal = Math.round(p.nutriments['energy-kcal_100g'] || 0);
      const prot = Math.round((p.nutriments['proteins_100g'] || 0) * 10) / 10;
      const gluc = Math.round((p.nutriments['carbohydrates_100g'] || 0) * 10) / 10;
      const lip  = Math.round((p.nutriments['fat_100g'] || 0) * 10) / 10;
      const safenom = (nom||'').substring(0,40).split("'").join('').split('"').join('').split('\\').join('');
      return fnUISearchResultRow({
        onclick: `applyOFF(${idx},'${safenom}',${kcal},${prot},${gluc},${lip})`,
        title: nom,
        metaHtml: brand ? fnIAEscape(brand.replace(' · ','')) : '',
        kcal,
        macroHtml: fnIAEscape(`🍖 ${prot}g · 🍞 ${gluc}g · 🥑 ${lip}g`),
        foot: '/100g'
      });
    }).join('');
  } catch(e) { results.innerHTML = fnUISearchStatus('Erreur réseau', 'danger'); }
}

function applyOFF(idx, nom, kcal100, prot100, gluc100, lip100) {
  const a = allAliments[idx];
  if (!a) return;

  a.kcal100 = kcal100; a.prot100 = prot100; a.gluc100 = gluc100; a.lip100 = lip100;

  // Sauvegarder si aliment perso
  const ci = idx - ALIMENTS_BASE.length;
  if (ci >= 0 && customAliments[ci]) {
    customAliments[ci] = a; saveCustomList();
    const bdd = getBDD(); const bi = bdd.findIndex(b => b.id === a.bddId);
    if (bi >= 0) { bdd[bi].kcal100=kcal100; bdd[bi].prot100=prot100; bdd[bi].gluc100=gluc100; bdd[bi].lip100=lip100; saveBDD(bdd); }
  } else if (idx < ALIMENTS_BASE.length) {
    ALIMENTS_BASE[idx].kcal100 = kcal100; ALIMENTS_BASE[idx].prot100 = prot100;
    ALIMENTS_BASE[idx].gluc100 = gluc100; ALIMENTS_BASE[idx].lip100 = lip100;
  }

  // Cocher et mettre à jour
  if (!selected.has(idx)) {
    selected.add(idx);
    document.getElementById('row-' + idx)?.classList.add('selected');
  }
  updatePill(idx); updateMacros();
  document.getElementById('off-row-' + idx).style.display = 'none';
  showSaveStatus('✓ ' + nom.substring(0,25) + ' : ' + kcal100 + ' kcal/100g appliqués');
}

// Permettre la recherche avec Entrée
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  const active = document.activeElement;
  if (active && active.id && active.id.startsWith('off-search-')) {
    const idx = active.id.replace('off-search-', '');
    searchOFF(idx);
  }
});


async function groqReadJsonResponse(res, contextLabel) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; }
  catch (e) {
    const preview = text.trim().slice(0, 80).replace(/\s+/g, ' ');
    throw new Error((contextLabel || 'Groq') + ' : réponse non JSON (' + (res.status || '?') + ') ' + preview);
  }
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || ((contextLabel || 'Groq') + ' erreur ' + res.status));
  }
  return data;
}

async function callGroqChat(prompt, options = {}) {
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) throw new Error('Fonctions IA désactivées dans Options de l’application.');
  const maxTokens = options.max_tokens || options.maxTokens || 512;
  const temperature = options.temperature ?? 0.1;
  const model = options.model || fnIAGetModel();
  const messages = options.messages || [{ role: 'user', content: prompt }];
  const payload = { model, messages, prompt, temperature, max_tokens: maxTokens };

  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const endpoints = ['/api/groq/chat', '/api/groq'];
    let lastErr = null;
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const data = await groqReadJsonResponse(res, 'Proxy Groq');
        const content = (data.response || data.content || data.choices?.[0]?.message?.content || '').trim();
        fnIARecordGroqUsage({ feature: options.feature || 'IA texte', model: data.model || model, usage: data.usage, usage_summary: data.usage_summary });
        return content;
      } catch(e) { lastErr = e; if (!String(e.message || e).includes('404')) break; }
    }
    console.warn('Proxy Groq indisponible, essai direct navigateur :', lastErr);
  }

  const key = fnIASafeLocalGet('groq_api_key', '');
  if (!key) throw new Error('Clé Groq absente. Configure GROQ_API_KEY dans Docker, ou active FOODNOTE_ALLOW_UI_SECRET_STORAGE=1 puis sauvegarde la clé dans IA > Clé API Groq.');
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + key },
      body:JSON.stringify({ model, messages, temperature, max_tokens:maxTokens })
    });
    const data = await groqReadJsonResponse(res, 'API Groq');
    const content = (data.choices?.[0]?.message?.content || '').trim();
    fnIARecordGroqUsage({ feature: options.feature || 'IA texte', model: data.model || model, usage: data.usage, usage_summary: data.usage_summary });
    return content;
  } catch(e) {
    if (String(e?.message || e).includes('Failed to fetch')) throw new Error('Appel Groq bloqué côté navigateur/WebView. Utilise le proxy serveur avec GROQ_API_KEY, ou active FOODNOTE_ALLOW_UI_SECRET_STORAGE=1 pour autoriser la clé serveur depuis l’interface.');
    throw e;
  }
}

async function estimerGroqAliment(idx) {
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) { alert('Les fonctions IA sont désactivées dans Options de l’application.'); return; }
  const a = allAliments[idx];
  if (!a) return;

  const qty = quantities[idx] || a.defaut || 100;
  const nomSafe = String(a.nom || '').replace(/[^a-zA-Z\u00C0-\u024F ]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 60);
  const prompt = 'Valeurs nutritionnelles pour ' + qty + 'g de ' + nomSafe + '. Réponds avec exactement 4 nombres séparés par des barres verticales dans cet ordre : kcal | protéines_g | glucides_g | lipides_g. Exemple : 120 | 5.2 | 15.0 | 4.1. Rien d’autre.';

  document.querySelectorAll('[id^="ia-row-"],[id^="off-row-"],[id^="ciq-row-"]').forEach(el => el.style.display = 'none');
  const iaRow = document.getElementById('ia-row-' + idx);
  const iaInput = document.getElementById('ia-val-' + idx);
  const iaStatus = document.getElementById('ia-val-status-' + idx);
  if (iaRow) { iaRow.style.display = 'flex'; iaRow.style.flexDirection = 'column'; iaRow.dataset.openedByUser = '1'; }
  if (iaInput) { iaInput.value = ''; iaInput.placeholder = '⏳ Groq estime...'; }
  if (iaStatus) { iaStatus.textContent = '⏳ Requête Groq en cours...'; iaStatus.style.color = 'var(--text4)'; }

  try {
    const reponse = await callGroqChat(prompt, { max_tokens: 80, temperature: 0.1, feature: 'IA aliment' });
    if (!reponse) throw new Error('Réponse Groq vide.');
    if (iaInput) { iaInput.value = reponse.trim(); iaInput.placeholder = '120 | 5.2 | 15.0 | 4.1'; }
    if (iaStatus) { iaStatus.textContent = '✓ Réponse reçue. Clique sur Appliquer si les valeurs sont OK.'; iaStatus.style.color = 'var(--green)'; }
  } catch(e) {
    console.error('Erreur Groq aliment', e);
    if (iaStatus) { iaStatus.textContent = 'Erreur Groq : ' + (e.message || e); iaStatus.style.color = 'var(--red)'; }
  }
}

function toggleAllCustom() {
  const btn = document.getElementById('btn-show-custom');
  const hidden = document.querySelectorAll('#list-custom [data-hidden="1"]');
  const allHidden = [...hidden].every(el => el.style.display === 'none');
  hidden.forEach(el => { el.style.display = allHidden ? 'flex' : 'none'; });
  if (btn) btn.textContent = allHidden ? 'Masquer' : 'Afficher tous';
}

function toggleIAInput(idx) {
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) { alert('Les fonctions IA sont désactivées dans Options de l’application.'); return; }
  // Fermer tous les autres ia-row ouverts
  document.querySelectorAll('[id^="ia-row-"]').forEach(el => {
    if (el.id !== 'ia-row-' + idx) el.style.display = 'none';
  });
  const row = document.getElementById('ia-row-' + idx);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'flex';
  if (isOpen) row.removeAttribute('data-opened-by-user');
  else row.dataset.openedByUser = '1';
  if (!isOpen) setTimeout(() => document.getElementById('ia-val-' + idx)?.focus(), 50);
}

function applyIALine(idx) {
  const input = document.getElementById('ia-val-' + idx);
  const status = document.getElementById('ia-val-status-' + idx);
  if (!input || !input.value.trim()) return;
  const raw = input.value.trim();

  let qty, kcal, prot, gluc, lip;

  // Format pipe : kcal | prot | gluc | lip (4 valeurs directes)
  if (raw.includes('|')) {
    const parts = raw.split('|').map(p => p.trim());
    const nums = parts.map(p => parseFloat(p.replace(',', '.').replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n) && n >= 0);
    if (nums.length < 3) {
      if (status) { status.textContent = 'Format non reconnu : ' + raw; status.style.color = 'var(--red)'; }
      return;
    }
    // 4 valeurs : kcal | prot | gluc | lip
    kcal = nums[0]; prot = nums[1]; gluc = nums[2]; lip = nums[3] || 0;
    // qty déjà connu
    qty = quantities[idx] || allAliments[idx]?.defaut || 100;
  } else {
    // Format libre : extraire les nombres dans l'ordre
    const nums = [];
    const re = /(\d+(?:[.,]\d+)?)/g;
    let m;
    while ((m = re.exec(raw)) !== null) nums.push(parseFloat(m[1].replace(',','.')));
    if (nums.length < 2) {
      if (status) { status.textContent = 'Format non reconnu — ex: 120g 216kcal 10g 20g 10g'; status.style.color = 'var(--red)'; }
      return;
    }
    if (nums.length >= 4) {
      qty = nums[0]; kcal = nums[1]; prot = nums[2]; gluc = nums[3]; lip = nums[4] || 0;
    } else {
      qty = quantities[idx] || allAliments[idx]?.defaut || 100;
      kcal = nums[0]; prot = nums[1]; gluc = nums[2] || 0; lip = nums[3] || 0;
    }
  }

  const a = allAliments[idx];
  if (!a) return;

  // Mettre à jour les valeurs pour 100g
  const k100 = qty > 0 ? Math.round(kcal / qty * 100) : 0;
  const p100 = qty > 0 ? Math.round(prot / qty * 1000) / 10 : 0;
  const g100 = qty > 0 ? Math.round(gluc / qty * 1000) / 10 : 0;
  const l100 = qty > 0 ? Math.round(lip  / qty * 1000) / 10 : 0;
  const guardFood = {...a, defaut:qty, kcal100:k100, prot100:p100, gluc100:g100, lip100:l100};
  if (typeof foodnoteValidateFoodBeforeSave === 'function' && !foodnoteValidateFoodBeforeSave(guardFood, {qty, title:'Groq : valeur nutritionnelle suspecte'})) return;

  a.kcal100 = k100; a.prot100 = p100; a.gluc100 = g100; a.lip100 = l100;

  // Mettre à jour dans customAliments si perso
  const ci = idx - ALIMENTS_BASE.length;
  if (ci >= 0 && customAliments[ci]) {
    customAliments[ci] = a; saveCustomList();
    const bdd = getBDD(); const bi = bdd.findIndex(b => b.id === a.bddId);
    if (bi >= 0) { bdd[bi].kcal100=k100; bdd[bi].prot100=p100; bdd[bi].gluc100=g100; bdd[bi].lip100=l100; saveBDD(bdd); }
  } else {
    // Aliment de base - juste mettre à jour en mémoire pour cette session
    ALIMENTS_BASE[idx] && (ALIMENTS_BASE[idx].kcal100 = k100, ALIMENTS_BASE[idx].prot100 = p100, ALIMENTS_BASE[idx].gluc100 = g100, ALIMENTS_BASE[idx].lip100 = l100);
  }

  // Mettre à jour la quantité et cocher
  quantities[idx] = qty;
  const qi = document.getElementById('qty-' + idx);
  if (qi) qi.value = qty;
  if (!selected.has(idx)) {
    selected.add(idx);
    document.getElementById('row-' + idx)?.classList.add('selected');
  }
  updatePill(idx); updateMacros();

  if (status) { status.textContent = '✓ ' + Math.round(kcal) + ' kcal · ' + Math.round(prot) + 'g prot appliqués'; status.style.color = 'var(--green)'; }
  input.value = '';
  setTimeout(() => { document.getElementById('ia-row-' + idx).style.display = 'none'; }, 1500);
}

function openIAInput(listid) {
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) { alert('Les fonctions IA sont désactivées dans Options de l’application.'); return; }
  // Fermer les autres
  document.querySelectorAll('[id^="ia-input-"]').forEach(el => {
    if (el.id !== 'ia-input-' + listid) el.style.display = 'none';
  });
  const el = document.getElementById('ia-input-' + listid);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'flex';
  el.style.flexDirection = 'column';
  if (!isOpen) setTimeout(() => document.getElementById('ia-line-' + listid)?.focus(), 50);
}

function parseIALine(listid) {
  const input = document.getElementById('ia-line-' + listid);
  const status = document.getElementById('ia-line-status-' + listid);
  if (!input || !input.value.trim()) return;
  const raw = input.value.trim();

  // Extraire les nombres
  const nums = [];
  const numRe = /(\d+(?:[.,]\d+)?)\s*(?:kcal|g|cal)?/gi;
  let m;
  while ((m = numRe.exec(raw)) !== null) nums.push(parseFloat(m[1].replace(',', '.')));

  // Extraire le nom (tout ce qui précède le premier nombre)
  const nomMatch = raw.match(/^([^\d]+)/);
  const nom = nomMatch ? nomMatch[1].replace(/[|:,-]+$/, '').trim() : '';

  if (!nom || nums.length < 2) {
    if (status) { status.textContent = 'Format non reconnu — essaie: Nom quantité kcal prot gluc lip'; status.style.color = 'var(--red)'; }
    return;
  }

  // qty, kcal, prot, gluc, lip
  const qty  = nums[0] || 100;
  const kcal = nums[1] || 0;
  const prot = nums[2] || 0;
  const gluc = nums[3] || 0;
  const lip  = nums[4] || 0;

  const k100 = qty > 0 ? Math.round(kcal / qty * 100) : 0;
  const p100 = qty > 0 ? Math.round(prot / qty * 1000) / 10 : 0;
  const g100 = qty > 0 ? Math.round(gluc / qty * 1000) / 10 : 0;
  const l100 = qty > 0 ? Math.round(lip  / qty * 1000) / 10 : 0;
  const guardFood = {nom, defaut:qty, kcal100:k100, prot100:p100, gluc100:g100, lip100:l100, unite:'g'};
  if (typeof foodnoteValidateFoodBeforeSave === 'function' && !foodnoteValidateFoodBeforeSave(guardFood, {qty, title:'IA/Groq : valeur nutritionnelle suspecte'})) return;

  // Vérifier si existe déjà dans le même repas seulement.
  const targetMeal = (typeof normalizeMealId === 'function') ? normalizeMealId((typeof foodAddTargetMeal !== 'undefined' ? foodAddTargetMeal : 'lunch') || 'lunch') : 'lunch';
  const existIdx = allAliments.findIndex(a =>
    String(a?.nom || '').toLowerCase().trim() === String(nom || '').toLowerCase().trim() &&
    ((typeof normalizeMealId === 'function') ? normalizeMealId(a?.meal || 'lunch') : (a?.meal || 'lunch')) === targetMeal
  );

  if (existIdx >= 0) {
    const a = allAliments[existIdx];
    a.kcal100 = k100; a.prot100 = p100; a.gluc100 = g100; a.lip100 = l100; a.defaut = qty;
    const ci = existIdx - ALIMENTS_BASE.length;
    if (ci >= 0 && customAliments[ci]) {
      customAliments[ci] = a; saveCustomList();
      const bdd = getBDD(); const bi = bdd.findIndex(b => b.id === a.bddId);
      if (bi >= 0) { bdd[bi].kcal100=k100; bdd[bi].prot100=p100; bdd[bi].gluc100=g100; bdd[bi].lip100=l100; saveBDD(bdd); }
    }
    selected.add(existIdx);
    const row = document.getElementById('row-' + existIdx);
    const qi  = document.getElementById('qty-' + existIdx);
    if (row) row.classList.add('selected');
    if (qi)  { qi.value = qty; quantities[existIdx] = qty; }
    updatePill(existIdx); updateMacros();
    if (status) { status.textContent = '✓ Mis à jour : ' + nom + ' (' + kcal + ' kcal)'; status.style.color = 'var(--green)'; }
  } else {
    // Forcer la cat custom pour qu'il atterrisse dans la bonne section
    addCustomAliment({nom, defaut: qty, kcal100: k100, prot100: p100, gluc100: g100, lip100: l100, bddId: null, meal: targetMeal});
    const idx = allAliments.findIndex(a => String(a?.nom || '').toLowerCase().trim() === String(nom || '').toLowerCase().trim() && ((typeof normalizeMealId === 'function') ? normalizeMealId(a?.meal || 'lunch') : (a?.meal || 'lunch')) === targetMeal);
    if (idx >= 0) {
      selected.add(idx);
      const row = document.getElementById('row-' + idx);
      const qi  = document.getElementById('qty-' + idx);
      if (row) row.classList.add('selected');
      if (qi)  { qi.value = qty; quantities[idx] = qty; }
      updatePill(idx); updateMacros();
    }
    if (status) { status.textContent = '✓ Ajouté : ' + nom + ' (' + kcal + ' kcal)'; status.style.color = 'var(--green)'; }
  }

  input.value = '';
  setTimeout(() => { if (status) status.textContent = ''; document.getElementById('ia-input-' + listid).style.display = 'none'; }, 1500);
}

function renderBddDonnees() {
  const el = document.getElementById('bdd-list-donnees');
  if (!el) return;
  const list = getCustomList();
  if (!list.length) {
    el.innerHTML = '<div class="fn-ui-note-compact">Aucun aliment personnalisé. Utilise le bouton G ou IA sur un aliment pour en créer un.</div>';
    return;
  }
  el.innerHTML = list.map((a, i) => `
    <div class="fn-ui-row fn-ui-row--database fn-ui-custom-food-row">
      <div class="fn-ui-custom-food-name">${a.nom}</div>
      <div class="fn-ui-custom-food-meta">${a.kcal100 || 0} kcal · ${a.prot100 || 0}g P · ${a.gluc100 || 0}g G · ${a.lip100 || 0}g L</div>
      <button class="fn-ui-icon-danger" onclick="deleteCustomAliment(${i})">✕</button>
    </div>
  `).join('');
}

function deleteCustomAliment(idx) {
  const list = getCustomList();
  list.splice(idx, 1);
  saveCustomList(list);
  renderBddDonnees();
  buildLists();
}

const PHASES_DEF = [
  { id:'reverse', label:'Reverse dieting',  desc:'Remontée calorique progressive',  color:'#BA7517', weeks:6  },
  { id:'perte',   label:'Perte de poids',   desc:'Déficit modéré ~20%',              color:'#378ADD', weeks:8  },
  { id:'recomp',  label:'Recomposition',    desc:'Maintenance + muscle et perte gras',color:'#1D9E75', weeks:12 },
  { id:'sechage', label:'Séchage',          desc:'Déficit marqué, protéines hautes', color:'#D85A30', weeks:6  },
  { id:'prise',   label:'Prise de masse',   desc:'Surplus ~15%, muscle max',         color:'#639922', weeks:10 },
  { id:'maint',   label:'Maintenance',      desc:'Stabiliser le poids actuel',       color:'#888780', weeks:8  },
];

let phaseTimeline = [];
let phaseSelected = null; // phase sélectionnée depuis le pool


document.addEventListener('DOMContentLoaded', () => { try { fnIALoadModel(); } catch(e) {} });

try { document.addEventListener('DOMContentLoaded', fnIARenderTokenCounter); } catch(e) {}
