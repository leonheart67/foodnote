// Stats unifiées FoodNote — mêmes tuiles en hebdo et mensuel
(function(){
  const DAY = 24 * 3600 * 1000;
  let currentStatsPanel = 'journalier';

  function n(v){ return Number(v) || 0; }
  function round(v){ return Math.round(n(v)); }
  function fmtDateShort(iso){
    if (!iso) return '—';
    const parts = String(iso).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso;
  }
  function fmtDateFR(iso){
    if (!iso) return '—';
    const p = String(iso).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
  }
  function mondayKey(dateStr){
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().slice(0,10);
  }
  function monthKey(dateStr){ return String(dateStr || '').slice(0,7); }
  function monthLabel(key){
    if (!key || key.length < 7) return '—';
    const [y,m] = key.split('-');
    return `${m}/${y}`;
  }
  function weekLabel(key){
    if (!key) return '—';
    const start = new Date(key + 'T12:00:00');
    const end = new Date(start.getTime() + 6 * DAY);
    return `${fmtDateShort(key)} → ${fmtDateShort(end.toISOString().slice(0,10))}`;
  }
  function target(){
    return {
      kcal: n(PROFIL?.cibleKcal) || 2200,
      prot: n(PROFIL?.cibleProt) || 120,
      gluc: n(PROFIL?.cibleGluc) || 270,
      lip:  n(PROFIL?.cibleLip)  || 70,
    };
  }
  function avg(arr){ return arr.length ? arr.reduce((s,v)=>s+n(v),0) / arr.length : 0; }
  function aggregate(entries, totalDays){
    const valid = (entries || []).filter(e => e && e.macros && n(e.macros.kcal) > 0);
    const poidsEntries = (entries || []).filter(e => n(e.poids) > 0);
    const sportEntries = (entries || []).filter(e => n(e.depSport) > 0);
    const kcal = avg(valid.map(e => e.macros.kcal));
    const prot = avg(valid.map(e => e.macros.prot));
    const gluc = avg(valid.map(e => e.macros.gluc));
    const lip  = avg(valid.map(e => e.macros.lip));
    const sport = avg(valid.map(e => e.depSport || 0));
    const net = avg(valid.map(e => n(e.macros.kcal) - n(e.depSport)));
    const poids = avg(poidsEntries.map(e => e.poids));
    return {
      count: valid.length,
      totalDays: totalDays || valid.length || 1,
      kcal, prot, gluc, lip, sport, net, poids,
      poidsCount: poidsEntries.length,
      sportCount: sportEntries.length,
      first: entries?.[0]?.date || '',
      last: entries?.[entries.length - 1]?.date || '',
    };
  }
  function groupEntries(entries, mode){
    const groups = {};
    (entries || []).forEach(e => {
      if (!e?.date) return;
      const key = mode === 'month' ? monthKey(e.date) : mondayKey(e.date);
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return Object.keys(groups).sort().map(key => {
      const list = groups[key].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const days = mode === 'month' ? new Date(Number(key.slice(0,4)), Number(key.slice(5,7)), 0).getDate() : 7;
      return { key, entries:list, stats:aggregate(list, days) };
    });
  }
  function statusClass(value, targetValue, type){
    if (!value) return 'warn';
    const r = value / targetValue;
    if (type === 'min') return r >= 1 ? 'ok' : r >= .85 ? 'warn' : 'bad';
    return r >= .90 && r <= 1.10 ? 'ok' : r >= .75 && r <= 1.25 ? 'warn' : 'bad';
  }
  function tileHTML({icon,label,value,unit,foot,cls,progress}){
    const p = progress == null ? '' : `<div class="stats-progress"><div style="width:${Math.max(0, Math.min(100, progress))}%"></div></div>`;
    const il = String(icon || '') + ' ' + String(label || '');
    const macroCls = /Protéines|🍖/.test(il) ? ' macro-prot' : (/Glucides|🍞|🍚/.test(il) ? ' macro-gluc' : (/Lipides|🥑/.test(il) ? ' macro-lip' : (/Calories|🔥/.test(il) && !/sport|Sport|Dépense|Série/.test(il) ? ' macro-kcal' : '')));
    return `<div class="stats-tile ${cls || ''}${macroCls}">
      <div class="stats-tile-top"><div><div class="stats-tile-label">${label}</div></div><div class="stats-tile-icon">${icon}</div></div>
      <div class="stats-tile-value">${value}<span class="stats-tile-unit">${unit || ''}</span></div>
      ${p}
      <div class="stats-tile-foot">${foot || ''}</div>
    </div>`;
  }
  function tilesForStats(s, mode){
    const t = target();
    const period = mode === 'month' ? `${s.count}/${s.totalDays} jours saisis` : `${s.count}/7 jours saisis`;
    const kcalCls = statusClass(s.kcal, t.kcal, 'range');
    const protCls = statusClass(s.prot, t.prot, 'min');
    const glucCls = statusClass(s.gluc, t.gluc, 'range');
    const lipCls  = statusClass(s.lip,  t.lip,  'range');
    return [
      {icon:'🔥', label:'Calories moy.', value:round(s.kcal), unit:'kcal', cls:kcalCls, foot:`cible ${t.kcal} kcal · ${period}`, progress:t.kcal ? s.kcal/t.kcal*100 : 0},
      {icon:'⚖️', label:'Net moyen', value:round(s.net), unit:'kcal', cls:statusClass(s.net, t.kcal, 'range'), foot:'après sport', progress:t.kcal ? s.net/t.kcal*100 : 0},
      {icon:'🍖', label:'Protéines', value:round(s.prot), unit:'g', cls:protCls, foot:`min ${t.prot}g`, progress:t.prot ? s.prot/t.prot*100 : 0},
      {icon:'🍞', label:'Glucides', value:round(s.gluc), unit:'g', cls:glucCls, foot:`cible ${t.gluc}g`, progress:t.gluc ? s.gluc/t.gluc*100 : 0},
      {icon:'🥑', label:'Lipides', value:round(s.lip), unit:'g', cls:lipCls, foot:`cible ${t.lip}g`, progress:t.lip ? s.lip/t.lip*100 : 0},
      {icon:'🚴', label:'Sport moy.', value:round(s.sport), unit:'kcal', cls:s.sport ? 'ok' : 'warn', foot:s.sportCount ? `${s.sportCount} jour(s) avec sport` : 'aucun sport saisi'},
      {icon:'📅', label:'Jours saisis', value:s.count, unit:'j', cls:s.count >= (mode === 'month' ? Math.min(20,s.totalDays*.7) : 5) ? 'ok' : 'warn', foot:period, progress:s.count/s.totalDays*100},
      {icon:'⚖️', label:'Poids moyen', value:s.poidsCount ? Math.round(s.poids*10)/10 : '—', unit:s.poidsCount ? 'kg' : '', cls:s.poidsCount ? 'ok' : 'warn', foot:s.poidsCount ? `${s.poidsCount} mesure(s)` : 'poids non saisi'},
    ];
  }
  function renderTileGrid(el, stats, mode){
    if (!el) return;
    el.className = 'stats-tile-grid';
    if (!stats || !stats.count) {
      el.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Pas assez de données pour cette période.</div>';
      return;
    }
    el.innerHTML = tilesForStats(stats, mode).map(tileHTML).join('');
  }
  function compareRowsHTML(groups, mode){
    if (!groups.length) return '<div class="empty-state">Pas assez de données.</div>';
    return groups.slice().reverse().map(g => {
      const label = mode === 'month' ? monthLabel(g.key) : weekLabel(g.key);
      const s = g.stats;
      return `<div class="fn-ui-row fn-ui-row--stat stats-month-row">
        <div class="stats-month-row-head">
          <div><div class="stats-month-row-title">${label}</div><div class="stats-month-row-meta">${s.count}/${s.totalDays} jours saisis</div></div>
          <span class="${statusClass(s.kcal, target().kcal, 'range') === 'ok' ? 'tag-ok' : 'tag-warn'}">${round(s.kcal)} kcal/j</span>
        </div>
        <div class="food-macro-line">
          <span>⚖️ net ${round(s.net)} kcal</span><span>🍖 ${round(s.prot)}g</span><span>🍞 ${round(s.gluc)}g</span><span>🥑 ${round(s.lip)}g</span><span>🚴 ${round(s.sport)} kcal</span><span>⚖️ ${s.poidsCount ? Math.round(s.poids*10)/10 + ' kg' : '—'}</span>
        </div>
      </div>`;
    }).join('');
  }
  // 0.22.84 — Moteur unique de graphiques interactifs Stats.
  // Source de vérité inchangée : on visualise les séries calculées existantes.
  const FoodNoteStatsCharts = (() => {
    const registry = new Map();
    let tooltip = null;

    function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
    function isDayKey(key){ return /^\d{4}-\d{2}-\d{2}$/.test(String(key || '')); }
    function modeShortKey(key){
      return key && String(key).length === 7 ? String(key).slice(5) + '/' + String(key).slice(2,4) : fmtDateShort(key);
    }
    function cssVar(name, fallback){
      try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch(e) { return fallback; }
    }
    function metricForCanvas(canvasId, label){
      const id = String(canvasId || '') + ' ' + String(label || '');
      if (/prot/i.test(id)) return { key:'prot', color:'--fn-badge-prot', fallback:'#5DCAA5', target:'prot', statusType:'min' };
      if (/gluc/i.test(id)) return { key:'gluc', color:'--fn-badge-gluc', fallback:'#EF9F27', target:'gluc', statusType:'range' };
      if (/lip/i.test(id)) return { key:'lip', color:'--fn-badge-lip', fallback:'#7F77DD', target:'lip', statusType:'range' };
      if (/sport/i.test(id)) return { key:'sport', color:'--fn-home-status-ok', fallback:'#639922', target:null, statusType:null };
      if (/poids/i.test(id)) return { key:'poids', color:'--fn-ui-blue', fallback:'#6F9FC1', target:null, statusType:null };
      if (/days|jours/i.test(id)) return { key:'days', color:'--green', fallback:'#4F7F5B', target:null, statusType:null };
      if (/net/i.test(id)) return { key:'net', color:'--fn-home-status-warn', fallback:'#BA7517', target:'kcal', statusType:'range' };
      return { key:'kcal', color:'--fn-macro-kcal', fallback:'#854F0B', target:'kcal', statusType:'range' };
    }
    function targetFor(metric){
      if (!metric || !metric.target) return null;
      const t = target();
      return Number(t[metric.target] || 0) || null;
    }
    function ensureTooltip(){
      if (tooltip && document.body.contains(tooltip)) return tooltip;
      tooltip = document.createElement('div');
      tooltip.className = 'fn-stats-chart-tooltip';
      tooltip.setAttribute('role', 'status');
      tooltip.setAttribute('aria-live', 'polite');
      tooltip.style.display = 'none';
      document.body.appendChild(tooltip);
      return tooltip;
    }
    function hideTooltip(){ if (tooltip) tooltip.style.display = 'none'; }
    function formatValue(value, unit){
      if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
      const v = Math.abs(Number(value)) >= 100 ? Math.round(Number(value)) : Math.round(Number(value) * 10) / 10;
      return `${v}${unit ? ' ' + unit : ''}`;
    }
    function moveTooltip(evt, point, chart){
      const el = ensureTooltip();
      const targetValue = targetFor(chart.metric);
      const delta = targetValue ? Number(point.value) - targetValue : null;
      const deltaText = delta === null ? '' : `<div class="fn-stats-chart-tooltip-delta">${delta >= 0 ? '+' : ''}${formatValue(delta, chart.unit)} vs objectif</div>`;
      el.innerHTML = `<strong>${chart.title || chart.label || 'Statistique'}</strong><span>${point.fullLabel || point.shortLabel}</span><b>${formatValue(point.value, chart.unit)}</b>${deltaText}`;
      el.style.display = 'block';
      const pad = 12;
      const x = clamp((evt.clientX || 0) + 14, pad, window.innerWidth - el.offsetWidth - pad);
      const y = clamp((evt.clientY || 0) - el.offsetHeight - 12, pad, window.innerHeight - el.offsetHeight - pad);
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }
    function nearestPoint(chart, evt){
      const rect = chart.canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      let best = null;
      chart.points.forEach(p => {
        const dx = p.x - x;
        const dy = p.y - y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (!best || dist < best.dist) best = { point:p, dist };
      });
      if (!best || best.dist > 34) return null;
      return best.point;
    }
    function periodLabel(key){
      const k = String(key || '');
      if (isDayKey(k)) return fmtDateFR(k);
      if (/^\d{4}-\d{2}$/.test(k)) return monthLabel(k);
      return weekLabel(k);
    }
    function openDay(key){
      if (!isDayKey(key)) return;
      const input = document.getElementById('f-date');
      if (input) {
        input.value = key;
        try { input.dispatchEvent(new Event('change', { bubbles:true })); } catch(e) {}
      }
      if (typeof showPage === 'function') showPage('journal');
      try { window.dispatchEvent(new CustomEvent('foodnote-stats-open-day', { detail:{ date:key } })); } catch(e) {}
    }
    function attach(canvas, chart){
      registry.set(canvas.id, chart);
      canvas.classList.add('fn-stats-chart-canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('tabindex', '0');
      canvas.setAttribute('aria-label', `${chart.title || chart.label || 'Graphique'} — ${chart.data.length} point(s)`);
      const tile = canvas.closest('.fn-ui-chart-tile');
      if (tile) {
        tile.classList.add('fn-stats-chart-tile');
        if (!tile.querySelector('.fn-stats-chart-summary')) {
          const summary = document.createElement('div');
          summary.className = 'fn-stats-chart-summary';
          canvas.insertAdjacentElement('afterend', summary);
        }
      }
      if (canvas.__foodnoteStatsHandlers) return;
      canvas.__foodnoteStatsHandlers = true;
      canvas.addEventListener('pointermove', evt => {
        const state = registry.get(canvas.id);
        if (!state) return;
        const point = nearestPoint(state, evt);
        state.activeKey = point ? point.key : null;
        draw(state);
        if (point) moveTooltip(evt, point, state); else hideTooltip();
      }, { passive:true });
      canvas.addEventListener('pointerleave', () => {
        const state = registry.get(canvas.id);
        if (state) { state.activeKey = null; draw(state); }
        hideTooltip();
      });
      canvas.addEventListener('click', evt => {
        const state = registry.get(canvas.id);
        if (!state) return;
        const point = nearestPoint(state, evt);
        if (point) openDay(point.key);
      });
      canvas.addEventListener('keydown', evt => {
        const state = registry.get(canvas.id);
        if (!state || !state.data.length) return;
        const idx = state.data.findIndex(d => d.key === state.activeKey);
        if (evt.key === 'ArrowRight' || evt.key === 'ArrowLeft') {
          evt.preventDefault();
          const next = evt.key === 'ArrowRight' ? Math.min(state.data.length - 1, Math.max(0, idx) + 1) : Math.max(0, idx < 0 ? state.data.length - 1 : idx - 1);
          state.activeKey = state.data[next].key;
          draw(state);
        }
        if (evt.key === 'Enter' && state.activeKey) openDay(state.activeKey);
      });
    }
    function summaryText(data, unit, metric){
      if (!data.length) return '';
      const vals = data.map(d => Number(d.value) || 0);
      const avgVal = avg(vals);
      const first = vals[0];
      const last = vals[vals.length - 1];
      const diff = last - first;
      const direction = Math.abs(diff) < 0.5 ? 'stable' : (diff > 0 ? 'en hausse' : 'en baisse');
      const t = targetFor(metric);
      let targetText = '';
      if (t) {
        const okDays = vals.filter(v => statusClass(v, t, metric.statusType || 'range') === 'ok').length;
        targetText = ` · objectif OK ${okDays}/${vals.length}`;
      }
      return `Moyenne ${formatValue(avgVal, unit)} · tendance ${direction}${targetText}`;
    }
    function draw(chart){
      const canvas = chart.canvas;
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(280, Math.round(rect.width || canvas.offsetWidth || 420));
      const cssH = Math.max(150, Math.round(rect.height || canvas.offsetHeight || 158));
      const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
      if (canvas.width !== Math.round(cssW*dpr) || canvas.height !== Math.round(cssH*dpr)) {
        canvas.width = Math.round(cssW*dpr);
        canvas.height = Math.round(cssH*dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,cssW,cssH);
      const data = chart.data;
      const metricColor = cssVar(chart.metric.color, chart.metric.fallback);
      const grid = cssVar('--fn-page-border', cssVar('--border2', 'rgba(0,0,0,.10)'));
      const text = cssVar('--text3', '#7a8078');
      const surface = cssVar('--bg', '#fff');
      const targetValue = targetFor(chart.metric);
      const vals = data.map(d => Number(d.value) || 0);
      const minCandidate = Math.min(...vals, targetValue || vals[0] || 0);
      const maxCandidate = Math.max(...vals, targetValue || vals[0] || 10);
      const spread = Math.max(1, maxCandidate - minCandidate);
      const min = Math.max(0, minCandidate - spread * .12);
      const max = maxCandidate + spread * .16;
      const pad = { l:36, r:18, t:18, b:30 };
      const cw = cssW - pad.l - pad.r;
      const ch = cssH - pad.t - pad.b;
      const xp = i => pad.l + (data.length === 1 ? cw/2 : i/(data.length-1)*cw);
      const yp = v => pad.t + (1 - ((Number(v || 0)-min)/(max-min || 1))) * ch;

      ctx.lineWidth = 1;
      ctx.strokeStyle = grid;
      ctx.globalAlpha = .8;
      for(let i=0;i<=3;i++){
        const y = pad.t + i*ch/3;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+cw, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (targetValue) {
        const ty = yp(targetValue);
        ctx.setLineDash([5,5]);
        ctx.strokeStyle = cssVar('--fn-ring-track', grid);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(pad.l, ty); ctx.lineTo(pad.l+cw, ty); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = text;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('objectif', pad.l+cw, Math.max(10, ty-5));
      }

      if (data.length > 1) {
        const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t+ch);
        grad.addColorStop(0, metricColor);
        grad.addColorStop(1, surface);
        ctx.beginPath();
        data.forEach((d,i)=> i ? ctx.lineTo(xp(i),yp(d.value)) : ctx.moveTo(xp(i),yp(d.value)));
        ctx.lineTo(xp(data.length-1), pad.t+ch);
        ctx.lineTo(xp(0), pad.t+ch);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.globalAlpha = .15;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = metricColor;
      ctx.lineWidth = 2.8;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (data.length > 1) {
        ctx.beginPath();
        data.forEach((d,i)=> i ? ctx.lineTo(xp(i),yp(d.value)) : ctx.moveTo(xp(i),yp(d.value)));
        ctx.stroke();
      }

      chart.points = data.map((d,i) => ({...d, x:xp(i), y:yp(d.value), shortLabel:modeShortKey(d.key), fullLabel:periodLabel(d.key)}));
      chart.points.forEach(p => {
        const active = p.key === chart.activeKey;
        ctx.beginPath();
        ctx.arc(p.x, p.y, active ? 5.8 : 3.2, 0, Math.PI*2);
        ctx.fillStyle = active ? surface : metricColor;
        ctx.fill();
        ctx.lineWidth = active ? 2.5 : 1.5;
        ctx.strokeStyle = metricColor;
        ctx.stroke();
      });

      ctx.fillStyle = text;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign='center';
      data.forEach((d,i)=>{ if(i===0 || i===data.length-1 || (data.length <= 12 && i%2===0)) ctx.fillText(modeShortKey(d.key), xp(i), cssH-9); });
      ctx.textAlign = 'left';
      ctx.fillText(formatValue(maxCandidate, chart.unit), 3, 13);
      const summary = canvas.closest('.fn-ui-chart-tile')?.querySelector('.fn-stats-chart-summary');
      if (summary) summary.textContent = summaryText(data, chart.unit, chart.metric);
    }
    function render(canvasId, groups, getter, label, unit, limit = 8){
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const tileTitle = canvas.closest('.fn-ui-chart-tile')?.querySelector('.fn-ui-chart-title')?.textContent?.trim() || label || 'Graphique';
      const data = (groups || []).slice(-limit)
        .map(g => ({ key:g.key, value:getter(g.stats), raw:g }))
        .filter(d => d.key && d.value !== null && d.value !== undefined && !Number.isNaN(Number(d.value)));
      let empty = document.getElementById(canvasId + '-empty');
      if (!data.length) {
        canvas.style.display = 'none';
        if (!empty) {
          empty = document.createElement('div');
          empty.id = canvasId + '-empty';
          empty.className = 'fn-stats-chart-empty';
          empty.textContent = 'Pas encore assez de données.';
          canvas.insertAdjacentElement('afterend', empty);
        }
        empty.style.display = 'block';
        return;
      }
      if (empty) empty.style.display = 'none';
      canvas.style.display = 'block';
      const chart = registry.get(canvasId) || { canvas, points:[], activeKey:null };
      chart.canvas = canvas;
      chart.data = data;
      chart.label = label;
      chart.title = tileTitle;
      chart.unit = unit || '';
      chart.metric = metricForCanvas(canvasId, label);
      attach(canvas, chart);
      draw(chart);
    }
    window.addEventListener('resize', () => {
      clearTimeout(window.__foodnoteStatsChartResizeTimer);
      window.__foodnoteStatsChartResizeTimer = setTimeout(() => registry.forEach(draw), 120);
    }, { passive:true });
    return { render, redrawAll:() => registry.forEach(draw), hideTooltip };
  })();

  function drawMiniChart(canvasId, groups, getter, label, unit, limit = 8){
    FoodNoteStatsCharts.render(canvasId, groups, getter, label, unit, limit);
  }
  function modeShortKey(key){
    return key && String(key).length === 7 ? String(key).slice(5) + '/' + String(key).slice(2,4) : fmtDateShort(key);
  }
  function drawPoidsChart(entries){
    const c = document.getElementById('chart-poids');
    const empty = document.getElementById('chart-poids-empty');
    if (!c) return;
    const data = (entries || []).filter(e => n(e.poids) > 0).slice(-60);
    if (data.length < 2) { c.style.display='none'; if(empty) empty.style.display='block'; return; }
    if(empty) empty.style.display='none'; c.style.display='block';
    const groups = data.map(e => ({key:e.date, stats:{poids:n(e.poids)}}));
    drawMiniChart('chart-poids', groups, s => s.poids, 'poids', 'kg');
  }
  function setStatsPanel(panel){
    currentStatsPanel = panel === 'mensuel' ? 'mensuel' : (panel === 'hebdo' ? 'hebdo' : 'journalier');
    ['journalier','hebdo','mensuel'].forEach(p => {
      document.getElementById('stats-panel-' + p)?.classList.toggle('active', p === currentStatsPanel);
      document.getElementById('stats-tab-' + p)?.classList.toggle('active', p === currentStatsPanel);
    });
  }
  window.setStatsPanel = setStatsPanel;

  function showStatsLoading() {
    ['stats-daily-summary','stats-daily-rows','stats-semaine','stats-month-dashboard','stats-week-compare','stats-month-compare'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="empty-state">Chargement des statistiques…</div>';
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) throw new Error(url + ' HTTP ' + res.status);
    if (!ct.includes('application/json')) throw new Error(url + ' ne renvoie pas du JSON');
    return await res.json();
  }

  function monthDaysFromStart(periodStart) {
    const key = String(periodStart || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) return 30;
    return new Date(Number(key.slice(0,4)), Number(key.slice(5,7)), 0).getDate();
  }

  function normalizeServerPeriod(p, mode) {
    if (!p) return null;
    const periodStart = String(p.period_start || '');
    return {
      key: mode === 'month' ? periodStart.slice(0,7) : periodStart.slice(0,10),
      label: p.label || '',
      entries: [],
      stats: {
        count: n(p.days_logged),
        totalDays: mode === 'month' ? monthDaysFromStart(periodStart) : 7,
        kcal: n(p.avg_kcal),
        net: n(p.avg_net_kcal),
        prot: n(p.avg_prot),
        gluc: n(p.avg_gluc),
        lip: n(p.avg_lip),
        sport: n(p.avg_dep_sport),
        poids: p.avg_poids == null ? 0 : n(p.avg_poids),
        poidsCount: p.avg_poids == null ? 0 : 1,
        sportCount: n(p.avg_dep_sport) > 0 ? n(p.days_logged) : 0,
        first: periodStart,
        last: periodStart,
      }
    };
  }

  function normalizeServerDaily(daily) {
    return (daily || []).map(d => ({
      date: d.date,
      poids: d.poids,
      depSport: n(d.dep_sport),
      netKcal: n(d.net_kcal),
      macros: { kcal: n(d.kcal), prot: n(d.prot), gluc: n(d.gluc), lip: n(d.lip) }
    })).filter(e => e.date);
  }

  function compareRowsHTMLServerAware(groups, mode) {
    if (!groups.length) return '<div class="empty-state">Pas assez de données.</div>';
    return groups.slice().reverse().map(g => {
      const label = g.label || (mode === 'month' ? monthLabel(g.key) : weekLabel(g.key));
      const s = g.stats;
      const ok = statusClass(s.kcal, target().kcal, 'range') === 'ok';
      return `<div class="fn-ui-row fn-ui-row--stat fn-ui-compare-row">
        <div class="fn-ui-compare-row-head">
          <div><div class="fn-ui-compare-title">${label}</div><div class="fn-ui-compare-meta">${s.count}/${s.totalDays} jours saisis</div></div>
          <span class="fn-ui-status-pill ${ok ? 'ok' : 'warn'}">${round(s.kcal)} kcal/j</span>
        </div>
        <div class="fn-ui-compare-macros">
          ${FoodNoteUI.macroChips({kcal: round(s.net), prot: round(s.prot), gluc: round(s.gluc), lip: round(s.lip)})}
          ${FoodNoteUI.chip(`🚴 ${round(s.sport)} kcal`, 'sport')}
          ${FoodNoteUI.chip(`⚖️ ${s.poidsCount ? Math.round(s.poids*10)/10 + ' kg' : '—'}`)}
        </div>
      </div>`;
    }).join('');
  }


  function entryStats(e) {
    const kcal = n(e?.macros?.kcal ?? e?.kcal);
    const sport = n(e?.depSport ?? e?.dep_sport);
    const net = n(e?.netKcal ?? e?.net_kcal ?? (kcal - sport));
    return {
      kcal,
      net,
      prot: n(e?.macros?.prot ?? e?.prot),
      gluc: n(e?.macros?.gluc ?? e?.gluc),
      lip: n(e?.macros?.lip ?? e?.lip),
      sport,
      poids: n(e?.poids),
    };
  }
  function dailyGroups(entries) {
    return (entries || [])
      .filter(e => e && e.date)
      .sort((a,b)=>String(a.date).localeCompare(String(b.date)))
      .map(e => ({ key:e.date, entries:[e], stats:entryStats(e) }));
  }
  function renderDailySummary(entries) { return; }
  function renderDailyRows(entries) {
    const el = document.getElementById('stats-daily-rows');
    if (!el) return;
    const groups = dailyGroups(entries).slice(-14).reverse();
    if (!groups.length) {
      el.innerHTML = '<div class="empty-state">Pas encore de jours saisis.</div>';
      return;
    }
    el.innerHTML = groups.map(g => {
      const s = g.stats;
      const ok = statusClass(s.kcal, target().kcal, 'range') === 'ok';
      return `<div class="fn-ui-row fn-ui-row--stat fn-ui-compare-row">
        <div class="fn-ui-compare-row-head">
          <div><div class="fn-ui-compare-title">${fmtDateFR(g.key)}</div><div class="fn-ui-compare-meta">détail du jour</div></div>
          <span class="fn-ui-status-pill ${ok ? 'ok' : 'warn'}">${round(s.kcal)} kcal</span>
        </div>
        <div class="fn-ui-compare-macros">
          ${FoodNoteUI.macroChips({kcal: round(s.net), prot: round(s.prot), gluc: round(s.gluc), lip: round(s.lip)})}
          ${FoodNoteUI.chip(`🚴 ${round(s.sport)} kcal`, 'sport')}
          ${FoodNoteUI.chip(`⚖️ ${s.poids ? Math.round(s.poids*10)/10 + ' kg' : '—'}`)}
        </div>
      </div>`;
    }).join('');
  }
  function renderDailyCharts(entries) {
    const groups = dailyGroups(entries);
    const chartDays = 31;
    drawMiniChart('chart-day-kcal', groups, s => s.kcal, 'kcal', 'kcal', chartDays);
    drawMiniChart('chart-day-net', groups, s => s.net, 'net', 'kcal', chartDays);
    drawMiniChart('chart-day-prot', groups, s => s.prot, 'prot', 'g', chartDays);
    drawMiniChart('chart-day-gluc', groups, s => s.gluc, 'gluc', 'g', chartDays);
    drawMiniChart('chart-day-lip', groups, s => s.lip, 'lip', 'g', chartDays);
    drawMiniChart('chart-day-sport', groups, s => s.sport, 'sport', 'kcal', chartDays);
    drawMiniChart('chart-day-poids', groups.filter(g => n(g.stats.poids) > 0), s => s.poids, 'poids', 'kg', chartDays);
    renderDailySummary(entries);
    renderDailyRows(entries);
  }

  function renderStatsModel(model, source) {
    const weekGroups = model.weekGroups || [];
    const monthGroups = model.monthGroups || [];
    const entries = model.entries || [];
    const latestWeek = model.latestWeek || weekGroups[weekGroups.length - 1];
    const latestMonth = model.latestMonth || monthGroups[monthGroups.length - 1];

    const weekLabelEl = document.getElementById('stats-current-week-label');
    if (weekLabelEl) {
      const label = latestWeek ? (latestWeek.label || weekLabel(latestWeek.key)) : '—';
      weekLabelEl.textContent = 'Semaine ' + label + (source === 'sqlite' ? ' · SQLite' : '');
    }
    renderTileGrid(document.getElementById('stats-dashboard-tiles'), latestWeek?.stats, 'week');
    renderTileGrid(document.getElementById('stats-semaine'), latestWeek?.stats, 'week');
    renderTileGrid(document.getElementById('stats-month-dashboard'), latestMonth?.stats, 'month');

    const wc = document.getElementById('stats-week-compare');
    if (wc) wc.innerHTML = compareRowsHTMLServerAware(weekGroups.slice(-8), 'week');
    const mc = document.getElementById('stats-month-compare');
    if (mc) mc.innerHTML = compareRowsHTMLServerAware(monthGroups.slice(-8), 'month');

    drawMiniChart('chart-week-kcal', weekGroups, s => s.kcal, 'kcal', 'kcal');
    drawMiniChart('chart-week-prot', weekGroups, s => s.prot, 'prot', 'g');
    drawMiniChart('chart-week-poids', weekGroups, s => s.poids, 'poids', 'kg');
    drawMiniChart('chart-week-days', weekGroups, s => s.count, 'jours', 'j');
    drawMiniChart('chart-macros', weekGroups, s => s.net, 'net', 'kcal');

    drawMiniChart('chart-month-kcal', monthGroups, s => s.kcal, 'kcal', 'kcal');
    drawMiniChart('chart-month-prot', monthGroups, s => s.prot, 'prot', 'g');
    drawMiniChart('chart-month-poids', monthGroups, s => s.poids, 'poids', 'kg');
    drawMiniChart('chart-month-days', monthGroups, s => s.count, 'jours', 'j');
    drawMiniChart('chart-month-net', monthGroups, s => s.net, 'net', 'kcal');
    drawPoidsChart(entries);
    renderDailyCharts(entries);
    setStatsPanel(currentStatsPanel);
  }

  function renderStatsFromLocal() {
    const entries = (typeof getEntries === 'function' ? getEntries() : []).filter(e => e.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const weekGroups = groupEntries(entries, 'week');
    const monthGroups = groupEntries(entries, 'month');
    renderStatsModel({
      entries,
      weekGroups,
      monthGroups,
      latestWeek: weekGroups[weekGroups.length - 1],
      latestMonth: monthGroups[monthGroups.length - 1],
    }, 'local');
  }

  async function renderStatsFromSQLite() {
    const [weekly, monthly] = await Promise.all([
      fetchJson('/api/stats/weekly'),
      fetchJson('/api/stats/monthly')
    ]);
    const weekGroups = (weekly.periods || []).map(p => normalizeServerPeriod(p, 'week')).filter(Boolean);
    const monthGroups = (monthly.periods || []).map(p => normalizeServerPeriod(p, 'month')).filter(Boolean);
    const daily = normalizeServerDaily(weekly.daily && weekly.daily.length ? weekly.daily : monthly.daily);
    renderStatsModel({
      entries: daily,
      weekGroups,
      monthGroups,
      latestWeek: normalizeServerPeriod(weekly.current, 'week') || weekGroups[weekGroups.length - 1],
      latestMonth: normalizeServerPeriod(monthly.current, 'month') || monthGroups[monthGroups.length - 1],
    }, 'sqlite');
  }

  window.renderStats = async function renderStatsUnified(){
    showStatsLoading();
    try {
      await renderStatsFromSQLite();
    } catch (err) {
      console.warn('[FoodNote] Stats SQLite indisponibles, fallback local:', err);
      renderStatsFromLocal();
    }
  };
})();
