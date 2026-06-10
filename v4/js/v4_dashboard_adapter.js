(function(window) {
  "use strict";

  var V4_SUPABASE_URL = "https://iyoihlwtvdshtlzjdoed.supabase.co";
  var V4_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5b2lobHd0dmRzaHRsempkb2VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTA4MTksImV4cCI6MjA5MjI4NjgxOX0.i3jy8WlSF72v7Ypb2ulkL12EJaDfGcDYbdiC--PgjOc";
  var CATALOG_CACHE_KEY = "sw_v4_local_station_catalog";
  var STATION_META_KEY = "sw_v4_local_station_metadata";
  var V4_SAFE_POINT_CAP = 300;
  var V4_NORMAL_POINT_CAP = 1000;
  var V4_SAFE_ROW_CAP = 1500;
  var V4_NORMAL_ROW_CAP = 6000;
  var V4_HISTORY_SAFE_ROW_CAP = 6000;
  var V4_HISTORY_NORMAL_ROW_CAP = 20000;
  var V4_HISTORY_PAGE_SIZE = 500;
  var V4_HISTORY_WINDOW_DAYS = 14;

  var STATIC_V4_STATIONS = [
    {
      id: "tb-01",
      station_uid: "ST-0101",
      station_key: "tdb-01",
      name: "TDB-01",
      location: "V4 Superbase bench station",
      dataFolder: "data_tb-01",
      lat: -31.87,
      lon: 115.90,
      weatherName: "TDB-01 / Perth bench",
      tideStation: "perth",
      sensorMap: "perth",
      project_profile_id: "v4-clean-bench"
    },
    {
      id: "tb-02",
      station_uid: "ST-0102",
      station_key: "bati",
      name: "Bati",
      location: "Bati station",
      dataFolder: "data_tb-02",
      lat: -31.87,
      lon: 115.90,
      weatherName: "Bati",
      tideStation: "perth",
      sensorMap: "perth",
      project_profile_id: "v4-clean-bench"
    },
    {
      id: "perth_table",
      station_uid: "ST-0103",
      station_key: "perth-table",
      name: "Perth TEST Bed",
      location: "V4 Superbase bench station",
      dataFolder: "data_perth_table",
      lat: -31.87,
      lon: 115.90,
      weatherName: "Perth TEST Bed",
      tideStation: "perth",
      sensorMap: "perth",
      project_profile_id: "v4-clean-bench"
    },
    {
      id: "tdb-03",
      station_uid: "ST-0104",
      station_key: "tdb-03",
      name: "TDB-03",
      location: "V4 Superbase bench station",
      dataFolder: "data_tdb-03",
      lat: -31.87,
      lon: 115.90,
      weatherName: "TDB-03 / Perth bench",
      tideStation: "perth",
      sensorMap: "perth",
      project_profile_id: "v4-clean-bench"
    }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return value == null ? "" : String(value).trim();
  }

  function normalizeDisplayTime(value) {
    if (window.SeaweedV4 && typeof SeaweedV4.displayTimeLabel === "function") {
      var raw = text(value);
      return raw ? SeaweedV4.displayTimeLabel(raw) : "";
    }
    return text(value);
  }

  function v4EgressSafeMode() {
    if (typeof dashboardEgressSafeMode === "function") return dashboardEgressSafeMode();
    try {
      var stored = localStorage.getItem("seaweed_egress_safe_mode");
      if (stored !== null) return !/^(0|false|off|no)$/i.test(String(stored).trim());
    } catch (_) {}
    return true;
  }

  function clampInt(value, fallback, minValue, maxValue) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) n = fallback;
    n = Math.floor(n);
    if (minValue != null) n = Math.max(Number(minValue), n);
    if (maxValue != null) n = Math.min(Number(maxValue), n);
    return n;
  }

  function clampPointTarget(value, fallback) {
    return clampInt(value, fallback || 500, 1, v4EgressSafeMode() ? V4_SAFE_POINT_CAP : V4_NORMAL_POINT_CAP);
  }

  function clampRowLimit(value, fallback) {
    return clampInt(value, fallback || 1800, 1, v4EgressSafeMode() ? V4_SAFE_ROW_CAP : V4_NORMAL_ROW_CAP);
  }

  function clampHistoryRowLimit(value, fallback) {
    return clampInt(value, fallback || V4_HISTORY_SAFE_ROW_CAP, 1, v4EgressSafeMode() ? V4_HISTORY_SAFE_ROW_CAP : V4_HISTORY_NORMAL_ROW_CAP);
  }

  function windowSpanDays(win) {
    if (!win || !(win.from instanceof Date) || !(win.to instanceof Date)) return 0;
    return Math.max(0, (win.to.getTime() - win.from.getTime()) / 86400000);
  }

  function isHistoryWindow(win) {
    return windowSpanDays(win) > V4_HISTORY_WINDOW_DAYS;
  }

  function slug(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function stationMetadataMap() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STATION_META_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeStationMetadataMap(rows) {
    var map = {};
    (Array.isArray(rows) ? rows : []).forEach(function(row) {
      var stationUid = text(row.station_uid || row.stationUid);
      var stationKey = text(row.station_key || row.stationKey);
      var key = stationUid || stationKey || text(row.id);
      if (!key) return;
      map[key] = {
        enabled: row.enabled !== false,
        displayOrder: displayOrderValue(row.displayOrder),
        installDateUtc: text(row.installDateUtc),
        datasetStatus: text(row.datasetStatus || "active"),
        datasetEndUtc: text(row.datasetEndUtc),
        datasetEndNote: text(row.datasetEndNote),
        lat: row.lat === "" || row.lat == null ? null : Number(row.lat),
        lon: row.lon === "" || row.lon == null ? null : Number(row.lon),
        displayTime: normalizeDisplayTime(row.displayTime || row.display_time)
      };
    });
    try { localStorage.setItem(STATION_META_KEY, JSON.stringify(map)); } catch (_) {}
    return map;
  }

  function stationMetadataRows(payload) {
    var rows = [];
    if (Array.isArray(payload)) rows = payload;
    else if (payload && Array.isArray(payload.stations)) rows = payload.stations;
    return rows.map(function(row, idx) {
      row = row || {};
      return {
        station_uid: text(row.station_uid || row.stationUid),
        station_key: text(row.station_key || row.stationKey),
        enabled: row.enabled !== false,
        displayOrder: displayOrderValue(row.displayOrder) != null ? displayOrderValue(row.displayOrder) : idx,
        installDateUtc: text(row.installDateUtc),
        datasetStatus: text(row.datasetStatus || "active"),
        datasetEndUtc: text(row.datasetEndUtc),
        datasetEndNote: text(row.datasetEndNote),
        lat: row.lat === "" || row.lat == null ? null : Number(row.lat),
        lon: row.lon === "" || row.lon == null ? null : Number(row.lon),
        displayTime: normalizeDisplayTime(row.displayTime || row.display_time)
      };
    }).filter(function(row) {
      return row.station_uid || row.station_key;
    });
  }

  function updateCachedCatalogStationMetadata(rows) {
    var metadataRows = stationMetadataRows(rows);
    if (!metadataRows.length) return;
    var byKey = {};
    metadataRows.forEach(function(row) {
      if (row.station_uid) byKey[row.station_uid] = row;
      if (row.station_key) byKey[row.station_key] = row;
    });
    try {
      var catalog = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || "null");
      if (!catalog || !Array.isArray(catalog.stations)) return;
      catalog.stations = catalog.stations.map(function(station) {
        var meta = byKey[text(station.station_uid)] || byKey[text(station.station_key)];
        if (!meta) return station;
        return Object.assign({}, station, {
          active: meta.enabled !== false,
          displayOrder: meta.displayOrder,
          installDateUtc: meta.installDateUtc,
          datasetStatus: meta.datasetStatus || "active",
          datasetEndUtc: meta.datasetEndUtc,
          datasetEndNote: meta.datasetEndNote,
          lat: meta.lat,
          lon: meta.lon,
          displayTime: normalizeDisplayTime(meta.displayTime),
          shared_station_metadata_at: new Date().toISOString()
        });
      });
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog));
    } catch (_) {}
  }

  function stationMetadata(station, stationKey, legacyId) {
    var map = stationMetadataMap();
    var stationUid = text(station && station.station_uid);
    return map[stationUid] || map[stationKey] || map[legacyId] || {};
  }

  function displayOrderValue(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function sortStationsByDisplayOrder(list) {
    return (list || []).map(function(station, idx) {
      return { station: station, idx: idx };
    }).sort(function(a, b) {
      var ao = displayOrderValue(a.station.displayOrder);
      var bo = displayOrderValue(b.station.displayOrder);
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return a.idx - b.idx;
    }).map(function(item) {
      return item.station;
    });
  }

  function roleAllowsStation(station) {
    try {
      var allowed = JSON.parse(sessionStorage.getItem("sw_allowed_stations") || '["*"]');
      if (!Array.isArray(allowed) || !allowed.length || allowed.indexOf("*") !== -1) return true;
      var allowedMap = {};
      allowed.forEach(function(item) { allowedMap[text(item).toLowerCase()] = true; });
      var aliases = [station.id, station.station_key, station.station_uid, text(station.station_key).replace(/-/g, "_"), text(station.name).toLowerCase()];
      for (var i = 0; i < aliases.length; i++) {
        if (allowedMap[text(aliases[i]).toLowerCase()]) return true;
      }
      return false;
    } catch (_) {
      return true;
    }
  }

  function isCleanV4Station(station) {
    if (!station) return false;
    var schemaFamily = text(station.schema_family).toLowerCase();
    var profileId = text(station.project_profile_id).toLowerCase();
    if (schemaFamily && schemaFamily !== "v4") return false;
    if (profileId && profileId.indexOf("transition") !== -1) return false;
    return !!text(station.station_uid);
  }

  function stationFromCatalog(station) {
    var stationKey = slug(station.station_key || station.station_name || station.station_uid);
    var legacyId = text(station.legacy_device_id || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    var meta = stationMetadata(station, stationKey, legacyId);
    var id = legacyId || stationKey || text(station.station_uid).toLowerCase();
    var presentation = station.presentation || {};
    var latValue = meta.lat !== undefined ? meta.lat : station.lat;
    var lonValue = meta.lon !== undefined ? meta.lon : station.lon;
    var displayTimeValue = meta.displayTime !== undefined ? meta.displayTime : (station.displayTime || station.display_time);
    return {
      id: id,
      station_uid: text(station.station_uid),
      station_key: stationKey,
      name: text(station.station_name) || text(station.name) || id,
      location: text(station.location) || text(presentation.location) || "V4 Superbase station",
      enabled: meta.enabled !== undefined ? meta.enabled !== false : station.active !== false && station.enabled !== false,
      dataFolder: text(station.data_folder || presentation.data_folder) || ("data_" + id),
      lat: latValue != null && latValue !== "" ? Number(latValue) : (presentation.lat != null ? Number(presentation.lat) : null),
      lon: lonValue != null && lonValue !== "" ? Number(lonValue) : (presentation.lon != null ? Number(presentation.lon) : null),
      weatherName: text(station.weather_name || presentation.weather_name) || text(station.station_name) || id,
      tideStation: text(station.tide_station || presentation.tide_station) || "perth",
      sensorMap: text(station.sensor_map || presentation.sensor_map) || "perth",
      hasSatellite: true,
      project_profile_id: text(station.project_profile_id) || "v4-clean-bench",
      supabase_url: text(station.supabase_url) || V4_SUPABASE_URL,
      supabase_anon_key: text(station.supabase_anon_key) || V4_SUPABASE_ANON_KEY,
      displayOrder: displayOrderValue(meta.displayOrder != null ? meta.displayOrder : station.displayOrder),
      datasetStatus: text(meta.datasetStatus || "active"),
      datasetEndUtc: text(meta.datasetEndUtc),
      datasetEndNote: text(meta.datasetEndNote),
      displayTime: normalizeDisplayTime(displayTimeValue)
    };
  }

  function catalogStations() {
    try {
      var catalog = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || "null");
      var rows = catalog && Array.isArray(catalog.stations) ? catalog.stations : [];
      var stations = rows.filter(isCleanV4Station).map(stationFromCatalog).filter(function(station) {
        return station.id && station.station_uid && station.enabled !== false && roleAllowsStation(station);
      });
      return rows.length ? sortStationsByDisplayOrder(stations) : null;
    } catch (_) {
      return null;
    }
  }

  function stations() {
    return sortStationsByDisplayOrder(clone(catalogStations() || STATIC_V4_STATIONS).map(function(station) {
      var stationKey = station.station_key || slug(station.name || station.station_uid);
      var meta = stationMetadata(station, stationKey, station.id);
      if (meta.enabled !== undefined) station.enabled = meta.enabled !== false;
      if (meta.lat !== undefined && meta.lat !== null && meta.lat !== "") station.lat = Number(meta.lat);
      if (meta.lon !== undefined && meta.lon !== null && meta.lon !== "") station.lon = Number(meta.lon);
      station.displayTime = normalizeDisplayTime(meta.displayTime || station.displayTime);
      station.displayOrder = displayOrderValue(meta.displayOrder != null ? meta.displayOrder : station.displayOrder);
      return station;
    })).filter(function(station) {
      return station.enabled !== false && roleAllowsStation(station);
    });
  }

  function stationProfiles(opts) {
    opts = opts || {};
    return stations().filter(function(station) {
      return opts.includeDisabled || station.enabled !== false;
    }).map(function(station) {
      return {
        id: station.id,
        name: station.name,
        enabled: station.enabled !== false,
        channelId: "",
        apiKey: "",
        dataFolder: station.dataFolder,
        mapLat: station.lat,
        mapLon: station.lon,
        stationUid: station.station_uid,
        stationKey: station.station_key,
        projectProfileId: station.project_profile_id,
        supabaseUrl: station.supabase_url || V4_SUPABASE_URL,
        supabaseAnonKey: station.supabase_anon_key || V4_SUPABASE_ANON_KEY,
        displayTime: normalizeDisplayTime(station.displayTime),
        datasetStatus: "active"
      };
    });
  }

  function findStation(value) {
    var wanted = text(value).toLowerCase();
    if (!wanted) return null;
    var normalized = wanted.replace(/-/g, "_");
    var all = stations();
    for (var i = 0; i < all.length; i++) {
      var station = all[i];
      var aliases = [
        station.id,
        station.station_key,
        station.station_uid,
        text(station.name).toLowerCase(),
        text(station.station_key).replace(/-/g, "_")
      ];
      for (var a = 0; a < aliases.length; a++) {
        var alias = text(aliases[a]).toLowerCase();
        if (alias === wanted || alias === normalized) return clone(station);
      }
    }
    return null;
  }

  function applyRegistry() {
    var registry = stations().map(function(station) {
      return {
        id: station.id,
        name: station.name,
        location: station.location,
        enabled: station.enabled !== false,
        dataFolder: station.dataFolder,
        lat: station.lat,
        lon: station.lon,
        weatherName: station.weatherName,
        tideStation: station.tideStation,
        sensorMap: station.sensorMap,
        hasSatellite: true,
        station_uid: station.station_uid,
        station_key: station.station_key,
        project_profile_id: station.project_profile_id,
        displayOrder: station.displayOrder,
        displayTime: normalizeDisplayTime(station.displayTime)
      };
    });

    window.STATION_REGISTRY = registry;
    window.DEFAULT_DEVICE_PROFILES = stationProfiles({ includeDisabled: true });
    window.getConfiguredDeviceProfiles = function(opts) { return stationProfiles(opts); };
    window.getConfiguredDeviceProfileMap = function(opts) {
      var map = {};
      stationProfiles(opts).forEach(function(profile) { map[profile.id] = profile; });
      return map;
    };
    window.getConfiguredDeviceProfile = function(stationId) {
      var station = findStation(stationId);
      return station ? stationProfiles({ includeDisabled: true }).filter(function(profile) { return profile.id === station.id; })[0] : null;
    };
    window.getStationRegistryEntry = function(stationId) { return findStation(stationId); };
    window.getSupabaseConfig = function() {
      return { url: V4_SUPABASE_URL, key: V4_SUPABASE_ANON_KEY };
    };
    window.fetchSamplesRawStationPayload = function(stationId, windowLike, opts) {
      opts = opts || {};
      return fetchStationPayload(stationId, windowLike, clampPointTarget(opts.target || opts.maxRows, 500));
    };
  }

  function metadataSnapshotKey() {
    return JSON.stringify(stations().map(function(station) {
      return [station.id, station.station_uid, station.station_key, station.enabled !== false, station.displayOrder, normalizeDisplayTime(station.displayTime)];
    }));
  }

  async function refreshSharedStationMetadataFromSupabase() {
    var before = metadataSnapshotKey();
    try {
      var response = await fetchWithTimeout(V4_SUPABASE_URL + "/rest/v1/rpc/dashboard_get_station_metadata", 12000, {
        method: "POST",
        headers: Object.assign({}, headers(), { "Content-Type": "application/json" }),
        body: "{}"
      });
      if (!response.ok) return { changed: false };
      var bodyText = await response.text();
      var payload = bodyText ? JSON.parse(bodyText) : null;
      var rows = stationMetadataRows(payload);
      if (!rows.length) return { changed: false };
      var localMap = stationMetadataMap();
      rows = rows.map(function(row) {
        if (row.displayTime) return row;
        var local = localMap[row.station_uid] || localMap[row.station_key];
        return local && local.displayTime ? Object.assign({}, row, { displayTime: local.displayTime }) : row;
      });
      writeStationMetadataMap(rows);
      updateCachedCatalogStationMetadata(rows);
      applyRegistry();
      var after = metadataSnapshotKey();
      var changed = before !== after;
      if (changed && typeof window.dispatchEvent === "function") {
        try {
          window.dispatchEvent(new CustomEvent("seaweed:deviceProfilesUpdated", {
            detail: { changed: true, source: "v4_station_metadata", fetchedAt: Date.now() }
          }));
        } catch (_) {}
      }
      return { changed: changed };
    } catch (_) {
      return { changed: false };
    }
  }

  function postgrestQuery(params) {
    return Object.keys(params).map(function(key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    }).join("&");
  }

  function headers() {
    return {
      apikey: V4_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + V4_SUPABASE_ANON_KEY
    };
  }

  async function getPostgrest(table, params, timeoutMs) {
    var url = V4_SUPABASE_URL + "/rest/v1/" + table + "?" + postgrestQuery(params || {});
    var response = await fetchWithTimeout(url, timeoutMs || 25000, { headers: headers() });
    if (!response.ok) throw new Error(table + " HTTP " + response.status);
    return response.json();
  }

  function rowTime(row) {
    return row && (row.sample_epoch || row.recorded_at || row.created_at || row.inserted_at);
  }

  function discoverSlots(rows, slotRows) {
    var slotMap = {};
    (slotRows || []).forEach(function(row) {
      var slot = Number(row && row.slot_number);
      if (isFinite(slot) && slot > 0) slotMap[String(slot)] = slot;
    });
    rows.forEach(function(row) {
      var slot = Number(row && row.slot_number);
      if (isFinite(slot) && slot > 0) slotMap[String(slot)] = slot;
      Object.keys(row || {}).forEach(function(key) {
        var match = /^sat_(\d+)_/.exec(key);
        if (match) slotMap[match[1]] = Number(match[1]);
      });
    });
    var slots = Object.keys(slotMap).map(function(key) { return Number(key); }).filter(Boolean).sort(function(a, b) { return a - b; });
    return slots.length ? slots : [1, 2];
  }

  function nodeSlotMap(slotRows, slots) {
    var out = {};
    (slotRows || []).forEach(function(row) {
      var slot = Number(row && row.slot_number);
      var node = text(row && (row.node_board_id || row.node_id || row.node_primary_label)).toUpperCase();
      if (node && isFinite(slot) && slot > 0) out[node] = slot;
    });
    if (!Object.keys(out).length) {
      (slots || []).forEach(function(slot) {
        var n = Number(slot);
        if (isFinite(n) && n > 0) out[String(n)] = n;
      });
    }
    return out;
  }

  function slotHistoryFromRows(slotRows) {
    return (slotRows || []).map(function(row) {
      var slot = Number(row && row.slot_number);
      var node = text(row && (row.node_board_id || row.node_id || row.node_primary_label)).toUpperCase();
      if (!node || !isFinite(slot) || slot <= 0) return null;
      return {
        slot_number: slot,
        node_letter: node,
        assigned_at: row.assigned_at || row.updated_at || "2026-01-01T00:00:00Z",
        retired_at: row.retired_at || null
      };
    }).filter(function(row) { return !!row; });
  }

  function assignSensorValue(target, key, value) {
    if (value !== null && value !== undefined) target[key] = value;
  }

  function rowsToFeeds(rows, slots) {
    var byTime = {};
    rows.forEach(function(row) {
      var ts = rowTime(row);
      if (!ts) return;
      if (!byTime[ts]) {
        byTime[ts] = {
          created_at: ts,
          entry_id: ts,
          _discovered_slots: slots
        };
      }
      var feed = byTime[ts];
      var slot = Number(row.slot_number);
      var role = text(row.sample_role).toLowerCase();
      var isSatellite = isFinite(slot) && slot > 0 && role !== "hub";
      var prefix = isSatellite ? ("sat_" + slot + "_") : "";

      feed.entry_id = feed.entry_id || row.entry_id || row.id || row.sample_id || ts;
      if (isSatellite) {
        assignSensorValue(feed, prefix + "temp_1", row.temp_1);
        assignSensorValue(feed, prefix + "humidity_1", row.humidity_1);
        assignSensorValue(feed, prefix + "temp_2", row.temp_2);
        assignSensorValue(feed, prefix + "humidity_2", row.humidity_2);
        assignSensorValue(feed, prefix + "temp_3", row.temp_3);
        assignSensorValue(feed, prefix + "humidity_3", row.humidity_3);
        assignSensorValue(feed, prefix + "battery_v", row.battery_v);
        assignSensorValue(feed, prefix + "battery_pct", row.battery_pct);
        assignSensorValue(feed, prefix + "solar_v", row.solar_v);
        assignSensorValue(feed, prefix + "sample_id", row.sample_id);
        assignSensorValue(feed, prefix + "sync_id", row.sync_id);
        assignSensorValue(feed, prefix + "source_board_id", row.source_board_id);
      } else {
        assignSensorValue(feed, "temp_1", row.temp_1);
        assignSensorValue(feed, "humidity_1", row.humidity_1);
        assignSensorValue(feed, "temp_2", row.temp_2);
        assignSensorValue(feed, "humidity_2", row.humidity_2);
        assignSensorValue(feed, "temp_3", row.temp_3);
        assignSensorValue(feed, "humidity_3", row.humidity_3);
        assignSensorValue(feed, "battery_v", row.battery_v);
        assignSensorValue(feed, "battery_pct", row.battery_pct);
        assignSensorValue(feed, "solar_v", row.solar_v);
        assignSensorValue(feed, "sample_id", row.sample_id);
        assignSensorValue(feed, "sync_id", row.sync_id);
        assignSensorValue(feed, "upload_id", row.upload_id);
        assignSensorValue(feed, "source_board_id", row.source_board_id);
      }
    });

    return Object.keys(byTime).map(function(ts) { return byTime[ts]; }).sort(function(a, b) {
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    });
  }

  function windowParams(windowLike) {
    var now = new Date();
    var from = windowLike && windowLike.from instanceof Date ? windowLike.from : new Date(now.getTime() - 7 * 24 * 3600000);
    var to = windowLike && windowLike.to instanceof Date ? windowLike.to : now;
    return { from: from, to: to };
  }

  async function fetchRowsForStation(stationId, windowLike, limit) {
    var station = findStation(stationId);
    if (!station) throw new Error("Unknown V4 station: " + stationId);
    var win = windowParams(windowLike);
    var effectiveLimit = Math.max(1, Math.floor(Number(limit) || 1800));
    var params = {
      select: [
        "id", "station_uid", "sample_epoch", "inserted_at",
        "sample_role", "slot_number", "source_board_id", "sample_id", "sync_id", "upload_id",
        "temp_1", "humidity_1", "temp_2", "humidity_2", "temp_3", "humidity_3",
        "battery_v", "battery_pct", "solar_v"
      ].join(","),
      station_uid: "eq." + station.station_uid,
      sample_epoch: "gte." + win.from.toISOString(),
      order: "sample_epoch.desc",
      limit: String(effectiveLimit)
    };
    var rows;
    if (isHistoryWindow(win)) {
      rows = [];
      var offset = 0;
      while (rows.length < effectiveLimit) {
        var pageParams = Object.assign({}, params, {
          order: "sample_epoch.desc",
          limit: String(Math.min(V4_HISTORY_PAGE_SIZE, effectiveLimit - rows.length)),
          offset: String(offset)
        });
        var batch = await getPostgrest("sensor_readings", pageParams, 30000);
        if (!Array.isArray(batch) || !batch.length) break;
        rows = rows.concat(batch);
        if (batch.length < Number(pageParams.limit)) break;
        offset += batch.length;
      }
    } else {
      rows = await getPostgrest("sensor_readings", params, 30000);
    }
    rows = Array.isArray(rows) ? rows.filter(function(row) {
      var ts = Date.parse(rowTime(row));
      return isFinite(ts) && ts <= win.to.getTime();
    }) : [];
    rows.sort(function(a, b) { return Date.parse(rowTime(a)) - Date.parse(rowTime(b)); });
    return { station: station, rows: rows };
  }

  async function fetchSlotRowsForStation(station) {
    try {
      var rows = await getPostgrest("active_slot_map", {
        select: "station_uid,station_name,slot_number,station_display_name,active_hub_board_id,node_board_id,node_primary_label,node_secondary_label,link_required",
        station_uid: "eq." + station.station_uid,
        order: "slot_number.asc",
        limit: "20"
      }, 15000);
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      console.warn("[V4] active_slot_map fetch failed for " + station.name + ":", err.message || err);
      return [];
    }
  }

  async function fetchSyncRowsForStation(station, windowLike, limit) {
    var win = windowParams(windowLike);
    try {
      var rows = await getPostgrest("sync_sessions", {
        select: "station_uid,hub_board_id,node_board_id,slot_number,sync_id,upload_id,sync_started_at,sync_ended_at,status,status_detail,expected_samples,received_total,transfer_mode,requested_files,received_files,received_file_rows,persisted_sd,sat_rssi_avg,sat_rssi_min,sat_drift_s,sat_battery_v,sat_flash_pct,sat_fw_ver,sat_fw_date,hello_seen,mac_ack_ok,ack_sample_id,transfer_elapsed_ms,sync_period_min,sample_period_min,boot_count,received_live,min_sample_id,max_sample_id,sync_duration_ms,last_miss_summary,t0_backlog_stop_reason,sat_file_fail_reason,t0_file_fail_detail,sync_phase,scheduled_heavy_at,service_outcome,sleep_commanded,ota_deployment_id,ota_attempt_id,ota_target_version,post_ota_fw_ver",
        station_uid: "eq." + station.station_uid,
        sync_started_at: "gte." + win.from.toISOString(),
        order: "sync_started_at.desc",
        limit: String(limit || 1000)
      }, 30000);
      rows = Array.isArray(rows) ? rows.filter(function(row) {
        var ts = row && row.sync_started_at ? Date.parse(row.sync_started_at) : NaN;
        return isFinite(ts) && ts <= win.to.getTime();
      }) : [];
      rows.forEach(function(row) {
        row.node_id = text(row.node_id || row.node_board_id).toUpperCase();
      });
      rows.sort(function(a, b) { return Date.parse(a.sync_started_at) - Date.parse(b.sync_started_at); });
      return rows;
    } catch (err) {
      console.warn("[V4] sync_sessions fetch failed for " + station.name + ":", err.message || err);
      return [];
    }
  }

  async function fetchUploadRowsForStation(station, windowLike, limit) {
    var win = windowParams(windowLike);
    try {
      var rows = await getPostgrest("upload_sessions", {
        select: "station_uid,source_board_id,upload_id,upload_started_at,upload_ended_at,boot_count,upload_duration_ms,transport,csq,espnow_sched_drift_s,abs_time_resync_drift_s,hub_rows_uploaded,sat_rows_uploaded,batches_attempted,batches_succeeded,free_heap,sd_free_kb,files_archived,config_version,config_sync_result,status,status_detail,applied_sample_period_min,applied_upload_interval_hours,applied_upload_anchor_hour_utc,applied_upload_anchor_minute_utc,applied_satellite_sync_period_hours,applied_slot_count,applied_sleep_enable,applied_deploy_mode,applied_fw_version,applied_fw_date",
        station_uid: "eq." + station.station_uid,
        upload_started_at: "gte." + win.from.toISOString(),
        order: "upload_started_at.desc",
        limit: String(limit || 500)
      }, 30000);
      rows = Array.isArray(rows) ? rows.filter(function(row) {
        var ts = row && row.upload_started_at ? Date.parse(row.upload_started_at) : NaN;
        return isFinite(ts) && ts <= win.to.getTime();
      }) : [];
      rows.sort(function(a, b) { return Date.parse(a.upload_started_at) - Date.parse(b.upload_started_at); });
      return rows;
    } catch (err) {
      console.warn("[V4] upload_sessions fetch failed for " + station.name + ":", err.message || err);
      return [];
    }
  }

  async function fetchStationPayload(stationId, windowLike, pointsTarget) {
    var pointTarget = clampPointTarget(pointsTarget, 500);
    var win = windowParams(windowLike);
    var rowLimit = isHistoryWindow(win)
      ? clampHistoryRowLimit(Math.max(pointTarget * 12, V4_HISTORY_SAFE_ROW_CAP), V4_HISTORY_SAFE_ROW_CAP)
      : clampRowLimit(Math.max(pointTarget * 6, 600), 1800);
    var result = await fetchRowsForStation(stationId, windowLike, rowLimit);
    var slotRows = await fetchSlotRowsForStation(result.station);
    var syncRows = await fetchSyncRowsForStation(result.station, windowLike, v4EgressSafeMode() ? 200 : 800);
    var uploadRows = await fetchUploadRowsForStation(result.station, windowLike, v4EgressSafeMode() ? 120 : 400);
    var slots = discoverSlots(result.rows, slotRows);
    var feeds = rowsToFeeds(result.rows, slots);
    var latestUpload = uploadRows.length ? uploadRows[uploadRows.length - 1] : null;
    return {
      source: "v4_sensor_readings",
      schema_version: "v4-browser-adapter",
      generated_at: new Date().toISOString(),
      data_as_of: result.rows.length ? rowTime(result.rows[result.rows.length - 1]) : null,
      source_label: "V4 sensor_readings",
      station_id: result.station.id,
      station_uid: result.station.station_uid,
      station_name: result.station.name,
      slot_map: nodeSlotMap(slotRows, slots),
      slot_history: slotHistoryFromRows(slotRows),
      feeds: feeds,
      device_status: result.rows.length ? {
        battery_pct: result.rows[result.rows.length - 1].battery_pct,
        last_seen: rowTime(result.rows[result.rows.length - 1]),
        last_upload_at: latestUpload ? latestUpload.upload_started_at : (result.rows[result.rows.length - 1].inserted_at || rowTime(result.rows[result.rows.length - 1])),
        next_check_in: null
      } : null,
      device_config: latestUpload ? {
        sample_period_min: latestUpload.applied_sample_period_min,
        upload_interval_hours: latestUpload.applied_upload_interval_hours,
        sat_sync_period_hours: latestUpload.applied_satellite_sync_period_hours,
        deploy_mode: latestUpload.applied_deploy_mode,
        sleep_enable: latestUpload.applied_sleep_enable,
        updated_at: latestUpload.upload_started_at
      } : null,
      sync_sessions: syncRows,
      upload_sessions: uploadRows,
      downsampling: {
        total_rows: result.rows.length,
        returned: feeds.length,
        target: pointTarget,
        row_limit: rowLimit,
        egress_safe_mode: v4EgressSafeMode()
      }
    };
  }

  function payloadToEntries(payload) {
    if (!payload || !Array.isArray(payload.feeds) || typeof feedToEntry !== "function") return [];
    var seenSlots = {};
    if (payload.slot_map) {
      Object.keys(payload.slot_map).forEach(function(key) {
        var slot = Number(payload.slot_map[key]);
        if (isFinite(slot) && slot > 0) seenSlots[slot] = true;
      });
    }
    payload.feeds.forEach(function(feed) {
      Object.keys(feed || {}).forEach(function(key) {
        var match = /^sat_(\d+)_/.exec(key);
        if (match) {
          var slot = Number(match[1]);
          if (isFinite(slot) && slot > 0) seenSlots[slot] = true;
        }
      });
    });
    var slots = Object.keys(seenSlots).map(function(key) { return Number(key); }).sort(function(a, b) { return a - b; });
    if (!slots.length) slots = [1, 2];
    return payload.feeds.map(function(feed) {
      return feedToEntry(feed, feed._discovered_slots || slots);
    }).filter(function(entry) {
      return entry && entry.timestamp instanceof Date && !isNaN(entry.timestamp.getTime());
    }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  }

  function installStationDataAdapter() {
    window.fetchEdgeStationDetail = async function() {
      var startedAt = Date.now();
      var payload = await fetchStationPayload(window.TABLE_ID || window.__TABLE_ID, getEdgeTimeWindow(), getEdgePointsTarget());
      payload._response_duration_ms = Date.now() - startedAt;
      return payload;
    };

    window.fetchStationSummaryHistory = async function() {
      var payload = await fetchStationPayload(window.TABLE_ID || window.__TABLE_ID, getStationSummaryRangeStart ? { from: getStationSummaryRangeStart(), to: new Date() } : getEdgeTimeWindow(), 500);
      var entries = edgePayloadToEntries(payload);
      if (typeof filterEntryArrayByResetWindow === "function") entries = filterEntryArrayByResetWindow(window.TABLE_ID || window.__TABLE_ID, entries);
      window.state.summaryEntries = entries;
      if (typeof saveStationSummaryCache === "function") saveStationSummaryCache(entries, { rangeStart: entries.length ? entries[0].timestamp.toISOString() : null });
      return entries;
    };
  }

  function stationSummaryFromEntries(station, entries) {
    var latest = entries.length ? entries[entries.length - 1] : null;
    return {
      station_id: station.id,
      station_uid: station.station_uid,
      station_name: station.name,
      last_update: latest ? latest.timestamp.toISOString() : null,
      latest_at: latest ? latest.timestamp.toISOString() : null,
      battery_pct: latest ? latest.t0BatPct : null,
      battery_v: latest ? latest.t0BatV : null,
      feeds: [],
      data_health: entries.length ? "ok" : "missing",
      row_count: entries.length
    };
  }

  async function buildOverviewPayload(windowLike) {
    var stationRows = stations();
    var payloadStations = [];
    for (var i = 0; i < stationRows.length; i++) {
      try {
        var detail = await fetchStationPayload(stationRows[i].id, windowLike, 180);
        var entries = payloadToEntries(detail);
        var summary = stationSummaryFromEntries(stationRows[i], entries);
        summary.feeds = detail.feeds;
        summary.slot_map = detail.slot_map;
        summary.slot_history = detail.slot_history;
        summary.sync_sessions = detail.sync_sessions;
        summary.upload_sessions = detail.upload_sessions;
        summary.device_status = detail.device_status;
        summary.device_config = detail.device_config;
        summary.source_label = detail.source_label;
        payloadStations.push(summary);
      } catch (err) {
        payloadStations.push({ station_id: stationRows[i].id, station_uid: stationRows[i].station_uid, station_name: stationRows[i].name, feeds: [], data_health: "error", error: err.message });
      }
    }
    return {
      source: "v4_sensor_readings",
      schema_version: "v4-browser-adapter",
      generated_at: new Date().toISOString(),
      data_as_of: new Date().toISOString(),
      station_count: payloadStations.length,
      stations: payloadStations
    };
  }

  function installOverviewDataAdapter() {
    window.fetchEdgeOverview = async function() {
      var startedAt = Date.now();
      var payload = await buildOverviewPayload({ from: new Date(Date.now() - 7 * 24 * 3600000), to: new Date() });
      payload._response_duration_ms = Date.now() - startedAt;
      return payload;
    };

    window.fetchStationDetailOverviewPayloadWithRetry = async function(stationId) {
      var payload = await fetchStationPayload(stationId, { from: new Date(Date.now() - 7 * 24 * 3600000), to: new Date() }, 300);
      payload.station_id = stationId;
      return payload;
    };
  }

  function installHealthDataAdapter() {
    window.fetchEdgeHealthSummaryResilient = async function(opts) {
      opts = opts || {};
      var startedAt = Date.now();
      var allRangeDays = v4EgressSafeMode() ? 30 : 90;
      var fromMs = opts.range === "all" ? Date.now() - allRangeDays * 24 * 3600000 : Date.now() - 7 * 24 * 3600000;
      var payload = await buildOverviewPayload({ from: new Date(fromMs), to: new Date() });
      payload.time_range = { from: new Date(fromMs).toISOString(), to: new Date().toISOString(), label: opts.range || "recent" };
      payload._response_duration_ms = Date.now() - startedAt;
      return payload;
    };

    window.fetchLiveAllEdge = async function() {
      var payload = await window.fetchEdgeHealthSummaryResilient({ range: "recent", force: true });
      applyEdgeHealthPayload(payload);
      rebuildHealthStations(getOpenHealthStationIds());
      return payload;
    };
  }

  applyRegistry();
  refreshSharedStationMetadataFromSupabase();

  window.SW_V4_DASHBOARD = {
    stations: stations,
    findStation: findStation,
    fetchStationPayload: fetchStationPayload,
    installStationDataAdapter: installStationDataAdapter,
    installOverviewDataAdapter: installOverviewDataAdapter,
    installHealthDataAdapter: installHealthDataAdapter,
    refreshSharedStationMetadataFromSupabase: refreshSharedStationMetadataFromSupabase
  };
})(window);
