/* Demo A — Lógica del Semáforo de Riesgo Agrícola
 * Fuente de datos: NASA POWER (proxy local /api/agro → POWER + fallback Open-Meteo).
 * Todos los umbrales de cultivo son criterios agronómicos genéricos editables aquí,
 * no salen de la API: se muestran como "criterio de la demo".
 */
'use strict';

/* ------------------- Tabla de requerimientos de cultivos -------------------
 * aguaMM      : mm de agua que demanda el ciclo (lám. total aproximada)
 * cicloDias   : días promedio de siembra a cosecha
 * tMaxCrit    : T2M_MAX que produce estrés térmico severo (floración/llenado)
 * helada      : tolera heladas (T2M_MIN < 0 °C) durante el ciclo
 * riegoBase   : método sugerido si el semáforo no es verde
 */
const CULTIVOS = [
  { nombre: 'Maíz',        aguaMM: 550, cicloDias: 150, tMaxCrit: 35, helada: false },
  { nombre: 'Soja',        aguaMM: 450, cicloDias: 140, tMaxCrit: 34, helada: false },
  { nombre: 'Trigo',       aguaMM: 400, cicloDias: 150, tMaxCrit: 30, helada: true  },
  { nombre: 'Girasol',     aguaMM: 400, cicloDias: 130, tMaxCrit: 35, helada: false },
  { nombre: 'Tomate',      aguaMM: 500, cicloDias: 120, tMaxCrit: 33, helada: false },
  { nombre: 'Lechuga',     aguaMM: 250, cicloDias: 75,  tMaxCrit: 28, helada: false },
  { nombre: 'Alfalfa',     aguaMM: 700, cicloDias: 320, tMaxCrit: 35, helada: true  },
  { nombre: 'Poroto negro',aguaMM: 350, cicloDias: 100, tMaxCrit: 33, helada: false }
];

/* Umbrales de la demo (editables) */
const UMBRALES = {
  calorVerde: 10,      // % de días con T2M_MAX > tMaxCrit considerados "sin riesgo"
  calorRojo: 25,       // a partir de aquí el semáforo se pone rojo
  aguaRatioVerde: 1.0, // lluvia del ciclo mejor / necesidad >= 1  -> verde
  aguaRatioRojo: 0.6   // < 0.6 -> rojo
};

const $ = id => document.getElementById(id);
const fmt = (n, dec = 1) => (n === null || !isFinite(n)) ? 'sin dato' : Number(n).toFixed(dec);
const pct = n => (n === null || !isFinite(n)) ? 'sin dato' : (n * 100).toFixed(0) + ' %';

$('btnAnalizar').addEventListener('click', analizar);
$('latlon').addEventListener('keydown', e => { if (e.key === 'Enter') analizar(); });

async function analizar() {
  let lat, lon;
  const manual = $('latlon').value.trim();
  const lugar = manual || $('lugar').value;
  [lat, lon] = lugar.split(',').map(Number);
  if (!isFinite(lat) || !isFinite(lon)) { mostrarError('Coordenadas inválidas. Formato: lat,lon  (ej: -27.7842,-64.2644)'); return; }

  $('error').classList.add('oculto');
  $('salida').classList.add('oculto');
  $('cargando').classList.remove('oculto');
  $('btnAnalizar').disabled = true;

  try {
    const r = await fetch(`api/agro?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&years=5`);
    if (!r.ok) throw new Error((await r.json()).error || 'HTTP ' + r.status);
    const data = await r.json();
    pintar(data, lat, lon);
  } catch (e) {
    mostrarError('No se pudieron bajar los datos: ' + e.message);
  } finally {
    $('cargando').classList.add('oculto');
    $('btnAnalizar').disabled = false;
  }
}

function mostrarError(msg) {
  const e = $('error');
  e.textContent = '⚠ ' + msg;
  e.classList.remove('oculto');
}

/* -------------------------------
 * Cálculos
 ------------------------------- */
function estadisticas(data) {
  const { days, series } = data;
  const n = days.length;
  if (!n) throw new Error('la respuesta no trae días');

  const lluviaTotal = sumarNoNull(series.PRECTOTCORR);
  const diasCalor = series.T2M_MAX.reduce((a, v) => a + (v !== null && v >= 35 ? 1 : 0), 0);
  const diasLluvia5 = series.PRECTOTCORR.reduce((a, v) => a + (v !== null && v >= 5 ? 1 : 0), 0);
  const hMean   = promedio(series.RH2M);
  // Media móvil de 30 días de T2M_MAX -> promedio del mes más cálido / más frío
  const mov30 = [];
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 30); j <= i; j++) { if (series.T2M_MAX[j] !== null) { s += series.T2M_MAX[j]; c++; } }
    if (c >= 20) mov30.push(s / c);
  }
  mov30.sort((a, b) => a - b);
  const calido = mov30.length ? mov30[mov30.length - 1] : null;
  const frio   = mov30.length ? mov30[0] : null;

  return { n, lluviaTotal, diasCalor, diasLluvia5, hMean, calido, frio, days, series };
}

