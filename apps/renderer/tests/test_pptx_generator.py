from io import BytesIO
from types import SimpleNamespace

from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

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


def test_korean_runs_use_the_east_asian_font_slot():
    pptx = PPTXGenerator().generate(
        _presentation(_slide("CONTENT", "한글 제목", {"heading": "한글 제목", "body": "한글 본문"}))
    )

    slide = Presentation(BytesIO(pptx)).slides[0]
    for run in _runs(slide):
        assert run._r.rPr.find(qn("a:ea")).get("typeface") == "Noto Sans KR"


def test_bare_template_hex_values_fall_back_to_default_tokens():
    template = SimpleNamespace(config=SimpleNamespace(colors={"background": "123456", "text": "ABCDEF"}))
    pptx = PPTXGenerator(template).generate(
        _presentation(_slide("CONTENT", "제목", {"heading": "제목", "body": "본문"}))
    )

    slide = Presentation(BytesIO(pptx)).slides[0]
    assert _rgb(slide.background.fill.fore_color) == "FFFFFF"
    assert {_rgb(run.font.color) for run in _runs(slide)} == {"1E293B"}


def test_bullets_preserve_their_text_without_prefix_artifacts():
    pptx = PPTXGenerator().generate(
        _presentation(
            _slide(
                "BULLET_LIST",
                "Agenda",
                {"heading": "Agenda", "bullets": [{"text": "First item", "level": 0}]},
            )
        )
    )

    slide = Presentation(BytesIO(pptx)).slides[0]
    paragraphs = [
        paragraph.text
        for shape in slide.shapes
        if shape.has_text_frame
        for paragraph in shape.text_frame.paragraphs
    ]

    assert "\u2022 First item" in paragraphs


def test_html_template_layout_positions_content_textboxes():
    template = SimpleNamespace(
        config=SimpleNamespace(
            htmlTemplate=(
                '<h1 data-jaslide-slot="title" data-x="1" data-y="1" data-w="9" '
                'data-h="1" data-align="center"></h1>'
                '<p data-jaslide-slot="body" data-x="1" data-y="2" data-w="9" '
                'data-h="3" data-font-size="22"></p>'
            )
        )
    )
    pptx = PPTXGenerator(template).generate(
        _presentation(_slide("CONTENT", "", {"heading": "Heading", "body": "Body"}))
    )

    shapes = Presentation(BytesIO(pptx)).slides[0].shapes
    assert shapes[0].left == Inches(1)
    assert shapes[0].top == Inches(1)
    assert shapes[0].text_frame.paragraphs[0].alignment == PP_ALIGN.CENTER
    assert shapes[1].top == Inches(2)
    assert shapes[1].text_frame.paragraphs[0].runs[0].font.size == Pt(22)


def test_html_template_layout_styles_bullet_slide_titles():
    template = SimpleNamespace(
        config=SimpleNamespace(
            htmlTemplate=(
                '<h1 data-jaslide-slot="title" data-x="2" data-y="1" data-w="8" '
                'data-h="1" data-font-size="26" data-align="right"></h1>'
            )
        )
    )
    pptx = PPTXGenerator(template).generate(
        _presentation(_slide("BULLET_LIST", "Agenda", {"heading": "Agenda", "bullets": ["One"]}))
    )

    title = Presentation(BytesIO(pptx)).slides[0].shapes[0]
    paragraph = title.text_frame.paragraphs[0]
    assert title.left == Inches(2)
    assert title.top == Inches(1)
    assert paragraph.alignment == PP_ALIGN.RIGHT
    assert paragraph.runs[0].font.size == Pt(26)


def test_reusing_a_generator_does_not_accumulate_prior_slides():
    generator = PPTXGenerator()
    presentation = _presentation(_slide("TITLE", "One", {"heading": "One"}))

    generator.generate(presentation)
    second_output = generator.generate(presentation)

    assert len(Presentation(BytesIO(second_output)).slides) == 1
