"""
JaSlide Renderer - PPTX/PDF generation service
"""

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Any
import io

from .generators.pptx_generator import PPTXGenerator
from .generators.pdf_exporter import PDFExporter
from .services.style_extractor import extract_template_tokens

app = FastAPI(
    title="JaSlide Renderer",
    description="PPTX/PDF rendering service",
    version="0.1.0",
)


class SlideContent(BaseModel):
    heading: Optional[str] = None
    subheading: Optional[str] = None
    body: Optional[str] = None
    bullets: Optional[List[dict]] = None
    image: Optional[dict] = None
    chart: Optional[dict] = None


class Slide(BaseModel):
    id: str
    order: int
    type: str
    title: Optional[str] = None
    content: dict
    layout: str = "center"
    notes: Optional[str] = None


class TemplateConfig(BaseModel):
    colors: Optional[dict] = None
    typography: Optional[dict] = None
    layouts: Optional[dict] = None
    backgrounds: Optional[dict] = None


class Template(BaseModel):
    id: str
    name: str
    config: Optional[TemplateConfig] = None


class Presentation(BaseModel):
    id: str
    title: str
    slides: List[Slide]
    template: Optional[Template] = None


class RenderRequest(BaseModel):
    presentation: Presentation


class PreviewRequest(BaseModel):
    presentation: Presentation
    slideIndex: int = 0


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "jaslide-renderer"}


@app.post("/api/extract/style")
async def extract_style(file: UploadFile = File(...)):
    if (
        not (file.filename or "").lower().endswith(".pptx")
        or file.content_type
        != "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ):
        raise HTTPException(status_code=400, detail="PPTX file required")
    try:
        config = extract_template_tokens(await file.read())
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid PPTX file") from error
    return {"config": config}


@app.post("/api/render/pptx")
async def render_pptx(request: RenderRequest):
    """Generate PPTX file from presentation data"""
    try:
        generator = PPTXGenerator(template_config=request.presentation.template)
        pptx_buffer = generator.generate(request.presentation)

        return StreamingResponse(
            io.BytesIO(pptx_buffer),
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={
                "Content-Disposition": f'attachment; filename="{request.presentation.title}.pptx"'
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/render/pdf")
async def render_pdf(request: RenderRequest):
    """Generate PDF file from presentation data"""
    try:
        # First generate PPTX, then convert to PDF
        generator = PPTXGenerator(template_config=request.presentation.template)
        pptx_buffer = generator.generate(request.presentation)

        exporter = PDFExporter()
        pdf_buffer = exporter.convert_pptx_to_pdf(pptx_buffer)

        return StreamingResponse(
            io.BytesIO(pdf_buffer),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{request.presentation.title}.pdf"'
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/render/preview")
async def render_preview(request: PreviewRequest):
    """Generate preview image for a specific slide"""
    try:
        generator = PPTXGenerator(template_config=request.presentation.template)
        preview_buffer = generator.generate_preview(
            request.presentation, request.slideIndex
        )

        return StreamingResponse(
            io.BytesIO(preview_buffer),
            media_type="image/png",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
