/*
 * FoodNote — explorateur des bases alimentaires.
 * Rôle : afficher les listes Starter, CIQUAL et OpenFoodFacts dans Bases de données.
 * Gère : panneaux repliables, recherche par source, affichage paginé léger et états de disponibilité.
 * Ne doit pas gérer : import CIQUAL/OpenFoodFacts, écriture SQLite, ajout à la journée, ni logique nutritionnelle métier.
 */
(function FoodNoteDatabaseExplorerModule() {
  'use strict';

  const ROOT_ID = 'database-explorer-root';
  const STARTER_INITIAL_LIMIT = 60;
  const REMOTE_MIN_QUERY = 2;
  const SOURCE_CONFIG = {
    starter: {
      icon: '💾',
      title: 'Ingrédients de base',
      subtitle: 'Liste starter FoodNote, rapide et locale.',
      placeholder: 'Rechercher dans les aliments de base...',
      tag: 'Starter'
    },
    ciqual: {
      icon: '🌿',
      title: 'CIQUAL',
      subtitle: 'Recherche dans la base ANSES importée localement.',
      placeholder: 'Rechercher : riz, poulet, yaourt...',
      endpoint: '/api/ciqual/search',
      statusEndpoint: '/api/ciqual/status',
      tag: 'CIQUAL'
    },
    off: {
      icon: '🛒',
      title: 'OpenFoodFacts',
      subtitle: 'Recherche dans le cache produits local.',
      placeholder: 'Rechercher : skyr, céréales, marque...',
      endpoint: '/api/off/search',
      statusEndpoint: '/api/off/status',
      tag: 'OpenFoodFacts'
    }
  };

  const state = {
    starter: { query: '', showAll: false, total: 0, visible: 0 },
    ciqual: { query: '', loading: false, products: [], error: '', source: '', status: null, timer: null },
    off: { query: '', loading: false, products: [], error: '', source: '', status: null, timer: null },
    rendered: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function number(value) {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function round1(value) {
    const n = number(value);
    return Math.round(n * 10) / 10;
  }

  function foodName(food) {
    return String(food?.nom || food?.name || food?.product_name || 'Aliment').trim();
  }

  function foodGroup(food, source) {
    if (source === 'off') {
      const meta = [food?.marque || food?.brand || '', food?.code ? ('code ' + food.code) : ''].filter(Boolean);
      return meta.join(' · ') || 'Produit OpenFoodFacts';
    }
    if (source === 'ciqual') return food?.groupe || food?.group || 'Aliment CIQUAL';
    return food?.groupe || food?.cat || 'Aliment de base';
  }

  function foodMacros(food) {
    return {
      kcal: Math.round(number(food?.kcal100 ?? food?.kcal ?? food?.calories_100g)),
      prot: round1(food?.prot100 ?? food?.proteines100 ?? food?.proteins_100g ?? food?.protein100 ?? food?.prot),
      gluc: round1(food?.gluc100 ?? food?.glucides100 ?? food?.carbohydrates_100g ?? food?.carbs100 ?? food?.gluc),
      lip: round1(food?.lip100 ?? food?.lipides100 ?? food?.fat_100g ?? food?.fat100 ?? food?.lip)
    };
  }

  function macroHTML(food) {
    const m = foodMacros(food);
    return `
      <div class="fn-db-macros" aria-label="Valeurs pour 100 grammes">
        <span class="fn-db-macro fn-mini-badge fn-mini-badge-kcal">🔥 ${escapeHTML(m.kcal)} kcal</span>
        <span class="fn-db-macro fn-mini-badge fn-mini-badge-protein">🍖 ${escapeHTML(m.prot)}g</span>
        <span class="fn-db-macro fn-mini-badge fn-mini-badge-carbs">🍞 ${escapeHTML(m.gluc)}g</span>
        <span class="fn-db-macro fn-mini-badge fn-mini-badge-fat">🥑 ${escapeHTML(m.lip)}g</span>
      </div>`;
  }

  function resultRowHTML(food, source) {
    const cfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.starter;
    const warning = food?.ciqual_warning ? `<div class="fn-db-result-meta">⚠️ ${escapeHTML(food.ciqual_warning)}</div>` : '';
    return `
      <article class="fn-db-result-row" data-db-food-row="1">
        <div class="fn-db-result-main">
          <div class="fn-db-result-name">
            <span class="fn-db-source-tag">${escapeHTML(cfg.tag)}</span>
            <span>${escapeHTML(foodName(food))}</span>
          </div>
          <div class="fn-db-result-meta">${escapeHTML(foodGroup(food, source))} · valeurs /100g</div>
          ${warning}
        </div>
        ${macroHTML(food)}
      </article>`;
  }

  function infoHTML(message) {
    return `<div class="fn-db-note">${escapeHTML(message)}</div>`;
  }

  function emptyHTML(message) {
    return `<div class="fn-db-empty">${escapeHTML(message)}</div>`;
  }

  function errorHTML(message) {
    return `<div class="fn-db-error">${escapeHTML(message)}</div>`;
  }

  function getStarterFoods() {
    const direct = Array.isArray(window.FOODNOTE_STARTER_FOODS) ? window.FOODNOTE_STARTER_FOODS : [];
    if (direct.length) return direct.map(food => ({ ...food, source: 'starter', base: true }));

    try {
      if (typeof window.getBDD === 'function') {
        return (window.getBDD() || [])
          .filter(food => food && (food.source === 'starter' || food.base === true))
          .map(food => ({ ...food, source: food.source || 'starter', base: true }));
      }
    } catch (e) {}
    return [];
  }

  function starterMatches(food, query) {
    if (!query) return true;
    const hay = normalizeText([foodName(food), foodGroup(food, 'starter')].join(' '));
    return hay.includes(query);
  }

  function renderStarterResults() {
    const box = $('dbx-results-starter');
    const count = $('dbx-count-starter');
    const status = $('dbx-status-starter');
    if (!box) return;

    const query = normalizeText(state.starter.query);
    const foods = getStarterFoods().filter(food => starterMatches(food, query));
    const totalStarter = getStarterFoods().length;
    const visibleLimit = state.starter.showAll || query ? foods.length : STARTER_INITIAL_LIMIT;
    const visibleFoods = foods.slice(0, visibleLimit);

    state.starter.total = foods.length;
    state.starter.visible = visibleFoods.length;

    if (count) count.textContent = `${foods.length}/${totalStarter || foods.length} aliment(s)`;
    if (status) {
      status.textContent = query
        ? `${foods.length} résultat(s) dans la liste starter.`
        : `${totalStarter || foods.length} aliment(s) de démarrage. Affichage léger par défaut.`;
    }

    if (!totalStarter) {
      box.innerHTML = emptyHTML('Liste starter indisponible. Vérifie que 11-starter-foods.js est chargé.');
      return;
    }
    if (!foods.length) {
      box.innerHTML = emptyHTML('Aucun aliment starter ne correspond à cette recherche.');
      return;
    }

    const rows = visibleFoods.map(food => resultRowHTML(food, 'starter')).join('');
    const more = (!state.starter.showAll && !query && foods.length > visibleFoods.length)
      ? `<div class="fn-db-more-row"><button type="button" class="fn-ui-button" data-db-action="starter-show-all">Afficher les ${escapeHTML(foods.length)} aliments</button></div>`
      : '';
    box.innerHTML = rows + more;
  }

  function setRemoteStatus(source, message) {
    const status = $(`dbx-status-${source}`);
    if (status) status.textContent = message;
  }

  function renderRemoteResults(source) {
    const box = $(`dbx-results-${source}`);
    const count = $(`dbx-count-${source}`);
    const st = state[source];
    if (!box) return;

    if (count) {
      const statusCount = source === 'ciqual'
        ? number(st.status?.count)
        : number(st.status?.products ?? st.status?.count);
      const suffix = statusCount ? ` / ${statusCount} local` : '';
      count.textContent = `${st.products.length} résultat(s)${suffix}`;
    }

    const query = st.query.trim();
    if (!query || query.length < REMOTE_MIN_QUERY) {
      box.innerHTML = infoHTML(`Tape au moins ${REMOTE_MIN_QUERY} caractères pour chercher dans ${SOURCE_CONFIG[source].title}.`);
      setRemoteStatus(source, source === 'ciqual'
        ? statusLabelCiqual(st.status)
        : statusLabelOff(st.status));
      return;
    }

    if (st.loading) {
      box.innerHTML = infoHTML('Recherche en cours…');
      setRemoteStatus(source, 'Recherche locale en cours…');
      return;
    }

    if (st.error) {
      box.innerHTML = errorHTML(st.error);
      setRemoteStatus(source, 'Recherche indisponible.');
      return;
    }

    if (!st.products.length) {
      box.innerHTML = emptyHTML('Aucun résultat trouvé dans cette source locale.');
      setRemoteStatus(source, `0 résultat pour “${query}”.`);
      return;
    }

    setRemoteStatus(source, `${st.products.length} résultat(s) pour “${query}” · source ${st.source || 'locale'}.`);
    box.innerHTML = st.products.map(food => resultRowHTML(food, source)).join('');
  }

  function statusLabelCiqual(status) {
    if (!status) return 'Statut CIQUAL non vérifié.';
    if (status.running) return 'Opération CIQUAL en cours.';
    if (status.available) return `CIQUAL disponible · ${number(status.count)} aliment(s) · ${status.source || 'local'}.`;
    if (status.can_import) return 'XML CIQUAL présents, import possible.';
    return 'CIQUAL indisponible ou non importé.';
  }

  function statusLabelOff(status) {
    if (!status) return 'Statut OpenFoodFacts non vérifié.';
    if (status.available) return `OpenFoodFacts disponible · ${number(status.products ?? status.count)} produit(s).`;
    return 'OpenFoodFacts indisponible ou non importé.';
  }

  async function refreshRemoteStatus(source) {
    const cfg = SOURCE_CONFIG[source];
    if (!cfg || !cfg.statusEndpoint) return;
    try {
      const response = await fetch(cfg.statusEndpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      state[source].status = await response.json();
    } catch (error) {
      state[source].status = null;
      console.warn('[FoodNote] statut explorateur indisponible', source, error);
    }
    renderRemoteResults(source);
  }

  async function searchRemote(source) {
    const cfg = SOURCE_CONFIG[source];
    const st = state[source];
    const query = st.query.trim();
    if (!cfg || !cfg.endpoint) return;
    if (!query || query.length < REMOTE_MIN_QUERY) {
      st.loading = false;
      st.error = '';
      st.products = [];
      st.source = '';
      renderRemoteResults(source);
      return;
    }

    st.loading = true;
    st.error = '';
    renderRemoteResults(source);

    try {
      const url = `${cfg.endpoint}?q=${encodeURIComponent(query)}&limit=50&offset=0`;
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
      st.products = Array.isArray(data.products) ? data.products : (Array.isArray(data) ? data : []);
      st.source = data.source || 'local';
    } catch (error) {
      st.products = [];
      st.source = '';
      st.error = error.message || 'Recherche impossible';
    } finally {
      st.loading = false;
      renderRemoteResults(source);
    }
  }

  function clearSearch(source) {
    const input = $(`dbx-search-${source}`);
    if (input) input.value = '';
    if (source === 'starter') {
      state.starter.query = '';
      state.starter.showAll = false;
      renderStarterResults();
      return;
    }
    state[source].query = '';
    state[source].products = [];
    state[source].error = '';
    state[source].source = '';
    renderRemoteResults(source);
  }

  function sourcePanelHTML(source, open) {
    const cfg = SOURCE_CONFIG[source];
    return `
      <details class="fn-db-source" data-db-source="${escapeHTML(source)}" ${open ? 'open' : ''}>
        <summary>
          <span class="fn-db-source-title">
            <span class="fn-db-source-icon" aria-hidden="true">${escapeHTML(cfg.icon)}</span>
            <span><b>${escapeHTML(cfg.title)}</b><small>${escapeHTML(cfg.subtitle)}</small></span>
          </span>
          <span class="fn-db-source-meta">
            <span class="fn-db-count" id="dbx-count-${escapeHTML(source)}">—</span>
            <span class="fn-db-source-chevron" aria-hidden="true">⌄</span>
          </span>
        </summary>
        <div class="fn-db-body">
          <div class="fn-db-search-row">
            <label class="fn-db-search-field" for="dbx-search-${escapeHTML(source)}">
              <span>Recherche</span>
              <input id="dbx-search-${escapeHTML(source)}" type="search" autocomplete="off" placeholder="${escapeHTML(cfg.placeholder)}" data-db-search="${escapeHTML(source)}">
            </label>
            <button type="button" class="fn-ui-button fn-db-clear" data-db-action="clear" data-db-source="${escapeHTML(source)}">Effacer</button>
          </div>
          <div class="fn-db-status-line" id="dbx-status-${escapeHTML(source)}">Préparation…</div>
          <div class="fn-db-results" id="dbx-results-${escapeHTML(source)}"></div>
        </div>
      </details>`;
  }

  function shellHTML() {
    return `
      <div class="fn-db-explorer" aria-label="Explorateur des bases alimentaires">
        <div class="fn-db-explorer-intro">
          <div>
            <strong>Explorer les sources alimentaires</strong>
            <p>Les sources restent repliées par défaut. Elles partagent le même rendu ; seules les données et les appels API changent.</p>
          </div>
          <div class="fn-db-explorer-actions">
            <button type="button" class="fn-ui-button" data-db-action="refresh-status">↻ Actualiser statuts</button>
          </div>
        </div>
        ${sourcePanelHTML('starter', false)}
        ${sourcePanelHTML('ciqual', false)}
        ${sourcePanelHTML('off', false)}
        <div class="fn-db-footer-note">Lecture seule : cette page explore les sources. L’ajout à la journée reste dans la modale Alimentation, et l’import des bases reste dans les cartes CIQUAL/OpenFoodFacts.</div>
      </div>`;
  }

  function bindRootEvents(root) {
    root.addEventListener('input', event => {
      const input = event.target.closest('[data-db-search]');
      if (!input) return;
      const source = input.getAttribute('data-db-search');
      if (source === 'starter') {
        state.starter.query = input.value || '';
        renderStarterResults();
        return;
      }
      if (!state[source]) return;
      state[source].query = input.value || '';
      clearTimeout(state[source].timer);
      state[source].timer = setTimeout(() => searchRemote(source), 260);
      renderRemoteResults(source);
    });

    root.addEventListener('click', event => {
      const actionEl = event.target.closest('[data-db-action]');
      if (!actionEl) return;
      const action = actionEl.getAttribute('data-db-action');
      if (action === 'clear') {
        clearSearch(actionEl.getAttribute('data-db-source'));
        return;
      }
      if (action === 'starter-show-all') {
        state.starter.showAll = true;
        renderStarterResults();
        return;
      }
      if (action === 'refresh-status') {
        refreshStatuses();
      }
    });
  }

  function refreshStatuses() {
    refreshRemoteStatus('ciqual');
    refreshRemoteStatus('off');
    renderStarterResults();
  }

  function render() {
    const root = $(ROOT_ID);
    if (!root) return;
    if (!state.rendered) {
      root.innerHTML = shellHTML();
      bindRootEvents(root);
      state.rendered = true;
    }
    renderStarterResults();
    renderRemoteResults('ciqual');
    renderRemoteResults('off');
    refreshStatuses();
  }

  window.FoodNoteDatabaseExplorer = {
    render,
    refresh: render,
    refreshStatuses,
    search: searchRemote
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(render, 0);
  });
})();
