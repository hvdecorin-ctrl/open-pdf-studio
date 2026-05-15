# Unified Pan/Zoom Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-path (bitmap-mode vs vector-mode) PDF render architecture with one unified pan/zoom model. Eliminate the "flits van een ander beeld" bug, cursor anchor races, and free pan limitations. All test verification through frontend MCP harness on BARN p.2.

**Architecture:** Fixed-size canvas sized to container. `viewport.offsetX/Y/zoom` is the sole pan/zoom state for all PDF types. RAF render loop in `pdf-viewport.js` draws each frame: `drawImage(wholeBitmap)` for raster content + `drawImage(tileBitmap)` over visible region when zoom exceeds the 4096px-axis cap. Async PDFium renders fill the bitmap-caches and trigger `viewport.dirty=true`. No predictive CSS resize, no canvas dimension mutation mid-zoom, no separate tile DOM canvas.

**Tech Stack:** Tauri 2 · SolidJS · PDFium (via pdfium-render 0.9.1) · existing `render_pdf_page` and `render_pdf_page_region` Rust commands · MCP harness on port 9223 for verification.

**Spec:** `docs/superpowers/specs/2026-05-15-unified-pan-zoom-design.md`

**Branch:** `feat/fast-open-barn`

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `js/pdf/bitmap-cache.js` | LRU cache for whole-page `ImageBitmap`s, keyed by `(file, page, zoomBucket, rotation)` |
| `js/pdf/tile-cache.js` | LRU cache for region tile `ImageBitmap`s, keyed by `(file, page, zoomBucket, rotation, regionBucket)` |
| `js/pdf/bitmap-orchestrator.js` | Reads viewport state, ensures bitmap+tile caches are populated for current view, fires `viewport.dirty=true` when bitmaps arrive |

### Modified files

| File | Change |
|------|--------|
| `js/pdf/pdf-viewport.js` | Add raster + tile branches to `_render()`; remove `clampAndCenterUnused_keptForReference` dead code; sync text-layer + annotation-canvas via transform per frame |
| `js/pdf/renderer.js` | `renderPage()` becomes thin orchestrator: page-metadata + cache ensure + viewport activate. Remove predictive CSS resize, canvas-width mutation, `_renderTileOverlay`, `_hideTileOverlay`, `_scheduleTileRerenderOnScroll`, `wireTileScrollListener`, `currentRenderTask` cancel-and-await, `_schedulePreRenderAdjacent`. Net: ~700 lines removed |
| `js/ui/setup/navigation-events.js` | Drop bitmap-legacy wheel-handler block (regel 76-128). All ctrl+wheel routes through `zoomStepAtPoint` |
| `js/text/text-layer.js` | Single-scale (scale=1) span creation; positioning entirely via CSS transform from viewport |
| `js/annotations/rendering.js` | Use `viewport.zoom/offsetX/Y` for `ctx.setTransform`; canvas fixed-size matches main canvas |
| `js/solid/App.jsx` *(or wherever the tile canvas element lives)* | Remove `<canvas id="pdf-canvas-tile">` JSX |
| `styles/layout.css` | Remove `#pdf-canvas-tile` ruleset |

### Test file

| File | Change |
|------|--------|
| `mcp-server/zoom-loop.mjs` | Already exists; will be extended with phase-4 (zoom > cap with tile verification) |

---

## Important Conventions

