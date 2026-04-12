// health_edge_fetch.js — Extracted from station_health.html (Sprint 6)
// Edge Function fetch, payload application, device status/config/slots refresh

async function refreshDeviceStatusMap() {
  try {
    var ids = STATIONS.map(function(st) { return st.id; });
    _deviceStatusById = await fetchDeviceStatusMap(ids);
  } catch (e) {
    console.warn('[Health] device_status fetch failed:', e.message || e);
  }
}

async function refreshDeviceConfigMap() {
  try {
    var ids = STATIONS.map(function(st) { return st.id; }).filter(Boolean);
    if (!ids.length) { _deviceConfigById = {}; return; }
    var supaCfg = getSupabaseConfig();
    var hdrs = supabaseHeaders(supaCfg.key);
    var idList = ids.map(function(id) { return String(id).replace(/,/g, ''); }).join(',');
    var url = supaCfg.url + '/rest/v1/device_config' +
              '?select=device_id,upload_interval_hours,sample_period_min,sat_sync_period_hours,deploy_mode,sleep_enable,updated_at' +
              '&device_id=in.(' + encodeURIComponent(idList) + ')';
    var res = await fetchWithTimeout(url, 15000, { headers: hdrs });
    if (!res.ok) throw new Error('device_config HTTP ' + res.status);
    var rows = await res.json();
    var out = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      if (!r.device_id) continue;
      out[r.device_id] = r;
    }
    _deviceConfigById = out;
  } catch (e) {
    console.warn('[Health] device_config fetch failed:', e.message || e);
  }
}

async function refreshDeviceSlotMap() {
  try {
    var ids = STATIONS.map(function(st) { return st.id; }).filter(Boolean);
    _deviceSlotsById = ids.length ? await fetchDeviceSlotsMap(ids) : {};
  } catch (e) {
    console.warn('[Health] device_slots fetch failed:', e.message || e);
  }
}


async function fetchEdgeHealthSummary(opts) {
  opts = opts || {};
  var startedAt = Date.now();
  var supaCfg = getSupabaseConfig();
  var now = new Date();
  // Load enough history for the Month view to differ from Week while keeping
  // the initial payload bounded and consistent with the deployed 30-day RPC path.
  var from = opts.from || new Date(now.getTime() - 30 * 86400000).toISOString();
  var to = opts.to || now.toISOString();
  var pts = opts.points || 500;
  var url = supaCfg.url + '/functions/v1/health-summary' +
    '?from=' + encodeURIComponent(from) +
    '&to=' + encodeURIComponent(to) +
    '&points=' + pts;

  var res = await fetchWithTimeout(url, 30000, {
    headers: {
      'Authorization': 'Bearer ' + supaCfg.key,
      'apikey': supaCfg.key
    }
  });

  if (!res.ok) {
    var body = null;
    try { body = await res.json(); } catch (_) {}
    var errMsg = body && body.error ? body.error : ('HTTP ' + res.status);
    throw new Error('Edge Function (health-summary): ' + errMsg);
  }

  var payload = await res.json();
  if (payload.source === 'error') {
    throw new Error('Edge Function RPC: ' + (payload.error || 'unknown error'));
  }
  payload._response_duration_ms = Date.now() - startedAt;
  return payload;
}

/**
 * Convert a health-summary Edge payload into the global state variables
 * consumed by the health page charts and tables.
 */
