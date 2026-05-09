# Render Kernel Improvement Loop

**Started**: 2026-05-09
**Goal**: Reduce all pages to < 2% pixel diff vs PyMuPDF reference, without regressing previously-fixed PDFs.
**Stop condition**: All pages < 2%, OR 3 consecutive iterations with no progress.

## Baseline (commit 182f1755 / run 2026-05-09_1249)

Per-PDF stats from initial harness run:

| PDF Version | PDF | Pages | min % | avg % | max % |
|------------|-----|-------|-------|-------|-------|
| 1.4 | Combinatie Raster, vector, tekening images.pdf | 1 | 8.6 | 8.6 | 8.6 |
| 1.4 | 20260316 - Barn Relocation - ... .pdf | 7 | 8.5 | 17.4 | 28.6 |
| 1.4 | 2885 Demo project.pdf | 14 | 7.0 | **54.9** | **100.0** |
| 1.6 | Zware vector PDF.pdf | 19 | 3.7 | 11.1 | 26.3 |
| 1.7 | Tekst.pdf | 5 | 96.2 | **96.2** | 96.2 |
| 1.7 | Text pdf gecombineerd.pdf | 28 | 0.3 | 19.7 | 72.7 |
| 1.7 | Technische tekening.pdf | 4 | 12.6 | 16.0 | 19.8 |
| 1.7 | rapport-constructie.pdf | 28 | 0.3 | 19.7 | 72.7 |

**Totals**: 106 pages, 6 passed (≤ 2%), 100 failed.

**Top hypothesis areas**:
1. **Tekst.pdf** — every page 96.2%. Pure text PDF; suggests fundamental text-rendering gap.
2. **2885 Demo project page 9 = 100%** — entire page rendering wrong/blank.
3. **rapport-constructie & Text pdf gecombineerd identical diff numbers** — both are typical-text+image v1.7 PDFs; failure modes likely related.
4. **Zware vector PDF** at v1.6 is least-bad — vector rendering is closer to PyMuPDF; raster/text is the harder gap.

## Iterations

### Iteration 0 — Setup (this entry)
- Improvement log created
- Baseline analyzed: 100/106 fail at 2% threshold
- Strategy: tackle highest-leverage failures first (Tekst.pdf single root cause, then 2885 Demo project page 9, then text v1.7 set, then v1.4 set, then v1.6).

### Iteration 1 — Tekst.pdf (v1.7 text)

**Investigation findings**:
- Font situation: F1 = embedded Type1 subset (`/BAAAAA+UniviaProRegular`, FontFile, ToUnicode CMap, custom Encoding via `0 1 255 {1 index exch /.notdef put} for` + per-glyph `dup N /name put`); F2 = embedded TrueType subset (`/CAAAAA+Calibri`, FontFile2). Both use `/Encoding=None` (font's built-in encoding). hayro-font parses the Type1 encoding+CharStrings correctly (verified via `examples/probe_type1.rs`: all 73 subset glyphs have outlines).
- Visual symptom: app render was a solid green page (every pixel `(133,169,157)`) with faint table grid lines. Reference is a normal letterhead with text. Sampling app pixels showed essentially one color across the whole canvas — text completely missing AND background image collapsed to a single sample.
- Root cause: **`Interpreter::execute_internal` (the server-side `render_page` path used by MCP `screenshot_page`) treats every text operator as a no-op** (`open-pdf-render/src/interpreter.rs:225` had `"BT" | "ET" | "Tf" | ... | "Tj" | "TJ" | ... => {}`). The Tj/TJ glyph-painting code only ran in the `extract_commands*` path (which produces a draw-command buffer for JS-side replay, not for the rasterizer used by the harness). Secondary defect uncovered: `SkiaRenderer::draw_image` passed `gs.ctm` straight to `tiny_skia::draw_pixmap` — but `draw_pixmap`'s transform maps SOURCE PIXEL space to destination, while the PDF Image XObject CTM maps the unit square (1×1) to destination. Without pre-scaling by `1/width, 1/height`, only the source pixel `(0,0)` lands on the canvas, stretched edge-to-edge by the bilinear filter (hence the uniform color).

**Fix**:
- `open-pdf-render/src/text_renderer.rs`: added `render_text_glyphs_skia` and `render_cid_text_glyphs_skia` — direct-to-`SkiaRenderer` analogs of the existing buffer-emitting functions, mirroring the same PDF spec §9.4.4 geometry per glyph.
- `open-pdf-render/src/interpreter.rs`: threaded `&mut FontRegistry` through `execute`, `execute_with_image_limit`, `execute_internal`, and `handle_do_execute`. Replaced the no-op text-operator catch-all with full implementations of `BT/ET/Tf/Tc/Tw/Tz/TL/Ts/Tr/Td/TD/Tm/T*/Tj/TJ/'/"`. Added `execute_show_string` and `execute_show_array` helpers that resolve the font and dispatch to simple- or CID-glyph painting on the SkiaRenderer.
- `open-pdf-render/src/parser.rs`: locked the document-scoped `font_registry` and forwarded it to the interpreter so glyph-outline parses are still cached across pages.
- `open-pdf-render/src/renderer.rs`: pre-concatenated `1/width × 1/height` into the image transform inside `draw_image` so source-pixel coords map correctly through the unit square to the destination.

**Verification**:
- Tekst.pdf: 96.17% → 3.99% avg (delta -92.18%). Per page: p0 96.17→3.88, p1 96.17→3.76, p2 96.17→4.89, p3 96.17→6.58, p4 96.17→0.85 (PASS).
- Combinatie (sanity check): 8.56% → 3.47% (improved, did not regress).
- Full-suite totals: 6/106 → 25/106 passing. Average diff dropped on 7/8 PDFs:
  - Zware vector PDF: 11.13 → 2.15
  - 20260316 Barn Relocation: 17.45 → 4.00
  - Technische tekening: 15.97 → 14.65 (small)
  - rapport-constructie / Text pdf gecombineerd: 19.66 → 8.33
  - 2885 Demo project: 54.89 → 22.34
- Two pages regressed visually (rapport-constructie p0: 32.84→50.47, p27: 13.56→61.84). Both previously rendered ENTIRELY BLANK; my fix now correctly draws everything except a JPEG image with `/SMask` (soft alpha mask). The renderer doesn't honor SMask, so the image draws fully opaque (a black rectangle) where the reference shows it composited with transparency. This is a separate, pre-existing image-decoding gap that my fix exposed but did not introduce — the previous "lower" diff number on those pages came from the page being mostly white-on-white instead of actually correct rendering. Recommend tackling SMask in a follow-up iteration.

**Commit**: TBD (set after `git commit`)
