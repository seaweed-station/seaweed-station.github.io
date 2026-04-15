// station_render.js — Extracted from station.html (Sprint 6)
// Dashboard render, sensor cards, header, freshness, peaks table
"use strict";

// =====================================================================
// RENDER: FULL DASHBOARD (debounced — coalesces rapid startup calls)
// =====================================================================
var _renderTimer = null;
function formatDatasetEndUtcLabel(endMs) {
  if (!isFinite(endMs)) return '--';
  return new Date(endMs).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'UTC'
  }) + ' UTC';
}

function getStationDatasetRenderMeta(stationId) {
  if (typeof getStationDatasetState !== 'function') return null;
  var meta = getStationDatasetState(stationId);
  if (!meta || !meta.isActive) return null;
  meta.endLabel = formatDatasetEndUtcLabel(meta.endMs);
  return meta;
}

function renderDashboard() {
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(_renderDashboardCore, 120);
}
function _renderDashboardCore() {
  _renderTimer = null;
  var hasData = state.allEntries.length > 0;
  document.getElementById('emptyState').style.display      = hasData ? 'none' : 'block';
  document.getElementById('dashboardContent').style.display = hasData ? 'block' : 'none';
  document.getElementById('btnExportCSV').style.display     = hasData ? '' : 'none';
  if (!hasData) return;

  updateHeaderInfo();
  updateFreshnessBanner();
  updateSensorCards();
  createOrUpdateCharts();
  updateChartSubheads();
  updateTimeButtons();
  updatePeaksTable();

  // Fetch weather data
  fetchWeatherData();
}

// =====================================================================
// RENDER: SENSOR SUMMARY CARDS
// =====================================================================
function updateSensorCards() {
  var el = document.getElementById('sensorCards');
  if (!el) return;
  var all = state.allEntries;
  if (!all.length) { el.innerHTML = ''; return; }
  function finiteOrNull(v) {
    return (v !== null && v !== undefined && isFinite(Number(v))) ? Number(v) : null;
  }
  var nowMs = Date.now();
  var anchorMs = (typeof getStationAnalysisAnchorMs === 'function')
    ? getStationAnalysisAnchorMs(TABLE_ID, nowMs)
    : nowMs;
  var day24Ago = anchorMs - (24 * 3600000);
  var day7Ago = anchorMs - (7 * 24 * 3600000);
  var sensorColors = resolveSensorColors();
  var sensors = buildStationSensorDefinitions(TABLE_ID, all, _stationSlotMap, sensorColors);

  var html = '';
  sensors.forEach(function (s) {
    var hasData = all.some(function (x) { return x[s.tempKey] !== null || x[s.humKey] !== null; });
    if (!hasData) return; // skip sensors with no data at all

    // Per-sensor snapshot: latest available point for this sensor pair.
    var latestSensorRow = null;
    for (var ri = all.length - 1; ri >= 0; ri--) {
      var row = all[ri];
      if (row[s.tempKey] !== null || row[s.humKey] !== null) {
        latestSensorRow = row;
        break;
      }
    }

    // Headline values: peak over last 24h for this sensor.
    var temp = null, hum = null;
    all.forEach(function (x) {
      var ts = x.timestamp ? x.timestamp.getTime() : 0;
      if (ts < day24Ago) return;
      var t = finiteOrNull(x[s.tempKey]);
      var r = finiteOrNull(x[s.humKey]);
      if (t !== null && (temp === null || t > temp)) temp = t;
      if (r !== null && (hum === null || r > hum)) hum = r;
    });

    // If no 24h values, fall back to the latest sensor snapshot values.
    if (temp === null && latestSensorRow) temp = finiteOrNull(latestSensorRow[s.tempKey]);
    if (hum === null && latestSensorRow) hum = finiteOrNull(latestSensorRow[s.humKey]);

    // Ranges are always fixed to last 7 days.
    var tMin = null, tMax = null, rhMin = null, rhMax = null;
    all.forEach(function (x) {
      var ts = x.timestamp ? x.timestamp.getTime() : 0;
      if (ts < day7Ago) return;
      var t = finiteOrNull(x[s.tempKey]);
      var r = finiteOrNull(x[s.humKey]);
      if (t !== null) { if (tMin === null || t < tMin) tMin = t; if (tMax === null || t > tMax) tMax = t; }
      if (r !== null) { if (rhMin === null || r < rhMin) rhMin = r; if (rhMax === null || r > rhMax) rhMax = r; }
    });

    var hasSnapshot = temp !== null || hum !== null;
    var cardClass  = hasSnapshot ? 'ok'  : 'warn';
    var badgeClass = hasSnapshot ? 'badge-ok' : 'badge-warn';
    var badgeText  = hasSnapshot ? 'OK'  : 'NC';

    html += '<div class="status-card ' + cardClass + '">' +
      '<div class="card-header">' +
        '<h3 style="color:' + s.color + ';text-transform:none;font-size:.9rem;font-weight:700">' +
          s.sensorId + ' <span style="color:#888;font-weight:400;font-size:.85em">(' + s.shortLabel + ')</span>' +
        '</h3>' +
        '<span class="card-badge ' + badgeClass + '">' + badgeText + '</span>' +
      '</div>' +
      '<div class="sensor-readings">' +
        '<div class="reading-block">' +
          '<div class="big-number" style="color:' + s.color + '">' + (temp !== null ? temp.toFixed(1) + '\u00B0' : '--') + '</div>' +
          '<div class="big-label">24h Peak Temp</div>' +
        '</div>' +
        '<div class="reading-block">' +
          '<div class="big-number" style="font-size:1.6rem">' + (hum !== null ? hum.toFixed(1) + '%' : '--') + '</div>' +
          '<div class="big-label">24h Peak Humidity</div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-grid">' +
        '<div><div class="detail-label">7 Day Temp</div><div class="detail-value">' +
          (tMin !== null && tMax !== null ? tMin.toFixed(1) + ' \u2013 ' + tMax.toFixed(1) + '\u00B0C' : '--') +
        '</div></div>' +
        '<div><div class="detail-label">7 Day Humidity</div><div class="detail-value">' +
          (rhMin !== null && rhMax !== null ? rhMin.toFixed(1) + ' \u2013 ' + rhMax.toFixed(1) + '%' : '--') +
        '</div></div>' +
      '</div>' +
      '<div class="card-footer"><span class="dot ' + (latestSensorRow ? 'dot-green' : 'dot-grey') + '"></span>' +
        (latestSensorRow ? ('Snapshot ' + timeAgo(latestSensorRow.timestamp)) : 'Snapshot unavailable') +
      '</div>' +
    '</div>';
  });
  el.innerHTML = html;
}

