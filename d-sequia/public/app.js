/* Demo D — Alerta temprana de sequía / estrés hídrico.
 * Balance: precip nn. vs ET0 de Hargreaves (FAO-56 simplificada, solo temperaturas + latitud).
 * Percentil: posición de la lluvia de los últimos 90 días dentro del
 * historial de 5 años de ventanas de 90 días de la MISMA época del año.
 * umbrales editables abajo; son criterio de la demo, no salen de la API.
 */
'use strict';

const UMBRALES = {
  ventana: 90,        // días analizados
  movil: 30,          // días móviles para el déficit graficado
  percentilAmarillo: 30,  // si la lluvia actual cae por debajo de este percentil -> amarillo
  percentilRojo: 12,      // por debajo de este -> rojo
  deficitAmarilloMM: -160, // déficit (P-ET0) de 90 d por debajo -> amarillo
  deficitRojoMM: -260     // ... y por debajo -> rojo
};

const $ = id => document.getElementById(id);
$('btnD').addEventListener('click', evaluar);

async function evaluar() {
  let lat, lon;
  const manual = $('latlon').value.trim();
  [lat, lon] = (manual || $('lugar').value).split(',').map(Number);
  if (!isFinite(lat) || !isFinite(lon)) { error('Coordenadas inválidas (lat,lon).'); return; }

  $('error').classList.add('oculto');
  $('salida').classList.add('oculto');
  $('cargando').classList.remove('oculto');
  $('btnD').disabled = true;
  try {
    const r = await fetch(`api/series?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&years=5`);
    if (!r.ok) throw new Error((await r.json()).error || 'HTTP ' + r.status);
    pintar(await r.json(), lat, lon);
  } catch (e) {
    error('No se pudieron bajar los datos: ' + e.message);
  } finally {
    $('cargando').classList.add('oculto');
    $('btnD').disabled = false;
  }
}
function error(msg) { const e = $('error'); e.textContent = '⚠ ' + msg; e.classList.remove('oculto'); }

/* ---- ET0 Hargreaves (FAO-56): 0.0023 * Ra * (Tmean + 17.8) * (Tmax - Tmin)^0.5 ----
 * Ra: radiación extraterrestre diaria (MJ/m2/d) — depende de la latitud y del día del año. */
function Ra(latRad, doy) {
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
  const delta = 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
  const x = Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(delta)));
  const ws = Math.acos(x);
  const Ra = (24 * 60 / Math.PI) * 0.0820 * dr * (ws * Math.sin(latRad) * Math.sin(delta) + Math.cos(latRad) * Math.cos(delta) * Math.sin(ws));
  return Math.max(0, Ra);
}

function etoHargreaves(tmax, tmin, latRad, doy) {
  if (tmax === null || tmin === null) return null;
  const tmean = (tmax + tmin) / 2;
  return 0.0023 * Ra(latRad, doy) * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin));
}