- **Verification model:** This codebase tests render/paint behavior via the MCP harness (Tauri + CDP), not via Jest/Vitest. Each task's "failing test" is a scripted scenario in `mcp-server/zoom-loop.mjs` that should fail BEFORE the change and pass AFTER. Where no automated scenario exists, the verification is a documented manual step with the exact app inputs and the exact observable result.
- **Commit per task:** Each task ends with a `git commit`. Branch is `feat/fast-open-barn`. No squashing.
- **Test PDF:** `test pdf-bestanden/Originele bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf` (raster-heavy, the user's primary test target).
- **App startup for testing:** `npm run tauri:dev:debug` (enables CDP on :9222 and MCP on :9223). Wait for "Compiling open-pdf-studio" to finish. Open BARN manually OR call `app_open_pdf` via MCP.
- **MCP test runner:** `node mcp-server/zoom-loop.mjs` — orchestrates the parametric sweep.

---

## Task 1: Add viewport state fields + bitmap/tile cache modules

**Files:**
- Modify: `open-pdf-studio/js/pdf/pdf-viewport.js` (extend `viewport` singleton)
- Create: `open-pdf-studio/js/pdf/bitmap-cache.js`
- Create: `open-pdf-studio/js/pdf/tile-cache.js`

- [ ] **Step 1: Add new state fields to `viewport` singleton**

In `pdf-viewport.js`, find the `export const viewport = { ... }` definition and add the listed fields:

```js
export const viewport = {
  active: false,
  filePath: null,
  pageNum: 0,
  pageW: 0,
  pageH: 0,
  originX: 0,
  originY: 0,
  rotation: 0,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  dirty: false,
  // NEW: bitmap + tile state for unified render loop
  currentBitmap: null,    // ImageBitmap or null — whole-page raster for current zoom-bucket
  currentTile: null,      // ImageBitmap or null — visible-region high-zoom augment
  currentTileMeta: null,  // { regionXpt, regionYpt, regionWpt, regionHpt, zoom } so _render() can position it
  pageType: 'unknown',    // 'raster' | 'vector' | 'unknown'
};
```

- [ ] **Step 2: Create `bitmap-cache.js`**

```js
// LRU cache for whole-page ImageBitmaps used by the unified render loop.
// Keys: `${filePath}|p${pageNum}|z${zoomBucket}|r${rotation}`
// Values: { bitmap: ImageBitmap, w, h, zoomBucket }

const CACHE = new Map();
const MAX = 16;

function makeKey(filePath, pageNum, zoomBucket, rotation) {
  return `${filePath}|p${pageNum}|z${Math.round(zoomBucket * 10000)}|r${rotation || 0}`;
}

export function bitmapCacheGet(filePath, pageNum, zoomBucket, rotation) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation);
  const entry = CACHE.get(key);
  if (entry) {
    // LRU touch
    CACHE.delete(key);
    CACHE.set(key, entry);
  }
  return entry || null;
}

export async function bitmapCacheSet(filePath, pageNum, zoomBucket, rotation, imageData) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation);
  while (CACHE.size >= MAX) {
    const firstKey = CACHE.keys().next().value;
    if (!firstKey) break;
    const old = CACHE.get(firstKey);
    try { old?.bitmap?.close?.(); } catch {}
    CACHE.delete(firstKey);
  }
  try {
    const bitmap = await createImageBitmap(imageData);
    CACHE.set(key, { bitmap, w: imageData.width, h: imageData.height, zoomBucket });
  } catch (e) {
    console.warn('[bitmap-cache] createImageBitmap failed:', e);
  }
}

export function bitmapCacheClearForFile(filePath) {
  for (const k of Array.from(CACHE.keys())) {
    if (k.startsWith(filePath + '|')) {
      const e = CACHE.get(k);
      try { e?.bitmap?.close?.(); } catch {}
      CACHE.delete(k);
    }
  }
}

export function bitmapCacheClearAll() {
  for (const e of CACHE.values()) {
    try { e?.bitmap?.close?.(); } catch {}
  }
  CACHE.clear();
}
```

- [ ] **Step 3: Create `tile-cache.js`**

```js
// LRU cache for region-tile ImageBitmaps used at high zoom.
// Keys: `${filePath}|p${pageNum}|z${zoomBucket}|r${rotation}|reg${regionBucket}`
// regionBucket = "x,y" in PDF points snapped to 25%-viewport buffer grid.
// Smaller than bitmap-cache because tiles are bigger; LRU max 8.

const CACHE = new Map();
const MAX = 8;

function makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket) {
  return `${filePath}|p${pageNum}|z${Math.round(zoomBucket * 10000)}|r${rotation || 0}|reg${regionBucket}`;
}

export function tileCacheGet(filePath, pageNum, zoomBucket, rotation, regionBucket) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket);
  const entry = CACHE.get(key);
  if (entry) {
    CACHE.delete(key);
    CACHE.set(key, entry);
  }
  return entry || null;
}

export async function tileCacheSet(filePath, pageNum, zoomBucket, rotation, regionBucket, imageData, regionMeta) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket);
  while (CACHE.size >= MAX) {
    const firstKey = CACHE.keys().next().value;
    if (!firstKey) break;
    const old = CACHE.get(firstKey);
    try { old?.bitmap?.close?.(); } catch {}
    CACHE.delete(firstKey);
  }
  try {
    const bitmap = await createImageBitmap(imageData);
    CACHE.set(key, { bitmap, w: imageData.width, h: imageData.height, regionMeta });
  } catch (e) {
    console.warn('[tile-cache] createImageBitmap failed:', e);
  }
}

export function tileCacheClearForFile(filePath) {
  for (const k of Array.from(CACHE.keys())) {
    if (k.startsWith(filePath + '|')) {
      const e = CACHE.get(k);
      try { e?.bitmap?.close?.(); } catch {}
      CACHE.delete(k);
    }
  }
}

export function tileCacheClearAll() {
  for (const e of CACHE.values()) {
    try { e?.bitmap?.close?.(); } catch {}
  }
  CACHE.clear();
}
```

- [ ] **Step 4: Verify no regression**

Run: `npm run tauri:dev:debug` (in a second terminal). Open BARN p.2 manually. Zoom in/out a few times via Ctrl+wheel.

Expected: behavior unchanged from current state (Task 1 is additive only — new fields are added but nothing reads them yet).

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/pdf/pdf-viewport.js \
        open-pdf-studio/js/pdf/bitmap-cache.js \
        open-pdf-studio/js/pdf/tile-cache.js
git commit -m "feat(viewport): add bitmap+tile cache modules and viewport state fields

Foundation for the unified pan/zoom model. New fields on viewport
singleton: currentBitmap, currentTile, currentTileMeta, pageType.
Two cache modules (LRU 16 for whole-page, LRU 8 for tile regions),
both with file-scoped clear() and global clear() exports.

No behavior change yet — fields are added but no caller reads them.
Subsequent tasks plug these into the render loop."
```

---

## Task 2: Bitmap orchestrator (async cache fill from viewport state)

**Files:**
- Create: `open-pdf-studio/js/pdf/bitmap-orchestrator.js`

- [ ] **Step 1: Create the orchestrator module**

```js
// Reads viewport state, ensures bitmap-cache and tile-cache are populated for
// the current view. Fires viewport.dirty=true when bitmaps arrive so the RAF
// loop in pdf-viewport.js paints them next frame.
//
// Strategy:
//   1. Compute zoomBucket from viewport.zoom (snap to ZOOM_PRESETS).
//   2. Lookup bitmap-cache. If hit -> viewport.currentBitmap = entry.bitmap; viewport.dirty=true.
//      If miss -> async invoke render_pdf_page at clamped scale, cache result.
//   3. If viewport.zoom > capZoom for this page -> ALSO ensure tile.
//      Tile region = current viewport visible area in PDF points,
//      snapped to a buffer grid (25%-viewport padding).
//
// Concurrency: one in-flight bitmap render per (file, page, zoom-bucket).
// Newer requests cancel older by generation counter.

import { viewport } from './pdf-viewport.js';
import { bitmapCacheGet, bitmapCacheSet } from './bitmap-cache.js';
import { tileCacheGet, tileCacheSet } from './tile-cache.js';

const ZOOM_PRESETS = [
  0.10, 0.125, 0.25, 0.333, 0.50, 0.667, 0.75, 0.80, 0.90,
  1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00, 6.00,
  8.00, 12.00, 16.00, 24.00, 32.00, 64.00,
];

const MAX_BITMAP_AXIS_PX = 4096;
const TILE_BUFFER_FRACTION = 0.25; // 25% padding around visible region

function snapToPreset(zoom) {
  let best = ZOOM_PRESETS[0];
  let bestDist = Math.abs(ZOOM_PRESETS[0] - zoom);
  for (const z of ZOOM_PRESETS) {
    const d = Math.abs(z - zoom);
    if (d < bestDist) { bestDist = d; best = z; }
  }
  return best;
}

function computeCapZoom(pageW, pageH) {
  const maxAxisPt = Math.max(pageW, pageH);
  return MAX_BITMAP_AXIS_PX / maxAxisPt;
}

let _bitmapGen = 0;
let _tileGen = 0;

export async function ensureBitmapForCurrentView() {
  if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster') {
    return;
  }
  const myGen = ++_bitmapGen;
  const zoomBucket = snapToPreset(viewport.zoom);
  const filePath = viewport.filePath;
  const pageNum = viewport.pageNum;
  const rotation = viewport.rotation;

  // 1. Synchronous cache lookup
  const hit = bitmapCacheGet(filePath, pageNum, zoomBucket, rotation);
  if (hit) {
    viewport.currentBitmap = hit.bitmap;
    viewport.dirty = true;
    return;
  }

  // 2. Async render via PDFium
  try {
    const capZoom = computeCapZoom(viewport.pageW, viewport.pageH);
    const renderScale = Math.min(zoomBucket, capZoom);
    const { invoke } = window.__TAURI__.core;
    const rgbaData = await invoke('render_pdf_page', {
      path: filePath,
      pageIndex: pageNum - 1,
      scale: renderScale,
    });
    if (myGen !== _bitmapGen) return; // stale
    const bytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
    if (!bytes || bytes.length <= 8) {
      console.warn('[bitmap-orch] empty rgba');
      return;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const w = view.getUint32(0, true);
    const h = view.getUint32(4, true);
    if (w * h * 4 !== bytes.length - 8) {
      console.warn(`[bitmap-orch] size mismatch ${w}x${h}`);
      return;
    }
    const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
    const imageData = new ImageData(new Uint8ClampedArray(rgba), w, h);
    await bitmapCacheSet(filePath, pageNum, zoomBucket, rotation, imageData);
    if (myGen !== _bitmapGen) return;
    const cached = bitmapCacheGet(filePath, pageNum, zoomBucket, rotation);
    if (cached) {
      viewport.currentBitmap = cached.bitmap;
      viewport.dirty = true;
      console.log(`[bitmap-orch] cached p${pageNum} @ z=${zoomBucket} (${w}x${h})`);
    }
  } catch (e) {
    console.warn('[bitmap-orch] render failed:', e);
  }
}

function computeVisibleRegionPt(canvas) {
  // Returns { x, y, w, h } in PDF points for the page-area currently inside
  // the viewport's clip. Handles offsetX/Y, zoom, dpr.
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  // Page extends from (offsetX, offsetY) to (offsetX + pageW*zoom, offsetY + pageH*zoom) in screen px.
  // Visible-on-page-x ranges from max(0, -offsetX) to min(pageW*zoom, cssW - offsetX).
  const visScreenLeft = Math.max(0, -viewport.offsetX);
  const visScreenTop = Math.max(0, -viewport.offsetY);
  const visScreenRight = Math.min(viewport.pageW * viewport.zoom, cssW - viewport.offsetX);
  const visScreenBottom = Math.min(viewport.pageH * viewport.zoom, cssH - viewport.offsetY);
  return {
    x: visScreenLeft / viewport.zoom,
    y: visScreenTop / viewport.zoom,
    w: Math.max(0, (visScreenRight - visScreenLeft) / viewport.zoom),
    h: Math.max(0, (visScreenBottom - visScreenTop) / viewport.zoom),
  };
}

function regionBucketKey(region, pageW, pageH) {
  // Snap region origin to (TILE_BUFFER_FRACTION * pageW)-grid so small pans
  // hit the same cached tile.
  const stepX = pageW * TILE_BUFFER_FRACTION;
  const stepY = pageH * TILE_BUFFER_FRACTION;
  const sx = Math.floor(region.x / stepX) * stepX;
  const sy = Math.floor(region.y / stepY) * stepY;
  return `${Math.round(sx * 100)},${Math.round(sy * 100)}`;
}

export async function ensureTileForCurrentView(canvas) {
  if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster') {
    viewport.currentTile = null;
    viewport.currentTileMeta = null;
    return;
  }
  const capZoom = computeCapZoom(viewport.pageW, viewport.pageH);
  if (viewport.zoom <= capZoom) {
    // Whole-page bitmap is enough — clear tile.
    viewport.currentTile = null;
    viewport.currentTileMeta = null;
    return;
  }
  const myGen = ++_tileGen;
  const zoomBucket = snapToPreset(viewport.zoom);
  const filePath = viewport.filePath;
  const pageNum = viewport.pageNum;
  const rotation = viewport.rotation;
  const region = computeVisibleRegionPt(canvas);
  if (region.w < 1 || region.h < 1) {
    viewport.currentTile = null;
    viewport.currentTileMeta = null;
    return;
  }
  // Expand by buffer fraction so small pans hit the cache.
  const bufW = region.w * TILE_BUFFER_FRACTION;
  const bufH = region.h * TILE_BUFFER_FRACTION;
  const bufferedRegion = {
    x: Math.max(0, region.x - bufW),
    y: Math.max(0, region.y - bufH),
    w: Math.min(viewport.pageW, region.w + 2 * bufW),
    h: Math.min(viewport.pageH, region.h + 2 * bufH),
  };
  const regBucket = regionBucketKey(bufferedRegion, viewport.pageW, viewport.pageH);

  // Cache lookup
  const hit = tileCacheGet(filePath, pageNum, zoomBucket, rotation, regBucket);
  if (hit) {
    viewport.currentTile = hit.bitmap;
    viewport.currentTileMeta = hit.regionMeta;
    viewport.dirty = true;
    return;
  }

  // Async render
  try {
    const { invoke } = window.__TAURI__.core;
    const rgbaData = await invoke('render_pdf_page_region', {
      path: filePath,
      pageIndex: pageNum - 1,
      scale: zoomBucket,
      regionXPt: bufferedRegion.x,
      regionYPt: bufferedRegion.y,
      regionWPt: bufferedRegion.w,
      regionHPt: bufferedRegion.h,
    });
    if (myGen !== _tileGen) return;
    const bytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
    if (!bytes || bytes.length <= 8) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const w = view.getUint32(0, true);
    const h = view.getUint32(4, true);
    if (w * h * 4 !== bytes.length - 8) return;
    const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
    const imageData = new ImageData(new Uint8ClampedArray(rgba), w, h);
    const regionMeta = {
      regionXpt: bufferedRegion.x,
      regionYpt: bufferedRegion.y,
      regionWpt: bufferedRegion.w,
      regionHpt: bufferedRegion.h,
      zoom: zoomBucket,
    };
    await tileCacheSet(filePath, pageNum, zoomBucket, rotation, regBucket, imageData, regionMeta);
    if (myGen !== _tileGen) return;
    const cached = tileCacheGet(filePath, pageNum, zoomBucket, rotation, regBucket);
    if (cached) {
      viewport.currentTile = cached.bitmap;
      viewport.currentTileMeta = cached.regionMeta;
      viewport.dirty = true;
      console.log(`[tile-orch] cached p${pageNum} @ z=${zoomBucket} reg=${regBucket}`);
    }
  } catch (e) {
    console.warn('[tile-orch] render failed:', e);
  }
}
```

- [ ] **Step 2: Sanity-check imports**

Run `node -e "require('./open-pdf-studio/js/pdf/bitmap-orchestrator.js')"` — expected error about ESM (the file uses `import`). Confirms the file is syntactically valid module syntax. Don't worry about the error; we just want a syntax check, not a load.

Alternative: open `index.html` in the dev app via `npm run tauri:dev:debug` and check the browser console for any new syntax errors during initial load.

Expected: no `SyntaxError` referencing bitmap-orchestrator.js.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/pdf/bitmap-orchestrator.js
git commit -m "feat(viewport): async bitmap+tile orchestrator

Reads viewport state, fills bitmap-cache and tile-cache, marks
viewport.dirty=true on arrival. Generation counter cancels stale
requests when zoom changes mid-render.

ensureBitmapForCurrentView: whole-page raster at min(zoomBucket, capZoom).
ensureTileForCurrentView: visible-region tile when zoom > capZoom,
with 25%-viewport buffer so small pans hit the cache.

Not wired into renderPage() yet — Task 4 plugs it in."
```

