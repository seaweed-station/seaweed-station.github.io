import { DRYING_FORM_CONFIG as CONFIG } from "./config.js";
import {
  configurationLabel,
  configurationParts,
  getLocale,
  initDryingLanguage,
  t,
  tableLabel
} from "./drying_language.js";

const $ = (id) => document.getElementById(id);

const els = {
  form: $("dryingForm"),
  formPanel: $("formPanel"),
  website: $("website"),
  dryerLocation: $("dryerLocation"),
  enumeratorName: $("enumeratorName"),
  enumeratorId: $("enumeratorId"),
  rememberEnumerator: $("rememberEnumerator"),
  recordedAt: $("recordedAt"),
  gpsSummary: $("gpsSummary"),
  gpsLatitude: $("gpsLatitude"),
  gpsLongitude: $("gpsLongitude"),
  gpsAccuracy: $("gpsAccuracy"),
  captureGps: $("captureGps"),
  gpsStatus: $("gpsStatus"),
  dryingConfiguration: $("dryingConfiguration"),
  tablePhotos: $("tablePhotos"),
  tablePhotoPreview: $("tablePhotoPreview"),
  baySelector: $("baySelector"),
  bayProgress: $("bayProgress"),
  bayEditorTitle: $("bayEditorTitle"),
  bayEditor: $("bayEditor"),
  dryingDuration: $("dryingDuration"),
  weightLoss: $("weightLoss"),
  loadingPhoto: $("loadingPhoto"),
  unloadingPhoto: $("unloadingPhoto"),
  loadingPhotoPreview: $("loadingPhotoPreview"),
  unloadingPhotoPreview: $("unloadingPhotoPreview"),
  previousBay: $("previousBay"),
  nextBay: $("nextBay"),
  baySummaryBody: $("baySummaryBody"),
  generalObservations: $("generalObservations"),
  workingWell: $("workingWell"),
  notWorking: $("notWorking"),
  confirmedAccurate: $("confirmedAccurate"),
  saveStatus: $("saveStatus"),
  clearForm: $("clearForm"),
  submitForm: $("submitForm"),
  successPanel: $("successPanel"),
  successSummary: $("successSummary"),
  receiptNumber: $("receiptNumber"),
  receiptLocation: $("receiptLocation"),
  receiptBays: $("receiptBays"),
  receiptPhotos: $("receiptPhotos"),
  newRecord: $("newRecord"),
  topNewRecord: $("topNewRecord"),
  activeRecordBanner: $("activeRecordBanner"),
  activeReceiptNumber: $("activeReceiptNumber"),
  activeRecordStatus: $("activeRecordStatus"),
  recordsStatus: $("recordsStatus"),
  recordsList: $("recordsList"),
  refreshRecords: $("refreshRecords"),
  batiTrialsBody: $("batiTrialsBody"),
  trialSaveStatus: $("trialSaveStatus")
};

const bayControls = [...document.querySelectorAll("[data-bay-field]")];
const draftControls = [...document.querySelectorAll("[data-draft]")];

let state = freshState();
let draftTimer = null;

initialize();

function freshState() {
  return {
    currentBay: 1,
    bayCount: 8,
    bays: {},
    files: { table: [], bays: {} },
    submissionId: null,
    uploadToken: null,
    receiptNumber: null,
    recordStatus: "in_progress",
    savedPhotos: { table: 0, bays: {} },
    records: [],
    recordsLoading: false,
    recordsStatusKey: "records.loading",
    recordsStatusArgs: {},
    recordsStatusError: false,
    submitting: false,
    trials: CONFIG.trials.map((trial) => ({
      ...trial,
      assignments: trial.assignments.map((assignment) => ({ ...assignment })),
      startDate: trial.startDate || "",
      finishDate: trial.finishDate || "",
      completed: false
    })),
    gpsStatusKey: "gps.hint",
    gpsStatusArgs: {},
    gpsStatusError: false
  };
}

function initialize() {
  initDryingLanguage();
  setDefaultDateTime();
  restoreDraft();
  loadRememberedEnumerator();
  bindEvents();
  applyLocationSelection(false);
  renderAll();
  renderTrials();
  loadTrialSchedule();
  loadRecords();
}

function bindEvents() {
  els.dryerLocation.addEventListener("change", () => {
    applyLocationSelection(true);
    scheduleDraftSave();
  });

  draftControls.forEach((control) => {
    const eventName = control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(eventName, () => {
      if ([els.gpsLatitude, els.gpsLongitude, els.gpsAccuracy].includes(control)) updateGpsSummary();
      scheduleDraftSave();
    });
  });

  els.rememberEnumerator.addEventListener("change", updateRememberedEnumerator);
  [els.enumeratorName, els.enumeratorId].forEach((control) => {
    control.addEventListener("input", () => {
      if (els.rememberEnumerator.checked) saveRememberedEnumerator();
    });
  });

  bayControls.forEach((control) => {
    const eventName = control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(eventName, () => {
      captureBayEditor();
      renderBayStatus();
      renderMetrics();
      renderBaySummary();
      scheduleDraftSave();
    });
  });

  els.tablePhotos.addEventListener("change", () => {
    const files = acceptedFiles(els.tablePhotos.files, 5);
    state.files.table = files;
    renderPhotoPreview(els.tablePhotoPreview, files, state.savedPhotos.table);
    scheduleDraftSave();
  });

  els.loadingPhoto.addEventListener("change", () => setBayPhoto("loading", els.loadingPhoto.files[0]));
  els.unloadingPhoto.addEventListener("change", () => setBayPhoto("unloading", els.unloadingPhoto.files[0]));

  els.baySelector.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bay]");
    if (button) selectBay(Number(button.dataset.bay));
  });

  els.baySummaryBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bay]");
    if (!button) return;
    selectBay(Number(button.dataset.bay));
    els.bayEditor.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  });

  const updateTrial = async (event) => {
    const control = event.target.closest("[data-trial-code]");
    if (!control) return;
    const trial = state.trials.find((item) => item.trialCode === control.dataset.trialCode);
    if (!trial) return;
    const previous = trial.completed;
    trial.completed = control.checked;
    control.closest("tr")?.classList.toggle("is-complete", trial.completed);
    await saveTrialCompletion(trial, control, previous);
  };
  els.batiTrialsBody.addEventListener("change", updateTrial);

  els.previousBay.addEventListener("click", () => selectBay(Math.max(1, state.currentBay - 1)));
  els.nextBay.addEventListener("click", saveCurrentBay);
  els.captureGps.addEventListener("click", captureGps);
  els.clearForm.addEventListener("click", clearFormWithConfirmation);
  els.newRecord.addEventListener("click", resetForNewRecord);
  els.topNewRecord.addEventListener("click", startNewRecord);
  els.refreshRecords.addEventListener("click", loadRecords);
  els.recordsList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-edit-receipt]");
    if (button) openSavedRecord(button.dataset.editReceipt);
  });
  els.form.addEventListener("submit", submitForm);
  document.addEventListener("seaweed-drying-language-change", renderLanguageDependentContent);
}

