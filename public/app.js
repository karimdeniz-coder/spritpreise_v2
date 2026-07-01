'use strict';

/* ═══════════════════════════════════════════════════════════
   SpritMap — app.js
   ═══════════════════════════════════════════════════════════ */

const TELFS = { lat: 47.3008, lng: 11.0667 };
const REFRESH_MS = 5 * 60 * 1000;
const FUEL_LABEL = { super95: 'Super 95', diesel: 'Diesel', gas: 'Erdgas' };
const FUEL_COLOR = { super95: '#34d399', diesel: '#fbbf24', gas: '#fb923c' };
const DAYS_DE = ['SO','MO','DI','MI','DO','FR','SA'];
const DAYS_FULL = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

/* ── State ───────────────────────────────────────────────── */
let map, userMarker, radiusCircle;
let stations = [];
let markers = {};
let selectedId = null;
let center = { ...TELFS };
let userPos = null;
let drawerOpen = false;
let refreshTimer = null;
let countdownInterval = null;
let nextRefreshAt = 0;
let activeFuels = new Set(['super95', 'diesel']);

/* ── Prefs ───────────────────────────────────────────────── */
const PREF_KEY = 'spritmap_prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  const cur = loadPrefs();
  localStorage.setItem(PREF_KEY, JSON.stringify({ ...cur, ...p }));
}

/* ── DOM refs ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const onboarding   = $('onboarding');
const obInput      = $('obInput');
const obResults    = $('obResults');
const obSkip       = $('obSkip');
const brandLoc     = $('brandLoc');
const refreshBtn   = $('refreshBtn');
const locateBtn    = $('locateBtn');
const homeBtn      = $('homeBtn');
const searchInput  = $('searchInput');
const searchClear  = $('searchClear');
const searchRes    = $('searchResults');
const drawer       = $('drawer');
const drawerHandle = $('drawerHandle');
const handleLabel  = $('handleLabel');
const sortSelect   = $('sortSelect');
const brandSelect  = $('brandSelect');
const radiusSlider = $('radiusSlider');
const radiusValue  = $('radiusValue');
const showClosed   = $('showClosed');
const stationList  = $('stationList');
const fab          = $('fab');
const fabCount     = $('fabCount');
const sheet        = $('sheet');
const sheetClose   = $('sheetClose');
const sheetBody    = $('sheetBody');
const toast        = $('toast');
const refreshChip  = $('refreshChip');
const refreshCountdown = $('refreshCountdown');
const fuelBtns     = document.querySelectorAll('.fuel-btn');

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  showLoadOverlay();
  initMap();
  initControls();
  restorePrefs();
  checkOnboarding();
});

function showLoadOverlay() {
  const ov = document.createElement('div');
  ov.id = 'loadOverlay';
  ov.innerHTML = `<div class="lo-orb">⛽</div>
    <div class="lo-title">SpritMap</div>
    <div class="lo-bar"><div class="lo-bar-inner" id="loBar"></div></div>`;
  document.body.appendChild(ov);
  let w = 0;
  const t = setInterval(() => {
    w = Math.min(w + Math.random() * 18, 88);
    const b = $('loBar');
    if (b) b.style.width = w + '%';
    if (w >= 88) clearInterval(t);
  }, 200);
}

function hideLoadOverlay() {
  const ov = $('loadOverlay');
  if (!ov) return;
  const b = $('loBar');
  if (b) b.style.width = '100%';
  setTimeout(() => { ov.classList.add('fade'); setTimeout(() => ov.remove(), 500); }, 300);
}

/* ═══════════════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════════════ */
function checkOnboarding() {
  const prefs = loadPrefs();
  if (prefs.homeSet) {
    if (prefs.homeLat) center = { lat: prefs.homeLat, lng: prefs.homeLng };
    brandLoc.textContent = prefs.homeName || 'Telfs';
    startApp();
  } else {
    onboarding.classList.remove('hidden');
    obInput.focus();
    obInput.addEventListener('input', debounce(() => geocodeSearch(obInput.value, obResults, onObSelect), 350));
    obSkip.addEventListener('click', () => { savePrefs({ homeSet: true }); hideOnboarding(); startApp(); });
  }
}

function onObSelect(item) {
  center = { lat: item.lat, lng: item.lng };
  savePrefs({ homeSet: true, homeLat: item.lat, homeLng: item.lng, homeName: item.name });
  brandLoc.textContent = item.name.split(',')[0].trim();
  hideOnboarding();
  startApp();
}

