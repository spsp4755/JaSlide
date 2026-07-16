"""Safe parser for administrator-provided HTML slide layout metadata."""

from html.parser import HTMLParser
import math


SLIDE_WIDTH = 13.333
SLIDE_HEIGHT = 7.5
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
