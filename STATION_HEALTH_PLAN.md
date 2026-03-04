# Station Health Dashboard — Performance & Reliability Overhaul

## Current UI Layout (to preserve)

The Station Health page (`pages/station_health.html`) renders 3 stations (Perth Test Table, Shangani Aramani, Funzi Island), each with collapsible sections containing:

| Row | Element | Charts |
|---|---|---|
| 1 | **Range bar** — Day / Week / Month / All buttons | — |
| 2 | **Summary cards** — T0 Gateway, Satellite A, Satellite B, System | — |
| 3 | **Battery charts** (side-by-side) | Battery % + Battery Voltage |
| 4 | **Sync Reliability** bar chart (full width) | Synced/Missed per day |
| 5 | **Drift + RSSI** (side-by-side) | Sync Drift + RSSI |
| 6 | **Sync Rate cards** — Sat-A 24h / Sat-B 24h | — |
| 7 | **Data Health grid** — 8 metrics | — |
| 8 | **Daily Health table** — 14-day breakdown | — |

Below all stations: **Battery Forecast panel** (station selector dropdown + forecast chart)

**Total: 5 charts × 3 stations + 1 forecast = 16 Chart.js instances**

---

## Current Issues

| # | Issue | Impact |
|---|---|---|
| 1 | **Every page load re-parses raw ThingSpeak feeds** — `merged_data.js` contains raw JSON for every entry, parsed by `parseStationData()` which iterates all fields and splits CSV strings | Slow parse, growing with data volume |
| 2 | **All charts render synchronously** — `renderStationSection()` creates 5 charts + evaluates sync windows + builds tables all in one blocking call | Browser freezes for seconds |
| 3 | **`evaluateSyncWindows` called 4× per station** — twice in `renderSummaryCards`, twice in `renderSyncCharts`, with only partial caching | Redundant O(n) scans |
| 4 | **LTTB downsampling works but not applied everywhere** — sync reliability bar chart and daily health table still process all entries raw | Partially effective |
| 5 | **"Fetch Live" downloads all entries then re-renders everything** — no incremental update, no persistent cache, data discarded on page close | Must re-fetch every visit |
| 6 | **CI data often stale** — `merged_data.js` only updates when ThingSpeak has new data AND the CI commit succeeds. Bulk write API broken → no new data → `merged_data.js` unchanged for days | Users see old data on load |
| 7 | **Boot loader is sequential** — loads stations one at a time via script injection; if one fails the chain stalls | Slow initial load |
| 8 | **No data freshness indicator** — user can't tell if the data is from CI (possibly days old) or from a live fetch | Confusing UX |

---

## Data Architecture

### Current Flow

```
ThingSpeak API → download_data.ps1 (hourly CI) → yyyyMMddHH.json archives
                                                → merged_data.js (all archives deduped)
                                                → git commit + push → GitHub Pages

Page Load:  merged_data.js <script> injection → parseStationData() → renderStationSection()
Fetch Live: ThingSpeak API → parseStationData() → destroy all charts → re-render everything
```

### Key Files

| File | Lines | Purpose |
|---|---|---|
| `pages/station_health.html` | ~1,785 | Main station health dashboard |
| `pages/station.html` | ~3,141 | Individual station detail page |
| `pages/battery_forecast_widget.js` | ~1,186 | Battery prediction panel |
| `pages/battery_model.js` | ~443 | Battery lifetime calculations |
| `download_data.ps1` | ~587 | CI data download + merge script |
| `.github/workflows/download-data.yml` | ~65 | Hourly CI workflow |
| `config.json` | — | Channel IDs, API keys, settings |

### ThingSpeak Field Mapping (T0 + Satellite stations)

| Field | Content | Format |
|---|---|---|
| field1 | T0 Battery % | numeric |
| field2 | T0 Sensors | `temp1,hum1,temp2,hum2` |
| field3 | T0 Status | `batV,rssi,bootCnt,heap\|fwVersion,buildDate` |
| field4 | Sat-A Status | `batV,bat%,rssi,sampleId,[syncDrift],[fwVer]` |
| field5 | Sat-A Sensors | `temp1,hum1,temp2,hum2` |
| field6 | Sat-B Status | `batV,bat%,rssi,sampleId,[syncDrift],[fwVer]` |
| field7 | Sat-B Sensors | `temp1,hum1,temp2,hum2` |
| field8 | System | `sdFreeKB,csq,uploadOk,syncDrift\|config\|fwVersion,buildDate` |

