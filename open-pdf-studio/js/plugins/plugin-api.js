/**
 * Plugin API
 *
 * Creates the `api` object that is passed to plugin activate() functions.
 * This is the contract between the host app and plugins.
 */

import { registerAnnotationType, unregisterAnnotationType } from './annotation-type-registry.js';
import { registerToolPalette, unregisterToolPalette } from './palette-registry.js';
import { registerPropertyPanel as _registerPropertyPanel, unregisterPropertyPanel as _unregisterPropertyPanel } from './property-panel-registry.js';
import { state, getActiveDocument } from '../core/state.js';
import { setTool } from '../tools/manager.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations } from '../annotations/rendering.js';

export function createPluginApi(pluginId) {
  const registeredTypes = [];
  const registeredPalettes = [];
  const registeredPanels = [];

  return {
    pluginId,

    // --- Annotation type registration ---
    registerAnnotationType(typeName, handler) {
      const prefixedName = typeName;
      registerAnnotationType(prefixedName, handler);
      registeredTypes.push(prefixedName);
    },

    unregisterAnnotationType(typeName) {
      unregisterAnnotationType(typeName);
      const idx = registeredTypes.indexOf(typeName);
      if (idx >= 0) registeredTypes.splice(idx, 1);
    },

    // --- Tool palette registration ---
    registerToolPalette(descriptor) {
      registerToolPalette(descriptor);
      registeredPalettes.push(descriptor.id);
    },

    unregisterToolPalette(id) {
      unregisterToolPalette(id);
      const idx = registeredPalettes.indexOf(id);
      if (idx >= 0) registeredPalettes.splice(idx, 1);
    },

    // --- Property panel registration (custom edit-form for plugin annotations) ---
    registerPropertyPanel(typeName, renderFn) {
      _registerPropertyPanel(typeName, renderFn);
      registeredPanels.push(typeName);
    },

    unregisterPropertyPanel(typeName) {
      _unregisterPropertyPanel(typeName);
      const idx = registeredPanels.indexOf(typeName);
      if (idx >= 0) registeredPanels.splice(idx, 1);
    },

    // --- Tool management ---
    setTool(toolName) {
      setTool(toolName);
    },

    setToolOverrides(overrides) {
      state.toolOverrides = overrides;
    },

    // --- State access (read-only helpers) ---
    getPreferences() {
      return state.preferences;
    },

    getCurrentTool() {
      return state.currentTool;
    },

    getCurrentPage() {
      const doc = getActiveDocument();
      return doc ? doc.currentPage : 1;
    },

    // --- Annotation helpers ---
    createAnnotation(props) {
      return createAnnotation(props);
    },

    redrawAnnotations() {
      redrawAnnotations();
    },

    // --- Cleanup (called by plugin-manager on deactivate) ---
    _cleanup() {
      registeredTypes.forEach(t => unregisterAnnotationType(t));
      registeredPalettes.forEach(id => unregisterToolPalette(id));
      registeredPanels.forEach(t => _unregisterPropertyPanel(t));
      registeredTypes.length = 0;
      registeredPalettes.length = 0;
      registeredPanels.length = 0;
    }
  };
}
