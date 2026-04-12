// station_data.js — Extracted from station.html (Sprint 6)
// Data parsing, edge fetch, time range, cache, export
"use strict";

// =====================================================================
// DATA PARSING — v2 structured feeds (named properties)
// =====================================================================
// supabaseRowToFeed now emits named properties directly.
// Legacy field1-8 CSV is still accepted as fallback for old exported datasets.
//
function parseFeeds(rawFeeds) {
  var out = rawFeeds.map(function (f) {
    var ts = new Date(f.created_at);
    if (isFutureTimestamp(ts)) return null;

    // ── Detect format: structured (new) vs legacy field1-8 ──
    var isLegacy = f.field1 !== undefined || f.field2 !== undefined;

    if (!isLegacy) {
      // ── Structured path (Supabase v2 / slot-indexed feeds) ──
      return feedToEntry(f, f._discovered_slots || [1, 2]);
    }

    // ── Legacy field1-8 fallback (old exported JSON datasets) ──
    var t0Sensors = csvParse(f.field2);
    var t0Status  = csvParse(f.field3);
    var slot1Stat = csvParse(f.field4);
    var slot1Sens = csvParse(f.field5);
    var slot2Stat = csvParse(f.field6);
    var slot2Sens = csvParse(f.field7);
    var f8raw = f.field8 || '';
    var f8sections = f8raw.split('|');
    var f8diag = f8sections[0] || '';
    var sys = csvParse(f8diag);

    var slot1Fw = null, slot2Fw = null, t0Fw = null, t0BuildDate = null;
    if (f.field4) {
      var parts4 = f.field4.split(',');
      if (parts4.length > 6 && parts4[6]) slot1Fw = parts4[6].trim();
    }
    if (f.field6) {
      var parts6 = f.field6.split(',');
      if (parts6.length > 6 && parts6[6]) slot2Fw = parts6[6].trim();
    }
    if (f8sections.length > 2) {
      var fwParts = f8sections[2].split(',');
      t0Fw = fwParts[0] ? fwParts[0].trim() : null;
      t0BuildDate = fwParts[1] ? fwParts[1].trim() : null;
    }
    var cfgCsv = csvParse((f8sections[1] || ''));

    return {
      timestamp: ts,
      entryId:   f.entry_id,
      deployMode:         cfgCsv[0] != null ? numParse(cfgCsv[0]) : null,
      samplePeriod_s:     cfgCsv[1] != null ? numParse(cfgCsv[1]) : null,
      sleepEnable:        null,
      espnowSyncPeriod_s: null,
      sat1Installed:      cfgCsv[6] != null ? (numParse(cfgCsv[6]) === 1) : null,
      sat2Installed:      cfgCsv[7] != null ? (numParse(cfgCsv[7]) === 1) : null,
      // T0
      t0BatPct:  numParse(f.field1),
      t0Temp1:   t0Sensors[0] != null ? t0Sensors[0] : null,
      t0Hum1:    t0Sensors[1] != null ? t0Sensors[1] : null,
      t0Temp2:   t0Sensors[2] != null ? t0Sensors[2] : null,
      t0Hum2:    t0Sensors[3] != null ? t0Sensors[3] : null,
      t0Temp3:   t0Sensors[4] != null ? t0Sensors[4] : null,
      t0Hum3:    t0Sensors[5] != null ? t0Sensors[5] : null,
      t0BatV:    t0Status[0]  != null ? t0Status[0]  : null,
      t0Rssi:    t0Status[1]  != null ? t0Status[1]  : null,
      t0Boot:    t0Status[2]  != null ? t0Status[2]  : null,
      t0Heap:    t0Status[3]  != null ? t0Status[3]  : null,
      // Slot 1 (legacy Sat-A)
      sat1BatV:     slot1Stat[0] != null ? slot1Stat[0] : null,
      sat1BatPct:   slot1Stat[1] != null ? slot1Stat[1] : null,
      sat1Rssi:     slot1Stat[2] != null ? slot1Stat[2] : null,
      sat1SampleId: slot1Stat[3] != null ? slot1Stat[3] : null,
      sat1SyncDrift: slot1Stat[5] != null ? slot1Stat[5] : null,
      sat1Temp1:    slot1Sens[0] != null ? slot1Sens[0] : null,
      sat1Hum1:     slot1Sens[1] != null ? slot1Sens[1] : null,
      sat1Temp2:    slot1Sens[2] != null ? slot1Sens[2] : null,
      sat1Hum2:     slot1Sens[3] != null ? slot1Sens[3] : null,
      // Slot 2 (legacy Sat-B)
      sat2BatV:     slot2Stat[0] != null ? slot2Stat[0] : null,
      sat2BatPct:   slot2Stat[1] != null ? slot2Stat[1] : null,
      sat2Rssi:     slot2Stat[2] != null ? slot2Stat[2] : null,
      sat2SampleId: slot2Stat[3] != null ? slot2Stat[3] : null,
      sat2SyncDrift: slot2Stat[5] != null ? slot2Stat[5] : null,
      sat2Temp1:    slot2Sens[0] != null ? slot2Sens[0] : null,
      sat2Hum1:     slot2Sens[1] != null ? slot2Sens[1] : null,
      sat2Temp2:    slot2Sens[2] != null ? slot2Sens[2] : null,
      sat2Hum2:     slot2Sens[3] != null ? slot2Sens[3] : null,
      // System
      sdFreeKB:   sys[0] != null ? sys[0] : null,
      csq:        sys[1] != null ? sys[1] : null,
      uploadOk:   sys[2] != null ? sys[2] : null,
      syncDrift:  sys[3] != null ? sys[3] : null,
      // Firmware
      t0FwVersion: t0Fw,
      t0BuildDate: t0BuildDate,
      sat1FwVersion: slot1Fw,
      sat2FwVersion: slot2Fw,
    };
  }).filter(function (e) { return e && !isNaN(e.timestamp.getTime()); })
    .sort(function (a, b) { return a.timestamp - b.timestamp; });

  if (typeof filterEntryArrayByResetWindow === 'function') {
    return filterEntryArrayByResetWindow(TABLE_ID, out);
  }
  return out;
}

