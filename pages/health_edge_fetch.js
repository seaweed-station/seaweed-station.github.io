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

var _healthRangeFetchPromise = null;
var _healthRangeFetchKey = '';
var _healthStationRawWindowById = {};
var _healthStationRawFetchPromiseById = {};
var HEALTH_RAW_HYDRATION_ENABLED = false;
var HEALTH_RAW_RECENT_WINDOW_DAYS = 45;
var HEALTH_RAW_ALL_WINDOW_DAYS = 370;
var HEALTH_RAW_FETCH_PAGE_SIZE = 1000;
var HEALTH_RAW_FETCH_MAX_ROWS = 20000;

function healthEntryKey(entry) {
  if (!entry) return '';
  if (entry.entryId !== null && entry.entryId !== undefined && entry.entryId !== '') return 'id:' + entry.entryId;
  return 'ts:' + (entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp || ''));
}

function mergeHealthEntries(existingEntries, incomingEntries) {
  var merged = new Map();
  var lists = [existingEntries || [], incomingEntries || []];
  for (var i = 0; i < lists.length; i++) {
    var rows = lists[i];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      if (!row || !(row.timestamp instanceof Date) || isNaN(row.timestamp.getTime())) continue;
      merged.set(healthEntryKey(row), row);
    }
  }
  return Array.from(merged.values()).sort(function(a, b) { return a.timestamp - b.timestamp; });
}

function parseHealthWindowBounds(windowLike) {
  if (!windowLike) return null;
  var min = windowLike.min;
  var max = windowLike.max;
  if (windowLike.from != null) min = windowLike.from;
  if (windowLike.to != null) max = windowLike.to;
  min = min instanceof Date ? min.getTime() : new Date(min).getTime();
  max = max instanceof Date ? max.getTime() : new Date(max).getTime();
  if (!isFinite(min) || !isFinite(max) || max < min) return null;
  return { min: min, max: max };
}

function mergeHealthStationRawWindow(stationId, windowLike) {
  if (!stationId) return;
  var parsed = parseHealthWindowBounds(windowLike);
  if (!parsed) return;
  var current = _healthStationRawWindowById[stationId];
  if (!current) {
    _healthStationRawWindowById[stationId] = parsed;
    return;
  }
  _healthStationRawWindowById[stationId] = {
    min: Math.min(current.min, parsed.min),
    max: Math.max(current.max, parsed.max)
  };
}

function getHealthStationRawWindow(stationId) {
  return stationId ? (_healthStationRawWindowById[stationId] || null) : null;
}

function healthStationRawCanServeWindow(stationId, windowLike) {
  var current = getHealthStationRawWindow(stationId);
  var needed = parseHealthWindowBounds(windowLike);
  if (!current || !needed) return false;
  return current.min <= needed.min && current.max >= needed.max;
}

function getHealthStationNeededRawWindow(stationId, range) {
  var visibleDays = Math.max(STATION_LOG_ROWS_STEP, Number(_stationLogsVisibleDays[stationId]) || STATION_LOG_ROWS_STEP);
  var rangeDays = 30;
  if (range === 'day') rangeDays = 1;
  else if (range === 'week') rangeDays = 7;
  else if (range === 'month') rangeDays = 30;
  else if (range === 'all') rangeDays = HEALTH_RAW_ALL_WINDOW_DAYS;

  var lookbackDays = range === 'all'
    ? HEALTH_RAW_ALL_WINDOW_DAYS
    : Math.max(HEALTH_RAW_RECENT_WINDOW_DAYS, rangeDays, visibleDays + 7);

  var to = new Date();
  var from = new Date(to.getTime() - (lookbackDays * 86400000));
  return { from: from, to: to };
}

