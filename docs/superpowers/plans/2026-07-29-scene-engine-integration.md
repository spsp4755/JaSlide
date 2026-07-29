# Scene 엔진을 실제 편집기에 연결하기 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-07-29-scene-engine-integration-design.md`에서 승인된 설계대로, 독립적으로만 존재하던 `SlideScene`/`scene-canvas.tsx`를 실제 서비스 중인 편집기(`apps/web/src/app/editor/[id]/page.tsx`)에 연결한다. PPTX 소스 덱과 HTML ZIP 소스 덱 모두 대상이다.

**Architecture:** DB 저장 포맷(`content.html` / `content.objectEdits`)은 바꾸지 않는다. `SlideScene`은 편집기가 뜨는 동안만 존재하는 뷰이며, 저장 시점에 다시 legacy 포맷으로 변환된다. PPTX는 기존 `scene_to_edits`(이미 있음)를 그대로 쓰고, 그 반대 방향(legacy edits → scene)만 새로 만든다. HTML ZIP은 `html_to_scene`(이미 있음)을 그대로 읽기에 쓰고, `scene_to_html`(신규)만 쓰기에 추가한다.

스펙 문서는 `scene-commands.ts`의 `CommandStack`을 드래그 중 미리보기용으로 언급하지만, 실제로 읽어보니 `scene-canvas.tsx`는 그 스택을 전혀 쓰지 않는다 — `onCommand`로 원시 `SceneCommand`를 매 포인터 이동마다 올려보낼 뿐이다. 그래서 이 계획은 `CommandStack`을 쓰지 않는다: `EditorPage`가 `applySceneCommand`로 로컬 `scene` state를 갱신하고 기존 디바운스 저장 패턴을 그대로 재사용한다(Task 5). 슬라이드 단위 undo/redo는 기존 `useEditorStore` 그대로.

**Tech Stack:** FastAPI/python-pptx (renderer), NestJS/Prisma (api), Next.js/React (web).

## Global Constraints

- DB 스키마, `export.service.ts`, `PPTXGenerator` — 무변경.
- 표 행/열 삽입·삭제·병합, 실시간 협업 — 범위 밖 (기존 계획에서도 명시).
- 기존 저장된 프레젠테이션의 일괄 마이그레이션 없음 — legacy 포맷이 계속 저장 원본.
- 매 작업은 테스트, 실제 브라우저 확인(웹 작업의 경우), 독립 커밋으로 끝낸다.

---

### Task 1: PPTX legacy edits → SlideScene (렌더러)

**Files:**
- Modify: `apps/renderer/src/services/pptx_scene.py`
- Test: `apps/renderer/tests/test_pptx_scene.py`

**Interfaces:**
- Consumes: `pptx_to_scene(content: bytes) -> dict` (이미 있음, `apps/renderer/src/services/pptx_scene.py`), 그 `dict["slides"][i]`가 `{"width", "height", "objects": [...]}` 모양의 `SlideScene`.
- Produces: `apply_edits_to_scene(base_scene: dict, edits: list[dict]) -> dict` — Task 3에서 렌더러 엔드포인트가 호출.

- [ ] **Step 1: 실패 테스트 작성**

`apps/renderer/tests/test_pptx_scene.py` 맨 아래에 추가:

```python
from apps.renderer.src.services.pptx_scene import apply_edits_to_scene, pptx_to_scene


def test_apply_edits_to_scene_moves_an_existing_object():
    def build(slide):
        slide.shapes.add_textbox(Inches(1), Inches(1), Inches(2), Inches(1)).text_frame.paragraphs[0].add_run().text = "x"

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]
    shape_id = scene["objects"][0]["id"]

    edited = apply_edits_to_scene(scene, [{"objectId": shape_id, "left": 300, "top": 300, "width": 200, "height": 50}])

    assert (edited["objects"][0]["x"], edited["objects"][0]["y"]) == (300, 300)
    assert (edited["objects"][0]["width"], edited["objects"][0]["height"]) == (200, 50)


def test_apply_edits_to_scene_inserts_a_new_shape_with_no_source_shape():
    scene = pptx_to_scene(_deck_bytes(lambda slide: None))["slides"][0]

    edited = apply_edits_to_scene(scene, [{
        "objectId": "new-shape-1", "left": 10, "top": 20, "width": 100, "height": 50,
        "addShape": "roundRect", "fillColor": "#FF0000", "lineColor": "#000000", "lineWidth": 2,
    }])

    assert len(edited["objects"]) == 1
    inserted = edited["objects"][0]
    assert inserted == {
        "id": "new-shape-1", "x": 10, "y": 20, "width": 100, "height": 50, "rotation": 0,
        "type": "shape", "shape": "roundRect", "fill": "#FF0000", "stroke": "#000000", "strokeWidth": 2,
    }


def test_apply_edits_to_scene_deletes_an_object():
    def build(slide):
        slide.shapes.add_textbox(Inches(1), Inches(1), Inches(2), Inches(1)).text_frame.paragraphs[0].add_run().text = "x"

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]
    shape_id = scene["objects"][0]["id"]

    edited = apply_edits_to_scene(scene, [{"objectId": shape_id, "delete": True}])

    assert edited["objects"] == []


def test_apply_edits_to_scene_duplicates_an_existing_object():
    def build(slide):
        shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(1), Inches(1), Inches(2), Inches(1))
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor(0x00, 0xFF, 0x00)

    scene = pptx_to_scene(_deck_bytes(build))["slides"][0]
    original_id = scene["objects"][0]["id"]

    edited = apply_edits_to_scene(scene, [{"objectId": "copy-1", "duplicate": original_id, "left": 500, "top": 500}])

    assert len(edited["objects"]) == 2
    copy = next(item for item in edited["objects"] if item["id"] == "copy-1")
    assert copy["fill"] == "#00FF00"
    assert (copy["x"], copy["y"]) == (500, 500)
    assert "sourceRef" not in copy
```

- [ ] **Step 2: 실패 확인**

Run: `docker compose exec -T renderer python -m pytest tests/test_pptx_scene.py -q`
Expected: 4개 신규 테스트가 `ImportError: cannot import name 'apply_edits_to_scene'`로 실패.

- [ ] **Step 3: `apply_edits_to_scene` 구현**

`apps/renderer/src/services/pptx_scene.py` 맨 위 import에 `import copy`를 추가하고, 파일 끝(`pptx_to_scene` 함수 뒤)에 추가:

```python
def _apply_edit_fields(object_: dict, edit: dict) -> None:
    """An existing scene object's fields, patched from one legacy `objectEdits`
    entry — everything `_apply_native_edit` (pptx_generator.py) reads."""
    for key, target in (("left", "x"), ("top", "y"), ("width", "width"), ("height", "height")):
        if isinstance(edit.get(key), (int, float)):
            object_[target] = edit[key]
    if isinstance(edit.get("rotation"), (int, float)):
        object_["rotation"] = edit["rotation"]
    if object_["type"] == "text" and isinstance(edit.get("paragraphs"), list):
        object_["paragraphs"] = edit["paragraphs"]
    elif object_["type"] == "table" and isinstance(edit.get("cells"), list):
        object_["cells"] = edit["cells"]
    elif object_["type"] in ("shape", "line"):
        if isinstance(edit.get("fillColor"), str):
            object_["fill"] = edit["fillColor"]
        if isinstance(edit.get("lineColor"), str):
            object_["stroke"] = edit["lineColor"]
        if isinstance(edit.get("lineWidth"), (int, float)):
            object_["strokeWidth"] = edit["lineWidth"]


def _new_object_from_edit(object_id: str, edit: dict) -> dict | None:
    """A brand-new scene object for an `objectEdits` entry with no shape of its
    own in the source file yet — the mirror of `_inserted_object_edit` in
    `scene_to_pptx.py`. No `sourceRef`, same as every editor-inserted object."""
    base = {
        "id": object_id,
        "x": edit.get("left", 180), "y": edit.get("top", 180),
        "width": edit.get("width", 640), "height": edit.get("height", 100),
        "rotation": edit.get("rotation", 0),
    }
    if isinstance(edit.get("addText"), str):
        paragraphs = edit.get("paragraphs") or [{
            "runs": [{"text": edit.get("text", edit["addText"])}], "level": 0, "align": "left",
        }]
        return {**base, "type": "text", "paragraphs": paragraphs}
    if isinstance(edit.get("addTable"), dict):
        rows = max(1, int(edit["addTable"].get("rows", 3) or 3))
        columns = max(1, int(edit["addTable"].get("columns", 3) or 3))
        empty_cell = {"paragraphs": [{"runs": [{"text": ""}], "level": 0, "align": "left"}]}
        cells = edit.get("cells") or [[dict(empty_cell) for _ in range(columns)] for _ in range(rows)]
        return {
            **base, "type": "table",
            "rowHeights": [base["height"] / rows] * rows,
            "columnWidths": [base["width"] / columns] * columns,
            "cells": cells,
        }
    if isinstance(edit.get("addShape"), str):
        return {
            **base, "type": "shape", "shape": edit["addShape"],
            "fill": edit.get("fillColor", "#FFFFFF"), "stroke": edit.get("lineColor", "#202124"),
            "strokeWidth": edit.get("lineWidth", 2),
        }
    if isinstance(edit.get("addLine"), str):
        return {
            **base, "type": "line", "lineStyle": edit["addLine"],
            "stroke": edit.get("lineColor", "#202124"), "strokeWidth": edit.get("lineWidth", 2),
        }
    if isinstance(edit.get("imageData"), str):
        return {**base, "type": "image", "src": edit["imageData"]}
    return None


def apply_edits_to_scene(base_scene: dict, edits: list[dict]) -> dict:
    """Replay stored legacy `objectEdits` onto a freshly-imported `SlideScene`,
    producing the "current, already-edited" scene the editor should open
    with. The mirror of `scene_to_edits` in `scene_to_pptx.py` — both key
    objects by the same PPTX shape id, so this only needs pure data
    transforms, never a real PPTX render+reparse round trip."""
    objects = {object_["id"]: dict(object_) for object_ in base_scene["objects"]}
    order = [object_["id"] for object_ in base_scene["objects"]]
    for edit in edits:
        if not isinstance(edit, dict):
            continue
        object_id = edit.get("objectId")
        if not isinstance(object_id, str):
            continue
        if edit.get("delete") is True:
            objects.pop(object_id, None)
            if object_id in order:
                order.remove(object_id)
            continue
        duplicate_of = edit.get("duplicate")
        if isinstance(duplicate_of, str):
            source = objects.get(duplicate_of)
            if source is None:
                continue
            clone = copy.deepcopy(source)
            clone["id"] = object_id
            clone.pop("sourceRef", None)
            objects[object_id] = clone
            order.append(object_id)
            _apply_edit_fields(objects[object_id], edit)
            continue
        if object_id not in objects:
            inserted = _new_object_from_edit(object_id, edit)
            if inserted is not None:
                objects[object_id] = inserted
                order.append(object_id)
            continue
        _apply_edit_fields(objects[object_id], edit)
    return {**base_scene, "objects": [objects[object_id] for object_id in order if object_id in objects]}
```

- [ ] **Step 4: 테스트와 커밋**

Run: `docker compose exec -T renderer python -m pytest tests/test_pptx_scene.py -q`
Expected: 전체 PASS.

```bash
git add apps/renderer/src/services/pptx_scene.py apps/renderer/tests/test_pptx_scene.py
git commit -m "feat(renderer): replay legacy PPTX edits onto an imported scene"
```

---

### Task 2: SlideScene → HTML ZIP markup (렌더러)

**Files:**
- Modify: `apps/renderer/src/services/html_scene.py`
- Test: `apps/renderer/tests/test_html_scene.py`

**Interfaces:**
- Consumes: `SlideScene` dict (`{"width", "height", "objects": [...]}`), the exact shape `html_to_scene` produces and `apply_edits_to_scene`/the web editor also produce.
- Produces: `scene_to_html(scene: dict) -> str` — Task 3의 렌더러 엔드포인트가 호출.

- [ ] **Step 1: 실패 테스트 작성**

`apps/renderer/tests/test_html_scene.py` 맨 아래에 추가:

```python
from apps.renderer.src.services.html_scene import scene_to_html


def test_scene_to_html_round_trips_through_html_to_scene():
    scene = html_to_scene([SLIDE])["slides"][0]

    html = scene_to_html(scene)
    reparsed = html_to_scene([html])["slides"][0]

    assert len(reparsed["objects"]) == len(scene["objects"])
    text = next(item for item in reparsed["objects"] if item["type"] == "text")
    original_text = next(item for item in scene["objects"] if item["type"] == "text")
    assert text["paragraphs"][0]["runs"][0]["text"] == original_text["paragraphs"][0]["runs"][0]["text"]
    assert (text["x"], text["y"], text["width"], text["height"]) == \
        (original_text["x"], original_text["y"], original_text["width"], original_text["height"])


def test_scene_to_html_keeps_bold_and_color_on_the_written_run():
    scene = {
        "width": 1920, "height": 1080,
        "objects": [{
            "id": "obj-1", "x": 10, "y": 20, "width": 300, "height": 60, "rotation": 0,
            "type": "text",
            "paragraphs": [{"runs": [{"text": "Hi", "bold": True, "color": "#FF0000", "fontSize": 24}], "level": 0, "align": "left"}],
        }],
    }

    html = scene_to_html(scene)

    assert "font-weight:700" in html
    assert "color:#FF0000" in html
    assert ">Hi<" in html


def test_scene_to_html_writes_a_table_with_its_cell_text():
    scene = {
        "width": 1920, "height": 1080,
        "objects": [{
            "id": "table-1", "x": 0, "y": 0, "width": 400, "height": 200, "rotation": 0,
            "type": "table", "rowHeights": [200], "columnWidths": [200, 200],
            "cells": [[
                {"paragraphs": [{"runs": [{"text": "A"}], "level": 0, "align": "left"}]},
                {"paragraphs": [{"runs": [{"text": "B"}], "level": 0, "align": "left"}]},
            ]],
        }],
    }

    html = scene_to_html(scene)

    assert "<table>" in html
    assert ">A<" in html and ">B<" in html
```

- [ ] **Step 2: 실패 확인**

Run: `docker compose exec -T renderer python -m pytest tests/test_html_scene.py -q`
Expected: 3개 신규 테스트가 `ImportError: cannot import name 'scene_to_html'`로 실패.

- [ ] **Step 3: `scene_to_html` 구현**

`apps/renderer/src/services/html_scene.py` 맨 위 import에 `from html import escape`를 추가하고, 파일 끝(`html_to_scene` 함수 뒤)에 추가:

