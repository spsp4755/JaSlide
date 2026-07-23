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