// =====================================================================
// DATA LOADING + DEDUPLICATION
// =====================================================================
function handleNewData(data, sourceLabel, persistCache) {
  if (!data || !data.feeds || !data.feeds.length) {
    console.warn('[Dashboard] No feed data in source:', sourceLabel);
    return;
  }

  var newEntries = parseFeeds(data.feeds);
  var entryMap   = new Map();
  state.allEntries.forEach(function (e) { entryMap.set(e.entryId, e); });
  newEntries.forEach(function (e) { entryMap.set(e.entryId, e); });
  state.allEntries = Array.from(entryMap.values()).sort(function (a, b) { return a.timestamp - b.timestamp; });

  state.channelInfo = data.channel || state.channelInfo;
  state.dataSource  = sourceLabel;

  applyTimeRange();
  renderDashboard();

  if (persistCache !== false) {
    saveStationCache(TABLE_ID, state.allEntries, {
      channelInfo: state.channelInfo,
      source: sourceLabel && sourceLabel.toLowerCase().indexOf('live') >= 0 ? 'live' : 'cache'
    });
  }
}

function normalizeCachedEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  var out = [];
  rawEntries.forEach(function(e) {
    if (!e || typeof e !== 'object') return;

    // Case 1: already parsed station entry shape.
    if (e.timestamp !== undefined) {
      var parsed = Object.assign({}, e);
      if (parsed.timestamp && !(parsed.timestamp instanceof Date)) parsed.timestamp = new Date(parsed.timestamp);
      if (!parsed.timestamp || isNaN(parsed.timestamp.getTime())) return;
      if (parsed.t0Temp3 === undefined && parsed.temp_3 !== undefined) parsed.t0Temp3 = parsed.temp_3 != null ? numParse(parsed.temp_3) : null;
      if (parsed.t0Hum3 === undefined && parsed.humidity_3 !== undefined) parsed.t0Hum3 = parsed.humidity_3 != null ? numParse(parsed.humidity_3) : null;
      out.push(parsed);
      return;
    }

    // Case 2: structured feed shape ({created_at, temp_1..}) from shared cache writers.
    if (e.created_at !== undefined) {
      var conv = parseFeeds([e]);
      if (conv && conv.length) out.push(conv[0]);
    }
  });

  out.sort(function(a, b) { return a.timestamp - b.timestamp; });
  if (typeof filterEntryArrayByResetWindow === 'function') {
    return filterEntryArrayByResetWindow(TABLE_ID, out);
  }
  return out;
}

// =====================================================================
// EDGE FUNCTION PATH (Sprint 3)
// =====================================================================

var _edgeDetailPayload = null;   // last successful Edge payload
var _edgeDetailPayloadAt = 0;    // Date.now() when fetched
var _stationLoadedWindow = null; // { min, max } for the current in-memory allEntries set
var _stationDiagMeta = { source: 'idle' };

