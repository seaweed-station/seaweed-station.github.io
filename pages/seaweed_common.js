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
 * Parse a comma-separated ThingSpeak field value into an array of numbers.
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
 *          Returns 'never' for null / invalid dates, 'in the future' for dates ahead of now.
 */
function timeAgo(date, suffix) {
  if (!date || isNaN(date.getTime())) return 'never';
  var ms = Date.now() - date.getTime();
  if (ms < 0) return 'in the future';
  var sec = Math.floor(ms / 1000);
  var sfx = suffix ? ' ago' : '';
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
// FETCH HELPERS
// =====================================================================

/**
 * Fetch with timeout — wraps native fetch with an AbortController.
 * @param {string} url
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  var controller = new AbortController();
  var tid = setTimeout(function () { controller.abort(); }, timeoutMs);
  return fetch(url, { signal: controller.signal })
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
