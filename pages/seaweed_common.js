/**
 * seaweed_common.js — Shared utilities for all Seaweed Dashboard pages.
 *
 * Provides:  csvParse, numParse, timeAgo, formatKB,
 *            fetchWithTimeout, yieldToBrowser,
 *            normalizeDataFolder, getDataFolder
 *
 * Load via <script src="seaweed_common.js"></script>  BEFORE page-specific JS.
 */

// =====================================================================
// TIMESTAMP GUARD — reject samples more than 24 h in the future
// =====================================================================
var MAX_FUTURE_MS = 86400000; // 24 hours
function isFutureTimestamp(d) {
  return d instanceof Date && d.getTime() > Date.now() + MAX_FUTURE_MS;
}

// =====================================================================
// VALUE PARSING HELPERS
// =====================================================================

/**
 * Parse a comma-separated field value into an array of numbers.
 * Handles 'NC', 'null', 'nan', empty strings → null.
 */
function csvParse(fieldVal) {
  if (!fieldVal || fieldVal === 'null') return [];
  return fieldVal.split(',').map(function (v) {
    v = v.trim();
    if (v === 'NC' || v === '' || v === 'null' || v === 'nan') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  });
}

/**
 * Null-safe number parser.  Returns null for undefined / empty / NaN.
 */
function numParse(v) {
  if (v === null || v === undefined || v === '' || v === 'null') return null;
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function thPairValues(tempValue, humidityValue) {
  var temp = numParse(tempValue);
  var humidity = numParse(humidityValue);
  if (temp === 0 && humidity === 0) return { temp: null, humidity: null };
  return { temp: temp, humidity: humidity };
}

// =====================================================================
// DISPLAY FORMATTERS
// =====================================================================

/**
 * Human-readable relative time string.
 *
 * @param {Date}    date      - The date to compare against now.
 * @param {boolean} [suffix]  - If true, append ' ago' to the result.
 * @returns {string} e.g. '5m', '2h 30m', '1d 4h' (or '5m ago' if suffix=true).
 *          Returns 'never' for null / invalid dates, 'just now' only for < 5s age.
 */
function timeAgo(date, suffix) {
  if (!date || isNaN(date.getTime())) return 'never';
  var ms = Date.now() - date.getTime();
  // Only clamp genuinely tiny future offsets (< 60 s clock drift).
  // Larger future offsets indicate a timezone-parse bug — show the real offset.
  if (ms < 0 && ms > -60000) ms = 0;
  var sec = Math.floor(Math.abs(ms) / 1000);
  var future = ms < 0;
  var sfx = suffix ? (future ? ' ahead' : ' ago') : '';
  if (!future && sec < 5) return 'just now';
  if (sec < 60) return sec + 's' + sfx;
  var min = Math.floor(sec / 60);
  if (min < 60) return min + 'm' + sfx;
  var hrs = Math.floor(min / 60);
  if (hrs < 24) return hrs + 'h ' + (min % 60) + 'm' + sfx;
  var days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h' + sfx;
}

/**
 * Format a value in KB as a human-readable size string.
 * @param {number|null} kb - Value in kilobytes.
 * @returns {string} e.g. '512 KB', '1.5 MB', '2.3 GB', or '--' for null/undefined.
 */
function formatKB(kb) {
  if (kb === null || kb === undefined) return '--';
  if (kb >= 1048576) return (kb / 1048576).toFixed(1) + ' GB';
  if (kb >= 1024)    return (kb / 1024).toFixed(1) + ' MB';
  return kb + ' KB';
}

function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =====================================================================
// SUPABASE HELPERS
// =====================================================================

/** Default Supabase project URL (override via localStorage seaweed_dashboard_config.supabaseUrl) */
var SUPABASE_URL_DEFAULT  = 'https://hzpbpvmpqdcgldhlrysv.supabase.co';
/** Default Supabase anon key (override via localStorage) */
var SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6cGJwdm1wcWRjZ2xkaGxyeXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0OTMyNDQsImV4cCI6MjA5MDA2OTI0NH0.GD-O8PgqqgMnVvKK6YIxBPaC9haCwPeA3opesAu931I';
/** Legacy default project values used for one-time browser config migration. */
var SUPABASE_URL_LEGACY  = 'https://qjtjmczixgjxxwmyabmk.supabase.co';
var SUPABASE_ANON_KEY_LEGACY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqdGptY3ppeGdqeHh3bXlhYm1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MjUzMzEsImV4cCI6MjA4ODIwMTMzMX0.K7NdFhCiHJdDpwwiERhH_GVH-AMqaMizPYegaiP2tqg';
/** Fresh-slate cutoff (UTC). Older records are ignored. */
var RESET_CUTOFF_UTC_DEFAULT = '2026-03-16T00:00:00Z';
var RESET_CUTOFF_STORAGE_KEY = 'seaweed_reset_cutoff_utc';
var RESET_CUTOFF_ENABLED = false;

var DASHBOARD_CONFIG_KEY = 'seaweed_dashboard_config';
var DASHBOARD_EGRESS_SAFE_STORAGE_KEY = 'seaweed_egress_safe_mode';
var SHARED_DEVICE_PROFILES_CACHE_KEY = 'seaweed_shared_device_profiles_cache';
var SHARED_DEVICE_PROFILES_CACHE_TTL_MS = 10 * 60 * 1000;
var SHARED_DEVICE_PROFILES_EVENT = 'seaweed:deviceProfilesUpdated';
var _sharedDeviceProfilesRefreshPromise = null;

function dashboardEgressSafeMode() {
  try {
    var stored = localStorage.getItem(DASHBOARD_EGRESS_SAFE_STORAGE_KEY);
    if (stored !== null) return !/^(0|false|off|no)$/i.test(String(stored).trim());
    var cfg = getDashboardConfig();
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'egressSafeMode')) return cfg.egressSafeMode !== false;
  } catch (_) {}
  return true;
}

function dashboardClampInt(value, fallback, minValue, maxValue) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) n = fallback;
  n = Math.floor(n);
  if (minValue != null) n = Math.max(Number(minValue), n);
  if (maxValue != null) n = Math.min(Number(maxValue), n);
  return n;
}

/**
 * Canonical station registry — keep in sync with config.json "stations" array.
 * Phase 4 will load this from an Edge Function instead of embedding here.
 */
var STATION_REGISTRY = [
  { id: 'shangani', name: 'Shangani Aramani', location: 'Kwale County, Kenya', enabled: true, dataFolder: 'data_Shangani', lat: -4.55, lon: 39.50, weatherName: 'Shangani Aramani, Kenya', tideStation: 'kenya', sensorMap: 'shangani', hasSatellite: true },
  { id: 'funzi', name: 'Bati (Table 3)', location: 'Bati, Kenya', enabled: true, dataFolder: 'data_Funzi', lat: -4.592111, lon: 39.392351, weatherName: 'Bati, Kenya', tideStation: 'kenya', sensorMap: 'funzi', hasSatellite: true },
  { id: 'spare', name: 'Bati (Table 2)', location: 'Bati, Kenya', enabled: true, dataFolder: 'data_spare', lat: -4.592111, lon: 39.392351, weatherName: 'Bati, Kenya', tideStation: 'kenya', sensorMap: 'spare', hasSatellite: true },
  { id: 'perth', name: 'Perth Test', location: 'Noranda, WA', enabled: true, dataFolder: 'data_3262071_TT', lat: -31.87, lon: 115.90, weatherName: 'Perth / Noranda', tideStation: 'perth', sensorMap: 'perth', hasSatellite: true },
  { id: 'perth_table', name: 'Perth Table', location: 'Noranda, WA', enabled: true, dataFolder: 'data_perth_table', lat: -31.87, lon: 115.90, weatherName: 'Perth Table / Noranda', tideStation: 'perth', sensorMap: 'perth', hasSatellite: true }
];

function getStationRegistryEntry(stationId) {
  var sid = String(stationId || '').trim().toLowerCase();
  for (var i = 0; i < STATION_REGISTRY.length; i++) {
    if (STATION_REGISTRY[i].id === sid) return STATION_REGISTRY[i];
  }
  return null;
}

var DEFAULT_DEVICE_PROFILES = STATION_REGISTRY.map(function(s) {
  return { id: s.id, name: s.name, enabled: s.enabled, channelId: '', apiKey: '', dataFolder: s.dataFolder };
});

