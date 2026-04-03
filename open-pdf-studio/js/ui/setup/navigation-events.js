import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { viewport, zoomAtPoint } from '../../pdf/pdf-viewport.js';
import { getTool } from '../../tools/tool-registry.js';

// ─── Wheel Zoom & Page Navigation ──────────────────────────────────────────
// ONE zoom strategy: delegate to pdf-viewport.js transform-based zoom.
// No CSS-scale, no debounce, no canvas resize. Just data update → dirty flag.

let _pageNavCooldown = false;

export function setupWheelZoom() {
  document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
    const activeDoc = getActiveDocument();
    if (!activeDoc?.pdfDoc) return;

    // Delegate to active tool first (e.g. arc bulge adjustment)
    const _wheelTool = getTool(state.currentTool);
    if (_wheelTool && _wheelTool.onWheel) {
      const _wheelCtx = { state, redraw: () => {
        viewport.dirty = true;
      }};
      _wheelTool.onWheel(_wheelCtx, e);
      if (e.defaultPrevented) return;
    }

    // Ctrl+wheel = zoom
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (!viewport.active) return;
      const rect = e.target.closest('canvas')?.getBoundingClientRect() || e.target.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, factor);
      return;
    }

    // Page navigation (without Ctrl) — single page mode only
    if (activeDoc?.viewMode !== 'single') return;
    if (_pageNavCooldown) return;

    const pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer) return;

    const canScroll = pdfContainer.scrollHeight > pdfContainer.clientHeight + 1;
    const atBottom = !canScroll || pdfContainer.scrollTop + pdfContainer.clientHeight >= pdfContainer.scrollHeight - 5;
    const atTop = !canScroll || pdfContainer.scrollTop <= 5;

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
  // No-op — viewport zoom is instant, no pending renders
}
