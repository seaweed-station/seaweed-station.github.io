// ============================================================================
// battery_model.js — Shared Battery Lifetime Prediction Engine
// ============================================================================
// Single source of truth for T0 and T-Energy energy models.
// Used by:  battery_estimator.html  (manual what-if UI)
//
// Version: 1.0  (2026-02-24)
// ============================================================================
"use strict";

window.BatteryModel = (function () {

  // ========================================================================
  // HARDWARE DEFAULTS (match battery_estimator.html Advanced Settings)
  // ========================================================================
  var HW_T0 = {
    sleepCurrent_mA:    1.0,      // conservative hub sleep draw; INA260 observed ~0.5 mA
    mcuActive_mA:       44,       // measured H003 routine sample pulse
    wifiActive_mA:      150,      // WiFi TX/RX
    cellActive_mA:      77,       // measured cellular active section
    sampleDuration_s:   2.1,      // measured routine sample pulse
    sensorMs:           25,       // per-sensor read time (ms)
    sensorCurrent_mA:   1.0,      // per-sensor current (mA)
    sensorCount:        2,        // default T/H sensor count
    modemBoot_s:        12,
    modemShutdown_s:    3,
    cellBulkBase_s:     20,
    cellInitReg_s:      35,
    cellBulkPerRow_s:   0.1,
    blynkOps_s:         8,
    cellSettleCurrent_mA: 20,     // measured post-upload modem/settle tail
    cellSettle_s:       286,
    modemBlockMax_s:    180,
    wifiConnect_s:      4,
    wifiBulkUpload_s:   10,
    sdWriteCurrent_mA:  90,
    sdWriteTime_s:      0.2,
    bootOverhead_s:     1.0,
    teRxWindowMs:       800,      // legacy sub-second ESP-NOW window
    teTxSyncMs:         15,       // SYNC+ACK send per satellite
    teRxProcMs:         120,      // parse/store overhead per satellite
    teFileSyncCurrent_mA: 103,    // measured H003 satellite file-transfer sync
    teFileSyncDuration_s: 30,
    teEarlyWake_s:      1.0,      // early wake before epoch grid
    batteryDerating:    0.85,     // usable fraction of nameplate capacity
    batteryCapacity_mAh: 3000,
  };

  var HW_TE = {
    sleepUa:            50,       // conservative: INA260 confirms sleep, but cannot resolve true uA draw
    bootCurrent_mA:     80,
    bootMs:             300,
    i2cCurrent_mA:      0,
    i2cMs:              0,
    mcuActive_mA:       35.9,     // measured N0002 sample-window current
    txCurrent_mA:       90,       // current best bench value: awake/listening plateau
    txMs:               10,
    rxCurrent_mA:       89.6,     // measured N0002 listening average
    flashCurrent_mA:    0,
    flashMs:            0,
    syncApplyMs:        20,
    sensorMs:           3000,     // aggregate 6-7 s sample wake, split across two sensors
    sensorCurrent_mA:   0,
    sensorCount:        2,
    listenMs:           400,      // normal listen window per exchange
    listenLongMs:       1200,     // extended listen window per exchange
    listenEveryN:       10,       // every Nth wake uses long listen
    retries:            2,
    preWakeMargin_s:    5,        // T-Energy wakes this many seconds before expected SYNC
                                  // (SLEEP_WAKE_MARGIN_S in firmware) — active MCU idle time
                                  // before exchange starts; only costs energy when sleep enabled
    batteryDerating:    0.85,
    batteryCapacity_mAh: 3000,
  };

  var HW_FIREBEETLE = {
    sleepCurrent_mA:      0.5,    // INA260 near-zero band averaged ~0.27 mA; use conservative estimator default
    sampleCurrent_mA:     60.2,   // measured N0008 routine sample pulse across extended capture
    sampleDuration_s:     3.0,    // measured N0008 routine sample pulse across extended capture
    sensorMs:             0,
    sensorCurrent_mA:     0,
    sensorCount:          1,      // intended FireBeetle deployment: single T/H sensor, no mux
    rfCurrent_mA:         108.5,  // measured N0008 long RF/listen plateau
    rfWindowDuration_s:   180,    // extended capture from 2026-05-28 onward averaged ~182 s
    rfWindowsPerDay:      7,      // extended capture from 2026-05-28 onward: ~6.8 long windows/day
    otherMahPerDay:       0,
    batteryDerating:      0.85,
    batteryCapacity_mAh:  3000,
  };

  // ========================================================================
  // DRIFT + LISTEN-WINDOW HELPERS (mirror SatelliteProtocol.h computeXxx)
  // ========================================================================
  // ESP32 RTC drift: measured field estimate used by current T-Energy firmware.
  var DRIFT_PPM = 1500;
  var DRIFT_SAFETY = 2;

  // Listen-EARLY window (ms): gate opens this far before expected SYNC. Floor 20 s.
  function computeListenEarlyMs(period_s) {
    var drift_ms = Math.floor(period_s * DRIFT_PPM * DRIFT_SAFETY / 1000);
    var minEarlyMs = period_s >= 43200 ? 60000 : 20000;
    return Math.max(minEarlyMs, drift_ms);
  }

  // Sync-GRACE window (ms): gate stays open this far after expected SYNC. Floor 45 s.
  function computeSyncGraceMs(period_s) {
    var drift_ms = Math.floor(period_s * DRIFT_PPM * DRIFT_SAFETY * 2 / 1000);
    var minGraceMs = period_s >= 43200 ? 120000 : 45000;
    return Math.max(minGraceMs, drift_ms);
  }

  // Total guard window (ms) = early + grace.
  function computeTotalListenWindowMs(period_s) {
    return computeListenEarlyMs(period_s) + computeSyncGraceMs(period_s);
  }

  // Expected peak drift (s) at the current firmware drift estimate.
  function computeExpectedDriftSec(period_s) {
    return period_s * DRIFT_PPM * 1e-6;
  }

  // ========================================================================
  // T0 ENERGY MODEL  (from battery_estimator.html runT0Estimate)
  // ========================================================================
  // cfg = { deployMode, sleepEnable, samplePeriod_s,
  //         tsBulkFreqHours, espnowSyncPeriod_s, sat1Installed, sat2Installed }
  // hwOverrides (optional) can override any key from HW_T0
  function calcT0Daily(cfg, hwOverrides) {
    var hw = Object.assign({}, HW_T0, hwOverrides || {});

    var mode            = cfg.deployMode === 0 ? 'wifi' : 'cell';
    var sleepEn         = !!cfg.sleepEnable;
    var samplePeriod    = Math.max(10, cfg.samplePeriod_s || 600);
    var syncFreqHours   = Math.max(1, cfg.tsBulkFreqHours || 24);
    var syncPeriod_s    = Math.max(60, cfg.espnowSyncPeriod_s || 3600);
    var tEnergyNodes    = (cfg.sat1Installed ? 1 : 0) + (cfg.sat2Installed ? 1 : 0);
    var battCap         = hw.batteryCapacity_mAh;
    var derating        = hw.batteryDerating;

    var usable_mAh      = battCap * derating;
    var samplesPerDay   = Math.floor(86400 / samplePeriod);
    var syncsPerDay     = tEnergyNodes > 0 ? Math.floor(86400 / syncPeriod_s) : 0;
    var uploadsPerDay   = 24.0 / syncFreqHours;
    var rowsPerUpload   = Math.max(1, Math.floor((syncFreqHours * 3600) / samplePeriod));

    // Sensor read time
    var sensorCount     = hw.sensorCount;
    var t0Sensors_s     = (sensorCount * hw.sensorMs) / 1000.0;
    var t_sampleTotal   = hw.sampleDuration_s + t0Sensors_s;

    // Sample active time per day
    var sampleActivePerDay_s;
    if (sleepEn) {
      sampleActivePerDay_s = samplesPerDay * t_sampleTotal;
    } else {
      var t_readOnly = Math.max(0, t_sampleTotal - hw.bootOverhead_s);
      sampleActivePerDay_s = samplesPerDay * t_readOnly;
    }

    var sdEnergy_mAh     = (samplesPerDay * hw.sdWriteTime_s * hw.sdWriteCurrent_mA) / 3600.0;
    var sensorEnergy_mAh = (samplesPerDay * t0Sensors_s * hw.sensorCurrent_mA) / 3600.0;
    var sampleEnergy_mAh = (sampleActivePerDay_s * hw.mcuActive_mA) / 3600.0 + sdEnergy_mAh + sensorEnergy_mAh;

    // Early wake penalty for satellite sync
    var earlyWakePerDay_s   = tEnergyNodes > 0 ? syncsPerDay * hw.teEarlyWake_s : 0;
    var earlyWakeEnergy_mAh = (earlyWakePerDay_s * hw.mcuActive_mA) / 3600.0;

    // Satellite sync. Current firmware can service file-transfer syncs that are
    // much longer than the legacy sub-second ESP-NOW exchange, so prefer the
    // measured file-sync model when supplied.
    var legacyEspNowSync_s = (tEnergyNodes * (hw.teRxWindowMs + hw.teTxSyncMs + hw.teRxProcMs)) / 1000.0;
    var fileSyncPerNode_s = Math.max(0, hw.teFileSyncDuration_s || 0);
    var tePerSync_s      = fileSyncPerNode_s > 0 ? tEnergyNodes * fileSyncPerNode_s : legacyEspNowSync_s;
    var teActivePerDay_s = syncsPerDay * tePerSync_s;
    var teSyncCurrent_mA = fileSyncPerNode_s > 0 ? (hw.teFileSyncCurrent_mA || hw.wifiActive_mA) : hw.wifiActive_mA;
    var teEnergy_mAh     = (teActivePerDay_s * teSyncCurrent_mA) / 3600.0;

    // Upload energy
    var uploadDuration_s = 0;
    var uploadSettleDuration_s = 0;
    var I_radio = hw.mcuActive_mA;
    var uploadEnergy_mAh = 0;
    if (mode === 'cell') {
      I_radio = hw.cellActive_mA;
      uploadDuration_s = hw.modemBoot_s + hw.cellInitReg_s + hw.cellBulkBase_s
                       + (rowsPerUpload * hw.cellBulkPerRow_s) + hw.blynkOps_s + hw.modemShutdown_s;
      uploadDuration_s = Math.min(uploadDuration_s, hw.modemBlockMax_s);
      uploadSettleDuration_s = Math.max(0, hw.cellSettle_s || 0);
      uploadEnergy_mAh = uploadsPerDay * (
        (uploadDuration_s * I_radio) +
        (uploadSettleDuration_s * (hw.cellSettleCurrent_mA || 0))
      ) / 3600.0;
    } else {
      I_radio = hw.wifiActive_mA;
      uploadDuration_s = hw.wifiConnect_s + hw.wifiBulkUpload_s + (rowsPerUpload * 0.05);
      uploadEnergy_mAh = (uploadsPerDay * uploadDuration_s * I_radio) / 3600.0;
    }
    var uploadActivePerDay_s = uploadsPerDay * (uploadDuration_s + uploadSettleDuration_s);

    // Sleep energy
    var totalActivePerDay_s = sampleActivePerDay_s + earlyWakePerDay_s + teActivePerDay_s + uploadActivePerDay_s;
    var sleepEnergy_mAh;
    if (sleepEn) {
      var sleepTime_s = Math.max(0, 86400 - totalActivePerDay_s);
      sleepEnergy_mAh = (sleepTime_s * hw.sleepCurrent_mA) / 3600.0;
    } else {
      var idleTime_s = Math.max(0, 86400 - totalActivePerDay_s);
      sleepEnergy_mAh = (idleTime_s * hw.mcuActive_mA) / 3600.0;
    }

    var dailyTotal_mAh = sleepEnergy_mAh + sampleEnergy_mAh + earlyWakeEnergy_mAh + teEnergy_mAh + uploadEnergy_mAh;
    var lifetimeDays   = dailyTotal_mAh > 0 ? usable_mAh / dailyTotal_mAh : 0;

    return {
      dailyTotal_mAh:   dailyTotal_mAh,
      lifetimeDays:     lifetimeDays,
      usable_mAh:       usable_mAh,
      batteryCapacity:  battCap,
      derating:         derating,
      // Breakdown
      sleepMah:         sleepEnergy_mAh,
      sampleMah:        sampleEnergy_mAh,
      uploadMah:        uploadEnergy_mAh,
      espNowMah:        teEnergy_mAh,
      earlyWakeMah:     earlyWakeEnergy_mAh,
      uploadActive_s:   uploadDuration_s,
      uploadSettle_s:   uploadSettleDuration_s,
      satSync_s:        tePerSync_s,
      satSyncCurrent_mA: teSyncCurrent_mA,
      // Config echo (for display)
      mode:             mode,
      sleepEn:          sleepEn,
      samplePeriod_s:   samplePeriod,
      tEnergyNodes:     tEnergyNodes,
    };
  }

  // ========================================================================
  // T-ENERGY ENERGY MODEL  (from battery_estimator.html runTEEstimate)
  // ========================================================================
  // cfg = { samplePeriod_s, espnowSyncPeriod_s, sleepEnable }
  function calcTEDaily(cfg, hwOverrides) {
    var hw = Object.assign({}, HW_TE, hwOverrides || {});

    var samplePeriod = Math.max(10, cfg.samplePeriod_s || 600);
    var syncPeriod   = Math.max(60, cfg.espnowSyncPeriod_s || 3600);
    var sleepEn      = cfg.sleepEnable !== undefined ? !!cfg.sleepEnable : true;
    var battCap      = hw.batteryCapacity_mAh;
    var derating     = hw.batteryDerating;

    var usable_mAh   = battCap * derating;
    var samplesPerDay = Math.floor(86400 / samplePeriod);
    var syncsPerDay   = Math.floor(86400 / syncPeriod);
    var periodsMatch  = Math.abs(samplePeriod - syncPeriod) < 0.001;

    var sensorCount  = hw.sensorCount;
    var boot_ms      = hw.bootMs;
    var sensor_ms    = sensorCount * hw.sensorMs;
    var i2c_ms       = hw.i2cMs + sensor_ms;
    var tx_frames    = 2 * (1 + hw.retries);
    var tx_ms        = tx_frames * hw.txMs;
    var flash_ms       = hw.flashMs;
    var sync_ms        = hw.syncApplyMs;

    // Guard window (early+grace): current firmware sizes the scheduled receive
    // window from expected RTC drift. Use it as the sync listen time because a
    // 12 h sync cannot be represented by the legacy 400/1200 ms mini-window.
    var listenEarlyMs    = computeListenEarlyMs(syncPeriod);
    var syncGraceMs      = computeSyncGraceMs(syncPeriod);
    var guardWindowMs    = listenEarlyMs + syncGraceMs;
    var expectedDrift_s  = computeExpectedDriftSec(syncPeriod);
    var normalFraction = (hw.listenEveryN - 1) / hw.listenEveryN;
    var longFraction   = 1.0 / hw.listenEveryN;
    var avgLegacyListenMs = normalFraction * hw.listenMs + longFraction * hw.listenLongMs;
    var syncListenMs   = Math.max(avgLegacyListenMs, guardWindowMs);

    var sampleWakeCount = samplesPerDay;
    var syncWakeCount   = periodsMatch ? samplesPerDay : syncsPerDay;
    var bootWakeCount   = periodsMatch ? sampleWakeCount : (sampleWakeCount + syncWakeCount);

    // Pre-wake margin: T-Energy wakes SLEEP_WAKE_MARGIN_S=5s before expected SYNC.
    // Only adds measurable cost when sleep is enabled (always-on boards already idle
    // during that window at the same current).
    var preWakeMargin_ms = sleepEn ? (hw.preWakeMargin_s * 1000) : 0;

    var sampleWakeMs = boot_ms + i2c_ms + flash_ms;
    var syncWakeMs   = boot_ms + preWakeMargin_ms + tx_ms + syncListenMs + sync_ms;
    var totalActiveMs = periodsMatch
      ? (sampleWakeCount * (sampleWakeMs + preWakeMargin_ms + tx_ms + syncListenMs + sync_ms))
      : (sampleWakeCount * sampleWakeMs) + (syncWakeCount * syncWakeMs);

    // Energy cost of one missed sync: radio on for guardWindowMs at rxCurrent_mA
    var guardWindowMahPerMiss = (hw.rxCurrent_mA * guardWindowMs / 3600000.0);
    // Total guard window active time per day IF all syncs were missed (for display context)
    var guardWorstCasePerDayMs = syncsPerDay * guardWindowMs;
    var totalMsDay   = 86400 * 1000;
    var sleepMsDay   = Math.max(0, totalMsDay - totalActiveMs);

    var mAhPerMs = 1.0 / 3600000.0;

    var e_boot_uAh    = hw.bootCurrent_mA * boot_ms * mAhPerMs * 1000;
    var e_i2c_uAh     = hw.i2cCurrent_mA  * hw.i2cMs * mAhPerMs * 1000;
    var e_sensor_uAh  = hw.sensorCurrent_mA * sensor_ms * mAhPerMs * 1000;
    var e_tx_uAh      = hw.txCurrent_mA   * tx_ms * mAhPerMs * 1000;
    var e_rx_uAh      = hw.rxCurrent_mA   * syncListenMs * mAhPerMs * 1000;
    var e_flash_uAh   = hw.flashCurrent_mA * flash_ms * mAhPerMs * 1000;
    var e_preWake_uAh = hw.mcuActive_mA * (syncWakeCount * preWakeMargin_ms) * mAhPerMs * 1000;

    var sampleMcuMs    = hw.i2cMs + sensor_ms + flash_ms;
    var syncApplyMcuMs = sync_ms;
    var e_sampleMcu_uAh = hw.mcuActive_mA * (sampleWakeCount * sampleMcuMs) * mAhPerMs * 1000;
    var e_syncMcu_uAh = hw.mcuActive_mA * (syncWakeCount * syncApplyMcuMs) * mAhPerMs * 1000;
    var e_mcuActive_uAh = e_sampleMcu_uAh + e_syncMcu_uAh;
    var e_bootTotal_uAh = e_boot_uAh * bootWakeCount;
    var e_sampleTotal_uAh =
      e_sampleMcu_uAh +
      (e_i2c_uAh * sampleWakeCount) +
      (e_sensor_uAh * sampleWakeCount) +
      (e_flash_uAh * sampleWakeCount);
    var e_espNowTotal_uAh =
      e_syncMcu_uAh +
      (e_tx_uAh * syncWakeCount) +
      (e_rx_uAh * syncWakeCount);

    var e_cycle_uAh =
      e_bootTotal_uAh +
      e_sampleTotal_uAh +
      e_espNowTotal_uAh;
    var e_active_uAh = e_cycle_uAh + e_preWake_uAh;

    var e_sleep_uAh = sleepEn
      ? (hw.sleepUa * sleepMsDay / 3600000.0)
      : (hw.bootCurrent_mA * sleepMsDay * mAhPerMs * 1000);

    var dailyEnergy_mAh = (e_active_uAh + e_sleep_uAh) / 1000.0;
    var lifetimeDays    = dailyEnergy_mAh > 0 ? usable_mAh / dailyEnergy_mAh : 0;

    return {
      dailyTotal_mAh:  dailyEnergy_mAh,
      lifetimeDays:    lifetimeDays,
      usable_mAh:      usable_mAh,
      batteryCapacity: battCap,
      derating:        derating,
      // Breakdown
      activeMah:       (e_cycle_uAh / 1000.0),
      bootMah:         (e_bootTotal_uAh / 1000.0),
      sampleMah:       (e_sampleTotal_uAh / 1000.0),
      espNowMah:       (e_espNowTotal_uAh / 1000.0),
      sleepMah:        (e_sleep_uAh  / 1000.0),
      preWakeMah:      (e_preWake_uAh / 1000.0),
      preWakeActiveMs: syncWakeCount * preWakeMargin_ms, // ms/day T-Energy is awake before exchange
      // Guard window info (for drift analysis display)
      guardWindowMs:        guardWindowMs,        // total guard per period (ms)
      listenEarlyMs:        listenEarlyMs,        // early gate (ms)
      syncGraceMs:          syncGraceMs,          // grace gate (ms)
      syncListenMs:         syncListenMs,         // scheduled receive window used in energy model
      expectedDrift_s:      expectedDrift_s,      // expected peak drift at current firmware estimate (s)
      guardWindowMahPerMiss: guardWindowMahPerMiss, // extra mAh cost per missed SYNC
      guardWorstCasePerDayMs: guardWorstCasePerDayMs, // if ALL syncs missed (ms/day)
      // Echo
      samplePeriod_s:  samplePeriod,
      syncPeriod_s:    syncPeriod,
      syncsPerDay:     syncsPerDay,
      sleepEnabled:    sleepEn,
    };
  }

  // ========================================================================
  // FIREBEETLE SATELLITE ENERGY MODEL
  // ========================================================================
  // cfg = { samplePeriod_s, sleepEnable, rfWindowsPerDay }
  // N0008 INA260 reference: firmware 3.1.0+46/+48, capture 2026-05-26..31.
  function calcFireBeetleDaily(cfg, hwOverrides) {
    var hw = Object.assign({}, HW_FIREBEETLE, hwOverrides || {});

    var samplePeriod = Math.max(10, cfg.samplePeriod_s || 600);
    var sleepEn      = cfg.sleepEnable !== undefined ? !!cfg.sleepEnable : true;
    var battCap      = hw.batteryCapacity_mAh;
    var derating     = hw.batteryDerating;
    var usable_mAh   = battCap * derating;
    var samplesPerDay = Math.floor(86400 / samplePeriod);
    var rfWindowsPerDay = Math.max(0, cfg.rfWindowsPerDay != null ? cfg.rfWindowsPerDay : hw.rfWindowsPerDay);

    var sensorCount = hw.sensorCount || 0;
    var sensor_s = (sensorCount * (hw.sensorMs || 0)) / 1000.0;
    var sample_s = Math.max(0, hw.sampleDuration_s || 0) + sensor_s;
    var sampleActivePerDay_s = samplesPerDay * sample_s;
    var sampleMah =
      (sampleActivePerDay_s * (hw.sampleCurrent_mA || 0)) / 3600.0 +
      (samplesPerDay * sensor_s * (hw.sensorCurrent_mA || 0)) / 3600.0;

    var rfActivePerDay_s = rfWindowsPerDay * Math.max(0, hw.rfWindowDuration_s || 0);
    var rfMah = (rfActivePerDay_s * (hw.rfCurrent_mA || 0)) / 3600.0;

    var totalActivePerDay_s = sampleActivePerDay_s + rfActivePerDay_s;
    var idleTime_s = Math.max(0, 86400 - totalActivePerDay_s);
    var sleepMah = sleepEn
      ? (idleTime_s * (hw.sleepCurrent_mA || 0)) / 3600.0
      : (idleTime_s * (hw.sampleCurrent_mA || 0)) / 3600.0;

    var otherMah = Math.max(0, hw.otherMahPerDay || 0);
    var dailyTotal_mAh = sleepMah + sampleMah + rfMah + otherMah;
    var lifetimeDays = dailyTotal_mAh > 0 ? usable_mAh / dailyTotal_mAh : 0;

    return {
      dailyTotal_mAh: dailyTotal_mAh,
      lifetimeDays: lifetimeDays,
      usable_mAh: usable_mAh,
      batteryCapacity: battCap,
      derating: derating,
      sleepMah: sleepMah,
      sampleMah: sampleMah,
      espNowMah: rfMah,
      otherMah: otherMah,
      rfActive_s: rfActivePerDay_s,
      sampleActive_s: sampleActivePerDay_s,
      samplePeriod_s: samplePeriod,
      samplesPerDay: samplesPerDay,
      rfWindowsPerDay: rfWindowsPerDay,
      sleepEnabled: sleepEn,
    };
  }

  // ========================================================================
  // PROJECTION: Generate predicted battery % curve from an anchor point
  // ========================================================================
  // startPct:   battery % at anchor (e.g. 91.8)
  // startTime:  Date object at anchor
  // dailyMah:   daily energy consumption (from calcT0Daily or calcTEDaily)
  // battCap:    battery capacity in mAh
  // derating:   usable fraction (0-1, e.g. 0.85)
  // maxDays:    how far to project (default: until 0%)
  //
  // Returns: [ { time: Date, pct: number }, ... ]  (one point per day)
  function projectCurve(startPct, startTime, dailyMah, battCap, derating, maxDays) {
    if (!battCap || !dailyMah || dailyMah <= 0) return [];
    derating = derating || 0.85;
    var usable = battCap * derating;

    // Convert start % to remaining mAh
    var remainingMah = (startPct / 100.0) * usable;
    var maxD = maxDays || Math.ceil(remainingMah / dailyMah) + 1;
    maxD = Math.min(maxD, 730); // cap at 2 years

    var points = [];
    var startMs = startTime.getTime();

    for (var d = 0; d <= maxD; d++) {
      var mah = Math.max(0, remainingMah - d * dailyMah);
      var pct = (mah / usable) * 100.0;
      points.push({
        time: new Date(startMs + d * 86400000),
        pct:  Math.max(0, Math.min(100, pct)),
      });
      if (pct <= 0) break;
    }
    return points;
  }

  // ========================================================================
  // NONLINEAR VOLTAGE MODEL
  // ========================================================================
  // Maps state-of-charge (%) to open-circuit voltage (V) with a Li-ion style
  // knee at low SOC and a flatter mid-SOC plateau.
  function socToVoltage(socPct, options) {
    options = options || {};
    var fullV   = options.fullV != null ? options.fullV : 4.2;
    var cutoffV = options.cutoffV != null ? options.cutoffV : 3.3;
    var plateauV = options.plateauV != null ? options.plateauV : 3.62;

    var soc = Math.max(0, Math.min(100, socPct || 0));
    var v;

    if (soc >= 90) {
      // Top 10% rises quickly toward full voltage.
      v = (fullV - 0.14) + ((soc - 90) / 10.0) * 0.14;
    } else if (soc >= 20) {
      // Mid plateau curve.
      var xMid = (soc - 20) / 70.0;
      v = plateauV + 0.44 * Math.pow(xMid, 0.55);
    } else {
      // Low-SOC knee.
      var xLow = soc / 20.0;
      v = cutoffV + 0.32 * Math.pow(xLow, 1.3);
    }
    return Math.max(cutoffV, Math.min(fullV, v));
  }

  // Estimate dynamic sag under load for projected line overlays.
  function estimateSagVoltage(dailyMah, usableMah, boardKind, options) {
    options = options || {};
    var baseSag;
    if (options.sagV != null) {
      baseSag = options.sagV;
    } else {
      baseSag = (boardKind === 'te' || boardKind === 'tenergy') ? 0.030 : 0.045;
    }

    var useMah = Math.max(1, usableMah || 1);
    var stress = Math.max(0, (dailyMah || 0) / useMah - 0.03);
    var stressSag = Math.min(0.040, stress * 0.50);
    return Math.max(0, baseSag + stressSag);
  }

  // Project battery voltage over time using projected SOC and nonlinear OCV map.
  // Returns: [ { time: Date, pct: number, ocv: number, voltage: number }, ... ]
  function projectVoltageCurve(startPct, startTime, dailyMah, battCap, derating, options) {
    options = options || {};
    var cutoffV = options.cutoffV != null ? options.cutoffV : 3.3;
    var usableMah = (battCap || 0) * (derating || 0.85);
    var pctCurve = projectCurve(startPct, startTime, dailyMah, battCap, derating, options.maxDays);
    if (!pctCurve.length) return [];

    var sagV = estimateSagVoltage(dailyMah, usableMah, options.boardKind || 't0', options);
    var out = [];
    for (var i = 0; i < pctCurve.length; i++) {
      var p = pctCurve[i];
      var ocv = socToVoltage(p.pct, options);
      var v = Math.max(cutoffV, ocv - sagV);
      out.push({
        time: p.time,
        pct: p.pct,
        ocv: ocv,
        voltage: v,
      });
      if (v <= cutoffV + 1e-6 || p.pct <= 0) break;
    }
    return out;
  }

  // ========================================================================
  // CONFIG PARSER: Extract device config from field8 pipe-delimited block
  // ========================================================================
  // field8 format: "sdFreeKB,csq,uploadOk,drift|dm,sl,sp,bi,bf,es,sA,sB|fwVer,buildDate"
  // Returns { deployMode, sleepEnable, samplePeriod_s, tsBulkInterval_s,
  //           tsBulkFreqHours, espnowSyncPeriod_s, sat1Installed, sat2Installed }
  // or null if no config block present.
  function parseField8Config(field8str) {
    if (!field8str || typeof field8str !== 'string') return null;
    var sections = field8str.split('|');
    if (sections.length < 2) return null;

    var tokens = sections[1].split(',');
    if (tokens.length < 8) return null;

    return {
      deployMode:          parseInt(tokens[0], 10) || 0,
      sleepEnable:         parseInt(tokens[1], 10) === 1,
      samplePeriod_s:      parseInt(tokens[2], 10) || 600,
      tsBulkInterval_s:    parseInt(tokens[3], 10) || 900,
      tsBulkFreqHours:     parseInt(tokens[4], 10) || 24,
      espnowSyncPeriod_s:  parseInt(tokens[5], 10) || 3600,
      sat1Installed:       parseInt(tokens[6], 10) === 1,
      sat2Installed:       parseInt(tokens[7], 10) === 1,
    };
  }

  // ========================================================================
  // CONFIG CHANGE DETECTION: Compare two config strings
  // ========================================================================
  function configChanged(cfgA, cfgB) {
    if (!cfgA || !cfgB) return false;
    return cfgA.deployMode !== cfgB.deployMode ||
           cfgA.sleepEnable !== cfgB.sleepEnable ||
           cfgA.samplePeriod_s !== cfgB.samplePeriod_s ||
           cfgA.tsBulkInterval_s !== cfgB.tsBulkInterval_s ||
           cfgA.tsBulkFreqHours !== cfgB.tsBulkFreqHours ||
           cfgA.espnowSyncPeriod_s !== cfgB.espnowSyncPeriod_s ||
           cfgA.sat1Installed !== cfgB.sat1Installed ||
           cfgA.sat2Installed !== cfgB.sat2Installed;
  }

  // ========================================================================
  // CONFIG SUMMARY: Human-readable config string for display
  // ========================================================================
  function configSummary(cfg) {
    if (!cfg) return 'No config received';
    var mode  = cfg.deployMode === 0 ? 'WiFi' : 'Cell';
    var sleep = cfg.sleepEnable ? 'Sleep ON' : 'Sleep OFF';
    var sp    = cfg.samplePeriod_s >= 3600
      ? (cfg.samplePeriod_s / 3600).toFixed(1) + 'h'
      : (cfg.samplePeriod_s / 60).toFixed(0) + 'm';
    var sats  = (cfg.sat1Installed ? 1 : 0) + (cfg.sat2Installed ? 1 : 0);
    var webSync = cfg.tsBulkFreqHours != null
      ? (cfg.tsBulkFreqHours >= 1
          ? cfg.tsBulkFreqHours.toFixed(0) + 'h'
          : (cfg.tsBulkFreqHours * 60).toFixed(0) + 'm')
      : '?';
    var satSync = cfg.espnowSyncPeriod_s != null
      ? (cfg.espnowSyncPeriod_s >= 3600
          ? (cfg.espnowSyncPeriod_s / 3600).toFixed(1) + 'h'
          : (cfg.espnowSyncPeriod_s / 60).toFixed(0) + 'm')
      : '?';
    // Guard window annotation (only show if period is long enough to matter)
    var guardNote = '';
    if (cfg.espnowSyncPeriod_s != null && cfg.espnowSyncPeriod_s >= 21600) {
      var gMs = computeTotalListenWindowMs(cfg.espnowSyncPeriod_s);
      guardNote = ' (' + Math.round(gMs / 1000) + 's guard)';
    }
    return mode + ' | ' + sleep + ' | Sample ' + sp + ' | ' + sats + ' sat'
         + ' | Web ' + webSync + ' | Sat sync ' + satSync + guardNote;
  }

  // ========================================================================
  // PUBLIC API
  // ========================================================================
  return {
    calcT0Daily:              calcT0Daily,
    calcTEDaily:              calcTEDaily,
    calcFireBeetleDaily:      calcFireBeetleDaily,
    projectCurve:             projectCurve,
    socToVoltage:             socToVoltage,
    estimateSagVoltage:       estimateSagVoltage,
    projectVoltageCurve:      projectVoltageCurve,
    parseField8Config:        parseField8Config,
    configChanged:            configChanged,
    configSummary:            configSummary,
    // Drift + listen-window helpers (match SatelliteProtocol.h inline functions)
    computeListenEarlyMs:     computeListenEarlyMs,
    computeSyncGraceMs:       computeSyncGraceMs,
    computeTotalListenWindowMs: computeTotalListenWindowMs,
    computeExpectedDriftSec:  computeExpectedDriftSec,
    HW_T0:                    HW_T0,
    HW_TE:                    HW_TE,
    HW_FIREBEETLE:            HW_FIREBEETLE,
  };

})();
