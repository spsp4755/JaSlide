# Template Fidelity Verification

When a PPTX template is imported (or re-extracted), the admin can check how faithfully
the editable reconstruction will reproduce the original file — **before** anyone edits
or exports it.

## How to check it

Admin → 템플릿 관리 → a PPTX-backed template card → **재현 품질 확인** (fidelity check
button, PPTX templates only). This calls:

```
GET /admin/templates/:id/fidelity
```

which proxies the template's stored PPTX to the renderer's `POST /api/extract/fidelity`
(`apps/renderer/src/services/template_fidelity.py`) and returns:

```json
{
  "degradedObjects": [{ "objectId": "7", "type": "line", "reason": "..." }],
  "missingFontFamilies": ["HY헤드라인M"]
}
```

The check runs on demand, not on every page load — it parses the whole PPTX, so it isn't
worth doing for templates nobody is currently looking at.

## What it actually checks

- **Unrecognized shape outlines** — the editor round-trips a shape via its
  `prstGeom`/`prst` preset name (`_preset_geometry` in `pptx_scene.py`). If a shape has no
  such preset, it will render as a plain rectangle, not its real silhouette.
- **Connectors/lines** — `pptx_scene.py` does not yet read arrow direction
  (`headEnd`/`tailEnd`) off the XML, so every connector comes back as an undecorated
  straight line. Every connector shape is flagged for this reason.
- **Fonts** — every font family used in a text run or table cell is compared against
  what `fc-list` reports as installed on the renderer. A font the deck names but the
  server doesn't have will silently fall back to something else in the browser and in
  LibreOffice-based exports.

## What it does NOT check

- **No pixel or visual diffing.** This is a structural/metadata check, not a rendered
  comparison. It cannot tell you a color is subtly off or that spacing shifted a few
  pixels.
- **No table row/column structural edits** (add/delete/merge) — out of scope for the
  editor itself, so not reported here either.
- **No PPTX bullet-glyph fidelity** — bullets are represented in the editable scene but
  not yet written back into PPTX list-formatting XML on export.

Treat a clean report as "nothing *known* will degrade," not as a guarantee of pixel-perfect
reproduction.
