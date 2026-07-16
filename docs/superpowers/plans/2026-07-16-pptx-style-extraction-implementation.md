# PPTX Style Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Extract reusable colors and Korean-safe fonts from an example PPTX.

**Architecture:** A small renderer-side pure function scans python-pptx slides and returns the existing template token shape; upload/API wiring follows separately.

**Tech Stack:** Python 3.10, python-pptx, pytest.

## Global Constraints

- Extract no slide text, notes, images, or user content.
- Return only colors and typography tokens; missing values use renderer defaults.
- Korean font extraction must prefer the East Asian typeface.

---

### Task 1: Extract template tokens from a PPTX

**Files:**
- Create: `apps/renderer/src/services/style_extractor.py`
- Create: `apps/renderer/tests/test_style_extractor.py`

- [ ] Write a failing pytest fixture with Korean text, custom East Asian font, colored background, and shape fill.
- [ ] Run focused pytest and verify the missing extractor failure.
- [ ] Implement `extract_template_tokens(pptx_bytes: bytes) -> dict` to choose deterministic frequent solid colors and fonts, returning only `colors`/`typography` allowed keys.
- [ ] Re-run focused and full renderer tests; commit only extractor files.
