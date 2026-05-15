# PDFium Browser Integration Research
## Progressive & Tiered Rendering Patterns

*Researched: 2026-05-15 — against pdfium-render 0.9.1, bblanchon chromium/7834 build*

---

## 1. Executive Summary

Chromium/Edge **does** implement a genuine tiered rendering system — but not via a separate "thumbnail then HD" API call. Instead, the PDF viewer (`pdf/pdfium/pdfium_engine.cc`) uses PDFium's progressive rendering API (`FPDF_RenderPageBitmap_Start` + `FPDF_RenderPage_Continue` + `FPDF_RenderPage_Close`) with a **time-sliced cooperative loop**: each render slice runs for at most 250–300 ms before yielding, the compositor displays whatever scanlines have been written so far, and the next animation frame resumes rendering. The net effect is that a page appears quickly at partial fidelity and fills in progressively — not because a different, lower-res bitmap is produced first, but because the same full-resolution bitmap accumulates pixels over successive slices. The closest pattern we can replicate in Open PDF Studio today is: (a) immediately display a scaled-down version of an already-cached pixmap as a placeholder, and (b) run the full-res PDFium render on a blocking thread, replacing the placeholder when it completes. The `_Start`/`_Continue`/`_Close` progressive API is exposed by pdfium-render 0.8.25+ but requires calling raw bindings directly — `render_with_config` wraps only the synchronous path.

---

## 2. PDFium Progressive Rendering API Breakdown

### The Three-Function Pattern

Defined in `public/fpdf_progressive.h`:

```c
// Status codes returned by both _Start and _Continue
#define FPDF_RENDER_READER         0   // ready (never returned after _Start)
#define FPDF_RENDER_TOBECONTINUED  1   // more work to do, call Continue
#define FPDF_RENDER_DONE           2   // complete
#define FPDF_RENDER_FAILED         3   // error

// Pause callback — caller implements NeedToPauseNow
typedef struct _IFSDK_PAUSE {
    int version;                                   // must be 1
    FPDF_BOOL (*NeedToPauseNow)(struct _IFSDK_PAUSE* pThis);
    void* user;                                    // caller-defined data
} IFSDK_PAUSE;

// Start: same signature as FPDF_RenderPageBitmap; returns status code
int FPDF_RenderPageBitmap_Start(
    FPDF_BITMAP bitmap, FPDF_PAGE page,
    int start_x, int start_y, int size_x, int size_y,
    int rotate, int flags,
    IFSDK_PAUSE* pause);

// Continue: resume after NeedToPauseNow returned true
int FPDF_RenderPage_Continue(FPDF_PAGE page, IFSDK_PAUSE* pause);

// Close: must be called when done or aborting (frees internal render state)
void FPDF_RenderPage_Close(FPDF_PAGE page);
```

### The Render Loop

From `core/fpdfapi/render/fpdf_progressive_render_embeddertest.cpp`:

```cpp
// 1. Allocate bitmap and fill white background
FPDF_BITMAP bitmap = FPDFBitmap_Create(width, height, has_alpha);
FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xFFFFFFFF);

// 2. Start progressive render
IFSDK_PAUSE pause;
pause.version = 1;
pause.user    = nullptr;
pause.NeedToPauseNow = Pause_NeedToPauseNow;  // returns true to yield

int status = FPDF_RenderPageBitmap_Start(
    bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT, &pause);

// 3. Continue until done
while (status == FPDF_RENDER_TOBECONTINUED) {
    // ← here: compositor can read `bitmap` pixels already written
    status = FPDF_RenderPage_Continue(page, &pause);
}

// 4. Cleanup (mandatory)
FPDF_RenderPage_Close(page);
```

The `NeedToPauseNow` callback is invoked by PDFium after every internally-defined rendering unit (typically one graphics object — a path, image, or text span). If it returns `true`, PDFium suspends and returns `FPDF_RENDER_TOBECONTINUED`. Pixels already rasterised are valid and readable in the bitmap.

### Key Point: One Bitmap, Incremental Fill

There is no low-res "first pass." The bitmap starts blank (white) and fills top-to-bottom, object-by-object. The visual "coarse then refine" effect comes from the compositor displaying the partially-filled bitmap between Continue calls — not from a separate thumbnail render.

### Exposure in pdfium-render (Rust)

