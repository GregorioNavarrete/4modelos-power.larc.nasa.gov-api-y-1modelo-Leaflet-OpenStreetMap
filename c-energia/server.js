/**
 * Demo C - Calculadora de Viabilidad para Granjas Solares o Eolicas
 * ----------------------------------------------------------------
 * npm start  ->  http://localhost:3103
 *
 * GET /api/clima?lat=..&lon=..
 *   -> NASA POWER temporal/climatology/point (25 anios, 2001-2025)
 *      parametros: ALLSKY_SFC_SW_DWN (kWh/m2/dia), WS10M (m/s), T2M_MAX (C)
 *      claves: JAN..DEC + ANN
 *
 * Sin clave. Cache local 24 h (la climatologia no cambia rapidamente).
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3103;

const PARAMS = ['ALLSKY_SFC_SW_DWN', 'WS10M', 'T2M_MAX'];
const cache = new Map();
const TTL = 24 * 60 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));

function conValor(n) { return n === null || n === undefined || Number(n) === -999 ? null : Number(n); }

function normalizar(json) {
  const p = json?.properties?.parameter || {};
  const meses = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const serie = {};
  for (const k of PARAMS) {
    const sm = {};
    for (const m of meses) sm[m.toLowerCase()] = conValor(p[k]?.[m]);
    sm.ann = conValor(p[k]?.ANN);
    serie[k] = sm;
  }
  return { serie, meta: { fuente: 'NASA POWER Climatología (2001–2025)', elevacion: json?.geometry?.coordinates?.[2] ?? null } };
}

app.get('/api/clima', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat/lon invalidos' });
  }

  const url =
    'https://power.larc.nasa.gov/api/temporal/climatology/point' +
    '?parameters=' + PARAMS.join(',') + '&community=RE' +
    '&latitude=' + lat + '&longitude=' + lon + '&format=JSON';

  const clave = 'CLIMA|' + lat.toFixed(2) + '|' + lon.toFixed(2);
  if (cache.has(clave)) return res.json(cache.get(clave));

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
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
  console.log('Demo C: Calculadora de Viabilidad Solar/Eolica');
  console.log('Abri:  http://localhost:' + PORT);
  console.log('');
});