```python
def _run_style(run: dict) -> str:
    declarations = []
    if run.get("fontFamily"):
        declarations.append(f"font-family:{run['fontFamily']}")
    if run.get("fontSize"):
        # `_object_dict` reads a run's fontSize back as `_pixels(...) / 2` —
        # the inverse of that halving, so a round trip keeps the same value.
        declarations.append(f"font-size:{run['fontSize'] * 2}px")
    if run.get("color"):
        declarations.append(f"color:{run['color']}")
    if run.get("bold"):
        declarations.append("font-weight:700")
    if run.get("italic"):
        declarations.append("font-style:italic")
    if run.get("underline"):
        declarations.append("text-decoration:underline")
    return ";".join(declarations)


def _paragraph_html(paragraph: dict) -> str:
    runs_html = "".join(
        f'<span style="{escape(_run_style(run), quote=True)}">{escape(run.get("text", ""))}</span>'
        for run in paragraph.get("runs", [])
    )
    align = paragraph.get("align")
    style = f' style="text-align:{align}"' if align and align != "left" else ""
    return f"<div{style}>{runs_html}</div>"


def _table_html(object_: dict) -> str:
    rows_html = []
    for row in object_["cells"]:
        cells_html = []
        for cell in row:
            content = "".join(_paragraph_html(paragraph) for paragraph in cell["paragraphs"])
            style = f' style="background:{cell["fill"]}"' if cell.get("fill") else ""
            cells_html.append(f"<td{style}>{content}</td>")
        rows_html.append(f"<tr>{''.join(cells_html)}</tr>")
    return f"<table>{''.join(rows_html)}</table>"


def _object_style(object_: dict) -> str:
    declarations = [
        "position:absolute",
        f"left:{object_['x']}px", f"top:{object_['y']}px",
        f"width:{object_['width']}px", f"height:{object_['height']}px",
    ]
    if object_.get("rotation"):
        declarations.append(f"transform:rotate({object_['rotation']}deg)")
    return ";".join(declarations)


def _object_html(object_: dict) -> str:
    style = escape(_object_style(object_), quote=True)
    kind = object_["type"]
    if kind == "text":
        return f'<div data-object="true" data-object-type="textbox" style="{style}">{_text_html(object_)}</div>'
    if kind == "table":
        return f'<div data-object="true" data-object-type="table" style="{style}">{_table_html(object_)}</div>'
    if kind == "image":
        src = escape(object_.get("src", ""), quote=True)
        return f'<img data-object="true" data-object-type="image" style="{style}" src="{src}" alt="" />'
    # shape / line — ponytail: HTML export renders any shape as its bounding
    # rect; only the PPTX importer/exporter carries a real preset silhouette.
    # Add an SVG path table here if HTML decks need exact shape glyphs.
    fill = object_.get("fill", "#FFFFFF") if kind == "shape" else "transparent"
    border_width = max(1, round(object_.get("strokeWidth", 1)))
    border = f"border:{border_width}px solid {object_.get('stroke', '#202124')}"
    return f'<div data-object="true" data-object-type="shape" style="{style};background:{fill};{border}"></div>'


def _text_html(object_: dict) -> str:
    return "".join(_paragraph_html(paragraph) for paragraph in object_["paragraphs"])


def scene_to_html(scene: dict) -> str:
    """Serialize a `SlideScene` back into the `data-object` HTML markup
    `html_to_scene`/`_ObjectParser` read — the mirror of `html_to_scene`."""
    objects_html = "".join(_object_html(object_) for object_ in scene["objects"])
    return (
        '<div class="slide-container" '
        f'style="position:relative;width:{scene["width"]}px;height:{scene["height"]}px;background:#FFFFFF">'
        f"{objects_html}</div>"
    )
```

- [ ] **Step 4: 테스트와 커밋**

Run: `docker compose exec -T renderer python -m pytest tests/test_html_scene.py -q`
Expected: 전체 PASS.

```bash
git add apps/renderer/src/services/html_scene.py apps/renderer/tests/test_html_scene.py
git commit -m "feat(renderer): serialize an edited scene back into ZIP-deck HTML"
```

---

### Task 3: 렌더러 HTTP 엔드포인트 4개

**Files:**
- Modify: `apps/renderer/src/main.py`
- Test: `apps/renderer/tests/test_scene_endpoints.py`

**Interfaces:**
- Consumes: Task 1의 `apply_edits_to_scene`, Task 2의 `scene_to_html`, 기존 `pptx_to_scene`/`html_to_scene`(`pptx_scene.py`/`html_scene.py`), 기존 `scene_to_edits`(`scene_to_pptx.py`).
- Produces: `POST /api/scene/pptx/load`, `POST /api/scene/pptx/save`, `POST /api/scene/html/load`, `POST /api/scene/html/save` — Task 4의 NestJS 서비스가 호출.

- [ ] **Step 1: 실패 테스트 작성**

새 파일 `apps/renderer/tests/test_scene_endpoints.py`:

```python
import base64

from fastapi.testclient import TestClient
from pptx import Presentation
from pptx.util import Inches
from io import BytesIO

from apps.renderer.src.main import app

client = TestClient(app)


def _pptx_bytes() -> bytes:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_textbox(Inches(1), Inches(1), Inches(2), Inches(1)).text_frame.paragraphs[0].add_run().text = "x"
    buffer = BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


def test_pptx_scene_load_applies_stored_edits():
    source = base64.b64encode(_pptx_bytes()).decode("ascii")
    response = client.post("/api/scene/pptx/load", json={"sourcePptx": source, "templateIndex": 0, "objectEdits": []})

    assert response.status_code == 200
    scene = response.json()["scene"]
    assert scene["objects"][0]["type"] == "text"


def test_pptx_scene_save_returns_object_edits():
    scene = {
        "width": 1920, "height": 1080,
        "objects": [{
            "id": "shape-1", "x": 0, "y": 0, "width": 100, "height": 50, "rotation": 0,
            "sourceRef": {"kind": "pptx-shape", "shapeId": "shape-1"},
            "type": "shape", "shape": "rect", "fill": "#FFFFFF", "stroke": "#000000", "strokeWidth": 1,
        }],
    }
    response = client.post("/api/scene/pptx/save", json={"scene": scene})

    assert response.status_code == 200
    edits = response.json()["objectEdits"]
    assert edits[0]["objectId"] == "shape-1"


def test_html_scene_load_and_save_round_trip():
    html = (
        '<div class="slide-container" style="position:relative;width:1920px;height:1080px">'
        '<div data-object="true" data-object-type="textbox" '
        'style="position:absolute;left:10px;top:10px;width:200px;height:60px;color:#000000">Hi</div>'
        "</div>"
    )
    load_response = client.post("/api/scene/html/load", json={"html": html})
    assert load_response.status_code == 200
    scene = load_response.json()["scene"]

    save_response = client.post("/api/scene/html/save", json={"scene": scene})
    assert save_response.status_code == 200
    assert ">Hi<" in save_response.json()["html"]
```

- [ ] **Step 2: 실패 확인**

Run: `docker compose exec -T renderer python -m pytest tests/test_scene_endpoints.py -q`
Expected: 4개 모두 404 (라우트 없음)로 실패.

- [ ] **Step 3: 엔드포인트 구현**

`apps/renderer/src/main.py`의 import 섹션에 추가:

```python
import base64
from .services.pptx_scene import pptx_to_scene, apply_edits_to_scene
from .services.html_scene import html_to_scene, scene_to_html
from .services.scene_to_pptx import scene_to_edits
```

`app = FastAPI(...)` 아래, `SlideContent`/`Slide`/`TemplateConfig` 정의부 근처에 요청 모델 추가:

```python
class PptxSceneLoadRequest(BaseModel):
    sourcePptx: str
    templateIndex: int = 0
    objectEdits: List[dict] = []


class PptxSceneSaveRequest(BaseModel):
    scene: dict


class HtmlSceneLoadRequest(BaseModel):
    html: str


class HtmlSceneSaveRequest(BaseModel):
    scene: dict
```