function renderLanguageDependentContent() {
  captureBayEditor();
  renderAll();
  renderTrials();
  renderGpsStatus();
  renderRecords();
  renderActiveRecordBanner();
  if (!state.submitting) els.submitForm.textContent = t("action.submit");
}

function setDefaultDateTime() {
  if (!els.recordedAt.value) els.recordedAt.value = localDateTimeValue(new Date());
}

function localDateTimeValue(date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function restoreDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(CONFIG.draftStorageKey) || "null");
  } catch {
    draft = null;
  }
  if (!draft || typeof draft !== "object") return;

  const savedAt = Date.parse(draft.savedAt || "");
  if (Number.isFinite(savedAt) && Date.now() - savedAt > 30 * 24 * 60 * 60 * 1000) {
    localStorage.removeItem(CONFIG.draftStorageKey);
    return;
  }

  Object.entries(draft.root || {}).forEach(([id, value]) => {
    const control = $(id);
    if (!control || !control.matches("[data-draft]")) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value ?? "";
  });

  state.currentBay = clampInteger(draft.currentBay, 1, 8, 1);
  state.bayCount = clampInteger(draft.bayCount, 1, 8, 8);
  state.bays = sanitizeBays(draft.bays);
  state.submissionId = isUuid(draft.submissionId) ? draft.submissionId : null;
  state.uploadToken = typeof draft.uploadToken === "string" ? draft.uploadToken : null;
  state.receiptNumber = typeof draft.receiptNumber === "string" ? draft.receiptNumber : null;
  state.recordStatus = draft.recordStatus === "complete" ? "complete" : "in_progress";
  state.savedPhotos = sanitizeSavedPhotos(draft.savedPhotos);
  if (state.receiptNumber && state.submissionId && state.uploadToken) {
    rememberRecordAccess(state.receiptNumber, state.submissionId, state.uploadToken);
  }
}

function loadRememberedEnumerator() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(CONFIG.enumeratorStorageKey) || "null");
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") {
    els.rememberEnumerator.checked = false;
    return;
  }
  els.rememberEnumerator.checked = true;
  if (!els.enumeratorName.value) els.enumeratorName.value = saved.name || "";
  if (!els.enumeratorId.value) els.enumeratorId.value = saved.id || "";
}

function updateRememberedEnumerator() {
  if (els.rememberEnumerator.checked) saveRememberedEnumerator();
  else {
    try {
      localStorage.removeItem(CONFIG.enumeratorStorageKey);
    } catch {
      // Ignore storage restrictions.
    }
  }
}

function saveRememberedEnumerator() {
  try {
    localStorage.setItem(CONFIG.enumeratorStorageKey, JSON.stringify({
      name: els.enumeratorName.value.trim(),
      id: els.enumeratorId.value.trim()
    }));
  } catch {
    // The form remains usable when device storage is unavailable.
  }
}

function sanitizeBays(value) {
  const allowed = new Set([
    "loading_at",
    "loading_weight_kg",
    "loading_weather",
    "unloading_at",
    "unloading_weight_kg",
    "unloading_weather",
    "notes"
  ]);
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([bayNumber, bay]) => {
    const clean = Object.fromEntries(Object.entries(bay || {}).filter(([key]) => allowed.has(key)));
    if (clean.loading_weight_kg === undefined && nullableNumber(bay?.loading_weight_g) !== null) {
      clean.loading_weight_kg = nullableNumber(bay.loading_weight_g) / 1000;
    }
    if (clean.unloading_weight_kg === undefined && nullableNumber(bay?.unloading_weight_g) !== null) {
      clean.unloading_weight_kg = nullableNumber(bay.unloading_weight_g) / 1000;
    }
    return [bayNumber, clean];
  }));
}

function sanitizeSavedPhotos(value) {
  const table = clampInteger(value?.table, 0, 5, 0);
  const bays = {};
  Object.entries(value?.bays || {}).forEach(([bayNumber, phases]) => {
    bays[bayNumber] = {
      loading: clampInteger(phases?.loading, 0, 1, 0),
      unloading: clampInteger(phases?.unloading, 0, 1, 0)
    };
  });
  return { table, bays };
}

function scheduleDraftSave() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(saveDraft, 350);
}

function saveDraft() {
  captureBayEditor();
  const root = {};
  draftControls.forEach((control) => {
    root[control.id] = control.type === "checkbox" ? control.checked : control.value;
  });
  const savedAt = new Date().toISOString();
  const draft = {
    version: 2,
    savedAt,
    root,
    currentBay: state.currentBay,
    bayCount: state.bayCount,
    bays: state.bays,
    submissionId: state.submissionId,
    uploadToken: state.uploadToken,
    receiptNumber: state.receiptNumber,
    recordStatus: state.recordStatus,
    savedPhotos: state.savedPhotos
  };
  try {
    localStorage.setItem(CONFIG.draftStorageKey, JSON.stringify(draft));
  } catch {
    // Draft storage is optional; the form remains usable when it is unavailable.
  }
}

function applyLocationSelection(resetCurrentBay) {
  const location = selectedLocation();
  if (location) state.bayCount = location.bayCount;
  if (resetCurrentBay || state.currentBay > state.bayCount) state.currentBay = 1;
  renderAll();
}

function selectedLocation() {
  return CONFIG.locations.find((location) => location.value === els.dryerLocation.value) || null;
}

function captureBayEditor() {
  const bay = ensureBay(state.currentBay);
  bayControls.forEach((control) => {
    bay[control.dataset.bayField] = control.value;
  });
}

function ensureBay(bayNumber) {
  const key = String(bayNumber);
  if (!state.bays[key] || typeof state.bays[key] !== "object") state.bays[key] = {};
  return state.bays[key];
}

function ensureBayFiles(bayNumber) {
  const key = String(bayNumber);
  if (!state.files.bays[key]) state.files.bays[key] = { loading: null, unloading: null };
  return state.files.bays[key];
}

function savedBayPhotos(bayNumber) {
  const key = String(bayNumber);
  if (!state.savedPhotos.bays[key]) state.savedPhotos.bays[key] = { loading: 0, unloading: 0 };
  return state.savedPhotos.bays[key];
}

function selectBay(bayNumber) {
  if (!Number.isInteger(bayNumber) || bayNumber < 1 || bayNumber > state.bayCount) return;
  captureBayEditor();
  state.currentBay = bayNumber;
  renderAll();
  scheduleDraftSave();
}

