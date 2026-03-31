/**
 * Reusable input history navigator (terminal-style up/down arrow).
 * Persists via Tauri FS (appDataDir/ai-history.json) with localStorage fallback.
 *
 * Usage:
 *   const history = new InputHistory({ maxSize: 100 });
 *   await history.init();                // load from disk
 *   history.push('my question');          // after sending
 *   history.navigateUp('current draft');  // on ArrowUp
 *   history.navigateDown();               // on ArrowDown
 *   history.cancel();                     // on Escape
 */
import { isTauri } from '../core/platform.js';

const STORAGE_KEY = 'ai_input_history';

export class InputHistory {
  constructor({ maxSize = 100 } = {}) {
    this._maxSize = maxSize;
    this._entries = [];
    this._index = -1;
    this._draft = '';
    this._savePending = false;
  }

  /** Load history from storage. Call once at startup. */
  async init() {
    try {
      const data = await this._read();
      if (Array.isArray(data)) {
        this._entries = data.slice(-this._maxSize);
      }
    } catch { /* start fresh */ }
  }

  push(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (this._entries.length > 0 && this._entries[this._entries.length - 1] === trimmed) {
      this._reset();
      return;
    }

    this._entries.push(trimmed);
    if (this._entries.length > this._maxSize) {
      this._entries = this._entries.slice(-this._maxSize);
    }

    this._reset();
    this._debouncedSave();
  }

  navigateUp(currentInput) {
    if (this._entries.length === 0) return currentInput;

    if (this._index === -1) {
      this._draft = currentInput || '';
      this._index = this._entries.length;
    }

    if (this._index > 0) this._index--;
    return this._entries[this._index] || this._draft;
  }

  navigateDown() {
    if (this._index === -1) return undefined;
    this._index++;

    if (this._index >= this._entries.length) {
      const draft = this._draft;
      this._reset();
      return draft;
    }
    return this._entries[this._index];
  }

  cancel() {
    const draft = this._draft;
    this._reset();
    return draft;
  }

  get isNavigating() {
    return this._index !== -1;
  }

  get entries() {
    return [...this._entries];
  }

  clear() {
    this._entries = [];
    this._reset();
    this._debouncedSave();
  }

  _reset() {
    this._index = -1;
    this._draft = '';
  }

  // ── Storage ──

  async _getPath() {
    if (!isTauri() || !window.__TAURI__?.path) return null;
    const dir = await window.__TAURI__.path.appDataDir();
    return dir + 'ai-history.json';
  }

  async _read() {
    const path = await this._getPath();
    if (path && window.__TAURI__?.fs) {
      try {
        const text = await window.__TAURI__.fs.readTextFile(path);
        return JSON.parse(text);
      } catch { /* file doesn't exist yet */ }
    }
    // Fallback
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }

  async _write() {
    const json = JSON.stringify(this._entries);

    const path = await this._getPath();
    if (path && window.__TAURI__?.fs) {
      try {
        await window.__TAURI__.fs.writeTextFile(path, json);
        return;
      } catch { /* fallback below */ }
    }
    try { localStorage.setItem(STORAGE_KEY, json); } catch { /* full */ }
  }

  _debouncedSave() {
    if (this._savePending) return;
    this._savePending = true;
    setTimeout(() => {
      this._savePending = false;
      this._write();
    }, 1000);
  }
}
