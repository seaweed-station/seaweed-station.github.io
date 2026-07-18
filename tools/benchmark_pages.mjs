#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = Number(process.env.CDP_PORT || 9327);
const runTimeoutMs = Number(process.env.BENCH_TIMEOUT_MS || 60000);
const validateHealthHistory = process.env.BENCH_VALIDATE_HISTORY === "1";
const baseUrl = (process.env.BENCH_BASE_URL || "https://seaweed-station.github.io").replace(/\/$/, "");
const allTargets = [
  { name: "Station Health", url: `${baseUrl}/v4/station_health.html`, kind: "health" },
  { name: "Station tb-02", url: `${baseUrl}/v4/station.html?station=tb-02`, kind: "station" },
];
const targetFilter = String(process.env.BENCH_TARGET || "").trim().toLowerCase();
const targets = targetFilter
  ? allTargets.filter((target) => ["health", "station"].includes(targetFilter)
    ? target.kind === targetFilter
    : target.name.toLowerCase().includes(targetFilter))
  : allTargets;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevTools() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (_) {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

async function newTarget() {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`new target HTTP ${response.status}`);
  return response.json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result || {});
    } else if (message.method) {
      listeners.forEach((listener) => listener(message));
    }
  };
  return {
    on(listener) {
      listeners.push(listener);
    },
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const output = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return output.result && output.result.value;
}

async function sample(cdp, kind) {
  const expression = kind === "health" ? `(() => ({
    now: performance.now(),
    source: typeof _healthDiagMeta !== "undefined" && _healthDiagMeta ? _healthDiagMeta.source : "",
    fetchMs: typeof _healthDiagMeta !== "undefined" && _healthDiagMeta ? _healthDiagMeta.fetchDurationMs : null,
    dataAsOf: typeof getHealthLatestDataAsOf === "function" ? getHealthLatestDataAsOf() : null,
    visible: !!document.querySelector("#stationsContainer .station-section") && getComputedStyle(document.getElementById("stationsContainer")).display !== "none",
    sections: document.querySelectorAll("#stationsContainer .station-section").length,
    error: typeof _healthDiagMeta !== "undefined" && _healthDiagMeta ? (_healthDiagMeta.error || "") : ""
  }))()` : `(() => ({
    now: performance.now(),
    source: typeof _stationDiagMeta !== "undefined" && _stationDiagMeta ? _stationDiagMeta.source : "",
    fetchMs: typeof _stationDiagMeta !== "undefined" && _stationDiagMeta ? _stationDiagMeta.fetchDurationMs : null,
    dataAsOf: typeof _stationDiagMeta !== "undefined" && _stationDiagMeta ? _stationDiagMeta.dataAsOf : null,
    visible: typeof state !== "undefined" && state && Array.isArray(state.allEntries) && state.allEntries.length > 0,
    entries: typeof state !== "undefined" && state && Array.isArray(state.allEntries) ? state.allEntries.length : 0,
    error: typeof _stationDiagMeta !== "undefined" && _stationDiagMeta ? (_stationDiagMeta.error || "") : ""
  }))()`;
  try {
    return await evaluate(cdp, expression);
  } catch (_) {
    return null;
  }
}

async function waitForRun(cdp, kind, timeoutMs) {
  const startedAt = Date.now();
  const transitions = [];
  let firstVisibleMs = null;
  let final = null;
  let lastSource = null;
  while (Date.now() - startedAt < timeoutMs) {
    const state = await sample(cdp, kind);
    if (state) {
      if (state.visible && firstVisibleMs === null) firstVisibleMs = state.now;
      if (state.source !== lastSource) {
        transitions.push({ atMs: Math.round(state.now), source: state.source });
        lastSource = state.source;
      }
      final = state;
      if (state.source === "edge" || state.source === "error") break;
    }
    await sleep(75);
  }
  return {
    firstVisibleMs: firstVisibleMs === null ? null : Math.round(firstVisibleMs),
    transitions,
    final,
  };
}

function resourceSummary(requests) {
  const rows = [...requests.values()]
    .filter((request) => request.url && request.start != null)
    .map((request) => ({
      url: request.url.replace(/([?&](?:apikey|key)=)[^&]+/gi, "$1<redacted>"),
      type: request.type || "",
      status: request.status || 0,
      durationMs: request.end != null ? Math.round((request.end - request.start) * 1000) : null,
      bytes: request.bytes || 0,
      cache: Boolean(request.cache),
      failed: request.failed || "",
    }));
  const byDuration = (left, right) => (right.durationMs || 0) - (left.durationMs || 0);
  return {
    count: rows.length,
    transferredBytes: rows.reduce((total, row) => total + (row.bytes || 0), 0),
    api: rows
      .filter((row) => /supabase|open-meteo|functions\/v1|rest\/v1/.test(row.url))
      .sort(byDuration),
    slowest: rows.sort(byDuration).slice(0, 8),
  };
}

async function runNavigation(cdp, target, mode, requests) {
  requests.clear();
  if (mode === "cold") await cdp.send("Page.navigate", { url: target.url });
  else await cdp.send("Page.reload", { ignoreCache: false });

  const result = await waitForRun(cdp, target.kind, runTimeoutMs);
  await sleep(500);
  const navigation = await evaluate(cdp, `(() => {
    const item = performance.getEntriesByType("navigation")[0];
    return item ? {
      ttfbMs: Math.round(item.responseStart),
      domContentLoadedMs: Math.round(item.domContentLoadedEventEnd),
      loadMs: Math.round(item.loadEventEnd),
      transferSize: item.transferSize,
      encodedBodySize: item.encodedBodySize
    } : null;
  })()`);
  return { mode, navigation, ...result, resources: resourceSummary(requests) };
}

