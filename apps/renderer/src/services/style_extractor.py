"""Extract reusable visual tokens from a PPTX without retaining its content."""

from collections import Counter
from io import BytesIO

from pptx import Presentation
from pptx.oxml.ns import qn


def _solid_color(fill):
    if fill.type is None:
        return None
    try:
        value = str(fill.fore_color.rgb)
    except (AttributeError, TypeError, ValueError):
        return None
    return f"#{value}" if len(value) == 6 else None


def _frequent(values):
    counts = Counter(values)
    return sorted(counts, key=lambda value: (-counts[value], value))


def _font_name(run):
    properties = run._r.rPr
    east_asian = properties.find(qn("a:ea")) if properties is not None else None
    return east_asian.get("typeface") if east_asian is not None else run.font.name


def extract_template_tokens(pptx_bytes: bytes) -> dict:
    """Return deterministic color and font tokens; never expose slide text."""
    presentation = Presentation(BytesIO(pptx_bytes))
    backgrounds, fills, fonts = [], [], []

    for slide in presentation.slides:
        background = _solid_color(slide.background.fill)
        if background:
            backgrounds.append(background)
        for shape in slide.shapes:
            color = _solid_color(shape.fill)
            if color:
                fills.append(color)
            if shape.has_text_frame:
                for paragraph in shape.text_frame.paragraphs:
                    for run in paragraph.runs:
                        font = _font_name(run)
                        if font:
                            fonts.append(font)

    colors = {}
    background = _frequent(backgrounds)
    if background:
        colors["background"] = background[0]
    palette = [color for color in _frequent(fills) if color != colors.get("background")]
    for key, color in zip(("primary", "secondary", "accent"), palette):
        colors[key] = color

    typography = {}
    font = _frequent(fonts)
    if font:
        typography = {"titleFont": font[0], "bodyFont": font[0]}
    return {"colors": colors, "typography": typography}
