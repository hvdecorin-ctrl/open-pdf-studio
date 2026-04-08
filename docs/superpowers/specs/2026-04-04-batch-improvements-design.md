# Open PDF Studio - Batch Improvements Design Spec

**Date:** 2026-04-04
**Status:** Draft

---

## Overview

11 improvements grouped into a single batch. Each is independently testable and numbered for tracking.

---

## 1. Thumbnail Raster Images via Rust Engine

**Goal:** Thumbnails rendered by the Rust engine must include raster images (XObject images).

**Current state:** The Rust renderer already handles image XObjects (JPEG, FlateDecode, CMYK) via `handle_image_xobject()` in `interpreter.rs:893-1061`. DrawImage command (opcode 19) is emitted. However, the `render_page()` pipeline may not be executing DrawImage commands during rasterization. Inline images (BI/ID/EI) are not handled.

**Root cause:** In `interpreter.rs:220`, `handle_do_execute()` has `if subtype != Some(b"Form") { return; }` which silently skips Image XObjects. The extract path (for web canvas) handles images correctly, but the execute path (for thumbnails) does not.

**Fix (simple):**
- **`open-pdf-render/src/interpreter.rs`**: In `handle_do_execute()`, before the Form check, detect `Subtype == "Image"` and decode the image using the same logic as `handle_image_xobject()`. Then use `image` crate to decode JPEG/raw pixels into RGBA, create a `tiny_skia::Pixmap` from the RGBA data, and composite onto the renderer pixmap via `pixmap.draw_pixmap()` with the current CTM transform.
- **`open-pdf-render/src/renderer.rs`**: Add `draw_image(&mut self, img_pixmap: &Pixmap, gs: &GraphicsState)` method that composites an image pixmap onto the page using the current transform matrix.

**Verification:** Render a thumbnail of a PDF with embedded raster images and confirm images appear.

---

## 2 + 11. Unified Select Tool (Always Active)

**Goal:** Merge "Tekst selecteren" and "Opmerkingen selecteren" into one tool that handles both. This tool is always the default and resets to active after every action.

**Current state:** Two separate buttons in HomeTab.jsx (lines 29-32). Both use `selectTool` object but with different z-index layering. `selectComments` puts annotation canvas below text layer; `select` puts it above.

**Design:**
- Remove `selectComments` tool registration and ribbon button.
- The unified `select` tool handles both annotations AND text:
  - Annotation canvas stays at z-index 6 (above text layer).
  - Text selection works via a transparent text layer overlay that passes through clicks to annotations but still allows text drag-selection.
  - Implementation: Set `pointer-events: none` on text layer normally. On mousedown, if no annotation is hit, temporarily enable text layer pointer-events for text selection. On mouseup, restore.
- **Always-active reset:** After every tool completes an action (stamp placed, line drawn, shape created, etc.), auto-reset to `select`. This requires adding `setTool('select')` calls in:
  - `tool-dispatcher.js` after annotation creation
  - Each tool's completion handler (stamp, line, measurement, shape, pen, textbox, etc.)
  - `manager.js` on PDF load (already exists)
  - After undo/redo operations
  - After delete operations
  - After paste operations

**Files changed:**
- `js/solid/components/ribbon/HomeTab.jsx` - Remove selectComments button
- `js/tools/tools/index.js` - Remove selectComments registration
- `js/tools/manager.js` - Remove selectComments layering logic, add auto-reset
- `js/tools/tool-dispatcher.js` - Add setTool('select') after creation
- `js/tools/tools/select-tool.js` - Unified hit-test: try annotation first, fall through to text
- All tool files in `js/tools/tools/` - Add completion reset
- `js/core/state.ts` - Remove selectComments from tool type

---

## 3. Vector PDF Text Selection (Rust Renderer)

**Goal:** When using the Rust vector renderer, text selection must work.

**Current state:** Rust renderer emits TextAt commands (opcode 18) with x, y, fontSize, color, text. These are rendered on canvas but no DOM text layer is created. PDF.js text layer is only created when PDF.js renders the page.

