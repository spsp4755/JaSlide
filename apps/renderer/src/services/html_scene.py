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
