/*
 * FoodNote — profil, phases nutritionnelles et réglages utilisateur.
 * Rôle : gérer les objectifs, le programme de phases, les calculs de profil et les options d’application.
 * V2 : rend la page Objectif sur une base visuelle commune avec Récap, sans supprimer les hooks existants.
 * Gère : affichage/sauvegarde du profil, templates de phases, préférences d’interface liées au profil.
 * Ne doit pas gérer : champs du Journal, stockage direct SQLite, import CIQUAL/OpenFoodFacts ni orchestration IA de repas.
 */

const PHASE_INFO = {
  reverse: {
    title: 'Reverse dieting',
    mode: 'Stabilité progressive',
    text: 'Phase de remontée calorique contrôlée. On évite de rester trop bas en calories et on remonte progressivement vers la maintenance, en surveillant poids, faim, énergie et performances.'
  },
  perte: {
    title: 'Perte de poids',
    mode: 'Déficit modéré',
    text: 'Phase orientée perte de gras avec déficit calorique raisonnable. L’objectif est de perdre du poids sans trop impacter l’énergie, l’entraînement et la masse musculaire.'
  },
  recomp: {
    title: 'Recomposition',
    mode: 'Maintenance / léger ajustement',
    text: 'Phase visant à améliorer la composition corporelle : construire ou maintenir du muscle tout en réduisant progressivement le gras. Les calories restent proches de la maintenance.'
  },
  sechage: {
    title: 'Séchage',
    mode: 'Déficit marqué',
    text: 'Phase plus agressive et limitée dans le temps pour révéler la définition musculaire. Protéines plus hautes, déficit plus important, fatigue à surveiller.'
  },
  prise: {
    title: 'Prise de masse',
    mode: 'Surplus calorique',
    text: 'Phase destinée à maximiser la progression musculaire avec un léger surplus. Une petite prise de gras est possible et normale si le surplus est contrôlé.'
  },
  maint: {
    title: 'Maintenance',
    mode: 'Stabilité',
    text: 'Phase de diagnostic. L’objectif est de maintenir le poids et les habitudes, utile après une perte de poids, une sèche ou une prise de masse.'
  },
  maintenance: {
    title: 'Maintenance',
    mode: 'Stabilité',
    text: 'Phase de diagnostic. L’objectif est de maintenir le poids et les habitudes, utile après une perte de poids, une sèche ou une prise de masse.'
  }
};

function phaseInfo(id) {
  return PHASE_INFO[id] || { title: id || 'Phase', mode: 'Programme', text: 'Phase personnalisée du programme.' };
}

function finalObjectiveFromPhases(phases) {
  if (!Array.isArray(phases) || !phases.length) return 'maintenance';
  const last = phases[phases.length - 1];
  return last.id === 'maint' ? 'maintenance' : (last.id || 'maintenance');
}

function defaultPhaseProgramForObjective(objectif) {
  const get = id => PHASES_DEF.find(p => p.id === id);
  const idsByObjective = {
    reverse: ['reverse', 'recomp'],
    recomp: ['reverse', 'recomp'],
    perte: ['perte', 'maint'],
    sechage: ['sechage', 'maint'],
    prise: ['maint', 'prise'],
    maintenance: ['maint'],
    maint: ['maint']
  };
  const ids = idsByObjective[objectif] || [objectif || 'maint'];
  return ids.map((id, i) => {
    const ph = get(id);
    return ph ? createPhaseTimelineItem(ph) : null;
  }).filter(Boolean);
}

function phaseInfoCardHTML(id) {
  const info = phaseInfo(id);
  return '<div class="phase-info-panel-head">'
    + '<strong>' + info.title + '</strong>'
    + '<span>' + info.mode + '</span>'
    + '</div>'
    + '<p>' + info.text + '</p>';
}

function ensurePhaseInfoPanel(container) {
  if (!container) return null;
  let panel = container.nextElementSibling;
  if (!panel || !panel.classList?.contains('phase-info-panel')) {
    panel = document.createElement('div');
    panel.className = 'phase-info-panel';
    container.insertAdjacentElement('afterend', panel);
  }
  return panel;
}

function togglePhaseInfo(ev, id) {
  if (ev) ev.stopPropagation();
  const card = ev?.target?.closest?.('.phase-card');
  const container = card?.closest?.('#phases-pool, #phases-timeline');
  const panel = ensurePhaseInfoPanel(container);
  if (!panel || !card) return;

  const sameOpen = panel.classList.contains('visible') && panel.dataset.phaseId === id;
  document.querySelectorAll('.phase-card.phase-info-active').forEach(c => c.classList.remove('phase-info-active'));
  document.querySelectorAll('.phase-info-panel.visible').forEach(p => {
    if (p !== panel) { p.classList.remove('visible'); p.innerHTML = ''; delete p.dataset.phaseId; }
  });

  if (sameOpen) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
    delete panel.dataset.phaseId;
    return;
  }

  card.classList.add('phase-info-active');
  panel.dataset.phaseId = id;
  panel.innerHTML = phaseInfoCardHTML(id);
  panel.classList.add('visible');
}

function phaseInfoButtonHTML(id) {
  return `<span class="phase-info-wrap"><button class="phase-info-btn" onclick="togglePhaseInfo(event,'${id}')" title="Infos sur cette phase" aria-label="Infos sur cette phase">i</button></span>`;
}

function phaseInfoBubbleHTML(id) {
  return phaseInfoButtonHTML(id);
}


function escapePhaseHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getPhaseDef(id) {
  return PHASES_DEF.find(ph2 => ph2.id === id);
}

function phaseProgramUid() {
  return 'phase_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function normalizePhaseTimelineItem(item) {
  if (!item) return null;
  const def = getPhaseDef(item.id) || item;
  return {
    ...def,
    ...item,
    id: item.id || def.id || 'phase',
    label: item.label || def.label || 'Phase',
    desc: item.desc || def.desc || '',
    color: item.color || def.color || 'var(--green)',
    weeks: Math.max(1, Math.min(52, parseInt(item.weeks, 10) || parseInt(def.weeks, 10) || 4)),
    _uid: item._uid || phaseProgramUid()
  };
}

function createPhaseTimelineItem(def) {
  return normalizePhaseTimelineItem({ ...(def || {}), _uid: phaseProgramUid() });
}

function phaseProgramSavedPayload() {
  return phaseTimeline.map(ph => ({
    id: ph.id,
    label: ph.label,
    weeks: Math.max(1, Math.min(52, parseInt(ph.weeks, 10) || 1)),
    color: ph.color,
    desc: ph.desc
  }));
}

function phaseProgramSignature(phases) {
  return JSON.stringify((Array.isArray(phases) ? phases : []).map(ph => ({
    id: ph?.id || '',
    label: ph?.label || '',
    weeks: Math.max(1, Math.min(52, parseInt(ph?.weeks, 10) || 1)),
    color: ph?.color || '',
    desc: ph?.desc || ''
  })));
}

let phaseProgramHydratedSignature = null;
let phaseProgramDirty = false;
let phaseProgramEventsRoot = null;
let phaseProgramDrag = null;
let phaseProgramSuppressClickUntil = 0;
let phaseProgramCommitGuard = { key: '', until: 0 };

function phaseNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function phaseProgramSuppressClick(ms = 350) {
  phaseProgramSuppressClickUntil = Math.max(phaseProgramSuppressClickUntil, phaseNow() + ms);
}

