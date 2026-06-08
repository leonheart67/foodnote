/*
 * FoodNote — IA photo repas Groq
 * Rôle : ajouter une estimation repas par photo dans la page IA existante.
 * Gère : sélection/capture image, compression navigateur, appel serveur Groq Vision,
 *         conversion en tableau compatible avec le parseur IA texte FoodNote.
 * Ne gère pas : clé Groq côté navigateur, stockage image, ajout direct dans la journée.
 */
(function () {
  'use strict';

  const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const PATCH_ID = 'ia-photo-meal-card';

  let selectedImage = null;
  let selectedFileName = '';

  function $(selector) {
    return document.querySelector(selector);
  }

  function setStatus(message, tone) {
    const el = $('#ia-photo-status');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.tone = tone || '';
    el.style.color = tone === 'error'
      ? 'var(--red, #dc2626)'
      : tone === 'ok'
        ? 'var(--green, #16a34a)'
        : 'var(--text3, #6b7280)';
  }

  function estimateBase64Bytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.floor(base64.length * 3 / 4);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Lecture de la photo impossible.'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image illisible.'));
      img.src = dataUrl;
    });
  }

  async function compressImageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      throw new Error('Choisis une image valide.');
    }

    const original = await readFileAsDataUrl(file);
    const img = await loadImage(original);
    let maxSide = 1280;
    let quality = 0.82;
    let best = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
      const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Compression image indisponible sur ce navigateur.');
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const bytes = estimateBase64Bytes(dataUrl);
      best = { dataUrl, bytes, width, height };
      if (bytes <= MAX_IMAGE_BYTES) return best;

      quality -= 0.1;
      if (quality < 0.45) {
        quality = 0.78;
        maxSide = Math.max(640, Math.floor(maxSide * 0.82));
      }
    }

    throw new Error(`Image encore trop lourde (${Math.round((best?.bytes || 0) / 1024 / 1024 * 10) / 10} MB). Recadre ou prends une photo plus légère.`);
  }

  function renderPhotoPreview(imageInfo) {
    const img = $('#ia-photo-preview');
    const meta = $('#ia-photo-meta');
    const clearBtn = $('#ia-photo-clear-btn');
    if (img) {
      img.src = imageInfo?.dataUrl || '';
      img.hidden = !imageInfo;
    }
    if (meta) {
      meta.textContent = imageInfo
        ? `${selectedFileName || 'Photo'} · ${imageInfo.width}×${imageInfo.height} · ${Math.round(imageInfo.bytes / 1024)} KB après compression`
        : 'Aucune photo sélectionnée.';
    }
    if (clearBtn) clearBtn.hidden = !imageInfo;
  }

  async function handleFile(file) {
    try {
      setStatus('Compression de la photo…');
      selectedFileName = file?.name || 'Photo repas';
      selectedImage = await compressImageFile(file);
      renderPhotoPreview(selectedImage);
      setStatus('Photo prête. Lance l’analyse quand tu veux.', 'ok');
    } catch (e) {
      selectedImage = null;
      selectedFileName = '';
      renderPhotoPreview(null);
      setStatus(e.message || 'Photo impossible à préparer.', 'error');
    }
  }

  function openFileInput(kind) {
    const input = kind === 'camera' ? $('#ia-photo-camera') : $('#ia-photo-file');
    if (input) input.click();
  }

  function clearPhoto() {
    selectedImage = null;
    selectedFileName = '';
    const fileInput = $('#ia-photo-file');
    const cameraInput = $('#ia-photo-camera');
    if (fileInput) fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
    renderPhotoPreview(null);
    setStatus('Photo retirée.');
  }

  function pickVisionModel() {
    const existing = String($('#groq-model-input')?.value || '').trim();
    if (/llama-4|vision|scout|maverick/i.test(existing)) return existing;
    return DEFAULT_VISION_MODEL;
  }

  function numberCell(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 10) / 10).replace('.', ',');
  }

  function itemsToFoodNoteTable(items) {
    const lines = ['Nom | Quantité (g) | Kcal | Protéines (g) | Glucides (g) | Lipides (g)'];
    (items || []).forEach((item) => {
      lines.push([
        String(item.nom || '').trim(),
        numberCell(item.qty),
        numberCell(item.kcal),
        numberCell(item.prot),
        numberCell(item.gluc),
        numberCell(item.lip),
      ].join(' | '));
    });
    return lines.join('\n');
  }

  function showGroqVisionResponse(data, table) {
    const responseEl = $('#groq-page-response') || $('#groq-response');
    if (!responseEl) return;

    const notes = Array.isArray(data.notes) && data.notes.length
      ? `<div style="margin-top:8px;color:var(--text3);font-size:12px">Notes : ${data.notes.map(escapeHtml).join(' · ')}</div>`
      : '';

    responseEl.style.display = 'block';
    responseEl.innerHTML = `
      <div style="font-weight:650;color:var(--text);margin-bottom:8px">Réponse Groq Vision</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:8px">${data.items.length} aliment(s) détecté(s). Prévisualisation générée, à corriger avant validation.</div>
      <pre style="font-size:12px;font-family:monospace;white-space:pre-wrap;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px;overflow:auto">${escapeHtml(table)}</pre>
      ${notes}
    `;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  async function estimatePhotoMeal() {
    if (!selectedImage?.dataUrl) {
      setStatus('Choisis ou prends une photo avant de lancer l’analyse.', 'error');
      return;
    }

    const btn = $('#ia-photo-estimate-btn');
    const previousLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Analyse Groq…';
    }

    try {
      setStatus('Groq Vision analyse le repas…');
      const mealHint = String($('#ia-estimate-text')?.value || '').trim();
      const res = await fetch('/api/groq/vision-meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: selectedImage.dataUrl,
          mealHint,
          model: pickVisionModel(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur Groq Vision ${res.status}`);
      if (!Array.isArray(data.items) || !data.items.length) {
        throw new Error('Aucun aliment exploitable détecté.');
      }

      const table = itemsToFoodNoteTable(data.items);
      const input = $('#ia-estimate-text');
      if (input) input.value = table;
      window._groqReponse = table;
      showGroqVisionResponse(data, table);

      if (typeof window.parseIAPaste === 'function') {
        window.parseIAPaste('page');
        setStatus('Prévisualisation générée. Corrige si besoin, puis valide manuellement.', 'ok');
      } else {
        setStatus('Tableau généré. Le parseur IA texte est introuvable, colle/valide manuellement.', 'error');
      }
    } catch (e) {
      setStatus(e.message || 'Erreur pendant l’analyse photo.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = previousLabel || 'Analyser la photo';
      }
    }
  }

  function renderPhotoEstimator() {
    const host = $('#ia-meal-card');
    if (!host || document.getElementById(PATCH_ID)) return;

    const block = document.createElement('div');
    block.id = PATCH_ID;
    block.className = 'fn-ui-tile fn-ui-tile-pad';
    block.style.marginBottom = '12px';
    block.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div style="font-weight:700;color:var(--text)">Photo du repas</div>
          <div style="font-size:12px;color:var(--text3);line-height:1.45;margin-top:3px">Groq propose une estimation, FoodNote affiche une prévisualisation, tu corriges puis tu valides.</div>
        </div>
        <span style="font-size:11px;color:var(--text3);border:1px solid var(--border);border-radius:999px;padding:4px 8px">Image non stockée</span>
      </div>
      <input id="ia-photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden>
      <input id="ia-photo-camera" type="file" accept="image/*" capture="environment" hidden>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" id="ia-photo-choose-btn">📷 Choisir une photo</button>
        <button type="button" id="ia-photo-camera-btn">📱 Caméra</button>
        <button type="button" id="ia-photo-estimate-btn" class="btn-primary">✨ Analyser la photo</button>
        <button type="button" id="ia-photo-clear-btn" hidden>Retirer</button>
      </div>
      <div style="display:grid;grid-template-columns:minmax(96px,140px) 1fr;gap:10px;align-items:center">
        <img id="ia-photo-preview" alt="Prévisualisation photo repas" hidden style="width:100%;max-height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--border);background:var(--bg)">
        <div>
          <div id="ia-photo-meta" style="font-size:12px;color:var(--text3);line-height:1.45">Aucune photo sélectionnée.</div>
          <div id="ia-photo-status" style="font-size:12px;color:var(--text3);line-height:1.45;margin-top:4px"></div>
        </div>
      </div>
    `;

    const textarea = $('#ia-estimate-text');
    const field = textarea?.closest('.fn-ui-field') || textarea?.parentElement;
    if (field && field.parentElement === host) host.insertBefore(block, field);
    else host.appendChild(block);

    $('#ia-photo-choose-btn')?.addEventListener('click', () => openFileInput('file'));
    $('#ia-photo-camera-btn')?.addEventListener('click', () => openFileInput('camera'));
    $('#ia-photo-estimate-btn')?.addEventListener('click', estimatePhotoMeal);
    $('#ia-photo-clear-btn')?.addEventListener('click', clearPhoto);
    $('#ia-photo-file')?.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
    $('#ia-photo-camera')?.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
  }

  function init() {
    renderPhotoEstimator();
  }

  window.FoodNoteIaPhotoEstimator = {
    init,
    estimatePhotoMeal,
    clearPhoto,
    openFileInput,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
