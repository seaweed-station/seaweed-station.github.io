// station_weather.js — Extracted from station.html (Sprint 6)
// Open-Meteo weather fetch, forecast, weather chart rendering
"use strict";

// =====================================================================
// OPEN-METEO WEATHER
// =====================================================================
var weatherState = {
  data: null, daily: null,
  tempPoints: [], humPoints: [],
  charts: { temp: null, hum: null, precip: null, uv: null },
  fetching: false,
  fetchKey: null,
  pendingFetchKey: null,
  forecast: null, forecastDaily: null, forecastFetching: false,
  recentUvOverlay: null,
  recentUvOverlayKey: null,
  sunEvents: [],
};

function buildWeatherSeriesCacheKey(range, seriesName) {
  return ['station', TABLE_ID, 'weather', range || 'week', seriesName].join(':');
}

function memoizedWeatherSeries(cacheKey, points, range) {
  if (!Array.isArray(points) || !points.length || !window.PlotCore || typeof PlotCore.memoizeSeries !== 'function') {
    return Array.isArray(points) ? points.slice() : [];
  }
  return PlotCore.memoizeSeries(cacheKey, PlotCore.buildSequenceSignature(points), function() {
    return PlotCore.lttbDownsample(points, PlotCore.resolveMaxPoints('station-weather-line', range, points.length));
  });
}

function buildWeatherChartOverlays(includeDailyExtrema, includeNowLine) {
  var overlays = [
    {
      id: 'sun-events',
      options: {
        getEvents: function() { return weatherState.sunEvents || []; }
      }
    },
    { id: 'day-labels' }
  ];
  if (includeDailyExtrema) overlays.push({ id: 'daily-extrema-labels' });
  if (includeNowLine) overlays.push({ id: 'now-line' });
  return overlays;
}

function mergeOpenMeteoSeries(parts) {
  var validParts = (parts || []).filter(function(part) {
    return part && Array.isArray(part.time) && part.time.length;
  });
  if (!validParts.length) return null;

  var fieldSet = {};
  validParts.forEach(function(part) {
    Object.keys(part).forEach(function(key) {
      if (key !== 'time' && key.charAt(0) !== '_') fieldSet[key] = true;
    });
  });

  var byTime = {};
  validParts.forEach(function(part) {
    for (var i = 0; i < part.time.length; i++) {
      var timeKey = part.time[i];
      if (!timeKey) continue;
      var row = byTime[timeKey] || { time: timeKey };
      Object.keys(fieldSet).forEach(function(field) {
        var values = part[field];
        if (!Array.isArray(values) || i >= values.length) return;
        if (values[i] !== undefined) row[field] = values[i];
      });
      byTime[timeKey] = row;
    }
  });

  var times = Object.keys(byTime).sort();
  var merged = { time: times };
  Object.keys(fieldSet).forEach(function(field) {
    merged[field] = times.map(function(timeKey) {
      return byTime[timeKey][field] !== undefined ? byTime[timeKey][field] : null;
    });
  });
  return merged;
}

function formatIsoDateUTC(date) {
  return new Date(date.getTime()).toISOString().slice(0, 10);
}

function buildOpenMeteoUrl(apiBase, startStr, endStr) {
  return apiBase + '?latitude=' + WEATHER_LOCATION.lat + '&longitude=' + WEATHER_LOCATION.lon +
    '&start_date=' + startStr + '&end_date=' + endStr +
    '&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,weather_code,uv_index' +
    '&daily=sunrise,sunset&timezone=auto';
}

function buildOpenMeteoForecastUrl(startStr, endStr) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_LOCATION.lat + '&longitude=' + WEATHER_LOCATION.lon +
    '&start_date=' + startStr + '&end_date=' + endStr +
    '&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,weather_code,uv_index' +
    '&daily=sunrise,sunset&timezone=auto';
}

function buildOpenMeteoRecentForecastUrl(pastDays, forecastDays) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_LOCATION.lat + '&longitude=' + WEATHER_LOCATION.lon +
    '&past_days=' + pastDays + '&forecast_days=' + forecastDays +
    '&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,weather_code,uv_index' +
    '&daily=sunrise,sunset&timezone=auto';
}

