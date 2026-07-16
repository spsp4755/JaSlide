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
    monkeypatch.setattr(
        "apps.renderer.src.main.PPTXGenerator.generate", lambda _self, _presentation: b"pptx"
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
                    {"id": "slide-1", "order": 0, "type": "TITLE", "content": {}}
                ],
            }
        },
    )

    assert response.status_code == 200
    assert response.content == b"\x89PNG\r\n\x1a\npreview"