function phaseProgramIsClickSuppressed() {
  return phaseNow() < phaseProgramSuppressClickUntil;
}

function phaseProgramGuard(key, ms = 260) {
  const now = phaseNow();
  if (phaseProgramCommitGuard.key === key && now < phaseProgramCommitGuard.until) return false;
  phaseProgramCommitGuard = { key, until: now + ms };
  return true;
}

function setPhaseTimeline(nextTimeline, { dirty = true, render = true } = {}) {
  phaseTimeline = (Array.isArray(nextTimeline) ? nextTimeline : []).map(normalizePhaseTimelineItem).filter(Boolean);
  phaseProgramDirty = !!dirty;
  if (render) renderPhaseProgramAll();
  return phaseTimeline;
}

function mutatePhaseTimeline(mutator, guardKey = '') {
  if (guardKey && !phaseProgramGuard(guardKey)) return false;
  const before = phaseProgramSignature(phaseTimeline);
  const result = mutator(phaseTimeline);
  phaseTimeline = (Array.isArray(phaseTimeline) ? phaseTimeline : []).map(normalizePhaseTimelineItem).filter(Boolean);
  const after = phaseProgramSignature(phaseTimeline);
  if (after !== before || result === true) phaseProgramDirty = true;
  renderPhaseProgramAll();
  return true;
}

function phaseCard(ph, inPool) {
  const item = normalizePhaseTimelineItem(ph);
  const el = document.createElement('div');
  el.className = 'phase-card fn-ui-phase-card ' + (inPool ? 'fn-ui-phase-card-pool' : 'fn-ui-phase-card-program fn-ui-row fn-ui-row--program');
  el.dataset.id = item.id;
  el.dataset.uid = inPool ? '' : item._uid;
  el.dataset.source = inPool ? 'pool' : 'timeline';
  el.draggable = false;
  el.style.setProperty('--phase-color', item.color || 'var(--green)');

  const dot = '<span class="fn-ui-phase-dot" style="background:' + escapePhaseHTML(item.color || 'var(--green)') + '"></span>';
  if (inPool) {
    el.innerHTML = dot
      + '<span class="fn-ui-phase-name">' + escapePhaseHTML(item.label) + '</span>'
      + '<span class="fn-ui-phase-desc">' + escapePhaseHTML(item.desc) + '</span>'
      + phaseInfoBubbleHTML(item.id);
    el.title = 'Cliquer ou glisser pour ajouter';
    return el;
  }

  el.innerHTML = dot
    + '<span class="fn-ui-phase-main"><span class="fn-ui-phase-name">' + escapePhaseHTML(item.label) + '</span><span class="fn-ui-phase-desc">' + escapePhaseHTML(item.desc) + '</span></span>'
    + phaseInfoButtonHTML(item.id)
    + '<div class="fn-ui-phase-controls">'
    + '<button class="fn-ui-icon-btn" data-phase-action="up" data-phase-uid="' + escapePhaseHTML(item._uid) + '" title="Monter">↑</button>'
    + '<button class="fn-ui-icon-btn" data-phase-action="down" data-phase-uid="' + escapePhaseHTML(item._uid) + '" title="Descendre">↓</button>'
    + '<input class="fn-ui-week-input" data-phase-action="weeks" data-phase-uid="' + escapePhaseHTML(item._uid) + '" type="number" min="1" max="52" value="' + (item.weeks || 4) + '">'
    + '<span class="fn-ui-week-label">sem.</span>'
    + '<button class="fn-ui-icon-btn fn-ui-icon-danger" data-phase-action="remove" data-phase-uid="' + escapePhaseHTML(item._uid) + '" title="Retirer">×</button>'
    + '</div>';
  return el;
}

function renderPhasePool() {
  const pool = document.getElementById('phases-pool');
  if (!pool) return;
  setupPhaseDropZone();
  pool.innerHTML = '';
  PHASES_DEF.forEach(ph => pool.appendChild(phaseCard(ph, true)));
}

function renderPhaseTimeline() {
  const tl = document.getElementById('phases-timeline');
  const hint = document.getElementById('phases-hint');
  if (!tl) return;
  setupPhaseDropZone();
  Array.from(tl.children).forEach(c => { if (c.id !== 'phases-hint') c.remove(); });
  if (hint) hint.style.display = phaseTimeline.length ? 'none' : 'block';
  phaseTimeline.forEach(ph => tl.appendChild(phaseCard(ph, false)));
}

function renderPhasesBar() {
  const bar = document.getElementById('phases-bar');
  if (!bar) return;
  if (!phaseTimeline.length) { bar.innerHTML = ''; return; }
  const total = phaseTimeline.reduce((s, p) => s + (Number(p.weeks) || 1), 0);
  const segments = phaseTimeline.map(p => {
    const weeks = Math.max(1, Number(p.weeks) || 1);
    const pct = total > 0 ? Math.round(weeks / total * 100) : 0;
    const label = String(p.label || '').trim();
    const shortLabel = label.split(/\s+/)[0] || 'Phase';
    const color = String(p.color || 'var(--green)').trim();
    return `<i style="--phase-color:${escapePhaseHTML(color)};--phase-weeks:${weeks}" title="${escapePhaseHTML(label)} · ${weeks} semaine(s) · ${pct}%"><span>${pct >= 7 ? escapePhaseHTML(shortLabel + ' ' + weeks + 'sem') : ''}</span></i>`;
  }).join('');
  const labels = phaseTimeline.map(p => {
    const weeks = Math.max(1, Number(p.weeks) || 1);
    const label = String(p.label || '').trim();
    return `<span style="--phase-weeks:${weeks}">${escapePhaseHTML(label.split(/\s+/)[0] || 'Phase')} ${weeks}sem</span>`;
  }).join('');
  bar.innerHTML = `<div class="fn-ui-phase-bar-head"><span>Total</span><strong>${total} semaines</strong></div><div class="fn-ui-phase-segments" aria-label="Programme de phases, total ${total} semaines">${segments}</div><div class="fn-ui-phase-labels">${labels}</div>`;
}

function renderPhaseProgramAll() {
  renderPhaseTimeline();
  renderPhasesBar();
}

function clearDropMarks() {
  document.querySelectorAll('.phase-card').forEach(c => {
    c.style.transform = '';
    c.style.boxShadow = '';
  });
  const tl = document.getElementById('phases-timeline');
  if (tl) tl.style.outline = '';
}

function markDropTarget(card, y) {
  clearDropMarks();
  if (!card) return;
  const r = card.getBoundingClientRect();
  const before = y < r.top + r.height / 2;
  card.style.transform = before ? 'translateY(3px)' : 'translateY(-3px)';
  card.style.boxShadow = before ? '0 -3px 0 var(--green)' : '0 3px 0 var(--green)';
}

function getNextTimelineUid(uid) {
  const i = phaseTimeline.findIndex(p => p._uid === uid);
  return i >= 0 && i < phaseTimeline.length - 1 ? phaseTimeline[i + 1]._uid : null;
}

function getDropBeforeUid(card, y) {
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return y < r.top + r.height / 2 ? card.dataset.uid : getNextTimelineUid(card.dataset.uid);
}

