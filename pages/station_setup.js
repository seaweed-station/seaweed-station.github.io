// station_setup.js — Extracted from station.html (Sprint 6)
// Harvest controls, sensor map, page setup, DOMContentLoaded
"use strict";

// =====================================================================
// HARVEST THRESHOLD
// =====================================================================
function onHarvestCtrlChange() {
  var enEl = document.getElementById('harvestThreshEnabled');
  var hEl  = document.getElementById('harvestThreshHeight');
  window._harvestOpts = {
    enabled:   enEl ? enEl.checked : true,
    maxHeight: hEl  ? (parseFloat(hEl.value) || 0.50) : 0.50
  };
  ['tideChartDetail', 'tideChartOverview'].forEach(function (id) {
    var c = Chart.getChart(id); if (c) c.destroy();
  });
  if (window.SeaweedTides) SeaweedTides.init(STATION.tideStation);
}

// =====================================================================
// SENSOR MAP SETUP
// =====================================================================
var _sensorMiniMap = null;
var _sensorModalMap = null;
var _sensorMapCoords = null;

function setupSensorMap() {
  var mapKey = STATION.sensorMap;
  var mapDef = mapKey ? SENSOR_MAPS[mapKey] : null;
  var panel  = document.getElementById('sensorMapPanel');
  if (!mapDef) { panel.style.display = 'none'; return; }

  panel.style.display = '';
  var inner = document.getElementById('sensorMapInner');
  var lat = Number(STATION && STATION.mapLat);
  var lon = Number(STATION && STATION.mapLon);
  var hasCoords = isFinite(lat) && isFinite(lon);
  _sensorMapCoords = hasCoords ? { lat: lat, lon: lon, label: (STATION && STATION.title) ? STATION.title : 'Station' } : null;

  var html = '<div class="sensor-map-layout"><div class="sensor-map-figure">';
  html += '<svg class="rack-svg" viewBox="' + mapDef.viewBox + '" xmlns="http://www.w3.org/2000/svg" aria-label="' + mapDef.label + '">' + mapDef.svg + '</svg>';
  html += '<div class="sensor-map-legend">';
  mapDef.legend.forEach(function(item) {
    html += '<div class="sml-item"><div class="sml-dot" style="background:' + item.color + '"></div><span style="color:' + item.color + '">' + item.label + '</span></div>';
  });
  html += '</div></div>';
  if (hasCoords) {
    html += '<div class="sensor-mini-map-card">';
    html += '<div class="sensor-mini-map-head"><span class="sensor-mini-map-title">Station Location</span>' +
      '<button class="sensor-mini-map-expand" onclick="openSensorMapModal(event)" title="Expand map">&#10530;</button></div>';
    html += '<div id="sensorMiniMap" class="sensor-mini-map"></div>';
    html += '<div class="sensor-mini-map-note">Scroll or pinch to zoom. Drag to pan.</div>';
    html += '</div>';
  }
  html += '</div>';
  inner.innerHTML = html;

  if (hasCoords && typeof L !== 'undefined') {
    initSensorMiniMap(lat, lon);
  }
}