// =====================================================================
// RENDER: HEADER INFO
// =====================================================================
function updateHeaderInfo() {
  var e = state.allEntries;
  document.getElementById('dataSourceLabel').textContent = state.dataSource;
  document.getElementById('entryCountLabel').textContent = e.length.toLocaleString();
  document.getElementById('channelLabel').textContent    = state.channelInfo ? state.channelInfo.id : '--';
  document.getElementById('footerChannel').textContent   = state.channelInfo ? String(state.channelInfo.id) : '';
  document.getElementById('tzLabel').textContent         = getTimezoneLabel();

  if (e.length) {
    document.getElementById('dateRangeLabel').textContent =
      fmtDate(e[0].timestamp) + ' \u2192 ' + fmtDate(e[e.length - 1].timestamp);
  }
}

function formatEtaFromMinutes(mins) {
  var abs = Math.max(0, Math.round(Math.abs(mins)));
  if (abs < 60) return abs + 'm';
  var h = Math.floor(abs / 60);
  var m = abs % 60;
  return m ? (h + 'h ' + m + 'm') : (h + 'h');
}

var NEXT_CHECK_PIPELINE_BUFFER_MIN = 12;

function estimateNextCheckIn(entries, preferredNextAt) {
  if (preferredNextAt && !isNaN(preferredNextAt.getTime())) {
    var statusDeltaMin = Math.round((preferredNextAt.getTime() - Date.now()) / 60000);
    var statusState = 'good';
    var statusWhen;
    if (statusDeltaMin >= 0) {
      statusState = 'good';
      statusWhen = 'in ' + formatEtaFromMinutes(statusDeltaMin);
    } else if (Math.abs(statusDeltaMin) <= NEXT_CHECK_PIPELINE_BUFFER_MIN) {
      statusState = 'warn';
      statusWhen = 'pending ingest';
    } else {
      statusState = 'late';
      statusWhen = 'overdue by ' + formatEtaFromMinutes(Math.abs(statusDeltaMin) - NEXT_CHECK_PIPELINE_BUFFER_MIN);
    }
    var statusAbs = preferredNextAt.toLocaleString('en-GB', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'UTC'
    });
    return { text: 'Next check in: ' + statusWhen + ' (' + statusAbs + ' UTC)', state: statusState };
  }

  if (!entries || entries.length < 2) {
    return { text: 'Next check in: --', state: 'unknown' };
  }

  var latest = entries[entries.length - 1].timestamp;
  if (!latest || isNaN(latest.getTime())) {
    return { text: 'Next check in: --', state: 'unknown' };
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
    return { text: 'Next check in: --', state: 'unknown' };
  }

  diffs.sort(function(a, b) { return a - b; });
  var cadenceMs = diffs[Math.floor(diffs.length / 2)];
  var nextAt = new Date(latest.getTime() + cadenceMs);
  var deltaMin = Math.round((nextAt.getTime() - Date.now()) / 60000);
  var state = 'good';
  var when;
  if (deltaMin >= 0) {
    state = 'good';
    when = 'in ' + formatEtaFromMinutes(deltaMin);
  } else if (Math.abs(deltaMin) <= NEXT_CHECK_PIPELINE_BUFFER_MIN) {
    state = 'warn';
    when = 'pending ingest';
  } else {
    state = 'late';
    when = 'overdue by ' + formatEtaFromMinutes(Math.abs(deltaMin) - NEXT_CHECK_PIPELINE_BUFFER_MIN);
  }
  var nextAbs = nextAt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'UTC'
  });
  return { text: 'Next check in: ' + when + ' (' + nextAbs + ' UTC)', state: state };
}

