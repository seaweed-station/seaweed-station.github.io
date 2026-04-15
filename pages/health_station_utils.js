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

function getCurrentHealthSlotMap(stationId) {
  var stationKey = stationId ? String(stationId).toLowerCase() : '';
  var deviceSlots = stationKey && _deviceSlotsById ? _deviceSlotsById[stationKey] : null;
  var slotMap = {};
  if (!deviceSlots) return slotMap;
  var keys = Object.keys(deviceSlots);
  for (var i = 0; i < keys.length; i++) {
    var node = String(keys[i] || '').trim().toUpperCase();
    var slotNumber = Number(deviceSlots[keys[i]]);
    if (!node || !isFinite(slotNumber) || slotNumber <= 0) continue;
    slotMap[slotNumber] = node;
  }
  return slotMap;
}

function healthStationHasSlotMetadata(stationId) {
  var stationKey = stationId ? String(stationId).toLowerCase() : '';
  var slotMap = stationKey && _deviceSlotsById ? _deviceSlotsById[stationKey] : null;
  if (slotMap && Object.keys(slotMap).length) return true;
  var slotHistory = stationKey && _deviceSlotHistoryById ? _deviceSlotHistoryById[stationKey] : null;
  return !!(Array.isArray(slotHistory) && slotHistory.length);
}

function healthStationHasSatelliteEvidence(stationId, entries) {
  return isSatelliteVisible(stationId, entries, 1) || isSatelliteVisible(stationId, entries, 2);
}

function healthStationSyncContextPending(stationId, entries) {
  var sourceInfo = stationId ? (_stationDataSource[stationId] || null) : null;
  var syncRows = stationId && _stationSyncTimeline ? _stationSyncTimeline[stationId] : null;
  if (!sourceInfo || sourceInfo.source !== 'cache') return false;
  if (Array.isArray(syncRows) && syncRows.length) return false;
  if (healthStationHasSlotMetadata(stationId)) return false;
  return healthStationHasSatelliteEvidence(stationId, entries);
}

function getHealthSlotHistory(stationId) {
  var stationKey = stationId ? String(stationId).toLowerCase() : '';
  var rows = stationKey && _deviceSlotHistoryById ? _deviceSlotHistoryById[stationKey] : null;
  return Array.isArray(rows) ? rows : [];
}