function renderAll() {
  renderBaySelector();
  renderBayEditor();
  renderBayStatus();
  renderBaySummary();
  updateGpsSummary();
  renderPhotoPreview(els.tablePhotoPreview, state.files.table, state.savedPhotos.table);
  renderActiveRecordBanner();
}

function renderActiveRecordBanner() {
  const active = Boolean(state.receiptNumber);
  els.activeRecordBanner.hidden = !active;
  if (!active) return;
  els.activeReceiptNumber.textContent = state.receiptNumber;
  els.activeRecordStatus.textContent = t(state.recordStatus === "complete" ? "records.complete" : "records.inProgress");
  els.activeRecordStatus.classList.toggle("is-complete", state.recordStatus === "complete");
}

function renderBaySelector() {
  els.baySelector.replaceChildren();
  for (let bayNumber = 1; bayNumber <= state.bayCount; bayNumber += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.bay = String(bayNumber);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(bayNumber === state.currentBay));
    button.textContent = t("bay.label", { number: bayNumber });
    applyBayStatusClass(button, bayNumber);
    els.baySelector.append(button);
  }
}

function renderBayEditor() {
  const bay = ensureBay(state.currentBay);
  bayControls.forEach((control) => {
    control.value = bay[control.dataset.bayField] ?? "";
  });
  els.bayEditorTitle.textContent = t("bay.label", { number: state.currentBay });
  els.previousBay.disabled = state.currentBay === 1;
  els.nextBay.disabled = state.submitting;
  els.nextBay.textContent = state.currentBay === state.bayCount ? t("bay.save") : t("bay.next");
  els.loadingPhoto.value = "";
  els.unloadingPhoto.value = "";
  const files = ensureBayFiles(state.currentBay);
  const savedPhotos = savedBayPhotos(state.currentBay);
  renderPhotoPreview(els.loadingPhotoPreview, files.loading ? [files.loading] : [], savedPhotos.loading);
  renderPhotoPreview(els.unloadingPhotoPreview, files.unloading ? [files.unloading] : [], savedPhotos.unloading);
  renderMetrics();
}

function renderBayStatus() {
  els.baySelector.querySelectorAll("button[data-bay]").forEach((button) => {
    applyBayStatusClass(button, Number(button.dataset.bay));
  });
  const entered = activeBayNumbers().filter((bayNumber) => bayHasData(bayNumber)).length;
  els.bayProgress.textContent = t("bay.progress", { entered, total: state.bayCount });
}

function applyBayStatusClass(button, bayNumber) {
  button.classList.toggle("has-data", bayHasData(bayNumber));
  button.classList.toggle("complete", bayIsComplete(bayNumber));
  const statusKey = bayIsComplete(bayNumber) ? "bay.complete" : bayHasData(bayNumber) ? "bay.started" : "bay.empty";
  button.setAttribute("aria-label", `${t("bay.label", { number: bayNumber })}, ${t(statusKey)}`);
}

function bayHasData(bayNumber) {
  const bay = ensureBay(bayNumber);
  const hasField = Object.values(bay).some((value) => String(value ?? "").trim() !== "");
  const files = ensureBayFiles(bayNumber);
  const savedPhotos = savedBayPhotos(bayNumber);
  return hasField || Boolean(files.loading || files.unloading || savedPhotos.loading || savedPhotos.unloading);
}

function bayIsComplete(bayNumber) {
  const bay = ensureBay(bayNumber);
  return Boolean(
    String(bay.loading_at || "").trim()
    && String(bay.loading_weight_kg || "").trim()
    && String(bay.unloading_at || "").trim()
    && String(bay.unloading_weight_kg || "").trim()
  );
}

function activeBayNumbers() {
  return Array.from({ length: state.bayCount }, (_, index) => index + 1);
}

function renderMetrics() {
  const bay = ensureBay(state.currentBay);
  els.dryingDuration.textContent = dryingDurationLabel(bay);
  els.weightLoss.textContent = weightLossLabel(bay);
}

function dryingDurationLabel(bay) {
  if (!bay.loading_at || !bay.unloading_at) return "-";
  const start = new Date(bay.loading_at).getTime();
  const end = new Date(bay.unloading_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return t("bay.checkTimes");
  const minutes = Math.round((end - start) / 60_000);
  return t("bay.duration", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function weightLossLabel(bay) {
  const wet = nullableNumber(bay.loading_weight_kg);
  const dry = nullableNumber(bay.unloading_weight_kg);
  if (wet === null || dry === null || wet <= 0) return "-";
  return `${(((wet - dry) / wet) * 100).toFixed(1)}%`;
}

function renderBaySummary() {
  els.baySummaryBody.replaceChildren();
  activeBayNumbers().forEach((bayNumber) => {
    const bay = ensureBay(bayNumber);
    const files = ensureBayFiles(bayNumber);
    const savedPhotos = savedBayPhotos(bayNumber);
    const row = document.createElement("tr");
    const values = [
      t("bay.label", { number: bayNumber }),
      formatLocalInput(bay.loading_at),
      displayNumber(bay.loading_weight_kg, 2),
      formatLocalInput(bay.unloading_at),
      displayNumber(bay.unloading_weight_kg, 2),
      dryingDurationLabel(bay),
      `${Number(Boolean(files.loading || savedPhotos.loading)) + Number(Boolean(files.unloading || savedPhotos.unloading))}/2`
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 0) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.bay = String(bayNumber);
        button.textContent = value;
        cell.append(button);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });
    els.baySummaryBody.append(row);
  });
}

function renderTrials() {
  renderTrialSite(els.batiTrialsBody);
}

function renderTrialSite(container) {
  container.replaceChildren();
  state.trials.forEach((trial) => {
    const row = document.createElement("tr");
    row.classList.toggle("is-complete", trial.completed);

    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.className = "trial-label";
    labelCell.textContent = t("trials.trialLabel", {
      number: trial.trialNumber
    });

    const assignmentCell = document.createElement("td");
    const assignmentList = document.createElement("div");
    assignmentList.className = "trial-assignments";
    trial.assignments.forEach((assignment) => {
      const item = document.createElement("span");
      item.className = "trial-assignment";
      const tableName = document.createElement("strong");
      tableName.textContent = tableLabel(assignment.table);
      const configuration = document.createElement("span");
      configuration.className = "trial-config-pills";
      configuration.setAttribute("aria-label", configurationLabel(assignment.configuration));
      configurationParts(assignment.configuration).forEach((part, index) => {
        if (index) {
          const separator = document.createElement("span");
          separator.className = "config-separator";
          separator.textContent = "/";
          configuration.append(separator);
        }
        const pill = document.createElement("span");
        pill.className = `config-pill ${part.className}`;
        pill.textContent = part.text;
        configuration.append(pill);
      });
      item.append(tableName, configuration);
      assignmentList.append(item);
    });
    assignmentCell.append(assignmentList);

    const dateCells = [createFixedTrialDateCell(trial)];

    const completeCell = document.createElement("td");
    completeCell.className = "trial-complete-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = trial.completed;
    checkbox.className = "trial-complete";
    checkbox.dataset.trialCode = trial.trialCode;
    checkbox.setAttribute("aria-label", `${labelCell.textContent}: ${t("trials.complete")}`);
    completeCell.append(checkbox);

    row.append(labelCell, assignmentCell, ...dateCells, completeCell);
    container.append(row);
  });
}

function createFixedTrialDateCell(trial) {
  const cell = document.createElement("td");
  const label = document.createElement("span");
  label.className = "trial-date-pill";
  label.textContent = fixedTrialDateLabel(trial.startDate, trial.finishDate);
  cell.append(label);
  return cell;
}

function fixedTrialDateLabel(startValue, finishValue) {
  const start = parseFixedDate(startValue);
  const finish = parseFixedDate(finishValue);
  if (!start || !finish) return "-";
  const month = (date) => new Intl.DateTimeFormat(getLocale(), { month: "long", timeZone: "UTC" }).format(date);
  const startDay = start.getUTCDate();
  const finishDay = finish.getUTCDate();
  if (start.getUTCMonth() === finish.getUTCMonth()) {
    return `${startDay}\u2013${finishDay} ${month(finish)}`;
  }
  return `${startDay} ${month(start)}\u2013${finishDay} ${month(finish)}`;
}

function parseFixedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function loadTrialSchedule() {
  renderTrials();
  try {
    const result = await callRpc(CONFIG.getTrialsRpc, {}, { unwrapSingle: false });
    const savedTrials = extractTrialRows(result);
    savedTrials.forEach((saved) => {
      const trial = state.trials.find((item) => item.trialCode === saved.trial_code);
      if (!trial) return;
      trial.completed = Boolean(saved.completed);
    });
  } catch (error) {
    if (!isDatabasePendingError(error)) {
      showTrialError(t("trials.loadFailed"));
    }
  }
  renderTrials();
}

function extractTrialRows(result) {
  if (Array.isArray(result)) {
    if (result.length === 1 && Array.isArray(result[0])) return result[0];
    return result;
  }
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result.trials)) return result.trials;
  const nested = Object.values(result).find(Array.isArray);
  return nested || [];
}