function setStationLoadedWindow(windowLike) {
  if (!windowLike) {
    _stationLoadedWindow = null;
    return;
  }

  var min = windowLike.min;
  var max = windowLike.max;
  if (windowLike.from != null) min = windowLike.from;
  if (windowLike.to != null) max = windowLike.to;

  min = min instanceof Date ? min.getTime() : new Date(min).getTime();
  max = max instanceof Date ? max.getTime() : new Date(max).getTime();

  if (!isFinite(min) || !isFinite(max) || max < min) {
    _stationLoadedWindow = null;
    return;
  }

  _stationLoadedWindow = { min: min, max: max };
}

function getCurrentLoadedWindow() {
  if (_stationLoadedWindow && isFinite(_stationLoadedWindow.min) && isFinite(_stationLoadedWindow.max)) {
    return _stationLoadedWindow;
  }
  return getEntriesBounds(state.allEntries);
}

function currentDataCanServeRange(requestedWindow, requestedRange) {
  var loadedWindow = getCurrentLoadedWindow();
  if (!loadedWindow || !requestedWindow) return false;
  if (requestedRange === 'all') return loadedWindow.min <= new Date('2024-01-01T00:00:00Z').getTime();

  var reqFrom = requestedWindow.from instanceof Date
    ? requestedWindow.from.getTime()
    : new Date(requestedWindow.from).getTime();
  var reqTo = requestedWindow.to instanceof Date
    ? requestedWindow.to.getTime()
    : new Date(requestedWindow.to).getTime();
  if (!isFinite(reqFrom) || !isFinite(reqTo)) return false;

  var spanMs = Math.max(0, reqTo - reqFrom);
  var toleranceMs = Math.min(6 * 3600000, Math.round(spanMs * 0.1));
  return loadedWindow.min <= (reqFrom + toleranceMs) && loadedWindow.max >= (reqTo - toleranceMs);
}

function stationDiagTone(source, error) {
  if (error) return 'error';
  if (source === 'edge' || source === 'edge-local-range') return 'good';
  if (source === 'edge-cache' || source === 'cache-preseed' || source === 'shared-cache' || source === 'loading') return 'warn';
  return 'muted';
}

function updateStationDiagnostics(patch) {
  _stationDiagMeta = Object.assign({}, _stationDiagMeta, patch || {});
  var downsample = '--';
  if (_stationDiagMeta.returnedRows != null || _stationDiagMeta.totalRows != null || _stationDiagMeta.step != null) {
    downsample = (_stationDiagMeta.returnedRows != null ? _stationDiagMeta.returnedRows : '--') +
      ' / ' + (_stationDiagMeta.totalRows != null ? _stationDiagMeta.totalRows : '--') +
      ' (step ' + (_stationDiagMeta.step != null ? _stationDiagMeta.step : '--') + ')';
  }
  renderDashboardDiagnostics('stationDiagnosticsPanel', {
    summary: 'Station Diagnostics',
    pill: _stationDiagMeta.error ? 'Error' : ((_stationDiagMeta.source === 'edge' || _stationDiagMeta.source === 'edge-local-range') ? 'Live' : (_stationDiagMeta.source === 'loading' ? 'Loading' : 'Cache')),
    pillTone: stationDiagTone(_stationDiagMeta.source, _stationDiagMeta.error),
    rows: [
      { label: 'Source', value: _stationDiagMeta.source || '--', tone: _stationDiagMeta.error ? 'error' : ((_stationDiagMeta.source === 'edge' || _stationDiagMeta.source === 'edge-local-range') ? 'good' : '') },
      { label: 'Generated', value: dashboardDiagFormatUtc(_stationDiagMeta.generatedAt) },
      { label: 'Data as of', value: dashboardDiagFormatUtc(_stationDiagMeta.dataAsOf) },
      { label: 'Schema', value: _stationDiagMeta.schemaVersion != null ? String(_stationDiagMeta.schemaVersion) : '--' },
      { label: 'Range', value: _stationDiagMeta.rangeLabel || '--' },
      { label: 'Entries', value: _stationDiagMeta.entryCount != null ? String(_stationDiagMeta.entryCount) : '--' },
      { label: 'Downsample', value: downsample },
      { label: 'Sync sessions', value: _stationDiagMeta.syncCount != null ? String(_stationDiagMeta.syncCount) : '--' },
      { label: 'Fetch', value: dashboardDiagFormatDuration(_stationDiagMeta.fetchDurationMs) },
      { label: 'Cache age', value: _stationDiagMeta.cacheAgeS != null ? (_stationDiagMeta.cacheAgeS + ' s') : '--' },
      { label: 'Last refresh', value: dashboardDiagFormatUtc(_stationDiagMeta.lastRefreshAt) }
    ],
    error: _stationDiagMeta.error || '',
    note: _stationDiagMeta.note || ''
  });
}