function hideOnboarding() {
  onboarding.style.opacity = '0';
  onboarding.style.transition = 'opacity .4s ease';
  setTimeout(() => onboarding.classList.add('hidden'), 400);
}

/* ═══════════════════════════════════════════════════════════
   MAP
═══════════════════════════════════════════════════════════ */
function initMap() {
  map = L.map('map', {
    center: [center.lat, center.lng],
    zoom: 12,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(map);

  map.on('click', () => { closeSheet(); });
}

function placeUserMarker(lat, lng) {
  if (userMarker) map.removeLayer(userMarker);
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 4px rgba(59,130,246,.3)"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
  userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
}

function drawRadiusCircle(lat, lng, km) {
  if (radiusCircle) map.removeLayer(radiusCircle);
  radiusCircle = L.circle([lat, lng], {
    radius: km * 1000,
    color: 'rgba(59,130,246,.4)', fillColor: 'rgba(59,130,246,.05)',
    fillOpacity: 1, weight: 1,
  }).addTo(map);
}

/* ── Marker rendering ────────────────────────────────────── */
function getDisplayPrice(s) {
  for (const fk of activeFuels) {
    if (s.prices[fk] != null) return { price: s.prices[fk], fuel: fk };
  }
  return null;
}

function makeMarkerIcon(s) {
  const dp = getDisplayPrice(s);
  const label = dp ? `€ ${dp.price.toFixed(3)}` : s.brand.substring(0,4).toUpperCase();
  const tail  = s.brandBg || '#2d3748';
  return L.divIcon({
    className: '',
    html: `<div class="marker-pin">
      <div class="marker-bubble${s.open ? '' : ' closed'}" style="background:${s.brandBg};color:${s.brandText}">${label}</div>
      <div class="marker-tail" style="border-top-color:${s.brandBg}"></div>
    </div>`,
    iconSize: [70, 34], iconAnchor: [35, 34],
    popupAnchor: [0, -36],
  });
}

function renderMarkers(list) {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  list.forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: makeMarkerIcon(s) }).addTo(map);
    m.on('click', e => { L.DomEvent.stopPropagation(e); selectStation(s.id); openSheet(s); });
    markers[s.id] = m;
  });
}

function refreshMarkerIcon(id) {
  const s = stations.find(x => x.id === id);
  if (!s || !markers[id]) return;
  markers[id].setIcon(makeMarkerIcon(s));
  if (id === selectedId) {
    markers[id].getElement()?.querySelector('.marker-pin')?.classList.add('marker-selected');
  }
}

