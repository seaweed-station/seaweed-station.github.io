// health_data_parser.js — Extracted from station_health.html (Sprint 6)
// parseStationData, getCachedStationData, saveCacheData, parseSupabaseData

function parseStationData(raw, station) {
  var feeds = raw.feeds || [];
  var entries = [];
  function toNum(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  for (var i = 0; i < feeds.length; i++) {
    var f = feeds[i];
    var ts = new Date(f.created_at);
    if (isNaN(ts.getTime())) continue;
    if (isFutureTimestamp(ts)) continue;

    var entry = { timestamp: ts, entryId: f.entry_id || i };
    var isLegacy = (f.field1 !== undefined) || (f.field2 !== undefined) || (f.field3 !== undefined) ||
                   (f.field4 !== undefined) || (f.field5 !== undefined) || (f.field6 !== undefined) ||
                   (f.field7 !== undefined) || (f.field8 !== undefined);

    if (!isLegacy) {
      // Structured Supabase v2 row (preferred). Legacy field1-8 path remains below.
      entry.deployMode = toNum(f.deploy_mode);
      entry.samplePeriod_s = toNum(f.sample_period_s);
      entry.sleepEnable = (f.sleep_enable === null || f.sleep_enable === undefined) ? null : (Number(f.sleep_enable) === 1);
      entry.espnowSyncPeriod_s = toNum(f.espnow_sync_period_s);
      entry.tsBulkFreqHours = toNum(f.bulk_freq_hours);
      var sat1InstalledRaw = f.sat_1_installed;
      var sat2InstalledRaw = f.sat_2_installed;
      entry.sat1Installed = (sat1InstalledRaw === null || sat1InstalledRaw === undefined) ? null : (Number(sat1InstalledRaw) === 1);
      entry.sat2Installed = (sat2InstalledRaw === null || sat2InstalledRaw === undefined) ? null : (Number(sat2InstalledRaw) === 1);

      entry.t0BatPct = toNum(f.battery_pct);
      entry.t0Temp1 = toNum(f.temp_1);
      entry.t0Hum1 = toNum(f.humidity_1);
      entry.t0Temp2 = toNum(f.temp_2);
      entry.t0Hum2 = toNum(f.humidity_2);
      entry.t0Temp3 = toNum(f.temp_3);
      entry.t0Hum3 = toNum(f.humidity_3);
      entry.t0BatV = toNum(f.battery_v);
      entry.t0SolarV = toNum(f.solar_v);
      entry.t0Rssi = null;
      entry.t0Boot = toNum(f.boot_count);
      entry.t0Heap = null;

      entry.sat1BatV = toNum(f.sat_1_battery_v);
      entry.sat1BatPct = toNum(f.sat_1_battery_pct);
      entry.sat1Rssi = null;
      entry.sat1SampleId = null;
      entry.sat1SyncDrift = null;
      var sat1FwRaw = f.sat_1_fw_ver;
      entry.sat1FwVersion = sat1FwRaw != null ? String(sat1FwRaw) : null;
      entry.sat1Temp1 = toNum(f.sat_1_temp_1);
      entry.sat1Hum1 = toNum(f.sat_1_humidity_1);
      entry.sat1Temp2 = toNum(f.sat_1_temp_2);
      entry.sat1Hum2 = toNum(f.sat_1_humidity_2);

      entry.sat2BatV = toNum(f.sat_2_battery_v);
      entry.sat2BatPct = toNum(f.sat_2_battery_pct);
      entry.sat2Rssi = null;
      entry.sat2SampleId = null;
      entry.sat2SyncDrift = null;
      var sat2FwRaw = f.sat_2_fw_ver;
      entry.sat2FwVersion = sat2FwRaw != null ? String(sat2FwRaw) : null;
      entry.sat2Temp1 = toNum(f.sat_2_temp_1);
      entry.sat2Hum1 = toNum(f.sat_2_humidity_1);
      entry.sat2Temp2 = toNum(f.sat_2_temp_2);
      entry.sat2Hum2 = toNum(f.sat_2_humidity_2);

      entry._rawField8 = null;
      entry.sdFreeKB = null;
      entry.csq = null;
      entry.uploadOk = null;
      entry.syncDrift = null;
      entry.t0FwVersion = f.fw_version != null ? String(f.fw_version) : null;
      entry.t0BuildDate = f.fw_date != null ? String(f.fw_date) : null;

      if (entry.sat1Installed === null) {
        entry.sat1Installed = (entry.sat1BatV !== null || entry.sat1Temp1 !== null || entry.sat1Temp2 !== null);
      }
      if (entry.sat2Installed === null) {
        entry.sat2Installed = (entry.sat2BatV !== null || entry.sat2Temp1 !== null || entry.sat2Temp2 !== null);
      }
      entries.push(entry);
      continue;
    }

    // T0 battery %
    entry.t0BatPct = parseFloat(f.field1);
    if (isNaN(entry.t0BatPct)) entry.t0BatPct = null;

    // T0 sensors (field2: temp1,hum1,temp2,hum2)
    var f2 = (f.field2 || '').split(',');
    entry.t0Temp1 = parseFloat(f2[0]); if (isNaN(entry.t0Temp1)) entry.t0Temp1 = null;
    entry.t0Hum1  = parseFloat(f2[1]); if (isNaN(entry.t0Hum1))  entry.t0Hum1  = null;
    entry.t0Temp2 = parseFloat(f2[2]); if (isNaN(entry.t0Temp2)) entry.t0Temp2 = null;
    entry.t0Hum2  = parseFloat(f2[3]); if (isNaN(entry.t0Hum2))  entry.t0Hum2  = null;

    // T0 status (field3: batV,rssi,boot,heap  OR  batV,rssi,boot,heap|fwVersion,buildDate)
    var f3Str = (f.field3 || '');
    var f3p = f3Str.split('|');
    var f3 = (f3p[0] || '').split(',');
    entry.t0BatV = parseFloat(f3[0]); if (isNaN(entry.t0BatV)) entry.t0BatV = null;
    entry.t0SolarV = parseFloat(f3[4]);
    if (isNaN(entry.t0SolarV)) entry.t0SolarV = null;
    entry.t0Rssi = parseInt(f3[1]);   if (isNaN(entry.t0Rssi)) entry.t0Rssi = null;
    entry.t0Boot = parseInt(f3[2]);   if (isNaN(entry.t0Boot)) entry.t0Boot = null;
    entry.t0Heap = parseInt(f3[3]);   if (isNaN(entry.t0Heap)) entry.t0Heap = null;
    // Firmware version: in pipe segment if present (newer firmware)
    var f3fw = (f3p[1] || '').split(',');
    entry.t0FwVersion = (f3fw[0] && f3fw[0].trim()) ? f3fw[0].trim() : null;
    entry.t0BuildDate = (f3fw[1] && f3fw[1].trim()) ? f3fw[1].trim() : null;

    // Slot 1 status (field4: batV,batPct,rssi,sampleId,[syncDrift],[fwVer])
    var f4 = (f.field4 || '').split(',');
    entry.sat1BatV     = parseFloat(f4[0]); if (isNaN(entry.sat1BatV))     entry.sat1BatV     = null;
    entry.sat1BatPct   = parseFloat(f4[1]); if (isNaN(entry.sat1BatPct))   entry.sat1BatPct   = null;
    entry.sat1Rssi     = parseInt(f4[2]);   if (isNaN(entry.sat1Rssi))     entry.sat1Rssi     = null;
    entry.sat1SampleId = parseInt(f4[3]);   if (isNaN(entry.sat1SampleId)) entry.sat1SampleId = null;
    entry.sat1SyncDrift= parseFloat(f4[5]);
    if (isNaN(entry.sat1SyncDrift)) entry.sat1SyncDrift = parseFloat(f4[4]);
    if (isNaN(entry.sat1SyncDrift)) entry.sat1SyncDrift = null;
    entry.sat1FwVersion = f4[6] ? f4[6].trim() : (f4[5] ? f4[5].trim() : null);

    // Slot 1 sensors (field5: temp1,hum1,temp2,hum2)
    var f5 = (f.field5 || '').split(',');
    entry.sat1Temp1 = parseFloat(f5[0]); if (isNaN(entry.sat1Temp1)) entry.sat1Temp1 = null;
    entry.sat1Hum1  = parseFloat(f5[1]); if (isNaN(entry.sat1Hum1))  entry.sat1Hum1  = null;
    entry.sat1Temp2 = parseFloat(f5[2]); if (isNaN(entry.sat1Temp2)) entry.sat1Temp2 = null;
    entry.sat1Hum2  = parseFloat(f5[3]); if (isNaN(entry.sat1Hum2))  entry.sat1Hum2  = null;

    // Slot 2 status (field6: batV,batPct,rssi,sampleId,[syncDrift],[fwVer])
    var f6 = (f.field6 || '').split(',');
    entry.sat2BatV     = parseFloat(f6[0]); if (isNaN(entry.sat2BatV))     entry.sat2BatV     = null;
    entry.sat2BatPct   = parseFloat(f6[1]); if (isNaN(entry.sat2BatPct))   entry.sat2BatPct   = null;
    entry.sat2Rssi     = parseInt(f6[2]);   if (isNaN(entry.sat2Rssi))     entry.sat2Rssi     = null;
    entry.sat2SampleId = parseInt(f6[3]);   if (isNaN(entry.sat2SampleId)) entry.sat2SampleId = null;
    entry.sat2SyncDrift= parseFloat(f6[5]);
    if (isNaN(entry.sat2SyncDrift)) entry.sat2SyncDrift = parseFloat(f6[4]);
    if (isNaN(entry.sat2SyncDrift)) entry.sat2SyncDrift = null;
    entry.sat2FwVersion = f6[6] ? f6[6].trim() : (f6[5] ? f6[5].trim() : null);

    // Slot 2 sensors (field7: temp1,hum1,temp2,hum2)
    var f7 = (f.field7 || '').split(',');
    entry.sat2Temp1 = parseFloat(f7[0]); if (isNaN(entry.sat2Temp1)) entry.sat2Temp1 = null;
    entry.sat2Hum1  = parseFloat(f7[1]); if (isNaN(entry.sat2Hum1))  entry.sat2Hum1  = null;
    entry.sat2Temp2 = parseFloat(f7[2]); if (isNaN(entry.sat2Temp2)) entry.sat2Temp2 = null;
    entry.sat2Hum2  = parseFloat(f7[3]); if (isNaN(entry.sat2Hum2))  entry.sat2Hum2  = null;

    // System (field8): diag|config|fw
    entry._rawField8 = f.field8 || null;  // preserved for BatteryForecast config parsing
    entry.sdFreeKB  = null; entry.csq = null; entry.uploadOk = null; entry.syncDrift = null;
    if (f.field8) {
      var parts = f.field8.split('|');
      var diag = (parts[0] || '').split(',');
      entry.sdFreeKB  = parseInt(diag[0]);   if (isNaN(entry.sdFreeKB))  entry.sdFreeKB  = null;
      entry.csq       = parseInt(diag[1]);   if (isNaN(entry.csq))       entry.csq       = null;
      entry.uploadOk  = parseInt(diag[2]);   if (isNaN(entry.uploadOk))  entry.uploadOk  = null;
      entry.syncDrift  = parseFloat(diag[3]); if (isNaN(entry.syncDrift)) entry.syncDrift = null;
      if (parts.length > 2) {
        var t0FwParts = (parts[2] || '').split(',');
        entry.t0FwVersion = t0FwParts[0] ? t0FwParts[0].trim() : null;
        entry.t0BuildDate = t0FwParts[1] ? t0FwParts[1].trim() : null;
      }
    } else {
      var f3fw = (f3p[1] || '').split(',');
      entry.t0FwVersion = f3fw[0] ? f3fw[0].trim() : null;
      entry.t0BuildDate = f3fw[1] ? f3fw[1].trim() : null;
    }

    var cfg = parseField8ConfigUnified(f.field8 || '');
    entry.sat1Installed = cfg && typeof cfg.sat1Installed === 'boolean'
      ? cfg.sat1Installed
      : (entry.sat1BatV !== null || entry.sat1Temp1 !== null || entry.sat1Temp2 !== null);
    entry.sat2Installed = cfg && typeof cfg.sat2Installed === 'boolean'
      ? cfg.sat2Installed
      : (entry.sat2BatV !== null || entry.sat2Temp1 !== null || entry.sat2Temp2 !== null);

    entries.push(entry);
  }

  entries.sort(function(a,b) { return a.timestamp - b.timestamp; });
  if (typeof filterEntryArrayByResetWindow === 'function') {
    var filteredEntries = filterEntryArrayByResetWindow(station.id, entries);
    if (filteredEntries.length > 0 || entries.length === 0) {
      entries = filteredEntries;
    } else {
      console.warn('[Health] Reset window filtered all entries for ' + station.id + '; keeping unfiltered dataset');
    }
  }
  return { entries: entries, raw: raw };
}

function getCachedStationData(stationId) {
  try {
    var raw = localStorage.getItem('seaweed_cache_' + stationId);
    if (!raw) return null;
    var cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.allEntries) || !cached.allEntries.length) return null;
    var entries = cached.allEntries
      .map(function(entry) {
        entry.timestamp = new Date(entry.timestamp);
        return entry;
      })
      .filter(function(entry) {
        return entry.timestamp && !isNaN(entry.timestamp.getTime());
      })
      .sort(function(a, b) { return a.timestamp - b.timestamp; });
    if (typeof filterEntryArrayByResetWindow === 'function') {
      entries = filterEntryArrayByResetWindow(stationId, entries);
    }
    if (!entries.length) return null;
    return { entries: entries, raw: null, source: 'cache', savedAt: cached.savedAt || null };
  } catch (e) {
    return null;
  }
}

