import json
import os
import sys
import time
from urllib.parse import quote

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


BASE_URL = os.environ.get("SEAWEED_BASE_URL", "http://127.0.0.1:8765")
PASSWORD = os.environ.get("SEAWEED_DASH_PASSWORD", "changeme")
HEADLESS = os.environ.get("SEAWEED_HEADLESS", "0") == "1"
TIMEOUT_S = int(os.environ.get("SEAWEED_AUDIT_TIMEOUT_S", "25"))
RESULTS_FILE = os.environ.get(
    "SEAWEED_AUDIT_RESULTS_FILE",
    os.path.join(os.path.dirname(__file__), "browser_console_audit_results.json"),
)

OVERVIEW_PATH = "/ESP32_Weather_Station_Dashboard.html"
IGNORED_WARNING_SNIPPETS = [
    "[Overview] dashboard-overview payload stale; rendering cached cards first and refreshing in background",
    "[Overview] dashboard-overview payload stale; rendering cached cards first and deferring station-detail refresh until manual fetch",
    "[Health] health-summary primary fetch failed, retrying with reduced window:",
]

PAGES = [
    {"name": "login", "path": "/login.html", "wait": 3},
    {"name": "index", "path": "/index.html", "wait": 4},
    {"name": "overview", "path": OVERVIEW_PATH, "wait": 12},
    {"name": "battery_estimator", "path": "/pages/battery_estimator.html", "wait": 6},
    {"name": "station_health", "path": "/pages/station_health.html", "wait": 14},
    {"name": "settings", "path": "/pages/settings.html", "wait": 6},
    {"name": "station_perth", "path": "/pages/station.html?table=perth", "wait": 12},
    {"name": "station_shangani", "path": "/pages/station.html?table=shangani", "wait": 12},
    {"name": "station_funzi", "path": "/pages/station.html?table=funzi", "wait": 12},
    {"name": "station_spare", "path": "/pages/station.html?table=spare", "wait": 12},
]

PRELOAD_HOOK = r"""
(function () {
  window.__auditErrors = [];
  window.addEventListener('error', function (event) {
    try {
      window.__auditErrors.push({
        type: 'error',
        message: event && event.message ? String(event.message) : 'window error',
        source: event && event.filename ? String(event.filename) : '',
        line: event && event.lineno ? Number(event.lineno) : null,
        column: event && event.colno ? Number(event.colno) : null
      });
    } catch (_err) {}
  });
  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event ? event.reason : null;
      var text = '';
      if (reason && typeof reason === 'object' && reason.message) text = String(reason.message);
      else if (reason != null) text = String(reason);
      else text = 'Unhandled promise rejection';
      window.__auditErrors.push({
        type: 'unhandledrejection',
        message: text,
        source: '',
        line: null,
        column: null
      });
    } catch (_err) {}
  });
})();
"""


def make_driver():
    options = Options()
    options.binary_location = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    options.page_load_strategy = "eager"
    options.add_argument("--window-size=1600,1200")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-search-engine-choice-screen")
    options.add_argument("--allow-file-access-from-files")
    if HEADLESS:
        options.add_argument("--headless=new")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(TIMEOUT_S)
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": PRELOAD_HOOK})
    return driver


def write_results(results):
    with open(RESULTS_FILE, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)


def wait_document_ready(driver, seconds=TIMEOUT_S):
    WebDriverWait(driver, seconds).until(
        lambda d: d.execute_script("return document.readyState") in {"interactive", "complete"}
    )


def browser_logs(driver):
    logs = []
    try:
        for entry in driver.get_log("browser"):
            level = (entry.get("level") or "").upper()
            message = entry.get("message") or ""
            if level == "WARNING" and any(snippet in message for snippet in IGNORED_WARNING_SNIPPETS):
                continue
            if level in {"SEVERE", "WARNING"}:
                logs.append({
                    "level": level,
                    "message": message,
                    "timestamp": entry.get("timestamp"),
                })
    except Exception as exc:
        logs.append({"level": "ERROR", "message": f"Could not read browser logs: {exc}"})
    return logs


def runtime_errors(driver):
    try:
        return driver.execute_script("return window.__auditErrors || [];") or []
    except Exception as exc:
        return [{"type": "script", "message": f"Could not read window.__auditErrors: {exc}"}]


def page_snapshot(driver):
    script = """
    return {
      title: document.title || '',
      url: location.href,
      bodyText: document.body ? document.body.innerText.slice(0, 2000) : '',
            errorNodes: Array.from(document.querySelectorAll('.error, .loading-text, .loading-msg, #fetchStatus, .fetch-status'))
                .filter(function (el) {
                    if (!el) return false;
                    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
                    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
                    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                    return !!rect && rect.width >= 0 && rect.height >= 0;
                })
                .map(function (el) { return (el.innerText || '').trim(); })
                .filter(function (text) {
                    if (!text) return false;
                    var lower = text.toLowerCase();
                    return lower.indexOf('error') >= 0 ||
                        lower.indexOf('failed') >= 0 ||
                        lower.indexOf('could not') >= 0 ||
                        lower.indexOf('unavailable') >= 0 ||
                        lower.indexOf('loading') >= 0;
                })
    };
    """
    try:
        return driver.execute_script(script)
    except Exception as exc:
        return {"title": "", "url": driver.current_url, "bodyText": "", "errorNodes": [f"snapshot failed: {exc}"]}


def login(driver):
    target = BASE_URL + OVERVIEW_PATH
    url = f"{BASE_URL}/login.html?r={quote(target, safe=':/?=&')}"
    driver.get(url)
    wait_document_ready(driver)
    pwd = WebDriverWait(driver, TIMEOUT_S).until(EC.presence_of_element_located((By.ID, "pwd")))
    pwd.clear()
    pwd.send_keys(PASSWORD)
    driver.find_element(By.CSS_SELECTOR, "#loginForm .btn").click()

    WebDriverWait(driver, TIMEOUT_S).until(
        lambda d: d.execute_script("return sessionStorage.getItem('sw_auth')") == "ok"
    )
    WebDriverWait(driver, TIMEOUT_S).until(lambda d: "login.html" not in d.current_url)
    time.sleep(3)


def audit_page(driver, page):
    url = BASE_URL + page["path"]
    print(f"AUDIT {page['name']} {url}", flush=True)
    try:
        driver.get(url)
    except TimeoutException:
        try:
            driver.execute_script("window.stop();")
        except Exception:
            pass
    wait_document_ready(driver)
    time.sleep(page.get("wait", 5))
    return {
        "page": page["name"],
        "path": page["path"],
        "snapshot": page_snapshot(driver),
        "runtime_errors": runtime_errors(driver),
        "browser_logs": browser_logs(driver),
    }


def main():
    results = []
    driver = make_driver()
    try:
        print(f"LOGIN {BASE_URL}/login.html", flush=True)
        login(driver)
        for page in PAGES:
            try:
                results.append(audit_page(driver, page))
            except Exception as exc:
                results.append({
                    "page": page["name"],
                    "path": page["path"],
                    "fatal": f"{type(exc).__name__}: {exc}",
                })
            write_results(results)
    except TimeoutException as exc:
        results.append({"fatal": f"Timeout: {exc}"})
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    write_results(results)
    print(json.dumps(results, indent=2))

    has_failures = False
    for item in results:
        if item.get("fatal"):
            has_failures = True
            continue
        if item.get("runtime_errors") or item.get("browser_logs"):
            if any(log.get("level") == "SEVERE" for log in item.get("browser_logs", [])):
                has_failures = True
    return 1 if has_failures else 0


if __name__ == "__main__":
    sys.exit(main())
