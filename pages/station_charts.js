// station_charts.js — Extracted from station.html (Sprint 6)
// Chart colors, datasets, plugins, create/update, sensor modal
"use strict";

var COLORS = {
  t0s1: '#3b82f6', t0s2: '#93c5fd', t0s3: '#60a5fa',
  slot1s1: '#10b981', slot1s2: '#6ee7b7',
  slot2s1: '#f59e0b', slot2s2: '#fcd34d',
  slot3s1: '#a855f7', slot3s2: '#c084fc',
  slot4s1: '#ef4444', slot4s2: '#fca5a5',
  slot5s1: '#f97316', slot5s2: '#fdba74',
  t0Bat: '#3b82f6', slot1Bat: '#10b981', slot2Bat: '#f59e0b',
  t0V: '#60a5fa', slot1V: '#34d399', slot2V: '#fbbf24',
};

function resolveSensorColors() {
  var c = {
    t0s1: COLORS.t0s1,
    t0s2: COLORS.t0s2,
    t0s3: COLORS.t0s3,
    slot1s1: COLORS.slot1s1,
    slot1s2: COLORS.slot1s2,
    slot2s1: COLORS.slot2s1,
    slot2s2: COLORS.slot2s2,
    slot3s1: COLORS.slot3s1,
    slot3s2: COLORS.slot3s2,
    slot4s1: COLORS.slot4s1,
    slot4s2: COLORS.slot4s2,
    slot5s1: COLORS.slot5s1,
    slot5s2: COLORS.slot5s2,
  };
  var mapKey = STATION ? STATION.sensorMap : null;
  var legend = (mapKey && SENSOR_MAPS[mapKey]) ? SENSOR_MAPS[mapKey].legend : null;
  if (!legend || !legend.length) return c;

  // Legend index maps to Sensor 1..N on cards/charts.
  var colorKeys = ['t0s1', 't0s2', 't0s3', 'slot1s1', 'slot1s2', 'slot2s1', 'slot2s2', 'slot3s1', 'slot3s2', 'slot4s1', 'slot4s2', 'slot5s1'];
  for (var i = 0; i < legend.length && i < colorKeys.length; i++) {
    if (legend[i] && legend[i].color) c[colorKeys[i]] = legend[i].color;
  }
  return c;
}

var SENSOR_TRENDLINE_GAP_MS = 12 * 60 * 60 * 1000;

function shouldBreakTrendSegment(ctx, gapMs) {
  var p0x = ctx && ctx.p0 && ctx.p0.parsed ? ctx.p0.parsed.x : null;
  var p1x = ctx && ctx.p1 && ctx.p1.parsed ? ctx.p1.parsed.x : null;
  return isFinite(p0x) && isFinite(p1x) && (p1x - p0x) > gapMs;
}

function filterSeriesToWindow(points, windowLike) {
  if (!Array.isArray(points) || !points.length || !windowLike) return Array.isArray(points) ? points.slice() : [];
  return points.filter(function(pt) {
    var x = pt && pt.x instanceof Date ? pt.x.getTime() : (pt ? new Date(pt.x).getTime() : NaN);
    return isFinite(x) && (!isFinite(windowLike.min) || x >= windowLike.min) && (!isFinite(windowLike.max) || x <= windowLike.max);
  });
}

function buildStationSeriesCacheKey(chartKey, seriesKey, range) {
  return ['station', TABLE_ID, chartKey, seriesKey, range || state.timeRange || 'all'].join(':');
}

function downsamplePlotSeries(points, kind, range, overrideMaxPts) {
  if (!Array.isArray(points) || !points.length) return [];
  if (!window.PlotCore || typeof PlotCore.lttbDownsample !== 'function') return points.slice();
  var maxPts = PlotCore.resolveMaxPoints(kind, range, points.length, overrideMaxPts);
  return PlotCore.lttbDownsample(points, maxPts);
}

function memoizedDownsampleSeries(cacheKey, points, kind, range, overrideMaxPts) {
  if (!Array.isArray(points) || !points.length) return [];
  if (!window.PlotCore || typeof PlotCore.memoizeSeries !== 'function') {
    return downsamplePlotSeries(points, kind, range, overrideMaxPts);
  }
  return PlotCore.memoizeSeries(cacheKey, PlotCore.buildSequenceSignature(points), function() {
    return downsamplePlotSeries(points, kind, range, overrideMaxPts);
  });
}

function pointTimeMs(point) {
  if (!point) return NaN;
  var x = point.x instanceof Date ? point.x.getTime() : new Date(point.x).getTime();
  return isFinite(x) ? x : NaN;
}

