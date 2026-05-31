/*
 * FoodNote — historique, export, stockage et outils de bases locales.
 * Rôle : gérer l'historique côté interface, les exports/imports utilisateur,
 *        les statuts et actions de maintenance CIQUAL/OpenFoodFacts.
 * Gère : appels API depuis l'UI, affichage des statuts, logs et actions utilisateur.
 * Ne doit pas gérer : logique serveur, parsing CIQUAL/OpenFoodFacts, ni accès direct SQLite.
 */
function formatDate(d) { const [y,m,j]=d.split('-'); return j+'/'+m+'/'+y; }

let historyFilters = { q:'', period:'all', type:'all' };
let historySearchTimer = null;

function htmlEscape(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}




function FNUI() {
  return window.FoodNoteUI || {
    esc: htmlEscape,
    panel: (o={}) => `<section class="fn-ui-panel fn-ui-panel-pad">${o.title ? `<h1 class="fn-ui-title fn-ui-title-inline">${htmlEscape(o.title)}</h1>` : ''}${o.children || ''}</section>`,
    featureGrid: () => '', sectionHead: (t,m='') => `<div class="fn-ui-section-head"><b>${htmlEscape(t)}</b><em>${htmlEscape(m)}</em></div>`,
    button: (label, onclick='') => `<button type="button" ${onclick?`onclick="${htmlEscape(onclick)}"`:''}>${htmlEscape(label)}</button>`,
    field: () => '', filterGrid: (x=[]) => x.join(''), chip: (v) => `<span class="fn-ui-chip">${v}</span>`, macroChips: (m={}) => '', dayStrip: () => '', foodRow: () => '', dayJournalCard: (o={}) => `<details class="fn-ui-row fn-ui-row--history fn-ui-row--expandable" id="${htmlEscape(o.id||'')}"><summary>${htmlEscape(o.title||'')}</summary>${o.children||''}</details>`
  };
}

function foodnoteCompactFoodForLocalCache(raw) {
  const f = raw || {};
  // Cache de fiche aliment : on garde uniquement les valeurs /100g explicites.
  // Ne jamais recycler un total de portion `kcal` en `kcal100`, sinon une suggestion
  // ou un rechargement léger peut afficher 0 kcal ou une valeur fausse avant le refresh serveur.
  const out = {
    id: f.id ?? f.bddId ?? f.bdd_id ?? null,
    nom: f.nom || f.name || '',
    kcal100: Number(f.kcal100 ?? f.kcalPer100 ?? f.kcal_100g ?? 0) || 0,
    prot100: Number(f.prot100 ?? f.protPer100 ?? f.proteins_100g ?? 0) || 0,
    gluc100: Number(f.gluc100 ?? f.glucPer100 ?? f.carbohydrates_100g ?? 0) || 0,
    lip100: Number(f.lip100 ?? f.lipPer100 ?? f.fat_100g ?? 0) || 0,
    unite: 'g',
    uniteLabel: '',
    unitWeight: 0,
    source: f.source || '',
    meta: f.meta || f.marque || f.groupe || ''
  };
  if (f.favorite || f.favori) out.favorite = true;
  if (f.custom || f.isCustom) out.custom = true;
  return out;
}

function foodnoteCompactEntryForLocalCache(raw) {
  const e = raw || {};
  const foods = Array.isArray(e.aliments) ? e.aliments.slice(0, 28).map(a => {
    const item = {
      entryFoodId: a.entryFoodId ?? a.entry_food_id ?? a.id ?? null,
      entry_food_id: a.entry_food_id ?? a.entryFoodId ?? a.id ?? null,
      line_uid: a.line_uid || a.lineUid || null,
      bddId: a.bddId ?? a.bdd_id ?? a.food_id ?? null,
      nom: a.nom || a.name || '',
      qty: Number(a.qty ?? a.defaut ?? a.quantity ?? 0) || 0,
      unite: 'g',
      meal: a.meal || 'lunch'
    };
    // Journal : les valeurs `kcal/prot/gluc/lip` sont des totaux de ligne.
    // On n'ajoute la clé que si elle existait vraiment : une clé absente ne doit pas
    // devenir un total à 0, sinon editEntry privilégie ce faux total au lieu du /100g.
    if (a.kcal !== undefined || a.calories !== undefined || a.energy !== undefined) item.kcal = Number(a.kcal ?? a.calories ?? a.energy ?? 0) || 0;
    if (a.prot !== undefined || a.proteines !== undefined || a.protein !== undefined) item.prot = Number(a.prot ?? a.proteines ?? a.protein ?? 0) || 0;
    if (a.gluc !== undefined || a.glucides !== undefined || a.carbs !== undefined) item.gluc = Number(a.gluc ?? a.glucides ?? a.carbs ?? 0) || 0;
    if (a.lip !== undefined || a.lipides !== undefined || a.fat !== undefined) item.lip = Number(a.lip ?? a.lipides ?? a.fat ?? 0) || 0;
    if (a.kcal100 !== undefined || a.kcalPer100 !== undefined) item.kcal100 = Number(a.kcal100 ?? a.kcalPer100 ?? 0) || 0;
    if (a.prot100 !== undefined || a.protPer100 !== undefined) item.prot100 = Number(a.prot100 ?? a.protPer100 ?? 0) || 0;
    if (a.gluc100 !== undefined || a.glucPer100 !== undefined) item.gluc100 = Number(a.gluc100 ?? a.glucPer100 ?? 0) || 0;
    if (a.lip100 !== undefined || a.lipPer100 !== undefined) item.lip100 = Number(a.lip100 ?? a.lipPer100 ?? 0) || 0;
    return item;
  }) : [];
  return {
    id: e.id ?? null,
    date: e.date || '',
    macros: e.macros || { kcal:e.kcal || 0, prot:e.prot || 0, gluc:e.gluc || 0, lip:e.lip || 0 },
    depSport: e.depSport ?? e.dep_sport ?? 0,
    netKcal: e.netKcal ?? e.net_kcal ?? 0,
    revision: Number(e.revision ?? e._revision ?? 0) || 0,
    updated_at: e.updated_at || e.updatedAt || null,
    _detailsLoaded: !!e._detailsLoaded,
    aliments: foods,
    sports: Array.isArray(e.sports) ? e.sports.slice(0, 12) : []
  };
}

function foodnoteCollectCompactFoodsForCache(list, limit = 80) {
  const out = [];
  const arr = Array.isArray(list) ? list : [];
  for (let i = 0; i < arr.length && out.length < limit; i++) {
    const f = arr[i];
    if (!f || f.__journalReplay || f.source === 'journal_replay' || f.__foodnoteDeletedRuntime || f.__deleted || f._deleted) continue;
    try {
      const clean = typeof stripEntryRuntimeMetaFromFood === 'function' ? stripEntryRuntimeMetaFromFood(f) : f;
      const compact = foodnoteCompactFoodForLocalCache(clean);
      if (compact && compact.nom) out.push(compact);
    } catch(e) {}
  }
  return out;
}

function foodnoteDbLocalCachePayload() {
  // SQLite est la source de vérité. Le cache navigateur doit rester petit et prédictible.
  // Règle 0.22.15 : ne jamais scanner/sérialiser la base aliments complète pendant une action UI.
  const db = _db || {};
  const out = {
    journal_entries: [],
    custom_aliments: [],
    bdd_aliments: [],
    sports_config: [],
    bdd_seed_version: db.bdd_seed_version || 0,
    _storage_mode: db._storage_mode || ''
  };
  try {
    const entries = Array.isArray(db.journal_entries) ? db.journal_entries : [];
    // Les entrées serveur arrivent déjà triées dans le flux normal. On évite donc un tri global à chaque cache.
    out.journal_entries = entries.slice(0, 14).map(foodnoteCompactEntryForLocalCache);
  } catch(e) {}
  try {
    out.custom_aliments = foodnoteCollectCompactFoodsForCache(db.custom_aliments, 80);
  } catch(e) {}
  // Ne pas mettre bdd_aliments dans localStorage : CIQUAL/OpenFoodFacts/SQLite se rechargent côté serveur.
  // Garder cette liste vide évite les faux kcal temporaires et les longues sérialisations navigateur.
  out._foods_cache_trimmed = true;
  try {
    out.sports_config = Array.isArray(db.sports_config) ? db.sports_config.slice(0, 40) : [];
  } catch(e) {}
  return out;
}

let _foodnoteLocalCacheTimer = null;
let _foodnoteLocalCacheLastJson = '';

function foodnoteRequestIdle(fn, timeout = 1200, delay = 0) {
  // Nom historique conservé, mais on n'utilise plus requestIdleCallback pour les tâches
  // qui touchent l'UI/cache : sur Android/WebView, un gros idle callback bloque quand même le thread.
  const schedule = () => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(() => { try { fn(); } catch(e) {} }, 0));
    } else {
      setTimeout(() => { try { fn(); } catch(e) {} }, 0);
    }
  };
  if (delay > 0) setTimeout(schedule, delay); else schedule();
}

function saveFoodnoteDbLocalCacheNow() {
  try {
    const json = JSON.stringify(foodnoteDbLocalCachePayload());
    if (json === _foodnoteLocalCacheLastJson) return;
    _foodnoteLocalCacheLastJson = json;
    safeLocalSet('foodnote_db', json);
  } catch(e) { console.warn('Cache local FoodNote non sauvegardé', e); }
}

function saveFoodnoteDbLocalCache(options = {}) {
  clearTimeout(_foodnoteLocalCacheTimer);
  if (options && options.immediate) {
    saveFoodnoteDbLocalCacheNow();
    return;
  }
  // SQLite est la source de vérité : le cache navigateur est écrit hors du chemin critique UI.
  _foodnoteLocalCacheTimer = setTimeout(() => foodnoteRequestIdle(saveFoodnoteDbLocalCacheNow, 1600), 220);
}
window.saveFoodnoteDbLocalCacheNow = saveFoodnoteDbLocalCacheNow;

function normalizeHistoryText(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function historyWeekdayShort(iso) {
  try { return new Date(String(iso || '') + 'T00:00:00').toLocaleDateString('fr-FR', { weekday:'short' }).replace('.', ''); }
  catch(e) { return ''; }
}
function historyDateLabel(iso) {
  const d = String(iso || '');
  if (!d.includes('-')) return d;
  const [y,m,j] = d.split('-');
  return `${j}/${m}`;
}

function entryTs(e) {
  const t = Date.parse(String(e?.date || '') + 'T00:00:00');
  return Number.isFinite(t) ? t : 0;
}

function entryMatchesHistoryFilters(e, maxTs) {
  const q = normalizeHistoryText(historyFilters.q || '').trim();
  if (q) {
    const hay = normalizeHistoryText([
      e.date, formatDate(String(e.date || '')), historyWeekdayShort(e.date),
      e.notes, e.extras, e.energie, e.faim,
      ...(e.aliments || []).map(a => `${a.nom || ''} ${a.qty || ''} ${a.unite || ''}`),
      ...(e.sports || []).map(s => `${s.nom || ''} ${s.heures || ''} ${s.total || ''}`)
    ].join(' '));
    if (!hay.includes(q)) return false;
  }
  const ts = entryTs(e);
  if (historyFilters.period === '7d' && maxTs && ts < maxTs - 6*86400000) return false;
  if (historyFilters.period === '30d' && maxTs && ts < maxTs - 29*86400000) return false;
  if (historyFilters.period === 'month' && maxTs) {
    const d = new Date(maxTs), ed = new Date(ts);
    if (d.getFullYear() !== ed.getFullYear() || d.getMonth() !== ed.getMonth()) return false;
  }
  const type = historyFilters.type || historyFilters.macro || 'all';
  const foodCount = e._detailsLoaded === true ? (Array.isArray(e.aliments) ? e.aliments.length : 0) : Number(e.foodCount ?? e.food_count ?? 0);
  const sportCount = e._detailsLoaded === true ? (Array.isArray(e.sports) ? e.sports.length : 0) : Number(e.sportCount ?? e.sport_count ?? 0);
  if (type === 'sport' && !sportCount && !Number(e.depSport || 0)) return false;
  if (type === 'poids' && !Number(e.poids || 0)) return false;
  if (type === 'notes' && !String(e.notes || e.extras || '').trim()) return false;
  if (type === 'aliments' && !foodCount) return false;
  return true;
}

function setHistoryFilter(key, val) {
  historyFilters[key] = val;
  renderHistorique({ preserveSearch: key === 'q' });
}

function setHistorySearchLive(val) {
  historyFilters.q = val;
  if (historySearchTimer) clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    historySearchTimer = null;
    renderHistorique({ preserveSearch: true });
  }, 260);
}

function resetHistoryFilters() {
  historyFilters = { q:'', period:'all', type:'all' };
  renderHistorique();
}

function historyRestoreSearchFocus(meta) {
  if (!meta || !meta.active) return;
  const input = document.getElementById('hist-search');
  if (!input) return;
  try {
    input.focus({ preventScroll:true });
    const pos = Math.min(Number(meta.pos || 0), input.value.length);
    input.setSelectionRange(pos, pos);
  } catch(e) { input.focus(); }
}

function historyMacroState(e) {
  const kcal = Number(e.macros?.kcal || 0);
  const prot = Number(e.macros?.prot || 0);
  const targetK = Number(PROFIL.cibleKcal || 0);
  const targetP = Number(PROFIL.cibleProt || 0);
  const kcalOk = targetK ? kcal >= targetK * .9 && kcal <= targetK * 1.1 : false;
  const protOk = targetP ? prot >= targetP : false;
  return { kcalOk, protOk };
}

function renderHistoryTrend(entries) {
  const ui = FNUI();
  const days = (entries || []).slice(0, 14).reverse();
  if (!days.length) return '';
  const maxK = Math.max(1, ...days.map(e => Number(e.macros?.kcal || 0)));
  const maxS = Math.max(1, ...days.map(e => Number(e.depSport || 0)));
  const strip = ui.dayStrip(days.map(e => {
    const kcal = Number(e.macros?.kcal || 0);
    const sport = Number(e.depSport || 0);
    return {
      weekday: historyWeekdayShort(e.date),
      dateLabel: historyDateLabel(e.date),
      kcal: Math.round(kcal),
      sport: sport ? Math.round(sport) : '',
      kcalHeight: Math.max(10, Math.round(kcal / maxK * 72)),
      sportHeight: sport ? Math.max(8, Math.round(sport / maxS * 34)) : 0,
      title: `${formatDate(e.date)} · ${Math.round(kcal)} kcal${sport ? ' · sport ' + Math.round(sport) + ' kcal' : ''}`,
      onclick: `toggleHistDetail('${ui.esc(e.id)}');document.getElementById('hcard-${ui.esc(e.id)}')?.scrollIntoView({behavior:'smooth',block:'center'});`
    };
  }));
  return ui.panel({ children: ui.sectionHead('📅 Frise des journées', 'calories · sport') + strip });
}

function renderHistoryPurpose() {
  const ui = FNUI();
  return ui.featureGrid([
    {icon:'🔎', title:'Retrouver', text:'date, aliment, sport ou note.'},
    {icon:'📒', title:'Relire', text:'détail exact d’une journée enregistrée.'},
    {icon:'✎', title:'Corriger', text:'modifier, exporter ou supprimer.'}
  ]);
}

function renderHistoryDirectorySummary(entries, total) {
  return '';
}


function renderHistorySummary(entries, total) {
  return '';
}


function historyEntryRecapHTML(e) {
  const ui = FNUI();
  const m = e && e.macros ? e.macros : {};
  const parts = [];
  if (m.kcal != null) parts.push(ui.chip(`🔥 ${ui.esc(m.kcal)} kcal`, 'kcal'));
  if (m.prot != null) parts.push(ui.chip(`🍖 ${ui.esc(m.prot)}g`, 'prot'));
  if (m.gluc != null) parts.push(ui.chip(`🍞 ${ui.esc(m.gluc)}g`, 'gluc'));
  if (m.lip != null) parts.push(ui.chip(`🥑 ${ui.esc(m.lip)}g`, 'lip'));
  if (e && e.depSport) parts.push(ui.chip(`🚴 ${ui.esc(e.depSport)} kcal`, 'sport'));
  const count = e._detailsLoaded === true ? (e.aliments || []).length : Number(e.foodCount ?? e.food_count ?? 0) || 0;
  parts.push(ui.chip(`${count} aliment${count>1?'s':''}${e._detailsLoaded === true ? '' : ' · détails à charger'}`));
  return parts.join('');
}

function historyFoodRowHTML(a) {
  const ui = FNUI();
  const qty = typeof formatFoodQty === 'function' ? formatFoodQty(a, a.qty) : `${a.qty || 0} ${a.unite || 'g'}`;
  const macros = {
    kcal: Number(a.kcal || 0),
    prot: Number(a.prot || 0),
    gluc: Number(a.gluc || 0),
    lip: Number(a.lip || 0)
  };
  const macroHtml = typeof nutrientInlineHTML === 'function'
    ? nutrientInlineHTML(macros)
    : ui.macroChips(macros);
  return ui.foodRow({ name: a.nom || 'Aliment', qty, macrosHtml: macroHtml, macros });
}

