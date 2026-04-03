# Clean Vector Render Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang de 4-path render architectuur door 1 unified render loop: vast canvas, transform matrix zoom/pan, continuous RAF loop met dirty flag.

**Architecture:** Nieuw bestand `pdf-viewport.js` bevat alle viewport state, render loop, zoom/pan handlers. `renderer.js` wordt vereenvoudigd tot document laden + command extractie. `navigation-events.js` verliest alle zoom logica.

**Tech Stack:** Canvas2D, requestAnimationFrame, bestaande vector-renderer.js command playback

---

## File Structure

```
js/pdf/
├── pdf-viewport.js      # NIEUW: viewport state, render loop, zoom/pan
├── vector-renderer.js   # ONGEWIJZIGD: command playback
├── renderer.js          # VEREENVOUDIGD: document laden, command extractie, viewport init
└── loader.js            # ONGEWIJZIGD

js/ui/setup/
└── navigation-events.js # VEREENVOUDIGD: verwijder alle zoom logica
```

---

### Task 1: Maak pdf-viewport.js — viewport state + render loop + zoom/pan

**Files:**
- Create: `open-pdf-studio/js/pdf/pdf-viewport.js`

- [ ] **Step 1: Maak het bestand met de complete viewport module**

```javascript
// js/pdf/pdf-viewport.js
// Unified viewport: fixed canvas, transform-based zoom/pan, continuous RAF loop.
// Modeled after Open2D Studio's CADRenderer pattern.

import { renderVectorPage } from './vector-renderer.js';
import { state } from '../core/state.js';

// ─── Viewport State ─────────────────────────────────────────────────────────
export const viewport = {
  zoom: 1.5,
  offsetX: 0,
  offsetY: 0,
  pageW: 0,          // PDF page width in points
  pageH: 0,          // PDF page height in points
  filePath: null,
  pageNum: 1,
  dirty: true,
  active: false,      // true when a vector page is loaded
};

let _canvas = null;
let _ctx = null;
let _rafId = 0;

// ─── Init / Teardown ────────────────────────────────────────────────────────

export function initViewport(canvas) {
  _canvas = canvas;
  _ctx = canvas.getContext('2d');
  _resizeCanvas();
  window.addEventListener('resize', _resizeCanvas);
  _startLoop();
}

export function destroyViewport() {
  viewport.active = false;
  cancelAnimationFrame(_rafId);
  window.removeEventListener('resize', _resizeCanvas);
  _canvas = null;
  _ctx = null;
}

function _resizeCanvas() {
  if (!_canvas) return;
  const container = _canvas.parentElement;
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (_canvas.width !== w || _canvas.height !== h) {
    _canvas.width = w;
    _canvas.height = h;
    viewport.dirty = true;
  }
}

// ─── Render Loop ────────────────────────────────────────────────────────────

function _startLoop() {
  function tick() {
    if (viewport.dirty && viewport.active) {
      viewport.dirty = false;
      _render();
    }
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

function _render() {
  if (!_ctx || !_canvas || !viewport.filePath) return;
  const { width: vpW, height: vpH } = _canvas;

  // Clear
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.clearRect(0, 0, vpW, vpH);
  _ctx.fillStyle = '#e0e0e0'; // Background outside page
  _ctx.fillRect(0, 0, vpW, vpH);

  // Page background (white rectangle in world space)
  _ctx.save();
  _ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.offsetX, viewport.offsetY);
  _ctx.transform(1, 0, 0, -1, 0, viewport.pageH);
  _ctx.fillStyle = '#ffffff';
  _ctx.fillRect(0, 0, viewport.pageW, viewport.pageH);
  _ctx.restore();

  // Vector draw commands
  _ctx.save();
  renderVectorPage(_ctx, viewport.filePath, viewport.pageNum, {
    a: viewport.zoom,
    b: 0,
    c: 0,
    d: viewport.zoom,
    e: viewport.offsetX,
    f: viewport.offsetY,
  });
  _ctx.restore();

  // Update state for status bar
  state.renderEngine = 'Vector';
  state.renderTiming = '';
}

// ─── Load Page ──────────────────────────────────────────────────────────────

export function setPage(filePath, pageNum, pageW, pageH) {
  viewport.filePath = filePath;
  viewport.pageNum = pageNum;
  viewport.pageW = pageW;
  viewport.pageH = pageH;
  viewport.active = true;
  fitToViewport();
}

export function fitToViewport() {
  if (!_canvas || !viewport.pageW) return;
  const padX = 40, padY = 40;
  const availW = _canvas.width - padX * 2;
  const availH = _canvas.height - padY * 2;
  const scaleX = availW / viewport.pageW;
  const scaleY = availH / viewport.pageH;
  viewport.zoom = Math.min(scaleX, scaleY);
  // Center the page
  const scaledW = viewport.pageW * viewport.zoom;
  const scaledH = viewport.pageH * viewport.zoom;
  viewport.offsetX = (_canvas.width - scaledW) / 2;
  viewport.offsetY = (_canvas.height + scaledH) / 2; // +scaledH because Y-flip
  viewport.dirty = true;
}

// ─── Zoom ───────────────────────────────────────────────────────────────────

export function zoomAtPoint(screenX, screenY, factor) {
  const newZoom = Math.max(0.1, Math.min(20, viewport.zoom * factor));

  // World point under cursor (before zoom)
  const wx = (screenX - viewport.offsetX) / viewport.zoom;
  const wy = (screenY - viewport.offsetY) / viewport.zoom;

  // New offset to keep that world point under cursor
  viewport.offsetX = screenX - wx * newZoom;
  viewport.offsetY = screenY - wy * newZoom;
  viewport.zoom = newZoom;
  viewport.dirty = true;
}

// ─── Pan ────────────────────────────────────────────────────────────────────

let _isPanning = false, _panStartX = 0, _panStartY = 0;

export function startPan(screenX, screenY) {
  _isPanning = true;
  _panStartX = screenX - viewport.offsetX;
  _panStartY = screenY - viewport.offsetY;
}

export function updatePan(screenX, screenY) {
  if (!_isPanning) return;
  viewport.offsetX = screenX - _panStartX;
  viewport.offsetY = screenY - _panStartY;
  viewport.dirty = true;
}

export function endPan() {
  _isPanning = false;
}

export function isPanning() {
  return _isPanning;
}

// ─── Coordinate Conversion ──────────────────────────────────────────────────

export function screenToWorld(sx, sy) {
  return {
    x: (sx - viewport.offsetX) / viewport.zoom,
    y: (sy - viewport.offsetY) / viewport.zoom,
  };
}

export function worldToScreen(wx, wy) {
  return {
    x: wx * viewport.zoom + viewport.offsetX,
    y: wy * viewport.zoom + viewport.offsetY,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add open-pdf-studio/js/pdf/pdf-viewport.js
git commit -m "feat: add pdf-viewport.js — unified viewport with RAF render loop"
```

