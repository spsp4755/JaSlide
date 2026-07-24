from io import BytesIO
import base64
from types import SimpleNamespace

from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.dml.color import RGBColor
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


def test_genspark_style_html_applies_colors_fonts_and_title_position_without_slots():
    template = SimpleNamespace(
        config=SimpleNamespace(
            htmlTemplate=(
                '<body style="background:#fdfcf8;color:#0a1530;font-family:Inter">'
                '<div data-object-type="textbox" style="position:absolute;left:200px;top:230px;width:1400px;'
                'font-family:Newsreader;font-size:112px;color:#0a1530"></div></body>'
            )
        )
    )
    pptx = PPTXGenerator(template).generate(
        _presentation(_slide("CONTENT", "Heading", {"heading": "Heading", "body": "Body"}))
    )

    slide = Presentation(BytesIO(pptx)).slides[0]
    assert _rgb(slide.background.fill.fore_color) == "FDFCF8"
    assert slide.shapes[0].left == Inches(200 / 1920 * 13.333)
    assert slide.shapes[0].top == Inches(230 / 1080 * 7.5)
    assert slide.shapes[0].text_frame.paragraphs[0].runs[0].font.name == "Newsreader"


def test_html_slide_template_renders_its_shape_and_title_layout():
    template = SimpleNamespace(
        config=SimpleNamespace(
            htmlSlides=[
                '<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:#123456"></div>'
                '<div data-object="true" data-object-type="textbox" style="position:absolute;left:120px;top:172px;width:1680px;height:200px;font-size:56px;color:#FFFFFF">Template title</div>'
            ]
        )
    )
    pptx = PPTXGenerator(template).generate(
        _presentation(_slide("CONTENT", "Generated title", {"heading": "Generated title"}))
    )

    slide = Presentation(BytesIO(pptx)).slides[0]
    assert _rgb(slide.background.fill.fore_color) == "123456"
    assert slide.shapes[0].left == Inches(120 / 1920 * 13.333)
    assert slide.shapes[0].text == "Generated title"


def test_html_content_embeds_one_full_slide_browser_image(monkeypatch):
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jp5cAAAAASUVORK5CYII=")
    monkeypatch.setattr("apps.renderer.src.generators.pptx_generator.render_slide_png", lambda html: png)

    output = PPTXGenerator().generate(_presentation(_slide(
        "CONTENT", "HTML", {"html": "<main data-object=\"true\">HTML</main>"},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    picture = next(shape for shape in slide.shapes if shape.shape_type == 13)
    assert picture.left == 0 and picture.top == 0
    assert picture.width == Inches(13.333) and picture.height == Inches(7.5)


def test_html_template_chooses_layouts_by_slide_type_not_first_n_slides():
    def layout(color):
        return f'<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:{color}"></div>'

    template = SimpleNamespace(config=SimpleNamespace(
        htmlSlides=[layout("#111111"), layout("#222222"), layout("#333333")],
        zipTemplate={"slides": ["slides/cover.html", "slides/agenda.html", "slides/market.html"]},
    ))
    output = PPTXGenerator(template).generate(_presentation(
        _slide("TITLE", "Title", {"heading": "Title"}),
        _slide("BULLET_LIST", "Agenda", {"heading": "Agenda"}),
        _slide("CONTENT", "Market", {"heading": "Market"}),
    ))

    assert [_rgb(slide.background.fill.fore_color) for slide in Presentation(BytesIO(output)).slides] == ["111111", "222222", "333333"]


def test_html_template_uses_the_outline_selected_layout_when_present():
    def layout(color):
        return f'<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:{color}"></div>'

    template = SimpleNamespace(config=SimpleNamespace(htmlSlides=[layout("#111111"), layout("#222222"), layout("#333333")]))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "CONTENT", "Risk findings", {"heading": "Risk findings", "templateIndex": 2},
    )))

    assert _rgb(Presentation(BytesIO(output)).slides[0].background.fill.fore_color) == "333333"


def test_html_template_rejects_a_reference_layout_for_a_conclusion_slide():
    def layout(color):
        return f'<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:{color}"></div>'

    template = SimpleNamespace(config=SimpleNamespace(
        htmlSlides=[layout("#111111"), layout("#222222"), layout("#333333")],
        zipTemplate={"slides": ["slides/cover.html", "slides/executive-summary.html", "slides/references.html"]},
    ))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "QUOTE", "Conclusion", {"heading": "Conclusion", "templateIndex": 2},
    )))

    assert _rgb(Presentation(BytesIO(output)).slides[0].background.fill.fore_color) == "222222"


