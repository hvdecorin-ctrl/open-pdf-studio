import { getActiveDocument } from '../../core/state.js';

/**
 * Measurement tools — measureDistance (3-click dimension), measureArea, measurePerimeter
 */
export const measureDistanceTool = {
  name: 'measureDistance',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, scale } = ctx;

    // Right-click cancels
    if (e.button === 2) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();
      return;
    }

    const snap = ctx.snap(x, y, null, state.dimPoints);
    const dimX = snap.snapped ? snap.x : x;
    const dimY = snap.snapped ? snap.y : y;

    if (state.dimPoints.length === 0) {
      // Click 1: first measurement point
      state.dimPoints.push({ x: dimX, y: dimY });
      state.isDrawingDimension = true;
    } else if (state.dimPoints.length === 1) {
      // Click 2: second measurement point
      const dx = dimX - state.dimPoints[0].x;
      const dy = dimY - state.dimPoints[0].y;
      if (Math.sqrt(dx * dx + dy * dy) < 3 / scale) return;
      let finalPt = { x: dimX, y: dimY };
      if (e.ctrlKey) finalPt = ctx.snapDistanceTo10(state.dimPoints[0].x, state.dimPoints[0].y, dimX, dimY);
      state.dimPoints.push(finalPt);
    } else if (state.dimPoints.length === 2) {
      // Click 3: offset point — defines dimension line position
      const p1 = state.dimPoints[0];
      const p2 = state.dimPoints[1];
      const lineAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perpX = -Math.sin(lineAngle);
      const perpY = Math.cos(lineAngle);
      const offDx = dimX - p1.x;
      const offDy = dimY - p1.y;
      const perpDist = offDx * perpX + offDy * perpY;
      const startX = p1.x + perpDist * perpX;
      const startY = p1.y + perpDist * perpY;
      const endX = p2.x + perpDist * perpX;
      const endY = p2.y + perpDist * perpY;

      const prefs = state.preferences;
      const dist = ctx.calculateDistance(startX, startY, endX, endY);
      const dimScale = prefs.measureDistDimScale || 0;
      const dimUnit = prefs.measureDistDimUnit || dist.unit;
      const dimPrecision = prefs.measureDistDimPrecision != null ? prefs.measureDistDimPrecision : 2;
      let mText;
      if (dimScale) {
        const pixelDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        mText = `${(pixelDist * dimScale).toFixed(dimPrecision)} ${dimUnit}`;
      } else {
        mText = ctx.formatMeasurement(dist);
      }
      const ann = ctx.createAnnotation({
        type: 'measureDistance',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY, endX, endY,
        leaderStartX: p1.x, leaderStartY: p1.y,
        leaderEndX: p2.x, leaderEndY: p2.y,
        startHead: prefs.measureDistStartHead || 'closed',
        endHead: prefs.measureDistEndHead || 'closed',
        headSize: prefs.measureDistHeadSize || 12,
        color: prefs.measureDistStrokeColor,
        strokeColor: prefs.measureDistStrokeColor,
        lineWidth: prefs.measureDistLineWidth,
        opacity: (prefs.measureDistOpacity || 100) / 100,
        measureText: mText,
        measureValue: dist.value,
        measureUnit: dimUnit,
        measurePixels: dist.pixels,
        measureScale: dimScale || undefined,
        measurePrecision: dimPrecision,
      });
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    if (!state.isDrawingDimension || state.dimPoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const dimColor = prefs.measureDistStrokeColor || '#FF0000';
    const snap = ctx.snap(x, y, null, state.dimPoints);
    let dimSnapX = snap.snapped ? snap.x : x;
    let dimSnapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    // Shift+snap angle constraint
    if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap) {
      const last = state.dimPoints[state.dimPoints.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
      dimSnapX = last.x + len * Math.cos(snapped);
      dimSnapY = last.y + len * Math.sin(snapped);
    }

    ctx.redraw();
    canvasCtx.save();
    canvasCtx.scale(scale, scale);
    canvasCtx.strokeStyle = dimColor;
    canvasCtx.lineWidth = prefs.measureDistLineWidth || 1;
    canvasCtx.globalAlpha = (prefs.measureDistOpacity || 100) / 100;
    canvasCtx.setLineDash([]);

    const p1 = state.dimPoints[0];
    const sHead = prefs.measureDistStartHead || 'closed';
    const eHead = prefs.measureDistEndHead || 'closed';
    const hSize = prefs.measureDistHeadSize || 12;
    const dimScale = prefs.measureDistDimScale || 0;
    const dimUnit = prefs.measureDistDimUnit || '';
    const dimPrecision = prefs.measureDistDimPrecision != null ? prefs.measureDistDimPrecision : 2;

    function dimMeasureText(sx, sy, ex, ey) {
      if (dimScale) {
        const pixelDist = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
        return `${(pixelDist * dimScale).toFixed(dimPrecision)} ${dimUnit}`;
      }
      return ctx.formatMeasurement(ctx.calculateDistance(sx, sy, ex, ey));
    }

    if (state.dimPoints.length === 1) {
      if (e.ctrlKey) {
        const s = ctx.snapDistanceTo10(p1.x, p1.y, dimSnapX, dimSnapY);
        dimSnapX = s.x; dimSnapY = s.y;
      }
      ctx.drawDimension(canvasCtx, {
        startX: p1.x, startY: p1.y, endX: dimSnapX, endY: dimSnapY,
        startHead: sHead, endHead: eHead, headSize: hSize,
        color: dimColor, measureText: dimMeasureText(p1.x, p1.y, dimSnapX, dimSnapY)
      });
    } else if (state.dimPoints.length === 2) {
      const p2 = state.dimPoints[1];
      const lineAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perpX = -Math.sin(lineAngle);
      const perpY = Math.cos(lineAngle);
      const offDx = dimSnapX - p1.x;
      const offDy = dimSnapY - p1.y;
      const perpDist = offDx * perpX + offDy * perpY;
      const dStartX = p1.x + perpDist * perpX;
      const dStartY = p1.y + perpDist * perpY;
      const dEndX = p2.x + perpDist * perpX;
      const dEndY = p2.y + perpDist * perpY;
      ctx.drawDimension(canvasCtx, {
        startX: dStartX, startY: dStartY, endX: dEndX, endY: dEndY,
        leaderStartX: p1.x, leaderStartY: p1.y, leaderEndX: p2.x, leaderEndY: p2.y,
        startHead: sHead, endHead: eHead, headSize: hSize,
        color: dimColor, measureText: dimMeasureText(dStartX, dStartY, dEndX, dEndY)
      });
    }

    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();
    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  onDeactivate(ctx) {
    const { state } = ctx;
    if (state.isDrawingDimension) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();
    }
  },
};

