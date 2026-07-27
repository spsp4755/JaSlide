"""Resolve a PPTX theme colour to a concrete hex value.

A real deck almost never states its colours as RGB. It names a slot in the
theme — `schemeClr val="bg1"` — and then adjusts it, so a table header is
"background, at 85% luminance" rather than "#D9D9D9". python-pptx exposes
`.rgb` only for explicit RGB and raises for a theme colour, so reading colours
that way silently dropped every fill, line and font colour in most uploads.
PowerPoint and LibreOffice resolve these against the theme; this does the same.
"""

from lxml import etree
from pptx.oxml.ns import qn

# `bg1`/`tx1` are what a shape names; `lt1`/`dk1` are what the theme defines.
# The slide master carries a `clrMap` that can swap them, but the identity
# mapping below is what every deck seen so far uses, and a wrong colour is far
# better than no colour at all.
_SCHEME_ALIASES = {"bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2"}


def theme_palette(presentation) -> dict[str, str]:
    """Every named colour in the deck's theme, as `#RRGGBB`."""
    for part in presentation.part.package.iter_parts():
        if "theme" not in str(part.partname):
            continue
        try:
            scheme = etree.fromstring(part.blob).find(f".//{qn('a:clrScheme')}")
        except (etree.XMLSyntaxError, ValueError):
            continue
        if scheme is None:
            continue
        palette = {}
        for slot in scheme:
            name = etree.QName(slot).localname
            srgb = slot.find(qn("a:srgbClr"))
            system = slot.find(qn("a:sysClr"))
            if srgb is not None and srgb.get("val"):
                palette[name] = f"#{srgb.get('val').upper()}"
            elif system is not None and system.get("lastClr"):
                palette[name] = f"#{system.get('lastClr').upper()}"
        if palette:
            return palette
    return {}


def _percent(element, tag: str) -> float | None:
    """An OOXML percentage child, as a fraction. They are stored in 1000ths."""
    child = element.find(qn(f"a:{tag}"))
    if child is None or not child.get("val"):
        return None
    try:
        return int(child.get("val")) / 100000
    except ValueError:
        return None


def _to_hsl(red: float, green: float, blue: float) -> tuple[float, float, float]:
    high, low = max(red, green, blue), min(red, green, blue)
    lightness = (high + low) / 2
    if high == low:
        return 0.0, 0.0, lightness
    span = high - low
    saturation = span / (2 - high - low) if lightness > 0.5 else span / (high + low)
    if high == red:
        hue = ((green - blue) / span) % 6
    elif high == green:
        hue = (blue - red) / span + 2
    else:
        hue = (red - green) / span + 4
    return hue / 6, saturation, lightness


def _from_hsl(hue: float, saturation: float, lightness: float) -> tuple[float, float, float]:
    if saturation == 0:
        return lightness, lightness, lightness
    second = lightness * (1 + saturation) if lightness < 0.5 else lightness + saturation - lightness * saturation
    first = 2 * lightness - second

    def channel(offset: float) -> float:
        position = (hue + offset) % 1
        if position < 1 / 6:
            return first + (second - first) * 6 * position
        if position < 1 / 2:
            return second
        if position < 2 / 3:
            return first + (second - first) * (2 / 3 - position) * 6
        return first

    return channel(1 / 3), channel(0), channel(-1 / 3)


def apply_transforms(hex_color: str, element) -> str:
    """Apply an OOXML colour element's lum/tint/shade adjustments."""
    raw = hex_color.lstrip("#")
    if len(raw) != 6:
        return hex_color
    red, green, blue = (int(raw[index:index + 2], 16) / 255 for index in (0, 2, 4))

    shade = _percent(element, "shade")
    if shade is not None:
        red, green, blue = (channel * shade for channel in (red, green, blue))
    tint = _percent(element, "tint")
    if tint is not None:
        red, green, blue = (channel * tint + (1 - tint) for channel in (red, green, blue))

    lum_mod, lum_off = _percent(element, "lumMod"), _percent(element, "lumOff")
    if lum_mod is not None or lum_off is not None:
        hue, saturation, lightness = _to_hsl(red, green, blue)
        if lum_mod is not None:
            lightness *= lum_mod
        if lum_off is not None:
            lightness += lum_off
        red, green, blue = _from_hsl(hue, saturation, min(1.0, max(0.0, lightness)))

    return "#" + "".join(f"{round(min(1.0, max(0.0, channel)) * 255):02X}" for channel in (red, green, blue))


def resolve_color_element(element, palette: dict[str, str]) -> str | None:
    """A hex value for an `a:srgbClr` or `a:schemeClr` node, transforms included."""
    if element is None:
        return None
    tag = etree.QName(element).localname
    if tag == "srgbClr":
        value = element.get("val")
        return apply_transforms(f"#{value.upper()}", element) if value else None
    if tag == "schemeClr":
        name = element.get("val")
        base = palette.get(_SCHEME_ALIASES.get(name, name)) if name else None
        return apply_transforms(base, element) if base else None
    return None


def solid_fill_color(x_pr, palette: dict[str, str]) -> str | None:
    """The colour of a `a:solidFill` under a shape's, cell's or run's properties."""
    if x_pr is None:
        return None
    solid = x_pr.find(qn("a:solidFill"))
    if solid is None:
        return None
    for child in solid:
        resolved = resolve_color_element(child, palette)
        if resolved:
            return resolved
    return None
