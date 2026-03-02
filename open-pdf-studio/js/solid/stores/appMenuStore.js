import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';

// Active panel within app menu (UI-only state)
const [activePanel, setActivePanelSignal] = createSignal('none');

export function openAppMenu() {
  state.appMenuOpen = true;
  setActivePanelSignal('open');
}

export function closeAppMenu() {
  state.appMenuOpen = false;
}

export function setActivePanel(name) {
  setActivePanelSignal(name);
}

export function isAppMenuOpen() {
  return state.appMenuOpen;
}

export function getActivePanel() {
  return activePanel();
}