def test_html_template_fills_blank_card_shapes_with_generated_bullets():
    template = SimpleNamespace(config=SimpleNamespace(htmlSlides=[
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:#FFFFFF"></div>'
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:120px;top:300px;width:700px;height:400px;background:#F2F5FA"></div>'
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:920px;top:300px;width:700px;height:400px;background:#F2F5FA"></div>'
    ]))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "BULLET_LIST", "Title", {"heading": "Title", "bullets": ["First", "Second"]},
    )))

    text = " ".join(shape.text for shape in Presentation(BytesIO(output)).slides[0].shapes if shape.has_text_frame)
    assert "First" in text and "Second" in text


def test_report_template_uses_a_table_layout_for_a_threat_model_slide():
    html = (
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:#FAFAF7"></div>'
        '<div data-object="true" data-object-type="textbox" style="position:absolute;left:120px;top:130px;width:1400px;height:80px;font-size:56px;color:#1A1A1A">Template title</div>'
    )
    template = SimpleNamespace(config=SimpleNamespace(
        htmlSlides=[html], zipTemplate={"slides": ["slides/03-threat-model.html"]},
    ))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "CONTENT", "AI 위협 모델", {"heading": "AI 위협 모델", "body": "우선순위 기반 대응", "bullets": ["프롬프트 인젝션", "권한 오용"]},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    text = " ".join(shape.text for shape in slide.shapes if shape.has_text_frame)
    assert "위협 시나리오" in text and "프롬프트 인젝션" in text
    assert len(slide.shapes) >= 17  # title/header plus a four-column table


def test_html_template_fills_a_dark_callout_with_the_generated_summary():
    template = SimpleNamespace(config=SimpleNamespace(htmlSlides=[
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:#FFFFFF"></div>'
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:300px;top:400px;width:1300px;height:400px;background:#1A1A1A"></div>'
    ]))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "QUOTE", "Decision", {"heading": "Decision", "body": "Ship behind a safety gate.", "bullets": ["One", "Two", "Three"]},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    filled = next(shape for shape in slide.shapes if shape.has_text_frame and "Ship behind" in shape.text)
    assert _rgb(filled.text_frame.paragraphs[0].runs[0].font.color) == "FFFFFF"


def test_html_template_renders_chart_data_for_chart_slides():
    output = PPTXGenerator(SimpleNamespace(config=SimpleNamespace(htmlSlides=[
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:#FFFFFF"></div>'
    ]))).generate(_presentation(_slide(
        "CHART", "ASR", {"heading": "ASR", "chart": {"labels": ["Before", "After"], "values": [48, 11]}},
    )))

    assert any(shape.has_chart for shape in Presentation(BytesIO(output)).slides[0].shapes)


def test_html_template_without_font_family_uses_default_font():
    template = SimpleNamespace(config=SimpleNamespace(
        htmlTemplate='<div data-object="true" data-object-type="textbox" style="position:absolute;left:120px;top:120px;width:1200px;height:180px;font-size:48px">Title</div>',
    ))
    output = PPTXGenerator(template).generate(_presentation(_slide("TITLE", "Generated", {"heading": "Generated"})))

    assert Presentation(BytesIO(output)).slides[0].shapes[0].text == "Generated"


def test_html_template_without_data_object_markup_falls_back_to_generic_layout():
    # A real-world upload (Genspark export, Tailwind/CSS-class deck) never carries JaSlide's
    # own data-object markers or absolute-pixel inline positioning. Before this fix, such a
    # template produced a fully blank slide instead of the generated content below.
    template = SimpleNamespace(config=SimpleNamespace(
        htmlTemplate=(
            '<style>.card { background: #123456; }</style>'
            '<div class="card"><h1 style="color:#FFFFFF;font-size:56px;font-family:Newsreader">Cover</h1>'
            '<p style="font-size:20px;font-family:Pretendard">Body copy</p></div>'
        ),
        htmlSlides=[
            '<style>.card { background: #123456; }</style>'
            '<div class="card"><h1 style="color:#FFFFFF;font-size:56px;font-family:Newsreader">Cover</h1>'
            '<p style="font-size:20px;font-family:Pretendard">Body copy</p></div>'
        ],
    ))

    pptx = PPTXGenerator(template).generate(
        _presentation(_slide("CONTENT", "Generated title", {"heading": "Generated title", "body": "Generated body"}))
    )

    slide = Presentation(BytesIO(pptx)).slides[0]
    # Template background/fonts are still picked up even without data-object markup.
    assert _rgb(slide.background.fill.fore_color) == "123456"
    texts = [run.text for shape in slide.shapes if shape.has_text_frame
             for paragraph in shape.text_frame.paragraphs for run in paragraph.runs]
    assert "Generated title" in texts
    assert any("Newsreader" == shape.text_frame.paragraphs[0].runs[0].font.name
               for shape in slide.shapes if shape.has_text_frame and shape.text_frame.paragraphs[0].runs)