function buildRecentForecastBackfillParams(startMs, endMs) {
  var dayMs = 86400000;
  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  var todayStartMs = todayStart.getTime();
  var recentFloorMs = todayStartMs - 7 * dayMs;
  if (endMs < recentFloorMs) return null;

  var clampedStartMs = Math.max(startMs, recentFloorMs);
  var pastDays = Math.max(1, Math.ceil((todayStartMs - clampedStartMs) / dayMs));
  var forecastDays = Math.max(1, Math.ceil((Math.max(endMs, todayStartMs) - todayStartMs) / dayMs) + 1);
  pastDays = Math.min(pastDays, 7);
  forecastDays = Math.min(forecastDays, 7);
  return { pastDays: pastDays, forecastDays: forecastDays };
}

function mergeHourlyUvOverlay(baseHourly, overlayHourly) {
  if (!overlayHourly || !Array.isArray(overlayHourly.time) || !overlayHourly.time.length) return baseHourly;
  var partial = {
    time: overlayHourly.time.slice(),
    uv_index: Array.isArray(overlayHourly.uv_index) ? overlayHourly.uv_index.slice() : []
  };
  return mergeOpenMeteoSeries([baseHourly, partial]);
}

async function fetchRecentForecastUvOverlay(params) {
  if (!params) return null;
  var key = params.pastDays + '|' + params.forecastDays;
  if (weatherState.recentUvOverlay && weatherState.recentUvOverlayKey === key) {
    return weatherState.recentUvOverlay;
  }

  var resp = await fetch(buildOpenMeteoRecentForecastUrl(params.pastDays, params.forecastDays));
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  var json = await resp.json();
  if (!(json.hourly && Array.isArray(json.hourly.time) && json.hourly.time.length)) {
    throw new Error('Recent forecast response missing hourly data');
  }

  weatherState.recentUvOverlay = {
    hourly: {
      time: json.hourly.time.slice(),
      uv_index: Array.isArray(json.hourly.uv_index) ? json.hourly.uv_index.slice() : []
    },
    daily: json.daily || null,
    timezone: json.timezone || ''
  };
  weatherState.recentUvOverlayKey = key;
  return weatherState.recentUvOverlay;
}

async function backfillRecentForecastUv(hourly, daily, startMs, endMs) {
  var params = buildRecentForecastBackfillParams(startMs, endMs);
  if (!params) return { hourly: hourly, daily: daily };

  try {
    var overlay = await fetchRecentForecastUvOverlay(params);
    if (!overlay || !overlay.hourly) return { hourly: hourly, daily: daily };
    return {
      hourly: mergeHourlyUvOverlay(hourly, overlay.hourly),
      daily: mergeOpenMeteoSeries([daily, overlay.daily]) || daily,
      timezone: overlay.timezone || '',
      updated: true
    };
  } catch (err) {
    console.warn('[Weather] Recent UV backfill failed:', err);
    return { hourly: hourly, daily: daily };
  }
}

function weatherSeriesCoversWindow(hourly, startMs, endMs) {
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) return false;
  var seriesStart = new Date(hourly.time[0]).getTime();
  var seriesEnd = new Date(hourly.time[hourly.time.length - 1]).getTime();
  if (!isFinite(seriesStart) || !isFinite(seriesEnd)) return false;
  return seriesStart <= startMs && seriesEnd >= (endMs - 3600000);
}

function extendSunEventsCoverage(events, rangeStart, rangeEnd) {
  var dayMs = 24 * 3600000;
  var out = (events || []).filter(function(evt) {
    return evt && isFinite(evt.rise) && isFinite(evt.set) && evt.set > evt.rise;
  }).sort(function(a, b) {
    return a.rise - b.rise;
  });
  if (!out.length) return [];

  var filled = [out[0]];
  for (var i = 1; i < out.length; i++) {
    var prev = filled[filled.length - 1];
    var next = out[i];
    while ((next.rise - prev.rise) > (dayMs * 1.5)) {
      prev = { rise: prev.rise + dayMs, set: prev.set + dayMs };
      filled.push(prev);
    }
    filled.push(next);
  }

  while ((filled[0].rise - dayMs) >= (rangeStart - dayMs)) {
    filled.unshift({ rise: filled[0].rise - dayMs, set: filled[0].set - dayMs });
  }
  while (filled[filled.length - 1].set < (rangeEnd + dayMs)) {
    var tail = filled[filled.length - 1];
    filled.push({ rise: tail.rise + dayMs, set: tail.set + dayMs });
  }

  return filled.filter(function(evt) {
    return evt.set >= (rangeStart - dayMs) && evt.rise <= (rangeEnd + dayMs);
  });
}