function getPhaseDropTarget(x, y) {
  const below = document.elementFromPoint(x, y);
  const timeline = document.getElementById('phases-timeline');
  const card = below?.closest?.('#phases-timeline .phase-card');
  if (card) return { inside: true, beforeUid: getDropBeforeUid(card, y), card };
  if (timeline) {
    const r = timeline.getBoundingClientRect();
    const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    return { inside, beforeUid: null, card: null };
  }
  return { inside: false, beforeUid: null, card: null };
}

function movePhaseTo(uid, beforeUid = null) {
  if (!uid || uid === beforeUid) return false;
  return mutatePhaseTimeline(list => {
    const oldIndex = list.findIndex(p => p._uid === uid);
    if (oldIndex < 0) return false;
    const [moved] = list.splice(oldIndex, 1);
    let insertAt = beforeUid ? list.findIndex(p => p._uid === beforeUid) : -1;
    if (insertAt < 0) list.push(moved);
    else list.splice(insertAt, 0, moved);
    return true;
  }, 'move:' + uid + ':' + (beforeUid || 'end'));
}

function commitAddPhase(def, beforeUid = null) {
  if (!def) return false;
  return mutatePhaseTimeline(list => {
    const newPhase = createPhaseTimelineItem(def);
    const insertAt = beforeUid ? list.findIndex(p => p._uid === beforeUid) : -1;
    if (insertAt >= 0) list.splice(insertAt, 0, newPhase);
    else list.push(newPhase);
    return true;
  }, 'add:' + (def.id || 'phase') + ':' + (beforeUid || 'end'));
}

function addPhaseToTimeline(ph) {
  return commitAddPhase(ph);
}

function removePhase(uid) {
  return mutatePhaseTimeline(list => {
    const before = list.length;
    phaseTimeline = list.filter(p => p._uid !== uid);
    return phaseTimeline.length !== before;
  }, 'remove:' + uid);
}

function movePhaseUp(uid) {
  const i = phaseTimeline.findIndex(p => p._uid === uid);
  if (i <= 0) return false;
  const beforeUid = phaseTimeline[i - 1]._uid;
  return movePhaseTo(uid, beforeUid);
}

function movePhaseDown(uid) {
  const i = phaseTimeline.findIndex(p => p._uid === uid);
  if (i < 0 || i >= phaseTimeline.length - 1) return false;
  const nextUid = phaseTimeline[i + 2]?._uid || null;
  return movePhaseTo(uid, nextUid);
}

function updatePhaseWeeks(uid, val) {
  const weeks = Math.max(1, Math.min(52, parseInt(val, 10) || 1));
  return mutatePhaseTimeline(list => {
    const ph = list.find(ph2 => ph2._uid === uid);
    if (!ph) return false;
    ph.weeks = weeks;
    return true;
  }, 'weeks:' + uid + ':' + weeks);
}

function resetPhases() {
  setPhaseTimeline([], { dirty: true, render: true });
}

function handlePhaseDrop(payload, beforeUid) {
  clearDropMarks();
  if (!payload) return false;
  if (payload.startsWith('phase:')) {
    const def = getPhaseDef(payload.slice(6));
    return def ? commitAddPhase(def, beforeUid) : false;
  }
  if (payload.startsWith('uid:')) return movePhaseTo(payload.slice(4), beforeUid);
  return false;
}

function phaseProgramStartDrag(card, ev) {
  if (!card) return;
  const source = card.dataset.source;
  const payload = source === 'pool' ? 'phase:' + card.dataset.id : 'uid:' + card.dataset.uid;
  if (!payload || payload.endsWith(':')) return;
  phaseProgramDrag = {
    sourceEl: card,
    pointerId: ev.pointerId,
    startX: ev.clientX,
    startY: ev.clientY,
    x: ev.clientX,
    y: ev.clientY,
    payload,
    active: false,
    ghost: null
  };
  try { card.setPointerCapture?.(ev.pointerId); } catch (_) {}
}

function phaseProgramEnsureGhost() {
  if (!phaseProgramDrag || phaseProgramDrag.ghost) return;
  const el = phaseProgramDrag.sourceEl;
  const g = el.cloneNode(true);
  const r = el.getBoundingClientRect();
  g.style.position = 'fixed';
  g.style.left = '0';
  g.style.top = '0';
  g.style.width = r.width + 'px';
  g.style.zIndex = '9999';
  g.style.pointerEvents = 'none';
  g.style.opacity = '0.88';
  g.style.boxShadow = '0 10px 28px rgba(0,0,0,0.24)';
  document.body.appendChild(g);
  phaseProgramDrag.ghost = g;
  el.style.opacity = '0.35';
}

function phaseProgramEndDrag(commit) {
  if (!phaseProgramDrag) return;
  const d = phaseProgramDrag;
  if (d.ghost) d.ghost.remove();
  if (d.sourceEl) d.sourceEl.style.opacity = '1';
  if (commit && d.active) {
    const target = getPhaseDropTarget(d.x, d.y);
    if (target.inside) handlePhaseDrop(d.payload, target.beforeUid);
    phaseProgramSuppressClick(650);
  }
  phaseProgramDrag = null;
  clearDropMarks();
}

function setupPhaseDropZone() {
  const builder = document.getElementById('objectif-programme-builder') || document.getElementById('objectif-programme');
  if (!builder || phaseProgramEventsRoot === builder) return;
  phaseProgramEventsRoot = builder;

  builder.addEventListener('click', ev => {
    const actionBtn = ev.target.closest('[data-phase-action]');
    if (actionBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const uid = actionBtn.dataset.phaseUid;
      const action = actionBtn.dataset.phaseAction;
      if (action === 'up') movePhaseUp(uid);
      if (action === 'down') movePhaseDown(uid);
      if (action === 'remove') removePhase(uid);
      return;
    }

    if (ev.target.closest('button,input,.phase-info-btn')) return;
    if (phaseProgramIsClickSuppressed()) { ev.preventDefault(); ev.stopPropagation(); return; }
    const card = ev.target.closest('#phases-pool .phase-card[data-source="pool"]');
    if (!card) return;
    ev.preventDefault();
    const def = getPhaseDef(card.dataset.id);
    if (def) commitAddPhase(def);
  });

  builder.addEventListener('input', ev => {
    const input = ev.target.closest('input[data-phase-action="weeks"]');
    if (!input) return;
    updatePhaseWeeks(input.dataset.phaseUid, input.value);
  });

  builder.addEventListener('pointerdown', ev => {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (ev.target.closest('button,input,.phase-info-btn')) return;
    const card = ev.target.closest('.phase-card');
    if (!card || !builder.contains(card)) return;
    phaseProgramStartDrag(card, ev);
  }, { passive: true });

  builder.addEventListener('pointermove', ev => {
    if (!phaseProgramDrag || phaseProgramDrag.pointerId !== ev.pointerId) return;
    const dx = ev.clientX - phaseProgramDrag.startX;
    const dy = ev.clientY - phaseProgramDrag.startY;
    if (!phaseProgramDrag.active && Math.hypot(dx, dy) < 8) return;
    ev.preventDefault();
    phaseProgramDrag.active = true;
    phaseProgramDrag.x = ev.clientX;
    phaseProgramDrag.y = ev.clientY;
    phaseProgramSuppressClick(500);
    phaseProgramEnsureGhost();
    if (phaseProgramDrag.ghost) phaseProgramDrag.ghost.style.transform = 'translate(' + (ev.clientX + 8) + 'px,' + (ev.clientY + 8) + 'px)';
    const target = getPhaseDropTarget(ev.clientX, ev.clientY);
    if (target.card) markDropTarget(target.card, ev.clientY);
    else {
      clearDropMarks();
      const tl = document.getElementById('phases-timeline');
      if (tl && target.inside) tl.style.outline = '1px dashed var(--green)';
    }
  }, { passive: false });

  builder.addEventListener('pointerup', ev => {
    if (!phaseProgramDrag || phaseProgramDrag.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    ev.stopPropagation();
    phaseProgramDrag.x = ev.clientX;
    phaseProgramDrag.y = ev.clientY;
    phaseProgramEndDrag(true);
  });

  builder.addEventListener('pointercancel', () => phaseProgramEndDrag(false));
}

function savePhases() {
  const p = loadProfil();
  p.phases = phaseProgramSavedPayload();
  if (p.phases.length) {
    p.phase = p.phase || p.phases[0].id;
    p.objectif = finalObjectiveFromPhases(p.phases);
    p.phaseLabel = p.phases.map(ph => ph.label + ' (' + ph.weeks + 'sem)').join(' → ');
    const input = document.getElementById('cfg-phase-label');
    if (input) input.value = p.phaseLabel;
    const obj = document.getElementById('cfg-objectif');
    if (obj && [...obj.options].some(o => o.value === p.objectif)) obj.value = p.objectif;
  }
  saveProfil(p);
  if (typeof fetch === 'function') {
    fetch('/api/phases', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({phases:p.phases || []})})
      .catch(e => console.warn('/api/phases sauvegarde impossible', e));
  }
  PROFIL = { ...PROFIL, ...p };
  phaseProgramDirty = false;
  phaseProgramHydratedSignature = phaseProgramSignature(p.phases || []);
  const st = document.getElementById('phases-save-status');
  if (st) { st.style.display = 'block'; setTimeout(() => st.style.display='none', 2500); }
  const subTitle = document.getElementById('header-subtitle');
  if (subTitle && p.phases.length) subTitle.textContent = p.phases[0].label;
  if (typeof renderJournalPhaseMini === 'function') renderJournalPhaseMini();
}

