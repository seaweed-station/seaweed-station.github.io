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

// =====================================================================
// SUPABASE HELPERS
// =====================================================================

/** Default Supabase project URL (override via localStorage seaweed_dashboard_config.supabaseUrl) */
var SUPABASE_URL_DEFAULT  = 'https://qjtjmczixgjxxwmyabmk.supabase.co';   // TODO: replace with https://<project-id>.supabase.co
/** Default Supabase anon key (override via localStorage) */
var SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqdGptY3ppeGdqeHh3bXlhYm1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MjUzMzEsImV4cCI6MjA4ODIwMTMzMX0.K7NdFhCiHJdDpwwiERhH_GVH-AMqaMizPYegaiP2tqg';  // TODO: replace with your project's anon/public key

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
    if (s.supabaseUrl)     url = s.supabaseUrl;
    if (s.supabaseAnonKey) key = s.supabaseAnonKey;
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

/**
 * Convert a Supabase sensor_readings row into a legacy feed
 * object with field1–field8.  This allows existing parseFeeds / parseStationData
 * functions to consume Supabase data without modification.
 *
 * @param {Object} row - A row from the sensor_readings table.
 * @returns {Object}   - { created_at, entry_id, field1..field8 }
 */
function supabaseRowToFeed(row) {
  function v(x) { return (x != null) ? String(x) : ''; }
  return {
    created_at: ensureUTC(row.recorded_at),
    entry_id:   row.id,
    field1: v(row.battery_pct),
    field2: [v(row.temp_1), v(row.humidity_1), v(row.temp_2), v(row.humidity_2)].join(','),
    field3: [v(row.battery_v), v(row.rssi), v(row.boot_count), v(row.free_heap)].join(','),
    field4: [v(row.sat_a_battery_v), v(row.sat_a_battery_pct), v(row.sat_a_rssi),
             v(row.sat_a_sample_id), v(row.sat_a_flash_pct), v(row.sat_a_sync_drift),
             v(row.sat_a_fw_ver)].join(','),
    field5: [v(row.sat_a_temp_1), v(row.sat_a_humidity_1),
             v(row.sat_a_temp_2), v(row.sat_a_humidity_2)].join(','),
    field6: [v(row.sat_b_battery_v), v(row.sat_b_battery_pct), v(row.sat_b_rssi),
             v(row.sat_b_sample_id), v(row.sat_b_flash_pct), v(row.sat_b_sync_drift),
             v(row.sat_b_fw_ver)].join(','),
    field7: [v(row.sat_b_temp_1), v(row.sat_b_humidity_1),
             v(row.sat_b_temp_2), v(row.sat_b_humidity_2)].join(','),
    field8: '|' + [v(row.deploy_mode), v(row.sample_period_s),
                   v(row.bulk_interval_s), v(row.bulk_freq_hours)].join(',')
               + '|' + [v(row.fw_version), v(row.fw_date)].join(','),
  };
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
  var fallback = normalizeDataFolder(defaultFolder, defaultFolder);
  try {
    var s = JSON.parse(localStorage.getItem('seaweed_dashboard_config') || '{}');
    var c = (s.channels || []).find(function (ch) { return ch.id === configKey; });
    if (c && c.dataFolder) return normalizeDataFolder(c.dataFolder, fallback);
  } catch (e) { /* ignore */ }
  return fallback;
}

// =====================================================================
// GITHUB ACTIONS TRIGGER
// =====================================================================

/** GitHub repo coordinates for workflow_dispatch */
var GITHUB_REPO  = 'bosunjm-cloud/seaweed-station-dashboard';
var GITHUB_WORKFLOW = 'download-data.yml';

/**
 * Trigger the download_data.ps1 workflow via GitHub Actions workflow_dispatch.
 * Requires a GitHub PAT with actions:write scope stored in localStorage.
 *
 * Updates the button with id="btnTriggerDL" and shows status in
 * either #triggerStatus or #fetchStatus (whichever exists on the page).
 */
function triggerCIDownload() {
  var pat = localStorage.getItem('seaweed_github_pat');
  if (!pat) {
    alert('Set a GitHub Personal Access Token in Settings first (needs actions:write scope).');
    return;
  }

  var btn = document.getElementById('btnTriggerDL');
  var status = document.getElementById('triggerStatus') || document.getElementById('fetchStatus');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Triggering\u2026'; }
  if (status) status.textContent = '';

  fetch('https://api.github.com/repos/' + GITHUB_REPO + '/actions/workflows/' + GITHUB_WORKFLOW + '/dispatches', {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + pat,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ ref: 'main' })
  }).then(function (res) {
    if (res.status === 204) {
      if (status) status.innerHTML = '<span style="color:var(--success,#22c55e)">\u2705 Download triggered! Data will update in ~2 min.</span>';
    } else {
      return res.json().then(function (j) { throw new Error(j.message || ('HTTP ' + res.status)); });
    }
  }).catch(function (err) {
    if (status) status.innerHTML = '<span style="color:var(--danger,#ef4444)">\u274C ' + err.message + '</span>';
  }).finally(function () {
    if (btn) { btn.disabled = false; btn.innerHTML = '\u26A1 Download'; }
  });
}

