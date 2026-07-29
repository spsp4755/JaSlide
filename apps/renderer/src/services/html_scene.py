"""Convert an uploaded HTML/ZIP template slide into the canonical SlideScene.

Unlike a PPTX shape, arbitrary uploaded HTML has no structured run model to
read — `_ObjectParser` already collapses everything inside an object into one
flat string, because the underlying markup can be anything a browser accepts,
not a format with a run/paragraph object model behind it. So a ZIP object
becomes a single paragraph with a single run carrying the object's own
computed style, rather than the multi-run fidelity the PPTX importer can give.

Geometry stays in the same 1920x1080 canvas space every other importer and the
editor use — not the inches `parse_html_objects` converts to for the older
layout-hint path, which this module does not touch or depend on.
"""

import re
from html import escape

from .html_template import _ObjectParser, _color, _font_name, _pixels, _resolve_variables, _style_values

CANVAS_WIDTH, CANVAS_HEIGHT = 1920, 1080


def _table_cell(text: str) -> dict:
    return {"paragraphs": [{"runs": [{"text": text}], "level": 0, "align": "left"}]}


def _object_dict(item: dict, index: int) -> dict | None:
    style = _resolve_variables(_style_values(item["style"]), dict(item.get("variables", {})))
    left, top, width, height = (_pixels(style.get(key)) for key in ("left", "top", "width", "height"))
    if width <= 0 or height <= 0 or left < 0 or top < 0 or left + width > CANVAS_WIDTH or top + height > CANVAS_HEIGHT:
        return None

    base = {
        # Position in the parsed object list is the only stable identity a ZIP
        # deck (authored outside JaSlide) ever had — the same key the existing
        # HTML text-editing path already uses.
        "id": f"html-{index}",
        "x": round(left), "y": round(top), "width": round(width), "height": round(height),
        "rotation": 0,
        "sourceRef": {
            "kind": "html-node",
            "selector": f'[data-object="true"]:nth-of-type({index + 1})',
            "originalCss": item["style"],
        },
    }

    if item["type"] == "table" and item["rows"]:
        rows = [[" ".join(cell.split()) for cell in row] for row in item["rows"] if row]
        column_count = max((len(row) for row in rows), default=0)
        return {
            **base, "type": "table",
            "rowHeights": [round(height / len(rows))] * len(rows) if rows else [],
            "columnWidths": [round(width / column_count)] * column_count if column_count else [],
            "cells": [[_table_cell(cell) for cell in row] for row in rows],
        }

    text = " ".join(item["text"].split())
    if not text and item["type"] not in ("shape", "image"):
        return None
    if item["type"] in ("shape", "image"):
        return {
            **base, "type": "shape" if item["type"] == "shape" else "image",
            **({"src": ""} if item["type"] == "image" else {
                "shape": "rect",
                "fill": _color(style.get("background", "")) or "#FFFFFF",
                "stroke": _color(style.get("border-color", "")) or "#202124",
                "strokeWidth": 1,
            }),
        }

    run = {
        "text": text,
        "bold": style.get("font-weight", "") in {"500", "600", "700", "bold"},
        "italic": style.get("font-style") == "italic",
        "underline": "underline" in (style.get("text-decoration") or ""),
        "color": _color(style.get("color", "")) or "#1A1A1A",
        "fontSize": round(_pixels(style.get("font-size")) / 2) if style.get("font-size") else None,
        "fontFamily": _font_name(style.get("font-family")) or None,
    }
    align = style.get("text-align")
    return {
        **base, "type": "text",
        "paragraphs": [{
            "runs": [run], "level": 0,
            "align": align if align in ("left", "center", "right", "justify") else "left",
        }],
    }


def _slide_to_scene(html: str) -> dict:
    parser = _ObjectParser()
    parser.feed(html)
    parser.close()
    variables = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", html))
    objects = []
    for index, item in enumerate(parser.objects):
        item["variables"] = variables
        parsed = _object_dict(item, index)
        if parsed:
            objects.append(parsed)
    return {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT, "objects": objects}


