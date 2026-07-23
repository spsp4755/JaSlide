from io import BytesIO

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt

from apps.renderer.src.services.pptx_to_html import pptx_to_html


def test_converts_pptx_shapes_and_text_to_positioned_html_slides():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = RGBColor(0x11, 0x22, 0x33)
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1))
    run = box.text_frame.paragraphs[0].add_run()
    run.text = "안전 <검증>"
    run.font.size = Pt(32)
    rectangle = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2), Inches(3), Inches(3), Inches(1))
    rectangle.fill.solid()
    rectangle.fill.fore_color.rgb = RGBColor(0x44, 0x55, 0x66)
    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())

    assert result["archive"]["slides"] == ["slide-01"]
    assert "background:#112233" in result["htmlSlides"][0]
    assert "left:192px" in result["htmlSlides"][0]
    assert "안전 &lt;검증&gt;" in result["htmlSlides"][0]
    assert "background:#445566" in result["htmlSlides"][0]


def test_preserves_pptx_font_family_in_html():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1))
    run = box.text_frame.paragraphs[0].add_run()
    run.text = "Weekly report"
    run.font.name = "NanumGothic"
    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())

    assert "font-family:NanumGothic" in result["htmlSlides"][0]


def test_converts_tables_without_assuming_a_shape_fill():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    table = slide.shapes.add_table(2, 2, Inches(1), Inches(1), Inches(4), Inches(2)).table
    table.cell(0, 0).text = "Header"
    table.cell(1, 1).text = "Value"
    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())

    assert 'data-object-type="table"' in result["htmlSlides"][0]
    assert "Header" in result["htmlSlides"][0]
    assert result["source"]["kind"] == "pptx"
    assert result["source"]["slides"][0]["objects"][0]["kind"] == "table"
    assert result["source"]["slides"][0]["objects"][0]["id"]
    assert result["source"]["slides"][0]["objects"][0]["left"] == 192
    assert result["source"]["slides"][0]["objects"][0]["cells"] == [["Header", ""], ["", "Value"]]


def test_preserves_table_cell_dimensions_and_formatting():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    table = slide.shapes.add_table(2, 2, Inches(1), Inches(1), Inches(4), Inches(2)).table
    table.columns[0].width = Inches(3)
    table.cell(0, 0).fill.solid()
    table.cell(0, 0).fill.fore_color.rgb = RGBColor(0x11, 0x22, 0x33)
    run = table.cell(0, 0).text_frame.paragraphs[0].add_run()
    run.text = "Header"
    run.font.name = "NanumGothic"
    run.font.size = Pt(18)
    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())

    assert "width:75.0%" in result["htmlSlides"][0]
    assert "background:#112233" in result["htmlSlides"][0]
    assert "font-family:NanumGothic" in result["htmlSlides"][0]
