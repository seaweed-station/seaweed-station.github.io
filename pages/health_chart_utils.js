// health_chart_utils.js — Extracted from station_health.html (Sprint 6)
// LTTB downsampling, chart options builder, range labels, chart snapshot helpers

// Largest-Triangle-Three-Buckets downsampling for {x,y} arrays.
// Keeps first & last point, picks the most visually significant point per bucket.
var MAX_CHART_POINTS = (window.PlotCore && typeof PlotCore.resolveMaxPoints === 'function')
  ? PlotCore.resolveMaxPoints('health-series', 'all')
  : 350;
function lttbDownsample(data, maxPts) {
  if (window.PlotCore && typeof PlotCore.lttbDownsample === 'function') {
    maxPts = maxPts || _currentRangeMaxPts || MAX_CHART_POINTS;
    return PlotCore.lttbDownsample(data, maxPts);
  }
  maxPts = maxPts || _currentRangeMaxPts || MAX_CHART_POINTS;
  if (!data || data.length <= maxPts) return data;
  var len = data.length;
  var sampled = [data[0]];
  var bucketSize = (len - 2) / (maxPts - 2);
  var a = 0;
  for (var i = 0; i < maxPts - 2; i++) {
    var bStart = Math.floor((i + 1) * bucketSize) + 1;
    var bEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);
    // Average of next bucket for reference
    var avgX = 0, avgY = 0, bNextStart = bEnd, bNextEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, len - 1);
    if (i < maxPts - 3) {
      for (var n = bNextStart; n < bNextEnd; n++) { avgX += (data[n].x instanceof Date ? data[n].x.getTime() : data[n].x); avgY += data[n].y; }
      avgX /= (bNextEnd - bNextStart) || 1; avgY /= (bNextEnd - bNextStart) || 1;
    } else { avgX = (data[len-1].x instanceof Date ? data[len-1].x.getTime() : data[len-1].x); avgY = data[len-1].y; }
    // Pick point with largest triangle area
    var maxArea = -1, maxIdx = bStart;
    var ax = data[a].x instanceof Date ? data[a].x.getTime() : data[a].x, ay = data[a].y;
    for (var j = bStart; j < bEnd; j++) {
      var jx = data[j].x instanceof Date ? data[j].x.getTime() : data[j].x;
      var area = Math.abs((ax - avgX) * (data[j].y - ay) - (ax - jx) * (avgY - ay));
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }
    sampled.push(data[maxIdx]);
    a = maxIdx;
  }
  sampled.push(data[len - 1]);
  return sampled;
}

function memoizeHealthSeries(cacheKey, data, maxPts) {
  if (!Array.isArray(data) || !data.length) return [];
  if (!(window.PlotCore && typeof PlotCore.memoizeSeries === 'function' && typeof PlotCore.buildSequenceSignature === 'function')) {
    return lttbDownsample(data, maxPts);
  }
  return PlotCore.memoizeSeries(cacheKey, PlotCore.buildSequenceSignature(data), function() {
    return lttbDownsample(data, maxPts);
  });
}

function rangeLabel(range) {
  if (window.PlotCore && typeof PlotCore.rangeLabel === 'function') {
    return PlotCore.rangeLabel(range);
  }
  if (range === 'day') return 'Day';
  if (range === 'week') return 'Week';
  if (range === 'month') return 'Month';
  return 'All';
}

// ============================================================
// CHART EXPAND MODAL
// ============================================================
var _modalChart = null;
var _modalSource = null;

function cloneChartDataForModal(data) {
  return {
    labels: data && Array.isArray(data.labels) ? data.labels.slice() : undefined,
    datasets: (data && Array.isArray(data.datasets) ? data.datasets : []).map(function(ds) {
      var out = Object.assign({}, ds);
      if (Array.isArray(ds.data)) {
        out.data = ds.data.map(function(point) {
          if (point && typeof point === 'object') return Object.assign({}, point);
          return point;
        });
      }
      return out;
    })
  };
}

