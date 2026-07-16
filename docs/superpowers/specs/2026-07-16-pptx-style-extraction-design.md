# Example PPTX style extraction MVP

## Goal

Let an administrator upload a representative PPTX and derive a reusable JaSlide template so generated decks follow its colors and typography.

## Scope

The extractor reads the supplied PPTX with `python-pptx`, scans all slide shapes, and returns a deterministic token object: `colors.primary`, `colors.background`, `colors.text`, and `typography.headingFont`, `typography.bodyFont`. It chooses the most frequent solid-fill color and text font values, ignoring empty and unsupported shapes. No slide content, images, or notes are copied or retained.

The result is compatible with the existing renderer `TemplateConfig`; an admin can save it as a template configuration through the existing template API in the next wiring slice. This first slice is a pure extractor with fixture-based tests.

## Safety and quality

Only `.pptx` input is accepted by the future upload endpoint. Extraction has a size limit at the upload boundary and runs in the renderer service. When a font or color is absent, it returns no value so the renderer's safe defaults apply. Tests build a small PPTX fixture with Korean text, custom fonts, a colored background, and assert extracted tokens.