function historyDayEntryHTML(e) {
  const ui = FNUI();
  const poidsTxt = e.poids ? ` · ⚖️ ${e.poids} kg` : '';
  const sportTxt = e.sports?.length ? e.sports.map(s=>`${ui.esc(s.nom)} ${ui.esc(s.heures || '')}h`).join(', ') : '';
  const expectedFoodCount = Number(e.foodCount ?? e.food_count ?? 0) || 0;
  const foodRows = e._detailsLoaded !== true
    ? `<div class="fn-ui-tile fn-ui-tile-pad fn-history-loading"><b>Chargement des aliments…</b><div class="fn-ui-muted">${expectedFoodCount ? expectedFoodCount + ' ligne(s) attendue(s).' : 'Détail de la journée en cours de récupération depuis SQLite.'}</div></div>`
    : ((e.aliments || []).map(historyFoodRowHTML).join('') || '<div class="fn-ui-muted">Aucun aliment enregistré.</div>');
  const note = (e.extras || e.notes) ? String(e.extras || e.notes) : '';
  const children = `${sportTxt ? `<div class="fn-ui-tile fn-ui-tile-pad"><b>🚴 Sport</b><div class="fn-ui-muted">${sportTxt}</div></div>` : ''}${foodRows}`;
  return ui.dayJournalCard({
    id: `hcard-${e.id}`,
    icon: '📅',
    title: formatDate(e.date),
    sub: `${historyWeekdayShort(e.date)}${poidsTxt}`,
    recapHtml: historyEntryRecapHTML(e),
    note,
    children,
    actions: [
      {label:'Relire', onclick:`event.preventDefault();event.stopPropagation();openHistoryEntry('${ui.esc(e.id)}')`},
      {label:'Corriger', onclick:`event.preventDefault();event.stopPropagation();editHistoryEntry('${ui.esc(e.id)}')`},
      {label:'Exporter', onclick:`event.preventDefault();event.stopPropagation();exportHistoryEntry('${ui.esc(e.id)}')`}
    ]
  });
}

function renderHistorique(options = {}) {
  const ui = FNUI();
  const entriesAll = getEntries(), el=document.getElementById('hist-list');
  if(!el) return;
  el.className = 'fn-ui-page fn-ui-stack';
  const activeSearch = document.activeElement && document.activeElement.id === 'hist-search';
  const searchMeta = options.preserveSearch ? { active: activeSearch, pos: document.getElementById('hist-search')?.selectionStart || 0 } : null;
  const sorted = sortEntriesDesc(entriesAll || []);
  const maxTs = sorted.length ? entryTs(sorted[0]) : Date.now();
  const entries = sorted.filter(e => entryMatchesHistoryFilters(e, maxTs));
  const needsHistoryHydration = historyHasSummaryOnlyEntries(sorted);
  if (needsHistoryHydration) hydrateHistoryDetailsInBackground('renderHistorique');

  const header = ui.panel({
    icon:'🕘', kicker:'Journal enregistré', title:'Historique',
    subtitle:'Retrouve une journée précise, relis son contenu et corrige une saisie passée.',
    children: renderHistoryPurpose()
  });
  const filters = ui.panel({ children:
    ui.sectionHead('🔎 Recherche une journée', '') +
    `<div class="fn-ui-panel-action-top">${ui.button('Réinitialiser', 'resetHistoryFilters()')}</div>` +
    ui.filterGrid([
      ui.field({ id:'hist-search', label:'Recherche', inputType:'search', value:historyFilters.q, placeholder:'ex: 25/05, skyr, vélo, fatigue...', oninput:'setHistorySearchLive(this.value)' }),
      ui.field({ label:'Période', type:'select', onchange:"setHistoryFilter('period', this.value)", options:[
        {value:'all', label:'Tout', selected:historyFilters.period==='all'},
        {value:'7d', label:'7 derniers jours saisis', selected:historyFilters.period==='7d'},
        {value:'30d', label:'30 derniers jours saisis', selected:historyFilters.period==='30d'},
        {value:'month', label:'Mois de la dernière saisie', selected:historyFilters.period==='month'}
      ]}),
      ui.field({ label:'Type', type:'select', onchange:"setHistoryFilter('type', this.value)", options:[
        {value:'all', label:'Toutes les journées', selected:historyFilters.type==='all'},
        {value:'aliments', label:'Avec aliments', selected:historyFilters.type==='aliments'},
        {value:'sport', label:'Avec sport', selected:historyFilters.type==='sport'},
        {value:'poids', label:'Avec poids', selected:historyFilters.type==='poids'},
        {value:'notes', label:'Avec notes', selected:historyFilters.type==='notes'}
      ]})
    ])
  });
  const controls = header + filters;
  if(!sorted.length){el.innerHTML=controls+ui.panel({children:'<div class="fn-ui-muted">Aucune entrée dans SQLite.</div>'}); historyRestoreSearchFocus(searchMeta); return;}
  if(!entries.length){el.innerHTML=controls+ui.panel({children:'<div class="fn-ui-muted">Aucune journée ne correspond aux filtres. Essaie une date comme 25/05, un aliment, un sport ou réinitialise.</div>'}); historyRestoreSearchFocus(searchMeta); return;}
  const hydrationBanner = needsHistoryHydration
    ? ui.panel({ children:'<div class="fn-ui-muted"><b>Hydratation de l’historique…</b><br>Les résumés sont chargés, FoodNote récupère maintenant les ingrédients détaillés depuis SQLite.</div>' })
    : '';
  el.innerHTML=controls+hydrationBanner+renderHistoryTrend(entries)+renderHistoryExportBar(entries)+ui.sectionHead('📒 Journal des journées', `${entries.length} résultat(s)`)+entries.map(historyDayEntryHTML).join('');
  historyRestoreSearchFocus(searchMeta);
  if (typeof applyFeatureVisibility === 'function') applyFeatureVisibility();
}

function toggleHistDetail(id) {
  const card = document.getElementById('hcard-'+id);
  if (!card) return;
  if (card.tagName && card.tagName.toLowerCase() === 'details') {
    card.open = !card.open;
    return;
  }
  const d = document.getElementById('hdetail-'+id);
  const arrow = card?.querySelector('.fn-ui-entry-arrow');
  if (!d) return;
  const open = d.style.display && d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▼' : '▲';
}

function replaceLoadedEntryDetails(loaded) {
  if (!loaded) return null;
  const normalized = normalizeServerEntry({ ...loaded, _detailsLoaded:true });
  const entries = getEntries();
  const idx = entries.findIndex(e => String(e.id) === String(normalized.id) || (normalized.date && e.date === normalized.date));
  if (idx >= 0) entries[idx] = { ...entries[idx], ...normalized, _detailsLoaded:true };
  else entries.unshift(normalized);
  try { _db.journal_entries = sortEntriesDesc(entries); } catch(e) { _db.journal_entries = entries; }
  return normalized;
}

async function loadEntryDetailsNative(id) {
  const r = await foodnoteFetchTimeout('/api/entries/' + encodeURIComponent(id), { cache:'no-store' }, 1600);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' sur /api/entries/' + id);
  return replaceLoadedEntryDetails(await r.json());
}

let _historyDetailsHydrating = false;
let _historyDetailsHydrateAsked = false;

function historyHasSummaryOnlyEntries(entries) {
  return (entries || []).some(e => e && e._detailsLoaded !== true);
}

function hydrateHistoryDetailsInBackground(reason = 'historique') {
  if (_db && _db._entries_full_loaded) return;
  if (_historyDetailsHydrating) return;
  if (typeof loadEntriesFullNative !== 'function') return;
  _historyDetailsHydrating = true;
  _historyDetailsHydrateAsked = true;
  loadEntriesFullNative(false)
    .then(() => {
      _historyDetailsHydrating = false;
      if (document.getElementById('page-historique')?.classList.contains('active') && typeof renderHistorique === 'function') {
        renderHistorique({ preserveSearch:true, fromHydration:true });
      }
      if (typeof window.foodnoteRefreshJournalMutationViews === 'function') {
        window.foodnoteRefreshJournalMutationViews('history-hydration', { recap:true, stats:true });
      }
    })
    .catch(e => {
      _historyDetailsHydrating = false;
      console.warn('[FoodNote] hydratation historique impossible', e);
      try { showSaveStatus('Historique détaillé indisponible', true); } catch(_) {}
    });
}

function editEntry(id) {
  const entry = getEntries().find(e=>String(e.id)===String(id));
  if (!entry) return;
  if (entry._detailsLoaded === false && !entry.__loadingDetails) {
    entry.__loadingDetails = true;
    try { showSaveStatus('Chargement de la journée…'); } catch(e) {}
    loadEntryDetailsNative(entry.id)
      .then(() => editEntry(id))
      .catch(e => { entry.__loadingDetails = false; console.warn('[FoodNote] détail journée indisponible', e); showSaveStatus('Détail journée indisponible', true); });
    return;
  }

  // v11.42 — correction données uniquement :
  // la page Journal doit relire la journée sauvegardée comme l'Historique.
  // On recrée donc des lignes temporaires "journal_replay" à partir des aliments sauvegardés,
  // avec les macros sauvegardées par ligne comme source, au lieu de refaire confiance à la BDD aliments.
  showPage('journal', document.querySelector('.nav-tab'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('[onclick*="journal"]')?.classList.add('active');

  const _safeNumber = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const _entryMealId = (al) => {
    const m = al && (al.meal || al.repas || al.mealId);
    return (typeof normalizeMealId === 'function') ? normalizeMealId(m || 'lunch') : (m || 'lunch');
  };
  const _entryQty = (al) => {
    const q = Math.abs(_safeNumber(al && (al.qty ?? al.quantite ?? al.quantity), 0));
    return q > 0 ? q : 1;
  };
  const _entryEffectiveGrams = (al) => {
    // 0.22.0 : l'historique est relu en grammes stricts, sans conversion unité automatique.
    return _entryQty(al);
  };
  const _entryPer100 = (al, key100, keyTotal, aliases = []) => {
    const keys100 = [key100, key100.replace('100','Per100'), ...aliases];
    for (const k of keys100) {
      const direct = Number(al && al[k]);
      if (Number.isFinite(direct) && direct > 0) return direct;
    }
    const total = Number(al && al[keyTotal]);
    const grams = _entryEffectiveGrams(al);
    return (Number.isFinite(total) && total > 0 && grams > 0) ? (total * 100 / grams) : 0;
  };
  const _removeOldJournalReplayFoods = () => {
    try {
      (allAliments || []).forEach((a, idx) => {
        if (a && a.__journalReplay) {
          ['row-', 'ia-row-', 'off-row-', 'ciq-row-', 'er-'].forEach(prefix => document.getElementById(prefix + idx)?.remove());
        }
      });
      customAliments = (customAliments || []).filter(a => !(a && a.__journalReplay));
      allAliments = [...ALIMENTS_BASE, ...customAliments];
      Object.keys(quantities || {}).forEach(k => {
        const i = Number(k);
        if (!Number.isFinite(i) || i >= allAliments.length) delete quantities[k];
      });
    } catch(e) {
      console.warn('[FoodNote] nettoyage journal_replay impossible', e);
    }
  };
  const _makeJournalReplayFood = (al, n) => {
    const qty = _entryQty(al);
    const total = {
      kcal: _safeNumber(al && (al.kcal ?? al.calories ?? al.energy), NaN),
      prot: _safeNumber(al && (al.prot ?? al.proteines ?? al.protein), NaN),
      gluc: _safeNumber(al && (al.gluc ?? al.glucides ?? al.carbs), NaN),
      lip:  _safeNumber(al && (al.lip ?? al.lipides ?? al.fat), NaN),
    };
    const hasSavedTotals = Number.isFinite(total.kcal) || Number.isFinite(total.prot) || Number.isFinite(total.gluc) || Number.isFinite(total.lip);
    const grams = _entryEffectiveGrams(al);

    const food = {
      nom: String(al && (al.nom || al.name) || ('Aliment journal ' + (n + 1))).trim(),
      defaut: qty,
      unite: al && (al.unite || al.unit) || 'g',
      poidsUnite: _safeNumber(al && (al.poidsUnite ?? al.poids_unite ?? al.unitWeight), 0) || null,
      uniteLabel: al && (al.uniteLabel || al.unite_label) || '',
      meal: _entryMealId(al),
      cat: 'custom',
      source: 'journal_replay',
      entryFoodId: al && (al.entryFoodId || al.entry_food_id || al.id) || null,
      entry_food_id: al && (al.entry_food_id || al.entryFoodId || al.id) || null,
      line_uid: al && (al.line_uid || al.lineUid) || null,
      __journalReplay: true
    };

    if (hasSavedTotals) {
      // Source de vérité : totals sauvegardés par aliment. getMacros() multiplie kcalU par qty.
      food.kcalU = (Number.isFinite(total.kcal) ? total.kcal : 0) / qty;
      food.protU = (Number.isFinite(total.prot) ? total.prot : 0) / qty;
      food.glucU = (Number.isFinite(total.gluc) ? total.gluc : 0) / qty;
      food.lipU  = (Number.isFinite(total.lip)  ? total.lip  : 0) / qty;

      // Champs /100g seulement pour l'affichage des lignes, pas pour le calcul.
      food.kcal100 = grams > 0 ? (food.kcalU * qty * 100 / grams) : 0;
      food.prot100 = grams > 0 ? (food.protU * qty * 100 / grams) : 0;
      food.gluc100 = grams > 0 ? (food.glucU * qty * 100 / grams) : 0;
      food.lip100  = grams > 0 ? (food.lipU  * qty * 100 / grams) : 0;

      // Totaux gardés pour les récap repas et pour le debug.
      food.kcal = Number.isFinite(total.kcal) ? total.kcal : 0;
      food.prot = Number.isFinite(total.prot) ? total.prot : 0;
      food.gluc = Number.isFinite(total.gluc) ? total.gluc : 0;
      food.lip  = Number.isFinite(total.lip)  ? total.lip  : 0;
    } else {
      food.kcal100 = _entryPer100(al, 'kcal100', 'kcal', ['calories100','caloriesPer100']);
      food.prot100 = _entryPer100(al, 'prot100', 'prot', ['proteines100','proteins100','protein100','protPer100']);
      food.gluc100 = _entryPer100(al, 'gluc100', 'gluc', ['glucides100','carbs100','carbohydrates100','glucPer100']);
      food.lip100  = _entryPer100(al, 'lip100', 'lip', ['lipides100','fat100','lipPer100']);
    }

    return (typeof normalizeAliment === 'function') ? normalizeAliment(food) : food;
  };
  const _ensureJournalFoodRow = (al, n) => {
    const food = _makeJournalReplayFood(al, n);
    customAliments.push(food);
    allAliments = [...ALIMENTS_BASE, ...customAliments];
    const idx = allAliments.length - 1;
    if (typeof createRow === 'function') createRow(food, idx, true);
    return idx;
  };

  resetForm();
  if (typeof closeFoodAdvancedPanels === 'function') closeFoodAdvancedPanels({ resetIA: true });
  _removeOldJournalReplayFoods();

  const setVal = (fieldId, val) => {
    const el = document.getElementById(fieldId);
    if (el) el.value = val ?? '';
  };
  setVal('f-date', entry.date);
  setVal('f-poids', entry.poids || '');
  setVal('f-energie', entry.energie || '');
  setVal('f-faim', entry.faim || '');
  setVal('f-notes', entry.notes || '');
  setVal('f-extras', entry.extras || '');

  selected.clear();
  document.querySelectorAll('.aliment-row').forEach(r=>r.classList.remove('selected'));

  const rawEntryFoods = Array.isArray(entry.aliments) ? entry.aliments : (Array.isArray(entry.foods) ? entry.foods : []);

  // Si les totaux sauvegardés par ligne ne retombent pas sur les macros de l'Historique,
  // on garde l'Historique comme source de vérité et on rééchelonne les lignes.
  // Cas typique corrigé : valeurs BDD/OCR relues comme /100g => 20 000 kcal dans le Journal.
  const targetMacros = {
    kcal: _safeNumber(entry.macros && entry.macros.kcal, NaN),
    prot: _safeNumber(entry.macros && entry.macros.prot, NaN),
    gluc: _safeNumber(entry.macros && entry.macros.gluc, NaN),
    lip:  _safeNumber(entry.macros && entry.macros.lip, NaN)
  };
  const savedSums = rawEntryFoods.reduce((s, al) => {
    s.kcal += _safeNumber(al && (al.kcal ?? al.calories ?? al.energy), 0);
    s.prot += _safeNumber(al && (al.prot ?? al.proteines ?? al.protein), 0);
    s.gluc += _safeNumber(al && (al.gluc ?? al.glucides ?? al.carbs), 0);
    s.lip  += _safeNumber(al && (al.lip ?? al.lipides ?? al.fat), 0);
    return s;
  }, {kcal:0, prot:0, gluc:0, lip:0});
  const ratioFor = (key) => {
    const target = targetMacros[key];
    const sum = savedSums[key];
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(sum) || sum <= 0) return 1;
    const ratio = target / sum;
    return (ratio < 0.75 || ratio > 1.25 || Math.abs(sum - target) > (key === 'kcal' ? 80 : 15)) ? ratio : 1;
  };
  const ratios = {kcal:ratioFor('kcal'), prot:ratioFor('prot'), gluc:ratioFor('gluc'), lip:ratioFor('lip')};
  const entryFoods = rawEntryFoods.map(al => {
    if (!al) return al;
    const fixed = {...al};
    if (ratios.kcal !== 1 && Number.isFinite(_safeNumber(fixed.kcal ?? fixed.calories ?? fixed.energy, NaN))) fixed.kcal = _safeNumber(fixed.kcal ?? fixed.calories ?? fixed.energy, 0) * ratios.kcal;
    if (ratios.prot !== 1 && Number.isFinite(_safeNumber(fixed.prot ?? fixed.proteines ?? fixed.protein, NaN))) fixed.prot = _safeNumber(fixed.prot ?? fixed.proteines ?? fixed.protein, 0) * ratios.prot;
    if (ratios.gluc !== 1 && Number.isFinite(_safeNumber(fixed.gluc ?? fixed.glucides ?? fixed.carbs, NaN))) fixed.gluc = _safeNumber(fixed.gluc ?? fixed.glucides ?? fixed.carbs, 0) * ratios.gluc;
    if (ratios.lip !== 1 && Number.isFinite(_safeNumber(fixed.lip ?? fixed.lipides ?? fixed.fat, NaN))) fixed.lip = _safeNumber(fixed.lip ?? fixed.lipides ?? fixed.fat, 0) * ratios.lip;
    return fixed;
  });

  entryFoods.forEach((al, n) => {
    if (!al || !(al.nom || al.name)) return;
    const idx = _ensureJournalFoodRow(al, n);
    if (idx >= 0) {
      const q = _entryQty(al);
      selected.add(idx);
      allAliments[idx].meal = _entryMealId(al);
      allAliments[idx].defaut = q;
      quantities[idx] = q;

      const row = document.getElementById('row-'+idx);
      const qi = document.getElementById('qty-'+idx);
      if (row) row.classList.add('selected');
      if (qi) qi.value = q;
      if (typeof updatePill === 'function') updatePill(idx);
      if (typeof updateUnitHint === 'function') updateUnitHint(idx);
    }
  });

  sportRows.forEach(r=>document.getElementById('sport-row-'+r)?.remove());
  sportRows=[];
  (entry.sports||[]).forEach(s=>addSportRow(s.nom, s.kcalH, s.heures));

  if (typeof renderMealGrouping === 'function') renderMealGrouping();
  updateMacros();

  // Affichage principal = mêmes valeurs que l'Historique.
  // Les lignes aliments restent éditables, mais à l'ouverture d'une journée existante
  // on affiche exactement la synthèse sauvegardée.
  if (entry.macros && typeof updateMacroTile === 'function') {
    const histKcal = _safeNumber(entry.macros.kcal, 0);
    const histProt = _safeNumber(entry.macros.prot, 0);
    const histGluc = _safeNumber(entry.macros.gluc, 0);
    const histLip  = _safeNumber(entry.macros.lip, 0);
    updateMacroTile('m-kcal', histKcal, '', PROFIL.cibleKcal, false);
    updateMacroTile('m-prot', histProt, 'g', PROFIL.cibleProt, true);
    updateMacroTile('m-gluc', histGluc, 'g', PROFIL.cibleGluc, false);
    updateMacroTile('m-lip', histLip, 'g', PROFIL.cibleLip, false);
    const dep = _safeNumber(entry.depSport ?? entry.dep_sport, 0);
    const histNet = _safeNumber(entry.netKcal ?? entry.net_kcal, histKcal - dep);
    const mNet = document.getElementById('m-net');
    if (mNet) {
      mNet.textContent = Math.round(histNet);
      mNet.className = 'macro-val ' + (histNet <= PROFIL.cibleKcal * 1.08 ? 'ok' : 'warn');
      const netTarget = mNet.closest('.macro-cell')?.querySelector('.macro-target');
      if (netTarget) netTarget.textContent = 'après sport · cible ' + PROFIL.cibleKcal;
    }
    const bilanApport = document.getElementById('bilan-apport');
    if (bilanApport) bilanApport.textContent = Math.round(histKcal) + ' kcal';
    if (typeof updateBilan === 'function') updateBilan(histKcal);
    if (typeof updateStickySummary === 'function') updateStickySummary(histKcal, histProt, histGluc, histLip);
  }
  if (typeof foodnoteRefreshJournalMutationViews === 'function') {
    foodnoteRefreshJournalMutationViews('entry-edit-open', { journalCarousel:true, notification:true });
  } else {
    if (typeof renderJournalDayCarousel === 'function') renderJournalDayCarousel();
    if (typeof renderFoodnoteNotificationBadge === 'function') renderFoodnoteNotificationBadge();
  }
  window.scrollTo(0,0);
}

async function deleteEntry(id){
  if(!confirm('Supprimer ?'))return;
  const before = getEntries();
  _db.journal_entries = before.filter(e=>e.id!==id);
  saveLocalOnly();
  renderHistorique();
  try {
    await deleteEntryNative(id);
    showSaveStatus('Entrée supprimée ✓');
  } catch(e) {
    console.warn('DELETE SQLite indisponible, fallback /api/data', e);
    saveEntries(_db.journal_entries);
    showSaveStatus('Supprimé localement / compat', true);
  }
}

function entryFoodLinesForExport(e) {
  return (e && Array.isArray(e.aliments) ? e.aliments : []).map(a => {
    const qty = typeof formatFoodQty === 'function' ? formatFoodQty(a, a.qty) : ((a.qty || 0) + ' ' + (a.unite || 'g'));
    const kcal = Math.round(Number(a.kcal || 0));
    const prot = Number(Number(a.prot || 0).toFixed(1));
    const gluc = Number(Number(a.gluc || 0).toFixed(1));
    const lip = Number(Number(a.lip || 0).toFixed(1));
    return `- ${a.nom || 'Aliment'} : ${qty} — ${kcal} kcal | P ${prot}g | G ${gluc}g | L ${lip}g`;
  });
}

function entrySportLinesForExport(e) {
  return (e && Array.isArray(e.sports) ? e.sports : []).map(s => {
    const h = Number(s.heures || 0);
    const kh = Number(s.kcalH || 0);
    const total = Math.round(Number(s.total || h * kh || 0));
    return `- ${s.nom || 'Sport'} : ${h || 0}h × ${kh || 0} kcal/h = ${total} kcal`;
  });
}

function generateExportText(e) {
  const m = e && e.macros ? e.macros : {};
  const cibleKcal = Number(PROFIL && PROFIL.cibleKcal || 0) || '—';
  const cibleProt = Number(PROFIL && PROFIL.cibleProt || 0) || '—';
  const cibleGluc = Number(PROFIL && PROFIL.cibleGluc || 0) || '—';
  const cibleLip = Number(PROFIL && PROFIL.cibleLip || 0) || '—';
  const foodLines = entryFoodLinesForExport(e).join('\n') || 'Aucun aliment.';
  const sportLines = entrySportLinesForExport(e).join('\n') || 'Aucune activité.';
  const net = Math.round(Number(e.netKcal ?? ((Number(m.kcal || 0)) - Number(e.depSport || 0))));
  return `# Journal nutritionnel — ${formatDate(e.date)}

## Données du jour
- Date : ${formatDate(e.date)}
- Poids : ${e.poids ? e.poids + ' kg' : 'non renseigné'}
- Énergie : ${e.energie || '—'}
- Faim : ${e.faim || '—'}

## Objectifs actifs
- Calories : ${cibleKcal} kcal
- Protéines : ${cibleProt} g
- Glucides : ${cibleGluc} g
- Lipides : ${cibleLip} g

## Alimentation
${foodLines}

## Activité sportive
${sportLines}
- Dépense totale : ${Math.round(Number(e.depSport || 0))} kcal

## Macros
- Calories : ${Math.round(Number(m.kcal || 0))} kcal
- Protéines : ${Number(Number(m.prot || 0).toFixed(1))} g
- Glucides : ${Number(Number(m.gluc || 0).toFixed(1))} g
- Lipides : ${Number(Number(m.lip || 0).toFixed(1))} g
- Net après sport : ${Number.isFinite(net) ? net : Math.round(Number(m.kcal || 0))} kcal

## Notes
${e.notes || e.extras || 'RAS'}`;
}

function historyFilteredEntriesSnapshot(scope) {
  const sorted = sortEntriesDesc(getEntries() || []);
  const maxTs = sorted.length ? entryTs(sorted[0]) : Date.now();
  let entries = sorted;
  const wanted = scope || 'filtered';
  if (wanted === 'filtered') entries = sorted.filter(e => entryMatchesHistoryFilters(e, maxTs));
  else if (wanted === '7d') entries = sorted.filter(e => entryTs(e) >= maxTs - 6 * 86400000);
  else if (wanted === '30d') entries = sorted.filter(e => entryTs(e) >= maxTs - 29 * 86400000);
  else if (wanted === 'month' && sorted.length) {
    const d = new Date(maxTs);
    entries = sorted.filter(e => { const x = new Date(entryTs(e)); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); });
  }
  return { sorted, entries, maxTs };
}