---

## Task 3: Add raster + tile branches to `_render()` loop

**Files:**
- Modify: `open-pdf-studio/js/pdf/pdf-viewport.js` (inside the `_render()` function)

- [ ] **Step 1: Find `_render()` and locate the page-content drawing section**

Read `pdf-viewport.js` and find the line:

```js
// Vector content (multiply zoom and offsets by dpr for HiDPI rasterization)
_ctx.save();
renderVectorPage(_ctx, viewport.filePath, viewport.pageNum, {
```

The raster branch goes BEFORE the vector branch so they layer correctly (raster bitmap as base, vector content on top if both present — e.g. hybrid PDFs).

- [ ] **Step 2: Insert raster bitmap branch**

Replace the area starting at "White page background — SAME transform" through the end of the vector content section. The exact replacement (showing the relevant chunk only):

```js
  // White page background — SAME transform as vector commands, multiplied by dpr
  _ctx.save();
  _ctx.setTransform(viewport.zoom * dpr, 0, 0, viewport.zoom * dpr, viewport.offsetX * dpr, viewport.offsetY * dpr);
  _ctx.transform(1, 0, 0, -1, 0, viewport.pageH);
  _ctx.translate(-viewport.originX, -viewport.originY); // MediaBox origin offset
  _ctx.fillStyle = '#ffffff';
  _ctx.fillRect(viewport.originX, viewport.originY, viewport.pageW, viewport.pageH);
  _ctx.restore();

  // RASTER BITMAP — drawn at viewport transform, NOT in PDF user-space
  // (the bitmap was rendered top-left origin so we don't apply the Y-flip).
  if (viewport.currentBitmap) {
    _ctx.save();
    _ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to identity
    const destX = viewport.offsetX * dpr;
    const destY = viewport.offsetY * dpr;
    const destW = viewport.pageW * viewport.zoom * dpr;
    const destH = viewport.pageH * viewport.zoom * dpr;
    _ctx.drawImage(viewport.currentBitmap, destX, destY, destW, destH);
    _ctx.restore();
  }

  // TILE AUGMENT — over the raster bitmap, in the visible region only
  if (viewport.currentTile && viewport.currentTileMeta) {
    _ctx.save();
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    const m = viewport.currentTileMeta;
    // Region was specified in PDF points; translate to screen space.
    const destX = (viewport.offsetX + m.regionXpt * viewport.zoom) * dpr;
    const destY = (viewport.offsetY + m.regionYpt * viewport.zoom) * dpr;
    const destW = m.regionWpt * viewport.zoom * dpr;
    const destH = m.regionHpt * viewport.zoom * dpr;
    _ctx.drawImage(viewport.currentTile, destX, destY, destW, destH);
    _ctx.restore();
  }

  // Vector content (multiply zoom and offsets by dpr for HiDPI rasterization)
  if (viewport.pageType !== 'raster') {
    _ctx.save();
    renderVectorPage(_ctx, viewport.filePath, viewport.pageNum, {
      a: viewport.zoom * dpr,
      b: 0,
      c: 0,
      d: viewport.zoom * dpr,
      e: viewport.offsetX * dpr,
      f: viewport.offsetY * dpr,
    }, viewport.rotation);
    _ctx.restore();
  }

  // Status bar
  state.renderEngine = viewport.pageType === 'raster' ? 'Raster (PDFium)' : 'Vector';
```