// =====================================================================
// SHARED SUPABASE DATA FETCH
// =====================================================================

/**
 * Fetch sensor_readings for one station from Supabase.
 * Returns rows as ThingSpeak-compatible feed objects via supabaseRowToFeed().
 *
 * @param {string} stationId - Device ID (e.g. 'perth', 'shangani', 'funzi')
 * @param {Object} [opts]
 * @param {number} [opts.limit=8000]   - Max rows
 * @param {number} [opts.timeoutMs=30000]
 * @returns {Promise<{feeds: Object[], source: string, rows: number, rawRows: Object[]}>}
 *          Resolves with feed array + metadata.  Rejects on network/auth error.
 */
async function fetchStationData(stationId, opts) {
  opts = opts || {};
  var limit = opts.limit || 8000;
  var supaCfg = getSupabaseConfig();
  if (!supaCfg.url || !supaCfg.key ||
      supaCfg.url === 'YOUR_SUPABASE_URL' || supaCfg.key === 'YOUR_SUPABASE_ANON_KEY') {
    throw new Error('Supabase not configured');
  }
  var hdrs = supabaseHeaders(supaCfg.key);
  var allRows = [];
  var pageSize = 1000;
  var offset = 0;
  // Paginate to collect up to `limit` rows
  while (offset < limit) {
    var batchLimit = Math.min(pageSize, limit - offset);
    var url = supaCfg.url + '/rest/v1/sensor_readings' +
              '?device_id=eq.' + encodeURIComponent(stationId) +
              '&order=recorded_at.asc' +
              '&limit=' + batchLimit +
              '&offset=' + offset;
    var res = await fetchWithTimeout(url, opts.timeoutMs || 30000, { headers: hdrs });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var batch = await res.json();
    if (!batch.length) break;
    allRows = allRows.concat(batch);
    if (batch.length < batchLimit) break; // last page
    offset += batch.length;
  }
  // Convert to ThingSpeak-compatible feed format
  var feeds = allRows.map(supabaseRowToFeed);
  return { feeds: feeds, source: 'live', rows: allRows.length, rawRows: allRows };
}

/**
 * Load station data with priority chain: Supabase → localStorage cache → static file.
 *
 * @param {string} stationId    - Device ID (e.g. 'perth', 'shangani', 'funzi')
 * @param {Object} [opts]
 * @param {string} [opts.cacheKey]     - localStorage key for cached feeds (default: 'seaweed_cache_<stationId>')
 * @param {string} [opts.fileUrl]      - URL of the static merged_data.js fallback
 * @param {number} [opts.limit=8000]   - Max Supabase rows
 * @param {number} [opts.timeoutMs=30000]
 * @param {function} [opts.onStatus]   - Callback(message) for progress updates
 * @returns {Promise<{feeds: Object[], source: string, rows: number}>}
 */
async function loadStationData(stationId, opts) {
  opts = opts || {};
  var cacheKey = opts.cacheKey || ('seaweed_cache_' + stationId);
  var status = opts.onStatus || function () {};

  // --- 1. Try Supabase live fetch ---
  try {
    status('Fetching live data from Supabase\u2026');
    var result = await fetchStationData(stationId, {
      limit: opts.limit,
      timeoutMs: opts.timeoutMs
    });
    // Cache the feeds for cross-page sharing (matches station.html format)
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        allEntries: result.feeds,
        savedAt: Date.now()
      }));
    } catch (e) { /* quota exceeded — ignore */ }
    status('Loaded ' + result.rows + ' rows from Supabase');
    return { feeds: result.feeds, source: 'supabase', rows: result.rows };
  } catch (supaErr) {
    status('Supabase unavailable: ' + supaErr.message);
  }

  // --- 2. Try localStorage cache ---
  try {
    var cached = localStorage.getItem(cacheKey);
    if (cached) {
      var data = JSON.parse(cached);
      var feeds = data.allEntries || data;  // handle {allEntries:...} or raw [...] format
      if (Array.isArray(feeds) && feeds.length) {
        var ts = data.savedAt ? new Date(data.savedAt).toISOString() : 'unknown';
        status('Using cached data (' + feeds.length + ' entries, saved ' + ts + ')');
        return { feeds: feeds, source: 'cache', rows: feeds.length };
      }
    }
  } catch (e) { /* corrupt cache — ignore */ }

  // --- 3. Fall back to static file ---
  if (opts.fileUrl) {
    status('Loading from static file\u2026');
    var res = await fetchWithTimeout(opts.fileUrl, opts.timeoutMs || 30000);
    if (!res.ok) throw new Error('Static file HTTP ' + res.status);
    var text = await res.text();
    // Static files define a global variable; eval the script to extract feeds
    var scriptEl = document.createElement('script');
    scriptEl.textContent = text;
    document.head.appendChild(scriptEl);
    document.head.removeChild(scriptEl);
    status('Loaded from static file');
    return { feeds: null, source: 'file', rows: 0 }; // page will use the global var set by the script
  }

  throw new Error('No data source available for ' + stationId);
}