function loadSavedPhases(options = {}) {
  const p = loadProfil();
  const saved = Array.isArray(p.phases) ? p.phases : [];
  const signature = phaseProgramSignature(saved);
  if (!options.force && phaseProgramDirty) {
    renderPhaseProgramAll();
    return;
  }
  if (!options.force && phaseProgramHydratedSignature === signature && phaseTimeline.length) {
    renderPhaseProgramAll();
    return;
  }
  phaseTimeline = saved.map(normalizePhaseTimelineItem).filter(Boolean);
  phaseProgramHydratedSignature = signature;
  phaseProgramDirty = false;
  renderPhaseProgramAll();
}


function normalizeActivityFactor(value, fallback = 1.55) {
  const raw = String(value ?? '').trim();
  const numeric = parseFloat(raw.replace(',', '.'));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const map = {
    sedentaire: 1.2,
    sédentaire: 1.2,
    leger: 1.375,
    légère: 1.375,
    legere: 1.375,
    modere: 1.55,
    modérée: 1.55,
    moderee: 1.55,
    actif: 1.725,
    eleve: 1.725,
    élevée: 1.725,
    elevee: 1.725,
    tres_actif: 1.9,
    'très élevée': 1.9,
    tres_elevee: 1.9,
    très_élevée: 1.9
  };
  return map[raw.toLowerCase()] || fallback;
}

function normalizeSexe(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'f' || raw === 'femme') return 'femme';
  return 'homme';
}

function getProfilAutoTargets() {
  const p = loadProfil();
  const val = (id, ...fallbacks) => {
    const el = document.getElementById(id);
    const domValue = el && String(el.value ?? '').trim() !== '' ? el.value : '';
    return domValue || fallbacks.find(v => String(v ?? '').trim() !== '') || '';
  };

  const sexe = normalizeSexe(val('cfg-sexe', p.sexe, p.gender, 'homme'));
  const age = parseFloat(String(val('cfg-age', p.age)).replace(',', '.')) || 0;
  const taille = parseFloat(String(val('cfg-taille', p.taille, p.height)).replace(',', '.')) || 0;
  const poids = parseFloat(String(val('cfg-poids', p.poidsRef, p.poids, p.weight)).replace(',', '.')) || 0;
  const activite = normalizeActivityFactor(val('cfg-activite', p.activite, p.activityFactor), 1.55);
  const objectif = val('cfg-objectif', p.objectif, p.phase, 'maintenance') || 'maintenance';
  if (!age || !taille || !poids) return null;

  const bmr = sexe === 'femme'
    ? (10 * poids + 6.25 * taille - 5 * age - 161)
    : (10 * poids + 6.25 * taille - 5 * age + 5);
  const tdee = Math.round(bmr * activite);
  const phase = PHASES_PREDEF[objectif] || PHASES_PREDEF.maintenance;
  const lip = Math.max(35, phase.lipFn(poids));
  const prot = Math.max(60, phase.protFn(poids));
  const kcal = Math.max(900, phase.kcalFn(tdee));
  const gluc = Math.max(20, phase.glucFn(kcal, prot, lip));
  return { bmr: Math.round(bmr), tdee, kcal, prot, gluc, lip, phase, poids, taille, age, sexe, activite };
}

function previewProfilAuto() {
  const box = document.getElementById('profil-auto-preview');
  if (!box) return;
  const r = getProfilAutoTargets();
  if (!r) {
    box.innerHTML = '<div class="fn-ui-alert-icon">⚡</div>'
      + '<div><b>Calcul automatique</b><p>Renseigne poids, taille et âge puis clique sur <strong>Calculer mes cibles</strong>.</p></div>';
    return;
  }
  box.innerHTML = '<div class="fn-ui-alert-icon">' + r.phase.icon + '</div>'
    + '<div><b>' + r.phase.icon + ' ' + r.phase.label + '</b>'
    + '<p>Maintenance estimée : <strong>' + r.tdee + ' kcal</strong>. Cibles proposées : <strong>' + r.kcal + ' kcal</strong>, '
    + '<strong>' + r.prot + ' g protéines</strong>, ' + r.gluc + ' g glucides, ' + r.lip + ' g lipides.</p>'
    + '<p>' + r.phase.conseil + '</p></div>';
}

function applyProfilAuto() {
  const r = getProfilAutoTargets();
  if (!r) { previewProfilAuto(); return; }
  document.getElementById('cfg-kcal').value = r.kcal;
  document.getElementById('cfg-prot').value = r.prot;
  document.getElementById('cfg-gluc').value = r.gluc;
  document.getElementById('cfg-lip').value = r.lip;
  previewProfilAuto();
  updateProfilSummary();
}