function buildSunEventsForRange(daily, rangeStart, rangeEnd) {
  if (!daily || !Array.isArray(daily.sunrise) || !Array.isArray(daily.sunset)) return [];
  var events = [];
  for (var i = 0; i < daily.sunrise.length; i++) {
    var rise = new Date(daily.sunrise[i]).getTime();
    var set = new Date(daily.sunset[i]).getTime();
    if (!isFinite(rise) || !isFinite(set) || set <= rise) continue;
    events.push({ rise: rise, set: set });
  }
  return extendSunEventsCoverage(events, rangeStart, rangeEnd);
}

function applyWeatherCache(requireCoverage) {
  if (!window.WEATHER_CACHE || !window.WEATHER_CACHE.hourly || !window.WEATHER_CACHE.hourly.time) {
    return false;
  }

  var cached = window.WEATHER_CACHE.hourly;
  if (requireCoverage && state.filteredEntries.length) {
    var first = state.filteredEntries[0].timestamp;
    var last  = state.filteredEntries[state.filteredEntries.length - 1].timestamp;
    var cacheStart = new Date(cached.time[0]).getTime();
    var cacheEnd   = new Date(cached.time[cached.time.length - 1]).getTime();
    if (cacheStart > first.getTime() || cacheEnd < last.getTime() - 86400000) {
      return false;
    }
  }

  weatherState.data = cached;
  weatherState.data._timezone = window.WEATHER_CACHE.timezone || '';
  weatherState.data._location = WEATHER_LOCATION.name;
  if (window.WEATHER_CACHE.daily) weatherState.daily = window.WEATHER_CACHE.daily;
  return true;
}

function getWeatherWindowForRange(range, weatherData) {
  if (range === 'forecast') {
    return {
      min: Date.now() - 3600000,
      max: Date.now() + 7 * 86400000 + 3600000,
    };
  }
  if (range === 'all') {
    return { min: 0, max: Infinity };
  }

  var bounds = getEntriesBounds(state.allEntries);
  if (!bounds) bounds = getEntriesBounds(state.filteredEntries);
  if (!bounds && weatherData && weatherData.time && weatherData.time.length) {
    bounds = {
      min: new Date(weatherData.time[0]).getTime(),
      max: new Date(weatherData.time[weatherData.time.length - 1]).getTime(),
    };
  }
  if (!bounds) return { min: 0, max: Infinity };
  return getWindowForRange(bounds, range);
}

function refreshWeatherLinkedViews() {
  renderWeatherCharts();
  if (state.filteredEntries.length) {
    if (state.charts.temp) updateCharts();
    updatePeaksTable();
  }
}