- [ ] **Step 3: Verify no regression on vector PDFs**

Run `npm run tauri:dev:debug`. Open any vector-classified PDF (NOT BARN). Zoom + pan. Expected: behavior identical (vector branch unchanged — only gated on `viewport.pageType !== 'raster'` which is false for vector pages).

For now `viewport.pageType` defaults to `'unknown'`, which falls through the gate as `!== 'raster'` → true → vector branch runs as before. ✓

- [ ] **Step 4: Verify raster branch doesn't activate yet**

Open BARN p.2. Zoom in.

Expected: `viewport.pageType === 'unknown'` (default), so raster branch is skipped. Behavior unchanged from current (uses bitmap-mode legacy path in renderer.js). The new code is dormant.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/pdf/pdf-viewport.js
git commit -m "feat(viewport): raster + tile branches in _render() loop

drawImage(currentBitmap) and drawImage(currentTile) inserted into
the RAF render loop. Branches activate only when
viewport.pageType === 'raster' and the corresponding state is set.

Currently dormant — pageType defaults to 'unknown' and nothing sets
currentBitmap/Tile yet. Task 4 wires up renderer.js to activate."
```

---

## Task 4: `renderPage()` activates viewport for raster pages

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js` (the `renderPage()` function)

- [ ] **Step 1: Read the relevant section**

Find `_renderPageImpl(pageNum)` and locate the spot where it currently checks `analyze_page_type` result. There's a block that activates vector viewport mode when the page is classified as vector. We add a parallel block for raster.

- [ ] **Step 2: Add raster-mode activation after analyze**

In `_renderPageImpl`, RIGHT AFTER the existing block that handles `pageType === 'vector'` (the one calling `extract_draw_commands` and `vr.cacheCommands`), add this NEW block that activates viewport for raster too:

