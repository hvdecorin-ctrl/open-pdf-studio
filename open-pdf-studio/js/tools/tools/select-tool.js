import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform, getEffectiveScale } from '../tool-context.js';

/**
 * Select tool — click-select, rubber band, drag, resize, Ctrl+drag copy
 * Unified select tool — handles both annotation selection and text selection
 */
export const selectTool = {
  name: 'select',
  cursor: 'default',

  onPointerDown(ctx, e) {
    const { x, y, state } = ctx;
    const pdfaLocked = ctx.isPdfAReadOnly();
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];

    // Check resize handle on selected annotation.
    // Cursor is driven by state.isResizing + state.activeHandle (see js/ui/cursor.js).
    const selAnn = selAnns.length === 1 ? selAnns[0] : null;
    if (!pdfaLocked && selAnn) {
      const handleType = ctx.findHandleAt(x, y, selAnn);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.originalAnnotation = ctx.cloneAnnotation(selAnn);
        return;
      }
    }

    const clickedAnnotation = ctx.findAnnotationAt(x, y);
    if (clickedAnnotation) {
      // Double-click to edit textbox/callout
      if (!pdfaLocked && e.detail === 2 && ['textbox', 'callout'].includes(clickedAnnotation.type)) {
        ctx.startTextEditing(clickedAnnotation);
        return;
      }

      // Click on comment: open popup
      if (clickedAnnotation.type === 'comment') {
        if (doc) { doc.selectedAnnotations = [clickedAnnotation]; doc.selectedAnnotation = clickedAnnotation; }
        ctx.showProperties(clickedAnnotation);
        ctx.openStickyPopup(clickedAnnotation);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        // Re-read after potential addToSelection
        const selAnns2 = () => doc ? doc.selectedAnnotations : [];
        if (ctx.isSelected(clickedAnnotation)) {
          // Ctrl+click on already selected: initiate Ctrl+drag copy
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = selAnns2().map(a => ctx.cloneAnnotation(a));
            if (selAnns2().length === 1) {
              state.originalAnnotation = ctx.cloneAnnotation(selAnns2()[0]);
            }
            state.dragCursor = 'copy';
          }
        } else {
          // Ctrl+click on unselected: add and allow drag
          ctx.addToSelection(clickedAnnotation);
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = selAnns2().map(a => ctx.cloneAnnotation(a));
            if (selAnns2().length === 1) {
              state.originalAnnotation = ctx.cloneAnnotation(selAnns2()[0]);
            }
            state.dragCursor = 'copy';
          }
        }
        if (selAnns2().length === 1) {
          ctx.showProperties(selAnns2()[0]);
        } else if (selAnns2().length > 1) {
          ctx.showMultiSelectionProperties();
        } else {
          ctx.hideProperties();
        }
        ctx.redraw();
      } else {
        const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(clickedAnnotation.type);
        if (ctx.isSelected(clickedAnnotation) && selAnns.length > 1) {
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotations = selAnns.map(a => ctx.cloneAnnotation(a));
            state.dragCursor = 'move';
          }
        } else {
          if (doc) { doc.selectedAnnotations = [clickedAnnotation]; doc.selectedAnnotation = clickedAnnotation; }
          ctx.showProperties(clickedAnnotation);
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotation = ctx.cloneAnnotation(clickedAnnotation);
            state.originalAnnotations = [ctx.cloneAnnotation(clickedAnnotation)];
            state.dragCursor = 'move';
          }
        }
      }
    } else {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click on empty space: keep selection
      } else {
        // Start rubber band selection
        state.isRubberBanding = true;
        state.rubberBandStartX = x;
        state.rubberBandStartY = y;
        ctx.clearSelection();
        ctx.hideProperties();
        ctx.redraw();

        // No annotation hit — temporarily enable text layer for text selection
        const textLayers = document.querySelectorAll('.textLayer');
        textLayers.forEach(layer => {
          layer.style.pointerEvents = 'auto';
          layer.querySelectorAll('span').forEach(span => {
            span.style.pointerEvents = 'auto';
            span.style.cursor = 'text';
          });
        });
      }
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvas, canvasCtx } = ctx;

    // Rubber band drawing
    if (state.isRubberBanding) {
      ctx.redraw();
      const sc = getEffectiveScale();
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = '#0066cc';
      canvasCtx.lineWidth = 1 / sc;
      canvasCtx.setLineDash([4 / sc, 4 / sc]);
      canvasCtx.fillStyle = 'rgba(0, 102, 204, 0.1)';
      const rbX = Math.min(state.rubberBandStartX, x);
      const rbY = Math.min(state.rubberBandStartY, y);
      const rbW = Math.abs(x - state.rubberBandStartX);
      const rbH = Math.abs(y - state.rubberBandStartY);
      canvasCtx.fillRect(rbX, rbY, rbW, rbH);
      canvasCtx.strokeRect(rbX, rbY, rbW, rbH);
      canvasCtx.setLineDash([]);
      canvasCtx.restore();
      return;
    }

    // Hover state — write to state.hoverAnnotation / state.hoverHandle.
    // The reactive cursor module (js/ui/cursor.js) reads these and updates
    // the visible cursor automatically; tools NEVER set canvas.style.cursor.
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];
    const hoverAnn = selAnns.length === 1 ? selAnns[0] : null;
    let hoverHandle = null;
    if (hoverAnn) {
      hoverHandle = ctx.findHandleAt(x, y, hoverAnn);
    }
    state.hoverHandle = hoverHandle;
    if (hoverHandle) {
      // Hovering a resize handle — clear annotation hover so the handle wins.
      state.hoverAnnotation = null;
      canvas.title = '';
      return;
    }
    const hoverAnnotation = ctx.findAnnotationAt(x, y);
    state.hoverAnnotation = hoverAnnotation || null;
    canvas.title = (hoverAnnotation?.type === 'comment' && !hoverAnnotation.popupOpen && hoverAnnotation.text)
      ? hoverAnnotation.text.split('\n').slice(0, 5).join('\n') : '';
  },

  onPointerUp(ctx, e) {
    const { x, y, state } = ctx;

    // Rubber band selection end
    if (state.isRubberBanding) {
      state.isRubberBanding = false;

      const rbX = Math.min(state.rubberBandStartX, x);
      const rbY = Math.min(state.rubberBandStartY, y);
      const rbW = Math.abs(x - state.rubberBandStartX);
      const rbH = Math.abs(y - state.rubberBandStartY);

      if (rbW > 3 || rbH > 3) {
        const selected = [];
        const doc = state.documents[state.activeDocumentIndex];
        for (const ann of (doc?.annotations || [])) {
          if (ann.page !== ctx.pageNum) continue;
          const bounds = ctx.getAnnotationBounds(ann);
          if (!bounds) continue;
          if (bounds.x < rbX + rbW && bounds.x + bounds.width > rbX &&
              bounds.y < rbY + rbH && bounds.y + bounds.height > rbY) {
            selected.push(ann);
          }
        }
        if (selected.length > 0) {
          const doc = getActiveDocument();
          if (doc) {
            doc.selectedAnnotations = selected;
            doc.selectedAnnotation = selected.length > 0 ? selected[0] : null;
          }
          if (selected.length === 1) {
            ctx.showProperties(selected[0]);
          } else {
            ctx.showMultiSelectionProperties();
          }
        }
      }
      ctx.redraw();

      // Restore text layer to non-interactive after rubber band
      setTimeout(() => {
        if (state.currentTool === 'select') {
          const textLayers = document.querySelectorAll('.textLayer');
          textLayers.forEach(layer => {
            layer.style.pointerEvents = 'none';
            layer.querySelectorAll('span').forEach(span => {
              span.style.pointerEvents = 'none';
              span.style.cursor = 'default';
            });
          });
        }
      }, 100);

      return true; // handled
    }

    // Restore text layer to non-interactive after pointer up
    setTimeout(() => {
      if (state.currentTool === 'select') {
        const textLayers = document.querySelectorAll('.textLayer');
        textLayers.forEach(layer => {
          layer.style.pointerEvents = 'none';
          layer.querySelectorAll('span').forEach(span => {
            span.style.pointerEvents = 'none';
            span.style.cursor = 'default';
          });
        });
      }
    }, 100);

    return false; // not handled — let dispatcher do drag/resize finalization
  },
};