function updateProfilSummary() {
  const p = loadProfil();
  const pren = document.getElementById('cfg-prenom')?.value.trim() || p.prenom || 'FoodNote';
  const desc = document.getElementById('cfg-phase-label')?.value.trim() || p.phaseLabel || 'Configure ton objectif, tes calories et ton programme.';
  const kcal = document.getElementById('cfg-kcal')?.value || p.cibleKcal || '—';
  const prot = document.getElementById('cfg-prot')?.value || p.cibleProt || '—';
  const gluc = document.getElementById('cfg-gluc')?.value || p.cibleGluc || '—';
  const lip  = document.getElementById('cfg-lip')?.value  || p.cibleLip  || '—';
  const n = document.getElementById('profile-summary-name'); if (n) n.textContent = pren;
  const d = document.getElementById('profile-summary-desc'); if (d) d.textContent = desc;
  const k = document.getElementById('profile-kpi-kcal'); if (k) k.textContent = kcal;
  const pr = document.getElementById('profile-kpi-prot'); if (pr) pr.textContent = prot + 'g';
  const g = document.getElementById('profile-kpi-gluc'); if (g) g.textContent = gluc + 'g';
  const l = document.getElementById('profile-kpi-lip'); if (l) l.textContent = lip + 'g';
}

function applyPhaseTemplate(type) {
  const get = id => PHASES_DEF.find(ph2 => ph2.id === id);
  const tpl = type === 'cut'
    ? [ ['reverse',4], ['perte',8], ['maint',3], ['sechage',6], ['maint',4] ]
    : [ ['recomp',12], ['maint',4], ['perte',6], ['recomp',8] ];
  setPhaseTimeline(tpl.map(([id,w]) => ({ ...createPhaseTimelineItem(get(id)), weeks:w })), { dirty:true, render:true });
}

function renderCfgProfil() {
  renderPhasePool();
  setupPhaseDropZone();
  loadSavedPhases();
  const p = loadProfil();
  const els = {
    prenom: document.getElementById('cfg-prenom'),
    phase:  document.getElementById('cfg-phase-label'),
    sexe:   document.getElementById('cfg-sexe'),
    age:    document.getElementById('cfg-age'),
    taille: document.getElementById('cfg-taille'),
    poids:  document.getElementById('cfg-poids'),
    activite: document.getElementById('cfg-activite'),
    objectif: document.getElementById('cfg-objectif'),
    kcal:   document.getElementById('cfg-kcal'),
    prot:   document.getElementById('cfg-prot'),
    gluc:   document.getElementById('cfg-gluc'),
    lip:    document.getElementById('cfg-lip'),
  };
  if (els.prenom) els.prenom.value = p.prenom || '';
  if (els.phase)  els.phase.value  = p.phaseLabel || '';
  if (els.sexe)   els.sexe.value   = p.sexe || 'homme';
  if (els.age)    els.age.value    = p.age || '';
  if (els.taille) els.taille.value = p.taille || '';
  if (els.poids)  els.poids.value  = p.poidsRef || p.poids || p.weight || '';
  if (els.activite) els.activite.value = String(normalizeActivityFactor(p.activite || p.activityFactor || '1.55'));
  if (els.objectif) els.objectif.value = p.objectif || 'perte';
  if (els.kcal)   els.kcal.value   = p.cibleKcal || 2000;
  if (els.prot)   els.prot.value   = p.cibleProt || 120;
  if (els.gluc)   els.gluc.value   = p.cibleGluc || 220;
  if (els.lip)    els.lip.value    = p.cibleLip  || 70;

  ['cfg-sexe','cfg-age','cfg-taille','cfg-poids','cfg-activite','cfg-objectif','cfg-kcal','cfg-prot','cfg-gluc','cfg-lip','cfg-prenom','cfg-phase-label'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.dataset.boundProfile !== '1') {
      el.dataset.boundProfile = '1';
      el.addEventListener('input', () => { previewProfilAuto(); updateProfilSummary(); });
      el.addEventListener('change', () => { previewProfilAuto(); updateProfilSummary(); });
    }
  });
  previewProfilAuto();
  updateProfilSummary();
}

function saveCfgProfil() {
  const p = loadProfil();
  p.prenom     = document.getElementById('cfg-prenom')?.value.trim() || '';
  p.phaseLabel = document.getElementById('cfg-phase-label')?.value.trim() || '';
  p.sexe       = document.getElementById('cfg-sexe')?.value || 'homme';
  p.age        = parseInt(document.getElementById('cfg-age')?.value) || '';
  p.taille     = parseInt(document.getElementById('cfg-taille')?.value) || '';
  p.poidsRef   = parseFloat(String(document.getElementById('cfg-poids')?.value || '').replace(',', '.')) || '';
  p.poids      = p.poidsRef;
  p.activite   = String(normalizeActivityFactor(document.getElementById('cfg-activite')?.value || '1.55'));
  p.activityFactor = Number(p.activite);
  p.objectif   = document.getElementById('cfg-objectif')?.value || 'perte';
  p.cibleKcal  = parseInt(document.getElementById('cfg-kcal')?.value)  || 2000;
  p.cibleProt  = parseInt(document.getElementById('cfg-prot')?.value)  || 120;
  p.cibleGluc  = parseInt(document.getElementById('cfg-gluc')?.value)  || 220;
  p.cibleLip   = parseInt(document.getElementById('cfg-lip')?.value)   || 70;
  saveProfil(p);
  PROFIL = { ...PROFIL, ...p };
  updateMacros();
  updateProfilSummary();
  const st = document.getElementById('cfg-save-status');
  if (st) { st.style.display = 'block'; setTimeout(() => st.style.display = 'none', 2500); }
  const subTitle = document.getElementById('header-subtitle');
  if (subTitle) subTitle.textContent = p.phaseLabel || 'Mon suivi nutritionnel';
  const avatarEl = document.getElementById('sb-avatar');
  const prenomEl = document.getElementById('sb-prenom');
  const pren = p.prenom || 'FoodNote';
  if (avatarEl) avatarEl.textContent = pren.substring(0,2).toUpperCase();
  if (prenomEl) prenomEl.textContent = pren;
}

function foodnoteSetGroqChip(text) {
  const chip = document.getElementById('groq-mode-chip');
  if (chip) chip.textContent = text || 'Auto';
}

function foodnoteSetGroqPlaceholder(status) {
  const input = document.getElementById('groq-key-input');
  const btn = document.getElementById('groq-key-save-btn');
  if (!input) return;
  const storageEnabled = !status || status.storage_enabled !== false;
  const envLocked = status && status.source === 'env';
  input.value = '';
  input.disabled = !storageEnabled || envLocked;
  if (btn) btn.disabled = !storageEnabled || envLocked;
  if (status && status.configured && status.masked) input.placeholder = 'Configurée : ' + status.masked;
  else if (!storageEnabled) input.placeholder = 'Désactivé : FOODNOTE_ALLOW_UI_SECRET_STORAGE=1';
  else if (envLocked) input.placeholder = 'Gérée par GROQ_API_KEY';
  else input.placeholder = 'gsk_...';
}

async function foodnoteGetGroqServerStatus() {
  const r = await fetch('/api/groq/key/status', { cache:'no-store' });
  if (!r.ok) throw new Error('Statut Groq indisponible (' + r.status + ')');
  return await r.json();
}

function foodnoteApplyGroqServerStatus(status) {
  foodnoteSetGroqPlaceholder(status);
  const storageEnabled = !status || status.storage_enabled !== false;
  if (status && status.configured) {
    foodnoteSetGroqChip(status.source === 'env' ? 'Serveur ENV' : 'SQLite');
    if (typeof fnIASetGroqStatus === 'function') {
      const src = status.source === 'env' ? 'Docker/env' : 'SQLite';
      fnIASetGroqStatus('✓ Clé Groq active via ' + src + (status.masked ? ' (' + status.masked + ')' : ''), true);
    }
  } else if (!storageEnabled) {
    foodnoteSetGroqChip('ENV requis');
    if (typeof fnIASetGroqStatus === 'function') {
      fnIASetGroqStatus('Stockage SQLite désactivé. Configure GROQ_API_KEY ou active FOODNOTE_ALLOW_UI_SECRET_STORAGE=1.', null);
    }
  } else {
    foodnoteSetGroqChip('À configurer');
    if (typeof fnIASetGroqStatus === 'function') fnIASetGroqStatus('Aucune clé serveur. Saisis une clé puis sauvegarde.', null);
  }
}

