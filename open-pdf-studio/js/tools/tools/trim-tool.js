import { state, getActiveDocument } from '../../core/state.js';
import { lineLineIntersection } from '../../annotations/geometry.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _trimState = { cuttingEdge: null };

function getLineEndpoints(ann) {
  if (ann.startX !== undefined && ann.endX !== undefined) {
    return { p1: { x: ann.startX, y: ann.startY }, p2: { x: ann.endX, y: ann.endY } };
  }
  return null;
}

export const trimTool = {
  name: 'trim',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);
    if (!clicked) return;
    const endpoints = getLineEndpoints(clicked);
    if (!endpoints) return;

    if (!_trimState.cuttingEdge) {
      _trimState.cuttingEdge = clicked;
      const doc = getActiveDocument();
      if (doc) { doc.selectedAnnotations = [clicked]; doc.selectedAnnotation = clicked; }
      redrawAnnotations();
      return;
    }

    const target = clicked;
    if (target === _trimState.cuttingEdge) { _trimState.cuttingEdge = null; return; }

    const targetPts = getLineEndpoints(target);
    const cutterPts = getLineEndpoints(_trimState.cuttingEdge);
    if (!targetPts || !cutterPts) { _trimState.cuttingEdge = null; return; }

    const ix = lineLineIntersection(targetPts.p1, targetPts.p2, cutterPts.p1, cutterPts.p2);
    if (!ix) { _trimState.cuttingEdge = null; return; }

    const distToStart = Math.hypot(x - target.startX, y - target.startY);
    const distToEnd = Math.hypot(x - target.endX, y - target.endY);

    const oldState = cloneAnnotation(target);

    if (ix.t >= -0.01 && ix.t <= 1.01) {
      // Intersection within target segment — trim: remove side nearest click
      if (distToStart < distToEnd) {
        target.startX = ix.x; target.startY = ix.y;
      } else {
        target.endX = ix.x; target.endY = ix.y;
      }
    } else if (ix.u >= -0.01 && ix.u <= 1.01) {
      // Intersection outside target but on cutter — extend nearest endpoint
      if (distToStart < distToEnd) {
        target.startX = ix.x; target.startY = ix.y;
      } else {
        target.endX = ix.x; target.endY = ix.y;
      }
    } else {
      // Intersection not on either segment — do nothing
      _trimState.cuttingEdge = null;
      return;
    }

    target.modifiedAt = new Date().toISOString();
    recordModify(target.id, oldState, target);
    redrawAnnotations();
    _trimState.cuttingEdge = null;
    import('../../tools/manager.js').then(m => m.setTool('select'));
  },

  onDeactivate() { _trimState.cuttingEdge = null; },
};
