import { Show, createEffect, onCleanup } from 'solid-js';
import { customPanelRender, updateAnnotProp, getCurrentAnnotation, storeHideProperties } from '../../stores/propertiesStore.js';

/**
 * Mounts a plugin-provided custom property-panel renderer when the selected
 * annotation type has one registered via api.registerPropertyPanel(). The
 * plugin renderer returns plain DOM (HTMLElement | DocumentFragment) which we
 * append to the panel-body.
 *
 * Renderer signature:
 *   renderFn(annotation, updateAnnotProp, onCommit, onCancel) -> DOM
 */
export default function CustomPluginPanel() {
  let containerRef;

  createEffect(() => {
    const renderFn = customPanelRender();
    const annotation = getCurrentAnnotation();
    if (!containerRef || !renderFn || !annotation) {
      if (containerRef) containerRef.innerHTML = '';
      return;
    }
    containerRef.innerHTML = '';
    try {
      const dom = renderFn(annotation, updateAnnotProp, () => {}, storeHideProperties);
      if (dom) containerRef.appendChild(dom);
    } catch (err) {
      console.error('[CustomPluginPanel] renderFn threw', err);
    }
  });

  onCleanup(() => {
    if (containerRef) containerRef.innerHTML = '';
  });

  return (
    <Show when={customPanelRender()}>
      <div class="custom-plugin-panel" ref={containerRef} />
    </Show>
  );
}
