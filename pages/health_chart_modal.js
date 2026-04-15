// health_chart_modal.js — Extracted from station_health.html (Sprint 6)
// Expanded chart modal: open, range controls, toggle calculated/events

function cloneModalVisibilityState() {
  var s = getModalDatasetStats();
  return {
    calculatedVisible: !!s.calculatedVisible,
    eventsVisible: !!s.eventsVisible
  };
}

function bindHealthModalControls() {
  var overlay = document.getElementById('chartModalOverlay');
  if (!overlay || overlay._controlsBound) return;
  overlay._controlsBound = true;

  var modal = overlay.querySelector('.chart-modal');
  if (modal) {
    modal.addEventListener('click', function(ev) {
      ev.stopPropagation();
    });
  }

  var rangeWrap = document.getElementById('chartModalRange');
  if (rangeWrap) {
    rangeWrap.addEventListener('click', function(ev) {
      var btn = ev.target.closest('[data-mrange]');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      setModalRange(btn.getAttribute('data-mrange'));
    });
  }

  var calcBtn = document.getElementById('chartModalCalcBtn');
  if (calcBtn) {
    calcBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleModalCalculated();
    });
  }

  var eventBtn = document.getElementById('chartModalEventBtn');
  if (eventBtn) {
    eventBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleModalEvents();
    });
  }

  var closeBtn = overlay.querySelector('.chart-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeChartModal({ target: closeBtn });
    });
  }
}

function applyModalDatasetVisibilityState(state) {
  if (!_modalChart || !_modalChart.data || !Array.isArray(_modalChart.data.datasets) || !state) return;
  var sets = _modalChart.data.datasets;
  for (var i = 0; i < sets.length; i++) {
    var ds = sets[i];
    if (!ds) continue;
    if (ds._isCalculated) ds.hidden = !state.calculatedVisible;
    if (ds._isEvent) ds.hidden = ds._eventType === 'sample' || ds._eventType === 'config' ? true : !state.eventsVisible;
  }
}

function applyModalZoomLimits(bounds) {
  if (!_modalChart || !_modalChart.options || !bounds || !isFinite(bounds.min) || !isFinite(bounds.max)) return;
  _modalChart.options.plugins = _modalChart.options.plugins || {};
  _modalChart.options.plugins.zoom = _modalChart.options.plugins.zoom || {};
  _modalChart.options.plugins.zoom.limits = _modalChart.options.plugins.zoom.limits || {};
  _modalChart.options.plugins.zoom.limits.x = { min: bounds.min, max: bounds.max, minRange: 60 * 60 * 1000 };
}

function getModalSourceSnapshot(range) {
  if (!_modalSource) return null;
  var stationId = _modalSource.stationId;
  var chartKey = _modalSource.chartKey;
  var snapshotRange = range || _modalSource.dataRange || _modalSource.modalRange || 'week';
  if (stationId && chartKey && typeof getChartSnapshotForRange === 'function') {
    var snap = getChartSnapshotForRange(stationId, chartKey, snapshotRange);
    if (snap && snap.data) return snap;
  }
  var sourceCanvas = _modalSource.sourceCanvas || findStationChartCanvas(stationId, chartKey);
  var sourceChart = sourceCanvas ? Chart.getChart(sourceCanvas) : null;
  if (!sourceChart) return null;
  return {
    type: sourceChart.config.type,
    data: cloneChartDataForModal(sourceChart.data),
    options: sourceChart.options
  };
}

function getModalSnapshotForRange(range) {
  return getModalSourceSnapshot(range);
}

function buildModalTimeAxis(range) {
  if (range === 'day') {
    return { time: { tooltipFormat: 'dd MMM HH:mm', unit: 'hour', stepSize: 3, displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } }, maxTicks: 9, autoSkip: false };
  }
  if (range === 'week') {
    return { time: { tooltipFormat: 'dd MMM HH:mm', unit: 'day', stepSize: 1, displayFormats: { day: 'dd MMM' } }, maxTicks: 8, autoSkip: false };
  }
  if (range === 'month') {
    return { time: { tooltipFormat: 'dd MMM HH:mm', unit: 'day', stepSize: 1, displayFormats: { day: 'dd MMM' } }, maxTicks: 10, autoSkip: true };
  }
  return { time: { tooltipFormat: 'dd MMM HH:mm', unit: 'day', displayFormats: { day: 'dd MMM' } }, maxTicks: 12, autoSkip: true };
}