function exportEscapeCsv(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadFoodNoteText(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function foodnoteExportStamp() {
  return new Date().toISOString().slice(0, 10);
}

function entrySummaryRowForCsv(e) {
  const m = e.macros || {};
  return [
    e.date || '',
    formatDate(e.date || ''),
    Math.round(Number(m.kcal || 0)),
    Number(Number(m.prot || 0).toFixed(1)),
    Number(Number(m.gluc || 0).toFixed(1)),
    Number(Number(m.lip || 0).toFixed(1)),
    Math.round(Number(e.depSport || 0)),
    Math.round(Number(e.netKcal ?? (Number(m.kcal || 0) - Number(e.depSport || 0)))),
    e.poids || '',
    e.energie || '',
    e.faim || '',
    (e.aliments || []).length,
    (e.sports || []).length,
    e.notes || e.extras || ''
  ];
}

function buildJournalSummaryCSV(entries) {
  const header = ['date_iso','date','kcal','proteines_g','glucides_g','lipides_g','sport_kcal','net_kcal','poids_kg','energie','faim','nb_aliments','nb_sports','notes'];
  return [header, ...(entries || []).map(entrySummaryRowForCsv)].map(row => row.map(exportEscapeCsv).join(';')).join('\n');
}

function buildJournalFoodsCSV(entries) {
  const header = ['date_iso','date','repas','aliment','quantite','unite','kcal','proteines_g','glucides_g','lipides_g'];
  const rows = [];
  (entries || []).forEach(e => {
    (e.aliments || []).forEach(a => rows.push([
      e.date || '', formatDate(e.date || ''), a.meal || a.repas || '', a.nom || '', a.qty || '', a.unite || 'g',
      Math.round(Number(a.kcal || 0)), Number(Number(a.prot || 0).toFixed(1)), Number(Number(a.gluc || 0).toFixed(1)), Number(Number(a.lip || 0).toFixed(1))
    ]));
  });
  return [header, ...rows].map(row => row.map(exportEscapeCsv).join(';')).join('\n');
}

function buildJournalSportsCSV(entries) {
  const header = ['date_iso','date','sport','heures','kcal_h','total_kcal'];
  const rows = [];
  (entries || []).forEach(e => {
    (e.sports || []).forEach(s => rows.push([
      e.date || '', formatDate(e.date || ''), s.nom || '', s.heures || '', s.kcalH || '', Math.round(Number(s.total || 0))
    ]));
  });
  return [header, ...rows].map(row => row.map(exportEscapeCsv).join(';')).join('\n');
}

function buildJournalTextBundle(entries) {
  const list = entries || [];
  return `# Export FoodNote — ${list.length} journée(s)\nExport généré le ${new Date().toLocaleString('fr-FR')}\n\n` + list.map(generateExportText).join('\n\n---\n\n');
}

function exportScopeFromUI() {
  return document.getElementById('data-export-scope')?.value || 'filtered';
}

function exportEntriesForUI(scope) {
  return historyFilteredEntriesSnapshot(scope || exportScopeFromUI()).entries;
}

function setExportStatus(message, cls) {
  ['data-export-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = message || ''; el.className = 'fn-ui-inline-status ' + (cls || ''); }
  });
}

async function downloadAdvancedExport(kind, forcedScope) {
  const scope = forcedScope || exportScopeFromUI();
  try { if (typeof loadEntriesFullNative === 'function') await loadEntriesFullNative(); } catch(e) { console.warn('[FoodNote] export : détails journées incomplets', e); }
  const entries = exportEntriesForUI(scope);
  if (!entries.length) { setExportStatus('Aucune journée à exporter avec cette sélection.', 'warn'); return; }
  const stamp = foodnoteExportStamp();
  if (kind === 'txt') downloadFoodNoteText(`foodnote_journal_${stamp}.txt`, buildJournalTextBundle(entries), 'text/plain;charset=utf-8');
  else if (kind === 'csv-summary') downloadFoodNoteText(`foodnote_journal_resume_${stamp}.csv`, buildJournalSummaryCSV(entries), 'text/csv;charset=utf-8');
  else if (kind === 'csv-foods') downloadFoodNoteText(`foodnote_journal_aliments_${stamp}.csv`, buildJournalFoodsCSV(entries), 'text/csv;charset=utf-8');
  else if (kind === 'csv-sports') downloadFoodNoteText(`foodnote_journal_sports_${stamp}.csv`, buildJournalSportsCSV(entries), 'text/csv;charset=utf-8');
  else if (kind === 'json-filtered') {
    const payload = { version: 4, type:'foodnote-filtered-journal-export', exportedAt:new Date().toISOString(), scope, journal_entries: entries, entries };
    downloadFoodNoteText(`foodnote_journal_filtre_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  }
  setExportStatus(`Export ${kind} lancé : ${entries.length} journée(s).`, 'ok');
}

async function copyAdvancedExportText(forcedScope) {
  try { if (typeof loadEntriesFullNative === 'function') await loadEntriesFullNative(); } catch(e) { console.warn('[FoodNote] copie export : détails journées incomplets', e); }
  const entries = exportEntriesForUI(forcedScope);
  if (!entries.length) { setExportStatus('Aucune journée à copier.', 'warn'); return; }
  const txt = buildJournalTextBundle(entries);
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(txt);
    else throw new Error('clipboard indisponible');
    setExportStatus(`Texte copié : ${entries.length} journée(s).`, 'ok');
  } catch(e) {
    const w = window.open('', '_blank');
    if (w) w.document.write('<pre style="white-space:pre-wrap;padding:1rem">' + htmlEscape(txt) + '</pre>');
    setExportStatus('Copie automatique impossible : texte ouvert dans un nouvel onglet.', 'warn');
  }
}

function renderAdvancedExportPanel(targetId, opts = {}) {
  const root = document.getElementById(targetId);
  const ui = FNUI();
  if (!root) return;
  const snapshot = historyFilteredEntriesSnapshot(opts.defaultScope || 'filtered');
  const entries = snapshot.entries;
  const all = snapshot.sorted;
  const prefix = targetId === 'data-export-advanced' ? 'data-' : '';
  const selectId = prefix + 'export-scope';
  const statusId = prefix + 'export-status';
  const titleTag = opts.compact ? 'h2' : 'h1';
  root.innerHTML = `
    <div class="fn-ui-title-row">
      <div class="fn-ui-title-left">
        <span class="fn-ui-icon" aria-hidden="true">📤</span>
        <div>
          <span class="fn-ui-kicker">Export avancé</span>
          <${titleTag} class="fn-ui-title${opts.compact ? ' fn-ui-title-inline' : ''}">Historique lisible</${titleTag}>
          <p class="fn-ui-sub">Exporte les journées filtrées, tout le journal, ou les 7/30 derniers jours. SQLite reste la sauvegarde officielle.</p>
        </div>
      </div>
      <span class="fn-ui-chip fn-ui-chip-kcal">${entries.length}/${all.length} journée(s)</span>
    </div>
    <div class="fn-ui-export-grid">
      <label class="fn-ui-field">Sélection
        <select id="${selectId}" onchange="renderExportSelectionInfo('${targetId}')">
          <option value="filtered">Résultats filtrés dans Historique</option>
          <option value="all">Tout le journal</option>
          <option value="7d">7 derniers jours saisis</option>
          <option value="30d">30 derniers jours saisis</option>
          <option value="month">Mois de la dernière saisie</option>
        </select>
      </label>
      <div id="${prefix}export-selection-info" class="fn-ui-export-info"></div>
    </div>
    <div class="fn-ui-actions fn-ui-wrap fn-ui-export-actions">
      <button class="fn-ui-button fn-ui-button-primary" type="button" onclick="downloadAdvancedExport('txt')">⬇ Texte complet</button>
      <button class="fn-ui-button" type="button" onclick="downloadAdvancedExport('csv-summary')">⬇ CSV résumé</button>
      <button class="fn-ui-button" type="button" onclick="downloadAdvancedExport('csv-foods')">⬇ CSV aliments</button>
      <button class="fn-ui-button" type="button" onclick="downloadAdvancedExport('csv-sports')">⬇ CSV sport</button>
      <button class="fn-ui-button" type="button" onclick="downloadAdvancedExport('json-filtered')">⬇ JSON filtré</button>
      <button class="fn-ui-button" type="button" onclick="copyAdvancedExportText()">Copier texte</button>
    </div>
    <div id="${statusId}" class="fn-ui-inline-status"></div>`;
  renderExportSelectionInfo(targetId);
}

function renderExportSelectionInfo(targetId) {
  const prefix = targetId === 'data-export-advanced' ? 'data-' : '';
  const scope = document.getElementById(prefix + 'export-scope')?.value || 'filtered';
  const info = document.getElementById(prefix + 'export-selection-info');
  const entries = historyFilteredEntriesSnapshot(scope).entries;
  const countFoods = entries.reduce((n,e) => n + ((e.aliments || []).length), 0);
  const countSports = entries.reduce((n,e) => n + ((e.sports || []).length), 0);
  const first = entries.length ? entries[entries.length - 1].date : null;
  const last = entries.length ? entries[0].date : null;
  if (info) info.innerHTML = entries.length
    ? `<strong>${entries.length}</strong> journée(s) · <strong>${countFoods}</strong> aliment(s) · <strong>${countSports}</strong> sport(s)<br><small>${formatDate(first)} → ${formatDate(last)}</small>`
    : '<strong>0</strong> journée avec cette sélection<br><small>Change la période ou réinitialise les filtres Historique.</small>';
}

function renderHistoryExportBar(entries) {
  const ui = FNUI();
  const totalFoods = (entries || []).reduce((n,e) => n + ((e.aliments || []).length), 0);
  return ui.panel({ className:'fn-ui-export-mini', children:
    ui.sectionHead('📤 Export des résultats filtrés', `${(entries || []).length} journée(s) · ${totalFoods} aliment(s)`) +
    `<div class="fn-ui-actions fn-ui-wrap">
      <button class="fn-ui-button fn-ui-button-primary" type="button" onclick="downloadAdvancedExport('csv-summary','filtered')">CSV résumé</button>
      <button class="fn-ui-button" type="button" onclick="downloadAdvancedExport('csv-foods','filtered')">CSV aliments</button>
      <button class="fn-ui-button" type="button" onclick="downloadAdvancedExport('txt','filtered')">Texte complet</button>
      <button class="fn-ui-button" type="button" onclick="copyAdvancedExportText('filtered')">Copier texte</button>
    </div>
    <div class="fn-ui-muted">Ces boutons reprennent les filtres visibles de l’historique : recherche, période et type.</div>`
  });
}

/*
 * L'ancienne page Export autonome a été supprimée.
 * L'export lisible reste disponible dans :
 * - Historique, via la barre d'export des résultats filtrés ;
 * - Données, via le panneau `data-export-advanced`.
 */

function ensureHistoryRawTextModal(){
  let modal = document.getElementById('history-raw-text-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'history-raw-text-modal';
  modal.className = 'fn-ui-raw-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="fn-ui-raw-backdrop" onclick="closeHistoryRawText()"></div>
    <div class="fn-ui-raw-card" role="dialog" aria-modal="true" aria-label="Texte brut de la journée">
      <div class="fn-ui-raw-head">
        <div>
          <strong>📝 Texte brut</strong>
          <small>Copiable dans une note, un message ou une IA si besoin.</small>
        </div>
        <button type="button" class="fn-ui-raw-close" onclick="closeHistoryRawText()" aria-label="Fermer">×</button>
      </div>
      <textarea id="history-raw-textarea" readonly spellcheck="false"></textarea>
      <div class="fn-ui-raw-actions">
        <button type="button" class="fn-ui-button fn-ui-button-primary" onclick="copyHistoryRawText()">Copier le texte</button>
        <button type="button" class="fn-ui-button" onclick="downloadHistoryRawText()">Télécharger .txt</button>
        <button type="button" class="fn-ui-button" onclick="closeHistoryRawText()">Fermer</button>
      </div>
      <div id="history-raw-status" class="fn-ui-inline-status"></div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function openHistoryRawText(id){
  const e = getEntries().find(e=>String(e.id)===String(id));
  if(!e) return;
  const modal = ensureHistoryRawTextModal();
  const txt = generateExportText(e);
  const area = modal.querySelector('#history-raw-textarea');
  const st = modal.querySelector('#history-raw-status');
  if (area) area.value = txt;
  if (st) st.textContent = '';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  setTimeout(()=>{ try { area && area.focus({preventScroll:true}); area && area.select(); } catch(_){} }, 30);
}
function closeHistoryRawText(){
  const modal = document.getElementById('history-raw-text-modal');
  if(!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
}
async function copyHistoryRawText(){
  const area = document.getElementById('history-raw-textarea');
  const st = document.getElementById('history-raw-status');
  const txt = area ? area.value : '';
  if(!txt) return;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(txt);
    else {
      area.focus(); area.select();
      document.execCommand('copy');
    }
    if (st) { st.textContent = 'Texte copié ✓'; st.className = 'fn-ui-inline-status ok'; }
  } catch(e) {
    if (st) { st.textContent = 'Copie automatique impossible : sélectionne le texte puis copie-le.'; st.className = 'fn-ui-inline-status warn'; }
  }
}
function downloadHistoryRawText(){
  const area = document.getElementById('history-raw-textarea');
  const txt = area ? area.value : '';
  if(!txt) return;
  const firstLine = (txt.split('\n')[0] || 'foodnote').replace(/[^a-z0-9_-]+/gi, '_').slice(0,60);
  downloadFoodNoteText(firstLine + '.txt', txt, 'text/plain;charset=utf-8');
}
function exportSingle(id){ openHistoryRawText(id); }
function exportJournalCSV(){ downloadAdvancedExport('csv-summary'); }
function renderBDD() {
  renderUnitWeights();
  const bdd = getBDD();
  const note = document.getElementById('bdd-recovery-note');
  if (note) {
    note.textContent = _db._foods_recovered_preview_used
      ? `Base aliments SQLite vide : aperçu reconstruit depuis l’historique (${_db._foods_recovered_preview_count || bdd.length} aliments). Clique “Récupérer depuis l’historique” pour l’enregistrer réellement.`
      : '';
  }
  const tbody = document.getElementById('bdd-table');
  if (!bdd.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:1rem">Aucun aliment sauvegardé.</td></tr>'; return; }
  tbody.innerHTML = bdd.map(b => {
    const id = Number(b.id) || b.id;
    const baseBadge = b.base ? ' <span class="fn-ui-chip fn-ui-chip-gluc">base</span>' : '';
    const name = htmlEscape(b.nom || 'Aliment');
    const unitLabel = htmlEscape(b.uniteLabel || '');
    return `
    <tr id="bdd-row-${id}" class="fn-ui-row fn-ui-row--database fn-ui-row--interactive fn-ui-row--expandable bdd-food-row">
      <td><strong>${name}</strong>${baseBadge}</td>
      <td class="num">🔥 ${htmlEscape(b.kcal100)}</td>
      <td class="num">🍖 ${+(Math.round((Number(b.prot100)||0)*10)/10)}g</td>
      <td class="num">🍞 ${+(Math.round((Number(b.gluc100)||0)*10)/10)}g</td>
      <td class="num">🥑 ${+(Math.round((Number(b.lip100)||0)*10)/10)}g</td>
      <td class="fn-ui-row-actions">
        <button class="del-btn edit-btn" onclick="editBDDRow(${id})" title="Modifier" aria-label="Modifier ${name}">✎</button>
        <button class="del-btn" onclick="deleteBDDRow(${id})" title="Supprimer" aria-label="Supprimer ${name}">✕</button>
      </td>
    </tr>
    <tr id="bdd-er-${id}" class="fn-ui-row-detail bdd-food-edit-row" style="display:none"><td colspan="6">
      <div class="fn-ui-row-detail-box">
        <span class="edit-lbl">Nom</span><input id="be-n-${id}" type="text" value="${name}">
        <span class="edit-lbl">Kcal/100g</span><input id="be-k-${id}" type="number" value="${htmlEscape(b.kcal100)}">
        <span class="edit-lbl">Prot</span><input id="be-p-${id}" type="number" step="0.1" value="${+(Math.round((Number(b.prot100)||0)*10)/10)}">
        <span class="edit-lbl">Gluc</span><input id="be-g-${id}" type="number" step="0.1" value="${+(Math.round((Number(b.gluc100)||0)*10)/10)}">
        <span class="edit-lbl">Lip</span><input id="be-l-${id}" type="number" step="0.1" value="${+(Math.round((Number(b.lip100)||0)*10)/10)}">
        <span class="edit-lbl">Poids/unité</span><input id="be-w-${id}" type="number" step="1" min="0" value="${b.poidsUnite ? Math.round(Number(b.poidsUnite)) : 0}">
        <span class="edit-lbl">Libellé</span><input id="be-ul-${id}" type="text" value="${unitLabel}" placeholder="banane">
        <button class="fn-ui-button fn-ui-button-primary" onclick="saveBDDRow(${id})">OK</button>
      </div>
    </td></tr>`;
  }).join('');
}

function editBDDRow(id){
  const er=document.getElementById('bdd-er-'+id);
  const row=document.getElementById('bdd-row-'+id);
  if(!er)return;
  const open = er.style.display !== 'table-row';
  er.style.display = open ? 'table-row' : 'none';
  if(row) row.classList.toggle('is-open', open);
}
async function saveBDDRow(id){
  const bdd=getBDD();
  const idx=bdd.findIndex(b=>String(b.id)===String(id));
  if(idx<0){ showSaveStatus && showSaveStatus('Aliment introuvable dans la base', true); return; }
  const next = {...bdd[idx]};
  next.nom=document.getElementById('be-n-'+id).value.trim()||bdd[idx].nom;
  next.kcal100=parseFloat(document.getElementById('be-k-'+id).value)||0;
  next.prot100=parseFloat(document.getElementById('be-p-'+id).value)||0;
  next.gluc100=parseFloat(document.getElementById('be-g-'+id).value)||0;
  next.lip100=parseFloat(document.getElementById('be-l-'+id).value)||0;
  const w=parseFloat(document.getElementById('be-w-'+id)?.value)||0;
  const ul=(document.getElementById('be-ul-'+id)?.value||'').trim();
  next.poidsUnite=w>0?w:null;
  next.uniteLabel=w>0?(ul || bdd[idx].uniteLabel || next.nom):'';
  next.unite=w>0?(bdd[idx].unite && bdd[idx].unite !== 'g' ? bdd[idx].unite : 'unité'):'g';
  if (typeof foodnoteValidateFoodBeforeSave === 'function' && !foodnoteValidateFoodBeforeSave(next, {title:'Base aliments : valeur impossible ou suspecte'})) return;
  bdd[idx]=next;
  saveBDD(bdd);
  refreshDBSelect();
  renderBDD();
  try {
    const saved = await saveSingleFoodNativeNow(next);
    if (saved) showSaveStatus && showSaveStatus('Fiche aliment enregistrée SQLite ✓');
    refreshDBSelect();
    renderBDD();
  } catch(e) {
    console.warn('/api/foods sauvegarde immédiate impossible', e);
    showSaveStatus && showSaveStatus('Fiche gardée localement, synchro différée', true);
  }
}
async function deleteBDDRow(id){
  if(!confirm('Supprimer de la BDD ?'))return;
  const before = getBDD();
  const target = before.find(b => String(b.id) === String(id));
  _db.bdd_aliments = before.filter(b => String(b.id) !== String(id));
  try { if (typeof invalidateFoodSearchCache === 'function') invalidateFoodSearchCache(); } catch(e) {}
  saveFoodnoteDbLocalCache();
  refreshDBSelect();
  renderBDD();
  if (target) {
    try {
      const numericId = Number(target.id);
      let r;
      if (Number.isFinite(numericId) && numericId > 0) {
        // Id SQLite réel : suppression par id, avec le nom en filet de sécurité pour créer un tombstone.
        const nameQs = target.nom ? ('?name=' + encodeURIComponent(target.nom)) : '';
        r = await fetch('/api/foods/' + encodeURIComponent(numericId) + nameQs, { method:'DELETE' });
      } else {
        // Aliment issu d'un aperçu reconstruit depuis l'historique, ou aliment local sans id stable.
        // On supprime par nom + tombstone serveur, sinon il réapparaît au prochain rafraîchissement.
        r = await fetch('/api/foods/delete', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ name: target.nom || target.name || '' })
        });
      }
      if (!r.ok) throw new Error('Suppression /api/foods impossible');
      showSaveStatus('Aliment supprimé SQLite ✓');
    } catch(e) {
      console.warn('/api/foods delete indisponible, suppression gardée localement', e);
      showSaveStatus('Suppression locale seulement', true);
    }
  }
}

async function rebuildFoodsFromEntriesUI() {
  if (!confirm('Récupérer les aliments depuis les journées existantes ?\n\nCela n’écrase pas les journées. Les aliments déjà présents seront conservés.')) return;
  try {
    const r = await fetch('/api/admin/rebuild-foods-from-entries', { method:'POST' });
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || 'Erreur reconstruction aliments');
    _db.bdd_aliments = normalizeFoodListForClient(d.foods || []);
    saveFoodnoteDbLocalCache();
    refreshDBSelect();
    renderBDD();
    showSaveStatus(`Aliments récupérés depuis l’historique : ${d.inserted || 0}`);
  } catch(e) {
    alert('Impossible de récupérer les aliments : ' + e.message);
  }
}

function renderUnitWeights() {
  const box = document.getElementById('unit-weights-box');
  if (!box) return;
  let rows = [];
  try {
    rows = getUnitWeights().slice().sort((a,b) => String(a.label).localeCompare(String(b.label), 'fr'));
  } catch(e) {
    rows = [];
  }
  const listHtml = rows.length ? rows.map(r => `
        <div class="fn-ui-row fn-ui-row--database unit-weight-row" id="uw-row-${r.id || normalizeUnitText(r.label)}">
          <input id="uwl-${r.id}" value="${escapeHtml(r.label)}" title="Libellé affiché">
          <input id="uwg-${r.id}" type="number" min="1" step="1" value="${Math.round(Number(r.grams)||0)}" title="Grammes par unité">
          <input id="uwa-${r.id}" value="${escapeHtml((r.aliases || [r.label]).join(', '))}" title="Alias séparés par virgules">
          <button onclick="saveUnitWeightRow(${r.id || 0}, '${String(r.label).replace(/'/g, "\\'")}')">OK</button>
          <button class="del-btn" onclick="deleteUnitWeightRow(${r.id || 0}, '${String(r.label).replace(/'/g, "\\'")}')">✕</button>
        </div>`).join('') : `
        <div class="empty-note" style="font-size:13px;color:var(--text3);padding:10px;border:1px dashed var(--border2);border-radius:10px">
          Aucun poids par unité chargé pour l’instant. Ajoute une ligne, ou vérifie <code>/api/unit-weights</code> si tu viens de redémarrer.
        </div>`;
  box.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:10px">
      <div style="flex:1;min-width:130px"><label style="font-size:12px;color:var(--text3)">Libellé</label><input id="uw-label" type="text" placeholder="ex: fraise" style="width:100%"></div>
      <div style="width:95px"><label style="font-size:12px;color:var(--text3)">Grammes</label><input id="uw-grams" type="number" min="1" step="1" placeholder="15" style="width:100%"></div>
      <div style="flex:2;min-width:170px"><label style="font-size:12px;color:var(--text3)">Alias</label><input id="uw-aliases" type="text" placeholder="fraise, fraises" style="width:100%"></div>
      <button class="btn-primary" onclick="addUnitWeightRow()" style="padding:7px 12px">Ajouter</button>
    </div>
    <div class="unit-weight-list">${listHtml}</div>
    <div style="font-size:12px;color:var(--text4);margin-top:8px">Cette table sert à proposer automatiquement “1 unité ≈ Xg”. Tu peux toujours basculer une ligne en grammes si tu as pesé.</div>`;
}

async function persistUnitWeights(rows) {
  try {
    const saved = await saveUnitWeightsNativeNow(rows);
    renderUnitWeights();
    showSaveStatus('Poids par unité SQLite ✓');
    return saved;
  } catch(e) {
    console.warn('/api/unit-weights indisponible, sauvegarde locale', e);
    if (typeof setUnitWeights === 'function') setUnitWeights(rows);
    safeLocalSet('foodnote_unit_weights', JSON.stringify(rows));
    renderUnitWeights();
    showSaveStatus('Poids par unité local', true);
    return rows;
  }
}

function collectUnitWeightRows() {
  return getUnitWeights().map(r => ({...r, aliases:[...(r.aliases || [r.label])]}));
}

function addUnitWeightRow() {
  const label = document.getElementById('uw-label')?.value.trim();
  const grams = parseFloat(document.getElementById('uw-grams')?.value);
  const aliases = (document.getElementById('uw-aliases')?.value || label || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!label || !Number.isFinite(grams) || grams <= 0) { alert('Indique un libellé et un poids en grammes.'); return; }
  const rows = collectUnitWeightRows().filter(r => normalizeUnitText(r.label) !== normalizeUnitText(label));
  rows.push({label, grams, aliases:[...new Set([label, ...aliases])], source:'user'});
  persistUnitWeights(rows);
}

function saveUnitWeightRow(id, oldLabel) {
  const prefix = id || 0;
  const label = document.getElementById('uwl-'+prefix)?.value.trim() || oldLabel;
  const grams = parseFloat(document.getElementById('uwg-'+prefix)?.value);
  const aliases = (document.getElementById('uwa-'+prefix)?.value || label).split(',').map(s => s.trim()).filter(Boolean);
  if (!label || !Number.isFinite(grams) || grams <= 0) { alert('Poids invalide.'); return; }
  if (grams > 5000) { alert('❌ Poids par unité aberrant : ' + Math.round(grams) + 'g. Maximum accepté : 5000g.'); return; }
  if (grams > 1000 && !confirm('⚠️ 1 unité = ' + Math.round(grams) + 'g, c’est très élevé. Garder quand même ?')) return;
  const rows = collectUnitWeightRows().map(r => ((id && r.id === id) || (!id && r.label === oldLabel)) ? {...r, label, grams, aliases:[...new Set([label, ...aliases])], source:'user'} : r);
  persistUnitWeights(rows);
}

function deleteUnitWeightRow(id, label) {
  if (!confirm('Supprimer cette correspondance unité → grammes ?')) return;
  const rows = collectUnitWeightRows().filter(r => id ? r.id !== id : r.label !== label);
  persistUnitWeights(rows);
}


// ── Stockage serveur ──────────────────────────────────────────
let _db = { journal_entries:[], custom_aliments:[], bdd_aliments:[], sports_config:[], bdd_seed_version:0 };
let _saveTimer = null;
const FOODNOTE_CLIENT_ID_KEY = 'foodnote_client_id';
function getFoodnoteClientId() {
  let id = safeLocalGet(FOODNOTE_CLIENT_ID_KEY, '');
  if (!id) {
    id = 'client-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    safeLocalSet(FOODNOTE_CLIENT_ID_KEY, id);
  }
  return id;
}

function sortEntriesDesc(entries) {
  return (entries || []).slice().sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || ((b.id || 0) - (a.id || 0)));
}

