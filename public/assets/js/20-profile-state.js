// ── Calcul automatique des cibles ─────────────────────────
function calcTDEE(poids, taille, age, sexe, activite) {
  // Mifflin-St Jeor + compatibilité anciens/nouveaux profils.
  const s = String(sexe || '').toLowerCase();
  const isFemale = s === 'f' || s === 'femme';
  const bmr = isFemale
    ? 10*poids + 6.25*taille - 5*age - 161
    : 10*poids + 6.25*taille - 5*age + 5;
  const rawActivity = String(activite ?? '').trim();
  const numericActivity = parseFloat(rawActivity.replace(',', '.'));
  const coefs = { sedentaire:1.2, sédentaire:1.2, leger:1.375, legere:1.375, légère:1.375, modere:1.55, moderee:1.55, modérée:1.55, actif:1.725, eleve:1.725, elevee:1.725, élevée:1.725, tres_actif:1.9, tres_elevee:1.9, très_élevée:1.9 };
  return Math.round(bmr * ((Number.isFinite(numericActivity) && numericActivity > 0) ? numericActivity : (coefs[rawActivity.toLowerCase()] || 1.55)));
}

function calcCiblesAuto(profil) {
  const poids = Number(profil.poids || profil.poidsRef || profil.weight || 0);
  const taille = Number(profil.taille || profil.height || 0);
  const age = Number(profil.age || 0);
  const sexe = profil.sexe || profil.gender || 'homme';
  const activite = profil.activite || profil.activityFactor || '1.55';
  const phase = profil.phase || profil.objectif || 'recomp';
  if (!poids || !taille || !age) return null;

  const tdee = calcTDEE(poids, taille, age, sexe || 'H', activite || 'modere');

  // Ajustement calories selon phase
  const facteurs = {
    reverse:  { kcal: 1.05, prot: 2.0, lip: 0.9 },
    perte:    { kcal: 0.80, prot: 2.2, lip: 0.8 },
    recomp:   { kcal: 1.00, prot: 2.0, lip: 1.0 },
    sechage:  { kcal: 0.75, prot: 2.4, lip: 0.7 },
    prise:    { kcal: 1.15, prot: 1.8, lip: 1.0 },
    maint:    { kcal: 1.00, prot: 1.6, lip: 1.0 },
  };
  const f = facteurs[phase] || facteurs.recomp;
  const kcal = Math.round(tdee * f.kcal);
  const prot = Math.round(poids * f.prot);
  const lip  = Math.round(poids * f.lip);
  const gluc = Math.max(50, Math.round((kcal - prot*4 - lip*9) / 4));

  return { tdee, kcal, prot, gluc, lip };
}
// ──────────────────────────────────────────────────────────

function defaultProfil() {
  return { prenom: '', phaseLabel: 'Mon suivi nutritionnel',
    cibleKcal: 2000, cibleProt: 120, cibleGluc: 220, cibleLip: 70 };
}

function loadProfil() {
  const saved = safeLocalGet('foodnote_profil', '');
  if (saved) {
    try { return { ...defaultProfil(), ...JSON.parse(saved) }; } catch(e) {}
  }
  return defaultProfil();
}


function foodnoteProfileIsMeaningful(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (profile.onboardingDone === true) return true;
  const textKeys = ['prenom','name','phase','objectif'];
  if (textKeys.some(k => String(profile[k] || '').trim())) return true;
  const numKeys = ['poids','poidsRef','taille','age','tdee'];
  if (numKeys.some(k => Number(profile[k] || 0) > 0)) return true;
  if (Array.isArray(profile.phases) && profile.phases.length) return true;
  const targets = ['cibleKcal','cibleProt','cibleGluc','cibleLip'];
  const defaults = defaultProfil();
  return targets.some(k => Number(profile[k] || 0) > 0 && Number(profile[k]) !== Number(defaults[k] || 0));
}

function saveProfil(p, opts = {}) {
  const profile = { ...defaultProfil(), ...(p || {}) };
  safeLocalSet('foodnote_profil', JSON.stringify(profile));
  PROFIL = { ...PROFIL, ...profile };
  try { window.PROFIL = { ...PROFIL }; } catch(_) {}
  if (!opts.localOnly && typeof fetch === 'function') {
    fetch('/api/profile', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(profile)
    }).catch(e => console.warn('/api/profile sauvegarde impossible', e));
  }
}