async function foodnoteMigrateLegacyLocalGroqKey(status) {
  if (status && status.configured) return status;
  if (status && status.storage_enabled === false) return status;
  const localKey = (typeof fnIASafeLocalGet === 'function') ? fnIASafeLocalGet('groq_api_key', '') : safeLocalGet('groq_api_key', '');
  const key = String(localKey || '').trim();
  if (!key || !/^gsk_[A-Za-z0-9_-]{10,}/.test(key)) return status;
  try {
    const r = await fetch('/api/groq/key', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ key })
    });
    const saved = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(saved.error || 'Migration Groq impossible');
    if (typeof fnIASafeLocalSet === 'function') fnIASafeLocalSet('groq_api_key', '');
    else localStorage.removeItem('groq_api_key');
    return saved;
  } catch(e) {
    console.warn('[FoodNote] migration clé Groq locale vers SQLite impossible:', e);
    return status;
  }
}

async function saveGroqKey() {
  const input = document.getElementById('groq-key-input');
  const key = (input && input.value ? input.value : '').trim();
  if (!key) { alert('Saisis une clé API Groq. Elle sera sauvegardée côté serveur seulement si FOODNOTE_ALLOW_UI_SECRET_STORAGE=1 est actif.'); return; }
  if (typeof fnIASetGroqStatus === 'function') fnIASetGroqStatus('Sauvegarde serveur…', null);
  try {
    const r = await fetch('/api/groq/key', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ key })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Sauvegarde Groq impossible');
    if (typeof fnIASafeLocalSet === 'function') fnIASafeLocalSet('groq_api_key', '');
    else localStorage.removeItem('groq_api_key');
    foodnoteApplyGroqServerStatus(data);
  } catch(e) {
    if (typeof fnIASetGroqStatus === 'function') fnIASetGroqStatus('Erreur sauvegarde clé Groq : ' + (e.message || e), false);
    else alert('Erreur sauvegarde clé Groq : ' + (e.message || e));
  }
}

function loadGroqKey() {
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) return '';
  if (typeof fnIALoadModel === 'function') fnIALoadModel();
  foodnoteSetGroqChip('Vérification…');
  if (typeof fnIASetGroqStatus === 'function') fnIASetGroqStatus('Vérification de la clé serveur…', null);
  foodnoteGetGroqServerStatus()
    .then(foodnoteMigrateLegacyLocalGroqKey)
    .then(foodnoteApplyGroqServerStatus)
    .catch(e => {
      console.warn('[FoodNote] statut Groq serveur impossible:', e);
      const key = (typeof fnIASafeLocalGet === 'function') ? fnIASafeLocalGet('groq_api_key', '') : safeLocalGet('groq_api_key', '');
      foodnoteSetGroqChip(key ? 'Locale' : 'Indisponible');
      if (typeof fnIASetGroqStatus === 'function') {
        fnIASetGroqStatus(key ? 'Clé locale détectée, mais le serveur ne répond pas.' : 'Serveur indisponible pour la clé Groq.', key ? true : false);
      }
    });
  return '';
}

function buildFoodNoteMealEstimatePrompt(texte) {
  return `Tu es un expert en nutrition pratique pour suivi de calories.
Pour chaque aliment ci-dessous, estime les valeurs nutritionnelles UNIQUEMENT pour la quantité indiquée.
Contexte : les plats peuvent venir d'un restaurant d'entreprise ; utilise des valeurs réalistes, ni trop optimistes ni exagérées.

Réponds UNIQUEMENT avec un tableau Markdown, une ligne par aliment, colonnes exactes :
Nom | Quantité (g) | Kcal | Protéines (g) | Glucides (g) | Lipides (g)

Règles :
- quantité en grammes ; si elle n'est pas indiquée, fais une estimation raisonnable et indique cette quantité ;
- les macros sont pour la quantité indiquée, pas pour 100g ;
- pas de texte avant ou après le tableau ;
- pas de total.

Aliments :
${texte}`;
}

async function estimerGroq(context) {
  if (typeof isAIEnabled === 'function' && !isAIEnabled()) { alert('Les fonctions IA sont désactivées dans Options de l’application.'); return; }
  const source = (typeof fnIAGetText === 'function') ? fnIAGetText(context) : { els:{ context:'modal', button:document.getElementById('food-main-action-btn') || document.getElementById('btn-groq'), response:document.getElementById('groq-response') }, text:((document.getElementById('f-ia-paste')?.value || document.getElementById('db-search')?.value || '').trim()) };
  const els = source.els;
  const texte = source.text;
  if (!texte) { alert('Décris une recette, un repas ou un aliment à estimer.'); return; }

  const btn = els.button || document.getElementById('food-main-action-btn') || document.getElementById('btn-groq');
  const respEl = els.response || document.getElementById('groq-response');
  if (btn) { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = '⏳ Estimation...'; }
  if (respEl) { respEl.style.display = 'block'; respEl.innerHTML = '<div class="fn-ui-ia-loading">Groq analyse ton repas...</div>'; }
  if (typeof fnIASetStatus === 'function') fnIASetStatus('Estimation en cours...', null, els.context);

  try {
    const reponse = await callGroqChat(buildFoodNoteMealEstimatePrompt(texte), { max_tokens: 1100, temperature: 0.1 });
    if (!reponse) throw new Error('Réponse Groq vide.');
    window._groqReponse = reponse;
    window._iaLastContext = els.context;
    if (typeof parseIANutritionTable === 'function' && typeof renderIAPreview === 'function') {
      const rows = parseIANutritionTable(reponse);
      if (respEl) { respEl.style.display = 'none'; respEl.innerHTML = ''; }
      renderIAPreview(rows, reponse, els.context);
    } else if (respEl) {
      respEl.textContent = reponse;
    }
  } catch(e) {
    if (respEl) { respEl.style.display = 'block'; respEl.innerHTML = '<div class="fn-ui-ia-error">Erreur : ' + ((typeof fnIAEscape === 'function') ? fnIAEscape(e.message || e) : (e.message || e)) + '</div>'; }
    if (typeof fnIASetStatus === 'function') fnIASetStatus('Erreur IA : ' + (e.message || e), false, els.context);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.originalText || ((typeof foodAddMode !== 'undefined' && foodAddMode === 'ia') ? 'Estimer' : '⚡ Estimer avec Groq'); }
  }
}

function importerReponseGroq() {
  const reponse = window._groqReponse || '';
  if (!reponse) return;
  if (typeof renderIAPreview === 'function' && typeof parseIANutritionTable === 'function') {
    renderIAPreview(parseIANutritionTable(reponse), reponse, window._iaLastContext || 'modal');
  } else if (typeof parseIAPaste === 'function') parseIAPaste();
  const resp = document.getElementById('groq-response');
  if (resp) resp.style.display = 'none';
}

