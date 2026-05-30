function safeLocalGet(key, fallback = '') {
  try {
    const v = window.localStorage ? window.localStorage.getItem(key) : null;
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function safeLocalSet(key, value) {
  try {
    if (window.localStorage) window.localStorage.setItem(key, value);
  } catch (e) {}
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function round1(value) {
  const n = Number(value) || 0;
  return Math.round(n * 10) / 10;
}