export const measureAreaTool = {
  name: 'measureArea',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    _measureMultiClickDown(ctx, e, 'measureArea');
  },

  onPointerMove(ctx, e) {
    _measureMultiClickMove(ctx, e, 'measureArea');
  },

  onDeactivate(ctx) {
    _measureDeactivate(ctx);
  },
};

export const measurePerimeterTool = {
  name: 'measurePerimeter',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    _measureMultiClickDown(ctx, e, 'measurePerimeter');
  },

  onPointerMove(ctx, e) {
    _measureMultiClickMove(ctx, e, 'measurePerimeter');
  },

  onDeactivate(ctx) {
    _measureDeactivate(ctx);
  },
};

// Shared helpers for area/perimeter
function _measureMultiClickDown(ctx, e, toolType) {
  const { x, y, state } = ctx;
  const prefs = state.preferences;
  const isArea = toolType === 'measureArea';

  // Right-click finishes
  if (e.button === 2) {
    _finishMeasure(ctx, toolType);
    return;
  }

  if (!state.measurePoints) state.measurePoints = [];

  // Object snap (including in-progress vertices)
  const snap = ctx.snap(x, y, null, state.measurePoints);
  let ptX = snap.snapped ? snap.x : x;
  let ptY = snap.snapped ? snap.y : y;

  // Angle snap when Shift held
  if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap && state.measurePoints.length > 0) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const dx = x - last.x, dy = y - last.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
    ptX = last.x + length * Math.cos(snapped);
    ptY = last.y + length * Math.sin(snapped);
  }

  // Ctrl: snap distance to nearest 10
  if (e.ctrlKey && state.measurePoints.length > 0) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const s = ctx.snapDistanceTo10(last.x, last.y, ptX, ptY);
    ptX = s.x; ptY = s.y;
  }

  // Close measureArea when clicking near the first point
  if (isArea && state.measurePoints.length >= 3) {
    const first = state.measurePoints[0];
    const dx = ptX - first.x, dy = ptY - first.y;
    if (Math.sqrt(dx * dx + dy * dy) < 10 / ctx.scale) {
      _finishMeasure(ctx, toolType);
      return;
    }
  }

  state.measurePoints.push({ x: ptX, y: ptY });
  ctx.redraw();

  // Draw in-progress measurement
  _drawMeasureInProgress(ctx, toolType);
}