async function syncProfilFromServer() {
  const local = loadProfil();
  try {
    const r = await fetch('/api/profile');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();

    // Compatibilité avec les anciens ZIP et avec la route moderne :
    // - moderne : { exists:true, profile:{...}, phases:[...] }
    // - ancien   : { prenom:'...', phases:[...] }
    let serverProfile = null;
    const serverSaysExists = d && d.exists !== false;
    if (d && d.profile && typeof d.profile === 'object' && (serverSaysExists || foodnoteProfileIsMeaningful(d.profile))) serverProfile = d.profile;
    else if (d && typeof d === 'object' && foodnoteProfileIsMeaningful(d)) serverProfile = d;

    if (serverProfile && foodnoteProfileIsMeaningful(serverProfile)) {
      const phases = Array.isArray(d?.phases) && d.phases.length ? d.phases : (Array.isArray(serverProfile.phases) ? serverProfile.phases : []);
      const merged = { ...defaultProfil(), ...serverProfile };
      if (phases.length) {
        merged.phases = phases;
        merged.phase = merged.phase || phases[0]?.id;
        merged.phaseLabel = phases.map(ph => (ph.label || ph.name || ph.id) + ' (' + (ph.weeks || 1) + 'sem)').join(' → ');
      }
      saveProfil(merged, { localOnly:true });
      PROFIL = { ...PROFIL, ...merged };
      try { window.PROFIL = { ...PROFIL }; } catch(_) {}
      return merged;
    }

    // Premier passage après migration : pousser UNIQUEMENT un vrai profil utilisateur vers SQLite.
    // Sur un nouvel appareil, loadProfil() renvoie les valeurs par défaut (cibleKcal/phaseLabel),
    // il ne faut surtout pas les écrire côté serveur sinon l'app croit à un first setup incomplet.
    if (foodnoteProfileIsMeaningful(local)) {
      saveProfil(local);
    }
  } catch(e) {
    console.warn('/api/profile indisponible, profil localStorage utilisé', e);
  }
  return local;
}

async function saveSettingRemote(key, value) {
  try {
    await fetch('/api/settings/' + encodeURIComponent(key), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({value})
    });
  } catch(e) { console.warn('/api/settings sauvegarde impossible', key, e); }
}

async function loadSettingRemote(key) {
  try {
    const r = await fetch('/api/settings/' + encodeURIComponent(key));
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.exists ? d.value : null;
  } catch(e) { return null; }
}

// ── Options applicatives persistées côté SQLite ─────────────────────────
const FOODNOTE_FEATURE_DEFAULTS = { aiEnabled: true };
let FOODNOTE_FEATURES = { ...FOODNOTE_FEATURE_DEFAULTS };

function isAIEnabled() {
  return FOODNOTE_FEATURES.aiEnabled !== false;
}

async function loadFeatureSettings() {
  let local = null;
  try { local = JSON.parse(safeLocalGet('foodnote_features', 'null')); } catch(e) {}
  FOODNOTE_FEATURES = { ...FOODNOTE_FEATURE_DEFAULTS, ...(local || {}) };
  try {
    const remote = await loadSettingRemote('features');
    if (remote && typeof remote === 'object') {
      FOODNOTE_FEATURES = { ...FOODNOTE_FEATURE_DEFAULTS, ...remote };
      safeLocalSet('foodnote_features', JSON.stringify(FOODNOTE_FEATURES));
    }
  } catch(e) {}
  applyFeatureToggles();
  return FOODNOTE_FEATURES;
}

function saveFeatureSettings() {
  safeLocalSet('foodnote_features', JSON.stringify(FOODNOTE_FEATURES));
  saveSettingRemote('features', FOODNOTE_FEATURES);
}

function applyFeatureToggles() {
  const ai = isAIEnabled();
  document.body.classList.toggle('ai-disabled', !ai);
  document.documentElement.classList.toggle('ai-disabled', !ai);
  document.querySelectorAll('[data-feature="ia"]').forEach(el => {
    el.style.display = ai ? '' : 'none';
  });
  document.querySelectorAll('.food-mini-btn.groq').forEach(el => {
    el.style.display = ai ? '' : 'none';
  });
  // Important : activer l'IA ne doit pas afficher toutes les lignes Groq cachées.
  // Elles ne doivent s'ouvrir que sur clic explicite du bouton Groq de l'aliment.
  document.querySelectorAll('[id^="ia-row-"]').forEach(el => {
    if (!ai) {
      el.style.display = 'none';
      el.removeAttribute('data-opened-by-user');
    } else if (el.dataset.openedByUser === '1') {
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  });
  const toggle = document.getElementById('feature-ai-toggle');
  if (toggle) toggle.checked = ai;
  const status = document.getElementById('feature-ai-status');
  if (status) status.textContent = ai
    ? 'IA activée : les outils Groq et les champs “question IA” sont visibles.'
    : 'Mode sans IA actif : les menus, boutons et champs IA sont masqués.';
  const pageIA = document.getElementById('page-ia');
  if (!ai && pageIA && pageIA.classList.contains('active') && typeof showPage === 'function') {
    showPage('journal', document.getElementById('nav-journal'));
  }
}

function toggleAIFeature(enabled) {
  FOODNOTE_FEATURES.aiEnabled = !!enabled;
  saveFeatureSettings();
  applyFeatureToggles();
}

let PROFIL = loadProfil();
try { window.PROFIL = { ...PROFIL }; } catch(_) {}

let quantities = {}, selected = new Set();
let customAliments = [], allAliments = [];
let sportRows = [];
let sportCounter = 0;
