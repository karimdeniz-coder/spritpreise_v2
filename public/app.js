'use strict';

const TELFS = { lat: 47.3008, lng: 11.0667 };
const REFRESH_MS = 5 * 60 * 1000;
const FUEL_LABEL = { super95: 'Super 95', diesel: 'Diesel', gas: 'Erdgas' };
const FUEL_COLOR = { super95: 'var(--green)', diesel: 'var(--yellow)', gas: 'var(--orange)' };
const DAY_SHORT  = ['SO','MO','DI','MI','DO','FR','SA'];

const BRAND_ICONS = {
  omv:'🔵', shell:'🐚', jet:'🔴', eni:'🟡', agip:'🐶',
  avanti:'🟢', bp:'🌿', esso:'🔷', disk:'💳', lagerhaus:'🌾',
  wt:'⛽', turmöl:'🏛️', waldhart:'⛽',
};

let map, userMarker, startMarker;
let stationMarkers = [];
let stations = [];
let userPos = null, watchId = null;
let customStart = null, pickingStart = false;
// searchCenter: gesetzt wenn User einen Ort sucht → hat Priorität für Entfernungsberechnung
let searchCenter = null;
let mapCenter = { ...TELFS };
let refreshTimer, lastFetch;
let searchTimeout;
let panelOpen = false;
let showClosed = true;

const state = { fuels:{ super95:true, diesel:true, gas:false }, sort:'price', brand:'', radius:30 };

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ── Toast ─────────────────────────────────────────────────────────────── */
function toast(msg, ms=2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ── Map ───────────────────────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', { zoomControl:false }).setView([TELFS.lat, TELFS.lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'© OpenStreetMap', maxZoom:19,
  }).addTo(map);
  L.control.zoom({ position:'bottomright' }).addTo(map);

  map.on('click', e => {
    $('#searchResults').classList.add('hidden');
    if (pickingStart) {
      customStart = { lat:e.latlng.lat, lng:e.latlng.lng };
      pickingStart = false;
      document.body.style.cursor = '';
      renderStartMarker(); renderAll();
      toast('Startpunkt gesetzt 📌');
      return;
    }
    hideSheet();
  });
}

/* ── Distance ──────────────────────────────────────────────────────────── */
function km(a, b) {
  const R=6371, r=d=>d*Math.PI/180;
  const dLa=r(b.lat-a.lat), dLo=r(b.lng-a.lng);
  const h=Math.sin(dLa/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

// Priorität: 1) customStart 2) searchCenter 3) userPos 4) mapCenter
function distOrigin() { return customStart || searchCenter || userPos || mapCenter; }
function navOrigin()  { return customStart || searchCenter || userPos || mapCenter; }

/* ── API ───────────────────────────────────────────────────────────────── */
async function loadStations(silent=false) {
  if (!silent) { spin(true); renderSkeletons(); }
  try {
    const c = mapCenter;
    const res = await fetch(`/api/stations?lat=${c.lat}&lng=${c.lng}&radius=${state.radius}`);
    const data = await res.json();
    if (data.error) { showErr(data.error); return; }
    stations = data.stations || [];
    lastFetch = new Date();
    $('#liveIndicator').classList.add('visible');
    updateMeta(); populateBrands(); renderAll();
  } catch(e) { showErr('Netzwerkfehler – bitte neu laden.'); }
  finally { spin(false); }
}

function spin(on) { $('#refreshBtn').classList.toggle('spinning', on); }
function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadStations(true), REFRESH_MS);
}
function updateMeta() {
  if (!lastFetch) return;
  const t = lastFetch.toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'});
  $('#lastUpdate').textContent = `${t} · alle 5 Min`;
}

