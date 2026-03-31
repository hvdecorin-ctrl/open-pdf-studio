/**
 * Viewport tool — draw a rectangular region with its own scale.
 * Creates the scaleBar annotation immediately so the viewport boundary
 * stays visible while the scale dialog is open.
 * Uses the standard shape preview pipeline via buildAnnotationProps('viewport').
 */
import { getActiveDocument } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { openDialog } from '../../bridge.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

export const viewportTool = {
  name: 'viewport',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    ctx.state.isDrawing = true;
  },

  onPointerMove(ctx, e) {
    const { x, y, state } = ctx;
    if (!state.isDrawing) return;
    ctx.drawShapePreview(x, y, e);
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;

    const x1 = Math.min(state.startX, ctx.x);
    const y1 = Math.min(state.startY, ctx.y);
    const w = Math.abs(ctx.x - state.startX);
    const h = Math.abs(ctx.y - state.startY);

    if (w < 20 || h < 20) {
      ctx.redraw();
      return false;
    }

    const doc = getActiveDocument();
    if (!doc) return false;

    const pageNum = doc.currentPage || 1;
    const barWidth = Math.min(w * 0.6, 300);
    const barHeight = 14;

    // Create annotation immediately with default scale (1:100)
    const ann = createAnnotation({
      type: 'scaleBar',
      page: pageNum,
      x: x1 + 10,
      y: y1 + h - barHeight - 20,
      width: barWidth,
      height: barHeight,
      rotation: 0,
      pixelsPerUnit: 0.02835,
      unit: 'mm',
      divisions: 5,
      totalUnits: 5000,
      regionX: x1,
      regionY: y1,
      regionWidth: w,
      regionHeight: h,
      viewportName: 'Viewport',
      scaleRatio: '1:100',
      color: '#000000',
      lineWidth: 1,
      opacity: 1,
    });

    doc.annotations.push(ann);
    recordAdd(ann);
    redraw();

    // Open dialog to set scale — pass annotation ID so dialog updates it
    openDialog('viewport-scale', {
      annotationId: ann.id,
      regionX: x1,
      regionY: y1,
      regionWidth: w,
      regionHeight: h,
      pageNum,
    });

    return true;
  },

  onDeactivate() {},
};
