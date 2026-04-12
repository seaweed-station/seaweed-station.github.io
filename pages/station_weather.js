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
  sunEvents: [],
};

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

  var bounds = getEntriesBounds(state.timeRange === 'custom' ? state.filteredEntries : state.allEntries);
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
      requests.push(fetch(buildOpenMeteoUrl('https://archive-api.open-meteo.com/v1/archive', startStr, archiveEndStr)));
    }
    if (endStr >= todayStr) {
      var forecastStartStr = startStr > todayStr ? startStr : todayStr;
      requests.push(fetch(buildOpenMeteoUrl('https://api.open-meteo.com/v1/forecast', forecastStartStr, endStr)));
    }

    if (!requests.length) requests.push(fetch(buildOpenMeteoUrl('https://archive-api.open-meteo.com/v1/archive', startStr, endStr)));

    var responses = await Promise.all(requests);
    var payloads = [];
    for (var ri = 0; ri < responses.length; ri++) {
      if (!responses[ri].ok) throw new Error('HTTP ' + responses[ri].status);
      payloads.push(await responses[ri].json());
    }

    var mergedHourly = mergeOpenMeteoSeries(payloads.map(function(p) { return p.hourly; }));
    var mergedDaily = mergeOpenMeteoSeries(payloads.map(function(p) { return p.daily; }));

    if (mergedHourly && mergedHourly.time) {
      weatherState.data = mergedHourly;
      weatherState.data._timezone = (payloads[payloads.length - 1] && payloads[payloads.length - 1].timezone) || '';
      weatherState.data._location = WEATHER_LOCATION.name;
      if (mergedDaily) weatherState.daily = mergedDaily;
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

  var timeCfg = getWeatherAxisConfig(_wxr);

  weatherState.sunEvents = [];
  if (activeDaily && activeDaily.sunrise && activeDaily.sunset) {
    for (var si = 0; si < activeDaily.sunrise.length; si++) {
      weatherState.sunEvents.push({ rise: new Date(activeDaily.sunrise[si]).getTime(), set: new Date(activeDaily.sunset[si]).getTime() });
    }
  }

  function weatherChartOpts(label, yMin, yMax) {
    var opts = baseChartOptions(label, yMin, yMax);
    opts.plugins.legend = { display: false };
    opts.scales.x.time = timeCfg;
    opts.scales.x.min = rangeStart;
    opts.scales.x.max = rangeEnd;
    opts.scales.x.ticks.color = (_wxr === 'day') ? '#64748b' : 'transparent';
    return opts;
  }

  // Weather Temperature
  var wTempDS = [{ label: 'Temperature', data: tempPoints, borderColor: '#f59e0b', backgroundColor: '#f59e0b22', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true }];
  if (weatherState.charts.temp) { weatherState.charts.temp.data.datasets = wTempDS; weatherState.charts.temp.options.scales.x.time = timeCfg; weatherState.charts.temp.options.scales.x.min = rangeStart; weatherState.charts.temp.options.scales.x.max = rangeEnd; weatherState.charts.temp.options.scales.x.ticks.color = (_wxr === 'day') ? '#64748b' : 'transparent'; weatherState.charts.temp.update('none'); }
  else { weatherState.charts.temp = new Chart(document.getElementById('weatherTempChart'), { type: 'line', data: { datasets: wTempDS }, options: weatherChartOpts('Weather Temp (\u00B0C)'), plugins: [nightShadingPlugin, dayLabelPlugin, dailyMinMaxPlugin, nowLinePlugin] }); }

  // Weather Humidity
  var wHumDS = [{ label: 'Humidity', data: humPoints, borderColor: '#06b6d4', backgroundColor: '#06b6d422', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true }];
  if (weatherState.charts.hum) { weatherState.charts.hum.data.datasets = wHumDS; weatherState.charts.hum.options.scales.x.time = timeCfg; weatherState.charts.hum.options.scales.x.min = rangeStart; weatherState.charts.hum.options.scales.x.max = rangeEnd; weatherState.charts.hum.options.scales.x.ticks.color = (_wxr === 'day') ? '#64748b' : 'transparent'; weatherState.charts.hum.update('none'); }
  else { weatherState.charts.hum = new Chart(document.getElementById('weatherHumChart'), { type: 'line', data: { datasets: wHumDS }, options: weatherChartOpts('Weather Humidity (%)', 0, 100), plugins: [nightShadingPlugin, dayLabelPlugin, dailyMinMaxPlugin, nowLinePlugin] }); }

  // Precipitation
  var precipDS = [{ label: 'Precipitation', data: precipPoints, borderColor: '#3b82f688', backgroundColor: '#3b82f666', borderWidth: 1, pointRadius: 0, type: 'bar' }];
  var precipOpts = weatherChartOpts('Precipitation (mm)');
  precipOpts.plugins.tooltip = { mode: 'index', intersect: false, backgroundColor: '#1e293bee', titleColor: '#f1f5f9', bodyColor: '#cbd5e1', callbacks: { label: function(ctx) { return ' ' + ctx.parsed.y.toFixed(1) + ' mm'; } } };
  if (weatherState.charts.precip) { weatherState.charts.precip.data.datasets = precipDS; weatherState.charts.precip.options.scales.x.time = timeCfg; weatherState.charts.precip.options.scales.x.min = rangeStart; weatherState.charts.precip.options.scales.x.max = rangeEnd; weatherState.charts.precip.options.scales.x.ticks.color = (_wxr === 'day') ? '#64748b' : 'transparent'; weatherState.charts.precip.update('none'); }
  else { weatherState.charts.precip = new Chart(document.getElementById('weatherPrecipChart'), { type: 'bar', data: { datasets: precipDS }, options: precipOpts, plugins: [nightShadingPlugin, dayLabelPlugin, dailyMinMaxPlugin, nowLinePlugin] }); }

  // UV Index
  var uvDS = [{ label: 'UV Index', data: uvPoints, borderColor: '#a855f7', backgroundColor: '#a855f722', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true,
    segment: { borderColor: function(ctx) { var v = ctx.p1.parsed.y; return v >= 11 ? '#dc2626' : v >= 8 ? '#ef4444' : v >= 6 ? '#f59e0b' : v >= 3 ? '#eab308' : '#22c55e'; } }
  }];
  var uvOpts = weatherChartOpts('UV Index', 0);
  uvOpts.scales.y.grace = '10%';
  uvOpts.plugins.tooltip = { mode: 'index', intersect: false, backgroundColor: '#1e293bee', titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
    callbacks: { label: function(ctx) { var v = ctx.parsed.y; var cat = v >= 11 ? 'Extreme' : v >= 8 ? 'Very High' : v >= 6 ? 'High' : v >= 3 ? 'Moderate' : 'Low'; return ' UV ' + v.toFixed(1) + ' (' + cat + ')'; } }
  };
  if (weatherState.charts.uv) { weatherState.charts.uv.data.datasets = uvDS; weatherState.charts.uv.options.scales.x.time = timeCfg; weatherState.charts.uv.options.scales.x.min = rangeStart; weatherState.charts.uv.options.scales.x.max = rangeEnd; weatherState.charts.uv.options.scales.x.ticks.color = (_wxr === 'day') ? '#64748b' : 'transparent'; weatherState.charts.uv.update('none'); }
  else { weatherState.charts.uv = new Chart(document.getElementById('weatherUVChart'), { type: 'line', data: { datasets: uvDS }, options: uvOpts, plugins: [nightShadingPlugin, dayLabelPlugin, dailyMinMaxPlugin, nowLinePlugin] }); }

  // Refresh daily summary table so Open-Meteo columns appear
  if (typeof updatePeaksTable === 'function' && state.filteredEntries && state.filteredEntries.length) updatePeaksTable();
}
