// station_charts.js — Extracted from station.html (Sprint 6)
// Chart colors, datasets, plugins, create/update, sensor modal
"use strict";

var COLORS = {
  t0s1: '#3b82f6', t0s2: '#93c5fd', t0s3: '#60a5fa',
  slot1s1: '#10b981', slot1s2: '#6ee7b7',
  slot2s1: '#f59e0b', slot2s2: '#fcd34d',
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
  };
  var mapKey = STATION ? STATION.sensorMap : null;
  var legend = (mapKey && SENSOR_MAPS[mapKey]) ? SENSOR_MAPS[mapKey].legend : null;
  if (!legend || !legend.length) return c;

  // Legend index maps to Sensor 1..N on cards/charts.
  if (legend[0] && legend[0].color) c.t0s1 = legend[0].color;
  if (legend[1] && legend[1].color) c.t0s2 = legend[1].color;
  if (legend[2] && legend[2].color) c.t0s3 = legend[2].color;
  if (legend[3] && legend[3].color) c.slot1s1 = legend[3].color;
  if (legend[4] && legend[4].color) c.slot1s2 = legend[4].color;
  if (legend[5] && legend[5].color) c.slot2s1 = legend[5].color;
  if (legend[6] && legend[6].color) c.slot2s2 = legend[6].color;
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

function makeDataset(entries, key, label, color, dashed) {
  var rawData = [];
  entries.forEach(function (e) { if (e[key] !== null) rawData.push({ x: e.timestamp, y: e[key] }); });
  var data = memoizedDownsampleSeries(buildStationSeriesCacheKey('sensor', key, state.timeRange), rawData, 'station-sensor', state.timeRange);
  return {
    label: label + (rawData.length === 0 ? ' (No Data)' : ' (' + rawData.length + ')'),
    data: data, borderColor: color, backgroundColor: color + '22',
    borderWidth: data.length > 0 ? 1.5 : 0, borderDash: dashed ? [5, 3] : [],
    pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color,
    tension: 0.3, fill: false, hidden: data.length === 0, spanGaps: false,
    _rawData: rawData,
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
  if (_sensorModalSourceKey) openSensorChartModal(_sensorModalSourceKey);
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
            var d = new Date(items[0].parsed.x);
            return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                 + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          },
          label: function (ctx) { var v = ctx.parsed.y; return ' ' + ctx.dataset.label.split(' (')[0] + ': ' + (v !== null ? v.toFixed(2) : 'NC'); },
        },
      }
    },
    scales: {
      x: { type: 'time', grid: { color: '#d6e3df', lineWidth: 0.7 }, ticks: { color: '#64748b', maxTicksLimit: 12, font: { size: 10 } }, time: getTimeAxisConfig() },
      y: { title: { display: true, text: yLabel, color: '#94a3b8', font: { size: 11 } }, grid: { color: '#d6e3df', lineWidth: 0.7 }, ticks: { color: '#64748b', font: { size: 10 } }, min: yMin, max: yMax },
    },
  };
}

function createOrUpdateCharts() {
  var chartEntries = state.filteredEntries;
  if (!chartEntries || !chartEntries.length) chartEntries = state.allEntries;
  if (!chartEntries || !chartEntries.length) return;
  var chartBounds = getEntriesBounds(chartEntries);
  var chartWindow = getWindowForRange(chartBounds, state.timeRange);
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

  var timeCfg = getTimeAxisConfig();
  Object.keys(state.charts).forEach(function(k) {
    if (state.charts[k] && state.charts[k].options && state.charts[k].options.scales && state.charts[k].options.scales.x) {
      state.charts[k].options.scales.x.time = timeCfg;
    }
  });

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

  var _tOpts = baseChartOptions('Temperature (\u00B0C)');
  _tOpts.plugins.legend.position = 'left';
  _tOpts.scales.x.min = chartWindow.min;
  _tOpts.scales.x.max = chartWindow.max;
  state.charts.temp = (window.ChartManager && typeof ChartManager.upsert === 'function')
    ? ChartManager.upsert({
        key: 'station:' + TABLE_ID + ':sensor:temp',
        canvas: document.getElementById('tempChart'),
        config: { type: 'line', data: { datasets: tempDS }, options: _tOpts },
        overlays: buildSensorChartOverlays(),
        meta: { stationId: TABLE_ID, chartKey: 'temp', scope: 'station-main' },
        recreateOnUpdate: true,
        updateMode: 'none'
      })
    : (state.charts.temp || new Chart(document.getElementById('tempChart'), {
        type: 'line', data: { datasets: tempDS }, options: _tOpts, plugins: [sensorBandsPlugin, dailyMinMaxPlugin]
      }));

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

  var _hOpts2 = baseChartOptions('Humidity (%RH)', 0, 100);
  _hOpts2.plugins.legend.position = 'left';
  _hOpts2.scales.x.min = chartWindow.min;
  _hOpts2.scales.x.max = chartWindow.max;
  state.charts.hum = (window.ChartManager && typeof ChartManager.upsert === 'function')
    ? ChartManager.upsert({
        key: 'station:' + TABLE_ID + ':sensor:hum',
        canvas: document.getElementById('humChart'),
        config: { type: 'line', data: { datasets: humDS }, options: _hOpts2 },
        overlays: buildSensorChartOverlays(),
        meta: { stationId: TABLE_ID, chartKey: 'hum', scope: 'station-main' },
        recreateOnUpdate: true,
        updateMode: 'none'
      })
    : (state.charts.hum || new Chart(document.getElementById('humChart'), {
        type: 'line', data: { datasets: humDS }, options: _hOpts2, plugins: [sensorBandsPlugin, dailyMinMaxPlugin]
      }));

  // Battery, Sync, Drift charts removed -- see station_health.html
}