---

### Task 2: Wire zoom/pan events to pdf-viewport

**Files:**
- Modify: `open-pdf-studio/js/ui/setup/navigation-events.js`

- [ ] **Step 1: Replace the entire setupWheelZoom function**

Read the current file. Replace `setupWheelZoom()` with a minimal version that delegates to pdf-viewport:

```javascript
import { state, getActiveDocument } from '../../core/state.js';
import { renderPage, renderContinuous, goToPage } from '../../pdf/renderer.js';
import { clearHighlights } from '../../search/find-bar.js';
import { viewport, zoomAtPoint } from '../../pdf/pdf-viewport.js';

let _pageNavCooldown = false;

export function setupWheelZoom() {
  document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
    const activeDoc = getActiveDocument();
    if (!activeDoc?.pdfDoc) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      // Vector mode: direct zoom via viewport transform (no debounce)
      if (viewport.active) {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = e.target.getBoundingClientRect();
        zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, factor);
        return;
      }

      // Non-vector fallback: update doc.scale + render
      const doc = state.documents[state.activeDocumentIndex];
      if (!doc) return;
      const factor = Math.pow(0.999, e.deltaY);
      doc.scale = Math.min(Math.max(doc.scale * factor, 0.25), 5.0);
      doc.scale = Math.round(doc.scale * 1000) / 1000;
      if (doc.viewMode === 'continuous') {
        renderContinuous(true).catch(() => {});
      }
      return;
    }

    // Page navigation (without Ctrl)
    if (activeDoc?.viewMode !== 'single') return;
    if (_pageNavCooldown) return;

    const pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer) return;
    const atBottom = pdfContainer.scrollTop + pdfContainer.clientHeight >= pdfContainer.scrollHeight - 5;
    const atTop = pdfContainer.scrollTop <= 5;

    if (e.deltaY > 0 && atBottom && activeDoc.currentPage < activeDoc.pdfDoc.numPages) {
      e.preventDefault();
      _pageNavCooldown = true;
      await goToPage(activeDoc.currentPage + 1);
      setTimeout(() => { _pageNavCooldown = false; }, 300);
    } else if (e.deltaY < 0 && atTop && activeDoc.currentPage > 1) {
      e.preventDefault();
      _pageNavCooldown = true;
      await goToPage(activeDoc.currentPage - 1);
      setTimeout(() => { _pageNavCooldown = false; }, 300);
    }
  }, { passive: false });
}

export function cancelPendingZoom() {
  // No-op — viewport zoom is instant, no pending renders to cancel
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd open-pdf-studio && npx vite build --mode development 2>&1 | tail -3`

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/ui/setup/navigation-events.js
git commit -m "refactor: simplify zoom handler — delegate to pdf-viewport"
```

---

### Task 3: Integrate pdf-viewport into renderer.js

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Add viewport initialization to renderPage**

Read the current `renderPage()` function. At the TOP of the function, after getting the viewport dimensions from PDF.js, add:

```javascript
// If vector commands are available, use the viewport-based render loop
import { initViewport, setPage, viewport as pdfViewport } from './pdf-viewport.js';
import { hasCachedCommands, cacheCommands, getCachedPageDimensions } from './vector-renderer.js';
```

Then inside `renderPage()`, BEFORE all the existing render paths, add:

```javascript
  // ─── VECTOR VIEWPORT MODE ──────────────────────────────────
  // If Tauri is available, try to extract vector commands and use
  // the unified viewport render loop (no canvas resize, no debounce).
  if (isTauri() && doc.filePath) {
    if (!hasCachedCommands(doc.filePath, pageNum)) {
      try {
        const pageType = await invoke('analyze_page_type', { path: doc.filePath, pageIndex: pageNum - 1 });
        if (pageType === 'vector') {
          const cmdData = await invoke('extract_draw_commands', { path: doc.filePath, pageIndex: pageNum - 1 });
          const cmdBytes = cmdData instanceof Uint8Array ? cmdData : new Uint8Array(cmdData);
          cacheCommands(doc.filePath, pageNum, cmdBytes);
        }
      } catch (e) {
        console.warn('[render] Vector command extraction failed:', e);
      }
    }

    if (hasCachedCommands(doc.filePath, pageNum)) {
      const pdfCanvas = getPdfCanvas();
      if (pdfCanvas && !pdfViewport.active) {
        initViewport(pdfCanvas);
      }
      const dims = getCachedPageDimensions(doc.filePath, pageNum);
      if (dims) {
        setPage(doc.filePath, pageNum, dims.w, dims.h);
        // Hide the PDF container scroll mechanism — viewport handles zoom/pan
        const container = document.getElementById('pdf-container');
        if (container) container.style.overflow = 'hidden';
      }

      // Still create text layer for text selection (one-time)
      const page = await pdfDoc.getPage(pageNum);
      const textViewport = page.getViewport({ scale: 1.0 });
      try { await createSinglePageTextLayer(page, textViewport); } catch {}

      // Resize annotation canvas to match pdf canvas
      const annotationCanvas = getAnnotationCanvas();
      if (annotationCanvas && pdfCanvas) {
        annotationCanvas.width = pdfCanvas.width;
        annotationCanvas.height = pdfCanvas.height;
        annotationCanvas.style.width = pdfCanvas.style.width;
        annotationCanvas.style.height = pdfCanvas.style.height;
      }
      redrawAnnotations();
      updateAllStatus();
      return; // DONE — viewport render loop handles everything from here
    }
  }

  // ─── FALLBACK: PDF.js render (non-vector pages, web mode) ──
