/**
 * Demo B - Planificador de Turismo y Eventos Climaticos Seguros
 * ------------------------------------------------------------
 * npm start  ->  http://localhost:3102
 *
 * GET /api/historico?lat=-27.78&lon=-64.26
 *   -> un solo llamado a NASA POWER daily/point, 2000-01-01 .. 2025-12-31
 *      (parametros: T2M_MAX, WS10M, PRECTOTCORR). El navegador filtra la
 *      ventana de dias de calendario que le interesa (ej: 15-21 de ENE)
 *      y calcula probabilidades con ~25 repeticiones de esa semana.
 * GET /api/nivel?ppmmr (proxy opcional para Open-Meteo futuro; no usado ahora)
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3102;

const PARAMS = ['T2M_MAX', 'WS10M', 'PRECTOTCORR'];
const cache = new Map();
const TTL = 60 * 60 * 1000; // el historial completo se cachea 1 hora

app.use(express.static(path.join(__dirname, 'public')));

function conValor(n) { return n === null || n === undefined || Number(n) === -999 ? null : Number(n); }

function normalizarPower(json) {
  const p = json?.properties?.parameter || {};
  const dias = Object.keys(p.T2M_MAX || {}).sort();
  if (!dias.length) throw new Error('POWER devolvio una respuesta sin fechas');
  const series = {};
  for (const k of PARAMS) series[k] = dias.map(d => (p[k] ? conValor(p[k][d]) : null));
  return { days: dias, series, meta: { fuente: 'NASA POWER', rango: [dias[0], dias[dias.length - 1]] } };
}

app.get('/api/historico', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat/lon invalidos' });
  }

  const url =
    'https://power.larc.nasa.gov/api/temporal/daily/point' +
    '?parameters=' + PARAMS.join(',') +
    '&community=RE' +
    '&latitude=' + lat + '&longitude=' + lon +
    '&start=20000101&end=20251231&format=JSON';

  const clave = 'HIST|' + lat + '|' + lon;
  if (cache.has(clave)) return res.json(cache.get(clave));

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('POWER HTTP ' + r.status);
    const body = normalizarPower(await r.json());
    cache.set(clave, body);
    return res.json(body);
  } catch (e) {
    return res.status(502).json({ error: 'Fallo NASA POWER: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('Demo B: Planificador de Turismo y Eventos Climaticos Seguros');
  console.log('Abri:  http://localhost:' + PORT);
  console.log('');
});
