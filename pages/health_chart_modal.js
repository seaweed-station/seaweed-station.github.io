// health_chart_modal.js — Extracted from station_health.html (Sprint 6)
// Expanded chart modal: open, range controls, toggle calculated/events

function openChartModal(title, srcCanvas) {
  var srcChart = Chart.getChart(srcCanvas);
  if (!srcChart) return;
  var stationId = srcCanvas._stationId || null;
  var chartKey = srcCanvas._chartKey || null;
  var activeRange = stationId ? (stationRanges[stationId] || 'week') : 'week';
  var fullSnap = getChartSnapshotForRange(stationId, chartKey, 'all');
  var modalType = fullSnap && fullSnap.type ? fullSnap.type : srcChart.config.type;
  var modalData = fullSnap && fullSnap.data ? fullSnap.data : cloneChartDataForModal(srcChart.data);
  var observedBounds = getObservedBoundsFromData(modalData);
  var initialWindow = getWindowForRange(observedBounds, activeRange);
  var liveSourceCanvas = findStationChartCanvas(stationId, chartKey) || srcCanvas;
  _modalSource = {
    stationId: stationId,
    chartKey: chartKey,
    sourceCanvas: liveSourceCanvas,
    modalRange: activeRange,
    observedBounds: observedBounds
  };
  updateModalRangeControls();
  document.getElementById('chartModalTitle').textContent = title;
  var overlay = document.getElementById('chartModalOverlay');
  overlay.classList.add('open');
  if (_modalChart) { _modalChart.destroy(); _modalChart = null; }

  var modalCanvas = document.getElementById('chartModalCanvas');
  modalCanvas.removeAttribute('width');
  modalCanvas.removeAttribute('height');

  var isBar = modalType === 'bar';
  var modalLegendFilter = function(legendItem, chartData) {
    var ds = chartData && chartData.datasets ? chartData.datasets[legendItem.datasetIndex] : null;
    if (!defaultLegendDatasetFilter(legendItem, chartData)) return false;
    if (ds && (ds._isCalculated || ds._isEvent) && ds.hidden === true) return false;
    return true;
  };
  var srcScaleY = (srcChart.options.scales || {}).y || {};
  var yTitle = (srcScaleY.title || {}).text || '';
  var yMin   = srcScaleY.min;
  var yMax   = srcScaleY.max;
  var yTickCb = srcScaleY.ticks && typeof srcScaleY.ticks.callback === 'function' ? srcScaleY.ticks.callback : null;

  var modalOpts;
  if (isBar) {
    modalOpts = {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#94a3b8', font: { size: 11 }, filter: modalLegendFilter } },
        zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
                pan:  { enabled: true, mode: 'xy' } }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#64748b' }, grid: { color: '#d6e3df' } },
        y: { stacked: true, ticks: { color: '#64748b' }, grid: { color: '#d6e3df' },
             title: { display: !!yTitle, text: yTitle, color: '#64748b' } }
      }
    };
  } else {
    var yTicks = { color: '#94a3b8', font: { size: 11 } };
    if (yTickCb) yTicks.callback = yTickCb;
    modalOpts = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 14, padding: 10, filter: modalLegendFilter } },
        tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1 },
        zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
                pan:  { enabled: true, mode: 'x' } }
      },
      scales: (function() {
        var mRange = (_modalSource && _modalSource.stationId) ? (stationRanges[_modalSource.stationId] || 'week') : 'week';
        var mxTime, mMaxTicks, mAutoSkip;
        if (mRange === 'day') {
          mxTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'hour', stepSize: 3, displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } };
          mMaxTicks = 9;
          mAutoSkip = false;
        } else if (mRange === 'week') {
          mxTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'day', stepSize: 1, round: 'day', displayFormats: { day: 'dd MMM' } };
          mMaxTicks = 8;
          mAutoSkip = false;
        } else if (mRange === 'month') {
          mxTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'day', stepSize: 1, round: 'day', displayFormats: { day: 'dd MMM' } };
          mMaxTicks = 10;
          mAutoSkip = true;
        } else {
          mxTime = { tooltipFormat: 'dd MMM HH:mm', unit: 'day', displayFormats: { day: 'dd MMM' } };
          mMaxTicks = 12;
          mAutoSkip = true;
        }
        var mAdapters = { date: { zone: 'UTC' } };
        var mMin = initialWindow.min;
        var mMax = initialWindow.max;
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
        return {
          x: { type: 'time', time: mxTime, adapters: mAdapters,
               min: (isFinite(mMin) ? mMin : undefined),
               max: (isFinite(mMax) ? mMax : undefined),
               ticks: {
                 color: '#64748b',
                 font: { size: 11 },
                 maxTicksLimit: mMaxTicks,
                 autoSkip: mAutoSkip,
                 major: { enabled: mRange === 'week' || mRange === 'month' },
                 callback: function(value, index, ticks) {
                   if (mRange === 'week') {
                     var dayTick = tickDate(value);
                     return dayTick ? dayTick.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : this.getLabelForValue(value);
                   }
                   if (mRange === 'month') {
                     var monthTick = tickDate(value);
                     return monthTick ? monthTick.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : this.getLabelForValue(value);
                   }
                   return this.getLabelForValue(value);
                 }
               },
               grid: {
                 color: function(ctx) {
                   if (mRange === 'week') return 'rgba(148, 163, 184, 0.42)';
                   if (mRange !== 'month' || !ctx.tick) return '#d6e3df';
                   var d = tickDate(ctx.tick.value);
                   if (!d) return '#d6e3df';
                   return (d.getUTCDate() === 1 || (d.getUTCDate() % 5) === 0) ? 'rgba(148, 163, 184, 0.42)' : '#d6e3df';
                 },
                 lineWidth: function(ctx) {
                   if (mRange === 'week') return 1.1;
                   if (mRange !== 'month' || !ctx.tick) return 1;
                   var d = tickDate(ctx.tick.value);
                   if (!d) return 1;
                   return (d.getUTCDate() === 1 || (d.getUTCDate() % 5) === 0) ? 1.1 : 1;
                 }
               } },
          y: { title: { display: !!yTitle, text: yTitle, color: '#64748b', font: { size: 11 } },
               min: (yMin !== undefined && yMin !== null) ? yMin : undefined,
               max: (yMax !== undefined && yMax !== null) ? yMax : undefined,
               ticks: yTicks, grid: { color: '#d6e3df' } }
        };
      })()
    };
  }

  _modalChart = new Chart(modalCanvas, {
    type: modalType,
    data: modalData,
    options: modalOpts
  });
  updateModalToggleControls();
}

