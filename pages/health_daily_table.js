// health_daily_table.js — Extracted from station_health.html (Sprint 6)
// Daily health summary table: per-day stats, firmware, battery trend

function renderDailyHealth(container, entries, stationId) {
  if (!entries.length) return;
  if (!_stationLogsVisibleDays[stationId] || _stationLogsVisibleDays[stationId] < STATION_LOG_ROWS_STEP) {
    _stationLogsVisibleDays[stationId] = STATION_LOG_ROWS_STEP;
  }
  var slot1Enabled = isSatelliteVisible(stationId, entries, 1);
  var slot2Enabled = isSatelliteVisible(stationId, entries, 2);
  var slot1Label = satelliteDisplayName(stationId, 1);
  var slot2Label = satelliteDisplayName(stationId, 2);
  var slot1Node = satelliteNodeLetter(stationId, 1);
  var slot2Node = satelliteNodeLetter(stationId, 2);
  var syncRowsAll = Array.isArray(_stationSyncTimeline[stationId]) ? _stationSyncTimeline[stationId] : [];
  var uploadRowsAll = Array.isArray(_stationUploadTimeline[stationId]) ? _stationUploadTimeline[stationId] : [];
  var configRow = stationId ? (_deviceConfigById[stationId] || null) : null;

  var byDay = {};
  entries.forEach(function(e) {
    // Group by station-local date
    var day = stationId ? stationLocalDay(e.timestamp, stationId) : e.timestamp.toISOString().slice(0,10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(e);
  });

  var wrap = document.createElement('div');
  wrap.className = 'health-table-wrap';

  function num(v) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return null;
    return Number(v);
  }

  function median(arr) {
    if (!arr || !arr.length) return null;
    var copy = arr.slice().sort(function(a, b) { return a - b; });
    return copy[Math.floor(copy.length / 2)];
  }

  function mode(arr) {
    if (!arr || !arr.length) return null;
    var counts = Object.create(null);
    var bestKey = null;
    var bestCount = -1;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined || !isFinite(v)) continue;
      var k = String(v);
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > bestCount) {
        bestCount = counts[k];
        bestKey = k;
      }
    }
    return bestKey == null ? null : Number(bestKey);
  }

  function fmtPeriodSeconds(sec) {
    if (sec == null || !isFinite(sec) || sec <= 0) return '--';
    if (sec % 3600 === 0) return (sec / 3600) + 'h';
    if (sec % 60 === 0) return (sec / 60) + 'm';
    return sec + 's';
  }

  function fmtPeriodMs(ms) {
    if (ms == null || !isFinite(ms) || ms <= 0) return '--';
    return fmtPeriodSeconds(Math.round(ms / 1000));
  }

  function medianIntervalMs(rows, tsGetter) {
    if (!rows || rows.length < 2) return null;
    var ts = rows.map(tsGetter).filter(function(v) { return v != null && isFinite(v); }).sort(function(a, b) { return a - b; });
    if (ts.length < 2) return null;
    var diffs = [];
    for (var i = 1; i < ts.length; i++) {
      var d = ts[i] - ts[i - 1];
      if (d > 0 && d <= 48 * 3600000) diffs.push(d);
    }
    return median(diffs);
  }

  var globalT0IntervalMs = medianIntervalMs(entries, function(r) { return r.timestamp ? r.timestamp.getTime() : null; });
  var globalUploadIntervalMs = medianIntervalMs(uploadRowsAll, function(r) {
    return r && r.upload_started_at ? new Date(ensureUTC(r.upload_started_at)).getTime() : null;
  });

  var samplePeriodEvents = syncRowsAll.map(function(r) {
    var ts = r && r.sync_started_at ? new Date(ensureUTC(r.sync_started_at)).getTime() : NaN;
    var min = num(r && r.sample_period_min);
    var sec = min != null ? min * 60 : null;
    if (!isFinite(ts) || sec == null || !isFinite(sec) || sec <= 0) return null;
    return { ts: ts, v: sec };
  }).filter(function(x) { return !!x; }).sort(function(a, b) { return a.ts - b.ts; });

  function dominantValueForDay(events, dayStart, dayEnd, defaultValue) {
    if (!events || !events.length) return defaultValue == null ? null : defaultValue;

    var current = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].ts <= dayStart) current = events[i].v;
      else break;
    }
    if (current == null) {
      for (var j = 0; j < events.length; j++) {
        if (events[j].ts >= dayStart && events[j].ts < dayEnd) {
          current = events[j].v;
          break;
        }
      }
    }
    if (current == null) current = defaultValue;
    if (current == null) return null;

    var durationByVal = Object.create(null);
    var cursor = dayStart;
    for (var k = 0; k < events.length; k++) {
      var ev = events[k];
      if (ev.ts <= dayStart || ev.ts >= dayEnd) continue;
      if (ev.ts > cursor) {
        var keyPrev = String(current);
        durationByVal[keyPrev] = (durationByVal[keyPrev] || 0) + (ev.ts - cursor);
        cursor = ev.ts;
      }
      current = ev.v;
    }
    if (dayEnd > cursor) {
      var keyTail = String(current);
      durationByVal[keyTail] = (durationByVal[keyTail] || 0) + (dayEnd - cursor);
    }

    var bestVal = null;
    var bestDuration = -1;
    var keys = Object.keys(durationByVal);
    for (var m = 0; m < keys.length; m++) {
      var key = keys[m];
      var dur = durationByVal[key] || 0;
      if (dur > bestDuration) {
        bestDuration = dur;
        bestVal = Number(key);
      }
    }
    if (bestVal != null && isFinite(bestVal)) return bestVal;
    return defaultValue == null ? null : defaultValue;
  }
  var cfgBulkFreqHours = configRow ? (num(configRow.upload_interval_hours) || num(configRow.bulk_freq_hours)) : null;
  var uploadBulkEvents = uploadRowsAll.map(function(r) {
    var ts = r && r.upload_started_at ? new Date(ensureUTC(r.upload_started_at)).getTime() : NaN;
    var h = num(r && r.applied_upload_interval_hours);
    if (!isFinite(ts) || h == null || !isFinite(h) || h <= 0) return null;
    return { ts: ts, h: h };
  }).filter(function(x) { return !!x; }).sort(function(a, b) { return a.ts - b.ts; });

  function dominantBulkFreqHoursForDay(dayStart, dayEnd) {
    if (!uploadBulkEvents.length) return cfgBulkFreqHours || null;

    var current = null;
    for (var i = 0; i < uploadBulkEvents.length; i++) {
      if (uploadBulkEvents[i].ts <= dayStart) current = uploadBulkEvents[i].h;
      else break;
    }
    if (current == null) {
      for (var j = 0; j < uploadBulkEvents.length; j++) {
        if (uploadBulkEvents[j].ts >= dayStart && uploadBulkEvents[j].ts < dayEnd) {
          current = uploadBulkEvents[j].h;
          break;
        }
      }
    }
    if (current == null) current = cfgBulkFreqHours || uploadBulkEvents[uploadBulkEvents.length - 1].h;
    if (current == null) return null;

    var durationByHours = Object.create(null);
    var cursor = dayStart;
    for (var k = 0; k < uploadBulkEvents.length; k++) {
      var ev = uploadBulkEvents[k];
      if (ev.ts <= dayStart || ev.ts >= dayEnd) continue;
      if (ev.ts > cursor) {
        var keyPrev = String(current);
        durationByHours[keyPrev] = (durationByHours[keyPrev] || 0) + (ev.ts - cursor);
        cursor = ev.ts;
      }
      current = ev.h;
    }
    if (dayEnd > cursor) {
      var keyTail = String(current);
      durationByHours[keyTail] = (durationByHours[keyTail] || 0) + (dayEnd - cursor);
    }

    var bestHours = null;
    var bestDuration = -1;
    var keys = Object.keys(durationByHours);
    for (var m = 0; m < keys.length; m++) {
      var key = keys[m];
      var dur = durationByHours[key] || 0;
      if (dur > bestDuration) {
        bestDuration = dur;
        bestHours = Number(key);
      }
    }
    return (bestHours != null && isFinite(bestHours) && bestHours > 0) ? bestHours : null;
  }

  function expectedPerDayFromIntervalMs(ms) {
    if (!ms || !isFinite(ms) || ms <= 0) return null;
    return Math.max(1, Math.round(86400000 / ms));
  }

  function expectedCountForWindow(periodSec, windowMs) {
    if (periodSec == null || !isFinite(periodSec) || periodSec <= 0) return null;
    if (windowMs == null || !isFinite(windowMs) || windowMs <= 0) return 0;
    return Math.max(0, Math.floor(windowMs / (periodSec * 1000)));
  }

  function avg(arr) {
    if (!arr || !arr.length) return null;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function fmtCount(actual, expected) {
    return String(actual) + '/' + (expected != null ? String(expected) : '--');
  }

  function fmtLostTime(received, expected, periodSec) {
    if (expected == null || !isFinite(expected) || periodSec == null || !isFinite(periodSec) || periodSec <= 0) return '--';
    var gap = Math.max(0, Math.round(expected - received));
    var totalSec = gap * periodSec;
    if (totalSec <= 0) return '0m';
    var h = Math.floor(totalSec / 3600);
    var m = Math.round((totalSec % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    if (h > 0 && m > 0) return h + 'h ' + m + 'm';
    if (h > 0) return h + 'h';
    return m + 'm';
  }

  function isUploadSuccess(row) {
    if (!row) return false;
    var okNum = num(row.upload_ok);
    if (okNum != null) return okNum > 0;
    var s = String(row.status || '').trim().toLowerCase();
    if (!s) return false;
    return s === 'ok' || s === 'success' || s === 'succeeded' || s === 'complete' || s === 'completed';
  }

  function isSyncSuccess(row) {
    if (!row) return false;
    var okNum = num(row.sync_ok);
    if (okNum != null) return okNum > 0;
    var s = String(row.status || '').trim().toLowerCase();
    if (!s) return false;
    return s === 'ok' || s === 'success' || s === 'succeeded' || s === 'complete' || s === 'completed';
  }

  function fmtOkAttempts(okCount, attempts) {
    return String(okCount) + '/' + String(attempts);
  }

  function fmtAvgMax(arr, suffix, invertMax) {
    if (!arr || !arr.length) return '--';
    var a = avg(arr);
    var m = invertMax ? Math.max.apply(null, arr) : Math.max.apply(null, arr);
    var aStr = a != null ? a.toFixed(1) : '--';
    var mStr = m != null ? m.toFixed(0) : '--';
    return aStr + '/' + mStr + (suffix || '');
  }

  function fmtAvgMaxWithOutliers(arr, suffix, maxValidAbs) {
    if (!arr || !arr.length) return '--';
    var kept = [];
    var dropped = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v == null || !isFinite(v)) continue;
      if (maxValidAbs != null && Math.abs(v) > maxValidAbs) {
        dropped++;
      } else {
        kept.push(v);
      }
    }
    var base = fmtAvgMax(kept, suffix, false);
    if (dropped > 0) base += ' !' + dropped;
    return base;
  }

  function fmtMs(sumMs) {
    if (!sumMs || !isFinite(sumMs) || sumMs <= 0) return '--';
    var sec = Math.round(sumMs / 1000);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  function fmtFwValue(v) {
    var s = String(v || '').trim();
    if (!s) return '--';
    var label = /^v/i.test(s) ? s : ('v' + s);
    return escHtml(label);
  }

  function latestFwForDay(dayEntries, allEntries, key, dayEndMs) {
    var i;
    for (i = dayEntries.length - 1; i >= 0; i--) {
      var vDay = dayEntries[i] && dayEntries[i][key];
      if (vDay != null && String(vDay).trim() !== '') return String(vDay).trim();
    }
    for (i = allEntries.length - 1; i >= 0; i--) {
      var eAll = allEntries[i];
      if (!eAll || !eAll.timestamp) continue;
      var ts = eAll.timestamp instanceof Date ? eAll.timestamp.getTime() : new Date(eAll.timestamp).getTime();
      if (!isFinite(ts) || ts >= dayEndMs) continue;
      var vAll = eAll[key];
      if (vAll != null && String(vAll).trim() !== '') return String(vAll).trim();
    }
    return null;
  }

  function latestSyncFwForNode(daySyncRows, allSyncRows, nodeLetter, dayEndMs) {
    if (!nodeLetter) return null;
    var node = String(nodeLetter).toUpperCase();
    var i;
    for (i = daySyncRows.length - 1; i >= 0; i--) {
      var rDay = daySyncRows[i] || {};
      if (String(rDay.node_id || '').toUpperCase() !== node) continue;
      var vDay = rDay.sat_fw_ver;
      if (vDay != null && String(vDay).trim() !== '') return String(vDay).trim();
    }
    for (i = allSyncRows.length - 1; i >= 0; i--) {
      var rAll = allSyncRows[i] || {};
      var tsAll = rAll.sync_started_at ? new Date(ensureUTC(rAll.sync_started_at)).getTime() : NaN;
      if (!isFinite(tsAll) || tsAll >= dayEndMs) continue;
      if (String(rAll.node_id || '').toUpperCase() !== node) continue;
      var vAll = rAll.sat_fw_ver;
      if (vAll != null && String(vAll).trim() !== '') return String(vAll).trim();
    }
    return null;
  }

  function batteryTrend(arr, key) {
    var first = arr.find(function(e) { return e[key] !== null && e[key] !== undefined && !isNaN(e[key]); });
    var last = arr.slice().reverse().find(function(e) { return e[key] !== null && e[key] !== undefined && !isNaN(e[key]); });
    if (!first || !last) return '<span style="color:var(--text-muted)">--</span>';

    var a = Number(first[key]);
    var b = Number(last[key]);
    var d = b - a;
    var arrow = d > 0.5 ? '\u2197' : d < -0.5 ? '\u2198' : '\u2192';
    var color = d < -10 ? 'var(--danger)' : d < -3 ? 'var(--warning)' : (d > 1 ? 'var(--success)' : 'var(--text)');
    return '<span style="color:' + color + '">' + a.toFixed(0) + arrow + b.toFixed(0) + '</span>';
  }

  var batteryCols = 1 + (slot1Enabled ? 1 : 0) + (slot2Enabled ? 1 : 0);
  var sampleCols = 1 + (slot1Enabled ? 1 : 0) + (slot2Enabled ? 1 : 0);
  var gapCols = 1 + (slot1Enabled ? 1 : 0) + (slot2Enabled ? 1 : 0);
  var uploadCols = 1 + (slot1Enabled ? 1 : 0) + (slot2Enabled ? 1 : 0);
  var radioCols = 1 + (slot1Enabled ? 1 : 0) + (slot2Enabled ? 1 : 0);
  var driftCols = 1 + (slot1Enabled ? 1 : 0) + (slot2Enabled ? 1 : 0);
  var durationCols = 1 + (slot1Enabled ? 1 : 0) + (slot2Enabled ? 1 : 0);
  var dataCols = sampleCols + gapCols;
  var radioSyncCols = uploadCols + radioCols + driftCols + durationCols;

  var groupTh = function(label, span, cls) {
    return '<th colspan="' + span + '" class="group-head ' + cls + '">' + label + '</th>';
  };

  var html = '<table class="health-table"><thead>' +
    '<tr>' +
      '<th rowspan="2">Date</th>' +
      groupTh('Configuration', 6, 'grp-config') +
      groupTh('Battery', batteryCols, 'grp-battery group-start') +
      groupTh('Data', dataCols, 'grp-data group-start') +
      groupTh('Radio and Satellite Syncs', radioSyncCols, 'grp-radio group-start') +
    '</tr>' +
    '<tr>' +
      '<th class="grp-config">Sample Period<br><span style="font-weight:400">(min)</span></th><th class="grp-config">Upload Freq<br><span style="font-weight:400">(hours)</span></th><th class="grp-config">Sat Sync Freq<br><span style="font-weight:400">(hours)</span></th><th class="grp-config">T0 FW</th><th class="grp-config">Satellite FW</th><th class="grp-config">Slot Mapping</th>' +
      '<th class="grp-battery group-start">T0 Bat<br><span style="font-weight:400">(%)</span></th>' + (slot1Enabled ? '<th class="grp-battery">' + slot1Label + ' Bat<br><span style="font-weight:400">(%)</span></th>' : '') + (slot2Enabled ? '<th class="grp-battery">' + slot2Label + ' Bat<br><span style="font-weight:400">(%)</span></th>' : '') +
      '<th class="grp-data group-start">T0 Samples<br><span style="font-weight:400">(sync rec/exp)</span></th>' +
      (slot1Enabled ? '<th class="grp-data">' + slot1Label + ' Samples<br><span style="font-weight:400">(sync rec/exp)</span></th>' : '') +
      (slot2Enabled ? '<th class="grp-data">' + slot2Label + ' Samples<br><span style="font-weight:400">(sync rec/exp)</span></th>' : '') +
      '<th class="grp-data">T0 Lost Time<br><span style="font-weight:400">(period-based)</span></th>' +
      (slot1Enabled ? '<th class="grp-data">' + slot1Label + ' Lost Time<br><span style="font-weight:400">(period-based)</span></th>' : '') +
      (slot2Enabled ? '<th class="grp-data">' + slot2Label + ' Lost Time<br><span style="font-weight:400">(period-based)</span></th>' : '') +
      '<th class="grp-radio group-start">T0 Uploads<br><span style="font-weight:400">(ok/attempts)</span></th>' +
      (slot1Enabled ? '<th class="grp-radio">' + slot1Label + ' Syncs<br><span style="font-weight:400">(ok/attempts)</span></th>' : '') +
      (slot2Enabled ? '<th class="grp-radio">' + slot2Label + ' Syncs<br><span style="font-weight:400">(ok/attempts)</span></th>' : '') +
      '<th class="grp-radio">T0 CSQ<br><span style="font-weight:400">(avg/max)</span></th>' +
      (slot1Enabled ? '<th class="grp-radio">' + slot1Label + ' RSSI<br><span style="font-weight:400">(avg/max)</span></th>' : '') +
      (slot2Enabled ? '<th class="grp-radio">' + slot2Label + ' RSSI<br><span style="font-weight:400">(avg/max)</span></th>' : '') +
      '<th class="grp-radio">T0 Drift<br><span style="font-weight:400">(avg/max)</span></th>' +
      (slot1Enabled ? '<th class="grp-radio">' + slot1Label + ' Drift<br><span style="font-weight:400">(avg/max)</span></th>' : '') +
      (slot2Enabled ? '<th class="grp-radio">' + slot2Label + ' Drift<br><span style="font-weight:400">(avg/max)</span></th>' : '') +
      '<th class="grp-radio">T0 Upload Time</th>' + (slot1Enabled ? '<th class="grp-radio">' + slot1Label + ' Sync Time</th>' : '') + (slot2Enabled ? '<th class="grp-radio">' + slot2Label + ' Sync Time</th>' : '') +
    '</tr>' +
    '</thead><tbody>';

  var allDays = Object.keys(byDay).sort().reverse();
  var visibleDays = Math.max(STATION_LOG_ROWS_STEP, Number(_stationLogsVisibleDays[stationId]) || STATION_LOG_ROWS_STEP);
  var days = allDays.slice(0, visibleDays);
  var nowMs = Date.now();

  for (var di = 0; di < days.length; di++) {
    var day = days[di];
    var de  = byDay[day];
    var dl  = new Date(day + 'T12:00:00Z'); // noon UTC avoids day-boundary shifts
    var tz  = stationId ? stationTz(stationId) : undefined;
    var dateLabel = dl.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', weekday: 'short' });

    var dayStart = Date.parse(day + 'T00:00:00Z');
    var dayEnd = dayStart + 24 * 3600000;
    var dayEvalEnd = Math.min(dayEnd, nowMs);
    var dayWindowMs = Math.max(0, dayEvalEnd - dayStart);

    var daySyncRows = syncRowsAll.filter(function(r) {
      var t = r && r.sync_started_at ? new Date(ensureUTC(r.sync_started_at)).getTime() : NaN;
      return isFinite(t) && t >= dayStart && t < dayEnd;
    });
    var dayUploadRows = uploadRowsAll.filter(function(r) {
      var t = r && r.upload_started_at ? new Date(ensureUTC(r.upload_started_at)).getTime() : NaN;
      return isFinite(t) && t >= dayStart && t < dayEnd;
    });

    // Majority config values for the day (fallback to global medians).
    var daySamplePeriods = daySyncRows.map(function(r) { var m = num(r.sample_period_min); return m != null ? m * 60 : null; }).filter(function(v) { return v && v > 0; });
    var daySyncPeriods = daySyncRows.map(function(r) { var m = num(r.sync_period_min); return m != null ? m * 60 : null; }).filter(function(v) { return v && v > 0; });
    var cfgSampleSec = dominantValueForDay(samplePeriodEvents, dayStart, dayEnd, mode(daySamplePeriods));
    var cfgSyncSec = mode(daySyncPeriods);

    var dayUploadIntervals = [];
    for (var ui = 0; ui < dayUploadRows.length; ui++) {
      var curTs = new Date(ensureUTC(dayUploadRows[ui].upload_started_at)).getTime();
      if (!isFinite(curTs)) continue;
      var prevTs = null;
      for (var pj = uploadRowsAll.length - 1; pj >= 0; pj--) {
        var tPrev = uploadRowsAll[pj] && uploadRowsAll[pj].upload_started_at
          ? new Date(ensureUTC(uploadRowsAll[pj].upload_started_at)).getTime()
          : NaN;
        if (!isFinite(tPrev) || tPrev >= curTs) continue;
        prevTs = tPrev;
        break;
      }
      if (prevTs != null) {
        var dUp = curTs - prevTs;
        if (dUp > 0 && dUp <= 24 * 3600000) dayUploadIntervals.push(Math.round(dUp / 60000) * 60000);
      }
    }
    var effectiveBulkFreqHours = dominantBulkFreqHoursForDay(dayStart, dayEnd);
    var cfgUploadMs = effectiveBulkFreqHours
      ? Math.round(effectiveBulkFreqHours * 3600000)
      : (mode(dayUploadIntervals) || globalUploadIntervalMs);

    var dayT0Fw = fmtFwValue(latestFwForDay(de, entries, 't0FwVersion', dayEnd));
    var daySlot1Fw = fmtFwValue(
      latestSyncFwForNode(daySyncRows, syncRowsAll, slot1Node, dayEnd) ||
      latestFwForDay(de, entries, 'sat1FwVersion', dayEnd)
    );
    var daySlot2Fw = fmtFwValue(
      latestSyncFwForNode(daySyncRows, syncRowsAll, slot2Node, dayEnd) ||
      latestFwForDay(de, entries, 'sat2FwVersion', dayEnd)
    );
    var daySatFw = '--';
    if (slot1Enabled && slot2Enabled) daySatFw = slot1Label + ' ' + daySlot1Fw + ' | ' + slot2Label + ' ' + daySlot2Fw;
    else if (slot1Enabled) daySatFw = daySlot1Fw;
    else if (slot2Enabled) daySatFw = daySlot2Fw;

    var slotMapText = '--';
    if (slot1Enabled || slot2Enabled) {
      var mapParts = [];
      if (slot1Enabled) mapParts.push(slot1Label + ' Node ' + (slot1Node || '?'));
      if (slot2Enabled) mapParts.push(slot2Label + ' Node ' + (slot2Node || '?'));
      slotMapText = mapParts.join(' | ');
    }

    var t0SamplesActual = de.length;
    var dayT0IntervalMs = medianIntervalMs(de, function(r) { return r.timestamp ? r.timestamp.getTime() : null; });
    var effectiveSampleSec = cfgSampleSec || (dayT0IntervalMs ? Math.round(dayT0IntervalMs / 1000) : (globalT0IntervalMs ? Math.round(globalT0IntervalMs / 1000) : null));
    var t0SamplesExpected = expectedCountForWindow(effectiveSampleSec, dayWindowMs);
    if (t0SamplesExpected == null) {
      t0SamplesExpected = expectedPerDayFromIntervalMs(effectiveSampleSec ? effectiveSampleSec * 1000 : (dayT0IntervalMs || globalT0IntervalMs));
    }

    var nodeADay = daySyncRows.filter(function(r) {
      return slot1Node && String((r && r.node_id) || '').toUpperCase() === slot1Node;
    });
    var nodeBDay = daySyncRows.filter(function(r) {
      return slot2Node && String((r && r.node_id) || '').toUpperCase() === slot2Node;
    });

    var slot1SamplesActual = nodeADay.reduce(function(acc, r) {
      var v = num(r.received_total);
      if (v == null) v = num(r.persisted_sd);
      if (v == null) v = (num(r.received_live) || 0) + (num(r.received_file_rows) || 0);
      return acc + (v || 0);
    }, 0);
    var slot1SamplesExpected = nodeADay.reduce(function(acc, r) { return acc + (num(r.expected_samples) || 0); }, 0);

    var slot2SamplesActual = nodeBDay.reduce(function(acc, r) {
      var v = num(r.received_total);
      if (v == null) v = num(r.persisted_sd);
      if (v == null) v = (num(r.received_live) || 0) + (num(r.received_file_rows) || 0);
      return acc + (v || 0);
    }, 0);
    var slot2SamplesExpected = nodeBDay.reduce(function(acc, r) { return acc + (num(r.expected_samples) || 0); }, 0);

    var periodBasedExpected = expectedCountForWindow(effectiveSampleSec, dayWindowMs);
    var t0LostTime = fmtLostTime(t0SamplesActual, periodBasedExpected, effectiveSampleSec);
    var slot1LostTime = fmtLostTime(slot1SamplesActual, periodBasedExpected, effectiveSampleSec);
    var slot2LostTime = fmtLostTime(slot2SamplesActual, periodBasedExpected, effectiveSampleSec);

    var t0UploadsActual = dayUploadRows.length;
    var t0UploadsOk = dayUploadRows.filter(isUploadSuccess).length;
    var slot1SyncActual = nodeADay.length;
    var slot1SyncOk = nodeADay.filter(isSyncSuccess).length;
    var slot2SyncActual = nodeBDay.length;
    var slot2SyncOk = nodeBDay.filter(isSyncSuccess).length;

    var csqVals = dayUploadRows.map(function(r) { return num(r.csq); }).filter(function(v) { return v != null && v >= 0; });
    var slot1RssiVals = nodeADay.map(function(r) { return num(r.sat_rssi_avg); }).filter(function(v) { return v != null && v !== 0; });
    var slot2RssiVals = nodeBDay.map(function(r) { return num(r.sat_rssi_avg); }).filter(function(v) { return v != null && v !== 0; });

    var t0DriftVals = dayUploadRows.map(function(r) {
      var v = num(r.abs_time_resync_drift_s);
      if (v == null) v = num(r.t0_sync_drift_s);
      return v == null ? null : Math.abs(v);
    }).filter(function(v) { return v != null; });
    var slot1DriftVals = nodeADay.map(function(r) {
      var v = num(r.sat_drift_s);
      return v == null ? null : Math.abs(v);
    }).filter(function(v) { return v != null; });
    var slot2DriftVals = nodeBDay.map(function(r) {
      var v = num(r.sat_drift_s);
      return v == null ? null : Math.abs(v);
    }).filter(function(v) { return v != null; });

    var t0UploadMs = dayUploadRows.reduce(function(acc, r) { return acc + (num(r.upload_duration_ms) || 0); }, 0);
    var slot1SyncMs = nodeADay.reduce(function(acc, r) { return acc + (num(r.sync_duration_ms) || 0); }, 0);
    var slot2SyncMs = nodeBDay.reduce(function(acc, r) { return acc + (num(r.sync_duration_ms) || 0); }, 0);

    html += '<tr>' +
      '<td>' + dateLabel + '</td>' +
      '<td class="grp-config">' + fmtPeriodSeconds(cfgSampleSec) + '</td>' +
      '<td class="grp-config">' + fmtPeriodMs(cfgUploadMs) + '</td>' +
      '<td class="grp-config">' + fmtPeriodSeconds(cfgSyncSec) + '</td>' +
      '<td class="grp-config">' + dayT0Fw + '</td>' +
      '<td class="grp-config">' + daySatFw + '</td>' +
      '<td class="grp-config">' + slotMapText + '</td>' +
      '<td class="grp-battery group-start">' + batteryTrend(de, 't0BatPct') + '</td>' +
      (slot1Enabled ? '<td class="grp-battery">' + batteryTrend(de, 'sat1BatPct') + '</td>' : '') +
      (slot2Enabled ? '<td class="grp-battery">' + batteryTrend(de, 'sat2BatPct') + '</td>' : '') +
      '<td class="grp-data group-start">' + fmtCount(t0SamplesActual, t0SamplesExpected) + '</td>' +
      (slot1Enabled ? '<td class="grp-data">' + fmtCount(slot1SamplesActual, slot1SamplesExpected || null) + '</td>' : '') +
      (slot2Enabled ? '<td class="grp-data">' + fmtCount(slot2SamplesActual, slot2SamplesExpected || null) + '</td>' : '') +
      '<td class="grp-data">' + t0LostTime + '</td>' +
      (slot1Enabled ? '<td class="grp-data">' + slot1LostTime + '</td>' : '') +
      (slot2Enabled ? '<td class="grp-data">' + slot2LostTime + '</td>' : '') +
      '<td class="grp-radio group-start">' + fmtOkAttempts(t0UploadsOk, t0UploadsActual) + '</td>' +
      (slot1Enabled ? '<td class="grp-radio">' + fmtOkAttempts(slot1SyncOk, slot1SyncActual) + '</td>' : '') +
      (slot2Enabled ? '<td class="grp-radio">' + fmtOkAttempts(slot2SyncOk, slot2SyncActual) + '</td>' : '') +
      '<td class="grp-radio">' + fmtAvgMax(csqVals, '', false) + '</td>' +
      (slot1Enabled ? '<td class="grp-radio">' + fmtAvgMax(slot1RssiVals, '', false) + '</td>' : '') +
      (slot2Enabled ? '<td class="grp-radio">' + fmtAvgMax(slot2RssiVals, '', false) + '</td>' : '') +
      '<td class="grp-radio">' + fmtAvgMaxWithOutliers(t0DriftVals, 's', 3600) + '</td>' +
      (slot1Enabled ? '<td class="grp-radio">' + fmtAvgMaxWithOutliers(slot1DriftVals, 's', 3600) + '</td>' : '') +
      (slot2Enabled ? '<td class="grp-radio">' + fmtAvgMaxWithOutliers(slot2DriftVals, 's', 3600) + '</td>' : '') +
      '<td class="grp-radio">' + fmtMs(t0UploadMs) + '</td>' +
      (slot1Enabled ? '<td class="grp-radio">' + fmtMs(slot1SyncMs) + '</td>' : '') +
      (slot2Enabled ? '<td class="grp-radio">' + fmtMs(slot2SyncMs) + '</td>' : '') +
    '</tr>';
  }

  html += '</tbody></table>';
  if (allDays.length > STATION_LOG_ROWS_STEP) {
    html += '<div class="config-log-actions">';
    if (visibleDays < allDays.length) {
      var remaining = allDays.length - visibleDays;
      var step = Math.min(STATION_LOG_ROWS_STEP, remaining);
      html += '<button class="config-expand-btn" onclick="loadMoreStationLogRows(\'' + stationId + '\')">Load next ' + step + ' days ↓</button>';
    }
    if (visibleDays > STATION_LOG_ROWS_STEP) {
      html += '<button class="config-expand-btn" style="margin-left:8px" onclick="resetStationLogRows(\'' + stationId + '\')">Show latest 15</button>';
    }
    html += '</div>';
  }
  wrap.innerHTML = html;
  container.appendChild(wrap);
}

function loadMoreStationLogRows(stationId) {
  var current = Number(_stationLogsVisibleDays[stationId]) || STATION_LOG_ROWS_STEP;
  _stationLogsVisibleDays[stationId] = current + STATION_LOG_ROWS_STEP;
  setStationRange(stationId, stationRanges[stationId] || 'week');
}

function resetStationLogRows(stationId) {
  _stationLogsVisibleDays[stationId] = STATION_LOG_ROWS_STEP;
  setStationRange(stationId, stationRanges[stationId] || 'week');
}

// ============================================================
// CHART HELPERS
// ============================================================
