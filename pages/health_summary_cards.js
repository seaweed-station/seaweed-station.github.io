// health_summary_cards.js — Extracted from station_health.html (Sprint 6)
// Summary card rendering: sync stats, battery overview, drift display

function syncFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function formatHealthDatasetEndUtcLabel(endMs) {
  if (!isFinite(endMs)) return '--';
  return new Date(endMs).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'UTC'
  }) + ' UTC';
}

function formatSyncStopReason(reasonValue) {
  var reason = syncFiniteNumber(reasonValue);
  if (reason === null) return null;
  if (reason === 0) return { code: 0, label: 'Transfer complete', tone: 'var(--success)' };
  if (reason === 1) return { code: 1, label: 'File transfer stalled', tone: 'var(--warning)' };
  if (reason === 2) return { code: 2, label: 'No first file frame', tone: 'var(--danger)' };
  if (reason === 3) return { code: 3, label: 'File window timeout', tone: 'var(--danger)' };
  if (reason === 4) return { code: 4, label: 'No files pending', tone: 'var(--text-muted)' };
  return { code: reason, label: 'Stop reason ' + reason, tone: 'var(--text-muted)' };
}

function humanizeSyncDetail(detailValue) {
  var detail = String(detailValue || '').trim().toLowerCase();
  if (!detail) return '';
  if (detail === 'files_requested_but_zero_received' || detail === 'backlog_requested_but_zero_received') return 'Requested files, none received';
  if (detail === 'file_transfer_incomplete') return 'File transfer incomplete';
  if (detail === 'files_partial') return 'Partial file transfer';
  if (detail === 'sync_no_mac_ack') return 'No MAC ACK';
  if (detail === 'relink_sync_no_mac_ack') return 'Relink sync, no MAC ACK';
  if (detail === 'sync_sent_no_hello' || detail === 'sync_retried_no_hello') return 'No HELLO reply';
  return detail.replace(/_/g, ' ').replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
}

function isSyncSessionSuccess(row) {
  if (!row) return false;
  var okNum = syncFiniteNumber(row.sync_ok);
  if (okNum !== null) return okNum > 0;
  var s = String(row.status || '').trim().toLowerCase();
  return s === 'ok' || s === 'success' || s === 'succeeded' || s === 'complete' || s === 'completed';
}

function syncOutcomeMeta(row) {
  if (!row) return { label: 'No recent sync session', tone: 'var(--text-muted)' };

  var detailKey = String(row.status_detail || '').trim().toLowerCase();
  var stop = formatSyncStopReason(row.t0_backlog_stop_reason);
  var label = humanizeSyncDetail(detailKey) || humanizeSyncDetail(row.status) || 'Sync session recorded';
  var tone = isSyncSessionSuccess(row) ? 'var(--success)' : 'var(--text-muted)';

  if (
    detailKey === 'files_requested_but_zero_received' ||
    detailKey === 'backlog_requested_but_zero_received' ||
    detailKey === 'file_transfer_incomplete' ||
    detailKey === 'files_partial'
  ) {
    if (stop && (stop.code === 1 || stop.code === 2 || stop.code === 3)) {
      label = stop.label;
      tone = stop.tone;
    } else {
      tone = detailKey === 'files_partial' ? 'var(--warning)' : 'var(--danger)';
    }
  } else if (
    detailKey === 'sync_no_mac_ack' ||
    detailKey === 'relink_sync_no_mac_ack' ||
    detailKey === 'sync_sent_no_hello' ||
    detailKey === 'sync_retried_no_hello'
  ) {
    tone = 'var(--danger)';
  } else if (stop && !isSyncSessionSuccess(row) && (stop.code === 1 || stop.code === 2 || stop.code === 3)) {
    label = stop.label;
    tone = stop.tone;
  }

  return { label: label, tone: tone, stop: stop };
}