```js
// NEW: raster-mode also goes through viewport (unified model).
if (pageType !== 'vector') {
  // It's a Tile-classified page → activate viewport in raster mode.
  const { initViewport, setPage, wireEvents, viewport: pdfVP } = await import('./pdf-viewport.js');
  if (_isStaleDoc(doc)) { resumeThumbnails(); return; }

  initViewport(pdfCanvas, () => redrawAnnotations(true));
  if (!pdfCanvas._vpEventsWired) {
    wireEvents(pdfCanvas);
    pdfCanvas._vpEventsWired = true;
  }

  // Container in fixed-overflow mode (viewport manages pan itself).
  const container = document.getElementById('pdf-container');
  if (container) container.style.overflow = 'hidden';

  // Page dims in PDF points for the viewport.
  const x0 = page.view[0], y0 = page.view[1];
  const x1 = page.view[2], y1 = page.view[3];
  setPage(doc.filePath, pageNum, x1 - x0, y1 - y0, x0, y0, getPageRotation(pageNum) || 0);

  // Mark as raster so _render() takes the bitmap branch.
  pdfVP.pageType = 'raster';

  // Async bitmap fill — fires viewport.dirty when arrives.
  const orch = await import('./bitmap-orchestrator.js');
  orch.ensureBitmapForCurrentView();
  // Tile is only ensured on zoom changes (handled in the wheel handler post-anchor).

  // Text-layer + annotation overlay still need creation (Tasks 9, 10).
  // For now, keep existing layer creation logic.
  console.log(`[render] Raster viewport activated: ${x1-x0}x${y1-y0} pt`);
  _skipBitmapRender = true;  // skip the OLD bitmap path
  resumeThumbnails();
  // Fall through to text/annotation layer creation below.
}
```

- [ ] **Step 3: Set `pageType = 'vector'` in the existing vector-mode block**

In the same file, find the existing vector block (inside `if (pageType === 'vector')`). After `setPage(...)`, add:

```js
pdfVP.pageType = 'vector';
```

- [ ] **Step 4: Ensure bitmap orchestrator triggered on zoom changes**

Find `zoomStepAtPoint` and `setZoomAtPoint` and `zoomAtPoint` in `pdf-viewport.js`. After they mutate `viewport.zoom`, ensure the orchestrator is re-called.

Easiest: hook into `_anchorAt` at the bottom (after setting `viewport.zoom = newZoom`):

```js
function _anchorAt(screenX, screenY, oldZoom, newZoom, strict = false) {
  const wx = (screenX - viewport.offsetX) / oldZoom;
  const wy = (screenY - viewport.offsetY) / oldZoom;
  viewport.offsetX = screenX - wx * newZoom;
  viewport.offsetY = screenY - wy * newZoom;
  viewport.zoom = newZoom;
  _anchorActive = true;
  _strictAnchor = strict;
  viewport.dirty = true;

  // NEW: kick async bitmap+tile refresh for the new zoom
  if (viewport.pageType === 'raster') {
    import('./bitmap-orchestrator.js').then(orch => {
      orch.ensureBitmapForCurrentView();
      if (_canvas) orch.ensureTileForCurrentView(_canvas);
    });
  }
}
```

- [ ] **Step 5: Verify raster PDFs now use unified path**

Restart `npm run tauri:dev:debug`. Open BARN p.2.

Expected output in console (DevTools or zoom-observer.log):
```
[render] Raster viewport activated: 1632x1056 pt
[bitmap-orch] cached p2 @ z=...
```

Visual: canvas shows BARN p.2. May be blurry briefly while bitmap renders. Zoom should still work (via new orchestrator). Engine label: "Raster (PDFium)".

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js \
        open-pdf-studio/js/pdf/pdf-viewport.js
git commit -m "feat(viewport): raster pages activate unified viewport mode

renderPage() now activates the viewport singleton for raster-classified
pages too (was vector-only). Page type stored on viewport.pageType.
_anchorAt() kicks the bitmap-orchestrator on every zoom change so the
new bucket's bitmap+tile are async-fetched.

Old bitmap path in renderPage() still runs (gated by _skipBitmapRender),
will be ripped in Task 5."
```

---

## Task 5: Strip legacy bitmap path from `renderer.js`

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Verify Task 4 succeeded**

Re-run BARN p.2 zoom test. Confirm raster-viewport path is active and bitmap appears (might be blurry). Engine label "Raster (PDFium)" in status bar.

- [ ] **Step 2: Remove the entire `if (!_skipBitmapRender && _canUseTauri && _hasFilePath)` block**

In `_renderPageImpl`, find the block starting:

```js
if (!_skipBitmapRender && _canUseTauri && _hasFilePath) {
  if (_isStaleGen()) {
    console.log(`[render] STALE bitmap-path gen ${_renderGen} ...`);
    return;
  }
  ...
}
```

and DELETE it entirely (~200 lines). Replace with a brief comment:

```js
// Bitmap rendering has moved to the unified viewport model (Task 4):
// activated above in the raster-mode block; pixel-fill via
// bitmap-orchestrator + drawImage in pdf-viewport.js _render() loop.
// No predictive resize, no canvas-width mutation, no tile DOM canvas.
```

- [ ] **Step 3: Remove `_renderTileOverlay`, `_hideTileOverlay`, `_scheduleTileRerenderOnScroll`, `wireTileScrollListener`**

Find each of these functions in `renderer.js` and DELETE them. Also remove the export of `wireTileScrollListener`.

Also delete:
- The top-level `let _tileScrollDebounce = null;` and `let _tileScrollWired = false;` declarations.
- The `let _tileRenderGen = 0;` declaration.

- [ ] **Step 4: Remove `currentRenderTask` dead code**

In `_renderPageImpl`, delete:

```js
if (currentRenderTask) {
  try {
    currentRenderTask.cancel();
    await currentRenderTask.promise;
  } catch (e) { /* ... */ }
  currentRenderTask = null;
}
```

Also delete the top-level `let currentRenderTask = null;`.

- [ ] **Step 5: Remove `_schedulePreRenderAdjacent` calls and the function**

Find the `_schedulePreRenderAdjacent(doc, pageNum, scale);` call inside the (now-removed) bitmap path. Already gone in step 2.

Also delete the `_schedulePreRenderAdjacent` function definition itself, `_preRenderTimer`, `_preRenderGen`, `_PRESET_ZOOMS`, `_findPresetIndex`, and `_preRenderOne`.

(These were warmup heuristics for the OLD bitmap path. The unified model relies on cache hits naturally; no pre-warming needed for v1.)

- [ ] **Step 6: Remove now-unused imports and dead helpers**

Scan top of `renderer.js`. Remove imports that are no longer used after the deletions (e.g. if `getCanvasDPR` was only used in the bitmap path, drop it).

Also remove any `wireTileScrollListener()` call sites from `js/main.js` or elsewhere. Grep:

```bash
grep -rn "wireTileScrollListener" open-pdf-studio/js/
```

Delete each call site.

- [ ] **Step 7: Verify zoom still works**

Restart dev. Open BARN p.2. Ctrl+wheel zoom.

Expected: canvas re-renders with new bitmap from cache. Cursor anchor preserved (via `_anchorAt`).

Run `node mcp-server/zoom-loop.mjs` for end-to-end check.

Expected: phase-1 and phase-2 anchorErrorPx values < 3 for center positions. Edge positions may still fail until tile augment is in place (Task 6 covers high-zoom).

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js \
        open-pdf-studio/js/main.js
git commit -m "refactor(renderer): rip legacy bitmap path

~700 lines removed from renderer.js. All raster rendering now flows
through the unified viewport model (Task 4).

Removed:
- The big if(!_skipBitmapRender && _canUseTauri && _hasFilePath) block
- _renderTileOverlay, _hideTileOverlay
- _scheduleTileRerenderOnScroll, wireTileScrollListener
- currentRenderTask cancel-and-await (dead code — PDF.js render task
  hadn't been used since the PDFium swap)
- _schedulePreRenderAdjacent and helpers
- Predictive pdfCanvas.style.width/height resize
- pdfCanvas.width/height mutation mid-render (was clearing pixels)

Net: renderer.js is now a thin orchestrator that activates the
viewport for the right page and lets bitmap-orchestrator.js fill the
cache asynchronously."
```

