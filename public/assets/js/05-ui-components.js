// FoodNote 0.21.6 — moteur UI interne léger
// Objectif : remplacer progressivement le HTML page par page par des composants communs.
// Aucun framework, aucun rendu serveur : FoodNote reste rapide et dynamique côté navigateur.
(function(){
  if (window.FoodNoteUI && window.FoodNoteUI.version) return;
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const cls = (...x) => x.filter(Boolean).join(' ');
  const safe = (html) => String(html ?? '');

  function icon(value, extra='') {
    return `<span class="${cls('fn-ui-icon', 'fn-icon', extra)}" aria-hidden="true">${esc(value || '•')}</span>`;
  }

  function page(content='', extra='') {
    return `<div class="${cls('fn-ui-page','fn-ui-stack','fn-page-body', extra)}">${safe(content)}</div>`;
  }

  function panel(opts={}) {
    const pad = opts.pad === false ? '' : 'fn-ui-panel-pad';
    const head = (opts.title || opts.subtitle || opts.kicker || opts.icon) ? `
      <div class="fn-ui-title-row">
        <div class="fn-ui-title-left">
          ${opts.icon ? icon(opts.icon) : ''}
          <div>${opts.kicker ? `<span class="fn-ui-kicker">${esc(opts.kicker)}</span>` : ''}${opts.title ? `<h1 class="fn-ui-title">${esc(opts.title)}</h1>` : ''}${opts.subtitle ? `<p class="fn-ui-sub">${esc(opts.subtitle)}</p>` : ''}</div>
        </div>
        ${opts.actions ? `<div class="fn-ui-actions">${safe(opts.actions)}</div>` : ''}
      </div>` : '';
    return `<section class="${cls('fn-ui-panel','fn-panel', pad, opts.className)}">${head}${opts.children ? safe(opts.children) : ''}</section>`;
  }

  function tile(opts={}) {
    return `<div class="${cls('fn-ui-tile','fn-widget', opts.pad === false ? '' : 'fn-ui-tile-pad', opts.className)}">${safe(opts.children)}</div>`;
  }

  function featureGrid(items=[]) {
    return `<div class="fn-ui-feature-grid fn-grid">${items.map(it => `<div class="fn-ui-feature fn-widget"><span class="fn-icon">${esc(it.icon || '•')}</span><div><b>${esc(it.title)}</b><small>${esc(it.text || '')}</small></div></div>`).join('')}</div>`;
  }

  function sectionHead(title, meta='') {
    return `<div class="fn-ui-section-head"><b>${esc(title)}</b>${meta ? `<em>${esc(meta)}</em>` : ''}</div>`;
  }

  function button(label, onclick='', opts={}) {
    const kind = opts.primary ? 'fn-ui-button-primary' : '';
    return `<button type="button" class="${cls('fn-ui-button','fn-btn', kind, opts.className)}" ${onclick ? `onclick="${esc(onclick)}"` : ''}>${esc(label)}</button>`;
  }

  function field(opts={}) {
    const tag = opts.type === 'select' ? 'select' : (opts.type === 'textarea' ? 'textarea' : 'input');
    let control = '';
    if (tag === 'select') {
      control = `<select class="fn-field" ${opts.onchange ? `onchange="${esc(opts.onchange)}"` : ''}>${(opts.options||[]).map(o => `<option value="${esc(o.value)}" ${o.selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (tag === 'textarea') {
      control = `<textarea class="fn-field" ${opts.oninput ? `oninput="${esc(opts.oninput)}"` : ''} placeholder="${esc(opts.placeholder || '')}">${esc(opts.value || '')}</textarea>`;
    } else {
      control = `<input class="fn-field" id="${esc(opts.id || '')}" type="${esc(opts.inputType || 'text')}" value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}" ${opts.oninput ? `oninput="${esc(opts.oninput)}"` : ''} ${opts.onchange ? `onchange="${esc(opts.onchange)}"` : ''}>`;
    }
    return `<label class="fn-ui-field fn-field-wrap">${esc(opts.label || '')}${control}</label>`;
  }

  function filterGrid(fields=[]) {
    return `<div class="fn-ui-filter-grid">${fields.join('')}</div>`;
  }

  function chip(label, tone='') {
    const macroClasses = {
      kcal: 'fn-mini-badge fn-mini-badge-kcal fn-ui-macro-kcal macro-kcal',
      prot: 'fn-mini-badge fn-mini-badge-protein fn-ui-macro-prot macro-prot',
      gluc: 'fn-mini-badge fn-mini-badge-carbs fn-ui-macro-gluc macro-gluc',
      lip: 'fn-mini-badge fn-mini-badge-fat fn-ui-macro-lip macro-lip'
    }[tone] || '';
    return `<span class="${cls('fn-ui-chip','fn-pill', tone ? `fn-ui-chip-${tone}` : '', macroClasses)}">${safe(label)}</span>`;
  }

  function macroChips(m={}) {
    const _i = {
      kcal:'<svg class="fn-chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2-3 0-7-1-8 0 3-1.8 4.7-3 6s-2 3.2-2 5a6 6 0 0 0 12 0c0-1.5-1-3.9-2-5-1.8 3-2.8 3-4 2z"/></svg>',
      prot:'<svg class="fn-chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3C8.7 3 6 8 6 12a6 6 0 0 0 12 0c0-4-2.7-9-6-9z"/></svg>',
      gluc:'<svg class="fn-chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V8"/><path d="M12 8c-1.6 0-2.7-1.3-2.7-3.2C9.3 3 12 2.5 12 2.5s2.7.5 2.7 2.3C14.7 6.7 13.6 8 12 8z"/><path d="M12 13c-1.6 0-2.8-1-2.8-2.6"/><path d="M12 13c1.6 0 2.8-1 2.8-2.6"/><path d="M12 17.5c-1.6 0-2.8-1-2.8-2.6"/><path d="M12 17.5c1.6 0 2.8-1 2.8-2.6"/></svg>',
      lip:'<svg class="fn-chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 4.5 5 7 5 9.5a5 5 0 0 1-10 0C7 10 9 7.5 12 3z"/></svg>'
    };
    const out = [];
    if (m.kcal != null) out.push(chip(`${_i.kcal} ${esc(m.kcal)} kcal`, 'kcal'));
    if (m.prot != null) out.push(chip(`${_i.prot} ${esc(m.prot)}g`, 'prot'));
    if (m.gluc != null) out.push(chip(`${_i.gluc} ${esc(m.gluc)}g`, 'gluc'));
    if (m.lip != null) out.push(chip(`${_i.lip} ${esc(m.lip)}g`, 'lip'));
    return out.join('');
  }

  function dayStrip(days=[], opts={}) {
    return `<div class="fn-ui-day-strip fn-carousel-zone">${days.map(d => `<button type="button" class="fn-ui-day-chip" title="${esc(d.title || '')}" ${d.onclick ? `onclick="${esc(d.onclick)}"` : ''}>
      <span class="fn-ui-day-date"><b>${esc(d.weekday || '')}</b><small>${esc(d.dateLabel || '')}</small></span>
      <span class="fn-ui-day-bars"><i style="height:${esc(d.kcalHeight || 10)}%"></i>${d.sportHeight ? `<i class="fn-ui-sport" style="height:${esc(d.sportHeight)}%"></i>` : ''}</span>
      <span class="fn-ui-day-values"><strong>${esc(d.kcal || 0)}</strong><small>kcal</small>${d.sport ? `<em>🚴 ${esc(d.sport)}</em>` : ''}</span>
    </button>`).join('')}</div>`;
  }

  function foodRow(opts={}) {
    return `<div class="fn-ui-row fn-row fn-ui-row--food fn-ui-food-row">
      <div class="fn-ui-food-check">✓</div>
      <div><div class="fn-ui-food-title">${esc(opts.name || 'Aliment')}</div><div class="fn-ui-food-macros">${safe(opts.macrosHtml || macroChips(opts.macros || {}))}</div></div>
      <div class="fn-ui-food-qty">${esc(opts.qty || '')}</div>
    </div>`;
  }

  function dayJournalCard(opts={}) {
    const recap = opts.recapHtml || '';
    const actions = (opts.actions || []).map(a => button(a.label, a.onclick)).join('');
    return `<details class="fn-ui-row fn-row fn-ui-row--history fn-ui-row--expandable fn-ui-day-card" id="${esc(opts.id || '')}">
      <summary class="fn-ui-day-head">
        <div class="fn-ui-day-title"><span>${esc(opts.icon || '📅')}</span><span>${esc(opts.title || '')}</span>${opts.sub ? `<small>${esc(opts.sub)}</small>` : ''}</div>
        <div class="fn-ui-day-right"><div class="fn-ui-day-recap">${safe(recap)}</div><div class="fn-ui-chevron">⌄</div></div>
      </summary>
      <div class="fn-ui-day-body">
        ${opts.note ? `<div class="fn-ui-muted">${esc(opts.note)}</div>` : ''}
        ${safe(opts.children || '')}
        ${actions ? `<div class="fn-ui-actions">${actions}</div>` : ''}
      </div>
    </details>`;
  }



  function metric(opts={}) {
    const tone = opts.tone ? ` fn-ui-metric-${esc(opts.tone)}` : '';
    const pct = opts.progress == null ? '' : `<div class="fn-ui-metric-track"><i style="width:${Math.max(0, Math.min(100, Number(opts.progress)||0))}%"></i></div>`;
    return `<div class="fn-ui-metric fn-metric${tone}">
      <div class="fn-ui-metric-top"><span>${esc(opts.icon || '•')}</span><small>${esc(opts.label || '')}</small></div>
      <strong>${esc(opts.value ?? '—')}<em>${esc(opts.unit || '')}</em></strong>
      ${opts.sub ? `<p>${esc(opts.sub)}</p>` : ''}
      ${pct}
    </div>`;
  }

  function alertCard(opts={}) {
    const tone = opts.type ? ` fn-ui-alert-${esc(opts.type)}` : '';
    // Une alerte/conseil est un statut lisible, pas une ligne de donnée répétée.
    // Elle garde donc son vocabulaire global fn-ui-alert / fn-ui-status-card, sans fn-ui-row.
    return `<div class="fn-ui-alert fn-widget fn-ui-status-card${tone}"><div class="fn-ui-alert-icon fn-icon">${esc(opts.icon || '•')}</div><div><b>${esc(opts.title || '')}</b><p>${esc(opts.text || '')}</p></div></div>`;
  }

  function smartBadge(opts={}, key='') {
    const pct = opts.progress === undefined ? null : Math.max(0, Math.min(100, Number(opts.progress)||0));
    const macroCls = opts.cls ? String(opts.cls).split(/\s+/).filter(Boolean).map(c => `fn-ui-${c}`).join(' ') : '';
    const kind = /macro-(kcal|prot|gluc|lip)/.test(opts.cls || '') ? 'fn-ui-smart-badge-mini' : 'fn-ui-smart-badge-insight';
    const action = opts.onclick ? ` onclick="${esc(opts.onclick)}" role="button" tabindex="0"` : '';
    const style = opts.phaseColor ? ` style="--phase-color:${esc(opts.phaseColor)}"` : '';
    return `<button type="button" class="fn-ui-smart-badge fn-btn fn-mini-badge ${kind} ${macroCls}" data-recap-badge-key="${esc(key)}"${action}${style}>
      <span class="fn-ui-smart-dot">${safe(opts.icon || '•')}</span>
      <span class="fn-ui-smart-body"><span class="fn-ui-smart-label">${esc(opts.label || '')}</span><strong>${esc(opts.value || '—')}</strong>${opts.sub ? `<small>${esc(opts.sub)}</small>` : ''}${pct !== null ? `<span class="fn-ui-smart-progress"><i style="width:${pct}%"></i></span>` : ''}</span>
      ${pct !== null && /macro-(kcal|prot|gluc|lip)/.test(opts.cls || '') ? `<span class="fn-ui-smart-ring" style="--p:${pct}%"><span>${Math.round(pct)}</span></span>` : ''}
    </button>`;
  }
  window.FoodNoteUI = { version:'0.22.179', esc, cls, page, panel, tile, featureGrid, sectionHead, button, field, filterGrid, chip, macroChips, dayStrip, foodRow, dayJournalCard, metric, alertCard, smartBadge };
})();
