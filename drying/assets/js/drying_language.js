import { DRYING_FORM_CONFIG as CONFIG } from "./config.js";

const packs = {
  en: {
    locale: "en-KE",
    text: {
      "meta.title": "Seaweed Drying Record - Seaweed Station",
      "app.eyebrow": "Seaweed station",
      "page.title": "Seaweed Drying Record",
      "nav.ariaLabel": "Page navigation",
      "nav.form": "Drying form",
      "nav.dashboard": "Dashboard",
      "action.newRecord": "New record",
      "language.ariaLabel": "Language",
      "language.label": "Language:",
      "language.choose": "Choose language",
      "reference.show": "Show Bati table and bay reference",
      "reference.note": "Tables 1-4 · B1-B8",
      "reference.batiTitle": "Bati table positions",
      "reference.batiAlt": "Bati layout with the dryer shed on the left, Tables 4 to 1 from left to right, and the road along the front",
      "reference.baysTitle": "Bay positions on each table",
      "reference.alt": "Dryer table showing bays B1 to B4 on the top row and B5 to B8 on the lower row",
      "record.legend": "Record details",
      "record.location": "Dryer location",
      "record.selectLocation": "Select location",
      "record.enumeratorName": "Enumerator name",
      "record.idNumber": "ID number",
      "record.dateTime": "Record date / time",
      "record.rememberEnumerator": "Remember enumerator name and ID on this device",
      "location.bati1": "Bati (Table 1)",
      "location.bati2": "Bati (Table 2)",
      "location.bati3": "Bati (Table 3)",
      "location.bati4": "Bati (Table 4)",
      "location.dryerShed": "Dryer Shed",
      "location.shangani1": "Shangani (Table 1)",
      "gps.label": "GPS location",
      "gps.notCaptured": "Not captured",
      "gps.capture": "Capture GPS",
      "gps.refresh": "Refresh GPS",
      "gps.locating": "Locating...",
      "gps.hint": "GPS is optional, but useful for confirming the dryer location.",
      "gps.enterBoth": "Enter both latitude and longitude",
      "gps.unavailable": "GPS is not available in this browser.",
      "gps.requesting": "Requesting the device location...",
      "gps.captured": "GPS captured{accuracy}.",
      "gps.permission": "Location permission was not granted.",
      "gps.position": "The device could not determine its location. Try again.",
      "gps.timeout": "GPS timed out. Move to an open area and try again.",
      "gps.failed": "GPS could not be captured.",
      "configuration.legend": "Table configuration",
      "configuration.label": "Drying configuration",
      "configuration.openOpen": "Cover Open / Back Open",
      "configuration.downClosed": "Cover Down / Back Closed",
      "configuration.downOpen": "Cover Down / Back Open",
      "configuration.coverOpen": "Cover Open",
      "configuration.coverDown": "Cover Down",
      "configuration.backOpen": "Back Open",
      "configuration.backClosed": "Back Closed",
      "configuration.photos": "Table overview photos - up to 5",
      "configuration.photoHint": "Photograph the table and its configuration before or during the cycle.",
      "common.select": "Select",
      "common.dateTime": "Date / time",
      "common.weather": "Weather",
      "weather.sunny": "Sunny",
      "weather.cloudy": "Cloudy",
      "weather.rainy": "Rainy",
      "weather.mixed": "Mixed",
      "bay.legend": "Bay records",
      "bay.choose": "Choose a bay",
      "bay.hint": "Work through one bay at a time. Completed bays are marked below.",
      "bay.ariaLabel": "Dryer bays",
      "bay.current": "Current bay",
      "bay.label": "Bay {number}",
      "bay.dryingTime": "Drying time",
      "bay.weightLoss": "Weight loss",
      "bay.notes": "Bay notes",
      "bay.previous": "Previous bay",
      "bay.next": "Save & next bay",
      "bay.save": "Save bay",
      "bay.saving": "Saving Bay {number}...",
      "bay.saved": "Bay {number} saved to {receipt}.",
      "bay.review": "Review all bay entries",
      "bay.progress": "{entered} of {total} entered",
      "bay.empty": "empty",
      "bay.started": "started",
      "bay.complete": "complete",
      "bay.checkTimes": "Check times",
      "bay.duration": "{hours}h {minutes}m",
      "loading.title": "Loading",
      "loading.qualifier": "(Wet)",
      "loading.weight": "Wet weight (kg)",
      "loading.photo": "Loading photo",
      "unloading.title": "Unloading",
      "unloading.qualifier": "(Dry)",
      "unloading.weight": "Dry weight (kg)",
      "unloading.photo": "Unloading photo",
      "summary.bay": "Bay",
      "summary.loaded": "Loaded",
      "summary.wet": "Wet kg",
      "summary.unloaded": "Unloaded",
      "summary.dry": "Dry kg",
      "summary.time": "Drying time",
      "summary.photos": "Photos",
      "observations.legend": "Observations",
      "observations.general": "General observations / recommendations",
      "observations.working": "What is working with the table?",
      "observations.notWorking": "What is not working with the table?",
      "observations.confirm": "I confirm this record is accurate.",
      "footer.privacy": "GPS and photos are stored privately with the drying record.",
      "action.clear": "Clear",
      "action.submit": "Submit drying record",
      "action.submitting": "Submitting...",
      "success.eyebrow": "Record received",
      "success.title": "Drying record submitted",
      "success.receipt": "Receipt",
      "success.location": "Location",
      "success.bays": "Bays",
      "success.photos": "Photos",
      "success.another": "Enter another record",
      "success.withPhotos": "The drying data and selected photos are safely stored.",
      "success.withoutPhotos": "The drying data is safely stored. No photos were selected.",
      "success.uploaded": "{count} uploaded",
      "success.none": "None selected",
      "trials.title": "Drying Trials",
      "trials.batiTitle": "Bati trials",
      "trials.trial": "Trial",
      "trials.assignments": "Table configurations",
      "trials.dates": "Dates",
      "trials.complete": "Complete",
      "trials.loadFailed": "Completion status could not be loaded; showing the fixed plan.",
      "trials.saveFailed": "Could not update the trial: {message}",
      "trials.trialLabel": "Trial {number}",
      "trials.tableConfiguration": "{table}: {configuration}",
      "photo.notImage": "{name} is not an image.",
      "photo.tooLarge": "{name} is larger than 25 MB. Choose a smaller photo.",
      "photo.limit": "Only the first {limit} photo(s) will be used.",
      "photo.previewAlt": "Selected photo preview",
      "photo.saved": "Photo already saved",
      "photo.preparing": "Preparing and uploading photo {current} of {total}...",
      "photo.linking": "Linking photos to the drying record...",
      "validation.required": "Complete the highlighted required fields.",
      "validation.gpsPair": "Enter both GPS latitude and longitude, or leave both blank.",
      "validation.bayEmpty": "Enter some data for Bay {bay} before saving it.",
      "validation.oneBay": "Enter some data for at least one bay.",
      "validation.timeOrder": "Bay {bay}: unloading cannot be earlier than loading.",
      "status.savingRecord": "Saving the drying record...",
      "status.network": "Network connection lost. Your draft is still saved on this device; try again when connected.",
      "status.databasePending": "The drying-form database setup has not been applied yet.",
      "status.submitFailed": "Could not submit the record: {message}",
      "status.recordSavedPhotos": " The record {receipt} is saved; submit again to retry its photos.",
      "confirm.clear": "Clear this drying record and its saved draft?",
      "confirm.newRecord": "Start a new record? The current record will close, even if it is incomplete.",
      "confirm.editRecord": "Open {receipt}? Any unsaved changes in the current form will be replaced.",
      "records.editing": "Editing saved record",
      "records.eyebrow": "Saved data",
      "records.title": "Previous drying records",
      "records.hint": "Records created on this device can be reopened and updated.",
      "records.refresh": "Refresh",
      "records.loading": "Loading records...",
      "records.loaded": "Showing the latest {count} record(s).",
      "records.empty": "No drying records have been saved yet.",
      "records.preview": "The records database setup is pending.",
      "records.loadFailed": "Previous records could not be loaded: {message}",
      "records.inProgress": "In progress",
      "records.complete": "Complete",
      "records.updated": "Updated {date}",
      "records.bays": "{count} bay(s)",
      "records.edit": "Edit record",
      "records.viewOnly": "View only",
      "records.editHint": "Editing is available on the device that created this record.",
      "records.opening": "Opening {receipt}...",
      "records.editFailed": "Could not open {receipt}: {message}",
      "records.bayLoading": "Loading (Wet)",
      "records.bayComplete": "Loading + unloading",
      "records.bayStarted": "Started"
    }
  },
  sw: {
    locale: "sw-KE",
    text: {
      "meta.title": "Rekodi ya Ukaushaji wa Mwani - Kituo cha Mwani",
      "app.eyebrow": "Kituo cha mwani",
      "page.title": "Rekodi ya Ukaushaji wa Mwani",
      "nav.ariaLabel": "Kurasa kuu",
      "nav.form": "Fomu ya ukaushaji",
      "nav.dashboard": "Dashibodi",
      "action.newRecord": "Rekodi mpya",
      "language.ariaLabel": "Lugha",
      "language.label": "Lugha:",
      "language.choose": "Chagua lugha",
      "reference.show": "Onyesha mpangilio wa meza za Bati na bay",
      "reference.note": "Meza 1-4 · B1-B8",
      "reference.batiTitle": "Nafasi za meza za Bati",
      "reference.batiAlt": "Mpangilio wa Bati wenye banda la kukaushia kushoto, Meza 4 hadi 1 kutoka kushoto kwenda kulia, na barabara upande wa mbele",
      "reference.baysTitle": "Nafasi za bay kwenye kila meza",
      "reference.alt": "Meza ya kukaushia yenye bay B1 hadi B4 juu na B5 hadi B8 chini",
      "record.legend": "Maelezo ya rekodi",
      "record.location": "Eneo la kikaushio",
      "record.selectLocation": "Chagua eneo",
      "record.enumeratorName": "Jina la mhoji",
      "record.idNumber": "Namba ya kitambulisho",
      "record.dateTime": "Tarehe / saa ya rekodi",
      "record.rememberEnumerator": "Kumbuka jina na namba ya kitambulisho cha mhoji kwenye kifaa hiki",
      "location.bati1": "Bati (Meza 1)",
      "location.bati2": "Bati (Meza 2)",
      "location.bati3": "Bati (Meza 3)",
      "location.bati4": "Bati (Meza 4)",
      "location.dryerShed": "Banda la Kukaushia",
      "location.shangani1": "Shangani (Meza 1)",
      "gps.label": "Eneo la GPS",
      "gps.notCaptured": "Haijachukuliwa",
      "gps.capture": "Chukua GPS",
      "gps.refresh": "Chukua GPS tena",
      "gps.locating": "Inatafuta...",
      "gps.hint": "GPS si lazima, lakini inasaidia kuthibitisha eneo la kikaushio.",
      "gps.enterBoth": "Weka latitudo na longitudo zote mbili",
      "gps.unavailable": "GPS haipatikani kwenye kivinjari hiki.",
      "gps.requesting": "Inatafuta eneo la kifaa...",
      "gps.captured": "GPS imechukuliwa{accuracy}.",
      "gps.permission": "Ruhusa ya eneo haijatolewa.",
      "gps.position": "Kifaa hakikuweza kupata eneo. Jaribu tena.",
      "gps.timeout": "Muda wa GPS umeisha. Nenda sehemu ya wazi ujaribu tena.",
      "gps.failed": "GPS haikuweza kuchukuliwa.",
      "configuration.legend": "Mpangilio wa meza",
      "configuration.label": "Mpangilio wa ukaushaji",
      "configuration.openOpen": "Kifuniko Wazi / Nyuma Wazi",
      "configuration.downClosed": "Kifuniko Chini / Nyuma Imefungwa",
      "configuration.downOpen": "Kifuniko Chini / Nyuma Wazi",
      "configuration.coverOpen": "Kifuniko Wazi",
      "configuration.coverDown": "Kifuniko Chini",
      "configuration.backOpen": "Nyuma Wazi",
      "configuration.backClosed": "Nyuma Imefungwa",
      "configuration.photos": "Picha za meza - hadi picha 5",
      "configuration.photoHint": "Piga picha ya meza na mpangilio wake kabla au wakati wa ukaushaji.",
      "common.select": "Chagua",
      "common.dateTime": "Tarehe / saa",
      "common.weather": "Hali ya hewa",
      "weather.sunny": "Jua",
      "weather.cloudy": "Mawingu",
      "weather.rainy": "Mvua",
      "weather.mixed": "Mchanganyiko",
      "bay.legend": "Rekodi za bay",
      "bay.choose": "Chagua bay",
      "bay.hint": "Jaza bay moja baada ya nyingine. Bay zilizokamilika zitawekwa alama hapa chini.",
      "bay.ariaLabel": "Bay za meza ya kukaushia",
      "bay.current": "Bay ya sasa",
      "bay.label": "Bay {number}",
      "bay.dryingTime": "Muda wa kukauka",
      "bay.weightLoss": "Uzito uliopungua",
      "bay.notes": "Maelezo ya bay",
      "bay.previous": "Bay iliyotangulia",
      "bay.next": "Hifadhi na endelea",
      "bay.save": "Hifadhi bay",
      "bay.saving": "Inahifadhi Bay {number}...",
      "bay.saved": "Bay {number} imehifadhiwa kwenye {receipt}.",
      "bay.review": "Kagua taarifa za bay zote",
      "bay.progress": "{entered} kati ya {total} zimejazwa",
      "bay.empty": "tupu",
      "bay.started": "imeanzwa",
      "bay.complete": "imekamilika",
      "bay.checkTimes": "Kagua muda",
      "bay.duration": "saa {hours} dk {minutes}",
      "loading.title": "Kupakia",
      "loading.qualifier": "(Mbichi)",
      "loading.weight": "Uzito wa mwani mbichi (kg)",
      "loading.photo": "Picha ya kupakia",
      "unloading.title": "Kupakua",
      "unloading.qualifier": "(Mkavu)",
      "unloading.weight": "Uzito wa mwani mkavu (kg)",
      "unloading.photo": "Picha ya kupakua",
      "summary.bay": "Bay",
      "summary.loaded": "Imepakiwa",
      "summary.wet": "Mbichi kg",
      "summary.unloaded": "Imepakuliwa",
      "summary.dry": "Kavu kg",
      "summary.time": "Muda wa kukauka",
      "summary.photos": "Picha",
      "observations.legend": "Maoni",
      "observations.general": "Maoni ya jumla / mapendekezo",
      "observations.working": "Ni nini kinachofanya kazi vizuri kwenye meza?",
      "observations.notWorking": "Ni nini hakifanyi kazi vizuri kwenye meza?",
      "observations.confirm": "Ninathibitisha kuwa rekodi hii ni sahihi.",
      "footer.privacy": "GPS na picha huhifadhiwa kwa faragha pamoja na rekodi ya ukaushaji.",
      "action.clear": "Futa",
      "action.submit": "Tuma rekodi ya ukaushaji",
      "action.submitting": "Inatuma...",
      "success.eyebrow": "Rekodi imepokelewa",
      "success.title": "Rekodi ya ukaushaji imetumwa",
      "success.receipt": "Risiti",
      "success.location": "Eneo",
      "success.bays": "Bay",
      "success.photos": "Picha",
      "success.another": "Weka rekodi nyingine",
      "success.withPhotos": "Taarifa za ukaushaji na picha zilizochaguliwa zimehifadhiwa salama.",
      "success.withoutPhotos": "Taarifa za ukaushaji zimehifadhiwa salama. Hakuna picha iliyochaguliwa.",
      "success.uploaded": "{count} zimetumwa",
      "success.none": "Hakuna iliyochaguliwa",
      "trials.title": "Majaribio ya Ukaushaji",
      "trials.batiTitle": "Majaribio ya Bati",
      "trials.trial": "Jaribio",
      "trials.assignments": "Mipangilio ya meza",
      "trials.dates": "Tarehe",
      "trials.complete": "Imekamilika",
      "trials.loadFailed": "Hali ya kukamilika haikupatikana; inaonyesha mpango maalum.",
      "trials.saveFailed": "Jaribio halikusasishwa: {message}",
      "trials.trialLabel": "Jaribio {number}",
      "trials.tableConfiguration": "{table}: {configuration}",
      "photo.notImage": "{name} si picha.",
      "photo.tooLarge": "{name} ni kubwa kuliko MB 25. Chagua picha ndogo.",
      "photo.limit": "Picha {limit} za kwanza pekee zitatumika.",
      "photo.previewAlt": "Muonekano wa picha iliyochaguliwa",
      "photo.saved": "Picha tayari imehifadhiwa",
      "photo.preparing": "Inatayarisha na kutuma picha {current} kati ya {total}...",
      "photo.linking": "Inaunganisha picha na rekodi ya ukaushaji...",
      "validation.required": "Jaza sehemu zote muhimu zilizoonyeshwa.",
      "validation.gpsPair": "Weka latitudo na longitudo zote mbili, au uache zote wazi.",
      "validation.bayEmpty": "Weka taarifa fulani za Bay {bay} kabla ya kuihifadhi.",
      "validation.oneBay": "Weka taarifa fulani kwa angalau bay moja.",
      "validation.timeOrder": "Bay {bay}: muda wa kupakua hauwezi kuwa kabla ya kupakia.",
      "status.savingRecord": "Inahifadhi rekodi ya ukaushaji...",
      "status.network": "Mtandao umekatika. Rasimu yako imehifadhiwa kwenye kifaa hiki; jaribu tena mtandao ukirudi.",
      "status.databasePending": "Mpangilio wa database wa fomu ya ukaushaji bado haujawekwa.",
      "status.submitFailed": "Rekodi haikutumwa: {message}",
      "status.recordSavedPhotos": " Rekodi {receipt} imehifadhiwa; tuma tena ili kujaribu picha.",
      "confirm.clear": "Ufute rekodi hii ya ukaushaji na rasimu yake?",
      "confirm.newRecord": "Uanze rekodi mpya? Rekodi ya sasa itafungwa hata kama haijakamilika.",
      "confirm.editRecord": "Ufungue {receipt}? Mabadiliko ambayo hayajahifadhiwa kwenye fomu ya sasa yataondolewa.",
      "records.editing": "Unahariri rekodi iliyohifadhiwa",
      "records.eyebrow": "Taarifa zilizohifadhiwa",
      "records.title": "Rekodi za ukaushaji zilizopita",
      "records.hint": "Rekodi zilizoundwa kwenye kifaa hiki zinaweza kufunguliwa na kusasishwa.",
      "records.refresh": "Onyesha upya",
      "records.loading": "Inapakia rekodi...",
      "records.loaded": "Inaonyesha rekodi {count} za hivi karibuni.",
      "records.empty": "Bado hakuna rekodi ya ukaushaji iliyohifadhiwa.",
      "records.preview": "Mpangilio wa database ya rekodi unasubiri.",
      "records.loadFailed": "Rekodi zilizopita hazikupatikana: {message}",
      "records.inProgress": "Inaendelea",
      "records.complete": "Imekamilika",
      "records.updated": "Ilisasishwa {date}",
      "records.bays": "Bay {count}",
      "records.edit": "Hariri rekodi",
      "records.viewOnly": "Tazama tu",
      "records.editHint": "Kuhariri kunapatikana kwenye kifaa kilichounda rekodi hii.",
      "records.opening": "Inafungua {receipt}...",
      "records.editFailed": "Haikuweza kufungua {receipt}: {message}",
      "records.bayLoading": "Kupakia (Mbichi)",
      "records.bayComplete": "Kupakia + kupakua",
      "records.bayStarted": "Imeanzwa"
    }
  }
};