**Design:**
- **Rust side (`open-pdf-render`):** Add a new export function `extract_text_positions(page_index)` that returns a Vec of text spans: `{ x, y, width, height, fontSize, text, transform }`.
- **Tauri command:** Add `extract_page_text` command that calls the Rust function and returns JSON.
- **JS side:** When vector renderer is active, call `invoke('extract_page_text', ...)` and build a synthetic text layer with positioned `<span>` elements matching the text positions. Reuse existing `text-layer.js` infrastructure for the DOM creation.
- **Fallback:** If Rust text extraction fails, fall back to PDF.js `page.getTextContent()`.

**Files changed:**
- `open-pdf-render/src/lib.rs` - Add `extract_text_positions()`
- `open-pdf-render/src/interpreter.rs` - Collect text spans during interpretation
- `src-tauri/src/lib.rs` - Add Tauri command
- `js/text/text-layer.js` - Add synthetic text layer builder from Rust data
- `js/pdf/renderer.js` - Call text extraction when using vector renderer

---

## 4. Measurement Line Defaults

**Goal:** Default measurement lines: red, open circle ticks, mm without decimals, leader fixed to dimension line.

**Current state:** Defaults come from preferences. Current defaults: black color, various tick styles, 2 decimal places, leader from click point.

**Changes:**
- **`js/annotations/factory.js` or measurement-tool.js:** Set defaults:
  - `color: '#FF0000'` (red)
  - `startHead: 'openCircle'`, `endHead: 'openCircle'`
  - `precision: 0` (no decimals)
  - `unit: 'mm'`
- **`js/annotations/rendering/measurements.js`:** Modify leader line rendering so leader endpoints anchor to the dimension line position rather than the original click placement point. The extension lines should always connect measurement points perpendicular to the dimension line.
- **`js/core/constants.ts`:** Update default preference values.

---

## 5. Arc Tool (from Open 2D Studio)

**Goal:** Add arc drawing capability, ported from Open 2D Studio.

**Design:**
- New annotation type: `arc` with properties: `centerX, centerY, radius, startAngle, endAngle, color, lineWidth, opacity`.
- New tool: `arc-tool.js` with modes:
  - **3-point**: Click start, click point-on-arc, click end. Uses `calculateArcFrom3Points()` from Open 2D Studio.
  - **Center-start-end**: Click center, click start (defines radius), click end.
- Rendering: `ctx.arc(centerX, centerY, radius, startAngle, endAngle)` in rendering.js.
- Also add arc segments to polyline tool via 'A' key toggle (bulge system from Open 2D Studio).
- Add to annotation type registry and ribbon UI.

**Files changed:**
- `js/types/annotation.ts` - Add ArcAnnotation type
- `js/tools/tools/arc-tool.js` - New file
- `js/tools/tools/index.js` - Register arc tool
- `js/annotations/rendering.js` - Arc rendering
- `js/annotations/geometry.js` - Arc hit-testing
- `js/solid/components/ribbon/HomeTab.jsx` - Arc button
- `js/annotations/factory.js` - Arc defaults
- `js/pdf/saver.js` - Save arc annotations to PDF

---

## 6. Trim/Extend/Array Tools (from Open 2D Studio)

**Goal:** Port trim, extend, and array operations for line-based annotations.

**Design:**

### Trim
- 2-click workflow: Click cutting edge, click target line.
- Uses `lineLineIntersection()` from Open 2D Studio's Modify.ts.
- Shortens target line at intersection, keeping the side away from click point.
- Works on: line, arrow, polyline annotations.

### Extend
- 2-click workflow: Click boundary, click line to extend.
- Extends nearest endpoint to intersection with boundary.
- Works on: line, arrow annotations.

### Array
- Select annotation(s), click base point, click end point.
- Linear mode: Distributes N copies evenly between base and end.
- Radial mode: Rotates N copies around base point.
- UI: Count and mode inputs in a floating toolbar or status bar.