`/api/extract/content` 엔드포인트 뒤에 4개 엔드포인트 추가:

```python
@app.post("/api/scene/pptx/load")
async def scene_pptx_load(request: PptxSceneLoadRequest):
    try:
        content = base64.b64decode(request.sourcePptx)
        slides = pptx_to_scene(content)["slides"]
        base_scene = slides[request.templateIndex]
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid PPTX source or templateIndex") from error
    return {"scene": apply_edits_to_scene(base_scene, request.objectEdits)}


@app.post("/api/scene/pptx/save")
async def scene_pptx_save(request: PptxSceneSaveRequest):
    try:
        return {"objectEdits": scene_to_edits(request.scene)}
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid scene") from error


@app.post("/api/scene/html/load")
async def scene_html_load(request: HtmlSceneLoadRequest):
    scenes = html_to_scene([request.html])["slides"]
    if not scenes:
        raise HTTPException(status_code=400, detail="Invalid slide HTML")
    return {"scene": scenes[0]}


@app.post("/api/scene/html/save")
async def scene_html_save(request: HtmlSceneSaveRequest):
    try:
        return {"html": scene_to_html(request.scene)}
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid scene") from error
```

- [ ] **Step 4: 테스트·회귀·커밋**

Run: `docker compose exec -T renderer python -m pytest tests/test_scene_endpoints.py tests/test_pptx_scene.py tests/test_html_scene.py -q`
Expected: 전체 PASS.

```bash
git add apps/renderer/src/main.py apps/renderer/tests/test_scene_endpoints.py
git commit -m "feat(renderer): serve scene load/save endpoints for both deck kinds"
```

---

### Task 4: NestJS scene GET/PATCH 엔드포인트

**Files:**
- Modify: `apps/api/src/renderer-client.ts`
- Modify: `apps/api/src/modules/slides/slides.service.ts`
- Modify: `apps/api/src/modules/slides/slides.controller.ts`
- Modify: `apps/api/src/modules/slides/dto/slides.dto.ts`
- Modify: `apps/api/src/modules/slides/slides.module.ts`
- Test: `apps/api/src/modules/slides/slides.service.spec.ts` (신규 파일)

**Interfaces:**
- Consumes: Task 3의 렌더러 엔드포인트, 기존 `StorageService.getBuffer(key): Promise<Buffer>` (`apps/api/src/modules/assets/storage.service.ts`).
- Produces: `GET /presentations/:presentationId/slides/:id/scene`, `PATCH /presentations/:presentationId/slides/:id/scene` — Task 5의 웹 클라이언트가 호출.

- [ ] **Step 1: 실패 테스트 작성**

새 파일 `apps/api/src/modules/slides/slides.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { SlidesService } from './slides.service';

jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SlidesService scene', () => {
    const prisma = { slide: { findUnique: jest.fn(), update: jest.fn() } };
    const config = { get: jest.fn().mockReturnValue('http://renderer.internal') };
    const storage = { getBuffer: jest.fn() };
    let service: SlidesService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new SlidesService(prisma as any, config as any, storage as any);
    });

    it('loads a PPTX-sourced slide as a scene via the renderer', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-1',
            content: { objectEdits: [{ objectId: 'shape-1', left: 10 }], templateIndex: 2 },
            presentation: { userId: 'user-1', isPublic: false, template: { config: { source: { kind: 'pptx', storageKey: 'templates/brand.pptx' } } } },
        });
        storage.getBuffer.mockResolvedValue(Buffer.from('pptx-bytes'));
        mockedAxios.post.mockResolvedValue({ data: { scene: { width: 1920, height: 1080, objects: [] } } } as any);

        await expect(service.getScene('slide-1', 'user-1')).resolves.toEqual({ scene: { width: 1920, height: 1080, objects: [] } });

        expect(storage.getBuffer).toHaveBeenCalledWith('templates/brand.pptx');
        expect(mockedAxios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/scene/pptx/load',
            { sourcePptx: Buffer.from('pptx-bytes').toString('base64'), templateIndex: 2, objectEdits: [{ objectId: 'shape-1', left: 10 }] },
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
    });

    it('loads an HTML-ZIP-sourced slide as a scene via the renderer', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-2',
            content: { html: '<div class="slide-container"></div>' },
            presentation: { userId: 'user-1', isPublic: false, template: { config: { htmlSlides: ['<div/>'] } } },
        });
        mockedAxios.post.mockResolvedValue({ data: { scene: { width: 1920, height: 1080, objects: [] } } } as any);

        await expect(service.getScene('slide-2', 'user-1')).resolves.toEqual({ scene: { width: 1920, height: 1080, objects: [] } });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/scene/html/load',
            { html: '<div class="slide-container"></div>' },
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
    });

    it('rejects loading a scene for someone else\'s private slide', async () => {
        prisma.slide.findUnique.mockResolvedValue({ id: 'slide-1', content: {}, presentation: { userId: 'owner', isPublic: false, template: null } });

        await expect(service.getScene('slide-1', 'someone-else')).rejects.toThrow('Access denied');
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('saves an edited scene back onto a PPTX-sourced slide as objectEdits', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-1', content: { objectEdits: [] },
            presentation: { userId: 'user-1', template: { config: { source: { kind: 'pptx' } } } },
        });
        mockedAxios.post.mockResolvedValue({ data: { objectEdits: [{ objectId: 'shape-1', left: 20 }] } } as any);
        prisma.slide.update.mockResolvedValue({ id: 'slide-1' });

        await service.saveScene('slide-1', 'user-1', { width: 1920, height: 1080, objects: [] });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/scene/pptx/save',
            { scene: { width: 1920, height: 1080, objects: [] } },
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
        expect(prisma.slide.update).toHaveBeenCalledWith({
            where: { id: 'slide-1' },
            data: { content: { objectEdits: [{ objectId: 'shape-1', left: 20 }] } },
        });
    });

    it('saves an edited scene back onto an HTML-ZIP-sourced slide as html', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-2', content: { html: '<div/>' },
            presentation: { userId: 'user-1', template: { config: {} } },
        });
        mockedAxios.post.mockResolvedValue({ data: { html: '<div class="slide-container">edited</div>' } } as any);
        prisma.slide.update.mockResolvedValue({ id: 'slide-2' });

        await service.saveScene('slide-2', 'user-1', { width: 1920, height: 1080, objects: [] });

        expect(prisma.slide.update).toHaveBeenCalledWith({
            where: { id: 'slide-2' },
            data: { content: { html: '<div class="slide-container">edited</div>' } },
        });
    });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest slides.service.spec.ts`
Expected: `TS2339: Property 'getScene' does not exist` / `'saveScene' does not exist`로 실패.

- [ ] **Step 3: `postToRenderer`가 JSON 바디도 받도록 확장**

`apps/api/src/renderer-client.ts`에서 시그니처를 바꾼다 (파일 전체를 아래로 교체):