function foodnoteRecalcDetailedEntryMacrosNative(entry) {
  if (!entry || !Array.isArray(entry.aliments)) return entry;
  const n = (v) => {
    const x = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(x) ? x : 0;
  };
  const sums = entry.aliments.reduce((acc, food) => {
    acc.kcal += n(food && food.kcal);
    acc.prot += n(food && food.prot);
    acc.gluc += n(food && food.gluc);
    acc.lip  += n(food && food.lip);
    return acc;
  }, { kcal:0, prot:0, gluc:0, lip:0 });
  const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
  const depSport = n(entry.depSport ?? entry.dep_sport);
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
window.foodnoteRecalcDetailedEntryMacrosNative = foodnoteRecalcDetailedEntryMacrosNative;

function normalizeServerEntry(e) {
  if (!e) return e;
  // 0.22.37 — moteur historique : une journée issue d'un résumé `details=0`
  // ne doit jamais être considérée comme chargée simplement parce qu'une ancienne
  // couche cache lui a ajouté `aliments: []`. Sinon l'historique affiche
  // faussement "Aucun aliment enregistré" et `Corriger` ne recharge pas le détail.
  const explicitDetails = e._detailsLoaded === true || e.detailsLoaded === true || e.__detailsLoaded === true;
  const explicitSummary = e._detailsLoaded === false || e.detailsLoaded === false || e.__summaryOnly === true || e.details === false || e._summaryOnly === true;
  const hasFoodDetails = !explicitSummary && Object.prototype.hasOwnProperty.call(e, 'aliments') && Array.isArray(e.aliments);
  const hasSportDetails = !explicitSummary && Object.prototype.hasOwnProperty.call(e, 'sports') && Array.isArray(e.sports);
  const detailsLoaded = explicitDetails || hasFoodDetails || hasSportDetails;
  const aliments = detailsLoaded && Array.isArray(e.aliments) ? e.aliments : [];
  const sports = detailsLoaded && Array.isArray(e.sports) ? e.sports : [];
  const out = {
    ...e,
    depSport: e.depSport ?? e.dep_sport ?? 0,
    netKcal: e.netKcal ?? e.net_kcal ?? (e.macros ? e.macros.kcal : 0),
    aliments,
    sports,
    foodCount: Number(e.foodCount ?? e.food_count ?? e.aliments_count ?? aliments.length ?? 0) || 0,
    sportCount: Number(e.sportCount ?? e.sport_count ?? sports.length ?? 0) || 0,
    _detailsLoaded: !!detailsLoaded,
    _summaryOnly: !detailsLoaded,
    macros: e.macros || {kcal:e.kcal || 0, prot:e.prot || 0, gluc:e.gluc || 0, lip:e.lip || 0},
    revision: Number(e.revision ?? e._revision ?? 0) || 0,
    _revision: Number(e._revision ?? e.revision ?? 0) || 0,
    updated_at: e.updated_at || e.updatedAt || null,
  };
  // 0.22.154 : quand les lignes détaillées sont disponibles, elles sont la vérité.
  // Après une suppression atomique/fallback, le serveur peut renvoyer une journée avec
  // `aliments` à jour mais des macros résumé encore anciennes. On recalcule donc ici
  // pour que Récap / badges / tendances ne gardent pas les calories supprimées.
  if (detailsLoaded && Array.isArray(out.aliments)) foodnoteRecalcDetailedEntryMacrosNative(out);
  return out;
}



async function loadEntriesNative() {
  // Démarrage très léger : on charge d'abord des résumés sans aliments/sports,
  // puis seulement le détail de la journée du jour. Les autres journées sont
  // détaillées à la demande quand on clique dessus.
  const today = (typeof foodnoteLocalISODate === 'function') ? foodnoteLocalISODate() : new Date().toISOString().slice(0,10);
  const summaryUrl = '/api/entries?limit=21&details=0';
  const r = await foodnoteFetchTimeout(summaryUrl, { cache:'no-store' }, 1800);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' sur ' + summaryUrl);
  const d = await r.json();
  const summaryRows = Array.isArray(d.entries) ? d.entries : [];
  let entries = summaryRows.map(row => normalizeServerEntry({ ...row, aliments: undefined, sports: undefined, _detailsLoaded:false, _summaryOnly:true }));

  try {
    const detailUrl = '/api/entries?from=' + encodeURIComponent(today) + '&to=' + encodeURIComponent(today) + '&limit=1&details=1';
    const rd = await foodnoteFetchTimeout(detailUrl, { cache:'no-store' }, 1400);
    if (rd.ok) {
      const dd = await rd.json();
      const detailRows = Array.isArray(dd.entries) ? dd.entries : [];
      for (const row of detailRows) {
        const detail = normalizeServerEntry({ ...row, _detailsLoaded:true });
        const idx = entries.findIndex(e => String(e.id) === String(detail.id) || e.date === detail.date);
        if (idx >= 0) entries[idx] = { ...entries[idx], ...detail, _detailsLoaded:true };
        else entries.unshift(detail);
      }
    }
  } catch(e) {
    console.warn('[FoodNote] détail journée du jour différé', e);
  }

  _db.journal_entries = sortEntriesDesc(entries);
  _db._storage_mode = 'sqlite-native';
  _db._entries_source = summaryUrl;
  _db._entries_full_loaded = false;
}