/**
 * Compute the from/to range for the current time range setting.
 * Returns { from: Date, to: Date }.
 */
function getEdgeTimeWindow() {
  var now = new Date();
  var from;
  if (state.timeRange === 'custom' && state.dateStart) {
    from = state.dateStart;
  } else {
    switch (state.timeRange) {
      case 'day':   from = new Date(now.getTime() - 1  * 86400000); break;
      case 'month': from = new Date(now.getTime() - 30 * 86400000); break;
      case 'all':   from = new Date('2024-01-01T00:00:00Z');        break;
      case 'week':
      default:      from = new Date(now.getTime() - 7  * 86400000); break;
    }
  }
  var to = (state.timeRange === 'custom' && state.dateEnd) ? state.dateEnd : now;
  return { from: from, to: to };
}

/**
 * Map downsample target to time range.
 * Wider ranges get more points for decent chart fidelity.
 */
function getEdgePointsTarget() {
  switch (state.timeRange) {
    case 'day':   return 200;
    case 'week':  return 500;
    case 'month': return 800;
    case 'all':   return 1500;
    default:      return 500;
  }
}

/**
 * Fetch the station-detail Edge Function.
 * Returns the parsed JSON payload, or throws on failure.
 */
async function fetchEdgeStationDetail() {
  var startedAt = Date.now();
  var supaCfg = getSupabaseConfig();
  var win = getEdgeTimeWindow();
  var pts = getEdgePointsTarget();
  var url = supaCfg.url + '/functions/v1/station-detail' +
    '?station_id=' + encodeURIComponent(TABLE_ID) +
    '&from=' + encodeURIComponent(win.from.toISOString()) +
    '&to=' + encodeURIComponent(win.to.toISOString()) +
    '&points=' + pts;

  var hdrs = {
      'Authorization': 'Bearer ' + supaCfg.key,
      'apikey': supaCfg.key
    };
  var res = await fetchWithTimeout(url, 20000, {
    headers: hdrs
  });

  if (!res.ok) {
    var body = null;
    try { body = await res.json(); } catch (_) {}
    var errMsg = body && body.error ? body.error : ('HTTP ' + res.status);
    throw new Error('Edge Function (station-detail): ' + errMsg);
  }

  var payload = await res.json();
  if (payload.source === 'error') {
    throw new Error('Edge Function RPC: ' + (payload.error || 'unknown error'));
  }
  payload._response_duration_ms = Date.now() - startedAt;
  return payload;
}

/**
 * Convert feeds from the Edge payload into chart-ready entries.
 * The RPC returns flat rows with the same shape as buildSlotAlignedFeeds.
 */
function edgePayloadToEntries(payload) {
  if (!payload || !Array.isArray(payload.feeds)) return [];
  var discoveredSlots = [];
  if (payload.slot_map) {
    var keys = Object.keys(payload.slot_map);
    for (var i = 0; i < keys.length; i++) {
      var sn = Number(payload.slot_map[keys[i]]);
      if (sn && discoveredSlots.indexOf(sn) < 0) discoveredSlots.push(sn);
    }
  }
  if (!discoveredSlots.length) discoveredSlots = [1, 2];

  return payload.feeds.map(function(f) {
    return feedToEntry(f, discoveredSlots);
  }).filter(function(e) {
    return e && e.timestamp instanceof Date && !isNaN(e.timestamp.getTime());
  }).sort(function(a, b) {
    return a.timestamp - b.timestamp;
  });
}

/**
 * Apply Edge payload side-channel data: device_status, slot_map, sync_sessions.
 */
function applyEdgeSideData(payload) {
  // Device status
  if (payload.device_status) {
    var ds = payload.device_status;
    state.deviceStatus = {
      batteryPct:    ds.battery_pct != null ? Number(ds.battery_pct) : null,
      nextCheckInAt: ds.next_check_in ? new Date(ds.next_check_in) : null,
      lastSeenAt:    ds.last_seen ? new Date(ds.last_seen) : null,
      lastUploadAt:  ds.last_upload_at ? new Date(ds.last_upload_at) : null,
      raw:           ds
    };
  }

  // Slot map
  if (payload.slot_map && typeof payload.slot_map === 'object') {
    _stationSlotMap = {};
    var smKeys = Object.keys(payload.slot_map);
    for (var i = 0; i < smKeys.length; i++) {
      _stationSlotMap[smKeys[i]] = Number(payload.slot_map[smKeys[i]]);
    }
  }

  // Sync sessions (apply reset-window filter)
  if (Array.isArray(payload.sync_sessions)) {
    state.syncSessions = payload.sync_sessions.filter(function(r) {
      return typeof isAfterResetWindow !== 'function' || isAfterResetWindow(TABLE_ID, r && r.sync_started_at);
    });
  }
}