```ts
import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';

const logger = new Logger('RendererClient');

/**
 * POST a body (multipart form or plain JSON) to the renderer and return its
 * JSON body.
 *
 * A renderer that is unreachable, timing out, or erroring is an infrastructure
 * fault, not a bad upload. Every call site used to swallow the cause in a bare
 * `catch {}` and raise the same generic 400, so a renderer that had simply lost
 * its network looked exactly like a corrupt PPTX — undiagnosable from the UI or
 * the logs. Keep the two apart, and always log the underlying reason.
 */
export async function postToRenderer<T>(
    rendererUrl: string,
    path: string,
    body: FormData | Record<string, unknown>,
    options: { timeout: number; rejectedMessage: string },
): Promise<T> {
    try {
        const response = await axios.post(`${rendererUrl}${path}`, body, { timeout: options.timeout });
        return response.data as T;
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const detail = axios.isAxiosError(error) ? error.response?.data?.detail : undefined;
        logger.error(`Renderer ${path} failed (HTTP ${status ?? 'no response'}): ${error instanceof Error ? error.message : String(error)}`);

        if (status && status >= 400 && status < 500) {
            throw new BadRequestException(typeof detail === 'string' && detail ? detail : options.rejectedMessage);
        }
        throw new ServiceUnavailableException('렌더링 서비스에 연결할 수 없습니다. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.');
    }
}
```

- [ ] **Step 4: `SlidesService`에 `getScene`/`saveScene` 추가**

`apps/api/src/modules/slides/slides.service.ts`의 import를 확장:

```ts
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../assets/storage.service';
import { postToRenderer } from '../../renderer-client';
import { CreateSlideDto, UpdateSlideDto, ReorderSlidesDto } from './dto/slides.dto';
```

생성자를 교체:

```ts
@Injectable()
export class SlidesService {
    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private storage: StorageService,
    ) { }
```

`update` 메서드 뒤에 두 메서드를 추가:

```ts
    async getScene(id: string, userId: string): Promise<{ scene: any }> {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: { presentation: { include: { template: true } } },
        });
        if (!slide) throw new NotFoundException('Slide not found');
        if (slide.presentation.userId !== userId && !slide.presentation.isPublic) {
            throw new ForbiddenException('Access denied');
        }

        const content = (slide.content as any) || {};
        const config = (slide.presentation.template?.config as any) || {};
        const rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';

        if (config.source?.kind === 'pptx') {
            const storageKey = config.source?.storageKey || config.pptxTemplate?.storageKey;
            if (!storageKey) throw new BadRequestException('PPTX source file is unavailable');
            const source = await this.storage.getBuffer(storageKey);
            return postToRenderer<{ scene: any }>(rendererUrl, '/api/scene/pptx/load', {
                sourcePptx: source.toString('base64'),
                templateIndex: typeof content.templateIndex === 'number' ? content.templateIndex : 0,
                objectEdits: content.objectEdits || [],
            }, { timeout: 30000, rejectedMessage: '슬라이드를 편집 가능한 형태로 불러오지 못했습니다.' });
        }

        const htmlSlides = config.htmlSlides;
        const index = content.templateIndex;
        const html = typeof content.html === 'string' && content.html.trim()
            ? content.html
            : (Array.isArray(htmlSlides) && Number.isInteger(index) && typeof htmlSlides[index] === 'string' ? htmlSlides[index] : '');
        if (!html) throw new BadRequestException('슬라이드에 편집할 콘텐츠가 없습니다.');
        return postToRenderer<{ scene: any }>(rendererUrl, '/api/scene/html/load', { html }, {
            timeout: 15000,
            rejectedMessage: '슬라이드를 편집 가능한 형태로 불러오지 못했습니다.',
        });
    }

    async saveScene(id: string, userId: string, scene: Record<string, any>) {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: { presentation: { include: { template: true } } },
        });
        if (!slide) throw new NotFoundException('Slide not found');
        if (slide.presentation.userId !== userId) throw new ForbiddenException('Access denied');

        const config = (slide.presentation.template?.config as any) || {};
        const rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';
        const content = (slide.content as any) || {};

        if (config.source?.kind === 'pptx') {
            const { objectEdits } = await postToRenderer<{ objectEdits: any[] }>(rendererUrl, '/api/scene/pptx/save', { scene }, {
                timeout: 15000,
                rejectedMessage: '편집 내용을 저장하지 못했습니다.',
            });
            return this.prisma.slide.update({ where: { id }, data: { content: { ...content, objectEdits } } });
        }

        const { html } = await postToRenderer<{ html: string }>(rendererUrl, '/api/scene/html/save', { scene }, {
            timeout: 15000,
            rejectedMessage: '편집 내용을 저장하지 못했습니다.',
        });
        return this.prisma.slide.update({ where: { id }, data: { content: { ...content, html } } });
    }
```

- [ ] **Step 5: 테스트 확인**

Run: `npx jest slides.service.spec.ts`
Expected: 전체 PASS.

- [ ] **Step 6: 컨트롤러·DTO·모듈 배선**

`apps/api/src/modules/slides/dto/slides.dto.ts` 맨 아래에 추가:

```ts
export class SaveSceneDto {
    @ApiProperty({ description: 'The current SlideScene JSON' })
    @IsObject()
    scene: Record<string, any>;
}
```

`apps/api/src/modules/slides/slides.controller.ts`의 import에 `Patch`를 추가:

```ts
import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
```

`import { CreateSlideDto, UpdateSlideDto, ReorderSlidesDto } from './dto/slides.dto';`를 `import { CreateSlideDto, UpdateSlideDto, ReorderSlidesDto, SaveSceneDto } from './dto/slides.dto';`로 바꾸고, `duplicate` 라우트 뒤에 추가:

```ts
    @Get(':id/scene')
    @ApiOperation({ summary: 'Get the slide as an editable SlideScene' })
    async getScene(@CurrentUser() user: any, @Param('id') id: string) {
        return this.slidesService.getScene(id, user.id);
    }

    @Patch(':id/scene')
    @ApiOperation({ summary: 'Save an edited SlideScene back onto the slide' })
    async saveScene(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: SaveSceneDto) {
        return this.slidesService.saveScene(id, user.id, dto.scene);
    }
```

`apps/api/src/modules/slides/slides.module.ts`를 교체:

```ts
import { Module } from '@nestjs/common';
import { SlidesController } from './slides.controller';
import { SlidesService } from './slides.service';
import { AssetsModule } from '../assets/assets.module';

@Module({
    imports: [AssetsModule],
    controllers: [SlidesController],
    providers: [SlidesService],
    exports: [SlidesService],
})
export class SlidesModule { }
```

- [ ] **Step 7: 회귀·커밋**

Run: `npx jest --selectProjects api` (또는 저장소의 API 테스트 커맨드)
Expected: 전체 PASS.

```bash
git add apps/api/src/renderer-client.ts apps/api/src/modules/slides
git commit -m "feat(api): serve scene load/save for a slide, proxying to the renderer"
```

---

### Task 5: 웹 — scene 데이터 레이어 (`EditorPage`에 추가만, 아직 렌더링 연결 안 함)

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/editor/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 4의 `GET/PATCH .../slides/:id/scene`, `applySceneCommand`(`@jaslide/shared`), `SlideScene`/`SlideObject`/`TextObject`/`TableObject`/`ShapeObject`/`LineObject`/`ImageObject`(`@jaslide/shared`).
- Produces: `EditorPage`에 `scene`(현재 슬라이드의 `SlideScene | null`) state와, Task 6이 `<SceneCanvas>`에 연결할 `onSceneCommand`/`insertSceneObject`/`deleteSceneObject`/`duplicateSceneObject`/`saveSceneDelayed` 핸들러.

이 작업은 순수 추가다 — 기존 `<EditableSlidePreview>`는 그대로 렌더링되고, `scene` state는 아직 아무 JSX에도 연결되지 않는다. Task 6에서 실제로 소비한다.

- [ ] **Step 1: API 클라이언트 메서드 추가**

`apps/web/src/lib/api.ts`의 `slidesApi` 객체에 추가 (닫는 `}` 앞):