function applyModalLineRange(range, observedBounds) {
  if (!_modalChart || !_modalChart.options || !_modalChart.options.scales || !_modalChart.options.scales.x) return;
  var xScale = _modalChart.options.scales.x;
  var axisCfg = buildModalTimeAxis(range);
  var win = getWindowForRange(observedBounds, range);

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

  xScale.type = 'time';
  xScale.time = axisCfg.time;
  xScale.adapters = { date: { zone: 'UTC' } };
  xScale.min = isFinite(win.min) ? win.min : undefined;
  xScale.max = isFinite(win.max) ? win.max : undefined;
  xScale.ticks = xScale.ticks || {};
  xScale.ticks.color = '#64748b';
  xScale.ticks.font = { size: 11 };
  xScale.ticks.maxTicksLimit = axisCfg.maxTicks;
  xScale.ticks.autoSkip = axisCfg.autoSkip;
  xScale.ticks.major = { enabled: range === 'week' || range === 'month' };
  xScale.ticks.callback = function(value) {
    if (range === 'week' || range === 'month') {
      var dayTick = tickDate(value);
      return dayTick ? dayTick.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : this.getLabelForValue(value);
    }
    return this.getLabelForValue(value);
  };
  xScale.grid = xScale.grid || {};
  xScale.grid.color = function(ctx) {
    if (range === 'week') return 'rgba(148, 163, 184, 0.42)';
    if (range !== 'month' || !ctx.tick) return '#d6e3df';
    var d = tickDate(ctx.tick.value);
    if (!d) return '#d6e3df';
    return (d.getUTCDate() === 1 || (d.getUTCDate() % 5) === 0) ? 'rgba(148, 163, 184, 0.42)' : '#d6e3df';
  };
  xScale.grid.lineWidth = function(ctx) {
    if (range === 'week') return 1.1;
    if (range !== 'month' || !ctx.tick) return 1;
    var d = tickDate(ctx.tick.value);
    if (!d) return 1;
    return (d.getUTCDate() === 1 || (d.getUTCDate() % 5) === 0) ? 1.1 : 1;
  };
}