function getHealthSlotStateForWindow(stationId, startMs, endMs) {
  var slotMap = {};
  var history = getHealthSlotHistory(stationId);
  var hasWindow = isFinite(startMs) && isFinite(endMs) && endMs > startMs;

  if (history.length && hasWindow) {
    var durationBySlot = {};
    for (var i = 0; i < history.length; i++) {
      var row = history[i];
      var slotNumber = Number(row.slotNumber);
      var nodeLetter = String(row.nodeLetter || '').trim().toUpperCase();
      var assignedAtMs = Number(row.assignedAtMs);
      var retiredAtMs = Number(row.retiredAtMs);
      if (!isFinite(slotNumber) || slotNumber <= 0 || !nodeLetter || !isFinite(assignedAtMs)) continue;
      if (!isFinite(retiredAtMs)) retiredAtMs = Infinity;
      var overlapStart = Math.max(startMs, assignedAtMs);
      var overlapEnd = Math.min(endMs, retiredAtMs);
      if (!(overlapEnd > overlapStart)) continue;
      if (!durationBySlot[slotNumber]) durationBySlot[slotNumber] = {};
      if (!durationBySlot[slotNumber][nodeLetter]) {
        durationBySlot[slotNumber][nodeLetter] = { ms: 0, lastAssignedAtMs: assignedAtMs };
      }
      durationBySlot[slotNumber][nodeLetter].ms += overlapEnd - overlapStart;
      if (assignedAtMs > durationBySlot[slotNumber][nodeLetter].lastAssignedAtMs) {
        durationBySlot[slotNumber][nodeLetter].lastAssignedAtMs = assignedAtMs;
      }
    }

    var slotKeys = Object.keys(durationBySlot);
    for (var sk = 0; sk < slotKeys.length; sk++) {
      var slotNumberKey = Number(slotKeys[sk]);
      var nodeStats = durationBySlot[slotNumberKey];
      var nodeKeys = Object.keys(nodeStats || {});
      var bestNode = null;
      var bestMs = -1;
      var bestAssignedAtMs = -1;
      for (var nk = 0; nk < nodeKeys.length; nk++) {
        var nodeKey = nodeKeys[nk];
        var stat = nodeStats[nodeKey];
        if (!stat) continue;
        if (stat.ms > bestMs || (stat.ms === bestMs && stat.lastAssignedAtMs > bestAssignedAtMs)) {
          bestNode = nodeKey;
          bestMs = stat.ms;
          bestAssignedAtMs = stat.lastAssignedAtMs;
        }
      }
      if (bestNode) slotMap[slotNumberKey] = bestNode;
    }
  }

  if (hasWindow && history.length) {
    var probeMs = Math.max(startMs, endMs - 1);
    for (var hi = 0; hi < history.length; hi++) {
      var histRow = history[hi];
      var histSlotNumber = Number(histRow.slotNumber);
      var histNodeLetter = String(histRow.nodeLetter || '').trim().toUpperCase();
      var histAssignedAtMs = Number(histRow.assignedAtMs);
      var histRetiredAtMs = Number(histRow.retiredAtMs);
      if (!isFinite(histSlotNumber) || histSlotNumber <= 0 || !histNodeLetter || !isFinite(histAssignedAtMs)) continue;
      if (!isFinite(histRetiredAtMs)) histRetiredAtMs = Infinity;
      if (slotMap[histSlotNumber]) continue;
      if (histAssignedAtMs <= probeMs && histRetiredAtMs > probeMs) slotMap[histSlotNumber] = histNodeLetter;
    }
  }

  if (!history.length || !hasWindow) {
    var currentSlotMap = getCurrentHealthSlotMap(stationId);
    var currentSlotKeys = Object.keys(currentSlotMap);
    for (var ck = 0; ck < currentSlotKeys.length; ck++) {
      var currentSlotNumber = Number(currentSlotKeys[ck]);
      if (!slotMap[currentSlotNumber]) slotMap[currentSlotNumber] = currentSlotMap[currentSlotNumber];
    }
  }

  return slotMap;
}

function healthSyncRowLooksReal(row) {
  if (!row) return false;
  var receivedTotal = Number(row.received_total);
  if (isFinite(receivedTotal) && receivedTotal > 0) return true;
  var persistedSd = Number(row.persisted_sd);
  if (isFinite(persistedSd) && persistedSd > 0) return true;
  var receivedLive = Number(row.received_live);
  if (isFinite(receivedLive) && receivedLive > 0) return true;
  var receivedFileRows = Number(row.received_file_rows);
  if (isFinite(receivedFileRows) && receivedFileRows > 0) return true;
  var receivedFiles = Number(row.received_files);
  if (isFinite(receivedFiles) && receivedFiles > 0) return true;
  var rssiNum = Number(row.sat_rssi_avg);
  if (isFinite(rssiNum) && rssiNum !== 0) return true;
  var status = String(row.status || '').trim().toLowerCase();
  return status === 'ok' || status === 'success' || status === 'succeeded' || status === 'complete' || status === 'completed';
}