### localStorage Keys

| Key | Written By | Read By |
|---|---|---|
| `seaweed_dashboard_config` | settings.html | All pages |
| `seaweed_cache_{stationId}` | station.html | station_health.html, index.html |
| `seaweed_view_{tableId}` | station.html | station.html |

---

## Implementation Plan

### Phase 1: Fix the Immediate Hang ✅
*Goal: Page loads in <1s, charts render on demand*

- [x] **1.1 Lazy-render stations** — `renderStationSection()` now only builds range bar + summary cards. Charts are deferred to `_renderStationCharts()`, called on first `toggleStation()` expand via `_stationChartsRendered` flag.

- [x] **1.2 Collapse all stations by default** — Station body starts with `style="display:none"`. On Fetch Live, `_stationChartsRendered` is reset so charts re-render on next expand.

- [x] **1.3 Cache all `evaluateSyncWindows` results** — Full-range sync evaluations in `renderSyncCharts()` now cached under `stationId + '_sync_' + range`. The 24h cache in `renderSummaryCards` was already correct. Cache is invalidated on range change via existing `_syncWindowCache` cleanup in `setStationRange()`.

- [x] **1.4 Audit for string literal bugs** — Searched for literal `\\n` and `\\t` — none found. Clean.

**Verification:** Open Station Health → page loads in <1s. All stations collapsed. Click a station → charts render in <500ms.

---

### Phase 2: Auto-Save & Smart Boot ✅
*Goal: Persist ThingSpeak data locally so it survives page reloads*

- [x] **2.1 Auto-save on Fetch Live** — Instead of a separate button (redundant UX), `fetchLiveAll()` now calls `saveHealthData()` which persists parsed entries to `localStorage` under `seaweed_health_{stationId}` with `{entries, savedAt, source:'live', lastEntryId}`. Entries are slimmed (no `raw`, no `_rawField8`) to save space.

- [x] **2.2 Boot loader tries localStorage first** — Three-tier priority:
  1. `seaweed_health_{id}` (localStorage, instant) → source badge: **Live**
  2. `merged_data.js` (CI script injection) → source badge: **CI**
  3. `seaweed_cache_{id}` (station.html cache) → source badge: **Cache**

- [x] **2.3 Data source badge** — Color-coded pill next to the freshness badge in each station header:
  - 🟢 `.src-live` — green badge: "Live (2h ago)"
  - 🔵 `.src-ci` — blue badge: "CI (3d 2h)"
  - 🟡 `.src-cache` — amber badge: "Cache"
  - ⚫ `.src-none` — grey (no source data)

**Verification:** Click "Download & Save" → data persists. Close & reopen page → loads instantly from localStorage with correct freshness badge.

---

### Phase 3: Incremental Fetch ✅
*Goal: Refreshes take <2s after first download*

- [x] **3.1 Track last entry timestamp per station** — `saveHealthData()` already stores `lastEntryId`. For incremental fetch, we use the last entry's timestamp (more reliable with ThingSpeak's `start` parameter than `start_entry_id`).

- [x] **3.2 Incremental "Fetch Live"** — `fetchLiveAll()` now:
  - Checks if `stationData[id]` has >10 existing entries
  - If yes: requests `&start={lastTimestamp+1s}` — only fetches new entries
  - Merges new entries into existing dataset, deduplicating by `entryId`
  - Re-sorts by timestamp
  - Status shows "(42 new)" or "(up to date)"
  - Falls back to full fetch (`&results=8000`) on first load

- [ ] **3.3 Optional auto-refresh** — Deferred. Can be added later using `setInterval` + the incremental fetch logic.

**Verification:** After initial download, "Fetch Live" completes in <2s. New entries appear appended.

---

### Phase 4: Chart Performance at Scale ✅
*Goal: 6-month data (26,000 entries) renders without lag*

- [ ] **4.1 Pre-aggregate daily summaries** — Deferred. Daily health table only iterates 14 days of data; the `byDay` grouping is O(n) and fast enough. Can be revisited if datasets exceed 50,000 entries.

- [x] **4.2 Ensure LTTB covers all chart paths** — Verified: `lttbDownsample()` IS already applied to drift/RSSI series in `renderSyncCharts` via `makeSeriesDS()`. No gap found.