function openChartModal(title, srcCanvas) {
  bindHealthModalControls();
  var srcChart = Chart.getChart(srcCanvas);
  if (!srcChart) return;
  var stationId = srcCanvas._stationId || null;
  var chartKey = srcCanvas._chartKey || null;
  var activeRange = stationId ? (stationRanges[stationId] || 'week') : 'week';
  var snapshotRange = srcChart.config && srcChart.config.type === 'bar' ? activeRange : 'all';
  var rangeSnap = stationId && chartKey ? getChartSnapshotForRange(stationId, chartKey, snapshotRange) : null;
  var modalType = rangeSnap && rangeSnap.type ? rangeSnap.type : srcChart.config.type;
  var modalData = rangeSnap && rangeSnap.data ? rangeSnap.data : cloneChartDataForModal(srcChart.data);
  var observedBounds = getObservedBoundsFromData(modalData);
  var allBounds = getAllBoundsFromData(modalData) || observedBounds;
  var liveSourceCanvas = findStationChartCanvas(stationId, chartKey) || srcCanvas;
  _modalSource = {
    stationId: stationId,
    chartKey: chartKey,
    sourceCanvas: liveSourceCanvas,
    dataRange: snapshotRange,
    pageRange: activeRange,
    modalRange: activeRange,
    observedBounds: observedBounds,
    allBounds: allBounds
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
        var axisCfg = buildModalTimeAxis(mRange);
        var mAdapters = { date: { zone: 'UTC' } };
        var mWin = getWindowForRange(observedBounds, activeRange);
        var mMin = mWin.min;
        var mMax = mWin.max;
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
          x: { type: 'time', time: axisCfg.time, adapters: mAdapters,
               min: (isFinite(mMin) ? mMin : undefined),
               max: (isFinite(mMax) ? mMax : undefined),
               ticks: {
                 color: '#64748b',
                 font: { size: 11 },
                 maxTicksLimit: axisCfg.maxTicks,
                 autoSkip: axisCfg.autoSkip,
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
  applyModalZoomLimits(_modalSource.allBounds || _modalSource.observedBounds);
  updateModalToggleControls();
}

function syncModalDataFromSource() {
  if (!_modalChart || !_modalSource) return;
  var liveCanvas = findStationChartCanvas(_modalSource.stationId, _modalSource.chartKey) || _modalSource.sourceCanvas;
  if (liveCanvas) _modalSource.sourceCanvas = liveCanvas;
  var visibilityState = cloneModalVisibilityState();
  var snap = getModalSourceSnapshot((_modalSource && _modalSource.dataRange) || (_modalSource && _modalSource.modalRange) || 'week');
  if (!snap || !snap.data) return;
  var xOpts = _modalChart.options && _modalChart.options.scales ? _modalChart.options.scales.x : null;
  var curMin = xOpts ? xOpts.min : undefined;
  var curMax = xOpts ? xOpts.max : undefined;
  _modalChart.config.type = snap.type || _modalChart.config.type;
  _modalChart.data = cloneChartDataForModal(snap.data);
  _modalSource.observedBounds = getObservedBoundsFromData(_modalChart.data);
  _modalSource.allBounds = getAllBoundsFromData(_modalChart.data) || _modalSource.observedBounds;
  applyModalDatasetVisibilityState(visibilityState);
  applyModalZoomLimits(_modalSource.allBounds || _modalSource.observedBounds);
  if (xOpts) {
    applyModalLineRange((_modalSource && _modalSource.modalRange) || 'week', _modalSource.observedBounds);
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
  var isLineModal = _modalChart.config && _modalChart.config.type !== 'bar';

  if (range === 'all' && typeof healthDataCanServeRange === 'function' && !healthDataCanServeRange('all')) {
    try {
      if (typeof ensureHealthRangeLoaded === 'function') {
        await ensureHealthRangeLoaded('all');
      }
    } catch (e) {
      console.warn('[Health] Modal all-range fetch failed:', e && e.message ? e.message : e);
    }
  }

  if (isLineModal && (_modalSource.dataRange === 'all')) {
    if (range === 'all') {
      syncModalDataFromSource();
    }
    applyModalLineRange(range, _modalSource.observedBounds);
    applyModalZoomLimits(_modalSource.allBounds || _modalSource.observedBounds);
    _modalChart.update('none');
    updateModalRangeControls();
    updateModalToggleControls();
    return;
  }

  var stationId = _modalSource.stationId;
  var chartKey = _modalSource.chartKey;
  var title = document.getElementById('chartModalTitle').textContent || '';
  var visibilityState = cloneModalVisibilityState();

  if (stationId && typeof setStationRange === 'function') {
    setStationRange(stationId, range, { skipEnsure: true, skipRawEnsure: true });
  }

  var liveCanvas = (stationId && chartKey) ? findStationChartCanvas(stationId, chartKey) : null;
  if (!liveCanvas) liveCanvas = _modalSource.sourceCanvas;
  if (!liveCanvas) return;

  openChartModal(title, liveCanvas);
  if (_modalSource) _modalSource.modalRange = range;
  applyModalDatasetVisibilityState(visibilityState);
  if (_modalChart) _modalChart.update('none');
  updateModalRangeControls();
  updateModalToggleControls();
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
  bindHealthModalControls();
  var modalCanvasEl = document.getElementById('chartModalCanvas');
  if (!modalCanvasEl || modalCanvasEl._reanchorBound) return;
  modalCanvasEl.addEventListener('click', function(ev) {
    if (!_modalChart || !_modalChart.scales || !_modalChart.scales.x) return;
    if (_modalSource && _modalSource.dataRange === 'all') return;
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
