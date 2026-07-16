# PPTX Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Apply template colors and Korean-safe typography to every generated PPTX slide.

**Architecture:** `PPTXGenerator` resolves a small token dictionary once and uses it in its existing shape creation methods. No HTML renderer is introduced in this slice.

**Tech Stack:** Python 3.10, python-pptx, pytest.

## Global Constraints

- Default font is `Noto Sans KR`.
- Template RGB input accepts six hex digits; invalid input uses defaults.
- All generated text runs get configured font and color.

---

### Task 1: Apply template tokens in the PPTX generator

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Create: `apps/renderer/tests/test_pptx_generator.py`

- [ ] Write failing pytest cases that generate Korean title/content slides and inspect the resulting runs/background.
- [ ] Run `python -m pytest apps/renderer/tests/test_pptx_generator.py` and verify failure.
- [ ] Add default token resolution, validated RGB conversion, slide background fill, and shared text styling for title/subtitle/body/bullets/quotes.
- [ ] Re-run focused pytest and renderer test suite; commit only renderer files.
