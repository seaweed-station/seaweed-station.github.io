(function(window, document) {
  "use strict";

  var CACHE_PREFIX = "sw_v4_table_config_";
  var DEFAULT_ROWS = [];
  var state = {
    station: null,
    rows: [],
    editId: null,
    canView: false,
    canEdit: false,
    source: "",
    dirty: false
  };

  function text(value) {
    return window.SeaweedV4 ? window.SeaweedV4.text(value) : String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return window.SeaweedV4 ? window.SeaweedV4.escapeHtml(value) : text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function features() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem("sw_features") || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function stationKey(station) {
    return text(station && (station.station_uid || station.stationUid || station.station_key || station.id || window.__TABLE_ID || "station"));
  }

  function cacheKey(station) {
    return CACHE_PREFIX + stationKey(station).toLowerCase();
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function cleanDate(value) {
    var raw = text(value);
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    var d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  function normalizeRow(row, idx) {
    row = row || {};
    var config = row.configuration && typeof row.configuration === "object" ? row.configuration : row;
    var id = text(row.id || row.row_id || row.localId || "");
    if (!id) id = "local-" + Date.now() + "-" + idx;
    return {
      id: id,
      frontPanel: text(config.frontPanel || config.front_panel || config.front || row.front_panel || row.front || "Closed") || "Closed",
      rearPanel: text(config.rearPanel || config.rear_panel || config.rear || row.rear_panel || row.rear || "Closed") || "Closed",
      other: text(config.other || config.notes || row.notes || row.other || ""),
      startDate: cleanDate(row.startDate || row.start_date || row.start || config.startDate || config.start_date),
      endDate: cleanDate(row.endDate || row.end_date || row.end || config.endDate || config.end_date),
      appliedAt: text(row.appliedAt || row.applied_at || row.updated_at || row.created_at || config.appliedAt || ""),
      revision: Number(row.revision) || 1,
      deletedAt: text(row.deleted_at || row.deletedAt || "")
    };
  }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(normalizeRow).filter(function(row) {
      return row.startDate && !row.deletedAt;
    }).sort(function(a, b) {
      return b.startDate.localeCompare(a.startDate) || String(b.appliedAt).localeCompare(String(a.appliedAt));
    });
  }

  function payloadRows() {
    return state.rows.map(function(row) {
      return {
        id: row.id,
        startDate: row.startDate,
        endDate: row.endDate || null,
        configuration: {
          frontPanel: row.frontPanel,
          rearPanel: row.rearPanel
        },
        notes: row.other,
        appliedAt: row.appliedAt || nowLocal(),
        revision: row.revision || 1
      };
    });
  }

  function setStatus(message, tone) {
    var el = document.getElementById("tableConfigStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "table-config-status" + (tone ? " " + tone : "");
  }

  function getStation() {
    var station = null;
    if (window.SW_V4_DASHBOARD && typeof window.SW_V4_DASHBOARD.findStation === "function") {
      station = window.SW_V4_DASHBOARD.findStation(window.__TABLE_ID || new URLSearchParams(location.search).get("station") || "");
    }
    station = station || window.__STATION || {};
    if (!station.station_uid && station.stationUid) station.station_uid = station.stationUid;
    if (!station.station_key && station.stationKey) station.station_key = station.stationKey;
    if (!station.station_key && station.id) station.station_key = station.id;
    return station;
  }

  function readCache() {
    try {
      var parsed = JSON.parse(localStorage.getItem(cacheKey(state.station)) || "null");
      if (parsed && Array.isArray(parsed.rows)) return normalizeRows(parsed.rows);
    } catch (_) {}
    return DEFAULT_ROWS.slice();
  }

  function writeCache() {
    try {
      localStorage.setItem(cacheKey(state.station), JSON.stringify({
        station_uid: stationKey(state.station),
        station_key: text(state.station && state.station.station_key),
        saved_at: new Date().toISOString(),
        rows: payloadRows()
      }));
    } catch (_) {}
  }

  async function fetchRows() {
    if (!window.SeaweedV4 || !window.SeaweedV4.fetchTableConfigRows) throw new Error("V4 table config helper is not available");
    var rows = await window.SeaweedV4.fetchTableConfigRows(state.station);
    state.rows = normalizeRows(rows);
    state.source = "supabase";
    state.dirty = false;
    writeCache();
    render();
    setStatus("Loaded " + state.rows.length + " row(s) from V4 Supabase.", "good");
  }

  function loadCached(reason) {
    state.rows = readCache();
    state.source = "cache";
    render();
    setStatus(reason || "Using local cached table configuration until the V4 Supabase table/RPCs are applied.", "warn");
  }

  async function loadRows() {
    setStatus("Loading table configuration...", "");
    try {
      await fetchRows();
    } catch (err) {
      loadCached("V4 table configuration RPCs are not installed yet; using local cache/draft rows.");
    }
  }

  function resetForm() {
    state.editId = null;
    var front = document.getElementById("tcFront");
    var rear = document.getElementById("tcRear");
    var other = document.getElementById("tcOther");
    var start = document.getElementById("tcStart");
    var end = document.getElementById("tcEnd");
    var applyBtn = document.getElementById("tcApplyBtn");
    var cancelBtn = document.getElementById("tcCancelBtn");
    if (front) front.value = "Closed";
    if (rear) rear.value = "Closed";
    if (other) other.value = "";
    if (start) start.value = today();
    if (end) end.value = "";
    if (applyBtn) applyBtn.textContent = "Add Row";
    if (cancelBtn) cancelBtn.style.display = "none";
  }

  function renderForm() {
    var form = document.getElementById("tableConfigEditor");
    if (!form) return;
    form.style.display = state.canEdit ? "grid" : "none";
  }

  function badge(value, type) {
    var safe = escapeHtml(value || "--");
    var cls = "tc-badge";
    if (type === "front") cls += value === "Open" ? " open" : " closed";
    else if (type === "rear") cls += value === "Closed" ? " closed" : value === "Mid" ? " mid" : " full";
    return '<span class="' + cls + '">' + safe + '</span>';
  }

  function formatDate(value) {
    if (!value) return "";
    var d = new Date(value + "T00:00:00");
    if (isNaN(d.getTime())) return escapeHtml(value);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function renderRows() {
    var tbody = document.getElementById("tableConfigRows");
    if (!tbody) return;
    if (!state.rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="tc-empty">No table configuration rows yet.</td></tr>';
      return;
    }
    var current = today();
    tbody.innerHTML = state.rows.map(function(row, idx) {
      var active = row.startDate <= current && (!row.endDate || row.endDate >= current);
      return '<tr class="' + (active ? 'tc-active' : '') + '" data-row-id="' + escapeHtml(row.id) + '">' +
        '<td>' + (state.rows.length - idx) + '</td>' +
        '<td>' + badge(row.frontPanel, "front") + '</td>' +
        '<td>' + badge(row.rearPanel, "rear") + '</td>' +
        '<td>' + (row.other ? escapeHtml(row.other) : '<span class="muted">--</span>') + '</td>' +
        '<td class="mono">' + formatDate(row.startDate) + '</td>' +
        '<td class="mono">' + (row.endDate ? formatDate(row.endDate) : '<span class="tc-badge ongoing">Ongoing</span>') + '</td>' +
        '<td class="mono tc-small">' + escapeHtml(row.appliedAt || "--") + '</td>' +
        '<td class="tc-actions">' + (state.canEdit ? '<button class="btn btn-sm" type="button" data-tc-edit="' + escapeHtml(row.id) + '">Edit</button><button class="btn btn-sm tc-danger" type="button" data-tc-delete="' + escapeHtml(row.id) + '">Delete</button>' : '<span class="muted">View only</span>') + '</td>' +
      '</tr>';
    }).join("");
    tbody.querySelectorAll("[data-tc-edit]").forEach(function(btn) {
      btn.addEventListener("click", function() { editRow(btn.getAttribute("data-tc-edit")); });
    });
    tbody.querySelectorAll("[data-tc-delete]").forEach(function(btn) {
      btn.addEventListener("click", function() { deleteRow(btn.getAttribute("data-tc-delete")); });
    });
  }

  function render() {
    var root = document.getElementById("tableConfigCollapsible");
    if (!root) return;
    root.style.display = state.canView ? "block" : "none";
    renderForm();
    renderRows();
    var editHint = document.getElementById("tableConfigEditHint");
    if (editHint) editHint.textContent = state.canEdit ? "Editing enabled for this role." : "View-only for this role.";
  }

  function editRow(id) {
    var row = state.rows.find(function(item) { return String(item.id) === String(id); });
    if (!row) return;
    state.editId = row.id;
    document.getElementById("tcFront").value = row.frontPanel;
    document.getElementById("tcRear").value = row.rearPanel;
    document.getElementById("tcOther").value = row.other || "";
    document.getElementById("tcStart").value = row.startDate || today();
    document.getElementById("tcEnd").value = row.endDate || "";
    document.getElementById("tcApplyBtn").textContent = "Update Row";
    document.getElementById("tcCancelBtn").style.display = "inline-flex";
    document.getElementById("tableConfigEditor").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function deleteRow(id) {
    if (!state.canEdit) return;
    if (!window.confirm("Delete this table configuration row?")) return;
    state.rows = state.rows.filter(function(row) { return String(row.id) !== String(id); });
    state.dirty = true;
    writeCache();
    render();
    setStatus("Row deleted locally. Push to Supabase to share it.", "warn");
  }

  function applyRow() {
    if (!state.canEdit) return;
    var start = cleanDate(document.getElementById("tcStart").value);
    if (!start) {
      setStatus("Date Start is required.", "bad");
      return;
    }
    var row = {
      id: state.editId || "local-" + Date.now(),
      frontPanel: text(document.getElementById("tcFront").value) || "Closed",
      rearPanel: text(document.getElementById("tcRear").value) || "Closed",
      other: text(document.getElementById("tcOther").value),
      startDate: start,
      endDate: cleanDate(document.getElementById("tcEnd").value),
      appliedAt: nowLocal(),
      revision: 1
    };
    if (!state.editId) {
      var prev = new Date(start + "T00:00:00");
      prev.setDate(prev.getDate() - 1);
      var prevDay = prev.toISOString().slice(0, 10);
      state.rows.forEach(function(existing) {
        if (!existing.endDate && existing.startDate < start) existing.endDate = prevDay;
      });
      state.rows.push(row);
    } else {
      state.rows = state.rows.map(function(existing) {
        if (String(existing.id) !== String(state.editId)) return existing;
        return Object.assign({}, existing, row, { revision: (existing.revision || 1) + 1 });
      });
    }
    state.rows = normalizeRows(state.rows);
    state.dirty = true;
    writeCache();
    render();
    resetForm();
    setStatus("Saved locally. Push to Supabase to share it.", "warn");
  }

  async function pushRows() {
    if (!state.canEdit) return;
    if (!window.SeaweedV4 || !window.SeaweedV4.pushTableConfigRows) {
      setStatus("V4 table configuration helper is not available.", "bad");
      return;
    }
    setStatus("Pushing table configuration to V4 Supabase...", "");
    try {
      var rows = await window.SeaweedV4.pushTableConfigRows(state.station, payloadRows());
      state.rows = normalizeRows(rows);
      state.source = "supabase";
      state.dirty = false;
      writeCache();
      render();
      setStatus("Pushed " + state.rows.length + " row(s) to V4 Supabase.", "good");
    } catch (err) {
      setStatus("Push failed: " + (err && err.message ? err.message : "Unknown error"), "bad");
    }
  }

  function exportJson() {
    var payload = {
      schema: "seaweed-table-config-v1",
      exported_at: new Date().toISOString(),
      station_uid: text(state.station && state.station.station_uid),
      station_key: text(state.station && state.station.station_key),
      rows: payloadRows()
    };
    download("table_config_" + (text(state.station && state.station.station_key) || stationKey(state.station)) + ".json", JSON.stringify(payload, null, 2), "application/json");
  }

  function csvEscape(value) {
    var raw = text(value);
    if (/[",\n]/.test(raw)) return '"' + raw.replace(/"/g, '""') + '"';
    return raw;
  }

  function exportCsv() {
    var lines = ["id,front_panel,rear_panel,other,date_start,date_end,applied_at"];
    state.rows.slice().sort(function(a, b) { return a.startDate.localeCompare(b.startDate); }).forEach(function(row) {
      lines.push([row.id, row.frontPanel, row.rearPanel, row.other, row.startDate, row.endDate, row.appliedAt].map(csvEscape).join(","));
    });
    download("table_config_" + (text(state.station && state.station.station_key) || stationKey(state.station)) + ".csv", lines.join("\n"), "text/csv");
  }

  function download(name, body, type) {
    var blob = new Blob([body], { type: type || "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCsvLine(line) {
    var result = [];
    var cur = "";
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  function importFile(file) {
    if (!file || !state.canEdit) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var raw = String(ev.target.result || "");
        var imported;
        if (/\.json$/i.test(file.name)) {
          var json = JSON.parse(raw);
          imported = normalizeRows(json.rows || json);
        } else {
          var lines = raw.replace(/\r/g, "").split("\n").filter(function(line) { return line.trim(); });
          var header = parseCsvLine(lines.shift() || "").map(function(col) { return col.toLowerCase(); });
          imported = normalizeRows(lines.map(function(line, idx) {
            var cols = parseCsvLine(line);
            function col(name, fallbackIndex) {
              var found = header.indexOf(name);
              return cols[found >= 0 ? found : fallbackIndex] || "";
            }
            return {
              id: col("id", 0) || "import-" + idx,
              front_panel: col("front_panel", 1),
              rear_panel: col("rear_panel", 2),
              other: col("other", 3),
              start_date: col("date_start", 4),
              end_date: col("date_end", 5),
              applied_at: col("applied_at", 6)
            };
          }));
        }
        if (!imported.length) throw new Error("No valid rows found");
        if (!window.confirm("Import " + imported.length + " row(s)? This replaces the current local table configuration before you push.")) return;
        state.rows = imported;
        state.dirty = true;
        writeCache();
        render();
        setStatus("Imported " + imported.length + " row(s) locally. Push to Supabase to share them.", "warn");
      } catch (err) {
        setStatus("Import failed: " + (err && err.message ? err.message : "Unknown error"), "bad");
      }
    };
    reader.readAsText(file);
  }

  function bind() {
    var applyBtn = document.getElementById("tcApplyBtn");
    var cancelBtn = document.getElementById("tcCancelBtn");
    var pushBtn = document.getElementById("tcPushBtn");
    var refreshBtn = document.getElementById("tcRefreshBtn");
    var csvBtn = document.getElementById("tcExportCsvBtn");
    var jsonBtn = document.getElementById("tcExportJsonBtn");
    var importBtn = document.getElementById("tcImportBtn");
    var importInput = document.getElementById("tcImportInput");
    if (applyBtn) applyBtn.addEventListener("click", applyRow);
    if (cancelBtn) cancelBtn.addEventListener("click", resetForm);
    if (pushBtn) pushBtn.addEventListener("click", pushRows);
    if (refreshBtn) refreshBtn.addEventListener("click", loadRows);
    if (csvBtn) csvBtn.addEventListener("click", exportCsv);
    if (jsonBtn) jsonBtn.addEventListener("click", exportJson);
    if (importBtn && importInput) importBtn.addEventListener("click", function() { importInput.click(); });
    if (importInput) importInput.addEventListener("change", function() {
      importFile(importInput.files && importInput.files[0]);
      importInput.value = "";
    });
  }

  function init() {
    var root = document.getElementById("tableConfigCollapsible");
    if (!root) return;
    var f = features();
    var legacyAdmin = sessionStorage.getItem("sw_role") === "admin" && !Object.prototype.hasOwnProperty.call(f, "tableConfigurationView") && !Object.prototype.hasOwnProperty.call(f, "tableConfigurationEdit");
    state.canEdit = f.tableConfigurationEdit === true;
    if (legacyAdmin) state.canEdit = true;
    state.canView = state.canEdit || f.tableConfigurationView === true;
    state.station = getStation();
    bind();
    resetForm();
    render();
    if (state.canView) loadRows();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.SeaweedV4TableConfig = {
    init: init,
    loadRows: loadRows,
    exportCsv: exportCsv,
    exportJson: exportJson
  };
})(window, document);
