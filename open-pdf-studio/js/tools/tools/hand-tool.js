import { getActiveDocument } from '../../core/state.js';

/**
 * Hand tool — pan, select, drag, resize annotations
 */
export const handTool = {
  name: 'hand',
  cursor: 'grab',

  onPointerDown(ctx, e) {
    const { x, y, state } = ctx;
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];

    // Check for resize handle on selected annotation.
    // Cursor is driven by state.isResizing + state.activeHandle.
    const selAnn = selAnns.length === 1 ? selAnns[0] : null;
    if (selAnn) {
      const handleType = ctx.findHandleAt(x, y, selAnn);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.dragStartX = x;
        state.dragStartY = y;
        state.originalAnnotation = ctx.cloneAnnotation(selAnn);
        return;
      }
    }

    const clickedAnnotation = ctx.findAnnotationAt(x, y);
    if (clickedAnnotation) {
      if (e.ctrlKey || e.metaKey) {
        // Re-read after potential addToSelection
        const selAnns2 = () => doc ? doc.selectedAnnotations : [];
        // Ctrl+click: initiate Ctrl+drag copy
        if (ctx.isSelected(clickedAnnotation)) {
          state.isDragging = true;
          state._ctrlDragCopy = true;
          state._ctrlCopiesCreated = false;
          state.originalAnnotations = selAnns2().map(a => ctx.cloneAnnotation(a));
          if (selAnns2().length === 1) {
            state.originalAnnotation = ctx.cloneAnnotation(selAnns2()[0]);
          }
          state.dragCursor = 'copy';
        } else {
          ctx.addToSelection(clickedAnnotation);
          state.isDragging = true;
          state._ctrlDragCopy = true;
          state._ctrlCopiesCreated = false;
          state.originalAnnotations = selAnns2().map(a => ctx.cloneAnnotation(a));
          if (selAnns2().length === 1) {
            state.originalAnnotation = ctx.cloneAnnotation(selAnns2()[0]);
          }
          state.dragCursor = 'copy';
        }
        if (selAnns2().length === 1) {
          ctx.showProperties(selAnns2()[0]);
        } else if (selAnns2().length > 1) {
          ctx.showMultiSelectionProperties();
        } else {
          ctx.hideProperties();
        }
      } else {
        if (doc) { doc.selectedAnnotations = [clickedAnnotation]; doc.selectedAnnotation = clickedAnnotation; }
        ctx.showProperties(clickedAnnotation);
        const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(clickedAnnotation.type);
        if (!isTextMarkup) {
          state.isDragging = true;
          state.dragStartX = x;
          state.dragStartY = y;
          state.originalAnnotation = ctx.cloneAnnotation(clickedAnnotation);
          state.originalAnnotations = [ctx.cloneAnnotation(clickedAnnotation)];
          state.dragCursor = 'move';
        }
      }
      ctx.redraw();
    } else {
      ctx.clearSelection();
      ctx.hideProperties();
      if (ctx.viewMode === 'continuous') {
        ctx.startContinuousPan(e, false);
      } else {
        ctx.startPan(e, false);
      }
      ctx.redraw();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvas } = ctx;

    // Hover state goes into state.hoverHandle / state.hoverAnnotation —
    // js/ui/cursor.js derives the cursor from these.
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];
    const hoverAnn = selAnns.length === 1 ? selAnns[0] : null;
    let hoverHandle = null;
    if (hoverAnn) {
      hoverHandle = ctx.findHandleAt(x, y, hoverAnn);
    }
    state.hoverHandle = hoverHandle;
    if (hoverHandle) {
      state.hoverAnnotation = null;
      canvas.title = '';
      return;
    }
    const hoverAnnotation = ctx.findAnnotationAt(x, y);
    state.hoverAnnotation = hoverAnnotation || null;
    canvas.title = (hoverAnnotation?.type === 'comment' && !hoverAnnotation.popupOpen && hoverAnnotation.text)
      ? hoverAnnotation.text.split('\n').slice(0, 5).join('\n') : '';
  },
};