function medianNumber(values) {
  var nums = values.filter(function(v) { return isFinite(v); }).sort(function(a, b) { return a - b; });
  if (!nums.length) return NaN;
  var mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function groupMedian(group) {
  return medianNumber(group.values);
}

function collapseDuplicateSensorPoints(points) {
  if (!Array.isArray(points) || points.length <= 1) return Array.isArray(points) ? points.slice() : [];
  var groups = [];
  points.forEach(function(point) {
    var ms = pointTimeMs(point);
    var y = Number(point && point.y);
    if (!isFinite(ms) || !isFinite(y)) return;
    var last = groups.length ? groups[groups.length - 1] : null;
    if (!last || last.ms !== ms) {
      last = { ms: ms, values: [] };
      groups.push(last);
    }
    last.values.push(y);
  });

  return groups.map(function(group, index) {
    var y = groupMedian(group);
    if (group.values.length > 1) {
      var prev = index > 0 ? groupMedian(groups[index - 1]) : NaN;
      var next = index < groups.length - 1 ? groupMedian(groups[index + 1]) : NaN;
      var reference = isFinite(prev) && isFinite(next) ? (prev + next) / 2 : (isFinite(prev) ? prev : next);
      if (isFinite(reference)) {
        y = group.values.reduce(function(best, value) {
          return Math.abs(value - reference) < Math.abs(best - reference) ? value : best;
        }, group.values[0]);
      }
    }
    return { x: new Date(group.ms), y: y };
  });
}

function suppressIsolatedSensorJumps(points, key) {
  if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
  var isHumidity = /hum/i.test(String(key || ''));
  var threshold = isHumidity ? 10 : 3.0;
  var neighborTolerance = isHumidity ? 5 : 2.0;
  var maxNeighborGapMs = 90 * 60 * 1000;
  var cleaned = [points[0]];
  for (var i = 1; i < points.length - 1; i++) {
    var prev = points[i - 1];
    var cur = points[i];
    var next = points[i + 1];
    var prevMs = pointTimeMs(prev);
    var curMs = pointTimeMs(cur);
    var nextMs = pointTimeMs(next);
    var closeNeighbors = isFinite(prevMs) && isFinite(curMs) && isFinite(nextMs) &&
      (curMs - prevMs) <= maxNeighborGapMs && (nextMs - curMs) <= maxNeighborGapMs;
    var isolated = closeNeighbors &&
      Math.abs(cur.y - prev.y) >= threshold &&
      Math.abs(cur.y - next.y) >= threshold &&
      Math.abs(prev.y - next.y) <= neighborTolerance;
    if (!isolated) cleaned.push(cur);
  }
  cleaned.push(points[points.length - 1]);
  return cleaned;
}

function cleanSensorPlotSeries(points, key) {
  return suppressIsolatedSensorJumps(collapseDuplicateSensorPoints(points), key);
}

function isZeroSensorPlotOutlier(key, value) {
  return /temp|hum/i.test(String(key || '')) && Math.abs(Number(value)) <= 0.000001;
}

function chartLocalDayStartMs(ms) {
  var offsetMs = getStationOffsetMinutesForCharts() * 60000;
  return Math.floor((ms + offsetMs) / 86400000) * 86400000 - offsetMs;
}

function chartLocalIntervalCeilMs(ms, intervalMs) {
  var offsetMs = getStationOffsetMinutesForCharts() * 60000;
  return Math.ceil((ms + offsetMs) / intervalMs) * intervalMs - offsetMs;
}

function getSensorDisplayWindow(bounds, range) {
  if (!bounds || !isFinite(bounds.min) || !isFinite(bounds.max)) return { min: undefined, max: undefined };
  if (range === 'all') return { min: bounds.min, max: bounds.max };
  var days = range === 'day' ? 1 : (range === 'week' ? 7 : 30);
  var max = bounds.max;
  var min = max - days * 86400000;
  if (range === 'week' || range === 'month') min = chartLocalDayStartMs(min);
  return { min: min, max: max };
}

function buildSensorAxisTicks(min, max, range) {
  if (!isFinite(min) || !isFinite(max) || max <= min || range === 'all') return null;
  var ticks = [];
  var hourMs = 3600000;
  var dayMs = 86400000;
  var stepMs = range === 'day' ? 2 * hourMs : (range === 'week' ? 12 * hourMs : dayMs);
  var start = range === 'day'
    ? chartLocalIntervalCeilMs(min, stepMs)
    : chartLocalDayStartMs(min);

  if (range === 'day') ticks.push({ value: min });
  if (start < min) start += stepMs;

  var guard = 0;
  for (var t = start; t <= max && guard < 100; t += stepMs, guard++) {
    if (range === 'day' && Math.abs(t - min) < 60000) continue;
    ticks.push({ value: t });
  }
  return ticks.length ? ticks : null;
}

function getDatasetTimeBounds(datasets) {
  var min = Infinity;
  var max = -Infinity;
  var count = 0;
  (Array.isArray(datasets) ? datasets : []).forEach(function(ds) {
    if (!ds || /^Open-Meteo/i.test(String(ds.label || ''))) return;
    var points = Array.isArray(ds._rawData) && ds._rawData.length ? ds._rawData : ds.data;
    (Array.isArray(points) ? points : []).forEach(function(point) {
      var ms = pointTimeMs(point);
      if (!isFinite(ms)) return;
      min = Math.min(min, ms);
      max = Math.max(max, ms);
      count++;
    });
  });
  if (!count || !isFinite(min) || !isFinite(max)) return null;
  return { min: min, max: max, count: count };
}

function formatSensorChartSubhead(chartKey) {
  var chart = state && state.charts ? state.charts[chartKey] : null;
  var datasets = chart && chart.data ? chart.data.datasets : null;
  var bounds = getDatasetTimeBounds(datasets);
  if (!bounds) return null;
  var rangeText = { day: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days', all: 'All plotted T/H' };
  var first = new Date(bounds.min);
  var last = new Date(bounds.max);
  var prefix = rangeText[state.timeRange] || 'All plotted T/H';
  if (window.SeaweedV4 && typeof SeaweedV4.formatWithUtcOffset === 'function') {
    return prefix + ' | ' +
      SeaweedV4.formatWithUtcOffset(first, window.__STATION && window.__STATION.displayTime, { time: false, label: false }) + ' - ' +
      SeaweedV4.formatWithUtcOffset(last, window.__STATION && window.__STATION.displayTime, { year: true, time: false }) +
      ' (' + bounds.count.toLocaleString() + ' T/H points)';
  }
  return prefix + ' | ' +
    first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' - ' +
    last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' (' + bounds.count.toLocaleString() + ' T/H points)';
}

function getStationOffsetMinutesForCharts() {
  if (window.SeaweedV4 && typeof SeaweedV4.parseUtcOffsetMinutes === 'function') {
    return SeaweedV4.parseUtcOffsetMinutes(window.__STATION && window.__STATION.displayTime);
  }
  return 0;
}

var CHART_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shiftedChartDate(ms) {
  var n = Number(ms);
  if (!isFinite(n)) n = new Date(ms).getTime();
  return isFinite(n) ? new Date(n + getStationOffsetMinutesForCharts() * 60000) : null;
}

function formatAxisDate(ms) {
  var d = shiftedChartDate(ms);
  if (!d || isNaN(d.getTime())) return '';
  return String(d.getUTCDate()).padStart(2, '0') + ' ' + CHART_MONTHS[d.getUTCMonth()];
}

function formatAxisTime(ms) {
  var d = shiftedChartDate(ms);
  if (!d || isNaN(d.getTime())) return '';
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

function axisLocalHour(ms) {
  var d = shiftedChartDate(ms);
  return d && !isNaN(d.getTime()) ? d.getUTCHours() : NaN;
}

function axisLocalDay(ms) {
  var d = shiftedChartDate(ms);
  return d && !isNaN(d.getTime()) ? d.getUTCDate() : NaN;
}

function sensorAxisLabel(value, index, range) {
  var ms = Number(value);
  if (!isFinite(ms)) ms = new Date(value).getTime();
  if (!isFinite(ms)) return '';
  if (range === 'day') return index === 0 ? formatAxisDate(ms) : formatAxisTime(ms);
  if (range === 'week') {
    var hour = axisLocalHour(ms);
    if (hour === 0) return formatAxisDate(ms);
    if (hour === 12) return '12:00';
    return '';
  }
  if (range === 'month') {
    var day = axisLocalDay(ms);
    if (index === 0 || day === 1 || day % 5 === 0) return formatAxisDate(ms);
    return '';
  }
  return formatAxisDate(ms);
}

function sensorAxisGridColor(ctx, range) {
  if (!ctx || !ctx.tick) return '#d6e3df';
  var ms = Number(ctx.tick.value);
  if (!isFinite(ms)) return '#d6e3df';
  if (range === 'day') return axisLocalHour(ms) === 0 ? 'rgba(148, 163, 184, 0.48)' : '#d6e3df';
  if (range === 'week') return axisLocalHour(ms) === 0 ? 'rgba(100, 116, 139, 0.55)' : 'rgba(214, 227, 223, 0.72)';
  if (range === 'month') {
    var day = axisLocalDay(ms);
    return (day === 1 || day % 5 === 0) ? 'rgba(100, 116, 139, 0.50)' : 'rgba(214, 227, 223, 0.68)';
  }
  return '#d6e3df';
}

function sensorAxisGridWidth(ctx, range) {
  if (!ctx || !ctx.tick) return 0.7;
  var ms = Number(ctx.tick.value);
  if (!isFinite(ms)) return 0.7;
  if ((range === 'day' || range === 'week') && axisLocalHour(ms) === 0) return 1.2;
  if (range === 'month') {
    var day = axisLocalDay(ms);
    return (day === 1 || day % 5 === 0) ? 1.1 : 0.7;
  }
  return 0.7;
}

function sensorAxisTickLimit(range) {
  if (range === 'day') return 14;
  if (range === 'week') return 18;
  if (range === 'month') return 32;
  return 12;
}

function sensorTimeAxisConfig(range) {
  if (range === 'day') {
    return { unit: 'hour', stepSize: 2, displayFormats: { hour: 'HH:mm', minute: 'HH:mm' }, tooltipFormat: 'd LLL HH:mm' };
  }
  if (range === 'week') {
    return { unit: 'hour', stepSize: 12, displayFormats: { hour: 'HH:mm', day: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
  }
  if (range === 'month') {
    return { unit: 'day', stepSize: 1, displayFormats: { day: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
  }
  return { unit: 'week', displayFormats: { week: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
}

function displayChartTime(ms, opts) {
  if (window.SeaweedV4 && typeof SeaweedV4.formatWithUtcOffset === 'function') {
    return SeaweedV4.formatWithUtcOffset(new Date(ms), window.__STATION && window.__STATION.displayTime, opts || {});
  }
  var d = new Date(ms);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function buildSensorChartOverlays() {
  return [
    {
      id: 'harvest-bands',
      options: {
        enabled: function() { return !!(window._sensorOpts || {}).harvest; },
        getWindows: function() { return window._tideWindows || []; },
        fillColor: 'rgba(34, 197, 94, 0.10)'
      }
    },
    {
      id: 'sun-events',
      options: {
        enabled: function() { return !!(window._sensorOpts || {}).night; },
        getEvents: function(chart) {
          var xScale = chart && chart.scales ? chart.scales.x : null;
          return xScale ? getSensorSunEventsForWindow({ min: xScale.min, max: xScale.max }) : [];
        }
      }
    },
    { id: 'daily-extrema-labels' }
  ];
}

function makeDataset(entries, key, label, color, dashed, rangeOverride) {
  var plotRange = rangeOverride || state.timeRange;
  var rawData = [];
  entries.forEach(function (e) {
    var value = e ? Number(e[key]) : NaN;
    if (isFinite(value) && !isZeroSensorPlotOutlier(key, value)) {
      rawData.push({ x: e.timestamp, y: value });
    }
  });
  var cleanData = cleanSensorPlotSeries(rawData, key);
  var data = memoizedDownsampleSeries(buildStationSeriesCacheKey('sensor', key, plotRange), cleanData, 'station-sensor', plotRange);
  return {
    label: label + (rawData.length === 0 ? ' (No Data)' : ' (' + rawData.length + ')'),
    data: data, borderColor: color, backgroundColor: color + '22',
    borderWidth: data.length > 0 ? 1.5 : 0, borderDash: dashed ? [5, 3] : [],
    pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color,
    tension: 0.3, fill: false, hidden: data.length === 0, spanGaps: false,
    _rawData: cleanData,
    _rawPointCount: rawData.length,
    segment: {
      borderColor: function(ctx) {
        return shouldBreakTrendSegment(ctx, SENSOR_TRENDLINE_GAP_MS) ? 'rgba(0, 0, 0, 0)' : color;
      }
    },
  };
}

// =====================================================================
// CHART PLUGINS
// =====================================================================
window._sensorOpts = { night: true, harvest: true, wx: false };

function getSensorSunEventsForWindow(windowLike) {
  if (!windowLike || !isFinite(windowLike.min) || !isFinite(windowLike.max)) return [];
  if (typeof buildSunEventsForRange !== 'function') return [];
  var daily = weatherState ? weatherState.daily : null;
  return buildSunEventsForRange(daily, windowLike.min, windowLike.max);
}

function setSensorChartSunEvents(chart, windowLike) {
  if (!chart) return;
  chart.$sensorSunEvents = getSensorSunEventsForWindow(windowLike);
}

var sensorBandsPlugin = {
  id: 'sensorBands',
  beforeDraw: function (chart) {
    var opts = window._sensorOpts || { night: true, harvest: true, wx: false };
    var xA = chart.scales.x, yA = chart.scales.y;
    if (!xA || !yA) return;
    var ctx = chart.ctx;
    var top = yA.top, bot = yA.bottom, left = xA.left, right = xA.right;
    var minX = xA.min, maxX = xA.max;
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bot - top); ctx.clip();

    if (opts.harvest) {
      var wins = window._tideWindows || [];
      ctx.fillStyle = 'rgba(34, 197, 94, 0.10)';
      for (var w = 0; w < wins.length; w++) {
        var wx1 = xA.getPixelForValue(wins[w].start.getTime());
        var wx2 = xA.getPixelForValue(wins[w].end.getTime());
        if (wx2 < left || wx1 > right) continue;
        ctx.fillRect(Math.max(wx1, left), top, Math.min(wx2, right) - Math.max(wx1, left), bot - top);
      }
    }

    if (opts.night) {
      var sunEvents = Array.isArray(chart.$sensorSunEvents) ? chart.$sensorSunEvents : [];
      if (sunEvents.length) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        if (sunEvents[0].rise > minX) {
          var x1 = Math.max(left, xA.getPixelForValue(minX));
          var x2 = Math.min(right, xA.getPixelForValue(sunEvents[0].rise));
          if (x2 > x1) ctx.fillRect(x1, top, x2 - x1, bot - top);
        }
        for (var i = 0; i < sunEvents.length; i++) {
          var sx = Math.max(left, xA.getPixelForValue(sunEvents[i].set));
          var nextRise = (i + 1 < sunEvents.length) ? sunEvents[i + 1].rise : maxX + 86400000;
          var rx = Math.min(right, xA.getPixelForValue(Math.min(nextRise, maxX)));
          if (rx > sx) ctx.fillRect(sx, top, rx - sx, bot - top);
        }
        for (var j = 0; j < sunEvents.length; j++) {
          var rPx = xA.getPixelForValue(sunEvents[j].rise);
          if (rPx >= left && rPx <= right) {
            ctx.strokeStyle = 'rgba(251,191,36,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
            ctx.beginPath(); ctx.moveTo(rPx, top); ctx.lineTo(rPx, bot); ctx.stroke();
          }
          var sPx = xA.getPixelForValue(sunEvents[j].set);
          if (sPx >= left && sPx <= right) {
            ctx.strokeStyle = 'rgba(251,146,60,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
            ctx.beginPath(); ctx.moveTo(sPx, top); ctx.lineTo(sPx, bot); ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }
};

var dailyMinMaxPlugin = {
  id: 'dailyMinMax',
  afterDatasetsDraw: function(chart) {
    var xScale = chart.scales.x, yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    var ctx = chart.ctx;
    var dayMax = {}, dayMin = {};

    chart.data.datasets.forEach(function(ds, dsIdx) {
      var meta = chart.getDatasetMeta(dsIdx);
      if (meta.hidden) return;
      var color = (typeof ds.borderColor === 'string') ? ds.borderColor : '#94a3b8';
      if (/^#[0-9a-fA-F]{8}$/.test(color)) color = color.slice(0, 7);
      var plotData = Array.isArray(ds._rawData) && ds._rawData.length ? ds._rawData : ds.data;
      plotData.forEach(function(pt) {
        if (!pt || pt.y === null || pt.y === undefined) return;
        var d = new Date(pt.x);
        var key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
        if (!dayMax[key] || pt.y > dayMax[key].val) dayMax[key] = { val: pt.y, x: pt.x, color: color };
        if (!dayMin[key] || pt.y < dayMin[key].val) dayMin[key] = { val: pt.y, x: pt.x, color: color };
      });
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(xScale.left, yScale.top, xScale.right - xScale.left, yScale.bottom - yScale.top);
    ctx.clip();
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    function drawDayLabel(val, x, y, color, above) {
      var lbl = val.toFixed(1);
      var oy = above ? -10 : 10;
      ctx.fillStyle = 'rgba(15,23,42,0.65)';
      ctx.fillText(lbl, x + 1, y + oy + 1);
      ctx.fillStyle = color;
      ctx.fillText(lbl, x, y + oy);
    }

    Object.keys(dayMax).forEach(function(key) {
      var m = dayMax[key];
      var px = xScale.getPixelForValue(m.x);
      if (px < xScale.left || px > xScale.right) return;
      drawDayLabel(m.val, px, yScale.getPixelForValue(m.val), m.color, true);
    });
    Object.keys(dayMin).forEach(function(key) {
      var m = dayMin[key];
      var px = xScale.getPixelForValue(m.x);
      if (px < xScale.left || px > xScale.right) return;
      drawDayLabel(m.val, px, yScale.getPixelForValue(m.val), m.color, false);
    });
    ctx.restore();
  }
};

var nowLinePlugin = {
  id: 'nowLine',
  beforeDraw: function(chart) {
    var xScale = chart.scales.x, yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    var nowPx = xScale.getPixelForValue(Date.now());
    if (nowPx < xScale.left || nowPx > xScale.right) return;
    var ctx = chart.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(xScale.left, yScale.top, xScale.right - xScale.left, yScale.bottom - yScale.top); ctx.clip();
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(nowPx, yScale.top); ctx.lineTo(nowPx, yScale.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(248,113,113,0.9)'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('NOW', nowPx + 3, yScale.top + 10);
    ctx.restore();
  }
};

var nightShadingPlugin = {
  id: 'nightShading',
  beforeDraw: function(chart) {
    var se = weatherState.sunEvents;
    if (!se || !se.length) return;
    var xScale = chart.scales.x, yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    var ctx = chart.ctx;
    var top = yScale.top, bot = yScale.bottom, left = xScale.left, right = xScale.right;
    var minX = xScale.min, maxX = xScale.max;
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bot - top); ctx.clip();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    if (se[0].rise > minX) {
      var x1b = Math.max(left, xScale.getPixelForValue(minX));
      var x2b = Math.min(right, xScale.getPixelForValue(se[0].rise));
      if (x2b > x1b) ctx.fillRect(x1b, top, x2b - x1b, bot - top);
    }
    for (var i = 0; i < se.length; i++) {
      var setX = xScale.getPixelForValue(se[i].set);
      var nextRise = (i + 1 < se.length) ? se[i + 1].rise : maxX + 86400000;
      var riseX = xScale.getPixelForValue(Math.min(nextRise, maxX));
      var sxb = Math.max(left, setX), rxb = Math.min(right, riseX);
      if (rxb > sxb) ctx.fillRect(sxb, top, rxb - sxb, bot - top);
    }
    for (var j = 0; j < se.length; j++) {
      var rPx2 = xScale.getPixelForValue(se[j].rise);
      if (rPx2 >= left && rPx2 <= right) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(rPx2, top); ctx.lineTo(rPx2, bot); ctx.stroke();
      }
      var sPx2 = xScale.getPixelForValue(se[j].set);
      if (sPx2 >= left && sPx2 <= right) {
        ctx.strokeStyle = 'rgba(251, 146, 60, 0.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(sPx2, top); ctx.lineTo(sPx2, bot); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
};

var dayLabelPlugin = {
  id: 'dayLabel',
  afterDraw: function(chart) {
    var xScale = chart.scales.x, yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    var minX = xScale.min, maxX = xScale.max;
    if (maxX - minX < 2 * 86400000) return;
    var ctx = chart.ctx;
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var se = weatherState.sunEvents;
    ctx.save();
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (se && se.length) {
      for (var ib = 0; ib < se.length; ib++) {
        var rise = se[ib].rise, set = se[ib].set;
        if (set < minX || rise > maxX) continue;
        var midMs = (rise + set) / 2;
        var px = xScale.getPixelForValue(midMs);
        if (px < xScale.left || px > xScale.right) continue;
        ctx.fillText(DAYS[new Date(rise).getDay()], px, yScale.bottom + 3);
      }
    } else {
      var day = new Date(minX);
      day.setHours(24, 0, 0, 0);
      while (day.getTime() < maxX) {
        var midMs2 = day.getTime();
        var nextDay = new Date(midMs2); nextDay.setDate(nextDay.getDate() + 1);
        var px1 = Math.max(xScale.left, xScale.getPixelForValue(midMs2));
        var px2 = Math.min(xScale.right, xScale.getPixelForValue(nextDay.getTime()));
        ctx.fillText(DAYS[day.getDay()], (px1 + px2) / 2, yScale.bottom + 3);
        day = nextDay;
      }
    }
    ctx.restore();
  }
};

function onSensorOptsChange() {
  var n = document.getElementById('ovNight');
  var h = document.getElementById('ovHarvest');
  var w = document.getElementById('ovWx');
  window._sensorOpts = { night: n ? n.checked : true, harvest: h ? h.checked : true, wx: w ? w.checked : false };
  createOrUpdateCharts();
  syncSensorModalOverlayChecks();
  if (_sensorModalChart && _sensorModalSourceKey) {
    renderSensorModalChart();
    updateSensorModalRangeButtons();
  }
}

function getSensorOptsState() {
  var s = window._sensorOpts || {};
  return {
    night: s.night !== false,
    harvest: s.harvest !== false,
    wx: s.wx === true
  };
}

function syncSensorModalOverlayChecks() {
  var s = getSensorOptsState();
  var n = document.getElementById('scmOvNight');
  var h = document.getElementById('scmOvHarvest');
  var w = document.getElementById('scmOvWx');
  if (n) n.checked = !!s.night;
  if (h) h.checked = !!s.harvest;
  if (w) w.checked = !!s.wx;
}

function onSensorModalOptsChange() {
  var n = document.getElementById('scmOvNight');
  var h = document.getElementById('scmOvHarvest');
  var w = document.getElementById('scmOvWx');
  window._sensorOpts = {
    night: n ? n.checked : true,
    harvest: h ? h.checked : true,
    wx: w ? w.checked : false
  };

  var ovNight = document.getElementById('ovNight');
  var ovHarvest = document.getElementById('ovHarvest');
  var ovWx = document.getElementById('ovWx');
  if (ovNight) ovNight.checked = window._sensorOpts.night;
  if (ovHarvest) ovHarvest.checked = window._sensorOpts.harvest;
  if (ovWx) ovWx.checked = window._sensorOpts.wx;

  createOrUpdateCharts();
  if (_sensorModalSourceKey) {
    renderSensorModalChart();
    updateSensorModalRangeButtons();
  }
}

function baseChartOptions(yLabel, yMin, yMax) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'line', padding: 14, font: { size: 11 } } },
      tooltip: {
        mode: 'index', intersect: false,
        backgroundColor: '#1e293bee', titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
        borderColor: '#334155', borderWidth: 1, padding: 10,
        titleFont: { size: 12 }, bodyFont: { size: 11 },
        callbacks: {
          title: function (items) {
            if (!items.length) return '';
            return displayChartTime(items[0].parsed.x, { weekday: true, year: true });
          },
          label: function (ctx) { var v = ctx.parsed.y; return ' ' + ctx.dataset.label.split(' (')[0] + ': ' + (v !== null ? v.toFixed(2) : 'NC'); },
        },
      }
    },
    scales: {
      x: {
        type: 'time',
        adapters: { date: { zone: 'UTC' } },
        grid: {
          color: function(ctx) { return sensorAxisGridColor(ctx, state.timeRange); },
          lineWidth: function(ctx) { return sensorAxisGridWidth(ctx, state.timeRange); }
        },
        ticks: {
          color: '#64748b',
          maxTicksLimit: sensorAxisTickLimit(state.timeRange),
          autoSkip: state.timeRange === 'all',
          font: { size: 10 },
          callback: function(value, index) { return sensorAxisLabel(value, index, state.timeRange); }
        },
        afterBuildTicks: function(axis) {
          var ticks = buildSensorAxisTicks(axis.min, axis.max, state.timeRange);
          if (ticks) axis.ticks = ticks;
        },
        time: sensorTimeAxisConfig(state.timeRange)
      },
      y: { title: { display: true, text: yLabel, color: '#94a3b8', font: { size: 11 } }, grid: { color: '#d6e3df', lineWidth: 0.7 }, ticks: { color: '#64748b', font: { size: 10 } }, min: yMin, max: yMax },
    },
  };
}

function replaceStationSensorChart(chartKey, canvasId, config) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  var managerKey = 'station:' + TABLE_ID + ':sensor:' + chartKey;
  if (window.ChartManager && typeof ChartManager.destroy === 'function') {
    ChartManager.destroy(managerKey);
  }
  var existing = window.Chart && Chart.getChart ? Chart.getChart(canvas) : null;
  if (existing) {
    try { existing.destroy(); } catch (_) {}
  }
  var chart = new Chart(canvas, Object.assign({}, config, {
    plugins: [sensorBandsPlugin, dailyMinMaxPlugin]
  }));
  chart.$chartKey = managerKey;
  chart.$stationId = TABLE_ID;
  chart.$chartType = chartKey;
  canvas._stationId = TABLE_ID;
  canvas._chartKey = chartKey;
  return chart;
}

function createOrUpdateCharts() {
  var chartEntries = state.filteredEntries;
  if (!chartEntries || !chartEntries.length) chartEntries = state.allEntries;
  if (!chartEntries || !chartEntries.length) return;
  var allBounds = getEntriesBounds(state.allEntries);
  var chartBounds = getEntriesBounds(chartEntries) || allBounds;
  var chartWindow = getSensorDisplayWindow(allBounds || chartBounds, state.timeRange);
  var sensorColors = resolveSensorColors();
  var sensorDefs = buildStationSensorDefinitions(TABLE_ID, state.allEntries, _stationSlotMap, sensorColors);
  var _wxMin = chartWindow && isFinite(chartWindow.min) ? chartWindow.min : (chartBounds ? chartBounds.min : -Infinity);
  var _wxMax = chartWindow && isFinite(chartWindow.max) ? chartWindow.max : (chartBounds ? chartBounds.max : Infinity);
  var _wxOverlayTemp = [], _wxOverlayHum = [];
  if ((window._sensorOpts || {}).wx && weatherState.data && weatherState.data.time) {
    var _wd = weatherState.data;
    for (var _wi = 0; _wi < _wd.time.length; _wi++) {
      var _wt = new Date(_wd.time[_wi]).getTime();
      if (_wt < _wxMin || _wt > _wxMax) continue;
      if (_wd.temperature_2m[_wi] !== null) _wxOverlayTemp.push({ x: _wt, y: _wd.temperature_2m[_wi] });
      if (_wd.relative_humidity_2m[_wi] !== null) _wxOverlayHum.push({ x: _wt, y: _wd.relative_humidity_2m[_wi] });
    }
  }
  var _wxOverlayTempRaw = _wxOverlayTemp.slice();
  var _wxOverlayHumRaw = _wxOverlayHum.slice();
  _wxOverlayTemp = downsamplePlotSeries(_wxOverlayTemp, 'station-weather-line', state.timeRange);
  _wxOverlayHum = downsamplePlotSeries(_wxOverlayHum, 'station-weather-line', state.timeRange);

  // -- Temperature --
  var tempDS = sensorDefs.map(function(sensorDef, index) {
    return makeDataset(chartEntries, sensorDef.tempKey, sensorDef.legendLabel, sensorDef.color, (index % 2) === 1);
  });
  var hasTempData = tempDS.some(function (ds) { return ds.data.length > 0; });
  document.getElementById('tempEmpty').style.display = hasTempData ? 'none' : 'flex';
  if ((window._sensorOpts || {}).wx && _wxOverlayTemp.length) {
    tempDS.push({ label: 'Open-Meteo Temp', data: _wxOverlayTemp,
      borderColor: '#f59e0b99', backgroundColor: 'transparent', borderWidth: 1.5,
      borderDash: [6, 4], pointRadius: 0, tension: 0.3, fill: false, _rawData: _wxOverlayTempRaw });
  }
  var tempPlotBounds = state.timeRange === 'all' ? getDatasetTimeBounds(tempDS) : null;
  var tempWindow = tempPlotBounds ? { min: tempPlotBounds.min, max: tempPlotBounds.max } : chartWindow;

  var _tOpts = baseChartOptions('Temperature (\u00B0C)');
  _tOpts.plugins.legend.position = 'left';
  _tOpts.scales.x.min = tempWindow.min;
  _tOpts.scales.x.max = tempWindow.max;
  state.charts.temp = replaceStationSensorChart('temp', 'tempChart', {
    type: 'line', data: { datasets: tempDS }, options: _tOpts
  });

  // -- Humidity --
  var humDS = sensorDefs.map(function(sensorDef, index) {
    return makeDataset(chartEntries, sensorDef.humKey, sensorDef.legendLabel, sensorDef.color, (index % 2) === 1);
  });
  var hasHumData = humDS.some(function (ds) { return ds.data.length > 0; });
  document.getElementById('humEmpty').style.display = hasHumData ? 'none' : 'flex';
  if ((window._sensorOpts || {}).wx && _wxOverlayHum.length) {
    humDS.push({ label: 'Open-Meteo Humidity', data: _wxOverlayHum,
      borderColor: '#06b6d499', backgroundColor: 'transparent', borderWidth: 1.5,
      borderDash: [6, 4], pointRadius: 0, tension: 0.3, fill: false, _rawData: _wxOverlayHumRaw });
  }
  var humPlotBounds = state.timeRange === 'all' ? getDatasetTimeBounds(humDS) : null;
  var humWindow = humPlotBounds ? { min: humPlotBounds.min, max: humPlotBounds.max } : chartWindow;

  var _hOpts2 = baseChartOptions('Humidity (%RH)', 0, 100);
  _hOpts2.plugins.legend.position = 'left';
  _hOpts2.scales.x.min = humWindow.min;
  _hOpts2.scales.x.max = humWindow.max;
  state.charts.hum = replaceStationSensorChart('hum', 'humChart', {
    type: 'line', data: { datasets: humDS }, options: _hOpts2
  });

  // Battery, Sync, Drift charts removed -- see station_health.html
}

function updateCharts() {
  if (!state.charts.temp) return;
  createOrUpdateCharts();
  if (_sensorModalChart && _sensorModalSourceKey) {
    renderSensorModalChart();
    updateSensorModalRangeButtons();
  }
}

var _sensorModalChart = null;
var _sensorModalSourceKey = null;
var _sensorModalRange = 'week';

function getEntriesForSensorWindow(entries, win) {
  if (!Array.isArray(entries) || !entries.length || !win || !isFinite(win.min) || !isFinite(win.max)) {
    return Array.isArray(entries) ? entries.slice() : [];
  }
  return entries.filter(function(entry) {
    if (!entry || !entry.timestamp) return false;
    var ms = entry.timestamp instanceof Date ? entry.timestamp.getTime() : new Date(entry.timestamp).getTime();
    return isFinite(ms) && ms >= win.min && ms <= win.max;
  });
}

function buildSensorModalDatasets(chartKey, range, win) {
  var sensorColors = resolveSensorColors();
  var sensorDefs = buildStationSensorDefinitions(TABLE_ID, state.allEntries, _stationSlotMap, sensorColors);
  var entries = getEntriesForSensorWindow(state.allEntries, win);
  var isHum = chartKey === 'hum';
  var datasets = sensorDefs.map(function(sensorDef, index) {
    return makeDataset(
      entries,
      isHum ? sensorDef.humKey : sensorDef.tempKey,
      sensorDef.legendLabel,
      sensorDef.color,
      (index % 2) === 1,
      range
    );
  });

  if ((window._sensorOpts || {}).wx && weatherState.data && weatherState.data.time && win && isFinite(win.min) && isFinite(win.max)) {
    var wd = weatherState.data;
    var overlay = [];
    for (var i = 0; i < wd.time.length; i++) {
      var t = new Date(wd.time[i]).getTime();
      if (!isFinite(t) || t < win.min || t > win.max) continue;
      var v = isHum ? wd.relative_humidity_2m[i] : wd.temperature_2m[i];
      if (v !== null && v !== undefined && isFinite(Number(v))) overlay.push({ x: t, y: Number(v) });
    }
    if (overlay.length) {
      datasets.push({
        label: isHum ? 'Open-Meteo Humidity' : 'Open-Meteo Temp',
        data: downsamplePlotSeries(overlay, 'station-weather-line', range),
        borderColor: isHum ? '#06b6d499' : '#f59e0b99',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        _rawData: overlay
      });
    }
  }

  return datasets;
}

function destroySensorModalChart() {
  var modalCanvas = document.getElementById('sensorChartModalCanvas');
  if (window.ChartManager && typeof ChartManager.destroy === 'function') {
    ChartManager.destroy('station:' + TABLE_ID + ':sensor:modal');
  }
  if (_sensorModalChart) {
    try { _sensorModalChart.destroy(); } catch (_) {}
    _sensorModalChart = null;
  }
  var existing = modalCanvas && window.Chart && Chart.getChart ? Chart.getChart(modalCanvas) : null;
  if (existing) {
    try { existing.destroy(); } catch (_) {}
  }
}

function renderSensorModalChart() {
  if (!_sensorModalSourceKey) return;
  var modalCanvas = document.getElementById('sensorChartModalCanvas');
  if (!modalCanvas) return;

  var chartKey = _sensorModalSourceKey;
  var isHum = chartKey === 'hum';
  var title = isHum ? 'Humidity (%RH)' : 'Temperature (°C)';
  var yLabel = title;
  var bounds = getEntriesBounds(state.allEntries);
  var win = getSensorDisplayWindow(bounds, _sensorModalRange);
  var datasets = buildSensorModalDatasets(chartKey, _sensorModalRange, win);
  var plotBounds = _sensorModalRange === 'all' ? getDatasetTimeBounds(datasets) : null;
  if (plotBounds) win = { min: plotBounds.min, max: plotBounds.max };

  document.getElementById('sensorChartModalTitle').textContent = title;
  modalCanvas.removeAttribute('width');
  modalCanvas.removeAttribute('height');
  destroySensorModalChart();

  _sensorModalChart = new Chart(modalCanvas, {
    type: 'line',
    data: { datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 14, padding: 10 } },
        tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1 },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          pan: { enabled: true, mode: 'x' }
        }
      },
      scales: {
        x: {
          type: 'time',
          adapters: { date: { zone: 'UTC' } },
          time: sensorTimeAxisConfig(_sensorModalRange),
          min: win.min,
          max: win.max,
          grid: {
            color: function(ctx) { return sensorAxisGridColor(ctx, _sensorModalRange); },
            lineWidth: function(ctx) { return sensorAxisGridWidth(ctx, _sensorModalRange); }
          },
          ticks: {
            color: '#64748b',
            maxTicksLimit: sensorAxisTickLimit(_sensorModalRange),
            autoSkip: _sensorModalRange === 'all',
            font: { size: 10 },
            callback: function(value, index) { return sensorAxisLabel(value, index, _sensorModalRange); }
          },
          afterBuildTicks: function(axis) {
            var ticks = buildSensorAxisTicks(axis.min, axis.max, _sensorModalRange);
            if (ticks) axis.ticks = ticks;
          }
        },
        y: {
          title: { display: true, text: yLabel, color: '#94a3b8', font: { size: 11 } },
          min: isHum ? 0 : undefined,
          max: isHum ? 100 : undefined,
          grid: { color: '#d6e3df', lineWidth: 0.7 },
          ticks: { color: '#64748b', font: { size: 10 } }
        }
      }
    },
    plugins: [sensorBandsPlugin, dailyMinMaxPlugin]
  });

  _sensorModalChart.$stationId = TABLE_ID;
  _sensorModalChart.$chartType = chartKey;
  setSensorChartSunEvents(_sensorModalChart, win);
  requestAnimationFrame(function() {
    if (!_sensorModalChart) return;
    _sensorModalChart.resize();
    _sensorModalChart.update('none');
  });
}

function cloneChartDataForModal(data) {
  return {
    labels: data && Array.isArray(data.labels) ? data.labels.slice() : undefined,
    datasets: (data && Array.isArray(data.datasets) ? data.datasets : []).map(function(ds) {
      var out = Object.assign({}, ds);
      if (Array.isArray(ds.data)) {
        out.data = ds.data.map(function(p) {
          if (p && typeof p === 'object') return Object.assign({}, p);
          return p;
        });
      }
      return out;
    })
  };
}

function openSensorChartModal(chartKey) {
  if (!state.charts[chartKey]) return;
  _sensorModalSourceKey = chartKey;
  _sensorModalRange = state.timeRange;
  syncSensorModalOverlayChecks();

  var overlay = document.getElementById('sensorChartModalOverlay');
  overlay.style.display = 'flex';
  renderSensorModalChart();
  updateSensorModalRangeButtons();
}

function setSensorModalRange(range) {
  _sensorModalRange = range;
  updateSensorModalRangeButtons();
  renderSensorModalChart();
}

function updateSensorModalRangeButtons() {
  document.querySelectorAll('[data-scmrange]').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-scmrange') === _sensorModalRange);
  });
}

function closeSensorChartModal(evt) {
  if (evt && evt.target && evt.target.id !== 'sensorChartModalOverlay') return;
  var overlay = document.getElementById('sensorChartModalOverlay');
  overlay.style.display = 'none';
  destroySensorModalChart();
  _sensorModalSourceKey = null;
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSensorChartModal();
});

document.addEventListener('click', function(e) {
  var btn = e.target && e.target.closest ? e.target.closest('[data-scmrange]') : null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  setSensorModalRange(btn.getAttribute('data-scmrange'));
}, true);

document.getElementById('sensorChartModalOverlay').addEventListener('click', function(e) {
  if (e.target && e.target.id === 'sensorChartModalOverlay') closeSensorChartModal(e);
});
