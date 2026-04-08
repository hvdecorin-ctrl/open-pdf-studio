import { state, getActiveDocument } from '../core/state.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { updateStatusTool } from '../ui/chrome/status-bar.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { getTool } from './tool-registry.js';
import { buildToolContext, resolvePointerCoords } from './tool-context.js';

// Tools that are always allowed (view-only, non-modifying)
const READONLY_ALLOWED_TOOLS = new Set(['select', 'hand']);

// Get cursor for a given tool
export function getCursorForTool(tool = state.currentTool) {
  switch (tool) {
    case 'select':
      return 'default';  // Arrow cursor for unified selection
    case 'hand':
      return 'grab';
    case 'text':
    case 'editText':
      return 'text';
    default: {
      const typeHandler = getAnnotationType(tool);
      return (typeHandler && typeHandler.cursor) || 'crosshair';
    }
  }
}

// NOTE: cursor management is now centralized in js/ui/cursor.js (reactive
// memo derived from app state). Tools and the dispatcher write state — they
// never set element.style.cursor. The setAllCanvasCursors helper that used
// to live here has been removed; setTool() below clears hover state instead.

// Enable or disable text selection based on current tool.
// Stacking: textLayer (z:5) < annotation-canvas (z:6) < formLayer (z:7) < linkLayer (z:10)
function setTextSelectionEnabled(enabled) {
  const textLayers = document.querySelectorAll('.textLayer');
  textLayers.forEach(layer => {
    // When enabled, the layer needs pointer-events: auto so native drag-to-select
    // works across span boundaries.  When disabled, pointer-events: none lets clicks
    // fall through to the annotation canvas.
    layer.style.pointerEvents = enabled ? 'auto' : 'none';
    const spans = layer.querySelectorAll('span');
    spans.forEach(span => {
      span.style.pointerEvents = enabled ? 'auto' : 'none';
      span.style.cursor = enabled ? 'text' : 'default';
    });
  });
}

// Configure layer stacking for tools that need text layer access (select, editText).
// Drops annotation canvas below text layer, disables its pointer-events, and disables
// form/link pointer events (they sit above the text layer and would intercept events).
// Centralised here to avoid race conditions with async tool deactivation.
function setAnnotationCanvasForTextAccess(enabled) {
  document.querySelectorAll('#annotation-canvas, .annotation-canvas').forEach(el => {
    el.style.zIndex = enabled ? '2' : '6';
    el.style.pointerEvents = enabled ? 'none' : 'auto';
  });
  document.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
    el.style.pointerEvents = enabled ? 'none' : '';
  });
}

// Set current tool
export function setTool(tool) {
  // Block annotation tools when PDF/A read-only is active
  if (isPdfAReadOnly() && !READONLY_ALLOWED_TOOLS.has(tool)) {
    return;
  }

  // Deactivate the current tool via lifecycle
  if (state.currentTool !== tool) {
    const currentToolObj = getTool(state.currentTool);
    if (currentToolObj && currentToolObj.onDeactivate) {
      // Build a minimal context for deactivation
      const redraw = () => { if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous(); else redrawAnnotations(); };
      const ctx = { state, redraw, redrawAnnotations, redrawContinuous };
      currentToolObj.onDeactivate(ctx);
    }
  }

  // Deactivate PDF text editing when switching away
  if (state.currentTool === 'editText' && tool !== 'editText') {
    import('./text-edit-tool.js').then(m => m.deactivateEditTextTool());
  }

  state.currentTool = tool;
  // Don't clear toolOverrides when switching TO stamp — SymbolPalette sets them before setTool
  if (tool !== 'stamp') {
    state.toolOverrides = null;
  }

  // Reset hover state so a stale hover from the previous tool doesn't keep
  // showing its cursor under the new tool. The reactive cursor module
  // (js/ui/cursor.js) will pick up state.currentTool and recompute.
  state.hoverAnnotation = null;
  state.hoverHandle = null;

  // Hide properties panel when switching tools (keep visible for annotation tools)
  if (tool !== 'select') {
    hideProperties();
  }

  // Text selection: enabled for unified select tool (text layer activates dynamically)
  if (tool !== 'editText') {
    setTextSelectionEnabled(tool === 'select');
  }

  // Activate edit text tool layer management
  if (tool === 'editText') {
    import('./text-edit-tool.js').then(m => m.activateEditTextTool());
  }

  // Drop annotation canvas below text layer ONLY for editText tool
  // select = unified tool (annotation canvas stays above, text layer activates dynamically)
  setAnnotationCanvasForTextAccess(tool === 'editText');

  // Update status bar
  updateStatusTool();
}

// Enable or disable annotation tool buttons based on PDF/A read-only state
export function updatePdfAToolState() {
  // If locked and current tool is an annotation tool, switch back to select
  if (isPdfAReadOnly() && !READONLY_ALLOWED_TOOLS.has(state.currentTool)) {
    setTool('select');
  }
}

// Reset to hand tool whenever a PDF is loaded (avoids circular dependency with loader.js)
document.addEventListener('pdf-loaded', () => {
  setTool('select');
});
