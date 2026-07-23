"""Render full HTML slides with Chromium instead of reconstructing CSS as shapes."""

from pathlib import Path
import subprocess
import tempfile

from playwright.sync_api import sync_playwright


def _set_slide_html(page, html: str, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.set_content(html, wait_until="networkidle")
    page.evaluate("document.fonts.ready")


def render_slide_png(html: str, width: int = 1920, height: int = 1080, scale: int = 2) -> bytes:
    if not isinstance(html, str) or not html.strip():
        raise RuntimeError("HTML rendering failed: slide HTML is empty")
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(device_scale_factor=scale)
            _set_slide_html(page, html, width, height)
            png = page.screenshot(clip={"x": 0, "y": 0, "width": width, "height": height})
            browser.close()
            return png
    except Exception as error:
        raise RuntimeError(f"HTML rendering failed: {error}") from error


def render_slides_pdf(htmls: list[str], width: int = 1920, height: int = 1080) -> bytes:
    if not htmls or not all(isinstance(html, str) and html.strip() for html in htmls):
        raise RuntimeError("HTML rendering failed: slide HTML is empty")
    try:
        with tempfile.TemporaryDirectory() as directory, sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            pages = []
            for index, html in enumerate(htmls):
                page = browser.new_page()
                _set_slide_html(page, html, width, height)
                output = Path(directory) / f"slide-{index}.pdf"
                page.pdf(path=str(output), width=f"{width}px", height=f"{height}px", print_background=True)
                pages.append(str(output))
                page.close()
            browser.close()
            merged = Path(directory) / "slides.pdf"
            subprocess.run(["pdfunite", *pages, str(merged)], check=True, capture_output=True, timeout=30)
            return merged.read_bytes()
    except Exception as error:
        raise RuntimeError(f"HTML rendering failed: {error}") from error
