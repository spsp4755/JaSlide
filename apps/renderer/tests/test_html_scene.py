from apps.renderer.src.services.html_scene import html_to_scene, scene_to_html

SLIDE = (
    '<div class="slide-container" style="position:relative;width:1920px;height:1080px;background:#FFFFFF">'
    '<div data-object="true" data-object-type="textbox" '
    'style="position:absolute;left:140px;top:120px;width:1640px;height:200px;font-size:44px;color:#1A1A1A;'
    'font-family:Pretendard;font-weight:700">주간 업무 보고</div>'
    '<div data-object="true" data-object-type="table" '
    'style="position:absolute;left:53px;top:400px;width:1814px;height:400px">'
    '<table><tr><td>추진실적</td><td>추진계획</td></tr></table>'
    '</div>'
    "</div>"
)


def test_a_text_object_keeps_its_geometry_and_a_single_run_with_the_deck_style():
    scene = html_to_scene([SLIDE])["slides"][0]
    text = next(item for item in scene["objects"] if item["type"] == "text")

    # 1920x1080 canvas px, the same space the PPTX importer and the editor use —
    # not the inches parse_html_objects converts to for the older layout-hint path.
    assert (text["x"], text["y"], text["width"], text["height"]) == (140, 120, 1640, 200)
    run = text["paragraphs"][0]["runs"][0]
    assert run["text"] == "주간 업무 보고"
    assert run["bold"] is True
    assert run["fontFamily"] == "Pretendard"
    assert run["color"] == "#1A1A1A"


def test_a_table_object_keeps_its_cell_text():
    scene = html_to_scene([SLIDE])["slides"][0]
    table = next(item for item in scene["objects"] if item["type"] == "table")

    assert table["cells"][0][0]["paragraphs"][0]["runs"][0]["text"] == "추진실적"
    assert table["cells"][0][1]["paragraphs"][0]["runs"][0]["text"] == "추진계획"


def test_every_object_carries_a_selector_and_its_original_css_for_round_tripping():
    scene = html_to_scene([SLIDE])["slides"][0]

    for index, item in enumerate(scene["objects"]):
        assert item["sourceRef"]["kind"] == "html-node"
        assert item["sourceRef"]["selector"]
        assert isinstance(item["sourceRef"]["originalCss"], str) and item["sourceRef"]["originalCss"]


def test_object_ids_are_stable_across_two_reads_of_the_same_html():
    first = html_to_scene([SLIDE])["slides"][0]["objects"]
    second = html_to_scene([SLIDE])["slides"][0]["objects"]

    assert [item["id"] for item in first] == [item["id"] for item in second]


def test_scene_canvas_size_matches_the_editor_stage():
    scene = html_to_scene([SLIDE])["slides"][0]

    assert scene["width"] == 1920 and scene["height"] == 1080


def test_one_scene_per_input_slide():
    scenes = html_to_scene([SLIDE, SLIDE])["slides"]

    assert len(scenes) == 2


def test_scene_to_html_round_trips_through_html_to_scene():
    scene = html_to_scene([SLIDE])["slides"][0]

    html = scene_to_html(scene)
    reparsed = html_to_scene([html])["slides"][0]

    assert len(reparsed["objects"]) == len(scene["objects"])
    text = next(item for item in reparsed["objects"] if item["type"] == "text")
    original_text = next(item for item in scene["objects"] if item["type"] == "text")
    assert text["paragraphs"][0]["runs"][0]["text"] == original_text["paragraphs"][0]["runs"][0]["text"]
    assert (text["x"], text["y"], text["width"], text["height"]) == \
        (original_text["x"], original_text["y"], original_text["width"], original_text["height"])


def test_scene_to_html_keeps_bold_and_color_on_the_written_run():
    scene = {
        "width": 1920, "height": 1080,
        "objects": [{
            "id": "obj-1", "x": 10, "y": 20, "width": 300, "height": 60, "rotation": 0,
            "type": "text",
            "paragraphs": [{"runs": [{"text": "Hi", "bold": True, "color": "#FF0000", "fontSize": 24}], "level": 0, "align": "left"}],
        }],
    }

    html = scene_to_html(scene)

    assert "font-weight:700" in html
    assert "color:#FF0000" in html
    assert ">Hi<" in html


def test_scene_to_html_writes_a_table_with_its_cell_text():
    scene = {
        "width": 1920, "height": 1080,
        "objects": [{
            "id": "table-1", "x": 0, "y": 0, "width": 400, "height": 200, "rotation": 0,
            "type": "table", "rowHeights": [200], "columnWidths": [200, 200],
            "cells": [[
                {"paragraphs": [{"runs": [{"text": "A"}], "level": 0, "align": "left"}]},
                {"paragraphs": [{"runs": [{"text": "B"}], "level": 0, "align": "left"}]},
            ]],
        }],
    }

    html = scene_to_html(scene)

    assert "<table>" in html
    assert ">A<" in html and ">B<" in html
