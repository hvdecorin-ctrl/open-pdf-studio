import { createScaleBar, syncDocScale } from '../../annotations/scale-bar.js';
import { getActiveDocument } from '../../core/state.js';
import { recalculateAllMeasurements } from '../../annotations/measurement.js';

export const scaleBarTool = {
  name: 'scaleBar',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e && e.button === 2) return;
    const doc = getActiveDocument();
    if (!doc) return;

    const ann = createScaleBar(ctx.x, ctx.y);
    doc.annotations.push(ann);

    // Sync doc.measureScale from the new scale bar and recalculate all measurements
    syncDocScale(ann);
    recalculateAllMeasurements();

    ctx.markModified();
    ctx.redraw();

    // Switch back to select tool
    ctx.setTool('select');
  }
};
