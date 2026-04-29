/**
 * Property Panel Registry
 *
 * Plugins can register a custom property-panel renderer for their own
 * annotation types. When a user selects a plugin-annotation, OPPS looks
 * up the renderer by annotation.type and mounts the returned DOM into
 * the right-hand Eigenschappen panel.
 *
 * Renderer contract:
 *   renderFn(annotation, updateAnnotProp, onCommit, onCancel) -> HTMLElement | DocumentFragment
 *
 *   - annotation: the selected annotation object
 *   - updateAnnotProp(key, value): setter that mutates annotation in-place
 *     and triggers redrawAnnotations(). Use dot-paths for nested fields:
 *     "data.project" or "data.address.email".
 *   - onCommit(): optional auto-save trigger (default: handled by OPPS
 *     selection-clear flow, no explicit commit needed)
 *   - onCancel(): optional revert trigger
 */

const registry = new Map();

export function registerPropertyPanel(typeName, renderFn) {
  if (typeof typeName !== 'string' || !typeName) {
    throw new Error('registerPropertyPanel: typeName must be a non-empty string');
  }
  if (typeof renderFn !== 'function') {
    throw new Error(`registerPropertyPanel: renderFn must be a function for type "${typeName}"`);
  }
  registry.set(typeName, renderFn);
}

export function getPropertyPanel(typeName) {
  return registry.get(typeName) || null;
}

export function unregisterPropertyPanel(typeName) {
  registry.delete(typeName);
}

export function hasPropertyPanel(typeName) {
  return registry.has(typeName);
}
