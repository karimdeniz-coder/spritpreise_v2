const fetch = require('node-fetch');

const TELFS_LAT = 47.3008;
const TELFS_LNG = 11.0667;
const FUEL_TYPES = ['DIE', 'SUP', 'GAS'];
const FUEL_KEY_MAP = { DIE: 'diesel', SUP: 'super95', GAS: 'gas' };

const BRAND_COLORS = {
  'OMV':       { bg: '#1c4f9c', text: '#fff' },
  'Shell':     { bg: '#f5c500', text: '#cc0000' },
  'JET':       { bg: '#e2001a', text: '#fff' },
  'Eni':       { bg: '#ffcc00', text: '#1a1a1a' },
  'ENI':       { bg: '#ffcc00', text: '#1a1a1a' },
  'Agip':      { bg: '#ffcc00', text: '#1a1a1a' },
  'AVANTI':    { bg: '#00843d', text: '#fff' },
  'Avanti':    { bg: '#00843d', text: '#fff' },
  'Turmöl':    { bg: '#c8102e', text: '#fff' },
  'BP':        { bg: '#009639', text: '#fff' },
  'Esso':      { bg: '#003087', text: '#fff' },
  'DISK':      { bg: '#e63946', text: '#fff' },
  'Lagerhaus': { bg: '#4a7c59', text: '#fff' },
  'WT':        { bg: '#334155', text: '#fff' },
  'Waldhart':  { bg: '#7c3aed', text: '#fff' },
};

function brandStyle(name) {
  if (!name) return { bg: '#334155', text: '#fff' };
  for (const [k, v] of Object.entries(BRAND_COLORS)) {
    if (name.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return { bg: '#334155', text: '#fff' };
}

let cache = null, cacheKey = '', cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function fetchFuelType(lat, lng, fuelType) {
  const url = `https://www.spritpreisrechner.at/api/search/gas-stations/by-address` +
    `?latitude=${lat}&longitude=${lng}&fuelType=${fuelType}&includeClosed=true`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'Referer': 'https://www.spritpreisrechner.at/', 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function distanceKm(a, b) {
  const R = 6371, r = d => d * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Tiling: hexagonales Gitter für gleichmäßige Abdeckung
function getTilePoints(lat, lng, radiusKm) {
  const pts = [{ lat, lng }];
  const latOff = d => d / 111;
  const lngOff = d => d / (111 * Math.cos(lat * Math.PI / 180));

  if (radiusKm <= 10) return pts;

  // Ring 1: 6 Punkte im Inneren (Abstand ~40% des Radius)
  const r1 = radiusKm * 0.42;
  for (let i = 0; i < 6; i++) {
    const a = (i * 60) * Math.PI / 180;
    pts.push({ lat: lat + latOff(r1 * Math.sin(a)), lng: lng + lngOff(r1 * Math.cos(a)) });
  }

  if (radiusKm <= 25) return pts;

  // Ring 2: 12 Punkte am Rand (Abstand ~80% des Radius)
  const r2 = radiusKm * 0.80;
  for (let i = 0; i < 12; i++) {
    const a = (i * 30) * Math.PI / 180;
    pts.push({ lat: lat + latOff(r2 * Math.sin(a)), lng: lng + lngOff(r2 * Math.cos(a)) });
  }

  return pts;
}

function todayHours(openingHours) {
  if (!openingHours?.length) return null;
  const days = ['SO','MO','DI','MI','DO','FR','SA'];
  const today = days[new Date().getDay()];
  return openingHours.find(h => h.day === today) || null;
}

function formatHours(oh) {
  if (!oh) return null;
  if (oh.from === '00:00' && (oh.to === '24:00' || oh.to === '00:00')) return '24h';
  return `${oh.from}–${oh.to}`;
}

async function getStations({ lat = TELFS_LAT, lng = TELFS_LNG, radiusKm = 30 } = {}) {
  const key = `${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusKm}`;
  if (cache && cacheKey === key && Date.now() - cacheTime < CACHE_TTL) {
    return { stations: cache, cached: true };
  }

  const tilePoints = getTilePoints(lat, lng, radiusKm);
  const center = { lat, lng };
  const byId = new Map();

  // Alle Fuel-Typen × alle Tile-Punkte parallel
  const tasks = [];
  for (const pt of tilePoints) {
    for (const ft of FUEL_TYPES) {
      tasks.push({ pt, ft });
    }
  }

  const results = await Promise.allSettled(tasks.map(t => fetchFuelType(t.pt.lat, t.pt.lng, t.ft)));

  tasks.forEach(({ ft }, i) => {
    const result = results[i];
    if (result.status !== 'fulfilled') return;
    const priceKey = FUEL_KEY_MAP[ft];

    for (const s of result.value || []) {
      const sLat = s.location?.latitude, sLng = s.location?.longitude;
      if (!sLat || !sLng) continue;
      const dist = distanceKm(center, { lat: sLat, lng: sLng });
      if (dist > radiusKm) continue;

      const id = String(s.id);
      if (!byId.has(id)) {
        const style = brandStyle(s.spritName || s.name);
        const todayOh = todayHours(s.openingHours);
        byId.set(id, {
          id, name: s.name, brand: s.spritName || s.name,
          lat: sLat, lng: sLng,
          address: [s.location?.address, s.location?.postalCode, s.location?.city].filter(Boolean).join(', '),
          brandBg: style.bg, brandText: style.text,
          prices: { diesel: null, super95: null, gas: null },
          open: s.open ?? true,
          todayHours: formatHours(todayOh),
          openingHours: s.openingHours || [],
          updatedAt: new Date().toISOString(),
        });
      }
      const price = s.prices?.[0]?.amount ?? null;
      if (price != null) byId.get(id).prices[priceKey] = price;
    }
  });

  const stations = Array.from(byId.values());
  cache = stations; cacheKey = key; cacheTime = Date.now();
  console.log(`[API] ${stations.length} Stationen | ${tilePoints.length} Tile-Punkte | Radius ${radiusKm}km | ${stations.filter(s=>s.open).length} offen`);
  return { stations, cached: false };
}

module.exports = { getStations, TELFS_LAT, TELFS_LNG };