**Files changed:**
- `js/tools/tools/trim-tool.js` - New
- `js/tools/tools/extend-tool.js` - New
- `js/tools/tools/array-tool.js` - New
- `js/annotations/geometry.js` - Line intersection math
- `js/tools/tools/index.js` - Register tools
- `js/solid/components/ribbon/HomeTab.jsx` - Buttons

---

## 7. Scale Bar Selectable

**Goal:** Scale bar annotation must be selectable, movable, and resizable.

**Current state:** Scale bar has bounding box hit-testing in geometry.js. Need to verify it works with select tool and supports drag/resize.

**Changes:**
- Verify `geometry.js` hit-test for scaleBar type returns correctly.
- Ensure `select-tool.js` doesn't exclude scaleBar from selection.
- Ensure `handles.js` provides resize handles for scaleBar.
- If scale bar is rendered as UI overlay instead of annotation, convert to annotation-based rendering.

---

## 8. Page Prefetching

**Goal:** Reduce page navigation delay by prefetching adjacent pages.

**Design:**
- After current page renders, use `requestIdleCallback` to prefetch:
  1. Next page (pageNum + 1)
  2. Previous page (pageNum - 1)
- Prefetch includes: annotation loading, text layer data, low-res render cache.
- Store prefetched data in existing caches (`_lowResCache`, `_loadedAnnotationPages`).
- Cancel prefetch if user navigates before completion.
- Limit prefetch to single-page mode (continuous mode already has visible-page loading).

**Files changed:**
- `js/pdf/renderer.js` - Add `prefetchAdjacentPages()` after renderPage completes
- `js/pdf/loader.js` - Expose `ensureAnnotationsForPage()` for prefetch use

---

## 9. Thin Lines Toggle in Ribbon

**Goal:** Make thin lines toggle accessible from the View tab, not just preferences.

**Current state:** Working implementation exists in preferences (`thinLines` boolean). Applied via `thinLw()` in rendering.js and `enhanceThinLines` in renderer.js.

**Changes:**
- Add toggle button in View tab ribbon: "Thin Lines" with thin-line icon.
- Button toggles `state.preferences.thinLines`.
- Visual feedback: button appears active/pressed when thin lines enabled.

**Files changed:**
- `js/solid/components/ribbon/ViewTab.jsx` - Add toggle button
- Possibly `js/i18n/locales/*/view.json` - Add translation key

---

## 10. Area/Surface Click-Anywhere Selection

**Goal:** Polygon/measureArea annotations selectable by clicking anywhere inside, not just edges.

**Design:**
- Add point-in-polygon test using ray casting algorithm to `geometry.js`.
- For `measureArea` and `polygon` types: after edge proximity check fails, run point-in-polygon.
- Account for holes: point must be inside outer ring AND outside all holes.
- Ray casting: count intersections of horizontal ray from point to right infinity with polygon edges. Odd count = inside.

**Implementation:**
```javascript
function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if ((points[i].y > y) !== (points[j].y > y) &&
        x < (points[j].x - points[i].x) * (y - points[i].y) / (points[j].y - points[i].y) + points[i].x) {
      inside = !inside;
    }
  }
  return inside;
}
```

**Files changed:**
- `js/annotations/geometry.js` - Add `pointInPolygon()`, integrate into hit-test for measureArea, polygon, cloud types

---

## Implementation Order

Recommended order (least risk to most complex):

1. **#4** Measurement defaults (config change only)
2. **#9** Thin lines ribbon toggle (UI addition)
3. **#10** Area click-anywhere selection (geometry addition)
4. **#7** Scale bar selectable (verification + fixes)
5. **#2+11** Unified select tool always active (significant refactor)
6. **#8** Page prefetching (performance)
7. **#1** Thumbnail raster images in Rust (Rust changes)
8. **#3** Vector PDF text selection (Rust + JS)
9. **#5** Arc tool (new feature)
10. **#6** Trim/Extend/Array (new features)

---

## Testing Strategy

Each improvement tested via:
1. Manual test in running app (via `tauri dev`)
2. Visual verification via MCP server screenshot
3. Regression check: existing functionality still works

Pass criteria per item documented in implementation plan.
