/*
 * FoodNote — statistiques, onboarding et bilan quotidien intégré.
 * Rôle : afficher les statistiques, initialiser les vues principales et piloter le bilan du jour.
 * Gère : graphiques, carrousels, badges de synthèse, rappel quotidien intégré au Journal.
 * Ne doit pas gérer : persistance SQLite bas niveau, imports CIQUAL/OpenFoodFacts, ni styles CSS globaux.
 */
// FoodNote beta 0.22.91 — Récap : mini bilan macros 7 jours complet
function renderStats() {
  _statsEntries = getEntries().filter(e => e.date).sort((a,b) => a.date.localeCompare(b.date));
  _statsIdx = _statsEntries.length - 1; // Dernière entrée par défaut
  buildDateSelect();
  renderJourDetail(_statsIdx);
  renderPhase(_statsEntries);
  renderPhasesSuivi(_statsEntries);
  renderPoidsChart(_statsEntries);
  renderSemaine(_statsEntries);
  renderMacrosChart(_statsEntries);
}

function buildDateSelect() {
  const sel = document.getElementById('stats-date-select');
  if (!sel) return;
  sel.innerHTML = _statsEntries.map((e, i) =>
    `<option value="${i}" ${i === _statsIdx ? 'selected' : ''}>${formatDate(e.date)}${e.poids ? ' · ' + e.poids + ' kg' : ''}</option>`
  ).join('');
}

function selectJour(idx) {
  _statsIdx = parseInt(idx);
  renderJourDetail(_statsIdx);
}

function navJour(dir) {
  const newIdx = _statsIdx + dir;
  if (newIdx < 0 || newIdx >= _statsEntries.length) return;
  _statsIdx = newIdx;
  const sel = document.getElementById('stats-date-select');
  if (sel) sel.value = _statsIdx;
  renderJourDetail(_statsIdx);
}

