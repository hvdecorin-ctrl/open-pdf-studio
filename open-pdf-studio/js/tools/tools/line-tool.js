/**
 * Line tool — handles line, arrow
 * Uses click-click mode: first click sets start, second click sets end.
 * Also supports legacy drag-to-create (if pointer moves significantly before release).
 */
import { state, getActiveDocument } from '../../core/state.js';

// Internal state for click-click line drawing
const _lineState = { startX: 0, startY: 0, drawing: false };

export const lineTool = {
  name: 'line',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) {
      // Right-click cancels
      if (_lineState.drawing) {
        _lineState.drawing = false;
        state.isDrawing = false;
        ctx.redraw();
      }
      return;
    }

    if (!_lineState.drawing) {
      // First click: record start point
      _lineState.startX = state.startX;
      _lineState.startY = state.startY;
      _lineState.drawing = true;
      state.isDrawing = true;
    } else {
      // Second click: create the line annotation
      const rawX = ctx.x, rawY = ctx.y;
      const endSnap = ctx.snap(rawX, rawY);
      const endX = endSnap.snapped ? endSnap.x : ctx.snapToGrid(rawX);
      const endY = endSnap.snapped ? endSnap.y : ctx.snapToGrid(rawY);

      state.lastSnapResult = null;
      state.isDrawing = false;
      _lineState.drawing = false;

      const tool = state.currentTool;
      const ann = ctx.createAnnotationFromTool(tool, _lineState.startX, _lineState.startY, endX, endY, e);
      if (ann) {
        const doc = state.documents[state.activeDocumentIndex];
        if (doc) doc.annotations.push(ann);
        ctx.recordAdd(ann);
      }
      ctx.redraw();

      // Auto-reset to select tool
      import('../../tools/manager.js').then(m => m.setTool('select'));
    }
  },

  onPointerMove(ctx, e) {
    const { x, y } = ctx;
    if (!_lineState.drawing) {
      // Hover snap indicator
      _drawHoverSnap(ctx, x, y);
      return;
    }

    // Temporarily set state.startX/Y to the saved first-click position
    // so drawShapePreview uses the correct origin
    const savedStartX = state.startX;
    const savedStartY = state.startY;
    state.startX = _lineState.startX;
    state.startY = _lineState.startY;

    // Snap cursor position for preview
    const snap = ctx.snap(x, y);
    const previewX = snap.snapped ? snap.x : x;
    const previewY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;
    ctx.drawShapePreview(previewX, previewY, e);

    // Restore state.startX/Y (the dispatcher may have overwritten them)
    state.startX = savedStartX;
    state.startY = savedStartY;
  },

  onPointerUp(ctx, e) {
    // In click-click mode, pointerUp is a no-op (we handle everything in pointerDown).
    // Return true to signal "handled" so the dispatcher doesn't call _finishDrawing.
    if (_lineState.drawing) return true;
    return false;
  },

  onDeactivate(ctx) {
    if (_lineState.drawing) {
      _lineState.drawing = false;
      state.isDrawing = false;
      ctx.redraw();
    }
  },
};

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
