# PPTX template and Korean font MVP

## Goal

Make generated PPTX files use a reusable visual template and a Korean-safe default font instead of the renderer's hard-coded unstyled shapes.

## Scope

`TemplateConfig` gains a small, explicit token set: primary/background/text colors and heading/body font families and sizes. The renderer resolves missing values to one default: white background, dark text, blue primary, and `Noto Sans KR` for all Korean-capable text.

Every created slide receives the configured background; every title, subtitle, body, bullet, and quote run receives the configured font family and color. Existing slide-type geometry remains unchanged in this slice. This gives deterministic PPTX output without adding an HTML-to-PPTX dependency.

## Validation

Template color values are accepted only as six-digit RGB hex strings. Invalid values fall back to defaults. Tests open the generated PPTX with `python-pptx` and assert background color, font family, and title/body sizes. A Korean-content fixture proves the font is assigned to Korean text runs.

## Follow-up

The next visual slice converts template tokens into HTML/CSS previews and renders them to PDF for overflow inspection. Example-PPT style extraction will populate the same tokens, so this model remains the shared template contract.