def test_reusing_a_generator_does_not_accumulate_prior_slides():
    generator = PPTXGenerator()
    presentation = _presentation(_slide("TITLE", "One", {"heading": "One"}))

    generator.generate(presentation)
    second_output = generator.generate(presentation)

    assert len(Presentation(BytesIO(second_output)).slides) == 1


def test_pptx_template_keeps_native_text_and_table_objects_editable():
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    title = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    title.text = "Original title"
    table_shape = slide.shapes.add_table(1, 1, Inches(1), Inches(2), Inches(4), Inches(1))
    table_shape.table.cell(0, 0).text = "Original cell"
    source_buffer = BytesIO()
    source.save(source_buffer)

    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(source_buffer.getvalue()).decode("ascii")))
    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {
        "objectEdits": [
            {"slide": 0, "objectId": str(title.shape_id), "text": "Updated title", "left": 240, "top": 180, "width": 720, "height": 120, "fontSize": 28, "color": "#112233", "bold": True, "italic": True},
            {"slide": 0, "objectId": str(table_shape.shape_id), "cells": [["Updated cell"]]},
        ],
    })))

    generated = Presentation(BytesIO(output))
    assert generated.slides[0].shapes[0].has_text_frame
    assert generated.slides[0].shapes[0].text == "Updated title"
    assert generated.slides[0].shapes[0].left == generated.slide_width * 240 // 1920
    assert generated.slides[0].shapes[0].top == generated.slide_height * 180 // 1080
    run = generated.slides[0].shapes[0].text_frame.paragraphs[0].runs[0]
    assert run.font.size == Pt(28) and str(run.font.color.rgb) == "112233" and run.font.bold and run.font.italic
    assert generated.slides[0].shapes[1].has_table
    assert generated.slides[0].shapes[1].table.cell(0, 0).text == "Updated cell"


def test_pptx_template_applies_native_shape_colors():
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(2), Inches(1))
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(shape.shape_id), "fillColor": "#112233", "lineColor": "#445566", "lineWidth": 3}]})))

    generated = Presentation(BytesIO(output)).slides[0].shapes[0]
    assert str(generated.fill.fore_color.rgb) == "112233"
    assert str(generated.line.color.rgb) == "445566"
    assert generated.line.width == 3 * 12700


def test_pptx_template_deletes_a_native_object():
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(2), Inches(1))
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(shape.shape_id), "delete": True}]})))

    assert len(Presentation(BytesIO(output)).slides[0].shapes) == 0


def test_pptx_template_adds_a_native_image():
    source = Presentation()
    source.slides.add_slide(source.slide_layouts[6])
    buffer = BytesIO(); source.save(buffer)
    image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1nQAAAABJRU5ErkJggg=="
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": "new-image", "imageData": image, "left": 200, "top": 100, "width": 400, "height": 200}]})))

    generated = Presentation(BytesIO(output)).slides[0].shapes[0]
    assert generated.shape_type == 13 and generated.left == Presentation(BytesIO(output)).slide_width * 200 // 1920


def test_pptx_template_adds_editable_native_text():
    source = Presentation(); source.slides.add_slide(source.slide_layouts[6])
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": "new-text", "addText": "Initial", "text": "Edited", "fontSize": 24, "bold": True}]})))

    generated = Presentation(BytesIO(output)).slides[0].shapes[0]
    assert generated.text == "Edited" and generated.text_frame.paragraphs[0].runs[0].font.size == Pt(24) and generated.text_frame.paragraphs[0].runs[0].font.bold


def test_pptx_template_adds_native_shapes_and_lines():
    source = Presentation(); source.slides.add_slide(source.slide_layouts[6])
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [
        {"slide": 0, "objectId": "triangle", "addShape": "triangle", "left": 100, "top": 100, "width": 400, "height": 300, "fillColor": "#FF0000"},
        {"slide": 0, "objectId": "line", "addLine": "straightLine", "left": 600, "top": 200, "width": 500, "height": 80, "lineColor": "#00AA00", "lineWidth": 3},
    ]})))

    shapes = Presentation(BytesIO(output)).slides[0].shapes
    assert len(shapes) == 2 and shapes[0].auto_shape_type == MSO_SHAPE.ISOSCELES_TRIANGLE and shapes[1].shape_type == 9


def test_pptx_template_preserves_unedited_table_and_shape():
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6])
    table = slide.shapes.add_table(1, 1, Inches(1), Inches(1), Inches(3), Inches(1)); table.table.cell(0, 0).text = "Keep"
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(5), Inches(1), Inches(2), Inches(1)); shape.fill.solid(); shape.fill.fore_color.rgb = RGBColor(0x11, 0x22, 0x33)
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))
    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(table.shape_id), "cells": [["Updated"]]}]})))
    generated = Presentation(BytesIO(output)).slides[0]
    assert generated.shapes[0].table.cell(0, 0).text == "Updated" and str(generated.shapes[1].fill.fore_color.rgb) == "112233"


