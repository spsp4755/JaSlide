"""
PPTX Generator - Creates PowerPoint presentations using python-pptx
"""

from pptx import Presentation as PPTXPresentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.dml.color import RGBColor
from pptx.oxml.xmlchemy import OxmlElement
from pptx.oxml.ns import qn
from pptx.enum.shapes import MSO_SHAPE
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from io import BytesIO
import base64
from typing import Optional, Any
from ..services.html_template import extract_html_template_style, parse_html_layout, parse_html_objects
from ..services.html_renderer import render_slide_png


class PPTXGenerator:
    """Generate PPTX files from presentation data"""

    # Slide dimensions (16:9 aspect ratio)
    SLIDE_WIDTH = Inches(13.333)
    SLIDE_HEIGHT = Inches(7.5)

    # Default margins
    MARGIN_TOP = Inches(0.5)
    MARGIN_LEFT = Inches(0.5)
    MARGIN_RIGHT = Inches(0.5)
    MARGIN_BOTTOM = Inches(0.5)
    DEFAULT_COLORS = {"background": "#FFFFFF", "text": "#1E293B"}
    DEFAULT_FONT = "Noto Sans KR"

    def __init__(self, template_config: Optional[Any] = None):
        self.template_config = template_config
        config = self._as_dict(getattr(template_config, "config", template_config))
        self.html_tokens, extracted_layout = extract_html_template_style(config.get("htmlTemplate", ""))
        self.html_slides = [slide for slide in config.get("htmlSlides", []) if isinstance(slide, str)]
        if not self.html_slides and isinstance(config.get("htmlTemplate"), str) and 'data-object="true"' in config["htmlTemplate"]:
            self.html_slides = [config["htmlTemplate"]]
        self.tokens = self._resolve_tokens(template_config)
        self.html_layout = parse_html_layout(config.get("htmlTemplate", "")) or extracted_layout
        self._reset_presentation()

    def _reset_presentation(self) -> None:
        self.prs = PPTXPresentation()
        self.prs.slide_width = self.SLIDE_WIDTH
        self.prs.slide_height = self.SLIDE_HEIGHT

    @staticmethod
    def _as_dict(value: Any) -> dict:
        if isinstance(value, dict):
            return value
        if hasattr(value, "model_dump"):
            return value.model_dump(exclude_none=True)
        return vars(value) if value is not None else {}

    @staticmethod
    def _rgb(value: Any, fallback: str) -> RGBColor:
        if not isinstance(value, str) or not value.startswith("#"):
            value = fallback
        value = value[1:]
        if len(value) != 6 or any(char not in "0123456789abcdefABCDEF" for char in value):
            value = fallback[1:]
        return RGBColor.from_string(value.upper())

    def _resolve_tokens(self, template: Any) -> dict:
        config = self._as_dict(getattr(template, "config", template))
        colors = self._as_dict(config.get("colors"))
        typography = self._as_dict(config.get("typography"))
        return {
            "background": self._rgb(colors.get("background") or self.html_tokens.get("background"), self.DEFAULT_COLORS["background"]),
            "text": self._rgb(colors.get("text") or self.html_tokens.get("text"), self.DEFAULT_COLORS["text"]),
            "title_font": typography.get("titleFont") or self.html_tokens.get("titleFont") or self.DEFAULT_FONT,
            "body_font": typography.get("bodyFont") or self.html_tokens.get("bodyFont") or self.DEFAULT_FONT,
        }

    def _apply_background(self, slide: Any) -> None:
        fill = slide.background.fill
        fill.solid()
        fill.fore_color.rgb = self.tokens["background"]

    def _layout(self, slot: str, defaults: dict) -> dict:
        return {**defaults, **self.html_layout.get(slot, {})}

    @staticmethod
    def _apply_alignment(paragraph: Any, value: Optional[str]) -> None:
        alignments = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}
        if value in alignments:
            paragraph.alignment = alignments[value]

    @staticmethod
    def _add_layout_textbox(slide: Any, layout: dict) -> Any:
        return slide.shapes.add_textbox(
            Inches(layout["x"]), Inches(layout["y"]), Inches(layout["w"]), Inches(layout["h"])
        )

    def _style_paragraph(
        self, paragraph: Any, size: int, font: str, bold: bool = False, italic: bool = False
    ) -> None:
        for run in paragraph.runs:
            run.font.name = font
            r_pr = run._r.get_or_add_rPr()
            east_asian = r_pr.find(qn("a:ea"))
            if east_asian is None:
                east_asian = OxmlElement("a:ea")
                r_pr.append(east_asian)
            east_asian.set("typeface", font)
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.italic = italic
            run.font.color.rgb = self.tokens["text"]

    def generate(self, presentation: Any, slide_index: Optional[int] = None) -> bytes:
        """Generate PPTX from presentation data"""
        config = self._as_dict(getattr(self.template_config, "config", self.template_config))
        source = config.get("sourcePptx")
        if isinstance(source, str) and source:
            self.prs = PPTXPresentation(BytesIO(base64.b64decode(source)))
            for slide_data in presentation.slides:
                for edit in self._as_dict(getattr(slide_data, "content", {})).get("objectEdits", []):
                    self._apply_native_edit(edit)
            buffer = BytesIO()
            self.prs.save(buffer)
            return buffer.getvalue()
        self._reset_presentation()
        slides = list(enumerate(presentation.slides))
        if slide_index is not None:
            if slide_index < 0 or slide_index >= len(slides):
                raise ValueError("Slide index is out of range")
            slides = [slides[slide_index]]
        total_slides = len(presentation.slides)
        for template_index, slide_data in slides:
            self._add_slide(slide_data, template_index, total_slides)

        # Save to buffer
        buffer = BytesIO()
        self.prs.save(buffer)
        buffer.seek(0)
        return buffer.read()

    def _apply_native_edit(self, edit: dict) -> None:
        if not isinstance(edit, dict) or not isinstance(edit.get("slide"), int):
            return
        if edit["slide"] < 0 or edit["slide"] >= len(self.prs.slides):
            return
        shape = next((item for item in self.prs.slides[edit["slide"]].shapes if str(item.shape_id) == str(edit.get("objectId"))), None)
        if not shape:
            return
        if isinstance(edit.get("text"), str) and getattr(shape, "has_text_frame", False):
            shape.text = edit["text"]
        cells = edit.get("cells")
        if isinstance(cells, list) and getattr(shape, "has_table", False):
            for row_index, row in enumerate(cells):
                if not isinstance(row, list) or row_index >= len(shape.table.rows):
                    continue
                for column_index, value in enumerate(row):
                    if column_index < len(shape.table.columns) and isinstance(value, str):
                        shape.table.cell(row_index, column_index).text = value

    def _add_slide(self, slide_data: Any, template_index: int = 0, total_slides: int = 1):
        """Add a slide based on its type"""
        content = self._as_dict(getattr(slide_data, "content", {}))
        if isinstance(content.get("html"), str) and content["html"].strip():
            self._add_html_image_slide(content["html"])
            return
        if self.html_slides:
            selected_index = self._template_index(slide_data, template_index, total_slides)
            objects = parse_html_objects(self.html_slides[selected_index])
            if objects:
                self._add_html_template_slide(slide_data, selected_index, objects)
                return
            # ponytail: the uploaded deck isn't in JaSlide's data-object markup, so there's
            # nothing to place absolutely. Fall through to the generic layout below, which
            # already picks up this template's extracted background/font tokens (self.tokens)
            # instead of emitting a blank slide.
        slide_type = slide_data.type.upper()
        content = slide_data.content

        if slide_type == "TITLE":
            self._add_title_slide(slide_data)
        elif slide_type == "CONTENT":
            self._add_content_slide(slide_data)
        elif slide_type == "BULLET_LIST":
            self._add_bullet_slide(slide_data)
        elif slide_type == "TWO_COLUMN":
            self._add_two_column_slide(slide_data)
        elif slide_type == "QUOTE":
            self._add_quote_slide(slide_data)
        elif slide_type == "SECTION_HEADER":
            self._add_section_header_slide(slide_data)
        else:
            self._add_content_slide(slide_data)

    def _add_html_image_slide(self, html: str) -> None:
        slide = self.prs.slides.add_slide(self.prs.slide_layouts[6])
        slide.shapes.add_picture(BytesIO(render_slide_png(html)), 0, 0, self.SLIDE_WIDTH, self.SLIDE_HEIGHT)

    def _add_html_template_slide(self, slide_data: Any, selected_index: int, objects: list[dict]):
        slide = self.prs.slides.add_slide(self.prs.slide_layouts[6])
        background = next((item["background"] for item in objects if item["x"] == 0 and item["y"] == 0 and item["w"] >= 13.3 and item["h"] >= 7.4 and item["background"]), None)
        if background:
            fill = slide.background.fill
            fill.solid()
            fill.fore_color.rgb = self._rgb(background, self.DEFAULT_COLORS["background"])
        else:
            self._apply_background(slide)

        content = slide_data.content or {}
        content_slots = []
        for item in objects:
            if item["type"] == "shape" and item["background"] and not (item["x"] == 0 and item["y"] == 0 and item["w"] >= 13.3 and item["h"] >= 7.4):
                shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(item["x"]), Inches(item["y"]), Inches(item["w"]), Inches(item["h"]))
                shape.fill.solid()
                shape.fill.fore_color.rgb = self._rgb(item["background"], self.DEFAULT_COLORS["background"])
                shape.line.fill.background()
                if item["w"] >= 2 and item["h"] >= 0.7:
                    content_slots.append(item)

        if self._add_semantic_html_layout(slide, self._template_name(selected_index), slide_data, content):
            return

        textboxes = sorted((item for item in objects if item["type"] == "textbox"), key=lambda item: item["fontSize"], reverse=True)
        generated_text = [content.get("heading", slide_data.title or "")]
        for item in textboxes:
            box = self._add_layout_textbox(slide, item)
            text = generated_text[textboxes.index(item)] if item in textboxes[:1] else ""
            box.text_frame.paragraphs[0].text = text
            self._style_paragraph(box.text_frame.paragraphs[0], item["fontSize"], item["font"] or self.tokens["body_font"], bold=item["bold"])
            box.text_frame.paragraphs[0].font.color.rgb = self._rgb(item["color"], self.DEFAULT_COLORS["text"])
            self._apply_alignment(box.text_frame.paragraphs[0], item["align"])

        if str(getattr(slide_data, "type", "")).upper() == "CHART" and self._add_chart(slide, content, content_slots):
            return

        slot_text = [item if isinstance(item, str) else item.get("text", "") for item in content.get("bullets", [])] or [content.get("body", "")]
        if len(slot_text) > 1:
            compact_slots = [slot for slot in content_slots if slot["w"] < 8]
            content_slots = compact_slots or content_slots
        if len(content_slots) < len(slot_text) and content.get("body"):
            slot_text = [content["body"]]
        for item, text in zip(sorted(content_slots, key=lambda slot: (slot["y"], slot["x"])), filter(None, slot_text)):
            box = self._add_layout_textbox(slide, {"x": item["x"] + 0.18, "y": item["y"] + 0.18, "w": max(item["w"] - 0.36, 0.2), "h": max(item["h"] - 0.36, 0.2)})
            box.text_frame.paragraphs[0].text = text
            self._style_paragraph(box.text_frame.paragraphs[0], 13 if len(text) > 80 else 16, self.tokens["body_font"], bold=False)
            if self._is_dark(item["background"]):
                for run in box.text_frame.paragraphs[0].runs:
                    run.font.color.rgb = self._rgb("#FFFFFF", self.DEFAULT_COLORS["text"])

    def _template_name(self, index: int) -> str:
        config = self._as_dict(getattr(self.template_config, "config", self.template_config))
        archive = self._as_dict(config.get("zipTemplate"))
        names = archive.get("slides") if isinstance(archive.get("slides"), list) else []
        return str(names[index]).lower() if 0 <= index < len(names) else ""

    @staticmethod
    def _content_texts(content: dict) -> list[str]:
        bullets = content.get("bullets") if isinstance(content.get("bullets"), list) else []
        texts = [str(item.get("text", "")) if isinstance(item, dict) else str(item) for item in bullets]
        return [text.strip() for text in texts if text and text.strip()] or [str(content.get("body", "")).strip()]

    def _write(self, slide: Any, text: str, x: float, y: float, w: float, h: float, size: int, *, color: str = "#1A1A1A", bold: bool = False, font: Optional[str] = None) -> None:
        box = self._add_layout_textbox(slide, {"x": x, "y": y, "w": w, "h": h})
        box.text_frame.word_wrap = True
        paragraph = box.text_frame.paragraphs[0]
        paragraph.text = text
        self._style_paragraph(paragraph, size, font or self.tokens["body_font"], bold=bold)
        for run in paragraph.runs:
            run.font.color.rgb = self._rgb(color, self.DEFAULT_COLORS["text"])

    def _add_semantic_html_layout(self, slide: Any, template_name: str, slide_data: Any, content: dict) -> bool:
        """Fill imported report layouts by their information structure, not as blank decoration."""
        if not any(key in template_name for key in ("threat-model", "rsp-tier", "methodology", "external-evaluators")):
            return False
        title = str(content.get("heading") or getattr(slide_data, "title", ""))
        body = str(content.get("body") or "")
        texts = self._content_texts(content)
        self._write(slide, title, .83, .90, 10.2, .55, 30, bold=True)
        self._write(slide, body, .83, 1.48, 11.65, .35, 11, color="#5C5C5C")
        self._write(slide, "AI SECURITY REPORT", .83, .42, 4.2, .18, 8, color="#5C5C5C", bold=True, font="JetBrains Mono")
        if "threat-model" in template_name:
            self._add_threat_model(slide, texts)
        elif "rsp-tier" in template_name:
            self._add_rsp_tier(slide, texts)
        elif "methodology" in template_name:
            self._add_methodology(slide, texts)
        else:
            self._add_external_evaluators(slide, texts)
        return True

    def _add_threat_model(self, slide: Any, texts: list[str]) -> None:
        headers = ["위협 시나리오", "공격 표면", "핵심 대응", "우선순위"]
        x, y, w = .83, 2.0, 11.67
        widths = [3.0, 2.45, 4.35, 1.87]
        self._add_table_row(slide, headers, x, y, widths, .42, header=True)
        for index, text in enumerate((texts + [""] * 4)[:4]):
            parts = [part.strip() for part in text.replace("·", "-").split("-") if part.strip()]
            values = [parts[0] if parts else text, "모델·도구 접근", "정책·검증·모니터링", "높음" if index < 2 else "중간"]
            self._add_table_row(slide, values, x, y + .42 + index * .92, widths, .92, shaded=index % 2 == 1)

    def _add_table_row(self, slide: Any, values: list[str], x: float, y: float, widths: list[float], h: float, *, header: bool = False, shaded: bool = False) -> None:
        cursor = x
        for value, width in zip(values, widths):
            shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(cursor), Inches(y), Inches(width), Inches(h))
            shape.fill.solid()
            shape.fill.fore_color.rgb = self._rgb("#F2F1EA" if shaded else "#FAFAF7", "#FFFFFF")
            shape.line.color.rgb = self._rgb("#1A1A1A" if header else "#D5D5CD", "#D5D5CD")
            self._write(slide, value, cursor + .10, y + .10, width - .20, h - .16, 10 if header else 12, bold=header or width == widths[0])
            cursor += width

    def _add_rsp_tier(self, slide: Any, texts: list[str]) -> None:
        levels = ["ASL-1\n기본 안전 통제", "ASL-2\n위험 신호 탐지", "ASL-3\n고위험 역량 관리", "ASL-4\n상시 재평가"]
        for index, level in enumerate(levels):
            self._write(slide, level, .98 + index * 2.92, 2.13, 2.45, .55, 12, color="#FAFAF7" if index == 2 else "#1A1A1A", bold=True)
        for index in range(2):
            text = (texts + [""] * 2)[index]
            x = 1.03 + index * 5.97
            self._write(slide, f"TRIGGER 0{index + 1}", x, 3.66, 4.9, .18, 9, color="#C8541C", bold=True, font="JetBrains Mono")
            self._write(slide, text, x, 4.02, 4.9, 1.85, 16, bold=True)

    def _add_methodology(self, slide: Any, texts: list[str]) -> None:
        metrics = [("4", "핵심 통제 영역"), ("12", "검증 시나리오"), ("3", "독립 검토 단계"), ("100%", "대응 체계 점검")]
        for index, (value, label) in enumerate(metrics):
            col, row = index % 2, index // 2
            x, y = 1.02 + col * 2.25, 2.65 + row * 1.42
            self._write(slide, value, x, y, 1.9, .48, 32, color="#FAFAF7", bold=True)
            self._write(slide, label, x, y + .52, 1.95, .32, 9, color="#9C9C95")
        for index, text in enumerate((texts + [""] * 4)[:4]):
            y = 2.42 + index * 1.0
            self._write(slide, f"0{index + 1}", 6.58, y + .17, .35, .22, 10, color="#C8541C", bold=True, font="JetBrains Mono")
            self._write(slide, text, 7.0, y + .12, 5.15, .52, 13, bold=True)

    def _add_external_evaluators(self, slide: Any, texts: list[str]) -> None:
        names = ["독립 보안 검토", "레드팀 검증", "운영 감사"]
        for index, name in enumerate(names):
            x = 1.03 + index * 3.96
            text = (texts + [""] * 3)[index]
            self._write(slide, "EXTERNAL REVIEW", x, 2.20, 2.95, .18, 8, color="#5C5C5C", bold=True, font="JetBrains Mono")
            self._write(slide, name, x, 2.55, 2.95, .42, 17, bold=True)
            self._write(slide, text, x, 3.43, 2.95, 2.0, 12)
        self._write(slide, body := "독립적인 검토 결과를 운영 통제와 개선 계획에 반영합니다.", 1.0, 6.22, 11.2, .3, 11, color="#1A1A1A")

    def _add_chart(self, slide: Any, content: dict, slots: list[dict] | None = None) -> bool:
        chart = content.get("chart") if isinstance(content.get("chart"), dict) else {}
        labels, values = chart.get("labels"), chart.get("values")
        if not (isinstance(labels, list) and isinstance(values, list) and 2 <= len(labels) == len(values) <= 6):
            return False
        if not all(isinstance(label, str) and label.strip() for label in labels) or not all(isinstance(value, (int, float)) for value in values):
            return False
        data = CategoryChartData()
        data.categories = labels
        data.add_series(chart.get("series", "Value"), values)
        light_slots = [slot for slot in slots or [] if not self._is_dark(slot.get("background"))]
        slot = max(light_slots, key=lambda item: item["w"] * item["h"], default=None)
        x, y, w, h = (slot["x"] + 0.25, slot["y"] + 0.35, max(slot["w"] - 0.5, 2), max(slot["h"] - 0.7, 1.5)) if slot else (1.0, 2.0, 11.3, 4.6)
        graphic = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(x), Inches(y), Inches(w), Inches(h), data)
        graphic.chart.has_legend = False
        graphic.chart.value_axis.has_major_gridlines = True
        return True

    @staticmethod
    def _is_dark(color: str | None) -> bool:
        if not color or not color.startswith("#") or len(color) != 7:
            return False
        red, green, blue = (int(color[index:index + 2], 16) for index in (1, 3, 5))
        return red * 299 + green * 587 + blue * 114 < 128000

    def _template_index(self, slide_data: Any, slide_index: int, total_slides: int) -> int:
        """Choose a matching imported layout, falling back to an even spread."""
        archive = self._as_dict(self._as_dict(getattr(self.template_config, "config", self.template_config)).get("zipTemplate"))
        names = archive.get("slides") if isinstance(archive.get("slides"), list) else []
        selected = self._as_dict(getattr(slide_data, "content", {})).get("templateIndex")
        selected_name = names[selected].lower() if isinstance(selected, int) and selected < len(names) and isinstance(names[selected], str) else ""
        title = str(getattr(slide_data, "title", "")).lower()
        # ponytail: block obvious appendix/reference choices; add semantic template metadata if names prove insufficient.
        if isinstance(selected, int) and 0 <= selected < len(self.html_slides) and (not any(word in selected_name for word in ("appendix", "reference")) or any(word in title for word in ("appendix", "reference", "참고", "부록"))):
            return selected
        keywords = {
            "TITLE": ("cover", "title", "intro"),
            "BULLET_LIST": ("agenda", "outline", "list"),
            "SECTION_HEADER": ("section", "divider", "pov"),
            "CONTENT": ("market", "strategy", "case", "roadmap", "future", "overview"),
            "QUOTE": ("executive-summary", "summary", "conclusion", "residual-risk"),
        }.get(str(getattr(slide_data, "type", "")).upper(), ())
        matches = [index for keyword in keywords for index, name in enumerate(names) if isinstance(name, str) and keyword in name.lower()]
        if matches:
            return matches[slide_index % len(matches)]
        return round(slide_index * (len(self.html_slides) - 1) / max(total_slides - 1, 1))

    def _add_title_slide(self, slide_data: Any):
        """Add title slide"""
        blank_layout = self.prs.slide_layouts[6]  # Blank layout
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        subtitle = content.get("subheading", "")

        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 2.5, "w": 12.333, "h": 1.5, "fontSize": 54})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        if "align" not in title_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER

        # Subtitle
        if subtitle:
            subtitle_layout = self._layout("subtitle", {"x": 1, "y": 4.2, "w": 11.333, "h": 0.8, "fontSize": 24})
            sub_box = self._add_layout_textbox(slide, subtitle_layout)
            tf = sub_box.text_frame
            tf.paragraphs[0].text = subtitle
            self._style_paragraph(tf.paragraphs[0], subtitle_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(tf.paragraphs[0], subtitle_layout.get("align"))
            if "align" not in subtitle_layout:
                tf.paragraphs[0].alignment = PP_ALIGN.CENTER

    def _add_content_slide(self, slide_data: Any):
        """Add content slide with title and body"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        body = content.get("body", "")
        bullets = content.get("bullets", [])

        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        # Content area
        content_top = Inches(1.3)
        content_height = Inches(5.7)

        if body:
            body_layout = self._layout("body", {"x": 0.5, "y": 1.3, "w": 12.333, "h": 5.7, "fontSize": 20})
            body_box = self._add_layout_textbox(slide, body_layout)
            tf = body_box.text_frame
            tf.word_wrap = True
            tf.paragraphs[0].text = body
            self._style_paragraph(tf.paragraphs[0], body_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(tf.paragraphs[0], body_layout.get("align"))

        if bullets:
            self._add_bullets(slide, bullets, content_top, content_height)

    def _add_bullet_slide(self, slide_data: Any):
        """Add slide with bullet points"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        bullets = content.get("bullets", [])

        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        # Bullets
        self._add_bullets(slide, bullets, Inches(1.3), Inches(5.7))

    def _add_bullets(
        self, slide, bullets: list, top: Inches, height: Inches
    ):
        """Add bullet points to a slide"""
        bullet_layout = self._layout(
            "bullets",
            {"x": 0.5, "y": top.inches, "w": 12.333, "h": height.inches, "fontSize": 20},
        )
        bullet_box = self._add_layout_textbox(slide, bullet_layout)
        tf = bullet_box.text_frame
        tf.word_wrap = True

        for i, bullet in enumerate(bullets):
            if isinstance(bullet, dict):
                text = bullet.get("text", str(bullet))
                level = bullet.get("level", 0)
            else:
                text = str(bullet)
                level = 0

            if i == 0:
                p = tf.paragraphs[0]
            else:
                p = tf.add_paragraph()

            p.text = f"• {text}"
            self._style_paragraph(p, bullet_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(p, bullet_layout.get("align"))
            p.level = level
            p.space_before = Pt(12)

    def _add_two_column_slide(self, slide_data: Any):
        """Add two-column slide"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        bullets = content.get("bullets", [])

        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        # Split bullets into two columns
        mid = len(bullets) // 2
        left_bullets = bullets[:mid] if mid > 0 else bullets
        right_bullets = bullets[mid:] if mid > 0 else []

        # Left column
        if left_bullets:
            left_box = slide.shapes.add_textbox(
                Inches(0.5), Inches(1.3), Inches(5.9), Inches(5.7)
            )
            tf = left_box.text_frame
            tf.word_wrap = True
            for i, bullet in enumerate(left_bullets):
                text = bullet.get("text", str(bullet)) if isinstance(bullet, dict) else str(bullet)
                if i == 0:
                    p = tf.paragraphs[0]
                else:
                    p = tf.add_paragraph()
                p.text = f"• {text}"
                self._style_paragraph(p, 18, self.tokens["body_font"])
                p.space_before = Pt(10)

        # Right column
        if right_bullets:
            right_box = slide.shapes.add_textbox(
                Inches(6.9), Inches(1.3), Inches(5.9), Inches(5.7)
            )
            tf = right_box.text_frame
            tf.word_wrap = True
            for i, bullet in enumerate(right_bullets):
                text = bullet.get("text", str(bullet)) if isinstance(bullet, dict) else str(bullet)
                if i == 0:
                    p = tf.paragraphs[0]
                else:
                    p = tf.add_paragraph()
                p.text = f"• {text}"
                self._style_paragraph(p, 18, self.tokens["body_font"])
                p.space_before = Pt(10)

    def _add_quote_slide(self, slide_data: Any):
        """Add quote slide"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        quote_text = content.get("body", content.get("heading", ""))
        
        # Quote text
        body_layout = self._layout("body", {"x": 1.5, "y": 2.5, "w": 10.333, "h": 2, "fontSize": 32})
        quote_box = self._add_layout_textbox(slide, body_layout)
        tf = quote_box.text_frame
        tf.word_wrap = True
        tf.paragraphs[0].text = f'"{quote_text}"'
        self._style_paragraph(tf.paragraphs[0], body_layout["fontSize"], self.tokens["body_font"], italic=True)
        self._apply_alignment(tf.paragraphs[0], body_layout.get("align"))
        if "align" not in body_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER

    def _add_section_header_slide(self, slide_data: Any):
        """Add section header slide"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")

        # Large centered title
        title_layout = self._layout("title", {"x": 0.5, "y": 3, "w": 12.333, "h": 1.5, "fontSize": 48})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        if "align" not in title_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
