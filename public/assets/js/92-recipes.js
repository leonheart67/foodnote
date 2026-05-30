
/* FoodNote 0.18.1 — recettes : lisibilité ingrédients + bilan séparé
 * Une recette = aliment composé maison réutilisable dans le journal.
 * Sources ingrédients : Base locale, CIQUAL, OpenFoodFacts, IA/manuelle.
 */
(function(){
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  let recipes = [];
  let editingId = null;
  let ingredients = [];
  let recipePhoto = '';
  let importedRecipeMeta = { creation_source:'manual', is_ai_estimated:false, raw_scan_text:'', ai_estimation_json:'' };
  let ingredientSuggestions = [];
  let ingredientSearchTimer = null;
  let ingredientSearchSeq = 0;
  let lastIngredientSearchNorm = '';
  let ingredientSearchInFlight = false;
  let foodSearchRecipesEnabled = true;
  let foodSearchRecipeTimer = null;
  let recipeSearchAppendBusy = false;
  const recipeSearchCache = new Map();

  const $ = id => document.getElementById(id);
  const esc = (window.escapeHtml || (s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))));
  const norm = (window.normalizeSearchText || (s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()));
  const round1 = v => Math.round((Number(v) || 0) * 10) / 10;
  const kcal = v => Math.round(Number(v) || 0);
  const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const sourceName = src => src === 'ciq' ? 'CIQUAL' : src === 'off' ? 'OpenFoodFacts' : src === 'recipe' ? 'Recette' : src === 'ia' ? 'IA' : 'Base';
  const sourceClass = src => 'source-' + String(src || 'base').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const sourceIcon = src => src === 'ciq' ? '🧪' : src === 'off' ? '🏷️' : src === 'ia' ? '⚡' : src === 'manual' ? '✍️' : '🗂️';

  function apiUserHeaders(extra = {}) {
    const h = { ...extra };
    try {
      const u = localStorage.getItem('foodnote_user_id') || localStorage.getItem('foodnote_current_user') || '';
      if (u) h['x-foodnote-user'] = u;
    } catch(e) {}
    return h;
  }
  async function apiJson(url, options = {}) {
    const res = await fetch(url, { ...options, headers: apiUserHeaders(options.headers || {}) });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch(e) { throw new Error('Réponse serveur non JSON : ' + text.slice(0, 80)); }
    if (!res.ok || data.ok === false) throw new Error(data.error || data.message || ('HTTP ' + res.status));
    return data;
  }

  function injectStyles() {
    if ($('fn-recipes-style')) return;
    const st = document.createElement('style');
    st.id = 'fn-recipes-style';
    st.textContent = `
      #page-recettes{max-width:1120px;width:100%;box-sizing:border-box;overflow-x:hidden}#page-recettes *{box-sizing:border-box}
      .recipe-page-hero{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:14px;padding:16px;border-radius:22px;background:linear-gradient(135deg,var(--bg2),var(--bg3));border:1px solid var(--border2);max-width:100%}
      .recipe-hero-title{font-size:22px;font-weight:850;color:var(--text)}.recipe-hero-sub{font-size:13px;color:var(--text3);margin-top:4px;max-width:720px}.recipe-badge{border:1px solid var(--border2);border-radius:999px;padding:6px 10px;font-size:12px;color:var(--text3);white-space:nowrap}
      .recipe-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.75fr);gap:14px;max-width:100%}.recipe-form-grid{display:grid;grid-template-columns:1.2fr .45fr .55fr;gap:10px}.recipe-form-grid input,.recipe-form-grid textarea,.recipe-search-line input,.recipe-ingredient-row input{width:100%;min-width:0}
      .recipe-photo-row{display:grid;grid-template-columns:86px minmax(0,1fr);gap:12px;align-items:center}.recipe-photo-preview{width:86px;height:86px;border-radius:18px;background:var(--bg);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--text4);font-size:28px}.recipe-photo-preview img{width:100%;height:100%;object-fit:cover}
      .recipe-search-line{display:grid;grid-template-columns:minmax(0,1fr) 92px auto;gap:8px;align-items:end}.recipe-suggestions{display:grid;gap:6px;margin-top:8px}.recipe-suggestion{border:1px solid var(--border2);border-radius:14px;padding:9px;background:var(--bg2);cursor:pointer}.recipe-suggestion:hover{border-color:var(--orange)}.recipe-suggestion-top{display:flex;justify-content:space-between;gap:8px;font-weight:750}.recipe-source{font-size:10px;border-radius:999px;border:1px solid var(--border2);padding:2px 7px;color:var(--text3);white-space:nowrap}.recipe-source.ciq{color:#80b7ff}.recipe-source.off{color:#6ee7b7}.recipe-source.recipe{color:#fbbf24}.recipe-source.ia{color:#c4b5fd}
      .recipe-ingredients{display:grid;gap:8px;margin-top:12px;max-width:100%;overflow:hidden}.recipe-ingredient-row{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:end;border:1px solid var(--border2);background:var(--bg2);border-radius:14px;padding:9px;max-width:100%;overflow:hidden}.recipe-ing-main{grid-column:1 / -1;min-width:0}.recipe-ing-main input{font-weight:700}.recipe-ing-fields{display:grid;grid-template-columns:86px 64px 78px 68px 68px 68px;gap:6px;min-width:0}.recipe-ing-field{min-width:0}.recipe-ing-field span{display:block;font-size:10px;color:var(--text4);margin:0 0 3px 2px;white-space:nowrap}.recipe-ingredient-row input{font-size:12px;padding:7px}.recipe-ingredient-row .mini{font-size:11px;color:var(--text4);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.recipe-ing-remove{width:34px;height:34px;padding:0;align-self:end}
      .recipe-totals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px;max-width:100%}.recipe-total{border:1px solid var(--border2);border-radius:14px;padding:10px;background:var(--bg2);min-width:0}.recipe-total b{display:block;font-size:18px}.recipe-total span{font-size:11px;color:var(--text4)}
      .recipe-nutri-100g{margin-top:10px;padding:11px;border:1px solid var(--border2);border-radius:18px;background:color-mix(in srgb,var(--bg2) 86%,transparent);max-width:100%}.recipe-nutri-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:9px;color:var(--text3);font-size:12px}.recipe-nutri-head strong{color:var(--text);font-size:13px}.recipe-nutri-100g-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.recipe-nutri-card{border:1px solid color-mix(in srgb,var(--macro-color,var(--border2)) 26%,var(--border2));background:color-mix(in srgb,var(--macro-color,var(--bg2)) 8%,var(--bg2));border-radius:15px;padding:9px;min-width:0}.recipe-nutri-top{display:flex;align-items:center;gap:6px;color:color-mix(in srgb,var(--macro-color,var(--text3)) 86%,var(--text));font-size:11px;font-weight:850}.recipe-nutri-icon{width:22px;height:22px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--macro-color,var(--bg2)) 16%,var(--bg2));border:1px solid color-mix(in srgb,var(--macro-color,var(--border2)) 24%,var(--border2))}.recipe-nutri-card b{display:block;margin-top:7px;font-size:19px;color:color-mix(in srgb,var(--macro-color,var(--text)) 84%,var(--text));line-height:1}.recipe-nutri-card small{display:block;margin-top:3px;color:var(--text4);font-size:10px}.recipe-card-macros{margin-top:6px}.recipe-card-macros span{font-size:11px}
      .recipe-list{display:grid;gap:10px}.recipe-card{display:grid;grid-template-columns:68px minmax(0,1fr);gap:12px;border:1px solid var(--border2);background:var(--bg2);border-radius:18px;padding:10px}.recipe-card-img{width:68px;height:68px;border-radius:16px;background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--text4);font-size:24px}.recipe-card-img img{width:100%;height:100%;object-fit:cover}.recipe-card-title{font-weight:850;color:var(--text);font-size:15px}.recipe-card-sub{font-size:12px;color:var(--text3);margin-top:2px}.recipe-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.recipe-card-actions button{font-size:12px;padding:5px 9px}
      .recipe-status{font-size:12px;color:var(--text3);margin-top:10px;min-height:18px}.recipe-status.err{color:#fb7185}.recipe-status.ok{color:var(--green)}.food-source-chip.recipe-chip.active{box-shadow:0 0 0 1px rgba(251,191,36,.6) inset}.source-badge.recipe{background:rgba(251,191,36,.13);color:#fbbf24;border-color:rgba(251,191,36,.35)}

      .recipe-hero-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.recipe-origin-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border2);background:var(--bg2);border-radius:999px;padding:4px 9px;font-size:11px;color:var(--text3);margin-left:8px}.recipe-origin-badge.ai{color:#c4b5fd;border-color:rgba(196,181,253,.35);background:rgba(196,181,253,.08)}.recipe-scan-note{margin-top:8px;border:1px dashed rgba(196,181,253,.35);background:rgba(196,181,253,.08);border-radius:14px;padding:9px;color:var(--text3);font-size:12px}.recipe-card-flags{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.recipe-card-flag{font-size:10px;border-radius:999px;border:1px solid var(--border2);padding:2px 7px;color:var(--text3)}.recipe-card-flag.ai{color:#c4b5fd;border-color:rgba(196,181,253,.35);background:rgba(196,181,253,.08)}
      .recipe-ing-help{font-size:11px;color:var(--text4);margin-top:4px}.recipe-search-line button{white-space:nowrap}.recipe-search-line.searching input{border-color:var(--orange);box-shadow:0 0 0 1px color-mix(in srgb,var(--orange) 35%,transparent)}
      .recipe-suggestions{max-height:310px;overflow:auto;padding-right:2px}.recipe-suggestion{display:block}.recipe-suggestion-top span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}.recipe-suggestion .recipe-suggestion-meta{font-size:12px;color:var(--text3);margin-top:3px}.recipe-suggestion .recipe-suggestion-action{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px}.recipe-suggestion .recipe-suggestion-action small{color:var(--text4)}.recipe-suggestion .recipe-add-pill{border:1px solid color-mix(in srgb,var(--green) 36%,var(--border2));background:color-mix(in srgb,var(--green) 12%,var(--bg2));color:var(--green);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:850;white-space:nowrap}
      .recipe-ingredient-row{display:block;border-radius:17px;padding:10px 11px}.recipe-ing-head{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:start}.recipe-ing-main{grid-column:auto;min-width:0}.recipe-ing-main input{font-size:14px;padding:8px 9px}.recipe-ing-remove{align-self:start;margin-top:1px}.recipe-ing-fields{display:grid;grid-template-columns:86px 66px 86px 70px 70px 70px;gap:7px;margin-top:8px}.recipe-ing-field span{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.02em}.recipe-ing-summary{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.recipe-ing-chip{border:1px solid color-mix(in srgb,var(--macro-color,var(--border2)) 28%,var(--border2));background:color-mix(in srgb,var(--macro-color,var(--bg2)) 9%,var(--bg2));color:color-mix(in srgb,var(--macro-color,var(--text)) 82%,var(--text));border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;white-space:nowrap}.recipe-ing-chip.meta{color:var(--text3);border-color:var(--border2);background:var(--bg)}
      .recipe-block-panel{margin-top:16px;border:1px solid var(--border2);border-radius:22px;background:color-mix(in srgb,var(--bg2) 92%,var(--bg));padding:12px;box-shadow:0 1px 0 rgba(0,0,0,.02);max-width:100%;overflow:hidden}.recipe-block-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}.recipe-block-title{display:flex;gap:8px;align-items:center;font-weight:900;color:var(--text);font-size:15px;letter-spacing:.01em}.recipe-block-sub{font-size:11px;color:var(--text4);margin-top:2px}.recipe-count-pill{border:1px solid var(--border2);background:var(--bg);color:var(--text3);border-radius:999px;padding:4px 9px;font-size:11px;white-space:nowrap;font-weight:800}.recipe-summary-panel{margin-top:18px;border:1px solid color-mix(in srgb,var(--green) 24%,var(--border2));border-radius:24px;background:linear-gradient(180deg,color-mix(in srgb,var(--green) 7%,var(--bg2)),var(--bg2));padding:13px;max-width:100%;overflow:hidden}.recipe-summary-title{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:11px}.recipe-summary-title strong{display:flex;gap:8px;align-items:center;color:var(--text);font-size:15px}.recipe-summary-title span{font-size:11px;color:var(--text4);line-height:1.35}.recipe-save-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.recipe-save-row button{min-height:36px}.recipe-ingredients{gap:11px;margin-top:0;overflow:visible}.recipe-ingredient-row{position:relative;border-radius:18px;padding:11px 12px 12px 14px;background:linear-gradient(180deg,color-mix(in srgb,var(--ing-color,var(--green)) 5%,var(--bg2)),var(--bg2));border-color:color-mix(in srgb,var(--ing-color,var(--green)) 24%,var(--border2));box-shadow:inset 4px 0 0 color-mix(in srgb,var(--ing-color,var(--green)) 76%,var(--border2));}.recipe-ingredient-row:nth-child(even){background:linear-gradient(180deg,color-mix(in srgb,var(--ing-color,var(--green)) 8%,var(--bg)),var(--bg2))}.recipe-ingredient-row.source-ciq{--ing-color:#60a5fa}.recipe-ingredient-row.source-off{--ing-color:#34d399}.recipe-ingredient-row.source-ia{--ing-color:#a78bfa}.recipe-ingredient-row.source-manual{--ing-color:#f59e0b}.recipe-ingredient-row.source-base{--ing-color:var(--green)}.recipe-ing-topline{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center}.recipe-ing-number{width:24px;height:24px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--ing-color,var(--green)) 14%,var(--bg));border:1px solid color-mix(in srgb,var(--ing-color,var(--green)) 32%,var(--border2));font-size:11px;font-weight:900;color:color-mix(in srgb,var(--ing-color,var(--green)) 70%,var(--text))}.recipe-ing-main input{border-color:color-mix(in srgb,var(--ing-color,var(--green)) 18%,var(--border2));background:color-mix(in srgb,var(--bg) 72%,var(--bg2));font-weight:850}.recipe-ing-main .mini{padding-left:32px}.recipe-ing-source{background:color-mix(in srgb,var(--ing-color,var(--green)) 12%,var(--bg));border-color:color-mix(in srgb,var(--ing-color,var(--green)) 34%,var(--border2));color:color-mix(in srgb,var(--ing-color,var(--green)) 76%,var(--text));font-weight:850}.recipe-ing-fields{padding:9px;border-radius:14px;background:color-mix(in srgb,var(--bg) 70%,var(--bg2));border:1px solid color-mix(in srgb,var(--ing-color,var(--green)) 14%,var(--border2))}.recipe-ing-field input{background:var(--bg2)}.recipe-ing-field:nth-child(-n+2) input{font-weight:850}.recipe-ing-summary{padding-top:2px}.recipe-ing-chip{box-shadow:0 1px 0 rgba(0,0,0,.02)}.recipe-ing-chip.meta{font-weight:850}.recipe-total{background:var(--bg);border-color:color-mix(in srgb,var(--green) 12%,var(--border2))}.recipe-nutri-100g{background:var(--bg);border-color:color-mix(in srgb,var(--green) 18%,var(--border2))}
      @media(max-width:1080px){.recipe-layout{grid-template-columns:1fr}.recipe-ing-fields{grid-template-columns:repeat(6,minmax(0,1fr))}}
      @media(max-width:700px){#page-recettes{padding:.8rem}.recipe-form-grid,.recipe-search-line{grid-template-columns:1fr}.recipe-block-panel,.recipe-summary-panel{padding:10px;border-radius:18px}.recipe-block-head,.recipe-summary-title{align-items:flex-start}.recipe-ing-topline{grid-template-columns:auto minmax(0,1fr)}.recipe-ing-source{grid-column:2 / 3;justify-self:start}.recipe-ing-fields{grid-template-columns:repeat(2,minmax(0,1fr));padding:8px}.recipe-ing-main .mini{padding-left:0;white-space:normal}.recipe-ing-remove{width:34px}.recipe-totals{grid-template-columns:repeat(2,minmax(0,1fr))}.recipe-nutri-100g-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.recipe-save-row{display:grid;grid-template-columns:1fr}.recipe-page-hero{align-items:flex-start;flex-direction:column}.recipe-photo-row{grid-template-columns:70px minmax(0,1fr)}.recipe-photo-preview{width:70px;height:70px}}
    `;
    document.head.appendChild(st);
  }

  function injectNavAndPage() {
    if (!$('nav-recettes')) {
      const ref = $('nav-historique') || $('nav-stats');
      const item = document.createElement('div');
      item.className = 'sb-item';
      item.id = 'nav-recettes';
      item.setAttribute('onclick', "showPage('recettes',this)");
      item.innerHTML = '<i class="ti ti-tools-kitchen-2" aria-hidden="true"></i> Recettes';
      if (ref && ref.parentElement) ref.parentElement.insertBefore(item, ref.nextSibling);
    }
    if (!$('page-recettes')) {
      const page = document.createElement('div');
      page.id = 'page-recettes';
      page.className = 'page';
      page.innerHTML = renderPageHTML();
      const main = document.querySelector('.main-wrap') || document.body;
      main.appendChild(page);
    }
  }

  function renderPageHTML() {
    return `
      <div class="recipe-page-hero">
        <div><div class="recipe-hero-title">🍲 Recettes enregistrées</div><div class="recipe-hero-sub">Une recette FoodNote est un aliment composé maison : ingrédients CIQUAL, OpenFoodFacts, IA ou base locale, puis ajout rapide dans la journée.</div></div>
        <div class="recipe-hero-actions"><button type="button" onclick="FoodNoteRecipes.clearEditor()">+ Nouvelle recette</button><button type="button" class="btn-primary" onclick="FoodNoteRecipes.openScanRecipe()">📷 Scanner une recette</button><div class="recipe-badge">FoodNote beta 0.22.179</div></div>
      </div>
      <div class="recipe-layout">
        <div class="card fn-ui-surface" id="recipe-editor-card">
          <div class="card-title fn-section-title"><span class="fn-section-icon">🧪</span><span>Créer / modifier une recette</span><span id="recipe-origin-badge" class="recipe-origin-badge">Manuelle</span></div>
          <div class="recipe-form-grid">
            <div class="field"><label>Nom de la recette</label><input id="recipe-name" type="text" placeholder="Ex : chili maison"></div>
            <div class="field"><label>Portions</label><input id="recipe-portions" type="number" min="0.1" step="0.5" value="4"></div>
            <div class="field"><label>Poids final (g)</label><input id="recipe-total-weight" type="number" min="0" step="1" placeholder="ex : 1800"></div>
          </div>
          <div class="field" style="margin-top:10px"><label>Description / notes</label><textarea id="recipe-notes" rows="2" placeholder="Optionnel : cuisson, contexte, remarque IA..."></textarea></div>
          <input id="recipe-scan-photo" type="file" accept="image/*" capture="environment" style="display:none" onchange="FoodNoteRecipes.importScanPhoto(event)">
          <div id="recipe-scan-note" class="recipe-scan-note" style="display:none"></div>
          <div class="recipe-photo-row" style="margin-top:10px">
            <div class="recipe-photo-preview" id="recipe-photo-preview">📷</div>
            <div><label style="font-size:12px;color:var(--text3)">Photo d’illustration optionnelle</label><input id="recipe-photo" type="file" accept="image/*" onchange="FoodNoteRecipes.loadPhoto(event)"><div style="font-size:11px;color:var(--text4);margin-top:4px">Image réduite côté navigateur avant sauvegarde SQLite.</div></div>
          </div>
          <hr style="border:none;border-top:1px solid var(--border2);margin:14px 0">
          <div class="card-title" style="font-size:15px;margin-bottom:8px">Ajouter un ingrédient</div>
          <div class="recipe-search-line">
            <div class="field"><label>Recherche ingrédient</label><input id="recipe-ing-search" type="search" placeholder="pâtes, crème, jambon..." oninput="FoodNoteRecipes.scheduleIngredientSearch()" onfocus="FoodNoteRecipes.scheduleIngredientSearch(80)" onkeydown="if(event.key==='Enter') FoodNoteRecipes.searchIngredient(true)"><div class="recipe-ing-help">Les propositions apparaissent automatiquement pendant la saisie.</div></div>
            <div class="field"><label>Quantité</label><input id="recipe-ing-qty" type="number" min="0" step="1" value="100"></div>
            <button type="button" onclick="FoodNoteRecipes.searchIngredient()">🔍 Chercher</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <button type="button" onclick="FoodNoteRecipes.addManualIngredient()">+ Ingrédient manuel</button>
            <button type="button" onclick="FoodNoteRecipes.clearEditor()">↺ Nouveau</button>
          </div>
          <div id="recipe-ing-suggestions" class="recipe-suggestions"></div>
          <section class="recipe-block-panel recipe-ingredients-panel" aria-label="Ingrédients de la recette">
            <div class="recipe-block-head">
              <div>
                <div class="recipe-block-title"><span>🥣</span><span>Ingrédients de la recette</span></div>
                <div class="recipe-block-sub">Chaque carte correspond à un ingrédient. Les pastilles colorées montrent son apport réel dans la recette.</div>
              </div>
              <span id="recipe-ingredient-count" class="recipe-count-pill">Aucun</span>
            </div>
            <div id="recipe-ingredients" class="recipe-ingredients"></div>
          </section>
          <section class="recipe-summary-panel" aria-label="Bilan nutritionnel de la recette">
            <div class="recipe-summary-title">
              <div><strong><span>📊</span><span>Bilan nutritionnel de la recette</span></strong><span>Résumé calculé depuis les ingrédients, séparé de la liste pour une lecture rapide.</span></div>
              <span class="recipe-count-pill">Synthèse</span>
            </div>
            <div id="recipe-totals" class="recipe-totals"></div>
            <div id="recipe-nutri-100g" class="recipe-nutri-100g"></div>
            <div class="recipe-save-row">
              <button class="btn-primary" type="button" onclick="FoodNoteRecipes.save()">💾 Enregistrer la recette</button>
              <button type="button" onclick="FoodNoteRecipes.saveAndAddToday()">🍽 Enregistrer + ajouter aujourd’hui</button>
            </div>
            <div id="recipe-status" class="recipe-status"></div>
          </section>
        </div>
        <div class="card fn-ui-surface">
          <div class="card-title fn-section-title"><span class="fn-section-icon">📚</span><span>Mes recettes</span></div>
          <div style="display:flex;gap:8px;margin-bottom:10px"><input id="recipe-list-search" type="search" placeholder="Filtrer les recettes..." oninput="FoodNoteRecipes.renderList()"><button onclick="FoodNoteRecipes.load()">↻</button></div>
          <div id="recipe-list" class="recipe-list"></div>
        </div>
      </div>`;
  }

  function status(msg, err = false) {
    const el = $('recipe-status'); if (!el) return;
    el.textContent = msg || ''; el.className = 'recipe-status ' + (err ? 'err' : (msg ? 'ok' : ''));
  }

  function updateOriginBadge() {
    const badge = $('recipe-origin-badge');
    const note = $('recipe-scan-note');
    if (!badge) return;
    const ai = !!importedRecipeMeta.is_ai_estimated;
    const src = importedRecipeMeta.creation_source || 'manual';
    badge.classList.toggle('ai', ai);
    badge.textContent = ai ? (src === 'photo_scan' ? '📷 Estimée par IA' : '⚡ Estimée par IA') : 'Manuelle';
    if (note) {
      note.style.display = ai ? 'block' : 'none';
      note.textContent = ai ? 'Recette importée depuis scan/photo ou estimation IA : vérifie les ingrédients et quantités avant d’enregistrer.' : '';
    }
  }

  function totals() {
    const t = ingredients.reduce((a,it)=>{ a.kcal += num(it.kcal); a.prot += num(it.prot); a.gluc += num(it.gluc); a.lip += num(it.lip); a.weight += effectiveGrams(it); return a; }, {kcal:0,prot:0,gluc:0,lip:0,weight:0});
    const weightInput = $('recipe-total-weight');
    const finalWeight = num(weightInput?.value) || t.weight;
    const portions = Math.max(0.1, num($('recipe-portions')?.value) || 1);
    return { ...t, finalWeight, portions, kcal100: finalWeight ? t.kcal*100/finalWeight : 0, prot100: finalWeight ? t.prot*100/finalWeight : 0, gluc100: finalWeight ? t.gluc*100/finalWeight : 0, lip100: finalWeight ? t.lip*100/finalWeight : 0 };
  }
  function effectiveGrams(it) { return it.unit !== 'g' && num(it.unit_weight) > 0 ? num(it.qty) * num(it.unit_weight) : num(it.qty); }
  function macrosFor(item, qty) {
    const grams = item.unit !== 'g' && num(item.unit_weight || item.poidsUnite) > 0 ? qty * num(item.unit_weight || item.poidsUnite) : qty;
    return { kcal:kcal(num(item.kcal100)*grams/100), prot:round1(num(item.prot100)*grams/100), gluc:round1(num(item.gluc100)*grams/100), lip:round1(num(item.lip100)*grams/100) };
  }
  function renderTotals() {
    const box = $('recipe-totals');
    const nutri = $('recipe-nutri-100g');
    const t = totals();
    if (box) {
      box.innerHTML = [
        ['Total recette', kcal(t.kcal)+' kcal', `${round1(t.prot)}P · ${round1(t.gluc)}G · ${round1(t.lip)}L`],
        ['Par portion', kcal(t.kcal/t.portions)+' kcal', `${round1(t.prot/t.portions)}P · ${round1(t.gluc/t.portions)}G · ${round1(t.lip/t.portions)}L`],
        ['Poids final', kcal(t.finalWeight)+' g', `${t.portions} portion(s)`],
        ['Source calcul', t.finalWeight ? 'poids final' : 'ingrédients', 'base nutrition /100g']
      ].map(r => `<div class="recipe-total"><span>${esc(r[0])}</span><b>${esc(r[1])}</b><span>${esc(r[2])}</span></div>`).join('');
    }
    if (nutri) {
      nutri.innerHTML = `
        <div class="recipe-nutri-head"><span>Valeurs nutritionnelles de la recette</span><strong>pour 100 g</strong></div>
        <div class="recipe-nutri-100g-grid">
          <div class="recipe-nutri-card macro-kcal"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🔥</span><span>Calories</span></div><b>${kcal(t.kcal100)}</b><small>kcal / 100 g</small></div>
          <div class="recipe-nutri-card macro-prot"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🍖</span><span>Protéines</span></div><b>${round1(t.prot100)}</b><small>g / 100 g</small></div>
          <div class="recipe-nutri-card macro-gluc"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🍞</span><span>Glucides</span></div><b>${round1(t.gluc100)}</b><small>g / 100 g</small></div>
          <div class="recipe-nutri-card macro-lip"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🥑</span><span>Lipides</span></div><b>${round1(t.lip100)}</b><small>g / 100 g</small></div>
        </div>`;
    }
  }
  function renderIngredients() {
    const box = $('recipe-ingredients'); if (!box) return;
    const count = $('recipe-ingredient-count');
    if (count) count.textContent = ingredients.length ? `${ingredients.length} ingrédient${ingredients.length > 1 ? 's' : ''}` : 'Aucun';
    if (!ingredients.length) {
      box.innerHTML = '<div class="empty-state">Aucun ingrédient. Ajoute depuis CIQUAL / OpenFoodFacts / base locale ou en manuel.</div>';
      renderTotals(); return;
    }
    box.innerHTML = ingredients.map((it,i)=>`
      <div class="fn-ui-row fn-ui-row--food recipe-ingredient-row ${sourceClass(it.source)}">
        <div class="recipe-ing-head">
          <div class="recipe-ing-main">
            <div class="recipe-ing-topline">
              <span class="recipe-ing-number">${i + 1}</span>
              <input value="${esc(it.name)}" onchange="FoodNoteRecipes.patchIngredient(${i},'name',this.value)">
              <span class="recipe-source recipe-ing-source ${sourceClass(it.source)}">${sourceIcon(it.source)} ${sourceName(it.source)}</span>
            </div>
            <div class="mini">${round1(effectiveGrams(it))} g utilisés · valeurs /100 g modifiables</div>
          </div>
          <button class="recipe-ing-remove" type="button" onclick="FoodNoteRecipes.removeIngredient(${i})" title="Retirer">×</button>
        </div>
        <div class="recipe-ing-fields">
          <label class="recipe-ing-field"><span>Qté</span><input type="number" step="1" value="${num(it.qty)}" title="Quantité" onchange="FoodNoteRecipes.patchIngredient(${i},'qty',this.value,true)"></label>
          <label class="recipe-ing-field"><span>Unité</span><input value="${esc(it.unit || 'g')}" title="Unité" onchange="FoodNoteRecipes.patchIngredient(${i},'unit',this.value)"></label>
          <label class="recipe-ing-field"><span>kcal/100g</span><input type="number" step="1" value="${num(it.kcal100)}" title="kcal/100g" onchange="FoodNoteRecipes.patchIngredient(${i},'kcal100',this.value,true)"></label>
          <label class="recipe-ing-field"><span>Prot/100g</span><input type="number" step="0.1" value="${num(it.prot100)}" title="prot/100g" onchange="FoodNoteRecipes.patchIngredient(${i},'prot100',this.value,true)"></label>
          <label class="recipe-ing-field"><span>Gluc/100g</span><input type="number" step="0.1" value="${num(it.gluc100)}" title="gluc/100g" onchange="FoodNoteRecipes.patchIngredient(${i},'gluc100',this.value,true)"></label>
          <label class="recipe-ing-field"><span>Lip/100g</span><input type="number" step="0.1" value="${num(it.lip100)}" title="lip/100g" onchange="FoodNoteRecipes.patchIngredient(${i},'lip100',this.value,true)"></label>
        </div>
        <div class="recipe-ing-summary">
          <span class="recipe-ing-chip macro-kcal">🔥 ${kcal(it.kcal)} kcal</span>
          <span class="recipe-ing-chip macro-prot">🍖 ${round1(it.prot)} g prot</span>
          <span class="recipe-ing-chip macro-gluc">🍞 ${round1(it.gluc)} g gluc</span>
          <span class="recipe-ing-chip macro-lip">🥑 ${round1(it.lip)} g lip</span>
          <span class="recipe-ing-chip meta">${round1(effectiveGrams(it))} g recette</span>
        </div>
      </div>`).join('');
    renderTotals();
  }
  function recalcIngredient(it) { Object.assign(it, macrosFor(it, num(it.qty) || 0)); return it; }
  function addIngredientFromFood(food, qty) {
    const srcFood = (typeof sanitizeFoodUnitMeta === 'function') ? sanitizeFoodUnitMeta(food || {}) : (food || {});
    const unitWeight = num(srcFood.unit_weight ?? srcFood.poidsUnite);
    const unit = unitWeight > 0 ? (srcFood.unit || srcFood.unite || 'g') : 'g';
    const clean = recalcIngredient({
      name: srcFood.name || srcFood.nom || 'Ingrédient', qty: num(qty) || 100, unit,
      unit_weight: unitWeight || null, unit_label: unitWeight > 0 ? (srcFood.unit_label || srcFood.uniteLabel || '') : '',
      kcal100: kcal(srcFood.kcal100), prot100: round1(srcFood.prot100), gluc100: round1(srcFood.gluc100), lip100: round1(srcFood.lip100),
      source: srcFood.source || 'base'
    });
    ingredients.push(clean); renderIngredients(); status('Ingrédient ajouté : ' + clean.name, false);
  }

  async function searchLocal(q) {
    try {
      return (typeof getBDD === 'function' ? getBDD() : []).filter(f => norm(f.nom).includes(norm(q))).slice(0, 8).map(f => ({...f, source:f.source || 'base'}));
    } catch(e) { return []; }
  }
  async function searchCIQ(q) {
    try {
      const r = await apiJson('/api/ciqual/data?q=' + encodeURIComponent(q));
      const arr = Array.isArray(r) ? r : (r.products || r.items || []);
      return arr.slice(0, 8).map(p => typeof makeFoodFromExternal === 'function' ? makeFoodFromExternal(p,'ciq') : ({ nom:p.nom || p.name || p.alim_nom_fr, kcal100:p.kcal100 || p.kcal, prot100:p.prot100 || p.prot, gluc100:p.gluc100 || p.gluc, lip100:p.lip100 || p.lip, source:'ciq' }));
    } catch(e) { return []; }
  }
  async function searchOFF(q) {
    try {
      const r = await apiJson('/api/off/search?q=' + encodeURIComponent(q));
      return (r.products || r.items || []).slice(0, 8).map(p => typeof makeFoodFromExternal === 'function' ? makeFoodFromExternal(p,'off') : ({ nom:p.product_name || p.nom, kcal100:p.kcal100, prot100:p.prot100, gluc100:p.gluc100, lip100:p.lip100, source:'off' }));
    } catch(e) { return []; }
  }
  function scheduleIngredientSearch(delay = 260) {
    const input = $('recipe-ing-search');
    const box = $('recipe-ing-suggestions');
    const q = input?.value.trim() || '';
    clearTimeout(ingredientSearchTimer);
    if (!q || q.length < 2) {
      lastIngredientSearchNorm = '';
      ingredientSuggestions = [];
      if (box) box.innerHTML = q ? '<div class="recipe-suggestion">Tape au moins 2 caractères pour proposer des ingrédients.</div>' : '';
      return;
    }
    ingredientSearchTimer = setTimeout(() => searchIngredient(false), Math.max(60, Number(delay) || 260));
  }

  async function searchIngredient(force = true) {
    const input = $('recipe-ing-search');
    const q = input?.value.trim();
    const box = $('recipe-ing-suggestions');
    if (!q) { if (box) box.innerHTML = ''; return; }
    if (q.length < 2) { if (box) box.innerHTML = '<div class="recipe-suggestion">Tape au moins 2 caractères pour proposer des ingrédients.</div>'; return; }
    const qNorm = norm(q);
    if (!force && ingredientSearchInFlight) return;
    if (!force && qNorm === lastIngredientSearchNorm && ingredientSuggestions.length) return;
    const seq = ++ingredientSearchSeq;
    ingredientSearchInFlight = true;
    lastIngredientSearchNorm = qNorm;
    const line = input?.closest('.recipe-search-line');
    if (line) line.classList.add('searching');
    if (box) box.innerHTML = '<div class="recipe-suggestion">Recherche automatique...</div>';
    const seen = new Set();
    const all = [];
    try {
      for (const list of await Promise.all([searchLocal(q), searchCIQ(q), searchOFF(q)])) {
        (list || []).forEach(it => { const key = norm(it.nom || it.name); if (!key || seen.has(key)) return; seen.add(key); all.push(it); });
      }
      if (seq !== ingredientSearchSeq) return;
      ingredientSuggestions = all.slice(0, 14);
      if (!box) return;
      if (!ingredientSuggestions.length) { box.innerHTML = '<div class="recipe-suggestion">Aucun résultat. Tu peux utiliser + Ingrédient manuel ou l’estimation IA.</div>'; return; }
      box.innerHTML = ingredientSuggestions.map((it,i)=>`
        <div class="recipe-suggestion" onclick="FoodNoteRecipes.pickIngredientSuggestion(${i})">
          <div class="recipe-suggestion-top"><span>${esc(it.nom || it.name)}</span><span class="recipe-source ${esc(it.source || 'base')}">${sourceName(it.source)}</span></div>
          <div class="recipe-suggestion-meta">${kcal(it.kcal100)} kcal/100g · ${round1(it.prot100)}P · ${round1(it.gluc100)}G · ${round1(it.lip100)}L</div>
          <div class="recipe-suggestion-action"><small>Cliquer pour ajouter avec la quantité indiquée</small><span class="recipe-add-pill">+ Ajouter</span></div>
        </div>`).join('');
    } finally {
      if (seq === ingredientSearchSeq) ingredientSearchInFlight = false;
      if (line) line.classList.remove('searching');
    }
  }
  function pickIngredientSuggestion(i) {
    const it = ingredientSuggestions[i]; if (!it) return;
    addIngredientFromFood(it, num($('recipe-ing-qty')?.value) || 100);
    const box = $('recipe-ing-suggestions'); if (box) box.innerHTML = '';
  }

  async function load() {
    try {
      const data = await apiJson('/api/recipes?limit=200');
      recipes = data.recipes || [];
      renderList();
    } catch(e) { const l = $('recipe-list'); if (l) l.innerHTML = `<div class="empty-state">Erreur recettes : ${esc(e.message)}</div>`; }
  }
  function renderList() {
    const box = $('recipe-list'); if (!box) return;
    const q = norm($('recipe-list-search')?.value || '');
    const list = recipes.filter(r => !q || norm(r.name).includes(q));
    if (!list.length) { box.innerHTML = '<div class="empty-state">Aucune recette enregistrée.</div>'; return; }
    box.innerHTML = list.map(r => {
      const img = r.photo_data ? `<img src="${esc(r.photo_data)}" alt="">` : '🍲';
      return `<div class="recipe-card">
        <div class="recipe-card-img">${img}</div>
        <div><div class="recipe-card-title">${esc(r.name)}</div><div class="recipe-card-sub">${kcal(r.nutrition_per_portion?.kcal || 0)} kcal/portion · ${r.portions || 1} portion(s)</div>${r.is_ai_estimated ? '<div class="recipe-card-flags"><span class="recipe-card-flag ai">IA à vérifier</span>' + (r.creation_source === 'photo_scan' ? '<span class="recipe-card-flag ai">Photo/OCR</span>' : '') + '</div>' : ''}<div class="recipe-card-macros food-macro-line" title="Valeurs nutritionnelles pour 100 g"><span class="macro-kcal">🔥 ${kcal(r.kcal100)} kcal/100g</span><span class="macro-prot">🍖 ${round1(r.prot100)}g</span><span class="macro-gluc">🍞 ${round1(r.gluc100)}g</span><span class="macro-lip">🥑 ${round1(r.lip100)}g</span></div>
        <div class="recipe-card-actions"><button onclick="FoodNoteRecipes.edit(${r.id})">Modifier</button><button onclick="FoodNoteRecipes.addToday(${r.id})">Ajouter aujourd’hui</button><button onclick="FoodNoteRecipes.remove(${r.id})">Supprimer</button></div></div>
      </div>`;
    }).join('');
  }
  function payload() {
    const t = totals();
    return { id: editingId, name: $('recipe-name')?.value.trim(), notes: $('recipe-notes')?.value || '', portions: t.portions, total_weight: t.finalWeight, photo_data: recipePhoto, source: importedRecipeMeta.is_ai_estimated ? 'ia' : 'manual', creation_source: importedRecipeMeta.creation_source || 'manual', is_ai_estimated: !!importedRecipeMeta.is_ai_estimated, raw_scan_text: importedRecipeMeta.raw_scan_text || '', ai_estimation_json: importedRecipeMeta.ai_estimation_json || '', ingredients };
  }
  async function save() {
    const p = payload();
    if (!p.name) { status('Nom de recette obligatoire.', true); return null; }
    if (!p.ingredients.length) { status('Ajoute au moins un ingrédient.', true); return null; }
    try {
      const data = await apiJson(editingId ? '/api/recipes/' + editingId : '/api/recipes', { method: editingId ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(p) });
      editingId = data.recipe.id;
      status('Recette enregistrée dans SQLite.', false);
      await load();
      return data.recipe;
    } catch(e) { status('Erreur sauvegarde recette : ' + e.message, true); return null; }
  }
  async function addToday(id) {
    const r = recipes.find(x => String(x.id) === String(id)); if (!r) return;
    const weight = r.total_weight && r.portions ? Math.round((r.total_weight / r.portions) * 10) / 10 : 100;
    const food = { nom:r.name, defaut:weight, unite:'g', kcal100:r.kcal100, prot100:r.prot100, gluc100:r.gluc100, lip100:r.lip100, source:'recipe', recipeId:r.id, bddId:'recipe_' + r.id };
    try {
      if (typeof showPage === 'function') showPage('journal', $('nav-journal'));
      setTimeout(()=>{
        if (typeof addCustomAliment === 'function') addCustomAliment(food);
        if (typeof showSaveStatus === 'function') showSaveStatus('Recette ajoutée à la journée : ' + r.name, false);
      }, 80);
    } catch(e) { status('Ajout impossible : ' + e.message, true); }
  }
  async function saveAndAddToday() { const r = await save(); if (r) addToday(r.id); }
  function edit(id) {
    const r = recipes.find(x => String(x.id) === String(id)); if (!r) return;
    editingId = r.id; ingredients = (r.ingredients || []).map(x => ({...x, name:x.name || x.nom, unit:x.unit || x.unite || 'g'})); recipePhoto = r.photo_data || '';
    importedRecipeMeta = { creation_source: r.creation_source || r.source || 'manual', is_ai_estimated: !!r.is_ai_estimated, raw_scan_text: r.raw_scan_text || '', ai_estimation_json: r.ai_estimation_json || '' };
    if ($('recipe-name')) $('recipe-name').value = r.name || '';
    if ($('recipe-portions')) $('recipe-portions').value = r.portions || 1;
    if ($('recipe-total-weight')) $('recipe-total-weight').value = r.total_weight || '';
    if ($('recipe-notes')) $('recipe-notes').value = r.notes || '';
    updatePhotoPreview(); updateOriginBadge(); renderIngredients(); status('Modification : ' + r.name, false); $('recipe-editor-card')?.scrollIntoView({behavior:'smooth', block:'start'});
  }
  async function remove(id) {
    if (!confirm('Supprimer cette recette ?')) return;
    try { await apiJson('/api/recipes/' + id, { method:'DELETE' }); if (editingId && String(editingId) === String(id)) clearEditor(); await load(); }
    catch(e) { status('Suppression impossible : ' + e.message, true); }
  }
  function clearEditor() {
    editingId = null; ingredients = []; recipePhoto = ''; importedRecipeMeta = { creation_source:'manual', is_ai_estimated:false, raw_scan_text:'', ai_estimation_json:'' };
    ['recipe-name','recipe-notes','recipe-total-weight'].forEach(id => { const el=$(id); if (el) el.value=''; });
    if ($('recipe-portions')) $('recipe-portions').value = 4;
    if ($('recipe-photo')) $('recipe-photo').value = '';
    updatePhotoPreview(); updateOriginBadge(); renderIngredients(); status('', false);
  }
  function patchIngredient(i, key, value, numeric) { if (!ingredients[i]) return; ingredients[i][key] = numeric ? num(value) : value; recalcIngredient(ingredients[i]); renderIngredients(); }
  function removeIngredient(i) { ingredients.splice(i,1); renderIngredients(); }
  function addManualIngredient() { addIngredientFromFood({ nom:$('recipe-ing-search')?.value.trim() || 'Ingrédient', kcal100:0, prot100:0, gluc100:0, lip100:0, source:'manual' }, num($('recipe-ing-qty')?.value) || 100); }

  function updatePhotoPreview() { const p = $('recipe-photo-preview'); if (!p) return; p.innerHTML = recipePhoto ? `<img src="${esc(recipePhoto)}" alt="Photo recette">` : '📷'; }
  async function resizeDataUrlForRecipe(dataUrl, max = 720) {
    return await new Promise(resolve => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            let w = img.width, h = img.height; const ratio = Math.min(1, max / Math.max(w, h));
            w = Math.max(1, Math.round(w * ratio)); h = Math.max(1, Math.round(h * ratio));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', .72));
          } catch(e) { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch(e) { resolve(dataUrl); }
    });
  }
  function loadPhoto(ev) {
    const file = ev?.target?.files?.[0]; if (!file) return;
    const img = new Image(); const reader = new FileReader();
    reader.onload = () => { img.onload = () => {
      const max = 720; let w = img.width, h = img.height; const ratio = Math.min(1, max / Math.max(w,h)); w = Math.round(w*ratio); h = Math.round(h*ratio);
      const c = document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h);
      recipePhoto = c.toDataURL('image/jpeg', .72); updatePhotoPreview(); status('Photo ajoutée.', false);
    }; img.src = reader.result; };
    reader.readAsDataURL(file);
  }

  async function estimateWithAI() {
    const txt = prompt('Décris ta recette ou colle une liste d’ingrédients avec quantités. Exemple : 500g pâtes cuites, 200g jambon, 100g crème, 80g emmental.');
    if (!txt) return;
    if (typeof callGroqChat !== 'function') { status('IA indisponible : fonction Groq non chargée.', true); return; }
    status('IA : estimation de la recette en cours...', false);
    const promptText = `Tu aides à créer une recette nutritionnelle FoodNote. Réponds uniquement en JSON valide, sans markdown, format: {"name":"...","portions":4,"total_weight":1200,"ingredients":[{"name":"...","qty":100,"unit":"g","kcal100":123,"prot100":4.5,"gluc100":12,"lip100":3.2,"source":"ia"}]}. Utilise des valeurs réalistes par 100g, les quantités en grammes, et marque source="ia". Recette: ${txt}`;
    try {
      const raw = await callGroqChat(promptText, { max_tokens:900, temperature:0.1 });
      const json = JSON.parse(String(raw).replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```$/,'').trim());
      if (json.name && !$('recipe-name').value) $('recipe-name').value = json.name;
      if (json.portions) $('recipe-portions').value = json.portions;
      if (json.total_weight) $('recipe-total-weight').value = json.total_weight;
      (json.ingredients || []).forEach(it => addIngredientFromFood({ ...it, nom:it.name, source:'ia' }, it.qty || 100));
      status('Estimation IA ajoutée. Vérifie les ingrédients avant d’enregistrer.', false);
    } catch(e) { status('Erreur IA recette : ' + e.message, true); }
  }


  function openScanRecipe() {
    if (typeof isAIEnabled === 'function' && !isAIEnabled()) { alert('Les fonctions IA sont désactivées dans Options de l’application.'); return; }
    try {
      window.FoodNoteRecipeWorkflowActive = true;
      if (window.FoodNoteAddV0160 && typeof window.FoodNoteAddV0160.beginWorkflow === 'function') window.FoodNoteAddV0160.beginWorkflow('recipe_ocr', 180000);
      if (typeof openFoodAddModal === 'function') openFoodAddModal();
      setTimeout(() => {
        if (window.FoodNoteAddV0160 && typeof window.FoodNoteAddV0160.beginWorkflow === 'function') window.FoodNoteAddV0160.beginWorkflow('recipe_ocr', 180000);
        if (typeof openFoodRecipePhotoOption === 'function') openFoodRecipePhotoOption();
      }, 80);
    } catch(e) { status('Impossible d’ouvrir le scanner recette : ' + (e.message || e), true); }
  }
  async function importScanPhoto(ev) {
    try { window.FoodNoteAddV0160 && window.FoodNoteAddV0160.beginWorkflow && window.FoodNoteAddV0160.beginWorkflow('recipe_ocr', 180000); } catch(e) {}
    const file = ev?.target?.files?.[0];
    if (!file) return;
    try {
      if (typeof openFoodAddModal === 'function') openFoodAddModal();
      setTimeout(() => {
        try { window.FoodNoteAddV0160 && window.FoodNoteAddV0160.beginWorkflow && window.FoodNoteAddV0160.beginWorkflow('recipe_ocr', 180000); } catch(e) {}
        if (typeof openFoodRecipePhotoOption === 'function') openFoodRecipePhotoOption();
      }, 50);
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      window.FoodNoteRecipeScanPhotoData = await resizeDataUrlForRecipe(dataUrl);
      if (typeof processRecipeOCRImage === 'function') await processRecipeOCRImage(dataUrl, { upload:true, filename:file.name || 'recette.jpg' }, 'photo importée');
      else status('Module OCR recette indisponible.', true);
    } catch(e) { status('Lecture photo recette impossible : ' + (e.message || e), true); }
    finally { if (ev?.target) ev.target.value = ''; }
  }
  function importScanDraft(draft) {
    if (!draft || typeof draft !== 'object') return;
    editingId = null;
    importedRecipeMeta = { creation_source: draft.creation_source || draft.creationSource || 'ia_import', is_ai_estimated: true, raw_scan_text: draft.raw_scan_text || draft.rawScanText || '', ai_estimation_json: typeof draft.ai_estimation_json === 'string' ? draft.ai_estimation_json : JSON.stringify(draft.ai_estimation_json || draft.aiEstimation || draft) };
    recipePhoto = draft.photo_data || draft.photoData || draft.photo || window.FoodNoteRecipeScanPhotoData || '';
    ingredients = (Array.isArray(draft.ingredients) ? draft.ingredients : []).map(it => {
      const src = (typeof sanitizeFoodUnitMeta === 'function') ? sanitizeFoodUnitMeta({ nom: it.name || it.nom, ...it }) : it;
      const uw = num(src.unit_weight ?? src.poidsUnite) || null;
      return recalcIngredient({
        name: src.name || src.nom || 'Ingrédient IA',
        qty: num(src.qty ?? src.quantity ?? src.quantite) || 100,
        unit: uw ? (src.unit || src.unite || 'g') : 'g',
        unit_weight: uw,
        unit_label: uw ? (src.unit_label || src.uniteLabel || '') : '',
        kcal100: kcal(src.kcal100), prot100: round1(src.prot100), gluc100: round1(src.gluc100), lip100: round1(src.lip100),
        source: src.source || 'ia'
      });
    });
    if (!ingredients.length && (draft.kcal100 || draft.total_weight)) {
      const w = num(draft.total_weight || draft.totalWeight || 100) || 100;
      ingredients = [recalcIngredient({ name:draft.name || draft.nom || 'Recette estimée IA', qty:w, unit:'g', kcal100:kcal(draft.kcal100), prot100:round1(draft.prot100), gluc100:round1(draft.gluc100), lip100:round1(draft.lip100), source:'ia' })];
    }
    if (typeof showPage === 'function') showPage('recettes', $('nav-recettes'));
    if ($('recipe-name')) $('recipe-name').value = draft.name || draft.nom || 'Recette maison';
    if ($('recipe-portions')) $('recipe-portions').value = draft.portions || 4;
    if ($('recipe-total-weight')) $('recipe-total-weight').value = draft.total_weight || draft.totalWeight || '';
    if ($('recipe-notes')) $('recipe-notes').value = draft.notes || 'Recette importée depuis scan/photo IA — à vérifier avant sauvegarde.';
    updatePhotoPreview(); updateOriginBadge(); renderIngredients(); status('Recette importée depuis scan/photo. Vérifie puis enregistre.', false);
    try { if (typeof closeFoodAddModal === 'function') setTimeout(closeFoodAddModal, 180); } catch(e) {}
    setTimeout(() => $('recipe-editor-card')?.scrollIntoView({ behavior:'smooth', block:'start' }), 120);
  }
  function consumePendingScanDraft() {
    try {
      const raw = localStorage.getItem('foodnote_pending_recipe_scan_draft');
      if (!raw) return;
      localStorage.removeItem('foodnote_pending_recipe_scan_draft');
      importScanDraft(JSON.parse(raw));
    } catch(e) { console.warn('[FoodNote Recettes] brouillon scan ignoré', e); }
  }

  function injectRecipeFilterChip() {
    const wrap = document.querySelector('.food-inline-filters');
    if (!wrap || $('food-source-chip-recipes')) return;
    try { foodSearchRecipesEnabled = localStorage.getItem('foodnote_recipe_search_enabled') !== '0'; } catch(e) {}
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'food-source-chip-recipes'; btn.className = 'food-source-chip recipe-chip' + (foodSearchRecipesEnabled ? ' active' : '');
    btn.innerHTML = '<span>🍲</span><b>Recettes</b>';
    btn.onclick = () => { foodSearchRecipesEnabled = !foodSearchRecipesEnabled; try{localStorage.setItem('foodnote_recipe_search_enabled', foodSearchRecipesEnabled?'1':'0')}catch(e){}; btn.classList.toggle('active', foodSearchRecipesEnabled); scheduleFoodSearchRecipeAppend(); };
    const label = wrap.querySelector('.food-inline-filters-label');
    if (label && label.nextSibling) wrap.insertBefore(btn, label.nextSibling);
    else wrap.insertBefore(btn, wrap.firstChild);
    const input = $('db-search');
    if (input && !input.dataset.recipeListener) { input.dataset.recipeListener='1'; input.addEventListener('input', scheduleFoodSearchRecipeAppend); input.addEventListener('focus', scheduleFoodSearchRecipeAppend); }
  }
  function scheduleFoodSearchRecipeAppend(delay = 120) {
    clearTimeout(foodSearchRecipeTimer);
    foodSearchRecipeTimer = setTimeout(appendRecipeSearchSuggestions, Math.max(20, Number(delay) || 120));
  }
  async function appendRecipeSearchSuggestions() {
    const input = $('db-search'), box = $('db-suggestions');
    if (!input || !box || !foodSearchRecipesEnabled || (typeof foodAddMode !== 'undefined' && foodAddMode !== 'search')) return;
    const q = input.value.trim();
    const existing = box.querySelector('[data-recipe-suggestions="1"]');
    if (q.length < 2) { if (existing) existing.remove(); return; }
    const key = norm(q);
    if (existing && existing.dataset.recipeQuery === key) {
      box.classList.add('visible');
      return;
    }
    try {
      recipeSearchAppendBusy = true;
      let items = recipeSearchCache.get(key);
      if (!items) {
        const data = await apiJson('/api/recipes/search?q=' + encodeURIComponent(q) + '&limit=8');
        items = data.items || [];
        recipeSearchCache.set(key, items);
      }
      const stillInput = $('db-search'), stillBox = $('db-suggestions');
      if (!stillInput || !stillBox || norm(stillInput.value.trim()) !== key) return;
      const oldBlock = stillBox.querySelector('[data-recipe-suggestions="1"]');
      if (oldBlock) oldBlock.remove();
      if (!items.length) return;
      const div = document.createElement('div');
      div.dataset.recipeSuggestions = '1';
      div.dataset.recipeQuery = key;
      div.innerHTML = items.map(it => `<div class="db-suggestion" onmousedown="event.preventDefault();FoodNoteRecipes.addRecipeFood(${Number(it.recipe_id)})"><div class="db-suggestion-top"><div class="db-suggestion-name">🍲 ${esc(it.nom)}</div><span class="source-badge recipe">Recette</span></div><div style="font-size:11px;color:var(--text4);margin-top:2px">${esc(it.meta || '')}</div><div class="db-suggestion-macros food-macro-line"><span class="macro-kcal">🔥 ${kcal(it.kcal100)} kcal/100g</span><span class="macro-prot">🍖 ${round1(it.prot100)}g</span><span class="macro-gluc">🍞 ${round1(it.gluc100)}g</span><span class="macro-lip">🥑 ${round1(it.lip100)}g</span></div></div>`).join('');
      // 0.15.17 : les recettes doivent rester prioritaires dans la recherche aliment.
      // Ordre voulu lorsque tous les filtres sont actifs : Recettes → Base → CIQUAL/OpenFoodFacts.
      // Le bloc recette est donc inséré en haut de la liste, puis l'observer le remet
      // en haut si CIQUAL/OFF réécrivent les suggestions après coup.
      stillBox.prepend(div);
      stillBox.classList.add('visible');
      if (typeof setFoodAddExpanded === 'function') setFoodAddExpanded(true);
    } catch(e) {
      console.warn('[FoodNote Recettes] recherche recette indisponible', e);
    } finally {
      setTimeout(() => { recipeSearchAppendBusy = false; }, 0);
    }
  }
  async function addRecipeFood(id) { if (!recipes.length) await load(); addToday(id); const input=$('db-search'); if(input) input.value=''; $('db-suggestions')?.classList.remove('visible'); if (typeof closeFoodAddModal === 'function') setTimeout(closeFoodAddModal, 120); }

  function installRecipeSearchObserver() {
    const box = $('db-suggestions');
    if (!box || box.dataset.recipeObserver === '1') return;
    box.dataset.recipeObserver = '1';
    const obs = new MutationObserver(() => {
      if (recipeSearchAppendBusy) return;
      const input = $('db-search');
      if (!input || input.value.trim().length < 2 || !foodSearchRecipesEnabled) return;
      if (typeof foodAddMode !== 'undefined' && foodAddMode !== 'search') return;
      // Quand CIQUAL/OpenFoodFacts réécrit la liste après nous, on remet le bloc Recettes.
      if (!box.querySelector('[data-recipe-suggestions="1"]')) scheduleFoodSearchRecipeAppend(70);
    });
    obs.observe(box, { childList:true });
  }
  let recipesBooted = false;
  function syncRecipeNavMetadata() {
    const nav = $('nav-recettes');
    if (!nav) return;
    const label = (nav.textContent || 'Recettes').replace(/\s+/g, ' ').trim() || 'Recettes';
    nav.setAttribute('data-collapsed-title', label);
    if (!nav.getAttribute('title')) nav.setAttribute('title', label);
  }
  function init() {
    injectStyles();
    injectNavAndPage();
    syncRecipeNavMetadata();
    injectRecipeFilterChip();
    installRecipeSearchObserver();
    if (!recipesBooted) {
      recipesBooted = true;
      clearEditor();
      load();
      setTimeout(consumePendingScanDraft, 250);
    }
  }
  function bootWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once:true });
      return;
    }
    init();
  }
  bootWhenReady();
  window.addEventListener('foodnote:deferred-ready', init);
  window.addEventListener('foodnote-ui-rendered', () => {
    injectNavAndPage();
    syncRecipeNavMetadata();
    injectRecipeFilterChip();
    installRecipeSearchObserver();
  });
  setTimeout(() => { init(); }, 900);

  window.FoodNoteRecipes = { load, renderList, save, saveAndAddToday, edit, remove, clearEditor, patchIngredient, removeIngredient, addManualIngredient, scheduleIngredientSearch, searchIngredient, pickIngredientSuggestion, loadPhoto, estimateWithAI, addToday, addRecipeFood, scheduleFoodSearchRecipeAppend, appendRecipeSearchSuggestions, openScanRecipe, importScanPhoto, importScanDraft };
})();
