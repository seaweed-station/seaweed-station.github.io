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
  draftStatus: $("draftStatus"),
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
  batiTrialsBody: $("batiTrialsBody"),
  shanganiTrialsBody: $("shanganiTrialsBody"),
  trialSyncStatus: $("trialSyncStatus"),
  trialSaveStatus: $("trialSaveStatus"),
  saveTrials: $("saveTrials")
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
    submitting: false,
    trials: CONFIG.trials.map((trial) => ({
      ...trial,
      assignments: trial.assignments.map((assignment) => ({ ...assignment })),
      scheduledDate: "",
      startDate: "",
      finishDate: "",
      completed: false
    })),
    trialStatusKey: "trials.loading",
    trialStatusError: false,
    draftStatusKey: "draft.default",
    draftStatusArgs: {},
    gpsStatusKey: "gps.hint",
    gpsStatusArgs: {},
    gpsStatusError: false
  };
}

function initialize() {
  initDryingLanguage();
  setDefaultDateTime();
  restoreDraft();
  bindEvents();
  applyLocationSelection(false);
  renderAll();
  renderTrials();
  loadTrialSchedule();
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
    renderPhotoPreview(els.tablePhotoPreview, files);
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

  const updateTrial = (event) => {
    const control = event.target.closest("[data-trial-code]");
    if (!control) return;
    const trial = state.trials.find((item) => item.trialCode === control.dataset.trialCode);
    if (!trial) return;
    if (control.type === "date" && control.dataset.trialField) {
      trial[control.dataset.trialField] = control.value;
    }
    if (control.type === "checkbox") trial.completed = control.checked;
    control.closest("tr")?.classList.toggle("is-complete", trial.completed);
    els.trialSaveStatus.textContent = "";
  };
  els.batiTrialsBody.addEventListener("change", updateTrial);
  els.shanganiTrialsBody.addEventListener("change", updateTrial);

  els.previousBay.addEventListener("click", () => selectBay(Math.max(1, state.currentBay - 1)));
  els.nextBay.addEventListener("click", () => selectBay(Math.min(state.bayCount, state.currentBay + 1)));
  els.captureGps.addEventListener("click", captureGps);
  els.saveTrials.addEventListener("click", saveTrialSchedule);
  els.clearForm.addEventListener("click", clearFormWithConfirmation);
  els.newRecord.addEventListener("click", resetForNewRecord);
  els.form.addEventListener("submit", submitForm);
  document.addEventListener("seaweed-drying-language-change", renderLanguageDependentContent);
}

function renderLanguageDependentContent() {
  captureBayEditor();
  renderAll();
  renderTrials();
  renderDraftStatus();
  renderGpsStatus();
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
  state.draftStatusKey = "draft.restored";
  state.draftStatusArgs = {
    time: Number.isFinite(savedAt) ? ` ${formatClock(new Date(savedAt))}` : ""
  };
  renderDraftStatus();
}

function sanitizeBays(value) {
  const allowed = new Set([
    "loading_at",
    "loading_weight_g",
    "loading_weather",
    "unloading_at",
    "unloading_weight_g",
    "unloading_weather",
    "notes"
  ]);
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([bayNumber, bay]) => [
    bayNumber,
    Object.fromEntries(Object.entries(bay || {}).filter(([key]) => allowed.has(key)))
  ]));
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
    uploadToken: state.uploadToken
  };
  try {
    localStorage.setItem(CONFIG.draftStorageKey, JSON.stringify(draft));
    state.draftStatusKey = "draft.saved";
    state.draftStatusArgs = { time: formatClock(new Date(savedAt)) };
  } catch {
    state.draftStatusKey = "draft.failed";
    state.draftStatusArgs = {};
  }
  renderDraftStatus();
}

function renderDraftStatus() {
  els.draftStatus.textContent = t(state.draftStatusKey, state.draftStatusArgs);
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
  renderPhotoPreview(els.tablePhotoPreview, state.files.table);
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
  els.nextBay.disabled = state.currentBay === state.bayCount;
  els.nextBay.textContent = state.currentBay === state.bayCount ? t("bay.last") : t("bay.next");
  els.loadingPhoto.value = "";
  els.unloadingPhoto.value = "";
  const files = ensureBayFiles(state.currentBay);
  renderPhotoPreview(els.loadingPhotoPreview, files.loading ? [files.loading] : []);
  renderPhotoPreview(els.unloadingPhotoPreview, files.unloading ? [files.unloading] : []);
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
  return hasField || Boolean(files.loading || files.unloading);
}

