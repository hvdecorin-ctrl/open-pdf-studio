# Parallel Thumbnail Extraction — Design Spec

**Status:** Draft, awaiting user review
**Date:** 2026-05-18
**Branch:** `feat/fast-open-barn`

## Goal

Make the page-thumbnail panel populate ~3-6× faster for vector-heavy PDFs (NKD1a_opm_aw.pdf, Tekst.pdf, rapport-constructie.pdf, etc.) by triggering one parallel-rayon batch extraction of draw commands at thumbnail generation start, ahead of the existing per-page render loop. Existing JS-replay path then hits the cache for every vector page.

## Background

User report: opening NKD1a_opm_aw.pdf (7 pages, 24 MB) takes several seconds for the thumbnail panel to populate. Each thumbnail call routes through `renderThumbnailToDataURL` which:

1. First checks `vr.hasCachedCommands(filePath, pageNum, rotation)` — on cold-open this misses
2. Falls back to Rust `render_thumbnail` Tauri command — synchronous PDFium render at 200 px wide, ~200-600 ms per page
3. Last resort: PDF.js fallback (very slow)

The render_thumbnail path serializes via the PDFium global mutex (pdfium-render `thread_safe` feature), so even if we parallelize the JS-side invokes, the Rust side processes them one at a time.

A second Rust command **already exists**: `extract_draw_commands_batch` (lib.rs:1395). It accepts a list of page indices, extracts draw commands for all of them in parallel via rayon (per the open-pdf-render library's `extract_draw_commands_batch` method), and returns a `Vec<Vec<u8>>` matching the input order. The extraction uses lopdf (pure Rust, no PDFium mutex contention), so it really does parallelize across cores.

**Gap**: the thumbnail path does not currently call `extract_draw_commands_batch`. It also does not benefit from cached commands that the main page render path may have populated (only the currently-rendered page is cached, not the rest).

## Architecture

### Before

```
generateThumbnails() loops pages 1..N sequentially:
  renderThumbnailToDataURL(pageNum)
    ├─ vr.hasCachedCommands?  →  JS-replay (~10-30ms)        ← misses on cold open
    └─ Rust render_thumbnail (~200-600ms, mutex-serialized) ← slow path
```

### After

```
generateThumbnails() ENTRY:
  Kick async: invoke('extract_draw_commands_batch', {path, page_indices: [0..N-1], rotations})
  When result arrives:
    for each page i: vr.cacheCommands(filePath, pageIndex+1, bytes[i], rotation[i])

  (in parallel) loop pages 1..N — exactly as today:
    renderThumbnailToDataURL(pageNum)
      ├─ vr.hasCachedCommands?  →  JS-replay  ← now hits for every vector page
      └─ Rust render_thumbnail              ← fallback for tile-classified pages
                                            ← OR for thumbnails that fired before batch completed
```

### Race handling

- **Thumbnail render starts BEFORE batch arrives**: cache miss → falls through to Rust render_thumbnail. Current behavior preserved. Slow but correct.
- **Thumbnail render starts AFTER batch arrives for that page**: cache hit → JS-replay. Fast.
- **Thumbnail render and batch land simultaneously**: cache write (from batch handler) and cache read (from thumbnail) on the same Map. JavaScript is single-threaded, so the order is serialized by the event loop — no torn state possible.

### Failure handling

- `extract_draw_commands_batch` invoke fails (e.g. PDF parse error, Rust panic): log warning, do nothing else. Per-page thumbnails fall through to Rust `render_thumbnail` automatically. No user-visible regression.
- One page in the batch returns empty (16 bytes = header only, no commands — typical for raster-classified pages): skip caching that page. `renderThumbnailToDataURL` falls through to Rust `render_thumbnail` for that page. Same as current behavior.
- One page in the batch returns valid commands but the page is actually raster-only (header parser overestimated): JS-replay paints incomplete content (vectors only, images missing). This is a regression for that specific page type. Mitigation: discussed in *Out of scope* — first-pass design accepts this trade-off; severity is low (raster pages dominate by image content, and a partial thumbnail is still recognizable).

## Components

Only one file changes:

| File | Change |
|------|--------|
| `open-pdf-studio/js/ui/panels/left-panel.js` | `generateThumbnails()` gains a ~20-line preface that kicks the batch extract and populates `vr.cacheCommands()` as the result arrives |

No changes to:
- `js/pdf/vector-renderer.js` — existing `cacheCommands()` and `hasCachedCommands()` are sufficient
- `js/pdf/renderer.js` — unchanged
- `src-tauri/src/lib.rs` — `extract_draw_commands_batch` already exists with rayon parallelism
- `src-tauri/src/pdfium_renderer.rs` — unchanged

## Data Flow Walkthrough — NKD1a (7 pages)

1. User opens NKD1a_opm_aw.pdf
2. `loadPDF()` runs; first page renders via the standard vector path; vector commands for **page 1** land in cache
3. `setViewMode()` → `generateThumbnails()` is called
4. **NEW**: at entry, fire `invoke('extract_draw_commands_batch', {path: '...NKD1a...', page_indices: [0,1,2,3,4,5,6], rotations: [0,0,0,0,0,0,0]})` — non-blocking
5. Thumbnail loop begins; first thumbnail renders via Rust `render_thumbnail` (cache may still be empty for that page) — ~600 ms
6. Around ~500-1000 ms after step 4, the batch result lands as `Vec<Vec<u8>>` of 7 entries; the handler iterates and calls `vr.cacheCommands(filePath, i+1, bytes[i], 0)` for each page
7. Remaining thumbnails (pages 2-7) hit the cache → JS-replay → ~30 ms each
8. Total time: ~500-1000 ms for batch + ~600 ms for page 1 (overlapping) + ~30 ms × 6 = ~700-1200 ms vs. current ~3-5 seconds

## Out of Scope

- **OCG layer visibility** for thumbnails — same limitation as for the main render (PDFium DLL doesn't expose `FPDFOC_*`). Filed as separate v1.51 follow-up.
- **Parallelizing Rust `render_thumbnail`** itself — would need multiple PDFium contexts or processes; ruled out as too complex for this iteration. Option chosen by user: option 1 ("Batch extract + JS-replay") rather than option 2 ("Multi-process PDFium").
- **Lazy/visible-only thumbnails** — option 3 was offered and rejected; for the 5-30 page docs that dominate user workload, all thumbnails fit in the panel and are wanted up-front.
- **Cancellation** when the user closes the document mid-extraction — `extract_draw_commands_batch` doesn't support cancellation. Worst case: rayon workers finish, result is discarded by the doc-gen check in `vr.cacheCommands` (if such check exists; if not, harmless extra memory until LRU eviction).
- **Correctness for pages where lopdf returns SOME commands but the page is actually raster-dominant** — accepted as a known mild regression. Mitigation could be added in a follow-up: cross-check against `analyze_page_type` results before caching.

## Success Criteria

1. ✅ NKD1a_opm_aw.pdf thumbnail panel populates in **≤ 1.5 seconds** (vs. ~4-5 seconds today)
2. ✅ rapport-constructie.pdf (28 mixed pages) populates in **≤ 2 seconds** (vs. ~6 seconds today)
3. ✅ No regression on raster-only PDFs (BARN, Tekst.pdf) — same speed as today
4. ✅ No regression on per-thumbnail content correctness (visual inspection on the 11-PDF test corpus)
5. ✅ MCP harness `app_get_recent_console` shows `[Thumbnails]` entries via the JS-replay path for vector pages after the batch resolves

## Testing Plan

Manual via the live app:
1. Open NKD1a_opm_aw.pdf, time visually from open-click to all 7 thumbnails visible
2. Open rapport-constructie.pdf, time to all 28 thumbnails visible
3. Open BARN (raster), confirm no slow-down
4. Verify all thumbnails visually match what a user would expect (no missing content)

Automated via MCP:
- Extend `mcp-server/sweep-all-pdfs.mjs` with a `thumbnailReadyTime` measurement (poll viewport state until thumbnail count matches page count)
- Compare across the 11 test PDFs before/after

---

## Self-Review

- **Placeholders**: none
- **Internal consistency**: architecture matches data-flow walkthrough; race handling matches the "JS-replay if cached else Rust fallback" pattern
- **Scope check**: one file change, well-bounded
- **Ambiguity**: "after the batch arrives" is the only timing-relative phrase, but it's explicit (the batch handler populates cache, then subsequent `hasCachedCommands` returns true). The race is documented under *Race handling*.
