from pathlib import Path
import subprocess

from apps.renderer.src.services.html_renderer import render_slide_png, render_slides_pdf


HTML = """<!doctype html><html><body style="margin:0;background:#14213d">
<main data-object="true" style="width:1920px;height:1080px;color:#fff;font:64px Arial">템플릿 그대로</main>
</body></html>"""


def test_renders_html_slide_to_a_non_empty_1920_canvas_png():
    png = render_slide_png(HTML, scale=1)

    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(png) > 10_000


def test_renders_each_html_slide_as_a_pdf_page(tmp_path: Path):
    pdf = render_slides_pdf([HTML, HTML])
    path = tmp_path / "slides.pdf"
    path.write_bytes(pdf)

    result = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True, check=True)
    assert "Pages:           2" in result.stdout
