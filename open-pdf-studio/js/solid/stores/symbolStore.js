import { createSignal, createMemo } from 'solid-js';
import { BUILT_IN_CATEGORIES } from '../data/symbolLibrary.js';
import { NEN1414_CATEGORIES } from '../data/nen1414Library.js';
import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';
import { registerPaletteDock } from './paletteOrder.js';

// --- State ---
const [searchQuery, setSearchQuery] = createSignal('');
const [expandedCategories, setExpandedCategories] = createSignal(new Set(['electrical']));
const [symbolPaletteVisible, setSymbolPaletteVisibleRaw] = createSignal(true);
const [symbolPaletteMode, setSymbolPaletteModeRaw] = createSignal('docked-right');
const [symbolFloatPos, setSymbolFloatPos] = createSignal({ x: 300, y: 150 });
const [settingsOpen, setSettingsOpen] = createSignal(false);
const [disabledGroups, setDisabledGroupsRaw] = createSignal(new Set());

function setDisabledGroups(groups) {
  const s = groups instanceof Set ? groups : new Set(groups);
  setDisabledGroupsRaw(s);
  state.preferences.disabledSymbolGroups = [...s];
  savePreferences();
}

function toggleGroupEnabled(id) {
  const s = new Set(disabledGroups());
  if (s.has(id)) s.delete(id); else s.add(id);
  setDisabledGroups(s);
}

function isGroupEnabled(id) {
  return !disabledGroups().has(id);
}

// --- Custom groups stored in preferences ---
function getCustomGroups() {
  return state.preferences.customSymbolGroups || [];
}

function setCustomGroups(groups) {
  state.preferences.customSymbolGroups = groups;
  savePreferences();
}

// --- All categories (built-in + custom) ---
const allCategories = createMemo(() => {
  const custom = getCustomGroups().map(g => ({
    ...g,
    builtin: false,
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/></svg>`,
  }));
  return [
    ...BUILT_IN_CATEGORIES,
    ...NEN1414_CATEGORIES,
    ...custom
  ];
});

// --- Filtered categories based on search + enabled state ---
const filteredCategories = createMemo(() => {
  const q = searchQuery().toLowerCase().trim();
  const disabled = disabledGroups();
  let cats = allCategories().filter(c => !disabled.has(c.id));
  if (q) {
    cats = cats
      .map(cat => ({
        ...cat,
        symbols: cat.symbols.filter(s =>
          s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
        )
      }))
      .filter(cat => cat.symbols.length > 0);
  }
  return cats;
});

// --- Category expand/collapse ---
function toggleCategory(id) {
  setExpandedCategories(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function isCategoryExpanded(id) {
  return expandedCategories().has(id);
}

// --- Custom group CRUD ---
function addCustomGroup(name) {
  const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const groups = [...getCustomGroups(), { id, name, symbols: [] }];
  setCustomGroups(groups);
  // Auto-expand new group
  setExpandedCategories(prev => {
    const next = new Set(prev);
    next.add(id);
    return next;
  });
  return id;
}

function removeCustomGroup(id) {
  setCustomGroups(getCustomGroups().filter(g => g.id !== id));
}

function addSymbolToGroup(groupId, name, svg) {
  const groups = getCustomGroups().map(g => {
    if (g.id !== groupId) return g;
    const symId = groupId + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { ...g, symbols: [...g.symbols, { id: symId, name, svg }] };
  });
  setCustomGroups(groups);
}

function removeSymbolFromGroup(groupId, symbolId) {
  const groups = getCustomGroups().map(g => {
    if (g.id !== groupId) return g;
    return { ...g, symbols: g.symbols.filter(s => s.id !== symbolId) };
  });
  setCustomGroups(groups);
}

// --- Palette visibility/mode persistence ---
function setSymbolPaletteVisible(v) {
  setSymbolPaletteVisibleRaw(v);
  state.preferences.symbolPaletteVisible = v;
  savePreferences();
}

function setSymbolPaletteMode(m) {
  setSymbolPaletteModeRaw(m);
  state.preferences.symbolPaletteMode = m;
  savePreferences();
}

function saveSymbolPaletteState() {
  state.preferences.symbolPaletteVisible = symbolPaletteVisible();
  state.preferences.symbolPaletteMode = symbolPaletteMode();
  const pos = symbolFloatPos();
  state.preferences.symbolPaletteFloatX = pos.x;
  state.preferences.symbolPaletteFloatY = pos.y;
  savePreferences();
}

function initSymbolPalette() {
  const prefs = state.preferences;
  if (prefs.symbolPaletteVisible != null) setSymbolPaletteVisibleRaw(prefs.symbolPaletteVisible);
  if (prefs.disabledSymbolGroups) setDisabledGroupsRaw(new Set(prefs.disabledSymbolGroups));
  const mode = prefs.symbolPaletteMode || 'docked-right';
  setSymbolPaletteModeRaw(mode);
  if (prefs.symbolPaletteFloatX != null) {
    setSymbolFloatPos({ x: prefs.symbolPaletteFloatX, y: prefs.symbolPaletteFloatY ?? 150 });
  }
  // Register dock position
  if (symbolPaletteVisible() && mode.startsWith('docked-')) {
    registerPaletteDock('symbols', mode.replace('docked-', ''));
  }
}

export {
  searchQuery, setSearchQuery,
  filteredCategories, allCategories,
  toggleCategory, isCategoryExpanded,
  symbolPaletteVisible, setSymbolPaletteVisible,
  symbolPaletteMode, setSymbolPaletteMode,
  symbolFloatPos, setSymbolFloatPos,
  saveSymbolPaletteState, initSymbolPalette,
  settingsOpen, setSettingsOpen,
  toggleGroupEnabled, isGroupEnabled,
  addCustomGroup, removeCustomGroup,
  addSymbolToGroup, removeSymbolFromGroup,
  getCustomGroups,
};