/* ── Geocode / Search ──────────────────────────────────────────────────── */
function setupSearch() {
  const inp = $('#searchInput'), res = $('#searchResults'), clr = $('#searchClear');

  inp.addEventListener('input', () => {
    const q = inp.value.trim();
    clr.classList.toggle('hidden', !q);
    clearTimeout(searchTimeout);
    if (q.length < 2) { res.classList.add('hidden'); return; }
    searchTimeout = setTimeout(async () => {
      try {
        const places = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`).then(r=>r.json());
        if (!places.length) { res.classList.add('hidden'); return; }
        res.innerHTML = places.map((p,i) => `
          <div class="search-result-item" data-i="${i}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 10c0 6-8 13-8 13s-8-7-8-13a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            ${p.name}
          </div>`).join('');
        res._places = places;
        res.classList.remove('hidden');
      } catch {}
    }, 300);
  });

  clr.addEventListener('click', () => {
    inp.value = ''; clr.classList.add('hidden');
    res.classList.add('hidden');
    searchCenter = null;  // Reset search center
    inp.focus();
  });

  res.addEventListener('click', e => {
    const item = e.target.closest('.search-result-item'); if (!item) return;
    const p = res._places[+item.dataset.i];

    // Suchort als Distanzbasis setzen
    searchCenter = { lat:p.lat, lng:p.lng };
    mapCenter    = { lat:p.lat, lng:p.lng };

    map.setView([p.lat, p.lng], 13, { animate:true });
    inp.value = p.name.split(',')[0];
    clr.classList.remove('hidden');
    res.classList.add('hidden');
    loadStations();
    toast(`📍 Entfernungen ab ${p.name.split(',')[0]}`);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) res.classList.add('hidden');
  });
}

/* ── Filter / Sort ─────────────────────────────────────────────────────── */
function populateBrands() {
  const sel=$('#brandSelect'), cur=sel.value;
  const brands=[...new Set(stations.map(s=>s.brand))].sort();
  sel.innerHTML='<option value="">Alle Marken</option>'+brands.map(b=>`<option value="${b}">${b}</option>`).join('');
  if (brands.includes(cur)) sel.value=cur;
}

function activeFuels() { return Object.keys(state.fuels).filter(k=>state.fuels[k]); }
function bestPrice(s) {
  const vals = activeFuels().map(k=>s.prices[k]).filter(v=>v!=null);
  return vals.length ? Math.min(...vals) : null;
}

function getList() {
  const origin = distOrigin();
  return stations
    .filter(s => {
      if (!showClosed && !s.open) return false;
      if (state.brand && s.brand !== state.brand) return false;
      return true;
    })
    .map(s => ({ ...s, dist: km(origin, s) }))
    .filter(s => s.dist <= state.radius)
    .sort((a, b) => {
      if (state.sort === 'price')    return (bestPrice(a)??999) - (bestPrice(b)??999);
      if (state.sort === 'distance') return a.dist - b.dist;
      return a.name.localeCompare(b.name);
    });
}

/* ── Brand helpers ─────────────────────────────────────────────────────── */
function getBrandIcon(brand='') {
  const bl = brand.toLowerCase();
  for (const [k,ico] of Object.entries(BRAND_ICONS)) if (bl.includes(k)) return ico;
  return '⛽';
}
function abbr(s) { return (s||'?').slice(0,4).toUpperCase(); }

/* ── Render helpers ────────────────────────────────────────────────────── */
function renderSkeletons() {
  $('#stationList').innerHTML = Array(6).fill('<div class="skeleton"></div>').join('');
}
function showErr(msg) {
  $('#stationList').innerHTML = `<div class="error-card">⚠️ ${msg}</div>`;
}

/* ── Map Markers ───────────────────────────────────────────────────────── */
function renderMarkers(list) {
  stationMarkers.forEach(m => map.removeLayer(m));
  stationMarkers = [];
  if (!list.length) return;

  const cheapId = [...list].filter(s=>bestPrice(s)!=null).sort((a,b)=>(bestPrice(a)||999)-(bestPrice(b)||999))[0]?.id;

  list.forEach((s, idx) => {
    const price = bestPrice(s);
    const label = price != null ? `${price.toFixed(3)} €` : '–';
    const isCheap = s.id === cheapId;
    const isClosed = !s.open;
    const icon = L.divIcon({
      html: `<div class="mk${isCheap?' cheapest-mk':''}${isClosed?' mk-closed':''}">
        <div class="mk-body" style="background:${s.brandBg||'#334155'}">
          ${getBrandIcon(s.brand)}
        </div>
        <div class="mk-price" style="color:${price!=null?(isClosed?'':'var(--green)'):'var(--muted)'}">${label}</div>
      </div>`,
      className:'', iconSize:[60,56], iconAnchor:[30,28],
    });
    const m = L.marker([s.lat, s.lng], { icon, riseOnHover:true }).addTo(map);
    m.on('click', () => { openSheet(s.id, list); });
    stationMarkers.push(m);
  });
}

function renderUserMarker() {
  if (userMarker) map.removeLayer(userMarker);
  if (!userPos) return;
  userMarker = L.marker([userPos.lat, userPos.lng], {
    icon: L.divIcon({ html:'<div class="user-ring"></div>', className:'', iconSize:[20,20], iconAnchor:[10,10] }),
    zIndexOffset:1000,
  }).addTo(map);
}

function renderStartMarker() {
  if (startMarker) map.removeLayer(startMarker);
  if (!customStart) return;
  startMarker = L.marker([customStart.lat, customStart.lng], {
    icon: L.divIcon({ html:'<div class="start-ring"></div>', className:'', iconSize:[16,16], iconAnchor:[8,8] }),
    zIndexOffset:900,
  }).addTo(map);
}

/* ── Station List ──────────────────────────────────────────────────────── */
function renderList(list) {
  const cont = $('#stationList');
  const count = list.length;
  $('#fabCount').textContent = count;
  updatePeekLabel(count);

  if (!count) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔍</div>
      <div class="empty-text">Keine Tankstellen gefunden.<br>Radius erhöhen oder anderen Ort suchen.</div>
    </div>`;
    return;
  }

  const cheapId = [...list].filter(s=>bestPrice(s)!=null).sort((a,b)=>(bestPrice(a)||999)-(bestPrice(b)||999))[0]?.id;
  const FUELS = ['super95','diesel','gas'];

  cont.innerHTML = list.map((s, i) => {
    const isCheap  = s.id === cheapId;
    const isClosed = !s.open;
    const priceRows = FUELS
      .filter(k => s.prices[k] != null)
      .map(k => `<div class="pr">
        <span class="pr-lbl">${FUEL_LABEL[k]}</span>
        <span class="pr-val" style="color:${FUEL_COLOR[k]}">${s.prices[k].toFixed(3)}</span>
      </div>`).join('');

    const statusText = isClosed
      ? `<span class="s-text" style="color:var(--red)">Geschlossen</span>${s.todayHours?`<span class="s-hours">· Heute ${s.todayHours}</span>`:''}`
      : `<span class="s-text" style="color:var(--green)">Geöffnet</span>${s.todayHours?`<span class="s-hours">· ${s.todayHours}</span>`:''}`;

    return `<div class="station-card${isCheap?' cheapest':''}${isClosed?' closed':''}"
        data-id="${s.id}" style="animation-delay:${Math.min(i*0.03,0.3)}s">
      <div class="card-stripe" style="background:${s.brandBg||'#334155'}"></div>
      <div class="card-inner">
        <div class="badge" style="background:${s.brandBg||'#334155'};color:${s.brandText||'#fff'}">
          <span class="badge-icon">${getBrandIcon(s.brand)}</span>
          <span class="badge-abbr">${abbr(s.brand)}</span>
        </div>
        <div class="card-info">
          <div class="card-name">${s.name}</div>
          <div class="card-addr">${s.dist.toFixed(1)} km · ${s.address}</div>
          <div class="card-status">
            <div class="s-dot ${isClosed?'closed':'open'}"></div>
            ${statusText}
          </div>
        </div>
        <div class="card-prices">
          ${isCheap ? '<div class="best-badge">★ GÜNSTIGSTE</div>' : ''}
          ${priceRows || '<span style="font-size:.7rem;color:var(--muted)">k.A.</span>'}
        </div>
      </div>
    </div>`;
  }).join('');

  cont.querySelectorAll('.station-card').forEach(el => {
    el.addEventListener('click', () => openSheet(el.dataset.id, list));
  });
}

function renderAll() {
  const list = getList();
  renderMarkers(list);
  renderList(list);
  renderUserMarker();
  renderStartMarker();
}

/* ── Detail Sheet ──────────────────────────────────────────────────────── */
function openSheet(id, list) {
  const s = (list || getList()).find(st => st.id === id);
  if (!s) return;

  const origin  = navOrigin();
  const gmaps   = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${s.lat},${s.lng}&travelmode=driving`;
  const apple   = `https://maps.apple.com/?saddr=${origin.lat},${origin.lng}&daddr=${s.lat},${s.lng}&dirflg=d`;
  const isClosed = !s.open;
  const todayDay = DAY_SHORT[new Date().getDay()];
  const t = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'}) : '–';

  const FUELS = ['super95','diesel','gas'];
  const priceTiles = FUELS.filter(k=>s.prices[k]!=null).map((k,i) => `
    <div class="price-tile" style="animation-delay:${i*0.07}s">
      <div class="pt-label">${FUEL_LABEL[k]}</div>
      <div class="pt-val" style="color:${FUEL_COLOR[k]}">${s.prices[k].toFixed(3)}</div>
      <div class="pt-unit">€ / Liter</div>
    </div>`).join('') || '<div style="color:var(--muted);font-size:.83rem;padding:4px">Keine Preise gemeldet</div>';

  const hoursHtml = (s.openingHours||[]).map(h => {
    const isToday = h.day === todayDay;
    const time = (h.from==='00:00'&&(h.to==='24:00'||h.to==='00:00')) ? '24h' : `${h.from}–${h.to}`;
    return `<div class="hours-row${isToday?' today':''}">
      <span class="h-day">${h.label}</span>
      <span class="h-time">${time}</span>
    </div>`;
  }).join('');

  $('#sheetContent').innerHTML = `
    <div class="sheet-hero">
      <div class="sheet-badge" style="background:${s.brandBg||'#334155'};color:${s.brandText||'#fff'}">
        <span class="badge-icon" style="font-size:1.4rem">${getBrandIcon(s.brand)}</span>
        <span class="badge-abbr" style="font-size:.62rem;font-weight:800;letter-spacing:.05em">${abbr(s.brand)}</span>
      </div>
      <div class="sheet-info">
        <h2>${s.name}</h2>
        <div class="sheet-addr-line">${s.address} · ${s.dist.toFixed(1)} km entfernt</div>
        <div class="sheet-status-row">
          <span class="status-chip ${isClosed?'closed-chip':'open'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>
            ${isClosed ? 'Geschlossen' : 'Geöffnet'}
          </span>
          ${s.todayHours ? `<span class="time-chip">Heute ${s.todayHours}</span>` : ''}
          <span class="time-chip">Stand ${t}</span>
        </div>
      </div>
    </div>

    <div class="sheet-prices-grid">${priceTiles}</div>

    ${hoursHtml ? `<div class="sheet-section">
      <div class="section-title">Öffnungszeiten</div>
      <div class="hours-grid">${hoursHtml}</div>
    </div>` : ''}

    <div class="sheet-nav">
      <div class="nav-row">
        <a class="btn btn-primary" href="${gmaps}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
          Google Maps
        </a>
        <a class="btn btn-secondary" href="${apple}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
          Apple Maps
        </a>
      </div>
      <div class="nav-row">
        <button class="btn btn-ghost" id="pickStartBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
          Startpunkt auf Karte
        </button>
        <button class="btn btn-ghost" id="useGpsBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
          Meinen GPS nutzen
        </button>
      </div>
    </div>`;

  $('#pickStartBtn').onclick = () => {
    pickingStart = true; document.body.style.cursor = 'crosshair';
    hideSheet(); toast('Tippe auf die Karte um Startpunkt zu setzen 📌');
  };
  $('#useGpsBtn').onclick = () => {
    customStart = null; searchCenter = null;
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    renderAll(); hideSheet();
    toast(userPos ? '📍 GPS-Standort als Start' : '📍 Telfs als Ausgangspunkt');
  };

  const sheet = $('#stationSheet');
  sheet.classList.add('visible');
  map.setView([s.lat, s.lng], 15, { animate:true });
}

function hideSheet() {
  $('#stationSheet').classList.remove('visible');
}

/* ── Panel ─────────────────────────────────────────────────────────────── */
function updatePeekLabel(count) {
  if (!panelOpen) {
    $('#peekText').textContent = count > 0 ? `${count} Tankstellen anzeigen` : 'Liste anzeigen';
  }
}

function setupPanel() {
  function toggle() {
    panelOpen = !panelOpen;
    $('#panel').classList.toggle('open', panelOpen);
    $('#panelFab').classList.toggle('panel-open', panelOpen);
    const label = $('#peekText');
    if (!panelOpen) updatePeekLabel(parseInt($('#fabCount').textContent)||0);
  }
  $('#panelDrag').addEventListener('click', toggle);
  $('#panelFab').addEventListener('click', toggle);
}

/* ── GPS ───────────────────────────────────────────────────────────────── */
function startGPS() {
  if (!navigator.geolocation) { toast('GPS nicht verfügbar'); return; }
  if (watchId != null) { if(userPos) map.setView([userPos.lat,userPos.lng],14); return; }

  watchId = navigator.geolocation.watchPosition(pos => {
    const was = !userPos;
    userPos = { lat:pos.coords.latitude, lng:pos.coords.longitude };
    $('#locateBtn').classList.add('active');
    renderUserMarker();
    // GPS nur als Basis wenn kein Suchort gesetzt
    if (was && !searchCenter) {
      mapCenter = { ...userPos };
      map.setView([userPos.lat, userPos.lng], 13);
      loadStations();
    }
  }, () => toast('Standort nicht ermittelbar — nutze Telfs als Standard.'),
  { enableHighAccuracy:true, maximumAge:5000 });
}

/* ── UI wiring ─────────────────────────────────────────────────────────── */
function setupUI() {
  $$('.fuel-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const fuel = btn.dataset.fuel;
      state.fuels[fuel] = !state.fuels[fuel];
      btn.classList.toggle('active', state.fuels[fuel]);
      renderAll();
    });
  });

  $('#sortSelect').addEventListener('change',  e => { state.sort  = e.target.value; renderAll(); });
  $('#brandSelect').addEventListener('change', e => { state.brand = e.target.value; renderAll(); });

  $('#radiusSlider').addEventListener('input', e => {
    state.radius = +e.target.value;
    $('#radiusValue').textContent = state.radius;
  });
  $('#radiusSlider').addEventListener('change', () => loadStations());

  $('#showClosed').addEventListener('change', e => { showClosed = e.target.checked; renderAll(); });

  $('#locateBtn').addEventListener('click', () => {
    if (watchId == null) { startGPS(); }
    else if (userPos) {
      searchCenter = null;
      mapCenter = { ...userPos };
      map.setView([userPos.lat, userPos.lng], 14);
      loadStations();
      toast('📍 GPS-Standort als Basis');
    }
  });

  $('#refreshBtn').addEventListener('click', () => { loadStations(); toast('Preise werden aktualisiert…'); });
  $('#sheetClose').addEventListener('click', hideSheet);
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
async function main() {
  initMap();
  setupPanel();
  setupUI();
  setupSearch();
  await loadStations();
  startGPS();
  scheduleRefresh();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

main();
