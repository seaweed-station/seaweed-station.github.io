"use strict";

(function(global) {
  var RANGE_LABELS = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
    all: 'All',
    custom: 'Custom'
  };

  var POINT_BUDGETS = {
    default: { day: 288, week: 504, month: 900, all: 1600, custom: 1600 },
    'station-sensor': { day: 288, week: 504, month: 900, all: 1600, custom: 1600 },
    'station-weather-line': { day: 288, week: 504, month: 900, all: 1600, custom: 1600 },
    'station-weather-bar': { day: 288, week: 504, month: 720, all: 960, custom: 960 },
    'health-series': { day: 240, week: 420, month: 700, all: 1200, custom: 1200 },
    'modal-series': { day: 480, week: 900, month: 1400, all: 2200, custom: 2200 }
  };
  var SERIES_CACHE = new Map();

  function normalizeRange(range) {
    return RANGE_LABELS[range] ? range : 'all';
  }

  function rangeLabel(range) {
    return RANGE_LABELS[normalizeRange(range)] || 'All';
  }

  function inferRangeFromSpanMs(spanMs) {
    if (!isFinite(spanMs) || spanMs <= 0) return 'all';
    var spanDays = spanMs / 86400000;
    if (spanDays <= 1.5) return 'day';
    if (spanDays <= 10) return 'week';
    if (spanDays <= 45) return 'month';
    return 'all';
  }

  function getWindowForRange(bounds, range, options) {
    options = options || {};
    if (!bounds || !isFinite(bounds.min) || !isFinite(bounds.max)) {
      return { min: undefined, max: undefined };
    }

    range = normalizeRange(range);
    if (range === 'all' || range === 'custom') {
      return { min: bounds.min, max: bounds.max };
    }

    var spanDays = 30;
    if (range === 'day') spanDays = 1;
    else if (range === 'week') spanDays = 7;
    else if (range === 'month') spanDays = 30;

    var spanMs = spanDays * 86400000;
    var end = isFinite(options.endMs) ? options.endMs : bounds.max;
    end = Math.max(bounds.min, Math.min(bounds.max, end));
    var start = Math.max(bounds.min, end - spanMs);
    return { min: start, max: end };
  }

  function resolveMaxPoints(kind, range, dataLength, override) {
    if (isFinite(override) && override > 0) return Math.round(override);
    kind = POINT_BUDGETS[kind] ? kind : 'default';
    range = normalizeRange(range);
    var budget = POINT_BUDGETS[kind][range] || POINT_BUDGETS.default[range] || POINT_BUDGETS.default.all;
    if (isFinite(dataLength) && dataLength > 0) return Math.min(Math.round(dataLength), budget);
    return budget;
  }

  function lttbDownsample(data, maxPts) {
    if (!data || data.length <= 2) return data || [];
    if (!isFinite(maxPts) || maxPts <= 2 || data.length <= maxPts) return data;

    var len = data.length;
    var sampled = [data[0]];
    var bucketSize = (len - 2) / (maxPts - 2);
    var a = 0;

    for (var i = 0; i < maxPts - 2; i++) {
      var bStart = Math.floor((i + 1) * bucketSize) + 1;
      var bEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);
      var avgX = 0;
      var avgY = 0;
      var bNextStart = bEnd;
      var bNextEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, len - 1);

      if (i < maxPts - 3) {
        for (var n = bNextStart; n < bNextEnd; n++) {
          avgX += (data[n].x instanceof Date ? data[n].x.getTime() : data[n].x);
          avgY += data[n].y;
        }
        avgX /= (bNextEnd - bNextStart) || 1;
        avgY /= (bNextEnd - bNextStart) || 1;
      } else {
        avgX = (data[len - 1].x instanceof Date ? data[len - 1].x.getTime() : data[len - 1].x);
        avgY = data[len - 1].y;
      }

      var maxArea = -1;
      var maxIdx = bStart;
      var ax = data[a].x instanceof Date ? data[a].x.getTime() : data[a].x;
      var ay = data[a].y;

      for (var j = bStart; j < bEnd; j++) {
        var jx = data[j].x instanceof Date ? data[j].x.getTime() : data[j].x;
        var area = Math.abs((ax - avgX) * (data[j].y - ay) - (ax - jx) * (avgY - ay));
        if (area > maxArea) {
          maxArea = area;
          maxIdx = j;
        }
      }

      sampled.push(data[maxIdx]);
      a = maxIdx;
    }

    sampled.push(data[len - 1]);
    return sampled;
  }

  function pointToMs(pointLike) {
    if (pointLike == null) return NaN;
    if (pointLike instanceof Date) return pointLike.getTime();
    if (typeof pointLike === 'number') return isFinite(pointLike) ? pointLike : NaN;
    if (typeof pointLike === 'string') {
      var d = new Date(pointLike);
      return isNaN(d.getTime()) ? NaN : d.getTime();
    }
    if (typeof pointLike === 'object') {
      if (pointLike.timestamp instanceof Date) return pointLike.timestamp.getTime();
      if (pointLike.timestamp != null) {
        var dt = new Date(pointLike.timestamp);
        if (!isNaN(dt.getTime())) return dt.getTime();
      }
      if (pointLike.x instanceof Date) return pointLike.x.getTime();
      if (pointLike.x != null) {
        var dx = new Date(pointLike.x);
        if (!isNaN(dx.getTime())) return dx.getTime();
      }
    }
    return NaN;
  }

  function buildSequenceSignature(items) {
    if (!Array.isArray(items) || !items.length) return '0';
    var firstMs = pointToMs(items[0]);
    var lastMs = pointToMs(items[items.length - 1]);
    return [items.length, isFinite(firstMs) ? firstMs : 'na', isFinite(lastMs) ? lastMs : 'na'].join('|');
  }

  function memoizeSeries(cacheKey, signature, builder) {
    if (!cacheKey || typeof builder !== 'function') return builder();
    var entry = SERIES_CACHE.get(cacheKey);
    if (entry && entry.signature === signature) return entry.value;
    var value = builder();
    SERIES_CACHE.set(cacheKey, { signature: signature, value: value, touchedAt: Date.now() });
    return value;
  }

  function clearSeriesCache(prefix) {
    if (!prefix) {
      SERIES_CACHE.clear();
      return;
    }
    SERIES_CACHE.forEach(function(_, key) {
      if (String(key).indexOf(prefix) === 0) SERIES_CACHE.delete(key);
    });
  }

  global.PlotCore = {
    buildSequenceSignature: buildSequenceSignature,
    clearSeriesCache: clearSeriesCache,
    inferRangeFromSpanMs: inferRangeFromSpanMs,
    getWindowForRange: getWindowForRange,
    lttbDownsample: lttbDownsample,
    memoizeSeries: memoizeSeries,
    normalizeRange: normalizeRange,
    pointToMs: pointToMs,
    rangeLabel: rangeLabel,
    resolveMaxPoints: resolveMaxPoints
  };
})(window);