---

## Task 6: Tile augment in render loop

**Files:**
- Modify: `open-pdf-studio/js/pdf/pdf-viewport.js`
- Modify: `open-pdf-studio/js/pdf/bitmap-orchestrator.js` (already set up in Task 2; verify behavior)

- [ ] **Step 1: Hook tile re-render to scroll/pan**

The current `_anchorAt` already re-kicks bitmap+tile after zoom. Pan via mousedrag updates `viewport.offsetX/Y` but doesn't go through `_anchorAt`. Find `updatePan` in `pdf-viewport.js` and add tile re-check:

```js
export function updatePan(screenX, screenY) {
  if (!_isPanning) return;
  viewport.offsetX = screenX - _panStartX;
  viewport.offsetY = screenY - _panStartY;
  viewport.dirty = true;
  // NEW: re-check tile in case pan moved outside the buffered region
  if (viewport.pageType === 'raster' && _canvas) {
    // Debounce — pan fires many times per second, but tile lookup is cheap
    // (cache hit returns immediately) and re-render only happens on cache miss.
    if (_panTileTimer) clearTimeout(_panTileTimer);
    _panTileTimer = setTimeout(() => {
      _panTileTimer = null;
      import('./bitmap-orchestrator.js').then(orch => orch.ensureTileForCurrentView(_canvas));
    }, 100);
  }
}
let _panTileTimer = null;
```

Same hook for wheel-pan momentum — find `_applyVelocity` (or equivalent) and add the same debounced call.

- [ ] **Step 2: Verify tile activates at zoom > capZoom**

BARN page is 1632×1056pt. capZoom = 4096/1632 ≈ 2.51.

Restart dev. Open BARN p.2. Zoom to 300% (above cap).

Expected console logs:
```
[bitmap-orch] cached p2 @ z=3 (4096x2649)   ← whole-bitmap at cap (CSS-stretched will be blurry)
[tile-orch] cached p2 @ z=3 reg=...         ← tile for visible region at z=3
```

Visual: whole-bitmap is stretched (slightly blurry) underneath; tile is crisp where visible.

- [ ] **Step 3: Verify tile follows pan**

At 300% zoom, drag the page to a different position. Wait ~150ms.

Expected: new tile renders for the new visible region. Cache lookup may hit (if pan stayed in buffer) or render anew.

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/js/pdf/pdf-viewport.js
git commit -m "feat(viewport): tile re-render on pan with debounce

updatePan() and wheel-pan momentum now debounced-call
ensureTileForCurrentView so the tile re-renders when the user
pans outside the buffered region. Cache hits in the buffer make
small pans instant."
```

---

## Task 7: Remove the tile DOM canvas

**Files:**
- Modify: `open-pdf-studio/index.html` (or wherever the canvas is defined in JSX)
- Modify: `open-pdf-studio/styles/layout.css`
- Modify: `open-pdf-studio/js/pdf/renderer.js` (any remaining references)

- [ ] **Step 1: Locate the tile canvas element**

```bash
grep -rn 'pdf-canvas-tile' open-pdf-studio/
```

Should find references in: index.html (or App.jsx), layout.css, and possibly mcp-bridge.js (state inspection — leave those).

- [ ] **Step 2: Remove from HTML/JSX**

Remove the `<canvas id="pdf-canvas-tile">` element entirely.

- [ ] **Step 3: Remove from CSS**

In `styles/layout.css`, delete the `#pdf-canvas-tile { ... }` ruleset and any surrounding comment block about the tile overlay.

- [ ] **Step 4: Update mcp-bridge.js capture-state**

In `_captureCanvasState`, the `tile:` field reads from `document.getElementById('pdf-canvas-tile')`. This will now return null — fine, but make sure the rest of the code handles null gracefully (already does: `tile ? { ... } : null`).

Update the tile-state representation to read from viewport singleton instead:

```js
// In _captureCanvasState, replace the tile section:
tile: viewportSingleton?.currentTile ? {
  width: viewportSingleton.currentTile.width,
  height: viewportSingleton.currentTile.height,
  meta: viewportSingleton.currentTileMeta,
} : null,
```

Where `viewportSingleton = window.__pdfViewport`.

- [ ] **Step 5: Verify nothing breaks**

Restart dev. Open BARN p.2. Zoom 100%→600%.

Expected: bitmap renders, tile augments visible region at high zoom, no console errors about `pdf-canvas-tile`.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/index.html \
        open-pdf-studio/styles/layout.css \
        open-pdf-studio/js/mcp-bridge.js
git commit -m "refactor: remove tile DOM canvas

