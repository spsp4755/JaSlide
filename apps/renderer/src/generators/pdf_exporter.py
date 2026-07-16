"""
PDF Exporter - Converts PPTX to PDF
"""

import subprocess
import tempfile
import os


class PDFExporter:
    """Export presentations to PDF format"""

    def convert_pptx_to_pdf(self, pptx_buffer: bytes) -> bytes:
        """
        Convert PPTX buffer to PDF buffer.
        
        Uses LibreOffice. A PDF export must never report success with a
        placeholder document when conversion is unavailable.
        """
        try:
            return self._convert_with_libreoffice(pptx_buffer)
        except FileNotFoundError as error:
            raise RuntimeError("LibreOffice is required for PDF export") from error
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("LibreOffice conversion timed out") from error

    def _convert_with_libreoffice(self, pptx_buffer: bytes) -> bytes:
        """Use LibreOffice to convert PPTX to PDF"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Save PPTX to temp file
            pptx_path = os.path.join(tmpdir, "presentation.pptx")
            with open(pptx_path, "wb") as f:
                f.write(pptx_buffer)

            # Convert using LibreOffice
            result = subprocess.run(
                [
                    "libreoffice",
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmpdir,
                    pptx_path,
                ],
                capture_output=True,
                timeout=60,
            )

            if result.returncode != 0:
                raise RuntimeError(f"LibreOffice conversion failed: {result.stderr}")

            # Read PDF
            pdf_path = os.path.join(tmpdir, "presentation.pdf")
            with open(pdf_path, "rb") as f:
                return f.read()