/**
 * Edge-path fetch (sole data path for station detail).
 */
async function fetchLiveDataEdge(silent) {
  var btn = document.getElementById('btnFetch');
  btn.innerHTML = '<span class="spinner"></span> Fetching...';
  btn.disabled  = true;
  updateStationDiagnostics({ source: 'loading', lastRefreshAt: Date.now(), error: '', note: 'Waiting for station-detail payload…' });

  try {
    var payload = await fetchEdgeStationDetail();
    _edgeDetailPayload = payload;
    _edgeDetailPayloadAt = Date.now();

    // Convert feeds to entries
    var entries = edgePayloadToEntries(payload);

    // Replace allEntries with edge data (edge returns the exact window requested)
    state.allEntries = entries;
    setStationLoadedWindow(payload.time_range || getEntriesBounds(entries));
    state.dataSource = 'Edge Function (' + new Date().toLocaleTimeString('en-GB') + ')';

    // Apply side data (status, slots, sync)
    applyEdgeSideData(payload);

    // Apply time range filter + render
    applyTimeRange();
    renderDashboard();

    // Cache for cross-tab sharing
    saveStationCache(TABLE_ID, state.allEntries, {
      channelInfo: state.channelInfo,
      source: 'edge',
      timeRange: state.timeRange,
      windowStart: payload.time_range ? payload.time_range.from : null,
      windowEnd: payload.time_range ? payload.time_range.to : null
    });
    notifyDashboardDataRefresh([TABLE_ID], 'station.fetchLiveDataEdge');

    var ds = payload.downsampling || {};
    console.log('[Dashboard] Edge Function loaded: ' + entries.length + ' entries' +
      ' (total ' + (ds.total_rows || '?') + ', step ' + (ds.step || 1) + ')' +
      ', sync sessions: ' + (payload.sync_sessions ? payload.sync_sessions.length : 0));
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
      note: 'Single station-detail Edge payload for the visible time range.'
    });

  } catch (err) {
    console.error('[Dashboard] Edge Function fetch failed:', err);

    // Stale-while-revalidate: re-use cached payload if available
    if (_edgeDetailPayload) {
      var staleAge = Math.round((Date.now() - _edgeDetailPayloadAt) / 1000);
      console.warn('[Dashboard] Using cached edge payload (' + staleAge + 's old)');
      var entries = edgePayloadToEntries(_edgeDetailPayload);
      state.allEntries = entries;
      setStationLoadedWindow(_edgeDetailPayload.time_range || getEntriesBounds(entries));
      state.dataSource = 'Edge cached (' + staleAge + 's ago)';
      applyEdgeSideData(_edgeDetailPayload);
      applyTimeRange();
      renderDashboard();
      var cachedDs = _edgeDetailPayload.downsampling || {};
      updateStationDiagnostics({
        source: 'edge-cache',
        generatedAt: _edgeDetailPayload.generated_at,
        dataAsOf: _edgeDetailPayload.data_as_of,
        schemaVersion: _edgeDetailPayload.schema_version,
        rangeLabel: _edgeDetailPayload.time_range ? (dashboardDiagFormatUtc(_edgeDetailPayload.time_range.from) + ' → ' + dashboardDiagFormatUtc(_edgeDetailPayload.time_range.to)) : '--',
        entryCount: entries.length,
        returnedRows: cachedDs.returned,
        totalRows: cachedDs.total_rows,
        step: cachedDs.step,
        syncCount: _edgeDetailPayload.sync_sessions ? _edgeDetailPayload.sync_sessions.length : 0,
        fetchDurationMs: _edgeDetailPayload._response_duration_ms,
        cacheAgeS: staleAge,
        lastRefreshAt: Date.now(),
        error: err.message || 'Edge fetch failed',
        note: 'Cached station-detail payload reused after live fetch failure.'
      });
    } else {
      if (!silent) {
        console.warn('[Dashboard] Edge Function unavailable, no cached data');
      }
      updateStationDiagnostics({
        source: 'error',
        lastRefreshAt: Date.now(),
        error: err.message || 'Edge fetch failed',
        note: 'No cached station-detail payload available.'
      });
    }
  } finally {
    btn.innerHTML = 'Fetch Live';
    btn.disabled  = false;
  }
}

