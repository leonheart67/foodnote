// FoodNote beta 0.22.92 — Récap : tendance de phase + comparaison phase précédente
(function(){
  const DAY = 24 * 3600 * 1000;
  function n(v){ return Number(v) || 0; }
  function round(v){ return Math.round(n(v)); }
  function round1(v){ return Math.round(n(v) * 10) / 10; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, n(v))); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function parseISO(iso){
    const d = new Date(String(iso || todayISO()) + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? new Date(todayISO() + 'T12:00:00') : d;
  }
  function daysBetween(refIso, iso){
    return Math.floor((parseISO(refIso).getTime() - parseISO(iso).getTime()) / DAY);
  }
  function fmtDateFR(iso){
    if (!iso) return '—';
    const p = String(iso).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
  }
  function target(){
    const p = window.PROFIL || {};
    return {
      kcal: n(p.cibleKcal) || 2200,
      prot: n(p.cibleProt) || 120,
      gluc: n(p.cibleGluc) || 270,
      lip:  n(p.cibleLip)  || 70,
    };
  }
  function ui(){ return window.FoodNoteUI || null; }
  function esc(v){ return ui()?.esc ? ui().esc(v) : String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  let recapTrendView = 'recent';
  function trendView(){ return recapTrendView === 'long' ? 'long' : 'recent'; }
  function applyTrendView(view){
    recapTrendView = view === 'long' ? 'long' : 'recent';
    const root = document.getElementById('recap-trends');
    if (!root) return;
    root.dataset.activeTrend = recapTrendView;
    root.querySelectorAll('[data-recap-trend-tab]').forEach(btn => {
      const active = btn.dataset.recapTrendTab === recapTrendView;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });
    root.querySelectorAll('[data-recap-trend-panel]').forEach(panel => {
      const active = panel.dataset.recapTrendPanel === recapTrendView;
      panel.classList.toggle('active', active);
    });
  }
  window.setFoodnoteRecapTrendView = function setFoodnoteRecapTrendView(view){ applyTrendView(view); };
  function pct(value, targetValue){ return targetValue ? clamp(n(value) / n(targetValue) * 100, 0, 100) : 0; }
  function avg(arr){ return arr.length ? arr.reduce((s,v)=>s+n(v),0) / arr.length : 0; }
  function validEntries(entries){ return (entries || []).filter(e => e && e.macros && n(e.macros.kcal) > 0 && e.date); }
  function getAllEntries(){
    try {
      if (typeof getEntries === 'function') return (getEntries() || []).slice().sort((a,b)=>String(b.date || '').localeCompare(String(a.date || '')));
    } catch(e) {}
    return [];
  }
  function latestEntry(entries){ return validEntries(entries)[0] || entries[0] || null; }
  function windowEntries(entries, refIso, fromDay, toDay){
    return (entries || []).filter(e => {
      if (!e?.date) return false;
      const d = daysBetween(refIso, e.date);
      return d >= fromDay && d <= toDay;
    });
  }

  function addDaysISO(iso, days){
    const d = parseISO(iso);
    d.setDate(d.getDate() + Math.round(n(days)));
    return d.toISOString().slice(0,10);
  }
  function getProgramStartISO(entries, refIso){
    const valid = (entries || []).filter(e => e?.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    return valid[0]?.date || refIso || todayISO();
  }
  function getActivePhaseWindow(entries, refIso){
    const p = (typeof loadProfil === 'function' ? loadProfil() : (window.PROFIL || {})) || {};
    const phases = Array.isArray(p.phases)
      ? p.phases.map(ph => ({
          ...ph,
          weeks: Math.max(1, parseInt(ph?.weeks, 10) || 1),
          label: String(ph?.label || ph?.id || 'Phase')
        })).filter(Boolean)
      : [];
    const fallback = {
      available:false,
      startISO:addDaysISO(refIso, -27),
      endISO:refIso,
      previousStartISO:addDaysISO(refIso, -55),
      previousEndISO:addDaysISO(refIso, -28),
      label:'4 semaines',
      suffix:'4 semaines',
      phaseLabel:'',
      previousPhaseLabel:'période précédente',
      compareLabel:'vs période précédente',
      tabLabel:'Fond'
    };
    if (!phases.length) return fallback;

    const programStart = getProgramStartISO(entries, refIso);
    const weeksElapsed = Math.max(0, Math.floor((parseISO(refIso).getTime() - parseISO(programStart).getTime()) / (7 * DAY)));
    let activeIndex = phases.length - 1;
    let activeStartWeek = phases.slice(0, -1).reduce((sum, ph) => sum + ph.weeks, 0);
    let activeEndWeek = activeStartWeek + phases[activeIndex].weeks;
    let cumul = 0;
    for (let i = 0; i < phases.length; i++) {
      const weeks = phases[i].weeks;
      if (weeksElapsed < cumul + weeks) {
        activeIndex = i;
        activeStartWeek = cumul;
        activeEndWeek = cumul + weeks;
        break;
      }
      cumul += weeks;
    }

    const active = phases[activeIndex] || phases[0];
    const phaseStartISO = addDaysISO(programStart, activeStartWeek * 7);
    const phaseEndPlannedISO = addDaysISO(programStart, activeEndWeek * 7 - 1);
    const endISO = String(refIso || todayISO()) < phaseEndPlannedISO ? String(refIso || todayISO()) : phaseEndPlannedISO;
    const spanDays = Math.max(1, daysBetween(endISO, phaseStartISO) + 1);

    let previousStartISO;
    let previousEndISO;
    let previousPhaseLabel = 'période précédente';
    let compareLabel = 'vs période précédente';
    let previousIsPhase = false;

    if (activeIndex > 0) {
      const previous = phases[activeIndex - 1];
      const previousStartWeek = phases.slice(0, activeIndex - 1).reduce((sum, ph) => sum + ph.weeks, 0);
      const previousEndWeek = activeStartWeek;
      previousStartISO = addDaysISO(programStart, previousStartWeek * 7);
      previousEndISO = addDaysISO(programStart, previousEndWeek * 7 - 1);
      previousPhaseLabel = previous.label || 'phase précédente';
      compareLabel = `vs phase précédente · ${previousPhaseLabel}`;
      previousIsPhase = true;
    } else {
      previousEndISO = addDaysISO(phaseStartISO, -1);
      previousStartISO = addDaysISO(previousEndISO, -(spanDays - 1));
    }

    return {
      available:true,
      startISO:phaseStartISO,
      endISO,
      previousStartISO,
      previousEndISO,
      label:'Depuis début de phase',
      suffix:'phase en cours',
      phaseLabel:String(active?.label || active?.id || 'phase actuelle'),
      previousPhaseLabel,
      compareLabel,
      previousIsPhase,
      tabLabel:'Phase',
      spanDays,
      programStartISO:programStart
    };
  }
  function entriesBetweenISO(entries, startISO, endISO){
    const start = String(startISO || '0000-00-00');
    const end = String(endISO || todayISO());
    return (entries || []).filter(e => e?.date && String(e.date) >= start && String(e.date) <= end);
  }
  function aggregate(entries){
    const valid = validEntries(entries);
    const poidsEntries = (entries || []).filter(e => n(e?.poids) > 0);
    const sportsTotal = valid.reduce((s,e)=>s+n(e.depSport),0);
    return {
      count: valid.length,
      kcal: avg(valid.map(e => e.macros.kcal)),
      prot: avg(valid.map(e => e.macros.prot)),
      gluc: avg(valid.map(e => e.macros.gluc)),
      lip: avg(valid.map(e => e.macros.lip)),
      sport: avg(valid.map(e => e.depSport || 0)),
      net: avg(valid.map(e => n(e.macros.kcal) - n(e.depSport))),
      poids: avg(poidsEntries.map(e => e.poids)),
      poidsCount: poidsEntries.length,
      sportsTotal,
      kcalTotal: valid.reduce((s,e)=>s+n(e.macros.kcal),0),
    };
  }
  function signed(v, unit){
    const x = round(v);
    if (!x) return `stable`;
    return `${x > 0 ? '+' : ''}${x}${unit ? ' ' + unit : ''}`;
  }
  function trendTone(metric, current, previous, targetValue){
    if (!previous || !current) return 'neutral';
    const diff = current - previous;
    const base = targetValue || previous || 1;
    const ratio = Math.abs(diff) / Math.max(1, Math.abs(base));
    if (ratio < 0.04) return 'stable';
    if (metric === 'prot') return diff > 0 ? 'ok' : 'warn';
    if (metric === 'kcal' || metric === 'lip') return diff > 0 ? 'warn' : 'ok';
    return diff > 0 ? 'up' : 'down';
  }
  function statusText(tone){
    return {
      ok:'mieux', warn:'à surveiller', stable:'stable', neutral:'données limitées', up:'hausse', down:'baisse'
    }[tone] || '—';
  }
  function trendCard(opts){
    const tone = opts.tone || 'neutral';
    const progress = opts.target ? pct(opts.value, opts.target) : null;
    return `<div class="recap-trend-card is-${esc(tone)}">
      <div class="recap-trend-head"><span class="recap-trend-icon">${esc(opts.icon || '•')}</span><div><b>${esc(opts.label || '')}</b><small>${esc(opts.caption || '')}</small></div><em>${esc(statusText(tone))}</em></div>
      <div class="recap-trend-values"><strong>${esc(opts.valueText || '—')}</strong><span>${esc(opts.diffText || '')}</span></div>
      ${progress !== null ? `<div class="recap-trend-track"><i style="width:${progress}%"></i></div>` : ''}
      ${opts.note ? `<p>${esc(opts.note)}</p>` : ''}
    </div>`;
  }
  function trendSection(title, subtitle, current, previous, t, opts={}){
    const suffix = opts.suffix || '';
    const compareLabel = opts.compareLabel || 'vs période précédente';
    const key = opts.key === 'long' ? 'long' : 'recent';
    const isActive = key === trendView();
    const countText = current.count ? `${current.count} jour${current.count > 1 ? 's' : ''} renseigné${current.count > 1 ? 's' : ''}` : 'pas assez de données';
    if (current.count < 2) {
      return `<div class="recap-trend-column recap-trend-panel is-${esc(key)} ${isActive ? 'active' : ''}" data-recap-trend-panel="${esc(key)}"><div class="recap-trend-column-head"><b>${esc(title)}</b><span>${esc(countText)}</span></div><div class="recap-empty-note">${esc(subtitle)} : complète encore quelques journées pour obtenir une tendance fiable.</div></div>`;
    }
    const cards = [
      trendCard({icon:'🔥', label:'Calories', caption:countText, value:current.kcal, target:t.kcal, valueText:`${round(current.kcal)} kcal`, diffText:previous.count ? `${signed(current.kcal - previous.kcal, 'kcal')} ${compareLabel}` : 'première période fiable', tone:trendTone('kcal', current.kcal, previous.kcal, t.kcal), note:`cible ${t.kcal} kcal`}),
      trendCard({icon:'🍖', label:'Protéines', caption:'moyenne', value:current.prot, target:t.prot, valueText:`${round(current.prot)} g`, diffText:previous.count ? `${signed(current.prot - previous.prot, 'g')} ${compareLabel}` : 'première période fiable', tone:trendTone('prot', current.prot, previous.prot, t.prot), note:`repère ${t.prot} g`}),
      trendCard({icon:'🥑', label:'Lipides', caption:'moyenne', value:current.lip, target:t.lip, valueText:`${round(current.lip)} g`, diffText:previous.count ? `${signed(current.lip - previous.lip, 'g')} ${compareLabel}` : 'première période fiable', tone:trendTone('lip', current.lip, previous.lip, t.lip), note:`repère ${t.lip} g`}),
      trendCard({icon:'🚴', label:'Sport', caption:suffix || 'activité', valueText:`${round(current.sportsTotal)} kcal`, diffText:previous.count ? `${signed(current.sportsTotal - previous.sportsTotal, 'kcal')} ${compareLabel}` : 'première période fiable', tone:trendTone('sport', current.sportsTotal, previous.sportsTotal, 0), note:'dépense déclarée'}),
    ].join('');
    return `<div class="recap-trend-column recap-trend-panel is-${esc(key)} ${isActive ? 'active' : ''}" data-recap-trend-panel="${esc(key)}"><div class="recap-trend-column-head"><b>${esc(title)}</b><span>${esc(subtitle)}</span></div><div class="recap-trend-grid">${cards}</div></div>`;
  }
  function pageSkeleton(day){
    const UI = ui();
    if (!UI) return;
    const page = document.getElementById('page-recap');
    if (!page) return;
    const dateText = day?.date ? `Dernière journée : ${fmtDateFR(day.date)}` : fmtDateFR(todayISO());
    const wasActive = page.classList.contains('active');
    page.className = wasActive ? 'page active' : 'page';
    page.innerHTML = UI.page(
      UI.panel({
        icon:'✅',
        kicker:'Récap intelligent',
        title:'Mini bilan',
        subtitle:'Vue rapide de la dernière journée renseignée. Le détail dynamique vit plus bas.',
        actions:`<span class="fn-ui-chip" id="recap-date-label" data-iso="${esc(day?.date || todayISO())}">${esc(dateText)}</span><button type="button" id="recap-dashboard-edit-button" class="fn-ui-button" onclick="toggleFoodnoteDashboardEdit()">Modifier</button>`,
        children:`<div id="recap-metrics" class="fn-ui-metric-grid foodnote-smart-dashboard-grid foodnote-smart-dashboard-metrics"></div><div id="recap-dashboard-editor" class="foodnote-dashboard-editor-zone"></div>`
      })
      + UI.panel({
        icon:'📈',
        title:'Tendances',
        subtitle:'Deux lectures : court terme pour réagir, long terme pour comprendre le fond.',
        children:'<div id="recap-trends" class="recap-trends"></div>'
      })
      + UI.panel({
        icon:'💡',
        title:'Conseils & alertes',
        subtitle:'Priorités calculées avec tes données, sans remplacer ton jugement.',
        children:'<div id="recap-alerts" class="fn-ui-alert-list recap-advice-list"></div>'
      }),
      'fn-ui-recap-page'
    );
  }
  function renderTodayTiles(day){
    const UI = ui();
    const el = document.getElementById('recap-metrics');
    if (!UI || !el) return;
    if (typeof window.renderFoodnoteSmartDashboardMetrics === 'function') {
      window.renderFoodnoteSmartDashboardMetrics(el, {mode:'recap', editorTargetId:'recap-dashboard-editor'});
      return;
    }
    const t = target();
    if (!day || !day.macros) {
      el.innerHTML = UI.tile({children:'<div class="fn-ui-muted">Aucune journée complète à résumer pour l’instant.</div>'});
      return;
    }
    const m = day.macros;
    const net = n(m.kcal) - n(day.depSport);
    el.innerHTML = [
      UI.metric({icon:'🔥', label:'Calories', value:round(m.kcal), unit:'kcal', sub:`cible ${t.kcal} kcal`, tone:'kcal', progress:pct(m.kcal,t.kcal)}),
      UI.metric({icon:'⚖️', label:'Net après sport', value:round(net), unit:'kcal', sub:n(day.depSport) ? `sport -${round(day.depSport)} kcal` : 'aucun sport saisi', tone:'net', progress:pct(net,t.kcal)}),
      UI.metric({icon:'💪', label:'Protéines', value:round(m.prot), unit:'g', sub:`cible ${t.prot} g`, tone:'prot', progress:pct(m.prot,t.prot)}),
      UI.metric({icon:'🍞', label:'Glucides', value:round(m.gluc), unit:'g', sub:`cible ${t.gluc} g`, tone:'gluc', progress:pct(m.gluc,t.gluc)}),
      UI.metric({icon:'💧', label:'Lipides', value:round(m.lip), unit:'g', sub:`cible ${t.lip} g`, tone:'lip', progress:pct(m.lip,t.lip)}),
    ].join('');
  }
  function renderTrends(recentStats, previousRecentStats, longStats, previousLongStats, longMeta){
    const el = document.getElementById('recap-trends');
    if (!el) return;
    const t = target();
    const active = trendView();
    const lm = longMeta || {};
    const longSubtitle = lm.phaseLabel ? `${lm.label || 'Depuis début de phase'} · ${lm.phaseLabel}` : (lm.label || 'Depuis début de phase');
    const longSuffix = lm.suffix || 'phase en cours';
    const longTabLabel = lm.tabLabel || 'Phase';
    const longCompareLabel = lm.compareLabel || 'vs période précédente';
    el.dataset.activeTrend = active;
    el.innerHTML = `
      <div class="recap-trend-tabs" role="tablist" aria-label="Choisir la lecture des tendances">
        <button type="button" class="recap-trend-tab ${active === 'recent' ? 'active' : ''}" data-recap-trend-tab="recent" role="tab" aria-selected="${active === 'recent' ? 'true' : 'false'}" onclick="setFoodnoteRecapTrendView('recent')">Récent</button>
        <button type="button" class="recap-trend-tab ${active === 'long' ? 'active' : ''}" data-recap-trend-tab="long" role="tab" aria-selected="${active === 'long' ? 'true' : 'false'}" onclick="setFoodnoteRecapTrendView('long')">${esc(longTabLabel)}</button>
      </div>
      <div class="recap-trend-panels">
        ${trendSection('Tendance récente', '7 derniers jours', recentStats, previousRecentStats, t, {suffix:'7 jours', key:'recent'})}
        ${trendSection('Tendance de phase', longSubtitle, longStats, previousLongStats, t, {suffix:longSuffix, key:'long', compareLabel:longCompareLabel})}
      </div>
    `;
    applyTrendView(active);
  }
  function ratioText(ratio){
    if (!Number.isFinite(ratio) || ratio <= 0) return 'donnée absente';
    return `${Math.round(ratio * 100)}% du repère`;
  }
  function varianceAvg(values){
    const arr = (values || []).map(n).filter(v => v > 0);
    if (arr.length < 3) return 0;
    const m = avg(arr);
    if (!m) return 0;
    const variance = arr.reduce((s,v)=>s + Math.pow(v - m, 2), 0) / arr.length;
    return Math.sqrt(variance) / m;
  }
  function targetDays(entries, key, targetValue, low=.9, high=1.1){
    const list = validEntries(entries);
    if (!list.length || !targetValue) return {count:0,total:list.length,pct:0};
    const count = list.filter(e => {
      const val = key === 'kcalNet' ? n(e.macros.kcal) - n(e.depSport) : n(e.macros?.[key]);
      const r = val / targetValue;
      return r >= low && r <= high;
    }).length;
    return {count,total:list.length,pct:Math.round(count / list.length * 100)};
  }
  function phaseName(){
    try {
      if (window.foodnoteCurrentPhase?.label) return String(window.foodnoteCurrentPhase.label);
      if (window.currentPhase?.label) return String(window.currentPhase.label);
      const p = window.PROFIL || {};
      return p.phase || p.objectifMode || '';
    } catch(e) { return ''; }
  }
  function adviceToneRank(type){ return ({bad:4,warn:3,info:2,ok:1,neutral:0})[type] || 0; }
  function makeSignal(type, icon, title, text, action, evidence, weight){
    return {type:type || 'info', icon:icon || '•', title:title || '', text:text || '', action:action || '', evidence:evidence || '', weight:n(weight) || adviceToneRank(type)};
  }
  function buildAdviceSignals(day, recentStats, longStats, recentEntries, longEntries, previousRecentStats, previousLongStats){
    const t = target();
    const signals = [];
    const recentReliable = recentStats.count >= 3;
    const longReliable = longStats.count >= 10;
    const base = recentReliable ? recentStats : aggregate(day ? [day] : []);
    const rKcal = t.kcal ? n(base.kcal) / t.kcal : 0;
    const rProt = t.prot ? n(base.prot) / t.prot : 0;
    const rGluc = t.gluc ? n(base.gluc) / t.gluc : 0;
    const rLip = t.lip ? n(base.lip) / t.lip : 0;
    const kcalDays = targetDays(recentEntries, 'kcal', t.kcal, .9, 1.1);
    const protDays = targetDays(recentEntries, 'prot', t.prot, .92, 1.22);
    const kcalCv = varianceAvg(validEntries(recentEntries).map(e => e.macros.kcal));
    if (!day || !day.macros) {
      return [makeSignal('warn','📝','Pas encore de récap fiable','Ajoute quelques journées complètes pour que FoodNote puisse distinguer les vrais signaux du bruit.','Renseigner au moins 3 journées avec calories et macros.','0 journée exploitable',8)];
    }
    if (!recentReliable) {
      signals.push(makeSignal('info','📅','Base de données encore courte',`FoodNote lit ${recentStats.count} journée${recentStats.count > 1 ? 's' : ''} exploitable${recentStats.count > 1 ? 's' : ''} sur les 7 derniers jours. Les conseils restent donc prudents.`,`Continue quelques jours avant de tirer une conclusion forte.`,`${recentStats.count}/7 jours`,3));
    }
    if (rProt < .80) {
      signals.push(makeSignal('bad','🍖','Protéines trop basses',`La moyenne est à ${round(base.prot)} g pour un repère de ${t.prot} g.`,`Ajoute une source protéinée simple sur 1 à 2 repas plutôt que d’augmenter tout le repas.`,ratioText(rProt),10));
    } else if (rProt < .95) {
      signals.push(makeSignal('warn','🍖','Protéines à régulariser',`Tu es proche du repère, mais pas encore assez régulier.`,`Garde le même objectif, et sécurise une portion protéinée dans la journée.`,`${protDays.count}/${protDays.total || 7} jours dans la zone`,7));
    } else if (rProt > 1.35) {
      signals.push(makeSignal('info','🍖','Protéines largement couvertes',`La moyenne protéines est au-dessus du repère. Ce n’est pas forcément un problème, mais ça peut prendre de la place sur les calories.`,`Vérifie surtout que ça ne pousse pas les lipides ou les calories trop haut.`,ratioText(rProt),4));
    } else {
      signals.push(makeSignal('ok','🍖','Base protéines solide',`Le repère protéines est couvert de façon cohérente.`,`Garde cette régularité, c’est une bonne base pour la phase en cours.`,`${protDays.count}/${protDays.total || 7} jours dans la zone`,2));
    }
    if (rKcal > 1.25) {
      signals.push(makeSignal('bad','🔥','Calories nettement hautes',`La moyenne est à ${round(base.kcal)} kcal pour une cible de ${t.kcal} kcal.`,`Cherche d’abord les aliments denses répétés : sauces, huiles, snacks, portions très généreuses.`,ratioText(rKcal),9));
    } else if (rKcal > 1.10) {
      signals.push(makeSignal('warn','🔥','Calories un peu hautes',`La moyenne dépasse le cap sans être catastrophique.`,`Ne corrige pas brutalement : réduis surtout les petits surplus répétés.`,`${kcalDays.count}/${kcalDays.total || 7} jours dans la zone`,6));
    } else if (rKcal < .78) {
      signals.push(makeSignal('warn','🔥','Calories basses',`La moyenne est assez loin sous la cible.`,`À surveiller si la faim, l’énergie ou la récupération baissent.`,ratioText(rKcal),6));
    } else if (rKcal < .90) {
      signals.push(makeSignal('info','🔥','Calories légèrement basses',`Tu restes sous la cible, mais sans signal fort.`,`Reste attentif à la fatigue et à la régularité plutôt qu’à une journée isolée.`,ratioText(rKcal),3));
    } else {
      signals.push(makeSignal('ok','🔥','Calories proches du cap',`La moyenne reste dans une zone cohérente avec la cible actuelle.`,`Garde cette stabilité, elle rend les tendances plus lisibles.`,`${kcalDays.count}/${kcalDays.total || 7} jours dans la zone`,2));
    }
    if (rLip > 1.35) {
      signals.push(makeSignal('bad','🥑','Lipides trop hauts',`Les lipides prennent beaucoup de place dans le total.`,`Repère les sources très denses répétées et ajuste légèrement les portions.`,ratioText(rLip),8));
    } else if (rLip > 1.15) {
      signals.push(makeSignal('warn','🥑','Lipides à surveiller',`Les lipides sont un peu au-dessus du repère.`,`Privilégie un petit ajustement régulier plutôt qu’une restriction forte.`,ratioText(rLip),5));
    } else if (rLip < .55) {
      signals.push(makeSignal('info','🥑','Lipides très bas',`Les lipides semblent bas par rapport au repère.`,`À surveiller surtout si ça dure plusieurs jours.`,ratioText(rLip),3));
    }
    if (rGluc < .60 && rKcal < .92) {
      signals.push(makeSignal('info','🍞','Glucides bas avec calories basses',`Les glucides semblent contribuer au déficit calorique.`,`Si l’énergie baisse, réintroduis progressivement une source simple autour des repas ou du sport.`,ratioText(rGluc),3));
    }
    if (kcalCv > .22 && recentStats.count >= 4) {
      signals.push(makeSignal('warn','〰️','Calories irrégulières',`Les apports varient beaucoup d’un jour à l’autre.`,`Essaie de stabiliser 1 ou 2 repas repères avant de chercher la perfection.`,`variabilité ${Math.round(kcalCv * 100)}%`,5));
    }
    if (recentStats.sportsTotal > 0) {
      signals.push(makeSignal('ok','🚴','Sport pris en compte',`Le sport est intégré au bilan récent.`,`Continue à le renseigner pour garder un net plus juste.`,`${round(recentStats.sportsTotal)} kcal sur 7 jours`,2));
    } else {
      signals.push(makeSignal('info','🚴','Sport non renseigné',`Aucune dépense sport récente n’est enregistrée.`,`Si tu as fait une activité, l’ajouter rendra le net et les tendances plus fiables.`,`0 kcal sport`,2));
    }
    if (longReliable && recentReliable) {
      const drift = recentStats.kcal - longStats.kcal;
      if (Math.abs(drift) > t.kcal * .10) {
        signals.push(makeSignal('warn','📈','Court terme différent de la phase',`La tendance récente s’écarte de la tendance de phase (${window.foodnoteRecapLongTrendLabel || 'phase en cours'}) d’environ ${Math.abs(round(drift))} kcal.`,`Attends quelques jours avant de modifier le plan, sauf si cet écart est volontaire.`,`${drift > 0 ? '+' : ''}${round(drift)} kcal`,5));
      } else {
        signals.push(makeSignal('ok','📈','Tendance cohérente',`Le court terme reste proche de la tendance de phase.`,`C’est le meilleur contexte pour juger calmement les prochains ajustements.`,`écart ${Math.abs(round(drift))} kcal`,2));
      }
    }
    const phase = phaseName();
    if (phase) {
      signals.push(makeSignal('info','🎯','Conseil lié à la phase',`Le récap analyse les données, mais le cap reste défini par la phase “${phase}”.`,`Utilise ces alertes pour ajuster les habitudes, pas pour changer de stratégie tous les jours.`,phase,2));
    }
    return signals.sort((a,b) => (b.weight - a.weight) || (adviceToneRank(b.type) - adviceToneRank(a.type)));
  }
  function adviceCard(signal){
    const type = signal.type || 'info';
    return `<article class="recap-advice-card is-${esc(type)}">
      <div class="recap-advice-icon">${esc(signal.icon || '•')}</div>
      <div class="recap-advice-body">
        <div class="recap-advice-title"><b>${esc(signal.title || '')}</b>${signal.evidence ? `<span>${esc(signal.evidence)}</span>` : ''}</div>
        <p>${esc(signal.text || '')}</p>
        ${signal.action ? `<div class="recap-advice-action"><strong>Action simple</strong><em>${esc(signal.action)}</em></div>` : ''}
      </div>
    </article>`;
  }
  function emptyGroup(text){ return `<div class="recap-advice-empty">${esc(text)}</div>`; }
  function renderAdviceGroup(title, subtitle, cls, items, fallback){
    return `<section class="recap-advice-group ${esc(cls || '')}">
      <div class="recap-advice-group-head"><b>${esc(title)}</b><span>${esc(subtitle || '')}</span></div>
      <div class="recap-advice-group-list">${items.length ? items.map(adviceCard).join('') : emptyGroup(fallback || 'Rien à signaler pour le moment.')}</div>
    </section>`;
  }
  function renderAdvice(day, recentStats, longStats, recentEntries, longEntries, previousRecentStats, previousLongStats){
    const el = document.getElementById('recap-alerts');
    if (!el) return;
    const signals = buildAdviceSignals(day, recentStats, longStats, recentEntries, longEntries, previousRecentStats, previousLongStats);
    const issues = signals.filter(s => s.type === 'bad' || s.type === 'warn');
    const positives = signals.filter(s => s.type === 'ok');
    const infos = signals.filter(s => s.type === 'info' || s.type === 'neutral');
    const priority = issues[0] || positives[0] || infos[0] || makeSignal('info','📝','Pas encore de signal','Ajoute quelques journées pour obtenir un conseil fiable.','Renseigner les repas et le sport si besoin.','',1);
    const headlineTone = priority.type || 'info';
    const longLabel = window.foodnoteRecapLongTrendLabel || 'phase en cours';
    const dataLabel = `${recentStats.count} jour${recentStats.count > 1 ? 's' : ''} récent${recentStats.count > 1 ? 's' : ''} · ${longStats.count} jour${longStats.count > 1 ? 's' : ''} (${longLabel})`;
    el.innerHTML = `<div class="recap-advice-board is-${esc(headlineTone)}">
      <div class="recap-advice-summary">
        <div class="recap-advice-summary-icon">${esc(priority.icon || '💡')}</div>
        <div class="recap-advice-summary-body">
          <span>Priorité du moment</span>
          <strong>${esc(priority.title || 'Rien de critique')}</strong>
          <p>${esc(priority.action || priority.text || 'Continue à renseigner quelques journées pour fiabiliser le récap.')}</p>
        </div>
        <div class="recap-advice-summary-meta">${esc(dataLabel)}</div>
      </div>
      <div class="recap-advice-groups">
        ${renderAdviceGroup('À corriger / surveiller', 'signaux utiles', 'priority', issues.slice(0,3), 'Aucune alerte forte détectée.')}
        ${renderAdviceGroup('Bon points', 'à conserver', 'positive', positives.slice(0,2), 'Les bons points apparaîtront avec quelques données fiables.')}
        ${renderAdviceGroup('À garder en tête', 'contexte', 'context', infos.slice(0,3), 'Pas de contexte particulier.')}
      </div>
    </div>`;
  }
  window.renderRecap = function renderRecap(){
    const entries = getAllEntries();
    const day = entries.find(e => e.date === todayISO()) || latestEntry(entries);
    const ref = day?.date || todayISO();
    try { window.foodnoteLastRecapDayISO = ref; } catch(e) {}
    const recentEntries = windowEntries(entries, ref, 0, 6);
    const previousRecentEntries = windowEntries(entries, ref, 7, 13);
    const longMeta = getActivePhaseWindow(entries, ref);
    let longEntries = entriesBetweenISO(entries, longMeta.startISO, longMeta.endISO);
    let previousLongEntries = entriesBetweenISO(entries, longMeta.previousStartISO, longMeta.previousEndISO);
    if (longMeta.available && validEntries(longEntries).length < 2) {
      longEntries = windowEntries(entries, ref, 0, 27);
      previousLongEntries = windowEntries(entries, ref, 28, 55);
      longMeta.label = '4 semaines';
      longMeta.suffix = '4 semaines';
      longMeta.tabLabel = 'Fond';
      longMeta.compareLabel = 'vs période précédente';
      longMeta.available = false;
    }
    window.foodnoteRecapLongTrendLabel = longMeta.available && longMeta.phaseLabel ? `${longMeta.label} · ${longMeta.phaseLabel}` : longMeta.label;
    window.foodnoteRecapPhaseCompareLabel = longMeta.compareLabel || 'vs période précédente';
    const recentStats = aggregate(recentEntries);
    const previousRecentStats = aggregate(previousRecentEntries);
    const longStats = aggregate(longEntries);
    const previousLongStats = aggregate(previousLongEntries);
    pageSkeleton(day);
    renderTodayTiles(day);
    renderTrends(recentStats, previousRecentStats, longStats, previousLongStats, longMeta);
    renderAdvice(day, recentStats, longStats, recentEntries, longEntries, previousRecentStats, previousLongStats);
    try { if (typeof window.renderRecapDashboardBadges === 'function') window.renderRecapDashboardBadges(); } catch(e) {}
  };
})();
