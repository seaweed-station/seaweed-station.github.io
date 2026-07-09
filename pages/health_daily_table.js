// health_daily_table.js — Extracted from station_health.html (Sprint 6)
// Daily health summary table: per-day stats, firmware, battery trend

function renderDailyHealth(container, entries, stationId) {
  if (!entries.length) return;
  var datasetMeta = typeof getStationDatasetState === 'function' ? getStationDatasetState(stationId) : null;
  if (!_stationLogsVisibleDays[stationId] || _stationLogsVisibleDays[stationId] < STATION_LOG_ROWS_STEP) {
    _stationLogsVisibleDays[stationId] = STATION_LOG_ROWS_STEP;
  }
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

  function appendDatasetStateBanner() {
    if (!datasetMeta || !datasetMeta.isActive) return;
    var banner = document.createElement('div');
    banner.style.margin = '0 0 10px';
    banner.style.fontSize = '0.74rem';
    banner.style.color = 'var(--text-sec)';
    banner.style.padding = '8px 10px';
    banner.style.border = '1px solid var(--border)';
    banner.style.borderRadius = '8px';
    banner.style.background = 'var(--bg)';
    banner.innerHTML = '<strong>' + escHtml(datasetMeta.statusLabel) + '</strong> on ' + escHtml(formatDatasetEndLabel(datasetMeta.endMs)) +
      (datasetMeta.note ? ' -- ' + escHtml(datasetMeta.note) : '');
    wrap.appendChild(banner);
  }

  if (typeof healthStationSyncContextPending === 'function' && healthStationSyncContextPending(stationId, entries)) {
    appendDatasetStateBanner();
    var note = document.createElement('div');
    note.style.fontSize = '0.78rem';
    note.style.color = 'var(--text-sec)';
    note.style.padding = '10px 12px';
    note.style.border = '1px solid var(--border)';
    note.style.borderRadius = '8px';
    note.style.background = 'var(--bg)';
    note.textContent = 'Waiting for live sync timeline. Cached station samples are loaded, but sync-derived log fields will appear after the Edge payload finishes loading.';
    wrap.appendChild(note);
    container.appendChild(wrap);
    return;
  }

  function formatDatasetEndLabel(endMs) {
    if (!isFinite(endMs)) return '--';
    if (typeof fmtStationTime === 'function') return fmtStationTime(new Date(endMs), stationId);
    return new Date(endMs).toLocaleString('en-GB', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'UTC'
    }) + ' UTC';
  }

  function num(v) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return null;
    return Number(v);
  }

  function boolVal(v) {
    if (v === true || v === 1) return true;
    if (typeof v === 'string') {
      var s = v.trim().toLowerCase();
      return s === 'true' || s === 't' || s === '1' || s === 'yes';
    }
    return false;
  }

  function fmtSignedSeconds(v) {
    var n = num(v);
    if (n == null) return '--';
    var rounded = Math.round(n);
    return (rounded > 0 ? '+' : '') + rounded + 's';
  }

  function driftCompShort(row) {
    if (!row) return '--';
    var comp = num(row.drift_learn_candidate_comp_s);
    var residual = num(row.drift_learn_residual_s);
    var spread = num(row.drift_learn_spread_s);
    var conf = num(row.drift_learn_confidence);
    var reason = String(row.drift_learn_reason_text || '').trim();
    var hasLearner = comp != null || residual != null || spread != null || conf != null || reason;
    if (!hasLearner) return '--';

    var applied = boolVal(row.drift_learn_applied);
    var txt = applied ? ('ON ' + fmtSignedSeconds(comp)) : ('OFF ' + fmtSignedSeconds(comp));
    if (applied) {
      txt += ' / res ' + fmtSignedSeconds(residual != null ? residual : row.sat_drift_s);
    } else if (spread != null) {
      txt += ' / spread ' + Math.round(spread) + 's';
    } else if (reason) {
      txt += ' / ' + reason;
    }
    if (conf != null) txt += ' / conf ' + Math.round(conf);

    var title = [
      'drift compensation ' + (applied ? 'applied' : 'not applied'),
      'candidate ' + fmtSignedSeconds(comp),
      'remaining ' + fmtSignedSeconds(residual != null ? residual : row.sat_drift_s),
      'raw ' + fmtSignedSeconds(row.drift_learn_raw_arrival_s != null ? row.drift_learn_raw_arrival_s : row.sat_drift_s),
      spread != null ? ('spread ' + Math.round(spread) + 's') : null,
      conf != null ? ('confidence ' + Math.round(conf)) : null,
      reason ? ('reason ' + reason) : null
    ].filter(function(v) { return !!v; }).join(' | ');
    return '<span title="' + escHtml(title) + '">' + escHtml(txt) + '</span>';
  }

  function remainingDriftForRow(row) {
    if (!row) return null;
    if (boolVal(row.drift_learn_applied)) {
      var residual = num(row.drift_learn_residual_s);
      if (residual != null) return residual;
    }
    return num(row.sat_drift_s);
  }

  function t0ClockDriftS(row) {
    if (!row) return null;
    var v = num(row.abs_time_resync_drift_s);
    if (v == null) v = num(row.t0_abs_time_resync_drift_s);
    if (v == null) v = num(row.t0_sync_drift_s);
    return v == null ? null : Math.abs(v);
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
    if (typeof healthSyncRowLooksReal === 'function') return healthSyncRowLooksReal(row);
    if (!row) return false;
    var okNum = num(row.sync_ok);
    if (okNum != null) return okNum > 0;
    var s = String(row.status || '').trim().toLowerCase();
    if (!s) return false;
    return s === 'ok' || s === 'success' || s === 'succeeded' || s === 'complete' || s === 'completed';
  }

  function syncRowTimeMs(row) {
    return row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
  }

  function syncPhaseText(row) {
    return String((row && (row.sync_phase || row.service_outcome || row.transfer_mode || row.status_detail)) || '').trim().toLowerCase();
  }

  function isHeavyFollowupSync(row) {
    return /\b(heavy|backlog|file|bulk)\b/.test(syncPhaseText(row));
  }

  function firstCheckinSyncRows(rows) {
    var byNode = {};
    var out = [];
    var burstGapMs = 45 * 60000;
    (rows || []).slice().sort(function(a, b) {
      return syncRowTimeMs(a) - syncRowTimeMs(b);
    }).forEach(function(row) {
      var ts = syncRowTimeMs(row);
      if (!isFinite(ts)) return;
      if (isHeavyFollowupSync(row)) return;
      var node = String((row && row.node_id) || '').toUpperCase();
      var last = byNode[node];
      if (last != null && (ts - last) <= burstGapMs) return;
      byNode[node] = ts;
      out.push(row);
    });
    return out;
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

  function latestAppliedFwForDay(dayUploadRows, allUploadRows, dayEndMs) {
    var i;
    for (i = dayUploadRows.length - 1; i >= 0; i--) {
      var dayVer = String(dayUploadRows[i] && dayUploadRows[i].applied_fw_version || '').trim();
      if (dayVer) return dayVer;
    }
    for (i = allUploadRows.length - 1; i >= 0; i--) {
      var row = allUploadRows[i] || {};
      var ts = row.upload_started_at ? new Date(ensureUTC(row.upload_started_at)).getTime() : NaN;
      if (!isFinite(ts) || ts >= dayEndMs) continue;
      var ver = String(row.applied_fw_version || '').trim();
      if (ver) return ver;
    }
    return null;
  }

  function slotMapForWindow(startMs, endMs, fallbackSlot1Node, fallbackSlot2Node) {
    if (typeof getHealthSlotStateForWindow === 'function') {
      return getHealthSlotStateForWindow(stationId, startMs, endMs);
    }
    var fallback = {};
    if (fallbackSlot1Node) fallback[1] = fallbackSlot1Node;
    if (fallbackSlot2Node) fallback[2] = fallbackSlot2Node;
    return fallback;
  }

  function cleanBatteryAverage(arr, key) {
    var values = (arr || []).map(function(e) { return num(e && e[key]); }).filter(function(v) {
      return v != null && isFinite(v) && v >= 0 && v <= 100;
    }).sort(function(a, b) { return a - b; });
    if (!values.length) return null;

    var rawCount = values.length;
    var trim = values.length >= 8 ? Math.max(1, Math.floor(values.length * 0.10)) : 0;
    if (trim > 0 && (values.length - trim * 2) >= 3) values = values.slice(trim, values.length - trim);

    return {
      avg: avg(values),
      count: values.length,
      rawCount: rawCount
    };
  }

  function batteryTrend(arr, key, prevArr) {
    var current = cleanBatteryAverage(arr, key);
    if (!current || current.avg == null) return '<span style="color:var(--text-muted)">--</span>';

    var prev = cleanBatteryAverage(prevArr, key);
    if (!prev || prev.avg == null) {
      return '<span style="color:var(--text)" title="Clean daily average from ' + current.count + ' battery sample(s)">avg ' + current.avg.toFixed(0) + '</span>';
    }

    var a = prev.avg;
    var b = current.avg;
    var d = b - a;
    var arrow = d > 0.5 ? '\u2197' : d < -0.5 ? '\u2198' : '\u2192';
    var color = d < -5 ? 'var(--danger)' : d < -1 ? 'var(--warning)' : (d > 1 ? 'var(--success)' : 'var(--text)');
    var title = 'Clean daily average: previous ' + a.toFixed(1) + '%, this day ' + b.toFixed(1) + '%; samples ' +
      prev.count + ' prev / ' + current.count + ' current';
    if (prev.rawCount !== prev.count || current.rawCount !== current.count) {
      title += '; trimmed daily high/low edge samples';
    }
    return '<span style="color:' + color + '" title="' + escHtml(title) + '">' + a.toFixed(0) + arrow + b.toFixed(0) + '</span>';
  }

  var allDays = Object.keys(byDay).sort().reverse();
  var dayIndexByKey = {};
  allDays.forEach(function(dayKey, index) { dayIndexByKey[dayKey] = index; });
  var visibleDays = Math.max(STATION_LOG_ROWS_STEP, Number(_stationLogsVisibleDays[stationId]) || STATION_LOG_ROWS_STEP);
  var days = allDays.slice(0, visibleDays);
  var visibleWindowStart = days.length ? Date.parse(days[days.length - 1] + 'T00:00:00Z') : NaN;
  var visibleWindowEnd = days.length ? Date.parse(days[0] + 'T00:00:00Z') + (24 * 3600000) : NaN;
  var slotCtx = typeof getHealthSlotContext === 'function'
    ? getHealthSlotContext(stationId, entries, syncRowsAll, {
        windowStartMs: visibleWindowStart,
        windowEndMs: visibleWindowEnd
      })
    : null;
  var slots = slotCtx && Array.isArray(slotCtx.slots)
    ? slotCtx.slots.slice()
    : healthSatelliteSlotNumbers().map(function(slotNumber) {
        return {
          slotNumber: slotNumber,
          enabled: isSatelliteVisible(stationId, entries, slotNumber),
          label: satelliteDisplayName(stationId, slotNumber),
          nodeLetter: satelliteNodeLetter(stationId, slotNumber)
        };
      }).filter(function(slot) { return !!slot.enabled; });

  function slotPrefix(slot) {
    return 'sat' + slot.slotNumber;
  }

  function slotNodeForDay(slot, daySlotMap) {
    return (daySlotMap && daySlotMap[slot.slotNumber]) || slot.nodeLetter || null;
  }

  function syncRowsForSlot(daySyncRows, slot, nodeLetter) {
    return daySyncRows.filter(function(r) {
      var rowSlot = Number(r && r.slot_number);
      if (isFinite(rowSlot) && rowSlot === Number(slot.slotNumber)) return true;
      return nodeLetter && String((r && r.node_id) || '').toUpperCase() === String(nodeLetter).toUpperCase();
    });
  }

  function slotHeaders(suffix, cls) {
    return slots.map(function(slot) {
      return '<th class="' + cls + '">' + slot.label + ' ' + suffix + '</th>';
    }).join('');
  }

  var enabledSlotCount = slots.length;
  var configCols = 4 + enabledSlotCount * 2;
  var batteryCols = 1 + enabledSlotCount;
  var sampleCols = 1 + enabledSlotCount;
  var gapCols = 1 + enabledSlotCount;
  var uploadCols = 1 + enabledSlotCount;
  var radioCols = 1 + enabledSlotCount;
  var driftCols = 1 + enabledSlotCount;
  var driftCompCols = enabledSlotCount;
  var durationCols = 1 + enabledSlotCount;
  var dataCols = sampleCols + gapCols;
  var radioSyncCols = uploadCols + radioCols + driftCols + driftCompCols + durationCols;

  var groupTh = function(label, span, cls) {
    return '<th colspan="' + span + '" class="group-head ' + cls + '">' + label + '</th>';
  };

  var html = '<table class="health-table"><thead>' +
    '<tr>' +
      '<th rowspan="2">Date</th>' +
      groupTh('Configuration', configCols, 'grp-config') +
      groupTh('Battery', batteryCols, 'grp-battery group-start') +
      groupTh('Data', dataCols, 'grp-data group-start') +
      groupTh('Radio and Satellite Syncs', radioSyncCols, 'grp-radio group-start') +
    '</tr>' +
    '<tr>' +
      '<th class="grp-config">Sample Period<br><span style="font-weight:400">(min)</span></th><th class="grp-config">Upload Freq<br><span style="font-weight:400">(hours)</span></th><th class="grp-config">Sat Sync Freq<br><span style="font-weight:400">(hours)</span></th><th class="grp-config">T0 FW</th>' +
      slotHeaders('FW', 'grp-config') +
      slotHeaders('Mapping', 'grp-config') +
      '<th class="grp-battery group-start">T0 Bat<br><span style="font-weight:400">(avg %)</span></th>' + slotHeaders('Bat<br><span style="font-weight:400">(avg %)</span>', 'grp-battery') +
      '<th class="grp-data group-start">T0 Samples<br><span style="font-weight:400">(sync rec/exp)</span></th>' +
      slotHeaders('Samples<br><span style="font-weight:400">(sync rec/exp)</span>', 'grp-data') +
      '<th class="grp-data">T0 Lost Time<br><span style="font-weight:400">(period-based)</span></th>' +
      slotHeaders('Lost Time<br><span style="font-weight:400">(period-based)</span>', 'grp-data') +
      '<th class="grp-radio group-start">T0 Uploads<br><span style="font-weight:400">(ok/attempts)</span></th>' +
      slotHeaders('Syncs<br><span style="font-weight:400">(ok/attempts)</span>', 'grp-radio') +
      '<th class="grp-radio">T0 CSQ<br><span style="font-weight:400">(avg/max)</span></th>' +
      slotHeaders('RSSI<br><span style="font-weight:400">(avg/max)</span>', 'grp-radio') +
      '<th class="grp-radio">T0 Drift<br><span style="font-weight:400">(avg/max)</span></th>' +
      slotHeaders('Drift<br><span style="font-weight:400">(avg/max)</span>', 'grp-radio') +
      slotHeaders('Drift Comp<br><span style="font-weight:400">(latest)</span>', 'grp-radio') +
      '<th class="grp-radio">T0 Upload Time</th>' + slotHeaders('Sync Time', 'grp-radio') +
    '</tr>' +
    '</thead><tbody>';

  var nowMs = Date.now();
  var datasetEndDayKey = datasetMeta && datasetMeta.isActive ? datasetMeta.endDayKey : null;

  for (var di = 0; di < days.length; di++) {
    var day = days[di];
    var de  = byDay[day];
    var prevDayKey = allDays[(dayIndexByKey[day] || 0) + 1];
    var prevDayEntries = prevDayKey ? byDay[prevDayKey] : null;
    var dl  = new Date(day + 'T12:00:00Z'); // noon UTC avoids day-boundary shifts
    var tz  = stationId ? stationTz(stationId) : undefined;
    var dateLabel = dl.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', weekday: 'short' });
    if (typeof fmtStationTime === 'function') {
      dateLabel = fmtStationTime(dl, stationId, { weekday: true, time: false, label: false });
    }
    if (datasetEndDayKey && day === datasetEndDayKey) {
      dateLabel += ' <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:var(--warning-dim);color:var(--warning);font-size:0.68rem;font-weight:700">' + escHtml(datasetMeta.pillLabel) + '</span>';
    }

    var dayStart = Date.parse(day + 'T00:00:00Z');
    var dayEnd = dayStart + 24 * 3600000;
    var dayEvalEnd = Math.min(dayEnd, nowMs);
    var dayWindowMs = Math.max(0, dayEvalEnd - dayStart);
    var daySlotMap = slotMapForWindow(dayStart, dayEnd);

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

    var dayT0Fw = fmtFwValue(
      latestFwForDay(de, entries, 't0FwVersion', dayEnd) ||
      latestAppliedFwForDay(dayUploadRows, uploadRowsAll, dayEnd)
    );
    var t0SamplesActual = de.length;
    var dayT0IntervalMs = medianIntervalMs(de, function(r) { return r.timestamp ? r.timestamp.getTime() : null; });
    var effectiveSampleSec = cfgSampleSec || (dayT0IntervalMs ? Math.round(dayT0IntervalMs / 1000) : (globalT0IntervalMs ? Math.round(globalT0IntervalMs / 1000) : null));
    var t0SamplesExpected = expectedCountForWindow(effectiveSampleSec, dayWindowMs);
    if (t0SamplesExpected == null) {
      t0SamplesExpected = expectedPerDayFromIntervalMs(effectiveSampleSec ? effectiveSampleSec * 1000 : (dayT0IntervalMs || globalT0IntervalMs));
    }

    var periodBasedExpected = expectedCountForWindow(effectiveSampleSec, dayWindowMs);
    var t0LostTime = fmtLostTime(t0SamplesActual, periodBasedExpected, effectiveSampleSec);

    var t0UploadsActual = dayUploadRows.length;
    var t0UploadsOk = dayUploadRows.filter(isUploadSuccess).length;

    var csqVals = dayUploadRows.map(function(r) { return num(r.csq); }).filter(function(v) { return v != null && v >= 0; });

    var t0DriftVals = dayUploadRows.map(t0ClockDriftS).filter(function(v) { return v != null; });

    var t0UploadMs = dayUploadRows.reduce(function(acc, r) { return acc + (num(r.upload_duration_ms) || 0); }, 0);
    var slotStats = slots.map(function(slot) {
      var nodeLetter = slotNodeForDay(slot, daySlotMap);
      var slotRows = syncRowsForSlot(daySyncRows, slot, nodeLetter);
      var firstCheckins = firstCheckinSyncRows(slotRows);
      var samplesActual = slotRows.reduce(function(acc, r) {
        var v = num(r.received_total);
        if (v == null) v = num(r.persisted_sd);
        if (v == null) v = (num(r.received_live) || 0) + (num(r.received_file_rows) || 0);
        return acc + (v || 0);
      }, 0);
      var samplesExpected = slotRows.reduce(function(acc, r) { return acc + (num(r.expected_samples) || 0); }, 0);
      return {
        slot: slot,
        nodeLetter: nodeLetter,
        fw: fmtFwValue(
          latestSyncFwForNode(daySyncRows, syncRowsAll, nodeLetter, dayEnd) ||
          latestFwForDay(de, entries, slotPrefix(slot) + 'FwVersion', dayEnd)
        ),
        mapText: nodeLetter ? ('Node ' + escHtml(nodeLetter)) : '--',
        samplesActual: samplesActual,
        samplesExpected: samplesExpected,
        lostTime: fmtLostTime(samplesActual, periodBasedExpected, effectiveSampleSec),
        syncActual: slotRows.length,
        syncOk: slotRows.filter(isSyncSuccess).length,
        rssiVals: slotRows.map(function(r) { return num(r.sat_rssi_avg); }).filter(function(v) { return v != null && v !== 0; }),
        driftVals: firstCheckins.map(function(r) {
          var v = remainingDriftForRow(r);
          return v == null ? null : Math.abs(v);
        }).filter(function(v) { return v != null; }),
        driftCompRow: firstCheckins.length ? firstCheckins[firstCheckins.length - 1] : null,
        syncMs: slotRows.reduce(function(acc, r) { return acc + (num(r.sync_duration_ms) || 0); }, 0)
      };
    });

    function slotCells(cls, fn) {
      return slotStats.map(function(stat) {
        return '<td class="' + cls + '">' + fn(stat) + '</td>';
      }).join('');
    }

    html += '<tr>' +
      '<td>' + dateLabel + '</td>' +
      '<td class="grp-config">' + fmtPeriodSeconds(cfgSampleSec) + '</td>' +
      '<td class="grp-config">' + fmtPeriodMs(cfgUploadMs) + '</td>' +
      '<td class="grp-config">' + fmtPeriodSeconds(cfgSyncSec) + '</td>' +
      '<td class="grp-config">' + dayT0Fw + '</td>' +
      slotCells('grp-config', function(stat) { return stat.fw; }) +
      slotCells('grp-config', function(stat) { return stat.mapText; }) +
      '<td class="grp-battery group-start">' + batteryTrend(de, 't0BatPct', prevDayEntries) + '</td>' +
      slotCells('grp-battery', function(stat) { return batteryTrend(de, slotPrefix(stat.slot) + 'BatPct', prevDayEntries); }) +
      '<td class="grp-data group-start">' + fmtCount(t0SamplesActual, t0SamplesExpected) + '</td>' +
      slotCells('grp-data', function(stat) { return fmtCount(stat.samplesActual, stat.samplesExpected || null); }) +
      '<td class="grp-data">' + t0LostTime + '</td>' +
      slotCells('grp-data', function(stat) { return stat.lostTime; }) +
      '<td class="grp-radio group-start">' + fmtOkAttempts(t0UploadsOk, t0UploadsActual) + '</td>' +
      slotCells('grp-radio', function(stat) { return fmtOkAttempts(stat.syncOk, stat.syncActual); }) +
      '<td class="grp-radio">' + fmtAvgMax(csqVals, '', false) + '</td>' +
      slotCells('grp-radio', function(stat) { return fmtAvgMax(stat.rssiVals, '', false); }) +
      '<td class="grp-radio">' + fmtAvgMaxWithOutliers(t0DriftVals, 's', 3600) + '</td>' +
      slotCells('grp-radio', function(stat) { return fmtAvgMaxWithOutliers(stat.driftVals, 's', 3600); }) +
      slotCells('grp-radio', function(stat) { return driftCompShort(stat.driftCompRow); }) +
      '<td class="grp-radio">' + fmtMs(t0UploadMs) + '</td>' +
      slotCells('grp-radio', function(stat) { return fmtMs(stat.syncMs); }) +
    '</tr>';
  }

  html += '</tbody></table>';
  if (datasetMeta && datasetMeta.isActive) {
    html = '<div style="margin:0 0 10px;font-size:0.74rem;color:var(--text-sec);padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">' +
      '<strong>' + escHtml(datasetMeta.statusLabel) + '</strong> on ' + escHtml(formatDatasetEndLabel(datasetMeta.endMs)) +
      (datasetMeta.note ? ' -- ' + escHtml(datasetMeta.note) : '') +
      '</div>' + html;
  }
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