```ts
    getScene: (presentationId: string, slideId: string) =>
        api.get(`/presentations/${presentationId}/slides/${slideId}/scene`),
    saveScene: (presentationId: string, slideId: string, scene: any) =>
        api.patch(`/presentations/${presentationId}/slides/${slideId}/scene`, { scene }),
```

- [ ] **Step 2: `EditorPage`에 scene state와 fetch effect 추가**

`apps/web/src/app/editor/[id]/page.tsx`의 import 목록에 추가:

```ts
import { applySceneCommand, type SlideScene, type SlideObject, type SceneCommand } from '@jaslide/shared';
```

`const [slideHtml, setSlideHtml] = useState<Record<string, string>>({});` 선언 바로 뒤에 추가 (기존 `slideHtml`은 Task 6까지는 그대로 둔다):

```ts
    // The current slide's editable scene — fetched on demand per slide (same
    // fetch-per-slide shape as `slideHtml` above), null while loading or when
    // the slide has nothing scene-derivable to show yet.
    const [scene, setScene] = useState<SlideScene | null>(null);
    const [sceneError, setSceneError] = useState(false);
```

`slideHtml`을 채우는 `useEffect`(기존 565-576줄 근방, `presentationsApi.slideTemplateHtml(...)` 호출부) 바로 뒤에 새 effect를 추가:

```ts
    useEffect(() => {
        if (!presentation || !selectedSlide) { setScene(null); setSceneError(false); return; }
        let cancelled = false;
        setScene(null);
        setSceneError(false);
        slidesApi.getScene(presentation.id, selectedSlide.id)
            .then(({ data }) => { if (!cancelled) setScene(data.scene); })
            .catch(() => { if (!cancelled) setSceneError(true); });
        return () => { cancelled = true; };
    }, [presentation, selectedSlide]);
```

- [ ] **Step 3: 디바운스 저장, command/insert/delete/duplicate 핸들러 추가**

기존 `saveSchedulerRef`/`handleSaveSlideDelayed` 정의 바로 뒤(880-912줄 근방)에 추가:

```ts
    // Debounced scene save — same 500ms shape as `handleSaveSlideDelayed`, but
    // posts the whole scene so the server can convert it to whichever legacy
    // format (objectEdits or html) this slide's source actually needs.
    const sceneSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveSceneDelayed = useCallback((nextScene: SlideScene) => {
        if (!presentation || !selectedSlide) return;
        if (sceneSaveTimerRef.current) clearTimeout(sceneSaveTimerRef.current);
        sceneSaveTimerRef.current = setTimeout(() => {
            slidesApi.saveScene(presentation.id, selectedSlide.id, nextScene).catch(() => {
                toast({ title: '저장 실패', description: '편집 내용을 저장하지 못했습니다.', variant: 'destructive' });
            });
        }, 500);
    }, [presentation, selectedSlide]);

    const onSceneCommand = useCallback((command: SceneCommand) => {
        setScene((current) => {
            if (!current) return current;
            const next = applySceneCommand(current, command);
            saveSceneDelayed(next);
            return next;
        });
    }, [saveSceneDelayed]);

    const commitScene = useCallback((mutate: (objects: SlideObject[]) => SlideObject[]) => {
        setScene((current) => {
            if (!current) return current;
            const next = { ...current, objects: mutate(current.objects) };
            saveSceneDelayed(next);
            return next;
        });
    }, [saveSceneDelayed]);

    const insertSceneObject = useCallback((object: SlideObject) => {
        commitScene((objects) => [...objects, object]);
    }, [commitScene]);

    const deleteSceneObject = useCallback((objectId: string) => {
        commitScene((objects) => objects.filter((item) => item.id !== objectId));
    }, [commitScene]);

    const duplicateSceneObject = useCallback((objectId: string): string | null => {
        const source = scene?.objects.find((item) => item.id === objectId);
        if (!source) return null;
        const { sourceRef, ...rest } = source as SlideObject & { sourceRef?: unknown };
        const copy = { ...rest, id: `copy-${crypto.randomUUID()}`, x: source.x + 32, y: source.y + 32 } as SlideObject;
        insertSceneObject(copy);
        return copy.id;
    }, [scene, insertSceneObject]);
```

- [ ] **Step 4: 타입 체크와 커밋**

Run: `pnpm --filter @jaslide/web exec tsc --noEmit`
Expected: 에러 없음 — 이 작업은 아직 아무 JSX도 바꾸지 않았으므로 새 코드가 "사용되지 않음" 경고만 없다면(콜백은 정의만 되고 아직 호출되지 않는 게 정상이며, TS는 지역 함수의 미사용을 에러로 잡지 않는다) 통과해야 한다.

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/editor/\[id\]/page.tsx
git commit -m "feat(editor): fetch and debounce-save the current slide's scene"
```

---

### Task 6: 웹 — `SceneCanvas`로 렌더링 전환, legacy 편집 코드 제거

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 5의 `scene`/`sceneError`/`onSceneCommand`/`insertSceneObject`/`deleteSceneObject`/`duplicateSceneObject`, 기존 `SceneCanvas`/`SceneCanvasHandle`/`SceneSelectionFormat`(`@/components/editor/scene-canvas`).
- Produces: 실제 서비스 편집기가 두 덱 타입 모두에서 `SceneCanvas`로 편집된다.

이 작업은 파괴적이다 — 한 번에 끝내고 바로 브라우저로 확인한다(Task 7).

- [ ] **Step 1: import 교체**

`import { SlideCanvas, type SlideCanvasHandle, type SlideSelectionFormat } from '@/components/editor/slide-canvas';`를 아래로 교체:

```ts
import { SceneCanvas, type SceneCanvasHandle, type SceneSelectionFormat } from '@/components/editor/scene-canvas';
```

파일 전체에서 `SlideCanvasHandle`→`SceneCanvasHandle`, `SlideSelectionFormat`→`SceneSelectionFormat` 타입 참조를 치환한다 (state 선언 `const [canvasFormat, setCanvasFormat] = useState<SlideSelectionFormat | null>(null);`과 `slideCanvasRef`의 `useRef<SlideCanvasHandle>` 포함).

- [ ] **Step 2: 툴바(`applyFormat`)를 새 handle에 맞게 다시 배선**

`applyFormat`(513-545줄 근방) 안의 이 블록:

```ts
        if (canvasFormat) {
            const perCharacter = updates.align === undefined && updates.fillColor === undefined;
            if (perCharacter && slideCanvasRef.current?.formatSelection(updates)) {
                setCanvasFormat((format) => format ? { ...format, ...updates } : format);
                return;
            }
            if (updates.fillColor !== undefined) {
                slideCanvasRef.current?.setFillColor(canvasFormat.objectId, updates.fillColor);
                setCanvasFormat((format) => format ? { ...format, ...updates } : format);
            }
            updateNativeObject(canvasFormat.objectId, updates);
            return;
        }
