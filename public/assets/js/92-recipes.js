/*
 * FoodNote — recettes runtime
 * Rôle : Gérer l'éditeur de recettes, les ingrédients, la recherche et l'ajout de recettes au journal.
 * Ne doit pas gérer : l'apparence CSS, les routes serveur ou le thème global.
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
      <style>
        #page-recettes{max-width:1180px;margin:0 auto}
        #page-recettes .rcp-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px}
        #page-recettes .rcp-hero-title{font-size:22px;font-weight:900;color:var(--fn-ds-text,#211f1a);display:flex;align-items:center;gap:8px}
        #page-recettes .rcp-hero-sub{font-size:13px;color:var(--fn-ds-text-soft,#5b5b51);margin-top:4px;max-width:680px;line-height:1.45}
        #page-recettes .rcp-hero-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        #page-recettes .rcp-badge{font-size:11px;color:var(--fn-ds-muted,#8b8172);background:var(--fn-ds-surface-soft,#f3eadf);border:1px solid var(--fn-ds-border,rgba(97,74,46,.14));padding:5px 10px;border-radius:999px}
        #page-recettes .rcp-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.7fr);gap:16px;align-items:start}
        #page-recettes .rcp-col{display:flex;flex-direction:column;gap:16px;min-width:0}
        #page-recettes .rcp-step,#page-recettes .rcp-side{background:var(--fn-ds-surface,#fffdf8)!important;border:1px solid rgba(70,60,45,.18)!important;border-radius:16px!important;box-shadow:0 6px 18px rgba(40,40,35,.07)!important;padding:18px!important;min-width:0}
        #page-recettes .rcp-step-h{display:flex;align-items:center;gap:10px;margin-bottom:14px}
        #page-recettes .rcp-step-n{width:26px;height:26px;border-radius:999px;background:var(--fn-ds-accent,#3f7a57);color:#fff;font-weight:900;font-size:13px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
        #page-recettes .rcp-step-t{font-size:15px;font-weight:800;color:var(--fn-ds-text,#211f1a)}
        #page-recettes .rcp-step-sub{font-size:12px;color:var(--fn-ds-muted,#8b8172);font-weight:600}
        #page-recettes .rcp-origin{margin-left:auto;font-size:11px;font-weight:700;color:var(--fn-ds-accent-strong,#2e5d42);background:var(--fn-ds-accent-soft,#e1efe2);border-radius:999px;padding:4px 10px}
        #page-recettes .rcp-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
        #page-recettes .rcp-field>label{font-size:12px;font-weight:700;color:var(--fn-ds-text-soft,#5b5b51)}
        #page-recettes .rcp-field input,#page-recettes .rcp-field textarea{width:100%;padding:10px 12px;border-radius:11px;font:inherit;font-size:15px;border:1px solid var(--fn-ds-border,rgba(97,74,46,.14));background:#fff;color:inherit;box-sizing:border-box}
        #page-recettes .rcp-row2{display:grid;grid-template-columns:1.5fr .7fr;gap:10px}
        #page-recettes .rcp-opt{margin-top:4px;border-top:1px solid var(--fn-ds-border,rgba(97,74,46,.14));padding-top:6px}
        #page-recettes .rcp-opt>summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--fn-ds-accent-strong,#2e5d42);list-style:none;padding:6px 0}
        #page-recettes .rcp-opt>summary::-webkit-details-marker{display:none}
        #page-recettes .rcp-opt>summary:before{content:"\u25B8 ";color:var(--fn-ds-muted,#8b8172)}
        #page-recettes .rcp-opt[open]>summary:before{content:"\u25BE "}
        #page-recettes .rcp-add{display:grid;grid-template-columns:1fr 92px auto;gap:8px;align-items:end}
        #page-recettes .rcp-add .rcp-field{margin-bottom:0}
        #page-recettes .rcp-help{font-size:11px;color:var(--fn-ds-muted,#8b8172);margin-top:6px}
        #page-recettes .rcp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        #page-recettes .rcp-savebase{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--fn-ds-text-soft,#5b5b51);margin-top:10px;cursor:pointer}
        #page-recettes .rcp-subtitle{font-size:15px;font-weight:800;margin-bottom:8px;color:var(--fn-ds-text,#211f1a);display:flex;align-items:center;gap:7px}
        #page-recettes .rcp-listhead{display:flex;justify-content:space-between;align-items:center;margin-top:16px;margin-bottom:6px}
        #page-recettes .rcp-side-tools{display:flex;gap:8px;margin-bottom:10px}
        #page-recettes .rcp-side-tools input{flex:1;padding:9px 12px;border-radius:11px;border:1px solid var(--fn-ds-border,rgba(97,74,46,.14));font:inherit;background:#fff;box-sizing:border-box}
        #page-recettes .rcp-btn{border-radius:999px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer;border:1px solid var(--fn-ds-border,rgba(97,74,46,.14));background:var(--fn-ds-surface-soft,#f3eadf);color:var(--fn-ds-text-soft,#5b5b51);transition:border-color .15s ease,background .15s ease,color .15s ease;white-space:nowrap}
        #page-recettes .rcp-btn:hover{border-color:var(--fn-ds-accent,#3f7a57);color:var(--fn-ds-text,#211f1a)}
        #page-recettes .rcp-btn-primary{background:var(--fn-ds-accent-soft,#e1efe2);border-color:transparent;color:var(--fn-ds-accent-strong,#2e5d42)}
        #page-recettes .rcp-btn-primary:hover{filter:brightness(.97);color:var(--fn-ds-accent-strong,#2e5d42)}
        #page-recettes .recipe-photo-preview{width:54px;height:54px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;background:var(--fn-ds-surface-soft,#f3eadf);border:1px solid var(--fn-ds-border,rgba(97,74,46,.14));flex:0 0 auto}
        #page-recettes .fn-page-header{margin-bottom:16px}
        @media(max-width:1024px){#page-recettes .rcp-grid{grid-template-columns:1fr}}
        @media(max-width:600px){#page-recettes .rcp-add{grid-template-columns:1fr}#page-recettes .rcp-row2{grid-template-columns:1fr}}
        /* Macros colorées (charte) + boutons liste */
        #page-recettes .macro-kcal,#page-recettes .recipe-ing-chip.macro-kcal{color:var(--fn-ds-kcal,#df7f2a)!important}
        #page-recettes .macro-prot,#page-recettes .recipe-ing-chip.macro-prot{color:var(--fn-ds-prot,#2878a8)!important}
        #page-recettes .macro-gluc,#page-recettes .recipe-ing-chip.macro-gluc{color:var(--fn-ds-gluc,#8266c7)!important}
        #page-recettes .macro-lip,#page-recettes .recipe-ing-chip.macro-lip{color:var(--fn-ds-lip,#c9932e)!important}
        #page-recettes .recipe-nutri-card.macro-kcal{background:var(--fn-ds-kcal-soft,#faead9)!important;border-color:color-mix(in srgb,var(--fn-ds-kcal,#df7f2a) 26%,var(--fn-ds-border))!important;color:var(--fn-ds-kcal,#df7f2a)!important}
        #page-recettes .recipe-nutri-card.macro-prot{background:var(--fn-ds-prot-soft,#e2f0f7)!important;border-color:color-mix(in srgb,var(--fn-ds-prot,#2878a8) 26%,var(--fn-ds-border))!important;color:var(--fn-ds-prot,#2878a8)!important}
        #page-recettes .recipe-nutri-card.macro-gluc{background:var(--fn-ds-gluc-soft,#eee8fa)!important;border-color:color-mix(in srgb,var(--fn-ds-gluc,#8266c7) 26%,var(--fn-ds-border))!important;color:var(--fn-ds-gluc,#8266c7)!important}
        #page-recettes .recipe-nutri-card.macro-lip{background:var(--fn-ds-lip-soft,#f6ecd6)!important;border-color:color-mix(in srgb,var(--fn-ds-lip,#c9932e) 26%,var(--fn-ds-border))!important;color:var(--fn-ds-lip,#c9932e)!important}
        #page-recettes .recipe-ing-chip{border-radius:999px;padding:3px 9px;font-weight:700;font-size:11px;border:1px solid var(--fn-ds-border,rgba(97,74,46,.14));background:var(--fn-ds-surface,#fffdf8)}
        #page-recettes .recipe-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
        #page-recettes .recipe-card-actions button{border-radius:999px;padding:6px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;border:1px solid var(--fn-ds-border,rgba(97,74,46,.14));background:var(--fn-ds-surface-soft,#f3eadf);color:var(--fn-ds-text-soft,#5b5b51);transition:border-color .15s ease,color .15s ease}
        #page-recettes .recipe-card-actions button:hover{border-color:var(--fn-ds-accent,#3f7a57);color:var(--fn-ds-text,#211f1a)}
        #page-recettes .recipe-card-actions button:nth-child(2){background:var(--fn-ds-accent-soft,#e1efe2);border-color:transparent;color:var(--fn-ds-accent-strong,#2e5d42)}
        #page-recettes .recipe-card-actions button:last-child{color:#b4452f}
        #page-recettes .recipe-card-actions button:last-child:hover{border-color:#b4452f;color:#b4452f}
        #page-recettes .recipe-suggestion-meta.food-macro-line{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}
      </style>
      <section class="fn-ui-panel fn-ui-panel-pad fn-page-header fn-page-header-recettes">
        <div class="fn-ui-title-row">
          <div class="fn-ui-title-left">
            <span aria-hidden="true" class="fn-ui-icon fn-icon">🍲</span>
            <div>
              <span class="fn-ui-kicker">Recettes</span>
              <h1 class="fn-ui-title fn-page-title">Recettes enregistrées</h1>
              <p class="fn-ui-sub fn-page-subtitle">Une recette FoodNote est un aliment composé maison : ingrédients CIQUAL, OpenFoodFacts, IA ou base locale, puis ajout rapide dans la journée.</p>
            </div>
          </div>
          <div class="fn-ui-actions">
            <button type="button" class="rcp-btn" onclick="FoodNoteRecipes.clearEditor()">+ Nouvelle recette</button>
            <button type="button" class="rcp-btn rcp-btn-primary" onclick="FoodNoteRecipes.openScanRecipe()">📷 Scanner une recette</button>
          </div>
        </div>
      </section>
      <div class="rcp-grid">
        <div class="rcp-col">
          <section class="rcp-step" id="recipe-editor-card">
            <div class="rcp-step-h"><span class="rcp-step-n">1</span><div><div class="rcp-step-t">La recette</div><div class="rcp-step-sub">L'essentiel</div></div><span id="recipe-origin-badge" class="rcp-origin">Manuelle</span></div>
            <div class="rcp-row2">
              <div class="rcp-field"><label>Nom de la recette</label><input id="recipe-name" type="text" placeholder="Ex : chili maison"></div>
              <div class="rcp-field"><label>Portions</label><input id="recipe-portions" type="number" min="0.1" step="0.5" value="4"></div>
            </div>
            <details class="rcp-opt"><summary>D\u00e9tails (optionnel) \u2014 poids final, notes, photo</summary>
              <div class="rcp-field" style="margin-top:8px"><label>Poids final (g)</label><input id="recipe-total-weight" type="number" min="0" step="1" placeholder="ex : 1800"></div>
              <div class="rcp-field"><label>Description / notes</label><textarea id="recipe-notes" rows="2" placeholder="Optionnel : cuisson, contexte, remarque IA..."></textarea></div>
              <input id="recipe-scan-photo" type="file" accept="image/*" capture="environment" style="display:none" onchange="FoodNoteRecipes.importScanPhoto(event)">
              <div id="recipe-scan-note" class="recipe-scan-note" style="display:none"></div>
              <div class="recipe-photo-row" style="display:flex;gap:12px;align-items:center;margin-top:6px">
                <div class="recipe-photo-preview" id="recipe-photo-preview">\u{1F4F7}</div>
                <div><label style="font-size:12px;color:var(--fn-ds-text-soft,#5b5b51)">Photo d'illustration optionnelle</label><input id="recipe-photo" type="file" accept="image/*" onchange="FoodNoteRecipes.loadPhoto(event)"><div style="font-size:11px;color:var(--fn-ds-muted,#8b8172);margin-top:4px">Image r\u00e9duite c\u00f4t\u00e9 navigateur avant sauvegarde SQLite.</div></div>
              </div>
            </details>
          </section>
          <section class="rcp-step">
            <div class="rcp-step-h"><span class="rcp-step-n">2</span><div><div class="rcp-step-t">Ingr\u00e9dients</div><div class="rcp-step-sub">Cherche, ou ajoute \u00e0 la main</div></div></div>
            <div class="rcp-add">
              <div class="rcp-field"><label>Recherche ingr\u00e9dient</label><input id="recipe-ing-search" type="search" placeholder="p\u00e2tes, cr\u00e8me, jambon..." oninput="FoodNoteRecipes.scheduleIngredientSearch()" onfocus="FoodNoteRecipes.scheduleIngredientSearch(80)" onkeydown="if(event.key==='Enter') FoodNoteRecipes.searchIngredient(true)"></div>
              <div class="rcp-field"><label>Quantit\u00e9</label><input id="recipe-ing-qty" type="number" min="0" step="1" value="100"></div>
              <button type="button" class="rcp-btn" onclick="FoodNoteRecipes.searchIngredient()">\u{1F50D} Chercher</button>
            </div>
            <div class="rcp-help">Les propositions apparaissent automatiquement pendant la saisie.</div>
            <div class="rcp-actions">
              <button type="button" class="rcp-btn" onclick="FoodNoteRecipes.addManualIngredient()">+ Ingr\u00e9dient manuel</button>
              <button type="button" class="rcp-btn" onclick="FoodNoteRecipes.clearEditor()">\u21ba Nouveau</button>
            </div>
            <label class="rcp-savebase"><input type="checkbox" id="recipe-save-manual-base"> Enregistrer les ingr\u00e9dients manuels dans ma base (r\u00e9utilisables)</label>
            <div id="recipe-ing-suggestions" class="recipe-suggestions"></div>
            <div class="rcp-listhead">
              <div class="rcp-subtitle" style="margin:0">\u{1F963} Ingr\u00e9dients de la recette</div>
              <span id="recipe-ingredient-count" class="rcp-origin" style="background:var(--fn-ds-surface-soft,#f3eadf);color:var(--fn-ds-text-soft,#5b5b51)">Aucun</span>
            </div>
            <div id="recipe-ingredients" class="recipe-ingredients"></div>
          </section>
          <section class="rcp-step">
            <div class="rcp-step-h"><span class="rcp-step-n">3</span><div><div class="rcp-step-t">Bilan &amp; enregistrement</div><div class="rcp-step-sub">Calcul\u00e9 automatiquement depuis les ingr\u00e9dients</div></div></div>
            <div id="recipe-totals" class="recipe-totals"></div>
            <div id="recipe-nutri-100g" class="recipe-nutri-100g"></div>
            <div class="rcp-actions" style="margin-top:14px">
              <button class="rcp-btn rcp-btn-primary" type="button" onclick="FoodNoteRecipes.save()">\u{1F4BE} Enregistrer la recette</button>
              <button class="rcp-btn" type="button" onclick="FoodNoteRecipes.saveAndAddToday()">\u{1F37D} Enregistrer + ajouter aujourd'hui</button>
            </div>
            <div id="recipe-status" class="recipe-status"></div>
          </section>
        </div>
        <aside class="rcp-side">
          <div class="rcp-subtitle">\u{1F4DA} Mes recettes</div>
          <div class="rcp-side-tools"><input id="recipe-list-search" type="search" placeholder="Filtrer les recettes..." oninput="FoodNoteRecipes.renderList()"><button class="rcp-btn" onclick="FoodNoteRecipes.load()">\u21bb</button></div>
          <div id="recipe-list" class="recipe-list"></div>
        </aside>
      </div>`;
  }

  function status(
msg, err = false) {
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
          <div class="recipe-nutri-card fn-mini-badge fn-mini-badge-kcal macro-kcal"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🔥</span><span>Calories</span></div><b>${kcal(t.kcal100)}</b><small>kcal / 100 g</small></div>
          <div class="recipe-nutri-card fn-mini-badge fn-mini-badge-protein macro-prot"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🍖</span><span>Protéines</span></div><b>${round1(t.prot100)}</b><small>g / 100 g</small></div>
          <div class="recipe-nutri-card fn-mini-badge fn-mini-badge-carbs macro-gluc"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🍞</span><span>Glucides</span></div><b>${round1(t.gluc100)}</b><small>g / 100 g</small></div>
          <div class="recipe-nutri-card fn-mini-badge fn-mini-badge-fat macro-lip"><div class="recipe-nutri-top"><span class="recipe-nutri-icon">🥑</span><span>Lipides</span></div><b>${round1(t.lip100)}</b><small>g / 100 g</small></div>
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
          <div class="recipe-suggestion-top"><span>${esc(it.nom || it.name)}</span><span class="recipe-source ${esc(it.source || 'base')}">${sourceIcon(it.source)} ${sourceName(it.source)}</span></div>
          <div class="recipe-suggestion-meta food-macro-line"><span class="macro-kcal">🔥 ${kcal(it.kcal100)} kcal/100g</span><span class="macro-prot">🍖 ${round1(it.prot100)}g</span><span class="macro-gluc">🍞 ${round1(it.gluc100)}g</span><span class="macro-lip">🥑 ${round1(it.lip100)}g</span></div>
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
  async function saveManualIngredientsToBase() {
    const manuals = ingredients.filter(it => (it.source === 'manual') && (it.name || it.nom) &&
      (num(it.kcal100) > 0 || num(it.prot100) > 0 || num(it.gluc100) > 0 || num(it.lip100) > 0));
    let okCount = 0;
    for (const it of manuals) {
      try {
        await apiJson('/api/foods/custom', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ nom: it.name || it.nom, unite:'g', source:'manual',
            kcal100: kcal(it.kcal100), prot100: round1(it.prot100), gluc100: round1(it.gluc100), lip100: round1(it.lip100) }) });
        okCount++;
      } catch(e) { /* on ignore les échecs individuels */ }
    }
    if (okCount) status('Recette + ' + okCount + ' ingrédient(s) manuel(s) enregistré(s) dans ta base.', false);
    return okCount;
  }
  async function save() {
    const p = payload();
    if (!p.name) { status('Nom de recette obligatoire.', true); return null; }
    if (!p.ingredients.length) { status('Ajoute au moins un ingrédient.', true); return null; }
    try {
      const data = await apiJson(editingId ? '/api/recipes/' + editingId : '/api/recipes', { method: editingId ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(p) });
      editingId = data.recipe.id;
      status('Recette enregistrée dans SQLite.', false);
      if ($('recipe-save-manual-base') && $('recipe-save-manual-base').checked) { await saveManualIngredientsToBase(); }
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