function updateCharts() {
  if (!state.charts.temp) return;
  createOrUpdateCharts();
  if (_sensorModalChart && _sensorModalSourceKey) {
    openSensorChartModal(_sensorModalSourceKey);
  }
}

var _sensorModalChart = null;
var _sensorModalSourceKey = null;
var _sensorModalRange = 'week';

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
  var srcChart = state.charts[chartKey];
  if (!srcChart) return;
  _sensorModalSourceKey = chartKey;
  _sensorModalRange = state.timeRange;
  var title = chartKey === 'hum' ? 'Humidity (%RH)' : 'Temperature (°C)';
  document.getElementById('sensorChartModalTitle').textContent = title;
  syncSensorModalOverlayChecks();

  var overlay = document.getElementById('sensorChartModalOverlay');
  overlay.style.display = 'flex';
  if (_sensorModalChart) {
    _sensorModalChart.destroy();
    _sensorModalChart = null;
  }

  var modalCanvas = document.getElementById('sensorChartModalCanvas');
  modalCanvas.removeAttribute('width');
  modalCanvas.removeAttribute('height');

  var srcY = (srcChart.options && srcChart.options.scales && srcChart.options.scales.y) ? srcChart.options.scales.y : {};
  var yTitle = srcY.title && srcY.title.text ? srcY.title.text : '';
  var modalData = cloneChartDataForModal(srcChart.data);
  var bounds = getEntriesBounds(state.allEntries);
  var win = getWindowForRange(bounds, _sensorModalRange);
  modalData.datasets.forEach(function(ds) {
    var rawData = Array.isArray(ds._rawData) && ds._rawData.length ? ds._rawData : ds.data;
    if (!Array.isArray(rawData) || !rawData.length) return;
    ds._rawData = rawData.slice();
    ds.data = downsamplePlotSeries(filterSeriesToWindow(rawData, win), 'modal-series', _sensorModalRange);
  });

  var modalConfig = {
    type: srcChart.config.type,
    data: modalData,
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
          time: getTimeAxisConfig(),
          min: win.min,
          max: win.max,
          grid: { color: '#d6e3df', lineWidth: 0.7 },
          ticks: { color: '#64748b', maxTicksLimit: 12, font: { size: 10 } }
        },
        y: {
          title: { display: !!yTitle, text: yTitle, color: '#94a3b8', font: { size: 11 } },
          min: srcY.min,
          max: srcY.max,
          grid: { color: '#d6e3df', lineWidth: 0.7 },
          ticks: { color: '#64748b', font: { size: 10 } }
        }
      }
    }
  };
  _sensorModalChart = (window.ChartManager && typeof ChartManager.upsert === 'function')
    ? ChartManager.upsert({
        key: 'station:' + TABLE_ID + ':sensor:modal',
        canvas: modalCanvas,
        config: modalConfig,
        overlays: buildSensorChartOverlays(),
        meta: { stationId: TABLE_ID, chartKey: 'sensor-modal', scope: 'station-modal' },
        recreateOnUpdate: true,
        updateMode: 'none'
      })
    : new Chart(modalCanvas, Object.assign({}, modalConfig, { plugins: [sensorBandsPlugin, dailyMinMaxPlugin] }));

  updateSensorModalRangeButtons();
}

function setSensorModalRange(range) {
  _sensorModalRange = range;
  updateSensorModalRangeButtons();
  if (!_sensorModalChart) return;
  var bounds = getEntriesBounds(state.allEntries);
  var win = getWindowForRange(bounds, range);
  if (_sensorModalChart.data && Array.isArray(_sensorModalChart.data.datasets)) {
    _sensorModalChart.data.datasets.forEach(function(ds) {
      var rawData = Array.isArray(ds._rawData) && ds._rawData.length ? ds._rawData : ds.data;
      if (!Array.isArray(rawData) || !rawData.length) return;
      ds.data = downsamplePlotSeries(filterSeriesToWindow(rawData, win), 'modal-series', range);
    });
  }
  if (_sensorModalChart.options && _sensorModalChart.options.scales && _sensorModalChart.options.scales.x) {
    _sensorModalChart.options.scales.x.min = win.min;
    _sensorModalChart.options.scales.x.max = win.max;
  }
  setSensorChartSunEvents(_sensorModalChart, win);
  _sensorModalChart.update('none');
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
  if (_sensorModalChart) {
    if (window.ChartManager && typeof ChartManager.destroy === 'function') ChartManager.destroy('station:' + TABLE_ID + ':sensor:modal');
    else _sensorModalChart.destroy();
    _sensorModalChart = null;
  }
  _sensorModalSourceKey = null;
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSensorChartModal();
});

document.getElementById('sensorChartModalOverlay').addEventListener('click', function(e) {
  if (e.target && e.target.id === 'sensorChartModalOverlay') closeSensorChartModal(e);
});