```

을 아래로 교체 (`setFillColor(objectId, color)` 대신 새 handle의 `paintColor(objectId, property, color)`를 쓰고, `updateNativeObject`를 지우는 대신 이제 scene 자체가 저장 원본이므로 `formatSelection`이 처리 못 하는 나머지 속성 — 정렬/채우기 — 은 `onSceneCommand`로 직접 patch한다):

```ts
        if (canvasFormat) {
            const perCharacter = updates.align === undefined && updates.fillColor === undefined;
            if (perCharacter && sceneCanvasRef.current?.formatSelection(updates)) {
                setCanvasFormat((format) => format ? { ...format, ...updates } : format);
                return;
            }
            if (updates.fillColor !== undefined) {
                sceneCanvasRef.current?.paintColor(canvasFormat.objectId, 'fill', updates.fillColor);
                onSceneCommand({ objectId: canvasFormat.objectId, patch: { fill: updates.fillColor } as Partial<SlideObject> });
            }
            if (updates.align !== undefined) {
                onSceneCommand({
                    objectId: canvasFormat.objectId,
                    patch: { paragraphs: scene?.objects.find((item) => item.id === canvasFormat.objectId && item.type === 'text')
                        ? (scene.objects.find((item) => item.id === canvasFormat.objectId) as any).paragraphs.map((paragraph: any) => ({ ...paragraph, align: updates.align }))
                        : undefined } as Partial<SlideObject>,
                });
            }
            setCanvasFormat((format) => format ? { ...format, ...updates } : format);
            return;
        }
```

`slideCanvasRef`의 선언(451줄 근방)을 `const sceneCanvasRef = useRef<SceneCanvasHandle>(null);`로 이름까지 바꾸고, 파일 전체에서 `slideCanvasRef` 참조를 `sceneCanvasRef`로 치환한다.

- [ ] **Step 3: 삭제 — legacy per-object-edit 코드 전부**

아래 이름의 함수/상태/effect를 전부 삭제한다 (파일 전체에서 다른 곳에 쓰이지 않는지 먼저 확인 — 특히 `resolveTemplateValue`/`getTemplatePreviewStyle`는 템플릿 갤러리 미리보기에도 쓰이므로 남긴다):

  - 최상단 헬퍼 함수 (103-297줄 근방): `htmlTextElements`, `getHtmlTextFields`, `getHtmlSelectionAreas`, `updateHtmlObject`, `updateHtmlText`, `editorFrameHtml`, `addHtmlText`, `addHtmlShape`, `deleteHtmlObject`, `duplicateHtmlObject`, `setHtmlList`, `addHtmlTable`, `addHtmlList`, `addHtmlImage`.
  - `EditorPage` 안: `slideHtml`/`setSlideHtml` state와 그걸 채우는 `useEffect`, `htmlTextFormatCommand`/`setHtmlTextFormatCommand` state, `formatSelectedHtmlText`, `receiveSelectionStyle`를 등록하는 `useEffect`(`window.addEventListener('message', ...)`), `nativeObjects`/`selectedNativeObject` 파생 상수, `updateSelectedHtmlObject`, `updateNativeObject`, `duplicateNativeObject`, `deleteNativeObject`, `insertNativeText`, `insertNativeTable`, `insertNativeShape`, `deleteSelectedHtmlObject`, `duplicateSelectedHtmlObject`, `setSelectedHtmlList`(이미 죽은 코드), `insertHtmlObject`, `handleImageInsert`의 기존 branching 로직.
  - `selectedHtmlTextIndex`/`setSelectedHtmlTextIndex`, `selectedHtmlObject`, `activeHtmlTextStyle`, `htmlSelectionStyle`/`setHtmlSelectionStyle` — scene 하나로 통일되어 더 이상 필요 없다.
  - `EditableSlidePreview` 컴포넌트 전체(1817-2225줄) 안의: `htmlTextFields`/`htmlSelectionAreas`(이미 죽은 코드), `frameHtml` state와 그 effect, `htmlCanvasRef`/`htmlFrameRef`, `startHtmlFrameEditing`, `updateNativeObjectContent`, 그리고 `content.html && !nativeObjects.length`/`baseHtml`/`previewUrl`/`content.html && !nativeObjects.length`(중복 조건)/타입별 fallback 각 분기의 JSX(2000-2225줄) 전체.
  - "수동 편집" 사이드 패널(1505-1730줄 근방, `getHtmlTextFields`/`updateHtmlText`/`updateHtmlObject`/`addHtmlText`/`addHtmlShape`와 `content.objectEdits` 필드를 직접 읽고 쓰던 JSX 블록) — `SceneCanvas`의 직접 조작 + 툴바가 같은 기능을 통일된 방식으로 제공하므로 그대로 옮기지 않고 제거한다.

- [ ] **Step 4: `EditableSlidePreview`를 단일 `SceneCanvas` 렌더로 교체**

`interface EditableSlidePreviewProps`(1796-1815줄)를 아래로 교체:

```ts
interface EditableSlidePreviewProps {
    slide: any;
    scene: SlideScene | null;
    sceneError: boolean;
    previewUrl?: string | null;
    selectedObjectId: string | null;
    onSelectObject: (id: string | null) => void;
    onSelectionFormat: (format: SceneSelectionFormat | null) => void;
    onCommand: (command: SceneCommand) => void;
    sceneCanvasRef: React.RefObject<SceneCanvasHandle | null>;
    onNavigate: (direction: -1 | 1) => void;
}
```

컴포넌트 본문(1817-2225줄)을 아래로 교체:

```tsx
function EditableSlidePreview({
    slide, scene, sceneError, previewUrl, selectedObjectId, onSelectObject, onSelectionFormat, onCommand, sceneCanvasRef, onNavigate,
}: EditableSlidePreviewProps) {
    const [startX, setStartX] = useState<number | null>(null);
    const startSlideSwipe = (event: React.PointerEvent) => setStartX(event.clientX);
    const endSlideSwipe = (event: React.PointerEvent) => {
        if (startX === null) return;
        const delta = event.clientX - startX;
        setStartX(null);
        if (Math.abs(delta) > 80) onNavigate(delta > 0 ? -1 : 1);
    };

    if (scene) {
        return (
            <div className="relative h-full w-full touch-pan-y" onPointerDown={startSlideSwipe} onPointerUp={endSlideSwipe}>
                <SceneCanvas
                    ref={sceneCanvasRef}
                    scene={scene}
                    selectedObjectId={selectedObjectId}
                    onSelectObject={onSelectObject}
                    onSelectionFormat={onSelectionFormat}
                    onCommand={onCommand}
                />
            </div>
        );
    }
    if (sceneError && previewUrl) {
        return <img src={previewUrl} alt={`${slide.title || '슬라이드'} 미리보기`} className="h-full w-full object-contain" />;
    }
    if (sceneError) {
        return <div className="flex h-full items-center justify-center bg-secondary text-sm text-muted-foreground">이 슬라이드는 편집할 수 없습니다. 미리보기만 표시됩니다.</div>;
    }
    return <div className="flex h-full items-center justify-center bg-secondary text-sm text-muted-foreground">불러오는 중…</div>;
}
```

호출부(1426줄 근방)를 아래로 교체:

```tsx
<EditableSlidePreview
    slide={selectedSlide}
    scene={scene}
    sceneError={sceneError}
    previewUrl={previewUrl}
    selectedObjectId={selectedNativeObjectId}
    onSelectObject={setSelectedNativeObjectId}
    onSelectionFormat={setCanvasFormat}
    onCommand={onSceneCommand}
    sceneCanvasRef={sceneCanvasRef}
    onNavigate={navigateSlide}