def test_pptx_template_preserves_paragraph_indent_when_text_changes():
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6])
    text = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(2)); text.text = "First"; text.text_frame.add_paragraph().text = "Nested"; text.text_frame.paragraphs[1].level = 1
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))
    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(text.shape_id), "text": "Changed\nStill nested"}]})))
    assert Presentation(BytesIO(output)).slides[0].shapes[0].text_frame.paragraphs[1].level == 1


def test_pptx_text_replace_preserves_paragraph_alignment():
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6])
    text = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    text.text = "Original"
    text.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {
        "objectEdits": [{"slide": 0, "objectId": str(text.shape_id), "text": "Changed"}],
    })))

    paragraph = Presentation(BytesIO(output)).slides[0].shapes[0].text_frame.paragraphs[0]
    assert paragraph.text == "Changed"
    assert paragraph.alignment == PP_ALIGN.CENTER


def test_pptx_table_cell_replace_preserves_paragraph_alignment():
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6])
    table = slide.shapes.add_table(1, 1, Inches(1), Inches(1), Inches(4), Inches(2))
    cell = table.table.cell(0, 0); cell.text = "Original"
    cell.text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {
        "objectEdits": [{"slide": 0, "objectId": str(table.shape_id), "cells": [["Updated"]]}],
    })))

    paragraph = Presentation(BytesIO(output)).slides[0].shapes[0].table.cell(0, 0).text_frame.paragraphs[0]
    assert paragraph.text == "Updated"
    assert paragraph.alignment == PP_ALIGN.RIGHT


def test_sourcepptx_clones_the_template_slide_when_generated_slides_outnumber_it():
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    title = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    title.text = "Original"
    keep = slide.shapes.add_textbox(Inches(1), Inches(3), Inches(4), Inches(1))
    keep.text = "Keep"
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(
        _slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(title.shape_id), "text": "First"}]}),
        _slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(title.shape_id), "text": "Second"}]}),
    ))

    generated = Presentation(BytesIO(output))
    assert len(generated.slides) == 2
    first_texts = {shape.text for shape in generated.slides[0].shapes if shape.has_text_frame}
    second_texts = {shape.text for shape in generated.slides[1].shapes if shape.has_text_frame}
    assert first_texts == {"First", "Keep"}
    assert second_texts == {"Second", "Keep"}


def test_sourcepptx_preview_for_a_later_slide_returns_only_that_slides_own_edit():
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    title = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    title.text = "Original"
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    presentation = _presentation(
        _slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(title.shape_id), "text": "First"}]}),
        _slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(title.shape_id), "text": "Second"}]}),
    )

    output = PPTXGenerator(template).generate(presentation, slide_index=0)

    generated = Presentation(BytesIO(output))
    assert len(generated.slides) == 1
    assert generated.slides[0].shapes[0].text == "First"


def test_pptx_table_edits_survive_a_theme_colored_source_cell():
    # Many real-world decks color table text via a theme/scheme reference
    # (design-system driven) instead of an explicit RGB value. Reading
    # `.rgb` off such a run raises AttributeError, which must not crash the
    # whole render — the edit should still land, just without copying color.
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6])
    table = slide.shapes.add_table(1, 1, Inches(1), Inches(1), Inches(4), Inches(2))
    cell = table.table.cell(0, 0); cell.text = "Original"
    cell.text_frame.paragraphs[0].runs[0].font.color.theme_color = MSO_THEME_COLOR.ACCENT_1
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {
        "objectEdits": [{"slide": 0, "objectId": str(table.shape_id), "cells": [["Updated"]]}],
    })))

    assert Presentation(BytesIO(output)).slides[0].shapes[0].table.cell(0, 0).text == "Updated"


def test_pptx_table_edits_keep_cell_text_style():
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6]); table = slide.shapes.add_table(1, 1, Inches(1), Inches(1), Inches(4), Inches(2))
    cell = table.table.cell(0, 0); cell.text = "Original"; run = cell.text_frame.paragraphs[0].runs[0]; run.font.size = Pt(18); run.font.bold = True
    buffer = BytesIO(); source.save(buffer); template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))
    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [{"slide": 0, "objectId": str(table.shape_id), "cells": [["Updated"]]}]})))
    updated = Presentation(BytesIO(output)).slides[0].shapes[0].table.cell(0, 0).text_frame.paragraphs[0].runs[0]
    assert updated.font.size == Pt(18) and updated.font.bold