function applyEdgeHealthPayload(payload) {
  if (!payload || !Array.isArray(payload.stations)) return;

  var newDeviceStatus = {};
  var newDeviceConfig = {};
  var newDeviceSlots = {};

  for (var i = 0; i < payload.stations.length; i++) {
    var st = payload.stations[i];
    var sid = st.station_id;
    if (!sid) continue;

    // ── Slot map ──────────────────────────────────────────
    if (st.slot_map && typeof st.slot_map === 'object') {
      newDeviceSlots[sid] = {};
      var smKeys = Object.keys(st.slot_map);
      for (var k = 0; k < smKeys.length; k++) {
        newDeviceSlots[sid][smKeys[k]] = Number(st.slot_map[smKeys[k]]);
      }
    } else {
      newDeviceSlots[sid] = {};
    }

    // ── Feeds → entries via feedToEntry ───────────────────
    var discoveredSlots = [];
    if (st.slot_map) {
      var slotKeys = Object.keys(st.slot_map);
      for (var sk = 0; sk < slotKeys.length; sk++) {
        var sn = Number(st.slot_map[slotKeys[sk]]);
        if (sn && discoveredSlots.indexOf(sn) < 0) discoveredSlots.push(sn);
      }
    }
    if (!discoveredSlots.length) discoveredSlots = [1, 2];

    var entries = [];
    if (Array.isArray(st.feeds)) {
      for (var fi = 0; fi < st.feeds.length; fi++) {
        var e = feedToEntry(st.feeds[fi], discoveredSlots);
        if (e && e.timestamp instanceof Date && !isNaN(e.timestamp.getTime())) entries.push(e);
      }
      entries.sort(function(a, b) { return a.timestamp - b.timestamp; });
    }
    stationData[sid] = { entries: entries, raw: { feeds: st.feeds || [] } };
    _stationDataSource[sid] = { source: 'edge', savedAt: Date.now() };

    // Save to shared cache for cross-tab sharing
    if (entries.length) {
      saveCacheData(sid, entries);
    }

    // ── Sync sessions ────────────────────────────────────
    var syncRows = Array.isArray(st.sync_sessions) ? st.sync_sessions : [];
    syncRows = syncRows.filter(function(r) {
      return typeof isAfterResetWindow !== 'function' || isAfterResetWindow(sid, r && r.sync_started_at);
    });
    syncRows.sort(function(a, b) {
      return new Date(a.sync_started_at).getTime() - new Date(b.sync_started_at).getTime();
    });
    _stationSyncTimeline[sid] = syncRows;

    // ── Upload sessions ──────────────────────────────────
    var uploadRows = Array.isArray(st.upload_sessions) ? st.upload_sessions : [];
    uploadRows = uploadRows.filter(function(r) {
      return typeof isAfterResetWindow !== 'function' || isAfterResetWindow(sid, r && r.upload_started_at);
    });
    uploadRows.sort(function(a, b) {
      return new Date(a.upload_started_at).getTime() - new Date(b.upload_started_at).getTime();
    });
    _stationUploadTimeline[sid] = uploadRows;

    // ── Derive _stationDiag (latest upload + latest sync per node) ──
    var latestUpload = uploadRows.length ? uploadRows[uploadRows.length - 1] : null;
    var latestSyncByNode = {};
    for (var ri = syncRows.length - 1; ri >= 0; ri--) {
      var node = syncRows[ri].node_id;
      if (node && !latestSyncByNode[node]) latestSyncByNode[node] = syncRows[ri];
    }
    _stationDiag[sid] = { upload: latestUpload, sync: latestSyncByNode };

    // ── Device status ────────────────────────────────────
    if (st.device_status) {
      var ds = st.device_status;
      newDeviceStatus[sid] = {
        batteryPct: (ds.battery_pct != null) ? Number(ds.battery_pct) : null,
        nextCheckInAt: ds.next_check_in ? (typeof parseNextCheckInValue === 'function' ? parseNextCheckInValue(ds.next_check_in) : new Date(ds.next_check_in)) : null,
        lastSeenAt: ds.last_seen ? new Date(ds.last_seen) : null,
        lastUploadAt: ds.last_upload_at ? new Date(ds.last_upload_at) : null,
        raw: ds
      };
    }

    // ── Device config ────────────────────────────────────
    if (st.device_config) {
      newDeviceConfig[sid] = st.device_config;
    }
  }

  _deviceStatusById = newDeviceStatus;
  _deviceConfigById = newDeviceConfig;
  _deviceSlotsById = newDeviceSlots;
}

/**
 * Edge-path fetch: one Edge Function call replaces N×7 PostgREST calls.
 */
