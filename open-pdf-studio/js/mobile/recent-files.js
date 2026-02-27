const STORAGE_KEY = 'recentFiles';
const MAX_ENTRIES = 50;

/**
 * Get the list of recent files from localStorage.
 * @returns {Array<{path: string, name: string, timestamp: number, pinned?: boolean}>}
 */
export function getRecentFiles() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to read recent files:', e);
  }
  return [];
}

/**
 * Add or update a recent file entry.
 * Moves existing entries to the top and caps at MAX_ENTRIES.
 * Preserves pinned state for existing entries.
 * @param {string} path - File path or name
 * @param {string} name - Display name
 */
export function addRecentFile(path, name) {
  try {
    let files = getRecentFiles();

    // Preserve pinned state if the file already exists
    const existing = files.find(f => f.path === path);
    const wasPinned = existing ? !!existing.pinned : false;

    // Remove existing entry with the same path
    files = files.filter(f => f.path !== path);

    // Add to the front
    files.unshift({
      path,
      name,
      timestamp: Date.now(),
      pinned: wasPinned
    });

    // Cap at MAX_ENTRIES (but never remove pinned files)
    if (files.length > MAX_ENTRIES) {
      const pinned = files.filter(f => f.pinned);
      const unpinned = files.filter(f => !f.pinned);
      files = [...pinned, ...unpinned.slice(0, Math.max(0, MAX_ENTRIES - pinned.length))];
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch (e) {
    console.warn('Failed to save recent file:', e);
  }
}

/**
 * Remove a recent file entry by path.
 * @param {string} path - File path to remove
 */
export function removeRecentFile(path) {
  try {
    let files = getRecentFiles();
    files = files.filter(f => f.path !== path);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch (e) {
    console.warn('Failed to remove recent file:', e);
  }
}

/**
 * Pin a recent file so it stays at the top and is never auto-removed.
 * @param {string} path - File path to pin
 */
export function pinRecentFile(path) {
  try {
    const files = getRecentFiles();
    const entry = files.find(f => f.path === path);
    if (entry) {
      entry.pinned = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    }
  } catch (e) {
    console.warn('Failed to pin recent file:', e);
  }
}

/**
 * Unpin a recent file.
 * @param {string} path - File path to unpin
 */
export function unpinRecentFile(path) {
  try {
    const files = getRecentFiles();
    const entry = files.find(f => f.path === path);
    if (entry) {
      entry.pinned = false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    }
  } catch (e) {
    console.warn('Failed to unpin recent file:', e);
  }
}

/**
 * Clear all recent files.
 */
export function clearRecentFiles() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear recent files:', e);
  }
}
