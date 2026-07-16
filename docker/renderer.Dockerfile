FROM python:3.11-slim

WORKDIR /app

# Install LibreOffice and Korean Noto fonts for PDF conversion.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    fonts-noto-cjk \
    && printf '%s\n' \
      '<fontconfig><alias><family>Noto Sans KR</family><prefer><family>Noto Sans CJK KR</family></prefer></alias></fontconfig>' \
      > /etc/fonts/local.conf \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Copy renderer app
COPY apps/renderer ./apps/renderer

WORKDIR /app/apps/renderer

# Install Python dependencies
RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
