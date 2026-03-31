import { Show, For, createSignal } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import {
  scheduleVisible, setScheduleVisible,
  groupBy, setGroupBy,
  filterType, setFilterType,
  searchLabel, setSearchLabel,
  groupedEntries, scheduleEntries,
  saveTemplate, loadTemplate, deleteTemplate, getTemplates,
  exportCSV,
} from '../stores/scheduleStore.js';

const closeSvg = `<svg width="8" height="8" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>`;

export default function SchedulePanel() {
  const [templateName, setTemplateName] = createSignal('');
  const [showTemplates, setShowTemplates] = createSignal(false);
  const [panelPos, setPanelPos] = createSignal({ x: null, y: null });

  // Drag logic for panel header
  function startPanelDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const panel = e.target.closest('.schedule-panel');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    function onMove(ev) {
      const nx = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - rect.width));
      const ny = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - rect.height));
      setPanelPos({ x: nx, y: ny });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Place schedule as annotation on PDF
  function placeOnPdf() {
    const doc = getActiveDocument();
    if (!doc) return;
    const entries = scheduleEntries();
    if (entries.length === 0) return;

    const ann = createAnnotation({
      type: 'scheduleTable',
      page: doc.currentPage,
      x: 50, y: 50,
      width: 350, height: 20 + entries.length * 16,
      scheduleData: entries.map(e => ({ type: e.typeName, label: e.label, subject: e.subject, value: e.value, unit: e.unit, text: e.text, page: e.page })),
      groupByMode: groupBy(),
      color: '#000000',
      lineWidth: 0.5,
      opacity: 1,
    });
    doc.annotations.push(ann);
    import('../../annotations/rendering.js').then(m => m.redrawAnnotations());
  }

  return (
    <Show when={scheduleVisible()}>
      <div class="schedule-panel"
        style={panelPos().x != null ? { left: `${panelPos().x}px`, top: `${panelPos().y}px`, right: 'auto', bottom: 'auto' } : {}}>
        {/* Header — draggable */}
        <div class="schedule-header" onMouseDown={startPanelDrag} style={{ cursor: 'grab' }}>
          <span class="schedule-title">Take-Off</span>
          <div style={{ display: 'flex', gap: '4px', 'align-items': 'center' }}>
            <button class="schedule-btn-sm" title="Place on PDF" onClick={placeOnPdf}>PDF</button>
            <button class="schedule-btn-sm" title="Export CSV" onClick={exportCSV}>CSV</button>
            <button class="schedule-btn-sm" title="Templates" onClick={() => setShowTemplates(!showTemplates())}>
              {showTemplates() ? 'Hide' : 'Templates'}
            </button>
            <button class="schedule-close" onClick={() => setScheduleVisible(false)} innerHTML={closeSvg} />
          </div>
        </div>

        {/* Templates section */}
        <Show when={showTemplates()}>
          <div class="schedule-templates">
            <div style={{ display: 'flex', gap: '4px', 'margin-bottom': '4px' }}>
              <input type="text" placeholder="Template name..." value={templateName()}
                onInput={(e) => setTemplateName(e.target.value)}
                class="schedule-input" style={{ flex: 1 }} />
              <button class="schedule-btn-sm" disabled={!templateName().trim()}
                onClick={() => { saveTemplate(templateName().trim()); setTemplateName(''); }}>Save</button>
            </div>
            <For each={getTemplates()}>
              {(t) => (
                <div class="schedule-template-row">
                  <span class="schedule-template-name" onClick={() => loadTemplate(t.name)}>{t.name}</span>
                  <button class="schedule-btn-xs" onClick={() => deleteTemplate(t.name)}>x</button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Filters */}
        <div class="schedule-filters">
          <select value={groupBy()} onChange={(e) => setGroupBy(e.target.value)} class="schedule-select">
            <option value="type">Group: Type</option>
            <option value="page">Group: Page</option>
            <option value="label">Group: Label</option>
          </select>
          <select value={filterType()} onChange={(e) => setFilterType(e.target.value)} class="schedule-select">
            <option value="all">All types</option>
            <option value="measureDistance">Distance</option>
            <option value="measureArea">Area</option>
            <option value="measurePerimeter">Perimeter</option>
            <option value="measureAngle">Angle</option>
          </select>
          <input type="text" placeholder="Filter label..." value={searchLabel()}
            onInput={(e) => setSearchLabel(e.target.value)}
            class="schedule-input" />
        </div>

        {/* Table */}
        <div class="schedule-body">
          <Show when={groupedEntries().length > 0} fallback={
            <div class="schedule-empty">No measurements found</div>
          }>
            <For each={groupedEntries()}>
              {(group) => (
                <div class="schedule-group">
                  <div class="schedule-group-header">
                    <span class="schedule-group-name">{group.name}</span>
                    <span class="schedule-group-count">{group.items.length}</span>
                  </div>
                  <table class="schedule-table">
                    <thead>
                      <tr>
                        <th>Label</th>
                        <th>Subject</th>
                        <th>Value</th>
                        <th>Unit</th>
                        <th>Pg</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={group.items}>
                        {(item) => (
                          <tr>
                            <td>{item.label || item.typeName}</td>
                            <td>{item.subject}</td>
                            <td class="schedule-val">{item.text}</td>
                            <td>{item.unit}</td>
                            <td>{item.page}</td>
                          </tr>
                        )}
                      </For>
                      <Show when={group.items.length > 1}>
                        <tr class="schedule-total-row">
                          <td>Total</td>
                          <td></td>
                          <td class="schedule-val">{group.total.toFixed(2)}</td>
                          <td>{group.unit}</td>
                          <td></td>
                        </tr>
                      </Show>
                    </tbody>
                  </table>
                </div>
              )}
            </For>
          </Show>
        </div>

        {/* Footer */}
        <div class="schedule-footer">
          <span>{scheduleEntries().length} measurements</span>
        </div>
      </div>
    </Show>
  );
}
