from io import BytesIO

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.util import Inches, Pt

from apps.renderer.src.services.pptx_scene import pptx_to_scene


def _deck_bytes(build) -> bytes:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    build(slide)
    buffer = BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


def test_a_text_box_keeps_its_shape_id_and_per_run_formatting():
    def build(slide):
        box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1))
        paragraph = box.text_frame.paragraphs[0]
        bold_run = paragraph.add_run()
        bold_run.text = "Plain "
        plain_run = paragraph.add_run()
        plain_run.text = "bold"
        plain_run.font.bold = True
        plain_run.font.size = Pt(20)
        plain_run.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]
    text = next(item for item in scene["objects"] if item["type"] == "text")

    assert text["sourceRef"] == {"kind": "pptx-shape", "shapeId": text["id"]}
    runs = text["paragraphs"][0]["runs"]
    assert [run["text"] for run in runs] == ["Plain ", "bold"]
    assert not runs[0].get("bold")
    assert runs[1]["bold"] is True
    assert runs[1]["fontSize"] == 20
    assert runs[1]["color"] == "#FF0000"


def test_a_table_cell_keeps_its_fill_and_paragraphs():
    def build(slide):
        table = slide.shapes.add_table(1, 2, Inches(1), Inches(1), Inches(6), Inches(1)).table
        table.cell(0, 0).text = "Header"
        table.cell(0, 0).fill.solid()
        table.cell(0, 0).fill.fore_color.rgb = RGBColor(0xD9, 0xD9, 0xD9)

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]
    table = next(item for item in scene["objects"] if item["type"] == "table")

    assert table["cells"][0][0]["paragraphs"][0]["runs"][0]["text"] == "Header"
    assert table["cells"][0][0]["fill"] == "#D9D9D9"
    assert len(table["rowHeights"]) == 1 and len(table["columnWidths"]) == 2


def test_an_autoshape_keeps_its_preset_geometry_fill_and_rotation():
    def build(slide):
        shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1), Inches(1), Inches(2), Inches(1))
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor(0x25, 0x63, 0xEB)
        shape.rotation = 15

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]
    shape_object = next(item for item in scene["objects"] if item["type"] == "shape")

    # The exact OOXML preset name, not a lossy enum round-trip: _preset_shape on
    # export feeds this straight to MSO_SHAPE.from_xml, so keeping the deck's own
    # string is what makes re-exporting produce the same silhouette it started with.
    assert shape_object["shape"] == "roundRect"
    assert shape_object["fill"] == "#2563EB"
    assert shape_object["rotation"] == 15


def test_a_straight_connector_is_a_line_not_a_shape():
    def build(slide):
        connector = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1), Inches(1), Inches(4), Inches(1))
        connector.line.color.rgb = RGBColor(0x00, 0xAA, 0x00)
        connector.line.width = Pt(3)

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]

    assert [item["type"] for item in scene["objects"]] == ["line"]
    line = scene["objects"][0]
    assert line["stroke"] == "#00AA00"


def test_rotation_defaults_to_zero_when_the_deck_states_none():
    def build(slide):
        slide.shapes.add_textbox(Inches(1), Inches(1), Inches(2), Inches(1)).text_frame.paragraphs[0].add_run().text = "x"

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]

    assert scene["objects"][0]["rotation"] == 0


def test_scene_canvas_size_matches_the_editor_stage():
    scene = pptx_to_scene(_deck_bytes(lambda slide: None))["slides"][0]

    assert scene["width"] == 1920
    assert scene["height"] == 1080
