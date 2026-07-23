from fastapi.testclient import TestClient
import pytest

from apps.renderer.src.generators.pdf_exporter import PDFExporter
from apps.renderer.src.main import app


def test_pdf_exporter_raises_when_libreoffice_is_unavailable(monkeypatch):
    def unavailable(_self, _pptx_buffer):
        raise FileNotFoundError("libreoffice")

    monkeypatch.setattr(PDFExporter, "_convert_with_libreoffice", unavailable)

    with pytest.raises(RuntimeError, match="LibreOffice is required for PDF export"):
        PDFExporter().convert_pptx_to_pdf(b"pptx")


def test_pdf_exporter_returns_libreoffice_output(monkeypatch):
    monkeypatch.setattr(
        PDFExporter, "_convert_with_libreoffice", lambda _self, _pptx_buffer: b"%PDF-1.7"
    )

    assert PDFExporter().convert_pptx_to_pdf(b"pptx") == b"%PDF-1.7"


def test_render_pdf_returns_error_when_conversion_fails(monkeypatch):
    monkeypatch.setattr(
        "apps.renderer.src.main.PPTXGenerator.generate", lambda _self, _presentation: b"pptx"
    )
    monkeypatch.setattr(
        "apps.renderer.src.main.PDFExporter.convert_pptx_to_pdf",
        lambda _self, _pptx: (_ for _ in ()).throw(
            RuntimeError("LibreOffice is required for PDF export")
        ),
    )

    response = TestClient(app).post(
        "/api/render/pdf",
        json={
            "presentation": {
                "id": "presentation-1",
                "title": "PDF check",
                "slides": [
                    {"id": "slide-1", "order": 0, "type": "TITLE", "content": {}}
                ],
            }
        },
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "LibreOffice is required for PDF export"}


def test_render_preview_returns_rasterized_pptx_output(monkeypatch):
    requested_indexes = []
    monkeypatch.setattr(
        "apps.renderer.src.main.PPTXGenerator.generate",
        lambda _self, _presentation, *indexes: requested_indexes.extend(indexes) or b"pptx",
    )
    monkeypatch.setattr(
        PDFExporter,
        "convert_pptx_to_preview",
        lambda _self, _pptx: b"\x89PNG\r\n\x1a\npreview",
        raising=False,
    )

    response = TestClient(app).post(
        "/api/render/preview",
        json={
            "presentation": {
                "id": "presentation-1",
                    "title": "Preview check",
                    "slides": [
                        {"id": "slide-1", "order": 0, "type": "TITLE", "content": {}},
                        {"id": "slide-2", "order": 1, "type": "CONTENT", "content": {}},
                ],
            },
            "slideIndex": 1,
        },
    )

    assert response.status_code == 200
    assert response.content == b"\x89PNG\r\n\x1a\npreview"
    assert requested_indexes == [1]


def test_render_preview_returns_html_renderer_output_when_slide_has_html(monkeypatch):
    monkeypatch.setattr("apps.renderer.src.main.render_slide_png", lambda html: b"html-png")

    response = TestClient(app).post(
        "/api/render/preview",
        json={"presentation": {"id": "presentation-1", "title": "Preview check", "slides": [
            {"id": "slide-1", "order": 0, "type": "CONTENT", "content": {"html": "<main data-object=\"true\">HTML</main>"}},
        ]}},
    )

    assert response.status_code == 200
    assert response.content == b"html-png"


def test_render_pdf_returns_html_renderer_output_when_all_slides_have_html(monkeypatch):
    monkeypatch.setattr("apps.renderer.src.main.render_slides_pdf", lambda htmls: b"%PDF-html")

    response = TestClient(app).post(
        "/api/render/pdf",
        json={"presentation": {"id": "presentation-1", "title": "PDF check", "slides": [
            {"id": "slide-1", "order": 0, "type": "CONTENT", "content": {"html": "<main data-object=\"true\">One</main>"}},
            {"id": "slide-2", "order": 1, "type": "CONTENT", "content": {"html": "<main data-object=\"true\">Two</main>"}},
        ]}},
    )

    assert response.status_code == 200
    assert response.content == b"%PDF-html"
