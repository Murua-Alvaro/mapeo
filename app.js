const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('es-MX');
const pctFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

const state = {
  manifest: null,
  catalog: null,
  years: new Map(),
  map: null,
  layer: null,
  geometry: null,
  geometryMode: 'polygons',
  selectedAgeb: null,
  current: null,
  compare: null,
  currentAgg: null,
  compareAgg: null,
  trendChart: null,
  didFit: false,
};

const seqPalette = ['#eef4f8', '#d5e6f1', '#a8cce1', '#73acd0', '#3f87b6', '#174f7a'];
const zoneColors = {
  centro_historico: '#9a5d38',
  malecon: '#2978a0',
  zona_dorada: '#d29b2e',
  cerritos: '#5a7f62',
  marina: '#7658a5',
};

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function signed(value) {
  const number = safeNumber(value);
  return `${number > 0 ? '+' : ''}${fmt.format(number)}`;
}

function signedPct(value) {
  if (!Number.isFinite(value)) return 'N/D';
  return `${value > 0 ? '+' : ''}${pctFmt.format(value)}%`;
}

function percent(value) {
  return Number.isFinite(value) ? `${pctFmt.format(value)}%` : 'N/D';
}

function normalizeAgeb(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return text ? text.slice(-4) : '';
}

async function getJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
  return response.json();
}

function yearMeta(year) {
  return state.manifest.years.find((item) => String(item.year) === String(year));
}

async function loadYear(year) {
  const key = String(year);
  if (state.years.has(key)) return state.years.get(key);
  const meta = yearMeta(key);
  if (!meta) throw new Error(`El año ${key} no está disponible.`);
  const payload = await getJSON(meta.file);
  const rows = payload.rows || [];
  state.years.set(key, rows);
  return rows;
}

function getFilters() {
  return {
    year: $('yearSelect').value,
    compare: $('compareSelect').value,
    zone: $('zoneSelect').value,
    cp: $('cpSelect').value,
    sector: $('sectorSelect').value,
    size: $('sizeSelect').value,
    mode: $('mapModeSelect').value,
  };
}

function agebInZone(ageb, zone) {
  if (zone === 'ALL') return true;
  return state.manifest.zones[zone]?.agebs?.includes(ageb) ?? false;
}

function rowPasses(row, filters, overrides = {}) {
  const [ageb, cp, sector, size] = row;
  const zone = overrides.zone ?? filters.zone;
  const selectedCp = overrides.cp ?? filters.cp;
  const selectedSector = overrides.sector ?? filters.sector;
  const selectedSize = overrides.size ?? filters.size;
  const onlyAgeb = overrides.ageb ?? null;

  if (onlyAgeb && ageb !== onlyAgeb) return false;
  if (!agebInZone(ageb, zone)) return false;
  if (selectedCp !== 'ALL' && cp !== selectedCp) return false;
  if (selectedSector !== 'ALL' && sector !== selectedSector) return false;
  if (selectedSize !== 'ALL' && size !== selectedSize) return false;
  return true;
}

function filterRows(rows, filters, overrides = {}) {
  return rows.filter((row) => rowPasses(row, filters, overrides));
}

function aggregate(rows) {
  const byAgeb = new Map();
  const sectors = new Map();
  const cps = new Map();
  const sizes = new Map();

  for (const [ageb, cp, sector, size] of rows) {
    if (!byAgeb.has(ageb)) {
      byAgeb.set(ageb, {
        ageb,
        n: 0,
        sectors: new Map(),
        cps: new Map(),
        sizes: new Map(),
      });
    }

    const item = byAgeb.get(ageb);
    item.n += 1;
    item.sectors.set(sector, (item.sectors.get(sector) || 0) + 1);
    item.cps.set(cp, (item.cps.get(cp) || 0) + 1);
    item.sizes.set(size, (item.sizes.get(size) || 0) + 1);

    sectors.set(sector, (sectors.get(sector) || 0) + 1);
    cps.set(cp, (cps.get(cp) || 0) + 1);
    sizes.set(size, (sizes.get(size) || 0) + 1);
  }

  return { total: rows.length, byAgeb, sectors, cps, sizes };
}