function pintar(data, lat, lon) {
  const days = data.days;
  const n = days.length;
  const i0 = n - UMBRALES.ventana;
  if (i0 < 0) { error('El historial no cubre la ventana.'); return; }

  const latRad = lat * Math.PI / 180;
  const toDoy = d => { // 'YYYYMMDD' -> dia del anio
    const y = +d.slice(0, 4), m = +d.slice(4, 6) - 1, dia = +d.slice(6, 8);
    return Math.floor((Date.UTC(y, m, dia) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  };

  const eto = days.map((d, i) =>
    etoHargreaves(data.series.T2M_MAX[i], data.series.T2M_MIN[i], latRad, toDoy(d)));

  // ventanas móviles de 90 días sobre todo el histórico (para el percentil por época)
  // pct de la ventana actual contra ventanas de la MISMA época (±20 días de calendario)
  const actualDate = days[n - 1];
  const epocaMes = +actualDate.slice(4, 6), epocaDia = +actualDate.slice(6, 8);

  const ventanas90 = []; // {fin, P, ET} solo las cercanas en calendario a la actual
  for (let fin = UMBRALES.ventana - 1; fin < n; fin++) {
    const d = days[fin];
    const m = +d.slice(4, 6), dia = +d.slice(6, 8);
    const dif = Math.abs((m - epocaMes) * 30.5 + (dia - epocaDia));
    if (dif > 20) continue;                     // solo días ±20 alrededor de la época actual
    let P = 0, E = 0, ok = 0;
    for (let j = fin - UMBRALES.ventana + 1; j <= fin; j++) {
      if (days[j] === undefined) { ok = -999; break; }
      if (data.series.PRECTOTCORR[j] !== null) P += data.series.PRECTOTCORR[j];
      if (eto[j] !== null) E += eto[j];
    }
    if (ok === -999) continue;
    ventanas90.push({ fin, P, E, dif });
  }
  if (ventanas90.length < 10) { error('Historial insuficiente para comparar épocas.'); return; }
  ventanas90.sort((a, b) => a.P - b.P);

  // ventana de 90 días actual (última) = la del final
  const finActual = n - 1;
  let P90 = 0, E90 = 0;
  for (let j = n - UMBRALES.ventana; j <= finActual; j++) {
    if (data.series.PRECTOTCORR[j] !== null) P90 += data.series.PRECTOTCORR[j];
    if (eto[j] !== null) E90 += eto[j];
  }
  const deficit = P90 - E90;

  const lista = ventanas90.map(v => v.P);
  const rank = lista.filter(p => p < P90).length;
  const percentil = rank / lista.length;        // 0 = el más seco de la época

  let diasSin = 0;
  for (let j = finActual; j >= 0; j--) {
    if (data.series.PRECTOTCORR[j] !== null && data.series.PRECTOTCORR[j] >= 1) break;
    diasSin++;
  }

  // clasificación semáforo: peor(r) de percentil y déficit
  let nivel = 'v';
  if (percentil < UMBRALES.percentilRojo || deficit < UMBRALES.deficitRojoMM) nivel = 'r';
  else if (percentil < UMBRALES.percentilAmarillo || deficit < UMBRALES.deficitAmarilloMM) nivel = 'a';
  const colores = { v: '#1a7f37', a: '#c2870b', r: '#d93025' };
  const titulos = {
    v: ['🟢 Situación normal', `La lluvia de los últimos 90 días (${P90.toFixed(0)} mm) está en el percentil ${(percentil*100).toFixed(0)} de la época en 5 años, y el déficit hídrico es manejable. Sin alerta.`],
    a: ['🟡 Atención: sequía moderada', `La lluvia de los últimos 90 días (${P90.toFixed(0)} mm) cae en el percentil ${(percentil*100).toFixed(0)} de la época y el balance P−ET0 = ${deficit.toFixed(0)} mm. Conviene restringir riego no crítico y preparar contingencias.`],
    r: ['🔴 Sequía crítica', `La lluvia de los últimos 90 días (${P90.toFixed(0)} mm) está entre las más bajas de los 5 años (percentil ${(percentil*100).toFixed(0)}) y el balance P−ET0 = ${deficit.toFixed(0)} mm. Recomendado activar protocolo de emergencia hídrica (restricciones, prevención de incendios, priorización de usos).`]
  };

  $('farol').style.setProperty('--fcolor', colores[nivel]);
  $('farolNum').textContent = titulos[nivel][0].split(' ')[0];
  $('farolTxt').textContent = 'P−ET0(90d) = ' + deficit.toFixed(0) + ' mm';
  $('tituloS').innerHTML = titulos[nivel][0];
  $('textoS').textContent = titulos[nivel][1];

  $('p90').textContent  = P90.toFixed(0) + ' mm';
  $('e90').textContent  = E90.toFixed(0) + ' mm';
  $('d90').textContent  = deficit.toFixed(0) + ' mm';
  $('per').textContent  = (percentil * 100).toFixed(0) + 'º';
  $('sinL').textContent = diasSin + ' d';

  dibujarGrafico(data, eto, lat, lon, percentil);
  seccion4(lat, lon, P90, E90, percentil, deficit);
  $('salida').classList.remove('oculto');
}

/* Gráfico: barras de lluvia diaria + línea de déficit móvil 30d (P-ET0) */
function dibujarGrafico(data, eto) {
  const cv = $('grafico'), ctx = cv.getContext('2d');
  const N = Math.min(180, data.days.length);
  const sl = data.days.slice(-N), sp = data.series.PRECTOTCORR.slice(-N), se = eto.slice(-N);
  const W = cv.width, H = cv.height, x0 = 46, y0 = H - 40, y1 = 20;
  ctx.clearRect(0, 0, W, H);

  const maxP = Math.max(...sp.map(v => v || 0), 1);
  const deficitMov = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const ini = Math.max(0, i - UMBRALES.movil + 1);
    let P = 0, E = 0;
    for (let j = ini; j <= i; j++) { P += (sp[j] || 0); E += (se[j] || 0); }
    deficitMov.push(P - E);
  }
  const maxD = Math.max(...deficitMov.map(Math.abs), 10);

  const colW = (W - x0 - 10) / N;
  // barras de lluvia
  sp.forEach((v, i) => {
    if (!v) return;
    const h = (v / maxP) * (y0 - y1) * 0.55;
    ctx.fillStyle = '#1976d2';
    ctx.fillRect(x0 + i * colW, y0 - h, Math.max(1, colW - 1), h);
  });
  // línea de déficit móvil
  ctx.strokeStyle = '#d93025'; ctx.lineWidth = 2; ctx.beginPath();
  deficitMov.forEach((d, i) => {
    const x = x0 + i * colW, y = y0 - ((d + maxD) / (2 * maxD)) * (y0 - y1);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  // ejes
  ctx.strokeStyle = '#d0d7de'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(W - 6, y0); ctx.stroke();
  ctx.fillStyle = '#57606a'; ctx.font = '10px system-ui';
  ctx.fillText('0 mm', 8, y0 + 4);
  ctx.fillText(Math.round(maxP) + ' mm/día', 2, y0 - (y0 - y1) * 0.55);
  ctx.fillText('déficit ' + Math.round(-maxD) + ' mm', 2, y1 + 8);
  const mes = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  sl.forEach((d, i) => {
    if (i % 15 !== 0) return;
    const m = +d.slice(4, 6) - 1, dia = +d.slice(6, 8);
    ctx.fillText(dia + '/' + mes[m], x0 + i * colW - 10, H - 18);
  });
}

function seccion4(lat, lon, P90, E90, percentil, deficit) {
  $('seccion4').innerHTML = `
    <h2>De dónde salen los números (transparencia)</h2>
    <ul>
      <li><b>Fuente:</b> NASA POWER temporal/daily/point, comunidad RE, 5 años, parámetros <code>PRECTOTCORR</code>, <code>T2M_MAX</code>, <code>T2M_MIN</code>. Coordenadas ${lat.toFixed(3)}, ${lon.toFixed(3)}. Valores -999 descartados (contados como 0 en Σ del día, marcados como vacíos en el gráfico).</li>
      <li><b>ET0 = fórmula de Hargreaves (FAO-56, cap. 6, ec. 52):</b> 0.0023 · Ra · (Tmedia + 17.8) · (Tmax − Tmin)^0.5. Ra (radiación extraterrestre) calculada por latitud y día del año — <span class="ot">es un cálculo astronómico estándar, no sale de la API.</span></li>
      <li><b>Déficit hídrico 90 d = ΣP − ΣET0 = ${P90.toFixed(0)} − ${E90.toFixed(0)} = ${deficit.toFixed(0)} mm</b>. Negativo = la atmósfera devoró más agua de la que llueve en la cuenca.</li>
      <li><b>Percentil:</b> posición de la lluvia de los últimos 90 días entre todas las ventanas de 90 días de la <b>misma época del año</b> (±20 días) en el historial de 5 años. Percentil bajo = lluvia inusualmente escasa para el momento del año.</li>
      <li><b>Semáforo (umbral definitorio de la demo, editable en app.js):</b> <span class="v">verde</span>: percentil ≥ ${UMBRALES.percentilAmarillo} y déficit > ${UMBRALES.deficitRojoMM} mm; <span class="a">amarillo</span>: percentil < ${UMBRALES.percentilAmarillo} o déficit < ${UMBRALES.deficitAmarilloMM} mm; <span class="r">rojo</span>: percentil < ${UMBRALES.percentilRojo} o déficit < ${UMBRALES.deficitRojoMM} mm. Referencia de umbral: P−ET0 ≈ −160 mm en 90 d es sequía meteorológica severa en zonas semiáridas templadas; se recomienda calibrar por cuenca con datos locales.</li>
      <li><b>Límites:</b> POWER celda ~1°×1° (~100 km com), no reflecta microcuencas; ET0 Hargreaves subestima ET en zonas ventosas; solo temperaturas, sin radiación medida real (mejorable con ALLSKY_SFC_SW_ALL o estaciones locales). No reemplaza avisos oficiales del SMN o del Organismo de cuenca.</li>
    </ul>`;
}
