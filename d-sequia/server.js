/**
 * Demo D - Monitor de Alerta Temprana de Estres Hidrico y Sequias
 * --------------------------------------------------------------
 * npm start  ->  http://localhost:3104
 *
 * GET /api/series?lat=..&lon=..&years=5
 *   -> NASA POWER daily/point, parametros PRECTOTCORR (mm), T2M_MAX / T2M_MIN (C)
 *      Ultimos 5 anios. Con eso el navegador calcula:
 *        - precip y ET0 (Hargreaves) acumuladas de los ultimos 90 dias
 *        - deficit hidrico = P - ET0
 *        - percentil de precip 90d del periodo actual vs el historico
 *          (misma epoca del anio) -> semaforo verde / amarillo / rojo
 *
 * Sin clave, valores -999 descartados, cache 15 min.
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3104;

const PARAMS = ['PRECTOTCORR', 'T2M_MAX', 'T2M_MIN'];
const cache = new Map();
const TTL = 15 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));

function conValor(n) { return n === null || n === undefined || Number(n) === -999 ? null : Number(n); }

function normalizar(json) {
  const p = json?.properties?.parameter || {};
  const dias = Object.keys(p.PRECTOTCORR || {}).sort();
  if (!dias.length) throw new Error('POWER devolvio una respuesta sin fechas');
  const series = {};
  for (const k of PARAMS) series[k] = dias.map(d => (p[k] ? conValor(p[k][d]) : null));
  return { days: dias, series, meta: { fuente: 'NASA POWER', rango: [dias[0], dias[dias.length - 1]] } };
}

app.get('/api/series', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const years = Math.min(Math.max(parseInt(req.query.years) || 5, 2), 10);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat/lon invalidos' });
  }

  const fin = new Date();
  const inicio = new Date(fin.getTime() - years * 365.25 * 86400e3);
  const iso = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

  const url =
    'https://power.larc.nasa.gov/api/temporal/daily/point' +
    '?parameters=' + PARAMS.join(',') + '&community=RE' +
    '&latitude=' + lat + '&longitude=' + lon +
    '&start=' + iso(inicio) + '&end=' + iso(fin) + '&format=JSON';

  const clave = 'SEQ|' + lat + '|' + lon + '|' + years;
  if (cache.has(clave)) return res.json(cache.get(clave));

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 40000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('POWER HTTP ' + r.status);
    const body = normalizar(await r.json());
    cache.set(clave, body);
    return res.json(body);
  } catch (e) {
    return res.status(502).json({ error: 'Fallo NASA POWER: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('Demo D: Monitor de Alerta Temprana de Sequias y Estres Hidrico');
  console.log('Abri:  http://localhost:' + PORT);
  console.log('');
});
