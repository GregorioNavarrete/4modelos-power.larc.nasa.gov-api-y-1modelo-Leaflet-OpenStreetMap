/**
 * Demo A - Simulador de Agricultura Inteligente y Resiliente
 * ----------------------------------------------------------
 * npm start  ->  http://localhost:3101
 *
 * El navegador no consulta la API de la NASA directamente: pide a este
 * servidor (misma disciplina que las apps ganadoras: backend de cacheo),
 * que hace de proxy con cinco ventajas:
 *   1. Evita problemas de CORS del cliente.
 *   2. Cachea respuestas (TTL 15 min) para no golpear la API.
 *   3. Limpia el valor de relleno (-999) de POWER -> null.
 *   4. Si POWER falla o esta fuera de servicio, intenta Open-Meteo ( fallback).
 *   5. Devuelve siempre la misma estructura simple: { days, series, meta }.
 *
 * Endpoint principal (navegador -> aqui -> NASA POWER):
 *   GET /api/agro?lat=-27.78&lon=-64.26&years=5
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3101;

// --------------------------------------------------------------------
// Parametro NASA POWER admitidos por esta demo (lista cerrada):
// T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M  (datos diarios, comunidad RE)
// --------------------------------------------------------------------
const PARAMS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'RH2M'];

const cache = new Map(); // clave URL -> { ts, body }
const TTL = 15 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));

function conValor(n) {
  return n === null || n === undefined || Number(n) === -999 ? null : Number(n);
}

// --------------------------------------------------------------------
// POWER  ->  { days: [...], series: { T2M_MAX: [...], ... } }
// --------------------------------------------------------------------
function normalizarPower(json) {
  const p = json?.properties?.parameter || {};
  const dias = Object.keys(p.T2M_MAX || {}).sort();
  if (!dias.length) throw new Error('POWER devolvio una respuesta sin fechas');
  const series = {};
  for (const k of PARAMS) {
    series[k] = dias.map(d => (p[k] ? conValor(p[k][d]) : null));
  }
  return { days: dias, series, meta: { fuente: 'NASA POWER', rango: [dias[0], dias[dias.length - 1]] } };
}

// --------------------------------------------------------------------
// Open-Meteo (fallback) -> misma estructura { days, series }
// PRECTOTCORR ~= precipitation_sum, T2M/T2M_MIN = temperature_2m_max/min,
// RH2M ~= relative_humidity_2m_mean
// --------------------------------------------------------------------
async function openMeteo(lat, lon, start, end, timestandardLst) {
  const url =
    'https://archive-api.open-meteo.com/v1/archive?' +
    'latitude=' + lat + '&longitude=' + lon +
    '&start_date=' + start + '&end_date=' + end +
    '&daily=' + 'temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean' +
    '&timezone=auto';
  const r = await fetch(url);
  if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
  const j = await r.json();
  const d = j.daily || {};
  const dias = (d.time || []).map(s => s.replaceAll('-', ''));
  if (!dias.length) throw new Error('Open-Meteo sin fechas');
  return {
    days: dias,
    series: {
      T2M_MAX: d.temperature_2m_max || [],
      T2M_MIN: d.temperature_2m_min || [],
      PRECTOTCORR: d.precipitation_sum || [],
      RH2M: d.relative_humidity_2m_mean || []
    },
    meta: { fuente: 'Open-Meteo (fallback)', rango: [dias[0], dias[dias.length - 1]] }
  };
}

function fechaPower(d) { return d.replace(/-/g, ''); }
function fechaISODay(dt) {
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

app.get('/api/agro', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const years = Math.min(Math.max(parseInt(req.query.years) || 5, 2), 10);

  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat/lon invalidos' });
  }

  const fin = new Date();
  const inicio = new Date(fin.getTime() - years * 365.25 * 86400e3);

  const q =
    '?parameters=' + PARAMS.join(',') +
    '&community=RE' + '&latitude=' + lat + '&longitude=' + lon +
    '&start=' + fechaPower(fechaISODay(inicio)) + '&end=' + fechaPower(fechaISODay(fin)) +
    '&format=JSON';
  const url = 'https://power.larc.nasa.gov/api/temporal/daily/point' + q;
  const clave = 'P|' + url;

  // 1) intento con cache local
  if (cache.has(clave)) {
    const c = cache.get(clave);
    if (Date.now() - c.ts < TTL) return res.json(c.body);
  }
  cache.delete(clave);

  // 2) NASA POWER (primario)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('POWER HTTP ' + r.status);
    const body = normalizarPower(await r.json());
    cache.set(clave, { ts: Date.now(), body });
    return res.json(body);
  } catch (e) { /* silencio: si POWER falla cae al fallback */ }

  // 3) Open-Meteo (fallback)
  try {
    const body = await openMeteo(lat, lon, fechaISODay(inicio), fechaISODay(fin));
    cache.set(clave + '|OM', { ts: Date.now(), body });
    return res.json(body);
  } catch (e) {
    return res.status(502).json({ error: 'Fallo NASA POWER y el fallback Open-Meteo: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('Demo A: Simulador de Agricultura Inteligente y Resiliente');
  console.log('Abri:  http://localhost:' + PORT);
  console.log('');
});