- [x] **4.3 Smarter range change** — `setStationRange()` no longer does `body.innerHTML = ''`. Changes:
  - Added `_destroyStationCharts(stationId)` — properly destroys Chart.js instances via `liveCharts` registry, fixing memory leak
  - Range bar buttons update in-place via `classList.add/remove('active')` instead of full DOM rebuild
  - Summary cards persist across range changes (they're range-independent anyway)
  - Only the `#charts_{stationId}` container is replaced
  - `_renderStationCharts()` now wraps charts in a container div with known ID

- [x] **4.4 Adaptive LTTB for "All" range** — `_currentRangeMaxPts` global set before each render pass:
  - "All" range with >3,000 entries → 200 LTTB points
  - Other ranges → standard 350 points
  - `lttbDownsample()` respects `_currentRangeMaxPts` as default
  - Reset to 350 after each render to avoid leaking

**Verification:** Set range to "All" with 4,000+ entries → chart renders in <1s. Range switch doesn't freeze.

---

### Phase 5: Fix CI Pipeline Reliability ✅
*Goal: merged_data.js always reflects actual state; no wasted commits*

- [x] **5.1 Add `data_meta.json` per station** — When data changes, `download_data.ps1` writes `data_meta.json` alongside `merged_data.js`:
  ```json
  { "lastUpdate": "2026-03-03T10:00:00+08:00", "entries": 1398, "lastEntryId": "1398", "lastEntryTs": "2026-03-03T10:00:00+08:00", "source": "ci" }
  ```
  Written in both single-channel and dual-channel paths. Synced to pages folder alongside merged_data.js.

- [x] **5.2 Skip no-op commits** — Before writing `merged_data.js`, the script reads the existing `data_meta.json` and compares `entries` count + `lastEntryId`. If both match, `merged_data.js` AND `data_meta.json` are skipped entirely — so `git diff --staged --quiet` in the GitHub Action correctly detects no changes. Implemented in both single-channel and dual-channel paths.

- [ ] **5.3 Reduce `merged_data.js` size** — Deferred. `-Compress` is already applied to JSON output. ThingSpeak feed objects only contain `created_at`, `entry_id`, and `field1`–`field8` — nothing significant to strip. Null fields could be omitted but would require parser changes.

- [x] **5.4 Handle ThingSpeak outages in CI** — Three-layer protection:
  1. **Download failure**: catch block now removes any partial/empty `$outFile` left by `Invoke-WebRequest` before `continue`
  2. **0-entry response**: If `feedCount == 0`, the archive file is removed and a warning logged — prevents empty archives from accumulating
  3. **No-op check**: Even if 0 entries are downloaded, the merge of existing archives produces the same data, so `data_meta.json` comparison skips the rewrite

**Verification:** Check CI Actions → no empty data commits. `data_meta.json` has correct timestamps.

---

## Key Decisions

| Decision | Rationale |
|---|---|
| Lazy charts over fewer charts | Keep all 5 chart types per station (valuable for health monitoring). Render on-demand rather than simplifying the layout. |
| localStorage over IndexedDB | 3 stations × ~300KB parsed ≈ 1MB, well within localStorage's 5–10MB limit. IndexedDB adds complexity without benefit at this scale. |
| LTTB at 350 points | 6 months at 10-min samples = ~26,000 raw points → 350 LTTB points = 99% reduction while preserving peaks/valleys. |
| Incremental fetch over full re-download | ThingSpeak API supports `start_entry_id` parameter, making this straightforward. |
| Keep CI hourly + add staleness handling | Rather than increasing CI frequency, make the dashboard resilient to stale CI data by prioritizing localStorage cache. |

---

## Priority Order

1. **Phase 1** (immediate hang fix) — unblocks dashboard usage now
2. **Phase 2** (Download & Save) — eliminates dependence on stale CI data
3. **Phase 5** (CI reliability) — reduces noise in git history, improves baseline data
4. **Phase 3** (incremental fetch) — quality-of-life for frequent users
5. **Phase 4** (6-month scale) — future-proofing as data accumulates

---

## Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1: Fix Hang | ✅ Complete | Lazy rendering + collapse + sync cache |
| Phase 2: Auto-Save & Boot | ✅ Complete | Auto-save on fetch + 3-tier boot + source badge |
| Phase 3: Incremental Fetch | ✅ Complete | Timestamp-based incremental + merge + dedup |
| Phase 4: Scale Performance | ✅ Complete | Chart cleanup + partial rebuild + adaptive LTTB |
| Phase 5: CI Reliability | ✅ Complete | data_meta.json + no-op skip + outage handling |
