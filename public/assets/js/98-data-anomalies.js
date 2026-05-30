/* FoodNote 0.18.1 — Centre d'anomalies données
   Signale les anciennes lignes incohérentes sans bloquer l'app. */
(function(){
  'use strict';

  const state = { loaded:false, loading:false, anomalies:[], counts:{}, lastError:'' };

  function esc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(s ?? ''));
    return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function fmtDate(iso) {
    if (!iso) return 'Date inconnue';
    if (typeof formatDate === 'function') return formatDate(iso);
    return String(iso);
  }
  async function readJson(resp, label) {
    let data = null;
    try { data = await resp.json(); } catch(_) {}
    if (!resp.ok || (data && data.ok === false)) throw new Error((data && data.error) || label || ('HTTP ' + resp.status));
    return data || {};
  }
  function injectStyles() {
    if (document.getElementById('foodnote-anomalies-style')) return;
    const st = document.createElement('style');
    st.id = 'foodnote-anomalies-style';
    st.textContent = `
      .fn-anomaly-banner{position:fixed;right:18px;bottom:86px;z-index:12500;max-width:min(420px,calc(100vw - 28px));background:var(--card);border:1px solid rgba(245,158,11,.45);box-shadow:0 18px 50px rgba(0,0,0,.28);border-radius:16px;padding:12px 13px;color:var(--text);display:flex;gap:10px;align-items:flex-start}
      .fn-anomaly-banner-icon{font-size:22px;line-height:1;margin-top:2px}.fn-anomaly-banner-title{font-weight:800;font-size:14px}.fn-anomaly-banner-sub{font-size:12px;color:var(--text3);margin-top:2px;line-height:1.35}.fn-anomaly-banner-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.fn-anomaly-banner-actions button{font-size:12px;padding:5px 10px;border-radius:999px}
      .fn-anomaly-list{display:flex;flex-direction:column;gap:8px}.fn-anomaly-row{border:1px solid var(--border2);background:var(--bg);border-radius:12px;padding:10px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start}.fn-anomaly-row.critical{border-color:rgba(226,75,74,.42)}.fn-anomaly-row.warning{border-color:rgba(245,158,11,.38)}.fn-anomaly-row.focus{outline:2px solid var(--orange);outline-offset:2px}.fn-anomaly-main{min-width:0}.fn-anomaly-title{font-weight:750;font-size:14px}.fn-anomaly-message{font-size:13px;color:var(--text3);margin-top:3px;line-height:1.35}.fn-anomaly-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;font-size:11px;color:var(--text4)}.fn-anomaly-chip{border:1px solid var(--border2);border-radius:999px;padding:2px 7px;background:var(--card)}.fn-anomaly-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.fn-anomaly-actions button{font-size:12px;padding:5px 9px;border-radius:8px}.fn-anomaly-empty{border:1px dashed var(--border2);border-radius:12px;padding:13px;color:var(--text3);font-size:13px;background:var(--bg)}
      @media(max-width:700px){.fn-anomaly-banner{left:12px;right:12px;bottom:76px}.fn-anomaly-row{grid-template-columns:1fr}.fn-anomaly-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(st);
  }
  function currentOpenCount() {
    return state.anomalies.filter(a => (a.status || 'open') === 'open').length || Number(state.counts.open || 0) || 0;
  }
  function renderBanner() {
    injectStyles();
    const count = currentOpenCount();
    let banner = document.getElementById('fn-anomaly-banner');
    if (!count) { if (banner) banner.remove(); return; }
    const first = state.anomalies[0];
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'fn-anomaly-banner';
      banner.className = 'fn-anomaly-banner';
      document.body.appendChild(banner);
    }
    banner.innerHTML = `
      <div class="fn-anomaly-banner-icon">⚠️</div>
      <div style="flex:1;min-width:0">
        <div class="fn-anomaly-banner-title">${count} incohérence${count>1?'s':''} détectée${count>1?'s':''}</div>
        <div class="fn-anomaly-banner-sub">${first ? esc(first.food_name || first.message) + ' — ' + esc(first.source_date || '') : 'Des lignes semblent incohérentes.'}</div>
        <div class="fn-anomaly-banner-actions">
          <button type="button" class="btn-primary" onclick="FoodNoteAnomalies.open(${first ? Number(first.id) : ''})">Voir dans Bases de données</button>
          <button type="button" onclick="FoodNoteAnomalies.dismissBanner()">Plus tard</button>
        </div>
      </div>`;
  }
  function renderCard() {
    injectStyles();
    const status = document.getElementById('anomalies-status-box');
    const box = document.getElementById('anomalies-list-box');
    const btn = document.getElementById('btn-anomalies-rescan');
    if (btn) btn.disabled = state.loading;
    if (!status || !box) return;
    if (state.loading) {
      status.innerHTML = '<span style="color:var(--text3)">⏳ Analyse des données...</span>';
      return;
    }
    if (state.lastError) {
      status.innerHTML = '<span style="color:var(--orange)">Anomalies indisponibles : ' + esc(state.lastError) + '</span>';
      box.innerHTML = '';
      return;
    }
    const count = currentOpenCount();
    if (!count) {
      status.innerHTML = '<span style="color:var(--green)">✓ Aucune anomalie ouverte</span> — données cohérentes ou anomalies déjà résolues/ignorées.';
      box.innerHTML = '<div class="fn-anomaly-empty">Aucune ligne suspecte à corriger pour le moment.</div>';
      return;
    }
    status.innerHTML = '<span style="color:var(--orange)">⚠ ' + count + ' anomalie' + (count>1?'s':'') + ' ouverte' + (count>1?'s':'') + '</span> — clique une ligne pour accéder à la source.';
    box.innerHTML = '<div class="fn-anomaly-list">' + state.anomalies.map(a => {
      const sev = a.severity === 'critical' ? 'critical' : 'warning';
      const det = a.detected_value || {};
      const value = det.kcal100_equiv ? ('≈ ' + det.kcal100_equiv + ' kcal/100g') : (det.grams ? ('≈ ' + det.grams + 'g') : '');
      return `<div class="fn-ui-row fn-ui-row--data fn-anomaly-row ${sev}" id="anomaly-row-${Number(a.id)}">
        <div class="fn-anomaly-main" onclick="FoodNoteAnomalies.focus(${Number(a.id)})" role="button" tabindex="0">
          <div class="fn-anomaly-title">${sev === 'critical' ? '🚨' : '⚠️'} ${esc(a.food_name || 'Aliment')}</div>
          <div class="fn-anomaly-message">${esc(a.message || 'Anomalie détectée')}</div>
          <div class="fn-anomaly-meta">
            <span class="fn-anomaly-chip">${esc(fmtDate(a.source_date))}</span>
            <span class="fn-anomaly-chip">${esc(a.source_table || 'source')}</span>
            ${value ? `<span class="fn-anomaly-chip">${esc(value)}</span>` : ''}
            ${a.food_index != null ? `<span class="fn-anomaly-chip">ligne ${esc(a.food_index)}</span>` : ''}
          </div>
        </div>
        <div class="fn-anomaly-actions">
          ${a.source_date ? `<button type="button" onclick="FoodNoteAnomalies.openJournal('${esc(a.source_date)}')">Corriger journée</button>` : ''}
          <button type="button" onclick="FoodNoteAnomalies.mark(${Number(a.id)}, 'ignored')">Ignorer</button>
          <button type="button" class="btn-primary" onclick="FoodNoteAnomalies.mark(${Number(a.id)}, 'resolved')">Marquer résolu</button>
        </div>
      </div>`;
    }).join('') + '</div>';
  }
  async function load(opts = {}) {
    state.loading = true; state.lastError = '';
    renderCard();
    try {
      const url = '/api/anomalies?status=open' + (opts.rescan ? '&rescan=1' : '');
      const data = await readJson(await fetch(url, { cache:'no-store' }), 'Anomalies');
      state.anomalies = Array.isArray(data.anomalies) ? data.anomalies : [];
      state.counts = data.counts || {};
      state.loaded = true;
    } catch(e) {
      state.lastError = e.message || String(e);
      state.anomalies = [];
    } finally {
      state.loading = false;
      renderCard();
      renderBanner();
    }
  }
  async function rescan() {
    state.loading = true; state.lastError = '';
    renderCard();
    try {
      const data = await readJson(await fetch('/api/anomalies/rescan?status=open', { method:'POST' }), 'Rescan anomalies');
      state.anomalies = Array.isArray(data.anomalies) ? data.anomalies : [];
      state.counts = data.counts || {};
      state.loaded = true;
    } catch(e) {
      state.lastError = e.message || String(e);
    } finally {
      state.loading = false;
      renderCard();
      renderBanner();
    }
  }
  async function mark(id, status) {
    try {
      await readJson(await fetch('/api/anomalies/' + encodeURIComponent(id) + '/status', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status})
      }), 'Statut anomalie');
      await load();
      if (typeof showSaveStatus === 'function') showSaveStatus(status === 'ignored' ? 'Anomalie ignorée' : 'Anomalie marquée résolue');
    } catch(e) {
      alert('Impossible de modifier l’anomalie : ' + e.message);
    }
  }
  function open(id) {
    if (typeof showPage === 'function') showPage('bases', document.getElementById('nav-bases'));
    if (!state.loaded) load({rescan:true}); else renderCard();
    setTimeout(() => focus(id || (state.anomalies[0] && state.anomalies[0].id)), 180);
  }
  function focus(id) {
    const target = id ? document.getElementById('anomaly-row-' + id) : document.getElementById('anomalies-card');
    const fallback = document.getElementById('anomalies-card');
    const el = target || fallback;
    if (!el) return;
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('focus');
    setTimeout(() => el.classList.remove('focus'), 1300);
  }
  function openJournal(date) {
    if (!date) return;
    if (typeof showPage === 'function') showPage('journal', document.getElementById('nav-journal'));
    setTimeout(() => {
      try {
        if (typeof selectJournalDate === 'function') selectJournalDate(date);
        else {
          const el = document.getElementById('f-date');
          if (el) el.value = date;
          if (typeof loadEntry === 'function') loadEntry(date);
        }
      } catch(e) { console.warn('[FoodNote anomalies] ouverture journée impossible', e); }
    }, 120);
  }
  function dismissBanner() {
    const b = document.getElementById('fn-anomaly-banner');
    if (b) b.remove();
  }
  function wrapShowPage() {
    if (window.__FoodNoteAnomaliesShowPageWrapped) return;
    const original = window.showPage;
    if (typeof original !== 'function') return;
    window.showPage = function(id, tab) {
      const ret = original.apply(this, arguments);
      if (id === 'bases') setTimeout(() => { if (!state.loaded) load(); else renderCard(); }, 80);
      return ret;
    };
    window.__FoodNoteAnomaliesShowPageWrapped = true;
  }

  window.FoodNoteAnomalies = { load, rescan, renderCard, open, focus, mark, openJournal, dismissBanner };
  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    wrapShowPage();
    setTimeout(() => load(), 2600);
  });
})();