function topEntry(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
}

function topEntries(map, limit = 6) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function change(current, previous) {
  const abs = current - previous;
  const pct = previous ? (abs / previous) * 100 : (current ? Infinity : 0);
  return { abs, pct };
}

function featureAgeb(feature) {
  const p = feature?.properties || {};
  const candidates = [
    p.cve_ageb,
    p.CVE_AGEB,
    p.ageb,
    p.AGEB,
    p.cvegeo,
    p.CVEGEO,
    p.cve_geo,
    p.CVE_GEO,
    p.clave,
    p.CLAVE,
  ];
  for (const value of candidates) {
    const normalized = normalizeAgeb(value);
    if (normalized) return normalized;
  }
  return '';
}

function zoneNames(ageb) {
  const zoneIds = state.catalog[ageb]?.zones || [];
  return zoneIds.map((id) => state.manifest.zones[id]?.name || id);
}

function colorFromText(text) {
  let hash = 0;
  for (const character of String(text)) {
    hash = ((hash << 5) - hash) + character.charCodeAt(0);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 48% 51%)`;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function sequentialBreaks(values) {
  const valid = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  return [0, .2, .4, .6, .8, 1].map((q) => quantile(valid, q));
}

function sequentialColor(value, breaks) {
  if (!value) return '#edf1f5';
  let index = breaks.findIndex((breakValue, i) => i > 0 && value <= breakValue);
  if (index < 0) index = breaks.length - 1;
  return seqPalette[Math.min(index, seqPalette.length - 1)];
}

function divergingColor(value, maxAbs) {
  if (!Number.isFinite(value) || value === 0) return '#e8edf2';
  const intensity = Math.min(1, Math.abs(value) / Math.max(maxAbs, 1));
  const alpha = 0.28 + intensity * 0.65;
  return value > 0
    ? `rgba(8,124,98,${alpha})`
    : `rgba(180,35,24,${alpha})`;
}

function mapMetric(ageb, mode) {
  const current = state.currentAgg.byAgeb.get(ageb)?.n || 0;
  const previous = state.compareAgg.byAgeb.get(ageb)?.n || 0;
  const delta = change(current, previous);

  if (mode === 'change_abs') return delta.abs;
  if (mode === 'change_pct') return Number.isFinite(delta.pct) ? delta.pct : null;
  if (mode === 'cp') return topEntry(state.currentAgg.byAgeb.get(ageb)?.cps || new Map())[0];
  if (mode === 'zone') return state.catalog[ageb]?.zones?.[0] || null;
  return current;
}

function mapStyle(ageb, breaks, maxAbs) {
  const mode = getFilters().mode;
  const value = mapMetric(ageb, mode);
  let fillColor = '#e8edf2';
  let fillOpacity = 0.3;

  if (mode === 'count') {
    fillColor = sequentialColor(value, breaks);
    fillOpacity = value ? 0.76 : 0.16;
  } else if (mode === 'change_abs' || mode === 'change_pct') {
    fillColor = divergingColor(value, maxAbs);
    fillOpacity = value === null ? 0.16 : 0.78;
  } else if (mode === 'cp') {
    fillColor = value ? colorFromText(value) : '#e8edf2';
    fillOpacity = value ? 0.72 : 0.15;
  } else if (mode === 'zone') {
    fillColor = value ? (zoneColors[value] || colorFromText(value)) : '#e8edf2';
    fillOpacity = value ? 0.7 : 0.13;
  }

  return {
    color: ageb === state.selectedAgeb ? '#081f34' : '#ffffff',
    weight: ageb === state.selectedAgeb ? 3 : 0.8,
    fillColor,
    fillOpacity,
  };
}

function mapTooltip(ageb) {
  const current = state.currentAgg.byAgeb.get(ageb)?.n || 0;
  const previous = state.compareAgg.byAgeb.get(ageb)?.n || 0;
  const delta = change(current, previous);
  const cp = topEntry(state.currentAgg.byAgeb.get(ageb)?.cps || new Map())[0]
    || state.catalog[ageb]?.cp_dominante
    || 'N/D';
  return `
    <div class="popup-title">AGEB ${escapeHTML(ageb)}</div>
    <div class="popup-row"><span>Establecimientos</span><b>${fmt.format(current)}</b></div>
    <div class="popup-row"><span>Cambio</span><b class="${delta.abs < 0 ? 'negative' : 'positive'}">${signed(delta.abs)}</b></div>
    <div class="popup-row"><span>Variación</span><b>${signedPct(delta.pct)}</b></div>
    <div class="popup-row"><span>CP dominante</span><b>${escapeHTML(cp)}</b></div>
  `;
}

function activateDetailTab() {
  document.querySelector('[data-tab="detailTab"]')?.click();
}

function selectAgeb(ageb, openPopup = false) {
  if (!ageb) return;
  state.selectedAgeb = ageb;
  renderMap();
  renderDetail();
  renderSectors();
  activateDetailTab();

  const layer = state.layer?._layers
    ? Object.values(state.layer._layers).find((candidate) => candidate.options?.ageb === ageb)
    : null;
  if (layer) {
    try {
      const bounds = layer.getBounds?.();
      if (bounds?.isValid?.()) state.map.fitBounds(bounds.pad(0.6), { maxZoom: 15 });
      else if (layer.getLatLng) state.map.setView(layer.getLatLng(), 14);
      if (openPopup) layer.openPopup?.();
    } catch (error) {
      console.debug(error);
    }
  }
}

function geometryFeatures(payload) {
  if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) return payload.features;
  if (Array.isArray(payload?.features)) return payload.features;
  if (Array.isArray(payload)) return payload;
  if (payload?.data?.type === 'FeatureCollection') return payload.data.features || [];
  return [];
}

async function loadGeometry() {
  $('mapStatus').textContent = 'Cargando geometría oficial de AGEB de INEGI…';
  try {
    const payload = await getJSON(state.manifest.geometry_url);
    const activeAgebs = new Set(Object.keys(state.catalog));
    const features = geometryFeatures(payload).filter((feature) => activeAgebs.has(featureAgeb(feature)));
    if (!features.length) throw new Error('La respuesta no incluyó polígonos compatibles.');
    state.geometry = { type: 'FeatureCollection', features };
    state.geometryMode = 'polygons';
    $('mapStatus').textContent = `${fmt.format(features.length)} AGEB cargadas`;
  } catch (error) {
    console.warn('No fue posible cargar los polígonos; se utilizarán centroides.', error);
    state.geometry = null;
    state.geometryMode = 'centroids';
    $('mapStatus').textContent = 'Vista alternativa por centroides · polígonos de INEGI no disponibles';
  }
  window.setTimeout(() => {
    $('mapStatus').style.display = 'none';
  }, 4200);
}

function initMap() {
  state.map = L.map('map', {
    zoomControl: true,
    preferCanvas: true,
    minZoom: 9,
  }).setView([23.245, -106.43], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);
}

function renderLegend(breaks, maxAbs) {
  const mode = getFilters().mode;
  let html = '';

  if (mode === 'count') {
    html = '<h4>Establecimientos por AGEB</h4>';
    for (let i = 1; i < breaks.length; i += 1) {
      const lower = Math.round(breaks[i - 1] + (i === 1 ? 1 : 0));
      const upper = Math.round(breaks[i]);
      html += `<div class="legend-row"><span class="swatch" style="background:${seqPalette[i]}"></span><span>${fmt.format(lower)}–${fmt.format(upper)}</span></div>`;
    }
  } else if (mode === 'change_abs' || mode === 'change_pct') {
    const unit = mode === 'change_pct' ? '%' : '';
    html = `<h4>${mode === 'change_pct' ? 'Cambio porcentual' : 'Cambio absoluto'}</h4>
      <div class="legend-row"><span class="swatch" style="background:rgba(180,35,24,.8)"></span><span>Disminución</span></div>
      <div class="legend-row"><span class="swatch" style="background:#e8edf2"></span><span>Sin cambio</span></div>
      <div class="legend-row"><span class="swatch" style="background:rgba(8,124,98,.8)"></span><span>Aumento</span></div>
      <div class="footnote">Escala máxima observada: ${pctFmt.format(maxAbs)}${unit}</div>`;
  } else if (mode === 'cp') {
    const entries = topEntries(state.currentAgg.cps, 7);
    html = '<h4>Código postal</h4>' + entries.map(([cp]) =>
      `<div class="legend-row"><span class="swatch" style="background:${colorFromText(cp)}"></span><span>${escapeHTML(cp)}</span></div>`
    ).join('');
  } else {
    html = '<h4>Zonas analíticas</h4>' + Object.entries(state.manifest.zones).map(([id, meta]) =>
      `<div class="legend-row"><span class="swatch" style="background:${zoneColors[id] || colorFromText(id)}"></span><span>${escapeHTML(meta.name)}</span></div>`
    ).join('');
  }

  $('legend').innerHTML = html;
}

function renderMap() {
  if (!state.map || !state.currentAgg || !state.compareAgg) return;
  if (state.layer) state.layer.remove();

  const mode = getFilters().mode;
  const agebs = new Set([
    ...state.currentAgg.byAgeb.keys(),
    ...state.compareAgg.byAgeb.keys(),
    ...Object.keys(state.catalog),
  ]);
  const values = [...agebs].map((ageb) => mapMetric(ageb, mode)).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const breaks = sequentialBreaks(values);
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));

  if (state.geometryMode === 'polygons' && state.geometry) {
    state.layer = L.geoJSON(state.geometry, {
      style: (feature) => mapStyle(featureAgeb(feature), breaks, maxAbs),
      onEachFeature: (feature, layer) => {
        const ageb = featureAgeb(feature);
        layer.options.ageb = ageb;
        layer.bindTooltip(`AGEB ${ageb}`, { sticky: true, direction: 'top' });
        layer.bindPopup(mapTooltip(ageb));
        layer.on('click', () => {
          state.selectedAgeb = ageb;
          renderDetail();
          renderSectors();
          renderMap();
          activateDetailTab();
        });
      },
    }).addTo(state.map);
  } else {
    const group = L.layerGroup();
    for (const [ageb, info] of Object.entries(state.catalog)) {
      if (!info.centroid) continue;
      const [lon, lat] = info.centroid;
      const style = mapStyle(ageb, breaks, maxAbs);
      const count = state.currentAgg.byAgeb.get(ageb)?.n || 0;
      const radius = 4 + Math.sqrt(count) * 0.9;
      const marker = L.circleMarker([lat, lon], {
        ageb,
        radius: Math.min(radius, 22),
        color: style.color,
        weight: style.weight,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity,
      });
      marker.bindTooltip(`AGEB ${ageb}`, { sticky: true });
      marker.bindPopup(mapTooltip(ageb));
      marker.on('click', () => {
        state.selectedAgeb = ageb;
        renderDetail();
        renderSectors();
        renderMap();
        activateDetailTab();
      });
      group.addLayer(marker);
    }
    state.layer = group.addTo(state.map);
  }

  if (!state.didFit && state.layer) {
    try {
      const bounds = state.layer.getBounds?.();
      if (bounds?.isValid?.()) state.map.fitBounds(bounds, { padding: [18, 18] });
      state.didFit = true;
    } catch (error) {
      console.debug(error);
    }
  }

  renderLegend(breaks, maxAbs);
  window.setTimeout(() => state.map.invalidateSize(), 80);
}

function renderMetrics(filters, filteredCurrent, filteredCompare) {
  const current = filteredCurrent.length;
  const previous = filteredCompare.length;
  const delta = change(current, previous);
  const municipalTotal = state.current.length;
  const share = municipalTotal ? (current / municipalTotal) * 100 : 0;
  const currentAgebs = new Set(filteredCurrent.map((row) => row[0])).size;

  $('metricTotal').textContent = fmt.format(current);
  $('metricTotalNote').textContent = `Año ${filters.year}`;
  $('metricAgeb').textContent = fmt.format(currentAgebs);
  $('metricAgebNote').textContent = 'con registros filtrados';
  $('metricChange').textContent = signed(delta.abs);
  $('metricChange').className = delta.abs < 0 ? 'negative' : 'positive';
  $('metricChangeNote').textContent = `${signedPct(delta.pct)} respecto de ${filters.compare}`;
  $('metricShare').textContent = percent(share);
  $('metricShareNote').textContent = 'del total municipal del año';
}

function renderDetail() {
  if (!state.currentAgg || !state.compareAgg) return;
  const container = $('detailContent');
  const filters = getFilters();

  if (!state.selectedAgeb) {
    container.className = 'empty-state';
    container.innerHTML = 'Selecciona un AGEB en el mapa o en el ranking para consultar su estructura económica, códigos postales y evolución.';
    return;
  }

  const ageb = state.selectedAgeb;
  const current = state.currentAgg.byAgeb.get(ageb) || { n: 0, sectors: new Map(), cps: new Map(), sizes: new Map() };
  const previous = state.compareAgg.byAgeb.get(ageb) || { n: 0, sectors: new Map(), cps: new Map(), sizes: new Map() };
  const delta = change(current.n, previous.n);
  const [topSector, topSectorN] = topEntry(current.sectors);
  const [topCp] = topEntry(current.cps);
  const catalog = state.catalog[ageb] || {};
  const zones = zoneNames(ageb);
  const settlements = catalog.asentamientos || [];

  container.className = '';
  container.innerHTML = `
    <div class="detail-title">
      <h3>AGEB ${escapeHTML(ageb)}</h3>
      <span class="pill">${fmt.format(current.n)} establecimientos</span>
    </div>

    <div class="tag-wrap">
      ${(zones.length ? zones : ['Sin zona analítica']).map((name) => `<span class="tag">${escapeHTML(name)}</span>`).join('')}
      <span class="tag">CP ${escapeHTML(topCp || catalog.cp_dominante || 'N/D')}</span>
    </div>

    <div class="detail-stats">
      <div class="mini-stat"><b>${fmt.format(current.n)}</b><span>Establecimientos ${filters.year}</span></div>
      <div class="mini-stat"><b class="${delta.abs < 0 ? 'negative' : 'positive'}">${signed(delta.abs)}</b><span>Cambio respecto de ${filters.compare}</span></div>
      <div class="mini-stat"><b>${signedPct(delta.pct)}</b><span>Variación registrada</span></div>
      <div class="mini-stat"><b>${topSector ? escapeHTML(topSector) : 'N/D'}</b><span>Sector principal · ${fmt.format(topSectorN)}</span></div>
    </div>

    <h4>Sectores principales</h4>
    <ul class="detail-list">
      ${topEntries(current.sectors, 6).map(([code, n]) => `
        <li><span>${escapeHTML(state.manifest.sectors[code] || code)}</span><b>${fmt.format(n)}</b></li>
      `).join('') || '<li><span>Sin registros con los filtros actuales</span><b>0</b></li>'}
    </ul>

    <h4>Códigos postales observados</h4>
    <ul class="detail-list">
      ${topEntries(current.cps, 5).map(([cp, n]) => `<li><span>${escapeHTML(cp)}</span><b>${fmt.format(n)}</b></li>`).join('') || '<li><span>Sin datos</span><b>0</b></li>'}
    </ul>

    <h4>Asentamientos asociados en el corte 2025</h4>
    <ul class="detail-list">
      ${settlements.map((item) => `<li><span>${escapeHTML(item.name)}</span><b>${fmt.format(item.n)}</b></li>`).join('') || '<li><span>Sin dato de asentamiento</span><b>–</b></li>'}
    </ul>
  `;
}

function renderSectors() {
  if (!state.currentAgg) return;
  let sectorMap = state.currentAgg.sectors;
  if (state.selectedAgeb) {
    sectorMap = state.currentAgg.byAgeb.get(state.selectedAgeb)?.sectors || new Map();
  }

  const entries = topEntries(sectorMap, 10);
  const max = entries[0]?.[1] || 1;
  $('sectorBars').innerHTML = entries.length ? entries.map(([code, n]) => `
    <div>
      <div class="bar-label">
        <span>${escapeHTML(state.manifest.sectors[code] || code)}</span>
        <b>${fmt.format(n)}</b>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max) * 100}%"></div></div>
    </div>
  `).join('') : '<div class="empty-state">No hay sectores con los filtros actuales.</div>';
}

function renderTable() {
  const filters = getFilters();
  const agebs = new Set([...state.currentAgg.byAgeb.keys(), ...state.compareAgg.byAgeb.keys()]);
  const rows = [...agebs].map((ageb) => {
    const current = state.currentAgg.byAgeb.get(ageb) || { n: 0, sectors: new Map(), cps: new Map() };
    const previous = state.compareAgg.byAgeb.get(ageb) || { n: 0 };
    const delta = change(current.n, previous.n);
    const [sector] = topEntry(current.sectors);
    const [cp] = topEntry(current.cps);
    return {
      ageb,
      zones: zoneNames(ageb).join(', ') || 'Sin zona',
      cp: cp || state.catalog[ageb]?.cp_dominante || 'N/D',
      n: current.n,
      abs: delta.abs,
      pct: delta.pct,
      sector: sector ? (state.manifest.sectors[sector] || sector) : 'N/D',
    };
  }).sort((a, b) => b.n - a.n || a.ageb.localeCompare(b.ageb));

  $('tableCount').textContent = `${fmt.format(rows.length)} AGEB`;
  $('agebTable').innerHTML = rows.map((row) => `
    <tr data-ageb="${escapeHTML(row.ageb)}">
      <td><b>${escapeHTML(row.ageb)}</b></td>
      <td>${escapeHTML(row.zones)}</td>
      <td>${escapeHTML(row.cp)}</td>
      <td>${fmt.format(row.n)}</td>
      <td class="${row.abs < 0 ? 'negative' : 'positive'}">${signed(row.abs)}</td>
      <td>${signedPct(row.pct)}</td>
      <td>${escapeHTML(row.sector)}</td>
    </tr>
  `).join('');

  $('agebTable').querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', () => selectAgeb(row.dataset.ageb, true));
  });

  return { rows, filters };
}

function filteredForZone(rows, filters, zone) {
  return rows.filter((row) => rowPasses(row, filters, { zone }));
}

function renderZones() {
  const filters = getFilters();
  $('zoneCards').innerHTML = Object.entries(state.manifest.zones).map(([id, meta]) => {
    const current = filteredForZone(state.current, filters, id).length;
    const previous = filteredForZone(state.compare, filters, id).length;
    const delta = change(current, previous);
    return `
      <article class="zone-card">
        <h3>${escapeHTML(meta.name)}</h3>
        <strong>${fmt.format(current)}</strong>
        <p><span class="${delta.abs < 0 ? 'negative' : 'positive'}">${signed(delta.abs)}</span> · ${signedPct(delta.pct)} respecto de ${filters.compare}</p>
      </article>
    `;
  }).join('');
}

async function renderTrend() {
  const button = $('loadTrendBtn');
  button.disabled = true;
  button.textContent = 'Cargando…';
  try {
    const filters = getFilters();
    const selectedAgeb = state.selectedAgeb;
    const years = state.manifest.years.map((item) => String(item.year));
    const allRows = await Promise.all(years.map(loadYear));
    const values = allRows.map((rows) => filterRows(rows, filters, selectedAgeb ? { ageb: selectedAgeb } : {}).length);

    $('trendTitle').textContent = selectedAgeb
      ? `Evolución del AGEB ${selectedAgeb}`
      : 'Evolución de la selección territorial';

    if (state.trendChart) state.trendChart.destroy();
    state.trendChart = new Chart($('trendChart'), {
      type: 'line',
      data: {
        labels: years,
        datasets: [{
          label: 'Establecimientos registrados',
          data: values,
          borderColor: '#2f6fab',
          backgroundColor: 'rgba(47,111,171,.14)',
          borderWidth: 2.4,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.22,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (value) => fmt.format(value) } },
        },
      },
    });
  } catch (error) {
    console.error(error);
    $('trendTitle').textContent = 'No fue posible cargar la serie';
  } finally {
    button.disabled = false;
    button.textContent = 'Actualizar';
  }
}

function populateYearControls() {
  const years = state.manifest.years.map((item) => String(item.year));
  const options = years.slice().reverse().map((year) => `<option value="${year}">${year}</option>`).join('');
  $('yearSelect').innerHTML = options;
  $('compareSelect').innerHTML = options;
  $('yearSelect').value = state.manifest.default_year || years.at(-1);
  const currentIndex = years.indexOf($('yearSelect').value);
  $('compareSelect').value = years[Math.max(0, currentIndex - 1)] || years[0];
}

function populateStaticControls() {
  $('zoneSelect').innerHTML = '<option value="ALL">Todo Mazatlán</option>' + Object.entries(state.manifest.zones).map(([id, meta]) => `<option value="${id}">${escapeHTML(meta.name)}</option>`).join('');
  $('sectorSelect').innerHTML = '<option value="ALL">Todos los sectores</option>' + Object.entries(state.manifest.sectors).map(([code, name]) => `<option value="${code}">${escapeHTML(code)} · ${escapeHTML(name)}</option>`).join('');
  $('sizeSelect').innerHTML = '<option value="ALL">Todos los tamaños</option>' + Object.entries(state.manifest.sizes).map(([code, name]) => `<option value="${code}">${escapeHTML(name)}</option>`).join('');
}

function populateCpOptions(rows, keepValue = true) {
  const previous = keepValue ? $('cpSelect').value : 'ALL';
  const filters = getFilters();
  const cps = new Set();
  for (const row of rows) {
    if (agebInZone(row[0], filters.zone)) cps.add(row[1]);
  }
  const sorted = [...cps].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  $('cpSelect').innerHTML = '<option value="ALL">Todos</option>' + sorted.map((cp) => `<option value="${escapeHTML(cp)}">${escapeHTML(cp)}</option>`).join('');
  $('cpSelect').value = sorted.includes(previous) ? previous : 'ALL';
}

async function updateAll({ refreshCp = false, refreshTrend = false } = {}) {
  const filters = getFilters();
  $('mapStatus').style.display = 'block';
  $('mapStatus').textContent = 'Actualizando indicadores y mapa…';

  try {
    const [current, compare] = await Promise.all([loadYear(filters.year), loadYear(filters.compare)]);
    state.current = current;
    state.compare = compare;

    if (refreshCp) populateCpOptions(current, true);
    const effectiveFilters = getFilters();
    const filteredCurrent = filterRows(current, effectiveFilters);
    const filteredCompare = filterRows(compare, effectiveFilters);
    state.currentAgg = aggregate(filteredCurrent);
    state.compareAgg = aggregate(filteredCompare);

    renderMetrics(effectiveFilters, filteredCurrent, filteredCompare);
    renderMap();
    renderDetail();
    renderSectors();
    renderTable();
    renderZones();
    if (refreshTrend) renderTrend();
  } catch (error) {
    console.error(error);
    $('mapStatus').textContent = `Error: ${error.message}`;
    return;
  }

  $('mapStatus').textContent = 'Consulta actualizada';
  window.setTimeout(() => { $('mapStatus').style.display = 'none'; }, 1000);
}

function resetControls() {
  $('yearSelect').value = state.manifest.default_year;
  const years = state.manifest.years.map((item) => String(item.year));
  const currentIndex = years.indexOf($('yearSelect').value);
  $('compareSelect').value = years[Math.max(0, currentIndex - 1)] || years[0];
  $('zoneSelect').value = 'ALL';
  $('sectorSelect').value = 'ALL';
  $('sizeSelect').value = 'ALL';
  $('mapModeSelect').value = 'count';
  $('agebSearch').value = '';
  state.selectedAgeb = null;
  updateAll({ refreshCp: true, refreshTrend: true });
}

function downloadCSV() {
  const filters = getFilters();
  const agebs = new Set([...state.currentAgg.byAgeb.keys(), ...state.compareAgg.byAgeb.keys()]);
  const lines = [[
    'ageb', 'zonas', 'cp_dominante', `establecimientos_${filters.year}`,
    `establecimientos_${filters.compare}`, 'cambio_absoluto', 'cambio_porcentual', 'sector_principal'
  ]];

  for (const ageb of agebs) {
    const current = state.currentAgg.byAgeb.get(ageb) || { n: 0, sectors: new Map(), cps: new Map() };
    const previous = state.compareAgg.byAgeb.get(ageb) || { n: 0 };
    const delta = change(current.n, previous.n);
    const [sector] = topEntry(current.sectors);
    const [cp] = topEntry(current.cps);
    lines.push([
      ageb,
      zoneNames(ageb).join(' | '),
      cp || state.catalog[ageb]?.cp_dominante || '',
      current.n,
      previous.n,
      delta.abs,
      Number.isFinite(delta.pct) ? delta.pct.toFixed(2) : '',
      sector ? (state.manifest.sectors[sector] || sector) : '',
    ]);
  }

  const csv = '\ufeff' + lines.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `resumen_denue_mazatlan_${filters.year}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $('yearSelect').addEventListener('change', () => updateAll({ refreshCp: true, refreshTrend: true }));
  $('compareSelect').addEventListener('change', () => updateAll({ refreshTrend: false }));
  $('zoneSelect').addEventListener('change', () => updateAll({ refreshCp: true, refreshTrend: true }));
  $('cpSelect').addEventListener('change', () => updateAll({ refreshTrend: true }));
  $('sectorSelect').addEventListener('change', () => updateAll({ refreshTrend: true }));
  $('sizeSelect').addEventListener('change', () => updateAll({ refreshTrend: true }));
  $('mapModeSelect').addEventListener('change', renderMap);
  $('resetBtn').addEventListener('click', resetControls);
  $('downloadBtn').addEventListener('click', downloadCSV);
  $('loadTrendBtn').addEventListener('click', renderTrend);

  $('agebSearch').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const ageb = normalizeAgeb(event.currentTarget.value);
    if (!ageb || !state.catalog[ageb]) {
      event.currentTarget.setCustomValidity('No se encontró ese AGEB en el catálogo 2025.');
      event.currentTarget.reportValidity();
      window.setTimeout(() => event.currentTarget.setCustomValidity(''), 1500);
      return;
    }
    selectAgeb(ageb, true);
  });
}

async function start() {
  try {
    [state.manifest, state.catalog] = await Promise.all([
      getJSON('data/manifest.json'),
      getJSON('data/ageb_catalog.json'),
    ]);

    populateYearControls();
    populateStaticControls();
    initMap();
    bindEvents();

    const initialRows = await loadYear(state.manifest.default_year);
    state.current = initialRows;
    populateCpOptions(initialRows, false);

    await Promise.all([
      loadGeometry(),
      updateAll({ refreshCp: false, refreshTrend: false }),
    ]);

    renderMap();
    renderTrend();
  } catch (error) {
    console.error(error);
    $('mapStatus').style.display = 'block';
    $('mapStatus').textContent = `No fue posible cargar el portal: ${error.message}`;
  }
}

start();
