/**
 * PANEL - Demos Climáticas (NASA Space Apps 2026)
 * ------------------------------------------------
 * npm start   ->  http://localhost:3100
 *
 * Sirve en un solo lugar:
 *   /                 -> panel (index.html) con la ficha de cada demo
 *   /a-agricultura    -> Demo A (agricultura inteligente)
 *   /b-turismo        -> Demo B (turismo y eventos seguros)
 *   /c-energia        -> Demo C (viabilidad solar / eólica)
 *   /d-sequia         -> Demo D (alerta temprana de sequía)
 *
 * Cada demo también es autónoma: cd a-agricultura && npm start (puerto propio).
 * Este servidor registra los mismos endpoints proxy (con caché) bajo el
 * prefijo de cada demo para que los botones del panel funcionen aquí.
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.static(__dirname));

// ------------------------------------------------------------------
// Proxy a NASA POWER (mismo diseño que los servidores individuales)
// ------------------------------------------------------------------
const cache = new Map();
const TTL = 15 * 60 * 1000;

function conValor(n) { return n === null || n === undefined || Number(n) === -999 ? null : Number(n); }

function normalizarDaily(json, params) {
  const p = json?.properties?.parameter || {};
  const dias = Object.keys(p[params[0]] || {}).sort();
  if (!dias.length) throw new Error('POWER sin fechas');
  const series = {};
  for (const k of params) series[k] = dias.map(d => (p[k] ? conValor(p[k][d]) : null));
  return { days: dias, series, meta: { fuente: 'NASA POWER', rango: [dias[0], dias[dias.length - 1]] } };
}

async function powerDaily(params, lat, lon, dias, extraMonthsYears /* no usado */) {
  const url = 'https://power.larc.nasa.gov/api/temporal/daily/point' +
    '?parameters=' + params.join(',') + '&community=RE' +
    '&latitude=' + lat + '&longitude=' + lon +
    '&start=' + dias[0] + '&end=' + dias[1] + '&format=JSON';
  const clave = 'D|' + url;
  if (cache.has(clave)) return cache.get(clave);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  const r = await fetch(url, { signal: ctrl.signal });
  clearTimeout(t);
  if (!r.ok) throw new Error('POWER HTTP ' + r.status);
  const body = normalizarDaily(await r.json(), params);
  cache.set(clave, body);
  setTimeout(() => cache.delete(clave), TTL);
  return body;
}

async function powerClima(lat, lon) {
  const url = 'https://power.larc.nasa.gov/api/temporal/climatology/point' +
    '?parameters=ALLSKY_SFC_SW_DWN,WS10M,T2M_MAX&community=RE' +
    '&latitude=' + lat + '&longitude=' + lon + '&format=JSON';
  const clave = 'C|' + lat.toFixed(2) + '|' + lon.toFixed(2);
  if (cache.has(clave)) return cache.get(clave);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  const r = await fetch(url, { signal: ctrl.signal });
  clearTimeout(t);
  if (!r.ok) throw new Error('POWER HTTP ' + r.status);
  const j = await r.json();
  const p = j?.properties?.parameter || {};
  const meses = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const serie = {};
  for (const k of ['ALLSKY_SFC_SW_DWN', 'WS10M', 'T2M_MAX']) {
    const sm = {};
    for (const m of meses) sm[m.toLowerCase()] = conValor(p[k]?.[m]);
    sm.ann = conValor(p[k]?.ANN);
    serie[k] = sm;
  }
  const body = { serie, meta: { fuente: 'NASA POWER Climatología (2001–2025)', elevacion: j?.geometry?.coordinates?.[2] ?? null } };
  cache.set(clave, body);
  return body;
}

const valido = (lat, lon) => isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const iso = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

// ----------------------------- A: agricultura -----------------------------
const P_A = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'RH2M'];
function rutaAgro() {
  return async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    const years = Math.min(Math.max(parseInt(req.query.years) || 5, 2), 10);
    if (!valido(lat, lon)) return res.status(400).json({ error: 'lat/lon inválidos' });
    const fin = new Date(), inicio = new Date(fin.getTime() - years * 365.25 * 86400e3);
    try {
      return res.json(await powerDaily(P_A, lat, lon, [iso(inicio), iso(fin)]));
    } catch (e) {
      return res.status(502).json({ error: 'Fallo NASA POWER: ' + e.message });
    }
  };
}

// ----------------------------- B: turismo -----------------------------
const P_B = ['T2M_MAX', 'WS10M', 'PRECTOTCORR'];
function rutaHistorico() {
  return async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!valido(lat, lon)) return res.status(400).json({ error: 'lat/lon inválidos' });
    try {
      return res.json(await powerDaily(P_B, lat, lon, ['20000101', '20251231']));
    } catch (e) {
      return res.status(502).json({ error: 'Fallo NASA POWER: ' + e.message });
    }
  };
}

// ----------------------------- C: energía -----------------------------
function rutaClima() {
  return async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!valido(lat, lon)) return res.status(400).json({ error: 'lat/lon inválidos' });
    try { return res.json(await powerClima(lat, lon)); }
    catch (e) { return res.status(502).json({ error: 'Fallo NASA POWER: ' + e.message }); }
  };
}

// ----------------------------- D: sequía -----------------------------
const P_D = ['PRECTOTCORR', 'T2M_MAX', 'T2M_MIN'];
function rutaSeries() {
  return async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    const years = Math.min(Math.max(parseInt(req.query.years) || 5, 2), 10);
    if (!valido(lat, lon)) return res.status(400).json({ error: 'lat/lon inválidos' });
    const fin = new Date(), inicio = new Date(fin.getTime() - years * 365.25 * 86400e3);
    try {
      return res.json(await powerDaily(P_D, lat, lon, [iso(inicio), iso(fin)]));
    } catch (e) {
      return res.status(502).json({ error: 'Fallo NASA POWER: ' + e.message });
    }
  };
}

// ------------------------------------------------------------------
// Montaje de las demos con sus endpoints
// ------------------------------------------------------------------
const DEMOS = [
  ['a-agricultura', rutaAgro(), '/api/agro'],
  ['b-turismo',     rutaHistorico(), '/api/historico'],
  ['c-energia',     rutaClima(), '/api/clima'],
  ['d-sequia',      rutaSeries(), '/api/series'],
  ['e-mapas',       null, null]   // no necesita proxy: Leaflet/OSM/Nominatim corren del lado del cliente
];

for (const [nombre, handler, endpoint] of DEMOS) {
  const prefijo = '/' + nombre;
  if (handler && endpoint) app.get(prefijo + endpoint, handler);
  app.use(prefijo, express.static(path.join(__dirname, nombre, 'public')));
}

app.listen(PORT, () => {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  PANEL de Demos Climáticas  ·  NASA SPACE APPS');
  console.log('══════════════════════════════════════════════════');
  console.log('  Panel:        http://localhost:' + PORT);
  console.log('  A Agricultura  ' + 'http://localhost:' + PORT + '/a-agricultura');
  console.log('  B Turismo      ' + 'http://localhost:' + PORT + '/b-turismo');
  console.log('  C Energía      ' + 'http://localhost:' + PORT + '/c-energia');
  console.log('  D Sequía       ' + 'http://localhost:' + PORT + '/d-sequia');
  console.log('  E Mapas/Deliv. ' + 'http://localhost:' + PORT + '/e-mapas');
  console.log('══════════════════════════════════════════════════');
  console.log('');
});