function syncModalDataFromSource() {
  if (!_modalChart || !_modalSource) return;
  var liveCanvas = findStationChartCanvas(_modalSource.stationId, _modalSource.chartKey) || _modalSource.sourceCanvas;
  if (!liveCanvas) return;
  _modalSource.sourceCanvas = liveCanvas;
  var srcChart = Chart.getChart(liveCanvas);
  if (!srcChart) return;
  var xOpts = _modalChart.options && _modalChart.options.scales ? _modalChart.options.scales.x : null;
  var curMin = xOpts ? xOpts.min : undefined;
  var curMax = xOpts ? xOpts.max : undefined;
  _modalChart.data = cloneChartDataForModal(srcChart.data);
  _modalSource.observedBounds = getObservedBoundsFromData(_modalChart.data);
  if (xOpts) {
    xOpts.min = curMin;
    xOpts.max = curMax;
  }
  _modalChart.update('none');
  updateModalToggleControls();
}

function updateModalRangeControls() {
  var wrap = document.getElementById('chartModalRange');
  if (!wrap) return;
  var stationId = _modalSource && _modalSource.stationId;
  if (!stationId) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  var activeRange = (_modalSource && _modalSource.modalRange) || (stationRanges[stationId] || 'week');
  var btns = wrap.querySelectorAll('[data-mrange]');
  btns.forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-mrange') === activeRange);
  });
}

function getModalDatasetStats() {
  var out = {
    hasCalculated: false,
    hasEvents: false,
    calculatedVisible: false,
    eventsVisible: false
  };
  if (!_modalChart || !_modalChart.data || !Array.isArray(_modalChart.data.datasets)) return out;
  var sets = _modalChart.data.datasets;
  for (var i = 0; i < sets.length; i++) {
    var ds = sets[i] || {};
    if (ds._isCalculated) {
      out.hasCalculated = true;
      if (ds.hidden !== true) out.calculatedVisible = true;
    }
    if (ds._isEvent) {
      out.hasEvents = true;
      if (ds._eventType !== 'sample' && ds._eventType !== 'config' && ds.hidden !== true) out.eventsVisible = true;
    }
  }
  return out;
}

function updateModalToggleControls() {
  var wrap = document.getElementById('chartModalToggles');
  var calcBtn = document.getElementById('chartModalCalcBtn');
  var eventBtn = document.getElementById('chartModalEventBtn');
  if (!wrap || !calcBtn || !eventBtn) return;
  if (!_modalChart) {
    wrap.style.display = 'none';
    return;
  }
  var s = getModalDatasetStats();
  var showWrap = s.hasCalculated || s.hasEvents;
  wrap.style.display = showWrap ? 'flex' : 'none';

  calcBtn.style.display = s.hasCalculated ? '' : 'none';
  calcBtn.classList.toggle('active', s.calculatedVisible);
  calcBtn.textContent = s.calculatedVisible ? 'Hide Calculated' : 'Show Calculated';

  eventBtn.style.display = s.hasEvents ? '' : 'none';
  eventBtn.classList.toggle('active', s.eventsVisible);
  eventBtn.textContent = s.eventsVisible ? 'Hide Events' : 'Show Events';
}