async function fetchHealthStationRawEntries(stationId, windowLike) {
  if (!HEALTH_RAW_HYDRATION_ENABLED) return [];
  if (!stationId) return [];
  var bounds = parseHealthWindowBounds(windowLike);
  if (!bounds) return [];
  var fromIso = new Date(bounds.min).toISOString();
  var toIso = new Date(bounds.max).toISOString();
  var supaCfg = getSupabaseConfig();
  var hdrs = supabaseHeaders(supaCfg.key);
  var select = [
    'id', 'recorded_at',
    'battery_pct', 'temp_1', 'humidity_1', 'temp_2', 'humidity_2', 'temp_3', 'humidity_3',
    'battery_v', 'solar_v', 'boot_count', 'fw_version', 'fw_date',
    'sat_1_installed', 'sat_2_installed',
    'sat_1_battery_v', 'sat_1_battery_pct', 'sat_1_flash_pct', 'sat_1_fw_ver', 'sat_1_temp_1', 'sat_1_humidity_1', 'sat_1_temp_2', 'sat_1_humidity_2',
    'sat_2_battery_v', 'sat_2_battery_pct', 'sat_2_flash_pct', 'sat_2_fw_ver', 'sat_2_temp_1', 'sat_2_humidity_1', 'sat_2_temp_2', 'sat_2_humidity_2'
  ].join(',');

  var rows = [];
  for (var offset = 0; offset < HEALTH_RAW_FETCH_MAX_ROWS; offset += HEALTH_RAW_FETCH_PAGE_SIZE) {
    var url = supaCfg.url + '/rest/v1/sensor_readings' +
      '?select=' + encodeURIComponent(select) +
      '&device_id=eq.' + encodeURIComponent(stationId) +
      '&recorded_at=gte.' + encodeURIComponent(fromIso) +
      '&recorded_at=lte.' + encodeURIComponent(toIso) +
      '&order=recorded_at.asc' +
      '&limit=' + HEALTH_RAW_FETCH_PAGE_SIZE +
      '&offset=' + offset;
    var res = await fetchWithTimeout(url, 30000, { headers: hdrs });
    if (!res.ok) throw new Error('sensor_readings HTTP ' + res.status);
    var batch = await res.json();
    if (Array.isArray(batch) && batch.length) {
      rows = rows.concat(batch);
    }
    if (!Array.isArray(batch) || batch.length < HEALTH_RAW_FETCH_PAGE_SIZE) break;
    await yieldToBrowser();
  }

  var parsed = parseSupabaseData(rows, { id: stationId, name: stationId });
  return parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
}

async function ensureHealthStationRawData(stationId, range, opts) {
  opts = opts || {};
  if (!HEALTH_RAW_HYDRATION_ENABLED) return false;
  if (!stationId) return false;
  var neededWindow = getHealthStationNeededRawWindow(stationId, range);
  if (healthStationRawCanServeWindow(stationId, neededWindow)) return false;
  if (_healthStationRawFetchPromiseById[stationId]) return _healthStationRawFetchPromiseById[stationId];

  _healthStationRawFetchPromiseById[stationId] = (async function() {
    var rawEntries = await fetchHealthStationRawEntries(stationId, neededWindow);
    if (!rawEntries.length) return false;

    var mergedEntries = mergeHealthEntries(stationData[stationId] && stationData[stationId].entries, rawEntries);
    stationData[stationId] = {
      entries: mergedEntries,
      raw: stationData[stationId] ? stationData[stationId].raw : null
    };
    _stationDataSource[stationId] = { source: 'live', savedAt: Date.now(), rawLoaded: true };
    mergeHealthStationRawWindow(stationId, neededWindow);
    saveCacheData(stationId, buildHealthCacheEntries(mergedEntries), {
      source: 'live',
      timeRange: range === 'all' ? 'all' : 'recent',
      windowStart: new Date(neededWindow.from).toISOString(),
      windowEnd: new Date(neededWindow.to).toISOString()
    });

    if (opts.rerender !== false && typeof _renderStationRange === 'function') {
      _renderStationRange(stationId, stationRanges[stationId] || range || 'week', { skipRawEnsure: true });
    }
    return true;
  })().catch(function(err) {
    console.warn('[Health] Raw station fetch failed for ' + stationId + ':', err && err.message ? err.message : err);
    return false;
  }).finally(function() {
    delete _healthStationRawFetchPromiseById[stationId];
  });

  return _healthStationRawFetchPromiseById[stationId];
}

