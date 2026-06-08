/*
 * FoodNote — diagnostics runtime
 * Rôle : Gérer les diagnostics runtime, le badge version et les contrôles non destructifs.
 * Ne doit pas gérer : l'apparence CSS, les calculs nutritionnels ou la persistance SQLite.
 */
(function(){
  'use strict';

  const VERSION = '0.22.179';
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  const LABEL = 'FoodNote beta 0.22.179';

  window.FOODNOTE_VERSION = VERSION;
  window.FOODNOTE_BUILD = BUILD;
  window.FOODNOTE_APP_LABEL = LABEL;

  function escapeHTML(v){
    return String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  function iconSvg(){
    return '<svg width="21" height="21" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="9" width="14" height="2.4" rx="1.2" fill="white"/><rect x="3" y="14" width="10" height="2" rx="1" fill="white" opacity="0.72"/><rect x="3" y="5" width="8" height="2" rx="1" fill="white" opacity="0.52"/></svg>';
  }
  function formatBytes(bytes){
    const n = Number(bytes || 0);
    if (!n) return '0 Mo';
    const mb = n / 1024 / 1024;
    if (mb >= 1) return (Math.round(mb * 10) / 10) + ' Mo';
    return Math.round(n / 1024) + ' Ko';
  }
  function line(ok, label, detail){
    const klass = ok === true ? 'fn-check-ok' : ok === false ? 'fn-check-bad' : 'fn-check-warn';
    const mark = ok === true ? '✓' : ok === false ? '✕' : '⚠';
    return `<div class="fn-checkline"><span class="${klass}">${mark}</span><span><strong>${escapeHTML(label)}</strong>${detail ? ' — <span style="color:var(--text3)">' + escapeHTML(detail) + '</span>' : ''}</span></div>`;
  }
  function setResult(html){
    const el = document.getElementById('fn-diagnostics-result');
    if (!el) return;
    el.innerHTML = html;
    el.classList.add('visible');
    el.style.display = 'block';
  }
  async function fetchJson(url, options){
    const r = await fetch(url, options || { cache:'no-store' });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text || '{}'); }
    catch (e) { throw new Error('Réponse non JSON sur ' + url + ' : ' + text.slice(0, 80).replace(/\s+/g, ' ')); }
    if (!r.ok || data.ok === false) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  }
  function showToast(msg, warn){
    if (typeof window.showSaveStatus === 'function') window.showSaveStatus(msg, !!warn);
    else console[warn ? 'warn' : 'log'](msg);
  }

  function addSidebarBadge(){
    const footer = document.querySelector('.sb-footer');
    if (!footer || document.getElementById('fn-sidebar-version')) return;
    const badge = document.createElement('div');
    badge.id = 'fn-sidebar-version';
    badge.className = 'fn-version-badge fn-sidebar-version';
    badge.title = 'Version réellement chargée côté navigateur';
    badge.textContent = LABEL;
    footer.insertBefore(badge, footer.firstChild);
  }

  function cardHTML(){
    return `
      <div class="card fn-ui-surface data-card fn-diagnostics-card" id="fn-diagnostics-card">
        <div class="fn-diagnostics-head">
          <div class="fn-diagnostics-logo-title">
            <div class="fn-diagnostics-logo">${iconSvg()}</div>
            <div>
              <div class="fn-diagnostics-title">${LABEL} · diagnostic</div>
              <div class="fn-diagnostics-sub">Version visible, recharge forcée mobile/WebView, diagnostic SQLite, checklist et base MQTT.</div>
            </div>
          </div>
          <div class="fn-version-badge" title="Build cache-busting">${BUILD}</div>
        </div>
        <div class="fn-diagnostics-actions">
          <button class="btn-primary" type="button" onclick="FoodNoteDiagnostics.forceReload()">↻ Forcer recharge app</button>
          <button type="button" onclick="FoodNoteDiagnostics.checkSQLiteBackup(true)">💾 Vérifier sauvegarde SQLite</button>
          <button type="button" onclick="FoodNoteDiagnostics.runDailyChecklist()">✅ Checklist parcours quotidien</button>
        </div>
        <div class="fn-diagnostics-result" id="fn-diagnostics-result"></div>
      </div>`;
  }
  function ensureCard(){
    const page = document.getElementById('page-donnees');
    if (!page || document.getElementById('fn-diagnostics-card')) return;
    const anchor = document.getElementById('donnees-status') || page.querySelector('.data-hero-card');
    if (anchor) anchor.insertAdjacentHTML('afterend', cardHTML());
    else page.insertAdjacentHTML('afterbegin', cardHTML());
  }
  function patchRenderDonnees(){
    if (window.__fnDiagnosticsRenderDonneesPatched) return;
    window.__fnDiagnosticsRenderDonneesPatched = true;
    const original = window.renderDonnees;
    if (typeof original === 'function') {
      window.renderDonnees = function(){
        const out = original.apply(this, arguments);
        setTimeout(ensureUI, 0);
        return out;
      };
    }
  }
  function patchNavigation(){
    if (window.__fnDiagnosticsShowPagePatched) return;
    window.__fnDiagnosticsShowPagePatched = true;
    const original = window.showPage;
    if (typeof original === 'function') {
      window.showPage = function(){
        const out = original.apply(this, arguments);
        setTimeout(ensureUI, 0);
        return out;
      };
    }
  }
  function patchSourceLabel(){
    if (window.__fnDiagnosticsSourceLabelPatched) return;
    const original = window.sourceLabel;
    if (typeof original === 'function') {
      window.__fnDiagnosticsSourceLabelPatched = true;
      window.sourceLabel = function(source){
        if (source === 'off') return 'OpenFoodFacts';
        return original.apply(this, arguments);
      };
    }
  }
  function ensureUI(){
    addSidebarBadge();
    ensureCard();
    patchRenderDonnees();
    patchNavigation();
    patchSourceLabel();
  }

  async function forceReload(){
    setResult(line(null, 'Recharge forcée demandée', 'nettoyage caches + rechargement avec build ' + BUILD));
    try {
      localStorage.setItem('foodnote_last_force_reload', new Date().toISOString());
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch(e) {
      console.warn('[FoodNote] Nettoyage cache incomplet:', e);
    }
    const url = new URL(window.location.href);
    url.searchParams.set('fnv', BUILD + '_' + Date.now());
    window.location.replace(url.toString());
  }

  async function checkSQLiteBackup(createBackup){
    ensureUI();
    const rows = [];
    try {
      const v = await fetchJson('/api/version?ts=' + encodeURIComponent(Date.now()), { cache:'no-store' });
      rows.push(line(v.version === VERSION, 'Version backend', `${v.label || v.name || 'FoodNote'} · ${v.version || '?'} · ${v.storage || '?'}`));
    } catch(e) { rows.push(line(false, 'Version backend', e.message)); }

    let status = null;
    try {
      status = await fetchJson('/api/data/status?ts=' + encodeURIComponent(Date.now()), { cache:'no-store' });
      const c = status.counts || {};
      const db = status.db || {};
      const backup = status.auto_backup?.latest;
      rows.push(line(!!db.exists, 'Base SQLite', `${db.file || 'data/foodnote.db'} · ${formatBytes(db.size)}${db.wal_exists ? ' · WAL actif' : ''}`));
      rows.push(line(true, 'Contenu SQLite', `${c.entries ?? 0} journées · ${c.entry_foods ?? 0} aliments journal · ${c.sports ?? 0} sports · ${c.foods ?? 0} aliments BDD`));
      rows.push(line(!!backup, 'Auto-backups existants', backup ? `${backup.name} · ${formatBytes(backup.size)} · ${status.auto_backup.count} fichier(s)` : 'aucun fichier encore créé'));
      if (status.last_write?.at) rows.push(line(true, 'Dernière écriture surveillée', `${new Date(status.last_write.at).toLocaleString('fr-FR')} · ${status.last_write.method || ''} ${status.last_write.path || ''}`));
    } catch(e) { rows.push(line(false, 'Statut SQLite', e.message)); }

    if (createBackup) {
      try {
        const b = await fetchJson('/api/data/backup', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ reason:'manual-data-check' }),
          cache:'no-store'
        });
        const r = b.result || {};
        rows.push(line(!!b.ok, 'Backup manuel test', `${r.name || 'créé'}${r.entries != null ? ' · ' + r.entries + ' journées vérifiées' : ''}`));
        if (typeof window.refreshAutoBackupStatus === 'function') window.refreshAutoBackupStatus(false);
      } catch(e) { rows.push(line(false, 'Backup manuel test', e.message)); }
    }

    setResult(rows.join('') + '<div style="margin-top:8px;color:var(--text4)">Le test écrit une sauvegarde SQLite dans <code>data/auto_backups</code> sans modifier tes journées.</div>');
  }

  function runDailyChecklist(){
    ensureUI();
    const checks = [];
    checks.push(line(!!document.getElementById('page-journal'), 'Saisie du jour', 'page présente'));
    checks.push(line(typeof window.addCustomAliment === 'function', 'Ajouter aliment', 'fonction détectée'));
    checks.push(line(typeof window.saveBDDRow === 'function' || typeof window.saveFoodsNativeNow === 'function', 'Modifier aliment', 'édition BDD détectée'));
    checks.push(line(typeof window.changeFoodMeal === 'function', 'Drag & drop / changement repas', 'fonction repas détectée'));
    checks.push(line(typeof window.saveSportOnlyNow === 'function' || !!document.getElementById('page-sport'), 'Sport', 'page ou sauvegarde sport détectée'));
    checks.push(line(typeof window.saveEntry === 'function' || typeof window.postEntryNative === 'function', 'Sauvegarde journée', 'fonction serveur détectée'));
    checks.push(line(!!document.getElementById('page-recap') || typeof window.renderRecap === 'function', 'Bilan fin de journée', 'page/fonction détectée'));
    checks.push(line(!!document.getElementById('page-historique') || typeof window.renderHistory === 'function', 'Historique', 'page/fonction détectée'));
    checks.push(line(!!document.getElementById('page-stats') || typeof window.renderStats === 'function' || typeof window.renderStatsUnified === 'function', 'Stats', 'page/fonction détectée'));
    checks.push(line(typeof window.refreshAutoBackupStatus === 'function' && typeof window.runAutoBackupNow === 'function', 'Backup auto', 'fonctions détectées'));
    checks.push(line(document.body.innerText.toLowerCase().includes('ocr') || typeof window.saveRecipeFoodToBDD === 'function', 'Recette OCR', 'UI/fonction détectée'));

    const manual = [
      '1. Ajouter un aliment puis vérifier qu’il reste après recharge.',
      '2. Modifier un aliment BDD puis vérifier Diagnostic sauvegarde.',
      '3. Changer le repas / drag & drop puis sauvegarder la journée.',
      '4. Ajouter du sport avec heures + kcal/h et vérifier le total.',
      '5. Faire le bilan, ouvrir Historique, puis Stats.',
      '6. Lancer Vérifier sauvegarde SQLite après recette OCR.'
    ];
    setResult('<div class="fn-check-grid">' + checks.join('') + '</div><div style="margin-top:10px;color:var(--text4)">' + manual.map(escapeHTML).join('<br>') + '</div>');
  }

  window.FoodNoteDiagnostics = {
    version: VERSION,
    build: BUILD,
    ensureUI,
    forceReload,
    checkSQLiteBackup,
    runDailyChecklist
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureUI);
  else ensureUI();
  setTimeout(ensureUI, 350);
  setTimeout(ensureUI, 1200);
})();
