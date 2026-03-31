/**
 * Hover Translate tool — registered in the tool system.
 * When active, hovering over text shows a translated overlay.
 * Uses the dispatcher's onPointerMove for hit detection (no manual listeners).
 */
import { getActiveDocument } from '../../core/state.js';
import { chatSync, isLoggedIn } from '../../services/ai-api.js';
import { isOnline } from '../../services/connectivity.js';

let _targetLang = 'English';
let _cache = new Map();
let _overlay = null;
let _currentText = null;
let _pendingId = null;

export function getHoverTargetLang() { return _targetLang; }
export function setHoverTargetLang(lang) { _targetLang = lang; _cache.clear(); }
export function clearHoverCache() { _cache.clear(); }

function ensureOverlay() {
  if (_overlay) return _overlay;
  _overlay = document.createElement('div');
  _overlay.className = 'hover-translate-overlay';
  _overlay.style.cssText = 'position:fixed;z-index:999;pointer-events:none;display:none;' +
    'padding:2px 4px;line-height:1.3;max-width:400px;word-break:break-word;' +
    'background:var(--theme-surface,#fffde7);border:1px solid #f9a825;' +
    'box-shadow:0 2px 6px rgba(0,0,0,0.15);color:var(--theme-text,#333);';
  document.body.appendChild(_overlay);
  return _overlay;
}

function showOverlay(text, rect, style) {
  const el = ensureOverlay();
  el.textContent = text;
  el.style.display = 'block';
  el.style.left = rect.left + 'px';
  el.style.top = rect.top + 'px';
  el.style.width = Math.max(rect.width, 40) + 'px';
  el.style.minHeight = rect.height + 'px';
  el.style.fontSize = style?.fontSize || '12px';
  el.style.fontFamily = style?.fontFamily || 'inherit';
}

function hideOverlay() {
  if (_overlay) _overlay.style.display = 'none';
}

function findTextSpanAt(clientX, clientY) {
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const el of elements) {
    const layer = el.closest?.('.textLayer');
    if (!layer) continue;
    // el might be the layer itself or a span
    if (el.matches?.('span') && el.textContent?.trim()) return el;
    // Search spans inside the layer at this point
    const spans = layer.querySelectorAll('span');
    for (const span of spans) {
      const r = span.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        if (span.textContent?.trim()) return span;
      }
    }
  }
  return null;
}

export const hoverTranslateTool = {
  name: 'hoverTranslate',
  cursor: 'help',

  onPointerDown(ctx, e) {
    // No-op: hover translate doesn't interact on click
  },

  onPointerMove(ctx, e) {
    const span = findTextSpanAt(e.clientX, e.clientY);

    if (!span) {
      _currentText = null;
      hideOverlay();
      return;
    }

    const text = span.textContent.trim();
    if (!text || text.length < 2) { hideOverlay(); return; }

    // Same text — don't re-request
    if (text === _currentText) return;
    _currentText = text;

    const cacheKey = text + '→' + _targetLang;
    const cached = _cache.get(cacheKey);
    if (cached) {
      const rect = span.getBoundingClientRect();
      const style = window.getComputedStyle(span);
      showOverlay(cached, rect, style);
      return;
    }

    // Show loading
    const el = ensureOverlay();
    const rect = span.getBoundingClientRect();
    el.textContent = '...';
    el.style.display = 'block';
    el.style.left = rect.left + 'px';
    el.style.top = rect.bottom + 4 + 'px';
    el.style.width = '';
    el.style.minHeight = '';
    el.style.fontSize = '11px';

    if (!isOnline()) { el.textContent = 'Offline'; return; }
    if (!isLoggedIn()) { el.textContent = 'Sign in required'; return; }

    _pendingId = (_pendingId || 0) + 1;
    const requestId = _pendingId;

    chatSync('translate', text, {
      language: _targetLang,
      max_tokens: Math.max(128, text.length * 2),
      temperature: 0.2,
    }).then(result => {
      if (_pendingId !== requestId || _currentText !== text) return;
      const translated = result.content?.trim();
      if (translated) {
        _cache.set(cacheKey, translated);
        const r = span.getBoundingClientRect();
        const s = window.getComputedStyle(span);
        showOverlay(translated, r, s);
      }
    }).catch(err => {
      console.error('[HoverTranslate]', err);
      if (_pendingId === requestId && _currentText === text) {
        el.textContent = 'Error';
      }
    });
  },

  onDeactivate() {
    _currentText = null;
    _pendingId = null;
    hideOverlay();
  },
};
