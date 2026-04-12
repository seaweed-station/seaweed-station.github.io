// health_config_log.js — Extracted from station_health.html (Sprint 6)
// Station config change log: snapshot build, diff, render

function _buildConfigSnapshotFromUploadSession(row) {
  if (!row) return null;
  // Only use rows that have the applied config fields (post-migration firmware)
  if (row.applied_sample_period_min == null && row.applied_deploy_mode == null &&
      row.applied_fw_version == null) return null;
  return {
    deployMode: row.applied_deploy_mode != null ? Number(row.applied_deploy_mode) : null,
    sleepEnable: row.applied_sleep_enable === true || row.applied_sleep_enable === false ? !!row.applied_sleep_enable : null,
    samplePeriod_s: row.applied_sample_period_min != null ? Number(row.applied_sample_period_min) * 60 : null,
    uploadIntervalHours: row.applied_upload_interval_hours != null ? Number(row.applied_upload_interval_hours) : null,
    espnowSyncPeriod_s: row.applied_sat_sync_period_hours != null ? Number(row.applied_sat_sync_period_hours) * 3600 : null,
    slotCount: row.applied_slot_count != null ? Number(row.applied_slot_count) : null,
    fwVersion: row.applied_fw_version || null
  };
}

// sync_sessions is no longer used as a config-history source.
// Kept as a stub so callers do not break; returns null.
function _buildConfigSnapshotFromSyncSession(row) {
  return null;
}

function _configSnapshotHasSignal(cfg) {
  if (!cfg) return false;
  return cfg.deployMode != null ||
         cfg.sleepEnable === true || cfg.sleepEnable === false ||
         cfg.samplePeriod_s != null ||
         cfg.uploadIntervalHours != null ||
         cfg.espnowSyncPeriod_s != null ||
         cfg.slotCount != null ||
         cfg.fwVersion != null;
}

function _mergeConfigSnapshots(baseCfg, patchCfg) {
  var base = baseCfg || {};
  var patch = patchCfg || {};
  return {
    deployMode: patch.deployMode != null ? patch.deployMode : (base.deployMode != null ? base.deployMode : null),
    sleepEnable: patch.sleepEnable === true || patch.sleepEnable === false ? !!patch.sleepEnable : (base.sleepEnable === true || base.sleepEnable === false ? !!base.sleepEnable : null),
    samplePeriod_s: patch.samplePeriod_s != null ? patch.samplePeriod_s : (base.samplePeriod_s != null ? base.samplePeriod_s : null),
    uploadIntervalHours: patch.uploadIntervalHours != null ? patch.uploadIntervalHours : (base.uploadIntervalHours != null ? base.uploadIntervalHours : null),
    espnowSyncPeriod_s: patch.espnowSyncPeriod_s != null ? patch.espnowSyncPeriod_s : (base.espnowSyncPeriod_s != null ? base.espnowSyncPeriod_s : null),
    slotCount: patch.slotCount != null ? patch.slotCount : (base.slotCount != null ? base.slotCount : null),
    fwVersion: patch.fwVersion != null ? patch.fwVersion : (base.fwVersion != null ? base.fwVersion : null)
  };
}

// Legacy entry-level config parsing removed — upload_sessions is now the
// sole historical config source. Kept as stub to avoid call-site breakage.

function _configSnapshotsEqual(a, b) {
  if (!a || !b) return false;
  return a.deployMode === b.deployMode &&
         a.sleepEnable === b.sleepEnable &&
         a.samplePeriod_s === b.samplePeriod_s &&
         a.uploadIntervalHours === b.uploadIntervalHours &&
         a.espnowSyncPeriod_s === b.espnowSyncPeriod_s &&
         a.slotCount === b.slotCount &&
         a.fwVersion === b.fwVersion;
}

function _buildConfigSnapshotFromDeviceConfigRow(row) {
  if (!row) return null;
  var uih = row.upload_interval_hours != null ? row.upload_interval_hours
          : row.bulk_freq_hours != null ? row.bulk_freq_hours : null;
  // Derive current slot count from device_slots map
  var slotCount = null;
  var deviceId = row.device_id || null;
  if (deviceId && _deviceSlotsById && _deviceSlotsById[deviceId]) {
    slotCount = Object.keys(_deviceSlotsById[deviceId]).length;
  }
  return {
    deployMode: row.deploy_mode != null ? Number(row.deploy_mode) : null,
    sleepEnable: row.sleep_enable === true || row.sleep_enable === false ? !!row.sleep_enable : null,
    samplePeriod_s: row.sample_period_min != null && isFinite(row.sample_period_min) ? Number(row.sample_period_min) * 60 : null,
    uploadIntervalHours: uih != null && isFinite(uih) ? Number(uih) : null,
    espnowSyncPeriod_s: row.sat_sync_period_hours != null && isFinite(row.sat_sync_period_hours) ? Number(row.sat_sync_period_hours) * 3600 : null,
    slotCount: slotCount,
    fwVersion: null
  };
}

