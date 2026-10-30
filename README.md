# 🛰️ Demos Climáticas — NASA Space Apps 2026

Cuatro demos web independientes (y un panel que las junta) construidas con **HTML + CSS + JavaScript vanilla + Express**, alimentadas por la API abierta **NASA POWER** (sin claves ni registro).

## Cómo arrancar

```bash
# Opción 1: TODO junto (recomendada)
cd demos
npm install
npm start                       # → http://localhost:3100  (panel + las 4 demos montadas)

# Opción 2: cada demo por separado
cd demos/a-agricultura && npm install && npm start    # → http://localhost:3101
cd demos/b-turismo     && npm install && npm start    # → http://localhost:3102
cd demos/c-energia     && npm install && npm start    # → http://localhost:3103
cd demos/d-sequia      && npm install && npm start    # → http://localhost:3104
```

| Proyecto | Ruta en el panel | Puerto | Endpoint | API |
|---|---|---|---|---|
| A · Agricultura Inteligente | `/a-agricultura` | 3101 | `/api/agro` | POWER daily + fallback Open-Meteo |
| B · Turismo y Eventos | `/b-turismo` | 3102 | `/api/historico` | POWER daily 2000–2025 |
| C · Viabilidad Solar/Eólica | `/c-energia` | 3103 | `/api/clima` | POWER climatology 2001–2025 |
| D · Alerta de Sequía | `/d-sequia` | 3104 | `/api/series` | POWER daily 5 años |
| E · Mapas + Pedido en Vivo | `/e-mapas` | 3105 | — (todo cliente-side) | Leaflet + OpenStreetMap + Nominatim |
| **Panel (todo)** | `/` | **3100** | — | — |

## Qué contiene el panel

Para cada demo: descripción, **alcance**, **aplicaciones base** (datos/API), **qué se busca con esta etapa**, **qué mejorar**, **qué agregar**, **a qué interfaz u otra aplicación integrarla** e **ideas de negocio**.

## Errores y límites que quedan expuestos a propósito

- Cada página trae una sección **“De dónde salen los números”** con fuente, fórmula y umbrales.
- Los umbrales agronómicos/energéticos/sequía son **criterios de la demo editables** (`app.js` de cada demo), no datos de la API.
- POWER tiene celdas de ~1°×1° (~100 km): representa zonas, no lotes.
- WS10M es viento a 10 m (no altura de eje de turbina) y media diaria (no ráfagas).
- El valor de relleno `-999` de POWER se descarta en todos los cálculos.

## Despliegue (producción)

`npm start` corre un proceso único Express por demo. Para un VPS/contenedor:

```bash
cd demos && npm ci --omit=dev
PORT=3100 node server.js     # variable PORT configurable en cada server.js
```

> ⚠️ Si se publican públicas, agregar rate-limit básico al proxy (`/api/*`) para no abusar de la API POWER.