let currentLanguage = initialLanguage();

export function initDryingLanguage() {
  applyLanguage();
  document.querySelectorAll("[data-language-option]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.languageOption));
  });
}

export function setLanguage(language) {
  if (!packs[language] || language === currentLanguage) return;
  currentLanguage = language;
  localStorage.setItem(CONFIG.languageStorageKey, language);
  applyLanguage();
  document.dispatchEvent(new CustomEvent("seaweed-drying-language-change", {
    detail: { language }
  }));
}

export function getLanguage() {
  return currentLanguage;
}

export function getLocale() {
  return packs[currentLanguage]?.locale || packs.en.locale;
}

export function t(key, replacements = {}) {
  const template = packs[currentLanguage]?.text[key] ?? packs.en.text[key] ?? key;
  return Object.entries(replacements).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template
  );
}

export function configurationLabel(configuration) {
  const key = {
    cover_open_back_open: "configuration.openOpen",
    cover_down_back_closed: "configuration.downClosed",
    cover_down_back_open: "configuration.downOpen"
  }[configuration];
  return key ? t(key) : String(configuration || "-");
}

export function configurationParts(configuration) {
  const keys = {
    cover_open_back_open: ["configuration.coverOpen", "configuration.backOpen"],
    cover_down_back_closed: ["configuration.coverDown", "configuration.backClosed"],
    cover_down_back_open: ["configuration.coverDown", "configuration.backOpen"]
  }[configuration];
  if (!keys) return [{ text: String(configuration || "-"), className: "config-unknown" }];
  return [
    {
      text: t(keys[0]),
      className: configuration.startsWith("cover_down") ? "config-cover-down" : "config-cover-open"
    },
    {
      text: t(keys[1]),
      className: configuration.endsWith("back_closed") ? "config-back-closed" : "config-back-open"
    }
  ];
}

export function tableLabel(table) {
  const key = {
    "Bati (Table 1)": "location.bati1",
    "Bati (Table 2)": "location.bati2",
    "Bati (Table 3)": "location.bati3",
    "Bati (Table 4)": "location.bati4",
    "Shangani (Table 1)": "location.shangani1"
  }[table];
  return key ? t(key) : String(table || "-");
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage === "sw" ? "sw-KE" : "en-KE";
  document.body.dataset.language = currentLanguage;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    element.alt = t(element.dataset.i18nAlt);
  });
  document.querySelectorAll("[data-language-option]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.languageOption === currentLanguage));
  });
}

function initialLanguage() {
  const saved = localStorage.getItem(CONFIG.languageStorageKey);
  return packs[saved] ? saved : "en";
}
