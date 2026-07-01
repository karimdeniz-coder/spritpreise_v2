require('dotenv').config();
const express = require('express');
const path = require('path');
const { getStations, TELFS_LAT, TELFS_LNG } = require('./priceProvider');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/stations', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || TELFS_LAT;
    const lng = parseFloat(req.query.lng) || TELFS_LNG;
    const radiusKm = parseFloat(req.query.radius) || 30;
    const result = await getStations({ lat, lng, radiusKm });
    res.json({ center: { lat, lng }, ...result });
  } catch (err) {
    console.error('Fehler beim Laden der Stationen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ apiKeySet: true });
});

// Geocoding via Nominatim (OpenStreetMap, kostenlos, kein Key)
app.get('/api/geocode', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q fehlt' });
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Österreich')}&format=json&limit=5&countrycodes=at`;
    const r = await require('node-fetch')(url, {
      headers: { 'User-Agent': 'SpritpreiseApp/1.0' }
    });
    const data = await r.json();
    res.json(data.map(d => ({
      name: d.display_name.split(',').slice(0, 3).join(','),
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Spritpreise-App läuft auf http://localhost:${PORT}`);
});
