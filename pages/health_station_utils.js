// health_station_utils.js — Extracted from station_health.html (Sprint 6)
// Station timezone helpers, satellite display, next-check-in estimation

function stationTz(stationId) {
  var s = STATIONS.find(function(st) { return st.id === stationId; });
  return s && s.tz ? s.tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function stationTzShort(stationId) {
  return 'UTC';
}
// Format a Date in UTC
function fmtStationTime(date, stationId, opts) {
  if (!date || isNaN(date.getTime())) return '--';
  var defaults = { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false };
  if (opts) { for (var k in opts) defaults[k] = opts[k]; }
  return date.toLocaleString('en-GB', defaults);
}
// Get hour (0-23) in UTC
function stationLocalHour(date, stationId) {
  return date.getUTCHours();
}
// Get YYYY-MM-DD string in UTC
function stationLocalDay(date, stationId) {
  return date.toISOString().slice(0, 10);
}


function satelliteSlotNumber(stationId, slotNumber) {
  return slotNumber;
}

function satelliteNodeLetter(stationId, slotNumber) {
  var stationKey = stationId ? String(stationId).toLowerCase() : '';
  var deviceSlots = stationKey && _deviceSlotsById ? _deviceSlotsById[stationKey] : null;
  var slotNum = Number(slotNumber);
  if (deviceSlots && isFinite(slotNum)) {
    var keys = Object.keys(deviceSlots);
    for (var i = 0; i < keys.length; i++) {
      var node = String(keys[i] || '').toUpperCase();
      if (!node) continue;
      var mappedSlot = Number(deviceSlots[keys[i]]);
      if (isFinite(mappedSlot) && mappedSlot === slotNum) return node;
    }
  }
  // Backward-compatible fallback when device_slots rows are unavailable.
  if (slotNum === 1) return 'A';
  if (slotNum === 2) return 'B';
  return null;
}

function escHtml(str) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function satelliteDisplayName(stationId, slotNumber) {
  var n = Number(slotNumber);
  if (isFinite(n) && n > 0) return 'Sat-' + n;
  return 'Sat';
}

function datasetHasLegendData(dataset) {
  if (!dataset) return false;
  if (!Array.isArray(dataset.data) || !dataset.data.length) return false;
  for (var i = 0; i < dataset.data.length; i++) {
    var point = dataset.data[i];
    if (point == null) continue;
    if (typeof point === 'number') {
      if (isFinite(point)) return true;
      continue;
    }
    if (point instanceof Date) return true;
    if (Array.isArray(point)) {
      for (var j = 0; j < point.length; j++) {
        if (point[j] != null && isFinite(Number(point[j]))) return true;
      }
      continue;
    }
    if (typeof point === 'object') {
      if (point.y != null && isFinite(Number(point.y))) return true;
      if (point.x != null && point.y === undefined) return true;
    }
  }
  return false;
}

function defaultLegendDatasetFilter(legendItem, chartData) {
  var ds = chartData && chartData.datasets ? chartData.datasets[legendItem.datasetIndex] : null;
  return datasetHasLegendData(ds);
}

// =============================================================
// EDGE FUNCTION PATH — health-summary
// =============================================================

/**
 * Fetch all-station health payload from the health-summary Edge Function.
 * @param {Object} [opts]
 * @param {string} [opts.from] ISO 8601
 * @param {string} [opts.to]   ISO 8601
 * @param {number} [opts.points] 50–2000, default 500
 * @returns {Promise<Object>} RPC payload
 */


// loadStationDiagnostics, refreshDiagnosticsAllBackground, refreshStationDiagnosticsUI
// removed — diagnostics are now populated by applyEdgeHealthPayload()

function latestInstalledFlag(entries, key) {
  if (!entries || !entries.length) return null;
  for (var i = entries.length - 1; i >= 0; i--) {
    if (entries[i][key] === true || entries[i][key] === false) return entries[i][key];
  }
  return null;
}

function hasSatelliteSignals(entries, slotNumber) {
  if (!entries || !entries.length) return false;
  var pfx = 'sat' + slotNumber;
  var keys = [pfx + 'BatV', pfx + 'BatPct', pfx + 'Temp1', pfx + 'Temp2', pfx + 'Hum1', pfx + 'Hum2', pfx + 'SampleId'];
  return entries.some(function(e) {
    for (var i = 0; i < keys.length; i++) {
      if (e[keys[i]] !== null && e[keys[i]] !== undefined) return true;
    }
    return false;
  });
}

function isSatelliteInstalled(entries, slotNumber) {
  var key = 'sat' + slotNumber + 'Installed';
  var explicit = latestInstalledFlag(entries, key);
  if (explicit === true || explicit === false) return explicit;
  return hasSatelliteSignals(entries, slotNumber);
}

function isSatelliteConfiguredSlot(stationId, slotNumber) {
  var sid = stationId ? String(stationId).trim().toLowerCase() : '';
  if (!sid || !_deviceSlotsById || !_deviceSlotsById[sid]) return false;
  var slotNum = Number(slotNumber);
  if (!isFinite(slotNum)) return false;
  var slotMap = _deviceSlotsById[sid];
  var nodeKeys = Object.keys(slotMap);
  for (var i = 0; i < nodeKeys.length; i++) {
    if (Number(slotMap[nodeKeys[i]]) === slotNum) return true;
  }
  return false;
}

function isSatelliteVisible(stationId, entries, slotNumber) {
  return isSatelliteInstalled(entries, slotNumber) || isSatelliteConfiguredSlot(stationId, slotNumber);
}

function buildStationRangeBar(stationId, range) {
  var rangeBar = document.createElement('div');
  rangeBar.className = 'station-range';
  rangeBar.innerHTML =
    '<span class="label">Plots:</span>' +
    '<button class="btn btn-sm ' + (range === 'day' ? 'active' : '') + '" onclick="setStationRange(\'' + stationId + '\', \'day\')">Day</button>' +
    '<button class="btn btn-sm ' + (range === 'week' ? 'active' : '') + '" onclick="setStationRange(\'' + stationId + '\', \'week\')">Week</button>' +
    '<button class="btn btn-sm ' + (range === 'month' ? 'active' : '') + '" onclick="setStationRange(\'' + stationId + '\', \'month\')">Month</button>' +
    '<button class="btn btn-sm ' + (range === 'all' ? 'active' : '') + '" onclick="setStationRange(\'' + stationId + '\', \'all\')">All</button>';
  return rangeBar;
}

// Parse gateway station data (T0 + Slot 1 + Slot 2)

function fmtEtaMinutes(mins) {
  var abs = Math.max(0, Math.round(Math.abs(mins)));
  if (abs < 60) return abs + 'm';
  var h = Math.floor(abs / 60);
  var m = abs % 60;
  return m ? (h + 'h ' + m + 'm') : (h + 'h');
}

var NEXT_CHECK_PIPELINE_BUFFER_MIN = 12;

function estimateStationNextCheckIn(entries, stationId) {
  var statusRow = stationId ? _deviceStatusById[stationId] : null;
  var nextFromStatus = statusRow && statusRow.nextCheckInAt ? statusRow.nextCheckInAt : null;
  if (nextFromStatus && !isNaN(nextFromStatus.getTime())) {
    var statusDeltaMin = Math.round((nextFromStatus.getTime() - Date.now()) / 60000);
    var statusCls = 'next-check-good';
    var statusWhen;
    if (statusDeltaMin >= 0) {
      statusCls = 'next-check-good';
      statusWhen = 'in ' + fmtEtaMinutes(statusDeltaMin);
    } else if (Math.abs(statusDeltaMin) <= NEXT_CHECK_PIPELINE_BUFFER_MIN) {
      statusCls = 'next-check-warn';
      statusWhen = 'pending ingest';
    } else {
      statusCls = 'next-check-late';
      statusWhen = 'overdue by ' + fmtEtaMinutes(Math.abs(statusDeltaMin) - NEXT_CHECK_PIPELINE_BUFFER_MIN);
    }
    var statusAbs = nextFromStatus.toLocaleString('en-GB', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'UTC'
    });
    return {
      text: 'Next: ' + statusWhen + ' (' + statusAbs + ' UTC)',
      summaryText: 'Next check in: ' + statusWhen + ' (' + statusAbs + ' UTC)',
      cls: statusCls
    };
  }

  var srcInfo = stationId ? (_stationDataSource[stationId] || {}) : {};
  if (srcInfo.source === 'cache') {
    return {
      text: 'Next: waiting for live status',
      summaryText: 'Next check in: waiting for live status',
      cls: 'next-check-unknown'
    };
  }

  if (!entries || entries.length < 2) {
    return {
      text: 'Next check in: --',
      summaryText: 'Next check in: --',
      cls: 'next-check-unknown'
    };
  }
  var latest = entries[entries.length - 1].timestamp;
  if (!latest || isNaN(latest.getTime())) {
    return {
      text: 'Next check in: --',
      summaryText: 'Next check in: --',
      cls: 'next-check-unknown'
    };
  }

  var diffs = [];
  var start = Math.max(1, entries.length - 40);
  for (var i = start; i < entries.length; i++) {
    var prevTs = entries[i - 1].timestamp;
    var curTs = entries[i].timestamp;
    if (!prevTs || !curTs) continue;
    var d = curTs.getTime() - prevTs.getTime();
    if (d > 0 && d <= 12 * 3600000) diffs.push(d);
  }
  if (!diffs.length) {
    return {
      text: 'Next check in: --',
      summaryText: 'Next check in: --',
      cls: 'next-check-unknown'
    };
  }

  diffs.sort(function(a, b) { return a - b; });
  var cadenceMs = diffs[Math.floor(diffs.length / 2)];
  var nextAt = new Date(latest.getTime() + cadenceMs);
  var deltaMin = Math.round((nextAt.getTime() - Date.now()) / 60000);
  var cls = 'next-check-good';
  var when;
  if (deltaMin >= 0) {
    cls = 'next-check-good';
    when = 'in ' + fmtEtaMinutes(deltaMin);
  } else if (Math.abs(deltaMin) <= NEXT_CHECK_PIPELINE_BUFFER_MIN) {
    cls = 'next-check-warn';
    when = 'pending ingest';
  } else {
    cls = 'next-check-late';
    when = 'overdue by ' + fmtEtaMinutes(Math.abs(deltaMin) - NEXT_CHECK_PIPELINE_BUFFER_MIN);
  }
  var nextAbs = nextAt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'UTC'
  });
  return {
    text: 'Next: ' + when + ' (' + nextAbs + ' UTC)',
    summaryText: 'Next check in: ' + when + ' (' + nextAbs + ' UTC)',
    cls: cls
  };
}