/** Fetch station data via Edge Function. */
function fetchLiveData(silent) {
  return fetchLiveDataEdge(silent);
}

function shouldAutoFetchLiveOnLoad() {
  if (!state.allEntries || !state.allEntries.length) return true;
  var latest = state.allEntries[state.allEntries.length - 1].timestamp;
  if (!(latest instanceof Date) || isNaN(latest.getTime())) return true;
  var ageHrs = (Date.now() - latest.getTime()) / 3600000;
  return ageHrs > 6;
}

function refreshFromSharedCache(reason) {
  try {
    var raw = localStorage.getItem('seaweed_cache_' + TABLE_ID);
    if (!raw) return;
    var cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.allEntries) || !cached.allEntries.length) return;

    if (!stationCacheCanPrimeRange(cached, getEdgeTimeWindow(), state.timeRange)) {
      console.log('[Dashboard] Ignoring shared cache (' + TABLE_ID + '): cached window does not cover current ' + state.timeRange + ' view');
      return;
    }

    var parsed = normalizeCachedEntries(cached.allEntries);
    if (!parsed.length) return;

    var cachedLatest = parsed[parsed.length - 1] && parsed[parsed.length - 1].timestamp
      ? parsed[parsed.length - 1].timestamp.getTime()
      : NaN;
    var currentLatest = state.allEntries && state.allEntries.length && state.allEntries[state.allEntries.length - 1].timestamp
      ? state.allEntries[state.allEntries.length - 1].timestamp.getTime()
      : NaN;

    // Ignore cache updates that would roll the page back behind already-loaded live data.
    if (isFinite(currentLatest) && isFinite(cachedLatest)) {
      if (cachedLatest < currentLatest) {
        console.log('[Dashboard] Ignoring stale shared cache (' + TABLE_ID + '): cached latest is older than current state');
        return;
      }
      if (cachedLatest === currentLatest && state.allEntries && parsed.length < state.allEntries.length) {
        console.log('[Dashboard] Ignoring partial shared cache (' + TABLE_ID + '): cached snapshot is not richer than current state');
        return;
      }
    }

    state.allEntries = parsed.sort(function(a, b) { return a.timestamp - b.timestamp; });
    setStationLoadedWindow(getStationCacheWindow(cached) || getEntriesBounds(state.allEntries));
    state.channelInfo = cached.channelInfo || state.channelInfo || null;
    state.dataSource = 'Shared cache sync (' + (reason || 'external refresh') + ')';
    applyTimeRange();
    renderDashboard();
    console.log('[Dashboard] Synced from shared cache (' + TABLE_ID + '): ' + state.allEntries.length + ' entries');
    updateStationDiagnostics({
      source: 'shared-cache',
      dataAsOf: state.allEntries[state.allEntries.length - 1].timestamp,
      entryCount: state.allEntries.length,
      cacheAgeS: cached.savedAt ? Math.round((Date.now() - cached.savedAt) / 1000) : null,
      lastRefreshAt: Date.now(),
      error: '',
      note: 'Shared cache update applied (' + (reason || 'external refresh') + ').'
    });
  } catch (e) {
    console.warn('[Dashboard] Shared cache sync failed:', e);
  }
}

window.addEventListener('storage', function(evt) {
  if (!evt) return;
  if (evt.key === 'seaweed_cache_' + TABLE_ID) {
    refreshFromSharedCache('cache key updated');
  }
});

onDashboardDataRefresh(function(msg) {
  try {
    // Ignore our own broadcasts to avoid overwriting freshly fetched data
    if (msg && typeof msg.source === 'string' && msg.source.indexOf('station.') === 0) return;
    var ids = Array.isArray(msg && msg.stationIds) ? msg.stationIds : [];
    if (!ids.length || ids.indexOf(TABLE_ID) >= 0) {
      refreshFromSharedCache('refresh event');
      refreshDeviceStatus(true);
    }
  } catch (e) {}
});



