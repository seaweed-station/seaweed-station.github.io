"use strict";

(function(global) {
  var overlays = {};

  function resolveValue(chart, value, fallback) {
    if (typeof value === 'function') {
      try { return value(chart); } catch (_) { return fallback; }
    }
    return value !== undefined ? value : fallback;
  }

  function toMs(value) {
    return global.PlotCore && typeof PlotCore.pointToMs === 'function'
      ? PlotCore.pointToMs(value)
      : NaN;
  }

  function getEntries(chart, opts) {
    if (chart && Array.isArray(chart.$plotOverlayEntries)) return chart.$plotOverlayEntries;
    return opts && Array.isArray(opts.entries) ? opts.entries : [];
  }

  function clipToChartArea(chart, fn) {
    var xScale = chart && chart.scales ? chart.scales.x : null;
    var yScale = chart && chart.scales ? chart.scales.y : null;
    if (!xScale || !yScale) return;
    var ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(xScale.left, yScale.top, xScale.right - xScale.left, yScale.bottom - yScale.top);
    ctx.clip();
    fn(ctx, xScale, yScale);
    ctx.restore();
  }

  function normalizeWindows(chart, options) {
    var raw = resolveValue(chart, options.getWindows || options.windows, []);
    if (!Array.isArray(raw)) return [];
    return raw.map(function(win) {
      var start = toMs(win && (win.start || win.from || win.min));
      var end = toMs(win && (win.end || win.to || win.max));
      if (!isFinite(start) || !isFinite(end) || end <= start) return null;
      return { start: start, end: end };
    }).filter(Boolean);
  }

  function normalizeEvents(chart, options) {
    var raw = resolveValue(chart, options.getEvents || options.events, []);
    if (!Array.isArray(raw)) return [];
    return raw.map(function(evt) {
      if (evt && evt.rise != null && evt.set != null) {
        var rise = toMs(evt.rise);
        var set = toMs(evt.set);
        if (isFinite(rise) && isFinite(set) && set > rise) return { rise: rise, set: set };
      }
      if (evt && evt.date != null) {
        var when = toMs(evt.date);
        if (isFinite(when)) return { date: when, label: evt.label || '', emoji: evt.emoji || '' };
      }
      return null;
    }).filter(Boolean);
  }

  function groupWindows(windows, gapMs) {
    if (!Array.isArray(windows) || !windows.length || !isFinite(gapMs) || gapMs < 0) return windows || [];
    var grouped = [windows[0]];
    for (var i = 1; i < windows.length; i++) {
      var prev = grouped[grouped.length - 1];
      var next = windows[i];
      if ((next.start - prev.end) <= gapMs) prev.end = Math.max(prev.end, next.end);
      else grouped.push({ start: next.start, end: next.end });
    }
    return grouped;
  }

  function register(id, def) {
    overlays[id] = def;
  }

  var managerPlugin = {
    id: 'plotOverlayManager',
    beforeDraw: function(chart, args, opts) {
      var entries = getEntries(chart, opts);
      for (var i = 0; i < entries.length; i++) {
        var def = overlays[entries[i].id];
        if (def && typeof def.beforeDraw === 'function') def.beforeDraw(chart, entries[i].options || {}, args);
      }
    },
    afterDatasetsDraw: function(chart, args, opts) {
      var entries = getEntries(chart, opts);
      for (var i = 0; i < entries.length; i++) {
        var def = overlays[entries[i].id];
        if (def && typeof def.afterDatasetsDraw === 'function') def.afterDatasetsDraw(chart, entries[i].options || {}, args);
      }
    },
    afterDraw: function(chart, args, opts) {
      var entries = getEntries(chart, opts);
      for (var i = 0; i < entries.length; i++) {
        var def = overlays[entries[i].id];
        if (def && typeof def.afterDraw === 'function') def.afterDraw(chart, entries[i].options || {}, args);
      }
    }
  };

  function normalizeEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map(function(entry) {
      if (!entry || !entry.id) return null;
      return { id: entry.id, options: entry.options || {} };
    }).filter(Boolean);
  }

  function decorateOptions(options, entries) {
    options = options || {};
    options.plugins = options.plugins || {};
    options.plugins.plotOverlayManager = { entries: normalizeEntries(entries) };
    return options;
  }

  function decoratePlugins(plugins, entries) {
    var list = Array.isArray(plugins) ? plugins.slice() : [];
    if (normalizeEntries(entries).length && !list.some(function(plugin) { return plugin && plugin.id === managerPlugin.id; })) {
      list.push(managerPlugin);
    }
    return list;
  }

  function attach(chart, entries) {
    if (!chart) return;
    chart.$plotOverlayEntries = normalizeEntries(entries);
  }

  register('sun-events', {
    beforeDraw: function(chart, options) {
      if (resolveValue(chart, options.enabled, true) === false) return;
      var events = normalizeEvents(chart, options);
      if (!events.length) return;
      clipToChartArea(chart, function(ctx, xScale, yScale) {
        var minX = xScale.min;
        var maxX = xScale.max;
        ctx.fillStyle = resolveValue(chart, options.fillColor, 'rgba(0, 0, 0, 0.12)');
        if (events[0].rise > minX) {
          var x1 = Math.max(xScale.left, xScale.getPixelForValue(minX));
          var x2 = Math.min(xScale.right, xScale.getPixelForValue(events[0].rise));
          if (x2 > x1) ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
        }
        for (var i = 0; i < events.length; i++) {
          var setPx = Math.max(xScale.left, xScale.getPixelForValue(events[i].set));
          var nextRise = (i + 1 < events.length) ? events[i + 1].rise : maxX + 86400000;
          var risePx = Math.min(xScale.right, xScale.getPixelForValue(Math.min(nextRise, maxX)));
          if (risePx > setPx) ctx.fillRect(setPx, yScale.top, risePx - setPx, yScale.bottom - yScale.top);
        }
        for (var j = 0; j < events.length; j++) {
          var risePx2 = xScale.getPixelForValue(events[j].rise);
          if (risePx2 >= xScale.left && risePx2 <= xScale.right) {
            ctx.strokeStyle = resolveValue(chart, options.sunriseLineColor, 'rgba(251,191,36,0.45)');
            ctx.lineWidth = resolveValue(chart, options.lineWidth, 1);
            ctx.setLineDash(resolveValue(chart, options.lineDash, [4, 4]));
            ctx.beginPath(); ctx.moveTo(risePx2, yScale.top); ctx.lineTo(risePx2, yScale.bottom); ctx.stroke();
          }
          var setPx2 = xScale.getPixelForValue(events[j].set);
          if (setPx2 >= xScale.left && setPx2 <= xScale.right) {
            ctx.strokeStyle = resolveValue(chart, options.sunsetLineColor, 'rgba(251,146,60,0.45)');
            ctx.lineWidth = resolveValue(chart, options.lineWidth, 1);
            ctx.setLineDash(resolveValue(chart, options.lineDash, [4, 4]));
            ctx.beginPath(); ctx.moveTo(setPx2, yScale.top); ctx.lineTo(setPx2, yScale.bottom); ctx.stroke();
          }
        }
        ctx.setLineDash([]);
      });
    }
  });

  register('harvest-bands', {
    beforeDraw: function(chart, options) {
      if (resolveValue(chart, options.enabled, true) === false) return;
      var windows = groupWindows(normalizeWindows(chart, options), resolveValue(chart, options.groupGapMs, NaN));
      if (!windows.length) return;
      clipToChartArea(chart, function(ctx, xScale, yScale) {
        var thresholdValue = resolveValue(chart, options.thresholdValue, null);
        var bandTop = yScale.top;
        if (thresholdValue !== null && thresholdValue !== undefined && isFinite(Number(thresholdValue))) {
          bandTop = Math.max(yScale.top, Math.min(yScale.getPixelForValue(Number(thresholdValue)), yScale.bottom));
        }
        for (var i = 0; i < windows.length; i++) {
          var x1 = Math.max(xScale.left, xScale.getPixelForValue(windows[i].start));
          var x2 = Math.min(xScale.right, xScale.getPixelForValue(windows[i].end));
          if (x2 <= x1) continue;
          if (thresholdValue !== null && thresholdValue !== undefined && isFinite(Number(thresholdValue))) {
            ctx.fillStyle = resolveValue(chart, options.fillTopColor, 'rgba(34, 197, 94, 0.09)');
            ctx.fillRect(x1, yScale.top, x2 - x1, Math.max(0, bandTop - yScale.top));
            ctx.fillStyle = resolveValue(chart, options.fillBottomColor, 'rgba(22, 163, 74, 0.22)');
            ctx.fillRect(x1, bandTop, x2 - x1, yScale.bottom - bandTop);
          } else {
            ctx.fillStyle = resolveValue(chart, options.fillColor, 'rgba(34, 197, 94, 0.10)');
            ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
          }
          var borderColor = resolveValue(chart, options.borderColor, null);
          if (borderColor) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = resolveValue(chart, options.borderWidth, 1.25);
            ctx.setLineDash(resolveValue(chart, options.borderDash, [4, 4]));
            ctx.strokeRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.setLineDash([]);
          }
          var label = resolveValue(chart, options.label, '');
          if (label) {
            ctx.fillStyle = resolveValue(chart, options.labelColor, '#15803dcc');
            ctx.font = resolveValue(chart, options.labelFont, 'bold 10px sans-serif');
            ctx.textAlign = 'center';
            ctx.fillText(label, (x1 + x2) / 2, resolveValue(chart, options.labelY, yScale.top + 10));
          }
        }
        if (thresholdValue !== null && thresholdValue !== undefined && isFinite(Number(thresholdValue))) {
          var ty = yScale.getPixelForValue(Number(thresholdValue));
          if (ty >= yScale.top && ty <= yScale.bottom) {
            ctx.strokeStyle = resolveValue(chart, options.thresholdLineColor, '#16a34acc');
            ctx.lineWidth = resolveValue(chart, options.thresholdLineWidth, 1.5);
            ctx.setLineDash(resolveValue(chart, options.thresholdLineDash, [6, 3]));
            ctx.beginPath(); ctx.moveTo(xScale.left, ty); ctx.lineTo(xScale.right, ty); ctx.stroke();
            ctx.setLineDash([]);
            var thresholdLabel = resolveValue(chart, options.thresholdLabel, '');
            if (thresholdLabel) {
              ctx.fillStyle = resolveValue(chart, options.thresholdLabelColor, '#15803dcc');
              ctx.font = resolveValue(chart, options.thresholdLabelFont, 'bold 10px sans-serif');
              ctx.textAlign = 'left';
              ctx.fillText(thresholdLabel, xScale.left + 4, ty - 3);
            }
          }
        }
      });
    }
  });

  register('daily-extrema-labels', {
    afterDatasetsDraw: function(chart, options) {
      if (resolveValue(chart, options.enabled, true) === false) return;
      var xScale = chart.scales.x;
      var yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      var ctx = chart.ctx;
      var dayMax = {};
      var dayMin = {};
      chart.data.datasets.forEach(function(ds, idx) {
        var meta = chart.getDatasetMeta(idx);
        if (!meta || meta.hidden || ds._isCalculated || ds._isEvent || ds._isGuide) return;
        var color = (typeof ds.borderColor === 'string') ? ds.borderColor : '#94a3b8';
        if (/^#[0-9a-fA-F]{8}$/.test(color)) color = color.slice(0, 7);
        var points = Array.isArray(ds._rawData) && ds._rawData.length ? ds._rawData : (Array.isArray(ds.data) ? ds.data : []);
        points.forEach(function(pt) {
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
      ctx.font = resolveValue(chart, options.font, 'bold 9px sans-serif');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      function drawLabel(val, x, y, color, above) {
        var label = (typeof resolveValue(chart, options.formatValue, null) === 'function')
          ? resolveValue(chart, options.formatValue)(val)
          : Number(val).toFixed(1);
        var offsetY = above ? -10 : 10;
        ctx.fillStyle = resolveValue(chart, options.shadowColor, 'rgba(15,23,42,0.65)');
        ctx.fillText(label, x + 1, y + offsetY + 1);
        ctx.fillStyle = color;
        ctx.fillText(label, x, y + offsetY);
      }
      Object.keys(dayMax).forEach(function(key) {
        var item = dayMax[key];
        var px = xScale.getPixelForValue(item.x);
        if (px < xScale.left || px > xScale.right) return;
        drawLabel(item.val, px, yScale.getPixelForValue(item.val), item.color, true);
      });
      Object.keys(dayMin).forEach(function(key) {
        var item = dayMin[key];
        var px = xScale.getPixelForValue(item.x);
        if (px < xScale.left || px > xScale.right) return;
        drawLabel(item.val, px, yScale.getPixelForValue(item.val), item.color, false);
      });
      ctx.restore();
    }
  });

  register('day-labels', {
    afterDraw: function(chart, options) {
      if (resolveValue(chart, options.enabled, true) === false) return;
      var xScale = chart.scales.x;
      var yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      var minX = xScale.min;
      var maxX = xScale.max;
      if ((maxX - minX) < 2 * 86400000) return;
      var ctx = chart.ctx;
      var dayNames = resolveValue(chart, options.dayNames, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
      var events = normalizeEvents(chart, options);
      ctx.save();
      ctx.font = resolveValue(chart, options.font, 'bold 9px sans-serif');
      ctx.fillStyle = resolveValue(chart, options.color, 'rgba(148, 163, 184, 0.85)');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (events.length) {
        for (var i = 0; i < events.length; i++) {
          if (events[i].set < minX || events[i].rise > maxX) continue;
          var midMs = (events[i].rise + events[i].set) / 2;
          var px = xScale.getPixelForValue(midMs);
          if (px < xScale.left || px > xScale.right) continue;
          ctx.fillText(dayNames[new Date(events[i].rise).getDay()], px, yScale.bottom + resolveValue(chart, options.yOffset, 3));
        }
      } else {
        var day = new Date(minX);
        day.setHours(24, 0, 0, 0);
        while (day.getTime() < maxX) {
          var midMs2 = day.getTime();
          var nextDay = new Date(midMs2);
          nextDay.setDate(nextDay.getDate() + 1);
          var px1 = Math.max(xScale.left, xScale.getPixelForValue(midMs2));
          var px2 = Math.min(xScale.right, xScale.getPixelForValue(nextDay.getTime()));
          ctx.fillText(dayNames[day.getDay()], (px1 + px2) / 2, yScale.bottom + resolveValue(chart, options.yOffset, 3));
          day = nextDay;
        }
      }
      ctx.restore();
    }
  });

  register('now-line', {
    beforeDraw: function(chart, options) {
      if (resolveValue(chart, options.enabled, true) === false) return;
      var xScale = chart.scales.x;
      var yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      var nowMs = resolveValue(chart, options.getTimeMs, Date.now());
      if (!isFinite(nowMs)) return;
      var nowPx = xScale.getPixelForValue(nowMs);
      if (nowPx < xScale.left || nowPx > xScale.right) return;
      clipToChartArea(chart, function(ctx) {
        ctx.strokeStyle = resolveValue(chart, options.lineColor, 'rgba(248, 113, 113, 0.8)');
        ctx.lineWidth = resolveValue(chart, options.lineWidth, 1.5);
        ctx.setLineDash(resolveValue(chart, options.lineDash, [4, 3]));
        ctx.beginPath(); ctx.moveTo(nowPx, yScale.top); ctx.lineTo(nowPx, yScale.bottom); ctx.stroke();
        ctx.setLineDash([]);
        var label = resolveValue(chart, options.label, 'NOW');
        if (label) {
          ctx.fillStyle = resolveValue(chart, options.labelColor, 'rgba(248,113,113,0.9)');
          ctx.font = resolveValue(chart, options.font, 'bold 9px sans-serif');
          ctx.textAlign = resolveValue(chart, options.textAlign, 'left');
          ctx.fillText(label, nowPx + resolveValue(chart, options.labelOffsetX, 3), yScale.top + resolveValue(chart, options.labelOffsetY, 10));
        }
      });
    }
  });

  register('moon-markers', {
    beforeDraw: function(chart, options) {
      if (resolveValue(chart, options.enabled, true) === false) return;
      var xScale = chart.scales.x;
      var yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      var events = normalizeEvents(chart, options);
      if (!events.length) return;
      var ctx = chart.ctx;
      ctx.save();
      for (var i = 0; i < events.length; i++) {
        var x = xScale.getPixelForValue(events[i].date);
        if (x < xScale.left || x > xScale.right) continue;
        ctx.strokeStyle = resolveValue(chart, options.lineColor, '#fbbf2466');
        ctx.lineWidth = resolveValue(chart, options.lineWidth, 1);
        ctx.setLineDash(resolveValue(chart, options.lineDash, [2, 4]));
        ctx.beginPath(); ctx.moveTo(x, yScale.top); ctx.lineTo(x, yScale.bottom); ctx.stroke();
        var label = (events[i].emoji ? events[i].emoji + ' ' : '') + (events[i].label || '');
        if (label) {
          ctx.fillStyle = resolveValue(chart, options.labelColor, '#fbbf24');
          ctx.font = resolveValue(chart, options.font, '10px sans-serif');
          ctx.textAlign = 'center';
          ctx.fillText(label, x, yScale.bottom + resolveValue(chart, options.yOffset, 12));
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  });

  global.PlotOverlays = {
    attach: attach,
    decorateOptions: decorateOptions,
    decoratePlugins: decoratePlugins,
    register: register
  };
})(window);