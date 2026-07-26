import base64
from io import BytesIO

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, PP_PLACEHOLDER
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

from apps.renderer.src.services.pptx_to_html import pptx_to_html

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1nQAAAABJRU5ErkJggg==")


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

    # Widening column 0 to 3in makes the table 5in wide; python-pptx leaves the
    # graphicFrame's stored extent at the original 4in. PowerPoint draws the table at
    # its own 5in, so the column is 3/5 of it — measuring against the stale frame
    # (3/4 = 75%) put the preview and the editor's cell grid out of step with the deck.
    assert "width:60.0%" in result["htmlSlides"][0]
    table = next(obj for obj in result["source"]["slides"][0]["objects"] if obj["kind"] == "table")
    assert table["width"] == sum(table["columnWidths"])
    assert table["height"] == sum(table["rowHeights"])
    assert "background:#112233" in result["htmlSlides"][0]
    assert "font-family:NanumGothic" in result["htmlSlides"][0]


def test_extracts_real_row_and_column_geometry_for_a_table():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    table = slide.shapes.add_table(2, 2, Inches(1), Inches(1), Inches(6), Inches(3)).table
    table.rows[0].height = Inches(1)
    table.rows[1].height = Inches(2)
    table.columns[0].width = Inches(4)
    table.columns[1].width = Inches(2)

    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())
    table_object = next(obj for obj in result["source"]["slides"][0]["objects"] if obj["kind"] == "table")

    assert table_object["rowHeights"][0] < table_object["rowHeights"][1]
    assert table_object["columnWidths"][0] > table_object["columnWidths"][1]
    assert round(table_object["rowHeights"][0] / sum(table_object["rowHeights"]), 2) == round(1 / 3, 2)


def test_extracts_alignment_for_a_text_object():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    box.text = "Heading"
    box.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER

    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())
    text_object = next(obj for obj in result["source"]["slides"][0]["objects"] if obj["kind"] == "text")

    assert text_object["align"] == "center"


def test_extracts_a_picture_placeholder_as_an_image_object():
    # Real decks drop screenshots into a layout's picture placeholder, whose
    # shape_type reports PLACEHOLDER rather than PICTURE. Matching only on
    # PICTURE degraded those slides to an empty white box, losing the image.
    presentation = Presentation()
    layout = next(
        item for item in presentation.slide_layouts
        if any(place.placeholder_format.type == PP_PLACEHOLDER.PICTURE for place in item.placeholders)
    )
    slide = presentation.slides.add_slide(layout)
    placeholder = next(item for item in slide.placeholders if item.placeholder_format.type == PP_PLACEHOLDER.PICTURE)
    placeholder.insert_picture(BytesIO(PNG))

    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())

    assert "image" in [obj["kind"] for obj in result["source"]["slides"][0]["objects"]]
    assert 'data-object-type="image"' in result["htmlSlides"][0]


def test_defaults_alignment_to_left_when_unset():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    box.text = "Body"

    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())
    text_object = next(obj for obj in result["source"]["slides"][0]["objects"] if obj["kind"] == "text")

    assert text_object["align"] == "left"
