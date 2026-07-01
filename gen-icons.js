// Erzeugt einfache SVG-basierte PNG-Icons für die PWA.
// Benötigt: npm install canvas  (einmalig, nur für Icon-Generierung)
// Aufruf: node gen-icons.js
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  // Hintergrund
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e3a5f');
  ctx.fillStyle = grad;
  ctx.roundRect(0, 0, size, size, size * 0.22);
  ctx.fill();
  // Tropfen-Symbol
  const cx = size / 2, cy = size * 0.44, r = size * 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.3, r, 0, Math.PI * 2);
  ctx.fillStyle = '#22d3ee';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 1.1);
  ctx.bezierCurveTo(cx + r * 1.1, cy - r * 0.2, cx + r, cy + r * 0.5, cx, cy + r * 1.3);
  ctx.bezierCurveTo(cx - r, cy + r * 0.5, cx - r * 1.1, cy - r * 0.2, cx, cy - r * 1.1);
  ctx.fillStyle = '#22d3ee';
  ctx.fill();
  // "€" Symbol
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold ${size * 0.22}px Segoe UI, system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('€', cx, cy + r * 0.15);
  return c.toBuffer('image/png');
}

['192', '512'].forEach((s) => {
  const buf = drawIcon(+s);
  fs.writeFileSync(path.join(__dirname, 'public', 'icons', `icon-${s}.png`), buf);
  console.log(`icon-${s}.png erzeugt`);
});