function getHealthSlotContext(stationId, entries, syncRows, opts) {
  opts = opts || {};
  var stationEntries = Array.isArray(entries) ? entries : [];
  var timeline = Array.isArray(syncRows) ? syncRows : [];
  var windowStartMs = isFinite(opts.windowStartMs) ? Number(opts.windowStartMs) : NaN;
  var windowEndMs = isFinite(opts.windowEndMs) ? Number(opts.windowEndMs) : NaN;

  if (!isFinite(windowStartMs) || !isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    if (stationEntries.length) {
      windowStartMs = stationEntries[0].timestamp.getTime();
      windowEndMs = stationEntries[stationEntries.length - 1].timestamp.getTime() + 1;
    } else if (timeline.length) {
      var syncTimes = timeline.map(function(row) {
        return row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
      }).filter(function(ts) { return isFinite(ts); }).sort(function(a, b) { return a - b; });
      if (syncTimes.length) {
        windowStartMs = syncTimes[0];
        windowEndMs = syncTimes[syncTimes.length - 1] + 1;
      }
    }
  }

  var slotState = getHealthSlotStateForWindow(stationId, windowStartMs, windowEndMs);
  var hasHistoricalWindow = isFinite(windowStartMs) && isFinite(windowEndMs) && windowEndMs > windowStartMs && getHealthSlotHistory(stationId).length > 0;
  var slot1Configured = !hasHistoricalWindow && isSatelliteConfiguredSlot(stationId, 1);
  var slot2Configured = !hasHistoricalWindow && isSatelliteConfiguredSlot(stationId, 2);
  var slot1HasData = typeof hasSlotData === 'function' ? hasSlotData(stationEntries, 1) : hasSatelliteSignals(stationEntries, 1);
  var slot2HasData = typeof hasSlotData === 'function' ? hasSlotData(stationEntries, 2) : hasSatelliteSignals(stationEntries, 2);
  var slot1Known = !!(slot1Configured || slot1HasData || slotState[1]);
  var slot2Known = !!(slot2Configured || slot2HasData || slotState[2]);
  var allowObservedOnlyFallback = !slot1Known && !slot2Known;
  var slot1Node = slotState[1] || (slot1Configured ? satelliteNodeLetter(stationId, 1) : null);
  var slot2Node = slotState[2] || (slot2Configured ? satelliteNodeLetter(stationId, 2) : null);
  var observedNodes = [];
  var observedTimeline = timeline;

  if (isFinite(windowStartMs) && isFinite(windowEndMs) && windowEndMs > windowStartMs) {
    observedTimeline = timeline.filter(function(row) {
      var ts = row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
      return isFinite(ts) && ts >= windowStartMs && ts < windowEndMs;
    });
  }

  for (var i = 0; i < observedTimeline.length; i++) {
    var node = String((observedTimeline[i] && observedTimeline[i].node_id) || '').trim().toUpperCase();
    if (!node || node === 'HUB' || /^H\d+$/.test(node) || observedNodes.indexOf(node) >= 0) continue;
    observedNodes.push(node);
  }

  // When history is unavailable, prefer the node actually seen in the active window
  // over the current live slot map. This prevents a later live reassignment from
  // manufacturing a fake Slot 1/Slot 2 split on older single-satellite days.
  if (!hasHistoricalWindow && observedNodes.length === 1) {
    slot1Node = observedNodes[0];
    slot2Node = null;
    slot1Known = true;
    slot2Known = false;
    slot1HasData = slot1HasData || slot2HasData;
    slot2HasData = false;
    slot1Configured = slot1Configured || slot2Configured;
    slot2Configured = false;
    allowObservedOnlyFallback = false;
  }

  var remainingNodes = observedNodes.filter(function(node) {
    return node !== slot1Node && node !== slot2Node;
  });

  if (!slot1Node && slot1Known && remainingNodes.length) slot1Node = remainingNodes.shift();
  if (!slot2Node && slot2Known && remainingNodes.length) slot2Node = remainingNodes.shift();
  if (allowObservedOnlyFallback) {
    if (!slot1Node && remainingNodes.length) slot1Node = remainingNodes.shift();
    if (!slot2Node && remainingNodes.length) slot2Node = remainingNodes.shift();
  }

  var slot1Label = satelliteDisplayName(stationId, 1);
  var slot2Label = satelliteDisplayName(stationId, 2);

  return {
    slotMap: slotState,
    slot1: {
      enabled: !!(slot1Known || (allowObservedOnlyFallback && slot1Node)),
      nodeLetter: slot1Node,
      label: slot1Label,
      hasData: slot1HasData,
      configured: slot1Configured
    },
    slot2: {
      enabled: !!(slot2Known || (allowObservedOnlyFallback && slot2Node)),
      nodeLetter: slot2Node,
      label: slot2Label,
      hasData: slot2HasData,
      configured: slot2Configured
    }
  };
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
  var datasetMeta = typeof getStationDatasetState === 'function' ? getStationDatasetState(stationId) : null;
  if (datasetMeta && datasetMeta.isActive) {
    var pauseText = datasetMeta.note || datasetMeta.statusLabel;
    return {
      text: pauseText,
      summaryText: datasetMeta.statusLabel,
      cls: 'next-check-paused'
    };
  }
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

