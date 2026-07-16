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
from io import BytesIO
from typing import Optional, Any
from PIL import Image
from ..services.html_template import parse_html_layout


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
        self.tokens = self._resolve_tokens(template_config)
        config = self._as_dict(getattr(template_config, "config", template_config))
        self.html_layout = parse_html_layout(config.get("htmlTemplate", ""))
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
            "background": self._rgb(colors.get("background"), self.DEFAULT_COLORS["background"]),
            "text": self._rgb(colors.get("text"), self.DEFAULT_COLORS["text"]),
            "title_font": typography.get("titleFont") or self.DEFAULT_FONT,
            "body_font": typography.get("bodyFont") or self.DEFAULT_FONT,
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

    def generate(self, presentation: Any) -> bytes:
        """Generate PPTX from presentation data"""
        for slide_data in presentation.slides:
            self._add_slide(slide_data)

        # Save to buffer
        buffer = BytesIO()
        self.prs.save(buffer)
        buffer.seek(0)
        return buffer.read()

    def generate_preview(self, presentation: Any, slide_index: int = 0) -> bytes:
        """Generate preview image for a specific slide"""
        # Generate PPTX first
        self.generate(presentation)

        # For now, return a placeholder image
        # In production, use LibreOffice or similar to render actual slide
        img = Image.new("RGB", (1920, 1080), color=(245, 245, 245))
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)
        return buffer.read()

    def _add_slide(self, slide_data: Any):
        """Add a slide based on its type"""
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
        title_box = slide.shapes.add_textbox(
            Inches(0.5), Inches(0.3), Inches(12.333), Inches(0.8)
        )
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], 36, self.tokens["title_font"], bold=True)

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
        title_box = slide.shapes.add_textbox(
            Inches(0.5), Inches(0.3), Inches(12.333), Inches(0.8)
        )
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], 36, self.tokens["title_font"], bold=True)

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
        quote_box = slide.shapes.add_textbox(
            Inches(1.5), Inches(2.5), Inches(10.333), Inches(2)
        )
        tf = quote_box.text_frame
        tf.word_wrap = True
        tf.paragraphs[0].text = f'"{quote_text}"'
        self._style_paragraph(tf.paragraphs[0], 32, self.tokens["body_font"], italic=True)
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER

    def _add_section_header_slide(self, slide_data: Any):
        """Add section header slide"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")

        # Large centered title
        title_box = slide.shapes.add_textbox(
            Inches(0.5), Inches(3), Inches(12.333), Inches(1.5)
        )
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], 48, self.tokens["title_font"], bold=True)
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER
