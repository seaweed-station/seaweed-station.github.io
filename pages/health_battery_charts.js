// health_battery_charts.js — Extracted from station_health.html (Sprint 6)
// Battery % + voltage charts, solar chart, calculated-days overlay

// ============================================================
// BATTERY CHARTS
// ============================================================
function renderBatteryCharts(container, entries, stationId, range) {
  if (!entries || !entries.length) return;
  var syncRowsAll = Array.isArray(_stationSyncTimeline[stationId]) ? _stationSyncTimeline[stationId] : [];
  var slotCtx = typeof getHealthSlotContext === 'function' ? getHealthSlotContext(stationId, entries, syncRowsAll) : null;
  var slotList = slotCtx && Array.isArray(slotCtx.slots)
    ? slotCtx.slots.slice()
    : healthSatelliteSlotNumbers().map(function(slotNumber) {
        return {
          slotNumber: slotNumber,
          enabled: isSatelliteVisible(stationId, entries, slotNumber),
          label: satelliteDisplayName(stationId, slotNumber),
          nodeLetter: satelliteNodeLetter(stationId, slotNumber)
        };
      }).filter(function(slot) { return !!slot.enabled; });
  var SAT_SLOT_COLORS = ['#34d399', '#fbbf24', '#a78bfa', '#38bdf8', '#fb7185', '#84cc16', '#f97316'];
  var SAT_SLOT_CALC_COLORS = ['#6ee7b7', '#fde68a', '#c4b5fd', '#7dd3fc', '#fda4af', '#bef264', '#fdba74'];
  function slotColor(slot, calc) {
    var idx = Math.max(0, Number(slot.slotNumber || 1) - 1) % SAT_SLOT_COLORS.length;
    return calc ? SAT_SLOT_CALC_COLORS[idx] : SAT_SLOT_COLORS[idx];
  }
  function slotPrefix(slot) {
    return 'sat' + slot.slotNumber;
  }
  function rowMatchesSlot(row, slot) {
    if (!row || !slot) return false;
    var rowSlot = Number(row.slot_number);
    if (isFinite(rowSlot) && rowSlot === Number(slot.slotNumber)) return true;
    var node = String(row.node_id || '').trim().toUpperCase();
    return !!(slot.nodeLetter && node && node === String(slot.nodeLetter).toUpperCase());
  }
  var firstTs = entries[0].timestamp;
  var lastTs = entries[entries.length - 1].timestamp;
  var CUTOFF_V = 3.3;
  var FULL_V = 4.2;
  var PLOT_MIN_V = 3.2;
  var DEFAULT_PLOT_MAX_V = 4.3;
  var PLOT_MIN_PCT = 0;
  var PLOT_MAX_PCT = 110;

  function resolvePlotMaxVoltage(data) {
    var keys = ['t0BatV'].concat(slotList.map(function(slot) { return slotPrefix(slot) + 'BatV'; }));
    var maxV = FULL_V;
    for (var i = 0; i < data.length; i++) {
      var entry = data[i];
      for (var k = 0; k < keys.length; k++) {
        var value = Number(entry[keys[k]]);
        if (isFinite(value) && value > 0) maxV = Math.max(maxV, value);
      }
    }
    if (!isFinite(maxV)) return DEFAULT_PLOT_MAX_V;
    return Math.max(DEFAULT_PLOT_MAX_V, Math.ceil((maxV + 0.05) * 10) / 10);
  }

  var PLOT_MAX_V = resolvePlotMaxVoltage(entries);

  var voltWrap = document.createElement('div');
  voltWrap.className = 'chart-box-full chart-box-voltage';
  voltWrap.innerHTML = '<h4>Battery Voltage (' + rangeLabel(range) + ')</h4>';

  var calcControl = document.createElement('div');
  calcControl.className = 'time-btns';
  calcControl.style.marginBottom = '8px';
  calcControl.style.gap = '6px';

  var btnCalcToggle = document.createElement('button');
  btnCalcToggle.className = 'btn btn-sm';
  btnCalcToggle.type = 'button';
  btnCalcToggle.textContent = 'Show Calculated';

  var btnEventToggle = document.createElement('button');
  btnEventToggle.className = 'btn btn-sm';
  btnEventToggle.type = 'button';
  btnEventToggle.textContent = 'Show Events';

  var calcModeNote = document.createElement('span');
  calcModeNote.style.fontSize = '.72rem';
  calcModeNote.style.color = 'var(--text-muted)';
  calcModeNote.textContent = 'Calculated: latest behavior/settings';

  var calcHint = document.createElement('span');
  calcHint.style.fontSize = '.72rem';
  calcHint.style.color = 'var(--text-muted)';
  calcHint.textContent = 'Anchor: start of visible range';

  calcControl.appendChild(btnEventToggle);
  calcControl.appendChild(btnCalcToggle);
  calcControl.appendChild(calcModeNote);
  calcControl.appendChild(calcHint);
  voltWrap.appendChild(calcControl);

  var voltCanvas = document.createElement('canvas');
  voltWrap.appendChild(voltCanvas);

  var calcDaysRow = document.createElement('div');
  calcDaysRow.className = 'calc-days-row';
  calcDaysRow.style.display = 'none';
  voltWrap.appendChild(calcDaysRow);

  container.appendChild(voltWrap);

  function medianNumber(values) {
    var nums = (values || []).filter(function(v) { return isFinite(v); }).sort(function(a, b) { return a - b; });
    if (!nums.length) return null;
    var mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }

  function voltageBinMsForRange() {
    if (range === 'week') return 30 * 60000;
    if (range === 'month') return 2 * 3600000;
    if (range === 'all') return 6 * 3600000;
    return 0;
  }

  function cleanSatelliteVoltagePoints(points) {
    if (range === 'day' || !points || points.length < 4) return points;
    var binMs = voltageBinMsForRange();
    if (!binMs) return points;

    var byBin = {};
    for (var i = 0; i < points.length; i++) {
      var pt = points[i];
      var ts = pt.x instanceof Date ? pt.x.getTime() : Number(pt.x);
      var y = Number(pt.y);
      if (!isFinite(ts) || !isFinite(y)) continue;
      var key = Math.floor(ts / binMs);
      if (!byBin[key]) byBin[key] = { ts: [], values: [] };
      byBin[key].ts.push(ts);
      byBin[key].values.push(y);
    }

    return Object.keys(byBin).sort(function(a, b) { return Number(a) - Number(b); }).map(function(key) {
      var bucket = byBin[key];
      var y = medianNumber(bucket.values);
      var t = medianNumber(bucket.ts);
      if (y === null || t === null) return null;
      return { x: new Date(t), y: Number(y.toFixed(3)) };
    }).filter(function(pt) { return !!pt; });
  }

  function makeVoltDS(data, key, label, color, cleanTransientSpikes) {
    var pts = data
      .filter(function(e) { return e[key] !== null && e[key] !== undefined && isFinite(e[key]) && Number(e[key]) > 0; })
      .map(function(e) { return { x: e.timestamp, y: Number(e[key]) }; });
    if (cleanTransientSpikes) pts = cleanSatelliteVoltagePoints(pts);
    return {
      label: label,
      data: memoizeHealthSeries('health:' + stationId + ':battery:' + range + ':' + key, pts),
      yAxisID: 'y',
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.2,
      fill: false
    };
  }

  function pctSeries(data, pctKey) {
    return data
      .filter(function(e) { return e[pctKey] !== null && e[pctKey] !== undefined && isFinite(e[pctKey]); })
      .map(function(e) { return { t: e.timestamp.getTime(), p: Number(e[pctKey]) }; })
      .sort(function(a, b) { return a.t - b.t; });
  }

  function voltageSeries(data, voltKey) {
    return data
      .filter(function(e) { return e[voltKey] !== null && e[voltKey] !== undefined && isFinite(e[voltKey]) && Number(e[voltKey]) > 0; })
      .map(function(e) { return { t: e.timestamp.getTime(), v: Number(e[voltKey]) }; })
      .sort(function(a, b) { return a.t - b.t; });
  }

  function pctUpperEnvelope(pts, binMs) {
    if (!pts || !pts.length) return [];
    binMs = Math.max(1, binMs || 3 * 3600000);
    var byBin = {};
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var bin = Math.floor(p.t / binMs);
      var cur = byBin[bin];
      if (!cur || p.p > cur.p) byBin[bin] = { t: p.t, p: p.p };
    }
    var out = Object.keys(byBin).map(function(k) { return byBin[k]; });
    out.sort(function(a, b) { return a.t - b.t; });
    return out;
  }

  function estimateDailyPctLossFromPoints(pts) {
    if (pts.length < 2) return 0.4;
    var first = pts[0];
    var last = pts[pts.length - 1];
    var days = (last.t - first.t) / 86400000;
    if (days <= 0) return 0.4;
    var loss = (first.p - last.p) / days;
    if (!isFinite(loss) || loss <= 0) return 0.4;
    return Math.max(0.05, Math.min(8, loss));
  }

  function resolveAnchorPctFromPoints(pts, anchorMs, dailyPctLoss) {
    var best = null;
    for (var i = 0; i < pts.length; i++) {
      var dt = Math.abs(pts[i].t - anchorMs);
      if (!best || dt < best.dt) best = { p: Number(pts[i].p), t: pts[i].t, dt: dt };
    }
    if (!best) return null;
    var deltaDays = (anchorMs - best.t) / 86400000;
    var adjPct = best.p - (dailyPctLoss * deltaDays);
    if (!isFinite(adjPct)) return null;
    return Math.max(0, Math.min(100, adjPct));
  }

  function estimateCalculatedDaysToCutoff(pctKey, boardKind, useEnvelope) {
    if (typeof BatteryModel === 'undefined' || typeof BatteryModel.projectVoltageCurve !== 'function') return null;
    var rawPts = pctSeries(entries, pctKey);
    if (!rawPts.length) return null;

    var fitPts = useEnvelope ? pctUpperEnvelope(rawPts, 3 * 3600000) : rawPts;
    if (fitPts.length < 2) fitPts = rawPts;

    var dailyPctLoss = estimateDailyPctLossFromPoints(fitPts);
    var anchorPct = resolveAnchorPctFromPoints(fitPts, calcAnchorMs, dailyPctLoss);
    if (anchorPct === null) return null;

    var battCap = 3000;
    var derating = 0.85;
    var usableMah = battCap * derating;
    var dailyMah = Math.max(0.01, (dailyPctLoss / 100) * usableMah);
    var approxDays = Math.max(2, Math.ceil(Math.min(5000, anchorPct / Math.max(0.01, dailyPctLoss))) + 30);

    var curve = BatteryModel.projectVoltageCurve(
      anchorPct,
      new Date(calcAnchorMs),
      dailyMah,
      battCap,
      derating,
      {
        boardKind: boardKind,
        fullV: FULL_V,
        cutoffV: CUTOFF_V,
        maxDays: approxDays
      }
    ) || [];

    var base = curve
      .filter(function(p) {
        return p && p.time && !isNaN(p.time.getTime()) && p.voltage !== null && p.voltage !== undefined && isFinite(p.voltage);
      })
      .map(function(p) { return { t: p.time.getTime(), v: Number(p.voltage) }; })
      .sort(function(a, b) { return a.t - b.t; });

    if (!base.length) return null;
    if (base[0].v <= CUTOFF_V) return 0;

    for (var i = 1; i < base.length; i++) {
      var p0 = base[i - 1];
      var p1 = base[i];
      if (p1.v <= CUTOFF_V) {
        var den = (p1.v - p0.v);
        var f = (Math.abs(den) < 1e-9) ? 1 : (CUTOFF_V - p0.v) / den;
        f = Math.max(0, Math.min(1, f));
        var crossTs = p0.t + (p1.t - p0.t) * f;
        return Math.max(0, Math.min(5000, (crossTs - calcAnchorMs) / 86400000));
      }
    }

    return null;
  }

  function buildCalculatedPoints(data, pctKey, boardKind, anchorMs, rangeStartMs, rangeEndMs, voltKey) {
    if (typeof BatteryModel === 'undefined' || typeof BatteryModel.projectVoltageCurve !== 'function') return [];
    var rawPts = pctSeries(data, pctKey);
    // For satellites, use an upper-envelope to ignore transient sync droops.
    var useEnvelope = /^sat\d+BatPct$/.test(pctKey);
    var fitPts = useEnvelope ? pctUpperEnvelope(rawPts, 3 * 3600000) : rawPts;
    if (fitPts.length < 2) fitPts = rawPts;

    var dailyPctLoss = estimateDailyPctLossFromPoints(fitPts);
    var anchorPct = resolveAnchorPctFromPoints(fitPts, anchorMs, dailyPctLoss);
    if (anchorPct === null) return [];

    var clipStartMs = Math.max(rangeStartMs, anchorMs);
    if (!isFinite(clipStartMs) || !isFinite(rangeEndMs) || clipStartMs > rangeEndMs) return [];

    var battCap = 3000;
    var derating = 0.85;
    var usableMah = battCap * derating;
    var dailyMah = Math.max(0.01, (dailyPctLoss / 100) * usableMah);
    // Generate far enough ahead to keep modal projections from looking abruptly cropped.
    var approxDaysToCutoff = Math.max(2, Math.ceil(Math.min(730, anchorPct / Math.max(0.01, dailyPctLoss))) + 30);
    var maxDays = Math.max(2, Math.ceil((rangeEndMs - anchorMs) / 86400000) + 3, approxDaysToCutoff);

    var curve = BatteryModel.projectVoltageCurve(
      anchorPct,
      new Date(anchorMs),
      dailyMah,
      battCap,
      derating,
      {
        boardKind: boardKind,
        fullV: FULL_V,
        cutoffV: CUTOFF_V,
        maxDays: maxDays
      }
    ) || [];

    var base = curve
      .filter(function(p) {
        return p && p.time && !isNaN(p.time.getTime()) && p.voltage !== null && p.voltage !== undefined && isFinite(p.voltage);
      })
      .map(function(p) { return { t: p.time.getTime(), v: Number(p.voltage) }; })
      .sort(function(a, b) { return a.t - b.t; });

    if (!base.length) return [];

    function interpAt(ts) {
      if (ts < base[0].t) return null;
      if (base.length === 1) return base[0].v;
      for (var i = 1; i < base.length; i++) {
        var p0 = base[i - 1];
        var p1 = base[i];
        if (ts <= p1.t) {
          var den = (p1.t - p0.t);
          if (den <= 0) return p1.v;
          var f = (ts - p0.t) / den;
          return p0.v + (p1.v - p0.v) * f;
        }
      }
      return null;
    }

    var modelEndMs = Math.max(rangeEndMs, base[base.length - 1].t);
    var spanMs = modelEndMs - clipStartMs;
    var stepMs;
    if (spanMs <= 86400000) stepMs = 15 * 60000;           // day
    else if (spanMs <= 7 * 86400000) stepMs = 60 * 60000;  // week
    else if (spanMs <= 30 * 86400000) stepMs = 6 * 3600000;// month
    else stepMs = 24 * 3600000;                            // all

    var out = [];
    for (var t = clipStartMs; t <= modelEndMs; t += stepMs) {
      var v = interpAt(t);
      if (v !== null && isFinite(v)) out.push({ x: new Date(t), y: v });
    }

    if (!out.length || out[out.length - 1].x.getTime() < modelEndMs) {
      var endV = interpAt(modelEndMs);
      if (endV !== null && isFinite(endV)) out.push({ x: new Date(modelEndMs), y: endV });
    }

    // Align calculated curve to the anchor voltage so dashed starts on the measured line.
    var voltagePts = data
      .filter(function(e) { return e[voltKey] !== null && e[voltKey] !== undefined && isFinite(e[voltKey]) && Number(e[voltKey]) > 0; })
      .map(function(e) { return { t: e.timestamp.getTime(), v: Number(e[voltKey]) }; })
      .sort(function(a, b) { return a.t - b.t; });

    if (voltagePts.length && out.length) {
      var bestV = null;
      for (var vi = 0; vi < voltagePts.length; vi++) {
        var dtv = Math.abs(voltagePts[vi].t - anchorMs);
        if (!bestV || dtv < bestV.dt) bestV = { v: voltagePts[vi].v, dt: dtv };
      }
      if (bestV && isFinite(bestV.v)) {
        var modelAnchorV = out[0].y;
        var shift = bestV.v - modelAnchorV;
        out = out.map(function(p) {
          var y = p.y + shift;
          if (!isFinite(y)) return p;
          return { x: p.x, y: Math.max(PLOT_MIN_V, Math.min(PLOT_MAX_V, y)) };
        });
      }
    }

    return out;
  }

  function calculatedDataset(label, color, pctKey, boardKind, anchorMs, rangeStartMs, rangeEndMs, voltKey) {
    return {
      label: label,
      data: buildCalculatedPoints(entries, pctKey, boardKind, anchorMs, rangeStartMs, rangeEndMs, voltKey),
      yAxisID: 'y',
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [9, 5],
      pointRadius: 0,
      tension: 0.15,
      fill: false,
      hidden: true,
      _isCalculated: true,
      _calcPctKey: pctKey,
      _calcBoardKind: boardKind,
      _calcVoltKey: voltKey
    };
  }

  function uniqSortedTimes(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || isNaN(d.getTime())) continue;
      var t = d.getTime();
      if (seen[t]) continue;
      seen[t] = true;
      out.push(new Date(t));
    }
    out.sort(function(a, b) { return a - b; });
    return out;
  }

  function verticalEventDataset(label, color, times, hiddenByDefault, dashPattern, lineWidth, eventType) {
    var points = [];
    for (var i = 0; i < times.length; i++) {
      var tMs = times[i].getTime();
      points.push({ x: tMs, y: PLOT_MIN_V });
      points.push({ x: tMs, y: PLOT_MAX_V });
      points.push({ x: tMs, y: null }); // break line between vertical markers
    }
    return {
      label: label,
      data: points,
      yAxisID: 'y',
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: lineWidth || 1.4,
      borderDash: dashPattern || [6, 4],
      pointRadius: 0,
      tension: 0,
      fill: false,
      hidden: !!hiddenByDefault,
      parsing: false,
      spanGaps: false,
      _isEvent: true,
      _eventType: eventType || 'generic'
    };
  }

  var rangeStartMs = firstTs.getTime();
  var rangeEndMs = lastTs.getTime();
  var calcAnchorMs = rangeStartMs;
  var uploadRows = Array.isArray(_stationUploadTimeline[stationId]) ? _stationUploadTimeline[stationId] : [];
  var syncRows = Array.isArray(_stationSyncTimeline[stationId]) ? _stationSyncTimeline[stationId] : [];
  var uploadEventTimes = uniqSortedTimes(uploadRows.map(function(r) {
    return r && r.upload_started_at ? new Date(ensureUTC(r.upload_started_at)) : null;
  }).filter(function(d) {
    return d && !isNaN(d.getTime()) && d.getTime() >= rangeStartMs && d.getTime() <= rangeEndMs;
  }));
  var configChangeRows = _buildStationConfigRows(entries, stationId);
  var configEventTimes = uniqSortedTimes(configChangeRows.map(function(r) {
    return r && r.ts ? new Date(r.ts) : null;
  }).filter(function(d) {
    return d && !isNaN(d.getTime()) && d.getTime() >= rangeStartMs && d.getTime() <= rangeEndMs;
  }));
  var syncEventTimesBySlot = {};
  slotList.forEach(function(slot) {
    syncEventTimesBySlot[slot.slotNumber] = uniqSortedTimes(syncRows.filter(function(r) {
      return rowMatchesSlot(r, slot);
    }).map(function(r) {
      return r && r.sync_started_at ? new Date(ensureUTC(r.sync_started_at)) : null;
    }).filter(function(d) {
      return d && !isNaN(d.getTime()) && d.getTime() >= rangeStartMs && d.getTime() <= rangeEndMs;
    }));
  });
  // Sample events come from the unified sensor_readings cadence (covers T0 + satellites).
  var sampleEventTimes = uniqSortedTimes(entries.map(function(e) {
    return e && e.timestamp ? e.timestamp : null;
  }).filter(function(d) {
    return d && !isNaN(d.getTime()) && d.getTime() >= rangeStartMs && d.getTime() <= rangeEndMs;
  }));

  var voltDatasets = [
    {
      label: 'Full (4.2V)',
      data: [{ x: firstTs.getTime(), y: FULL_V }, { x: lastTs.getTime(), y: FULL_V }],
      yAxisID: 'y',
      borderColor: '#94a3b8',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      parsing: false,
      tension: 0,
      fill: false,
      _isGuide: true
    },
    {
      label: 'Cutoff (3.3V)',
      data: [{ x: firstTs.getTime(), y: CUTOFF_V }, { x: lastTs.getTime(), y: CUTOFF_V }],
      yAxisID: 'y',
      borderColor: '#ef5350',
      borderWidth: 1,
      borderDash: [6, 4],
      pointRadius: 0,
      parsing: false,
      tension: 0,
      fill: false,
      _isGuide: true
    },
    makeVoltDS(entries, 't0BatV', 'T0', '#60a5fa', false),
    calculatedDataset('T0 Calculated', '#93c5fd', 't0BatPct', 't0', calcAnchorMs, rangeStartMs, rangeEndMs, 't0BatV')
  ];
  slotList.forEach(function(slot) {
    var p = slotPrefix(slot);
    voltDatasets.push(makeVoltDS(entries, p + 'BatV', slot.label, slotColor(slot), true));
    voltDatasets.push(calculatedDataset(slot.label + ' Calculated', slotColor(slot, true), p + 'BatPct', 'te', calcAnchorMs, rangeStartMs, rangeEndMs, p + 'BatV'));
  });
  voltDatasets.push(verticalEventDataset('T0 Upload Events', 'rgba(96,165,250,0.85)', uploadEventTimes, true, [7, 5], 1.6, 'upload'));
  slotList.forEach(function(slot) {
    voltDatasets.push(verticalEventDataset(slot.label + ' Sync Events', slotColor(slot) + 'd9', syncEventTimesBySlot[slot.slotNumber] || [], true, [7, 5], 1.6, 'sync'));
  });
  voltDatasets.push(verticalEventDataset('Config Events', 'rgba(239,68,68,0.85)', configEventTimes, true, [4, 4], 1.6, 'config'));
  // Keep sample events available but placed last and hidden by default.
  voltDatasets.push(verticalEventDataset('Sample Events', 'rgba(109,143,136,0.70)', sampleEventTimes, true, [2, 5], 1.4, 'sample'));

  // Extend Full/Cutoff guide lines to the farthest calculated projection timestamp.
  var projectedEndTs = lastTs.getTime();
  for (var vdi = 0; vdi < voltDatasets.length; vdi++) {
    var vds = voltDatasets[vdi];
    if (!vds || !vds._isCalculated || !Array.isArray(vds.data) || !vds.data.length) continue;
    var lastPt = vds.data[vds.data.length - 1];
    var lastMs = lastPt && lastPt.x instanceof Date ? lastPt.x.getTime() : new Date(lastPt && lastPt.x).getTime();
    if (isFinite(lastMs) && lastMs > projectedEndTs) projectedEndTs = lastMs;
  }
  var projectedEndDate = new Date(projectedEndTs);
  voltDatasets[0].data = [{ x: firstTs.getTime(), y: FULL_V }, { x: projectedEndDate.getTime(), y: FULL_V }];
  voltDatasets[1].data = [{ x: firstTs.getTime(), y: CUTOFF_V }, { x: projectedEndDate.getTime(), y: CUTOFF_V }];

  var opts = chartOpts('Voltage (V)', PLOT_MIN_V, PLOT_MAX_V, range, stationId, rangeStartMs, rangeEndMs);
  var showCalcLegend = false;
  var showEventLegend = false;
  var priorLegendFilter = opts.plugins && opts.plugins.legend && opts.plugins.legend.labels
    ? opts.plugins.legend.labels.filter
    : null;
  if (opts.plugins && opts.plugins.legend && opts.plugins.legend.labels) {
    opts.plugins.legend.labels.filter = function(legendItem, chartData) {
      var ds = chartData && chartData.datasets ? chartData.datasets[legendItem.datasetIndex] : null;
      if (ds && ds._isCalculated && !showCalcLegend) return false;
      if (ds && ds._isEvent && !showEventLegend) return false;
      if (typeof priorLegendFilter === 'function') return priorLegendFilter(legendItem, chartData);
      return true;
    };
  }
  opts.scales.y.ticks = {
    color: '#94a3b8',
    font: { size: 10 },
    stepSize: 0.1,
    callback: function(v) {
      if (v <= PLOT_MIN_V + 0.0001 || v >= PLOT_MAX_V - 0.0001) return '';
      return Number(v).toFixed(1);
    }
  };
  opts.scales.yPct = {
    position: 'right',
    min: PLOT_MIN_PCT,
    max: PLOT_MAX_PCT,
    title: { display: true, text: 'Battery (%)', color: '#64748b', font: { size: 10 } },
    ticks: {
      color: '#94a3b8',
      font: { size: 10 },
      stepSize: 10,
      callback: function(v) {
        if (v <= PLOT_MIN_PCT + 0.0001 || v >= PLOT_MAX_PCT - 0.0001) return '';
        return Number(v).toFixed(0) + '%';
      }
    },
    grid: { drawOnChartArea: false }
  };

  var voltChart = makeLiveChart(voltWrap, voltCanvas, 'Battery Voltage \u2013 ' + rangeLabel(range), {
    type: 'line',
    data: { datasets: voltDatasets },
    options: opts,
  }, { stationId: stationId, chartKey: 'battery_voltage' });

  function fmtDays(n) {
    if (n === null || n === undefined || !isFinite(n)) return '--';
    return Math.max(0, n).toFixed(0);
  }

  function fmtMonths(n) {
    if (n === null || n === undefined || !isFinite(n)) return '--';
    return '(' + (Math.max(0, n) / 30.44).toFixed(1) + ' mo)';
  }

  function lifeSummary(pctKey, useEnvelope, boardKind) {
    var rawPts = pctSeries(entries, pctKey);
    if (!rawPts.length) return { calcDays: null };

    var calcDays = estimateCalculatedDaysToCutoff(pctKey, boardKind, useEnvelope);

    return { calcDays: calcDays };
  }

  function renderCalcDaysCards() {
    var cards = [];

    var t0 = lifeSummary('t0BatPct', false, 't0');
    cards.push({ title: 'T0 Gateway', color: '#60a5fa', calcDays: t0.calcDays });

    slotList.forEach(function(slot) {
      var s = lifeSummary(slotPrefix(slot) + 'BatPct', true, 'te');
      cards.push({ title: slot.label, color: slotColor(slot), calcDays: s.calcDays });
    });

    calcDaysRow.innerHTML = cards.map(function(c) {
      return '<div class="calc-days-card" style="border-top:4px solid ' + c.color + '">' +
        '<div class="calc-days-label">' + c.title + '</div>' +
        '<div class="calc-days-sub">Calculated - <span class="calc-days-value" style="color:' + c.color + '">' + fmtDays(c.calcDays) + '<span class="unit">days</span></span><span class="calc-days-muted">' + fmtMonths(c.calcDays) + '</span></div>' +
      '</div>';
    }).join('');
  }

  renderCalcDaysCards();

  function refreshCalculatedDatasets() {
    if (!voltChart) return;
    for (var i = 0; i < voltChart.data.datasets.length; i++) {
      var ds = voltChart.data.datasets[i];
      if (!ds || !ds._isCalculated) continue;
      ds.data = buildCalculatedPoints(entries, ds._calcPctKey, ds._calcBoardKind, calcAnchorMs, rangeStartMs, rangeEndMs, ds._calcVoltKey);
    }
    voltChart.update('none');
  }

  function setCalcVisibility(show) {
    if (!voltChart) return;
    showCalcLegend = !!show;
    calcDaysRow.style.display = show ? 'flex' : 'none';
    if (show) renderCalcDaysCards();
    for (var i = 0; i < voltChart.data.datasets.length; i++) {
      var ds = voltChart.data.datasets[i];
      if (!ds || !ds._isCalculated) continue;
      ds.hidden = !show;
    }
    btnCalcToggle.textContent = show ? 'Hide Calculated' : 'Show Calculated';
    btnCalcToggle.classList.toggle('active', !!show);
    if (!show) {
      calcHint.textContent = 'Anchor: start of visible range';
    } else {
      calcHint.textContent = 'Anchor: ' + new Date(calcAnchorMs).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC (click chart to re-anchor)';
    }
    voltChart.update('none');
  }

  function setEventVisibility(show) {
    if (!voltChart) return;
    showEventLegend = !!show;
    for (var i = 0; i < voltChart.data.datasets.length; i++) {
      var ds = voltChart.data.datasets[i];
      if (!ds || !ds._isEvent) continue;
      if (!show) {
        ds.hidden = true;
      } else {
        ds.hidden = (ds._eventType === 'sample' || ds._eventType === 'config');
      }
    }
    btnEventToggle.textContent = show ? 'Hide Events' : 'Show Events';
    btnEventToggle.classList.toggle('active', !!show);
    voltChart.update('none');
  }

  function setCalcAnchorFromXMs(xVal) {
    if (xVal == null || !isFinite(xVal)) return;
    var nearestTs = rangeStartMs;
    var nearestDist = Infinity;
    for (var i = 0; i < entries.length; i++) {
      var t = entries[i].timestamp.getTime();
      if (t < rangeStartMs || t > rangeEndMs) continue;
      var d = Math.abs(t - xVal);
      if (d < nearestDist) {
        nearestDist = d;
        nearestTs = t;
      }
    }

    calcAnchorMs = nearestTs;
    refreshCalculatedDatasets();
    renderCalcDaysCards();
    setCalcVisibility(true);
    calcHint.textContent = 'Anchor: ' + new Date(calcAnchorMs).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC (click chart to re-anchor)';
  }

  btnCalcToggle.addEventListener('click', function() {
    var anyShown = false;
    for (var i = 0; i < voltChart.data.datasets.length; i++) {
      var ds = voltChart.data.datasets[i];
      if (ds && ds._isCalculated && ds.hidden !== true) { anyShown = true; break; }
    }
    if (!anyShown) refreshCalculatedDatasets();
    setCalcVisibility(!anyShown);
  });

  btnEventToggle.addEventListener('click', function() {
    setEventVisibility(!showEventLegend);
  });

  // Expose calculated-controls so expanded modal can reuse the exact same logic.
  voltCanvas._calcController = {
    isCalculatedVisible: function() { return !!showCalcLegend; },
    setCalculatedVisible: function(show) { setCalcVisibility(!!show); },
    setAnchorFromXMs: function(xVal) { setCalcAnchorFromXMs(xVal); }
  };

  voltCanvas.addEventListener('click', function(ev) {
    if (!showCalcLegend || !voltChart || !voltChart.scales || !voltChart.scales.x) return;
    var rect = voltCanvas.getBoundingClientRect();
    var px = ev.clientX - rect.left;
    var xVal = voltChart.scales.x.getValueForPixel(px);
    setCalcAnchorFromXMs(xVal);
  });
}