async function validateExpandedHealthHistory(cdp) {
  const startedAt = Date.now();
  await evaluate(cdp, `(() => {
    if (!Array.isArray(STATIONS) || !STATIONS.length) return false;
    toggleStation(STATIONS[0].id);
    return true;
  })()`);

  let state = null;
  while (Date.now() - startedAt < runTimeoutMs) {
    state = await evaluate(cdp, `(() => ({
      ready: typeof healthDataCanServeRange === "function" && healthDataCanServeRange("recent"),
      inFlight: typeof _healthRangeFetchPromise !== "undefined" && !!_healthRangeFetchPromise,
      status: document.getElementById("fetchStatus")?.textContent || "",
      loadedWindow: typeof getCurrentHealthLoadedWindow === "function" ? getCurrentHealthLoadedWindow() : null
    }))()`);
    if (state?.ready) break;
    await sleep(100);
  }
  return { durationMs: Date.now() - startedAt, ...state };
}

async function benchmarkTarget(target) {
  const page = await newTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  const requests = new Map();
  const browserErrors = [];
  cdp.on((message) => {
    const params = message.params || {};
    if (message.method === "Runtime.exceptionThrown") {
      const detail = params.exceptionDetails || {};
      browserErrors.push(detail.exception?.description || detail.text || "Uncaught browser exception");
    } else if (message.method === "Runtime.consoleAPICalled" && params.type === "error") {
      browserErrors.push((params.args || []).map((arg) => arg.value || arg.description || "").join(" "));
    }
    if (message.method === "Network.requestWillBeSent") {
      requests.set(params.requestId, {
        url: params.request.url,
        start: params.timestamp,
        type: params.type,
      });
    }
    const row = requests.get(params.requestId);
    if (!row) return;
    if (message.method === "Network.responseReceived") {
      row.status = params.response.status;
      row.cache = params.response.fromDiskCache || params.response.fromServiceWorker;
      row.type = row.type || params.type;
    } else if (message.method === "Network.loadingFinished") {
      row.end = params.timestamp;
      row.bytes = params.encodedDataLength || 0;
    } else if (message.method === "Network.loadingFailed") {
      row.end = params.timestamp;
      row.failed = params.errorText || "failed";
    }
  });

  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Network.enable"),
  ]);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      try {
        sessionStorage.setItem("sw_auth_v4_local", "ok");
        sessionStorage.setItem("sw_auth", "ok");
        sessionStorage.setItem("sw_allowed_stations", "[\\"*\\"]");
        if (!sessionStorage.getItem("__seaweed_bench_cold_cleared")) {
          localStorage.clear();
          sessionStorage.setItem("__seaweed_bench_cold_cleared", "1");
        }
      } catch (_) {}
    `,
  });
  await cdp.send("Network.clearBrowserCache");

  const cold = await runNavigation(cdp, target, "cold", requests);
  const warm = await runNavigation(cdp, target, "warm", requests);
  const historyValidation = target.kind === "health" && validateHealthHistory
    ? await validateExpandedHealthHistory(cdp)
    : null;
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => {});
  return { target: target.name, url: target.url, cold, warm, historyValidation, browserErrors };
}

function conciseRun(run) {
  const apiRows = run.resources.api || [];
  const requestGroups = {};
  apiRows.forEach((row) => {
    let group = "other";
    const match = row.url.match(/\/(?:rest\/v1|functions\/v1)\/([^?]+)/);
    if (match) group = match[1];
    else if (row.url.includes("open-meteo")) group = "open-meteo";
    requestGroups[group] = (requestGroups[group] || 0) + 1;
  });
  return {
    navigation: run.navigation,
    firstVisibleMs: run.firstVisibleMs,
    liveDataMs: run.final && run.final.now != null ? Math.round(run.final.now) : null,
    reportedFetchMs: run.final && run.final.fetchMs != null ? Math.round(run.final.fetchMs) : null,
    finalSource: run.final ? run.final.source : null,
    finalEntries: run.final && run.final.entries != null ? run.final.entries : null,
    finalSections: run.final && run.final.sections != null ? run.final.sections : null,
    finalDataAsOf: run.final ? run.final.dataAsOf : null,
    finalError: run.final ? run.final.error : null,
    transitions: run.transitions,
    requests: run.resources.count,
    transferredBytes: run.resources.transferredBytes,
    requestGroups,
    slowest: (run.resources.slowest || []).slice(0, 5).map((row) => ({
      resource: row.url.replace(/^https?:\/\/[^/]+\//, "/").slice(0, 180),
      durationMs: row.durationMs,
      bytes: row.bytes,
      status: row.status,
      failed: row.failed,
    })),
  };
}

function conciseResult(result) {
  return {
    target: result.target,
    url: result.url,
    browserErrors: result.browserErrors,
    historyValidation: result.historyValidation,
    cold: conciseRun(result.cold),
    warm: conciseRun(result.warm),
  };
}

const profilePath = await mkdtemp(join(tmpdir(), "seaweed-page-benchmark-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profilePath}`,
  "--disable-background-networking",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore", windowsHide: true });

try {
  await waitForDevTools();
  const results = [];
  for (const target of targets) results.push(await benchmarkTarget(target));
  const output = process.env.BENCH_VERBOSE === "1" ? results : results.map(conciseResult);
  process.stdout.write(`${JSON.stringify({ measuredAt: new Date().toISOString(), results: output }, null, 2)}\n`);
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profilePath, { recursive: true, force: true });
}