function _fmtCfgSeconds(sec) {
  if (sec == null || !isFinite(sec) || sec <= 0) return '--';
  if (sec % 3600 === 0) return (sec / 3600) + 'h';
  if (sec % 60 === 0) return (sec / 60) + 'm';
  return Math.round(sec) + 's';
}

function _fmtCfgHours(h) {
  if (h == null || !isFinite(h) || h <= 0) return '--';
  if (Math.abs(h - Math.round(h)) < 1e-6) return String(Math.round(h)) + 'h';
  return h.toFixed(1) + 'h';
}

function _configSummaryText(cfg) {
  if (!cfg) return '--';
  var mode = cfg.deployMode == null ? '--' : (Number(cfg.deployMode) === 0 ? 'WiFi' : 'Cell');
  var sleep = (cfg.sleepEnable === true) ? 'ON' : (cfg.sleepEnable === false ? 'OFF' : '--');
  var sats = cfg.slotCount != null ? String(cfg.slotCount) : '--';
  var fw = cfg.fwVersion || '--';
  return 'Mode ' + mode + ' | Sample ' + _fmtCfgSeconds(cfg.samplePeriod_s) +
         ' | Upload ' + _fmtCfgHours(cfg.uploadIntervalHours) +
         ' | Sync ' + _fmtCfgSeconds(cfg.espnowSyncPeriod_s) +
         ' | Sleep ' + sleep +
         ' | Sat ' + sats +
         ' | FW ' + fw;
}

function _configDiffText(oldCfg, newCfg) {
  if (!oldCfg || !newCfg) return 'Changed';
  var d = [];
  if (oldCfg.deployMode !== newCfg.deployMode && newCfg.deployMode != null) {
    d.push(newCfg.deployMode === 0 ? 'Mode WiFi' : 'Mode Cell');
  }
  if (oldCfg.sleepEnable !== newCfg.sleepEnable && newCfg.sleepEnable !== null) {
    d.push('Sleep ' + (newCfg.sleepEnable ? 'ON' : 'OFF'));
  }
  if (oldCfg.samplePeriod_s !== newCfg.samplePeriod_s && newCfg.samplePeriod_s != null) {
    d.push('Sample ' + _fmtCfgSeconds(newCfg.samplePeriod_s));
  }
  if (oldCfg.uploadIntervalHours !== newCfg.uploadIntervalHours && newCfg.uploadIntervalHours != null) {
    d.push('Upload ' + _fmtCfgHours(newCfg.uploadIntervalHours));
  }
  if (oldCfg.espnowSyncPeriod_s !== newCfg.espnowSyncPeriod_s && newCfg.espnowSyncPeriod_s != null) {
    d.push('Sync ' + _fmtCfgSeconds(newCfg.espnowSyncPeriod_s));
  }
  if (oldCfg.slotCount !== newCfg.slotCount && newCfg.slotCount != null) {
    d.push('Sat ' + newCfg.slotCount);
  }
  if (oldCfg.fwVersion !== newCfg.fwVersion && newCfg.fwVersion != null) {
    d.push('FW ' + newCfg.fwVersion);
  }
  return d.join(', ') || 'Changed';
}

function _coerceDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function _buildStationConfigRows(entries, stationId) {
  var rows = [];
  var prevCfg = null;

  // Historical config comes solely from upload_sessions.
  var timeline = [];
  var uploadRows = (_stationUploadTimeline[stationId] || []).slice();
  uploadRows.forEach(function(row) {
    var ts = _coerceDate(ensureUTC(row && row.upload_started_at));
    var cfg = _buildConfigSnapshotFromUploadSession(row);
    if (!ts || !cfg || !_configSnapshotHasSignal(cfg)) return;
    timeline.push({ ts: ts, cfg: cfg, src: 'upload' });
  });

  timeline.sort(function(a, b) {
    return a.ts.getTime() - b.ts.getTime();
  });

  for (var i = 0; i < timeline.length; i++) {
    var evt = timeline[i];
    var mergedCfg = _mergeConfigSnapshots(prevCfg, evt.cfg);
    if (!_configSnapshotHasSignal(mergedCfg)) continue;
    if (!prevCfg) {
      rows.push({ ts: evt.ts, cfg: mergedCfg, diff: 'Initial', isInitial: true });
      prevCfg = mergedCfg;
      continue;
    }
    if (!_configSnapshotsEqual(prevCfg, mergedCfg)) {
      rows.push({ ts: evt.ts, cfg: mergedCfg, diff: _configDiffText(prevCfg, mergedCfg), isInitial: false });
      prevCfg = mergedCfg;
    }
  }

  // Append current device_config as "pending/current" overlay if materially different
  var cfgRow = stationId ? (_deviceConfigById[stationId] || null) : null;
  if (cfgRow && cfgRow.updated_at) {
    var cfgTs = _coerceDate(ensureUTC(cfgRow.updated_at));
    if (cfgTs) {
      var dcCfg = _buildConfigSnapshotFromDeviceConfigRow(cfgRow);
      if (dcCfg) {
        var lastCfg = rows.length ? rows[rows.length - 1].cfg : null;
        var same = lastCfg ? _configSnapshotsEqual(lastCfg, dcCfg) : false;
        if (!same) {
          rows.push({ ts: cfgTs, cfg: dcCfg, diff: rows.length ? _configDiffText(lastCfg, dcCfg) : 'Initial', isInitial: rows.length === 0 });
        }
      }
    }
  }

  rows.sort(function(a, b) {
    return b.ts.getTime() - a.ts.getTime();
  });
  return rows;
}