function pointXMs(pt) {
  if (pt === null || pt === undefined) return NaN;
  if (typeof pt === 'number') return isFinite(pt) ? pt : NaN;
  if (pt instanceof Date) return isNaN(pt.getTime()) ? NaN : pt.getTime();
  if (typeof pt === 'object') {
    var x = pt.x;
    if (x instanceof Date) return isNaN(x.getTime()) ? NaN : x.getTime();
    if (typeof x === 'number') return isFinite(x) ? x : NaN;
    if (typeof x === 'string') {
      var d = new Date(x);
      return isNaN(d.getTime()) ? NaN : d.getTime();
    }
  }
  return NaN;
}

function getObservedBoundsFromData(data) {
  var min = Infinity;
  var max = -Infinity;
  var datasets = (data && Array.isArray(data.datasets)) ? data.datasets : [];
  for (var i = 0; i < datasets.length; i++) {
    var ds = datasets[i] || {};
    if (ds._isCalculated || ds._isEvent || ds._isGuide) continue;
    var pts = Array.isArray(ds.data) ? ds.data : [];
    for (var j = 0; j < pts.length; j++) {
      var t = pointXMs(pts[j]);
      if (!isFinite(t)) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  if (!isFinite(min) || !isFinite(max)) return null;
  return { min: min, max: max };
}

function getWindowForRange(bounds, range) {
  if (window.PlotCore && typeof PlotCore.getWindowForRange === 'function') {
    return PlotCore.getWindowForRange(bounds, range);
  }
  if (!bounds || !isFinite(bounds.min) || !isFinite(bounds.max)) return { min: undefined, max: undefined };
  if (range === 'all') return { min: bounds.min, max: bounds.max };
  var spanMs = 0;
  if (range === 'day') spanMs = 24 * 3600000;
  else if (range === 'week') spanMs = 7 * 24 * 3600000;
  else if (range === 'month') spanMs = 30 * 24 * 3600000;
  if (!spanMs) return { min: bounds.min, max: bounds.max };
  var end = bounds.max;
  var start = Math.max(bounds.min, end - spanMs);
  return { min: start, max: end };
}

function getChartSnapshotForRange(stationId, chartKey, range) {
  if (!stationId || !chartKey) return null;
  var prevRange = stationRanges[stationId] || 'week';
  var changed = prevRange !== range;
  if (changed) setStationRange(stationId, range, { skipEnsure: true, skipRawEnsure: true });
  var canvas = findStationChartCanvas(stationId, chartKey);
  var chart = canvas ? Chart.getChart(canvas) : null;
  var snapshot = null;
  if (chart) {
    snapshot = {
      type: chart.config.type,
      data: cloneChartDataForModal(chart.data),
      options: chart.options
    };
  }
  if (changed) setStationRange(stationId, prevRange, { skipEnsure: true, skipRawEnsure: true });
  return snapshot;
}

// Wraps new Chart() -- stores title on canvas and attaches an expand button
function makeLiveChart(box, canvas, title, cfg, meta) {
  canvas._expandTitle = title;
  canvas._stationId = meta && meta.stationId ? meta.stationId : null;
  canvas._chartKey = meta && meta.chartKey ? meta.chartKey : null;
  var btn = document.createElement('button');
  btn.className = 'chart-expand-btn';
  btn.title = 'Expand \u2022 Scroll=zoom \u2022 Drag=pan \u2022 Dbl-click=reset';
  btn.innerHTML = '\u2922';
  btn.onclick = function(e) { e.stopPropagation(); openChartModal(canvas._expandTitle, canvas); };
  box.appendChild(btn);
  var managerKey = (meta && meta.managerKey)
    ? meta.managerKey
    : ('health:' + (meta && meta.stationId ? meta.stationId : 'global') + ':' + (meta && meta.chartKey ? meta.chartKey : (canvas.id || 'chart')));
  var inst = (window.ChartManager && typeof ChartManager.upsert === 'function')
    ? ChartManager.upsert({
        key: managerKey,
        canvas: canvas,
        config: cfg,
        meta: {
          stationId: meta && meta.stationId ? meta.stationId : null,
          chartKey: meta && meta.chartKey ? meta.chartKey : null,
          scope: 'health-live'
        },
        updateMode: 'none'
      })
    : new Chart(canvas, cfg);
  return inst;
}


function chartOpts(yLabel, yMin, yMax, range, stationId, xMinMs, xMaxMs) {
  // X-axis time configuration depends on view range:
  //   day   → hour ticks showing HH:mm
  //   week  → day ticks showing dd MMM (one per day, 7 labels)
  //   month → day ticks showing dd MMM
  //   all   → day ticks showing dd MMM
  var xTime, xMaxTicks, xAutoSkip;
  if (range === 'day') {
    xTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'hour', stepSize: 3, displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } };
    xMaxTicks = 9;
    xAutoSkip = false;
  } else if (range === 'week') {
    xTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'day', stepSize: 1, displayFormats: { day: 'dd MMM' } };
    xMaxTicks = 8;
    xAutoSkip = false;
  } else if (range === 'month') {
    xTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'day', stepSize: 1, displayFormats: { day: 'dd MMM' } };
    xMaxTicks = 10;
    xAutoSkip = true;
  } else {
    xTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'day', displayFormats: { day: 'dd MMM' } };
    xMaxTicks = 12;
    xAutoSkip = true;
  }
  var xScaleMin = isFinite(xMinMs) ? xMinMs : undefined;
  var xScaleMax = isFinite(xMaxMs) ? xMaxMs : undefined;
  function tickDate(v) {
    if (v === null || v === undefined) return null;
    var d = null;
    if (typeof v === 'number' && isFinite(v)) d = new Date(v);
    if (!d || isNaN(d.getTime())) {
      var n = Number(v);
      if (isFinite(n)) d = new Date(n);
    }
    if (!d || isNaN(d.getTime())) d = new Date(v);
    return (d && !isNaN(d.getTime())) ? d : null;
  }
  // UTC timezone for Luxon adapter
  var adapters = { date: { zone: 'UTC' } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: { display: true, position: 'top', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12, padding: 8, filter: defaultLegendDatasetFilter } },
      tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1 },
    },
    scales: {
      x: { type: 'time', time: xTime, adapters: adapters,
        min: xScaleMin,
        max: xScaleMax,
        ticks: {
          color: '#64748b',
          font: { size: 10 },
          maxTicksLimit: xMaxTicks,
          autoSkip: xAutoSkip,
          major: { enabled: range === 'week' || range === 'month' },
          callback: function(value, index, ticks) {
            if (range === 'week') {
              var dayTick = tickDate(value);
              return dayTick ? dayTick.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : this.getLabelForValue(value);
            }
            if (range === 'month') {
              var monthTick = tickDate(value);
              return monthTick ? monthTick.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : this.getLabelForValue(value);
            }
            return this.getLabelForValue(value);
          }
        },
        grid: {
          color: function(ctx) {
            if (range === 'week') return 'rgba(148, 163, 184, 0.42)';
            if (range !== 'month' || !ctx.tick) return '#d6e3df';
            var d = tickDate(ctx.tick.value);
            if (!d) return '#d6e3df';
            return (d.getUTCDate() === 1 || (d.getUTCDate() % 5) === 0) ? 'rgba(148, 163, 184, 0.42)' : '#d6e3df';
          },
          lineWidth: function(ctx) {
            if (range === 'week') return 1.1;
            if (range !== 'month' || !ctx.tick) return 1;
            var d = tickDate(ctx.tick.value);
            if (!d) return 1;
            return (d.getUTCDate() === 1 || (d.getUTCDate() % 5) === 0) ? 1.1 : 1;
          }
        } },
      y: { title: { display: true, text: yLabel, color: '#64748b', font: { size: 10 } },
        min: yMin, max: yMax,
        ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#d6e3df' } },
    },
  };
}

// timeAgo → provided by seaweed_common.js  (call with suffix=false, the default)

// ============================================================
// PARSE SUPABASE DATA (direct column access — v2 sensor_readings VIEW)
// ============================================================
// v2: sensor_readings is a VIEW over samples_raw.
// Columns removed from view (now in sync_sessions / upload_sessions):
//   rssi, free_heap, csq, sd_free_kb, t0_sync_drift_s, espnow_sync_period_s,
//   sat_a/b_rssi, sat_a/b_sync_drift, sat_a/b_fw_ver, sat_a/b_sample_id
// New columns: sat_a/b_flash_pct
// Diagnostic data is fetched separately from upload_sessions + sync_sessions.