async function saveTrialCompletion(trial, control, previous) {
  control.disabled = true;
  els.trialSaveStatus.hidden = true;
  els.trialSaveStatus.textContent = "";
  try {
    await callRpc(CONFIG.updateTrialsRpc, {
      p_updates: [{
        trial_code: trial.trialCode,
        completed: trial.completed
      }]
    }, { unwrapSingle: false });
  } catch (error) {
    trial.completed = previous;
    showTrialError(t("trials.saveFailed", { message: friendlyError(error) }));
  } finally {
    control.disabled = false;
    renderTrials();
  }
}

function showTrialError(message) {
  els.trialSaveStatus.textContent = message;
  els.trialSaveStatus.dataset.status = "error";
  els.trialSaveStatus.hidden = false;
}

async function loadRecords() {
  if (state.recordsLoading) return;
  state.recordsLoading = true;
  state.recordsStatusKey = "records.loading";
  state.recordsStatusArgs = {};
  state.recordsStatusError = false;
  renderRecords();
  try {
    const result = await callRpc(CONFIG.listRecordsRpc, { p_limit: 50 }, { unwrapSingle: false });
    state.records = extractRecordRows(result);
    state.recordsStatusKey = state.records.length ? "records.loaded" : "records.empty";
    state.recordsStatusArgs = { count: state.records.length };
  } catch (error) {
    state.recordsStatusKey = isDatabasePendingError(error) ? "records.preview" : "records.loadFailed";
    state.recordsStatusArgs = { message: simpleErrorMessage(error) };
    state.recordsStatusError = true;
  } finally {
    state.recordsLoading = false;
    renderRecords();
  }
}

function extractRecordRows(result) {
  if (Array.isArray(result)) {
    if (result.length === 1 && Array.isArray(result[0])) return result[0];
    return result;
  }
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result.records)) return result.records;
  return [];
}

function renderRecords() {
  els.refreshRecords.disabled = state.recordsLoading;
  els.recordsStatus.textContent = t(state.recordsStatusKey, state.recordsStatusArgs);
  els.recordsStatus.dataset.status = state.recordsStatusError ? "error" : "";
  els.recordsList.replaceChildren();
  state.records.forEach((record) => els.recordsList.append(createRecordCard(record)));
}

function createRecordCard(record) {
  const card = document.createElement("article");
  card.className = "record-card";

  const head = document.createElement("div");
  head.className = "record-card-head";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = record.receipt_number || "-";
  const meta = document.createElement("p");
  meta.className = "record-card-meta";
  meta.textContent = `${tableLabel(record.table_location)} · ${formatRecordDate(record.recorded_at)}`;
  titleWrap.append(title, meta);
  const status = document.createElement("span");
  const complete = record.record_status === "complete";
  status.className = "record-status-pill";
  status.classList.toggle("is-complete", complete);
  status.textContent = t(complete ? "records.complete" : "records.inProgress");
  head.append(titleWrap, status);

  const bayGrid = document.createElement("div");
  bayGrid.className = "record-bay-grid";
  const bayStates = Array.isArray(record.bay_states) ? record.bay_states : [];
  bayStates.forEach((bay) => {
    const pill = document.createElement("span");
    const bayComplete = bay.state === "complete";
    pill.className = "record-bay-pill";
    pill.classList.toggle("is-complete", bayComplete);
    const stateLabel = bayComplete
      ? t("records.bayComplete")
      : bay.state === "loading" ? t("records.bayLoading") : t("records.bayStarted");
    pill.textContent = `B${bay.bay_number} · ${stateLabel}`;
    bayGrid.append(pill);
  });

  const footer = document.createElement("div");
  footer.className = "record-card-footer";
  const details = document.createElement("span");
  details.className = "record-edit-hint";
  details.textContent = `${t("records.bays", { count: record.bay_count || bayStates.length })} · ${t("records.updated", { date: formatRecordDate(record.updated_at) })}`;
  const edit = document.createElement("button");
  edit.type = "button";
  const access = recordAccessFor(record.receipt_number);
  edit.disabled = !access;
  edit.textContent = t(access ? "records.edit" : "records.viewOnly");
  edit.title = access ? t("records.edit") : t("records.editHint");
  if (access) edit.dataset.editReceipt = record.receipt_number;
  footer.append(details, edit);

  card.append(head, bayGrid, footer);
  return card;
}

