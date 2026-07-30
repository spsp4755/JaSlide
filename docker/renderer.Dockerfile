FROM mcr.microsoft.com/playwright/python:v1.61.0-noble@sha256:80fd7c1aad9600ea348572dd46ca00b9ea31d890831f5838fc61319ab79900d2 AS playwright

FROM python:3.11.15-slim-bookworm@sha256:b18992999dbe963a45a8a4da40ac2b1975be1a776d939d098c647482bcad5cba

ARG DEBIAN_SNAPSHOT=20250721T000000Z
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

# Freeze APT resolution to an immutable Debian snapshot.
RUN printf '%s\n' \
      'Types: deb' \
      "URIs: https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}" \
      'Suites: bookworm bookworm-updates' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      '' \
      'Types: deb' \
      "URIs: https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}" \
      'Suites: bookworm-security' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' 'Acquire::Check-Valid-Until "false";' \
      > /etc/apt/apt.conf.d/99snapshot \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      libreoffice-impress \
      fonts-nanum \
      fonts-noto-cjk \
      poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY apps/renderer/requirements.lock /tmp/requirements.lock
RUN pip install --disable-pip-version-check --no-cache-dir \
      --require-hashes --requirement /tmp/requirements.lock \
    && python -m playwright install-deps chromium \
    && pip check \
    && rm -rf /var/lib/apt/lists/*

# Browser bytes and revision come from a platform-specific image digest.
COPY --from=playwright /ms-playwright/chromium-1228 /ms-playwright/chromium-1228
COPY --from=playwright /ms-playwright/chromium_headless_shell-1228 /ms-playwright/chromium_headless_shell-1228
COPY --from=playwright /ms-playwright/ffmpeg-1011 /ms-playwright/ffmpeg-1011

RUN printf '%s\n' \
      '<fontconfig><alias><family>Noto Sans KR</family><prefer><family>Noto Sans CJK KR</family></prefer></alias></fontconfig>' \
      > /etc/fonts/local.conf \
    && fc-cache -f \
    && test -x /ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell

# Fonts installed from the repo's fonts/ directory by scripts/install-fonts.mjs.
COPY docker/fonts/ /usr/share/fonts/truetype/jaslide/
RUN fc-cache -f

COPY apps/renderer ./apps/renderer
WORKDIR /app/apps/renderer

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
