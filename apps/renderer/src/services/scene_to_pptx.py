"""Apply a SlideScene back onto a PPTX — the export half of the scene model.

Deliberately a thin adapter rather than a second PPTX writer: it turns each
scene object into the same `objectEdits` shape `PPTXGenerator._apply_native_edit`
already applies (run-level text formatting, rich table cells, shape fill/line,
rotation, brand-new shapes/lines/text/tables/images), and hands the result to
that already-tested machinery. Re-deriving pixel/EMU math, run writing and
z-order handling a second time would risk every subtlety that code has already
had fixed at least once.
"""

from types import SimpleNamespace

from ..generators.pptx_generator import PPTXGenerator


def _paragraph_edit(paragraph: dict) -> dict:
    """A scene TextParagraph, in the shape the paragraphs edit branch expects."""
    edit: dict = {"runs": [dict(run) for run in paragraph.get("runs", [])]}
    if isinstance(paragraph.get("level"), int):
        edit["level"] = paragraph["level"]
    if isinstance(paragraph.get("align"), str):
        edit["align"] = paragraph["align"]
    # ponytail: bulleted has no PPTX bullet-XML writer yet. The paragraph still
    # exports with its text, run formatting, level and alignment intact — only
    # the bullet glyph itself does not reach the file. Add a writer once a
    # deck's own bullet character/indent needs to round-trip exactly.
    return edit


def _cell_edit(cell: dict) -> dict:
    # A merged-away cell has no independent text frame in the PPTX. Rewriting it
    # can corrupt the merge, so only its origin is exported.
    if cell.get("spanned"):
        return {"spanned": True}
    return {"paragraphs": [_paragraph_edit(paragraph) for paragraph in cell.get("paragraphs", [])]}


def _existing_object_edit(object_: dict) -> dict:
    """An edit for an object that already has a shape in the source file."""
    edit: dict = {
        "objectId": object_["sourceRef"]["shapeId"],
        "left": object_["x"], "top": object_["y"],
        "width": object_["width"], "height": object_["height"],
        "rotation": object_.get("rotation") or 0,
    }
    kind = object_["type"]
    if kind == "text":
        edit["paragraphs"] = [_paragraph_edit(paragraph) for paragraph in object_["paragraphs"]]
    elif kind == "table":
        edit["cells"] = [[_cell_edit(cell) for cell in row] for row in object_["cells"]]
    elif kind == "shape":
        edit["fillColor"] = object_["fill"]
        edit["lineColor"] = object_["stroke"]
        edit["lineWidth"] = object_["strokeWidth"]
    elif kind == "line":
        edit["lineColor"] = object_["stroke"]
        edit["lineWidth"] = object_["strokeWidth"]
    return edit


def _inserted_object_edit(object_: dict, index: int) -> dict:
    """An edit for an object the user added in the editor, with no PPTX shape
    of its own yet — the same `addShape`/`addLine`/`addText`/`addTable`/
    `imageData` conventions the insert-from-scratch toolbar already uses."""
    edit: dict = {
        "objectId": f"scene-new-{index}",
        "left": object_["x"], "top": object_["y"],
        "width": object_["width"], "height": object_["height"],
        "rotation": object_.get("rotation") or 0,
    }
    kind = object_["type"]
    if kind == "text":
        paragraphs = object_["paragraphs"]
        first_text = paragraphs[0]["runs"][0]["text"] if paragraphs and paragraphs[0].get("runs") else ""
        edit["addText"] = first_text or " "
        edit["paragraphs"] = [_paragraph_edit(paragraph) for paragraph in paragraphs]
    elif kind == "table":
        edit["addTable"] = {"rows": len(object_["cells"]), "columns": len(object_["columnWidths"])}
        edit["cells"] = [[_cell_edit(cell) for cell in row] for row in object_["cells"]]
    elif kind == "shape":
        edit["addShape"] = object_["shape"]
        edit["fillColor"] = object_["fill"]
        edit["lineColor"] = object_["stroke"]
        edit["lineWidth"] = object_["strokeWidth"]
    elif kind == "line":
        edit["addLine"] = object_["lineStyle"]
        edit["lineColor"] = object_["stroke"]
        edit["lineWidth"] = object_["strokeWidth"]
    elif kind == "image" and object_.get("src"):
        edit["imageData"] = object_["src"]
    return edit


def scene_to_edits(scene: dict) -> list[dict]:
    """Every scene object turned into one `objectEdits` entry."""
    edits = []
    for index, object_ in enumerate(scene["objects"]):
        source_ref = object_.get("sourceRef")
        if source_ref and source_ref.get("kind") == "pptx-shape":
            edits.append(_existing_object_edit(object_))
        else:
            edits.append(_inserted_object_edit(object_, index))
    return edits


def scene_to_pptx(scene: dict, source_pptx: bytes) -> bytes:
    """Apply `scene` onto `source_pptx` and return the resulting PPTX bytes."""
    import base64

    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(source_pptx).decode("ascii")))
    slide = SimpleNamespace(type="CONTENT", title="", content={"objectEdits": scene_to_edits(scene)})
    presentation = SimpleNamespace(slides=[slide])
    return PPTXGenerator(template).generate(presentation)