function renderSolarChart(container, entries, stationId, range) {
  if (!entries || !entries.length) return;

  var solarPoints = entries
    .filter(function(e) {
        return e.t0SolarV !== null && e.t0SolarV !== undefined && isFinite(e.t0SolarV) && Number(e.t0SolarV) >= 0;
    })
    .map(function(e) {
      return { x: e.timestamp, y: Number(e.t0SolarV) };
    });

  var box = document.createElement('div');
  box.className = 'chart-box';
  box.innerHTML = '<h4>Solar Voltage (' + rangeLabel(range) + ')</h4>';

  var canvas = document.createElement('canvas');
  box.appendChild(canvas);
  container.appendChild(box);

  var rangeStartMs = entries[0].timestamp.getTime();
  var rangeEndMs = entries[entries.length - 1].timestamp.getTime();
  var maxSolar = solarPoints.reduce(function(maxV, pt) {
    return Math.max(maxV, pt.y);
  }, 0);
  var solarYMax = Math.max(6.5, Math.ceil((maxSolar + 0.25) * 2) / 2);

  makeLiveChart(box, canvas, 'Solar Voltage – ' + rangeLabel(range), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Solar',
        data: memoizeHealthSeries('health:' + stationId + ':solar:' + range + ':t0SolarV', solarPoints),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        spanGaps: false,
        fill: false
      }]
    },
    options: chartOpts('Voltage (V)', 0, solarYMax, range, stationId, rangeStartMs, rangeEndMs)
  }, { stationId: stationId, chartKey: 'solar_voltage' });
}


// ============================================================
// SYNC DRIFT & RSSI CHARTS
// ============================================================
