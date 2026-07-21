from io import BytesIO
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from apps.renderer.src.main import app
from apps.renderer.src.services.html_template_archive import extract_html_template_archive


def make_zip(entries):
    content = BytesIO()
    with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in entries.items():
            archive.writestr(name, value)
    return content.getvalue()


def manifest(playlist):
    return json.dumps({
        "format": "html",
        "metadata": {"title": "Research deck", "description": "Example"},
        "canvas": {"width": 1920, "height": 1080},
        "playlist": playlist,
    })


def test_extract_html_template_archive_reads_genspark_style_slides():
    result = extract_html_template_archive(make_zip({
        "deck/research.slides/manifest.json": manifest(["01-cover.html", "02-body.html"]),
        "deck/research.slides/slides/01-cover.html": "<h1>Cover</h1>",
        "deck/research.slides/slides/02-body.html": "<p>Body</p>",
        "previews/01-cover.png": b"preview",
    }))

    assert result == {
        "title": "Research deck",
        "description": "Example",
        "htmlTemplate": "<h1>Cover</h1>",
        "htmlSlides": ["<h1>Cover</h1>", "<p>Body</p>"],
        "archive": {
            "manifestPath": "deck/research.slides/manifest.json",
            "canvas": {"width": 1920, "height": 1080},
            "slides": [
                "deck/research.slides/slides/01-cover.html",
                "deck/research.slides/slides/02-body.html",
            ],
            "thumbnailPath": "previews/01-cover.png",
        },
    }


@pytest.mark.parametrize("entries", [
    {"../deck/demo/manifest.json": manifest(["one.html"])},
    {"deck/demo/manifest.json": manifest(["missing.html"])},
])
def test_extract_html_template_archive_rejects_unsafe_or_missing_slides(entries):
    with pytest.raises(ValueError):
        extract_html_template_archive(make_zip(entries))


def test_extract_html_template_endpoint_returns_validated_config():
    response = TestClient(app).post(
        "/api/extract/html-template",
        files={"file": ("research.zip", make_zip({
            "deck/demo/manifest.json": manifest(["one.html"]),
            "deck/demo/one.html": "<h1>One</h1>",
        }), "application/zip")},
    )

    assert response.status_code == 200
    assert response.json()["config"]["htmlTemplate"] == "<h1>One</h1>"


def test_extract_html_template_archive_inlines_bundled_css_tokens():
    result = extract_html_template_archive(make_zip({
        "deck/demo/manifest.json": manifest(["one.html"]),
        "deck/demo/one.html": '<link rel="stylesheet" href="../assets/tokens.css"><h1>One</h1>',
        "deck/assets/tokens.css": ':root { --ink: #112233; }',
    }))

    assert '--ink: #112233' in result["htmlTemplate"]
    assert '--ink: #112233' in result["htmlSlides"][0]


def test_render_pptx_accepts_a_korean_title():
    response = TestClient(app).post("/api/render/pptx", json={
        "presentation": {
            "id": "presentation-1",
            "title": "한글 제목",
            "slides": [{"id": "slide-1", "order": 1, "type": "CONTENT", "title": "제목", "content": {"heading": "제목"}}],
        },
    })

    assert response.status_code == 200