/>
```

(`selectedNativeObjectId`/`setSelectedNativeObjectId`는 이름은 그대로 두되 이제 "현재 선택된 scene object id"라는 뜻으로 재사용한다 — state 자체는 `EditorPage`에 그대로 남아 있다.)

- [ ] **Step 5: 삽입 핸들러를 scene 기반으로 재배선**

기존 `insertNativeText`/`insertNativeTable`/`insertNativeShape`(Step 3에서 삭제 대상)를 호출하던 버튼들의 `onClick`을 아래 5개 핸들러로 교체한다. `EditorPage` 안, Task 5에서 추가한 `duplicateSceneObject` 정의 바로 뒤에 추가:

```ts
    const insertSceneText = () => {
        const id = `new-text-${crypto.randomUUID()}`;
        insertSceneObject({
            id, x: 180, y: 180, width: 640, height: 100, rotation: 0,
            type: 'text', paragraphs: [{ runs: [{ text: '새 텍스트', fontSize: 24, color: '#1A1A1A' }], level: 0, align: 'left' }],
        });
        setSelectedNativeObjectId(id);
        setRibbonTab('home');
    };

    const insertSceneTable = (rows: number, columns: number) => {
        const width = 1440;
        const height = Math.min(700, 90 * rows);
        const emptyCell = { paragraphs: [{ runs: [{ text: '' }], level: 0, align: 'left' as const }] };
        const id = `new-table-${crypto.randomUUID()}`;
        insertSceneObject({
            id, x: 240, y: 300, width, height, rotation: 0,
            type: 'table',
            rowHeights: Array.from({ length: rows }, () => height / rows),
            columnWidths: Array.from({ length: columns }, () => width / columns),
            cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ ...emptyCell }))),
        });
        setSelectedNativeObjectId(id);
    };

    const insertSceneShape = (kind: string, line = false) => {
        const width = 420;
        const height = line ? 80 : 220;
        const id = `new-${line ? 'line' : 'shape'}-${crypto.randomUUID()}`;
        insertSceneObject(line
            ? { id, x: 180, y: 180, width, height, rotation: 0, type: 'line', lineStyle: kind, stroke: '#202124', strokeWidth: 2 }
            : { id, x: 180, y: 180, width, height, rotation: 0, type: 'shape', shape: kind, fill: '#FFFFFF', stroke: '#202124', strokeWidth: 2 });
        setSelectedNativeObjectId(id);
    };

    const insertSceneImage = (imageData: string) => {
        const id = `new-image-${crypto.randomUUID()}`;
        insertSceneObject({ id, x: 180, y: 180, width: 640, height: 360, rotation: 0, type: 'image', src: imageData });
        setSelectedNativeObjectId(id);
    };
```

`handleImageInsert`(1119-1133줄, `FileReader`로 이미지를 읽어 data URI를 만드는 함수)는 파일 읽기 자체는 그대로 두고, 소스 종류로 분기하던 몸통만 교체:

```ts
    const handleImageInsert = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const imageData = reader.result as string;
            insertSceneImage(imageData);
        };
        reader.readAsDataURL(file);
    };
```

삽입 리본 탭의 버튼들(텍스트/표/도형/선/이미지/목록)의 `onClick`을 각각 `insertSceneText()`, `insertSceneTable(rows, columns)`, `insertSceneShape(kind)`, `insertSceneShape(kind, true)`, 기존 파일 입력 핸들러(내부에서 `handleImageInsert(file)` 호출)로 바꾼다 — 더 이상 `presentation?.template?.config?.source?.kind === 'pptx'`로 분기하지 않는다(두 덱 타입 모두 같은 scene 경로).

목록(글머리/번호 목록) 버튼(1341-1342줄, `insertHtmlObject((html) => addHtmlList(html, ...))`을 쓰던 것)은 텍스트 삽입과 같은 모양이되 `bulleted`를 세팅해 교체:

```tsx
<Button type="button" size="sm" variant="outline" onClick={() => {
    const id = `new-text-${crypto.randomUUID()}`;
    insertSceneObject({
        id, x: 180, y: 180, width: 720, height: 160, rotation: 0,
        type: 'text',
        paragraphs: ['첫 번째 항목', '두 번째 항목', '세 번째 항목'].map((text) => ({
            runs: [{ text, fontSize: 24, color: '#1A1A1A' }], level: 0, align: 'left' as const, bulleted: true,
        })),
    });
    setSelectedNativeObjectId(id);
}}><List className="mr-1 h-4 w-4" />글머리</Button>
```
(번호 목록 버튼은 `ListOrdered` 아이콘만 바꾸고 `bulleted: true` 대신 순서 있는 목록 표기가 필요하면 `formatRuns`/`toggleBullet`이 다루지 않는 번호 매기기이므로, 이번 범위에서는 글머리 목록과 동일하게 취급한다 — ponytail: 번호 매기기 전용 렌더링은 스코프 밖, 필요해지면 `TextParagraph`에 `ordered?: boolean`을 추가).

삭제/복제 버튼은 `deleteSelectedObject`/`duplicateSelectedObject`(560-561줄)를 아래로 교체:

```ts
    const deleteSelectedObject = () => selectedNativeObjectId && deleteSceneObject(selectedNativeObjectId);
    const duplicateSelectedObject = () => {
        if (!selectedNativeObjectId) return;
        const copyId = duplicateSceneObject(selectedNativeObjectId);
        if (copyId) setSelectedNativeObjectId(copyId);
    };
```

- [ ] **Step 6: 타입 체크·유닛 테스트·빌드**

Run:
```bash
pnpm --filter @jaslide/web exec tsc --noEmit
pnpm --filter @jaslide/web test
pnpm --filter @jaslide/web build
```
Expected: 전부 통과. (기존 `slide-canvas.test.js`가 여전히 있다면 그대로 통과해야 한다 — `slide-canvas.tsx` 자체는 지우지 않는다, 다른 화면에서 참조하지 않는지는 Task 7에서 최종 확인한다.)

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/app/editor/\[id\]/page.tsx
git commit -m "feat(editor): edit both PPTX and HTML-ZIP decks through SceneCanvas"
```

---

### Task 7: 전체 회귀와 실제 브라우저 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 컨테이너 재빌드**

```bash
docker compose up -d --build web api renderer
```

- [ ] **Step 2: 전체 자동화 테스트**

```bash
pnpm --filter @jaslide/web test
pnpm --filter @jaslide/api test
docker compose exec -T renderer python -m pytest apps/renderer/tests -q
```
Expected: 전부 PASS.

- [ ] **Step 3: 실제 PPTX 소스 덱으로 브라우저 검증**

`http://localhost:3100`에서 로그인 → PPTX 템플릿으로 만든 실제 저장된 프레젠테이션을 연다. 확인:
- 슬라이드를 열면 기존 도형/표/텍스트가 정확한 위치·서식으로 나타난다(빈 캔버스나 콘솔 에러 없음).
- 텍스트 일부를 선택해 굵게/색 변경 → 새로고침 후에도 유지.
- 도형을 하나 옮기고 크기 조절 → 새로고침 후에도 유지.
- 새 텍스트 상자/도형/표를 삽입 → 저장 → 새로고침 후에도 유지.
- 객체 하나 삭제 → 새로고침 후에도 사라져 있음.
- PPTX로 내보내기 → 받은 파일을 열어 편집한 내용이 실제로 반영돼 있는지 확인.

- [ ] **Step 4: 실제 HTML ZIP 소스 덱으로 브라우저 검증**

같은 항목을 HTML ZIP 템플릿으로 만든 프레젠테이션에서 반복한다. 추가로: 표 셀 텍스트 편집 → 새로고침 후 유지되는지 확인.

- [ ] **Step 5: 회귀 확인**

버전 히스토리, 댓글, 슬라이드 추가/삭제/순서변경, AI 채팅 편집, PPTX 재추출 등 이번에 손대지 않은 기능이 여전히 동작하는지 한 번씩 눌러본다.

- [ ] **Step 6: 최종 커밋**

문제가 없으면 이미 각 Task에서 커밋이 끝난 상태다. Step 3-5에서 버그를 고쳤다면:

```bash
git add -A
git commit -m "fix(editor): address scene-engine integration issues found in browser verification"
```
