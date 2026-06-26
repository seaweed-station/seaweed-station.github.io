(function(window) {
  "use strict";

  var AUTH_KEY = "sw_auth_v4_local";
  var BOOTSTRAP_AUTH_KEY = "sw_auth_v4_bootstrap";
  var CACHE_KEY = "sw_v4_local_station_catalog";
  var OTA_BASE_KEY = "sw_v4_local_ota_base_url";
  var STATION_META_KEY = "sw_v4_local_station_metadata";
  var ACCESS_CONTROL_CACHE_KEY = "sw_v4_access_control_cache";
  var DEFAULT_OTA_BASE = "http://localhost:8088";
  var DEFAULT_V4_SUPABASE_URL = "https://iyoihlwtvdshtlzjdoed.supabase.co";
  var DEFAULT_V4_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5b2lobHd0dmRzaHRsempkb2VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTA4MTksImV4cCI6MjA5MjI4NjgxOX0.i3jy8WlSF72v7Ypb2ulkL12EJaDfGcDYbdiC--PgjOc";
  var BOOTSTRAP_ADMIN_PASSWORD = "changeme";
  var ROOT_COMPAT_PASSWORD = "k";
  var CATALOG_TTL_MS = 2 * 60 * 1000;

  var CANONICAL_BATI_STATION = {
    station_uid: "ST-0102",
    station_key: "bati",
    station_name: "Bati",
    legacy_device_id: "tb-02",
    data_folder: "data_tb-02"
  };

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function parseUtcOffsetMinutes(value) {
    var raw = text(value);
    if (!raw || /^(utc|gmt|z)$/i.test(raw)) return 0;
    var compact = raw.replace(/\s+/g, "").replace(/^GMT/i, "UTC");
    var match = /^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(compact);
    if (!match) return 0;
    var hours = Number(match[2]);
    var minutes = match[3] == null ? 0 : Number(match[3]);
    if (!isFinite(hours) || !isFinite(minutes) || hours > 14 || minutes >= 60) return 0;
    var total = hours * 60 + minutes;
    return match[1] === "-" ? -total : total;
  }

  function normalizeDisplayTime(value) {
    var raw = text(value);
    if (!raw) return "";
    var minutes = parseUtcOffsetMinutes(raw);
    if (!minutes) return "UTC +0";
    var sign = minutes < 0 ? "-" : "+";
    var abs = Math.abs(minutes);
    var hours = Math.floor(abs / 60);
    var mins = abs % 60;
    return "UTC " + sign + hours + (mins ? ":" + String(mins).padStart(2, "0") : "");
  }

  function displayTimeLabel(value) {
    return normalizeDisplayTime(value) || "UTC +0";
  }

  function formatWithUtcOffset(value, displayTime, options) {
    if (!value) return "--";
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return text(value) || "--";
    options = options || {};
    var shifted = new Date(d.getTime() + parseUtcOffsetMinutes(displayTime) * 60000);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var datePart = String(shifted.getUTCDate()).padStart(2, "0") + " " + months[shifted.getUTCMonth()];
    if (options.year) datePart += " " + shifted.getUTCFullYear();
    if (options.weekday) datePart = weekdays[shifted.getUTCDay()] + " " + datePart;
    if (options.time === false) return datePart + (options.label === false ? "" : " " + displayTimeLabel(displayTime));
    return datePart + " " + String(shifted.getUTCHours()).padStart(2, "0") + ":" +
      String(shifted.getUTCMinutes()).padStart(2, "0") +
      (options.label === false ? "" : " " + displayTimeLabel(displayTime));
  }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slug(value, fallback) {
    var raw = text(value) || text(fallback) || "station";
    var out = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return out || "station";
  }

  function isBatiCatalogRow(row) {
    if (!row) return false;
    var keys = [
      text(row.station_uid).toLowerCase(),
      text(row.station_key).toLowerCase(),
      text(row.legacy_device_id).toLowerCase(),
      text(row.station_name).toLowerCase()
    ];
    (Array.isArray(row.historical_source_keys) ? row.historical_source_keys : []).forEach(function(item) {
      keys.push(text(item).toLowerCase());
    });
    return keys.indexOf("st-0102") !== -1 || keys.indexOf("tb-02") !== -1 || keys.indexOf("bati") !== -1;
  }

  function applyCanonicalBatiStation(row) {
    if (!isBatiCatalogRow(row)) return row;
    var historical = Array.isArray(row.historical_source_keys) ? row.historical_source_keys.slice() : [];
    if (historical.indexOf(CANONICAL_BATI_STATION.legacy_device_id) === -1) historical.unshift(CANONICAL_BATI_STATION.legacy_device_id);
    return Object.assign({}, row, CANONICAL_BATI_STATION, {
      historical_source_keys: historical,
      catalog_aliases: ["st-0102", "bati", "tb-02"].concat(historical.map(function(item) { return text(item).toLowerCase(); }))
    });
  }

  function uniqueKey(base, used) {
    var key = base || "station";
    if (!used[key]) {
      used[key] = true;
      return key;
    }
    var idx = 2;
    while (used[key + "-" + idx]) idx += 1;
    used[key + "-" + idx] = true;
    return key + "-" + idx;
  }

  function getQueryParam(name) {
    try { return new URLSearchParams(location.search).get(name) || ""; } catch (_) { return ""; }
  }

  function getOtaBaseUrl() {
    var fromQuery = text(getQueryParam("otaBaseUrl"));
    if (fromQuery) {
      localStorage.setItem(OTA_BASE_KEY, fromQuery.replace(/\/+$/, ""));
      return fromQuery.replace(/\/+$/, "");
    }
    return text(localStorage.getItem(OTA_BASE_KEY)) || DEFAULT_OTA_BASE;
  }

  function readStationMetadataMap() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STATION_META_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function metadataForStation(row, stationUid, stationKey, legacyId) {
    var map = readStationMetadataMap();
    return map[stationUid] || map[stationKey] || map[legacyId] || {};
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
        displayOrder: Number(row.displayOrder),
        installDateUtc: text(row.installDateUtc),
        datasetStatus: text(row.datasetStatus || "active"),
        datasetEndUtc: text(row.datasetEndUtc),
        datasetEndNote: text(row.datasetEndNote),
        lat: row.lat === "" || row.lat == null ? null : Number(row.lat),
        lon: row.lon === "" || row.lon == null ? null : Number(row.lon),
        displayTime: normalizeDisplayTime(row.displayTime || row.display_time)
      };
    });
    localStorage.setItem(STATION_META_KEY, JSON.stringify(map));
    return map;
  }

  function stationMetadataRowsFromMap(map) {
    if (!map || typeof map !== "object") return [];
    return Object.keys(map).map(function(key) {
      var row = map[key] || {};
      return Object.assign({ station_uid: key }, row);
    });
  }

  function sanitizeStationMetadataRow(row, fallbackOrder) {
    row = row || {};
    var stationUid = text(row.station_uid || row.stationUid);
    var stationKey = text(row.station_key || row.stationKey);
    var displayOrder = Number(row.displayOrder);
    return {
      station_uid: stationUid,
      station_key: stationKey,
      enabled: row.enabled !== false,
      displayOrder: isFinite(displayOrder) ? displayOrder : fallbackOrder,
      installDateUtc: text(row.installDateUtc),
      datasetStatus: text(row.datasetStatus || "active"),
      datasetEndUtc: text(row.datasetEndUtc),
      datasetEndNote: text(row.datasetEndNote),
      lat: row.lat === "" || row.lat == null ? null : Number(row.lat),
      lon: row.lon === "" || row.lon == null ? null : Number(row.lon),
      displayTime: normalizeDisplayTime(row.displayTime || row.display_time)
    };
  }

  function stationMetadataRows(payload) {
    var rows = [];
    if (Array.isArray(payload)) rows = payload;
    else if (payload && Array.isArray(payload.stations)) rows = payload.stations;
    return rows.map(sanitizeStationMetadataRow).filter(function(row) {
      return row.station_uid || row.station_key;
    });
  }

  function stationMetadataProjectFromCatalog(catalog) {
    var stations = catalog && Array.isArray(catalog.stations) ? catalog.stations : [];
    for (var i = 0; i < stations.length; i++) {
      var station = stations[i];
      if (!supportsV4ReadModels(station)) continue;
      if (station.supabase_url && station.supabase_anon_key) {
        return { url: station.supabase_url.replace(/\/+$/, ""), key: station.supabase_anon_key };
      }
    }
    return { url: DEFAULT_V4_SUPABASE_URL, key: DEFAULT_V4_SUPABASE_ANON_KEY };
  }

  function cleanV4RegistryProjectFromCatalog(catalog) {
    var profiles = catalog && Array.isArray(catalog.project_profiles) ? catalog.project_profiles : [];
    var cleanProfile = null;
    for (var p = 0; p < profiles.length; p++) {
      var profile = profiles[p] || {};
      var profileId = text(profile.profile_id || profile.project_profile_id);
      var label = text(profile.label);
      if (text(profile.schema_family).toLowerCase() !== "v4") continue;
      if (profileId.toLowerCase().indexOf("transition") !== -1) continue;
      if (label.toLowerCase().indexOf("v3") !== -1) continue;
      cleanProfile = {
        profile_id: profileId || "v4-clean-bench",
        label: label || profileId || "V4 Superbase",
        schema_family: "v4"
      };
      break;
    }

    var project = stationMetadataProjectFromCatalog(catalog);
    return Object.assign({}, project, cleanProfile || {
      profile_id: "v4-clean-bench",
      label: "V4 Superbase",
      schema_family: "v4"
    });
  }

  async function fetchCleanV4StationRegistry(project) {
    return await fetchJson(
      project.url + "/rest/v1/station_registry?select=station_uid,station_name,active,notes&active=eq.true&limit=500",
      12000,
      { headers: supabaseHeaders(project.key) }
    );
  }

  function mergeCleanV4StationRegistry(catalog, rows, project) {
    rows = Array.isArray(rows) ? rows : [];
    if (!catalog || !rows.length) return catalog;
    var byUid = {};
    var order = [];
    (Array.isArray(catalog.stations) ? catalog.stations : []).forEach(function(station) {
      var stationUid = text(station.station_uid);
      if (!stationUid) return;
      byUid[stationUid] = station;
      order.push(stationUid);
    });
    rows.forEach(function(row) {
      var stationUid = text(row.station_uid);
      if (!stationUid) return;
      var existing = byUid[stationUid] || {};
      if (!byUid[stationUid]) order.push(stationUid);
      byUid[stationUid] = Object.assign({}, existing, {
        station_uid: stationUid,
        station_key: text(existing.station_key) || slug(row.station_name, stationUid),
        station_name: text(row.station_name || existing.station_name || stationUid),
        active: row.active !== false,
        notes: text(row.notes || existing.notes),
        project_profile_id: project.profile_id,
        project_label: project.label,
        schema_family: "v4",
        supabase_url: project.url,
        supabase_anon_key: project.key
      });
    });
    catalog.stations = order.map(function(stationUid) { return byUid[stationUid]; }).filter(Boolean);
    catalog.v4_station_registry_at = new Date().toISOString();
    return catalog;
  }

  async function pullCleanV4StationRegistryForCatalog(catalog) {
    var project = cleanV4RegistryProjectFromCatalog(catalog);
    try {
      return mergeCleanV4StationRegistry(catalog, await fetchCleanV4StationRegistry(project), project);
    } catch (err) {
      catalog.v4_station_registry_error = err.message || String(err || "V4 station registry merge failed");
      return catalog;
    }
  }

  function applyStationMetadataRows(catalog, rows) {
    rows = stationMetadataRows(rows);
    if (!catalog || !Array.isArray(catalog.stations) || !rows.length) return catalog;
    var byKey = {};
    rows.forEach(function(row) {
      if (row.station_uid) byKey[row.station_uid] = row;
      if (row.station_key) byKey[row.station_key] = row;
    });
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
        displayTime: normalizeDisplayTime(meta.displayTime)
      });
    });
    catalog.shared_station_metadata_at = new Date().toISOString();
    return catalog;
  }

  function isMissingStationMetadataRpcError(err) {
    var msg = String(err && err.message ? err.message : err || "").toLowerCase();
    return msg.indexOf("pgrst202") !== -1 ||
      msg.indexOf("could not find the function") !== -1 ||
      msg.indexOf("searched for the function") !== -1 ||
      msg.indexOf("dashboard_get_station_metadata") !== -1 ||
      msg.indexOf("dashboard_upsert_station_metadata") !== -1;
  }

  function isMissingAlertSettingsRpcError(err) {
    var msg = String(err && err.message ? err.message : err || "").toLowerCase();
    return msg.indexOf("pgrst202") !== -1 ||
      msg.indexOf("could not find the function") !== -1 ||
      msg.indexOf("searched for the function") !== -1 ||
      msg.indexOf("dashboard_get_v4_alert_settings") !== -1 ||
      msg.indexOf("dashboard_get_v4_alert_overview") !== -1 ||
      msg.indexOf("dashboard_upsert_v4_alert_settings") !== -1 ||
      msg.indexOf("dashboard_delete_v4_alert_setting") !== -1 ||
      msg.indexOf("dashboard_set_v4_alert_silence") !== -1;
  }

  async function fetchStationMetadataFromSupabase(project) {
    var res = await fetchJson(project.url + "/rest/v1/rpc/dashboard_get_station_metadata", 12000, {
      method: "POST",
      headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
      body: "{}"
    });
    var rows = stationMetadataRows(res);
    if (rows.length) {
      var localMap = readStationMetadataMap();
      rows = rows.map(function(row) {
        if (row.displayTime) return row;
        var local = localMap[row.station_uid] || localMap[row.station_key];
        return local && local.displayTime ? Object.assign({}, row, { displayTime: local.displayTime }) : row;
      });
    }
    if (rows.length) writeStationMetadataMap(rows);
    return rows;
  }

  async function pullStationMetadataForCatalog(catalog) {
    var project = stationMetadataProjectFromCatalog(catalog);
    try {
      var rows = await fetchStationMetadataFromSupabase(project);
      return applyStationMetadataRows(catalog, rows);
    } catch (err) {
      if (!isMissingStationMetadataRpcError(err)) {
        catalog.shared_station_metadata_error = err.message || String(err || "Shared station metadata failed");
      }
      return applyStationMetadataRows(catalog, stationMetadataRowsFromMap(readStationMetadataMap()));
    }
  }

  function setOtaBaseUrl(value) {
    var normalized = text(value).replace(/\/+$/, "");
    if (!normalized) normalized = DEFAULT_OTA_BASE;
    localStorage.setItem(OTA_BASE_KEY, normalized);
    return normalized;
  }

  function isAuthenticated() {
    return sessionStorage.getItem(AUTH_KEY) === "ok" || sessionStorage.getItem("sw_auth") === "ok";
  }

  function requireAuth() {
    if (isAuthenticated()) return true;
    location.replace("login.html?r=" + encodeURIComponent(location.href));
    return false;
  }

  function markAuthenticated(role) {
    sessionStorage.setItem(AUTH_KEY, "ok");
    sessionStorage.setItem("sw_auth", "ok");
    if (role && role.bootstrap) sessionStorage.setItem(BOOTSTRAP_AUTH_KEY, "ok");
    else sessionStorage.removeItem(BOOTSTRAP_AUTH_KEY);
    if (role && role.roleId) sessionStorage.setItem("sw_role", role.roleId);
    if (role && role.allowedStations) sessionStorage.setItem("sw_allowed_stations", JSON.stringify(role.allowedStations));
    if (role && role.features) sessionStorage.setItem("sw_features", JSON.stringify(role.features));
  }

  function rememberSessionAdminPassword(password) {
    var pwd = text(password);
    if (pwd) sessionStorage.setItem("sw_v4_admin_password_session", pwd);
  }

  function sessionAdminPassword() {
    return sessionStorage.getItem("sw_v4_admin_password_session") || "";
  }

  function signOut() {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(BOOTSTRAP_AUTH_KEY);
    sessionStorage.removeItem("sw_auth");
    sessionStorage.removeItem("sw_role");
    sessionStorage.removeItem("sw_allowed_stations");
    sessionStorage.removeItem("sw_features");
    sessionStorage.removeItem("sw_v4_admin_password_session");
    location.replace("login.html");
  }

  async function fetchJson(url, timeoutMs, opts) {
    timeoutMs = timeoutMs || 15000;
    opts = opts || {};
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
    try {
      var res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
      var bodyText = await res.text();
      var data = bodyText ? JSON.parse(bodyText) : null;
      if (!res.ok) throw new Error("HTTP " + res.status + (bodyText ? " " + bodyText.slice(0, 160) : ""));
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function cachedCatalog() {
    try {
      var parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!parsed || !Array.isArray(parsed.stations)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCatalogCache(catalog) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(catalog)); } catch (_) {}
  }

  function normalizeStation(row, usedKeys) {
    row = row || {};
    var stationUid = text(row.station_uid);
    var stationName = text(row.station_name || stationUid);
    var stationKey = uniqueKey(text(row.station_key) || slug(stationName, stationUid), usedKeys);
    var historical = Array.isArray(row.historical_source_keys) ? row.historical_source_keys.map(text).filter(Boolean) : [];
    if (row.legacy_device_id && historical.indexOf(text(row.legacy_device_id)) === -1) historical.unshift(text(row.legacy_device_id));
    var legacyId = text(row.legacy_device_id || historical[0]);
    var meta = metadataForStation(row, stationUid, stationKey, legacyId);
    var latValue = meta.lat !== undefined ? meta.lat : row.lat;
    var lonValue = meta.lon !== undefined ? meta.lon : row.lon;
    var displayTimeValue = meta.displayTime !== undefined ? meta.displayTime : (row.displayTime || row.display_time);
    return applyCanonicalBatiStation(Object.assign({}, row, {
      station_uid: stationUid,
      station_key: stationKey,
      station_name: stationName,
      active: meta.enabled !== undefined ? meta.enabled !== false : row.active !== false,
      project_profile_id: text(row.project_profile_id || row.default_project_profile_id),
      project_label: text(row.project_label || row.default_project_label || row.project_profile_id || row.default_project_profile_id),
      schema_family: text(row.schema_family || row.default_project_schema_family).toLowerCase(),
      supabase_url: text(row.supabase_url || DEFAULT_V4_SUPABASE_URL).replace(/\/+$/, ""),
      supabase_anon_key: text(row.supabase_anon_key || row.anon_key || DEFAULT_V4_SUPABASE_ANON_KEY),
      legacy_device_id: legacyId,
      historical_source_keys: historical,
      catalog_aliases: [stationUid.toLowerCase(), stationKey].concat(historical.map(function(item) { return item.toLowerCase(); })),
      slots: Array.isArray(row.slots) ? row.slots : [],
      slot_count: Number(row.slot_count != null ? row.slot_count : (Array.isArray(row.slots) ? row.slots.length : 0)) || 0,
      expected_sample_interval_s: Number(row.expected_sample_interval_s) || 600,
      expected_sync_interval_s: Number(row.expected_sync_interval_s) || 3600,
      displayOrder: meta.displayOrder != null && isFinite(Number(meta.displayOrder)) ? Number(meta.displayOrder) : null,
      installDateUtc: text(meta.installDateUtc),
      datasetStatus: text(meta.datasetStatus || "active"),
      datasetEndUtc: text(meta.datasetEndUtc),
      datasetEndNote: text(meta.datasetEndNote),
      lat: latValue === "" || latValue == null ? null : Number(latValue),
      lon: lonValue === "" || lonValue == null ? null : Number(lonValue),
      displayTime: normalizeDisplayTime(displayTimeValue),
      data_folder: text(row.data_folder)
    }));
  }

  function transformStationInventory(payload) {
    payload = payload || {};
    var used = {};
    var stations = (payload.stations || []).map(function(row) {
      return normalizeStation({
        station_uid: row.station_uid,
        station_key: slug(row.station_name, row.station_uid),
        station_name: row.station_name,
        active: row.active,
        assignment_version: row.assignment_version,
        project_profile_id: row.default_project_profile_id,
        project_label: row.default_project_label,
        schema_family: row.default_project_schema_family,
        legacy_device_id: row.legacy_device_id,
        historical_source_keys: row.legacy_device_id ? [row.legacy_device_id] : [],
        hub_board_id: row.hub_board_id,
        hub_device_id: row.hub_device_id,
        hub_name: row.hub_name,
        hub_ip: row.hub_ip,
        slots: row.slots || [],
        slot_count: (row.slots || []).length,
        notes: row.notes,
        supabase_sync_status: row.supabase_sync_status,
        supabase_sync_label: row.supabase_sync_label,
        relink_requested: row.relink_requested
      }, used);
    });
    return {
      catalog_version: 0,
      generated_at: new Date().toISOString(),
      source: "ota_dashboard_station_inventory_fallback",
      stations: stations,
      project_profiles: payload.project_profiles || [],
      summary: payload.summary || { stations: stations.length }
    };
  }

  function normalizeCatalog(payload, sourceUrl) {
    if (!payload) throw new Error("Empty catalog response");
    if (!payload.catalog_version) return transformStationInventory(payload);
    var used = {};
    var stations = (payload.stations || []).map(function(row) { return normalizeStation(row, used); });
    return Object.assign({}, payload, {
      source_url: sourceUrl || "",
      fetched_at: new Date().toISOString(),
      stations: stations,
      project_profiles: Array.isArray(payload.project_profiles) ? payload.project_profiles : []
    });
  }

  async function loadCatalog(options) {
    options = options || {};
    var cached = cachedCatalog();
    if (!options.force && cached && cached.fetched_at && Date.now() - Date.parse(cached.fetched_at) < CATALOG_TTL_MS) {
      return await pullStationMetadataForCatalog(Object.assign({}, cached, { from_cache: true }));
    }

    var base = getOtaBaseUrl();
    var primaryUrl = base + "/api/stations";
    try {
      var catalog = await pullStationMetadataForCatalog(
        await pullCleanV4StationRegistryForCatalog(normalizeCatalog(await fetchJson(primaryUrl, 15000), primaryUrl))
      );
      writeCatalogCache(catalog);
      return catalog;
    } catch (primaryErr) {
      try {
        var fallbackUrl = base + "/api/seaweed/station-catalog";
        var fallback = await pullStationMetadataForCatalog(
          await pullCleanV4StationRegistryForCatalog(normalizeCatalog(await fetchJson(fallbackUrl, 15000), fallbackUrl))
        );
        fallback.primary_error = primaryErr.message;
        writeCatalogCache(fallback);
        return fallback;
      } catch (fallbackErr) {
        if (cached) return Object.assign({}, cached, { from_cache: true, refresh_error: fallbackErr.message || primaryErr.message });
        throw primaryErr;
      }
    }
  }

  function resolveStation(catalog, requested) {
    var wanted = text(requested || getQueryParam("station") || getQueryParam("table")).toLowerCase();
    var stations = catalog && Array.isArray(catalog.stations) ? catalog.stations : [];
    if (!wanted && stations.length) return stations[0];
    for (var i = 0; i < stations.length; i++) {
      var station = stations[i];
      var aliases = station.catalog_aliases || [];
      if (station.station_key.toLowerCase() === wanted || station.station_uid.toLowerCase() === wanted || aliases.indexOf(wanted) !== -1) return station;
    }
    return null;
  }

  function stationUrl(page, station) {
    return page + "?station=" + encodeURIComponent(station.station_key);
  }

  function stationHeaders(station) {
    return {
      apikey: station.supabase_anon_key,
      Authorization: "Bearer " + station.supabase_anon_key
    };
  }

  function supabaseHeaders(key) {
    return {
      apikey: key,
      Authorization: "Bearer " + key
    };
  }

  function postgrestQuery(params) {
    return Object.keys(params).map(function(key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    }).join("&");
  }

  function stationAuthProject(station) {
    if (station && station.supabase_url && station.supabase_anon_key) {
      return { url: text(station.supabase_url).replace(/\/+$/, ""), key: text(station.supabase_anon_key) };
    }
    return getV4AuthProject();
  }

  async function getV4AuthProject() {
    var fallback = { url: DEFAULT_V4_SUPABASE_URL, key: DEFAULT_V4_SUPABASE_ANON_KEY };
    try {
      var catalog = cachedCatalog();
      if (catalog) return stationMetadataProjectFromCatalog(catalog);
    } catch (_) {}
    return fallback;
  }

  function normalizeAccessRoleFeatures(role) {
    role = role || {};
    var features = role.features && typeof role.features === "object" ? role.features : null;
    return {
      settings: features ? features.settings !== false : role.canViewSettings !== false,
      battery: features ? features.battery !== false : role.canViewBattery !== false,
      stationHealth: features ? features.stationHealth !== false : role.canViewStationHealth !== false,
      tableConfigurationView: features ? features.tableConfigurationView !== false : role.canViewTableConfiguration !== false,
      tableConfigurationEdit: features ? features.tableConfigurationEdit === true : role.canEditTableConfiguration === true
    };
  }

  function normalizeAccessRoleStations(stations) {
    if (!Array.isArray(stations)) return ["*"];
    if (!stations.length) return [];
    if (stations.indexOf("*") !== -1) return ["*"];
    var seen = {};
    var out = [];
    stations.forEach(function(item) {
      var station = text(item).toLowerCase();
      if (!station || seen[station]) return;
      seen[station] = true;
      out.push(station);
    });
    return out;
  }

  function sanitizeAccessRole(role) {
    if (!role || typeof role !== "object") return null;
    var roleId = text(role.roleId);
    if (!roleId) return null;
    return {
      roleId: roleId,
      password: "",
      allowedStations: normalizeAccessRoleStations(role.allowedStations),
      features: normalizeAccessRoleFeatures(role)
    };
  }

  function bootstrapAdminRole() {
    return {
      roleId: "admin",
      password: "",
      allowedStations: ["*"],
      features: { settings: true, battery: true, stationHealth: true, tableConfigurationView: true, tableConfigurationEdit: true }
    };
  }

  function rootCompatRole() {
    return {
      roleId: "root-viewer",
      password: "",
      allowedStations: ["*"],
      features: { settings: false, battery: true, stationHealth: true, tableConfigurationView: true, tableConfigurationEdit: false },
      compatibility: true
    };
  }

  function isMissingAccessRoleRpcError(err) {
    var msg = String(err && err.message ? err.message : err || "").toLowerCase();
    return msg.indexOf("pgrst202") !== -1 ||
      msg.indexOf("could not find the function") !== -1 ||
      msg.indexOf("searched for the function") !== -1 ||
      msg.indexOf("dashboard_get_access_roles") !== -1 ||
      msg.indexOf("dashboard_authenticate_access_role") !== -1 ||
      msg.indexOf("dashboard_upsert_access_roles") !== -1;
  }

  function extractRoleArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.roles)) return payload.roles;
    return [];
  }

  function storeAccessRoles(roles) {
    var sanitized = extractRoleArray(roles).map(sanitizeAccessRole).filter(Boolean);
    try { localStorage.setItem(ACCESS_CONTROL_CACHE_KEY, JSON.stringify({ roles: sanitized })); } catch (_) {}
    return sanitized;
  }

  function cachedAccessRoles() {
    try { return storeAccessRoles(extractRoleArray(JSON.parse(localStorage.getItem(ACCESS_CONTROL_CACHE_KEY) || "null"))); } catch (_) {}
    return [];
  }

  async function fetchAccessRoleDefinitions() {
    var project = await getV4AuthProject();
    try {
      var res = await fetchJson(project.url + "/rest/v1/rpc/dashboard_get_access_roles", 12000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: "{}"
      });
      return storeAccessRoles(res);
    } catch (err) {
      var cached = cachedAccessRoles();
      if (cached.length) return cached;
      throw err;
    }
  }

  async function authenticateAccessRole(password) {
    var pwd = text(password);
    if (!pwd) return null;
    var project = await getV4AuthProject();
    var res;
    try {
      res = await fetchJson(project.url + "/rest/v1/rpc/dashboard_authenticate_access_role", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({ p_password: pwd })
      });
    } catch (err) {
      if (isMissingAccessRoleRpcError(err)) {
        if (pwd === BOOTSTRAP_ADMIN_PASSWORD) {
          var bootstrapRole = bootstrapAdminRole();
          storeAccessRoles([bootstrapRole]);
          return Object.assign({ bootstrap: true }, bootstrapRole);
        }
        throw new Error("V4 access roles are not installed yet. Use the temporary admin password 'changeme', or apply the V4 access-control SQL amendment.");
      }
      throw err;
    }
    if (!res || res.authenticated !== true || !res.role) {
      if (pwd === ROOT_COMPAT_PASSWORD) return rootCompatRole();
      return null;
    }
    var role = sanitizeAccessRole(res.role);
    if (role) storeAccessRoles([role]);
    return role;
  }

  async function pushAccessControlToSupabase(roles, adminPassword) {
    var project = await getV4AuthProject();
    var res;
    try {
      res = await fetchJson(project.url + "/rest/v1/rpc/dashboard_upsert_access_roles", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({ p_admin_password: text(adminPassword), p_roles: Array.isArray(roles) ? roles : [] })
      });
    } catch (err) {
      if (isMissingAccessRoleRpcError(err)) {
        throw new Error("V4 access-role RPCs are not installed yet. Apply the V4 access-control SQL amendment before pushing roles.");
      }
      throw err;
    }
    return storeAccessRoles(res);
  }

  async function pushStationMetadataToSupabase(rows, adminPassword) {
    var project = await getV4AuthProject();
    var sanitized = stationMetadataRows(Array.isArray(rows) ? rows : []);
    var res;
    try {
      res = await fetchJson(project.url + "/rest/v1/rpc/dashboard_upsert_station_metadata", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({ p_admin_password: text(adminPassword), p_rows: sanitized })
      });
    } catch (err) {
      if (isMissingStationMetadataRpcError(err)) {
        throw new Error("V4 shared station metadata RPCs are not installed yet. Apply the shared station metadata SQL amendment before pushing station order.");
      }
      throw err;
    }
    var savedRows = stationMetadataRows(res);
    if (savedRows.length) {
      var submittedByKey = {};
      sanitized.forEach(function(row) {
        if (row.station_uid) submittedByKey[row.station_uid] = row;
        if (row.station_key) submittedByKey[row.station_key] = row;
      });
      savedRows = savedRows.map(function(row) {
        if (row.displayTime) return row;
        var submitted = submittedByKey[row.station_uid] || submittedByKey[row.station_key];
        return submitted && submitted.displayTime ? Object.assign({}, row, { displayTime: submitted.displayTime }) : row;
      });
    }
    writeStationMetadataMap(savedRows.length ? savedRows : sanitized);
    return savedRows.length ? savedRows : sanitized;
  }

  async function fetchV4AlertSettings() {
    var project = await getV4AuthProject();
    try {
      return await fetchJson(project.url + "/rest/v1/rpc/dashboard_get_v4_alert_settings", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: "{}"
      });
    } catch (err) {
      if (isMissingAlertSettingsRpcError(err)) {
        throw new Error("V4 alert settings RPCs are not installed yet. Apply the V4 alert-settings SQL amendment before managing alerts.");
      }
      throw err;
    }
  }

  async function fetchV4AlertOverview() {
    var project = await getV4AuthProject();
    try {
      return await fetchJson(project.url + "/rest/v1/rpc/dashboard_get_v4_alert_overview", 20000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: "{}"
      });
    } catch (err) {
      if (isMissingAlertSettingsRpcError(err)) {
        throw new Error("V4 alert overview RPC is not installed yet. Reapply the V4 alert-settings SQL amendment.");
      }
      var settings = await fetchV4AlertSettings();
      settings.current_alert_error = err.message || String(err || "Current alert computation failed");
      return {
        settings: settings,
        alerts: [],
        current_alerts: [],
        current_alert_error: settings.current_alert_error,
        updatedAt: new Date().toISOString()
      };
    }
  }

  async function fetchV4LatestUploadHints(stationUids) {
    var project = await getV4AuthProject();
    var seen = {};
    var ids = (Array.isArray(stationUids) ? stationUids : []).map(text).filter(function(id) {
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
    if (!ids.length) return {};
    var inList = ids.map(function(id) {
      return encodeURIComponent(id);
    }).join(",");
    var url = project.url +
      "/rest/v1/upload_sessions?select=station_uid,upload_started_at,applied_upload_interval_hours,applied_upload_anchor_hour_utc,applied_upload_anchor_minute_utc,status" +
      "&status=eq.ok" +
      "&station_uid=in.(" + inList + ")" +
      "&order=upload_started_at.desc" +
      "&limit=200";
    var rows = await fetchJson(url, 15000, {
      headers: supabaseHeaders(project.key)
    });
    var out = {};
    (Array.isArray(rows) ? rows : []).forEach(function(row) {
      var stationUid = text(row && row.station_uid);
      if (!stationUid || out[stationUid]) return;
      out[stationUid] = {
        last_upload_started_at: row.upload_started_at,
        expected_upload_hours: Number(row.applied_upload_interval_hours) || null,
        upload_anchor_hour_utc: row.applied_upload_anchor_hour_utc == null ? null : Number(row.applied_upload_anchor_hour_utc),
        upload_anchor_minute_utc: row.applied_upload_anchor_minute_utc == null ? null : Number(row.applied_upload_anchor_minute_utc)
      };
    });
    return out;
  }

  function v4AlertIdentity(alert) {
    alert = alert || {};
    var details = alert.details_json || {};
    if (alert.alert_identity) return text(alert.alert_identity);
    var suffix = text(details.alert_detail_key || details.sensor_key);
    return [
      text(alert.station_uid),
      text(alert.alert_key),
      alert.slot_number === null || alert.slot_number === undefined ? "_" : text(alert.slot_number)
    ].join("|") + (suffix ? "|" + suffix : "");
  }

  async function fetchV4AlertSilences() {
    var project = await getV4AuthProject();
    var url = project.url +
      "/rest/v1/v4_alert_silences?select=alert_identity,silence_reason,silenced_at,updated_at&limit=500";
    try {
      var rows = await fetchJson(url, 2500, {
        headers: supabaseHeaders(project.key)
      });
      var out = {};
      (Array.isArray(rows) ? rows : []).forEach(function(row) {
        if (!row || !row.alert_identity) return;
        out[row.alert_identity] = row;
      });
      return out;
    } catch (_) {
      return {};
    }
  }

  async function fetchV4OpenAlertInstances() {
    var project = await getV4AuthProject();
    var url = project.url +
      "/rest/v1/v4_alert_instances?select=" +
      [
        "id",
        "alert_identity",
        "station_uid",
        "station_name",
        "alert_key",
        "slot_number",
        "severity",
        "status",
        "opened_at",
        "updated_at",
        "last_notified_at",
        "last_reminder_at",
        "notification_count",
        "value_text",
        "threshold_text",
        "details_json"
      ].join(",") +
      "&status=eq.open" +
      "&order=severity.desc,updated_at.desc" +
      "&limit=200";
    var result = await Promise.all([
      fetchJson(url, 15000, { headers: supabaseHeaders(project.key) }),
      fetchV4AlertSilences()
    ]);
    var rows = result[0];
    var silences = result[1] || {};
    return (Array.isArray(rows) ? rows : []).map(function(row) {
      var silence = silences[row.alert_identity];
      var details = row.details_json || {};
      return Object.assign({}, row, {
        instance_opened_at: row.opened_at,
        instance_updated_at: row.updated_at,
        silenced: Boolean(silence) || row.silenced === true || details.silenced === true,
        silence_reason: silence ? (silence.silence_reason || "identity_silenced") : (row.silence_reason || details.silence_reason),
        silenced_at: silence ? silence.silenced_at : row.silenced_at,
        fallback_source: "open_alert_instances"
      });
    });
  }

  function fallbackAlertHistoryRowsFromInstances(rows) {
    return (Array.isArray(rows) ? rows : []).map(function(row) {
      var status = text(row.status || "open");
      var kind = status === "cleared" ? "recovery" :
        row.last_reminder_at ? "reminder" :
        row.severity === "critical" && Number(row.notification_count || 0) > 0 ? "escalation" :
        "open";
      var label = text(row.station_name || row.station_uid || "Unknown station");
      var alertLabel = text((row.alert_key || "").replace(/_/g, " "));
      var prefix = kind === "recovery" ? "[RECOVERY]" :
        kind === "reminder" ? "[REMINDER " + text(row.severity || "warning").toUpperCase() + "]" :
        kind === "escalation" ? "[ESCALATED]" :
        "[" + text(row.severity || "warning").toUpperCase() + "]";
      return {
        id: text(row.id),
        alert_identity: text(row.alert_identity),
        alert_instance_id: text(row.id),
        station_uid: text(row.station_uid),
        station_name: label,
        alert_key: text(row.alert_key),
        slot_number: row.slot_number,
        severity: text(row.severity || "warning"),
        notification_kind: kind,
        subject: prefix + " " + label + " - " + alertLabel,
        message_text: [
          prefix + " " + label + " - " + alertLabel,
          "Station: " + label + " (" + text(row.station_uid) + ")",
          "Scope: " + (row.slot_number == null ? "Hub" : "Slot " + row.slot_number),
          "Current: " + text(row.value_text || "-"),
          "Threshold: " + text(row.threshold_text || "-")
        ].join("\n"),
        delivery_channel: "instance",
        delivered: Number(row.notification_count || 0) > 0 || status === "cleared",
        delivered_at: row.last_notified_at || row.cleared_at || row.updated_at || row.opened_at,
        fallback_source: "v4_alert_instances"
      };
    });
  }

  async function fetchV4AlertNotificationHistory(limit) {
    var project = await getV4AuthProject();
    var cappedLimit = Math.max(1, Math.min(20, Number(limit) || 20));
    try {
      var payload = await fetchJson(project.url + "/rest/v1/rpc/dashboard_get_v4_alert_notification_history", 10000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({ p_limit: cappedLimit })
      });
      return Array.isArray(payload && payload.rows) ? payload.rows : [];
    } catch (err) {
      var msg = String(err && err.message ? err.message : err || "").toLowerCase();
      if (
        msg.indexOf("dashboard_get_v4_alert_notification_history") === -1 &&
        msg.indexOf("pgrst202") === -1 &&
        msg.indexOf("could not find the function") === -1 &&
        msg.indexOf("v4_alert_notification_log") === -1
      ) {
        throw err;
      }
      var fallbackUrl = project.url +
        "/rest/v1/v4_alert_instances?select=" +
        [
          "id",
          "alert_identity",
          "station_uid",
          "station_name",
          "alert_key",
          "slot_number",
          "severity",
          "status",
          "opened_at",
          "updated_at",
          "cleared_at",
          "last_notified_at",
          "last_reminder_at",
          "notification_count",
          "value_text",
          "threshold_text",
          "details_json"
        ].join(",") +
        "&or=(notification_count.gt.0,status.eq.cleared)" +
        "&order=updated_at.desc" +
        "&limit=" + cappedLimit;
      var fallbackRows = await fetchJson(fallbackUrl, 10000, { headers: supabaseHeaders(project.key) });
      return fallbackAlertHistoryRowsFromInstances(fallbackRows).slice(0, cappedLimit);
    }
  }

  async function pushV4AlertSilence(alert, silenced, adminPassword) {
    var project = await getV4AuthProject();
    try {
      return await fetchJson(project.url + "/rest/v1/rpc/dashboard_set_v4_alert_silence", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({
          p_admin_password: text(adminPassword),
          p_alert: Object.assign({}, alert || {}, { alert_identity: v4AlertIdentity(alert) }),
          p_silenced: Boolean(silenced),
          p_role: text(sessionStorage.getItem("sw_role") || "dashboard")
        })
      });
    } catch (err) {
      if (isMissingAlertSettingsRpcError(err)) {
        throw new Error("V4 alert silence RPC is not installed yet. Apply the 2026-05-18 alert silence SQL amendment.");
      }
      throw err;
    }
  }

  async function pushV4AlertSettings(rows, adminPassword, reminderHours) {
    var project = await getV4AuthProject();
    try {
      return await fetchJson(project.url + "/rest/v1/rpc/dashboard_upsert_v4_alert_settings", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({
          p_admin_password: text(adminPassword),
          p_rows: Array.isArray(rows) ? rows : [],
          p_role: text(sessionStorage.getItem("sw_role") || "dashboard"),
          p_reminder_hours: Math.max(1, Math.floor(Number(reminderHours) || 24))
        })
      });
    } catch (err) {
      if (isMissingAlertSettingsRpcError(err)) {
        throw new Error("V4 alert settings RPCs are not installed yet. Apply the V4 alert-settings SQL amendment before pushing alert changes.");
      }
      throw err;
    }
  }

  async function deleteV4AlertSetting(stationUid, alertKey, adminPassword) {
    var project = await getV4AuthProject();
    try {
      return await fetchJson(project.url + "/rest/v1/rpc/dashboard_delete_v4_alert_setting", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({
          p_admin_password: text(adminPassword),
          p_station_uid: text(stationUid),
          p_alert_key: text(alertKey),
          p_role: text(sessionStorage.getItem("sw_role") || "dashboard")
        })
      });
    } catch (err) {
      if (isMissingAlertSettingsRpcError(err)) {
        throw new Error("V4 alert delete RPC is not installed yet. Reapply the V4 alert-settings SQL amendment.");
      }
      throw err;
    }
  }

  async function sendV4AlertTest(dispatchSecret) {
    var project = await getV4AuthProject();
    return await fetchJson(project.url + "/functions/v1/v4-dispatch-alerts", 15000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-alert-dispatch-secret": text(dispatchSecret)
      },
      body: JSON.stringify({
        mode: "test",
        source: "V4 Alerts dashboard",
        requester: text(sessionStorage.getItem("sw_role") || "dashboard")
      })
    });
  }

  function normalizeStationUid(station) {
    var stationUid = text(station && (station.station_uid || station.stationUid));
    if (!stationUid) throw new Error("Station is missing station_uid for table configuration");
    return stationUid;
  }

  async function fetchTableConfigRows(station) {
    var project = await stationAuthProject(station);
    var stationUid = normalizeStationUid(station);
    try {
      var res = await fetchJson(project.url + "/rest/v1/rpc/dashboard_get_table_config", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({ p_station_uid: stationUid })
      });
      if (res && Array.isArray(res.rows)) return res.rows;
      return Array.isArray(res) ? res : [];
    } catch (err) {
      var msg = String(err && err.message ? err.message : err || "").toLowerCase();
      if (msg.indexOf("dashboard_get_table_config") !== -1 || msg.indexOf("pgrst202") !== -1 || msg.indexOf("could not find the function") !== -1) {
        throw new Error("V4 table configuration RPCs are not installed yet.");
      }
      throw err;
    }
  }

  async function pushTableConfigRows(station, rows) {
    var project = await stationAuthProject(station);
    var stationUid = normalizeStationUid(station);
    var stationKey = text(station && (station.station_key || station.stationKey || station.id));
    try {
      var res = await fetchJson(project.url + "/rest/v1/rpc/dashboard_upsert_table_config", 15000, {
        method: "POST",
        headers: Object.assign({}, supabaseHeaders(project.key), { "Content-Type": "application/json" }),
        body: JSON.stringify({
          p_station_uid: stationUid,
          p_station_key: stationKey,
          p_rows: Array.isArray(rows) ? rows : [],
          p_role: text(sessionStorage.getItem("sw_role") || "dashboard")
        })
      });
      if (res && Array.isArray(res.rows)) return res.rows;
      return Array.isArray(res) ? res : [];
    } catch (err) {
      var msg = String(err && err.message ? err.message : err || "").toLowerCase();
      if (msg.indexOf("dashboard_upsert_table_config") !== -1 || msg.indexOf("pgrst202") !== -1 || msg.indexOf("could not find the function") !== -1) {
        throw new Error("V4 table configuration RPCs are not installed yet. Apply the table-configuration SQL amendment before pushing rows.");
      }
      throw err;
    }
  }

  function ensureProjectReady(station) {
    if (!station || !station.supabase_url || !station.supabase_anon_key) {
      throw new Error("Station catalog is missing Supabase URL or anon key for " + (station ? station.station_name : "station"));
    }
  }

  function supportsV4ReadModels(station) {
    if (!station) return false;
    var profileId = text(station.project_profile_id).toLowerCase();
    var label = text(station.project_label).toLowerCase();
    if (profileId.indexOf("transition") !== -1) return false;
    if (label.indexOf("v3") !== -1) return false;
    return text(station.schema_family).toLowerCase() === "v4";
  }

  async function getPostgrest(station, table, params, timeoutMs) {
    ensureProjectReady(station);
    var url = station.supabase_url + "/rest/v1/" + table + "?" + postgrestQuery(params || {});
    return fetchJson(url, timeoutMs || 18000, { headers: stationHeaders(station) });
  }

  function sampleTime(row) {
    if (!row) return null;
    return row.sample_epoch || row.recorded_at || row.created_at || row.inserted_at || null;
  }

  async function fetchStationSamples(station, options) {
    options = options || {};
    if (!supportsV4ReadModels(station)) return [];
    var limit = Math.max(1, Math.min(Number(options.limit) || 240, 2000));
    var rows = await getPostgrest(station, "sensor_readings", {
      select: "*",
      station_uid: "eq." + station.station_uid,
      order: "sample_epoch.desc",
      limit: String(limit)
    }, 25000).catch(async function(err) {
      if (!station.legacy_device_id) throw err;
      return getPostgrest(station, "sensor_readings", {
        select: "*",
        device_id: "eq." + station.legacy_device_id,
        order: "recorded_at.desc",
        limit: String(limit)
      }, 25000);
    });
    rows = Array.isArray(rows) ? rows : [];
    rows.sort(function(a, b) { return new Date(sampleTime(a)).getTime() - new Date(sampleTime(b)).getTime(); });
    return rows;
  }

  async function fetchOverviewSnapshot(station) {
    var out = { station: station, latest_sample: null, telemetry: [], inventory: null, error: "" };
    if (!supportsV4ReadModels(station)) {
      out.skipped = "transition_profile";
      return out;
    }
    try {
      var samples = await fetchStationSamples(station, { limit: 1 });
      out.latest_sample = samples.length ? samples[samples.length - 1] : null;
    } catch (err) {
      out.sample_error = err.message;
    }
    try {
      var inventory = await getPostgrest(station, "active_station_inventory", {
        select: "*",
        station_uid: "eq." + station.station_uid,
        limit: "1"
      }, 12000);
      out.inventory = Array.isArray(inventory) && inventory.length ? inventory[0] : null;
    } catch (err2) {
      out.inventory_error = err2.message;
    }
    try {
      out.telemetry = await getPostgrest(station, "dashboard_review_device_telemetry_status", {
        select: "*",
        station_uid: "eq." + station.station_uid,
        order: "slot_number.asc.nullsfirst"
      }, 12000);
    } catch (err3) {
      out.telemetry_error = err3.message;
    }
    out.error = out.sample_error || out.inventory_error || out.telemetry_error || "";
    return out;
  }

  async function fetchStationReview(station) {
    var result = { inventory: null, slots: [], telemetry: [], hourly: [] };
    if (!supportsV4ReadModels(station)) {
      result.skipped = "transition_profile";
      return result;
    }
    var inventory = await getPostgrest(station, "active_station_inventory", {
      select: "*",
      station_uid: "eq." + station.station_uid,
      limit: "1"
    }, 15000).catch(function(err) { result.inventory_error = err.message; return []; });
    result.inventory = Array.isArray(inventory) && inventory.length ? inventory[0] : null;
    result.slots = await getPostgrest(station, "dashboard_review_station_slot_status", {
      select: "*",
      station_uid: "eq." + station.station_uid,
      order: "slot_number.asc"
    }, 15000).catch(function(err) { result.slots_error = err.message; return []; });
    result.telemetry = await getPostgrest(station, "dashboard_review_device_telemetry_status", {
      select: "*",
      station_uid: "eq." + station.station_uid,
      order: "slot_number.asc.nullsfirst"
    }, 15000).catch(function(err) { result.telemetry_error = err.message; return []; });
    result.hourly = await getPostgrest(station, "dashboard_review_station_hourly_status_rows", {
      select: "*",
      station_uid: "eq." + station.station_uid,
      order: "hour_bucket.desc",
      limit: "100"
    }, 20000).catch(function(err) {
      result.hourly_error = err.message;
      return getPostgrest(station, "dashboard_review_station_hourly_status", {
        select: "*",
        order: "hour_bucket.desc",
        limit: "100"
      }, 20000).then(function(rows) {
        var columnName = station.station_name || station.name;
        return (Array.isArray(rows) ? rows : []).map(function(row) {
          return {
            hr_sort_desc: row.hr_sort_desc,
            hour_bucket: row.hour_bucket,
            station_uid: station.station_uid,
            station_name: columnName,
            status_text: row[columnName] || ""
          };
        }).filter(function(row) { return row.status_text; });
      }).catch(function(err2) {
        result.hourly_fallback_error = err2.message;
        return [];
      });
    });
    return result;
  }

  function formatTime(value) {
    if (!value) return "--";
    var d = new Date(value);
    if (isNaN(d.getTime())) return text(value) || "--";
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";
  }

  function timeAgo(value) {
    if (!value) return "--";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "--";
    var mins = Math.round((Date.now() - d.getTime()) / 60000);
    var future = mins < 0;
    var abs = Math.abs(mins);
    if (abs < 1) return "just now";
    if (abs < 60) return abs + "m" + (future ? " ahead" : " ago");
    var hours = Math.floor(abs / 60);
    if (hours < 24) return hours + "h " + (abs % 60) + "m" + (future ? " ahead" : " ago");
    return Math.floor(hours / 24) + "d " + (hours % 24) + "h" + (future ? " ahead" : " ago");
  }

  function value(row, keys) {
    row = row || {};
    for (var i = 0; i < keys.length; i++) {
      if (row[keys[i]] !== null && row[keys[i]] !== undefined && row[keys[i]] !== "") return row[keys[i]];
    }
    return null;
  }

  window.SeaweedV4 = {
    AUTH_KEY: AUTH_KEY,
    BOOTSTRAP_AUTH_KEY: BOOTSTRAP_AUTH_KEY,
    STATION_META_KEY: STATION_META_KEY,
    ACCESS_CONTROL_CACHE_KEY: ACCESS_CONTROL_CACHE_KEY,
    BOOTSTRAP_ADMIN_PASSWORD: BOOTSTRAP_ADMIN_PASSWORD,
    authenticateAccessRole: authenticateAccessRole,
    deleteV4AlertSetting: deleteV4AlertSetting,
    escapeHtml: escapeHtml,
    fetchAccessRoleDefinitions: fetchAccessRoleDefinitions,
    fetchV4AlertOverview: fetchV4AlertOverview,
    fetchV4AlertNotificationHistory: fetchV4AlertNotificationHistory,
    fetchV4AlertSettings: fetchV4AlertSettings,
    fetchV4AlertSilences: fetchV4AlertSilences,
    fetchV4LatestUploadHints: fetchV4LatestUploadHints,
    fetchV4OpenAlertInstances: fetchV4OpenAlertInstances,
    pushV4AlertSilence: pushV4AlertSilence,
    fetchOverviewSnapshot: fetchOverviewSnapshot,
    fetchTableConfigRows: fetchTableConfigRows,
    fetchStationReview: fetchStationReview,
    fetchStationSamples: fetchStationSamples,
    formatTime: formatTime,
    formatWithUtcOffset: formatWithUtcOffset,
    getOtaBaseUrl: getOtaBaseUrl,
    isAuthenticated: isAuthenticated,
    loadCatalog: loadCatalog,
    markAuthenticated: markAuthenticated,
    rememberSessionAdminPassword: rememberSessionAdminPassword,
    requireAuth: requireAuth,
    resolveStation: resolveStation,
    sampleTime: sampleTime,
    sendV4AlertTest: sendV4AlertTest,
    sessionAdminPassword: sessionAdminPassword,
    setOtaBaseUrl: setOtaBaseUrl,
    setStationMetadata: writeStationMetadataMap,
    signOut: signOut,
    stationUrl: stationUrl,
    supportsV4ReadModels: supportsV4ReadModels,
    pushAccessControlToSupabase: pushAccessControlToSupabase,
    pushV4AlertSettings: pushV4AlertSettings,
    pushStationMetadataToSupabase: pushStationMetadataToSupabase,
    pushTableConfigRows: pushTableConfigRows,
    parseUtcOffsetMinutes: parseUtcOffsetMinutes,
    displayTimeLabel: displayTimeLabel,
    text: text,
    timeAgo: timeAgo,
    value: value
  };
})(window);