// =====================================================================
// RENDER: FRESHNESS BANNER
// =====================================================================
function updateFreshnessBanner() {
  var banner = document.getElementById('freshnessBanner');
  if (!state.allEntries.length) { banner.classList.remove('show'); return; }

  var datasetMeta = getStationDatasetRenderMeta(TABLE_ID);
  if (datasetMeta) {
    var pausedText = datasetMeta.statusLabel + ' since ' + datasetMeta.endLabel;
    if (datasetMeta.note) pausedText += ' -- ' + datasetMeta.note;
    banner.classList.add('show');
    banner.classList.remove('fresh', 'stale', 'old');
    banner.classList.add('paused');
    document.getElementById('freshnessIcon').textContent = '\u23F8\uFE0F';
    document.getElementById('freshnessText').textContent = pausedText;
    var pausedLabel = document.getElementById('nextCheckLabel');
    if (pausedLabel) {
      pausedLabel.textContent = datasetMeta.note || datasetMeta.pillLabel;
      pausedLabel.className = 'next-check-pill paused';
    }
    return;
  }

  var latest = state.allEntries[state.allEntries.length - 1].timestamp;
  var ageHrs = (Date.now() - latest.getTime()) / 3600000;
  var nextAt = state.deviceStatus && state.deviceStatus.nextCheckInAt ? state.deviceStatus.nextCheckInAt : null;
  var nextCheck = estimateNextCheckIn(state.allEntries, nextAt);

  banner.classList.add('show');
  banner.classList.remove('fresh', 'stale', 'old');

  var icon = document.getElementById('freshnessIcon');
  var text = document.getElementById('freshnessText');
  var nextCheckLabel = document.getElementById('nextCheckLabel');
  if (nextCheckLabel) {
    nextCheckLabel.textContent = nextCheck.text;
    nextCheckLabel.className = 'next-check-pill ' + (nextCheck.state || 'unknown');
  }

  if (ageHrs < 2) {
    banner.classList.add('fresh');
    icon.textContent = '\u2705';
    text.textContent = 'Data is fresh -- latest entry ' + timeAgo(latest);
  } else if (ageHrs < 24) {
    banner.classList.add('stale');
    icon.textContent = '\u26A0\uFE0F';
    text.textContent = 'Data is ' + timeAgo(latest) + ' old -- consider fetching latest';
  } else {
    banner.classList.add('old');
    icon.textContent = '\uD83D\uDD34';
    text.textContent = 'Data is ' + timeAgo(latest) + ' old -- fetch or run download_data.ps1';
  }
}

// =====================================================================
// RENDER: DAILY SUMMARY TABLE
// =====================================================================
var _dailySummaryVisibleDays = 14;

function loadMoreDailySummary() {
  _dailySummaryVisibleDays += 14;
  updatePeaksTable();
}