async function openSavedRecord(receiptNumber) {
  const access = recordAccessFor(receiptNumber);
  if (!access || state.submitting) return;
  if (formHasMeaningfulData() && state.receiptNumber !== receiptNumber
      && !window.confirm(t("confirm.editRecord", { receipt: receiptNumber }))) return;
  els.recordsStatus.textContent = t("records.opening", { receipt: receiptNumber });
  els.recordsStatus.dataset.status = "";
  try {
    const result = await callRpc(CONFIG.getRecordRpc, {
      p_submission_id: access.id,
      p_edit_token: access.token
    });
    hydrateSavedRecord(result?.record || result, access);
  } catch (error) {
    els.recordsStatus.textContent = t("records.editFailed", {
      receipt: receiptNumber,
      message: simpleErrorMessage(error)
    });
    els.recordsStatus.dataset.status = "error";
  }
}

function hydrateSavedRecord(record, access) {
  if (!record || typeof record !== "object") throw new Error("Invalid saved record");
  resetForNewRecord({ scroll: false });
  state.submissionId = access.id;
  state.uploadToken = access.token;
  state.receiptNumber = record.receipt_number || null;
  state.recordStatus = record.record_status === "complete" ? "complete" : "in_progress";
  state.savedPhotos.table = clampInteger(record.table_photo_count, 0, 5, 0);

  els.dryerLocation.value = record.dryer_location_code || "";
  els.enumeratorName.value = record.enumerator_name || "";
  els.enumeratorId.value = record.enumerator_id || "";
  els.recordedAt.value = localDateTimeFromIso(record.recorded_at);
  els.gpsLatitude.value = record.gps_latitude ?? "";
  els.gpsLongitude.value = record.gps_longitude ?? "";
  els.gpsAccuracy.value = record.gps_accuracy_m ?? "";
  els.dryingConfiguration.value = record.drying_configuration || "";
  els.generalObservations.value = record.general_observations || "";
  els.workingWell.value = record.working_well || "";
  els.notWorking.value = record.not_working || "";
  els.confirmedAccurate.checked = Boolean(record.confirmed_accurate);

  state.bays = {};
  (Array.isArray(record.bays) ? record.bays : []).forEach((bay) => {
    const key = String(bay.bay_number);
    state.bays[key] = {
      loading_at: localDateTimeFromIso(bay.loading_at),
      loading_weight_kg: bay.loading_weight_kg ?? "",
      loading_weather: bay.loading_weather || "",
      unloading_at: localDateTimeFromIso(bay.unloading_at),
      unloading_weight_kg: bay.unloading_weight_kg ?? "",
      unloading_weather: bay.unloading_weather || "",
      notes: bay.notes || ""
    };
    state.savedPhotos.bays[key] = {
      loading: clampInteger(bay.loading_photo_count, 0, 1, 0),
      unloading: clampInteger(bay.unloading_photo_count, 0, 1, 0)
    };
  });
  applyLocationSelection(false);
  state.currentBay = firstOpenBay();
  els.formPanel.hidden = false;
  els.successPanel.hidden = true;
  setStatus(t("records.editing"), "success");
  renderAll();
  saveDraft();
  els.formPanel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  loadRecords();
}

function firstOpenBay() {
  return activeBayNumbers().find((bayNumber) => bayHasData(bayNumber) && !bayIsComplete(bayNumber))
    || activeBayNumbers().find((bayNumber) => !bayHasData(bayNumber))
    || 1;
}

function formHasMeaningfulData() {
  return Boolean(
    state.submissionId
    || els.dryerLocation.value
    || els.enumeratorName.value.trim()
    || Object.keys(state.bays).some((bayNumber) => bayHasData(Number(bayNumber)))
    || state.files.table.length
  );
}

function setBayPhoto(phase, file) {
  const accepted = acceptedFiles(file ? [file] : [], 1);
  const files = ensureBayFiles(state.currentBay);
  files[phase] = accepted[0] || null;
  const preview = phase === "loading" ? els.loadingPhotoPreview : els.unloadingPhotoPreview;
  renderPhotoPreview(preview, files[phase] ? [files[phase]] : [], savedBayPhotos(state.currentBay)[phase]);
  renderBayStatus();
  renderBaySummary();
  scheduleDraftSave();
}

function acceptedFiles(fileList, limit) {
  const accepted = [];
  for (const file of [...fileList].slice(0, limit)) {
    if (!file.type.startsWith("image/")) {
      setStatus(t("photo.notImage", { name: file.name }), "error");
      continue;
    }
    if (file.size > 25 * 1024 * 1024) {
      setStatus(t("photo.tooLarge", { name: file.name }), "error");
      continue;
    }
    accepted.push(file);
  }
  if (fileList.length > limit) setStatus(t("photo.limit", { limit }), "warning");
  return accepted;
}

function renderPhotoPreview(container, files, savedCount = 0) {
  container.replaceChildren();
  if (savedCount) {
    const saved = document.createElement("span");
    saved.className = "photo-chip saved-photo-chip";
    saved.textContent = savedCount > 1 ? `${t("photo.saved")} (${savedCount})` : t("photo.saved");
    container.append(saved);
  }
  files.forEach((file) => {
    const chip = document.createElement("span");
    chip.className = "photo-chip";
    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.alt = t("photo.previewAlt");
    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
    const name = document.createElement("span");
    name.textContent = `${file.name} (${formatBytes(file.size)})`;
    chip.append(image, name);
    container.append(chip);
  });
}

function captureGps() {
  if (!navigator.geolocation) {
    setGpsStatus("gps.unavailable", {}, true);
    return;
  }
  els.captureGps.disabled = true;
  els.captureGps.textContent = t("gps.locating");
  setGpsStatus("gps.requesting");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      els.gpsLatitude.value = position.coords.latitude.toFixed(6);
      els.gpsLongitude.value = position.coords.longitude.toFixed(6);
      els.gpsAccuracy.value = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy.toFixed(1) : "";
      updateGpsSummary();
      setGpsStatus("gps.captured", {
        accuracy: Number.isFinite(position.coords.accuracy) ? ` ±${Math.round(position.coords.accuracy)} m` : ""
      });
      els.captureGps.disabled = false;
      els.captureGps.textContent = t("gps.refresh");
      scheduleDraftSave();
    },
    (error) => {
      const key = { 1: "gps.permission", 2: "gps.position", 3: "gps.timeout" }[error.code] || "gps.failed";
      setGpsStatus(key, {}, true);
      els.captureGps.disabled = false;
      els.captureGps.textContent = t("gps.capture");
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
  );
}

