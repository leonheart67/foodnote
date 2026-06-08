/*
 * FoodNote beta 0.24.30 — Récap V2
 *
 * Rôle :
 * - Reconstruire la page Récap avec la base visuelle V2 commune à Objectif.
 * - Lire les journées existantes via getEntries(), sans modifier les données.
 * - Afficher un bilan clair : dernière journée, tendances 7 jours, conseils simples.
 * - Marquer sémantiquement les cartes d’indicateur par macro pour harmoniser les couleurs.
 * - Garder les indicateurs non nutritionnels sur une surface neutre commune.
 * - Conserver les mêmes données et hooks sans reprendre les anciens composants visuels instables.
 *
 * Ne doit pas gérer :
 * - La sauvegarde SQLite.
 * - La modification des repas.
 * - Les anciens badges compacts Récap.
 * - Les statistiques avancées de la page Stats.
 */
(function(){
  'use strict';

  const DAY = 86400000;

  function $(id){ return document.getElementById(id); }

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[c]));
  }

  function n(value, fallback = 0) {
    const x = Number(value);
    return Number.isFinite(x) ? x : fallback;
  }

  function round(value, digits = 0) {
    const factor = Math.pow(10, digits);
    return Math.round(n(value) * factor) / factor;
  }

  function pct(value, target) {
    const t = n(target);
    if (t <= 0) return 0;
    return Math.max(0, Math.min(140, Math.round((n(value) / t) * 100)));
  }

  function todayISO() {
    const fn = window.foodnoteLocalISODate;
    if (typeof fn === 'function') return fn();
    return new Date().toISOString().slice(0, 10);
  }

  function parseISO(iso) {
    const d = new Date(String(iso || todayISO()) + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? new Date(todayISO() + 'T12:00:00') : d;
  }

  function daysBetween(refIso, iso) {
    return Math.floor((parseISO(refIso).getTime() - parseISO(iso).getTime()) / DAY);
  }

  function fmtDateFR(iso) {
    if (!iso) return '—';
    const parts = String(iso).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(iso);
  }

  function profile() {
    try {
      if (typeof window.loadProfil === 'function') return window.loadProfil() || {};
    } catch(e) {}
    return window.PROFIL || {};
  }

  function targets() {
    const p = profile();
    return {
      kcal: n(p.cibleKcal, 2200),
      prot: n(p.cibleProt, 120),
      gluc: n(p.cibleGluc, 270),
      lip: n(p.cibleLip, 70)
    };
  }

  function macro(entry, key) {
    const m = entry && entry.macros ? entry.macros : {};
    const aliases = {
      kcal: ['kcal', 'calories'],
      prot: ['prot', 'proteines', 'protein'],
      gluc: ['gluc', 'glucides', 'carbs'],
      lip: ['lip', 'lipides', 'fat']
    }[key] || [key];

    for (const k of aliases) {
      const value = n(m[k], NaN);
      if (Number.isFinite(value)) return value;
    }
    for (const k of aliases) {
      const value = n(entry && entry[k], NaN);
      if (Number.isFinite(value)) return value;
    }
    return 0;
  }

  function sport(entry) {
    return n(entry && (entry.depSport ?? entry.sportKcal ?? entry.sport ?? entry.sportCalories), 0);
  }

  function weight(entry) {
    return n(entry && (entry.poids ?? entry.weight), 0);
  }

  function normalizeEntry(entry) {
    return {
      raw: entry,
      date: String(entry && entry.date || ''),
      kcal: macro(entry, 'kcal'),
      prot: macro(entry, 'prot'),
      gluc: macro(entry, 'gluc'),
      lip: macro(entry, 'lip'),
      sport: sport(entry),
      poids: weight(entry)
    };
  }

  function getEntriesSafe() {
    try {
      if (typeof window.getEntries === 'function') {
        return (window.getEntries() || [])
          .filter(Boolean)
          .map(normalizeEntry)
          .filter(e => e.date)
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      }
    } catch(e) {
      console.warn('[FoodNote Recap] getEntries indisponible', e);
    }
    return [];
  }

  function validEntries(entries) {
    return (entries || []).filter(e => n(e.kcal) > 0);
  }

  function latestEntry(entries) {
    return validEntries(entries)[0] || (entries || [])[0] || null;
  }

  function windowEntries(entries, refIso, fromDay, toDay) {
    return (entries || []).filter(e => {
      const d = daysBetween(refIso, e.date);
      return d >= fromDay && d <= toDay;
    });
  }

  function avg(values) {
    const clean = (values || []).map(n).filter(v => Number.isFinite(v));
    if (!clean.length) return 0;
    return clean.reduce((sum, v) => sum + v, 0) / clean.length;
  }

  function aggregate(entries) {
    const valid = validEntries(entries);
    const weights = valid.map(e => e.poids).filter(v => v > 0);
    return {
      count: valid.length,
      kcal: avg(valid.map(e => e.kcal)),
      prot: avg(valid.map(e => e.prot)),
      gluc: avg(valid.map(e => e.gluc)),
      lip: avg(valid.map(e => e.lip)),
      sport: avg(valid.map(e => e.sport)),
      net: avg(valid.map(e => e.kcal - e.sport)),
      poids: avg(weights),
      poidsCount: weights.length
    };
  }

  function deltaText(current, previous, unit) {
    if (!previous || Math.abs(previous) < 0.01) return '—';
    const diff = current - previous;
    if (Math.abs(diff) < 0.5) return 'stable';
    return `${diff > 0 ? '+' : ''}${round(diff)}${unit ? ' ' + unit : ''}`;
  }

  function toneForMacro(value, targetValue) {
    const p = pct(value, targetValue);
    if (p < 75) return 'low';
    if (p > 115) return 'high';
    return 'ok';
  }

  function metricHTML({icon, label, value, unit, sub, tone, progress, macro}) {
    const safeProgress = Math.max(0, Math.min(140, n(progress)));
    const macroAttr = macro ? ` data-macro="${esc(macro)}" data-role="macro"` : ' data-role="neutral"';
    const toneAttr = ` data-tone="${esc(tone || 'neutral')}"`;
    return `
      <article class="fn-v2-indicator-card fn-v2-macro-card"${macroAttr}${toneAttr}>
        <div class="fn-v2-indicator-icon" aria-hidden="true">${esc(icon)}</div>
        <div class="fn-v2-indicator-copy">
          <span class="fn-v2-indicator-label">${esc(label)}</span>
          <strong>${esc(value)}<em>${unit ? ' ' + esc(unit) : ''}</em></strong>
          <small>${esc(sub || '')}</small>
        </div>
        <div class="fn-v2-progress" aria-hidden="true"><i style="width:${safeProgress}%"></i></div>
      </article>`;
  }

  function trendHTML({title, value, unit, sub, icon, macro}) {
    const macroAttr = macro ? ` data-macro="${esc(macro)}" data-role="macro"` : ' data-role="neutral"';
    return `
      <article class="fn-v2-indicator-card fn-v2-trend-card"${macroAttr}>
        <div class="fn-v2-indicator-icon" aria-hidden="true">${esc(icon || '•')}</div>
        <div class="fn-v2-indicator-copy">
          <span class="fn-v2-indicator-label">${esc(title)}</span>
          <strong>${esc(value)}<em>${unit ? ' ' + esc(unit) : ''}</em></strong>
          <small>${esc(sub || '')}</small>
        </div>
      </article>`;
  }

  function adviceHTML(type, title, text) {
    return `
      <article class="fn-v2-advice-card" data-tone="${esc(type)}">
        <b>${esc(title)}</b>
        <p>${esc(text)}</p>
      </article>`;
  }

  function buildAdvice(day, week, target) {
    const items = [];

    if (!day || !day.kcal) {
      items.push(['info', 'Aucune journée complète', 'Renseigne une journée pour obtenir un vrai récap.']);
      return items;
    }

    const kcalPct = pct(day.kcal, target.kcal);
    const protPct = pct(day.prot, target.prot);

    if (kcalPct > 115) items.push(['warn', 'Calories hautes', 'La journée dépasse nettement l’objectif. Vérifie surtout les portions denses.']);
    else if (kcalPct < 75) items.push(['warn', 'Calories basses', 'La journée est très basse. Attention à ne pas descendre trop fort si tu veux garder le muscle.']);
    else items.push(['ok', 'Calories cohérentes', 'La journée reste proche de l’objectif prévu.']);

    if (protPct < 80) items.push(['warn', 'Protéines à renforcer', 'Les protéines sont sous la cible. Priorise une source protéinée au prochain repas.']);
    else items.push(['ok', 'Protéines correctes', 'L’apport protéique soutient mieux le maintien musculaire.']);

    if (week.count >= 3) {
      const net = round(week.net);
      items.push(['info', 'Tendance 7 jours', `Moyenne nette estimée : ${net} kcal/jour sur ${week.count} journée(s).`]);
    } else {
      items.push(['info', 'Tendance à fiabiliser', 'Il faut quelques journées de plus pour rendre les tendances vraiment utiles.']);
    }

    return items.slice(0, 4);
  }

  function skeletonHTML(day, weekCount) {
    const dateLabel = day && day.date ? fmtDateFR(day.date) : fmtDateFR(todayISO());
    return `
      <div class="fn-v2-page fn-v2-page-recap">
        <section class="fn-v2-panel fn-v2-hero">
          <div class="fn-v2-hero-main">
            <span aria-hidden="true" class="fn-v2-hero-icon">✅</span>
            <div>
              <span class="fn-v2-kicker">Bilan</span>
              <h1>Récap</h1>
              <p>Vue claire de la dernière journée, des écarts aux objectifs et de la tendance récente.</p>
            </div>
          </div>
          <div class="fn-v2-actions">
            <span class="fn-v2-pill">Dernière journée : ${esc(dateLabel)}</span>
            <span class="fn-v2-pill">${esc(weekCount)} j analysé(s)</span>
          </div>
        </section>

        <section class="fn-v2-panel fn-v2-panel-pad">
          <div class="fn-v2-section-head">
            <span aria-hidden="true">🍽️</span>
            <div><b>Journée résumée</b><small>Objectifs du profil</small></div>
          </div>
          <div class="fn-v2-indicator-grid fn-v2-grid-five" id="fn-recap-metrics"></div>
        </section>

        <section class="fn-v2-panel fn-v2-panel-pad">
          <div class="fn-v2-section-head">
            <span aria-hidden="true">📈</span>
            <div><b>Tendance récente</b><small>7 derniers jours renseignés autour de la référence</small></div>
          </div>
          <div class="fn-v2-indicator-grid fn-v2-trend-grid" id="fn-recap-trends"></div>
        </section>

        <section class="fn-v2-panel fn-v2-panel-pad">
          <div class="fn-v2-section-head">
            <span aria-hidden="true">💡</span>
            <div><b>Lecture rapide</b><small>Conseils simples, sans remplacer ton analyse</small></div>
          </div>
          <div class="fn-v2-advice-grid" id="fn-recap-advice"></div>
        </section>
      </div>`;
  }

  function renderEmpty(page) {
    page.innerHTML = `
      <div class="fn-v2-page fn-v2-page-recap">
        <section class="fn-v2-panel fn-v2-hero">
          <div class="fn-v2-hero-main">
            <span aria-hidden="true" class="fn-v2-hero-icon">✅</span>
            <div>
              <span class="fn-v2-kicker">Bilan</span>
              <h1>Récap</h1>
              <p>Aucune journée complète n’est disponible pour générer le bilan.</p>
            </div>
          </div>
        </section>
        <section class="fn-v2-panel fn-v2-panel-pad">
          <div class="fn-v2-muted">Ajoute une journée dans le Journal pour afficher calories, macros, tendance et conseils.</div>
        </section>
      </div>`;
  }

  function renderRecap() {
    const page = $('page-recap');
    if (!page) return;

    page.classList.add('fn-page');
    const entries = getEntriesSafe();
    const day = latestEntry(entries);

    if (!day) {
      renderEmpty(page);
      return;
    }

    const ref = day.date || todayISO();
    const weekEntries = windowEntries(entries, ref, 0, 6);
    const prevEntries = windowEntries(entries, ref, 7, 13);
    const week = aggregate(weekEntries);
    const prev = aggregate(prevEntries);
    const t = targets();

    page.innerHTML = skeletonHTML(day, week.count);

    const net = day.kcal - day.sport;
    const metrics = $('fn-recap-metrics');
    if (metrics) {
      metrics.innerHTML = [
        metricHTML({
          icon: '🔥',
          label: 'Calories',
          value: round(day.kcal),
          unit: 'kcal',
          sub: `objectif ${round(t.kcal)} kcal`,
          macro: 'kcal',
          tone: toneForMacro(day.kcal, t.kcal),
          progress: pct(day.kcal, t.kcal)
        }),
        metricHTML({
          icon: '⚖️',
          label: 'Net après sport',
          value: round(net),
          unit: 'kcal',
          sub: day.sport ? `sport ${round(day.sport)} kcal` : 'sans sport déclaré',
          macro: 'kcal',
          tone: toneForMacro(net, t.kcal),
          progress: pct(net, t.kcal)
        }),
        metricHTML({
          icon: '🍖',
          label: 'Protéines',
          value: round(day.prot),
          unit: 'g',
          sub: `objectif ${round(t.prot)} g`,
          macro: 'prot',
          tone: toneForMacro(day.prot, t.prot),
          progress: pct(day.prot, t.prot)
        }),
        metricHTML({
          icon: '🍞',
          label: 'Glucides',
          value: round(day.gluc),
          unit: 'g',
          sub: `objectif ${round(t.gluc)} g`,
          macro: 'gluc',
          tone: toneForMacro(day.gluc, t.gluc),
          progress: pct(day.gluc, t.gluc)
        }),
        metricHTML({
          icon: '🥑',
          label: 'Lipides',
          value: round(day.lip),
          unit: 'g',
          sub: `objectif ${round(t.lip)} g`,
          macro: 'lip',
          tone: toneForMacro(day.lip, t.lip),
          progress: pct(day.lip, t.lip)
        })
      ].join('');
    }

    const trends = $('fn-recap-trends');
    if (trends) {
      trends.innerHTML = [
        trendHTML({
          icon: '🔥',
          macro: 'kcal',
          title: 'Calories moyennes',
          value: round(week.kcal),
          unit: 'kcal',
          sub: `7 jours · ${deltaText(week.kcal, prev.kcal, 'kcal')} vs avant`
        }),
        trendHTML({
          icon: '⚖️',
          macro: 'kcal',
          title: 'Net moyen',
          value: round(week.net),
          unit: 'kcal',
          sub: `sport moyen ${round(week.sport)} kcal/j`
        }),
        trendHTML({
          icon: '🍖',
          macro: 'prot',
          title: 'Protéines moyennes',
          value: round(week.prot),
          unit: 'g',
          sub: `${deltaText(week.prot, prev.prot, 'g')} vs avant`
        }),
        trendHTML({
          icon: '⚙️',
          title: 'Données utilisées',
          value: week.count,
          unit: 'j',
          sub: week.count >= 3 ? 'tendance exploitable' : 'à fiabiliser'
        })
      ].join('');
    }

    const advice = $('fn-recap-advice');
    if (advice) {
      advice.innerHTML = buildAdvice(day, week, t)
        .map(item => adviceHTML(item[0], item[1], item[2]))
        .join('');
    }

    try { window.foodnoteLastRecapDayISO = ref; } catch(e) {}
  }

  window.renderRecap = renderRecap;

  document.addEventListener('DOMContentLoaded', () => {
    const page = $('page-recap');
    if (page && page.classList.contains('active')) renderRecap();
  });
})();