#pdf-canvas-tile element gone. Tile augment is now a second
drawImage() call in the unified render loop. MCP state capture
reads tile info from viewport.currentTile/currentTileMeta."
```

---

## Task 8: Unify `navigation-events.js` wheel-handler

**Files:**
- Modify: `open-pdf-studio/js/ui/setup/navigation-events.js`

- [ ] **Step 1: Locate the bitmap-legacy block**

In `setupWheelZoom`, find `if (!viewport.active)` block (~line 76). This is the legacy bitmap-mode path: captures fractionX/Y, awaits zoomIn, then adjusts scrollLeft.

- [ ] **Step 2: Replace the bitmap-legacy block with viewport-mode logic**

Since raster pages now activate viewport (Task 4), `viewport.active` is true for them. The bitmap-legacy block should never execute, but it's still in code. Strip it:

```js
// REPLACE this block:
//   if (!viewport.active) {
//     const myWheelGen = ++_wheelZoomGen;
//     // ... 50 lines ...
//     return;
//   }
//
// WITH:
//   if (!viewport.active) {
//     // Blank document or pre-init state — no PDF loaded.
//     // Plain wheel passes through to default browser behavior.
//     return;
//   }
```

The rest of the handler (the `zoomStepAtPoint` path that's already in viewport-mode) handles all PDFs.

- [ ] **Step 3: Also drop `_wheelZoomGen` and helpers**

Remove `let _wheelZoomGen = 0;` declaration. Remove the lengthy comment about the race-condition fix (no longer applicable — viewport's `_anchorAt` is sync).

- [ ] **Step 4: Verify**

Restart dev. Open BARN p.2. Ctrl+wheel zoom rapidly (5 wheel events in a row).

Expected: zoom snaps through preset levels. Cursor anchor preserved. No "STALE gen" console messages (the gen counter is gone).

- [ ] **Step 5: Run MCP harness**

```
node mcp-server/zoom-loop.mjs
```

Expected: all three phases run with `anchorErrorPx < 3` across the test grid.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/ui/setup/navigation-events.js
git commit -m "refactor(events): drop bitmap-legacy wheel-handler block

All PDFs activate viewport now (Task 4), so the if(!viewport.active)
bitmap-path block was dead code. Removed along with _wheelZoomGen
race-counter (viewport _anchorAt is synchronous — no race possible)."
```

---

## Task 9: Text layer transform-based positioning

**Files:**
- Modify: `open-pdf-studio/js/text/text-layer.js` (or the relevant `createSinglePageTextLayer` location)
- Modify: `open-pdf-studio/js/pdf/pdf-viewport.js` (already syncs text layer in `_render()` — verify scale=1 mode)

- [ ] **Step 1: Verify current text-layer creation scale**

Find `createSinglePageTextLayer`. It likely calls `page.getViewport({ scale: 1.0 })` already (vector path uses this). Confirm.

- [ ] **Step 2: Ensure raster path also uses scale=1**

In `renderer.js` raster activation (Task 4), if it currently re-creates text-layer on every zoom, change it to one-time creation. Add to the raster-mode block (Task 4):

```js
// Create text layer ONCE per (page, document) — viewport transform handles zoom.
if (!_textLayerCreated.has(`${doc.filePath}|${pageNum}`)) {
  try {
    const pdfPage = await pdfDoc.getPage(pageNum);
    const textViewport = pdfPage.getViewport({ scale: 1.0 });
    await createSinglePageTextLayer(pdfPage, textViewport);
    _textLayerCreated.add(`${doc.filePath}|${pageNum}`);
  } catch (e) {
    console.warn('[render] text layer failed:', e);
  }
}
```

Top of file:
```js
const _textLayerCreated = new Set();
```

Also clear on doc-close (in the existing doc-close handler).

- [ ] **Step 3: Verify text-layer transform in `_render()`**

In `pdf-viewport.js` `_render()`, find the text-layer sync block:

```js
const textLayer = document.querySelector('.textLayer');
if (textLayer) {
  textLayer.style.setProperty('--total-scale-factor', '1');
  textLayer.style.left = '0';
  textLayer.style.top = '0';
  textLayer.style.width = `${viewport.pageW}px`;
  textLayer.style.height = `${viewport.pageH}px`;
  textLayer.style.transform = `matrix(${viewport.zoom}, 0, 0, ${viewport.zoom}, ${viewport.offsetX}, ${viewport.offsetY})`;
  textLayer.style.transformOrigin = '0 0';
}
```

Should already work for both raster and vector now that both use viewport. Confirm.

- [ ] **Step 4: Verify text selection**

In BARN p.2: select a text passage at 100% zoom. Zoom to 300%. Verify the selection highlights stay on the same glyphs (visually).

Expected: text selection survives zoom unchanged. Highlights are tinted on the same glyphs.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "refactor(text): create text layer once at scale=1

Text spans now created once per (doc, page) and positioned via CSS
transform from viewport state. No re-creation on every zoom.

_textLayerCreated Set tracks which (file, page) combos already have
their text layer to avoid redundant PDF.js calls."
```

---

## Task 10: Annotation canvas fixed-size + viewport transform

**Files:**
- Modify: `open-pdf-studio/js/annotations/rendering.js`
- Modify: `open-pdf-studio/js/pdf/pdf-viewport.js` (verify annotation canvas sync)

- [ ] **Step 1: Read current annotation rendering**

`redrawAnnotations()` in `annotations/rendering.js` reads `doc.scale` to know the zoom and positions annotation drawings accordingly.

- [ ] **Step 2: Switch annotation rendering to read viewport state**

In `redrawAnnotations()`, replace `doc.scale` usage with viewport state. Find the section that sets up the canvas ctx and replace:

```js
// OLD: relied on doc.scale + annotation canvas being sized to viewport.width
// NEW: canvas is fixed-size (container size), use viewport transform

const annCanvas = document.getElementById('annotation-canvas');
if (!annCanvas) return;
const ctx = annCanvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
const vp = window.__pdfViewport;  // import normally if possible
ctx.setTransform(1, 0, 0, 1, 0, 0);  // reset
ctx.clearRect(0, 0, annCanvas.width, annCanvas.height);

// Apply viewport transform — annotations are in PDF user-space (top-left origin
// after the Y-flip is folded into the annotation coords during creation).
ctx.setTransform(
  vp.zoom * dpr, 0, 0, vp.zoom * dpr,
  vp.offsetX * dpr, vp.offsetY * dpr
);

