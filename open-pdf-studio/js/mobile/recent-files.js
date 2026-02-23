const STORAGE_KEY = 'recentFiles';
const MAX_ENTRIES = 10;

/**
 * Get the list of recent files from localStorage.
 * @returns {Array<{path: string, name: string, timestamp: number}>}
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
 * @param {string} path - File path or name
 * @param {string} name - Display name
 */
export function addRecentFile(path, name) {
  try {
    let files = getRecentFiles();

    // Remove existing entry with the same path
    files = files.filter(f => f.path !== path);

    // Add to the front
    files.unshift({
      path,
      name,
      timestamp: Date.now()
    });

    // Cap at MAX_ENTRIES
    if (files.length > MAX_ENTRIES) {
      files = files.slice(0, MAX_ENTRIES);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch (e) {
    console.warn('Failed to save recent file:', e);
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