function healthSyncRowKey(row) {
  if (!row) return '';
  return [row.sync_id || '', row.node_id || '', row.sync_started_at || ''].join('|');
}

function healthUploadRowKey(row) {
  if (!row) return '';
  return [row.upload_id || '', row.upload_started_at || ''].join('|');
}

function mergeTimelineRows(existingRows, incomingRows, keyFn, timeField) {
  var merged = new Map();
  var lists = [existingRows || [], incomingRows || []];
  for (var i = 0; i < lists.length; i++) {
    var rows = lists[i];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      if (!row) continue;
      var key = keyFn(row);
      if (!key) continue;
      merged.set(key, row);
    }
  }
  return Array.from(merged.values()).sort(function(a, b) {
    return new Date(a[timeField]).getTime() - new Date(b[timeField]).getTime();
  });
}

function buildHealthCacheEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  var latest = entries[entries.length - 1].timestamp;
  if (!(latest instanceof Date) || isNaN(latest.getTime())) return [];
  var cutoffMs = latest.getTime() - (HEALTH_CACHE_DAYS * 86400000);
  var recent = entries.filter(function(entry) {
    return entry && entry.timestamp instanceof Date && !isNaN(entry.timestamp.getTime()) && entry.timestamp.getTime() >= cutoffMs;
  });
  if (recent.length <= HEALTH_CACHE_MAX_ENTRIES) return recent;
  return recent.slice(recent.length - HEALTH_CACHE_MAX_ENTRIES);
}

function getPreferredHealthFetchRange() {
  if (typeof _modalSource !== 'undefined' && _modalSource && _modalSource.modalRange === 'all') return 'all';
  var ids = Object.keys(stationRanges || {});
  for (var i = 0; i < ids.length; i++) {
    if (stationRanges[ids[i]] === 'all') return 'all';
  }
  return healthDataCanServeRange('all') ? 'all' : 'recent';
}


