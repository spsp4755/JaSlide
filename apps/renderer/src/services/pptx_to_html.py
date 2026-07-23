"""Loss-minimizing PPTX-to-HTML conversion for template rendering."""

import base64
from html import escape
from io import BytesIO

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn

from .style_extractor import extract_template_tokens


CANVAS_WIDTH, CANVAS_HEIGHT = 1920, 1080


def _color(fill) -> str | None:
    try:
        value = fill.fore_color.rgb
        return f"#{value}" if value else None
    except (AttributeError, TypeError):
        return None


def _font_color(color) -> str | None:
    try:
        value = color.rgb
        return f"#{value}" if value else None
    except (AttributeError, TypeError):
        return None


def _font_name(run) -> str | None:
    properties = run._r.rPr
    east_asian = properties.find(qn("a:ea")) if properties is not None else None
    return east_asian.get("typeface") if east_asian is not None else run.font.name


def _line_style(shape) -> str:
    try:
        if not shape.line.width:
            return ""
        color = _color(shape.line) or "#202124"
        width = max(1, round(shape.line.width / 12700))
        return f"border:{width}px solid {color}"
    except (AttributeError, TypeError):
        return ""


def _text_html(source) -> tuple[str, int, str | None]:
    paragraphs = []
    size = 18
    color = None
    for paragraph in source.text_frame.paragraphs:
        runs = []
        for run in paragraph.runs:
            run_size = round(run.font.size.pt) if run.font.size else size
            run_color = _font_color(run.font.color) or color or "#1A1A1A"
            font_name = _font_name(run)
            size = max(size, run_size)
            color = color or run_color
            weight = "font-weight:700;" if run.font.bold else ""
            italic = "font-style:italic;" if run.font.italic else ""
            underline = "text-decoration:underline;" if run.font.underline else ""
            family = f'font-family:{escape(font_name, quote=True)};' if font_name else ""
            runs.append(f'<span style="font-size:{run_size}px;color:{run_color};{family}{weight}{italic}{underline}">{escape(run.text)}</span>')
        paragraphs.append("".join(runs) or escape(paragraph.text))
    return "<br>".join(paragraphs), size, color


def _table_html(shape) -> str:
    widths = [column.width for column in shape.table.columns]
    total_width = sum(widths) or 1
    rows = []
    for row in shape.table.rows:
        cells = []
        for index, cell in enumerate(row.cells):
            text, size, color = _text_html(cell)
            fill = _color(cell.fill)
            width = round(widths[index] / total_width * 100, 1)
            surface = f"background:{fill};" if fill else ""
            cells.append(
                f'<td style="width:{width}%;height:{row.height / 12700:.1f}px;box-sizing:border-box;'
                f'border:1px solid #D1D5DB;padding:8px;vertical-align:middle;{surface}'
                f'font-size:{size}px;color:{color or "#1A1A1A"}">{text}</td>'
            )
        rows.append(f"<tr>{''.join(cells)}</tr>")
    return '<table style="width:100%;height:100%;border-collapse:collapse">' + "".join(rows) + "</table>"


def _px(value, total, canvas) -> int:
    return round(value / total * canvas)


def pptx_to_html(content: bytes) -> dict:
    presentation = Presentation(BytesIO(content))
    tokens = extract_template_tokens(content)
    html_slides = []
    source_slides = []
    for slide in presentation.slides:
        background = _color(slide.background.fill) or "#FFFFFF"
        objects = []
        source_objects = []
        for shape in slide.shapes:
            left = _px(shape.left, presentation.slide_width, CANVAS_WIDTH)
            top = _px(shape.top, presentation.slide_height, CANVAS_HEIGHT)
            width = _px(shape.width, presentation.slide_width, CANVAS_WIDTH)
            height = _px(shape.height, presentation.slide_height, CANVAS_HEIGHT)
            position = f"position:absolute;left:{left}px;top:{top}px;width:{width}px;height:{height}px"
            source_object = {"id": str(shape.shape_id), "left": left, "top": top, "width": width, "height": height}
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                source_objects.append({**source_object, "kind": "image"})
                image = shape.image
                encoded = base64.b64encode(image.blob).decode("ascii")
                objects.append(f'<img data-object="true" data-object-type="image" src="data:{image.content_type};base64,{encoded}" style="{position}">')
            elif getattr(shape, "has_table", False):
                source_objects.append({**source_object, "kind": "table", "cells": [[cell.text for cell in row.cells] for row in shape.table.rows]})
                objects.append(f'<div data-object="true" data-object-type="table" style="{position};box-sizing:border-box;overflow:hidden">{_table_html(shape)}</div>')
            elif getattr(shape, "has_text_frame", False) and shape.text.strip():
                text, font_size, color = _text_html(shape)
                source_objects.append({**source_object, "kind": "text", "text": shape.text})
                fill = _color(getattr(shape, "fill", None))
                surface = f"background:{fill};" if fill else ""
                objects.append(f'<div data-object="true" data-object-type="textbox" style="{position};box-sizing:border-box;overflow:hidden;{surface}{_line_style(shape)};font-size:{font_size}px;color:{color or "#1A1A1A"}">{text}</div>')
            else:
                source_objects.append({**source_object, "kind": "shape"})
                fill = _color(getattr(shape, "fill", None))
                surface = f"background:{fill};" if fill else "background:transparent;"
                objects.append(f'<div data-object="true" data-object-type="shape" style="{position};box-sizing:border-box;{surface}{_line_style(shape)}"></div>')
        html_slides.append(f'<div class="slide-container" style="position:relative;width:{CANVAS_WIDTH}px;height:{CANVAS_HEIGHT}px;overflow:hidden;background:{background}">{"".join(objects)}</div>')
        source_slides.append({"objects": source_objects})
    archive = {"slides": [f"slide-{index:02d}" for index in range(1, len(html_slides) + 1)], "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT}}
    return {**tokens, "htmlSlides": html_slides, "htmlTemplate": html_slides[0] if html_slides else "", "archive": archive, "source": {"kind": "pptx", "slides": source_slides}}