// =====================================================================
// CSV EXPORT
// =====================================================================
function exportCSV() {
  var entries = state.allEntries;
  if (!entries.length) return;

  // Discover satellite slots dynamically from the slot map
  var slots = getStationSlotAssignments(TABLE_ID, entries, _stationSlotMap);

  var headers = [
    'Timestamp_UTC', 'Timestamp_Local', 'Entry_ID',
    'T0_Bat%', 'T0_BatV', 'T0_RSSI', 'T0_BootCnt', 'T0_Heap',
    'T0_Temp1', 'T0_Hum1', 'T0_Temp2', 'T0_Hum2', 'T0_Temp3', 'T0_Hum3',
  ];
  slots.forEach(function(slot) {
    var p = 'Sat' + slot.slotNumber;
    headers.push(p + '_BatV', p + '_Bat%', p + '_RSSI', p + '_SampleID',
                 p + '_Temp1', p + '_Hum1', p + '_Temp2', p + '_Hum2');
  });
  headers.push('SD_FreeKB', 'CSQ', 'UploadOK');

  var rows = entries.map(function (e) {
    function v(x) { return (x === null || x === undefined) ? '' : x; }
    var row = [
      e.timestamp.toISOString(),
      e.timestamp.toLocaleString('en-GB'),
      e.entryId,
      v(e.t0BatPct), v(e.t0BatV), v(e.t0Rssi), v(e.t0Boot), v(e.t0Heap),
      v(e.t0Temp1), v(e.t0Hum1), v(e.t0Temp2), v(e.t0Hum2), v(e.t0Temp3), v(e.t0Hum3),
    ];
    slots.forEach(function(slot) {
      var sp = 'sat' + slot.slotNumber;
      row.push(v(e[sp + 'BatV']), v(e[sp + 'BatPct']), v(e[sp + 'Rssi']), v(e[sp + 'SampleId']),
               v(e[sp + 'Temp1']), v(e[sp + 'Hum1']), v(e[sp + 'Temp2']), v(e[sp + 'Hum2']));
    });
    row.push(v(e.sdFreeKB), v(e.csq), v(e.uploadOk));
    return row.join(',');
  });

  var csv  = headers.join(',') + '\n' + rows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'seaweed_' + TABLE_ID + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// =====================================================================
// TIME RANGE
// =====================================================================
function setTimeRange(range) {
  if (state.timeRange === range) {
    updateTimeButtons();
    updateChartSubheads();
    return;
  }

  state.timeRange = range;

  var requestedWindow = getEdgeTimeWindow();
  if (currentDataCanServeRange(requestedWindow, range)) {
    applyTimeRange();
    renderDashboard();
    updateStationDiagnostics({
      source: 'edge-local-range',
      rangeLabel: dashboardDiagFormatUtc(requestedWindow.from) + ' → ' + dashboardDiagFormatUtc(requestedWindow.to),
      entryCount: state.allEntries.length,
      lastRefreshAt: Date.now(),
      error: '',
      note: 'Range changed locally using the currently loaded station-detail window.'
    });
  } else {
    // Re-fetch from server for the new window (different downsample target)
    fetchLiveDataEdge(true);
  }

  updateTimeButtons();
  updateChartSubheads();
  saveViewPrefs();
}

function setWeatherTimeRange(r) {
  state.weatherTimeRange = r;
  document.querySelectorAll('[data-wxrange]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.wxrange === r);
  });
  if (r === 'forecast') { fetchForecastData(); } else { fetchWeatherData(); }
}

function applyDateRange() {
  var startVal = document.getElementById('dateStart').value;
  var endVal   = document.getElementById('dateEnd').value;
  state.dateStart = startVal ? new Date(startVal + 'T00:00:00') : null;
  state.dateEnd   = endVal   ? new Date(endVal   + 'T23:59:59') : null;
  state.timeRange = 'custom';

  var requestedWindow = getEdgeTimeWindow();
  if (state.dateStart && state.dateEnd && currentDataCanServeRange(requestedWindow, 'custom')) {
    applyTimeRange();
    renderDashboard();
    updateStationDiagnostics({
      source: 'edge-local-range',
      rangeLabel: dashboardDiagFormatUtc(requestedWindow.from) + ' → ' + dashboardDiagFormatUtc(requestedWindow.to),
      entryCount: state.allEntries.length,
      lastRefreshAt: Date.now(),
      error: '',
      note: 'Custom range applied locally using the currently loaded station-detail window.'
    });
  } else {
    // Re-fetch from server for the custom window
    fetchLiveDataEdge(true);
  }

  updateTimeButtons();
  updateChartSubheads();
  saveViewPrefs();
}

function clearDateRange() {
  document.getElementById('dateStart').value = '';
  document.getElementById('dateEnd').value = '';
  state.dateStart = null;
  state.dateEnd = null;
  setTimeRange('week');
  saveViewPrefs();
}