function setModalCalculatedVisibility(show) {
  if (!_modalChart || !_modalChart.data || !Array.isArray(_modalChart.data.datasets)) return;
  var sets = _modalChart.data.datasets;
  for (var i = 0; i < sets.length; i++) {
    if (sets[i] && sets[i]._isCalculated) sets[i].hidden = !show;
  }
  _modalChart.update('none');
  updateModalToggleControls();
}

function setModalEventVisibility(show) {
  if (!_modalChart || !_modalChart.data || !Array.isArray(_modalChart.data.datasets)) return;
  var sets = _modalChart.data.datasets;
  for (var i = 0; i < sets.length; i++) {
    var ds = sets[i];
    if (!ds || !ds._isEvent) continue;
    if (!show) ds.hidden = true;
    else ds.hidden = (ds._eventType === 'sample' || ds._eventType === 'config');
  }
  _modalChart.update('none');
  updateModalToggleControls();
}

function toggleModalCalculated() {
  var s = getModalDatasetStats();
  if (!s.hasCalculated) return;
  var targetShow = !s.calculatedVisible;
  var liveCanvas = _modalSource ? (findStationChartCanvas(_modalSource.stationId, _modalSource.chartKey) || _modalSource.sourceCanvas) : null;
  if (_modalSource && liveCanvas) _modalSource.sourceCanvas = liveCanvas;
  var ctrl = liveCanvas ? liveCanvas._calcController : null;
  if (ctrl && typeof ctrl.setCalculatedVisible === 'function') {
    ctrl.setCalculatedVisible(targetShow);
    syncModalDataFromSource();
    var after = getModalDatasetStats();
    if (!!after.calculatedVisible !== !!targetShow) {
      setModalCalculatedVisibility(targetShow);
    }
    return;
  }
  setModalCalculatedVisibility(targetShow);
}

function toggleModalEvents() {
  var s = getModalDatasetStats();
  if (!s.hasEvents) return;
  setModalEventVisibility(!s.eventsVisible);
}

function findStationChartCanvas(stationId, chartKey) {
  if (!stationId || !chartKey) return null;
  var body = document.getElementById('body_' + stationId);
  if (!body) return null;
  var canvases = body.querySelectorAll('canvas');
  for (var i = 0; i < canvases.length; i++) {
    if (canvases[i]._stationId === stationId && canvases[i]._chartKey === chartKey) return canvases[i];
  }
  return null;
}

async function setModalRange(range) {
  if (!_modalSource || !_modalChart) return;
  _modalSource.modalRange = range;
  if (range === 'all' && typeof healthDataCanServeRange === 'function' && !healthDataCanServeRange('all')) {
    try {
      if (typeof ensureHealthRangeLoaded === 'function') {
        await ensureHealthRangeLoaded('all');
        syncModalDataFromSource();
      }
    } catch (e) {
      console.warn('[Health] Modal all-range fetch failed:', e && e.message ? e.message : e);
    }
  }
  var win = getWindowForRange(_modalSource.observedBounds, range);
  if (_modalChart.options && _modalChart.options.scales && _modalChart.options.scales.x) {
    _modalChart.options.scales.x.min = win.min;
    _modalChart.options.scales.x.max = win.max;
  }
  _modalChart.update('none');
  updateModalRangeControls();
}

function closeChartModal(evt) {
  if (evt && evt.target.id !== 'chartModalOverlay' && !evt.target.classList.contains('chart-modal-close')) return;
  document.getElementById('chartModalOverlay').classList.remove('open');
  if (_modalChart) { _modalChart.destroy(); _modalChart = null; }
  _modalSource = null;
  updateModalRangeControls();
  updateModalToggleControls();
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeChartModal();
});

function bindModalCanvasReanchor() {
  var modalCanvasEl = document.getElementById('chartModalCanvas');
  if (!modalCanvasEl || modalCanvasEl._reanchorBound) return;
  modalCanvasEl.addEventListener('click', function(ev) {
    if (!_modalChart || !_modalChart.scales || !_modalChart.scales.x) return;
    var liveCanvas = _modalSource ? (findStationChartCanvas(_modalSource.stationId, _modalSource.chartKey) || _modalSource.sourceCanvas) : null;
    if (_modalSource && liveCanvas) _modalSource.sourceCanvas = liveCanvas;
    var ctrl = liveCanvas ? liveCanvas._calcController : null;
    if (!ctrl || typeof ctrl.isCalculatedVisible !== 'function' || !ctrl.isCalculatedVisible()) return;
    var rect = ev.target.getBoundingClientRect();
    var px = ev.clientX - rect.left;
    var xVal = _modalChart.scales.x.getValueForPixel(px);
    if (xVal == null || !isFinite(xVal) || typeof ctrl.setAnchorFromXMs !== 'function') return;
    ctrl.setAnchorFromXMs(xVal);
    syncModalDataFromSource();
  });
  modalCanvasEl._reanchorBound = true;
}

// ============================================================
// DAILY HEALTH SUMMARY TABLE
// ============================================================