async function fetchLiveAllEdge() {
  var btn    = document.getElementById('btnFetchAll');
  var status = document.getElementById('fetchStatus');
  btn.innerHTML = '<span class="spinner"></span> Fetching...';
  btn.disabled  = true;
  status.textContent = '';
  updateHealthDiagnostics({ source: 'loading', lastRefreshAt: Date.now(), error: '', note: 'Waiting for health-summary payload…' });

  try {
    status.textContent = 'Fetching all stations via Edge Function...';
    var payload = await fetchEdgeHealthSummary();

    applyEdgeHealthPayload(payload);

    // Show rendering status and yield so the browser can repaint
    status.textContent = 'Rendering charts...';
    await yieldToBrowser();

    // Destroy existing charts and rebuild
    liveCharts.forEach(function(c) { try { c.destroy(); } catch(e){} });
    liveCharts = [];
    _syncWindowCache = {};
    _stationChartsRendered = {};
    var container = document.getElementById('stationsContainer');
    container.innerHTML = '';
    container.style.display = '';
    document.getElementById('loadingMsg').style.display = 'none';

    for (var si = 0; si < STATIONS.length; si++) {
      var st = STATIONS[si];
      var data = stationData[st.id];
      if (!data) continue;
      status.textContent = 'Rendering ' + st.name + ' (' + (si+1) + '/' + STATIONS.length + ')...';
      await yieldToBrowser();
      var section = renderStationSection(st, data);
      container.appendChild(section);
    }

    // Update forecast with currently selected station
    if (window.BatteryForecast) {
      var sel = document.getElementById('fcStationSelect');
      var selId = sel ? sel.value : (STATIONS[0] ? STATIONS[0].id : null);
      if (selId && stationData[selId] && stationData[selId].entries.length) {
        BatteryForecast.reset();
        BatteryForecast.init({ allEntries: stationData[selId].entries });
        document.getElementById('forecastPanel').style.display = '';
      }
    }

    var stationSummary = (payload.stations || []).map(function(s) {
      return s.station_id + ':' + (Array.isArray(s.feeds) ? s.feeds.length : 0) + 'f';
    }).join(', ');
    console.log('[Health] Edge Function loaded: ' + (payload.station_count || 0) + ' stations (' + stationSummary + ')');

    updateHealthDiagnostics({
      source: 'edge',
      generatedAt: payload.generated_at,
      dataAsOf: getHealthLatestDataAsOf(),
      schemaVersion: payload.schema_version,
      rangeLabel: payload.time_range ? (dashboardDiagFormatUtc(payload.time_range.from) + ' → ' + dashboardDiagFormatUtc(payload.time_range.to)) : '--',
      stationCount: payload.station_count,
      fetchDurationMs: payload._response_duration_ms,
      cacheAgeS: 0,
      stationSummary: stationSummary,
      lastRefreshAt: Date.now(),
      error: '',
      note: 'Single health-summary Edge payload for all active stations.'
    });

    btn.innerHTML = '&#128752; Fetch Live';
    btn.disabled  = false;
    var ts = new Date().toLocaleTimeString('en-GB', {timeZone:'UTC', hour:'2-digit', minute:'2-digit'}) + ' UTC';
    status.innerHTML = '<span style="color:var(--success)">All ' + STATIONS.length + ' stations updated via edge &mdash; ' + ts + '</span>';

    notifyDashboardDataRefresh(STATIONS.map(function(st) { return st.id; }), 'station_health.fetchLiveAllEdge');

  } catch (err) {
    console.error('[Health] Edge Function fetch failed:', err);
    btn.innerHTML = '&#128752; Fetch Live';
    btn.disabled  = false;
    status.innerHTML = '<span style="color:var(--warning)">Edge fetch failed &mdash; ' + (err.message || err) + '</span>';
    updateHealthDiagnostics({
      source: Object.keys(stationData).length ? 'cache-preseed' : 'error',
      dataAsOf: getHealthLatestDataAsOf(),
      stationCount: STATIONS.length,
      cacheAgeS: getHealthLatestCacheAgeS(),
      stationSummary: getHealthStationSummary(),
      lastRefreshAt: Date.now(),
      error: err.message || String(err),
      note: Object.keys(stationData).length
        ? 'Continuing with cached station data after live fetch failure.'
        : 'No station data available because the live fetch failed before cache could be used.'
    });
  }
}