async function fetchWeatherData() {
  if (!state.filteredEntries.length) {
    if (applyWeatherCache(false)) {
      console.log('[Weather] Pre-seeded cached weather_data.js');
      refreshWeatherLinkedViews();
    }
    return;
  }

  if (applyWeatherCache(true)) {
    console.log('[Weather] Using cached weather_data.js');
    var cacheBackfill = await backfillRecentForecastUv(weatherState.data, weatherState.daily, first.getTime() - 86400000, last.getTime() + 86400000);
    weatherState.data = cacheBackfill.hourly || weatherState.data;
    if (cacheBackfill.daily) weatherState.daily = cacheBackfill.daily;
    weatherState.data._timezone = cacheBackfill.timezone || weatherState.data._timezone || window.WEATHER_CACHE.timezone || '';
    weatherState.data._location = WEATHER_LOCATION.name;
    refreshWeatherLinkedViews();
    return;
  }

  var first = state.filteredEntries[0].timestamp;
  var last  = state.filteredEntries[state.filteredEntries.length - 1].timestamp;
  var startDate = new Date(first.getTime() - 86400000);
  var endDate   = new Date(Math.min(last.getTime() + 86400000, Date.now()));
  var startStr = startDate.toISOString().slice(0, 10);
  var endStr   = endDate.toISOString().slice(0, 10);
  var requestKey = startStr + '|' + endStr;

  if (weatherState.fetching) {
    if (weatherState.fetchKey !== requestKey) {
      weatherState.pendingFetchKey = requestKey;
    }
    return;
  }

  if (weatherState.data && weatherState.data.time && weatherState.data.time.length) {
    var existingStart = new Date(weatherState.data.time[0]).getTime();
    var existingEnd = new Date(weatherState.data.time[weatherState.data.time.length - 1]).getTime();
    if (existingStart <= startDate.getTime() && existingEnd >= endDate.getTime() - 3600000) {
      refreshWeatherLinkedViews();
      return;
    }
  }

  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  var todayStr = formatIsoDateUTC(todayStart);

  weatherState.fetching = true;
  weatherState.fetchKey = requestKey;
  weatherState.pendingFetchKey = null;
  try {
    var requests = [];
    var yesterday = new Date(todayStart.getTime() - 86400000);
    var yesterdayStr = formatIsoDateUTC(yesterday);

    if (startStr <= yesterdayStr) {
      var archiveEndStr = endStr < todayStr ? endStr : yesterdayStr;
      requests.push({
        source: 'archive',
        promise: fetch(buildOpenMeteoUrl('https://archive-api.open-meteo.com/v1/archive', startStr, archiveEndStr))
      });
    }
    if (endStr >= todayStr) {
      var forecastStartStr = startStr > todayStr ? startStr : todayStr;
      requests.push({
        source: 'forecast',
        promise: fetch(buildOpenMeteoForecastUrl(forecastStartStr, endStr))
      });
    }

    if (!requests.length) {
      requests.push({
        source: 'archive',
        promise: fetch(buildOpenMeteoUrl('https://archive-api.open-meteo.com/v1/archive', startStr, endStr))
      });
    }

    var settled = await Promise.all(requests.map(function(req) {
      return req.promise.then(function(res) {
        return { status: 'fulfilled', source: req.source, response: res };
      }).catch(function(err) {
        return { status: 'rejected', source: req.source, reason: err };
      });
    }));

    var payloads = [];
    var failures = [];
    for (var ri = 0; ri < settled.length; ri++) {
      var result = settled[ri];
      if (result.status !== 'fulfilled') {
        failures.push(result.source + ': ' + (result.reason && result.reason.message ? result.reason.message : result.reason));
        continue;
      }
      if (!result.response.ok) {
        failures.push(result.source + ': HTTP ' + result.response.status);
        continue;
      }
      payloads.push(await result.response.json());
    }

    if (!payloads.length) {
      throw new Error(failures.length ? failures.join('; ') : 'No Open-Meteo payloads returned');
    }

    var mergedHourly = mergeOpenMeteoSeries(payloads.map(function(p) { return p.hourly; }));
    var mergedDaily = mergeOpenMeteoSeries(payloads.map(function(p) { return p.daily; }));
    var backfilled = await backfillRecentForecastUv(mergedHourly, mergedDaily, startDate.getTime(), endDate.getTime());
    mergedHourly = backfilled.hourly || mergedHourly;
    mergedDaily = backfilled.daily || mergedDaily;

    if (mergedHourly && mergedHourly.time) {
      if (!weatherSeriesCoversWindow(mergedHourly, startDate.getTime(), endDate.getTime())) {
        console.warn('[Weather] Partial coverage for requested window ' + startStr + ' -> ' + endStr);
      }
      weatherState.data = mergedHourly;
      weatherState.data._timezone = backfilled.timezone || (payloads[payloads.length - 1] && payloads[payloads.length - 1].timezone) || '';
      weatherState.data._location = WEATHER_LOCATION.name;
      if (mergedDaily) weatherState.daily = mergedDaily;
      if (failures.length) {
        console.warn('[Weather] Partial fetch failures:', failures.join('; '));
      }
      refreshWeatherLinkedViews();
    }
  } catch (err) {
    console.warn('[Weather] Failed:', err);
    if (!weatherState.data && applyWeatherCache(false)) {
      refreshWeatherLinkedViews();
    }
  }
  finally {
    var completedKey = weatherState.fetchKey;
    var pendingKey = weatherState.pendingFetchKey;
    weatherState.fetching = false;
    weatherState.fetchKey = null;
    weatherState.pendingFetchKey = null;
    if (pendingKey && pendingKey !== completedKey) {
      fetchWeatherData();
    }
  }
}

