from io import BytesIO
from types import SimpleNamespace

from pptx import Presentation

from apps.renderer.src.generators.pptx_generator import PPTXGenerator


def _presentation(*slides):
    return SimpleNamespace(slides=slides)


def _slide(slide_type, title, content):
    return SimpleNamespace(type=slide_type, title=title, content=content)


def _runs(slide):
    return [run for shape in slide.shapes if shape.has_text_frame for paragraph in shape.text_frame.paragraphs for run in paragraph.runs]


def _rgb(color):
    return str(color.rgb)


def test_default_tokens_style_korean_title_content_and_quote_slides():
    pptx = PPTXGenerator().generate(
        _presentation(
            _slide("TITLE", "제목", {"heading": "제목", "subheading": "부제목"}),
            _slide("CONTENT", "내용", {"heading": "내용", "body": "한글 본문", "bullets": ["첫 항목"]}),
            _slide("QUOTE", "", {"body": "인용문"}),
        )
    )

    generated = Presentation(BytesIO(pptx))
    for slide in generated.slides:
        assert _rgb(slide.background.fill.fore_color) == "FFFFFF"
        for run in _runs(slide):
            assert run.font.name == "Noto Sans KR"
            assert _rgb(run.font.color) == "1E293B"


def test_template_colors_apply_to_all_slide_text_and_background_with_invalid_values_falling_back():
    template = SimpleNamespace(
        config=SimpleNamespace(
            colors={"background": "#123456", "text": "#ABCDEF", "primary": "not-a-color"},
            backgrounds={"type": "solid", "value": "#BAD"},
        )
    )
    pptx = PPTXGenerator(template).generate(
        _presentation(
            _slide("TITLE", "제목", {"heading": "제목", "subheading": "부제목"}),
            _slide("CONTENT", "내용", {"heading": "내용", "body": "한글 본문", "bullets": ["첫 항목"]}),
            _slide("QUOTE", "", {"body": "인용문"}),
        )
    )

    generated = Presentation(BytesIO(pptx))
    for slide in generated.slides:
        assert _rgb(slide.background.fill.fore_color) == "123456"
        for run in _runs(slide):
            assert _rgb(run.font.color) == "ABCDEF"


def test_two_column_slide_uses_the_shared_background_and_text_tokens():
    template = SimpleNamespace(config=SimpleNamespace(colors={"background": "#102030", "text": "#DDEEFF"}))
    pptx = PPTXGenerator(template).generate(
        _presentation(
            _slide("TWO_COLUMN", "비교", {"heading": "비교", "bullets": ["왼쪽", "오른쪽"]}),
        )
    )

    slide = Presentation(BytesIO(pptx)).slides[0]
    assert _rgb(slide.background.fill.fore_color) == "102030"
    assert {_rgb(run.font.color) for run in _runs(slide)} == {"DDEEFF"}