function updateGpsSummary() {
  const latitude = nullableNumber(els.gpsLatitude.value);
  const longitude = nullableNumber(els.gpsLongitude.value);
  const accuracy = nullableNumber(els.gpsAccuracy.value);
  if (latitude === null && longitude === null) {
    els.gpsSummary.value = "";
    return;
  }
  if (latitude === null || longitude === null) {
    els.gpsSummary.value = t("gps.enterBoth");
    return;
  }
  els.gpsSummary.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}${accuracy !== null ? ` (±${Math.round(accuracy)} m)` : ""}`;
}

function setGpsStatus(key, args = {}, isError = false) {
  state.gpsStatusKey = key;
  state.gpsStatusArgs = args;
  state.gpsStatusError = isError;
  renderGpsStatus();
}

function renderGpsStatus() {
  els.gpsStatus.textContent = t(state.gpsStatusKey, state.gpsStatusArgs);
  els.gpsStatus.style.color = state.gpsStatusError ? "var(--danger)" : "";
}

async function saveCurrentBay() {
  if (state.submitting) return;
  captureBayEditor();
  const bayNumber = state.currentBay;
  const validationMessage = validateIncrementalBay(bayNumber);
  if (validationMessage) {
    setStatus(validationMessage, "error");
    return;
  }

  ensureRecordIdentity();
  saveDraft();
  state.submitting = true;
  setSubmittingUi(true);
  setStatus(t("bay.saving", { number: bayNumber }));
  let receipt;
  try {
    receipt = await callRpc(CONFIG.submitRpc, {
      p_payload: buildPayload(false),
      p_upload_token: state.uploadToken
    });
    acceptSavedReceipt(receipt);
    saveDraft();
    const photoResult = await uploadSelectedPhotos({ bayNumbers: [bayNumber], includeTable: true });
    applyUploadedPhotoResult(photoResult);
    saveDraft();
    renderAll();
    setStatus(t("bay.saved", { number: bayNumber, receipt: state.receiptNumber }), "success");
    loadRecords();
    if (bayNumber < state.bayCount) selectBay(bayNumber + 1);
  } catch (error) {
    const receiptHint = receipt?.receipt_number
      ? t("status.recordSavedPhotos", { receipt: receipt.receipt_number })
      : "";
    setStatus(`${friendlyError(error)}${receiptHint}`, receipt ? "warning" : "error");
    saveDraft();
  } finally {
    state.submitting = false;
    setSubmittingUi(false);
    renderBayEditor();
  }
}

function validateIncrementalBay(bayNumber) {
  const coreMessage = validateCoreRecordFields();
  if (coreMessage) return coreMessage;
  const bay = ensureBay(bayNumber);
  const files = ensureBayFiles(bayNumber);
  const savedPhotos = savedBayPhotos(bayNumber);
  const loadingStarted = phaseHasData(bay, files, savedPhotos, "loading");
  const unloadingStarted = phaseHasData(bay, files, savedPhotos, "unloading");
  if (!loadingStarted && !unloadingStarted) return t("validation.bayEmpty", { bay: bayNumber });

  const required = [];
  if (loadingStarted) required.push(
    ["loading_at", "validation.loadingTime"],
    ["loading_weight_kg", "validation.wetWeight"]
  );
  if (unloadingStarted) required.push(
    ["unloading_at", "validation.unloadingTime"],
    ["unloading_weight_kg", "validation.dryWeight"]
  );
  const missing = required.find(([key]) => !String(bay[key] ?? "").trim());
  if (missing) return t("validation.phaseMissing", { bay: bayNumber, field: t(missing[1]) });
  if (bay.loading_at && bay.unloading_at
      && new Date(bay.unloading_at).getTime() < new Date(bay.loading_at).getTime()) {
    return t("validation.timeOrder", { bay: bayNumber });
  }
  return "";
}

function validateCoreRecordFields() {
  for (const control of [els.dryerLocation, els.enumeratorName, els.recordedAt, els.dryingConfiguration]) {
    if (!control.checkValidity()) {
      control.reportValidity();
      return t("validation.required");
    }
  }
  const latitude = nullableNumber(els.gpsLatitude.value);
  const longitude = nullableNumber(els.gpsLongitude.value);
  if ((latitude === null) !== (longitude === null)) return t("validation.gpsPair");
  return "";
}

function phaseHasData(bay, files, savedPhotos, phase) {
  return Boolean(
    String(bay[`${phase}_at`] ?? "").trim()
    || String(bay[`${phase}_weight_kg`] ?? "").trim()
    || String(bay[`${phase}_weather`] ?? "").trim()
    || files[phase]
    || savedPhotos[phase]
  );
}

function ensureRecordIdentity() {
  state.submissionId ||= createUuid();
  state.uploadToken ||= createUploadToken();
}

function acceptSavedReceipt(receipt) {
  state.receiptNumber = receipt?.receipt_number || state.receiptNumber || state.submissionId;
  state.recordStatus = receipt?.record_status === "complete" ? "complete" : "in_progress";
  rememberRecordAccess(state.receiptNumber, state.submissionId, state.uploadToken);
  renderActiveRecordBanner();
}

async function submitForm(event) {
  event.preventDefault();
  if (state.submitting) return;
  captureBayEditor();
  els.form.classList.add("was-validated");

  const validationMessage = validateForm();
  if (validationMessage) {
    setStatus(validationMessage, "error");
    return;
  }

  ensureRecordIdentity();
  saveDraft();
  state.submitting = true;
  setSubmittingUi(true);

  let receipt;
  try {
    setStatus(t("status.savingRecord"));
    receipt = await callRpc(CONFIG.submitRpc, {
      p_payload: buildPayload(true),
      p_upload_token: state.uploadToken
    });
    acceptSavedReceipt(receipt);
    saveDraft();
    const photoResult = await uploadSelectedPhotos();
    applyUploadedPhotoResult(photoResult);
    localStorage.removeItem(CONFIG.draftStorageKey);
    showSuccess(receipt, { count: totalSavedPhotoCount(), attached: photoResult.attached });
    loadRecords();
  } catch (error) {
    const receiptHint = receipt?.receipt_number
      ? t("status.recordSavedPhotos", { receipt: receipt.receipt_number })
      : "";
    setStatus(`${friendlyError(error)}${receiptHint}`, receipt ? "warning" : "error");
    saveDraft();
  } finally {
    state.submitting = false;
    setSubmittingUi(false);
  }
}

function validateForm() {
  if (!els.form.checkValidity()) {
    els.form.reportValidity();
    return t("validation.required");
  }

  const latitude = nullableNumber(els.gpsLatitude.value);
  const longitude = nullableNumber(els.gpsLongitude.value);
  if ((latitude === null) !== (longitude === null)) return t("validation.gpsPair");

  const enteredBays = activeBayNumbers().filter((bayNumber) => bayHasData(bayNumber));
  if (!enteredBays.length) {
    selectBay(1);
    return t("validation.oneBay");
  }

  for (const bayNumber of enteredBays) {
    const bay = ensureBay(bayNumber);
    const required = [
      ["loading_at", "validation.loadingTime"],
      ["loading_weight_kg", "validation.wetWeight"],
      ["unloading_at", "validation.unloadingTime"],
      ["unloading_weight_kg", "validation.dryWeight"]
    ];
    const missing = required.find(([key]) => !String(bay[key] || "").trim());
    if (missing) {
      selectBay(bayNumber);
      return t("validation.bayMissing", { bay: bayNumber, field: t(missing[1]) });
    }
    const loadingAt = new Date(bay.loading_at).getTime();
    const unloadingAt = new Date(bay.unloading_at).getTime();
    if (Number.isFinite(loadingAt) && Number.isFinite(unloadingAt) && unloadingAt < loadingAt) {
      selectBay(bayNumber);
      return t("validation.timeOrder", { bay: bayNumber });
    }
  }
  return "";
}

function buildPayload(finalize) {
  const location = selectedLocation();
  return {
    submission_id: state.submissionId,
    station_uid: location?.stationUid || null,
    dryer_location_code: location?.value || null,
    table_location: location?.label || null,
    enumerator_name: els.enumeratorName.value.trim(),
    enumerator_id: nullableText(els.enumeratorId.value),
    recorded_at: toIso(els.recordedAt.value),
    gps_latitude: nullableNumber(els.gpsLatitude.value),
    gps_longitude: nullableNumber(els.gpsLongitude.value),
    gps_accuracy_m: nullableNumber(els.gpsAccuracy.value),
    drying_configuration: els.dryingConfiguration.value,
    general_observations: nullableText(els.generalObservations.value),
    working_well: nullableText(els.workingWell.value),
    not_working: nullableText(els.notWorking.value),
    confirmed_accurate: els.confirmedAccurate.checked,
    finalize: Boolean(finalize),
    website: els.website.value,
    source: "public_web_form",
    client_version: CONFIG.clientVersion,
    bays: activeBayNumbers()
      .filter((bayNumber) => bayHasData(bayNumber))
      .map((bayNumber) => bayPayload(bayNumber))
  };
}

function bayPayload(bayNumber) {
  const bay = ensureBay(bayNumber);
  return {
    bay_number: bayNumber,
    loading_at: toIso(bay.loading_at),
    loading_weight_kg: nullableNumber(bay.loading_weight_kg),
    loading_weather: nullableText(bay.loading_weather),
    unloading_at: toIso(bay.unloading_at),
    unloading_weight_kg: nullableNumber(bay.unloading_weight_kg),
    unloading_weather: nullableText(bay.unloading_weather),
    notes: nullableText(bay.notes)
  };
}

async function uploadSelectedPhotos({ bayNumbers = activeBayNumbers(), includeTable = true } = {}) {
  const uploads = [];
  if (includeTable) state.files.table.forEach((file) => uploads.push({ kind: "table", file }));
  bayNumbers.forEach((bayNumber) => {
    const files = ensureBayFiles(bayNumber);
    if (files.loading) uploads.push({ kind: "bay", phase: "loading", bayNumber, file: files.loading });
    if (files.unloading) uploads.push({ kind: "bay", phase: "unloading", bayNumber, file: files.unloading });
  });
  if (!uploads.length) return { count: 0, attached: false, bayPhotos: [] };

  const manifest = { bays: [] };
  if (uploads.some((upload) => upload.kind === "table")) manifest.table = [];
  const manifestByBay = new Map();
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    setStatus(t("photo.preparing", { current: index + 1, total: uploads.length }));
    const blob = await preparePhoto(upload.file);
    if (blob.size > CONFIG.maxPhotoBytes) throw new Error(`${upload.file.name} is still larger than 8 MB after compression.`);
    const extension = photoExtension(blob.type);
    const objectId = createUuid();
    const objectPath = upload.kind === "table"
      ? `${state.submissionId}/table/${objectId}.${extension}`
      : `${state.submissionId}/bay-${String(upload.bayNumber).padStart(2, "0")}/${upload.phase}/${objectId}.${extension}`;
    await uploadObject(objectPath, blob);

    if (upload.kind === "table") {
      manifest.table.push(objectPath);
    } else {
      if (!manifestByBay.has(upload.bayNumber)) {
        const bayManifest = { bay_number: upload.bayNumber };
        manifestByBay.set(upload.bayNumber, bayManifest);
        manifest.bays.push(bayManifest);
      }
      manifestByBay.get(upload.bayNumber)[upload.phase] = [objectPath];
    }
  }

  setStatus(t("photo.linking"));
  const attachResult = await callRpc(CONFIG.attachPhotosRpc, {
    p_submission_id: state.submissionId,
    p_upload_token: state.uploadToken,
    p_photos: manifest
  });
  if (manifest.table) {
    state.files.table = [];
    els.tablePhotos.value = "";
  }
  manifest.bays.forEach((bay) => {
    const files = ensureBayFiles(bay.bay_number);
    if (bay.loading) files.loading = null;
    if (bay.unloading) files.unloading = null;
  });
  return {
    count: uploads.length,
    attached: true,
    tableCount: attachResult?.table_photo_count,
    bayPhotos: Array.isArray(attachResult?.bay_photos) ? attachResult.bay_photos : [],
    touchedManifest: manifest
  };
}

function applyUploadedPhotoResult(result) {
  if (!result?.attached) return;
  if (Number.isFinite(Number(result.tableCount))) {
    state.savedPhotos.table = clampInteger(result.tableCount, 0, 5, state.savedPhotos.table);
  } else if (result.touchedManifest?.table) {
    state.savedPhotos.table = Math.min(5, state.savedPhotos.table + result.touchedManifest.table.length);
  }
  result.touchedManifest?.bays?.forEach((bay) => {
    const saved = savedBayPhotos(bay.bay_number);
    if (bay.loading) saved.loading = 1;
    if (bay.unloading) saved.unloading = 1;
  });
  result.bayPhotos?.forEach((bay) => {
    const saved = savedBayPhotos(bay.bay_number);
    saved.loading = clampInteger(bay.loading_photo_count, 0, 1, saved.loading);
    saved.unloading = clampInteger(bay.unloading_photo_count, 0, 1, saved.unloading);
  });
}

function totalSavedPhotoCount() {
  return state.savedPhotos.table + Object.values(state.savedPhotos.bays).reduce(
    (total, bay) => total + Number(Boolean(bay.loading)) + Number(Boolean(bay.unloading)),
    0
  );
}

async function preparePhoto(file) {
  if (["image/heic", "image/heif"].includes(file.type)) {
    if (file.size <= CONFIG.maxPhotoBytes) return file;
    throw new Error(`${file.name} is larger than 8 MB and this browser cannot compress HEIC photos.`);
  }
  if (!window.createImageBitmap) {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= CONFIG.maxPhotoBytes) return file;
    throw new Error(`${file.name} could not be compressed by this browser.`);
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= CONFIG.maxPhotoBytes) return file;
    throw new Error(`${file.name} could not be compressed by this browser.`);
  }

  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1_500_000) {
    bitmap.close?.();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error(`${file.name} could not be compressed.`);
  return blob;
}

async function uploadObject(objectPath, blob) {
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${CONFIG.supabaseUrl}/storage/v1/object/${encodeURIComponent(CONFIG.photoBucket)}/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
        "Content-Type": blob.type || "image/jpeg",
        "x-upsert": "false"
      },
      body: blob
    }
  );
  if (response.ok) return;
  const detail = await response.text();
  if ([400, 409].includes(response.status) && /duplicate|already exists/i.test(detail)) return;
  throw new Error(`Photo upload failed (${response.status})${detail ? `: ${safeServerDetail(detail)}` : ""}`);
}

async function callRpc(functionName, payload, { unwrapSingle = true } = {}) {
  const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    headers: {
      apikey: CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  if (!response.ok) {
    let detail = responseText;
    try {
      const parsed = JSON.parse(responseText);
      detail = parsed.message || parsed.details || parsed.hint || responseText;
    } catch {
      // Keep the text response.
    }
    throw new Error(`${response.status} ${detail || response.statusText}`);
  }
  if (!responseText) return {};
  const parsed = JSON.parse(responseText);
  return unwrapSingle && Array.isArray(parsed) ? parsed[0] || {} : parsed;
}

function showSuccess(receipt, photoResult) {
  const location = selectedLocation();
  els.receiptNumber.textContent = receipt.receipt_number || state.submissionId;
  els.receiptLocation.textContent = location ? tableLabel(location.label) : "-";
  els.receiptBays.textContent = String(
    receipt.bay_count ?? activeBayNumbers().filter((bayNumber) => bayHasData(bayNumber)).length
  );
  els.receiptPhotos.textContent = photoResult.count
    ? t("success.uploaded", { count: photoResult.count })
    : t("success.none");
  els.successSummary.textContent = photoResult.count ? t("success.withPhotos") : t("success.withoutPhotos");
  els.formPanel.hidden = true;
  els.successPanel.hidden = false;
  els.successPanel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
}

function setSubmittingUi(isSubmitting) {
  els.submitForm.disabled = isSubmitting;
  els.clearForm.disabled = isSubmitting;
  els.nextBay.disabled = isSubmitting;
  els.topNewRecord.disabled = isSubmitting;
  els.newRecord.disabled = isSubmitting;
  els.submitForm.textContent = t(isSubmitting ? "action.submitting" : "action.submit");
}

function clearFormWithConfirmation() {
  if (window.confirm(t("confirm.clear"))) resetForNewRecord();
}

function startNewRecord() {
  if (!formHasMeaningfulData() || window.confirm(t("confirm.newRecord"))) resetForNewRecord();
}

function resetForNewRecord({ scroll = true } = {}) {
  localStorage.removeItem(CONFIG.draftStorageKey);
  els.form.reset();
  els.form.classList.remove("was-validated");
  els.formPanel.hidden = false;
  els.successPanel.hidden = true;
  const trials = state.trials;
  const records = state.records;
  const recordsStatusKey = state.recordsStatusKey;
  const recordsStatusArgs = state.recordsStatusArgs;
  const recordsStatusError = state.recordsStatusError;
  state = freshState();
  state.trials = trials;
  state.records = records;
  state.recordsStatusKey = recordsStatusKey;
  state.recordsStatusArgs = recordsStatusArgs;
  state.recordsStatusError = recordsStatusError;
  setDefaultDateTime();
  loadRememberedEnumerator();
  els.saveStatus.textContent = "";
  renderGpsStatus();
  renderAll();
  renderRecords();
  if (scroll) window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
}

function setStatus(message, status = "") {
  els.saveStatus.textContent = message || "";
  els.saveStatus.dataset.status = status;
}

function friendlyError(error) {
  const message = String(error?.message || error || "Submission failed.");
  if (/failed to fetch|networkerror|load failed/i.test(message)) return t("status.network");
  if (isDatabasePendingError(error)) return t("status.databasePending");
  return t("status.submitFailed", { message });
}

function simpleErrorMessage(error) {
  return String(error?.message || error || "Unknown error").replace(/^\d{3}\s+/, "");
}

function isDatabasePendingError(error) {
  return /404.*(seaweed_drying|trial_schedule)|could not find the function/i.test(String(error?.message || error || ""));
}

function createUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createUploadToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function recordAccessFor(receiptNumber) {
  if (!receiptNumber) return null;
  if (state.receiptNumber === receiptNumber && state.submissionId && state.uploadToken) {
    return { id: state.submissionId, token: state.uploadToken };
  }
  try {
    const records = JSON.parse(localStorage.getItem(CONFIG.recordTokensStorageKey) || "{}");
    const access = records?.[receiptNumber];
    return isUuid(access?.id) && typeof access?.token === "string"
      ? { id: access.id, token: access.token }
      : null;
  } catch {
    return null;
  }
}

function rememberRecordAccess(receiptNumber, submissionId, token) {
  if (!receiptNumber || !isUuid(submissionId) || typeof token !== "string") return;
  try {
    const records = JSON.parse(localStorage.getItem(CONFIG.recordTokensStorageKey) || "{}");
    records[receiptNumber] = { id: submissionId, token, savedAt: new Date().toISOString() };
    const trimmed = Object.fromEntries(Object.entries(records)
      .sort(([, a], [, b]) => String(b?.savedAt || "").localeCompare(String(a?.savedAt || "")))
      .slice(0, 100));
    localStorage.setItem(CONFIG.recordTokensStorageKey, JSON.stringify(trimmed));
  } catch {
    // Record editing still works for the active draft when local storage is unavailable.
  }
}

function nullableText(value) {
  const textValue = String(value ?? "").trim();
  return textValue || null;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatLocalInput(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function localDateTimeFromIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? localDateTimeValue(date) : "";
}

function formatRecordDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function displayNumber(value, maximumFractionDigits = 1) {
  const number = nullableNumber(value);
  return number === null ? "-" : new Intl.NumberFormat(getLocale(), { maximumFractionDigits }).format(number);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function photoExtension(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic" || mimeType === "image/heif") return "heic";
  return "jpg";
}

function clampInteger(value, min, max, fallback) {
  const integer = Number.parseInt(value, 10);
  return Number.isInteger(integer) ? Math.min(max, Math.max(min, integer)) : fallback;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function safeServerDetail(value) {
  return String(value).replace(/<[^>]*>/g, "").slice(0, 300);
}

function preferredScrollBehavior() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
