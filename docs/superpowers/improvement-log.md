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

**Commit**: a21a869e

### Iteration 4 — `w 0` zero-width strokes (Technische tekening v1.7 engineering drawings)

**Iter-3 baseline** (run 2026-05-09_1429-a25d336e): 31/106 passing. Technische tekening 0/4 pass with avg 14.65% (p0 12.82, p1 18.42, p2 15.90, p3 11.48). Iter-1, -2, -3 barely moved this PDF (15.97 → 14.65 across 3 iterations).

**Investigation findings**:
- Resource inventory (pikepdf): all 4 pages are A1 landscape (`/MediaBox [0 0 1684 2384]` plus `/Rotate 90`); single `/GT255` ExtGState with `/ca=1, /CA=1` (no transparency); fonts are `/Type0 /Identity-H` with `/CIDFontType2` descendants pointing at embedded ArialMT/Arial-Bold/Arial-Black/ArialNova-Light TrueType subsets. No images, no shadings, no patterns. Just heavy linework.
- Content-stream operator profile (PyMuPDF `read_contents`): on page 0, `l` (line-to) 2424×, `m` (move-to) 2155×, `w` (set-width) 1857×, `S` (stroke) 1692×, `c` (curve) 472×, `b` (close+fill+stroke) 243×, `j`/`M` 229×/225×. Pages 1-3 are similar but heavier (4898/3943/2303 `w` ops).
- **Critical**: regex `(\\d+\\.?\\d*)\\s+w` extraction shows **every single `w` operator across all 4 pages uses width 0** (page 0: 1857/1857 = 100%; pages 1-3: same 100%). This is an AutoCAD-exported PDF — AutoCAD writes `0 w` for "thinnest line" per PDF spec §8.4.3.2.
- Visual symptom: app render shows the floor-plan heating coils as bold, fully-opaque colored polylines (red/green/blue zigzags), text labels are missing or buried, dark-pixel count is 2.0-2.8× the reference. Reference render shows the same coils as faint, almost ghostly thin lines, with text labels clearly readable above the floor plan.
- Root cause: `tiny_skia::Stroke::width = 0.0` triggers `treat_as_hairline` → returns `Some(1.0)` (full-coverage 1-pixel hairline) per `painter.rs:553`. PyMuPDF/MuPDF render the same width-0 strokes as faint sub-pixel hairlines (per the spec's note that on high-resolution devices, width-0 lines are "nearly invisible"). The 1.0-coverage hairline is 2-3× heavier than the reference.

**Fix** — `open-pdf-render/src/renderer.rs`:
- New helper `SkiaRenderer::resolve_stroke_width(gs)` that returns `gs.line_width` unchanged when positive, but for `gs.line_width == 0.0` substitutes a tiny user-space width such that the device-space width (after CTM) is `~0.2 px`. Calculation: extract dominant CTM scale via `sqrt(sx*sx + kx*kx) * sqrt(ky*ky + sy*sy)` geometric mean (rotation-invariant), then return `0.2 / scale`. After CTM applies, tiny_skia's `treat_as_hairline` returns `~0.2` coverage — a low-opacity 1px hairline that visually matches the reference.
- `stroke()` and `fill_and_stroke()` both call the new helper. `fill_and_stroke()` previously also dropped `line_cap`/`line_join`/`miter_limit`/`dash_array` on the floor — fixed those at the same time.
- Knob-tuning sweep: tried `0.5/0.4/0.3/0.25/0.2/0.18` device pixels. `0.2` is the sweet spot (3 of 4 pages PASS; lower values lose stroke detail, higher leaves them too dark).

**Verification** (run 2026-05-09_1505-a25d336e vs iter-3 baseline):
- Technische tekening per-page:
  - p0: 12.82% → **1.95% (PASS)** — -10.87pp
  - p1: 18.42% → 2.89% (FAIL but very close) — -15.53pp
  - p2: 15.90% → **0.76% (PASS)** — -15.14pp
  - p3: 11.48% → **1.03% (PASS)** — -10.45pp
  - avg: 14.65% → 1.66% — **-12.99pp**
- Bounded blast radius: only 1 of 8 PDFs (Text pdf gecombineerd) has any `w 0` operators (1 of 16, 6%); the other 6 PDFs have zero `w 0`. Confirmed by re-running the full suite — every page outside Technische tekening has the EXACT same diff% as the iter-3 baseline (`Text pdf gecombineerd: 7/28 4.39%`, `rapport-constructie: 7/28 4.39%`, `2885 Demo project: 2/14 5.80%`, `Zware vector PDF: 12/19 2.15%`, `Barn Relocation: 2/7 4.00%`, `Tekst.pdf: 1/5 3.99%`, `Combinatie: 0/1 3.47%` — all unchanged). Zero regressions.
- Total passing: 31/106 → **34/106 (+3)**.

**Commit**: ac39648e

### Iteration 5 — In-flight scale-convention fix verified by rebuild (no NEW code change)

**Iter-4 baseline** (per improvement-log): 34/106 passing. Cluster Text pdf gecombineerd / rapport-constructie: 7/28 each, avg 4.39%, worst page p8 = 9.0%.

**Investigation findings**:
- pikepdf inspection of Text pdf gecombineerd p8: standard A4 portrait (595.32×841.92), Rotate=0, fonts F1=Calibri-Light embedded TrueType subset, F2=Arial-BoldMT non-embedded, F3=ArialMT non-embedded, F4=SymbolMT, F5=Calibri-LightItalic embedded, F6=Type0/Calibri-Light embedded. No images on this page, no shadings/patterns, only ExtGState GS7/GS8 with /ca=/CA=1. Heavy TJ usage (249 ops on this page, F1 dominant). Same font signature on rapport-constructie.
- Visual diff inspection at the iter-4 deployed binary: app render dimensions = **1415×2000** against ref of 2000×2829. Reading `mcp_server.rs` showed `let scale = width as f32 / w_pt;` (literal width), which would produce 2000×2829 — but the running binary clearly was not following that rule.
- Source-of-truth check: writing a standalone `examples/test_dim.rs` against the published-on-disk `open-pdf-render` crate confirmed the kernel correctly produces 2000×2829 from `width=2000, w_pt=595.32, scale=3.359`. So the bug was only in what was compiled into the exe, not in the current source tree.
- Root cause: an in-flight uncommitted change to `open-pdf-studio/src-tauri/src/mcp_server.rs` had switched `scale = width / w_pt.max(h_pt)` → `scale = width / w_pt` (literal width to match PyMuPDF), but a `cargo build --release` had not been run since the change. The deployed exe (mtime 15:13) was still using the previous `max(w_pt, h_pt)` denominator → portrait A4 pages rendered at 2000/841.92 = 2.376× scale → 1415×2000 output → LANCZOS upscale to ref size → blurred anti-aliased text edges → 5-9% diff bands tracking text density.

**Action**: rebuilt `src-tauri` with `cargo build --release` (55 s). This compiled the in-flight `mcp_server.rs` literal-width-scale fix into the exe. NO new code was introduced in this iteration — the value comes entirely from a previously-committed-elsewhere fix that hadn't yet been linked into the running binary. The `mcp_server.rs` change remains uncommitted (it was an in-flight change before this iteration started).

**Verification** (run 2026-05-09_1541-01495dc7, full suite):
- Text pdf gecombineerd: avg 4.39 → 2.99 (-1.40pp), worst page 8.97 → 6.85 (-2.12pp), passing 7/28 → 11/28 (+4 pages: p1, p14, p16, p19, p25 now PASS).
- rapport-constructie: identical numbers (this PDF tracks Text pdf gecombineerd page-by-page in every iteration so far).
- 2885 Demo project: 2/14 PASS (worst page 11.39%, was 41.76% iter-2). Some side-effect improvement.
- Tekst.pdf: 1/5 PASS (p4 = 0.68%); p0-p3 in 2.16-3.70% range — just over the 2% threshold but visually correct.
- Zware vector PDF: 12/19 PASS (best PDF in suite); avg 2.15%.
- Technische tekening: 3/4 PASS (unchanged from iter-4).
- Combinatie / Barn Relocation: 0/1 and 2/7 PASS respectively.

**Total passing**: 34/106 → **42/106 (+8 pages)**. No regressions on previously-passing pages. All gains are on text-heavy portrait pages where the resolution mismatch had been costing 1-2 percentage points of diff.

**Concerns**:
- The +8 improvement is real but is owed to an in-flight, uncommitted `mcp_server.rs` fix that the previous iteration never linked into the binary. This iteration's actual contribution is the diagnosis (stale binary vs in-flight source) and the rebuild — no new Rust changes were made and no commit was created for `open-pdf-render/`.
- The next real iteration should target the remaining text-page diffs (Text pdf gecombineerd p8/11 still ≈ 6.85%). Visual inspection shows a faint horizontal grey-blue stripe across the bottom ~4 rows of the app render that's absent from the ref — looks like a clipped page-footer rectangle. Worth investigating in iter-6.
- Consider adding a build-freshness assertion to the regression harness (compare exe mtime against `src/**/*.rs` mtimes; warn loudly if Rust sources are newer) so future loops don't chase stale-binary artefacts.

**Commit**: none. No `open-pdf-render` changes; this entry is documentation only.

### Iteration 6 — Path clipping `W` / `W*` (Barn Relocation v1.4 Bluebeam-stapled construction permit)

**Iter-5 baseline** (run 2026-05-09_1541-01495dc7 per improvement-log + 2026-05-09_1550-80da0486 fresh re-run): 42/106 passing. Barn Relocation page 6 = 13.59%, the worst single page in the suite. Other Barn pages (p0-p5) all between 0.90% and 4.64%.

**Investigation findings**:
- Visual diff: app render's right side is dominated by a HUGE solid grey rectangle where the reference shows a delicate column-on-footing structural detail. The bottom-left construction detail similarly shows oversized grey blocks with hatching missing.
- Resource inventory (pikepdf): page is A1 landscape (`/MediaBox [0 0 1584 2448]` `/Rotate 90`). 16 DCT-JPEG images of varying sizes (94×1662 down to 147×44, plus a 3535×94 footer band and the giant 3077×2204 main `/R24`); single CenturyGothic TrueType font; no transparency groups; no shadings/patterns.
- Content-stream pattern: the page is a ~1.9 MB stream that wraps every image-paint sequence in nested `q ... [clip-rect] re W n q [transform] cm /RXX Do Q Q`. The `W n` pair at the inner level is supposed to constrain the image to a small inner rectangle even though the image is placed by a transform that scales it to fill the page. Without clipping, the image draws across the entire page.
- Root cause: **`W`/`W*` operators were no-ops in the SkiaRenderer interpreter path** (`open-pdf-render/src/interpreter.rs:229` had `"W" | "W*" => {}`). The `GraphicsState` already declared a `clip_path: Option<tiny_skia::Path>` field but nothing populated it, and none of `fill`/`stroke`/`fill_and_stroke`/`draw_image` passed a mask to tiny_skia. So every clipping rectangle that was supposed to constrain a `Do` image (or path) drew the full source content uncropped — for the page-6 footing detail this meant the 3077×2204 photo of a wall-section drawing painted across most of the right half of the page as a solid grey block. The same gap was costing diff% on every page in the suite that uses `re W n` framing (very common — virtually every PDF generator emits clip rects to bound images and form XObjects).

**Fix**:
- `open-pdf-render/src/graphics_state.rs`: changed `clip_path: Option<tiny_skia::Path>` → `clip_path: Option<tiny_skia::Mask>`. The mask is a pixmap-sized 8-bit alpha buffer (white = pass, black = block) that tiny_skia's `fill_path`/`stroke_path`/`draw_pixmap` accept as the `mask` parameter. `q` clones the mask via `Clone`; `Q` restores the parent mask, giving correct PDF clip-stack semantics for free.
- `open-pdf-render/src/renderer.rs`: stored pixmap dimensions on `SkiaRenderer`. Added `snapshot_path()` which clones the path-builder and finishes it without consuming (so the same path can be both painted and clipped). Added `apply_clip(gs, path, even_odd)` which either creates a new `Mask::new(w, h)` and `fill_path`s the path into it, or `intersect_path`s into the existing mask. Both use `gs.ctm` so the clip is in pixmap pixel coordinates. Threaded `gs.clip_path.as_ref()` into all four `fill_path` / `stroke_path` / `draw_pixmap` call sites in `fill`, `stroke`, `fill_and_stroke`, `draw_image`.
- `open-pdf-render/src/interpreter.rs`: added `pending_clip: Option<bool>` (the bool is the even-odd flag). `W` sets `Some(false)`; `W*` sets `Some(true)`. At the head of every iteration, if a paint or no-op operator (S/s/f/F/f*/B/B*/b/b*/n) is about to run AND `pending_clip` is set, snapshot the current path and apply it to `state.current.clip_path` before the paint op consumes the path builder. This matches the PDF spec's two-step "W then S" semantics and falls through `q`/`Q` automatically.

**Verification** (run 2026-05-09_1600-80da0486, full suite):
- **Barn Relocation page 6: 13.59% → 1.82% (FAIL → PASS)** — the targeted -11.77pp win. Visual confirms the giant grey rectangle is gone and the column/footing detail renders correctly.
- Bonus wins from clipping fix landing across the suite (no other PDF was deliberately targeted):
  - 2885 Demo project: 2/14 PASS → **9/14 PASS (+7)**. p0 1.15% (was 10.60), p3 1.26 (was 2.44), p5 1.76, p7 1.83 (was 8.27), p9 1.08, p10 0.81, p11 1.15 — all newly passing because their image-on-image transparency-group renders had been bleeding outside their intended clip rects.
  - Text pdf gecombineerd / rapport-constructie: 11/28 → 12/28 each (p0 1.27% from previously near-passing).
  - Barn Relocation: 2/7 → 3/7 (page 6 now passes, page 1 still passes).
- Zero regressions. Every page that was already passing in iter-5 is still passing. Worst page in suite is now 8.09% (2885 p4) — the high-water mark dropped from 13.59 to 8.09.
- **Total passing: 42/106 → 52/106 (+10)**. Average diff dropped on 4 of 8 PDFs; 2885 Demo project went from 4/14 → 9/14 PASS (avg 5.10 → 3.02).

**Concerns / next ideas**:
- The remaining failures cluster around text-edge antialiasing differences (Text pdf gecombineerd p2/4/8/11 in the 2-7% band). These look like sub-pixel font rendering deltas, not missing operators. Lower-leverage from here.
- 2885 Demo project p4 = 8.09% is now the worst page; visual inspection would be the next iter target if pursuing < 7%.
- Tekst.pdf p0-p3 still in 2.16-3.70% just-over-the-line band — same anti-aliasing story.

**Commit**: fe6ce578


### Iteration 7 — Glyph-origin device-pixel snapping (text-edge AA matches MuPDF)

**Iter-6 baseline** (run 2026-05-09_1600-80da0486): 52/106 passing. Worst page in suite was 2885 Demo project p4 at 8.09%. Several other 2885 pages clustered in the 5-8% band (p2 5.66, p6 5.20, p8 6.12, p13 5.91), as did Text pdf gecombineerd / rapport-constructie p8/11 (~6.5-6.7%) and Tekst.pdf p0-p3 (2.16-3.70%, just over the 2% threshold).

**Investigation findings**:
- Page 4 of 2885 is structurally trivial: a single Form XObject `/X8` with `/Group /S /Transparency /I true` containing 1091 `Tj` ops over 3 embedded TrueType-subset CID fonts (NotoSans-Regular, TAN-PEARL-Regular, SeN-CB). No images, no shadings, no patterns, no nested transparency.
- Visual inspection (`Drijvend bouwen…` body paragraph, row 280, col 100-200): both ref and app render the text correctly and align byte-for-byte at the **stem interiors** (full-ink purple = `[59, 27, 61]` in both renders). The diff is concentrated on **glyph anti-aliased edge pixels** — same column, but ref has e.g. left-edge AA value `120` (53% ink coverage) and right-edge `228` (11% coverage), while app produces a more symmetric `206` (19%) / `157` (38%) pattern. Mean text-pixel intensity: ref 69.1, app 73.3 (app is ~6% lighter); pixels < 50 (very dark): ref 207338 vs app 226048 (app has 9% MORE fully-inked pixels).
- Cross-correlation to detect a global x/y shift: minimum mean-abs-diff is at offset (0, 0). So glyphs are positioned at the right places — what differs is the **per-glyph sub-pixel placement** of each origin within its target pixel cell.
- Root cause: `text_renderer::render_text_glyphs_skia` and `render_cid_text_glyphs_skia` compute glyph origin as `(gx, gy) = (rise·tm[2] + tm[4], rise·tm[3] + tm[5])` — i.e. the accumulated sub-pixel position from successive `tx = (w0·Tfs + Tc + Tw) · Th` advances. tiny_skia then rasterises each glyph at its full sub-pixel origin. PyMuPDF/MuPDF (and most production rasterizers — FreeType, Cairo, Skia) **snap each glyph origin to the nearest integer device pixel** before scan-converting the outline. Without snapping, our glyph stems straddle two columns at fractional offset, producing a wider/softer AA edge profile than the reference's snapped, crisper edges.

**Fix** — `open-pdf-render/src/text_renderer.rs`:
- New `snap_glyph_origin(gx, gy, ctm) -> (gx', gy')` helper. Forward-maps the user-space origin through the current CTM to device space, rounds both components to the nearest integer, then inverse-maps back to user space. If the CTM is non-invertible, falls back to the unsnapped origin.
- Both `render_text_glyphs_skia` (simple-encoded fonts) and `render_cid_text_glyphs_skia` (Identity-H/Identity-V Type0 fonts) call the helper before `state.concat_matrix(...)`. Glyph outlines are then rasterised at the pixel-aligned origin while still inheriting the full font-size scale from the text matrix.
- The `tm[4]/tm[5]` advance accumulator is **not** snapped — only the per-glyph painting origin. Text layout (kerning, justification) stays accurate; only the rasterisation grid alignment changes.

**Verification** (run 2026-05-09_1626-4dfae30a, full suite):
- **2885 Demo project p4: 8.09% → 0.08% (FAIL → PASS)** — the targeted -8.01pp win. The high-water-mark page is now near-perfect.
- Bonus 2885 wins (text-heavy pages with same root cause):
  - p2: 5.66% → 0.06% (FAIL → PASS, -5.60pp).
  - p6: 5.20% → 0.05% (FAIL → PASS, -5.15pp).
  - p8: 6.12% → 6.07% (still FAIL but slightly better).
  - p13: 5.91% → 5.70% (still FAIL but slightly better).
  - 2885 net: 9/14 → **12/14** PASS (+3); avg diff -1.55pp.
- Tekst.pdf wins:
  - p0: 2.45% → 1.97% (FAIL → PASS).
  - p1: 2.16% → 1.86% (FAIL → PASS).
  - p4: 0.68% → 0.53%.
  - Tekst net: 1/5 → **3/5** PASS (+2); avg diff -0.45pp.
- Regressions (4 borderline pages — all were within 0.2pp of the 2% threshold):
  - Technische tekening p0: 1.96% → 2.13% (PASS → FAIL, +0.18).
  - Barn Relocation p6: 1.82% → 2.06% (PASS → FAIL, +0.24).
  - Text pdf gecombineerd p22: 1.98% → 2.99% (PASS → FAIL, +1.01).
  - rapport-constructie p22: 1.98% → 2.99% (PASS → FAIL, +1.01) — same content as Text pdf gecombineerd p22.
- Average diff change per PDF: 2885 -1.55pp, Tekst -0.45pp, Text/rapport -0.09pp, Zware vector +0.16pp, Barn +0.13pp, Technische +0.21pp, Combinatie +0.07pp. Net positive on the heaviest-failing PDF, slight regression on already-passing PDFs (snapping shifts the AA pattern by half a pixel either way; sometimes that aligns better with the reference, sometimes worse).
- **Total passing: 52/106 → 53/106 (+1 net)**. Five FAIL→PASS wins offset four PASS→FAIL regressions. The high-water mark went from 8.09% to 6.41% (Text pdf gecombineerd p8).

**Concerns / next ideas**:
- The four PASS→FAIL regressions all sit between 2.0 and 3.0% — they were borderline before and the snap shifted them just over. A smarter snap (e.g. snap only when the fractional part is > some threshold, or only snap one axis) might recover some without losing the 2885/Tekst gains.
- Several pages now in the 5-6% band (Text/rapport p8/11/17/20/21, 2885 p8/p13, Zware p3/p5) — same text-rasterizer-difference shape as iter-7 targeted. Most likely need additional rasterizer-level work (gamma-correct AA, stem snapping, font hinting) which is more invasive than this iteration.
- Worth investigating: could `tiny_skia::Paint::force_hq_pipeline` or different stroke/fill quality knobs nudge the AA closer? Current `paint.anti_alias = true` is already on.

**Commit**: e8fc0262


### Iteration 8 — Snap refinement: axis-aligned-only glyph snapping (Path A)

**Iter-7 baseline** (per improvement-log entry above): 53/106 passing. Four PASS→FAIL regressions from iter-7's unconditional glyph snap: Technische tekening p0 (1.96 → 2.13), Barn Relocation p6 (1.82 → 2.06), Text pdf gecombineerd p22 (1.98 → 2.99), rapport-constructie p22 (1.98 → 2.99).

**Path chosen**: A — refine the snap. Path B (chasing 5-7% pages) requires deeper rasterizer-level work (stem snapping, gamma-correct AA, font hinting) that is more invasive than the available time budget. Path A's idea #1 (snap only when CTM is axis-aligned) has a clean, falsifiable hypothesis backed by pikepdf inspection of the regressed pages.

**Investigation findings**:
- pikepdf inspection of the four iter-7 regressed pages: Technische tekening p0 (`/Rotate 90`, MediaBox 1684×2384), Barn Relocation p6 (`/Rotate 90`, MediaBox 1584×2448), Text pdf gecombineerd p22 (`/Rotate 0`), rapport-constructie p22 (`/Rotate 0`). 2 of 4 regressions are on `/Rotate 90` pages.
- For `/Rotate 90` pages, the page-level rotation is folded into the initial CTM (parser.rs lines 358-370), so `state.current.ctm.kx` and `ctm.ky` are non-zero throughout the page render. Iter-7's snap rounds the device-space origin to integer pixels, but on a rotated CTM the inverse-mapped user-space origin gets shifted along the perpendicular advance direction — the snap moves each glyph's stem by up to half a pixel along its visible vertical axis, producing AA edge patterns that don't match the reference.
- For `/Rotate 0` pages with axis-aligned text (Tekst, 2885 wins), `kx=ky=0` and the snap produces the desired horizontal pixel-grid alignment with no spurious vertical shift.
- The two unrotated regressions (Text/rapport p22) are harder — the snap creates a 1pp regression on an axis-aligned page. Likely a content-specific AA-pattern mismatch that would need a different refinement (idea #4 cumulative-error tracking) to recover; out of scope for iter-8.

**Hypothesis**: Restrict the snap to pages where the CTM has negligible rotation/skew (`kx.abs() < 1e-3 && ky.abs() < 1e-3`). This recovers the two `/Rotate 90` regressions while preserving every iter-7 win (which was on rotation-0 pages).

**Fix** — `open-pdf-render/src/text_renderer.rs`:
- `snap_glyph_origin` now checks `ctm.kx.abs() > AXIS_ALIGNED_EPS || ctm.ky.abs() > AXIS_ALIGNED_EPS` at entry and returns the unsnapped origin in that case. Only the rounding path was guarded — the inverse-CTM math is unchanged otherwise.
- `AXIS_ALIGNED_EPS = 1e-3` — generous enough to handle floating-point noise on identity-scale CTMs, tight enough to reject any real rotation (`sin(0.1°) ≈ 1.7e-3`).
- Updated docstring to record why the guard exists (iter-7 regressions).

**Verification** (full suite run 2026-05-09_1641-5f6ebc9a vs iter-7 baseline run):
- **Technische tekening p0: 2.13% → 1.96% (FAIL → PASS)** — recovered, -0.17pp.
- **Barn Relocation p6: 2.06% → 1.82% (FAIL → PASS)** — recovered, -0.24pp.
- Text pdf gecombineerd p22: 2.99% → 2.99% (still FAIL) — not recovered (axis-aligned page, snap still applies).
- rapport-constructie p22: 2.99% → 2.99% (still FAIL) — same as above.
- All iter-7 2885 wins preserved: p2 0.06, p4 0.08, p6 0.05 — all still PASS.
- All iter-7 Tekst wins preserved: p0 1.97, p1 1.86 — both still PASS.
- Per-PDF passing: Barn 2/7→3/7, Technische tekening 2/4→3/4, 2885 12/14, Tekst 3/5, Text/rapport 12/28 each, Zware vector 12/19, Combinatie 0/1.
- **Total passing: 53/106 → 55/106 (+2 net)**. Zero regressions; only the two `/Rotate 90` recoveries moved.

**Concerns / next ideas**:
- The two remaining iter-7 regressions (Text/rapport p22 at 2.99%) are on axis-aligned pages so this iteration cannot recover them. They need either idea #4 (cumulative subpixel error across a glyph run) or a content-aware approach. Probably 1 or 2pp recoverable but more invasive.
- High-water mark unchanged (Text/rapport p8 = 6.41%). Several pages still cluster in 4-7% band — same text-rasterizer-difference family that iter-7 partially attacked.
- Worst PDF in current state is Zware vector PDF (12/19 PASS, avg ~2.2%, several pages 3-5%) — these are vector-heavy scientific drawing pages that would benefit from a path-rendering iteration rather than text snapping.
- The `1e-3` epsilon comfortably distinguishes axis-aligned from rotated; if a future PDF has near-axis-aligned-but-not-quite text matrix (e.g. a 1° rotated PDF), the snap will be skipped on that page. Acceptable trade-off.

**Commit**: 8600a3ae
