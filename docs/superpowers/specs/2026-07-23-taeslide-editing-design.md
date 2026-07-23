# TaeSlide Brand and Object Editing Design

## Goal

Rename the product to **TaeSlide** and add a first-phase, offline-capable slide editor for text and shape objects.

## Scope

- Replace user-facing JaSlide product naming with TaeSlide, using `TaeSlide` in Latin text and `TaeSlide AI 슬라이드` where the product is described.
- On HTML-template slides, allow users to select a `data-object="true"` text or shape object and edit its position, size, text, font family, font size, color, background, border, alignment, and visibility.
- Allow adding and deleting text boxes and rectangle shapes.
- Preserve the edited HTML in `Slide.content.html`; the existing Chromium renderer remains the source for preview, PDF, and image-per-slide PPTX export.
- Keep existing structured-slide editing available as a legacy fallback. First phase does not add table-cell, chart-data, image-cropping, grouping, animation, or native editable-PPTX support.

## Architecture

The browser editor keeps the existing HTML DOM as the slide object model. Every editable object has a stable `data-object-id`; user actions modify only that object’s inline CSS and text content through the existing HTML mutation path, then persist the resulting `content.html` via the current slide update API. The renderer receives the same HTML, so no cloud service, Keynote installation, or external API is involved.

The property panel becomes a typed inspector for one selected HTML object. It exposes controls grouped as Text, Fill, Border, and Geometry, with Add text/Add shape and Delete actions in the editor toolbar. The data attributes and CSS are intentionally generic so later work can add image, table, chart, and group object adapters without changing saved slides.

## Offline Constraints

- Reuse installed React, Tailwind, Lucide, Chromium Playwright renderer, and PPTX export path.
- Do not add a CDN, hosted font, Keynote, or external editor dependency.
- Fonts are entered as CSS font-family values and use fonts installed in the closed-network renderer/client environment.

## Validation

- Add source tests for TaeSlide naming and the HTML object-style mutation contract.
- Run web tests, production build, and local Docker deployment.
- Verify in the browser that an object style change is visible immediately, remains after reload, and is included in the existing renderer preview/export path.
