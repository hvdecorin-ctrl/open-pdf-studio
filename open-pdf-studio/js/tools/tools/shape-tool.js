/**
 * Shape tool — handles box, circle, highlight, cloud, polygon, redaction, textbox, callout
 * All use the same drag-to-create pattern via buildAnnotationProps + drawShapePreview
 */
export const shapeTool = {
  name: 'shape',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    const { state } = ctx;
    state.isDrawing = true;
  },

  onPointerMove(ctx, e) {
    const { x, y, state } = ctx;
    if (!state.isDrawing) {
      // Hover snap indicator
      _drawHoverSnap(ctx, x, y);
      return;
    }

    // Snap cursor position for shape preview
    const snap = ctx.snap(x, y);
    const previewX = snap.snapped ? snap.x : x;
    const previewY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;
    ctx.drawShapePreview(previewX, previewY, e);
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;

    const rawX = ctx.x, rawY = ctx.y;
    const endSnap = ctx.snap(rawX, rawY);
    const endX = endSnap.snapped ? endSnap.x : ctx.snapToGrid(rawX);
    const endY = endSnap.snapped ? endSnap.y : ctx.snapToGrid(rawY);
    state.lastSnapResult = null;
    state.isDrawing = false;

    const tool = state.currentTool;
    const ann = ctx.createAnnotationFromTool(tool, state.startX, state.startY, endX, endY, e);
    if (ann) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
    ctx.redraw();

    // Auto-start text editing for textbox/callout
    if (ann && ['textbox', 'callout'].includes(ann.type)) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) { doc.selectedAnnotations = [ann]; doc.selectedAnnotation = ann; }
      ctx.showProperties(ann);
      ctx.startTextEditing(ann);
    }
    return true;
  },
};

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  const { state } = ctx;
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
