/*
 * FoodNote — Home Assistant MQTT runtime
 * Rôle : Gérer la carte MQTT, les appels serveur et les actions de publication Home Assistant.
 * Ne doit pas gérer : l'apparence CSS, les secrets MQTT côté serveur ou les calculs nutritionnels.
 */
(function(){
  'use strict';
  const BUILD = 'foodnote_beta_0_22_179_capture_search_select_qty_fix_20260530';
  function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  async function fetchJson(url, options){ const r=await fetch(url, options||{cache:'no-store'}); const text=await r.text(); let data={}; try{data=JSON.parse(text||'{}')}catch(e){throw new Error('Réponse non JSON: '+text.slice(0,80).replace(/\s+/g,' '));} if(!r.ok||data.ok===false) throw new Error(data.error||('HTTP '+r.status)); return data; }
  function currentDate(){ try{ if(typeof selectedDate!=='undefined' && selectedDate) return selectedDate; }catch(_){} return new Date().toISOString().slice(0,10); }
  function pill(status){ if(!status?.config?.enabled) return '<span id="fn-mqtt-pill" class="fn-ui-chip fn-ui-chip-lip">MQTT désactivé</span>'; if(!status?.config?.configured) return '<span id="fn-mqtt-pill" class="fn-ui-chip fn-ui-chip-lip">Broker non configuré</span>'; if(status?.state?.connected) return '<span id="fn-mqtt-pill" class="fn-ui-chip fn-ui-chip-prot">Connecté</span>'; return '<span id="fn-mqtt-pill" class="fn-ui-chip fn-ui-chip-gluc">Non connecté</span>'; }
  function envHelp(){ return `FOODNOTE_MQTT_ENABLED=1\nFOODNOTE_MQTT_URL=mqtt://IP_HOME_ASSISTANT:1883\nFOODNOTE_MQTT_USERNAME=ton_user_mqtt\nFOODNOTE_MQTT_PASSWORD=ton_mot_de_passe\nFOODNOTE_MQTT_BASE_TOPIC=foodnote\nFOODNOTE_MQTT_DISCOVERY=1`; }
  function card(){ return `
    <div class="card fn-ui-surface data-card fn-mqtt-card" id="fn-mqtt-card">
      <div class="fn-mqtt-head">
        <div class="fn-mqtt-title-wrap"><div class="fn-mqtt-icon" aria-hidden="true">🏠</div><div><div class="fn-mqtt-title">Home Assistant &amp; MQTT</div><div class="fn-mqtt-sub">Publication optionnelle des calories, macros, sport et poids du jour vers Home Assistant avec découverte automatique MQTT.</div></div></div>
        <div id="fn-mqtt-pill" class="fn-mqtt-status-pill">Vérification...</div>
      </div>
      <div class="fn-mqtt-actions">
        <button class="btn-primary" type="button" onclick="FoodNoteMQTT.refresh(true)">↻ Vérifier MQTT</button>
        <button type="button" onclick="FoodNoteMQTT.publishDiscovery()">🏠 Découverte Home Assistant</button>
        <button type="button" onclick="FoodNoteMQTT.publishToday()">📡 Publier journée</button>
        <button type="button" onclick="FoodNoteMQTT.test()">🧪 Test MQTT</button>
      </div>
      <div id="fn-mqtt-grid" class="fn-mqtt-grid"></div>
      <div id="fn-mqtt-result" class="fn-mqtt-result"></div>
    </div>`; }
  function ensureCard(){ const page=document.getElementById('page-donnees'); if(!page || document.getElementById('fn-mqtt-card')) return; const anchor=document.getElementById('fn-stability-card') || document.getElementById('donnees-status') || page.querySelector('.data-hero-card'); if(anchor) anchor.insertAdjacentHTML('afterend', card()); else page.insertAdjacentHTML('afterbegin', card()); }
  function renderStatus(data, show){ ensureCard(); const cfg=data?.config||{}, st=data?.state||{}; const pillEl=document.getElementById('fn-mqtt-pill'); if(pillEl){ pillEl.outerHTML=pill(data); }
    const grid=document.getElementById('fn-mqtt-grid'); if(grid){ grid.innerHTML=[
      ['État', cfg.enabled ? (st.connected?'connecté':'activé mais non connecté') : 'désactivé'], ['Broker', cfg.url || 'non configuré'], ['Topic état', cfg.state_topic || '-'], ['Topic événement', cfg.event_topic || '-'], ['Découverte HA', cfg.discovery ? (cfg.discovery_prefix||'homeassistant') : 'désactivée'], ['Dernière publication', st.last_publish?.at ? new Date(st.last_publish.at).toLocaleString('fr-FR') : 'aucune']
    ].map(([k,v])=>`<div class="fn-ui-feature"><span>•</span><div><b>${esc(k)}</b><small>${esc(v)}</small></div></div>`).join(''); }
    if(show){ const res=document.getElementById('fn-mqtt-result'); if(res){ let extra=''; if(!cfg.enabled || !cfg.configured){ extra='<span class="fn-mqtt-code">'+esc(envHelp())+'</span>'; } if(st.last_error){ extra += '<div style="margin-top:8px;color:#f87171">Erreur : '+esc(st.last_error)+'</div>'; } res.innerHTML='Statut MQTT mis à jour.'+extra; res.classList.add('visible'); res.style.display='block'; }}
  }
  function showResult(html){ const el=document.getElementById('fn-mqtt-result'); if(!el) return; el.innerHTML=html; el.classList.add('visible'); el.style.display='block'; }
  async function refresh(show){ ensureCard(); try{ const data=await fetchJson('/api/mqtt/status?ts='+Date.now(),{cache:'no-store'}); renderStatus(data, !!show); return data; }catch(e){ showResult('<span style="color:#f87171">MQTT : '+esc(e.message)+'</span>'); throw e; } }
  async function publishDiscovery(){ try{ const data=await fetchJson('/api/mqtt/discovery',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'}); renderStatus(data.status||{}, false); showResult('Découverte Home Assistant publiée : '+esc(data.result?.entities||0)+' entités.'); }catch(e){ showResult('<span style="color:#f87171">Découverte impossible : '+esc(e.message)+'</span>'); await refresh(false).catch(()=>{}); } }
  async function publishToday(){ const date=currentDate(); try{ const data=await fetchJson('/api/mqtt/publish-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date}),cache:'no-store'}); renderStatus(data.status||{}, false); const p=data.result?.payload||{}; showResult('Journée publiée sur MQTT : <strong>'+esc(date)+'</strong><br>'+esc(p.kcal)+' kcal · '+esc(p.prot)+'g prot · sport '+esc(p.sport_kcal)+' kcal'); }catch(e){ showResult('<span style="color:#f87171">Publication impossible : '+esc(e.message)+'</span>'); await refresh(false).catch(()=>{}); } }
  async function test(){ try{ const data=await fetchJson('/api/mqtt/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'}); renderStatus(data.status||{}, false); showResult('Test MQTT envoyé sur <code>'+esc(data.topic)+'</code>.'); }catch(e){ showResult('<span style="color:#f87171">Test impossible : '+esc(e.message)+'</span>'); await refresh(false).catch(()=>{}); } }
  function patchNavigation(){ if(window.__fnMqttNavPatched) return; window.__fnMqttNavPatched=true; const original=window.showPage; if(typeof original==='function'){ window.showPage=function(){ const out=original.apply(this,arguments); setTimeout(()=>refresh(false).catch(()=>{}),0); return out; }; } }
  function init(){ ensureCard(); patchNavigation(); refresh(false).catch(()=>{}); }
  window.FoodNoteMQTT={refresh,publishDiscovery,publishToday,test,ensureCard:init};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  setTimeout(init,500); setTimeout(init,1400);
})();