function selectStation(id) {
  if (selectedId && markers[selectedId]) {
    markers[selectedId].getElement()?.querySelector('.marker-pin')?.classList.remove('marker-selected');
  }
  selectedId = id;
  if (markers[id]) {
    markers[id].getElement()?.querySelector('.marker-pin')?.classList.add('marker-selected');
    const s = stations.find(x => x.id === id);
    if (s) map.panTo([s.lat, s.lng], { animate: true, duration: .4 });
  }
  document.querySelectorAll('.station-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
}

/* ═══════════════════════════════════════════════════════════
   DATA FETCHING
═══════════════════════════════════════════════════════════ */
async function loadStations(force = false) {
  const radius = parseInt(radiusSlider.value);
  const url = `/api/stations?lat=${center.lat}&lng=${center.lng}&radius=${radius}${force ? '&force=1' : ''}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    return data.stations || [];
  } catch (e) {
    showToast('Fehler beim Laden: ' + e.message);
    return null;
  }
}

async function refresh(force = false) {
  refreshBtn.classList.add('spinning');
  const list = await loadStations(force);
  refreshBtn.classList.remove('spinning');
  if (!list) return;

  stations = list.map(s => ({
    ...s,
    dist: userPos ? distKm(userPos, s) : distKm(center, s),
  }));

  populateBrandFilter();
  renderAll();
  scheduleRefresh();
  hideLoadOverlay();

  if (force) showToast('Preise aktualisiert ✓');
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  clearInterval(countdownInterval);
  nextRefreshAt = Date.now() + REFRESH_MS;
  refreshChip.classList.remove('hidden');

  countdownInterval = setInterval(() => {
    const remaining = Math.max(0, nextRefreshAt - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    refreshCountdown.textContent = `${m}:${String(s).padStart(2,'0')}`;
    if (remaining <= 0) clearInterval(countdownInterval);
  }, 1000);

  refreshTimer = setTimeout(() => refresh(false), REFRESH_MS);
}

/* ═══════════════════════════════════════════════════════════
   RENDERING
═══════════════════════════════════════════════════════════ */
function renderAll() {
  const filtered = applyFilters(stations);
  drawRadiusCircle(center.lat, center.lng, parseInt(radiusSlider.value));
  renderMarkers(filtered);
  renderList(filtered);
  fabCount.textContent = filtered.length;
}

function applyFilters(list) {
  const showCl = showClosed.checked;
  const brand  = brandSelect.value;

  return list
    .filter(s => showCl || s.open)
    .filter(s => !brand || s.brand.toLowerCase().includes(brand.toLowerCase()))
    .sort((a, b) => {
      const sort = sortSelect.value;
      if (sort === 'distance') return a.dist - b.dist;
      if (sort === 'name') return a.name.localeCompare(b.name);
      // price: sort by best active fuel
      const pa = getBestPrice(a), pb = getBestPrice(b);
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    });
}

function getBestPrice(s) {
  let best = null;
  for (const fk of activeFuels) {
    const p = s.prices[fk];
    if (p != null && (best == null || p < best)) best = p;
  }
  return best;
}

function renderList(list) {
  if (list.length === 0) {
    stationList.innerHTML = `<div class="list-state"><p>Keine Tankstellen gefunden.<br>Radius vergrößern oder Filter anpassen.</p></div>`;
    return;
  }

  const minPrice = {};
  ['super95','diesel','gas'].forEach(fk => {
    const vals = list.map(s => s.prices[fk]).filter(v => v != null);
    minPrice[fk] = vals.length ? Math.min(...vals) : null;
  });

  stationList.innerHTML = '';
  list.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = `station-card${s.id === selectedId ? ' selected' : ''}${s.open ? '' : ' closed'}`;
    card.dataset.id = s.id;
    card.style.animationDelay = Math.min(i * 30, 300) + 'ms';

    const dp = getDisplayPrice(s);
    const priceHTML = dp
      ? `<div class="sc-price" style="color:${dp.price === minPrice[dp.fuel] ? 'var(--green)' : 'var(--text)'}">${dp.price.toFixed(3)} €</div>
         <div class="sc-plabel">${FUEL_LABEL[dp.fuel]}</div>`
      : `<div class="sc-nodata">–</div>`;

    card.innerHTML = `
      <div class="sc-logo" style="background:${s.brandBg};color:${s.brandText}">
        ${abbreviate(s.brand)}
      </div>
      <div class="sc-info">
        <div class="sc-name">${esc(s.name)}</div>
        <div class="sc-addr">${esc(s.address)}</div>
        <div class="sc-meta">
          <span class="sc-badge ${s.open ? 'sc-open' : 'sc-closed'}">${s.open ? 'Offen' : 'Geschlossen'}</span>
          ${s.dist != null ? `<span class="sc-badge sc-dist">${s.dist.toFixed(1)} km</span>` : ''}
          ${s.todayHours ? `<span class="sc-badge sc-dist">${s.todayHours}</span>` : ''}
        </div>
      </div>
      <div class="sc-prices">${priceHTML}</div>`;

    card.addEventListener('click', () => {
      selectStation(s.id);
      openSheet(s);
    });
    stationList.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════
   STATION DETAIL SHEET
═══════════════════════════════════════════════════════════ */
function openSheet(s) {
  sheetBody.innerHTML = buildSheetHTML(s);
  sheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  sheet.classList.remove('open');
  document.body.style.overflow = '';
}

function buildSheetHTML(s) {
  const prices = [
    { key: 'super95', label: 'Super 95', color: FUEL_COLOR.super95 },
    { key: 'diesel',  label: 'Diesel',   color: FUEL_COLOR.diesel },
    { key: 'gas',     label: 'Erdgas',   color: FUEL_COLOR.gas },
  ];

  const validPrices = prices.filter(p => s.prices[p.key] != null);
  const cheapest = validPrices.length
    ? validPrices.reduce((a, b) => s.prices[a.key] < s.prices[b.key] ? a : b).key
    : null;

  const priceCards = prices.map(p => {
    const val = s.prices[p.key];
    const isCheapest = p.key === cheapest;
    return `<div class="sh-price-card${val != null ? ' has-price' : ''}${isCheapest ? ' cheapest' : ''}">
      <div class="sh-ptype" style="color:${p.color}">${p.label}</div>
      ${val != null
        ? `<div class="sh-pval">${val.toFixed(3)}</div><div class="sh-punit">€ / Liter</div>`
        : `<div class="sh-pval null-price">–</div>`}
    </div>`;
  }).join('');

  const todayIdx = new Date().getDay();
  const hoursHTML = s.openingHours?.length
    ? s.openingHours.map((oh, i) => {
        const dayIdx = DAYS_DE.indexOf(oh.day);
        const isToday = dayIdx === todayIdx;
        const is24 = oh.from === '00:00' && (oh.to === '24:00' || oh.to === '00:00');
        const closed = oh.from == null || oh.from === oh.to;
        return `<div class="sh-day-row${isToday ? ' today' : ''}">
          <span class="sh-day-name">${DAYS_FULL[dayIdx] ?? oh.day}${isToday ? ' (heute)' : ''}</span>
          <span class="sh-day-hours${is24 ? ' open24' : ''}${closed ? ' closed' : ''}">
            ${is24 ? '24h' : closed ? 'Geschlossen' : `${oh.from} – ${oh.to}`}
          </span>
        </div>`;
      }).join('')
    : '<div class="sh-day-row"><span class="sh-day-name" style="color:var(--text3)">Keine Öffnungszeiten verfügbar</span></div>';

  const enc = encodeURIComponent;
  const q   = enc(`${s.lat},${s.lng}`);
  const qName = enc(s.name + ', ' + s.address);
  const distTxt = s.dist != null ? `${s.dist.toFixed(1)} km entfernt` : '';

  return `
    <div class="sh-hero">
      <div class="sh-logo" style="background:${s.brandBg};color:${s.brandText}">${abbreviate(s.brand)}</div>
      <div class="sh-title">
        <div class="sh-name">${esc(s.name)}</div>
        <div class="sh-addr">${esc(s.address)}</div>
      </div>
    </div>

    <div class="sh-status-row">
      <div class="sh-chip ${s.open ? 'open' : 'closed'}">
        <svg viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
        ${s.open ? 'Jetzt geöffnet' : 'Jetzt geschlossen'}
      </div>
      ${distTxt ? `<div class="sh-chip dist">📍 ${distTxt}</div>` : ''}
      ${s.todayHours ? `<div class="sh-chip hours">🕒 Heute ${s.todayHours}</div>` : ''}
    </div>

    <div class="sh-separator"></div>
    <div class="sh-prices-heading">Kraftstoffpreise</div>
    <div class="sh-prices-grid">${priceCards}</div>

    <div class="sh-separator"></div>
    <div class="sh-hours-heading">Öffnungszeiten</div>
    <div class="sh-hours-grid">${hoursHTML}</div>

    <div class="sh-separator"></div>
    <div class="sh-nav-heading">Navigation</div>
    <div class="sh-nav-btns">
      <a class="sh-nav-btn maps" href="maps://?daddr=${q}" target="_blank">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
        Apple Maps
      </a>
      <a class="sh-nav-btn gmaps" href="https://www.google.com/maps/dir/?api=1&destination=${q}" target="_blank">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
        Google Maps
      </a>
      <a class="sh-nav-btn waze" href="https://waze.com/ul?ll=${q}&navigate=yes" target="_blank">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="10" r="7"/><path d="M8 16s1.5 3 4 3 4-3 4-3"/><circle cx="9.5" cy="9" r="1"/><circle cx="14.5" cy="9" r="1"/></svg>
        Waze
      </a>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   CONTROLS
═══════════════════════════════════════════════════════════ */
function initControls() {
  /* Drawer toggle */
  drawerHandle.addEventListener('click', toggleDrawer);
  fab.addEventListener('click', () => { toggleDrawer(true); });

  /* Fuel buttons */
  fuelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const fk = btn.dataset.fuel;
      if (activeFuels.has(fk)) {
        if (activeFuels.size > 1) { activeFuels.delete(fk); btn.classList.remove('active'); }
      } else {
        activeFuels.add(fk); btn.classList.add('active');
      }
      savePrefs({ activeFuels: [...activeFuels] });
      renderAll();
    });
  });

  /* Sort / brand */
  sortSelect.addEventListener('change', renderAll);
  brandSelect.addEventListener('change', renderAll);

  /* Radius */
  radiusSlider.addEventListener('input', () => {
    const v = radiusSlider.value;
    radiusValue.textContent = v;
    updateSliderFill();
    savePrefs({ radius: parseInt(v) });
  });
  radiusSlider.addEventListener('change', () => { center = { ...center }; refresh(false); });

  /* Closed toggle */
  showClosed.addEventListener('change', renderAll);

  /* Search */
  searchInput.addEventListener('input', debounce(() => {
    searchClear.classList.toggle('hidden', !searchInput.value);
    geocodeSearch(searchInput.value, searchRes, onSearchSelect);
  }, 350));
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    searchRes.classList.add('hidden');
    searchRes.innerHTML = '';
  });

  /* Buttons */
  refreshBtn.addEventListener('click', () => refresh(true));
  locateBtn.addEventListener('click', locateMe);
  homeBtn.addEventListener('click', () => {
    savePrefs({ homeSet: false });
    location.reload();
  });

  /* Sheet close */
  sheetClose.addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
}

