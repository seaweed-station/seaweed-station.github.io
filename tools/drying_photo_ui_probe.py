import contextlib
import functools
import http.server
import pathlib
import tempfile
import threading

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    repo_root = pathlib.Path(__file__).resolve().parents[1]
    handler = functools.partial(QuietHandler, directory=str(repo_root))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=420,900")
    driver = webdriver.Chrome(options=options)
    wait = WebDriverWait(driver, 30)
    photo_one = pathlib.Path(tempfile.gettempdir()) / "drying-photo-probe-one.png"
    photo_two = pathlib.Path(tempfile.gettempdir()) / "drying-photo-probe-two.png"

    try:
        driver.get(f"http://127.0.0.1:{server.server_port}/drying/index.html")
        wait.until(lambda current: current.find_element(By.ID, "tablePhotos").is_enabled())
        driver.save_screenshot(str(photo_one))
        driver.set_window_size(430, 900)
        driver.save_screenshot(str(photo_two))

        driver.find_element(By.ID, "tablePhotos").send_keys(str(photo_one))
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#tablePhotoPreview .selected-photo-chip"
        )) == 1)
        driver.find_element(By.CSS_SELECTOR, "#tablePhotoPreview .selected-photo-chip").click()
        wait.until(lambda current: current.find_element(
            By.ID, "dryingPhotoActions"
        ).get_attribute("open") is not None)
        driver.find_element(By.ID, "deleteDryingPhoto").click()
        wait.until(lambda current: not current.find_elements(
            By.CSS_SELECTOR, "#tablePhotoPreview .selected-photo-chip"
        ))
        driver.find_element(By.ID, "tablePhotos").send_keys(str(photo_one))

        loading = driver.find_element(By.ID, "loadingCapturePhotos")
        loading.send_keys(f"{photo_one}\n{photo_two}")
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#loadingCapturePhotoPreview .selected-photo-chip"
        )) == 2)
        driver.find_elements(
            By.CSS_SELECTOR, "#loadingCapturePhotoPreview .selected-photo-chip"
        )[0].click()
        wait.until(lambda current: current.find_element(
            By.ID, "dryingPhotoActions"
        ).get_attribute("open") is not None)
        driver.find_element(By.ID, "retakeDryingPhoto").click()
        driver.find_element(By.ID, "dryingPhotoRetake").send_keys(str(photo_two))
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#loadingCapturePhotoPreview .selected-photo-chip"
        )) == 2)

        unloading = driver.find_element(By.ID, "unloadingCapturePhotos")
        unloading.send_keys(f"{photo_one}\n{photo_two}")
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#unloadingCapturePhotoPreview .selected-photo-chip"
        )) == 2)

        print("PASS: one overview and two loading/unloading photos support delete and retake")
    finally:
        with contextlib.suppress(Exception):
            driver.quit()
        server.shutdown()
        server.server_close()
        photo_one.unlink(missing_ok=True)
        photo_two.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