function renderJourDetail(idx) {
  const el = document.getElementById('stats-jour-detail');
  if (!el || !_statsEntries[idx]) { if(el) el.innerHTML = '<div style="color:var(--text4);font-size:13px">Aucune entrée.</div>'; return; }
  const e = _statsEntries[idx];
  const m = e.macros || {};
  const net = (m.kcal || 0) - (e.depSport || 0);

  const cKcal = PROFIL.cibleKcal || 2200;
  const cProt = PROFIL.cibleProt || 120;
  const pTag = (m.prot||0) >= cProt ? 'tag-ok' : (m.prot||0) >= cProt*0.85 ? 'tag-warn' : 'tag-bad';
  const kTag = (m.kcal||0) >= cKcal*0.9 && (m.kcal||0) <= cKcal*1.1 ? 'tag-ok' : 'tag-warn';
  const netTag = net >= cKcal*0.85 && net <= cKcal*1.1 ? 'tag-ok' : net < cKcal*0.7 ? 'tag-bad' : 'tag-warn';

  const alimLines = (e.aliments || []).map(a =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:0.5px solid var(--border2);font-size:13px">
      <span style="color:var(--text)">${a.nom}</span>
      <span style="color:var(--text3)">${a.qty} ${a.unite}</span>
    </div>`
  ).join('');

  const sportLines = (e.sports || []).map(s =>
    `<div style="font-size:13px;color:var(--text3)">🚴 ${s.nom} ${s.heures}h → <span style="color:var(--orange)">${s.total} kcal</span></div>`
  ).join('');

  el.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="${kTag}">${m.kcal||0} kcal</span>
      <span class="${pTag}">${m.prot||0}g prot</span>
      <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bg)">${m.gluc||0}g gluc</span>
      <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bg)">${m.lip||0}g lip</span>
      ${e.depSport ? `<span class="${netTag}">net ${net} kcal</span>` : ''}
    </div>
    ${sportLines ? `<div style="margin-bottom:10px">${sportLines}</div>` : ''}
    ${alimLines ? `<div style="margin-bottom:10px">${alimLines}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px">
      ${e.energie ? `<div style="color:var(--text3)">Énergie : <span style="color:var(--text)">${e.energie}</span></div>` : ''}
      ${e.faim    ? `<div style="color:var(--text3)">Faim : <span style="color:var(--text)">${e.faim}</span></div>`    : ''}
      ${e.notes   ? `<div style="color:var(--text3);grid-column:1/-1">Notes : <span style="color:var(--text)">${e.notes}</span></div>` : ''}
    </div>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button onclick="editEntry(${e.id})" style="font-size:12px;padding:4px 12px;border-radius:6px">✎ Modifier</button>
      <button onclick="exportSingle(${e.id})" style="font-size:12px;padding:4px 12px;border-radius:6px">Texte brut</button>
    </div>
  `;
}

function renderPhasesSuivi(entries) {
  const el = document.getElementById('stats-phases-suivi');
  if (!el) return;
  const UI = window.FoodNoteUI;
  const p = loadProfil();
  const savedPhases = p.phases || [];

  if (!savedPhases.length) {
    el.innerHTML = UI ? UI.alertCard({type:'warn', icon:'🗓', title:'Aucun programme défini', text:'Ajoute des phases dans le programme ci-dessous pour suivre ton planning nutritionnel.'}) : '<div style="font-size:13px;color:var(--text4);padding:8px">Aucun programme défini.</div>';
    return;
  }

  let semainesEcoulees = 0;
  if (entries.length) {
    const debut = new Date(entries[0].date);
    semainesEcoulees = Math.floor((Date.now() - debut) / (7*24*3600*1000));
  }

  let cumul = 0;
  let phaseActuelle = null;
  let phaseIdx = 0;
  for (let i = 0; i < savedPhases.length; i++) {
    cumul += savedPhases[i].weeks || 0;
    if (semainesEcoulees < cumul) {
      phaseActuelle = savedPhases[i];
      phaseIdx = i;
      break;
    }
  }
  if (!phaseActuelle) { phaseActuelle = savedPhases[savedPhases.length - 1]; phaseIdx = savedPhases.length - 1; }

  const totalWeeks = Math.max(1, savedPhases.reduce((s, ph) => s + (ph.weeks || 0), 0));
  const pctGlobal = Math.min(100, Math.max(0, Math.round(semainesEcoulees / totalWeeks * 100)));
  const bars = savedPhases.map(ph => '<i style="flex:' + (ph.weeks || 1) + ';--phase-color:' + (ph.color || 'var(--green)') + '" title="' + (ph.label || '') + '"></i>').join('');
  const labels = savedPhases.map(ph => '<span style="flex:' + (ph.weeks || 1) + '">' + String(ph.label || '').split(' ')[0] + '</span>').join('');

  let html = '<div class="fn-ui-phase-progress">'
    + '<div class="fn-ui-phase-progress-head"><span>Semaine ' + semainesEcoulees + ' / ' + totalWeeks + '</span><strong>' + pctGlobal + '%</strong></div>'
    + '<div class="fn-ui-phase-segments">' + bars + '<b style="left:' + pctGlobal + '%"></b></div>'
    + '<div class="fn-ui-phase-labels">' + labels + '</div>'
    + '</div>';

  html += '<div class="fn-ui-phase-list">';
  savedPhases.forEach(function(ph, i) {
    const active = ph === phaseActuelle;
    const done = i < phaseIdx;
    const semDeb = savedPhases.slice(0, i).reduce((s, x) => s + (x.weeks || 0), 0);
    const semFin = semDeb + (ph.weeks || 0);
    const semRestantes = active ? Math.max(0, semFin - semainesEcoulees) : 0;
    const pctPhase = done ? 100 : active ? Math.min(100, Math.round(Math.max(0, semainesEcoulees - semDeb) / (ph.weeks || 1) * 100)) : 0;
    html += '<div class="fn-ui-status-card fn-ui-phase-step fn-ui-phase-step--status ' + (active ? 'is-active ' : '') + (done ? 'is-done ' : '') + '" style="--phase-color:' + (ph.color || 'var(--green)') + '">'
      + '<div class="fn-ui-phase-step-num">' + (done ? '✓' : (i + 1)) + '</div>'
      + '<div class="fn-ui-phase-step-body"><div class="fn-ui-phase-step-title"><strong>' + (ph.label || '') + '</strong>' + (active ? '<span>En cours</span>' : '') + '</div>'
      + '<small>' + (ph.weeks || 0) + ' semaines · S' + (semDeb + 1) + ' à S' + semFin + '</small>'
      + '<div class="fn-ui-phase-step-track"><i style="width:' + pctPhase + '%"></i></div>'
      + (ph.desc ? '<p>' + ph.desc + '</p>' : '')
      + (active && semRestantes > 0 ? '<em>⏱ ' + semRestantes + ' semaine(s) restante(s)</em>' : '')
      + '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}


function fnPhaseGuideFor(phase) {
  const id = String(phase?.id || phase?.key || '').toLowerCase();
  const label = phase?.label || (typeof phaseInfo === 'function' ? phaseInfo(id).title : 'Phase actuelle') || 'Phase actuelle';
  const desc = phase?.desc || (typeof phaseInfo === 'function' ? phaseInfo(id).text : '') || 'Cette phase donne le cap nutritionnel actuel du programme.';
  const guides = {
    reverse: 'Remonte progressivement les calories, garde les protéines régulières et surveille l’énergie, la faim et le poids moyen.',
    perte: 'Garde un déficit maîtrisé, sans couper trop fort. La priorité reste de tenir les protéines et de préserver l’énergie.',
    sechage: 'Phase plus courte et plus exigeante : protéines hautes, déficit contrôlé, fatigue et récupération à surveiller.',
    recomp: 'Reste proche de la maintenance : régularité, entraînement et protéines comptent plus que les gros écarts de calories.',
    prise: 'Cherche un surplus léger et régulier. L’objectif est de progresser sans laisser les calories dériver trop haut.',
    maint: 'Stabilise les habitudes et observe le poids moyen. C’est une phase utile pour consolider avant de changer de rythme.',
    maintenance: 'Stabilise les habitudes et observe le poids moyen. C’est une phase utile pour consolider avant de changer de rythme.'
  };
  return {
    label,
    desc,
    advice: guides[id] || 'Garde une ligne simple : régularité, protéines suffisantes et ajustements progressifs selon le ressenti.',
    id
  };
}

function renderPhase(entries) {
  const el = document.getElementById('stats-phase');
  if (!el) return;
  const p = loadProfil();
  const savedPhases = Array.isArray(p.phases) ? p.phases : [];

  let phaseActuelle = null;
  let index = 0;
  let semainesEcoulees = 0;
  let phaseStart = 0;
  let phaseEnd = 0;
  const totalWeeks = savedPhases.reduce((s, ph) => s + (parseInt(ph.weeks, 10) || 0), 0);

  if (savedPhases.length) {
    if (entries && entries.length) {
      const debut = new Date(entries[0].date);
      if (!Number.isNaN(debut.getTime())) {
        semainesEcoulees = Math.max(0, Math.floor((Date.now() - debut.getTime()) / (7 * 24 * 3600 * 1000)));
      }
    }
    let cumul = 0;
    for (let i = 0; i < savedPhases.length; i++) {
      const ph = savedPhases[i];
      const weeks = parseInt(ph.weeks, 10) || 1;
      if (semainesEcoulees < cumul + weeks) {
        phaseActuelle = ph;
        index = i;
        phaseStart = cumul;
        phaseEnd = cumul + weeks;
        break;
      }
      cumul += weeks;
    }
    if (!phaseActuelle) {
      index = Math.max(0, savedPhases.length - 1);
      phaseActuelle = savedPhases[index];
      phaseStart = Math.max(0, totalWeeks - (parseInt(phaseActuelle.weeks, 10) || 1));
      phaseEnd = totalWeeks;
    }
  } else {
    const activeKey = p.phase || p.currentPhase || p.phaseActive || 'maintenance';
    const def = (typeof PHASES_DEF !== 'undefined' ? PHASES_DEF.find(ph => ph.id === activeKey || (activeKey === 'maintenance' && ph.id === 'maint')) : null);
    const pre = (typeof PHASES_PREDEF !== 'undefined' ? PHASES_PREDEF[activeKey] : null);
    phaseActuelle = def || { id: activeKey, label: pre?.label || 'Maintenance', desc: pre?.description || 'Phase actuelle du programme.', color: 'var(--green)', weeks: 1 };
    phaseEnd = parseInt(phaseActuelle.weeks, 10) || 1;
  }

  if (!phaseActuelle) {
    el.innerHTML = '<div class="fn-ui-empty">Choisis ou construis un programme pour afficher la phase actuelle.</div>';
    return;
  }

  const guide = fnPhaseGuideFor(phaseActuelle);
  const weeks = parseInt(phaseActuelle.weeks, 10) || Math.max(1, phaseEnd - phaseStart || 1);
  const localWeek = Math.min(weeks, Math.max(1, semainesEcoulees - phaseStart + 1));
  const pct = weeks > 0 ? Math.max(0, Math.min(100, Math.round(((localWeek - 1) / weeks) * 100))) : 0;
  const remaining = Math.max(0, phaseEnd - semainesEcoulees);
  const next = savedPhases[index + 1] || null;
  const safe = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  el.innerHTML = '<div class="objectif-phase-guide" style="--phase-color:' + (phaseActuelle.color || 'var(--green)') + '">'
    + '<div class="objectif-phase-guide-head">'
      + '<span class="objectif-phase-guide-dot" aria-hidden="true"></span>'
      + '<div><strong>' + safe(guide.label) + '</strong><small>' + safe(weeks ? ('Semaine ' + localWeek + ' / ' + weeks) : 'Phase en cours') + '</small></div>'
    + '</div>'
    + '<p class="objectif-phase-guide-desc">' + safe(guide.desc) + '</p>'
    + '<div class="objectif-phase-guide-advice"><span>Conseil de phase</span><p>' + safe(guide.advice) + '</p></div>'
    + '<div class="objectif-phase-guide-progress"><i style="width:' + pct + '%"></i></div>'
    + '<div class="objectif-phase-guide-foot">'
      + '<span>' + (remaining > 0 ? safe(remaining + ' semaine(s) restante(s)') : 'Programme terminé ou à prolonger') + '</span>'
      + (next ? '<span>Ensuite : ' + safe(next.label || 'phase suivante') + '</span>' : '')
    + '</div>'
  + '</div>';
}


function avg7(entries, macro) {
  const last7 = entries.slice(-7).filter(e => e.macros && e.macros[macro] > 0);
  if (!last7.length) return 0;
  return last7.reduce((s,e) => s + (e.macros[macro] || 0), 0) / last7.length;
}

function avg7net(entries) {
  const last7 = entries.slice(-7).filter(e => e.macros && e.macros.kcal > 0);
  if (!last7.length) return 0;
  return last7.reduce((s,e) => s + ((e.macros.kcal || 0) - (e.depSport || 0)), 0) / last7.length;
}

function renderPoidsChart(entries) {
  const data = entries.filter(e => e.poids && parseFloat(e.poids) > 0).slice(-60);
  const canvas = document.getElementById('chart-poids');
  const empty  = document.getElementById('chart-poids-empty');
  if (!canvas) return;

  if (data.length < 2) {
    canvas.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  if (empty) empty.style.display = 'none';

  const w = canvas.offsetWidth || 600;
  const h = 200;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const poids = data.map(e => parseFloat(e.poids));
  const min = Math.min(...poids) - 0.5;
  const max = Math.max(...poids) + 0.5;
  const pad = { t:10, r:10, b:30, l:40 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const textColor = isDark ? '#888' : '#aaa';
  const lineColor = isDark ? '#5dcaa5' : '#1d9e75';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const dotColor  = isDark ? '#5dcaa5' : '#1d9e75';

  const xp = i => pad.l + (i / (data.length - 1)) * cw;
  const yp = v => pad.t + (1 - (v - min) / (max - min)) * ch;

  // Grille
  ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
    const val = max - ((max - min) / 4) * i;
    ctx.fillStyle = textColor; ctx.font = '11px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(1), pad.l - 4, y + 4);
  }

  // Ligne
  ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((e, i) => { i === 0 ? ctx.moveTo(xp(i), yp(parseFloat(e.poids))) : ctx.lineTo(xp(i), yp(parseFloat(e.poids))); });
  ctx.stroke();

  // Points + labels dates (espacés)
  data.forEach((e, i) => {
    const x = xp(i), y = yp(parseFloat(e.poids));
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2);
    ctx.fillStyle = dotColor; ctx.fill();
    if (i === 0 || i === data.length-1 || i % Math.max(1, Math.floor(data.length/6)) === 0) {
      const [yr,mo,da] = e.date.split('-');
      ctx.fillStyle = textColor; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(da+'/'+mo, x, h - 8);
    }
  });
}

function renderSemaine(entries) {
  const el = document.getElementById('stats-semaine');
  if (!el) return;
  const last7 = entries.slice(-7).filter(e => e.macros && e.macros.kcal > 0);
  if (!last7.length) { el.innerHTML = '<div style="font-size:13px;color:var(--text4)">Pas assez de données.</div>'; return; }

  const mKcal = Math.round(last7.reduce((s,e)=>s+(e.macros.kcal||0),0)/last7.length);
  const mProt = Math.round(last7.reduce((s,e)=>s+(e.macros.prot||0),0)/last7.length);
  const mGluc = Math.round(last7.reduce((s,e)=>s+(e.macros.gluc||0),0)/last7.length);
  const mLip  = Math.round(last7.reduce((s,e)=>s+(e.macros.lip||0),0)/last7.length);
  const mNet  = Math.round(last7.reduce((s,e)=>s+((e.macros.kcal||0)-(e.depSport||0)),0)/last7.length);
  const mSport = Math.round(last7.reduce((s,e)=>s+(e.depSport||0),0)/last7.length);

  const tag = (val, target, higher) => {
    const ratio = val / target;
    const ok = higher ? ratio >= 1 : ratio >= 0.9 && ratio <= 1.1;
    const cls = ok ? 'tag-ok' : ratio >= 0.75 ? 'tag-warn' : 'tag-bad';
    return `<span class="${cls}">${val}</span>`;
  };

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">
      <div class="macro-cell"><div class="macro-val">${tag(mKcal,2200,false)}</div><div class="macro-lbl">kcal moy.</div><div class="macro-target">cible 2200</div></div>
      <div class="macro-cell"><div class="macro-val">${tag(mProt,120,true)}g</div><div class="macro-lbl">protéines</div><div class="macro-target">min 120g</div></div>
      <div class="macro-cell"><div class="macro-val">${mGluc}g</div><div class="macro-lbl">glucides</div><div class="macro-target">cible 270g</div></div>
      <div class="macro-cell"><div class="macro-val">${mLip}g</div><div class="macro-lbl">lipides</div><div class="macro-target">cible 71g</div></div>
      <div class="macro-cell"><div class="macro-val" style="font-size:16px">${mNet}</div><div class="macro-lbl">kcal net</div><div class="macro-target">après sport</div></div>
      <div class="macro-cell"><div class="macro-val" style="font-size:16px">${mSport}</div><div class="macro-lbl">kcal sport</div><div class="macro-target">moy. jour</div></div>
    </div>
  `;
}

function renderMacrosChart(entries) {
  const canvas = document.getElementById('chart-macros');
  if (!canvas) return;
  // Grouper par semaine
  const weeks = {};
  entries.forEach(e => {
    if (!e.macros || !e.macros.kcal) return;
    const d = new Date(e.date);
    const mon = new Date(d); mon.setDate(d.getDate() - d.getDay() + 1);
    const key = mon.toISOString().split('T')[0];
    if (!weeks[key]) weeks[key] = { kcal:[], prot:[], net:[] };
    weeks[key].kcal.push(e.macros.kcal || 0);
    weeks[key].prot.push(e.macros.prot || 0);
    weeks[key].net.push((e.macros.kcal||0) - (e.depSport||0));
  });

  const labels = Object.keys(weeks).sort().slice(-8);
  if (labels.length < 2) {
    canvas.style.display = 'none';
    canvas.insertAdjacentHTML('afterend', '<div style="font-size:13px;color:var(--text4);text-align:center;padding:2rem" id="chart-macros-empty">Pas assez de données — il faut au moins 2 semaines de journées remplies.</div>');
    return;
  }
  document.getElementById('chart-macros-empty')?.remove();
  canvas.style.display = 'block';

  const avgArr = (arr) => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;
  const kcals  = labels.map(k => avgArr(weeks[k].kcal));
  const prots  = labels.map(k => avgArr(weeks[k].prot));
  const nets   = labels.map(k => avgArr(weeks[k].net));

  const w = canvas.offsetWidth || 600;
  const h = 200;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const textColor = isDark ? '#888' : '#aaa';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const pad = { t:10, r:10, b:30, l:45 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxV = Math.max(...kcals, 2500) * 1.1;

  const xp = i => pad.l + (i + 0.5) * (cw / labels.length);
  const yp = v => pad.t + (1 - v / maxV) * ch;
  const barW = cw / labels.length * 0.6;

  // Grille + cible
  ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
  [0, 1000, 2000, 2200].forEach(v => {
    const y = yp(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+cw, y);
    if (v === 2200) { ctx.strokeStyle = isDark ? 'rgba(29,158,117,0.3)' : 'rgba(29,158,117,0.3)'; ctx.setLineDash([4,4]); }
    else { ctx.strokeStyle = gridColor; ctx.setLineDash([]); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = textColor; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(v, pad.l-3, y+4);
  });

  // Barres kcal
  labels.forEach((k, i) => {
    const x = xp(i) - barW/2;
    ctx.fillStyle = isDark ? 'rgba(239,159,39,0.5)' : 'rgba(186,117,23,0.4)';
    ctx.fillRect(x, yp(kcals[i]), barW, ch - (yp(kcals[i]) - pad.t));
  });

  // Ligne net
  ctx.strokeStyle = isDark ? '#5dcaa5' : '#1d9e75'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  labels.forEach((k,i) => { i===0 ? ctx.moveTo(xp(i), yp(nets[i])) : ctx.lineTo(xp(i), yp(nets[i])); });
  ctx.stroke();

  // Labels semaines
  labels.forEach((k, i) => {
    const [,mo,da] = k.split('-');
    ctx.fillStyle = textColor; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(da+'/'+mo, xp(i), h-8);
  });

  // Légende
  ctx.font = '11px system-ui'; ctx.textAlign = 'left';
  ctx.fillStyle = isDark ? 'rgba(239,159,39,0.8)' : 'rgba(186,117,23,0.8)';
  ctx.fillRect(pad.l, 2, 12, 8); ctx.fillStyle = textColor; ctx.fillText('kcal moy.', pad.l+16, 10);
  ctx.strokeStyle = isDark ? '#5dcaa5' : '#1d9e75'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad.l+80, 6); ctx.lineTo(pad.l+92, 6); ctx.stroke();
  ctx.fillStyle = textColor; ctx.fillText('net sport', pad.l+96, 10);
}
// ─────────────────────────────────────────────────────────────

let obSelectedPhase = 'recomp';

function obInit() {
  // Afficher les phases disponibles
  const grid = document.getElementById('ob-phases-grid');
  if (!grid) return;
  grid.innerHTML = PHASES_DEF.map(ph => `
    <label style="cursor:pointer;border:1.5px solid ${ph.id===obSelectedPhase ? ph.color : 'var(--border2)'};border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:4px;background:${ph.id===obSelectedPhase ? 'var(--bg)' : 'transparent'};position:relative" id="ob-phase-${ph.id}" onclick="obSelectPhase('${ph.id}')">
      <span style="display:flex;align-items:center;gap:6px;justify-content:space-between"><span style="font-size:13px;font-weight:600;color:var(--text)">${ph.label}</span>${typeof phaseInfoBubbleHTML === 'function' ? phaseInfoBubbleHTML(ph.id) : ''}</span>
      <span style="font-size:11px;color:var(--text4)">${ph.desc}</span>
    </label>
  `).join('');
}

function obSelectPhase(id) {
  obSelectedPhase = id;
  PHASES_DEF.forEach(ph => {
    const el = document.getElementById('ob-phase-' + ph.id);
    if (!el) return;
    el.style.borderColor = ph.id === id ? ph.color : 'var(--border2)';
    el.style.background = ph.id === id ? 'var(--bg)' : 'transparent';
  });
}

function obNextStep(step) {
  if (step === 2) {
    // Valider étape 1
    const prenom = document.getElementById('ob-prenom')?.value.trim();
    const poids  = parseFloat(document.getElementById('ob-poids')?.value);
    const taille = parseFloat(document.getElementById('ob-taille')?.value);
    const age    = parseInt(document.getElementById('ob-age')?.value);
    if (!poids || !taille || !age) { alert('Remplis tous les champs.'); return; }
    obInit();
  }
  if (step === 3) {
    // Calculer les cibles
    const poids  = parseFloat(document.getElementById('ob-poids')?.value);
    const taille = parseFloat(document.getElementById('ob-taille')?.value);
    const age    = parseInt(document.getElementById('ob-age')?.value);
    const sexe   = document.getElementById('ob-sexe')?.value || 'H';
    const act    = document.getElementById('ob-activite')?.value || 'modere';
    const cibles = calcCiblesAuto({ poids, taille, age, sexe, activite: act, phase: obSelectedPhase });
    const ph = PHASES_DEF.find(ph2 => ph2.id === obSelectedPhase);
    const el = document.getElementById('ob-cibles-result');
    if (el && cibles) {
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <div style="width:10px;height:10px;border-radius:50%;background:${ph?.color||'var(--green)'}"></div>
          <strong style="color:var(--text)">${ph?.label || obSelectedPhase}</strong>
        </div>
        <div style="background:var(--bg);border-radius:8px;padding:12px;font-size:13px">
          <div style="color:var(--text4);margin-bottom:8px">Maintenance estimée : <strong style="color:var(--text)">${cibles.tdee} kcal/j</strong></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="background:var(--bg2);border-radius:6px;padding:8px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:var(--green)">${cibles.kcal}</div>
              <div style="font-size:11px;color:var(--text4)">kcal/jour</div>
            </div>
            <div style="background:var(--bg2);border-radius:6px;padding:8px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:#5b8dd9">${cibles.prot}g</div>
              <div style="font-size:11px;color:var(--text4)">protéines</div>
            </div>
            <div style="background:var(--bg2);border-radius:6px;padding:8px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:var(--orange)">${cibles.gluc}g</div>
              <div style="font-size:11px;color:var(--text4)">glucides</div>
            </div>
            <div style="background:var(--bg2);border-radius:6px;padding:8px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:var(--text2)">${cibles.lip}g</div>
              <div style="font-size:11px;color:var(--text4)">lipides</div>
            </div>
          </div>
        </div>
      `;
    }
  }
  [1,2,3].forEach(s => {
    const el = document.getElementById('ob-step-' + s);
    if (el) el.style.display = s === step ? 'block' : 'none';
  });
}

function obFinish() {
  const poids  = parseFloat(document.getElementById('ob-poids')?.value);
  const taille = parseFloat(document.getElementById('ob-taille')?.value);
  const age    = parseInt(document.getElementById('ob-age')?.value);
  const sexe   = document.getElementById('ob-sexe')?.value || 'H';
  const act    = document.getElementById('ob-activite')?.value || 'modere';
  const prenom = document.getElementById('ob-prenom')?.value.trim() || '';
  const ph     = PHASES_DEF.find(ph2 => ph2.id === obSelectedPhase);
  const generatedProgram = typeof defaultPhaseProgramForObjective === 'function'
    ? defaultPhaseProgramForObjective(obSelectedPhase)
    : [{ ...ph, weeks: ph?.defaultWeeks || ph?.weeks || 8, _uid: 'uid_ob' }];
  const activePhase = generatedProgram[0] || ph;
  const activeCalcKey = activePhase?.id === 'maint' ? 'maintenance' : activePhase?.id;
  const phPre = activeCalcKey === 'reverse'
    ? {
        lipFn: (kg) => Math.round(kg * 0.9),
        protFn: (kg) => Math.round(kg * 2.0),
        kcalFn: (tdee) => tdee,
        glucFn: (kcal, prot, lip) => Math.round((kcal - prot*4 - lip*9) / 4)
      }
    : (PHASES_PREDEF[activeCalcKey] || PHASES_PREDEF[obSelectedPhase] || PHASES_PREDEF.recomp);

  // Calcul via la formule existante, basé sur la phase active générée par le programme
  const bmr = sexe === 'F' ? (10*poids + 6.25*taille - 5*age - 161) : (10*poids + 6.25*taille - 5*age + 5);
  const coefs = { sedentaire:1.2, leger:1.375, modere:1.55, actif:1.725, tres_actif:1.9 };
  const tdee  = Math.round(bmr * (coefs[act] || 1.55));
  const lip   = Math.max(35, phPre.lipFn(poids));
  const prot  = Math.max(60, phPre.protFn(poids));
  const kcal  = Math.max(900, phPre.kcalFn(tdee));
  const gluc  = Math.max(20, phPre.glucFn(kcal, prot, lip));

  const profil = loadProfil();
  profil.prenom     = prenom;
  profil.poids      = poids;
  profil.taille     = taille;
  profil.age        = age;
  profil.sexe       = sexe === 'H' ? 'homme' : 'femme';
  profil.activite   = String(coefs[act] || 1.55);
  profil.phase      = activePhase?.id || obSelectedPhase;
  profil.objectif   = typeof finalObjectiveFromPhases === 'function' ? finalObjectiveFromPhases(generatedProgram) : obSelectedPhase;
  profil.phaseLabel = generatedProgram.length
    ? generatedProgram.map(p => p.label + ' (' + (p.weeks || 8) + 'sem)').join(' → ')
    : (ph?.label || '');
  profil.phases     = generatedProgram.map(({_uid, ...rest}) => rest);
  profil.cibleKcal  = kcal;
  profil.cibleProt  = prot;
  profil.cibleGluc  = gluc;
  profil.cibleLip   = lip;
  profil.tdee       = tdee;
  profil.onboardingDone = true;
  saveProfil(profil);
  Object.assign(PROFIL, profil);

  showPage('journal', null);
  // Important multi-appareil : après le first setup, si une entrée existe déjà aujourd'hui
  // côté SQLite, on la recharge immédiatement au lieu de repartir d'un formulaire vide.
  // Ça évite d'écraser une journée déjà saisie depuis un autre appareil.
  openTodayEntryOrDefault();
  const avatarEl = document.getElementById('sb-avatar');
  const prenomEl = document.getElementById('sb-prenom');
  if (avatarEl) avatarEl.textContent = prenom.substring(0,2).toUpperCase() || 'FN';
  if (prenomEl) prenomEl.textContent = prenom || 'FoodNote';
  const subTitle = document.getElementById('header-subtitle');
  if (subTitle) subTitle.textContent = ph?.label || 'Mon suivi';
  updateMacros();
}

function openTodayEntryOrDefault() {
  const today = new Date().toISOString().split('T')[0];
  const dateEl = document.getElementById('f-date');
  if (dateEl) dateEl.value = today;
  const todayEntry = getEntries().find(e => e.date === today);
  if (todayEntry && typeof editEntry === 'function') {
    editEntry(todayEntry.id);
    return true;
  }
  if (!sportRows || !sportRows.length) addSportRow('VTT (modéré)', 430, 1);
  return false;
}

function hasServerOrLocalHistory() {
  try { return Array.isArray(getEntries()) && getEntries().length > 0; }
  catch(e) { return false; }
}

async function init() {
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('init:start');

  // Premier affichage immédiat avec le cache/profil local : la page doit apparaître vite,
  // puis les données SQLite remplacent proprement l'état.
  try {
    const quickProfile = loadProfil();
    const prenQuick = quickProfile.prenom || 'FoodNote';
    const avatarQuick = document.getElementById('sb-avatar');
    const prenomQuick = document.getElementById('sb-prenom');
    if (avatarQuick) avatarQuick.textContent = prenQuick.substring(0,2).toUpperCase();
    if (prenomQuick) prenomQuick.textContent = prenQuick;
    const subQuick = document.getElementById('header-subtitle');
    if (subQuick) subQuick.textContent = quickProfile.phaseLabel || 'Mon suivi nutritionnel';
    const dateQuick = document.getElementById('f-date');
    if (dateQuick) dateQuick.value = new Date().toISOString().split('T')[0];
  } catch(e) {}

  await loadData();
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('loadData:done');
  if (typeof syncProfilFromServer === 'function') await syncProfilFromServer();
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('profile-synced');
  // Réglages non critiques après rendu : ne bloquent plus le premier affichage.
  setTimeout(() => {
    try { if (typeof loadFeatureSettings === 'function') loadFeatureSettings().then(() => { if (typeof applyFeatureToggles === 'function') applyFeatureToggles(); }); } catch(e) {}
  }, 250);
  seedStarterAliments();
  if (typeof loadGroqKey === 'function' && (typeof isAIEnabled !== 'function' || isAIEnabled())) setTimeout(loadGroqKey, 600);
  // Mettre à jour l'avatar et prénom
  const p = loadProfil();
  const pren = p.prenom || 'FoodNote';
  const avatarEl = document.getElementById('sb-avatar');
  const prenomEl = document.getElementById('sb-prenom');
  if (avatarEl) avatarEl.textContent = pren.substring(0,2).toUpperCase();
  if (prenomEl) prenomEl.textContent = pren;
  const subTitle = document.getElementById('header-subtitle');
  if (subTitle) subTitle.textContent = p.phaseLabel || 'Mon suivi nutritionnel';


  document.getElementById('f-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('f-date').value=new Date().toISOString().split('T')[0];
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('buildLists:start');
  // Démarrage rapide : si la journée du jour existe, editEntry() reconstruit
  // uniquement les lignes nécessaires. On ne rend plus toute la base custom avant.
  const todayForLightBuild = document.getElementById('f-date')?.value || new Date().toISOString().split('T')[0];
  const hasTodayForLightBuild = (typeof getEntries === 'function') && getEntries().some(e => e && e.date === todayForLightBuild);
  if (typeof buildLists === 'function') buildLists({ light: !!hasTodayForLightBuild });
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('buildLists:done');
  const dbSearch = document.getElementById('db-search');
  if (dbSearch) {
    dbSearch.addEventListener('input', handleDBSearchInput);
    dbSearch.addEventListener('focus', handleDBSearchInput);
    dbSearch.addEventListener('keydown', handleDBSearchKey);
  }
  const dbQty = document.getElementById('db-qty');
  if (dbQty) dbQty.addEventListener('input', () => {
    updateDBSelectedCard(dbSelectedFood || null);
  });
  document.addEventListener('click', (e) => {
    try {
      if (typeof window.foodnoteShouldKeepDBSuggestionsVisible === 'function' && window.foodnoteShouldKeepDBSuggestionsVisible()) return;
      if (typeof window.foodnoteIsDBQuantityFlowActive === 'function' && window.foodnoteIsDBQuantityFlowActive()) return;
    } catch(err) {}
    if (!e.target.closest('.db-autocomplete')) document.getElementById('db-suggestions')?.classList.remove('visible');
  });
  // Onboarding seulement si vraie première utilisation.
  // Sur un nouveau téléphone, localStorage est vide, mais les données SQLite peuvent déjà exister.
  // Dans ce cas on NE relance PAS le first setup, on ouvre la journée existante.
  const profilInit = loadProfil();
  if (!profilInit.onboardingDone) {
    if (hasServerOrLocalHistory()) {
      const restored = { ...profilInit, onboardingDone: true, _profileMissingServer: true };
      // Ne jamais pousser les cibles par défaut côté SQLite simplement parce qu'un historique existe.
      // Sinon une réinstallation/nouveau navigateur peut écraser un vrai profil ou figer les cibles par défaut.
      saveProfil(restored, { localOnly:true });
      Object.assign(PROFIL, restored);
    } else {
      showPage('onboarding', null);
      return;
    }
  }

  // Charger l'entrée du jour si elle existe, sinon préparer une saisie neuve.
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('openToday:start');
  openTodayEntryOrDefault();
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('openToday:done');
  if (typeof foodnoteRefreshJournalMutationViews === 'function') {
    foodnoteRefreshJournalMutationViews('journal-open-today', { journalCarousel:true, phaseMini:true });
  } else {
    renderJournalDayCarousel();
    if (typeof renderJournalPhaseMini === 'function') renderJournalPhaseMini();
  }
  if (window.FoodNotePerf && typeof window.FoodNotePerf.mark === 'function') window.FoodNotePerf.mark('journal-rendered');
  // beta 0.22.49 : aucun refresh /api/foods différé après ouverture du journal.
}


// v11.12 — picker de date type carrousel avec mini infos et badge sport
function foodnoteISODateOffset(baseIso, offset) {
  const base = baseIso ? new Date(baseIso + 'T12:00:00') : new Date();
  base.setDate(base.getDate() + offset);
  return base.toISOString().slice(0,10);
}
function foodnoteDayLabel(iso) {
  const today = new Date().toISOString().slice(0,10);
  if (iso === today) return 'Aujourd’hui';
  if (iso === foodnoteISODateOffset(today, -1)) return 'Hier';
  if (iso === foodnoteISODateOffset(today, 1)) return 'Demain';
  try { return new Intl.DateTimeFormat('fr-FR', { weekday:'short' }).format(new Date(iso + 'T12:00:00')); } catch(e) { return iso; }
}
function foodnoteDayShort(iso) {
  try { return new Intl.DateTimeFormat('fr-FR', { weekday:'short' }).format(new Date(iso + 'T12:00:00')); } catch(e) { return iso; }
}
function foodnoteDayMonth(iso) {
  try { return new Intl.DateTimeFormat('fr-FR', { month:'short' }).format(new Date(iso + 'T12:00:00')).replace('.', ''); } catch(e) { return iso.slice(5,7); }
}
function foodnoteDayNumber(iso) {
  try { return new Intl.DateTimeFormat('fr-FR', { day:'2-digit' }).format(new Date(iso + 'T12:00:00')); } catch(e) { return iso.slice(8,10); }
}
function foodnoteDayYear(iso) {
  try { return new Intl.DateTimeFormat('fr-FR', { year:'numeric' }).format(new Date(iso + 'T12:00:00')); } catch(e) { return iso.slice(0,4); }
}
function foodnoteDayPreview(iso) {
  const entries = (typeof getEntries === 'function' ? getEntries() : []) || [];
  const entry = entries.find(e => e.date === iso);
  const targets = {
    gluc: Math.max(Number(window.PROFIL?.cibleGluc ?? PROFIL?.cibleGluc ?? 270) || 270, 1),
    prot: Math.max(Number(window.PROFIL?.cibleProt ?? PROFIL?.cibleProt ?? 120) || 120, 1),
    lip: Math.max(Number(window.PROFIL?.cibleLip ?? PROFIL?.cibleLip ?? 70) || 70, 1)
  };
  const emptyBars = {
    gluc: { value:0, target:targets.gluc, h:.16, ratio:0, state:'empty' },
    prot: { value:0, target:targets.prot, h:.16, ratio:0, state:'empty' },
    lip:  { value:0, target:targets.lip,  h:.16, ratio:0, state:'empty' }
  };
  if (!entry) return { hasEntry:false, kcal:0, net:0, sport:0, hasSport:false, foods:0, bars:[0.16,0.16,0.16], barInfo: emptyBars };
  const kcal = Number(entry.macros?.kcal ?? entry.kcal ?? 0) || 0;
  const net = Number(entry.netKcal ?? entry.net_kcal ?? kcal) || kcal;
  const rows = Array.isArray(entry.sports) ? entry.sports : [];
  const sportFromRows = rows.reduce((sum, r) => {
    const total = Number(r?.total || 0) || Math.round((Number(r?.heures || 0) || 0) * (Number(r?.kcalH || 0) || 0));
    return sum + (Number(total) || 0);
  }, 0);
  const sport = Number(entry.depSport ?? entry.dep_sport ?? sportFromRows) || 0;
  const hasSport = sport > 0 || sportFromRows > 0;
  const sportBadges = hasSport ? foodnoteSportBadgesFromRows(rows) : [];
  const prot = Number(entry.macros?.prot ?? entry.prot ?? 0) || 0;
  const gluc = Number(entry.macros?.gluc ?? entry.gluc ?? 0) || 0;
  const lip = Number(entry.macros?.lip ?? entry.lip ?? 0) || 0;
  const buildBar = (value, target, type) => {
    const ratio = target ? value / target : 0;
    const state = !value ? 'empty' : (ratio > 1.05 ? 'over' : (ratio >= .92 ? 'ok' : 'low'));
    return {
      value,
      target,
      ratio,
      h: Math.max(.16, Math.min(1, ratio)),
      state
    };
  };
  const barInfo = {
    gluc: buildBar(gluc, targets.gluc, 'gluc'),
    prot: buildBar(prot, targets.prot, 'prot'),
    lip:  buildBar(lip,  targets.lip,  'lip')
  };
  return {
    hasEntry:true,
    kcal, net, sport,
    hasSport,
    sportBadges,
    foods: Array.isArray(entry.aliments) ? entry.aliments.length : 0,
    bars: [barInfo.gluc.h, barInfo.prot.h, barInfo.lip.h],
    barInfo
  };
}

function foodnoteProgramPhaseState(refIso) {
  const profile = typeof loadProfil === 'function' ? loadProfil() : (window.PROFIL || {});
  const phases = Array.isArray(profile.phases) ? profile.phases.filter(ph => ph && Number(ph.weeks || 0) > 0) : [];
  if (!phases.length) {
    const fallbackLabel = String(profile.phaseLabel || profile.objectif || profile.phase || '').trim();
    return fallbackLabel ? { hasProgram:false, label:fallbackLabel, day:0, totalDays:0, pct:0, color:'var(--green)', text:fallbackLabel } : null;
  }

  const entries = (typeof getEntries === 'function' ? getEntries() : [])
    .filter(e => e && e.date)
    .slice()
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const startIso = entries[0]?.date || foodnoteLocalISODate?.() || new Date().toISOString().slice(0,10);
  const start = new Date(String(startIso).slice(0,10) + 'T12:00:00');
  const now = refIso ? new Date(String(refIso).slice(0,10) + 'T12:00:00') : new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  let elapsedDays = Math.floor((today - start) / (24*3600*1000)) + 1;
  if (!Number.isFinite(elapsedDays) || elapsedDays < 1) elapsedDays = 1;

  const totalDays = phases.reduce((s, ph) => s + Math.max(1, Number(ph.weeks || 1) * 7), 0);
  const clampedElapsed = Math.min(elapsedDays, Math.max(1, totalDays));
  let cumulDays = 0;
  let active = phases[phases.length - 1];
  let idx = phases.length - 1;
  for (let i = 0; i < phases.length; i++) {
    const d = Math.max(1, Number(phases[i].weeks || 1) * 7);
    if (clampedElapsed <= cumulDays + d) {
      active = phases[i];
      idx = i;
      break;
    }
    cumulDays += d;
  }
  const phaseDays = Math.max(1, Number(active.weeks || 1) * 7);
  const dayInPhase = Math.min(phaseDays, Math.max(1, clampedElapsed - cumulDays));
  const pct = Math.max(0, Math.min(100, Math.round(dayInPhase / phaseDays * 100)));
  const globalPct = Math.max(0, Math.min(100, Math.round(clampedElapsed / Math.max(1, totalDays) * 100)));
  return {
    hasProgram:true,
    label: active.label || active.id || 'Phase',
    color: active.color || 'var(--green)',
    day: dayInPhase,
    totalDays: phaseDays,
    pct,
    globalPct,
    index: idx + 1,
    count: phases.length,
    text: `${active.label || active.id || 'Phase'} · J${dayInPhase}/${phaseDays}`
  };
}
function foodnoteNum(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}
function foodnoteSelectedJournalDate() {
  return document.getElementById('f-date')?.value || foodnoteLocalISODate?.() || new Date().toISOString().slice(0,10);
}
function foodnoteEntryForDate(iso) {
  const entries = (typeof getEntries === 'function' ? getEntries() : []) || [];
  return entries.find(e => String(e.date) === String(iso)) || null;
}
function foodnoteSportHours(entry) {
  const rows = Array.isArray(entry?.sports) ? entry.sports : [];
  return rows.reduce((sum, s) => sum + foodnoteNum(s.heures ?? s.hours ?? s.duree ?? s.duration, 0), 0);
}
function foodnoteFormatHours(hours) {
  hours = foodnoteNum(hours, 0);
  if (!hours) return '0h';
  if (hours < 1) return Math.round(hours * 60) + 'min';
  if (Math.abs(hours - Math.round(hours)) < 0.04) return Math.round(hours) + 'h';
  return hours.toFixed(1).replace('.', ',') + 'h';
}
function foodnoteWeightTrendForDate(iso, entry) {
  const current = foodnoteNum(entry?.poids, NaN);
  if (!Number.isFinite(current) || current <= 0) return {current:null, previous:null, delta:null, text:'à renseigner', cls:'neutral', icon:'⚖️'};
  const entries = ((typeof getEntries === 'function' ? getEntries() : []) || [])
    .filter(e => e && e.date && String(e.date) < String(iso) && Number.isFinite(foodnoteNum(e.poids, NaN)) && foodnoteNum(e.poids, NaN) > 0)
    .slice()
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const ref = new Date(String(iso).slice(0,10) + 'T12:00:00');
  const start = new Date(ref); start.setDate(start.getDate() - 14);
  const end = new Date(ref); end.setDate(end.getDate() - 7);
  const toIso = d => d.toISOString().slice(0,10);
  const prevWeek = entries.filter(e => String(e.date) >= toIso(start) && String(e.date) <= toIso(end)).map(e => foodnoteNum(e.poids, NaN)).filter(Number.isFinite);
  let previous = prevWeek.length ? prevWeek.reduce((s,v)=>s+v,0) / prevWeek.length : null;
  if (!previous && entries.length) previous = foodnoteNum(entries[entries.length - 1].poids, NaN);
  if (!Number.isFinite(previous) || previous <= 0) return {current, previous:null, delta:null, text:'référence manquante', cls:'neutral', icon:'⚖️'};
  const delta = current - previous;
  const sign = delta > 0 ? '+' : '';
  const cls = Math.abs(delta) < 0.05 ? 'stable' : (delta > 0 ? 'up' : 'down');
  const icon = cls === 'stable' ? '→' : (delta > 0 ? '↗' : '↘');
  return {current, previous, delta, text:`${sign}${delta.toFixed(1).replace('.', ',')} kg vs sem. préc.`, cls, icon};
}
const FOODNOTE_DASHBOARD_CONFIG_KEY = 'foodnote_dashboard_badges_v4';
let foodnoteDashboardEditMode = false;
let foodnoteDashboardDragKey = null;
// Le composant éditable reste réservé au panneau Récap intelligent : il ne s'injecte plus sur la page Accueil/Journal.
// Les appels historiques côté journal sont conservés en no-op pour compatibilité.
const FOODNOTE_DASHBOARD_DEFAULT_VISIBLE = ['kcal','prot','sport7','weight','phase','review'];
const FOODNOTE_DASHBOARD_ALL_KEYS = ['kcal','prot','gluc','lip','net','sportKcal','sportHours','sport7','sport30','weight','phase','foods','review','streak','kcal7','prot7','gluc7','lip7'];

function foodnoteDashboardBadgeDefinitions(entry, iso) {
  // Compatibilité : certains anciens hooks attendent encore des opts de badge.
  const metrics = foodnoteDashboardMetricDefinitions(entry, iso);
  const out = {};
  Object.keys(metrics).forEach(k => {
    const m = metrics[k].opts || {};
    const value = [m.value, m.unit].filter(Boolean).join(' ').trim() || '—';
    out[k] = { name: metrics[k].name, opts:{
      icon:m.icon, label:m.label, value, sub:m.sub, progress:m.progress, cls:m.cls || m.tone || '', onclick:m.onclick, phaseColor:m.phaseColor
    }};
  });
  return out;
}

function foodnoteEntrySportKcal(entry) {
  const rows = Array.isArray(entry?.sports) ? entry.sports : [];
  const fromRows = rows.reduce((sum, s) => sum + foodnoteNum(s.total ?? s.kcal ?? s.calories, 0), 0);
  return foodnoteNum(entry?.depSport ?? entry?.dep_sport, fromRows) || fromRows || 0;
}
function foodnoteEntryMacroValue(entry, key) {
  const macros = entry?.macros || {};
  return foodnoteNum(macros[key] ?? entry?.[key], 0);
}
function foodnoteDashboardRange(iso, days) {
  const ref = new Date(String(iso || foodnoteSelectedJournalDate()).slice(0,10) + 'T12:00:00');
  const start = new Date(ref);
  start.setDate(start.getDate() - Math.max(0, days - 1));
  const toIso = d => d.toISOString().slice(0,10);
  const from = toIso(start);
  const to = toIso(ref);
  const entries = ((typeof getEntries === 'function' ? getEntries() : []) || [])
    .filter(e => e && e.date && String(e.date).slice(0,10) >= from && String(e.date).slice(0,10) <= to)
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const tracked = entries.filter(e => foodnoteEntryMacroValue(e, 'kcal') > 0 || foodnoteEntrySportKcal(e) > 0 || (Array.isArray(e.aliments) && e.aliments.length));
  const sportEntries = entries.filter(e => foodnoteEntrySportKcal(e) > 0 || (Array.isArray(e.sports) && e.sports.length));
  const sum = (arr, fn) => arr.reduce((s, e) => s + fn(e), 0);
  const sportKcal = Math.round(sum(entries, foodnoteEntrySportKcal));
  const sportHours = entries.reduce((s, e) => s + foodnoteSportHours(e), 0);
  const kcalVals = tracked.map(e => foodnoteEntryMacroValue(e, 'kcal')).filter(v => v > 0);
  const protVals = tracked.map(e => foodnoteEntryMacroValue(e, 'prot')).filter(v => v > 0);
  const glucVals = tracked.map(e => foodnoteEntryMacroValue(e, 'gluc')).filter(v => v > 0);
  const lipVals = tracked.map(e => foodnoteEntryMacroValue(e, 'lip')).filter(v => v > 0);
  const avg = arr => arr.length ? arr.reduce((s,v)=>s+v,0) / arr.length : 0;
  return {days, entries, tracked, trackedDays:tracked.length, sportDays:sportEntries.length, sportKcal, sportHours, avgKcal:avg(kcalVals), avgProt:avg(protVals), avgGluc:avg(glucVals), avgLip:avg(lipVals)};
}
function foodnoteDashboardMetricDefinitions(entry, iso) {
  const phase = foodnoteProgramPhaseState(iso);
  const sportHours = foodnoteSportHours(entry);
  const sportKcal = Math.round(foodnoteEntrySportKcal(entry));
  const sport7 = foodnoteDashboardRange(iso, 7);
  const sport30 = foodnoteDashboardRange(iso, 30);
  const trend = foodnoteWeightTrendForDate(iso, entry);
  const targets = {
    kcal: Math.max(1, foodnoteNum(window.PROFIL?.cibleKcal ?? PROFIL?.cibleKcal, 2200)),
    prot: Math.max(1, foodnoteNum(window.PROFIL?.cibleProt ?? PROFIL?.cibleProt, 120)),
    gluc: Math.max(1, foodnoteNum(window.PROFIL?.cibleGluc ?? PROFIL?.cibleGluc, 270)),
    lip: Math.max(1, foodnoteNum(window.PROFIL?.cibleLip ?? PROFIL?.cibleLip, 70))
  };
  const macros = entry?.macros || {};
  const kcal = foodnoteNum(macros.kcal ?? entry?.kcal, 0);
  const net = foodnoteNum(entry?.netKcal ?? entry?.net_kcal, kcal - sportKcal);
  const prot = foodnoteNum(macros.prot ?? entry?.prot, 0);
  const gluc = foodnoteNum(macros.gluc ?? entry?.gluc, 0);
  const lip = foodnoteNum(macros.lip ?? entry?.lip, 0);
  const kcal7 = foodnoteDashboardRange(iso, 7);
  const foods = Array.isArray(entry?.aliments) ? entry.aliments.length : 0;
  const reviewMissing = typeof foodnoteDailyReviewMissing === 'function' ? foodnoteDailyReviewMissing(entry || {}) : [];
  const reviewDone = reviewMissing.length === 0 && !!entry;
  const ratioStatus = (value, target) => !value ? 'is-muted' : (value >= target * .92 && value <= target * 1.08 ? 'is-ok' : (value > target * 1.08 ? 'is-warn' : 'is-muted'));
  const phaseValue = phase ? (phase.hasProgram ? `J${phase.day}` : 'Programme') : 'À configurer';
  const phaseUnit = phase && phase.hasProgram ? `/${phase.totalDays}` : '';
  const weightValue = trend.current ? trend.current.toFixed(1).replace('.', ',') : '—';
  const sportSummary = r => r.sportKcal ? `${r.sportDays} j sport · ${foodnoteFormatHours(r.sportHours)}` : `0 j sport sur ${r.days}`;
  const trackedSummary = r => r.trackedDays ? `${r.trackedDays}/${r.days} jours suivis` : 'pas assez de données';
  return {
    kcal: {name:'Calories du jour', opts:{icon:'🔥', label:'Calories du jour', value:kcal ? Math.round(kcal) : '—', unit:kcal ? 'kcal' : '', sub:kcal ? `aujourd’hui · cible ${targets.kcal} kcal` : 'aujourd’hui · pas encore saisi', progress:kcal ? Math.min(100, kcal / targets.kcal * 100) : 0, tone:'kcal', cls:ratioStatus(kcal, targets.kcal) + ' macro-kcal'}},
    prot: {name:'Protéines du jour', opts:{icon:'💪', label:'Protéines du jour', value:prot ? Math.round(prot) : '—', unit:prot ? 'g' : '', sub:`aujourd’hui · cible ${targets.prot} g`, progress:prot ? Math.min(100, prot / targets.prot * 100) : 0, tone:'prot', cls:(prot >= targets.prot ? 'is-ok' : 'is-muted') + ' macro-prot'}},
    gluc: {name:'Glucides du jour', opts:{icon:'🍞', label:'Glucides du jour', value:gluc ? Math.round(gluc) : '—', unit:gluc ? 'g' : '', sub:`aujourd’hui · cible ${targets.gluc} g`, progress:gluc ? Math.min(100, gluc / targets.gluc * 100) : 0, tone:'gluc', cls:ratioStatus(gluc, targets.gluc) + ' macro-gluc'}},
    lip: {name:'Lipides du jour', opts:{icon:'💧', label:'Lipides du jour', value:lip ? Math.round(lip) : '—', unit:lip ? 'g' : '', sub:`aujourd’hui · cible ${targets.lip} g`, progress:lip ? Math.min(100, lip / targets.lip * 100) : 0, tone:'lip', cls:ratioStatus(lip, targets.lip) + ' macro-lip'}},
    net: {name:'Net aujourd’hui', opts:{icon:'⚖️', label:'Net aujourd’hui', value:kcal ? Math.round(net) : '—', unit:kcal ? 'kcal' : '', sub:sportKcal ? `aujourd’hui · sport -${sportKcal} kcal` : 'aujourd’hui · aucun sport saisi', progress:kcal ? Math.min(100, net / targets.kcal * 100) : 0, tone:'net', cls:ratioStatus(net, targets.kcal)}},
    sportKcal: {name:'Sport du jour — calories', opts:{icon:'🚴', label:'Sport du jour', value:sportKcal ? `-${sportKcal}` : '0', unit:'kcal', sub:sportKcal ? 'dépense estimée aujourd’hui' : 'aucune dépense sport aujourd’hui', progress:null, tone:'sport', cls:sportKcal ? 'is-ok' : 'is-muted'}},
    sportHours: {name:'Sport du jour — durée', opts:{icon:'⏱️', label:'Durée sport du jour', value:foodnoteFormatHours(sportHours), unit:'', sub:sportHours ? 'durée enregistrée aujourd’hui' : 'aucune durée sport aujourd’hui', progress:null, tone:'sport', cls:sportHours ? 'is-ok' : 'is-muted'}},
    sport7: {name:'Sport 7 jours', opts:{icon:'🚴', label:'Sport 7 jours', value:sport7.sportKcal ? `-${sport7.sportKcal}` : '0', unit:'kcal', sub:sportSummary(sport7), progress:Math.min(100, sport7.sportDays / 3 * 100), tone:'sport', cls:sport7.sportKcal ? 'is-ok' : 'is-muted'}},
    sport30: {name:'Sport 30 jours', opts:{icon:'📆', label:'Sport 30 jours', value:sport30.sportKcal ? `-${sport30.sportKcal}` : '0', unit:'kcal', sub:sportSummary(sport30), progress:Math.min(100, sport30.sportDays / 12 * 100), tone:'sport', cls:sport30.sportKcal ? 'is-ok' : 'is-muted'}},
    weight: {name:'Tendance poids', opts:{icon:trend.icon || '⚖️', label:'Tendance poids', value:weightValue, unit:trend.current ? 'kg' : '', sub:trend.text, progress:null, tone:'weight', cls:`is-weight trend-${trend.cls || 'neutral'}`}},
    phase: {name:'Phase en cours', opts:{icon:'🏁', label:'Phase en cours', value:phaseValue, unit:phaseUnit, sub:phase?.label || 'Ouvrir programme', progress:phase?.hasProgram ? phase.pct : 0, tone:'phase', cls:'is-phase', phaseColor:phase?.color || 'var(--green)', onclick:'openFoodnoteProgramPage()'}},
    foods: {name:'Aliments du jour', opts:{icon:'🍽', label:'Aliments du jour', value:foods, unit:'', sub:foods ? 'saisi(s) aujourd’hui' : 'aucun aliment aujourd’hui', progress:null, tone:'foods', cls:foods ? 'is-ok' : 'is-muted'}},
    review: {name:'Bilan de la journée', opts:{icon:'📝', label:'Bilan de la journée', value:reviewDone ? 'OK' : `${reviewMissing.length}`, unit:reviewDone ? '' : 'manq.', sub:reviewDone ? 'journée complète' : 'éléments à compléter', progress:reviewDone ? 100 : Math.max(0, 100 - reviewMissing.length * 20), tone:'review', cls:reviewDone ? 'is-ok' : 'is-warn', onclick:'openFoodnoteDailyReview()'}},
    streak: {name:'Série de suivi', opts:{icon:'🔥', label:'Série de suivi', value:foodnoteDashboardStreakText(), unit:'', sub:'jours suivis consécutifs', progress:null, tone:'streak', cls:foodnoteDashboardStreakCount() >= 3 ? 'is-ok' : 'is-muted'}},
    kcal7: {name:'Calories moy. 7 jours', opts:{icon:'📊', label:'Calories 7 jours', value:kcal7.avgKcal ? Math.round(kcal7.avgKcal) : '—', unit:kcal7.avgKcal ? 'kcal/j' : '', sub:trackedSummary(kcal7), progress:kcal7.avgKcal ? Math.min(100, kcal7.avgKcal / targets.kcal * 100) : 0, tone:'kcal', cls:ratioStatus(kcal7.avgKcal, targets.kcal) + ' macro-kcal'}},
    prot7: {name:'Protéines moy. 7 jours', opts:{icon:'📊', label:'Protéines 7 jours', value:kcal7.avgProt ? Math.round(kcal7.avgProt) : '—', unit:kcal7.avgProt ? 'g/j' : '', sub:trackedSummary(kcal7), progress:kcal7.avgProt ? Math.min(100, kcal7.avgProt / targets.prot * 100) : 0, tone:'prot', cls:(kcal7.avgProt >= targets.prot ? 'is-ok' : 'is-muted') + ' macro-prot'}},
    gluc7: {name:'Glucides moy. 7 jours', opts:{icon:'📊', label:'Glucides 7 jours', value:kcal7.avgGluc ? Math.round(kcal7.avgGluc) : '—', unit:kcal7.avgGluc ? 'g/j' : '', sub:trackedSummary(kcal7), progress:kcal7.avgGluc ? Math.min(100, kcal7.avgGluc / targets.gluc * 100) : 0, tone:'gluc', cls:ratioStatus(kcal7.avgGluc, targets.gluc) + ' macro-gluc'}},
    lip7: {name:'Lipides moy. 7 jours', opts:{icon:'📊', label:'Lipides 7 jours', value:kcal7.avgLip ? Math.round(kcal7.avgLip) : '—', unit:kcal7.avgLip ? 'g/j' : '', sub:trackedSummary(kcal7), progress:kcal7.avgLip ? Math.min(100, kcal7.avgLip / targets.lip * 100) : 0, tone:'lip', cls:ratioStatus(kcal7.avgLip, targets.lip) + ' macro-lip'}}
  };
}
function foodnoteDashboardStreakCount() {
  const entries = ((typeof getEntries === 'function' ? getEntries() : []) || [])
    .filter(e => e && e.date && (Array.isArray(e.aliments) ? e.aliments.length : 0) > 0)
    .map(e => String(e.date).slice(0,10));
  const set = new Set(entries);
  let d = new Date(foodnoteSelectedJournalDate() + 'T12:00:00');
  let count = 0;
  while (count < 365) {
    const iso = d.toISOString().slice(0,10);
    if (!set.has(iso)) break;
    count += 1;
    d.setDate(d.getDate() - 1);
  }
  return count;
}
function foodnoteDashboardStreakText() {
  const c = foodnoteDashboardStreakCount();
  return c ? `${c} jour${c>1?'s':''}` : '—';
}
function foodnoteDashboardDefaultConfig() {
  return {
    order: FOODNOTE_DASHBOARD_ALL_KEYS.slice(),
    hidden: FOODNOTE_DASHBOARD_ALL_KEYS.filter(k => !FOODNOTE_DASHBOARD_DEFAULT_VISIBLE.includes(k))
  };
}
function foodnoteNormalizeDashboardConfig(cfg) {
  const base = foodnoteDashboardDefaultConfig();
  const rawOrder = Array.isArray(cfg?.order) ? cfg.order : base.order;
  const order = [];
  rawOrder.forEach(k => { if (FOODNOTE_DASHBOARD_ALL_KEYS.includes(k) && !order.includes(k)) order.push(k); });
  FOODNOTE_DASHBOARD_ALL_KEYS.forEach(k => { if (!order.includes(k)) order.push(k); });
  const hidden = Array.isArray(cfg?.hidden)
    ? cfg.hidden.filter(k => FOODNOTE_DASHBOARD_ALL_KEYS.includes(k))
    : base.hidden;
  return {order, hidden:[...new Set(hidden)]};
}
function loadFoodnoteDashboardConfig() {
  try { return foodnoteNormalizeDashboardConfig(JSON.parse(localStorage.getItem(FOODNOTE_DASHBOARD_CONFIG_KEY) || 'null')); }
  catch(e) { return foodnoteDashboardDefaultConfig(); }
}
function saveFoodnoteDashboardConfig(cfg) {
  const normalized = foodnoteNormalizeDashboardConfig(cfg);
  try { localStorage.setItem(FOODNOTE_DASHBOARD_CONFIG_KEY, JSON.stringify(normalized)); } catch(e) {}
  return normalized;
}
function foodnoteDashboardMetricHTML(def, key) {
  const opts = {...(def?.opts || {})};
  const action = opts.onclick;
  if (window.FoodNoteUI && typeof window.FoodNoteUI.metric === 'function') {
    let html = window.FoodNoteUI.metric(opts);
    const style = opts.phaseColor ? ` style="--phase-color:${foodnoteEsc(opts.phaseColor)}"` : '';
    const attrs = `data-dashboard-key="${foodnoteEsc(key)}"${style}${action ? ` onclick="${foodnoteEsc(action)}" role="button" tabindex="0"` : ''}`;
    html = html.replace('<div class="fn-ui-metric', `<div ${attrs} class="fn-ui-metric${action ? ' fn-ui-metric-action' : ''}`);
    return html;
  }
  const tone = opts.tone ? ` fn-ui-metric-${foodnoteEsc(opts.tone)}` : '';
  const pct = opts.progress == null ? '' : `<div class="fn-ui-metric-track"><i style="width:${Math.max(0, Math.min(100, Number(opts.progress)||0))}%"></i></div>`;
  const click = action ? ` onclick="${foodnoteEsc(action)}" role="button" tabindex="0"` : '';
  return `<div${click} data-dashboard-key="${foodnoteEsc(key)}" class="fn-ui-metric${tone}${action ? ' fn-ui-metric-action' : ''}">
    <div class="fn-ui-metric-top"><span>${foodnoteEsc(opts.icon || '•')}</span><small>${foodnoteEsc(opts.label || '')}</small></div>
    <strong>${foodnoteEsc(opts.value ?? '—')}<em>${foodnoteEsc(opts.unit || '')}</em></strong>
    ${opts.sub ? `<p>${foodnoteEsc(opts.sub)}</p>` : ''}
    ${pct}
  </div>`;
}
function foodnoteDashboardContextFor(mode) {
  const isRecap = mode === 'recap';
  let iso = '';
  try { iso = isRecap ? (window.foodnoteLastRecapDayISO || '') : foodnoteSelectedJournalDate(); } catch(e) {}
  if (!iso && isRecap) {
    try { iso = document.getElementById('recap-date-label')?.dataset?.iso || ''; } catch(e) {}
  }
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
    try { iso = foodnoteSelectedJournalDate(); } catch(e) {}
  }
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
    iso = (document.getElementById('f-date')?.value || new Date().toISOString().slice(0,10));
  }
  let entry = null;
  try { entry = foodnoteEntryForDate(iso); } catch(e) {}
  if (!entry && isRecap) {
    try {
      const entries = (typeof getEntries === 'function' ? getEntries() : []) || [];
      entry = entries.find(e => e?.date === iso)
        || entries.find(e => e && e.macros && foodnoteNum(e.macros.kcal, 0) > 0)
        || entries[0]
        || null;
      if (entry?.date) iso = entry.date;
    } catch(e) {}
  }
  return {iso, entry};
}
function foodnoteSmartDashboardTitle(mode) {
  return 'Mini bilan';
}
function foodnoteSmartDashboardSubtitle(mode) {
  return 'Synthèse claire de ce qui mérite ton attention aujourd’hui et cette semaine.';
}
function renderFoodnoteDashboardEditor(defs, cfg) {
  const rows = cfg.order.filter(k => defs[k]).map(k => {
    const checked = cfg.hidden.includes(k) ? '' : 'checked';
    const preview = defs[k].opts || {};
    return `<div class="fn-ui-row fn-ui-row--settings journal-dashboard-editor-row fn-ui-badge-edit-row" draggable="true" data-edit-key="${foodnoteEsc(k)}" ondragstart="foodnoteDashboardDragStart(event,'${foodnoteEsc(k)}')" ondragover="foodnoteDashboardDragOver(event)" ondrop="foodnoteDashboardDrop(event,'${foodnoteEsc(k)}')">
      <div class="journal-dashboard-drag" title="Déplacer">☰</div>
      <label class="journal-dashboard-check">
        <input type="checkbox" ${checked} onchange="setFoodnoteDashboardBadgeVisible('${foodnoteEsc(k)}', this.checked)">
        <span>${preview.icon || '•'} ${foodnoteEsc(defs[k].name || preview.label || k)}</span>
      </label>
      <div class="journal-dashboard-editor-actions fn-ui-badge-edit-arrows">
        <button type="button" onclick="moveFoodnoteDashboardBadge('${foodnoteEsc(k)}', -1)">↑</button>
        <button type="button" onclick="moveFoodnoteDashboardBadge('${foodnoteEsc(k)}', 1)">↓</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="journal-dashboard-editor fn-ui-badge-editor foodnote-dashboard-editor">
    <div class="journal-dashboard-editor-head fn-ui-badge-editor-head">
      <strong class="fn-section-title fn-section-title-plain"><span class="fn-section-icon">⚙️</span><span>Personnaliser ce mini bilan</span></strong>
      <span>Configuration du Récap intelligent.</span>
    </div>
    <div class="journal-dashboard-editor-list fn-ui-badge-editor-list">${rows}</div>
    <div class="journal-dashboard-editor-footer fn-ui-badge-editor-actions">
      <button type="button" onclick="resetFoodnoteDashboardBadges()">Réinitialiser</button>
      <button type="button" class="journal-dashboard-done primary" onclick="toggleFoodnoteDashboardEdit(false)">Terminé</button>
    </div>
  </div>`;
}
function renderFoodnoteSmartDashboardMetrics(target, opts={}) {
  const grid = typeof target === 'string' ? document.getElementById(target) : target;
  if (!grid) return;
  const mode = opts.mode || (grid.id === 'recap-metrics' ? 'recap' : 'journal');
  const ctx = foodnoteDashboardContextFor(mode);
  const defs = foodnoteDashboardMetricDefinitions(ctx.entry, ctx.iso);
  const cfg = loadFoodnoteDashboardConfig();
  const visibleKeys = cfg.order.filter(k => defs[k] && !cfg.hidden.includes(k));
  grid.classList.add('fn-ui-metric-grid', 'foodnote-smart-dashboard-grid', 'foodnote-smart-dashboard-metrics');
  grid.innerHTML = visibleKeys.length
    ? visibleKeys.map(k => foodnoteDashboardMetricHTML(defs[k], k)).join('')
    : `<div class="fn-ui-muted foodnote-dashboard-empty">Aucune carte affichée. Clique sur Modifier.</div>`;
  const editorTargetId = opts.editorTargetId || (mode === 'recap' ? 'recap-dashboard-editor' : '');
  if (editorTargetId) {
    const editor = document.getElementById(editorTargetId);
    if (editor) editor.innerHTML = foodnoteDashboardEditMode ? renderFoodnoteDashboardEditor(defs, cfg) : '';
  }
  try {
    if (mode === 'recap') {
      const btn = document.getElementById('recap-dashboard-edit-button');
      if (btn) btn.textContent = foodnoteDashboardEditMode ? 'Fermer' : 'Modifier';
    }
  } catch(e) {}
  try { window.dispatchEvent(new CustomEvent('foodnote-ui-rendered', { detail:{ source: grid.id || 'smart-dashboard-metrics', mode } })); } catch(e) {}
}
function renderFoodnoteSmartDashboard(target, opts={}) {
  const box = typeof target === 'string' ? document.getElementById(target) : target;
  if (!box) return;
  const mode = opts.mode || (box.id === 'recap-dashboard-compact' ? 'recap' : 'journal');
  const ctx = foodnoteDashboardContextFor(mode);
  const defs = foodnoteDashboardMetricDefinitions(ctx.entry, ctx.iso);
  const cfg = loadFoodnoteDashboardConfig();
  const visibleKeys = cfg.order.filter(k => defs[k] && !cfg.hidden.includes(k));
  const metricsHTML = visibleKeys.length
    ? visibleKeys.map(k => foodnoteDashboardMetricHTML(defs[k], k)).join('')
    : `<div class="fn-ui-muted foodnote-dashboard-empty">Aucune carte affichée. Clique sur Modifier.</div>`;
  const embedded = !!opts.embedded || box.classList.contains('foodnote-smart-dashboard-embed');
  box.classList.remove('journal-dashboard-badges');
  box.classList.add('foodnote-smart-dashboard', 'foodnote-smart-dashboard--metric', `foodnote-smart-dashboard--${mode}`);
  if (embedded) box.classList.remove('fn-ui-smart-panel');
  else box.classList.add('fn-ui-smart-panel');
  box.setAttribute('aria-label', 'Récap intelligent — Mini bilan');
  const headHTML = embedded ? '' : `<div class="fn-ui-smart-head foodnote-smart-dashboard-head">
      <div>
        <div class="fn-ui-smart-kicker">Récap intelligent</div>
        <div class="fn-ui-smart-title">${foodnoteEsc(foodnoteSmartDashboardTitle(mode))}</div>
        <div class="fn-ui-smart-help">${foodnoteEsc(foodnoteSmartDashboardSubtitle(mode))}</div>
      </div>
      <button type="button" class="fn-ui-button journal-dashboard-edit-btn" onclick="toggleFoodnoteDashboardEdit()">${foodnoteDashboardEditMode ? 'Fermer' : 'Modifier'}</button>
    </div>`;
  box.innerHTML = `${headHTML}
    <div class="fn-ui-metric-grid foodnote-smart-dashboard-grid foodnote-smart-dashboard-metrics">${metricsHTML}</div>
    ${foodnoteDashboardEditMode ? renderFoodnoteDashboardEditor(defs, cfg) : ''}`;
  try { window.dispatchEvent(new CustomEvent('foodnote-ui-rendered', { detail:{ source: box.id || 'smart-dashboard', mode } })); } catch(e) {}
}
function renderJournalDashboardBadges() {
  // beta 0.22.54 : le Mini bilan/Récap intelligent ne s'affiche plus sur Accueil/Journal.
  // On garde la fonction pour les anciens appels de rafraîchissement, mais elle ne rend rien.
  const box = document.getElementById('journal-dashboard-badges');
  if (box) box.innerHTML = '';
}
function refreshFoodnoteSmartDashboards() {
  // Le composant unifié est désormais limité au panneau Récap intelligent.
  try { if (document.getElementById('recap-metrics')) renderFoodnoteSmartDashboardMetrics('recap-metrics', {mode:'recap', editorTargetId:'recap-dashboard-editor'}); } catch(e) {}
  try { if (document.getElementById('recap-dashboard-compact')) renderFoodnoteSmartDashboard('recap-dashboard-compact', {mode:'recap'}); } catch(e) {}
}
function toggleFoodnoteDashboardEdit(force) {
  foodnoteDashboardEditMode = typeof force === 'boolean' ? force : !foodnoteDashboardEditMode;
  refreshFoodnoteSmartDashboards();
}
function setFoodnoteDashboardBadgeVisible(key, visible) {
  const cfg = loadFoodnoteDashboardConfig();
  cfg.hidden = cfg.hidden.filter(k => k !== key);
  if (!visible) cfg.hidden.push(key);
  saveFoodnoteDashboardConfig(cfg);
  refreshFoodnoteSmartDashboards();
}
function moveFoodnoteDashboardBadge(key, delta) {
  const cfg = loadFoodnoteDashboardConfig();
  const i = cfg.order.indexOf(key);
  if (i < 0) return;
  const j = Math.max(0, Math.min(cfg.order.length - 1, i + delta));
  if (i === j) return;
  const [item] = cfg.order.splice(i, 1);
  cfg.order.splice(j, 0, item);
  saveFoodnoteDashboardConfig(cfg);
  refreshFoodnoteSmartDashboards();
}
function resetFoodnoteDashboardBadges() {
  saveFoodnoteDashboardConfig(foodnoteDashboardDefaultConfig());
  refreshFoodnoteSmartDashboards();
}
function foodnoteDashboardDragStart(ev, key) {
  foodnoteDashboardDragKey = key;
  try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', key); } catch(e) {}
}
function foodnoteDashboardDragOver(ev) {
  ev.preventDefault();
  try { ev.dataTransfer.dropEffect = 'move'; } catch(e) {}
}
function foodnoteDashboardDrop(ev, targetKey) {
  ev.preventDefault();
  const sourceKey = foodnoteDashboardDragKey || (ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '');
  foodnoteDashboardDragKey = null;
  if (!sourceKey || sourceKey === targetKey) return;
  const cfg = loadFoodnoteDashboardConfig();
  const from = cfg.order.indexOf(sourceKey);
  const to = cfg.order.indexOf(targetKey);
  if (from < 0 || to < 0) return;
  const [item] = cfg.order.splice(from, 1);
  cfg.order.splice(to, 0, item);
  saveFoodnoteDashboardConfig(cfg);
  refreshFoodnoteSmartDashboards();
}
window.foodnoteDashboardBadgeDefinitions = foodnoteDashboardBadgeDefinitions;
window.foodnoteDashboardMetricDefinitions = foodnoteDashboardMetricDefinitions;
window.foodnoteDashboardDefaultConfig = foodnoteDashboardDefaultConfig;
window.loadFoodnoteDashboardConfig = loadFoodnoteDashboardConfig;
window.saveFoodnoteDashboardConfig = saveFoodnoteDashboardConfig;
window.renderFoodnoteSmartDashboard = renderFoodnoteSmartDashboard;
window.renderFoodnoteSmartDashboardMetrics = renderFoodnoteSmartDashboardMetrics;
window.renderJournalDashboardBadges = renderJournalDashboardBadges;
window.toggleFoodnoteDashboardEdit = toggleFoodnoteDashboardEdit;
window.setFoodnoteDashboardBadgeVisible = setFoodnoteDashboardBadgeVisible;
window.moveFoodnoteDashboardBadge = moveFoodnoteDashboardBadge;
window.resetFoodnoteDashboardBadges = resetFoodnoteDashboardBadges;
window.foodnoteDashboardDragStart = foodnoteDashboardDragStart;
window.foodnoteDashboardDragOver = foodnoteDashboardDragOver;
window.foodnoteDashboardDrop = foodnoteDashboardDrop;
window.refreshFoodnoteSmartDashboards = refreshFoodnoteSmartDashboards;

function renderJournalPhaseMini() {
  // Compatibilité avec les anciens appels : ne rien injecter sur Accueil/Journal.
  renderJournalDashboardBadges();
}
function openFoodnoteProgramPage() {
  if (typeof showPage === 'function') showPage('objectif', document.getElementById('nav-objectif'));
  if (typeof renderObjectif === 'function') setTimeout(renderObjectif, 60);
  if (typeof scrollTo === 'function') setTimeout(() => scrollTo('stats-phase'), 120);
}

function openJournalDatePicker() {
  const el = document.getElementById('f-date');
  if (!el) return;
  try {
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.click();
  } catch (e) { el.click(); }
}
function shiftJournalDate(delta) {
  const el = document.getElementById('f-date');
  const current = el?.value || new Date().toISOString().slice(0,10);
  selectJournalDate(foodnoteISODateOffset(current, delta || 0));
}
function foodnoteSimpleRelativeDayLabel(iso, current) {
  if (!iso || !current) return '';
  if (iso === current) return 'Aujourd’hui';
  const d = (typeof foodnoteDaysBetween === 'function') ? foodnoteDaysBetween(current, iso) : null;
  if (d === -1) return 'Hier';
  if (d === 1) return 'Demain';
  return '';
}
function renderJournalDayCarousel() {
  const box = document.getElementById('journal-day-carousel');
  const dateEl = document.getElementById('f-date');
  if (!box || !dateEl) return;
  const current = dateEl.value || new Date().toISOString().slice(0,10);
  const offsets = [-2, -1, 0, 1, 2];
  box.innerHTML = offsets.map(off => {
    const iso = foodnoteISODateOffset(current, off);
    const preview = foodnoteDayPreview(iso);
    const active = iso === current ? ' active' : '';
    const today = iso === (typeof foodnoteLocalISODate === 'function' ? foodnoteLocalISODate() : new Date().toISOString().slice(0,10)) ? ' is-today' : '';
    const hasEntry = preview.hasEntry ? ' has-entry' : ' is-empty';
    const rel = foodnoteSimpleRelativeDayLabel(iso, current);
    const title = preview.hasEntry
      ? `${formatDate(iso)} · ${Math.round(preview.kcal || 0)} kcal · ${preview.foods || 0} aliment(s)`
      : `${formatDate(iso)} · aucune saisie`;
    const marker = preview.hasEntry ? '<span class="journal-simple-dot" aria-label="journée saisie"></span>' : '<span class="journal-simple-dot is-empty" aria-hidden="true"></span>';
    const sport = preview.hasSport ? '<span class="journal-simple-sport" title="Sport saisi">🏃</span>' : '';
    return `<button type="button" class="journal-day-card journal-simple-day-card${active}${today}${hasEntry}" onclick="selectJournalDate('${iso}')" title="${title}" aria-label="${title}">
      <span class="journal-simple-weekday">${foodnoteDayShort(iso)}</span>
      <span class="journal-simple-number">${foodnoteDayNumber(iso)}</span>
      <span class="journal-simple-month">${foodnoteDayMonth(iso)}</span>
      <span class="journal-simple-meta">${rel || (preview.hasEntry ? `${preview.foods || 0} alim.` : '')}</span>
      <span class="journal-simple-markers">${marker}${sport}</span>
    </button>`;
  }).join('');
  if (typeof renderJournalPhaseMini === 'function') renderJournalPhaseMini();
}
function selectJournalDate(iso) {
  if (!iso) return;
  const dateEl = document.getElementById('f-date');
  if (dateEl) dateEl.value = iso;
  const existing = (typeof getEntries === 'function' ? getEntries() : []).find(e => e.date === iso);
  if (existing && typeof editEntry === 'function') {
    editEntry(existing.id);
  } else {
    if (typeof resetForm === 'function') resetForm();
    if (dateEl) dateEl.value = iso;
    if (typeof updateMacros === 'function') updateMacros();
  }
  if (typeof foodnoteRefreshJournalMutationViews === 'function') {
    foodnoteRefreshJournalMutationViews('journal-date-select', { journalCarousel:true, sportCarousel:true });
  } else {
    renderJournalDayCarousel();
    if (typeof renderSportDayCarousel === 'function') renderSportDayCarousel();
  }
}

/* v11.64 — Carrousel dédié Sport & activité, sans référence alimentation */
function syncSportDateProxy() {
  const main = document.getElementById('f-date');
  const sport = document.getElementById('sport-f-date');
  const iso = main?.value || foodnoteLocalISODate?.() || new Date().toISOString().slice(0,10);
  if (main && !main.value) main.value = iso;
  if (sport) sport.value = iso;
}
function openSportDatePicker() {
  syncSportDateProxy();
  const el = document.getElementById('sport-f-date') || document.getElementById('f-date');
  if (!el) return;
  try {
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.click();
  } catch(e) { el.click(); }
}
function shiftSportDate(delta) {
  const current = document.getElementById('sport-f-date')?.value || document.getElementById('f-date')?.value || foodnoteLocalISODate?.() || new Date().toISOString().slice(0,10);
  selectSportDate(foodnoteISODateOffset(current, delta || 0));
}
function clearSportRowsOnly() {
  try {
    (sportRows || []).forEach(r => document.getElementById('sport-row-' + r)?.remove());
    sportRows = [];
  } catch(e) {
    console.warn('[FoodNote] nettoyage lignes sport impossible', e);
  }
}
function selectSportDate(iso) {
  if (!iso) return;
  const main = document.getElementById('f-date');
  const sport = document.getElementById('sport-f-date');
  const previousIso = sport?.value || main?.value || '';
  if (previousIso && previousIso !== iso && typeof flushSportAutosaveBeforeDateChange === 'function') {
    flushSportAutosaveBeforeDateChange();
  }
  if (main) main.value = iso;
  if (sport) sport.value = iso;

  const entry = (typeof getEntries === 'function' ? getEntries() : []).find(e => e && e.date === iso);
  clearSportRowsOnly();
  let savedSports = Array.isArray(entry?.sports) ? entry.sports.filter(Boolean) : [];
  const depSportSaved = Number(entry?.depSport ?? entry?.dep_sport ?? 0) || 0;
  if (!savedSports.length && depSportSaved > 0) {
    savedSports = [{nom:'Sport saisi bilan', heures:1, kcalH:Math.round(depSportSaved), total:Math.round(depSportSaved)}];
  }
  savedSports.forEach(s => {
    if (typeof addSportRow !== 'function') return;
    const total = Number(s?.total || 0) || Math.round((Number(s?.heures || 0) || 0) * (Number(s?.kcalH || 0) || 0));
    addSportRow(s.nom || 'Sport', s.kcalH, s.heures, total);
  });
  if (typeof updateBilan === 'function') updateBilan(Number(entry?.macros?.kcal || entry?.kcal || 0) || 0);
  if (typeof foodnoteRefreshJournalMutationViews === 'function') {
    foodnoteRefreshJournalMutationViews('sport-date-select', { sportSummary:true, sportCarousel:true, journalCarousel:true });
  } else {
    renderSportPageSummary();
    renderSportDayCarousel();
    if (typeof renderJournalDayCarousel === 'function') renderJournalDayCarousel();
  }
}
function foodnoteSportRowsPreview() {
  const rows = (typeof buildCurrentSportPayload === 'function') ? buildCurrentSportPayload() : [];
  const sport = rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const hours = rows.reduce((sum, r) => sum + (Number(r.heures) || 0), 0);
  return {sport, hours, count: rows.filter(r => Number(r.heures) > 0 || Number(r.total) > 0).length};
}
function foodnoteSportDayPreview(iso) {
  const activeIso = document.getElementById('f-date')?.value || document.getElementById('sport-f-date')?.value;
  if (iso && activeIso && iso === activeIso && typeof buildCurrentSportPayload === 'function') {
    const live = foodnoteSportRowsPreview();
    if (live.sport > 0) return {hasSport:true, ...live, badges: foodnoteSportBadgesFromRows(buildCurrentSportPayload())};
    if (live.count || live.hours) return {hasSport:false, ...live, badges: []};
  }
  const entry = (typeof getEntries === 'function' ? getEntries() : []).find(e => e && e.date === iso);
  const rows = Array.isArray(entry?.sports) ? entry.sports : [];
  const sport = Number(entry?.depSport ?? entry?.dep_sport ?? rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0)) || 0;
  const hours = rows.reduce((sum, r) => sum + (Number(r.heures) || 0), 0);
  const hasSport = sport > 0;
  const badges = hasSport ? foodnoteSportBadgesFromRows(rows) : [];
  return {hasSport, sport, hours, count: hasSport ? rows.length : 0, badges};
}

function foodnoteNormalizeSportLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
function foodnoteSportBadgeMeta(name) {
  const raw = String(name || '').trim();
  const txt = foodnoteNormalizeSportLabel(raw);
  const rules = [
    { key:'bike', emoji:'🚴', label:'Vélo', re:/(^|[^a-z])(velo|vtt|cycl|spinning|bmx|route|home trainer|home-trainer)([^a-z]|$)/ },
    { key:'walk', emoji:'🚶', label:'Marche', re:/(^|[^a-z])(marche|rando|randonnee|randonnee|trek|trekking)([^a-z]|$)/ },
    { key:'run', emoji:'🏃', label:'Course', re:/(^|[^a-z])(course|running|run|jog|jogging|trail|tapis)([^a-z]|$)/ },
    { key:'swim', emoji:'🏊', label:'Natation', re:/(^|[^a-z])(natation|nage|swim|piscine|crawl)([^a-z]|$)/ },
    { key:'lift', emoji:'🏋️', label:'Muscu', re:/(^|[^a-z])(muscu|musculation|fitness|crossfit|haltere|halteres|renfo|renforcement|bodypump)([^a-z]|$)/ },
    { key:'ball', emoji:'⚽', label:'Foot', re:/(^|[^a-z])(football|foot|futsal|soccer)([^a-z]|$)/ },
    { key:'basket', emoji:'🏀', label:'Basket', re:/(^|[^a-z])(basket)([^a-z]|$)/ },
    { key:'tennis', emoji:'🎾', label:'Raquette', re:/(^|[^a-z])(tennis|padel|badminton|squash)([^a-z]|$)/ },
    { key:'combat', emoji:'🥊', label:'Combat', re:/(^|[^a-z])(boxe|mma|judo|karate|taekwondo|combat)([^a-z]|$)/ },
    { key:'yoga', emoji:'🧘', label:'Yoga', re:/(^|[^a-z])(yoga|pilates|stretching|mobilite)([^a-z]|$)/ },
    { key:'dance', emoji:'💃', label:'Danse', re:/(^|[^a-z])(danse|zumba)([^a-z]|$)/ },
    { key:'row', emoji:'🚣', label:'Rameur', re:/(^|[^a-z])(rameur|aviron|rowing)([^a-z]|$)/ },
    { key:'ski', emoji:'🎿', label:'Ski', re:/(^|[^a-z])(ski|snow)([^a-z]|$)/ },
  ];
  const match = rules.find(r => r.re.test(txt));
  if (match) return { key: match.key, emoji: match.emoji, label: match.label, raw: raw || match.label };
  return { key:'generic', emoji:'🏃', label: raw || 'Sport', raw: raw || 'Sport' };
}
function foodnoteSportBadgesFromRows(rows) {
  const grouped = new Map();
  (rows || []).forEach(row => {
    const meta = foodnoteSportBadgeMeta(row?.nom || row?.name || row?.label || '');
    const total = Number(row?.total || 0) || Math.round((Number(row?.heures || 0) || 0) * (Number(row?.kcalH || 0) || 0));
    if (total <= 0) return;
    if (!grouped.has(meta.key)) grouped.set(meta.key, { ...meta, total: 0, count: 0 });
    const cur = grouped.get(meta.key);
    cur.total += total;
    cur.count += 1;
  });
  return Array.from(grouped.values())
    .sort((a, b) => (b.total - a.total) || a.label.localeCompare(b.label, 'fr'))
    .slice(0, 3);
}
function foodnoteRenderSportBadges(badges) {
  const list = Array.isArray(badges) ? badges.filter(Boolean) : [];
  if (!list.length) return '<span class="sport-day-badges is-empty"></span>';
  const visible = list.slice(0, 2).map(b => `<span class="sport-day-badge" title="${typeof escapeHtml === 'function' ? escapeHtml(b.raw || b.label || 'Sport') : (b.raw || b.label || 'Sport')}">${b.emoji}</span>`).join('');
  const more = list.length > 2 ? `<span class="sport-day-badge sport-day-badge-more" title="${typeof escapeHtml === 'function' ? escapeHtml(list.slice(2).map(b => b.raw || b.label || 'Sport').join(', ')) : list.slice(2).map(b => b.raw || b.label || 'Sport').join(', ')}">+${list.length - 2}</span>` : '';
  return `<div class="sport-day-badges">${visible}${more}</div>`;
}

function renderSportPageSummary() {
  const live = foodnoteSportRowsPreview();
  const dep = Math.round(live.sport || 0);
  const durationEl = document.getElementById('sport-summary-duration');
  const countEl = document.getElementById('sport-summary-count');
  const depEl = document.getElementById('bilan-sport');
  const pill = document.getElementById('sport-date-pill');
  if (depEl) depEl.textContent = dep + ' kcal';
  if (durationEl) durationEl.textContent = typeof foodnoteFormatHours === 'function' ? foodnoteFormatHours(live.hours || 0) : ((Math.round((live.hours || 0) * 100) / 100) + ' h');
  if (countEl) countEl.textContent = String(live.count || 0);
  if (pill) pill.textContent = dep ? `${dep} kcal sport` : '0 kcal sport';
}
function renderSportDayCarousel() {
  const box = document.getElementById('sport-day-carousel');
  if (!box) return;
  syncSportDateProxy();
  const current = document.getElementById('sport-f-date')?.value || document.getElementById('f-date')?.value || foodnoteLocalISODate?.() || new Date().toISOString().slice(0,10);
  const offsets = [-2, -1, 0, 1, 2];
  box.innerHTML = offsets.map(off => {
    const iso = foodnoteISODateOffset(current, off);
    const preview = foodnoteSportDayPreview(iso);
    const active = iso === current ? ' active' : '';
    const today = iso === (typeof foodnoteLocalISODate === 'function' ? foodnoteLocalISODate() : new Date().toISOString().slice(0,10)) ? ' is-today' : '';
    const hasSport = preview.hasSport ? ' has-sport has-entry' : ' is-empty';
    const rel = foodnoteSimpleRelativeDayLabel(iso, current);
    const kcalText = preview.hasSport ? `${Math.round(preview.sport || 0)} kcal` : '';
    const title = preview.hasSport
      ? `${formatDate(iso)} · ${kcalText} sport`
      : `${formatDate(iso)} · repos`;
    const marker = preview.hasSport ? '<span class="journal-simple-dot sport-dot" aria-label="activité saisie"></span>' : '<span class="journal-simple-dot is-empty" aria-hidden="true"></span>';
    return `<button type="button" class="journal-day-card journal-simple-day-card${active}${today}${hasSport}" onclick="selectSportDate('${iso}')" title="${title}" aria-label="${title}">
      <span class="journal-simple-weekday">${foodnoteDayShort(iso)}</span>
      <span class="journal-simple-number">${foodnoteDayNumber(iso)}</span>
      <span class="journal-simple-month">${foodnoteDayMonth(iso)}</span>
      <span class="journal-simple-meta">${rel || kcalText}</span>
      <span class="journal-simple-markers">${marker}</span>
    </button>`;
  }).join('');
  renderSportPageSummary();
}



// FoodNote beta 0.22.179 — bilan quotidien intégré au Journal, sans badge flottant global
const FOODNOTE_DAILY_REVIEW_DEFAULT_HOUR = 18;
let foodnoteReviewStep = 0;
const FOODNOTE_REVIEW_STEPS = ['weight', 'food', 'sport', 'feeling', 'note'];

const FOODNOTE_NOTIFICATION_UI_KEY = 'foodnote_notification_ui_v1';
const FOODNOTE_NOTIFICATION_SETTINGS_KEY = 'notification_ui';
let _foodnoteNotificationSettingsLoaded = false;
let _foodnoteNotificationSettingsSyncTimer = null;

function foodnoteNotificationUI() {
  try {
    const raw = localStorage.getItem(FOODNOTE_NOTIFICATION_UI_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch(e) { return {}; }
}
function saveFoodnoteNotificationUI(patch = {}) {
  const next = {...foodnoteNotificationUI(), ...patch};
  try { localStorage.setItem(FOODNOTE_NOTIFICATION_UI_KEY, JSON.stringify(next)); } catch(e) {}
  foodnoteQueueNotificationUIServerSync(next);
  return next;
}
async function foodnoteLoadNotificationUIFromServer() {
  if (_foodnoteNotificationSettingsLoaded) return foodnoteNotificationUI();
  _foodnoteNotificationSettingsLoaded = true;
  try {
    const r = await fetch('/api/settings/' + encodeURIComponent(FOODNOTE_NOTIFICATION_SETTINGS_KEY), { cache:'no-store' });
    if (!r.ok) return foodnoteNotificationUI();
    const data = await r.json();
    const serverValue = data && data.value && typeof data.value === 'object' ? data.value : null;
    if (serverValue) {
      const merged = { ...serverValue, ...foodnoteNotificationUI() };
      try { localStorage.setItem(FOODNOTE_NOTIFICATION_UI_KEY, JSON.stringify(merged)); } catch(e) {}
      return merged;
    }
  } catch(e) {
    console.warn('[FoodNote] réglages rappel serveur indisponibles', e);
  }
  return foodnoteNotificationUI();
}
function foodnoteQueueNotificationUIServerSync(value) {
  clearTimeout(_foodnoteNotificationSettingsSyncTimer);
  _foodnoteNotificationSettingsSyncTimer = setTimeout(async () => {
    try {
      await fetch('/api/settings/' + encodeURIComponent(FOODNOTE_NOTIFICATION_SETTINGS_KEY), {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ value })
      });
    } catch(e) {
      console.warn('[FoodNote] synchro rappel serveur impossible', e);
    }
  }, 250);
}
function foodnoteNotificationHour() {
  const ui = foodnoteNotificationUI();
  const h = Number(ui.reviewHour ?? FOODNOTE_DAILY_REVIEW_DEFAULT_HOUR);
  return Number.isFinite(h) ? Math.min(23, Math.max(0, Math.round(h))) : FOODNOTE_DAILY_REVIEW_DEFAULT_HOUR;
}
function foodnoteTodoHiddenToday() {
  return foodnoteNotificationUI().hiddenTodoDate === foodnoteLocalISODate();
}
function hideFoodnoteTodoToday() {
  saveFoodnoteNotificationUI({hiddenTodoDate: foodnoteLocalISODate()});
  renderFoodnoteNotificationBadge();
  renderFoodnoteNotificationCenter();
}
function unhideFoodnoteTodoToday() {
  const ui = {...foodnoteNotificationUI()};
  if (ui.hiddenTodoDate === foodnoteLocalISODate()) delete ui.hiddenTodoDate;
  try { localStorage.setItem(FOODNOTE_NOTIFICATION_UI_KEY, JSON.stringify(ui)); } catch(e) {}
  renderFoodnoteNotificationBadge();
  renderFoodnoteNotificationCenter();
}
function foodnoteSuccessKey(s) {
  return String(s?.title || '') + '|' + String(s?.icon || '');
}
function foodnoteSeenSuccessesToday() {
  const ui = foodnoteNotificationUI();
  const today = foodnoteLocalISODate();
  return (ui.seenSuccessDate === today && Array.isArray(ui.seenSuccessKeys)) ? new Set(ui.seenSuccessKeys) : new Set();
}
function markFoodnoteSuccessesSeen() {
  const {successes} = foodnoteGetNotifications();
  saveFoodnoteNotificationUI({
    seenSuccessDate: foodnoteLocalISODate(),
    seenSuccessKeys: successes.map(s => s.key || foodnoteSuccessKey(s))
  });
  renderFoodnoteNotificationBadge();
  renderFoodnoteNotificationCenter();
}
function saveFoodnoteReviewHour() {
  const input = document.getElementById('fn-review-hour');
  const h = Math.min(23, Math.max(0, Math.round(Number(input?.value ?? FOODNOTE_DAILY_REVIEW_DEFAULT_HOUR))));
  saveFoodnoteNotificationUI({reviewHour:h});
  renderFoodnoteNotificationBadge();
  renderFoodnoteNotificationCenter();
}

// Charge une éventuelle préférence serveur dès que possible, sans bloquer l'app.
setTimeout(() => {
  foodnoteLoadNotificationUIFromServer().then(() => {
    try { renderFoodnoteNotificationBadge(); } catch(e) {}
    try { renderFoodnoteNotificationCenter(); } catch(e) {}
  });
}, 300);

function foodnoteLocalISODate(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function foodnoteEsc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function foodnoteTodayEntry() {
  const today = foodnoteLocalISODate();
  const entries = (typeof getEntries === 'function' ? getEntries() : []) || [];
  return entries.find(e => e.date === today) || null;
}
function foodnoteChecklist(entry) {
  return (entry && entry.dailyChecklist && typeof entry.dailyChecklist === 'object') ? entry.dailyChecklist : {};
}
function foodnoteHasText(v) {
  return String(v ?? '').trim().length > 0;
}
function foodnoteEntryHasRealSport(entry) {
  // Une ligne sport vide/restaurée ne doit pas compter comme activité réelle.
  // On valide le sport uniquement s'il existe une dépense, une durée ou un total positif.
  const rows = Array.isArray(entry?.sports) ? entry.sports : [];
  const fromRows = rows.reduce((sum, r) => sum + (Number(r?.total ?? 0) || 0), 0);
  const hours = rows.reduce((sum, r) => sum + (Number(r?.heures ?? r?.hours ?? r?.duree ?? r?.duration ?? 0) || 0), 0);
  const dep = Number(entry?.depSport ?? entry?.dep_sport ?? fromRows) || 0;
  return dep > 0 || fromRows > 0 || hours > 0;
}
function foodnoteDailyReviewMissing(entry) {
  const c = foodnoteChecklist(entry);
  const foods = Array.isArray(entry?.aliments) ? entry.aliments : [];
  const sports = Array.isArray(entry?.sports) ? entry.sports : [];
  const missing = [];
  if (!c.weightDone && !foodnoteHasText(entry?.poids)) missing.push('weight');
  if (!c.foodDone && foods.length === 0) missing.push('food');
  if (!c.sportDone && !foodnoteEntryHasRealSport(entry)) missing.push('sport');
  if (!c.feelingDone && !foodnoteHasText(entry?.energie) && !foodnoteHasText(entry?.faim)) missing.push('feeling');
  if (!c.noteDone && !foodnoteHasText(entry?.notes) && !foodnoteHasText(entry?.extras)) missing.push('note');
  return missing;
}
function foodnoteStepLabel(key) {
  return ({weight:'poids', food:'alimentation', sport:'sport', feeling:'ressenti', note:'note'})[key] || key;
}
function foodnoteReviewIsDue() {
  return new Date().getHours() >= foodnoteNotificationHour();
}
function foodnoteProfileSafe() {
  try { return window.PROFIL || (typeof PROFIL !== 'undefined' ? PROFIL : {}) || {}; }
  catch(e) { return {}; }
}
function foodnoteInRange(value, target, low = .9, high = 1.1) {
  value = Number(value || 0); target = Number(target || 0);
  return target > 0 && value >= target * low && value <= target * high;
}
function foodnoteEntryIsTracked(entry) {
  if (!entry) return false;
  const c = foodnoteChecklist(entry);
  return Object.values(c).some(Boolean)
    || (Array.isArray(entry.aliments) && entry.aliments.length > 0)
    || foodnoteEntryHasRealSport(entry)
    || foodnoteHasText(entry.poids)
    || foodnoteHasText(entry.energie)
    || foodnoteHasText(entry.faim)
    || foodnoteHasText(entry.notes)
    || foodnoteHasText(entry.extras);
}
function foodnoteISODateAdd(iso, deltaDays) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return foodnoteLocalISODate(d);
}
function foodnoteTrackingStreak(entries) {
  const map = new Map(((entries || [])).map(e => [String(e.date), e]));
  const today = foodnoteLocalISODate();
  let count = 0;
  for (let i = 0; i < 60; i++) {
    const e = map.get(foodnoteISODateAdd(today, -i));
    if (!foodnoteEntryIsTracked(e)) break;
    count += 1;
  }
  return count;
}
function foodnoteChecklistComplete(entry) {
  const c = foodnoteChecklist(entry);
  return !!(c.weightDone && c.foodDone && c.sportDone && c.feelingDone && c.noteDone);
}
function foodnoteShortPhaseLabel(profile) {
  const raw = String(profile.phaseLabel || profile.objectif || profile.phase || '').trim();
  if (!raw) return '';
  return raw.split('→')[0].replace(/\([^)]*\)/g, '').trim().slice(0, 42);
}
function foodnoteGetNotifications() {
  const entry = foodnoteTodayEntry();
  const due = foodnoteReviewIsDue();
  const missing = due ? foodnoteDailyReviewMissing(entry) : [];
  const profile = foodnoteProfileSafe();
  const m = entry?.macros || {};
  const successes = [];
  const kcal = Number(m.kcal || 0);
  const prot = Number(m.prot || 0);
  const gluc = Number(m.gluc || 0);
  const lip = Number(m.lip || 0);
  const cibleKcal = Number(profile.cibleKcal || 0);
  const cibleProt = Number(profile.cibleProt || 0);
  const cibleGluc = Number(profile.cibleGluc || 0);
  const cibleLip = Number(profile.cibleLip || 0);
  const kcalOk = entry && foodnoteInRange(kcal, cibleKcal, .9, 1.1);
  const protOk = entry && cibleProt > 0 && prot >= cibleProt;
  const glucOk = entry && foodnoteInRange(gluc, cibleGluc, .85, 1.15);
  const lipOk = entry && foodnoteInRange(lip, cibleLip, .85, 1.15);

  if (entry && protOk) successes.push({icon:'🎯', title:'Protéines atteintes', text:`${Math.round(prot)}g / ${Math.round(cibleProt)}g`});
  if (entry && kcalOk) successes.push({icon:'🔥', title:'Calories dans la cible', text:`${Math.round(kcal)} kcal / ${Math.round(cibleKcal)} kcal`});
  if (entry && glucOk) successes.push({icon:'🍚', title:'Glucides équilibrés', text:`${Math.round(gluc)}g / ${Math.round(cibleGluc)}g`});
  if (entry && lipOk) successes.push({icon:'🥑', title:'Lipides équilibrés', text:`${Math.round(lip)}g / ${Math.round(cibleLip)}g`});

  if (entry && kcalOk && protOk) {
    const phase = foodnoteShortPhaseLabel(profile);
    successes.push({icon:'🏁', title:'Phase du jour respectée', text: phase ? `Objectif cohérent avec : ${phase}.` : 'Calories et protéines sont cohérentes avec l’objectif.'});
  }
  if (entry && foodnoteHasText(entry.poids)) successes.push({icon:'⚖️', title:'Poids renseigné', text:`${entry.poids} kg enregistré aujourd’hui.`});
  if (entry && foodnoteEntryHasRealSport(entry)) {
    const sportKcal = Math.round(Number(entry.depSport ?? entry.dep_sport ?? 0) || 0);
    successes.push({icon:'🏃', title:'Sport enregistré', text: sportKcal > 0 ? `${sportKcal} kcal dépensées.` : 'Activité enregistrée.'});
  }
  if (entry && foodnoteChecklistComplete(entry)) successes.push({icon:'✅', title:'Bilan du jour complet', text:'Poids, alimentation, sport, ressenti et note sont validés.'});

  const entries = (typeof getEntries === 'function' ? getEntries() : []) || [];
  const streak = foodnoteTrackingStreak(entries);
  if (streak >= 3) successes.push({icon:'🔥', title:`${streak} jours suivis d’affilée`, text:'Série de suivi en cours.'});

  const seen = new Set();
  const seenSuccesses = foodnoteSeenSuccessesToday();
  const uniqueSuccesses = successes.filter(s => {
    const k = s.title + '|' + s.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 9).map(s => {
    const key = foodnoteSuccessKey(s);
    return {...s, key, seen: seenSuccesses.has(key)};
  });
  const todoHidden = foodnoteTodoHiddenToday();
  const visibleMissing = todoHidden ? [] : missing;
  const unseenSuccessCount = uniqueSuccesses.filter(s => !s.seen).length;
  return {entry, due, missing, visibleMissing, todoHidden, successes: uniqueSuccesses, unseenSuccessCount, reviewHour: foodnoteNotificationHour()};
}
function foodnoteRemoveLegacyNotificationOverlay() {
  // Migration propre : l'ancien système créait une cloche fixed et une modale globale.
  // Le nouveau bilan du jour vit dans la page Journal, donc ces nœuds ne doivent plus recouvrir l'app.
  ['fn-notification-badge', 'fn-notification-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.closest('#fn-notification-inline')) el.remove();
  });
}

function foodnoteNotificationHost() {
  foodnoteRemoveLegacyNotificationOverlay();
  let host = document.getElementById('fn-notification-inline');
  if (!host) {
    const journalHero = document.querySelector('#page-journal .journal-hero') || document.getElementById('page-journal');
    host = document.createElement('section');
    host.id = 'fn-notification-inline';
    host.className = 'fn-daily-status-panel';
    host.setAttribute('aria-live', 'polite');
    host.hidden = true;
    if (journalHero) {
      const dayRow = journalHero.querySelector('.journal-day-row-carousel');
      if (dayRow && dayRow.parentNode) dayRow.insertAdjacentElement('afterend', host);
      else journalHero.insertBefore(host, journalHero.firstChild || null);
    } else {
      document.body.appendChild(host);
    }
  }
  return host;
}

function ensureFoodnoteNotificationUI() {
  return foodnoteNotificationHost();
}

function foodnoteProfileReadyForInlineNotification() {
  try { return !!(typeof loadProfil === 'function' ? loadProfil().onboardingDone : true); }
  catch(e) { return true; }
}

function foodnoteNotificationSummaryModel() {
  const {due, missing, visibleMissing, todoHidden, successes, unseenSuccessCount, reviewHour} = foodnoteGetNotifications();
  const missingText = missing.map(foodnoteStepLabel).join(', ');
  if (visibleMissing.length) {
    return {
      visible:true,
      state:'warning',
      icon:'📝',
      title:`Bilan du jour à compléter`,
      text:`Il manque : ${missingText}.`,
      action:'Compléter',
      actionKind:'review'
    };
  }
  if (todoHidden && missing.length) {
    return {
      visible:true,
      state:'muted',
      icon:'🙈',
      title:'Rappel masqué pour aujourd’hui',
      text:`Il manque encore : ${missingText}.`,
      action:'Voir',
      actionKind:'open'
    };
  }
  if (unseenSuccessCount > 0) {
    const first = successes.find(s => !s.seen) || successes[0];
    return {
      visible:true,
      state:'success',
      icon:first?.icon || '🏆',
      title:unseenSuccessCount > 1 ? `${unseenSuccessCount} accomplissements` : (first?.title || 'Accomplissement'),
      text:first?.text || 'Objectif validé aujourd’hui.',
      action:'Voir',
      actionKind:'open'
    };
  }
  if (due && successes.length) {
    return {
      visible:false,
      state:'success',
      icon:'✅',
      title:'Bilan du jour OK',
      text:'Rien d’important à compléter.',
      action:'Voir',
      actionKind:'open'
    };
  }
  return {
    visible:false,
    state:'neutral',
    icon:'⏰',
    title:`Bilan après ${reviewHour}h`,
    text:`Le rappel discret apparaîtra après ${reviewHour}h si une étape manque.`,
    action:'Voir',
    actionKind:'open'
  };
}

function foodnoteSetInlineNotificationState(host, state) {
  host.classList.remove('is-warning', 'is-success', 'is-muted', 'is-neutral', 'is-open', 'is-review', 'is-compact');
  host.classList.add('is-' + (state || 'neutral'));
}

function renderFoodnoteNotificationBadge() {
  const host = ensureFoodnoteNotificationUI();
  if (!host) return;
  if (!foodnoteProfileReadyForInlineNotification()) { host.hidden = true; return; }
  const model = foodnoteNotificationSummaryModel();
  if (!model.visible) { host.hidden = true; return; }
  host.hidden = false;
  foodnoteSetInlineNotificationState(host, model.state);
  host.classList.add('is-compact');
  host.innerHTML = `
    <div class="fn-daily-status-summary">
      <div class="fn-daily-status-icon" aria-hidden="true">${foodnoteEsc(model.icon)}</div>
      <div class="fn-daily-status-copy">
        <strong class="fn-daily-status-title">${foodnoteEsc(model.title)}</strong>
        <div class="fn-daily-status-text">${foodnoteEsc(model.text)}</div>
      </div>
      <div class="fn-daily-status-actions">
        ${model.actionKind === 'review'
          ? '<button type="button" class="primary" onclick="openFoodnoteDailyReview()">Compléter</button>'
          : '<button type="button" onclick="openFoodnoteNotificationCenter()">Voir</button>'}
        <button type="button" onclick="closeFoodnoteNotificationCenter()" aria-label="Masquer le bilan du jour">Masquer</button>
      </div>
    </div>`;
}

function openFoodnoteNotificationCenter() {
  const host = ensureFoodnoteNotificationUI();
  if (!host || !foodnoteProfileReadyForInlineNotification()) return;
  host.hidden = false;
  renderFoodnoteNotificationCenter({expanded:true});
  try { host.scrollIntoView({behavior:'smooth', block:'nearest'}); } catch(e) {}
}

function closeFoodnoteNotificationCenter() {
  const host = ensureFoodnoteNotificationUI();
  if (!host) return;
  host.classList.remove('is-open', 'is-review');
  renderFoodnoteNotificationBadge();
}

function renderFoodnoteNotificationCenter(options = {}) {
  const host = ensureFoodnoteNotificationUI();
  if (!host) return;
  if (!options.expanded && host.hidden) return;
  const {entry, due, missing, visibleMissing, todoHidden, successes, unseenSuccessCount, reviewHour} = foodnoteGetNotifications();
  const missingText = missing.map(foodnoteStepLabel).join(', ');
  const model = foodnoteNotificationSummaryModel();
  host.hidden = false;
  foodnoteSetInlineNotificationState(host, model.state || 'neutral');
  host.classList.add('is-open');
  let todoHtml = '';
  if (due && missing.length && !todoHidden) {
    todoHtml = `
      <div class="fn-notification-card fn-notification-todo">
        <div class="fn-notification-card-icon">📝</div>
        <div class="fn-notification-card-main">
          <div class="fn-notification-card-title">Bilan du jour incomplet</div>
          <div class="fn-notification-card-text">Il manque : ${foodnoteEsc(missingText)}.</div>
          <div class="fn-notification-row-actions">
            <button type="button" class="fn-notification-action" onclick="openFoodnoteDailyReview()">Compléter</button>
            <button type="button" class="fn-notification-small-action" onclick="hideFoodnoteTodoToday()">Masquer aujourd’hui</button>
          </div>
        </div>
      </div>`;
  } else if (due && missing.length && todoHidden) {
    todoHtml = `
      <div class="fn-notification-card fn-notification-muted">
        <div class="fn-notification-card-icon">🙈</div>
        <div class="fn-notification-card-main">
          <div class="fn-notification-card-title">Bilan masqué pour aujourd’hui</div>
          <div class="fn-notification-card-text">Il manque encore : ${foodnoteEsc(missingText)}, mais le rappel reste discret.</div>
          <div class="fn-notification-row-actions">
            <button type="button" class="fn-notification-action" onclick="openFoodnoteDailyReview()">Faire maintenant</button>
            <button type="button" class="fn-notification-small-action" onclick="unhideFoodnoteTodoToday()">Réactiver</button>
          </div>
        </div>
      </div>`;
  } else {
    todoHtml = `
      <div class="fn-notification-card">
        <div class="fn-notification-card-icon">${due ? '✅' : '⏰'}</div>
        <div class="fn-notification-card-main">
          <div class="fn-notification-card-title">${due ? 'Bilan du jour OK' : `Bilan après ${reviewHour}h`}</div>
          <div class="fn-notification-card-text">${due ? 'Rien d’important à compléter pour aujourd’hui.' : `Le rappel discret apparaîtra après ${reviewHour}h si une étape manque.`}</div>
        </div>
      </div>`;
  }
  const successCards = successes.map(s => `
    <div class="fn-notification-card fn-notification-success${s.seen ? ' is-seen' : ''}">
      <div class="fn-notification-card-icon">${s.icon}</div>
      <div class="fn-notification-card-main">
        <div class="fn-notification-card-title">${foodnoteEsc(s.title)}${s.seen ? ' · vu' : ''}</div>
        <div class="fn-notification-card-text">${foodnoteEsc(s.text)}</div>
      </div>
    </div>`).join('');
  const successHtml = successCards ? `
    <div class="fn-notification-section-row">
      <div class="fn-notification-section-title fn-section-title"><span class="fn-section-icon">🏆</span><span>Accomplissements</span></div>
      ${unseenSuccessCount ? '<button type="button" class="fn-notification-small-action" onclick="markFoodnoteSuccessesSeen()">Marquer comme vu</button>' : ''}
    </div>
    ${successCards}` : '';
  host.innerHTML = `
    <div class="fn-notification-head">
      <div>
        <div class="fn-notification-title">Bilan du jour</div>
        <div class="fn-notification-sub">Rappel intégré au Journal, sans bulle flottante.</div>
      </div>
      <button type="button" class="fn-notification-close" onclick="closeFoodnoteNotificationCenter()" aria-label="Refermer le bilan">✕</button>
    </div>
    <div class="fn-notification-list">${todoHtml}${successHtml || ''}</div>
    <div class="fn-notification-settings">
      <label>Rappel bilan après <input id="fn-review-hour" type="number" min="0" max="23" value="${reviewHour}"> h</label>
      <button type="button" onclick="saveFoodnoteReviewHour()">OK</button>
    </div>
    <div class="fn-notification-foot">Aujourd’hui : ${foodnoteEsc(foodnoteLocalISODate())}${entry ? ' · journée créée' : ' · aucune entrée'}${visibleMissing.length ? '' : (todoHidden ? ' · rappel masqué' : '')}</div>
  `;
}
function openFoodnoteDailyReview(stepKey) {
  const missing = foodnoteGetNotifications().missing;
  const startKey = stepKey || missing[0] || 'weight';
  foodnoteReviewStep = Math.max(0, FOODNOTE_REVIEW_STEPS.indexOf(startKey));
  renderFoodnoteDailyReview();
}
function closeFoodnoteDailyReview() {
  renderFoodnoteNotificationCenter();
  renderFoodnoteNotificationBadge();
  if (typeof renderJournalDashboardBadges === 'function') renderJournalDashboardBadges();
}
function foodnoteReviewEntryOrEmpty() {
  const today = foodnoteLocalISODate();
  return foodnoteTodayEntry() || {
    id: Date.now(),
    date: today,
    poids: '', energie: '', faim: '', notes: '', extras: '', question: '',
    depSport: 0, netKcal: 0,
    macros: {kcal:0, prot:0, gluc:0, lip:0},
    aliments: [], sports: [],
    dailyChecklist: {}, dailyReview: {}
  };
}
async function persistFoodnoteDailyReview(patch = {}, checklistPatch = {}) {
  const today = foodnoteLocalISODate();
  let entry = foodnoteReviewEntryOrEmpty();
  const merged = {
    ...entry,
    ...patch,
    date: today,
    macros: patch.macros || entry.macros || {kcal:0, prot:0, gluc:0, lip:0},
    aliments: Array.isArray(patch.aliments) ? patch.aliments : (Array.isArray(entry.aliments) ? entry.aliments : []),
    sports: Array.isArray(patch.sports) ? patch.sports : (Array.isArray(entry.sports) ? entry.sports : []),
    dailyChecklist: {...foodnoteChecklist(entry), ...checklistPatch},
    dailyReview: {...(entry.dailyReview || {}), updatedAt:new Date().toISOString()}
  };
  if (!merged.netKcal && merged.macros) merged.netKcal = Math.round(Number(merged.macros.kcal || 0) - Number(merged.depSport || 0));
  try {
    if (typeof postEntryNative !== 'function') throw new Error('postEntryNative indisponible');
    const saved = await postEntryNative({...merged, _preserveSportsIfMissing:true}, {force:true});
    const entries = typeof getEntries === 'function' ? getEntries() : [];
    const idx = entries.findIndex(e => String(e.date) === String(saved.date) || String(e.id) === String(saved.id));
    if (idx >= 0) entries[idx] = saved; else entries.unshift(saved);
    if (typeof sortEntriesDesc === 'function') _db.journal_entries = sortEntriesDesc(entries);
    else _db.journal_entries = entries;
    if (typeof saveLocalOnly === 'function') saveLocalOnly();
    if (document.getElementById('f-date')?.value === today && typeof editEntry === 'function') editEntry(saved.id);
    renderFoodnoteNotificationBadge();
    if (typeof renderJournalDashboardBadges === 'function') renderJournalDashboardBadges();
    return saved;
  } catch(e) {
    console.error('[FoodNote] bilan du jour impossible à sauvegarder', e);
    if (typeof showSaveStatus === 'function') showSaveStatus('Bilan non sauvegardé : ' + (e.message || e), true);
    throw e;
  }
}
function renderFoodnoteDailyReview() {
  const box = ensureFoodnoteNotificationUI();
  if (!box) return;
  box.hidden = false;
  foodnoteSetInlineNotificationState(box, 'warning');
  box.classList.add('is-open', 'is-review');
  const entry = foodnoteReviewEntryOrEmpty();
  const key = FOODNOTE_REVIEW_STEPS[foodnoteReviewStep] || 'weight';
  const stepNo = foodnoteReviewStep + 1;
  const total = FOODNOTE_REVIEW_STEPS.length;
  const missing = foodnoteDailyReviewMissing(entry);
  const done = !missing.includes(key);
  const prevDisabled = foodnoteReviewStep <= 0 ? 'disabled' : '';
  const nextLabel = foodnoteReviewStep >= total - 1 ? 'Terminer' : 'Suivant';
  const bodyByStep = {
    weight: () => `
      <div class="fn-review-step-icon">⚖️</div>
      <div class="fn-review-step-title">Poids du jour</div>
      <div class="fn-review-step-sub">Renseigne le poids du jour, ou ignore uniquement aujourd’hui.</div>
      <input class="fn-review-input" id="fn-review-weight" type="number" step="0.1" min="30" max="250" value="${foodnoteEsc(entry.poids || '')}" placeholder="ex : 82.4">
      <div class="fn-review-actions-inline">
        <button type="button" onclick="saveFoodnoteReviewWeight()">Valider poids</button>
        <button type="button" onclick="skipFoodnoteReviewStep('weight')">Ignorer aujourd’hui</button>
      </div>`,
    food: () => `
      <div class="fn-review-step-icon">🍽</div>
      <div class="fn-review-step-title">Alimentation</div>
      <div class="fn-review-step-sub">${(entry.aliments || []).length ? `${(entry.aliments || []).length} aliment(s) saisi(s), ${Math.round(entry.macros?.kcal || 0)} kcal.` : 'Aucun aliment saisi pour aujourd’hui.'}</div>
      <div class="fn-review-actions-inline">
        <button type="button" onclick="openFoodnoteFoodFill()">Ajouter / vérifier aliments</button>
        <button type="button" onclick="skipFoodnoteReviewStep('food')">J’ai tout rempli</button>
      </div>`,
    sport: () => {
      const sportOk = ((entry.sports || []).length || Number(entry.depSport || 0) > 0);
      return `
      <div class="fn-review-step-icon">🏃</div>
      <div class="fn-review-step-title">Sport</div>
      <div class="fn-review-step-sub">${sportOk ? `${(entry.sports || []).length || 1} activité(s), ${Math.round(entry.depSport || 0)} kcal.` : 'Aucune activité sportive confirmée.'}</div>
      <div class="fn-review-actions-inline">
        ${sportOk ? '<button type="button" onclick="confirmFoodnoteReviewSport()">Valider sport et continuer</button>' : '<button type="button" onclick="openFoodnoteSportFill()">Ajouter sport</button>'}
        ${sportOk ? '<button type="button" onclick="openFoodnoteSportFill()">Modifier sport</button>' : '<button type="button" onclick="skipFoodnoteReviewStep(\'sport\')">Pas de sport aujourd’hui</button>'}
      </div>`;
    },
    feeling: () => `
      <div class="fn-review-step-icon">🙂</div>
      <div class="fn-review-step-title">Ressenti</div>
      <div class="fn-review-step-sub">Choisis ton niveau d’énergie. Tu pourras affiner plus tard.</div>
      <div class="fn-review-choice-grid">
        <button type="button" onclick="saveFoodnoteReviewFeeling('Bonne énergie')">😄 Bien</button>
        <button type="button" onclick="saveFoodnoteReviewFeeling('Fatigue modérée')">🙂 Moyen</button>
        <button type="button" onclick="saveFoodnoteReviewFeeling('Fatigue importante')">😫 Fatigué</button>
      </div>
      <button type="button" class="fn-review-link" onclick="skipFoodnoteReviewStep('feeling')">Ignorer aujourd’hui</button>`,
    note: () => `
      <div class="fn-review-step-icon">📝</div>
      <div class="fn-review-step-title">Note du jour</div>
      <div class="fn-review-step-sub">Une remarque rapide : faim, sommeil, restaurant, écart, digestion…</div>
      <textarea class="fn-review-textarea" id="fn-review-note" placeholder="Note rapide…">${foodnoteEsc(entry.notes || '')}</textarea>
      <div class="fn-review-actions-inline">
        <button type="button" onclick="saveFoodnoteReviewNote()">Valider note</button>
        <button type="button" onclick="skipFoodnoteReviewStep('note')">Rien à noter</button>
      </div>`
  };
  box.innerHTML = `
    <div class="fn-notification-head">
      <div>
        <div class="fn-notification-title">Bilan du jour</div>
        <div class="fn-notification-sub">Étape ${stepNo}/${total} — ${foodnoteEsc(foodnoteStepLabel(key))}${done ? ' · déjà OK' : ''}</div>
      </div>
      <button type="button" class="fn-notification-close" onclick="closeFoodnoteNotificationCenter()">✕</button>
    </div>
    <div class="fn-review-progress"><span style="width:${Math.round(stepNo / total * 100)}%"></span></div>
    <div class="fn-review-body">${bodyByStep[key]()}</div>
    <div class="fn-review-nav">
      <button type="button" ${prevDisabled} onclick="foodnoteReviewStep=Math.max(0,foodnoteReviewStep-1);renderFoodnoteDailyReview()">Précédent</button>
      <button type="button" class="fn-review-next" onclick="nextFoodnoteReviewStep()">${nextLabel}</button>
    </div>
  `;
}
function nextFoodnoteReviewStep() {
  if (foodnoteReviewStep >= FOODNOTE_REVIEW_STEPS.length - 1) {
    closeFoodnoteNotificationCenter();
    renderFoodnoteNotificationBadge();
    if (typeof renderJournalDashboardBadges === 'function') renderJournalDashboardBadges();
    return;
  }
  foodnoteReviewStep += 1;
  renderFoodnoteDailyReview();
}
async function skipFoodnoteReviewStep(key) {
  const patch = {};
  const c = {};
  if (key === 'weight') c.weightDone = true;
  if (key === 'food') c.foodDone = true;
  if (key === 'sport') c.sportDone = true;
  if (key === 'feeling') c.feelingDone = true;
  if (key === 'note') c.noteDone = true;
  await persistFoodnoteDailyReview(patch, c);
  nextFoodnoteReviewStep();
}
async function saveFoodnoteReviewWeight() {
  const v = document.getElementById('fn-review-weight')?.value || '';
  await persistFoodnoteDailyReview({poids:v}, {weightDone:true});
  const f = document.getElementById('f-poids'); if (f) f.value = v;
  nextFoodnoteReviewStep();
}
async function saveFoodnoteReviewFeeling(value) {
  await persistFoodnoteDailyReview({energie:value}, {feelingDone:true});
  const f = document.getElementById('f-energie'); if (f) f.value = value;
  nextFoodnoteReviewStep();
}
async function saveFoodnoteReviewNote() {
  const v = document.getElementById('fn-review-note')?.value || '';
  await persistFoodnoteDailyReview({notes:v}, {noteDone:true});
  const f = document.getElementById('f-notes'); if (f) f.value = v;
  nextFoodnoteReviewStep();
}
function foodnoteEnsureReviewResumeDock() {
  let dock = document.getElementById('fn-review-resume-dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'fn-review-resume-dock';
    dock.className = 'fn-review-resume-dock';
    dock.style.display = 'none';
    document.body.appendChild(dock);
  }
  return dock;
}
function showFoodnoteReviewResumeDock(kind = 'sport') {
  const dock = foodnoteEnsureReviewResumeDock();
  window.__foodnoteReviewResumeKind = kind;
  const label = kind === 'food' ? 'Alimentation remplie' : 'Sport rempli';
  const icon = kind === 'food' ? '🍽' : '🏃';
  dock.innerHTML = `
    <div class="fn-review-resume-main">
      <span class="fn-review-resume-icon">${icon}</span>
      <div><b>Bilan du jour</b><span>${label} ? valide pour continuer le formulaire.</span></div>
    </div>
    <button type="button" onclick="confirmFoodnoteReviewResume()">Valider et continuer</button>
    <button type="button" class="fn-review-resume-close" onclick="hideFoodnoteReviewResumeDock()">×</button>
  `;
  dock.style.display = 'flex';
}
function hideFoodnoteReviewResumeDock() {
  const dock = document.getElementById('fn-review-resume-dock');
  if (dock) dock.style.display = 'none';
}
async function confirmFoodnoteReviewSport() {
  try {
    if (typeof saveSportOnlyNow === 'function') await saveSportOnlyNow(true);
  } catch(e) {
    console.warn('[FoodNote] sauvegarde sport avant validation bilan impossible', e);
  }
  await persistFoodnoteDailyReview({}, {sportDone:true});
  hideFoodnoteReviewResumeDock();
  const idx = FOODNOTE_REVIEW_STEPS.indexOf('sport');
  foodnoteReviewStep = Math.min(FOODNOTE_REVIEW_STEPS.length - 1, Math.max(0, idx + 1));
  ensureFoodnoteNotificationUI();
  renderFoodnoteDailyReview();
}
async function confirmFoodnoteReviewFood() {
  await persistFoodnoteDailyReview({}, {foodDone:true});
  hideFoodnoteReviewResumeDock();
  const idx = FOODNOTE_REVIEW_STEPS.indexOf('food');
  foodnoteReviewStep = Math.min(FOODNOTE_REVIEW_STEPS.length - 1, Math.max(0, idx + 1));
  ensureFoodnoteNotificationUI();
  renderFoodnoteDailyReview();
}
function confirmFoodnoteReviewResume() {
  const kind = window.__foodnoteReviewResumeKind || 'sport';
  if (kind === 'food') return confirmFoodnoteReviewFood();
  return confirmFoodnoteReviewSport();
}
function openFoodnoteFoodFill() {
  closeFoodnoteNotificationCenter();
  if (typeof showPage === 'function') showPage('journal', document.querySelector('[onclick*="journal"]'));
  showFoodnoteReviewResumeDock('food');
  if (typeof goToFoodAdd === 'function') setTimeout(goToFoodAdd, 120);
}
function openFoodnoteSportFill() {
  closeFoodnoteNotificationCenter();
  if (typeof showPage === 'function') showPage('sport', document.querySelector('[onclick*="sport"]'));
  showFoodnoteReviewResumeDock('sport');
  if (typeof addSportRow === 'function' && (typeof sportRows === 'undefined' || !sportRows.length)) setTimeout(() => addSportRow(), 120);
}
function bindFoodnoteNotificationClicks() {
  if (window.__foodnoteNotificationClicksBound) return;
  window.__foodnoteNotificationClicksBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFoodnoteNotificationCenter();
  });
}
function exposeFoodnoteNotificationGlobals() {
  Object.assign(window, {
    renderFoodnoteNotificationBadge,
    openFoodnoteNotificationCenter,
    closeFoodnoteNotificationCenter,
    renderFoodnoteNotificationCenter,
    openFoodnoteDailyReview,
    closeFoodnoteDailyReview,
    renderFoodnoteDailyReview,
    nextFoodnoteReviewStep,
    skipFoodnoteReviewStep,
    saveFoodnoteReviewWeight,
    saveFoodnoteReviewFeeling,
    saveFoodnoteReviewNote,
    confirmFoodnoteReviewSport,
    confirmFoodnoteReviewFood,
    confirmFoodnoteReviewResume,
    showFoodnoteReviewResumeDock,
    hideFoodnoteReviewResumeDock,
    openFoodnoteFoodFill,
    openFoodnoteSportFill,
    hideFoodnoteTodoToday,
    unhideFoodnoteTodoToday,
    markFoodnoteSuccessesSeen,
    saveFoodnoteReviewHour,
    renderJournalPhaseMini,
    renderJournalDashboardBadges,
    openFoodnoteProgramPage,
    toggleFoodnoteDashboardEdit,
    setFoodnoteDashboardBadgeVisible,
    moveFoodnoteDashboardBadge,
    resetFoodnoteDashboardBadges,
    foodnoteDashboardDragStart,
    foodnoteDashboardDragOver,
    foodnoteDashboardDrop
  });
}
function initFoodnoteNotificationBadge() {
  exposeFoodnoteNotificationGlobals();
  ensureFoodnoteNotificationUI();
  bindFoodnoteNotificationClicks();
  renderFoodnoteNotificationBadge();
  setInterval(renderFoodnoteNotificationBadge, 60000);
}

init().then(() => { if (typeof initFoodnoteNotificationBadge === 'function') initFoodnoteNotificationBadge(); });
window.addEventListener('load', () => { if (typeof applyFeatureToggles === 'function') applyFeatureToggles(); });
