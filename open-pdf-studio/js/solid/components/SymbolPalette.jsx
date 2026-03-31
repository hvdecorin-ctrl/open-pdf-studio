import { Show, For, createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import {
  searchQuery, setSearchQuery,
  filteredCategories, allCategories,
  toggleCategory, isCategoryExpanded,
  symbolPaletteVisible, setSymbolPaletteVisible,
  symbolPaletteMode, setSymbolPaletteMode,
  symbolFloatPos, setSymbolFloatPos,
  saveSymbolPaletteState,
  settingsOpen, setSettingsOpen,
  toggleGroupEnabled, isGroupEnabled,
  addCustomGroup, removeCustomGroup, addSymbolToGroup, getCustomGroups,
} from '../stores/symbolStore.js';
import { registerPaletteDock, unregisterPaletteDock } from '../stores/paletteOrder.js';

const DOCK_SNAP = 60;

// --- Shared drag logic ---
function startDrag(e, fromDocked) {
  if (e.button !== 0) return;
  e.preventDefault();
  const mainViewEl = document.querySelector('.main-view');
  if (!mainViewEl) return;
  let hasMoved = false;
  const startCX = e.clientX;
  const startCY = e.clientY;
  const offsetX = fromDocked ? 17 : (e.clientX - symbolFloatPos().x);
  const offsetY = fromDocked ? 12 : (e.clientY - symbolFloatPos().y);

  function getSnapSide(cx) {
    const rect = mainViewEl.getBoundingClientRect();
    if (cx - rect.left < DOCK_SNAP) return 'left';
    if (rect.right - cx < DOCK_SNAP) return 'right';
    return null;
  }

  function onMove(ev) {
    if (!hasMoved) {
      if (Math.abs(ev.clientX - startCX) < 4 && Math.abs(ev.clientY - startCY) < 4) return;
      hasMoved = true;
      if (fromDocked) {
        setSymbolPaletteMode('float');
        unregisterPaletteDock('symbols');
      }
    }
    const el = document.querySelector('.sp-float');
    const pw = el ? el.offsetWidth : 240;
    const ph = el ? el.offsetHeight : 300;
    const nx = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - pw));
    const ny = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - ph));
    setSymbolFloatPos({ x: nx, y: ny });
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!hasMoved) return;
    const snap = getSnapSide(ev.clientX);
    if (snap) {
      setSymbolPaletteMode(`docked-${snap}`);
      registerPaletteDock('symbols', snap);
    } else {
      unregisterPaletteDock('symbols');
    }
    saveSymbolPaletteState();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// --- Select symbol → activate stamp tool with SVG override ---
function selectSymbol(symbol) {
  // setTool clears toolOverrides, so set them AFTER switching tool
  setTool('stamp');
  state.toolOverrides = {
    stampSvg: symbol.svg,
    stampWidth: 40,
    stampHeight: 40,
    lockAspectRatio: true,
  };
}

// Colorize SVG: replace #000 and #d00 strokes/fills with category color
function colorizeSvg(svg, color) {
  if (!color) return svg;
  return svg.replace(/stroke="#000"/g, `stroke="${color}"`)
            .replace(/fill="#000"/g, `fill="${color}"`)
            .replace(/stroke="#d00"/g, `stroke="${color}"`)
            .replace(/fill="#d00"/g, `fill="${color}"`);
}

// Grip icon (6 dots)
const gripSvg = `<svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="2" cy="10" r="1" fill="currentColor"/><circle cx="6" cy="10" r="1" fill="currentColor"/></svg>`;

const searchSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="14" y2="14"/></svg>`;

const settingsSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.5 1.5m7 7L13 13M3 13l1.5-1.5m7-7L13 3"/></svg>`;

const closeSvg = `<svg width="8" height="8" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>`;

