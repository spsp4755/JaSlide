FROM python:3.11.15-slim-bookworm@sha256:b18992999dbe963a45a8a4da40ac2b1975be1a776d939d098c647482bcad5cba

WORKDIR /app

# Install LibreOffice and Korean Noto fonts for PDF conversion.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    fonts-nanum \
    fonts-noto-cjk \
    poppler-utils \
    && printf '%s\n' \
      '<fontconfig><alias><family>Noto Sans KR</family><prefer><family>Noto Sans CJK KR</family></prefer></alias></fontconfig>' \
      > /etc/fonts/local.conf \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Fonts installed from the repo's fonts/ directory by scripts/install-fonts.mjs.
# The same files reach the browser as WOFF2, so the editing canvas and the
# rendered deck draw identical glyphs — the point of shipping them at all.
# Empty on a clean checkout, which is why the directory is created first.
COPY docker/fonts/ /usr/share/fonts/truetype/jaslide/
RUN fc-cache -f

# Copy renderer app
COPY apps/renderer ./apps/renderer

WORKDIR /app/apps/renderer

# Install Python dependencies
RUN pip install --no-cache-dir .

# Chromium is the render engine for uploaded HTML templates.
RUN python -m playwright install --with-deps chromium

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