function _measureMultiClickMove(ctx, e, toolType) {
  const { x, y, state, canvasCtx, scale } = ctx;
  if (!state.measurePoints || state.measurePoints.length === 0) {
    _drawHoverSnap(ctx, x, y);
    return;
  }

  const prefs = state.preferences;
  const isArea = toolType === 'measureArea';
  const mColor = (isArea ? prefs.measureAreaStrokeColor : prefs.measurePerimStrokeColor) || '#FF0000';
  const mBorderStyle = (isArea ? prefs.measureAreaBorderStyle : prefs.measurePerimBorderStyle) || 'solid';
  const mFillColor = isArea ? (prefs.measureAreaFillNone ? 'none' : (prefs.measureAreaFillColor || null)) : null;

  const snap = ctx.snap(x, y, null, state.measurePoints);
  state.lastSnapResult = snap.snapped ? snap : null;

  let snapX = snap.snapped ? snap.x : x;
  let snapY = snap.snapped ? snap.y : y;
  let nearFirst = false;

  // Snap to first point when near (close shape hint) for measureArea
  if (isArea && state.measurePoints.length >= 3) {
    const first = state.measurePoints[0];
    const dx = snapX - first.x, dy = snapY - first.y;
    if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
      snapX = first.x; snapY = first.y;
      nearFirst = true;
    }
  }

  if (!snap.snapped && !nearFirst && e.shiftKey && prefs.enableAngleSnap) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const dx = x - last.x, dy = y - last.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
    snapX = last.x + length * Math.cos(snapped);
    snapY = last.y + length * Math.sin(snapped);
  }

  if (!nearFirst && e.ctrlKey) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const s = ctx.snapDistanceTo10(last.x, last.y, snapX, snapY);
    snapX = s.x; snapY = s.y;
  }

  ctx.redraw();
  canvasCtx.save();
  canvasCtx.scale(scale, scale);
  canvasCtx.strokeStyle = mColor;
  canvasCtx.lineWidth = (isArea ? prefs.measureAreaLineWidth : prefs.measurePerimLineWidth) || 1;
  canvasCtx.globalAlpha = ((isArea ? prefs.measureAreaOpacity : prefs.measurePerimOpacity) || 100) / 100;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  const previewPoints = [...state.measurePoints, { x: snapX, y: snapY }];

  if (isArea && previewPoints.length > 2) {
    ctx.drawMeasureAreaShape(canvasCtx, previewPoints, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle);
  } else {
    ctx.drawMeasurePerimeterShape(canvasCtx, previewPoints, mColor, mBorderStyle);
  }

  // Live measurement text
  if (isArea && previewPoints.length >= 3) {
    const area = ctx.calculateArea(previewPoints);
    ctx.drawCentroidLabel(canvasCtx, previewPoints, ctx.formatMeasurement(area), mColor);
  } else if (!isArea && previewPoints.length >= 2) {
    const perim = ctx.calculatePerimeter(previewPoints);
    canvasCtx.font = '11px Arial';
    canvasCtx.fillStyle = mColor;
    canvasCtx.fillText(ctx.formatMeasurement(perim), snapX + 8, snapY - 4);
  }

  // Close indicator at first point
  if (nearFirst) {
    const first = state.measurePoints[0];
    canvasCtx.beginPath();
    canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
    canvasCtx.fillStyle = mColor;
    canvasCtx.globalAlpha = 0.3;
    canvasCtx.fill();
    canvasCtx.globalAlpha = 1;
  }

  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
  if (snap.snapped && !nearFirst) {
    ctx.drawSnapIndicator(snap);
  }
}

function _finishMeasure(ctx, toolType) {
  const { state } = ctx;
  if (!state.measurePoints) return;
  const points = [...state.measurePoints];
  const doc = state.documents[state.activeDocumentIndex];

  if (toolType === 'measureArea' && points.length >= 3) {
    const ann = ctx.createMeasureAreaAnnotation(points);
    if (ann) { if (doc) doc.annotations.push(ann); ctx.recordAdd(ann); }
  } else if (toolType === 'measurePerimeter' && points.length >= 2) {
    const ann = ctx.createMeasurePerimeterAnnotation(points);
    if (ann) { if (doc) doc.annotations.push(ann); ctx.recordAdd(ann); }
  }
  state.measurePoints = null;
  ctx.redraw();
}

function _measureDeactivate(ctx) {
  const { state } = ctx;
  if (state.measurePoints) {
    state.measurePoints = null;
    ctx.redraw();
  }
}

function _drawMeasureInProgress(ctx, toolType) {
  const { state, canvasCtx, scale } = ctx;
  if (!state.measurePoints || state.measurePoints.length === 0) return;
  const prefs = state.preferences;
  const isArea = toolType === 'measureArea';
  const mColor = (isArea ? prefs.measureAreaStrokeColor : prefs.measurePerimStrokeColor) || '#FF0000';
  const mBorderStyle = (isArea ? prefs.measureAreaBorderStyle : prefs.measurePerimBorderStyle) || 'solid';
  const mFillColor = isArea ? (prefs.measureAreaFillNone ? 'none' : (prefs.measureAreaFillColor || null)) : null;

  canvasCtx.save();
  canvasCtx.scale(scale, scale);
  canvasCtx.strokeStyle = mColor;
  canvasCtx.lineWidth = (isArea ? prefs.measureAreaLineWidth : prefs.measurePerimLineWidth) || 1;
  canvasCtx.globalAlpha = ((isArea ? prefs.measureAreaOpacity : prefs.measurePerimOpacity) || 100) / 100;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';
  if (isArea && state.measurePoints.length > 2) {
    ctx.drawMeasureAreaShape(canvasCtx, state.measurePoints, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle);
  } else {
    ctx.drawMeasurePerimeterShape(canvasCtx, state.measurePoints, mColor, mBorderStyle);
  }
  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
}

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