const arrowSvg = `<svg viewBox="0 0 10 10" width="10" height="10"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// --- Inner content (shared between docked and floating) ---
function SymbolContent() {
  return (
    <>
      {/* Search */}
      <div class="sp-search">
        <div class="sp-search-wrap">
          <div class="sp-search-icon" innerHTML={searchSvg} />
          <input
            type="text"
            placeholder="Search symbols..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Categories */}
      <div class="sp-categories">
        <Show when={filteredCategories().length > 0} fallback={<div class="sp-empty">No symbols found</div>}>
          <For each={filteredCategories()}>
            {(cat) => (
              <div>
                <div class="sp-cat-header" onClick={() => toggleCategory(cat.id)}>
                  <div class={`sp-cat-arrow${isCategoryExpanded(cat.id) ? ' expanded' : ''}`} innerHTML={arrowSvg} />
                  <div class="sp-cat-icon" style={{ color: cat.color || '#333' }} innerHTML={cat.icon} />
                  <span class="sp-cat-name">{cat.name}</span>
                  <span class="sp-cat-count">{cat.symbols.length}</span>
                </div>
                <Show when={isCategoryExpanded(cat.id)}>
                  <div class="sp-grid">
                    <For each={cat.symbols}>
                      {(sym) => (
                        <button
                          class={`sp-symbol-btn${state.toolOverrides?.stampSvg === sym.svg ? ' active' : ''}`}
                          title={sym.name}
                          onClick={() => selectSymbol(sym)}
                          innerHTML={colorizeSvg(sym.svg, cat.color)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

// --- Docked symbol palette ---
export function DockedSymbolPalette(props) {
  const side = () => props.side;
  const shouldShow = () => symbolPaletteVisible() && symbolPaletteMode() === `docked-${side()}`;

  return (
    <Show when={shouldShow()}>
      <div class={`sp-panel sp-docked${side() === 'right' ? ' sp-docked-right' : ''}`}>
        <div class="sp-header">
          <div class="sp-grip" onMouseDown={(e) => startDrag(e, true)} innerHTML={gripSvg} />
          <span class="sp-title">Symbols</span>
          <button class="sp-settings-btn" title="Settings" onClick={() => setSettingsOpen(true)} innerHTML={settingsSvg} />
          <button class="sp-close-btn" onClick={() => { setSymbolPaletteVisible(false); unregisterPaletteDock('symbols'); saveSymbolPaletteState(); }} innerHTML={closeSvg} />
        </div>
        <SymbolContent />
      </div>
    </Show>
  );
}

// --- Floating symbol palette ---
export function FloatingSymbolPalette() {
  const shouldShow = () => symbolPaletteVisible() && symbolPaletteMode() === 'float';

  return (
    <Show when={shouldShow()}>
      <div
        class="sp-panel sp-float"
        style={`left:${symbolFloatPos().x}px; top:${symbolFloatPos().y}px`}
      >
        <div class="sp-float-header" onMouseDown={(e) => {
          if (e.target.closest('.sp-float-close')) return;
          startDrag(e, false);
        }}>
          <span class="sp-float-title">Symbols</span>
          <button class="sp-settings-btn" title="Settings" onClick={() => setSettingsOpen(true)} innerHTML={settingsSvg} />
          <button class="sp-float-close" onClick={() => { setSymbolPaletteVisible(false); saveSymbolPaletteState(); }} innerHTML={closeSvg} />
        </div>
        <SymbolContent />
      </div>
    </Show>
  );
}

// --- Settings Dialog ---
export function SymbolSettingsDialog() {
  const [newGroupName, setNewGroupName] = createSignal('');
  let fileInputRef;
  let importGroupInputRef;

  function handleAddGroup() {
    const name = newGroupName().trim();
    if (!name) return;
    addCustomGroup(name);
    setNewGroupName('');
  }

  // Upload SVG or raster image as symbol to a custom group
  const [uploadTargetGroup, setUploadTargetGroup] = createSignal(null);

  function handleUploadClick(groupId) {
    setUploadTargetGroup(groupId);
    fileInputRef?.click();
  }

  async function handleFileSelected(e) {
    const files = e.target.files;
    const groupId = uploadTargetGroup();
    if (!files || !groupId) return;

    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
        // Vector SVG
        const text = await file.text();
        addSymbolToGroup(groupId, name, text);
      } else if (file.type.startsWith('image/')) {
        // Raster image → convert to data URL
        const reader = new FileReader();
        const dataUrl = await new Promise(resolve => {
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        // Wrap in SVG <image> for consistent handling
        const svg = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><image href="${dataUrl}" width="64" height="64"/></svg>`;
        addSymbolToGroup(groupId, name, svg);
      }
    }
    e.target.value = '';
  }

  // Export a custom group as a downloadable JSON file
  function handleExportGroup(cat) {
    const groupData = getCustomGroups().find(g => g.id === cat.id);
    if (!groupData) return;
    const json = JSON.stringify({ id: groupData.id, name: groupData.name, color: groupData.color || null, symbols: groupData.symbols }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${groupData.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Import a group from a JSON file
  async function handleImportGroup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.name || !Array.isArray(data.symbols)) {
        console.warn('Invalid symbol group file: missing name or symbols array');
        return;
      }
      const groupId = addCustomGroup(data.name);
      // Add all symbols from the imported group
      for (const sym of data.symbols) {
        if (sym.name && sym.svg) {
          addSymbolToGroup(groupId, sym.name, sym.svg);
        }
      }
    } catch (err) {
      console.error('Failed to import symbol group:', err);
    }
    e.target.value = '';
  }

  return (
    <Show when={settingsOpen()}>
      <input ref={fileInputRef} type="file" accept=".svg,image/*" multiple
        style={{ display: 'none' }} onChange={handleFileSelected} />
      <input ref={importGroupInputRef} type="file" accept=".json"
        style={{ display: 'none' }} onChange={handleImportGroup} />
      <div class="sp-settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
        <div class="sp-settings-dialog">
          <div class="sp-settings-header">
            <h3>Symbol Library Settings</h3>
            <button class="sp-float-close" onClick={() => setSettingsOpen(false)} innerHTML={closeSvg} />
          </div>
          <div class="sp-settings-body">
            <For each={allCategories()}>
              {(cat) => (
                <div class="sp-settings-group" style={{ opacity: isGroupEnabled(cat.id) ? 1 : 0.5 }}>
                  <div class="sp-settings-group-header">
                    <label style={{ display: 'flex', 'align-items': 'center', gap: '6px', cursor: 'pointer', flex: 1 }}>
                      <input type="checkbox" checked={isGroupEnabled(cat.id)}
                        onChange={() => toggleGroupEnabled(cat.id)}
                        style={{ margin: 0, cursor: 'pointer' }} />
                      <span class="sp-settings-group-name" style={{ color: cat.color || '#333' }}>{cat.name}</span>
                    </label>
                    <Show when={cat.builtin}>
                      <span class="sp-settings-group-badge">Built-in</span>
                    </Show>
                    <Show when={!cat.builtin}>
                      <button class="sp-settings-btn-add" style={{ height: '20px', 'font-size': '9px', padding: '0 6px' }}
                        onClick={() => handleUploadClick(cat.id)}>+ Add Symbol</button>
                      <button class="sp-settings-btn-add" style={{ height: '20px', 'font-size': '9px', padding: '0 6px' }}
                        onClick={() => handleExportGroup(cat)}>Export</button>
                      <button class="sp-settings-btn-remove" onClick={() => removeCustomGroup(cat.id)}>Remove</button>
                    </Show>
                  </div>
                  <div class="sp-settings-symbols">
                    <For each={cat.symbols}>
                      {(sym) => (
                        <div class="sp-settings-symbol" title={sym.name}
                          innerHTML={colorizeSvg(sym.svg, cat.color)} />
                      )}
                    </For>
                    <Show when={cat.symbols.length === 0}>
                      <span style={{ 'font-size': '10px', color: '#999' }}>No symbols yet</span>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="sp-settings-footer">
            <input
              type="text"
              placeholder="New group name..."
              value={newGroupName()}
              onInput={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddGroup(); }}
            />
            <button class="sp-settings-btn-add" disabled={!newGroupName().trim()} onClick={handleAddGroup}>
              Add Group
            </button>
            <button class="sp-settings-btn-add" onClick={() => importGroupInputRef?.click()}>
              Import Group
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function toggleSymbolPalette() {
  const willBeVisible = !symbolPaletteVisible();
  setSymbolPaletteVisible(willBeVisible);
  const mode = symbolPaletteMode();
  if (willBeVisible && mode.startsWith('docked-')) {
    registerPaletteDock('symbols', mode.replace('docked-', ''));
  } else {
    unregisterPaletteDock('symbols');
  }
  saveSymbolPaletteState();
}
