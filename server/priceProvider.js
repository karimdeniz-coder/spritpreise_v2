const fetch = require('node-fetch');

const TELFS_LAT = 47.3008;
const TELFS_LNG = 11.0667;
const FUEL_TYPES = ['DIE', 'SUP', 'GAS'];
const FUEL_KEY  = { DIE:'diesel', SUP:'super95', GAS:'gas' };

const BRAND_STYLE = {
  'OMV':       { bg:'#1c4f9c', text:'#fff' },
  'Shell':     { bg:'#dd1d1d', text:'#f5c500' },
  'JET':       { bg:'#e2001a', text:'#fff' },
  'Eni':       { bg:'#1a1a1a', text:'#ffcc00' },
  'ENI':       { bg:'#1a1a1a', text:'#ffcc00' },
  'Agip':      { bg:'#1a1a1a', text:'#ffcc00' },
  'AVANTI':    { bg:'#007a3d', text:'#fff' },
  'Avanti':    { bg:'#007a3d', text:'#fff' },
  'Turmöl':    { bg:'#c8102e', text:'#fff' },
  'BP':        { bg:'#006a00', text:'#ffdf00' },
  'Esso':      { bg:'#003087', text:'#fff' },
  'DISK':      { bg:'#c0392b', text:'#fff' },
  'Lagerhaus': { bg:'#3a6b47', text:'#fff' },
  'WT':        { bg:'#2d3748', text:'#fff' },
  'Waldhart':  { bg:'#553c9a', text:'#fff' },
  'Petrol':    { bg:'#e67e22', text:'#fff' },
};

function brandStyle(name='') {
  for (const [k,v] of Object.entries(BRAND_STYLE))
    if (name.toLowerCase().includes(k.toLowerCase())) return v;
  return { bg:'#2d3748', text:'#fff' };
}

// Cache: 5 min
const CACHE_TTL = 5*60*1000;
const _cache = new Map();

async function fetchFuelType(lat, lng, ft) {
  const url = `https://www.spritpreisrechner.at/api/search/gas-stations/by-address`+
    `?latitude=${lat}&longitude=${lng}&fuelType=${ft}&includeClosed=true`;
  const res = await fetch(url, {
    headers:{'Accept':'application/json','Referer':'https://www.spritpreisrechner.at/','User-Agent':'Mozilla/5.0'},
    timeout:10000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function distKm(a, b) {
  const R=6371, r=d=>d*Math.PI/180;
  const dLa=r(b.lat-a.lat), dLo=r(b.lng-a.lng);
  const h=Math.sin(dLa/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

// Hexagonales Tiling für flächendeckende Abfrage
function tilePoints(lat, lng, radiusKm) {
  const pts=[{lat,lng}];
  const La=d=>d/111;
  const Lo=d=>d/(111*Math.cos(lat*Math.PI/180));
  const rings = radiusKm<=10 ? [] : radiusKm<=25 ? [[0.4,6]] : radiusKm<=45 ? [[0.38,6],[0.78,12]] : [[0.35,6],[0.68,12],[0.92,18]];
  for (const [frac,n] of rings) {
    const r=radiusKm*frac;
    for (let i=0;i<n;i++) {
      const a=(i/n)*2*Math.PI;
      pts.push({lat:lat+La(r*Math.sin(a)),lng:lng+Lo(r*Math.cos(a))});
    }
  }
  return pts;
}

function formatToday(openingHours) {
  if (!openingHours?.length) return null;
  const days=['SO','MO','DI','MI','DO','FR','SA'];
  const oh=openingHours.find(h=>h.day===days[new Date().getDay()]);
  if (!oh) return null;
  if (oh.from==='00:00'&&(oh.to==='24:00'||oh.to==='00:00')) return '24h geöffnet';
  return `${oh.from}–${oh.to}`;
}

async function getStations({lat=TELFS_LAT,lng=TELFS_LNG,radiusKm=30}={}) {
  const key=`${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusKm}`;
  const now=Date.now();
  const cached=_cache.get(key);
  if (cached&&now-cached.t<CACHE_TTL) return {stations:cached.data,cached:true,age:Math.round((now-cached.t)/1000)};

  const pts=tilePoints(lat,lng,radiusKm);
  const tasks=pts.flatMap(p=>FUEL_TYPES.map(ft=>({p,ft})));
  const results=await Promise.allSettled(tasks.map(({p,ft})=>fetchFuelType(p.lat,p.lng,ft)));

  const center={lat,lng};
  const byId=new Map();

  tasks.forEach(({ft},i)=>{
    const res=results[i];
    if (res.status!=='fulfilled') return;
    const pk=FUEL_KEY[ft];
    for (const s of res.value||[]) {
      const sLat=s.location?.latitude, sLng=s.location?.longitude;
      if (!sLat||!sLng) continue;
      if (distKm(center,{lat:sLat,lng:sLng})>radiusKm) continue;
      const id=String(s.id);
      if (!byId.has(id)) {
        const st=brandStyle(s.spritName||s.name);
        byId.set(id,{
          id, name:s.name, brand:s.spritName||s.name,
          lat:sLat, lng:sLng,
          address:[s.location?.address,s.location?.postalCode,s.location?.city].filter(Boolean).join(', '),
          brandBg:st.bg, brandText:st.text,
          prices:{diesel:null,super95:null,gas:null},
          open:s.open??true,
          todayHours:formatToday(s.openingHours),
          openingHours:s.openingHours||[],
          reportedAt:new Date().toISOString(),
        });
      }
      const price=s.prices?.[0]?.amount??null;
      if (price!=null) byId.get(id).prices[pk]=price;
    }
  });

  const stations=Array.from(byId.values());
  _cache.set(key,{data:stations,t:Date.now()});
  console.log(`[API] ${stations.length} Stationen | ${pts.length} Tiles | ${radiusKm}km | ${stations.filter(s=>s.open).length} offen`);
  return {stations,cached:false};
}

// Cache invalidieren (für Force-Refresh)
function clearCache() { _cache.clear(); }

module.exports={getStations,clearCache,TELFS_LAT,TELFS_LNG};