function activityLabelFromFactor(v) {
  const n = Number(v);
  if (String(v).includes('sedentaire')) return 'Sédentaire';
  if (String(v).includes('leger')) return 'Léger';
  if (String(v).includes('modere')) return 'Modéré';
  if (String(v).includes('actif')) return 'Actif';
  if (String(v).includes('tres_actif')) return 'Très actif';
  if (Math.abs(n - 1.2) < 0.01) return 'Sédentaire';
  if (Math.abs(n - 1.375) < 0.01) return 'Léger';
  if (Math.abs(n - 1.55) < 0.01) return 'Modéré';
  if (Math.abs(n - 1.725) < 0.01) return 'Actif';
  if (Math.abs(n - 1.9) < 0.01) return 'Très actif';
  return v || 'Modéré';
}

function getPhaseRuleCardsHTML() {
  const phaseMeta = {
    reverse: { icon:'↗️', label:'Reverse dieting', description:'Remontée calorique progressive vers la maintenance.' }
  };
  const rows = [
    ['reverse', 'Cible actuelle / remontée progressive', 'poids × 2,0 g', 'poids × 0,9 g', 'calories restantes / 4'],
    ['perte', 'TDEE × 0,80', 'poids × 2,0 g', 'poids × 0,8 g', 'calories restantes / 4'],
    ['recomp', 'TDEE × 1,00', 'poids × 2,0 g', 'poids × 1,0 g', 'calories restantes / 4'],
    ['sechage', 'TDEE × 0,75', 'poids × 2,4 g', 'poids × 0,7 g', 'calories restantes / 4'],
    ['prise', 'TDEE × 1,15', 'poids × 1,8 g', 'poids × 1,0 g', 'calories restantes / 4'],
    ['maintenance', 'TDEE × 1,00', 'poids × 1,6 g', 'poids × 1,0 g', 'calories restantes / 4'],
  ];
  return rows.map(([key,kcal,prot,lip,gluc]) => {
    const ph = PHASES_PREDEF[key] || phaseMeta[key] || { icon:'', label:key, description:'' };
    return `<article class="objectif-rule-card">
      <div class="objectif-rule-phase">
        <strong>${escapePhaseHTML(ph.icon || '')} ${escapePhaseHTML(ph.label || key)}</strong>
        <span>${escapePhaseHTML(ph.description || '')}</span>
      </div>
      <dl class="objectif-rule-metrics">
        <div><dt>Calories</dt><dd>${escapePhaseHTML(kcal)}</dd></div>
        <div><dt>Prot.</dt><dd>${escapePhaseHTML(prot)}</dd></div>
        <div><dt>Lip.</dt><dd>${escapePhaseHTML(lip)}</dd></div>
        <div><dt>Gluc.</dt><dd>${escapePhaseHTML(gluc)}</dd></div>
      </dl>
    </article>`;
  }).join('');
}

function getPhaseRuleRowsHTML() {
  return getPhaseRuleCardsHTML();
}

function objectifTargetValue(p, key, fallback) {
  const profileValue = Number(p && p[key]);
  const globalValue = Number(window.PROFIL && window.PROFIL[key]);
  return Number.isFinite(profileValue) && profileValue > 0 ? profileValue : (Number.isFinite(globalValue) && globalValue > 0 ? globalValue : fallback);
}

function renderObjectifShell() {
  const page = document.getElementById('page-objectif');
  const UI = window.FoodNoteUI;
  if (!page || !UI) return;
  if (page.querySelector('#objectif-ui-root')) return;

  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const actionButtons = UI.button('Modifier mes cibles', "showPage('profil', document.getElementById('nav-profil'))", {primary:true})
    + UI.button('Programme phases', "scrollTo('objectif-programme')");

  const macroCards = [
    { macro:'kcal', icon:'🔥', label:'Calories', valueId:'objectif-ui-kcal', sub:'Cible quotidienne' },
    { macro:'prot', icon:'🍖', label:'Protéines', valueId:'objectif-ui-prot', sub:'Minimum conseillé' },
    { macro:'gluc', icon:'🍞', label:'Glucides', valueId:'objectif-ui-gluc', sub:'Énergie disponible' },
    { macro:'lip',  icon:'🥑', label:'Lipides', valueId:'objectif-ui-lip',  sub:'Équilibre hormonal' }
  ].map(card => `
    <article class="fn-v2-indicator-card fn-v2-macro-card" data-macro="${esc(card.macro)}">
      <div class="fn-v2-indicator-icon" aria-hidden="true">${esc(card.icon)}</div>
      <div class="fn-v2-indicator-copy">
        <span class="fn-v2-indicator-label">${esc(card.label)}</span>
        <strong id="${esc(card.valueId)}">—</strong>
        <small>${esc(card.sub)}</small>
      </div>
    </article>`).join('');

  const methodPanel = `
    <section class="fn-v2-panel fn-v2-method-panel">
      <details class="fn-v2-details" id="objectif-methode">
        <summary class="fn-v2-details-summary">
          <span class="fn-v2-details-icon" aria-hidden="true">🧮</span>
          <span><strong>Méthode de calcul</strong><small>Formule, activité et règles par phase</small></span>
          <span class="fn-v2-details-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="fn-v2-details-body">
          <div class="fn-v2-rule-grid">
            <div class="fn-v2-rule-card"><b>1. Métabolisme de base</b><span>Équation de Mifflin-St Jeor selon poids, taille, âge et sexe.</span></div>
            <div class="fn-v2-rule-card"><b>2. Dépense journalière</b><span>TDEE = métabolisme de base × facteur d’activité.</span></div>
            <div class="fn-v2-rule-card"><b>3. Phase nutritionnelle</b><span>Déficit, maintenance, reverse ou surplus selon ton programme.</span></div>
            <div class="fn-v2-rule-card"><b>4. Macros</b><span>Protéines et lipides sont basés sur le poids. Les glucides complètent les calories restantes.</span></div>
          </div>
          <div id="objectif-current-calc" class="fn-v2-calc-box objectif-current-calc"></div>
          <div id="objectif-rules-list" class="objectif-rules-list fn-v2-rules-list" aria-label="Règles de calcul par phase"></div>
          <p class="fn-v2-muted objectif-method-note">Ces objectifs restent des estimations : ils servent de point de départ et doivent être ajustés selon l’évolution réelle du poids, l’énergie, la faim, l’entraînement et les résultats observés sur plusieurs semaines.</p>
        </div>
      </details>
    </section>`;

  const phasePanels = `
    <div class="fn-v2-two-col">
      <section class="fn-v2-panel fn-v2-panel-pad">
        <div class="fn-v2-section-head"><span aria-hidden="true">🎯</span><div><b>Phase actuelle</b><small>Rôle de la phase en cours</small></div></div>
        <div id="stats-phase" class="fn-v2-stack"></div>
      </section>
      <section class="fn-v2-panel fn-v2-panel-pad">
        <div class="fn-v2-section-head"><span aria-hidden="true">📈</span><div><b>Suivi des phases</b><small>Progression du programme</small></div></div>
        <div id="stats-phases-suivi" class="fn-v2-stack"></div>
      </section>
    </div>`;

  const programme = `
    <section class="fn-v2-panel fn-v2-panel-pad fn-v2-program-panel" id="objectif-programme">
      <div class="fn-v2-section-head fn-v2-section-head-large">
        <span aria-hidden="true">🗓</span>
        <div><b>Mon programme de phases</b><small>Glisse les phases dans l’ordre de ton programme. Sur mobile, garde le doigt appuyé puis déplace.</small></div>
      </div>
      <div class="fn-ui-program-builder fn-v2-program-builder" id="objectif-programme-builder">
        <div class="fn-v2-subhead"><b>Phases disponibles</b><small>toucher ou glisser</small></div>
        <div id="phases-pool" class="fn-ui-phase-zone fn-ui-phase-pool"></div>
        <div class="fn-v2-subhead"><b>Mon programme</b><small>ordre et durée</small></div>
        <div id="phases-timeline" class="fn-ui-phase-zone fn-ui-phase-timeline"><div id="phases-hint" class="fn-ui-empty">Glisse tes phases ici</div></div>
        <div id="phases-bar" class="fn-ui-phase-bar"></div>
        <div class="fn-v2-actions">
          ${UI.button('Template sèche', "applyPhaseTemplate('cut')")}
          ${UI.button('Template recomposition', "applyPhaseTemplate('recomp')")}
          ${UI.button('Réinitialiser', 'resetPhases()')}
          ${UI.button('💾 Sauvegarder le programme', 'savePhases()', {primary:true})}
        </div>
        <div id="phases-save-status" class="fn-ui-save-status">✓ Programme sauvegardé</div>
      </div>
    </section>`;

  page.innerHTML = `
    <div class="fn-v2-page fn-v2-page-objectif" id="objectif-ui-root">
      <section class="fn-v2-panel fn-v2-hero">
        <div class="fn-v2-hero-main">
          <span class="fn-v2-hero-icon" aria-hidden="true">🎯</span>
          <div>
            <span class="fn-v2-kicker">Objectif actif</span>
            <h1>Objectif & phases</h1>
            <p>Le plan, la phase actuelle et le suivi du programme. Les statistiques restent dédiées aux résultats.</p>
          </div>
        </div>
        <div class="fn-v2-actions">${actionButtons}</div>
      </section>

      <section class="fn-v2-panel fn-v2-panel-pad">
        <div class="fn-v2-section-head">
          <span aria-hidden="true">🍽️</span>
          <div><b>Cibles nutritionnelles</b><small>Calories et macros utilisent la même logique visuelle que le Récap</small></div>
        </div>
        <div class="fn-v2-indicator-grid">${macroCards}</div>
      </section>

      ${methodPanel}
      ${phasePanels}
      ${programme}
    </div>`;
}