async function fetchForecastData() {
  if (weatherState.forecastFetching) return;
  if (weatherState.forecast && weatherState.forecast._fetchedAt && Date.now() - weatherState.forecast._fetchedAt < 3600000) { renderWeatherCharts(); return; }
  weatherState.forecastFetching = true;
  var today = new Date().toISOString().slice(0, 10);
  var end   = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_LOCATION.lat + '&longitude=' + WEATHER_LOCATION.lon +
    '&start_date=' + today + '&end_date=' + end + '&hourly=temperature_2m,relative_humidity_2m,precipitation,uv_index&daily=sunrise,sunset&timezone=auto';
  try {
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var json = await resp.json();
    if (json.hourly && json.hourly.time) {
      weatherState.forecast = json.hourly;
      weatherState.forecast._timezone = json.timezone || '';
      weatherState.forecast._location = WEATHER_LOCATION.name + ' (Forecast)';
      weatherState.forecast._fetchedAt = Date.now();
      if (json.daily) weatherState.forecastDaily = json.daily;
      renderWeatherCharts();
    }
  } catch (err) { console.warn('[Weather] Forecast failed:', err); }
  finally { weatherState.forecastFetching = false; }
}

function renderWeatherCharts() {
  var _wxr = state.weatherTimeRange || 'week';
  var w = (_wxr === 'forecast') ? weatherState.forecast : weatherState.data;
  var activeDaily = (_wxr === 'forecast') ? weatherState.forecastDaily : weatherState.daily;
  if (!w || !w.time || !w.time.length) return;

  document.getElementById('weatherCollapsible').style.display = '';
  var locEl = document.getElementById('weatherLocation');
  if (locEl) locEl.textContent = w._location + ' (' + w._timezone + ')';

  var weatherWindow = getWeatherWindowForRange(_wxr, w);
  var rangeStart = weatherWindow.min;
  var rangeEnd = weatherWindow.max;

  function getWeatherAxisConfig(range) {
    switch (range) {
      case 'day':
        return { unit: 'hour', displayFormats: { hour: 'HH:mm' }, tooltipFormat: 'd LLL HH:mm' };
      case 'week':
        return { unit: 'day', displayFormats: { day: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
      case 'month':
        return { unit: 'day', displayFormats: { day: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
      case 'forecast':
        return { unit: 'day', displayFormats: { day: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
      default:
        return { unit: 'week', displayFormats: { week: 'd LLL' }, tooltipFormat: 'd LLL HH:mm' };
    }
  }

  var tempPoints = [], humPoints = [], precipPoints = [], uvPoints = [];
  for (var i = 0; i < w.time.length; i++) {
    var t = new Date(w.time[i]).getTime();
    if (t < rangeStart || t > rangeEnd) continue;
    if (w.temperature_2m[i] !== null) tempPoints.push({ x: t, y: w.temperature_2m[i] });
    if (w.relative_humidity_2m[i] !== null) humPoints.push({ x: t, y: w.relative_humidity_2m[i] });
    if (w.precipitation[i] !== null) precipPoints.push({ x: t, y: w.precipitation[i] });
    if (w.uv_index && w.uv_index[i] !== null && w.uv_index[i] !== undefined) uvPoints.push({ x: t, y: w.uv_index[i] });
  }
  weatherState.tempPoints = tempPoints;
  weatherState.humPoints  = humPoints;

  var tempPointsRaw = tempPoints.slice();
  var humPointsRaw = humPoints.slice();
  var precipPointsRaw = precipPoints.slice();
  var uvPointsRaw = uvPoints.slice();
  if (window.PlotCore && typeof PlotCore.lttbDownsample === 'function') {
    tempPoints = memoizedWeatherSeries(buildWeatherSeriesCacheKey(_wxr, 'temp'), tempPoints, _wxr);
    humPoints = memoizedWeatherSeries(buildWeatherSeriesCacheKey(_wxr, 'hum'), humPoints, _wxr);
    uvPoints = memoizedWeatherSeries(buildWeatherSeriesCacheKey(_wxr, 'uv'), uvPoints, _wxr);
  }

  var timeCfg = getWeatherAxisConfig(_wxr);

  weatherState.sunEvents = buildSunEventsForRange(activeDaily, rangeStart, rangeEnd);

  function weatherChartOpts(label, yMin, yMax) {
    var opts = baseChartOptions(label, yMin, yMax);
    opts.plugins.legend = { display: false };
    opts.scales.x.time = timeCfg;
    opts.scales.x.min = rangeStart;
    opts.scales.x.max = rangeEnd;
    opts.scales.x.ticks.color = (_wxr === 'day') ? '#64748b' : 'transparent';
    return opts;
  }

  function upsertWeatherChart(chartKey, canvasId, config, overlays) {
    if (window.ChartManager && typeof ChartManager.upsert === 'function') {
      return ChartManager.upsert({
        key: 'station:' + TABLE_ID + ':weather:' + chartKey,
        canvas: document.getElementById(canvasId),
        config: config,
        overlays: overlays,
        meta: { stationId: TABLE_ID, chartKey: chartKey, scope: 'station-weather' },
        recreateOnUpdate: true,
        updateMode: 'none'
      });
    }
    var existing = weatherState.charts[chartKey];
    if (existing) {
      existing.data.datasets = config.data.datasets;
      existing.options = config.options;
      existing.update('none');
      return existing;
    }
    return new Chart(document.getElementById(canvasId), config);
  }

  // Weather Temperature
  var wTempDS = [{ label: 'Temperature', data: tempPoints, borderColor: '#f59e0b', backgroundColor: '#f59e0b22', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, _rawData: tempPointsRaw }];
  weatherState.charts.temp = upsertWeatherChart('temp', 'weatherTempChart', { type: 'line', data: { datasets: wTempDS }, options: weatherChartOpts('Weather Temp (\u00B0C)') }, buildWeatherChartOverlays(true, true));

  // Weather Humidity
  var wHumDS = [{ label: 'Humidity', data: humPoints, borderColor: '#06b6d4', backgroundColor: '#06b6d422', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, _rawData: humPointsRaw }];
  weatherState.charts.hum = upsertWeatherChart('hum', 'weatherHumChart', { type: 'line', data: { datasets: wHumDS }, options: weatherChartOpts('Weather Humidity (%)', 0, 100) }, buildWeatherChartOverlays(true, true));

  // Precipitation
  var precipDS = [{ label: 'Precipitation', data: precipPoints, borderColor: '#3b82f688', backgroundColor: '#3b82f666', borderWidth: 1, pointRadius: 0, type: 'bar', _rawData: precipPointsRaw }];
  var precipOpts = weatherChartOpts('Precipitation (mm)');
  precipOpts.plugins.tooltip = { mode: 'index', intersect: false, backgroundColor: '#1e293bee', titleColor: '#f1f5f9', bodyColor: '#cbd5e1', callbacks: { label: function(ctx) { return ' ' + ctx.parsed.y.toFixed(1) + ' mm'; } } };
  weatherState.charts.precip = upsertWeatherChart('precip', 'weatherPrecipChart', { type: 'bar', data: { datasets: precipDS }, options: precipOpts }, buildWeatherChartOverlays(true, true));

  // UV Index
  var uvDS = [{ label: 'UV Index', data: uvPoints, borderColor: '#a855f7', backgroundColor: '#a855f722', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true,
    _rawData: uvPointsRaw,
    segment: { borderColor: function(ctx) { var v = ctx.p1.parsed.y; return v >= 11 ? '#dc2626' : v >= 8 ? '#ef4444' : v >= 6 ? '#f59e0b' : v >= 3 ? '#eab308' : '#22c55e'; } }
  }];
  var uvOpts = weatherChartOpts('UV Index', 0);
  uvOpts.scales.y.grace = '10%';
  uvOpts.plugins.tooltip = { mode: 'index', intersect: false, backgroundColor: '#1e293bee', titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
    callbacks: { label: function(ctx) { var v = ctx.parsed.y; var cat = v >= 11 ? 'Extreme' : v >= 8 ? 'Very High' : v >= 6 ? 'High' : v >= 3 ? 'Moderate' : 'Low'; return ' UV ' + v.toFixed(1) + ' (' + cat + ')'; } }
  };
  weatherState.charts.uv = upsertWeatherChart('uv', 'weatherUVChart', { type: 'line', data: { datasets: uvDS }, options: uvOpts }, buildWeatherChartOverlays(false, true));

  // Refresh daily summary table so Open-Meteo columns appear
  if (typeof updatePeaksTable === 'function' && state.filteredEntries && state.filteredEntries.length) updatePeaksTable();
}
