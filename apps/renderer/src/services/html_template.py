"""Safe parser for administrator-provided HTML slide layout metadata."""

from html.parser import HTMLParser
import math
import re


SLIDE_WIDTH = 13.333
SLIDE_HEIGHT = 7.5
CANVAS_HEIGHT = 1080
# Lengths in this markup are px on a 1920x1080 canvas covering a 7.5in-tall slide, so
# the canvas holds 144px per inch and a point is two px. python-pptx wants points.
# This was 0.54, which is close enough to look right and wrong enough that a deck did
# not survive the round trip out of pptx_to_html and back at its own size.
PX_TO_PT = SLIDE_HEIGHT * 72 / CANVAS_HEIGHT
SLOTS = {"title", "subtitle", "body", "bullets"}
ALIGNMENTS = {"left", "center", "right"}


class _LayoutParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.layout: dict[str, dict] = {}

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        slot = values.get("data-jaslide-slot")
        if slot not in SLOTS or slot in self.layout:
            return

        try:
            x, y, width, height = (
                float(values[name])
                for name in ("data-x", "data-y", "data-w", "data-h")
            )
        except (KeyError, TypeError, ValueError):
            return

        if (
            not all(math.isfinite(value) for value in (x, y, width, height))
            or x < 0
            or y < 0
            or width <= 0
            or height <= 0
            or x + width > SLIDE_WIDTH
            or y + height > SLIDE_HEIGHT
        ):
            return

        item = {"x": x, "y": y, "w": width, "h": height}
        try:
            font_size = int(values.get("data-font-size", ""))
            item["fontSize"] = max(8, min(font_size, 72))
        except (TypeError, ValueError):
            pass
        if values.get("data-align") in ALIGNMENTS:
            item["align"] = values["data-align"]
        self.layout[slot] = item


def parse_html_layout(template: str) -> dict[str, dict]:
    """Return recognized layout slots from an HTML template without executing it."""
    if not isinstance(template, str):
        return {}
    parser = _LayoutParser()
    parser.feed(template)
    parser.close()
    return parser.layout


class _StyleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items: list[dict[str, str]] = []

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("style"):
            self.items.append(values)


