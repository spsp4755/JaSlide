# ZIP HTML Template Import Design

## Goal

Allow an administrator to register a Genspark-style HTML deck ZIP as a JaSlide template so its HTML layouts and bundled files can be reused when generating presentations.

## Supported archive

The importer accepts a ZIP up to 20 MB containing exactly one `manifest.json` below a `deck/` directory. The manifest must declare `format: "html"` and a non-empty `playlist` of relative `.html` filenames. Each playlist entry must resolve inside the archive beside the manifest. Any preview, thumbnail, image, stylesheet, or font file in the archive is retained with the original ZIP.

The supplied example is supported: `deck/<name>.slides/manifest.json` plus `slides/*.html`.

## Import and storage

The API validates filenames before parsing, rejects malformed archives and ZIP traversal paths, then stores the original ZIP through the existing `StorageService`. No extraction is written to the application filesystem. The existing `Template` row is used without a schema migration:

- `thumbnail` contains the first preview or thumbnail image when present.
- `config.htmlTemplate` contains the first playlist HTML so the existing PPTX generator can use it immediately.
- `config.zipTemplate` records the stored archive key, manifest path, canvas dimensions, and ordered slide entries. This retains every HTML slide and the relationship to its bundled assets for later selection.

## Admin UI

The Templates page receives a second import action, “Import HTML ZIP”. Its modal takes a name, optional description, category, and `.zip` file. On success it refreshes the existing template list. PPTX import remains unchanged.

## Boundaries

This increment does not execute uploaded HTML in the browser, transform all 22 source slides into a generated deck, or expose individual ZIP slides in the editor. It safely registers every source file and makes the first HTML layout immediately available through the existing template pipeline. Individual-layout selection can be added once the generation contract accepts a layout identifier.

## Verification

Unit tests cover accepted Genspark-style manifests, rejected traversal or missing playlist entries, and the persisted configuration and archive upload. The existing API test suite and web build must pass.