function toggleDrawer(forceOpen) {
  drawerOpen = forceOpen === true ? true : !drawerOpen;
  drawer.classList.toggle('open', drawerOpen);
  handleLabel.textContent = drawerOpen ? 'Schließen' : 'Liste anzeigen';
}

function updateSliderFill() {
  const min = parseFloat(radiusSlider.min);
  const max = parseFloat(radiusSlider.max);
  const val = parseFloat(radiusSlider.value);
  const pct = ((val - min) / (max - min)) * 100;
  radiusSlider.style.setProperty('--pct', pct + '%');
}

/* ── Brand filter ────────────────────────────────────────── */
function populateBrandFilter() {
  const brands = [...new Set(stations.map(s => s.brand))].sort();
  const cur = brandSelect.value;
  brandSelect.innerHTML = '<option value="">Alle Marken</option>' +
    brands.map(b => `<option value="${esc(b)}"${b === cur ? ' selected' : ''}>${esc(b)}</option>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   GEOCODE SEARCH
═══════════════════════════════════════════════════════════ */
async function geocodeSearch(q, container, onSelect) {
  if (!q || q.length < 2) { container.classList.add('hidden'); return; }
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const items = await r.json();
    if (!items.length) { container.classList.add('hidden'); return; }
    container.innerHTML = items.map(it => `
      <div class="ob-result-item search-result-item" data-lat="${it.lat}" data-lng="${it.lng}" data-name="${esc(it.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
        ${esc(it.name)}
      </div>`).join('');
    container.classList.remove('hidden');
    container.querySelectorAll('[data-lat]').forEach(el => {
      el.addEventListener('click', () => {
        onSelect({ lat: parseFloat(el.dataset.lat), lng: parseFloat(el.dataset.lng), name: el.dataset.name });
        container.classList.add('hidden');
      });
    });
  } catch {}
}

function onSearchSelect(item) {
  center = { lat: item.lat, lng: item.lng };
  map.setView([item.lat, item.lng], 12, { animate: true });
  searchInput.value = item.name.split(',')[0].trim();
  searchClear.classList.remove('hidden');
  searchRes.classList.add('hidden');
  refresh(false);
}

/* ═══════════════════════════════════════════════════════════
   GEOLOCATION
═══════════════════════════════════════════════════════════ */
function locateMe() {
  if (!navigator.geolocation) { showToast('GPS nicht verfügbar'); return; }
  locateBtn.classList.add('spinning');
  navigator.geolocation.getCurrentPosition(
    pos => {
      locateBtn.classList.remove('spinning');
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      placeUserMarker(userPos.lat, userPos.lng);
      center = { ...userPos };
      map.setView([userPos.lat, userPos.lng], 13, { animate: true });
      refresh(false);
      showToast('Standort gefunden ✓');
    },
    () => {
      locateBtn.classList.remove('spinning');
      showToast('GPS-Zugriff verweigert');
    },
    { timeout: 8000, maximumAge: 30000 }
  );
}

/* ═══════════════════════════════════════════════════════════
   PREFS RESTORE
═══════════════════════════════════════════════════════════ */
function restorePrefs() {
  const p = loadPrefs();
  if (p.radius) {
    radiusSlider.value = p.radius;
    radiusValue.textContent = p.radius;
  }
  if (p.activeFuels) {
    activeFuels = new Set(p.activeFuels);
    fuelBtns.forEach(btn => {
      btn.classList.toggle('active', activeFuels.has(btn.dataset.fuel));
    });
  }
  updateSliderFill();
}

/* ═══════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════ */
async function startApp() {
  map.setView([center.lat, center.lng], 12);
  await refresh(false);
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      placeUserMarker(userPos.lat, userPos.lng);
      stations = stations.map(s => ({ ...s, dist: distKm(userPos, s) }));
      renderAll();
    }, () => {}, { timeout: 6000, maximumAge: 60000 });
  }
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */
function distKm(a, b) {
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLa = toR(b.lat - a.lat), dLo = toR(b.lng - a.lng);
  const h = Math.sin(dLa/2)**2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLo/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function abbreviate(name = '') {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return name.substring(0, 4).toUpperCase();
  return parts.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function esc(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, dur = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), dur);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ── PWA Service Worker ──────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