# Tags that close themselves, so they never add a level of nesting.
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Tags that render on their own line, so their text must not run into the next one's.
_BLOCK_TAGS = {"div", "p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "header", "footer", "figcaption"}


class _ObjectParser(HTMLParser):
    """Collect `data-object` elements, their text, and any table grid inside them."""

    def __init__(self):
        super().__init__()
        self.objects: list[dict] = []
        self.current: dict | None = None
        # An object's own tag can nest inside itself — arbitrary HTML is full of
        # <div><div></div></div>. Counting depth stops the first inner </div> from
        # ending the object and swallowing the rest of the slide.
        self.depth = 0
        self.cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if self.current is None:
            if values.get("data-object") != "true" or not values.get("style"):
                return
            self.current = {
                "tag": tag, "type": values.get("data-object-type"),
                "style": values["style"], "text": "", "rows": [],
            }
            self.depth = 0 if tag in _VOID_TAGS else 1
            return
        if tag == self.current["tag"] and tag not in _VOID_TAGS:
            self.depth += 1
        if tag == "tr":
            self.current["rows"].append([])
        elif tag in ("td", "th"):
            if not self.current["rows"]:
                self.current["rows"].append([])
            self.cell = self.current["rows"][-1]
            self.cell.append("")

    def handle_data(self, data: str) -> None:
        if self.current is None:
            return
        self.current["text"] += data
        if self.cell:
            self.cell[-1] += data

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return
        if tag in ("td", "th"):
            self.cell = None
        if tag in _BLOCK_TAGS:
            # "<div>앞</div><div>뒤</div>" reads as two lines, not the word "앞뒤".
            self.current["text"] += " "
        if tag != self.current["tag"] or tag in _VOID_TAGS:
            return
        self.depth -= 1
        if self.depth <= 0:
            self.objects.append(self.current)
            self.current = None
            self.cell = None


def parse_html_objects(template: str) -> list[dict]:
    """Read absolute HTML deck objects into safe slide coordinates."""
    if not isinstance(template, str):
        return []
    parser = _ObjectParser()
    parser.feed(template)
    parser.close()
    variables = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", template))
    objects = []
    for item in parser.objects:
        style = _resolve_variables(_style_values(item["style"]), variables)
        left, top, width, height = (_pixels(style.get(key)) for key in ("left", "top", "width", "height"))
        if width <= 0 or height <= 0 or left < 0 or top < 0 or left + width > 1920 or top + height > 1080:
            continue
        objects.append({
            "type": item["type"], "text": " ".join(item["text"].split()),
            "cells": [[" ".join(cell.split()) for cell in row] for row in item["rows"] if row],
            "x": left / 1920 * SLIDE_WIDTH, "y": top / 1080 * SLIDE_HEIGHT,
            "w": width / 1920 * SLIDE_WIDTH, "h": height / 1080 * SLIDE_HEIGHT,
            "background": _color(style.get("background", "")), "color": _color(style.get("color", "")),
            "font": _font_name(style.get("font-family", "")), "fontSize": max(8, min(round(_pixels(style.get("font-size")) * PX_TO_PT), 72)),
            "bold": style.get("font-weight", "") in {"500", "600", "700", "bold"},
            "align": style.get("text-align") if style.get("text-align") in ALIGNMENTS else "left",
        })
    return objects


def extract_html_template_style(template: str) -> tuple[dict[str, str], dict[str, dict]]:
    """Extract safe visual tokens from an HTML deck.

    Decks authored with JaSlide's own data-object markup get precise
    title/body font and layout detection. Real-world uploads (Genspark
    exports, arbitrary CSS-class decks) rarely carry those markers, so
    color and font tokens also fall back to any inline-styled element
    and to raw `<style>` block declarations, instead of yielding nothing.
    """
    if not isinstance(template, str):
        return {}, {}
    parser = _StyleParser()
    parser.feed(template)
    parser.close()
    variables = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", template))
    styles = [_resolve_variables(_style_values(item["style"]), variables) for item in parser.items]

    def _first_color(prop: str) -> str | None:
        found = next((_color(style.get(prop, "")) for style in styles if _color(style.get(prop, ""))), None)
        if found:
            return found
        # No inline-styled element carries it — scan raw CSS text (e.g. a <style> block rule).
        match = re.search(rf"{prop}\s*:\s*(#[0-9a-fA-F]{{6}})", template)
        return match.group(1).upper() if match else None

    background = _first_color("background") or _first_color("background-color")
    text = _first_color("color")

    marked_textboxes = [(item, style) for item, style in zip(parser.items, styles) if item.get("data-object-type") == "textbox"]
    # Fall back to any inline-styled element carrying a font-size when nothing is marked.
    sized_elements = [(item, style) for item, style in zip(parser.items, styles) if _pixels(style.get("font-size"))]
    textboxes = marked_textboxes or sized_elements
    title = max(textboxes, key=lambda item: _pixels(item[1].get("font-size")), default=None)

    tokens = {key: value for key, value in {"background": background, "text": text}.items() if value}
    if title:
        font = _font_name(title[1].get("font-family"))
        if font:
            tokens["titleFont"] = font
    body = next((item for item in textboxes if item != title), None)
    if body:
        font = _font_name(body[1].get("font-family"))
        if font:
            tokens["bodyFont"] = font

    # Only apply precise absolute-position layout slots for markup that JaSlide itself annotated;
    # unmarked decks' "sized_elements" fallback is for color/font tokens only, not layout math.
    layout = {}
    if marked_textboxes:
        title_layout = _textbox_layout(title[1]) if title else None
        if title_layout:
            layout["title"] = title_layout
        body_layout = _textbox_layout(body[1]) if body else None
        if body_layout:
            layout["body"] = body_layout
    return tokens, layout


def _style_values(value: str) -> dict[str, str]:
    return {key.strip().lower(): item.strip() for key, item in re.findall(r"([\w-]+)\s*:\s*([^;]+)", value)}


def _resolve_variables(style: dict[str, str], variables: dict[str, str]) -> dict[str, str]:
    return {
        key: re.sub(r"var\((--[\w-]+)\)", lambda match: variables.get(match.group(1), match.group(0)), value)
        for key, value in style.items()
    }


def _color(value: str) -> str | None:
    match = re.search(r"#[0-9a-fA-F]{6}\b", value)
    return match.group(0).upper() if match else None


def _font_name(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    return value.split(",", 1)[0].strip().strip("'\"") or None


def _pixels(value: str | None) -> float:
    match = re.match(r"\s*([\d.]+)px", value or "")
    return float(match.group(1)) if match else 0


def _textbox_layout(style: dict[str, str]) -> dict | None:
    left, top, width = (_pixels(style.get(key)) for key in ("left", "top", "width"))
    if width <= 0:
        return None
    height = _pixels(style.get("height")) or max(_pixels(style.get("font-size")) * 1.5, 48)
    x, y, w, h = left / 1920 * SLIDE_WIDTH, top / 1080 * SLIDE_HEIGHT, width / 1920 * SLIDE_WIDTH, height / 1080 * SLIDE_HEIGHT
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > SLIDE_WIDTH or y + h > SLIDE_HEIGHT:
        return None
    return {"x": x, "y": y, "w": w, "h": h, "fontSize": max(8, min(round(_pixels(style.get("font-size")) * PX_TO_PT), 72))}
