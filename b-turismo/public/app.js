/* Demo B — Índice de Confort y Riesgo a partir del historial POWER de ~25 años.
 * Probabilidades = frecuencia observada en la ventana de calendario elegida
 * (mismo día/mes ± desvío), NO un pronóstico meteorológico.
 */
'use strict';

const UMBRALES = {
  lluviaMM: 2,      // día “lluvioso”
  calorC: 32,       // T2M_MAX ≥ 32 °C (calor fuerte / estrés)
  vientoMS: 10.8,   // WS10M ≥ 10.8 m/s ≈ Beaufort 6 (39 km/h)
  desvioDias: 3     // ventana ±3 días alrededor de cada fecha
};

const $ = id => document.getElementById(id);
$('btnAnalizar').addEventListener('click', analizar);

async function analizar() {
  const [latStr, lonStr] = $('lugar').value.split(',');
  const lat = Number(latStr), lon = Number(lonStr);
  const desde = $('desde').value, hasta = $('hasta').value;
  if (!desde || !hasta || hasta < desde) { error('Elegí un rango de fechas válido.'); return; }

  $('error').classList.add('oculto');
  $('salida').classList.add('oculto');
  $('cargando').classList.remove('oculto');
  $('btnAnalizar').disabled = true;

  try {
    const r = await fetch(`api/historico?lat=${lat}&lon=${lon}`);
    if (!r.ok) throw new Error((await r.json()).error || 'HTTP ' + r.status);
    const data = await r.json();
    pintar(data, desde, hasta, lat, lon);
  } catch (e) {
    error('No se pudieron bajar los datos: ' + e.message);
  } finally {
    $('cargando').classList.add('oculto');
    $('btnAnalizar').disabled = false;
  }
}

function error(msg) { const e = $('error'); e.textContent = '⚠ ' + msg; e.classList.remove('oculto'); }

/* Todas las fechas YYYYMMDD, para los años 2000..2025, que caen en la ventana
 * elegida expandida ± desvioDias. Ej: evento 14–15 nov -> 25 × ~15 días. */
function fechasVentana(desde, hasta) {
  const out = [];
  const d1 = new Date(desde + 'T00:00:00'), d2 = new Date(hasta + 'T00:00:00');
  for (let y = 2000; y <= 2025; y++) {
    const a = new Date(y, d1.getMonth(), d1.getDate() - UMBRALES.desvioDias);
    const b = new Date(y, d2.getMonth(), d2.getDate() + UMBRALES.desvioDias);
    for (let t = a; t <= b; t = new Date(t.getTime() + 864e5)) {
      out.push(t.getFullYear() + String(t.getMonth() + 1).padStart(2, '0') + String(t.getDate()).padStart(2, '0'));
    }
  }
  return out;
}

function crearIndices(days) { const m = new Map(); days.forEach((d, i) => m.set(d, i)); return m; }

function statsVentana(data, fechas) {
  const idx = crearIndices(data.days);
  const s = { calor: [], viento: [], lluvia: [] };
  for (const f of fechas) {
    const i = idx.get(f);
    if (i === undefined) continue;
    if (data.series.T2M_MAX[i] !== null) s.calor.push(data.series.T2M_MAX[i]);
    if (data.series.WS10M[i] !== null)    s.viento.push(data.series.WS10M[i]);
    if (data.series.PRECTOTCORR[i] !== null) s.lluvia.push(data.series.PRECTOTCORR[i]);
  }
  return s;
}

const mediana = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmtN = n => (n === null || !isFinite(n)) ? '—' : n.toFixed(1);

/* Índice de Riesgo 0..100, pesos dcra = 0.45 calor, 0.25 lluvia, 0.30 viento */
function indiceRiesgo(pCalor, pLluvia, pViento) {
  return Math.round(100 * (0.45 * pCalor + 0.25 * pLluvia + 0.30 * pViento));
}

function riesgos(s) {
  if (!s.calor.length) return null;
  return {
    pC: s.calor.filter(v => v >= UMBRALES.calorC).length / s.calor.length,
    pL: s.lluvia.length ? s.lluvia.filter(v => v >= UMBRALES.lluviaMM).length / s.lluvia.length : 0,
    pV: s.viento.length ? s.viento.filter(v => v >= UMBRALES.vientoMS).length / s.viento.length : 0
  };
}