async function fetchEdgeHealthSummary(opts) {
  opts = opts || {};
  var startedAt = Date.now();
  var supaCfg = getSupabaseConfig();
  var requestedRange = opts.range || 'recent';
  var requestWindow = getHealthRequestedWindow(requestedRange);
  var from = opts.from || requestWindow.from.toISOString();
  var to = opts.to || requestWindow.to.toISOString();
  var pts = opts.points || getHealthPointsTarget(requestedRange);
  var url = supaCfg.url + '/functions/v1/health-summary' +
    '?from=' + encodeURIComponent(from) +
    '&to=' + encodeURIComponent(to) +
    '&points=' + pts;

  var timeoutMs = opts.timeoutMs || (requestedRange === 'all' ? 60000 : 30000);
  var res = await fetchWithTimeout(url, timeoutMs, {
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

function isHealthSummaryRetryableError(err) {
  var msg = err && err.message ? String(err.message) : String(err || '');
  var lower = msg.toLowerCase();
  return lower.indexOf('statement timeout') >= 0 ||
    lower.indexOf('http 503') >= 0 ||
    lower.indexOf('http 504') >= 0 ||
    lower.indexOf('failed to fetch') >= 0 ||
    lower.indexOf('networkerror') >= 0 ||
    lower.indexOf('timeout') >= 0;
}

function buildHealthFallbackRequest(opts, days, points, timeoutMs) {
  var to = opts && opts.to ? new Date(opts.to) : new Date();
  if (!(to instanceof Date) || isNaN(to.getTime())) to = new Date();
  return Object.assign({}, opts || {}, {
    range: 'recent',
    from: new Date(to.getTime() - days * 86400000).toISOString(),
    to: to.toISOString(),
    points: points,
    timeoutMs: timeoutMs
  });
}

async function fetchEdgeHealthSummaryResilient(opts) {
  opts = opts || {};
  try {
    return await fetchEdgeHealthSummary(opts);
  } catch (firstErr) {
    var requestedRange = opts.range || 'recent';
    if (requestedRange === 'all' || !isHealthSummaryRetryableError(firstErr)) throw firstErr;

    var basePoints = Number(opts.points) || getHealthPointsTarget('recent');
    var fallbackAttempts = [
      { days: 14, points: Math.min(basePoints, 350), timeoutMs: 20000 },
      { days: 7, points: Math.min(basePoints, 250), timeoutMs: 15000 }
    ];
    var firstMsg = firstErr && firstErr.message ? firstErr.message : String(firstErr);
    var lastErr = firstErr;

    for (var i = 0; i < fallbackAttempts.length; i++) {
      var attempt = fallbackAttempts[i];
      try {
        console.warn('[Health] health-summary primary fetch failed, retrying with reduced window:', firstMsg, '| fallback=' + attempt.days + 'd');
        var payload = await fetchEdgeHealthSummary(buildHealthFallbackRequest(opts, attempt.days, attempt.points, attempt.timeoutMs));
        payload._healthFallback = {
          days: attempt.days,
          points: attempt.points,
          reason: firstMsg
        };
        return payload;
      } catch (fallbackErr) {
        lastErr = fallbackErr;
      }
    }

    var lastMsg = lastErr && lastErr.message ? lastErr.message : String(lastErr);
    throw new Error('Edge Function (health-summary): primary recent fetch failed (' + firstMsg + ') and reduced-window retries failed (' + lastMsg + ')');
  }
}

function healthPayloadNote(payload, defaultNote, fallbackNote) {
  if (payload && payload._healthFallback) {
    return fallbackNote || ('Loaded a reduced ' + payload._healthFallback.days + '-day health window after the default recent query timed out.');
  }
  return defaultNote;
}

/**
 * Convert a health-summary Edge payload into the global state variables
 * consumed by the health page charts and tables.
 */
function applyEdgeHealthPayload(payload) {
  if (!payload || !Array.isArray(payload.stations)) return;

  mergeHealthLoadedWindow(payload.time_range);
  var payloadStationIds = {};

  var newDeviceStatus = {};
  var newDeviceConfig = {};
  var newDeviceSlots = {};
  var newDeviceSlotHistory = {};

  for (var i = 0; i < payload.stations.length; i++) {
    var st = payload.stations[i];
    var sid = st.station_id;
    if (!sid) continue;
    payloadStationIds[sid] = true;

    // ── Slot map ──────────────────────────────────────────
    if (st.slot_map && typeof st.slot_map === 'object') {
      newDeviceSlots[sid] = {};
      var smKeys = Object.keys(st.slot_map);
      for (var k = 0; k < smKeys.length; k++) {
        newDeviceSlots[sid][smKeys[k]] = Number(st.slot_map[smKeys[k]]);
      }
    } else {
      newDeviceSlots[sid] = (_deviceSlotsById && _deviceSlotsById[sid]) ? Object.assign({}, _deviceSlotsById[sid]) : {};
    }

    // ── Historical slot assignments ───────────────────
    newDeviceSlotHistory[sid] = (_deviceSlotHistoryById && Array.isArray(_deviceSlotHistoryById[sid]))
      ? _deviceSlotHistoryById[sid].slice()
      : [];
    if (Array.isArray(st.slot_history)) {
      newDeviceSlotHistory[sid] = st.slot_history.map(function(row) {
        var slotNumber = Number(row && row.slot_number);
        var nodeLetter = String((row && row.node_letter) || '').trim().toUpperCase();
        var assignedAtMs = row && row.assigned_at ? new Date(row.assigned_at).getTime() : NaN;
        var retiredAtMs = row && row.retired_at ? new Date(row.retired_at).getTime() : Infinity;
        if (!isFinite(slotNumber) || slotNumber <= 0 || !nodeLetter || !isFinite(assignedAtMs)) return null;
        return {
          slotNumber: slotNumber,
          nodeLetter: nodeLetter,
          assignedAtMs: assignedAtMs,
          retiredAtMs: isFinite(retiredAtMs) ? retiredAtMs : Infinity
        };
      }).filter(function(row) { return !!row; }).sort(function(a, b) {
        if (a.slotNumber !== b.slotNumber) return a.slotNumber - b.slotNumber;
        return a.assignedAtMs - b.assignedAtMs;
      });
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
    var mergedEntries = mergeHealthEntries(stationData[sid] && stationData[sid].entries, entries);
    stationData[sid] = { entries: mergedEntries, raw: { feeds: st.feeds || [] } };
    _stationDataSource[sid] = { source: 'edge', savedAt: Date.now() };

    // Save to shared cache for cross-tab sharing
    if (mergedEntries.length) {
      var cacheEntries = buildHealthCacheEntries(mergedEntries);
      if (cacheEntries.length) {
        saveCacheData(sid, cacheEntries, {
          source: 'live',
          timeRange: 'recent',
          windowStart: cacheEntries[0].timestamp.toISOString(),
          windowEnd: cacheEntries[cacheEntries.length - 1].timestamp.toISOString()
        });
      }
    }

    // ── Sync sessions ────────────────────────────────────
    var syncRows = Array.isArray(st.sync_sessions) ? st.sync_sessions : [];
    syncRows = syncRows.filter(function(r) {
      return typeof isAfterResetWindow !== 'function' || isAfterResetWindow(sid, r && r.sync_started_at);
    });
    syncRows.sort(function(a, b) {
      return new Date(a.sync_started_at).getTime() - new Date(b.sync_started_at).getTime();
    });
    _stationSyncTimeline[sid] = mergeTimelineRows(_stationSyncTimeline[sid], syncRows, healthSyncRowKey, 'sync_started_at');

    // ── Upload sessions ──────────────────────────────────
    var uploadRows = Array.isArray(st.upload_sessions) ? st.upload_sessions : [];
    uploadRows = uploadRows.filter(function(r) {
      return typeof isAfterResetWindow !== 'function' || isAfterResetWindow(sid, r && r.upload_started_at);
    });
    uploadRows.sort(function(a, b) {
      return new Date(a.upload_started_at).getTime() - new Date(b.upload_started_at).getTime();
    });
    _stationUploadTimeline[sid] = mergeTimelineRows(_stationUploadTimeline[sid], uploadRows, healthUploadRowKey, 'upload_started_at');

    // ── Derive _stationDiag (latest upload + latest sync per node) ──
    var latestUpload = _stationUploadTimeline[sid].length ? _stationUploadTimeline[sid][_stationUploadTimeline[sid].length - 1] : null;
    var latestSyncByNode = {};
    for (var ri = _stationSyncTimeline[sid].length - 1; ri >= 0; ri--) {
      var node = _stationSyncTimeline[sid][ri].node_id;
      if (node && !latestSyncByNode[node]) latestSyncByNode[node] = _stationSyncTimeline[sid][ri];
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

  if (Array.isArray(STATIONS)) {
    for (var si = 0; si < STATIONS.length; si++) {
      var stationId = STATIONS[si] && STATIONS[si].id;
      if (!stationId || payloadStationIds[stationId]) continue;
      if (!stationData[stationId]) {
        stationData[stationId] = { entries: [], raw: null };
        _stationDataSource[stationId] = { source: 'edge-missing', savedAt: Date.now() };
      }
      if (!newDeviceStatus[stationId] && _deviceStatusById[stationId]) newDeviceStatus[stationId] = _deviceStatusById[stationId];
      if (!newDeviceConfig[stationId] && _deviceConfigById[stationId]) newDeviceConfig[stationId] = _deviceConfigById[stationId];
      if (!newDeviceSlots[stationId] && _deviceSlotsById[stationId]) newDeviceSlots[stationId] = _deviceSlotsById[stationId];
      if (!newDeviceSlotHistory[stationId] && _deviceSlotHistoryById[stationId]) newDeviceSlotHistory[stationId] = _deviceSlotHistoryById[stationId];
    }
  }

  _deviceStatusById = newDeviceStatus;
  _deviceConfigById = newDeviceConfig;
  _deviceSlotsById = newDeviceSlots;
  _deviceSlotHistoryById = newDeviceSlotHistory;
}

async function ensureHealthRangeLoaded(range) {
  var requestedRange = range === 'all' ? 'all' : 'recent';
  if (healthDataCanServeRange(requestedRange)) return false;
  if (_healthRangeFetchPromise && _healthRangeFetchKey === requestedRange) return _healthRangeFetchPromise;

  var fetchStatus = document.getElementById('fetchStatus');
  var requestWindow = getHealthRequestedWindow(requestedRange);
  var openStationIds = getOpenHealthStationIds();
  if (fetchStatus) {
    fetchStatus.textContent = requestedRange === 'all'
      ? 'Loading long-range history...'
      : 'Refreshing recent history...';
  }

  _healthRangeFetchKey = requestedRange;
  _healthRangeFetchPromise = (async function() {
    var payload = await fetchEdgeHealthSummaryResilient({
      range: requestedRange,
      from: requestWindow.from.toISOString(),
      to: requestWindow.to.toISOString(),
      points: getHealthPointsTarget(requestedRange)
    });
    applyEdgeHealthPayload(payload);
    rebuildHealthStations(openStationIds);
    updateHealthDiagnostics({
      source: 'edge',
      generatedAt: payload.generated_at,
      dataAsOf: getHealthLatestDataAsOf(),
      schemaVersion: payload.schema_version,
      rangeLabel: payload.time_range ? (dashboardDiagFormatUtc(payload.time_range.from) + ' → ' + dashboardDiagFormatUtc(payload.time_range.to)) : '--',
      stationCount: payload.station_count,
      fetchDurationMs: payload._response_duration_ms,
      cacheAgeS: 0,
      stationSummary: (payload.stations || []).map(function(s) {
        return s.station_id + ':' + (Array.isArray(s.feeds) ? s.feeds.length : 0) + 'f';
      }).join(', '),
      lastRefreshAt: Date.now(),
      error: '',
      note: requestedRange === 'all'
        ? 'Expanded Station Health to the full retained window.'
        : healthPayloadNote(
            payload,
            'Recent Station Health window refreshed from the Edge Function.',
            'Recent Station Health refreshed from a reduced fallback window after the default request timed out.'
          )
    });
    return true;
  })().finally(function() {
    _healthRangeFetchPromise = null;
    _healthRangeFetchKey = '';
  });

  return _healthRangeFetchPromise;
}

/**
 * Edge-path fetch: one Edge Function call replaces N×7 PostgREST calls.
 */
async function fetchLiveAllEdge() {
  var requestedRange = getPreferredHealthFetchRange();
  var btn    = document.getElementById('btnFetchAll');
  var status = document.getElementById('fetchStatus');
  btn.innerHTML = '<span class="spinner"></span> Fetching...';
  btn.disabled  = true;
  status.textContent = '';
  updateHealthDiagnostics({ source: 'loading', lastRefreshAt: Date.now(), error: '', note: 'Waiting for health-summary payload…' });

  try {
    status.textContent = 'Fetching all stations via Edge Function...';
    var requestWindow = getHealthRequestedWindow(requestedRange);
    var payload = await fetchEdgeHealthSummaryResilient({
      range: requestedRange,
      from: requestWindow.from.toISOString(),
      to: requestWindow.to.toISOString(),
      points: getHealthPointsTarget(requestedRange)
    });

    applyEdgeHealthPayload(payload);

    // Show rendering status and yield so the browser can repaint
    status.textContent = 'Rendering charts...';
    await yieldToBrowser();

    rebuildHealthStations(getOpenHealthStationIds());

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
      note: requestedRange === 'all'
        ? 'Single health-summary Edge payload covering the full retained window for all active stations.'
        : healthPayloadNote(
            payload,
            'Single health-summary Edge payload for all active stations.',
            'Single health-summary Edge payload loaded from a reduced fallback window after the default recent request timed out.'
          )
    });

    btn.innerHTML = '&#128752; Fetch Live';
    btn.disabled  = false;
    var ts = new Date().toLocaleTimeString('en-GB', {timeZone:'UTC', hour:'2-digit', minute:'2-digit'}) + ' UTC';
    status.innerHTML = '<span style="color:var(--success)">' +
      (payload && payload._healthFallback
        ? ('Health page updated via reduced ' + payload._healthFallback.days + 'd edge window')
        : ('All ' + STATIONS.length + ' stations updated via edge')) +
      ' &mdash; ' + ts + '</span>';

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