let _entriesFullLoadPromise = null;
async function loadEntriesFullNative(force = false) {
  if (_db._entries_full_loaded && !force) return _db.journal_entries || [];
  if (_entriesFullLoadPromise && !force) return _entriesFullLoadPromise;
  _entriesFullLoadPromise = (async () => {
    const r = await fetch('/api/entries?limit=1000&details=1', { cache:'no-store' });
    if (!r.ok) throw new Error('Erreur GET /api/entries complet');
    const d = await r.json();
    const rows = Array.isArray(d.entries) ? d.entries : [];
    _db.journal_entries = sortEntriesDesc(rows.map(normalizeServerEntry));
    _db._entries_full_loaded = true;
    saveFoodnoteDbLocalCache();
    return _db.journal_entries || [];
  })().catch(e => { _entriesFullLoadPromise = null; throw e; });
  return _entriesFullLoadPromise;
}
window.loadEntriesFullNative = loadEntriesFullNative;

async function postEntryNative(entry, options = {}) {
  if (window.FOODNOTE_DEBUG_SYNC) console.debug('[FoodNote] POST /api/entries start', entry && entry.date, options && options.force ? 'force=1' : '');
  const url = options && options.force ? '/api/entries?force=1' : '/api/entries';
  const payload = {
    ...entry,
    client_id: getFoodnoteClientId(),
    write_id: 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    ...(options && options.force ? {force:true} : {})
  };
  const r = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  if (window.FOODNOTE_DEBUG_SYNC) console.debug('[FoodNote] POST /api/entries response', r.status);
  if (!r.ok) {
    let data = null;
    let msg = 'Erreur POST /api/entries';
    try { data = await r.json(); msg = data.error || msg; } catch(e) {}
    const err = new Error(msg);
    err.status = r.status;
    err.code = data && data.code;
    err.data = data;
    throw err;
  }
  const d = await r.json();
  return normalizeServerEntry(d.entry || entry);
}



async function postEntrySportsNative(date, sports, options = {}) {
  if (!date) throw new Error('date obligatoire');
  const cleanSports = (Array.isArray(sports) ? sports : []).filter(Boolean).map(s => ({
    nom: s.nom || s.name || s.label || 'Sport',
    heures: Number(s.heures ?? s.hours ?? s.duree ?? s.duration ?? 0) || 0,
    kcalH: Number(s.kcalH ?? s.kcal_h ?? s.kcal_horaire ?? 0) || 0,
    total: Math.round(Number(s.total ?? 0) || ((Number(s.heures ?? s.hours ?? 0) || 0) * (Number(s.kcalH ?? s.kcal_h ?? 0) || 0)))
  })).filter(s => Number(s.total || 0) > 0 && (Number(s.heures || 0) > 0 || Number(s.kcalH || 0) > 0));
  const payload = {
    date,
    sports: cleanSports,
    __replaceSports: true,
    _detailsLoaded: true,
    client_id: typeof getFoodnoteClientId === 'function' ? getFoodnoteClientId() : undefined,
    write_id: 'sport-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    ...(options || {})
  };
  const r = await fetch('/api/entries/' + encodeURIComponent(date) + '/sports', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload),
    cache:'no-store'
  });
  if (!r.ok) {
    let data = null;
    let msg = 'Erreur POST /api/entries/:date/sports';
    try { data = await r.json(); msg = data.error || msg; } catch(e) {}
    const err = new Error(msg);
    err.status = r.status;
    err.code = data && data.code;
    err.data = data;
    throw err;
  }
  const d = await r.json();
  return normalizeServerEntry(d.entry || { date, sports: cleanSports, depSport: cleanSports.reduce((sum, s) => sum + (Number(s.total) || 0), 0), _detailsLoaded:true });
}
window.postEntrySportsNative = postEntrySportsNative;


