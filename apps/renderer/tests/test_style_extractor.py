from io import BytesIO

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Inches

from apps.renderer.src.services.style_extractor import extract_template_tokens


KOREAN_TEXT = "한글 제목은 추출하면 안 됩니다"


def _set_east_asian_font(run, typeface):
    r_pr = run._r.get_or_add_rPr()
    east_asian = OxmlElement("a:ea")
    east_asian.set("typeface", typeface)
    r_pr.append(east_asian)


def _example_pptx():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = RGBColor(0x11, 0x22, 0x33)

    title = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1))
    run = title.text_frame.paragraphs[0].add_run()
    run.text = KOREAN_TEXT
    run.font.name = "Fallback Font"
    _set_east_asian_font(run, "Noto Sans KR")

    for left in (1, 3):
        shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(3), Inches(1), Inches(1))
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor(0x44, 0x55, 0x66)

    buffer = BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


def test_extracts_only_deterministic_style_tokens_and_prefers_east_asian_font():
    tokens = extract_template_tokens(_example_pptx())

    assert tokens == {
        "colors": {"background": "#112233", "primary": "#445566"},
        "typography": {"titleFont": "Noto Sans KR", "bodyFont": "Noto Sans KR"},
    }
    assert KOREAN_TEXT not in str(tokens)


def test_ignores_patterned_shape_fills():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(1), Inches(1))
    shape.fill.patterned()
    shape.fill.fore_color.rgb = RGBColor(0xAA, 0xBB, 0xCC)

    buffer = BytesIO()
    presentation.save(buffer)

    assert extract_template_tokens(buffer.getvalue()) == {"colors": {}, "typography": {}}