function initSensorMiniMap(lat, lon) {
  var mapEl = document.getElementById('sensorMiniMap');
  if (!mapEl || typeof L === 'undefined') return;
  if (_sensorMiniMap) {
    _sensorMiniMap.remove();
    _sensorMiniMap = null;
  }
  _sensorMiniMap = L.map(mapEl, {
    zoomControl: false,
    attributionControl: true,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false
  }).setView([lat, lon], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(_sensorMiniMap);
  L.marker([lat, lon]).addTo(_sensorMiniMap).bindPopup((_sensorMapCoords && _sensorMapCoords.label) ? _sensorMapCoords.label : 'Station');
  setTimeout(function() { if (_sensorMiniMap) _sensorMiniMap.invalidateSize(); }, 80);
}

function openSensorMapModal(evt) {
  if (evt) evt.stopPropagation();
  if (!_sensorMapCoords || typeof L === 'undefined') return;
  var overlay = document.getElementById('sensorMapModalOverlay');
  var modalCanvas = document.getElementById('sensorMapModalCanvas');
  var title = document.getElementById('sensorMapModalTitle');
  if (title) title.textContent = (_sensorMapCoords.label || 'Station') + ' Location';
  overlay.style.display = 'flex';

  if (_sensorModalMap) {
    _sensorModalMap.remove();
    _sensorModalMap = null;
  }

  _sensorModalMap = L.map(modalCanvas, { zoomControl: true, attributionControl: true }).setView([_sensorMapCoords.lat, _sensorMapCoords.lon], 13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(_sensorModalMap);
  L.marker([_sensorMapCoords.lat, _sensorMapCoords.lon]).addTo(_sensorModalMap).bindPopup(_sensorMapCoords.label || 'Station').openPopup();
  setTimeout(function() { if (_sensorModalMap) _sensorModalMap.invalidateSize(); }, 80);
}

function closeSensorMapModal(evt) {
  if (evt && evt.target && evt.target.id !== 'sensorMapModalOverlay' && !evt.target.classList.contains('sensor-map-modal-close')) return;
  var overlay = document.getElementById('sensorMapModalOverlay');
  if (overlay) overlay.style.display = 'none';
  if (_sensorModalMap) {
    _sensorModalMap.remove();
    _sensorModalMap = null;
  }
}

// =====================================================================
// PAGE SETUP (title, subtitle, footer)
// =====================================================================
function setupPage() {
  document.getElementById('pageTitle').textContent   = STATION.title + ' -- Seaweed T/H Monitoring';
  document.getElementById('stationTitle').textContent = STATION.title;
  document.getElementById('stationSubtitle').textContent = STATION.subtitle;
  document.getElementById('footerName').textContent  = STATION.title;
  document.getElementById('channelLabel').textContent = STATION.channelId || '--';
}

// =====================================================================
// INITIALIZATION
// =====================================================================
document.addEventListener('DOMContentLoaded', function () {
  updateStationDiagnostics({ source: 'loading', lastRefreshAt: Date.now(), error: '', note: 'Station page booting…' });
  // Apply role-based nav visibility
  if (typeof applyNavVisibility === 'function') applyNavVisibility();

  // Setup page chrome
  setupPage();
  setupSensorMap();

  // Display timezone
  document.getElementById('tzLabel').textContent = getTimezoneLabel();

  // Tides (always available -- no sensor data needed)
  window._harvestOpts = { enabled: true, maxHeight: 0.50 };
  if (window.SeaweedTides) {
    SeaweedTides.init(STATION.tideStation);
  }

  // Restore saved date range preference
  restoreViewPrefs();

  // Pre-seed cached weather so night/day shading and Open-Meteo overlays are ready on first render.
  if (applyWeatherCache(false)) {
    console.log('[Weather] Pre-seeded cached weather_data.js');
    refreshWeatherLinkedViews();
  }

  // Pre-seed from cache so the page is not blank during the network call
  try {
    var _edgeCacheRaw = localStorage.getItem('seaweed_cache_' + TABLE_ID);
    if (_edgeCacheRaw) {
      var _edgeCache = JSON.parse(_edgeCacheRaw);
      if (_edgeCache && Array.isArray(_edgeCache.allEntries) && _edgeCache.allEntries.length) {
        var _requestedWindow = getEdgeTimeWindow();
        if (stationCacheCanPrimeRange(_edgeCache, _requestedWindow, state.timeRange)) {
          state.allEntries = normalizeCachedEntries(_edgeCache.allEntries);
          if (state.allEntries.length) {
            setStationLoadedWindow(getStationCacheWindow(_edgeCache) || getEntriesBounds(state.allEntries));
            state.channelInfo = _edgeCache.channelInfo || state.channelInfo || null;
            state.dataSource = 'Cached (loading edge…)';
            applyTimeRange();
            renderDashboard();
            updateStationDiagnostics({
              source: 'cache-preseed',
              dataAsOf: state.allEntries[state.allEntries.length - 1].timestamp,
              entryCount: state.allEntries.length,
              cacheAgeS: _edgeCache.savedAt ? Math.round((Date.now() - _edgeCache.savedAt) / 1000) : null,
              lastRefreshAt: Date.now(),
              error: '',
              note: 'Page pre-seeded from localStorage cache while live fetch runs.'
            });
          }
        } else {
          console.log('[Dashboard] Skipping cache preseed (' + TABLE_ID + '): cached window does not cover current ' + state.timeRange + ' view');
        }
      }
    }
  } catch (_) {}

  (async function() {
    try {
      var payload = await fetchEdgeStationDetail();
      _edgeDetailPayload = payload;
      _edgeDetailPayloadAt = Date.now();

      var entries = edgePayloadToEntries(payload);
      state.allEntries = entries;
  setStationLoadedWindow(payload.time_range || getEntriesBounds(entries));
      state.dataSource = 'Edge Function';

      applyEdgeSideData(payload);
      applyTimeRange();
      renderDashboard();

      saveStationCache(TABLE_ID, state.allEntries, {
        channelInfo: state.channelInfo,
        source: 'edge',
        timeRange: state.timeRange,
        windowStart: payload.time_range ? payload.time_range.from : null,
        windowEnd: payload.time_range ? payload.time_range.to : null
      });
      notifyDashboardDataRefresh([TABLE_ID], 'station.edgeInit');

      var ds = payload.downsampling || {};
      console.log('[Dashboard] Edge init: ' + entries.length + ' entries' +
        ' (total ' + (ds.total_rows || '?') + ', step ' + (ds.step || 1) + ')');
      updateStationDiagnostics({
        source: 'edge',
        generatedAt: payload.generated_at,
        dataAsOf: payload.data_as_of,
        schemaVersion: payload.schema_version,
        rangeLabel: payload.time_range ? (dashboardDiagFormatUtc(payload.time_range.from) + ' → ' + dashboardDiagFormatUtc(payload.time_range.to)) : '--',
        entryCount: entries.length,
        returnedRows: ds.returned,
        totalRows: ds.total_rows,
        step: ds.step,
        syncCount: payload.sync_sessions ? payload.sync_sessions.length : 0,
        fetchDurationMs: payload._response_duration_ms,
        cacheAgeS: 0,
        lastRefreshAt: Date.now(),
        error: '',
        note: 'Initial station-detail load completed from Edge Function.'
      });
    } catch (edgeErr) {
      console.warn('[Dashboard] Edge init failed:', edgeErr.message);
      updateStationDiagnostics({
        source: state.allEntries && state.allEntries.length ? 'cache-preseed' : 'error',
        dataAsOf: state.allEntries && state.allEntries.length ? state.allEntries[state.allEntries.length - 1].timestamp : null,
        entryCount: state.allEntries ? state.allEntries.length : 0,
        lastRefreshAt: Date.now(),
        error: edgeErr.message || 'Station init failed',
        note: state.allEntries && state.allEntries.length
          ? 'Continuing with cached data because initial live fetch failed.'
          : 'Initial station-detail fetch failed before any cache was available.'
      });
    }
    setupAutoRefresh();
  })();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSensorMapModal();
});