`FPDF_RenderPageBitmap_Start`, `FPDF_RenderPage_Continue`, and `FPDF_RenderPage_Close` were added to `PdfiumLibraryBindings` in **version 0.8.25**. They are accessible via `pdfium.bindings()` but are **not wrapped by `PdfPage::render_with_config()`** — that method calls only the synchronous `FPDF_RenderPageBitmap`. To use progressive rendering you must call the raw bindings directly, manage the `IFSDK_PAUSE` C struct via `unsafe`, and drive the continue loop yourself.

`FPDF_RenderPageBitmapWithMatrix` (added to pdfium-render in v0.7.13) is also accessible through raw bindings and enables tile/clipped rendering (see Section 6).

---

## 3. Chromium PDF Viewer Architecture

Source: `pdf/pdfium/pdfium_engine.cc` (chromium/src, commit b2ecebcb).

### Render Pipeline Overview

```
PDF file bytes
    │
    ▼
FPDF_LoadDocument / FPDF_LoadMemDocument
    │  (once per document open)
    ▼
PDFiumEngine::Paint(rect, image_data, &ready, &pending)
    │
    ├─► [page already rendering] → queue rect to pending
    │
    └─► StartPaint(page_index, dirty_rect)
            │  calls FPDF_RenderPageBitmap_Start(bitmap, page,
            │      x, y, w, h, rotation, FPDF_ANNOT | flags, &pause)
            │
            ▼
        ContinuePaint(progressive_index, image_data)
            │  loop: FPDF_RenderPage_Continue(page, &pause)
            │  until (elapsed >= kMaxProgressivePaintTime)
            │      OR status == FPDF_RENDER_DONE
            │
            ▼
        [if DONE] FinishPaint → FPDF_FFLDraw → FPDF_RenderPage_Close
        [if not]  return TOBECONTINUED → next invalidate triggers re-entry
```

### Timing Constants (confirmed from source)

```cpp
constexpr base::TimeDelta kMaxInitialProgressivePaintTime =
    base::TimeDelta::FromMilliseconds(250);  // first slice, keeps scroll smooth
constexpr base::TimeDelta kMaxProgressivePaintTime =
    base::TimeDelta::FromMilliseconds(300);  // subsequent slices
```

### Zoom Change Flow

```cpp
void PDFiumEngine::ZoomUpdated(double new_zoom_level) {
    CancelPaints();            // abort all in-flight FPDF_RenderPage_Continue loops
    current_zoom_ = new_zoom_level;
    CalculateVisiblePages();   // recalculate which pages are in viewport
    UpdateTickMarks();
}
// Next Paint() call allocates a new bitmap at the new pixel size and
// calls FPDF_RenderPageBitmap_Start fresh.
```

There is **no low-res placeholder** inserted by the engine before the new full-res render begins. The old bitmap (at the previous zoom) stays on screen until the new one completes its first slice. The "instant coarse preview on zoom" that Edge appears to show is either: (a) the OS compositor stretching the old bitmap while the new one renders (GPU bilinear upscale), or (b) the first 250 ms slice completing enough scanlines to look like a coarse preview.

### Render Flags Used by Chromium

From `pdfium_engine.cc` calls:

| Context | Flags |
|---|---|
| Normal screen render | `FPDF_ANNOT` |
| Print | `FPDF_ANNOT \| FPDF_PRINTING \| FPDF_NO_CATCH` |

Chromium does **not** set `FPDF_LCD_TEXT`, `FPDF_RENDER_NO_SMOOTHTEXT`, `FPDF_FORCEHALFTONE`, or `FPDF_RENDER_LIMITEDIMAGECACHE` for screen rendering. It relies on PDFium's defaults for anti-aliasing and image quality.

---

## 4. The "Coarse-Then-Refine" Pattern in Detail

### What Actually Happens in Chrome/Edge

1. **User opens PDF**: `FPDF_RenderPageBitmap_Start` runs. The bitmap fills progressively over multiple 250–300 ms slices. On fast hardware (Intel/AMD desktop), a typical A4 page at 100% zoom renders in a single slice; the effect is invisible. On complex PDFs with many vector objects or high-res images, you see the page fill top-to-bottom.

2. **User zooms in**: `CancelPaints()` → new bitmap allocated at higher pixel count → `FPDF_RenderPageBitmap_Start`. The **old zoom level's bitmap** remains in the compositor as a texture; the browser stretches it (GPU bilinear) to fill the viewport while the new render proceeds. This is the "coarse then sharp" transition you observe in Edge — it is the GPU stretching the previous frame, not a deliberate low-res render pass.

3. **Pan/scroll**: Only newly-exposed dirty rects trigger `Paint()`. If a page is already fully rendered (status `FPDF_RENDER_DONE`), no re-render occurs; the existing bitmap is composited at the scroll offset.

