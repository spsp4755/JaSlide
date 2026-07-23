"""Loss-minimizing PPTX-to-HTML conversion for template rendering."""

import base64
from html import escape
from io import BytesIO

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from .style_extractor import extract_template_tokens


CANVAS_WIDTH, CANVAS_HEIGHT = 1920, 1080


def _color(fill) -> str | None:
    try:
        value = fill.fore_color.rgb
        return f"#{value}" if value else None
    except (AttributeError, TypeError):
        return None


def _px(value, total, canvas) -> int:
    return round(value / total * canvas)


def pptx_to_html(content: bytes) -> dict:
    presentation = Presentation(BytesIO(content))
    tokens = extract_template_tokens(content)
    html_slides = []
    for slide in presentation.slides:
        background = _color(slide.background.fill) or "#FFFFFF"
        objects = []
        for shape in slide.shapes:
            left = _px(shape.left, presentation.slide_width, CANVAS_WIDTH)
            top = _px(shape.top, presentation.slide_height, CANVAS_HEIGHT)
            width = _px(shape.width, presentation.slide_width, CANVAS_WIDTH)
            height = _px(shape.height, presentation.slide_height, CANVAS_HEIGHT)
            position = f"position:absolute;left:{left}px;top:{top}px;width:{width}px;height:{height}px"
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                image = shape.image
                encoded = base64.b64encode(image.blob).decode("ascii")
                objects.append(f'<img data-object="true" data-object-type="shape" src="data:{image.content_type};base64,{encoded}" style="{position}">')
            elif shape.has_text_frame and shape.text.strip():
                paragraph = shape.text_frame.paragraphs[0]
                run = paragraph.runs[0] if paragraph.runs else None
                font_size = round(run.font.size.pt) if run and run.font.size else 18
                color = _color(run.font.color) if run else None
                objects.append(f'<div data-object="true" data-object-type="textbox" style="{position};font-size:{font_size}px;color:{color or "#1A1A1A"}">{escape(shape.text).replace(chr(10), "<br>")}</div>')
            else:
                fill = _color(shape.fill)
                if fill:
                    objects.append(f'<div data-object="true" data-object-type="shape" style="{position};background:{fill}"></div>')
        html_slides.append(f'<div class="slide-container" style="position:relative;width:{CANVAS_WIDTH}px;height:{CANVAS_HEIGHT}px;overflow:hidden;background:{background}">{"".join(objects)}</div>')
    archive = {"slides": [f"slide-{index:02d}" for index in range(1, len(html_slides) + 1)], "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT}}
    return {**tokens, "htmlSlides": html_slides, "htmlTemplate": html_slides[0] if html_slides else "", "archive": archive}