```

The rest of `renderPage()` stays as the PDF.js fallback — but only runs for non-vector pages.

- [ ] **Step 2: Add pan handling to canvas**

Add to `renderPage()` after the viewport setup, before the `return`:

```javascript
      // Wire pan events on the PDF canvas
      if (pdfCanvas && !pdfCanvas._panWired) {
        pdfCanvas._panWired = true;
        const { startPan, updatePan, endPan, isPanning } = await import('./pdf-viewport.js');
        pdfCanvas.addEventListener('pointerdown', (e) => {
          if (e.button === 1 || (e.button === 0 && state.currentTool === 'hand')) {
            startPan(e.offsetX, e.offsetY);
            pdfCanvas.setPointerCapture(e.pointerId);
          }
        });
        pdfCanvas.addEventListener('pointermove', (e) => {
          if (isPanning()) updatePan(e.offsetX, e.offsetY);
        });
        pdfCanvas.addEventListener('pointerup', () => endPan());
        pdfCanvas.addEventListener('pointercancel', () => endPan());
      }
```

- [ ] **Step 3: Verify compilation**

Run: `cd open-pdf-studio && npx vite build --mode development 2>&1 | tail -3`

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: integrate pdf-viewport into renderPage with PDF.js fallback"
```

---

### Task 4: Test via CDP

**Files:**
- Modify: `mcp-server/test-zoom-pan.mjs`

- [ ] **Step 1: Run the existing zoom/pan test**

Run: Start the app with CDP (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri:dev`), then:

```bash
cd open-pdf-studio && node mcp-server/test-zoom-pan.mjs
```

Expected:
- Frame rate: 60+ fps
- Canvas memory: ~4MB (viewport sized)
- Vector redraw avg: <15ms
- No "Rust OK" or "PDF.js" in render logs — only viewport renders

- [ ] **Step 2: Take screenshots and verify visual correctness**

Check `zoom-pan-*.png` screenshots:
- Drawing visible at all zoom levels
- No blurriness (vector, not raster)
- No CSS scale artifacts
- Zoom anchored to cursor position

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: clean vector render engine — unified viewport, 100+ fps zoom/pan"
```