4. **Tile rendering**: Chromium's PDF engine does **not** tile pages — it always renders the full page into a single bitmap. The viewport clipping is done by the compositor (only the visible region is painted to screen), but the underlying bitmap covers the whole page.

### Why Edge Looks Faster Than Our Current Implementation

Our current `render_page_to_rgba` is fully synchronous (single blocking `render_with_config` call). During the blocking period (~50–500 ms depending on page complexity and zoom), the UI shows nothing new. Edge shows something within one compositor frame because the old zoom's bitmap is still composited (GPU side) while the new render runs in the PDFium thread. We do not retain the previous zoom's pixmap during a zoom transition, so the canvas goes blank or shows stale content until `render_page_to_rgba` returns.

---

## 5. Recommendations for Open PDF Studio

### Quick Wins (implement today, no architecture change)

**A. Retain old-zoom pixmap during zoom transitions**

In `pdfium_renderer.rs`, the `PixmapCache` already stores rendered pixmaps keyed by `(path, page, scale_q, rotation)`. When a zoom-in is triggered, look up the closest cached scale, stretch it to the new viewport size via canvas `drawImage` with `imageSmoothingQuality = "high"`, display immediately, then replace when the new render completes. This replicates Edge's GPU-stretch behaviour at zero render cost.

**B. Two-tier scale request on zoom**

On zoom-in, immediately dispatch a render at the *previous* zoom level + 20% pixel budget (fast), display it, then queue a second render at the exact new zoom. The user sees a sharp-enough image within ~50 ms instead of waiting for the full high-res render.

**C. Add `FPDF_LCD_TEXT` flag for screen rendering**

Our current `PdfRenderConfig` does not set any render flags. `FPDF_LCD_TEXT` (0x02) enables sub-pixel LCD optimisation for text, visually improving sharpness on non-retina screens at no measurable CPU cost. Expose it via `pdfium.bindings()` or wait for pdfium-render to expose a `use_lcd_text()` method on `PdfRenderConfig`.

Current config in `pdfium_renderer.rs` (line 185):
```rust
let config = PdfRenderConfig::new()
    .set_target_width(target_w)
    .set_maximum_height(target_h)
    .rotate(rot, true)
    .render_form_data(true)
    .set_format(PdfBitmapFormat::BGRA);
// Missing: LCD text flag, no smoothing flags are fine at full res
```

**D. Do not call `as_rgba_bytes()` — keep BGRA**

`as_rgba_bytes()` does a full-buffer channel-swap (BGRA→RGBA). Since the Tauri `<img>` tag accepts data URLs without caring about byte order if you set the canvas pixel format correctly, switching to BGRA throughout and skipping the swap saves one full-frame memcopy (~10–40 ms on large pages).

### Medium Effort (1–3 days)

**E. Progressive render with placeholder display**

Use `pdfium.bindings().FPDF_RenderPageBitmap_Start(...)` directly with a `NeedToPauseNow` callback that returns `true` after ~16 ms (one frame budget). After each Continue call, serialize the partial bitmap to the frontend and display it. This matches Chromium's approach and gives genuine top-to-bottom fill animation.

Skeleton:

```rust
// Pseudo-code — requires unsafe + raw bindings
let status = bindings.FPDF_RenderPageBitmap_Start(
    bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT, &mut pause
);
while status == FPDF_RENDER_TOBECONTINUED {
    // emit partial bitmap to frontend via Tauri event
    let partial = read_bitmap_buffer(&bitmap);
    app_handle.emit("pdf-partial-render", partial_payload).ok();
    // continue
    status = bindings.FPDF_RenderPage_Continue(page, &mut pause);
}
bindings.FPDF_RenderPage_Close(page);
```

Note: the `thread_safe` feature mutex means only one render runs at a time; the emit calls will compete with the lock. You may need to clone the partial buffer before emitting.

**F. Pre-render adjacent pages at current zoom**

When the user is on page N, immediately queue renders for pages N-1 and N+1 at the current scale. The `PixmapCache` (40-entry FIFO, already in `pdfium_renderer.rs`) will absorb them. Page turns become instant.

### Large Effort (1–2 weeks)

**G. Tile/region rendering via `FPDF_RenderPageBitmapWithMatrix`**

For high-zoom views (>200%), only the visible viewport sub-region matters. `FPDF_RenderPageBitmapWithMatrix` accepts a transformation matrix and a clipping rect (`FS_RECTF`). You can allocate a bitmap sized to the viewport (e.g. 1920×1080), set the matrix to position and scale the page such that only the visible sub-region falls within the clip, and render only those pixels. This trades one large bitmap render for a smaller viewport-sized one.