function _renderStationConfigChangeLogBody(stationId, hostEl) {
  var host = hostEl || document.getElementById('cfglog_' + stationId);
  if (!host) return;
  var rows = (_stationConfigRowsCache[stationId] || []).filter(function(r) {
    return r && r.ts && !isNaN(new Date(r.ts).getTime());
  });
  if (!rows.length) {
    host.innerHTML = '<div style="color:var(--text-muted);font-size:.75rem;padding:8px 0">No configuration data yet.</div>';
    return;
  }
  var expanded = !!_stationConfigLogExpanded[stationId];
  var shown = expanded ? rows : rows.slice(0, 15);
  var html = '<div class="fc-config-table-wrap"><table class="fc-config-table">' +
    '<thead><tr><th>When (UTC)</th><th>Configuration</th><th>Changed</th></tr></thead><tbody>';
  for (var i = 0; i < shown.length; i++) {
    var r = shown[i];
    var ts = _coerceDate(r.ts);
    if (!ts) continue;
    var when = ts.toLocaleString('en-GB', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      timeZone: 'UTC'
    }) + ' UTC';
    html += '<tr>' +
      '<td style="white-space:nowrap;color:var(--text-muted)">' + when + '</td>' +
      '<td style="white-space:normal">' + _configSummaryText(r.cfg) + '</td>' +
      '<td style="white-space:nowrap;color:' + (r.isInitial ? 'var(--text-muted)' : 'var(--danger)') + '">' + r.diff + '</td>' +
      '</tr>';
  }
  html += '</tbody></table></div>';
  if (rows.length > 15) {
    html += '<div class="config-log-actions"><button class="config-expand-btn" onclick="toggleStationConfigLog(\'' + stationId + '\')">' +
      (expanded ? 'Show latest 15' : 'Show older entries (' + rows.length + ' total)') +
      '</button></div>';
  }
  host.innerHTML = html;
}

function toggleStationConfigLog(stationId) {
  _stationConfigLogExpanded[stationId] = !_stationConfigLogExpanded[stationId];
  _renderStationConfigChangeLogBody(stationId);
}

function renderStationConfigChangeLog(container, entries, stationId) {
  var section = document.createElement('div');
  section.className = 'fc-config-section';
  var count = 15;
  section.innerHTML = '<h4>Station Config Change Log: <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(Latest ' + count + ')</span></h4>';
  var host = document.createElement('div');
  host.id = 'cfglog_' + stationId;
  host.innerHTML = '<div style="color:var(--text-muted);font-size:.75rem;padding:8px 0">Loading…</div>';
  section.appendChild(host);
  container.appendChild(section);

  function buildAndRender() {
    var uploadCount = (_stationUploadTimeline[stationId] || []).length;
    var syncCount = (_stationSyncTimeline[stationId] || []).length;
    _stationConfigRowsCache[stationId] = _buildStationConfigRows(entries, stationId);
    console.info('[Health] Config log source for ' + stationId + ': upload_sessions=' + uploadCount +
      ', sync_sessions=' + syncCount +
      ', entries=' + ((entries && entries.length) || 0) +
      ', device_config=' + (_deviceConfigById && _deviceConfigById[stationId] ? 'yes' : 'no'));
    _renderStationConfigChangeLogBody(stationId, host);
  }

  try {
    buildAndRender();
  } catch (e) {
    console.warn('[Health] Config change log render failed for ' + stationId + ':', e && e.message ? e.message : e);
    if (host) {
      host.innerHTML = '<div style="color:var(--warning);font-size:.75rem;padding:8px 0">Config log unavailable for now.</div>';
    }
  }

  // Watchdog: retry one more render pass before surfacing an error.
  setTimeout(function() {
    if (!host) return;
    var txt = (host.textContent || '').trim().toLowerCase();
    if (txt.indexOf('loading') === 0) {
      try {
        buildAndRender();
      } catch (e2) {
        host.innerHTML = '<div style="color:var(--warning);font-size:.75rem;padding:8px 0">Config log unavailable for now.</div>';
        return;
      }
      txt = (host.textContent || '').trim().toLowerCase();
      if (txt.indexOf('loading') === 0) {
        host.innerHTML = '<div style="color:var(--warning);font-size:.75rem;padding:8px 0">Config log did not finish rendering. Try Fetch Live once, then reload.</div>';
      }
    }
  }, 1800);
}

// Sync analysis functions: collectSyncEventTimes, parseField8ConfigUnified,
// parseSyncConfigFromField8, estimateSyncPeriodMs, buildSyncPeriodTimeline,
// syncCfgAt, evaluateSyncWindows  →  provided by seaweed_sync.js

