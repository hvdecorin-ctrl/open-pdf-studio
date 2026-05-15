// bitmap-orchestrator.js
//
// Thin wrapper that reads viewport state and triggers async fills for the
// current view. Delegates the actual work:
//   - whole-page raster -> ensureBitmap() in page-bitmap-cache.js
//   - visible-region high-zoom augment -> invoke('render_pdf_page_region')
//     + tile-cache.js
//
// When a bitmap/tile arrives, we write it onto the viewport singleton and
// set viewport.dirty = true so the RAF loop in pdf-viewport.js paints it.
//
// Concurrency: each function bumps a module-private generation counter on
// entry. After every await we re-check that our generation is still current
// before mutating viewport state, so a slower in-flight request can't
// overwrite a newer one (e.g. zoom-in while a previous render is pending).

import { viewport } from './pdf-viewport.js';
import { computeZoomBucket, ensureBitmap, getBestAvailableBitmap } from './page-bitmap-cache.js';
import { tileCacheGet, tileCacheSet } from './tile-cache.js';

// PDFium / browser canvas axis limit. Above this, we cap the whole-page
// bitmap resolution and rely on the tile augment for crispness in the
// visible region.
const MAX_BITMAP_AXIS_PX = 4096;

// Tile region buffer: extend the visible region by this fraction on each
// side, and snap region origin to a grid of this step. Small pans within
// the buffer stay cache-hits.
const TILE_BUFFER_FRACTION = 0.25;

let _bitmapGen = 0;
let _tileGen = 0;

export async function ensureBitmapForCurrentView() {
    if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster') {
        viewport.currentBitmap = null;
        viewport.dirty = true;
        return;
    }
    const myGen = ++_bitmapGen;
    const dpr = window.devicePixelRatio || 1;
    const targetScale = viewport.zoom * dpr;

    // Cap so PDFium never has to render above the 4096 px axis limit.
    const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
    if (maxAxisPt <= 0) {
        viewport.currentBitmap = null;
        viewport.dirty = true;
        return;
    }
    const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
    const cappedBucket = computeZoomBucket(Math.min(targetScale, capScale));
    // computeZoomBucket is monotonic, so the capped bucket is always <= the requested one
    const useBucket = cappedBucket;

    // Synchronous: show the best already-cached bitmap immediately. Handles
    // the "zoom-in while async render is in flight" case — we never blank
    // out the page while we wait for the higher bucket.
    const fallback = getBestAvailableBitmap(viewport.filePath, viewport.pageNum, viewport.rotation, useBucket);
    if (fallback) {
        viewport.currentBitmap = fallback.bitmap;
        viewport.dirty = true;
    }

    // Async: fetch the exact bucket. ensureBitmap dedups concurrent calls.
    const entry = await ensureBitmap(viewport.filePath, viewport.pageNum, viewport.rotation, useBucket);
    if (myGen !== _bitmapGen) return;  // stale (newer zoom/page came in)
    if (entry && entry.bitmap) {
        viewport.currentBitmap = entry.bitmap;
        viewport.dirty = true;
    }
}

export async function ensureTileForCurrentView(canvas) {
    if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster' || !canvas) {
        viewport.currentTile = null;
        viewport.currentTileMeta = null;
        return;
    }
    const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
    if (maxAxisPt <= 0) return;
    const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
    if (viewport.zoom <= capScale) {
        // Whole-page bitmap is sufficient; clear any stale tile so the
        // renderer doesn't draw a low-zoom tile on top of a fresh raster.
        viewport.currentTile = null;
        viewport.currentTileMeta = null;
        return;
    }

    const myGen = ++_tileGen;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    // Visible page region in CSS pixels.
    const visScreenLeft = Math.max(0, -viewport.offsetX);
    const visScreenTop = Math.max(0, -viewport.offsetY);
    const visScreenRight = Math.min(viewport.pageW * viewport.zoom, cssW - viewport.offsetX);
    const visScreenBottom = Math.min(viewport.pageH * viewport.zoom, cssH - viewport.offsetY);
    const visW = visScreenRight - visScreenLeft;
    const visH = visScreenBottom - visScreenTop;
    if (visW < 1 || visH < 1) {
        viewport.currentTile = null;
        viewport.currentTileMeta = null;
        return;
    }

    // Convert visible region to PDF points and add buffer for pan-within-
    // buffer cache hits.
    const visRegion = {
        x: visScreenLeft / viewport.zoom,
        y: visScreenTop / viewport.zoom,
        w: visW / viewport.zoom,
        h: visH / viewport.zoom,
    };
    const bufW = visRegion.w * TILE_BUFFER_FRACTION;
    const bufH = visRegion.h * TILE_BUFFER_FRACTION;
    const bufferedRegion = {
        x: Math.max(0, visRegion.x - bufW),
        y: Math.max(0, visRegion.y - bufH),
        w: Math.min(viewport.pageW, visRegion.w + 2 * bufW),
        h: Math.min(viewport.pageH, visRegion.h + 2 * bufH),
    };

    // Snap region origin to buffer-step grid for cache stability across pans.
    const stepX = viewport.pageW * TILE_BUFFER_FRACTION;
    const stepY = viewport.pageH * TILE_BUFFER_FRACTION;
    const snappedX = Math.floor(bufferedRegion.x / stepX) * stepX;
    const snappedY = Math.floor(bufferedRegion.y / stepY) * stepY;
    const regionBucket = `${Math.round(snappedX * 100)},${Math.round(snappedY * 100)}`;

    const zoomBucket = computeZoomBucket(viewport.zoom * dpr);

    // Cache hit?
    const hit = tileCacheGet(viewport.filePath, viewport.pageNum, zoomBucket, viewport.rotation, regionBucket);
    if (hit) {
        viewport.currentTile = hit.bitmap;
        viewport.currentTileMeta = hit.regionMeta;
        viewport.dirty = true;
        return;
    }

    // Cache miss: async Rust render of the region at the requested zoom.
    try {
        const { invoke } = window.__TAURI__.core;
        const rgbaData = await invoke('render_pdf_page_region', {
            path: viewport.filePath,
            pageIndex: viewport.pageNum - 1,
            scale: viewport.zoom,
            rotation: viewport.rotation || 0,
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
        if (w * h * 4 !== bytes.length - 8) {
            console.warn('[tile-orch] size mismatch', w, h, bytes.length - 8);
            return;
        }
        const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
        const imageData = new ImageData(rgba, w, h);
        const regionMeta = {
            regionXpt: bufferedRegion.x,
            regionYpt: bufferedRegion.y,
            regionWpt: bufferedRegion.w,
            regionHpt: bufferedRegion.h,
            zoom: viewport.zoom,
        };
        await tileCacheSet(viewport.filePath, viewport.pageNum, zoomBucket, viewport.rotation, regionBucket, imageData, regionMeta);
        if (myGen !== _tileGen) return;
        const cached = tileCacheGet(viewport.filePath, viewport.pageNum, zoomBucket, viewport.rotation, regionBucket);
        if (cached && cached.bitmap) {
            viewport.currentTile = cached.bitmap;
            viewport.currentTileMeta = cached.regionMeta;
            viewport.dirty = true;
            console.log(`[tile-orch] cached p${viewport.pageNum} @ z=${viewport.zoom.toFixed(2)} reg=${regionBucket}`);
        }
    } catch (e) {
        console.warn('[tile-orch] render failed:', e);
    }
}