function formatCompactDurationMs(msValue) {
  var ms = syncFiniteNumber(msValue);
  if (ms === null || ms <= 0) return null;
  var sec = Math.round(ms / 1000);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function syncTransferSummary(row) {
  if (!row) return '--';
  var parts = [];
  var mode = String(row.transfer_mode || '').trim().toLowerCase();
  var requested = syncFiniteNumber(row.requested_files);
  var receivedFiles = syncFiniteNumber(row.received_files);
  var receivedRows = syncFiniteNumber(row.received_file_rows);
  var elapsed = formatCompactDurationMs(row.transfer_elapsed_ms);

  if (mode) parts.push(mode === 'file' ? 'File mode' : (mode.charAt(0).toUpperCase() + mode.slice(1) + ' mode'));
  if (requested !== null || receivedFiles !== null) {
    parts.push((receivedFiles !== null ? receivedFiles : '--') + '/' + (requested !== null ? requested : '--') + ' files');
  }
  if (receivedRows !== null) parts.push(receivedRows + ' rows');
  if (elapsed) parts.push(elapsed);
  return parts.length ? parts.join(' | ') : '--';
}

// ============================================================
// COMPACT SUMMARY CARDS
// ============================================================
function renderSummaryCards(container, entries, stationId) {
  var e = entries;
  var latest = e[e.length - 1];
  var datasetMeta = typeof getStationDatasetState === 'function' ? getStationDatasetState(stationId) : null;
  var slot1Enabled = isSatelliteVisible(stationId, e, 1);
  var slot2Enabled = isSatelliteVisible(stationId, e, 2);
  var nextCheck = estimateStationNextCheckIn(e, stationId);
  var slot1Label = satelliteDisplayName(stationId, 1);
  var slot2Label = satelliteDisplayName(stationId, 2);

  function lastWith(key) {
    for (var i = e.length - 1; i >= 0; i--) {
      if (e[i][key] !== null && e[i][key] !== undefined) return e[i];
    }
    return null;
  }

  function lastWithPredicate(predicate) {
    for (var i = e.length - 1; i >= 0; i--) {
      if (predicate(e[i])) return e[i];
    }
    return null;
  }

  var t0 = lastWith('t0BatPct');
  var slot1 = lastWith('sat1BatV');
  var slot2 = lastWith('sat2BatV');
  var t0VoltEntry = lastWithPredicate(function(row) {
    return row && row.t0BatV !== null && row.t0BatV !== undefined && isFinite(row.t0BatV) && Number(row.t0BatV) > 0;
  });

  // Battery drain last 24h
  function drain24(key) {
    var cutoff = new Date(latest.timestamp.getTime() - 24*3600000);
    var recent = e.filter(function(x) { return x.timestamp >= cutoff && x[key] !== null && x[key] !== undefined; });
    if (recent.length < 2) return '--';
    var d = recent[recent.length-1][key] - recent[0][key];
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
  }

  var row = document.createElement('div');
  row.className = 'summary-row';
  var datasetCard = '';
  if (datasetMeta && datasetMeta.isActive) {
    datasetCard = '<div class="sum-card">' +
      '<h4>Dataset status</h4>' +
      '<div class="sum-val" style="color:' + (datasetMeta.status === 'finished' ? 'var(--success)' : 'var(--warning)') + '">' + escHtml(datasetMeta.statusLabel) + '</div>' +
      '<div class="sum-sub">End: ' + escHtml(formatHealthDatasetEndUtcLabel(datasetMeta.endMs)) + '</div>' +
      '<div class="sum-sub">Reason: ' + escHtml(datasetMeta.note || '--') + '</div>' +
    '</div>';
  }

  // Firmware strings
  var t0Fw  = (t0  && t0.t0FwVersion)   ? escHtml('v' + t0.t0FwVersion + (t0.t0BuildDate ? ' (' + t0.t0BuildDate + ')' : '')) : '--';

  // v2: satellite FW and RSSI/drift now come from sync_sessions
  var diag = _stationDiag[stationId] || { upload: null, sync: {} };
  var slot1Node = satelliteNodeLetter(stationId, 1);
  var slot2Node = satelliteNodeLetter(stationId, 2);
  var syncA = diag.sync && slot1Node && diag.sync[slot1Node] ? diag.sync[slot1Node] : null;
  var syncB = diag.sync && slot2Node && diag.sync[slot2Node] ? diag.sync[slot2Node] : null;
  var ulSess = diag.upload || null;

  var slot1Fw = syncA && syncA.sat_fw_ver ? escHtml('v' + syncA.sat_fw_ver) : '--';
  var slot2Fw = syncB && syncB.sat_fw_ver ? escHtml('v' + syncB.sat_fw_ver) : '--';

  var statusRow = _deviceStatusById && _deviceStatusById[stationId] ? _deviceStatusById[stationId] : null;
  var configRow = _deviceConfigById && _deviceConfigById[stationId] ? _deviceConfigById[stationId] : null;

  var t0LatestSamplePct = (t0 && t0.t0BatPct !== null && t0.t0BatPct !== undefined) ? Number(t0.t0BatPct) : null;
  var t0DisplayPct = t0LatestSamplePct;
  if (t0DisplayPct === null && statusRow && statusRow.batteryPct != null && isFinite(statusRow.batteryPct)) {
    t0DisplayPct = statusRow.batteryPct >= 0 ? Number(statusRow.batteryPct) : null;
  }
  var t0PluggedIn = (t0LatestSamplePct === 0);
  var t0DisplayV = t0VoltEntry && t0VoltEntry.t0BatV != null ? Number(t0VoltEntry.t0BatV) : null;

  function isUploadSuccessRow(row) {
    if (!row) return false;
    var okNum = (row.upload_ok !== null && row.upload_ok !== undefined && row.upload_ok !== '') ? Number(row.upload_ok) : null;
    if (okNum != null && isFinite(okNum)) return okNum > 0;
    var s = String(row.status || '').trim().toLowerCase();
    return s === 'ok' || s === 'success' || s === 'succeeded' || s === 'complete' || s === 'completed';
  }

  // Data success metrics moved to top summary cards.
  var samplePeriodMin = null;
  var expectedEntries = null;
  var completeness = null;
  var gaps = 0;
  var longestGapMs = 0;
  var t0SensorPct = null;
  var slot1SensorPct = null;
  var slot2SensorPct = null;
  if (e.length >= 2) {
    var intervals = [];
    for (var ii = 1; ii < e.length; ii++) {
      var dt = e[ii].timestamp - e[ii - 1].timestamp;
      if (dt > 0) intervals.push(dt);
    }
    if (intervals.length) {
      intervals.sort(function(a, b) { return a - b; });
      var medianMs = intervals[Math.floor(intervals.length / 2)];
      if (medianMs > 0) {
        samplePeriodMin = Math.round(medianMs / 60000);
        var totalSpan = latest.timestamp - e[0].timestamp;
        expectedEntries = Math.floor(totalSpan / medianMs) + 1;
        completeness = Math.max(0, Math.min(100, (e.length / Math.max(1, expectedEntries)) * 100));

        var gapThreshold = medianMs * 2.5;
        for (var gi = 0; gi < intervals.length; gi++) {
          if (intervals[gi] > gapThreshold) {
            gaps++;
            if (intervals[gi] > longestGapMs) longestGapMs = intervals[gi];
          }
        }
      }
    }

    var t0SensorN = e.filter(function(x) { return x.t0Temp1 !== null || x.t0Temp2 !== null || x.t0Temp3 !== null; }).length;
    var slot1SensorN = e.filter(function(x) { return x.sat1Temp1 !== null || x.sat1Temp2 !== null; }).length;
    var slot2SensorN = e.filter(function(x) { return x.sat2Temp1 !== null || x.sat2Temp2 !== null; }).length;
    t0SensorPct = e.length ? (t0SensorN / e.length * 100) : null;
    slot1SensorPct = e.length ? (slot1SensorN / e.length * 100) : null;
    slot2SensorPct = e.length ? (slot2SensorN / e.length * 100) : null;
  }

  // Upload success rate in last 24h
  var uploadRows = Array.isArray(_stationUploadTimeline[stationId]) ? _stationUploadTimeline[stationId] : [];
  var upload24Rows = uploadRows.filter(function(r) {
    var ts = r && r.upload_started_at ? new Date(ensureUTC(r.upload_started_at)) : null;
    return ts && !isNaN(ts.getTime()) && ts.getTime() >= (latest.timestamp.getTime() - 24 * 3600000);
  });
  var upload24Ok = upload24Rows.filter(isUploadSuccessRow).length;
  var upload24Pct = upload24Rows.length ? (upload24Ok / upload24Rows.length * 100) : null;

  // SD storage usage estimate from observed free-space trend.
  var sdPoints = [];
  for (var upi = 0; upi < uploadRows.length; upi++) {
    var up = uploadRows[upi] || {};
    var upTs = up.upload_started_at ? new Date(ensureUTC(up.upload_started_at)) : null;
    var upFree = (up.sd_free_kb !== null && up.sd_free_kb !== undefined) ? Number(up.sd_free_kb) : null;
    if (upTs && !isNaN(upTs.getTime()) && upFree != null && isFinite(upFree) && upFree > 0) {
      sdPoints.push({ t: upTs.getTime(), free: upFree });
    }
  }
  if (!sdPoints.length) {
    for (var si = 0; si < e.length; si++) {
      if (e[si].sdFreeKB != null && isFinite(e[si].sdFreeKB) && Number(e[si].sdFreeKB) > 0) {
        sdPoints.push({ t: e[si].timestamp.getTime(), free: Number(e[si].sdFreeKB) });
      }
    }
  }
  sdPoints.sort(function(a, b) { return a.t - b.t; });
  var latestSdFreeKB = sdPoints.length ? sdPoints[sdPoints.length - 1].free : null;
  var estimatedSdTotalKB = sdPoints.length ? Math.max.apply(null, sdPoints.map(function(p) { return p.free; })) : null;
  var storageUsedPct = null;
  if (latestSdFreeKB != null && estimatedSdTotalKB != null && estimatedSdTotalKB > 0 && latestSdFreeKB <= estimatedSdTotalKB) {
    storageUsedPct = Math.max(0, Math.min(100, (1 - (latestSdFreeKB / estimatedSdTotalKB)) * 100));
  }

  var sdDaysRemaining = null;
  if (sdPoints.length >= 2 && latestSdFreeKB != null) {
    var firstSd = sdPoints[0];
    var lastSd = sdPoints[sdPoints.length - 1];
    var daysSpan = (lastSd.t - firstSd.t) / 86400000;
    if (daysSpan > 0) {
      var kbPerDay = (firstSd.free - lastSd.free) / daysSpan;
      if (kbPerDay > 0.5) sdDaysRemaining = latestSdFreeKB / kbPerDay;
    }
  }

  var totalDaysRunning = (latest.timestamp.getTime() - e[0].timestamp.getTime()) / 86400000;
  var lastCheckInText = (statusRow && statusRow.lastSeenAt && !isNaN(statusRow.lastSeenAt.getTime()))
    ? fmtStationTime(statusRow.lastSeenAt, stationId, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC'
    : '--';
  var lastConfigAppliedText = (configRow && configRow.updated_at)
    ? fmtStationTime(new Date(ensureUTC(configRow.updated_at)), stationId, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC'
    : '--';

  function pctTone(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'var(--text-muted)';
    if (v >= 95) return 'var(--success)';
    if (v >= 75) return 'var(--warning)';
    return 'var(--danger)';
  }

  // Sync rates (24h) based on expected sync windows (default 3h cadence)
  // v2: sat1SampleId is no longer in sensor_readings view;
  // fallback to sat1BatV presence (LATERAL join → non-null when sat data present)
  var cutoff24h = latest.timestamp.getTime() - 24 * 3600000;
  // Cache sync window evaluations per station (reused by renderSyncCharts)
  var cacheKey = stationId + '_24h';
  if (!_syncWindowCache[cacheKey]) {
    _syncWindowCache[cacheKey] = {
      slot1: slot1Enabled
        ? evaluateSyncWindows(e, 'sat1SampleId', 'sat1BatV', cutoff24h, latest.timestamp.getTime(), 3 * 3600000, 'sat1Installed')
        : { synced: 0, missed: 0, total: 0, slots: [] },
      slot2: slot2Enabled
        ? evaluateSyncWindows(e, 'sat2SampleId', 'sat2BatV', cutoff24h, latest.timestamp.getTime(), 3 * 3600000, 'sat2Installed')
        : { synced: 0, missed: 0, total: 0, slots: [] }
    };
  }
  var slot1_24 = _syncWindowCache[cacheKey].slot1;
  var slot2_24 = _syncWindowCache[cacheKey].slot2;
  function syncPctStr(stats) {
    if (!stats || !stats.total) return '--';
    var total = stats.total || 1;
    var n = stats.synced;
    var p = (n / total * 100);
    var color = p > 90 ? 'var(--success)' : p > 70 ? 'var(--warning)' : 'var(--danger)';
    return '<span style="color:' + color + '">' + p.toFixed(0) + '%</span> (' + n + '/' + total + ')';
  }

  // v2: drift sourced from latest sync_sessions row per node
  function syncSessionDrift(sess) {
    if (!sess || sess.sat_drift_s === null || sess.sat_drift_s === undefined) return { last: null, stale: true };
    var sessTime = sess.sync_started_at ? new Date(ensureUTC(sess.sync_started_at)) : null;
    var stale = false;
    if (sessTime && !isNaN(sessTime.getTime())) {
      var ageMs = Date.now() - sessTime.getTime();
      stale = ageMs > 6 * 3600000; // stale if > 6h old
    }
    return { last: sess.sat_drift_s, stale: stale };
  }

  var driftA = syncSessionDrift(syncA);
  var driftB = syncSessionDrift(syncB);
  var syncAOutcome = syncOutcomeMeta(syncA);
  var syncBOutcome = syncOutcomeMeta(syncB);
  var syncATransfer = syncTransferSummary(syncA);
  var syncBTransfer = syncTransferSummary(syncB);

  function driftStr(v) {
    if (v === null) return '--';
    var color = Math.abs(v) <= 5 ? 'var(--success)' : Math.abs(v) <= 20 ? 'var(--warning)' : 'var(--danger)';
    return '<span style="color:' + color + '">' + (v >= 0 ? '+' : '') + v + 's</span>';
  }

  function driftCardLine(info) {
    if (!info || info.last === null) return '<span style="color:var(--text-muted)">--</span>';
    var out = driftStr(info.last);
    if (info.stale) out += ' <span style="color:var(--text-muted);font-size:0.82em">(stale)</span>';
    return out;
  }

  // Safe .toFixed() helper — guards against null/undefined values from partial or test entries
  function safeFixed(val, decimals, suffix) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return val.toFixed(decimals) + (suffix || '');
  }

  var slot1Card = slot1Enabled
    ? '<div class="sum-card">' +
      '<h4>' + slot1Label + '</h4>' +
      '<div class="sum-val" style="color:' + batColor(slot1 ? slot1.sat1BatPct : null) + '">' + (slot1 ? safeFixed(slot1.sat1BatPct, 0, '%') : '--') + '</div>' +
      '<div class="sum-sub">Voltage: ' + (slot1 ? safeFixed(slot1.sat1BatV, 2, 'V') : '--') + ' &nbsp; RSSI: ' + (syncA && syncA.sat_rssi_avg !== null ? syncA.sat_rssi_avg : '--') + '</div>' +
      '<div class="sum-sub">24h \u0394: ' + drain24('sat1BatPct') + '</div>' +
      '<div class="sum-sub">Sync (24h): ' + syncPctStr(slot1_24) + '</div>' +
      '<div class="sum-sub">Last sync: <span style="color:' + syncAOutcome.tone + '">' + syncAOutcome.label + '</span></div>' +
      '<div class="sum-sub">Transfer: ' + syncATransfer + '</div>' +
      '<div class="sum-sub">Drift: ' + driftCardLine(driftA) + '</div>' +
      '<div class="sum-sub" style="margin-top:4px;color:var(--accent)">FW: ' + slot1Fw + '</div>' +
    '</div>'
    : '';

  var slot2Card = slot2Enabled
    ? '<div class="sum-card">' +
      '<h4>' + slot2Label + '</h4>' +
      '<div class="sum-val" style="color:' + batColor(slot2 ? slot2.sat2BatPct : null) + '">' + (slot2 ? safeFixed(slot2.sat2BatPct, 0, '%') : '--') + '</div>' +
      '<div class="sum-sub">Voltage: ' + (slot2 ? safeFixed(slot2.sat2BatV, 2, 'V') : '--') + ' &nbsp; RSSI: ' + (syncB && syncB.sat_rssi_avg !== null ? syncB.sat_rssi_avg : '--') + '</div>' +
      '<div class="sum-sub">24h \u0394: ' + drain24('sat2BatPct') + '</div>' +
      '<div class="sum-sub">Sync (24h): ' + syncPctStr(slot2_24) + '</div>' +
      '<div class="sum-sub">Last sync: <span style="color:' + syncBOutcome.tone + '">' + syncBOutcome.label + '</span></div>' +
      '<div class="sum-sub">Transfer: ' + syncBTransfer + '</div>' +
      '<div class="sum-sub">Drift: ' + driftCardLine(driftB) + '</div>' +
      '<div class="sum-sub" style="margin-top:4px;color:var(--accent)">FW: ' + slot2Fw + '</div>' +
    '</div>'
    : '';

  row.innerHTML =
    datasetCard +
    '<div class="sum-card">' +
      '<h4>Gateway and System</h4>' +
      '<div class="sum-val" style="color:' + batColor(t0DisplayPct) + '">' + safeFixed(t0DisplayPct, 0, '%') + '</div>' +
      '<div class="sum-sub">Voltage: ' + safeFixed(t0DisplayV, 2, 'V') + ' &nbsp; 24h Δ: ' + drain24('t0BatPct') + '</div>' +
      (t0PluggedIn ? '<div class="sum-sub" style="color:var(--warning)">Power: Plugged in (USB sample)</div>' : '') +
      '<div class="sum-sub">Upload success (24h): <span style="color:' + pctTone(upload24Pct) + '">' + (upload24Pct != null ? upload24Pct.toFixed(0) + '%' : '--') + '</span> (' + upload24Ok + '/' + upload24Rows.length + ')</div>' +
      '<div class="sum-sub">Storage used: ' + (storageUsedPct != null ? storageUsedPct.toFixed(1) + '%' : '--') + ' &nbsp; Free: ' + (latestSdFreeKB != null ? formatKB(latestSdFreeKB) : '--') + '</div>' +
      '<div class="sum-sub">FW: <span style="color:var(--accent)">' + t0Fw + '</span></div>' +
    '</div>' +
    slot1Card +
    slot2Card +
    '<div class="sum-card">' +
      '<h4>Data and Check-Ins</h4>' +
      '<div class="sum-val" style="color:' + pctTone(completeness) + '">' + (completeness != null ? completeness.toFixed(1) + '%' : '--') + ' <span style="font-size:.72rem;font-weight:500;color:var(--text-muted)">since commissioning</span></div>' +
      '<div class="sum-sub">24h Sensor coverage: T0 ' + (t0SensorPct != null ? t0SensorPct.toFixed(1) + '%' : '--') +
        (slot1Enabled ? ' &nbsp;|&nbsp; ' + slot1Label + ' ' + (slot1SensorPct != null ? slot1SensorPct.toFixed(1) + '%' : '--') : '') +
        (slot2Enabled ? ' &nbsp;|&nbsp; ' + slot2Label + ' ' + (slot2SensorPct != null ? slot2SensorPct.toFixed(1) + '%' : '--') : '') + '</div>' +
      '<div class="sum-sub">24h Expected/Actual: ' + (expectedEntries != null ? expectedEntries.toLocaleString() : '--') + ' / ' + e.length.toLocaleString() + '</div>' +
      '<div class="sum-sub">Total entries: ' + e.length.toLocaleString() + ' &nbsp;|&nbsp; Days running: ' + totalDaysRunning.toFixed(1) + '</div>' +
      '<div class="sum-sub">Last config applied: ' + lastConfigAppliedText + '</div>' +
      '<div class="sum-sub">Last check-in: ' + lastCheckInText + '</div>' +
      '<div class="sum-sub"><span class="' + nextCheck.cls + '">' + nextCheck.summaryText + '</span></div>' +
    '</div>';

  container.appendChild(row);
}

function batColor(pct) {
  if (pct === null || pct === undefined || !isFinite(pct)) return 'var(--text-muted)';
  if (pct > 80) return 'var(--success)';
  if (pct < 30) return 'var(--danger)';
  if (pct <= 80) return 'var(--warning)';
  return 'var(--danger)';
}

// formatKB → provided by seaweed_common.js