def html_to_scene(html_slides: list[str]) -> dict:
    """`{"slides": [SlideScene, ...]}`, one per slide HTML string given."""
    return {"slides": [_slide_to_scene(html) for html in html_slides if isinstance(html, str)]}


def _run_style(run: dict) -> str:
    declarations = []
    if run.get("fontFamily"):
        declarations.append(f"font-family:{run['fontFamily']}")
    if run.get("fontSize"):
        # `_object_dict` reads a run's fontSize back as `_pixels(...) / 2` —
        # the inverse of that halving, so a round trip keeps the same value.
        declarations.append(f"font-size:{run['fontSize'] * 2}px")
    if run.get("color"):
        declarations.append(f"color:{run['color']}")
    if run.get("bold"):
        declarations.append("font-weight:700")
    if run.get("italic"):
        declarations.append("font-style:italic")
    if run.get("underline"):
        declarations.append("text-decoration:underline")
    return ";".join(declarations)


def _paragraph_html(paragraph: dict) -> str:
    runs_html = "".join(
        f'<span style="{escape(_run_style(run), quote=True)}">{escape(run.get("text", ""))}</span>'
        for run in paragraph.get("runs", [])
    )
    align = paragraph.get("align")
    style = f' style="text-align:{align}"' if align and align != "left" else ""
    return f"<div{style}>{runs_html}</div>"


def _text_html(object_: dict) -> str:
    return "".join(_paragraph_html(paragraph) for paragraph in object_["paragraphs"])


def _table_html(object_: dict) -> str:
    rows_html = []
    for row in object_["cells"]:
        cells_html = []
        for cell in row:
            content = "".join(_paragraph_html(paragraph) for paragraph in cell["paragraphs"])
            style = f' style="background:{cell["fill"]}"' if cell.get("fill") else ""
            cells_html.append(f"<td{style}>{content}</td>")
        rows_html.append(f"<tr>{''.join(cells_html)}</tr>")
    return f"<table>{''.join(rows_html)}</table>"


def _object_style(object_: dict) -> str:
    declarations = [
        "position:absolute",
        f"left:{object_['x']}px", f"top:{object_['y']}px",
        f"width:{object_['width']}px", f"height:{object_['height']}px",
    ]
    if object_.get("rotation"):
        declarations.append(f"transform:rotate({object_['rotation']}deg)")
    return ";".join(declarations)


def _object_html(object_: dict) -> str:
    style = escape(_object_style(object_), quote=True)
    kind = object_["type"]
    if kind == "text":
        return f'<div data-object="true" data-object-type="textbox" style="{style}">{_text_html(object_)}</div>'
    if kind == "table":
        return f'<div data-object="true" data-object-type="table" style="{style}">{_table_html(object_)}</div>'
    if kind == "image":
        src = escape(object_.get("src", ""), quote=True)
        return f'<img data-object="true" data-object-type="image" style="{style}" src="{src}" alt="" />'
    # shape / line — ponytail: HTML export renders any shape as its bounding
    # rect; only the PPTX importer/exporter carries a real preset silhouette.
    # Add an SVG path table here if HTML decks need exact shape glyphs.
    fill = object_.get("fill", "#FFFFFF") if kind == "shape" else "transparent"
    border_width = max(1, round(object_.get("strokeWidth", 1)))
    border = f"border:{border_width}px solid {object_.get('stroke', '#202124')}"
    return f'<div data-object="true" data-object-type="shape" style="{style};background:{fill};{border}"></div>'


def scene_to_html(scene: dict) -> str:
    """Serialize a `SlideScene` back into the `data-object` HTML markup
    `html_to_scene`/`_ObjectParser` read — the mirror of `html_to_scene`."""
    objects_html = "".join(_object_html(object_) for object_ in scene["objects"])
    return (
        '<div class="slide-container" '
        f'style="position:relative;width:{scene["width"]}px;height:{scene["height"]}px;background:#FFFFFF">'
        f"{objects_html}</div>"
    )