var VIEW_PREFS_KEY = 'seaweed_view_' + TABLE_ID;
function saveViewPrefs() {
  try {
    var prefs = {
      timeRange: state.timeRange,
      dateStart: document.getElementById('dateStart').value || '',
      dateEnd:   document.getElementById('dateEnd').value   || ''
    };
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch (e) { /* ignore */ }
}
function restoreViewPrefs() {
  try {
    var raw = localStorage.getItem(VIEW_PREFS_KEY);
    if (!raw) return;
    var p = JSON.parse(raw);
    if (p.dateStart) {
      document.getElementById('dateStart').value = p.dateStart;
      state.dateStart = new Date(p.dateStart + 'T00:00:00');
    }
    if (p.dateEnd) {
      document.getElementById('dateEnd').value = p.dateEnd;
      state.dateEnd = new Date(p.dateEnd + 'T23:59:59');
    }
    if (p.timeRange && p.timeRange !== 'custom') {
      state.timeRange = p.timeRange;
    }
  } catch (e) { /* ignore */ }
}

function applyTimeRange() {
  if (!state.allEntries.length) { state.filteredEntries = []; return; }
  var latest = state.allEntries[state.allEntries.length - 1].timestamp;
  var start, end;

  if (state.timeRange === 'custom') {
    start = state.dateStart || new Date(0);
    end   = state.dateEnd   || latest;
  } else {
    switch (state.timeRange) {
      case 'day':   start = new Date(latest.getTime() - 24 * 3600000); break;
      case 'week':  start = new Date(latest.getTime() - 7 * 24 * 3600000); break;
      case 'month': start = new Date(latest.getTime() - 30 * 24 * 3600000); break;
      default:      start = new Date(0);
    }
    end = latest;
  }
  state.filteredEntries = state.allEntries.filter(function (e) {
    return e.timestamp >= start && e.timestamp <= end;
  });
}

function getTimeAxisConfig() {
  var range = state.timeRange;
  if (range === 'custom' && state.filteredEntries.length >= 2) {
    var spanMs = state.filteredEntries[state.filteredEntries.length-1].timestamp - state.filteredEntries[0].timestamp;
    var spanDays = spanMs / 86400000;
    if (spanDays <= 1.5)       range = 'day';
    else if (spanDays <= 10)   range = 'week';
    else if (spanDays <= 45)   range = 'month';
    else                       range = 'all';
  }
  switch (range) {
    case 'day':
      return { unit: 'hour', displayFormats: { hour: 'HH:mm' }, tooltipFormat: 'd LLL HH:mm' };
    case 'week':
      return { unit: 'day', displayFormats: { day: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
    case 'month':
      return { unit: 'day', displayFormats: { day: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
    default:
      return { unit: 'week', displayFormats: { week: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
  }
}

function getEntriesBounds(entries) {
  if (!entries || !entries.length) return null;
  var min = entries[0].timestamp instanceof Date ? entries[0].timestamp.getTime() : new Date(entries[0].timestamp).getTime();
  var max = entries[entries.length - 1].timestamp instanceof Date ? entries[entries.length - 1].timestamp.getTime() : new Date(entries[entries.length - 1].timestamp).getTime();
  if (!isFinite(min) || !isFinite(max) || max < min) return null;
  return { min: min, max: max };
}

function getWindowForRange(bounds, range) {
  if (!bounds || !isFinite(bounds.min) || !isFinite(bounds.max)) {
    return { min: undefined, max: undefined };
  }
  if (range === 'all' || range === 'custom') {
    return { min: bounds.min, max: bounds.max };
  }
  var days = range === 'day' ? 1 : (range === 'week' ? 7 : 30);
  var spanMs = days * 86400000;
  var max = bounds.max;
  var min = Math.max(bounds.min, max - spanMs);
  return { min: min, max: max };
}

function updateTimeButtons() {
  document.querySelectorAll('.time-btns .btn-sm').forEach(function (btn) {
    var isActive = btn.dataset.range === state.timeRange;
    if (state.timeRange === 'custom') isActive = false;
    btn.classList.toggle('active', isActive);
  });
}

function updateChartSubheads() {
  var label = timeRangeLabel();
  var el = document.getElementById('tempSubhead');
  if (el) el.textContent = label;
  var humSub = document.getElementById('humSubhead');
  if (humSub) humSub.textContent = label;
  var batSub = document.getElementById('batSubhead');
  if (batSub) batSub.textContent = label;
}