async function postEntryFoodNative(date, food, options = {}) {
  if (!date) throw new Error('date obligatoire');
  if (!food || !food.nom) throw new Error('aliment obligatoire');
  const payload = {
    food,
    ...(options && options.form ? options.form : {}),
    client_id: getFoodnoteClientId(),
    write_id: 'wf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  };
  const r = await fetch('/api/entries/' + encodeURIComponent(date) + '/foods', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  if (!r.ok) {
    let data = null;
    let msg = 'Erreur POST /api/entries/:date/foods';
    try { data = await r.json(); msg = data.error || msg; } catch(e) {}
    const err = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  const d = await r.json();
  const entry = normalizeServerEntry(d.entry);
  if (d.food) entry._savedFood = d.food;
  return entry;
}


async function patchEntryFoodNative(id, food, options = {}) {
  if (!id) throw new Error('id ligne aliment obligatoire');
  const payload = {
    ...(food || {}),
    ...(options && options.form ? options.form : {}),
    client_id: getFoodnoteClientId(),
    write_id: 'wfp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  };
  const r = await fetch('/api/entry-foods/' + encodeURIComponent(id), {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
  });
  if (!r.ok) {
    let data = null; let msg = 'Erreur PATCH /api/entry-foods';
    try { data = await r.json(); msg = data.error || msg; } catch(e) {}
    const err = new Error(msg); err.status = r.status; err.data = data; throw err;
  }
  const d = await r.json();
  const entry = normalizeServerEntry(d.entry);
  if (d.food) entry._savedFood = d.food;
  return entry;
}

async function deleteEntryFoodNative(id) {
  if (!id) throw new Error('id ligne aliment obligatoire');
  const r = await fetch('/api/entry-foods/' + encodeURIComponent(id), { method:'DELETE' });
  if (!r.ok) {
    let data = null; let msg = 'Erreur DELETE /api/entry-foods';
    try { data = await r.json(); msg = data.error || msg; } catch(e) {}
    const err = new Error(msg); err.status = r.status; err.data = data; throw err;
  }
  const d = await r.json();
  return normalizeServerEntry(d.entry);
}

async function deleteEntryFoodNativeByLineUid(date, lineUid) {
  if (!date) throw new Error('date obligatoire');
  if (!lineUid) throw new Error('line_uid obligatoire');
  const url = '/api/entries/' + encodeURIComponent(date) + '/foods/by-line/' + encodeURIComponent(lineUid);
  const r = await fetch(url, { method:'DELETE' });
  if (!r.ok) {
    let data = null; let msg = 'Erreur DELETE /api/entries/:date/foods/by-line/:line_uid';
    try { data = await r.json(); msg = data.error || msg; } catch(e) {}
    const err = new Error(msg); err.status = r.status; err.data = data; throw err;
  }
  const d = await r.json();
  return normalizeServerEntry(d.entry);
}


async function deleteEntryFoodNativeByMatch(date, match) {
  if (!date) throw new Error('date obligatoire');
  let apiErr = null;
  try {
    const r = await fetch('/api/entries/' + encodeURIComponent(date) + '/foods/delete-match', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ food: match || {} })
    });
    if (r.ok) {
      const d = await r.json();
      return normalizeServerEntry(d.entry);
    }
    let data = null; let msg = 'Erreur POST /api/entries/:date/foods/delete-match';
    try { data = await r.json(); msg = data.error || msg; } catch(e) {}
    apiErr = new Error(msg); apiErr.status = r.status; apiErr.data = data;
    if (Number(r.status) !== 404) throw apiErr;
  } catch(e) {
    apiErr = e;
    if (Number(e && e.status) !== 404 && !/404|not found|introuvable/i.test(String(e && e.message || ''))) throw e;
  }

  // 0.22.151 : fallback sans route serveur dédiée. On relit la journée complète,
  // on supprime la meilleure ligne correspondante, puis on sauvegarde la journée détaillée.
  function norm(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function num(v) { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; }
  function mealOf(f) { return String(f?.meal || f?.repas || f?.mealId || match?.meal || match?.repas || 'lunch').trim(); }
  function scoreFood(f) {
    const lineUid = String(match?.line_uid || match?.lineUid || '').trim();
    if (lineUid && String(f?.line_uid || f?.lineUid || '').trim() === lineUid) return 999;
    const targetName = norm(match?.nom || match?.name || match?.name_snapshot);
    const rowName = norm(f?.nom || f?.name || f?.name_snapshot);
    let score = 0;
    if (targetName && rowName === targetName) score += 60;
    else if (targetName && rowName && (rowName.includes(targetName) || targetName.includes(rowName))) score += 35;
    if (String(mealOf(f)) === String(match?.meal || match?.repas || mealOf(f))) score += 20;
    const targetQty = num(match?.qty ?? match?.defaut ?? match?.quantity);
    const qtyDiff = Math.abs(num(f?.qty ?? f?.defaut ?? f?.quantity) - targetQty);
    if (targetQty > 0 && qtyDiff <= 0.5) score += 15;
    else if (targetQty > 0 && qtyDiff <= 5) score += 8;
    const macroDiff = Math.abs(num(f?.kcal) - num(match?.kcal)) + Math.abs(num(f?.prot) - num(match?.prot)) + Math.abs(num(f?.gluc) - num(match?.gluc)) + Math.abs(num(f?.lip) - num(match?.lip));
    if ((num(match?.kcal) || num(match?.prot) || num(match?.gluc) || num(match?.lip)) && macroDiff <= 2) score += 18;
    else if ((num(match?.kcal) || num(match?.prot) || num(match?.gluc) || num(match?.lip)) && macroDiff <= 8) score += 9;
    return score;
  }

  const url = '/api/entries?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date) + '&limit=1&details=1';
  const r2 = await fetch(url, { cache:'no-store' });
  if (!r2.ok) throw apiErr || new Error('Impossible de charger la journée pour suppression fallback');
  const d2 = await r2.json();
  const entry = normalizeServerEntry((Array.isArray(d2.entries) ? d2.entries[0] : null) || {});
  const foods = Array.isArray(entry.aliments) ? entry.aliments.slice() : [];
  if (!foods.length) throw apiErr || new Error('Journée sans aliment à supprimer');
  let bestIdx = -1, bestScore = -1;
  foods.forEach((f, idx) => { const sc = scoreFood(f); if (sc > bestScore) { bestScore = sc; bestIdx = idx; } });
  if (bestIdx < 0 || bestScore < 45) throw apiErr || new Error('ligne aliment introuvable par contenu');
  foods.splice(bestIdx, 1);
  const next = { ...entry, aliments: foods, _detailsLoaded:true, _summaryOnly:false };
  foodnoteRecalcDetailedEntryMacrosNative(next);
  const saved = await postEntryNative(next, { force:true });
  return normalizeServerEntry(saved);
}

async function deleteEntryNative(id) {
  const r = await fetch('/api/entries/' + encodeURIComponent(id), {method:'DELETE'});
  if (!r.ok) throw new Error('Erreur DELETE /api/entries/' + id);
  return r.json();
}


let _foodsSaveTimer = null;
let _foodsRemoteAvailable = false;

function normalizeFoodListForClient(list) {
  return (Array.isArray(list) ? list : []).map(f => {
    let out = {
      id: f.id,
      nom: f.nom || f.name || '',
      kcal100: Number(f.kcal100 || 0),
      prot100: Number(f.prot100 || 0),
      gluc100: Number(f.gluc100 || 0),
      lip100: Number(f.lip100 || 0),
      unite: f.unite || f.unit || 'g',
      poidsUnite: f.poidsUnite ?? f.unit_weight ?? null,
      uniteLabel: f.uniteLabel || f.unit_label || '',
      source: f.source || 'user',
      favorite: !!f.favorite,
      base: f.source === 'starter' || !!f.base
    };
    if (typeof sanitizeFoodUnitMeta === 'function') out = sanitizeFoodUnitMeta(out);
    return out;
  }).filter(f => f.nom);
}


function stripEntryRuntimeMetaFromFood(food) {
  if (!food || typeof food !== 'object') return food;
  const out = { ...food };
  // Ces champs appartiennent à une ligne de repas précise, pas à une fiche aliment.
  // Les conserver dans custom_aliments/localStorage crée des IDs SQLite périmés,
  // puis un clic sur une suggestion déclenche un PATCH /api/entry-foods/:id sur une ancienne ligne.
  delete out.entryFoodId;
  delete out.entry_food_id;
  delete out.line_uid;
  delete out.lineUid;
  delete out.__journalReplay;
  delete out._savedFood;
  delete out.idInEntry;
  return out;
}

function normalizeCustomFoodListForCache(list) {
  return (Array.isArray(list) ? list : [])
    // Les lignes `journal_replay` sont des lignes temporaires reconstruites depuis SQLite
    // pour éditer une journée. Elles ne doivent JAMAIS retourner dans custom_aliments,
    // sinon elles deviennent des doublons persistants et gardent des identités de repas périmées.
    .filter(f => f && !f.__journalReplay && f.source !== 'journal_replay' && !f.__foodnoteDeletedRuntime && !f.__deleted && !f._deleted)
    .map(f => stripEntryRuntimeMetaFromFood(f))
    .map(f => {
      try { return (typeof sanitizeFoodUnitMeta === 'function') ? sanitizeFoodUnitMeta({ ...f }) : { ...f }; }
      catch(e) { return { ...f }; }
    })
    .filter(f => f && f.nom);
}


function normalizeUnitWeightsForClient(rows) {
  if (typeof normalizeUnitWeights === 'function') return normalizeUnitWeights(rows);
  return (rows || []).map((r, i) => ({
    id: r.id ?? (-(i+1)),
    label: r.label || r.uniteLabel || 'unité',
    grams: Number(r.grams || r.poidsUnite || 0),
    aliases: Array.isArray(r.aliases) ? r.aliases : String(r.aliases || r.label || '').split(','),
    source: r.source || 'user'
  })).filter(r => r.label && r.grams > 0);
}

async function loadUnitWeightsNative() {
  try {
    const local = safeLocalGet('foodnote_unit_weights', '');
    if (local) {
      const rows = JSON.parse(local);
      if (typeof setUnitWeights === 'function') setUnitWeights(rows);
    }
  } catch(e) {}
  const r = await fetch('/api/unit-weights');
  if (!r.ok) throw new Error('Erreur GET /api/unit-weights');
  const data = await r.json();
  const rows = normalizeUnitWeightsForClient(data.unit_weights || []);
  if (typeof setUnitWeights === 'function') setUnitWeights(rows);
  safeLocalSet('foodnote_unit_weights', JSON.stringify(rows));
  return rows;
}

async function saveUnitWeightsNativeNow(rows) {
  const clean = normalizeUnitWeightsForClient(rows);
  if (typeof setUnitWeights === 'function') setUnitWeights(clean);
  safeLocalSet('foodnote_unit_weights', JSON.stringify(clean));
  const r = await fetch('/api/unit-weights/bulk', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({unit_weights: clean})
  });
  if (!r.ok) throw new Error('Erreur POST /api/unit-weights/bulk');
  const data = await r.json();
  const saved = normalizeUnitWeightsForClient(data.unit_weights || clean);
  if (typeof setUnitWeights === 'function') setUnitWeights(saved);
  safeLocalSet('foodnote_unit_weights', JSON.stringify(saved));
  return saved;
}

function getUnitWeights() {
  return typeof FOOD_UNIT_WEIGHTS !== 'undefined' ? FOOD_UNIT_WEIGHTS : [];
}

async function loadFoodsNative() {
  const r = await fetch('/api/foods?include_recovered=1', { cache:'no-store' });
  if (!r.ok) throw new Error('Erreur GET /api/foods');
  const data = await r.json();
  if (Array.isArray(data.foods)) {
    _db.bdd_aliments = normalizeFoodListForClient(data.foods);
    try { if (typeof invalidateFoodSearchCache === 'function') invalidateFoodSearchCache(); } catch(e) {}
    // beta 0.22.49 : pas de warmup lourd automatique ici. La recherche construit son index au besoin.
    _db._foods_recovered_preview_used = !!data.recovered_preview_used;
    _db._foods_recovered_preview_count = Number(data.recovered_preview_count || 0);
    _foodsRemoteAvailable = true;
    saveFoodnoteDbLocalCache();
  }
  return _db.bdd_aliments || [];
}


let _foodsWarmupTimer = null;
let _foodsWarmupPromise = null;
function refreshFoodsDependentUI() {
  const modal = document.getElementById('food-add-modal');
  const input = document.getElementById('db-search');
  const modalOpen = !!(modal && modal.classList.contains('is-open'));
  const query = input ? String(input.value || '').trim() : '';

  // Pendant l'ouverture du popup, ne pas reconstruire les listes cachées :
  // seule une recherche active doit être rafraîchie.
  if (modalOpen) {
    try { if (query && typeof handleDBSearchInput === 'function') handleDBSearchInput(); } catch(e) {}
    return;
  }

  try { if (typeof refreshDBSelect === 'function') refreshDBSelect(); } catch(e) {}
  try { if (typeof buildFoodArraysOnly === 'function') buildFoodArraysOnly({preserveRuntime:true}); } catch(e) {}
  try { if (typeof renderBDD === 'function' && document.getElementById('page-bases')?.classList.contains('active')) renderBDD(); } catch(e) {}
}
function scheduleFoodsWarmup(delay = 1200) {
  if (_foodsWarmupPromise) return _foodsWarmupPromise;
  clearTimeout(_foodsWarmupTimer);
  _foodsWarmupPromise = new Promise(resolve => {
    const start = () => {
      loadFoodsNative()
        .then(list => {
          refreshFoodsDependentUI();
          resolve(list || _db.bdd_aliments || []);
        })
        .catch(e => {
          console.warn('/api/foods chargement différé impossible', e);
          _foodsWarmupPromise = null;
          resolve([]);
        });
    };
    const d = Math.max(0, Number(delay || 0));
    if (d > 0) _foodsWarmupTimer = setTimeout(() => foodnoteRequestIdle(start, 2600), d);
    else start();
  });
  return _foodsWarmupPromise;
}
async function ensureFoodsReadyForSearch() {
  if (_foodsRemoteAvailable && Array.isArray(_db.bdd_aliments)) return _db.bdd_aliments;
  return await scheduleFoodsWarmup(0);
}
window.scheduleFoodsWarmup = scheduleFoodsWarmup;
window.ensureFoodsReadyForSearch = ensureFoodsReadyForSearch;

async function saveFoodsNativeNow() {
  const foods = normalizeFoodListForClient(_db.bdd_aliments || []);
  const r = await fetch('/api/foods/bulk', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    // Merge protecteur : le cache client peut être partiel, il ne doit jamais vider SQLite.
    body: JSON.stringify({foods, mode:'merge'})
  });
  if (!r.ok) throw new Error('Erreur POST /api/foods/bulk');
  const data = await r.json();
  if (Array.isArray(data.foods)) {
    _db.bdd_aliments = normalizeFoodListForClient(data.foods);
    saveFoodnoteDbLocalCache();
    try { if (typeof invalidateFoodSearchCache === 'function') invalidateFoodSearchCache(); } catch(e) {}
  }
  _foodsRemoteAvailable = true;
  return data;
}

function foodnoteFoodNameKeyForPersistence(foodOrName) {
  return String(foodOrName && typeof foodOrName === 'object' ? (foodOrName.nom || foodOrName.name || '') : (foodOrName || ''))
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function foodnoteFoodHasNutritionData(food) {
  if (!food) return false;
  return ['kcal100', 'prot100', 'gluc100', 'lip100'].some(k => Number(food[k] || 0) > 0);
}

async function saveSingleFoodNativeNow(food) {
  // Sauvegarde immédiate d'une fiche aliment précise.
  // Important pour les modifications BDD / aliments créés à zéro puis complétés :
  // on ne dépend plus uniquement du bulk différé à 600 ms.
  const clean = normalizeFoodListForClient([food])[0];
  if (!clean || !clean.nom) return null;
  const oldId = clean.id;
  const payload = {...clean};
  // Les id négatifs sont des aperçus/reprises historiques : le serveur doit attribuer un vrai id SQLite.
  if (!Number.isFinite(Number(payload.id)) || Number(payload.id) <= 0) delete payload.id;
  const r = await fetch('/api/foods/bulk', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({foods:[payload], mode:'merge'})
  });
  if (!r.ok) {
    let msg = 'Erreur POST /api/foods/bulk';
    try { const d = await r.json(); msg = d.error || msg; } catch(e) {}
    throw new Error(msg);
  }
  const data = await r.json();
  let saved = null;
  const all = normalizeFoodListForClient(data.foods || []);
  const key = foodnoteFoodNameKeyForPersistence(clean);
  saved = all.find(f => String(f.id) === String(oldId)) || all.find(f => foodnoteFoodNameKeyForPersistence(f) === key) || null;
  if (Array.isArray(data.foods)) _db.bdd_aliments = all;
  if (saved && oldId && String(saved.id) !== String(oldId)) {
    try {
      if (Array.isArray(customAliments)) {
        customAliments.forEach(a => {
          if (String(a?.bddId || '') === String(oldId) || foodnoteFoodNameKeyForPersistence(a) === key) a.bddId = saved.id;
        });
        _db.custom_aliments = customAliments;
      }
    } catch(e) {}
  }
  _foodsRemoteAvailable = true;
  saveFoodnoteDbLocalCache();
  try { if (typeof invalidateFoodSearchCache === 'function') invalidateFoodSearchCache(); } catch(e) {}
  return saved;
}
window.saveSingleFoodNativeNow = saveSingleFoodNativeNow;
window.foodnoteFoodHasNutritionData = foodnoteFoodHasNutritionData;

function scheduleFoodsSave() {
  saveFoodnoteDbLocalCache();
  clearTimeout(_foodsSaveTimer);
  _foodsSaveTimer = setTimeout(async () => {
    try {
      await saveFoodsNativeNow();
      showSaveStatus('Base aliments SQLite ✓');
    } catch(e) {
      console.warn('/api/foods indisponible, base aliments gardée localement', e);
      showSaveStatus('Base aliments locale', true);
    }
  }, 600);
}


function foodnoteFetchTimeout(url, options = {}, timeoutMs = 1800) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(300, Number(timeoutMs) || 1800));
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function loadData() {
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('loadData:start');
  let local = safeLocalGet('foodnote_db', '');
  // Anciennes versions : le cache pouvait contenir aliments + historique complet.
  // Le parse JSON de plusieurs Mo bloquait le premier affichage et déclenchait un pic CPU.
  if (local && local.length > 250000) {
    console.warn('[FoodNote] cache local lourd purgé au démarrage:', Math.round(local.length / 1024), 'Ko');
    try { localStorage.removeItem('foodnote_db'); } catch(e) {}
    local = '';
  }
  if (local) {
    try {
      const d = JSON.parse(local);
      if (d && typeof d === 'object') _db = {..._db, ...d, bdd_aliments:[]};
    } catch(e) { console.warn('Base locale illisible', e); }
  }

  // Priorité absolue au premier affichage : récupérer seulement les dernières journées.
  // Les réglages lourds, unités et bases sont réchauffés après rendu.
  try {
    await loadEntriesNative();
  } catch(e) {
    console.warn('/api/entries indisponible, fallback compat/local', e);
    _db.journal_entries = sortEntriesDesc(_db.journal_entries || []).slice(0, 60);
  }

  saveFoodnoteDbLocalCache();
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('loadData:entries-ready');

  foodnoteRequestIdle(async () => {
    try {
      const r = await foodnoteFetchTimeout('/api/data?light=1', { cache:'no-store' }, 1800);
      if (r.ok) {
        const d = await r.json();
        if (d && Object.keys(d).length) _db = {..._db, ...d, journal_entries:_db.journal_entries || [], bdd_aliments:_db.bdd_aliments || []};
        saveFoodnoteDbLocalCache();
      }
    } catch(e) { console.warn('/api/data light différé indisponible', e); }
  }, 2200, 650);

  foodnoteRequestIdle(async () => {
    try { await loadUnitWeightsNative(); }
    catch(e) { console.warn('/api/unit-weights différé indisponible, fallback unités local', e); }
  }, 2200, 950);
}

function scheduleSave() { clearTimeout(_saveTimer); _saveTimer = setTimeout(persistData, 900); }

