"""Convert a PPTX deck into the canonical SlideScene model.

`pptx_to_html.py` produces the *rendering* — HTML the browser paints and, in
its `source.slides[].objects[]`, a flatter object map keyed for the live
canvas. This module produces the *storage source*: every shape as a scene
object with its full text runs (not just paragraph text), its exact OOXML
preset geometry name (not a lossy enum), and a `sourceRef` back to the shape
id everything else already keys edits by.

Reuses the low-level colour/font/geometry helpers from `pptx_to_html` rather
than re-deriving theme-colour and EMU-to-canvas-px math a second time —
importing them is worth the coupling to a private module; getting that math
subtly wrong twice is not.
"""

from io import BytesIO

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.shapes.group import GroupShape
from pptx.shapes.picture import Picture

from .pptx_to_html import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    MAX_OBJECTS_PER_SLIDE,
    _color,
    _font_color,
    _font_name,
    _line_color,
    _line_width,
    _px,
    _pt_to_canvas_px,
)
from .theme_colors import theme_palette

# A shape with no preset geometry (a connector, a freeform) falls back to a
# plain rectangle — the same fidelity the HTML renderer already gives every
# shape it cannot draw a real silhouette for.
DEFAULT_SHAPE_KIND = "rect"


def _preset_geometry(shape) -> str | None:
    """The deck's own OOXML preset name (`prstGeom/@prst`), not an enum.

    `_preset_shape` on export feeds this string straight to
    `MSO_SHAPE.from_xml`, so keeping the deck's own spelling is what makes a
    re-exported shape come back as the same silhouette it started as.
    """
    element = shape._element.find(f".//{qn('a:prstGeom')}")
    return element.get("prst") if element is not None else None


def _run_dict(run, pt_to_px: float, palette: dict[str, str]) -> dict:
    return {
        "text": run.text,
        "bold": bool(run.font.bold),
        "italic": bool(run.font.italic),
        "underline": bool(run.font.underline),
        "color": _font_color(run.font.color, palette, run) or "#1A1A1A",
        "fontSize": round(run.font.size.pt) if run.font.size else None,
        "fontFamily": _font_name(run) or None,
    }


def _paragraph_dict(paragraph, pt_to_px: float, palette: dict[str, str]) -> dict:
    runs = [_run_dict(run, pt_to_px, palette) for run in paragraph.runs]
    # An empty line still has to round-trip as a paragraph, or a blank row in a
    # multi-line box silently disappears.
    if not runs:
        runs = [{"text": ""}]
    return {
        "runs": runs,
        "level": paragraph.level or 0,
        "align": {PP_ALIGN.CENTER: "center", PP_ALIGN.RIGHT: "right", PP_ALIGN.JUSTIFY: "justify"}.get(
            paragraph.alignment, "left"),
    }


def _text_frame_paragraphs(text_frame, pt_to_px: float, palette: dict[str, str]) -> list[dict]:
    return [_paragraph_dict(paragraph, pt_to_px, palette) for paragraph in text_frame.paragraphs]


def _table_cell_dict(cell, pt_to_px: float, palette: dict[str, str]) -> dict:
    result = {"paragraphs": _text_frame_paragraphs(cell.text_frame, pt_to_px, palette)}
    fill = _color(cell.fill, palette)
    if fill:
        result["fill"] = fill
    return result


def pptx_to_scene(content: bytes) -> dict:
    """`{"slides": [SlideScene, ...]}` for every slide in the deck."""
    presentation = Presentation(BytesIO(content))
    pt_to_px = _pt_to_canvas_px(presentation)
    palette = theme_palette(presentation)
    slides = []

    def extract(shape, objects: list) -> None:
        if len(objects) >= MAX_OBJECTS_PER_SLIDE:
            return
        base = {
            "id": str(shape.shape_id),
            "x": _px(shape.left, presentation.slide_width, CANVAS_WIDTH),
            "y": _px(shape.top, presentation.slide_height, CANVAS_HEIGHT),
            "width": _px(shape.width, presentation.slide_width, CANVAS_WIDTH),
            "height": _px(shape.height, presentation.slide_height, CANVAS_HEIGHT),
            "rotation": shape.rotation or 0,
            "sourceRef": {"kind": "pptx-shape", "shapeId": str(shape.shape_id)},
        }

        if isinstance(shape, GroupShape):
            # A group's members carry their own absolute position already —
            # descend rather than treat the whole group as one opaque box.
            for member in shape.shapes:
                extract(member, objects)
        elif isinstance(shape, Picture):
            objects.append({**base, "type": "image", "src": ""})
        elif getattr(shape, "has_table", False):
            row_heights = [_px(row.height, presentation.slide_height, CANVAS_HEIGHT) for row in shape.table.rows]
            column_widths = [_px(column.width, presentation.slide_width, CANVAS_WIDTH) for column in shape.table.columns]
            objects.append({
                **base, "type": "table",
                # A table draws at the sum of its own column widths and row
                # heights, not the graphicFrame's stored extent — python-pptx
                # never recomputes that extent when a column is resized.
                "width": sum(column_widths) or base["width"],
                "height": sum(row_heights) or base["height"],
                "rowHeights": row_heights, "columnWidths": column_widths,
                "cells": [[_table_cell_dict(cell, pt_to_px, palette) for cell in row.cells] for row in shape.table.rows],
            })
        elif shape.shape_type == MSO_SHAPE_TYPE.LINE:
            objects.append({
                **base, "type": "line",
                # ponytail: arrowheads are not read from the connector's XML yet
                # (headEnd/tailEnd) — every imported line comes back undecorated
                # until that's worth adding. Not a fidelity regression: the old
                # object map had no line kind at all, so this is a net gain.
                "lineStyle": "straightLine",
                "stroke": _line_color(shape, palette) or "#202124",
                "strokeWidth": _line_width(shape),
            })
        elif getattr(shape, "has_text_frame", False) and shape.text.strip():
            objects.append({
                **base, "type": "text",
                "paragraphs": _text_frame_paragraphs(shape.text_frame, pt_to_px, palette),
            })
        else:
            objects.append({
                **base, "type": "shape",
                "shape": _preset_geometry(shape) or DEFAULT_SHAPE_KIND,
                "fill": _color(getattr(shape, "fill", None), palette) or "#FFFFFF",
                "stroke": _line_color(shape, palette) or "#202124",
                "strokeWidth": _line_width(shape),
            })

    for slide in presentation.slides:
        objects: list[dict] = []
        for shape in slide.shapes:
            if len(objects) >= MAX_OBJECTS_PER_SLIDE:
                break
            try:
                extract(shape, objects)
            except Exception:  # noqa: BLE001
                # One exotic shape must not cost the user the whole slide.
                continue
        slides.append({"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT, "objects": objects})

    return {"slides": slides}
