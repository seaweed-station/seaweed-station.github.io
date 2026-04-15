"use strict";

(function(global) {
  var registry = {};

  function unregisterInstance(instance) {
    Object.keys(registry).forEach(function(key) {
      if (registry[key] === instance) delete registry[key];
    });
  }

  function applyMeta(chart, key, meta) {
    meta = meta || {};
    chart.$chartKey = key;
    chart.$chartMeta = Object.assign({}, meta);
    Object.keys(meta).forEach(function(name) {
      chart['$' + name] = meta[name];
      if (chart.canvas) chart.canvas['_' + name] = meta[name];
    });
  }

  function decorateConfig(config, overlays) {
    var cfg = {
      type: config.type,
      data: config.data,
      options: config.options || {}
    };
    var normalizedOverlays = Array.isArray(overlays) ? overlays : [];
    if (global.PlotOverlays) {
      cfg.options = PlotOverlays.decorateOptions(cfg.options, normalizedOverlays);
      cfg.plugins = PlotOverlays.decoratePlugins(config.plugins, normalizedOverlays);
    } else {
      cfg.plugins = Array.isArray(config.plugins) ? config.plugins.slice() : [];
    }
    return cfg;
  }

  function get(keyOrCanvas) {
    if (!keyOrCanvas) return null;
    if (typeof keyOrCanvas === 'string') return registry[keyOrCanvas] || null;
    return global.Chart && Chart.getChart ? Chart.getChart(keyOrCanvas) : null;
  }

  function destroy(keyOrCanvas) {
    var chart = get(keyOrCanvas);
    if (!chart) return;
    unregisterInstance(chart);
    try { chart.destroy(); } catch (_) {}
  }

  function destroyMatching(predicate) {
    Object.keys(registry).forEach(function(key) {
      var chart = registry[key];
      if (chart && predicate(chart, key)) destroy(key);
    });
  }

  function upsert(spec) {
    var key = spec && spec.key;
    if (!key || !spec.canvas || !spec.config) throw new Error('ChartManager.upsert requires key, canvas, and config');

    var existing = registry[key] || (global.Chart && Chart.getChart ? Chart.getChart(spec.canvas) : null);
    var cfg = decorateConfig(spec.config, spec.overlays);

    if (existing && spec.recreateOnUpdate) {
      destroy(key);
      existing = null;
    }

    if (existing && !spec.forceRecreate && existing.config && existing.config.type === cfg.type) {
      var canReuse = true;
      existing.config.data = cfg.data;
      existing.config.options = cfg.options;
      try {
        existing.config.plugins = cfg.plugins || [];
      } catch (_) {
        canReuse = false;
      }

      if (!canReuse) {
        destroy(key);
        existing = null;
      }
    }

    if (existing && !spec.forceRecreate && existing.config && existing.config.type === cfg.type) {
      existing.data = existing.config.data;
      existing.options = existing.config.options;
      if (global.PlotOverlays) PlotOverlays.attach(existing, spec.overlays);
      applyMeta(existing, key, spec.meta);
      registry[key] = existing;
      existing.update(spec.updateMode || 'none');
      return existing;
    }

    if (existing) destroy(key);
    var canvasChart = global.Chart && Chart.getChart ? Chart.getChart(spec.canvas) : null;
    if (canvasChart) destroy(canvasChart);

    var chart = new Chart(spec.canvas, cfg);
    if (global.PlotOverlays) PlotOverlays.attach(chart, spec.overlays);
    applyMeta(chart, key, spec.meta);
    registry[key] = chart;
    return chart;
  }

  global.ChartManager = {
    destroy: destroy,
    destroyMatching: destroyMatching,
    get: get,
    upsert: upsert
  };
})(window);