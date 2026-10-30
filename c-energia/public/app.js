/* Demo C — Viabilidad solar / eólica a partir de la climatología NASA POWER.
 * Fórmulas explícitas en pantalla; los supuestos (PR, consumo hogar, CF eólico)
 * son criterio de la demo y están etiquetados como tal, no salen de la API.
 */
'use strict';

const MESES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_KEY = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/* Supuestos editables (mostrados en pantalla) */
const SUPUESTOS = {
  PR: 0.80,                 // Performance Ratio de la granja solar (pérdidas: suciedad, temperatura, inversor)
  consumoHogar: 3500,       // kWh/año por hogar argentino promedio (aprox.)
  CF_EOLICO: [[6.0, 0.35], [5.0, 0.25], [4.0, 0.15], [3.0, 0.07], [0, 0.04]], // viento(m/s) -> factor de planta
  densidadAire: 1.225
};

const $ = id => document.getElementById(id);
const fmt  = (n, d = 0) => (n === null || !isFinite(n)) ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d });
const entero = n => (n === null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('es-AR');

$('btnIR').addEventListener('click', analizar);
document.querySelectorAll('button.mini').forEach(b =>
  b.addEventListener('click', () => { $('latlon').value = b.dataset.l; analizar(); }));

let actual = { lat: -27.7842, lon: -64.2644 };

async function analizar() {
  const partes = $('latlon').value.trim().split(',').map(Number);
  if (partes.length === 2 && isFinite(partes[0]) && isFinite(partes[1])) {
    actual = { lat: partes[0], lon: partes[1] };
  }
  const mw = Math.max(0.1, Number($('mw').value) || 1);

  $('error').classList.add('oculto');
  $('salida').classList.add('oculto');
  $('cargando').classList.remove('oculto');
  $('btnIR').disabled = true;

  try {
    const r = await fetch(`api/clima?lat=${actual.lat.toFixed(4)}&lon=${actual.lon.toFixed(4)}`);
    if (!r.ok) throw new Error((await r.json()).error || 'HTTP ' + r.status);
    const clima = await r.json();
    pintar(clima, actual, mw);
  } catch (e) {
    error('No se pudo consultar la climatología: ' + e.message);
  } finally {
    $('cargando').classList.add('oculto');
    $('btnIR').disabled = false;
  }
}

function error(msg) { const e = $('error'); e.textContent = '⚠ ' + msg; e.classList.remove('oculto'); }

/* ---------- Cálculo principal ---------- */
function pintar(clima, pos, mw) {
  const ghi = clima.serie.ALLSKY_SFC_SW_DWN.ann;   // kWh/m2/dia promedio anual
  const v10 = clima.serie.WS10M.ann;               // m/s promedio anual
  if (ghi === null) { error('POWER no reporta radiación para esta ubicación.'); return; }

  // SOLAR
  const ghiAnual       = ghi * 365;              // kWh/m2/año
  const rendEspecifico = ghiAnual * SUPUESTOS.PR; // kWh/kWp/año
  const genSolarMWh    = rendEspecifico * (mw * 1000) / 1e6;  // MWh/año
  const hogaresSolar   = genSolarMWh * 1e6 / SUPUESTOS.consumoHogar;

  // EÓLICO
  const potDensidad    = 0.5 * SUPUESTOS.densidadAire * Math.pow(v10 || 0, 3); // W/m2
  const cf             = cfEolico(v10);
  const genEolMWh      = cf * mw * 8760;        // MWh/año
  const hogaresEol     = genEolMWh * 1e6 / SUPUESTOS.consumoHogar;

  const nivel = aptitud(ghi, v10);

  $('kpi').innerHTML = `
    <div class="tarjeta"><h3>☀️ GHI anual</h3><p>${fmt(ghiAnual, 0)} kWh/m²</p><span class="sub">${fmt(ghi, 2)} kWh/m²/día</span></div>
    <div class="tarjeta"><h3>🔋 Solar ${fmt(mw, 1)} MWp</h3><p>${fmt(genSolarMWh, 0)} MWh/año</p><span class="sub">${fmt(rendEspecifico, 0)} kWh/kWp/año</span></div>
    <div class="tarjeta"><h3>🏠 Hogares (solar)</h3><p>${entero(hogaresSolar)}</p><span class="sub">a ${SUPUESTOS.consumoHogar} kWh/hogar</span></div>
    <div class="tarjeta"><h3>💨 Viento medio</h3><p>${fmt(v10, 2)} m/s</p><span class="sub">${niveViento(v10)}</span></div>
    <div class="tarjeta"><h3>🌬️ Eólico ${fmt(mw, 1)} MW</h3><p>${fmt(genEolMWh, 0)} MWh/año</p><span class="sub">FP ${fmt(cf * 100, 0)} % (heurístico)</span></div>
    <div class="tarjeta"><h3>Veredicto</h3><p class="${nivel[1]}">${nivel[0]} ${nivel[2]}</p><span class="sub">${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)} · elev. ${fmt(clima.meta.elevacion, 0)} m</span></div>`;

  barrasMes('cSolar',  MESES_KEY.map(k => clima.serie.ALLSKY_SFC_SW_DWN[k]), '#e8a80b');
  barrasMes('cViento', MESES_KEY.map(k => clima.serie.WS10M[k]),            '#0b57d0');

  $('calcSolar').innerHTML = `
    <li><b>Dato POWER:</b> ALLSKY_SFC_SW_DWN (prom. 2001–2025) = <b>${fmt(ghi, 2)} kWh/m²/día</b> × 365 = <b>${fmt(ghiAnual, 0)} kWh/m²/año</b>.</li>
    <li><b>Rendimiento específico</b> = GHI anual × PR(0.80) = <b>${fmt(rendEspecifico, 0)} kWh/kWp/año</b>. El PR agrupa pérdidas típicas (calor en la celda, suciedad, inversor, cableado) — <span class="ot">regla-dedo de la industria fotovoltaica, no sale de la API.</span></li>
    <li><b>Generación</b> = ${fmt(rendEspecifico, 0)} kWh/kWp × ${entero(mw * 1000)} kWp = <b>${fmt(genSolarMWh, 0)} MWh/año</b>.</li>
    <li><b>Hogares equivalentes</b> = ${entero(genSolarMWh * 1e6)} kWh ÷ ${SUPUESTOS.consumoHogar} kWh/hogar ≈ <b>${entero(hogaresSolar)}</b> hogares.</li>`;
  $('calcEolico').innerHTML = `
    <li><b>Dato POWER:</b> WS10M (media anual a 10 m) = <b>${fmt(v10, 2)} m/s</b>.</li>
    <li><b>Densidad de potencia</b> ≈ ½ · ρ(1.225) · v³ = <b>${fmt(potDensidad, 0)} W/m²</b> (referencia de recurso).</li>
    <li><b>Factor de planta</b> — tabla heurística de la demo (no de la API): <b>${fmt(cf * 100, 0)} %</b>.</li>
    <li><b>Generación</b> = FP × ${fmt(mw, 1)} MW × 8760 h ≈ <b>${fmt(genEolMWh, 0)} MWh/año</b> → ≈ <b>${entero(hogaresEol)}</b> hogares.</li>
    <li class="ot">⚠ El viento a 10 m <b>subestima</b> el recurso real a altura de eje (80–120 m): la estimación es conservadora.</li>`;

  seccion4(clima, pos, mw);
  $('salida').classList.remove('oculto');
}

function cfEolico(v) {
  if (v === null) return 0;
  for (const [lim, cf] of SUPUESTOS.CF_EOLICO) if (v >= lim) return cf;
  return 0.04;
}
function niveViento(v) {
  if (v === null) return 'sin dato';
  if (v >= 6.5) return 'recurso eólico excelente';
  if (v >= 5)   return 'recurso eólico bueno';
  if (v >= 4)   return 'recurso marginal';
  return 'recurso eólico pobre para turbinas convencionales';
}
function aptitud(ghi, v) {
  if (ghi >= 5.5) return ['🟢', 'v', 'Muy apta para solar'];
  if (ghi >= 4.5) return ['🟡', 'a', 'Apta para solar con cuidado'];
  if (v !== null && v >= 6) return ['🟢', 'v', 'Muy apta para eólica'];
  if (v !== null && v >= 5) return ['🟡', 'a', 'Apta para eólica con turbinas de baja velocidad'];
  return ['🔴', 'r', 'Recurso limitado'];
}

/* ---------- Gráficos canvas ---------- */
function barrasMes(id, vals, color) {
  const cv = $(id), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...vals.filter(v => v !== null), 0.1);
  const n = vals.length, gap = 26, bw = (W - n * gap) / n, y0 = H - 34;
  MESES.forEach((m, i) => {
    const v = vals[i];
    const h = v !== null ? (v / max) * (y0 - 26) : 0;
    ctx.fillStyle = color;
    ctx.fillRect(gap / 2 + i * (bw + gap), y0 - h, bw, h);
    if (v !== null) {
      ctx.fillStyle = '#1f2328'; ctx.font = '11px system-ui';
      ctx.fillText(v.toFixed(1), gap / 2 + i * (bw + gap), y0 - h - 5);
    }
    ctx.fillStyle = '#57606a'; ctx.font = '10px system-ui';
    ctx.fillText(m, gap / 2 + i * (bw + gap) + 4, H - 16);
  });
  ctx.strokeStyle = '#d0d7de'; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

/* ---------- Comparativa de sitios ---------- */
async function comparativa() {
  const sitios = [
    { n: 'Sgo. Estero', lat: -27.7842, lon: -64.2644 },
    { n: 'Mendoza',     lat: -32.8924, lon: -68.8458 },
    { n: 'Neuquén',     lat: -40.7167, lon: -64.2513 },
    { n: 'Jujuy',       lat: -22.1899, lon: -65.3477 },
    { n: 'El Calafate', lat: -51.6230, lon: -69.2165 }
  ];
  const pedidos = sitios.map(s =>
    fetch(`api/clima?lat=${s.lat}&lon=${s.lon}`).then(r => r.json()).catch(() => null));
  pedidos.push(fetch(`api/clima?lat=${actual.lat.toFixed(4)}&lon=${actual.lon.toFixed(4)}`).then(r => r.json()).catch(() => null));
  const datos = await Promise.all(pedidos);

  const vals = sitios.map((s, i) => ({ n: s.n, ghi: datos[i]?.serie?.ALLSKY_SFC_SW_DWN?.ann ?? null, actual: false }));
  vals.push({ n: '★ Tu punto', ghi: datos[5]?.serie?.ALLSKY_SFC_SW_DWN?.ann ?? null, actual: true });
  dibujarComparativa(vals);
}

function dibujarComparativa(vals) {
  const cv = $('cComparar'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...vals.filter(v => v.ghi !== null).map(v => v.ghi), 0.1);
  const bw = 110, gap = (W - vals.length * bw) / (vals.length + 1);
  vals.forEach((v, i) => {
    const x = gap + i * (bw + gap);
    if (v.ghi === null) {
      ctx.fillStyle = '#8b949e'; ctx.font = '12px system-ui';
      ctx.fillText('sin dato', x + 18, 130);
    } else {
      const h = (v.ghi / max) * (H - 90);
      ctx.fillStyle = v.actual ? '#1a7f37' : '#e8a80b';
      ctx.fillRect(x, H - 60 - h, bw, h);
      ctx.fillStyle = '#1f2328'; ctx.font = 'bold 15px system-ui';
      ctx.fillText(v.ghi.toFixed(2), x + 26, H - 70 - h);
    }
    ctx.fillStyle = '#57606a'; ctx.font = '12px system-ui';
    ctx.fillText(v.n, x + 16, H - 40);
  });
  ctx.fillStyle = '#57606a'; ctx.font = '11px system-ui';
  ctx.fillText('Radiación solar promedio anual (kWh/m²/día, ANN) — NASA POWER 2001–2025 · el punto verde es tu ubicación', 20, 24);
  ctx.fillStyle = '#57606a'; ctx.font = '11px system-ui';
  ctx.fillText('Seriación de todos los sitios con la misma escala. Valores más altos = mejor recurso solar.', 20, H - 14);
}

function seccion4() {
  if ($('seccion4')) return;
  const nodo = document.createElement('section');
  nodo.id = 'seccion4';
  nodo.innerHTML = `
    <h2>De dónde salen los números (transparencia)</h2>
    <ul>
      <li><b>Fuente:</b> NASA POWER <code>temporal/climatology/point</code>, promedios 2001–2025, parámetros <code>ALLSKY_SFC_SW_DWN</code> (radiación solar superficie, kWh/m²/día) y <code>WS10M</code> (viento a 10 m, m/s). Celdas ~1°×1° (~100 km).</li>
      <li><b>ALLSKY ya incluye</b> la nubosidad promedio del sitio — es la energía que recibiría un panel correctamente orientado. No considera sombras locales de árboles ni edificios.</li>
      <li><b>Supuestos de la demo (editables en app.js):</b> PR solar = 0.80 (pérdidas típicas fotovoltaicas); consumo doméstico = ${SUPUESTOS.consumoHogar} kWh/hogar/año (aprox. hogar medio argentino); factor de planta eólico por tabla heurística según viento medio.</li>
      <li><b>Límites:</b> WS10M a 10 m subestima el viento a altura de eje (80–120 m) → potencial real mayor; no hay análisis de terreno (pendientes), red eléctrica, costos ni impacto ambiental; NO es un estudio de factibilidad definitivo, es un primer orden para priorizar predios.</li>
    </ul>`;
  $('salida').appendChild(nodo);
}

/* ---------- Mapa Leaflet (opcional; sin Internet, queda el modo manual) ---------- */
window.initMapa = function () {
  const m = L.map('mapa').setView([actual.lat, actual.lon], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(m);
  let marker = null;
  m.on('click', e => {
    actual = { lat: e.latlng.lat, lon: e.latlng.lng };
    $('latlon').value = actual.lat.toFixed(4) + ',' + actual.lon.toFixed(4);
    if (marker) m.removeLayer(marker);
    marker = L.marker([actual.lat, actual.lon]).addTo(m);
  });
};
