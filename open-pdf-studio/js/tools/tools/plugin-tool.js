import { getActiveDocument } from '../../core/state.js';

/**
 * Plugin tool — wraps annotation-type-registry handlers
 * Handles 'click' drawMode plugins; 'drag' plugins use shape-tool behavior
 */
export const pluginClickTool = {
  name: 'plugin-click',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e && e.button === 2) return;
    const { x, y, state } = ctx;
    const doc = getActiveDocument();
    const typeHandler = ctx.getAnnotationType(state.currentTool);
    if (typeHandler && typeHandler.create) {
      const annProps = typeHandler.create(x, y, x, y, e, state);
      if (annProps) {
        const ann = ctx.createAnnotation({ ...annProps, page: doc?.currentPage || 1, ...state.toolOverrides });
        if (doc) doc.annotations.push(ann);
        ctx.recordAdd(ann);
        ctx.redraw();
      }
    }
  },
};