function promedio(arr) { let s = 0, c = 0; for (const v of arr) if (v !== null) { s += v; c++; } return c ? s / c : null; }
function sumarNoNull(arr) { return arr.reduce((a, v) => a + (v !== null ? v : 0), 0); }

/* Semáforo por cultivo: combina riesgo calor + riesgo agua + heladas */
function semaforoCultivo(cult, est) {
  const diasCalorCult = est.series.T2M_MAX.reduce((a, v) => a + (v !== null && v > cult.tMaxCrit ? 1 : 0), 0);
  const pctCalor = diasCalorCult / est.n;                       // % de dias sobre el umbral del cultivo

  // Agua: promedio de lluvia acumulada en ventanas de cicloDias al año aguas arriba
  const ciclosPorRec = est.n / cult.cicloDias;
  const lluviaPorCiclo = est.lluviaTotal / ciclosPorRec;
  const ratio = lluviaPorCiclo / cult.aguaMM;                   // 1 = llueve justo lo que necesita

  let nivel, detalles = [];
  if (ratio >= UMBRALES.aguaRatioVerde && pctCalor * 100 <= UMBRALES.calorVerde) nivel = 'v';
  else if (ratio < UMBRALES.aguaRatioRojo || pctCalor * 100 > UMBRALES.calorRojo) nivel = 'r';
  else nivel = 'a';

  // Heladas: días con T2M_MIN < 0 en todo el historial (riesgo para cultivos sensibles)
  const diasHelada = est.series.T2M_MIN.reduce((a, v) => a + (v !== null && v < 0 ? 1 : 0), 0);
  if (!cult.helada && diasHelada > 30) nivel = 'r';

  const deficitMM = Math.max(0, cult.aguaMM - lluviaPorCiclo);
  const mmDiaRiego = deficitMM / cult.cicloDias;

  if (pctCalor * 100 > UMBRALES.calorRojo) detalles.push(`estrés térmico: ${(pctCalor * 100).toFixed(0)} % de días con T2M_MAX > ${cult.tMaxCrit} °C`);
  else if (pctCalor * 100 > UMBRALES.calorVerde) detalles.push(`calor moderado: ${(pctCalor * 100).toFixed(0)} % de días con T2M_MAX > ${cult.tMaxCrit} °C`);
  if (ratio < UMBRALES.aguaRatioVerde) detalles.push(`llueve ${fmt(lluviaPorCiclo, 0)} mm por ciclo vs ${cult.aguaMM} mm requeridos (ratio ${ratio.toFixed(2)})`);
  if (!cult.helada && diasHelada > 0) detalles.push(`${diasHelada} días con riesgo de helada en el historial`);
  if (nivel === 'v') detalles.push('sin restricciones relevantes con estos umbrales');

  let recomendacion;
  if (nivel === 'v') recomendacion = 'Siembra apta con manejo convencional.';
  else if (nivel === 'a') {
    recomendacion = (mmDiaRiego > 0
      ? `Riego complementario ≈ ${fmt(mmDiaRiego, 1)} mm/día (goteo recomendado). `
      : '') + (pctCalor * 100 > UMBRALES.calorVerde ? `Mallas de sombreo o fechas de siembra tempranas para esquivar el pico de calor.` : '');
  } else {
    recomendacion = `Riesgo alto: riego deficitario o muy frecuente casi seguro. ` + (mmDiaRiego > 0 ? `Sólo viable con densidad de riego ≥ ${fmt(mmDiaRiego, 1)} mm/día.` : 'Sin riego no se recomienda cultivar en esta ventana.');
  }
  return { nivel, pctCalor, ratio, deficitMM, mmDiaRiego, detalles, recomendacion };
}

/* Ventana de siembra sugerida: para cada año analizado, ¿en qué mes la lluvia
 * del siguiente ciclo + temperaturas moderadas dieron el mejor promedio? */
function mejorMesSiembra(cult, est) {
  const mesPrecip = new Array(12).fill(0);   // suma de precip por mes-calendario
  const mesCalor  = new Array(12).fill(0);   // dias T2M_MAX > tMaxCrit por mes-calendario
  const anios = new Set();
  est.days.forEach((d, i) => {
    const mes = parseInt(d.slice(4, 6)) - 1;   // 'YYYYMMDD' → mes 1..12
    anios.add(d.slice(0, 4));
    if (est.series.PRECTOTCORR[i] !== null) mesPrecip[mes] += est.series.PRECTOTCORR[i];
    if (est.series.T2M_MAX[i] !== null && est.series.T2M_MAX[i] > cult.tMaxCrit) mesCalor[mes] += 1;
  });
  const k = Math.max(1, anios.size);
  const calificacion = [];
  for (let m = 0; m < 12; m++) {
    const lluviaMes = mesPrecip[m] / k;          // mm de lluvia de ese mes, promedio histórico
    const calorMes  = mesCalor[m] / k;           // dias calurosos de ese mes, promedio histórico
    calificacion.push({ mes: m, puntaje: lluviaMes - calorMes * 0.5 });
  }
  calificacion.sort((a, b) => b.puntaje - a.puntaje);
  const nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return nombres[calificacion[0].mes];
}