async function persistData() {
  saveFoodnoteDbLocalCache();
  // En mode SQLite natif, les écritures atomiques (/api/entries, /api/entry-foods, /api/foods)
  // sont la source de vérité. On ne sérialise plus tout _db dans /api/data au milieu d'une action UI.
  if (_db && _db._storage_mode === 'sqlite-native') {
    showSaveStatus('✓ Sauvegardé');
    return;
  }
  try {
    const payload = foodnoteDbLocalCachePayload();
    await fetch('/api/data', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    showSaveStatus('✓ Sauvegardé');
  } catch(e) { showSaveStatus('✓ Sauvegardé localement', true); }
}

function saveLocalOnly() {
  saveFoodnoteDbLocalCache();
}

function showSaveStatus(msg, warn) {
  let el = document.getElementById('save-status');
  if (!el) {
    el = document.createElement('div'); el.id = 'save-status';
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;font-size:12px;padding:6px 12px;border-radius:8px;z-index:999;transition:opacity 0.5s';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = warn ? '#faeeda' : '#e1f5ee';
  el.style.color = warn ? '#854f0b' : '#0f6e56';
  el.style.opacity = '1';
  setTimeout(() => el.style.opacity = '0', 2500);
}

function getEntries() { return _db.journal_entries || []; }
function saveEntries(e) { _db.journal_entries = e; try { window.invalidateFoodQuickSuggestionsCache && window.invalidateFoodQuickSuggestionsCache(); } catch(_) {} scheduleSave(); }
function getBDD() { return _db.bdd_aliments || []; }
function saveBDD(d) {
  const list = normalizeFoodListForClient(d || []);
  const invalid = (typeof foodnoteNutritionGuardSilentFood === 'function')
    ? list.map(f => ({f, error: foodnoteNutritionGuardSilentFood(f)})).filter(x => x.error)
    : [];
  if (invalid.length) {
    alert('❌ Base aliments : sauvegarde bloquée.\n\n' + invalid.slice(0, 5).map(x => x.error).join('\n'));
    return;
  }
  _db.bdd_aliments = list;
  try { if (typeof invalidateFoodSearchCache === 'function') invalidateFoodSearchCache(); } catch(e) {}
  scheduleFoodsSave();
}

function getStarterAlimentsForSeed() {
  const fromModule = window.FOODNOTE_STARTER_FOODS;
  if (Array.isArray(fromModule)) return fromModule;
  // Compatibilité ancienne version : si un vieux build a encore la constante locale,
  // on l'utilise sans casser l'app, mais la source cible reste 11-starter-foods.js.
  try {
    if (typeof STARTER_ALIMENTS_FIRST_LAUNCH !== 'undefined' && Array.isArray(STARTER_ALIMENTS_FIRST_LAUNCH)) {
      return STARTER_ALIMENTS_FIRST_LAUNCH;
    }
  } catch(e) {}
  return [];
}

function foodnoteStarterFoodKey(foodOrName) {
  return String(foodOrName && typeof foodOrName === 'object' ? (foodOrName.nom || foodOrName.name || '') : (foodOrName || ''))
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function foodnoteIsStarterOwnedFood(food) {
  if (!food || typeof food !== 'object') return false;
  if (food.source === 'starter') return true;
  // Les anciens aliments de démarrage utilisaient des id négatifs et base:true.
  const id = Number(food.id);
  return food.base === true && Number.isFinite(id) && id < 0;
}

function seedStarterAliments(force = false) {
  const starters = getStarterAlimentsForSeed();
  const seedVersion = Number(window.FOODNOTE_STARTER_FOODS_VERSION || 5) || 5;
  if (!starters.length) {
    console.warn('[FoodNote] aliments de démarrage indisponibles : 11-starter-foods.js non chargé ?');
    return;
  }

  const bdd = getBDD();
  const indexByName = new Map(bdd.map((b, i) => [foodnoteStarterFoodKey(b), i]).filter(([key]) => key));
  let changed = false;

  starters.forEach(a => {
    if (!a || !a.nom) return;
    const key = foodnoteStarterFoodKey(a);
    if (!key) return;
    const baseFood = normalizeFoodListForClient([{...a, base:true, source:'starter'}])[0];
    if (!baseFood) return;

    if (!indexByName.has(key)) {
      bdd.push(baseFood);
      indexByName.set(key, bdd.length - 1);
      changed = true;
      return;
    }

    const i = indexByName.get(key);
    const existing = bdd[i];
    if (force && foodnoteIsStarterOwnedFood(existing)) {
      // Restauration volontaire : on remet à niveau uniquement les fiches starter.
      // Une fiche utilisateur portant le même nom n'est pas écrasée.
      bdd[i] = {...existing, ...baseFood, id:existing.id || baseFood.id};
      changed = true;
    } else if (foodnoteIsStarterOwnedFood(existing) && (existing.base !== true || existing.source !== 'starter')) {
      bdd[i] = {...existing, base:true, source:'starter'};
      changed = true;
    }
  });

  if (_db.bdd_seed_version !== seedVersion) {
    _db.bdd_seed_version = seedVersion;
    changed = true;
  }
  if (changed) {
    _db.bdd_aliments = bdd;
    if (typeof scheduleFoodsSave === 'function') scheduleFoodsSave();
    else scheduleSave();
  }
}

function restoreStarterAliments() {
  seedStarterAliments(true);
  refreshDBSelect();
  renderBDD();
  showSaveStatus('Ingrédients de base restaurés ✓');
}
function getCustomList() { return _db.custom_aliments || []; }
function saveCustomList() {
  _db.custom_aliments = normalizeCustomFoodListForCache(customAliments);
  try { if (typeof invalidateFoodSearchCache === 'function') invalidateFoodSearchCache(); } catch(e) {}
  scheduleSave();
}
function getSports() {
  return _db.sports_config?.length ? _db.sports_config : SPORTS_BASE;
}
function saveSports(d) { _db.sports_config = d; scheduleSave(); }

async function fetchJsonIfOk(url, fallback) {
  try {
    const r = await fetch(url);
    if (!r.ok) return fallback;
    return await r.json();
  } catch(e) { return fallback; }
}

async function buildJSONExportPayload() {
  // Recharge les tables SQLite natives avant export : le JSON devient un vrai export de migration,
  // pas une simple copie du cache local.
  try { await loadEntriesNative(); } catch(e) {}
  try { await loadFoodsNative(); } catch(e) {}
  try { await loadUnitWeightsNative(); } catch(e) {}

  const profileResp = await fetchJsonIfOk('/api/profile', null);
  const settingsResp = await fetchJsonIfOk('/api/settings', {});
  const unitResp = await fetchJsonIfOk('/api/unit-weights', {});

  const profile = profileResp && profileResp.profile ? profileResp.profile : (typeof PROFIL !== 'undefined' ? PROFIL : null);
  const phases = profileResp && Array.isArray(profileResp.phases) ? profileResp.phases : (profile && Array.isArray(profile.phases) ? profile.phases : []);
  const unitWeights = Array.isArray(unitResp.unit_weights) ? unitResp.unit_weights : (typeof getUnitWeights === 'function' ? getUnitWeights() : []);

  return {
    version: 3,
    type: 'foodnote-json-migration-export',
    note: 'Export JSON de migration/restauration. La sauvegarde complète officielle reste le fichier SQLite data/foodnote.db.',
    exportedAt: new Date().toISOString(),
    profile,
    phases,
    settings: settingsResp && settingsResp.settings ? settingsResp.settings : settingsResp,
    unit_weights: unitWeights,
    ..._db
  };
}

async function exportJSON() {
  const st = document.getElementById('donnees-status');
  try {
    if (st) st.innerHTML = 'Préparation de l’export JSON serveur depuis SQLite...';
    // v10.38 : l'export JSON est généré côté serveur, directement depuis les tables SQLite.
    // Ça évite un export vide si le cache frontend n'est pas encore chargé.
    const a = document.createElement('a');
    a.href = '/api/backup/json?ts=' + encodeURIComponent(new Date().toISOString());
    a.download = 'foodnote_export_migration_' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (st) st.innerHTML = '<span style="color:var(--orange)">JSON exporté côté serveur depuis SQLite. La sauvegarde complète reste data/foodnote.db.</span>';
  } catch(e) {
    if (st) st.innerHTML = '<span style="color:#e24b4a">Erreur export JSON : '+e.message+'</span>';
  }
}

async function copyBackupJSON() {
  const st = document.getElementById('donnees-status');
  try {
    if (st) st.innerHTML = 'Préparation du JSON...';
    const txt = JSON.stringify(await buildJSONExportPayload(), null, 2);
    navigator.clipboard.writeText(txt).then(() => {
      if (st) st.innerHTML = '<span style="color:#1d9e75">✓ JSON copié depuis SQLite. Attention : la sauvegarde officielle reste foodnote.db.</span>';
    }).catch(() => {
      const w = window.open('', '_blank');
      if (w) w.document.write('<pre style="white-space:pre-wrap;padding:1rem">' + txt.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</pre>');
    });
  } catch(e) {
    if (st) st.innerHTML = '<span style="color:#e24b4a">Erreur copie JSON : '+e.message+'</span>';
  }
}

function downloadSQLiteBackup() {
  const st = document.getElementById('donnees-status');
  if (st) st.innerHTML = 'Préparation de la sauvegarde SQLite avec checkpoint WAL...';
  const a = document.createElement('a');
  a.href = '/api/backup/sqlite?ts=' + encodeURIComponent(new Date().toISOString());
  a.download = 'foodnote_' + new Date().toISOString().split('T')[0] + '.db';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (st) st.innerHTML = '<span style="color:#1d9e75">✓ Téléchargement SQLite lancé. La sauvegarde est générée côté serveur après checkpoint WAL.</span>';
}


async function refreshBackupStatus(showMessage) {
  const panel = document.getElementById('backup-status-panel');
  const st = document.getElementById('donnees-status');
  try {
    if (panel) panel.innerHTML = 'Lecture du diagnostic SQLite...';
    const r = await fetch('/api/backup/status?ts=' + encodeURIComponent(Date.now()));
    const d = await r.json();
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || ('HTTP ' + r.status));
    const c = d.counts || {};
    const p = d.profile || {};
    const warn = [];
    if (!p.exists) warn.push('profil absent');
    if (!c.phases) warn.push('phases absentes');
    if (!c.entries) warn.push('aucune journée');
    const warnHtml = warn.length
      ? '<div class="backup-warning" style="margin-top:8px">⚠ À vérifier : ' + warn.join(', ') + '.</div>'
      : '<div class="backup-ok" style="margin-top:8px">✓ Base cohérente pour sauvegarde/restauration.</div>';
    const html = `
      <div><strong>Fichier :</strong> <code>${d.db || 'data/foodnote.db'}</code></div>
      <div class="backup-status-grid">
        <div class="backup-status-pill"><strong>${c.entries ?? 0}</strong><span>journées</span></div>
        <div class="backup-status-pill"><strong>${c.entry_foods ?? 0}</strong><span>aliments journal</span></div>
        <div class="backup-status-pill"><strong>${c.sports ?? 0}</strong><span>sports</span></div>
        <div class="backup-status-pill"><strong>${c.foods ?? 0}</strong><span>aliments BDD</span></div>
        <div class="backup-status-pill"><strong>${c.unit_weights ?? 0}</strong><span>poids/unité</span></div>
        <div class="backup-status-pill"><strong>${c.phases ?? 0}</strong><span>phases</span></div>
      </div>
      <div style="margin-top:8px"><strong>Profil :</strong> ${p.exists ? '<span class="backup-ok">présent</span>' : '<span class="backup-warning">absent</span>'} — objectifs ${p.cibleKcal || 0} kcal / P ${p.cibleProt || 0} / G ${p.cibleGluc || 0} / L ${p.cibleLip || 0}</div>
      ${warnHtml}
    `;
    if (panel) panel.innerHTML = html;
    if (showMessage && st) st.innerHTML = '<span style="color:#1d9e75">✓ Diagnostic SQLite actualisé.</span>';
    return d;
  } catch(e) {
    if (panel) panel.innerHTML = '<span class="backup-error">Erreur diagnostic : '+e.message+'</span>';
    if (showMessage && st) st.innerHTML = '<span style="color:#e24b4a">Erreur diagnostic : '+e.message+'</span>';
    return null;
  }
}

function importSQLiteBackup(event) {
  const file = event.target.files && event.target.files[0];
  const st = document.getElementById('donnees-status');
  const prev = document.getElementById('sqlite-restore-preview');
  if (!file) return;
  (async () => {
    try {
      if (!/\.(db|sqlite|sqlite3)$/i.test(file.name)) {
        if (!confirm('Le fichier ne finit pas par .db/.sqlite. Continuer quand même ?')) return;
      }
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      const msg = 'Restaurer cette sauvegarde SQLite ?\n\nFichier : '+file.name+'\nTaille : '+sizeMb+' Mo\n\nLe serveur va créer une copie .bak de la base actuelle, remplacer data/foodnote.db, puis redémarrer automatiquement.';
      if (!confirm(msg)) return;
      if (st) st.innerHTML = 'Import SQLite en cours... Ne ferme pas la page.';
      if (prev) prev.innerHTML = 'Upload de <strong>'+file.name.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</strong>...';
      const buf = await file.arrayBuffer();
      const r = await fetch('/api/restore/sqlite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || ('HTTP '+r.status));
      const c = d.restored_counts || {};
      if (prev) prev.innerHTML = '<span class="backup-ok">✓ Base restaurée : '+(c.entries||0)+' journées, '+(c.entry_foods||0)+' aliments journal, '+(c.phases||0)+' phases.</span><br>Backup précédent : <code>'+(d.previous_backup||'créé côté serveur')+'</code>';
      if (st) st.innerHTML = '<span style="color:#1d9e75">✓ SQLite restauré. Redémarrage serveur en cours, recharge dans quelques secondes...</span>';
      try { localStorage.removeItem('foodnote_db'); localStorage.removeItem('foodnote_profil'); localStorage.removeItem('foodnote_unit_weights'); } catch(_) {}
      setTimeout(() => location.reload(), 3500);
    } catch(e) {
      if (prev) prev.innerHTML = '<span class="backup-error">Erreur restauration SQLite : '+e.message+'</span>';
      if (st) st.innerHTML = '<span style="color:#e24b4a">Erreur restauration SQLite : '+e.message+'</span>';
    } finally {
      event.target.value = '';
    }
  })();
}

async function rebuildProfileFromUI() {
  const st = document.getElementById('donnees-status');
  if (!confirm('Tenter de reconstruire profil/objectifs depuis les anciens stockages et les phases SQLite ?')) return;
  try {
    if (st) st.innerHTML = 'Reconstruction profil/objectifs...';
    const r = await fetch('/api/admin/rebuild-profile', { method: 'POST' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || ('HTTP '+r.status));
    if (st) st.innerHTML = '<span style="color:#1d9e75">✓ Profil/objectifs reconstruits si des données récupérables existaient.</span>';
    await refreshBackupStatus(false);
  } catch(e) {
    if (st) st.innerHTML = '<span style="color:#e24b4a">Erreur reconstruction profil : '+e.message+'</span>';
  }
}

async function rebuildDaysFromUI() {
  const st = document.getElementById('donnees-status');
  if (!confirm('Tenter de reconstruire les journées depuis les anciens stockages internes ?')) return;
  try {
    if (st) st.innerHTML = 'Reconstruction journées...';
    const r = await fetch('/api/admin/rebuild-days', { method: 'POST' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || ('HTTP '+r.status));
    if (st) st.innerHTML = '<span style="color:#1d9e75">✓ Reconstruction journées terminée.</span>';
    await refreshBackupStatus(false);
  } catch(e) {
    if (st) st.innerHTML = '<span style="color:#e24b4a">Erreur reconstruction journées : '+e.message+'</span>';
  }
}

function showSQLiteBackupHelp() {
  const st = document.getElementById('donnees-status');
  const html = '<strong>Sauvegarde réelle :</strong> le fichier est côté serveur dans <code>/data/foodnote.db</code>, monté par Docker en <code>./data/foodnote.db</code>. Sauvegarde ce fichier, ou utilise le bouton de téléchargement SQLite.';
  if (st) st.innerHTML = html;
  else alert('Sauvegarde réelle : /data/foodnote.db dans le conteneur, ./data/foodnote.db côté Docker Compose.');
}

function importJSON(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const st = document.getElementById('donnees-status');
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object' || !data.version) throw new Error('Format invalide');
      const previewEntries = Array.isArray(data.journal_entries) ? data.journal_entries.length : (Array.isArray(data.entries) ? data.entries.length : 0);
      const previewFoods = Array.isArray(data.bdd_aliments) ? data.bdd_aliments.length : (Array.isArray(data.foods) ? data.foods.length : 0);
      const warning = previewEntries === 0
        ? '\n\n⚠ Attention : ce JSON semble contenir 0 journée au format standard. L’app tentera quand même les anciens formats, mais si le fichier a été exporté vide, les journées ne pourront pas être recréées.'
        : '\n\nJournées détectées dans le JSON : ' + previewEntries;
      if (!confirm('Importer ce JSON dans SQLite ? Les données actuelles de cet utilisateur seront remplacées.\nAliments détectés : '+previewFoods+warning)) return;
      if (st) st.innerHTML = 'Import JSON vers SQLite en cours...';

      const r = await fetch('/api/restore/json', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(data)
      });
      let resp = null;
      try { resp = await r.json(); } catch(_) {}
      if (!r.ok || !resp || resp.ok === false) throw new Error((resp && resp.error) || ('HTTP ' + r.status));

      // Nettoie les caches locaux pour forcer la relecture SQLite après restauration.
      try { localStorage.removeItem('foodnote_db'); } catch(_) {}
      try { localStorage.removeItem('foodnote_profil'); } catch(_) {}
      try { localStorage.removeItem('foodnote_unit_weights'); } catch(_) {}
      try { localStorage.removeItem('foodnote_features'); } catch(_) {}

      const info = resp.restored || {};
      if (st) st.innerHTML = '<span style="color:#1d9e75">✓ Import SQLite réussi : '+(info.entries||0)+' journées, '+(info.foods||0)+' aliments, '+(info.phases||0)+' phases. Rechargement...</span>';
      setTimeout(() => location.reload(), 1200);
    } catch(err) {
      if (st) st.innerHTML = '<span style="color:#e24b4a">Erreur import JSON : '+err.message+'</span>';
    }
  };
  reader.readAsText(file); event.target.value = '';
}

function ensureCIQUALUpdateButton() {
  const importBtn = document.getElementById('btn-ciqual-import');
  if (!importBtn || !importBtn.parentElement) return null;
  let btn = document.getElementById('btn-ciqual-update');
  if (btn) return btn;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fn-ui-button fn-ui-button-primary';
  btn.id = 'btn-ciqual-update';
  btn.textContent = '🔄 Télécharger / mettre à jour CIQUAL';
  btn.onclick = triggerCIQUALUpdate;
  importBtn.parentElement.insertBefore(btn, importBtn);
  return btn;
}

function formatCIQUALFileStatus(label, ok, info) {
  const icon = ok ? '✓' : '✕';
  const color = ok ? 'var(--green)' : 'var(--text4)';
  const meta = info && info.size_mb ? ' <span style="color:var(--text4)">(' + info.size_mb + ' Mo)</span>' : '';
  return '<span style="color:' + color + '">' + icon + ' ' + label + '</span>' + meta;
}

async function checkCIQUALStatus() {
  try {
    const r = await fetch('/api/ciqual/status');
    const d = await readJSONResponse(r, 'CIQUAL statut');
    const el = document.getElementById('ciqual-status-box');
    const btn = document.getElementById('btn-ciqual-import');
    const btnUpdate = ensureCIQUALUpdateButton();
    if (!el) return;

    const sourceLabel = d.source === 'sqlite' ? 'SQLite/off.db' : (d.source === 'json' ? 'ciqual_data.json' : 'aucune base');
    const xml = d.xml || {};
    const files = xml.files || {};
    const xmlLine = [
      formatCIQUALFileStatus('alim.xml', !!xml.alim, files.alim),
      formatCIQUALFileStatus('compo.xml', !!xml.compo, files.compo),
      formatCIQUALFileStatus('grp.xml', !!xml.grp, files.grp) + ' <span style="color:var(--text4)">(optionnel)</span>'
    ].join(' · ');

    if (btnUpdate) {
      btnUpdate.disabled = !!d.running || !d.can_update;
      btnUpdate.textContent = d.running ? '⏳ CIQUAL en cours...' : '🔄 Télécharger / mettre à jour CIQUAL';
      btnUpdate.title = d.can_update ? 'Télécharge les XML officiels CIQUAL puis lance l’import local' : 'update_ciqual.sh ou download_ciqual.py est introuvable côté serveur';
    }
    if (btn) {
      btn.disabled = !!d.running || !d.can_import;
      btn.textContent = d.running ? '⏳ CIQUAL en cours...' : '🌿 Réimporter les XML locaux';
      btn.title = d.can_import ? 'Réimporte les fichiers XML CIQUAL déjà présents (/data ou /app)' : 'alim.xml et compo.xml doivent être présents dans /data ou téléchargés avec le bouton CIQUAL';
    }

    if (d.available) {
      el.innerHTML = '<div><span style="color:var(--green)">✓ Base CIQUAL disponible</span> — <span style="color:var(--text3)">' + (d.count || 0) + ' aliments</span> — <span style="color:var(--text4)">' + sourceLabel + '</span></div>' +
        '<div style="margin-top:6px;font-size:12px">Fichiers XML : ' + xmlLine + '</div>' +
        '<div style="margin-top:4px;font-size:12px;color:var(--text4)">Le bouton Télécharger met à jour les XML officiels puis réimporte. Le bouton Réimporter relit seulement les XML déjà présents.</div>';
    } else if (d.can_import) {
      el.innerHTML = '<div><span style="color:var(--orange)">⚠ Fichiers XML CIQUAL détectés</span> — base locale pas encore importée</div>' +
        '<div style="margin-top:6px;font-size:12px">Fichiers XML : ' + xmlLine + '</div>' +
        '<div style="margin-top:4px;font-size:12px;color:var(--text3)">Tu peux cliquer sur <strong>Réimporter les XML locaux</strong>, ou sur <strong>Télécharger / mettre à jour CIQUAL</strong> pour récupérer les XML officiels puis importer.</div>';
    } else {
      el.innerHTML = '<div><span style="color:var(--orange)">⚠ Base CIQUAL non disponible</span></div>' +
        '<div style="margin-top:6px;font-size:12px">Fichiers XML : ' + xmlLine + '</div>' +
        '<div style="margin-top:4px;font-size:12px;color:var(--text3)">Clique sur <strong>Télécharger / mettre à jour CIQUAL</strong> pour récupérer les XML officiels, ou copie manuellement <code>alim.xml</code> et <code>compo.xml</code> dans <code>/data</code>.</div>';
    }
  } catch(e) {
    const el = document.getElementById('ciqual-status-box');
    if (el) el.innerHTML = '<span style="color:var(--text4)">Serveur non disponible</span>';
  }
}

async function lancerImportCIQUAL() {
  if (!confirm('Réimporter les XML CIQUAL déjà présents ? Pour télécharger les XML officiels, utilise plutôt “Télécharger / mettre à jour CIQUAL”.')) return;
  const btn = document.getElementById('btn-ciqual-import');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Réimport en cours...'; }
  const logBox = document.getElementById('ciqual-log-box');
  if (logBox) logBox.style.display = 'block';
  try {
    const r = await fetch('/api/ciqual/import', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showSaveStatus('Réimport CIQUAL lancé');
      pollCIQUALLog();
    } else {
      showSaveStatus(d.error || 'Erreur import CIQUAL', true);
      if (btn) { btn.disabled = false; btn.textContent = '🌿 Réimporter les XML locaux'; }
      checkCIQUALStatus();
    }
  } catch(e) {
    showSaveStatus('Erreur réseau', true);
    if (btn) { btn.disabled = false; btn.textContent = '🌿 Réimporter les XML locaux'; }
  }
}

async function triggerCIQUALUpdate() {
  if (!confirm('Télécharger / mettre à jour CIQUAL ? FoodNote va récupérer les XML officiels ANSES, puis lancer l’import local.')) return;
  const btn = document.getElementById('btn-ciqual-update');
  const importBtn = document.getElementById('btn-ciqual-import');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Téléchargement CIQUAL...'; }
  if (importBtn) importBtn.disabled = true;
  const logBox = document.getElementById('ciqual-log-box');
  if (logBox) logBox.style.display = 'block';
  try {
    const r = await fetch('/api/ciqual/update', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showSaveStatus('Mise à jour CIQUAL lancée depuis l’interface. Logs en direct activés.');
      pollCIQUALLog();
    } else {
      showSaveStatus(d.error || 'Mise à jour CIQUAL non lancée', true);
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Télécharger / mettre à jour CIQUAL'; }
      if (importBtn) importBtn.disabled = false;
      pollCIQUALLog();
    }
  } catch(e) {
    showSaveStatus('Erreur lors du lancement CIQUAL : ' + (e && e.message ? e.message : e), true);
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Télécharger / mettre à jour CIQUAL'; }
    if (importBtn) importBtn.disabled = false;
  }
}

async function pollCIQUALLog() {
  try {
    const r = await fetch('/api/ciqual/log');
    const d = await r.json();
    const el = document.getElementById('ciqual-log');
    if (el && d.log) { el.textContent = d.log; el.scrollTop = el.scrollHeight; }
    if (d.running) {
      setTimeout(pollCIQUALLog, 2000);
    } else {
      const btn = document.getElementById('btn-ciqual-update');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Télécharger / mettre à jour CIQUAL'; }
      checkCIQUALStatus();
    }
  } catch(e) {}
}

async function checkOFFStatus() {
  try {
    const r = await fetch('/api/off/status');
    const d = await r.json();
    const el = document.getElementById('off-status-box');
    if (!el) return;
    if (d.available) {
      const total = Number(d.products || 0).toLocaleString('fr-FR');
      const withCode = Number(d.barcode_products || 0).toLocaleString('fr-FR');
      const withoutCode = Number(d.without_barcode || 0).toLocaleString('fr-FR');
      const scan = d.scan_local
        ? '<span style="color:var(--green)">✓ Scan local possible</span>'
        : '<span style="color:var(--orange)">⚠ Scan local impossible : réimport OpenFoodFacts nécessaire</span>';
      el.innerHTML = `
        <div><span style="color:var(--green)">✓ Base OpenFoodFacts disponible</span> — <span style="color:var(--text3)">${d.size_mb || 0} Mo</span></div>
        <div style="margin-top:6px;display:grid;gap:4px;font-size:13px">
          <div>Produits locaux : <strong>${total}</strong></div>
          <div>Produits avec code-barres : <strong>${withCode}</strong></div>
          <div>Produits sans code-barres : <strong>${withoutCode}</strong></div>
          <div>Colonne code détectée : <strong>${d.code_column || 'aucune'}</strong></div>
          <div>${scan}</div>
          <div style="color:var(--text4)">CIQUAL est géré séparément via les XML locaux, pas dans OpenFoodFacts.</div>
        </div>`;
    } else {
      const err = d.error ? ' — ' + escapeHtml(String(d.error)) : '';
      el.innerHTML = '<span style="color:var(--orange)">⚠ Base OpenFoodFacts non importée ou incomplète</span>' + err + ' — <span style="font-size:13px">Commande : <code style="background:var(--bg);padding:2px 6px;border-radius:4px">docker exec foodnote node /app/import_off.js</code></span>';
    }
  } catch(e) {
    const el = document.getElementById('off-status-box');
    if (el) el.innerHTML = '<span style="color:var(--text4)">Serveur non disponible</span>';
  }
}

async function triggerOFFUpdate() {
  if (!confirm("Lancer la mise à jour de la base OpenFoodFacts ? Cela peut prendre longtemps. La v10.51 lance exactement /app/update_off.sh côté serveur et affiche les logs.")) return;
  const btn = document.getElementById('btn-off-update');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Mise à jour en cours...'; }
  try {
    const r = await fetch('/api/off/update', { method: 'POST' });
    const d = await r.json();
    const box = document.getElementById('off-log-box');
    if (box) box.style.display = 'block';
    if (d.ok) {
      showSaveStatus('Mise à jour OpenFoodFacts lancée depuis l’interface. Logs en direct activés.');
      pollOFFLog();
    } else {
      showSaveStatus(d.error || 'Mise à jour OpenFoodFacts non lancée', true);
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Mettre à jour OpenFoodFacts'; }
      pollOFFLog();
    }
  } catch(e) {
    showSaveStatus('Erreur lors du lancement : ' + (e && e.message ? e.message : e), true);
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Mettre à jour OpenFoodFacts'; }
  }
}

async function pollOFFLog() {
  try {
    const r = await fetch('/api/off/log');
    const d = await r.json();
    const el = document.getElementById('off-log');
    if (el && d.log) { el.textContent = d.log; el.scrollTop = el.scrollHeight; }
    if (d.running) setTimeout(pollOFFLog, 3000);
    else {
      const btn = document.getElementById('btn-off-update');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Mettre à jour OpenFoodFacts'; }
      checkOFFStatus();
    }
  } catch(e) {}
}



async function foodnoteAutoBackupFetchJson(url, options) {
  const r = await fetch(url, options || {});
  const contentType = String(r.headers.get('content-type') || '').toLowerCase();
  const text = await r.text();
  let d = null;
  if (contentType.includes('application/json') || /^[\s\r\n]*[\{\[]/.test(text)) {
    try { d = JSON.parse(text || '{}'); }
    catch (e) { throw new Error('Réponse auto backup invalide : ' + e.message); }
  } else {
    const preview = text.slice(0, 80).replace(/\s+/g, ' ').trim();
    if (preview.startsWith('<!DOCTYPE') || preview.startsWith('<html') || preview.startsWith('<')) {
      throw new Error('API auto backup absente côté serveur. Remplace aussi server.js puis redémarre le conteneur.');
    }
    throw new Error('Réponse auto backup non JSON : ' + (preview || ('HTTP ' + r.status)));
  }
  if (!r.ok || !d || d.ok === false) throw new Error((d && d.error) || ('HTTP ' + r.status));
  return d;
}

function foodnoteFormatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '0 Mo';
  const mb = n / 1024 / 1024;
  if (mb >= 1) return (Math.round(mb * 10) / 10) + ' Mo';
  return Math.round(n / 1024) + ' Ko';
}
function foodnoteAutoBackupReadUI() {
  const enabled = !!document.getElementById('auto-backup-enabled')?.checked;
  const time = document.getElementById('auto-backup-time')?.value || '03:00';
  const keep = Number(document.getElementById('auto-backup-keep')?.value || 14) || 14;
  const parts = String(time).split(':');
  const hour = Math.max(0, Math.min(23, parseInt(parts[0] || '3', 10) || 0));
  const minute = Math.max(0, Math.min(59, parseInt(parts[1] || '0', 10) || 0));
  return { enabled, hour, minute, keep };
}
function foodnoteAutoBackupApplyUI(settings) {
  const s = settings || {};
  const enabled = document.getElementById('auto-backup-enabled');
  const time = document.getElementById('auto-backup-time');
  const keep = document.getElementById('auto-backup-keep');
  if (enabled) enabled.checked = !!s.enabled;
  if (time) time.value = String(Number(s.hour ?? 3)).padStart(2, '0') + ':' + String(Number(s.minute ?? 0)).padStart(2, '0');
  if (keep) keep.value = String(Number(s.keep || 14));
}
function foodnoteRenderAutoBackupStatus(data, message) {
  const panel = document.getElementById('auto-backup-status');
  if (!panel) return;
  const settings = data?.settings || {};
  const backups = Array.isArray(data?.backups) ? data.backups : [];
  const last = data?.last || null;
  const err = data?.lastError || null;
  const latest = backups[0] || null;
  const stateHtml = settings.enabled
    ? `<span class="backup-ok">✓ Activé</span> — tous les jours à ${String(settings.hour ?? 3).padStart(2,'0')}:${String(settings.minute ?? 0).padStart(2,'0')}`
    : `<span class="backup-warning">Désactivé</span>`;
  const latestHtml = latest
    ? `<div style="margin-top:8px"><strong>Dernière sauvegarde :</strong> <code>${latest.name}</code> · ${foodnoteFormatBytes(latest.size)} · ${new Date(latest.mtime).toLocaleString('fr-FR')}</div>`
    : `<div style="margin-top:8px;color:var(--text4)">Aucune sauvegarde automatique créée pour l’instant.</div>`;
  const lastRunHtml = last?.createdAt
    ? `<div style="margin-top:4px;color:var(--text4)">Dernière exécution : ${new Date(last.createdAt).toLocaleString('fr-FR')} · ${last.reason || 'auto'}</div>`
    : '';
  const errHtml = err?.error
    ? `<div class="backup-error" style="margin-top:8px">Dernière erreur : ${escapeHtml(err.error)}</div>`
    : '';
  const listHtml = backups.length
    ? `<div class="auto-backup-list">${backups.slice(0,4).map(b => `<div><code>${escapeHtml(b.name)}</code><span>${foodnoteFormatBytes(b.size)}</span></div>`).join('')}</div>`
    : '';
  panel.innerHTML = `${message ? `<div style="margin-bottom:8px">${message}</div>` : ''}<div><strong>État :</strong> ${stateHtml}</div><div><strong>Dossier :</strong> <code>data/auto_backups</code></div>${latestHtml}${lastRunHtml}${errHtml}${listHtml}`;
}
async function refreshAutoBackupStatus(showMessage) {
  const panel = document.getElementById('auto-backup-status');
  if (!panel) return null;
  try {
    if (showMessage) panel.innerHTML = 'Lecture auto backup...';
    const d = await foodnoteAutoBackupFetchJson('/api/auto-backup/status?ts=' + encodeURIComponent(Date.now()));
    foodnoteAutoBackupApplyUI(d.settings || {});
    foodnoteRenderAutoBackupStatus(d, showMessage ? '<span class="backup-ok">✓ Statut actualisé.</span>' : '');
    return d;
  } catch(e) {
    panel.innerHTML = '<span class="backup-error">Erreur auto backup : '+escapeHtml(e.message || e)+'</span>';
    return null;
  }
}
let foodnoteAutoBackupSaveTimer = null;
function saveAutoBackupSettings() {
  clearTimeout(foodnoteAutoBackupSaveTimer);
  foodnoteAutoBackupSaveTimer = setTimeout(async () => {
    const panel = document.getElementById('auto-backup-status');
    try {
      const payload = foodnoteAutoBackupReadUI();
      if (panel) panel.innerHTML = 'Sauvegarde de la configuration auto backup...';
      const d = await foodnoteAutoBackupFetchJson('/api/auto-backup/settings', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      foodnoteAutoBackupApplyUI(d.settings || payload);
      foodnoteRenderAutoBackupStatus(d, '<span class="backup-ok">✓ Configuration sauvegardée.</span>');
    } catch(e) {
      if (panel) panel.innerHTML = '<span class="backup-error">Erreur configuration auto backup : '+escapeHtml(e.message || e)+'</span>';
    }
  }, 250);
}
async function runAutoBackupNow() {
  const panel = document.getElementById('auto-backup-status');
  try {
    if (panel) panel.innerHTML = 'Création de la sauvegarde automatique maintenant...';
    const d = await foodnoteAutoBackupFetchJson('/api/auto-backup/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    foodnoteRenderAutoBackupStatus(d, '<span class="backup-ok">✓ Sauvegarde créée maintenant.</span>');
  } catch(e) {
    if (panel) panel.innerHTML = '<span class="backup-error">Erreur création auto backup : '+escapeHtml(e.message || e)+'</span>';
  }
}

function renderDonnees() {
  const el = document.getElementById('donnees-summary');
  if (!el) return;
  const entries = _db.journal_entries || [], bdd = _db.bdd_aliments || [], custom = _db.custom_aliments || [];
  const oldest = entries.length ? entries[entries.length-1].date : null;
  const newest = entries.length ? entries[0].date : null;
  const UI = window.FoodNoteUI;
  if (UI && typeof UI.metric === 'function') {
    el.className = 'fn-ui-metric-grid';
    el.innerHTML = [
      UI.metric({ icon:'📅', label:'Journées UI', value:entries.length, unit:'', sub: oldest ? (formatDate(oldest)+' → '+formatDate(newest)) : 'Aucune journée chargée', tone:'kcal' }),
      UI.metric({ icon:'🍽', label:'Aliments BDD UI', value:bdd.length, unit:'', sub:'Base aliments disponible côté navigateur', tone:'prot' }),
      UI.metric({ icon:'⭐', label:'Aliments perso', value:custom.length, unit:'', sub:'Actifs dans ta base locale', tone:'gluc' }),
      UI.metric({ icon:'💾', label:'Sauvegarde', value:'SQLite', unit:'', sub:'data/foodnote.db', tone:'net' })
    ].join('');
  } else {
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:8px">
      <div class="macro-cell"><div class="macro-val">${entries.length}</div><div class="macro-lbl">journées chargées UI</div>${oldest?'<div class="macro-target">'+formatDate(oldest)+' → '+formatDate(newest)+'</div>':''}</div>
      <div class="macro-cell"><div class="macro-val">${bdd.length}</div><div class="macro-lbl">aliments en BDD UI</div></div>
      <div class="macro-cell"><div class="macro-val">${custom.length}</div><div class="macro-lbl">aliments perso actifs</div></div>
      <div class="macro-cell"><div class="macro-val">SQLite</div><div class="macro-lbl">sauvegarde principale</div><div class="macro-target">data/foodnote.db</div></div>
    </div>`;
  }
  renderAdvancedExportPanel('data-export-advanced', { compact:true });
  refreshBackupStatus(false);
  if (typeof refreshAutoBackupStatus === 'function') refreshAutoBackupStatus(false);
}
// ─────────────────────────────────────────────────────────────

// ── Stats ─────────────────────────────────────────────────────
let _statsEntries = [];
let _statsIdx = -1;

window.hydrateHistoryDetailsInBackground = hydrateHistoryDetailsInBackground;
