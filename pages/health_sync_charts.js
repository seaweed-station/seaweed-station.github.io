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
    appendPendingBox('Satellite Sync Drift', 'Waiting for live sync timeline. Drift is derived from sync sessions, so this plot is held until live diagnostics are available.');
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
  var slot1Enabled = slotCtx ? slotCtx.slot1.enabled : isSatelliteVisible(stationId, stationEntries, 1);
  var slot2Enabled = slotCtx ? slotCtx.slot2.enabled : isSatelliteVisible(stationId, stationEntries, 2);
  var slot1Label = slotCtx ? slotCtx.slot1.label : satelliteDisplayName(stationId, 1);
  var slot2Label = slotCtx ? slotCtx.slot2.label : satelliteDisplayName(stationId, 2);
  var slot1Node = slotCtx ? slotCtx.slot1.nodeLetter : satelliteNodeLetter(stationId, 1);
  var slot2Node = slotCtx ? slotCtx.slot2.nodeLetter : satelliteNodeLetter(stationId, 2);

  function syncRowTimeMs(row) {
    return row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
  }

  function uploadRowTimeMs(row) {
    return row && row.upload_started_at ? new Date(ensureUTC(row.upload_started_at)).getTime() : NaN;
  }

  function t0ClockDriftS(row) {
    if (!row) return null;
    var v = Number(row.abs_time_resync_drift_s);
    if (!isFinite(v)) v = Number(row.t0_sync_drift_s);
    if (!isFinite(v)) return null;
    return Math.abs(v);
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

  // Check if any sync/RSSI data exists
  var hasDrift = syncRows.some(function(row) {
    var n = (row && row.node_id ? String(row.node_id) : '').toUpperCase();
    return ((slot1Enabled && slot1Node && n === slot1Node) || (slot2Enabled && slot2Node && n === slot2Node)) && isUsableSyncDrift(row.sat_drift_s, row);
  }) || rangeEntries.some(function(e) {
    return (slot1Enabled && isUsableLegacyDrift(e.sat1SyncDrift, e.sat1Rssi, e.sat1SampleId)) ||
           (slot2Enabled && isUsableLegacyDrift(e.sat2SyncDrift, e.sat2Rssi, e.sat2SampleId));
  });
  var hasSystemDrift = uploadRows.some(function(row) {
    return t0ClockDriftS(row) !== null;
  }) || rangeEntries.some(function(e) { return e.syncDrift !== null; });
  var hasRssi  = syncRows.some(function(row) {
    var n = (row && row.node_id ? String(row.node_id) : '').toUpperCase();
    return ((slot1Enabled && slot1Node && n === slot1Node) || (slot2Enabled && slot2Node && n === slot2Node)) && row.sat_rssi_avg !== null && row.sat_rssi_avg !== undefined && row.sat_rssi_avg !== 0;
  }) || rangeEntries.some(function(e) {
    return (slot1Enabled && e.sat1Rssi !== null && e.sat1Rssi !== 0) || (slot2Enabled && e.sat2Rssi !== null && e.sat2Rssi !== 0);
  });
  var hasSyncData = rangeEntries.some(function(e) {
    return (slot1Enabled && e.sat1BatV !== null) || (slot2Enabled && e.sat2BatV !== null);
  });
  syncBoxWrap = document.createElement('div');
  syncBoxWrap.className = 'chart-box';
  var latestCfg = parseField8ConfigUnified(stationEntries[stationEntries.length - 1]._rawField8);
  var cfgSyncTxt = '--';
  var defaultSyncPeriodMs = 3 * 3600000;
  if (latestCfg && latestCfg.espnowSyncPeriod_s) {
    var cfgSyncSecNum = Number(latestCfg.espnowSyncPeriod_s);
    if (isFinite(cfgSyncSecNum) && cfgSyncSecNum > 0) {
      defaultSyncPeriodMs = cfgSyncSecNum * 1000;
    }
    cfgSyncTxt = latestCfg.espnowSyncPeriod_s >= 3600
      ? (latestCfg.espnowSyncPeriod_s / 3600).toFixed(1) + 'h'
      : Math.round(latestCfg.espnowSyncPeriod_s / 60) + 'm';
  }
  syncBoxWrap.innerHTML = '<h4>Satellite Sync Reliability (' + rangeLabel(range) + ')</h4><div class="chart-subhead">Configured Sat sync: ' + cfgSyncTxt + '</div>';
  var syncCanvas = document.createElement('canvas');
  syncBoxWrap.appendChild(syncCanvas);
    function isSuccessfulSyncRow(row) {
      return rowSyncLooksReal(row);
    }

    var slot1ObservedEventTimes = syncRows.filter(function(row) {
      return slot1Node && String((row && row.node_id) || '').toUpperCase() === slot1Node && isSuccessfulSyncRow(row);
    }).map(function(row) {
      return row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
    }).filter(function(ts) {
      return isFinite(ts) && ts >= rangeStartMs && ts <= rangeEndMs;
    });

    var slot2ObservedEventTimes = syncRows.filter(function(row) {
      return slot2Node && String((row && row.node_id) || '').toUpperCase() === slot2Node && isSuccessfulSyncRow(row);
    }).map(function(row) {
      return row && row.sync_started_at ? new Date(ensureUTC(row.sync_started_at)).getTime() : NaN;
    }).filter(function(ts) {
      return isFinite(ts) && ts >= rangeStartMs && ts <= rangeEndMs;
    });

    var byBucket = {}, bucketKeys = [], labels = [];
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var syncRangeCacheKey = stationId + '_sync_' + range;
    if (!_syncWindowCache[syncRangeCacheKey]) {
      _syncWindowCache[syncRangeCacheKey] = {
        slot1: slot1Enabled
          ? evaluateSyncWindows(stationEntries, 'sat1SampleId', 'sat1BatV', rangeStartMs, rangeEndMs, defaultSyncPeriodMs, 'sat1Installed', slot1ObservedEventTimes)
          : { synced: 0, missed: 0, total: 0, slots: [] },
        slot2: slot2Enabled
          ? evaluateSyncWindows(stationEntries, 'sat2SampleId', 'sat2BatV', rangeStartMs, rangeEndMs, defaultSyncPeriodMs, 'sat2Installed', slot2ObservedEventTimes)
          : { synced: 0, missed: 0, total: 0, slots: [] }
      };
    }
    var slot1WindowEval = _syncWindowCache[syncRangeCacheKey].slot1;
    var slot2WindowEval = _syncWindowCache[syncRangeCacheKey].slot2;

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
        byBucket[h] = { slot1Total: 0, slot1: 0, slot2Total: 0, slot2: 0, bStart: bStart };
        bucketKeys.push(h);
        labels.push(String(stationLocalHour(new Date(bStart), stationId)).padStart(2, '0') + ':00');
      }

      slot1WindowEval.slots.forEach(function(slot) {
        var idx = Math.floor((slot.ts - windowStart) / 3600000);
        if (idx < 0 || idx > 23) return;
        byBucket[idx].slot1Total++;
        if (slot.hit) byBucket[idx].slot1++;
      });
      if (slot2Enabled) {
        slot2WindowEval.slots.forEach(function(slot) {
          var idx = Math.floor((slot.ts - windowStart) / 3600000);
          if (idx < 0 || idx > 23) return;
          byBucket[idx].slot2Total++;
          if (slot.hit) byBucket[idx].slot2++;
        });
      }
    } else {
      var dayStart = new Date(rangeStartMs); dayStart.setHours(0, 0, 0, 0);
      var dayEnd = new Date(rangeEndMs); dayEnd.setHours(0, 0, 0, 0);
      for (var dayTs = dayStart.getTime(); dayTs <= dayEnd.getTime(); dayTs += 24 * 3600000) {
        var kInit = keyFromTs(dayTs);
        byBucket[kInit] = { slot1Total: 0, slot1: 0, slot2Total: 0, slot2: 0 };
      }

      slot1WindowEval.slots.forEach(function(slot) {
        var k = keyFromTs(slot.ts);
        if (!byBucket[k]) byBucket[k] = { slot1Total: 0, slot1: 0, slot2Total: 0, slot2: 0 };
        byBucket[k].slot1Total++;
        if (slot.hit) byBucket[k].slot1++;
      });
      if (slot2Enabled) {
        slot2WindowEval.slots.forEach(function(slot) {
          var k = keyFromTs(slot.ts);
          if (!byBucket[k]) byBucket[k] = { slot1Total: 0, slot1: 0, slot2Total: 0, slot2: 0 };
          byBucket[k].slot2Total++;
          if (slot.hit) byBucket[k].slot2++;
        });
      }

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
          var slot1Synced = bucketKeys.map(function(k) { return byBucket[k].slot1; });
          var slot1Missed = bucketKeys.map(function(k) { return byBucket[k].slot1Total - byBucket[k].slot1; });
          var slot2Synced = bucketKeys.map(function(k) { return byBucket[k].slot2; });
          var slot2Missed = bucketKeys.map(function(k) { return byBucket[k].slot2Total - byBucket[k].slot2; });
          var slot1HasObserved = slot1ObservedEventTimes.length > 0;
          var slot2HasObserved = slot2ObservedEventTimes.length > 0;
          var slot1HasWindows = !!(slot1WindowEval && slot1WindowEval.total > 0);
          var slot2HasWindows = !!(slot2WindowEval && slot2WindowEval.total > 0);
          if (slot1HasObserved || slot1HasWindows) {
            ds.push({ label: slot1Label + ' Synced', data: slot1Synced, backgroundColor: '#22c55e99', stack: 'a' });
            ds.push({ label: slot1Label + ' Missed', data: slot1Missed, backgroundColor: '#ef444466', stack: 'a' });
          }
          if (slot2Enabled && (slot2HasObserved || slot2HasWindows)) {
            ds.push({ label: slot2Label + ' Synced', data: slot2Synced, backgroundColor: '#3b82f699', stack: 'b' });
            ds.push({ label: slot2Label + ' Missed', data: slot2Missed, backgroundColor: '#f59e0b66', stack: 'b' });
          }
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
  driftBox.innerHTML = '<h4>Satellite Sync Drift (' + rangeLabel(range) + ')</h4>';
  driftBox.appendChild(driftCanvas);
  container.appendChild(driftBox);

  rssiCanvas = document.createElement('canvas');
  rssiBox = document.createElement('div');
  rssiBox.className = 'chart-box';
  rssiBox.innerHTML = '<h4>RSSI (' + rangeLabel(range) + ')</h4>';
  rssiBox.appendChild(rssiCanvas);

  if (syncBoxWrap) container.appendChild(syncBoxWrap);
  if (rssiBox) container.appendChild(rssiBox);

  var slot1DriftSeries = [], slot2DriftSeries = [], sysDriftSeries = [];
  var slot1RssiSeries = [], slot2RssiSeries = [];

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
  if (syncRows.length) {
    syncRows.forEach(function(row) {
      var t = new Date(ensureUTC(row.sync_started_at));
      if (isNaN(t.getTime())) return;
      var node = (row.node_id || '').toUpperCase();
      if (slot1Node && node === slot1Node) {
        if (isUsableSyncDrift(row.sat_drift_s, row)) slot1DriftSeries.push({ x: t, y: Number(row.sat_drift_s) });
        if (row.sat_rssi_avg !== null && row.sat_rssi_avg !== undefined && row.sat_rssi_avg !== 0) slot1RssiSeries.push({ x: t, y: Number(row.sat_rssi_avg) });
      } else if (slot2Enabled && slot2Node && node === slot2Node) {
        if (isUsableSyncDrift(row.sat_drift_s, row)) slot2DriftSeries.push({ x: t, y: Number(row.sat_drift_s) });
        if (row.sat_rssi_avg !== null && row.sat_rssi_avg !== undefined && row.sat_rssi_avg !== 0) slot2RssiSeries.push({ x: t, y: Number(row.sat_rssi_avg) });
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
  var _needLegacySlot1Drift = !slot1DriftSeries.length;
  var _needLegacySlot2Drift = !slot2DriftSeries.length;
  var _needLegacySlot1Rssi = !slot1RssiSeries.length;
  var _needLegacySlot2Rssi = !slot2RssiSeries.length;
  var lastSlot1SampleId = null, lastSlot2SampleId = null;
  var slot1LastDrift = null, slot2LastDrift = null;
  var slot1LastRssi = null, slot2LastRssi = null;
  var slot1LastDriftTs = null, slot2LastDriftTs = null;
  var slot1LastRssiTs = null, slot2LastRssiTs = null;

  recent.forEach(function(e) {
    var tsMs = e.timestamp.getTime();
    var slot1HasSampleId = e.sat1SampleId !== null && e.sat1SampleId !== undefined;
    var slot2HasSampleId = e.sat2SampleId !== null && e.sat2SampleId !== undefined;
    var slot1NewSync = slot1HasSampleId && (e.sat1SampleId !== lastSlot1SampleId);
    var slot2NewSync = slot2HasSampleId && (e.sat2SampleId !== lastSlot2SampleId);

    if (slot1HasSampleId) lastSlot1SampleId = e.sat1SampleId;
    if (slot2HasSampleId) lastSlot2SampleId = e.sat2SampleId;

    // Re-parse session config only when field8 changes (tracks testing interval changes).
    if (e._rawField8 && e._rawField8 !== _prevRawField8) {
      _uploadCfg = parseField8ConfigUnified(e._rawField8);
      _expectedSessionMs = _uploadCfg ? _uploadCfg.tsBulkFreqHours * 3600 * 1000 : 0;
      _prevRawField8 = e._rawField8;
    }

    if (_needLegacySlot1Drift && isUsableLegacyDrift(e.sat1SyncDrift, e.sat1Rssi, e.sat1SampleId)) {
      var emitSlot1Drift = slot1NewSync || slot1LastDrift === null || e.sat1SyncDrift !== slot1LastDrift || slot1LastDriftTs === null || (tsMs - slot1LastDriftTs >= MAX_POINT_GAP_MS);
      if (emitSlot1Drift) {
        slot1DriftSeries.push({ x: e.timestamp, y: e.sat1SyncDrift });
        slot1LastDrift = e.sat1SyncDrift;
        slot1LastDriftTs = tsMs;
      }
    }
    if (_needLegacySlot2Drift && slot2Enabled && isUsableLegacyDrift(e.sat2SyncDrift, e.sat2Rssi, e.sat2SampleId)) {
      var emitSlot2Drift = slot2NewSync || slot2LastDrift === null || e.sat2SyncDrift !== slot2LastDrift || slot2LastDriftTs === null || (tsMs - slot2LastDriftTs >= MAX_POINT_GAP_MS);
      if (emitSlot2Drift) {
        slot2DriftSeries.push({ x: e.timestamp, y: e.sat2SyncDrift });
        slot2LastDrift = e.sat2SyncDrift;
        slot2LastDriftTs = tsMs;
      }
    }
    // syncDrift is g_maxSyncDrift_s from field8: the worst-case wake-timer
    // jitter (T0 deep-sleep vs NTP wall clock) for the upload window.
    // The firmware resets g_maxSyncDrift_s to 0 after each successful cellular
    // upload, so all Supabase entries within a session share the same drift
    // value. Emit one point per session: on value change, OR if silence > 70%
    // of session interval (catches same-value consecutive sessions).
    if (!sysDriftSeries.length && e.syncDrift !== null) {
      var _lastSysDrift = sysDriftSeries.length ? sysDriftSeries[sysDriftSeries.length - 1].y : undefined;
      var _sysDriftGapOk = _expectedSessionMs > 0 && _lastSysDriftTs !== null && (tsMs - _lastSysDriftTs) >= _expectedSessionMs * 0.7;
      if (sysDriftSeries.length === 0 || e.syncDrift !== _lastSysDrift || _sysDriftGapOk) {
        sysDriftSeries.push({ x: e.timestamp, y: Math.abs(e.syncDrift) });
        _lastSysDriftTs = tsMs;
      }
    }

    if (_needLegacySlot1Rssi && e.sat1Rssi !== null && e.sat1Rssi !== 0) {
      var emitSlot1Rssi = slot1NewSync || slot1LastRssi === null || e.sat1Rssi !== slot1LastRssi || slot1LastRssiTs === null || (tsMs - slot1LastRssiTs >= MAX_POINT_GAP_MS);
      if (emitSlot1Rssi) {
        slot1RssiSeries.push({ x: e.timestamp, y: e.sat1Rssi });
        slot1LastRssi = e.sat1Rssi;
        slot1LastRssiTs = tsMs;
      }
    }
    if (_needLegacySlot2Rssi && slot2Enabled && e.sat2Rssi !== null && e.sat2Rssi !== 0) {
      var emitSlot2Rssi = slot2NewSync || slot2LastRssi === null || e.sat2Rssi !== slot2LastRssi || slot2LastRssiTs === null || (tsMs - slot2LastRssiTs >= MAX_POINT_GAP_MS);
      if (emitSlot2Rssi) {
        slot2RssiSeries.push({ x: e.timestamp, y: e.sat2Rssi });
        slot2LastRssi = e.sat2Rssi;
        slot2LastRssiTs = tsMs;
      }
    }
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
  var slot1SeriesColor = '#34d399';
  var slot2SeriesColor = '#fbbf24';

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

    var driftDatasets = [];
    if (slot1DriftSeries.length) driftDatasets.push(makeSeriesDS(memoizeHealthSeries('health:' + stationId + ':sync-drift:' + range + ':slot1', slot1DriftSeries), slot1Label + ' Drift', slot1SeriesColor));
    if (slot2Enabled && slot2DriftSeries.length) driftDatasets.push(makeSeriesDS(memoizeHealthSeries('health:' + stationId + ':sync-drift:' + range + ':slot2', slot2DriftSeries), slot2Label + ' Drift', slot2SeriesColor));
    if (sysDriftSeriesCapped.length) { var _sdDS = makeSeriesDS(memoizeHealthSeries('health:' + stationId + ':sync-drift:' + range + ':t0', sysDriftSeriesCapped), 'T0 Clock Drift', t0SeriesColor); _sdDS.stepped = 'before'; _sdDS.tension = 0; driftDatasets.push(_sdDS); }
    makeLiveChart(driftBox, driftCanvas, 'Satellite Sync Drift \u2013 ' + rangeLabel(range), {
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
        if (slot1RssiSeries.length) ds.push(makeSeriesDS(memoizeHealthSeries('health:' + stationId + ':rssi:' + range + ':slot1', slot1RssiSeries), slot1Label + ' RSSI', slot1SeriesColor));
        if (slot2Enabled && slot2RssiSeries.length) ds.push(makeSeriesDS(memoizeHealthSeries('health:' + stationId + ':rssi:' + range + ':slot2', slot2RssiSeries), slot2Label + ' RSSI', slot2SeriesColor));
        return ds;
      })()},
      options: chartOpts('RSSI (dBm)', -100, 0, range, stationId, rangeStartMs, rangeEndMs),
    }, { stationId: stationId, chartKey: 'rssi' });
  }

}