```c
// Render only the visible 1920×1080 window of a page zoomed to 300%
FS_MATRIX matrix = { scale_x, 0, 0, scale_y, -offset_x, -offset_y };
FS_RECTF  clip   = { 0, 0, viewport_w, viewport_h };
FPDF_RenderPageBitmapWithMatrix(bitmap, page, &matrix, &clip, FPDF_ANNOT);
```

In pdfium-render, `FPDF_RenderPageBitmapWithMatrix` is accessible via `pdfium.bindings()` since v0.7.13. There is no high-level `PdfRenderConfig` wrapper for it.

**H. Skia GPU backend**

`FPDF_InitLibraryWithConfig` accepts `FPDF_RENDERERTYPE_SKIA` (value 1). With Skia enabled, PDFium routes path and text rendering through Skia's CPU rasteriser (not the GPU directly — see Section 6). The bblanchon `chromium/7834` build used by Open PDF Studio does **not** expose `FPDF_RENDERERTYPE_SKIA` — it is compiled with the AGG backend only. Switching would require a different pdfium binary.

---

## 6. What Is NOT Possible (Honest Limitations)

### No GPU rasterisation via public API

`FPDF_RenderPageSkia` exists in PDFium source but is **not part of the public `fpdfview.h` API**. Even when Skia is enabled (`FPDF_RENDERERTYPE_SKIA`), PDFium rasterises to a CPU `SkBitmap` (via `SkPicture` recording), then the caller composites that bitmap to the GPU surface. There is no path where PDFium issues GPU draw calls and returns a GPU texture. Chromium's Skia Graphite GPU backend (shipped M133/M134 for web content) does **not** affect PDFium rendering — it handles Blink/browser-UI paint commands, not PDF page rasterisation.

### `FPDF_RENDER_NO_SMOOTH*` flags do not reliably improve performance

The Google Groups thread on render flag performance (2024) confirmed that `FPDF_RENDER_NO_SMOOTHTEXT`, `FPDF_RENDER_NO_SMOOTHIMAGE`, and `FPDF_RENDER_NO_SMOOTHPATH` "are for something completely different" from the speed hint they appear to be. No confirmed speed improvement was found. Avoid using them as a performance lever.

### pdfium-render `render_with_config` cannot be made progressive

`PdfPage::render_with_config` calls `FPDF_RenderPageBitmap` (the synchronous variant) internally. There is no `render_with_config_progressive()` — you must use raw bindings. The high-level API does not expose the `IFSDK_PAUSE` interface.

### `thread_safe` mutex serialises all renders

pdfium-render's `thread_safe` feature wraps every PDFium call in a single global mutex. Parallel renders from multiple Tauri command threads queue up — only one runs at a time. The `FPDF_RenderPage_Continue` calls between partial-bitmap emissions will each re-acquire this mutex, which is fine for correctness but means the progressive emit pattern has mutex overhead per slice.

### No internal cross-render font/image caching exposed to Rust

PDFium internally uses `CPDF_PageRenderCache` (attached per `CPDF_Page`) for decoded image tiles and font glyph bitmaps within a single render call. This cache **is** reused across multiple `render_page_to_rgba` calls on the same `PdfDocument` (same Rust `PdfiumDocumentHandle`) because `PdfDocument` wraps `FPDF_DOCUMENT` which keeps pages alive. So: repeated re-renders of the same page at different scales do benefit from PDFium's internal font cache — you do **not** need to manage this yourself. The bblanchon binary does not expose cache control APIs.

---

## 7. Source References

| Source | URL |
|---|---|
| `public/fpdf_progressive.h` | pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_progressive.h |
| `public/fpdfview.h` | pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdfview.h |
| `fpdf_progressive_render_embeddertest.cpp` | pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fpdfapi/render/fpdf_progressive_render_embeddertest.cpp |
| `pdf/pdfium/pdfium_engine.cc` (Chromium) | chromium.googlesource.com/chromium/src/+/b2ecebcb4b84e7bedc44661cd3bfde5acf62bcad/pdf/pdfium/pdfium_engine.cc |
| pdfium-render changelog | github.com/ajrcarey/pdfium-render |
| Skia Graphite launch post | blog.google/chromium/introducing-skia-graphite-chromes/ |
| PDFium render flags discussion | groups.google.com/g/pdfium/c/7bUfE5WCJ-E |
| PDFium Skia GPU discussion | groups.google.com/g/pdfium/c/VxTKQXTlkEM |