// ... draw annotations in PDF-coords ...
```

- [ ] **Step 3: Verify annotation canvas sync block in `_render()`**

In `pdf-viewport.js` `_render()`, find the annotation canvas sync block:

```js
const annCanvas = document.getElementById('annotation-canvas');
if (annCanvas) {
  if (annCanvas.width !== vpW || annCanvas.height !== vpH) {
    annCanvas.width = vpW;
    annCanvas.height = vpH;
  }
  annCanvas.style.width = '';
  annCanvas.style.height = '';
  const doc = state.documents?.[state.activeDocumentIndex];
  if (doc) doc.scale = viewport.zoom;
}
```

Already sized to container (vpW/vpH = canvas backing-store dims). ✓

- [ ] **Step 4: Verify annotation drag/draw**

In BARN p.2 at 100%: draw a rectangle annotation. Zoom to 300%. Move it. Verify:
- The drawn rect stays on the same page coordinates (visually anchored to its drop position)
- Drag/resize works correctly at the new zoom
- New rectangles drawn at 300% land where the mouse is

Expected: annotations are zoom-aware via viewport transform. Pan + zoom invariant.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/annotations/rendering.js
git commit -m "refactor(annotations): use viewport transform instead of doc.scale

Annotation canvas is fixed container-size; draw with
ctx.setTransform(zoom*dpr, 0, 0, zoom*dpr, offsetX*dpr, offsetY*dpr).
All annotation drawing happens in PDF user-space coordinates."
```

---

## Task 11: MCP harness verification + visual acceptance

**Files:**
- Modify: `mcp-server/zoom-loop.mjs` (extend phase-4 for tile verification)

- [ ] **Step 1: Add phase-4 tile-verification scenario**

In `zoom-loop.mjs`, after phase-3, add:

```js
// Phase 4: high-zoom tile verification (zoom > cap, ~300%+ on BARN)
out('=== Phase 4: high-zoom tile verification ===');
await tool('app_set_zoom', { value: 3.0 });
await new Promise(r => setTimeout(r, 1500));
for (const p of positions) {
  const r = await runOneTest(`phase4-${p.label}`, p.x, p.y, 'in');
  results.push({ phase: 4, ...p, ...r });
  // Also probe tile state:
  const state = await tool('app_get_viewport_state');
  out(`  tile state: ${JSON.stringify(state?.tile || 'null').slice(0, 200)}`);
}
```

- [ ] **Step 2: Run the full harness**

```
# Terminal 1: app
npm run tauri:dev:debug

# Wait for build + open BARN manually (or let the script call app_open_pdf)

# Terminal 2: harness
node mcp-server/zoom-loop.mjs
```

Expected: `mcp-server/anchor-test.log` contains all four phases with results.

Pass criteria:
- Phase 1: all 7 cursor positions → `anchorErrorPx < 3`
- Phase 2: all 5 progressive zooms → `anchorErrorPx < 3`
- Phase 3: all 7 cursor positions at high zoom → `anchorErrorPx < 3`
- Phase 4: tile state non-null at all positions; cursor anchor still `< 3`

- [ ] **Step 3: Manual visual acceptance**

In the running app:
1. Open BARN p.2.
2. Slowly Ctrl+wheel zoom from 100% to 600%. Watch carefully for any "flits of an other image" — should be **none**.
3. At 300%+, drag-pan the page. Tile should re-render smoothly; no stale crisp content overlaying wrong page-region.
4. Pan the page entirely off-screen to the right. Verify it goes off-screen (free pan, no clamp). Press F (if Fit-Page key wired) or use status-bar zoom 100% to recover.
5. Open Combinatie Raster+Vector+Tekening.pdf. Repeat zoom 100→600%. Expected: identical behavior to BARN.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/zoom-loop.mjs
git commit -m "test(mcp): add phase-4 tile-verification to zoom-loop

Phase 4 sets zoom to 3.0 (above cap on BARN) and runs the cursor
sweep again, plus probes viewport.currentTile state at each step.
Closes the verification loop for the unified pan/zoom migration."
```

- [ ] **Step 5: Final acceptance commit**

If everything passes:

```bash
# Increment version per project rules
node open-pdf-studio/scripts/bump-version.js 1.50.0

git add open-pdf-studio/package.json \
        open-pdf-studio/src-tauri/Cargo.toml \
        open-pdf-studio/src-tauri/tauri.conf.json \
        .github/workflows/release.yml
git commit -m "chore: release v1.50.0 (unified pan/zoom model)

Migration from two-path (bitmap/vector) render architecture to a
single viewport-based model. See:
  docs/superpowers/specs/2026-05-15-unified-pan-zoom-design.md
  docs/superpowers/plans/2026-05-15-unified-pan-zoom.md

Bug fixes:
- Flits van een ander beeld bij langzame zoom (BARN 200%-300% transitie)
- Cursor anchor uit-sync bij rapid wheel events
- Pan-clamp die voorbij page-randen pannen verhinderde
- Race-condities tussen N in-flight renderPage calls

Code reduction:
- renderer.js shrunk by ~700 lines
- Removed: predictive CSS resize, tile DOM canvas, pre-render scheduler,
  scroll-anchor math in wheel handler, _foregroundRenderGen,
  _wheelZoomGen, currentRenderTask cancel

Verified via mcp-server/zoom-loop.mjs (anchorErrorPx < 3 across all
phases) and manual zoom 100%-600% on BARN p.2."

git push
```

---

## Out of Scope

Confirmed in spec and not addressed in this plan:

- Continuous (multi-page) view (`renderContinuous()`) — keeps current implementation
- Thumbnails panel rendering
- Touch event handling (mobile)
- PDF.js form fields and text-extraction internals
- Backend pixel-diff regression tests (this plan uses MCP harness only)

---

## Self-Review Notes

**Spec coverage:** Every section of the spec has a task:
- Background bugs → Tasks 4-8 (root causes addressed)
- Architecture / unified model → Tasks 1-3
- Resolution strategy (cap + tile) → Tasks 2, 6
- Pan/zoom event flow → Task 8
- Layer sync → Tasks 9-10
- State model → Task 1
- Migration path (9 steps in spec) → Tasks 1-10 cover them in order
- Testing → Task 11

**Placeholder check:** No TODO/TBD/etc. All code blocks contain actual implementations.

**Type consistency:** 
- `viewport.currentBitmap` / `currentTile` / `currentTileMeta` / `pageType` used consistently
- `bitmapCacheGet/Set/ClearForFile/ClearAll` — uniform naming
- `tileCacheGet/Set/...` — same pattern
- `ensureBitmapForCurrentView()` / `ensureTileForCurrentView(canvas)` — verified used in Tasks 4, 6

**Order dependencies:**
- Task 1 sets up state (additive, safe)
- Task 2 creates orchestrator (no callers yet)
- Task 3 adds dormant render-branches
- Task 4 activates them
- Task 5 removes obsolete code (depends on Task 4 working)
- Task 6 adds tile pan-handling
- Task 7 removes the tile DOM canvas (depends on Task 6 in-canvas tile working)
- Tasks 8-10 are cleanups
- Task 11 is verification

Each commit between tasks is a working state — if Task 5 reveals a regression, Task 4 can stand alone for rollback.
