import { openAppMenu as open, closeAppMenu as close } from '../../solid/stores/appMenuStore.js';

export function openAppMenu() { open(); }
export function closeAppMenu() { close(); }
export function initMenus() {}
export function closeAllMenus() { close(); }