function updatePeaksTable() {
  var entries = (state.summaryEntries && state.summaryEntries.length) ? state.summaryEntries : state.allEntries;
  if (!entries.length) return;
  var datasetMeta = getStationDatasetRenderMeta(TABLE_ID);
  var datasetEndDayKey = datasetMeta ? datasetMeta.endDayKey : null;

  var byDay = {};
  entries.forEach(function (e) { var day = e.timestamp.toISOString().slice(0, 10); if (!byDay[day]) byDay[day] = []; byDay[day].push(e); });

  function fieldStats(dayEntries, key) {
    var vals = dayEntries.map(function (e) { return e[key]; }).filter(function (v) { return v !== null && v !== undefined; });
    if (!vals.length) return null;
    return { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), avg: vals.reduce(function (a, b) { return a + b; }, 0) / vals.length, count: vals.length };
  }

  // Use the shared slot-assignment model so all stations follow device_slots
  // instead of a hardcoded sat1/sat2 label map.
  var sensorDefs = buildStationSensorDefinitions(TABLE_ID, entries, _stationSlotMap, resolveSensorColors());
  var tempKeys = {};
  var humKeys = {};
  sensorDefs.forEach(function(def) {
    if (def.tempKey) tempKeys[def.tempKey] = def.sensorId;
    if (def.humKey) humKeys[def.humKey] = def.sensorId;
  });

  var activeTempKeys = {};
  for (var tk in tempKeys) { if (entries.some(function (e) { return e[tk] !== null && e[tk] !== undefined; })) activeTempKeys[tk] = tempKeys[tk]; }
  var activeHumKeys = {};
  for (var hk in humKeys) { if (entries.some(function (e) { return e[hk] !== null && e[hk] !== undefined; })) activeHumKeys[hk] = humKeys[hk]; }

  // Build Open-Meteo daily stats from weatherState.data
  var wxByDay = {};
  if (weatherState.data && weatherState.data.time) {
    var wxd = weatherState.data;
    for (var wi = 0; wi < wxd.time.length; wi++) {
      var wxDay = wxd.time[wi].slice(0, 10);
      if (!wxByDay[wxDay]) wxByDay[wxDay] = { temps: [], hums: [] };
      if (wxd.temperature_2m[wi] !== null && wxd.temperature_2m[wi] !== undefined)
        wxByDay[wxDay].temps.push(wxd.temperature_2m[wi]);
      if (wxd.relative_humidity_2m[wi] !== null && wxd.relative_humidity_2m[wi] !== undefined)
        wxByDay[wxDay].hums.push(wxd.relative_humidity_2m[wi]);
    }
  }
  var hasWx = Object.keys(wxByDay).length > 0;
  function wxArrStats(arr) {
    if (!arr || !arr.length) return null;
    return { min: Math.min.apply(null, arr), max: Math.max.apply(null, arr), avg: arr.reduce(function (a, b) { return a + b; }, 0) / arr.length };
  }

  var headHtml = '<tr><th>Date</th><th>Pts</th>';
  if (hasWx) headHtml += '<th style="color:#f59e0b;border-left:2px solid #475569">OM Temp</th>';
  for (var atk in activeTempKeys) headHtml += '<th>Temp ' + activeTempKeys[atk] + '</th>';
  if (hasWx) headHtml += '<th style="color:#06b6d4;border-left:2px solid #475569">OM Hum</th>';
  for (var ahk in activeHumKeys)  headHtml += '<th>Hum ' + activeHumKeys[ahk] + '</th>';
  headHtml += '</tr>';
  document.getElementById('peaksHead').innerHTML = headHtml;

  var days = Object.keys(byDay).sort().reverse();
  var visibleDays = days.slice(0, _dailySummaryVisibleDays);

  // Pre-compute stats for every cell
  var dayStats = {};
  for (var di = 0; di < visibleDays.length; di++) {
    var day = visibleDays[di];
    var de  = byDay[day];
    dayStats[day] = { temp: {}, hum: {} };
    for (var atk3 in activeTempKeys) dayStats[day].temp[atk3] = fieldStats(de, atk3);
    for (var ahk3 in activeHumKeys)  dayStats[day].hum[ahk3]  = fieldStats(de, ahk3);
  }

  // Per-row highlight: find which cell holds the single lowest min / highest avg / highest max
  // Temps and humidities are highlighted independently (different scales)
  function rowExtremes(statsMap) {
    var rowMin = Infinity, rowMaxAvg = -Infinity, rowMaxMax = -Infinity;
    var minKey = null, avgKey = null, maxKey = null;
    for (var k in statsMap) {
      var s = statsMap[k];
      if (!s) continue;
      if (s.min < rowMin)       { rowMin = s.min;       minKey = k; }
      if (s.avg > rowMaxAvg)    { rowMaxAvg = s.avg;    avgKey = k; }
      if (s.max > rowMaxMax)    { rowMaxMax = s.max;    maxKey = k; }
    }
    return { minKey: minKey, avgKey: avgKey, maxKey: maxKey };
  }

  function fmtCell(stats, isMinRow, isAvgRow, isMaxRow) {
    if (!stats) return '<td class="peaks-nc">--</td>';
    var minSpan = '<span' + (isMinRow ? ' class="hl-min"' : '') + '>' + stats.min.toFixed(1) + '</span>';
    var avgSpan = '<span' + (isAvgRow ? ' class="hl-avg"' : '') + '>' + stats.avg.toFixed(1) + '</span>';
    var maxSpan = '<span' + (isMaxRow ? ' class="hl-max"' : '') + '>' + stats.max.toFixed(1) + '</span>';
    return '<td>' + minSpan + ' / ' + avgSpan + ' / ' + maxSpan + '</td>';
  }

  function fmtWxCell(stats, borderStyle) {
    var tdStyle = borderStyle ? ' style="' + borderStyle + '"' : '';
    if (!stats) return '<td class="peaks-nc"' + tdStyle + '>--</td>';
    return '<td' + tdStyle + '>' + stats.min.toFixed(1) + ' / ' + stats.avg.toFixed(1) + ' / ' + stats.max.toFixed(1) + '</td>';
  }

  var bodyHtml = '';
  for (var di2 = 0; di2 < visibleDays.length; di2++) {
    var day2   = visibleDays[di2];
    var de2    = byDay[day2];
    var dl2    = new Date(day2 + 'T00:00:00Z');
    var dateLabel2 = dl2.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', weekday: 'short' });
    if (datasetEndDayKey && day2 === datasetEndDayKey) {
      dateLabel2 += ' <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:var(--warning-dim);color:var(--warning);font-size:0.68rem;font-weight:700">' + escHtml(datasetMeta.pillLabel) + '</span>';
    }
    bodyHtml += '<tr><td>' + dateLabel2 + '</td><td>' + de2.length + '</td>';

    if (hasWx) {
      var wxDayData = wxByDay[day2];
      bodyHtml += fmtWxCell(wxArrStats(wxDayData ? wxDayData.temps : []), 'border-left:2px solid #475569;color:#f59e0b');
    }

    var tEx = rowExtremes(dayStats[day2].temp);
    var hEx = rowExtremes(dayStats[day2].hum);

    for (var atk4 in activeTempKeys) {
      bodyHtml += fmtCell(dayStats[day2].temp[atk4],
        atk4 === tEx.minKey, atk4 === tEx.avgKey, atk4 === tEx.maxKey);
    }

    if (hasWx) {
      var wxDayData2 = wxByDay[day2];
      bodyHtml += fmtWxCell(wxArrStats(wxDayData2 ? wxDayData2.hums : []), 'border-left:2px solid #475569;color:#06b6d4');
    }

    for (var ahk4 in activeHumKeys) {
      bodyHtml += fmtCell(dayStats[day2].hum[ahk4],
        ahk4 === hEx.minKey, ahk4 === hEx.avgKey, ahk4 === hEx.maxKey);
    }
    bodyHtml += '</tr>';
  }

  var totalCols = 2 + Object.keys(activeTempKeys).length + Object.keys(activeHumKeys).length + (hasWx ? 2 : 0);
  if (totalCols === 2) {
    bodyHtml += '<tr><td colspan="2" class="peaks-nc" style="text-align:center;padding:20px">No sensor data available yet</td></tr>';
  }

  document.getElementById('peaksBody').innerHTML = bodyHtml;

  var pagerLabel = document.getElementById('peaksPagerLabel');
  if (pagerLabel) {
    var shown = Math.min(_dailySummaryVisibleDays, days.length);
    var pagerText = 'Showing latest ' + shown + ' of ' + days.length + ' logged days';
    if (datasetMeta) {
      pagerText += ' -- ' + datasetMeta.statusLabel + ' on ' + datasetMeta.endLabel;
      if (datasetMeta.note) pagerText += ' (' + datasetMeta.note + ')';
    }
    pagerLabel.textContent = pagerText;
  }

  var loadMoreBtn = document.getElementById('peaksLoadMoreBtn');
  if (loadMoreBtn) {
    var hasMore = days.length > _dailySummaryVisibleDays;
    loadMoreBtn.style.display = hasMore ? '' : 'none';
    if (hasMore) {
      var remaining = days.length - _dailySummaryVisibleDays;
      loadMoreBtn.textContent = 'Load next ' + Math.min(14, remaining) + ' days ↓';
    }
  }
}
