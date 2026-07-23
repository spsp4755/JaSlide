# PPTX and HTML Template Pipeline Design

Date: 2026-07-24
Status: Approved for planning

## Goal

Generate template-faithful decks from both uploaded PPTX and HTML ZIP files, and
let users edit generated slides in TaeSlide and in exported Microsoft PowerPoint.
The deployment remains fully offline.

## Source of Truth

| Template input | Canonical source | Browser preview | PPTX export |
| --- | --- | --- | --- |
| HTML ZIP | Per-slide HTML/CSS/assets | Render the DOM directly | Convert the common object model to editable PPTX shapes |
| PPTX | Original uploaded PPTX plus a stable object map | Render a derived editable canvas | Copy the original deck and edit its mapped objects with `python-pptx` |

Never convert PPTX to HTML and then use that HTML as the export source. The
conversion remains useful for previews, but it must not discard tables, masters,
fonts, charts, or native shape properties before export.

## Common Object Model

Every slide stores an ordered list of editable objects with stable IDs:

- Text: content, font family, size, weight, style, colour, alignment and bounds.
- Table: row/column structure, cell text, fill, borders and bounds.
- Shape/line: type, fill, line style, rotation and bounds.
- Image: asset reference, crop and bounds.
- Chart: chart type, series/categories and bounds.

The editor updates this model immediately. The template adapter applies the same
operation to either a DOM node (HTML ZIP) or a mapped native PPTX object (PPTX).
Unsupported PPTX objects are preserved untouched and surfaced as read-only rather
than silently flattened or removed.

## Generation

1. Import records `templateKind` (`html_zip` or `pptx`) and saves the canonical
   source plus a per-slide object map.
2. Outline selection chooses template slide IDs, not only positional indexes.
3. AI returns structured content operations against named text/table/chart slots;
   it never rewrites a complete PPTX slide or table DOM.
4. The relevant adapter applies those operations while preserving template layout,
   typography, masters, shapes and table frames.
5. If a requested object cannot fit a selected template slide, generation selects
   another compatible source slide or reports the limitation before export.

## Editing and Export

The web editor uses the existing selection, drag/resize, toolbar and AI chat to
emit object operations. Both manual and AI edits update the shared object model.
For PPTX templates, export starts from the uploaded deck and `python-pptx` edits
only mapped objects; therefore the resulting file stays editable in PowerPoint.
For HTML ZIP templates, export creates editable PowerPoint shapes from the common
object model. PDF and preview rendering remain visual-only outputs.

## Scope and Limits

First release covers text, tables, images, standard shapes/lines and supported
charts. SmartArt, animation, complex connectors, embedded OLE/media and custom
PowerPoint effects are retained when present in PPTX but initially read-only.
All required Python packages, fonts and renderer assets are bundled in the
offline image; no Google or Microsoft API is used.

## Verification

- Import the supplied weekly-report PPTX and assert tables, fonts and slide
  object IDs survive generation and a save/reopen cycle.
- Import the supplied HTML ZIP and assert DOM geometry survives generation,
  editing and export.
- Reopen each exported PPTX with `python-pptx` and verify editable native text,
  table and shape objects are present rather than full-slide images.
- Run editor interaction tests for direct text edits, table-cell edits,
  drag/resize, formatting, insert and delete.