function getDashboardConfig() {
  try {
    return JSON.parse(localStorage.getItem(DASHBOARD_CONFIG_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function normalizeInstallDateUtc(value) {
  if (value == null) return null;
  var s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00Z';
  var d = new Date(ensureUTC(s));
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
}

function normalizeDatasetEndUtc(value) {
  if (value == null) return null;
  var s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T23:59:59.999Z';
  var d = new Date(ensureUTC(s));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeDatasetStatus(value) {
  var s = String(value || '').trim().toLowerCase();
  if (s === 'paused' || s === 'finished') return s;
  return 'active';
}

function normalizeDatasetEndNote(value) {
  if (value == null) return null;
  var s = String(value).trim();
  return s || null;
}

function defaultNameForDeviceId(deviceId) {
  var sid = String(deviceId || '').trim();
  if (!sid) return 'Unknown Device';
  return sid.replace(/[_-]+/g, ' ').replace(/\b\w/g, function(m) { return m.toUpperCase(); });
}

function buildDeviceProfilesFromConfig(cfg, opts) {
  opts = opts || {};
  var includeDisabled = !!opts.includeDisabled;
  cfg = cfg || {};
  var out = [];
  var byId = {};
  var defaultOrder = {};

  DEFAULT_DEVICE_PROFILES.forEach(function(p, idx) {
    defaultOrder[p.id] = idx;
    byId[p.id] = Object.assign({}, p);
  });

  var explicitProfiles = Array.isArray(cfg.deviceProfiles) && cfg.deviceProfiles.length;
  if (explicitProfiles) {
    cfg.deviceProfiles.forEach(function(profile, idx) {
      if (!profile || !profile.id) return;
      var id = String(profile.id).trim().toLowerCase();
      if (!id) return;
      var base = DEFAULT_DEVICE_PROFILES.find(function(d) { return d.id === id; }) || {
        id: id,
        name: defaultNameForDeviceId(id),
        enabled: true,
        channelId: '',
        apiKey: '',
        dataFolder: 'data_' + id
      };
      var merged = Object.assign({}, base, profile);
      merged.id = id;
      merged.name = String(merged.name || merged.title || base.name || defaultNameForDeviceId(id));
      merged.enabled = merged.enabled !== false;
      merged.channelId = merged.channelId != null ? String(merged.channelId).trim() : '';
      merged.apiKey = merged.apiKey != null ? String(merged.apiKey).trim() : '';
      merged.dataFolder = normalizeDataFolder(merged.dataFolder || base.dataFolder || ('data_' + id), base.dataFolder || ('data_' + id));
      merged.installDateUtc = normalizeInstallDateUtc(merged.installDateUtc || merged.installDate || merged.installedAt || null);
      merged.datasetStatus = normalizeDatasetStatus(merged.datasetStatus || merged.dataStatus || null);
      merged.datasetEndUtc = normalizeDatasetEndUtc(merged.datasetEndUtc || merged.datasetPausedUntilUtc || merged.datasetEnd || null);
      merged.datasetEndNote = normalizeDatasetEndNote(merged.datasetEndNote || merged.datasetPauseReason || merged.datasetNote || null);
      byId[id] = merged;
      if (defaultOrder[id] == null) defaultOrder[id] = 1000 + idx;
    });
  }

  Object.keys(byId).forEach(function(id) {
    var p = byId[id];
    if (!p) return;
    p.id = String(p.id || id).trim().toLowerCase();
    p.name = String(p.name || defaultNameForDeviceId(p.id));
    p.enabled = p.enabled !== false;
    p.channelId = p.channelId != null ? String(p.channelId).trim() : '';
    p.apiKey = p.apiKey != null ? String(p.apiKey).trim() : '';
    p.installDateUtc = normalizeInstallDateUtc(p.installDateUtc || null);
    p.datasetStatus = normalizeDatasetStatus(p.datasetStatus || null);
    p.datasetEndUtc = normalizeDatasetEndUtc(p.datasetEndUtc || null);
    p.datasetEndNote = normalizeDatasetEndNote(p.datasetEndNote || null);
    if (includeDisabled || p.enabled) out.push(p);
  });

  out.sort(function(a, b) {
    var oa = defaultOrder[a.id];
    var ob = defaultOrder[b.id];
    if (oa == null && ob == null) return a.id.localeCompare(b.id);
    if (oa == null) return 1;
    if (ob == null) return -1;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });
  return out;
}

function getConfiguredDeviceProfiles(opts) {
  return buildDeviceProfilesFromConfig(getDashboardConfig(), opts);
}

function getCachedSharedDeviceProfiles() {
  try {
    var raw = localStorage.getItem(SHARED_DEVICE_PROFILES_CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.profiles) || !parsed.profiles.length) return null;
    return {
      profiles: parsed.profiles,
      fetchedAt: Number(parsed.fetchedAt) || 0
    };
  } catch (e) {
    return null;
  }
}

function cacheSharedDeviceProfiles(profiles, fetchedAt) {
  if (!Array.isArray(profiles) || !profiles.length) return;
  try {
    localStorage.setItem(SHARED_DEVICE_PROFILES_CACHE_KEY, JSON.stringify({
      profiles: profiles,
      fetchedAt: Number(fetchedAt) || Date.now()
    }));
  } catch (e) {}
}

function applySharedDeviceProfilesToDashboardConfig(profiles, meta) {
  var normalized = buildDeviceProfilesFromConfig({ deviceProfiles: profiles || [] }, { includeDisabled: true });
  if (!normalized.length) return false;

  var cfg = getDashboardConfig();
  var current = buildDeviceProfilesFromConfig({ deviceProfiles: Array.isArray(cfg.deviceProfiles) ? cfg.deviceProfiles : [] }, { includeDisabled: true });
  var currentMap = {};
  current.forEach(function(profile) {
    currentMap[profile.id] = profile;
  });

  var merged = normalized.map(function(profile) {
    var existing = currentMap[profile.id] || {};
    return Object.assign({}, existing, profile);
  });

  if (JSON.stringify(current) === JSON.stringify(merged)) return false;

  cfg.deviceProfiles = merged;
  cfg.deviceProfilesSyncedAt = Number(meta && meta.fetchedAt) || Date.now();
  try {
    localStorage.setItem(DASHBOARD_CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {
    return false;
  }
  return true;
}

function dispatchSharedDeviceProfilesUpdated(detail) {
  try {
    window.dispatchEvent(new CustomEvent(SHARED_DEVICE_PROFILES_EVENT, {
      detail: detail || {}
    }));
  } catch (e) {}
}

function onSharedDeviceProfilesUpdated(handler) {
  if (typeof handler !== 'function') return function() {};
  var wrapped = function(evt) {
    handler(evt && evt.detail ? evt.detail : null);
  };
  window.addEventListener(SHARED_DEVICE_PROFILES_EVENT, wrapped);
  return function() {
    window.removeEventListener(SHARED_DEVICE_PROFILES_EVENT, wrapped);
  };
}

function primeSharedDeviceProfilesFromCache() {
  var cached = getCachedSharedDeviceProfiles();
  if (!cached) return false;
  return applySharedDeviceProfilesToDashboardConfig(cached.profiles, { fetchedAt: cached.fetchedAt, source: 'cache' });
}

async function refreshSharedDeviceProfilesFromSupabase() {
  if (_sharedDeviceProfilesRefreshPromise) return _sharedDeviceProfilesRefreshPromise;

  _sharedDeviceProfilesRefreshPromise = (async function() {
    var profiles = await fetchSharedDeviceProfiles();
    if (!profiles || !profiles.length) return { changed: false, profiles: null };

    var fetchedAt = Date.now();
    cacheSharedDeviceProfiles(profiles, fetchedAt);
    var changed = applySharedDeviceProfilesToDashboardConfig(profiles, { fetchedAt: fetchedAt, source: 'supabase' });
    if (changed) {
      dispatchSharedDeviceProfilesUpdated({
        changed: true,
        source: 'supabase',
        fetchedAt: fetchedAt,
        profiles: profiles
      });
    }
    return { changed: changed, profiles: profiles, fetchedAt: fetchedAt };
  })();

  try {
    return await _sharedDeviceProfilesRefreshPromise;
  } finally {
    _sharedDeviceProfilesRefreshPromise = null;
  }
}

function bootstrapSharedDeviceProfiles() {
  var cached = getCachedSharedDeviceProfiles();
  primeSharedDeviceProfilesFromCache();
  if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < SHARED_DEVICE_PROFILES_CACHE_TTL_MS) {
    return Promise.resolve({ changed: false, cached: true, skippedRefresh: true });
  }
  return refreshSharedDeviceProfilesFromSupabase().catch(function() {
    return { changed: false, cached: !!cached, skippedRefresh: false };
  });
}

var SHARED_DEVICE_PROFILES_STARTUP = bootstrapSharedDeviceProfiles();

function getConfiguredDeviceProfileMap(opts) {
  var profiles = getConfiguredDeviceProfiles(opts);
  var map = {};
  profiles.forEach(function(p) { map[p.id] = p; });
  return map;
}

function getConfiguredDeviceProfile(stationId) {
  var id = String(stationId || '').trim().toLowerCase();
  if (!id) return null;
  var map = getConfiguredDeviceProfileMap({ includeDisabled: true });
  return map[id] || null;
}

function getStationDatasetState(stationId) {
  var profile = getConfiguredDeviceProfile(stationId) || {};
  var status = normalizeDatasetStatus(profile.datasetStatus || null);
  var endUtc = normalizeDatasetEndUtc(profile.datasetEndUtc || profile.datasetEnd || null);
  var endMs = endUtc ? Date.parse(endUtc) : NaN;
  var isActive = status !== 'active' && isFinite(endMs);
  return {
    status: status,
    statusLabel: status === 'finished' ? 'Campaign finished' : (status === 'paused' ? 'Dataset paused' : 'Dataset active'),
    pillLabel: status === 'finished' ? 'Finished' : (status === 'paused' ? 'Paused' : 'Active'),
    note: normalizeDatasetEndNote(profile.datasetEndNote || profile.datasetPauseReason || profile.datasetNote || null),
    endUtc: isActive ? endUtc : null,
    endMs: isActive ? endMs : null,
    endDayKey: isActive ? endUtc.slice(0, 10) : null,
    isActive: isActive
  };
}

function getStationAnalysisAnchorMs(stationId, fallbackMs) {
  var meta = getStationDatasetState(stationId);
  if (meta && meta.isActive && isFinite(meta.endMs)) return meta.endMs;
  return fallbackMs;
}

function getDatasetOverlayWindow(stationId, minMs, maxMs) {
  var meta = getStationDatasetState(stationId);
  var base = {
    min: minMs,
    max: maxMs,
    endMs: meta && meta.isActive ? meta.endMs : null,
    isActive: !!(meta && meta.isActive),
    meta: meta
  };
  if (!meta || !meta.isActive || !isFinite(minMs) || !isFinite(maxMs) || !isFinite(meta.endMs)) return base;
  if (meta.endMs < minMs) return base;

  var effectiveMax = Math.max(maxMs, meta.endMs);
  var spanMs = Math.max(1, meta.endMs - minMs);
  var futurePadMs = Math.max(60 * 60 * 1000, Math.round(spanMs * 0.10));

  base.max = Math.max(effectiveMax, meta.endMs + futurePadMs);
  return base;
}

function isStationAllowed(stationId) {
  var sid = String(stationId || '').toLowerCase();
  if (!sid) return false;

  var cfgMap = getConfiguredDeviceProfileMap({ includeDisabled: true });
  var ids = Object.keys(cfgMap);
  if (!ids.length) return true;
  if (!cfgMap[sid]) return false;
  return cfgMap[sid].enabled !== false;
}

function getResetCutoffMs(stationId) {
  var sid = String(stationId || '').toLowerCase();
  var profile = getConfiguredDeviceProfile(sid);
  if (profile && profile.installDateUtc) {
    var installMs = Date.parse(profile.installDateUtc);
    if (!isNaN(installMs)) return installMs;
  }

  if (!RESET_CUTOFF_ENABLED) return null;
  var cutoffUtc = RESET_CUTOFF_UTC_DEFAULT;
  try {
    if (typeof localStorage !== 'undefined') {
      cutoffUtc = localStorage.getItem(RESET_CUTOFF_STORAGE_KEY) || '';
      if (!cutoffUtc) {
        cutoffUtc = RESET_CUTOFF_UTC_DEFAULT;
        localStorage.setItem(RESET_CUTOFF_STORAGE_KEY, cutoffUtc);
      }
    }
  } catch (e) {}
  var ms = Date.parse(cutoffUtc || RESET_CUTOFF_UTC_DEFAULT);
  return isNaN(ms) ? null : ms;
}

function isAfterResetWindow(stationId, timestampValue) {
  var cutoff = getResetCutoffMs(stationId);
  if (!cutoff) return true;
  var d = timestampValue instanceof Date ? timestampValue : new Date(timestampValue);
  if (!d || isNaN(d.getTime())) return false;
  return d.getTime() >= cutoff;
}

function filterFeedArrayByResetWindow(stationId, feeds) {
  if (!Array.isArray(feeds)) return [];
  return feeds.filter(function(f) { return isAfterResetWindow(stationId, f && f.created_at); });
}

function filterEntryArrayByResetWindow(stationId, entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(function(e) { return isAfterResetWindow(stationId, e && e.timestamp); });
}

/**
 * Get Supabase credentials from localStorage config (set by settings.html)
 * or fall back to the defaults above.
 * @returns {{ url: string, key: string }}
 */
function getSupabaseConfig() {
  var url = SUPABASE_URL_DEFAULT;
  var key = SUPABASE_ANON_KEY_DEFAULT;
  try {
    var s = JSON.parse(localStorage.getItem('seaweed_dashboard_config') || '{}');
    var changed = false;

    if (s.supabaseUrl) {
      var savedUrl = String(s.supabaseUrl).replace(/\/+$/, '').trim();
      if (savedUrl && savedUrl !== SUPABASE_URL_LEGACY) {
        url = savedUrl;
      } else if (savedUrl === SUPABASE_URL_LEGACY) {
        s.supabaseUrl = SUPABASE_URL_DEFAULT;
        changed = true;
      }
    }

    if (s.supabaseAnonKey) {
      var savedKey = String(s.supabaseAnonKey).trim();
      if (savedKey && savedKey !== SUPABASE_ANON_KEY_LEGACY) {
        key = savedKey;
      } else if (savedKey === SUPABASE_ANON_KEY_LEGACY) {
        s.supabaseAnonKey = SUPABASE_ANON_KEY_DEFAULT;
        changed = true;
      }
    }

    if (changed) {
      localStorage.setItem('seaweed_dashboard_config', JSON.stringify(s));
    }
  } catch (e) { /* ignore */ }
  return { url: url.replace(/\/+$/, ''), key: key };
}

/**
 * Build Supabase PostgREST request headers.
 * @param {string} [apiKey] - Override anon key (defaults to getSupabaseConfig().key)
 * @returns {Object} Headers object for fetch()
 */
function supabaseHeaders(apiKey) {
  var k = apiKey || getSupabaseConfig().key;
  return {
    'apikey': k,
    'Authorization': 'Bearer ' + k
  };
}

/**
 * Ensure a timestamp string from Supabase is parsed as UTC.
 * PostgREST may return timestamptz without the offset or 'Z' suffix,
 * causing new Date() to treat it as local time — which silently shifts
 * the date by the browser's UTC offset and breaks freshness checks.
 *
 * @param {string|null} ts - Timestamp string from Supabase (e.g. "2026-03-04T10:56:11" or "2026-03-04T10:56:11+00:00")
 * @returns {string|null}  - Timestamp string guaranteed to have a UTC indicator, or null.
 */
function ensureUTC(ts) {
  if (!ts) return ts;
  var s = String(ts).trim();
  // Already has offset (+HH, +HH:MM, +HHMM) or 'Z' → leave as-is
  if (/[Zz]$/.test(s) || /[+-]\d{2}(:\d{2})?$/.test(s)) return s;
  // No timezone info → append Z so new Date() treats it as UTC
  return s + 'Z';
}

// =====================================================================
// FEED → ENTRY CONVERSION
// =====================================================================

/**
 * Convert a slot-indexed feed into a chart-ready entry object.
 * Hub: t0Temp1..t0Hum3, t0BatV, t0BatPct, t0Boot
 * Slot N: sat{N}Temp1, sat{N}Hum1, sat{N}Temp2, sat{N}Hum2, sat{N}BatV, sat{N}BatPct, sat{N}FlashPct
 */
function feedToEntry(f, discoveredSlots) {
  var ts = new Date(f.created_at);
  if (isFutureTimestamp(ts)) return null;
  var hub1 = thPairValues(f.temp_1, f.humidity_1);
  var hub2 = thPairValues(f.temp_2, f.humidity_2);
  var hub3 = thPairValues(f.temp_3, f.humidity_3);
  var entry = {
    timestamp: ts,
    entryId:   f.entry_id,
    t0Temp1:   hub1.temp,
    t0Hum1:    hub1.humidity,
    t0Temp2:   hub2.temp,
    t0Hum2:    hub2.humidity,
    t0Temp3:   hub3.temp,
    t0Hum3:    hub3.humidity,
    t0BatV:    numParse(f.battery_v),
    t0BatPct:  numParse(f.battery_pct),
    t0SolarV:  numParse(f.solar_v),
    t0Boot:    numParse(f.boot_count)
  };
  var slots = discoveredSlots || f._discovered_slots || [];
  for (var i = 0; i < slots.length; i++) {
    var n = slots[i];
    var p = 'sat_' + n + '_';
    var slotHasReading = (
      f[p + 'temp_1'] != null ||
      f[p + 'humidity_1'] != null ||
      f[p + 'temp_2'] != null ||
      f[p + 'humidity_2'] != null ||
      f[p + 'battery_v'] != null ||
      f[p + 'battery_pct'] != null ||
      f[p + 'flash_pct'] != null
    );
    var sat1 = thPairValues(f[p + 'temp_1'], f[p + 'humidity_1']);
    var sat2 = thPairValues(f[p + 'temp_2'], f[p + 'humidity_2']);
    entry['sat' + n + 'Temp1']    = sat1.temp;
    entry['sat' + n + 'Hum1']     = sat1.humidity;
    entry['sat' + n + 'Temp2']    = sat2.temp;
    entry['sat' + n + 'Hum2']     = sat2.humidity;
    entry['sat' + n + 'BatV']     = numParse(f[p + 'battery_v']);
    entry['sat' + n + 'BatPct']   = numParse(f[p + 'battery_pct']);
    entry['sat' + n + 'FlashPct'] = numParse(f[p + 'flash_pct']);
    entry['sat' + n + 'Installed'] = slotHasReading ? true : null;
  }
  return entry;
}

// =====================================================================
// FETCH HELPERS
// =====================================================================

/**
 * Fetch with timeout — wraps native fetch with an AbortController.
 * @param {string} url
 * @param {number} [timeoutMs=30000]
 * @param {Object} [opts] - Additional fetch options (headers, method, body, etc.)
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, timeoutMs, opts) {
  timeoutMs = timeoutMs || 30000;
  opts = opts || {};
  var controller = new AbortController();
  var merged = Object.assign({}, opts, { signal: controller.signal });
  var tid = setTimeout(function () { controller.abort(); }, timeoutMs);
  return fetch(url, merged)
    .then(function (res) { clearTimeout(tid); return res; })
    .catch(function (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError'
        ? new Error('Timeout after ' + (timeoutMs / 1000) + 's')
        : err;
    });
}

/**
 * Yield to the browser event loop so UI repaints (status text, spinners) can occur.
 * @returns {Promise<void>}
 */
function yieldToBrowser() {
  return new Promise(function (r) { setTimeout(r, 0); });
}

// =====================================================================
// DATA-FOLDER RESOLUTION (localStorage config)
// =====================================================================

/**
 * Normalise a data-folder path to a bare folder name under /data/.
 * Strips leading '../data/', trailing '/merged_data.js', backslashes, etc.
 *
 * @param {string} folder   - Raw folder string from config.
 * @param {string} fallback - Value to return if folder is empty/invalid.
 * @returns {string}
 */
function normalizeDataFolder(folder, fallback) {
  if (typeof folder !== 'string') return fallback;
  var out = folder.trim();
  if (!out) return fallback;
  out = out.replace(/\\/g, '/');
  out = out.replace(/^(\.\.\/)?data\//i, '');
  out = out.replace(/\/merged_data\.js$/i, '');
  out = out.replace(/^\/+|\/+$/g, '');
  return out || fallback;
}

/**
 * Resolve the data folder for a station config key, respecting localStorage overrides.
 *
 * @param {string} configKey     - Station key (e.g. 'perth', 'shangani').
 * @param {string} defaultFolder - Fallback folder name.
 * @returns {string} Normalised folder name.
 */
function getDataFolder(configKey, defaultFolder) {
  var profile = getConfiguredDeviceProfile(configKey);
  if (profile && profile.dataFolder) {
    return normalizeDataFolder(profile.dataFolder, normalizeDataFolder(defaultFolder, defaultFolder));
  }
  return normalizeDataFolder(defaultFolder, defaultFolder);
}

// =====================================================================
// DEVICE STATUS + SLOTS (used by cross-tab handlers)
// =====================================================================

/**
 * Parse device_status.next_check_in safely.
 * Accepts ISO-like timestamps with or without seconds and timezone suffix.
 *
 * @param {string|null} value
 * @returns {Date|null}
 */
function parseNextCheckInValue(value) {
  if (value == null) return null;
  var s = String(value).trim();
  if (!s) return null;

  // Normalize minute-only UTC strings like "2026-03-17T12:03Z" to include seconds.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/i.test(s)) s = s.replace(/Z$/i, ':00Z');
  // Normalize minute-only offset strings like "2026-03-17T12:03+00:00".
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(s)) s = s.replace(/([+-]\d{2}:\d{2})$/, ':00$1');

  var d = new Date(ensureUTC(s));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Fetch device_status rows for station IDs.
 *
 * @param {string[]} stationIds
 * @returns {Promise<Object>} Map: { [deviceId]: { nextCheckInAt, lastSeenAt, lastUploadAt, raw } }
 */
async function fetchDeviceStatusMap(stationIds) {
  stationIds = Array.isArray(stationIds) ? stationIds.filter(Boolean) : [];
  if (!stationIds.length) return {};

  var supaCfg = getSupabaseConfig();
  var hdrs = supabaseHeaders(supaCfg.key);
  var idList = stationIds.map(function(id) { return String(id).replace(/,/g, ''); }).join(',');
  var url = supaCfg.url + '/rest/v1/device_status' +
            '?select=device_id,battery_pct,next_check_in,last_seen,last_upload_at' +
            '&device_id=in.(' + encodeURIComponent(idList) + ')';

  var res = await fetchWithTimeout(url, 15000, { headers: hdrs });
  if (!res.ok) throw new Error('device_status HTTP ' + res.status);

  var rows = await res.json();
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    if (!r.device_id) continue;
    out[r.device_id] = {
      batteryPct: (r.battery_pct !== null && r.battery_pct !== undefined) ? Number(r.battery_pct) : null,
      nextCheckInAt: parseNextCheckInValue(r.next_check_in),
      lastSeenAt: r.last_seen ? new Date(ensureUTC(r.last_seen)) : null,
      lastUploadAt: r.last_upload_at ? new Date(ensureUTC(r.last_upload_at)) : null,
      raw: r
    };
  }
  return out;
}

/**
 * Fetch one station's device_status row.
 *
 * @param {string} stationId
 * @returns {Promise<Object|null>}
 */
async function fetchDeviceStatus(stationId) {
  if (!stationId) return null;
  var map = await fetchDeviceStatusMap([stationId]);
  return map[stationId] || null;
}

// =====================================================================
// SLOT-DRIVEN DASHBOARD HELPERS
// =====================================================================

async function fetchDeviceSlotsMap(stationIds) {
  stationIds = Array.isArray(stationIds) ? stationIds.filter(Boolean) : [];
  if (!stationIds.length) return {};

  var supaCfg = getSupabaseConfig();
  if (!supaCfg.url || !supaCfg.key ||
      supaCfg.url === 'YOUR_SUPABASE_URL' || supaCfg.key === 'YOUR_SUPABASE_ANON_KEY') {
    throw new Error('Supabase not configured');
  }

  var hdrs = supabaseHeaders(supaCfg.key);
  var idList = stationIds.map(function(id) {
    return String(id || '').trim().replace(/,/g, '');
  }).filter(Boolean).join(',');
  if (!idList) return {};

  var url = supaCfg.url + '/rest/v1/device_slots' +
            '?select=device_id,slot_number,node_letter' +
            '&device_id=in.(' + encodeURIComponent(idList) + ')';
  var res = await fetchWithTimeout(url, 15000, { headers: hdrs });
  if (!res.ok) throw new Error('device_slots HTTP ' + res.status);

  var rows = await res.json();
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    if (!row.device_id || row.slot_number == null || !row.node_letter) continue;
    var deviceId = String(row.device_id).trim().toLowerCase();
    var nodeLetter = String(row.node_letter).trim().toUpperCase();
    var slotNumber = Number(row.slot_number);
    if (!deviceId || !nodeLetter || !isFinite(slotNumber)) continue;
    if (!out[deviceId]) out[deviceId] = {};
    out[deviceId][nodeLetter] = slotNumber;
  }
  return out;
}

function hasSlotData(entries, slotNumber) {
  if (!Array.isArray(entries) || !entries.length || !slotNumber) return false;
  var prefix = 'sat' + slotNumber;
  function present(v) {
    return v !== null && v !== undefined;
  }
  return entries.some(function(entry) {
    return entry && (
      present(entry[prefix + 'BatV']) ||
      present(entry[prefix + 'BatPct']) ||
      present(entry[prefix + 'Temp1']) ||
      present(entry[prefix + 'Temp2']) ||
      present(entry[prefix + 'Hum1']) ||
      present(entry[prefix + 'Hum2'])
    );
  });
}

function getStationSlotAssignments(stationId, entries, deviceSlotsById) {
  var stationKey = String(stationId || '').trim().toLowerCase();
  var slotMap = deviceSlotsById && stationKey ? deviceSlotsById[stationKey] : null;
  if (!slotMap && deviceSlotsById && typeof deviceSlotsById === 'object') {
    var flatKeys = Object.keys(deviceSlotsById);
    var flatNumericSlots = flatKeys.filter(function(key) {
      return isFinite(Number(deviceSlotsById[key]));
    });
    if (flatNumericSlots.length === flatKeys.length && flatKeys.length) {
      slotMap = deviceSlotsById;
    }
  }
  var assignments = [];
  var seenSlots = {};

  // 1. Use device_slots table mappings
  if (slotMap) {
    Object.keys(slotMap).forEach(function(nodeLetter) {
      var slotNumber = Number(slotMap[nodeLetter]);
      var nodeKey = String(nodeLetter || '').trim().toUpperCase();
      if (!nodeKey || !isFinite(slotNumber)) return;
      seenSlots[slotNumber] = true;
      assignments.push({
        nodeLetter: nodeKey,
        slotNumber: slotNumber
      });
    });
  }

  // 2. Fallback: discover slots from entry data (sat1*, sat2*, ...)
  for (var s = 1; s <= 10; s++) {
    if (seenSlots[s]) continue;
    if (hasSlotData(entries, s)) {
      seenSlots[s] = true;
      assignments.push({ nodeLetter: null, slotNumber: s });
    }
  }

  assignments.sort(function(a, b) { return a.slotNumber - b.slotNumber; });

  return assignments.map(function(item, index) {
    return Object.assign({}, item, {
      satelliteNumber: index + 1,
      displayName: 'Satellite ' + (index + 1) + ' (Slot ' + item.slotNumber + ')'
    });
  });
}

function getStationSlotDisplayName(stationId, slotNumberOrNodeLetter, deviceSlotsById, entries) {
  var slots = getStationSlotAssignments(stationId, entries, deviceSlotsById);
  var input = String(slotNumberOrNodeLetter || '').trim();
  var asNum = Number(input);
  for (var i = 0; i < slots.length; i++) {
    if (isFinite(asNum) && slots[i].slotNumber === asNum) return slots[i].displayName;
    if (slots[i].nodeLetter && slots[i].nodeLetter === input.toUpperCase()) return slots[i].displayName;
  }
  if (isFinite(asNum)) return 'Satellite (Slot ' + asNum + ')';
  return 'Satellite';
}

function isPerthTestBedStation(stationId) {
  var key = String(stationId || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return key === 'perth_table' || key === 'perth_test_bed' || key === 'st_0103';
}

function isBatiDirectSensorStation(stationId) {
  var key = String(stationId || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return key === 'tb_02' || key === 'bati' || key === 'st_0102';
}

function getSlotMapForStation(stationId, deviceSlotsById) {
  var stationKey = String(stationId || '').trim().toLowerCase();
  var slotMap = deviceSlotsById && stationKey ? deviceSlotsById[stationKey] : null;
  if (!slotMap && deviceSlotsById && typeof deviceSlotsById === 'object') {
    var flatKeys = Object.keys(deviceSlotsById);
    var flatNumericSlots = flatKeys.filter(function(key) {
      return isFinite(Number(deviceSlotsById[key]));
    });
    if (flatNumericSlots.length === flatKeys.length && flatKeys.length) {
      slotMap = deviceSlotsById;
    }
  }
  return slotMap || null;
}

function sensorColorByIndex(sensorColors, sensorIndex) {
  var keys = ['t0s1', 't0s2', 't0s3', 'slot1s1', 'slot1s2', 'slot2s1', 'slot2s2', 'slot3s1', 'slot3s2', 'slot4s1'];
  var fallback = ['#38bdf8', '#22c55e', '#eab308', '#a855f7', '#ef4444', '#f97316', '#06b6d4', '#84cc16', '#ec4899', '#64748b'];
  return sensorColors[keys[sensorIndex - 1]] || fallback[(sensorIndex - 1) % fallback.length];
}

function getLatestEntryTimeMs(entries) {
  if (!Array.isArray(entries) || !entries.length) return NaN;
  for (var i = entries.length - 1; i >= 0; i--) {
    var ts = entries[i] && entries[i].timestamp;
    var ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    if (isFinite(ms)) return ms;
  }
  return NaN;
}

function hasRecentBatiSlotReadings(entries, slotNumber, cutoffMs) {
  if (!Array.isArray(entries) || !entries.length || !isFinite(slotNumber) || !isFinite(cutoffMs)) return false;
  var prefix = 'sat' + slotNumber;
  for (var i = entries.length - 1; i >= 0; i--) {
    var entry = entries[i];
    if (!entry) continue;
    var ts = entry.timestamp instanceof Date ? entry.timestamp.getTime() : new Date(entry.timestamp).getTime();
    if (!isFinite(ts)) continue;
    if (ts < cutoffMs) break;
    if (entry[prefix + 'Temp1'] != null || entry[prefix + 'Hum1'] != null) return true;
  }
  return false;
}

function buildBatiDirectSensorDefinitions(stationId, entries, deviceSlotsById, sensorColors) {
  var expectedNodes = { 1: 'N0008', 2: 'N0009', 3: 'N0011' };
  var slots = getStationSlotAssignments(stationId, entries, deviceSlotsById);
  var activeSlotNumbers = {};
  var slotMap = getSlotMapForStation(stationId, deviceSlotsById);
  if (slotMap) {
    Object.keys(slotMap).forEach(function(nodeLetter) {
      var slotNumber = Number(slotMap[nodeLetter]);
      if (isFinite(slotNumber) && slotNumber > 0) activeSlotNumbers[slotNumber] = true;
    });
  }
  var bySlot = {};
  slots.forEach(function(slot) {
    if (slot && isFinite(Number(slot.slotNumber))) bySlot[Number(slot.slotNumber)] = slot;
  });
  Object.keys(expectedNodes).forEach(function(slotNumber) {
    var n = Number(slotNumber);
    if (!bySlot[n]) {
      bySlot[n] = {
        nodeLetter: expectedNodes[n],
        slotNumber: n,
        satelliteNumber: n,
        displayName: 'Slot ' + n + ' Satellite (' + expectedNodes[n] + ')'
      };
    }
  });

  var latestMs = getLatestEntryTimeMs(entries);
  var recentCutoffMs = latestMs - 36 * 3600000;
  slots = Object.keys(bySlot).map(function(slotNumber) {
    return bySlot[slotNumber];
  }).filter(function(slot) {
    var slotNumber = Number(slot && slot.slotNumber);
    if (!isFinite(slotNumber) || slotNumber <= 0) return false;
    if (expectedNodes[slotNumber] || activeSlotNumbers[slotNumber]) return true;
    return hasRecentBatiSlotReadings(entries, slotNumber, recentCutoffMs);
  }).sort(function(a, b) {
    return Number(a.slotNumber) - Number(b.slotNumber);
  });

  var definitions = [{
    sensorIndex: 1, sensorId: 'S1',
    legendLabel: 'S1 - Hub T/H', summaryLabel: 'S1 (Hub)', shortLabel: 'Hub T/H',
    tempKey: 't0Temp1', humKey: 't0Hum1',
    color: sensorColorByIndex(sensorColors, 1), nodeLetter: 'H',
    displayName: 'Hub T/H'
  }];

  slots.forEach(function(slot) {
    var slotNumber = Number(slot.slotNumber);
    if (!isFinite(slotNumber) || slotNumber <= 0) return;
    var sensorIndex = definitions.length + 1;
    var rawNode = String(slot.nodeLetter || '').trim().toUpperCase();
    var nodeLabel = /^\d+$/.test(rawNode) ? '' : rawNode;
    if (!nodeLabel && expectedNodes[slotNumber]) nodeLabel = expectedNodes[slotNumber];
    var slotLabel = 'Slot ' + slotNumber + ' Satellite' + (nodeLabel ? ' (' + nodeLabel + ')' : '');
    definitions.push({
      sensorIndex: sensorIndex,
      sensorId: 'S' + sensorIndex,
      legendLabel: 'S' + sensorIndex + ' - ' + slotLabel,
      summaryLabel: 'S' + sensorIndex + ' (' + (nodeLabel || ('Slot ' + slotNumber)) + ')',
      shortLabel: slotLabel,
      tempKey: 'sat' + slotNumber + 'Temp1',
      humKey: 'sat' + slotNumber + 'Hum1',
      color: sensorColorByIndex(sensorColors, sensorIndex),
      nodeLetter: nodeLabel || slot.nodeLetter,
      slotNumber: slotNumber,
      satelliteNumber: slot.satelliteNumber,
      displayName: slotLabel
    });
  });

  return definitions;
}

function buildStationSensorDefinitions(stationId, entries, deviceSlotsById, sensorColors) {
  sensorColors = sensorColors || {};
  if (isBatiDirectSensorStation(stationId)) {
    return buildBatiDirectSensorDefinitions(stationId, entries, deviceSlotsById, sensorColors);
  }

  var definitions = [
    {
      sensorIndex: 1, sensorId: 'S1',
      legendLabel: 'S1 (T0.S1)', shortLabel: 'T0.S1',
      tempKey: 't0Temp1', humKey: 't0Hum1',
      color: sensorColors.t0s1, nodeLetter: 'H'
    },
    {
      sensorIndex: 2, sensorId: 'S2',
      legendLabel: 'S2 (T0.S2)', shortLabel: 'T0.S2',
      tempKey: 't0Temp2', humKey: 't0Hum2',
      color: sensorColors.t0s2, nodeLetter: 'H'
    },
    {
      sensorIndex: 3, sensorId: 'S3',
      legendLabel: 'S3 (T0.S3)', shortLabel: 'T0.S3',
      tempKey: 't0Temp3', humKey: 't0Hum3',
      color: sensorColors.t0s3, nodeLetter: 'H'
    }
  ];

  if (isPerthTestBedStation(stationId)) {
    definitions.push(
      {
        sensorIndex: 4, sensorId: 'S4',
        legendLabel: 'S4 (Virtual.S1)', shortLabel: 'Virtual.S1',
        tempKey: 'sat1Temp1', humKey: 'sat1Hum1',
        color: sensorColors.slot1s1,
        slotNumber: 1, satelliteNumber: 1,
        displayName: 'Virtual Satellite (Slot 1)'
      },
      {
        sensorIndex: 5, sensorId: 'S5',
        legendLabel: 'S5 (Virtual.S2)', shortLabel: 'Virtual.S2',
        tempKey: 'sat1Temp2', humKey: 'sat1Hum2',
        color: sensorColors.slot1s2,
        slotNumber: 1, satelliteNumber: 1,
        displayName: 'Virtual Satellite (Slot 1)'
      },
      {
        sensorIndex: 6, sensorId: 'S6',
        legendLabel: 'S6 (Light board)', shortLabel: 'Light board',
        tempKey: 'sat2Temp1', humKey: 'sat2Hum1',
        color: sensorColors.slot2s1,
        slotNumber: 2, satelliteNumber: 2,
        displayName: 'Light Satellite (Slot 2)'
      },
      {
        sensorIndex: 7, sensorId: 'S7',
        legendLabel: 'S7 (Anemometer)', shortLabel: 'Anemometer',
        tempKey: 'sat3Temp1', humKey: 'sat3Hum1',
        color: sensorColors.slot3s1,
        slotNumber: 3, satelliteNumber: 3,
        displayName: 'Anemometer Satellite (Slot 3)'
      }
    );
    return definitions;
  }

  var slots = getStationSlotAssignments(stationId, entries, deviceSlotsById);
  for (var i = 0; i < slots.length; i++) {
    var slot = slots[i];
    var slotPrefix = 'sat' + slot.slotNumber;
    var colorPrefix = 'slot' + slot.slotNumber + 's';

    for (var sensorNumber = 1; sensorNumber <= 2; sensorNumber++) {
      var sensorIndex = definitions.length + 1;
      definitions.push({
        sensorIndex: sensorIndex,
        sensorId: 'S' + sensorIndex,
        legendLabel: 'S' + sensorIndex + ' (' + slot.slotNumber + '.S' + sensorNumber + ')',
        shortLabel: slot.slotNumber + '.S' + sensorNumber,
        tempKey: slotPrefix + 'Temp' + sensorNumber,
        humKey: slotPrefix + 'Hum' + sensorNumber,
        color: sensorColors[colorPrefix + sensorNumber],
        nodeLetter: slot.nodeLetter,
        slotNumber: slot.slotNumber,
        satelliteNumber: slot.satelliteNumber,
        displayName: slot.displayName
      });
    }
  }

  return definitions;
}

// =====================================================================
// SHARED CACHE + CROSS-WINDOW SYNC
// =====================================================================
var STATION_CACHE_SCHEMA_VERSION = '20260626shangani-th';

/**
 * Persist parsed station entries in shared localStorage cache.
 *
 * @param {string} stationId
 * @param {Object[]} entries - Parsed entries (same shape used by station.html / station_health.html)
 * @param {Object} [meta]    - Optional metadata (source, channelInfo, timeRange, windowStart, windowEnd)
 */
function saveStationCache(stationId, entries, meta) {
  if (!stationId || !Array.isArray(entries)) return;
  meta = meta || {};
  function deriveWindow(entriesSubset) {
    var minIso = null;
    var maxIso = null;
    for (var i = 0; i < entriesSubset.length; i++) {
      var entry = entriesSubset[i];
      if (!entry) continue;
      var rawTs = entry.timestamp != null ? entry.timestamp : entry.created_at;
      if (rawTs == null) continue;
      var ts = rawTs instanceof Date ? rawTs : new Date(rawTs);
      if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
      var iso = ts.toISOString();
      if (!minIso) minIso = iso;
      maxIso = iso;
    }
    return {
      windowStart: minIso || meta.windowStart || null,
      windowEnd: maxIso || meta.windowEnd || null
    };
  }

  function persistEntries(entriesSubset) {
    var bounds = deriveWindow(entriesSubset);
    localStorage.setItem('seaweed_cache_' + stationId, JSON.stringify({
      schemaVersion: STATION_CACHE_SCHEMA_VERSION,
      allEntries: entriesSubset,
      channelInfo: meta.channelInfo || null,
      source: meta.source || 'live',
      timeRange: meta.timeRange || null,
      windowStart: bounds.windowStart,
      windowEnd: bounds.windowEnd,
      savedAt: Date.now()
    }));
  }

  var attempts = [];
  var maxEntries = Number(meta.maxEntries);
  if (isFinite(maxEntries) && maxEntries > 0) attempts.push(Math.max(1, Math.round(maxEntries)));
  attempts.push(entries.length);
  attempts.push(Math.min(entries.length, 1200));
  attempts.push(Math.min(entries.length, 800));
  attempts.push(Math.min(entries.length, 500));
  attempts.push(Math.min(entries.length, 250));

  var seen = {};
  var uniqueAttempts = [];
  for (var ai = 0; ai < attempts.length; ai++) {
    var size = attempts[ai];
    if (!isFinite(size) || size <= 0 || seen[size]) continue;
    seen[size] = true;
    uniqueAttempts.push(size);
  }

  var lastError = null;
  for (var ui = 0; ui < uniqueAttempts.length; ui++) {
    var limit = uniqueAttempts[ui];
    var subset = limit >= entries.length ? entries : entries.slice(entries.length - limit);
    try {
      persistEntries(subset);
      return;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    console.warn('[Cache] Could not save station cache for ' + stationId + ':', lastError.message);
  }
}

function getStationCacheWindow(cached) {
  if (!cached) return null;

  var min = cached.windowStart != null ? new Date(cached.windowStart).getTime() : NaN;
  var max = cached.windowEnd != null ? new Date(cached.windowEnd).getTime() : NaN;
  if (isFinite(min) && isFinite(max) && max >= min) {
    return { min: min, max: max };
  }

  var entries = Array.isArray(cached.allEntries) ? cached.allEntries : [];
  var derivedMin = NaN;
  var derivedMax = NaN;
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry) continue;
    var rawTs = entry.timestamp != null ? entry.timestamp : entry.created_at;
    if (rawTs == null) continue;
    var ts = rawTs instanceof Date ? rawTs.getTime() : new Date(rawTs).getTime();
    if (!isFinite(ts)) continue;
    if (!isFinite(derivedMin) || ts < derivedMin) derivedMin = ts;
    if (!isFinite(derivedMax) || ts > derivedMax) derivedMax = ts;
  }

  if (!isFinite(derivedMin) || !isFinite(derivedMax) || derivedMax < derivedMin) return null;
  return { min: derivedMin, max: derivedMax };
}

function stationCacheCanPrimeRange(cached, requestedWindow, requestedRange) {
  if (!cached || !requestedWindow) return false;
  if (cached.schemaVersion !== STATION_CACHE_SCHEMA_VERSION) return false;

  var cacheWindow = getStationCacheWindow(cached);
  if (!cacheWindow) return false;

  var range = requestedRange || cached.timeRange || 'week';
  if (range === 'all') {
    return cached.timeRange === 'all';
  }

  var reqFrom = requestedWindow.from instanceof Date
    ? requestedWindow.from.getTime()
    : new Date(requestedWindow.from).getTime();
  var reqTo = requestedWindow.to instanceof Date
    ? requestedWindow.to.getTime()
    : new Date(requestedWindow.to).getTime();
  if (!isFinite(reqFrom)) return false;

  var spanMs = isFinite(reqTo) ? Math.max(0, reqTo - reqFrom) : Math.max(0, cacheWindow.max - reqFrom);
  var toleranceMs = Math.min(6 * 3600000, Math.round(spanMs * 0.1));

  return cacheWindow.min <= (reqFrom + toleranceMs);
}

function clearSeaweedStationCaches(stationId) {
  var suffix = stationId ? String(stationId) : '';
  try {
    Object.keys(localStorage).forEach(function(key) {
      var isStationCache = key.indexOf('seaweed_cache_') === 0;
      var isSummaryCache = key.indexOf('seaweed_summary_cache_') === 0;
      if (!isStationCache && !isSummaryCache) return;
      if (suffix && key.slice(-suffix.length) !== suffix) return;
      localStorage.removeItem(key);
    });
  } catch (_) {}
}

if (typeof window !== 'undefined') {
  window.clearSeaweedStationCaches = clearSeaweedStationCaches;
}

/**
 * Broadcast a dashboard-wide refresh event across browser windows/tabs.
 *
 * @param {string[]} stationIds
 * @param {string} [source]
 */
function notifyDashboardDataRefresh(stationIds, source) {
  var ids = Array.isArray(stationIds) ? stationIds.filter(Boolean) : [];
  var payload = {
    stationIds: ids,
    source: source || 'unknown',
    ts: Date.now(),
    nonce: Math.random().toString(36).slice(2)
  };
  try {
    localStorage.setItem('seaweed_data_refresh', JSON.stringify(payload));
  } catch (e) {
    console.warn('[Sync] Could not publish refresh event:', e.message);
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      var bc = new BroadcastChannel('seaweed_data_refresh');
      bc.postMessage(payload);
      bc.close();
    }
  } catch (e2) {
    console.warn('[Sync] Could not publish BroadcastChannel refresh event:', e2.message);
  }
}

/**
 * Subscribe to dashboard refresh messages from both localStorage and BroadcastChannel.
 * Returns an unsubscribe function.
 *
 * @param {function(Object):void} handler
 * @returns {function():void}
 */
function onDashboardDataRefresh(handler) {
  if (typeof handler !== 'function') return function() {};

  var onStorage = function(evt) {
    if (!evt || evt.key !== 'seaweed_data_refresh' || !evt.newValue) return;
    try {
      var msg = JSON.parse(evt.newValue);
      handler(msg);
    } catch (e) {}
  };
  window.addEventListener('storage', onStorage);

  var bc = null;
  var onBC = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('seaweed_data_refresh');
      onBC = function(evt) {
        var msg = evt && evt.data ? evt.data : null;
        if (!msg) return;
        handler(msg);
      };
      bc.addEventListener('message', onBC);
    }
  } catch (e2) {}

  return function unsubscribeDashboardDataRefresh() {
    window.removeEventListener('storage', onStorage);
    if (bc && onBC) {
      try {
        bc.removeEventListener('message', onBC);
        bc.close();
      } catch (e3) {}
    }
  };
}

// =====================================================================
// RAW SAMPLES FALLBACK
// =====================================================================

function stationRawSlotNumber(row) {
  if (!row) return null;
  var n = Number(row.slot_number);
  if (isFinite(n) && n > 0) return n;
  var node = String(row.node_id || '').trim().toUpperCase();
  if (node === 'SIA' || node === 'A') return 1;
  if (node === 'B') return 2;
  return null;
}

function buildSamplesRawStationPayload(stationId, rows, meta) {
  rows = Array.isArray(rows) ? rows : [];
  meta = meta || {};

  var hubRows = [];
  var satRows = [];
  var slotMap = {};
  rows.forEach(function(row) {
    if (!row) return;
    var node = String(row.node_id || '').trim();
    if (!node) return;
    if (node.toLowerCase() === 'hub') {
      hubRows.push(row);
      return;
    }
    var slot = stationRawSlotNumber(row);
    if (slot) slotMap[node] = slot;
    satRows.push(row);
  });
  var activeSlots = Object.keys(slotMap).map(function(node) {
    return Number(slotMap[node]);
  }).filter(function(slot, idx, arr) {
    return isFinite(slot) && slot > 0 && arr.indexOf(slot) === idx;
  }).sort(function(a, b) { return a - b; });

  hubRows.sort(function(a, b) { return new Date(a.sample_epoch).getTime() - new Date(b.sample_epoch).getTime(); });
  satRows.sort(function(a, b) { return new Date(a.sample_epoch).getTime() - new Date(b.sample_epoch).getTime(); });

  function nearestSat(hub, slotNumber) {
    var hubMs = new Date(hub.sample_epoch).getTime();
    if (!isFinite(hubMs)) return null;
    var best = null;
    var bestDelta = Infinity;
    for (var i = 0; i < satRows.length; i++) {
      var sat = satRows[i];
      var slot = stationRawSlotNumber(sat);
      if (slot !== slotNumber) continue;
      var satMs = new Date(sat.sample_epoch).getTime();
      if (!isFinite(satMs)) continue;
      var delta = Math.abs(satMs - hubMs);
      if (delta <= 150000 && delta < bestDelta) {
        best = sat;
        bestDelta = delta;
      }
    }
    return best;
  }

  function applySat(feed, sat, slotNumber) {
    if (!sat || !slotNumber) return;
    feed['sat_' + slotNumber + '_temp_1'] = sat.temp_1;
    feed['sat_' + slotNumber + '_humidity_1'] = sat.humidity_1;
    feed['sat_' + slotNumber + '_temp_2'] = sat.temp_2;
    feed['sat_' + slotNumber + '_humidity_2'] = sat.humidity_2;
    feed['sat_' + slotNumber + '_battery_v'] = sat.battery_v;
    feed['sat_' + slotNumber + '_battery_pct'] = sat.battery_pct;
  }

  var feeds = hubRows.map(function(hub) {
    var feed = {
      entry_id: hub.id,
      created_at: hub.sample_epoch,
      temp_1: hub.temp_1,
      humidity_1: hub.humidity_1,
      temp_2: hub.temp_2,
      humidity_2: hub.humidity_2,
      temp_3: hub.temp_3,
      humidity_3: hub.humidity_3,
      battery_v: hub.battery_v,
      battery_pct: hub.battery_pct,
      solar_v: hub.solar_v
    };
    activeSlots.forEach(function(slotNumber) {
      applySat(feed, nearestSat(hub, slotNumber), slotNumber);
    });
    return feed;
  });

  return {
    source: 'samples_raw',
    generated_at: new Date().toISOString(),
    data_as_of: feeds.length ? feeds[feeds.length - 1].created_at : null,
    schema_version: 1,
    station_id: stationId,
    device_id: stationId,
    time_range: meta.timeRange || null,
    downsampling: {
      total_rows: hubRows.length,
      step: 1,
      returned: feeds.length,
      target: meta.target || null
    },
    feeds: feeds,
    slot_map: slotMap,
    device_status: meta.deviceStatus || null,
    device_config: meta.deviceConfig || null,
    sync_sessions: Array.isArray(meta.syncSessions) ? meta.syncSessions : [],
    upload_sessions: Array.isArray(meta.uploadSessions) ? meta.uploadSessions : []
  };
}

async function fetchSamplesRawStationPayload(stationId, windowLike, opts) {
  opts = opts || {};
  var bounds = windowLike || {};
  var from = bounds.from instanceof Date ? bounds.from : new Date(bounds.from || Date.now() - 7 * 86400000);
  var to = bounds.to instanceof Date ? bounds.to : new Date(bounds.to || Date.now());
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error('Invalid raw fallback window');

  var supaCfg = getSupabaseConfig();
  var hdrs = supabaseHeaders(supaCfg.key);
  var safeMode = typeof dashboardEgressSafeMode === 'function' ? dashboardEgressSafeMode() : true;
  var maxRowsHardCap = safeMode ? 3000 : 12000;
  var maxRows = dashboardClampInt(opts.maxRows, safeMode ? 3000 : 12000, 1, maxRowsHardCap);
  var pageSize = dashboardClampInt(opts.pageSize, safeMode ? 500 : 1000, 1, Math.min(1000, maxRows));
  var sideLimit = safeMode ? 300 : 1000;
  var fromIso = from.toISOString();
  var toIso = to.toISOString();

  var select = [
    'id', 'device_id', 'node_id', 'slot_number', 'sample_id', 'sample_epoch',
    'temp_1', 'humidity_1', 'temp_2', 'humidity_2', 'temp_3', 'humidity_3',
    'battery_v', 'battery_pct', 'solar_v', 'inserted_at'
  ].join(',');

  var rows = [];
  for (var offset = 0; offset < maxRows; offset += pageSize) {
    var url = supaCfg.url + '/rest/v1/samples_raw' +
      '?select=' + encodeURIComponent(select) +
      '&device_id=eq.' + encodeURIComponent(stationId) +
      '&sample_epoch=gte.' + encodeURIComponent(fromIso) +
      '&sample_epoch=lte.' + encodeURIComponent(toIso) +
      '&order=sample_epoch.asc' +
      '&limit=' + pageSize +
      '&offset=' + offset;
    var res = await fetchWithTimeout(url, 30000, { headers: hdrs });
    if (!res.ok) throw new Error('samples_raw HTTP ' + res.status);
    var batch = await res.json();
    if (Array.isArray(batch) && batch.length) rows = rows.concat(batch);
    if (!Array.isArray(batch) || batch.length < pageSize) break;
    await yieldToBrowser();
  }

  async function fetchOne(path) {
    try {
      var res = await fetchWithTimeout(supaCfg.url + path, 15000, { headers: hdrs });
      if (!res.ok) return null;
      var data = await res.json();
      return Array.isArray(data) && data.length ? data[0] : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchMany(path) {
    try {
      var res = await fetchWithTimeout(supaCfg.url + path, 15000, { headers: hdrs });
      if (!res.ok) return [];
      var data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  var status = await fetchOne('/rest/v1/device_status?device_id=eq.' + encodeURIComponent(stationId) + '&select=device_id,last_seen,last_upload_at,next_check_in,battery_pct,fw_version');
  var config = await fetchOne('/rest/v1/device_config?device_id=eq.' + encodeURIComponent(stationId) + '&select=device_id,upload_interval_hours,sample_period_min,sat_sync_period_hours,deploy_mode,sleep_enable,updated_at');
  var syncs = await fetchMany('/rest/v1/sync_sessions?device_id=eq.' + encodeURIComponent(stationId) + '&select=*&sync_started_at=gte.' + encodeURIComponent(fromIso) + '&sync_started_at=lte.' + encodeURIComponent(toIso) + '&order=sync_started_at.asc&limit=' + sideLimit);
  var uploads = await fetchMany('/rest/v1/upload_sessions?device_id=eq.' + encodeURIComponent(stationId) + '&select=*&upload_started_at=gte.' + encodeURIComponent(fromIso) + '&upload_started_at=lte.' + encodeURIComponent(toIso) + '&order=upload_started_at.asc&limit=' + sideLimit);

  return buildSamplesRawStationPayload(stationId, rows, {
    timeRange: { from: fromIso, to: toIso },
    target: opts.target || null,
    deviceStatus: status,
    deviceConfig: config,
    syncSessions: syncs,
    uploadSessions: uploads
  });
}

// =====================================================================
// DASHBOARD DIAGNOSTICS PANEL
// =====================================================================

function dashboardDiagEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dashboardDiagFormatUtc(value) {
  if (value == null || value === '') return '--';
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }) + ' UTC';
}

function dashboardDiagFormatDuration(ms) {
  if (ms == null || ms === '' || !isFinite(Number(ms))) return '--';
  return Math.round(Number(ms)) + ' ms';
}

function renderDashboardDiagnostics(panelId, info) {
  var host = document.getElementById(panelId);
  if (!host) return;

  info = info || {};
  var summary = info.summary || 'Diagnostics';
  var pill = info.pill
    ? '<span class="diag-pill diag-' + dashboardDiagEscapeHtml(info.pillTone || 'muted') + '">' + dashboardDiagEscapeHtml(info.pill) + '</span>'
    : '';
  var rows = Array.isArray(info.rows) ? info.rows : [];
  var rowHtml = rows.map(function(row) {
    var value = row && row.value != null && row.value !== '' ? row.value : '--';
    var tone = row && row.tone ? ' diag-value-' + dashboardDiagEscapeHtml(row.tone) : '';
    return '<div class="diag-item">' +
      '<div class="diag-label">' + dashboardDiagEscapeHtml(row && row.label ? row.label : '--') + '</div>' +
      '<div class="diag-value' + tone + '">' + dashboardDiagEscapeHtml(value) + '</div>' +
      '</div>';
  }).join('');

  var noteHtml = info.note ? '<div class="diag-message diag-message-note">' + dashboardDiagEscapeHtml(info.note) + '</div>' : '';
  var errorHtml = info.error ? '<div class="diag-message diag-message-error">' + dashboardDiagEscapeHtml(info.error) + '</div>' : '';

  host.innerHTML = '<summary>' + dashboardDiagEscapeHtml(summary) + pill + '</summary>' +
    '<div class="diag-grid">' + rowHtml + '</div>' +
    noteHtml +
    errorHtml;
}

// =====================================================================
// ACCESS CONTROL — ROLE-BASED GATING
// =====================================================================

var ACCESS_CONTROL_CACHE_KEY = 'seaweed_access_control_cache';

/**
 * Normalize role feature flags to the modern { settings, battery, stationHealth } shape.
 */
function normalizeAccessRoleFeatures(role) {
  role = role || {};
  var f = role.features && typeof role.features === 'object' ? role.features : null;
  return {
    settings:      f ? f.settings !== false      : role.canViewSettings !== false,
    battery:       f ? f.battery !== false       : role.canViewBattery !== false,
    stationHealth: f ? f.stationHealth !== false : role.canViewStationHealth !== false
  };
}

function normalizeAccessRoleStations(stations) {
  if (!Array.isArray(stations)) return ['*'];
  if (!stations.length) return [];
  if (stations.indexOf('*') !== -1) return ['*'];
  var seen = {};
  var out = [];
  for (var i = 0; i < stations.length; i++) {
    var sid = String(stations[i] || '').trim().toLowerCase();
    if (!sid || seen[sid]) continue;
    seen[sid] = true;
    out.push(sid);
  }
  return out;
}

function sanitizeAccessRoleForBrowser(role) {
  if (!role || typeof role !== 'object') return null;
  return {
    roleId: String(role.roleId || '').trim(),
    password: '',
    allowedStations: normalizeAccessRoleStations(role.allowedStations),
    features: normalizeAccessRoleFeatures(role)
  };
}

function sanitizeAccessRolesForBrowser(rolesArray) {
  rolesArray = Array.isArray(rolesArray) ? rolesArray : [];
  var out = [];
  for (var i = 0; i < rolesArray.length; i++) {
    var role = sanitizeAccessRoleForBrowser(rolesArray[i]);
    if (!role || !role.roleId) continue;
    out.push(role);
  }
  return out;
}

function extractAccessRoleArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.roles)) return payload.roles;
  return [];
}

function storeSanitizedAccessControlRoles(rolesArray) {
  var sanitized = sanitizeAccessRolesForBrowser(rolesArray);
  try {
    localStorage.setItem(ACCESS_CONTROL_CACHE_KEY, JSON.stringify({ roles: sanitized }));
  } catch (e) {}
  try {
    var cfg = JSON.parse(localStorage.getItem(DASHBOARD_CONFIG_KEY) || '{}') || {};
    cfg.accessControl = sanitized;
    localStorage.setItem(DASHBOARD_CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {}
  return sanitized;
}

function stripAccessControlSecretsFromBrowserStorage() {
  try { localStorage.removeItem('seaweed_github_pat'); } catch (e) {}

  try {
    var rawCache = localStorage.getItem(ACCESS_CONTROL_CACHE_KEY);
    if (rawCache) {
      var parsedCache = JSON.parse(rawCache);
      localStorage.setItem(ACCESS_CONTROL_CACHE_KEY, JSON.stringify({
        roles: sanitizeAccessRolesForBrowser(extractAccessRoleArray(parsedCache))
      }));
    }
  } catch (e) {}

  try {
    var rawCfg = localStorage.getItem(DASHBOARD_CONFIG_KEY);
    if (rawCfg) {
      var cfg = JSON.parse(rawCfg) || {};
      if (Array.isArray(cfg.accessControl)) {
        cfg.accessControl = sanitizeAccessRolesForBrowser(cfg.accessControl);
        localStorage.setItem(DASHBOARD_CONFIG_KEY, JSON.stringify(cfg));
      }
    }
  } catch (e) {}
}

stripAccessControlSecretsFromBrowserStorage();

/**
 * Fetch sanitized role definitions from Supabase.
 * Stored passwords are never returned to the browser.
 */
async function fetchAccessRoleDefinitions() {
  try {
    var supaCfg = getSupabaseConfig();
    if (!supaCfg.url || !supaCfg.key) return getCachedAccessRoleDefinitions();
    var url = supaCfg.url + '/rest/v1/rpc/dashboard_get_access_roles';
    var res = await fetchWithTimeout(url, 10000, {
      method: 'POST',
      headers: Object.assign({}, supabaseHeaders(supaCfg.key), {
        'Content-Type': 'application/json'
      }),
      body: '{}'
    });
    if (!res.ok) return getCachedAccessRoleDefinitions();
    return storeSanitizedAccessControlRoles(extractAccessRoleArray(await res.json()));
  } catch (e) { /* network error — use cache */ }
  return getCachedAccessRoleDefinitions();
}

function getCachedAccessRoleDefinitions() {
  try {
    var raw = localStorage.getItem(ACCESS_CONTROL_CACHE_KEY);
    if (raw) {
      return sanitizeAccessRolesForBrowser(extractAccessRoleArray(JSON.parse(raw)));
    }
  } catch (e) {}
  return [];
}

/**
 * Backward-compatible alias for existing callers.
 */
async function fetchAccessControl() {
  return fetchAccessRoleDefinitions();
}

function getCachedAccessControlRoles() {
  return getCachedAccessRoleDefinitions();
}

function getCachedAccessRoleById(roleId) {
  var wanted = String(roleId || '').trim();
  if (!wanted) return null;
  var roles = getCachedAccessRoleDefinitions();
  for (var i = 0; i < roles.length; i++) {
    if (roles[i] && roles[i].roleId === wanted) return roles[i];
  }
  return null;
}

/**
 * Validate the entered role password server-side.
 */
async function authenticateAccessRole(password) {
  var supaCfg = getSupabaseConfig();
  if (!supaCfg.url || !supaCfg.key) throw new Error('Supabase not configured');
  var pwd = String(password || '').trim();
  if (!pwd) return null;
  var url = supaCfg.url + '/rest/v1/rpc/dashboard_authenticate_access_role';
  var res = await fetchWithTimeout(url, 15000, {
    method: 'POST',
    headers: Object.assign({}, supabaseHeaders(supaCfg.key), {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ p_password: pwd })
  });
  if (!res.ok) {
    var detail = '';
    try { detail = await res.text(); } catch (_) {}
    var lower = String(detail || '').toLowerCase();
    if (res.status === 404 || lower.indexOf('dashboard_authenticate_access_role') >= 0 || lower.indexOf('could not find the function') >= 0) {
      throw new Error('Auth RPC not installed in Supabase. Run 2026-04-15_dashboard_access_control_private_auth.sql first.');
    }
    throw new Error('dashboard_authenticate_access_role HTTP ' + res.status + (detail ? ' ' + detail.slice(0, 160) : ''));
  }
  var payload = await res.json();
  if (!payload || payload.authenticated !== true || !payload.role) return null;
  return sanitizeAccessRoleForBrowser(payload.role);
}

/**
 * Push updated access roles to Supabase without exposing stored passwords.
 * Blank incoming passwords keep the current stored password for that role.
 */
async function pushAccessControlToSupabase(rolesArray, adminPassword) {
  var supaCfg = getSupabaseConfig();
  if (!supaCfg.url || !supaCfg.key) throw new Error('Supabase not configured');
  var adminPwd = String(adminPassword || '').trim();
  if (!adminPwd) throw new Error('Admin password required');
  var url = supaCfg.url + '/rest/v1/rpc/dashboard_upsert_access_roles';
  var res = await fetchWithTimeout(url, 15000, {
    method: 'POST',
    headers: Object.assign({}, supabaseHeaders(supaCfg.key), {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      p_admin_password: adminPwd,
      p_roles: Array.isArray(rolesArray) ? rolesArray : []
    })
  });
  if (!res.ok) {
    var detail = '';
    try { detail = await res.text(); } catch (_) {}
    throw new Error('Push access_control failed: HTTP ' + res.status + (detail ? ' ' + detail.slice(0, 160) : ''));
  }
  return storeSanitizedAccessControlRoles(extractAccessRoleArray(await res.json()));
}

/**
 * Push device profiles to Supabase dashboard_config (admin only).
 */
async function pushDeviceProfilesToSupabase(profiles) {
  var supaCfg = getSupabaseConfig();
  if (!supaCfg.url || !supaCfg.key) throw new Error('Supabase not configured');
  var url = supaCfg.url + '/rest/v1/dashboard_config?key=eq.device_profiles';
  var res = await fetchWithTimeout(url, 15000, {
    method: 'PATCH',
    headers: Object.assign({}, supabaseHeaders(supaCfg.key), {
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }),
    body: JSON.stringify({ value: profiles })
  });
  if (!res.ok) throw new Error('Push device_profiles failed: HTTP ' + res.status);
  cacheSharedDeviceProfiles(profiles, Date.now());
  applySharedDeviceProfilesToDashboardConfig(profiles, { fetchedAt: Date.now(), source: 'local-push' });
}

/**
 * Fetch shared device profiles from Supabase dashboard_config.
 * Merges into local config as authoritative source for coords, install dates, etc.
 */
async function fetchSharedDeviceProfiles() {
  try {
    var supaCfg = getSupabaseConfig();
    if (!supaCfg.url || !supaCfg.key) return null;
    var url = supaCfg.url + '/rest/v1/dashboard_config?key=eq.device_profiles&select=value';
    var res = await fetchWithTimeout(url, 10000, { headers: supabaseHeaders(supaCfg.key) });
    if (!res.ok) return null;
    var rows = await res.json();
    if (rows.length && Array.isArray(rows[0].value) && rows[0].value.length) {
      return rows[0].value;
    }
  } catch (e) {}
  return null;
}

// ── Session role state ──────────────────────────────────────────────

/**
 * Get the current session's role context (set by login.html).
 * Returns { roleId, allowedStations, features } or a default admin-like fallback
 * when no access control is configured (backward compat).
 */
function getCurrentRole() {
  try {
    var roleId = sessionStorage.getItem('sw_role');
    if (roleId) {
      var cachedRole = getCachedAccessRoleById(roleId);
      var stations = cachedRole
        ? normalizeAccessRoleStations(cachedRole.allowedStations)
        : normalizeAccessRoleStations(JSON.parse(sessionStorage.getItem('sw_allowed_stations') || '["*"]'));
      var features = cachedRole && cachedRole.features
        ? cachedRole.features
        : JSON.parse(sessionStorage.getItem('sw_features') || '{}');
      try {
        var normalizedFeatures = {
          settings: features.settings !== false,
          battery: features.battery !== false,
          stationHealth: features.stationHealth !== false
        };
        if (Object.prototype.hasOwnProperty.call(features, 'tableConfigurationView')) {
          normalizedFeatures.tableConfigurationView = features.tableConfigurationView !== false;
        }
        if (Object.prototype.hasOwnProperty.call(features, 'tableConfigurationEdit')) {
          normalizedFeatures.tableConfigurationEdit = features.tableConfigurationEdit === true;
        }
        sessionStorage.setItem('sw_allowed_stations', JSON.stringify(stations));
        sessionStorage.setItem('sw_features', JSON.stringify(normalizedFeatures));
      } catch (_) {}
      var normalizedFeatures = {
        settings: features.settings !== false,
        battery: features.battery !== false,
        stationHealth: features.stationHealth !== false
      };
      if (Object.prototype.hasOwnProperty.call(features, 'tableConfigurationView')) {
        normalizedFeatures.tableConfigurationView = features.tableConfigurationView !== false;
      }
      if (Object.prototype.hasOwnProperty.call(features, 'tableConfigurationEdit')) {
        normalizedFeatures.tableConfigurationEdit = features.tableConfigurationEdit === true;
      }
      return {
        roleId: roleId,
        allowedStations: stations,
        features: normalizedFeatures
      };
    }
  } catch (e) {}
  // Fallback: no role set → legacy mode (full access)
  return {
    roleId: null,
    allowedStations: ['*'],
    features: { settings: true, battery: true, stationHealth: true }
  };
}

/**
 * Check if a station is visible for the current role.
 */
function addStationRoleAlias(list, value) {
  var raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return;
  list.push(raw);
  var dashed = raw.replace(/[\s_]+/g, '-');
  var underscored = raw.replace(/[\s-]+/g, '_');
  if (dashed !== raw) list.push(dashed);
  if (underscored !== raw) list.push(underscored);
}

function stationRoleAliases(stationLike) {
  var aliases = [];
  if (typeof stationLike === 'string') {
    addStationRoleAlias(aliases, stationLike);
  } else if (stationLike && typeof stationLike === 'object') {
    [
      stationLike.id,
      stationLike.device_id,
      stationLike.station_id,
      stationLike.stationKey,
      stationLike.station_key,
      stationLike.stationUid,
      stationLike.station_uid,
      stationLike.name,
      stationLike.stationName,
      stationLike.station_name,
      stationLike.legacy_device_id
    ].forEach(function(value) { addStationRoleAlias(aliases, value); });

    ['catalog_aliases', 'catalogAliases', 'aliases', 'historical_source_keys', 'historicalSourceKeys'].forEach(function(key) {
      if (!Array.isArray(stationLike[key])) return;
      stationLike[key].forEach(function(value) { addStationRoleAlias(aliases, value); });
    });
  }
  var seen = {};
  return aliases.filter(function(alias) {
    if (!alias || seen[alias]) return false;
    seen[alias] = true;
    return true;
  });
}

function isStationVisibleForRole(stationLike) {
  var role = getCurrentRole();
  if (!role.allowedStations) return true;
  if (!role.allowedStations.length) return false;
  if (role.allowedStations.indexOf('*') !== -1) return true;
  var allowed = {};
  role.allowedStations.forEach(function(item) {
    stationRoleAliases(String(item || '')).forEach(function(alias) { allowed[alias] = true; });
  });
  return stationRoleAliases(stationLike).some(function(alias) { return !!allowed[alias]; });
}

/**
 * Filter a stations array to only those allowed by the current role.
 */
function filterStationsForRole(stationsArray) {
  if (!Array.isArray(stationsArray)) return [];
  return stationsArray.filter(function(s) {
    return isStationVisibleForRole(s);
  });
}

/**
 * Check if the current role can access a feature.
 * @param {string} featureName - 'settings', 'battery', or 'stationHealth'
 */
function canAccessFeature(featureName) {
  var role = getCurrentRole();
  return !!role.features[featureName];
}

/**
 * Page guard: redirect if the current role cannot access a feature.
 * Call at top of page scripts.
 */
function requireFeature(featureName, redirectUrl) {
  if (!canAccessFeature(featureName)) {
    var dest = redirectUrl || '../v4/overview.html';
    location.replace(dest);
    return false;
  }
  return true;
}

/**
 * Hide nav elements whose data-feature attribute is not allowed for the current role.
 * Also hides station-specific links whose data-station-link is not in allowed stations.
 * Call on DOMContentLoaded or after header is in the DOM.
 */
function applyNavVisibility() {
  var role = getCurrentRole();
  // Feature-gated links
  document.querySelectorAll('[data-feature]').forEach(function(el) {
    var feature = el.getAttribute('data-feature');
    if (!canAccessFeature(feature)) {
      el.style.display = 'none';
    }
  });
  // Station-scoped links
  document.querySelectorAll('[data-station-link]').forEach(function(el) {
    var sid = el.getAttribute('data-station-link');
    if (!isStationVisibleForRole(sid)) {
      el.style.display = 'none';
    }
  });
}