function renderObjectifMethod() {
  const p = loadProfil();
  const calc = document.getElementById('objectif-current-calc');
  const rulesList = document.getElementById('objectif-rules-list');
  if (rulesList) rulesList.innerHTML = getPhaseRuleCardsHTML();
  if (!calc) return;

  const poids = Number(p.poids) || Number(p.poidsRef) || 0;
  const taille = Number(p.taille) || 0;
  const age = Number(p.age) || 0;
  const sexe = String(p.sexe || 'homme').toLowerCase();
  const activite = Number(p.activityFactor || p.activite || 1.55);
  const activePhaseKey = p.phase || p.currentPhase || p.phaseActive || 'maintenance';
  const objectifKey = finalObjectiveFromPhases(p.phases || []);

  if (!poids || !taille || !age) {
    calc.innerHTML = 'Renseigne le poids, la taille et l’âge dans le profil pour afficher le détail du calcul.';
    return;
  }

  const bmr = sexe === 'femme' || sexe === 'f'
    ? (10 * poids + 6.25 * taille - 5 * age - 161)
    : (10 * poids + 6.25 * taille - 5 * age + 5);
  const tdee = Math.round(bmr * activite);

  const reversePhase = {
    icon: '↗️',
    label: 'Reverse dieting',
    lipFn: (kg) => Math.round(kg * 0.9),
    protFn: (kg) => Math.round(kg * 2.0),
    kcalFn: () => Number(p.cibleKcal) || tdee,
    glucFn: (kcal, prot, lip) => Math.round((kcal - prot * 4 - lip * 9) / 4)
  };
  const activeCalcKey = activePhaseKey === 'maint' ? 'maintenance' : activePhaseKey;
  const objectifCalcKey = objectifKey === 'maint' ? 'maintenance' : objectifKey;
  const phase = activePhaseKey === 'reverse'
    ? reversePhase
    : (PHASES_PREDEF[activeCalcKey] || PHASES_PREDEF[objectifCalcKey] || PHASES_PREDEF.maintenance);
  const objectifPhase = objectifCalcKey ? (PHASES_PREDEF[objectifCalcKey] || null) : null;
  const lip = Math.max(35, phase.lipFn(poids));
  const prot = Math.max(60, phase.protFn(poids));
  const kcal = Math.max(900, phase.kcalFn(tdee));
  const gluc = Math.max(20, activePhaseKey === 'reverse' && p.cibleGluc ? Number(p.cibleGluc) : phase.glucFn(kcal, prot, lip));
  const objectifTxt = objectifPhase && objectifKey !== activePhaseKey
    ? `<br>Objectif final du programme : <strong>${objectifPhase.icon} ${objectifPhase.label}</strong>.`
    : '';

  calc.innerHTML = `<strong>Ton calcul actuel</strong><br>
    Profil : ${poids} kg · ${taille} cm · ${age} ans · ${sexe} · activité ${activityLabelFromFactor(activite)} (${activite}).<br>
    Métabolisme de base estimé : <strong>${Math.round(bmr)} kcal</strong>.<br>
    Dépense journalière estimée : <strong>${tdee} kcal</strong>.<br>
    Phase active utilisée : <strong>${phase.icon} ${phase.label}</strong>.${objectifTxt}<br>
    Cibles calculées : <strong>${kcal} kcal</strong> · <strong>${prot}g protéines</strong> · <strong>${gluc}g glucides</strong> · <strong>${lip}g lipides</strong>.`;
}

function renderObjectif() {
  if (typeof renderObjectifShell === 'function') renderObjectifShell();
  const p = loadProfil();
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const kcal = objectifTargetValue(p, 'cibleKcal', 2000);
  const prot = objectifTargetValue(p, 'cibleProt', 120);
  const gluc = objectifTargetValue(p, 'cibleGluc', 220);
  const lip  = objectifTargetValue(p, 'cibleLip', 70);
  setTxt('objectif-kpi-kcal', kcal + ' kcal');
  setTxt('objectif-kpi-prot', prot + 'g');
  setTxt('objectif-kpi-gluc', gluc + 'g');
  setTxt('objectif-kpi-lip',  lip + 'g');
  setTxt('objectif-ui-kcal', kcal + ' kcal');
  setTxt('objectif-ui-prot', prot + ' g');
  setTxt('objectif-ui-gluc', gluc + ' g');
  setTxt('objectif-ui-lip',  lip + ' g');
  if (typeof renderObjectifMethod === 'function') renderObjectifMethod();

  if (typeof renderPhasePool === 'function') renderPhasePool();
  if (typeof setupPhaseDropZone === 'function') setupPhaseDropZone();
  if (typeof loadSavedPhases === 'function') loadSavedPhases();

  const entries = (typeof getEntries === 'function' ? getEntries() : [])
    .filter(e => e.date)
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  if (typeof renderPhase === 'function') renderPhase(entries);
  if (typeof renderPhasesSuivi === 'function') renderPhasesSuivi(entries);
}