function pintar(data, desde, hasta, lat, lon) {
  const fechas = fechasVentana(desde, hasta);
  const s = statsVentana(data, fechas);
  const p = riesgos(s);
  if (!p) { error('El historial no tiene datos para esa ventana. Probá otras fechas.'); return; }

  const riesgo = indiceRiesgo(p.pC, p.pL, p.pV);
  const nivel = riesgo < 25 ? 'v' : riesgo < 55 ? 'a' : 'r';
  const textos = {
    v: ['🟢 Ventana favorable', 'Históricamente esta ventana presenta riesgos bajos para un evento al aire libre en esta ubicación.'],
    a: ['🟡 Ventana con precaución', 'Hay riesgos moderados: conviene definir horarios de contingencia (mañana temprano / atardecer) y tener un plan B techado.'],
    r: ['🔴 Ventana de alto riesgo', 'Históricamente esta ventana suele presentar calor fuerte, lluvia o viento por sobre los umbrales. Considerá re-agendar (mirá las fechas alternativas de abajo).']
  };

  $('gauge').style.setProperty('--pct', riesgo);
  $('gauge').style.setProperty('--gcolor', nivel === 'v' ? '#1a7f37' : nivel === 'a' ? '#c2870b' : '#d93025');
  $('gaugeNum').textContent = riesgo;
  $('gaugeTxt').textContent = 'Índice de Riesgo (0–100)';
  $('tituloVeredicto').textContent = textos[nivel][0];
  $('textoVeredicto').textContent = textos[nivel][1];

  const alertas = [];
  if (p.pC >= 0.4)  alertas.push(`calor fuerte ≥ 32 °C en ${(p.pC * 100).toFixed(0)} % de los días`);
  if (p.pL >= 0.4)  alertas.push(`lluvia ≥ 2 mm en ${(p.pL * 100).toFixed(0)} % de los días`);
  if (p.pV >= 0.4)  alertas.push(`viento ≥ 39 km/h en ${(p.pV * 100).toFixed(0)} % de los días`);
  $('alertas').innerHTML = alertas.length
    ? '⚠ Riesgos dominantes: ' + alertas.join(' · ')
    : '✅ Ninguna variable supera el 40 % de probabilidad en esta ventana.';

  pintaBarra('cPrecip', p.pL, '#0b57d0');
  pintaBarra('cCalor',  p.pC, '#d93025');
  pintaBarra('cViento', p.pV, '#c2870b');

  const tbody = $('tablaDet').querySelector('tbody');
  tbody.innerHTML = '';
  fila('Lluvia diaria (mm)', s.lluvia, UMBRALES.lluviaMM, '≥');
  fila('T2M_MAX (°C)',       s.calor,  UMBRALES.calorC,  '≥');
  fila('WS10M (m/s)',        s.viento, UMBRALES.vientoMS, '≥');

  $('alternativas').innerHTML = '';
  const feas = fechasAlternativas(data, desde, 90);
  feas.slice(0, 6).forEach(f => {
    const dia = f.d.slice(6, 8), mes = f.d.slice(4, 6);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${dia}/${mes} <b>riesgo ${f.r}</b> <span class="ot">índice ${f.serverTime || ''}</span>`;
    $('alternativas').appendChild(chip);
  });
  if (!feas.length) $('alternativas').innerHTML = '<span class="ot">No se encontraron ventanas históricas alternativas comparables.</span>';

  seccionMagia(lat, lon, s, fechas.length);
  $('salida').classList.remove('oculto');

  function fila(nombre, arr, umbral, sentido) {
    const tr = document.createElement('tr');
    const extremos = arr.filter(v => v >= umbral).length;
    tr.innerHTML = `<td>${nombre}</td>
      <td>${fmtN(mediana(arr))}</td>
      <td>${extremos} de ${arr.length} días ${sentido} ${umbral}</td>
      <td>${arr.length}</td>
      <td>NASA POWER 2000–2025</td>`;
    tbody.appendChild(tr);
  }
}

function pintaBarra(idCanvas, prob, color) {
  const cv = $(idCanvas), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const x0 = 10, y0 = 55, w = cv.width - 20, h = 30;
  ctx.fillStyle = '#e5e9ee';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, Math.max(4, Math.round(w * prob)), h);
  ctx.fillStyle = '#1f2328';
  ctx.font = 'bold 22px system-ui';
  ctx.fillText(Math.round(prob * 100) + ' %', x0, 36);
  ctx.strokeStyle = '#d0d7de';
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
}

/* Explora ±90 días desde la fecha elegida: riesgo promedio de cada día-calendario */
function fechasAlternativas(data, desde, margenDias) {
  const base = new Date(desde + 'T00:00:00');
  const out = [];
  for (let of = -margenDias; of <= margenDias; of++) {
    if (Math.abs(of) < 3) continue;
    const f = new Date(base.getTime() + of * 864e5);
    const iso = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
    const ymd = f.getFullYear() + String(f.getMonth() + 1).padStart(2, '0') + String(f.getDate()).padStart(2, '0');
    // usa la ventana de calendario de la fecha desplazada (± desvioDias)
    const s = statsVentana(data, fechasVentana(iso, iso));
    if (!s.calor.length) continue;
    const p = { pC: 0, pL: 0, pV: 0 };
    p.pC = s.calor.filter(v => v >= UMBRALES.calorC).length / s.calor.length;
    p.pL = s.lluvia.length ? s.lluvia.filter(v => v >= UMBRALES.lluviaMM).length / s.lluvia.length : 0;
    p.pV = s.viento.length ? s.viento.filter(v => v >= UMBRALES.vientoMS).length / s.viento.length : 0;
    out.push({ d: ymd, r: indiceRiesgo(p.pC, p.pL, p.pV) });
  }
  out.sort((a, b) => a.r - b.r);
  // sentido "secos": una chip por posición de calendario (sin repertir mes-día doble)
  return out.filter((o, i) => i === 0 || o.d.slice(4) !== out[i - 1].d.slice(4));
}

function seccionMagia(lat, lon, s, repeticiones) {
  if ($('seccion4')) return;
  const nodo = document.createElement('section');
  nodo.id = 'seccion4';
  nodo.innerHTML = `
    <h2>De dónde salen los números (transparencia)</h2>
    <ul>
      <li><b>Fuente:</b> NASA POWER temporal/daily/point, comunidad RE, años 2000–2025, parámetros <code>T2M_MAX, WS10M, PRECTOTCORR</code>. Coordenadas ${lat}, ${lon}. Valores -999 (sin dato) descartados.</li>
      <li><b>Muestra usada:</b> ${repeticiones} días históricos (años 2000–2025 de la ventana ± ${UMBRALES.desvioDias} días, incluido el propio).</li>
      <li><b>Probabilidad ≠ pronóstico:</b> "P(lluvia)=x %" significa "en x % de esos ${repeticiones} días históricos llovió ≥ ${UMBRALES.lluviaMM} mm", no una predicción del tiempo para tu evento.</li>
      <li><b>Índice de Riesgo = 0.45·P(calor) + 0.25·P(lluvia) + 0.30·P(viento)</b> (escala 0–100). Estructura inspirada en la fórmula DCRA v3 que publicó el equipo Astro Sweepers (ganador Global Awards) con pesos R=0.45 / D=0.25 / C=0.20 / S=0.10 sobre sus variables; acá se recalibraron a 3 variables de POWER. Es un criterio editable de la demo, no un estándar oficial.</li>
      <li><b>Umbrales usados (criterio de la demo, editables en app.js):</b> lluvia ≥ 2 mm/día (día mojado); T2M_MAX ≥ 32 °C (calor fuerte); WS10M ≥ 10.8 m/s ≈ 39 km/h (Beaufort 6, complica carpas y escenarios).</li>
      <li><b>Límite físico:</b> WS10M es un promedio diario a 10 m: no captura ráfagas. Para ráfagas y tormentas conviene estaciones locales o el parámetro PBL de POWER (mejora futura).</li>
    </ul>`;
  $('salida').appendChild(nodo);
}