/* -------------------------------
 * Pintado
 ------------------------------- */
function pintar(data, lat, lon) {
  const est = estadisticas(data);
  $('rango').textContent  = `${est.days[0].slice(0, 4)}–${est.days[est.days.length - 1].slice(0, 4)}`;
  $('fuente').textContent = (data.meta?.fuente || 'NASA POWER') + (data.meta?.fuente === 'NASA POWER' ? '' : ' (respaldo)');
  $('dias').textContent   = est.n;
  $('lluvia').textContent = fmt(est.lluviaTotal, 0) + ' mm';
  $('olas').textContent   = est.diasCalor;
  $('calido').textContent = fmt(est.calido, 1) + ' °C';
  $('frio').textContent   = fmt(est.frio, 1) + ' °C';
  $('humedad').textContent= fmt(est.hMean, 0) + ' %';
  $('dias5').textContent  = est.diasLluvia5;

  const tbody = $('tablaCultivos').querySelector('tbody');
  tbody.innerHTML = '';
  const lightbulbs = { v: '🟢 Apto', a: '🟡 Atento (riego/mallas)', r: '🔴 Riesgo alto' };

  let maxDef = 0, cultMax = null;

  for (const c of CULTIVOS) {
    const s = semaforoCultivo(c, est);
    if (s.deficitMM > maxDef) { maxDef = s.deficitMM; cultMax = c.nombre; }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${c.nombre}</b></td>
      <td>${c.cicloDias} d</td>
      <td>${c.aguaMM} mm</td>
      <td>${(s.pctCalor * 100).toFixed(1)} %</td>
      <td>ratio ${s.ratio.toFixed(2)}</td>
      <td class="semaforo ${s.nivel}">${lightbulbs[s.nivel]}</td>
      <td>${s.recomendacion}</td>`;
    tr.addEventListener('mouseenter', () => { tr.style.background = '#f6f8fa'; });
    tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
    tbody.appendChild(tr);
  }

  const mes = mejorMesSiembra(CULTIVOS[0], est);
  $('recRiego').innerHTML = `
    <b>💧 Recomendación de riego automática (criterio de la demo)</b><br>
    • El cultivo con mayor déficit hídrico es <b>${cultMax}</b> (déficit ≈ ${fmt(maxDef, 0)} mm por ciclo).<br>
    • Con riego por goteo eso equivale a reparar ≈ <b>${fmt(maxDef * 10, 0)} m³/ha</b> por ciclo (${fmt(maxDef, 0)} mm × 1 ha).<br>
    • Ventana de siembra sugerida (promedio histórico): <b>${mes}</b> para maíz (mes que históricamente combina más lluvia con menos días de calor extremo).<br>
    • Los cultivos del semáforo marcados <span class="a">🟡</span> se benefician de <b>mallas de sombreo</b> (bajan la radiación directa y la evapotranspiración).<br>
    • Los marcados <span class="r">🔴</span> conviene desplazarlos o cambiar por cultivos alternativos de la tabla verde.`;

  seccionDatos(est, lat, lon);
  $('salida').classList.remove('oculto');
}

/* Ficha "de dónde salen los números" (transparencia). */
function seccionDatos(est, lat, lon) {
  const s4 = $('seccion4');
  if (!s4) {
    const nodo = document.createElement('section');
    nodo.id = 'seccion4';
    nodo.innerHTML = `
      <h2>De dónde salen los números (transparencia)</h2>
      <ul>
        <li><b>Fuente del dato primario:</b> NASA POWER temporal/daily/point, comunidad <code>RE</code>, parámetros <code>T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M</code>. Fallback: Open-Meteo archive (misma física, otro modelo). Coordenadas ${lat.toFixed(4)}, ${lon.toFixed(4)}.</li>
        <li><b>¿Por qué 5 años?</b> Ventana suficientemente larga para ver variabilidad interanual (olas de calor) y lo bastante corta para reflejar el clima reciente.</li>
        <li><b>¿Por qué esas 4 variables?</b> Dr. Henry’s Farm usó NDVI/Landsat y Queñaris usó índices NDVI; esta demo se concentra en variables meteo-diarias accesibles sin claves.</li>
        <li><b>Umbrales usados (NO vienen de la API: criterio agronómico de la demo, editable en app.js):</b>
          <ul>
            <li>Calor extremo objetivo: T2M_MAX ≥ 35 °C (ola de calor típica en la región).</li>
            <li>Calor de estrés por cultivo: tMaxCrit de la tabla (24–35 °C según especie).</li>
            <li>Agua: lluvia del mismo mes-calendario promedio de los 5 años vs aguaMM del cultivo (ratio ≥ 1 verde, < 0.6 rojo).</li>
          </ul>
        </li>
        <li><b>PRECISIÓN/NIVEL:</b> POWER celda 1° × 1° (~100 km com): representa la zona, no el cuartel del productor. Los valores -999 (sin dato) se descartan y se reemplazan por null.</li>
      </ul>`;
    $('salida').appendChild(nodo);
  } else {
    s4.classList.remove('oculto');
  }
}
