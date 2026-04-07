// Rust-backed text-span extraction.
//
// Calls the open-pdf-render Tauri command `extract_text` (single page) or
// `extract_text_batch` (parallel multi-page) to get TextSpan[] for text
// selection, search, and any other consumer that just needs the page's
// text content + per-run positions.
//
// This REPLACES the second PDF parse the JS layer used to do via PDF.js's
// `page.getTextContent()`. The Rust interpreter walks the same content
// stream as draw-command extraction and emits text spans during the same
// pass — sharing the document-scoped FontRegistry so glyph parsing is
// amortized across pages.
//
// The current text-selection layer (text-layer.js) still uses PDF.js
// because the edit-text tool depends on font metadata from page.commonObjs
// that the Rust path doesn't expose. Use this module for any consumer that
// only needs text + positions: search, find/replace, copy-text-to-clipboard,
// any analysis that doesn't need to render the text.

import { isTauri, invoke } from '../core/platform.js';

/**
 * One text run as emitted by open-pdf-render's interpreter.
 * @typedef {Object} TextSpan
 * @property {string} text       Decoded UTF-8 text content of the run
 * @property {number} x          Origin x in PDF user space (after CTM, Y-up)
 * @property {number} y          Origin y in PDF user space (after CTM, Y-up)
 * @property {number} width      User-space width of the run
 * @property {number} height     User-space height (≈ font size in user space)
 * @property {number} font_size  Effective font size in user space
 */

// In-memory cache: 'filePath:pageNum' → Promise<TextSpan[]>
// Promises are cached so concurrent requests for the same page coalesce.
const _cache = new Map();

function _key(filePath, pageNum) {
  return `${filePath}:${pageNum}`;
}

/**
 * Extract text spans for a single page via the Rust crate.
 * Returns an empty array on failure or in non-Tauri (web) builds.
 *
 * @param {string} filePath  Absolute path to the PDF file
 * @param {number} pageNum   1-based page number
 * @returns {Promise<TextSpan[]>}
 */
export async function extractTextSpans(filePath, pageNum) {
  if (!isTauri() || !filePath) return [];

  const key = _key(filePath, pageNum);
  let pending = _cache.get(key);
  if (pending) return pending;

  pending = (async () => {
    try {
      const spans = await invoke('extract_text', {
        path: filePath,
        pageIndex: pageNum - 1,
      });
      return Array.isArray(spans) ? spans : [];
    } catch (e) {
      console.warn(`[rust-text] extract_text failed for page ${pageNum}:`, e);
      _cache.delete(key); // allow retry
      return [];
    }
  })();
  _cache.set(key, pending);
  return pending;
}

/**
 * Extract text spans for multiple pages in parallel via the Rust crate
 * (uses rayon internally to walk content streams in parallel).
 *
 * Cached pages are returned from cache; uncached pages go through one
 * batched IPC call. Useful for full-document search where you want every
 * page's text in one round-trip.
 *
 * @param {string}   filePath
 * @param {number[]} pageNums  1-based page numbers
 * @returns {Promise<TextSpan[][]>}  one TextSpan[] per requested page
 */
export async function extractTextSpansBatch(filePath, pageNums) {
  if (!isTauri() || !filePath || pageNums.length === 0) return pageNums.map(() => []);

  // Find which pages need fetching
  const needsFetch = [];
  const indexInBatch = new Map(); // pageNum → index in needsFetch
  for (const p of pageNums) {
    if (!_cache.has(_key(filePath, p))) {
      indexInBatch.set(p, needsFetch.length);
      needsFetch.push(p);
    }
  }

  // Fire one batch IPC call for the missing pages
  let batchResult = null;
  if (needsFetch.length > 0) {
    try {
      batchResult = await invoke('extract_text_batch', {
        path: filePath,
        pageIndices: needsFetch.map(p => p - 1),
      });
    } catch (e) {
      console.warn('[rust-text] extract_text_batch failed:', e);
      batchResult = needsFetch.map(() => []);
    }
    // Cache each newly fetched page as a resolved Promise so subsequent
    // single-page lookups hit the cache.
    for (let i = 0; i < needsFetch.length; i++) {
      const p = needsFetch[i];
      const spans = Array.isArray(batchResult[i]) ? batchResult[i] : [];
      _cache.set(_key(filePath, p), Promise.resolve(spans));
    }
  }

  // Build the output by walking pageNums in order, reading from cache
  return Promise.all(pageNums.map(p => _cache.get(_key(filePath, p)) || Promise.resolve([])));
}

/**
 * Drop the cache for a specific page (call after the page is edited /
 * the file is saved). Pass no pageNum to drop the whole file's cache.
 *
 * @param {string} filePath
 * @param {number} [pageNum]
 */
export function invalidateRustText(filePath, pageNum) {
  if (pageNum === undefined) {
    for (const k of _cache.keys()) {
      if (k.startsWith(filePath + ':')) _cache.delete(k);
    }
  } else {
    _cache.delete(_key(filePath, pageNum));
  }
}

/** Drop the entire text-span cache (memory pressure / app cleanup). */
export function clearRustTextCache() {
  _cache.clear();
}

/**
 * Concatenate the text of all spans on a page into a single string,
 * with a space between adjacent runs. Useful for full-text search.
 *
 * @param {TextSpan[]} spans
 * @returns {string}
 */
export function joinSpansText(spans) {
  if (!spans || spans.length === 0) return '';
  return spans.map(s => s.text).join(' ');
}