// ============================================================
// SHARED LOCALSTORAGE PERSISTENCE  (same key as station.html)
// Key: seaweed_cache_<stationId>  Shape: { allEntries, savedAt }
// ============================================================
function saveCacheData(stationId, entries, meta) {
  saveStationCache(stationId, entries, Object.assign({ source: 'live' }, meta || {}));
}

// ============================================================
// RENDERING
// ============================================================

function parseSupabaseData(rows, station) {
  var entries = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var ts = new Date(ensureUTC(r.recorded_at));
    if (isNaN(ts.getTime())) continue;

    var entry = { timestamp: ts, entryId: r.id || i };

    // T0 battery %
    entry.t0BatPct = (r.battery_pct !== null && r.battery_pct !== undefined) ? r.battery_pct : null;

    // T0 sensors
    entry.t0Temp1 = r.temp_1 !== null ? r.temp_1 : null;
    entry.t0Hum1  = r.humidity_1 !== null ? r.humidity_1 : null;
    entry.t0Temp2 = r.temp_2 !== null ? r.temp_2 : null;
    entry.t0Hum2  = r.humidity_2 !== null ? r.humidity_2 : null;

    // T0 status (rssi + free_heap moved to upload_sessions in v2)
    entry.t0BatV = r.battery_v !== null ? r.battery_v : null;
    entry.t0SolarV = r.solar_v !== null ? r.solar_v : null;
    entry.t0Rssi = null;
    entry.t0Boot = r.boot_count !== null ? r.boot_count : null;
    entry.t0Heap = null;
    entry.t0FwVersion = r.fw_version || null;
    entry.t0BuildDate = r.fw_date || null;

    // Slot 1 status (rssi, sample_id, sync_drift, fw_ver moved to sync_sessions)
    var sat1BatV = r.sat_1_battery_v;
    var sat1BatPct = r.sat_1_battery_pct;
    var sat1FlashPct = r.sat_1_flash_pct;
    entry.sat1BatV      = sat1BatV !== null && sat1BatV !== undefined ? sat1BatV : null;
    entry.sat1BatPct    = sat1BatPct !== null && sat1BatPct !== undefined ? sat1BatPct : null;
    entry.sat1Rssi      = null;
    entry.sat1SampleId  = null;
    entry.sat1FlashPct  = sat1FlashPct !== null && sat1FlashPct !== undefined ? sat1FlashPct : null;
    entry.sat1SyncDrift = null;
    entry.sat1FwVersion = null;

    // Slot 1 sensors
    var sat1Temp1 = r.sat_1_temp_1;
    var sat1Hum1 = r.sat_1_humidity_1;
    var sat1Temp2 = r.sat_1_temp_2;
    var sat1Hum2 = r.sat_1_humidity_2;
    entry.sat1Temp1 = sat1Temp1 !== null && sat1Temp1 !== undefined ? sat1Temp1 : null;
    entry.sat1Hum1  = sat1Hum1 !== null && sat1Hum1 !== undefined ? sat1Hum1 : null;
    entry.sat1Temp2 = sat1Temp2 !== null && sat1Temp2 !== undefined ? sat1Temp2 : null;
    entry.sat1Hum2  = sat1Hum2 !== null && sat1Hum2 !== undefined ? sat1Hum2 : null;

    // Slot 2 status
    var sat2BatV = r.sat_2_battery_v;
    var sat2BatPct = r.sat_2_battery_pct;
    var sat2FlashPct = r.sat_2_flash_pct;
    entry.sat2BatV      = sat2BatV !== null && sat2BatV !== undefined ? sat2BatV : null;
    entry.sat2BatPct    = sat2BatPct !== null && sat2BatPct !== undefined ? sat2BatPct : null;
    entry.sat2Rssi      = null;
    entry.sat2SampleId  = null;
    entry.sat2FlashPct  = sat2FlashPct !== null && sat2FlashPct !== undefined ? sat2FlashPct : null;
    entry.sat2SyncDrift = null;
    entry.sat2FwVersion = null;

    // Slot 2 sensors
    var sat2Temp1 = r.sat_2_temp_1;
    var sat2Hum1 = r.sat_2_humidity_1;
    var sat2Temp2 = r.sat_2_temp_2;
    var sat2Hum2 = r.sat_2_humidity_2;
    entry.sat2Temp1 = sat2Temp1 !== null && sat2Temp1 !== undefined ? sat2Temp1 : null;
    entry.sat2Hum1  = sat2Hum1 !== null && sat2Hum1 !== undefined ? sat2Hum1 : null;
    entry.sat2Temp2 = sat2Temp2 !== null && sat2Temp2 !== undefined ? sat2Temp2 : null;
    entry.sat2Hum2  = sat2Hum2 !== null && sat2Hum2 !== undefined ? sat2Hum2 : null;

    // System diagnostics (moved to upload_sessions in v2)
    entry._rawField8        = null;
    entry.sdFreeKB          = null;
    entry.csq               = null;
    entry.uploadOk          = null;
    entry.syncDrift         = null;
    entry.espnowSyncPeriod_s = null;
    var sat1InstalledRaw = r.sat_1_installed;
    var sat2InstalledRaw = r.sat_2_installed;
    entry.sat1Installed     = sat1InstalledRaw != null ? !!sat1InstalledRaw : null;
    entry.sat2Installed     = sat2InstalledRaw != null ? !!sat2InstalledRaw : null;

    entries.push(entry);
  }

  entries.sort(function(a, b) { return a.timestamp - b.timestamp; });
  if (typeof filterEntryArrayByResetWindow === 'function') {
    var filteredEntries = filterEntryArrayByResetWindow(station.id, entries);
    if (filteredEntries.length > 0 || entries.length === 0) {
      entries = filteredEntries;
    } else {
      console.warn('[Health] Reset window filtered all live entries for ' + station.id + '; keeping unfiltered dataset');
    }
  }
  return { entries: entries, raw: { feeds: rows } };
}

// ============================================================
// FETCH LIVE FROM SUPABASE
// ============================================================
// fetchWithTimeout, yieldToBrowser, getSupabaseConfig, supabaseHeaders → provided by seaweed_common.js