function bayIsComplete(bayNumber) {
  const bay = ensureBay(bayNumber);
  return Boolean(
    String(bay.loading_at || "").trim()
    && String(bay.loading_weight_g || "").trim()
    && String(bay.unloading_at || "").trim()
    && String(bay.unloading_weight_g || "").trim()
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
  const wet = nullableNumber(bay.loading_weight_g);
  const dry = nullableNumber(bay.unloading_weight_g);
  if (wet === null || dry === null || wet <= 0) return "-";
  return `${(((wet - dry) / wet) * 100).toFixed(1)}%`;
}

function renderBaySummary() {
  els.baySummaryBody.replaceChildren();
  activeBayNumbers().forEach((bayNumber) => {
    const bay = ensureBay(bayNumber);
    const files = ensureBayFiles(bayNumber);
    const row = document.createElement("tr");
    const values = [
      t("bay.label", { number: bayNumber }),
      formatLocalInput(bay.loading_at),
      displayNumber(bay.loading_weight_g),
      formatLocalInput(bay.unloading_at),
      displayNumber(bay.unloading_weight_g),
      dryingDurationLabel(bay),
      `${Number(Boolean(files.loading)) + Number(Boolean(files.unloading))}/2`
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
  renderTrialSite("bati", els.batiTrialsBody);
  renderTrialSite("shangani", els.shanganiTrialsBody);
  els.trialSyncStatus.textContent = t(state.trialStatusKey);
  els.trialSyncStatus.classList.toggle("status-warning", state.trialStatusError);
}

function renderTrialSite(site, container) {
  container.replaceChildren();
  state.trials.filter((trial) => trial.site === site).forEach((trial) => {
    const row = document.createElement("tr");
    row.classList.toggle("is-complete", trial.completed);

    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.className = "trial-label";
    labelCell.textContent = t(site === "bati" ? "trials.setLabel" : "trials.dayLabel", {
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

    const dateCells = site === "bati"
      ? [
        createTrialDateCell(trial, labelCell.textContent, "startDate", "trials.startDate"),
        createTrialDateCell(trial, labelCell.textContent, "finishDate", "trials.finishDate")
      ]
      : [createTrialDateCell(trial, labelCell.textContent, "scheduledDate", "trials.scheduled")];

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

function createTrialDateCell(trial, trialLabel, field, translationKey) {
  const cell = document.createElement("td");
  const input = document.createElement("input");
  input.type = "date";
  input.value = trial[field];
  input.className = "trial-date";
  input.dataset.trialCode = trial.trialCode;
  input.dataset.trialField = field;
  input.setAttribute("aria-label", `${trialLabel}: ${t(translationKey)}`);
  cell.append(input);
  return cell;
}

async function loadTrialSchedule() {
  state.trialStatusKey = "trials.loading";
  state.trialStatusError = false;
  renderTrials();
  try {
    const result = await callRpc(CONFIG.getTrialsRpc, {}, { unwrapSingle: false });
    const savedTrials = extractTrialRows(result);
    savedTrials.forEach((saved) => {
      const trial = state.trials.find((item) => item.trialCode === saved.trial_code);
      if (!trial) return;
      trial.scheduledDate = saved.scheduled_date || "";
      trial.startDate = saved.start_date || "";
      trial.finishDate = saved.finish_date || "";
      trial.completed = Boolean(saved.completed);
    });
    state.trialStatusKey = "trials.live";
  } catch (error) {
    state.trialStatusKey = isDatabasePendingError(error) ? "trials.preview" : "trials.loadFailed";
    state.trialStatusError = true;
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

async function saveTrialSchedule() {
  if (els.saveTrials.disabled) return;
  const invalidRange = state.trials.some((trial) => (
    trial.site === "bati"
    && trial.startDate
    && trial.finishDate
    && trial.finishDate < trial.startDate
  ));
  if (invalidRange) {
    els.trialSaveStatus.textContent = t("trials.invalidRange");
    els.trialSaveStatus.dataset.status = "error";
    return;
  }
  els.saveTrials.disabled = true;
  els.saveTrials.textContent = t("trials.saving");
  els.trialSaveStatus.textContent = t("trials.saving");
  els.trialSaveStatus.dataset.status = "";
  try {
    await callRpc(CONFIG.updateTrialsRpc, {
      p_updates: state.trials.map((trial) => ({
        trial_code: trial.trialCode,
        scheduled_date: trial.scheduledDate || null,
        start_date: trial.startDate || null,
        finish_date: trial.finishDate || null,
        completed: trial.completed
      }))
    }, { unwrapSingle: false });
    state.trialStatusKey = "trials.live";
    state.trialStatusError = false;
    els.trialSaveStatus.textContent = t("trials.saved");
    els.trialSaveStatus.dataset.status = "success";
  } catch (error) {
    els.trialSaveStatus.textContent = t("trials.saveFailed", { message: friendlyError(error) });
    els.trialSaveStatus.dataset.status = "error";
  } finally {
    els.saveTrials.disabled = false;
    els.saveTrials.textContent = t("trials.save");
    renderTrials();
  }
}

function setBayPhoto(phase, file) {
  const accepted = acceptedFiles(file ? [file] : [], 1);
  const files = ensureBayFiles(state.currentBay);
  files[phase] = accepted[0] || null;
  const preview = phase === "loading" ? els.loadingPhotoPreview : els.unloadingPhotoPreview;
  renderPhotoPreview(preview, files[phase] ? [files[phase]] : []);
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

function renderPhotoPreview(container, files) {
  container.replaceChildren();
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

  state.submissionId ||= createUuid();
  state.uploadToken ||= createUploadToken();
  saveDraft();
  state.submitting = true;
  setSubmittingUi(true);

  let receipt;
  try {
    setStatus(t("status.savingRecord"));
    receipt = await callRpc(CONFIG.submitRpc, {
      p_payload: buildPayload(),
      p_upload_token: state.uploadToken
    });
    const photoResult = await uploadSelectedPhotos();
    localStorage.removeItem(CONFIG.draftStorageKey);
    showSuccess(receipt, photoResult);
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
      ["loading_weight_g", "validation.wetWeight"],
      ["unloading_at", "validation.unloadingTime"],
      ["unloading_weight_g", "validation.dryWeight"]
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

function buildPayload() {
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
    loading_weight_g: nullableNumber(bay.loading_weight_g),
    loading_weather: nullableText(bay.loading_weather),
    unloading_at: toIso(bay.unloading_at),
    unloading_weight_g: nullableNumber(bay.unloading_weight_g),
    unloading_weather: nullableText(bay.unloading_weather),
    notes: nullableText(bay.notes)
  };
}

async function uploadSelectedPhotos() {
  const uploads = [];
  state.files.table.forEach((file, index) => uploads.push({ kind: "table", file, index: index + 1 }));
  activeBayNumbers().forEach((bayNumber) => {
    const files = ensureBayFiles(bayNumber);
    if (files.loading) uploads.push({ kind: "bay", phase: "loading", bayNumber, file: files.loading });
    if (files.unloading) uploads.push({ kind: "bay", phase: "unloading", bayNumber, file: files.unloading });
  });
  if (!uploads.length) return { count: 0, attached: false };

  const manifest = { table: [], bays: [] };
  const manifestByBay = new Map();
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    setStatus(t("photo.preparing", { current: index + 1, total: uploads.length }));
    const blob = await preparePhoto(upload.file);
    if (blob.size > CONFIG.maxPhotoBytes) throw new Error(`${upload.file.name} is still larger than 8 MB after compression.`);
    const extension = photoExtension(blob.type);
    const objectPath = upload.kind === "table"
      ? `${state.submissionId}/table/${String(upload.index).padStart(2, "0")}.${extension}`
      : `${state.submissionId}/bay-${String(upload.bayNumber).padStart(2, "0")}/${upload.phase}.${extension}`;
    await uploadObject(objectPath, blob);

    if (upload.kind === "table") {
      manifest.table.push(objectPath);
    } else {
      if (!manifestByBay.has(upload.bayNumber)) {
        const bayManifest = { bay_number: upload.bayNumber, loading: [], unloading: [] };
        manifestByBay.set(upload.bayNumber, bayManifest);
        manifest.bays.push(bayManifest);
      }
      manifestByBay.get(upload.bayNumber)[upload.phase].push(objectPath);
    }
  }

  setStatus(t("photo.linking"));
  await callRpc(CONFIG.attachPhotosRpc, {
    p_submission_id: state.submissionId,
    p_upload_token: state.uploadToken,
    p_photos: manifest
  });
  return { count: uploads.length, attached: true };
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
  els.submitForm.textContent = t(isSubmitting ? "action.submitting" : "action.submit");
}

function clearFormWithConfirmation() {
  if (window.confirm(t("confirm.clear"))) resetForNewRecord();
}

function resetForNewRecord() {
  localStorage.removeItem(CONFIG.draftStorageKey);
  els.form.reset();
  els.form.classList.remove("was-validated");
  els.formPanel.hidden = false;
  els.successPanel.hidden = true;
  const trials = state.trials;
  const trialStatusKey = state.trialStatusKey;
  const trialStatusError = state.trialStatusError;
  state = freshState();
  state.trials = trials;
  state.trialStatusKey = trialStatusKey;
  state.trialStatusError = trialStatusError;
  setDefaultDateTime();
  els.saveStatus.textContent = "";
  renderDraftStatus();
  renderGpsStatus();
  renderAll();
  window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
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

function displayNumber(value) {
  const number = nullableNumber(value);
  return number === null ? "-" : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(number);
}

function formatClock(date) {
  return new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit" }).format(date);
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
