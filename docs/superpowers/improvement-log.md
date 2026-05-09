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

**Commit**: c4b940b4

### Iteration 2 — 2885 Demo project (v1.4 image-heavy, transparency)

**Iter-1 baseline** (run 2026-05-09_1352-ed55cea0): 25/106 pages passing. 2885 Demo project: avg 22.34%, worst page 9 = 98.05%, page 0 = 96.47%.

**Investigation findings**:
- Target pages: 9 (98.05%) and 0 (96.47%).
- Visual symptom: large background photograph on each page is rendered fully opaque/saturated, but the reference shows it semi-transparent (washed-out, faded). On page 0, an additional decorative diamond/hexagon shape is painted opaque white where it should be translucent.
- Resource inventory (pikepdf): both pages use a single Form XObject (X12/X15) with `/Group /S /Transparency`. Inside that form, the image-bearing inner Form XObjects are invoked under `/G6 gs` (`/ca` = 0.32 on p9, 0.61 on p0) and `/G9 gs` (`/ca` = 0.65) ExtGState entries — these are constant-alpha values for non-stroking ops. The inner forms also have transparency groups and use `/G3 gs` (`/ca` = 1) internally.
- Root cause: the `gs` operator (set-graphics-state-from-ExtGState-name) was a no-op in `Interpreter::execute_internal` (`interpreter.rs:306`). `/ca` and `/CA` were never read, so every fill/image painted at 100% opacity. Additionally, PDF transparency-group Form XObjects require the *parent* alpha to wrap the entire group as if compositing — the inner form's own `/G3 gs` (ca=1) must not erase the parent's accumulated 0.32.

**Fix**:
- `open-pdf-render/src/graphics_state.rs`: added `fill_alpha`, `stroke_alpha`, `group_fill_alpha`, `group_stroke_alpha` fields (defaults 1.0) and `effective_fill_alpha`/`effective_stroke_alpha` accessors that return the product. The save/restore via `q`/`Q` already covers them through `Clone`.
- `open-pdf-render/src/interpreter.rs`: implemented the `gs` operator (`apply_ext_gstate`) — looks up the named ExtGState in resources and reads `/ca` → `fill_alpha`, `/CA` → `stroke_alpha`. In `handle_do_execute`, when entering a Form XObject whose `/Group /S` is `/Transparency`, the parent's `fill_alpha`/`stroke_alpha` are folded into the group multipliers and the in-group alphas reset to 1.0 — this approximates PDF transparency-group compositing without needing an off-screen pixmap.
- `open-pdf-render/src/renderer.rs`: `fill`, `stroke`, `fill_and_stroke`, and `draw_image` now multiply `effective_fill_alpha()` / `effective_stroke_alpha()` into the paint alpha / `PixmapPaint::opacity`.

**Verification**:
- 2885 Demo project page 9: 98.05% → 4.26% (-93.79%).
- 2885 Demo project page 0: 96.47% → 10.60% (-85.87%); diamond shape still opaque (a deeper transparency-group-on-image-paths case for next iteration).
- 2885 Demo project page 1: 5.98% → 0.41% (now PASS).
- 2885 Demo project avg: 22.34% → 9.11% (-13.23%).
- 2885 Demo project worst: 98.05% → 41.76%.
- Full-suite avg: 8.78% → 7.03%.
- Full-suite passing: 25/106 → 26/106.
- Other PDFs delta: no page changed by > 1pp aside from the three 2885 wins above. No regressions.

**Total passing**: 25/106 → 26/106

**Commit**: b93814d6

### Iteration 3 — Image /SMask soft alpha (rapport-constructie / Text pdf gecombineerd p0 + p27)

**Iter-2 baseline** (run 2026-05-09_1413-e3f5e26b): 26/106 passing. Top remaining failures: rapport-constructie p27 = 61.84%, p0 = 50.47% (both also present in identical-failures Text pdf gecombineerd).

**Investigation findings**:
- Resources on rapport-constructie p0: a single Image XObject `/Image9` 1653×2338, DeviceRGB, FlateDecode, with `/SMask` → DeviceGray 8 bpc FlateDecode 1653×2338 (`/Matte [0 0 0]`). Page content stream: header artifacts + a single `/Image9 Do`. Page 27 is the same shape with `/Image175` (also has SMask).
- Visual symptom: the regions of the image that should be transparent (revealing the white page) were rendered as a giant solid black rectangle. Opaque parts of the image (logo, blue title block, colored shape clusters) rendered correctly. Looked exactly like the SMask was being thrown away and the black /Matte pre-multiplied colour was bleeding through.
- Root cause: `Interpreter::decode_raw_image` (server-side render path used by the harness) and `Interpreter::handle_image_xobject` (browser-side draw-command path) both built RGBA buffers with the alpha byte hard-coded to `255`. The image dictionary's `/SMask` entry was never resolved or read, so the per-pixel soft alpha was discarded. Tiny-skia's pixmap loader requires premultiplied RGBA, so any future alpha < 255 also needs the colour channels premultiplied.

**Fix** — `open-pdf-render/src/interpreter.rs`:
- `decode_raw_image` (server-side): resolve `/SMask` (Stream or Reference→Stream), confirm Width/Height match the parent image (skip otherwise — resampling is a future improvement), call `decompress_image_stream` to recover the alpha bytes, then plug those bytes into the per-pixel RGBA `a` slot. Premultiply R/G/B by `a` because `tiny_skia::PixmapRef::from_bytes` requires premultiplied input. CMYK and grayscale paths also premultiply.
- `handle_image_xobject` (browser-side): same SMask resolution + premultiplied RGBA emission, so the JS `vector-renderer` path matches the server.
- `/Matte` un-matting deliberately skipped this iteration — the silhouette alone fixes the visible black-rectangle artefact; un-matting is a refinement for sub-pixel mask edges.

**Verification** (run 2026-05-09_1422-e3f5e26b vs iter-2 baseline):
- Text pdf gecombineerd p27: 61.84% → 0.55% (FAIL → PASS) — -61.29pp.
- rapport-constructie p27: 61.84% → 0.55% (FAIL → PASS) — -61.29pp.
- Text pdf gecombineerd p0: 50.47% → 1.21% (FAIL → PASS) — -49.26pp.
- rapport-constructie p0: 50.47% → 1.21% (FAIL → PASS) — -49.26pp.
- Bonus wins (other PDFs with SMask images):
  - 2885 Demo project p7: 41.76% → 8.27% (-33.49pp).
  - 2885 Demo project p3: 12.10% → 2.44% (-9.65pp).
  - 2885 Demo project p9: 4.26% → 1.08% (FAIL → PASS).
- Zero regressions — no page worsened by more than 0.1pp.
- Visual confirmation: cover page now matches reference with correct transparency around the logo and shapes; previously transparent regions are white, not black.

**Total passing**: 26/106 → 31/106 (+5)

**Commit**: <pending>
