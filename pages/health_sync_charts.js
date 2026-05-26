// health_sync_charts.js — Extracted from station_health.html (Sprint 6)
// Sync session charts: daily bar, drift scatter, RSSI scatter

function renderSyncCharts(container, entries, stationId, range) {
  if (!entries || !entries.length) return;
  var stationEntries = (stationData[stationId] && Array.isArray(stationData[stationId].entries) && stationData[stationId].entries.length)
    ? stationData[stationId].entries
    : entries;

  function appendPendingBox(title, detail) {
    var box = document.createElement('div');
    box.className = 'chart-box';
    box.innerHTML = '<h4>' + title + ' (' + rangeLabel(range) + ')</h4>' +
      '<div style="padding:18px 14px;color:var(--text-sec);font-size:0.78rem;line-height:1.45">' +
      escHtml(detail) +
      '</div>';
    container.appendChild(box);
  }

  if (typeof healthStationSyncContextPending === 'function' && healthStationSyncContextPending(stationId, stationEntries)) {
    appendPendingBox('Satellite Sync Reliability', 'Waiting for live sync timeline. Cached station entries are loaded, but sync diagnostics have not arrived from the Edge payload yet.');
    appendPendingBox('Device Time Drift', 'Waiting for live sync timeline. Device time drift is derived from sync and upload diagnostics, so this plot is held until live diagnostics are available.');
    appendPendingBox('RSSI', 'Waiting for live sync timeline. RSSI is derived from sync sessions, so this plot is held until live diagnostics are available.');
    return;
  }

  var syncBoxWrap = null;
  var driftCanvas = null, driftBox = null, rssiCanvas = null, rssiBox = null;
  var sampleStartMs = stationEntries[0].timestamp.getTime();
  var sampleEndMs = stationEntries[stationEntries.length - 1].timestamp.getTime();
  var syncRowsAll = Array.isArray(_stationSyncTimeline[stationId]) ? _stationSyncTimeline[stationId] : [];
  var uploadRowsAll = Array.isArray(_stationUploadTimeline[stationId]) ? _stationUploadTimeline[stationId] : [];
  var slotCtx = typeof getHealthSlotContext === 'function' ? getHealthSlotContext(stationId, stationEntries, syncRowsAll) : null;
  var slotList = slotCtx && Array.isArray(slotCtx.slots)
    ? slotCtx.slots.slice()
    : healthSatelliteSlotNumbers().map(function(slotNumber) {
        return {
          slotNumber: slotNumber,
          enabled: isSatelliteVisible(stationId, stationEntries, slotNumber),
          label: satelliteDisplayName(stationId, slotNumber),
          nodeLetter: satelliteNodeLetter(stationId, slotNumber)
        };
      }).filter(function(slot) { return !!slot.enabled; });
  var SAT_SLOT_COLORS = ['#34d399', '#fbbf24', '#a78bfa', '#38bdf8', '#fb7185', '#84cc16', '#f97316'];

  function slotColor(slot, alpha) {
    var idx = Math.max(0, Number(slot.slotNumber || 1) - 1) % SAT_SLOT_COLORS.length;
    var color = SAT_SLOT_COLORS[idx];
    return alpha ? color + alpha : color;
  }

  function rowMatchesSlot(row, slot) {
    if (!row || !slot) return false;
    var rowSlot = Number(row.slot_number);
    if (isFinite(rowSlot) && rowSlot === Number(slot.slotNumber)) return true;
    var node = String(row.node_id || '').trim().toUpperCase();
    return !!(slot.nodeLetter && node && node === String(slot.nodeLetter).toUpperCase());
  }

  function syncRowTimeMs(row) {
    return row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
  }

  function uploadRowTimeMs(row) {
    return row && row.upload_started_at ? new Date(ensureUTC(row.upload_started_at)).getTime() : NaN;
  }

  function t0ClockDriftS(row) {
    if (!row) return null;
    function parsePresentNumber(value) {
      if (value === null || value === undefined || value === '') return null;
      var parsed = Number(value);
      return isFinite(parsed) ? parsed : null;
    }
    var v = parsePresentNumber(row.abs_time_resync_drift_s);
    if (v === null) v = parsePresentNumber(row.t0_abs_time_resync_drift_s);
    if (v === null) v = parsePresentNumber(row.t0_sync_drift_s);
    if (v === null) return null;
    // This is the absolute T0 wall-clock drift at network time resync.
    // Leave ESP-NOW scheduler drift out of this series; it is a different metric.
    return Math.abs(v);
  }

  function syncPhaseText(row) {
    return String((row && (row.sync_phase || row.service_outcome || row.transfer_mode || row.status_detail)) || '').trim().toLowerCase();
  }

  function isHeavyFollowupSync(row) {
    var text = syncPhaseText(row);
    return /\b(heavy|backlog|file|bulk)\b/.test(text);
  }

  function firstCheckinDriftRows(rows) {
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

  function isFirstCheckinDriftRow(row, firstRowKeys) {
    if (!row || !firstRowKeys) return false;
    return !!firstRowKeys[healthSyncRowKey(row)];
  }

  var syncTimes = syncRowsAll.map(syncRowTimeMs).filter(function(ts) {
    return isFinite(ts);
  }).sort(function(a, b) {
    return a - b;
  });
  var uploadTimes = uploadRowsAll.map(uploadRowTimeMs).filter(function(ts) {
    return isFinite(ts);
  }).sort(function(a, b) {
    return a - b;
  });
  var latestSyncMs = syncTimes.length ? syncTimes[syncTimes.length - 1] : sampleEndMs;
  var latestUploadMs = uploadTimes.length ? uploadTimes[uploadTimes.length - 1] : sampleEndMs;
  var rangeEndMs = Math.max(sampleEndMs, latestSyncMs, latestUploadMs);
  var rangeStartMs = sampleStartMs;
  if (range === 'day') rangeStartMs = rangeEndMs - 24 * 3600000;
  else if (range === 'week') rangeStartMs = rangeEndMs - 7 * 24 * 3600000;
  else if (range === 'month') rangeStartMs = rangeEndMs - 30 * 24 * 3600000;
  else if (range === 'all') {
    var firstSyncMs = syncTimes.length ? syncTimes[0] : sampleStartMs;
    var firstUploadMs = uploadTimes.length ? uploadTimes[0] : sampleStartMs;
    rangeStartMs = Math.min(sampleStartMs, firstSyncMs, firstUploadMs);
  }

  var rangeEntries = stationEntries.filter(function(row) {
    var ts = row && row.timestamp ? row.timestamp.getTime() : NaN;
    return isFinite(ts) && ts >= rangeStartMs && ts <= rangeEndMs;
  });
  var syncRows = syncRowsAll.filter(function(row) {
    var ts = syncRowTimeMs(row);
    return isFinite(ts) && ts >= rangeStartMs && ts <= rangeEndMs;
  });
  var uploadRows = uploadRowsAll.filter(function(row) {
    var ts = uploadRowTimeMs(row);
    return isFinite(ts) && ts >= rangeStartMs && ts <= rangeEndMs;
  });

  function rowSyncLooksReal(row) {
    if (typeof healthSyncRowLooksReal === 'function') return healthSyncRowLooksReal(row);
    if (!row) return false;
    var okNum = Number(row.sync_ok);
    if (isFinite(okNum) && okNum > 0) return true;
    var syncedNum = Number(row.sat_samples_synced);
    if (isFinite(syncedNum) && syncedNum > 0) return true;
    var rssiNum = Number(row.sat_rssi_avg);
    if (isFinite(rssiNum) && rssiNum !== 0) return true;
    var s = String(row.status || '').trim().toLowerCase();
    return s === 'ok' || s === 'success' || s === 'succeeded' || s === 'complete' || s === 'completed';
  }

  function isUsableSyncDrift(driftVal, row) {
    if (driftVal === null || driftVal === undefined) return false;
    var d = Number(driftVal);
    if (!isFinite(d)) return false;
    // Require sync evidence so stale carried values do not extend lines after disconnect.
    return rowSyncLooksReal(row);
  }

  function isUsableLegacyDrift(driftVal, rssiVal, sampleId) {
    if (driftVal === null || driftVal === undefined) return false;
    var d = Number(driftVal);
    if (!isFinite(d)) return false;
    var r = Number(rssiVal);
    var hasRssi = isFinite(r) && r !== 0;
    var hasSampleId = sampleId !== null && sampleId !== undefined;
    return hasRssi || hasSampleId;
  }

  function quantileSorted(values, q) {
    if (!values.length) return NaN;
    if (values.length === 1) return values[0];
    var pos = (values.length - 1) * q;
    var base = Math.floor(pos);
    var frac = pos - base;
    var lower = values[base];
    var upper = values[Math.min(values.length - 1, base + 1)];
    return lower + (upper - lower) * frac;
  }

  function filterSatelliteDriftSeries(seriesList) {
    var absValues = [];
    for (var i = 0; i < seriesList.length; i++) {
      var series = Array.isArray(seriesList[i]) ? seriesList[i] : [];
      for (var j = 0; j < series.length; j++) {
        var y = Number(series[j] && series[j].y);
        if (isFinite(y)) absValues.push(Math.abs(y));
      }
    }

    if (!absValues.length) {
      return { thresholdS: Infinity, filteredCount: 0, maxFilteredAbsS: null, seriesList: seriesList };
    }

    absValues.sort(function(a, b) { return a - b; });
    var thresholdS = 300;
    if (absValues.length >= 8) {
      var q1 = quantileSorted(absValues, 0.25);
      var q3 = quantileSorted(absValues, 0.75);
      var iqr = Math.max(0, q3 - q1);
      thresholdS = q3 + Math.max(10, iqr * 4);
    } else if (absValues.length >= 3) {
      thresholdS = Math.max(30, quantileSorted(absValues, 0.9) * 2);
    }
    thresholdS = Math.max(60, Math.min(300, thresholdS));

    var filteredCount = 0;
    var maxFilteredAbsS = null;
    var filteredSeriesList = seriesList.map(function(series) {
      return (Array.isArray(series) ? series : []).filter(function(pt) {
        var y = Number(pt && pt.y);
        if (!isFinite(y)) return false;
        var absY = Math.abs(y);
        if (absY <= thresholdS) return true;
        filteredCount++;
        if (maxFilteredAbsS === null || absY > maxFilteredAbsS) maxFilteredAbsS = absY;
        return false;
      });
    });

    return {
      thresholdS: thresholdS,
      filteredCount: filteredCount,
      maxFilteredAbsS: maxFilteredAbsS,
      seriesList: filteredSeriesList
    };
  }

  // Check if any sync/RSSI data exists
  var hasDrift = syncRows.some(function(row) {
    return slotList.some(function(slot) {
      return rowMatchesSlot(row, slot) && isUsableSyncDrift(row.sat_drift_s, row);
    });
  }) || rangeEntries.some(function(e) {
    return slotList.some(function(slot) {
      var p = 'sat' + slot.slotNumber;
      return isUsableLegacyDrift(e[p + 'SyncDrift'], e[p + 'Rssi'], e[p + 'SampleId']);
    });
  });
  var hasSystemDrift = uploadRows.some(function(row) {
    return t0ClockDriftS(row) !== null;
  }) || rangeEntries.some(function(e) { return e.syncDrift !== null; });
  var hasRssi  = syncRows.some(function(row) {
    return slotList.some(function(slot) {
      return rowMatchesSlot(row, slot) && row.sat_rssi_avg !== null && row.sat_rssi_avg !== undefined && row.sat_rssi_avg !== 0;
    });
  }) || rangeEntries.some(function(e) {
    return slotList.some(function(slot) {
      var v = e['sat' + slot.slotNumber + 'Rssi'];
      return v !== null && v !== undefined && v !== 0;
    });
  });
  var hasSyncData = rangeEntries.some(function(e) {
    return slotList.some(function(slot) {
      var v = e['sat' + slot.slotNumber + 'BatV'];
      return v !== null && v !== undefined;
    });
  });
  syncBoxWrap = document.createElement('div');
  syncBoxWrap.className = 'chart-box';
  var syncCadence = typeof resolveHealthSyncCadence === 'function'
    ? resolveHealthSyncCadence(stationId, stationEntries, uploadRowsAll, 3 * 3600000, syncRowsAll)
    : { periodMs: 3 * 3600000, label: '--', timeline: [] };
  var cadenceTimeline = syncCadence && Array.isArray(syncCadence.timeline) ? syncCadence.timeline : [];
  var cfgSyncTxt = syncCadence && syncCadence.label ? syncCadence.label : '--';
  var defaultSyncPeriodMs = syncCadence && syncCadence.periodMs > 0 ? syncCadence.periodMs : 3 * 3600000;
  var visibleCadencePeriods = [];
  for (var ci = 0; ci < cadenceTimeline.length; ci++) {
    var cadenceEvent = cadenceTimeline[ci];
    if (!cadenceEvent || !isFinite(cadenceEvent.ts) || !isFinite(cadenceEvent.periodSec)) continue;
    if (cadenceEvent.ts < rangeStartMs || cadenceEvent.ts > rangeEndMs) continue;
    if (visibleCadencePeriods.indexOf(cadenceEvent.periodSec) < 0) visibleCadencePeriods.push(cadenceEvent.periodSec);
  }
  if (!visibleCadencePeriods.length && syncCadence && isFinite(syncCadence.periodSec)) visibleCadencePeriods.push(syncCadence.periodSec);
  visibleCadencePeriods.sort(function(a, b) { return a - b; });
  if (visibleCadencePeriods.length > 1) {
    cfgSyncTxt = 'Varies (' + visibleCadencePeriods.map(formatHealthSyncCadenceLabel).join(', ') + ')';
  }
  syncBoxWrap.innerHTML = '<h4>Satellite Sync Reliability (' + rangeLabel(range) + ')</h4><div class="chart-subhead">Configured Sat sync: ' + cfgSyncTxt + '</div>';
  var syncCanvas = document.createElement('canvas');
  syncBoxWrap.appendChild(syncCanvas);
    function isSuccessfulSyncRow(row) {
      return rowSyncLooksReal(row);
    }

    var syncSlots = slotList.map(function(slot, idx) {
      var observedEventTimes = syncRows.filter(function(row) {
        return rowMatchesSlot(row, slot) && isSuccessfulSyncRow(row);
      }).map(function(row) {
        return row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
      }).filter(function(ts) {
        return isFinite(ts) && ts >= rangeStartMs && ts <= rangeEndMs;
      });
      return Object.assign({}, slot, {
        observedEventTimes: observedEventTimes,
        stack: 'slot' + slot.slotNumber,
        color: slotColor(slot),
        idx: idx
      });
    });

    function initBucket(startMs) {
      var bucket = { bStart: startMs };
      syncSlots.forEach(function(slot) {
        bucket['slot' + slot.slotNumber] = 0;
        bucket['slot' + slot.slotNumber + 'Total'] = 0;
      });
      return bucket;
    }

    function addWindowToBucket(bucket, slot, windowSlot) {
      if (!bucket || !slot || !windowSlot) return;
      var key = 'slot' + slot.slotNumber;
      bucket[key + 'Total'] = (bucket[key + 'Total'] || 0) + 1;
      if (windowSlot.hit) bucket[key] = (bucket[key] || 0) + 1;
    }

    var byBucket = {}, bucketKeys = [], labels = [];
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var cadenceSignature = typeof healthSyncCadenceTimelineSignature === 'function'
      ? healthSyncCadenceTimelineSignature(cadenceTimeline, defaultSyncPeriodMs)
      : String(Math.round(defaultSyncPeriodMs / 1000));
    var syncRangeCacheKey = stationId + '_sync_' + range + '_' + cadenceSignature;
    if (!_syncWindowCache[syncRangeCacheKey]) {
      _syncWindowCache[syncRangeCacheKey] = {};
    }
    syncSlots.forEach(function(slot) {
      var p = 'sat' + slot.slotNumber;
      if (!_syncWindowCache[syncRangeCacheKey][p]) {
        _syncWindowCache[syncRangeCacheKey][p] = evaluateSyncWindows(stationEntries, p + 'SampleId', p + 'BatV', rangeStartMs, rangeEndMs, defaultSyncPeriodMs, p + 'Installed', slot.observedEventTimes, cadenceTimeline);
      }
    });
    syncSlots.forEach(function(slot) {
      slot.windowEval = _syncWindowCache[syncRangeCacheKey]['sat' + slot.slotNumber] || { synced: 0, missed: 0, total: 0, slots: [] };
    });

    function keyFromTs(tsMs) {
      var d = new Date(tsMs);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    if (range === 'day') {
      var tMax = rangeEndMs;
      // Use station-local hour for bucket labels
      var floorHour = new Date(tMax); floorHour.setMinutes(0, 0, 0, 0);
      var windowStart = floorHour.getTime() - 24 * 3600000;
      for (var h = 0; h < 24; h++) {
        var bStart = windowStart + h * 3600000;
        byBucket[h] = initBucket(bStart);
        bucketKeys.push(h);
        labels.push(String(stationLocalHour(new Date(bStart), stationId)).padStart(2, '0') + ':00');
      }

      syncSlots.forEach(function(syncSlot) {
        (syncSlot.windowEval.slots || []).forEach(function(windowSlot) {
          var idx = Math.floor((windowSlot.ts - windowStart) / 3600000);
          if (idx < 0 || idx > 23) return;
          addWindowToBucket(byBucket[idx], syncSlot, windowSlot);
        });
      });
    } else {
      var dayStart = new Date(rangeStartMs); dayStart.setHours(0, 0, 0, 0);
      var dayEnd = new Date(rangeEndMs); dayEnd.setHours(0, 0, 0, 0);
      for (var dayTs = dayStart.getTime(); dayTs <= dayEnd.getTime(); dayTs += 24 * 3600000) {
        var kInit = keyFromTs(dayTs);
        byBucket[kInit] = initBucket(dayTs);
      }

      syncSlots.forEach(function(syncSlot) {
        (syncSlot.windowEval.slots || []).forEach(function(windowSlot) {
          var k = keyFromTs(windowSlot.ts);
          if (!byBucket[k]) byBucket[k] = initBucket(Date.parse(k + 'T00:00:00Z'));
          addWindowToBucket(byBucket[k], syncSlot, windowSlot);
        });
      });

      bucketKeys = Object.keys(byBucket).sort();
      labels = bucketKeys.map(function(k) {
        var p = k.split('-');
        var d2 = new Date(+p[0], +p[1] - 1, +p[2], 12);
        return [DAY_NAMES[d2.getDay()], k.slice(5)];
      });
    }

    makeLiveChart(syncBoxWrap, syncCanvas, 'Satellite Sync Reliability \u2013 ' + rangeLabel(range), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: (function() {
          var ds = [];
          syncSlots.forEach(function(slot) {
            var key = 'slot' + slot.slotNumber;
            var synced = bucketKeys.map(function(k) { return byBucket[k][key] || 0; });
            var missed = bucketKeys.map(function(k) { return Math.max(0, (byBucket[k][key + 'Total'] || 0) - (byBucket[k][key] || 0)); });
            var hasObserved = slot.observedEventTimes.length > 0;
            var hasWindows = !!(slot.windowEval && slot.windowEval.total > 0);
            if (hasObserved || hasWindows) {
              ds.push({ label: slot.label + ' Synced', data: synced, backgroundColor: slotColor(slot, '99'), stack: slot.stack });
              ds.push({ label: slot.label + ' Missed', data: missed, backgroundColor: '#ef444466', stack: slot.stack });
            }
          });
          return ds;
        })()
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: 'top', labels: { color: '#94a3b8', font: { size: 11 }, filter: defaultLegendDatasetFilter } }
        },
        scales: {
          x: { stacked: true, ticks: { color: '#64748b', maxTicksLimit: range === 'day' ? 24 : 14 }, grid: { color: '#d6e3df' } },
          y: { stacked: true, ticks: { color: '#64748b' }, grid: { color: '#d6e3df' }, title: { display: true, text: 'Uploads', color: '#64748b' } }
        }
      }
    }, { stationId: stationId, chartKey: 'sync_reliability' });

  driftCanvas = document.createElement('canvas');
  driftBox = document.createElement('div');
  driftBox.className = 'chart-box';
  driftBox.innerHTML = '<h4>Device Time Drift (' + rangeLabel(range) + ')</h4>';
  driftBox.appendChild(driftCanvas);
  container.appendChild(driftBox);

  rssiCanvas = document.createElement('canvas');
  rssiBox = document.createElement('div');
  rssiBox.className = 'chart-box';
  rssiBox.innerHTML = '<h4>RSSI (' + rangeLabel(range) + ')</h4>';
  rssiBox.appendChild(rssiCanvas);

  if (syncBoxWrap) container.appendChild(syncBoxWrap);
  if (rssiBox) container.appendChild(rssiBox);

  var sysDriftSeries = [];
  var metricSlots = slotList.map(function(slot) {
    return Object.assign({}, slot, {
      driftSeries: [],
      rssiSeries: [],
      lastSampleId: null,
      lastDrift: null,
      lastRssi: null,
      lastDriftTs: null,
      lastRssiTs: null
    });
  });

  // Primary T0 clock drift source: upload_sessions timeline.
  if (uploadRows.length) {
    uploadRows.forEach(function(row) {
      var t = row && row.upload_started_at ? new Date(ensureUTC(row.upload_started_at)) : null;
      if (!t || isNaN(t.getTime())) return;
      var v = t0ClockDriftS(row);
      if (v === null) return;
      sysDriftSeries.push({ x: t, y: v });
    });
  }

  // Primary source (v2): sync_sessions timeline
  var firstDriftRows = firstCheckinDriftRows(syncRows.filter(function(row) {
    return isUsableSyncDrift(row && row.sat_drift_s, row);
  }));
  var firstDriftRowKeys = {};
  firstDriftRows.forEach(function(row) {
    firstDriftRowKeys[healthSyncRowKey(row)] = true;
  });

  if (syncRows.length) {
    syncRows.forEach(function(row) {
      var t = new Date(ensureUTC(row.sync_started_at));
      if (isNaN(t.getTime())) return;
      for (var ms = 0; ms < metricSlots.length; ms++) {
        var metricSlot = metricSlots[ms];
        if (!rowMatchesSlot(row, metricSlot)) continue;
        if (isUsableSyncDrift(row.sat_drift_s, row) && isFirstCheckinDriftRow(row, firstDriftRowKeys)) {
          metricSlot.driftSeries.push({ x: t, y: Number(row.sat_drift_s) });
        }
        if (row.sat_rssi_avg !== null && row.sat_rssi_avg !== undefined && row.sat_rssi_avg !== 0) {
          metricSlot.rssiSeries.push({ x: t, y: Number(row.sat_rssi_avg) });
        }
        break;
      }
    });
  }

  var recent = rangeEntries;
  var MAX_POINT_GAP_MS = 60 * 60000;

  // Session config is read per-entry (re-parse only on field8 change) so that
  // interval changes during testing are correctly reflected in the deduplication threshold.
  var _uploadCfg = null;
  var _prevRawField8 = null;
  var _expectedSessionMs = 0;
  var _lastSysDriftTs = null;

  // Legacy fallback for pre-v2 datasets where drift/RSSI lived in entry fields.
  metricSlots.forEach(function(slot) {
    slot.needLegacyDrift = !slot.driftSeries.length;
    slot.needLegacyRssi = !slot.rssiSeries.length;
  });

  recent.forEach(function(e) {
    var tsMs = e.timestamp.getTime();

    // Re-parse session config only when field8 changes (tracks testing interval changes).
    if (e._rawField8 && e._rawField8 !== _prevRawField8) {
      _uploadCfg = parseField8ConfigUnified(e._rawField8);
      _expectedSessionMs = _uploadCfg ? _uploadCfg.tsBulkFreqHours * 3600 * 1000 : 0;
      _prevRawField8 = e._rawField8;
    }

    metricSlots.forEach(function(slot) {
      var p = 'sat' + slot.slotNumber;
      var sampleId = e[p + 'SampleId'];
      var hasSampleId = sampleId !== null && sampleId !== undefined;
      var newSync = hasSampleId && sampleId !== slot.lastSampleId;
      if (hasSampleId) slot.lastSampleId = sampleId;

      if (slot.needLegacyDrift && isUsableLegacyDrift(e[p + 'SyncDrift'], e[p + 'Rssi'], sampleId)) {
        var drift = e[p + 'SyncDrift'];
        var emitDrift = newSync || slot.lastDrift === null || drift !== slot.lastDrift || slot.lastDriftTs === null || (tsMs - slot.lastDriftTs >= MAX_POINT_GAP_MS);
        if (emitDrift) {
          slot.driftSeries.push({ x: e.timestamp, y: drift });
          slot.lastDrift = drift;
          slot.lastDriftTs = tsMs;
        }
      }
    });
    // syncDrift is g_maxSyncDrift_s from field8: the worst-case wake-timer
    // jitter (T0 deep-sleep vs NTP wall clock) for the upload window.
    // The firmware resets g_maxSyncDrift_s to 0 after each successful cellular
    // upload, so all Supabase entries within a session share the same drift
    // value. Emit one point per session: on value change, OR if silence > 70%
    // of session interval (catches same-value consecutive sessions).
    if (!uploadRows.length && !sysDriftSeries.length && e.syncDrift !== null) {
      var _lastSysDrift = sysDriftSeries.length ? sysDriftSeries[sysDriftSeries.length - 1].y : undefined;
      var _sysDriftGapOk = _expectedSessionMs > 0 && _lastSysDriftTs !== null && (tsMs - _lastSysDriftTs) >= _expectedSessionMs * 0.7;
      if (sysDriftSeries.length === 0 || e.syncDrift !== _lastSysDrift || _sysDriftGapOk) {
        sysDriftSeries.push({ x: e.timestamp, y: Math.abs(e.syncDrift) });
        _lastSysDriftTs = tsMs;
      }
    }

    metricSlots.forEach(function(slot) {
      var p = 'sat' + slot.slotNumber;
      var rssi = e[p + 'Rssi'];
      if (slot.needLegacyRssi && rssi !== null && rssi !== undefined && rssi !== 0) {
        var emitRssi = slot.lastRssi === null || rssi !== slot.lastRssi || slot.lastRssiTs === null || (tsMs - slot.lastRssiTs >= MAX_POINT_GAP_MS);
        if (emitRssi) {
          slot.rssiSeries.push({ x: e.timestamp, y: rssi });
          slot.lastRssi = rssi;
          slot.lastRssiTs = tsMs;
        }
      }
    });
  });

  function makeSeriesDS(series, label, color, pointRadiusOverride) {
    return {
      label: label,
      data: series,
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: (pointRadiusOverride !== undefined) ? pointRadiusOverride : 1.5,
      tension: 0.2,
      fill: false
    };
  }

  var t0SeriesColor = '#60a5fa';

  var satelliteDriftFilter = filterSatelliteDriftSeries(metricSlots.map(function(slot) { return slot.driftSeries; }));
  metricSlots.forEach(function(slot, idx) {
    slot.driftSeries = satelliteDriftFilter.seriesList[idx] || [];
  });

  var T0_DRIFT_PLOT_CAP_S = 300;
  var t0DriftOutlierCount = 0;
  var t0DriftMaxRaw = null;
  var t0DriftRawByTs = {};
  var sysDriftSeriesCapped = sysDriftSeries.map(function(pt) {
    if (!pt || !pt.x) return pt;
    var yRaw = Number(pt.y);
    if (!isFinite(yRaw)) return pt;
    var yPlot = yRaw;
    if (Math.abs(yRaw) > T0_DRIFT_PLOT_CAP_S) {
      t0DriftOutlierCount++;
      if (t0DriftMaxRaw === null || Math.abs(yRaw) > Math.abs(t0DriftMaxRaw)) t0DriftMaxRaw = yRaw;
      yPlot = yRaw < 0 ? -T0_DRIFT_PLOT_CAP_S : T0_DRIFT_PLOT_CAP_S;
      var tsMs = pt.x instanceof Date ? pt.x.getTime() : new Date(pt.x).getTime();
      if (isFinite(tsMs)) t0DriftRawByTs[tsMs] = yRaw;
    }
    return { x: pt.x, y: yPlot };
  });

  if (driftCanvas) {
    var dOpts = chartOpts('Drift (s)', undefined, undefined, range, stationId, rangeStartMs, rangeEndMs);
    dOpts.scales.y.ticks = { callback: function(v) { return (v>=0?'+':'')+v+'s'; }, color: '#94a3b8', font: { size: 10 } };
    dOpts.plugins = dOpts.plugins || {};
    dOpts.plugins.tooltip = dOpts.plugins.tooltip || {};
    dOpts.plugins.tooltip.callbacks = dOpts.plugins.tooltip.callbacks || {};
    dOpts.plugins.tooltip.callbacks.label = function(ctx) {
      var dsLabel = (ctx && ctx.dataset && ctx.dataset.label) ? ctx.dataset.label : '';
      var yVal = ctx && ctx.parsed ? Number(ctx.parsed.y) : NaN;
      if (!isFinite(yVal)) return dsLabel;
      if (dsLabel === 'T0 Clock Drift') {
        var xMs = ctx && ctx.parsed ? Number(ctx.parsed.x) : NaN;
        var raw = isFinite(xMs) ? t0DriftRawByTs[xMs] : null;
        if (raw != null && isFinite(raw)) {
          return dsLabel + ': ' + yVal + 's (raw ' + raw + 's, capped ' + T0_DRIFT_PLOT_CAP_S + 's)';
        }
        return dsLabel + ': ' + yVal + 's';
      }
      return dsLabel + ': ' + yVal + 's';
    };

    if (t0DriftOutlierCount > 0 && driftBox) {
      var h4 = driftBox.querySelector('h4');
      if (h4) {
        var maxTxt = t0DriftMaxRaw != null && isFinite(t0DriftMaxRaw) ? Math.round(Math.abs(t0DriftMaxRaw)) + 's' : '--';
        h4.innerHTML += ' <span class="data-src src-cache" title="T0 raw outliers kept in logs">outliers ' +
          t0DriftOutlierCount + ' (max ' + maxTxt + ', cap ' + T0_DRIFT_PLOT_CAP_S + 's)</span>';
      }
    }

    if (satelliteDriftFilter.filteredCount > 0 && driftBox) {
      var h4Sat = driftBox.querySelector('h4');
      if (h4Sat) {
        var satMaxTxt = satelliteDriftFilter.maxFilteredAbsS != null && isFinite(satelliteDriftFilter.maxFilteredAbsS)
          ? Math.round(satelliteDriftFilter.maxFilteredAbsS) + 's'
          : '--';
        h4Sat.innerHTML += ' <span class="data-src src-cache" title="Large satellite drift spikes hidden from the plot">filtered ' +
          satelliteDriftFilter.filteredCount + ' sat spike' + (satelliteDriftFilter.filteredCount === 1 ? '' : 's') +
          ' (max ' + satMaxTxt + ', limit ' + Math.round(satelliteDriftFilter.thresholdS) + 's)</span>';
      }
    }

    var driftDatasets = [];
    metricSlots.forEach(function(slot) {
      if (!slot.driftSeries.length) return;
      driftDatasets.push(makeSeriesDS(
        memoizeHealthSeries('health:' + stationId + ':sync-drift:' + range + ':slot' + slot.slotNumber, slot.driftSeries),
        slot.label + ' Drift',
        slotColor(slot)
      ));
    });
    if (sysDriftSeriesCapped.length) { var _sdDS = makeSeriesDS(memoizeHealthSeries('health:' + stationId + ':sync-drift:' + range + ':t0', sysDriftSeriesCapped), 'T0 Clock Drift', t0SeriesColor); _sdDS.stepped = 'before'; _sdDS.tension = 0; driftDatasets.push(_sdDS); }
    makeLiveChart(driftBox, driftCanvas, 'Device Time Drift \u2013 ' + rangeLabel(range), {
      type: 'line',
      data: { datasets: driftDatasets },
      options: dOpts,
    }, { stationId: stationId, chartKey: 'sync_drift' });
  }

  if (rssiCanvas) {
    makeLiveChart(rssiBox, rssiCanvas, 'RSSI \u2013 ' + rangeLabel(range), {
      type: 'line',
      data: { datasets: (function() {
        var ds = [];
        metricSlots.forEach(function(slot) {
          if (!slot.rssiSeries.length) return;
          ds.push(makeSeriesDS(
            memoizeHealthSeries('health:' + stationId + ':rssi:' + range + ':slot' + slot.slotNumber, slot.rssiSeries),
            slot.label + ' RSSI',
            slotColor(slot)
          ));
        });
        return ds;
      })()},
      options: chartOpts('RSSI (dBm)', -100, 0, range, stationId, rangeStartMs, rangeEndMs),
    }, { stationId: stationId, chartKey: 'rssi' });
  }

}

